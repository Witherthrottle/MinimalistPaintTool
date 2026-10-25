/* Brush engine primitives: cached dab stamps, spacing-based stroke interpolation, flood fill. */
(function (MP) {
  'use strict';
  const U = MP.U;
  const STAMP = 128;
  const cache = new Map();

  /* Round dab of `color` with a soft falloff. hardness 1 = crisp edge. */
  function stamp(color, hardness) {
    const h = Math.round(U.clamp(hardness, 0, 1) * 20) / 20;
    const key = color + '|' + h;
    let c = cache.get(key);
    if (c) return c;
    if (cache.size > 48) cache.clear();
    c = U.makeCanvas(STAMP, STAMP);
    const ctx = c.getContext('2d');
    const r = STAMP / 2;
    if (h >= 0.99) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(r, r, r - 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, U.rgba(color, 1));
      g.addColorStop(Math.max(0.01, h), U.rgba(color, 1));
      g.addColorStop(Math.min(1, h + (1 - h) * 0.5), U.rgba(color, 0.35));
      g.addColorStop(1, U.rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, STAMP, STAMP);
    }
    cache.set(key, c);
    return c;
  }

  /* Draws a dab, optionally squashed along the pen's tilt direction. */
  function dab(ctx, img, x, y, size, tilt) {
    const r = size / 2;
    if (tilt && tilt.amount > 0.05) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tilt.azimuth);
      ctx.scale(1, 1 - 0.55 * tilt.amount);
      ctx.drawImage(img, -r, -r, size, size);
      ctx.restore();
    } else {
      ctx.drawImage(img, x - r, y - r, size, size);
    }
  }

  /* Emits evenly spaced dabs between successive input points. spacing(pressure) -> px. */
  class Stroker {
    constructor(spacing, onDab) {
      this.spacing = spacing;
      this.onDab = onDab;
      this.last = null;
      this.residual = 0;
    }
    begin(p) {
      this.last = p;
      this.onDab(p.x, p.y, p.pressure, p);
      this.residual = this.spacing(p.pressure);
    }
    to(p) {
      const a = this.last;
      if (!a) return this.begin(p);
      const dx = p.x - a.x, dy = p.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-4) return;
      let pos = this.residual;
      let guard = 0;
      while (pos <= d && guard++ < 20000) {
        const k = pos / d;
        const pr = U.lerp(a.pressure, p.pressure, k);
        this.onDab(a.x + dx * k, a.y + dy * k, pr, p);
        pos += this.spacing(pr);
      }
      this.residual = pos - d;
      this.last = p;
    }
  }

  /* Scanline flood fill. Returns {mask: Uint8Array, count, bbox}. */
  function floodFill(data, w, h, sx, sy, tol, contiguous) {
    sx = Math.floor(sx); sy = Math.floor(sy);
    const mask = new Uint8Array(w * h);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { mask, count: 0, bbox: null };
    const si = (sy * w + sx) * 4;
    const tr = data[si], tg = data[si + 1], tb = data[si + 2], ta = data[si + 3];
    const match = (p) => {
      const i = p * 4;
      const a = data[i + 3];
      if (ta === 0) return a <= tol;
      if (a === 0) return ta <= tol;
      return Math.abs(data[i] - tr) <= tol && Math.abs(data[i + 1] - tg) <= tol &&
        Math.abs(data[i + 2] - tb) <= tol && Math.abs(a - ta) <= tol;
    };
    let count = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    const mark = (p, x, y) => {
      mask[p] = 1; count++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    };
    if (!contiguous) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; if (match(p)) mark(p, x, y); }
    } else {
      const stack = [sx, sy];
      while (stack.length) {
        const y = stack.pop();
        let x = stack.pop();
        const row = y * w;
        if (mask[row + x] || !match(row + x)) continue;
        while (x > 0 && !mask[row + x - 1] && match(row + x - 1)) x--;
        let up = false, down = false;
        for (; x < w && !mask[row + x] && match(row + x); x++) {
          mark(row + x, x, y);
          if (y > 0) {
            const q = row - w + x, m = !mask[q] && match(q);
            if (m && !up) { stack.push(x, y - 1); up = true; } else if (!m) up = false;
          }
          if (y < h - 1) {
            const q = row + w + x, m = !mask[q] && match(q);
            if (m && !down) { stack.push(x, y + 1); down = true; } else if (!m) down = false;
          }
        }
      }
    }
    return { mask, count, bbox: x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 } };
  }

  /* Grow a mask by n px (8-connected), so fills tuck under anti-aliased line edges. */
  function growMask(mask, w, h, n) {
    let cur = mask;
    for (let k = 0; k < n; k++) {
      const out = cur.slice();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (cur[p]) continue;
          if ((x > 0 && cur[p - 1]) || (x < w - 1 && cur[p + 1]) || (y > 0 && cur[p - w]) || (y < h - 1 && cur[p + w]) ||
            (x > 0 && y > 0 && cur[p - w - 1]) || (x < w - 1 && y > 0 && cur[p - w + 1]) ||
            (x > 0 && y < h - 1 && cur[p + w - 1]) || (x < w - 1 && y < h - 1 && cur[p + w + 1])) out[p] = 1;
        }
      }
      cur = out;
    }
    return cur;
  }

  MP.Brush = { stamp, dab, Stroker, floodFill, growMask };
})(window.MP);
