<?php
// Copy to config.php (same folder) and change every value. config.php is never served as text:
// PHP executes it, and the bundled .htaccess denies direct requests to it anyway.
return [
    // Must match uploadToken in js/config.js. It is visible in the browser, so it only keeps out
    // random junk — it is not a secret.
    'upload_token' => 'CHANGE-ME-long-random-string',

    // Password for admin.php (download data). Keep this one secret.
    'admin_password' => 'CHANGE-ME-another-long-random-string',

    // Where session data is written. Put it OUTSIDE public_html so nobody can browse to it.
    // On Hostinger, with this file at public_html/server/config.php (git deploy) or
    // public_html/api/config.php, this resolves to /home/<user>/domains/<domain>/study-data
    'data_dir' => __DIR__ . '/../../study-data',

    // Origins allowed to upload. Same-origin requests always work; list other sites here if the app is
    // hosted elsewhere (e.g. 'https://you.github.io'). '*' allows any origin.
    'allowed_origins' => [],

    // Largest accepted request (bytes). Canvas snapshots are sent one per request, ~0.1–1 MB each.
    'max_body_bytes' => 5000000,
];
