/* Adaptive "Suggested" zone. Takes the engine's ranked list and shows top-k tools near the pen, either as a
   floating bar or a radial menu. Stability rules, so spatial memory survives:
   - the displayed set changes at most once per dwell period (never mid-stroke);
   - the `pinCount` most stable tools are pinned to the first slots and re-evaluated rarely;
   - a tool that is still in the top-k keeps its slot; an incumbent is only replaced when a newcomer beats
     its probability by more than `hysteresis`. */
(function (MP) {
  'use strict';
  const U = MP.U;

  class Suggestions {
    constructor(app) {
      this.app = app;
      this.el = document.getElementById('suggest');
      this.radialEl = document.getElementById('radial');
      this.cfg = {
        k: 3, dwellMs: 4000, pinCount: 2, pinDwellMs: 60000, hysteresis: 0.05,
        placement: 'pen', style: 'bar', moveThreshold: 280,
      };
      this.reset();
      this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
      document.addEventListener('pointerdown', (e) => {
        if (this.radialOpen && !this.radialEl.contains(e.target)) this.closeRadial(null);
      }, true);
    }

    reset() {
      this.pinned = [];
      this.dyn = [];
      this.score = {};
      this.updates = 0;
      this.lastUpdate = -Infinity;
      this.lastPinUpdate = -Infinity;
      this.lastRank = null;
      this.pos = null;
      this.lastMove = 0;
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
      this.pendingReason = null;
      this.render();
    }

    get adaptive() { return this.app.engine.mode !== 'static'; }
    /* Logging phase: a fixed, non-predictive quick-tools bar (MP.CONFIG.staticBar), if configured. */
    get staticTools() { return MP.LOGGING_ONLY ? ((MP.CONFIG && MP.CONFIG.staticBar) || []).filter((t) => MP.TOOLS[t]) : []; }
    get visible() { return this.adaptive || this.staticTools.length > 0; }
    get displayed() { return this.pinned.concat(this.dyn).filter(Boolean).slice(0, MP.LOGGING_ONLY ? this.staticTools.length : this.cfg.k); }

    /* Recompute the ranking; apply it to the display if the dwell time allows. */
    refresh(reason, { force = false } = {}) {
      if (MP.LOGGING_ONLY) { this.pinned = []; this.dyn = this.staticTools; this.render(); return; }
      const app = this.app;
      const ctx = app.contextSnapshot();
      const rank = app.engine.rank(ctx);
      this.lastRank = rank;
      const topK = rank.list.slice(0, this.cfg.k).map((x) => x.tool);
      for (const t of MP.TOOL_IDS) {
        const inTop = topK.includes(t) || t === ctx.tool;
        this.score[t] = 0.8 * (this.score[t] || 0) + 0.2 * (inTop ? 1 : 0);
      }
      this.updates++;
      if (!this.adaptive) { this.render(); return; }
      const now = performance.now();
      const wait = this.lastUpdate + this.cfg.dwellMs - now;
      if (!force && (wait > 0 || app.stroking)) {
        this.pendingReason = reason;
        clearTimeout(this.pendingTimer);
        this.pendingTimer = setTimeout(() => this.firePending(), Math.max(50, wait));
        return;
      }
      this.apply(rank, reason);
    }

    firePending() {
      this.pendingTimer = null;
      if (!this.pendingReason) return;
      if (this.app.stroking) return; // retried at stroke end
      const r = this.pendingReason;
      this.pendingReason = null;
      this.refresh(r + '+deferred', { force: true });
    }
    onStrokeEnd() {
      if (this.pendingReason && !this.pendingTimer) this.firePending();
    }

    apply(rank, reason) {
      const cfg = this.cfg, cur = this.app.toolId, now = performance.now();
      const p = Object.fromEntries(rank.list.map((x) => [x.tool, x.p]));
      const before = this.displayed.join(',');
      const pinCount = Math.min(cfg.pinCount, cfg.k - 1);

      // 1. pins: most stable tools, re-evaluated rarely
      if (pinCount > 0 && (now - this.lastPinUpdate >= cfg.pinDwellMs || (this.pinned.length < pinCount && this.updates >= 3))) {
        const cands = MP.TOOL_IDS.filter((t) => this.score[t] > 0.3).sort((a, b) => this.score[b] - this.score[a]).slice(0, pinCount);
        // keep existing pins in their slot when they survive
        const next = this.pinned.filter((t) => cands.includes(t));
        for (const t of cands) if (!next.includes(t)) next.push(t);
        if (next.join() !== this.pinned.join()) this.app.logEvent('suggestion_pins', { pinned: next, scores: next.map((t) => U.round(this.score[t], 3)) });
        this.pinned = next;
        this.lastPinUpdate = now;
      }

      // 2. dynamic slots with slot preservation + hysteresis
      const nDyn = cfg.k - this.pinned.length;
      const desired = rank.list.map((x) => x.tool).filter((t) => !this.pinned.includes(t)).slice(0, nDyn);
      const prev = this.dyn.slice(0, nDyn);
      const next = new Array(nDyn).fill(null);
      prev.forEach((t, i) => { if (t && desired.includes(t)) next[i] = t; });
      const newcomers = desired.filter((t) => !next.includes(t));
      for (let i = 0; i < nDyn; i++) {
        if (next[i]) continue;
        const inc = prev[i];
        const nc = newcomers[0];
        const incValid = inc && inc !== cur && !this.pinned.includes(inc) && !next.includes(inc);
        if (incValid && (!nc || (p[inc] || 0) + cfg.hysteresis >= (p[nc] || 0))) next[i] = inc;
        else if (nc) next[i] = newcomers.shift();
      }
      this.dyn = next;
      this.lastUpdate = now;
      const after = this.displayed.join(',');
      this.app.logEvent('suggestion_update', {
        reason, shown: this.displayed, pinned: this.pinned.slice(), changed: before !== after,
        ranking: rank.list.slice(0, 8).map((x) => [x.tool, U.round(x.p, 4)]), predictor: rank.predictor, fallback: rank.fallback,
      });
      this.render();
    }

    /* ---------- placement ---------- */
    followPen(sx, sy) {
      if (!this.adaptive || this.cfg.style !== 'bar' || this.cfg.placement !== 'pen') return;
      const stage = this.el.parentElement.getBoundingClientRect();
      const w = this.el.offsetWidth || 160, h = this.el.offsetHeight || 48;
      if (this.pos) {
        const cx = this.pos.x + w / 2, cy = this.pos.y + h / 2;
        if (Math.hypot(cx - sx, cy - sy) < this.cfg.moveThreshold) return;
        if (performance.now() - this.lastMove < this.cfg.dwellMs) return;
      }
      let x = sx + 36, y = sy - h - 36;
      if (x + w > stage.width - 8) x = sx - w - 36;
      if (y < 8) y = sy + 36;
      x = U.clamp(x, 8, Math.max(8, stage.width - w - 8));
      y = U.clamp(y, 8, Math.max(8, stage.height - h - 8));
      this.pos = { x, y };
      this.lastMove = performance.now();
      this.place();
      this.app.logEvent('suggestion_move', { x: Math.round(x), y: Math.round(y), placement: 'pen' });
    }
    place() {
      if (!this.pos) {
        const stage = this.el.parentElement.getBoundingClientRect();
        this.pos = { x: Math.max(8, stage.width / 2 - (this.el.offsetWidth || 160) / 2), y: 12 };
      }
      this.el.style.transform = `translate(${Math.round(this.pos.x)}px, ${Math.round(this.pos.y)}px)`;
    }

    /* ---------- rendering ---------- */
    render() {
      const show = MP.LOGGING_ONLY ? this.staticTools.length > 0 : this.adaptive && this.cfg.style === 'bar';
      this.el.classList.toggle('hidden', !show);
      if (!show) return;
      this.el.innerHTML = '';
      const grip = U.el('div', { class: 'grip', title: 'Drag to move' });
      this.bindDrag(grip);
      this.el.append(grip);
      const k = MP.LOGGING_ONLY ? this.staticTools.length : this.cfg.k;
      const slots = this.pinned.concat(this.dyn).slice(0, k);
      while (slots.length < k) slots.push(null);
      slots.forEach((t, i) => {
        const pinned = i < this.pinned.length;
        if (!t) { this.el.append(U.el('div', { class: 'sg-slot empty' })); return; }
        const meta = MP.TOOLS[t];
        const b = U.el('button', {
          class: 'sg-slot' + (t === this.app.toolId ? ' active' : '') + (pinned ? ' pinned' : ''),
          title: `${meta.name} (${meta.key.toUpperCase()})${pinned ? ' — pinned' : ''}`,
          dataset: { tool: t },
          onclick: (e) => this.choose(t, i, pinned, e, 'suggestion'),
        }, U.svgIcon(meta.icon, 22));
        this.el.append(b);
      });
      this.place();
    }
    markActive() {
      this.el.querySelectorAll('.sg-slot[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === this.app.toolId));
    }

    choose(tool, slot, pinned, e, method) {
      if (tool === this.app.toolId) { this.app.logEvent('suggestion_click_active', { tool, slot }); return; }
      this.app.selectTool(tool, method, { suggestionSlot: slot, suggestionPinned: pinned, clientX: e && e.clientX, clientY: e && e.clientY });
    }

    bindDrag(grip) {
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        const start = { x: e.clientX, y: e.clientY, px: this.pos.x, py: this.pos.y };
        const mv = (ev) => {
          const stage = this.el.parentElement.getBoundingClientRect();
          this.pos = {
            x: U.clamp(start.px + ev.clientX - start.x, 0, stage.width - this.el.offsetWidth),
            y: U.clamp(start.py + ev.clientY - start.y, 0, stage.height - this.el.offsetHeight),
          };
          this.place();
        };
        const up = () => {
          grip.removeEventListener('pointermove', mv);
          grip.removeEventListener('pointerup', up);
          this.cfg.placement = 'fixed';
          this.app.logEvent('suggestion_move', { x: Math.round(this.pos.x), y: Math.round(this.pos.y), placement: 'manual' });
        };
        grip.addEventListener('pointermove', mv);
        grip.addEventListener('pointerup', up);
      });
    }

    /* ---------- radial (marking) menu ---------- */
    openRadial(sx, sy, trigger) {
      if (!this.adaptive) return false;
      const items = this.pinned.concat(this.dyn).slice(0, this.cfg.k).filter(Boolean);
      if (!items.length) return false;
      const el = this.radialEl;
      el.innerHTML = '';
      const R = items.length > 3 ? 64 : 56;
      el.style.left = sx + 'px';
      el.style.top = sy + 'px';
      el.append(U.el('div', { class: 'rd-center' }));
      items.forEach((t, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / items.length;
        const meta = MP.TOOLS[t];
        const b = U.el('button', {
          class: 'rd-item' + (t === this.app.toolId ? ' active' : '') + (i < this.pinned.length ? ' pinned' : ''),
          title: meta.name, dataset: { tool: t, slot: i },
          style: { left: Math.cos(a) * R + 'px', top: Math.sin(a) * R + 'px' },
          onclick: (e) => this.closeRadial({ tool: t, slot: i, e }),
        }, U.svgIcon(meta.icon, 20));
        el.append(b);
      });
      el.classList.remove('hidden');
      this.radialOpen = { at: performance.now(), trigger, sx, sy };
      this.app.logEvent('menu_open', { menu: 'radial', trigger, items });
      return true;
    }
    /* For press-drag-release selection: called with stage coordinates on pointer up. */
    releaseRadial(sx, sy, e) {
      if (!this.radialOpen) return;
      const o = this.radialOpen;
      if (Math.hypot(sx - o.sx, sy - o.sy) < 20) return; // released in the middle: stay open for a click
      const btn = document.elementFromPoint(e.clientX, e.clientY);
      const item = btn && btn.closest && btn.closest('.rd-item');
      this.closeRadial(item ? { tool: item.dataset.tool, slot: +item.dataset.slot, e, drag: true } : null);
    }
    closeRadial(choice) {
      if (!this.radialOpen) return;
      const o = this.radialOpen;
      this.radialOpen = null;
      this.radialEl.classList.add('hidden');
      this.app.logEvent('menu_close', { menu: 'radial', durationMs: Math.round(performance.now() - o.at), selected: choice ? choice.tool : null });
      if (choice) this.choose(choice.tool, choice.slot, choice.slot < this.pinned.length, choice.e, choice.drag ? 'radial_drag' : 'radial');
    }
  }

  MP.Suggestions = Suggestions;
})(window.MP);
