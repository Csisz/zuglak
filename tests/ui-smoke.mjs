import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, createReadStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((request, response) => {
  const relative = decodeURIComponent(new URL(request.url, 'http://local').pathname).replace(/^\/+/, '') || 'index.html';
  const target = normalize(join(root, relative));
  if (!target.startsWith(root)) { response.writeHead(403).end(); return; }
  response.setHeader('Content-Type', mime[extname(target)] || 'application/octet-stream');
  createReadStream(target).on('error', () => response.writeHead(404).end()).pipe(response);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const appUrl = `http://127.0.0.1:${address.port}/`;
const profile = mkdtempSync(join(tmpdir(), 'zuglak-ui-'));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);
const browserPath = candidates.find(existsSync);
if (!browserPath) {
  server.close();
  rmSync(profile, { recursive: true, force: true });
  throw new Error('Chrome/Edge nem található. A CHROME_PATH változóval megadható.');
}

const chrome = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1000', appUrl
], { stdio: ['ignore', 'ignore', 'pipe'] });
const browserExit = new Promise(resolve => chrome.once('exit', resolve));

let socket;
try {
  const debuggerUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('A headless böngésző nem indult el időben.')), 15000);
    chrome.stderr.setEncoding('utf8');
    chrome.stderr.on('data', chunk => {
      const match = chunk.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    chrome.once('exit', code => reject(new Error(`A headless böngésző leállt (${code}).`)));
  });
  const port = new URL(debuggerUrl).port;
  let target;
  for (let attempt = 0; attempt < 30 && !target; attempt += 1) {
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(value => value.json());
    target = pages.find(value => value.type === 'page' && value.url.startsWith(appUrl));
    if (!target) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(target, 'Az alkalmazás böngészőlapja megnyílt');

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let requestId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Időtúllépés: ${expression}`);
  };
  const clickCanvas = async (x, y) => {
    const point = await evaluate(`(() => { const rect = document.querySelector('#stage').getBoundingClientRect(); return { x: rect.left + ${x}, y: rect.top + ${y} }; })()`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  };
  const capture = async name => {
    if (!process.env.CAPTURE_UI) return;
    const directory = join(root, 'artifacts');
    mkdirSync(directory, { recursive: true });
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(directory, name), Buffer.from(result.data, 'base64'));
  };

  await call('Runtime.enable');
  await waitFor(`document.readyState === 'complete' && document.querySelectorAll('.catalog-card').length === 11`);
  assert.match(await evaluate(`document.querySelector('.version-pill').textContent`), /1\.6/);
  assert.equal(await evaluate(`document.querySelectorAll('#rooms .room').length`), 3);
  assert.equal(await evaluate(`document.querySelectorAll('.catalog-card').length`), 11);
  assert.match(await evaluate(`[...document.querySelectorAll('.catalog-card')].find(x => x.textContent.includes('KALLAX')).textContent`), /76\.5 × 39 cm/);

  assert.equal(await evaluate(`(() => { const input = document.querySelector('#catalogSearch'); input.value = 'KALLAX'; input.dispatchEvent(new Event('input', { bubbles: true })); return document.querySelectorAll('.catalog-card').length; })()`), 1);
  await evaluate(`(() => { const input = document.querySelector('#catalogSearch'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.favorite-button').click(); })()`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('zuglak-favorites-v1')).length`), 1);

  await call('Page.reload', { ignoreCache: true });
  await waitFor(`document.readyState === 'complete' && document.querySelector('#favoriteCount')?.textContent === '1'`);

  await evaluate(`document.querySelector('#importIkea').click()`);
  await evaluate(`(() => { const input = document.querySelector('#ikeaUrl'); input.value = 'https://www.ikea.com/hu/hu/p/kivik-3-szemelyes-kanape-tibbleby-bezs-szuerke-s49440597/'; document.querySelector('#resolveIkea').click(); })()`);
  assert.deepEqual(await evaluate(`({ width: document.querySelector('#ikeaWidth').value, depth: document.querySelector('#ikeaDepth').value, locked: document.querySelector('#ikeaWidth').readOnly, source: !document.querySelector('#ikeaSourceLink').hidden })`), { width: '228', depth: '95', locked: true, source: true });
  await evaluate(`document.querySelector('#ikeaImportOk').click()`);
  assert.deepEqual(await evaluate(`(() => { const item = JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.variants.Alap.items.at(-1); return { source: item.source, width: item.w, depth: item.h, original: item.originalDimensions }; })()`), { source: 'ikea', width: 228, depth: 95, original: { width: 228, depth: 95, height: 83 } });

  await evaluate(`document.querySelector('#importIkea').click()`);
  await evaluate(`(() => { const input = document.querySelector('#ikeaUrl'); input.value = 'https://www.ikea.com/hu/hu/p/teszt-polc-12345678/'; document.querySelector('#resolveIkea').click(); })()`);
  assert.equal(await evaluate(`document.querySelector('#ikeaWidth').readOnly`), false);
  await evaluate(`document.querySelector('#ikeaForm').dispatchEvent(new SubmitEvent('submit', { cancelable: true, submitter: document.querySelector('#ikeaImportOk') }))`);
  assert.match(await evaluate(`document.querySelector('#ikeaImportStatus').textContent`), /szélesség megadása kötelező/i);
  await evaluate(`(() => { document.querySelector('#ikeaWidth').value = '111.5'; document.querySelector('#ikeaDepth').value = '44'; document.querySelector('#ikeaHeight').value = ''; document.querySelector('#ikeaForm').dispatchEvent(new SubmitEvent('submit', { cancelable: true, submitter: document.querySelector('#ikeaImportOk') })); })()`);
  assert.deepEqual(await evaluate(`(() => { const item = JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.variants.Alap.items.at(-1); return { width: item.w, depth: item.h, original: item.originalDimensions }; })()`), { width: 111.5, depth: 44, original: { width: 111.5, depth: 44 } });

  await evaluate(`(() => { const width = [...document.querySelectorAll('#props .field input')][1]; width.value = '120'; width.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await evaluate(`document.querySelector('#props .small-actions button').click()`);
  assert.deepEqual(await evaluate(`(() => { const item = JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.variants.Alap.items.at(-1); return { width: item.w, rotation: item.rot, originalWidth: item.originalDimensions.width }; })()`), { width: 120, rotation: 90, originalWidth: 111.5 });
  const beforeDuplicate = await evaluate(`JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.variants.Alap.items.length`);
  await evaluate(`document.querySelectorAll('#props .small-actions button')[1].click()`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.variants.Alap.items.length`), beforeDuplicate + 1);
  assert.equal(await evaluate(`document.querySelector('#warnings').hidden`), false);
  assert.match(await evaluate(`document.querySelector('#warnings').textContent`), /átfedésben/);
  await evaluate(`document.querySelectorAll('#props .small-actions button')[2].click()`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.variants.Alap.items.length`), beforeDuplicate);

  await evaluate(`document.querySelector('#modeWalls').click()`);
  await evaluate(`document.querySelector('#newGeometry').click()`);
  await waitFor(`document.querySelector('#dialog').open`);
  await evaluate(`(() => { document.querySelector('#dialogFields input').value = 'Pontos tesztgeometria'; document.querySelector('#dialogOk').click(); })()`);
  for (const point of [[150, 120], [350, 120], [350, 320], [150, 320]]) await clickCanvas(...point);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.geometries[0].vertices.length`), 4);
  await evaluate(`document.querySelector('#closeGeometry').click()`);
  assert.deepEqual(await evaluate(`(() => { const plan = JSON.parse(localStorage.getItem('zuglak-v2')); const geometry = plan.rooms.room1.geometries[0]; return { version: plan.version, closed: geometry.closed, objects: geometry.objects.length }; })()`), { version: 2, closed: true, objects: 0 });
  const verticesBeforeFlooring = await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.geometries[0].vertices)`);
  await evaluate(`(() => { const select = document.querySelector('#floorMaterial'); select.value = 'walnut'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.geometries[0].floorMaterial`), 'walnut');
  assert.equal(await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.geometries[0].vertices)`), verticesBeforeFlooring);

  const tracedLength = await evaluate(`Number(document.querySelector('.wall-length-row input').value)`);
  await evaluate(`(() => { const input = document.querySelector('.wall-length-row input'); input.value = String(${tracedLength} + 10); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.geometries[0].confirmedWalls[0]`), true);

  await evaluate(`document.querySelector('#modeOpenings').click()`);
  await evaluate(`document.querySelector('#addDoor').click()`);
  await clickCanvas(250, 120);
  await waitFor(`document.querySelector('#dialog').open`);
  await evaluate(`document.querySelector('#dialogOk').click()`);
  await waitFor(`JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.geometries[0].objects.length === 1`);
  assert.deepEqual(await evaluate(`(() => { const object = JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.geometries[0].objects[0]; return { type: object.type, width: object.width, swing: object.swing }; })()`), { type: 'door', width: 90, swing: 'in' });
  await evaluate(`document.querySelector('#undo').click()`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.geometries[0].objects.length`), 0);
  await evaluate(`document.querySelector('#redo').click()`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('zuglak-v2')).rooms.room1.geometries[0].objects.length`), 1);

  await evaluate(`document.querySelector('#modeMeasure').click()`);
  await clickCanvas(180, 180);
  await clickCanvas(280, 180);
  assert.match(await evaluate(`document.querySelector('#status').textContent`), /Mért távolság:/);

  await evaluate(`(() => { document.querySelector('#modeSelect').click(); document.querySelector('#snap').click(); })()`);
  assert.equal(await evaluate(`document.querySelector('#snap').getAttribute('aria-pressed')`), 'true');
  await capture('zuglak-1.6-desktop.png');
  if (process.env.CAPTURE_UI) {
    await call('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.scrollTo(0, document.querySelector('main').offsetTop)`);
    await capture('zuglak-1.6-tablet.png');
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.scrollTo(0, 0)`);
  }

  await evaluate(`(async () => { const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20; const blob = await (await fetch(canvas.toDataURL('image/png'))).blob(); const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'sajat-alaprajz.png', { type: 'image/png' })); const input = document.querySelector('#floorPlanUpload'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`document.querySelector('#dialog').open`);
  await evaluate(`(() => { document.querySelector('#dialogFields input').value = 'Teszt alaprajz'; document.querySelector('#dialogOk').click(); })()`);
  await waitFor(`document.querySelectorAll('#rooms .room').length === 4`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('zuglak-v2')).customPlans.length`), 1);

  await call('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.workspace')).display`), 'flex');
  assert.ok(await evaluate(`document.querySelector('main').getBoundingClientRect().width >= 800`));

  console.log('UI smoke: 1.4–1.5 regressziók, 1.6 vizuális réteg, pontos méretek, ajtó, mérés, snapping, ütközés és tablet nézet rendben.');
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (chrome.exitCode === null) chrome.kill();
  await browserExit;
  await new Promise(resolve => server.close(resolve));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
