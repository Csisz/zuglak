/* Pure geometry helpers for Zuglak Studio 2.0. Coordinates and dimensions are centimetres.
 * Furniture convention: (x, y) is the item's local top-left corner, `rot` is clockwise
 * degrees on screen around that corner, `w` is width and `h` is depth. */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  root.ZuglakGeometry = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPSILON = 1e-7;
  const rad = degrees => Number(degrees || 0) * Math.PI / 180;
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const multiply = (value, amount) => ({ x: value.x * amount, y: value.y * amount });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const length = value => Math.hypot(value.x, value.y);
  const unit = value => {
    const size = length(value);
    return size > EPSILON ? { x: value.x / size, y: value.y / size } : { x: 0, y: 0 };
  };
  const perpendicular = value => ({ x: -value.y, y: value.x });
  const rotateVector = (value, angle) => ({
    x: value.x * Math.cos(angle) - value.y * Math.sin(angle),
    y: value.x * Math.sin(angle) + value.y * Math.cos(angle)
  });

  function requireScale(pxPerCm) {
    const value = Number(pxPerCm);
    if (!Number.isFinite(value) || value <= 0) throw new TypeError('Érvényes képpont/centiméter arány szükséges.');
    return value;
  }

  function pixelToCm(point, pxPerCm) {
    const scale = requireScale(pxPerCm);
    return { x: Number(point.x) / scale, y: Number(point.y) / scale };
  }

  function cmToPixel(point, pxPerCm) {
    const scale = requireScale(pxPerCm);
    return { x: Number(point.x) * scale, y: Number(point.y) * scale };
  }

  function pointOnSegment(point, start, end, epsilon = EPSILON) {
    const segment = subtract(end, start);
    const relative = subtract(point, start);
    return Math.abs(cross(segment, relative)) <= epsilon * Math.max(1, length(segment)) &&
      dot(relative, segment) >= -epsilon && dot(subtract(point, end), segment) <= epsilon;
  }

  function orientation(a, b, c) {
    const value = cross(subtract(b, a), subtract(c, a));
    return Math.abs(value) <= EPSILON ? 0 : Math.sign(value);
  }

  function segmentsIntersect(a, b, c, d, includeTouch = true) {
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);
    if (o1 !== o2 && o3 !== o4) return true;
    if (!includeTouch) return false;
    return (o1 === 0 && pointOnSegment(c, a, b)) || (o2 === 0 && pointOnSegment(d, a, b)) ||
      (o3 === 0 && pointOnSegment(a, c, d)) || (o4 === 0 && pointOnSegment(b, c, d));
  }

  function pointInPolygon(point, polygon, includeBoundary = true) {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const a = polygon[previous];
      const b = polygon[index];
      if (pointOnSegment(point, a, b)) return includeBoundary;
      const crosses = (a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function polygonEdges(polygon, closed = true) {
    const edges = [];
    const count = closed ? polygon.length : Math.max(0, polygon.length - 1);
    for (let index = 0; index < count; index += 1) {
      edges.push([polygon[index], polygon[(index + 1) % polygon.length], index]);
    }
    return edges;
  }

  function polygonSelfIntersects(polygon, closed = true) {
    const edges = polygonEdges(polygon, closed);
    for (let first = 0; first < edges.length; first += 1) {
      for (let second = first + 1; second < edges.length; second += 1) {
        const adjacent = Math.abs(first - second) === 1 || (closed && first === 0 && second === edges.length - 1);
        if (!adjacent && segmentsIntersect(edges[first][0], edges[first][1], edges[second][0], edges[second][1])) return true;
      }
    }
    return false;
  }

  function rotatedRectCorners(item, margin = 0) {
    const angle = rad(item.rot);
    const origin = { x: Number(item.x), y: Number(item.y) };
    const points = [
      { x: -margin, y: -margin },
      { x: Number(item.w) + margin, y: -margin },
      { x: Number(item.w) + margin, y: Number(item.h) + margin },
      { x: -margin, y: Number(item.h) + margin }
    ];
    return points.map(point => add(origin, rotateVector(point, angle)));
  }

  function projection(polygon, axis) {
    const values = polygon.map(point => dot(point, axis));
    return { min: Math.min(...values), max: Math.max(...values) };
  }

  function convexPolygonsOverlap(first, second) {
    if (!first.length || !second.length) return false;
    for (const polygon of [first, second]) {
      for (const [a, b] of polygonEdges(polygon)) {
        const axis = unit(perpendicular(subtract(b, a)));
        const one = projection(first, axis);
        const two = projection(second, axis);
        if (one.max <= two.min + EPSILON || two.max <= one.min + EPSILON) return false;
      }
    }
    return true;
  }

  function polygonContainsPolygon(container, subject) {
    if (container.length < 3 || subject.length < 3) return false;
    if (!subject.every(point => pointInPolygon(point, container, true))) return false;
    for (const [a, b] of polygonEdges(subject)) {
      for (const [c, d] of polygonEdges(container)) {
        if (segmentsIntersect(a, b, c, d, false)) return false;
      }
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!pointInPolygon(midpoint, container, true)) return false;
    }
    return true;
  }

  function nearestPointOnSegment(point, start, end) {
    const segment = subtract(end, start);
    const squared = dot(segment, segment);
    const ratio = squared <= EPSILON ? 0 : Math.max(0, Math.min(1, dot(subtract(point, start), segment) / squared));
    const nearest = add(start, multiply(segment, ratio));
    return { point: nearest, ratio, distance: distance(point, nearest), offset: Math.sqrt(squared) * ratio };
  }

  function nearestWall(point, vertices, closed = true) {
    let best = null;
    for (const [start, end, wallIndex] of polygonEdges(vertices || [], closed)) {
      const candidate = nearestPointOnSegment(point, start, end);
      if (!best || candidate.distance < best.distance) {
        best = { ...candidate, wallIndex, start, end, length: distance(start, end) };
      }
    }
    return best;
  }

  function setWallLength(vertices, wallIndex, nextLength, closed = true) {
    const value = Number(nextLength);
    if (!Number.isFinite(value) || value <= 0 || value > 5000) throw new TypeError('A falhossz 0 és 5000 cm közötti szám lehet.');
    const result = vertices.map(point => ({ ...point }));
    const nextIndex = wallIndex + 1 < result.length ? wallIndex + 1 : closed ? 0 : -1;
    if (!result[wallIndex] || nextIndex < 0 || !result[nextIndex]) throw new RangeError('Ismeretlen falszakasz.');
    const direction = unit(subtract(result[nextIndex], result[wallIndex]));
    if (length(direction) <= EPSILON) throw new TypeError('Az egymásra eső falpontok hossza nem állítható.');
    result[nextIndex].x = result[wallIndex].x + direction.x * value;
    result[nextIndex].y = result[wallIndex].y + direction.y * value;
    return result;
  }

  function wallFrame(vertices, wallIndex, offset) {
    const start = vertices[wallIndex];
    const end = vertices[(wallIndex + 1) % vertices.length];
    if (!start || !end) return null;
    const tangent = unit(subtract(end, start));
    const wallLength = distance(start, end);
    const center = add(start, multiply(tangent, Math.max(0, Math.min(wallLength, Number(offset) || 0))));
    let inward = perpendicular(tangent);
    const probe = add(center, multiply(inward, 1));
    if (!pointInPolygon(probe, vertices, true)) inward = multiply(inward, -1);
    return { start, end, center, tangent, inward, length: wallLength };
  }

  function doorClearancePolygon(door, vertices, steps = 12) {
    const frame = wallFrame(vertices, door.wallIndex, door.offset);
    if (!frame) return [];
    const width = Number(door.width);
    if (!Number.isFinite(width) || width <= 0) return [];
    const hingeDirection = door.hinge === 'end' ? -1 : 1;
    const half = width / 2;
    const hinge = add(frame.center, multiply(frame.tangent, -hingeDirection * half));
    const leaf = multiply(frame.tangent, hingeDirection * width);
    const positivePointsIn = dot(rotateVector(leaf, Math.PI / 2), frame.inward) > 0;
    const inwardDirection = positivePointsIn ? 1 : -1;
    const direction = door.swing === 'out' ? -inwardDirection : inwardDirection;
    const polygon = [hinge];
    for (let index = 0; index <= steps; index += 1) {
      polygon.push(add(hinge, rotateVector(leaf, direction * Math.PI / 2 * index / steps)));
    }
    return polygon;
  }

  function openingSegment(object, vertices) {
    const frame = wallFrame(vertices, object.wallIndex, object.offset);
    if (!frame) return null;
    const half = Math.max(0, Number(object.width) || 0) / 2;
    return {
      ...frame,
      a: add(frame.center, multiply(frame.tangent, -half)),
      b: add(frame.center, multiply(frame.tangent, half))
    };
  }

  function radiatorPolygon(radiator, vertices) {
    const opening = openingSegment(radiator, vertices);
    if (!opening) return [];
    const depth = Math.max(0, Number(radiator.depth) || 0);
    return [opening.a, opening.b, add(opening.b, multiply(opening.inward, depth)), add(opening.a, multiply(opening.inward, depth))];
  }

  function parallelEdgeSnap(moving, targets, threshold, type) {
    let best = null;
    for (const [a, b] of polygonEdges(moving)) {
      const movingDirection = unit(subtract(b, a));
      const midpoint = multiply(add(a, b), 0.5);
      for (const [c, d] of targets) {
        const targetDirection = unit(subtract(d, c));
        if (Math.abs(dot(movingDirection, targetDirection)) < Math.cos(rad(4))) continue;
        const normal = perpendicular(targetDirection);
        const signedDistance = dot(subtract(midpoint, c), normal);
        if (Math.abs(signedDistance) > threshold) continue;
        const movingRange = projection([a, b], targetDirection);
        const targetRange = projection([c, d], targetDirection);
        if (movingRange.max < targetRange.min - threshold || targetRange.max < movingRange.min - threshold) continue;
        const delta = multiply(normal, -signedDistance);
        const magnitude = length(delta);
        if (magnitude <= EPSILON) continue;
        if (!best || magnitude < best.magnitude) best = { delta, magnitude, guide: { a: c, b: d, type } };
      }
    }
    return best;
  }

  function snapFurniture(item, options = {}) {
    const threshold = Math.max(EPSILON, Number(options.threshold) || 5);
    const moving = rotatedRectCorners(item);
    const candidates = [];
    if (options.walls && Array.isArray(options.roomVertices) && options.roomVertices.length >= 2) {
      const edges = polygonEdges(options.roomVertices, options.roomClosed !== false);
      for (const part of options.partitions || []) {
        if (part.thickness) polygonEdges(partitionPolygon(part)).forEach(([a, b]) => edges.push([a, b, -1]));
        else edges.push([part.a, part.b, -1]);
      }
      const candidate = parallelEdgeSnap(moving, edges, threshold, 'wall');
      if (candidate) candidates.push(candidate);
    }
    if (options.align) {
      const candidate = alignmentSnap(item, options.otherItems || [], threshold);
      if (candidate) candidates.push(candidate);
    }
    if (options.furniture) {
      for (const other of options.otherItems || []) {
        const candidate = parallelEdgeSnap(moving, polygonEdges(rotatedRectCorners(other)), threshold, 'furniture');
        if (candidate) candidates.push(candidate);
      }
    }
    if (options.grid) {
      const grid = Math.max(EPSILON, Number(options.gridSize) || 5);
      let dx = Math.round(item.x / grid) * grid - item.x;
      let dy = Math.round(item.y / grid) * grid - item.y;
      if (Math.abs(dx) > threshold) dx = 0;
      if (Math.abs(dy) > threshold) dy = 0;
      if (Math.abs(dx) > EPSILON || Math.abs(dy) > EPSILON) {
        candidates.push({ delta: { x: dx, y: dy }, magnitude: Math.hypot(dx, dy), guide: { type: 'grid', x: item.x + dx, y: item.y + dy } });
      }
    }
    candidates.sort((a, b) => a.magnitude - b.magnitude);
    const best = candidates[0];
    if (!best) return { x: item.x, y: item.y, snapped: false, guides: [] };
    const guides = best.guides || [best.guide];
    return { x: item.x + best.delta.x, y: item.y + best.delta.y, snapped: true, guides, type: guides[0].type };
  }

  function analyzePlacement(item, otherItems, geometry, options = {}) {
    const warnings = [];
    const itemPolygon = rotatedRectCorners(item);
    for (const other of otherItems || []) {
      if (other.id !== item.id && convexPolygonsOverlap(itemPolygon, rotatedRectCorners(other))) {
        warnings.push({ type: 'furniture', id: other.id });
      }
    }
    const vertices = geometry?.vertices || [];
    // 0,5 mm tolerance: furniture placed flush against a wall must not be reported as outside.
    if (geometry?.closed && vertices.length >= 3 && !polygonContainsPolygon(vertices, rotatedRectCorners(item, -0.05))) {
      warnings.push({ type: 'boundary' });
    }
    for (const part of geometry?.partitions || []) {
      const block = part.thickness ? partitionPolygon(part) : null;
      const hit = block
        ? convexPolygonsOverlap(rotatedRectCorners(item, -0.05), block)
        : polygonEdges(itemPolygon).some(([a, b]) => segmentsIntersect(a, b, part.a, part.b, false)) || pointInPolygon(part.a, itemPolygon, false);
      if (hit) {
        warnings.push({ type: 'partition', id: part.id });
      }
    }
    for (const object of geometry?.objects || []) {
      if (object.type === 'door' && convexPolygonsOverlap(itemPolygon, doorClearancePolygon(object, vertices))) {
        warnings.push({ type: 'door', id: object.id });
      }
    }
    const margin = Number(options.clearance) || 0;
    if (margin > 0) {
      const clearance = rotatedRectCorners(item, margin);
      for (const other of otherItems || []) {
        if (other.id !== item.id && convexPolygonsOverlap(clearance, rotatedRectCorners(other))) {
          warnings.push({ type: 'clearance', id: other.id, distance: margin });
        }
      }
    }
    return warnings;
  }


  /** Rectangle of a free-standing wall element (pillar, fireplace) with its own thickness. */
  function partitionPolygon(part, defaultThickness = 10) {
    const length = distance(part.a, part.b);
    const half = (Number(part.thickness) || defaultThickness) / 2;
    if (length < EPSILON) return [];
    const n = { x: -(part.b.y - part.a.y) / length * half, y: (part.b.x - part.a.x) / length * half };
    return [add(part.a, n), add(part.b, n), subtract(part.b, n), subtract(part.a, n)];
  }

  function itemCenter(item) {
    const angle = rad(item.rot);
    return add({ x: Number(item.x), y: Number(item.y) }, rotateVector({ x: Number(item.w) / 2, y: Number(item.h) / 2 }, angle));
  }

  /** Returns the corner position that keeps the item's centre fixed at `center`. */
  function cornerForCenter(item, center, rotation = item.rot) {
    const offset = rotateVector({ x: Number(item.w) / 2, y: Number(item.h) / 2 }, rad(rotation));
    return { x: center.x - offset.x, y: center.y - offset.y };
  }

  /** Rotates an item around its centre (UI convention), returning the new {x, y, rot}. */
  function rotateAboutCenter(item, rotation) {
    const center = itemCenter(item);
    const normalized = ((Number(rotation) % 360) + 360) % 360;
    const corner = cornerForCenter(item, center, normalized);
    return { x: corner.x, y: corner.y, rot: normalized };
  }

  /** Resizes an item keeping its centre fixed. */
  function resizeAboutCenter(item, width, depth) {
    const center = itemCenter(item);
    const next = { ...item, w: Number(width), h: Number(depth) };
    return { ...cornerForCenter(next, center), w: next.w, h: next.h };
  }

  function signedArea(polygon) {
    let total = 0;
    for (const [a, b] of polygonEdges(polygon)) total += cross(a, b);
    return total / 2;
  }

  function polygonArea(polygon) {
    return Math.abs(signedArea(polygon || []));
  }

  function polygonBounds(points) {
    return (points || []).reduce((value, point) => ({
      minX: Math.min(value.minX, point.x), minY: Math.min(value.minY, point.y),
      maxX: Math.max(value.maxX, point.x), maxY: Math.max(value.maxY, point.y)
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  }

  function polygonPerimeter(polygon) {
    return polygonEdges(polygon).reduce((sum, [a, b]) => sum + distance(a, b), 0);
  }

  function lineIntersection(p, r, q, s) {
    const denominator = cross(r, s);
    if (Math.abs(denominator) < EPSILON) return null;
    const t = cross(subtract(q, p), s) / denominator;
    return add(p, multiply(r, t));
  }

  /**
   * Offsets a closed polygon outward by `amount` (mitred corners, limited).
   * Returns vertices in the same order as the input.
   */
  function offsetPolygonOutward(polygon, amount, miterLimit = 4) {
    const n = polygon.length;
    if (n < 3) return polygon.map(point => ({ ...point }));
    const orientationSign = signedArea(polygon) > 0 ? 1 : -1;
    // For positive signed area in a y-down frame, the outward normal of edge (a→b) is (dy, -dx) * -1 … compute via probe instead.
    const normals = [];
    for (let index = 0; index < n; index += 1) {
      const a = polygon[index];
      const b = polygon[(index + 1) % n];
      const tangent = unit(subtract(b, a));
      let normal = { x: tangent.y, y: -tangent.x };
      if (orientationSign < 0) normal = multiply(normal, -1);
      normals.push({ tangent, normal });
    }
    // Validate direction with a probe on the longest edge.
    let longest = 0;
    for (let index = 1; index < n; index += 1) {
      if (distance(polygon[index], polygon[(index + 1) % n]) > distance(polygon[longest], polygon[(longest + 1) % n])) longest = index;
    }
    const mid = multiply(add(polygon[longest], polygon[(longest + 1) % n]), 0.5);
    const probe = add(mid, multiply(normals[longest].normal, 0.5));
    if (pointInPolygon(probe, polygon, false)) normals.forEach(value => { value.normal = multiply(value.normal, -1); });
    const result = [];
    for (let index = 0; index < n; index += 1) {
      const previous = normals[(index - 1 + n) % n];
      const current = normals[index];
      const point = polygon[index];
      const p1 = add(point, multiply(previous.normal, amount));
      const p2 = add(point, multiply(current.normal, amount));
      const hitPoint = lineIntersection(p1, previous.tangent, p2, current.tangent);
      if (!hitPoint || distance(hitPoint, point) > Math.abs(amount) * miterLimit) {
        result.push(add(point, multiply(unit(add(previous.normal, current.normal)), amount)));
      } else result.push(hitPoint);
    }
    return result;
  }

  /** Distance along a ray to the nearest segment (or Infinity). */
  function rayDistance(origin, direction, segments) {
    const dir = unit(direction);
    let best = Infinity;
    let bestPoint = null;
    for (const [a, b] of segments) {
      const s = subtract(b, a);
      const denominator = cross(dir, s);
      if (Math.abs(denominator) < EPSILON) continue;
      const qp = subtract(a, origin);
      const t = cross(qp, s) / denominator;
      const u = cross(qp, dir) / denominator;
      if (t > EPSILON && u >= -EPSILON && u <= 1 + EPSILON && t < best) {
        best = t;
        bestPoint = add(origin, multiply(dir, t));
      }
    }
    return { distance: best, point: bestPoint };
  }

  /**
   * Measures free distance from the middle of each item side, perpendicular to that
   * side, to the nearest wall/partition. Used for live placement read-outs.
   */
  function wallClearances(item, segments) {
    const corners = rotatedRectCorners(item);
    const sides = [
      { name: 'top', a: corners[0], b: corners[1] },
      { name: 'right', a: corners[1], b: corners[2] },
      { name: 'bottom', a: corners[2], b: corners[3] },
      { name: 'left', a: corners[3], b: corners[0] }
    ];
    const center = itemCenter(item);
    return sides.map(side => {
      const midpoint = multiply(add(side.a, side.b), 0.5);
      const direction = unit(subtract(midpoint, center));
      const hitValue = rayDistance(midpoint, direction, segments);
      return { side: side.name, from: midpoint, to: hitValue.point, distance: hitValue.distance };
    });
  }

  function itemBounds(item) {
    return polygonBounds(rotatedRectCorners(item));
  }

  /**
   * Smart alignment guides: aligns the moving item's bounding-box edges or centre
   * with other items' edges or centres along x and y independently.
   */
  function alignmentSnap(item, others, threshold) {
    const box = itemBounds(item);
    const mine = {
      x: [box.minX, (box.minX + box.maxX) / 2, box.maxX],
      y: [box.minY, (box.minY + box.maxY) / 2, box.maxY]
    };
    let bestX = null;
    let bestY = null;
    for (const other of others || []) {
      if (other.id === item.id) continue;
      const target = itemBounds(other);
      const theirs = {
        x: [target.minX, (target.minX + target.maxX) / 2, target.maxX],
        y: [target.minY, (target.minY + target.maxY) / 2, target.maxY]
      };
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          // Only align like-for-like (edge↔edge, centre↔centre) to avoid noisy guides.
          if ((i === 1) !== (j === 1)) continue;
          const dx = theirs.x[j] - mine.x[i];
          if (Math.abs(dx) <= threshold && (!bestX || Math.abs(dx) < Math.abs(bestX.delta))) {
            bestX = { delta: dx, value: theirs.x[j], span: [Math.min(box.minY, target.minY), Math.max(box.maxY, target.maxY)] };
          }
          const dy = theirs.y[j] - mine.y[i];
          if (Math.abs(dy) <= threshold && (!bestY || Math.abs(dy) < Math.abs(bestY.delta))) {
            bestY = { delta: dy, value: theirs.y[j], span: [Math.min(box.minX, target.minX), Math.max(box.maxX, target.maxX)] };
          }
        }
      }
    }
    if (!bestX && !bestY) return null;
    const delta = { x: bestX ? bestX.delta : 0, y: bestY ? bestY.delta : 0 };
    const guides = [];
    if (bestX) guides.push({ type: 'align', a: { x: bestX.value, y: bestX.span[0] }, b: { x: bestX.value, y: bestX.span[1] } });
    if (bestY) guides.push({ type: 'align', a: { x: bestY.span[0], y: bestY.value }, b: { x: bestY.span[1], y: bestY.value } });
    // Alignment is preferred over grid when within threshold: scale magnitude down slightly.
    return { delta, magnitude: Math.hypot(delta.x, delta.y) * 0.9, guide: guides[0], guides };
  }

  /** Moves an item flush against the nearest wall behind it (its local top side). */
  function pushToWall(item, segments, gap = 0) {
    const clearances = wallClearances(item, segments);
    const back = clearances.find(value => value.side === 'top');
    if (!back || !Number.isFinite(back.distance)) return null;
    const direction = unit(subtract(back.from, itemCenter(item)));
    const move = back.distance - gap;
    return { x: item.x + direction.x * move, y: item.y + direction.y * move };
  }

  function wallSegments(geometry) {
    if (!geometry) return [];
    const segments = polygonEdges(geometry.vertices || [], geometry.closed !== false).map(([a, b]) => [a, b]);
    for (const part of geometry.partitions || []) {
      if (part.thickness) polygonEdges(partitionPolygon(part)).forEach(([a, b]) => segments.push([a, b]));
      else segments.push([part.a, part.b]);
    }
    return segments;
  }

  return Object.freeze({
    EPSILON,
    pixelToCm,
    cmToPixel,
    distance,
    pointOnSegment,
    segmentsIntersect,
    pointInPolygon,
    polygonEdges,
    polygonSelfIntersects,
    rotatedRectCorners,
    convexPolygonsOverlap,
    polygonContainsPolygon,
    nearestPointOnSegment,
    nearestWall,
    setWallLength,
    wallFrame,
    openingSegment,
    doorClearancePolygon,
    radiatorPolygon,
    snapFurniture,
    analyzePlacement,
    partitionPolygon,
    itemCenter,
    cornerForCenter,
    rotateAboutCenter,
    resizeAboutCenter,
    signedArea,
    polygonArea,
    polygonBounds,
    polygonPerimeter,
    offsetPolygonOutward,
    rayDistance,
    wallClearances,
    itemBounds,
    alignmentSnap,
    pushToWall,
    wallSegments
  });
});
