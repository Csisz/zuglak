/*
 * Zuglak Studio 2.0 – furniture catalogue.
 *
 * Two kinds of entries:
 *   - IKEA products (ikea-catalog.js): verified outside dimensions with product links.
 *   - Generic pieces below: TYPICAL sizes for planning ("tipikus méret"), never
 *     presented as product measurements. Generic pieces are freely resizable.
 * `model` selects the 2D artwork and the procedural 3D model.
 * `layer`: 'floor' (rugs, no collision), 'top' (sits on other furniture, no collision), default 'main'.
 */
(function (root, factory) {
  const value = factory(root.ZUGLAK_IKEA_CATALOG || (typeof require === 'function' ? require('./ikea-catalog.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = value;
  root.ZuglakCatalog = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Ikea) {
  'use strict';

  const categories = Object.freeze({
    sofas: 'Kanapék és fotelek',
    tables: 'Asztalok',
    chairs: 'Székek és padok',
    beds: 'Ágyak',
    wardrobes: 'Gardróbok',
    storage: 'Tárolás és polcok',
    desks: 'Dolgozósarok',
    kitchen: 'Konyha',
    bathroom: 'Fürdőszoba',
    rugs: 'Szőnyegek',
    lamps: 'Lámpák',
    decor: 'Dekoráció'
  });

  // [model, name, category, width, depth, height, materials, extra]
  const generic = [
    ['sofa', '3 személyes kanapé', 'sofas', 220, 95, 82, { primary: 'fabric-light-grey', secondary: 'wood-oak-natural' }],
    ['sofa', '2 személyes kanapé', 'sofas', 175, 90, 82, { primary: 'fabric-oat', secondary: 'wood-oak-natural' }],
    ['sectional', 'Sarokkanapé (jobbos)', 'sofas', 270, 165, 82, { primary: 'fabric-light-grey', secondary: 'metal-black' }],
    ['armchair', 'Fotel', 'sofas', 78, 82, 78, { primary: 'fabric-cream-boucle', secondary: 'wood-oak-light' }],
    ['pouf', 'Puff', 'sofas', 50, 50, 42, { primary: 'fabric-terracotta' }],
    ['table', 'Étkezőasztal', 'tables', 160, 90, 75, { primary: 'wood-oak-natural', secondary: 'wood-oak-natural' }],
    ['table-round', 'Kerek étkezőasztal', 'tables', 110, 110, 75, { primary: 'wood-oak-light', secondary: 'wood-oak-light' }],
    ['coffee-table', 'Dohányzóasztal', 'tables', 110, 60, 42, { primary: 'wood-oak-light', secondary: 'metal-black' }],
    ['coffee-round', 'Kerek dohányzóasztal', 'tables', 80, 80, 40, { primary: 'wood-walnut' }],
    ['side-table', 'Kisasztal', 'tables', 45, 45, 52, { primary: 'wood-oak-natural', secondary: 'metal-black' }],
    ['chair', 'Étkezőszék', 'chairs', 46, 52, 80, { primary: 'wood-oak-natural', secondary: 'fabric-oat' }],
    ['chair-upholstered', 'Kárpitozott szék', 'chairs', 50, 56, 82, { primary: 'fabric-cream-boucle', secondary: 'wood-oak-natural' }],
    ['bench', 'Étkezőpad', 'chairs', 140, 38, 45, { primary: 'wood-oak-natural' }],
    ['stool', 'Bárszék', 'chairs', 40, 40, 66, { primary: 'wood-oak-natural', secondary: 'metal-black' }],
    ['bed', 'Franciaágy 160 × 200', 'beds', 170, 212, 95, { primary: 'wood-oak-natural', secondary: 'linen-white', tertiary: 'fabric-stone-grey' }],
    ['bed', 'Franciaágy 180 × 200', 'beds', 190, 212, 95, { primary: 'fabric-oat', secondary: 'linen-white', tertiary: 'fabric-sage' }],
    ['bed', 'Egyszemélyes ágy 90 × 200', 'beds', 98, 208, 80, { primary: 'wood-white', secondary: 'linen-white', tertiary: 'fabric-light-grey' }],
    ['bed-kids', 'Gyerekágy 70 × 140', 'beds', 77, 146, 70, { primary: 'wood-birch-ply', secondary: 'linen-white', tertiary: 'fabric-mustard' }],
    ['crib', 'Kiságy 60 × 120', 'beds', 66, 126, 90, { primary: 'wood-white', secondary: 'linen-white' }],
    ['nightstand', 'Éjjeliszekrény', 'beds', 45, 38, 50, { primary: 'wood-oak-natural', secondary: 'metal-brass' }],
    ['wardrobe', 'Gardrób, 2 ajtós', 'wardrobes', 100, 60, 236, { primary: 'wood-white', secondary: 'metal-steel' }],
    ['wardrobe', 'Gardrób, 3 ajtós', 'wardrobes', 150, 60, 236, { primary: 'wood-cashmere', secondary: 'metal-brass' }],
    ['bookcase', 'Könyvespolc', 'storage', 80, 30, 200, { primary: 'wood-white' }],
    ['cube-shelf', 'Kockapolc 4 × 4', 'storage', 147, 39, 147, { primary: 'wood-oak-light' }],
    ['dresser', 'Komód', 'storage', 80, 48, 78, { primary: 'wood-oak-natural', secondary: 'metal-brass' }],
    ['sideboard', 'Tálalószekrény', 'storage', 160, 45, 75, { primary: 'wood-walnut', secondary: 'metal-black' }],
    ['tv-bench', 'TV-pad', 'storage', 180, 40, 45, { primary: 'wood-oak-light', secondary: 'wood-white' }],
    ['desk', 'Íróasztal', 'desks', 120, 60, 75, { primary: 'wood-oak-light', secondary: 'metal-black' }],
    ['office-chair', 'Irodai szék', 'desks', 62, 62, 100, { primary: 'fabric-charcoal', secondary: 'metal-black' }],
    ['kitchen-base', 'Konyhai alsószekrény', 'kitchen', 60, 62, 90, { primary: 'wood-cashmere', secondary: 'stone-white-quartz' }],
    ['kitchen-drawers', 'Fiókos alsószekrény', 'kitchen', 80, 62, 90, { primary: 'wood-cashmere', secondary: 'stone-white-quartz' }],
    ['kitchen-sink', 'Mosogatós szekrény', 'kitchen', 80, 62, 90, { primary: 'wood-cashmere', secondary: 'stone-white-quartz' }],
    ['kitchen-hob', 'Főzőlapos szekrény', 'kitchen', 60, 62, 90, { primary: 'wood-cashmere', secondary: 'stone-white-quartz' }],
    ['kitchen-tall', 'Magas konyhaszekrény', 'kitchen', 60, 62, 220, { primary: 'wood-cashmere', secondary: 'metal-steel' }],
    ['fridge', 'Hűtőszekrény', 'kitchen', 60, 66, 186, { primary: 'metal-steel' }],
    ['island', 'Konyhasziget', 'kitchen', 180, 90, 92, { primary: 'wood-sage', secondary: 'stone-marble' }],
    ['bathtub', 'Fürdőkád', 'bathroom', 170, 75, 56, { primary: 'ceramic-white', secondary: 'metal-steel' }],
    ['shower', 'Zuhanytálca üvegfallal', 'bathroom', 90, 90, 200, { primary: 'ceramic-white', secondary: 'metal-black' }],
    ['toilet', 'WC', 'bathroom', 38, 56, 80, { primary: 'ceramic-white' }],
    ['basin', 'Mosdószekrény', 'bathroom', 60, 46, 86, { primary: 'wood-oak-natural', secondary: 'ceramic-white' }],
    ['washer', 'Mosógép', 'bathroom', 60, 58, 85, { primary: 'ceramic-white', secondary: 'metal-steel' }],
    ['rug', 'Szőnyeg 200 × 300', 'rugs', 300, 200, 1, { primary: 'rug-wool-natural' }, { layer: 'floor' }],
    ['rug', 'Szőnyeg 160 × 230', 'rugs', 230, 160, 1, { primary: 'rug-grey' }, { layer: 'floor' }],
    ['rug-round', 'Kerek szőnyeg Ø 160', 'rugs', 160, 160, 1, { primary: 'rug-jute' }, { layer: 'floor' }],
    ['floor-lamp', 'Állólámpa', 'lamps', 40, 40, 160, { primary: 'fabric-cream-boucle', secondary: 'metal-brass' }],
    ['arc-lamp', 'Ívlámpa', 'lamps', 150, 40, 200, { primary: 'metal-brass', secondary: 'stone-marble' }],
    ['table-lamp', 'Asztali lámpa', 'lamps', 25, 25, 45, { primary: 'fabric-oat', secondary: 'ceramic-terracotta' }, { layer: 'top' }],
    ['plant', 'Nagy szobanövény', 'decor', 50, 50, 140, { primary: 'ceramic-terracotta' }],
    ['plant-small', 'Kis szobanövény', 'decor', 30, 30, 45, { primary: 'ceramic-white' }],
    ['tv', 'TV, 55″', 'decor', 123, 8, 72, { primary: 'screen-black' }, { layer: 'top' }],
    ['box', 'Egyedi doboz', 'storage', 100, 50, 80, { primary: 'wood-white' }]
  ];

  const genericProducts = generic.map(([model, name, category, width, depth, height, materials, extra = {}], index) => Object.freeze({
    key: `g-${model}-${index}`,
    model,
    type: model,
    name,
    category,
    width,
    depth,
    height,
    materials: Object.freeze(materials),
    layer: extra.layer || 'main',
    source: 'generic',
    resizable: true,
    dimensionStatus: 'typical'
  }));

  const ikeaModel = product => {
    if (/KALLAX/i.test(product.name)) return 'cube-shelf';
    return ({ sofa: 'sofa', armchair: 'armchair', wardrobe: 'wardrobe', bed: 'bed', table: 'table', coffee: 'coffee-table', chair: 'chair', shelf: 'bookcase' })[product.type] || 'box';
  };
  const ikeaCategory = { sofas: 'sofas', wardrobes: 'wardrobes', beds: 'beds', tables: 'tables', chairs: 'chairs', storage: 'storage' };
  const ikeaMaterials = product => ({
    'KLIPPAN': { primary: 'fabric-mustard', secondary: 'wood-black' },
    'KIVIK': { primary: 'fabric-oat', secondary: 'wood-black' },
    'POÄNG': { primary: 'fabric-cream-boucle', secondary: 'wood-birch-ply' },
    'BRIMNES': { primary: 'wood-white', secondary: 'metal-steel' },
    'PAX': { primary: 'wood-white', secondary: 'metal-steel' },
    'MALM': { primary: 'wood-white', secondary: 'linen-white', tertiary: 'fabric-light-grey' },
    'LISABO': { primary: 'wood-ash', secondary: 'wood-ash' },
    'LACK': { primary: 'wood-black', secondary: 'wood-black' },
    'BILLY': { primary: 'wood-white' },
    'KALLAX': { primary: 'wood-white' }
  })[String(product.name).split(' ')[0]] || { primary: 'wood-white' };

  const ikeaProducts = (Ikea ? Ikea.products : []).map(product => Object.freeze({
    key: `ikea-${product.productId}`,
    ...product,
    model: ikeaModel(product),
    category: ikeaCategory[product.category] || 'storage',
    ikeaCategory: product.category,
    materials: Object.freeze(ikeaMaterials(product)),
    layer: 'main',
    source: 'ikea',
    resizable: false,
    dimensionStatus: 'verified'
  }));

  // 1.x item types → model keys
  const legacyModels = {
    sofa: 'sofa', armchair: 'armchair', bed: 'bed', table: 'table', chair: 'chair', wardrobe: 'wardrobe',
    dresser: 'dresser', rug: 'rug', desk: 'desk', coffee: 'coffee-table', plant: 'plant', lamp: 'floor-lamp',
    shelf: 'bookcase', tv: 'tv', stool: 'stool', bath: 'bathtub', sink: 'basin', custom: 'box'
  };
  const modelKeys = new Set(genericProducts.map(product => product.model));

  const defaults = {};
  for (const product of genericProducts) if (!defaults[product.model]) defaults[product.model] = product;

  function modelFor(item) {
    if (item && item.model && modelKeys.has(item.model)) return item.model;
    if (item && legacyModels[item.type]) return legacyModels[item.type];
    if (item && modelKeys.has(item.type)) return item.type;
    return 'box';
  }

  function defaultMaterials(model) {
    return { ...(defaults[model]?.materials || { primary: 'wood-white' }) };
  }

  function defaultHeight(model) {
    return defaults[model]?.height || 80;
  }

  function layerFor(item) {
    const model = modelFor(item);
    return defaults[model]?.layer || 'main';
  }

  const materialSlots = {
    primary: 'Fő felület',
    secondary: 'Váz / láb / munkalap',
    tertiary: 'Takaró / kiegészítő'
  };

  // Which slots each model actually uses, with model-specific labels.
  const slotLabels = {
    sofa: { primary: 'Kárpit', secondary: 'Láb' },
    sectional: { primary: 'Kárpit', secondary: 'Láb' },
    armchair: { primary: 'Kárpit', secondary: 'Váz' },
    pouf: { primary: 'Kárpit' },
    table: { primary: 'Asztallap', secondary: 'Láb' },
    'table-round': { primary: 'Asztallap', secondary: 'Láb' },
    'coffee-table': { primary: 'Asztallap', secondary: 'Láb' },
    'coffee-round': { primary: 'Felület' },
    'side-table': { primary: 'Asztallap', secondary: 'Láb' },
    chair: { primary: 'Váz', secondary: 'Ülőpárna' },
    'chair-upholstered': { primary: 'Kárpit', secondary: 'Láb' },
    bench: { primary: 'Felület' },
    stool: { primary: 'Ülőlap', secondary: 'Láb' },
    bed: { primary: 'Ágykeret', secondary: 'Ágynemű', tertiary: 'Takaró' },
    'bed-kids': { primary: 'Ágykeret', secondary: 'Ágynemű', tertiary: 'Takaró' },
    crib: { primary: 'Keret', secondary: 'Ágynemű' },
    nightstand: { primary: 'Korpusz', secondary: 'Fogantyú' },
    wardrobe: { primary: 'Front', secondary: 'Fogantyú' },
    bookcase: { primary: 'Korpusz' },
    'cube-shelf': { primary: 'Korpusz' },
    dresser: { primary: 'Front', secondary: 'Fogantyú' },
    sideboard: { primary: 'Front', secondary: 'Láb' },
    'tv-bench': { primary: 'Korpusz', secondary: 'Front' },
    desk: { primary: 'Asztallap', secondary: 'Láb' },
    'office-chair': { primary: 'Kárpit', secondary: 'Váz' },
    'kitchen-base': { primary: 'Front', secondary: 'Munkalap' },
    'kitchen-drawers': { primary: 'Front', secondary: 'Munkalap' },
    'kitchen-sink': { primary: 'Front', secondary: 'Munkalap' },
    'kitchen-hob': { primary: 'Front', secondary: 'Munkalap' },
    'kitchen-tall': { primary: 'Front', secondary: 'Fogantyú' },
    fridge: { primary: 'Felület' },
    island: { primary: 'Front', secondary: 'Munkalap' },
    bathtub: { primary: 'Kád', secondary: 'Csaptelep' },
    shower: { primary: 'Tálca', secondary: 'Profil' },
    toilet: { primary: 'Kerámia' },
    basin: { primary: 'Szekrény', secondary: 'Mosdó' },
    washer: { primary: 'Burkolat', secondary: 'Ajtókeret' },
    rug: { primary: 'Szőnyeg' },
    'rug-round': { primary: 'Szőnyeg' },
    'floor-lamp': { primary: 'Ernyő', secondary: 'Váz' },
    'arc-lamp': { primary: 'Ív', secondary: 'Talp' },
    'table-lamp': { primary: 'Ernyő', secondary: 'Talp' },
    plant: { primary: 'Kaspó' },
    'plant-small': { primary: 'Kaspó' },
    tv: { primary: 'Kijelző' },
    box: { primary: 'Felület' }
  };

  function slotsFor(item) {
    return slotLabels[modelFor(item)] || { primary: materialSlots.primary };
  }

  // Which material groups make sense for a slot
  function slotGroups(model, slot) {
    const label = (slotLabels[model] || {})[slot] || '';
    if (/Kárpit|Ülőpárna|Ernyő|Takaró|Ágynemű/.test(label)) return ['fabric'];
    if (/Munkalap|Mosdó/.test(label)) return ['stone', 'ceramic', 'wood'];
    if (/Láb|Fogantyú|Csaptelep|Profil|Váz|Talp|Ív|Ajtókeret/.test(label)) return ['metal', 'wood'];
    if (/Kerámia|Kád|Tálca|Kaspó/.test(label)) return ['ceramic', 'stone'];
    if (/Szőnyeg/.test(label)) return ['rug'];
    if (/Kijelző/.test(label)) return ['metal'];
    return ['wood', 'stone', 'fabric', 'metal'];
  }

  return Object.freeze({
    categories,
    generic: Object.freeze(genericProducts),
    ikea: Object.freeze(ikeaProducts),
    ikeaVerifiedAt: Ikea ? Ikea.verifiedAt : null,
    all: Object.freeze([...ikeaProducts, ...genericProducts]),
    modelFor,
    defaultMaterials,
    defaultHeight,
    layerFor,
    slotsFor,
    slotGroups,
    materialSlots,
    ikeaModel
  });
});
