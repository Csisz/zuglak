/* Zuglak Studio 2.0 – application controller: state, history, 2D editor, panels and exports. */
(() => {
  'use strict';

  const Core = window.ZuglakCore;
  const Geometry = window.ZuglakGeometry;
  const Catalog = window.ZuglakCatalog;
  const Materials = window.ZuglakMaterials;
  const Floorplans = window.ZuglakFloorplans;
  const Art = window.ZuglakFurniture2D;
  const Pdf = window.ZuglakPdf;
  const Icons = window.ZuglakIcons;
  const Ikea = window.ZUGLAK_IKEA_CATALOG;
  if (!Core || !Geometry || !Catalog || !Materials || !Floorplans || !Art) throw new Error('A Zuglak modulok nem töltődtek be.');

  // ------------------------------------------------------------------ helpers
  const $ = id => document.getElementById(id);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rad = degrees => degrees * Math.PI / 180;
  const idFactory = () => (crypto.randomUUID ? crypto.randomUUID() : `i${Date.now()}${Math.random().toString(36).slice(2)}`);
  const fmt = (value, digits = 1) => Number(value).toLocaleString('hu-HU', { maximumFractionDigits: digits });
  const fmtCm = value => `${fmt(value)} cm`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const icon = (name, cls) => Icons.svg(name, cls);
  const dateLabel = value => new Date(value).toLocaleString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  // Plan data must contain the three original rooms; newer rooms are added during migration.
  const REQUIRED = Floorplans.legacyIds;

  // ------------------------------------------------------------------ data
  const defaults = () => ({
    version: Core.CURRENT_PLAN_VERSION,
    currentRoom: 'room1',
    customPlans: [],
    rooms: Object.fromEntries(Floorplans.plans.map(plan => [plan.id, {
      name: plan.name,
      pxPerCm: plan.pxPerCm,
      active: 'Alap',
      variants: { Alap: { items: [], materials: { floor: Core.DEFAULT_FLOOR, walls: Core.DEFAULT_WALL }, versions: [] } },
      geometries: [],
      activeGeometryId: null
    }]))
  });
  const migrateOptions = { floorplans: Floorplans, idFactory };
  let data = Core.loadPlan(localStorage, defaults, REQUIRED, migrateOptions);
  let favorites = Core.loadFavorites(localStorage);

  // ------------------------------------------------------------------ UI state
  const ui = {
    roomId: data.rooms[data.currentRoom] ? data.currentRoom : 'room1',
    view: '2d',
    tool: 'select',
    mode: 'furnish', // furnish | walls | openings | draw | calibrate
    openingTool: null,
    selectedId: null,
    selectedObjectId: null,
    selectedVertex: null,
    selectedWall: null,
    leftTab: 'catalog',
    catalogSource: 'all',
    catalogCategory: 'all',
    clearance: 0,
    presentation: false,
    cutaway: false,
    lampsOn: true,
    sunAzimuth: 225,
    ao: true,
    camera: 'bird',
    view2d: { x: 0, y: 0, z: 1 },
    guides: [],
    measure: null,
    calibration: null,
    hoverId: null,
    cursor: null,
    exportKind: 'png2d'
  };
  const prefsKey = 'zuglak-ui-v2';
  try { Object.assign(ui, JSON.parse(localStorage.getItem(prefsKey) || '{}').ui || {}); } catch { /* ignore */ }
  ui.mode = 'furnish'; ui.presentation = false; ui.selectedId = null; ui.measure = null;
  if (!data.rooms[ui.roomId]) ui.roomId = 'room1';

  const allPlans = () => [...Floorplans.plans, ...(data.customPlans || []).map(plan => ({ ...plan, isCustom: true }))];
  const planFor = id => allPlans().find(plan => plan.id === id) || Floorplans.plans[0];
  const room = () => data.rooms[ui.roomId];
  const variant = () => room().variants[room().active];
  const items = () => variant().items;
  const geometries = () => room().geometries || (room().geometries = []);
  const geometry = () => geometries().find(value => value.id === room().activeGeometryId) || null;
  const selectedItem = () => items().find(item => item.id === ui.selectedId) || null;
  const roomMaterials = () => variant().materials || (variant().materials = { floor: Core.DEFAULT_FLOOR, walls: Core.DEFAULT_WALL });
  const thickness = () => Number(room().wallThickness) || Core.DEFAULT_WALL_THICKNESS;
  const archEditing = () => ['walls', 'openings', 'draw', 'calibrate'].includes(ui.mode);

  function savePrefs() {
    const keep = ['view', 'leftTab', 'catalogSource', 'cutaway', 'lampsOn', 'sunAzimuth', 'ao', 'camera', 'clearance'];
    const layers = ['showDims', 'showItemDims', 'showLabels', 'showUnderlay', 'showGrid', 'darkWalls', 'snapWalls', 'snapFurniture', 'snapAlign', 'snapGrid', 'snapRotation'];
    try {
      localStorage.setItem(prefsKey, JSON.stringify({
        ui: Object.fromEntries(keep.map(key => [key, ui[key]])),
        layers: Object.fromEntries(layers.map(id => [id, $(id)?.checked])),
        snap: $('snap').getAttribute('aria-pressed') === 'true'
      }));
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------------------ history & persistence
  let history = [];
  let future = [];
  let committed = JSON.stringify(data);
  let lastCommit = { label: '', time: 0 };

  function persist(snapshot) {
    try {
      localStorage.setItem(Core.PLAN_STORAGE_KEY, snapshot);
      setSaveState(true);
      return true;
    } catch {
      setSaveState(false);
      toast('A mentés nem sikerült: a böngésző tárhelye megtelt. Készíts JSON-mentést.', 8000);
      return false;
    }
  }

  function setSaveState(ok) {
    const node = $('saveState');
    node.classList.toggle('error', !ok);
    node.querySelector('span').textContent = ok ? 'Mentve' : 'Mentési hiba';
  }

  /** Records the current state as one undoable step and saves it. */
  function commit(label = '', options = {}) {
    data.currentRoom = ui.roomId;
    const snapshot = JSON.stringify(data);
    if (snapshot === committed) return;
    const now = Date.now();
    const merge = options.merge && lastCommit.label === label && now - lastCommit.time < 1200;
    if (!merge) {
      history.push(committed);
      if (history.length > 120) history.shift();
    }
    future = [];
    committed = snapshot;
    lastCommit = { label, time: now };
    persist(snapshot);
    updateHistoryButtons();
    invalidateThumbs();
  }

  function restore(snapshot) {
    data = JSON.parse(snapshot);
    committed = snapshot;
    if (!data.rooms[data.currentRoom]) data.currentRoom = 'room1';
    const roomChanged = ui.roomId !== data.currentRoom;
    ui.roomId = data.currentRoom;
    if (!items().some(item => item.id === ui.selectedId)) ui.selectedId = null;
    ui.selectedObjectId = null; ui.selectedVertex = null; ui.selectedWall = null;
    persist(snapshot);
    updateHistoryButtons();
    invalidateThumbs();
    if (roomChanged) fitView();
    refreshAll();
  }

  function undo() {
    if (!history.length) return;
    future.push(committed);
    restore(history.pop());
    toast('Visszavonva');
  }

  function redo() {
    if (!future.length) return;
    history.push(committed);
    restore(future.pop());
    toast('Újra végrehajtva');
  }

  function updateHistoryButtons() {
    $('undo').disabled = !history.length;
    $('redo').disabled = !future.length;
  }

  let toastTimer = null;
  function toast(text, duration = 2600) {
    const node = $('toast');
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), duration);
  }

  // ------------------------------------------------------------------ underlay images
  const imageCache = new Map();
  function imageFor(url) {
    if (!imageCache.has(url)) {
      const image = new Image();
      image.onload = () => requestRender();
      image.src = url;
      imageCache.set(url, image);
    }
    const image = imageCache.get(url);
    return image.complete && image.naturalWidth ? image : null;
  }

  function planImage(id = ui.roomId) {
    const plan = planFor(id);
    if (!plan?.url) return null;
    if (!imageCache.has(plan.url)) {
      const image = new Image();
      image.onload = () => { requestRender(); renderRoomMenu(); };
      image.src = plan.url;
      imageCache.set(plan.url, image);
    }
    const image = imageCache.get(plan.url);
    return image.complete && image.naturalWidth ? image : null;
  }

  // ------------------------------------------------------------------ plan geometry helpers
  function roomBounds(geom = geometry(), roomData = room()) {
    if (geom && geom.vertices.length >= 2) {
      const outer = geom.closed && geom.vertices.length >= 3 ? Geometry.offsetPolygonOutward(geom.vertices, Number(roomData.wallThickness) || Core.DEFAULT_WALL_THICKNESS) : geom.vertices;
      return Geometry.polygonBounds(outer);
    }
    const plan = planFor(ui.roomId);
    const scale = Number(roomData.pxPerCm) || 2;
    const size = plan.imageSize || { width: 1122, height: 1402 };
    return { minX: 0, minY: 0, maxX: size.width / scale, maxY: size.height / scale };
  }

  function interiorBounds(geom = geometry()) {
    return geom && geom.vertices.length ? Geometry.polygonBounds(geom.vertices) : roomBounds();
  }

  /** Splits each wall edge into solid pieces and openings (shared idea with the 3D builder). */
  function wallPieces(geom, index) {
    const a = geom.vertices[index];
    const b = geom.vertices[(index + 1) % geom.vertices.length];
    const length = Geometry.distance(a, b);
    const objects = (geom.objects || []).filter(object => object.wallIndex === index && object.type !== 'radiator').map(object => {
      const width = object.fullWall ? length : Number(object.width) || 0;
      const offset = object.fullWall ? length / 2 : Number(object.offset) || 0;
      return { object, t0: clamp(offset - width / 2, 0, length), t1: clamp(offset + width / 2, 0, length) };
    }).filter(value => value.t1 - value.t0 > 0.3).sort((p, q) => p.t0 - q.t0);
    const pieces = [];
    let cursor = 0;
    for (const value of objects) {
      if (value.t0 > cursor + 0.2) pieces.push({ type: 'solid', t0: cursor, t1: value.t0 });
      pieces.push({ type: value.object.type, t0: value.t0, t1: value.t1, object: value.object });
      cursor = Math.max(cursor, value.t1);
    }
    if (length > cursor + 0.2) pieces.push({ type: 'solid', t0: cursor, t1: length });
    return { a, b, length, pieces };
  }

  function edgeFrame(geom, outer, index) {
    const a = geom.vertices[index];
    const b = geom.vertices[(index + 1) % geom.vertices.length];
    const length = Geometry.distance(a, b) || 1;
    const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const outA = outer[index];
    const outB = outer[(index + 1) % outer.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const outMid = { x: (outA.x + outB.x) / 2, y: (outA.y + outB.y) / 2 };
    const nl = Math.hypot(outMid.x - mid.x, outMid.y - mid.y) || 1;
    const normal = { x: (outMid.x - mid.x) / nl, y: (outMid.y - mid.y) / nl };
    const t = thicknessOf(geom);
    const at = s => ({ x: a.x + tangent.x * s, y: a.y + tangent.y * s });
    const outAt = s => (s <= 0.001 ? outA : s >= length - 0.001 ? outB : { x: a.x + tangent.x * s + normal.x * t, y: a.y + tangent.y * s + normal.y * t });
    return { a, b, length, tangent, normal, at, outAt, outA, outB };
  }
  let thicknessOverride = null;
  const thicknessOf = () => thicknessOverride ?? thickness();

  // ------------------------------------------------------------------ 2D rendering
  const canvas = $('plan');
  const screenCtx = canvas.getContext('2d');

  function layer(id) { return Boolean($(id)?.checked); }

  function drawPlan(ctx, T, options = {}) {
    // T: { x, y, z, dpr } — screen = (cm * z + x) * dpr
    const roomData = options.room || room();
    const variantData = options.variant || variant();
    const geom = options.geometry !== undefined ? options.geometry : geometry();
    const list = variantData.items;
    const z = T.z;
    const px = 1 / z; // one screen pixel in cm
    const dark = options.darkWalls ?? layer('darkWalls');
    const wallThickness = Number(roomData.wallThickness) || Core.DEFAULT_WALL_THICKNESS;
    thicknessOverride = wallThickness;
    const floorMat = Materials.get(variantData.materials?.floor || Core.DEFAULT_FLOOR);
    const setWorld = () => ctx.setTransform(T.dpr * z, 0, 0, T.dpr * z, T.dpr * T.x, T.dpr * T.y);
    const setScreen = () => ctx.setTransform(T.dpr, 0, 0, T.dpr, 0, 0);
    const fontPx = size => `${size * px}px Inter, system-ui, sans-serif`;

    // Background
    setScreen();
    if (options.background !== null) {
      ctx.fillStyle = options.background || '#f3efe8';
      ctx.fillRect(0, 0, T.width, T.height);
    } else ctx.clearRect(0, 0, T.width, T.height);
    if (options.grid ?? (layer('showGrid') && !ui.presentation)) {
      const step = z > 1.6 ? 10 : z > 0.5 ? 50 : 100;
      const major = step * (step === 10 ? 10 : 2);
      const x0 = Math.floor((-T.x / z) / step) * step;
      const y0 = Math.floor((-T.y / z) / step) * step;
      const x1 = (T.width - T.x) / z; const y1 = (T.height - T.y) / z;
      ctx.lineWidth = 1;
      for (let x = x0; x <= x1; x += step) {
        ctx.strokeStyle = Math.abs(x % major) < 0.01 ? 'rgba(120,104,82,.10)' : 'rgba(120,104,82,.05)';
        ctx.beginPath(); ctx.moveTo(Math.round(x * z + T.x) + 0.5, 0); ctx.lineTo(Math.round(x * z + T.x) + 0.5, T.height); ctx.stroke();
      }
      for (let y = y0; y <= y1; y += step) {
        ctx.strokeStyle = Math.abs(y % major) < 0.01 ? 'rgba(120,104,82,.10)' : 'rgba(120,104,82,.05)';
        ctx.beginPath(); ctx.moveTo(0, Math.round(y * z + T.y) + 0.5); ctx.lineTo(T.width, Math.round(y * z + T.y) + 0.5); ctx.stroke();
      }
    }
    setWorld();

    // Original drawing underlay
    const geomUnderlay = geom?.underlay;
    const underlayOn = options.underlay ?? layer('showUnderlay');
    const underlayImage = underlayOn && geomUnderlay ? imageFor(geomUnderlay.url) : null;
    if (underlayImage) {
      ctx.save();
      ctx.globalAlpha = options.underlayAlpha ?? (archEditing() ? 0.6 : 0.4);
      const s = 1 / geomUnderlay.pxPerCm;
      ctx.drawImage(underlayImage, geomUnderlay.x, geomUnderlay.y, underlayImage.naturalWidth * s, underlayImage.naturalHeight * s);
      ctx.restore();
    }
    const image = underlayOn && !geomUnderlay ? planImage(options.roomId || ui.roomId) : null;
    if (image && Number(roomData.pxPerCm) > 0) {
      ctx.save();
      ctx.globalAlpha = options.underlayAlpha ?? (archEditing() ? 0.55 : 0.32);
      const s = 1 / Number(roomData.pxPerCm);
      ctx.drawImage(image, 0, 0, image.naturalWidth * s, image.naturalHeight * s);
      ctx.restore();
      if (ui.mode === 'calibrate' && options.interactive) {
        const plan = planFor(ui.roomId);
        if (plan.reference) {
          const r = plan.reference;
          ctx.save(); ctx.strokeStyle = '#c4473b'; ctx.lineWidth = 2 * px; ctx.setLineDash([6 * px, 4 * px]);
          ctx.beginPath(); ctx.moveTo(r.x1 * s, r.y1 * s); ctx.lineTo(r.x2 * s, r.y2 * s); ctx.stroke(); ctx.restore();
        }
      }
    }

    const closed = geom && geom.closed && geom.vertices.length >= 3;
    let outer = null;
    if (closed) {
      const vertices = geom.vertices;
      outer = Geometry.offsetPolygonOutward(vertices, wallThickness);
      const polygonPath = points => { ctx.beginPath(); points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };

      // Floor
      ctx.save();
      polygonPath(vertices);
      ctx.fillStyle = Art.pattern(ctx, floorMat) || floorMat.color;
      ctx.globalAlpha = archEditing() && options.interactive ? 0.7 : 1;
      ctx.fill();
      // Floor through door / passage gaps
      for (let index = 0; index < vertices.length; index += 1) {
        const frame = edgeFrame(geom, outer, index);
        for (const piece of wallPieces(geom, index).pieces) {
          if (piece.type === 'door' || piece.type === 'opening') {
            polygonPath([frame.at(piece.t0), frame.at(piece.t1), frame.outAt(piece.t1), frame.outAt(piece.t0)]);
            ctx.fill();
          }
        }
      }
      ctx.restore();
      // Soft ambient shadow along the walls
      ctx.save();
      polygonPath(vertices);
      ctx.clip();
      ctx.shadowColor = 'rgba(52, 40, 26, .34)';
      ctx.shadowBlur = 14 * z * T.dpr;
      ctx.shadowOffsetX = 2 * z * T.dpr;
      ctx.shadowOffsetY = 3 * z * T.dpr;
      const ob = Geometry.polygonBounds(outer);
      ctx.beginPath();
      ctx.rect(ob.minX - 400, ob.minY - 400, ob.maxX - ob.minX + 800, ob.maxY - ob.minY + 800);
      vertices.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = '#000';
      ctx.fill('evenodd');
      ctx.restore();

      // Walls
      const wallFill = dark ? '#3b3834' : '#fbfaf7';
      const wallLine = dark ? '#2a2825' : '#6f695f';
      for (let index = 0; index < vertices.length; index += 1) {
        const frame = edgeFrame(geom, outer, index);
        const info = wallPieces(geom, index);
        for (const piece of info.pieces) {
          const quad = [frame.at(piece.t0), frame.at(piece.t1), frame.outAt(piece.t1), frame.outAt(piece.t0)];
          if (piece.type === 'solid' || piece.type === 'window') {
            polygonPath(quad);
            ctx.fillStyle = piece.type === 'window' ? (dark ? '#5b5751' : '#f1f4f4') : wallFill;
            ctx.fill();
            ctx.lineWidth = 1.1 * px; ctx.strokeStyle = wallLine;
            ctx.beginPath(); ctx.moveTo(quad[0].x, quad[0].y); ctx.lineTo(quad[1].x, quad[1].y); ctx.moveTo(quad[2].x, quad[2].y); ctx.lineTo(quad[3].x, quad[3].y); ctx.stroke();
          }
          if (piece.type !== 'solid') {
            // jambs
            ctx.lineWidth = 1.1 * px; ctx.strokeStyle = wallLine;
            ctx.beginPath(); ctx.moveTo(quad[0].x, quad[0].y); ctx.lineTo(quad[3].x, quad[3].y); ctx.moveTo(quad[1].x, quad[1].y); ctx.lineTo(quad[2].x, quad[2].y); ctx.stroke();
          }
          if (piece.type === 'window') {
            const active = piece.object.id === ui.selectedObjectId && options.interactive;
            for (const f of [0.38, 0.62]) {
              const p0 = { x: quad[0].x + (quad[3].x - quad[0].x) * f, y: quad[0].y + (quad[3].y - quad[0].y) * f };
              const p1 = { x: quad[1].x + (quad[2].x - quad[1].x) * f, y: quad[1].y + (quad[2].y - quad[1].y) * f };
              ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
              ctx.strokeStyle = active ? '#1f6f9a' : '#5f8fa6'; ctx.lineWidth = 1.3 * px; ctx.stroke();
            }
          }
          if (piece.type === 'door') {
            const object = piece.object;
            const zone = Geometry.doorClearancePolygon(object, vertices);
            if (zone.length > 2) {
              const active = object.id === ui.selectedObjectId && options.interactive;
              ctx.save();
              ctx.beginPath(); ctx.moveTo(zone[0].x, zone[0].y); zone.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath();
              ctx.fillStyle = active ? 'rgba(44,106,93,.12)' : 'rgba(120,100,70,.06)'; ctx.fill();
              ctx.beginPath(); ctx.moveTo(zone[1].x, zone[1].y); zone.slice(2).forEach(p => ctx.lineTo(p.x, p.y));
              ctx.setLineDash([5 * px, 4 * px]); ctx.strokeStyle = active ? '#2c6a5d' : '#9b8c78'; ctx.lineWidth = 1 * px; ctx.stroke();
              ctx.setLineDash([]);
              const hinge = zone[0]; const open = zone[zone.length - 1];
              const dx = open.x - hinge.x; const dy = open.y - hinge.y; const len = Math.hypot(dx, dy) || 1;
              const nx = -dy / len * 2; const ny = dx / len * 2;
              ctx.beginPath(); ctx.moveTo(hinge.x, hinge.y); ctx.lineTo(open.x, open.y); ctx.lineTo(open.x + nx, open.y + ny); ctx.lineTo(hinge.x + nx, hinge.y + ny); ctx.closePath();
              ctx.fillStyle = dark ? '#3b3834' : '#fbfaf7'; ctx.fill(); ctx.strokeStyle = active ? '#2c6a5d' : '#6f695f'; ctx.lineWidth = 1.1 * px; ctx.stroke();
              ctx.restore();
            }
          }
          if (piece.type === 'opening' && options.interactive) {
            ctx.save(); ctx.setLineDash([4 * px, 4 * px]); ctx.strokeStyle = 'rgba(111,105,95,.5)'; ctx.lineWidth = 1 * px;
            ctx.beginPath(); ctx.moveTo(quad[0].x, quad[0].y); ctx.lineTo(quad[1].x, quad[1].y); ctx.stroke(); ctx.restore();
          }
        }
        // Radiators
        for (const object of (geom.objects || []).filter(value => value.wallIndex === index && value.type === 'radiator')) {
          const polygon = Geometry.radiatorPolygon(object, vertices);
          if (polygon.length !== 4) continue;
          const active = object.id === ui.selectedObjectId && options.interactive;
          polygonPath(polygon);
          ctx.fillStyle = '#f7f6f3'; ctx.fill(); ctx.strokeStyle = active ? '#2c6a5d' : '#8d867b'; ctx.lineWidth = 1 * px; ctx.stroke();
          for (let fin = 1; fin < 8; fin += 1) {
            const r = fin / 8;
            ctx.beginPath();
            ctx.moveTo(polygon[0].x + (polygon[1].x - polygon[0].x) * r, polygon[0].y + (polygon[1].y - polygon[0].y) * r);
            ctx.lineTo(polygon[3].x + (polygon[2].x - polygon[3].x) * r, polygon[3].y + (polygon[2].y - polygon[3].y) * r);
            ctx.strokeStyle = '#c3bcb1'; ctx.lineWidth = 0.8 * px; ctx.stroke();
          }
        }
      }
      // Partitions
      for (const part of geom.partitions || []) {
        const length = Geometry.distance(part.a, part.b);
        if (length < 0.5) continue;
        const partThickness = Number(part.thickness) || wallThickness;
        const nx = -(part.b.y - part.a.y) / length * partThickness / 2;
        const ny = (part.b.x - part.a.x) / length * partThickness / 2;
        polygonPath([{ x: part.a.x + nx, y: part.a.y + ny }, { x: part.b.x + nx, y: part.b.y + ny }, { x: part.b.x - nx, y: part.b.y - ny }, { x: part.a.x - nx, y: part.a.y - ny }]);
        ctx.fillStyle = wallFill; ctx.fill(); ctx.strokeStyle = wallLine; ctx.lineWidth = 1.1 * px; ctx.stroke();
      }
    } else if (geom && geom.vertices.length) {
      // Open (being drawn) outline
      ctx.save();
      ctx.beginPath(); geom.vertices.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = '#2c6a5d'; ctx.lineWidth = 3 * px; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
    }

    // Wall dimensions
    if (geom && geom.vertices.length >= 2 && (options.dims ?? layer('showDims'))) drawWallDimensions(ctx, geom, outer, px, fontPx, options);

    // Furniture
    const order = { floor: 0, main: 1, top: 2 };
    const sorted = [...list].sort((p, q) => (order[Catalog.layerFor(p)] ?? 1) - (order[Catalog.layerFor(q)] ?? 1));
    const warned = options.warnings || new Set();
    for (const item of sorted) {
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate(rad(item.rot || 0));
      Art.drawItem(ctx, item, { pixelsPerCm: z * T.dpr });
      if (options.interactive && warned.has(item.id)) {
        ctx.strokeStyle = 'rgba(176, 71, 58, .9)'; ctx.lineWidth = 2 * px; ctx.setLineDash([5 * px, 3 * px]);
        ctx.strokeRect(-2 * px, -2 * px, item.w + 4 * px, item.h + 4 * px);
        ctx.setLineDash([]);
      }
      if (options.interactive && ui.hoverId === item.id && ui.selectedId !== item.id) {
        ctx.strokeStyle = 'rgba(44, 106, 93, .55)'; ctx.lineWidth = 1.5 * px;
        ctx.strokeRect(-1.5 * px, -1.5 * px, item.w + 3 * px, item.h + 3 * px);
      }
      ctx.restore();
    }

    // Labels / numbers
    if (options.labels ?? layer('showLabels')) {
      for (const item of sorted) {
        if (Catalog.layerFor(item) === 'top' && !options.numbers) continue;
        const center = Geometry.itemCenter(item);
        const number = options.numbers?.get(item.id);
        const text = number ? String(number) : item.name;
        ctx.font = `600 ${fontPx(number ? 11 : 10.5)}`;
        const width = ctx.measureText(text).width + 10 * px;
        const height = (number ? 18 : 17) * px;
        ctx.fillStyle = number ? 'rgba(35,33,30,.88)' : 'rgba(255,255,255,.88)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(center.x - Math.max(width, height) / 2, center.y - height / 2, Math.max(width, height), height, height / 2); else ctx.rect(center.x - width / 2, center.y - height / 2, width, height);
        ctx.fill();
        ctx.fillStyle = number ? '#fff' : '#23211e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, center.x, center.y + 0.5 * px);
      }
    }

    if (!options.interactive) { thicknessOverride = null; return; }

    // Clearance band
    const selected = selectedItem();
    if (selected && ui.clearance > 0) {
      const polygon = Geometry.rotatedRectCorners(selected, ui.clearance);
      ctx.save();
      ctx.beginPath(); polygon.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
      ctx.fillStyle = 'rgba(63, 130, 170, .07)'; ctx.fill();
      ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = '#4b88ad'; ctx.lineWidth = 1.2 * px; ctx.stroke();
      ctx.restore();
    }

    // Selected item: dimensions, wall distances, handles
    if (selected && !ui.presentation) {
      if (layer('showItemDims')) drawItemMeasurements(ctx, selected, geom, px, fontPx);
      drawSelection(ctx, selected, px);
    }

    // Snap guides
    for (const guide of ui.guides) {
      ctx.save();
      ctx.strokeStyle = guide.type === 'wall' ? '#1f9a73' : guide.type === 'align' ? '#d0673e' : guide.type === 'furniture' ? '#2f78c0' : '#8573bd';
      ctx.lineWidth = 1.2 * px; ctx.setLineDash([6 * px, 4 * px]);
      ctx.beginPath();
      if (guide.a && guide.b) {
        const dx = guide.b.x - guide.a.x; const dy = guide.b.y - guide.a.y; const len = Math.hypot(dx, dy) || 1;
        const ext = 30;
        ctx.moveTo(guide.a.x - dx / len * ext, guide.a.y - dy / len * ext); ctx.lineTo(guide.b.x + dx / len * ext, guide.b.y + dy / len * ext);
      } else if (guide.x !== undefined) {
        ctx.moveTo(guide.x - 60, guide.y); ctx.lineTo(guide.x + 60, guide.y); ctx.moveTo(guide.x, guide.y - 60); ctx.lineTo(guide.x, guide.y + 60);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Measurement
    if (ui.measure?.a && ui.measure?.b) {
      const { a, b } = ui.measure;
      ctx.save();
      ctx.strokeStyle = '#d0673e'; ctx.lineWidth = 1.6 * px; ctx.setLineDash([7 * px, 4 * px]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 * px, 0, Math.PI * 2); ctx.fillStyle = '#d0673e'; ctx.fill(); }
      pill(ctx, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, fmtCm(Geometry.distance(a, b)), px, fontPx, '#d0673e', '#fff');
      ctx.restore();
    }

    // Calibration line
    if (ui.calibration?.a && ui.calibration?.b) {
      const { a, b } = ui.calibration;
      ctx.save(); ctx.strokeStyle = '#c4473b'; ctx.lineWidth = 2 * px; ctx.setLineDash([8 * px, 4 * px]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
    }

    // Architecture editing overlay
    if (archEditing() && geom) {
      for (let index = 0; index < (geom.closed ? geom.vertices.length : geom.vertices.length - 1); index += 1) {
        const a = geom.vertices[index]; const b = geom.vertices[(index + 1) % geom.vertices.length];
        const confirmed = geom.confirmedWalls?.[index];
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = ui.selectedWall === index ? '#2c6a5d' : confirmed ? 'rgba(44,106,93,.7)' : 'rgba(168,113,31,.75)';
        ctx.lineWidth = (ui.selectedWall === index ? 4 : 2.2) * px; ctx.stroke();
      }
      if (ui.mode === 'walls' || ui.mode === 'draw') {
        geom.vertices.forEach((p, index) => {
          ctx.beginPath(); ctx.arc(p.x, p.y, (ui.selectedVertex === index ? 6.5 : 5) * px, 0, Math.PI * 2);
          ctx.fillStyle = ui.selectedVertex === index ? '#f0a42d' : '#fff'; ctx.fill();
          ctx.strokeStyle = '#2c6a5d'; ctx.lineWidth = 1.8 * px; ctx.stroke();
        });
      }
    }
    thicknessOverride = null;
  }

  function pill(ctx, center, text, px, fontPx, bg = 'rgba(255,255,255,.94)', fg = '#23211e', angle = 0) {
    ctx.save();
    ctx.translate(center.x, center.y);
    if (angle) ctx.rotate(angle);
    ctx.font = `620 ${fontPx(10.5)}`;
    const width = ctx.measureText(text).width + 10 * px;
    const height = 17 * px;
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-width / 2, -height / 2, width, height, 5 * px); else ctx.rect(-width / 2, -height / 2, width, height);
    ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0.6 * px);
    ctx.restore();
  }

  function drawWallDimensions(ctx, geom, outer, px, fontPx, options) {
    const vertices = geom.vertices;
    const count = geom.closed ? vertices.length : vertices.length - 1;
    const wallThickness = thicknessOf();
    const outerPoly = outer || vertices;
    for (let index = 0; index < count; index += 1) {
      const a = vertices[index];
      const b = vertices[(index + 1) % vertices.length];
      const length = Geometry.distance(a, b);
      if (length * (1 / px) < 34 && !archEditing()) continue;
      let normal;
      if (outer) {
        const frame = edgeFrame(geom, outer, index);
        normal = frame.normal;
      } else {
        normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
      }
      const offset = (outer ? wallThickness : 0) + 18 * px;
      const p0 = { x: a.x + normal.x * offset, y: a.y + normal.y * offset };
      const p1 = { x: b.x + normal.x * offset, y: b.y + normal.y * offset };
      const confirmed = Boolean(geom.confirmedWalls?.[index]);
      const label = geom.wallLabels?.[index];
      const color = confirmed ? '#2c6a5d' : '#a8711f';
      ctx.save();
      ctx.strokeStyle = confirmed ? 'rgba(44,106,93,.7)' : 'rgba(120,104,82,.55)';
      ctx.lineWidth = 0.9 * px;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
      // extension lines
      const e0 = { x: a.x + normal.x * (outer ? wallThickness + 3 * px : 3 * px), y: a.y + normal.y * (outer ? wallThickness + 3 * px : 3 * px) };
      const e1 = { x: b.x + normal.x * (outer ? wallThickness + 3 * px : 3 * px), y: b.y + normal.y * (outer ? wallThickness + 3 * px : 3 * px) };
      ctx.moveTo(e0.x, e0.y); ctx.lineTo(p0.x + normal.x * 4 * px, p0.y + normal.y * 4 * px);
      ctx.moveTo(e1.x, e1.y); ctx.lineTo(p1.x + normal.x * 4 * px, p1.y + normal.y * 4 * px);
      ctx.stroke();
      // architectural ticks
      const tx = (b.x - a.x) / length; const ty = (b.y - a.y) / length;
      for (const p of [p0, p1]) {
        ctx.beginPath();
        ctx.moveTo(p.x - (tx + normal.x) * 3.5 * px, p.y - (ty + normal.y) * 3.5 * px);
        ctx.lineTo(p.x + (tx + normal.x) * 3.5 * px, p.y + (ty + normal.y) * 3.5 * px);
        ctx.lineWidth = 1.4 * px; ctx.stroke();
      }
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (angle > Math.PI / 2 || angle <= -Math.PI / 2) angle += Math.PI;
      let text = confirmed ? fmt(length) : `≈ ${fmt(length)}`;
      if (!confirmed && label && Math.abs(label - length) > 0.5 && (options.interactive || options.drawingLabels)) text += `  ·  rajz: ${fmt(label)}`;
      pill(ctx, { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, text, px, fontPx, 'rgba(251,250,247,.96)', color, angle);
      ctx.restore();
    }
    void outerPoly;
  }

  function drawItemMeasurements(ctx, item, geom, px, fontPx) {
    const corners = Geometry.rotatedRectCorners(item);
    const center = Geometry.itemCenter(item);
    // Width/depth labels on the front and right edges
    const label = (a, b, text) => {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const out = { x: mid.x - center.x, y: mid.y - center.y };
      const len = Math.hypot(out.x, out.y) || 1;
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (angle > Math.PI / 2 || angle <= -Math.PI / 2) angle += Math.PI;
      pill(ctx, { x: mid.x + out.x / len * 13 * px, y: mid.y + out.y / len * 13 * px }, text, px, fontPx, 'rgba(44,106,93,.95)', '#fff', angle);
    };
    label(corners[2], corners[3], fmtCm(item.w));
    label(corners[1], corners[2], fmtCm(item.h));
    if (!geom) return;
    const segments = Geometry.wallSegments(geom);
    for (const value of Geometry.wallClearances(item, segments)) {
      if (!Number.isFinite(value.distance) || value.distance > 800 || value.distance < 0.5) continue;
      ctx.save();
      ctx.strokeStyle = 'rgba(208,103,62,.85)'; ctx.lineWidth = 1 * px; ctx.setLineDash([3 * px, 3 * px]);
      ctx.beginPath(); ctx.moveTo(value.from.x, value.from.y); ctx.lineTo(value.to.x, value.to.y); ctx.stroke();
      ctx.restore();
      if (value.distance / px > 36) pill(ctx, { x: (value.from.x + value.to.x) / 2, y: (value.from.y + value.to.y) / 2 }, fmt(value.distance, 0), px, fontPx, 'rgba(255,255,255,.95)', '#b4532c');
    }
  }

  function handlePositions(item) {
    // Returns world-space handle positions in cm (rotation handle offset in screen px).
    const z = ui.view2d.z;
    const angle = rad(item.rot || 0);
    const local = (x, y) => ({ x: item.x + x * Math.cos(angle) - y * Math.sin(angle), y: item.y + x * Math.sin(angle) + y * Math.cos(angle) });
    const handles = [{ type: 'rotate', p: local(item.w / 2, -30 / z), anchor: local(item.w / 2, 0) }];
    if (isResizable(item)) {
      handles.push(
        { type: 'r', p: local(item.w, item.h / 2) }, { type: 'l', p: local(0, item.h / 2) },
        { type: 'b', p: local(item.w / 2, item.h) }, { type: 't', p: local(item.w / 2, 0) },
        { type: 'br', p: local(item.w, item.h) }, { type: 'tl', p: local(0, 0) },
        { type: 'tr', p: local(item.w, 0) }, { type: 'bl', p: local(0, item.h) }
      );
    }
    return handles;
  }

  function isResizable(item) {
    return !item.locked && item.source !== 'ikea';
  }

  function drawSelection(ctx, item, px) {
    const corners = Geometry.rotatedRectCorners(item, 2 * px);
    ctx.save();
    ctx.beginPath(); corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.strokeStyle = item.locked ? '#8a8378' : '#2c6a5d'; ctx.lineWidth = 1.6 * px; ctx.stroke();
    if (!item.locked) {
      for (const handle of handlePositions(item)) {
        if (handle.type === 'rotate') {
          ctx.beginPath(); ctx.moveTo(handle.anchor.x, handle.anchor.y); ctx.lineTo(handle.p.x, handle.p.y);
          ctx.strokeStyle = '#2c6a5d'; ctx.lineWidth = 1.2 * px; ctx.stroke();
          ctx.beginPath(); ctx.arc(handle.p.x, handle.p.y, 7 * px, 0, Math.PI * 2);
          ctx.fillStyle = '#2c6a5d'; ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4 * px;
          ctx.beginPath(); ctx.arc(handle.p.x, handle.p.y, 3.4 * px, -Math.PI * 0.9, Math.PI * 0.5); ctx.stroke();
        } else {
          const s = (handle.type.length === 2 ? 4.5 : 4) * px;
          ctx.save(); ctx.translate(handle.p.x, handle.p.y); ctx.rotate(rad(item.rot || 0));
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2c6a5d'; ctx.lineWidth = 1.4 * px;
          ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-s, -s, s * 2, s * 2, 1.5 * px); else ctx.rect(-s, -s, s * 2, s * 2);
          ctx.fill(); ctx.stroke(); ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ warnings
  let currentWarnings = [];
  let warnedIds = new Set();
  function computeWarnings() {
    const geom = geometry();
    const list = items();
    const map = new Map();
    warnedIds = new Set();
    const solids = list.filter(item => Catalog.layerFor(item) === 'main');
    // Seating is meant to slide under tables and desks: no overlap warning between them.
    const seating = new Set(['chair', 'chair-upholstered', 'stool', 'office-chair', 'bench', 'pouf']);
    const tables = new Set(['table', 'table-round', 'desk', 'island', 'coffee-table', 'coffee-round', 'side-table']);
    const compatible = (p, q) => (seating.has(Catalog.modelFor(p)) && tables.has(Catalog.modelFor(q))) || (seating.has(Catalog.modelFor(q)) && tables.has(Catalog.modelFor(p)));
    for (const item of list) {
      const layerName = Catalog.layerFor(item);
      const others = layerName === 'main' ? solids.filter(other => !compatible(item, other)) : [];
      const warnings = Geometry.analyzePlacement(item, others, layerName === 'main' ? geom : (geom ? { ...geom, objects: [], partitions: [] } : null), { clearance: item.id === ui.selectedId ? ui.clearance : 0 });
      for (const warning of warnings) {
        if (warning.type === 'boundary' && layerName === 'top') continue;
        warnedIds.add(item.id);
        if (warning.id && warning.type === 'furniture') warnedIds.add(warning.id);
        const other = list.find(value => value.id === warning.id);
        const key = warning.type === 'furniture' ? `f-${[item.id, warning.id].sort().join('-')}` : `${warning.type}-${item.id}-${warning.id || ''}`;
        const text = {
          furniture: `„${item.name}” és „${other?.name || 'bútor'}” átfedésben van`,
          boundary: `„${item.name}” kilóg a falon túlra`,
          door: `„${item.name}” ajtónyitási területbe ér`,
          partition: `„${item.name}” falcsonkot metsz`,
          clearance: `„${item.name}” ${warning.distance} cm-es sávjában bútor áll`
        }[warning.type];
        if (text) map.set(key, { text, id: item.id, soft: warning.type === 'clearance' });
      }
    }
    currentWarnings = [...map.values()];
    return currentWarnings;
  }

  function renderWarnings() {
    const chip = $('warningChip');
    const warnings = currentWarnings;
    chip.hidden = !warnings.length || ui.presentation || ui.view !== '2d';
    $('warningCount').textContent = `${warnings.length} figyelmeztetés`;
    const list = $('warningList');
    if (!list.hidden) {
      list.innerHTML = warnings.map((warning, index) => `<button data-index="${index}"><span class="dot${warning.soft ? ' soft' : ''}"></span><span>${escapeHtml(warning.text)}</span></button>`).join('');
      list.querySelectorAll('button').forEach(button => { button.onclick = () => select(warnings[Number(button.dataset.index)].id); });
    }
  }

  // ------------------------------------------------------------------ render loop
  let renderQueued = false;
  let inspectorQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      computeWarnings();
      renderWarnings();
      if (ui.view === '2d') draw2D();
      sync3D();
      if (inspectorQueued) { inspectorQueued = false; renderInspector(); }
    });
  }

  function draw2D() {
    const wrap = $('view2d');
    const width = wrap.clientWidth; const height = wrap.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    drawPlan(screenCtx, { ...ui.view2d, dpr, width, height }, {
      interactive: !ui.presentation,
      warnings: warnedIds,
      labels: layer('showLabels'),
      dims: layer('showDims') && !(ui.presentation && false)
    });
    $('zoomLabel').textContent = `${Math.round(ui.view2d.z / baseZoom() * 100)}%`;
  }

  function baseZoom() {
    const b = roomBounds();
    const wrap = $('view2d');
    return Math.min((wrap.clientWidth - 160) / Math.max(50, b.maxX - b.minX), (wrap.clientHeight - 170) / Math.max(50, b.maxY - b.minY)) || 1;
  }

  let needsFit = false;
  function fitView() {
    const b = roomBounds();
    const wrap = $('view2d');
    if (!wrap.clientWidth || !wrap.clientHeight) { needsFit = true; return; }
    needsFit = false;
    const width = wrap.clientWidth || 800; const height = wrap.clientHeight || 600;
    const top = ui.mode !== 'furnish' ? 90 : 0; // room for the editing banner
    const z = Math.max(0.05, Math.min((width - 170) / Math.max(50, b.maxX - b.minX), (height - 200 - top) / Math.max(50, b.maxY - b.minY)));
    ui.view2d = { z, x: width / 2 - (b.minX + b.maxX) / 2 * z, y: top + (height - 70 - top) / 2 - (b.minY + b.maxY) / 2 * z };
    requestRender();
  }

  function zoomAt(factor, at) {
    const wrap = $('view2d');
    const point = at || { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 };
    const world = toWorld(point);
    const base = baseZoom();
    ui.view2d.z = clamp(ui.view2d.z * factor, base * 0.15, base * 14);
    ui.view2d.x = point.x - world.x * ui.view2d.z;
    ui.view2d.y = point.y - world.y * ui.view2d.z;
    requestRender();
  }

  const toWorld = point => ({ x: (point.x - ui.view2d.x) / ui.view2d.z, y: (point.y - ui.view2d.y) / ui.view2d.z });
  const toScreen = point => ({ x: point.x * ui.view2d.z + ui.view2d.x, y: point.y * ui.view2d.z + ui.view2d.y });

  // ------------------------------------------------------------------ 3D bridge
  let view3d = null;
  let view3dFactory = null;
  function ensure3D() {
    if (view3d || !view3dFactory) return view3d;
    try {
      view3d = view3dFactory($('view3d'), api3d);
      $('view3dLoading').hidden = true;
      view3d.setAO(ui.ao);
      view3d.setCameraMode(ui.camera);
    } catch (error) {
      console.error(error);
      $('view3dLoading').textContent = 'A 3D nézet nem indítható ezen az eszközön (WebGL szükséges).';
    }
    return view3d;
  }

  function sync3D() {
    if (!view3d) return;
    view3d.update({
      roomId: ui.roomId,
      geometry: geometry(),
      items: items(),
      materials: roomMaterials(),
      wallHeight: Number(room().wallHeight) || Core.DEFAULT_WALL_HEIGHT,
      wallThickness: thickness(),
      selectedId: ui.selectedId,
      cutaway: ui.cutaway,
      sunAzimuth: ui.sunAzimuth,
      lampsOn: ui.lampsOn,
      presentation: ui.presentation,
      backgroundColor: '#f1ede6'
    });
  }

  const api3d = {
    select: id => select(id),
    moveItem: (id, x, y, options = {}) => {
      const item = items().find(value => value.id === id);
      if (!item || item.locked) return;
      const moved = applySnap({ ...item, x, y }, options.snap);
      item.x = moved.x; item.y = moved.y;
      ui.guides = moved.guides || [];
      requestRender();
      updateInspectorPosition();
    },
    commit: label => { ui.guides = []; commit(label); renderInspector(); requestRender(); }
  };

  window.ZuglakApp = Object.freeze({
    registerView3D(factory) {
      view3dFactory = factory;
      if (ui.view === '3d') { ensure3D(); view3d?.setVisible(true); requestRender(); }
    },
    // Test & automation hooks (read-only views and high-level commands).
    state: () => ({ roomId: ui.roomId, view: ui.view, selectedId: ui.selectedId, mode: ui.mode, items: JSON.parse(JSON.stringify(items())), materials: { ...roomMaterials() }, variant: room().active, warnings: currentWarnings.map(value => value.text) }),
    addProduct: (key, at) => addProduct(Catalog.all.find(value => value.key === key), at),
    setView: value => setView(value),
    select: id => select(id),
    view3d: () => view3d,
    worldToScreen: point => toScreen(point),
    commit,
    data: () => data
  });

  // ------------------------------------------------------------------ snapping
  function applySnap(candidate, enabled = true) {
    const snapOn = $('snap').getAttribute('aria-pressed') === 'true';
    if (!enabled || !snapOn) return { x: candidate.x, y: candidate.y, guides: [] };
    const geom = geometry();
    const others = items().filter(value => value.id !== candidate.id && Catalog.layerFor(value) !== 'floor');
    const result = Geometry.snapFurniture(candidate, {
      threshold: 9 / ui.view2d.z,
      walls: layer('snapWalls') && Boolean(geom),
      roomVertices: geom?.vertices,
      roomClosed: geom?.closed,
      partitions: geom?.partitions,
      furniture: layer('snapFurniture'),
      align: layer('snapAlign'),
      otherItems: others,
      grid: layer('snapGrid'),
      gridSize: 5
    });
    return result;
  }

  // ------------------------------------------------------------------ selection & item ops
  function select(id) {
    ui.selectedId = id && items().some(item => item.id === id) ? id : null;
    if (ui.selectedId) { ui.selectedObjectId = null; ui.selectedWall = null; ui.selectedVertex = null; }
    document.body.classList.toggle('has-selection', Boolean(ui.selectedId));
    renderInspector();
    renderMaterialsSelection();
    requestRender();
  }

  function freeSpot(product) {
    const geom = geometry();
    const wrap = $('view2d');
    let center = ui.view === '2d' ? toWorld({ x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 }) : null;
    if (!center || (geom?.closed && !Geometry.pointInPolygon(center, geom.vertices))) {
      if (geom?.vertices.length >= 3) {
        // Centroid-ish point that is inside the polygon
        const b = Geometry.polygonBounds(geom.vertices);
        center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        if (!Geometry.pointInPolygon(center, geom.vertices)) {
          for (let step = 0; step < 200; step += 1) {
            const p = { x: b.minX + Math.random() * (b.maxX - b.minX), y: b.minY + Math.random() * (b.maxY - b.minY) };
            if (Geometry.pointInPolygon(p, geom.vertices)) { center = p; break; }
          }
        }
      } else center = { x: 200, y: 200 };
    }
    return { x: center.x - Number(product.width) / 2, y: center.y - Number(product.depth) / 2 };
  }

  function addProduct(product, at) {
    if (!product) return null;
    try {
      const position = at ? { x: at.x - Number(product.width) / 2, y: at.y - Number(product.depth) / 2 } : freeSpot(product);
      const item = product.source === 'ikea'
        ? Core.createFurnitureItem({ ...product, type: product.type }, position, idFactory)
        : Core.createGenericItem(product, position, idFactory);
      if (product.source === 'ikea') { item.model = product.model || Catalog.ikeaModel(product); item.materials = { ...(product.materials || {}) }; }
      item.materials = { ...Catalog.defaultMaterials(item.model), ...(item.materials || {}) };
      items().push(item);
      commit('Bútor hozzáadása');
      select(item.id);
      toast(`Hozzáadva: ${item.name} · ${fmt(item.w)} × ${fmt(item.h)} cm`);
      return item;
    } catch (error) {
      toast(error.message || 'A bútor nem adható hozzá.');
      return null;
    }
  }

  function duplicateSelected() {
    const item = selectedItem();
    if (!item) return;
    const copy = JSON.parse(JSON.stringify(item));
    copy.id = idFactory();
    copy.x += 20; copy.y += 20;
    copy.locked = false;
    items().push(copy);
    commit('Másolat');
    select(copy.id);
    toast('Másolat létrehozva');
  }

  function deleteSelected() {
    const item = selectedItem();
    if (!item) return;
    variant().items = items().filter(value => value.id !== item.id);
    ui.selectedId = null;
    commit('Törlés');
    select(null);
    toast(`Törölve: ${item.name}`);
  }

  function rotateSelected(delta, absolute = false) {
    const item = selectedItem();
    if (!item || item.locked) return;
    Object.assign(item, Geometry.rotateAboutCenter(item, absolute ? delta : (item.rot || 0) + delta));
    commit('Forgatás', { merge: true });
    renderInspector();
    requestRender();
  }

  function nudgeSelected(dx, dy) {
    const item = selectedItem();
    if (!item || item.locked) return;
    item.x += dx; item.y += dy;
    commit('Mozgatás', { merge: true });
    updateInspectorPosition();
    requestRender();
  }

  // ------------------------------------------------------------------ hit testing
  function hitItem(point) {
    const order = { top: 0, main: 1, floor: 2 };
    const list = [...items()].reverse().sort((p, q) => (order[Catalog.layerFor(p)] ?? 1) - (order[Catalog.layerFor(q)] ?? 1));
    for (const item of list) {
      if (Geometry.pointInPolygon(point, Geometry.rotatedRectCorners(item), true)) return item;
    }
    return null;
  }

  function hitHandle(screenPoint) {
    const item = selectedItem();
    if (!item || item.locked) return null;
    for (const handle of handlePositions(item)) {
      const p = toScreen(handle.p);
      if (Math.hypot(p.x - screenPoint.x, p.y - screenPoint.y) <= (handle.type === 'rotate' ? 11 : 8)) return handle;
    }
    return null;
  }

  function hitVertex(screenPoint) {
    const geom = geometry();
    if (!geom) return -1;
    let best = -1; let bestDistance = 12;
    geom.vertices.forEach((v, index) => {
      const p = toScreen(v);
      const d = Math.hypot(p.x - screenPoint.x, p.y - screenPoint.y);
      if (d < bestDistance) { best = index; bestDistance = d; }
    });
    return best;
  }

  function hitWall(worldPoint) {
    const geom = geometry();
    if (!geom || geom.vertices.length < 2) return null;
    const nearest = Geometry.nearestWall(worldPoint, geom.vertices, geom.closed);
    return nearest && nearest.distance <= Math.max(thickness() + 4, 14 / ui.view2d.z) ? nearest : null;
  }

  function hitObject(worldPoint) {
    const geom = geometry();
    if (!geom) return null;
    let best = null;
    for (const object of geom.objects || []) {
      let distance = Infinity;
      if (object.type === 'radiator') {
        const polygon = Geometry.radiatorPolygon(object, geom.vertices);
        distance = Geometry.pointInPolygon(worldPoint, polygon, true) ? 0 : Infinity;
      } else {
        const segment = object.fullWall ? (() => { const frame = Geometry.wallFrame(geom.vertices, object.wallIndex, 0); return frame ? { a: frame.start, b: frame.end } : null; })() : Geometry.openingSegment(object, geom.vertices);
        if (segment) distance = Geometry.nearestPointOnSegment(worldPoint, segment.a, segment.b).distance;
      }
      if (distance <= Math.max(thickness() + 3, 12 / ui.view2d.z) && (!best || distance < best.distance)) best = { object, distance };
    }
    return best?.object || null;
  }

  // ------------------------------------------------------------------ pointer interaction (2D)
  let drag = null;
  let spaceDown = false;
  const pointers = new Map();

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', event => {
    document.body.classList.remove('panel-open');
    if (ui.presentation) return;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic or already released pointer */ }
    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      drag = { type: 'pinch', distance: Math.hypot(p1.x - p2.x, p1.y - p2.y), center: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, view: { ...ui.view2d } };
      return;
    }
    const world = toWorld(point);
    if (event.button === 1 || event.button === 2 || spaceDown || ui.tool === 'pan') {
      drag = { type: 'pan', start: point, view: { ...ui.view2d } };
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (ui.mode !== 'furnish') { architecturePointerDown(world, point, event); return; }
    if (ui.tool === 'measure') {
      if (!ui.measure || ui.measure.b && !ui.measure.active) ui.measure = { a: world, b: world, active: true };
      else { ui.measure.b = world; ui.measure.active = false; toast(`Mért távolság: ${fmtCm(Geometry.distance(ui.measure.a, ui.measure.b))}`, 5000); }
      requestRender();
      return;
    }
    const handle = hitHandle(point);
    if (handle) {
      const item = selectedItem();
      drag = { type: handle.type === 'rotate' ? 'rotate' : 'resize', handle: handle.type, id: item.id, start: world, original: { ...item } };
      return;
    }
    const item = hitItem(world);
    if (item) {
      if (ui.selectedId !== item.id) select(item.id);
      if (!item.locked) drag = { type: 'move', id: item.id, start: world, original: { x: item.x, y: item.y }, moved: false };
      return;
    }
    select(null);
    drag = { type: 'pan', start: point, view: { ...ui.view2d }, soft: true };
  });

  canvas.addEventListener('pointermove', event => {
    const point = localPoint(event);
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, point);
    const world = toWorld(point);
    ui.cursor = world;
    updateCursorInfo(world);
    if (!drag) {
      if (ui.mode === 'furnish' && ui.tool === 'select') {
        const handle = hitHandle(point);
        const hover = handle ? null : hitItem(world);
        canvas.style.cursor = handle ? (handle.type === 'rotate' ? 'grab' : 'nwse-resize') : hover ? (hover.locked ? 'not-allowed' : 'move') : 'default';
        if ((hover?.id || null) !== ui.hoverId) { ui.hoverId = hover?.id || null; requestRender(); }
      }
      if (ui.tool === 'measure' && ui.measure?.active) { ui.measure.b = world; requestRender(); }
      if (ui.mode === 'calibrate' && ui.calibration?.a && !ui.calibration.b) { ui.calibration.preview = world; }
      return;
    }
    if (drag.type === 'pinch' && pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const factor = distance / drag.distance;
      const base = baseZoom();
      const z = clamp(drag.view.z * factor, base * 0.15, base * 14);
      const worldAtStart = { x: (drag.center.x - drag.view.x) / drag.view.z, y: (drag.center.y - drag.view.y) / drag.view.z };
      ui.view2d = { z, x: center.x - worldAtStart.x * z, y: center.y - worldAtStart.y * z };
      requestRender();
      return;
    }
    if (drag.type === 'pan') {
      ui.view2d.x = drag.view.x + point.x - drag.start.x;
      ui.view2d.y = drag.view.y + point.y - drag.start.y;
      requestRender();
      return;
    }
    const item = items().find(value => value.id === drag.id);
    if (drag.type === 'move' && item) {
      const dx = world.x - drag.start.x; const dy = world.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * ui.view2d.z < 3) return;
      drag.moved = true;
      const snapped = applySnap({ ...item, x: drag.original.x + dx, y: drag.original.y + dy }, !event.altKey);
      item.x = snapped.x; item.y = snapped.y;
      ui.guides = snapped.guides || [];
      updateInspectorPosition();
      requestRender();
    } else if (drag.type === 'rotate' && item) {
      const center = Geometry.itemCenter(drag.original);
      let angle = Math.atan2(world.y - center.y, world.x - center.x) * 180 / Math.PI + 90;
      const step = layer('snapRotation') && !event.shiftKey ? 15 : 1;
      angle = Math.round(angle / step) * step;
      Object.assign(item, Geometry.rotateAboutCenter({ ...drag.original }, angle));
      updateInspectorPosition();
      requestRender();
    } else if (drag.type === 'resize' && item) {
      const o = drag.original;
      const angle = rad(o.rot || 0);
      const dxw = world.x - o.x; const dyw = world.y - o.y;
      const local = { x: dxw * Math.cos(-angle) - dyw * Math.sin(-angle), y: dxw * Math.sin(-angle) + dyw * Math.cos(-angle) };
      let left = 0; let top = 0; let right = o.w; let bottom = o.h;
      const round = value => Math.round(value);
      if (drag.handle.includes('r')) right = Math.max(5, round(local.x));
      if (drag.handle.includes('b')) bottom = Math.max(5, round(local.y));
      if (drag.handle.includes('l')) left = Math.min(o.w - 5, round(local.x));
      if (drag.handle.includes('t') && drag.handle !== 'rotate') top = Math.min(o.h - 5, round(local.y));
      const w = right - left; const h = bottom - top;
      item.w = w; item.h = h;
      item.x = o.x + left * Math.cos(angle) - top * Math.sin(angle);
      item.y = o.y + left * Math.sin(angle) + top * Math.cos(angle);
      updateInspectorPosition();
      requestRender();
    } else if (drag.type === 'vertex') {
      const geom = geometry();
      const vertex = geom?.vertices[drag.index];
      if (vertex) {
        let next = world;
        if (!event.altKey) {
          // Keep walls orthogonal when close to axis-aligned with neighbours
          const n = geom.vertices.length;
          for (const neighbour of [geom.vertices[(drag.index - 1 + n) % n], geom.vertices[(drag.index + 1) % n]]) {
            if (!neighbour || neighbour === vertex) continue;
            if (Math.abs(next.x - neighbour.x) * ui.view2d.z < 8) next = { ...next, x: neighbour.x };
            if (Math.abs(next.y - neighbour.y) * ui.view2d.z < 8) next = { ...next, y: neighbour.y };
          }
        }
        vertex.x = next.x; vertex.y = next.y;
        const n = geom.vertices.length;
        geom.confirmedWalls[(drag.index - 1 + n) % n] = false;
        geom.confirmedWalls[drag.index] = false;
        requestRender();
      }
    } else if (drag.type === 'object') {
      const geom = geometry();
      const object = geom?.objects.find(value => value.id === drag.id);
      if (object && !object.fullWall) {
        const frame = Geometry.wallFrame(geom.vertices, object.wallIndex, 0);
        if (frame) {
          const nearest = Geometry.nearestPointOnSegment(world, frame.start, frame.end);
          object.offset = clamp(Math.round(nearest.offset), object.width / 2, frame.length - object.width / 2);
          object.estimated = false;
          requestRender();
          renderInspectorSoon();
        }
      }
    }
  });

  function endPointer(event) {
    pointers.delete(event.pointerId);
    if (!drag) return;
    const type = drag.type;
    if (type === 'move' && drag.moved) commit('Bútor áthelyezve');
    else if (type === 'rotate') commit('Forgatás');
    else if (type === 'resize') commit('Átméretezés');
    else if (type === 'vertex') commit('Falpont mozgatása');
    else if (type === 'object') commit('Nyílászáró mozgatása');
    if (type === 'pan') canvas.style.cursor = ui.tool === 'pan' ? 'grab' : 'default';
    drag = null;
    ui.guides = [];
    renderInspector();
    requestRender();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerleave', () => { ui.hoverId = null; updateCursorInfo(null); requestRender(); });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (event.ctrlKey || Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.012 : 0.0016));
      zoomAt(factor, localPoint(event));
    } else {
      ui.view2d.x -= event.deltaX; requestRender();
    }
  }, { passive: false });
  canvas.addEventListener('dblclick', event => {
    if (ui.mode !== 'walls') return;
    const world = toWorld(localPoint(event));
    const wall = hitWall(world);
    if (wall) splitWall(wall.wallIndex, wall.point);
  });

  function updateCursorInfo(world) {
    const geom = geometry();
    const base = geom?.vertices.length ? Geometry.polygonBounds(geom.vertices) : { minX: 0, minY: 0 };
    $('cursorInfo').textContent = world ? `x ${fmt(world.x - base.minX, 0)} · y ${fmt(world.y - base.minY, 0)} cm` : '';
  }

  // Drag & drop from the catalogue
  const view2dNode = $('view2d');
  view2dNode.addEventListener('dragover', event => {
    if (!event.dataTransfer.types.includes('text/zuglak-product')) return;
    event.preventDefault();
    $('dropHint').hidden = false;
  });
  view2dNode.addEventListener('dragleave', event => { if (!view2dNode.contains(event.relatedTarget)) $('dropHint').hidden = true; });
  view2dNode.addEventListener('drop', event => {
    $('dropHint').hidden = true;
    const key = event.dataTransfer.getData('text/zuglak-product');
    if (!key) return;
    event.preventDefault();
    const product = productByKey(key);
    if (!product) return;
    const rect = canvas.getBoundingClientRect();
    const world = toWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    addProduct(product, world);
  });

  // ------------------------------------------------------------------ architecture editing
  function startArchitecture(mode = 'walls') {
    const geom = geometry();
    if (!geom && mode !== 'draw') { mode = 'draw'; }
    ui.mode = mode;
    ui.selectedId = null;
    ui.openingTool = null;
    document.body.classList.remove('has-selection');
    if (ui.view !== '2d') setView('2d');
    renderModeBanner();
    renderInspector();
    renderRoomPanel();
    fitView();
  }

  function finishArchitecture() {
    ui.mode = 'furnish';
    ui.selectedVertex = null; ui.selectedWall = null; ui.selectedObjectId = null; ui.openingTool = null; ui.calibration = null;
    renderModeBanner();
    renderInspector();
    renderRoomPanel();
    requestRender();
  }

  function renderModeBanner() {
    const banner = $('modeBanner');
    banner.hidden = ui.mode === 'furnish' || ui.presentation;
    if (banner.hidden) return;
    const texts = {
      walls: ['Falak szerkesztése', 'Húzd a falpontokat · kattints egy falra a pontos hosszhoz · dupla kattintás: új pont'],
      openings: ['Nyílászárók', 'Válassz elemet, majd kattints egy falra · a meglévőket húzással mozgathatod'],
      draw: ['Új szobageometria', 'Kattints sorban a falpontokra; az első pontra kattintva zárul a poligon'],
      calibrate: ['Alaprajzkép igazítása', 'Jelölj ki két pontot a rajzon, majd add meg a valós távolságot. Csak a háttérképet méretezi.']
    };
    $('modeBannerTitle').textContent = texts[ui.mode][0];
    $('modeBannerHelp').textContent = texts[ui.mode][1];
    const tools = $('modeBannerTools');
    tools.innerHTML = '';
    const addTool = (id, iconName, title, active, onClick) => {
      const button = document.createElement('button');
      button.className = `tool${active ? ' selected' : ''}`;
      button.title = title;
      button.dataset.archTool = id;
      button.innerHTML = icon(iconName);
      button.onclick = onClick;
      tools.append(button);
    };
    if (ui.mode === 'walls' || ui.mode === 'openings') {
      addTool('walls', 'wall', 'Falpontok', ui.mode === 'walls', () => { ui.mode = 'walls'; ui.openingTool = null; renderModeBanner(); renderInspector(); requestRender(); });
      for (const [type, iconName, title] of [['door', 'door', 'Ajtó'], ['window', 'window', 'Ablak'], ['radiator', 'radiator', 'Radiátor'], ['opening', 'opening', 'Nyílás (fal nélkül)']]) {
        addTool(type, iconName, title, ui.mode === 'openings' && ui.openingTool === type, () => { ui.mode = 'openings'; ui.openingTool = ui.openingTool === type ? null : type; renderModeBanner(); renderInspector(); requestRender(); });
      }
    }
  }

  function architecturePointerDown(world, point) {
    const geom = geometry();
    if (ui.mode === 'calibrate') {
      if (!ui.calibration?.a || ui.calibration.b) ui.calibration = { a: world };
      else {
        ui.calibration.b = world;
        requestRender();
        const imagePx = Geometry.distance(ui.calibration.a, ui.calibration.b) * Number(room().pxPerCm);
        ask('Alaprajzkép méretaránya', 'A kijelölt szakasz valós hossza. Ez csak a háttérkép méretét változtatja, a falakat és bútorokat nem.', [
          { key: 'cm', label: 'Valós hossz (cm)', value: '100', type: 'number' }
        ]).then(answer => {
          const cm = Number(answer?.cm);
          if (cm > 0 && imagePx > 1) {
            room().pxPerCm = imagePx / cm;
            commit('Képkalibráció');
            toast(`Háttérkép skálája: 1 cm = ${fmt(room().pxPerCm, 3)} px`);
          }
          ui.calibration = null;
          finishArchitecture();
        });
      }
      requestRender();
      return;
    }
    if (ui.mode === 'draw') {
      let target = geom;
      if (!target || target.closed) {
        target = { id: idFactory(), name: `Saját geometria ${geometries().length + 1}`, source: 'user', vertices: [], closed: false, confirmedWalls: [], objects: [], partitions: [], wallLabels: [], wallNotes: [] };
        geometries().push(target);
        room().activeGeometryId = target.id;
      }
      const vertexIndex = hitVertex(point);
      if (vertexIndex === 0 && target.vertices.length >= 3) {
        if (Geometry.polygonSelfIntersects(target.vertices, true)) { toast('A poligon önmetsző, így nem zárható.'); return; }
        target.closed = true;
        target.confirmedWalls = target.vertices.map(() => false);
        commit('Geometria lezárása');
        ui.mode = 'walls';
        renderModeBanner(); renderRoomPanel(); renderInspector(); requestRender();
        toast('A geometria lezárva. A falhosszakat a jobb oldali panelen pontosíthatod.');
        return;
      }
      let next = world;
      const last = target.vertices.at(-1);
      if (last) {
        if (Math.abs(next.x - last.x) * ui.view2d.z < 10) next = { ...next, x: last.x };
        if (Math.abs(next.y - last.y) * ui.view2d.z < 10) next = { ...next, y: last.y };
      }
      target.vertices.push({ id: idFactory(), x: Math.round(next.x * 10) / 10, y: Math.round(next.y * 10) / 10 });
      commit('Falpont hozzáadása');
      renderRoomPanel();
      requestRender();
      return;
    }
    if (!geom) return;
    if (ui.mode === 'walls') {
      const vertexIndex = hitVertex(point);
      if (vertexIndex >= 0) {
        ui.selectedVertex = vertexIndex; ui.selectedWall = null;
        drag = { type: 'vertex', index: vertexIndex };
        renderInspector(); requestRender();
        return;
      }
      const wall = hitWall(world);
      ui.selectedVertex = null;
      ui.selectedWall = wall ? wall.wallIndex : null;
      renderInspector(); renderRoomPanel(); requestRender();
      return;
    }
    if (ui.mode === 'openings') {
      const object = hitObject(world);
      if (object && !ui.openingTool) {
        ui.selectedObjectId = object.id;
        drag = { type: 'object', id: object.id };
        renderInspector(); requestRender();
        return;
      }
      if (ui.openingTool) { addOpeningAt(world); return; }
      ui.selectedObjectId = object?.id || null;
      renderInspector(); requestRender();
    }
  }

  function addOpeningAt(world) {
    const geom = geometry();
    if (!geom?.closed) { toast('Nyílászáróhoz előbb zárt szobageometria kell.'); return; }
    const nearest = Geometry.nearestWall(world, geom.vertices, true);
    if (!nearest || nearest.distance > Math.max(thickness() + 10, 24 / ui.view2d.z)) { toast('Kattints közelebb egy falhoz.'); return; }
    const defaultsByType = {
      door: { name: 'Ajtó', width: 90, hinge: 'start', swing: 'in' },
      window: { name: 'Ablak', width: 120, height: 140, sill: 85 },
      radiator: { name: 'Radiátor', width: 80, depth: 10, height: 60 },
      opening: { name: 'Nyílás', width: 90 }
    };
    const base = defaultsByType[ui.openingTool];
    const width = Math.min(base.width, nearest.length);
    const object = { id: idFactory(), type: ui.openingTool, wallIndex: nearest.wallIndex, ...base, width, offset: clamp(nearest.offset, width / 2, nearest.length - width / 2) };
    geom.objects.push(object);
    ui.selectedObjectId = object.id;
    ui.openingTool = null;
    commit('Nyílászáró hozzáadása');
    renderModeBanner(); renderInspector(); requestRender();
    toast(`${base.name} elhelyezve – a méretek a jobb oldalon pontosíthatók.`);
  }

  function splitWall(index, point) {
    const geom = geometry();
    if (!geom) return;
    const a = geom.vertices[index];
    const b = geom.vertices[(index + 1) % geom.vertices.length];
    const p = point || { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    geom.vertices.splice(index + 1, 0, { id: idFactory(), x: p.x, y: p.y });
    geom.confirmedWalls.splice(index, 1, false, false);
    geom.wallLabels.splice(index, 1, null, null);
    geom.wallNotes.splice(index, 1, '', '');
    for (const object of geom.objects) if (object.wallIndex > index) object.wallIndex += 1;
    commit('Fal felosztása');
    ui.selectedVertex = index + 1; ui.selectedWall = null;
    renderInspector(); renderRoomPanel(); requestRender();
  }

  function deleteVertex(index) {
    const geom = geometry();
    if (!geom || geom.vertices.length <= 3) { toast('Legalább három falpont szükséges.'); return; }
    geom.vertices.splice(index, 1);
    const n = geom.vertices.length + 1;
    const prev = (index - 1 + n) % n;
    geom.confirmedWalls.splice(index, 1); geom.confirmedWalls[Math.min(prev, geom.confirmedWalls.length - 1)] = false;
    geom.wallLabels.splice(index, 1); geom.wallNotes.splice(index, 1);
    geom.objects = geom.objects.filter(object => object.wallIndex !== index && object.wallIndex !== prev);
    for (const object of geom.objects) if (object.wallIndex > index) object.wallIndex -= 1;
    if (Geometry.polygonSelfIntersects(geom.vertices, geom.closed)) toast('Figyelem: a geometria önmetsző lett.');
    ui.selectedVertex = null;
    commit('Falpont törlése');
    renderInspector(); renderRoomPanel(); requestRender();
  }

  function setWallLength(index, value, confirm = true) {
    const geom = geometry();
    try {
      geom.vertices = Geometry.setWallLength(geom.vertices, index, value, geom.closed);
      geom.confirmedWalls[index] = confirm;
      const next = (index + 1) % geom.vertices.length;
      if (geom.closed || index + 1 < geom.vertices.length - 1) geom.confirmedWalls[next] = false;
      commit('Falhossz');
      renderInspector(); renderRoomPanel(); requestRender();
    } catch (error) { toast(error.message); }
  }

  // ------------------------------------------------------------------ dialogs
  // One shared confirm/prompt dialog. Cancel / Esc always closes it (the form is
  // `novalidate`, Mégse is `formnovalidate`); only "Rendben" (also Enter) is validated,
  // with Hungarian messages instead of browser bubbles that would block closing.
  let pendingAsk = null;
  function fieldProblem(input) {
    const label = input.dataset.label || 'Mező';
    const v = input.validity;
    if (v.badInput) return `${label}: számot adj meg.`;
    if (v.valueMissing) return `${label}: kitöltése kötelező.`;
    if (v.rangeUnderflow) return `${label}: legalább ${input.min.replace('.', ',')}.`;
    if (v.rangeOverflow) return `${label}: legfeljebb ${input.max.replace('.', ',')}.`;
    if (!v.valid) return `${label}: érvénytelen érték.`;
    if (input.dataset.trim && !input.value.trim()) return `${label}: kitöltése kötelező.`;
    return '';
  }
  function setupAskDialog() {
    const dialog = $('dialog');
    $('dialogForm').addEventListener('submit', event => {
      if (event.submitter?.value === 'cancel') return;
      for (const input of $('dialogFields').querySelectorAll('input,select')) {
        const problem = fieldProblem(input);
        if (problem) {
          event.preventDefault();
          $('dialogError').textContent = problem;
          $('dialogError').hidden = false;
          input.focus(); input.select?.();
          return;
        }
      }
    });
    $('dialogFields').addEventListener('input', () => { $('dialogError').hidden = true; });
    dialog.addEventListener('close', settleAsk);
  }
  // Resolves the open prompt from the dialog's returnValue. Called by the (asynchronous)
  // close event, and synchronously by ask() if a new prompt arrives before that event.
  function settleAsk() {
    const current = pendingAsk;
    pendingAsk = null;
    if (!current) return;
    $('dialogOk').textContent = 'Rendben';
    if ($('dialog').returnValue !== 'ok') return current.resolve(null);
    const result = {};
    current.fields.forEach(definition => { result[definition.key] = $('dialogFields').querySelector(`[name="${definition.key}"]`).value; });
    current.resolve(result);
  }
  function ask(title, hint, fields, okLabel = 'Rendben') {
    const dialog = $('dialog');
    // A second request while one is already open (e.g. a double-triggered action)
    // is ignored instead of throwing InvalidStateError or hijacking the first answer.
    if (dialog.open) return Promise.resolve(null);
    if (pendingAsk) settleAsk();
    return new Promise(resolve => {
      const container = $('dialogFields');
      $('dialogTitle').textContent = title;
      $('dialogHint').textContent = hint || '';
      $('dialogHint').hidden = !hint;
      $('dialogError').hidden = true;
      $('dialogOk').textContent = okLabel;
      container.innerHTML = '';
      for (const definition of fields) {
        const box = document.createElement('div');
        box.className = 'field';
        const label = document.createElement('label');
        label.textContent = definition.label;
        const input = definition.options ? document.createElement('select') : document.createElement('input');
        input.name = definition.key;
        input.id = `dialog-field-${definition.key}`;
        label.htmlFor = input.id;
        input.dataset.label = definition.label.replace(/\s*\(.*\)\s*$/, '');
        if (definition.options) {
          for (const [value, text] of definition.options) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); }
        } else input.type = definition.type || 'text';
        input.value = definition.value ?? '';
        if (definition.required !== false && !definition.options) {
          input.required = true;
          if (input.type === 'text') input.dataset.trim = '1';
        }
        if (input.type === 'number') { input.min = definition.min ?? '0.1'; input.max = definition.max ?? '5000'; input.step = 'any'; }
        box.append(label, input);
        container.append(box);
      }
      pendingAsk = { resolve, fields };
      dialog.returnValue = '';
      dialog.showModal();
      setTimeout(() => { const first = container.querySelector('input,select'); (first || $('dialogOk')).focus(); }, 30);
    });
  }

  async function confirmAction(title, hint, okLabel = 'Rendben') {
    return (await ask(title, hint, [], okLabel)) !== null;
  }

  // ------------------------------------------------------------------ inspector
  function numberField(label, value, onChange, options = {}) {
    const box = document.createElement('div');
    box.className = 'field';
    box.innerHTML = `<label>${escapeHtml(label)}</label><div class="num"><input type="number" step="${options.step || 1}" ${options.min !== undefined ? `min="${options.min}"` : ''} ${options.max !== undefined ? `max="${options.max}"` : ''}><span class="unit">${options.unit ?? 'cm'}</span></div>`;
    const input = box.querySelector('input');
    input.value = Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : '';
    if (options.disabled) input.disabled = true;
    if (options.key) input.dataset.key = options.key;
    input.addEventListener('change', () => {
      const next = Number(input.value);
      if (!Number.isFinite(next) || (options.positive !== false && next <= 0)) { input.value = value; return; }
      onChange(next);
    });
    return box;
  }

  function section(title, extra = '') {
    const node = document.createElement('section');
    node.className = 'inspector-section';
    if (title) node.innerHTML = `<h3><span>${escapeHtml(title)}</span>${extra}</h3>`;
    return node;
  }

  function sourceBadge(item) {
    if (item.source === 'ikea') return '<span class="badge ikea">IKEA · ellenőrzött méret</span>';
    if (item.dimensionStatus === 'user') return '<span class="badge user">Saját méret</span>';
    if (item.aiSuggested) return '<span class="badge ai">AI által javasolt méret</span>';
    return '<span class="badge typical">Tipikus méret</span>';
  }

  function renderInspectorSoon() { inspectorQueued = true; requestRender(); }

  function renderInspector() {
    const node = $('inspector');
    node.innerHTML = '';
    if (ui.mode !== 'furnish') { renderArchitectureInspector(node); return; }
    const item = selectedItem();
    if (!item) { renderRoomOverview(node); return; }
    const model = Catalog.modelFor(item);

    const header = section('');
    header.innerHTML = `<div class="item-header"><div class="thumb"><img alt=""></div><div><input class="name-input" aria-label="Megnevezés"><div class="sub">${sourceBadge(item)}${item.productId ? `<span>${escapeHtml(item.productId)}</span>` : ''}</div></div></div>`;
    header.querySelector('img').src = Art.thumbnail({ key: `sel-${model}`, model, width: item.w, depth: item.h, height: item.height, materials: item.materials }, 112);
    const nameInput = header.querySelector('.name-input');
    nameInput.value = item.name;
    nameInput.onchange = () => { const value = nameInput.value.trim(); if (value) { item.name = value; commit('Átnevezés'); requestRender(); } else nameInput.value = item.name; };
    if (item.source === 'ikea' && item.productUrl) {
      const links = document.createElement('div');
      links.className = 'button-row';
      links.innerHTML = `<a class="product-link" href="${escapeHtml(item.productUrl)}" target="_blank" rel="noopener noreferrer">Termékoldal ${icon('external')}</a>`;
      const fav = document.createElement('button');
      fav.className = 'button small ghost';
      fav.innerHTML = `${icon('heart')}${isFavorite(item.productId) ? 'Kedvenc' : 'Kedvencekhez'}`;
      fav.onclick = () => toggleFavorite(productFromItem(item));
      links.append(fav);
      header.append(links);
    }
    node.append(header);

    // Dimensions
    const dims = section('Méretek', item.source === 'ikea' ? '<span class="badge verified">ellenőrzött</span>' : item.dimensionStatus === 'user' ? '<span class="badge user">saját</span>' : item.aiSuggested ? '<span class="badge ai">AI-javaslat</span>' : '<span class="badge typical">tipikus</span>');
    const grid = document.createElement('div');
    grid.className = 'grid-3';
    const lockedDims = item.source === 'ikea' && !item.unlockDims;
    grid.append(
      numberField('Szélesség', item.w, value => { Object.assign(item, Geometry.resizeAboutCenter(item, value, item.h)); markUserDims(item); commit('Méret'); renderInspector(); requestRender(); }, { disabled: lockedDims || item.locked, key: 'w', step: 0.5 }),
      numberField('Mélység', item.h, value => { Object.assign(item, Geometry.resizeAboutCenter(item, item.w, value)); markUserDims(item); commit('Méret'); renderInspector(); requestRender(); }, { disabled: lockedDims || item.locked, key: 'h', step: 0.5 }),
      numberField('Magasság', item.height || Catalog.defaultHeight(model), value => { item.height = value; markUserDims(item); commit('Méret'); requestRender(); }, { disabled: (lockedDims && item.height) || item.locked, step: 0.5 })
    );
    dims.append(grid);
    if (!item.height) {
      const note = document.createElement('p');
      note.className = 'note warning';
      note.textContent = `Magasság nincs megadva – a 3D nézet tipikus ${fmt(Catalog.defaultHeight(model))} cm-rel ábrázolja. Írd be a valós értéket.`;
      dims.append(note);
    }
    if (item.source === 'ikea') {
      const original = item.originalDimensions;
      const changed = original && (item.w !== original.width || item.h !== original.depth);
      const note = document.createElement('p');
      note.className = `note${changed ? ' warning' : ''}`;
      note.textContent = changed
        ? `A terven átméretezve. Eredeti termékméret: ${fmt(original.width)} × ${fmt(original.depth)}${original.height ? ` × ${fmt(original.height)}` : ''} cm.`
        : `Termékoldal szerinti külső méret (${Ikea?.verifiedAt || ''}). A 3D modell illusztráció, nem a termék pontos formája.`;
      dims.append(note);
      const unlock = document.createElement('label');
      unlock.className = 'check';
      unlock.innerHTML = `<input type="checkbox"${item.unlockDims ? ' checked' : ''}> Méret kézi módosításának engedélyezése`;
      unlock.querySelector('input').onchange = event => { item.unlockDims = event.target.checked; commit('Méretzár'); renderInspector(); };
      dims.append(unlock);
    } else if (item.dimensionStatus === 'typical') {
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = 'Tipikus tervezési méret, nem termékadat. Írd át a megvásárolni kívánt bútor méretére; a sarokpontokkal is átméretezhető.';
      dims.append(note);
    }
    node.append(dims);

    // Placement
    const place = section('Elhelyezés', item.locked ? '<span class="badge typical">rögzítve</span>' : '');
    const interior = interiorBounds();
    const center = Geometry.itemCenter(item);
    const pos = document.createElement('div');
    pos.className = 'grid-2';
    pos.append(
      numberField('Közép X', center.x - interior.minX, value => { Object.assign(item, Geometry.cornerForCenter(item, { x: value + interior.minX, y: Geometry.itemCenter(item).y })); commit('Pozíció'); requestRender(); }, { disabled: item.locked, key: 'cx', positive: false }),
      numberField('Közép Y', center.y - interior.minY, value => { Object.assign(item, Geometry.cornerForCenter(item, { x: Geometry.itemCenter(item).x, y: value + interior.minY })); commit('Pozíció'); requestRender(); }, { disabled: item.locked, key: 'cy', positive: false })
    );
    place.append(pos);
    const rotation = document.createElement('div');
    rotation.className = 'rotation-row';
    const rotationField = numberField('Forgatás', item.rot || 0, value => rotateSelected(value, true), { unit: '°', positive: false, disabled: item.locked, key: 'rot' });
    const quick = document.createElement('div');
    quick.className = 'quick-angles';
    for (const angle of [0, 90, 180, 270]) {
      const button = document.createElement('button');
      button.textContent = `${angle}°`;
      button.className = Math.round(item.rot || 0) === angle ? 'selected' : '';
      button.disabled = item.locked;
      button.onclick = () => rotateSelected(angle, true);
      quick.append(button);
    }
    rotation.append(rotationField, quick);
    place.append(rotation);
    const placementActions = document.createElement('div');
    placementActions.className = 'action-grid';
    const action = (iconName, label, handler, cls = '') => {
      const button = document.createElement('button');
      button.className = `button small ${cls}`;
      button.innerHTML = `${icon(iconName)}${label}`;
      button.onclick = handler;
      button.disabled = item.locked && !['Feloldás', 'Rögzítés'].includes(label);
      placementActions.append(button);
      return button;
    };
    action('align', 'Falhoz tolás', () => pushSelectedToWall());
    action('rotate', 'Falhoz forgatás', () => alignSelectedToWall());
    action('rotate-left', '−90°', () => rotateSelected(-90));
    action('rotate', '+90°', () => rotateSelected(90));
    place.append(placementActions);
    const geom = geometry();
    if (geom) {
      const clearances = Geometry.wallClearances(item, Geometry.wallSegments(geom));
      const labels = { top: 'Hátul', right: 'Jobbra', bottom: 'Elöl', left: 'Balra' };
      const grid4 = document.createElement('div');
      grid4.className = 'clearance-grid';
      grid4.dataset.role = 'clearances';
      grid4.innerHTML = clearances.map(value => `<div><small>${labels[value.side]}</small><strong>${Number.isFinite(value.distance) ? fmt(value.distance, 0) : '–'}</strong></div>`).join('');
      const caption = document.createElement('p');
      caption.className = 'note';
      caption.textContent = 'Szabad távolság a legközelebbi falig, cm (a bútor saját oldalaitól mérve).';
      place.append(grid4, caption);
    }
    node.append(place);

    // Materials
    const materialsSection = section('Anyagok és színek');
    renderSlotEditor(materialsSection, item);
    node.append(materialsSection);

    // Actions
    const actions = section('Műveletek');
    const actionGrid = document.createElement('div');
    actionGrid.className = 'action-grid';
    const add = (iconName, label, handler, cls = '') => {
      const button = document.createElement('button');
      button.className = `button small ${cls}`;
      button.innerHTML = `${icon(iconName)}${label}`;
      button.onclick = handler;
      actionGrid.append(button);
    };
    add('copy', 'Másolat', duplicateSelected);
    add(item.locked ? 'lock-open' : 'lock', item.locked ? 'Feloldás' : 'Rögzítés', () => { item.locked = !item.locked; commit('Rögzítés'); renderInspector(); requestRender(); });
    add('layers', 'Előre', () => { variant().items = [...items().filter(v => v.id !== item.id), item]; commit('Sorrend'); requestRender(); });
    add('trash', 'Törlés', deleteSelected, 'danger');
    actions.append(actionGrid);
    const shortcuts = document.createElement('p');
    shortcuts.className = 'note';
    shortcuts.textContent = 'Nyilak: 1 cm · Shift + nyilak: 10 cm · R: forgatás 90° · Ctrl+D: másolat · Del: törlés · Alt húzás közben: illesztés nélkül';
    actions.append(shortcuts);
    node.append(actions);
  }

  function markUserDims(item) {
    if (item.source !== 'ikea') { item.dimensionStatus = 'user'; delete item.aiSuggested; }
  }

  function updateInspectorPosition() {
    const item = selectedItem();
    if (!item) return;
    const interior = interiorBounds();
    const center = Geometry.itemCenter(item);
    const set = (key, value) => { const input = $('inspector').querySelector(`input[data-key="${key}"]`); if (input && document.activeElement !== input) input.value = Math.round(value * 10) / 10; };
    set('cx', center.x - interior.minX); set('cy', center.y - interior.minY); set('rot', item.rot || 0); set('w', item.w); set('h', item.h);
    const grid = $('inspector').querySelector('[data-role="clearances"]');
    const geom = geometry();
    if (grid && geom) {
      const values = Geometry.wallClearances(item, Geometry.wallSegments(geom));
      grid.querySelectorAll('strong').forEach((strong, index) => { strong.textContent = Number.isFinite(values[index].distance) ? fmt(values[index].distance, 0) : '–'; });
    }
  }

  function pushSelectedToWall() {
    const item = selectedItem();
    const geom = geometry();
    if (!item || !geom) return;
    const result = Geometry.pushToWall(item, Geometry.wallSegments(geom), 0);
    if (!result) { toast('A bútor mögött nincs fal.'); return; }
    item.x = result.x; item.y = result.y;
    commit('Falhoz tolás');
    renderInspector(); requestRender();
    toast('A bútor háta a falhoz illesztve.');
  }

  function alignSelectedToWall() {
    const item = selectedItem();
    const geom = geometry();
    if (!item || !geom) return;
    const center = Geometry.itemCenter(item);
    const wall = Geometry.nearestWall(center, geom.vertices, geom.closed);
    if (!wall) return;
    // Rotate so the item's back (local top edge) faces the nearest wall.
    const frame = Geometry.wallFrame(geom.vertices, wall.wallIndex, wall.offset);
    const inward = frame.inward; // points into the room
    // Local "front" direction for rot=θ is (−sinθ, cosθ); we need front == inward.
    const angle = Math.atan2(-inward.x, inward.y) * 180 / Math.PI;
    Object.assign(item, Geometry.rotateAboutCenter(item, Math.round(angle * 10) / 10));
    const pushed = Geometry.pushToWall(item, Geometry.wallSegments(geom), 0);
    if (pushed) { item.x = pushed.x; item.y = pushed.y; }
    commit('Falhoz forgatás');
    renderInspector(); requestRender();
  }

  function renderSlotEditor(container, item, compact = false) {
    const model = Catalog.modelFor(item);
    const slots = Catalog.slotsFor(item);
    const current = { ...Catalog.defaultMaterials(model), ...(item.materials || {}) };
    for (const [slot, label] of Object.entries(slots)) {
      const wrapper = document.createElement('div');
      wrapper.className = 'slot';
      const mat = Materials.get(current[slot] || current.primary);
      wrapper.innerHTML = `<div class="slot-head"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(mat.name)}</span></div>`;
      const swatches = document.createElement('div');
      swatches.className = 'swatches';
      const groups = Catalog.slotGroups(model, slot);
      for (const material of Materials.inGroup(...groups).slice(0, compact ? 18 : 30)) {
        const swatch = makeSwatch(material, current[slot] === material.id, () => {
          item.materials = { ...(item.materials || {}), [slot]: material.id };
          commit('Anyag');
          renderInspector(); renderMaterialsSelection(); requestRender();
        });
        swatches.append(swatch);
      }
      wrapper.append(swatches);
      container.append(wrapper);
    }
    const same = items().filter(value => value.id !== item.id && Catalog.modelFor(value) === model);
    if (same.length) {
      const button = document.createElement('button');
      button.className = 'button small ghost wide';
      button.innerHTML = `${icon('copy')}Alkalmazás mind a(z) ${same.length + 1} hasonló bútorra`;
      button.onclick = () => { same.forEach(value => { value.materials = { ...(item.materials || {}) }; }); commit('Anyag mindre'); toast('Anyagok átmásolva'); requestRender(); };
      container.append(button);
    }
  }

  const swatchCache = new Map();
  function swatchImage(material) {
    if (swatchCache.has(material.id)) return swatchCache.get(material.id);
    let url = '';
    if (material.pattern && material.pattern !== 'plain' && material.tile) {
      const source = Art.textureSource(material, 128);
      // Show roughly 60 cm of floors, 20 cm of fabrics
      const canvasNode = document.createElement('canvas');
      canvasNode.width = canvasNode.height = 96;
      const ctx = canvasNode.getContext('2d', { willReadFrequently: true });
      const show = material.group === 'floor' ? 90 : material.group === 'fabric' || material.group === 'rug' ? 14 : 40;
      const scale = 96 / show;
      const pattern = ctx.createPattern(source, 'repeat');
      pattern.setTransform(new DOMMatrix().scale(material.tile / 128 * scale));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, 96, 96);
      url = canvasNode.toDataURL();
    }
    swatchCache.set(material.id, url);
    return url;
  }

  function makeSwatch(material, selected, onClick) {
    const button = document.createElement('button');
    button.className = `swatch${selected ? ' selected' : ''}`;
    button.title = material.name;
    button.setAttribute('aria-label', material.name);
    const image = swatchImage(material);
    button.style.background = image ? `url(${image}) center / cover` : `linear-gradient(145deg, ${Materials.shade(material.color, 0.12)}, ${Materials.shade(material.color, -0.08)})`;
    if (material.metalness) button.style.background = `linear-gradient(135deg, ${Materials.shade(material.color, 0.35)}, ${material.color} 45%, ${Materials.shade(material.color, -0.25)})`;
    button.onclick = onClick;
    return button;
  }

  function renderRoomOverview(node) {
    const geom = geometry();
    const head = section('');
    head.innerHTML = `<div class="empty-inspector"><div class="hero">${icon('plan')}</div><strong>${escapeHtml(room().name)}</strong><p class="note">${escapeHtml(room().active)} · ${items().length} bútor</p></div>`;
    node.append(head);
    const stats = section('Helyiség');
    if (geom?.closed) {
      const area = Geometry.polygonArea(geom.vertices) / 10000;
      const confirmed = geom.confirmedWalls.filter(Boolean).length;
      stats.innerHTML += `<div class="stats">
        <div class="stat"><small>Alapterület</small><strong>${fmt(area, 2)}<em>m²</em></strong></div>
        <div class="stat"><small>Kerület</small><strong>${fmt(Geometry.polygonPerimeter(geom.vertices) / 100, 2)}<em>m</em></strong></div>
        <div class="stat"><small>Falak</small><strong>${geom.vertices.length}</strong></div>
        <div class="stat"><small>Megerősített</small><strong>${confirmed}<em>/ ${geom.vertices.length}</em></strong></div></div>`;
      if (confirmed < geom.vertices.length) {
        const warning = document.createElement('p');
        warning.className = 'note warning';
        warning.textContent = `${geom.vertices.length - confirmed} fal hossza becsült (≈). Az alapterület ezért tájékoztató. Részletek: Helyiség fül.`;
        stats.append(warning);
      }
    } else {
      stats.innerHTML += '<p class="note">Ehhez a helyiséghez még nincs zárt falgeometria. A Helyiség fülön rajzolhatsz egyet.</p>';
    }
    node.append(stats);
    const surfaces = section('Felületek');
    const floorRow = document.createElement('div');
    floorRow.className = 'slot';
    floorRow.innerHTML = `<div class="slot-head"><strong>Padló</strong><span>${escapeHtml(Materials.get(roomMaterials().floor).name)}</span></div>`;
    const floorSw = document.createElement('div'); floorSw.className = 'swatches';
    for (const material of Materials.inGroup('floor')) floorSw.append(makeSwatch(material, roomMaterials().floor === material.id, () => setRoomMaterial('floor', material.id)));
    floorRow.append(floorSw);
    const wallRow = document.createElement('div');
    wallRow.className = 'slot';
    wallRow.innerHTML = `<div class="slot-head"><strong>Fal</strong><span>${escapeHtml(Materials.get(roomMaterials().walls).name)}</span></div>`;
    const wallSw = document.createElement('div'); wallSw.className = 'swatches';
    for (const material of Materials.inGroup('wall')) wallSw.append(makeSwatch(material, roomMaterials().walls === material.id, () => setRoomMaterial('walls', material.id)));
    wallRow.append(wallSw);
    surfaces.append(floorRow, wallRow);
    node.append(surfaces);
    const tips = section('Első lépések');
    tips.innerHTML += '<p class="note">Húzz bútort a bal oldali katalógusból a terv fölé, vagy kattints rá. A bútor kijelölésekor itt állíthatod a pontos méretet, pozíciót, forgatást és az anyagokat. A 2D és a 3D nézet ugyanazt a tervet mutatja.</p>';
    node.append(tips);
  }

  function setRoomMaterial(kind, id) {
    roomMaterials()[kind] = id;
    commit(kind === 'floor' ? 'Padló' : 'Falszín');
    renderInspector();
    renderMaterialsPanel();
    requestRender();
  }

  function renderArchitectureInspector(node) {
    const geom = geometry();
    if (ui.mode === 'calibrate') {
      node.append(Object.assign(section('Háttérkép igazítása'), {}));
      node.lastChild.innerHTML += '<p class="note">Az eredeti rajz csak tájékoztató háttér. Kalibrálása nem módosítja a falakat és a bútorokat.</p>';
      return;
    }
    if (!geom) {
      const s = section('Új geometria');
      s.innerHTML += '<p class="note">Kattints a terven a falpontokra sorban. Az első pontra kattintva zárod a poligont.</p>';
      node.append(s);
      return;
    }
    const object = geom.objects.find(value => value.id === ui.selectedObjectId);
    if (ui.mode === 'openings' && object) { renderObjectInspector(node, geom, object); return; }
    if (ui.selectedVertex !== null && geom.vertices[ui.selectedVertex]) {
      const vertex = geom.vertices[ui.selectedVertex];
      const s = section(`${ui.selectedVertex + 1}. falpont`);
      const grid = document.createElement('div'); grid.className = 'grid-2';
      const b = Geometry.polygonBounds(geom.vertices);
      grid.append(
        numberField('X', vertex.x - b.minX, value => { vertex.x = value + b.minX; invalidateAdjacent(geom, ui.selectedVertex); commit('Falpont'); renderInspector(); requestRender(); }, { positive: false }),
        numberField('Y', vertex.y - b.minY, value => { vertex.y = value + b.minY; invalidateAdjacent(geom, ui.selectedVertex); commit('Falpont'); renderInspector(); requestRender(); }, { positive: false })
      );
      s.append(grid);
      const del = document.createElement('button');
      del.className = 'button small danger';
      del.innerHTML = `${icon('trash')}Falpont törlése`;
      del.onclick = () => deleteVertex(ui.selectedVertex);
      s.append(del);
      node.append(s);
      return;
    }
    if (ui.selectedWall !== null && geom.vertices.length >= 2) {
      node.append(wallEditor(geom, ui.selectedWall));
      return;
    }
    const s = section('Szerkezet');
    s.innerHTML += `<p class="note">${ui.mode === 'openings' ? 'Válassz eszközt a felső sávban (ajtó, ablak, radiátor, nyílás), majd kattints egy falra. Meglévő elemet kijelölhetsz és a fal mentén húzhatsz.' : 'Kattints egy falra a hossz pontosításához, vagy húzz egy falpontot. Dupla kattintás a falon: új töréspont.'}</p>`;
    node.append(s);
    const thicknessSection = section('Megjelenítés');
    const grid = document.createElement('div'); grid.className = 'grid-2';
    grid.append(
      numberField('Falvastagság', thickness(), value => { room().wallThickness = clamp(value, 4, 60); commit('Falvastagság'); requestRender(); }, { step: 1 }),
      numberField('Belmagasság', room().wallHeight, value => { room().wallHeight = clamp(value, 180, 600); commit('Belmagasság'); requestRender(); }, { step: 1 })
    );
    thicknessSection.append(grid);
    thicknessSection.innerHTML += '<p class="note">A falvastagság és a belmagasság becsült, csak a megjelenítést befolyásolja: a belső méretek nem változnak.</p>';
    node.append(thicknessSection);
  }

  function invalidateAdjacent(geom, index) {
    const n = geom.vertices.length;
    geom.confirmedWalls[(index - 1 + n) % n] = false;
    geom.confirmedWalls[index] = false;
  }

  function wallEditor(geom, index) {
    const s = section(`${index + 1}. fal`);
    const a = geom.vertices[index]; const b = geom.vertices[(index + 1) % geom.vertices.length];
    const length = Geometry.distance(a, b);
    const label = geom.wallLabels?.[index];
    const confirmed = Boolean(geom.confirmedWalls?.[index]);
    s.append(numberField('Hossz', length, value => setWallLength(index, value, true), { step: 0.5 }));
    const status = document.createElement('p');
    status.className = `note${confirmed ? '' : ' warning'}`;
    status.textContent = confirmed ? 'Megerősített, pontos méret.' : 'Becsült hossz (≈). Írd be a helyszínen mért értéket, vagy erősítsd meg.';
    s.append(status);
    if (label) {
      const info = document.createElement('p');
      info.className = 'note';
      info.innerHTML = `${geom.source === 'plan' ? 'A tervrajzon szereplő méret' : 'A rajzon szereplő méret'}: <strong>${fmt(label)} cm</strong>${geom.wallNotes?.[index] ? ` · ${escapeHtml(geom.wallNotes[index])}` : ''}`;
      s.append(info);
      const apply = document.createElement('button');
      apply.className = 'button small';
      apply.innerHTML = `${icon('check')}${geom.source === 'plan' ? 'Terv' : 'Rajz'} szerinti ${fmt(label)} cm alkalmazása`;
      apply.hidden = Math.abs(label - length) < 0.5;
      apply.onclick = () => setWallLength(index, label, true);
      s.append(apply);
    } else if (geom.wallNotes?.[index]) {
      const info = document.createElement('p'); info.className = 'note'; info.textContent = geom.wallNotes[index]; s.append(info);
    }
    const measured = geom.wallMeasured?.[index];
    if (measured && Math.abs(measured - length) > 0.5) {
      const apply = document.createElement('button');
      apply.className = 'button small ghost';
      apply.innerHTML = `${icon('measure')}Kézi mérés szerinti ${fmt(measured)} cm alkalmazása`;
      apply.onclick = () => setWallLength(index, measured, true);
      s.append(apply);
    }
    const row = document.createElement('div');
    row.className = 'button-row';
    const toggle = document.createElement('button');
    toggle.className = 'button small ghost';
    toggle.innerHTML = `${icon(confirmed ? 'close' : 'check')}${confirmed ? 'Megerősítés visszavonása' : 'Jelenlegi hossz megerősítése'}`;
    toggle.onclick = () => { geom.confirmedWalls[index] = !confirmed; commit('Megerősítés'); renderInspector(); renderRoomPanel(); requestRender(); };
    const split = document.createElement('button');
    split.className = 'button small ghost';
    split.innerHTML = `${icon('plus')}Fal felosztása`;
    split.onclick = () => splitWall(index);
    row.append(toggle, split);
    s.append(row);
    return s;
  }

  function renderObjectInspector(node, geom, object) {
    const names = { door: 'Ajtó', window: 'Ablak', radiator: 'Radiátor', opening: 'Nyílás' };
    const s = section(names[object.type], object.estimated ? '<span class="badge estimated">becsült</span>' : '');
    const frame = Geometry.wallFrame(geom.vertices, object.wallIndex, 0);
    const wallLength = frame?.length || 0;
    const apply = (key, value) => {
      object[key] = value;
      object.estimated = false;
      if (key === 'width') { object.fullWall = false; object.width = Math.min(value, wallLength); }
      if (!object.fullWall) object.offset = clamp(object.offset, object.width / 2, Math.max(object.width / 2, wallLength - object.width / 2));
      commit('Nyílászáró'); renderInspector(); requestRender();
    };
    const grid = document.createElement('div'); grid.className = 'grid-2';
    grid.append(
      numberField('Szélesség', object.fullWall ? wallLength : object.width, value => apply('width', value), { step: 0.5 }),
      numberField('Közép a fal elejétől', object.fullWall ? wallLength / 2 : object.offset, value => apply('offset', value), { step: 0.5, disabled: object.fullWall })
    );
    s.append(grid);
    if (object.type === 'door') {
      const sel = (label, key, options) => {
        const box = document.createElement('div'); box.className = 'field';
        box.innerHTML = `<label>${label}</label><select>${options.map(([v, t]) => `<option value="${v}"${object[key] === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
        box.querySelector('select').onchange = event => apply(key, event.target.value);
        return box;
      };
      const g2 = document.createElement('div'); g2.className = 'grid-2';
      g2.append(sel('Zsanér', 'hinge', [['start', 'Fal eleje'], ['end', 'Fal vége']]), sel('Nyílásirány', 'swing', [['in', 'Befelé'], ['out', 'Kifelé']]));
      s.append(g2);
    }
    if (object.type === 'window') {
      const g2 = document.createElement('div'); g2.className = 'grid-2';
      g2.append(numberField('Parapet', object.sill ?? 85, value => apply('sill', value), { step: 1 }), numberField('Ablakmagasság', object.height ?? 140, value => apply('height', value), { step: 1 }));
      s.append(g2);
    }
    if (object.type === 'radiator') {
      const g2 = document.createElement('div'); g2.className = 'grid-2';
      g2.append(numberField('Mélység', object.depth ?? 10, value => apply('depth', value)), numberField('Magasság', object.height ?? 60, value => apply('height', value)));
      s.append(g2);
    }
    if (object.estimated) {
      const note = document.createElement('p'); note.className = 'note warning';
      note.textContent = 'A rajzról becsült elem. Mérd le a helyszínen és írd be a pontos értékeket.';
      s.append(note);
    }
    const del = document.createElement('button');
    del.className = 'button small danger';
    del.innerHTML = `${icon('trash')}${names[object.type]} törlése`;
    del.onclick = () => { geom.objects = geom.objects.filter(value => value.id !== object.id); ui.selectedObjectId = null; commit('Nyílászáró törlése'); renderInspector(); requestRender(); };
    s.append(del);
    node.append(s);
  }

  // ------------------------------------------------------------------ catalogue
  function productByKey(key) {
    return Catalog.all.find(value => value.key === key) || favorites.map(favoriteProduct).find(value => value.key === key);
  }

  function favoriteProduct(fav) {
    const known = Catalog.ikea.find(value => value.productId === fav.productId);
    if (known) return known;
    return { ...fav, key: `fav-${fav.productId}`, model: fav.model || Catalog.ikeaModel(fav), source: 'ikea', category: ({ sofas: 'sofas', wardrobes: 'wardrobes', beds: 'beds', tables: 'tables', chairs: 'chairs', storage: 'storage' })[fav.category] || 'storage', materials: {}, dimensionStatus: 'verified', layer: 'main' };
  }

  function isFavorite(productId) { return favorites.some(value => value.productId === productId); }

  function productFromItem(item) {
    return { name: item.name, productId: item.productId, category: item.category || 'storage', type: item.type, width: item.originalDimensions?.width || item.w, depth: item.originalDimensions?.depth || item.h, height: item.originalDimensions?.height, productUrl: item.productUrl, model: item.model };
  }

  function toggleFavorite(product) {
    try {
      const normalized = Core.normalizeProduct(product);
      favorites = isFavorite(normalized.productId) ? favorites.filter(value => value.productId !== normalized.productId) : [...favorites, normalized];
      favorites = Core.saveFavorites(localStorage, favorites);
      renderCatalog();
      if (selectedItem()) renderInspector();
      toast(isFavorite(normalized.productId) ? 'Hozzáadva a kedvencekhez' : 'Eltávolítva a kedvencekből');
    } catch (error) { toast(error.message || 'A kedvencek mentése nem sikerült.'); }
  }

  function renderCategoryChips() {
    const container = $('categoryChips');
    container.innerHTML = '';
    const entries = [['all', 'Mind'], ...Object.entries(Catalog.categories)];
    for (const [key, label] of entries) {
      const chip = document.createElement('button');
      chip.className = `chip${ui.catalogCategory === key ? ' selected' : ''}`;
      chip.textContent = label;
      chip.dataset.category = key;
      chip.onclick = () => { ui.catalogCategory = key; renderCategoryChips(); renderCatalog(); };
      container.append(chip);
    }
  }

  function renderCatalog() {
    const query = $('catalogSearch').value.toLocaleLowerCase('hu').trim();
    let source = ui.catalogSource === 'ikea' ? Catalog.ikea : ui.catalogSource === 'generic' ? Catalog.generic : ui.catalogSource === 'favorites' ? favorites.map(favoriteProduct) : Catalog.all;
    source = source.filter(product => {
      const haystack = `${product.name} ${product.productId || ''} ${Catalog.categories[product.category] || ''}`.toLocaleLowerCase('hu');
      return haystack.includes(query) && (ui.catalogCategory === 'all' || product.category === ui.catalogCategory);
    });
    const container = $('catalog');
    container.innerHTML = '';
    for (const product of source) {
      const card = document.createElement('button');
      card.className = 'catalog-card';
      card.draggable = true;
      card.dataset.key = product.key;
      card.title = `${product.name}\n${fmt(product.width)} × ${fmt(product.depth)} × ${fmt(product.height || 0)} cm${product.source === 'ikea' ? '\nEllenőrzött termékméret' : '\nTipikus tervezési méret'}`;
      card.innerHTML = `<div class="thumb"><img alt="" loading="lazy"></div><div class="meta"><strong></strong><small></small></div>${product.source === 'ikea' ? '<span class="badge ikea">IKEA</span>' : ''}`;
      card.querySelector('img').src = Art.thumbnail(product, 120);
      card.querySelector('strong').textContent = product.name;
      card.querySelector('small').textContent = `${fmt(product.width)} × ${fmt(product.depth)} cm${product.productId ? ` · ${product.productId}` : ''}`;
      card.onclick = () => addProduct(product);
      card.addEventListener('dragstart', event => {
        event.dataTransfer.setData('text/zuglak-product', product.key);
        event.dataTransfer.effectAllowed = 'copy';
        if (ui.view !== '2d') setView('2d');
      });
      card.addEventListener('dragend', () => { $('dropHint').hidden = true; });
      if (product.source === 'ikea') {
        const fav = document.createElement('span');
        fav.className = `favorite-button${isFavorite(product.productId) ? ' active' : ''}`;
        fav.setAttribute('role', 'button');
        fav.title = isFavorite(product.productId) ? 'Eltávolítás a kedvencekből' : 'Mentés a kedvencekhez';
        fav.innerHTML = icon('heart');
        fav.onclick = event => { event.stopPropagation(); toggleFavorite(product); };
        card.append(fav);
      }
      container.append(card);
    }
    $('catalogCount').textContent = `${source.length} elem`;
    $('favoriteCount').textContent = favorites.length;
    $('catalogEmpty').hidden = source.length > 0;
    document.querySelectorAll('#sourceFilter button').forEach(button => button.classList.toggle('selected', button.dataset.source === ui.catalogSource));
    $('catalogNote').textContent = `IKEA: termékoldal szerinti külső méretek (ellenőrizve ${Catalog.ikeaVerifiedAt}). Általános: tipikus tervezési méretek, nem termékadat.`;
  }

  // ------------------------------------------------------------------ materials panel
  function renderMaterialsPanel() {
    const fill = (containerId, list, current, onPick) => {
      const container = $(containerId);
      container.innerHTML = '';
      for (const material of list) {
        const swatch = makeSwatch(material, current === material.id, () => onPick(material.id));
        container.append(swatch);
      }
    };
    fill('floorSwatches', Materials.inGroup('floor'), roomMaterials().floor, id => setRoomMaterial('floor', id));
    fill('wallSwatches', Materials.inGroup('wall'), roomMaterials().walls, id => setRoomMaterial('walls', id));
    const kitchen = items().filter(item => Catalog.categories[item.category] && item.category === 'kitchen' || /^kitchen|island/.test(Catalog.modelFor(item)));
    const kitchenFront = kitchen[0]?.materials?.primary;
    const worktop = kitchen.find(item => Catalog.modelFor(item) !== 'kitchen-tall' && Catalog.modelFor(item) !== 'fridge')?.materials?.secondary;
    const applyKitchen = (slot, id) => {
      const targets = kitchen.filter(item => slot === 'primary' ? Catalog.modelFor(item) !== 'fridge' : !['kitchen-tall', 'fridge'].includes(Catalog.modelFor(item)));
      if (!targets.length) { toast('Ebben a változatban még nincs konyhai elem.'); return; }
      targets.forEach(item => { item.materials = { ...(item.materials || {}), [slot]: id }; });
      commit('Konyha anyag'); renderMaterialsPanel(); renderInspector(); requestRender();
      toast(`${targets.length} konyhai elem frissítve`);
    };
    fill('kitchenFrontSwatches', Materials.inGroup('wood'), kitchenFront, id => applyKitchen('primary', id));
    fill('worktopSwatches', [...Materials.inGroup('stone'), Materials.get('wood-oak-natural'), Materials.get('wood-walnut')], worktop, id => applyKitchen('secondary', id));
    renderMaterialsSelection();
  }

  function renderMaterialsSelection() {
    const container = $('materialsSelection');
    if (!container) return;
    container.innerHTML = '';
    const item = selectedItem();
    $('materialsSelectionHint').hidden = Boolean(item);
    if (item) {
      const title = document.createElement('p');
      title.className = 'fineprint';
      title.innerHTML = `<strong>${escapeHtml(item.name)}</strong>`;
      container.append(title);
      renderSlotEditor(container, item, true);
    }
  }

  // ------------------------------------------------------------------ variants panel
  const thumbCache = new Map();
  function invalidateThumbs() { thumbCache.clear(); }

  function renderMiniPlan(canvasNode, roomId, variantName, options = {}) {
    const roomData = data.rooms[roomId];
    const variantData = roomData.variants[variantName];
    const geom = (roomData.geometries || []).find(value => value.id === roomData.activeGeometryId) || null;
    const width = options.width || canvasNode.clientWidth || 160;
    const height = options.height || canvasNode.clientHeight || 120;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvasNode.width = width * dpr; canvasNode.height = height * dpr;
    const ctx = canvasNode.getContext('2d', options.cpu ? { willReadFrequently: true } : undefined);
    const outer = geom?.closed ? Geometry.offsetPolygonOutward(geom.vertices, Number(roomData.wallThickness) || 12) : geom?.vertices;
    const b = outer?.length ? Geometry.polygonBounds(outer) : { minX: 0, minY: 0, maxX: 400, maxY: 400 };
    const pad = options.pad ?? 8;
    const z = Math.min((width - pad * 2) / (b.maxX - b.minX), (height - pad * 2) / (b.maxY - b.minY));
    const T = { z, x: width / 2 - (b.minX + b.maxX) / 2 * z, y: height / 2 - (b.minY + b.maxY) / 2 * z, dpr, width, height };
    drawPlan(ctx, T, { room: roomData, variant: variantData, geometry: geom, roomId, dims: false, labels: false, grid: false, underlay: false, background: options.background || '#ffffff', interactive: false, darkWalls: false });
  }

  function renderVariantsPanel() {
    const list = $('variantList');
    list.innerHTML = '';
    const names = Object.keys(room().variants);
    for (const name of names) {
      const v = room().variants[name];
      const card = document.createElement('div');
      card.className = `variant-card${name === room().active ? ' active' : ''}`;
      card.innerHTML = `<canvas></canvas><button class="info" style="all:unset;cursor:pointer;display:grid;min-width:0"><strong></strong><small></small></button><div class="actions"></div>`;
      card.querySelector('strong').textContent = name;
      card.querySelector('small').textContent = `${v.items.length} bútor · ${Materials.get(v.materials?.floor).name}`;
      card.querySelector('.info').onclick = () => switchVariant(name);
      card.querySelector('canvas').onclick = () => switchVariant(name);
      const actions = card.querySelector('.actions');
      const button = (iconName, title, handler) => {
        const b = document.createElement('button');
        b.className = 'icon-button'; b.title = title; b.innerHTML = icon(iconName); b.onclick = handler; actions.append(b);
      };
      button('edit', 'Átnevezés', () => renameVariantPrompt(name));
      button('copy', 'Másolat', () => duplicateVariant(name));
      if (names.length > 1) button('trash', 'Törlés', () => deleteVariantPrompt(name));
      list.append(card);
      requestAnimationFrame(() => renderMiniPlan(card.querySelector('canvas'), ui.roomId, name, { width: 76, height: 58, pad: 4 }));
    }
    $('versionTarget').textContent = `· ${room().active}`;
    const versions = [...(variant().versions || [])].reverse();
    const versionList = $('versionList');
    versionList.innerHTML = versions.length ? '' : '<p class="fineprint">Még nincs mentett pillanatkép. A pillanatkép a változat aktuális bútorozását és anyagait rögzíti.</p>';
    for (const version of versions) {
      const row = document.createElement('div');
      row.className = 'version-row';
      row.innerHTML = `<div><strong></strong><small>${dateLabel(version.savedAt)} · ${version.items.length} bútor</small></div>`;
      row.querySelector('strong').textContent = version.label;
      const restoreButton = document.createElement('button');
      restoreButton.className = 'button small'; restoreButton.textContent = 'Visszaállítás';
      restoreButton.onclick = async () => {
        if (!await confirmAction('Verzió visszaállítása', `A(z) „${room().active}” változat jelenlegi állapotát a(z) „${version.label}” pillanatkép váltja fel. Visszavonással (Ctrl+Z) bármikor visszaléphetsz.`, 'Visszaállítás')) return;
        Core.restoreVersion(room(), room().active, version.id);
        ui.selectedId = null;
        commit('Verzió visszaállítása');
        refreshAll();
        toast('Pillanatkép visszaállítva');
      };
      const del = document.createElement('button');
      del.className = 'icon-button'; del.title = 'Törlés'; del.innerHTML = icon('trash');
      del.onclick = () => { variant().versions = variant().versions.filter(value => value.id !== version.id); commit('Verzió törlése'); renderVariantsPanel(); };
      row.append(restoreButton, del);
      versionList.append(row);
    }
  }

  function switchVariant(name) {
    if (!room().variants[name]) return;
    room().active = name;
    ui.selectedId = null;
    commit('Változatváltás');
    refreshAll();
    toast(`Aktív változat: ${name}`);
  }

  async function renameVariantPrompt(name) {
    const answer = await ask('Változat átnevezése', '', [{ key: 'name', label: 'Név', value: name }]);
    if (!answer) return;
    try { Core.renameVariant(room(), name, answer.name); commit('Változat átnevezése'); refreshAll(); } catch (error) { toast(error.message); }
  }

  function duplicateVariant(name = room().active) {
    const created = Core.createVariant(room(), `${name} – másolat`, { from: name, idFactory });
    ui.selectedId = null;
    commit('Változat másolása');
    refreshAll();
    toast(`Új változat: ${created}`);
  }

  async function newVariant() {
    const answer = await ask('Új, üres változat', 'Ugyanaz a helyiség, bútorok nélkül. A padló és a falszín az aktív változatból öröklődik.', [{ key: 'name', label: 'Név', value: `Elrendezés ${String.fromCharCode(65 + Object.keys(room().variants).length)}` }]);
    if (!answer?.name?.trim()) return;
    Core.createVariant(room(), answer.name, { now: Date.now() });
    ui.selectedId = null;
    commit('Új változat');
    refreshAll();
  }

  async function deleteVariantPrompt(name) {
    if (!await confirmAction('Változat törlése', `Biztosan törlöd a(z) „${name}” változatot? Visszavonással (Ctrl+Z) visszahozható.`, 'Törlés')) return;
    try { Core.deleteVariant(room(), name); ui.selectedId = null; commit('Változat törlése'); refreshAll(); } catch (error) { toast(error.message); }
  }

  async function saveVersionPrompt() {
    const answer = await ask('Pillanatkép mentése', `A(z) „${room().active}” változat jelenlegi állapota.`, [{ key: 'label', label: 'Megnevezés', value: `${room().active} – ${new Date().toLocaleDateString('hu-HU')}` }]);
    if (!answer) return;
    Core.saveVersion(room(), room().active, answer.label, Date.now(), idFactory);
    commit('Pillanatkép');
    renderVariantsPanel();
    toast('Pillanatkép elmentve');
  }

  function openCompare() {
    const names = Object.keys(room().variants);
    const selects = [$('compareA'), $('compareB')];
    selects.forEach((select, index) => {
      select.className = 'plain';
      select.innerHTML = names.map(name => `<option>${escapeHtml(name)}</option>`).join('');
      select.value = names[index === 0 ? names.indexOf(room().active) : (names.indexOf(room().active) + 1) % names.length] || names[0];
      select.onchange = drawCompare;
    });
    $('compareDialog').showModal();
    requestAnimationFrame(drawCompare);
  }

  function drawCompare() {
    const a = $('compareA').value; const b = $('compareB').value;
    renderMiniPlan($('compareCanvasA'), ui.roomId, a, { width: $('compareCanvasA').clientWidth, height: $('compareCanvasA').clientHeight, pad: 16 });
    renderMiniPlan($('compareCanvasB'), ui.roomId, b, { width: $('compareCanvasB').clientWidth, height: $('compareCanvasB').clientHeight, pad: 16 });
    const diff = Core.compareVariants(room().variants[a], room().variants[b]);
    const list = (only, node) => {
      const common = diff.common.map(name => `<li>${escapeHtml(name)}</li>`).join('');
      node.innerHTML = only.map(name => `<li class="only">${escapeHtml(name)} – csak itt</li>`).join('') + common;
    };
    list(diff.onlyA, $('compareListA'));
    list(diff.onlyB, $('compareListB'));
  }

  // ------------------------------------------------------------------ room panel
  function renderRoomPanel() {
    const container = $('roomPanel');
    container.innerHTML = '';
    const plan = planFor(ui.roomId);
    const geom = geometry();
    const nameRow = document.createElement('div');
    nameRow.className = 'field';
    nameRow.innerHTML = '<label>Helyiség neve</label><input>';
    const nameInput = nameRow.querySelector('input');
    nameInput.value = room().name;
    nameInput.onchange = () => { if (nameInput.value.trim()) { room().name = nameInput.value.trim(); commit('Átnevezés'); renderTopbar(); renderRoomMenu(); } };
    container.append(nameRow);

    if (geometries().length > 1) {
      const selectBox = document.createElement('div');
      selectBox.className = 'field';
      selectBox.innerHTML = `<label>Aktív falgeometria</label><select>${geometries().map(g => `<option value="${g.id}"${g.id === room().activeGeometryId ? ' selected' : ''}>${escapeHtml(g.name)}${g.closed ? '' : ' (nyitott)'}</option>`).join('')}</select>`;
      selectBox.querySelector('select').onchange = event => { room().activeGeometryId = event.target.value; commit('Geometria váltás'); fitView(); refreshAll(); };
      container.append(selectBox);
    }

    const editRow = document.createElement('div');
    editRow.className = 'button-row';
    if (ui.mode === 'furnish') {
      const edit = document.createElement('button');
      edit.className = 'button wide';
      edit.id = 'editArchitecture';
      edit.innerHTML = `${icon('lock-open')}Szerkezet szerkesztése`;
      edit.onclick = async () => {
        if (!await confirmAction('Szerkezet szerkesztése', 'A falak, ajtók és ablakok alapesetben védettek a véletlen módosítás ellen. Szerkesztés közben minden változás visszavonható.', 'Szerkesztés')) return;
        startArchitecture('walls');
      };
      editRow.append(edit);
    } else {
      const done = document.createElement('button');
      done.className = 'button primary wide';
      done.innerHTML = `${icon('lock')}Szerkesztés befejezése`;
      done.onclick = finishArchitecture;
      editRow.append(done);
    }
    container.append(editRow);

    if ((geom?.source === 'traced' || geom?.source === 'plan') && plan.review?.length) {
      const review = document.createElement('div');
      review.className = 'review-box';
      review.innerHTML = geom.source === 'plan'
        ? `<strong>Építészeti tervrajz alapján</strong><span>A tervrajzon feliratozott falak megerősítettek; a többi a tervről lett lemérve (≈). A „mért” érték a kézi felmérésed.</span><ul>${plan.review.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`
        : `<strong>A rajz méretei ellentmondásosak</strong><span>Az alaprajz a rajzról lett átvéve, egységes léptékkel. Minden fal becsült (≈), amíg nem erősíted meg.</span><ul>${plan.review.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`;
      container.append(review);
    }

    if (geom && geom.vertices.length >= 2) {
      const count = geom.closed ? geom.vertices.length : geom.vertices.length - 1;
      const confirmed = geom.confirmedWalls.filter(Boolean).length;
      const h = document.createElement('h3');
      h.innerHTML = `Falak <small>${confirmed} / ${count} megerősítve</small>`;
      container.append(h);
      const table = document.createElement('div');
      table.className = 'wall-table';
      for (let index = 0; index < count; index += 1) {
        const a = geom.vertices[index]; const b = geom.vertices[(index + 1) % geom.vertices.length];
        const length = Geometry.distance(a, b);
        const isConfirmed = Boolean(geom.confirmedWalls[index]);
        const label = geom.wallLabels?.[index];
        const open = (geom.objects || []).some(object => object.wallIndex === index && object.fullWall);
        const row = document.createElement('div');
        row.className = `wall-row${ui.selectedWall === index ? ' highlight' : ''}`;
        row.innerHTML = `<span class="idx">${index + 1}</span><span class="desc"><strong>${isConfirmed ? '' : '≈ '}${fmt(length)} cm</strong><span class="${isConfirmed ? 'confirmed' : 'estimated'}">${isConfirmed ? 'megerősítve' : 'becsült'}${label ? ` · ${geom.source === 'plan' ? 'terv' : 'rajz'}: ${fmt(label)}` : ''}${geom.wallMeasured?.[index] ? ` · mért: ${fmt(geom.wallMeasured[index])}` : ''}${open ? ' · nyílás' : ''}</span></span>`;
        if (ui.mode !== 'furnish') {
          const input = document.createElement('input');
          input.type = 'number'; input.step = '0.5'; input.value = Math.round(length * 10) / 10;
          input.className = 'plain';
          input.onchange = () => setWallLength(index, Number(input.value), true);
          row.append(input);
          if (label && Math.abs(label - length) > 0.5) {
            const apply = document.createElement('button');
            apply.className = 'button small ghost apply';
            apply.textContent = `Rajz szerinti ${fmt(label)} cm`;
            apply.onclick = () => setWallLength(index, label, true);
            row.append(apply);
          }
        }
        row.onclick = event => {
          if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON') return;
          ui.selectedWall = index; ui.selectedVertex = null;
          if (ui.mode === 'furnish') toast('A falhossz módosításához kattints a „Szerkezet szerkesztése” gombra.');
          renderRoomPanel(); renderInspector(); requestRender();
        };
        table.append(row);
      }
      container.append(table);
    }

    const display = document.createElement('h3');
    display.textContent = 'Megjelenítés (becsült értékek)';
    container.append(display);
    const grid = document.createElement('div');
    grid.className = 'grid-2';
    grid.append(
      numberField('Falvastagság', thickness(), value => { room().wallThickness = clamp(value, 4, 60); commit('Falvastagság'); requestRender(); }),
      numberField('Belmagasság', room().wallHeight || Core.DEFAULT_WALL_HEIGHT, value => { room().wallHeight = clamp(value, 180, 600); commit('Belmagasság'); requestRender(); })
    );
    container.append(grid);
    const note = document.createElement('p');
    note.className = 'fineprint';
    note.textContent = 'A falvastagság kifelé rajzolódik, így a belső, bútorozható méretek nem változnak. A belmagasság csak a 3D nézetet befolyásolja.';
    container.append(note);

    const underlay = document.createElement('h3');
    underlay.textContent = 'Eredeti rajz';
    container.append(underlay);
    const underRow = document.createElement('div');
    underRow.className = 'button-row';
    const toggle = document.createElement('button');
    toggle.className = 'button small';
    toggle.innerHTML = `${icon('eye')}${layer('showUnderlay') ? 'Rajz elrejtése' : 'Rajz megjelenítése'}`;
    toggle.onclick = () => { $('showUnderlay').checked = !layer('showUnderlay'); savePrefs(); renderRoomPanel(); requestRender(); };
    const calibrate = document.createElement('button');
    calibrate.className = 'button small ghost';
    calibrate.innerHTML = `${icon('measure')}Rajz igazítása`;
    calibrate.onclick = () => { $('showUnderlay').checked = true; startArchitecture('calibrate'); };
    underRow.append(toggle, calibrate);
    container.append(underRow);
    const note2 = document.createElement('p');
    note2.className = 'fineprint';
    note2.textContent = `Jelenlegi skála: 1 cm = ${fmt(room().pxPerCm || 0, 3)} px. A rajz nem egységesen méretarányos, ezért csak tájékoztató háttér.`;
    container.append(note2);

    if (ui.mode === 'furnish' || ui.mode === 'walls') {
      const drawNew = document.createElement('button');
      drawNew.className = 'button small ghost';
      drawNew.innerHTML = `${icon('plus')}Új geometria rajzolása`;
      drawNew.onclick = async () => {
        if (!await confirmAction('Új geometria', 'Egy új, saját falgeometriát rajzolhatsz. A meglévő geometria megmarad és később visszaválasztható.', 'Rajzolás')) return;
        const g = { id: idFactory(), name: `Saját geometria ${geometries().length + 1}`, source: 'user', vertices: [], closed: false, confirmedWalls: [], objects: [], partitions: [], wallLabels: [], wallNotes: [] };
        geometries().push(g); room().activeGeometryId = g.id;
        commit('Új geometria');
        startArchitecture('draw');
      };
      container.append(drawNew);
    }
  }

  // ------------------------------------------------------------------ topbar & menus
  const roomThumbs = new Map();
  function roomThumb(id) {
    const key = `${id}|${data.rooms[id].activeGeometryId}`;
    if (roomThumbs.has(key)) return roomThumbs.get(key);
    const c = document.createElement('canvas');
    renderMiniPlan(c, id, data.rooms[id].active, { width: 80, height: 80, pad: 6, background: '#f6f2eb', cpu: true });
    const url = c.toDataURL();
    roomThumbs.set(key, url);
    return url;
  }

  function renderTopbar() {
    $('roomName').textContent = room().name;
    $('variantName').textContent = room().active;
    $('roomThumb').src = roomThumb(ui.roomId);
    $('presentationRoom').textContent = room().name;
    $('presentationVariant').textContent = `${room().active} · ${new Date().toLocaleDateString('hu-HU')}`;
  }

  function renderRoomMenu() {
    const menu = $('roomMenu');
    menu.innerHTML = '';
    for (const plan of allPlans()) {
      const roomData = data.rooms[plan.id];
      if (!roomData) continue;
      const geom = (roomData.geometries || []).find(value => value.id === roomData.activeGeometryId);
      const area = geom?.closed ? `${fmt(Geometry.polygonArea(geom.vertices) / 10000, 1)} m²` : 'geometria nélkül';
      const button = document.createElement('button');
      button.className = `menu-item${plan.id === ui.roomId ? ' active' : ''}`;
      button.innerHTML = `<img alt=""><span><strong></strong><small>${Object.keys(roomData.variants).length} változat · ${area}${plan.isCustom ? ' · saját feltöltés' : ''}</small></span>`;
      button.querySelector('img').src = roomThumb(plan.id);
      button.querySelector('strong').textContent = roomData.name;
      button.onclick = () => { closeMenus(); openRoom(plan.id); };
      menu.append(button);
    }
  }

  function renderVariantMenu() {
    const menu = $('variantMenu');
    menu.innerHTML = '';
    for (const name of Object.keys(room().variants)) {
      const v = room().variants[name];
      const button = document.createElement('button');
      button.className = `menu-item${name === room().active ? ' active' : ''}`;
      button.innerHTML = `<span><strong></strong><small>${v.items.length} bútor · ${escapeHtml(Materials.get(v.materials?.floor).name)}</small></span>`;
      button.querySelector('strong').textContent = name;
      button.onclick = () => { closeMenus(); switchVariant(name); };
      menu.append(button);
    }
    menu.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>');
    const dup = document.createElement('button');
    dup.className = 'menu-item';
    dup.innerHTML = `${icon('copy')}<span><strong>Változat másolása</strong><small>Az aktuális elrendezésből</small></span>`;
    dup.onclick = () => { closeMenus(); duplicateVariant(); };
    const manage = document.createElement('button');
    manage.className = 'menu-item';
    manage.innerHTML = `${icon('layers')}<span><strong>Változatok kezelése…</strong><small>Átnevezés, verziók, összevetés</small></span>`;
    manage.onclick = () => { closeMenus(); setLeftTab('variants'); };
    menu.append(dup, manage);
  }

  function closeMenus() {
    document.querySelectorAll('.menu').forEach(menu => { menu.hidden = true; });
    document.querySelectorAll('[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }

  function bindDropdown(buttonId, menuId, onOpen) {
    const button = $(buttonId); const menu = $(menuId);
    button.addEventListener('click', event => {
      event.stopPropagation();
      const open = menu.hidden;
      closeMenus();
      if (open) { onOpen?.(); menu.hidden = false; button.setAttribute('aria-expanded', 'true'); }
    });
    menu.addEventListener('click', event => event.stopPropagation());
  }

  function openRoom(id) {
    if (!data.rooms[id]) return;
    if (ui.mode !== 'furnish') finishArchitecture();
    ui.roomId = id;
    ui.selectedId = null; ui.measure = null;
    data.currentRoom = id;
    commit('Helyiségváltás');
    fitView();
    refreshAll();
    if (view3d) view3d.resetCamera();
  }

  function setLeftTab(tab) {
    ui.leftTab = tab;
    document.querySelectorAll('.rail button').forEach(button => button.classList.toggle('selected', button.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.dataset.panel !== tab; });
    document.body.classList.toggle('panel-open', window.matchMedia('(max-width: 860px)').matches);
    if (tab === 'variants') renderVariantsPanel();
    if (tab === 'materials') renderMaterialsPanel();
    if (tab === 'room') renderRoomPanel();
    if (tab === 'ai') { renderAiPanel(); setTimeout(() => { if (aiKey) $('aiInput').focus(); }, 30); }
    savePrefs();
  }

  function setView(view) {
    ui.view = view === '3d' ? '3d' : '2d';
    document.querySelectorAll('#viewSwitch button').forEach(button => button.classList.toggle('selected', button.dataset.view === ui.view));
    $('view2d').hidden = ui.view !== '2d';
    $('view3d').hidden = ui.view !== '3d';
    $('toolbar2d').hidden = ui.view !== '2d';
    $('toolbar3d').hidden = ui.view !== '3d';
    $('statusbar').hidden = ui.view !== '2d';
    if (ui.view === '3d') {
      if (ui.mode !== 'furnish') finishArchitecture();
      ensure3D();
      view3d?.setVisible(true);
    } else {
      view3d?.setVisible(false);
      if (needsFit) requestAnimationFrame(fitView);
    }
    savePrefs();
    requestRender();
  }

  function refreshAll() {
    document.body.classList.toggle('has-selection', Boolean(ui.selectedId));
    renderTopbar();
    renderRoomMenu();
    renderVariantMenu();
    renderInspector();
    renderCatalog();
    if (ui.leftTab === 'variants') renderVariantsPanel();
    if (ui.leftTab === 'materials') renderMaterialsPanel();
    if (ui.leftTab === 'room') renderRoomPanel();
    if (ui.leftTab === 'ai') renderAiPanel();
    renderModeBanner();
    $('scaleInfo').textContent = 'Méretek centiméterben · ≈ becsült fal';
    requestRender();
  }

  // ------------------------------------------------------------------ presentation
  function setPresentation(on) {
    ui.presentation = Boolean(on);
    document.body.classList.toggle('presenting', ui.presentation);
    $('presentationCaption').hidden = !ui.presentation;
    $('exitPresentation').hidden = !ui.presentation;
    if (ui.presentation) { ui.selectedId = null; closeMenus(); renderTopbar(); }
    renderModeBanner();
    setTimeout(() => { if (ui.view === '2d') fitView(); else view3d?.resetCamera(); requestRender(); }, 60);
  }

  // ------------------------------------------------------------------ exports
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const safeName = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

  /** Renders the 2D presentation sheet (plan + title block + furniture list) to a canvas. */
  function renderSheet(options) {
    const paper = options.paper || 'a3';
    const aspect = paper === 'square' ? 1 : Math.SQRT2;
    const width = Math.round(options.width || 2400);
    const height = Math.round(width / aspect);
    const sheet = document.createElement('canvas');
    sheet.width = width; sheet.height = height;
    const ctx = sheet.getContext('2d');
    const unit = width / 1000; // layout unit
    const background = options.background === 'transparent' ? null : options.background || '#ffffff';
    const darkBg = background === '#2c2b29';
    const ink = darkBg ? '#f3efe8' : '#23211e';
    const muted = darkBg ? '#b9b1a5' : '#8a8378';
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
    const margin = 40 * unit;
    const sideW = options.labels || options.title ? 250 * unit : 0;
    const planArea = { x: margin, y: margin, w: width - margin * 2 - sideW - (sideW ? margin * 0.6 : 0), h: height - margin * 2 };
    const geom = geometry();
    const outer = geom?.closed ? Geometry.offsetPolygonOutward(geom.vertices, thickness()) : geom?.vertices;
    const b = outer?.length ? Geometry.polygonBounds(outer) : roomBounds();
    const dimSpace = options.dims ? 46 : 10; // cm-ish reserve for dimension lines
    const z = Math.min(planArea.w / (b.maxX - b.minX + dimSpace * 2), planArea.h / (b.maxY - b.minY + dimSpace * 2));
    const T = { z, x: planArea.x + planArea.w / 2 - (b.minX + b.maxX) / 2 * z, y: planArea.y + planArea.h / 2 - (b.minY + b.maxY) / 2 * z, dpr: 1, width, height };
    const numbered = [...items()].filter(item => Catalog.layerFor(item) !== 'top' || options.labels);
    const numbers = new Map(numbered.map((item, index) => [item.id, index + 1]));
    ctx.save();
    // drawPlan paints its own background; limit it to nothing by passing null and then restoring our bg
    const off = document.createElement('canvas');
    off.width = width; off.height = height;
    const offCtx = off.getContext('2d');
    // Line widths in drawPlan are in screen px; scale them for print density.
    const print = { ...T, z: T.z, dpr: 1 };
    const pxScale = Math.max(1, unit * 0.9);
    // Render the plan at a virtual zoom so hairlines are pxScale wide.
    print.z = T.z / pxScale; print.x = T.x / pxScale; print.y = T.y / pxScale; print.dpr = pxScale;
    print.width = width / pxScale; print.height = height / pxScale;
    drawPlan(offCtx, print, { dims: options.dims, labels: options.labels, numbers: options.labels ? numbers : null, grid: false, underlay: false, background: null, interactive: false, drawingLabels: false, darkWalls: false });
    ctx.drawImage(off, 0, 0);
    ctx.restore();

    // Scale bar (1 m)
    if (options.title) {
      const barY = height - margin * 0.9;
      const barX = planArea.x;
      const meter = 100 * T.z;
      ctx.fillStyle = ink;
      for (let index = 0; index < 4; index += 1) {
        ctx.fillStyle = index % 2 ? (background || '#fff') : ink;
        ctx.fillRect(barX + index * meter / 2, barY, meter / 2, 5 * unit);
      }
      ctx.strokeStyle = ink; ctx.lineWidth = unit * 0.8; ctx.strokeRect(barX, barY, meter * 2, 5 * unit);
      ctx.fillStyle = muted; ctx.font = `500 ${9 * unit}px Inter, sans-serif`; ctx.textBaseline = 'top';
      ctx.fillText('0', barX, barY + 8 * unit); ctx.fillText('1 m', barX + meter - 6 * unit, barY + 8 * unit); ctx.fillText('2 m', barX + meter * 2 - 8 * unit, barY + 8 * unit);
    }

    // Side column
    if (sideW) {
      const x = width - margin - sideW;
      let y = margin;
      ctx.textBaseline = 'top';
      if (options.title) {
        ctx.fillStyle = muted; ctx.font = `650 ${9 * unit}px Inter, sans-serif`;
        ctx.fillText('ZUGLAK STUDIO · BERENDEZÉSI TERV', x, y); y += 18 * unit;
        ctx.fillStyle = ink; ctx.font = `700 ${22 * unit}px Inter, sans-serif`;
        y = wrapText(ctx, room().name, x, y, sideW, 26 * unit); y += 4 * unit;
        ctx.font = `500 ${13 * unit}px Inter, sans-serif`; ctx.fillStyle = darkBg ? '#e0d8cc' : '#57524a';
        ctx.fillText(room().active, x, y); y += 20 * unit;
        ctx.fillStyle = muted; ctx.font = `500 ${9.5 * unit}px Inter, sans-serif`;
        ctx.fillText(new Date().toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' }), x, y); y += 22 * unit;
        const area = geom?.closed ? `${fmt(Geometry.polygonArea(geom.vertices) / 10000, 2)} m²` : '–';
        const facts = [['Alapterület', area], ['Padló', Materials.get(roomMaterials().floor).name], ['Fal', Materials.get(roomMaterials().walls).name]];
        for (const [label, value] of facts) {
          ctx.fillStyle = muted; ctx.font = `600 ${8.5 * unit}px Inter, sans-serif`; ctx.fillText(label.toUpperCase(), x, y);
          ctx.fillStyle = ink; ctx.font = `560 ${11 * unit}px Inter, sans-serif`; ctx.fillText(value, x + 78 * unit, y - 1 * unit);
          y += 17 * unit;
        }
        y += 10 * unit;
        ctx.strokeStyle = darkBg ? '#4a4741' : '#e4ded5'; ctx.lineWidth = unit; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sideW, y); ctx.stroke();
        y += 14 * unit;
      }
      if (options.labels && numbered.length) {
        ctx.fillStyle = muted; ctx.font = `650 ${8.5 * unit}px Inter, sans-serif`; ctx.fillText('BÚTORLISTA', x, y); y += 16 * unit;
        const rowH = Math.min(17 * unit, (height - margin - y - 40 * unit) / numbered.length);
        const fontSize = Math.max(6.5, Math.min(10, rowH / unit * 0.62));
        for (const item of numbered) {
          const n = numbers.get(item.id);
          ctx.fillStyle = darkBg ? '#f3efe8' : '#23211e';
          ctx.beginPath(); ctx.arc(x + 7 * unit, y + rowH / 2 - 1 * unit, 7 * unit * Math.min(1, rowH / (17 * unit)), 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = darkBg ? '#23211e' : '#fff'; ctx.font = `700 ${fontSize * 0.85 * unit}px Inter, sans-serif`; ctx.textAlign = 'center';
          ctx.fillText(String(n), x + 7 * unit, y + rowH / 2 - fontSize * 0.5 * unit); ctx.textAlign = 'left';
          ctx.fillStyle = ink; ctx.font = `560 ${fontSize * unit}px Inter, sans-serif`;
          const name = item.name.length > 30 ? `${item.name.slice(0, 29)}…` : item.name;
          ctx.fillText(name, x + 20 * unit, y + rowH / 2 - fontSize * 0.55 * unit);
          ctx.fillStyle = muted; ctx.textAlign = 'right';
          ctx.fillText(`${fmt(item.w, 0)}×${fmt(item.h, 0)}${item.source === 'ikea' ? ' · IKEA' : ''}`, x + sideW, y + rowH / 2 - fontSize * 0.55 * unit);
          ctx.textAlign = 'left';
          y += rowH;
        }
        y += 10 * unit;
      }
      if (options.title) {
        ctx.fillStyle = muted; ctx.font = `500 ${8 * unit}px Inter, sans-serif`;
        const geomNote = geom && geom.confirmedWalls.some(value => !value) ? '≈ jelölt falhossz: a rajzról becsült, nem megerősített érték. ' : '';
        wrapText(ctx, `${geomNote}Méretek centiméterben. A bútorok IKEA esetén termékoldal szerinti, egyébként tipikus méretűek. Vásárlás és kivitelezés előtt mérd le a helyszínen.`, x, height - margin - 46 * unit, sideW, 11 * unit);
      }
    }
    return sheet;
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text).split(/\s+/);
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) { ctx.fillText(line, x, y); line = word; y += lineHeight; } else line = test;
    }
    if (line) { ctx.fillText(line, x, y); y += lineHeight; }
    return y;
  }

  function exportOptions() {
    return {
      kind: ui.exportKind,
      paper: $('exportPaper').value,
      quality: Number($('exportQuality').value),
      camera: $('exportCamera').value,
      background: $('exportBackground').value,
      dims: $('exportDims').checked,
      labels: $('exportLabels').checked,
      title: $('exportTitle').checked
    };
  }

  let previewTimer = null;
  function updateExportPreview() {
    const options = exportOptions();
    document.querySelectorAll('#exportForm [data-for]').forEach(node => { node.hidden = !node.dataset.for.split(' ').includes(options.kind); });
    document.querySelectorAll('#exportKind button').forEach(button => button.classList.toggle('selected', button.dataset.kind === options.kind));
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      if (options.kind === 'png3d') {
        const v = ensure3D();
        if (!v) { $('exportPreview').removeAttribute('src'); return; }
        sync3D();
        const blob = await v.capture({ width: 640, height: 420, camera: options.camera === 'current' ? undefined : options.camera, background: options.background });
        $('exportPreview').src = URL.createObjectURL(blob);
      } else {
        const sheet = renderSheet({ ...options, width: 900 });
        $('exportPreview').src = sheet.toDataURL('image/png');
      }
    }, 80);
  }

  async function runExport() {
    const options = exportOptions();
    const base = `zuglak-${safeName(room().name)}-${safeName(room().active)}`;
    const button = $('exportRun');
    button.disabled = true;
    try {
      if (options.kind === 'png3d') {
        const v = ensure3D();
        if (!v) throw new Error('A 3D nézet nem érhető el.');
        sync3D();
        const width = Math.min(4096, 1600 * options.quality);
        const height = Math.round(width * 0.66);
        const blob = await v.capture({ width, height, camera: options.camera === 'current' ? undefined : options.camera, background: options.background });
        download(`${base}-3d.png`, blob);
      } else {
        const width = { 1: 2400, 2: 3600, 3: 4960 }[options.quality] || 3600;
        const sheet = renderSheet({ ...options, width, background: options.kind === 'pdf2d' && options.background === 'transparent' ? '#ffffff' : options.background });
        if (options.kind === 'png2d') {
          const blob = await new Promise(resolve => sheet.toBlob(resolve, 'image/png'));
          download(`${base}.png`, blob);
        } else {
          const blob = await new Promise(resolve => sheet.toBlob(resolve, 'image/jpeg', 0.93));
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const pdf = Pdf.createImagePdf({ jpeg: bytes, paper: options.paper, title: `${room().name} – ${room().active}` });
          download(`${base}.pdf`, new Blob([pdf], { type: 'application/pdf' }));
        }
      }
      toast('Export elkészült');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Az export nem sikerült.');
    } finally {
      button.disabled = false;
    }
  }

  // ------------------------------------------------------------------ IKEA import (preserved from 1.x)
  let resolvedImport = null;
  const productTypeForCategory = category => ({ sofas: 'sofa', wardrobes: 'wardrobe', beds: 'bed', tables: 'table', chairs: 'chair', storage: 'shelf' })[category] || 'custom';
  function fillImportFields(product, locked = false) {
    $('ikeaName').value = product.name || '';
    $('ikeaProductId').value = product.productId || '';
    $('ikeaWidth').value = product.width || '';
    $('ikeaDepth').value = product.depth || '';
    $('ikeaHeight').value = product.height || '';
    $('ikeaCategory').value = product.ikeaCategory || product.category || 'storage';
    ['ikeaName', 'ikeaProductId', 'ikeaWidth', 'ikeaDepth', 'ikeaHeight'].forEach(id => { $(id).readOnly = locked; });
    $('ikeaCategory').disabled = locked;
  }
  function resolveIkeaUrl() {
    const parsed = Core.parseIkeaProductUrl($('ikeaUrl').value);
    resolvedImport = null;
    $('ikeaAiRow').hidden = true;
    $('ikeaManualFields').hidden = true;
    $('ikeaImportOk').disabled = true;
    $('ikeaSourceLink').hidden = true;
    if (!parsed.ok) { $('ikeaImportStatus').className = 'import-status error'; $('ikeaImportStatus').textContent = parsed.error; return; }
    $('ikeaUrl').value = parsed.productUrl;
    $('ikeaSourceLink').href = parsed.productUrl;
    $('ikeaSourceLink').hidden = false;
    const known = Catalog.ikea.find(product => product.productId === parsed.productId);
    if (known) {
      resolvedImport = known;
      fillImportFields(known, true);
      $('ikeaImportStatus').className = 'import-status success';
      $('ikeaImportStatus').textContent = `Felismert termék: ${known.name}. A méreteket a ${known.verifiedAt || Catalog.ikeaVerifiedAt} napján ellenőrzött helyi katalógusból töltöttük be.`;
    } else {
      fillImportFields({ name: parsed.suggestedName, productId: parsed.productId, category: 'storage' }, false);
      $('ikeaAiRow').hidden = false;
      $('ikeaAiRead').disabled = !aiKey;
      $('ikeaAiHint').textContent = aiKey ? 'Az AI megnyitja a termékoldalt, és kitölti a mezőket. Hozzáadás előtt ellenőrizd őket.' : 'Ha az AI fülön megadod az Anthropic API-kulcsot, a méreteket az AI is be tudja olvasni.';
      $('ikeaImportStatus').className = 'import-status warning';
      $('ikeaImportStatus').textContent = 'Ehhez a termékhez nincs ellenőrzött helyi adat. Nyisd meg a linket, és másold be a termékoldalon szereplő külső méreteket. Nem következtetünk hiányzó adatra.';
    }
    $('ikeaManualFields').hidden = false;
    $('ikeaImportOk').disabled = false;
  }
  function readImportForm() {
    if (resolvedImport) return resolvedImport;
    const category = $('ikeaCategory').value;
    const normalized = Core.normalizeProduct({
      name: $('ikeaName').value, productId: $('ikeaProductId').value, productUrl: $('ikeaUrl').value,
      width: $('ikeaWidth').value, depth: $('ikeaDepth').value, height: $('ikeaHeight').value,
      category, type: productTypeForCategory(category)
    });
    return { ...normalized, key: `fav-${normalized.productId}`, ikeaCategory: category, category: ({ sofas: 'sofas', wardrobes: 'wardrobes', beds: 'beds', tables: 'tables', chairs: 'chairs', storage: 'storage' })[category] || 'storage', model: Catalog.ikeaModel(normalized), source: 'ikea', materials: {} };
  }

  // ------------------------------------------------------------------ AI tervező (Anthropic Claude)
  const AI = window.ZuglakAI;
  let aiState = AI.loadState(localStorage);
  // Costs are never shown; remove any stored by earlier versions.
  Object.values(aiState.chats || {}).forEach(chat => { delete chat.totalCost; (chat.log || []).forEach(entry => { delete entry.cost; }); });
  let aiKey = AI.loadKey(localStorage);
  let aiAbort = null;
  let aiSettingsOpen = false;
  const aiChat = (roomId = ui.roomId) => aiState.chats[roomId] || (aiState.chats[roomId] = AI.emptyChat());
  const aiModelLabel = id => (AI.MODELS.find(value => value.id === id) || { label: id }).label.split(' – ')[0];

  function saveAi() {
    if (AI.saveState(localStorage, aiState)) return;
    // Storage full: drop the API history (not the visible log) of the other rooms, then retry.
    Object.entries(aiState.chats).forEach(([id, chat]) => { if (id !== ui.roomId) { chat.api = []; chat.pending = []; } });
    if (!AI.saveState(localStorage, aiState)) toast('A beszélgetés nem fért el a böngésző tárhelyén.');
  }

  function aiProducts() {
    const seen = new Set();
    return [...Catalog.all, ...favorites.map(favoriteProduct)].filter(product => !seen.has(product.key) && seen.add(product.key));
  }

  function aiFormat(text) {
    return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^#{1,4}\s*/gm, '');
  }

  function setAiStatus(text) { $('aiStatus').textContent = text || ''; }

  function renderAiSettings() {
    const open = aiSettingsOpen || !aiKey;
    $('aiSettings').hidden = !open;
    $('aiSettingsToggle').setAttribute('aria-expanded', String(open));
    $('aiKeyState').textContent = aiKey ? `Mentett kulcs: …${aiKey.slice(-4)}` : 'Nincs mentett kulcs';
    $('aiKeyClear').hidden = !aiKey;
    const select = $('aiModel');
    if (!select.options.length) AI.MODELS.forEach(model => { const option = document.createElement('option'); option.value = model.id; option.textContent = model.label; select.append(option); });
    select.value = aiState.model || AI.DEFAULT_MODEL;
  }

  function aiCardNode(card, roomId) {
    const node = document.createElement('div');
    node.className = 'ai-card';
    const exists = Boolean(data.rooms[roomId]?.variants[card.variant]);
    node.innerHTML = `<strong></strong><span class="fineprint"></span>${card.warnings.length ? '<span class="ai-warn"></span>' : ''}<div class="button-row"></div><details><summary>Bútorlista és indoklás</summary><ol></ol></details>`;
    node.querySelector('strong').textContent = `✓ ${card.created ? 'Új változat' : 'Módosítva'}: „${card.variant}” · ${card.count} bútor`;
    node.querySelector('.fineprint').textContent = exists
      ? 'Szerkeszthető: húzd, forgasd, töröld a bútorokat, vagy kérj módosítást. Visszavonás: Ctrl+Z.'
      : 'Ez a változat azóta törölve vagy átnevezve lett.';
    if (card.warnings.length) node.querySelector('.ai-warn').textContent = `Figyelem: ${card.warnings.join('; ')}.`;
    const open = document.createElement('button');
    open.type = 'button'; open.className = 'button small'; open.textContent = 'Megnyitás';
    open.disabled = !exists || (roomId === ui.roomId && room().active === card.variant);
    open.onclick = () => { if (roomId !== ui.roomId) openRoom(roomId); switchVariant(card.variant); };
    node.querySelector('.button-row').append(open);
    const list = node.querySelector('ol');
    card.items.forEach(value => {
      const li = document.createElement('li');
      li.textContent = value.name;
      if (value.reason) { const small = document.createElement('small'); small.textContent = ` – ${value.reason}`; li.append(small); }
      list.append(li);
    });
    return node;
  }

  function renderAiPanel() {
    if (!$('aiLog')) return;
    renderAiSettings();
    const chat = aiChat();
    const busy = Boolean(aiAbort);
    $('aiContext').textContent = `${room().name} · aktív változat: ${room().active}`;
    const log = $('aiLog');
    log.innerHTML = '';
    if (!chat.log.length) {
      log.innerHTML = '<div class="ai-empty">Írd le, kinek és mire készül a helyiség. Az AI a valós alaprajz (falak, ajtó nyitási íve, ablakok, kiugrások) és a katalógus méretei alapján berendezi, és az eredményt <strong>új, szerkeszthető változatként</strong> kapod meg. Utána kérhetsz módosítást vagy másik alternatívát.</div>';
    }
    for (const entry of chat.log) {
      const node = document.createElement('div');
      node.className = `ai-msg ${entry.role}`;
      node.innerHTML = aiFormat(entry.text || '');
      if (entry.card) node.append(aiCardNode(entry.card, ui.roomId));
      if (entry.role === 'assistant' && entry.model) {
        const meta = document.createElement('span');
        meta.className = 'ai-meta';
        meta.textContent = `${aiModelLabel(entry.model)}${entry.fixes ? ` · ${entry.fixes} javítási kör` : ''}${entry.shortened ? ' · tömörített újrapróbálkozás' : ''}`;
        node.append(meta);
      }
      log.append(node);
    }
    if (busy) {
      const node = document.createElement('div');
      node.className = 'ai-msg assistant';
      node.innerHTML = '<span class="ai-thinking"><span></span><span></span><span></span></span>';
      log.append(node);
    }
    log.scrollTop = log.scrollHeight;
    const suggestions = chat.log.some(entry => entry.card)
      ? ['Adj egy másik alternatívát', 'Legyen több szabad játszóhely', 'Tedd az íróasztalt az ablak alá']
      : ['Ez a szoba három kislánynak készül. Kell 3 ágy, tanulósarok és sok tárhely.', 'Rendezd be dolgozószobának vendégággyal.', 'Tartsd meg a mostani bútorokat, csak rendezd át őket jobban.'];
    $('aiSuggestions').innerHTML = '';
    if (!busy) suggestions.forEach(text => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = text;
      button.onclick = () => { $('aiInput').value = text; $('aiInput').focus(); };
      $('aiSuggestions').append(button);
    });
    $('aiSend').disabled = busy;
    $('aiStop').hidden = !busy;
    $('aiInput').disabled = busy;
    $('aiNewChat').disabled = busy || !chat.log.length;
    if (!busy) setAiStatus(aiKey ? '' : 'Add meg az API-kulcsot a beállításokban.');
  }

  function applyAiProposal(roomId, proposal) {
    const targetRoom = data.rooms[roomId];
    const chat = aiChat(roomId);
    const input = proposal.input;
    let target = targetRoom.active;
    let created = false;
    if (input.new_variant || !targetRoom.variants[target] || !chat.variants.includes(target)) {
      target = Core.createVariant(targetRoom, String(input.variant_name || '').trim().slice(0, 60) || 'AI javaslat', { now: Date.now() });
      chat.variants.push(target);
      created = true;
    }
    targetRoom.variants[target].items = proposal.built.items;
    targetRoom.active = target;
    if (roomId === ui.roomId) ui.selectedId = null;
    commit('AI elrendezés');
    refreshAll();
    invalidateThumbs();
    return {
      variant: target,
      created,
      count: proposal.built.items.length,
      warnings: proposal.issues.map(issue => issue.text),
      summary: input.summary || '',
      items: proposal.built.items.map((item, index) => ({ name: item.name, reason: proposal.built.reasons[index] || '' }))
    };
  }

  async function sendAi(text) {
    const message = String(text || '').trim();
    if (!message || aiAbort) return;
    if (!aiKey) { aiSettingsOpen = true; renderAiPanel(); toast('Előbb add meg az Anthropic API-kulcsot.'); $('aiKey').focus(); return; }
    const roomId = ui.roomId;
    const geom = geometry();
    const chat = aiChat(roomId);
    if (!geom?.closed || geom.vertices.length < 3) {
      chat.log.push({ role: 'user', text: message }, { role: 'error', text: 'Ennek a helyiségnek nincs zárt alaprajza, ezért nem tudom berendezni. Zárd le a falakat a Helyiség fülön.' });
      saveAi(); renderAiPanel(); return;
    }
    if (archEditing()) finishArchitecture();
    let brief;
    try { brief = AI.buildRoomBrief({ roomName: room().name, geom, items: items(), Geometry, Catalog }); }
    catch (error) { toast(error.message); return; }
    const sourceItems = JSON.parse(JSON.stringify(items()));
    const activeName = room().active;
    const first = chat.api.length === 0;
    const userContent = `${first ? `A HELYISÉG ADATAI:\n${brief.text}` : `Aktív változat: „${activeName}”. ${AI.currentStateText(brief.brief)}`}\n\nA FELHASZNÁLÓ KÉRÉSE:\n${message}`;
    const evaluate = input => {
      const inPlace = !input.new_variant && chat.variants.includes(activeName);
      const built = AI.buildLayoutItems(input, { base: brief.base, existingItems: sourceItems, productByKey: key => aiProducts().find(value => value.key === key), Core, Catalog, Geometry, idFactory, keepIds: inPlace });
      const issues = AI.analyzeLayout(built.items, geom, { Geometry, Catalog });
      return { built, issues, report: AI.issueReport(built, issues, brief.base, Geometry) };
    };
    chat.log.push({ role: 'user', text: message });
    $('aiInput').value = '';
    const apiLength = chat.api.length;
    const pendingBefore = [...chat.pending];
    aiAbort = new AbortController();
    renderAiPanel();
    const model = aiState.model || AI.DEFAULT_MODEL;
    // Live progress: round label + what the model is doing right now + elapsed time.
    const started = Date.now();
    const progress = { round: 'Az AI tervez', phase: 'Kapcsolódás', count: 0 };
    const showProgress = () => {
      const seconds = Math.round((Date.now() - started) / 1000);
      const detail = progress.phase === 'tool' ? `elrendezés összeállítása${progress.count ? ` (${progress.count} bútor)` : ''}` : progress.phase === 'thinking' ? 'gondolkodik' : progress.phase === 'text' ? 'ír' : progress.phase;
      setAiStatus(`${progress.round} – ${detail}… ${seconds} mp`);
    };
    const ticker = setInterval(showProgress, 1000);
    showProgress();
    try {
      const result = await AI.runLayoutTurn({
        apiKey: aiKey, model, signal: aiAbort.signal, messages: chat.api,
        catalogText: AI.catalogTable(aiProducts()), userContent, evaluate,
        pendingToolUseIds: chat.pending,
        onStatus: text => { progress.round = text.replace(/…$/, ''); progress.phase = 'Kapcsolódás'; progress.count = 0; showProgress(); },
        onProgress: event => {
          progress.phase = event.phase;
          if (event.phase === 'tool' && event.json) progress.count = (event.json.match(/"center_x"/g) || []).length;
        }
      });
      chat.pending = result.pendingToolUseIds;
      const entry = { role: 'assistant', text: result.text || (result.proposal ? (result.proposal.input.summary || 'Elkészült az elrendezés.') : 'Nem érkezett válasz.'), model, fixes: result.fixes || 0, shortened: Boolean(result.shortened) };
      if (result.proposal) entry.card = applyAiProposal(roomId, result.proposal);
      chat.log.push(entry);
    } catch (error) {
      chat.api.length = apiLength;
      chat.pending = pendingBefore;
      chat.log.push({ role: 'error', text: error.status === 'aborted' ? 'Leállítva.' : (error.message || 'Ismeretlen hiba.') });
      if (error.status === 401) { aiSettingsOpen = true; }
    } finally {
      clearInterval(ticker);
      aiAbort = null;
      saveAi();
      renderAiPanel();
      if (ui.leftTab === 'ai' && ui.roomId === roomId) $('aiInput').focus();
    }
  }

  function setupAi() {
    renderAiSettings();
    $('aiSettingsToggle').onclick = () => { aiSettingsOpen = !aiSettingsOpen || !aiKey; renderAiPanel(); };
    $('aiKeySave').onclick = () => {
      const value = $('aiKey').value.trim();
      if (!value) { toast('Illeszd be a kulcsot.'); return; }
      if (!AI.looksLikeKey(value)) { toast('Ez nem tűnik Anthropic API-kulcsnak (sk-ant-… kezdetű).'); return; }
      aiKey = AI.saveKey(localStorage, value);
      $('aiKey').value = '';
      aiSettingsOpen = false;
      renderAiPanel();
      toast('API-kulcs elmentve ebben a böngészőben');
      $('aiInput').focus();
    };
    $('aiKey').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('aiKeySave').click(); } });
    $('aiKeyClear').onclick = async () => {
      if (!await confirmAction('API-kulcs törlése', 'A kulcs törlődik ebből a böngészőből. A beszélgetések megmaradnak.', 'Törlés')) return;
      aiKey = AI.saveKey(localStorage, '');
      renderAiPanel();
    };
    $('aiModel').onchange = () => { aiState.model = $('aiModel').value; saveAi(); };
    $('aiComposer').addEventListener('submit', event => { event.preventDefault(); sendAi($('aiInput').value); });
    $('aiInput').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendAi($('aiInput').value); }
    });
    $('aiStop').onclick = () => aiAbort?.abort();
    $('aiNewChat').onclick = async () => {
      if (!await confirmAction('Új beszélgetés', 'Az eddigi beszélgetés törlődik ennél a helyiségnél. Az AI által létrehozott változatok megmaradnak.', 'Új beszélgetés')) return;
      aiState.chats[ui.roomId] = AI.emptyChat();
      saveAi();
      renderAiPanel();
    };

    // IKEA: read an unknown product page with the AI (server-side web_fetch).
    $('ikeaAiRead').onclick = async () => {
      if (!aiKey) { toast('Az AI-olvasáshoz add meg az API-kulcsot az AI fülön.'); return; }
      const url = $('ikeaUrl').value;
      const button = $('ikeaAiRead');
      button.disabled = true;
      $('ikeaImportStatus').className = 'import-status';
      $('ikeaImportStatus').textContent = 'Az AI beolvassa az IKEA termékoldalát… (10–30 másodperc)';
      try {
        const result = await AI.readIkeaProduct({ apiKey: aiKey, model: aiState.model || AI.DEFAULT_MODEL, url });
        if (!$('ikeaDialog').open || $('ikeaUrl').value !== url) return;
        if (result.name) $('ikeaName').value = result.name;
        if (result.width) $('ikeaWidth').value = result.width;
        if (result.depth) $('ikeaDepth').value = result.depth;
        $('ikeaHeight').value = result.height || '';
        if (result.category && [...$('ikeaCategory').options].some(option => option.value === result.category)) $('ikeaCategory').value = result.category;
        const parsedId = Core.parseIkeaProductUrl(url).productId;
        const idNote = result.productId && parsedId && result.productId.replace(/\D/g, '') !== parsedId.replace(/\D/g, '') ? ` Figyelem: az oldalon talált cikkszám (${result.productId}) eltér a linkben szereplőtől.` : '';
        const missing = [!result.width && 'szélesség', !result.depth && 'mélység'].filter(Boolean);
        $('ikeaImportStatus').className = `import-status ${missing.length ? 'error' : 'warning'}`;
        $('ikeaImportStatus').textContent = `${missing.length ? `Hiányzik: ${missing.join(', ')} – add meg kézzel. ` : ''}Az AI által beolvasott adatok. Hozzáadás előtt ellenőrizd őket a termékoldalon.${result.notes ? ` Megjegyzés: ${result.notes}` : ''}${idNote}`;
      } catch (error) {
        if (!$('ikeaDialog').open) return;
        $('ikeaImportStatus').className = 'import-status error';
        $('ikeaImportStatus').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  }

  // ------------------------------------------------------------------ JSON backup
  function exportJson() {
    const exportData = JSON.parse(JSON.stringify(data));
    exportData.favoriteProducts = favorites;
    exportData.exportedBy = 'Zuglak Studio 2.1';
    exportData.exportedAt = new Date().toISOString();
    download(`zuglak-tervek-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }));
    toast('Biztonsági mentés letöltve');
  }

  async function importJson(file) {
    try {
      const imported = JSON.parse(await file.text());
      if (!Core.isValidPlanData(imported, REQUIRED)) throw new Error('A fájl nem érvényes Zuglak tervfájl.');
      if (!await confirmAction('Terv betöltése', 'A fájl felülírja a böngészőben lévő terveket. A betöltés visszavonható (Ctrl+Z).', 'Betöltés')) return;
      const importedFavorites = imported.favoriteProducts;
      const next = Core.migratePlanData(imported, REQUIRED, migrateOptions);
      delete next.favoriteProducts; delete next.exportedBy; delete next.exportedAt;
      const previous = data;
      data = next;
      ui.roomId = data.rooms[data.currentRoom] ? data.currentRoom : 'room1';
      ui.selectedId = null;
      const snapshot = JSON.stringify(data);
      if (!persist(snapshot)) { data = previous; throw new Error('A terv nem fér el a helyi tárhelyen.'); }
      history.push(committed); future = []; committed = snapshot; updateHistoryButtons();
      if (Array.isArray(importedFavorites)) { try { favorites = Core.saveFavorites(localStorage, importedFavorites); } catch { /* ignore */ } }
      invalidateThumbs(); roomThumbs.clear();
      fitView();
      refreshAll();
      toast('Terv betöltve');
    } catch (error) {
      toast(error.message || 'A JSON nem érvényes Zuglak tervfájl.', 6000);
    }
  }

  // ------------------------------------------------------------------ keyboard
  window.addEventListener('keydown', event => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.querySelector('dialog[open]');
    if (typing) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (ctrl && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (ctrl && key === 'y') { event.preventDefault(); redo(); return; }
    if (ctrl && key === 'd') { event.preventDefault(); duplicateSelected(); return; }
    if (ctrl && key === 's') { event.preventDefault(); persist(JSON.stringify(data)); toast('Mentve a böngészőbe'); return; }
    if (ctrl) return;
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && selectedItem()) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      nudgeSelected(key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0);
      return;
    }
    if (event.code === 'Space') { spaceDown = true; canvas.style.cursor = 'grab'; event.preventDefault(); return; }
    if (key === 'escape') {
      if (ui.presentation) { setPresentation(false); return; }
      if (ui.mode !== 'furnish') { if (ui.openingTool) { ui.openingTool = null; renderModeBanner(); } else finishArchitecture(); return; }
      ui.measure = null; closeMenus(); select(null); return;
    }
    if ((key === 'delete' || key === 'backspace')) {
      if (ui.mode === 'openings' && ui.selectedObjectId) {
        const geom = geometry();
        geom.objects = geom.objects.filter(value => value.id !== ui.selectedObjectId);
        ui.selectedObjectId = null; commit('Nyílászáró törlése'); renderInspector(); requestRender();
      } else if (ui.mode === 'walls' && ui.selectedVertex !== null) deleteVertex(ui.selectedVertex);
      else deleteSelected();
      event.preventDefault();
      return;
    }
    if (key === 'r' && selectedItem()) { rotateSelected(event.shiftKey ? -90 : 90); return; }
    if (key === 'v') setTool('select');
    if (key === 'h') setTool('pan');
    if (key === 'm') setTool('measure');
    if (key === '1') setView('2d');
    if (key === '2') setView('3d');
    if (key === 'p') setPresentation(!ui.presentation);
    if (key === '0') { if (ui.view === '2d') fitView(); else view3d?.resetCamera(); }
    if (key === '+' || key === '=') zoomAt(1.2);
    if (key === '-') zoomAt(1 / 1.2);
  });
  window.addEventListener('keyup', event => { if (event.code === 'Space') { spaceDown = false; canvas.style.cursor = ui.tool === 'pan' ? 'grab' : 'default'; } });
  window.addEventListener('resize', () => requestRender());
  document.addEventListener('click', closeMenus);

  function setTool(tool) {
    ui.tool = tool;
    if (tool !== 'measure') ui.measure = null;
    document.querySelectorAll('[data-tool]').forEach(button => button.classList.toggle('selected', button.dataset.tool === tool));
    canvas.style.cursor = tool === 'pan' ? 'grab' : tool === 'measure' ? 'crosshair' : 'default';
    if (tool === 'measure') toast('Mérés: kattints két pontra');
    requestRender();
  }

  // ------------------------------------------------------------------ wiring
  function init() {
    Icons.hydrate();
    setupAskDialog();
    setupAi();
    // restore layer prefs
    try {
      const prefs = JSON.parse(localStorage.getItem(prefsKey) || '{}');
      for (const [id, value] of Object.entries(prefs.layers || {})) if ($(id) && typeof value === 'boolean') $(id).checked = value;
      if (prefs.snap === false) { $('snap').setAttribute('aria-pressed', 'false'); $('snap').classList.remove('selected'); }
    } catch { /* ignore */ }

    document.querySelectorAll('#viewSwitch button').forEach(button => { button.onclick = () => setView(button.dataset.view); });
    document.querySelectorAll('.rail button').forEach(button => {
      button.onclick = () => {
        if (button.dataset.tab === ui.leftTab && window.matchMedia('(max-width: 860px)').matches) { document.body.classList.toggle('panel-open'); return; }
        setLeftTab(button.dataset.tab);
      };
    });
    document.querySelectorAll('#sourceFilter button').forEach(button => { button.onclick = () => { ui.catalogSource = button.dataset.source; savePrefs(); renderCatalog(); }; });
    document.querySelectorAll('[data-tool]').forEach(button => { button.onclick = () => setTool(button.dataset.tool); });
    $('catalogSearch').addEventListener('input', renderCatalog);
    $('undo').onclick = undo; $('redo').onclick = redo;
    $('zoomIn').onclick = () => zoomAt(1.25);
    $('zoomOut').onclick = () => zoomAt(1 / 1.25);
    $('fit').onclick = fitView; $('zoomLabel').onclick = fitView;
    bindDropdown('roomButton', 'roomMenu', renderRoomMenu);
    bindDropdown('variantButton', 'variantMenu', renderVariantMenu);
    bindDropdown('layersButton', 'layersMenu');
    $('snap').addEventListener('click', event => {
      // Click on main toggle area toggles snapping; the chevron opens options.
      event.stopPropagation();
      const rect = $('snap').getBoundingClientRect();
      if (event.clientX > rect.right - 26) { const open = $('snapMenu').hidden; closeMenus(); $('snapMenu').hidden = !open; return; }
      const on = $('snap').getAttribute('aria-pressed') !== 'true';
      $('snap').setAttribute('aria-pressed', String(on));
      $('snap').classList.toggle('selected', on);
      toast(on ? 'Illesztés bekapcsolva' : 'Illesztés kikapcsolva (szabad mozgatás)');
      savePrefs();
    });
    $('snapMenu').addEventListener('click', event => event.stopPropagation());
    for (const id of ['showDims', 'showItemDims', 'showLabels', 'showUnderlay', 'showGrid', 'darkWalls', 'snapWalls', 'snapFurniture', 'snapAlign', 'snapGrid', 'snapRotation']) {
      $(id).addEventListener('change', () => { savePrefs(); requestRender(); if (id === 'showUnderlay' && ui.leftTab === 'room') renderRoomPanel(); });
    }
    document.querySelectorAll('#clearanceSwitch button').forEach(button => {
      button.classList.toggle('selected', Number(button.dataset.clearance) === ui.clearance);
      button.onclick = () => {
        ui.clearance = Number(button.dataset.clearance);
        document.querySelectorAll('#clearanceSwitch button').forEach(other => other.classList.toggle('selected', other === button));
        savePrefs(); requestRender();
      };
    });
    $('warningToggle').onclick = event => { event.stopPropagation(); $('warningList').hidden = !$('warningList').hidden; renderWarnings(); };
    $('finishArchitecture').onclick = finishArchitecture;
    $('presentButton').onclick = () => setPresentation(true);
    $('exitPresentation').onclick = () => setPresentation(false);

    // 3D toolbar
    document.querySelectorAll('#cameraSwitch button').forEach(button => {
      button.classList.toggle('selected', button.dataset.camera === ui.camera);
      button.onclick = () => {
        ui.camera = button.dataset.camera;
        document.querySelectorAll('#cameraSwitch button').forEach(other => other.classList.toggle('selected', other === button));
        view3d?.setCameraMode(ui.camera);
        savePrefs();
      };
    });
    $('resetCamera').onclick = () => view3d?.resetCamera();
    const syncToggle = (id, key) => $(id).classList.toggle('active', Boolean(ui[key]));
    $('cutawayToggle').onclick = () => { ui.cutaway = !ui.cutaway; syncToggle('cutawayToggle', 'cutaway'); savePrefs(); requestRender(); };
    $('lampsToggle').onclick = () => { ui.lampsOn = !ui.lampsOn; syncToggle('lampsToggle', 'lampsOn'); savePrefs(); requestRender(); };
    $('aoToggle').onclick = () => { ui.ao = !ui.ao; syncToggle('aoToggle', 'ao'); view3d?.setAO(ui.ao); savePrefs(); toast(ui.ao ? 'Finom árnyékolás (AO) bekapcsolva' : 'AO kikapcsolva – gyorsabb megjelenítés'); };
    syncToggle('cutawayToggle', 'cutaway'); syncToggle('lampsToggle', 'lampsOn'); syncToggle('aoToggle', 'ao');
    $('sunAzimuth').value = ui.sunAzimuth;
    $('sunAzimuth').oninput = event => { ui.sunAzimuth = Number(event.target.value); requestRender(); };
    $('sunAzimuth').onchange = savePrefs;

    // Variants panel
    $('duplicateVariant').onclick = () => duplicateVariant();
    $('newVariant').onclick = newVariant;
    $('compareVariants').onclick = openCompare;
    $('saveVersion').onclick = saveVersionPrompt;
    $('exportJSON').onclick = exportJson;
    $('importJSON').onchange = event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) importJson(file); };

    // Custom furniture
    $('customFurniture').onclick = async () => {
      const answer = await ask('Egyedi méretű bútor', 'Add meg a bútor valós befoglaló méreteit centiméterben.', [
        { key: 'name', label: 'Megnevezés', value: 'Saját bútor' },
        { key: 'model', label: 'Megjelenés', value: 'box', options: [['box', 'Egyszerű doboz'], ['sofa', 'Kanapé'], ['table', 'Asztal'], ['dresser', 'Komód / tároló'], ['wardrobe', 'Szekrény'], ['bed', 'Ágy'], ['desk', 'Íróasztal'], ['bookcase', 'Polc'], ['kitchen-base', 'Konyhaszekrény'], ['rug', 'Szőnyeg']] },
        { key: 'w', label: 'Szélesség (cm)', value: '120', type: 'number' },
        { key: 'h', label: 'Mélység (cm)', value: '60', type: 'number' },
        { key: 'height', label: 'Magasság (cm)', value: '80', type: 'number' }
      ]);
      if (!answer) return;
      addProduct({ key: 'custom', source: 'custom', model: answer.model, name: answer.name.trim() || 'Saját bútor', width: Number(answer.w), depth: Number(answer.h), height: Number(answer.height), category: 'storage', materials: Catalog.defaultMaterials(answer.model) });
    };

    // IKEA dialog
    Object.entries(Ikea.categories).forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; $('ikeaCategory').append(option); });
    $('importIkea').onclick = () => {
      resolvedImport = null;
      $('ikeaForm').reset();
      $('ikeaManualFields').hidden = true;
      $('ikeaImportOk').disabled = true;
      $('ikeaSourceLink').hidden = true;
      fillImportFields({}, false);
      $('ikeaImportStatus').className = 'import-status';
      $('ikeaImportStatus').textContent = 'Nem végzünk háttérben webes adatgyűjtést vagy jogosulatlan scrapinget.';
      $('ikeaDialog').showModal();
      setTimeout(() => $('ikeaUrl').focus(), 0);
    };
    $('resolveIkea').onclick = resolveIkeaUrl;
    $('ikeaUrl').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); resolveIkeaUrl(); } });
    // Editing the link after a check invalidates the earlier result, otherwise the
    // previously recognised product would be added under the new link.
    $('ikeaUrl').addEventListener('input', () => {
      if ($('ikeaManualFields').hidden && $('ikeaImportOk').disabled) return;
      resolvedImport = null;
      $('ikeaManualFields').hidden = true;
      $('ikeaAiRow').hidden = true;
      $('ikeaImportOk').disabled = true;
      $('ikeaSourceLink').hidden = true;
      fillImportFields({}, false);
      $('ikeaImportStatus').className = 'import-status';
      $('ikeaImportStatus').textContent = 'A link megváltozott – kattints az Ellenőrzés gombra.';
    });
    $('ikeaForm').addEventListener('input', event => {
      if (event.target.id !== 'ikeaUrl' && $('ikeaImportStatus').classList.contains('error') && !resolvedImport) {
        $('ikeaImportStatus').className = 'import-status warning';
        $('ikeaImportStatus').textContent = 'Másold be a termékoldalon szereplő külső méreteket, majd add hozzá a tervhez.';
      }
    });
    $('ikeaForm').addEventListener('submit', event => {
      if (event.submitter?.value === 'cancel') return;
      event.preventDefault();
      try {
        const product = readImportForm();
        const added = addProduct(product);
        if (added && $('ikeaSaveFavorite').checked && !isFavorite(product.productId)) {
          favorites = Core.saveFavorites(localStorage, [...favorites, Core.normalizeProduct(product)]);
          renderCatalog();
        }
        if (added) $('ikeaDialog').close('import');
      } catch (error) {
        $('ikeaImportStatus').className = 'import-status error';
        $('ikeaImportStatus').textContent = error.message;
      }
    });

    // Read-only dialogs also close on a click outside them (on the backdrop).
    ['exportDialog', 'compareDialog'].forEach(id => {
      const dialog = $(id);
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close('cancel');
      });
    });

    // Export dialog
    $('exportButton').onclick = () => { $('exportDialog').showModal(); ui.exportKind = ui.view === '3d' ? 'png3d' : 'png2d'; updateExportPreview(); };
    document.querySelectorAll('#exportKind button').forEach(button => { button.onclick = () => { ui.exportKind = button.dataset.kind; updateExportPreview(); }; });
    ['exportPaper', 'exportQuality', 'exportCamera', 'exportBackground', 'exportDims', 'exportLabels', 'exportTitle'].forEach(id => $(id).addEventListener('change', updateExportPreview));
    $('exportRun').onclick = runExport;

    renderCategoryChips();
    setLeftTab(ui.leftTab || 'catalog');
    document.body.classList.remove('panel-open');
    setTool('select');
    updateHistoryButtons();
    setSaveState(true);
    setView(ui.view || '2d');
    requestAnimationFrame(() => { fitView(); refreshAll(); });
    if (data.meta?.migratedFrom && !data.meta.migrationNoticeShown) {
      data.meta.migrationNoticeShown = true;
      persist(JSON.stringify(data)); committed = JSON.stringify(data);
      setTimeout(() => toast('A korábbi terveid átkerültek az új, centiméter-alapú formátumba. Az eredeti adat érintetlen biztonsági másolatként megmaradt.', 7000), 600);
    } else if (!localStorage.getItem(Core.PLAN_STORAGE_KEY)) {
      persist(committed);
    }
  }

  init();
})();
