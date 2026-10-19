'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const Geometry = require('../geometry.js');
const Floorplans = require('../floorplans.js');
const Catalog = require('../catalog.js');
const Materials = require('../materials.js');

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

let counter = 0;
const ids = () => `id${++counter}`;
const roomIds = Floorplans.legacyIds;

function v2Plan() {
  return {
    version: 2,
    currentRoom: 'room1',
    rooms: {
      room1: {
        name: 'Nappali', pxPerCm: 2, active: 'Alap',
        variants: { Alap: { items: [{ id: 'sofa', type: 'sofa', name: 'Kanapé', w: 220, h: 95, rot: 90, x: 400, y: 300 }] } },
        geometries: [{ id: 'mine', name: 'Saját', closed: true, vertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }], confirmedWalls: [true, true, false], objects: [], floorMaterial: 'walnut' }],
        activeGeometryId: 'mine'
      },
      room2: { name: 'B', pxPerCm: 219 / 102, active: 'Alap', variants: { Alap: { items: [] } }, geometries: [], activeGeometryId: null },
      room3: { name: 'C', pxPerCm: null, active: 'Alap', variants: { Alap: { items: [{ id: 'x', type: 'chair', w: 46, h: 50, rot: 0, x: 20, y: 40 }] } }, geometries: [], activeGeometryId: null }
    }
  };
}

test('v2 → v3 migration converts pixel positions to centimetres with each room calibration', () => {
  const migrated = Core.migratePlanData(v2Plan(), roomIds, { floorplans: Floorplans, idFactory: ids });
  const sofa = migrated.rooms.room1.variants.Alap.items[0];
  assert.equal(migrated.version, 3);
  assert.equal(migrated.meta.migratedFrom, 2);
  assert.deepEqual({ x: sofa.x, y: sofa.y, w: sofa.w, h: sofa.h, rot: sofa.rot }, { x: 200, y: 150, w: 220, h: 95, rot: 90 });
  assert.equal(sofa.model, 'sofa');
  assert.equal(sofa.dimensionStatus, 'typical');
  // Uncalibrated room used the 1.x fallback of 2 px/cm.
  assert.deepEqual(migrated.rooms.room3.variants.Alap.items[0].x, 10);
});

test('migration keeps user geometry active, maps legacy floor and adds a traced draft only once', () => {
  const migrated = Core.migratePlanData(v2Plan(), roomIds, { floorplans: Floorplans, idFactory: ids });
  const room1 = migrated.rooms.room1;
  assert.equal(room1.activeGeometryId, 'mine', 'a user-drawn closed geometry stays active');
  assert.equal(room1.variants.Alap.materials.floor, 'floor-walnut');
  assert.equal(room1.geometries.filter(g => g.source === 'plan').length, 1, 'architectural plan geometry is offered');
  assert.equal(room1.geometries.filter(g => g.source === 'traced').length, 0, 'no traced draft when a plan exists');
  // room2 had no geometry: the architectural plan geometry becomes active.
  const room2 = migrated.rooms.room2;
  const active = room2.geometries.find(g => g.id === room2.activeGeometryId);
  assert.equal(active.source, 'plan');
  assert.equal(room2.name, 'B', 'user-chosen names are kept');
  // The 4th room (added in 2.0.2) is created; existing rooms keep their content.
  assert.equal(migrated.rooms.room4.name, 'SZOBA I.');
  assert.equal(migrated.rooms.room4.geometries[0].source, 'plan');
  assert.equal(migrated.rooms.room1.variants.Alap.items.length, 1);
  // Re-normalising must not re-add a deleted draft or plan geometry.
  room1.geometries = room1.geometries.filter(g => g.source !== 'plan');
  room2.geometries = room2.geometries.filter(g => g.source !== 'plan');
  const again = Core.migratePlanData(migrated, roomIds, { floorplans: Floorplans, idFactory: ids });
  assert.equal(again.rooms.room1.geometries.some(g => g.source === 'plan'), false);
  assert.equal(again.rooms.room2.geometries.some(g => g.source === 'plan'), false);
});

