/* Document model: layers, selection, undo/redo history. Emits 'change' (needs repaint),
   'layers' (layer list changed), 'history' and 'selection'. */
(function (MP) {
  'use strict';
  const U = MP.U;
  let layerSeq = 0;

  class Layer {
    constructor(w, h, name) {
      this.id = 'L' + ++layerSeq;
      this.name = name || 'Layer ' + layerSeq;
      this.canvas = U.makeCanvas(w, h);
      this.ctx = this.canvas.getContext('2d');
      this.visible = true;
      this.opacity = 1;
    }
  }

  class History {
    constructor(doc, { limit = 80, maxBytes = 350e6 } = {}) {
      this.doc = doc;
      this.undoStack = [];
      this.redoStack = [];
      this.limit = limit;
      this.maxBytes = maxBytes;
    }
    get bytes() {
      return this.undoStack.reduce((s, c) => s + (c.bytes || 0), 0);
    }
    push(cmd) {
      this.undoStack.push(cmd);
      this.redoStack = [];
      while (this.undoStack.length > this.limit || (this.undoStack.length > 1 && this.bytes > this.maxBytes)) {
        this.undoStack.shift();
      }
      this.doc.emit('history');
    }
    canUndo() { return this.undoStack.length > 0; }
    canRedo() { return this.redoStack.length > 0; }
    undo() {
      const cmd = this.undoStack.pop();
      if (!cmd) return null;
      cmd.undo();
      this.redoStack.push(cmd);
      this.doc.emit('history');
      this.doc.emit('change');
      if (cmd.structural) this.doc.emit('layers');
      return cmd;
    }
    redo() {
      const cmd = this.redoStack.pop();
      if (!cmd) return null;
      cmd.redo();
      this.undoStack.push(cmd);
      this.doc.emit('history');
      this.doc.emit('change');
      if (cmd.structural) this.doc.emit('layers');
      return cmd;
    }
    clear() {
      this.undoStack = [];
      this.redoStack = [];
      this.doc.emit('history');
    }
  }

  /* Selections are always stored as polygons in doc coordinates. */
  MP.makeSelection = function (type, pts) {
    if (!pts || pts.length < 3) return null;
    const path = new Path2D();
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
    path.closePath();
    let bb = null;
    for (const [x, y] of pts) bb = U.bboxUnion(bb, { x0: x, y0: y, x1: x, y1: y });
    let area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    return { type, pts, path, bbox: bb, area: Math.abs(area / 2) };
  };
  MP.rectSelection = (x0, y0, x1, y1) => {
    const b = U.bbox(x0, y0, x1, y1);
    return MP.makeSelection('rect', [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]);
  };

  class Doc {
    constructor(w, h, { background = '#ffffff' } = {}) {
      this.w = w;
      this.h = h;
      this.layers = [];
      this.activeIndex = 0;
      this.selection = null;
      this.liveBuffer = null; // {canvas, alpha, clip} drawn above the active layer while a stroke is in flight
      this._listeners = {};
      this.history = new History(this);
      this.snap = U.makeCanvas(w, h);
      this.snapCtx = this.snap.getContext('2d', { willReadFrequently: true });
      const bg = this.addLayer('Background', { record: false });
      if (background) {
        bg.ctx.fillStyle = background;
        bg.ctx.fillRect(0, 0, w, h);
      }
      this.addLayer('Layer 1', { record: false });
    }

    on(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
    emit(ev, data) { (this._listeners[ev] || []).forEach((f) => f(data)); }

    get active() { return this.layers[this.activeIndex]; }

    /* ---------- layers ---------- */
    _insertLayer(L, i) {
      this.layers.splice(i, 0, L);
      this.activeIndex = i;
    }
    _removeLayer(L) {
      const i = this.layers.indexOf(L);
      if (i < 0) return -1;
      this.layers.splice(i, 1);
      this.activeIndex = U.clamp(this.activeIndex >= i ? this.activeIndex - 1 : this.activeIndex, 0, this.layers.length - 1);
      return i;
    }
    addLayer(name, { record = true, index, layer } = {}) {
      const L = layer || new Layer(this.w, this.h, name);
      const i = index != null ? index : this.layers.length ? this.activeIndex + 1 : 0;
      this._insertLayer(L, i);
      if (record) {
        this.history.push({
          label: 'New layer', structural: true,
          undo: () => this._removeLayer(L),
          redo: () => this._insertLayer(L, i),
        });
      }
      this.emit('layers');
      this.emit('change');
      return L;
    }
    duplicateLayer(i = this.activeIndex) {
      const src = this.layers[i];
      const L = new Layer(this.w, this.h, src.name + ' copy');
      L.ctx.drawImage(src.canvas, 0, 0);
      L.opacity = src.opacity;
      this.addLayer(null, { layer: L, index: i + 1 });
      this.history.undoStack[this.history.undoStack.length - 1].label = 'Duplicate layer';
      return L;
    }
    deleteLayer(i = this.activeIndex) {
      if (this.layers.length <= 1) return false;
      const L = this.layers[i];
      const prevActive = this.activeIndex;
      this._removeLayer(L);
      this.history.push({
        label: 'Delete layer', structural: true,
        undo: () => { this._insertLayer(L, i); this.activeIndex = prevActive; },
        redo: () => this._removeLayer(L),
      });
      this.emit('layers');
      this.emit('change');
      return true;
    }
    moveLayer(i, to) {
      if (to < 0 || to >= this.layers.length || to === i) return false;
      const doMove = (a, b) => {
        const [L] = this.layers.splice(a, 1);
        this.layers.splice(b, 0, L);
        this.activeIndex = b;
      };
      doMove(i, to);
      this.history.push({ label: 'Reorder layer', structural: true, undo: () => doMove(to, i), redo: () => doMove(i, to) });
      this.emit('layers');
      this.emit('change');
      return true;
    }
    mergeDown(i = this.activeIndex) {
      if (i <= 0) return false;
      const top = this.layers[i], below = this.layers[i - 1];
      const before = below.ctx.getImageData(0, 0, this.w, this.h);
      if (top.visible) {
        below.ctx.save();
        below.ctx.globalAlpha = top.opacity;
        below.ctx.drawImage(top.canvas, 0, 0);
        below.ctx.restore();
      }
      const after = below.ctx.getImageData(0, 0, this.w, this.h);
      this._removeLayer(top);
      this.activeIndex = i - 1;
      this.history.push({
        label: 'Merge down', structural: true, bytes: before.data.length * 2,
        undo: () => { below.ctx.putImageData(before, 0, 0); this._insertLayer(top, i); },
        redo: () => { below.ctx.putImageData(after, 0, 0); this._removeLayer(top); this.activeIndex = i - 1; },
      });
      this.emit('layers');
      this.emit('change');
      return true;
    }
    setActive(i) {
      if (i < 0 || i >= this.layers.length) return;
      this.activeIndex = i;
      this.emit('layers');
    }
    setVisible(i, v) {
      this.layers[i].visible = v;
      this.emit('layers');
      this.emit('change');
    }
    setOpacity(i, v) {
      this.layers[i].opacity = U.clamp(v, 0, 1);
      this.emit('change');
    }
    rename(i, name) {
      this.layers[i].name = name || this.layers[i].name;
      this.emit('layers');
    }

    /* ---------- pixel edits ---------- */
    /* Snapshot the layer before an edit; commit stores only the dirty rect for undo. */
    beginPixelEdit(layer = this.active) {
      this.snapCtx.globalCompositeOperation = 'copy';
      this.snapCtx.drawImage(layer.canvas, 0, 0);
      this.snapCtx.globalCompositeOperation = 'source-over';
      return { layer };
    }
    commitPixelEdit(tok, bbox, label) {
      const r = U.bboxClip(bbox, this.w, this.h);
      if (!r) return null;
      const L = tok.layer;
      const before = this.snapCtx.getImageData(r.x, r.y, r.w, r.h);
      const after = L.ctx.getImageData(r.x, r.y, r.w, r.h);
      this.history.push({
        label, layer: L, bytes: before.data.length * 2,
        undo: () => L.ctx.putImageData(before, r.x, r.y),
        redo: () => L.ctx.putImageData(after, r.x, r.y),
      });
      this.emit('change');
      this.emit('pixels', L);
      return r;
    }
    cancelPixelEdit(tok) {
      const ctx = tok.layer.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(this.snap, 0, 0);
      ctx.restore();
      this.emit('change');
    }
    clearLayer(i = this.activeIndex, label = 'Clear layer') {
      const L = this.layers[i];
      const tok = this.beginPixelEdit(L);
      L.ctx.save();
      if (this.selection) L.ctx.clip(this.selection.path);
      L.ctx.clearRect(0, 0, this.w, this.h);
      L.ctx.restore();
      return this.commitPixelEdit(tok, this.selection ? this.selection.bbox : { x0: 0, y0: 0, x1: this.w, y1: this.h }, label);
    }
    fillLayer(color, i = this.activeIndex) {
      const L = this.layers[i];
      const tok = this.beginPixelEdit(L);
      L.ctx.save();
      if (this.selection) L.ctx.clip(this.selection.path);
      L.ctx.fillStyle = color;
      L.ctx.fillRect(0, 0, this.w, this.h);
      L.ctx.restore();
      return this.commitPixelEdit(tok, this.selection ? this.selection.bbox : { x0: 0, y0: 0, x1: this.w, y1: this.h }, 'Fill');
    }

    /* ---------- selection ---------- */
    setSelection(sel) {
      this.selection = sel && sel.area >= 1 ? sel : null;
      this.emit('selection', this.selection);
      this.emit('change');
    }

    /* ---------- compositing ---------- */
    compositeTo(ctx) {
      for (const L of this.layers) {
        if (!L.visible) continue;
        ctx.globalAlpha = L.opacity;
        ctx.drawImage(L.canvas, 0, 0);
      }
      ctx.globalAlpha = 1;
    }
    flatten() {
      const c = U.makeCanvas(this.w, this.h);
      this.compositeTo(c.getContext('2d'));
      return c;
    }
    contentBBox(L = this.active) {
      const { data } = L.ctx.getImageData(0, 0, this.w, this.h);
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (let y = 0; y < this.h; y++) {
        const row = y * this.w * 4;
        for (let x = 0; x < this.w; x++) {
          if (data[row + x * 4 + 3] > 0) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            y1 = y;
          }
        }
      }
      return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
    }
  }

  MP.Layer = Layer;
  MP.Doc = Doc;
})(window.MP);
