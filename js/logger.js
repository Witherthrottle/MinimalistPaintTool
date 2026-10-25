/* Event logger. Every event gets a session-relative time `t` (ms, monotonic) and wall-clock `ts` (epoch ms).
   Sessions are persisted to IndexedDB every few seconds and on page hide, so a crash or reload loses
   at most a few seconds of data. Export as JSON (full record) or CSV (one row per event). */
(function (MP) {
  'use strict';
  const U = MP.U;
  const DB_NAME = 'minimalist-paint';
  const STORE = 'sessions';
  const FORMAT = 'minimalist-paint-log/1';

  function openDB() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return resolve(null); }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'meta.sessionId' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  function tx(db, mode, fn) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve(null);
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      const r = fn(st);
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : null);
      t.onerror = () => reject(t.error);
    });
  }

  class Logger {
    constructor() {
      this.meta = null;
      this.events = [];
      this.questionnaires = [];
      this.artifacts = [];
      this.t0 = performance.now();
      this.listeners = [];
      this.dirty = false;
      this.lastSaved = null;
      this.dbReady = openDB().then((db) => (this.db = db));
      setInterval(() => this.flush(), 5000);
      const onHide = () => this.flush();
      window.addEventListener('pagehide', onHide);
      document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); });
    }

    get active() { return !!this.meta; }

    start(meta) {
      if (this.meta) this.end('new_session');
      this.meta = {
        format: FORMAT,
        startedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio || 1 },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        toolIds: MP.TOOL_IDS.slice(),
        featureNames: MP.FEATURES ? MP.FEATURES.names.slice() : [],
        ...meta,
      };
      this.events = [];
      this.questionnaires = [];
      this.artifacts = [];
      this.t0 = performance.now();
      this.log('session_start', { participantId: meta.participantId, condition: meta.condition });
      this.flush(true);
    }

    end(reason = 'user') {
      if (!this.meta) return;
      this.log('session_end', { reason });
      this.meta.endedAt = new Date().toISOString();
      this.flush(true);
    }

    log(type, data = {}) {
      const e = { i: this.events.length, t: Math.round(performance.now() - this.t0), ts: Date.now(), type, ...data };
      this.events.push(e);
      this.dirty = true;
      for (const fn of this.listeners) fn(e);
      return e;
    }
    onEvent(fn) { this.listeners.push(fn); }
    elapsed() { return performance.now() - this.t0; }

    addQuestionnaire(q) {
      this.questionnaires.push(q);
      this.log('questionnaire', q);
    }
    addArtifact(a) {
      this.artifacts.push(a);
      this.dirty = true;
    }

    record() {
      return { meta: this.meta, events: this.events, questionnaires: this.questionnaires, artifacts: this.artifacts };
    }

    async flush(force = false) {
      if (!this.meta || (!this.dirty && !force)) return;
      this.dirty = false;
      await this.dbReady;
      try {
        await tx(this.db, 'readwrite', (st) => st.put(this.record()));
        this.lastSaved = Date.now();
      } catch (e) {
        this.dirty = true;
        console.warn('Log persistence failed', e);
      }
    }

    async listSessions() {
      await this.dbReady;
      const all = (await tx(this.db, 'readonly', (st) => st.getAll())) || [];
      return all.map((r) => ({
        id: r.meta.sessionId, participantId: r.meta.participantId, condition: r.meta.condition,
        startedAt: r.meta.startedAt, events: r.events.length,
      })).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    }
    async getSession(id) {
      if (this.meta && id === this.meta.sessionId) return this.record();
      await this.dbReady;
      return tx(this.db, 'readonly', (st) => st.get(id));
    }
    async getAllSessions() {
      await this.dbReady;
      return (await tx(this.db, 'readonly', (st) => st.getAll())) || [];
    }
    async deleteSession(id) {
      await this.dbReady;
      return tx(this.db, 'readwrite', (st) => st.delete(id));
    }

    /* ---------- export ---------- */
    static toJSON(rec) { return JSON.stringify(rec, null, 1); }

    static toCSV(recs) {
      recs = Array.isArray(recs) ? recs : [recs];
      const fixed = ['session_id', 'participant_id', 'condition', 'predictor', 'i', 't', 'ts', 'type'];
      const keys = new Set();
      for (const r of recs) for (const e of r.events) for (const k in e) keys.add(k);
      ['i', 't', 'ts', 'type'].forEach((k) => keys.delete(k));
      const cols = fixed.concat([...keys].sort());
      const esc = (v) => {
        if (v == null) return '';
        if (typeof v === 'object') v = JSON.stringify(v);
        v = String(v);
        return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      };
      const lines = [cols.join(',')];
      for (const r of recs) {
        const m = r.meta || {};
        for (const e of r.events) {
          const row = { session_id: m.sessionId, participant_id: m.participantId, condition: m.condition, predictor: m.predictor, ...e };
          lines.push(cols.map((c) => esc(row[c])).join(','));
        }
      }
      return lines.join('\n');
    }

    /* One row per tool switch — the sequence-modelling view of the data. */
    static toSwitchCSV(recs) {
      recs = Array.isArray(recs) ? recs : [recs];
      const fnames = (MP.FEATURES && MP.FEATURES.names) || [];
      const cols = ['session_id', 'participant_id', 'condition', 'predictor', 'task_id', 'i', 't', 'from', 'to', 'method',
        'in_suggestions', 'suggestion_slot', 'model_rank', 'model_p', 'shown', 'model_topk', 'travel_px', 'travel_path_px',
        'ms_since_last_switch', 'strokes_in_prev_tool'].concat(fnames.map((f) => 'f_' + f));
      const esc = (v) => {
        if (v == null) return '';
        if (typeof v === 'object') v = JSON.stringify(v);
        v = String(v);
        return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      };
      const lines = [cols.join(',')];
      for (const r of recs) {
        const m = r.meta || {};
        for (const e of r.events) {
          if (e.type !== 'tool_change') continue;
          const row = [m.sessionId, m.participantId, e.condition || m.condition, e.predictor || m.predictor, e.taskId, e.i, e.t, e.from, e.to, e.method,
            e.inSuggestions, e.suggestionSlot, e.modelRank, e.modelP, e.shown, e.modelTopK, e.travelPx, e.travelPathPx,
            e.msSinceLastSwitch, e.strokesInPrevTool].concat((e.features || []).map((v) => U.round(v, 4)));
          lines.push(row.map(esc).join(','));
        }
      }
      return lines.join('\n');
    }
  }

  Logger.FORMAT = FORMAT;
  MP.Logger = Logger;
})(window.MP);
