/* Account mode for the study: participants log in, all 12 Phase 1 tasks are available from a row of
   progress blocks in the menu bar, and each task's canvas + active time is saved (server or browser).

   Timing: a task's time only runs between Start/Resume and Done/leaving it (pauses excluded).
   progress.tasks[id] = {status: 'new'|'started'|'done', activeMs, visits, attempts, startedAt, doneAt}. */
(function (MP) {
  'use strict';
  const U = MP.U;
  const el = U.el;
  const P = MP.Study.prototype;
  const AUTOSAVE_MS = 30000;
  const orig = { startTask: P.startTask, finishTask: P.finishTask, restartTask: P.restartTask, tick: P.tick, renderSessionInfo: P.renderSessionInfo, taskButtons: P.taskButtons, toggleTask: P.toggleTask };
  const SKILLS = [['novice', 'Novice — rarely draw'], ['casual', 'Casual — draw for fun sometimes'], ['intermediate', 'Intermediate — draw regularly'], ['advanced', 'Advanced — professional or very experienced']];
  const DEVICES = [['pen-tablet', 'Pen tablet (no screen)'], ['pen-display', 'Pen display / tablet with screen'], ['mouse', 'Mouse or trackpad'], ['touch', 'Touch (finger)']];

  Object.assign(P, {
    /* First thing on page load: resume a stored login, otherwise show the sign-in screen. */
    async boot() {
      if (MP.CONFIG && MP.CONFIG.accounts === false) { this.showSetup(true); return; }
      if (!this._autosave) {
        this._autosave = setInterval(() => this.autosave(), AUTOSAVE_MS);
        window.addEventListener('pagehide', () => { if (this.accountMode) { this.fold(); this.app.account.beaconProgress(); } });
      }
      if (await this.app.account.resume()) { await this.enterAccount('resume'); return; }
      this.showLogin();
    },

    showLogin() {
      const acc = this.app.account;
      let mode = 'login';
      this.ui.modal({
        title: 'Sign in', dismissible: false,
        body: (box) => {
          const tabs = el('div', { class: 'seg login-tabs' });
          const form = el('div', { class: 'form' });
          const msg = el('div', { class: 'login-msg' });
          const f = {
            pid: el('input', { type: 'text', placeholder: 'e.g. P07', autocomplete: 'username', spellcheck: false }),
            pin: el('input', { type: 'password', placeholder: 'At least 4 characters', autocomplete: 'current-password' }),
            pin2: el('input', { type: 'password', placeholder: 'Type it again', autocomplete: 'new-password' }),
          };
          const sel = (key, opts) => (f[key] = el('select', {}, el('option', { value: '' }, 'Select…'), opts.map(([v, l]) => el('option', { value: v }, l))));
          f.age = el('input', { type: 'number', min: 10, max: 99, placeholder: 'optional' });
          const row = (label, input) => el('label', { class: 'frow' }, el('span', { class: 'flbl' }, label), input);
          const submit = el('button', { class: 'ob-btn primary login-go' });
          const draw = () => {
            tabs.innerHTML = '';
            for (const [m, label] of [['login', 'Log in'], ['register', 'New participant']]) {
              tabs.append(el('button', { class: mode === m ? 'on' : '', onclick: () => { mode = m; msg.textContent = ''; draw(); } }, label));
            }
            form.innerHTML = '';
            form.append(row('Participant code', f.pid), row('PIN', f.pin));
            if (mode === 'register') {
              f.pin.autocomplete = 'new-password';
              form.append(row('Confirm PIN', f.pin2),
                row('Drawing skill', sel('skill', SKILLS)), row('Device', sel('device', DEVICES)),
                row('Draws digitally', sel('frequency', [['rarely', 'Rarely'], ['monthly', 'About monthly'], ['weekly', 'Weekly'], ['daily', 'Daily']])),
                row('Drawing hand', sel('handedness', [['right', 'Right'], ['left', 'Left']])), row('Age', f.age));
            }
            submit.textContent = mode === 'login' ? 'Log in' : 'Create account';
            setTimeout(() => f.pid.focus(), 20);
          };
          const go = async () => {
            msg.textContent = '';
            const pid = f.pid.value.trim(), pin = f.pin.value;
            if (!pid || !pin) { msg.textContent = 'Enter your participant code and PIN.'; return; }
            if (mode === 'register') {
              if (pin !== f.pin2.value) { msg.textContent = 'The two PINs do not match.'; return; }
              if (!f.skill.value || !f.device.value) { msg.textContent = 'Please choose your drawing skill and device.'; return; }
            }
            submit.disabled = true;
            submit.textContent = '…';
            try {
              if (mode === 'login') await acc.login(pid, pin);
              else await acc.register(pid, pin, { skill: f.skill.value, device: f.device.value, frequency: f.frequency.value || null, handedness: f.handedness.value || null, age: f.age.value ? +f.age.value : null });
              box.closest('.modal-back').remove();
              await this.enterAccount(mode);
            } catch (e) {
              msg.textContent = e.message;
              submit.disabled = false;
              draw();
            }
          };
          submit.addEventListener('click', go);
          box.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
          draw();
          box.append(
            el('p', { class: 'muted' }, 'Your drawings and progress are saved, so you can stop and continue later, on this or another computer.'),
            tabs, form, msg, el('div', { class: 'row login-row' }, submit),
            acc.mode === 'local' ? el('p', { class: 'muted small' }, 'No server configured: accounts are saved in this browser only.') : null,
            el('button', { class: 'linkish', onclick: () => { box.closest('.modal-back').remove(); this.showSetup(true); } }, 'Researcher: run a local session without login'));
        },
      });
    },

    async enterAccount(how) {
      const app = this.app, acc = app.account;
      this.accountMode = true;
      this.tasks = MP.TASK_SETS.p1all.tasks;
      this.docs = new Map();
      this.task = null;
      this.applySettings({}, { silent: true });
      const sessionId = `${acc.pid}-${U.dateStamp()}-${U.uid(4)}`;
      app.engine.setParticipant(acc.pid);
      app.engine.sessionId = sessionId;
      app.engine.resetSession();
      app.logger.start({
        sessionId, participantId: acc.pid, participant: acc.profile, account: acc.mode, practice: false,
        phase: MP.LOGGING_ONLY ? 'logging' : 'adaptive',
        condition: MP.LOGGING_ONLY ? 'logging' : this.settings.condition, predictor: MP.LOGGING_ONLY ? null : this.settings.predictor,
        settings: this.snapshotSettings(), taskSet: 'p1all', canvas: { w: app.doc.w, h: app.doc.h }, upload: app.uploader.enabled,
      });
      app.resetSessionState();
      const done = this.tasks.filter((t) => this.taskState(t.id).status === 'done').length;
      app.logEvent('login', { how, mode: acc.mode, tasksDone: done });
      app.suggest.reset();
      app.suggest.refresh('session_start', { force: true });
      this.renderSessionInfo();
      let i = this.tasks.findIndex((t) => t.id === acc.progress.current);
      if (i < 0) i = Math.max(0, this.tasks.findIndex((t) => this.taskState(t.id).status !== 'done'));
      this.taskIndex = -1;
      await this.selectTask(i, how);
      this.ui.toast(how === 'register' ? `Welcome, ${acc.pid}!` : `Welcome back, ${acc.pid} — ${done}/12 tasks done`, 3000);
    },

    taskState(id) {
      const p = this.app.account.progress;
      if (!p.tasks[id]) p.tasks[id] = { status: 'new', activeMs: 0, visits: 0, attempts: 0 };
      return p.tasks[id];
    },

    lockCanvas() {
      const t = this.tasks[this.taskIndex];
      const st = t ? this.taskState(t.id).status : 'new';
      this.app.canvasLocked = st === 'done' ? 'This task is done. Press Reopen in the task panel to change it.'
        : st === 'started' ? 'Press Resume in the task panel to keep working on this task.'
        : 'Press Start in the task panel to begin this task.';
    },

    /* Show another task: stop the clock on the current one, save it, and load the other's canvas. */
    async selectTask(i, method = 'taskbar') {
      const t = this.tasks[i];
      if (!t || this.switching || i === this.taskIndex) return;
      this.switching = true;
      try {
        const from = this.tasks[this.taskIndex];
        let d = this.docs.get(t.id);
        if (!d) {
          let state = null;
          if (this.taskState(t.id).status !== 'new') {
            try { state = await this.app.account.load(t.id); } catch (e) {
              this.ui.toast('Could not load your saved drawing (' + e.message + '). Check the connection and try again.', 4500);
              return;
            }
          }
          d = state ? await this.app.deserializeDoc(state) : await this.app.buildTaskDoc(t);
          d.dirty = false;
          this.docs.set(t.id, d);
        }
        if (this.task) await this.leaveTask('switch');
        this.app.logEvent('task_select', { from: from ? from.id : null, to: t.id, method, status: this.taskState(t.id).status });
        this.app.showDoc(d);
        this.taskIndex = i;
        this.app.account.progress.current = t.id;
        this.lockCanvas();
        this.renderTaskPanel();
        this.renderTaskbar();
        this.app.account.save().catch(() => {});
      } finally {
        this.switching = false;
      }
    },

    /* Start / Resume / Reopen the shown task. */
    beginTask() {
      const t = this.tasks[this.taskIndex];
      if (!t || this.task) return;
      const st = this.taskState(t.id), now = performance.now(), app = this.app;
      if (st.status === 'new') {
        st.status = 'started';
        st.attempts = 1;
        st.startedAt = new Date().toISOString();
        app.logEvent('task_start', { taskId: t.id, index: this.taskIndex, title: t.title, taskType: t.type || null, attempt: 1 });
      } else if (st.status === 'done') {
        st.status = 'started';
        app.logEvent('task_reopen', { taskId: t.id, activeMs: Math.round(st.activeMs) });
      } else {
        app.logEvent('task_return', { taskId: t.id, activeMs: Math.round(st.activeMs), visits: st.visits });
      }
      st.visits++;
      this.task = { def: t, index: this.taskIndex, start: now, firstStart: now, baseMs: st.activeMs, visitBase: st.activeMs, attempt: st.attempts || 1, startEvent: app.logger.events.length, pausedMs: 0, pauses: 0, pausedAt: null };
      app.taskId = t.id;
      app.canvasLocked = null;
      this.renderTaskPanel();
      this.renderTaskbar();
      app.account.save().catch(() => {});
      if (st.visits === 1 && t.type === 'trace') this.ui.toast('Faded drawing loaded: trace it on the "Ink" layer', 3500);
      else if (st.visits === 1 && t.type === 'edit') this.ui.toast('Rough sketch loaded: fix it to match the target', 3500);
    },

    /* Move the running segment's time into the saved total. */
    fold() {
      const T = this.task;
      if (!T || T.pausedAt != null) return 0;
      const now = performance.now();
      const seg = Math.max(0, now - T.start - T.pausedMs);
      const st = this.taskState(T.def.id);
      st.activeMs += seg;
      T.baseMs = st.activeMs;
      T.start = now;
      T.pausedMs = 0;
      return seg;
    },

    async leaveTask(reason) {
      const T = this.task;
      if (!T) return;
      if (T.pausedAt != null) { T.pausedMs += performance.now() - T.pausedAt; T.pausedAt = null; }
      this.app.commitPending();
      this.fold();
      const st = this.taskState(T.def.id);
      // whole visit, even if autosave already folded part of it into activeMs
      this.app.logEvent('task_leave', { taskId: T.def.id, reason, segmentMs: Math.round(st.activeMs - T.visitBase), activeMs: Math.round(st.activeMs) });
      this.task = null;
      this.app.taskId = null;
      await this.saveCurrent(true);
      this.lockCanvas();
    },

    /* Save the shown task (canvas only if it changed) plus progress. */
    async saveCurrent(withCanvas) {
      const t = this.tasks[this.taskIndex];
      if (!t || !this.app.account.loggedIn) return;
      const d = this.app.doc;
      const state = withCanvas && d.dirty ? this.app.serializeDoc(d) : undefined;
      try {
        await this.app.account.save(t.id, state);
        if (state) d.dirty = false;
        if (this.saveError) this.ui.toast('Saved again ✓');
        this.saveError = null;
      } catch (e) {
        this.saveError = e.message;
        this.ui.toast('Could not save (' + e.message + '). Will retry automatically.', 4000);
      }
      this.renderTaskbar();
    },

    autosave() {
      if (!this.accountMode || !this.app.account.loggedIn || this.app.stroking) return;
      if (this.task) this.fold();
      if (this.task || this.saveError) this.saveCurrent(true);
    },

    async accountFinish() {
      const T = this.task;
      if (!T) return;
      const app = this.app, t = T.def, st = this.taskState(t.id);
      app.commitPending();
      if (T.pausedAt != null) { T.pausedMs += performance.now() - T.pausedAt; T.pausedAt = null; }
      this.fold();
      st.status = 'done';
      st.doneAt = new Date().toISOString();
      app.logEvent('task_end', { taskId: t.id, index: this.taskIndex, durationMs: Math.round(st.activeMs), visits: st.visits, attempts: st.attempts, ...this.taskStatsFor(t.id) });
      try {
        const flat = app.doc.flatten();
        const s = Math.min(1, 800 / Math.max(flat.width, flat.height));
        const c = U.makeCanvas(flat.width * s, flat.height * s);
        c.getContext('2d').drawImage(flat, 0, 0, c.width, c.height);
        app.logger.addArtifact({ kind: 'canvas', taskId: t.id, t: Math.round(app.logger.elapsed()), png: c.toDataURL('image/png') });
      } catch (e) { /* ignore */ }
      this.task = null;
      app.taskId = null;
      this.lockCanvas();
      app.doc.dirty = true;
      await this.saveCurrent(true);
      this.renderTaskPanel();
      const next = () => {
        const n = this.tasks.length;
        for (let k = 1; k <= n; k++) {
          const j = (this.taskIndex + k) % n;
          if (this.taskState(this.tasks[j].id).status !== 'done') { this.selectTask(j, 'auto_next'); return; }
        }
        this.allDone();
      };
      if (this.settings.tlxEachTask) this.showTLX(next, t.id); else next();
    },

    taskStatsFor(id) {
      const ev = this.app.logger.events.filter((e) => e.taskId === id);
      const count = (pred) => ev.filter(pred).length;
      return {
        strokes: count((e) => e.type === 'stroke_end'), toolSwitches: count((e) => e.type === 'tool_change'),
        undos: count((e) => e.type === 'undo'), redos: count((e) => e.type === 'redo'),
        corrections: count((e) => e.type === 'wrong_tool_correction'), menuOpens: count((e) => e.type === 'menu_open'),
      };
    },

    async accountRestart() {
      const T = this.task;
      if (!T) return;
      const app = this.app, t = T.def, st = this.taskState(t.id);
      app.commitPending();
      app.logEvent('task_restart', { taskId: t.id, attempt: st.attempts, elapsedMs: Math.round(this.elapsed(T)), ...this.taskStatsFor(t.id) });
      const d = await app.buildTaskDoc(t);
      d.dirty = true;
      this.docs.set(t.id, d);
      app.showDoc(d);
      st.activeMs = 0;
      st.attempts = (st.attempts || 1) + 1;
      Object.assign(T, { baseMs: 0, visitBase: 0, start: performance.now(), pausedMs: 0, pauses: 0, pausedAt: null, attempt: st.attempts, startEvent: app.logger.events.length });
      app.logEvent('task_start', { taskId: t.id, index: this.taskIndex, title: t.title, taskType: t.type || null, attempt: st.attempts });
      await this.saveCurrent(true);
      this.renderTaskPanel();
      this.ui.toast('Task restarted');
    },

    allDone() {
      this.app.logEvent('all_tasks_done', {});
      this.ui.modal({
        title: 'All tasks done 🎉',
        body: el('p', {}, 'Thank you! You have finished all 12 tasks. You can still reopen any task from the bar at the top, or log out.'),
        actions: [{ label: 'Log out', act: () => { this.logout(); } }, { label: 'Close', primary: true }],
      });
    },

    async logout() {
      if (!this.accountMode) return;
      await this.leaveTask('logout');
      this.app.logEvent('logout', {});
      this.app.logger.end('logout');
      await this.app.uploader.uploadRecord(this.app.logger.record());
      this.app.logger.meta = null;
      await this.app.account.logout();
      this.accountMode = false;
      this.docs = new Map();
      this.taskIndex = 0;
      this.app.canvasLocked = null;
      this.app.resetDocument('logout');
      this.renderTaskbar();
      this.renderSessionInfo();
      this.renderTaskPanel();
      this.showLogin();
    },

    /* ---------- UI ---------- */
    renderTaskbar() {
      const bar = document.getElementById('taskbar');
      if (!bar) return;
      bar.innerHTML = '';
      bar.classList.toggle('hidden', !this.accountMode);
      if (!this.accountMode) return;
      const done = this.tasks.filter((t) => this.taskState(t.id).status === 'done').length;
      bar.append(el('span', { class: 'tb-label' }, 'Tasks'));
      this.tasks.forEach((t, i) => {
        const st = this.taskState(t.id);
        const running = this.task && this.task.def === t;
        const ms = running ? this.elapsed(this.task) : st.activeMs;
        const frac = st.status === 'done' ? 1 : st.status === 'started' ? Math.min(0.9, Math.max(0.12, ms / ((t.estMin || 12) * 60000))) : 0;
        const label = { new: 'not started', started: 'in progress', done: 'done' }[st.status];
        const seg = el('button', {
          class: `tb-seg st-${st.status}${i === this.taskIndex ? ' current' : ''}${running ? ' running' : ''}${i % 4 === 0 && i ? ' gap' : ''}`,
          title: `${i + 1}. ${t.title}\n${label}${st.activeMs || running ? ' · ' + U.fmtTime(ms) : ''}`,
          onclick: () => this.selectTask(i, 'taskbar'),
        }, el('span', { class: 'tb-fill', style: { width: frac * 100 + '%' } }), el('span', { class: 'tb-num' }, String(i + 1)));
        bar.append(seg);
      });
      bar.append(el('span', { class: 'tb-count' }, `${done}/12`));
      if (this.saveError) bar.append(el('span', { class: 'tb-warn', title: this.saveError }, 'not saved'));
    },

    taskStatusLine(t, running) {
      if (!this.accountMode) return null;
      const st = this.taskState(t.id);
      const ms = running ? this.elapsed(this.task) : st.activeMs;
      const txt = running ? 'In progress' : st.status === 'done' ? `Done ✓ · ${U.fmtTime(st.activeMs)}` : st.status === 'started' ? `Started · ${U.fmtTime(ms)} so far` : `Not started · about ${t.estMin || 10} min · no time limit`;
      return el('div', { class: 'muted task-est' }, txt);
    },

    taskButtons(t, running) {
      if (!this.accountMode) return orig.taskButtons.call(this, t, running);
      if (running) return orig.taskButtons.call(this, t, running);
      const st = this.taskState(t.id).status;
      const label = st === 'new' ? 'Start task' : st === 'done' ? 'Reopen task' : 'Resume task';
      return el('div', { class: 'row' }, el('button', { class: 'ob-btn primary', onclick: () => this.beginTask() }, label));
    },

    renderSessionInfo() {
      if (!this.accountMode) { orig.renderSessionInfo.call(this); return; }
      const box = document.getElementById('session-info');
      box.innerHTML = '';
      box.append(el('span', { class: 'si-id', title: 'Logged in as' }, this.app.account.pid),
        el('button', { class: 'ob-btn sm', onclick: () => this.confirmLogout() }, 'Log out'));
    },
    confirmLogout() {
      this.ui.modal({
        title: 'Log out?',
        body: el('p', {}, 'Your drawings and progress are saved. Log in again with the same code and PIN to continue.'),
        actions: [{ label: 'Cancel' }, { label: 'Log out', primary: true, act: () => { this.logout(); } }],
      });
    },

    /* ---------- routing of the existing study actions ---------- */
    startTask() { return this.accountMode ? this.beginTask() : orig.startTask.call(this); },
    finishTask() { return this.accountMode ? this.accountFinish() : orig.finishTask.call(this); },
    restartTask() { return this.accountMode ? this.accountRestart() : orig.restartTask.call(this); },
    toggleTask() {
      if (!this.accountMode) return orig.toggleTask.call(this);
      return this.task ? this.accountFinish() : this.beginTask();
    },
    tick() {
      orig.tick.call(this);
      if (this.accountMode && this.task && (this._tbTick = (this._tbTick || 0) + 1) % 10 === 0) this.renderTaskbar();
    },
  });
})(window.MP);
