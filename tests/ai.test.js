'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const Geometry = require('../geometry.js');
const Floorplans = require('../floorplans.js');
const Catalog = require('../catalog.js');
const AI = require('../ai.js');

let counter = 0;
const ids = () => `ai${++counter}`;
const offset = { x: 37, y: 52 }; // a non-zero world offset, like a seeded plan geometry
const geom = Floorplans.buildPlanGeometry(Floorplans.plans[0], ids, offset);
const productByKey = key => Catalog.all.find(value => value.key === key);
const deps = extra => ({ Core, Catalog, Geometry, idFactory: ids, productByKey, existingItems: [], ...extra });

test('room brief: room-relative coordinates, walls, openings and back-to-wall rotation', () => {
  const { base, brief } = AI.buildRoomBrief({ roomName: 'Lányszoba', geom, items: [], Geometry, Catalog });
  assert.equal(brief.befoglalo.szelesseg, 456);
  assert.equal(brief.befoglalo.melyseg, 600);
  assert.ok(Math.abs(base.x - geom.vertices.reduce((m, v) => Math.min(m, v.x), Infinity)) < 1e-9);
  assert.deepEqual(brief.sokszog[0], [206, 0]);
  const top = brief.falak.find(wall => wall.fal === 1);
  assert.equal(top.hattal_a_falnak_forgatas, 0);
  assert.equal(brief.falak.find(wall => wall.fal === 2).hattal_a_falnak_forgatas, 90);
  assert.equal(brief.falak.find(wall => wall.fal === 3).hattal_a_falnak_forgatas, 180);
  assert.equal(brief.falak.find(wall => wall.fal === 4).hattal_a_falnak_forgatas, 270);
  const door = brief.nyilaszarok.find(value => value.tipus === 'ajtó');
  assert.ok(door.nyitasi_ter && door.nyitasi_ter.x2 > door.nyitasi_ter.x1);
  assert.equal(brief.nyilaszarok.filter(value => value.tipus === 'ablak').length, 2);
});

test('catalogue table lists every product key once', () => {
  const table = AI.catalogTable(Catalog.all);
  for (const product of Catalog.all) assert.ok(table.includes(`${product.key} |`), product.key);
});

test('layout tool input becomes ordinary editable items at the right place', () => {
  const { base } = AI.buildRoomBrief({ roomName: 'x', geom, items: [], Geometry, Catalog });
  // KRITTER (75 × 165) with its back (head end) against the right wall: rotation 90.
  const input = { summary: 's', items: [
    { product_key: 'ikea-691.854.35', center_x: 456 - 1 - 165 / 2, center_y: 300, rotation: 90, name: 'Ágy – Panni' },
    { custom: { name: 'Emeletes ágy 90 × 200', model: 'bed', width: 98, depth: 208, height: 165 }, center_x: 300, center_y: 600 - 1 - 49, rotation: 270 }
  ] };
  const built = AI.buildLayoutItems(input, deps({ base }));
  assert.deepEqual(built.errors, []);
  const [bed, bunk] = built.items;
  assert.equal(bed.name, 'Ágy – Panni');
  assert.equal(bed.source, 'ikea');
  assert.equal(bed.rot, 90);
  const center = Geometry.itemCenter(bed);
  assert.ok(Math.abs(center.x - (base.x + 456 - 1 - 82.5)) < 1e-6 && Math.abs(center.y - (base.y + 300)) < 1e-6);
  assert.equal(bunk.dimensionStatus, 'typical');
  assert.equal(bunk.aiSuggested, true);
  assert.equal(bunk.height, 165);
  assert.deepEqual(AI.analyzeLayout(built.items, geom, { Geometry, Catalog }), []);
});

