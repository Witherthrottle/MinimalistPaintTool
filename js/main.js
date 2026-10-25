/* App controller: wires document, view, tools, UI, logging, prediction and study together, and owns all
   pointer / keyboard input. */
(function (MP) {
  'use strict';
  const U = MP.U;
  const now = () => performance.now();

  const app = {
    doc: null, view: null, tools: null, tool: null, toolId: 'brush', prevToolId: null,
    colors: { fg: '#1e1e1e', bg: '#ffffff' },
    opts: {},
    clusterCurrent: { draw: 'brush', edit: 'eraser', fill: 'bucket', select: 'lasso', shapes: 'line' },
    input: { barrel: 'radial', eraserTip: true },
    stroking: false, panning: false, spaceDown: false,
    cursorDoc: null, lastPointer: null, taskId: null,
    toolSince: now(), strokesInTool: 0, lastStroke: null, lastUndoT: -Infinity, lastSwitch: null, lastSwitchT: null,
    travel: { lastCanvas: null, lastPos: null, path: 0 },
    penHoverStart: null,
    touches: new Map(),

    init() {
      const stored = U.store.get('mp.toolOpts', {});
      for (const id of MP.TOOL_IDS) this.opts[id] = { ...MP.TOOL_DEFAULTS[id], ...(stored[id] || {}) };
      const savedColors = U.store.get('mp.colors');
      if (savedColors && U.isHex(savedColors.fg) && U.isHex(savedColors.bg)) this.colors = savedColors;

      this.canvas = document.getElementById('view');
      this.stage = document.getElementById('stage');
      this.doc = new MP.Doc(1600, 1000);
      this.view = new MP.View(this.canvas, this);
      this.tools = MP.createTools(this);
      this.tool = this.tools[this.toolId];
      this.logger = new MP.Logger();
      this.uploader = new MP.Uploader(this.logger);
      this.engine = new MP.PredictionEngine();
      this.suggest = new MP.Suggestions(this);
      this.ui = new MP.UI(this);
      this.study = new MP.Study(this);
      this.attachDoc();
      this.view.fit();
      this.view.onChange = () => { this.throttledStatus(); this.logView(); };
      this.bindPointer();
      this.bindKeys();
      this.setCanvasCursor();
      this.study.renderSessionInfo();
      this.ui.refreshStatus();
      this.saveOpts = U.debounce(() => U.store.set('mp.toolOpts', this.opts), 500);
      this.logView = U.debounce(() => this.logEvent('view_change', { zoom: U.round(this.view.scale, 3), ox: Math.round(this.view.ox), oy: Math.round(this.view.oy) }), 400);
      this._optLog = {};
      this._colorLog = U.debounce((which, color, source) => this.logEvent('color_change', { which, color, source }), 350);
      this.suggest.refresh('init', { force: true });
      if (!/[?&]nosetup\b/.test(location.search)) this.study.showSetup(true);
    },

    /* ======================= document ======================= */
    attachDoc() {
      const d = this.doc;
      d.on('change', () => this.view.dirty());
      d.on('layers', () => { this.ui.refreshLayers(); this.ui.refreshStatus(); });
      d.on('history', () => { this.ui.refreshHistory(); this.scheduleThumbs(); });
      d.on('selection', () => this.ui.refreshStatus());
    },
    replaceDoc(d, reason) {
      this.commitPending();
      this.doc = d;
      this.attachDoc();
      this.tools.clone.state.src = null;
      this.tools.clone.state.offset = null;
      this.view.fit();
      this.ui.refreshLayers();
      this.ui.refreshHistory();
      this.ui.refreshStatus();
      this.logEvent('canvas_new', { reason, w: d.w, h: d.h, layerCount: d.layers.length });
      if (this.toolId === 'transform') this.ui.refreshOptions();
    },
    resetDocument(reason) { this.replaceDoc(new MP.Doc(this.doc.w, this.doc.h), reason); },
    /* Fresh document with the task's provided layers (images scaled to fit) and blank working layers. */
    async loadTaskCanvas(task, reason) {
      const d = new MP.Doc(this.doc.w, this.doc.h);
      d.layers.splice(1);
      d.activeIndex = 0;
      for (const sl of task.startLayers || []) {
        const img = await U.loadImage(sl.image);
        const L = new MP.Layer(d.w, d.h, sl.name);
        const s = Math.min(d.w / img.width, d.h / img.height);
        L.ctx.drawImage(img, (d.w - img.width * s) / 2, (d.h - img.height * s) / 2, img.width * s, img.height * s);
        L.opacity = sl.opacity == null ? 1 : sl.opacity;
        d.addLayer(null, { layer: L, record: false });
      }
      for (const name of task.newLayers || []) d.addLayer(name, { record: false });
      if (d.layers.length === 1) d.addLayer('Layer 1', { record: false });
      this.replaceDoc(d, reason);
      this.logEvent('task_canvas', { layers: d.layers.map((L) => L.name) });
    },
    scheduleThumbs() {
      clearTimeout(this._thumbT);
      this._thumbT = setTimeout(() => this.ui.refreshThumbs(), 250);
    },

    /* ======================= logging helpers ======================= */
    logEvent(type, data) {
      if (!this.logger.active) return null;
      if (this.taskId && data && data.taskId === undefined) data = { taskId: this.taskId, ...data };
      return this.logger.log(type, data);
    },

    contextSnapshot() {
      const t = now(), d = this.doc;
      const ctx = {
        tool: this.toolId, zoom: this.view.scale, layerCount: d.layers.length, activeLayer: d.activeIndex,
        selectionActive: !!d.selection, msInTool: t - this.toolSince, strokesInTool: this.strokesInTool,
        lastStrokeLen: this.lastStroke ? this.lastStroke.len : 0, lastPressure: this.lastStroke ? this.lastStroke.pressure : null,
        undoRecent: t - this.lastUndoT < 5000,
      };
      ctx.features = MP.FEATURES.vector(ctx);
      return ctx;
    },

    resetSessionState() {
      this.toolSince = now();
      this.strokesInTool = 0;
      this.lastSwitch = null;
      this.lastSwitchT = null;
      this.lastUndoT = -Infinity;
      this.lastStroke = null;
      this.lastLiftT = null;
      this.pendingSwitch = null;
      this.logEvent('tool_initial', { tool: this.toolId, layerCount: this.doc.layers.length, zoom: U.round(this.view.scale, 3) });
    },

    travelFrom(meta) {
      const tr = this.travel;
      if (!meta || meta.clientX == null || !tr.lastCanvas) return {};
      const t = tr.lastCanvas;
      const tail = tr.lastPos ? Math.hypot(meta.clientX - tr.lastPos.x, meta.clientY - tr.lastPos.y) : 0;
      return {
        travelPx: Math.round(Math.hypot(meta.clientX - t.x, meta.clientY - t.y)),
        travelPathPx: Math.round(tr.path + tail),
        travelMs: Math.round(now() - t.t),
      };
    },

    /* ======================= tools ======================= */
    opt(id) { return this.opts[id]; },
    setOpt(id, key, val) {
      if (this.opts[id][key] === val) return;
      this.opts[id][key] = val;
      this.saveOpts();
      this.view.dirty();
      const k = id + '.' + key;
      if (!this._optLog[k]) this._optLog[k] = U.debounce((v) => this.logEvent('option_change', { tool: id, key, value: v }), 500);
      this._optLog[k](val);
    },

    selectTool(id, method = 'api', meta = {}) {
      if (!MP.TOOLS[id]) return;
      if (this.ui.flyout) this.ui.closeFlyout(id);
      if (id === this.toolId) {
        if (method !== 'auto_return' && method !== 'api') this.logEvent('tool_reselect', { tool: id, method });
        return;
      }
      if (this.stroking) return;
      const t = now(), from = this.toolId;
      const ctx = this.contextSnapshot();
      const { clientX, clientY, ...extra } = meta;
      let model = { condition: 'logging' };
      if (MP.LOGGING_ONLY && this.suggest.visible) model = { condition: 'logging', shown: this.suggest.displayed, inSuggestions: this.suggest.displayed.includes(id) };
      if (!MP.LOGGING_ONLY) {
        const rank = this.engine.rank(ctx);
        const ri = rank.list.findIndex((x) => x.tool === id);
        const shown = this.suggest.adaptive ? this.suggest.displayed : null;
        model = {
          condition: this.engine.mode, predictor: rank.predictor, fallback: rank.fallback || undefined,
          shown, inSuggestions: shown ? shown.includes(id) : null,
          modelTopK: rank.list.slice(0, this.suggest.cfg.k).map((x) => x.tool), modelRank: ri + 1, modelP: ri >= 0 ? U.round(rank.list[ri].p, 4) : null,
        };
      }
      this.logEvent('tool_change', {
        from, to: id, method, ...extra, ...model,
        ...this.travelFrom(meta),
        msSinceLastSwitch: this.lastSwitchT != null ? Math.round(t - this.lastSwitchT) : null,
        msInPrevTool: Math.round(t - this.toolSince), strokesInPrevTool: this.strokesInTool,
        features: ctx.features.map((v) => U.round(v, 4)),
        zoom: U.round(ctx.zoom, 3), layerCount: ctx.layerCount, selectionActive: ctx.selectionActive,
      });
      const ls = this.lastSwitch;
      if (ls && t - ls.t <= 3000 && ls.strokes === 0 && method !== 'auto_return' && ls.method !== 'auto_return') {
        this.logEvent('wrong_tool_correction', {
          kind: 'reswitch', wrongTool: ls.to, wrongMethod: ls.method, previousTool: ls.from, correctedTo: id, correctedMethod: method,
          latencyMs: Math.round(t - ls.t), strokesWithWrongTool: ls.strokes, returnedToPrevious: id === ls.from,
        });
      }
      if (!MP.LOGGING_ONLY) this.engine.observe(from, id, ctx.features);

      if (this.tool.deactivate) this.tool.deactivate();
      this.prevToolId = from;
      this.toolId = id;
      this.tool = this.tools[id];
      this.clusterCurrent[MP.TOOLS[id].cluster] = id;
      this.toolSince = t;
      this.strokesInTool = 0;
      this.lastSwitchT = t;
      this.lastSwitch = { t, from, to: id, method, strokes: 0, undoLogged: false };
      // tool-switch time runs from the last pen lift (or this switch, if nothing was drawn yet) to the first stroke with the new tool
      if (!this.pendingSwitch) this.pendingSwitch = { from, t, liftT: this.lastLiftT != null ? this.lastLiftT : t, switches: 0 };
      this.pendingSwitch.switches++;
      this.ui.refreshToolbar();
      this.ui.refreshOptions();
      this.setCanvasCursor();
      this.suggest.markActive();
      this.view.dirty();
      if (this.tool.activate) this.tool.activate();
      this.suggest.refresh('tool_change');
    },

    commitPending() {
      if (this.tools.transform.state) this.tools.transform.commit();
    },

    setCanvasCursor(c) {
      if (!c) c = this.spaceDown ? 'grab' : this.tool.brush ? 'none' : this.tool.cursor || 'crosshair';
      this.canvas.style.cursor = c;
    },

    /* ======================= colours ======================= */
    setColor(which, hex, source, { keepHSV = false } = {}) {
      hex = U.normHex(hex);
      if (this.colors[which] === hex) return;
      this.colors[which] = hex;
      U.store.set('mp.colors', this.colors);
      if (keepHSV && this.ui.popover) this.ui.popover.keep = true;
      if (!/picker$/.test(source) || source === 'hex_picker') this.ui.pushRecent(hex);
      this.ui.refreshColor();
      this._colorLog(which, hex, source);
    },
    swapColors(method) {
      const { fg, bg } = this.colors;
      this.colors = { fg: bg, bg: fg };
      U.store.set('mp.colors', this.colors);
      this.ui.refreshColor();
      this.logEvent('color_swap', { method });
    },
    resetColors(method) {
      this.colors = { fg: '#000000', bg: '#ffffff' };
      U.store.set('mp.colors', this.colors);
      this.ui.refreshColor();
      this.logEvent('color_reset', { method });
    },
    sampleColor(x, y, mode = 'merged') {
      const d = this.doc;
      if (x < 0 || y < 0 || x >= d.w || y >= d.h) return null;
      if (!this._px) { this._px = U.makeCanvas(1, 1); this._pxc = this._px.getContext('2d', { willReadFrequently: true }); }
      const c = this._pxc, ix = Math.floor(x), iy = Math.floor(y);
      c.clearRect(0, 0, 1, 1);
      const layers = mode === 'layer' ? [d.active] : d.layers.filter((L) => L.visible);
      for (const L of layers) {
        c.globalAlpha = mode === 'layer' ? 1 : L.opacity;
        c.drawImage(L.canvas, ix, iy, 1, 1, 0, 0, 1, 1);
      }
      c.globalAlpha = 1;
      const px = c.getImageData(0, 0, 1, 1).data;
      if (px[3] === 0) return null;
      return U.rgbToHex(px[0], px[1], px[2]);
    },
    pickColorAt(p, source) {
      const hex = this.sampleColor(p.x, p.y, 'merged');
      if (hex) { this.setColor('fg', hex, source); this.logEvent('quick_pick', { source, color: hex }); }
    },

    /* ======================= edit commands ======================= */
    undo(method) {
      if (this.stroking) return;
      this.commitPending();
      const cmd = this.doc.history.undo();
      if (!cmd) { this.ui.toast('Nothing to undo'); return; }
      const t = now();
      this.lastUndoT = t;
      this.logEvent('undo', { method, label: cmd.label, tool: this.toolId });
      const ls = this.lastSwitch;
      if (ls && !ls.undoLogged && t - ls.t <= 3000) {
        ls.undoLogged = true;
        this.logEvent('wrong_tool_correction', { kind: 'undo', wrongTool: ls.to, wrongMethod: ls.method, previousTool: ls.from, latencyMs: Math.round(t - ls.t), strokesWithWrongTool: ls.strokes });
      }
      this.ui.refreshLayers();
    },
    redo(method) {
      if (this.stroking) return;
      this.commitPending();
      const cmd = this.doc.history.redo();
      if (!cmd) { this.ui.toast('Nothing to redo'); return; }
      this.logEvent('redo', { method, label: cmd.label, tool: this.toolId });
      this.ui.refreshLayers();
    },
    clearActive(method) {
      this.commitPending();
      if (this.doc.clearLayer()) this.logEvent('clear', { method, selection: !!this.doc.selection });
    },
    fillActive(method) {
      this.commitPending();
      if (this.doc.fillLayer(this.colors.fg)) this.logEvent('fill_command', { method, selection: !!this.doc.selection, color: this.colors.fg });
    },
    setSelection(sel, source) {
      this.doc.setSelection(sel);
      const s = this.doc.selection;
      this.logEvent('selection', s
        ? { source, action: 'set', shape: s.type, area: Math.round(s.area), bbox: [s.bbox.x0, s.bbox.y0, s.bbox.x1, s.bbox.y1].map(Math.round) }
        : { source, action: 'clear' });
    },
    selectAll(method) {
      this.commitPending();
      this.setSelection(MP.rectSelection(0, 0, this.doc.w, this.doc.h), 'select_all:' + method);
    },
    deselect(method) {
      if (!this.doc.selection) return;
      this.commitPending();
      this.setSelection(null, 'deselect:' + method);
    },
    layerAction(action, idx, method, arg) {
      const d = this.doc;
      const i = idx == null ? d.activeIndex : idx;
      if (action !== 'select' && action !== 'toggle' && action !== 'rename') this.commitPending();
      if (action === 'select' && i !== d.activeIndex) this.commitPending();
      let ok = true;
      switch (action) {
        case 'add': d.addLayer(null); break;
        case 'duplicate': d.duplicateLayer(i); break;
        case 'delete': ok = d.deleteLayer(i); break;
        case 'up': ok = d.moveLayer(i, i + 1); break;
        case 'down': ok = d.moveLayer(i, i - 1); break;
        case 'merge': ok = d.mergeDown(i); break;
        case 'toggle': d.setVisible(i, !d.layers[i].visible); break;
        case 'select': if (i === d.activeIndex) return; d.setActive(i); break;
        case 'rename': if (!arg || arg === d.layers[i].name) { this.ui.refreshLayers(); return; } d.rename(i, arg); break;
        default: return;
      }
      if (!ok) return;
      this.logEvent('layer_' + action, { method, layer: i, active: d.activeIndex, layerCount: d.layers.length, visible: action === 'toggle' ? d.layers[i].visible : undefined });
      if (['add', 'duplicate', 'delete', 'merge'].includes(action)) this.suggest.refresh('layers');
    },

    zoomStep(f, method) { this.view.zoomBy(f); this.logEvent('zoom_command', { method, factor: f }); },
    zoomFit(method) { this.view.fit(); this.logEvent('zoom_command', { method, fit: true }); },
    zoomActual(method) { this.view.actualSize(); this.logEvent('zoom_command', { method, actual: true }); },

    dialogNewCanvas() {
      const w = U.el('input', { type: 'number', min: 64, max: 6000, value: this.doc.w });
      const h = U.el('input', { type: 'number', min: 64, max: 6000, value: this.doc.h });
      const bg = U.el('select', {}, U.el('option', { value: 'white' }, 'White'), U.el('option', { value: 'transparent' }, 'Transparent'));
      const row = (l, x) => U.el('label', { class: 'frow' }, U.el('span', { class: 'flbl' }, l), x);
      this.ui.modal({
        title: 'New canvas',
        body: U.el('div', { class: 'form' }, row('Width', w), row('Height', h), row('Background', bg), U.el('p', { class: 'muted' }, 'The current drawing will be discarded.')),
        actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, act: () => {
          const W = U.clamp(Math.round(+w.value) || 1600, 64, 6000), H = U.clamp(Math.round(+h.value) || 1000, 64, 6000);
          this.replaceDoc(new MP.Doc(W, H, { background: bg.value === 'white' ? '#ffffff' : null }), 'menu');
        } }],
      });
    },
    async openImage() {
      const [file] = await U.pickFiles('image/*');
      if (!file) return;
      try {
        const img = await U.loadImage(await U.readFile(file, 'dataURL'));
        this.commitPending();
        const d = this.doc;
        const s = Math.min(1, d.w / img.width, d.h / img.height);
        const L = new MP.Layer(d.w, d.h, file.name.replace(/\.[^.]+$/, '').slice(0, 24));
        L.ctx.drawImage(img, (d.w - img.width * s) / 2, (d.h - img.height * s) / 2, img.width * s, img.height * s);
        d.addLayer(null, { layer: L });
        this.logEvent('image_import', { w: img.width, h: img.height, scale: U.round(s, 3), layerCount: d.layers.length });
      } catch (e) {
        this.ui.toast('Could not open that image');
      }
    },
    exportPNG() {
      this.commitPending();
      const name = (this.logger.active ? this.logger.meta.sessionId : 'painting-' + U.dateStamp()) + '.png';
      this.doc.flatten().toBlob((b) => { if (b) U.download(name, b, 'image/png'); });
      this.logEvent('export', { kind: 'png' });
    },
    toast(msg) { this.ui.toast(msg); },

    /* ======================= pointer input ======================= */
    makePoint(e) {
      const r = this._rect || (this._rect = this.canvas.getBoundingClientRect());
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const { x, y } = this.view.toDoc(sx, sy);
      const pen = e.pointerType === 'pen';
      const tx = e.tiltX || 0, ty = e.tiltY || 0;
      return {
        x, y, sx, sy, t: e.timeStamp,
        pressure: pen ? U.clamp(e.pressure || 0, 0.01, 1) : 1,
        tilt: { amount: Math.min(1, Math.hypot(tx, ty) / 60), azimuth: Math.atan2(ty, tx) },
        tiltX: tx, tiltY: ty,
        pointerType: e.pointerType, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
      };
    },

    bindPointer() {
      const c = this.canvas;
      window.addEventListener('resize', () => { this._rect = null; });
      new ResizeObserver(() => { this._rect = null; }).observe(this.stage);
      c.addEventListener('pointerdown', (e) => this.onDown(e));
      c.addEventListener('pointermove', (e) => this.onMove(e));
      c.addEventListener('pointerup', (e) => this.onUp(e, false));
      c.addEventListener('pointercancel', (e) => this.onUp(e, true));
      c.addEventListener('pointerleave', (e) => {
        this.view.cursor = null;
        this.cursorDoc = null;
        this.view.dirty();
        if (e.pointerType === 'pen' && this.penHoverStart != null && !this.stroking) {
          this.logEvent('pen_proximity', { state: 'leave', hoverMs: Math.round(now() - this.penHoverStart) });
          this.penHoverStart = null;
        }
      });
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      // pen-to-toolbar travel: path length of pointer movement after leaving the canvas
      window.addEventListener('pointermove', (e) => {
        if (e.target === c) return;
        const tr = this.travel;
        if (!tr.lastCanvas) return;
        if (tr.lastPos) tr.path += Math.hypot(e.clientX - tr.lastPos.x, e.clientY - tr.lastPos.y);
        tr.lastPos = { x: e.clientX, y: e.clientY };
      }, true);
    },

    onDown(e) {
      if (this.ui.modalOpen) return;
      const p = this.makePoint(e);
      this.lastPointer = { type: e.pointerType, pressure: p.pressure };
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, { sx: p.sx, sy: p.sy });
        if (this.touches.size === 2) { this.startPinch(); return; }
        if (this.touches.size > 2) return;
      }
      if (this.activePointer != null || this.panning) return;
      const isBarrel = e.pointerType === 'pen' && (e.button === 2 || (e.buttons & 2) === 2);
      const isEraserTip = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) === 32);

      if (e.button === 1 || this.spaceDown || (isBarrel && this.input.barrel === 'pan')) { this.startPan(e, isBarrel ? 'barrel' : e.button === 1 ? 'middle' : 'space'); return; }
      if (isBarrel && this.input.barrel === 'radial') {
        if (this.suggest.openRadial(p.sx, p.sy, 'barrel')) { c(this.canvas, e); return; }
      }
      if (isBarrel && this.input.barrel === 'none') return;
      if (e.pointerType === 'mouse' && e.button === 2) {
        if (this.suggest.cfg.style === 'radial' && this.suggest.openRadial(p.sx, p.sy, 'right_click')) c(this.canvas, e);
        return;
      }
      if (e.button !== 0 && !isBarrel && !isEraserTip) return;
      if (this.ui.openMenu) this.ui.closeMenu(null);
      if (this.ui.flyout) this.ui.closeFlyout(null);

      let tool = this.tool, via = null;
      if (isEraserTip && this.input.eraserTip) { tool = this.tools.eraser; via = 'eraser_tip'; }
      else if (isBarrel) { tool = this.tools.eyedropper; via = 'barrel'; }
      tool.strokeInfo = null;
      if (!tool.down(p)) return;
      c(this.canvas, e);
      this.activePointer = e.pointerId;
      this.stroking = true;
      this.strokeTool = tool;
      const t = now();
      this.stroke = {
        tool: tool.id, via, t0: t, last: p, len: 0, slen: 0, samples: 1, pressures: [p.pressure], speeds: [], tilts: [],
        pointerType: e.pointerType, hoverMs: this.penHoverStart != null ? Math.round(t - this.penHoverStart) : null,
      };
      const ps = this.pendingSwitch;
      if (ps && !via) {
        this.pendingSwitch = null;
        this.logEvent('tool_switch_time', {
          from: ps.from, to: tool.id, switchTimeMs: Math.round(t - ps.liftT), sinceLastSwitchMs: Math.round(t - this.lastSwitchT),
          switches: ps.switches, fromLift: this.lastLiftT != null && ps.liftT === this.lastLiftT,
        });
      }
      this.logEvent('stroke_start', {
        tool: tool.id, via: via || undefined, x: Math.round(p.x), y: Math.round(p.y), pressure: U.round(p.pressure, 3),
        pointerType: e.pointerType, layer: this.doc.activeIndex, hoverMs: this.stroke.hoverMs,
      });
      this.penHoverStart = null;
      function c(el, ev) { try { el.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ } }
    },

    onMove(e) {
      const p = this.makePoint(e);
      if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
        this.touches.set(e.pointerId, { sx: p.sx, sy: p.sy });
        if (this.pinch) { this.updatePinch(); return; }
      }
      this.view.cursor = { sx: p.sx, sy: p.sy };
      this.cursorDoc = { x: p.x, y: p.y };
      this.lastPointer = { type: e.pointerType, pressure: p.pressure };
      const tr = this.travel;
      tr.lastCanvas = { x: e.clientX, y: e.clientY, t: now() };
      tr.lastPos = { x: e.clientX, y: e.clientY };
      tr.path = 0;
      if (e.pointerType === 'pen' && e.buttons === 0 && this.penHoverStart == null && !this.stroking) {
        this.penHoverStart = now();
        this.logEvent('pen_proximity', { state: 'enter' });
      }

      if (this.panning && e.pointerId === this.panPointer) {
        this.view.panBy(e.clientX - this.panLast.x, e.clientY - this.panLast.y);
        this.panLast = { x: e.clientX, y: e.clientY };
        return;
      }
      if (this.suggest.radialOpen) return;
      if (this.stroking && e.pointerId === this.activePointer) {
        let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
        if (!evs || !evs.length) evs = [e];
        const s = this.stroke;
        for (const ce of evs) {
          const q = this.makePoint(ce);
          this.strokeTool.move(q);
          const dd = Math.hypot(q.x - s.last.x, q.y - s.last.y);
          const ds = Math.hypot(q.sx - s.last.sx, q.sy - s.last.sy);
          const dt = q.t - s.last.t;
          s.len += dd;
          s.slen += ds;
          s.samples++;
          if (s.pressures.length < 6000) {
            s.pressures.push(q.pressure);
            if (dt > 0) s.speeds.push((ds / dt) * 1000);
            if (q.pointerType === 'pen') s.tilts.push(q.tilt.amount * 60);
          }
          s.last = q;
        }
      } else if (!this.stroking) {
        if (this.tool.hover) this.tool.hover(p);
        this.view.dirty();
      }
      this.throttledStatus();
    },

    onUp(e, cancelled) {
      if (e.pointerType === 'touch') {
        this.touches.delete(e.pointerId);
        if (this.pinch && this.touches.size < 2) { this.endPinch(); return; }
      }
      if (this.panning && e.pointerId === this.panPointer) { this.endPan(); return; }
      const p = this.makePoint(e);
      if (this.suggest.radialOpen) { this.suggest.releaseRadial(p.sx, p.sy, e); return; }
      if (!this.stroking || e.pointerId !== this.activePointer) return;
      this.finishStroke(p, cancelled);
    },

    finishStroke(p, cancelled) {
      const tool = this.strokeTool, s = this.stroke;
      tool.up(p);
      this.stroking = false;
      this.activePointer = null;
      const durationMs = Math.round(now() - s.t0);
      const pr = U.stats(s.pressures), sp = U.stats(s.speeds), tl = U.stats(s.tilts);
      this.logEvent('stroke_end', {
        tool: s.tool, via: s.via || undefined, durationMs, samples: s.samples,
        lengthPx: Math.round(s.len), screenLengthPx: Math.round(s.slen), pointerType: s.pointerType,
        pressureMin: pr.min, pressureMean: pr.mean, pressureMax: pr.max, pressureSd: pr.sd,
        speedMean: sp.mean != null ? Math.round(sp.mean) : null, speedMax: sp.max != null ? Math.round(sp.max) : null, speedSd: sp.sd != null ? Math.round(sp.sd) : null,
        tiltMeanDeg: tl.mean, zoom: U.round(this.view.scale, 3), layer: this.doc.activeIndex, layerCount: this.doc.layers.length,
        cancelled: cancelled || undefined, ...(tool.strokeInfo || {}),
      });
      tool.strokeInfo = null;
      this.lastLiftT = now();
      if (!s.via) {
        this.strokesInTool++;
        if (this.lastSwitch) this.lastSwitch.strokes++;
      }
      this.lastStroke = { len: s.len, pressure: pr.mean };
      if (s.pointerType === 'pen') this.penHoverStart = now();
      this.suggest.followPen(p.sx, p.sy);
      this.suggest.onStrokeEnd();
      this.suggest.refresh('stroke_end');
      this.scheduleThumbs();
      this.ui.refreshStatus();
      return durationMs;
    },

    startPan(e, trigger) {
      this.panning = true;
      this.panPointer = e.pointerId;
      this.panLast = { x: e.clientX, y: e.clientY };
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this.setCanvasCursor('grabbing');
      this.panTrigger = trigger;
    },
    endPan() {
      this.panning = false;
      this.panPointer = null;
      this.setCanvasCursor();
      this.logEvent('pan', { trigger: this.panTrigger });
    },
    startPinch() {
      if (this.stroking) {
        const short = now() - this.stroke.t0 < 300;
        this.finishStroke(this.stroke.last, true);
        if (short) { this.doc.history.undo(); this.logEvent('stroke_discard', { reason: 'pinch' }); }
      }
      const [a, b] = [...this.touches.values()];
      this.pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, cx: (a.sx + b.sx) / 2, cy: (a.sy + b.sy) / 2 };
    },
    updatePinch() {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, cx = (a.sx + b.sx) / 2, cy = (a.sy + b.sy) / 2;
      this.view.panBy(cx - this.pinch.cx, cy - this.pinch.cy);
      this.view.zoomBy(d / this.pinch.d, cx, cy);
      this.pinch = { d, cx, cy };
    },
    endPinch() {
      this.pinch = null;
      this.touches.clear();
      this.logEvent('pan', { trigger: 'pinch' });
    },

    onWheel(e) {
      e.preventDefault();
      if (this.stroking) return;
      const r = this._rect || (this._rect = this.canvas.getBoundingClientRect());
      const mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dy = e.deltaY * mult, dx = e.deltaX * mult;
      if (e.shiftKey) this.view.panBy(-(dx || dy), 0);
      else if (e.altKey) this.view.panBy(-dx, -dy);
      else this.view.zoomBy(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    },

    throttledStatus() {
      if (this._stT) return;
      this._stT = setTimeout(() => { this._stT = null; this.ui.refreshStatus(); }, 80);
    },

    /* ======================= keyboard ======================= */
    bindKeys() {
      window.addEventListener('keydown', (e) => this.onKey(e));
      window.addEventListener('keyup', (e) => {
        if (e.key === ' ') { this.spaceDown = false; if (!this.panning) this.setCanvasCursor(); }
      });
      window.addEventListener('blur', () => { this.spaceDown = false; });
    },

    onKey(e) {
      if (U.isTyping(e)) return;
      if (this.ui.modalOpen) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (e.key === 'Escape') {
        if (this.suggest.radialOpen) { this.suggest.closeRadial(null); return; }
        if (this.ui.openMenu) { this.ui.closeMenu(null); return; }
        if (this.ui.flyout) { this.ui.closeFlyout(null); return; }
        if (this.ui.popover) { this.ui.closeColorPicker(); return; }
      }
      if (this.tool.key && !ctrl && this.tool.key(e)) { e.preventDefault(); return; }
      if (e.key === ' ') {
        e.preventDefault();
        if (!this.spaceDown) { this.spaceDown = true; this.setCanvasCursor(); }
        return;
      }
      if (this.stroking) return;

      if (ctrl) {
        const map = {
          z: () => (e.shiftKey ? this.redo('shortcut') : this.undo('shortcut')),
          y: () => this.redo('shortcut'),
          a: () => this.selectAll('shortcut'),
          d: () => this.deselect('shortcut'),
          j: () => this.layerAction('duplicate', null, 'shortcut'),
          e: () => (e.shiftKey ? this.exportPNG() : this.layerAction('merge', null, 'shortcut')),
          n: () => e.shiftKey && this.layerAction('add', null, 'shortcut'),
          ']': () => this.layerAction('up', null, 'shortcut'),
          '[': () => this.layerAction('down', null, 'shortcut'),
          s: () => this.study.exportCurrent('json'),
        };
        if (map[key]) { e.preventDefault(); map[key](); }
        return;
      }
      if (e.altKey && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); this.fillActive('shortcut'); return; }
      const o = this.opt(this.toolId);
      switch (key) {
        case '[': if (o.size != null) { this.setOpt(this.toolId, 'size', Math.max(1, Math.round(o.size / 1.18))); this.ui.refreshOptions(); } return;
        case ']': if (o.size != null) { this.setOpt(this.toolId, 'size', Math.min(300, Math.max(o.size + 1, Math.round(o.size * 1.18)))); this.ui.refreshOptions(); } return;
        case 'x': this.swapColors('shortcut'); return;
        case 'd': this.resetColors('shortcut'); return;
        case '+': case '=': this.zoomStep(1.25, 'shortcut'); return;
        case '-': case '_': this.zoomStep(0.8, 'shortcut'); return;
        case '0': this.zoomFit('shortcut'); return;
        case '1': this.zoomActual('shortcut'); return;
        case '?': this.ui.showShortcuts(); return;
        case 'Tab': e.preventDefault(); this.ui.togglePanels(); return;
        case 'Delete': case 'Backspace': e.preventDefault(); this.clearActive('shortcut'); return;
        default: break;
      }
      if (!e.altKey && MP.KEY_TO_TOOL[key]) { e.preventDefault(); this.selectTool(MP.KEY_TO_TOOL[key], 'shortcut'); }
    },
  };

  MP.app = app;
  window.addEventListener('DOMContentLoaded', () => app.init());
})(window.MP);
