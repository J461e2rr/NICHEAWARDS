import { cp, readFile, writeFile } from 'node:fs/promises';

const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, PAGES_URL: url } = process.env;
if (!token || !/^[a-f0-9]{32}$/i.test(account || '') || !url) {
  throw new Error('Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and PAGES_URL.');
}
const origin = new URL(url).origin;
if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin)) throw new Error('Pages requires an HTTPS origin.');

const config = JSON.parse(await readFile('wrangler.example.json', 'utf8'));
const database = config.d1_databases[0];
const accountApi = 'https://api.cloudflare.com/client/v4/accounts/' + account;

async function cloudflare(path, options = {}) {
  const response = await fetch(accountApi + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    const codes = (result.errors || []).map(error => error.code).join(', ');
    throw new Error('Cloudflare request failed for ' + path.split('?')[0] + ' (HTTP ' + response.status + ', codes ' + codes + ').');
  }
  return result.result;
}

let workersDomain;
try {
  workersDomain = await cloudflare('/workers/subdomain');
} catch (error) {
  if (error.status !== 404 || !error.codes?.includes(10007)) throw error;
  workersDomain = await cloudflare('/workers/subdomain', {
    method: 'PUT',
    body: JSON.stringify({ subdomain: 'niche-awards-j461e2rr' }),
  });
}
const { subdomain } = workersDomain;
if (!/^[a-z0-9-]+$/.test(subdomain || '')) {
  throw new Error('Activate the account workers.dev subdomain in the Cloudflare dashboard.');
}
const matches = await cloudflare('/d1/database?name=' + encodeURIComponent(database.database_name));
const existing = matches.find(item => item.name === database.database_name);
const record = existing || await cloudflare('/d1/database', {
  method: 'POST',
  body: JSON.stringify({ name: database.database_name }),
});
if (!/^[a-f0-9-]{36}$/i.test(record.uuid || '')) throw new Error('Cloudflare did not return the D1 database ID.');

database.database_id = record.uuid;
config.vars.PAGES_ORIGIN = origin;
const client = process.env.TELEGRAM_CLIENT_ID;
const telegramSecret = process.env.TELEGRAM_CLIENT_SECRET;
if (client || telegramSecret) {
  if (!/^\d+$/.test(client || '') || !telegramSecret) throw new Error('Set Telegram Client ID and Client Secret together.');
  config.vars.TELEGRAM_CLIENT_ID = client;
  config.vars.TELEGRAM_RETURN_URL = url;
  await writeFile(process.env.RUNNER_TEMP + '/niche-worker-secrets.json', JSON.stringify({ TELEGRAM_CLIENT_SECRET: telegramSecret }), { mode: 0o600 });
}
config.workers_dev = true;
config.preview_urls = false;
const endpoint = 'https://' + config.name + '.' + subdomain + '.workers.dev/api/ballot';
await writeFile('wrangler.pages.json', JSON.stringify(config, null, 2) + '\n');
await cp('dist', 'pages-build', {
  recursive: true,
  filter: path => !path.split(/[\\/]/).some(part => part === 'server' || part === '.openai'),
});
await writeFile('pages-build/ballot-config.js', 'export const ballotEndpoint = ' + JSON.stringify(endpoint) + ';\n');