test('unknown keys and ids are reported instead of silently dropped', () => {
  const built = AI.buildLayoutItems({ items: [
    { product_key: 'ikea-000.000.00', center_x: 10, center_y: 10, rotation: 0 },
    { existing_id: 'nope', center_x: 10, center_y: 10, rotation: 0 },
    { center_x: 10, center_y: 10, rotation: 0 }
  ] }, deps({ base: { x: 0, y: 0 } }));
  assert.equal(built.items.length, 0);
  assert.equal(built.errors.length, 3);
  assert.match(built.errors[0], /ismeretlen product_key/);
});

test('existing items keep their settings; ids are kept only inside the same variant', () => {
  const existing = { ...Core.createGenericItem(productByKey('g-desk-27'), { x: 0, y: 0 }, ids), materials: { primary: 'oak-light' } };
  const input = { items: [{ existing_id: existing.id, center_x: 300, center_y: 100, rotation: 0 }] };
  const same = AI.buildLayoutItems(input, deps({ base: { x: 0, y: 0 }, existingItems: [existing], keepIds: true }));
  assert.equal(same.items[0].id, existing.id);
  assert.equal(same.items[0].materials.primary, 'oak-light');
  const copy = AI.buildLayoutItems(input, deps({ base: { x: 0, y: 0 }, existingItems: [existing], keepIds: false }));
  assert.notEqual(copy.items[0].id, existing.id);
  assert.equal(existing.x, 0, 'the source item is not mutated');
});

test('analyzeLayout finds wall, overlap and door problems; desk + chair is allowed', () => {
  const { base } = AI.buildRoomBrief({ roomName: 'x', geom, items: [], Geometry, Catalog });
  const built = AI.buildLayoutItems({ items: [
    { product_key: 'g-wardrobe-20', center_x: 440, center_y: 300, rotation: 90 },            // 60 deep, centre 16 cm from the wall → outside
    { product_key: 'g-dresser-24', center_x: 300, center_y: 400, rotation: 0 },
    { product_key: 'g-dresser-24', center_x: 320, center_y: 410, rotation: 0 },             // overlaps the first dresser
    { product_key: 'g-bookcase-22', center_x: 40, center_y: 545, rotation: 0 },              // in the door swing
    { product_key: 'g-desk-27', center_x: 300, center_y: 31, rotation: 0 },
    { product_key: 'g-office-chair-28', center_x: 300, center_y: 60, rotation: 0 }          // under the desk: fine
  ] }, deps({ base }));
  const types = AI.analyzeLayout(built.items, geom, { Geometry, Catalog }).map(issue => issue.type).sort();
  assert.deepEqual(types, ['boundary', 'door', 'furniture']);
  const report = AI.issueReport(built, AI.analyzeLayout(built.items, geom, { Geometry, Catalog }), base, Geometry);
  assert.match(report, /sarkai: \(/);
});

function fakeFetch(responses, calls = []) {
  return async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (!next) throw new Error('no more fake responses');
    return { ok: (next.status || 200) < 400, status: next.status || 200, json: async () => next.body };
  };
}

