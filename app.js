/* Zuglak Studio 1.6 Visual Edition: offline, local-first smart 2D room planner. */
(() => {
  'use strict';

  const Core = window.ZuglakCore;
  const Geometry = window.ZuglakGeometry;
  const Ikea = window.ZUGLAK_IKEA_CATALOG;
  if (!Core || !Geometry || !Ikea) throw new Error('A Zuglak adatmoduljai nem töltődtek be.');

  // The reference points belong to known-length segments in the original images.
  const ORIGINAL_PLANS = [
    { id: 'room1', name: '1. szoba – lépcsőzetes alaprajz', url: 'assets/alaprajz-1.png', pxPerCm: 884 / 440, reference: { x1: 83, y1: 1141, x2: 967, y2: 1141, cm: 440, label: 'Alsó fal · 440 cm' } },
    { id: 'room2', name: '2. szoba – tagolt alaprajz', url: 'assets/alaprajz-2.png', pxPerCm: 219 / 102, reference: { x1: 119, y1: 232, x2: 338, y2: 232, cm: 102, label: 'Bal felső szakasz · 102 cm' } },
    { id: 'room3', name: '3. szoba – keskeny alaprajz', url: 'assets/alaprajz-3.png', pxPerCm: 126 / 20, reference: { x1: 226, y1: 90, x2: 352, y2: 90, cm: 20, label: 'Bal felső szakasz · 20 cm' } }
  ];

  const BASIC_CATALOG = [
    ['sofa', 'Kanapé', 220, 95], ['armchair', 'Fotel', 82, 86], ['bed', 'Ágy', 180, 200],
    ['table', 'Étkezőasztal', 160, 90], ['chair', 'Szék', 46, 50], ['wardrobe', 'Szekrény', 180, 60],
    ['dresser', 'Komód', 120, 45], ['rug', 'Szőnyeg', 200, 140], ['desk', 'Íróasztal', 120, 60],
    ['coffee', 'Dohányzóasztal', 110, 60], ['plant', 'Növény', 42, 42], ['lamp', 'Állólámpa', 36, 36], ['shelf', 'Polc', 100, 34],
    ['tv', 'TV', 120, 15], ['stool', 'Hokedli', 38, 38], ['bath', 'Fürdőkád', 170, 75], ['sink', 'Mosdó', 55, 45]
  ].map(([type, name, width, depth]) => ({ type, name, width, depth, category: 'basic' }));

  const $ = id => document.getElementById(id);
  const canvas = $('stage');
  const wrap = $('stageWrap');
  let ctx = canvas.getContext('2d');
  const emptyVariant = () => ({ items: [] });
  const defaults = () => ({
    version: Core.CURRENT_PLAN_VERSION,
    currentRoom: 'room1',
    customPlans: [],
    rooms: Object.fromEntries(ORIGINAL_PLANS.map(plan => [plan.id, {
      name: plan.name,
      pxPerCm: plan.pxPerCm,
      active: 'Alap',
      variants: { Alap: emptyVariant() },
      geometries: [],
      activeGeometryId: null
    }]))
  });

  let data = Core.loadPlan(localStorage, defaults, ORIGINAL_PLANS.map(plan => plan.id));
  data.customPlans = Array.isArray(data.customPlans) ? data.customPlans : [];
  let favorites = Core.loadFavorites(localStorage);
  let image = null;
  let roomId = data.currentRoom && data.rooms[data.currentRoom] ? data.currentRoom : 'room1';
  let selected = null;
  let mode = 'select';
  let view = { x: 0, y: 0, z: 1 };
  let drag = null;
  let lineStart = null;
  let lineEnd = null;
  let spaceDown = false;
  let statusTimeout = null;
  let history = [];
  let future = [];
  let lastSnapshot = JSON.stringify(data);
  let snapEnabled = false;
  let catalogTab = 'ikea';
  let resolvedImport = null;
  let selectedVertex = null;
  let selectedArchitecture = null;
  let openingTool = null;
  let snapGuides = [];
  let warningItemIds = new Set();
  let lastMeasurement = null;

  const allPlans = () => [...ORIGINAL_PLANS, ...data.customPlans];
  const room = () => data.rooms[roomId];
  const items = () => room().variants[room().active].items;
  const plan = () => allPlans().find(value => value.id === roomId) || ORIGINAL_PLANS[0];
  const scale = () => room().pxPerCm;
  const geometries = () => room().geometries || (room().geometries = []);
  const activeGeometry = () => geometries().find(value => value.id === room().activeGeometryId) || null;
  const pointToCm = point => Geometry.pixelToCm(point, scale());
  const pointToWorld = point => Geometry.cmToPixel(point, scale());
  const itemToCm = item => ({ ...item, x: item.x / scale(), y: item.y / scale() });
  const idFactory = () => crypto.randomUUID ? crypto.randomUUID() : `i${Date.now()}${Math.random()}`;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rad = degrees => degrees * Math.PI / 180;
  const productTypeForCategory = category => ({
    sofas: 'sofa', wardrobes: 'wardrobe', beds: 'bed', tables: 'table', chairs: 'chair', storage: 'shelf'
  })[category] || 'custom';

  function updateHistoryButtons() {
    $('undo').disabled = !history.length;
    $('redo').disabled = !future.length;
  }

  function restoreSnapshot(snapshot) {
    data = JSON.parse(snapshot);
    data.customPlans = Array.isArray(data.customPlans) ? data.customPlans : [];
    roomId = data.currentRoom && data.rooms[data.currentRoom] ? data.currentRoom : 'room1';
    selected = null;
    selectedVertex = null;
    selectedArchitecture = null;
    snapGuides = [];
    lastSnapshot = snapshot;
    localStorage.setItem(Core.PLAN_STORAGE_KEY, snapshot);
    openRoom(roomId, false);
    updateHistoryButtons();
  }

  function undo() {
    if (!history.length) return;
    future.push(JSON.stringify(data));
    restoreSnapshot(history.pop());
    flash('Visszavonva');
  }

  function redo() {
    if (!future.length) return;
    history.push(JSON.stringify(data));
    restoreSnapshot(future.pop());
    flash('Újra végrehajtva');
  }

  function save(trackHistory = true) {
    const snapshot = JSON.stringify(data);
    if (trackHistory && snapshot !== lastSnapshot) {
      history.push(lastSnapshot);
      if (history.length > 60) history.shift();
      future = [];
      updateHistoryButtons();
    }
    try {
      localStorage.setItem(Core.PLAN_STORAGE_KEY, snapshot);
      lastSnapshot = snapshot;
      $('saveState').textContent = '✓ Automatikusan mentve';
      return true;
    } catch {
      $('saveState').textContent = '⚠ A helyi tárhely megtelt';
      flash('A mentés nem sikerült. A feltöltött alaprajz túl nagy lehet; mentsd le a tervet JSON-fájlba.', 9000);
      return false;
    }
  }

  function flash(text, duration = 5000) {
    $('status').textContent = text;
    clearTimeout(statusTimeout);
    if (duration) {
      statusTimeout = setTimeout(() => {
        $('status').textContent = 'A terv szerkeszthető. Kattints egy bútorra a hozzáadáshoz.';
      }, duration);
    }
  }

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  const world = point => ({ x: (point.x - view.x) / view.z, y: (point.y - view.y) / view.z });

  function furnitureSize(item) {
    const value = scale() || 2;
    return { w: Math.max(1, item.w * value), h: Math.max(1, item.h * value) };
  }

  function rounded(x, y, width, height, radius, fill, stroke = '#647568') {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(0.7, 1 / view.z);
      ctx.stroke();
    }
  }

  function drawLine(x1, y1, x2, y2, color, width = 1) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(width, 0.7 / view.z);
    ctx.stroke();
  }

  // Purpose-built vector floor-plan illustrations; no product photography or invented product contours.
  function art(type, width, height, isIkea = false) {
    const min = Math.min(width, height);
    const pad = Math.max(2 / view.z, min * 0.075);
    const line = Math.max(.65 / view.z, min * .012);
    const palette = isIkea
      ? { base: '#c8d0c4', light: '#f4f2e9', edge: '#596b62', accent: '#91a294', wood: '#cba476', darkWood: '#8b6644' }
      : { base: '#d8d0c3', light: '#f3eee6', edge: '#736e64', accent: '#b2a99b', wood: '#caa277', darkWood: '#89684c' };
    const rect = (x, y, w, h, r, color, stroke = palette.edge) => rounded(x, y, w, h, r, color, stroke);
    const linear = (x1, y1, x2, y2, stops) => {
      const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
      stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
      return gradient;
    };

    ctx.save();
    ctx.shadowColor = 'rgba(30,45,38,.19)';
    ctx.shadowBlur = 8 / view.z;
    ctx.shadowOffsetY = 3 / view.z;
    rect(0, 0, width, height, min * .075, linear(0, 0, width, height, [[0, palette.light], [1, palette.base]]));
    ctx.shadowColor = 'transparent';

    if (type === 'sofa' || type === 'armchair') {
      const arm = Math.max(pad, width * .055);
      const back = Math.max(pad * 1.18, height * .17);
      rect(arm * .72, back * .72, width - arm * 1.44, height - back * 1.15, min * .075, linear(0, 0, 0, height, [[0, '#ebe9df'], [1, '#d6d9cf']]), '#718078');
      rect(0, 0, width, back, min * .055, linear(0, 0, 0, back, [[0, '#aeb9ab'], [1, '#8f9d90']]));
      rect(0, back * .25, arm, height - back * .25, min * .05, '#9eaa9d');
      rect(width - arm, back * .25, arm, height - back * .25, min * .05, '#9eaa9d');
      const cushions = type === 'sofa' ? (width > height * 2.15 ? 3 : 2) : 1;
      for (let index = 0; index < cushions; index += 1) {
        const gap = 1.5 / view.z;
        const seatWidth = (width - arm * 2) / cushions;
        rect(arm + index * seatWidth + gap, back + gap, seatWidth - gap * 2, height - back - pad * .65, min * .045, index % 2 ? '#e6e5dc' : '#eceae1', '#aeb7ad');
        drawLine(arm + index * seatWidth + seatWidth * .16, back + seatWidth * .05, arm + index * seatWidth + seatWidth * .84, back + seatWidth * .05, '#f8f7f2', line);
      }
      drawLine(arm * .65, height - pad * .55, width - arm * .65, height - pad * .55, '#79887f', line);
    } else if (type === 'bed') {
      rect(pad * .55, pad * .4, width - pad * 1.1, height - pad * .8, min * .045, '#f8f5ee', '#8e8172');
      rect(0, 0, width, pad * 1.25, min * .035, linear(0, 0, width, 0, [[0, '#8c6b4f'], [.5, '#b28d68'], [1, '#8c6b4f']]));
      const pillowY = pad * 1.45;
      rect(pad * 1.05, pillowY, width / 2 - pad * 1.25, height * .17, min * .055, '#fffdfa', '#c8c4ba');
      rect(width / 2 + pad * .2, pillowY, width / 2 - pad * 1.25, height * .17, min * .055, '#fffdfa', '#c8c4ba');
      const duvet = linear(0, height * .35, width, height, [[0, '#b8cbc3'], [.5, '#d4dfda'], [1, '#a9c0b7']]);
      rect(pad * .82, height * .34, width - pad * 1.64, height * .58, min * .05, duvet, '#8ba79c');
      ctx.globalAlpha = .5;
      drawLine(width * .38, height * .38, width * .32, height * .88, '#f5f8f6', 2 / view.z);
      drawLine(width * .66, height * .38, width * .7, height * .88, '#8fa99f', line);
      ctx.globalAlpha = 1;
    } else if (['table', 'desk', 'coffee'].includes(type)) {
      const tabletop = linear(0, 0, width, height, [[0, '#dfc197'], [.48, palette.wood], [1, '#b98d61']]);
      rect(pad * .34, pad * .34, width - pad * .68, height - pad * .68, min * .07, tabletop, '#8d694a');
      ctx.save();
      ctx.globalAlpha = .3;
      for (let index = 1; index < 7; index += 1) {
        const x = width * index / 7;
        ctx.beginPath();
        ctx.moveTo(x, pad * .7);
        ctx.bezierCurveTo(x + min * .035, height * .35, x - min * .025, height * .7, x, height - pad * .7);
        ctx.strokeStyle = '#805d3d'; ctx.lineWidth = line; ctx.stroke();
      }
      ctx.restore();
      const leg = Math.max(2.5 / view.z, min * .085);
      [[pad * .8, pad * .8], [width - pad * .8 - leg, pad * .8], [pad * .8, height - pad * .8 - leg], [width - pad * .8 - leg, height - pad * .8 - leg]].forEach(([x, y]) => rect(x, y, leg, leg, leg / 2, palette.darkWood, null));
      if (type === 'desk') drawLine(width * .15, height * .72, width * .85, height * .72, '#9a734f', line);
    } else if (type === 'chair' || type === 'stool') {
      const seat = linear(0, 0, width, height, [[0, '#ead7ba'], [1, '#c8a77e']]);
      rect(pad * .88, pad, width - pad * 1.76, height - pad * 1.9, min * .11, seat, '#896e55');
      if (type === 'chair') {
        rect(pad * .5, pad * .35, width - pad, Math.max(4 / view.z, height * .17), min * .04, '#9a7657', '#755a45');
        drawLine(pad, pad * .92, pad * .88, height - pad * .5, '#7d624d', 1.5 / view.z);
        drawLine(width - pad, pad * .92, width - pad * .88, height - pad * .5, '#7d624d', 1.5 / view.z);
      }
      const foot = Math.max(1.6 / view.z, min * .038);
      [[pad, height - pad], [width - pad, height - pad]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, foot, 0, Math.PI * 2); ctx.fillStyle = '#695342'; ctx.fill(); });
    } else if (type === 'wardrobe') {
      rect(pad * .3, pad * .3, width - pad * .6, height - pad * .6, min * .025, linear(0, 0, width, 0, [[0, '#e3ddd1'], [.5, '#cfc7ba'], [1, '#eee9e0']]), '#827a6e');
      const doors = width > height * 2.5 ? 4 : width > height * 1.5 ? 3 : 2;
      for (let index = 1; index < doors; index += 1) drawLine(width * index / doors, pad * .38, width * index / doors, height - pad * .38, '#968e82', line);
      for (let index = 0; index < doors; index += 1) {
        const center = width * (index + .5) / doors;
        rect(center - Math.max(1 / view.z, min * .012), height * .41, Math.max(2 / view.z, min * .024), height * .18, min * .01, '#756f66', null);
      }
      drawLine(pad * .7, height - pad, width - pad * .7, height - pad, '#aaa195', line);
    } else if (type === 'dresser' || type === 'shelf') {
      rect(pad * .35, pad * .35, width - pad * .7, height - pad * .7, min * .025, linear(0, 0, width, height, [[0, '#decbb2'], [1, '#bba184']]), '#826d57');
      const sections = width > height * 2 ? 4 : 3;
      for (let index = 1; index < sections; index += 1) drawLine(width * index / sections, pad * .4, width * index / sections, height - pad * .4, '#947b62', line);
      drawLine(pad * .5, height / 2, width - pad * .5, height / 2, '#9f856b', line);
      for (let index = 0; index < sections; index += 1) {
        ctx.beginPath(); ctx.arc(width * (index + .5) / sections, height / 2, Math.max(1 / view.z, min * .018), 0, Math.PI * 2); ctx.fillStyle = '#6f5b49'; ctx.fill();
      }
    } else if (type === 'rug') {
      rect(pad * .25, pad * .25, width - pad * .5, height - pad * .5, min * .055, linear(0, 0, width, height, [[0, '#d9c2a8'], [1, '#b69b81']]), '#9e8168');
      ctx.save(); ctx.globalAlpha = .32; ctx.strokeStyle = '#fff7ed'; ctx.lineWidth = Math.max(1 / view.z, min * .018);
      for (let index = 1; index < 5; index += 1) { ctx.beginPath(); ctx.moveTo(pad, height * index / 5); ctx.lineTo(width - pad, height * index / 5); ctx.stroke(); }
      ctx.setLineDash([5 / view.z, 4 / view.z]); ctx.strokeRect(pad, pad, width - pad * 2, height - pad * 2); ctx.restore();
    } else if (type === 'plant') {
      const radius = min * .33;
      const leafColors = ['#3e785b', '#568a64', '#6c9a6b', '#2f684f'];
      for (let index = 0; index < 12; index += 1) {
        const angle = index * Math.PI * 2 / 12;
        ctx.save(); ctx.translate(width / 2, height / 2); ctx.rotate(angle);
        ctx.beginPath(); ctx.ellipse(radius * .45, 0, radius * .7, radius * .22, 0, 0, Math.PI * 2); ctx.fillStyle = leafColors[index % leafColors.length]; ctx.fill(); ctx.restore();
      }
      ctx.beginPath(); ctx.arc(width / 2, height / 2, radius * .32, 0, Math.PI * 2); ctx.fillStyle = '#a9805b'; ctx.fill(); ctx.strokeStyle = '#6d573f'; ctx.lineWidth = line; ctx.stroke();
    } else if (type === 'lamp') {
      const radius = min * .4;
      ctx.beginPath(); ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2); ctx.fillStyle = '#d5b36e'; ctx.fill(); ctx.strokeStyle = '#7c6949'; ctx.lineWidth = line; ctx.stroke();
      ctx.beginPath(); ctx.arc(width / 2, height / 2, radius * .55, 0, Math.PI * 2); ctx.fillStyle = '#fff7d8'; ctx.fill();
      ctx.beginPath(); ctx.arc(width / 2, height / 2, radius * .12, 0, Math.PI * 2); ctx.fillStyle = '#7b6746'; ctx.fill();
    } else if (type === 'tv') {
      rect(pad * .7, pad, width - pad * 1.4, height - pad * 2, min * .025, linear(0, 0, width, height, [[0, '#263236'], [1, '#111719']]), '#4d5a5d');
      drawLine(width / 2, height - pad, width / 2, height, '#596568', 2 / view.z);
    } else if (type === 'bath' || type === 'sink') {
      rect(pad * .55, pad * .55, width - pad * 1.1, height - pad * 1.1, min * .22, linear(0, 0, width, height, [[0, '#fff'], [1, '#dae8e9']]), '#93a8aa');
      ctx.beginPath(); ctx.arc(width * .8, height * .5, Math.max(1 / view.z, min * .045), 0, Math.PI * 2); ctx.fillStyle = '#91a6a8'; ctx.fill();
    } else {
      ctx.setLineDash([4 / view.z, 3 / view.z]); ctx.strokeStyle = palette.edge; ctx.strokeRect(pad, pad, width - 2 * pad, height - 2 * pad); ctx.setLineDash([]);
    }

    if (isIkea && width > 55 / view.z && height > 22 / view.z) {
      const fontSize = clamp(min * .1, 7 / view.z, 11 / view.z);
      ctx.font = `750 ${fontSize}px system-ui`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#465b52'; ctx.globalAlpha = .62;
      ctx.fillText('IKEA', width - pad * .65, height - pad * .45);
    }
    ctx.restore();
  }

  function drawPolygon(points, fill, stroke, lineWidth = 1, dashed = false) {
    if (!points.length) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      if (dashed) ctx.setLineDash([7 / view.z, 5 / view.z]);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(0.8 / view.z, lineWidth / view.z);
      ctx.stroke();
    }
    ctx.restore();
  }

  function polygonPath(points) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
    ctx.closePath();
  }

  function drawFloorSurface(points, material = 'oak-light') {
    if (points.length < 3) return;
    const styles = {
      'oak-light': { base: '#ead9bd', light: '#f3e6cf', line: '#c9ad83', knot: '#b89164' },
      'oak-natural': { base: '#d8b581', light: '#ead0a5', line: '#b28756', knot: '#8f673e' },
      walnut: { base: '#9a7151', light: '#b88b65', line: '#755039', knot: '#5f3e2c' },
      plain: { base: '#e9e5db', light: '#f4f1e9', line: '#d9d4c9', knot: '#c8c1b3' }
    };
    const style = styles[material] || styles['oak-light'];
    const bounds = points.reduce((value, point) => ({
      minX: Math.min(value.minX, point.x), minY: Math.min(value.minY, point.y),
      maxX: Math.max(value.maxX, point.x), maxY: Math.max(value.maxY, point.y)
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    ctx.save();
    polygonPath(points);
    ctx.clip();
    ctx.globalAlpha = mode === 'walls' || mode === 'calibrate' ? .58 : .94;
    const wash = ctx.createLinearGradient(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    wash.addColorStop(0, style.light); wash.addColorStop(.48, style.base); wash.addColorStop(1, style.light);
    ctx.fillStyle = wash;
    ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    if (material !== 'plain') {
      const plank = Math.max(28, 34 * (scale() || 2));
      const board = plank * .28;
      ctx.lineWidth = Math.max(.45 / view.z, .7);
      ctx.strokeStyle = style.line;
      ctx.globalAlpha *= .42;
      for (let y = Math.floor(bounds.minY / board) * board; y <= bounds.maxY; y += board) {
        drawLine(bounds.minX, y, bounds.maxX, y, style.line, .7 / view.z);
      }
      let row = 0;
      for (let y = Math.floor(bounds.minY / board) * board; y < bounds.maxY; y += board, row += 1) {
        const offset = row % 2 ? plank * .48 : 0;
        for (let x = Math.floor((bounds.minX - offset) / plank) * plank + offset; x <= bounds.maxX; x += plank) {
          drawLine(x, y, x, y + board, style.line, .7 / view.z);
          if ((row + Math.round(x / plank)) % 4 === 0) {
            ctx.beginPath(); ctx.ellipse(x + plank * .28, y + board * .52, plank * .045, board * .12, 0, 0, Math.PI * 2);
            ctx.strokeStyle = style.knot; ctx.stroke();
          }
        }
      }
    }
    ctx.restore();
  }

  function drawDimensionLabel(start, end, label, color = '#245f4c') {
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    ctx.save();
    ctx.font = `700 ${12 / view.z}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(label).width + 10 / view.z;
    ctx.fillStyle = '#fffffff0';
    ctx.fillRect(midpoint.x - width / 2, midpoint.y - 10 / view.z, width, 20 / view.z);
    ctx.fillStyle = color;
    ctx.fillText(label, midpoint.x, midpoint.y);
    ctx.restore();
  }

  function drawArchitecture(geometry) {
    for (const object of geometry.objects || []) {
      const opening = Geometry.openingSegment(object, geometry.vertices);
      if (!opening) continue;
      const active = selectedArchitecture?.id === object.id;
      if (object.type === 'door') {
        const zoneCm = Geometry.doorClearancePolygon(object, geometry.vertices);
        const zone = zoneCm.map(pointToWorld);
        drawPolygon(zone, active ? '#df81652d' : '#dca58c1c', null);
        const hinge = zone[0];
        const closedEnd = zone[1];
        const openEnd = zone.at(-1);
        const a = pointToWorld(opening.a);
        const b = pointToWorld(opening.b);
        drawLine(a.x, a.y, b.x, b.y, '#f2e5cf', 9 / view.z);
        ctx.save();
        ctx.beginPath(); ctx.moveTo(closedEnd.x, closedEnd.y); zone.slice(2).forEach(point => ctx.lineTo(point.x, point.y));
        ctx.strokeStyle = active ? '#bd5948' : '#b9836f'; ctx.lineWidth = 1.2 / view.z; ctx.setLineDash([5 / view.z, 4 / view.z]); ctx.stroke(); ctx.restore();
        drawLine(hinge.x, hinge.y, openEnd.x, openEnd.y, active ? '#8f4034' : '#956354', 3 / view.z);
        drawLine(hinge.x, hinge.y, closedEnd.x, closedEnd.y, '#c5a18b', 1 / view.z);
        ctx.beginPath();
        ctx.arc(hinge.x, hinge.y, 3.4 / view.z, 0, Math.PI * 2);
        ctx.fillStyle = active ? '#a54438' : '#9c6959'; ctx.fill();
      } else if (object.type === 'window') {
        const a = pointToWorld(opening.a);
        const b = pointToWorld(opening.b);
        drawLine(a.x, a.y, b.x, b.y, '#f7f5ef', 10 / view.z);
        drawLine(a.x, a.y, b.x, b.y, active ? '#277baa' : '#5d9db8', 6 / view.z);
        drawLine(a.x, a.y, b.x, b.y, '#dff5f7', 2 / view.z);
      } else if (object.type === 'radiator') {
        const polygon = Geometry.radiatorPolygon(object, geometry.vertices).map(pointToWorld);
        drawPolygon(polygon, active ? '#d7a47d' : '#e8d6c3', active ? '#985233' : '#a9866e', 1.5);
        if (polygon.length === 4) {
          for (let index = 1; index < 7; index += 1) {
            const ratio = index / 7;
            const a = { x: polygon[0].x + (polygon[1].x - polygon[0].x) * ratio, y: polygon[0].y + (polygon[1].y - polygon[0].y) * ratio };
            const b = { x: polygon[3].x + (polygon[2].x - polygon[3].x) * ratio, y: polygon[3].y + (polygon[2].y - polygon[3].y) * ratio };
            drawLine(a.x, a.y, b.x, b.y, '#b59175', .8 / view.z);
          }
        }
      }
    }
  }

  function drawRoomGeometry() {
    const geometry = activeGeometry();
    if (!geometry || !scale() || !geometry.vertices.length) return;
    const points = geometry.vertices.map(pointToWorld);
    if (geometry.closed && points.length >= 3) {
      drawFloorSurface(points, geometry.floorMaterial || 'oak-light');
      ctx.save();
      polygonPath(points);
      ctx.shadowColor = 'rgba(48,42,33,.28)'; ctx.shadowBlur = 9 / view.z; ctx.shadowOffsetY = 4 / view.z;
      ctx.strokeStyle = '#6b716c'; ctx.lineWidth = 10 / view.z; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#f6f4ee'; ctx.lineWidth = 5.5 / view.z; ctx.stroke();
      ctx.strokeStyle = '#b9bbb4'; ctx.lineWidth = 1 / view.z; ctx.stroke();
      ctx.restore();
    }
    else {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
      ctx.strokeStyle = '#277769';
      ctx.lineWidth = 4 / view.z;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
    const wallCount = geometry.closed ? points.length : Math.max(0, points.length - 1);
    for (let index = 0; index < wallCount; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      const cm = Geometry.distance(geometry.vertices[index], geometry.vertices[(index + 1) % points.length]);
      const confirmed = Boolean(geometry.confirmedWalls?.[index]);
      drawDimensionLabel(start, end, `${confirmed ? '' : '≈ '}${cm.toFixed(1)} cm`, confirmed ? '#1d644b' : '#866528');
    }
    drawArchitecture(geometry);
    if (mode !== 'walls') return;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      ctx.beginPath();
      ctx.arc(point.x, point.y, (selectedVertex === index ? 7 : 5) / view.z, 0, Math.PI * 2);
      ctx.fillStyle = selectedVertex === index ? '#f0a42d' : '#fff';
      ctx.fill();
      ctx.strokeStyle = '#21674f';
      ctx.lineWidth = 2 / view.z;
      ctx.stroke();
    }
  }

  function clearanceDistance() {
    if ($('clearance80').checked) return 80;
    if ($('clearance70').checked) return 70;
    return 0;
  }

  function drawClearanceGuide() {
    const item = items().find(value => value.id === selected);
    const margin = clearanceDistance();
    if (!item || !margin || !scale()) return;
    const polygon = Geometry.rotatedRectCorners(itemToCm(item), margin).map(pointToWorld);
    drawPolygon(polygon, '#3e8bb20d', '#397c9f', 1.5, true);
    drawDimensionLabel(polygon[0], polygon[1], `${margin} cm-es segédsáv`, '#397c9f');
  }

  function drawSnapGuides() {
    if (!scale()) return;
    for (const guide of snapGuides) {
      ctx.save();
      ctx.strokeStyle = guide.type === 'wall' ? '#19a67a' : guide.type === 'furniture' ? '#307fc4' : '#8573bd';
      ctx.lineWidth = 1.5 / view.z;
      ctx.setLineDash([7 / view.z, 4 / view.z]);
      ctx.beginPath();
      if (guide.a && guide.b) {
        const a = pointToWorld(guide.a);
        const b = pointToWorld(guide.b);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      } else {
        const point = pointToWorld({ x: guide.x, y: guide.y });
        ctx.moveTo(point.x - 120 / view.z, point.y);
        ctx.lineTo(point.x + 120 / view.z, point.y);
        ctx.moveTo(point.x, point.y - 120 / view.z);
        ctx.lineTo(point.x, point.y + 120 / view.z);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function computeWarnings() {
    const geometry = activeGeometry();
    const warningMap = new Map();
    warningItemIds = new Set();
    if (!scale()) return [];
    const centimetreItems = items().map(itemToCm);
    for (const item of centimetreItems) {
      const warnings = Geometry.analyzePlacement(item, centimetreItems, geometry, {
        clearance: item.id === selected ? clearanceDistance() : 0
      });
      for (const warning of warnings) {
        warningItemIds.add(item.id);
        if (warning.id) warningItemIds.add(warning.id);
        const key = warning.type === 'furniture'
          ? `furniture-${[item.id, warning.id].sort().join('-')}`
          : `${warning.type}-${item.id}-${warning.id || ''}-${warning.distance || ''}`;
        const text = {
          furniture: `A(z) „${item.name}” egy másik bútorral átfedésben van.`,
          boundary: `A(z) „${item.name}” kilóg az aktív szobahatáron.`,
          door: `A(z) „${item.name}” ajtónyitási területet metsz.`,
          clearance: `A(z) „${item.name}” ${warning.distance} cm-es segédsávja bútort metsz.`
        }[warning.type];
        if (text) warningMap.set(key, text);
      }
    }
    return [...warningMap.values()];
  }

  function renderWarnings(warnings) {
    const container = $('warnings');
    container.hidden = warnings.length === 0;
    container.innerHTML = warnings.slice(0, 4).map(text => `<div>⚠ ${text}</div>`).join('');
    if (warnings.length > 4) container.innerHTML += `<small>+${warnings.length - 4} további figyelmeztetés</small>`;
  }

  function drawItem(item) {
    const size = furnitureSize(item);
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(rad(item.rot));
    art(item.type, size.w, size.h, item.source === 'ikea');
    if (item.id === selected) {
      ctx.save();
      ctx.shadowColor = 'rgba(23,111,99,.32)'; ctx.shadowBlur = 10 / view.z;
      ctx.strokeStyle = '#137568'; ctx.setLineDash([6 / view.z, 4 / view.z]); ctx.lineWidth = 2 / view.z;
      ctx.strokeRect(-4 / view.z, -4 / view.z, size.w + 8 / view.z, size.h + 8 / view.z);
      ctx.setLineDash([]);
      for (const [x, y] of [[0, 0], [size.w, 0], [size.w, size.h], [0, size.h]]) {
        ctx.beginPath(); ctx.arc(x, y, 3.5 / view.z, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#137568'; ctx.lineWidth = 1.5 / view.z; ctx.stroke();
      }
      ctx.restore();
    }
    if (warningItemIds.has(item.id)) {
      ctx.strokeStyle = '#c6563f';
      ctx.lineWidth = 3 / view.z;
      ctx.strokeRect(-5 / view.z, -5 / view.z, size.w + 10 / view.z, size.h + 10 / view.z);
    }
    ctx.restore();
  }

  function draw() {
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    const dpr = devicePixelRatio || 1;
    const actualWidth = Math.round(width * dpr);
    const actualHeight = Math.round(height * dpr);
    if (canvas.width !== actualWidth || canvas.height !== actualHeight) {
      canvas.width = actualWidth;
      canvas.height = actualHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.z, view.z);
    const warnings = computeWarnings();
    renderWarnings(warnings);
    if (image) {
      ctx.drawImage(image, 0, 0);
      ctx.strokeStyle = '#cad8c8';
      ctx.lineWidth = 1 / view.z;
      ctx.strokeRect(0, 0, image.width, image.height);
    }
    if ($('showReference').checked && plan().reference) {
      const reference = plan().reference;
      ctx.save();
      ctx.strokeStyle = '#cf443c';
      ctx.lineWidth = 3 / view.z;
      ctx.setLineDash([8 / view.z, 5 / view.z]);
      ctx.beginPath(); ctx.moveTo(reference.x1, reference.y1); ctx.lineTo(reference.x2, reference.y2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#9b302a';
      ctx.font = `${15 / view.z}px sans-serif`;
      ctx.fillText(reference.label, reference.x1, reference.y1 - 12 / view.z);
      ctx.restore();
    }
    drawRoomGeometry();
    items().forEach(drawItem);
    drawClearanceGuide();
    drawSnapGuides();
    if (lastMeasurement) {
      ctx.save();
      ctx.strokeStyle = '#32816c';
      ctx.lineWidth = 2 / view.z;
      ctx.setLineDash([8 / view.z, 4 / view.z]);
      ctx.beginPath();
      ctx.moveTo(lastMeasurement.start.x, lastMeasurement.start.y);
      ctx.lineTo(lastMeasurement.end.x, lastMeasurement.end.y);
      ctx.stroke();
      ctx.setLineDash([]);
      drawDimensionLabel(lastMeasurement.start, lastMeasurement.end, `${lastMeasurement.cm.toFixed(1)} cm`, '#276b59');
      ctx.restore();
    }
    if (lineStart && lineEnd) {
      ctx.strokeStyle = mode === 'calibrate' ? '#e25f48' : '#32816c';
      ctx.lineWidth = 3 / view.z;
      ctx.setLineDash([10 / view.z, 5 / view.z]);
      ctx.beginPath(); ctx.moveTo(lineStart.x, lineStart.y); ctx.lineTo(lineEnd.x, lineEnd.y); ctx.stroke();
      ctx.setLineDash([]);
      if (mode === 'measure' && scale()) {
        drawDimensionLabel(lineStart, lineEnd, `${(Math.hypot(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y) / scale()).toFixed(1)} cm`, '#276b59');
      }
    }
    ctx.restore();
    $('zoomLabel').textContent = `${Math.round(view.z * 100)}%`;
    $('scaleInfo').textContent = scale()
      ? `Becsült skála: 1 cm = ${scale().toFixed(2)} px · Az eredeti rajz nem mindenütt arányos!`
      : '⚠ Méretarány kalibrálása szükséges a pontos bútorokhoz';
  }

  function fit() {
    if (!image) return;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    view.z = Math.min((width - 60) / image.width, (height - 60) / image.height);
    view.x = (width - image.width * view.z) / 2;
    view.y = (height - image.height * view.z) / 2;
    draw();
  }

  function zoom(factor, at = { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 }) {
    const origin = world(at);
    view.z = clamp(view.z * factor, 0.15, 7);
    view.x = at.x - origin.x * view.z;
    view.y = at.y - origin.y * view.z;
    draw();
  }

  function hit(point) {
    for (const item of [...items()].reverse()) {
      const size = furnitureSize(item);
      const dx = point.x - item.x;
      const dy = point.y - item.y;
      const angle = -rad(item.rot);
      const x = dx * Math.cos(angle) - dy * Math.sin(angle);
      const y = dx * Math.sin(angle) + dy * Math.cos(angle);
      if (x >= 0 && y >= 0 && x <= size.w && y <= size.h) return item;
    }
    return null;
  }

  function setMode(value) {
    mode = value;
    lineStart = lineEnd = null;
    snapGuides = [];
    if (value !== 'walls') selectedVertex = null;
    if (value !== 'openings') { selectedArchitecture = null; openingTool = null; }
    const buttons = { select: 'modeSelect', walls: 'modeWalls', openings: 'modeOpenings', measure: 'modeMeasure', calibrate: 'modeCalibrate', pan: 'modePan' };
    Object.entries(buttons).forEach(([name, id]) => $(id).classList.toggle('selected', value === name));
    const descriptions = {
      select: ['Berendezés', 'Húzd a bútorokat; az igazítás és az ütközésjelzés nem akadályozza a szabad elhelyezést.'],
      walls: ['Falak és méretek', 'Kattints sorban a falpontokra. A kép alapján számolt ≈ hosszt a jobb oldalon írd felül a biztosan ismert centiméterértékkel.'],
      openings: ['Nyílászárók', 'Válassz ajtót, ablakot vagy radiátort, majd kattints a megfelelő fal közelébe.'],
      measure: ['Mérés', 'Kattints két pontra. A mérés a kalibrált képet követi, ezért torz rajzon csak tájékoztató.'],
      calibrate: ['Képi kalibrálás', 'Jelölj ki egy ismert képi szakaszt, majd add meg valós hosszát centiméterben.'],
      pan: ['Nézet mozgatása', 'Húzd az alaprajzot a nézet mozgatásához.']
    };
    $('modeTitle').textContent = descriptions[value][0];
    $('modeHelp').textContent = descriptions[value][1];
    $('hintMode').textContent = descriptions[value][1];
    $('geometryTools').hidden = !['walls', 'openings'].includes(value);
    $('openingTools').hidden = value !== 'openings';
    $('furnishTools').hidden = value !== 'select';
    $('measureTools').hidden = value !== 'measure';
    canvas.style.cursor = value === 'pan' ? 'grab' : ['calibrate', 'measure', 'walls', 'openings'].includes(value) ? 'crosshair' : 'default';
    renderGeometryControls();
    renderProps();
    draw();
  }

  function renderGeometryControls() {
    const select = $('geometrySelect');
    select.innerHTML = '';
    if (!geometries().length) {
      const option = document.createElement('option');
      option.textContent = 'Nincs szobageometria';
      option.value = '';
      select.append(option);
    } else {
      for (const geometry of geometries()) {
        const option = document.createElement('option');
        option.value = geometry.id;
        option.textContent = `${geometry.name}${geometry.closed ? ' · zárt' : ' · nyitott'}`;
        select.append(option);
      }
      select.value = room().activeGeometryId || '';
    }
    $('closeGeometry').disabled = !activeGeometry() || activeGeometry().closed || activeGeometry().vertices.length < 3;
    $('deleteGeometry').disabled = !activeGeometry();
    $('floorMaterial').disabled = !activeGeometry();
    $('floorMaterial').value = activeGeometry()?.floorMaterial || 'oak-light';
  }

  function renderRooms() {
    const container = $('rooms');
    container.innerHTML = '';
    for (const roomPlan of allPlans()) {
      const roomData = data.rooms[roomPlan.id];
      if (!roomData) continue;
      const row = document.createElement('div');
      row.className = `room-row${roomId === roomPlan.id ? ' active' : ''}`;
      const button = document.createElement('button');
      button.className = 'room';
      const thumbnail = document.createElement('img');
      thumbnail.src = roomPlan.url;
      thumbnail.alt = '';
      const label = document.createElement('span');
      const labelName = document.createElement('strong');
      const labelMeta = document.createElement('small');
      labelName.textContent = roomData.name;
      labelMeta.textContent = `${Object.keys(roomData.variants).length} változat · ${roomData.geometries?.length || 0} geometria`;
      label.append(labelName, labelMeta);
      button.append(thumbnail, label);
      button.onclick = () => openRoom(roomPlan.id);
      row.append(button);
      if (roomPlan.isCustom) {
        const remove = document.createElement('button');
        remove.className = 'room-remove danger';
        remove.title = 'Saját alaprajz törlése';
        remove.textContent = '×';
        remove.onclick = () => deleteCustomPlan(roomPlan.id);
        row.append(remove);
      }
      container.append(row);
    }
  }

  function deleteCustomPlan(id) {
    const target = data.customPlans.find(value => value.id === id);
    if (!target || !confirm(`Biztosan törlöd ezt a saját alaprajzot és minden berendezési változatát?\n\n${data.rooms[id]?.name || target.name}`)) return;
    data.customPlans = data.customPlans.filter(value => value.id !== id);
    delete data.rooms[id];
    if (roomId === id) {
      roomId = 'room1';
      data.currentRoom = roomId;
    }
    save();
    openRoom(roomId, false);
  }

  function catalogSvg(type, isIkea) {
    const accent = isIkea ? '#244e3e' : '#7b806f';
    const fill = isIkea ? '#e8eee5' : '#ece8df';
    const common = `fill="${fill}" stroke="${accent}" stroke-width="1.4"`;
    const artByType = {
      sofa: `<rect x="5" y="8" width="60" height="42" rx="7" ${common}/><rect x="11" y="16" width="48" height="27" rx="5" fill="#fff" stroke="${accent}"/><path d="M26 17v25M44 17v25" stroke="${accent}" opacity=".45"/><path d="M8 10v38M62 10v38" stroke="${accent}" stroke-width="5"/>`,
      armchair: `<rect x="15" y="7" width="40" height="45" rx="9" ${common}/><rect x="21" y="15" width="28" height="28" rx="5" fill="#fff" stroke="${accent}"/><path d="M17 9v40M53 9v40" stroke="${accent}" stroke-width="5"/>`,
      bed: `<rect x="13" y="4" width="44" height="51" rx="4" ${common}/><rect x="17" y="11" width="17" height="12" rx="3" fill="#fff"/><rect x="36" y="11" width="17" height="12" rx="3" fill="#fff"/><rect x="17" y="27" width="36" height="23" rx="3" fill="#c7d7d0"/>`,
      wardrobe: `<rect x="5" y="13" width="60" height="32" rx="3" ${common}/><path d="M25 14v30M45 14v30" stroke="${accent}"/><circle cx="22" cy="29" r="1.5" fill="${accent}"/><circle cx="42" cy="29" r="1.5" fill="${accent}"/>`,
      chair: `<rect x="18" y="12" width="34" height="36" rx="7" ${common}/><path d="M20 18h30" stroke="${accent}" stroke-width="5"/>`,
      stool: `<circle cx="35" cy="29" r="17" ${common}/><circle cx="35" cy="29" r="11" fill="#ead6b8" stroke="${accent}"/><circle cx="25" cy="39" r="2" fill="${accent}"/><circle cx="45" cy="39" r="2" fill="${accent}"/>`,
      shelf: `<rect x="7" y="14" width="56" height="30" rx="3" ${common}/><path d="M21 15v28M35 15v28M49 15v28M8 29h54" stroke="${accent}"/>`,
      dresser: `<rect x="7" y="14" width="56" height="30" rx="3" ${common}/><path d="M8 29h54M26 15v28M44 15v28" stroke="${accent}"/><circle cx="17" cy="23" r="1.5" fill="${accent}"/><circle cx="35" cy="23" r="1.5" fill="${accent}"/><circle cx="53" cy="23" r="1.5" fill="${accent}"/>`,
      table: `<rect x="6" y="11" width="58" height="36" rx="7" fill="#d6b181" stroke="${accent}" stroke-width="1.4"/><path d="M18 12v34M30 12v34M42 12v34M54 12v34" stroke="#a98459" opacity=".55"/><circle cx="13" cy="18" r="3" fill="${accent}"/><circle cx="57" cy="18" r="3" fill="${accent}"/><circle cx="13" cy="40" r="3" fill="${accent}"/><circle cx="57" cy="40" r="3" fill="${accent}"/>`,
      desk: `<rect x="6" y="11" width="58" height="36" rx="5" fill="#d6b181" stroke="${accent}" stroke-width="1.4"/><path d="M16 17h38M16 24h38" stroke="#a98459" opacity=".6"/><circle cx="13" cy="40" r="3" fill="${accent}"/><circle cx="57" cy="40" r="3" fill="${accent}"/>`,
      coffee: `<rect x="8" y="14" width="54" height="30" rx="12" fill="#d6b181" stroke="${accent}" stroke-width="1.4"/><path d="M18 15v28M30 15v28M42 15v28M54 15v28" stroke="#a98459" opacity=".5"/>`,
      rug: `<rect x="7" y="9" width="56" height="40" rx="5" fill="#d8c0a7" stroke="${accent}"/><path d="M12 17h46M12 25h46M12 33h46M12 41h46" stroke="#fff" opacity=".55"/><rect x="13" y="15" width="44" height="28" rx="3" fill="none" stroke="${accent}" stroke-dasharray="3 3"/>`,
      plant: `<circle cx="35" cy="30" r="11" fill="#a77f58" stroke="${accent}"/><g fill="#4f865f"><ellipse cx="35" cy="15" rx="5" ry="13"/><ellipse cx="48" cy="22" rx="5" ry="13" transform="rotate(50 48 22)"/><ellipse cx="22" cy="22" rx="5" ry="13" transform="rotate(-50 22 22)"/><ellipse cx="47" cy="38" rx="5" ry="13" transform="rotate(120 47 38)"/><ellipse cx="23" cy="38" rx="5" ry="13" transform="rotate(-120 23 38)"/></g>`,
      lamp: `<circle cx="35" cy="29" r="20" fill="#d8b970" stroke="${accent}" stroke-width="1.4"/><circle cx="35" cy="29" r="12" fill="#fff4cf" stroke="#a88a54"/><circle cx="35" cy="29" r="3" fill="${accent}"/>`,
      tv: `<rect x="5" y="21" width="60" height="16" rx="3" fill="#263338" stroke="${accent}"/><path d="M35 37v7M25 44h20" stroke="${accent}"/>`,
      bath: `<rect x="8" y="8" width="54" height="43" rx="18" fill="#eef7f7" stroke="${accent}"/><ellipse cx="35" cy="29" rx="19" ry="13" fill="#fff" stroke="#9bb5b7"/><circle cx="50" cy="29" r="2" fill="#8ca5a8"/>`,
      sink: `<rect x="13" y="9" width="44" height="40" rx="14" fill="#eef7f7" stroke="${accent}"/><ellipse cx="35" cy="30" rx="13" ry="10" fill="#fff" stroke="#9bb5b7"/><circle cx="35" cy="16" r="2" fill="#8ca5a8"/>`
    };
    return `<svg viewBox="0 0 70 58" aria-hidden="true">${artByType[type] || artByType.table}</svg>`;
  }

  function populateCategoryFilter() {
    const select = $('catalogCategory');
    const previous = select.value;
    select.innerHTML = '<option value="all">Minden kategória</option>';
    if (catalogTab !== 'basic') {
      Object.entries(Ikea.categories).forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.append(option);
      });
      select.hidden = false;
      select.value = [...select.options].some(option => option.value === previous) ? previous : 'all';
    } else {
      select.hidden = true;
      select.value = 'all';
    }
  }

  function isFavorite(productId) {
    return favorites.some(value => value.productId === productId);
  }

  function toggleFavorite(product) {
    const normalized = Core.normalizeProduct(product);
    if (isFavorite(normalized.productId)) favorites = favorites.filter(value => value.productId !== normalized.productId);
    else favorites = [...favorites, normalized];
    try {
      favorites = Core.saveFavorites(localStorage, favorites);
      renderCatalog();
      flash(isFavorite(normalized.productId) ? 'Hozzáadva a kedvencekhez.' : 'Eltávolítva a kedvencekből.');
    } catch {
      flash('A kedvencek mentése nem sikerült.');
    }
  }

  function renderCatalog() {
    const container = $('catalog');
    const query = ($('catalogSearch').value || '').toLocaleLowerCase('hu').trim();
    const category = $('catalogCategory').value || 'all';
    const source = catalogTab === 'ikea' ? Ikea.products : catalogTab === 'favorites' ? favorites : BASIC_CATALOG;
    const filtered = source.filter(product => {
      const haystack = `${product.name} ${product.productId || ''} ${product.type || ''}`.toLocaleLowerCase('hu');
      return haystack.includes(query) && (category === 'all' || product.category === category);
    });

    container.innerHTML = '';
    for (const product of filtered) {
      const isIkea = catalogTab !== 'basic';
      const card = document.createElement('article');
      card.className = `catalog-card${isIkea ? ' ikea-card' : ''}`;
      const add = document.createElement('button');
      add.className = 'catalog-add';
      add.innerHTML = `${catalogSvg(product.type, isIkea)}<strong></strong><small></small>`;
      add.querySelector('strong').textContent = product.name;
      add.querySelector('small').textContent = `${product.width} × ${product.depth} cm${product.productId ? ` · ${product.productId}` : ''}`;
      add.onclick = () => isIkea ? addProduct(product) : addBasicItem(product);
      card.append(add);
      if (isIkea) {
        const favorite = document.createElement('button');
        favorite.className = `favorite-button${isFavorite(product.productId) ? ' active' : ''}`;
        favorite.title = isFavorite(product.productId) ? 'Eltávolítás a kedvencekből' : 'Mentés a kedvencekhez';
        favorite.setAttribute('aria-label', favorite.title);
        favorite.textContent = isFavorite(product.productId) ? '♥' : '♡';
        favorite.onclick = () => toggleFavorite(product);
        card.append(favorite);
      }
      container.append(card);
    }
    $('catalogCount').textContent = `${filtered.length} darab`;
    $('favoriteCount').textContent = favorites.length;
    $('catalogEmpty').hidden = filtered.length > 0;
    document.querySelectorAll('[data-catalog-tab]').forEach(button => {
      const active = button.dataset.catalogTab === catalogTab;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-selected', String(active));
    });
  }

  function addBasicItem(product) {
    const center = world({ x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 });
    const value = scale() || 2;
    const item = {
      id: idFactory(), type: product.type, name: product.name, w: product.width, h: product.depth,
      rot: 0, x: center.x - product.width * value / 2, y: center.y - product.depth * value / 2
    };
    items().push(item);
    selected = item.id;
    save();
    renderProps();
    draw();
    flash(`Hozzáadva: ${product.name}`);
  }

  function addProduct(product) {
    try {
      const center = world({ x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 });
      const value = scale() || 2;
      const item = Core.createFurnitureItem(product, {
        x: center.x - Number(product.width) * value / 2,
        y: center.y - Number(product.depth) * value / 2
      }, idFactory);
      items().push(item);
      selected = item.id;
      save();
      renderProps();
      draw();
      flash(`Hozzáadva: ${product.name} · ${product.width} × ${product.depth} cm`);
    } catch (error) {
      flash(error.message || 'A termék nem adható hozzá.');
    }
  }

  function renderVariants() {
    const select = $('variant');
    select.innerHTML = '';
    Object.keys(room().variants).forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.append(option);
    });
    select.value = room().active;
  }

  function propertyField(container, label, value, onChange, options = {}) {
    const box = document.createElement('div');
    box.className = 'field';
    const fieldLabel = document.createElement('label');
    fieldLabel.textContent = label;
    const input = options.values ? document.createElement('select') : document.createElement('input');
    if (options.values) {
      for (const [optionValue, optionLabel] of options.values) {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionLabel;
        input.append(option);
      }
    } else {
      input.type = options.type || 'number';
      if (input.type === 'number') {
        input.min = options.min ?? '0.1';
        input.max = options.max ?? '5000';
        input.step = options.step || '0.1';
      }
    }
    input.value = value ?? '';
    input.addEventListener('change', () => {
      const next = input.tagName === 'SELECT' || input.type === 'text' ? input.value.trim() : Number(input.value);
      if ((input.type === 'number' && (!Number.isFinite(next) || (!options.allowZero && next <= 0))) || (input.type === 'text' && !next)) {
        input.value = value ?? '';
        return;
      }
      onChange(next);
    });
    box.append(fieldLabel, input);
    container.append(box);
    return input;
  }

  function renderGeometryProps(container) {
    const geometry = activeGeometry();
    if (!geometry) {
      container.innerHTML = '<div class="property-empty"><strong>Nincs aktív szobageometria</strong><p class="hint">Hozz létre egy geometriát, majd kattints sorban a falak végpontjaira.</p></div>';
      return;
    }
    const summary = document.createElement('div');
    summary.className = 'geometry-summary';
    summary.innerHTML = `<strong></strong><small>${geometry.vertices.length} falpont · ${geometry.closed ? 'zárt poligon' : 'nyitott vonal'}</small>`;
    summary.querySelector('strong').textContent = geometry.name;
    container.append(summary);
    propertyField(container, 'Geometria neve', geometry.name, value => {
      geometry.name = value;
      save(); renderGeometryControls(); renderProps();
    }, { type: 'text' });
    if (selectedVertex !== null && geometry.vertices[selectedVertex]) {
      const vertex = geometry.vertices[selectedVertex];
      const title = document.createElement('h3');
      title.textContent = `${selectedVertex + 1}. falpont`;
      container.append(title);
      for (const axis of ['x', 'y']) {
        propertyField(container, `${axis.toUpperCase()} koordináta (cm)`, vertex[axis].toFixed(1), value => {
          vertex[axis] = value;
          const previousWall = (selectedVertex - 1 + geometry.vertices.length) % geometry.vertices.length;
          geometry.confirmedWalls[previousWall] = false;
          geometry.confirmedWalls[selectedVertex] = false;
          save(); renderProps(); draw();
        }, { allowZero: true });
      }
    }
    const heading = document.createElement('h3');
    heading.textContent = 'Falhosszak';
    container.append(heading);
    const count = geometry.closed ? geometry.vertices.length : Math.max(0, geometry.vertices.length - 1);
    if (!count) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Kattints a tervre az első két falpont megadásához.';
      container.append(hint);
    }
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % geometry.vertices.length;
      const measured = Geometry.distance(geometry.vertices[index], geometry.vertices[next]);
      const row = document.createElement('div');
      row.className = 'wall-length-row';
      const label = document.createElement('label');
      label.textContent = `${index + 1}. fal ${geometry.confirmedWalls[index] ? '✓ pontos' : '≈ kép alapján'}`;
      const input = document.createElement('input');
      input.type = 'number'; input.min = '0.1'; input.max = '5000'; input.step = '0.1'; input.value = measured.toFixed(1);
      input.addEventListener('change', () => {
        try {
          geometry.vertices = Geometry.setWallLength(geometry.vertices, index, input.value, geometry.closed);
          geometry.confirmedWalls[index] = true;
          if (geometry.closed || index + 1 < geometry.vertices.length - 1) geometry.confirmedWalls[next] = false;
          save(); renderProps(); draw();
        } catch (error) {
          flash(error.message);
          input.value = measured.toFixed(1);
        }
      });
      row.append(label, input);
      container.append(row);
    }
    const note = document.createElement('p');
    note.className = 'hint geometry-note';
    note.textContent = '≈ = a kalibrált képből számolt, nem megerősített hossz. A pontos érték beírása elmozdítja a szakasz végpontját, így a torz rajz kézzel korrigálható.';
    container.append(note);
  }

  function renderArchitectureProps(container) {
    const geometry = activeGeometry();
    const object = geometry?.objects?.find(value => value.id === selectedArchitecture?.id);
    if (!object) {
      container.innerHTML = '<p class="hint">Válassz egy eszközt fent, majd kattints egy fal közelébe; vagy kattints egy meglévő nyílászáróra.</p>';
      return;
    }
    const names = { door: 'Ajtó', window: 'Ablak', radiator: 'Radiátor' };
    const summary = document.createElement('div');
    summary.className = `architecture-summary ${object.type}`;
    summary.innerHTML = `<strong>${names[object.type]}</strong><small>${object.wallIndex + 1}. falon</small>`;
    container.append(summary);
    propertyField(container, 'Megnevezés', object.name || names[object.type], value => { object.name = value; save(); renderProps(); draw(); }, { type: 'text' });
    propertyField(container, 'Szélesség (cm)', object.width, value => {
      const wall = Geometry.wallFrame(geometry.vertices, object.wallIndex, object.offset);
      if (!wall || value > wall.length) {
        flash('Az elem szélessége nem lehet nagyobb a falszakasznál.');
        renderProps();
        return;
      }
      object.width = value;
      object.offset = clamp(object.offset, value / 2, Math.max(value / 2, wall.length - value / 2));
      save(); renderProps(); draw();
    });
    propertyField(container, 'Pozíció a fal kezdetétől (cm)', object.offset, value => {
      const wall = Geometry.wallFrame(geometry.vertices, object.wallIndex, value);
      object.offset = wall ? clamp(value, object.width / 2, Math.max(object.width / 2, wall.length - object.width / 2)) : value;
      save(); renderProps(); draw();
    });
    if (object.type === 'door') {
      propertyField(container, 'Zsanér', object.hinge, value => { object.hinge = value; save(); draw(); }, { values: [['start', 'Bal / falszakasz eleje'], ['end', 'Jobb / falszakasz vége']] });
      propertyField(container, 'Nyitási irány', object.swing, value => { object.swing = value; save(); draw(); }, { values: [['in', 'A szoba belseje felé'], ['out', 'A szobából kifelé']] });
    } else {
      if (object.type === 'radiator') propertyField(container, 'Mélység (cm)', object.depth, value => { object.depth = value; save(); draw(); });
      propertyField(container, 'Magasság (cm)', object.height, value => { object.height = value; save(); draw(); });
    }
    const remove = document.createElement('button');
    remove.className = 'wide danger';
    remove.textContent = `${names[object.type]} törlése`;
    remove.onclick = () => {
      geometry.objects = geometry.objects.filter(value => value.id !== object.id);
      selectedArchitecture = null;
      save(); renderProps(); draw();
    };
    container.append(remove);
  }

  function renderProps() {
    const container = $('props');
    const item = items().find(value => value.id === selected);
    container.innerHTML = '';
    if (mode === 'walls') { renderGeometryProps(container); return; }
    if (mode === 'openings') { renderArchitectureProps(container); return; }
    if (!item) {
      container.innerHTML = '<p class="hint">Válassz egy bútort a terven, vagy adj hozzá egyet a bal oldali katalógusból.</p>';
      return;
    }

    if (item.source === 'ikea') {
      const metadata = document.createElement('div');
      metadata.className = 'product-meta';
      const changed = item.originalDimensions && (item.w !== item.originalDimensions.width || item.h !== item.originalDimensions.depth);
      metadata.innerHTML = '<span class="ikea-badge">IKEA</span><strong></strong><small></small>';
      metadata.querySelector('strong').textContent = item.productId || 'Cikkszám nélkül';
      metadata.querySelector('small').textContent = item.originalDimensions
        ? `Eredeti méret: ${item.originalDimensions.width} × ${item.originalDimensions.depth} cm${item.originalDimensions.height ? ` · M ${item.originalDimensions.height} cm` : ''}`
        : 'Importált termék';
      if (changed) {
        const warning = document.createElement('em');
        warning.textContent = 'A terven átméretezve';
        metadata.append(warning);
      }
      container.append(metadata);
    }

    const addField = (label, key, type = 'number', step = '1') => {
      const box = document.createElement('div');
      box.className = 'field';
      const fieldLabel = document.createElement('label');
      fieldLabel.textContent = label;
      const input = document.createElement('input');
      input.type = type;
      input.value = item[key];
      if (type === 'number') {
        input.min = key === 'rot' ? '-360' : '0.1';
        input.max = key === 'rot' ? '360' : '5000';
        input.step = step;
      }
      input.addEventListener('change', () => {
        const value = type === 'number' ? Number(input.value) : input.value.trim();
        if ((type === 'number' && (!Number.isFinite(value) || (key !== 'rot' && value <= 0))) || (type === 'text' && !value)) {
          input.value = item[key];
          return;
        }
        item[key] = value;
        save();
        renderProps();
        draw();
      });
      box.append(fieldLabel, input);
      container.append(box);
    };

    addField('Megnevezés', 'name', 'text');
    addField('Szélesség (cm)', 'w');
    addField('Mélység (cm)', 'h');
    addField('Forgatás (°)', 'rot');

    if (item.source === 'ikea') {
      const links = document.createElement('div');
      links.className = 'product-links';
      const productLink = document.createElement('a');
      productLink.href = item.productUrl;
      productLink.target = '_blank';
      productLink.rel = 'noopener noreferrer';
      productLink.textContent = 'Termékoldal ↗';
      const product = {
        name: item.name, productId: item.productId, category: item.category || 'storage', type: item.type,
        width: item.originalDimensions?.width || item.w, depth: item.originalDimensions?.depth || item.h,
        height: item.originalDimensions?.height, productUrl: item.productUrl
      };
      const favorite = document.createElement('button');
      favorite.textContent = isFavorite(item.productId) ? '♥ Kedvenc' : '♡ Kedvencekhez';
      favorite.onclick = () => toggleFavorite(product);
      links.append(productLink, favorite);
      container.append(links);
    }

    const buttons = document.createElement('div');
    buttons.className = 'small-actions';
    const rotate = document.createElement('button');
    rotate.textContent = '↻ 90°';
    rotate.onclick = () => {
      item.rot = (item.rot + 90) % 360;
      save(); renderProps(); draw();
    };
    const duplicate = document.createElement('button');
    duplicate.textContent = '⧉ Másolat';
    duplicate.onclick = () => duplicateSelected();
    const remove = document.createElement('button');
    remove.textContent = 'Törlés';
    remove.className = 'danger';
    remove.onclick = removeSelected;
    buttons.append(rotate, duplicate, remove);
    container.append(buttons);
  }

  function duplicateSelected() {
    const item = items().find(value => value.id === selected);
    if (!item) return;
    const copy = structuredClone(item);
    copy.id = idFactory();
    copy.x += 28;
    copy.y += 28;
    items().push(copy);
    selected = copy.id;
    save(); renderProps(); draw();
  }

  function removeSelected() {
    if (!selected) return;
    room().variants[room().active].items = items().filter(item => item.id !== selected);
    selected = null;
    save(); renderProps(); draw();
  }

  async function createGeometry() {
    if (!scale()) {
      flash('Előbb kalibráld az alaprajzot egy ismert szakasz alapján.');
      setMode('calibrate');
      return;
    }
    const answer = await ask('Új szobageometria', 'A falpontokat centiméterben tároljuk. A képi aránytalanságokat ezután a pontos falhosszakkal javíthatod.', [
      { key: 'name', label: 'Geometria neve', value: `Geometria ${geometries().length + 1}` }
    ]);
    if (!answer?.name?.trim()) return;
    const geometry = { id: idFactory(), name: answer.name.trim(), vertices: [], closed: false, confirmedWalls: [], objects: [] };
    geometries().push(geometry);
    room().activeGeometryId = geometry.id;
    selectedVertex = null;
    selectedArchitecture = null;
    save(); renderGeometryControls(); renderProps(); draw();
    flash('Kattints sorban a falak végpontjaira. A poligon legalább három ponttal zárható.');
  }

  function closeActiveGeometry() {
    const geometry = activeGeometry();
    if (!geometry || geometry.closed || geometry.vertices.length < 3) return;
    if (Geometry.polygonSelfIntersects(geometry.vertices, true)) {
      flash('A poligon önmetsző, ezért nem zárható. Mozgasd vagy töröld a hibás falpontot.');
      return;
    }
    geometry.closed = true;
    while (geometry.confirmedWalls.length < geometry.vertices.length) geometry.confirmedWalls.push(false);
    save(); renderGeometryControls(); renderProps(); draw();
    flash('A szobapoligon bezárva. A ≈ jelű falhosszakat ellenőrizd és írd át a pontos értékre.');
  }

  function hitVertexAt(worldPoint) {
    const geometry = activeGeometry();
    if (!geometry || !scale()) return -1;
    const threshold = 12 / view.z;
    let best = -1;
    let bestDistance = Infinity;
    geometry.vertices.forEach((vertex, index) => {
      const point = pointToWorld(vertex);
      const value = Math.hypot(worldPoint.x - point.x, worldPoint.y - point.y);
      if (value <= threshold && value < bestDistance) { best = index; bestDistance = value; }
    });
    return best;
  }

  function hitArchitectureAt(worldPoint) {
    const geometry = activeGeometry();
    if (!geometry || !scale()) return null;
    const point = pointToCm(worldPoint);
    const threshold = 10 / (view.z * scale());
    let best = null;
    for (const object of geometry.objects || []) {
      let value = Infinity;
      if (object.type === 'radiator') {
        const polygon = Geometry.radiatorPolygon(object, geometry.vertices);
        if (Geometry.pointInPolygon(point, polygon, true)) value = 0;
        else for (const [a, b] of Geometry.polygonEdges(polygon)) value = Math.min(value, Geometry.nearestPointOnSegment(point, a, b).distance);
      } else {
        const opening = Geometry.openingSegment(object, geometry.vertices);
        if (opening) value = Geometry.nearestPointOnSegment(point, opening.a, opening.b).distance;
      }
      if (value <= threshold && (!best || value < best.distance)) best = { id: object.id, type: object.type, distance: value };
    }
    return best;
  }

  async function addArchitectureAt(worldPoint) {
    const geometry = activeGeometry();
    if (!geometry || geometry.vertices.length < 2 || !openingTool) {
      flash('Válassz aktív geometriát és egy elhelyezendő építészeti elemet.');
      return;
    }
    if ((openingTool === 'door' || openingTool === 'radiator') && !geometry.closed) {
      flash('Ajtónyitási irányhoz és radiátorhoz előbb zárd be a szobapoligont.');
      return;
    }
    const nearest = Geometry.nearestWall(pointToCm(worldPoint), geometry.vertices, geometry.closed);
    const threshold = 24 / (view.z * scale());
    if (!nearest || nearest.distance > threshold) {
      flash('Kattints közelebb a kiválasztott falhoz.');
      return;
    }
    const definitions = {
      door: {
        title: 'Ajtó elhelyezése', fields: [
          { key: 'name', label: 'Megnevezés', value: 'Ajtó' },
          { key: 'width', label: 'Ajtó szélessége (cm)', value: '90', type: 'number' },
          { key: 'hinge', label: 'Zsanér helye', value: 'start', options: [['start', 'Bal / falszakasz eleje'], ['end', 'Jobb / falszakasz vége']] },
          { key: 'swing', label: 'Nyitási irány', value: 'in', options: [['in', 'A szoba belseje felé'], ['out', 'A szobából kifelé']] }
        ]
      },
      window: {
        title: 'Ablak elhelyezése', fields: [
          { key: 'name', label: 'Megnevezés', value: 'Ablak' },
          { key: 'width', label: 'Ablak szélessége (cm)', value: '120', type: 'number' },
          { key: 'height', label: 'Ablak magassága (cm)', value: '120', type: 'number' }
        ]
      },
      radiator: {
        title: 'Radiátor elhelyezése', fields: [
          { key: 'name', label: 'Megnevezés', value: 'Radiátor' },
          { key: 'width', label: 'Szélesség (cm)', value: '80', type: 'number' },
          { key: 'depth', label: 'Mélység (cm)', value: '12', type: 'number' },
          { key: 'height', label: 'Magasság (cm)', value: '60', type: 'number' }
        ]
      }
    };
    const definition = definitions[openingTool];
    const answer = await ask(definition.title, `${nearest.wallIndex + 1}. fal · minden méret valós centiméterben`, definition.fields);
    if (!answer) return;
    const width = Number(answer.width);
    if (!Number.isFinite(width) || width <= 0 || width > nearest.length) {
      flash('Az elem szélességének pozitívnak és a falnál rövidebbnek kell lennie.');
      return;
    }
    const object = {
      id: idFactory(), type: openingTool, name: answer.name.trim() || definition.title,
      wallIndex: nearest.wallIndex, offset: clamp(nearest.offset, width / 2, nearest.length - width / 2), width
    };
    if (openingTool === 'door') Object.assign(object, { hinge: answer.hinge, swing: answer.swing });
    if (openingTool === 'window') object.height = Number(answer.height);
    if (openingTool === 'radiator') Object.assign(object, { depth: Number(answer.depth), height: Number(answer.height) });
    if ([object.height, object.depth].filter(value => value !== undefined).some(value => !Number.isFinite(value) || value <= 0)) {
      flash('Minden megadott méretnek pozitív számnak kell lennie.');
      return;
    }
    geometry.objects.push(object);
    selectedArchitecture = { id: object.id, type: object.type };
    openingTool = null;
    document.querySelectorAll('#openingTools button').forEach(button => button.classList.remove('selected'));
    save(); renderProps(); draw();
  }

  function openRoom(id, recordChange = true) {
    if (!data.rooms[id]) id = 'room1';
    roomId = id;
    data.currentRoom = id;
    $('canvasRoomName').textContent = room().name;
    selected = null;
    selectedVertex = null;
    selectedArchitecture = null;
    snapGuides = [];
    lineStart = lineEnd = null;
    image = new Image();
    image.onload = () => {
      fit();
      renderRooms();
      renderVariants();
      renderGeometryControls();
      renderProps();
      save(recordChange);
      flash(`Megnyitva: ${room().name} · Ellenőrizd a méretarányt!`, 6500);
    };
    image.onerror = () => flash('Nem sikerült betölteni az alaprajzot.');
    image.src = plan().url;
    renderRooms();
  }

  function ask(title, hint, fields) {
    return new Promise(resolve => {
      const dialog = $('dialog');
      const container = $('dialogFields');
      $('dialogTitle').textContent = title;
      $('dialogHint').textContent = hint;
      container.innerHTML = '';
      for (const definition of fields) {
        const box = document.createElement('div');
        box.className = 'field';
        const label = document.createElement('label');
        label.textContent = definition.label;
        const input = definition.options ? document.createElement('select') : document.createElement('input');
        input.name = definition.key;
        if (definition.options) {
          for (const [value, text] of definition.options) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            input.append(option);
          }
        } else input.type = definition.type || 'text';
        input.value = definition.value ?? '';
        input.required = definition.required !== false;
        if (input.type === 'number') {
          input.min = definition.min ?? '0.01';
          input.max = definition.max ?? '5000';
          input.step = 'any';
        }
        box.append(label, input);
        container.append(box);
      }
      dialog.showModal();
      const close = () => {
        if (dialog.returnValue !== 'ok') return resolve(null);
        const result = {};
        fields.forEach(definition => { result[definition.key] = container.querySelector(`[name="${definition.key}"]`).value; });
        resolve(result);
      };
      dialog.addEventListener('close', close, { once: true });
    });
  }

  function fillImportFields(product, locked = false) {
    $('ikeaName').value = product.name || '';
    $('ikeaProductId').value = product.productId || '';
    $('ikeaWidth').value = product.width || '';
    $('ikeaDepth').value = product.depth || '';
    $('ikeaHeight').value = product.height || '';
    $('ikeaCategory').value = product.category || 'storage';
    ['ikeaName', 'ikeaProductId', 'ikeaWidth', 'ikeaDepth', 'ikeaHeight'].forEach(id => {
      $(id).readOnly = locked;
    });
    $('ikeaCategory').disabled = locked;
  }

  function resolveIkeaUrl() {
    const parsed = Core.parseIkeaProductUrl($('ikeaUrl').value);
    resolvedImport = null;
    $('ikeaManualFields').hidden = true;
    $('ikeaImportOk').disabled = true;
    $('ikeaSourceLink').hidden = true;
    if (!parsed.ok) {
      $('ikeaImportStatus').className = 'import-status error';
      $('ikeaImportStatus').textContent = parsed.error;
      return;
    }
    $('ikeaUrl').value = parsed.productUrl;
    $('ikeaSourceLink').href = parsed.productUrl;
    $('ikeaSourceLink').hidden = false;
    const known = Ikea.products.find(product => product.productId === parsed.productId);
    if (known) {
      resolvedImport = known;
      fillImportFields(known, true);
      $('ikeaImportStatus').className = 'import-status success';
      $('ikeaImportStatus').textContent = `Felismert termék: ${known.name}. A méreteket a ${Ikea.verifiedAt} napján ellenőrzött helyi katalógusból töltöttük be.`;
    } else {
      fillImportFields({
        name: parsed.suggestedName,
        productId: parsed.productId,
        category: 'storage'
      }, false);
      $('ikeaImportStatus').className = 'import-status warning';
      $('ikeaImportStatus').textContent = 'Ehhez a termékhez nincs ellenőrzött helyi adat. Nyisd meg a linket, és másold be a termékoldalon szereplő külső méreteket. Nem következtetünk hiányzó adatra.';
    }
    $('ikeaManualFields').hidden = false;
    $('ikeaImportOk').disabled = false;
  }

  function readImportForm() {
    if (resolvedImport) return Core.normalizeProduct(resolvedImport);
    const value = {
      name: $('ikeaName').value,
      productId: $('ikeaProductId').value,
      productUrl: $('ikeaUrl').value,
      width: $('ikeaWidth').value,
      depth: $('ikeaDepth').value,
      height: $('ikeaHeight').value,
      category: $('ikeaCategory').value,
      type: resolvedImport?.type || productTypeForCategory($('ikeaCategory').value)
    };
    return Core.normalizeProduct(value);
  }

  function openIkeaDialog() {
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
  }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  canvas.addEventListener('pointerdown', event => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const point = localPoint(event);
    const location = world(point);
    if (mode === 'pan' || spaceDown || event.button === 1) {
      drag = { type: 'pan', start: point, view: { ...view } };
      return;
    }
    if (mode === 'walls') {
      if (!scale()) { flash('Előbb kalibráld az alaprajzot.'); setMode('calibrate'); return; }
      const geometry = activeGeometry();
      if (!geometry) { flash('Hozz létre egy szobageometriát az „Új geometria” gombbal.'); return; }
      const vertexIndex = hitVertexAt(location);
      if (vertexIndex >= 0) {
        if (!geometry.closed && vertexIndex === 0 && geometry.vertices.length >= 3) {
          closeActiveGeometry();
          return;
        }
        selectedVertex = vertexIndex;
        selectedArchitecture = null;
        drag = { type: 'vertex', index: vertexIndex };
        renderProps(); draw();
        return;
      }
      if (geometry.closed) { selectedVertex = null; renderProps(); draw(); flash('A zárt geometrián a meglévő falpontok húzhatók.'); return; }
      const pointCm = pointToCm(location);
      geometry.vertices.push({ id: idFactory(), x: pointCm.x, y: pointCm.y });
      if (geometry.vertices.length > 1) geometry.confirmedWalls.push(false);
      selectedVertex = geometry.vertices.length - 1;
      save(); renderGeometryControls(); renderProps(); draw();
      return;
    }
    if (mode === 'openings') {
      const architecture = hitArchitectureAt(location);
      if (architecture) {
        selectedArchitecture = architecture;
        renderProps(); draw();
      } else if (openingTool) addArchitectureAt(location);
      else flash('Válassz fent ajtót, ablakot vagy radiátort, majd kattints egy falra.');
      return;
    }
    if (mode === 'calibrate' || mode === 'measure') {
      if (!lineStart) {
        lineStart = location;
        lineEnd = location;
        flash('Válaszd ki a második pontot.', 0);
      } else {
        lineEnd = location;
        const length = Math.hypot(location.x - lineStart.x, location.y - lineStart.y);
        if (length < 3) {
          flash('A kijelölt szakasz túl rövid.');
          lineStart = lineEnd = null;
          draw();
          return;
        }
        if (mode === 'calibrate') {
          ask('Méretarány beállítása', 'Add meg a kijelölt szakasz valós hosszát centiméterben.', [
            { key: 'cm', label: 'Valós hossz (cm)', value: '100', type: 'number' }
          ]).then(value => {
            if (value && Number(value.cm) > 0) {
              const nextScale = length / Number(value.cm);
              room().pxPerCm = nextScale;
              save();
              flash(`Méretarány beállítva: 1 cm = ${nextScale.toFixed(2)} px`);
              setMode('select');
            }
            lineStart = lineEnd = null;
            draw();
          });
        } else {
          if (scale()) {
            lastMeasurement = { start: { ...lineStart }, end: { ...lineEnd }, cm: length / scale() };
            flash(`Mért távolság: ${(length / scale()).toFixed(1)} cm`, 8000);
          }
          else flash('Előbb kalibráld az alaprajz méretarányát.');
          lineStart = lineEnd = null;
        }
      }
      draw();
      return;
    }
    const item = hit(location);
    selected = item?.id || null;
    if (item) drag = { type: 'furniture', id: item.id, from: location, x: item.x, y: item.y };
    renderProps();
    draw();
  });

  canvas.addEventListener('pointermove', event => {
    const point = localPoint(event);
    const location = world(point);
    if (drag?.type === 'pan') {
      view.x = drag.view.x + point.x - drag.start.x;
      view.y = drag.view.y + point.y - drag.start.y;
      draw();
    } else if (drag?.type === 'furniture') {
      const item = items().find(value => value.id === drag.id);
      if (item) {
        item.x = drag.x + location.x - drag.from.x;
        item.y = drag.y + location.y - drag.from.y;
        snapGuides = [];
        if (snapEnabled && scale()) {
          const itemCm = itemToCm(item);
          const geometry = activeGeometry();
          const snapped = Geometry.snapFurniture(itemCm, {
            threshold: 10 / (view.z * scale()),
            walls: $('snapWalls').checked && Boolean(geometry),
            roomVertices: geometry?.vertices,
            roomClosed: geometry?.closed,
            furniture: $('snapFurniture').checked,
            otherItems: items().filter(value => value.id !== item.id).map(itemToCm),
            grid: $('snapGrid').checked,
            gridSize: 5
          });
          item.x = snapped.x * scale();
          item.y = snapped.y * scale();
          snapGuides = snapped.guides;
        }
        draw();
      }
    } else if (drag?.type === 'vertex') {
      const geometry = activeGeometry();
      const vertex = geometry?.vertices?.[drag.index];
      if (vertex && scale()) {
        const pointCm = pointToCm(location);
        vertex.x = pointCm.x;
        vertex.y = pointCm.y;
        const previousWall = (drag.index - 1 + geometry.vertices.length) % geometry.vertices.length;
        geometry.confirmedWalls[previousWall] = false;
        geometry.confirmedWalls[drag.index] = false;
        draw();
      }
    } else if (lineStart && !drag) {
      lineEnd = location;
      draw();
    }
  });

  function endDrag() {
    if (drag?.type === 'furniture') {
      const item = items().find(value => value.id === drag.id);
      save(); renderProps(); draw();
    } else if (drag?.type === 'vertex') {
      save(); renderGeometryControls(); renderProps(); draw();
    }
    snapGuides = [];
    drag = null;
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    zoom(Math.exp(-event.deltaY * 0.0014), localPoint(event));
  }, { passive: false });

  window.addEventListener('keydown', event => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? redo() : undo(); return;
    }
    if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault(); redo(); return;
    }
    if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selected) {
      event.preventDefault(); duplicateSelected(); return;
    }
    if (!typing && selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const item = items().find(value => value.id === selected);
      if (item) {
        const step = (event.shiftKey ? 10 : 1) * (scale() || 2);
        if (event.key === 'ArrowLeft') item.x -= step;
        if (event.key === 'ArrowRight') item.x += step;
        if (event.key === 'ArrowUp') item.y -= step;
        if (event.key === 'ArrowDown') item.y += step;
        save(); draw();
      }
      return;
    }
    if (event.code === 'Space' && !typing) { event.preventDefault(); spaceDown = true; }
    if (event.key === 'Escape') {
      selected = null; selectedVertex = null; selectedArchitecture = null; openingTool = null;
      snapGuides = []; lineStart = lineEnd = null; lastMeasurement = null;
      document.querySelectorAll('#openingTools button').forEach(button => button.classList.remove('selected'));
      renderProps(); draw();
    }
    if (!typing && (event.key === 'Delete' || event.key === 'Backspace')) {
      if (mode === 'openings' && selectedArchitecture) {
        const geometry = activeGeometry();
        geometry.objects = geometry.objects.filter(value => value.id !== selectedArchitecture.id);
        selectedArchitecture = null;
        save(); renderProps(); draw();
      } else if (mode === 'select') removeSelected();
    }
  });
  window.addEventListener('keyup', event => { if (event.code === 'Space') spaceDown = false; });
  window.addEventListener('resize', draw);

  ['select', 'walls', 'openings', 'calibrate', 'measure', 'pan'].forEach(name => {
    $(`mode${name[0].toUpperCase()}${name.slice(1)}`).onclick = () => setMode(name);
  });
  $('zoomOut').onclick = () => zoom(1 / 1.25);
  $('zoomIn').onclick = () => zoom(1.25);
  $('fit').onclick = fit;
  $('undo').onclick = undo;
  $('redo').onclick = redo;
  $('showReference').onchange = draw;

  $('snap').onclick = () => {
    snapEnabled = !snapEnabled;
    $('snap').classList.toggle('selected', snapEnabled);
    $('snap').setAttribute('aria-pressed', String(snapEnabled));
    $('snap').textContent = `⊞ Igazítás: ${snapEnabled ? 'be' : 'ki'}`;
  };

  $('geometrySelect').onchange = event => {
    room().activeGeometryId = event.target.value || null;
    selectedVertex = null;
    selectedArchitecture = null;
    save(); renderGeometryControls(); renderProps(); draw();
  };
  $('floorMaterial').onchange = event => {
    const geometry = activeGeometry();
    if (!geometry) return;
    geometry.floorMaterial = event.target.value;
    save(); draw();
    flash('Padlóburkolat frissítve. A geometriai méretek nem változtak.');
  };
  $('newGeometry').onclick = createGeometry;
  $('closeGeometry').onclick = closeActiveGeometry;
  $('deleteGeometry').onclick = () => {
    const geometry = activeGeometry();
    if (!geometry || !confirm(`Biztosan törlöd ezt a szobageometriát és a hozzá tartozó nyílászárókat?\n\n${geometry.name}`)) return;
    room().geometries = geometries().filter(value => value.id !== geometry.id);
    room().activeGeometryId = room().geometries[0]?.id || null;
    selectedVertex = null;
    selectedArchitecture = null;
    save(); renderGeometryControls(); renderProps(); draw();
  };
  const openingLabels = { door: 'Ajtó', window: 'Ablak', radiator: 'Radiátor' };
  for (const [type, id] of [['door', 'addDoor'], ['window', 'addWindow'], ['radiator', 'addRadiator']]) {
    $(id).onclick = () => {
      openingTool = openingTool === type ? null : type;
      document.querySelectorAll('#openingTools button').forEach(button => button.classList.toggle('selected', button.id === id && openingTool === type));
      flash(openingTool ? `${openingLabels[type]}: kattints a kívánt fal közelébe.` : 'Elhelyezés megszakítva.');
    };
  }
  for (const [id, other] of [['clearance70', 'clearance80'], ['clearance80', 'clearance70']]) {
    $(id).onchange = () => { if ($(id).checked) $(other).checked = false; draw(); };
  }

  $('variant').onchange = event => {
    room().active = event.target.value;
    selected = null;
    save(); renderProps(); draw();
  };

  $('newVariant').onclick = async () => {
    const answer = await ask('Új berendezési változat', 'A jelenlegi változat bútorait lemásoljuk.', [
      { key: 'name', label: 'Változat neve', value: 'Új változat' }
    ]);
    const name = answer?.name?.trim();
    if (!name) return;
    if (room().variants[name]) return flash('Már létezik ilyen nevű változat.');
    room().variants[name] = { items: structuredClone(items()) };
    room().active = name;
    selected = null;
    save(); renderVariants(); renderProps(); draw();
  };

  $('deleteVariant').onclick = () => {
    if (Object.keys(room().variants).length < 2) return flash('Az utolsó változat nem törölhető.');
    if (!confirm('Biztosan törlöd ezt a változatot?')) return;
    delete room().variants[room().active];
    room().active = Object.keys(room().variants)[0];
    selected = null;
    save(); renderVariants(); renderProps(); draw();
  };

  $('renameRoom').onclick = async () => {
    const answer = await ask('Helyiség átnevezése', 'Adj beszédes nevet az alaprajznak.', [
      { key: 'name', label: 'Helyiség neve', value: room().name }
    ]);
    if (answer?.name?.trim()) {
      room().name = answer.name.trim();
      $('canvasRoomName').textContent = room().name;
      save(); renderRooms();
    }
  };

  $('resetRoom').onclick = () => {
    if (!confirm('Töröljük az aktuális változat összes bútorát?')) return;
    room().variants[room().active].items = [];
    selected = null;
    save(); renderProps(); draw();
  };

  $('customFurniture').onclick = async () => {
    const value = await ask('Egyedi méretű bútor', 'Add meg a bútor pontos méretét centiméterben.', [
      { key: 'name', label: 'Megnevezés', value: 'Saját bútor' },
      { key: 'w', label: 'Szélesség (cm)', value: '120', type: 'number' },
      { key: 'h', label: 'Mélység (cm)', value: '60', type: 'number' }
    ]);
    if (value && Number(value.w) > 0 && Number(value.h) > 0) {
      addBasicItem({ type: 'custom', name: value.name.trim() || 'Saját bútor', width: Number(value.w), depth: Number(value.h) });
    }
  };

  $('floorPlanUpload').onchange = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return flash('PNG, JPEG vagy WebP alaprajz tölthető fel.');
    if (file.size > 3 * 1024 * 1024) return flash('A helyi mentés védelmében legfeljebb 3 MB-os alaprajz tölthető fel.', 8000);
    const reader = new FileReader();
    reader.onerror = () => flash('A képfájl nem olvasható.');
    reader.onload = async () => {
      const testImage = new Image();
      testImage.onerror = () => flash('A kiválasztott fájl nem érvényes kép.');
      testImage.onload = async () => {
        const answer = await ask('Saját alaprajz', 'A kép külön helyiségként kerül a tervek közé. Ezután kalibráld egy ismert szakasz alapján.', [
          { key: 'name', label: 'Helyiség neve', value: file.name.replace(/\.[^.]+$/, '') || 'Saját alaprajz' }
        ]);
        if (!answer?.name?.trim()) return;
        const id = `custom-${idFactory()}`;
        const custom = { id, name: answer.name.trim(), url: String(reader.result), pxPerCm: null, reference: null, isCustom: true };
        data.customPlans.push(custom);
        data.rooms[id] = { name: custom.name, pxPerCm: null, active: 'Alap', variants: { Alap: emptyVariant() }, geometries: [], activeGeometryId: null };
        if (!save()) {
          data.customPlans = data.customPlans.filter(value => value.id !== id);
          delete data.rooms[id];
          return;
        }
        openRoom(id, false);
        setMode('calibrate');
      };
      testImage.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  document.querySelectorAll('[data-catalog-tab]').forEach(button => {
    button.onclick = () => {
      catalogTab = button.dataset.catalogTab;
      populateCategoryFilter();
      renderCatalog();
    };
  });
  $('catalogSearch').addEventListener('input', renderCatalog);
  $('catalogCategory').addEventListener('change', renderCatalog);

  Object.entries(Ikea.categories).forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    $('ikeaCategory').append(option);
  });
  $('importIkea').onclick = openIkeaDialog;
  $('resolveIkea').onclick = resolveIkeaUrl;
  $('ikeaUrl').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); resolveIkeaUrl(); }
  });
  $('ikeaForm').addEventListener('submit', event => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    try {
      const product = readImportForm();
      addProduct(product);
      if ($('ikeaSaveFavorite').checked && !isFavorite(product.productId)) {
        favorites = Core.saveFavorites(localStorage, [...favorites, product]);
        renderCatalog();
      }
      $('ikeaDialog').close('import');
    } catch (error) {
      $('ikeaImportStatus').className = 'import-status error';
      $('ikeaImportStatus').textContent = error.message;
    }
  });

  $('exportJSON').onclick = () => {
    const exportData = structuredClone(data);
    exportData.favoriteProducts = favorites;
    exportData.exportedBy = 'Zuglak Studio 1.6';
    download('zuglak-tervek.json', new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }));
  };

  $('importJSON').onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!Core.isValidPlanData(imported, ORIGINAL_PLANS.map(value => value.id))) throw new Error('Hibás fájl');
      if (!confirm('Betöltjük a fájlt? Ez felülírja a böngésző jelenlegi terveit.')) return;
      const importedFavorites = imported.favoriteProducts;
      const nextData = Core.migratePlanData(imported, ORIGINAL_PLANS.map(value => value.id));
      delete nextData.favoriteProducts;
      delete nextData.exportedBy;
      nextData.customPlans = Array.isArray(nextData.customPlans) ? nextData.customPlans : [];
      const previousData = data;
      const previousRoomId = roomId;
      const previousSelected = selected;
      data = nextData;
      roomId = data.currentRoom && data.rooms[data.currentRoom] ? data.currentRoom : 'room1';
      selected = null;
      if (!save()) {
        data = previousData;
        roomId = previousRoomId;
        selected = previousSelected;
        if (history.at(-1) === lastSnapshot) history.pop();
        future = [];
        localStorage.setItem(Core.PLAN_STORAGE_KEY, lastSnapshot);
        updateHistoryButtons();
        throw new Error('A terv nem fér el a helyi tárhelyen.');
      }
      if (Array.isArray(importedFavorites)) {
        try {
          favorites = Core.saveFavorites(localStorage, importedFavorites);
        } catch {
          flash('A terv betöltődött, de a kedvencek mentéséhez nincs elég hely.', 8000);
        }
      }
      populateCategoryFilter();
      renderCatalog();
      openRoom(roomId, false);
      flash('Sikeres tervbetöltés.');
    } catch (error) {
      flash(error?.message === 'A terv nem fér el a helyi tárhelyen.'
        ? error.message
        : 'A JSON nem érvényes Zuglak tervfájl.');
    } finally {
      event.target.value = '';
    }
  };

  $('exportPNG').onclick = () => {
    if (!image) return;
    const output = document.createElement('canvas');
    output.width = image.width;
    output.height = image.height;
    const previousContext = ctx;
    const previousSelected = selected;
    const previousSelectedVertex = selectedVertex;
    const previousSelectedArchitecture = selectedArchitecture;
    const previousWarningItemIds = warningItemIds;
    const previousZoom = view.z;
    try {
      ctx = output.getContext('2d');
      ctx.drawImage(image, 0, 0);
      selected = null;
      selectedVertex = null;
      selectedArchitecture = null;
      warningItemIds = new Set();
      view.z = 1;
      drawRoomGeometry();
      items().forEach(drawItem);
    } finally {
      ctx = previousContext;
      selected = previousSelected;
      selectedVertex = previousSelectedVertex;
      selectedArchitecture = previousSelectedArchitecture;
      warningItemIds = previousWarningItemIds;
      view.z = previousZoom;
    }
    output.toBlob(blob => {
      if (blob) download(`zuglak-${room().name.replace(/\W/g, '_')}-${room().active}.png`, blob);
    }, 'image/png');
  };

  updateHistoryButtons();
  populateCategoryFilter();
  renderCatalog();
  openRoom(roomId, false);
  setMode('select');
})();