test('loadPlan prefers 2.0 data and never overwrites the 1.x key', () => {
  const legacy = JSON.stringify(v2Plan());
  const storage = new MemoryStorage({ [Core.LEGACY_PLAN_STORAGE_KEY]: legacy });
  const loaded = Core.loadPlan(storage, () => null, roomIds, { floorplans: Floorplans, idFactory: ids });
  assert.equal(loaded.version, 3);
  assert.equal(storage.getItem(Core.LEGACY_PLAN_STORAGE_KEY), legacy);
  loaded.rooms.room1.name = 'Új név';
  storage.setItem(Core.PLAN_STORAGE_KEY, JSON.stringify(loaded));
  const reloaded = Core.loadPlan(storage, () => null, roomIds, { floorplans: Floorplans, idFactory: ids });
  assert.equal(reloaded.rooms.room1.name, 'Új név');
  // v3 positions are already centimetres: not divided again.
  assert.equal(reloaded.rooms.room1.variants.Alap.items[0].x, 200);
});

test('variant create, duplicate, rename, delete and versions keep layouts independent', () => {
  const room = Core.migratePlanData(v2Plan(), roomIds, { idFactory: ids }).rooms.room1;
  const copy = Core.createVariant(room, 'Elrendezés B', { from: 'Alap', idFactory: ids });
  assert.equal(room.active, copy);
  room.variants[copy].items[0].x = 999;
  assert.equal(room.variants.Alap.items[0].x, 200);
  assert.notEqual(room.variants[copy].items[0].id, room.variants.Alap.items[0].id);
  assert.equal(Core.createVariant(room, 'Elrendezés B'), 'Elrendezés B (2)');
  assert.equal(room.variants['Elrendezés B (2)'].items.length, 0);
  assert.equal(Core.renameVariant(room, 'Elrendezés B', 'Elrendezés C'), 'Elrendezés C');
  assert.deepEqual(Object.keys(room.variants), ['Alap', 'Elrendezés C', 'Elrendezés B (2)']);
  assert.throws(() => Core.renameVariant(room, 'Alap', 'Elrendezés C'), /Már létezik/);
  const version = Core.saveVersion(room, 'Alap', 'Első', 1000, ids);
  room.variants.Alap.items[0].x = 1;
  Core.restoreVersion(room, 'Alap', version.id);
  assert.equal(room.variants.Alap.items[0].x, 200);
  Core.deleteVariant(room, 'Elrendezés C');
  Core.deleteVariant(room, 'Elrendezés B (2)');
  assert.throws(() => Core.deleteVariant(room, 'Alap'), /utolsó/);
});

test('variant comparison lists differing pieces', () => {
  const result = Core.compareVariants(
    { items: [{ model: 'sofa', name: 'Kanapé' }, { model: 'chair', name: 'Szék' }, { model: 'chair', name: 'Szék' }] },
    { items: [{ model: 'chair', name: 'Szék' }, { model: 'bed', name: 'Ágy' }] }
  );
  assert.deepEqual(result, { onlyA: ['Kanapé', 'Szék'], onlyB: ['Ágy'], common: ['Szék'] });
});

test('traced floor plans are valid closed, non self-intersecting polygons', () => {
  for (const plan of Floorplans.plans.filter(value => value.trace)) {
    const geometry = Floorplans.buildDraftGeometry(plan, plan.pxPerCm, ids);
    assert.equal(geometry.vertices.length, plan.edges.length, plan.id);
    assert.equal(Geometry.polygonSelfIntersects(geometry.vertices), false, plan.id);
    assert.ok(Geometry.polygonArea(geometry.vertices) > 0);
    // Drawing calibration is preserved: reference segment length matches its label.
    const ref = plan.reference;
    assert.ok(Math.abs(Math.hypot(ref.x2 - ref.x1, ref.y2 - ref.y1) / plan.pxPerCm - ref.cm) < 1e-9);
    // Openings are only where the drawing shows no wall.
    const openEdges = plan.edges.map((edge, index) => edge.open ? index : -1).filter(index => index >= 0);
    assert.deepEqual(geometry.objects.filter(o => o.type === 'opening').map(o => o.wallIndex), openEdges);
  }
});

