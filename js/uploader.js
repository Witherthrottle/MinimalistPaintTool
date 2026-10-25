/* Batched upload of session logs to server/collect.php.
   Every few seconds (and right after task end, questionnaires and session end) it sends only the events the
   server doesn't have yet. The server answers with how many events it holds (`have`), so lost responses,
   retries and reloads never duplicate or skip events. On page hide a small sendBeacon carries the tail.
   IndexedDB stays the primary store; upload is a copy. */
(function (MP) {
  'use strict';
  const U = MP.U;
  const BATCH = 1500;
  const BEACON_MAX = 60000;

  class Uploader {
    constructor(logger) {
      this.logger = logger;
      this.url = '';
      this.token = '';
      this.state = null;
      this.status = 'off';
      this.busy = false;
      this.queued = null;
      this.lastError = null;
      const every = (MP.CONFIG && MP.CONFIG.uploadIntervalMs) || 10000;
      setInterval(() => this.sync(false), every);
      logger.onEvent((e) => {
        if (!this.enabled || !['session_start', 'task_end', 'questionnaire', 'session_end'].includes(e.type)) return;
        const rec = logger.record(); // captured now: the session may be closed before the timeout fires
        setTimeout(() => this.uploadRecord(rec), e.type === 'session_end' ? 50 : 0);
      });
      window.addEventListener('pagehide', () => this.beacon());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.beacon(); });
    }

    configure(url, token) {
      this.url = (url || '').trim();
      this.token = token || '';
      this.status = this.url ? 'idle' : 'off';
      this.lastError = null;
    }
    get enabled() { return !!this.url; }

    stateFor(sid) {
      if (!this.state || this.state.sid !== sid) this.state = U.store.get('mp.upl.' + sid) || { sid, sent: 0, art: 0, q: 0 };
      return this.state;
    }
    save() { if (this.state) U.store.set('mp.upl.' + this.state.sid, this.state); }

    pending(rec = this.logger.active ? this.logger.record() : null) {
      if (!rec || !rec.meta) return 0;
      return rec.events.length - this.stateFor(rec.meta.sessionId).sent;
    }

    async post(body) {
      const r = await fetch(this.url, {
        method: 'POST',
        // text/plain keeps cross-origin requests "simple" (no CORS preflight)
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ token: this.token, ...body }),
      });
      let j = null;
      try { j = await r.json(); } catch (e) { /* non-JSON error page */ }
      if (!r.ok || !j) throw new Error((j && j.error) || 'HTTP ' + r.status);
      return j;
    }

    async ping() {
      if (!this.enabled) throw new Error('No upload URL set');
      return this.post({ ping: true });
    }

    sync(force) {
      if (!this.enabled || !this.logger.active) return null;
      const rec = this.logger.record();
      const st = this.stateFor(rec.meta.sessionId);
      if (!force && st.sent >= rec.events.length && st.art >= rec.artifacts.length && st.q >= rec.questionnaires.length) return null;
      return this.uploadRecord(rec);
    }

    /* Upload everything the server is missing for one session record. */
    async uploadRecord(rec, { onProgress } = {}) {
      if (!this.enabled || !rec || !rec.meta) return false;
      if (this.busy) { this.queued = rec; return false; }
      this.busy = true;
      this.status = 'uploading';
      let ok = false;
      try {
        const sid = rec.meta.sessionId;
        const st = this.stateFor(sid);
        for (let guard = 0; guard < 500; guard++) {
          const events = rec.events.slice(st.sent, st.sent + BATCH);
          // artifacts (canvas PNGs) are large: one per request
          const arts = rec.artifacts.slice(st.art, st.art + 1).map((a) => ({ ai: st.art, ...a }));
          const res = await this.post({ sessionId: sid, meta: rec.meta, offset: st.sent, events, questionnaires: rec.questionnaires, artifacts: arts });
          if (typeof res.have === 'number') st.sent = U.clamp(res.have, 0, rec.events.length);
          if (res.ok) { st.art += arts.length; st.q = rec.questionnaires.length; }
          else if (res.error !== 'gap') throw new Error(res.error || 'rejected');
          this.save();
          if (onProgress) onProgress(st.sent, rec.events.length);
          if (res.ok && st.sent >= rec.events.length && st.art >= rec.artifacts.length) break;
        }
        this.status = 'ok';
        this.lastError = null;
        ok = true;
      } catch (e) {
        this.status = 'error';
        this.lastError = e.message;
      } finally {
        this.busy = false;
        if (this.queued) { const r = this.queued; this.queued = null; this.uploadRecord(r); }
      }
      return ok;
    }

    /* Fire-and-forget tail upload when the page is hidden or closed. The next sync reconciles via `have`. */
    beacon() {
      if (!this.enabled || !this.logger.active || !navigator.sendBeacon) return;
      const rec = this.logger.record();
      const st = this.stateFor(rec.meta.sessionId);
      let n = Math.min(500, rec.events.length - st.sent);
      if (n <= 0) return;
      let payload;
      do {
        payload = JSON.stringify({ token: this.token, sessionId: rec.meta.sessionId, meta: rec.meta, offset: st.sent, events: rec.events.slice(st.sent, st.sent + n), questionnaires: rec.questionnaires });
        n = Math.floor(n / 2);
      } while (payload.length > BEACON_MAX && n > 0);
      if (payload.length <= BEACON_MAX) navigator.sendBeacon(this.url, new Blob([payload], { type: 'text/plain;charset=UTF-8' }));
    }
  }

  MP.Uploader = Uploader;
})(window.MP);
