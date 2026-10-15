/* Shared, dependency-free data helpers for Zuglak Studio and its tests. */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  root.ZuglakCore = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PLAN_STORAGE_KEY = 'zuglak-v2';
  const FAVORITES_STORAGE_KEY = 'zuglak-favorites-v1';
  const LEGACY_BACKUP_KEY = 'zuglak-v2-backup-v1';
  const CURRENT_PLAN_VERSION = 2;

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
    return normalized;
  }

  function createFurnitureItem(product, position, idFactory) {
    const normalized = normalizeProduct(product);
    const id = idFactory ? idFactory() : `i${Date.now()}${Math.random()}`;
    return {
      id,
      type: normalized.type,
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
      originalDimensions: {
        width: normalized.width,
        depth: normalized.depth,
        ...(normalized.height ? { height: normalized.height } : {})
      }
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
      value && [1, CURRENT_PLAN_VERSION].includes(value.version) && value.rooms &&
      requiredRoomIds.every(id => value.rooms[id] && value.rooms[id].variants)
    );
  }

  function migratePlanData(value, requiredRoomIds = []) {
    if (!isValidPlanData(value, requiredRoomIds)) throw new TypeError('Nem érvényes Zuglak tervadat.');
    const migrated = JSON.parse(JSON.stringify(value));
    migrated.version = CURRENT_PLAN_VERSION;
    migrated.customPlans = Array.isArray(migrated.customPlans) ? migrated.customPlans : [];
    for (const room of Object.values(migrated.rooms)) {
      room.geometries = Array.isArray(room.geometries) ? room.geometries : [];
      room.activeGeometryId = room.geometries.some(geometry => geometry.id === room.activeGeometryId)
        ? room.activeGeometryId
        : room.geometries[0]?.id || null;
      for (const geometry of room.geometries) {
        geometry.name = String(geometry.name || 'Szobageometria');
        geometry.vertices = Array.isArray(geometry.vertices) ? geometry.vertices : [];
        geometry.closed = Boolean(geometry.closed && geometry.vertices.length >= 3);
        geometry.confirmedWalls = Array.isArray(geometry.confirmedWalls) ? geometry.confirmedWalls : [];
        geometry.objects = Array.isArray(geometry.objects) ? geometry.objects : [];
      }
    }
    return migrated;
  }

  function loadPlan(storage, defaultFactory, requiredRoomIds) {
    const fallbackValue = defaultFactory();
    const fallback = isValidPlanData(fallbackValue, requiredRoomIds)
      ? migratePlanData(fallbackValue, requiredRoomIds)
      : fallbackValue;
    try {
      const serialized = storage.getItem(PLAN_STORAGE_KEY);
      const parsed = JSON.parse(serialized || 'null');
      if (!isValidPlanData(parsed, requiredRoomIds)) return fallback;
      if (parsed.version === 1 && serialized && !storage.getItem(LEGACY_BACKUP_KEY)) {
        try { storage.setItem(LEGACY_BACKUP_KEY, serialized); } catch { /* A full quota must not hide readable user data. */ }
      }
      return migratePlanData(parsed, requiredRoomIds);
    } catch {
      return fallback;
    }
  }

  return Object.freeze({
    PLAN_STORAGE_KEY,
    FAVORITES_STORAGE_KEY,
    LEGACY_BACKUP_KEY,
    CURRENT_PLAN_VERSION,
    normalizeProductId,
    validateIkeaHungaryUrl,
    parseIkeaProductUrl,
    normalizeProduct,
    createFurnitureItem,
    loadFavorites,
    saveFavorites,
    isValidPlanData,
    migratePlanData,
    loadPlan
  });
});
