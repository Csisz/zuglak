/*
 * Zuglak Studio – AI berendezési asszisztens (Anthropic Claude API).
 *
 * Pure, browser- and Node-compatible helpers:
 *  - buildRoomBrief(): the room (walls, openings, obstacles, current furniture) as
 *    compact JSON in room-relative centimetres, plus the catalogue as a table;
 *  - LAYOUT_TOOL: the `propose_layout` tool the model must call with a complete layout;
 *  - buildLayoutItems(): tool input → ordinary, editable Zuglak furniture items;
 *  - analyzeLayout(): the same overlap / wall / door / pillar checks as the editor;
 *  - runLayoutTurn(): agent loop – sends the request, checks each proposal and asks
 *    the model to fix real problems (max. 2 rounds) before the layout is shown;
 *  - readIkeaProduct(): reads one IKEA Hungary product page with the server-side
 *    web_fetch tool and returns the dimensions for the user to confirm.
 *
 * The API key never leaves the browser except in the request to api.anthropic.com.
 */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  root.ZuglakAI = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const API_VERSION = '2023-06-01';
  const KEY_STORAGE = 'zuglak-ai-key';
  const STATE_STORAGE = 'zuglak-ai-v1';

  // Prices in USD per million tokens (platform.claude.com, checked 2026-10-17).
  const MODELS = Object.freeze([
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 – ajánlott', input: 2, output: 10 },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 – legalaposabb', input: 4, output: 20 }
  ]);
  const DEFAULT_MODEL = MODELS[0].id;

  const CUSTOM_MODELS = Object.freeze([
    'box', 'bed', 'bed-kids', 'crib', 'nightstand', 'wardrobe', 'dresser', 'bookcase', 'cube-shelf', 'desk',
    'office-chair', 'chair', 'table', 'table-round', 'sofa', 'armchair', 'pouf', 'bench', 'rug', 'rug-round',
    'side-table', 'coffee-table', 'tv-bench', 'sideboard', 'floor-lamp', 'plant'
  ]);

  const round = value => Math.round(Number(value) * 10) / 10;
  const pt = point => [round(point.x), round(point.y)];

  // ------------------------------------------------------------------ room brief
  function sideName(inward) {
    if (Math.abs(inward.y) > 0.95) return inward.y > 0 ? 'felső (észak)' : 'alsó (dél)';
    if (Math.abs(inward.x) > 0.95) return inward.x > 0 ? 'bal (nyugat)' : 'jobb (kelet)';
    return 'ferde';
  }
  /** Rotation that turns the back of a piece (local y = 0 side) towards the wall. */
  function backToWallRotation(inward) {
    const back = { x: -inward.x, y: -inward.y };
    const degrees = Math.atan2(back.x, -back.y) * 180 / Math.PI;
    return Math.round(((degrees % 360) + 360) % 360);
  }
  function bbox(points, base) {
    const xs = points.map(p => p.x - base.x);
    const ys = points.map(p => p.y - base.y);
    return { x1: round(Math.min(...xs)), y1: round(Math.min(...ys)), x2: round(Math.max(...xs)), y2: round(Math.max(...ys)) };
  }

  function describeItem(item, base, Geometry, Catalog) {
    const center = Geometry.itemCenter(item);
    return {
      id: item.id,
      nev: item.name,
      tipus: Catalog ? Catalog.modelFor(item) : item.model,
      meret: `${round(item.w)} × ${round(item.h)}${item.height ? ` × ${round(item.height)}` : ''} cm`,
      kozeppont: pt({ x: center.x - base.x, y: center.y - base.y }),
      forgatas: round(item.rot || 0),
      forras: item.source === 'ikea' ? `IKEA ${item.productId || ''}`.trim() : item.dimensionStatus === 'user' ? 'saját méret' : 'tipikus méret'
    };
  }

  /**
   * @param {object} p { roomName, geom, items, Geometry, Catalog }
   * @returns {{ base:{x,y}, brief:object, text:string }}
   */
  function buildRoomBrief(p) {
    const { geom, Geometry } = p;
    if (!geom || !geom.vertices || geom.vertices.length < 3) throw new Error('A helyiségnek nincs zárt alaprajza.');
    const vertices = geom.vertices;
    const bounds = Geometry.polygonBounds(vertices);
    const base = { x: bounds.minX, y: bounds.minY };
    const rel = point => ({ x: point.x - base.x, y: point.y - base.y });
    const walls = [];
    for (let index = 0; index < vertices.length; index += 1) {
      const frame = Geometry.wallFrame(vertices, index, 0);
      if (!frame) continue;
      walls.push({
        fal: index + 1,
        tol: pt(rel(frame.start)),
        ig: pt(rel(frame.end)),
        hossz: round(frame.length),
        oldal: sideName(frame.inward),
        hattal_a_falnak_forgatas: backToWallRotation(frame.inward)
      });
    }
    const openings = [];
    for (const object of geom.objects || []) {
      const seg = Geometry.openingSegment(object, vertices);
      if (!seg) continue;
      const entry = {
        tipus: { door: 'ajtó', window: 'ablak', opening: 'faláttörés', radiator: 'radiátor' }[object.type] || object.type,
        fal: object.wallIndex + 1,
        tol: pt(rel(seg.a)),
        ig: pt(rel(seg.b)),
        szelesseg: round(object.width)
      };
      if (object.type === 'door') {
        const swing = Geometry.doorClearancePolygon(object, vertices);
        entry.nyitasi_ter = swing.length ? bbox(swing, base) : null;
        entry.nyilas = object.swing === 'out' ? 'kifelé' : 'befelé';
        entry.megjegyzes = 'Az ajtó nyitási területe és az ajtó előtti 80 cm-es sáv maradjon szabad.';
      }
      if (object.type === 'window') {
        entry.parapet = object.sill != null ? round(object.sill) : null;
        entry.megjegyzes = 'Ablak elé csak a parapetnél alacsonyabb bútor kerüljön.';
      }
      if (object.type === 'radiator') {
        entry.terulet = bbox(Geometry.radiatorPolygon(object, vertices), base);
        entry.megjegyzes = 'A radiátor elé ne kerüljön zárt, magas bútor vagy ágy szorosan.';
      }
      if (object.type === 'opening') entry.megjegyzes = 'Átjáró: maradjon szabad.';
      openings.push(entry);
    }
    const obstacles = (geom.partitions || []).map(part => {
      if (part.thickness) return { nev: part.name || 'pillér / kémény', terulet: bbox(Geometry.partitionPolygon(part), base), magassag: part.height || null };
      return { nev: part.name || 'falcsonk', vonal: [pt(rel(part.a)), pt(rel(part.b))] };
    });
    const area = Math.abs(Geometry.signedArea ? Geometry.signedArea(vertices) : 0) / 10000;
    const brief = {
      helyiseg: p.roomName,
      koordinatak: 'cm; x jobbra nő, y lefelé nő; (0,0) a befoglaló téglalap bal felső sarka',
      befoglalo: { szelesseg: round(bounds.maxX - bounds.minX), melyseg: round(bounds.maxY - bounds.minY) },
      alapterulet_m2: round(area),
      sokszog: vertices.map(v => pt(rel(v))),
      falak: walls,
      nyilaszarok: openings,
      akadalyok: obstacles,
      jelenlegi_butorok: (p.items || []).map(item => describeItem(item, base, Geometry, p.Catalog))
    };
    return { base, brief, text: JSON.stringify(brief) };
  }

  function catalogTable(products) {
    const lines = ['key | név | kategória | szélesség × mélység × magasság (cm) | méretforrás'];
    for (const product of products) {
      lines.push(`${product.key} | ${product.name} | ${product.category || ''} | ${round(product.width)} × ${round(product.depth)} × ${product.height ? round(product.height) : '?'} | ${product.source === 'ikea' ? 'IKEA, ellenőrzött' : 'tipikus'}`);
    }
    return lines.join('\n');
  }

  function currentStateText(brief) {
    return `Az aktív változat jelenlegi bútorai (a felhasználó kézzel is módosíthatta őket):\n${JSON.stringify(brief.jelenlegi_butorok)}`;
  }

  // ------------------------------------------------------------------ prompt & tool
  const SYSTEM_PROMPT = `Te a Zuglak Studio beépített lakberendező asszisztense vagy. Egy budapesti család saját otthonának helyiségeit rendezed be, centiméterpontos alaprajz alapján. Mindig magyarul válaszolj, tegezve, tömören és barátságosan.

FELADAT
A felhasználó leírja, kinek és mire készül a helyiség. Te konkrét, megvalósítható bútorelrendezést adsz a propose_layout eszközzel. Az elrendezés a programban szerkeszthető berendezési változat lesz: minden bútor húzható, forgatható, törölhető.

KOORDINÁTÁK
- Minden méret cm. x jobbra, y lefelé nő; (0,0) a helyiség befoglaló téglalapjának bal felső sarka.
- A bútort a KÖZÉPPONTJÁVAL (center_x, center_y) és forgatásával (rotation, fok, az óramutató járásával egyezően) adod meg.
- Forgatás 0: a bútor szélessége az x tengellyel párhuzamos, a HÁTOLDALA felfelé (kisebb y felé) néz, az eleje lefelé. 90: háttal jobbra (kelet). 180: háttal lefelé. 270: háttal balra (nyugat).
- A „falak” listában minden falnál megadtam a „hattal_a_falnak_forgatas” értéket: ezzel a forgatással áll a bútor háttal az adott falnak (ágy fejvége, szekrény, kanapé háta, íróasztal hátsó éle).
- Falhoz tolt bútor középpontja: a fal koordinátája ± mélység/2 (90°/270° forgatásnál a szélesség és a mélység szerepe az x/y tengelyen felcserélődik). Hagyj 1 cm-t a fal és a bútor között, hogy kerekítés miatt se lógjon ki.
- A helyiség nem feltétlenül téglalap: a „sokszog” a pontos belső kontúr. Kiugrások, kémények, pillérek („akadalyok”) területére nem tehetsz bútort.

BÚTOROK
- Elsősorban a katalógus elemeit használd (product_key). Az IKEA-elemek méretei ellenőrzöttek, a többi tipikus tervezési méret.
- Ha szükséges elem nincs a katalógusban (pl. emeletes ágy, galériaágy, gyerek íróasztal), használd a custom mezőt reális, tipikus méretekkel és a legközelebbi megjelenéssel (model). Soha ne találj ki IKEA-cikkszámot vagy IKEA-terméknevet.
- A már a szobában lévő, megtartandó bútorokat az existing_id mezővel hivatkozd; így a felhasználó beállításai (anyag, méret) megmaradnak.
- Az items lista a TELJES elrendezés: ami nincs benne, az kikerül a változatból.
- A name mezővel adhatsz beszédes nevet (pl. „Ágy – nagyobbik lány”).

TERVEZÉSI ELVEK
- Fő közlekedési útvonal legalább 80 cm, mellékútvonal legalább 60 cm. Az ajtó nyitási íve és az ablakok, erkélyajtók előtere szabad.
- Ágy: legalább az egyik hosszanti oldala szabadon megközelíthető (≥ 60 cm), a fejvége lehetőleg tömör falnál, ne radiátor előtt és ne közvetlenül az ablak alatt.
- Szekrény ajtaja / fiókja előtt legalább 70–80 cm szabad hely.
- Íróasztal lehetőleg az ablak közelében, oldalról érkező fénnyel; szék mögött legalább 70 cm.
- Magas bútor (> parapetmagasság) ne kerüljön ablak elé.
- Gyerekszoba: minden gyereknek legyen saját alvó- és tárolóhelye, maradjon egybefüggő szabad játszófelület; magas bútort falhoz rögzítésre jelölj; emeletes ágy felső szintje 6 éves kor alatt nem ajánlott; a KRITTER ágynál az ágy és a fal közötti rés legyen 6,5 cm-nél kisebb vagy 23 cm-nél nagyobb.
- Szőnyeg (rug) alá nyúlhat más bútor, asztali lámpa bútorra kerülhet, szék betolható asztal / íróasztal alá. Minden más bútor ne fedje egymást.

VÁLASZ MÓDJA
1. Ha a kérés lényegesen hiányos (pl. nem derül ki a gyerekek kora, és az ágytípus múlik rajta), tegyél fel EGY rövid kérdést, eszközhívás nélkül.
2. Különben írj 2–4 mondatos magyarázatot a koncepcióról, majd hívd meg a propose_layout eszközt. A koordinátákat ne a szövegben számold végig; a reason mezők legyenek rövidek (legfeljebb 8 szó). Az eszköz ellenőrzi az ütközéseket; ha hibát jelez, javítsd és hívd újra.
3. Módosítási kérésnél csak azt változtasd, amit kértek; a többi bútor maradjon a helyén (existing_id, ugyanazok a koordináták).
4. Ha a felhasználó új alternatívát kér, állítsd a new_variant mezőt true-ra.`;

  const LAYOUT_TOOL = Object.freeze({
    name: 'propose_layout',
    description: 'Teljes bútorelrendezés a helyiségre. A program ellenőrzi (falon kilógás, bútorátfedés, ajtónyitás, pillér), és ha rendben van, szerkeszthető berendezési változatként jeleníti meg.',
    input_schema: {
      type: 'object',
      properties: {
        variant_name: { type: 'string', description: 'Rövid magyar név a változatnak, pl. „AI – három lány, tanulósarok”.' },
        new_variant: { type: 'boolean', description: 'true: új változatként mentse (alternatíva). false/hiányzik: a beszélgetés aktuális AI-változatát módosítja.' },
        summary: { type: 'string', description: 'Egy-két mondatos összefoglaló a koncepcióról.' },
        items: {
          type: 'array',
          description: 'A helyiség TELJES bútorlistája.',
          items: {
            type: 'object',
            properties: {
              existing_id: { type: 'string', description: 'Meglévő bútor azonosítója (jelenlegi_butorok.id), ha azt helyezed el.' },
              product_key: { type: 'string', description: 'Katalóguselem kulcsa (key oszlop), ha új bútort teszel be.' },
              custom: {
                type: 'object',
                description: 'Katalógusban nem szereplő bútor tipikus méretekkel.',
                properties: {
                  name: { type: 'string' },
                  model: { type: 'string', enum: CUSTOM_MODELS },
                  width: { type: 'number', description: 'cm' },
                  depth: { type: 'number', description: 'cm' },
                  height: { type: 'number', description: 'cm' }
                },
                required: ['name', 'model', 'width', 'depth']
              },
              name: { type: 'string', description: 'Opcionális megjelenített név.' },
              center_x: { type: 'number' },
              center_y: { type: 'number' },
              rotation: { type: 'number', description: 'fok, 0/90/180/270 ajánlott' },
              reason: { type: 'string', description: 'Fél mondat: miért ide került.' }
            },
            required: ['center_x', 'center_y', 'rotation']
          }
        }
      },
      required: ['summary', 'items']
    }
  });

  // ------------------------------------------------------------------ build & check
  const SEATING = new Set(['chair', 'chair-upholstered', 'stool', 'office-chair', 'bench', 'pouf']);
  const TABLES = new Set(['table', 'table-round', 'desk', 'island', 'coffee-table', 'coffee-round', 'side-table']);

  /**
   * Tool input → editable items.
   * deps: { base, existingItems, productByKey, Core, Catalog, Geometry, idFactory, keepIds }
   */
  function buildLayoutItems(input, deps) {
    const { base, Core, Catalog, Geometry, idFactory } = deps;
    const errors = [];
    const items = [];
    const used = new Set();
    const list = Array.isArray(input?.items) ? input.items : [];
    if (!list.length) errors.push('Az items lista üres.');
    list.forEach((entry, index) => {
      const label = `${index + 1}. elem`;
      const cx = Number(entry.center_x);
      const cy = Number(entry.center_y);
      const rot = ((Math.round(Number(entry.rotation) || 0) % 360) + 360) % 360;
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) { errors.push(`${label}: hiányzó vagy hibás középpont.`); return; }
      let item = null;
      try {
        if (entry.existing_id) {
          const existing = (deps.existingItems || []).find(value => value.id === entry.existing_id);
          if (!existing) { errors.push(`${label}: ismeretlen existing_id „${entry.existing_id}”.`); return; }
          if (used.has(existing.id)) { errors.push(`${label}: a(z) „${existing.name}” kétszer szerepel.`); return; }
          used.add(existing.id);
          item = JSON.parse(JSON.stringify(existing));
          if (!deps.keepIds) item.id = idFactory();
        } else if (entry.product_key) {
          const product = deps.productByKey(entry.product_key);
          if (!product) { errors.push(`${label}: ismeretlen product_key „${entry.product_key}”. Csak a katalógus key oszlopából választhatsz, vagy használd a custom mezőt.`); return; }
          item = product.source === 'ikea'
            ? Core.createFurnitureItem({ ...product }, { x: 0, y: 0 }, idFactory)
            : Core.createGenericItem(product, { x: 0, y: 0 }, idFactory);
          if (product.source === 'ikea') { item.model = product.model || Catalog.ikeaModel(product); item.materials = { ...(product.materials || {}) }; }
          item.materials = { ...Catalog.defaultMaterials(item.model), ...(item.materials || {}) };
        } else if (entry.custom) {
          const c = entry.custom;
          const model = CUSTOM_MODELS.includes(c.model) ? c.model : 'box';
          item = Core.createGenericItem({ name: c.name, model, width: c.width, depth: c.depth, height: c.height, category: 'storage', source: 'custom' }, { x: 0, y: 0 }, idFactory);
          item.dimensionStatus = 'typical';
          item.source = 'generic';
          item.aiSuggested = true;
          item.materials = { ...Catalog.defaultMaterials(model) };
        } else {
          errors.push(`${label}: existing_id, product_key vagy custom megadása kötelező.`);
          return;
        }
      } catch (error) {
        errors.push(`${label}: ${error.message}`);
        return;
      }
      if (entry.name && String(entry.name).trim()) item.name = String(entry.name).trim().slice(0, 80);
      item.rot = rot;
      const corner = Geometry.cornerForCenter(item, { x: base.x + cx, y: base.y + cy }, rot);
      item.x = corner.x;
      item.y = corner.y;
      items.push({ item, reason: entry.reason ? String(entry.reason) : '' });
    });
    return { items: items.map(value => value.item), reasons: items.map(value => value.reason), errors };
  }

  /** Same checks as the editor's warning list (without the optional clearance zone). */
  function analyzeLayout(items, geom, deps) {
    const { Geometry, Catalog } = deps;
    const issues = [];
    const seen = new Set();
    const solids = items.filter(item => Catalog.layerFor(item) === 'main');
    const compatible = (p, q) => (SEATING.has(Catalog.modelFor(p)) && TABLES.has(Catalog.modelFor(q))) || (SEATING.has(Catalog.modelFor(q)) && TABLES.has(Catalog.modelFor(p)));
    for (const item of items) {
      const layer = Catalog.layerFor(item);
      const others = layer === 'main' ? solids.filter(other => !compatible(item, other)) : [];
      const scope = layer === 'main' ? geom : (geom ? { ...geom, objects: [], partitions: [] } : null);
      for (const warning of Geometry.analyzePlacement(item, others, scope, { clearance: 0 })) {
        if (warning.type === 'boundary' && layer === 'top') continue;
        const other = items.find(value => value.id === warning.id);
        const key = warning.type === 'furniture' ? `f-${[item.id, warning.id].sort().join('-')}` : `${warning.type}-${item.id}-${warning.id || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const text = {
          furniture: `„${item.name}” és „${other?.name || 'bútor'}” átfedésben van`,
          boundary: `„${item.name}” kilóg a falon túlra (vagy egy kiugrásba lóg)`,
          door: `„${item.name}” az ajtó nyitási területébe ér`,
          partition: `„${item.name}” pillérbe / kéménybe / falcsonkba ér`
        }[warning.type];
        if (text) issues.push({ type: warning.type, text, ids: [item.id, warning.id].filter(Boolean) });
      }
    }
    return issues;
  }

  function issueReport(built, issues, base, Geometry) {
    const lines = [];
    built.errors.forEach(error => lines.push(`HIBA: ${error}`));
    for (const issue of issues) {
      const details = issue.ids.map(id => built.items.find(item => item.id === id)).filter(Boolean).map(item => {
        const corners = Geometry.rotatedRectCorners(item).map(p => `(${round(p.x - base.x)}, ${round(p.y - base.y)})`).join(' ');
        return `„${item.name}” sarkai: ${corners}`;
      });
      lines.push(`ÜTKÖZÉS: ${issue.text}. ${details.join('; ')}`);
    }
    return lines.join('\n');
  }

  // ------------------------------------------------------------------ API client
  class AiError extends Error {
    constructor(message, status) { super(message); this.name = 'AiError'; this.status = status; }
  }

  function friendlyError(status, body) {
    const raw = body?.error?.message || '';
    if (/credit balance/i.test(raw)) return 'Az Anthropic-fiókodon elfogyott a keret. Tölts fel egyenleget a console.anthropic.com oldalon (Billing).';
    if (status === 401) return 'Érvénytelen API-kulcs. Ellenőrizd, hogy a teljes kulcsot másoltad-e be (sk-ant-… kezdetű).';
    if (status === 403) return 'Ez a kulcs nem használhatja ezt a modellt vagy funkciót.';
    if (status === 404) return 'A kiválasztott modell nem érhető el ezzel a kulccsal. Válassz másik modellt a beállításokban.';
    if (status === 413) return 'A kérés túl nagy. Kezdj új beszélgetést.';
    if (status === 429) return 'Túl sok kérés vagy elérted a kulcs korlátját. Várj egy percet, és próbáld újra.';
    if (status === 529 || status >= 500) return 'Az Anthropic szolgáltatás most túlterhelt vagy nem elérhető. Próbáld újra kicsit később.';
    if (status === 400) return `Az API elutasította a kérést: ${raw || 'ismeretlen ok'}`;
    return `Váratlan API-hiba (${status}). ${raw}`;
  }

  const STREAM_ERRORS = { overloaded_error: 529, rate_limit_error: 429, api_error: 500, authentication_error: 401, permission_error: 403, invalid_request_error: 400, not_found_error: 404, request_too_large: 413 };

  /** Folds Messages-API server-sent events into the same object a non-streaming call returns. */
  async function readEventStream(body, onProgress) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let message = null;
    const partial = new Map();
    const handle = event => {
      switch (event.type) {
        case 'message_start':
          message = { ...event.message, content: [] };
          break;
        case 'content_block_start': {
          const block = JSON.parse(JSON.stringify(event.content_block));
          if (block.type === 'tool_use' || block.type === 'server_tool_use') partial.set(event.index, '');
          message.content[event.index] = block;
          onProgress?.({ phase: block.type === 'thinking' || block.type === 'redacted_thinking' ? 'thinking' : block.type === 'text' ? 'text' : 'tool', block });
          break;
        }
        case 'content_block_delta': {
          const block = message.content[event.index];
          const delta = event.delta || {};
          if (delta.type === 'text_delta') block.text = (block.text || '') + delta.text;
          else if (delta.type === 'thinking_delta') block.thinking = (block.thinking || '') + delta.thinking;
          else if (delta.type === 'signature_delta') block.signature = delta.signature;
          else if (delta.type === 'input_json_delta') partial.set(event.index, (partial.get(event.index) || '') + delta.partial_json);
          else if (delta.type === 'citations_delta') (block.citations || (block.citations = [])).push(delta.citation);
          onProgress?.({ phase: block.type === 'thinking' ? 'thinking' : block.type === 'text' ? 'text' : 'tool', block, json: partial.get(event.index) });
          break;
        }
        case 'content_block_stop': {
          const block = message.content[event.index];
          if (partial.has(event.index)) {
            const raw = partial.get(event.index);
            try { block.input = raw ? JSON.parse(raw) : {}; } catch { block.input = {}; block.incomplete = true; }
            partial.delete(event.index);
          }
          break;
        }
        case 'message_delta':
          Object.assign(message, event.delta || {});
          if (event.usage) message.usage = { ...(message.usage || {}), ...event.usage };
          break;
        case 'error': {
          const type = event.error?.type;
          throw new AiError(friendlyError(STREAM_ERRORS[type] || 500, event), STREAM_ERRORS[type] || 500);
        }
        default: break; // ping, message_stop and future event types
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let cut;
      while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const raw = buffer.slice(0, cut);
        buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '');
        const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        let event;
        try { event = JSON.parse(data); } catch { continue; }
        handle(event);
      }
      if (done) break;
    }
    if (!message) throw new AiError('Értelmezhetetlen válasz érkezett az API-tól.');
    // Blocks still open when the stream ended (e.g. max_tokens) are marked incomplete.
    for (const [index] of partial) { message.content[index].input = {}; message.content[index].incomplete = true; }
    message.content = message.content.filter(Boolean);
    return message;
  }

  async function callClaude(options) {
    const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) throw new AiError('A böngésző nem támogatja a hálózati kérést.');
    if (!options.apiKey) throw new AiError('Nincs megadva Anthropic API-kulcs.');
    const body = {
      model: options.model || DEFAULT_MODEL,
      max_tokens: options.maxTokens || 16000,
      system: options.system,
      messages: options.messages,
      stream: options.stream !== false
    };
    if (options.tools) body.tools = options.tools;
    if (options.toolChoice) body.tool_choice = options.toolChoice;
    if (options.effort) body.output_config = { effort: options.effort };
    let response;
    try {
      response = await fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body),
        signal: options.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new AiError('Megszakítva.', 'aborted');
      throw new AiError('Nem sikerült elérni az Anthropic API-t. Van internetkapcsolat?', 'network');
    }
    if (!response.ok) {
      let json = null;
      try { json = await response.json(); } catch { json = null; }
      throw new AiError(friendlyError(response.status, json), response.status);
    }
    const isStream = body.stream && response.body && typeof response.body.getReader === 'function' && !/application\/json/.test(response.headers?.get?.('content-type') || '');
    let json;
    try {
      json = isStream ? await readEventStream(response.body, options.onProgress) : await response.json();
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (error?.name === 'AbortError' || options.signal?.aborted) throw new AiError('Megszakítva.', 'aborted');
      throw new AiError('A kapcsolat megszakadt válasz közben. Próbáld újra.', 'network');
    }
    if (!json || !Array.isArray(json.content)) throw new AiError('Értelmezhetetlen válasz érkezett az API-tól.');
    return json;
  }

  function costOf(usage, modelId) {
    const model = MODELS.find(value => value.id === modelId) || MODELS[0];
    if (!usage) return 0;
    const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
    return (input * model.input + (usage.output_tokens || 0) * model.output) / 1e6;
  }
  function addUsage(total, usage) {
    if (!usage) return total;
    for (const key of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) total[key] = (total[key] || 0) + (usage[key] || 0);
    return total;
  }

  function systemBlocks(catalogText) {
    return [
      { type: 'text', text: SYSTEM_PROMPT },
      { type: 'text', text: `KATALÓGUS (product_key = key oszlop):\n${catalogText}`, cache_control: { type: 'ephemeral' } }
    ];
  }

  /**
   * One user turn of the layout conversation.
   * options: { apiKey, model, fetch, signal, catalogText, messages (mutated: API history),
   *            userContent (string|blocks), evaluate(input) → { built, issues, report },
   *            maxFixes = 2, onStatus(text) }
   * Returns { text, proposal: { input, built, issues } | null, usage, cost, pendingToolUseIds }.
   */
  async function runLayoutTurn(options) {
    const messages = options.messages;
    const pending = options.pendingToolUseIds || [];
    const content = [];
    pending.forEach(id => content.push({ type: 'tool_result', tool_use_id: id, content: 'Az elrendezést alkalmaztuk; a felhasználó azóta szerkeszthette. A jelenlegi állapotot lásd lent.' }));
    if (typeof options.userContent === 'string') content.push({ type: 'text', text: options.userContent });
    else content.push(...options.userContent);
    messages.push({ role: 'user', content });
    const usage = {};
    const texts = [];
    let lastProposal = null;
    let fixes = 0;
    let shortened = false;
    let effort = options.effort;
    const maxFixes = options.maxFixes ?? 2;
    const finish = (proposal, pendingToolUseIds) => ({ text: texts.join('\n\n'), proposal, usage, cost: costOf(usage, options.model), pendingToolUseIds, fixes, shortened });
    for (let attempt = 0; attempt < maxFixes + 4; attempt += 1) {
      options.onStatus?.(fixes ? 'Az AI javítja az ütközéseket…' : shortened ? 'Az AI tömörebben újrapróbálja…' : 'Az AI tervez…');
      const response = await callClaude({
        apiKey: options.apiKey, model: options.model, fetch: options.fetch, signal: options.signal,
        system: systemBlocks(options.catalogText), messages, tools: [LAYOUT_TOOL],
        maxTokens: options.maxTokens || 32000, effort, onProgress: options.onProgress
      });
      addUsage(usage, response.usage);
      if (response.stop_reason === 'max_tokens') {
        // The truncated turn (incomplete thinking / tool call) is dropped, not sent back.
        if (shortened) throw new AiError('A válasz kétszer is túl hosszú lett. Kérj egyszerre kevesebb változtatást, vagy kezdj új beszélgetést.');
        shortened = true;
        effort = 'low';
        const last = messages[messages.length - 1];
        const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...last.content];
        blocks.push({ type: 'text', text: 'FONTOS: az előző válaszod túl hosszú lett és megszakadt. Most gondolkodj röviden, a magyarázat legfeljebb 2 mondat, a reason mezők legfeljebb 6 szavasak, és azonnal hívd meg a propose_layout eszközt.' });
        last.content = blocks;
        continue;
      }
      messages.push({ role: 'assistant', content: response.content });
      response.content.filter(block => block.type === 'text' && block.text.trim()).forEach(block => texts.push(block.text.trim()));
      const toolUses = response.content.filter(block => block.type === 'tool_use');
      if (!toolUses.length) return finish(lastProposal, []);
      const layoutUse = toolUses.filter(use => use.name === LAYOUT_TOOL.name && !use.incomplete).at(-1);
      const evaluation = layoutUse ? options.evaluate(layoutUse.input) : null;
      if (evaluation) lastProposal = { input: layoutUse.input, built: evaluation.built, issues: evaluation.issues };
      const hard = evaluation ? evaluation.built.errors.length > 0 || evaluation.issues.length > 0 : true;
      if (hard && fixes < maxFixes) {
        fixes += 1;
        messages.push({
          role: 'user',
          content: toolUses.map(use => ({
            type: 'tool_result',
            tool_use_id: use.id,
            is_error: use !== layoutUse || evaluation.built.errors.length > 0,
            content: use !== layoutUse
              ? 'Ismeretlen vagy hiányos eszközhívás.'
              : `Az elrendezés ellenőrzése problémákat talált. Javítsd őket, és hívd újra a propose_layout eszközt a TELJES listával (a magyarázatot nem kell megismételni):\n${evaluation.report}`
          }))
        });
        continue;
      }
      return finish(evaluation ? lastProposal : null, toolUses.map(use => use.id));
    }
    throw new AiError('Az AI nem tudott érvényes elrendezést adni. Próbáld pontosítani a kérést.');
  }

  // ------------------------------------------------------------------ IKEA page reading
  const IKEA_TOOL = Object.freeze({
    name: 'report_product',
    description: 'A beolvasott IKEA termékoldal adatai.',
    input_schema: {
      type: 'object',
      properties: {
        found: { type: 'boolean', description: 'false, ha az oldal nem olvasható vagy nincs rajta méret.' },
        name: { type: 'string', description: 'Terméknév az oldal szerint, magyarul.' },
        product_id: { type: 'string', description: 'Cikkszám 000.000.00 formában.' },
        width: { type: 'number', description: 'Szélesség cm – elölről nézve a bal–jobb méret; ágynál az ágy szélessége.' },
        depth: { type: 'number', description: 'Mélység cm – elölről hátrafelé; ágynál az ágy hossza.' },
        height: { type: 'number', description: 'Magasság cm (ágynál a fejvég magassága). Hagyd ki, ha nincs az oldalon.' },
        category: { type: 'string', enum: ['sofas', 'wardrobes', 'beds', 'tables', 'chairs', 'storage'] },
        notes: { type: 'string', description: 'Rövid megjegyzés (pl. biztonsági távolság, matracméret).' }
      },
      required: ['found']
    }
  });

  async function readIkeaProduct(options) {
    const url = String(options.url || '');
    if (!/^https:\/\/www\.ikea\.com\/hu\/hu\/p\//.test(url)) throw new AiError('Csak IKEA Hungary terméklink olvasható be.');
    const messages = [{
      role: 'user',
      content: `Olvasd be ezt az IKEA Hungary termékoldalt a web_fetch eszközzel: ${url}\nKeresd meg a termék „Méretek” részét, és hívd meg a report_product eszközt. Csak az oldalon ténylegesen szereplő számokat add meg, ne becsülj. Ha egy méret hiányzik, hagyd ki.`
    }];
    const usage = {};
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await callClaude({
        apiKey: options.apiKey, model: options.model, fetch: options.fetch, signal: options.signal,
        system: 'IKEA termékoldalról pontos méreteket olvasol ki. Magyarul válaszolsz.',
        messages,
        tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 2, allowed_domains: ['www.ikea.com'], max_content_tokens: 40000 }, IKEA_TOOL],
        maxTokens: 16000, effort: 'low'
      });
      addUsage(usage, response.usage);
      const report = response.content.find(block => block.type === 'tool_use' && block.name === IKEA_TOOL.name);
      if (report) {
        const input = report.input || {};
        if (!input.found) throw new AiError(input.notes || 'Az AI nem talált méreteket a termékoldalon.');
        const fix = value => (Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 5000 ? round(value) : null);
        return {
          name: String(input.name || '').trim(),
          productId: String(input.product_id || '').trim(),
          width: fix(input.width), depth: fix(input.depth), height: fix(input.height),
          category: input.category || null,
          notes: String(input.notes || '').trim(),
          usage, cost: costOf(usage, options.model)
        };
      }
      if (response.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: response.content }); continue; }
      const fetchError = response.content.find(block => block.type === 'web_fetch_tool_result' && block.content?.type === 'web_fetch_tool_result_error');
      if (fetchError) throw new AiError(`Az IKEA oldal nem olvasható be (${fetchError.content.error_code}). Add meg a méreteket kézzel.`);
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: 'Hívd meg a report_product eszközt a talált adatokkal (vagy found: false).' });
    }
    throw new AiError('Az AI nem adott vissza méreteket. Add meg őket kézzel.');
  }

  // ------------------------------------------------------------------ storage helpers
  function loadKey(storage) { try { return storage.getItem(KEY_STORAGE) || ''; } catch { return ''; } }
  function saveKey(storage, key) {
    const clean = String(key || '').trim();
    try { clean ? storage.setItem(KEY_STORAGE, clean) : storage.removeItem(KEY_STORAGE); } catch { /* storage full or blocked */ }
    return clean;
  }
  function looksLikeKey(key) { return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(String(key || '').trim()); }
  function loadState(storage) {
    try {
      const parsed = JSON.parse(storage.getItem(STATE_STORAGE) || 'null');
      if (parsed && typeof parsed === 'object' && parsed.chats) return parsed;
    } catch { /* ignore */ }
    return { model: DEFAULT_MODEL, chats: {} };
  }
  function saveState(storage, state) {
    try { storage.setItem(STATE_STORAGE, JSON.stringify(state)); return true; } catch { return false; }
  }
  function emptyChat() { return { api: [], log: [], variants: [], pending: [] }; }

  return Object.freeze({
    API_URL, MODELS, DEFAULT_MODEL, CUSTOM_MODELS, SYSTEM_PROMPT, LAYOUT_TOOL, IKEA_TOOL,
    AiError, buildRoomBrief, catalogTable, currentStateText, backToWallRotation, buildLayoutItems,
    analyzeLayout, issueReport, callClaude, runLayoutTurn, readIkeaProduct, costOf,
    loadKey, saveKey, looksLikeKey, loadState, saveState, emptyChat
  });
});