test('runLayoutTurn: sends browser headers + cached catalogue, fixes collisions once, then accepts', async () => {
  const { base, brief } = AI.buildRoomBrief({ roomName: 'Lányszoba', geom, items: [], Geometry, Catalog });
  const bad = { summary: 'x', items: [
    { product_key: 'g-dresser-24', center_x: 300, center_y: 400, rotation: 0 },
    { product_key: 'g-dresser-24', center_x: 320, center_y: 400, rotation: 0 }
  ] };
  const good = { summary: 'x', variant_name: 'AI – teszt', items: [
    { product_key: 'g-dresser-24', center_x: 300, center_y: 400, rotation: 0 },
    { product_key: 'g-dresser-24', center_x: 390, center_y: 400, rotation: 0 }
  ] };
  const calls = [];
  const fetch = fakeFetch([
    { body: { content: [{ type: 'text', text: 'Két komód kerül a falhoz.' }, { type: 'tool_use', id: 'tu1', name: 'propose_layout', input: bad }], stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 200 } } },
    { body: { content: [{ type: 'tool_use', id: 'tu2', name: 'propose_layout', input: good }], stop_reason: 'tool_use', usage: { input_tokens: 1200, output_tokens: 150 } } }
  ], calls);
  const messages = [];
  const evaluate = input => {
    const built = AI.buildLayoutItems(input, deps({ base }));
    const issues = AI.analyzeLayout(built.items, geom, { Geometry, Catalog });
    return { built, issues, report: AI.issueReport(built, issues, base, Geometry) };
  };
  const result = await AI.runLayoutTurn({ apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5', fetch, messages, catalogText: AI.catalogTable(Catalog.all), userContent: `${JSON.stringify(brief)}\nKérés: két komód`, evaluate });
  assert.equal(calls.length, 2);
  const headers = calls[0].init.headers;
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(headers['x-api-key'], 'sk-ant-test');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(calls[0].body.system.at(-1).cache_control.type, 'ephemeral');
  assert.equal(calls[0].body.tools[0].name, 'propose_layout');
  // The second request carries the collision report as a tool_result for tu1.
  const fixMessage = calls[1].body.messages.at(-1);
  assert.equal(fixMessage.content[0].tool_use_id, 'tu1');
  assert.match(fixMessage.content[0].content, /átfedésben/);
  assert.equal(result.proposal.input.variant_name, 'AI – teszt');
  assert.equal(result.proposal.issues.length, 0);
  assert.deepEqual(result.pendingToolUseIds, ['tu2']);
  assert.equal(result.text, 'Két komód kerül a falhoz.');
  assert.ok(result.cost > 0);

  // Next turn: the pending tool_use gets its tool_result before the new text (valid API history).
  const fetch2 = fakeFetch([{ body: { content: [{ type: 'text', text: 'Hány évesek a lányok?' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } }], calls);
  const second = await AI.runLayoutTurn({ apiKey: 'k', fetch: fetch2, messages, catalogText: '', userContent: 'és még?', evaluate, pendingToolUseIds: result.pendingToolUseIds });
  const sent = calls[2].body.messages.at(-1);
  assert.equal(sent.content[0].type, 'tool_result');
  assert.equal(sent.content[0].tool_use_id, 'tu2');
  assert.equal(second.proposal, null);
  assert.equal(second.text, 'Hány évesek a lányok?');
});

test('runLayoutTurn: gives up fixing after maxFixes and returns the proposal with its issues', async () => {
  const { base } = AI.buildRoomBrief({ roomName: 'x', geom, items: [], Geometry, Catalog });
  const bad = { summary: 'x', items: [
    { product_key: 'g-dresser-24', center_x: 300, center_y: 400, rotation: 0 },
    { product_key: 'g-dresser-24', center_x: 310, center_y: 400, rotation: 0 }
  ] };
  const reply = id => ({ body: { content: [{ type: 'tool_use', id, name: 'propose_layout', input: bad }], stop_reason: 'tool_use', usage: {} } });
  const evaluate = input => { const built = AI.buildLayoutItems(input, deps({ base })); const issues = AI.analyzeLayout(built.items, geom, { Geometry, Catalog }); return { built, issues, report: 'r' }; };
  const result = await AI.runLayoutTurn({ apiKey: 'k', fetch: fakeFetch([reply('a'), reply('b'), reply('c')]), messages: [], catalogText: '', userContent: 'x', evaluate, maxFixes: 2 });
  assert.equal(result.proposal.issues.length, 1);
  assert.deepEqual(result.pendingToolUseIds, ['c']);
});

test('API errors are translated to Hungarian', async () => {
  const run = status => AI.callClaude({ apiKey: 'k', messages: [], fetch: fakeFetch([{ status, body: { error: { message: status === 400 ? 'Your credit balance is too low' : 'x' } } }]) });
  await assert.rejects(run(401), /Érvénytelen API-kulcs/);
  await assert.rejects(run(400), /elfogyott a keret/);
  await assert.rejects(run(429), /Túl sok kérés/);
  await assert.rejects(run(529), /túlterhelt/);
  await assert.rejects(AI.callClaude({ apiKey: 'k', messages: [], fetch: async () => { throw new TypeError('Failed to fetch'); } }), /internetkapcsolat/);
  await assert.rejects(AI.callClaude({ apiKey: '', messages: [], fetch: async () => ({}) }), /Nincs megadva/);
});

test('readIkeaProduct: web_fetch limited to ikea.com, returns only page values', async () => {
  const calls = [];
  const fetch = fakeFetch([{ body: { stop_reason: 'tool_use', usage: { input_tokens: 9000, output_tokens: 100 }, content: [
    { type: 'server_tool_use', id: 'srv1', name: 'web_fetch', input: { url: 'https://www.ikea.com/hu/hu/p/kritter-agykeret-agyraccsal-feher-s69185435/' } },
    { type: 'web_fetch_tool_result', tool_use_id: 'srv1', content: { type: 'web_fetch_result', url: 'u', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '...' } } } },
    { type: 'tool_use', id: 't1', name: 'report_product', input: { found: true, name: 'KRITTER ágykeret ágyráccsal', product_id: '691.854.35', width: 75, depth: 165, height: 68, category: 'beds', notes: '70×160 matrac' } }
  ] } }], calls);
  const result = await AI.readIkeaProduct({ apiKey: 'k', url: 'https://www.ikea.com/hu/hu/p/kritter-agykeret-agyraccsal-feher-s69185435/', fetch });
  assert.deepEqual({ w: result.width, d: result.depth, h: result.height, id: result.productId }, { w: 75, d: 165, h: 68, id: '691.854.35' });
  const tool = calls[0].body.tools[0];
  assert.equal(tool.type, 'web_fetch_20250910');
  assert.deepEqual(tool.allowed_domains, ['www.ikea.com']);
  await assert.rejects(AI.readIkeaProduct({ apiKey: 'k', url: 'https://example.com/p/x', fetch }), /Csak IKEA/);
  const notFound = fakeFetch([{ body: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'report_product', input: { found: false, notes: 'Nincs méret.' } }] } }]);
  await assert.rejects(AI.readIkeaProduct({ apiKey: 'k', url: 'https://www.ikea.com/hu/hu/p/x-12345678/', fetch: notFound }), /Nincs méret/);
});

