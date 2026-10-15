'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const Ikea = require('../ikea-catalog.js');

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const exampleProduct = {
  name: 'Teszt IKEA asztal',
  productId: '123.456.78',
  category: 'tables',
  type: 'table',
  width: 140,
  depth: 78,
  height: 74,
  productUrl: 'https://www.ikea.com/hu/hu/p/teszt-ikea-asztal-12345678/'
};

test('IKEA Hungary product URL parsing extracts and formats the product ID', () => {
  const parsed = Core.parseIkeaProductUrl('https://www.ikea.com/hu/hu/p/malm-agykeret-magas-feher-s09929373/?utm_source=test#details');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.productId, '099.293.73');
  assert.equal(parsed.productUrl, 'https://www.ikea.com/hu/hu/p/malm-agykeret-magas-feher-s09929373/?utm_source=test');
  assert.match(parsed.suggestedName, /^Malm agykeret magas/);
});

test('product import rejects non-Hungarian or non-IKEA URLs', () => {
  assert.equal(Core.parseIkeaProductUrl('https://www.ikea.com/us/en/p/test-12345678/').ok, false);
  assert.equal(Core.parseIkeaProductUrl('https://example.com/hu/hu/p/test-12345678/').ok, false);
  assert.equal(Core.parseIkeaProductUrl('ftp://www.ikea.com/hu/hu/p/test-12345678/').ok, false);
  assert.equal(Core.parseIkeaProductUrl('not a url').ok, false);
});

test('normalization preserves exact real-world dimensions', () => {
  const normalized = Core.normalizeProduct({ ...exampleProduct, width: '140.5', depth: '78.2', height: '74' });
  assert.equal(normalized.width, 140.5);
  assert.equal(normalized.depth, 78.2);
  assert.equal(normalized.height, 74);
  assert.equal(normalized.productId, '123.456.78');
});

test('normalization never invents missing or invalid dimensions', () => {
  assert.throws(() => Core.normalizeProduct({ ...exampleProduct, width: '' }), /szélesség megadása kötelező/i);
  assert.throws(() => Core.normalizeProduct({ ...exampleProduct, depth: -20 }), /mélység/i);
  assert.throws(() => Core.normalizeProduct({ ...exampleProduct, width: Number.NaN }), /szélesség/i);
});

test('furniture item starts at exact product dimensions and records originals', () => {
  const item = Core.createFurnitureItem(exampleProduct, { x: 12, y: 34 }, () => 'fixed-id');
  assert.equal(item.id, 'fixed-id');
  assert.equal(item.w, 140);
  assert.equal(item.h, 78);
  assert.deepEqual(item.originalDimensions, { width: 140, depth: 78, height: 74 });
  assert.equal(item.source, 'ikea');
});

test('favorites persist across reload, deduplicate, and ignore corrupt entries', () => {
  const storage = new MemoryStorage();
  Core.saveFavorites(storage, [exampleProduct, { name: 'Hibás' }, exampleProduct]);
  const reloaded = Core.loadFavorites(storage);
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].productId, '123.456.78');

  storage.setItem(Core.FAVORITES_STORAGE_KEY, JSON.stringify([exampleProduct, { name: 'Hibás' }]));
  assert.equal(Core.loadFavorites(storage).length, 1);
  storage.setItem(Core.FAVORITES_STORAGE_KEY, '{broken');
  assert.deepEqual(Core.loadFavorites(storage), []);
});

