/* Participant accounts: login/register and saved per-task progress + canvases.
   With an upload URL configured it talks to server/api.php (same folder as collect.php); otherwise it
   keeps everything in this browser's IndexedDB, so a lab machine works offline with the same flow. */
(function (MP) {
  'use strict';
  const U = MP.U;
  const DB = 'minimalist-paint-accounts';
  const KEEP = 'mp.account';

  function idb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('people', { keyPath: 'id' });
        r.result.createObjectStore('tasks');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbDo(store, mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }
  async function hashPin(pid, pin) {
    const text = 'mp:' + pid.toLowerCase() + ':' + pin;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 5381; // file:// has no crypto.subtle; local mode is for trusted lab machines anyway
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return 'djb2:' + h;
  }

  class Account {
    constructor(app) {
      this.app = app;
      this.pid = null;
      this.token = null;
      this.profile = null;
      this.progress = null;
    }

    get apiUrl() {
      const C = MP.CONFIG || {};
      if (C.apiUrl) return C.apiUrl;
      const up = this.app.uploader && this.app.uploader.url;
      return up ? up.replace(/collect\.php(\?.*)?$/, 'api.php') : '';
    }
    get mode() { return this.apiUrl ? 'server' : 'local'; }
    get loggedIn() { return !!this.pid; }

    async call(action, body = {}) {
      const r = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ key: this.app.uploader.token, action, pid: this.pid, token: this.token, ...body }),
      });
      let j = null;
      try { j = await r.json(); } catch (e) { /* non-JSON error page */ }
      if (!j) throw new Error('Server error (HTTP ' + r.status + ')');
      if (!j.ok) { const e = new Error(j.error || 'Request failed'); e.expired = !!j.expired; throw e; }
      return j;
    }

    adopt(j) {
      this.pid = j.pid;
      this.token = j.token;
      this.profile = j.profile || {};
      this.progress = j.progress && j.progress.tasks ? j.progress : { tasks: {}, current: null };
      U.store.set(KEEP, { pid: this.pid, token: this.token, mode: this.mode });
      return this;
    }

    async register(pid, pin, profile) {
      pid = pid.trim();
      if (!/^[A-Za-z0-9_-]{2,40}$/.test(pid)) throw new Error('Participant code must be 2–40 letters, numbers, - or _');
      if (pin.length < 4) throw new Error('PIN must be at least 4 characters');
      if (this.mode === 'server') return this.adopt(await this.call('register', { pid, pin, profile }));
      const id = pid.toLowerCase();
      if (await idbDo('people', 'readonly', (s) => s.get(id))) throw new Error('That participant code is already registered. Log in instead.');
      const rec = { id, pid, pinHash: await hashPin(pid, pin), profile, progress: { tasks: {}, current: null }, createdAt: new Date().toISOString() };
      await idbDo('people', 'readwrite', (s) => s.put(rec));
      return this.adopt({ pid, token: 'local', profile, progress: rec.progress });
    }

    async login(pid, pin) {
      pid = pid.trim();
      if (this.mode === 'server') { this.pid = pid; return this.adopt(await this.call('login', { pid, pin })); }
      const rec = await idbDo('people', 'readonly', (s) => s.get(pid.toLowerCase()));
      if (!rec) throw new Error('No participant with that code. Check it, or register as new.');
      if (rec.pinHash !== (await hashPin(rec.pid, pin))) throw new Error('Wrong PIN');
      return this.adopt({ pid: rec.pid, token: 'local', profile: rec.profile, progress: rec.progress });
    }

    /* Silent re-login after a reload, using the stored token. */
    async resume() {
      const k = U.store.get(KEEP);
      if (!k || !k.pid || k.mode !== this.mode) return null;
      try {
        if (this.mode === 'server') { this.pid = k.pid; this.token = k.token; return this.adopt(await this.call('resume')); }
        const rec = await idbDo('people', 'readonly', (s) => s.get(k.pid.toLowerCase()));
        return rec ? this.adopt({ pid: rec.pid, token: 'local', profile: rec.profile, progress: rec.progress }) : null;
      } catch (e) {
        this.pid = this.token = null;
        if (e.expired) U.store.remove(KEEP);
        return null;
      }
    }

    async logout() {
      try { if (this.mode === 'server' && this.token) await this.call('logout'); } catch (e) { /* offline: token just expires */ }
      U.store.remove(KEEP);
      this.pid = this.token = this.profile = this.progress = null;
    }

    /* state: serialized canvas or undefined (progress only). */
    async save(taskId, state) {
      if (!this.pid) return;
      if (this.mode === 'server') {
        const body = { progress: this.progress };
        if (state !== undefined) { body.taskId = taskId; body.state = state; }
        return this.call('save', body);
      }
      const id = this.pid.toLowerCase();
      if (state !== undefined) await idbDo('tasks', 'readwrite', (s) => s.put(state, id + '|' + taskId));
      const rec = await idbDo('people', 'readonly', (s) => s.get(id));
      if (rec) { rec.progress = this.progress; await idbDo('people', 'readwrite', (s) => s.put(rec)); }
    }

    /* Page is closing: send progress (task times) without waiting. Canvases rely on autosave. */
    beaconProgress() {
      if (!this.pid || this.mode !== 'server' || !navigator.sendBeacon) return;
      const body = JSON.stringify({ key: this.app.uploader.token, action: 'save', pid: this.pid, token: this.token, progress: this.progress });
      if (body.length < 60000) navigator.sendBeacon(this.apiUrl, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
    }

    async load(taskId) {
      if (!this.pid) return null;
      if (this.mode === 'server') return (await this.call('load', { taskId })).state || null;
      return (await idbDo('tasks', 'readonly', (s) => s.get(this.pid.toLowerCase() + '|' + taskId))) || null;
    }
  }

  MP.Account = Account;
})(window.MP);