test('key storage helpers', () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  assert.equal(AI.loadKey(storage), '');
  AI.saveKey(storage, '  sk-ant-api03-abcdefghijklmnopqrstuvwxyz  ');
  assert.equal(AI.loadKey(storage), 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
  assert.ok(AI.looksLikeKey(AI.loadKey(storage)));
  assert.ok(!AI.looksLikeKey('hello'));
  AI.saveKey(storage, '');
  assert.equal(AI.loadKey(storage), '');
  assert.deepEqual(AI.loadState(storage).chats, {});
});

// ---------------------------------------------------------------- streaming (SSE)
function sseResponse(events, chunkSize = 37) {
  const text = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({
    start(controller) {
      for (let index = 0; index < bytes.length; index += chunkSize) controller.enqueue(bytes.slice(index, index + chunkSize));
      controller.close();
    }
  });
  return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, body };
}
function streamOf({ thinking = 'hmm', text = '', tool = null, stop = 'tool_use', truncateTool = false, outputTokens = 500 }) {
  const events = [{ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 1000, output_tokens: 1 } } }];
  let index = 0;
  if (thinking) {
    events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } },
      { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig' } },
      { type: 'content_block_stop', index });
    index += 1;
  }
  if (text) {
    events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index, delta: { type: 'text_delta', text: text.slice(0, 5) } },
      { type: 'content_block_delta', index, delta: { type: 'text_delta', text: text.slice(5) } },
      { type: 'content_block_stop', index });
    index += 1;
  }
  if (tool) {
    const json = JSON.stringify(tool.input);
    events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} } });
    const cut = truncateTool ? Math.floor(json.length / 2) : json.length;
    for (let at = 0; at < cut; at += 20) events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(at, Math.min(at + 20, cut)) } });
    if (!truncateTool) events.push({ type: 'content_block_stop', index });
  }
  events.push({ type: 'ping' }, { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: outputTokens } }, { type: 'message_stop' });
  return events;
}

