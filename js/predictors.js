/* Next-tool prediction. Every predictor implements predict(history, context) -> [{tool, p}] (sorted, sums to 1),
   so the UI never knows which model is behind the suggestions.

   history: tool switches so far, oldest first: [{tool, f}] where f is the feature vector at the moment the
            user left `tool`.
   context: {tool (current), features (now), ...snapshot fields}

   Modes: 'static' (no suggestions shown, but predictions are still logged as shadow data),
          'adaptive-generic' (population model only), 'adaptive-personalized' (model adapted to this participant). */
(function (MP) {
  'use strict';
  const U = MP.U;

  /* ---------- context features (shared with training; order matters) ---------- */
  MP.FEATURES = {
    names: ['layerCount', 'logZoom', 'selectionActive', 'secInTool', 'strokesInTool', 'lastStrokeLen', 'lastPressure', 'undoRecent'],
    vector(c) {
      return [
        Math.min(1, (c.layerCount || 1) / 10),
        Math.max(-1, Math.min(1, Math.log2(c.zoom || 1) / 5)),
        c.selectionActive ? 1 : 0,
        Math.min(1, Math.log1p((c.msInTool || 0) / 1000) / 5),
        Math.min(1, Math.log1p(c.strokesInTool || 0) / 4),
        Math.min(1, Math.log1p(c.lastStrokeLen || 0) / 8),
        c.lastPressure == null ? 0.5 : c.lastPressure,
        c.undoRecent ? 1 : 0,
      ];
    },
  };

  /* Hand-made population prior so generic mode is sensible before any data is collected.
     Replace it by importing pooled logs (Researcher settings → Models). */
  MP.PRIOR = {
    pencil: { eraser: 5, pen: 4, brush: 2, line: 1, lasso: 1, move: 1 },
    pen: { eraser: 5, pencil: 2, brush: 2, bucket: 2, line: 1, marker: 1 },
    brush: { eraser: 5, eyedropper: 4, smudge: 3, airbrush: 2, colorpicker: 2, pen: 1, bucket: 1 },
    airbrush: { brush: 4, eraser: 4, smudge: 2, eyedropper: 2, colorpicker: 1 },
    marker: { pen: 3, eraser: 3, brush: 2, eyedropper: 2, colorpicker: 1 },
    eraser: { brush: 5, pen: 4, pencil: 3, marker: 2, airbrush: 1, smudge: 1 },
    smudge: { brush: 5, airbrush: 2, eraser: 2, eyedropper: 1 },
    clone: { brush: 3, eraser: 3, smudge: 2, lasso: 1 },
    bucket: { brush: 3, pen: 2, eyedropper: 2, gradient: 2, eraser: 2, colorpicker: 2 },
    gradient: { brush: 3, bucket: 2, rectselect: 2, eraser: 1, lasso: 1 },
    eyedropper: { brush: 6, airbrush: 2, pen: 2, bucket: 2, marker: 1 },
    colorpicker: { brush: 5, bucket: 3, pen: 2, airbrush: 2, gradient: 1, marker: 1 },
    lasso: { move: 5, transform: 4, brush: 2, bucket: 2, eraser: 1, gradient: 1 },
    rectselect: { move: 5, transform: 3, bucket: 2, gradient: 2, eraser: 1 },
    move: { transform: 3, lasso: 3, rectselect: 2, brush: 2, eraser: 1 },
    transform: { move: 3, brush: 3, lasso: 2, eraser: 2 },
    line: { rect: 3, ellipse: 3, eraser: 2, pen: 2, bucket: 2 },
    rect: { ellipse: 4, line: 3, bucket: 3, eraser: 1, move: 1 },
    ellipse: { rect: 4, line: 3, bucket: 3, eraser: 1, move: 1 },
  };

  /* ---------- count tables ---------- */
  function emptyCounts() { return { freq: {}, m1: {}, m2: {}, n: 0 }; }
  function addTransition(c, prev, from, to) {
    c.freq[to] = (c.freq[to] || 0) + 1;
    if (from) { (c.m1[from] = c.m1[from] || {})[to] = (c.m1[from][to] || 0) + 1; }
    if (prev && from) { const k = prev + '>' + from; (c.m2[k] = c.m2[k] || {})[to] = (c.m2[k][to] || 0) + 1; }
    c.n++;
  }
  function priorCounts() {
    const c = emptyCounts();
    for (const from in MP.PRIOR) {
      c.m1[from] = { ...MP.PRIOR[from] };
      for (const to in MP.PRIOR[from]) c.freq[to] = (c.freq[to] || 0) + MP.PRIOR[from][to];
    }
    c.builtin = true;
    return c;
  }
  /* Personal counts plus the generic table scaled down to `strength` pseudo-observations per row. */
  function blendRow(personalRow, genericRow, strength) {
    const out = { ...(personalRow || {}) };
    if (genericRow) {
      const tot = Object.values(genericRow).reduce((a, b) => a + b, 0);
      if (tot > 0) for (const k in genericRow) out[k] = (out[k] || 0) + (strength * genericRow[k]) / tot;
    }
    return out;
  }
  const rowTotal = (row) => Object.values(row || {}).reduce((a, b) => a + b, 0);
  const tools = () => MP.TOOL_IDS;
  const normalise = (scores) => {
    const s = scores.reduce((a, b) => a + b.p, 0) || 1;
    return scores.map((x) => ({ tool: x.tool, p: x.p / s })).sort((a, b) => b.p - a.p);
  };

  /* ---------- predictors ---------- */
  class RandomPredictor {
    constructor() { this.id = 'random'; this.label = 'Random'; }
    predict() { return normalise(tools().map((t) => ({ tool: t, p: Math.random() }))); }
  }

  class FrequencyPredictor {
    constructor(counts) { this.id = 'frequency'; this.label = 'Frequency'; this.counts = counts; }
    dist(c) {
      const freq = c().freq;
      return tools().map((t) => ({ tool: t, p: (freq[t] || 0) + 0.5 }));
    }
    predict() { return normalise(this.dist(this.counts)); }
  }

  class MarkovPredictor {
    constructor(counts, order = 1) {
      this.order = order;
      this.id = order === 2 ? 'markov2' : 'markov1';
      this.label = order === 2 ? 'Markov (2nd order)' : 'Markov (1st order)';
      this.counts = counts;
    }
    predict(history, ctx) {
      const c = this.counts();
      const kappa = 3;
      const pf = normalise(tools().map((t) => ({ tool: t, p: (c.freq[t] || 0) + 0.5 })));
      const pfMap = Object.fromEntries(pf.map((x) => [x.tool, x.p]));
      const row1 = c.m1[ctx.tool] || {};
      const n1 = rowTotal(row1);
      const p1 = {};
      for (const t of tools()) p1[t] = ((row1[t] || 0) + kappa * pfMap[t]) / (n1 + kappa);
      if (this.order < 2) return normalise(tools().map((t) => ({ tool: t, p: p1[t] })));
      const prev = history.length ? history[history.length - 1].tool : null;
      const row2 = prev ? c.m2[prev + '>' + ctx.tool] || {} : {};
      const n2 = rowTotal(row2);
      return normalise(tools().map((t) => ({ tool: t, p: ((row2[t] || 0) + kappa * p1[t]) / (n2 + kappa) })));
    }
  }

  class GRUPredictor {
    constructor(engine) { this.id = 'gru'; this.label = 'GRU'; this.engine = engine; }
    predict(history, ctx) {
      const e = this.engine;
      const model = e.gruModel();
      if (!model) return null;
      const seq = history.slice(-50).concat([{ tool: ctx.tool, f: ctx.features }]);
      const personal = e.mode === 'adaptive-personalized' ? e.personalDelta(model) : null;
      const { probs, h } = model.predict(seq, personal && personal.W, personal && personal.B);
      e.lastGru = { h, model };
      return normalise(model.tools.map((t, i) => ({ tool: t, p: probs[i] })).filter((x) => MP.TOOLS[x.tool]));
    }
  }

  /* ---------- engine: owns data sources, picks the predictor, handles personal learning ---------- */
  class PredictionEngine {
    constructor() {
      this.mode = 'adaptive-generic';
      this.predictorId = 'markov2';
      this.participantId = 'anon';
      this.history = [];
      this.generic = U.store.get('mp.generic.counts') || priorCounts();
      this.gruGenericJSON = U.store.get('mp.gru.generic') || MP.DEFAULT_GRU || null;
      this._gru = null;
      this.lastGru = null;
      this.personal = null;
      this.setParticipant('anon');
      const counts = () => this.counts();
      this.predictors = {
        random: new RandomPredictor(),
        frequency: new FrequencyPredictor(counts),
        markov1: new MarkovPredictor(counts, 1),
        markov2: new MarkovPredictor(counts, 2),
        gru: new GRUPredictor(this),
      };
    }

    static get PREDICTORS() {
      return [['random', 'Random'], ['frequency', 'Frequency'], ['markov1', 'Markov (1st order)'], ['markov2', 'Markov (2nd order)'], ['gru', 'GRU']];
    }

    setParticipant(pid) {
      this.participantId = pid || 'anon';
      const p = U.store.get('mp.personal.' + this.participantId);
      this.personal = p && p.counts ? p : { counts: emptyCounts(), gru: null, seqs: [] };
      this._gru = null;
    }
    savePersonal() {
      if (!U.store.set('mp.personal.' + this.participantId, this.personal)) {
        // localStorage full: drop the oldest stored sequences and retry once
        this.personal.seqs = this.personal.seqs.slice(-Math.floor(this.personal.seqs.length / 2));
        U.store.set('mp.personal.' + this.participantId, this.personal);
      }
    }
    resetPersonal() {
      this.personal = { counts: emptyCounts(), gru: null, seqs: [] };
      this._gru = null;
      U.store.remove('mp.personal.' + this.participantId);
    }
    resetSession() { this.history = []; this.lastGru = null; }

    /* Count table for the active mode. Personalized = personal data with a weak generic prior (10 pseudo-obs). */
    counts() {
      if (this.mode !== 'adaptive-personalized') return this.generic;
      const P = this.personal.counts, G = this.generic, out = { freq: {}, m1: {}, m2: P.m2, n: P.n };
      out.freq = blendRow(P.freq, G.freq, 10);
      for (const t of tools()) out.m1[t] = blendRow(P.m1[t], G.m1[t], 10);
      return out;
    }

    gruBaseJSON() {
      if (this.mode === 'adaptive-personalized' && this.personal.gru && this.personal.gru.full) return this.personal.gru.full;
      return this.gruGenericJSON;
    }
    gruModel() {
      const j = this.gruBaseJSON();
      if (!j) return null;
      if (!this._gru || this._gruSrc !== j) {
        try { this._gru = MP.GRU.fromJSON(j); this._gruSrc = j; } catch (e) { console.warn(e); this._gru = null; }
      }
      return this._gru;
    }
    gruSignature(model) { return model.tools.join(',') + '|' + model.H + '|' + (model.meta && model.meta.trainedAt); }
    /* Per-participant output-layer correction, learned online. Reset if the base model changes. */
    personalDelta(model) {
      const sig = this.gruSignature(model);
      let g = this.personal.gru;
      if (!g || g.sig !== sig || !g.W) {
        g = this.personal.gru = { ...(g || {}), sig, W: new Array(model.T * model.H).fill(0), B: new Array(model.T).fill(0), updates: 0 };
      }
      return g;
    }

    setGenericGRU(json) {
      this.gruGenericJSON = json;
      this._gru = null;
      if (json === MP.DEFAULT_GRU || !json) U.store.remove('mp.gru.generic');
      else if (!U.store.set('mp.gru.generic', json)) throw new Error('Could not save GRU weights to browser storage');
    }
    setGenericCounts(counts) {
      this.generic = counts || priorCounts();
      if (counts) U.store.set('mp.generic.counts', counts);
      else U.store.remove('mp.generic.counts');
    }

    /* Ranked list for the current state, current tool removed. */
    rank(ctx) {
      const pred = this.predictors[this.predictorId] || this.predictors.markov2;
      let list = pred.predict(this.history, ctx);
      let used = pred.id, fallback = false;
      if (!list) { list = this.predictors.markov1.predict(this.history, ctx); used = 'markov1'; fallback = true; }
      list = normalise(list.filter((x) => x.tool !== ctx.tool));
      return { list, predictor: used, fallback };
    }

    /* Called on every real tool switch. Personal data accumulates in all modes so a later personalized
       session can use it. */
    observe(from, to, features) {
      if (!from) return;
      const prev = this.history.length ? this.history[this.history.length - 1].tool : null;
      addTransition(this.personal.counts, prev, from, to);
      this.history.push({ tool: from, f: features });

      const seqs = this.personal.seqs;
      if (!seqs.length || seqs[seqs.length - 1].session !== this.sessionId) seqs.push({ session: this.sessionId, items: [] });
      seqs[seqs.length - 1].items.push({ tool: from, f: features.map((v) => Math.round(v * 1000) / 1000), next: to });
      let total = seqs.reduce((a, s) => a + s.items.length, 0);
      while (total > 4000 && seqs.length > 1) total -= seqs.shift().items.length;

      // online SGD on the personal output-layer correction, using the hidden state from the prediction
      // that was made just before this switch
      const lg = this.lastGru;
      if (lg && lg.model && lg.model === this._gru) {
        const model = lg.model, g = this.personalDelta(model), ti = model.toolIndex[to];
        if (ti != null) {
          const W = Float64Array.from(g.W), Bv = Float64Array.from(g.B);
          const probs = MP.GRU.softmax(model.logits(lg.h, W, Bv));
          const lr = 0.08, decay = 1e-3;
          for (let i = 0; i < model.T; i++) {
            const gi = probs[i] - (i === ti ? 1 : 0);
            g.B[i] -= lr * gi;
            for (let j = 0; j < model.H; j++) {
              const k = i * model.H + j;
              g.W[k] -= lr * (gi * lg.h[j] + decay * g.W[k]);
            }
          }
          g.updates++;
        }
      }
      this.lastGru = null;
      this.savePersonal();
    }
  }

  /* ---------- turning logs into training data ---------- */
  MP.sequencesFromRecord = function (rec) {
    const inputs = [], targets = [];
    for (const e of rec.events || []) {
      if (e.type !== 'tool_change' || !e.from || !e.to || !e.features) continue;
      inputs.push({ tool: e.from, f: e.features });
      targets.push(e.to);
    }
    return inputs.length ? [{ inputs, targets, session: rec.meta && rec.meta.sessionId }] : [];
  };
  MP.countsFromRecords = function (recs) {
    const c = emptyCounts();
    for (const rec of recs) {
      let prev = null;
      for (const e of rec.events || []) {
        if (e.type !== 'tool_change' || !e.from || !e.to) continue;
        addTransition(c, prev, e.from, e.to);
        prev = e.from;
      }
    }
    c.sessions = recs.length;
    c.builtAt = new Date().toISOString();
    return c;
  };
  MP.personalSequences = (personal) =>
    (personal.seqs || []).map((s) => ({ inputs: s.items.map((it) => ({ tool: it.tool, f: it.f })), targets: s.items.map((it) => it.next) })).filter((s) => s.inputs.length);

  MP.PredictionEngine = PredictionEngine;
  MP.priorCounts = priorCounts;
})(window.MP);
