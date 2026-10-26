<?php
// Participant accounts and saved task progress for the paint app.
//   <data_dir>/participants/<pid>/profile.json   PIN hash + questionnaire profile
//                                 tokens.json    login tokens -> expiry
//                                 progress.json  per-task status and active time
//                                 tasks/<taskId>.json  saved canvas (layers as PNG data URLs)
// Every request carries `key` (the upload token from config.php). Requests after login also carry
// `pid` + `token`.
declare(strict_types=1);

function out(int $code, array $body): void {
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}
function read_json(string $f) {
    return is_file($f) ? json_decode((string)file_get_contents($f), true) : null;
}
function write_json(string $f, $data): void {
    $tmp = $f . '.tmp' . bin2hex(random_bytes(4));
    if (file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) === false || !rename($tmp, $f)) {
        @unlink($tmp);
        out(500, ['ok' => false, 'error' => 'write failed']);
    }
}

header('Content-Type: application/json');
header('Cache-Control: no-store');
$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) out(500, ['ok' => false, 'error' => 'server not configured (config.php missing)']);
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
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') out(405, ['ok' => false, 'error' => 'POST only']);

$max = (int)($cfg['max_state_bytes'] ?? 30000000);
$raw = file_get_contents('php://input', false, null, 0, $max + 1);
if ($raw === false || strlen($raw) > $max) out(413, ['ok' => false, 'error' => 'request too large']);
$req = json_decode($raw, true);
if (!is_array($req)) out(400, ['ok' => false, 'error' => 'invalid JSON']);
if (!hash_equals((string)$cfg['upload_token'], (string)($req['key'] ?? ''))) out(403, ['ok' => false, 'error' => 'bad key']);

$action = (string)($req['action'] ?? '');
$pid = (string)($req['pid'] ?? '');
if (!preg_match('/^[A-Za-z0-9_-]{2,40}$/', $pid)) out(400, ['ok' => false, 'error' => 'Participant code must be 2–40 letters, numbers, - or _']);

$base = rtrim((string)$cfg['data_dir'], '/\\') . '/participants';
if (!is_dir($base) && !@mkdir($base, 0750, true) && !is_dir($base)) out(500, ['ok' => false, 'error' => 'cannot create data_dir']);
$dir = $base . '/' . strtolower($pid);
$exists = is_file("$dir/profile.json");

if ($exists) {
    $lock = fopen("$dir/.lock", 'c');
    if ($lock) flock($lock, LOCK_EX);
}

function new_token(string $dir): string {
    $tokens = read_json("$dir/tokens.json") ?: [];
    $now = time();
    $tokens = array_filter($tokens, fn($exp) => $exp > $now);
    arsort($tokens);
    $tokens = array_slice($tokens, 0, 9, true);
    $t = bin2hex(random_bytes(24));
    $tokens[$t] = $now + 60 * 60 * 24 * 30;
    write_json("$dir/tokens.json", $tokens);
    return $t;
}
function account_view(string $dir, string $token): array {
    $p = read_json("$dir/profile.json");
    return ['ok' => true, 'token' => $token, 'pid' => $p['pid'], 'profile' => $p['profile'] ?? [], 'progress' => read_json("$dir/progress.json") ?: new stdClass()];
}

if ($action === 'register') {
    if ($exists) out(409, ['ok' => false, 'error' => 'That participant code is already registered. Log in instead.']);
    $pin = (string)($req['pin'] ?? '');
    if (strlen($pin) < 4 || strlen($pin) > 64) out(400, ['ok' => false, 'error' => 'PIN must be at least 4 characters']);
    if (!@mkdir("$dir/tasks", 0750, true) && !is_dir("$dir/tasks")) out(500, ['ok' => false, 'error' => 'cannot create participant']);
    $profile = is_array($req['profile'] ?? null) ? $req['profile'] : [];
    write_json("$dir/profile.json", ['pid' => $pid, 'pinHash' => password_hash($pin, PASSWORD_DEFAULT), 'profile' => $profile, 'createdAt' => gmdate('c'), 'failures' => []]);
    out(200, account_view($dir, new_token($dir)));
}

if (!$exists) out(404, ['ok' => false, 'error' => 'No participant with that code. Check it, or register as new.']);

if ($action === 'login') {
    $p = read_json("$dir/profile.json");
    $now = time();
    $p['failures'] = array_values(array_filter($p['failures'] ?? [], fn($t) => $t > $now - 900));
    if (count($p['failures']) >= 8) out(429, ['ok' => false, 'error' => 'Too many wrong PINs. Wait 15 minutes or ask the researcher.']);
    if (!password_verify((string)($req['pin'] ?? ''), (string)$p['pinHash'])) {
        $p['failures'][] = $now;
        write_json("$dir/profile.json", $p);
        usleep(600000);
        out(401, ['ok' => false, 'error' => 'Wrong PIN']);
    }
    $p['failures'] = [];
    $p['lastLogin'] = gmdate('c');
    write_json("$dir/profile.json", $p);
    out(200, account_view($dir, new_token($dir)));
}

// everything below needs a valid login token
$tokens = read_json("$dir/tokens.json") ?: [];
$token = (string)($req['token'] ?? '');
if ($token === '' || !isset($tokens[$token]) || $tokens[$token] < time()) out(401, ['ok' => false, 'error' => 'session expired', 'expired' => true]);

switch ($action) {
    case 'resume':
        out(200, account_view($dir, $token));

    case 'save':
        if (isset($req['state'])) {
            $tid = (string)($req['taskId'] ?? '');
            if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $tid)) out(400, ['ok' => false, 'error' => 'bad taskId']);
            if (!is_dir("$dir/tasks")) @mkdir("$dir/tasks", 0750, true);
            if ($req['state'] === null) @unlink("$dir/tasks/$tid.json");
            else write_json("$dir/tasks/$tid.json", $req['state']);
        }
        if (isset($req['progress']) && is_array($req['progress'])) write_json("$dir/progress.json", $req['progress']);
        out(200, ['ok' => true]);

    case 'load':
        $tid = (string)($req['taskId'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $tid)) out(400, ['ok' => false, 'error' => 'bad taskId']);
        out(200, ['ok' => true, 'state' => read_json("$dir/tasks/$tid.json")]);

    case 'logout':
        unset($tokens[$token]);
        write_json("$dir/tokens.json", $tokens);
        out(200, ['ok' => true]);
}
out(400, ['ok' => false, 'error' => 'unknown action']);
