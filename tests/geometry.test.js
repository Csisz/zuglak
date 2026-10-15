'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Geometry = require('../geometry.js');

const square = [
  { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }
];

test('pixel and centimetre transformations are inverse and reject missing calibration', () => {
  const centimetres = Geometry.pixelToCm({ x: 250, y: 125 }, 2.5);
  assert.deepEqual(centimetres, { x: 100, y: 50 });
  assert.deepEqual(Geometry.cmToPixel(centimetres, 2.5), { x: 250, y: 125 });
  assert.throws(() => Geometry.pixelToCm({ x: 1, y: 1 }, 0), /arány/i);
});

test('point-in-polygon and wall intersection handle boundaries and concave rooms', () => {
  const concave = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }];
  assert.equal(Geometry.pointInPolygon({ x: 20, y: 80 }, concave), true);
  assert.equal(Geometry.pointInPolygon({ x: 70, y: 70 }, concave), false);
  assert.equal(Geometry.pointInPolygon({ x: 0, y: 50 }, concave), true);
  assert.equal(Geometry.segmentsIntersect({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }), true);
  assert.equal(Geometry.polygonSelfIntersects([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }]), true);
});

test('rotated furniture collision uses oriented rectangles rather than axis-aligned boxes', () => {
  const first = Geometry.rotatedRectCorners({ x: 100, y: 100, w: 120, h: 40, rot: 45 });
  const overlap = Geometry.rotatedRectCorners({ x: 120, y: 125, w: 80, h: 40, rot: -20 });
  const separatedInsideAabb = Geometry.rotatedRectCorners({ x: 40, y: 150, w: 35, h: 20, rot: 45 });
  assert.equal(Geometry.convexPolygonsOverlap(first, overlap), true);
  assert.equal(Geometry.convexPolygonsOverlap(first, separatedInsideAabb), false);
});

test('room boundary analysis catches rotated rectangles crossing the polygon', () => {
  const inside = { id: 'inside', x: 80, y: 70, w: 90, h: 45, rot: 25 };
  const crossing = { id: 'crossing', x: 380, y: 120, w: 70, h: 60, rot: 15 };
  assert.deepEqual(Geometry.analyzePlacement(inside, [], { vertices: square, closed: true, objects: [] }), []);
  assert.ok(Geometry.analyzePlacement(crossing, [], { vertices: square, closed: true, objects: [] }).some(value => value.type === 'boundary'));

  const uShape = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 70, y: 100 }, { x: 70, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 100 }, { x: 0, y: 100 }];
  const bridgesConcavity = { id: 'bridge', x: 20, y: 60, w: 60, h: 20, rot: 0 };
  assert.ok(Geometry.analyzePlacement(bridgesConcavity, [], { vertices: uShape, closed: true, objects: [] }).some(value => value.type === 'boundary'));
});

test('snapping supports walls, furniture edges, grid, and rotated edges', () => {
  const wallSnap = Geometry.snapFurniture({ x: 2, y: 100, w: 50, h: 30, rot: 0 }, {
    threshold: 5, walls: true, roomVertices: square, roomClosed: true
  });
  assert.equal(wallSnap.snapped, true);
  assert.ok(Math.abs(wallSnap.x) < 1e-6);

  const furnitureSnap = Geometry.snapFurniture({ x: 151.5, y: 100, w: 50, h: 40, rot: 0 }, {
    threshold: 4, furniture: true, otherItems: [{ id: 'a', x: 50, y: 100, w: 100, h: 40, rot: 0 }]
  });
  assert.equal(furnitureSnap.type, 'furniture');
  assert.ok(Math.abs(furnitureSnap.x - 150) < 1e-6);

  const gridSnap = Geometry.snapFurniture({ x: 12, y: 18, w: 10, h: 10, rot: 0 }, { threshold: 3, grid: true, gridSize: 5 });
  assert.deepEqual({ x: gridSnap.x, y: gridSnap.y }, { x: 10, y: 20 });

  const offset = 3 / Math.sqrt(2);
  const rotated = Geometry.snapFurniture({ x: -offset, y: offset, w: 60, h: 30, rot: 45 }, {
    threshold: 4, walls: true, roomVertices: [{ x: 0, y: 0 }, { x: 200, y: 200 }], roomClosed: false
  });
  assert.equal(rotated.snapped, true);
  assert.equal(rotated.type, 'wall');
});

test('door swing clearance is geometric and reports intersecting furniture', () => {
  const door = { id: 'door-1', type: 'door', wallIndex: 0, offset: 100, width: 90, hinge: 'start', swing: 'in' };
  const zone = Geometry.doorClearancePolygon(door, square);
  assert.ok(zone.length > 10);
  assert.equal(Geometry.pointInPolygon({ x: 100, y: 30 }, zone), true);
  const furniture = { id: 'chair', x: 80, y: 20, w: 45, h: 45, rot: 15 };
  const warnings = Geometry.analyzePlacement(furniture, [], { vertices: square, closed: true, objects: [door] });
  assert.ok(warnings.some(value => value.type === 'door' && value.id === 'door-1'));
});

test('editing an exact wall length moves only its endpoint along the existing direction', () => {
  const changed = Geometry.setWallLength([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 30, y: 40 }, { id: 'c', x: 30, y: 100 }], 0, 100, false);
  assert.ok(Math.abs(changed[1].x - 60) < 1e-6);
  assert.ok(Math.abs(changed[1].y - 80) < 1e-6);
  assert.deepEqual(changed[2], { id: 'c', x: 30, y: 100 });
});
