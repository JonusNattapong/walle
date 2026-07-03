/**
 * The dashboard is a single self-contained HTML page (no build step, no
 * frontend framework) served from memory. Pixel office rendered on canvas;
 * data via /api/*, live refresh via SSE.
 */
export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>walle — office floor</title>
<style>
  :root { --bg:#17171d; --panel:#1f1f28; --line:#33333f; --text:#e8e8ee; --dim:#9a9aa8;
          --green:#63f2b2; --amber:#f5c97b; --red:#f07373; --blue:#8fd8ff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:'Segoe UI',system-ui,sans-serif; }
  header { display:flex; align-items:center; gap:14px; padding:12px 20px; border-bottom:1px solid var(--line); }
  header h1 { font-size:16px; margin:0; font-family:monospace; }
  header .badges { display:flex; gap:8px; font-family:monospace; font-size:12px; }
  .badge { padding:2px 8px; border-radius:4px; background:var(--panel); border:1px solid var(--line); }
  main { display:flex; gap:0; height:calc(100vh - 49px); }
  #floor { flex:1; min-width:0; overflow:auto; padding:16px; }
  canvas { image-rendering:pixelated; display:block; margin:0 auto; cursor:pointer; max-width:100%; }
  aside { width:420px; border-left:1px solid var(--line); background:var(--panel); display:flex; flex-direction:column; }
  aside .head { padding:12px 16px; border-bottom:1px solid var(--line); font-family:monospace; font-size:13px; }
  aside .body { flex:1; overflow:auto; padding:12px 16px; font-family:monospace; font-size:12px; line-height:1.7; }
  aside .actions { padding:10px 16px; border-top:1px solid var(--line); display:flex; gap:8px; }
  button { background:#2a2a36; color:var(--text); border:1px solid var(--line); border-radius:6px;
           padding:6px 14px; font-size:12px; cursor:pointer; font-family:monospace; }
  button:hover { background:#343442; }
  button.primary { background:#1d5c40; border-color:#2a8a60; }
  button.danger { background:#5c1d1d; border-color:#8a2a2a; }
  pre.diff { background:#14141a; border:1px solid var(--line); border-radius:6px; padding:10px;
             overflow:auto; font-size:11px; line-height:1.5; }
  pre.diff .add { color:var(--green); } pre.diff .del { color:var(--red); } pre.diff .hunk { color:var(--blue); }
  #newtask { display:flex; gap:8px; padding:10px 16px; border-top:1px solid var(--line); }
  #newtask input { flex:1; background:#14141a; border:1px solid var(--line); border-radius:6px;
                   color:var(--text); padding:8px 10px; font-family:monospace; font-size:12px; }
  .muted { color:var(--dim); }
  .ev { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
</style>
</head>
<body>
<header>
  <h1>walle <span class="muted">— office floor</span></h1>
  <div class="badges" id="badges"></div>
  <div style="margin-left:auto" class="badges"><span class="badge" id="cost-today"></span></div>
</header>
<main>
  <div id="floor"><canvas id="cv"></canvas></div>
  <aside>
    <div class="head" id="panel-title">click a desk to inspect a task</div>
    <div class="body" id="panel-body"><span class="muted">Each desk is one task. Green screen = working, sign = done, raised hand = blocked, smoke = failed.</span></div>
    <div class="actions" id="panel-actions"></div>
    <form id="newtask">
      <input id="prompt" placeholder="new task prompt — runs in an isolated worktree" autocomplete="off">
      <button class="primary" type="submit">walle do</button>
    </form>
  </aside>
</main>
<script>
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const S = 3;              // pixel scale
const DESK_W = 100, DESK_H = 96, COLS_MAX = 6;
let tasks = [], selected = null, frame = 0, deskRects = [];

const STATUS_COLOR = { queued:'#9a9aa8', running:'#63f2b2', verifying:'#f5c97b',
                       done:'#97c459', merged:'#8fd8ff', failed:'#f07373', cancelled:'#666672' };

function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x*S, y*S, w*S, h*S); }

function drawDesk(ox, oy, t, blink) {
  const st = t.status;
  px(ox+4, oy+16, 26, 3, '#7a5c3e');                       // desktop
  px(ox+6, oy+19, 2, 8, '#5c452e'); px(ox+26, oy+19, 2, 8, '#5c452e');
  // monitor
  px(ox+16, oy+7, 12, 8, '#101018');
  const scr = st==='running' ? (blink ? '#63f2b2' : '#3fcf92')
            : st==='verifying' ? (blink ? '#f5c97b' : '#d8a854')
            : st==='done' ? '#97c459' : st==='merged' ? '#8fd8ff' : st==='failed' ? '#e24b4a'
            : st==='cancelled' ? '#3a3a46' : '#2a2a36';
  px(ox+17, oy+8, 10, 6, scr);
  // robot
  const body = st==='failed' ? '#9aa0ac' : '#c9cdd6';
  px(ox+9, oy+6, 4, 3, body);                               // head
  px(ox+10, oy+7, 1, 1, st==='cancelled' ? '#555' : '#2a6bd8'); // eye
  px(ox+8, oy+9, 6, 5, body);                               // torso
  px(ox+9, oy+14, 4, 5, '#8b93a3');                         // base
  if (st==='running' || st==='verifying') px(ox+14, oy+11+(blink?0:1), 3, 1, body); // typing arm
  if (st==='done') { px(ox+5, oy+1, 9, 5, '#63f2b2'); px(ox+8, oy+2, 3, 3, '#0f3d26'); px(ox+9, oy+6, 1, 3, body); }
  if (st==='queued') { if (blink) px(ox+14, oy+3, 2, 2, '#9a9aa8'); px(ox+16, oy+1, 2, 2, '#9a9aa8'); }
  if (t.status==='failed') { if (blink) px(ox+10, oy+2, 2, 2, '#777'); px(ox+12, oy+0, 2, 2, '#999'); }
  if (t._blocked) { px(ox+5, oy+3, 2, 6, body); px(ox+3, oy+0, 5, 4, '#f5c97b'); }
}

function layout() {
  const cols = Math.min(COLS_MAX, Math.max(1, tasks.length));
  const rows = Math.max(1, Math.ceil(tasks.length / cols));
  cv.width = cols * DESK_W + 40; cv.height = rows * DESK_H + 60;
}

function render() {
  ctx.fillStyle = '#232330'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#2c2c38'; ctx.fillRect(0, 0, cv.width, 30);
  deskRects = [];
  const blink = frame % 2 === 0;
  const cols = Math.min(COLS_MAX, Math.max(1, tasks.length));
  tasks.forEach((t, i) => {
    const gx = 20 + (i % cols) * DESK_W, gy = 44 + Math.floor(i / cols) * DESK_H;
    if (selected === t.id) { ctx.strokeStyle = '#8fd8ff'; ctx.lineWidth = 2; ctx.strokeRect(gx-6, gy-8, DESK_W-10, DESK_H-14); }
    drawDesk(Math.floor(gx/S), Math.floor(gy/S), t, blink);
    ctx.fillStyle = '#d9dce4'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
    ctx.fillText(t.id, gx + 42, gy + 66);
    ctx.fillStyle = STATUS_COLOR[t.status] || '#9a9aa8'; ctx.font = '11px monospace';
    const cost = t.costUsd ? ' $' + t.costUsd.toFixed(2) : '';
    ctx.fillText(t.status + cost, gx + 42, gy + 80);
    deskRects.push({ x: gx-6, y: gy-8, w: DESK_W-10, h: DESK_H-14, id: t.id });
  });
  if (!tasks.length) { ctx.fillStyle = '#9a9aa8'; ctx.font = '13px monospace'; ctx.textAlign = 'center';
    ctx.fillText('office is empty — queue a task below', cv.width/2, cv.height/2); }
}

cv.addEventListener('click', (e) => {
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) * (cv.width / r.width), y = (e.clientY - r.top) * (cv.height / r.height);
  const hit = deskRects.find(d => x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h);
  if (hit) { selected = hit.id; openPanel(hit.id); render(); }
});

async function refresh() {
  tasks = await (await fetch('/api/tasks')).json();
  const counts = {};
  let today = 0; const day = new Date().toISOString().slice(0,10);
  for (const t of tasks) { counts[t.status] = (counts[t.status]||0)+1; if (t.createdAt.startsWith(day)) today += t.costUsd; }
  document.getElementById('badges').innerHTML = Object.entries(counts)
    .map(([s,n]) => '<span class="badge" style="color:' + (STATUS_COLOR[s]||'#9a9aa8') + '">' + n + ' ' + s + '</span>').join('');
  document.getElementById('cost-today').textContent = 'today $' + today.toFixed(2);
  layout(); render();
  if (selected) openPanel(selected, true);
}

const EV_ICON = { 'task.started':'&#9654;', 'agent.message':'&#128172;', 'tool.used':'&#128295;',
                  'file.changed':'&#128221;', 'cost.updated':'&#128178;', 'agent.blocked':'&#9208;', 'task.finished':'&#9873;' };

async function openPanel(id, silent) {
  const r = await fetch('/api/tasks/' + id);
  if (!r.ok) return;
  const { task, events } = await r.json();
  task._blocked = events.some(e => e.type === 'agent.blocked') && task.status === 'running';
  document.getElementById('panel-title').textContent = task.id + ' — ' + task.status;
  const rows = events.map(e => {
    const txt = e.type==='agent.message' ? e.text : e.type==='tool.used' ? e.tool
              : e.type==='file.changed' ? e.path : e.type==='cost.updated' ? '$'+e.costUsd.toFixed(4)
              : e.type==='task.finished' ? (e.success ? 'finished' : 'failed: '+(e.error||'')) : e.type;
    return '<div class="ev">' + (EV_ICON[e.type]||'&bull;') + ' ' + esc(String(txt)) + '</div>';
  }).join('');
  document.getElementById('panel-body').innerHTML =
    '<div class="muted">' + esc(task.prompt) + '</div>' +
    '<div class="muted">repo ' + esc(task.repo) + (task.model ? ' &middot; ' + esc(task.model) : '') + '</div><hr style="border-color:#33333f">' +
    rows + (task.error ? '<div style="color:var(--red)">error: ' + esc(task.error) + '</div>' : '') +
    '<div id="diffbox"></div>';
  const actions = document.getElementById('panel-actions');
  actions.innerHTML = '';
  if (task.branch && task.status !== 'merged') actions.appendChild(btn('view diff', '', () => showDiff(id)));
  if (task.status === 'done') actions.appendChild(btn('merge', 'primary', () => act(id, 'merge')));
  if (['queued','running','verifying','done','failed'].includes(task.status))
    actions.appendChild(btn(task.status==='running' ? 'kill' : 'discard', 'danger', () => act(id, 'cancel')));
}

function btn(label, cls, fn) { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; return b; }
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

async function showDiff(id) {
  const r = await fetch('/api/tasks/' + id + '/diff');
  const text = r.ok ? await r.text() : 'diff unavailable';
  document.getElementById('diffbox').innerHTML = '<pre class="diff">' + text.split('\\n').map(l => {
    const e = esc(l);
    if (l.startsWith('+') && !l.startsWith('+++')) return '<span class="add">'+e+'</span>';
    if (l.startsWith('-') && !l.startsWith('---')) return '<span class="del">'+e+'</span>';
    if (l.startsWith('@@')) return '<span class="hunk">'+e+'</span>';
    return e;
  }).join('\\n') + '</pre>';
}

async function act(id, action) {
  const r = await fetch('/api/tasks/' + id + '/' + action, { method: 'POST' });
  if (!r.ok) alert((await r.json()).error);
  refresh();
}

document.getElementById('newtask').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('prompt');
  if (!input.value.trim()) return;
  const r = await fetch('/api/do', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ prompt: input.value.trim() }) });
  if (!r.ok) { alert((await r.json()).error); return; }
  input.value = '';
  refresh();
});

new EventSource('/api/stream').onmessage = () => refresh();
setInterval(() => { frame++; render(); }, 600);
refresh();
</script>
</body>
</html>`;
