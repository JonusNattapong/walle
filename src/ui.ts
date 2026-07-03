/**
 * Agent-town style dashboard: Phaser 3 renders a top-down pixel office from
 * Kenney CC0 tilesheets (assets/); one character per task, posture/bubble =
 * status. Data via /api/*, live refresh via SSE. Single page, no build step.
 */
export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>walle — agent office</title>
<style>
  :root { --bg:#17171d; --panel:#1f1f28; --line:#33333f; --text:#e8e8ee; --dim:#9a9aa8;
          --green:#63f2b2; --amber:#f5c97b; --red:#f07373; --blue:#8fd8ff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:monospace; overflow:hidden; }
  header { display:flex; align-items:center; gap:14px; padding:8px 16px; border-bottom:1px solid var(--line); height:52px; }
  header h1 { font-size:15px; margin:0; letter-spacing:2px; color:#f5c97b; }
  #agents { display:flex; gap:8px; overflow:hidden; }
  .chip { display:flex; align-items:center; gap:6px; background:var(--panel); border:1px solid var(--line);
          border-radius:6px; padding:3px 10px 3px 4px; font-size:12px; cursor:pointer; }
  .chip:hover { border-color:#555; }
  .chip canvas { width:24px; height:24px; image-rendering:pixelated; }
  .dot { width:7px; height:7px; border-radius:50%; }
  main { display:flex; height:calc(100vh - 53px); }
  #game { flex:1; min-width:0; display:flex; align-items:center; justify-content:center; background:#101014; }
  aside { width:400px; border-left:1px solid var(--line); background:var(--panel); display:flex; flex-direction:column; }
  aside .head { padding:10px 16px; border-bottom:1px solid var(--line); font-size:13px; }
  aside .body { flex:1; overflow:auto; padding:12px 16px; font-size:12px; line-height:1.7; }
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
  <h1>WALLE OFFICE</h1>
  <div id="agents"></div>
  <div style="margin-left:auto; font-size:12px;" class="muted" id="cost-today"></div>
</header>
<main>
  <div id="game"></div>
  <aside>
    <div class="head" id="panel-title">click a character to inspect their task</div>
    <div class="body" id="panel-body"><span class="muted">One character per task. Typing = running, check bubble = done for review, ? = blocked, ! = failed. Empty desk = merged.</span></div>
    <div class="actions" id="panel-actions"></div>
    <form id="newtask">
      <input id="prompt" placeholder="hire an agent — new task prompt" autocomplete="off">
      <button class="primary" type="submit">walle do</button>
    </form>
  </aside>
</main>
<script src="https://cdn.jsdelivr.net/npm/phaser@3.87.0/dist/phaser.min.js"></script>
<script>
const T = 16, MAPW = 26, MAPH = 15;
const F = { WOOD:24, CARPET:132, DESK:139, DESK2:140, CHAIR_D:54, CHAIR_U:55,
            TABLE_L:166, TABLE_M:167, TABLE_R:168, SOFA_L:270, SOFA_R:271,
            PLANT:16, PLANT2:17, SHELF_A:331, SHELF_B:332, SHELF_C:333, FRIDGE:216, STOVE:217 };
const BODIES = [0, 54, 108, 162];
const SHIRTS = [6, 10, 15, 172, 226, 276, 330];
const STATUS_COLOR = { queued:'#9a9aa8', running:'#63f2b2', verifying:'#f5c97b',
                       done:'#97c459', merged:'#8fd8ff', failed:'#f07373', cancelled:'#666672' };
const BUBBLE = { running:null, verifying:'…', queued:'z', done:'\\u2713', failed:'!', blocked:'?' };

// desk slots (tile coords): 4 columns x 3 rows in the work room
const DESKS = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) DESKS.push({ x: 2 + c * 4, y: 3 + r * 4 });

const CALIBRATE = new URLSearchParams(location.search).has('calibrate');
let LAYOUT = null; // { width, height, desks:[{x,y}], lounge:{x,y,w,h} } when office-bg.png is used
let tasks = [], selected = null, scene = null;

function hash(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }

class Office extends Phaser.Scene {
  preload() {
    this.load.spritesheet('in', '/assets/indoor.png', { frameWidth: T, frameHeight: T, spacing: 1 });
    this.load.spritesheet('ch', '/assets/chars.png', { frameWidth: T, frameHeight: T, spacing: 1 });
    if (LAYOUT) this.load.image('bg', '/assets/office-bg.png');
  }
  create() {
    scene = this;
    this.agents = this.add.group();
    this.deskMarks = this.add.group();
    if (LAYOUT) {
      const bg = this.add.image(0, 0, 'bg').setOrigin(0);
      const sc = Math.min((MAPW * T) / bg.width, (MAPH * T) / bg.height);
      bg.setScale(sc);
      this.bgScale = sc;
      if (CALIBRATE) return this.calibrate();
    } else {
      this.drawRoom();
    }
    this.events.on('tasks', () => this.syncAgents());
    if (tasks.length) this.syncAgents();
  }
  // scaled desk positions: pixel coords from layout, or tile-grid defaults
  deskAt(i) {
    if (LAYOUT && LAYOUT.desks[i]) {
      const d = LAYOUT.desks[i];
      return { seatX: d.x * this.bgScale, seatY: d.y * this.bgScale, labelY: d.y * this.bgScale + 12 };
    }
    const d = DESKS[i];
    return { seatX: d.x * T + 8, seatY: (d.y - 1) * T + 6, labelY: d.y * T + 14, tile: d };
  }
  deskCount() { return LAYOUT ? LAYOUT.desks.length : DESKS.length; }
  calibrate() {
    const pts = [];
    const info = this.add.text(4, 4, 'CALIBRATE: click each desk seat in order, then press S to save', { fontSize: '10px', color: '#f5c97b', backgroundColor: '#14141a' });
    this.input.on('pointerdown', (p) => {
      const x = Math.round(p.worldX / this.bgScale), y = Math.round(p.worldY / this.bgScale);
      pts.push({ x, y });
      this.add.circle(p.worldX, p.worldY, 3, 0x63f2b2);
      this.add.text(p.worldX + 4, p.worldY - 4, String(pts.length), { fontSize: '9px', color: '#63f2b2' });
      info.setText('CALIBRATE: ' + pts.length + ' desks marked — press S to save');
    });
    this.input.keyboard.on('keydown-S', async () => {
      const bg = this.textures.get('bg').getSourceImage();
      await fetch('/api/layout', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ width: bg.width, height: bg.height, desks: pts }) });
      info.setText('saved ' + pts.length + ' desks — reloading'); setTimeout(() => location.href = '/', 600);
    });
  }
  drawRoom() {
    const g = this.add.graphics();
    g.fillStyle(0x2a2a36).fillRect(0, 0, MAPW * T, MAPH * T);
    // floors: work room (wood) + lounge (carpet)
    for (let y = 1; y < MAPH - 1; y++) for (let x = 1; x < MAPW - 1; x++) {
      const lounge = x >= 18;
      this.add.image(x * T + 8, y * T + 8, 'in', lounge ? F.CARPET : F.WOOD);
    }
    // walls
    const wall = this.add.graphics();
    wall.fillStyle(0x3a3a46);
    wall.fillRect(0, 0, MAPW * T, T).fillRect(0, 0, T, MAPH * T)
        .fillRect((MAPW - 1) * T, 0, T, MAPH * T).fillRect(0, (MAPH - 1) * T, MAPW * T, T);
    wall.fillRect(17 * T, T, 4, 5 * T).fillRect(17 * T, 9 * T, 4, 5 * T); // room divider w/ door gap
    wall.fillStyle(0x50505e);
    wall.fillRect(0, 0, MAPW * T, 4);
    // shelf strip on top wall of work room
    for (let x = 2; x <= 6; x++) this.add.image(x * T + 8, T + 8, 'in', [F.SHELF_A, F.SHELF_B, F.SHELF_C][x % 3]);
    this.add.image(8 * T + 8, T + 8, 'in', F.FRIDGE);
    this.add.image(9 * T + 8, T + 8, 'in', F.STOVE);
    // lounge furniture
    this.add.image(20 * T + 8, 3 * T + 8, 'in', F.SOFA_L);
    this.add.image(21 * T + 8, 3 * T + 8, 'in', F.SOFA_R);
    this.add.image(23 * T + 8, 2 * T + 8, 'in', F.PLANT);
    this.add.image(19 * T + 8, 2 * T + 8, 'in', F.PLANT2);
    // meeting table bottom-right
    this.add.image(20 * T + 8, 11 * T + 8, 'in', F.TABLE_L);
    this.add.image(21 * T + 8, 11 * T + 8, 'in', F.TABLE_M);
    this.add.image(22 * T + 8, 11 * T + 8, 'in', F.TABLE_R);
    this.add.image(20 * T + 8, 10 * T + 8, 'in', F.CHAIR_D);
    this.add.image(22 * T + 8, 10 * T + 8, 'in', F.CHAIR_D);
    this.add.image(21 * T + 8, 12 * T + 8, 'in', F.CHAIR_U);
    this.add.image(24 * T + 8, 13 * T + 8, 'in', F.PLANT);
    this.add.image(1 * T + 8, 13 * T + 8, 'in', F.PLANT2);
    // desks
    for (const d of DESKS) {
      this.add.image(d.x * T + 8, d.y * T + 8, 'in', F.DESK);
      this.add.image((d.x + 1) * T + 8, d.y * T + 8, 'in', F.DESK2);
      this.add.image(d.x * T + 8, (d.y - 1) * T + 8, 'in', F.CHAIR_U);
    }
  }
  syncAgents() {
    this.agents.clear(true, true);
    this.deskMarks.clear(true, true);
    const visible = tasks.slice(-this.deskCount());
    visible.forEach((t, i) => {
      const dk = this.deskAt(i);
      const seat = { x: dk.seatX, y: dk.seatY };
      if (t.status === 'merged' || t.status === 'cancelled') {
        const mark = this.add.text(seat.x, seat.y + 6, t.status === 'merged' ? '\\u2713' : '\\u00d7',
          { fontFamily: 'monospace', fontSize: '10px', color: STATUS_COLOR[t.status] }).setOrigin(0.5);
        mark.taskId = t.id; mark.setInteractive({ useHandCursor: true });
        mark.on('pointerdown', () => select(t.id));
        this.deskMarks.add(mark);
        this.addLabel(seat.x, dk.labelY, t, this.deskMarks);
        return;
      }
      const c = this.add.container(seat.x, seat.y);
      const body = this.add.image(0, 0, 'ch', BODIES[hash(t.id) % BODIES.length]);
      const shirt = this.add.image(0, 0, 'ch', SHIRTS[hash(t.id + 'x') % SHIRTS.length]);
      c.add([body, shirt]);
      if (t.status === 'failed') { body.setTint(0x999999); shirt.setTint(0x777777); }
      const bubbleChar = t._blocked ? BUBBLE.blocked : BUBBLE[t.status];
      if (bubbleChar) {
        const bg = this.add.circle(9, -11, 6, 0x14141a).setStrokeStyle(1,
          Phaser.Display.Color.HexStringToColor(t._blocked ? '#f5c97b' : STATUS_COLOR[t.status]).color);
        const tx = this.add.text(9, -11, bubbleChar, { fontFamily: 'monospace', fontSize: '9px',
          color: t._blocked ? '#f5c97b' : STATUS_COLOR[t.status] }).setOrigin(0.5);
        c.add([bg, tx]);
      }
      c.setSize(T, T).setInteractive({ useHandCursor: true });
      c.on('pointerdown', () => select(t.id));
      this.agents.add(c);
      if (t.status === 'running' || t.status === 'verifying') {
        this.tweens.add({ targets: c, y: seat.y - 1, duration: 260, yoyo: true, repeat: -1 });
      }
      if (t.status === 'queued') this.wander(c, seat);
      if (t.status === 'done') {
        this.tweens.add({ targets: c.list[c.list.length - 1], y: -14, duration: 420, yoyo: true, repeat: -1 });
      }
      this.addLabel(seat.x, dk.labelY, t, this.agents);
      if (selected === t.id) {
        const ring = this.add.rectangle(seat.x + 4, seat.y + 8, 42, 44).setStrokeStyle(1, 0x8fd8ff);
        this.deskMarks.add(ring);
      }
    });
  }
  addLabel(x, y, t, group) {
    const label = this.add.text(x + 8, y, t.id, { fontFamily: 'monospace', fontSize: '8px',
      color: '#d9dce4', backgroundColor: '#14141acc', padding: { x: 2, y: 1 } }).setOrigin(0.5, 0);
    const st = this.add.text(x + 8, y + 10, t.status + (t.costUsd ? ' $' + t.costUsd.toFixed(2) : ''),
      { fontFamily: 'monospace', fontSize: '8px', color: STATUS_COLOR[t.status] }).setOrigin(0.5, 0);
    group.add(label); group.add(st);
  }
  wander(c, home) {
    const hop = () => {
      if (!c.active) return;
      const nx = Phaser.Math.Clamp(home.x + Phaser.Math.Between(-20, 20), 24, (MAPW - 2) * T);
      const ny = Phaser.Math.Clamp(home.y + Phaser.Math.Between(-14, 14), 24, (MAPH - 2) * T);
      this.tweens.add({ targets: c, x: nx, y: ny, duration: 700, onComplete: () => this.time.delayedCall(Phaser.Math.Between(600, 1800), hop) });
    };
    hop();
  }
}

