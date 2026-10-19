/*
 * Zuglak Studio 2.0 – procedural 3D furniture models (Three.js).
 * Units are centimetres. Each builder returns a Group whose local frame is:
 * x ∈ [0, w] (width), z ∈ [0, d] (depth, back at z = 0), y ∈ [0, H] up.
 * Models are generated from the item's real width/depth/height, so their
 * footprint always equals the planned footprint. All assets are generated
 * locally – no external model files, no licensing concerns.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const Materials = window.ZuglakMaterials;
const Catalog = window.ZuglakCatalog;

const geometryCache = new Map();
const materialCache = new Map();
const textureCache = new Map();
let maxAnisotropy = 8;

export function setAnisotropy(value) { maxAnisotropy = value || 8; }

/** Box-projects UVs in centimetres so textures keep their real-world scale. */
export function applyWorldUV(geometry) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  if (!position || !normal) return geometry;
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    const nx = Math.abs(normal.getX(index));
    const ny = Math.abs(normal.getY(index));
    const nz = Math.abs(normal.getZ(index));
    const x = position.getX(index); const y = position.getY(index); const z = position.getZ(index);
    let u; let v;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
    uv[index * 2] = u; uv[index * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

function cachedGeometry(key, factory) {
  if (!geometryCache.has(key)) geometryCache.set(key, applyWorldUV(factory()));
  return geometryCache.get(key);
}

function texture(material, size) {
  const key = `${material.id}|${size}`;
  if (!textureCache.has(key)) {
    const canvas = Materials.makeTextureCanvas(material, size);
    const value = new THREE.CanvasTexture(canvas);
    value.colorSpace = THREE.SRGBColorSpace;
    value.wrapS = value.wrapT = THREE.RepeatWrapping;
    value.repeat.set(1 / material.tile, 1 / material.tile);
    value.anisotropy = maxAnisotropy;
    textureCache.set(key, value);
  }
  return textureCache.get(key);
}

/** Physically based material for a library id (cached). */
export function material(id, variant = '') {
  const key = `${id}|${variant}`;
  if (materialCache.has(key)) return materialCache.get(key);
  const def = Materials.get(id, 'wood-white');
  const textured = def.pattern && def.pattern !== 'plain' && def.tile;
  const isFloor = def.group === 'floor';
  const params = {
    color: textured ? '#ffffff' : def.color,
    roughness: def.roughness ?? 0.7,
    metalness: def.metalness ?? 0
  };
  if (textured) {
    params.map = texture(def, isFloor ? 1024 : 512);
    if (['planks', 'herringbone', 'tiles', 'stone'].includes(def.pattern)) {
      params.bumpMap = params.map;
      params.bumpScale = isFloor ? 0.6 : 0.3;
    }
  }
  let value;
  if (def.group === 'fabric' && def.pattern !== 'plain') {
    value = new THREE.MeshPhysicalMaterial({ ...params, sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color(Materials.shade(def.color, 0.35)) });
  } else if (def.transparent) {
    value = new THREE.MeshPhysicalMaterial({ ...params, transparent: true, opacity: def.opacity ?? 0.3, roughness: 0.04, metalness: 0, envMapIntensity: 1.4, depthWrite: false });
  } else if (def.group === 'ceramic' || def.group === 'stone') {
    value = new THREE.MeshPhysicalMaterial({ ...params, clearcoat: def.roughness < 0.3 ? 0.6 : 0.1, clearcoatRoughness: 0.2 });
  } else {
    value = new THREE.MeshStandardMaterial(params);
  }
  if (def.emissive) { value.emissive = new THREE.Color(def.emissive); value.emissiveIntensity = 0.9; }
  if (variant === 'dark') value.color.multiplyScalar(0.55);
  value.name = id;
  materialCache.set(key, value);
  return value;
}

const fixed = {
  shadowGap: () => material('wood-graphite', 'dark'),
  white: () => material('linen-white'),
  black: () => material('metal-black'),
  steel: () => material('metal-steel'),
  glass: () => material('ceramic-glass'),
  ceramic: () => material('ceramic-white'),
  screen: () => material('screen-black'),
  glow: () => material('emissive-warm'),
  leaf: () => leafMaterial(0),
  soil: () => { const value = material('wood-black'); return value; }
};

const leafMaterials = [];
function leafMaterial(index) {
  if (!leafMaterials.length) {
    for (const color of ['#3e6a45', '#4c7a4f', '#5b8a58', '#2f5a3b', '#68965f']) {
      leafMaterials.push(new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide }));
    }
  }
  return leafMaterials[index % leafMaterials.length];
}

/** Builder context: helpers that add meshes to a group in local centimetres. */
function makeKit(group, mats) {
  const m = slot => (typeof slot === 'string' && mats[slot] ? material(mats[slot]) : slot instanceof THREE.Material ? slot : material(mats.primary || 'wood-white'));
  const add = (geometry, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geometry, m(mat));
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // Box defined by min corner + size (local coordinates).
  const box = (x, y, z, w, h, d, mat, radius = 0, rot = null) => {
    const r = Math.max(0, Math.min(radius, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
    const key = `rb|${w.toFixed(2)}|${h.toFixed(2)}|${d.toFixed(2)}|${r.toFixed(2)}`;
    const geometry = cachedGeometry(key, () => (r > 0.05 ? new RoundedBoxGeometry(w, h, d, r > 2 ? 4 : 2, r) : new THREE.BoxGeometry(w, h, d)));
    const mesh = add(geometry, mat, x + w / 2, y + h / 2, z + d / 2);
    if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    return mesh;
  };
  const cyl = (cx, y, cz, rTop, rBottom, h, mat, segments = 24) => {
    const key = `cy|${rTop.toFixed(2)}|${rBottom.toFixed(2)}|${h.toFixed(2)}|${segments}`;
    const geometry = cachedGeometry(key, () => new THREE.CylinderGeometry(rTop, rBottom, h, segments));
    return add(geometry, mat, cx, y + h / 2, cz);
  };
  const lathe = (cx, y, cz, profile, mat, segments = 40) => {
    const key = `la|${profile.map(p => p.join(',')).join(';')}|${segments}`;
    const geometry = cachedGeometry(key, () => new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), segments));
    return add(geometry, mat, cx, y, cz);
  };
  const sphere = (cx, cy, cz, rx, ry, rz, mat, segments = 20) => {
    const geometry = cachedGeometry(`sp|${segments}`, () => new THREE.SphereGeometry(1, segments, Math.round(segments * 0.7)));
    const mesh = add(geometry, mat, cx, cy, cz);
    mesh.scale.set(rx, ry, rz);
    return mesh;
  };
  const torus = (cx, cy, cz, radius, tube, mat, rx = Math.PI / 2, arc = Math.PI * 2) => {
    const key = `to|${radius.toFixed(2)}|${tube.toFixed(2)}|${arc.toFixed(2)}`;
    const geometry = cachedGeometry(key, () => new THREE.TorusGeometry(radius, tube, 12, 48, arc));
    return add(geometry, mat, cx, cy, cz, rx);
  };
  const tube = (points, radius, mat) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const geometry = applyWorldUV(new THREE.TubeGeometry(curve, 48, radius, 10, false));
    return add(geometry, mat, 0, 0, 0);
  };
  const legs = (w, d, inset, height, radius, mat, taper = 0.75) => {
    for (const [x, z] of [[inset, inset], [w - inset, inset], [inset, d - inset], [w - inset, d - inset]]) cyl(x, 0, z, radius * taper, radius, height, mat, 14);
  };
  return { group, m, add, box, cyl, lathe, sphere, torus, tube, legs };
}

