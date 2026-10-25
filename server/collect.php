<?php
// Receives batched session logs from the paint app and stores them as files:
//   <data_dir>/<sessionId>/meta.json, events.ndjson (one event per line), count.txt,
//   questionnaires.json, artifact_<n>.json
// Requests are idempotent: the client sends `offset` (index of its first event) and the server replies
// with `have` (events stored), skipping anything it already has.
declare(strict_types=1);

function respond(int $code, array $body): void {
    http_response_code($code);
    echo json_encode($body);
    exit;
}

$cfgFile = __DIR__ . '/config.php';
header('Content-Type: application/json');
header('Cache-Control: no-store');
if (!is_file($cfgFile)) respond(500, ['ok' => false, 'error' => 'server not configured (config.php missing)']);
$cfg = require $cfgFile;

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = $cfg['allowed_origins'] ?? [];
if ($origin !== '' && (in_array('*', $allowed, true) || in_array($origin, $allowed, true))) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respond(405, ['ok' => false, 'error' => 'POST only']);

$max = (int)($cfg['max_body_bytes'] ?? 5000000);
$raw = file_get_contents('php://input', false, null, 0, $max + 1);
if ($raw === false || strlen($raw) > $max) respond(413, ['ok' => false, 'error' => 'request too large']);
$req = json_decode($raw, true);
if (!is_array($req)) respond(400, ['ok' => false, 'error' => 'invalid JSON']);

if (!hash_equals((string)$cfg['upload_token'], (string)($req['token'] ?? ''))) {
    respond(403, ['ok' => false, 'error' => 'bad token']);
}

$base = rtrim((string)$cfg['data_dir'], '/\\');
if (!is_dir($base) && !@mkdir($base, 0750, true) && !is_dir($base)) {
    respond(500, ['ok' => false, 'error' => 'cannot create data_dir']);
}

if (!empty($req['ping'])) {
    $probe = $base . '/.write-test';
    $ok = @file_put_contents($probe, 'ok') !== false;
    @unlink($probe);
    respond($ok ? 200 : 500, ['ok' => $ok, 'error' => $ok ? null : 'data_dir is not writable']);
}

$sid = (string)($req['sessionId'] ?? '');
if (!preg_match('/^[A-Za-z0-9_-]{1,120}$/', $sid)) respond(400, ['ok' => false, 'error' => 'bad sessionId']);
$events = $req['events'] ?? [];
if (!is_array($events)) respond(400, ['ok' => false, 'error' => 'events must be an array']);
$offset = max(0, (int)($req['offset'] ?? 0));

$dir = $base . '/' . $sid;
if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) respond(500, ['ok' => false, 'error' => 'cannot create session dir']);

$lock = fopen($dir . '/.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX)) respond(500, ['ok' => false, 'error' => 'cannot lock session']);

$countFile = $dir . '/count.txt';
$have = is_file($countFile) ? (int)file_get_contents($countFile) : 0;

if ($offset > $have) respond(200, ['ok' => false, 'error' => 'gap', 'have' => $have]);

$new = array_slice($events, $have - $offset);
if ($new) {
    $lines = '';
    foreach ($new as $e) $lines .= json_encode($e, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
    if (file_put_contents($dir . '/events.ndjson', $lines, FILE_APPEND) === false) respond(500, ['ok' => false, 'error' => 'write failed']);
    $have += count($new);
    file_put_contents($countFile, (string)$have);
}

$flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
if (isset($req['meta']) && is_array($req['meta'])) {
    $meta = $req['meta'];
    $meta['serverReceivedAt'] = gmdate('c');
    file_put_contents($dir . '/meta.json', json_encode($meta, $flags));
}
if (isset($req['questionnaires']) && is_array($req['questionnaires']) && $req['questionnaires']) {
    file_put_contents($dir . '/questionnaires.json', json_encode($req['questionnaires'], $flags));
}
foreach (($req['artifacts'] ?? []) as $a) {
    if (!is_array($a) || !isset($a['ai'])) continue;
    file_put_contents($dir . '/artifact_' . (int)$a['ai'] . '.json', json_encode($a, $flags));
}

respond(200, ['ok' => true, 'have' => $have]);
