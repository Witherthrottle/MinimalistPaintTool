/* Static (baseline) interface: menubar with nested menus, clustered toolbar with flyouts, options bar,
   right-hand panels, colour picker popover, status bar, modals and toasts. Every way of picking a tool
   reports its method to app.selectTool so the logs can tell them apart. */
(function (MP) {
  'use strict';
  const U = MP.U;
  const el = U.el;
  const $ = (s) => document.querySelector(s);
  const pct = (v) => Math.round(v * 100) + '%';

  const OPT_SPECS = {
    size: { label: 'Size', type: 'range', min: 1, max: 300, step: 1, unit: 'px' },
    opacity: { label: 'Opacity', type: 'range', min: 0.01, max: 1, step: 0.01, pct: true },
    flow: { label: 'Flow', type: 'range', min: 0.01, max: 1, step: 0.01, pct: true },
    hardness: { label: 'Hardness', type: 'range', min: 0, max: 1, step: 0.01, pct: true },
    strength: { label: 'Strength', type: 'range', min: 0.05, max: 1, step: 0.01, pct: true },
    smoothing: { label: 'Stabilizer', type: 'range', min: 0, max: 0.95, step: 0.05, pct: true },
    tolerance: { label: 'Tolerance', type: 'range', min: 0, max: 255, step: 1 },
    grow: { label: 'Grow', type: 'range', min: 0, max: 4, step: 1, unit: 'px' },
    pressureSize: { label: 'Pressure → size', type: 'check' },
    tilt: { label: 'Tilt', type: 'check' },
    contiguous: { label: 'Contiguous', type: 'check' },
    aligned: { label: 'Aligned', type: 'check' },
    returnAfter: { label: 'Return to previous tool', type: 'check' },
    sample: { label: 'Sample', type: 'select', options: [['layer', 'Current layer'], ['merged', 'All layers']] },
    gtype: { label: 'Type', type: 'select', options: [['linear', 'Linear'], ['radial', 'Radial']] },
    gmode: { label: 'Colors', type: 'select', options: [['fg-bg', 'FG → BG'], ['fg-transparent', 'FG → Transparent']] },
    style: { label: 'Style', type: 'select', options: [['stroke', 'Outline'], ['fill', 'Filled'], ['both', 'Outline + BG fill']] },
  };
  const HINTS = {
    clone: 'Alt+click sets the source',
    smudge: 'Drag to push paint around',
    eyedropper: 'Click or drag to sample',
    lasso: 'Drag a freehand selection · click to deselect',
    rectselect: 'Drag a box · Shift = square · click to deselect',
    move: 'Drag to move the selection (or whole layer) · Shift locks axis · arrows nudge',
    transform: 'Drag corners to scale (Shift keeps ratio) · drag outside to rotate · Enter applies, Esc cancels',
    line: 'Shift snaps to 15°',
    rect: 'Shift = square · Alt = from center',
    ellipse: 'Shift = circle · Alt = from center',
    bucket: 'Click to fill',
    gradient: 'Drag to set direction · Shift snaps angle',
  };
  const PALETTE = ['#000000', '#3c3c3c', '#7a7a7a', '#b4b4b4', '#ffffff', '#5b3a29', '#a0522d', '#e2a76f',
    '#c0392b', '#e74c3c', '#f39c12', '#f1c40f', '#27ae60', '#2ecc71', '#16a085', '#1abc9c',
    '#2c3e50', '#2980b9', '#3498db', '#8e44ad', '#9b59b6', '#e84393', '#fd79a8', '#ffeaa7'];

  class UI {
    constructor(app) {
      this.app = app;
      this.openMenu = null;
      this.recent = U.store.get('mp.recentColors', []);
      this.buildMenubar();
      this.buildToolbar();
      this.buildPanels();
      this.buildStatusbar();
      this.refreshOptions();
      document.addEventListener('pointerdown', (e) => this.onGlobalPointerDown(e), true);
    }

    /* ======================= menu logging ======================= */
    trackOpen(menu, trigger) {
      return { menu, trigger, at: performance.now() };
    }
    logOpen(t) { this.app.logEvent('menu_open', { menu: t.menu, trigger: t.trigger }); }
    logClose(t, selected) {
      this.app.logEvent('menu_close', { menu: t.menu, durationMs: Math.round(performance.now() - t.at), selected: selected || null });
    }

    /* ======================= menubar ======================= */
    menus() {
      const a = this.app;
      const toolItems = MP.CLUSTERS.map((c) => ({
        label: c.name,
        submenu: c.tools.map((t) => ({ label: MP.TOOLS[t].name, key: MP.TOOLS[t].key.toUpperCase(), icon: MP.TOOLS[t].icon, act: (e) => a.selectTool(t, 'menu', { clientX: e.clientX, clientY: e.clientY, menuPath: 'tools>' + c.id }) })),
      }));
      return [
        { id: 'file', label: 'File', items: [
          { label: 'New canvas…', act: () => a.dialogNewCanvas() },
          { label: 'Open image as layer…', act: () => a.openImage() },
          { sep: 1 },
          { label: 'Export image (PNG)', key: 'Ctrl+Shift+E', act: () => a.exportPNG() },
          { sep: 1 },
          { label: 'Export session log (JSON)', act: () => a.study.exportCurrent('json') },
          { label: 'Export session log (CSV)', act: () => a.study.exportCurrent('csv') },
          { label: 'Export tool-switch dataset (CSV)', act: () => a.study.exportCurrent('switch') },
          { label: 'Stored sessions…', act: () => a.study.showSessions() },
        ] },
        { id: 'edit', label: 'Edit', items: [
          { label: 'Undo', key: 'Ctrl+Z', act: () => a.undo('menu'), disabled: () => !a.doc.history.canUndo() },
          { label: 'Redo', key: 'Ctrl+Shift+Z', act: () => a.redo('menu'), disabled: () => !a.doc.history.canRedo() },
          { sep: 1 },
          { label: 'Clear', key: 'Del', act: () => a.clearActive('menu') },
          { label: 'Fill with foreground', key: 'Alt+⌫', act: () => a.fillActive('menu') },
          { sep: 1 },
          { label: 'Swap colors', key: 'X', act: () => a.swapColors('menu') },
          { label: 'Default colors', key: 'D', act: () => a.resetColors('menu') },
        ] },
        { id: 'layer', label: 'Layer', items: [
          { label: 'New layer', key: 'Ctrl+Shift+N', act: () => a.layerAction('add', null, 'menu') },
          { label: 'Duplicate layer', key: 'Ctrl+J', act: () => a.layerAction('duplicate', null, 'menu') },
          { label: 'Delete layer', act: () => a.layerAction('delete', null, 'menu'), disabled: () => a.doc.layers.length <= 1 },
          { label: 'Merge down', key: 'Ctrl+E', act: () => a.layerAction('merge', null, 'menu'), disabled: () => a.doc.activeIndex === 0 },
          { sep: 1 },
          { label: 'Arrange', submenu: [
            { label: 'Move up', key: 'Ctrl+]', act: () => a.layerAction('up', null, 'menu') },
            { label: 'Move down', key: 'Ctrl+[', act: () => a.layerAction('down', null, 'menu') },
          ] },
          { label: 'Toggle visibility', act: () => a.layerAction('toggle', null, 'menu') },
        ] },
        { id: 'select', label: 'Select', items: [
          { label: 'Select all', key: 'Ctrl+A', act: () => a.selectAll('menu') },
          { label: 'Deselect', key: 'Ctrl+D', act: () => a.deselect('menu'), disabled: () => !a.doc.selection },
          { sep: 1 },
          { label: 'Selection tools', submenu: ['lasso', 'rectselect'].map((t) => ({ label: MP.TOOLS[t].name, key: MP.TOOLS[t].key.toUpperCase(), icon: MP.TOOLS[t].icon, act: (e) => a.selectTool(t, 'menu', { clientX: e.clientX, clientY: e.clientY, menuPath: 'select' }) })) },
        ] },
        { id: 'view', label: 'View', items: [
          { label: 'Zoom in', key: '+', act: () => a.zoomStep(1.25, 'menu') },
          { label: 'Zoom out', key: '−', act: () => a.zoomStep(0.8, 'menu') },
          { label: 'Fit to window', key: '0', act: () => a.zoomFit('menu') },
          { label: 'Actual pixels', key: '1', act: () => a.zoomActual('menu') },
          { sep: 1 },
          { label: 'Toggle side panels', key: 'Tab', act: () => this.togglePanels() },
        ] },
        { id: 'tools', label: 'Tools', items: toolItems },
        { id: 'study', label: 'Study', items: [
          { label: 'Session setup…', act: () => a.study.showSetup() },
          { label: 'Start / finish task', act: () => a.study.toggleTask() },
          { label: 'NASA-TLX questionnaire', act: () => a.study.showTLX() },
          { label: 'SUS questionnaire', act: () => a.study.showSUS() },
          { sep: 1 },
          { label: 'Researcher settings…', act: () => a.study.showResearcher() },
          { label: 'Live event log', act: () => a.study.toggleLiveLog() },
          { sep: 1 },
          { label: 'End session…', act: () => a.study.endSession() },
        ] },
        { id: 'help', label: 'Help', items: [
          { label: 'Keyboard shortcuts', key: '?', act: () => this.showShortcuts() },
          { label: 'About', act: () => this.showAbout() },
        ] },
      ];
    }

    buildMenubar() {
      const nav = $('#menus');
      nav.innerHTML = '';
      this.menuDefs = this.menus();
      for (const m of this.menuDefs) {
        const b = el('button', { class: 'menu-btn', dataset: { menu: m.id } }, m.label);
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          if (this.openMenu && this.openMenu.id === m.id) this.closeMenu(null);
          else this.showMenu(m, b, 'click');
        });
        b.addEventListener('pointerenter', () => {
          if (this.openMenu && this.openMenu.id !== m.id) this.showMenu(m, b, 'hover_switch');
        });
        nav.append(b);
      }
    }

    showMenu(m, btn, trigger) {
      if (this.openMenu) this.closeMenu(null, true);
      this.closeFlyout(null);
      const layer = $('#menu-layer');
      const r = btn.getBoundingClientRect();
      const dd = this.renderMenuList(m.items, 'menubar:' + m.id);
      dd.style.left = r.left + 'px';
      dd.style.top = r.bottom + 'px';
      layer.append(dd);
      btn.classList.add('open');
      const t = this.trackOpen('menubar:' + m.id, trigger);
      this.logOpen(t);
      this.openMenu = { id: m.id, btn, dd, t };
    }

    renderMenuList(items, path) {
      const dd = el('div', { class: 'dropdown' });
      for (const it of items) {
        if (it.sep) { dd.append(el('div', { class: 'sep' })); continue; }
        const disabled = it.disabled && it.disabled();
        const row = el('div', { class: 'item' + (disabled ? ' disabled' : '') + (it.submenu ? ' has-sub' : '') },
          el('span', { class: 'ic' }, it.icon ? U.svgIcon(it.icon, 16) : null),
          el('span', { class: 'lbl' }, it.label),
          el('span', { class: 'key' }, it.submenu ? '▸' : it.key || ''));
        if (it.submenu) {
          const openSub = (trigger) => {
            dd.querySelectorAll(':scope > .item.sub-open').forEach((x) => { if (x !== row) { x.classList.remove('sub-open'); x._sub && x._sub.remove(); x._sub = null; } });
            if (row._sub) return;
            const sub = this.renderMenuList(it.submenu, path + '>' + it.label);
            const rr = row.getBoundingClientRect();
            sub.style.left = rr.right - 2 + 'px';
            sub.style.top = rr.top - 4 + 'px';
            $('#menu-layer').append(sub);
            row._sub = sub;
            row.classList.add('sub-open');
            this.app.logEvent('menu_open', { menu: path + '>' + it.label, trigger });
            // keep submenus inside the viewport
            const sr = sub.getBoundingClientRect();
            if (sr.right > window.innerWidth) sub.style.left = rr.left - sr.width + 2 + 'px';
            if (sr.bottom > window.innerHeight) sub.style.top = Math.max(4, window.innerHeight - sr.height - 4) + 'px';
          };
          row.addEventListener('pointerenter', () => openSub('hover'));
          row.addEventListener('pointerdown', (e) => { e.preventDefault(); openSub('click'); });
        } else {
          row.addEventListener('pointerenter', () => {
            dd.querySelectorAll(':scope > .item.sub-open').forEach((x) => { x.classList.remove('sub-open'); x._sub && x._sub.remove(); x._sub = null; });
          });
          row.addEventListener('pointerup', (e) => {
            if (disabled) return;
            e.preventDefault();
            this.closeMenu(path + '>' + it.label);
            it.act(e);
          });
        }
        dd.append(row);
      }
      return dd;
    }

    closeMenu(selected, silent) {
      const m = this.openMenu;
      if (!m) return;
      this.openMenu = null;
      m.btn.classList.remove('open');
      $('#menu-layer').innerHTML = '';
      this.logClose(m.t, selected);
    }

    onGlobalPointerDown(e) {
      if (this.openMenu && !e.target.closest('#menu-layer') && !e.target.closest('.menu-btn')) this.closeMenu(null);
      if (this.flyout && !e.target.closest('#flyout') && !e.target.closest('.cluster')) this.closeFlyout(null);
      if (this.popover && !e.target.closest('#popover') && !e.target.closest('.swatch-btn') && !e.target.closest('.cluster')) this.closeColorPicker();
    }

    /* ======================= toolbar ======================= */
    buildToolbar() {
      const tb = $('#toolbar');
      tb.innerHTML = '';
      this.clusterBtns = {};
      for (const c of MP.CLUSTERS) {
        const btn = el('div', { class: 'cluster', dataset: { cluster: c.id }, title: c.name, role: 'button', tabindex: 0 });
        const main = el('span', { class: 'cl-icon' });
        const corner = el('span', { class: 'cl-corner', title: 'More ' + c.name.toLowerCase() + ' tools' });
        btn.append(main, corner);
        let timer = null, longPressed = false;
        btn.addEventListener('pointerdown', (e) => {
          if (e.button === 2) return;
          e.preventDefault();
          longPressed = false;
          if (e.target === corner) { this.openFlyout(c, btn, 'corner'); longPressed = true; return; }
          timer = setTimeout(() => { longPressed = true; this.openFlyout(c, btn, 'long_press'); }, 350);
        });
        btn.addEventListener('pointerup', (e) => {
          clearTimeout(timer);
          if (longPressed || e.button === 2) return;
          if (this.flyout && this.flyout.cluster === c.id) { this.closeFlyout(null); return; }
          this.app.selectTool(this.app.clusterCurrent[c.id], 'toolbar', { clientX: e.clientX, clientY: e.clientY });
        });
        btn.addEventListener('pointerleave', () => clearTimeout(timer));
        btn.addEventListener('contextmenu', (e) => { e.preventDefault(); this.openFlyout(c, btn, 'right_click'); });
        tb.append(btn);
        this.clusterBtns[c.id] = { btn, main };
      }
      tb.append(el('div', { class: 'tb-sep' }));

      // colour swatches
      const sw = el('div', { class: 'swatches' });
      this.fgBtn = el('button', { class: 'swatch-btn fg', title: 'Foreground color (click to edit)', onclick: (e) => this.openColorPicker({ which: 'fg', trigger: 'swatch' }) });
      this.bgBtn = el('button', { class: 'swatch-btn bg', title: 'Background color (click to edit)', onclick: () => this.openColorPicker({ which: 'bg', trigger: 'swatch' }) });
      const swap = el('button', { class: 'mini swap', title: 'Swap colors (X)', onclick: () => this.app.swapColors('button') }, '⇄');
      const reset = el('button', { class: 'mini reset', title: 'Default colors (D)', onclick: () => this.app.resetColors('button') }, '◩');
      sw.append(this.bgBtn, this.fgBtn, swap, reset);
      tb.append(sw);
      tb.append(el('div', { class: 'tb-sep' }));

      const mk = (icon, title, fn) => el('button', { class: 'tb-btn', title, onclick: fn }, U.svgIcon(icon, 18));
      tb.append(
        mk('M9 14L4 9l5-5 M4 9h11a5 5 0 010 10h-3', 'Undo (Ctrl+Z)', () => this.app.undo('button')),
        mk('M15 14l5-5-5-5 M20 9H9a5 5 0 000 10h3', 'Redo (Ctrl+Shift+Z)', () => this.app.redo('button')),
        mk('M11 4a7 7 0 100 14 7 7 0 000-14z M21 21l-5-5 M8 11h6 M11 8v6', 'Zoom in (+)', () => this.app.zoomStep(1.25, 'button')),
        mk('M11 4a7 7 0 100 14 7 7 0 000-14z M21 21l-5-5 M8 11h6', 'Zoom out (−)', () => this.app.zoomStep(0.8, 'button')),
        mk('M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5', 'Fit to window (0)', () => this.app.zoomFit('button')),
      );
      this.refreshToolbar();
    }

    refreshToolbar() {
      for (const c of MP.CLUSTERS) {
        const { btn, main } = this.clusterBtns[c.id];
        const t = this.app.clusterCurrent[c.id];
        main.innerHTML = '';
        main.append(U.svgIcon(MP.TOOLS[t].icon, 22));
        btn.classList.toggle('active', MP.TOOLS[this.app.toolId].cluster === c.id);
        btn.title = `${MP.TOOLS[t].name} (${MP.TOOLS[t].key.toUpperCase()}) — hold or right-click for more ${c.name.toLowerCase()} tools`;
      }
      this.fgBtn.style.background = this.app.colors.fg;
      this.bgBtn.style.background = this.app.colors.bg;
    }

    openFlyout(c, btn, trigger) {
      this.closeFlyout(null);
      if (this.openMenu) this.closeMenu(null);
      const fl = $('#flyout');
      fl.innerHTML = '';
      fl.append(el('div', { class: 'fl-title' }, c.name));
      for (const t of c.tools) {
        const meta = MP.TOOLS[t];
        const row = el('button', { class: 'fl-item' + (t === this.app.toolId ? ' active' : '') },
          U.svgIcon(meta.icon, 18), el('span', { class: 'lbl' }, meta.name), el('span', { class: 'key' }, meta.key.toUpperCase()));
        row.addEventListener('pointerup', (e) => {
          e.preventDefault();
          this.closeFlyout(t);
          this.app.selectTool(t, 'flyout', { clientX: e.clientX, clientY: e.clientY, flyoutTrigger: trigger });
        });
        fl.append(row);
      }
      const r = btn.getBoundingClientRect();
      fl.style.left = r.right + 6 + 'px';
      fl.style.top = r.top + 'px';
      fl.classList.remove('hidden');
      const fr = fl.getBoundingClientRect();
      if (fr.bottom > window.innerHeight) fl.style.top = Math.max(4, window.innerHeight - fr.height - 6) + 'px';
      this.flyout = { cluster: c.id, t: this.trackOpen('flyout:' + c.id, trigger) };
      this.logOpen(this.flyout.t);
    }
    closeFlyout(selected) {
      if (!this.flyout) return;
      const f = this.flyout;
      this.flyout = null;
      $('#flyout').classList.add('hidden');
      this.logClose(f.t, selected);
    }

    /* ======================= options bar ======================= */
    refreshOptions() {
      const bar = $('#optionsbar');
      bar.innerHTML = '';
      const app = this.app, id = app.toolId, meta = MP.TOOLS[id], o = app.opt(id);
      bar.append(el('div', { class: 'ob-tool' }, U.svgIcon(meta.icon, 18), el('span', {}, meta.name)));
      for (const key of Object.keys(o)) {
        const spec = OPT_SPECS[key];
        if (!spec) continue;
        bar.append(this.optControl(id, key, spec, o[key]));
      }
      if (id === 'transform') {
        const active = !!(app.tools.transform.state);
        bar.append(
          el('button', { class: 'ob-btn primary', disabled: !active, onclick: () => app.tools.transform.commit() }, 'Apply'),
          el('button', { class: 'ob-btn', disabled: !active, onclick: () => app.tools.transform.cancel() }, 'Cancel'),
          el('button', { class: 'ob-btn', disabled: active, onclick: () => app.tools.transform.begin() }, 'Start'));
      }
      if (id === 'lasso' || id === 'rectselect' || id === 'move') {
        bar.append(el('button', { class: 'ob-btn', onclick: () => app.selectAll('optionsbar') }, 'Select all'),
          el('button', { class: 'ob-btn', onclick: () => app.deselect('optionsbar') }, 'Deselect'));
      }
      if (id === 'clone') {
        bar.append(el('button', { class: 'ob-btn', onclick: () => { app.tools.clone.state.src = null; app.tools.clone.state.offset = null; app.view.dirty(); } }, 'Clear source'));
      }
      if (id === 'colorpicker') bar.append(el('button', { class: 'ob-btn', onclick: () => this.openColorPicker({ fromTool: true }) }, 'Open picker'));
      if (HINTS[id]) bar.append(el('div', { class: 'ob-hint' }, HINTS[id]));
    }

    optControl(toolId, key, spec, val) {
      const app = this.app;
      const wrap = el('label', { class: 'ob-ctl ob-' + spec.type });
      wrap.append(el('span', { class: 'ob-lbl' }, spec.label));
      if (spec.type === 'range') {
        const fmt = (v) => (spec.pct ? pct(v) : Math.round(v) + (spec.unit || ''));
        const out = el('input', { class: 'ob-num', type: 'text', value: fmt(val) });
        const r = el('input', { type: 'range', min: spec.min, max: spec.max, step: spec.step, value: val });
        r.addEventListener('input', () => { const v = +r.value; out.value = fmt(v); app.setOpt(toolId, key, v); });
        out.addEventListener('change', () => {
          let v = parseFloat(out.value);
          if (!isFinite(v)) v = +r.value;
          if (spec.pct) v /= 100;
          v = U.clamp(v, spec.min, spec.max);
          r.value = v; out.value = fmt(v);
          app.setOpt(toolId, key, v);
        });
        out.addEventListener('keydown', (e) => { if (e.key === 'Enter') out.blur(); });
        wrap.append(r, out);
      } else if (spec.type === 'check') {
        const c = el('input', { type: 'checkbox', checked: !!val });
        c.addEventListener('change', () => app.setOpt(toolId, key, c.checked));
        wrap.prepend(c);
      } else if (spec.type === 'select') {
        const s = el('select', {}, spec.options.map(([v, l]) => el('option', { value: v, selected: v === val }, l)));
        s.addEventListener('change', () => app.setOpt(toolId, key, s.value));
        wrap.append(s);
      }
      return wrap;
    }

    /* ======================= panels ======================= */
    panel(id, title, { collapsed = false } = {}) {
      const body = el('div', { class: 'pn-body' });
      const head = el('div', { class: 'pn-head' }, el('span', { class: 'chev' }, '▾'), el('span', {}, title));
      const p = el('section', { class: 'panel' + (collapsed ? ' collapsed' : ''), id: 'panel-' + id }, head, body);
      head.addEventListener('click', () => {
        p.classList.toggle('collapsed');
        this.app.logEvent('panel_toggle', { panel: id, collapsed: p.classList.contains('collapsed') });
      });
      $('#panels').append(p);
      return body;
    }

    buildPanels() {
      $('#panels').innerHTML = '';
      this.taskBody = this.panel('task', 'Task');
      this.colorBody = this.panel('color', 'Color');
      this.layersBody = this.panel('layers', 'Layers');
      this.historyBody = this.panel('history', 'History', { collapsed: true });
      this.buildColorPanel();
      this.refreshLayers();
      this.refreshHistory();
    }

    buildColorPanel() {
      const b = this.colorBody;
      b.innerHTML = '';
      const hex = el('input', { class: 'hex', type: 'text', value: this.app.colors.fg, spellcheck: false });
      hex.addEventListener('change', () => {
        if (U.isHex(hex.value)) this.app.setColor('fg', U.normHex(hex.value), 'hex_panel');
        else hex.value = this.app.colors.fg;
      });
      this.panelHex = hex;
      const big = el('button', { class: 'big-swatch swatch-btn', title: 'Edit foreground color', onclick: () => this.openColorPicker({ which: 'fg', trigger: 'panel' }) });
      this.panelSwatch = big;
      b.append(el('div', { class: 'row' }, big, hex));
      const grid = el('div', { class: 'palette' });
      for (const c of PALETTE) {
        grid.append(el('button', { class: 'pal', style: { background: c }, title: c, onclick: () => this.app.setColor('fg', c, 'palette') }));
      }
      b.append(grid);
      this.recentRow = el('div', { class: 'palette recent' });
      b.append(el('div', { class: 'sub-lbl' }, 'Recent'), this.recentRow);
      this.refreshColor();
    }

    refreshColor() {
      const { fg } = this.app.colors;
      if (this.panelSwatch) this.panelSwatch.style.background = fg;
      if (this.panelHex && document.activeElement !== this.panelHex) this.panelHex.value = fg;
      if (this.recentRow) {
        this.recentRow.innerHTML = '';
        for (const c of this.recent) this.recentRow.append(el('button', { class: 'pal', style: { background: c }, title: c, onclick: () => this.app.setColor('fg', c, 'recent') }));
      }
      this.refreshToolbar();
      if (this.popover) this.syncPicker();
    }
    pushRecent(c) {
      this.recent = [c].concat(this.recent.filter((x) => x !== c)).slice(0, 12);
      U.store.set('mp.recentColors', this.recent);
    }

    refreshLayers() {
      const app = this.app, d = app.doc, b = this.layersBody;
      b.innerHTML = '';
      const list = el('div', { class: 'layers' });
      for (let i = d.layers.length - 1; i >= 0; i--) {
        const L = d.layers[i];
        const thumb = el('canvas', { class: 'thumb', width: 40, height: 28 });
        const tctx = thumb.getContext('2d');
        tctx.fillStyle = '#ddd'; tctx.fillRect(0, 0, 40, 28);
        tctx.drawImage(L.canvas, 0, 0, 40, 28);
        const eye = el('button', { class: 'eye' + (L.visible ? '' : ' off'), title: L.visible ? 'Hide layer' : 'Show layer',
          onclick: (e) => { e.stopPropagation(); app.layerAction('toggle', i, 'panel'); } }, L.visible ? '◉' : '○');
        const name = el('span', { class: 'lname' }, L.name);
        name.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const inp = el('input', { class: 'lrename', value: L.name });
          name.replaceWith(inp);
          inp.focus(); inp.select();
          const done = () => { app.layerAction('rename', i, 'panel', inp.value.trim()); };
          inp.addEventListener('blur', done);
          inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = L.name; inp.blur(); } });
        });
        const row = el('div', { class: 'layer' + (i === d.activeIndex ? ' active' : ''), onclick: () => app.layerAction('select', i, 'panel') }, eye, thumb, name);
        list.append(row);
      }
      b.append(list);
      const L = d.active;
      const op = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: L.opacity });
      const opv = el('span', { class: 'opv' }, pct(L.opacity));
      op.addEventListener('input', () => { d.setOpacity(d.activeIndex, +op.value); opv.textContent = pct(+op.value); });
      op.addEventListener('change', () => app.logEvent('layer_opacity', { layer: d.activeIndex, opacity: +op.value }));
      b.append(el('label', { class: 'layer-op' }, el('span', {}, 'Opacity'), op, opv));
      const btn = (icon, title, act, dis) => el('button', { class: 'tb-btn sm', title, disabled: dis, onclick: () => app.layerAction(act, null, 'panel') }, U.svgIcon(icon, 16));
      b.append(el('div', { class: 'layer-btns' },
        btn('M12 5v14 M5 12h14', 'New layer', 'add'),
        btn('M8 8h12v12H8z M4 16V4h12', 'Duplicate layer', 'duplicate'),
        btn('M12 19V5 M6 11l6-6 6 6', 'Move layer up', 'up', d.activeIndex >= d.layers.length - 1),
        btn('M12 5v14 M6 13l6 6 6-6', 'Move layer down', 'down', d.activeIndex <= 0),
        btn('M7 4v9l5 5 5-5V4 M5 20h14', 'Merge down', 'merge', d.activeIndex <= 0),
        btn('M5 7h14 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3', 'Delete layer', 'delete', d.layers.length <= 1)));
    }
    refreshThumbs() {
      const d = this.app.doc;
      const thumbs = this.layersBody.querySelectorAll('canvas.thumb');
      thumbs.forEach((c, k) => {
        const L = d.layers[d.layers.length - 1 - k];
        if (!L) return;
        const t = c.getContext('2d');
        t.fillStyle = '#ddd'; t.fillRect(0, 0, 40, 28);
        t.drawImage(L.canvas, 0, 0, 40, 28);
      });
    }

    refreshHistory() {
      const h = this.app.doc.history, b = this.historyBody;
      b.innerHTML = '';
      const list = el('div', { class: 'hist' });
      list.append(el('div', { class: 'hrow base' }, 'Open'));
      h.undoStack.forEach((c, i) => list.append(el('div', { class: 'hrow' + (i === h.undoStack.length - 1 ? ' cur' : '') }, c.label)));
      h.redoStack.slice().reverse().forEach((c) => list.append(el('div', { class: 'hrow undone' }, c.label)));
      b.append(list);
      b.append(el('div', { class: 'row' },
        el('button', { class: 'ob-btn', disabled: !h.canUndo(), onclick: () => this.app.undo('history_panel') }, 'Undo'),
        el('button', { class: 'ob-btn', disabled: !h.canRedo(), onclick: () => this.app.redo('history_panel') }, 'Redo')));
      list.scrollTop = list.scrollHeight;
    }

    togglePanels() {
      const p = $('#panels');
      p.classList.toggle('hidden');
      this.app.logEvent('panels_toggle', { visible: !p.classList.contains('hidden') });
    }

    /* ======================= colour picker popover ======================= */
    openColorPicker({ which = 'fg', trigger = 'tool', fromTool = false } = {}) {
      if (this.popover) {
        this.popover.which = which;
        this.popover.fromTool = this.popover.fromTool || fromTool;
        this.syncPicker();
        return;
      }
      const pop = $('#popover');
      pop.innerHTML = '';
      const sv = el('canvas', { class: 'sv', width: 220, height: 150 });
      const hue = el('canvas', { class: 'hue', width: 220, height: 14 });
      const hex = el('input', { class: 'hex', type: 'text', spellcheck: false });
      const tabs = el('div', { class: 'seg' },
        el('button', { dataset: { w: 'fg' }, onclick: () => { this.popover.which = 'fg'; this.syncPicker(); } }, 'Foreground'),
        el('button', { dataset: { w: 'bg' }, onclick: () => { this.popover.which = 'bg'; this.syncPicker(); } }, 'Background'));
      const recent = el('div', { class: 'palette recent' });
      const done = el('button', { class: 'ob-btn primary', onclick: () => this.closeColorPicker() }, 'Done');
      pop.append(tabs, sv, hue, el('div', { class: 'row' }, el('span', { class: 'prev' }), hex, done), el('div', { class: 'sub-lbl' }, 'Recent'), recent);
      this.popover = { which, fromTool, sv, hue, hex, recent, hsv: null, t: this.trackOpen('colorpicker', fromTool ? 'tool' : trigger) };
      this.logOpen(this.popover.t);

      const setFromHSV = () => {
        const { h, s, v } = this.popover.hsv;
        const { r, g, b } = U.hsvToRgb(h, s, v);
        this.app.setColor(this.popover.which, U.rgbToHex(r, g, b), 'picker', { keepHSV: true });
      };
      const drag = (canvas, fn) => {
        canvas.addEventListener('pointerdown', (e) => {
          canvas.setPointerCapture(e.pointerId);
          fn(e);
          const mv = (ev) => fn(ev);
          const up = () => { canvas.removeEventListener('pointermove', mv); canvas.removeEventListener('pointerup', up); this.pushRecent(this.app.colors[this.popover.which]); this.syncPicker(); };
          canvas.addEventListener('pointermove', mv);
          canvas.addEventListener('pointerup', up);
        });
      };
      drag(sv, (e) => {
        const r = sv.getBoundingClientRect();
        this.popover.hsv.s = U.clamp((e.clientX - r.left) / r.width, 0, 1);
        this.popover.hsv.v = 1 - U.clamp((e.clientY - r.top) / r.height, 0, 1);
        setFromHSV();
        this.drawPicker();
      });
      drag(hue, (e) => {
        const r = hue.getBoundingClientRect();
        this.popover.hsv.h = U.clamp((e.clientX - r.left) / r.width, 0, 0.9999) * 360;
        setFromHSV();
        this.drawPicker();
      });
      hex.addEventListener('change', () => {
        if (U.isHex(hex.value)) { const c = U.normHex(hex.value); this.app.setColor(this.popover.which, c, 'hex_picker'); this.pushRecent(c); }
        this.syncPicker();
      });
      hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') hex.blur(); });

      const anchor = this.fgBtn.getBoundingClientRect();
      pop.style.left = anchor.right + 10 + 'px';
      pop.style.top = Math.max(8, anchor.top - 120) + 'px';
      pop.classList.remove('hidden');
      const pr = pop.getBoundingClientRect();
      if (pr.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, window.innerHeight - pr.height - 8) + 'px';
      this.syncPicker();
    }

    syncPicker() {
      const P = this.popover;
      if (!P) return;
      const c = this.app.colors[P.which];
      const rgb = U.hexToRgb(c);
      const hsv = U.rgbToHsv(rgb.r, rgb.g, rgb.b);
      if (!P.hsv || !P.keep) {
        // keep hue when the colour is grey so the slider doesn't jump to red
        if (P.hsv && (hsv.s === 0 || hsv.v === 0)) hsv.h = P.hsv.h;
        P.hsv = hsv;
      }
      P.keep = false;
      if (document.activeElement !== P.hex) P.hex.value = c;
      $('#popover .prev').style.background = c;
      $('#popover .seg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.w === P.which));
      P.recent.innerHTML = '';
      for (const rc of this.recent) P.recent.append(el('button', { class: 'pal', style: { background: rc }, onclick: () => { this.app.setColor(P.which, rc, 'recent_picker'); } }));
      this.drawPicker();
    }

    drawPicker() {
      const P = this.popover;
      if (!P) return;
      const { sv, hue, hsv } = P;
      const c = sv.getContext('2d'), W = sv.width, H = sv.height;
      const base = U.hsvToRgb(hsv.h, 1, 1);
      c.fillStyle = U.rgbToHex(base.r, base.g, base.b);
      c.fillRect(0, 0, W, H);
      let g = c.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.beginPath();
      c.arc(hsv.s * W, (1 - hsv.v) * H, 6, 0, Math.PI * 2);
      c.lineWidth = 2; c.strokeStyle = hsv.v > 0.5 ? '#000' : '#fff'; c.stroke();
      const hc = hue.getContext('2d');
      const hg = hc.createLinearGradient(0, 0, hue.width, 0);
      for (let i = 0; i <= 6; i++) { const q = U.hsvToRgb(i * 60 % 360, 1, 1); hg.addColorStop(i / 6, U.rgbToHex(q.r, q.g, q.b)); }
      hc.fillStyle = hg; hc.fillRect(0, 0, hue.width, hue.height);
      const hx = (hsv.h / 360) * hue.width;
      hc.fillStyle = '#fff'; hc.fillRect(hx - 2, 0, 4, hue.height);
      hc.strokeStyle = '#000'; hc.strokeRect(hx - 2.5, 0.5, 5, hue.height - 1);
    }

    closeColorPicker() {
      const P = this.popover;
      if (!P) return;
      this.popover = null;
      $('#popover').classList.add('hidden');
      this.pushRecent(this.app.colors[P.which]);
      this.refreshColor();
      this.logClose(P.t, this.app.colors[P.which]);
      if (P.fromTool && this.app.toolId === 'colorpicker') {
        const back = this.app.prevToolId && this.app.prevToolId !== 'colorpicker' ? this.app.prevToolId : 'brush';
        this.app.selectTool(back, 'auto_return');
      }
    }

    /* ======================= status bar ======================= */
    buildStatusbar() {
      const sb = $('#statusbar');
      sb.innerHTML = '';
      this.sb = {};
      for (const k of ['pos', 'zoom', 'doc', 'layer', 'sel', 'pen', 'spacer', 'mode', 'log']) {
        const s = el('span', { class: 'sb-' + k });
        sb.append(s);
        this.sb[k] = s;
      }
      this.refreshStatus();
    }
    refreshStatus() {
      const a = this.app, d = a.doc, sb = this.sb;
      const c = a.cursorDoc;
      sb.pos.textContent = c ? `${Math.round(c.x)}, ${Math.round(c.y)}` : '—';
      sb.zoom.textContent = Math.round(a.view.scale * 100) + '%';
      sb.doc.textContent = `${d.w}×${d.h}`;
      sb.layer.textContent = `${d.active.name} · ${d.layers.length} layer${d.layers.length > 1 ? 's' : ''}`;
      sb.sel.textContent = d.selection ? `Sel ${Math.round(d.selection.bbox.x1 - d.selection.bbox.x0)}×${Math.round(d.selection.bbox.y1 - d.selection.bbox.y0)}` : '';
      sb.pen.textContent = a.lastPointer ? `${a.lastPointer.type}${a.lastPointer.type === 'pen' ? ' · p ' + a.lastPointer.pressure.toFixed(2) : ''}` : '';
      const modeLbl = { static: 'Static', 'adaptive-generic': 'Adaptive · generic', 'adaptive-personalized': 'Adaptive · personalized' }[a.engine.mode];
      sb.mode.textContent = modeLbl + (a.engine.mode !== 'static' ? ` · ${a.engine.predictorId} · k=${a.suggest.cfg.k}` : '');
      const L = a.logger;
      sb.log.textContent = L.active ? `● ${L.events.length} events${L.lastSaved ? ' · saved' : ''}` : 'not logging';
      sb.log.classList.toggle('on', L.active);
    }

    /* ======================= modal & toast ======================= */
    modal({ title, body, actions = [], dismissible = true, wide = false, onClose }) {
      const root = $('#modal-root');
      const box = el('div', { class: 'modal' + (wide ? ' wide' : '') });
      const back = el('div', { class: 'modal-back' }, box);
      const close = (why) => { back.remove(); if (onClose) onClose(why); };
      box.append(el('h2', {}, title));
      const content = el('div', { class: 'modal-body' });
      if (typeof body === 'function') body(content, close); else if (body) content.append(body);
      box.append(content);
      if (actions.length) {
        const row = el('div', { class: 'modal-actions' });
        for (const a of actions) {
          row.append(el('button', { class: 'ob-btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), onclick: () => { if (a.act && a.act(close) === false) return; close(a.label); } }, a.label));
        }
        box.append(row);
      }
      if (dismissible) {
        back.addEventListener('pointerdown', (e) => { if (e.target === back) close('backdrop'); });
        box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close('escape'); });
      }
      root.append(back);
      setTimeout(() => { const f = box.querySelector('input,select,textarea,button.primary'); if (f) f.focus(); }, 30);
      return close;
    }
    get modalOpen() { return !!$('#modal-root').children.length; }

    toast(msg, ms = 2200) {
      const t = $('#toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => t.classList.remove('show'), ms);
    }

    showShortcuts() {
      const rows = MP.TOOL_IDS.map((t) => [MP.TOOLS[t].key.toUpperCase(), MP.TOOLS[t].name]).concat([
        ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['X / D', 'Swap / default colors'], ['[ / ]', 'Brush size'],
        ['Space+drag, middle-drag', 'Pan'], ['Wheel, Ctrl+wheel, pinch', 'Zoom'], ['+ / − / 0 / 1', 'Zoom in / out / fit / 100%'],
        ['Alt+click (draw tools)', 'Pick color'], ['Ctrl+A / Ctrl+D', 'Select all / deselect'], ['Del', 'Clear selection or layer'],
        ['Right-click / pen barrel', 'Radial suggestions (adaptive, radial style)'], ['Tab', 'Toggle panels'],
      ]);
      this.modal({
        title: 'Keyboard shortcuts', wide: true,
        body: el('div', { class: 'shortcuts' }, rows.map(([k, l]) => el('div', { class: 'sc' }, el('kbd', {}, k), el('span', {}, l)))),
        actions: [{ label: 'Close', primary: true }],
      });
    }
    showAbout() {
      this.modal({
        title: 'Minimalist Paint',
        body: el('div', {}, el('p', {}, 'A deliberately cluttered paint tool for studying tool-selection behaviour and adaptive toolbars.'),
          el('p', { class: 'muted' }, 'All data stays in this browser until you export it.')),
        actions: [{ label: 'Close', primary: true }],
      });
    }
  }

  MP.UI = UI;
})(window.MP);
