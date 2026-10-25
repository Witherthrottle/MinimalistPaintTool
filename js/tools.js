/* Tool behaviours. Each tool: {id, brush?, cursor?, down(p)->bool, move(p), up(p), drawOverlay?, activate?,
   deactivate?, key?(e)->bool, hover?(p), strokeInfo?}. Points carry doc coords (x,y), stage coords (sx,sy),
   pressure, tilt {amount, azimuth}, pointerType and modifier flags. */
(function (MP) {
  'use strict';
  const U = MP.U, B = MP.Brush;
  const TAU = Math.PI * 2;

  MP.createTools = function (app) {
    const doc = () => app.doc;
    const T = {};

    /* One shared full-document buffer for strokes that should not build up past their opacity. */
    let buffer = null, bufCtx = null;
    function freshBuffer() {
      const d = doc();
      if (!buffer || buffer.width !== d.w || buffer.height !== d.h) {
        buffer = U.makeCanvas(d.w, d.h);
        bufCtx = buffer.getContext('2d');
      }
      bufCtx.setTransform(1, 0, 0, 1, 0, 0);
      bufCtx.globalAlpha = 1;
      bufCtx.globalCompositeOperation = 'source-over';
      bufCtx.clearRect(0, 0, buffer.width, buffer.height);
      return bufCtx;
    }
    function compositeBuffer(L, alpha) {
      const d = doc();
      L.ctx.save();
      if (d.selection) L.ctx.clip(d.selection.path);
      L.ctx.globalAlpha = alpha;
      L.ctx.drawImage(buffer, 0, 0);
      L.ctx.restore();
      d.liveBuffer = null;
    }
    function canPaint() {
      if (!doc().active.visible) {
        app.toast('The active layer is hidden — show it to paint on it.');
        return false;
      }
      return true;
    }
    const usePen = (src) => src && src.pointerType === 'pen';
    const snapAngle = (a, b, step = Math.PI / 12) => {
      const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      return { ...b, x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
    };
    const clampDoc = (x, y) => [U.clamp(x, 0, doc().w), U.clamp(y, 0, doc().h)];

    /* ---------------- stamp-based painting ---------------- */
    function paintTool(id, cfg) {
      const tool = {
        id,
        brush: true,
        down(p) {
          if (p.alt && cfg.altPick !== false) { app.pickColorAt(p, 'alt_click'); return false; }
          if (!canPaint()) return false;
          const d = doc(), L = d.active, o = app.opt(id);
          this.o = o;
          this.L = L;
          this.bbox = null;
          this.color = app.colors.fg;
          this.tok = d.beginPixelEdit(L);
          if (cfg.buffered) {
            this.ctx = freshBuffer();
            d.liveBuffer = { canvas: buffer, alpha: o.opacity, clip: d.selection ? d.selection.path : null };
          } else {
            this.ctx = L.ctx;
            this.ctx.save();
            if (d.selection) this.ctx.clip(d.selection.path);
          }
          if (cfg.begin && cfg.begin.call(this, p) === false) {
            if (!cfg.buffered) this.ctx.restore();
            d.liveBuffer = null;
            return false;
          }
          this.stroker = new B.Stroker(
            (pr) => Math.max(0.35, cfg.spacing.call(this, pr)),
            (x, y, pr, src) => cfg.dab.call(this, x, y, pr, src)
          );
          this.stroker.begin(p);
          app.view.dirty();
          return true;
        },
        move(p) {
          this.stroker.to(p);
          app.view.dirty();
        },
        up(p) {
          const d = doc();
          if (cfg.end) cfg.end.call(this, p);
          if (cfg.buffered) compositeBuffer(this.L, this.o.opacity);
          else this.ctx.restore();
          d.commitPixelEdit(this.tok, this.bbox, MP.TOOLS[id].name);
          app.view.dirty();
        },
      };
      return Object.assign(tool, cfg.extra || {});
    }

    T.pencil = paintTool('pencil', {
      buffered: true,
      spacing() { return Math.max(0.5, this.o.size * 0.3); },
      dab(x, y) {
        const s = Math.max(1, Math.round(this.o.size)), c = this.ctx;
        c.fillStyle = this.color;
        if (s <= 3) c.fillRect(Math.floor(x - s / 2 + 0.5), Math.floor(y - s / 2 + 0.5), s, s);
        else { c.beginPath(); c.arc(x, y, s / 2, 0, TAU); c.fill(); }
        this.bbox = U.bboxAddCircle(this.bbox, x, y, s);
      },
    });

    T.pen = paintTool('pen', {
      buffered: true,
      begin(p) { this.sm = { x: p.x, y: p.y, pressure: p.pressure }; },
      spacing(pr) { return this.size(pr) * 0.07; },
      dab(x, y, pr, src) {
        const s = this.size(pr, src), c = this.ctx;
        c.fillStyle = this.color;
        c.beginPath();
        c.arc(x, y, Math.max(0.5, s / 2), 0, TAU);
        c.fill();
        this.bbox = U.bboxAddCircle(this.bbox, x, y, s / 2 + 1);
      },
      end(p) { this.stroker.to({ ...p, pressure: this.sm.pressure }); },
      extra: {
        size(pr, src) {
          const o = this.o;
          return o.pressureSize && (!src || usePen(src)) ? o.size * (0.12 + 0.88 * pr) : o.size;
        },
        move(p) {
          // simple exponential stabiliser: higher smoothing = steadier, laggier line
          const k = 1 - U.clamp(this.o.smoothing, 0, 0.95) * 0.9;
          this.sm = { x: U.lerp(this.sm.x, p.x, k), y: U.lerp(this.sm.y, p.y, k), pressure: U.lerp(this.sm.pressure, p.pressure, k) };
          this.stroker.to({ ...p, ...this.sm });
          app.view.dirty();
        },
      },
    });

    T.brush = paintTool('brush', {
      buffered: true,
      begin() { this.stampImg = B.stamp(this.color, this.o.hardness); },
      spacing(pr) { return this.sz(pr) * 0.12; },
      dab(x, y, pr, src) {
        const s = this.sz(pr, src), c = this.ctx;
        c.globalAlpha = U.clamp(this.o.flow * (usePen(src) ? 0.35 + 0.65 * pr : 1), 0.01, 1);
        B.dab(c, this.stampImg, x, y, s, this.o.tilt && usePen(src) ? src.tilt : null);
        this.bbox = U.bboxAddCircle(this.bbox, x, y, s / 2 + 1);
      },
      extra: {
        sz(pr, src) {
          return Math.max(1, this.o.pressureSize && (!src || usePen(src)) ? this.o.size * (0.25 + 0.75 * pr) : this.o.size);
        },
      },
    });

    T.marker = paintTool('marker', {
      buffered: true,
      begin() { this.stampImg = B.stamp(this.color, this.o.hardness); },
      spacing() { return this.o.size * 0.1; },
      dab(x, y, pr, src) {
        B.dab(this.ctx, this.stampImg, x, y, this.o.size, this.o.tilt && usePen(src) ? src.tilt : null);
        this.bbox = U.bboxAddCircle(this.bbox, x, y, this.o.size / 2 + 1);
      },
    });

    T.airbrush = paintTool('airbrush', {
      buffered: true,
      begin(p) {
        this.cur = p;
        clearInterval(this.timer);
        this.timer = setInterval(() => { this.spray(this.cur.x, this.cur.y, this.cur.pressure, this.cur); app.view.dirty(); }, 30);
      },
      spacing() { return this.o.size * 0.3; },
      dab(x, y, pr, src) { this.spray(x, y, pr, src); },
      end() { clearInterval(this.timer); this.timer = null; },
      extra: {
        move(p) { this.cur = p; this.stroker.to(p); app.view.dirty(); },
        spray(x, y, pr, src) {
          const o = this.o, r = o.size / 2, c = this.ctx;
          const pressure = usePen(src) ? 0.25 + 0.75 * pr : 1;
          const n = Math.round(U.clamp(o.flow * r * 0.8 * pressure, 1, 320));
          const ds = Math.max(1, o.size / 50);
          let cx = x, cy = y;
          if (usePen(src) && src.tilt.amount > 0.05) {
            cx += Math.cos(src.tilt.azimuth) * r * 0.45 * src.tilt.amount;
            cy += Math.sin(src.tilt.azimuth) * r * 0.45 * src.tilt.amount;
          }
          c.fillStyle = this.color;
          c.globalAlpha = 0.55;
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU;
            const rr = r * (0.5 * Math.random() + 0.5 * Math.sqrt(Math.random()));
            c.fillRect(cx + Math.cos(a) * rr - ds / 2, cy + Math.sin(a) * rr - ds / 2, ds, ds);
          }
          this.bbox = U.bboxAddCircle(this.bbox, cx, cy, r + 2);
        },
      },
    });

    T.eraser = paintTool('eraser', {
      altPick: false,
      begin() { this.stampImg = B.stamp('#000000', this.o.hardness); this.ctx.globalCompositeOperation = 'destination-out'; },
      spacing(pr) { return this.sz(pr) * 0.1; },
      dab(x, y, pr, src) {
        const s = this.sz(pr, src);
        this.ctx.globalAlpha = this.o.opacity;
        B.dab(this.ctx, this.stampImg, x, y, s, null);
        this.bbox = U.bboxAddCircle(this.bbox, x, y, s / 2 + 1);
      },
      extra: {
        sz(pr, src) {
          return Math.max(1, this.o.pressureSize && usePen(src) ? this.o.size * (0.3 + 0.7 * pr) : this.o.size);
        },
      },
    });

    T.smudge = paintTool('smudge', {
      altPick: false,
      begin(p) {
        const s = Math.max(2, Math.round(this.o.size));
        this.d = s;
        this.carry = U.makeCanvas(s, s);
        this.cc = this.carry.getContext('2d');
        this.tmp = U.makeCanvas(s, s);
        this.tc = this.tmp.getContext('2d');
        this.mask = B.stamp('#000000', this.o.hardness);
        this.cc.drawImage(this.L.canvas, Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s, 0, 0, s, s);
      },
      spacing() { return this.d * 0.12; },
      dab(x, y, pr, src) {
        const s = this.d, ix = Math.round(x - s / 2), iy = Math.round(y - s / 2);
        const tc = this.tc;
        tc.globalCompositeOperation = 'copy';
        tc.drawImage(this.carry, 0, 0);
        tc.globalCompositeOperation = 'destination-in';
        tc.drawImage(this.mask, 0, 0, s, s);
        tc.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = U.clamp(this.o.strength * (usePen(src) ? 0.3 + 0.7 * pr : 1), 0, 1);
        this.ctx.drawImage(this.tmp, ix, iy);
        // the carried paint slowly picks up whatever is under the finger
        this.cc.globalAlpha = U.clamp(1 - this.o.strength, 0.04, 1);
        this.cc.drawImage(this.L.canvas, ix, iy, s, s, 0, 0, s, s);
        this.cc.globalAlpha = 1;
        this.bbox = U.bboxAddCircle(this.bbox, x, y, s / 2 + 2);
      },
    });

    T.clone = paintTool('clone', {
      altPick: false,
      begin(p) {
        const st = T.clone.state;
        if (p.alt) {
          st.src = { x: p.x, y: p.y };
          st.offset = null;
          app.logEvent('clone_source', { x: Math.round(p.x), y: Math.round(p.y) });
          app.toast('Clone source set');
          return false;
        }
        if (!st.src) { app.toast('Alt+click to set a clone source first'); return false; }
        if (!st.offset || !this.o.aligned) st.offset = { x: st.src.x - p.x, y: st.src.y - p.y };
        const s = Math.max(2, Math.round(this.o.size));
        this.d = s;
        this.tmp = U.makeCanvas(s, s);
        this.tc = this.tmp.getContext('2d');
        this.mask = B.stamp('#000000', this.o.hardness);
      },
      spacing() { return this.d * 0.1; },
      dab(x, y) {
        const s = this.d, r = s / 2, off = T.clone.state.offset, tc = this.tc;
        tc.globalCompositeOperation = 'copy';
        tc.drawImage(doc().snap, x + off.x - r, y + off.y - r, s, s, 0, 0, s, s);
        tc.globalCompositeOperation = 'destination-in';
        tc.drawImage(this.mask, 0, 0, s, s);
        tc.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = this.o.opacity;
        this.ctx.drawImage(this.tmp, x - r, y - r);
        this.bbox = U.bboxAddCircle(this.bbox, x, y, r + 1);
      },
      extra: {
        drawOverlay(c, v) {
          const st = this.state, cur = app.cursorDoc;
          if (!st.src) return;
          let x = st.src.x, y = st.src.y;
          if (st.offset && cur) { x = cur.x + st.offset.x; y = cur.y + st.offset.y; }
          const k = 7 / v.scale;
          c.lineWidth = 2.5 / v.scale;
          c.strokeStyle = 'rgba(0,0,0,.6)';
          c.beginPath(); c.moveTo(x - k, y); c.lineTo(x + k, y); c.moveTo(x, y - k); c.lineTo(x, y + k); c.stroke();
          c.lineWidth = 1 / v.scale;
          c.strokeStyle = '#fff';
          c.stroke();
        },
      },
    });
    T.clone.state = { src: null, offset: null };

    /* ---------------- fill & colour ---------------- */
    T.bucket = {
      id: 'bucket',
      cursor: 'crosshair',
      down(p) {
        if (!canPaint()) return false;
        const d = doc(), o = app.opt('bucket');
        const srcCanvas = o.sample === 'merged' ? d.flatten() : d.active.canvas;
        const data = srcCanvas.getContext('2d').getImageData(0, 0, d.w, d.h).data;
        let { mask, count, bbox } = B.floodFill(data, d.w, d.h, p.x, p.y, o.tolerance, o.contiguous);
        this.strokeInfo = { fillPixels: count };
        if (!count) return true;
        if (o.grow > 0) { mask = B.growMask(mask, d.w, d.h, o.grow); bbox = U.bboxPad(bbox, o.grow); }
        const img = new ImageData(d.w, d.h);
        const { r, g, b } = U.hexToRgb(app.colors.fg);
        const px = img.data;
        for (let i = 0; i < mask.length; i++) {
          if (!mask[i]) continue;
          const j = i * 4;
          px[j] = r; px[j + 1] = g; px[j + 2] = b; px[j + 3] = 255;
        }
        const tmp = U.makeCanvas(d.w, d.h);
        tmp.getContext('2d').putImageData(img, 0, 0);
        const tok = d.beginPixelEdit();
        const ctx = d.active.ctx;
        ctx.save();
        if (d.selection) ctx.clip(d.selection.path);
        ctx.globalAlpha = o.opacity;
        ctx.drawImage(tmp, 0, 0);
        ctx.restore();
        d.commitPixelEdit(tok, bbox, 'Bucket fill');
        app.view.dirty();
        return true;
      },
      move() {},
      up() {},
    };

    T.gradient = {
      id: 'gradient',
      cursor: 'crosshair',
      down(p) {
        if (!canPaint()) return false;
        const d = doc();
        this.o = app.opt('gradient');
        this.a = p; this.b = p; this.active = true;
        this.ctx = freshBuffer();
        d.liveBuffer = { canvas: buffer, alpha: this.o.opacity, clip: d.selection ? d.selection.path : null };
        return true;
      },
      move(p) {
        this.b = p.shift ? snapAngle(this.a, p) : p;
        this.paint();
        app.view.dirty();
      },
      paint() {
        const d = doc(), c = this.ctx, { a, b } = this;
        c.clearRect(0, 0, d.w, d.h);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 2) return;
        const fg = app.colors.fg;
        const end = this.o.gmode === 'fg-bg' ? app.colors.bg : U.rgba(fg, 0);
        const g = this.o.gtype === 'radial'
          ? c.createRadialGradient(a.x, a.y, 0, a.x, a.y, len)
          : c.createLinearGradient(a.x, a.y, b.x, b.y);
        g.addColorStop(0, fg);
        g.addColorStop(1, end);
        c.fillStyle = g;
        c.fillRect(0, 0, d.w, d.h);
      },
      up() {
        const d = doc();
        this.active = false;
        if (Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y) < 2) { d.liveBuffer = null; app.view.dirty(); return; }
        const tok = d.beginPixelEdit();
        compositeBuffer(d.active, this.o.opacity);
        d.commitPixelEdit(tok, d.selection ? d.selection.bbox : { x0: 0, y0: 0, x1: d.w, y1: d.h }, 'Gradient');
        this.strokeInfo = { gtype: this.o.gtype, length: Math.round(Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y)) };
        app.view.dirty();
      },
      drawOverlay(c, v) {
        if (!this.active) return;
        const { a, b } = this;
        c.lineWidth = 1.5 / v.scale;
        c.strokeStyle = '#fff';
        c.fillStyle = '#000';
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        for (const q of [a, b]) { c.beginPath(); c.arc(q.x, q.y, 4 / v.scale, 0, TAU); c.fill(); c.stroke(); }
      },
    };

    T.eyedropper = {
      id: 'eyedropper',
      cursor: 'crosshair',
      down(p) { this.pick(p); return true; },
      move(p) { this.pick(p); },
      up() {
        const o = app.opt('eyedropper');
        if (o.returnAfter && app.prevToolId && app.prevToolId !== 'eyedropper') {
          setTimeout(() => app.selectTool(app.prevToolId, 'auto_return'), 0);
        }
      },
      pick(p) {
        const hex = app.sampleColor(p.x, p.y, app.opt('eyedropper').sample);
        if (hex) app.setColor('fg', hex, 'eyedropper');
      },
    };

    T.colorpicker = {
      id: 'colorpicker',
      cursor: 'default',
      activate() { app.ui.openColorPicker({ fromTool: true }); },
      down() { app.ui.openColorPicker({ fromTool: true }); return false; },
      move() {},
      up() {},
    };

    /* ---------------- selection ---------------- */
    T.rectselect = {
      id: 'rectselect',
      cursor: 'crosshair',
      down(p) { this.a = p; this.b = p; this.active = true; return true; },
      move(p) {
        let b = p;
        if (p.shift) {
          const s = Math.max(Math.abs(p.x - this.a.x), Math.abs(p.y - this.a.y));
          b = { ...p, x: this.a.x + Math.sign(p.x - this.a.x || 1) * s, y: this.a.y + Math.sign(p.y - this.a.y || 1) * s };
        }
        this.b = b;
        app.view.dirty();
      },
      up() {
        this.active = false;
        const { a, b } = this;
        if (Math.abs(b.x - a.x) < 2 && Math.abs(b.y - a.y) < 2) { app.setSelection(null, 'rectselect'); return; }
        const [x0, y0] = clampDoc(a.x, a.y), [x1, y1] = clampDoc(b.x, b.y);
        app.setSelection(MP.rectSelection(Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)), 'rectselect');
      },
      drawOverlay(c, v) {
        if (!this.active) return;
        const { a, b } = this;
        c.lineWidth = 1 / v.scale;
        c.setLineDash([4 / v.scale, 4 / v.scale]);
        c.strokeStyle = '#000';
        c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        c.lineDashOffset = 4 / v.scale;
        c.strokeStyle = '#fff';
        c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      },
    };

    T.lasso = {
      id: 'lasso',
      cursor: 'crosshair',
      down(p) { this.pts = [clampDoc(p.x, p.y)]; this.active = true; return true; },
      move(p) {
        const last = this.pts[this.pts.length - 1];
        const q = clampDoc(p.x, p.y);
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) * app.view.scale >= 2) { this.pts.push(q); app.view.dirty(); }
      },
      up() {
        this.active = false;
        const sel = this.pts.length >= 3 ? MP.makeSelection('lasso', this.pts) : null;
        app.setSelection(sel && sel.area >= 4 ? sel : null, 'lasso');
        this.pts = [];
      },
      drawOverlay(c, v) {
        if (!this.active || this.pts.length < 2) return;
        c.lineWidth = 1 / v.scale;
        c.beginPath();
        c.moveTo(this.pts[0][0], this.pts[0][1]);
        for (const [x, y] of this.pts) c.lineTo(x, y);
        c.strokeStyle = '#000';
        c.setLineDash([4 / v.scale, 4 / v.scale]);
        c.stroke();
        c.strokeStyle = '#fff';
        c.lineDashOffset = 4 / v.scale;
        c.stroke();
      },
    };

    const moveSelection = (sel, fn) => (sel ? MP.makeSelection(sel.type, sel.pts.map(fn)) : null);

    T.move = {
      id: 'move',
      cursor: 'move',
      down(p) {
        if (!canPaint()) return false;
        const d = doc(), L = d.active;
        this.L = L;
        this.tok = d.beginPixelEdit(L);
        this.start = p;
        this.dx = 0; this.dy = 0;
        this.sel0 = d.selection;
        this.float = U.makeCanvas(d.w, d.h);
        const fc = this.float.getContext('2d');
        fc.save();
        if (d.selection) fc.clip(d.selection.path);
        fc.drawImage(d.snap, 0, 0);
        fc.restore();
        this.base = U.makeCanvas(d.w, d.h);
        if (d.selection) {
          const bc = this.base.getContext('2d');
          bc.drawImage(d.snap, 0, 0);
          bc.globalCompositeOperation = 'destination-out';
          bc.fill(d.selection.path);
        }
        return true;
      },
      move(p) {
        let dx = p.x - this.start.x, dy = p.y - this.start.y;
        if (p.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        this.dx = Math.round(dx); this.dy = Math.round(dy);
        this.apply();
      },
      apply() {
        const c = this.L.ctx;
        c.save();
        c.globalCompositeOperation = 'copy';
        c.drawImage(this.base, 0, 0);
        c.restore();
        c.drawImage(this.float, this.dx, this.dy);
        if (this.sel0) doc().selection = moveSelection(this.sel0, ([x, y]) => [x + this.dx, y + this.dy]);
        app.view.dirty();
      },
      up() {
        const d = doc();
        const { dx, dy, sel0 } = this;
        this.float = this.base = null;
        this.strokeInfo = { dx, dy };
        if (!dx && !dy) return;
        const bb = sel0
          ? U.bboxUnion(sel0.bbox, { x0: sel0.bbox.x0 + dx, y0: sel0.bbox.y0 + dy, x1: sel0.bbox.x1 + dx, y1: sel0.bbox.y1 + dy })
          : { x0: 0, y0: 0, x1: d.w, y1: d.h };
        d.commitPixelEdit(this.tok, bb, 'Move');
        if (sel0) d.setSelection(moveSelection(sel0, ([x, y]) => [x + dx, y + dy]));
      },
      nudge(dx, dy) {
        const p = { x: 0, y: 0 };
        if (!this.down(p)) return;
        this.move({ x: dx, y: dy });
        this.up();
        app.logEvent('nudge', { dx, dy });
      },
      key(e) {
        const step = e.shiftKey ? 10 : 1;
        const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!m) return false;
        this.nudge(m[0], m[1]);
        return true;
      },
    };

    T.transform = {
      id: 'transform',
      cursor: 'default',
      state: null,
      activate() { this.begin(); },
      deactivate() { this.commit(); },
      begin() {
        if (this.state) return true;
        const d = doc(), L = d.active;
        if (!L.visible) { app.toast('The active layer is hidden.'); return false; }
        const src = d.selection ? d.selection.bbox : d.contentBBox(L);
        if (!src) { app.toast('Nothing to transform on this layer'); return false; }
        const x = U.clamp(Math.floor(src.x0), 0, d.w), y = U.clamp(Math.floor(src.y0), 0, d.h);
        const w = U.clamp(Math.ceil(src.x1), 0, d.w) - x, h = U.clamp(Math.ceil(src.y1), 0, d.h) - y;
        if (w < 1 || h < 1) { app.toast('Nothing to transform on this layer'); return false; }
        const tok = d.beginPixelEdit(L);
        const fl = U.makeCanvas(w, h), fc = fl.getContext('2d');
        fc.translate(-x, -y);
        if (d.selection) fc.clip(d.selection.path);
        fc.drawImage(d.snap, 0, 0);
        const base = U.makeCanvas(d.w, d.h), bc = base.getContext('2d');
        bc.drawImage(d.snap, 0, 0);
        if (d.selection) { bc.globalCompositeOperation = 'destination-out'; bc.fill(d.selection.path); }
        else bc.clearRect(x, y, w, h);
        this.state = { tok, L, fl, base, w, h, cx: x + w / 2, cy: y + h / 2, cx0: x + w / 2, cy0: y + h / 2, sx: 1, sy: 1, rot: 0, sel0: d.selection, bb0: { x0: x, y0: y, x1: x + w, y1: y + h } };
        this.apply();
        app.ui.refreshOptions();
        return true;
      },
      mapPoint(px, py) {
        const s = this.state, cos = Math.cos(s.rot), sin = Math.sin(s.rot);
        const lx = (px - s.cx0) * s.sx, ly = (py - s.cy0) * s.sy;
        return [s.cx + lx * cos - ly * sin, s.cy + lx * sin + ly * cos];
      },
      corners() {
        const s = this.state, b = s.bb0;
        return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([x, y]) => this.mapPoint(x, y));
      },
      rotHandle() {
        const s = this.state, v = app.view;
        const hh = (s.h * Math.abs(s.sy)) / 2 + 26 / v.scale;
        return [s.cx + Math.sin(s.rot) * hh, s.cy - Math.cos(s.rot) * hh];
      },
      hit(p) {
        const v = app.view, tol = 9;
        const cs = this.corners();
        for (let i = 0; i < 4; i++) {
          const q = v.toScreen(cs[i][0], cs[i][1]);
          if (Math.hypot(q.sx - p.sx, q.sy - p.sy) <= tol) return { type: 'corner', i };
        }
        const rh = this.rotHandle(), rq = v.toScreen(rh[0], rh[1]);
        if (Math.hypot(rq.sx - p.sx, rq.sy - p.sy) <= tol + 2) return { type: 'rotate' };
        let inside = false;
        for (let i = 0, j = 3; i < 4; j = i++) {
          const [xi, yi] = cs[i], [xj, yj] = cs[j];
          if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return { type: inside ? 'move' : 'rotate' };
      },
      hover(p) {
        if (!this.state) { app.setCanvasCursor('default'); return; }
        const h = this.hit(p);
        app.setCanvasCursor(h.type === 'move' ? 'move' : h.type === 'corner' ? 'nwse-resize' : 'grab');
      },
      down(p) {
        if (!this.state && !this.begin()) return false;
        const s = this.state;
        this.drag = { h: this.hit(p), start: p, s0: { cx: s.cx, cy: s.cy, sx: s.sx, sy: s.sy, rot: s.rot } };
        return true;
      },
      move(p) {
        const s = this.state, dr = this.drag;
        if (!s || !dr) return;
        const { s0, start, h } = dr;
        if (h.type === 'move') {
          s.cx = s0.cx + (p.x - start.x);
          s.cy = s0.cy + (p.y - start.y);
        } else if (h.type === 'rotate') {
          const a0 = Math.atan2(start.y - s0.cy, start.x - s0.cx);
          const a1 = Math.atan2(p.y - s0.cy, p.x - s0.cx);
          let r = s0.rot + a1 - a0;
          if (p.shift) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
          s.rot = r;
        } else {
          const sg = [[-1, -1], [1, -1], [1, 1], [-1, 1]][h.i];
          const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
          const dx = p.x - s.cx, dy = p.y - s.cy;
          const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
          let sx = lx / ((sg[0] * s.w) / 2), sy = ly / ((sg[1] * s.h) / 2);
          if (p.shift) {
            const m = Math.max(Math.abs(sx) / Math.abs(s0.sx), Math.abs(sy) / Math.abs(s0.sy));
            sx = Math.sign(sx || 1) * Math.abs(s0.sx) * m;
            sy = Math.sign(sy || 1) * Math.abs(s0.sy) * m;
          }
          s.sx = Math.abs(sx) < 0.01 ? 0.01 * Math.sign(sx || 1) : sx;
          s.sy = Math.abs(sy) < 0.01 ? 0.01 * Math.sign(sy || 1) : sy;
        }
        this.apply();
      },
      up() { this.drag = null; },
      apply() {
        const s = this.state, c = s.L.ctx;
        c.save();
        c.globalCompositeOperation = 'copy';
        c.drawImage(s.base, 0, 0);
        c.restore();
        c.save();
        c.translate(s.cx, s.cy);
        c.rotate(s.rot);
        c.scale(s.sx, s.sy);
        c.imageSmoothingQuality = 'high';
        c.drawImage(s.fl, -s.w / 2, -s.h / 2);
        c.restore();
        app.view.dirty();
      },
      commit() {
        const s = this.state;
        if (!s) return;
        const d = doc();
        const changed = s.sx !== 1 || s.sy !== 1 || s.rot !== 0 || s.cx !== s.cx0 || s.cy !== s.cy0;
        if (!changed) {
          this.state = null;
          d.cancelPixelEdit(s.tok);
          app.ui.refreshOptions();
          return;
        }
        let bb = s.bb0;
        for (const [x, y] of this.corners()) bb = U.bboxUnion(bb, { x0: x, y0: y, x1: x, y1: y });
        const newSel = s.sel0 ? MP.makeSelection('lasso', s.sel0.pts.map(([x, y]) => this.mapPoint(x, y))) : null;
        this.state = null;
        d.commitPixelEdit(s.tok, bb, 'Transform');
        if (s.sel0) d.setSelection(newSel);
        app.logEvent('transform_commit', { sx: U.round(s.sx, 3), sy: U.round(s.sy, 3), rotDeg: U.round((s.rot * 180) / Math.PI, 1), dx: Math.round(s.cx - s.cx0), dy: Math.round(s.cy - s.cy0) });
        app.ui.refreshOptions();
      },
      cancel() {
        const s = this.state;
        if (!s) return;
        this.state = null;
        doc().cancelPixelEdit(s.tok);
        app.logEvent('transform_cancel', {});
        app.ui.refreshOptions();
      },
      key(e) {
        if (!this.state) return false;
        if (e.key === 'Enter') { this.commit(); return true; }
        if (e.key === 'Escape') { this.cancel(); return true; }
        return false;
      },
      drawOverlay(c, v) {
        if (!this.state) return;
        const cs = this.corners(), lw = 1 / v.scale;
        c.lineWidth = lw * 1.5;
        c.strokeStyle = '#2f80ff';
        c.beginPath();
        cs.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.closePath();
        c.stroke();
        const rh = this.rotHandle();
        const top = [(cs[0][0] + cs[1][0]) / 2, (cs[0][1] + cs[1][1]) / 2];
        c.beginPath(); c.moveTo(top[0], top[1]); c.lineTo(rh[0], rh[1]); c.stroke();
        c.fillStyle = '#fff';
        const k = 4.5 / v.scale;
        for (const [x, y] of cs) { c.fillRect(x - k, y - k, 2 * k, 2 * k); c.strokeRect(x - k, y - k, 2 * k, 2 * k); }
        c.beginPath(); c.arc(rh[0], rh[1], k, 0, TAU); c.fill(); c.stroke();
      },
    };

    /* ---------------- shapes ---------------- */
    function shapeTool(id) {
      return {
        id,
        cursor: 'crosshair',
        down(p) {
          if (!canPaint()) return false;
          this.o = app.opt(id);
          this.a = p; this.b = p; this.alt = p.alt; this.active = true;
          return true;
        },
        move(p) {
          this.alt = p.alt;
          if (p.shift) {
            if (id === 'line') this.b = snapAngle(this.a, p);
            else {
              const s = Math.max(Math.abs(p.x - this.a.x), Math.abs(p.y - this.a.y));
              this.b = { ...p, x: this.a.x + Math.sign(p.x - this.a.x || 1) * s, y: this.a.y + Math.sign(p.y - this.a.y || 1) * s };
            }
          } else this.b = p;
          app.view.dirty();
        },
        box() {
          const { a, b } = this;
          if (this.alt) { const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y); return U.bbox(a.x - dx, a.y - dy, a.x + dx, a.y + dy); }
          return U.bbox(a.x, a.y, b.x, b.y);
        },
        draw(c) {
          const o = this.o, style = id === 'line' ? 'stroke' : o.style;
          c.lineWidth = o.size;
          c.lineCap = 'round';
          c.lineJoin = 'round';
          c.strokeStyle = app.colors.fg;
          c.fillStyle = style === 'both' ? app.colors.bg : app.colors.fg;
          c.beginPath();
          if (id === 'line') { c.moveTo(this.a.x, this.a.y); c.lineTo(this.b.x, this.b.y); }
          else {
            const bx = this.box();
            if (id === 'rect') c.rect(bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0);
            else c.ellipse((bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2, (bx.x1 - bx.x0) / 2, (bx.y1 - bx.y0) / 2, 0, 0, TAU);
          }
          if (style !== 'stroke') c.fill();
          if (style !== 'fill') c.stroke();
        },
        up() {
          this.active = false;
          if (Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y) < 1.5) { app.view.dirty(); return; }
          const d = doc(), L = d.active;
          const tok = d.beginPixelEdit(L);
          L.ctx.save();
          if (d.selection) L.ctx.clip(d.selection.path);
          L.ctx.globalAlpha = this.o.opacity;
          this.draw(L.ctx);
          L.ctx.restore();
          const bb = id === 'line' ? U.bbox(this.a.x, this.a.y, this.b.x, this.b.y) : this.box();
          d.commitPixelEdit(tok, U.bboxPad(bb, this.o.size / 2 + 2), MP.TOOLS[id].name);
          const bx = this.box();
          this.strokeInfo = { shapeW: Math.round(bx.x1 - bx.x0), shapeH: Math.round(bx.y1 - bx.y0) };
          app.view.dirty();
        },
        drawOverlay(c) {
          if (!this.active) return;
          c.globalAlpha = this.o.opacity;
          this.draw(c);
        },
      };
    }
    T.line = shapeTool('line');
    T.rect = shapeTool('rect');
    T.ellipse = shapeTool('ellipse');

    return T;
  };
})(window.MP);
