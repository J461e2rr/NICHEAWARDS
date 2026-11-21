const tokenPattern = /^[0-9a-f]{64}$/;
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function ballotApi(request, env) {
  const origin = request.headers.get('Origin');
  const ownOrigin = new URL(request.url).origin;
  const allowed = !origin || origin === ownOrigin ||
    String(env.PAGES_ORIGIN || '').split(',').map(value => value.trim()).includes(origin);
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  });
  const reply = (data, status = 200) => Response.json(data, { status, headers });
  if (!allowed) return reply({ error: 'origin' }, 403);
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    return new Response(null, { status: 204, headers });
  }
  if (!['GET', 'PUT'].includes(request.method)) return reply({ error: 'method' }, 405);

  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!tokenPattern.test(token)) return reply({ error: 'authorization' }, 401);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const voter = hex(new Uint8Array(digest));
  const read = async () => {
    const row = await env.DB.prepare('SELECT choices, revision FROM nomination_ballots WHERE voter_hash = ?')
      .bind(voter).first();
    return row ? { choices: JSON.parse(row.choices), revision: row.revision } : { choices: [], revision: 0 };
  };
  try {
    if (request.method === 'GET') return reply(await read());
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({ error: 'content-type' }, 415);
    const stream = request.body?.getReader();
    if (!stream) return reply({ error: 'json' }, 400);
    const buffer = new Uint8Array(512);
    let length = 0;
    while (true) {
      const { value, done } = await stream.read();
      if (done) break;
      if (length + value.length > buffer.length) {
        await stream.cancel();
        return reply({ error: 'size' }, 413);
      }
      buffer.set(value, length);
      length += value.length;
    }
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(buffer.subarray(0, length))); }
    catch { return reply({ error: 'json' }, 400); }
    const { choices, revision } = payload || {};
    if (!Array.isArray(choices) || choices.length > 4 || new Set(choices).size !== choices.length ||
        !choices.every(id => Number.isInteger(id) && id >= 1 && id <= 8) ||
        !Number.isSafeInteger(revision) || revision < 0) {
      return reply({ error: 'ballot' }, 400);
    }
    const next = [...choices].sort((a, b) => a - b);
    const row = await env.DB.prepare(`
      INSERT INTO nomination_ballots (voter_hash, choices, revision)
      SELECT ?, ?, 1 WHERE ? = 0 OR EXISTS (SELECT 1 FROM nomination_ballots WHERE voter_hash = ?)
      ON CONFLICT(voter_hash) DO UPDATE SET
        choices = excluded.choices, revision = nomination_ballots.revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE nomination_ballots.revision = ?
      RETURNING revision
    `).bind(voter, JSON.stringify(next), revision, voter, revision).first();
    if (!row) return reply(await read(), 409);
    return reply({ choices: next, revision: row.revision });
  } catch (error) {
    console.error('Ballot storage unavailable:', error.message);
    return reply({ error: 'storage' }, 503);
  }
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === '/api/ballot') return ballotApi(request, env);
    return new Response('Not found', { status: 404 });
  },
};

