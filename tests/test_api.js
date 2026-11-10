// 沙盒闭环测试：伪造 DSH_HOME + fake ctx 调 apply，走 /swm/api 全流程
// 验证：health 检测 4 类问题 → delete(trash) 注册表清理 → restore（同区 + 跨区 cwd 改写）→ health/fix 一键修复
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync, utimesSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

const PLUGIN = 'file:///D:/dsh-plugins/dsh-session-ws-manager/lib/';
const { apply } = await import(PLUGIN + 'index.js');
const { zstdCompressSync } = await import(PLUGIN + 'zstd-multiframe.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('✅', name, detail ?? ''); }
  else { fail++; console.log('❌', name, detail ?? ''); }
};

// ---------- 沙盒搭建 ----------
// 注意：不放在 Temp 下 —— isTempDirPath 会把 Temp 下的"成果文件"正确过滤掉
const HOME = 'D:\\swm-sandbox-' + Date.now();
process.env.DSH_HOME = HOME;
const WS1_ID = '11111111-1111-1111-1111-111111111111';
const WS2_ID = '22222222-2222-2222-2222-222222222222';
const S1 = 'session-aaaaaaaa-1111-2222-3333-444444444444'; // 属 ws1，将被删除/恢复
const DANGLING = 'session-deadbeef-0000-0000-0000-000000000000'; // 悬空 pinned
const WS1 = HOME + '\\ws1'; // 真实存在的沙盒工作区目录
const WS2 = HOME + '\\ws2';

// 与 index.js 相同的 projectKey（目录名必须与 cwd 编码一致，模拟真实 DSH 布局）
function projectKey(cwd) {
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
      separatorRun = false;
    }
  }
  return '--' + ((readable.replace(/^-+/, '') || 'root').slice(0, 251)) + '--';
}
const KEY1 = projectKey(WS1);
const KEY2 = projectKey(WS2);

mkdirSync(WS1, { recursive: true });
mkdirSync(WS2, { recursive: true });
mkdirSync(join(HOME, 'storages', 'session_projcache', 'sessions'), { recursive: true });
mkdirSync(join(HOME, 'sessions', KEY1, S1), { recursive: true });

// 多帧会话正文（每行一帧，模拟 DSH 追加方式）
const lines = [
  JSON.stringify({ type: 'session', version: 4, id: S1, createdAt: 1700000000000, cwd: WS1, isSeeded: false, delegationDepth: 0, agentPreset: 'standard' }),
  JSON.stringify({ type: 'session/title', seq: 0, time: 1700000000001, data: { title: '沙盒测试会话' } }),
  JSON.stringify({ type: 'turn/start', seq: 1, time: 1700000000002, data: {} }),
  JSON.stringify({ type: 'tool/call', seq: 2, time: 1700000000003, data: { name: 'write', arguments: JSON.stringify({ file_path: WS1 + '\\report.txt' }) } }),
];
const transcript = join(HOME, 'sessions', KEY1, S1, 'session.v4.jsonl.zstd');
writeFileSync(transcript, Buffer.concat(lines.map((l) => zstdCompressSync(Buffer.from(l + '\n', 'utf8')))));
// 真实成果文件（会话里 write 过 + 文档类扩展名 → 成果识别的前提是文件真实存在）
writeFileSync(join(WS1, 'report.txt'), 'sandbox deliverable');
// mtime 拨回 2 分钟前，绕过"1 分钟内有写入"保护
const old = new Date(Date.now() - 120_000);
utimesSync(transcript, old, old);

