/* Shared helpers. Everything hangs off window.MP so the app runs from file:// without a bundler. */
window.MP = window.MP || {};
(function (MP) {
  'use strict';
  const U = {};

  U.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  U.uid = (n = 6) => {
    let s = '';
    while (s.length < n) s += Math.random().toString(36).slice(2);
    return s.slice(0, n);
  };
  U.now = () => performance.now();
  U.round = (v, d = 2) => {
    if (v == null || !isFinite(v)) return null;
    const m = 10 ** d;
    return Math.round(v * m) / m;
  };

  const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'min', 'max', 'step', 'type']);
  U.el = function (tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (PROPS.has(k)) e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  };

  U.svgIcon = function (d, size = 20) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
    return svg;
  };

  /* ---------- color ---------- */
  U.hexToRgb = (hex) => {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  U.rgbToHex = (r, g, b) =>
    '#' + [r, g, b].map((v) => U.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  U.hsvToRgb = (h, s, v) => {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255 };
  };
  U.rgbToHsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: mx ? d / mx : 0, v: mx };
  };
  U.isHex = (s) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(s).trim());
  U.normHex = (s) => {
    s = String(s).trim();
    if (!s.startsWith('#')) s = '#' + s;
    if (s.length === 4) s = '#' + s.slice(1).split('').map((c) => c + c).join('');
    return s.toLowerCase();
  };
  U.rgba = (hex, a) => {
    const { r, g, b } = U.hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  };

  /* ---------- canvas ---------- */
  U.makeCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  };

  /* ---------- bbox: {x0,y0,x1,y1} in doc px, null = empty ---------- */
  U.bbox = (x0, y0, x1, y1) => ({
    x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1),
  });
  U.bboxUnion = (a, b) => {
    if (!a) return b ? { ...b } : null;
    if (!b) return { ...a };
    return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
  };
  U.bboxAddCircle = (bb, x, y, r) => U.bboxUnion(bb, { x0: x - r, y0: y - r, x1: x + r, y1: y + r });
  U.bboxPad = (b, p) => (b ? { x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p } : null);
  /* Clip to the document and snap to integer pixels. Returns {x,y,w,h} or null. */
  U.bboxClip = (b, W, H) => {
    if (!b) return null;
    const x = U.clamp(Math.floor(b.x0) - 1, 0, W), y = U.clamp(Math.floor(b.y0) - 1, 0, H);
    const x1 = U.clamp(Math.ceil(b.x1) + 1, 0, W), y1 = U.clamp(Math.ceil(b.y1) + 1, 0, H);
    if (x1 <= x || y1 <= y) return null;
    return { x, y, w: x1 - x, h: y1 - y };
  };

  /* ---------- stats ---------- */
  U.stats = (arr) => {
    if (!arr.length) return { min: null, max: null, mean: null, sd: null };
    let mn = Infinity, mx = -Infinity, s = 0;
    for (const v of arr) { if (v < mn) mn = v; if (v > mx) mx = v; s += v; }
    const mean = s / arr.length;
    let ss = 0;
    for (const v of arr) ss += (v - mean) ** 2;
    return { min: U.round(mn, 3), max: U.round(mx, 3), mean: U.round(mean, 3), sd: U.round(Math.sqrt(ss / arr.length), 3) };
  };

  /* ---------- files ---------- */
  U.download = (name, data, mime = 'application/octet-stream') => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  U.pickFiles = (accept, multiple = false) =>
    new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept;
      inp.multiple = multiple;
      inp.onchange = () => resolve(Array.from(inp.files || []));
      inp.click();
    });
  U.readFile = (file, as = 'text') =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      if (as === 'dataURL') r.readAsDataURL(file);
      else r.readAsText(file);
    });
  U.loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  /* ---------- misc ---------- */
  U.debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };
  U.fmtTime = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  U.isTyping = (e) => {
    const t = e.target;
    if (!t || !t.tagName) return false;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
    if (tag === 'INPUT') return !['checkbox', 'radio', 'range', 'button'].includes(t.type);
    return false;
  };
  U.store = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };
  U.dateStamp = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  };

  MP.U = U;
})(window.MP);
