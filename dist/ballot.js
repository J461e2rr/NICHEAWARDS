import { ballotEndpoint } from './ballot-config.js';

const list = document.querySelector('#ballot');
const count = document.querySelector('#vote-count');
const status = document.querySelector('#vote-status');
const retry = document.querySelector('#vote-retry');
const endpoint = ballotEndpoint || '/api/ballot';
const voterKey = 'niche-awards-voter-v1';

let token;
let choices = [];
let revision = 0;
let ready = false;
let busy = false;

const nominees = [
  'Е###н года',
  'Накрутка года',
  'Нормис года',
  'Человек-Помощь года',
  '"Неинтересно года"',
  'Нишевая пара года',
  'Ларпер года',
  'Провал года',
];

const buttons = nominees.map((name, index) => {
  const id = index + 1;
  const item = document.createElement('li');
  const heading = document.createElement('h3');
  heading.textContent = name;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'glass-button';
  const label = document.createElement('span');
  button.append(label);
  button.addEventListener('click', () => update(id));
  item.append(heading, button);
  list.append(item);
  return { id, name, button, label };
});

function render() {
  count.textContent = choices.length + ' из 4';
  for (const { id, name, button, label } of buttons) {
    const selected = choices.includes(id);
    label.textContent = selected ? 'Отменить голос' : 'Голосовать';
    button.setAttribute('aria-label', label.textContent + ' — ' + name);
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = !ready || busy || (!selected && choices.length >= 4);
  }
}

function getToken() {
  const saved = localStorage.getItem(voterKey);
  if (saved && /^[0-9a-f]{64}$/.test(saved)) return saved;
  const next = [...crypto.getRandomValues(new Uint8Array(32))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(voterKey, next);
  return next;
}

async function request(method, body) {
  const headers = { Authorization: 'Bearer ' + token };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(endpoint, {
    method, headers, body: body && JSON.stringify(body),
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok && response.status !== 409) throw new Error('Ballot request failed');
  const data = await response.json();
  if (!Array.isArray(data.choices) || !Number.isInteger(data.revision)) throw new Error('Invalid ballot response');
  choices = data.choices;
  revision = data.revision;
  return response.status;
}

async function load() {
  ready = false;
  retry.hidden = true;
  status.textContent = 'Загружаем голоса…';
  render();
  try {
    token ||= getToken();
    await request('GET');
    ready = true;
    status.textContent = choices.length === 4 ? 'Лимит выбран. Можно отменить любой голос.' : '';
  } catch {
    status.textContent = 'Голосование пока недоступно. Не удалось связаться с сервером.';
    retry.hidden = false;
  }
  render();
}

async function update(id) {
  if (!ready || busy) return;
  const remove = choices.includes(id);
  if (!remove && choices.length >= 4) return;
  busy = true;
  status.textContent = 'Сохраняем…';
  render();
  try {
    const next = remove ? choices.filter(choice => choice !== id) : [...choices, id];
    const code = await request('PUT', { choices: next, revision });
    status.textContent = code === 409 ? 'Голоса изменились в другой вкладке. Проверь выбор.' :
      remove ? 'Голос отменён.' : choices.length === 4 ? 'Голос сохранён. Лимит выбран.' : 'Голос сохранён.';
  } catch {
    status.textContent = 'Не удалось подтвердить сохранение. Обнови список голосов.';
    retry.hidden = false;
    ready = false;
  } finally {
    busy = false;
    render();
  }
}

retry.addEventListener('click', load);
load();
