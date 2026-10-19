/* Shared, dependency-free data helpers for Zuglak Studio 2.0 and its tests. */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  root.ZuglakCore = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 2.0 stores plans under a new key. The 1.x key is only ever read, never
  // overwritten, so the original data stays available as an automatic backup.
  const PLAN_STORAGE_KEY = 'zuglak-v3';
  const LEGACY_PLAN_STORAGE_KEY = 'zuglak-v2';
  const FAVORITES_STORAGE_KEY = 'zuglak-favorites-v1';
  const LEGACY_BACKUP_KEY = 'zuglak-v2-backup-v1';
  const CURRENT_PLAN_VERSION = 3;
  const MAX_VERSIONS = 25;
  const DEFAULT_WALL_HEIGHT = 260;
  const DEFAULT_WALL_THICKNESS = 12;
  const DEFAULT_FLOOR = 'floor-oak-light';
  const DEFAULT_WALL = 'wall-warm-white';

  const legacyFloor = { 'oak-light': 'floor-oak-light', 'oak-natural': 'floor-oak-natural', walnut: 'floor-walnut', plain: 'floor-concrete' };
  const legacyModels = {
    sofa: 'sofa', armchair: 'armchair', bed: 'bed', table: 'table', chair: 'chair', wardrobe: 'wardrobe',
    dresser: 'dresser', rug: 'rug', desk: 'desk', coffee: 'coffee-table', plant: 'plant', lamp: 'floor-lamp',
    shelf: 'bookcase', tv: 'tv', stool: 'stool', bath: 'bathtub', sink: 'basin', custom: 'box'
  };

  function normalizeProductId(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length !== 8) return '';
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }

  function validateIkeaHungaryUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'ikea.com' || !/^\/hu\/hu\/p\//i.test(url.pathname)) return null;
      url.protocol = 'https:';
      url.username = '';
      url.password = '';
      url.hash = '';
      return url.toString();
    } catch {
      return null;
    }
  }

  function nameFromSlug(slug) {
    const ignored = new Set([
      'feher', 'fekete', 'bezs', 'szuerke', 'barna', 'zoeld', 'kek', 'piros',
      'furner', 'hatas', 'vilagosbezs', 'fekete-barna', 'toelgy'
    ]);
    const words = String(slug || '').split('-').filter(Boolean);
    const useful = [];
    for (const word of words) {
      if (/^s?\d{8}$/.test(word)) break;
      if (ignored.has(word) && useful.length >= 2) break;
      useful.push(word);
    }
    const value = useful.join(' ').trim();
    return value ? value.charAt(0).toLocaleUpperCase('hu') + value.slice(1) : '';
  }

  function parseIkeaProductUrl(value) {
    const productUrl = validateIkeaHungaryUrl(value);
    if (!productUrl) return { ok: false, error: 'Csak érvényes IKEA magyar terméklink használható.' };
    const url = new URL(productUrl);
    const slug = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    const idMatch = slug.match(/(?:^|-)(s?\d{8})(?:\/)?$/i);
    return {
      ok: true,
      productUrl,
      productId: idMatch ? normalizeProductId(idMatch[1]) : '',
      suggestedName: nameFromSlug(slug.replace(/-s?\d{8}$/i, ''))
    };
  }

  function positiveDimension(value, label) {
    if (value === '' || value === null || value === undefined) {
      throw new TypeError(`${label} megadása kötelező.`);
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > 5000) {
      throw new TypeError(`${label} csak 0 és 5000 cm közötti szám lehet.`);
    }
    return number;
  }

  function normalizeProduct(product) {
    if (!product || typeof product !== 'object') throw new TypeError('Hiányzó termékadatok.');
    const name = String(product.name || '').trim();
    if (!name) throw new TypeError('A termék neve kötelező.');
    const productId = normalizeProductId(product.productId);
    if (!productId) throw new TypeError('Az IKEA cikkszámnak 8 számjegyből kell állnia.');
    const productUrl = validateIkeaHungaryUrl(product.productUrl);
    if (!productUrl) throw new TypeError('Érvényes IKEA magyar terméklink szükséges.');
    const normalized = {
      name,
      productId,
      category: String(product.category || 'storage'),
      type: String(product.type || 'custom'),
      width: positiveDimension(product.width, 'A szélesség'),
      depth: positiveDimension(product.depth, 'A mélység'),
      productUrl
    };
    if (product.height !== '' && product.height !== null && product.height !== undefined) {
      normalized.height = positiveDimension(product.height, 'A magasság');
    }
    if (product.image) normalized.image = String(product.image);
    if (product.model) normalized.model = String(product.model);
    return normalized;
  }

  /** IKEA product → furniture item. Position is the top-left corner in centimetres. */
  function createFurnitureItem(product, position, idFactory) {
    const normalized = normalizeProduct(product);
    const id = idFactory ? idFactory() : `i${Date.now()}${Math.random()}`;
    return {
      id,
      type: normalized.type,
      model: normalized.model || legacyModels[normalized.type] || 'box',
      name: normalized.name,
      w: normalized.width,
      h: normalized.depth,
      height: normalized.height,
      rot: 0,
      x: Number(position && position.x) || 0,
      y: Number(position && position.y) || 0,
      source: 'ikea',
      productId: normalized.productId,
      productUrl: normalized.productUrl,
      category: normalized.category,
      dimensionStatus: 'verified',
      materials: product.materials ? { ...product.materials } : {},
      originalDimensions: {
        width: normalized.width,
        depth: normalized.depth,
        ...(normalized.height ? { height: normalized.height } : {})
      }
    };
  }

  /** Generic catalogue piece → furniture item (typical dimensions, freely resizable). */
  function createGenericItem(product, position, idFactory) {
    const width = positiveDimension(product.width, 'A szélesség');
    const depth = positiveDimension(product.depth, 'A mélység');
    const height = product.height ? positiveDimension(product.height, 'A magasság') : undefined;
    return {
      id: idFactory ? idFactory() : `i${Date.now()}${Math.random()}`,
      type: product.model || product.type || 'box',
      model: product.model || product.type || 'box',
      name: String(product.name || 'Bútor').trim() || 'Bútor',
      w: width,
      h: depth,
      height,
      rot: 0,
      x: Number(position && position.x) || 0,
      y: Number(position && position.y) || 0,
      source: product.source === 'custom' ? 'custom' : 'generic',
      category: product.category || 'storage',
      dimensionStatus: product.source === 'custom' ? 'user' : 'typical',
      materials: { ...(product.materials || {}) }
    };
  }

  function loadFavorites(storage) {
    try {
      const parsed = JSON.parse(storage.getItem(FAVORITES_STORAGE_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      const unique = new Map();
      for (const value of parsed) {
        try {
          const product = normalizeProduct(value);
          unique.set(product.productId, product);
        } catch { /* Ignore only the invalid favorite, never the full collection. */ }
      }
      return [...unique.values()];
    } catch {
      return [];
    }
  }

  function saveFavorites(storage, favorites) {
    const clean = [];
    const seen = new Set();
    for (const value of favorites || []) {
      try {
        const product = normalizeProduct(value);
        if (!seen.has(product.productId)) {
          seen.add(product.productId);
          clean.push(product);
        }
      } catch { /* A malformed imported favorite must not block the valid collection. */ }
    }
    storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(clean));
    return clean;
  }

  function isValidPlanData(value, requiredRoomIds) {
    return Boolean(
      value && [1, 2, CURRENT_PLAN_VERSION].includes(value.version) && value.rooms &&
      requiredRoomIds.every(id => value.rooms[id] && value.rooms[id].variants && Object.keys(value.rooms[id].variants).length)
    );
  }

  function normalizeVariant(variant, fallbackFloor) {
    variant.items = Array.isArray(variant.items) ? variant.items : [];
    variant.materials = variant.materials && typeof variant.materials === 'object' ? variant.materials : {};
    variant.materials.floor = legacyFloor[variant.materials.floor] || variant.materials.floor || fallbackFloor || DEFAULT_FLOOR;
    variant.materials.walls = variant.materials.walls || DEFAULT_WALL;
    variant.versions = Array.isArray(variant.versions) ? variant.versions.slice(-MAX_VERSIONS) : [];
    for (const item of variant.items) {
      item.model = item.model || legacyModels[item.type] || item.type || 'box';
      item.materials = item.materials && typeof item.materials === 'object' ? item.materials : {};
      item.rot = Number(item.rot) || 0;
      if (!item.dimensionStatus) item.dimensionStatus = item.source === 'ikea' ? 'verified' : item.type === 'custom' ? 'user' : 'typical';
    }
    return variant;
  }

  function normalizeGeometry(geometry) {
    geometry.name = String(geometry.name || 'Szobageometria');
    geometry.vertices = Array.isArray(geometry.vertices) ? geometry.vertices : [];
    geometry.closed = Boolean(geometry.closed && geometry.vertices.length >= 3);
    geometry.confirmedWalls = Array.isArray(geometry.confirmedWalls) ? geometry.confirmedWalls : [];
    geometry.objects = Array.isArray(geometry.objects) ? geometry.objects : [];
    geometry.partitions = Array.isArray(geometry.partitions) ? geometry.partitions : [];
    geometry.wallLabels = Array.isArray(geometry.wallLabels) ? geometry.wallLabels : [];
    geometry.wallNotes = Array.isArray(geometry.wallNotes) ? geometry.wallNotes : [];
    geometry.wallMeasured = Array.isArray(geometry.wallMeasured) ? geometry.wallMeasured : [];
    return geometry;
  }

  /**
   * Migrates 1.x (version 1/2) and normalises 2.0 (version 3) plan data.
   *  - 1.x furniture positions were image pixels; they are converted to centimetres
   *    with that room's own calibration, so nothing moves relative to the drawing.
   *  - Rooms without any wall geometry receive the traced draft outline (flagged
   *    as estimated) when `options.floorplans` is supplied.
   */
  function migratePlanData(value, requiredRoomIds = [], options = {}) {
    if (!isValidPlanData(value, requiredRoomIds)) throw new TypeError('Nem érvényes Zuglak tervadat.');
    const migrated = JSON.parse(JSON.stringify(value));
    const sourceVersion = migrated.version;
    migrated.version = CURRENT_PLAN_VERSION;
    migrated.customPlans = Array.isArray(migrated.customPlans) ? migrated.customPlans : [];
    migrated.meta = migrated.meta && typeof migrated.meta === 'object' ? migrated.meta : {};
    if (sourceVersion < CURRENT_PLAN_VERSION) migrated.meta.migratedFrom = sourceVersion;
    // Rooms added in later versions (e.g. the 4th room) are created without touching existing ones.
    for (const plan of options.floorplans?.plans || []) {
      if (migrated.rooms[plan.id]) {
        const room = migrated.rooms[plan.id];
        if (options.floorplans.legacyNames?.[plan.id]?.includes(room.name)) room.name = plan.name;
        continue;
      }
      migrated.rooms[plan.id] = {
        name: plan.name,
        pxPerCm: plan.pxPerCm,
        active: 'Alap',
        variants: { Alap: { items: [], materials: { floor: DEFAULT_FLOOR, walls: DEFAULT_WALL }, versions: [] } },
        geometries: [],
        activeGeometryId: null
      };
    }
    for (const [roomId, room] of Object.entries(migrated.rooms)) {
      room.geometries = Array.isArray(room.geometries) ? room.geometries : [];
      room.geometries.forEach(normalizeGeometry);
      room.activeGeometryId = room.geometries.some(geometry => geometry.id === room.activeGeometryId)
        ? room.activeGeometryId
        : room.geometries[0]?.id || null;
      room.wallHeight = Number(room.wallHeight) > 0 ? Number(room.wallHeight) : DEFAULT_WALL_HEIGHT;
      room.wallThickness = Number(room.wallThickness) > 0 ? Number(room.wallThickness) : DEFAULT_WALL_THICKNESS;
      const activeGeometry = room.geometries.find(geometry => geometry.id === room.activeGeometryId);
      const fallbackFloor = legacyFloor[activeGeometry?.floorMaterial] || activeGeometry?.floorMaterial || DEFAULT_FLOOR;
      if (sourceVersion < 3) {
        // 1.x stored furniture in image pixels; 1.x used 2 px/cm when uncalibrated.
        const scale = Number(room.pxPerCm) > 0 ? Number(room.pxPerCm) : 2;
        for (const variant of Object.values(room.variants)) {
          for (const item of variant.items || []) {
            item.x = Number(item.x) / scale;
            item.y = Number(item.y) / scale;
          }
        }
      }
      for (const variant of Object.values(room.variants)) normalizeVariant(variant, fallbackFloor);
      if (!room.variants[room.active]) room.active = Object.keys(room.variants)[0];
      const plan = options.floorplans?.byId?.(roomId);
      // Architectural plan geometry (when available) is added once and becomes active,
      // unless the user is working on their own geometry.
      if (plan?.planGeometry && !room.planGeometrySeeded && options.floorplans.buildPlanGeometry) {
        const current = room.geometries.find(geometry => geometry.id === room.activeGeometryId);
        let offset = { x: 0, y: 0 };
        if (current?.vertices?.length) {
          const xs = current.vertices.map(v => v.x); const ys = current.vertices.map(v => v.y);
          offset = { x: Math.min(...xs), y: Math.min(...ys) };
        }
        const planGeometry = options.floorplans.buildPlanGeometry(plan, options.idFactory, offset);
        room.geometries.push(planGeometry);
        if (!current || current.source === 'traced' || !current.closed) room.activeGeometryId = planGeometry.id;
        room.planGeometrySeeded = true;
        room.tracedDraftSeeded = true;
      }
      // Seed the traced draft exactly once per room; a deleted draft is never re-added silently.
      if (plan && !plan.planGeometry && !room.tracedDraftSeeded && Number(room.pxPerCm) > 0 && !room.geometries.some(geometry => geometry.source === 'traced')) {
        const draft = options.floorplans.buildDraftGeometry(plan, room.pxPerCm, options.idFactory);
        room.geometries.push(draft);
        room.tracedDraftSeeded = true;
        if (!room.activeGeometryId || !room.geometries.find(geometry => geometry.id === room.activeGeometryId)?.closed) {
          room.activeGeometryId = draft.id;
        }
      }
    }
    if (!migrated.rooms[migrated.currentRoom]) migrated.currentRoom = requiredRoomIds[0] || Object.keys(migrated.rooms)[0];
    return migrated;
  }

  /** Reads 2.0 data, falling back to 1.x data (left untouched) and then to defaults. */
  function loadPlan(storage, defaultFactory, requiredRoomIds, options = {}) {
    const fallback = () => {
      const value = defaultFactory();
      return isValidPlanData(value, requiredRoomIds) ? migratePlanData(value, requiredRoomIds, options) : value;
    };
    const read = key => {
      try {
        const serialized = storage.getItem(key);
        const parsed = JSON.parse(serialized || 'null');
        return isValidPlanData(parsed, requiredRoomIds) ? { parsed, serialized } : null;
      } catch {
        return null;
      }
    };
    const current = read(PLAN_STORAGE_KEY);
    if (current) {
      try { return migratePlanData(current.parsed, requiredRoomIds, options); } catch { /* fall through */ }
    }
    const legacy = read(LEGACY_PLAN_STORAGE_KEY);
    if (legacy) {
      if (legacy.parsed.version === 1 && !storage.getItem(LEGACY_BACKUP_KEY)) {
        try { storage.setItem(LEGACY_BACKUP_KEY, legacy.serialized); } catch { /* A full quota must not hide readable user data. */ }
      }
      try { return migratePlanData(legacy.parsed, requiredRoomIds, options); } catch { /* fall through */ }
    }
    return fallback();
  }

  function uniqueName(existing, base) {
    const names = new Set(existing);
    const clean = String(base || 'Változat').trim() || 'Változat';
    if (!names.has(clean)) return clean;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${clean} (${index})`;
      if (!names.has(candidate)) return candidate;
    }
    return `${clean} ${Date.now()}`;
  }

  const clone = value => JSON.parse(JSON.stringify(value));

  function createVariant(room, name, options = {}) {
    const finalName = uniqueName(Object.keys(room.variants), name);
    const source = options.from ? room.variants[options.from] : null;
    room.variants[finalName] = source
      ? { items: clone(source.items), materials: clone(source.materials || {}), versions: [], createdAt: options.now || Date.now() }
      : { items: [], materials: { floor: room.variants[room.active]?.materials?.floor || DEFAULT_FLOOR, walls: room.variants[room.active]?.materials?.walls || DEFAULT_WALL }, versions: [], createdAt: options.now || Date.now() };
    if (source && options.idFactory) room.variants[finalName].items.forEach(item => { item.id = options.idFactory(); });
    room.active = finalName;
    return finalName;
  }

  function renameVariant(room, oldName, newName) {
    const clean = String(newName || '').trim();
    if (!clean) throw new TypeError('A változat neve nem lehet üres.');
    if (!room.variants[oldName]) throw new RangeError('Ismeretlen változat.');
    if (clean === oldName) return oldName;
    if (room.variants[clean]) throw new TypeError('Már létezik ilyen nevű változat.');
    // Preserve order of keys
    const entries = Object.entries(room.variants).map(([key, value]) => [key === oldName ? clean : key, value]);
    room.variants = Object.fromEntries(entries);
    if (room.active === oldName) room.active = clean;
    return clean;
  }

  function deleteVariant(room, name) {
    if (Object.keys(room.variants).length < 2) throw new TypeError('Az utolsó változat nem törölhető.');
    if (!room.variants[name]) throw new RangeError('Ismeretlen változat.');
    delete room.variants[name];
    if (room.active === name) room.active = Object.keys(room.variants)[0];
    return room.active;
  }

  function saveVersion(room, variantName, label, now = Date.now(), idFactory) {
    const variant = room.variants[variantName];
    if (!variant) throw new RangeError('Ismeretlen változat.');
    const version = {
      id: idFactory ? idFactory() : `v${now}${Math.random().toString(36).slice(2, 6)}`,
      label: String(label || '').trim() || new Date(now).toLocaleString('hu-HU'),
      savedAt: now,
      items: clone(variant.items),
      materials: clone(variant.materials || {})
    };
    variant.versions = [...(variant.versions || []), version].slice(-MAX_VERSIONS);
    return version;
  }

  function restoreVersion(room, variantName, versionId) {
    const variant = room.variants[variantName];
    const version = variant?.versions?.find(value => value.id === versionId);
    if (!version) throw new RangeError('Ismeretlen mentett verzió.');
    variant.items = clone(version.items);
    variant.materials = clone(version.materials);
    return variant;
  }

  /** Compares two variants by item identity (name + model) for the comparison view. */
  function compareVariants(first, second) {
    const key = item => `${item.model || item.type}|${item.name}`;
    const count = items => items.reduce((map, item) => map.set(key(item), (map.get(key(item)) || 0) + 1), new Map());
    const a = count(first.items || []);
    const b = count(second.items || []);
    const onlyA = []; const onlyB = []; const common = [];
    for (const [name, value] of a) {
      const other = b.get(name) || 0;
      for (let i = 0; i < Math.min(value, other); i += 1) common.push(name.split('|')[1]);
      for (let i = other; i < value; i += 1) onlyA.push(name.split('|')[1]);
    }
    for (const [name, value] of b) {
      const other = a.get(name) || 0;
      for (let i = other; i < value; i += 1) onlyB.push(name.split('|')[1]);
    }
    return { onlyA, onlyB, common };
  }

  return Object.freeze({
    PLAN_STORAGE_KEY,
    LEGACY_PLAN_STORAGE_KEY,
    FAVORITES_STORAGE_KEY,
    LEGACY_BACKUP_KEY,
    CURRENT_PLAN_VERSION,
    MAX_VERSIONS,
    DEFAULT_WALL_HEIGHT,
    DEFAULT_WALL_THICKNESS,
    DEFAULT_FLOOR,
    DEFAULT_WALL,
    normalizeProductId,
    validateIkeaHungaryUrl,
    parseIkeaProductUrl,
    normalizeProduct,
    createFurnitureItem,
    createGenericItem,
    loadFavorites,
    saveFavorites,
    isValidPlanData,
    migratePlanData,
    loadPlan,
    uniqueName,
    createVariant,
    renameVariant,
    deleteVariant,
    saveVersion,
    restoreVersion,
    compareVariants
  });
});
