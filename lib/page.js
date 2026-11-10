// /swm 管理面板：零依赖单页。主题跟随宿主 DSH（读取父文档 body 上的 --dsw-* token 并同步变化）。
export const PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>会话工作区管理 · DSH</title>
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 14px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    background: var(--dsw-alias-bg-base, #0f1115); color: var(--dsw-alias-label-primary, #d7dae0); padding: 0; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--dsw-alias-border-l3, #23262e); position: sticky; top: 0; background: var(--dsw-alias-bg-base, #0f1115); z-index: 5; }
  header h1 { font-size: 16px; font-weight: 600; }
  header .sub { color: var(--dsw-alias-label-tertiary, #7c828e); font-size: 12px; }
  header .sp { flex: 1; }
  button { background: transparent; color: var(--dsw-alias-label-primary, #d7dae0); border: 1px solid var(--dsw-alias-border-l3, #2c313d); border-radius: 8px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
  button:hover { background: var(--dsw-alias-interactive-bg-hover, #262b37); }
  main { display: grid; grid-template-columns: 320px 1fr; gap: 0; min-height: calc(100vh - 55px); }
  #wsCol { border-right: 1px solid var(--dsw-alias-border-l3, #23262e); padding: 14px; overflow-y: auto; }
  #mainCol { padding: 14px 20px; overflow-y: auto; }
  .ws { border: 1px solid var(--dsw-alias-border-l3, #2c313d); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; cursor: pointer; }
  .ws:hover { border-color: var(--dsw-alias-border-l2, #3d4450); background: var(--dsw-alias-interactive-bg-hover, #161a22); }
  .ws.sel { border-color: var(--dsw-alias-state-business-primary, #4c8dff); background: var(--dsw-alias-interactive-bg-hover, #16202e); }
  .ws .t { font-weight: 600; }
  .ws .p { color: var(--dsw-alias-label-tertiary, #7c828e); font-size: 12px; word-break: break-all; }
  .ws .n { float: right; color: var(--dsw-alias-state-business-primary, #4c8dff); font-size: 12px; }
  .badge { display: inline-block; background: var(--dsw-alias-bg-layer-1, #1d212b); border: 1px solid var(--dsw-alias-border-l3, #2c313d); color: var(--dsw-alias-label-secondary, #9aa1ad); border-radius: 10px; font-size: 11px; padding: 1px 8px; margin-left: 6px; }
  .session { border: 1px solid var(--dsw-alias-border-l3, #2c313d); border-radius: 10px; margin-bottom: 10px; }
  .session .head { display: flex; gap: 10px; align-items: center; padding: 10px 12px; cursor: pointer; }
  .session .head:hover { background: var(--dsw-alias-interactive-bg-hover, #161a22); }
  .session .id { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--dsw-alias-label-tertiary, #7c828e); }
  .session .meta { color: var(--dsw-alias-label-tertiary, #7c828e); font-size: 12px; }
  .session .files { border-top: 1px solid var(--dsw-alias-border-l3, #23262e); padding: 10px 14px; display: none; background: var(--dsw-alias-bg-layer-1, #12151c); border-radius: 0 0 10px 10px; }
  .session.open .files { display: block; }
  .flist { margin: 4px 0 10px; }
  .flist .fp { font-size: 13px; word-break: break-all; padding: 2px 0; }
  .flist .fp .cnt { color: var(--dsw-alias-label-tertiary, #7c828e); font-size: 12px; }
  h3 { font-size: 13px; margin: 8px 0 4px; color: var(--dsw-alias-label-secondary, #b9c0ca); }
  .empty { color: var(--dsw-alias-label-tertiary, #565d68); padding: 24px; text-align: center; }
  .err { color: var(--dsw-alias-state-error-primary, #ff7b72); font-size: 13px; white-space: pre-wrap; }
  .warn { color: var(--dsw-alias-state-warning-primary, #e3b341); }
  .loading { color: var(--dsw-alias-label-tertiary, #7c828e); padding: 20px; }
  .wtag { display: inline-block; background: var(--dsw-alias-bg-layer-1, #1d212b); border: 1px solid var(--dsw-alias-border-l3, #2c313d); border-radius: 6px; padding: 0 6px; font-size: 11px; color: var(--dsw-alias-label-secondary, #9aa1ad); }
  .probe-item { display: flex; gap: 10px; align-items: baseline; padding: 5px 0; }
  .probe-item .ic { flex: 0 0 auto; }
  .probe-item .tt { font-weight: 600; color: var(--dsw-alias-label-secondary, #b9c0ca); }
  .probe-item .dt { color: var(--dsw-alias-label-secondary, #9aa1ad); font-size: 13px; }
  .probe-item .mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--dsw-alias-label-tertiary, #7c828e); }
  .probe-title { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
  .fname { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
  .fopen { font-size: 11px; color: var(--dsw-alias-label-tertiary, #7c828e); text-decoration: none; cursor: pointer; margin-left: 6px; border: 1px solid var(--dsw-alias-border-l3, #2c313d); border-radius: 6px; padding: 0 6px; }
  .fopen:hover { color: var(--dsw-alias-state-business-primary, #4c8dff); border-color: var(--dsw-alias-state-business-primary, #4c8dff); }
  .modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 40; display: none; align-items: center; justify-content: center; }
  .modal-mask.open { display: flex; }
  .modal { width: min(680px, 92vw); max-height: 82vh; overflow-y: auto; background: var(--dsw-alias-bg-base, #0f1115); border: 1px solid var(--dsw-alias-border-l3, #2c313d); border-radius: 12px; box-shadow: 0 18px 60px rgba(0,0,0,0.45); }
  .modal-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l3, #23262e); position: sticky; top: 0; background: var(--dsw-alias-bg-base, #0f1115); z-index: 2; }
  .modal-body { padding: 14px 18px 18px; }
  .themeWrap { position: relative; }
  #themeMenu { position: absolute; right: 0; top: calc(100% + 6px); background: var(--dsw-alias-bg-base, #0f1115); border: 1px solid var(--dsw-alias-border-l3, #2c313d); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,0.3); padding: 6px; display: none; z-index: 30; min-width: 150px; }
  #themeMenu.open { display: block; }
  #themeMenu .mi { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--dsw-alias-label-primary, #d7dae0); }
  #themeMenu .mi:hover { background: var(--dsw-alias-interactive-bg-hover, #262b37); }
  #themeMenu .mi.on { color: var(--dsw-alias-state-business-primary, #4c8dff); }
  #themeMenu .mi .tick { width: 16px; text-align: center; }
  .flink { color: var(--dsw-alias-state-business-primary, #4c8dff); text-decoration: none; cursor: pointer; }
  .flink:hover { text-decoration: underline; }
  .del-btn { border-color: var(--dsw-alias-state-error-primary, #ff7b72); color: var(--dsw-alias-state-error-primary, #ff7b72); padding: 2px 10px; font-size: 12px; border-radius: 6px; flex: 0 0 auto; }
  .del-btn:hover { background: var(--dsw-alias-state-error-primary, #ff7b72); color: #fff; }
  .mov-btn { border-color: var(--dsw-alias-state-business-primary, #4c8dff); color: var(--dsw-alias-state-business-primary, #4c8dff); padding: 2px 10px; font-size: 12px; border-radius: 6px; flex: 0 0 auto; }
  .mov-btn:hover { background: var(--dsw-alias-state-business-primary, #4c8dff); color: #fff; }
  .mov-select { background: var(--dsw-alias-bg-layer-1, #1d212b); color: var(--dsw-alias-label-primary, #d7dae0); border: 1px solid var(--dsw-alias-border-l3, #2c313d); border-radius: 8px; padding: 6px 10px; font-size: 13px; width: 100%; }
  .sel-chk { flex: 0 0 auto; cursor: pointer; }
  .batch-bar { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l3, #2c313d); border-radius: 10px; margin-bottom: 12px; font-size: 13px; flex-wrap: wrap; }
  .batch-bar .cnt { color: var(--dsw-alias-state-business-primary, #4c8dff); font-weight: 600; }
  .del-row { display: flex; gap: 8px; align-items: baseline; padding: 2px 0; font-size: 13px; word-break: break-all; }
  .del-row input { flex: 0 0 auto; }
  .del-group { margin: 10px 0 2px; font-weight: 600; color: var(--dsw-alias-label-secondary, #b9c0ca); font-size: 13px; }
  .del-sub { margin-left: 24px; }
  .del-warn { color: var(--dsw-alias-state-warning-primary, #e3b341); font-size: 12px; margin-top: 10px; }
  .codeblock { margin: 6px 0; border: 1px solid var(--dsw-alias-border-l3, #2c313d); border-radius: 8px; overflow: hidden; }
  .codehead { font-size: 11px; color: var(--dsw-alias-label-tertiary, #7c828e); padding: 4px 10px; background: var(--dsw-alias-bg-layer-1, #1d212b); display: flex; gap: 8px; align-items: center; }
  .codeblock pre { margin: 0; padding: 10px 12px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.5; overflow: auto; max-height: 320px; white-space: pre; color: var(--dsw-alias-label-primary, #d7dae0); }
</style>
</head>
<body>
<header>
  <h1>会话工作区管理</h1>
  <span class="sub">M1 · 只读</span>
  <span class="sp"></span>
  <span class="themeWrap">
    <button id="btnTheme">🎨 主题</button>
    <span id="themeMenu">
      <span class="mi" data-mode="host"><span class="tick"></span>适应DSH</span>
      <span class="mi" data-mode="light"><span class="tick"></span>☀️ 浅色</span>
      <span class="mi" data-mode="dark"><span class="tick"></span>🌙 暗色</span>
    </span>
  </span>
  <button id="btnTrash">🗑 回收站</button>
  <button id="btnProbe">🩺 体检报告</button>
  <button id="btnRefresh">刷新</button>
</header>
<main>
  <div id="wsCol"><div class="loading">加载中…</div></div>
  <div id="mainCol"><div class="empty">← 选择左侧工作区查看会话</div></div>
</main>
<div class="modal-mask" id="probeModal">
  <div class="modal">
    <div class="modal-head"><strong>🩺 系统体检报告</strong><span style="flex:1"></span><button id="btnProbeClose">关闭</button></div>
    <div class="modal-body" id="probeBody"></div>
  </div>
</div>
<div class="modal-mask" id="delModal">
  <div class="modal">
    <div class="modal-head"><strong id="delModalTitle">🗑 删除会话</strong><span style="flex:1"></span><button id="btnDelClose">关闭</button></div>
    <div class="modal-body" id="delBody"></div>
    <div class="modal-head" id="delFoot" style="border-top:1px solid var(--dsw-alias-border-l3,#23262e);border-bottom:0"></div>
  </div>
</div>
<div class="modal-mask" id="trashModal">
  <div class="modal" style="width:min(760px,94vw)">
    <div class="modal-head"><strong>🗑 插件回收站</strong><span style="flex:1"></span><button id="btnTrashClose">关闭</button></div>
    <div class="modal-body" id="trashBody"></div>
    <div class="modal-head" id="trashFoot" style="border-top:1px solid var(--dsw-alias-border-l3,#23262e);border-bottom:0"></div>
  </div>
</div>
<script>
// 主题控制：三档（适应DSH / 浅色 / 暗色），按钮点出菜单选择，存 localStorage。
// 每次应用前先清空本页设置过的变量（避免上一档残留串色）；
// 「适应DSH」读宿主 <html data-ds-theme-source="light|dark">（DSH 设置-外观的真实标记）选对应配色。
(function () {
  const MODES = ['host', 'light', 'dark'];
  const THEME_VARS = [
    '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1',
    '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
    '--dsw-alias-border-l2', '--dsw-alias-border-l3',
    '--dsw-alias-interactive-bg-hover', '--dsw-alias-state-business-primary',
    '--dsw-alias-state-warning-primary', '--dsw-alias-state-error-primary', '--dsw-alias-state-success-primary',
  ];
  const PALETTES = {
    light: {
      bg: '#f8f9fb', layer1: '#eef0f4', text: '#1a1d24', text2: '#4b515c', text3: '#8a909c',
      border: '#dfe2e8', border2: '#cfd3da', hover: '#e9ecf1', accent: '#2f6fed',
      warn: '#b5830f', err: '#d5345a', ok: '#1a7f37', scheme: 'light',
    },
    dark: {
      bg: '#151517', layer1: '#232324', text: '#f9fafb', text2: '#a8aeb9', text3: '#7c828e',
      border: '#2c2c30', border2: '#3a3a40', hover: '#ffffff14', accent: '#7aaaff',
      warn: '#e3b341', err: '#ff7b72', ok: '#3fb950', scheme: 'dark',
    },
  };
  function getMode() {
    const m = localStorage.getItem('swm-theme');
    return MODES.indexOf(m) >= 0 ? m : 'host';
  }
  function applyPalette(p) {
    const dst = document.documentElement.style;
    setVar('--dsw-alias-bg-base', p.bg);
    setVar('--dsw-alias-bg-layer-1', p.layer1);
    setVar('--dsw-alias-label-primary', p.text);
    setVar('--dsw-alias-label-secondary', p.text2);
    setVar('--dsw-alias-label-tertiary', p.text3);
    setVar('--dsw-alias-border-l2', p.border2);
    setVar('--dsw-alias-border-l3', p.border);
    setVar('--dsw-alias-interactive-bg-hover', p.hover);
    setVar('--dsw-alias-state-business-primary', p.accent);
    setVar('--dsw-alias-state-warning-primary', p.warn);
    setVar('--dsw-alias-state-error-primary', p.err);
    setVar('--dsw-alias-state-success-primary', p.ok);
    document.documentElement.style.colorScheme = p.scheme;
  }
  function setVar(name, value) {
    document.documentElement.style.setProperty(name, value);
    if (appliedProps.indexOf(name) < 0) appliedProps.push(name);
  }
  let appliedProps = [];
  function clearVars() {
    for (const n of appliedProps) document.documentElement.style.removeProperty(n);
    appliedProps = [];
  }
  function hostThemeSource() {
    try {
      if (window.parent === window) return null;
      const h = window.parent.document.documentElement;
      const v = (h.getAttribute('data-ds-theme-source') || '').toLowerCase();
      if (v === 'dark' || v === 'light') return v;
      const b = window.parent.document.body;
      if (b && b.hasAttribute('data-ds-dark-theme')) return 'dark';
      const cs = b ? window.getComputedStyle(b).colorScheme : '';
      if (cs && cs.indexOf('light') >= 0) return 'light';
      if (cs && cs.indexOf('dark') >= 0) return 'dark';
      return null;
    } catch (e) {
      return null;
    }
  }
  function applyTheme() {
    const mode = getMode();
    clearVars();
    let resolved = mode;
    if (mode === 'host') {
      const hs = hostThemeSource();
      resolved = hs || ((window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark');
    }
    applyPalette(PALETTES[resolved]);
    document.querySelectorAll('#themeMenu .mi').forEach((mi) => {
      const on = mi.getAttribute('data-mode') === mode;
      mi.classList.toggle('on', on);
      mi.querySelector('.tick').textContent = on ? '✓' : '';
    });
  }
  window.__swmApplyTheme = applyTheme;
  applyTheme();
  try {
    if (window.parent !== window) {
      const doc = window.parent.document;
      const mo = new MutationObserver(applyTheme);
      mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-ds-theme-source', 'data-ds-dark-theme', 'class', 'style'] });
      mo.observe(doc.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] });
    }
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (getMode() === 'host') applyTheme();
      });
    }
  } catch (e) {}
  function bindThemeUi() {
    const btn = document.getElementById('btnTheme');
    const menu = document.getElementById('themeMenu');
    if (!btn || !menu) return;
    btn.onclick = (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    };
    menu.querySelectorAll('.mi').forEach((mi) => {
      mi.onclick = () => {
        localStorage.setItem('swm-theme', mi.getAttribute('data-mode'));
        applyTheme();
        menu.classList.remove('open');
      };
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== btn) menu.classList.remove('open');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindThemeUi);
  else bindThemeUi();
})();

const $ = (s) => document.querySelector(s);
let overview = null;
let selectedWs = null;

async function api(path, opts) {
  let r;
  try {
    r = await fetch('/swm/api' + path, opts);
  } catch (e) {
    throw new Error('连接失败：DSH 可能已重启，本页面已失效。请关闭此旧页面，从 DSH 左侧「会话管理」重新打开。');
  }
  const data = await r.json().catch(() => ({ ok: false, error: { message: '响应不是 JSON' } }));
  if (!r.ok || data.ok === false) throw new Error(data.error?.message || ('HTTP ' + r.status));
  return data;
}

function fmtTime(t) {
  if (!t) return '—';
  const d = typeof t === 'number' ? new Date(t) : new Date(t);
  if (isNaN(d)) return String(t);
  return d.toLocaleString('zh-CN', { hour12: false });
}
function fmtSize(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i];
}
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function displayName(s) {
  if (s && s.title) return s.title;
  if (s && s.id) return '未命名会话 ' + s.id.replace('session-', '').slice(0, 8);
  return '(未知会话)';
}

let lastOverviewRaw = '';
let overviewInFlight = false;
async function loadOverview(force) {
  if (overviewInFlight) return;
  overviewInFlight = true;
  try {
    const data = await api('/overview');
    const raw = JSON.stringify(data);
    // 数据没变化时跳过重绘（保留展开状态、避免闪烁）；force = 手动强制刷新
    if (!force && raw === lastOverviewRaw) return;
    lastOverviewRaw = raw;
    overview = data;
    renderWorkspaces();
    if (selectedWs == null && overview.workspaces.length) { selectedWs = overview.workspaces[0].id; renderWorkspaces(); }
    renderSessions();
  } catch (e) {
    if (force || !lastOverviewRaw) $('#wsCol').innerHTML = '<div class="err">' + esc(e.message) + '</div>';
  } finally {
    overviewInFlight = false;
  }
}

function renderWorkspaces() {
  const col = $('#wsCol'); col.innerHTML = '';
  for (const w of overview.workspaces) {
    const div = document.createElement('div');
    div.className = 'ws' + (w.id === selectedWs ? ' sel' : '');
    div.innerHTML = '<span class="n">' + (w.sessions ? w.sessions.length : (w.sessionIds || []).length) + ' 会话</span>'
      + '<div class="t">' + esc(w.title || '(未命名工作区)') + (w.id === overview.defaultWorkspaceId ? '<span class="badge">默认</span>' : '') + '</div>'
      + '<div class="p">' + esc(w.path || '') + '</div>';
    div.onclick = () => { selectedWs = w.id; renderWorkspaces(); renderSessions(); };
    col.appendChild(div);
  }
  if (overview.archived?.length) {
    const h = document.createElement('div');
    h.innerHTML = '<h3 style="margin-top:14px">🗄 归档会话 <span class="wtag">' + overview.archived.length + '</span></h3>';
    col.appendChild(h);
  }
  if (overview.orphans?.length) {
    const h = document.createElement('div');
    h.innerHTML = '<h3 style="margin-top:14px"><span class="warn">⚠ 磁盘孤儿会话</span> <span class="wtag">' + overview.orphans.length + '</span></h3>'
      + '<div style="color:var(--dsw-alias-label-tertiary,#7c828e);font-size:12px">在 sessions/ 目录存在但不在任何工作区注册表中</div>';
    col.appendChild(h);
  }
}

function sessionRow(s, clickable) {
  const div = document.createElement('div');
  div.className = 'session';
  const short = s.id ? s.id.replace('session-', '').slice(0, 8) : '';
  let filesTag = '';
  if (s.fileCounts && s.fileCounts.results > 0) filesTag = '<span class="wtag">📦 ' + s.fileCounts.results + ' 个成果</span>';
  const missingTag = s.missing ? '<span class="wtag" style="color:var(--dsw-alias-state-error-primary,#ff7b72)">记录缺失</span>' : '';
  const emptyTag = s.empty ? '<span class="wtag" title="开过但没聊过（0 条消息）。DSH 界面不显示空会话，但数据已在磁盘注册；可勾选后批量删除。">空会话</span>' : '';
  const archivedTag = s.__archived ? '<span class="wtag">归档</span>' : '';
  const orphanTag = s.__orphan ? '<span class="wtag" style="color:var(--dsw-alias-state-warning-primary,#e3b341)">孤儿</span>' : '';
  const head = '<div class="head">'
    + (batchMode ? '<input type="checkbox" class="sel-chk" data-sel="' + esc(s.id) + '"' + (selectedSessions.has(s.id) ? ' checked' : '') + '>' : '')
    + '<strong>' + esc(displayName(s)) + '</strong>'
    + '<span class="id">' + short + '</span>'
    + filesTag + emptyTag + archivedTag + orphanTag + missingTag
    + '<span style="flex:1"></span>'
    + '<span class="meta">' + fmtTime(s.createdAt) + ' · ' + fmtSize(s.sizeBytes) + '</span>'
    + '<button class="del-btn" data-del="' + esc(s.id) + '">删除</button></div>';
  if (!clickable) { div.innerHTML = head; return div; }
  div.innerHTML = head + '<div class="files"><div class="loading">点击展开…</div></div>';
  const selBox = div.querySelector('.head .sel-chk');
  if (selBox) selBox.onclick = (ev) => {
    ev.stopPropagation();
    if (ev.target.checked) selectedSessions.add(s.id);
    else selectedSessions.delete(s.id);
    updateBatchBar();
  };
  div.querySelector('.head .del-btn').onclick = (ev) => {
    ev.stopPropagation();
    openDeleteModal(s);
  };
  div.querySelector('.head').onclick = async () => {
    const open = div.classList.toggle('open');
    if (!open) return;
    const box = div.querySelector('.files');
    box.innerHTML = '<div class="loading">解析正文…</div>';
    try {
      const d = await api('/session/' + encodeURIComponent(s.id) + '/detail');
      const results = (d.files.results || []).slice().sort((a, b) => a.path.localeCompare(b.path));
      const others = (d.files.others || []).slice().sort((a, b) => a.path.localeCompare(b.path));
      const srcLabel = { export: '导出', 'final-answer': 'AI答复', 'doc-type': '文档' };
      let html = '';
      html += '<h3>会话信息</h3><div class="fp">标题: ' + esc(d.title || '未命名会话') + '</div>'
        + '<div class="fp">工作目录: ' + esc(d.header?.cwd || '—') + '</div>'
        + '<div class="fp">轮次: ' + d.turns + '</div>';
      // 对话中的代码（按钮开关）
      const codes = d.codeBlocks || [];
      html += '<div style="margin:8px 0"><button id="btnCodeToggle">💻 显示对话中的代码（' + codes.length + ' 段）</button></div>'
        + '<div id="codeList" style="display:none">';
      for (const c of codes) {
        const t = c.time ? fmtTime(c.time) : '';
        html += '<div class="codeblock"><div class="codehead"><span>' + esc(c.source) + '</span>'
          + (c.lang ? '<span class="wtag">' + esc(c.lang) + '</span>' : '')
          + '<span style="flex:1"></span><span>' + t + '</span></div><pre>' + esc(c.text) + '</pre></div>';
      }
      if (!codes.length) html += '<div class="fp" style="color:var(--dsw-alias-label-tertiary,#7c828e)">（这段对话里没有识别到代码）</div>';
      html += '</div>';
      html += '<h3>📦 成果文件 <span class="wtag">' + results.length + '</span></h3><div class="flist">';
      if (results.length) {
        for (const f of results) {
          const q = encodeURIComponent(f.path);
          if (f.isFolder) {
            html += '<div class="fp">📁 <a class="flink fname" href="#" data-open="' + q + '" data-folder="1" title="点击打开该文件夹">' + esc(f.path) + '</a>'
              + '<span class="wtag" style="margin-left:6px">🖼 图片 ×' + f.count + '</span></div>';
          } else {
            const src = (f.sources || []).map((s2) => srcLabel[s2] || s2).join('/');
            html += '<div class="fp">📄 <a class="flink fname" href="#" data-reveal="' + q + '" title="点击在资源管理器中定位该文件">' + esc(f.path) + '</a>'
              + (src ? '<span class="wtag" style="margin-left:6px">' + src + '</span>' : '')
              + '<a class="fopen" href="#" data-open="' + q + '">打开</a></div>';
          }
        }
      } else {
        html += '<div class="fp">(这个会话没有识别出成果文件)</div>';
      }
      html += '</div>';
      if (others.length) {
        html += '<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--dsw-alias-label-tertiary,#7c828e);font-size:12px">🔩 其他过程文件（AI 中间产物，' + others.length + ' 个）</summary><div class="flist" style="margin-top:6px">';
        for (const f of others) {
          const q = encodeURIComponent(f.path);
          html += '<div class="fp" style="color:var(--dsw-alias-label-tertiary,#7c828e)">📄 <a class="flink fname" href="#" data-reveal="' + q + '">' + esc(f.path) + '</a></div>';
        }
        html += '</div></details>';
      }
      html += '<div class="fp" style="color:var(--dsw-alias-label-tertiary,#7c828e);font-size:12px">成果 = 文档导出、AI 最终答复交付、或生成的文档类文件。点击文件名 = 在资源管理器中定位该文件；「打开」= 用系统默认程序打开（有确认，脚本类文件会提示）；点击图片文件夹 = 打开该文件夹。</div>';
      box.innerHTML = html;
      const codeBtn = box.querySelector('#btnCodeToggle');
      const codeList = box.querySelector('#codeList');
      if (codeBtn && codeList) {
        codeBtn.onclick = () => {
          const show = codeList.style.display === 'none';
          codeList.style.display = show ? 'block' : 'none';
          codeBtn.textContent = (show ? '💻 隐藏对话中的代码' : '💻 显示对话中的代码') + '（' + codes.length + ' 段）';
        };
      }
      box.querySelectorAll('[data-reveal]').forEach((a) => {
        a.onclick = (ev) => {
          ev.preventDefault();
          api('/reveal?path=' + a.getAttribute('data-reveal')).catch((err) => alert(err.message));
        };
      });
      box.querySelectorAll('[data-open]').forEach((a) => {
        a.onclick = (ev) => {
          ev.preventDefault();
          if (a.getAttribute('data-folder')) {
            api('/open?path=' + a.getAttribute('data-open')).catch((err) => alert(err.message));
            return;
          }
          if (!confirm('用系统默认程序打开该文件？脚本类文件（.bat/.ps1 等）将被执行。')) return;
          api('/open?path=' + a.getAttribute('data-open')).catch((err) => alert(err.message));
        };
      });
    } catch (err) {
      box.innerHTML = '<div class="err">' + esc(err.message) + '</div>';
    }
  };
  return div;
}

function renderSessions() {
  const col = $('#mainCol');
  const w = overview.workspaces.find(x => x.id === selectedWs);
  if (!w) { col.innerHTML = '<div class="empty">未选择工作区</div>'; return; }
  col.innerHTML = '<h3 style="margin-bottom:10px;font-size:15px">' + esc(w.title || '') + ' 的会话'
    + ' <button id="btnBatchMode" class="mov-btn">' + (batchMode ? '✕ 退出批量选择' : '☑ 批量选择') + '</button></h3>';
  if (batchMode) {
    const bar = document.createElement('div');
    bar.className = 'batch-bar';
    bar.id = 'batchBar';
    col.appendChild(bar);
  }
  if (!w.sessions || !w.sessions.length) {
    col.innerHTML += '<div class="empty">该工作区没有会话</div>';
  }
  for (const s of (w.sessions || [])) col.appendChild(sessionRow(s, true));
  for (const s of (overview.archived || [])) { const c = Object.assign({}, s); c.__archived = true; col.appendChild(sessionRow(c, true)); }
  for (const s of (overview.orphans || [])) { const c = Object.assign({}, s); c.__orphan = true; col.appendChild(sessionRow(c, true)); }
  if (batchMode) updateBatchBar();
  const bbtn = col.querySelector('#btnBatchMode');
  if (bbtn) bbtn.onclick = () => {
    batchMode = !batchMode;
    if (!batchMode) selectedSessions.clear();
    renderSessions();
  };
}

$('#btnRefresh').onclick = () => loadOverview(true);
const probeModal = $('#probeModal');
$('#btnProbe').onclick = async () => {
  probeModal.classList.add('open');
  const body = $('#probeBody');
  body.innerHTML = '<div style="color:var(--dsw-alias-label-tertiary,#7c828e)">检查中…</div>';
  try {
    const d = await api('/probe');
    const items = [];
    const add = (ic, tt, dt, mono) => items.push({ ic, tt, dt, mono });
    if (d.hasZstd && d.selfTest) {
      add('✅', '会话记录读取', '正常 — 能完整解读 DSH 的会话文件（解压器自测通过，样本 ' + d.selfTest.frames + ' 帧）');
    } else {
      add('⚠️', '会话记录读取', '异常 — 无法解读会话文件，文件归属功能将不可用');
    }
    add(d.workspaceCount > 0 ? '✅' : '⚠️', '工作区名单',
      d.workspaceCount + ' 个工作区 · 磁盘上共 ' + d.sessionDirCount + ' 个会话记录' + (d.workspaceCount > 0 ? '' : '（还没创建任何工作区）'));
    const samples = d.encodingSamples || [];
    if (samples.length) {
      const detail = samples.map(s => esc(s.path) + ' ⇄ ' + s.dirName).join('；');
      add('✅', '工作区位置识别', '全部能对上号：' + detail);
    } else {
      add('⚠️', '工作区位置识别', '暂时没能把工作区和会话目录对应起来（不影响查看与删除）');
    }
    add('ℹ️', '运行环境', '', 'Node ' + esc(d.nodeVersion) + ' · DSH 数据目录 ' + esc(d.dshHome));
    add('ℹ️', '访问安全', d.services.connection
      ? '已接入 DSH 的登录鉴权'
      : '仅限本机（127.0.0.1）访问，外部设备打不开这个页面');
    add('📌', '当前能力', '查看：可用 · 删除：可用（回收站） · 数据体检：可用');
    const probeHtml = items.map(i => '<div class="probe-item"><span class="ic">' + i.ic + '</span><span class="tt">' + esc(i.tt) + '</span><span class="dt">'
      + i.dt + (i.mono ? ' <span class="mono">' + i.mono + '</span>' : '') + '</span></div>').join('');
    body.innerHTML = probeHtml + '<div id="healthSection"><div class="loading">数据一致性检查中…</div></div>';
    loadHealthSection(body.querySelector('#healthSection'));
  } catch (e) {
    body.innerHTML = '<div class="err">' + esc(e.message) + '</div>';
  }
};

// ---------- 数据体检（一致性检测 + 一键修复） ----------
async function loadHealthSection(box) {
  if (!box) return;
  try {
    const h = await api('/health');
    if (!h.issues.length) {
      box.innerHTML = '<div class="probe-item"><span class="ic">✅</span><span class="tt">数据一致性</span><span class="dt">全部正常（注册表引用、会话缓存、备份文件均无问题）</span></div>';
      return;
    }
    let html = '<div class="probe-title" style="margin-top:14px">🔧 数据体检（' + h.issues.length + ' 类问题）</div>';
    for (const iss of h.issues) {
      html += '<div class="probe-item" style="align-items:flex-start"><span class="ic">⚠️</span><span class="dt"><b class="warn">' + esc(iss.label) + '</b>'
        + '<br>' + iss.items.slice(0, 8).map((x) => '<span class="mono">' + esc(x) + '</span>').join('<br>')
        + (iss.items.length > 8 ? '<br>… 共 ' + iss.items.length + ' 项' : '') + '</span></div>';
    }
    html += '<div style="margin-top:10px"><button id="btnHealthFix" style="border-color:var(--dsw-alias-state-success-primary,#3fb950);color:var(--dsw-alias-state-success-primary,#3fb950)">🔧 一键修复以上问题</button>'
      + ' <span style="color:var(--dsw-alias-label-tertiary,#7c828e);font-size:12px">注册表修改前自动备份；会话正文与项目文件不会被改动</span></div>';
    box.innerHTML = html;
    box.querySelector('#btnHealthFix').onclick = async () => {
      const btn = box.querySelector('#btnHealthFix');
      btn.disabled = true;
      btn.textContent = '修复中…';
      try {
        const r = await api('/health/fix', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
        let html2 = '<div class="probe-title">🔧 修复结果</div>';
        for (const d of r.done || []) html2 += '<div class="probe-item"><span class="ic">✅</span><span class="dt">' + esc(d) + '</span></div>';
        for (const s of r.skipped || []) html2 += '<div class="probe-item"><span class="ic">➖</span><span class="dt">' + esc(s) + '</span></div>';
        if (!(r.done || []).length && !(r.skipped || []).length) html2 += '<div class="probe-item"><span class="ic">ℹ️</span><span class="dt">没有需要修复的内容</span></div>';
        const remain = (r.health?.issues || []).length;
        html2 += remain
          ? '<div class="del-warn">仍有 ' + remain + ' 类问题残留（可能被 DSH 占用，重启后再试）。</div>'
          : '<div class="probe-item"><span class="ic">✅</span><span class="tt">数据一致性</span><span class="dt">已全部修复</span></div>';
        box.innerHTML = html2;
        loadOverview();
      } catch (e) {
        box.innerHTML = '<div class="err">' + esc(e.message) + '</div>';
      }
    };
  } catch (e) {
    box.innerHTML = '<div class="probe-item"><span class="ic">⚠️</span><span class="tt">数据一致性</span><span class="dt">检查失败：' + esc(e.message) + '</span></div>';
  }
}
$('#btnProbeClose').onclick = () => probeModal.classList.remove('open');
probeModal.addEventListener('click', (e) => {
  if (e.target === probeModal) probeModal.classList.remove('open');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { probeModal.classList.remove('open'); delModal.classList.remove('open'); trashModal.classList.remove('open'); }
});
// ---------- 删除会话（M2） ----------
const delModal = $('#delModal');
$('#btnDelClose').onclick = () => delModal.classList.remove('open');
delModal.addEventListener('click', (e) => {
  if (e.target === delModal) delModal.classList.remove('open');
});
async function openDeleteModal(s) {
  delModal.classList.add('open');
  const body = $('#delBody');
  const foot = $('#delFoot');
  body.innerHTML = '<div class="loading">读取会话清单…</div>';
  foot.innerHTML = '';
  let detail = { files: { results: [], others: [] } };
  try {
    detail = await api('/session/' + encodeURIComponent(s.id) + '/detail');
  } catch (e) {
    /* 空会话正文缺失等：按无文件处理 */
  }
  const results = detail.files?.results || [];
  const others = detail.files?.others || [];
  let html = '';
  html += '<div class="del-group">将删除的会话记录（固定包含）</div>';
  html += '<div class="del-row">🗂 ' + esc(displayName(s)) + ' <span class="id">' + esc(s.id.replace('session-', '')) + '</span></div>';
  html += '<div class="del-row" style="color:var(--dsw-alias-label-tertiary,#7c828e);font-size:12px">会话正文目录 + 工作区注册表条目 + 缓存（处理方式见下方选择）</div>';
  html += '<div class="del-group">删除方式</div>';
  html += '<label class="del-row" style="cursor:pointer"><input type="radio" name="delMode" value="trash" checked> 📥 移入插件回收站（可随时恢复）</label>';
  html += '<label class="del-row" style="cursor:pointer"><input type="radio" name="delMode" value="recycle"> ♻ 会话 + 勾选的文件 进系统回收站</label>';
  html += '<label class="del-row" style="cursor:pointer"><input type="radio" name="delMode" value="purge"> 🔥 彻底删除（不可恢复）</label>';
  html += '<div class="del-row del-sub" id="purgeConfirmRow" style="display:none"><label style="cursor:pointer;display:flex;gap:6px;align-items:center"><input type="checkbox" id="chkPurgeOk"> 我确认要完全删除以上内容</label></div>';
  html += '<div class="del-row" id="delModeNote" style="color:var(--dsw-alias-state-business-primary,#4c8dff);font-size:12px">📥 成果文件将保留在原地不动（可稍后自行整理）。</div>';
  if (results.length || others.length) {
    html += '<div class="del-row" style="margin-top:8px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l3,#2c313d);border-radius:8px"><input type="checkbox" id="chkAllFiles"> <strong>一键全选 / 全不选</strong><span style="color:var(--dsw-alias-label-tertiary,#7c828e);font-size:12px">（共 ' + (results.length + others.length) + ' 项的展开数）</span></div>';
  }
  html += '<label class="del-group" style="display:flex;gap:8px;align-items:center;cursor:pointer;margin-top:10px"><input type="checkbox" data-group-toggle="results" checked> 📦 成果文件（默认勾选）</label>';
  let n = 0;
  for (const f of results) {
    if (f.isFolder) {
      html += '<div class="del-row">📁 ' + esc(f.path) + ' <span class="wtag">🖼 ×' + f.count + '</span></div>';
      for (const img of f.imagePaths || []) {
        n++;
        html += '<div class="del-row del-sub"><input type="checkbox" checked data-file="' + esc(img) + '" data-group="results"> <span class="fname">' + esc(img) + '</span></div>';
      }
    } else {
      n++;
      html += '<div class="del-row"><input type="checkbox" checked data-file="' + esc(f.path) + '" data-group="results"> <span class="fname">' + esc(f.path) + '</span></div>';
    }
  }
  if (!results.length) html += '<div class="del-row" style="color:var(--dsw-alias-label-tertiary,#7c828e)">（无成果文件）</div>';
  if (others.length) {
    html += '<label class="del-group" style="display:flex;gap:8px;align-items:center;cursor:pointer;margin-top:10px"><input type="checkbox" data-group-toggle="others"> 🔩 其他过程文件（默认不勾选，' + others.length + ' 个）</label>';
    for (const f of others) {
      n++;
      html += '<div class="del-row"><input type="checkbox" data-file="' + esc(f.path) + '" data-group="others"> <span class="fname">' + esc(f.path) + '</span></div>';
    }
  }
  html += '<div class="del-warn">⚠ 删除前 DSH 数据会自动备份。若 DSH 界面仍显示该会话，重启 DSH 后消失。</div>';
  body.innerHTML = html;
  function applyDelModeUi(mode) {
    const disable = mode === 'trash';
    body.querySelectorAll('input[data-file], input[data-group-toggle], #chkAllFiles').forEach((i) => { i.disabled = disable; });
    const note = body.querySelector('#delModeNote');
    if (note) note.textContent = mode === 'trash'
      ? '📥 成果文件将保留在原地不动（可稍后自行整理）；会话可随时从插件回收站恢复。'
      : mode === 'purge'
        ? '🔥 以上内容将被直接清除，不进任何回收站，无法恢复。'
        : '♻ 会话与勾选的文件将进系统回收站（可还原）。';
    const row = body.querySelector('#purgeConfirmRow');
    if (row) row.style.display = mode === 'purge' ? 'flex' : 'none';
  }
  body.querySelectorAll('input[name="delMode"]').forEach((r) => {
    r.onchange = () => applyDelModeUi(r.value);
  });
  applyDelModeUi('trash');
  foot.innerHTML = '<button id="btnDelCancel">取消</button>'
    + '<button id="btnDelGo" style="border-color:var(--dsw-alias-state-error-primary,#ff7b72);color:var(--dsw-alias-state-error-primary,#ff7b72)">删除到回收站</button>';
  $('#btnDelCancel').onclick = () => delModal.classList.remove('open');
  // 全选/分组开关
  const fileBoxes = [...body.querySelectorAll('input[data-file]')];
  const master = body.querySelector('#chkAllFiles');
  function syncGroupToggles() {
    for (const g of ['results', 'others']) {
      const boxes = fileBoxes.filter((b) => b.getAttribute('data-group') === g);
      const toggle = body.querySelector('input[data-group-toggle="' + g + '"]');
      if (!toggle || !boxes.length) continue;
      toggle.checked = boxes.every((b) => b.checked);
    }
    if (master && fileBoxes.length) {
      const all = fileBoxes.every((b) => b.checked);
      const some = fileBoxes.some((b) => b.checked);
      master.checked = all;
      master.indeterminate = some && !all;
    }
  }
  if (master) {
    syncGroupToggles();
    master.onclick = () => {
      const v = master.checked;
      fileBoxes.forEach((b) => {
        b.checked = v;
      });
      body.querySelectorAll('input[data-group-toggle]').forEach((t) => {
        t.checked = v;
      });
      master.indeterminate = false;
    };
  }
  body.querySelectorAll('input[data-group-toggle]').forEach((t) => {
    t.onclick = () => {
      const g = t.getAttribute('data-group-toggle');
      fileBoxes.filter((b) => b.getAttribute('data-group') === g).forEach((b) => {
        b.checked = t.checked;
      });
      syncGroupToggles();
    };
  });
  fileBoxes.forEach((b) => {
    b.onclick = syncGroupToggles;
  });
  $('#btnDelGo').onclick = async () => {
    const mode = (body.querySelector('input[name="delMode"]:checked') || {}).value || 'trash';
    if (mode === 'purge' && !body.querySelector('#chkPurgeOk')?.checked) { alert('请先勾选「我确认要完全删除以上内容」'); return; }
    const files = [...body.querySelectorAll('input[data-file]:checked')].map((i) => i.getAttribute('data-file'));
    const go = $('#btnDelGo');
    go.disabled = true;
    go.textContent = '删除中…';
    try {
      const r = await api('/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id, files, mode, confirmPurge: mode === 'purge' }) });
      const lines = [];
      for (const fr of r.fileResults || []) {
        lines.push('<div class="del-row">' + (fr.status === 'ok' ? '✅' : fr.status === 'missing' ? '➖' : '❌') + ' <span class="fname">' + esc(fr.path) + '</span>' + (fr.message ? ' <span class="cnt">' + esc(fr.message) + '</span>' : '') + '</div>');
      }
      lines.push('<div class="del-row">' + (r.registryUpdated ? '✅' : '⚠️') + ' 工作区注册表条目已移除（已自动备份）</div>');
      lines.push('<div class="del-row">' + (r.dirResult ? (r.dirResult.status === 'ok' ? '✅' : '❌') : '➖') + ' 会话正文目录' + (r.dirResult && r.dirResult.message ? ' <span class="cnt">' + esc(r.dirResult.message) + '</span>' : '') + '</div>');
      lines.push('<div class="del-row">' + (r.cacheResult ? (r.cacheResult.status === 'ok' ? '✅' : '❌') : '➖') + ' 会话缓存</div>');
      lines.push('<div class="del-warn">' + esc(r.note || '') + '</div>');
      body.innerHTML = lines.join('');
      foot.innerHTML = '<button id="btnDelDone">完成</button>';
      $('#btnDelDone').onclick = () => { delModal.classList.remove('open'); loadOverview(); };
    } catch (err) {
      body.innerHTML = '<div class="err">' + esc(err.message) + '</div>';
      foot.innerHTML = '<button id="btnDelDone">关闭</button>';
      $('#btnDelDone').onclick = () => delModal.classList.remove('open');
    }
  };
}

// ---------- 插件回收站 ----------
const trashModal = $('#trashModal');
$('#btnTrash').onclick = () => openTrashModal();
$('#btnTrashClose').onclick = () => trashModal.classList.remove('open');
trashModal.addEventListener('click', (e) => {
  if (e.target === trashModal) trashModal.classList.remove('open');
});
async function openTrashModal() {
  trashModal.classList.add('open');
  const body = $('#trashBody');
  const foot = $('#trashFoot');
  body.innerHTML = '<div class="loading">读取回收站…</div>';
  foot.innerHTML = '';
  try {
    const r = await api('/trash');
    const items = r.items || [];
    const retainDays = r.settings?.retainDays ?? 30;
    const wsOptions = (selected) => (overview?.workspaces || []).map((w) => '<option value="' + esc(w.id) + '"' + (w.id === selected ? ' selected' : '') + '>' + esc(w.title || w.id) + '</option>').join('');
    let html = '<div class="del-group" id="trashRetentionHead">已删除的会话（保留 ' + retainDays + ' 天后自动彻底删除；期间可恢复。勾选后可批量彻底删除）</div>';
    if (!items.length) html += '<div class="del-row" style="color:var(--dsw-alias-label-tertiary,#7c828e)">（回收站是空的）</div>';
    for (const it of items) {
      const remain = Math.max(0, Math.ceil(((it.deletedAt ?? 0) + retainDays * 86400000 - Date.now()) / 86400000));
      html += '<div class="del-row" style="flex-wrap:wrap"><input type="checkbox" class="trash-chk" data-trash="' + esc(it.trashId) + '">🗂 <strong>' + esc(it.title || '未命名会话') + '</strong> <span class="id">' + esc((it.sessionId || '').replace('session-', '').slice(0, 8)) + '</span>'
        + '<span style="flex:1"></span><span style="color:var(--dsw-alias-label-tertiary,#7c828e);font-size:12px">删除于 ' + fmtTime(it.deletedAt) + ' · 剩 ' + remain + ' 天</span></div>';
      html += '<div class="del-row del-sub" style="flex-wrap:wrap"><select class="mov-select" data-restore-ws="' + esc(it.trashId) + '" style="width:auto;flex:1;min-width:220px">' + wsOptions(it.originalWorkspaceId) + '</select>'
        + '<button data-restore="' + esc(it.trashId) + '">♻ 恢复</button>'
        + '<button class="del-btn" data-purge="' + esc(it.trashId) + '">🔥 彻底删除</button></div>';
    }
    html += '<div class="del-group" style="margin-top:14px">设置</div>';
    html += '<div class="del-row">回收站保留天数：<input type="number" id="inpRetainDays" value="' + retainDays + '" min="1" max="3650" style="width:80px"> <button id="btnSaveDays">保存</button> <button id="btnPurgeSelected" class="del-btn" disabled>🔥 删除选中项（0）</button> <button id="btnEmptyTrash" class="del-btn">清空回收站</button></div>';
    body.innerHTML = html;
    // 批量彻底删除：选中项
    const updPurgeSelBtn = () => {
      const n = body.querySelectorAll('input.trash-chk:checked').length;
      const btn = body.querySelector('#btnPurgeSelected');
      if (btn) { btn.disabled = n === 0; btn.textContent = '🔥 删除选中项（' + n + '）'; }
    };
    body.querySelector('#btnPurgeSelected').onclick = async () => {
      const ids = [...body.querySelectorAll('input.trash-chk:checked')].map((i) => i.getAttribute('data-trash'));
      if (!ids.length) return;
      if (!confirm('彻底删除选中的 ' + ids.length + ' 个会话？此操作不可恢复。')) return;
      try { await api('/purge-trash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashIds: ids }) }); openTrashModal(); } catch (e) { alert(e.message); }
    };
    body.querySelectorAll('input.trash-chk').forEach((i) => { i.onclick = updPurgeSelBtn; });
    updPurgeSelBtn();
    // 顶部规则提示实时跟随输入框（区分“当前生效规则”与“已改未保存”）
    const retainHead = body.querySelector('#trashRetentionHead');
    const savedDays = retainDays;
    function syncRetainHead() {
      const v = Number(body.querySelector('#inpRetainDays').value);
      if (!Number.isFinite(v) || v < 1 || v > 3650 || v === savedDays) {
        retainHead.textContent = '已删除的会话（保留 ' + savedDays + ' 天后自动彻底删除；期间可恢复。勾选后可批量彻底删除）';
      } else {
        retainHead.textContent = '已删除的会话（当前规则：保留 ' + savedDays + ' 天；你在下方已改为 ' + v + ' 天，点「保存」后生效）';
      }
    }
    body.querySelector('#inpRetainDays').addEventListener('input', syncRetainHead);
    syncRetainHead();
    body.querySelectorAll('button[data-restore]').forEach((b) => {
      b.onclick = async () => {
        const tid = b.getAttribute('data-restore');
        const wsSel = body.querySelector('select[data-restore-ws="' + tid + '"]');
        b.disabled = true;
        try {
          const r2 = await api('/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashId: tid, targetWorkspaceId: wsSel ? wsSel.value : undefined }) });
          alert(r2.note || '恢复完成');
          openTrashModal();
        } catch (e) { alert(e.message); b.disabled = false; }
      };
    });
    body.querySelectorAll('button[data-purge]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('彻底删除该会话？此操作不可恢复。')) return;
        try { await api('/purge-trash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashId: b.getAttribute('data-purge') }) }); openTrashModal(); } catch (e) { alert(e.message); }
      };
    });
    body.querySelector('#btnSaveDays').onclick = async () => {
      try { await api('/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ retainDays: Number(body.querySelector('#inpRetainDays').value) }) }); openTrashModal(); } catch (e) { alert(e.message); }
    };
    body.querySelector('#btnEmptyTrash').onclick = async () => {
      if (!confirm('清空回收站？所有已删除会话将被彻底删除，不可恢复。')) return;
      try { await api('/purge-trash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emptyAll: true }) }); openTrashModal(); } catch (e) { alert(e.message); }
    };
  } catch (e) {
    body.innerHTML = '<div class="err">' + esc(e.message) + '</div>';
  }
}

// ---------- 批量操作 ----------
let batchMode = false;
const selectedSessions = new Set();
function selectedSessionObjects() {
  const out = [];
  for (const w of overview?.workspaces || []) for (const s of w.sessions || []) if (selectedSessions.has(s.id)) out.push(s);
  for (const s of overview?.archived || []) if (selectedSessions.has(s.id)) out.push(Object.assign({}, s, { __archived: true }));
  for (const s of overview?.orphans || []) if (selectedSessions.has(s.id)) out.push(Object.assign({}, s, { __orphan: true }));
  return out;
}
function updateBatchBar() {
  const bar = document.getElementById('batchBar');
  if (!bar) return;
  const n = selectedSessions.size;
  bar.innerHTML = '<span>已选 <span class="cnt">' + n + '</span> 个会话</span>'
    + '<button id="bbSelCur">全选当前工作区</button>'
    + '<button id="bbClear">清空选择</button>'
    + '<button id="bbDel" class="del-btn">🗑 批量删除</button>'
    + '<span style="color:var(--dsw-alias-label-tertiary,#7c828e);font-size:12px">勾选会话行左侧复选框后使用</span>';
  bar.querySelector('#bbDel').disabled = n === 0;
  bar.querySelector('#bbSelCur').onclick = () => {
    const w = overview.workspaces.find((x) => x.id === selectedWs);
    if (w) for (const s of w.sessions || []) selectedSessions.add(s.id);
    renderSessions();
  };
  bar.querySelector('#bbClear').onclick = () => { selectedSessions.clear(); renderSessions(); };
  bar.querySelector('#bbDel').onclick = () => openBatchDelete(selectedSessionObjects());
}

async function openBatchDelete(sessions) {
  if (!sessions || !sessions.length) return;
  delModal.classList.add('open');
  delModal.querySelector('.modal-head strong').textContent = '🗑 批量删除（' + sessions.length + ' 个会话）';
  const body = $('#delBody');
  const foot = $('#delFoot');
  body.innerHTML = '<div class="loading">读取会话清单…</div>';
  foot.innerHTML = '';
  const items = [];
  for (const s of sessions) {
    let files = { results: [], others: [] };
    try {
      const d = await api('/session/' + encodeURIComponent(s.id) + '/detail');
      files = d.files;
    } catch (e) { /* 记录缺失等按无文件处理 */ }
    items.push({ s, results: files.results || [], others: files.others || [] });
  }
  let html = '<div class="del-group">将删除 ' + items.length + ' 个会话（记录固定包含）</div>';
  html += '<div class="del-group">删除方式</div>';
  html += '<label class="del-row" style="cursor:pointer"><input type="radio" name="bdelMode" value="trash" checked> 📥 全部移入插件回收站（可恢复；成果文件保留原地）</label>';
  html += '<label class="del-row" style="cursor:pointer"><input type="radio" name="bdelMode" value="recycle"> ♻ 会话 + 勾选文件 进系统回收站</label>';
  html += '<label class="del-row" style="cursor:pointer"><input type="radio" name="bdelMode" value="purge"> 🔥 全部彻底删除（不可恢复）</label>';
  html += '<div class="del-row del-sub" id="bpurgeConfirmRow" style="display:none"><label style="cursor:pointer;display:flex;gap:6px;align-items:center"><input type="checkbox" id="chkBPurgeOk"> 我确认要完全删除以上内容</label></div>';
  html += '<div class="del-row" id="bdelModeNote" style="color:var(--dsw-alias-state-business-primary,#4c8dff);font-size:12px">📥 成果文件将保留在原地不动。</div>';
  html += '<div class="del-row" style="padding:6px 8px;border:1px solid var(--dsw-alias-border-l3,#2c313d);border-radius:8px"><input type="checkbox" id="chkAllFiles" checked> <strong>全选所有文件</strong></div>';
  for (const it of items) {
    html += '<div class="del-group" style="margin-top:10px">🗂 ' + esc(displayName(it.s)) + ' <span class="id">' + esc(it.s.id.replace('session-', '').slice(0, 8)) + '</span></div>';
    let any = false;
    for (const f of it.results) {
      if (f.isFolder) {
        html += '<div class="del-row">📁 ' + esc(f.path) + '</div>';
        for (const img of f.imagePaths || []) { any = true; html += '<div class="del-row del-sub"><input type="checkbox" checked data-sid="' + esc(it.s.id) + '" data-file="' + esc(img) + '"> <span class="fname">' + esc(img) + '</span></div>'; }
      } else { any = true; html += '<div class="del-row"><input type="checkbox" checked data-sid="' + esc(it.s.id) + '" data-file="' + esc(f.path) + '"> <span class="fname">' + esc(f.path) + '</span></div>'; }
    }
    for (const f of it.others) { any = true; html += '<div class="del-row"><input type="checkbox" data-sid="' + esc(it.s.id) + '" data-file="' + esc(f.path) + '"> <span class="fname">' + esc(f.path) + '</span></div>'; }
    if (!any) html += '<div class="del-row" style="color:var(--dsw-alias-label-tertiary,#7c828e)">（无文件）</div>';
  }
  html += '<div class="del-warn">⚠ 删除前注册表自动备份；成果文件默认保留原地（trash 模式）。若 DSH 界面未同步，重启 DSH。</div>';
  body.innerHTML = html;
  const master = body.querySelector('#chkAllFiles');
  const boxes = [...body.querySelectorAll('input[data-file]')];
  function applyBDelModeUi(mode) {
    const disable = mode === 'trash';
    boxes.forEach((b) => { b.disabled = disable; });
    if (master) master.disabled = disable;
    const note = body.querySelector('#bdelModeNote');
    if (note) note.textContent = mode === 'trash'
      ? '📥 所有成果文件将保留在原地不动；会话可随时从插件回收站恢复。'
      : mode === 'purge'
        ? '🔥 以上内容将被直接清除，不进任何回收站，无法恢复。'
        : '♻ 会话与勾选的文件将进系统回收站（可还原）。';
    const row = body.querySelector('#bpurgeConfirmRow');
    if (row) row.style.display = mode === 'purge' ? 'flex' : 'none';
  }
  body.querySelectorAll('input[name="bdelMode"]').forEach((r) => { r.onchange = () => applyBDelModeUi(r.value); });
  applyBDelModeUi('trash');
  master.onclick = () => { boxes.forEach((b) => { b.checked = master.checked; }); master.indeterminate = false; };
  boxes.forEach((b) => { b.onclick = () => { const all = boxes.every((x) => x.checked); const some = boxes.some((x) => x.checked); master.checked = all; master.indeterminate = some && !all; }; });
  foot.innerHTML = '<button id="btnDelCancel">取消</button><button id="btnDelGo" style="border-color:var(--dsw-alias-state-error-primary,#ff7b72);color:var(--dsw-alias-state-error-primary,#ff7b72)">删除（' + items.length + ' 个会话）</button>';
  $('#btnDelCancel').onclick = () => delModal.classList.remove('open');
  $('#btnDelGo').onclick = async () => {
    const mode = (body.querySelector('input[name="bdelMode"]:checked') || {}).value || 'trash';
    if (mode === 'purge' && !body.querySelector('#chkBPurgeOk')?.checked) { alert('请先勾选「我确认要完全删除以上内容」'); return; }
    const go = $('#btnDelGo');
    go.disabled = true;
    const results = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      go.textContent = '删除中 ' + (i + 1) + '/' + items.length + '：' + displayName(it.s);
      const files = [...body.querySelectorAll('input[data-sid="' + it.s.id + '"]:checked')].map((x) => x.getAttribute('data-file'));
      try {
        const r = await api('/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: it.s.id, files, mode, confirmPurge: mode === 'purge' }) });
        results.push({ s: it.s, ok: true, files: r.fileResults || [] });
      } catch (e) {
        results.push({ s: it.s, ok: false, error: e.message });
      }
    }
    let html2 = '<div class="del-group">批量删除结果</div>';
    for (const r of results) {
      html2 += '<div class="del-row">' + (r.ok ? '✅' : '❌') + ' <strong>' + esc(displayName(r.s)) + '</strong>' + (r.error ? ' <span class="err">' + esc(r.error) + '</span>' : '') + '</div>';
      for (const fr of r.files || []) if (fr.status !== 'ok') html2 += '<div class="del-row del-sub">⚠️ <span class="fname">' + esc(fr.path) + '</span> ' + esc(fr.message || fr.status) + '</div>';
    }
    html2 += '<div class="del-warn">完成。若 DSH 界面未同步，重启 DSH。</div>';
    body.innerHTML = html2;
    foot.innerHTML = '<button id="btnDelDone">完成</button>';
    $('#btnDelDone').onclick = () => { delModal.classList.remove('open'); results.forEach((r) => selectedSessions.delete(r.s.id)); loadOverview(); };
  };
}

// 自动同步：每 20 秒拉一次最新状态；弹窗打开或页面不可见时跳过，不打扰操作
setInterval(() => {
  const anyModal = probeModal.classList.contains('open') || delModal.classList.contains('open') || trashModal.classList.contains('open');
  if (anyModal || document.hidden) return;
  loadOverview();
}, 20000);
loadOverview();
</script>
</body>
</html>`;