test('legacy v1 plan data migrates without losing existing room content', () => {
  const legacy = {
    version: 1,
    currentRoom: 'room2',
    rooms: {
      room1: { active: 'Alap', variants: { Alap: { items: [] } } },
      room2: { active: 'Alap', variants: { Alap: { items: [{ id: 'kept' }] } } },
      room3: { active: 'Alap', variants: { Alap: { items: [] } } }
    }
  };
  const storage = new MemoryStorage({ [Core.PLAN_STORAGE_KEY]: JSON.stringify(legacy) });
  const loaded = Core.loadPlan(storage, () => ({ fallback: true }), ['room1', 'room2', 'room3']);
  assert.equal(loaded.version, 2);
  assert.equal(loaded.currentRoom, 'room2');
  assert.equal(loaded.rooms.room2.variants.Alap.items[0].id, 'kept');
  assert.deepEqual(loaded.rooms.room2.geometries, []);
  assert.equal(loaded.rooms.room2.activeGeometryId, null);
  assert.equal(JSON.parse(storage.getItem(Core.LEGACY_BACKUP_KEY)).version, 1);
});

test('legacy data still loads when browser quota prevents writing the migration backup', () => {
  const legacy = {
    version: 1,
    rooms: {
      room1: { active: 'Alap', variants: { Alap: { items: [{ id: 'safe' }] } } },
      room2: { active: 'Alap', variants: { Alap: { items: [] } } },
      room3: { active: 'Alap', variants: { Alap: { items: [] } } }
    }
  };
  const storage = new MemoryStorage({ [Core.PLAN_STORAGE_KEY]: JSON.stringify(legacy) });
  storage.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  const loaded = Core.loadPlan(storage, () => ({ fallback: true }), ['room1', 'room2', 'room3']);
  assert.equal(loaded.version, 2);
  assert.equal(loaded.rooms.room1.variants.Alap.items[0].id, 'safe');
});

test('v2 plan geometry survives saving and loading without changing user coordinates', () => {
  const plan = {
    version: 2,
    currentRoom: 'room1',
    rooms: {
      room1: {
        active: 'Alap', variants: { Alap: { items: [] } }, activeGeometryId: 'g1',
        geometries: [{ id: 'g1', name: 'Pontos', closed: true, confirmedWalls: [true, true, true], vertices: [{ id: 'a', x: 10.25, y: 20.5 }, { id: 'b', x: 310.25, y: 20.5 }, { id: 'c', x: 10.25, y: 220.5 }], objects: [{ id: 'd1', type: 'door', wallIndex: 0, offset: 80, width: 90, hinge: 'start', swing: 'in' }] }]
      },
      room2: { active: 'Alap', variants: { Alap: { items: [] } } },
      room3: { active: 'Alap', variants: { Alap: { items: [] } } }
    }
  };
  const storage = new MemoryStorage({ [Core.PLAN_STORAGE_KEY]: JSON.stringify(plan) });
  const loaded = Core.loadPlan(storage, () => plan, ['room1', 'room2', 'room3']);
  assert.deepEqual(loaded.rooms.room1.geometries[0], plan.rooms.room1.geometries[0]);
  assert.equal(storage.getItem(Core.LEGACY_BACKUP_KEY), null);
});

test('every curated product has valid unique metadata and supported dimensions', () => {
  const ids = new Set();
  for (const product of Ikea.products) {
    const normalized = Core.normalizeProduct(product);
    assert.equal(ids.has(normalized.productId), false, `duplicate ${normalized.productId}`);
    ids.add(normalized.productId);
    assert.ok(Object.hasOwn(Ikea.categories, normalized.category));
    assert.ok(normalized.width > 0 && normalized.depth > 0);
  }
  assert.ok(ids.size >= 10);
});

test('curated precision-sensitive dimensions match the verified outside dimensions', () => {
  const byId = Object.fromEntries(Ikea.products.map(product => [product.productId, product]));
  assert.deepEqual(
    { width: byId['502.145.60'].width, depth: byId['502.145.60'].depth, height: byId['502.145.60'].height },
    { width: 99.8, depth: 58, height: 236.4 }
  );
  assert.deepEqual(
    { width: byId['802.758.87'].width, depth: byId['802.758.87'].depth, height: byId['802.758.87'].height },
    { width: 76.5, depth: 39, height: 146.5 }
  );
  assert.equal(byId['004.572.35'].name, 'LISABO szék');
});
