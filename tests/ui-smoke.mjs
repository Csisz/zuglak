/*
 * Zuglak Studio 2.0 – end-to-end browser test (Chrome DevTools Protocol, no dependencies).
 * Drives the real application in headless Chrome/Edge/Chromium: catalogue, mouse drag,
 * rotation, undo/redo, 2D↔3D synchronisation, materials, variants, versions, IKEA import,
 * protected architecture editing, exports, persistence and 1.x → 2.0 migration.
 *   npm run test:ui            (CHROME_PATH=... to choose a browser, CAPTURE_UI=1 for screenshots)
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, createReadStream, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer((request, response) => {
  const relative = decodeURIComponent(new URL(request.url, 'http://local').pathname).replace(/^\/+/, '') || 'index.html';
  const target = normalize(join(root, relative));
  if (!target.startsWith(root)) { response.writeHead(403).end(); return; }
  response.setHeader('Content-Type', mime[extname(target)] || 'application/octet-stream');
  createReadStream(target).on('error', () => response.writeHead(404).end()).pipe(response);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const appUrl = `http://127.0.0.1:${server.address().port}/`;
const profile = mkdtempSync(join(tmpdir(), 'zuglak-ui-'));
const downloads = mkdtempSync(join(tmpdir(), 'zuglak-dl-'));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
].filter(Boolean);
const browserPath = candidates.find(existsSync);
if (!browserPath) {
  server.close();
  throw new Error('Chrome/Edge nem található. A CHROME_PATH változóval megadható.');
}

const chrome = spawn(browserPath, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1600,1000',
  ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
const browserExit = new Promise(resolve => chrome.once('exit', resolve));

let socket;
let step = 'indítás';
const pass = name => { step = name; console.log(`  ✓ ${name}`); };
try {
  const debuggerUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('A headless böngésző nem indult el időben.')), 20000);
    chrome.stderr.setEncoding('utf8');
    chrome.stderr.on('data', chunk => {
      const match = chunk.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    chrome.once('exit', code => reject(new Error(`A headless böngésző leállt (${code}).`)));
  });
  const port = new URL(debuggerUrl).port;
  let target;
  for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(value => value.json());
    target = pages.find(value => value.type === 'page');
    if (!target) await new Promise(resolve => setTimeout(resolve, 100));
  }
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let requestId = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description || ''}`);
    return result.result.value;
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (expression, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    const diagnostics = await evaluate(`({ href: location.href, ready: document.readyState, cards: document.querySelectorAll('.catalog-card').length, app: !!window.ZuglakApp })`).catch(() => null);
    throw new Error(`Időtúllépés: ${expression}\n${JSON.stringify(diagnostics)}\n${errors.join('\n')}`);
  };
  const plan = () => evaluate(`JSON.parse(localStorage.getItem('zuglak-v3'))`);
  const mouse = async (type, x, y, buttons = 1) => call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
  const canvasPoint = async world => evaluate(`(() => { const s = ZuglakApp.worldToScreen(${JSON.stringify(world)}); const r = document.querySelector('#plan').getBoundingClientRect(); return { x: r.left + s.x, y: r.top + s.y }; })()`);
  const clickAt = async point => { await mouse('mousePressed', point.x, point.y); await mouse('mouseReleased', point.x, point.y, 0); };
  const capture = async name => {
    if (!process.env.CAPTURE_UI) return;
    const directory = join(root, 'artifacts');
    mkdirSync(directory, { recursive: true });
    const result = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(directory, name), Buffer.from(result.data, 'base64'));
  };
  const closeDialogOk = () => evaluate(`document.querySelector('#dialogOk').click()`);

  await call('Runtime.enable');
  await call('Page.enable');
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await call('Page.navigate', { url: appUrl });
  await waitFor(`document.readyState !== 'loading' && document.querySelectorAll('.catalog-card').length > 50 && !!window.ZuglakApp`);

  // ---------- Start-up & catalogue
  assert.equal(await evaluate(`document.querySelector('#versionPill').textContent`), '2.1');
  await evaluate(`document.querySelector('#roomButton').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('#roomMenu .menu-item').length`), 4);
  await evaluate(`document.body.click()`);
  const first = await plan();
  assert.equal(first.version, 3);
  const room1Geometry = first.rooms.room1.geometries.find(g => g.id === first.rooms.room1.activeGeometryId);
  assert.equal(room1Geometry.source, 'plan');
  assert.deepEqual(room1Geometry.confirmedWalls.map((value, index) => value ? index : -1).filter(index => index >= 0), [0, 1, 2, 8, 10, 11]);
  assert.equal(room1Geometry.objects.filter(o => o.type === 'window').length, 2);
  assert.equal(room1Geometry.objects.filter(o => o.type === 'door').length, 1);
  const expectedAreas = { room2: 45.46, room3: 12.98, room4: 16.15 };
  for (const id of ['room2', 'room3', 'room4']) {
    const geometry = first.rooms[id].geometries.find(g => g.id === first.rooms[id].activeGeometryId);
    assert.equal(geometry.source, 'plan', id);
    assert.equal(await evaluate(`Math.round(ZuglakGeometry.polygonArea(${JSON.stringify(geometry.vertices)}) / 100) / 100`), expectedAreas[id], id);
  }
  assert.deepEqual(Object.values(first.rooms).map(room => room.name), ['Lányszoba – SZOBA III.', 'Konyha-étkező-nappali', 'SZOBA II.', 'SZOBA I.']);
  pass('indítás: mind a 4 szoba az építészeti tervrajz szerint');

  assert.equal(await evaluate(`(() => { const i = document.querySelector('#catalogSearch'); i.value = 'KALLAX'; i.dispatchEvent(new Event('input')); return document.querySelectorAll('.catalog-card').length; })()`), 1);
  assert.match(await evaluate(`document.querySelector('.catalog-card').textContent`), /76,5 × 39 cm/);
  await evaluate(`(() => { const i = document.querySelector('#catalogSearch'); i.value = ''; i.dispatchEvent(new Event('input')); document.querySelector('.catalog-card .favorite-button').click(); })()`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('zuglak-favorites-v1')).length`), 1);
  await evaluate(`document.querySelector('[data-category="kitchen"]').click()`);
  assert.ok(await evaluate(`document.querySelectorAll('.catalog-card').length`) >= 6);
  await evaluate(`document.querySelector('[data-category="all"]').click()`);
  pass('katalógus: keresés, kategóriák, kedvencek');

  // ---------- Add, drag, rotate, undo/redo
  const sofaKey = await evaluate(`ZuglakCatalog.generic.find(p => p.model === 'sofa').key`);
  await evaluate(`document.querySelector('.catalog-card[data-key="${sofaKey}"]').click()`);
  let state = await plan();
  let item = state.rooms.room1.variants.Alap.items.at(-1);
  assert.deepEqual({ model: item.model, w: item.w, h: item.h, status: item.dimensionStatus }, { model: 'sofa', w: 220, h: 95, status: 'typical' });
  const geometry = state.rooms.room1.geometries.find(g => g.id === state.rooms.room1.activeGeometryId);
  const center = await evaluate(`ZuglakGeometry.itemCenter(${JSON.stringify(item)})`);
  assert.ok(await evaluate(`ZuglakGeometry.pointInPolygon(${JSON.stringify(center)}, ${JSON.stringify(geometry.vertices)})`), 'new item lands inside the room');
  // Disable snapping for an exact drag measurement
  await evaluate(`document.querySelector('#snap').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: document.querySelector('#snap').getBoundingClientRect().left + 5 }))`);
  const zoom = await evaluate(`(() => { const a = ZuglakApp.worldToScreen({ x: 0, y: 0 }); const b = ZuglakApp.worldToScreen({ x: 100, y: 0 }); return (b.x - a.x) / 100; })()`);
  const start = await canvasPoint(center);
  await mouse('mousePressed', start.x, start.y);
  for (let index = 1; index <= 10; index += 1) await mouse('mouseMoved', start.x + index * 6, start.y + index * 3);
  await mouse('mouseReleased', start.x + 60, start.y + 30, 0);
  state = await plan();
  const moved = state.rooms.room1.variants.Alap.items.at(-1);
  assert.ok(Math.abs((moved.x - item.x) - 60 / zoom) < 0.6 && Math.abs((moved.y - item.y) - 30 / zoom) < 0.6, 'drag moves by the pointer distance in cm');
  await evaluate(`document.querySelector('#undo').click()`);
  state = await plan();
  assert.ok(Math.abs(state.rooms.room1.variants.Alap.items.at(-1).x - item.x) < 1e-6);
  await evaluate(`document.querySelector('#redo').click()`);
  state = await plan();
  assert.ok(Math.abs(state.rooms.room1.variants.Alap.items.at(-1).x - moved.x) < 1e-6);
  pass('húzás egérrel, visszavonás és újra');

  const beforeRotate = await evaluate(`ZuglakGeometry.itemCenter(JSON.parse(localStorage.getItem('zuglak-v3')).rooms.room1.variants.Alap.items.at(-1))`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', text: 'r' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR' });
  state = await plan();
  item = state.rooms.room1.variants.Alap.items.at(-1);
  assert.equal(item.rot, 90);
  const afterRotate = await evaluate(`ZuglakGeometry.itemCenter(${JSON.stringify(item)})`);
  assert.ok(Math.hypot(afterRotate.x - beforeRotate.x, afterRotate.y - beforeRotate.y) < 1e-6, 'rotation keeps the centre');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', modifiers: 2 });
  assert.equal((await plan()).rooms.room1.variants.Alap.items.length, 2);
  assert.match(await evaluate(`document.querySelector('#warningCount').textContent`), /figyelmeztetés/);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete' });
  assert.equal((await plan()).rooms.room1.variants.Alap.items.length, 1);
  pass('forgatás a középpont körül, másolat, ütközésjelzés, törlés');

  // ---------- Inspector precise placement
  await evaluate(`ZuglakApp.select(JSON.parse(localStorage.getItem('zuglak-v3')).rooms.room1.variants.Alap.items[0].id)`);
  await evaluate(`(() => { const i = document.querySelector('#inspector input[data-key="w"]'); i.value = '200'; i.dispatchEvent(new Event('change')); })()`);
  item = (await plan()).rooms.room1.variants.Alap.items[0];
  assert.equal(item.w, 200);
  assert.equal(item.dimensionStatus, 'user');
  await evaluate(`[...document.querySelectorAll('#inspector .button')].find(b => b.textContent.includes('Falhoz tolás')).click()`);
  const clearances = await evaluate(`ZuglakGeometry.wallClearances(${JSON.stringify((await plan()).rooms.room1.variants.Alap.items[0])}, ZuglakGeometry.wallSegments(${JSON.stringify(geometry)}))`);
  assert.ok(clearances.find(value => value.side === 'top').distance < 0.01, 'push-to-wall puts the back flush against the wall');
  pass('pontos méret, falhoz tolás, faltávolság-mérés');

  // ---------- 3D synchronisation
  await evaluate(`ZuglakApp.setView('3d')`);
  await waitFor(`!!ZuglakApp.view3d() && ZuglakApp.view3d().stats().furniture === 1`, 30000);
  const tableKey = await evaluate(`ZuglakCatalog.generic.find(p => p.model === 'table').key`);
  await evaluate(`document.querySelector('.catalog-card[data-key="${tableKey}"]').click()`);
  await waitFor(`ZuglakApp.view3d().stats().furniture === 2`);
  const meshes = await evaluate(`ZuglakApp.view3d().stats().meshes`);
  assert.ok(meshes > 40, 'walls, floor and furniture meshes exist');
  for (const camera of ['top', 'perspective', 'bird']) {
    await evaluate(`document.querySelector('#cameraSwitch [data-camera="${camera}"]').click()`);
    assert.equal(await evaluate(`ZuglakApp.view3d().getCameraMode()`), camera);
  }
  await sleep(1500);
  await capture('zuglak-2.0-3d.png');
  await evaluate(`ZuglakApp.setView('2d')`);
  pass('3D nézet: azonos adatmodell, kamerák, élő szinkron');

  // ---------- Materials
  const vertices = JSON.stringify(geometry.vertices);
  await evaluate(`ZuglakApp.select(null)`);
  await evaluate(`document.querySelectorAll('#inspector .swatches')[0].children[3].click()`);
  state = await plan();
  assert.equal(state.rooms.room1.variants.Alap.materials.floor, 'floor-walnut');
  assert.equal(JSON.stringify(state.rooms.room1.geometries.find(g => g.id === state.rooms.room1.activeGeometryId).vertices), vertices, 'floor change never touches geometry');
  await evaluate(`ZuglakApp.select(JSON.parse(localStorage.getItem('zuglak-v3')).rooms.room1.variants.Alap.items[0].id)`);
  await evaluate(`[...document.querySelectorAll('#inspector .slot')][0].querySelectorAll('.swatch')[5].click()`);
  assert.ok((await plan()).rooms.room1.variants.Alap.items[0].materials.primary);
  pass('anyagok: padló, kárpit');

  // ---------- Variants & versions
  await evaluate(`document.querySelector('.rail [data-tab="variants"]').click()`);
  await evaluate(`document.querySelector('#duplicateVariant').click()`);
  state = await plan();
  const variantNames = Object.keys(state.rooms.room1.variants);
  assert.equal(variantNames.length, 2);
  const copyName = state.rooms.room1.active;
  assert.notEqual(copyName, 'Alap');
  await evaluate(`(() => { const item = ZuglakApp.data().rooms.room1.variants[ZuglakApp.data().rooms.room1.active].items[0]; item.x += 50; ZuglakApp.commit('t'); })()`);
  state = await plan();
  assert.notEqual(state.rooms.room1.variants[copyName].items[0].x, state.rooms.room1.variants.Alap.items[0].x);
  await evaluate(`document.querySelector('#saveVersion').click()`);
  await waitFor(`document.querySelector('#dialog').open`);
  await closeDialogOk();
  await waitFor(`JSON.parse(localStorage.getItem('zuglak-v3')).rooms.room1.variants[${JSON.stringify(copyName)}].versions.length === 1`);
  const savedX = (await plan()).rooms.room1.variants[copyName].items[0].x;
  await evaluate(`(() => { const item = ZuglakApp.data().rooms.room1.variants[ZuglakApp.data().rooms.room1.active].items[0]; item.x += 30; ZuglakApp.commit('t2'); })()`);
  await evaluate(`ZuglakApp.select(null); document.querySelector('.rail [data-tab="variants"]').click()`);
  await evaluate(`[...document.querySelectorAll('#versionList .button')].find(b => b.textContent.includes('Visszaállítás')).click()`);
  await waitFor(`document.querySelector('#dialog').open`);
  await closeDialogOk();
  await waitFor(`Math.abs(JSON.parse(localStorage.getItem('zuglak-v3')).rooms.room1.variants[${JSON.stringify(copyName)}].items[0].x - ${savedX}) < 1e-6`);
  await evaluate(`document.querySelector('#compareVariants').click()`);
  await waitFor(`document.querySelector('#compareDialog').open`);
  await evaluate(`document.querySelector('#compareDialog').close()`);
  pass('változatok: másolat, független elrendezés, pillanatkép és visszaállítás, összevetés');

  // ---------- IKEA import (1.x behaviour preserved)
  await evaluate(`document.querySelector('#importIkea').click()`);
  await evaluate(`(() => { document.querySelector('#ikeaUrl').value = 'https://www.ikea.com/hu/hu/p/kivik-3-szemelyes-kanape-tibbleby-bezs-szuerke-s49440597/'; document.querySelector('#resolveIkea').click(); })()`);
  assert.deepEqual(await evaluate(`({ width: document.querySelector('#ikeaWidth').value, depth: document.querySelector('#ikeaDepth').value, locked: document.querySelector('#ikeaWidth').readOnly })`), { width: '228', depth: '95', locked: true });
  await evaluate(`document.querySelector('#ikeaImportOk').click()`);
  state = await plan();
  item = state.rooms.room1.variants[state.rooms.room1.active].items.at(-1);
  assert.deepEqual({ source: item.source, w: item.w, h: item.h, original: item.originalDimensions, status: item.dimensionStatus }, { source: 'ikea', w: 228, h: 95, original: { width: 228, depth: 95, height: 83 }, status: 'verified' });
  await evaluate(`document.querySelector('#importIkea').click()`);
  await evaluate(`(() => { document.querySelector('#ikeaUrl').value = 'https://www.ikea.com/hu/hu/p/teszt-polc-12345678/'; document.querySelector('#resolveIkea').click(); })()`);
  assert.equal(await evaluate(`document.querySelector('#ikeaWidth').readOnly`), false);
  await evaluate(`document.querySelector('#ikeaForm').dispatchEvent(new SubmitEvent('submit', { cancelable: true, submitter: document.querySelector('#ikeaImportOk') }))`);
  assert.match(await evaluate(`document.querySelector('#ikeaImportStatus').textContent`), /szélesség megadása kötelező/i);
  await evaluate(`(() => { document.querySelector('#ikeaWidth').value = '111.5'; document.querySelector('#ikeaDepth').value = '44'; document.querySelector('#ikeaForm').dispatchEvent(new SubmitEvent('submit', { cancelable: true, submitter: document.querySelector('#ikeaImportOk') })); })()`);
  state = await plan();
  item = state.rooms.room1.variants[state.rooms.room1.active].items.at(-1);
  assert.deepEqual({ w: item.w, h: item.h, original: item.originalDimensions }, { w: 111.5, h: 44, original: { width: 111.5, depth: 44 } });
  assert.equal(await evaluate(`document.querySelectorAll('#inspector input[data-key="w"]:disabled').length`), 1, 'IKEA dimensions are locked by default');
  pass('IKEA-import: ismert termék zárolt méretekkel, ismeretlen termék kötelező kézi méretekkel');

  // ---------- Dialogs always closable; Enter confirms; stale IKEA result cleared
  const centerOf = async selector => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const pressEnter = async () => { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); };
  const liveItemCount = async () => evaluate(`ZuglakApp.state().items.length`);
  // unknown IKEA product with empty required fields → real click on "Mégse" must close
  await evaluate(`document.querySelector('#importIkea').click()`);
  await evaluate(`(() => { document.querySelector('#ikeaUrl').value = 'https://www.ikea.com/hu/hu/p/teszt-szekreny-87654321/'; document.querySelector('#resolveIkea').click(); })()`);
  assert.equal(await evaluate(`document.querySelector('#ikeaManualFields').hidden`), false);
  await clickAt(await centerOf('#ikeaDialog button[value="cancel"]'));
  await waitFor(`!document.querySelector('#ikeaDialog').open`);
  // the empty URL field must not block closing either
  await evaluate(`document.querySelector('#importIkea').click()`);
  await clickAt(await centerOf('#ikeaDialog button[value="cancel"]'));
  await waitFor(`!document.querySelector('#ikeaDialog').open`);
  // editing the link after a successful check must invalidate the recognised product
  await evaluate(`document.querySelector('#importIkea').click()`);
  await evaluate(`(() => { document.querySelector('#ikeaUrl').value = 'https://www.ikea.com/hu/hu/p/kivik-3-szemelyes-kanape-tibbleby-bezs-szuerke-s49440597/'; document.querySelector('#resolveIkea').click(); })()`);
  await evaluate(`(() => { const input = document.querySelector('#ikeaUrl'); input.value = 'https://www.ikea.com/hu/hu/p/teszt-szekreny-87654321/'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.equal(await evaluate(`document.querySelector('#ikeaImportOk').disabled`), true, 'stale IKEA result cleared');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(`!document.querySelector('#ikeaDialog').open`);
  // prompt dialog: invalid value + "Rendben" shows a Hungarian error and stays open; "Mégse" closes
  let countBefore = await liveItemCount();
  await evaluate(`document.querySelector('#customFurniture').click()`);
  await waitFor(`document.querySelector('#dialog').open`);
  await evaluate(`document.querySelector('#dialogFields input[name="w"]').value = '0'`);
  await clickAt(await centerOf('#dialogOk'));
  assert.equal(await evaluate(`document.querySelector('#dialog').open`), true);
  assert.match(await evaluate(`document.querySelector('#dialogError').textContent`), /Szélesség: legalább 0,1/);
  await clickAt(await centerOf('#dialog button[value="cancel"]'));
  await waitFor(`!document.querySelector('#dialog').open`);
  assert.equal(await liveItemCount(), countBefore);
  // Enter confirms (it used to trigger the first button, "Mégse")
  await evaluate(`document.querySelector('#customFurniture').click()`);
  await waitFor(`document.querySelector('#dialog').open`);
  await evaluate(`document.querySelector('#dialogFields input[name="name"]').focus()`);
  await pressEnter();
  await waitFor(`!document.querySelector('#dialog').open`);
  await waitFor(`ZuglakApp.state().items.length === ${countBefore + 1}`); // Enter added the custom furniture
  await evaluate(`document.querySelector('#undo').click()`);
  await waitFor(`ZuglakApp.state().items.length === ${countBefore}`);
  // read-only dialogs close on a backdrop click
  await evaluate(`document.querySelector('#exportButton').click()`);
  await waitFor(`document.querySelector('#exportDialog').open`);
  await clickAt({ x: 8, y: 8 });
  await waitFor(`!document.querySelector('#exportDialog').open`);
  pass('párbeszédablakok: Mégse/Esc mindig zár, Enter jóváhagy, magyar hibaüzenet, elavult IKEA-találat törlődik');

  // ---------- AI tervező (mocked Anthropic API – no network, no real key)
  await evaluate(`(() => {
    const kritter = 'ikea-691.854.35';
    const bad = { variant_name: 'AI – három lány', summary: 'Három ágy, tanulósarok.', items: [
      { product_key: kritter, center_x: 372.5, center_y: 237.5, rotation: 90, name: 'Ágy – Anna', reason: 'ablak mellett' },
      { product_key: kritter, center_x: 372.5, center_y: 290, rotation: 90, name: 'Ágy – Bori' },
      { product_key: kritter, center_x: 300, center_y: 516.5, rotation: 180, name: 'Ágy – Cili' },
      { product_key: 'g-desk-27', center_x: 192, center_y: 325, rotation: 270 },
      { custom: { name: 'Emeletes ágy', model: 'bed', width: 98, depth: 208, height: 165 }, center_x: 120, center_y: 560, rotation: 0 }
    ] };
    const good = JSON.parse(JSON.stringify(bad));
    good.items[1].center_y = 330;
    good.items.pop();
    window.__aiQueue = [
      { status: 200, sse: [
        { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 9000, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Három ágy kell…' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Három ágy a tömör ' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'falaknál.' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu1', name: 'propose_layout', input: {} } },
        ...JSON.stringify(bad).match(/[\\s\\S]{1,25}/g).map(part => ({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: part } })),
        { type: 'content_block_stop', index: 2 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 900 } },
        { type: 'message_stop' }
      ] },
      { status: 200, body: { content: [{ type: 'tool_use', id: 'tu2', name: 'propose_layout', input: good }], stop_reason: 'tool_use', usage: { input_tokens: 9500, output_tokens: 600 } } }
    ];
    window.__aiCalls = [];
    window.fetch = async (url, init) => {
      window.__aiCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      const next = window.__aiQueue.shift();
      if (!next) throw new TypeError('no mock');
      if (next.sse) return new Response(next.sse.map(event => 'event: ' + event.type + '\\ndata: ' + JSON.stringify(event) + '\\n\\n').join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      return { ok: next.status < 400, status: next.status, json: async () => next.body };
    };
  })()`);
  await evaluate(`document.querySelector('.rail [data-tab="ai"]').click()`);
  assert.equal(await evaluate(`document.querySelector('#aiSettings').hidden`), false, 'settings open without a key');
  await evaluate(`(() => { document.querySelector('#aiKey').value = 'sk-ant-api03-TESTKEYTESTKEYTESTKEY1234'; document.querySelector('#aiKeySave').click(); })()`);
  assert.equal(await evaluate(`localStorage.getItem('zuglak-ai-key')`), 'sk-ant-api03-TESTKEYTESTKEYTESTKEY1234');
  const variantsBeforeAi = await evaluate(`Object.keys(JSON.parse(localStorage.getItem('zuglak-v3')).rooms[ZuglakApp.state().roomId].variants).length`);
  const userVariant = await evaluate(`ZuglakApp.state().variant`);
  await evaluate(`(() => { document.querySelector('#aiInput').value = 'Három kislány szobája'; document.querySelector('#aiSend').click(); })()`);
  await waitFor(`ZuglakApp.state().variant === 'AI – három lány' && document.querySelector('#aiStop').hidden`);
  let aiState = await evaluate(`({ calls: window.__aiCalls.length, items: ZuglakApp.state().items, warnings: ZuglakApp.state().warnings, headers: window.__aiCalls[0].headers, fix: window.__aiCalls[1].body.messages.at(-1).content[0] })`);
  assert.equal(aiState.calls, 2, 'one automatic fix round');
  assert.equal(aiState.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(aiState.fix.tool_use_id, 'tu1');
  assert.equal(await evaluate(`window.__aiCalls[0].body.stream`), true);
  assert.equal(await evaluate(`window.__aiCalls[1].body.messages.at(-2).content[0].type`), 'thinking', 'thinking block is passed back unchanged');
  assert.match(aiState.fix.content, /átfedésben/);
  assert.equal(aiState.items.length, 4);
  await waitFor(`ZuglakApp.state().warnings.length === 0`); // recomputed on the next frame
  assert.equal(aiState.items.filter(item => item.productId === '691.854.35').length, 3);
  assert.equal(await evaluate(`Object.keys(JSON.parse(localStorage.getItem('zuglak-v3')).rooms[ZuglakApp.state().roomId].variants).length`), variantsBeforeAi + 1, 'saved as a new variant');
  assert.match(await evaluate(`document.querySelector('#aiLog .ai-card strong').textContent`), /Új változat: „AI – három lány” · 4 bútor/);
  // the result is an ordinary editable layout: select + nudge one bed
  const annaId = aiState.items.find(item => item.name === 'Ágy – Anna').id;
  await evaluate(`ZuglakApp.select(${JSON.stringify(annaId)})`);
  await evaluate(`document.activeElement?.blur()`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, modifiers: 8 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, modifiers: 8 });
  await waitFor(`ZuglakApp.state().items.find(item => item.id === ${JSON.stringify(annaId)}).x < ${aiState.items.find(item => item.id === annaId).x - 9}`);
  // follow-up: modify in place, keeping existing ids; the tool_result for tu2 is sent first
  const keep = aiState.items.filter(item => item.name !== 'Ágy – Cili').map(item => item.id);
  await evaluate(`(() => {
    const items = ZuglakApp.state().items;
    const center = id => { const it = items.find(v => v.id === id); const r = it.rot * Math.PI / 180; return { x: it.x + Math.cos(r) * it.w / 2 - Math.sin(r) * it.h / 2, y: it.y + Math.sin(r) * it.w / 2 + Math.cos(r) * it.h / 2 }; };
    const base = ${JSON.stringify(await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('zuglak-v3')); const r = s.rooms[s.currentRoom]; const g = r.geometries.find(v => v.id === r.activeGeometryId); return { x: Math.min(...g.vertices.map(v => v.x)), y: Math.min(...g.vertices.map(v => v.y)) }; })()`))};
    const keep = ${JSON.stringify(keep)};
    const input = { summary: 'Cili ágya helyett komód.', items: keep.map(id => ({ existing_id: id, center_x: center(id).x - base.x, center_y: center(id).y - base.y, rotation: items.find(v => v.id === id).rot })).concat([{ product_key: 'g-dresser-24', center_x: 300, center_y: 575, rotation: 180 }]) };
    window.__aiQueue.push({ status: 200, body: { content: [{ type: 'text', text: 'Rendben, komód került az ágy helyére.' }, { type: 'tool_use', id: 'tu3', name: 'propose_layout', input }], stop_reason: 'tool_use', usage: { input_tokens: 12000, output_tokens: 500 } } });
    document.querySelector('#aiInput').value = 'Cili ágya helyett legyen komód';
    document.querySelector('#aiSend').click();
  })()`);
  await waitFor(`ZuglakApp.state().items.some(item => item.name === 'Komód') && document.querySelector('#aiStop').hidden`);
  aiState = await evaluate(`({ variant: ZuglakApp.state().variant, items: ZuglakApp.state().items, sent: window.__aiCalls[2].body.messages.at(-1).content })`);
  assert.equal(aiState.variant, 'AI – három lány', 'modified in place');
  assert.deepEqual(aiState.sent[0], { type: 'tool_result', tool_use_id: 'tu2', content: aiState.sent[0].content });
  assert.match(aiState.sent[1].text, /Aktív változat: „AI – három lány”/);
  assert.deepEqual(keep.every(id => aiState.items.some(item => item.id === id)), true, 'existing ids kept');
  assert.equal(aiState.items.length, 4);
  assert.equal(await evaluate(`Object.keys(JSON.parse(localStorage.getItem('zuglak-v3')).rooms[ZuglakApp.state().roomId].variants).length`), variantsBeforeAi + 1);
  // invalid key: Hungarian error, history rolled back, layout untouched
  const apiLengthBefore = await evaluate(`JSON.parse(localStorage.getItem('zuglak-ai-v1')).chats[ZuglakApp.state().roomId].api.length`);
  await evaluate(`(() => { window.__aiQueue.push({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }); document.querySelector('#aiInput').value = 'még egy'; document.querySelector('#aiSend').click(); })()`);
  await waitFor(`document.querySelector('#aiLog .ai-msg.error') && document.querySelector('#aiStop').hidden`);
  assert.match(await evaluate(`document.querySelector('#aiLog .ai-msg.error').textContent`), /Érvénytelen API-kulcs/);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('zuglak-ai-v1')).chats[ZuglakApp.state().roomId].api.length`), apiLengthBefore);
  assert.equal(await evaluate(`ZuglakApp.state().items.length`), 4);
  // Ctrl+Z restores the previous AI layout step; the user's own variant was never touched
  assert.ok((await evaluate(`Object.keys(JSON.parse(localStorage.getItem('zuglak-v3')).rooms[ZuglakApp.state().roomId].variants)`)).includes(userVariant));
  // IKEA: unknown product → "read with AI" fills editable fields
  await evaluate(`(() => {
    window.__aiQueue.push({ status: 200, body: { stop_reason: 'tool_use', usage: { input_tokens: 8000, output_tokens: 80 }, content: [
      { type: 'server_tool_use', id: 's1', name: 'web_fetch', input: { url: 'x' } },
      { type: 'tool_use', id: 'r1', name: 'report_product', input: { found: true, name: 'TESZT szekrény', product_id: '876.543.21', width: 80.5, depth: 40, height: 120, category: 'storage' } }
    ] } });
    document.querySelector('#importIkea').click();
    document.querySelector('#ikeaUrl').value = 'https://www.ikea.com/hu/hu/p/teszt-szekreny-87654321/';
    document.querySelector('#resolveIkea').click();
  })()`);
  assert.equal(await evaluate(`document.querySelector('#ikeaAiRow').hidden || document.querySelector('#ikeaAiRead').disabled`), false);
  await evaluate(`document.querySelector('#ikeaAiRead').click()`);
  await waitFor(`document.querySelector('#ikeaWidth').value === '80.5'`);
  assert.deepEqual(await evaluate(`({ d: document.querySelector('#ikeaDepth').value, h: document.querySelector('#ikeaHeight').value, ro: document.querySelector('#ikeaWidth').readOnly, status: document.querySelector('#ikeaImportStatus').textContent })`).then(v => ({ ...v, status: /ellenőrizd/.test(v.status) })), { d: '40', h: '120', ro: false, status: true });
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(`!document.querySelector('#ikeaDialog').open`);
  await evaluate(`document.querySelector('.rail [data-tab="variants"]').click()`);
  await evaluate(`[...document.querySelectorAll('#variantList .variant-card')].find(card => card.querySelector('strong').textContent === ${JSON.stringify(userVariant)}).querySelector('.info').click()`);
  await waitFor(`ZuglakApp.state().variant === ${JSON.stringify(userVariant)}`);
  await evaluate(`document.querySelector('.rail [data-tab="catalog"]').click()`);
  await evaluate(`ZuglakApp.select(null)`);
  assert.equal(await evaluate(`/\\$|költség|USD/.test(document.querySelector('[data-panel="ai"]').textContent + document.querySelector('#ikeaImportStatus').textContent)`), false, 'no money shown anywhere');
  pass('AI tervező: kulcs, automatikus ütközésjavítás, új szerkeszthető változat, helyben módosítás, hibaüzenet, IKEA-beolvasás');

  // ---------- Protected architecture editing
  await evaluate(`ZuglakApp.select(null); document.querySelector('.rail [data-tab="room"]').click()`);
  await evaluate(`document.querySelector('#editArchitecture').click()`);
  await waitFor(`document.querySelector('#dialog').open`);
  await closeDialogOk();
  await waitFor(`ZuglakApp.state().mode === 'walls'`);
  const g = (await plan()).rooms.room1.geometries.find(value => value.source === 'plan');
  const mid = { x: (g.vertices[0].x + g.vertices[1].x) / 2, y: (g.vertices[0].y + g.vertices[1].y) / 2 };
  await clickAt(await canvasPoint(mid));
  await waitFor(`!!document.querySelector('#inspector input[type=number]')`);
  assert.match(await evaluate(`document.querySelector('#inspector').textContent`), /tervrajzon szereplő méret: 250 cm/);
  await evaluate(`[...document.querySelectorAll('#inspector .button')].find(b => b.textContent.includes('Kézi mérés szerinti 220')).click()`);
  state = await plan();
  const updated = state.rooms.room1.geometries.find(value => value.source === 'plan');
  assert.ok(Math.abs(Math.hypot(updated.vertices[1].x - updated.vertices[0].x, updated.vertices[1].y - updated.vertices[0].y) - 220) < 1e-6);
  assert.equal(updated.confirmedWalls[0], true);
  await evaluate(`document.querySelector('#undo').click()`);
  assert.ok(Math.abs((await plan()).rooms.room1.geometries.find(value => value.source === 'plan').vertices[1].x - g.vertices[1].x) < 1e-6, 'wall edit is undoable');
  await evaluate(`document.querySelector('[data-arch-tool="door"]').click()`);
  const wallMid = { x: (g.vertices[2].x + g.vertices[3].x) / 2, y: (g.vertices[2].y + g.vertices[3].y) / 2 };
  const objectsBefore = g.objects.length;
  await clickAt(await canvasPoint(wallMid));
  state = await plan();
  const door = state.rooms.room1.geometries.find(value => value.source === 'plan').objects.at(-1);
  assert.equal(state.rooms.room1.geometries.find(value => value.source === 'plan').objects.length, objectsBefore + 1);
  assert.deepEqual({ type: door.type, width: door.width, wall: door.wallIndex }, { type: 'door', width: 90, wall: 2 });
  await evaluate(`document.querySelector('#finishArchitecture').click()`);
  assert.equal(await evaluate(`ZuglakApp.state().mode`), 'furnish');
  pass('védett szerkezet: terv és kézi mérés, visszavonás, ajtó elhelyezése');

  // ---------- Exports (first as a real browser download, then the generated blobs)
  await evaluate(`(() => { window.__blobs = []; const original = URL.createObjectURL; URL.createObjectURL = blob => { window.__blobs.push(blob); return original.call(URL, blob); }; })()`);
  await evaluate(`document.querySelector('#exportButton').click()`);
  await evaluate(`document.querySelector('#exportKind [data-kind="png2d"]').click()`);
  await evaluate(`document.querySelector('#exportQuality').value = '1'`);
  const clickElement = async selector => {
    const box = await evaluate(`(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await clickAt(box);
  };
  await clickElement('#exportRun');
  const waitFile = async extension => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const file = readdirSync(downloads).find(name => name.endsWith(extension));
      if (file) return join(downloads, file);
      await sleep(150);
    }
    throw new Error(`Hiányzó export: ${extension}`);
  };
  const png = readFileSync(await waitFile('.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.ok(png.readUInt32BE(16) >= 2400, 'high-resolution PNG');
  const blobBytes = async type => Buffer.from(await evaluate(`(async () => { const blob = [...window.__blobs].reverse().find(b => b.type === '${type}'); const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); })()`), 'base64');
  await evaluate(`document.querySelector('#exportKind [data-kind="pdf2d"]').click()`);
  await sleep(300);
  await clickElement('#exportRun');
  await waitFor(`window.__blobs.some(b => b.type === 'application/pdf')`, 30000);
  const pdf = await blobBytes('application/pdf');
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
  assert.match(pdf.subarray(-8).toString(), /%%EOF/);
  assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 1190\.55 841\.89\]/, 'A3 landscape page');
  await evaluate(`document.querySelector('#exportKind [data-kind="png3d"]').click()`);
  await sleep(500);
  await clickElement('#exportRun');
  await waitFor(`window.__blobs.some(b => b.type === 'image/png' && b.size > 300000 && b !== window.__blobs.find(x => x.type === 'image/png'))`, 60000);
  const png3d = Buffer.from(await evaluate(`(async () => { const blob = window.__blobs.filter(b => b.type === 'image/png').slice(1).sort((p, q) => q.size - p.size)[0]; const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); })()`), 'base64');
  assert.equal(png3d.subarray(1, 4).toString(), 'PNG');
  assert.ok(png3d.readUInt32BE(16) >= 1600, '3D capture at export resolution');
  await evaluate(`document.querySelector('#exportDialog').close()`);
  pass('export: nagy felbontású 2D PNG, A3 PDF és 3D kép');

  // ---------- Persistence & presentation
  const itemCount = (await plan()).rooms.room1.variants[copyName].items.length;
  await call('Page.reload', { ignoreCache: true });
  await waitFor(`document.readyState !== 'loading' && !!window.ZuglakApp && document.querySelectorAll('.catalog-card').length > 50`);
  assert.equal(await evaluate(`ZuglakApp.state().variant`), copyName);
  assert.equal(await evaluate(`ZuglakApp.state().items.length`), itemCount);
  assert.equal(await evaluate(`document.querySelector('#favoriteCount').textContent`), '3', '1 kedvenc + 2 importált termék');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'p', code: 'KeyP', text: 'p' });
  assert.equal(await evaluate(`document.body.classList.contains('presenting')`), true);
  await sleep(400);
  assert.ok(await evaluate(`document.querySelector('.stage').getBoundingClientRect().width === innerWidth`), 'presentation uses the full window');
  assert.ok(await evaluate(`document.querySelector('#presentationCaption').getBoundingClientRect().top > 0`));
  await capture('zuglak-2.0-presentation.png');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  assert.equal(await evaluate(`document.body.classList.contains('presenting')`), false);
  await capture('zuglak-2.0-desktop.png');
  pass('mentés újratöltés után, bemutató mód');

  // ---------- 1.x migration (pixels → centimetres, original key untouched)
  const legacy = {
    version: 2, currentRoom: 'room1',
    rooms: {
      room1: { name: 'Régi', pxPerCm: 884 / 440, active: 'Alap', variants: { Alap: { items: [{ id: 'old', type: 'sofa', name: 'Régi kanapé', w: 220, h: 95, rot: 0, x: 600, y: 700 }] } }, geometries: [], activeGeometryId: null },
      room2: { name: 'B', pxPerCm: 219 / 102, active: 'Alap', variants: { Alap: { items: [] } }, geometries: [], activeGeometryId: null },
      room3: { name: 'C', pxPerCm: 126 / 20, active: 'Alap', variants: { Alap: { items: [] } }, geometries: [], activeGeometryId: null }
    }
  };
  await evaluate(`(() => { localStorage.removeItem('zuglak-v3'); localStorage.setItem('zuglak-v2', ${JSON.stringify(JSON.stringify(legacy))}); })()`);
  await call('Page.reload', { ignoreCache: true });
  await waitFor(`document.readyState !== 'loading' && !!window.ZuglakApp`);
  await sleep(400);
  const migrated = await plan();
  const old = migrated.rooms.room1.variants.Alap.items[0];
  assert.ok(Math.abs(old.x - 600 / (884 / 440)) < 1e-9 && Math.abs(old.y - 700 / (884 / 440)) < 1e-9);
  assert.equal(await evaluate(`localStorage.getItem('zuglak-v2')`), JSON.stringify(legacy));
  assert.equal(migrated.rooms.room1.name, 'Régi', 'user room names are kept');
  assert.equal(migrated.rooms.room2.name, 'B');
  assert.equal(migrated.rooms.room4.name, 'SZOBA I.', 'the 4th room is added to old data');
  pass('1.x adat migrációja: képpont → centiméter, az eredeti kulcs érintetlen');

  // ---------- Tablet layout
  await call('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  await evaluate(`document.querySelector('.rail [data-tab="materials"]').click()`);
  await sleep(400);
  assert.ok(await evaluate(`document.querySelector('.sidebar.left .panel').getBoundingClientRect().left >= 60`), 'tablet panel slides in from the rail');
  // The first synthetic input right after a viewport emulation change can be dropped by headless Chrome.
  for (let attempt = 0; attempt < 3 && await evaluate(`document.body.classList.contains('panel-open')`); attempt += 1) {
    await clickAt({ x: 600, y: 700 });
    await sleep(300);
  }
  assert.ok(await evaluate(`document.querySelector('.stage').getBoundingClientRect().width >= 700`));
  assert.equal(await evaluate(`document.body.classList.contains('panel-open')`), false, 'tapping the plan tucks the tablet panel away');
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.sidebar.left .panel')).transform`), 'none');
  await capture('zuglak-2.0-tablet.png');
  pass('tablet elrendezés');

  assert.deepEqual(errors, [], 'no uncaught page errors');
  console.log('UI smoke: minden ellenőrzés sikeres.');
} catch (error) {
  console.error(`Hiba ennél a lépésnél: ${step}`);
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (chrome.exitCode === null) chrome.kill();
  await browserExit;
  await new Promise(resolve => server.close(resolve));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(downloads, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