test('rotation about centre keeps the centre fixed and round-trips', () => {
  const item = { x: 100, y: 50, w: 200, h: 90, rot: 0 };
  const center = Geometry.itemCenter(item);
  const rotated = { ...item, ...Geometry.rotateAboutCenter(item, 90) };
  const after = Geometry.itemCenter(rotated);
  assert.ok(Math.abs(after.x - center.x) < 1e-9 && Math.abs(after.y - center.y) < 1e-9);
  assert.equal(rotated.rot, 90);
  assert.equal(Geometry.rotateAboutCenter(rotated, -270).rot, 90);
  const back = { ...rotated, ...Geometry.rotateAboutCenter(rotated, 0) };
  assert.ok(Math.abs(back.x - 100) < 1e-9 && Math.abs(back.y - 50) < 1e-9);
  const resized = Geometry.resizeAboutCenter(item, 100, 40);
  assert.deepEqual(Geometry.itemCenter({ ...item, ...resized }), center);
});

test('outward wall offset grows the room uniformly for orthogonal outlines', () => {
  const square = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  for (const polygon of [square, [...square].reverse()]) {
    const outer = Geometry.offsetPolygonOutward(polygon, 10);
    const box = Geometry.polygonBounds(outer);
    assert.deepEqual(box, { minX: -10, minY: -10, maxX: 410, maxY: 310 });
  }
});

test('wall clearances measure the free distance on each side of a rotated item', () => {
  const square = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const segments = Geometry.wallSegments({ vertices: square, closed: true });
  const item = { x: 50, y: 20, w: 100, h: 60, rot: 0 };
  const result = Object.fromEntries(Geometry.wallClearances(item, segments).map(value => [value.side, Math.round(value.distance * 1000) / 1000]));
  assert.deepEqual(result, { top: 20, right: 250, bottom: 220, left: 50 });
  const pushed = Geometry.pushToWall(item, segments);
  assert.ok(Math.abs(pushed.y) < 1e-9 && pushed.x === 50);
});

test('smart alignment snaps edges and centres to neighbouring furniture', () => {
  const table = { id: 't', x: 100, y: 100, w: 160, h: 90, rot: 0 };
  const chair = { id: 'c', x: 103, y: 210, w: 46, h: 52, rot: 0 };
  const snapped = Geometry.snapFurniture(chair, { threshold: 5, align: true, otherItems: [table] });
  assert.equal(snapped.x, 100);
  assert.equal(snapped.guides[0].type, 'align');
  const centred = Geometry.snapFurniture({ ...chair, x: 155 }, { threshold: 5, align: true, otherItems: [table] });
  assert.equal(centred.x + 23, 180);
});

test('partition walls trigger placement warnings', () => {
  const square = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const geometry = { closed: true, vertices: square, objects: [], partitions: [{ id: 'p', a: { x: 200, y: 0 }, b: { x: 200, y: 100 } }] };
  const warnings = Geometry.analyzePlacement({ id: 'a', x: 150, y: 20, w: 100, h: 50, rot: 0 }, [], geometry);
  assert.deepEqual(warnings.map(value => value.type), ['partition']);
});

test('catalogue entries are complete; generic pieces are never labelled as verified', () => {
  const keys = new Set();
  for (const product of Catalog.all) {
    assert.ok(product.name && product.width > 0 && product.depth > 0 && product.height > 0, product.name);
    assert.ok(Object.hasOwn(Catalog.categories, product.category), product.category);
    assert.equal(keys.has(product.key), false);
    keys.add(product.key);
    for (const id of Object.values(product.materials)) assert.ok(Materials.list.some(material => material.id === id), id);
    if (product.source === 'generic') assert.equal(product.dimensionStatus, 'typical');
  }
  for (const product of Catalog.ikea) {
    assert.equal(product.dimensionStatus, 'verified');
    assert.equal(product.resizable, false);
  }
  assert.equal(Catalog.ikea.length, 12);
  assert.equal(Catalog.modelFor({ type: 'lamp' }), 'floor-lamp');
  assert.equal(Catalog.modelFor({ type: 'sofa', model: 'sectional' }), 'sectional');
  assert.equal(Catalog.layerFor({ model: 'rug' }), 'floor');
});