// 注册表：1 个正常绑定 + 悬空 pinned + bad default
writeFileSync(join(HOME, 'storages', 'workspace.json'), JSON.stringify({
  unit: { name: 'workspace', version: 2 },
  global: {
    initialized: true,
    defaultWorkspaceId: 'dead-workspace-id',
    workspaceIds: [WS1_ID, WS2_ID],
    archivedSessionIds: [],
    pinnedSessionIds: [DANGLING],
  },
  tables: { workspaces: {
    [WS1_ID]: { path: WS1, title: 'ws1', sessionIds: [S1], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    [WS2_ID]: { path: WS2, title: 'ws2', sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  } },
}, null, 2));

// projcache：1 个匹配 + 1 个孤儿
writeFileSync(join(HOME, 'storages', 'session_projcache', 'sessions', S1 + '.json'), JSON.stringify({ version: 7, record: { identity: { cwd: WS1 } } }));
writeFileSync(join(HOME, 'storages', 'session_projcache', 'sessions', 'session-orphan-9999.json'), '{}');
// 2 个假备份（启动轮转 keep=10 不会动它们；backup-pileup 检测用后补的 12 个触发）
for (let i = 0; i < 2; i++) writeFileSync(join(HOME, 'storages', 'workspace.json.bak-swm-' + (1700000000000 + i)), 'x');

// ---------- fake ctx + 请求器 ----------
const effects = [];
const handlers = [];
const ctx = {
  webServer: { register: (o) => handlers.push(o) },
  // cordis 语义：effect(fn) 立即执行 fn 并把返回值（dispose）登记为清理回调
  effect: (fn) => effects.push(fn()),
  get: () => undefined, // 沙盒里无宿主服务 → 全部走 JSON 路径
  logger: { info: () => {}, warn: (...a) => console.log('  [warn]', ...a) },
};
apply(ctx);
const api = handlers.find((h) => h.kind === 'prefix');

async function call(method, path, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = path;
  req.socket = { remoteAddress: '127.0.0.1' };
  const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = String(b ?? ''); } };
  const p = api.handler(req, res);
  if (body !== undefined) { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); }
  await p;
  return { status: res.code, data: JSON.parse(res.body) };
}

const reg = () => JSON.parse(readFileSync(join(HOME, 'storages', 'workspace.json'), 'utf8'));

// ---------- 1. overview ----------
const ov = await call('GET', '/swm/api/overview');
ok('overview 工作区数', ov.data.workspaces?.length === 2);
ok('overview 会话标题解析', ov.data.workspaces?.[0]?.sessions?.[0]?.title === '沙盒测试会话');
ok('overview 成果识别(report.txt)', ov.data.workspaces?.[0]?.sessions?.[0]?.fileCounts?.results === 1);

// ---------- 2. health 检测 ----------
// 先补 12 个假备份（绕过启动轮转时机，让 bakCount=22 触发 backup-pileup）
for (let i = 0; i < 12; i++) writeFileSync(join(HOME, 'storages', 'workspace.json.bak-swm-' + (1800000000000 + i)), 'x');
const h1 = await call('GET', '/swm/api/health');
console.log('  health issues:', JSON.stringify(h1.data.issues?.map((i) => i.type)), 'bakCount:', h1.data.bakCount);
const types = (h1.data.issues ?? []).map((i) => i.type).sort();
ok('health 检出 dangling-pinned', types.includes('dangling-pinned'));
ok('health 检出 bad-default-workspace', types.includes('bad-default-workspace'));
ok('health 检出 orphan-projcache', types.includes('orphan-projcache'));
ok('health 检出 backup-pileup', types.includes('backup-pileup'));

// ---------- 3. delete dryRun + trash ----------
const dry = await call('POST', '/swm/api/delete', { sessionId: S1, mode: 'trash', dryRun: true });
ok('delete dryRun 返回计划', dry.data.dryRun === true && dry.data.plan.mode === 'trash');
const del = await call('POST', '/swm/api/delete', { sessionId: S1, mode: 'trash' });
ok('delete trash 成功', del.data.ok === true && del.data.trashId);
ok('会话目录已移入回收站', !existsSync(join(HOME, 'sessions', '--D-ws1--', S1)) && existsSync(join(HOME, 'session-trash', del.data.trashId, 'session')));
ok('projcache 已随会话入回收站', existsSync(join(HOME, 'session-trash', del.data.trashId, 'projcache.json')));
ok('回收站 meta.json 记录原工作区', JSON.parse(readFileSync(join(HOME, 'session-trash', del.data.trashId, 'meta.json'), 'utf8')).originalWorkspaceId === WS1_ID);
ok('注册表 sessionIds 已清理', !reg().tables.workspaces[WS1_ID].sessionIds.includes(S1));
ok('被删会话不在 pinned（无新增悬空引用）', !reg().global.pinnedSessionIds.includes(S1));
ok('无关悬空引用留给 health/fix（职责边界正确）', reg().global.pinnedSessionIds.includes(DANGLING));
ok('删除前已备份注册表（启动轮转 10 + 本次 1）', readdirSync(join(HOME, 'storages')).filter((n) => n.startsWith('workspace.json.bak-swm-')).length >= 11);

