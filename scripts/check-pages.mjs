import { randomBytes } from 'node:crypto';
import { ballotEndpoint } from '../pages-build/ballot-config.js';

const origin = new URL(process.env.PAGES_URL).origin;
const preflight = await fetch(ballotEndpoint, {
  method: 'OPTIONS',
  headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'PUT',
    'Access-Control-Request-Headers': 'authorization, content-type',
  },
  signal: AbortSignal.timeout(10000),
});
if (preflight.status !== 204 || preflight.headers.get('Access-Control-Allow-Origin') !== origin) {
  throw new Error('The voting API did not accept requests from ' + origin);
}
const response = await fetch(ballotEndpoint, {
  headers: { Origin: origin, Authorization: 'Bearer ' + randomBytes(32).toString('hex') },
  signal: AbortSignal.timeout(10000),
});
if (process.env.TELEGRAM_CLIENT_ID) {
  if (response.status !== 401 || (await response.json()).error !== 'telegram_login') {
    throw new Error('Voting API must require Telegram authentication.');
  }
  const login = await fetch(new URL('/api/telegram/start', ballotEndpoint), { redirect:'manual', signal:AbortSignal.timeout(10000) });
  if (login.status !== 303 || !login.headers.get('location')?.startsWith('https://oauth.telegram.org/auth?')) {
    throw new Error('The Telegram sign-in endpoint did not redirect to Telegram.');
  }
  console.log('Telegram requirement and OAuth redirect verified.');
  process.exit(0);
}
if (!response.ok) throw new Error('The voting API could not read its D1 database: HTTP ' + response.status);
const ballot = await response.json();
if (!Array.isArray(ballot.choices) || ballot.choices.length !== 0 || ballot.revision !== 0) {
  throw new Error('Unexpected response for an empty ballot.');
}
console.log('Voting API and Pages origin verified.');

