/* Deployment config. Fill these in on the server copy so every participant uploads automatically.
   uploadUrl: full URL of server/collect.php, e.g. 'https://example.com/api/collect.php' (empty = upload off).
   uploadToken: must match 'upload_token' in server config.php. It ships to the browser, so it only keeps
   out random junk — it is not a password. Researchers can override both in Study → Researcher settings. */
window.MP = window.MP || {};
window.MP.CONFIG = {
  // 'logging' = data-collection phase: static toolbar only, no predictions or models run, nothing is
  // suggested. 'adaptive' = enables the suggestion conditions, predictors and model tools.
  phase: 'logging',
  // Logging phase only: fixed quick-tools bar shown on the canvas (never changes, no prediction).
  // Picks from it are logged with method 'suggestion' and inSuggestions, so they can be analysed separately.
  // Use [] to hide it.
  staticBar: ['brush', 'eraser', 'eyedropper'],
  uploadUrl: '',
  uploadToken: '',
  uploadIntervalMs: 10000,
};
// Server-only overrides (upload URL/token) live in js/config.local.js, which git ignores so pulls never
// overwrite it. Example: Object.assign(window.MP.CONFIG, { uploadUrl: '...', uploadToken: '...' });
