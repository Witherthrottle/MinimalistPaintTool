/* Tool registry: ids, clusters, shortcuts, icons. TOOL_IDS order is the one-hot order used by the predictors,
   so append new tools at the end rather than inserting them. */
(function (MP) {
  'use strict';

  MP.CLUSTERS = [
    { id: 'draw', name: 'Draw', tools: ['pencil', 'pen', 'brush', 'airbrush', 'marker'] },
    { id: 'edit', name: 'Edit', tools: ['eraser', 'smudge', 'clone'] },
    { id: 'fill', name: 'Fill & Color', tools: ['bucket', 'gradient', 'eyedropper', 'colorpicker'] },
    { id: 'select', name: 'Select & Transform', tools: ['lasso', 'rectselect', 'move', 'transform'] },
    { id: 'shapes', name: 'Shapes', tools: ['line', 'rect', 'ellipse'] },
  ];

  MP.TOOLS = {
    pencil: { name: 'Pencil', key: 'n', icon: 'M4 20l1.2-4.2L15.5 5.5l3 3L8.2 18.8z M13.5 7.5l3 3' },
    pen: { name: 'Ink Pen', key: 'p', icon: 'M12 2.5l5.5 8L12 21.5 6.5 10.5z M12 10.5v4 M12 21.5v-7' },
    brush: { name: 'Brush', key: 'b', icon: 'M20.5 3.5l-9 9 M18.5 2.5l3 3-8.5 8.5-3-3z M9.5 12.5c-2.5 0-4.5 1.6-4.5 4 0 1.6-1 2.6-2.5 3.5 4 1 8.5-.2 9.5-3.2' },
    airbrush: { name: 'Airbrush', key: 'a', icon: 'M3 15h8l4-3h3v4h-3l-4-1 M6 15v4h3 M18.5 7h.01 M21 5h.01 M21.5 9h.01 M19 3.5h.01' },
    marker: { name: 'Marker', key: 'k', icon: 'M14.5 3.5l6 6-9 9h-6v-6z M5.5 18.5l-2 2.5h5 M11 7l6 6' },
    eraser: { name: 'Eraser', key: 'e', icon: 'M8 20h11 M4.5 15.5l9.5-9.5 5.5 5.5-8.5 8.5H9z M9.5 10.5l5.5 5.5' },
    smudge: { name: 'Smudge', key: 's', icon: 'M9 12V5.5a1.5 1.5 0 013 0V11 M12 10.5v-6a1.5 1.5 0 013 0V11 M15 9.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-5-2.7l-2-3.5a1.5 1.5 0 012.5-1.6L9 15' },
    clone: { name: 'Clone Stamp', key: 'c', icon: 'M6 17h12v4H6z M10 17v-4.5a2.5 2.5 0 01-1.5-2.3 3.5 3.5 0 117 0 2.5 2.5 0 01-1.5 2.3V17' },
    bucket: { name: 'Bucket Fill', key: 'f', icon: 'M5 11.5l6.5-6.5 7 7L12 18.5z M3.5 11.5h15 M19.5 15.5s2 2.4 2 3.9a2 2 0 01-4 0c0-1.5 2-3.9 2-3.9z M9 3l2.5 2' },
    gradient: { name: 'Gradient', key: 'g', icon: 'M4 4h16v16H4z M4 14L14 4 M4 20L20 4 M10 20L20 10' },
    eyedropper: { name: 'Eyedropper', key: 'i', icon: 'M14.5 3.5a2.8 2.8 0 014 4L16 10l-2-2-1.5 1.5L4 18v2h2l8.5-8.5L16 13l-2-2 M12.5 6.5l5 5' },
    colorpicker: { name: 'Color Picker', key: 'y', icon: 'M12 3a9 9 0 000 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0021 9.8C21 6 17 3 12 3z M7.5 11.5h.01 M9.5 7.5h.01 M14.5 7.5h.01 M17 11h.01' },
    lasso: { name: 'Lasso Select', key: 'l', icon: 'M5 14.5C3.7 13.4 3 12 3 10.5 3 6.9 7 4 12 4s9 2.9 9 6.5S17 17 12 17c-1.6 0-3.1-.3-4.4-.8 M7.5 15.5a2 2 0 10.01 0 M7 17.5c0 1.8-.8 3-2.5 3.5' },
    rectselect: { name: 'Rect Select', key: 'm', icon: 'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M11 4h2 M11 20h2 M4 11v2 M20 11v2' },
    move: { name: 'Move', key: 'v', icon: 'M12 3v18 M3 12h18 M9.5 5.5L12 3l2.5 2.5 M9.5 18.5L12 21l2.5-2.5 M5.5 9.5L3 12l2.5 2.5 M18.5 9.5L21 12l-2.5 2.5' },
    transform: { name: 'Transform', key: 't', icon: 'M6 6h12v12H6z M3.5 3.5h4v4h-4z M16.5 3.5h4v4h-4z M3.5 16.5h4v4h-4z M16.5 16.5h4v4h-4z' },
    line: { name: 'Line', key: 'u', icon: 'M5 19L19 5 M4 20h.01 M20 4h.01' },
    rect: { name: 'Rectangle', key: 'r', icon: 'M4 6h16v12H4z' },
    ellipse: { name: 'Ellipse', key: 'o', icon: 'M12 6c5 0 9 2.7 9 6s-4 6-9 6-9-2.7-9-6 4-6 9-6z' },
  };

  MP.TOOL_IDS = MP.CLUSTERS.flatMap((c) => c.tools);
  MP.TOOL_IDS.forEach((id) => {
    MP.TOOLS[id].id = id;
    MP.TOOLS[id].cluster = MP.CLUSTERS.find((c) => c.tools.includes(id)).id;
  });
  MP.KEY_TO_TOOL = {};
  MP.TOOL_IDS.forEach((id) => { MP.KEY_TO_TOOL[MP.TOOLS[id].key] = id; });

  /* Default per-tool settings. Opacity/flow/hardness/strength are 0..1. */
  MP.TOOL_DEFAULTS = {
    pencil: { size: 2, opacity: 1 },
    pen: { size: 6, opacity: 1, pressureSize: true, smoothing: 0.35 },
    brush: { size: 28, opacity: 1, flow: 0.35, hardness: 0.45, pressureSize: true, tilt: true },
    airbrush: { size: 70, opacity: 0.8, flow: 0.45 },
    marker: { size: 18, opacity: 0.5, hardness: 0.85, tilt: true },
    eraser: { size: 28, opacity: 1, hardness: 0.8, pressureSize: true },
    smudge: { size: 34, strength: 0.65, hardness: 0.3 },
    clone: { size: 34, opacity: 1, hardness: 0.55, aligned: true },
    bucket: { opacity: 1, tolerance: 32, contiguous: true, sample: 'layer', grow: 1 },
    gradient: { opacity: 1, gtype: 'linear', gmode: 'fg-bg' },
    eyedropper: { sample: 'merged', returnAfter: false },
    colorpicker: {},
    lasso: {},
    rectselect: {},
    move: {},
    transform: {},
    line: { size: 4, opacity: 1 },
    rect: { size: 4, opacity: 1, style: 'stroke' },
    ellipse: { size: 4, opacity: 1, style: 'stroke' },
  };
})(window.MP);
