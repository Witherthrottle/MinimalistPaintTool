<?php
// Researcher download page. Lists uploaded sessions and downloads them in the app's own export format,
// so the files load straight into "Import pooled sessions" and tools/train-gru.js.
declare(strict_types=1);

$cfg = require __DIR__ . '/config.php';
session_start();
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$base = rtrim((string)$cfg['data_dir'], '/\\');
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);

if (isset($_POST['password'])) {
    if (hash_equals((string)$cfg['admin_password'], (string)$_POST['password'])) {
        session_regenerate_id(true);
        $_SESSION['mp_admin'] = true;
    } else {
        usleep(800000);
        $loginError = 'Wrong password';
    }
}
if (isset($_GET['logout'])) { $_SESSION = []; session_destroy(); header('Location: admin.php'); exit; }

if (empty($_SESSION['mp_admin'])) {
    ?><!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Study data</title>
    <style>body{font:15px system-ui;background:#1f2024;color:#e6e7ea;display:grid;place-items:center;height:100vh;margin:0}
    form{background:#2a2b30;padding:24px;border-radius:10px;display:flex;flex-direction:column;gap:10px;width:280px}
    input,button{font:inherit;padding:8px;border-radius:5px;border:1px solid #4a4c55;background:#1b1c20;color:inherit}
    button{background:#2a6fd6;border-color:#3d8bff;cursor:pointer}.err{color:#ff8a80}</style>
    <form method="post"><b>Study data</b><input type="password" name="password" placeholder="Admin password" autofocus>
    <?php if (!empty($loginError)) echo '<span class="err">' . $h($loginError) . '</span>'; ?>
    <button>Sign in</button></form><?php
    exit;
}

function session_ids(string $base): array {
    if (!is_dir($base)) return [];
    $ids = [];
    foreach (scandir($base) as $d) {
        if ($d !== 'participants' && preg_match('/^[A-Za-z0-9_-]{1,120}$/', $d) && is_dir("$base/$d")) $ids[] = $d;
    }
    return $ids;
}

function load_session(string $dir, bool $withArtifacts): array {
    $meta = is_file("$dir/meta.json") ? json_decode(file_get_contents("$dir/meta.json"), true) : [];
    $events = [];
    if (is_file("$dir/events.ndjson")) {
        $fh = fopen("$dir/events.ndjson", 'r');
        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line !== '') $events[] = json_decode($line, true);
        }
        fclose($fh);
    }
    $q = is_file("$dir/questionnaires.json") ? json_decode(file_get_contents("$dir/questionnaires.json"), true) : [];
    $arts = [];
    if ($withArtifacts) {
        $files = glob("$dir/artifact_*.json") ?: [];
        natsort($files);
        foreach ($files as $f) $arts[] = json_decode(file_get_contents($f), true);
    }
    return ['meta' => $meta, 'events' => $events, 'questionnaires' => $q ?: [], 'artifacts' => $arts];
}

$withArt = !empty($_GET['images']);

// ---- participant accounts ----
$pbase = $base . '/participants';
$notice = '';
if (isset($_POST['reset_pid'], $_POST['new_pin'])) {
    $rp = strtolower((string)$_POST['reset_pid']);
    $pin = (string)$_POST['new_pin'];
    $pf = "$pbase/$rp/profile.json";
    if (preg_match('/^[a-z0-9_-]{2,40}$/', $rp) && is_file($pf) && strlen($pin) >= 4) {
        $prof = json_decode(file_get_contents($pf), true);
        $prof['pinHash'] = password_hash($pin, PASSWORD_DEFAULT);
        $prof['failures'] = [];
        file_put_contents($pf, json_encode($prof, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        @unlink("$pbase/$rp/tokens.json");
        $notice = 'PIN reset for ' . $prof['pid'] . '.';
    } else {
        $notice = 'PIN not reset: unknown participant or PIN shorter than 4 characters.';
    }
}
$people = [];
if (is_dir($pbase)) {
    foreach (scandir($pbase) as $d) {
        if (!preg_match('/^[a-z0-9_-]{2,40}$/', $d) || !is_file("$pbase/$d/profile.json")) continue;
        $prof = json_decode(file_get_contents("$pbase/$d/profile.json"), true);
        $prog = is_file("$pbase/$d/progress.json") ? json_decode(file_get_contents("$pbase/$d/progress.json"), true) : [];
        $tasks = $prog['tasks'] ?? [];
        $done = count(array_filter($tasks, fn($t) => ($t['status'] ?? '') === 'done'));
        $started = count(array_filter($tasks, fn($t) => ($t['status'] ?? '') === 'started'));
        $ms = array_sum(array_map(fn($t) => (float)($t['activeMs'] ?? 0), $tasks));
        $people[] = ['pid' => $prof['pid'], 'skill' => $prof['profile']['skill'] ?? '', 'device' => $prof['profile']['device'] ?? '',
            'done' => $done, 'started' => $started, 'mins' => round($ms / 60000), 'last' => @filemtime("$pbase/$d/progress.json") ?: @filemtime("$pbase/$d/profile.json")];
    }
}
usort($people, fn($a, $b) => $b['last'] <=> $a['last']);

if (isset($_GET['download'])) {
    $id = (string)$_GET['download'];
    if (!preg_match('/^[A-Za-z0-9_-]{1,120}$/', $id) || !is_dir("$base/$id")) { http_response_code(404); exit('not found'); }
    header('Content-Type: application/json');
    header('Content-Disposition: attachment; filename="' . $id . '.json"');
    echo json_encode(load_session("$base/$id", $withArt), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if (isset($_GET['all'])) {
    header('Content-Type: application/json');
    header('Content-Disposition: attachment; filename="all_sessions_' . gmdate('Ymd-His') . '.json"');
    // streamed so large studies don't hit the PHP memory limit
    echo '{"format":"minimalist-paint-log/1","sessions":[';
    $first = true;
    foreach (session_ids($base) as $id) {
        if (!$first) echo ',';
        $first = false;
        echo json_encode(load_session("$base/$id", $withArt), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        flush();
    }
    echo ']}';
    exit;
}

$rows = [];
foreach (session_ids($base) as $id) {
    $dir = "$base/$id";
    $meta = is_file("$dir/meta.json") ? json_decode(file_get_contents("$dir/meta.json"), true) : [];
    $rows[] = [
        'id' => $id,
        'pid' => $meta['participantId'] ?? '',
        'cond' => $meta['condition'] ?? '',
        'started' => $meta['startedAt'] ?? '',
        'ended' => $meta['endedAt'] ?? '',
        'events' => is_file("$dir/count.txt") ? (int)file_get_contents("$dir/count.txt") : 0,
        'q' => is_file("$dir/questionnaires.json") ? count(json_decode(file_get_contents("$dir/questionnaires.json"), true) ?: []) : 0,
        'mtime' => @filemtime("$dir/count.txt") ?: @filemtime($dir),
    ];
}
usort($rows, fn($a, $b) => $b['mtime'] <=> $a['mtime']);
?><!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Study data</title>
<style>
body{font:14px system-ui;background:#1f2024;color:#e6e7ea;margin:0;padding:24px}
a{color:#8cb8ff}table{border-collapse:collapse;width:100%;margin-top:14px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #3e4047;white-space:nowrap}
th{color:#9a9ca5;font-weight:600}td.mono{font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
.top{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.muted{color:#9a9ca5}
.live{color:#7ee2a8}
</style>
<div class="top">
  <h2 style="margin:0">Study data</h2>
  <span class="muted"><?= count($rows) ?> session(s)</span>
  <a href="?all=1">Download all (JSON)</a>
  <a href="?all=1&images=1">Download all incl. canvas images</a>
  <span style="flex:1"></span><a href="?logout=1">Sign out</a>
</div>
<?php if ($notice) echo '<p class="live">' . $h($notice) . '</p>'; ?>
<h3>Participants</h3>
<table>
<tr><th>Participant</th><th>Skill</th><th>Device</th><th>Tasks done</th><th>In progress</th><th>Active time</th><th>Last activity</th><th>Reset PIN</th></tr>
<?php foreach ($people as $p): ?>
<tr>
  <td class="mono"><?= $h($p['pid']) ?></td><td><?= $h($p['skill']) ?></td><td><?= $h($p['device']) ?></td>
  <td><?= $p['done'] ?>/12</td><td><?= $p['started'] ?></td><td><?= $p['mins'] ?> min</td>
  <td><?= $h(date('Y-m-d H:i', (int)$p['last'])) ?></td>
  <td><form method="post" style="display:flex;gap:6px"><input type="hidden" name="reset_pid" value="<?= $h($p['pid']) ?>"><input name="new_pin" placeholder="new PIN" style="width:90px;padding:3px 6px;background:#1b1c20;color:inherit;border:1px solid #4a4c55;border-radius:4px"><button style="padding:3px 8px">Set</button></form></td>
</tr>
<?php endforeach; ?>
<?php if (!$people) echo '<tr><td colspan="8" class="muted">No participant accounts yet.</td></tr>'; ?>
</table>
<h3>Sessions (logs)</h3>
<table>
<tr><th>Session</th><th>Participant</th><th>Condition</th><th>Started</th><th>Status</th><th>Events</th><th>Questionnaires</th><th>Last upload</th><th></th></tr>
<?php foreach ($rows as $r): ?>
<tr>
  <td class="mono"><?= $h($r['id']) ?></td>
  <td><?= $h($r['pid']) ?></td>
  <td><?= $h($r['cond']) ?></td>
  <td><?= $h($r['started'] ? date('Y-m-d H:i', strtotime($r['started'])) : '') ?></td>
  <td><?= $r['ended'] ? 'ended' : (time() - $r['mtime'] < 60 ? '<span class="live">● live</span>' : 'open') ?></td>
  <td><?= $r['events'] ?></td>
  <td><?= $r['q'] ?></td>
  <td><?= $h(date('Y-m-d H:i:s', (int)$r['mtime'])) ?></td>
  <td><a href="?download=<?= urlencode($r['id']) ?>">JSON</a> · <a href="?download=<?= urlencode($r['id']) ?>&images=1">+ images</a></td>
</tr>
<?php endforeach; ?>
</table>