(async () => {
  try {
    const r = await fetch('/assets/office-layout.json');
    if (r.ok) LAYOUT = await r.json();
    else if (CALIBRATE && (await fetch('/assets/office-bg.png', { method: 'HEAD' })).ok) {
      LAYOUT = { desks: [] }; // bg exists but not calibrated yet
    }
  } catch {}
  new Phaser.Game({
    type: Phaser.AUTO, parent: 'game', pixelArt: true, backgroundColor: '#101014',
    width: MAPW * T, height: MAPH * T,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: Office,
  });
})();

function select(id) { selected = id; openPanel(id); scene && scene.events.emit('tasks'); }

function chipAvatar(t) {
  const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
  const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
  const img = new Image(); img.src = '/assets/chars.png';
  img.onload = () => {
    const draw = (idx) => { const c = idx % 54, r = Math.floor(idx / 54); x.drawImage(img, c * 17, r * 17, 16, 16, 0, 0, 16, 16); };
    draw(BODIES[hash(t.id) % BODIES.length]); draw(SHIRTS[hash(t.id + 'x') % SHIRTS.length]);
  };
  return cv;
}

async function refresh() {
  tasks = await (await fetch('/api/tasks')).json();
  await Promise.all(tasks.filter(t => t.status === 'running').map(async (t) => {
    const r = await fetch('/api/tasks/' + t.id);
    if (r.ok) { const { events } = await r.json(); t._blocked = events.some(e => e.type === 'agent.blocked'); }
  }));
  const bar = document.getElementById('agents');
  bar.innerHTML = '';
  for (const t of tasks.slice(-6).reverse()) {
    const chip = document.createElement('div'); chip.className = 'chip';
    chip.appendChild(chipAvatar(t));
    const name = document.createElement('span'); name.textContent = t.id; chip.appendChild(name);
    const dot = document.createElement('span'); dot.className = 'dot';
    dot.style.background = STATUS_COLOR[t.status] || '#9a9aa8'; chip.appendChild(dot);
    chip.onclick = () => select(t.id);
    bar.appendChild(chip);
  }
  let today = 0; const day = new Date().toISOString().slice(0, 10);
  for (const t of tasks) if (t.createdAt.startsWith(day)) today += t.costUsd;
  document.getElementById('cost-today').textContent = 'today $' + today.toFixed(2);
  scene && scene.events.emit('tasks');
  if (selected) openPanel(selected, true);
}

const EV_ICON = { 'task.started':'&#9654;', 'agent.message':'&#128172;', 'tool.used':'&#128295;',
                  'file.changed':'&#128221;', 'cost.updated':'&#128178;', 'agent.blocked':'&#9208;', 'task.finished':'&#9873;' };

async function openPanel(id, silent) {
  const r = await fetch('/api/tasks/' + id);
  if (!r.ok) return;
  const { task, events } = await r.json();
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
refresh();
</script>
</body>
</html>`;
