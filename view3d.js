/*
 * Zuglak Studio 2.0 – interactive 3D view (Three.js, bundled locally in /vendor).
 * The scene is generated from exactly the same plan data as the 2D editor:
 * the measured interior outline (cm), openings, partitions and furniture.
 * Coordinates: 1 unit = 1 cm; plan x → world x, plan y → world z, y is up.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildFurniture, material, applyWorldUV, setAnisotropy } from './models3d.js';

const Geometry = window.ZuglakGeometry;
const Catalog = window.ZuglakCatalog;
const Materials = window.ZuglakMaterials;

const DOOR_HEIGHT = 210;
const rad = degrees => degrees * Math.PI / 180;

function prismGeometry(points, y0, y1) {
  // points: 4 plan points {x, y} (cm), extruded from y0 to y1.
  const shape = new THREE.Shape(points.map(point => new THREE.Vector2(point.x, -point.y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.1, y1 - y0), bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y0, 0);
  geometry.computeVertexNormals();
  return applyWorldUV(geometry);
}

export function createView3D(container, app) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'view3d-canvas';
  container.append(renderer.domElement);
  setAnisotropy(renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  // The scene renders on a transparent background; the colour is composited
  // outside the tone-mapping chain so it stays exact on screen and in exports.
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;

  const hemi = new THREE.HemisphereLight('#ffffff', '#d8d1c6', 0.42);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff8ef', 2.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 9;
  sun.shadow.blurSamples = 16;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#e6eeff', 0.28);
  scene.add(fill, fill.target);

  const architecture = new THREE.Group();
  const furniture = new THREE.Group();
  const overlay = new THREE.Group();
  scene.add(architecture, furniture, overlay);

  // Cameras
  const perspective = new THREE.PerspectiveCamera(38, 1, 5, 20000);
  const bird = new THREE.PerspectiveCamera(30, 1, 5, 20000);
  const ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 20000);
  ortho.up.set(0, 0, -1);
  let camera = perspective;
  let cameraMode = 'perspective';

  const controls = new OrbitControls(perspective, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = rad(86);
  controls.minDistance = 60;
  controls.maxDistance = 6000;
  controls.screenSpacePanning = true;
  controls.addEventListener('change', () => { needsRender = true; });

  // Post-processing
  let composer = null;
  let gtao = null;
  let aoEnabled = true;
  function buildComposer() {
    composer?.dispose?.();
    const size = renderer.getSize(new THREE.Vector2());
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    if (aoEnabled) {
      gtao = new GTAOPass(scene, camera, size.x, size.y);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 1.0;
      gtao.updateGtaoMaterial({ radius: 32, distanceExponent: 1.6, thickness: 8, scale: 1.25, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      composer.addPass(gtao);
    }
    composer.addPass(new OutputPass());
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
  }

  let state = null;
  let bounds = { minX: 0, minY: 0, maxX: 400, maxY: 400 };
  let needsRender = true;
  let visible = false;
  let disposed = false;
  let archKey = '';
  const furnitureMap = new Map();
  const lampLights = [];
  let selectionOutline = null;
  let sunAzimuth = 225;
  let cutaway = false;
  let autoCut = true;

  function disposeGroup(group) {
    group.traverse(object => {
      if (object.geometry && !object.geometry.userData.shared) object.geometry.dispose?.();
    });
    group.clear();
  }

  // ---------- Architecture ----------
  function buildArchitecture() {
    disposeGroup(architecture);
    const geometry = state.geometry;
    if (!geometry || !geometry.closed || geometry.vertices.length < 3) {
      const grid = new THREE.GridHelper(1000, 20, '#cbbfae', '#e0d8cc');
      architecture.add(grid);
      bounds = { minX: -500, minY: -500, maxX: 500, maxY: 500 };
      return;
    }
    const vertices = geometry.vertices;
    const thickness = state.wallThickness;
    const wallHeight = cutaway ? Math.min(state.wallHeight, 105) : state.wallHeight;
    const outer = Geometry.offsetPolygonOutward(vertices, thickness);
    bounds = Geometry.polygonBounds(outer);

    // Floor
    const shape = new THREE.Shape(vertices.map(point => new THREE.Vector2(point.x, -point.y)));
    const floorGeometry = new THREE.ShapeGeometry(shape);
    floorGeometry.rotateX(-Math.PI / 2);
    // ShapeGeometry UVs are shape coords (x, -y) in cm: matches the texture repeat in cm.
    const floor = new THREE.Mesh(floorGeometry, material(state.materials.floor));
    floor.receiveShadow = true;
    floor.name = 'floor';
    architecture.add(floor);

    // Exterior ground (subtle, receives sun shadows from walls)
    const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.12 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.4;
    ground.receiveShadow = true;
    architecture.add(ground);

    const wallMaterial = material(state.materials.walls);
    const capMaterial = new THREE.MeshStandardMaterial({ color: '#e7e3dc', roughness: 0.95 });
    const skirtingMaterial = material('wood-white');
    const doorMaterial = material('wood-white');
    const frameMaterial = new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.6 });
    const glassMaterial = material('ceramic-glass');
    const sillMaterial = material('stone-white-quartz');
    const radiatorMaterial = new THREE.MeshStandardMaterial({ color: '#f5f5f3', roughness: 0.45, metalness: 0.1 });
    const n = vertices.length;
    const objects = geometry.objects || [];

    let target = architecture;
    const addMesh = (geom, mat, cast = true) => {
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      geom.computeBoundingBox();
      mesh.userData.y0 = geom.boundingBox.min.y;
      mesh.userData.y1 = geom.boundingBox.max.y;
      target.add(mesh);
      return mesh;
    };

    for (let index = 0; index < n; index += 1) {
      const a = vertices[index];
      const b = vertices[(index + 1) % n];
      const length = Geometry.distance(a, b);
      if (length < 0.5) continue;
      const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
      const outA = outer[index];
      const outB = outer[(index + 1) % n];
      // Outward normal derived from the offset polygon
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const outMid = { x: (outA.x + outB.x) / 2, y: (outA.y + outB.y) / 2 };
      const nl = Math.hypot(outMid.x - mid.x, outMid.y - mid.y) || 1;
      const normal = { x: (outMid.x - mid.x) / nl, y: (outMid.y - mid.y) / nl };
      const edgeGroup = new THREE.Group();
      edgeGroup.userData = { wall: true, normal: new THREE.Vector3(normal.x, 0, normal.y), center: new THREE.Vector3(mid.x, 0, mid.y) };
      architecture.add(edgeGroup);
      target = edgeGroup;
      const at = t => ({ x: a.x + tangent.x * t, y: a.y + tangent.y * t });
      const outerAt = t => {
        if (t <= 0.001) return outA;
        if (t >= length - 0.001) return outB;
        const p = at(t);
        return { x: p.x + normal.x * thickness, y: p.y + normal.y * thickness };
      };
      const quad = (t0, t1) => [at(t0), at(t1), outerAt(t1), outerAt(t0)];
      const inset = (t0, t1, depth) => {
        const p0 = at(t0); const p1 = at(t1);
        return [p0, p1, { x: p1.x - normal.x * depth, y: p1.y - normal.y * depth }, { x: p0.x - normal.x * depth, y: p0.y - normal.y * depth }];
      };

      const wallObjects = objects.filter(object => object.wallIndex === index).map(object => {
        const width = object.fullWall ? length : Number(object.width) || 0;
        const offset = object.fullWall ? length / 2 : Number(object.offset) || 0;
        return { ...object, t0: Math.max(0, offset - width / 2), t1: Math.min(length, offset + width / 2) };
      }).filter(object => object.t1 - object.t0 > 0.5 && object.type !== 'radiator').sort((p, q) => p.t0 - q.t0);

      let cursor = 0;
      const solid = (t0, t1) => {
        if (t1 - t0 < 0.3) return;
        addMesh(prismGeometry(quad(t0, t1), 0, wallHeight), [capMaterial, wallMaterial]);
        addMesh(prismGeometry(inset(t0, t1, 1.4), 0, 7), skirtingMaterial, false);
      };
      for (const object of wallObjects) {
        solid(cursor, object.t0);
        const t0 = object.t0; const t1 = object.t1;
        if (object.type === 'door') {
          if (wallHeight > DOOR_HEIGHT) addMesh(prismGeometry(quad(t0, t1), DOOR_HEIGHT, wallHeight), [capMaterial, wallMaterial]);
          // Door casing
          const casing = 6;
          for (const [s0, s1] of [[t0 - casing, t0], [t1, t1 + casing]]) {
            addMesh(prismGeometry(inset(Math.max(0, s0), Math.min(length, s1), 1.6), 0, Math.min(wallHeight, DOOR_HEIGHT + casing)), frameMaterial, false);
          }
          if (wallHeight > DOOR_HEIGHT) addMesh(prismGeometry(inset(Math.max(0, t0 - casing), Math.min(length, t1 + casing), 1.6), DOOR_HEIGHT, Math.min(wallHeight, DOOR_HEIGHT + casing)), frameMaterial, false);
          // Door leaf, drawn open 90° exactly like the 2D swing arc
          const zone = Geometry.doorClearancePolygon(object, vertices);
          if (zone.length > 2) {
            const hinge = zone[0]; const open = zone[zone.length - 1];
            const leafLength = Geometry.distance(hinge, open);
            const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafLength, Math.min(DOOR_HEIGHT - 2, wallHeight), 4), doorMaterial);
            const angle = Math.atan2(open.y - hinge.y, open.x - hinge.x);
            leaf.position.set((hinge.x + open.x) / 2, Math.min(DOOR_HEIGHT - 2, wallHeight) / 2, (hinge.y + open.y) / 2);
            leaf.rotation.y = -angle;
            leaf.castShadow = true; leaf.receiveShadow = true;
            leaf.userData.keep = true;
            edgeGroup.add(leaf);
            const handle = new THREE.Mesh(new THREE.BoxGeometry(12, 2, 8), material('metal-steel'));
            const hx = hinge.x + (open.x - hinge.x) * 0.9; const hz = hinge.y + (open.y - hinge.y) * 0.9;
            handle.position.set(hx, 104, hz);
            handle.rotation.y = -angle;
            handle.userData.keep = true;
            edgeGroup.add(handle);
          }
        } else if (object.type === 'window') {
          const sill = Math.min(Number(object.sill) || 85, wallHeight);
          const top = Math.min(wallHeight, sill + (Number(object.height) || 140));
          addMesh(prismGeometry(quad(t0, t1), 0, sill), [capMaterial, wallMaterial]);
          if (top < wallHeight) addMesh(prismGeometry(quad(t0, t1), top, wallHeight), [capMaterial, wallMaterial]);
          if (top > sill + 2) {
            // Frame in the middle of the wall thickness
            const frameDepth = 7;
            const mid0 = thickness * 0.35;
            const framePoly = (s0, s1) => {
              const p0 = at(s0); const p1 = at(s1);
              const off = (p, d) => ({ x: p.x + normal.x * d, y: p.y + normal.y * d });
              return [off(p0, mid0), off(p1, mid0), off(p1, mid0 + frameDepth), off(p0, mid0 + frameDepth)];
            };
            const f = 5;
            addMesh(prismGeometry(framePoly(t0, t0 + f), sill, top), frameMaterial);
            addMesh(prismGeometry(framePoly(t1 - f, t1), sill, top), frameMaterial);
            addMesh(prismGeometry(framePoly(t0, t1), sill, sill + f), frameMaterial);
            addMesh(prismGeometry(framePoly(t0, t1), top - f, top), frameMaterial);
            if (t1 - t0 > 90) {
              const m = (t0 + t1) / 2;
              addMesh(prismGeometry(framePoly(m - 2.5, m + 2.5), sill, top), frameMaterial);
            }
            const glass = addMesh(prismGeometry(framePoly(t0 + f, t1 - f).map((p, i) => i < 2 ? p : p), sill + f, top - f), glassMaterial, false);
            glass.scale.set(1, 1, 1);
            glass.renderOrder = 2;
            // Interior window board
            const board = inset(Math.max(0, t0 - 4), Math.min(length, t1 + 4), 4);
            const boardOut = [at(Math.max(0, t0 - 4)), at(Math.min(length, t1 + 4))].map(p => ({ x: p.x + normal.x * mid0, y: p.y + normal.y * mid0 }));
            addMesh(prismGeometry([board[3], board[2], boardOut[1], boardOut[0]], sill - 3, sill), sillMaterial);
          }
        }
        // 'opening': a passage without wall – nothing is built.
        cursor = Math.max(cursor, object.t1);
      }
      solid(cursor, length);

      // Radiators on this wall
      for (const object of objects.filter(value => value.wallIndex === index && value.type === 'radiator')) {
        const t0 = Math.max(0, (Number(object.offset) || 0) - (Number(object.width) || 0) / 2);
        const t1 = Math.min(length, (Number(object.offset) || 0) + (Number(object.width) || 0) / 2);
        const depth = Number(object.depth) || 10;
        const height = Number(object.height) || 60;
        const gapFromWall = 3;
        const p0 = at(t0); const p1 = at(t1);
        const off = (p, d) => ({ x: p.x - normal.x * d, y: p.y - normal.y * d });
        addMesh(prismGeometry([off(p0, gapFromWall), off(p1, gapFromWall), off(p1, gapFromWall + depth), off(p0, gapFromWall + depth)], 15, 15 + height), radiatorMaterial);
        const fins = Math.max(3, Math.round((t1 - t0) / 6));
        for (let fin = 1; fin < fins; fin += 1) {
          const t = t0 + (t1 - t0) * fin / fins;
          const q0 = at(t - 0.25); const q1 = at(t + 0.25);
          addMesh(prismGeometry([off(q0, gapFromWall + depth - 0.1), off(q1, gapFromWall + depth - 0.1), off(q1, gapFromWall + depth + 0.6), off(q0, gapFromWall + depth + 0.6)], 17, 13 + height), material('wood-white', 'dark'), false);
        }
      }
    }

    target = architecture;
    // Partitions (free-standing wall stubs)
    for (const part of geometry.partitions || []) {
      const length = Geometry.distance(part.a, part.b);
      if (length < 0.5) continue;
      const t = { x: (part.b.x - part.a.x) / length, y: (part.b.y - part.a.y) / length };
      const partThickness = Number(part.thickness) || thickness;
      const nrm = { x: -t.y * partThickness / 2, y: t.x * partThickness / 2 };
      const quad = [
        { x: part.a.x + nrm.x, y: part.a.y + nrm.y }, { x: part.b.x + nrm.x, y: part.b.y + nrm.y },
        { x: part.b.x - nrm.x, y: part.b.y - nrm.y }, { x: part.a.x - nrm.x, y: part.a.y - nrm.y }
      ];
      addMesh(prismGeometry(quad, 0, Math.min(wallHeight, Number(part.height) || wallHeight)), [capMaterial, wallMaterial]);
    }
  }

  function updateLighting() {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minY + bounds.maxY) / 2;
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 300);
    const azimuth = rad(sunAzimuth);
    const elevation = rad(60);
    const distance = span * 2;
    sun.position.set(cx + Math.cos(azimuth) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, cz + Math.sin(azimuth) * Math.cos(elevation) * distance);
    sun.target.position.set(cx, 0, cz);
    const shadowSpan = span * 0.85;
    Object.assign(sun.shadow.camera, { left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan, near: 1, far: distance * 3 });
    sun.shadow.camera.updateProjectionMatrix();
    fill.position.set(cx - Math.cos(azimuth) * distance, distance * 0.6, cz - Math.sin(azimuth) * distance);
    fill.target.position.set(cx, 0, cz);
  }

  // ---------- Furniture ----------
  function itemHash(item) {
    return JSON.stringify([Catalog.modelFor(item), item.w, item.h, item.height, item.materials || {}]);
  }

  function supportHeight(item, items) {
    if (Catalog.layerFor(item) !== 'top') return 0;
    const center = Geometry.itemCenter(item);
    let best = 0;
    for (const other of items) {
      if (other.id === item.id || Catalog.layerFor(other) !== 'main') continue;
      if (Geometry.pointInPolygon(center, Geometry.rotatedRectCorners(other), true)) {
        best = Math.max(best, Number(other.height) || Catalog.defaultHeight(Catalog.modelFor(other)));
      }
    }
    return best;
  }

  function syncFurniture() {
    const items = state.items;
    const seen = new Set();
    for (const item of items) {
      seen.add(item.id);
      let entry = furnitureMap.get(item.id);
      const hash = itemHash(item);
      if (!entry || entry.hash !== hash) {
        if (entry) { furniture.remove(entry.group); disposeGroup(entry.group); }
        const built = buildFurniture(item);
        const group = new THREE.Group();
        group.add(built.group);
        group.userData.itemId = item.id;
        built.group.traverse(object => { object.userData.itemId = item.id; });
        entry = { group, hash, light: built.light, height: built.height };
        furnitureMap.set(item.id, entry);
        furniture.add(group);
      }
      entry.group.position.set(item.x, supportHeight(item, items), item.y);
      entry.group.rotation.y = -rad(item.rot || 0);
    }
    for (const [id, entry] of furnitureMap) {
      if (!seen.has(id)) { furniture.remove(entry.group); disposeGroup(entry.group); furnitureMap.delete(id); }
    }
    // Lamp glow lights (limited for performance)
    for (const light of lampLights) scene.remove(light);
    lampLights.length = 0;
    for (const item of items) {
      const entry = furnitureMap.get(item.id);
      if (!entry?.light || lampLights.length >= 4) continue;
      const light = new THREE.PointLight('#ffe4bf', state.lampsOn ? 4500 : 0, 320, 1.7);
      const local = new THREE.Vector3(entry.light.x, entry.light.y, entry.light.z);
      entry.group.updateMatrixWorld(true);
      light.position.copy(local.applyMatrix4(entry.group.matrixWorld));
      scene.add(light);
      lampLights.push(light);
    }
    updateSelection();
  }

  function updateSelection() {
    overlay.clear();
    if (!state.selectedId || state.presentation) return;
    const item = state.items.find(value => value.id === state.selectedId);
    if (!item) return;
    const corners = Geometry.rotatedRectCorners(item, 3);
    const points = corners.map(point => new THREE.Vector3(point.x, 0.8, point.y));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#2f7d6d', linewidth: 2 }));
    overlay.add(line);
    const fillShape = new THREE.Shape(corners.map(point => new THREE.Vector2(point.x, -point.y)));
    const fillMesh = new THREE.Mesh(new THREE.ShapeGeometry(fillShape), new THREE.MeshBasicMaterial({ color: '#3f9a86', transparent: true, opacity: 0.16, depthWrite: false }));
    fillMesh.rotation.x = -Math.PI / 2;
    fillMesh.position.y = 0.6;
    overlay.add(fillMesh);
  }

  // ---------- Cameras ----------
  function fitCameras(resetPerspective = true, aspectOverride = null) {
    const rect = container.getBoundingClientRect();
    const aspect = aspectOverride || (rect.width > 2 && rect.height > 2 ? rect.width / rect.height : 1.5);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minY + bounds.maxY) / 2;
    const spanX = bounds.maxX - bounds.minX + 80;
    const spanZ = bounds.maxY - bounds.minY + 80;
    let halfH = spanZ / 2;
    let halfW = halfH * aspect;
    if (halfW < spanX / 2) { halfW = spanX / 2; halfH = halfW / aspect; }
    Object.assign(ortho, { left: -halfW, right: halfW, top: halfH, bottom: -halfH, zoom: 1 });
    ortho.position.set(cx, 3000, cz);
    ortho.lookAt(cx, 0, cz);
    ortho.updateProjectionMatrix();
    perspective.aspect = aspect;
    perspective.updateProjectionMatrix();
    bird.aspect = aspect;
    bird.updateProjectionMatrix();
    {
      const fitH = Math.max(spanZ, spanX / aspect) / 2;
      const height = fitH / Math.tan(rad(bird.fov / 2)) * 1.24;
      if (cameraMode === 'bird' && resetPerspective !== false) {
        bird.position.set(cx, height, cz + height * 0.16);
        controls.target.set(cx, 0, cz);
      } else if (cameraMode !== 'bird') {
        bird.position.set(cx, height, cz + height * 0.16);
      }
    }
    if (resetPerspective && cameraMode === 'perspective') {
      const span = Math.max(spanX, spanZ);
      const distance = span * 1.25;
      perspective.position.set(cx + distance * 0.55, distance * 0.85, cz + distance * 0.75);
      controls.target.set(cx, 40, cz);
    }
    if (cameraMode === 'top') { controls.target.set(cx, 0, cz); }
    if (cameraMode === 'bird' && resetPerspective) controls.target.set(cx, 0, cz);
    controls.update();
    needsRender = true;
  }

  function setCameraMode(mode) {
    cameraMode = ['top', 'bird'].includes(mode) ? mode : 'perspective';
    camera = cameraMode === 'top' ? ortho : cameraMode === 'bird' ? bird : perspective;
    controls.object = camera;
    controls.enableRotate = cameraMode !== 'top';
    controls.mouseButtons = cameraMode === 'top'
      ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = cameraMode === 'top' ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN } : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    fitCameras(true);
    buildComposer();
    needsRender = true;
  }

  // ---------- Interaction ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let drag = null;

  function setPointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }

  function floorPoint() {
    const point = new THREE.Vector3();
    return raycaster.ray.intersectPlane(floorPlane, point) ? point : null;
  }

  renderer.domElement.addEventListener('pointerdown', event => {
    if (event.button !== 0 || state?.presentation) return;
    setPointer(event);
    const hits = raycaster.intersectObjects(furniture.children, true);
    const hit = hits.find(value => value.object.userData.itemId);
    drag = { start: { x: event.clientX, y: event.clientY }, id: null, moved: false };
    if (hit) {
      const id = hit.object.userData.itemId;
      const item = state.items.find(value => value.id === id);
      const point = floorPoint();
      if (item && point && !item.locked) {
        drag.id = id;
        drag.offset = { x: point.x - item.x, y: point.z - item.y };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
      }
      app.select(id);
    }
  });

  renderer.domElement.addEventListener('pointermove', event => {
    if (!drag?.id) return;
    setPointer(event);
    const point = floorPoint();
    if (!point) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < 3) return;
    drag.moved = true;
    app.moveItem(drag.id, point.x - drag.offset.x, point.z - drag.offset.y, { snap: true, live: true });
  });

  const endDrag = event => {
    if (!drag) return;
    if (drag.id && drag.moved) app.commit('Bútor áthelyezve (3D)');
    if (!drag.id && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < 3) app.select(null);
    drag = null;
    controls.enabled = true;
  };
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);

  // ---------- Rendering ----------
  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    renderer.setSize(rect.width, rect.height, false);
    renderer.domElement.style.width = `${rect.width}px`;
    renderer.domElement.style.height = `${rect.height}px`;
    composer?.setSize(rect.width, rect.height);
    fitCameras(false);
  }
  const observer = new ResizeObserver(() => { if (visible) resize(); });
  observer.observe(container);

  // Dollhouse cut: in free perspective, walls between the camera and the room are lowered.
  const AUTO_CUT_HEIGHT = 42;
  let lastCutKey = '';
  function applyAutoCut() {
    const active = cameraMode === 'perspective' && autoCut;
    const position = camera.position;
    let key = active ? '' : 'off';
    const groups = architecture.children.filter(child => child.userData.wall);
    const facing = groups.map(group => {
      if (!active) return false;
      const toCamera = new THREE.Vector3(position.x - group.userData.center.x, 0, position.z - group.userData.center.z);
      return group.userData.normal.dot(toCamera) > 0;
    });
    key += facing.map(Number).join('');
    if (key === lastCutKey) return;
    lastCutKey = key;
    groups.forEach((group, index) => {
      for (const mesh of group.children) {
        if (mesh.userData.keep) continue;
        const { y0 = 0, y1 = 0 } = mesh.userData;
        if (!facing[index]) { mesh.visible = true; mesh.scale.y = 1; continue; }
        if (y0 >= AUTO_CUT_HEIGHT - 0.01) { mesh.visible = false; continue; }
        mesh.visible = true;
        mesh.scale.y = y1 > AUTO_CUT_HEIGHT ? AUTO_CUT_HEIGHT / y1 : 1;
      }
    });
  }

  function renderFrame() {
    applyAutoCut();
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  function loop() {
    if (disposed) return;
    requestAnimationFrame(loop);
    if (!visible) return;
    const moved = controls.update();
    if (needsRender || moved) {
      needsRender = false;
      renderFrame();
    }
  }

  function update(nextState) {
    const previous = state;
    state = nextState;
    cutaway = Boolean(state.cutaway);
    if (state.sunAzimuth !== undefined) sunAzimuth = state.sunAzimuth;
    container.style.background = state.backgroundColor || '#f1ede6';
    const key = JSON.stringify([state.roomId, state.geometry?.id, state.geometry?.vertices, state.geometry?.objects, state.geometry?.partitions, state.geometry?.closed, state.materials.floor, state.materials.walls, state.wallHeight, state.wallThickness, cutaway]);
    const roomChanged = !previous || previous.roomId !== state.roomId || previous.geometry?.id !== state.geometry?.id;
    autoCut = state.autoCut !== false;
    if (key !== archKey) {
      archKey = key;
      lastCutKey = '';
      buildArchitecture();
      updateLighting();
      if (roomChanged) fitCameras(true);
    } else if (previous?.sunAzimuth !== state.sunAzimuth) updateLighting();
    syncFurniture();
    needsRender = true;
  }

  function setVisible(value) {
    visible = Boolean(value);
    if (visible) { resize(); if (!composer) buildComposer(); needsRender = true; }
  }

  /** High-resolution capture of the current state (no selection, chosen background). */
  async function capture(options = {}) {
    const previousMode = cameraMode;
    const previousSelection = state.selectedId;
    const saved = {
      perspective: { position: perspective.position.clone(), target: controls.target.clone() },
      ortho: { left: ortho.left, right: ortho.right, top: ortho.top, bottom: ortho.bottom, zoom: ortho.zoom, position: ortho.position.clone() },
      bird: bird.position.clone()
    };
    const width = Math.round(options.width || 2400);
    const height = Math.round(options.height || 1600);
    const aspect = width / height;
    const requested = options.camera || cameraMode;
    const changeMode = requested !== cameraMode;
    if (changeMode) {
      cameraMode = requested;
      camera = cameraMode === 'top' ? ortho : cameraMode === 'bird' ? bird : perspective;
      controls.object = camera;
    }
    // Fresh framing for a different camera; the current view keeps its user framing.
    if (changeMode) fitCameras(true, aspect);
    else {
      perspective.aspect = aspect; perspective.updateProjectionMatrix();
      bird.aspect = aspect; bird.updateProjectionMatrix();
      if (cameraMode === 'top') {
        const halfH = (ortho.top - ortho.bottom) / 2;
        ortho.left = -halfH * aspect; ortho.right = halfH * aspect; ortho.updateProjectionMatrix();
      }
    }
    camera.updateMatrixWorld();
    state.selectedId = null; updateSelection();
    lastCutKey = '';
    const previousPixelRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    buildComposer();
    composer.setPixelRatio(1);
    composer.setSize(width, height);
    renderFrame();
    const output = document.createElement('canvas');
    output.width = width; output.height = height;
    const ctx = output.getContext('2d');
    if (options.background && options.background !== 'transparent') { ctx.fillStyle = options.background; ctx.fillRect(0, 0, width, height); }
    ctx.drawImage(renderer.domElement, 0, 0, width, height);
    const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
    // Restore the interactive view exactly as it was.
    state.selectedId = previousSelection; updateSelection();
    cameraMode = previousMode;
    camera = cameraMode === 'top' ? ortho : cameraMode === 'bird' ? bird : perspective;
    controls.object = camera;
    perspective.position.copy(saved.perspective.position);
    controls.target.copy(saved.perspective.target);
    Object.assign(ortho, { left: saved.ortho.left, right: saved.ortho.right, top: saved.ortho.top, bottom: saved.ortho.bottom, zoom: saved.ortho.zoom });
    ortho.position.copy(saved.ortho.position); ortho.updateProjectionMatrix();
    bird.position.copy(saved.bird);
    renderer.setPixelRatio(previousPixelRatio);
    lastCutKey = '';
    buildComposer();
    if (visible) resize(); else fitCameras(false);
    controls.update();
    needsRender = true;
    return blob;
  }

  buildComposer();
  loop();

  return {
    update,
    setVisible,
    setCameraMode,
    getCameraMode: () => cameraMode,
    resetCamera: () => fitCameras(true),
    setAO: value => { aoEnabled = Boolean(value); buildComposer(); needsRender = true; },
    capture,
    renderer,
    scene,
    stats: () => ({ furniture: furnitureMap.size, meshes: (() => { let count = 0; scene.traverse(object => { if (object.isMesh) count += 1; }); return count; })(), camera: cameraMode }),
    dispose() { disposed = true; observer.disconnect(); renderer.dispose(); }
  };
}

// Register with the editor when it is ready.
function register() {
  if (!window.ZuglakApp) { setTimeout(register, 30); return; }
  window.ZuglakApp.registerView3D(createView3D);
}
register();
