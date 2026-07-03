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
  :root {
    --bg:#0f0f17; --panel:#181825; --panel2:#1e1e2e; --line:#2a2a3e; --text:#e2e2f0;
    --dim:#7c7c96; --green:#4ade80; --amber:#fbbf24; --red:#f87171; --blue:#60a5fa;
    --accent:#a78bfa; --radius:8px; --radius-sm:6px; --transition:180ms ease;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:'Inter',system-ui,-apple-system,sans-serif; overflow:hidden; }

  /* ── TOP BAR ───────────────────────────────────────────── */
  header {
    display:flex; align-items:center; gap:0; padding:0 20px;
    border-bottom:1px solid var(--line); height:56px;
    background:linear-gradient(180deg, #1c1c2a 0%, var(--panel) 100%);
    backdrop-filter:blur(12px);
  }
  header .logo {
    display:flex; align-items:center; gap:10px; flex-shrink:0; margin-right:24px;
  }
  header .logo-icon {
    width:32px; height:32px; border-radius:var(--radius-sm);
    background:linear-gradient(135deg, var(--accent), #7c3aed);
    display:flex; align-items:center; justify-content:center;
    font-size:16px; color:#fff; font-weight:700;
  }
  header .logo h1 {
    font-size:15px; font-weight:700; margin:0; letter-spacing:3px;
    background:linear-gradient(90deg, #e2e2f0, #a5b4fc);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent;
  }
  #agents { display:flex; gap:6px; flex:1; overflow-x:auto; padding:0 4px; }
  #agents::-webkit-scrollbar { height:3px; }
  #agents::-webkit-scrollbar-thumb { background:var(--line); border-radius:3px; }
  .chip {
    display:flex; align-items:center; gap:7px;
    background:rgba(30,30,46,0.8); border:1px solid var(--line);
    border-radius:20px; padding:4px 12px 4px 5px;
    font-size:11px; font-weight:500; cursor:pointer;
    white-space:nowrap; transition:all var(--transition);
  }
  .chip:hover { background:rgba(40,40,60,0.9); border-color:var(--accent); transform:translateY(-1px); }
  .chip.active { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
  .chip canvas { width:22px; height:22px; image-rendering:pixelated; border-radius:50%; }
  .chip .dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
  .top-right {
    display:flex; align-items:center; gap:14px; flex-shrink:0; margin-left:16px;
  }
  .stat-pill {
    display:flex; align-items:center; gap:6px; font-size:11px;
    background:rgba(30,30,46,0.6); border:1px solid var(--line);
    border-radius:20px; padding:4px 10px;
  }
  .stat-pill .stat-num { font-weight:700; color:var(--amber); }
  .stat-pill .stat-label { color:var(--dim); font-size:10px; }
  .filter-pills { display:flex; gap:4px; }
  .filter-pill {
    background:transparent; border:1px solid transparent;
    color:var(--dim); padding:3px 9px; border-radius:14px;
    font-size:10px; font-weight:500; cursor:pointer; transition:all var(--transition);
  }
  .filter-pill:hover { color:var(--text); border-color:var(--line); }
  .filter-pill.on { color:var(--text); background:rgba(30,30,46,0.8); border-color:var(--line); }

  /* ── MAIN LAYOUT ───────────────────────────────────────── */
  main { display:flex; height:calc(100vh - 56px); }
  #game { flex:1; min-width:0; display:flex; align-items:center; justify-content:center; background:#0a0a14; }

  /* ── MODAL ──────────────────────────────────────────────── */
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(5, 5, 10, 0.7);
    backdrop-filter: blur(12px); display: none; z-index: 1000;
    align-items: center; justify-content: center; opacity: 0;
    transition: opacity 0.3s ease;
  }
  .modal-backdrop.open { opacity: 1; display: flex; }
  .modal-card {
    background: rgba(20, 20, 32, 0.95);
    border: 1px solid rgba(167, 139, 250, 0.2);
    border-radius: var(--radius); width: 600px; max-width: 90%;
    max-height: 85vh; display: flex; flex-direction: column;
    box-shadow: 0 25px 60px rgba(0,0,0,0.6);
    transform: translateY(-20px); transition: transform 0.3s ease;
  }
  .modal-backdrop.open .modal-card { transform: translateY(0); }
  .modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 24px 16px; border-bottom: 1px solid var(--line);
  }
  .modal-header h2 {
    font-size: 18px; font-weight: 800; margin: 0;
    background: linear-gradient(135deg, #fff 30%, #a78bfa 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .modal-body {
    flex: 1; overflow-y: auto; padding: 24px; display: flex;
    flex-direction: column; gap: 20px;
  }
  .modal-body::-webkit-scrollbar { width: 4px; }
  .modal-body::-webkit-scrollbar-thumb { background: var(--line); border-radius: 3px; }
  .modal-footer {
    display: flex; gap: 12px; justify-content: flex-end;
    padding: 16px 24px 20px; border-top: 1px solid var(--line);
    background: rgba(12, 12, 20, 0.4);
  }
  .modal-card .settings-section {
    background: rgba(30, 30, 46, 0.4); border: 1px solid rgba(255,255,255,0.03);
    border-radius: var(--radius-sm); padding: 18px; display: flex;
    flex-direction: column; gap: 14px;
  }
  .modal-card .settings-section h3 {
    font-size: 11px; font-weight: 700; margin: 0;
    text-transform: uppercase; letter-spacing: 1px; color: var(--accent);
  }

  /* ── SIDEBAR ───────────────────────────────────────────── */
  aside {
    position: absolute; right: 24px; top: 24px; bottom: 24px;
    width: 420px; border: 1px solid var(--line); border-radius: var(--radius);
    background: rgba(20, 20, 32, 0.85);
    backdrop-filter: blur(20px);
    display: flex; flex-direction: column;
    box-shadow: 0 16px 40px rgba(0,0,0,0.5);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 100;
  }
  aside.collapsed {
    transform: translateX(calc(100% + 44px));
  }

  .sidebar-toggle {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 48px; cursor: pointer; color: var(--dim);
    font-size: 11px; flex-shrink: 0;
    transition: all var(--transition); user-select: none;
    position: absolute; left: -32px; top: 50%; transform: translateY(-50%);
    z-index: 10; background: rgba(20, 20, 32, 0.85);
    border: 1px solid var(--line); border-right: none;
    border-radius: 10px 0 0 10px;
    box-shadow: -4px 0 12px rgba(0,0,0,0.15);
    backdrop-filter: blur(20px);
  }
  .sidebar-toggle:hover { color: var(--text); background: rgba(30, 30, 46, 0.95); }

  /* ── PANEL HEADER ──────────────────────────────────────── */
  aside .panel-header {
    display:flex; align-items:center; justify-content:space-between;
    padding:20px 20px 14px;
    border-bottom:0;
  }
  #panel-title {
    font-size:14px; font-weight:700; color:var(--text);
    display:flex; align-items:center; gap:10px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  #panel-title .task-id-text { font-family:'JetBrains Mono','Fira Code',monospace; letter-spacing:-0.5px; }
  #panel-title .status-badge {
    display:inline-flex; align-items:center; gap:4px;
    padding:3px 10px; border-radius:12px;
    font-size:10px; font-weight:600; letter-spacing:0.5px; text-transform:uppercase;
    position:relative; overflow:hidden;
  }
  .status-badge.queued { background:rgba(124,124,150,0.15); color:var(--dim); }
  .status-badge.running { background:rgba(74,222,128,0.12); color:var(--green); }
  .status-badge.running::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg,transparent,rgba(74,222,128,0.1),transparent); animation:shimmer 2s infinite; }
  .status-badge.verifying { background:rgba(251,191,36,0.12); color:var(--amber); }
  .status-badge.verifying::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg,transparent,rgba(251,191,36,0.1),transparent); animation:shimmer 1.5s infinite; }
  .status-badge.done { background:rgba(151,196,89,0.12); color:#97c459; }
  .status-badge.merged { background:rgba(96,165,250,0.12); color:var(--blue); }
  .status-badge.failed { background:rgba(248,113,113,0.12); color:var(--red); }
  .status-badge.cancelled { background:rgba(102,102,114,0.12); color:#666672; }
  @keyframes shimmer { 0% { transform:translateX(-100%); } 100% { transform:translateX(100%); } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
  .status-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }

  /* ── TABS ───────────────────────────────────────────────── */
  .tabs {
    display:flex; gap:8px; padding:0 20px;
    border-bottom:1px solid var(--line);
    background: transparent;
  }
  .tab {
    padding:12px 18px; font-size:12px; font-weight:600;
    color:var(--dim); cursor:pointer;
    border-bottom:3px solid transparent;
    transition:all var(--transition);
    display:flex; align-items:center; gap:6px;
  }
  .tab .tab-icon { font-size:14px; opacity:0.6; transition:opacity var(--transition); }
  .tab:hover { color:var(--text); }
  .tab:hover .tab-icon { opacity:0.9; }
  .tab.active { color:var(--accent); border-bottom-color:var(--accent); }
  .tab.active .tab-icon { opacity:1; }

  /* ── PANEL BODY ────────────────────────────────────────── */
  .body { flex:1; overflow-y:auto; overflow-x:hidden; padding:16px 16px 20px; font-size:12px; line-height:1.7; }
  .body::-webkit-scrollbar { width:4px; }
  .body::-webkit-scrollbar-thumb { background:var(--line); border-radius:3px; }

  /* section label */
  .sec-label {
    font-size:9px; font-weight:700; letter-spacing:1.5px; color:var(--dim);
    text-transform:uppercase; margin:16px 0 8px; display:flex; align-items:center; gap:8px;
  }
  .sec-label::after { content:''; flex:1; height:1px; background:var(--line); }
  .sec-label:first-child { margin-top:0; }

  /* empty state */
  .empty-state {
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    height:100%; text-align:center; gap:16px; padding:48px 24px;
    background: radial-gradient(circle at center, rgba(167,139,250,0.06) 0%, transparent 70%);
  }
  .empty-state .icon {
    width:72px; height:72px; border-radius:22px;
    background: linear-gradient(135deg, rgba(167,139,250,0.2) 0%, rgba(96,165,250,0.1) 100%);
    border: 1px solid rgba(167,139,250,0.25);
    display:flex; align-items:center; justify-content:center;
    font-size:32px; margin-bottom:8px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.35);
    position: relative;
  }
  .empty-state .icon::after {
    content: ''; position: absolute; inset: -4px; border-radius: 26px;
    border: 1px solid rgba(167,139,250,0.15);
    animation: pulse 2.5s infinite;
  }
  .empty-state h3 { margin:0; font-size:16px; font-weight:700; color:var(--text); letter-spacing: 0.5px; }
  .empty-state p { margin:0; font-size:12px; color:var(--dim); line-height:1.6; max-width:280px; }
  .empty-state .hint-grid {
    display:grid; grid-template-columns:1fr 1fr; gap:12px; width:100%; max-width:320px; margin-top:16px;
  }
  .hint-item {
    background: rgba(30,30,46,0.45); border:1px solid rgba(255,255,255,0.05); border-radius:var(--radius);
    padding:14px 16px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:8px;
    transition: all var(--transition);
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  }
  .hint-item:hover {
    background: rgba(30,30,46,0.65); border-color: rgba(167,139,250,0.2);
    transform: translateY(-2px);
  }
  .hint-item .hint-num {
    font-size:14px; font-weight:800; width:28px; height:28px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    box-shadow: 0 4px 10px rgba(0,0,0,0.2);
  }
  .hint-item.h-done .hint-num { background:rgba(74,222,128,0.15); color:var(--green); border: 1px solid rgba(74,222,128,0.3); }
  .hint-item.h-working .hint-num { background:rgba(96,165,250,0.15); color:var(--blue); border: 1px solid rgba(96,165,250,0.3); }
  .hint-item.h-failed .hint-num { background:rgba(248,113,113,0.15); color:var(--red); border: 1px solid rgba(248,113,113,0.3); }
  .hint-item.h-merged .hint-num { background:rgba(167,139,250,0.15); color:var(--accent); border: 1px solid rgba(167,139,250,0.3); }
  .hint-item .hint-label { font-size:11px; font-weight:500; color:var(--dim); }

  /* prompt card */
  .prompt-card {
    background:var(--panel2); border:1px solid var(--line);
    border-radius:var(--radius); padding:12px 14px; margin-bottom:14px;
    position:relative; overflow:hidden;
  }
  .prompt-card::before {
    content:''; position:absolute; left:0; top:0; bottom:0;
    width:3px; background:var(--accent); border-radius:0 2px 2px 0;
    opacity:0.4;
  }
  .prompt-card .prompt-text { font-size:12px; color:var(--text); word-break:break-word; font-weight:500; }
  .prompt-card .meta-row {
    display:flex; flex-wrap:wrap; gap:14px; margin-top:8px; font-size:10px; color:var(--dim);
  }
  .prompt-card .meta-row span { display:flex; align-items:center; gap:4px; }

  /* timeline */
  .timeline { position:relative; padding-left:24px; }
  .timeline::before {
    content:''; position:absolute; left:8px; top:4px; bottom:4px;
    width:1.5px; background:linear-gradient(180deg, var(--line), var(--accent), var(--line));
    border-radius:1px;
  }
  .ev {
    position:relative; padding:5px 0 5px 18px;
    font-size:11px; line-height:1.6; display:flex; align-items:flex-start; gap:8px;
  }
  .ev::before {
    content:''; position:absolute; left:-17px; top:11px;
    width:8px; height:8px; border-radius:50%;
    background:var(--line); border:2px solid var(--panel);
    box-shadow:0 0 0 2px var(--panel);
  }
  .ev.msg::before { background:var(--blue); box-shadow:0 0 6px rgba(96,165,250,0.3); }
  .ev.tool::before { background:var(--amber); box-shadow:0 0 6px rgba(251,191,36,0.3); }
  .ev.file::before { background:var(--green); box-shadow:0 0 6px rgba(74,222,128,0.3); }
  .ev.err::before { background:var(--red); box-shadow:0 0 6px rgba(248,113,113,0.3); }
  .ev-icon { font-size:12px; flex-shrink:0; width:18px; text-align:center; }
  .ev-text { flex:1; min-width:0; word-break:break-word; }

  /* diff */
  pre.diff {
    background:linear-gradient(180deg, #0c0c18, #0a0a14);
    border:1px solid var(--line); border-radius:var(--radius);
    padding:14px; overflow:auto; font-size:11px; line-height:1.6;
    font-family:'JetBrains Mono','Fira Code',monospace;
  }
  pre.diff .add { color:var(--green); } pre.diff .del { color:var(--red); } pre.diff .hunk { color:var(--blue); }

  /* cost bar */
  .cost-bar {
    display:flex; align-items:center; justify-content:space-between;
    padding:10px 14px; background:linear-gradient(135deg, rgba(251,191,36,0.06), rgba(251,191,36,0.02));
    border:1px solid rgba(251,191,36,0.12); border-radius:var(--radius-sm);
    margin-bottom:14px; font-size:11px;
  }
  .cost-bar .cost-val { font-weight:700; color:var(--amber); font-size:15px; }
  .cost-bar .cost-meta { color:var(--dim); font-size:10px; }

  /* stat grid */
  .stat-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:14px; }
  .stat-card {
    background:rgba(30,30,46,0.5); border:1px solid var(--line);
    border-radius:var(--radius-sm); padding:10px 12px; transition:border-color var(--transition);
  }
  .stat-card:hover { border-color:rgba(167,139,250,0.3); }
  .stat-card .stat-num { font-size:20px; font-weight:700; color:var(--text); }
  .stat-card .stat-label { font-size:10px; color:var(--dim); margin-top:2px; text-transform:uppercase; letter-spacing:0.5px; }

  /* file list */
  .file-list { margin-top:2px; }
  .file-item {
    display:flex; align-items:center; gap:8px; padding:6px 10px;
    font-size:11px; border-radius:var(--radius-sm); cursor:default;
    transition:background var(--transition);
  }
  .file-item:hover { background:rgba(30,30,46,0.5); }
  .file-item .file-icon { color:var(--green); font-size:12px; }
  .file-item .file-path { color:var(--text); font-family:'JetBrains Mono',monospace; font-size:10px; }
  .file-item .file-lines { margin-left:auto; color:var(--dim); font-size:10px; }

  /* error box */
  .error-box {
    margin-top:12px; padding:10px 14px;
    background:linear-gradient(135deg, rgba(248,113,113,0.06), rgba(248,113,113,0.02));
    border:1px solid rgba(248,113,113,0.15); border-radius:var(--radius-sm);
    font-size:11px; color:var(--red); line-height:1.5;
    display:flex; align-items:flex-start; gap:8px;
  }
  .error-box::before { content:'!'; font-weight:700; font-size:13px; flex-shrink:0; width:18px; height:18px;
    background:rgba(248,113,113,0.15); border-radius:50%; display:flex; align-items:center; justify-content:center; }

  /* ── ACTIONS ────────────────────────────────────────────── */
  .actions {
    padding:12px 16px; border-top:1px solid var(--line);
    display:flex; gap:8px; flex-wrap:wrap;
    background:linear-gradient(180deg, transparent, rgba(20,20,32,0.5));
  }
  button {
    background:var(--panel2); color:var(--text); border:1px solid var(--line);
    border-radius:var(--radius-sm); padding:7px 16px;
    font-size:11px; font-weight:500; cursor:pointer;
    font-family:inherit; transition:all var(--transition);
    display:flex; align-items:center; gap:5px;
  }
  button:hover { background:#2a2a42; border-color:#444; transform:translateY(-1px); }
  button:active { transform:translateY(0); }
  button.primary { background:linear-gradient(135deg, #1d5c40, #166534); border-color:#2a8a60; color:#fff; box-shadow:0 2px 8px rgba(26,138,96,0.2); }
  button.primary:hover { background:linear-gradient(135deg, #256a4a, #1a7a3e); box-shadow:0 4px 12px rgba(26,138,96,0.3); }
  button.danger { background:linear-gradient(135deg, #5c1d1d, #7f1d1d); border-color:#8a2a2a; color:#fecaca; }
  button.danger:hover { background:linear-gradient(135deg, #6e2626, #8f2626); }
  button.ghost { background:transparent; border-color:transparent; color:var(--dim); padding:7px 10px; }
  button.ghost:hover { color:var(--text); background:rgba(30,30,46,0.6); transform:none; }

  /* ── RIGHT TASK LIST ────────────────────────────────────── */
  .right-task-list {
    position: fixed; right: 24px; top: 80px; bottom: 120px;
    width: 280px; z-index: 80;
    background: rgba(20, 20, 32, 0.7);
    backdrop-filter: blur(20px);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    display: flex; flex-direction: column;
    box-shadow: 0 16px 40px rgba(0,0,0,0.4);
    transition: all var(--transition);
  }
  .task-list-header {
    padding: 14px 16px; border-bottom: 1px solid var(--line);
    display: flex; align-items: center; justify-content: space-between;
  }
  .task-list-header h3 {
    margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1px; color: var(--text);
  }
  .task-list-header .count-badge {
    background: var(--accent); color: #fff; font-size: 10px; font-weight: 700;
    padding: 2px 8px; border-radius: 10px;
  }
  .task-list-body {
    flex: 1; overflow-y: auto; padding: 8px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .task-list-body::-webkit-scrollbar { width: 4px; }
  .task-list-body::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }
  
  .task-item-card {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: var(--radius-sm);
    padding: 10px 12px; cursor: pointer;
    transition: all var(--transition);
    display: flex; flex-direction: column; gap: 4px;
  }
  .task-item-card:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(167, 139, 250, 0.2);
    transform: translateY(-1px);
  }
  .task-item-card.active {
    background: rgba(167, 139, 250, 0.08);
    border-color: var(--accent);
  }
  .task-item-meta {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 10px; font-weight: 600;
  }
  .task-item-id { font-family: monospace; color: var(--dim); }
  .task-item-status {
    display: flex; align-items: center; gap: 4px; text-transform: uppercase;
    font-size: 8px;
  }
  .task-item-prompt {
    font-size: 11px; color: var(--text); line-height: 1.4;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* ── BOTTOM INPUT ───────────────────────────────────────── */
  .bottom-input-container {
    position: fixed; bottom: 24px; left: 24px;
    width: 480px; max-width: calc(100% - 48px); z-index: 90;
    background: rgba(20, 20, 32, 0.85);
    backdrop-filter: blur(20px);
    border: 1px solid var(--line);
    border-radius: 30px;
    padding: 6px 12px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
    display: flex; align-items: center;
  }
  #newtask {
    display: flex; width: 100%; align-items: center; gap: 8px;
  }
  #newtask input {
    flex: 1; background: transparent; border: none; outline: none;
    color: var(--text); font-size: 13px; padding: 10px 14px;
    font-family: inherit;
  }
  #newtask input::placeholder { color: var(--dim); }
  #newtask button {
    border-radius: 20px; padding: 8px 20px; font-size: 12px; font-weight: 700;
    white-space: nowrap;
  }

  .muted { color:var(--dim); }
  .mono { font-family:'JetBrains Mono','Fira Code',monospace; }

  /* settings form */
  .settings-form {
    display:flex; flex-direction:column; gap:16px; margin-top:8px;
  }
  .form-group {
    display:flex; flex-direction:column; gap:6px;
  }
  .form-group label {
    font-size:10px; font-weight:700; color:var(--dim); text-transform:uppercase; letter-spacing:0.5px;
  }
  .form-group input, .form-group select {
    background: rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.08); border-radius:var(--radius-sm);
    color:var(--text); padding:10px 12px; font-family:inherit; font-size:12px;
    transition:all var(--transition);
  }
  .form-group input:focus, .form-group select:focus {
    outline:none; border-color:var(--accent);
    box-shadow: 0 0 0 3px rgba(167,139,250,0.15);
  }
  .form-group input[readonly] {
    background: rgba(255,255,255,0.02); color:var(--dim); border-color:transparent; cursor:not-allowed;
  }
  .form-group .hint {
    font-size:10px; color:var(--dim); margin-top:2px;
  }
</style>
</head>
<body>
<header>
  <div class="logo">
    <div class="logo-icon">&#9776;</div>
    <h1>WALLE</h1>
  </div>
  <div class="filter-pills">
    <span class="filter-pill on" data-filter="all">all</span>
    <span class="filter-pill" data-filter="running">running</span>
    <span class="filter-pill" data-filter="done">done</span>
    <span class="filter-pill" data-filter="failed">failed</span>
    <span class="filter-pill" data-filter="merged">merged</span>
  </div>
  <div id="agents"></div>
  <div class="top-right">
    <button id="btn-global-settings" class="ghost" style="padding: 5px 12px; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 20px; background: rgba(30,30,46,0.5); cursor: pointer; transition: all var(--transition);" title="Global Settings">&#9881; Settings</button>
    <div class="stat-pill"><span class="stat-num" id="task-count">0</span><span class="stat-label">agents</span></div>
    <div class="stat-pill" id="cost-today"><span class="stat-num">$0</span><span class="stat-label">today</span></div>
  </div>
</header>
<main>
  <div id="game"></div>
</main>
<div class="bottom-input-container">
  <form id="newtask">
    <input id="prompt" placeholder="Hire a new agent — describe the task..." autocomplete="off">
    <button class="primary" type="submit">&#10132; Hire</button>
  </form>
</div>
<div class="right-task-list" id="floating-task-list">
  <div class="task-list-header">
    <h3>Active Agents</h3>
    <span class="count-badge" id="floating-task-count">0</span>
  </div>
  <div class="task-list-body" id="floating-task-body"></div>
</div>
<div id="task-modal" class="modal-backdrop" style="position: fixed; inset: 0; background: transparent; backdrop-filter: none; display: none; z-index: 1000; pointer-events: none;">
  <div class="modal-card" style="position: absolute; right: 320px; top: 80px; width: 460px; height: 560px; max-height: 85vh; display: flex; flex-direction: column; pointer-events: auto;">
    <div class="modal-header">
      <div id="task-modal-title" style="display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 700; color: var(--text);"></div>
      <div style="display: flex; gap: 4px; align-items: center;">
        <button class="ghost" id="task-modal-minimize" style="font-size: 16px; padding: 4px 8px; font-weight: bold;" title="Minimize">&minus;</button>
        <button class="ghost" id="task-modal-close" style="font-size: 20px; padding: 4px 8px;" title="Close">&times;</button>
      </div>
    </div>
    <div class="tabs" id="task-modal-tabs" style="border-bottom: 1px solid var(--line); background: rgba(12,12,20,0.2);">
      <span class="tab active" data-tab="overview"><span class="tab-icon">&#9673;</span>Overview</span>
      <span class="tab" data-tab="timeline"><span class="tab-icon">&#9776;</span>Timeline</span>
      <span class="tab" data-tab="diff"><span class="tab-icon">&#8663;</span>Diff</span>
      <span class="tab" data-tab="settings"><span class="tab-icon">&#9881;</span>Settings</span>
    </div>
    <div class="body" id="task-modal-body" style="flex: 1; overflow-y: auto; padding: 20px;">
      <!-- content -->
    </div>
    <div class="actions" id="task-modal-actions">
      <!-- action buttons -->
    </div>
  </div>
</div>
<div id="settings-modal" class="modal-backdrop">
  <div class="modal-card">
    <div class="modal-header">
      <h2>Global Settings</h2>
      <button class="ghost" id="modal-close" style="font-size: 20px; padding: 4px 8px;">&times;</button>
    </div>
    <form id="global-settings-form">
      <div class="modal-body">
        <!-- Engine & Model -->
        <div class="settings-section">
          <h3>Engine & LLM Model</h3>
          <div class="form-group">
            <label>Default Engine</label>
            <select id="global-engine">
              <option value="claude">Claude</option>
              <option value="opencode">OpenCode</option>
              <option value="codex">Codex</option>
              <option value="generic">Generic</option>
            </select>
          </div>
          <div class="form-group">
            <label>Default Model Override</label>
            <input id="global-model" placeholder="e.g. claude-3-5-sonnet">
          </div>
        </div>

        <!-- Execution & Concurrency -->
        <div class="settings-section">
          <h3>Execution & Concurrency</h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="form-group">
              <label>Max Concurrency</label>
              <input type="number" id="global-concurrency" min="1" max="10">
            </div>
            <div class="form-group">
              <label>Max Retries</label>
              <input type="number" id="global-max-retries" min="0" max="5">
            </div>
          </div>
          <div class="form-group">
            <label>Verification Command</label>
            <input id="global-verify" placeholder="e.g. npm test">
          </div>
        </div>

        <!-- Budgets -->
        <div class="settings-section">
          <h3>Budget Limits (USD)</h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="form-group">
              <label>Per Task Budget</label>
              <input type="number" id="global-budget-task" step="0.01" min="0" placeholder="e.g. 2.00">
            </div>
            <div class="form-group">
              <label>Per Day Budget</label>
              <input type="number" id="global-budget-day" step="0.01" min="0" placeholder="e.g. 20.00">
            </div>
          </div>
        </div>

        <!-- Notifications -->
        <div class="settings-section">
          <h3>Notifications</h3>
          <div class="form-group">
            <label>Discord/Slack Webhook URL</label>
            <input id="global-notify-webhook" placeholder="https://discord.com/api/webhooks/...">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="ghost" id="modal-cancel">Cancel</button>
        <button type="submit" class="primary">Save Settings</button>
      </div>
    </form>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/phaser@3.87.0/dist/phaser.min.js"></script>
<script>
const T = 16, MAPW = 26, MAPH = 24;
// Furniture frame indices into indoor.png (Kenney 'Roguelike Indoor', CC0).
// The sheet is 27 columns of 16px tiles with 1px spacing — index = row*27 + col.
// Names/indices are the verified map in assets/indoor-tiles.json; the labelled
// grid assets/indoor-tilemap-reference.png shows every tile. Pick new tiles from
// those, not by eyeballing pixel offsets (the 1px spacing makes that error-prone).
const F = { WOOD:24, CARPET:132, CHAIR_D:83, CHAIR_U:56,
            TABLE_L:293, TABLE_M:294, TABLE_R:295, SOFA_L:270, SOFA_M:271, SOFA_R:272,
            PLANT:16, PLANT2:17,
            BOOK_A:39, BOOK_A_TOP:12, BOOK_B:41, BOOK_B_TOP:14, FRIDGE:216, STOVE:217 };
const BODIES = [0, 54, 108, 162];
const SHIRTS = [6, 10, 15, 172, 226, 276, 330];
const STATUS_COLOR = { queued:'#9a9aa8', running:'#63f2b2', verifying:'#f5c97b',
                       done:'#97c459', merged:'#8fd8ff', failed:'#f07373', cancelled:'#666672' };
const BUBBLE = { running:null, verifying:'…', queued:'z', done:'\\u2713', failed:'!', blocked:'?' };

// desk slots (tile coords): 4 columns x 3 rows in the work room
const DESKS = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) DESKS.push({ x: 2 + c * 4, y: 4 + r * 4 });

const CALIBRATE = new URLSearchParams(location.search).has('calibrate');
let LAYOUT = null; // { width, height, desks:[{x,y}], lounge:{x,y,w,h} } when office-bg.png is used
const IDLE_SPOTS = [
  { x: 20 * 16 + 8, y: 3 * 16 + 4, activity: 'sitting_lounge', dir: 'up' },
  { x: 21 * 16 + 8, y: 3 * 16 + 4, activity: 'sitting_lounge', dir: 'up' },
  { x: 22 * 16 + 8, y: 3 * 16 + 4, activity: 'sitting_lounge', dir: 'up' },
  { x: 19 * 16 + 8, y: 4 * 16 + 8, activity: 'standing', dir: 'down' },
  { x: 24 * 16 + 8, y: 4 * 16 + 8, activity: 'standing', dir: 'left' },
  { x: 8 * 16 + 8, y: 2 * 16 + 8, activity: 'kitchen', dir: 'right' },
  { x: 9 * 16 + 8, y: 2 * 16 + 8, activity: 'kitchen', dir: 'left' },
  { x: 10 * 16 + 8, y: 3 * 16 + 8, activity: 'kitchen', dir: 'up' },
  { x: 11 * 16 + 8, y: 20 * 16 + 8, activity: 'library_reading', dir: 'down' },
  { x: 12 * 16 + 8, y: 20 * 16 + 8, activity: 'library_reading', dir: 'up' },
  { x: 13 * 16 + 8, y: 20 * 16 + 8, activity: 'library_reading', dir: 'down' },
  { x: 15 * 16 + 8, y: 21 * 16 + 8, activity: 'standing', dir: 'left' },
  { x: 8 * 16 + 8, y: 21 * 16 + 8, activity: 'standing', dir: 'right' },
  { x: 19 * 16 + 8, y: 10 * 16 + 8, activity: 'meeting', dir: 'down' },
  { x: 20 * 16 + 8, y: 10 * 16 + 8, activity: 'meeting', dir: 'down' },
  { x: 21 * 16 + 8, y: 10 * 16 + 8, activity: 'meeting', dir: 'down' },
  { x: 22 * 16 + 8, y: 10 * 16 + 8, activity: 'meeting', dir: 'down' },
  { x: 23 * 16 + 8, y: 10 * 16 + 8, activity: 'meeting', dir: 'down' },
  { x: 19 * 16 + 8, y: 12 * 16 + 8, activity: 'meeting', dir: 'up' },
  { x: 20 * 16 + 8, y: 12 * 16 + 8, activity: 'meeting', dir: 'up' },
  { x: 21 * 16 + 8, y: 12 * 16 + 8, activity: 'meeting', dir: 'up' },
  { x: 22 * 16 + 8, y: 12 * 16 + 8, activity: 'meeting', dir: 'up' },
  { x: 23 * 16 + 8, y: 12 * 16 + 8, activity: 'meeting', dir: 'up' }
];
const NPCS = [
  { id: 'alice_staff', prompt: 'UI/UX Design & Branding', status: 'merged', createdAt: new Date().toISOString() },
  { id: 'bob_staff', prompt: 'Server Maintenance & DB Ops', status: 'merged', createdAt: new Date().toISOString() },
  { id: 'charlie_staff', prompt: 'Product Backlog Planning', status: 'merged', createdAt: new Date().toISOString() }
];
let tasks = [], allTasks = [], selected = null, scene = null;

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

    if (!CALIBRATE) {
      this.centerCamera();
      this.setupCameraControls();
      this.scale.on('resize', () => this.centerCamera());
    }
  }
  // scaled desk positions: pixel coords from layout, or tile-grid defaults
  deskAt(i) {
    if (LAYOUT && LAYOUT.desks[i]) {
      const d = LAYOUT.desks[i];
      return { seatX: d.x * this.bgScale, seatY: d.y * this.bgScale, labelY: d.y * this.bgScale + 12 };
    }
    const d = DESKS[i];
    return { seatX: d.x * T + 16, seatY: (d.y - 1) * T + 11, labelY: d.y * T + 14, tile: d };
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
    const px = (x) => x * T + 8;
    // ── FLOOR: wood planks, subtle row-banded shading ──────
    for (let y = 1; y < MAPH - 1; y++) for (let x = 1; x < MAPW - 1; x++) {
      const t = this.add.image(px(x), px(y), 'in', F.WOOD);
      t.setTint(0xc4b393 + ((y % 2) * 0x050402)); // gentle alternating plank-row shade
    }
    // thin floor plank lines for realism
    const floorLines = this.add.graphics();
    floorLines.lineStyle(1, 0x000000, 0.07);
    for (let y = 1; y < MAPH - 1; y++) {
      floorLines.lineBetween(T + 4, px(y), (MAPW - 1) * T + 4, px(y));
    }
    // ── AMBIENT DARKENING: vignette ────────────────────────
    const vignette = this.add.graphics();
    vignette.fillStyle(0x0a0a14, 0.25);
    vignette.fillRect(0, 0, MAPW * T, MAPH * T);
    // light cone from windows
    const lightRays = this.add.graphics();
    lightRays.fillStyle(0xfff8e0, 0.03);
    for (const wx of [3, 7, 12, 20, 23]) {
      lightRays.fillRect(wx * T, T, 20, 5 * T);
    }
    // ── RUG: decorative patterned ──────────────────────────
    for (let y = 2; y < 7; y++) for (let x = 19; x < 25; x++) {
      const c = this.add.image(px(x), px(y), 'in', F.CARPET);
      c.setAlpha(0.78);
    }
    // rug border
    const rugBorder = this.add.graphics();
    rugBorder.lineStyle(1, 0x665544, 0.5);
    rugBorder.strokeRect(px(19) - 8, px(2) - 8, 6 * T, 5 * T);
    // ── WALLS: premium dark wallpaper ──────────────────────
    const wall = this.add.graphics();
    // main walls — deep blue-grey
    wall.fillStyle(0x2a2e3c);
    wall.fillRect(0, 0, MAPW * T, T).fillRect(0, 0, T, MAPH * T)
        .fillRect((MAPW - 1) * T, 0, T, MAPH * T).fillRect(0, (MAPH - 1) * T, MAPW * T, T);
    // wallpaper stripe pattern
    wall.fillStyle(0x31374a, 0.4);
    for (let sx = T; sx < MAPW * T - T; sx += 12) wall.fillRect(sx, 6, 4, T - 6);
    // crown molding (top)
    wall.fillStyle(0x3d4258);
    wall.fillRect(0, 0, MAPW * T, 4);
    wall.fillStyle(0x4a4f6a);
    wall.fillRect(0, 4, MAPW * T, 2);
    // baseboard
    wall.fillStyle(0x3d4258);
    wall.fillRect(0, T - 4, MAPW * T, 4);
    wall.fillStyle(0x4a4f6a);
    wall.fillRect(0, T - 5, MAPW * T, 1);
    // divider walls (internal)
    wall.fillStyle(0x262a38);
    wall.fillRect(17 * T, T, 8, 5 * T).fillRect(17 * T, 9 * T, 8, 5 * T);
    wall.fillStyle(0x3d4258);
    wall.fillRect(17 * T, T, 2, 5 * T).fillRect(17 * T + 6, T, 2, 5 * T);
    wall.fillRect(17 * T, 9 * T, 2, 5 * T).fillRect(17 * T + 6, 9 * T, 2, 5 * T);
    // ── WINDOWS: framed with night sky ─────────────────────
    for (const wx of [3, 7, 12, 20, 23]) {
      const wxPx = px(wx);
      // outer frame
      this.add.rectangle(wxPx, 8, 24, 12, 0x4a4f6a).setStrokeStyle(1, 0x363a4e);
      // night sky
      this.add.rectangle(wxPx, 8, 20, 9, 0x1a2440);
      // stars
      for (let si = 0; si < 4; si++) {
        this.add.rectangle(wxPx - 6 + (si * 5), 6 + (si % 3), 1, 1, 0xffffff).setAlpha(0.5 + (wx * si) % 3 * 0.15);
      }
      // moon in one window
      if (wx === 12) {
        this.add.circle(wxPx + 4, 5, 3, 0xeeeedd);
        this.add.circle(wxPx + 5, 4, 3, 0x1a2440);
      }
      // window cross
      const winGFX = this.add.graphics();
      winGFX.lineStyle(1, 0x4a4f6a);
      winGFX.lineBetween(wxPx, 3, wxPx, 13);
      winGFX.lineBetween(wxPx - 10, 8, wxPx + 10, 8);
      // sill highlight
      this.add.rectangle(wxPx, 13, 24, 2, 0x5a5f7a);
    }
    // ── WALL ART & DECOR ───────────────────────────────────
    // framed picture 1 — landscape
    const frame1 = this.add.graphics();
    frame1.fillStyle(0x5a4a2e);
    frame1.fillRect(px(10) - 1, 4, 12, 10);
    frame1.fillStyle(0x4a8a6a);
    frame1.fillRect(px(10) + 1, 5, 8, 8);
    frame1.fillStyle(0x6a9a7a);
    frame1.fillRect(px(10) + 1, 5, 8, 3); // sky
    // framed picture 2 — abstract
    const frame2 = this.add.graphics();
    frame2.fillStyle(0x5a4a2e);
    frame2.fillRect(px(15) - 1, 4, 12, 10);
    frame2.fillStyle(0x8a6a4a);
    frame2.fillRect(px(15) + 1, 5, 8, 8);
    frame2.fillStyle(0x6a8ac0);
    frame2.fillCircle(px(15) + 5, 7, 2, 0x6a8ac0);
    // shelf with items
    for (let x = 2; x <= 5; x++) this.add.image(px(x), px(1), 'in', [478, 479, 480][(x - 2) % 3]);
    // small clock on wall
    this.add.circle(px(6), px(3), 3, 0xeee8d5);
    this.add.circle(px(6), px(3), 2, 0xfaf5e8).setStrokeStyle(1, 0xbba482);
    this.add.rectangle(px(6), px(3) - 1, 1, 2, 0x444);
    // kitchenette
    this.add.image(px(8), px(1), 'in', F.FRIDGE);
    this.add.image(px(9), px(1), 'in', F.STOVE);
    // ── LOUNGE ZONE ────────────────────────────────────────
    this.loungeShadow(px(20) + 16, px(3) + 8, 52, 10);
    this.add.image(px(20), px(3), 'in', F.SOFA_L);
    this.add.image(px(21), px(3), 'in', F.SOFA_M);
    this.add.image(px(22), px(3), 'in', F.SOFA_R);
    // coffee table
    this.add.rectangle(px(21) + 8, px(4) + 10, 16, 9, 0x8a6a4a).setStrokeStyle(1, 0x5a4326);
    this.add.rectangle(px(21) + 8, px(4) + 14, 12, 2, 0x4a3a1e);
    // mug on table
    this.add.rectangle(px(21) + 4, px(4) + 8, 3, 3, 0xd8734a);
    // magazine
    this.add.rectangle(px(21) + 12, px(4) + 9, 6, 4, 0xe8e0d0).setStrokeStyle(1, 0xccc4b4);
    // plants
    this.add.image(px(23), px(2), 'in', F.PLANT);
    this.add.image(px(19), px(2), 'in', F.PLANT2);
    this.add.image(px(24), px(5), 'in', F.PLANT);
    // floor lamp near lounge
    this.add.rectangle(px(18), px(4), 2, 6, 0x555);
    this.add.rectangle(px(18), px(4) - 4, 6, 3, 0xeedd99);
    const lampGlow = this.add.ellipse(px(18), px(4) - 2, 20, 16, 0xffe8a0, 0.06);
    // ── MEETING ROOM ───────────────────────────────────────
    this.loungeShadow(px(21), px(12) - 2, 76, 16);
    this.add.image(px(19), px(11), 'in', F.TABLE_L);
    this.add.image(px(20), px(11), 'in', F.TABLE_M);
    this.add.image(px(21), px(11), 'in', F.TABLE_M);
    this.add.image(px(22), px(11), 'in', F.TABLE_M);
    this.add.image(px(23), px(11), 'in', F.TABLE_R);
    this.add.image(px(19), px(10), 'in', F.CHAIR_D);
    this.add.image(px(20), px(10), 'in', F.CHAIR_D);
    this.add.image(px(21), px(10), 'in', F.CHAIR_D);
    this.add.image(px(22), px(10), 'in', F.CHAIR_D);
    this.add.image(px(23), px(10), 'in', F.CHAIR_D);
    this.add.image(px(19), px(12), 'in', F.CHAIR_U);
    this.add.image(px(20), px(12), 'in', F.CHAIR_U);
    this.add.image(px(21), px(12), 'in', F.CHAIR_U);
    this.add.image(px(22), px(12), 'in', F.CHAIR_U);
    this.add.image(px(23), px(12), 'in', F.CHAIR_U);
    this.add.image(px(24), px(13), 'in', F.PLANT);
    this.add.image(px(18), px(13), 'in', F.PLANT2); // fixed typo from px(1) to px(18)
    // whiteboard
    this.add.rectangle(px(18) - 4, px(10), 22, 10, 0xeee8d5).setStrokeStyle(1.5, 0x5a4a2e);
    this.add.rectangle(px(18) - 6, px(10) - 1, 2, 1, 0x4488cc); // marker dots
    this.add.rectangle(px(18) - 2, px(10) + 1, 3, 1, 0x44aa66);
    // ── DESKS ──────────────────────────────────────────────
    for (let i = 0; i < DESKS.length; i++) {
      const d = DESKS[i];
      // larger, softer shadow
      this.add.ellipse(d.x * T + 16, (d.y + 1) * T - 2, 38, 10, 0x000000, 0.15);
      // floor mat under desk
      this.add.rectangle(d.x * T + 16, d.y * T + 16, 36, 26, 0x1a2028, 0.3);
      this.drawDesk(px(d.x), px(d.y), i);
      this.drawOfficeChair(px(d.x) + 8, px(d.y - 1) + 4);
    }
    // ── DIVIDER: solid wall (office / library) ──
    const inDoorway = (x) => x >= 11 && x <= 14;
    wall.fillStyle(0x262a38); // main wall body color
    for (let x = 1; x < MAPW - 1; x++) {
      if (inDoorway(x)) continue;
      wall.fillRect(x * T, 14 * T, T, 2 * T);
    }
    // wall trims (crown molding and baseboard)
    wall.fillStyle(0x3d4258); // top crown mold
    for (let x = 1; x < MAPW - 1; x++) {
      if (inDoorway(x)) continue;
      wall.fillRect(x * T, 14 * T, T, 3);
    }
    wall.fillStyle(0x4a4f6a); // bottom baseboard
    for (let x = 1; x < MAPW - 1; x++) {
      if (inDoorway(x)) continue;
      wall.fillRect(x * T, 16 * T - 4, T, 4);
    }
    // doorway threshold + floor runner
    this.add.rectangle(13 * T, px(14) + T / 2, 4 * T - 4, 2 * T - 6, 0x2a2016, 0.5);

    // ── LIBRARY / READING ROOM ──────────────────────────────
    // reading rug
    for (let y = 17; y < 22; y++) for (let x = 9; x < 17; x++) {
      const c = this.add.image(px(x), px(y), 'in', F.CARPET);
      c.setAlpha(0.7); c.setTint(0x8ab87a);
    }
    const libRugBorder = this.add.graphics();
    libRugBorder.lineStyle(1, 0x4a6a3a, 0.5);
    libRugBorder.strokeRect(px(9) - 8, px(17) - 8, 8 * T, 5 * T);
    // reading table + chairs
    this.loungeShadow(px(12) + 8, px(19) + 6, 40, 12);
    this.add.image(px(11), px(19), 'in', F.TABLE_L);
    this.add.image(px(12), px(19), 'in', F.TABLE_M);
    this.add.image(px(13), px(19), 'in', F.TABLE_R);
    this.add.image(px(11), px(18), 'in', F.CHAIR_D);
    this.add.image(px(13), px(18), 'in', F.CHAIR_D);
    this.add.image(px(12), px(20), 'in', F.CHAIR_U);
    // reading nook sofa
    this.loungeShadow(px(20) + 16, px(20) + 6, 52, 10);
    this.add.image(px(20), px(20), 'in', F.SOFA_L);
    this.add.image(px(21), px(20), 'in', F.SOFA_M);
    this.add.image(px(22), px(20), 'in', F.SOFA_R);
    // plants
    this.add.image(px(3), px(21), 'in', F.PLANT);
    this.add.image(px(23), px(21), 'in', F.PLANT2);
    this.add.image(px(23), px(17), 'in', F.PLANT);
  }
  loungeShadow(cx, cy, w, h) { this.add.ellipse(cx, cy, w, h, 0x000000, 0.12); }

  drawDesk(cx, cy, idx) {
    const w = 30, h = 20;
    const DESK_STYLES = [
      { surface: 0xe5c290, stroke: 0xb08855, leg: 0x5c4326, feet: 0x3a2a16 }, // Birch Wood
      { surface: 0x4a3728, stroke: 0x32241a, leg: 0x281c14, feet: 0x18100b }, // Dark Walnut
      { surface: 0x3d434d, stroke: 0x2b2f36, leg: 0x4e535c, feet: 0x2e323b }, // Slate Grey
      { surface: 0xe8e5dc, stroke: 0xb5b0a3, leg: 0x4f5259, feet: 0x313337 }  // Clean Cream
    ];
    const style = DESK_STYLES[idx % DESK_STYLES.length];
    // desk surface
    this.add.rectangle(cx, cy, w, h, style.surface).setStrokeStyle(1, style.stroke);
    // wood grain lines (only for wood types)
    if (idx % 4 < 2) {
      const grain = this.add.graphics();
      grain.lineStyle(1, 0x000000, 0.08);
      for (let gy = -7; gy < 7; gy += 4) {
        grain.lineBetween(cx - 12, cy + gy, cx + 12, cy + gy + (idx % 3) - 1);
      }
    }
    // front edge highlight
    this.add.rectangle(cx, cy + h / 2 - 2, w - 2, 3, style.stroke).setAlpha(0.6);
    // legs with feet
    this.add.rectangle(cx - w / 2 + 4, cy + h / 2 - 2, 3, 9, style.leg);
    this.add.rectangle(cx + w / 2 - 4, cy + h / 2 - 2, 3, 9, style.leg);
    this.add.rectangle(cx - w / 2 + 4, cy + h / 2 + 4, 5, 2, style.feet);
    this.add.rectangle(cx + w / 2 - 4, cy + h / 2 + 4, 5, 2, style.feet);
    // ── MONITOR ────────────────────────────────────────────
    const monX = cx - 3, monY = cy - 4;
    // monitor back/base
    this.add.rectangle(monX, monY, 16, 12, 0x1a1a26).setStrokeStyle(1, 0x0e0e16);
    this.add.rectangle(monX, monY + 7, 8, 3, 0x2a2a3a); // stand base
    this.add.rectangle(monX, monY + 5, 3, 4, 0x3a3a4a); // stand pole
    // screen
    this.add.rectangle(monX, monY, 13, 9, 0x1a3028);
    this.add.rectangle(monX, monY, 11, 7, 0x2f4a3a);
    // screen content: code lines
    for (let sl = 0; sl < 3; sl++) {
      this.add.rectangle(monX - 3 + sl, monY - 1 + sl * 2, 5 - sl, 1, 0x63f2b2).setAlpha(0.6 - sl * 0.15);
    }
    // cursor blink
    this.add.rectangle(monX + 4, monY - 1, 1, 3, 0x63f2b2);
    // screen glow on desk
    this.add.rectangle(monX, monY + 5, 10, 3, 0x2f4a3a, 0.08);
    // ── KEYBOARD + MOUSE ──────────────────────────────────
    // keyboard
    this.add.rectangle(cx - 2, cy + 7, 13, 5, 0xe8e8ee).setStrokeStyle(1, 0xb0b0b8);
    // key rows
    for (let kr = 0; kr < 3; kr++) {
      this.add.rectangle(cx - 2, cy + 6 + kr, 10, 1, 0xd0d0d6);
    }
    // mouse
    this.add.ellipse(cx + 10, cy + 7, 5, 4, 0xe0e0e6).setStrokeStyle(1, 0xb0b0b8);
    this.add.rectangle(cx + 10, cy + 6, 1, 2, 0x999);
    // ── DESK ITEMS ─────────────────────────────────────────
    // coffee mug
    this.add.rectangle(cx + 12, cy - 6, 5, 5, 0xd8734a).setStrokeStyle(1, 0x8a3f22);
    this.add.ellipse(cx + 12, cy - 8, 5, 2, 0x3a1a0e); // coffee inside
    // notepad / papers
    this.add.rectangle(cx - 9, cy + 3, 6, 5, 0xfafafa, 0.9).setStrokeStyle(1, 0xddd);
    this.add.rectangle(cx - 10, cy + 2, 6, 5, 0xf4f4f4, 0.8).setStrokeStyle(1, 0xddd);
    for (let nl = 0; nl < 2; nl++) {
      this.add.rectangle(cx - 9, cy + 2 + nl * 1.5, 4, 0.8, 0xaaaacc);
    }
    // pen
    this.add.rectangle(cx - 11, cy + 1, 5, 1, 0x3355aa).setRotation(0.3);
  }

  drawOfficeChair(cx, cy) {
    // casters (wheels)
    for (const dx of [-3.5, 3.5]) {
      this.add.circle(cx + dx, cy + 7, 1.2, 0x33333c);
      this.add.circle(cx + dx, cy + 7, 0.6, 0x555);
    }
    // base
    this.add.ellipse(cx, cy + 5, 10, 3, 0x2a2a34);
    // post
    this.add.rectangle(cx, cy, 3, 6, 0x44444e);
    // seat cushion
    this.add.ellipse(cx, cy - 1, 13, 10, 0x4e5066).setStrokeStyle(1, 0x383a48);
    this.add.ellipse(cx, cy - 1, 10, 7, 0x555770); // cushion highlight
    // backrest
    this.add.rectangle(cx, cy - 10, 12, 8, 0x42445a).setStrokeStyle(1, 0x303244);
    this.add.rectangle(cx, cy - 11, 10, 5, 0x4e5066); // pillow
    // arm rests
    this.add.rectangle(cx - 5, cy - 1, 3, 1.5, 0x3a3c4e);
    this.add.rectangle(cx + 5, cy - 1, 3, 1.5, 0x3a3c4e);
  }
  syncAgents() {
    this.agents.clear(true, true);
    this.deskMarks.clear(true, true);
    const visible = tasks.slice(-this.deskCount());
    visible.forEach((t, i) => {
      const dk = this.deskAt(i);
      const seat = { x: dk.seatX, y: dk.seatY };
      if (t.status === 'merged' || t.status === 'cancelled') {
        // empty desk badge
        const badge = this.add.circle(seat.x, seat.y + 2, 6, t.status === 'merged' ? 0x2a5a3a : 0x4a2a2a, 0.6);
        badge.setStrokeStyle(1, STATUS_COLOR[t.status]);
        const mark = this.add.text(seat.x, seat.y + 2, t.status === 'merged' ? '\u2713' : '\u00d7',
          { fontFamily: 'monospace', fontSize: '9px', color: STATUS_COLOR[t.status], fontStyle: 'bold' }).setOrigin(0.5);
        mark.taskId = t.id; mark.setInteractive({ useHandCursor: true });
        mark.on('pointerdown', () => select(t.id));
        this.deskMarks.add(badge); this.deskMarks.add(mark);
        this.addLabel(seat.x, dk.labelY, t, this.deskMarks);
        return;
      }
      const c = this.add.container(seat.x, seat.y);
      // character shadow
      const shadow = this.add.ellipse(0, 8, 14, 4, 0x000000, 0.2);
      c.add(shadow);
      const body = this.add.image(0, 0, 'ch', BODIES[hash(t.id) % BODIES.length]);
      const shirt = this.add.image(0, 0, 'ch', SHIRTS[hash(t.id + 'x') % SHIRTS.length]);
      c.add([body, shirt]);
      if (t.status === 'failed') { body.setTint(0x999999); shirt.setTint(0x777777); }
      // status bubble
      const bubbleChar = t._blocked ? BUBBLE.blocked : BUBBLE[t.status];
      if (bubbleChar) {
        const bubbleColor = Phaser.Display.Color.HexStringToColor(t._blocked ? '#f5c97b' : STATUS_COLOR[t.status]).color;
        const bg = this.add.circle(9, -12, 7, 0x0c0c16);
        bg.setStrokeStyle(1.5, bubbleColor);
        const tx = this.add.text(9, -12, bubbleChar, { fontFamily: 'monospace', fontSize: '10px',
          color: t._blocked ? '#f5c97b' : STATUS_COLOR[t.status], fontStyle: 'bold' }).setOrigin(0.5);
        // bubble tail
        const tail = this.add.graphics();
        tail.fillStyle(0x0c0c16);
        tail.fillTriangle(7, -5, 11, -5, 9, -1);
        tail.lineStyle(1.5, bubbleColor);
        tail.lineBetween(9, -5, 9, -1);
        c.add([bg, tail, tx]);
      }
      c.setSize(T, T).setInteractive({ useHandCursor: true });
      c.on('pointerdown', () => select(t.id));
      this.agents.add(c);
      // animations
      if (t.status === 'running' || t.status === 'verifying') {
        this.tweens.add({ targets: c, y: seat.y - 2, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        // arm typing animation — scale shirt slightly
        this.tweens.add({ targets: shirt, scaleX: 1.08, scaleY: 0.92, duration: 200, yoyo: true, repeat: -1 });
      }
      if (t.status === 'queued') this.wander(c, seat);
      if (t.status === 'done') {
        this.tweens.add({ targets: c, y: seat.y - 1, duration: 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      this.addLabel(seat.x, dk.labelY, t, this.agents);
      // selection ring
      if (selected === t.id) {
        const ring = this.add.rectangle(seat.x - 4, seat.y + 8, 42, 44);
        ring.setStrokeStyle(1.5, 0x8fd8ff);
        ring.setFillStyle(0x8fd8ff, 0.04);
        this.deskMarks.add(ring);
        this.tweens.add({ targets: ring, alpha: 0.5, duration: 800, yoyo: true, repeat: -1 });
      }
    });

    // Draw idle agents in common areas
    const occupiedSpots = new Set();
    const idleTasks = [...NPCS, ...allTasks.filter(t => t.status === 'merged' || t.status === 'cancelled')];
    const uniqueIdle = [];
    const seenIds = new Set();
    for (const t of idleTasks) {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id);
        uniqueIdle.push(t);
      }
    }
    
    uniqueIdle.slice(-IDLE_SPOTS.length).forEach((t) => {
      let spotIdx = hash(t.id) % IDLE_SPOTS.length;
      for (let k = 0; k < IDLE_SPOTS.length; k++) {
        const idx = (spotIdx + k) % IDLE_SPOTS.length;
        if (!occupiedSpots.has(idx)) {
          spotIdx = idx;
          break;
        }
      }
      occupiedSpots.add(spotIdx);
      const spot = IDLE_SPOTS[spotIdx];
      this.drawIdleAgent(t, spot);
    });
  }
  drawIdleAgent(t, spot) {
    const c = this.add.container(spot.x, spot.y);
    const shadow = this.add.ellipse(0, 8, 14, 4, 0x000000, 0.2);
    c.add(shadow);
    const body = this.add.image(0, 0, 'ch', BODIES[hash(t.id) % BODIES.length]);
    const shirt = this.add.image(0, 0, 'ch', SHIRTS[hash(t.id + 'x') % SHIRTS.length]);
    
    if (spot.activity === 'sitting_lounge') {
      body.y = -2;
      shirt.y = -2;
      shadow.alpha = 0.05;
    } else if (spot.activity === 'meeting' || spot.activity === 'library_reading') {
      if (spot.dir === 'up') {
        body.y = -2;
        shirt.y = -2;
      } else {
        body.y = 1;
        shirt.y = 1;
      }
    }
    c.add([body, shirt]);
    
    if (!t.id.endsWith('_staff')) {
      c.setSize(T, T).setInteractive({ useHandCursor: true });
      c.on('pointerdown', () => select(t.id));
    }
    
    this.agents.add(c);
    
    if (spot.activity === 'sitting_lounge') {
      this.tweens.add({ targets: c, scaleY: 0.96, scaleX: 1.02, duration: 1500 + hash(t.id) % 500, yoyo: true, repeat: -1 });
    } else if (spot.activity === 'standing') {
      this.wander(c, { x: spot.x, y: spot.y });
    } else {
      this.tweens.add({ targets: c, y: spot.y - 1, duration: 800 + hash(t.id) % 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }
  addLabel(x, y, t, group) {
    const label = this.add.text(x, y, t.id, { fontFamily: 'monospace', fontSize: '7.5px',
      color: '#e2e4ec', backgroundColor: '#0c0c18cc', padding: { x: 3, y: 2 } }).setOrigin(0.5, 0);
    const st = this.add.text(x, y + 11, t.status + (t.costUsd ? ' $' + t.costUsd.toFixed(2) : ''),
      { fontFamily: 'monospace', fontSize: '7.5px', color: STATUS_COLOR[t.status] }).setOrigin(0.5, 0);
    if (t._blocked) st.setText('blocked');
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
  centerCamera() {
    const cam = this.cameras.main;
    const mapWidth = MAPW * T;
    const mapHeight = MAPH * T;
    const zoomX = cam.width / mapWidth;
    const zoomY = cam.height / mapHeight;
    const defaultZoom = Phaser.Math.Clamp(Math.min(zoomX, zoomY), 1.0, 3.0);
    cam.setZoom(defaultZoom);
    cam.scrollX = mapWidth / 2 - cam.width / 2;
    cam.scrollY = mapHeight / 2 - cam.height / 2;
  }
  setupCameraControls() {
    const cam = this.cameras.main;
    cam.setBounds(-300, -300, MAPW * T + 600, MAPH * T + 600);
    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY, deltaZ) => {
      const oldZoom = cam.zoom;
      let newZoom = oldZoom - deltaY * 0.0015;
      newZoom = Phaser.Math.Clamp(newZoom, 0.8, 5.0);
      if (newZoom !== oldZoom) {
        const pointerX = pointer.x;
        const pointerY = pointer.y;
        const worldX = (pointerX - cam.centerX) / oldZoom + cam.scrollX + cam.centerX;
        const worldY = (pointerY - cam.centerY) / oldZoom + cam.scrollY + cam.centerY;
        cam.setZoom(newZoom);
        cam.scrollX = worldX - cam.centerX - (pointerX - cam.centerX) / newZoom;
        cam.scrollY = worldY - cam.centerY - (pointerY - cam.centerY) / newZoom;
      }
    });
    let isDragging = false, dragStartX = 0, dragStartY = 0, camStartX = 0, camStartY = 0;
    this.input.on('pointerdown', (pointer) => {
      isDragging = true; dragStartX = pointer.x; dragStartY = pointer.y; camStartX = cam.scrollX; camStartY = cam.scrollY;
    });
    this.input.on('pointermove', (pointer) => {
      if (isDragging) {
        const dx = pointer.x - dragStartX, dy = pointer.y - dragStartY;
        cam.scrollX = camStartX - dx / cam.zoom; cam.scrollY = camStartY - dy / cam.zoom;
      }
    });
    this.input.on('pointerup', () => { isDragging = false; });
    this.input.on('pointerout', () => { isDragging = false; });
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
    width: '100%', height: '100%',
    scale: { mode: Phaser.Scale.RESIZE },
    scene: Office,
  });
})();

function select(id) {
  selected = id;
  activeTab = 'overview';
  document.querySelectorAll('#task-modal-tabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelector('#task-modal-tabs .tab[data-tab="overview"]').classList.add('active');
  
  // Open task modal
  const taskModal = document.getElementById('task-modal');
  taskModal.style.display = 'flex';
  taskModal.offsetHeight; // trigger reflow
  taskModal.classList.add('open');

  // Maximize modal if it was minimized
  if (isTaskModalMinimized && minimizeTaskModalBtn) {
    minimizeTaskModalBtn.click();
  }

  openPanel(id);
  scene && scene.events.emit('tasks');
}

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
  let all = await (await fetch('/api/tasks')).json();
  allTasks = all;
  await Promise.all(all.filter(t => t.status === 'running').map(async (t) => {
    const r = await fetch('/api/tasks/' + t.id);
    if (r.ok) { const { events } = await r.json(); t._blocked = events.some(e => e.type === 'agent.blocked'); }
  }));
  // filter
  tasks = filter === 'all' ? all : all.filter(t => t.status === filter);
  // chips show all tasks
  const displayTasks = filter === 'all' ? all : all;
  const bar = document.getElementById('agents');
  bar.innerHTML = '';
  for (const t of displayTasks.slice(-8).reverse()) {
    const chip = document.createElement('div'); chip.className = 'chip';
    if (selected === t.id) chip.classList.add('active');
    chip.appendChild(chipAvatar(t));
    const name = document.createElement('span'); name.textContent = t.id; chip.appendChild(name);
    const dot = document.createElement('span'); dot.className = 'dot';
    dot.style.background = STATUS_COLOR[t.status] || '#9a9aa8'; chip.appendChild(dot);
    chip.onclick = () => select(t.id);
    bar.appendChild(chip);
  }
  // stat pills
  document.getElementById('task-count').textContent = all.length;
  let today = 0; const day = new Date().toISOString().slice(0, 10);
  for (const t of all) if (t.createdAt.startsWith(day)) today += t.costUsd;
  document.getElementById('cost-today').innerHTML = '<span class="stat-num">$' + today.toFixed(2) + '</span><span class="stat-label">today</span>';

  // Update floating task list on the right
  const floatingTaskCount = document.getElementById('floating-task-count');
  const floatingTaskBody = document.getElementById('floating-task-body');
  if (floatingTaskCount && floatingTaskBody) {
    floatingTaskCount.innerText = tasks.length;
    floatingTaskBody.innerHTML = tasks.map(t => {
      const activeClass = selected === t.id ? 'active' : '';
      const dotColor = STATUS_COLOR[t.status] || '#9a9aa8';
      let html = '<div class="task-item-card ' + activeClass + '" onclick="select(\'' + t.id + '\')">';
      html += '<div class="task-item-meta">';
      html += '<span class="task-item-id mono">' + t.id + '</span>';
      html += '<span class="task-item-status" style="color: ' + dotColor + '">';
      html += '<span class="status-dot" style="background: ' + dotColor + '; width: 6px; height: 6px; display: inline-block; border-radius: 50%;"></span> ';
      html += t.status;
      html += '</span></div>';
      html += '<div class="task-item-prompt">' + esc(t.prompt) + '</div>';
      html += '</div>';
      return html;
    }).join('');
  }

  scene && scene.events.emit('tasks');
  if (selected) openPanel(selected, true);
}

const EV_ICON = { 'task.started':'&#9654;', 'agent.message':'&#128172;', 'tool.used':'&#128295;',
                  'file.changed':'&#128221;', 'cost.updated':'&#128178;', 'agent.blocked':'&#9208;', 'task.finished':'&#9873;' };
const EV_CLASS = { 'agent.message':'msg', 'tool.used':'tool', 'file.changed':'file', 'agent.blocked':'err' };
let activeTab = 'overview', filter = 'all', panelTask = null;

// tab switching
document.getElementById('task-modal-tabs').addEventListener('click', e => {
  if (!e.target.classList.contains('tab')) return;
  document.querySelectorAll('#task-modal-tabs .tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  activeTab = e.target.dataset.tab;
  if (panelTask) renderPanel(panelTask);
});
// filter pills
document.querySelectorAll('.filter-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('on'));
    pill.classList.add('on');
    filter = pill.dataset.filter;
    refresh();
  });
});

const taskModal = document.getElementById('task-modal');
const closeTaskModalBtn = document.getElementById('task-modal-close');
const minimizeTaskModalBtn = document.getElementById('task-modal-minimize');
let isTaskModalMinimized = false;

function closeTaskModal() {
  taskModal.classList.remove('open');
  setTimeout(() => {
    if (!taskModal.classList.contains('open')) {
      taskModal.style.display = 'none';
      selected = null; panelTask = null; activeTab = 'overview';
      document.querySelectorAll('#task-modal-tabs .tab').forEach(t => t.classList.remove('active'));
      document.querySelector('#task-modal-tabs .tab[data-tab="overview"]').classList.add('active');
      refreshPanelEmpty();
      if (scene) scene.events.emit('tasks');
    }
  }, 300);
}

closeTaskModalBtn.addEventListener('click', closeTaskModal);

// Minimize toggle logic
minimizeTaskModalBtn.addEventListener('click', () => {
  isTaskModalMinimized = !isTaskModalMinimized;
  const card = taskModal.querySelector('.modal-card');
  if (isTaskModalMinimized) {
    minimizeTaskModalBtn.innerHTML = '&#9633;'; // Maximize icon
    document.getElementById('task-modal-tabs').style.display = 'none';
    document.getElementById('task-modal-body').style.display = 'none';
    document.getElementById('task-modal-actions').style.display = 'none';
    card.style.height = 'auto';
  } else {
    minimizeTaskModalBtn.innerHTML = '&minus;'; // Minimize icon
    document.getElementById('task-modal-tabs').style.display = 'flex';
    document.getElementById('task-modal-body').style.display = 'block';
    document.getElementById('task-modal-actions').style.display = 'flex';
    card.style.height = '560px';
  }
});

// Dragging logic
const taskModalHeader = taskModal.querySelector('.modal-header');
const taskModalCard = taskModal.querySelector('.modal-card');

let isDraggingTaskModal = false;
let taskModalStartX = 0;
let taskModalStartY = 0;

taskModalHeader.style.cursor = 'move';

taskModalHeader.addEventListener('mousedown', (e) => {
  if (e.target.closest('button')) return;
  isDraggingTaskModal = true;
  taskModalStartX = e.clientX - taskModalCard.offsetLeft;
  taskModalStartY = e.clientY - taskModalCard.offsetTop;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (isDraggingTaskModal) {
    let x = e.clientX - taskModalStartX;
    let y = e.clientY - taskModalStartY;
    
    // Clamp to screen bounds
    const maxX = window.innerWidth - taskModalCard.offsetWidth;
    const maxY = window.innerHeight - taskModalCard.offsetHeight;
    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));
    
    taskModalCard.style.left = x + 'px';
    taskModalCard.style.top = y + 'px';
    taskModalCard.style.right = 'auto';
    taskModalCard.style.bottom = 'auto';
  }
});

document.addEventListener('mouseup', () => {
  isDraggingTaskModal = false;
});

// Touch support for dragging
taskModalHeader.addEventListener('touchstart', (e) => {
  if (e.target.closest('button')) return;
  isDraggingTaskModal = true;
  const touch = e.touches[0];
  taskModalStartX = touch.clientX - taskModalCard.offsetLeft;
  taskModalStartY = touch.clientY - taskModalCard.offsetTop;
});

document.addEventListener('touchmove', (e) => {
  if (isDraggingTaskModal) {
    const touch = e.touches[0];
    let x = touch.clientX - taskModalStartX;
    let y = touch.clientY - taskModalStartY;
    x = Math.max(0, Math.min(x, window.innerWidth - taskModalCard.offsetWidth));
    y = Math.max(0, Math.min(y, window.innerHeight - taskModalCard.offsetHeight));
    taskModalCard.style.left = x + 'px';
    taskModalCard.style.top = y + 'px';
    taskModalCard.style.right = 'auto';
    taskModalCard.style.bottom = 'auto';
  }
});

document.addEventListener('touchend', () => {
  isDraggingTaskModal = false;
});

function refreshPanelEmpty() {
  document.getElementById('task-modal-title').innerHTML = 'task inspector';
  document.getElementById('task-modal-body').innerHTML = '<div class="empty-state"><div class="icon">&#128100;</div><h3>Agent Inspector</h3><p>Click a character on the office floor or an agent chip above to inspect their task.</p></div>';
  document.getElementById('task-modal-actions').innerHTML = '';
}

async function openPanel(id, silent) {
  const r = await fetch('/api/tasks/' + id);
  if (!r.ok) return;
  const { task, events } = await r.json();
  panelTask = { task, events };
  document.getElementById('task-modal-title').innerHTML =
    '<span class="task-id-text mono">' + task.id + '</span> <span class="status-badge ' + task.status + '"><span class="status-dot" style="background:' + STATUS_COLOR[task.status] + '"></span>' + task.status + '</span>';
  renderPanel(panelTask);
}

function renderPanel(data) {
  const { task, events } = data;
  if (activeTab === 'overview') renderOverview(task, events);
  else if (activeTab === 'timeline') renderTimeline(task, events);
  else if (activeTab === 'diff') renderDiffTab(task);
  else if (activeTab === 'settings') renderSettings(task);
  // actions
  const actions = document.getElementById('task-modal-actions');
  actions.innerHTML = '';
  if (task.branch && task.status !== 'merged') actions.appendChild(btn('Show Diff', '', () => { activeTab = 'diff'; document.querySelectorAll('#task-modal-tabs .tab').forEach(t => t.classList.remove('active')); document.querySelector('#task-modal-tabs .tab[data-tab="diff"]').classList.add('active'); renderDiffTab(task); }));
  if (task.status === 'done') actions.appendChild(btn('Merge', 'primary', () => act(task.id, 'merge')));
  if (['queued','running','verifying','done','failed'].includes(task.status))
    actions.appendChild(btn(task.status === 'running' ? 'Kill' : 'Discard', 'danger', () => act(task.id, 'cancel')));
}

function renderSettings(task) {
  let html = '<div class="prompt-card"><div class="prompt-text">' + esc(task.prompt) + '</div></div>';
  html += '<div class="sec-label">Agent Settings</div>';
  html += '<form class="settings-form" id="settings-form">';
  
  html += '<div class="form-group"><label>Engine</label>';
  html += '<select id="set-engine">';
  const engines = ['claude', 'opencode', 'codex', 'generic'];
  for (const eng of engines) {
    const sel = task.engine === eng ? 'selected' : '';
    html += '<option value="' + eng + '" ' + sel + '>' + eng + '</option>';
  }
  html += '</select></div>';
  
  html += '<div class="form-group"><label>Model Override</label>';
  html += '<input id="set-model" value="' + esc(task.model || '') + '" placeholder="e.g. claude-haiku-4-5">';
  html += '</div>';

  html += '<div class="form-group"><label>Isolated Git Branch</label>';
  html += '<input readonly value="' + esc(task.branch || 'no branch yet') + '">';
  html += '</div>';

  html += '<div class="form-group"><label>Worktree Folder</label>';
  html += '<input readonly value="' + esc(task.worktree || 'no worktree yet') + '">';
  html += '</div>';
  
  html += '<button type="submit" class="primary" style="margin-top:12px; justify-content:center;">Save Settings</button>';
  html += '</form>';
  
  document.getElementById('task-modal-body').innerHTML = html;
  
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const engine = document.getElementById('set-engine').value;
    const model = document.getElementById('set-model').value.trim();
    const r = await fetch('/api/tasks/' + task.id + '/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engine, model })
    });
    if (r.ok) {
      alert('Settings saved successfully!');
      panelTask.task.engine = engine;
      panelTask.task.model = model;
      refresh();
    } else {
      alert((await r.json()).error || 'Failed to save settings');
    }
  });
}