function cushionRow(k, x0, x1, y, z, depth, height, count, mat, radius = 5) {
  const gap = 1.2;
  const width = (x1 - x0 - gap * (count - 1)) / count;
  for (let index = 0; index < count; index += 1) {
    k.box(x0 + index * (width + gap), y, z, width, height, depth, mat, radius);
  }
}

const builders = {
  sofa(k, w, d, H) {
    const legH = 9; const baseH = 18; const arm = Math.min(Math.max(12, w * 0.08), 22);
    const armH = Math.min(H * 0.78, 64); const backDepth = Math.min(22, d * 0.24);
    k.legs(w, d, 6, legH, 2, 'secondary');
    k.box(0, legH, 0, w, baseH, d, 'primary', 3);
    k.box(0, legH, 0, arm, armH - legH, d, 'primary', 6);
    k.box(w - arm, legH, 0, arm, armH - legH, d, 'primary', 6);
    k.box(arm, legH + baseH - 2, 0, w - arm * 2, H - legH - baseH + 2, backDepth * 0.65, 'primary', 5);
    const seats = w - 2 * arm > 150 ? 3 : w - 2 * arm > 90 ? 2 : 1;
    cushionRow(k, arm + 0.6, w - arm - 0.6, legH + baseH, backDepth * 0.55, d - backDepth * 0.55 - 1, 15, seats, 'primary', 6);
    // Back cushions leaning slightly backwards
    const gap = 1.2; const bw = (w - arm * 2 - gap * (seats - 1)) / seats;
    for (let index = 0; index < seats; index += 1) {
      const mesh = k.box(arm + index * (bw + gap), legH + baseH + 12, backDepth * 0.45, bw, H - legH - baseH - 12, 16, 'primary', 7);
      mesh.rotation.x = -0.14;
    }
    if (w > 120) {
      const pillow = 42;
      for (const [cx, rot] of [[arm + pillow * 0.55, 0.25], [w - arm - pillow * 0.55, -0.25]]) {
        const mesh = k.box(cx - pillow / 2, legH + baseH + 12, backDepth + 4, pillow, pillow * 0.86, 13, mats(k).tertiary ? 'tertiary' : 'primary', 6);
        mesh.rotation.set(-0.3, rot, rot * 0.3);
      }
    }
  },
  sectional(k, w, d, H) {
    const legH = 8; const baseH = 18; const arm = 16; const chaise = Math.min(100, Math.max(80, w * 0.34));
    const depth = Math.min(100, d * 0.6); const backDepth = 20;
    k.legs(w, depth, 6, legH, 2, 'secondary');
    k.cyl(w - chaise + 6, 0, d - 6, 1.5, 2, legH, 'secondary', 12);
    k.cyl(w - 6, 0, d - 6, 1.5, 2, legH, 'secondary', 12);
    k.box(0, legH, 0, w, baseH, depth, 'primary', 3);
    k.box(w - chaise, legH, 0, chaise, baseH, d, 'primary', 3);
    k.box(0, legH, 0, arm, 52, depth, 'primary', 6);
    k.box(w - arm, legH, 0, arm, 52, d, 'primary', 6);
    k.box(arm, legH + baseH - 2, 0, w - arm * 2, H - legH - baseH + 2, backDepth * 0.65, 'primary', 5);
    const seatsW = w - chaise - arm;
    const seats = seatsW > 150 ? 2 : 1;
    cushionRow(k, arm + 0.6, w - chaise - 0.6, legH + baseH, backDepth * 0.55, depth - backDepth * 0.55 - 1, 15, seats, 'primary', 6);
    k.box(w - chaise + 0.6, legH + baseH, backDepth * 0.55, chaise - arm - 1.2, 15, d - backDepth * 0.55 - 1, 'primary', 6);
    const count = Math.max(2, Math.round((w - 2 * arm) / 75));
    const bw = (w - 2 * arm - (count - 1) * 1.2) / count;
    for (let index = 0; index < count; index += 1) {
      const mesh = k.box(arm + index * (bw + 1.2), legH + baseH + 12, backDepth * 0.45, bw, H - legH - baseH - 12, 16, 'primary', 7);
      mesh.rotation.x = -0.14;
    }
    const mesh = k.box(arm + 6, legH + baseH + 12, backDepth + 4, 42, 36, 13, 'primary', 6);
    mesh.rotation.set(-0.3, 0.3, 0.08);
  },
  armchair(k, w, d, H) {
    const legH = 14; const arm = Math.max(8, w * 0.13);
    for (const [x, z] of [[5, 5], [w - 5, 5], [5, d - 5], [w - 5, d - 5]]) k.cyl(x, 0, z, 1.4, 2, legH, 'secondary', 12);
    k.box(0, legH, 0, w, 14, d, 'primary', 5);
    k.box(0, legH, 3, arm, 40, d - 3, 'primary', 6);
    k.box(w - arm, legH, 3, arm, 40, d - 3, 'primary', 6);
    const back = k.box(arm * 0.6, legH + 6, 1, w - arm * 1.2, H - legH - 6, 16, 'primary', 8);
    back.rotation.x = -0.12;
    k.box(arm, legH + 14, 14, w - arm * 2, 12, d - 16, 'primary', 6);
  },
  pouf(k, w, d, H) {
    const r = Math.min(w, d) / 2;
    k.lathe(w / 2, 0, d / 2, [[0, 0], [r * 0.92, 0], [r, H * 0.25], [r * 0.98, H * 0.8], [r * 0.85, H * 0.97], [0, H]], 'primary');
  },
  table(k, w, d, H) {
    const top = 3.6; const leg = Math.min(6, Math.min(w, d) * 0.06); const inset = Math.min(7, Math.min(w, d) * 0.08);
    k.box(0, H - top, 0, w, top, d, 'primary', 1.2);
    k.box(inset, H - top - 7, inset, w - inset * 2, 7, d - inset * 2, 'secondary', 0.4);
    for (const [x, z] of [[inset, inset], [w - inset - leg, inset], [inset, d - inset - leg], [w - inset - leg, d - inset - leg]]) {
      k.box(x, 0, z, leg, H - top, leg, 'secondary', 0.8);
    }
  },
  'table-round'(k, w, d, H) {
    const r = Math.min(w, d) / 2;
    k.cyl(w / 2, H - 3.6, d / 2, r, r - 0.6, 3.6, 'primary', 64);
    k.cyl(w / 2, 0, d / 2, r * 0.32, r * 0.36, 2.4, 'secondary', 40);
    k.lathe(w / 2, 2.4, d / 2, [[0, 0], [5.5, 0], [4, (H - 6) * 0.5], [5.5, H - 6], [0, H - 6]], 'secondary', 32);
  },
  'coffee-table'(k, w, d, H) {
    const top = 3; const r = Math.min(12, d * 0.2);
    k.box(0, H - top, 0, w, top, d, 'primary', Math.min(r, 1.4));
    k.box(3, 12, 3, w - 6, 2, d - 6, 'primary', 0.8);
    for (const [x, z] of [[4, 4], [w - 4, 4], [4, d - 4], [w - 4, d - 4]]) k.cyl(x, 0, z, 1.4, 1.4, H - top, 'secondary', 10);
    k.box(w * 0.18, H, d * 0.3, w * 0.22, 3, d * 0.36, material('wood-white'), 0.3);
    k.box(w * 0.2, H + 3, d * 0.34, w * 0.18, 2.4, d * 0.28, material('fabric-stone-grey'), 0.3);
    k.lathe(w * 0.7, H, d * 0.5, [[0, 0], [4, 0], [5, 6], [3, 14], [1.6, 18], [2.4, 20], [0, 20]], material('ceramic-terracotta'));
  },
  'coffee-round'(k, w, d, H) {
    const r = Math.min(w, d) / 2;
    k.cyl(w / 2, H - 4, d / 2, r, r, 4, 'primary', 64);
    k.cyl(w / 2, 0, d / 2, r * 0.72, r * 0.72, H - 4, 'primary', 64);
    k.box(w * 0.3, H, d * 0.35, w * 0.26, 3, d * 0.2, material('wood-white'), 0.3);
    k.lathe(w * 0.64, H, d * 0.6, [[0, 0], [3.5, 0], [4.5, 7], [2, 15], [0, 15]], material('ceramic-white'));
  },
  'side-table'(k, w, d, H) {
    const r = Math.min(w, d) / 2;
    k.cyl(w / 2, H - 2.5, d / 2, r, r, 2.5, 'primary', 48);
    for (let index = 0; index < 3; index += 1) {
      const angle = index * Math.PI * 2 / 3;
      const mesh = k.cyl(w / 2 + Math.cos(angle) * r * 0.55, 0, d / 2 + Math.sin(angle) * r * 0.55, 0.9, 1.1, H - 2.5, 'secondary', 10);
      mesh.rotation.set(Math.sin(angle) * 0.12, 0, -Math.cos(angle) * 0.12);
    }
  },
  chair(k, w, d, H) {
    const seatH = 45; const leg = 3.2;
    for (const [x, z] of [[w * 0.08, d * 0.12], [w * 0.92 - leg, d * 0.12], [w * 0.08, d * 0.9 - leg], [w * 0.92 - leg, d * 0.9 - leg]]) k.box(x, 0, z, leg, seatH - 3, leg, 'primary', 0.8);
    k.box(w * 0.04, seatH - 3, d * 0.08, w * 0.92, 3, d * 0.88, 'primary', 1);
    k.box(w * 0.1, seatH, d * 0.18, w * 0.8, 3, d * 0.72, 'secondary', 1.4);
    for (const x of [w * 0.08, w * 0.92 - leg]) {
      const post = k.box(x, seatH, d * 0.08, leg, H - seatH, leg, 'primary', 0.8);
      post.rotation.x = -0.08;
    }
    const rest = k.box(w * 0.06, H - 14, 0, w * 0.88, 11, 2.4, 'primary', 1);
    rest.rotation.x = -0.08;
  },
  'chair-upholstered'(k, w, d, H) {
    const seatH = 46;
    for (const [x, z] of [[5, 6], [w - 5, 6], [5, d - 5], [w - 5, d - 5]]) k.cyl(x, 0, z, 1.2, 1.6, seatH - 8, 'secondary', 10);
    k.box(w * 0.03, seatH - 9, d * 0.1, w * 0.94, 10, d * 0.88, 'primary', 5);
    const back = k.box(w * 0.02, seatH - 2, 0, w * 0.96, H - seatH + 2, 9, 'primary', 4.5);
    back.rotation.x = -0.1;
  },
  bench(k, w, d, H) {
    k.box(0, H - 4, 0, w, 4, d, 'primary', 0.8);
    for (const x of [6, w - 9]) k.box(x, 0, 3, 3, H - 4, d - 6, 'primary', 0.6);
    k.box(9, 10, d / 2 - 1.5, w - 18, 3, 3, 'primary', 0.4);
  },
  stool(k, w, d, H) {
    const r = Math.min(w, d) / 2;
    for (let index = 0; index < 4; index += 1) {
      const angle = Math.PI / 4 + index * Math.PI / 2;
      const mesh = k.cyl(w / 2 + Math.cos(angle) * r * 0.62, 0, d / 2 + Math.sin(angle) * r * 0.62, 1, 1.3, H - 3, 'secondary', 10);
      mesh.rotation.set(Math.sin(angle) * 0.1, 0, -Math.cos(angle) * 0.1);
    }
    k.torus(w / 2, H * 0.32, d / 2, r * 0.62, 0.8, 'secondary');
    k.cyl(w / 2, H - 4, d / 2, r * 0.95, r * 0.9, 4, 'primary', 40);
  },
  bed(k, w, d, H, item) {
    const frame = Math.max(4, Math.min(8, w * 0.04)); const legH = 10; const frameH = 22; const head = Math.max(7, d * 0.045);
    const mattressTop = legH + frameH + 20;
    k.legs(w, d, 6, legH, 2.4, 'primary', 1);
    k.box(0, legH, 0, w, frameH, d, 'primary', 1.5);
    k.box(0, legH, 0, w, Math.max(H, mattressTop + 30) - legH, head, 'primary', 2);
    k.box(frame, legH + frameH - 4, head, w - frame * 2, 24, d - head - frame, fixed.white(), 5);
    const single = w < 130;
    const pillowW = single ? (w - frame * 2) * 0.7 : (w - frame * 2) / 2 - 6;
    const pillows = single ? [w / 2 - pillowW / 2] : [frame + 4, w / 2 + 2];
    for (const x of pillows) {
      const pillow = k.box(x, mattressTop - 1, head + 2, pillowW, 13, Math.min(40, d * 0.18), 'secondary', 6);
      pillow.rotation.x = -0.16;
    }
    const duvetZ = head + Math.min(40, d * 0.18) + 6;
    k.box(frame - 1.5, mattressTop - 6, duvetZ, w - frame * 2 + 3, 11, d - duvetZ - frame + 2, 'secondary', 5);
    const throwD = Math.min(48, d * 0.24);
    k.box(frame - 2.5, mattressTop + 3.4, d - frame - throwD, w - frame * 2 + 5, 2.4, throwD + 1.5, 'tertiary', 1.1);
    k.box(frame - 2.6, mattressTop - 12, d - frame - throwD, 1.6, 16, throwD + 1, 'tertiary', 0.7);
    k.box(w - frame + 1, mattressTop - 12, d - frame - throwD, 1.6, 16, throwD + 1, 'tertiary', 0.7);
    void item;
  },
  'bed-kids'(k, w, d, H, item) {
    builders.bed(k, w, d, Math.max(H, 70), item);
    for (const x of [0, w - 3]) k.box(x, 52, d * 0.3, 3, 14, d * 0.5, 'primary', 1);
  },
  crib(k, w, d, H) {
    for (const [x, z] of [[0, 0], [w - 4, 0], [0, d - 4], [w - 4, d - 4]]) k.box(x, 0, z, 4, H, 4, 'primary', 0.8);
    k.box(2, 20, 2, w - 4, 4, d - 4, 'primary', 0.6);
    k.box(4, 24, 4, w - 8, 10, d - 8, fixed.white(), 3);
    for (const [z0, z1] of [[0, 0], [d - 2.4, d - 2.4]]) {
      k.box(2, H - 4, z0, w - 4, 4, 2.4, 'primary', 0.6);
      for (let x = 8; x < w - 6; x += 8) k.cyl(x, 24, z1 + 1.2, 1, 1, H - 28, 'primary', 8);
    }
    for (const x0 of [0, w - 2.4]) {
      k.box(x0, H - 4, 2, 2.4, 4, d - 4, 'primary', 0.6);
      for (let z = 8; z < d - 6; z += 8) k.cyl(x0 + 1.2, 24, z, 1, 1, H - 28, 'primary', 8);
    }
    k.box(w * 0.25, 33, 8, w * 0.5, 7, d * 0.16, 'secondary', 3);
  },
  nightstand(k, w, d, H) {
    k.legs(w, d, 3, 10, 1.4, 'primary', 0.8);
    k.box(0, 10, 0, w, H - 10, d, 'primary', 1);
    k.box(1.5, 12, d - 0.5, w - 3, (H - 14) / 2 - 0.6, 1, 'primary', 0.4);
    k.box(1.5, 12 + (H - 14) / 2 + 0.6, d - 0.5, w - 3, (H - 14) / 2 - 0.6, 1, 'primary', 0.4);
    k.box(w / 2 - 5, H - 12, d + 0.4, 10, 1.4, 1.4, 'secondary', 0.6);
    k.lathe(w * 0.4, H, d * 0.45, [[0, 0], [5, 0], [6, 4], [4, 12], [1, 16], [0, 16]], material('ceramic-white'));
    k.lathe(w * 0.4, H + 16, d * 0.45, [[0.1, 0], [9, 0], [7, 14], [0.1, 14]], material('fabric-oat'));
  },
  wardrobe(k, w, d, H) {
    const plinth = 8;
    k.box(1.5, 0, 1.5, w - 3, plinth, d - 4, fixed.shadowGap(), 0);
    k.box(0, plinth, 0, w, H - plinth, d - 2, 'primary', 0.6);
    const doors = Math.max(1, Math.round(w / 50));
    const doorW = (w - (doors + 1) * 0.4) / doors;
    for (let index = 0; index < doors; index += 1) {
      const x = 0.4 + index * (doorW + 0.4);
      k.box(x, plinth + 0.4, d - 2, doorW, H - plinth - 0.8, 2, 'primary', 0.4);
      const handleX = index % 2 === 0 ? x + doorW - 4 : x + 3;
      k.box(handleX, plinth + (H - plinth) * 0.42, d, 1.2, 28, 1.6, 'secondary', 0.5);
    }
  },
  bookcase(k, w, d, H) {
    const t = 1.8;
    k.box(0, 0, 0, t, H, d, 'primary', 0.2);
    k.box(w - t, 0, 0, t, H, d, 'primary', 0.2);
    k.box(t, 0, 0, w - t * 2, H, 0.8, 'primary', 0);
    const shelves = Math.max(2, Math.round(H / 38));
    const spacing = (H - t) / shelves;
    const bookColors = ['#a35d47', '#3f5a6b', '#d4b483', '#6f8a6a', '#e8e0d0', '#7b5b8a', '#c88d5a', '#2f3b40'];
    let seed = 7;
    const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let index = 0; index <= shelves; index += 1) {
      const y = index * spacing;
      k.box(t, y, 0.8, w - t * 2, t, d - 0.8, 'primary', 0.2);
      if (index < shelves && index > 0) {
        let x = t + 1;
        while (x < w - t - 6) {
          if (random() < 0.12) { x += 8; continue; }
          const bw = 2 + random() * 3; const bh = spacing * (0.55 + random() * 0.35);
          const mesh = k.box(x, y + t, d * 0.2, bw, bh, d * 0.7, new THREE.MeshStandardMaterial({ color: bookColors[Math.floor(random() * bookColors.length)], roughness: 0.8 }), 0.2);
          if (random() < 0.1) mesh.rotation.z = 0.12;
          x += bw + 0.4;
        }
      }
    }
  },
  'cube-shelf'(k, w, d, H) {
    const t = 1.6;
    const cols = Math.max(1, Math.round(w / 36)); const rows = Math.max(1, Math.round(H / 36));
    for (let c = 0; c <= cols; c += 1) k.box(c * (w - t) / cols, 0, 0, t, H, d, 'primary', 0.2);
    for (let r = 0; r <= rows; r += 1) k.box(0, r * (H - t) / rows, 0, w, t, d, 'primary', 0.2);
    k.box(0, 0, 0, w, H, 0.6, 'primary', 0);
    const cw = (w - t) / cols; const ch = (H - t) / rows;
    for (let c = 0; c < cols; c += 1) for (let r = 0; r < rows; r += 1) {
      if ((c + r * 2) % 3 === 0) k.box(c * cw + t + 1, r * ch + t, 3, cw - t - 2, ch - t - 0.5, d - 4, material(['fabric-oat', 'rug-jute', 'fabric-stone-grey'][(c + r) % 3]), 1.5);
    }
  },
  dresser(k, w, d, H) {
    k.legs(w, d, 4, 10, 1.6, 'primary', 0.7);
    k.box(0, 10, 0, w, H - 10, d - 1, 'primary', 0.8);
    const rows = H > 90 ? 4 : 3;
    const rowH = (H - 12) / rows;
    for (let r = 0; r < rows; r += 1) {
      k.box(1, 11 + r * rowH + 0.4, d - 1, w - 2, rowH - 0.8, 1, 'primary', 0.4);
      const handles = w > 100 ? 2 : 1;
      for (let index = 0; index < handles; index += 1) k.box(w * (index + 0.5) / handles - 5, 11 + r * rowH + rowH * 0.5, d, 10, 1.4, 1.4, 'secondary', 0.6);
    }
  },
  sideboard(k, w, d, H) {
    k.legs(w, d, 5, 14, 1.6, 'secondary', 0.7);
    k.box(0, 14, 0, w, H - 14, d - 1, 'primary', 0.8);
    const doors = Math.max(2, Math.round(w / 45));
    const dw = (w - 2) / doors;
    for (let index = 0; index < doors; index += 1) {
      k.box(1 + index * dw + 0.3, 15, d - 1, dw - 0.6, H - 16, 1, 'primary', 0.4);
      for (let s = 1; s < 6; s += 1) k.box(1 + index * dw + dw * s / 6, 17, d - 0.1, 0.4, H - 20, 0.4, material(mats(k).primary || 'wood-walnut', 'dark'), 0);
    }
    k.lathe(w * 0.78, H, d * 0.45, [[0, 0], [5, 0], [6, 10], [3, 22], [3.4, 26], [0, 26]], material('ceramic-white'));
  },
  'tv-bench'(k, w, d, H) {
    k.box(0, 0, 1, w, 6, d - 2, fixed.shadowGap(), 0);
    k.box(0, 6, 0, w, H - 6, d - 1, 'primary', 0.8);
    const doors = Math.max(2, Math.round(w / 45));
    const dw = (w - 2) / doors;
    for (let index = 0; index < doors; index += 1) k.box(1 + index * dw + 0.3, 7, d - 1, dw - 0.6, H - 8, 1, 'secondary', 0.4);
  },
  desk(k, w, d, H) {
    k.box(0, H - 2.6, 0, w, 2.6, d, 'primary', 0.8);
    for (const x of [3, w - 6]) { k.box(x, 0, 4, 3, H - 2.6, 3, 'secondary', 0.4); k.box(x, 0, d - 7, 3, H - 2.6, 3, 'secondary', 0.4); k.box(x, 6, 4, 3, 3, d - 8, 'secondary', 0.4); }
    k.box(w * 0.38, H, d * 0.3, 32, 1.4, 22, fixed.steel(), 0.6);
    const screen = k.box(w * 0.38, H + 1, d * 0.3, 32, 21, 0.8, fixed.screen(), 0.3);
    screen.rotation.x = -0.25;
    k.cyl(w * 0.12, H, d * 0.3, 6, 6, 1.2, material('metal-black'), 24);
    k.cyl(w * 0.12, H + 1.2, d * 0.3, 0.6, 0.6, 32, material('metal-black'), 8);
    k.lathe(w * 0.12, H + 30, d * 0.3, [[0.1, 0], [8, 0], [5, 12], [0.1, 12]], material('fabric-oat'));
  },
  'office-chair'(k, w, d, H) {
    const cx = w / 2; const cz = d / 2;
    for (let index = 0; index < 5; index += 1) {
      const angle = index * Math.PI * 2 / 5;
      const leg = k.box(cx - 1.5, 5, cz - 1.5, 3, 3, Math.min(w, d) * 0.44, 'secondary', 1);
      leg.geometry.translate(0, 0, 0);
      leg.position.set(cx + Math.sin(angle) * Math.min(w, d) * 0.22, 6.5, cz + Math.cos(angle) * Math.min(w, d) * 0.22);
      leg.rotation.y = angle;
      k.sphere(cx + Math.sin(angle) * Math.min(w, d) * 0.44, 2.5, cz + Math.cos(angle) * Math.min(w, d) * 0.44, 2.5, 2.5, 2.5, fixed.black());
    }
    k.cyl(cx, 6, cz, 2.2, 2.6, 36, 'secondary', 16);
    k.box(w * 0.17, 42, d * 0.22, w * 0.66, 8, d * 0.62, 'primary', 4);
    const back = k.box(w * 0.18, 50, d * 0.12, w * 0.64, H - 50, 6, 'primary', 3);
    back.rotation.x = -0.12;
  },
  'kitchen-base'(k, w, d, H, item, options = {}) {
    const plinth = 10; const top = 4;
    k.box(0.5, 0, 5, w - 1, plinth, d - 7, fixed.shadowGap(), 0);
    k.box(0, plinth, 0, w, H - plinth - top, d - 4, 'primary', 0.3);
    k.box(-0.2, H - top, -0.2, w + 0.4, top, d + 0.4, 'secondary', 0.4);
    const fronts = options.drawers ? [0.26, 0.37, 0.37] : [1];
    let y = plinth + 0.3;
    const total = H - plinth - top - 0.6;
    for (const fraction of fronts) {
      const fh = total * fraction - 0.3;
      if (!options.drawers && w > 70) {
        k.box(0.3, y, d - 4, w / 2 - 0.45, fh, 2, 'primary', 0.3);
        k.box(w / 2 + 0.15, y, d - 4, w / 2 - 0.45, fh, 2, 'primary', 0.3);
      } else k.box(0.3, y, d - 4, w - 0.6, fh, 2, 'primary', 0.3);
      k.box(w / 2 - Math.min(16, w * 0.3), y + fh - 4, d - 2, Math.min(32, w * 0.6), 1.2, 1.4, fixed.steel(), 0.5);
      y += fh + 0.3;
    }
  },
  'kitchen-drawers'(k, w, d, H, item) { builders['kitchen-base'](k, w, d, H, item, { drawers: true }); },
  'kitchen-sink'(k, w, d, H, item) {
    builders['kitchen-base'](k, w, d, H, item);
    const bw = Math.min(w - 16, 56); const bd = Math.min(d - 18, 40);
    k.box((w - bw) / 2, H - 0.2, d * 0.28, bw, 0.4, bd, fixed.steel(), 1);
    k.box((w - bw) / 2 + 2, H - 0.1, d * 0.28 + 2, bw - 4, 0.4, bd - 4, material('metal-steel', 'dark'), 3);
    k.cyl(w / 2, H, d * 0.14, 1.6, 2, 4, fixed.steel(), 16);
    k.tube([[w / 2, H + 3, d * 0.14], [w / 2, H + 26, d * 0.14], [w / 2, H + 30, d * 0.22], [w / 2, H + 22, d * 0.32]], 1.1, fixed.steel());
  },
  'kitchen-hob'(k, w, d, H, item) {
    builders['kitchen-base'](k, w, d, H, item, { drawers: true });
    const bw = Math.min(w - 8, 56); const bd = Math.min(d - 12, 50);
    k.box((w - bw) / 2, H, (d - bd) / 2 - 2, bw, 0.6, bd, material('screen-black'), 0.8);
    for (const [fx, fz, r] of [[0.28, 0.3, 0.16], [0.72, 0.3, 0.12], [0.28, 0.72, 0.12], [0.72, 0.72, 0.16]]) {
      k.torus((w - bw) / 2 + bw * fx, H + 0.62, (d - bd) / 2 - 2 + bd * fz, bw * r, 0.18, material('metal-steel', 'dark'));
    }
  },
  'kitchen-tall'(k, w, d, H) {
    k.box(0.5, 0, 5, w - 1, 10, d - 7, fixed.shadowGap(), 0);
    k.box(0, 10, 0, w, H - 10, d - 2, 'primary', 0.3);
    const split = (H - 10) * 0.42;
    k.box(0.3, 10.3, d - 2, w - 0.6, split - 0.6, 2, 'primary', 0.3);
    k.box(0.3, 10 + split + 0.3, d - 2, w - 0.6, H - 10 - split - 0.6, 2, 'primary', 0.3);
    k.box(w - 4, 10 + split - 30, d, 1.2, 26, 1.4, 'secondary', 0.5);
    k.box(w - 4, 10 + split + 6, d, 1.2, 26, 1.4, 'secondary', 0.5);
  },
  fridge(k, w, d, H) {
    k.box(0, 0, 0, w, H, d - 3, 'primary', 1.5);
    k.box(0.3, 1, d - 3, w - 0.6, H * 0.36 - 1.4, 3, 'primary', 1.2);
    k.box(0.3, H * 0.36 + 0.4, d - 3, w - 0.6, H * 0.64 - 1.4, 3, 'primary', 1.2);
    k.box(w - 5, H * 0.36 + 6, d, 1.6, 40, 2, material('metal-steel', 'dark'), 0.6);
    k.box(w - 5, H * 0.36 - 34, d, 1.6, 28, 2, material('metal-steel', 'dark'), 0.6);
  },
  island(k, w, d, H) {
    const top = 4; const overhang = Math.min(25, d * 0.28);
    k.box(1, 0, overhang + 5, w - 2, 10, d - overhang - 7, fixed.shadowGap(), 0);
    k.box(0, 10, overhang, w, H - 10 - top, d - overhang, 'primary', 0.3);
    const doors = Math.max(2, Math.round(w / 60));
    const dw = w / doors;
    for (let index = 0; index < doors; index += 1) {
      k.box(index * dw + 0.3, 10.3, d - 0.2, dw - 0.6, H - 10 - top - 0.6, 1.4, 'primary', 0.3);
      for (let g = 1; g < 5; g += 1) k.box(index * dw + dw * g / 5, 12, d + 1.1, 0.6, H - top - 16, 0.4, material(mats(k).primary, 'dark'), 0);
    }
    k.box(0, H - top, 0, w, top, d, 'secondary', 0.4);
    k.lathe(w * 0.3, H, d * 0.4, [[0, 0], [12, 0], [13, 6], [0, 6]], material('wood-oak-natural'));
    for (const [x, z] of [[0.28, 0.36], [0.32, 0.44], [0.26, 0.45]]) k.sphere(w * x, H + 9, d * z, 3.6, 3.6, 3.6, new THREE.MeshStandardMaterial({ color: '#d9a441', roughness: 0.5 }));
  },
  bathtub(k, w, d, H) {
    const rim = 7;
    k.box(0, 0, 0, w, H - 2, d, 'primary', 2);
    k.box(0, H - 4, 0, w, 4, rim, 'primary', 2);
    k.box(0, H - 4, d - rim, w, 4, rim, 'primary', 2);
    k.box(0, H - 4, 0, rim, 4, d, 'primary', 2);
    k.box(w - rim, H - 4, 0, rim, 4, d, 'primary', 2);
    k.box(rim, H - 3.8, rim, w - rim * 2, 0.4, d - rim * 2, material('ceramic-white', 'dark'), Math.min(10, d * 0.2));
    k.box(rim + 2, H - 3.6, rim + 2, w - rim * 2 - 4, 0.3, d - rim * 2 - 4, new THREE.MeshPhysicalMaterial({ color: '#cfe3ea', roughness: 0.05, transparent: true, opacity: 0.5 }), Math.min(9, d * 0.18));
    k.cyl(rim / 2, H, d / 2, 1.4, 1.6, 6, 'secondary', 12);
    k.tube([[rim / 2, H + 5, d / 2], [rim / 2 + 2, H + 9, d / 2], [rim + 4, H + 7, d / 2]], 1, 'secondary');
  },
  shower(k, w, d, H) {
    k.box(0, 0, 0, w, 5, d, 'primary', 1);
    k.box(w / 2 - 6, 5, d / 2 - 6, 12, 0.3, 12, fixed.steel(), 0.1);
    k.box(0, 5, d - 1, w * 0.62, H - 5, 0.8, fixed.glass(), 0);
    k.box(w * 0.62 - 1.6, 5, d - 1.6, 1.6, H - 5, 1.6, 'secondary', 0.3);
    k.box(0, H - 2, d - 1.6, w * 0.62, 1.6, 1.6, 'secondary', 0.3);
    k.cyl(w / 2, H - 12, 2, 0.8, 0.8, 12, 'secondary', 10);
    k.box(w / 2 - 0.8, H - 2, 2, 1.6, 1.6, 16, 'secondary', 0.6);
    k.cyl(w / 2, H - 4, 18, 10, 10, 1.2, 'secondary', 32);
  },
  toilet(k, w, d, H) {
    k.box(w * 0.05, H - 42, 0, w * 0.9, 42, d * 0.3, 'primary', 3);
    k.box(w * 0.4, H - 1, d * 0.1, w * 0.2, 1.4, 6, fixed.steel(), 0.6);
    k.lathe(w / 2, 0, d * 0.62, [[0, 0], [w * 0.26, 0], [w * 0.3, 20], [w * 0.44, 38], [w * 0.45, 40], [0, 40]], 'primary');
    const seat = k.torus(w / 2, 41, d * 0.62, w * 0.34, 2.2, 'primary');
    seat.scale.set(1, 1.25, 1);
    k.box(w * 0.08, 39, d * 0.32, w * 0.84, 3, 6, 'primary', 1.4);
  },
  basin(k, w, d, H) {
    k.box(0, 20, 0, w, H - 34, d, 'primary', 1);
    k.box(0.4, 21, d - 0.2, w - 0.8, H - 36, 1, 'primary', 0.4);
    k.box(w / 2 - 8, H - 26, d + 0.6, 16, 1.4, 1.4, fixed.steel(), 0.6);
    k.box(0, H - 14, 0, w, 14, d, 'secondary', 3);
    const bowl = k.box(w * 0.18, H - 0.4, d * 0.28, w * 0.64, 0.6, d * 0.56, material('ceramic-white', 'dark'), Math.min(8, d * 0.2));
    void bowl;
    k.cyl(w / 2, H, d * 0.14, 1.4, 1.8, 4, fixed.steel(), 16);
    k.tube([[w / 2, H + 3, d * 0.14], [w / 2, H + 12, d * 0.14], [w / 2, H + 13, d * 0.26]], 0.9, fixed.steel());
  },
  washer(k, w, d, H) {
    k.box(0, 0, 0, w, H, d, 'primary', 2);
    k.box(2, H - 14, d - 0.4, w - 4, 12, 0.8, material('ceramic-white', 'dark'), 0.6);
    k.torus(w / 2, H * 0.45, d + 0.6, w * 0.3, 2.4, 'secondary', 0);
    k.cyl(w / 2, H * 0.45, d - 0.2, w * 0.27, w * 0.27, 1.4, fixed.glass(), 40).rotation.x = Math.PI / 2;
    k.cyl(w * 0.8, H - 8, d, 2.6, 2.6, 1.2, fixed.steel(), 24).rotation.x = Math.PI / 2;
  },
  rug(k, w, d) {
    k.box(0, 0, 0, w, 1.2, d, 'primary', 0.5);
  },
  'rug-round'(k, w, d) {
    k.cyl(w / 2, 0, d / 2, w / 2, w / 2, 1.2, 'primary', 64).scale.z = d / w;
  },
  'floor-lamp'(k, w, d, H) {
    const r = Math.min(w, d) / 2;
    k.cyl(w / 2, 0, d / 2, r * 0.6, r * 0.65, 2.4, 'secondary', 32);
    k.cyl(w / 2, 2.4, d / 2, 0.9, 0.9, H - 30, 'secondary', 10);
    k.lathe(w / 2, H - 34, d / 2, [[r * 0.98, 0], [r * 0.82, 30], [r * 0.8, 30.5], [r * 0.96, 0.5]], 'primary', 40);
    k.sphere(w / 2, H - 20, d / 2, 5, 5, 5, fixed.glow());
    return { light: { x: w / 2, y: H - 22, z: d / 2 } };
  },
  'arc-lamp'(k, w, d, H) {
    k.box(2, 0, d / 2 - 15, 30, 6, 30, 'secondary', 1.5);
    k.tube([[17, 6, d / 2], [20, H * 0.75, d / 2], [w * 0.55, H, d / 2], [w - 20, H * 0.82, d / 2], [w - 20, H * 0.75, d / 2]], 1.1, 'primary');
    k.lathe(w - 20, H * 0.75 - 18, d / 2, [[18, 0], [12, 12], [2, 18], [0, 18.5]], 'primary', 40);
    k.sphere(w - 20, H * 0.75 - 14, d / 2, 4, 4, 4, fixed.glow());
    return { light: { x: w - 20, y: H * 0.75 - 18, z: d / 2 } };
  },
  'table-lamp'(k, w, d, H) {
    const r = Math.min(w, d) / 2;
    k.lathe(w / 2, 0, d / 2, [[0, 0], [r * 0.45, 0], [r * 0.55, H * 0.15], [r * 0.35, H * 0.4], [r * 0.12, H * 0.5], [0, H * 0.5]], 'secondary');
    k.lathe(w / 2, H * 0.48, d / 2, [[r * 0.98, 0], [r * 0.72, H * 0.5], [r * 0.7, H * 0.51], [r * 0.96, 0.5]], 'primary', 40);
    return { light: { x: w / 2, y: H * 0.7, z: d / 2 } };
  },
  plant(k, w, d, H) {
    const r = Math.min(w, d) / 2;
    const potH = Math.min(42, H * 0.3);
    k.lathe(w / 2, 0, d / 2, [[0, 0], [r * 0.58, 0], [r * 0.72, potH * 0.92], [r * 0.76, potH], [r * 0.66, potH], [0, potH - 2]], 'primary');
    k.cyl(w / 2, potH - 3, d / 2, r * 0.62, r * 0.62, 1, fixed.soil(), 24);
    let seed = 11;
    const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const stems = 6;
    for (let s = 0; s < stems; s += 1) {
      const angle = s * Math.PI * 2 / stems + random();
      const lean = r * (0.15 + random() * 0.35);
      const top = potH + (H - potH) * (0.55 + random() * 0.45);
      const tx = w / 2 + Math.cos(angle) * lean; const tz = d / 2 + Math.sin(angle) * lean;
      k.tube([[w / 2, potH - 2, d / 2], [w / 2 + Math.cos(angle) * lean * 0.4, (potH + top) / 2, d / 2 + Math.sin(angle) * lean * 0.4], [tx, top, tz]], 0.5, new THREE.MeshStandardMaterial({ color: '#5b4a33', roughness: 0.9 }));
      const leaves = 4 + Math.floor(random() * 3);
      for (let l = 0; l < leaves; l += 1) {
        const t = 0.45 + l / leaves * 0.55;
        const ly = potH + (top - potH) * t;
        const la = angle + (random() - 0.5) * 2.5;
        const size = r * (0.32 + random() * 0.2);
        const leaf = k.sphere(w / 2 + Math.cos(angle) * lean * t + Math.cos(la) * size * 0.6, ly, d / 2 + Math.sin(angle) * lean * t + Math.sin(la) * size * 0.6, size, size * 0.12, size * 0.55, leafMaterial(s + l));
        leaf.rotation.set((random() - 0.5) * 0.9, -la, (random() - 0.5) * 0.6);
      }
    }
  },
  'plant-small'(k, w, d, H) {
    const r = Math.min(w, d) / 2;
    const potH = H * 0.45;
    k.lathe(w / 2, 0, d / 2, [[0, 0], [r * 0.55, 0], [r * 0.68, potH], [r * 0.6, potH], [0, potH - 1]], 'primary');
    for (let index = 0; index < 9; index += 1) {
      const angle = index * 2.4;
      const dist = index === 0 ? 0 : r * 0.35;
      k.sphere(w / 2 + Math.cos(angle) * dist, potH + (H - potH) * (index === 0 ? 0.6 : 0.4), d / 2 + Math.sin(angle) * dist, r * 0.42, (H - potH) * 0.38, r * 0.42, leafMaterial(index));
    }
  },
  tv(k, w, d, H) {
    k.box(w * 0.36, 0, 0, w * 0.28, 1.2, d, fixed.black(), 0.4);
    k.box(w / 2 - 3, 1.2, d / 2 - 1, 6, 6, 2, fixed.black(), 0.4);
    k.box(0, 6, d / 2 - 1.5, w, H - 6, 3, fixed.black(), 0.6);
    k.box(0.8, 6.8, d / 2 + 1.52, w - 1.6, H - 7.6, 0.1, new THREE.MeshPhysicalMaterial({ color: '#0e1114', roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 }), 0);
  },
  box(k, w, d, H) {
    k.box(0, 0, 0, w, H, d, 'primary', 1.2);
  }
};

function mats(k) { return k.mats || {}; }

/**
 * Builds a furniture group for an item. Returns { group, light } where light is an
 * optional local point for a lamp glow.
 */
export function buildFurniture(item) {
  const model = Catalog.modelFor(item);
  const materials = { ...Catalog.defaultMaterials(model), ...(item.materials || {}) };
  const group = new THREE.Group();
  const kit = makeKit(group, materials);
  kit.mats = materials;
  const w = Math.max(1, Number(item.w)); const d = Math.max(1, Number(item.h));
  const H = Math.max(1, Number(item.height) || Catalog.defaultHeight(model));
  let result = null;
  try {
    result = (builders[model] || builders.box)(kit, w, d, H, item);
  } catch (error) {
    console.warn('Model build failed, using box', model, error);
    group.clear();
    builders.box(makeKit(group, materials), w, d, H);
  }
  return { group, light: result?.light || null, height: H };
}

export function disposeCaches() {
  for (const value of textureCache.values()) value.dispose();
  textureCache.clear();
  for (const value of materialCache.values()) value.dispose();
  materialCache.clear();
}

export const models = Object.keys(builders);