test('callClaude streams: thinking, text and chunked tool JSON are reassembled', async () => {
  const input = { summary: 'ö', items: [{ product_key: 'g-desk-27', center_x: 100, center_y: 50, rotation: 0, reason: 'árvíztűrő tükörfúrógép' }] };
  let sentBody = null;
  const progress = new Set();
  const response = await AI.callClaude({
    apiKey: 'k', messages: [], onProgress: p => progress.add(p.phase),
    fetch: async (url, init) => { sentBody = JSON.parse(init.body); return sseResponse(streamOf({ text: 'Íme a terv.', tool: { id: 't1', name: 'propose_layout', input } }), 7); }
  });
  assert.equal(sentBody.stream, true);
  assert.deepEqual(response.content.map(block => block.type), ['thinking', 'text', 'tool_use']);
  assert.equal(response.content[0].signature, 'sig');
  assert.equal(response.content[1].text, 'Íme a terv.');
  assert.deepEqual(response.content[2].input, input);
  assert.equal(response.stop_reason, 'tool_use');
  assert.equal(response.usage.input_tokens, 1000);
  assert.equal(response.usage.output_tokens, 500);
  assert.deepEqual([...progress].sort(), ['text', 'thinking', 'tool']);
});

test('callClaude stream: mid-stream error event becomes a Hungarian error', async () => {
  const events = [{ type: 'message_start', message: { content: [], usage: {} } }, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }];
  await assert.rejects(AI.callClaude({ apiKey: 'k', messages: [], fetch: async () => sseResponse(events) }), /túlterhelt/);
});

test('runLayoutTurn: a max_tokens cut is dropped and retried once compactly with low effort', async () => {
  const { base } = AI.buildRoomBrief({ roomName: 'x', geom, items: [], Geometry, Catalog });
  const input = { summary: 's', items: [{ product_key: 'g-dresser-24', center_x: 300, center_y: 400, rotation: 0 }] };
  const bodies = [];
  const queue = [
    streamOf({ thinking: 'nagyon hosszú gondolkodás', tool: { id: 'cut', name: 'propose_layout', input }, truncateTool: true, stop: 'max_tokens', outputTokens: 32000 }),
    streamOf({ thinking: 'rövid', text: 'Kész.', tool: { id: 'ok', name: 'propose_layout', input } })
  ];
  const fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return sseResponse(queue.shift()); };
  const messages = [];
  const evaluate = value => { const built = AI.buildLayoutItems(value, deps({ base })); return { built, issues: AI.analyzeLayout(built.items, geom, { Geometry, Catalog }), report: '' }; };
  const result = await AI.runLayoutTurn({ apiKey: 'k', fetch, messages, catalogText: '', userContent: 'kérés', evaluate });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].max_tokens, 32000);
  assert.equal(bodies[0].output_config, undefined);
  assert.deepEqual(bodies[1].output_config, { effort: 'low' });
  assert.match(bodies[1].messages.at(-1).content.at(-1).text, /túl hosszú lett/);
  assert.equal(bodies[1].messages.length, 1, 'the truncated assistant turn is not sent back');
  assert.equal(result.shortened, true);
  assert.equal(result.proposal.built.items.length, 1);
  assert.deepEqual(result.pendingToolUseIds, ['ok']);
  assert.equal(messages.length, 2);
  assert.ok(result.usage.output_tokens >= 32500, 'both attempts are counted in the cost');
  // a second cut gives a clear error
  const twice = [streamOf({ stop: 'max_tokens' }), streamOf({ stop: 'max_tokens' })];
  await assert.rejects(AI.runLayoutTurn({ apiKey: 'k', fetch: async () => sseResponse(twice.shift()), messages: [], catalogText: '', userContent: 'x', evaluate }), /kétszer is túl hosszú/);
});
