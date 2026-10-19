/*
 * Zuglak Studio 2.0 – the three original floor plans of this home.
 *
 * Source of truth: the hand-dimensioned drawings in assets/alaprajz-*.png.
 * The drawings are NOT drawn to a uniform scale, and several written dimensions
 * contradict each other (see `review`). Therefore:
 *   - `trace` contains the wall vertices as image pixels, traced from the thick
 *     wall strokes of the drawing (automated skeleton trace, hand-checked).
 *   - `label` is the length written on the drawing for that wall, if any.
 *     These are the owner's measurements, but they are NOT applied automatically
 *     because together they do not form a closed room outline.
 *   - Every wall of a traced draft starts as "≈ estimated". Applying a written
 *     value is an explicit user action in the Walls panel.
 * Edge `i` runs from trace[i] to trace[(i + 1) % n]. `open: true` means the
 * drawing shows no wall there (passage / gap); it is rendered as an opening.
 */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  root.ZuglakFloorplans = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const plans = [
    {
      id: 'room1',
      name: 'Lányszoba – SZOBA III.',
      url: 'assets/alaprajz-1.png',
      imageSize: { width: 1122, height: 1402 },
      pxPerCm: 884 / 440,
      reference: { x1: 83, y1: 1141, x2: 967, y2: 1141, cm: 440, label: 'Alsó fal · 440 cm' },
      trace: [
        [85, 1160], [984, 1160], [984, 150], [472, 150], [472, 470],
        [375, 486], [375, 897], [249, 897], [249, 994], [85, 994]
      ],
      edges: [
        { label: 440 }, { label: 440 }, { label: 220 }, { label: 219 },
        { label: 41, open: true, note: 'A rajzon nincs fal ezen a 41 cm-es szakaszon.' },
        { label: 220 }, { label: 63 }, { label: 63 }, { label: 101 },
        { note: 'Nincs összesített méret; a rajz csak 5 és 10 cm-es jelöléseket mutat.' }
      ],
      partitions: [],
      openings: [],
      // Architectural plan (assets/tervrajz-szoba-1.png, "SZOBA III. szalagparketta 18,27 m²").
      // Coordinates in cm; x = 0 at the corridor wall, y = 0 at the top wall (inner faces).
      // `label`: dimension written on the architectural plan; `measured`: hand-measured value
      // from the owner's sketch; `confirmed`: the length is written on the plan itself.
      planGeometry: {
        source: 'assets/tervrajz-szoba-1.png',
        // Underlay: the plan image at 107,5 px/m; the room's corridor-wall/top-wall corner is at (177, 70) px.
        underlay: { url: 'assets/tervrajz-szoba-1.png', pxPerCm: 1.075, originPx: [177, 70] },
        planArea: 18.27,
        vertices: [[206, 0], [456, 0], [456, 600], [0, 600], [0, 486], [60, 486], [60, 500], [104, 500], [104, 425], [161, 425], [161, 225], [206, 225]],
        walls: [
          { label: 250, measured: 220, confirmed: true, note: 'Felső fal, ablakkal (1,35 m, parapet 80 cm).' },
          { label: 600, confirmed: true, note: 'Jobb oldali külső fal, ablakkal (1,35 m, parapet 80 cm).' },
          { label: 456, measured: 440, confirmed: true, note: 'Alsó fal (1,04 + 0,57 + 2,95 m).' },
          { measured: 120, note: 'Folyosó felőli fal az ajtóval; hossza a tervről lemérve.' },
          { note: 'Kémény alja; a tervről lemérve.' },
          { note: 'Burkolt szerelt kémény; a tervről lemérve.' },
          { label: 44, note: 'Burkolt kémény alja (a folyosó faltól 1,04 m-ig).' },
          { measured: 63, note: 'Burkolt kémény oldala; a tervről lemérve.' },
          { label: 57, measured: 63, confirmed: true, note: 'Lépcsőház alja és a kéményburkolat között.' },
          { measured: 220, note: 'Lépcsőház fala; a tervről lemérve (225 cm-től a 425 cm-es vonalig).' },
          { label: 45, measured: 41, confirmed: true, note: 'Lépcsőház és fürdő fala közötti lépcső.' },
          { label: 225, measured: 219, confirmed: true, note: 'Fürdőszoba fala.' }
        ],
        openings: [
          { type: 'window', wall: 0, offset: 142.5, width: 135, sill: 80, height: 150, note: 'Tervrajz: pm 80' },
          { type: 'window', wall: 1, offset: 106.5, width: 135, sill: 80, height: 150, note: 'Tervrajz: 1,35 / 1,50, pm 80' },
          { type: 'door', wall: 3, offset: 56, width: 90, hinge: 'end', swing: 'in', note: 'Tervrajz: 90 / 2,10' }
        ]
      },
      review: [
        'A falak az építészeti tervrajz (SZOBA III.) méretei szerint készültek: 2,50 × 6,00 m-es fő méretek, 4,56 m-es alsó fal, lépcsőház- és kéménykiugrás.',
        'A kézi felmérés több helyen kisebb értéket ad (felső fal 220 a terv 250 helyett, alsó fal 440 a 456 helyett, 219 a 225 helyett). Ez a tetőtéri belső falburkolat (térdfal, gipszkarton) miatt lehet; a pontos, burkolt méreteket a falaknál lehet beírni.',
        'A számolt alapterület 18,81 m²; a terven 18,27 m² szerepel (a tetőtéri, csökkentett belmagasságú sáv számítása eltérhet).'
      ]
    },
    {
      id: 'room2',
      name: 'Konyha-étkező-nappali',
      url: 'assets/alaprajz-2.png',
      imageSize: { width: 1122, height: 1402 },
      pxPerCm: 219 / 102,
      reference: { x1: 119, y1: 232, x2: 338, y2: 232, cm: 102, label: 'Bal felső szakasz · 102 cm' },
      trace: [
        [122, 238], [342, 238], [342, 354], [490, 354], [490, 273], [549, 273], [549, 157],
        [725, 157], [725, 296], [941, 296], [941, 557], [1005, 557], [1005, 815], [1013, 815],
        [1013, 860], [854, 860], [854, 1010], [980, 1010], [980, 1268], [794, 1268], [754, 1234],
        [687, 1257], [472, 1257], [391, 1228], [312, 1189], [231, 1227], [122, 1227]
      ],
      edges: [
        { label: 102 }, {}, {}, { label: 14 }, {}, {}, { label: 27 }, { label: 31, note: '14 + 17 cm' },
        {}, { label: 64 }, {}, { label: 36, note: '23 + 13 cm' }, {}, {}, { label: 55, note: '52 + 3 cm' },
        { label: 42.5 }, { label: 27 }, {}, { label: 40.5 }, {}, { label: 17 }, { label: 68 }, { label: 17 },
        { open: true, note: 'A rajzon nincs fal ezen a szakaszon (átjáró vagy ajtó).' },
        { note: 'Ferde vonal a rajzon – lehet ajtólap is; falként rögzítve, ellenőrizendő.' },
        { label: 18 }, { label: 187, note: '170 + 17 cm' }
      ],
      partitions: [],
      openings: [],
      planGeometry: {
        source: 'assets/tervrajz-nappali.png',
        planArea: 43.59,
        // 81,3 px/m; the left wall / kitchen-side top wall corner is at (24, 24) px.
        underlay: { url: 'assets/tervrajz-nappali.png', pxPerCm: 0.813, originPx: [24, 24] },
        vertices: [[0, -112.5], [100, -112.5], [100, 56.5], [205, 56.5], [205, 0], [598, 0], [598, 441], [560, 441], [560, 484], [598, 484], [598, 754], [0, 754]],
        walls: [
          { label: 100, note: 'A bal felső sáv a tervrajz kivágásán kívül esik (5,535 − 4,41 = 1,125 m mély) – ellenőrizendő.' },
          { note: 'Lépcső / kémény oldala – a tervről becsülve.' },
          { label: 105, confirmed: true, note: 'Kémény.' },
          { note: 'Kémény oldala – a tervről lemérve.' },
          { label: 393, confirmed: true, note: 'Felső fal: 98 (kandalló) + 65 + 2,30 m (konyha); ajtó a közlekedő felé (90 / 2,10).' },
          { label: 441, confirmed: true, note: 'Konyhai külső fal ablakkal (pm 85).' },
          { label: 38, confirmed: true, note: 'Jobb oldali pillér a faláttörésnél.' },
          { label: 43, confirmed: true, note: 'Faláttörés a tartószerkezeti terv szerint.' },
          { label: 38, confirmed: true, note: 'Jobb oldali pillér.' },
          { label: 270, confirmed: true, note: 'Nappali rész, jobb fal.' },
          { label: 598, confirmed: true, note: '1,22 + 0,90 + 3,48 + 0,38 m; két teraszajtó (pm 0,00).' },
          { label: 866.5, confirmed: true, note: '5,535 + 0,43 + 2,70 m.' }
        ],
        partitions: [
          { a: [122, 462.5], b: [212, 462.5], thickness: 43, label: 'Pillér (90 × 43)' },
          { a: [205, 34.5], b: [303, 34.5], thickness: 69, height: 110, label: 'Kandalló (98 cm; magassága becsült)' }
        ],
        openings: [
          { type: 'door', wall: 4, offset: 159, width: 90, hinge: 'end', swing: 'out', note: 'Tervrajz: 90 / 2,10' },
          { type: 'window', wall: 5, offset: 292.5, width: 210, sill: 85, height: 140, note: 'Tervrajz: pm 85; a magasság a kivágásból nem olvasható (becsült).' },
          { type: 'window', wall: 10, offset: 432.5, width: 200, sill: 0, height: 230, note: 'Teraszajtó, pm 0,00 (a magasság becsült).' },
          { type: 'window', wall: 10, offset: 167, width: 200, sill: 0, height: 230, note: 'Teraszajtó nyíló szárnnyal, pm 0,00 (a magasság becsült).' }
        ]
      },
      review: [
        'A falak a „KONYHA-ÉTKEZŐ-NAPPALI” tervrajz méretei szerint készültek: 5,98 m széles, 4,41 m-es konyha-étkező, 43 cm-es faláttörés két pillérrel, 2,70 m-es nappali rész.',
        'A bal felső sáv (az 5,535 m-es méret felső része) a kapott képkivágáson kívül esik, ezért 1,00 × 1,125 m-es téglalapként becsültem; ha van teljes tervrajz, ez pontosítható.',
        'A számolt padlóterület (a faláttörés sávjával, a pillér és a kandalló nélkül) kb. 44,4 m²; a terv 43,59 m²-e a faláttörést nem számolja. A maradék kb. 0,5 m² eltérés valószínűleg a kivágáson kívüli bal felső részből ered.'
      ]
    },
    {
      id: 'room3',
      name: 'SZOBA II.',
      url: 'assets/alaprajz-3.png',
      imageSize: { width: 1122, height: 1402 },
      pxPerCm: 126 / 20,
      reference: { x1: 226, y1: 90, x2: 352, y2: 90, cm: 20, label: 'Bal felső szakasz · 20 cm' },
      trace: [
        [232, 92], [358, 92], [639, 92], [729, 92], [729, 974], [816, 976], [816, 1331],
        [689, 1333], [465, 1332], [361, 1332], [361, 1267], [284, 1267], [284, 977], [303, 977],
        [303, 901], [284, 901], [284, 740], [303, 740], [303, 572], [193, 572], [193, 519], [232, 519]
      ],
      edges: [
        { label: 20 }, { open: true, note: 'Felső nyílás – a rajzon nincs fal.' }, { label: 20 }, {},
        { label: 35 }, { note: 'A 86 cm-es méret csak a szakasz alsó részére vonatkozik.' }, { label: 29.5 },
        { open: true, note: 'Alsó nyílás – a rajzon nincs fal.' }, { label: 13 }, {}, {},
        { note: 'Ablak a rajz szerint (dupla vonal).' }, {}, { label: 16 }, {},
        { note: 'Ablak a rajz szerint (dupla vonal).' }, {}, { label: 77 }, { label: 39, note: 'A kézi vázlat szerint 39 (a régi rajzon tévesen 29).' }, { label: 20 }, {},
        { label: 208, note: '173 + 35 cm (a kézi vázlat szerint; a régi rajzon tévesen 55)' }
      ],
      partitions: [
        { a: [639, 92], b: [639, 183], label: 28.5, note: 'Felső falcsonk a rajz szerint.' }
      ],
      openings: [
        { type: 'window', edge: 11, inset: 0.04, note: 'Ablak – szélessége a rajzról becsült.' },
        { type: 'window', edge: 15, inset: 0.04, note: 'Ablak – szélessége a rajzról becsült.' }
      ],
      planGeometry: {
        source: 'assets/tervrajz-szoba-1-2.png',
        planArea: 12.98,
        underlay: { url: 'assets/tervrajz-szoba-1-2.png', pxPerCm: 1.079, originPx: [185, 32] },
        vertices: [[0, 0], [456, 0], [456, 261], [418, 261], [418, 294], [90, 294], [90, 261], [0, 261]],
        walls: [
          { label: 456, confirmed: true, note: 'Felső fal.' },
          { label: 261, confirmed: true, note: 'Külső fal ablakkal (pm 80).' },
          { label: 38, confirmed: true, note: 'Jobb oldali pillér.' },
          { label: 33, confirmed: true, note: 'Pillér mélysége.' },
          { label: 328, confirmed: true, note: 'Válaszfal a SZOBA I. felé (10 cm).' },
          { label: 33, confirmed: true, note: 'Pillér mélysége.' },
          { label: 90, confirmed: true, note: 'Bal oldali pillér.' },
          { label: 261, confirmed: true, note: 'Közlekedő felőli fal ajtóval (90 / 2,10).' }
        ],
        partitions: [],
        openings: [
          { type: 'window', wall: 1, offset: 119, width: 200, sill: 80, height: 140, note: 'Tervrajz: pm 80; a szélesség és magasság a kivágásból csak részben olvasható (becsült).' },
          { type: 'door', wall: 7, offset: 196.5, width: 90, hinge: 'end', swing: 'in', note: 'Tervrajz: 90 / 2,10' }
        ]
      },
      review: [
        'A falak a „SZOBA II.” tervrajz méretei szerint készültek: 4,56 × 2,94 m, alul két 33 cm mély pillérrel (90 és 38 cm).',
        'A számolt alapterület 4,56 × 2,61 + 3,28 × 0,33 = 12,98 m², pontosan egyezik a tervvel.'
      ]
    },
    {
      id: 'room4',
      name: 'SZOBA I.',
      url: 'assets/tervrajz-szoba-1-2.png',
      imageSize: { width: 752, height: 735 },
      pxPerCm: 1.079,
      reference: null,
      edges: [],
      partitions: [],
      openings: [],
      planGeometry: {
        source: 'assets/tervrajz-szoba-1-2.png',
        planArea: 16.15,
        underlay: { url: 'assets/tervrajz-szoba-1-2.png', pxPerCm: 1.079, originPx: [32, 358] },
        vertices: [[0, 0], [598, 0], [598, 270], [0, 270]],
        walls: [
          { label: 598, confirmed: true, note: 'Felső fal (2,93 + 0,10 + 2,95 m); ajtó a közlekedő felől (90 / 2,10).' },
          { label: 270, confirmed: true, note: 'Jobb oldali külső fal.' },
          { label: 598, confirmed: true, note: 'Két erkélyajtó (pm 0,00, 2,30 m magas).' },
          { label: 270, confirmed: true, note: 'Bal oldali külső fal.' }
        ],
        partitions: [],
        openings: [
          { type: 'door', wall: 0, offset: 61.5, width: 90, hinge: 'start', swing: 'in', note: 'Tervrajz: 90 / 2,10' },
          { type: 'window', wall: 2, offset: 424, width: 180, sill: 0, height: 230, note: 'Erkélyajtó, 2 × 90 / 2,30, pm 0,00' },
          { type: 'window', wall: 2, offset: 176.5, width: 180, sill: 0, height: 230, note: 'Erkélyajtó, 2 × 90 / 2,30, pm 0,00' }
        ]
      },
      review: [
        'A falak a „SZOBA I.” tervrajz méretei szerint készültek: 5,98 × 2,70 m, két 1,80 m-es erkélyajtóval.',
        'A számolt alapterület 5,98 × 2,70 = 16,15 m², pontosan egyezik a tervvel.'
      ]
    }
  ];

  function edgeLength(trace, index) {
    const a = trace[index];
    const b = trace[(index + 1) % trace.length];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }

  /**
   * Builds a closed draft geometry in centimetres, using the room's current
   * pixel/centimetre calibration so the outline sits exactly on the drawing
   * and on furniture positions that were placed against the drawing.
   */
  function buildDraftGeometry(plan, pxPerCm, idFactory) {
    const scale = Number(pxPerCm);
    if (!Number.isFinite(scale) || scale <= 0) throw new TypeError('Érvényes kalibráció szükséges.');
    const id = idFactory || (() => `g${Math.random().toString(36).slice(2)}`);
    const vertices = plan.trace.map(([x, y]) => ({ id: id(), x: x / scale, y: y / scale }));
    const objects = [];
    plan.edges.forEach((edge, index) => {
      if (!edge.open) return;
      const length = edgeLength(plan.trace, index) / scale;
      objects.push({
        id: id(), type: 'opening', name: 'Nyílás', wallIndex: index, offset: length / 2,
        width: length, fullWall: true, estimated: true
      });
    });
    for (const opening of plan.openings) {
      const length = edgeLength(plan.trace, opening.edge) / scale;
      const width = length * (1 - 2 * (opening.inset || 0));
      objects.push({
        id: id(), type: opening.type, name: opening.type === 'window' ? 'Ablak' : 'Nyílás',
        wallIndex: opening.edge, offset: length / 2, width, height: 140, sill: 85, estimated: true
      });
    }
    return {
      id: id(),
      name: 'Rajzról vett vázlat (ellenőrizendő)',
      source: 'traced',
      planId: plan.id,
      vertices,
      closed: true,
      confirmedWalls: plan.edges.map(() => false),
      wallLabels: plan.edges.map(edge => (edge.label ? Number(edge.label) : null)),
      wallNotes: plan.edges.map(edge => edge.note || ''),
      partitions: plan.partitions.map(part => ({
        id: id(), a: { x: part.a[0] / scale, y: part.a[1] / scale }, b: { x: part.b[0] / scale, y: part.b[1] / scale },
        label: part.label || null, note: part.note || '', estimated: true
      })),
      objects
    };
  }

  /**
   * Builds the geometry from an architectural plan (centimetres). `offset` shifts it so it
   * can be aligned with an older traced outline (keeps existing furniture positions close).
   */
  function buildPlanGeometry(plan, idFactory, offset = { x: 0, y: 0 }) {
    const source = plan.planGeometry;
    if (!source) return null;
    const id = idFactory || (() => `g${Math.random().toString(36).slice(2)}`);
    const vertices = source.vertices.map(([x, y]) => ({ id: id(), x: x + offset.x, y: y + offset.y }));
    return {
      id: id(),
      name: 'Tervrajz szerint',
      source: 'plan',
      planId: plan.id,
      vertices,
      closed: true,
      confirmedWalls: source.walls.map(wall => Boolean(wall.confirmed)),
      wallLabels: source.walls.map(wall => (wall.label ? Number(wall.label) : null)),
      wallMeasured: source.walls.map(wall => (wall.measured ? Number(wall.measured) : null)),
      wallNotes: source.walls.map(wall => wall.note || ''),
      partitions: (source.partitions || []).map(part => ({
        id: id(), a: { x: part.a[0] + offset.x, y: part.a[1] + offset.y }, b: { x: part.b[0] + offset.x, y: part.b[1] + offset.y },
        thickness: part.thickness, ...(part.height ? { height: part.height } : {}), label: part.label || null
      })),
      underlay: source.underlay ? {
        url: source.underlay.url, pxPerCm: source.underlay.pxPerCm,
        x: offset.x - source.underlay.originPx[0] / source.underlay.pxPerCm,
        y: offset.y - source.underlay.originPx[1] / source.underlay.pxPerCm
      } : null,
      objects: source.openings.map(opening => ({
        id: id(), type: opening.type, name: opening.type === 'window' ? 'Ablak' : opening.type === 'door' ? 'Ajtó' : 'Nyílás',
        wallIndex: opening.wall, offset: opening.offset, width: opening.width,
        ...(opening.type === 'window' ? { sill: opening.sill, height: opening.height } : {}),
        ...(opening.type === 'door' ? { hinge: opening.hinge, swing: opening.swing } : {}),
        note: opening.note || ''
      }))
    };
  }

  // Default names of 1.x/2.0 rooms; a room still carrying one is renamed to the plan's name.
  const legacyNames = Object.freeze({
    room1: ['1. szoba – lépcsőzetes alaprajz'],
    room2: ['2. szoba – tagolt alaprajz'],
    room3: ['3. szoba – keskeny alaprajz']
  });

  return Object.freeze({
    legacyNames,
    legacyIds: Object.freeze(['room1', 'room2', 'room3']),
    buildPlanGeometry,
    plans: Object.freeze(plans),
    ids: Object.freeze(plans.map(plan => plan.id)),
    byId: id => plans.find(plan => plan.id === id) || null,
    edgeLength,
    buildDraftGeometry
  });
});