// ---------- 4. restore 原工作区 ----------
const rs = await call('POST', '/swm/api/restore', { trashId: del.data.trashId });
ok('restore 成功', rs.data.ok === true, rs.data.note ?? '');
ok('会话目录已还原（编码目录名与 cwd 一致）', existsSync(join(HOME, 'sessions', KEY1, S1, 'session.v4.jsonl.zstd')));
ok('注册表重新挂载', reg().tables.workspaces[WS1_ID].sessionIds.includes(S1));
ok('回收站项已清空', !existsSync(join(HOME, 'session-trash', del.data.trashId)));
ok('projcache 已还原', existsSync(join(HOME, 'storages', 'session_projcache', 'sessions', S1 + '.json')));

// ---------- 5. restore 跨工作区（cwd 深度修正路径） ----------
const del2 = await call('POST', '/swm/api/delete', { sessionId: S1, mode: 'trash' });
utimesSync(join(HOME, 'session-trash', del2.data.trashId, 'session', 'session.v4.jsonl.zstd'), old, old); // 重置 mtime
const rs2 = await call('POST', '/swm/api/restore', { trashId: del2.data.trashId, targetWorkspaceId: WS2_ID });
ok('跨区 restore 成功', rs2.data.ok === true);
const t2 = join(HOME, 'sessions', KEY2, S1, 'session.v4.jsonl.zstd');
ok('目录搬到目标编码目录', existsSync(t2));
const { decompressMultiframeZstd } = await import(PLUGIN + 'zstd-multiframe.js');
const head = JSON.parse(decompressMultiframeZstd(readFileSync(t2)).toString('utf8').split('\n', 1)[0]);
ok('正文首行 cwd 已深度修正', head.cwd === WS2, head.cwd);
ok('projcache cwd 已修正', JSON.parse(readFileSync(join(HOME, 'storages', 'session_projcache', 'sessions', S1 + '.json'), 'utf8')).record?.identity?.cwd === WS2);
ok('注册表挂到 ws2', reg().tables.workspaces[WS2_ID].sessionIds.includes(S1));

// ---------- 6. health/fix 一键修复 ----------
const fix = await call('POST', '/swm/api/health/fix', {});
ok('fix 完成 bad-default-workspace', (fix.data.health.issues ?? []).every((i) => i.type !== 'bad-default-workspace'));
ok('fix 清掉悬空 pinned 引用（核心 bug 修复）', !reg().global.pinnedSessionIds.includes(DANGLING));
ok('default 已指向存在的工作区', Object.keys(reg().tables.workspaces).includes(reg().global.defaultWorkspaceId), reg().global.defaultWorkspaceId);
ok('fix 清掉孤儿 projcache', !existsSync(join(HOME, 'storages', 'session_projcache', 'sessions', 'session-orphan-9999.json')));
ok('fix 备份轮转到 10 份', readdirSync(join(HOME, 'storages')).filter((n) => n.startsWith('workspace.json.bak-swm-')).length <= 10);
ok('fix 后无残留问题', (fix.data.health.issues ?? []).length === 0, JSON.stringify(fix.data.health.issues ?? []));

// ---------- 7. 设置持久化 ----------
const st = await call('POST', '/swm/api/settings', { retainDays: 7 });
ok('settings 保存并回读', st.data.settings.retainDays === 7);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
rmSync(HOME, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