test('generic items keep typical dimensions; custom items are marked as user-entered', () => {
  const product = Catalog.generic.find(value => value.model === 'table');
  const item = Core.createGenericItem(product, { x: 10, y: 20 }, () => 'g');
  assert.deepEqual({ w: item.w, h: item.h, height: item.height, status: item.dimensionStatus, model: item.model }, { w: 160, h: 90, height: 75, status: 'typical', model: 'table' });
  const custom = Core.createGenericItem({ name: 'Saját', width: 33, depth: 44, source: 'custom', model: 'box' }, {}, () => 'c');
  assert.equal(custom.dimensionStatus, 'user');
  assert.throws(() => Core.createGenericItem({ name: 'x', width: 0, depth: 10 }), /szélesség/);
});

test('architectural plan geometries match the written plan dimensions', () => {
  for (const plan of Floorplans.plans) {
  const geometry = Floorplans.buildPlanGeometry(plan, ids);
  const lengths = geometry.vertices.map((v, i) => Geometry.distance(v, geometry.vertices[(i + 1) % geometry.vertices.length]));
  geometry.wallLabels.forEach((label, index) => {
    if (label) assert.ok(Math.abs(lengths[index] - label) < 0.01, `wall ${index + 1}: ${lengths[index]} ≠ ${label}`);
  });
  assert.equal(Geometry.polygonSelfIntersects(geometry.vertices), false);
  const area = Geometry.polygonArea(geometry.vertices) / 10000;
  assert.ok(area >= plan.planGeometry.planArea - 0.1 && area - plan.planGeometry.planArea < 2.2, `${plan.id} area ${area}`);
  // Openings sit inside their walls.
  for (const object of geometry.objects) {
    assert.ok(object.offset - object.width / 2 >= 0 && object.offset + object.width / 2 <= lengths[object.wallIndex], object.type);
  }
  // Every wall confirmed only where the plan writes the dimension.
  geometry.confirmedWalls.forEach((value, index) => assert.equal(value, Boolean(plan.planGeometry.walls[index].label && plan.planGeometry.walls[index].confirmed)));
  }
});

test('room 1 overall dimensions follow the plan', () => {
  const geometry = Floorplans.buildPlanGeometry(Floorplans.byId('room1'), ids);
  const box = Geometry.polygonBounds(geometry.vertices);
  assert.deepEqual([box.maxX - box.minX, box.maxY - box.minY], [456, 600]);
  assert.equal(geometry.vertices[9].x - geometry.vertices[3].x, 161);
});

test('rooms whose plan area is fully visible match the plan area exactly', () => {
  for (const id of ['room3', 'room4']) {
    const plan = Floorplans.byId(id);
    const geometry = Floorplans.buildPlanGeometry(plan, ids);
    assert.equal(Math.round(Geometry.polygonArea(geometry.vertices) / 100) / 100, plan.planGeometry.planArea, id);
  }
});

test('thick free-standing elements (pillar, fireplace) block furniture and offer wall snapping', () => {
  const geometry = Floorplans.buildPlanGeometry(Floorplans.byId('room2'), ids);
  const pillar = geometry.partitions[0];
  assert.equal(pillar.thickness, 43);
  const onPillar = { id: 'x', x: 140, y: 470, w: 40, h: 40, rot: 0 };
  assert.ok(Geometry.analyzePlacement(onPillar, [], geometry).some(w => w.type === 'partition'));
  const beside = { id: 'y', x: 140, y: 500, w: 40, h: 40, rot: 0 };
  assert.ok(!Geometry.analyzePlacement(beside, [], geometry).some(w => w.type === 'partition'));
  assert.ok(Geometry.wallSegments(geometry).length >= geometry.vertices.length + 8);
});

test('furniture flush against a wall (after rotation) is not reported as outside', () => {
  const square = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const geometry = { closed: true, vertices: square, objects: [], partitions: [] };
  for (const rot of [0, 90, 180, 270]) {
    const base = { id: 'a', x: 100, y: 100, w: 120, h: 60, rot: 0 };
    const item = { ...base, ...Geometry.rotateAboutCenter(base, rot) };
    const pushed = { ...item, ...Geometry.pushToWall(item, Geometry.wallSegments(geometry)) };
    assert.deepEqual(Geometry.analyzePlacement(pushed, [], geometry), [], `rot ${rot}`);
  }
  assert.deepEqual(Geometry.analyzePlacement({ id: 'b', x: -2, y: 10, w: 50, h: 50, rot: 0 }, [], geometry).map(w => w.type), ['boundary']);
});
