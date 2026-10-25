/* Viewport: zoom/pan transform and rendering of the document plus overlays. */
(function (MP) {
  'use strict';
  const U = MP.U;

  class View {
    constructor(canvas, app) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.app = app;
      this.scale = 1;
      this.ox = 0;
      this.oy = 0;
      this.vw = 1;
      this.vh = 1;
      this.dpr = 1;
      this.cursor = null; // {sx, sy} last hover position in stage px
      this.needs = true;
      this.ants = 0;
      this._fitted = false;
      this.onChange = null;

      const tile = U.makeCanvas(16, 16);
      const t = tile.getContext('2d');
      t.fillStyle = '#d9d9d9'; t.fillRect(0, 0, 16, 16);
      t.fillStyle = '#f4f4f4'; t.fillRect(0, 0, 8, 8); t.fillRect(8, 8, 8, 8);
      this.checker = this.ctx.createPattern(tile, 'repeat');

      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      this.resize();
      setInterval(() => {
        if (this.app.doc && this.app.doc.selection) { this.ants = (this.ants + 1) % 16; this.dirty(); }
      }, 110);
      const loop = () => {
        if (this.needs) { this.needs = false; this.render(); }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    dirty() { this.needs = true; }

    resize() {
      const r = this.c.parentElement.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.vw = Math.max(1, r.width);
      this.vh = Math.max(1, r.height);
      this.c.width = Math.round(this.vw * this.dpr);
      this.c.height = Math.round(this.vh * this.dpr);
      this.c.style.width = this.vw + 'px';
      this.c.style.height = this.vh + 'px';
      this.bg = getComputedStyle(this.c).getPropertyValue('--stage-bg').trim() || '#3a3a3e';
      if (!this._fitted && this.app.doc && this.vw > 50) { this.fit(); this._fitted = true; }
      this.dirty();
    }

    fit() {
      const d = this.app.doc;
      const s = U.clamp(Math.min((this.vw - 48) / d.w, (this.vh - 48) / d.h), 0.05, 8);
      this.scale = s;
      this.ox = (this.vw - d.w * s) / 2;
      this.oy = (this.vh - d.h * s) / 2;
      this._changed();
    }
    actualSize() { this.setZoom(1); }
    setZoom(s, cx = this.vw / 2, cy = this.vh / 2) {
      s = U.clamp(s, 0.05, 32);
      const k = s / this.scale;
      this.ox = cx - (cx - this.ox) * k;
      this.oy = cy - (cy - this.oy) * k;
      this.scale = s;
      this._changed();
    }
    zoomBy(f, cx, cy) { this.setZoom(this.scale * f, cx, cy); }
    panBy(dx, dy) { this.ox += dx; this.oy += dy; this._changed(); }
    _changed() {
      this.dirty();
      if (this.onChange) this.onChange();
    }

    toDoc(sx, sy) { return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale }; }
    toScreen(x, y) { return { sx: x * this.scale + this.ox, sy: y * this.scale + this.oy }; }

    render() {
      const c = this.ctx, d = this.app.doc, s = this.scale, dpr = this.dpr;
      if (!d) return;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = this.bg;
      c.fillRect(0, 0, this.vw, this.vh);

      // document backdrop: shadow + checkerboard (screen-space so it doesn't scale)
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.35)';
      c.shadowBlur = 16;
      c.fillStyle = this.checker;
      c.fillRect(this.ox, this.oy, d.w * s, d.h * s);
      c.restore();

      c.save();
      c.setTransform(dpr * s, 0, 0, dpr * s, dpr * this.ox, dpr * this.oy);
      c.imageSmoothingEnabled = s < 2;
      c.imageSmoothingQuality = 'high';
      for (const L of d.layers) {
        if (!L.visible) continue;
        c.globalAlpha = L.opacity;
        c.drawImage(L.canvas, 0, 0);
        if (L === d.active && d.liveBuffer) {
          const b = d.liveBuffer;
          c.save();
          if (b.clip) c.clip(b.clip);
          c.globalAlpha = L.opacity * b.alpha;
          if (b.op) c.globalCompositeOperation = b.op;
          c.drawImage(b.canvas, 0, 0);
          c.restore();
        }
      }
      c.globalAlpha = 1;

      // selection marching ants
      if (d.selection) {
        c.lineWidth = 1 / s;
        c.setLineDash([5 / s, 5 / s]);
        c.strokeStyle = '#fff';
        c.lineDashOffset = -this.ants / s;
        c.stroke(d.selection.path);
        c.strokeStyle = '#000';
        c.lineDashOffset = (5 - this.ants) / s;
        c.stroke(d.selection.path);
        c.setLineDash([]);
      }

      const tool = this.app.tool;
      if (tool && tool.drawOverlay) {
        c.save();
        tool.drawOverlay(c, this);
        c.restore();
      }
      c.restore();

      // doc border
      c.strokeStyle = 'rgba(0,0,0,0.5)';
      c.lineWidth = 1;
      c.strokeRect(Math.round(this.ox) - 0.5, Math.round(this.oy) - 0.5, Math.round(d.w * s) + 1, Math.round(d.h * s) + 1);

      // brush outline cursor
      if (this.cursor && tool && tool.brush && !this.app.panning) {
        const r = Math.max(1.5, (this.app.opt(tool.id).size * s) / 2);
        const { sx, sy } = this.cursor;
        c.beginPath();
        c.arc(sx, sy, r, 0, Math.PI * 2);
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(0,0,0,0.55)';
        c.stroke();
        c.lineWidth = 1.2;
        c.strokeStyle = 'rgba(255,255,255,0.95)';
        c.stroke();
        c.fillStyle = '#fff';
        c.fillRect(sx - 0.75, sy - 0.75, 1.5, 1.5);
      }
    }
  }

  MP.View = View;
})(window.MP);