function renderOverview(task, events) {
  const cost = events.filter(e => e.type === 'cost.updated').pop();
  const files = [...new Set(events.filter(e => e.type === 'file.changed').map(e => e.path))];
  const toolCount = events.filter(e => e.type === 'tool.used').length;
  let html = '<div class="prompt-card"><div class="prompt-text">' + esc(task.prompt) + '</div>';
  html += '<div class="meta-row"><span>&#128193; ' + esc(task.repo.split('/').pop() || task.repo) + '</span>';
  if (task.model) html += '<span>&#9881; ' + esc(task.model) + '</span>';
  html += '<span>&#128339; ' + new Date(task.createdAt).toLocaleString() + '</span></div></div>';
  if (cost || task.retries > 0) {
    html += '<div class="cost-bar"><div><span class="cost-meta">Total cost</span><br><span class="cost-val">$' + (cost ? cost.costUsd.toFixed(4) : '0.0000') + '</span></div><div class="cost-meta">' + task.retries + ' retries</div></div>';
  }
  html += '<div class="sec-label">Stats</div>';
  html += '<div class="stat-grid">';
  html += '<div class="stat-card"><div class="stat-num">' + toolCount + '</div><div class="stat-label">tools used</div></div>';
  html += '<div class="stat-card"><div class="stat-num">' + files.length + '</div><div class="stat-label">files changed</div></div>';
  html += '<div class="stat-card"><div class="stat-num">' + events.length + '</div><div class="stat-label">events</div></div>';
  html += '<div class="stat-card"><div class="stat-num">' + (task.costUsd || 0).toFixed(2) + '</div><div class="stat-label">cost usd</div></div>';
  html += '</div>';
  if (files.length) {
    html += '<div class="sec-label">Files</div><div class="file-list">';
    html += files.map(f => '<div class="file-item"><span class="file-icon">&#128221;</span><span class="file-path">' + esc(f) + '</span></div>').join('');
    html += '</div>';
  }
  if (task.error) html += '<div class="error-box">' + esc(task.error) + '</div>';
  document.getElementById('task-modal-body').innerHTML = html;
}

