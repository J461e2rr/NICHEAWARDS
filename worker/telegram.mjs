const issuer = 'https://oauth.telegram.org';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const b64 = data => btoa(String.fromCharCode(...new Uint8Array(data))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64 = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
const now = () => Math.floor(Date.now() / 1000);
const json = value => JSON.parse(decoder.decode(unb64(value)));
const cookie = '__Host-tg-state';
const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
let keys;

export const telegramEnabled = env => Boolean(env.TELEGRAM_CLIENT_ID && env.TELEGRAM_CLIENT_SECRET);

async function sessionKey(env) {
  return crypto.subtle.importKey('raw', encoder.encode('niche-awards/session/v1:' + env.TELEGRAM_CLIENT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(payload, env) {
  const data = b64(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(env), encoder.encode(data));
  return data + '.' + b64(signature);
}

async function verify(value, purpose, env) {
  if (!/^[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try {
    const [data, signature] = value.split('.');
    if (!await crypto.subtle.verify('HMAC', await sessionKey(env), unb64(signature), encoder.encode(data))) return null;
    const payload = json(data);
    return payload.purpose === purpose && Number.isInteger(payload.exp) && payload.exp > now() ? payload : null;
  } catch {
    return null;
  }
}

export async function telegramVoter(bearer, env) {
  const payload = await verify(bearer, 'vote', env);
  return payload && typeof payload.sub === 'string' ? 'telegram:' + payload.sub : null;
}

async function checkIdToken(token, audience) {
  if (typeof token !== 'string' || token.length > 8192 || !jwtPattern.test(token)) throw new Error('Invalid ID token');
  const [encodedHeader, encodedClaims, signature] = token.split('.');
  const header = json(encodedHeader);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unexpected signing algorithm');
  if (!keys || keys.exp < now() || !keys.data.some(key => key.kid === header.kid)) {
    const response = await fetch(issuer + '/.well-known/jwks.json', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Telegram keys unavailable');
    keys = { exp: now() + 3600, data: (await response.json()).keys };
  }
  const jwk = keys.data.find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) throw new Error('Telegram signing key not found');
  const key = await crypto.subtle.importKey('jwk', jwk, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64(signature), encoder.encode(encodedHeader + '.' + encodedClaims))) {
    throw new Error('Invalid Telegram signature');
  }
  const claims = json(encodedClaims);
  if (claims.iss !== issuer || claims.aud !== audience || !Number.isInteger(claims.exp) ||
      claims.exp <= now() || !Number.isInteger(claims.iat) || claims.iat < now() - 600 ||
      claims.iat > now() + 60 || typeof claims.sub !== 'string' || !/^\d{1,64}$/.test(claims.sub)) {
    throw new Error('Invalid Telegram claims');
  }
  return claims.sub;
}

function redirect(location, stateCookie) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (stateCookie) headers.set('Set-Cookie', stateCookie);
  return new Response(null, { status: 303, headers });
}

export async function telegramAuth(request, env) {
  if (!telegramEnabled(env) || !env.TELEGRAM_RETURN_URL || request.method !== 'GET') {
    return new Response('Unavailable', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const url = new URL(request.url);
  const callback = url.origin + '/api/telegram/callback';
  const client = env.TELEGRAM_CLIENT_ID;
  const attrs = '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=';
  const clear = cookie + '=' + attrs + '0';
  if (url.pathname === '/api/telegram/start') {
    const state = random();
    const verifier = random();
    const challenge = b64(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)));
    const signed = await sign({purpose:'login', state, verifier, exp:now() + 600}, env);
    const target = new URL(issuer + '/auth');
    target.search = new URLSearchParams({client_id:client, redirect_uri:callback, response_type:'code',
      scope:'openid', state, code_challenge:challenge, code_challenge_method:'S256'}).toString();
    return redirect(target.href, cookie + '=' + signed + attrs + '600');
  }
  const result = new URL(env.TELEGRAM_RETURN_URL);
  try {
    const raw = (request.headers.get('Cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(cookie + '='));
    const data = await verify(raw?.slice(cookie.length + 1) || '', 'login', env);
    const code = url.searchParams.get('code');
    if (!data || data.state !== url.searchParams.get('state') || !code || code.length > 2048) throw new Error('Invalid login state');
    const response = await fetch(issuer + '/token', {
      method: 'POST',
      headers: { Authorization:'Basic ' + btoa(client + ':' + env.TELEGRAM_CLIENT_SECRET), 'Content-Type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type:'authorization_code', code, redirect_uri:callback, client_id:client, code_verifier:data.verifier }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Telegram token exchange failed');
    const sub = await checkIdToken((await response.json()).id_token, client);
    result.hash = 'tg_session=' + await sign({purpose:'vote',sub,exp:now() + 7 * 86400}, env);
  } catch {
    result.hash = 'tg_error=1';
  }
  return redirect(result.href, clear);
}
