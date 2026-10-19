/*
 * Zuglak Studio 2.0 – top-down furniture artwork for the 2D plan.
 * Everything is drawn in the item's local frame in CENTIMETRES:
 * x ∈ [0, w] (width), y ∈ [0, h] (depth), the back of the piece at y = 0.
 * Artwork never changes an item's real footprint; it only illustrates it.
 */
(function (root, factory) {
  const value = factory(root.ZuglakMaterials, root.ZuglakCatalog);
  root.ZuglakFurniture2D = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Materials, Catalog) {
  'use strict';

  const patternCache = new WeakMap();
  // Procedural texture sources are expensive: generate each one once per session.
  const sourceCache = new Map();
  function textureSource(material, size) {
    const key = `${material.id}|${size}`;
    if (!sourceCache.has(key)) sourceCache.set(key, Materials.makeTextureCanvas(material, size));
    return sourceCache.get(key);
  }

  function pattern(ctx, material) {
    if (!material || material.pattern === 'plain' || !material.tile) return null;
    let map = patternCache.get(ctx);
    if (!map) { map = new Map(); patternCache.set(ctx, map); }
    if (!map.has(material.id)) {
      const size = material.group === 'floor' ? 512 : 256;
      const source = textureSource(material, size);
      const value = ctx.createPattern(source, 'repeat');
      if (value && value.setTransform && typeof DOMMatrix !== 'undefined') value.setTransform(new DOMMatrix().scale(material.tile / size));
      map.set(material.id, value);
    }
    return map.get(material.id);
  }

  function makePainter(ctx, item, options) {
    const px = options.pixelsPerCm || 1; // screen pixels per cm (for hairlines)
    const hair = 1 / px;
    const mats = { ...Catalog.defaultMaterials(Catalog.modelFor(item)), ...(item.materials || {}) };
    const mat = slot => Materials.get(mats[slot] || mats.primary, 'wood-white');
    const color = (slot, amount = 0) => Materials.shade(mat(slot).color, amount);
    const fillFor = (slot, amount = 0, usePattern = true) => {
      if (usePattern && amount === 0 && options.patterns !== false) {
        const value = pattern(ctx, mat(slot));
        if (value) return value;
      }
      return color(slot, amount);
    };
    const path = (x, y, w, h, r) => {
      ctx.beginPath();
      const radius = Math.max(0, Math.min(r || 0, w / 2, h / 2));
      if (ctx.roundRect) ctx.roundRect(x, y, Math.max(0.01, w), Math.max(0.01, h), radius);
      else ctx.rect(x, y, w, h);
    };
    const box = (x, y, w, h, r, fill, stroke, lineWidth = 1) => {
      path(x, y, w, h, r);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = hair * lineWidth; ctx.stroke(); }
    };
    const ellipse = (cx, cy, rx, ry, fill, stroke, lineWidth = 1) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = hair * lineWidth; ctx.stroke(); }
    };
    const line = (x1, y1, x2, y2, stroke, lineWidth = 1, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = stroke; ctx.lineWidth = hair * lineWidth; ctx.lineCap = 'round'; ctx.stroke();
      ctx.restore();
    };
    const gradient = (x1, y1, x2, y2, stops) => {
      const value = ctx.createLinearGradient(x1, y1, x2, y2);
      stops.forEach(([offset, c]) => value.addColorStop(offset, c));
      return value;
    };
    const radial = (cx, cy, r, stops) => {
      const value = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(0.01, r));
      stops.forEach(([offset, c]) => value.addColorStop(offset, c));
      return value;
    };
    // Soft shading overlay for upholstered volumes.
    const cushion = (x, y, w, h, r, slot = 'primary', lift = 0) => {
      box(x, y, w, h, r, fillFor(slot));
      path(x, y, w, h, r);
      ctx.fillStyle = gradient(x, y, x + w * 0.3, y + h, [[0, `rgba(255,255,255,${0.22 + lift})`], [0.55, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.13)']]);
      ctx.fill();
      ctx.strokeStyle = color(slot, -0.3); ctx.lineWidth = hair * 0.9; ctx.stroke();
    };
    const wood = (x, y, w, h, r, slot = 'primary') => {
      box(x, y, w, h, r, fillFor(slot));
      path(x, y, w, h, r);
      ctx.fillStyle = gradient(x, y, x + w, y + h, [[0, 'rgba(255,255,255,0.16)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.10)']]);
      ctx.fill();
      ctx.strokeStyle = color(slot, -0.38); ctx.lineWidth = hair * 1; ctx.stroke();
    };
    return { ctx, px, hair, mat, color, fillFor, path, box, ellipse, line, gradient, radial, cushion, wood };
  }

  function sofaShape(p, w, h, options = {}) {
    const arm = Math.min(Math.max(12, w * 0.08), 22);
    const back = Math.min(Math.max(16, h * 0.22), 26);
    const r = 6;
    // Base
    p.cushion(0, 0, w, h, r + 2, 'primary', -0.05);
    // Back rest
    p.cushion(arm * 0.4, 0, w - arm * 0.8, back, 5, 'primary', 0.05);
    // Arms
    p.cushion(0, 2, arm, h - 2, r, 'primary', 0.08);
    p.cushion(w - arm, 2, arm, h - 2, r, 'primary', 0.08);
    // Seat cushions
    const seats = options.seats || (w - 2 * arm > 150 ? 3 : w - 2 * arm > 90 ? 2 : 1);
    const seatW = (w - 2 * arm) / seats;
    for (let index = 0; index < seats; index += 1) {
      p.cushion(arm + index * seatW + 1, back - 2, seatW - 2, h - back - 1, 5, 'primary', 0.12);
      // Seam highlight
      p.line(arm + index * seatW + seatW * 0.15, back + 3, arm + (index + 1) * seatW - seatW * 0.15, back + 3, 'rgba(255,255,255,0.55)', 1.2);
    }
    // Scatter cushions
    if (w > 120 && options.pillows !== false) {
      const pillow = Math.min(45, back * 1.7);
      for (const cx of [arm + pillow * 0.55, w - arm - pillow * 0.55]) {
        p.ctx.save();
        p.ctx.translate(cx, back + pillow * 0.18);
        p.ctx.rotate(cx < w / 2 ? -0.18 : 0.18);
        p.cushion(-pillow / 2, -pillow * 0.22, pillow, pillow * 0.48, 6, 'tertiary' in (p.mats || {}) ? 'tertiary' : 'primary', 0.2);
        p.ctx.restore();
      }
    }
  }

  const art = {
    sofa(p, w, h) { sofaShape(p, w, h); },
    sectional(p, w, h) {
      const chaise = Math.min(100, Math.max(80, w * 0.34));
      const depth = Math.min(100, h * 0.6);
      const arm = 16; const back = 22;
      p.cushion(0, 0, w, depth, 8, 'primary', -0.05);
      p.cushion(w - chaise, 0, chaise, h, 8, 'primary', -0.05);
      p.cushion(arm * 0.4, 0, w - arm * 0.4 - 2, back, 5, 'primary', 0.05);
      p.cushion(0, 2, arm, depth - 2, 6, 'primary', 0.08);
      p.cushion(w - arm, 2, arm, h - 2, 6, 'primary', 0.08);
      const seatsW = w - chaise - arm;
      const seats = seatsW > 150 ? 2 : 1;
      for (let index = 0; index < seats; index += 1) {
        p.cushion(arm + index * seatsW / seats + 1, back - 2, seatsW / seats - 2, depth - back - 1, 5, 'primary', 0.12);
      }
      p.cushion(w - chaise + 1, back - 2, chaise - arm - 2, h - back - 2, 6, 'primary', 0.12);
      p.line(w - chaise + 6, depth, w - arm - 4, depth, 'rgba(0,0,0,0.12)', 1.2);
      const pillow = 40;
      p.ctx.save(); p.ctx.translate(arm + pillow * 0.6, back + 6); p.ctx.rotate(-0.2);
      p.cushion(-pillow / 2, -9, pillow, 19, 6, 'primary', 0.22); p.ctx.restore();
    },
    armchair(p, w, h) {
      const arm = Math.max(10, w * 0.17);
      const back = Math.max(14, h * 0.26);
      p.cushion(0, 0, w, h, 12, 'primary', -0.05);
      p.cushion(arm * 0.5, 0, w - arm, back, 10, 'primary', 0.05);
      p.cushion(0, back * 0.4, arm, h - back * 0.4, 9, 'primary', 0.06);
      p.cushion(w - arm, back * 0.4, arm, h - back * 0.4, 9, 'primary', 0.06);
      p.cushion(arm, back - 3, w - arm * 2, h - back, 9, 'primary', 0.14);
    },
    pouf(p, w, h) {
      p.ellipse(w / 2, h / 2, w / 2, h / 2, p.fillFor('primary'), p.color('primary', -0.3));
      p.ellipse(w / 2, h / 2, w / 2, h / 2, p.radial(w * 0.4, h * 0.4, w * 0.6, [[0, 'rgba(255,255,255,0.28)'], [1, 'rgba(0,0,0,0.12)']]));
      p.ellipse(w / 2, h / 2, w * 0.08, h * 0.08, p.color('primary', -0.15));
    },
    table(p, w, h) {
      p.wood(0, 0, w, h, Math.min(4, Math.min(w, h) * 0.05));
      p.box(2, 2, w - 4, h - 4, 3, null, 'rgba(255,255,255,0.35)', 0.8);
    },
    'table-round'(p, w, h) {
      p.ellipse(w / 2, h / 2, w / 2, h / 2, p.fillFor('primary'), p.color('primary', -0.38));
      p.ellipse(w / 2, h / 2, w / 2, h / 2, p.radial(w * 0.38, h * 0.36, w * 0.7, [[0, 'rgba(255,255,255,0.22)'], [1, 'rgba(0,0,0,0.12)']]));
      p.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 2, null, 'rgba(255,255,255,0.35)', 0.8);
    },
    'coffee-table'(p, w, h) {
      p.wood(0, 0, w, h, Math.min(12, h * 0.2));
      p.box(4, 4, w - 8, h - 8, Math.min(9, h * 0.16), null, 'rgba(255,255,255,0.3)', 0.8);
      // Decorative books + vase
      p.box(w * 0.18, h * 0.3, w * 0.22, h * 0.36, 1, '#e9e3d8', '#b5ab9b');
      p.box(w * 0.2, h * 0.34, w * 0.18, h * 0.28, 1, '#b8a993');
      p.ellipse(w * 0.7, h * 0.5, Math.min(w, h) * 0.09, Math.min(w, h) * 0.09, '#d7d1c5', '#9e958a');
      p.ellipse(w * 0.7, h * 0.5, Math.min(w, h) * 0.04, Math.min(w, h) * 0.04, '#6c8f5e');
    },
    'coffee-round'(p, w, h) {
      art['table-round'](p, w, h);
      p.box(w * 0.3, h * 0.35, w * 0.26, h * 0.2, 1, '#e9e3d8', '#b5ab9b');
      p.ellipse(w * 0.64, h * 0.6, w * 0.07, h * 0.07, '#d7d1c5', '#9e958a');
    },
    'side-table'(p, w, h) {
      art['table-round'](p, w, h);
    },
    chair(p, w, h) {
      const back = Math.max(5, h * 0.14);
      p.wood(w * 0.06, h * 0.1, w * 0.88, h * 0.84, 4);
      p.cushion(w * 0.14, h * 0.24, w * 0.72, h * 0.62, 4, 'secondary', 0.1);
      p.wood(w * 0.02, 0, w * 0.96, back, 3);
    },
    'chair-upholstered'(p, w, h) {
      p.cushion(w * 0.04, h * 0.12, w * 0.92, h * 0.86, 10, 'primary', 0.05);
      p.cushion(0, 0, w, h * 0.26, 12, 'primary', 0.12);
      p.cushion(w * 0.14, h * 0.3, w * 0.72, h * 0.6, 9, 'primary', 0.14);
    },
    bench(p, w, h) {
      p.wood(0, 0, w, h, 3);
      for (let index = 1; index < 3; index += 1) p.line(2, h * index / 3, w - 2, h * index / 3, p.color('primary', -0.32), 0.8);
    },
    stool(p, w, h) {
      p.line(w * 0.15, h * 0.15, w * 0.85, h * 0.85, p.color('secondary', -0.1), 2.4);
      p.line(w * 0.85, h * 0.15, w * 0.15, h * 0.85, p.color('secondary', -0.1), 2.4);
      p.ellipse(w / 2, h / 2, w * 0.4, h * 0.4, p.fillFor('primary'), p.color('primary', -0.38));
      p.ellipse(w / 2, h / 2, w * 0.4, h * 0.4, p.radial(w * 0.42, h * 0.4, w * 0.5, [[0, 'rgba(255,255,255,0.25)'], [1, 'rgba(0,0,0,0.1)']]));
    },
    bed(p, w, h, item) {
      const frame = Math.max(4, Math.min(8, w * 0.04));
      const head = Math.max(7, h * 0.045);
      p.wood(0, 0, w, h, 3);
      p.wood(0, 0, w, head + 2, 2);
      p.box(frame, head, w - frame * 2, h - head - frame, 4, '#fbfaf7', '#d4cfc6');
      const single = w < 130;
      const pillowW = single ? (w - frame * 2) * 0.7 : (w - frame * 2) / 2 - 6;
      const pillowY = head + 4;
      const pillowH = Math.min(38, h * 0.17);
      const pillows = single ? [w / 2 - pillowW / 2] : [frame + 4, w / 2 + 2];
      for (const x of pillows) {
        p.cushion(x, pillowY, pillowW, pillowH, 8, 'secondary', 0.25);
        p.line(x + pillowW * 0.2, pillowY + pillowH * 0.5, x + pillowW * 0.8, pillowY + pillowH * 0.5, 'rgba(0,0,0,0.06)', 1);
      }
      // Duvet
      const duvetY = pillowY + pillowH + 6;
      p.cushion(frame - 1, duvetY, w - frame * 2 + 2, h - duvetY - frame + 1, 5, 'secondary', 0.12);
      p.box(frame - 1, duvetY, w - frame * 2 + 2, 10, 4, 'rgba(255,255,255,0.6)');
      p.line(frame + 2, duvetY + 10, w - frame - 2, duvetY + 10, 'rgba(0,0,0,0.08)', 1);
      // Throw at the foot
      const throwY = h - frame - Math.min(48, h * 0.24);
      p.cushion(frame - 2, throwY, w - frame * 2 + 4, h - frame - throwY + 1, 3, 'tertiary', 0.04);
      for (let index = 1; index < 4; index += 1) p.line(frame, throwY + (h - frame - throwY) * index / 4, w - frame, throwY + (h - frame - throwY) * index / 4, 'rgba(255,255,255,0.18)', 0.8);
      // Soft folds
      p.line(w * 0.35, duvetY + 16, w * 0.3, throwY - 6, 'rgba(0,0,0,0.05)', 2);
      p.line(w * 0.68, duvetY + 16, w * 0.72, throwY - 6, 'rgba(255,255,255,0.4)', 2);
      void item;
    },
    'bed-kids'(p, w, h, item) {
      art.bed(p, w, h, item);
      p.box(0, 0, 4, h, 1, p.color('primary', -0.05), p.color('primary', -0.35));
      p.box(w - 4, 0, 4, h, 1, p.color('primary', -0.05), p.color('primary', -0.35));
    },
    crib(p, w, h) {
      p.wood(0, 0, w, h, 2);
      p.box(5, 5, w - 10, h - 10, 3, '#fbfaf7', '#d7d2c9');
      p.cushion(w * 0.2, 9, w * 0.6, h * 0.14, 6, 'secondary', 0.2);
      p.cushion(6, h * 0.36, w - 12, h * 0.56, 4, 'secondary', 0.08);
      for (let x = 6; x < w - 4; x += 8) { p.line(x, 1, x, 4, p.color('primary', -0.3), 1); p.line(x, h - 4, x, h - 1, p.color('primary', -0.3), 1); }
    },
    nightstand(p, w, h) {
      p.wood(0, 0, w, h, 2);
      p.line(3, h - 4, w - 3, h - 4, p.color('primary', -0.3), 1);
      p.ellipse(w * 0.4, h * 0.45, Math.min(w, h) * 0.18, Math.min(w, h) * 0.18, Materials.get('fabric-oat').color, '#b0a690');
      p.ellipse(w * 0.4, h * 0.45, Math.min(w, h) * 0.06, Math.min(w, h) * 0.06, '#fff4d8');
    },
    wardrobe(p, w, h) {
      p.wood(0, 0, w, h, 1);
      const doors = Math.max(1, Math.round(w / 50));
      for (let index = 1; index < doors; index += 1) p.line(w * index / doors, h - 6, w * index / doors, h, p.color('primary', -0.35), 1);
      p.line(2, h - 2, w - 2, h - 2, p.color('primary', -0.35), 1.2);
      // Hanging rail (plan symbol)
      p.ctx.save(); p.ctx.setLineDash([6, 4]);
      p.line(6, h * 0.48, w - 6, h * 0.48, p.color('primary', -0.4), 1);
      p.ctx.restore();
      for (let x = 14; x < w - 8; x += 12) p.line(x, h * 0.3, x, h * 0.66, p.color('primary', -0.2), 0.8, 0.6);
    },
    bookcase(p, w, h) {
      p.wood(0, 0, w, h, 1);
      const books = ['#a35d47', '#3f5a6b', '#d4b483', '#6f8a6a', '#e8e0d0', '#7b5b8a', '#c88d5a'];
      let x = 3;
      let index = 0;
      while (x < w - 4) {
        const bw = 2 + ((index * 7) % 5);
        p.box(x, 2.5, Math.min(bw, w - 3 - x), h - 5, 0.4, books[index % books.length]);
        x += bw + 0.6; index += 1;
      }
      p.line(1, h - 1.2, w - 1, h - 1.2, p.color('primary', -0.3), 1);
    },
    'cube-shelf'(p, w, h) {
      p.wood(0, 0, w, h, 1);
      const cells = Math.max(1, Math.round(w / 36));
      for (let index = 1; index < cells; index += 1) p.line(w * index / cells, 1.5, w * index / cells, h - 1.5, p.color('primary', -0.32), 1.1);
      p.box(w / cells * 0.15, h * 0.2, w / cells * 0.7, h * 0.6, 2, '#d8cbb6', '#a99a82');
      if (cells > 2) p.ellipse(w / cells * 2.5, h / 2, h * 0.2, h * 0.2, '#6f8f5e');
    },
    dresser(p, w, h) {
      p.wood(0, 0, w, h, 2);
      p.line(3, h - 3, w - 3, h - 3, p.color('primary', -0.35), 1.1);
      const handles = Math.max(2, Math.round(w / 40));
      for (let index = 0; index < handles; index += 1) p.box(w * (index + 0.5) / handles - 4, h - 2.2, 8, 1.6, 0.8, p.color('secondary', -0.1));
    },
    sideboard(p, w, h) {
      art.dresser(p, w, h);
      p.ellipse(w * 0.78, h * 0.45, h * 0.18, h * 0.18, '#e6ded0', '#a59a89');
      p.ellipse(w * 0.78, h * 0.45, h * 0.08, h * 0.08, '#6a8a5c');
    },
    'tv-bench'(p, w, h) {
      p.wood(0, 0, w, h, 2);
      const doors = Math.max(2, Math.round(w / 45));
      for (let index = 1; index < doors; index += 1) p.line(w * index / doors, h - 5, w * index / doors, h, p.color('primary', -0.3), 1);
      p.line(2, h - 2, w - 2, h - 2, p.color('secondary', -0.2), 1.6);
    },
    desk(p, w, h) {
      p.wood(0, 0, w, h, 2);
      // Laptop and lamp
      p.box(w * 0.38, h * 0.3, Math.min(34, w * 0.28), Math.min(24, h * 0.4), 1.5, '#c9cbcd', '#8d9093');
      p.box(w * 0.38 + 2, h * 0.3 + 2, Math.min(34, w * 0.28) - 4, Math.min(24, h * 0.4) * 0.55, 1, '#2f3438');
      p.ellipse(w * 0.12, h * 0.3, 7, 7, Materials.get('fabric-oat').color, '#a69c88');
    },
    'office-chair'(p, w, h) {
      const cx = w / 2; const cy = h / 2;
      for (let index = 0; index < 5; index += 1) {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
        p.line(cx, cy, cx + Math.cos(angle) * w * 0.46, cy + Math.sin(angle) * h * 0.46, p.color('secondary', 0.1), 3.4);
        p.ellipse(cx + Math.cos(angle) * w * 0.46, cy + Math.sin(angle) * h * 0.46, 2.6, 2.6, '#2b2b2b');
      }
      p.cushion(w * 0.17, h * 0.22, w * 0.66, h * 0.62, 10, 'primary', 0.12);
      p.cushion(w * 0.14, h * 0.05, w * 0.72, h * 0.2, 9, 'primary', 0.06);
    },
    'kitchen-base'(p, w, h) {
      p.box(0, 0, w, h, 0.5, p.fillFor('secondary'), p.color('secondary', -0.25));
      p.box(0, 0, w, h, 0.5, p.gradient(0, 0, w, h, [[0, 'rgba(255,255,255,0.25)'], [1, 'rgba(0,0,0,0.06)']]));
      p.line(1, h - 2, w - 1, h - 2, p.color('primary', -0.35), 1.6);
    },
    'kitchen-drawers'(p, w, h) { art['kitchen-base'](p, w, h); },
    'kitchen-sink'(p, w, h) {
      art['kitchen-base'](p, w, h);
      const bw = Math.min(w - 16, 56); const bh = Math.min(h - 18, 40);
      p.box((w - bw) / 2, h * 0.28, bw, bh, 5, '#cfd3d5', '#8e9497', 1.2);
      p.box((w - bw) / 2 + 3, h * 0.28 + 3, bw - 6, bh - 6, 4, p.gradient(0, h * 0.28, 0, h * 0.28 + bh, [[0, '#a9afb2'], [1, '#e1e4e5']]));
      p.ellipse(w / 2, h * 0.28 + bh / 2, 2, 2, '#6f7578');
      p.box(w / 2 - 2, h * 0.08, 4, h * 0.2, 2, '#9aa1a4', '#6f7578');
    },
    'kitchen-hob'(p, w, h) {
      art['kitchen-base'](p, w, h);
      const bw = Math.min(w - 8, 56); const bh = Math.min(h - 12, 50);
      const x = (w - bw) / 2; const y = (h - bh) / 2 - 2;
      p.box(x, y, bw, bh, 2.5, p.gradient(x, y, x + bw, y + bh, [[0, '#2a2c2e'], [1, '#121314']]), '#4a4d50');
      for (const [fx, fy, r] of [[0.28, 0.3, 0.16], [0.72, 0.3, 0.12], [0.28, 0.72, 0.12], [0.72, 0.72, 0.16]]) {
        p.ellipse(x + bw * fx, y + bh * fy, bw * r, bw * r, null, '#6c6f72', 1);
      }
    },
    'kitchen-tall'(p, w, h) {
      p.wood(0, 0, w, h, 0.5);
      p.line(2, 2, w - 2, h - 2, p.color('primary', -0.3), 1, 0.6);
      p.line(w - 2, 2, 2, h - 2, p.color('primary', -0.3), 1, 0.6);
      p.line(1, h - 2, w - 1, h - 2, p.color('primary', -0.35), 1.4);
    },
    fridge(p, w, h) {
      p.box(0, 0, w, h, 2, p.gradient(0, 0, w, h, [[0, Materials.shade(p.color('primary'), 0.25)], [1, p.color('primary', -0.08)]]), p.color('primary', -0.35));
      p.line(1, h - 2, w - 1, h - 2, p.color('primary', -0.4), 1.4);
      p.box(w * 0.82, h * 0.62, 2.4, h * 0.3, 1, p.color('primary', -0.3));
    },
    island(p, w, h) {
      p.box(0, 0, w, h, 1, p.fillFor('secondary'), p.color('secondary', -0.25));
      p.box(0, 0, w, h, 1, p.gradient(0, 0, w, h, [[0, 'rgba(255,255,255,0.28)'], [1, 'rgba(0,0,0,0.06)']]));
      p.box(w * 0.3, h * 0.3, w * 0.12, h * 0.25, 2, '#e6e0d4', '#a99f8f');
      p.ellipse(w * 0.75, h * 0.42, 6, 6, '#c8bba4');
    },
    bathtub(p, w, h) {
      p.box(0, 0, w, h, 6, p.gradient(0, 0, w, h, [[0, '#ffffff'], [1, '#e7ecee']]), '#a9b5b9');
      p.box(7, 7, w - 14, h - 14, Math.min(h * 0.4, 28), p.gradient(0, 7, 0, h - 7, [[0, '#dfe7ea'], [1, '#f8fbfc']]), '#b8c4c8');
      p.ellipse(w * 0.15, h / 2, 2.2, 2.2, '#8f9ca0');
      p.box(w * 0.04, h / 2 - 3, 6, 6, 2, p.color('secondary', 0));
    },
    shower(p, w, h) {
      p.box(0, 0, w, h, 2, p.gradient(0, 0, w, h, [[0, '#ffffff'], [1, '#e9eef0']]), '#a9b5b9');
      p.line(4, 4, w / 2, h / 2, '#c2ccd0', 0.8); p.line(w - 4, 4, w / 2, h / 2, '#c2ccd0', 0.8);
      p.line(4, h - 4, w / 2, h / 2, '#c2ccd0', 0.8); p.line(w - 4, h - 4, w / 2, h / 2, '#c2ccd0', 0.8);
      p.ellipse(w / 2, h / 2, 3.5, 3.5, '#9aa6aa');
      p.line(1, h - 1, w - 1, h - 1, p.color('secondary', 0), 2.4);
      p.ellipse(w * 0.5, 8, 6, 6, '#c3c9cc', '#8a9498');
    },
    toilet(p, w, h) {
      p.box(0, 0, w, h * 0.3, 3, '#fbfbfa', '#a9b5b9');
      p.ellipse(w / 2, h * 0.62, w * 0.46, h * 0.37, '#ffffff', '#a9b5b9');
      p.ellipse(w / 2, h * 0.64, w * 0.3, h * 0.25, '#edf2f3', '#c0cacd');
      p.box(w * 0.42, h * 0.08, w * 0.16, h * 0.08, 2, '#d9dfe1');
    },
    basin(p, w, h) {
      p.wood(0, 0, w, h, 2);
      p.box(3, 2, w - 6, h - 4, 4, '#ffffff', '#b2bdc0');
      p.ellipse(w / 2, h * 0.56, w * 0.33, h * 0.3, p.gradient(0, h * 0.3, 0, h * 0.86, [[0, '#dfe7ea'], [1, '#fbfdfd']]), '#b2bdc0');
      p.box(w / 2 - 2, h * 0.1, 4, h * 0.16, 2, '#a7afb2', '#7d8689');
    },
    washer(p, w, h) {
      p.box(0, 0, w, h, 3, p.gradient(0, 0, w, h, [[0, '#ffffff'], [1, '#e6e8e9']]), '#a7afb2');
      p.line(2, h * 0.18, w - 2, h * 0.18, '#c3c9cc', 1);
      p.box(w * 0.1, h * 0.05, w * 0.3, h * 0.08, 1, '#d9dee0');
      p.ellipse(w * 0.75, h * 0.09, 2.4, 2.4, '#8a9498');
    },
    rug(p, w, h) {
      p.box(0, 0, w, h, 2, p.fillFor('primary'), p.color('primary', -0.2), 0.8);
      p.box(8, 8, w - 16, h - 16, 1, null, p.color('primary', -0.18), 1.2);
      p.box(14, 14, w - 28, h - 28, 1, null, p.color('primary', 0.25), 0.9);
      p.ctx.save(); p.ctx.globalAlpha = 0.5;
      for (let x = 2; x < w - 1; x += 3) { p.line(x, -2.5, x, 0, p.color('primary', 0.2), 0.8); p.line(x, h, x, h + 2.5, p.color('primary', 0.2), 0.8); }
      p.ctx.restore();
    },
    'rug-round'(p, w, h) {
      p.ellipse(w / 2, h / 2, w / 2, h / 2, p.fillFor('primary'), p.color('primary', -0.2), 0.8);
      p.ellipse(w / 2, h / 2, w / 2 - 9, h / 2 - 9, null, p.color('primary', -0.15), 1.2);
      p.ellipse(w / 2, h / 2, w / 2 - 16, h / 2 - 16, null, p.color('primary', 0.22), 0.9);
    },
    'floor-lamp'(p, w, h) {
      p.ellipse(w / 2, h / 2, w / 2, h / 2, p.radial(w / 2, h / 2, w / 2, [[0, 'rgba(255,236,190,0.65)'], [1, 'rgba(255,236,190,0)']]));
      p.ellipse(w / 2, h / 2, w * 0.38, h * 0.38, p.fillFor('primary'), p.color('primary', -0.3));
      p.ellipse(w / 2, h / 2, w * 0.38, h * 0.38, p.radial(w / 2, h / 2, w * 0.38, [[0, 'rgba(255,248,225,0.95)'], [0.6, 'rgba(255,248,225,0.25)'], [1, 'rgba(0,0,0,0.05)']]));
      p.ellipse(w / 2, h / 2, w * 0.06, h * 0.06, p.color('secondary', 0));
    },
    'arc-lamp'(p, w, h) {
      p.ellipse(h / 2, h / 2, h * 0.42, h * 0.42, p.fillFor('secondary'), p.color('secondary', -0.3));
      p.ctx.beginPath(); p.ctx.moveTo(h / 2, h / 2);
      p.ctx.quadraticCurveTo(w * 0.55, -h * 0.1, w - h / 2, h / 2);
      p.ctx.strokeStyle = p.color('primary', 0); p.ctx.lineWidth = 2.2; p.ctx.stroke();
      p.ellipse(w - h / 2, h / 2, h * 0.45, h * 0.45, p.radial(w - h / 2, h / 2, h * 0.45, [[0, '#fff6dc'], [1, p.color('primary', 0.1)]]), p.color('primary', -0.3));
    },
    'table-lamp'(p, w, h) { art['floor-lamp'](p, w, h); },
    plant(p, w, h) {
      p.ellipse(w / 2, h / 2, w * 0.36, h * 0.36, p.fillFor('primary'), p.color('primary', -0.3));
      const leaves = ['#3d6b47', '#4f7f53', '#5f8e5a', '#2f5d3f', '#6c9a63'];
      const count = 14;
      for (let index = 0; index < count; index += 1) {
        const angle = index * Math.PI * 2 / count + (index % 2) * 0.2;
        const length = Math.min(w, h) * (0.32 + (index % 3) * 0.06);
        p.ctx.save(); p.ctx.translate(w / 2, h / 2); p.ctx.rotate(angle);
        p.ellipse(length * 0.55, 0, length * 0.55, length * 0.2, leaves[index % leaves.length]);
        p.line(0, 0, length, 0, 'rgba(255,255,255,0.25)', 0.7);
        p.ctx.restore();
      }
    },
    'plant-small'(p, w, h) { art.plant(p, w, h); },
    tv(p, w, h) {
      p.box(0, 0, w, h, 1, p.gradient(0, 0, 0, h, [[0, '#2b2f33'], [1, '#0d0f11']]), '#555b60');
      p.box(w * 0.38, h * 0.5, w * 0.24, h * 0.5 + 6, 1, '#3b3f43');
    },
    box(p, w, h) {
      p.wood(0, 0, w, h, 2);
      p.line(3, 3, w - 3, h - 3, p.color('primary', -0.3), 1, 0.5);
      p.line(w - 3, 3, 3, h - 3, p.color('primary', -0.3), 1, 0.5);
    }
  };

  const roundModels = new Set(['table-round', 'coffee-round', 'side-table', 'stool', 'pouf', 'rug-round', 'floor-lamp', 'table-lamp', 'plant', 'plant-small']);

  /** Draws an item; the context must already be translated/rotated to the item's corner and scaled to cm. */
  function drawItem(ctx, item, options = {}) {
    const model = Catalog.modelFor(item);
    const p = makePainter(ctx, item, options);
    p.mats = item.materials || {};
    const w = Number(item.w); const h = Number(item.h);
    ctx.save();
    if (options.shadow !== false && Catalog.layerFor(item) !== 'floor') {
      ctx.save();
      const height = Number(item.height) || Catalog.defaultHeight(model);
      const blur = Math.min(26, 4 + height * 0.09);
      ctx.shadowColor = `rgba(40, 32, 22, ${Math.min(0.34, 0.16 + height / 900)})`;
      ctx.shadowBlur = blur * (options.pixelsPerCm || 1);
      ctx.shadowOffsetX = blur * 0.25 * (options.pixelsPerCm || 1);
      ctx.shadowOffsetY = blur * 0.45 * (options.pixelsPerCm || 1);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      if (roundModels.has(model)) { ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w * 0.44, h * 0.44, 0, 0, Math.PI * 2); }
      else if (model === 'office-chair') { ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w * 0.38, h * 0.38, 0, 0, Math.PI * 2); }
      else p.path(1, 1, w - 2, h - 2, 4);
      ctx.fill();
      ctx.restore();
    }
    (art[model] || art.box)(p, w, h, item);
    ctx.restore();
  }

  const thumbCache = new Map();
  /** Renders a catalogue thumbnail (data URL) using exactly the same artwork. */
  function thumbnail(product, size = 120) {
    const key = `${product.key || product.name}|${size}|${JSON.stringify(product.materials || {})}`;
    if (thumbCache.has(key)) return thumbCache.get(key);
    const canvas = document.createElement('canvas');
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    canvas.width = canvas.height = size * ratio;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = Number(product.width); const h = Number(product.depth);
    const pad = size * 0.12;
    const scale = Math.min((size - pad * 2) / w, (size - pad * 2) / h) * ratio;
    ctx.translate(canvas.width / 2 - w * scale / 2, canvas.height / 2 - h * scale / 2);
    ctx.scale(scale, scale);
    drawItem(ctx, { model: product.model, type: product.model, w, h, height: product.height, materials: product.materials || {} }, { pixelsPerCm: scale });
    const url = canvas.toDataURL('image/png');
    thumbCache.set(key, url);
    return url;
  }

  return Object.freeze({ drawItem, thumbnail, roundModels, pattern, textureSource });
});