function renderTimeline(task, events) {
  let html = '<div class="prompt-card"><div class="prompt-text">' + esc(task.prompt) + '</div></div>';
  html += '<div class="sec-label">Timeline &middot; ' + events.length + ' events</div>';
  html += '<div class="timeline">';
  for (const e of events) {
    const cls = EV_CLASS[e.type] || '';
    const icon = EV_ICON[e.type] || '&bull;';
    let txt = e.type === 'agent.message' ? e.text : e.type === 'tool.used' ? e.tool
            : e.type === 'file.changed' ? e.path : e.type === 'cost.updated' ? '$' + e.costUsd.toFixed(4)
            : e.type === 'task.finished' ? (e.success ? 'Completed' : 'Failed: ' + (e.error || '')) : e.type;
    html += '<div class="ev ' + cls + '"><span class="ev-icon">' + icon + '</span><span class="ev-text">' + esc(String(txt)) + '</span></div>';
  }
  html += '</div>';
  if (task.error) html += '<div class="error-box">' + esc(task.error) + '</div>';
  document.getElementById('task-modal-body').innerHTML = html;
}

function renderDiffTab(task) {
  if (!task.branch) {
    document.getElementById('task-modal-body').innerHTML = '<div class="empty-state"><div class="icon">&#128196;</div><h3>No diff yet</h3><p>The agent has not committed any changes yet.</p></div>';
    return;
  }
  document.getElementById('task-modal-body').innerHTML = '<div class="prompt-card"><div class="prompt-text">' + esc(task.prompt) + '</div></div><div class="sec-label">Unified diff</div><div id="diffbox" style="text-align:center;color:var(--dim);padding:24px;background:rgba(30,30,46,0.3);border-radius:var(--radius);border:1px solid var(--line)"><span style="animation:pulse 1.5s infinite">Loading diff...</span></div>';
  showDiff(task.id);
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

// Global settings modal logic
const settingsModal = document.getElementById('settings-modal');
const openSettingsBtn = document.getElementById('btn-global-settings');
const closeSettingsBtn = document.getElementById('modal-close');
const cancelSettingsBtn = document.getElementById('modal-cancel');

async function openSettings() {
  const r = await fetch('/api/config');
  if (r.ok) {
    const config = await r.json();
    document.getElementById('global-engine').value = config.engine || 'claude';
    document.getElementById('global-model').value = config.model || '';
    document.getElementById('global-concurrency').value = config.concurrency || 2;
    document.getElementById('global-max-retries').value = config.maxRetries || 2;
    document.getElementById('global-verify').value = config.verify || '';
    document.getElementById('global-budget-task').value = (config.budget && config.budget.perTask) || '';
    document.getElementById('global-budget-day').value = (config.budget && config.budget.perDay) || '';
    document.getElementById('global-notify-webhook').value = (config.notify && config.notify.webhook) || '';
  }
  settingsModal.style.display = 'flex';
  settingsModal.offsetHeight; // trigger reflow
  settingsModal.classList.add('open');
}

function closeSettings() {
  settingsModal.classList.remove('open');
  setTimeout(() => {
    if (!settingsModal.classList.contains('open')) {
      settingsModal.style.display = 'none';
    }
  }, 300);
}

openSettingsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', closeSettings);
cancelSettingsBtn.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

// Global settings form submit
document.getElementById('global-settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const engine = document.getElementById('global-engine').value;
  const model = document.getElementById('global-model').value.trim();
  const concurrency = document.getElementById('global-concurrency').value;
  const maxRetries = document.getElementById('global-max-retries').value;
  const verify = document.getElementById('global-verify').value.trim();
  const budgetTask = document.getElementById('global-budget-task').value;
  const budgetDay = document.getElementById('global-budget-day').value;
  const notifyWebhook = document.getElementById('global-notify-webhook').value.trim();
  
  const payload = {
    engine,
    model,
    verify,
    maxRetries: Number(maxRetries),
    concurrency: Number(concurrency),
    budget: {
      perTask: budgetTask ? Number(budgetTask) : undefined,
      perDay: budgetDay ? Number(budgetDay) : undefined
    },
    notify: {
      webhook: notifyWebhook || undefined
    }
  };
  
  const r = await fetch('/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  if (r.ok) {
    alert('Global settings saved successfully!');
    closeSettings();
  } else {
    alert((await r.json()).error || 'Failed to save global settings');
  }
});

new EventSource('/api/stream').onmessage = () => refresh();
refresh();
</script>
</body>
</html>`;
