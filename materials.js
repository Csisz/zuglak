/*
 * Zuglak Studio 2.0 – curated interior material library.
 * Colours are visual approximations of finishes, not supplier colour codes.
 * `tile` is the real-world size of one texture repeat in centimetres.
 * Texture generation (makeTextureCanvas) runs only in the browser and is shared
 * by the 2D plan (as canvas patterns) and the 3D scene (as CanvasTextures).
 */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  root.ZuglakMaterials = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const groups = Object.freeze({
    floor: 'Padló',
    wall: 'Fal',
    wood: 'Fa és laminált',
    fabric: 'Kárpit',
    stone: 'Kő és munkalap',
    metal: 'Fém',
    ceramic: 'Kerámia',
    rug: 'Szőnyeg'
  });

  // pattern: planks | herringbone | grain | tiles | concrete | stone | weave | boucle | knit | plain | marble | terrazzo
  const list = [
    // Floors
    { id: 'floor-oak-light', group: 'floor', name: 'Világos tölgy parketta', color: '#d6b98f', pattern: 'planks', tile: 240, plank: [120, 18], roughness: 0.62 },
    { id: 'floor-oak-natural', group: 'floor', name: 'Natúr tölgy parketta', color: '#c39563', pattern: 'planks', tile: 280, plank: [140, 20], roughness: 0.6 },
    { id: 'floor-oak-herringbone', group: 'floor', name: 'Halszálkás tölgy', color: '#c9a173', pattern: 'herringbone', tile: 84, plank: [60, 12], roughness: 0.6 },
    { id: 'floor-walnut', group: 'floor', name: 'Sötét dió parketta', color: '#7c5a3f', pattern: 'planks', tile: 280, plank: [140, 19], roughness: 0.55 },
    { id: 'floor-birch', group: 'floor', name: 'Nyír rétegelt lemez', color: '#e3cfab', pattern: 'planks', tile: 244, plank: [244, 61], roughness: 0.58 },
    { id: 'floor-concrete', group: 'floor', name: 'Csiszolt beton', color: '#b9b5ae', pattern: 'concrete', tile: 200, roughness: 0.75 },
    { id: 'floor-stone', group: 'floor', name: 'Természetes kő lap', color: '#cfc6b8', pattern: 'stone', tile: 120, cell: [60, 60], roughness: 0.68 },
    { id: 'floor-tile-grey', group: 'floor', name: 'Szürke kerámia 60×60', color: '#bdbab4', pattern: 'tiles', tile: 120, cell: [60, 60], grout: '#a19d96', roughness: 0.5 },
    { id: 'floor-tile-white', group: 'floor', name: 'Fehér kerámia 30×60', color: '#e8e5df', pattern: 'tiles', tile: 120, cell: [60, 30], grout: '#cfcac2', roughness: 0.4 },
    { id: 'floor-terracotta', group: 'floor', name: 'Terrakotta lap', color: '#b86f4c', pattern: 'tiles', tile: 80, cell: [20, 20], grout: '#d9c4b0', roughness: 0.8 },
    { id: 'floor-terrazzo', group: 'floor', name: 'Világos terrazzo', color: '#ddd7cd', pattern: 'terrazzo', tile: 100, roughness: 0.5 },
    // Walls
    { id: 'wall-warm-white', group: 'wall', name: 'Meleg fehér', color: '#f3eee6', pattern: 'plain', roughness: 0.92 },
    { id: 'wall-off-white', group: 'wall', name: 'Törtfehér', color: '#ebe5da', pattern: 'plain', roughness: 0.92 },
    { id: 'wall-greige', group: 'wall', name: 'Meleg greige', color: '#d8cfc2', pattern: 'plain', roughness: 0.92 },
    { id: 'wall-soft-grey', group: 'wall', name: 'Lágy szürke', color: '#cfcdc8', pattern: 'plain', roughness: 0.92 },
    { id: 'wall-sage', group: 'wall', name: 'Tompa zsályazöld', color: '#a9b39b', pattern: 'plain', roughness: 0.92 },
    { id: 'wall-terracotta', group: 'wall', name: 'Terrakotta', color: '#c08a6c', pattern: 'plain', roughness: 0.92 },
    { id: 'wall-dusty-blue', group: 'wall', name: 'Poros kék', color: '#a7b4bb', pattern: 'plain', roughness: 0.92 },
    { id: 'wall-concrete', group: 'wall', name: 'Beton hatás', color: '#b7b3ab', pattern: 'concrete', tile: 200, roughness: 0.85 },
    // Wood and boards
    { id: 'wood-oak-light', group: 'wood', name: 'Világos tölgy', color: '#d6b98f', pattern: 'grain', tile: 80, roughness: 0.55 },
    { id: 'wood-oak-natural', group: 'wood', name: 'Natúr tölgy', color: '#b98c5a', pattern: 'grain', tile: 80, roughness: 0.55 },
    { id: 'wood-walnut', group: 'wood', name: 'Dió', color: '#6f4c34', pattern: 'grain', tile: 80, roughness: 0.5 },
    { id: 'wood-ash', group: 'wood', name: 'Kőris', color: '#cdb38c', pattern: 'grain', tile: 80, roughness: 0.55 },
    { id: 'wood-birch-ply', group: 'wood', name: 'Nyír rétegelt', color: '#e2cda6', pattern: 'grain', tile: 80, roughness: 0.6 },
    { id: 'wood-white', group: 'wood', name: 'Fehér matt', color: '#f1efea', pattern: 'plain', roughness: 0.7 },
    { id: 'wood-cashmere', group: 'wood', name: 'Kasmír bézs lakk', color: '#ddd2c2', pattern: 'plain', roughness: 0.6 },
    { id: 'wood-sage', group: 'wood', name: 'Zsályazöld lakk', color: '#9eaa93', pattern: 'plain', roughness: 0.6 },
    { id: 'wood-graphite', group: 'wood', name: 'Grafit matt', color: '#4b4b49', pattern: 'plain', roughness: 0.65 },
    { id: 'wood-black', group: 'wood', name: 'Fekete-barna', color: '#2f2924', pattern: 'grain', tile: 80, roughness: 0.55 },
    // Fabrics
    { id: 'fabric-oat', group: 'fabric', name: 'Zabszínű len', color: '#d9cfbf', pattern: 'weave', tile: 12, roughness: 0.95 },
    { id: 'fabric-light-grey', group: 'fabric', name: 'Világosszürke szövet', color: '#c7c6c2', pattern: 'weave', tile: 12, roughness: 0.95 },
    { id: 'fabric-stone-grey', group: 'fabric', name: 'Kőszürke szövet', color: '#9c9a95', pattern: 'weave', tile: 12, roughness: 0.95 },
    { id: 'fabric-charcoal', group: 'fabric', name: 'Antracit szövet', color: '#55534f', pattern: 'weave', tile: 12, roughness: 0.95 },
    { id: 'fabric-cream-boucle', group: 'fabric', name: 'Krém bouclé', color: '#ece6da', pattern: 'boucle', tile: 16, roughness: 1 },
    { id: 'fabric-sage', group: 'fabric', name: 'Zsálya bársony', color: '#8f9c86', pattern: 'weave', tile: 10, roughness: 0.85 },
    { id: 'fabric-terracotta', group: 'fabric', name: 'Terrakotta bouclé', color: '#b77457', pattern: 'boucle', tile: 16, roughness: 1 },
    { id: 'fabric-navy', group: 'fabric', name: 'Mélykék szövet', color: '#3f4b5e', pattern: 'weave', tile: 12, roughness: 0.95 },
    { id: 'fabric-mustard', group: 'fabric', name: 'Mustár szövet', color: '#c49a45', pattern: 'weave', tile: 12, roughness: 0.95 },
    { id: 'leather-cognac', group: 'fabric', name: 'Konyak bőr', color: '#9a5d37', pattern: 'plain', roughness: 0.55 },
    { id: 'linen-white', group: 'fabric', name: 'Fehér ágynemű', color: '#f6f3ee', pattern: 'weave', tile: 8, roughness: 0.95 },
    // Stone and worktops
    { id: 'stone-white-quartz', group: 'stone', name: 'Fehér kvarc', color: '#f0eeea', pattern: 'terrazzo', tile: 80, roughness: 0.25 },
    { id: 'stone-marble', group: 'stone', name: 'Carrara márvány', color: '#eceae6', pattern: 'marble', tile: 120, roughness: 0.2 },
    { id: 'stone-concrete', group: 'stone', name: 'Beton munkalap', color: '#a9a59d', pattern: 'concrete', tile: 120, roughness: 0.7 },
    { id: 'stone-dark', group: 'stone', name: 'Sötét gránit', color: '#3c3b39', pattern: 'terrazzo', tile: 80, roughness: 0.3 },
    // Metals
    { id: 'metal-black', group: 'metal', name: 'Fekete acél', color: '#262524', pattern: 'plain', roughness: 0.45, metalness: 0.6 },
    { id: 'metal-steel', group: 'metal', name: 'Szálcsiszolt acél', color: '#b9bbbd', pattern: 'plain', roughness: 0.35, metalness: 0.9 },
    { id: 'metal-brass', group: 'metal', name: 'Sárgaréz', color: '#b89558', pattern: 'plain', roughness: 0.32, metalness: 0.9 },
    // Ceramics
    { id: 'ceramic-white', group: 'ceramic', name: 'Fehér porcelán', color: '#fbfbfa', pattern: 'plain', roughness: 0.12 },
    { id: 'ceramic-glass', group: 'ceramic', name: 'Üveg', color: '#d9e9ec', pattern: 'plain', roughness: 0.05, transparent: true, opacity: 0.35 },
    { id: 'ceramic-terracotta', group: 'ceramic', name: 'Terrakotta kerámia', color: '#b5684a', pattern: 'plain', roughness: 0.8 },
    // Rugs
    { id: 'rug-wool-natural', group: 'rug', name: 'Natúr gyapjú', color: '#d8ccb8', pattern: 'knit', tile: 30, roughness: 1 },
    { id: 'rug-jute', group: 'rug', name: 'Juta', color: '#b99b72', pattern: 'knit', tile: 20, roughness: 1 },
    { id: 'rug-grey', group: 'rug', name: 'Szürke gyapjú', color: '#b9b6b0', pattern: 'knit', tile: 30, roughness: 1 },
    { id: 'rug-terracotta', group: 'rug', name: 'Rozsda gyapjú', color: '#b07a5c', pattern: 'knit', tile: 30, roughness: 1 },
    { id: 'rug-sage', group: 'rug', name: 'Zsálya gyapjú', color: '#a7ae98', pattern: 'knit', tile: 30, roughness: 1 },
    { id: 'rug-ivory', group: 'rug', name: 'Elefántcsont', color: '#ede6d8', pattern: 'knit', tile: 30, roughness: 1 },
    { id: 'plant-green', group: 'rug', name: 'Levélzöld', color: '#4f7a52', pattern: 'plain', roughness: 0.8, hidden: true },
    { id: 'emissive-warm', group: 'metal', name: 'Lámpafény', color: '#fff1d6', pattern: 'plain', roughness: 1, emissive: '#ffdca0', hidden: true },
    { id: 'screen-black', group: 'metal', name: 'Kijelző', color: '#141618', pattern: 'plain', roughness: 0.15, hidden: true }
  ];

  const byIdMap = new Map(list.map(material => [material.id, Object.freeze(material)]));

  // Legacy 1.6 floor ids → 2.0 materials.
  const legacyFloor = { 'oak-light': 'floor-oak-light', 'oak-natural': 'floor-oak-natural', walnut: 'floor-walnut', plain: 'floor-concrete' };

  function get(id, fallback) {
    return byIdMap.get(id) || byIdMap.get(legacyFloor[id]) || byIdMap.get(fallback) || list[0];
  }

  function inGroup(...names) {
    return list.filter(material => names.includes(material.group) && !material.hidden);
  }

  function hexToRgb(hex) {
    const value = String(hex || '#888888').replace('#', '');
    const full = value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value;
    const number = parseInt(full, 16);
    return { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255 };
  }

  function shade(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const apply = channel => Math.max(0, Math.min(255, Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount))));
    return `#${[apply(r), apply(g), apply(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }

  function mix(a, b, t) {
    const x = hexToRgb(a);
    const y = hexToRgb(b);
    const channel = (p, q) => Math.round(p + (q - p) * t);
    return `#${[channel(x.r, y.r), channel(x.g, y.g), channel(x.b, y.b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }

  // Deterministic pseudo random generator so textures are stable across reloads.
  function rng(seed) {
    let state = seed >>> 0 || 1;
    return () => {
      state ^= state << 13; state >>>= 0;
      state ^= state >> 17;
      state ^= state << 5; state >>>= 0;
      return state / 4294967296;
    };
  }

  function seedFrom(text) {
    let hash = 2166136261;
    for (const ch of String(text)) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }

  function grainStrokes(ctx, x, y, w, h, color, random, density = 1, vertical = false) {
    const count = Math.max(4, Math.round((vertical ? w : h) / 3 * density));
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    for (let index = 0; index < count; index += 1) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.05 + random() * 0.13;
      ctx.lineWidth = 0.5 + random() * 1.4;
      ctx.beginPath();
      if (!vertical) {
        const yy = y + random() * h;
        ctx.moveTo(x, yy);
        const wave = (random() - 0.5) * h * 0.25;
        ctx.bezierCurveTo(x + w * 0.3, yy + wave, x + w * 0.6, yy - wave, x + w, yy + (random() - 0.5) * 2);
      } else {
        const xx = x + random() * w;
        ctx.moveTo(xx, y);
        const wave = (random() - 0.5) * w * 0.25;
        ctx.bezierCurveTo(xx + wave, y + h * 0.3, xx - wave, y + h * 0.6, xx + (random() - 0.5) * 2, y + h);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draws a seamless texture for a material. `size` is the canvas edge in pixels;
   * the texture covers `material.tile` cm. Returns an HTMLCanvasElement.
   */
  function makeTextureCanvas(material, size = 512, documentRef = globalThis.document) {
    const canvas = documentRef.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const random = rng(seedFrom(material.id));
    const base = material.color;
    const tile = material.tile || 100;
    const px = size / tile; // canvas pixels per cm
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    const speckle = (count, amount, alpha, radius = 1) => {
      for (let index = 0; index < count; index += 1) {
        ctx.globalAlpha = alpha * random();
        ctx.fillStyle = random() > 0.5 ? shade(base, amount) : shade(base, -amount);
        ctx.beginPath();
        ctx.arc(random() * size, random() * size, radius * (0.4 + random()), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    switch (material.pattern) {
      case 'planks': {
        const [plankLength, plankWidth] = material.plank || [120, 18];
        const rows = Math.max(1, Math.round(tile / plankWidth));
        const rowHeight = size / rows;
        for (let row = 0; row < rows; row += 1) {
          const offset = ((row * 0.37) % 1) * plankLength * px;
          for (let x = -offset; x < size; x += plankLength * px) {
            const tone = (random() - 0.5) * 0.26;
            const color = mix(shade(base, tone), random() > 0.5 ? '#c9a06a' : '#e2cba6', 0.12 * random());
            const drawPlank = xx => {
              ctx.fillStyle = color;
              ctx.fillRect(xx, row * rowHeight, plankLength * px, rowHeight);
              grainStrokes(ctx, xx, row * rowHeight, plankLength * px, rowHeight, shade(base, -0.35), random, 1.4);
              ctx.globalAlpha = 0.5;
              ctx.fillStyle = shade(base, -0.42);
              ctx.fillRect(xx, row * rowHeight, Math.max(1, px * 0.25), rowHeight);
              ctx.globalAlpha = 1;
            };
            drawPlank(x);
            if (x + plankLength * px > size) drawPlank(x - size);
          }
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = shade(base, -0.4);
          ctx.fillRect(0, row * rowHeight, size, Math.max(1, px * 0.25));
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'herringbone': {
        const [length, width] = material.plank || [60, 12];
        const L = length * px; const W = width * px;
        ctx.save();
        for (let gx = -2; gx < size / W + 2; gx += 1) {
          for (let gy = -2; gy < size / L + 4; gy += 1) {
            for (const flip of [0, 1]) {
              const tone = (random() - 0.5) * 0.18;
              ctx.save();
              const x = gx * W * 2 + (flip ? W : 0);
              const y = gy * L + gx * 0 + (flip ? W : 0) + ((gx % 2) * L / 2);
              ctx.translate(x, y);
              ctx.rotate(flip ? -Math.PI / 4 : Math.PI / 4);
              ctx.fillStyle = shade(base, tone);
              ctx.fillRect(0, 0, L * 0.7, W);
              grainStrokes(ctx, 0, 0, L * 0.7, W, shade(base, -0.35), random, 1.6);
              ctx.strokeStyle = shade(base, -0.4); ctx.globalAlpha = 0.5; ctx.lineWidth = Math.max(1, px * 0.2);
              ctx.strokeRect(0, 0, L * 0.7, W);
              ctx.restore();
            }
          }
        }
        ctx.restore();
        break;
      }
      case 'grain': {
        grainStrokes(ctx, 0, 0, size, size, shade(base, -0.38), random, 1.1);
        grainStrokes(ctx, 0, 0, size, size, shade(base, 0.2), random, 0.4);
        break;
      }
      case 'tiles':
      case 'stone': {
        const [cw, ch] = material.cell || [60, 60];
        const grout = material.grout || shade(base, -0.2);
        ctx.fillStyle = grout;
        ctx.fillRect(0, 0, size, size);
        const gap = Math.max(1, px * (material.pattern === 'stone' ? 0.35 : 0.3));
        for (let y = 0; y < size; y += ch * px) {
          for (let x = 0; x < size; x += cw * px) {
            const tone = (random() - 0.5) * (material.pattern === 'stone' ? 0.14 : 0.06);
            ctx.fillStyle = shade(base, tone);
            ctx.fillRect(x + gap / 2, y + gap / 2, cw * px - gap, ch * px - gap);
            if (material.pattern === 'stone') {
              ctx.save(); ctx.beginPath(); ctx.rect(x, y, cw * px, ch * px); ctx.clip();
              for (let index = 0; index < 90; index += 1) {
                ctx.globalAlpha = 0.08 * random();
                ctx.fillStyle = random() > 0.5 ? shade(base, -0.25) : shade(base, 0.25);
                ctx.beginPath(); ctx.arc(x + random() * cw * px, y + random() * ch * px, 1 + random() * 5, 0, Math.PI * 2); ctx.fill();
              }
              ctx.restore(); ctx.globalAlpha = 1;
            }
          }
        }
        break;
      }
      case 'concrete': {
        for (let index = 0; index < 60; index += 1) {
          ctx.globalAlpha = 0.05;
          ctx.fillStyle = random() > 0.5 ? shade(base, 0.12) : shade(base, -0.12);
          const r = size * (0.05 + random() * 0.2);
          const x = random() * size; const y = random() * size;
          for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
            ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2); ctx.fill();
          }
        }
        speckle(2600, 0.25, 0.35, 0.8);
        break;
      }
      case 'terrazzo': {
        speckle(900, 0.3, 0.6, size / 220);
        for (let index = 0; index < 120; index += 1) {
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = [shade(base, -0.3), shade(base, -0.15), mix(base, '#c9a27f', 0.4), shade(base, 0.2)][index % 4];
          ctx.beginPath();
          const x = random() * size; const y = random() * size; const r = size / 160 + random() * size / 90;
          ctx.ellipse(x, y, r, r * (0.6 + random() * 0.4), random() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'marble': {
        for (let index = 0; index < 14; index += 1) {
          ctx.strokeStyle = shade(base, -0.28 - random() * 0.15);
          ctx.globalAlpha = 0.12 + random() * 0.25;
          ctx.lineWidth = 0.6 + random() * 2.2;
          ctx.beginPath();
          let x = random() * size; let y = 0;
          ctx.moveTo(x, y);
          while (y < size) { x += (random() - 0.5) * 40; y += 20 + random() * 30; ctx.lineTo(x, y); }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'weave': {
        const step = Math.max(2, size / (tile * 3));
        ctx.globalAlpha = 0.11;
        for (let y = 0; y < size; y += step) { ctx.fillStyle = shade(base, (y / step) % 2 ? -0.2 : 0.15); ctx.fillRect(0, y, size, step / 2); }
        for (let x = 0; x < size; x += step) { ctx.fillStyle = shade(base, (x / step) % 2 ? -0.18 : 0.12); ctx.fillRect(x, 0, step / 2, size); }
        ctx.globalAlpha = 1;
        speckle(1400, 0.18, 0.25, 0.7);
        break;
      }
      case 'boucle': {
        for (let index = 0; index < 4200; index += 1) {
          ctx.globalAlpha = 0.18 * random() + 0.05;
          ctx.strokeStyle = random() > 0.5 ? shade(base, 0.18) : shade(base, -0.2);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(random() * size, random() * size, 1 + random() * 2.2, 0, Math.PI * 1.6);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'knit': {
        const step = Math.max(3, size / (tile * 1.5));
        for (let y = 0; y < size; y += step) {
          for (let x = 0; x < size; x += step) {
            ctx.globalAlpha = 0.09 + random() * 0.08;
            ctx.fillStyle = ((x + y) / step) % 2 ? shade(base, -0.2) : shade(base, 0.16);
            ctx.beginPath(); ctx.ellipse(x + step / 2, y + step / 2, step * 0.45, step * 0.32, Math.PI / 4, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
        speckle(1600, 0.2, 0.25, 0.8);
        break;
      }
      default:
        speckle(500, 0.04, 0.2, 1);
    }
    ctx.globalAlpha = 1;
    return canvas;
  }

  return Object.freeze({
    groups,
    list: Object.freeze(list),
    get,
    inGroup,
    shade,
    mix,
    hexToRgb,
    legacyFloor: Object.freeze(legacyFloor),
    makeTextureCanvas
  });
});
