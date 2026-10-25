/* Single-layer GRU next-tool model: inference, BPTT training with Adam, JSON (de)serialisation.
   Runs in the browser (window.MP.GRU) and in Node (module.exports) so the same code trains offline.

   Step t:  z = σ(Wz x + Uz h + bz)      r = σ(Wr x + Ur h + br)
            n = tanh(Wn x + r ⊙ (Un h) + bn)
            h' = (1 − z) ⊙ n + z ⊙ h      y = softmax(Wo h' + bo)
   Input x = one-hot(tool) ⊕ context features. */
(function (root) {
  'use strict';

  const sig = (v) => 1 / (1 + Math.exp(-v));
  const PARAMS = ['Wz', 'Uz', 'bz', 'Wr', 'Ur', 'br', 'Wn', 'Un', 'bn', 'Wo', 'bo'];

  function randn() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // y += M (rows×cols) · x
  function matVecAdd(y, M, x, rows, cols) {
    for (let i = 0; i < rows; i++) {
      let s = 0;
      const o = i * cols;
      for (let j = 0; j < cols; j++) s += M[o + j] * x[j];
      y[i] += s;
    }
  }
  // y += Mᵀ · v
  function matTVecAdd(y, M, v, rows, cols) {
    for (let i = 0; i < rows; i++) {
      const vi = v[i];
      if (!vi) continue;
      const o = i * cols;
      for (let j = 0; j < cols; j++) y[j] += M[o + j] * vi;
    }
  }
  // G += a ⊗ b
  function outerAdd(G, a, b, rows, cols) {
    for (let i = 0; i < rows; i++) {
      const ai = a[i];
      if (!ai) continue;
      const o = i * cols;
      for (let j = 0; j < cols; j++) G[o + j] += ai * b[j];
    }
  }
  function softmax(z) {
    let m = -Infinity;
    for (const v of z) if (v > m) m = v;
    let s = 0;
    const out = new Float64Array(z.length);
    for (let i = 0; i < z.length; i++) { out[i] = Math.exp(z[i] - m); s += out[i]; }
    for (let i = 0; i < z.length; i++) out[i] /= s;
    return out;
  }

  class GRU {
    constructor({ tools, featureNames = [], hidden = 32, weights = null, meta = {} }) {
      this.tools = tools.slice();
      this.featureNames = featureNames.slice();
      this.T = tools.length;
      this.F = featureNames.length;
      this.X = this.T + this.F;
      this.H = hidden;
      this.meta = meta;
      const { X, H, T } = this;
      this.shapes = { Wz: [H, X], Uz: [H, H], bz: [H, 1], Wr: [H, X], Ur: [H, H], br: [H, 1], Wn: [H, X], Un: [H, H], bn: [H, 1], Wo: [T, H], bo: [T, 1] };
      this.p = {};
      for (const k of PARAMS) {
        const [r, c] = this.shapes[k];
        const a = new Float64Array(r * c);
        if (weights && weights[k]) a.set(weights[k]);
        else if (c > 1) { const sd = 1 / Math.sqrt(c); for (let i = 0; i < a.length; i++) a[i] = randn() * sd; }
        this.p[k] = a;
      }
      this.toolIndex = {};
      this.tools.forEach((t, i) => { this.toolIndex[t] = i; });
    }

    input(tool, feats) {
      const x = new Float64Array(this.X);
      const ti = this.toolIndex[tool];
      if (ti != null) x[ti] = 1;
      if (feats) for (let j = 0; j < this.F; j++) x[this.T + j] = feats[j] || 0;
      return x;
    }

    step(x, h) {
      const { H, X, p } = this;
      const z = new Float64Array(H), r = new Float64Array(H), uh = new Float64Array(H), n = new Float64Array(H), hn = new Float64Array(H);
      z.set(p.bz); matVecAdd(z, p.Wz, x, H, X); matVecAdd(z, p.Uz, h, H, H);
      r.set(p.br); matVecAdd(r, p.Wr, x, H, X); matVecAdd(r, p.Ur, h, H, H);
      matVecAdd(uh, p.Un, h, H, H);
      n.set(p.bn); matVecAdd(n, p.Wn, x, H, X);
      for (let i = 0; i < H; i++) {
        z[i] = sig(z[i]);
        r[i] = sig(r[i]);
        n[i] = Math.tanh(n[i] + r[i] * uh[i]);
        hn[i] = (1 - z[i]) * n[i] + z[i] * h[i];
      }
      return { z, r, uh, n, h: hn };
    }

    logits(h, extraW = null, extraB = null) {
      const { T, H, p } = this;
      const y = new Float64Array(T);
      y.set(p.bo);
      matVecAdd(y, p.Wo, h, T, H);
      if (extraW) { matVecAdd(y, extraW, h, T, H); for (let i = 0; i < T; i++) y[i] += extraB[i]; }
      return y;
    }

    /* seq: [{tool, f}] oldest→newest. Returns {probs: Float64Array(T), h}. */
    predict(seq, extraW, extraB) {
      let h = new Float64Array(this.H);
      for (const s of seq) h = this.step(this.input(s.tool, s.f), h).h;
      return { probs: softmax(this.logits(h, extraW, extraB)), h };
    }

    /* ---------- training ---------- */
    zeros() {
      const g = {};
      for (const k of PARAMS) g[k] = new Float64Array(this.p[k].length);
      return g;
    }

    /* One sequence: inputs [{tool,f}], targets [toolId]. Accumulates grads into g, returns {loss, n}. */
    backprop(inputs, targets, g) {
      const { H, X, T, p } = this;
      const cache = [];
      let h = new Float64Array(H);
      let loss = 0, count = 0;
      for (let t = 0; t < inputs.length; t++) {
        const x = this.input(inputs[t].tool, inputs[t].f);
        const st = this.step(x, h);
        const probs = softmax(this.logits(st.h));
        const ti = this.toolIndex[targets[t]];
        cache.push({ x, hPrev: h, ...st, probs, ti });
        if (ti != null) { loss -= Math.log(Math.max(probs[ti], 1e-12)); count++; }
        h = st.h;
      }
      let dhNext = new Float64Array(H);
      for (let t = cache.length - 1; t >= 0; t--) {
        const c = cache[t];
        const dh = dhNext.slice();
        if (c.ti != null) {
          const dy = c.probs.slice();
          dy[c.ti] -= 1;
          outerAdd(g.Wo, dy, c.h, T, H);
          for (let i = 0; i < T; i++) g.bo[i] += dy[i];
          matTVecAdd(dh, p.Wo, dy, T, H);
        }
        const dhPrev = new Float64Array(H);
        const daz = new Float64Array(H), dar = new Float64Array(H), dan = new Float64Array(H), duh = new Float64Array(H);
        for (let i = 0; i < H; i++) {
          const dz = dh[i] * (c.hPrev[i] - c.n[i]);
          const dn = dh[i] * (1 - c.z[i]);
          dhPrev[i] += dh[i] * c.z[i];
          dan[i] = dn * (1 - c.n[i] * c.n[i]);
          const dr = dan[i] * c.uh[i];
          duh[i] = dan[i] * c.r[i];
          daz[i] = dz * c.z[i] * (1 - c.z[i]);
          dar[i] = dr * c.r[i] * (1 - c.r[i]);
        }
        outerAdd(g.Wn, dan, c.x, H, X); outerAdd(g.Un, duh, c.hPrev, H, H);
        outerAdd(g.Wz, daz, c.x, H, X); outerAdd(g.Uz, daz, c.hPrev, H, H);
        outerAdd(g.Wr, dar, c.x, H, X); outerAdd(g.Ur, dar, c.hPrev, H, H);
        for (let i = 0; i < H; i++) { g.bn[i] += dan[i]; g.bz[i] += daz[i]; g.br[i] += dar[i]; }
        matTVecAdd(dhPrev, p.Un, duh, H, H);
        matTVecAdd(dhPrev, p.Uz, daz, H, H);
        matTVecAdd(dhPrev, p.Ur, dar, H, H);
        dhNext = dhPrev;
      }
      return { loss, n: count };
    }

    /* sequences: [{inputs, targets}]. Async so the UI can show progress; onProgress(epoch, loss, acc). */
    async train(sequences, { epochs = 30, lr = 0.01, batch = 8, clip = 5, window = 48, l2 = 1e-5, valSplit = 0.15, onProgress, shouldStop } = {}) {
      // chop long sessions into windows so BPTT stays short
      const chunks = [];
      for (const s of sequences) {
        for (let i = 0; i < s.inputs.length; i += window) {
          const inputs = s.inputs.slice(i, i + window), targets = s.targets.slice(i, i + window);
          if (inputs.length) chunks.push({ inputs, targets });
        }
      }
      if (!chunks.length) throw new Error('No training sequences');
      for (let i = chunks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [chunks[i], chunks[j]] = [chunks[j], chunks[i]]; }
      const nVal = chunks.length >= 8 ? Math.max(1, Math.round(chunks.length * valSplit)) : 0;
      const val = chunks.slice(0, nVal), trainSet = chunks.slice(nVal);
      const m = this.zeros(), v = this.zeros();
      let step = 0;
      const b1 = 0.9, b2 = 0.999, eps = 1e-8;
      let history = [];
      for (let ep = 0; ep < epochs; ep++) {
        for (let i = trainSet.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [trainSet[i], trainSet[j]] = [trainSet[j], trainSet[i]]; }
        let totLoss = 0, totN = 0;
        for (let bi = 0; bi < trainSet.length; bi += batch) {
          const g = this.zeros();
          let n = 0;
          for (const ch of trainSet.slice(bi, bi + batch)) {
            const r = this.backprop(ch.inputs, ch.targets, g);
            totLoss += r.loss; totN += r.n; n += r.n;
          }
          if (!n) continue;
          let norm = 0;
          for (const k of PARAMS) for (let i = 0; i < g[k].length; i++) { g[k][i] /= n; norm += g[k][i] * g[k][i]; }
          norm = Math.sqrt(norm);
          const scale = norm > clip ? clip / norm : 1;
          step++;
          for (const k of PARAMS) {
            const P = this.p[k], G = g[k], M = m[k], V = v[k];
            for (let i = 0; i < P.length; i++) {
              const gi = G[i] * scale + l2 * P[i];
              M[i] = b1 * M[i] + (1 - b1) * gi;
              V[i] = b2 * V[i] + (1 - b2) * gi * gi;
              P[i] -= (lr * (M[i] / (1 - b1 ** step))) / (Math.sqrt(V[i] / (1 - b2 ** step)) + eps);
            }
          }
        }
        const ev = this.evaluate(val.length ? val : trainSet);
        const rec = { epoch: ep + 1, trainLoss: totN ? totLoss / totN : null, ...ev };
        history.push(rec);
        if (onProgress) onProgress(rec);
        if (shouldStop && shouldStop()) break;
        await new Promise((r) => setTimeout(r, 0));
      }
      this.meta = { ...this.meta, trainedAt: new Date().toISOString(), sequences: sequences.length, chunks: chunks.length, history };
      return history;
    }

    evaluate(chunks) {
      let loss = 0, n = 0, top1 = 0, top3 = 0;
      for (const ch of chunks) {
        let h = new Float64Array(this.H);
        for (let t = 0; t < ch.inputs.length; t++) {
          h = this.step(this.input(ch.inputs[t].tool, ch.inputs[t].f), h).h;
          const ti = this.toolIndex[ch.targets[t]];
          if (ti == null) continue;
          const probs = softmax(this.logits(h));
          loss -= Math.log(Math.max(probs[ti], 1e-12));
          const better = probs.filter((q, i) => i !== ti && q > probs[ti]).length;
          if (better === 0) top1++;
          if (better < 3) top3++;
          n++;
        }
      }
      return { valLoss: n ? loss / n : null, top1: n ? top1 / n : null, top3: n ? top3 / n : null, n };
    }

    toJSON() {
      const w = {};
      for (const k of PARAMS) w[k] = Array.from(this.p[k], (v) => Math.round(v * 1e6) / 1e6);
      return { format: 'minimalist-paint-gru/1', tools: this.tools, featureNames: this.featureNames, hidden: this.H, meta: this.meta, weights: w };
    }
    static fromJSON(j) {
      if (!j || !j.weights || !j.tools) throw new Error('Not a GRU weights file');
      return new GRU({ tools: j.tools, featureNames: j.featureNames || [], hidden: j.hidden, weights: j.weights, meta: j.meta || {} });
    }
  }

  GRU.softmax = softmax;
  GRU.PARAMS = PARAMS;
  if (typeof module !== 'undefined' && module.exports) module.exports = GRU;
  if (typeof window !== 'undefined') { window.MP = window.MP || {}; window.MP.GRU = GRU; }
})(typeof window !== 'undefined' ? window : globalThis);
