/* Study support: session setup, task prompts with reference images and timer, NASA-TLX / SUS
   questionnaires, researcher settings (condition, predictor, stability rules, models), stored sessions
   and export. */
(function (MP) {
  'use strict';
  const U = MP.U;
  const el = U.el;

  const svg = (body, bg = '#ffffff') =>
    'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect width="400" height="260" fill="${bg}"/>${body}</svg>`);

  const BUILTIN_TASKS = [
    {
      id: 'T1-ink', title: 'Sketch and ink a mug',
      prompt: 'Recreate the mug.',
      steps: ['Rough it out with the Pencil on its own layer', 'Add a new layer and ink clean lines with the Ink Pen', 'Use Line or Ellipse for the rim if you like', 'Hide or erase the sketch layer', 'Fill the mug body with the Bucket'],
      image: svg('<g fill="none" stroke="#222" stroke-width="5" stroke-linecap="round"><ellipse cx="190" cy="80" rx="80" ry="18"/><path d="M110 80v120c0 18 36 30 80 30s80-12 80-30V80"/><path d="M270 110c40 0 50 60 0 70"/><path d="M165 45c-10-14 10-20 0-34M195 45c-10-14 10-20 0-34M225 45c-10-14 10-20 0-34" stroke-width="3"/></g><path d="M112 82v118c0 18 35 28 78 28s78-10 78-28V82c-10 10-40 16-78 16s-68-6-78-16z" fill="#e8a04a" opacity=".85"/>'),
    },
    {
      id: 'T2-flat', title: 'Flat-color house scene',
      prompt: 'Paint a simple house scene with flat colors.',
      steps: ['Gradient for the sky (Rect Select the top half first)', 'Rectangle and Line tools for the house and roof', 'Bucket-fill walls, roof and door', 'Ellipse for the sun', 'Brush some grass, Eyedropper to reuse colors'],
      image: svg('<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa9e6"/><stop offset="1" stop-color="#dff1ff"/></linearGradient></defs><rect width="400" height="180" fill="url(#s)"/><rect y="180" width="400" height="80" fill="#5fae4f"/><circle cx="330" cy="55" r="28" fill="#ffd23f" stroke="#222" stroke-width="3"/><rect x="120" y="110" width="140" height="100" fill="#f4e1c1" stroke="#222" stroke-width="4"/><path d="M105 112L190 50l85 62z" fill="#c0392b" stroke="#222" stroke-width="4" stroke-linejoin="round"/><rect x="175" y="150" width="32" height="60" fill="#7a4b2a" stroke="#222" stroke-width="3"/><rect x="135" y="130" width="28" height="26" fill="#9fd3ff" stroke="#222" stroke-width="3"/><rect x="222" y="130" width="28" height="26" fill="#9fd3ff" stroke="#222" stroke-width="3"/>'),
    },
    {
      id: 'T3-transform', title: 'Copy, rotate and scale',
      prompt: 'Make a scattered pattern of stars from one drawing.',
      steps: ['Draw one star (Line tool or Pen) and fill it', 'Duplicate the layer, then Move it', 'Use Transform to rotate and scale each copy', 'Lasso a star and recolor it with Bucket or Brush', 'Clone Stamp a small star somewhere else'],
      image: svg('<g stroke="#222" stroke-width="3" stroke-linejoin="round"><path d="M100 60l14 30 33 4-24 22 6 33-29-16-29 16 6-33-24-22 33-4z" fill="#f1c40f"/><path d="M260 40l9 19 21 3-15 14 4 21-19-10-19 10 4-21-15-14 21-3z" fill="#e67e22" transform="rotate(20 260 70)"/><path d="M230 160l17 36 40 5-29 27 7 40-35-19-35 19 7-40-29-27 40-5z" fill="#9b59b6" transform="rotate(-15 230 205) scale(.8) translate(60 50)"/><path d="M330 140l7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2z" fill="#3498db"/><path d="M70 180l6 12 13 2-10 9 3 13-12-6-12 6 3-13-10-9 13-2z" fill="#2ecc71" transform="rotate(35 70 195)"/></g>'),
    },
    {
      id: 'T4-soft', title: 'Soft landscape',
      prompt: 'Paint a soft, painterly landscape.',
      steps: ['Airbrush a sky glow', 'Brush the hills in two or three tones', 'Smudge the clouds and hill edges', 'Marker for the tree trunk, Brush for the canopy', 'Eraser to clean up, Eyedropper to blend colors'],
      image: svg('<defs><radialGradient id="g" cx=".7" cy=".25" r=".8"><stop offset="0" stop-color="#ffe7a8"/><stop offset=".5" stop-color="#f6a97a"/><stop offset="1" stop-color="#7f8fc8"/></radialGradient><filter id="b"><feGaussianBlur stdDeviation="6"/></filter></defs><rect width="400" height="260" fill="url(#g)"/><g filter="url(#b)" fill="#fff" opacity=".8"><ellipse cx="110" cy="60" rx="60" ry="16"/><ellipse cx="160" cy="75" rx="45" ry="12"/></g><path d="M0 190c60-50 120-60 190-30s140 10 210-20v120H0z" fill="#5d7f5a"/><path d="M0 220c80-30 150-20 220 0s120 10 180-10v50H0z" fill="#3f5f41"/><rect x="300" y="150" width="10" height="55" fill="#4a3324"/><circle cx="305" cy="140" r="30" fill="#2f5a3a" filter="url(#b)"/>'),
    },
  ];
  const FREE_TASK = [{ id: 'FREE', title: 'Free drawing', prompt: 'Draw anything you like. Try to use a variety of tools.', steps: [], image: null }];

  const TLX = [
    ['mental', 'Mental demand', 'How mentally demanding was the task?', 'Very low', 'Very high'],
    ['physical', 'Physical demand', 'How physically demanding was the task?', 'Very low', 'Very high'],
    ['temporal', 'Temporal demand', 'How hurried or rushed was the pace of the task?', 'Very low', 'Very high'],
    ['performance', 'Performance', 'How successful were you in accomplishing what you were asked to do?', 'Perfect', 'Failure'],
    ['effort', 'Effort', 'How hard did you have to work to accomplish your level of performance?', 'Very low', 'Very high'],
    ['frustration', 'Frustration', 'How insecure, discouraged, irritated, stressed, and annoyed were you?', 'Very low', 'Very high'],
  ];
  const SUS = [
    'I think that I would like to use this system frequently.',
    'I found the system unnecessarily complex.',
    'I thought the system was easy to use.',
    'I think that I would need the support of a technical person to be able to use this system.',
    'I found the various functions in this system were well integrated.',
    'I thought there was too much inconsistency in this system.',
    'I would imagine that most people would learn to use this system very quickly.',
    'I found the system very cumbersome to use.',
    'I felt very confident using the system.',
    'I needed to learn a lot of things before I could get going with this system.',
  ];
  const MODES = [['static', 'Static (baseline toolbar only)'], ['adaptive-generic', 'Adaptive — generic model'], ['adaptive-personalized', 'Adaptive — personalized model']];

  MP.LOGGING_ONLY = !MP.CONFIG || MP.CONFIG.phase !== 'adaptive';

  class Study {
    constructor(app) {
      this.app = app;
      this.ui = app.ui;
      this.settings = Object.assign({
        participantId: '', condition: 'adaptive-generic', predictor: 'markov2', k: 3, style: 'bar', placement: 'pen',
        dwellMs: 4000, pinCount: 2, pinDwellMs: 60000, hysteresis: 0.05, taskSet: 'p1s1', tlxEachTask: true,
        susAtEnd: !MP.LOGGING_ONLY, clearOnTask: true, barrel: 'radial', eraserTip: true, uploadUrl: '', uploadToken: '',
      }, U.store.get('mp.settings', {}));
      this.customTasks = U.store.get('mp.customTasks', null);
      this.tasks = [];
      this.taskIndex = 0;
      this.task = null; // running task {def, index, start}
      this.susDone = false;
      this.applySettings(this.settings, { silent: true });
      this.renderTaskPanel();
      setInterval(() => this.tick(), 500);
      app.logger.onEvent((e) => this.onLogEvent(e));
    }

    saveSettings() { U.store.set('mp.settings', this.settings); }

    /* Push settings into the engine / suggestion bar / input handling. */
    applySettings(s, { silent = false } = {}) {
      const before = { ...this.settings };
      Object.assign(this.settings, s);
      if (MP.LOGGING_ONLY) {
        this.settings.condition = 'static';
        if (this.settings.barrel === 'radial') this.settings.barrel = 'eyedropper';
      }
      const app = this.app, cfg = app.suggest.cfg;
      app.engine.mode = this.settings.condition;
      app.engine.predictorId = this.settings.predictor;
      Object.assign(cfg, {
        k: +this.settings.k, style: this.settings.style, placement: this.settings.placement, dwellMs: +this.settings.dwellMs,
        pinCount: +this.settings.pinCount, pinDwellMs: +this.settings.pinDwellMs, hysteresis: +this.settings.hysteresis,
      });
      app.input.barrel = this.settings.barrel;
      app.input.eraserTip = this.settings.eraserTip;
      const C = MP.CONFIG || {};
      app.uploader.configure(this.settings.uploadUrl || C.uploadUrl, this.settings.uploadToken || C.uploadToken);
      this.saveSettings();
      if (!silent) {
        const diff = {};
        for (const k in this.settings) if (before[k] !== this.settings[k]) diff[k] = [before[k], this.settings[k]];
        if (Object.keys(diff).length) app.logEvent('settings_change', { diff });
        app.suggest.reset();
        app.suggest.refresh('settings', { force: true });
      }
      app.ui.refreshStatus();
    }

    snapshotSettings() {
      const s = this.settings;
      if (MP.LOGGING_ONLY) return { phase: 'logging', barrel: s.barrel, eraserTip: s.eraserTip };
      return { phase: 'adaptive', condition: s.condition, predictor: s.predictor, k: +s.k, style: s.style, placement: s.placement, dwellMs: +s.dwellMs, pinCount: +s.pinCount, pinDwellMs: +s.pinDwellMs, hysteresis: +s.hysteresis, barrel: s.barrel };
    }

    /* ======================= session ======================= */
    showSetup(first = false) {
      const s = { ...this.settings };
      const f = {};
      const row = (label, input, hint) => el('label', { class: 'frow' }, el('span', { class: 'flbl' }, label), input, hint ? el('span', { class: 'fhint' }, hint) : null);
      const select = (key, opts) => {
        const x = el('select', {}, opts.map(([v, l]) => el('option', { value: v, selected: String(s[key]) === String(v) }, l)));
        f[key] = x;
        return x;
      };
      const check = (key) => { const x = el('input', { type: 'checkbox', checked: !!s[key] }); f[key] = x; return x; };
      f.participantId = el('input', { type: 'text', value: s.participantId, placeholder: 'e.g. P07', spellcheck: false });
      const people = U.store.get('mp.participants', {});
      const profileSel = (key, opts) => { f[key] = el('select', {}, el('option', { value: '' }, 'Select…'), opts.map(([v, l]) => el('option', { value: v }, l))); return f[key]; };
      f.age = el('input', { type: 'number', min: 10, max: 99, placeholder: 'optional' });
      const PROFILE = ['skill', 'device', 'frequency', 'handedness', 'age'];
      // prefill a returning participant's profile and their next Phase 1 session
      const fillProfile = () => {
        const p = people[f.participantId.value.trim()];
        for (const k of PROFILE) f[k].value = p && p[k] != null ? p[k] : '';
        if (p && p.nextSet && f.taskSet.querySelector(`option[value="${p.nextSet}"]`)) f.taskSet.value = p.nextSet;
      };
      f.participantId.addEventListener('input', fillProfile);
      const taskSetOpts = Object.entries(MP.TASK_SETS).map(([k, v]) => [k, v.label])
        .concat([['builtin', 'Classic tasks (4, ~25 min)'], ['free', 'Free drawing'], ['custom', this.customTasks ? `Custom (${this.customTasks.length} tasks)` : 'Custom (import JSON first)']]);
      const body = el('div', { class: 'form' },
        el('p', { class: 'muted' }, 'Everything is stored in this browser until you export it.'),
        row('Participant ID', f.participantId),
        row('Drawing skill', profileSel('skill', [['novice', 'Novice — rarely draw'], ['casual', 'Casual — draw for fun sometimes'], ['intermediate', 'Intermediate — draw regularly'], ['advanced', 'Advanced — professional or very experienced']])),
        row('Device', profileSel('device', [['pen-tablet', 'Pen tablet (no screen)'], ['pen-display', 'Pen display / tablet with screen'], ['mouse', 'Mouse or trackpad'], ['touch', 'Touch (finger)']])),
        row('Draws digitally', profileSel('frequency', [['rarely', 'Rarely'], ['monthly', 'About monthly'], ['weekly', 'Weekly'], ['daily', 'Daily']])),
        row('Drawing hand', profileSel('handedness', [['right', 'Right'], ['left', 'Left']])),
        row('Age', f.age),
        ...(MP.LOGGING_ONLY ? [] : [
          row('Condition', select('condition', MODES)),
          row('Predictor', select('predictor', MP.PredictionEngine.PREDICTORS), 'Used in adaptive conditions; still logged as shadow predictions in Static.'),
          row('Suggestions (k)', select('k', [[3, '3'], [5, '5']])),
          row('Suggestion style', select('style', [['bar', 'Floating bar near the pen'], ['radial', 'Radial menu (right-click / pen barrel)']])),
        ]),
        row('Task set', select('taskSet', taskSetOpts), 'Run Phase 1 sessions 1 → 2 → 3 across visits; returning IDs pick the next one automatically.'),
        el('div', { class: 'frow' }, el('span', { class: 'flbl' }), el('button', { class: 'ob-btn', onclick: () => this.importTasks().then(() => { closeFn('reopen'); this.showSetup(first); }) }, 'Import custom tasks (JSON)…')),
        row('NASA-TLX after each task', check('tlxEachTask')),
        row('SUS at the end', check('susAtEnd')),
        row('Clear canvas at task start', check('clearOnTask')),
      );
      fillProfile();
      const closeFn = this.ui.modal({
        title: first ? 'Welcome — set up the session' : 'Session setup',
        body, dismissible: !first || this.app.logger.active, wide: true,
        actions: [
          { label: 'Practice (no participant)', act: () => { this.startSession({ ...this.readForm(f), participantId: 'practice' }, true); } },
          { label: this.app.logger.active ? 'Start new session' : 'Start session', primary: true, act: () => {
            const v = this.readForm(f);
            if (!v.participantId) { f.participantId.focus(); f.participantId.classList.add('err'); return false; }
            const missing = ['skill', 'device'].filter((k) => !v[k]);
            if (missing.length) { missing.forEach((k) => f[k].classList.add('err')); this.ui.toast('Please choose drawing skill and device'); return false; }
            if (v.taskSet === 'custom' && !this.customTasks) { this.ui.toast('Import a custom task file first'); return false; }
            this.startSession(v, false);
          } },
        ],
      });
    }
    readForm(f) {
      const v = {};
      for (const k in f) v[k] = f[k].type === 'checkbox' ? f[k].checked : f[k].value.trim();
      if ('k' in v) v.k = +v.k;
      return v;
    }

    startSession(v, practice) {
      const app = this.app;
      if (app.logger.active) this.endTaskIfRunning('new_session');
      this.applySettings(v, { silent: true });
      const pid = v.participantId || 'anon';
      const sessionId = `${pid}-${U.dateStamp()}-${U.uid(4)}`;
      const profile = { skill: v.skill || null, device: v.device || null, frequency: v.frequency || null, handedness: v.handedness || null, age: v.age ? +v.age : null };
      if (!practice) {
        const people = U.store.get('mp.participants', {});
        const i = MP.PHASE1_ORDER.indexOf(this.settings.taskSet);
        people[pid] = { ...profile, nextSet: i >= 0 ? MP.PHASE1_ORDER[Math.min(i + 1, MP.PHASE1_ORDER.length - 1)] : (people[pid] || {}).nextSet };
        U.store.set('mp.participants', people);
      }
      app.engine.setParticipant(pid);
      app.engine.sessionId = sessionId;
      app.engine.resetSession();
      app.logger.start({
        sessionId, participantId: pid, participant: profile, practice: !!practice, phase: MP.LOGGING_ONLY ? 'logging' : 'adaptive',
        condition: MP.LOGGING_ONLY ? 'logging' : this.settings.condition, predictor: MP.LOGGING_ONLY ? null : this.settings.predictor,
        settings: this.snapshotSettings(), taskSet: this.settings.taskSet,
        canvas: { w: app.doc.w, h: app.doc.h }, upload: app.uploader.enabled,
        personalHistory: app.engine.personal.counts.n,
        gru: app.engine.gruGenericJSON ? (app.engine.gruGenericJSON.meta || {}).label || 'custom' : null,
      });
      app.resetSessionState();
      const ts = this.settings.taskSet;
      this.tasks = MP.TASK_SETS[ts] ? MP.TASK_SETS[ts].tasks : ts === 'free' ? FREE_TASK : ts === 'custom' && this.customTasks ? this.customTasks : BUILTIN_TASKS;
      this.taskIndex = 0;
      this.task = null;
      this.susDone = false;
      app.suggest.reset();
      app.suggest.refresh('session_start', { force: true });
      this.renderTaskPanel();
      this.renderSessionInfo();
      app.ui.refreshStatus();
      this.ui.toast(practice ? 'Practice session started' : `Session ${sessionId} started`);
    }

    renderSessionInfo() {
      const box = document.getElementById('session-info');
      box.innerHTML = '';
      const L = this.app.logger;
      if (!L.active) { box.append(el('button', { class: 'ob-btn', onclick: () => this.showSetup() }, 'Start session')); return; }
      box.append(
        el('span', { class: 'si-id', title: 'Session ID' }, L.meta.participantId),
        el('span', { class: 'si-cond' }, MP.LOGGING_ONLY ? 'Logging' : { static: 'Static', 'adaptive-generic': 'Generic', 'adaptive-personalized': 'Personal' }[this.settings.condition]),
        el('span', { class: 'si-timer', id: 'si-timer' }, '00:00'));
    }

    async endSession() {
      const app = this.app;
      if (!app.logger.active) { this.ui.toast('No active session'); return; }
      this.ui.modal({
        title: 'End session?',
        body: el('p', {}, 'This finishes any running task' + (this.settings.susAtEnd && !this.susDone ? ', shows the SUS questionnaire' : '') + ' and closes the log.'),
        actions: [{ label: 'Cancel' }, { label: 'End session', primary: true, act: () => { this.finishSession(); } }],
      });
    }
    finishSession() {
      this.endTaskIfRunning('session_end');
      const done = () => {
        this.app.logger.end('user');
        this.showComplete();
        this.renderTaskPanel();
      };
      if (this.settings.susAtEnd && !this.susDone) this.showSUS(done);
      else done();
    }
    showComplete() {
      const rec = this.app.logger.record();
      this.ui.modal({
        title: 'Session complete', wide: true,
        body: el('div', {},
          el('p', {}, `Thank you! ${rec.events.length} events were recorded for ${rec.meta.participantId}.`),
          el('p', { class: 'muted' }, 'The log is saved in this browser. Export it now (researcher):'),
          el('div', { class: 'row wrap' },
            el('button', { class: 'ob-btn primary', onclick: () => this.exportRecord(rec, 'json') }, 'Download JSON'),
            el('button', { class: 'ob-btn', onclick: () => this.exportRecord(rec, 'csv') }, 'Events CSV'),
            el('button', { class: 'ob-btn', onclick: () => this.exportRecord(rec, 'switch') }, 'Tool-switch CSV'))),
        actions: [{ label: 'New session', act: () => setTimeout(() => this.showSetup(), 0) }, { label: 'Close', primary: true }],
      });
      this.app.logger.meta = null; // stop logging; the record is persisted
      this.renderSessionInfo();
      this.app.ui.refreshStatus();
    }

    /* ======================= tasks ======================= */
    async importTasks() {
      const [file] = await U.pickFiles('.json,application/json');
      if (!file) return;
      try {
        const j = JSON.parse(await U.readFile(file));
        const list = Array.isArray(j) ? j : j.tasks;
        if (!Array.isArray(list) || !list.length) throw new Error('Expected an array of tasks');
        this.customTasks = list.map((t, i) => ({
          id: String(t.id || 'C' + (i + 1)), title: String(t.title || 'Task ' + (i + 1)), prompt: String(t.prompt || ''),
          steps: Array.isArray(t.steps) ? t.steps.map(String) : [], image: t.image || null,
        }));
        U.store.set('mp.customTasks', this.customTasks);
        this.ui.toast(`Imported ${this.customTasks.length} tasks`);
      } catch (e) {
        this.ui.toast('Could not read task file: ' + e.message, 4000);
      }
    }

    renderTaskPanel() {
      const b = this.ui.taskBody;
      b.innerHTML = '';
      const L = this.app.logger;
      if (!L.active) {
        b.append(el('p', { class: 'muted' }, 'No session running. Drawing works, but nothing is logged.'),
          el('button', { class: 'ob-btn primary', onclick: () => this.showSetup() }, 'Set up session'));
        return;
      }
      if (this.taskIndex >= this.tasks.length) {
        b.append(el('p', {}, 'All tasks done.'), el('button', { class: 'ob-btn primary', onclick: () => this.finishSession() }, 'Finish session'));
        return;
      }
      const t = this.tasks[this.taskIndex];
      const running = this.task && this.task.def === t;
      b.append(el('div', { class: 'task-head' }, el('span', { class: 'task-n' }, `Task ${this.taskIndex + 1}/${this.tasks.length}`), el('span', { class: 'task-timer', id: 'task-timer' }, running ? U.fmtTime(this.elapsed(this.task)) : '')));
      b.append(el('div', { class: 'task-title' }, t.title));
      if (t.estMin && !running) b.append(el('div', { class: 'muted task-est' }, `About ${t.estMin} min · no time limit`));
      if (t.prompt) b.append(el('p', { class: 'task-prompt' }, t.prompt));
      if (t.steps && t.steps.length) b.append(el('ol', { class: 'task-steps' }, t.steps.map((s) => el('li', {}, s))));
      if (t.image) {
        const img = el('img', { class: 'ref', src: t.image, alt: 'Reference image', title: 'Click to enlarge' });
        img.addEventListener('click', () => {
          this.app.logEvent('reference_view', { taskId: t.id });
          this.ui.modal({ title: 'Reference — ' + t.title, wide: true, body: el('img', { class: 'ref-big', src: t.image, alt: 'Reference image' }), actions: [{ label: 'Close', primary: true }] });
        });
        b.append(img);
      }
      const row = el('div', { class: 'row' });
      if (running) {
        row.append(el('button', { class: 'ob-btn primary', onclick: () => this.finishTask() }, 'Done'),
          el('button', { class: 'ob-btn', title: 'Stop the timer and lock the canvas until you come back', onclick: () => this.pauseTask() }, 'Pause'),
          el('button', { class: 'ob-btn', title: 'Interrupted? Clear the canvas and start this task again', onclick: () => this.confirmRestart() }, 'Restart task'));
      } else {
        row.append(el('button', { class: 'ob-btn primary', onclick: () => this.startTask() }, 'Start task'),
          el('button', { class: 'ob-btn', onclick: () => { this.app.logEvent('task_skip', { taskId: t.id, index: this.taskIndex }); this.taskIndex++; this.renderTaskPanel(); } }, 'Skip'));
      }
      b.append(row);
    }

    toggleTask() {
      if (!this.app.logger.active) { this.showSetup(); return; }
      if (this.task) this.finishTask(); else if (this.taskIndex < this.tasks.length) this.startTask();
    }

    async startTask() {
      const t = this.tasks[this.taskIndex];
      if (!t || this.task || this.starting) return;
      this.starting = true;
      try {
        if (t.startLayers || t.newLayers) await this.app.loadTaskCanvas(t, 'task_start');
        else if (this.settings.clearOnTask) this.app.resetDocument('task_start');
      } finally { this.starting = false; }
      const start = performance.now();
      this.task = { def: t, index: this.taskIndex, start, firstStart: start, attempt: 1, startEvent: this.app.logger.events.length, pausedMs: 0, pauses: 0, pausedAt: null };
      this.app.logEvent('task_start', { taskId: t.id, index: this.taskIndex, title: t.title, taskType: t.type || null, attempt: 1 });
      this.app.taskId = t.id;
      this.renderTaskPanel();
    }

    /* Active task time for the current attempt: wall time minus paused time. */
    elapsed(T) {
      return Math.max(0, (T.pausedAt != null ? T.pausedAt : performance.now()) - T.start - T.pausedMs);
    }

    togglePause() {
      if (!this.task) { this.ui.toast('No task is running'); return; }
      if (this.task.pausedAt == null) this.pauseTask();
    }

    /* Stops the task clock and covers the app with a blocking dialog, so no drawing or tool input happens. */
    pauseTask() {
      const T = this.task;
      if (!T || T.pausedAt != null || this.app.stroking) return;
      this.app.commitPending();
      if (this.ui.openMenu) this.ui.closeMenu(null);
      if (this.ui.flyout) this.ui.closeFlyout(null);
      if (this.ui.popover) this.ui.closeColorPicker();
      if (this.app.suggest.radialOpen) this.app.suggest.closeRadial(null);
      T.pausedAt = performance.now();
      T.pauses++;
      this.app.logEvent('task_pause', { taskId: T.def.id, index: T.index, attempt: T.attempt, elapsedMs: Math.round(this.elapsed(T)) });
      const clock = el('div', { class: 'pause-clock' }, U.fmtTime(this.elapsed(T)));
      this.ui.modal({
        title: 'Task paused',
        body: el('div', { class: 'pause-body' }, clock, el('p', { class: 'muted' }, 'The timer is stopped and the canvas is locked. Resume when you are back.')),
        dismissible: false,
        actions: [{ label: 'Resume task', primary: true, act: () => this.resumeTask() }],
      });
      this.renderTaskPanel();
    }

    resumeTask() {
      const T = this.task;
      if (!T || T.pausedAt == null) return;
      const pauseMs = performance.now() - T.pausedAt;
      T.pausedMs += pauseMs;
      T.pausedAt = null;
      this.app.logEvent('task_resume', { taskId: T.def.id, index: T.index, attempt: T.attempt, pauseMs: Math.round(pauseMs), totalPausedMs: Math.round(T.pausedMs) });
      this.renderTaskPanel();
    }

    confirmRestart() {
      if (!this.task) return;
      this.ui.modal({
        title: 'Restart this task?',
        body: el('p', {}, 'Your drawing for this task is cleared and the timer starts again from zero. Only the new attempt counts toward the task time.'),
        actions: [{ label: 'Keep going' }, { label: 'Restart task', primary: true, act: () => this.restartTask() }],
      });
    }

    /* Abandons the current attempt (logged with its stats) and starts the same task fresh. */
    async restartTask() {
      const T = this.task;
      if (!T) return;
      this.app.commitPending();
      this.app.logEvent('task_restart', { taskId: T.def.id, index: T.index, attempt: T.attempt, elapsedMs: Math.round(this.elapsed(T)), pausedMs: Math.round(T.pausedMs), ...this.taskStats(T.startEvent) });
      if (T.def.startLayers || T.def.newLayers) await this.app.loadTaskCanvas(T.def, 'task_restart');
      else this.app.resetDocument('task_restart');
      T.attempt++;
      T.start = performance.now();
      T.pausedMs = 0;
      T.pauses = 0;
      T.pausedAt = null;
      T.startEvent = this.app.logger.events.length;
      this.app.logEvent('task_start', { taskId: T.def.id, index: T.index, title: T.def.title, attempt: T.attempt });
      this.renderTaskPanel();
      this.ui.toast('Task restarted');
    }

    taskStats(fromEvent) {
      const ev = this.app.logger.events.slice(fromEvent);
      const count = (pred) => ev.filter(pred).length;
      return {
        strokes: count((e) => e.type === 'stroke_end'),
        toolSwitches: count((e) => e.type === 'tool_change'),
        suggestionSelections: count((e) => e.type === 'tool_change' && /^(suggestion|radial)/.test(e.method)),
        undos: count((e) => e.type === 'undo'),
        redos: count((e) => e.type === 'redo'),
        corrections: count((e) => e.type === 'wrong_tool_correction'),
        menuOpens: count((e) => e.type === 'menu_open'),
      };
    }

    finishTask() {
      const T = this.task;
      if (!T) return;
      const durationMs = Math.round(this.elapsed(T));
      this.app.commitPending();
      const stats = this.taskStats(T.startEvent);
      this.app.logEvent('task_end', { taskId: T.def.id, index: T.index, durationMs, pausedMs: Math.round(T.pausedMs), pauses: T.pauses, attempts: T.attempt, msSinceFirstStart: Math.round(performance.now() - T.firstStart), ...stats });
      try {
        const flat = this.app.doc.flatten();
        const s = Math.min(1, 800 / Math.max(flat.width, flat.height));
        const c = U.makeCanvas(flat.width * s, flat.height * s);
        c.getContext('2d').drawImage(flat, 0, 0, c.width, c.height);
        this.app.logger.addArtifact({ kind: 'canvas', taskId: T.def.id, t: Math.round(this.app.logger.elapsed()), png: c.toDataURL('image/png') });
      } catch (e) { /* ignore */ }
      this.task = null;
      this.app.taskId = null;
      this.taskIndex++;
      const next = () => {
        this.renderTaskPanel();
        if (this.taskIndex >= this.tasks.length) this.finishSession();
      };
      if (this.settings.tlxEachTask) this.showTLX(next, T.def.id);
      else next();
    }
    endTaskIfRunning(reason) {
      if (!this.task) return;
      const T = this.task;
      this.app.logEvent('task_end', { taskId: T.def.id, index: T.index, durationMs: Math.round(this.elapsed(T)), pausedMs: Math.round(T.pausedMs), aborted: reason, ...this.taskStats(T.startEvent) });
      this.task = null;
      this.app.taskId = null;
    }

    tick() {
      const L = this.app.logger;
      const st = document.getElementById('si-timer');
      if (st && L.active) st.textContent = U.fmtTime(L.elapsed());
      if (this.task) {
        const el2 = document.getElementById('task-timer');
        if (el2) el2.textContent = U.fmtTime(this.elapsed(this.task));
      }
      this.app.ui.refreshStatus();
    }

    /* ======================= questionnaires ======================= */
    showTLX(after, taskId = this.task ? this.task.def.id : null) {
      const vals = {};
      const body = el('div', { class: 'tlx' }, el('p', { class: 'muted' }, 'Move every slider to rate the task you just did.'));
      let grip = null;
      for (const [key, name, q, lo, hi] of TLX) {
        const out = el('span', { class: 'tlx-v' }, '—');
        const r = el('input', { type: 'range', min: 0, max: 100, step: 5, value: 50, class: 'untouched' });
        const set = () => { vals[key] = +r.value; out.textContent = r.value; r.classList.remove('untouched'); };
        r.addEventListener('input', set);
        r.addEventListener('pointerdown', () => setTimeout(set, 0));
        body.append(el('div', { class: 'tlx-item' },
          el('div', { class: 'tlx-h' }, el('b', {}, name), out), el('div', { class: 'tlx-q' }, q), r,
          el('div', { class: 'tlx-anchors' }, el('span', {}, lo), el('span', {}, hi))));
      }
      const gripOpts = el('div', { class: 'likert' }, [1, 2, 3, 4, 5, 6, 7].map((v) => {
        const inp = el('input', { type: 'radio', name: 'grip', value: v });
        inp.addEventListener('change', () => { grip = v; });
        return el('label', {}, inp, el('span', {}, v));
      }));
      body.append(el('div', { class: 'tlx-item' },
        el('div', { class: 'tlx-h' }, el('b', {}, 'Grip shifting')),
        el('div', { class: 'tlx-q' }, 'How frustrating was it to shift or readjust your grip on the pen to reach tools and menus?'),
        gripOpts, el('div', { class: 'tlx-anchors' }, el('span', {}, '1 · Not at all'), el('span', {}, '7 · Extremely'))));
      const comment = el('textarea', { class: 'qtext', rows: 3, placeholder: 'Optional — anything that frustrated you, slowed you down or felt awkward' });
      body.append(el('div', { class: 'tlx-item' }, el('div', { class: 'tlx-h' }, el('b', {}, 'Anything frustrating?')), comment));
      this.ui.modal({
        title: 'After-task questionnaire', body, dismissible: false, wide: true,
        actions: [{ label: 'Submit', primary: true, act: () => {
          const missing = TLX.filter(([k]) => vals[k] == null);
          if (missing.length || grip == null) { this.ui.toast('Please rate: ' + missing.map((m) => m[1]).concat(grip == null ? ['Grip shifting'] : []).join(', '), 3500); return false; }
          const raw = TLX.reduce((a, [k]) => a + vals[k], 0) / TLX.length;
          this.app.logger.addQuestionnaire({
            kind: 'nasa-tlx', taskId, items: { ...vals }, rawTLX: U.round(raw, 2), gripShift: grip,
            comment: comment.value.trim() || null, condition: MP.LOGGING_ONLY ? 'logging' : this.settings.condition,
          });
          if (after) setTimeout(after, 0);
        } }],
      });
    }

    showSUS(after) {
      const vals = {};
      const body = el('div', { class: 'sus' }, el('p', { class: 'muted' }, '1 = strongly disagree · 5 = strongly agree'));
      SUS.forEach((q, i) => {
        const name = 'sus' + i;
        const opts = el('div', { class: 'likert' }, [1, 2, 3, 4, 5].map((v) => {
          const inp = el('input', { type: 'radio', name, value: v });
          inp.addEventListener('change', () => { vals[i + 1] = v; });
          return el('label', {}, inp, el('span', {}, v));
        }));
        body.append(el('div', { class: 'sus-item' }, el('div', { class: 'sus-q' }, `${i + 1}. ${q}`), opts));
      });
      this.ui.modal({
        title: 'System Usability Scale', body, dismissible: false, wide: true,
        actions: [{ label: 'Submit', primary: true, act: () => {
          const missing = SUS.map((_, i) => i + 1).filter((i) => vals[i] == null);
          if (missing.length) { this.ui.toast('Please answer item(s): ' + missing.join(', '), 3500); return false; }
          let sum = 0;
          for (let i = 1; i <= 10; i++) sum += i % 2 ? vals[i] - 1 : 5 - vals[i];
          this.app.logger.addQuestionnaire({ kind: 'sus', items: { ...vals }, score: sum * 2.5, condition: this.settings.condition });
          this.susDone = true;
          if (after) setTimeout(after, 0);
        } }],
      });
    }

    /* ======================= researcher settings ======================= */
    showResearcher() {
      const s = { ...this.settings };
      const f = {};
      const row = (label, input, hint) => el('label', { class: 'frow' }, el('span', { class: 'flbl' }, label), input, hint ? el('span', { class: 'fhint' }, hint) : null);
      const select = (key, opts) => { const x = el('select', {}, opts.map(([v, l]) => el('option', { value: v, selected: String(s[key]) === String(v) }, l))); f[key] = x; return x; };
      const num = (key, min, max, step) => { const x = el('input', { type: 'number', min, max, step, value: s[key] }); f[key] = x; return x; };
      const check = (key) => { const x = el('input', { type: 'checkbox', checked: !!s[key] }); f[key] = x; return x; };
      const txt = (key, ph) => { const x = el('input', { type: 'text', value: s[key] || '', placeholder: ph, spellcheck: false }); f[key] = x; return x; };
      const C = MP.CONFIG || {};
      const upResult = el('span', { class: 'fhint' });
      const testUpload = async () => {
        const up = this.app.uploader;
        const prev = [up.url, up.token];
        up.configure(f.uploadUrl.value || C.uploadUrl, f.uploadToken.value || C.uploadToken);
        upResult.textContent = 'Testing…';
        try { const r = await up.ping(); upResult.textContent = r.ok ? 'Connected — server can write data.' : 'Server answered: ' + (r.error || 'not ok'); }
        catch (e) { upResult.textContent = 'Failed: ' + e.message; }
        up.configure(prev[0], prev[1]);
      };
      const status = el('div', { class: 'model-status' });
      const progress = el('div', { class: 'progress muted' });
      const refreshStatus = () => { status.innerHTML = ''; status.append(...this.modelStatus()); };
      refreshStatus();

      const adaptiveSections = MP.LOGGING_ONLY ? [el('p', { class: 'muted' }, "Logging phase: suggestions, predictors and models are off. Set phase: 'adaptive' in js/config.js to enable them.")] : [
        el('h3', {}, 'Condition'),
        row('Mode', select('condition', MODES)),
        row('Predictor', select('predictor', MP.PredictionEngine.PREDICTORS)),
        row('k', select('k', [[3, '3'], [5, '5']])),
        row('Style', select('style', [['bar', 'Floating bar'], ['radial', 'Radial menu']])),
        row('Bar placement', select('placement', [['pen', 'Follow the pen (moves on stroke end)'], ['fixed', 'Fixed (top of canvas, draggable)']])),
        el('h3', {}, 'Stability rules'),
        row('Min. dwell (ms)', num('dwellMs', 0, 60000, 250), 'Displayed set changes at most this often'),
        row('Pinned slots', select('pinCount', [[0, '0'], [1, '1'], [2, '2']])),
        row('Pin re-evaluation (ms)', num('pinDwellMs', 5000, 600000, 1000)),
        row('Hysteresis', num('hysteresis', 0, 0.5, 0.01), 'Probability margin a newcomer needs to displace a shown tool'),
      ];
      const modelSections = MP.LOGGING_ONLY ? [] : [
        el('h3', {}, 'Models'),
        status,
        el('div', { class: 'row wrap' },
          el('button', { class: 'ob-btn', onclick: () => this.importPooled(progress, true).then(refreshStatus) }, 'Import pooled sessions → fit counts + train GRU'),
          el('button', { class: 'ob-btn', onclick: () => this.importPooled(progress, false).then(refreshStatus) }, 'Import pooled sessions → counts only'),
          el('button', { class: 'ob-btn', onclick: () => this.loadGRU().then(refreshStatus) }, 'Load GRU weights…'),
          el('button', { class: 'ob-btn', onclick: () => this.exportGRU() }, 'Export GRU weights'),
          el('button', { class: 'ob-btn', onclick: () => this.finetunePersonal(progress).then(refreshStatus) }, 'Fine-tune personal GRU'),
          el('button', { class: 'ob-btn danger', onclick: () => { this.app.engine.setGenericCounts(null); this.app.engine.setGenericGRU(MP.DEFAULT_GRU || null); refreshStatus(); this.ui.toast('Generic models reset to built-in'); } }, 'Reset generic models'),
          el('button', { class: 'ob-btn danger', onclick: () => { this.app.engine.resetPersonal(); refreshStatus(); this.ui.toast('Personal data cleared for ' + this.app.engine.participantId); } }, 'Reset personal data')),
        progress,
      ];
      const barrelOpts = [['eyedropper', 'Eyedropper (hold)'], ['pan', 'Pan (hold)'], ['none', 'Nothing']];
      if (!MP.LOGGING_ONLY) barrelOpts.unshift(['radial', 'Radial suggestions']);
      const body = el('div', { class: 'form' },
        ...adaptiveSections,
        el('h3', {}, 'Pen'),
        row('Barrel button', select('barrel', barrelOpts)),
        row('Eraser end erases', check('eraserTip')),
        ...modelSections,
        el('h3', {}, 'Data'),
        row('Upload URL', txt('uploadUrl', C.uploadUrl || 'https://example.com/api/collect.php'), C.uploadUrl ? 'Leave empty to use js/config.js' : 'Empty = upload off (set it in js/config.js for deployment)'),
        row('Upload token', txt('uploadToken', C.uploadToken ? '(from config.js)' : '')),
        el('div', { class: 'frow' }, el('span', { class: 'flbl' }), el('button', { class: 'ob-btn', onclick: testUpload }, 'Test connection'), upResult),
        el('div', { class: 'row wrap' },
          el('button', { class: 'ob-btn', onclick: () => this.showSessions() }, 'Stored sessions…'),
          el('button', { class: 'ob-btn', onclick: () => this.toggleLiveLog() }, 'Toggle live event log')),
      );
      this.ui.modal({
        title: 'Researcher settings', body, wide: true,
        actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, act: () => {
          const v = {};
          for (const k in f) v[k] = f[k].type === 'checkbox' ? f[k].checked : f[k].type === 'number' ? +f[k].value : f[k].value;
          if ('k' in v) v.k = +v.k;
          if ('pinCount' in v) v.pinCount = +v.pinCount;
          this.applySettings(v);
          if (this.app.logger.active && !MP.LOGGING_ONLY) { this.app.logger.meta.condition = this.settings.condition; this.app.logger.meta.predictor = this.settings.predictor; }
          this.renderSessionInfo();
        } }],
      });
    }

    modelStatus() {
      const e = this.app.engine, g = e.generic, gj = e.gruGenericJSON, p = e.personal;
      const gm = gj && gj.meta ? gj.meta : {};
      const lines = [
        ['Generic counts', g.builtin ? 'built-in prior (hand-made)' : `pooled from ${g.sessions} session(s), ${g.n} switches`],
        ['Generic GRU', gj ? `${gm.label || 'custom'}${gm.history && gm.history.length ? ` · val top-3 ${Math.round((gm.history[gm.history.length - 1].top3 || 0) * 100)}%` : ''}` : 'none (GRU falls back to Markov)'],
        ['Personal data', `${e.participantId}: ${p.counts.n} switches stored${p.gru && p.gru.updates ? `, ${p.gru.updates} online GRU updates` : ''}${p.gru && p.gru.full ? ', fine-tuned GRU' : ''}`],
      ];
      return lines.map(([k, v]) => el('div', { class: 'ms-row' }, el('span', { class: 'ms-k' }, k), el('span', {}, v)));
    }

    async readSessionFiles() {
      const files = await U.pickFiles('.json,application/json', true);
      const recs = [];
      for (const f of files) {
        try {
          const j = JSON.parse(await U.readFile(f));
          const list = Array.isArray(j) ? j : j.sessions || [j];
          for (const r of list) if (r && r.events) recs.push(r);
        } catch (e) { this.ui.toast(`Skipped ${f.name}: ${e.message}`, 3500); }
      }
      return recs;
    }

    async importPooled(progress, trainGRU) {
      const recs = await this.readSessionFiles();
      if (!recs.length) return;
      const counts = MP.countsFromRecords(recs);
      this.app.engine.setGenericCounts(counts);
      this.app.logEvent('model_import', { kind: 'counts', sessions: recs.length, switches: counts.n });
      progress.textContent = `Fitted counts from ${recs.length} session(s), ${counts.n} switches.`;
      if (!trainGRU) return;
      const seqs = recs.flatMap((r) => MP.sequencesFromRecord(r));
      if (!seqs.length) { progress.textContent += ' No usable sequences for the GRU.'; return; }
      const model = new MP.GRU({ tools: MP.TOOL_IDS, featureNames: MP.FEATURES.names, hidden: 24 });
      await model.train(seqs, {
        epochs: 40, lr: 0.01,
        onProgress: (r) => { progress.textContent = `Training GRU… epoch ${r.epoch}/40 · val loss ${r.valLoss != null ? r.valLoss.toFixed(3) : '–'} · top-1 ${Math.round((r.top1 || 0) * 100)}% · top-3 ${Math.round((r.top3 || 0) * 100)}%`; },
      });
      const json = model.toJSON();
      json.meta.label = `Pooled ${recs.length} session(s)`;
      try {
        this.app.engine.setGenericGRU(json);
        this.app.logEvent('model_import', { kind: 'gru', sessions: recs.length, final: json.meta.history[json.meta.history.length - 1] });
        progress.textContent += ' — saved as the generic GRU.';
      } catch (e) { progress.textContent = e.message; }
    }

    async loadGRU() {
      const [file] = await U.pickFiles('.json,application/json');
      if (!file) return;
      try {
        const j = JSON.parse(await U.readFile(file));
        MP.GRU.fromJSON(j); // validates
        this.app.engine.setGenericGRU(j);
        this.app.logEvent('model_import', { kind: 'gru_file', label: (j.meta || {}).label || file.name });
        this.ui.toast('GRU weights loaded');
      } catch (e) { this.ui.toast('Could not load weights: ' + e.message, 4000); }
    }
    exportGRU() {
      const m = this.app.engine.gruModel();
      if (!m) { this.ui.toast('No GRU loaded'); return; }
      U.download('gru_weights.json', JSON.stringify(m.toJSON()), 'application/json');
    }
    async finetunePersonal(progress) {
      const e = this.app.engine;
      const seqs = MP.personalSequences(e.personal);
      const n = seqs.reduce((a, s) => a + s.inputs.length, 0);
      if (n < 30) { progress.textContent = `Only ${n} personal switches stored for ${e.participantId} — need at least 30.`; return; }
      const base = e.gruGenericJSON;
      const model = base ? MP.GRU.fromJSON(base) : new MP.GRU({ tools: MP.TOOL_IDS, featureNames: MP.FEATURES.names, hidden: 24 });
      await model.train(seqs, { epochs: 15, lr: 0.004, onProgress: (r) => { progress.textContent = `Fine-tuning… epoch ${r.epoch}/15 · top-3 ${Math.round((r.top3 || 0) * 100)}%`; } });
      const json = model.toJSON();
      json.meta.label = `Personal fine-tune (${e.participantId})`;
      e.personal.gru = { ...(e.personal.gru || {}), full: json, W: null };
      e._gru = null;
      e.savePersonal();
      this.app.logEvent('model_finetune', { participantId: e.participantId, switches: n });
      progress.textContent += ' — saved for this participant.';
    }

    /* ======================= export & stored sessions ======================= */
    exportRecord(rec, kind) {
      const id = rec.meta.sessionId;
      if (kind === 'json') U.download(id + '.json', MP.Logger.toJSON(rec), 'application/json');
      else if (kind === 'csv') U.download(id + '_events.csv', MP.Logger.toCSV(rec), 'text/csv');
      else U.download(id + '_switches.csv', MP.Logger.toSwitchCSV(rec), 'text/csv');
      if (this.app.logger.active) this.app.logEvent('export', { kind, sessionId: id });
    }
    exportCurrent(kind) {
      const L = this.app.logger;
      if (!L.active) { this.showSessions(); return; }
      L.flush(true);
      this.exportRecord(L.record(), kind);
    }

    async showSessions() {
      const L = this.app.logger;
      await L.flush(true);
      const list = await L.listSessions();
      const table = el('div', { class: 'sessions' });
      const render = (items) => {
        table.innerHTML = '';
        if (!items.length) { table.append(el('p', { class: 'muted' }, 'No stored sessions in this browser.')); return; }
        table.append(el('div', { class: 'srow head' }, el('span', {}, 'Session'), el('span', {}, 'Condition'), el('span', {}, 'Started'), el('span', {}, 'Events'), el('span', {})));
        for (const s of items) {
          const get = () => L.getSession(s.id);
          table.append(el('div', { class: 'srow' },
            el('span', { class: 'mono' }, s.id), el('span', {}, s.condition), el('span', {}, new Date(s.startedAt).toLocaleString()), el('span', {}, s.events),
            el('span', { class: 'sact' },
              el('button', { class: 'ob-btn sm', onclick: async () => this.exportRecord(await get(), 'json') }, 'JSON'),
              el('button', { class: 'ob-btn sm', onclick: async () => this.exportRecord(await get(), 'csv') }, 'CSV'),
              el('button', { class: 'ob-btn sm', onclick: async () => this.exportRecord(await get(), 'switch') }, 'Switches'),
              this.app.uploader.enabled ? el('button', { class: 'ob-btn sm', onclick: async (e) => {
                const b = e.currentTarget;
                b.textContent = '…';
                const ok = await this.app.uploader.uploadRecord(await get(), { onProgress: (n, tot) => { b.textContent = Math.round((n / Math.max(1, tot)) * 100) + '%'; } });
                b.textContent = ok ? 'Uploaded ✓' : 'Failed';
                if (!ok) this.ui.toast('Upload failed: ' + this.app.uploader.lastError, 4000);
              } }, 'Upload') : null,
              el('button', { class: 'ob-btn sm danger', disabled: L.active && L.meta.sessionId === s.id, onclick: async () => {
                if (!confirm('Delete session ' + s.id + ' from this browser? This cannot be undone.')) return;
                await L.deleteSession(s.id);
                render(await L.listSessions());
              } }, 'Delete'))));
        }
      };
      render(list);
      this.ui.modal({
        title: 'Stored sessions', wide: true, body: table,
        actions: [
          { label: 'Export all (JSON)', act: async () => { const all = await L.getAllSessions(); U.download(`all_sessions_${U.dateStamp()}.json`, JSON.stringify({ format: MP.Logger.FORMAT, sessions: all }), 'application/json'); return false; } },
          { label: 'Export all events (CSV)', act: async () => { U.download(`all_events_${U.dateStamp()}.csv`, MP.Logger.toCSV(await L.getAllSessions()), 'text/csv'); return false; } },
          ...(this.app.uploader.enabled ? [{ label: 'Upload all', act: async () => {
            const all = await L.getAllSessions();
            let done = 0;
            for (const r of all) { if (await this.app.uploader.uploadRecord(r)) done++; }
            this.ui.toast(`Uploaded ${done}/${all.length} sessions` + (done < all.length ? ' — ' + this.app.uploader.lastError : ''), 4000);
            return false;
          } }] : []),
          { label: 'Export all switches (CSV)', act: async () => { U.download(`all_switches_${U.dateStamp()}.csv`, MP.Logger.toSwitchCSV(await L.getAllSessions()), 'text/csv'); return false; } },
          { label: 'Close', primary: true },
        ],
      });
    }

    /* ======================= live log ======================= */
    toggleLiveLog() {
      let box = document.getElementById('livelog');
      if (box) { box.remove(); this.live = null; return; }
      box = el('div', { id: 'livelog' }, el('div', { class: 'll-head' }, 'Live event log', el('button', { class: 'mini', onclick: () => this.toggleLiveLog() }, '×')), el('div', { class: 'll-body' }));
      document.body.append(box);
      this.live = box.querySelector('.ll-body');
      for (const e of this.app.logger.events.slice(-60)) this.onLogEvent(e);
    }
    onLogEvent(e) {
      if (!this.live) return;
      const { i, t, ts, type, ...rest } = e;
      const short = JSON.stringify(rest).slice(0, 220);
      this.live.append(el('div', { class: 'll-row ll-' + type }, el('span', { class: 'll-t' }, (t / 1000).toFixed(1)), el('b', {}, type), ' ', el('span', { class: 'll-d' }, short)));
      while (this.live.children.length > 80) this.live.firstChild.remove();
      this.live.scrollTop = this.live.scrollHeight;
    }
  }

  MP.Study = Study;
  MP.BUILTIN_TASKS = BUILTIN_TASKS;
})(window.MP);
