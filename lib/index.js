// dsh-session-ws-manager — DSH 会话工作区管理插件
// M1：只读探针。挂载 /swm 面板 + /swm/api JSON 接口。
// M2：安全删除（插件回收站 / 系统回收站 / 彻底删除）+ 回收站管理与体检报告。
// （M3 跨工作区转移已按需求整体移除。）
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import {
  analyzeTranscriptCached,
  classifyFiles,
  DELIVERABLE_EXT,
  dshHome,
  dropAnalysisCache,
  filePathTokens,
  hasZstdSupport,
  normPath as normFilePath,
  readSessionHeader,
  readWorkspaceRegistry,
  scanSessionDirs,
  sessionsRoot,
} from './analyzer.js';
import { splitZstdFrames, zstdCompressSync } from './zstd-multiframe.js';
import { decompressMultiframeZstd } from './zstd-multiframe.js';
import { PAGE_HTML } from './page.js';

export const name = 'dsh-session-ws-manager';

// 声明服务依赖：等 webServer 服务就绪后再执行 apply（workspace 服务用动态注入探测，见 apply 内）
export const inject = ['webServer'];

function normWsPath(p) {
  return String(p ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

export const apply = (ctx) => {
  console.log('[swm] 面板已挂载 -> /swm | webServer 字段:', Object.keys(ctx.webServer ?? {}).join(','));
  const logger = ctx.logger ?? console;
  const PREFIX = '/swm/api';

  // 鉴权：优先 DSH 连接服务的判定（与官方插件一致）；服务缺失时退化为仅本机回环。
  const fence = (req) => {
    try {
      if (ctx.connection?.requestRejection) return ctx.connection.requestRejection(req) === undefined;
    } catch {
      /* 服务不可用时走回环判断 */
    }
    const addr = String(req.socket?.remoteAddress ?? '');
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  };

  const json = (res, code, data) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  const fail = (res, code, message) => json(res, code, { ok: false, error: { message } });

  const register = (opts) => {
    if (typeof ctx.effect === 'function') ctx.effect(() => ctx.webServer.register(opts));
    else ctx.webServer.register(opts);
  };

  // ---------- /swm 面板 ----------
  register({
    kind: 'exact',
    path: '/swm',
    handler: (req, res) => {
      if (!fence(req)) return fail(res, 403, 'forbidden');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE_HTML);
    },
  });

  // ---------- /swm/api 接口 ----------
  register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      if (!fence(req)) return fail(res, 403, 'forbidden');
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
      const rest = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : pathname;

      try {
        if (rest === '' || rest === '/' || rest === '/overview') return json(res, 200, buildOverview());
        if (rest === '/probe') return json(res, 200, buildProbe(ctx));
        if (rest === '/health') return json(res, 200, buildHealth());
        if (req.method === 'POST' && rest === '/health/fix') {
          const body = await readJsonBody(req);
          return json(res, 200, fixHealthIssues(body));
        }
        const detailMatch = rest.match(/^\/session\/([A-Za-z0-9-]+)\/detail$/);
        if (detailMatch) return json(res, 200, buildSessionDetail(decodeURIComponent(detailMatch[1])));
        if (rest === '/reveal' || rest === '/open') return handleFileAction(rest, new URL(req.url ?? '/', 'http://dsh.internal').searchParams, res);
        if (req.method === 'POST' && rest === '/delete') {
          const body = await readJsonBody(req);
          return json(res, 200, await deleteSession(body));
        }
        if (rest === '/trash') return json(res, 200, { ok: true, items: listTrashItems(), settings: loadSettings() });
        if (req.method === 'POST' && rest === '/rename') {
          const body = await readJsonBody(req);
          const sessionId = String(body?.sessionId ?? '');
          const title = String(body?.title ?? '').trim();
          if (!/^session-[A-Za-z0-9-]{8,}$/.test(sessionId)) throw new SwmError(400, '非法的会话 id');
          if (!title) throw new SwmError(400, '标题不能为空');
          const titles = svc('sessionTitle');
          if (titles === undefined || typeof titles.rename !== 'function') throw new SwmError(400, 'sessionTitle 服务不可用');
          const sessions = svc('sessions');
          const session = sessions ? sessions.get(sessionId)?.agent?.session : undefined;
          if (session === undefined) throw new SwmError(404, '会话未在运行时加载（重启 DSH 后再试）');
          titles.rename(session, title);
          return json(res, 200, { ok: true, sessionId, title });
        }
        if (req.method === 'POST' && rest === '/restore') {
          const body = await readJsonBody(req);
          return json(res, 200, await restoreFromTrash(body));
        }
        if (req.method === 'POST' && rest === '/purge-trash') {
          const body = await readJsonBody(req);
          return json(res, 200, purgeTrashItems(body));
        }
        if (rest === '/settings') {
          if (req.method === 'POST') {
            const body = await readJsonBody(req);
            const days = Number(body?.retainDays);
            if (!Number.isFinite(days) || days < 1 || days > 3650) throw new SwmError(400, '保留天数需在 1-3650 之间');
            const s = loadSettings();
            s.retainDays = Math.round(days);
            atomicWrite(SETTINGS_PATH(), JSON.stringify(s, null, 2));
            cleanExpiredTrash();
            return json(res, 200, { ok: true, settings: loadSettings() });
          }
          return json(res, 200, { ok: true, settings: loadSettings() });
        }
        if (req.method !== 'GET') return fail(res, 405, 'method not allowed');
        return fail(res, 404, 'unknown api path: ' + rest);
      } catch (error) {
        logger?.warn?.('[swm] api error:', error);
        return fail(res, error?.status ?? 500, error instanceof Error ? error.message : String(error));
      }
    },
  });

  // ---------- 数据组装 ----------
  /** 只允许操作已注册工作区内的路径（防任意文件定位/打开） */
  function pathAllowed(p) {
    const reg = readWorkspaceRegistry();
    const target = normWsPath(p);
    return reg.workspaces.some((w) => {
      if (!w.path) return false;
      const base = normWsPath(w.path);
      return target === base || target.startsWith(base + '\\');
    });
  }

  function handleFileAction(action, searchParams, res) {
    const p = (searchParams.get('path') ?? '').replace(/\//g, '\\');
    if (!p || !isAbsolute(p)) return fail(res, 400, '需要绝对路径参数 path');
    if (!existsSync(p)) return fail(res, 404, '路径不存在: ' + p);
    if (action === '/open') {
      // 文件夹直接打开（纯导航，安全）；文件用默认程序打开
      // （面板仅限本机访问 + 前端确认弹窗；列出的文件本就是用户自己会话的成果）
      let isDir = false;
      try {
        isDir = statSync(p).isDirectory();
      } catch {
        /* 不存在已在外层拦截 */
      }
      execFile('explorer.exe', [p], () => {});
      return json(res, 200, { ok: true, action: 'open', path: p, isDir });
    }
    // /reveal：在资源管理器中定位文件（只读导航，不执行文件），允许任意已存在文件
    execFile('explorer.exe', ['/select,', p], () => {});
    return json(res, 200, { ok: true, action: 'reveal', path: p });
  }

  function sessionWithHeader(dirEntry) {
    let header = null;
    let headerError = null;
    try {
      header = readSessionHeader(dirEntry.transcript);
    } catch (e) {
      headerError = e instanceof Error ? e.message : String(e);
    }
    // 标题/轮次/成果文件数来自全量解析（按 mtime 缓存，首次之后近乎免费）
    let title = null;
    let turns = null;
    let fileCounts = null;
    if (dirEntry.transcript) {
      try {
        const a = analyzeTranscriptCached(dirEntry.transcript);
        title = a.title ?? null;
        turns = a.turns;
        const { results, others } = classifySessionFiles(a, dirEntry.transcript);
        fileCounts = { results: results.length, others: others.length };
      } catch (e) {
        /* 解析失败时列表仍显示代号 */
      }
    }
    return {
      id: dirEntry.id,
      dir: dirEntry.dir,
      workspaceDirName: dirEntry.workspaceDirName,
      transcript: dirEntry.transcript,
      sizeBytes: dirEntry.sizeBytes,
      mtime: dirEntry.mtime || null,
      createdAt: header?.createdAt ?? null,
      cwd: header?.cwd ?? null,
      title,
      turns,
      empty: typeof turns === 'number' ? turns === 0 : null,
      fileCounts,
      headerError,
    };
  }

  function buildOverview() {
    const reg = readWorkspaceRegistry();
    const dirs = scanSessionDirs();
    const byId = new Map(dirs.map((d) => [d.id, d]));
    const used = new Set();
    const archived = new Set(reg.archivedSessionIds);

    const workspaces = reg.workspaces.map((w) => {
      const wsPath = normWsPath(w.path);
      const sessions = (w.sessionIds ?? []).map((id) => {
        used.add(id);
        const d = byId.get(id);
        if (!d) return { id, missing: true };
        const s = sessionWithHeader(d);
        // 探针点：头部 cwd 与注册表 path 的一致性
        s.cwdMatchesWorkspace = s.cwd ? normWsPath(s.cwd) === wsPath : null;
        return s;
      });
      return { ...w, sessions };
    });

    const orphans = dirs
      .filter((d) => !used.has(d.id) && !archived.has(d.id))
      .map((d) => sessionWithHeader(d));
    const archivedSessions = [...archived]
      .map((id) => (byId.has(id) ? sessionWithHeader(byId.get(id)) : { id, missing: true }));

    return {
      ok: true,
      workspaces,
      archived: archivedSessions,
      orphans,
      defaultWorkspaceId: reg.defaultWorkspaceId,
      stats: {
        sessionDirCount: dirs.length,
        unreadable: dirs.filter((d) => !d.transcript).length,
      },
    };
  }

  // 成果发现（含最终答复提到的文件/目录扫描）——按 transcript mtime 缓存，供列表与详情共用
  const extraCache = new Map();
  function discoverDeliverables(a, transcriptPath) {
    const mtime = (() => {
      try {
        return statSync(transcriptPath).mtimeMs;
      } catch {
        return 0;
      }
    })();
    const hit = extraCache.get(transcriptPath);
    if (hit && hit.mtime === mtime) return hit.extra;
    const cls = classifyFiles(a);
    const known = new Set([...cls.results, ...cls.others].map((f) => normFilePath(f.path)));
    const extra = [];
    // 会话起点：优先用正文最早事件时间（seeded 会话的重放事件保留原始时间戳），
    // 这样转移/接续过的会话仍能认出“会话开始之前不存在、对话期间生成”的文件
    const sessionStart = typeof a.firstEventTime === 'number' && a.firstEventTime > 0
      ? a.firstEventTime
      : (typeof a.header?.createdAt === 'number' ? a.header.createdAt : 0);
    // 目录扫描收文档与图片（会话期间生成/修改的才算；脚本类永远不算）
    const pushFile = (p, allowed) => {
      const m = /\.([a-z0-9]+)$/i.exec(p);
      if (!m || !allowed.has(m[1].toLowerCase())) return false;
      try {
        if (statSync(p).isFile()) {
          if (!known.has(normFilePath(p))) {
            extra.push({ path: p, ops: ['deliver'], sources: ['final-answer'] });
            known.add(normFilePath(p));
          }
          return true;
        }
      } catch {
        /* 不存在则忽略 */
      }
      return false;
    };
    for (const tok of filePathTokens(a.finalAssistantText ?? '')) {
      if (known.has(normFilePath(tok))) continue;
      if (pushFile(tok, DELIVERABLE_EXT)) continue;
      try {
        if (statSync(tok).isDirectory()) {
          for (const name of readdirSync(tok).slice(0, 100)) {
            const child = join(tok, name);
            try {
              const st = statSync(child);
              if (st.isFile() && st.mtimeMs >= sessionStart) pushFile(child, DELIVERABLE_EXT);
            } catch {
              /* 单项失败跳过 */
            }
          }
        }
      } catch {
        /* 目录不可读则忽略 */
      }
    }
    extraCache.set(transcriptPath, { mtime, extra });
    return extra;
  }

  const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']);
  /** 分类 + 存在性过滤：只保留当前磁盘上真实存在、可打开的文件；图片不逐张列，聚合为所在文件夹入口 */
  function classifySessionFiles(a, transcriptPath) {
    const cls = classifyFiles(a);
    const extra = discoverDeliverables(a, transcriptPath);
    const results = [...cls.results, ...extra].filter((f) => {
      try {
        return statSync(f.path).isFile();
      } catch {
        return false;
      }
    });
    const others = cls.others.filter((f) => {
      try {
        return statSync(f.path).isFile();
      } catch {
        return false;
      }
    });
    // 图片聚合：同一文件夹下的图片合成一个「文件夹入口」
    const files = [];
    const folders = new Map();
    for (const f of results) {
      const m = /\.([a-z0-9]+)$/i.exec(f.path);
      if (m && IMG_EXT.has(m[1].toLowerCase())) {
        const dir = f.path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '');
        const g = folders.get(dir) ?? { path: dir, isFolder: true, count: 0, sources: [], imagePaths: [] };
        g.count += 1;
        g.imagePaths.push(f.path);
        for (const s of f.sources ?? []) if (!g.sources.includes(s)) g.sources.push(s);
        folders.set(dir, g);
      } else {
        files.push(f);
      }
    }
    files.sort((x, y) => x.path.localeCompare(y.path));
    const grouped = [...files, ...[...folders.values()].sort((x, y) => x.path.localeCompare(y.path))];
    return { results: grouped, others };
  }

  // ---------- 删除（三种模式） ----------
  class SwmError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 2e6) {
          reject(new SwmError(413, '请求体过大'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch {
          reject(new SwmError(400, '请求体不是合法 JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

  /** 把一批文件/目录送入 Windows 回收站（PowerShell VisualBasic FileSystem API） */
  function recyclePaths(paths) {
    return new Promise((resolve) => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'swm-recycle-'));
      const script = join(tmpDir, 'recycle.ps1');
      const lines = paths.map((p) => '  ' + psq(p)).join(',\n');
      const ps = [
        "$ErrorActionPreference = 'Continue'",
        'Add-Type -AssemblyName Microsoft.VisualBasic',
        '$paths = @(',
        lines,
        ')',
        'foreach ($p in $paths) {',
        '  try {',
        "    if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin'); [Console]::Out.WriteLine(\"OK`t\" + $p) }",
        "    elseif (Test-Path -LiteralPath $p -PathType Leaf) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin'); [Console]::Out.WriteLine(\"OK`t\" + $p) }",
        "    else { [Console]::Out.WriteLine(\"MISSING`t\" + $p) }",
        '  } catch { [Console]::Out.WriteLine("FAIL`t" + $p + "`t" + $_.Exception.Message) }',
        '}',
      ].join('\n');
      try {
        writeFileSync(script, '\ufeff' + ps, 'utf8');
      } catch (e) {
        resolve(paths.map((p) => ({ path: p, status: 'fail', message: '无法写临时脚本: ' + e.message })));
        return;
      }
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        try {
          execFile('cmd.exe', ['/c', 'rmdir', '/s', '/q', tmpDir], () => {});
        } catch {
          /* 清理临时目录失败不影响结果 */
        }
        const result = paths.map((p) => ({ path: p, status: 'fail', message: err ? String(err).slice(0, 200) : '无返回' }));
        for (const line of String(stdout ?? '').split(/\r?\n/)) {
          const m = line.match(/^(OK|MISSING|FAIL)\t(.*)$/);
          if (!m) continue;
          const status = m[1] === 'OK' ? 'ok' : m[1] === 'MISSING' ? 'missing' : 'fail';
          const rest = m[2];
          const idx = rest.indexOf('\t');
          const p = (idx >= 0 ? rest.slice(0, idx) : rest).trim();
          const msg = idx >= 0 ? rest.slice(idx + 1) : '';
          const target = result.find((r) => normFilePath(r.path) === normFilePath(p));
          if (target) {
            target.status = status;
            target.message = msg;
          }
        }
        resolve(result);
      });
    });
  }

  async function deleteSession(body) {
    const sessionId = String(body?.sessionId ?? '');
    if (!/^session-[A-Za-z0-9-]{8,}$/.test(sessionId)) throw new SwmError(400, '非法的会话 id');
    const files = Array.isArray(body?.files) ? [...new Set(body.files.map(String))] : [];
    for (const p of files) {
      if (!isAbsolute(p)) throw new SwmError(400, '文件路径必须是绝对路径: ' + p);
    }
    const dirs = scanSessionDirs();
    const d = dirs.find((x) => x.id === sessionId);
    // 注册表定位（会话可能在归档/置顶里，也可能只在某个工作区）
    const reg = readWorkspaceRegistry();
    let inWorkspace = null;
    for (const w of reg.workspaces) {
      if ((w.sessionIds ?? []).includes(sessionId)) inWorkspace = w.id;
    }
    const sourceWs = inWorkspace ? reg.workspaces.find((w) => w.id === inWorkspace) : null;
    let headerCwd = null;
    if (d && d.transcript) {
      try {
        headerCwd = readSessionHeader(d.transcript)?.cwd ?? null;
      } catch {
        /* 无头部按无 cwd 处理 */
      }
    }
    const archived = (reg.archivedSessionIds ?? []).includes(sessionId);
    const projcache = join(dshHome(), 'storages', 'session_projcache', 'sessions', sessionId + '.json');
    if (!d && !inWorkspace && !archived) throw new SwmError(404, '会话不存在（无目录且未注册）');
    // 活跃检查：1 分钟内有写入的会话可能正在被使用
    if (d && d.transcript) {
      let recent = false;
      try {
        recent = Date.now() - statSync(d.transcript).mtimeMs < 60_000;
      } catch {
        /* 读不到 mtime 就放行 */
      }
      if (recent) throw new SwmError(409, '该会话 1 分钟内还有写入，可能正在使用，请稍后再试');
    }
    const plan = {
      sessionId,
      files,
      record: { registry: Boolean(inWorkspace || archived), dir: d ? d.dir : null, projcache: existsSync(projcache) ? projcache : null },
    };
    const mode = ['trash', 'recycle', 'purge'].includes(body?.mode) ? body.mode : 'trash';
    if (mode === 'purge' && body?.confirmPurge !== true) throw new SwmError(403, '彻底删除需要勾选确认（confirmPurge）');
    plan.mode = mode;
    if (body?.dryRun) return { ok: true, dryRun: true, plan };
    // 1. 注册表移除：优先官方 workspace 服务 detach（实时生效），失败回退 JSON 编辑
    const regPath = join(dshHome(), 'storages', 'workspace.json');
    let registryUpdated = false;
    let registryVia = null;
    if (inWorkspace) {
      const svc = wsSvc();
      const srcEntity = svc ? svc.get(inWorkspace) : null;
      if (srcEntity && typeof srcEntity.detachSession === 'function') {
        try {
          await srcEntity.detachSession(sessionId);
          registryUpdated = true;
          registryVia = 'workspace-service';
        } catch (e) {
          logger?.warn?.('[swm] detachSession 失败，回退 JSON:', e);
        }
      }
    }
    if (!registryUpdated && existsSync(regPath)) {
      copyFileSync(regPath, regPath + '.bak-swm-' + Date.now());
      const raw = JSON.parse(readFileSync(regPath, 'utf8'));
      if (raw.tables?.workspaces) {
        for (const w of Object.values(raw.tables.workspaces)) {
          if (Array.isArray(w.sessionIds)) w.sessionIds = w.sessionIds.filter((id) => id !== sessionId);
        }
      }
      if (Array.isArray(raw.global?.archivedSessionIds)) raw.global.archivedSessionIds = raw.global.archivedSessionIds.filter((id) => id !== sessionId);
      if (Array.isArray(raw.global?.pinnedSessionIds)) raw.global.pinnedSessionIds = raw.global.pinnedSessionIds.filter((id) => id !== sessionId);
      const tmp = regPath + '.tmp-swm';
      writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8');
      renameSync(tmp, regPath);
      registryUpdated = true;
      registryVia = 'json';
    }
    // 1.5 注册表收尾（统一，两条路径都要做）：官方服务的 detachSession 不会清理
    // global.pinnedSessionIds / global.archivedSessionIds，实测会留下悬空引用；
    // 这里统一按 sessionId 过滤一遍，有变化才写盘（先备份）。
    if (existsSync(regPath)) {
      let raw = null;
      try {
        raw = JSON.parse(readFileSync(regPath, 'utf8'));
      } catch {
        raw = null;
      }
      if (raw) {
        let dirty = false;
        const drop = (list) => {
          if (!Array.isArray(list)) return list;
          const next = list.filter((id) => id !== sessionId);
          if (next.length !== list.length) dirty = true;
          return next;
        };
        if (raw.global) {
          raw.global.archivedSessionIds = drop(raw.global.archivedSessionIds);
          raw.global.pinnedSessionIds = drop(raw.global.pinnedSessionIds);
        }
        if (raw.tables?.workspaces) {
          for (const w of Object.values(raw.tables.workspaces)) {
            if (Array.isArray(w.sessionIds)) w.sessionIds = drop(w.sessionIds);
          }
        }
        if (dirty) {
          copyFileSync(regPath, regPath + '.bak-swm-' + Date.now());
          const tmp = regPath + '.tmp-swm';
          writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8');
          renameSync(tmp, regPath);
        }
      }
    }
    // 2. 按模式处理会话数据
    let fileResults = [];
    let dirResult = null;
    let cacheResult = null;
    let trashId = null;
    const pc = projcache;
    if (d) {
      if (mode === 'trash') {
        // 移入插件回收站：成果文件保留原地
        let trashTitle = null;
        try {
          trashTitle = analyzeTranscriptCached(d.transcript).title ?? null;
        } catch {
          /* 标题取不到就存空 */
        }
        const trashItem = join(TRASH_DIR(), Date.now() + '-' + sessionId);
        mkdirSync(trashItem, { recursive: true });
        renameSync(d.dir, join(trashItem, 'session'));
        if (existsSync(pc)) renameSync(pc, join(trashItem, 'projcache.json'));
        const meta = {
          sessionId,
          title: trashTitle,
          originalWorkspaceId: inWorkspace,
          originalWorkspacePath: sourceWs ? sourceWs.path : null,
          originalWorkspaceTitle: sourceWs ? sourceWs.title : null,
          originalDirName: d.workspaceDirName,
          cwd: headerCwd,
          deletedAt: Date.now(),
        };
        writeFileSync(join(trashItem, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
        trashId = basename(trashItem);
        dirResult = { path: d.dir, status: 'ok', message: '已移入插件回收站' };
        cacheResult = { path: pc, status: 'ok', message: '已随会话移入回收站' };
      } else if (mode === 'purge') {
        rmSync(d.dir, { recursive: true, force: true });
        dirResult = { path: d.dir, status: 'ok', message: '已彻底删除' };
        if (existsSync(pc)) {
          rmSync(pc, { force: true });
          cacheResult = { path: pc, status: 'ok', message: '已彻底删除' };
        }
        fileResults = files.map((p) => {
          try {
            rmSync(p, { force: true });
            return { path: p, status: existsSync(p) ? 'fail' : 'ok' };
          } catch (e) {
            return { path: p, status: 'fail', message: e.message };
          }
        });
      } else {
        // recycle：会话目录与勾选文件进系统回收站
        fileResults = files.length ? await recyclePaths(files) : [];
        [dirResult] = await recyclePaths([d.dir]);
        let dirInPluginTrash = false;
        if (dirResult.status !== 'ok') {
          // 系统回收站失败（目录可能被 DSH 占用）→ 兜底移入插件回收站，仍可恢复
          try {
            let trashTitle = null;
            try {
              trashTitle = analyzeTranscriptCached(d.transcript).title ?? null;
            } catch {
              /* 标题取不到就存空 */
            }
            const trashItem = join(TRASH_DIR(), Date.now() + '-' + sessionId);
            mkdirSync(trashItem, { recursive: true });
            renameSync(d.dir, join(trashItem, 'session'));
            if (existsSync(pc)) {
              try {
                renameSync(pc, join(trashItem, 'projcache.json'));
              } catch {
                /* projcache 搬不动就留在原地，走下方常规处理 */
              }
            }
            writeFileSync(join(trashItem, 'meta.json'), JSON.stringify({
              sessionId,
              title: trashTitle,
              originalWorkspaceId: inWorkspace,
              originalWorkspacePath: sourceWs ? sourceWs.path : null,
              originalWorkspaceTitle: sourceWs ? sourceWs.title : null,
              originalDirName: d.workspaceDirName,
              cwd: headerCwd,
              deletedAt: Date.now(),
              reason: 'recycle-fallback',
            }, null, 2), 'utf8');
            trashId = basename(trashItem);
            dirResult = { path: d.dir, status: 'ok', message: '系统回收站失败（可能被 DSH 占用），已移入插件回收站（可恢复）' };
            dirInPluginTrash = true;
          } catch (e2) {
            dirResult = { path: d.dir, status: 'fail', message: '系统回收站与插件回收站均失败: ' + (e2 instanceof Error ? e2.message : String(e2)) };
          }
        }
        const pcMoved = dirInPluginTrash && !existsSync(pc);
        if (pcMoved) {
          cacheResult = { path: pc, status: 'ok', message: '已随会话移入插件回收站' };
        } else if (existsSync(pc)) {
          [cacheResult] = await recyclePaths([pc]);
          if (cacheResult.status !== 'ok') {
            try {
              rmSync(pc, { force: true });
              cacheResult = { path: pc, status: 'ok', message: '回收站失败（可能被 DSH 占用），已直接删除缓存' };
            } catch (e) {
              cacheResult = { path: pc, status: 'fail', message: '回收站与直接删除均失败: ' + e.message };
            }
          }
        }
      }
    } else {
      // 无目录（记录缺失型）：仅缓存处理
      if (existsSync(pc)) {
        if (mode === 'purge') {
          rmSync(pc, { force: true });
          cacheResult = { path: pc, status: 'ok', message: '已彻底删除' };
        } else {
          [cacheResult] = await recyclePaths([pc]);
          if (cacheResult.status !== 'ok') {
            try {
              rmSync(pc, { force: true });
              cacheResult = { path: pc, status: 'ok', message: '回收站失败，已直接删除缓存' };
            } catch (e) {
              cacheResult = { path: pc, status: 'fail', message: e.message };
            }
          }
        }
      }
      dirResult = { path: null, status: 'missing', message: '会话本无正文目录' };
    }
    // 3. 清内存缓存
    if (d?.transcript) dropAnalysisCache(d.transcript);
    return {
      ok: true,
      sessionId,
      mode,
      trashId,
      fileResults,
      registryUpdated,
      registryVia,
      dirResult,
      cacheResult,
      note: mode === 'trash'
        ? '已移入插件回收站（面板右上角「回收站」可恢复）。成果文件保留原地未动。'
        : '若 DSH 界面仍显示该会话，重启 DSH 后即会消失。',
    };
  }

  // ---------- 官方宿主服务访问（ctx.get 安全封装） ----------
  // workspaceRegistry：删除时的会话摘除（detachSession）；sessions/sessionTitle：重命名。
  function svc(name) {
    try {
      const s = ctx.get(name);
      return s === undefined ? null : s;
    } catch {
      return null;
    }
  }
  function wsSvc() {
    const r = svc('workspaceRegistry');
    return r && typeof r.get === 'function' && typeof r.list === 'function' ? r : null;
  }

  // ---------- 插件回收站（可恢复 / 到期自动清理） ----------
  const TRASH_DIR = () => join(dshHome(), 'session-trash');
  const SETTINGS_PATH = () => join(dshHome(), 'swm-settings.json');
  function loadSettings() {
    try {
      const s = JSON.parse(readFileSync(SETTINGS_PATH(), 'utf8'));
      if (Number.isFinite(s.retainDays)) return s;
    } catch {
      /* 无设置文件用默认值 */
    }
    return { retainDays: 30 };
  }
  function listTrashItems() {
    const dir = TRASH_DIR();
    if (!existsSync(dir)) return [];
    const out = [];
    for (const name of readdirSync(dir)) {
      const metaPath = join(dir, name, 'meta.json');
      if (!existsSync(metaPath)) continue;
      try {
        out.push(Object.assign({ trashId: name }, JSON.parse(readFileSync(metaPath, 'utf8'))));
      } catch {
        /* 坏 meta 跳过 */
      }
    }
    return out.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  }
  function cleanExpiredTrash() {
    const { retainDays } = loadSettings();
    const cutoff = Date.now() - retainDays * 86400000;
    let removed = 0;
    for (const item of listTrashItems()) {
      if ((item.deletedAt ?? 0) < cutoff) {
        try {
          rmSync(join(TRASH_DIR(), item.trashId), { recursive: true, force: true });
          removed += 1;
        } catch {
          /* 占用中下次再清 */
        }
      }
    }
    return removed;
  }
  /** 注册表备份轮转：workspace.json.bak-swm-* 只保留最近 keep 份 */
  function cleanOldRegistryBackups(keep = 10) {
    const dir = join(dshHome(), 'storages');
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return 0;
    }
    const prefix = 'workspace.json.bak-swm-';
    const baks = names
      .filter((n) => n.startsWith(prefix))
      .map((n) => ({ name: n, t: Number(n.slice(prefix.length)) || 0 }))
      .sort((a, b) => b.t - a.t);
    let removed = 0;
    for (const b of baks.slice(keep)) {
      try {
        rmSync(join(dir, b.name), { force: true });
        removed += 1;
      } catch {
        /* 占用中下次再清 */
      }
    }
    return removed;
  }

  async function restoreFromTrash(body) {
    const trashId = String(body?.trashId ?? '');
    const itemDir = join(TRASH_DIR(), trashId);
    if (!trashId || trashId.includes('..') || !existsSync(join(itemDir, 'meta.json'))) throw new SwmError(404, '回收站项不存在');
    const meta = JSON.parse(readFileSync(join(itemDir, 'meta.json'), 'utf8'));
    const sessionId = meta.sessionId;
    const reg = readWorkspaceRegistry();
    let target = reg.workspaces.find((w) => w.id === meta.originalWorkspaceId)
      ? { id: meta.originalWorkspaceId, path: meta.originalWorkspacePath, title: meta.originalWorkspaceTitle }
      : null;
    if (body?.targetWorkspaceId) {
      const alt = reg.workspaces.find((w) => w.id === body.targetWorkspaceId);
      if (alt) target = { id: alt.id, path: alt.path, title: alt.title };
    }
    if (!target || !target.path) throw new SwmError(400, '原工作区已不存在，请指定恢复目标工作区');
    if (!existsSync(join(itemDir, 'session'))) throw new SwmError(404, '回收站项缺少会话正文');
    // 规范目标路径（实体 path 优先，attach 校验用）
    const svc = wsSvc();
    const dstEntity = svc ? svc.get(target.id) : null;
    const canonicalTarget = dstEntity ? dstEntity.path : target.path;
    // 冲突检查
    const dstDir = join(sessionsRoot(), projectKey(canonicalTarget), sessionId);
    if (existsSync(dstDir)) throw new SwmError(409, '目标工作区已存在同名会话目录，无法恢复');
    // 1. 会话先移回**原目录位置**（attach 读会话头走原索引路径；原编码目录名缺失时用 cwd 推导）
    const origDirName = meta.originalDirName || projectKey(meta.cwd || '');
    const origDir = join(sessionsRoot(), origDirName);
    mkdirSync(origDir, { recursive: true });
    renameSync(join(itemDir, 'session'), join(origDir, sessionId));
    // 2. projcache 移回并修正 cwd
    const pcTrash = join(itemDir, 'projcache.json');
    const pc = join(dshHome(), 'storages', 'session_projcache', 'sessions', sessionId + '.json');
    if (existsSync(pcTrash)) {
      if (meta.cwd && meta.cwd !== canonicalTarget) {
        let text = readFileSync(pcTrash, 'utf8');
        const escOld = JSON.stringify(meta.cwd).slice(1, -1);
        const escNew = JSON.stringify(canonicalTarget).slice(1, -1);
        text = text.split(escOld).join(escNew).split(meta.cwd).join(canonicalTarget);
        writeFileSync(pc, text, 'utf8');
      } else {
        renameSync(pcTrash, pc);
      }
    }
    // 3. 正文首行 cwd 修正（原文暂存 trash 项内，全部成功后一并清理）
    const tPath = join(origDir, sessionId, 'session.v4.jsonl.zstd');
    const orig = readFileSync(tPath);
    if (meta.cwd && meta.cwd !== canonicalTarget) {
      writeFileSync(join(itemDir, 'transcript-before-restore.zstd.bak'), orig);
      const txt = decompressMultiframeZstd(orig).toString('utf8');
      const nl = txt.indexOf('\n');
      const headerLine = JSON.parse(txt.slice(0, nl));
      headerLine.cwd = canonicalTarget;
      writeFileSync(tPath, zstdCompressSync(Buffer.from(JSON.stringify(headerLine) + txt.slice(nl), 'utf8')));
    }
    // 4. 会话归属：官方服务 attach（实时生效，索引更新到目标位置）；失败回退 JSON
    const regPath = join(dshHome(), 'storages', 'workspace.json');
    let registryUpdated = false;
    let registryVia = null;
    let attachErr = null;
    if (dstEntity && typeof dstEntity.attachSession === 'function') {
      try {
        await dstEntity.attachSession(sessionId);
        registryUpdated = true;
        registryVia = 'workspace-service';
      } catch (e) {
        attachErr = e;
        logger?.warn?.('[swm] attachSession 失败，回退 JSON:', e);
      }
    }
    if (!registryUpdated && existsSync(regPath)) {
      copyFileSync(regPath, regPath + '.bak-swm-' + Date.now());
      const raw = JSON.parse(readFileSync(regPath, 'utf8'));
      if (raw.tables?.workspaces?.[target.id]) {
        const list = Array.isArray(raw.tables.workspaces[target.id].sessionIds) ? raw.tables.workspaces[target.id].sessionIds : (raw.tables.workspaces[target.id].sessionIds = []);
        if (!list.includes(sessionId)) list.push(sessionId);
        raw.tables.workspaces[target.id].updatedAt = new Date().toISOString();
        atomicWrite(regPath, JSON.stringify(raw, null, 2));
      }
      registryVia = 'json';
    }
    // 5. 从原目录位置搬到目标编码目录（attach 后索引已指向 projectKey(canonicalTarget)）
    if (origDirName !== projectKey(canonicalTarget)) {
      mkdirSync(dirname(dstDir), { recursive: true });
      renameSync(join(origDir, sessionId), dstDir);
    }
    rmSync(itemDir, { recursive: true, force: true });
    dropAnalysisCache(tPath);
    return {
      ok: true,
      sessionId,
      restoredTo: { workspaceId: target.id, path: canonicalTarget, title: target.title },
      registryUpdated,
      registryVia,
      attachErr: attachErr ? String(attachErr.message || attachErr) : null,
      note: registryVia === 'workspace-service'
        ? '恢复完成并实时生效，会话已回到「' + target.title + '」。'
        : '恢复完成（已写入磁盘），重启 DSH 后会话出现在「' + target.title + '」的列表里。',
    };
  }

  function purgeTrashItems(body) {
    const trashId = String(body?.trashId ?? '');
    if (body?.emptyAll) {
      let n = 0;
      for (const item of listTrashItems()) {
        try {
          rmSync(join(TRASH_DIR(), item.trashId), { recursive: true, force: true });
          n += 1;
        } catch {
          /* 占用中跳过 */
        }
      }
      return { ok: true, purged: n };
    }
    if (Array.isArray(body?.trashIds) && body.trashIds.length) {
      let n = 0;
      const failed = [];
      for (const tid of body.trashIds.map(String)) {
        if (!tid || tid.includes('..')) {
          failed.push(tid);
          continue;
        }
        const dir = join(TRASH_DIR(), tid);
        if (!existsSync(dir)) continue;
        try {
          rmSync(dir, { recursive: true, force: true });
          n += 1;
        } catch {
          failed.push(tid);
        }
      }
      return { ok: true, purged: n, failed };
    }
    if (!trashId || trashId.includes('..')) throw new SwmError(400, '非法的回收站项');
    const dir = join(TRASH_DIR(), trashId);
    if (!existsSync(dir)) throw new SwmError(404, '回收站项不存在');
    rmSync(dir, { recursive: true, force: true });
    return { ok: true, purged: 1 };
  }

  // 到期自动清理 + 注册表备份轮转：启动时 + 每小时（定时器随插件卸载销毁）
  try {
    cleanExpiredTrash();
  } catch {
    /* 启动清理失败不阻塞 */
  }
  try {
    cleanOldRegistryBackups();
  } catch {
    /* 同上 */
  }
  const swmTimer = setInterval(() => {
    try {
      cleanExpiredTrash();
    } catch {
      /* 忽略 */
    }
    try {
      cleanOldRegistryBackups();
    } catch {
      /* 忽略 */
    }
  }, 3600000);
  if (typeof ctx.effect === 'function') ctx.effect(() => clearInterval(swmTimer));

  // ---------- 会话目录编码 ----------
  // DSH 会话目录编码 —— 逐字移植自 @deepseek-ai/dsh-session-persistence-jsonl 的 projectKey()：
  // 分隔符（/\:）连续段折叠为一个 '-'；安全字符 [A-Za-z0-9._-] 保留；其余转义为 ~XXXX；
  // 去掉前导 '-' 后以 -- 包裹（上限 251 字符）。
  function projectKey(cwd) {
    if (!cwd || cwd.length === 0) throw new SwmError(400, 'cannot encode an empty project path');
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

  function atomicWrite(path, content) {
    const tmp = path + '.tmp-swm';
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, path);
  }

  function buildSessionDetail(sessionId) {
    const dirs = scanSessionDirs();
    const d = dirs.find((x) => x.id === sessionId);
    if (!d) throw new Error('会话目录不存在: ' + sessionId);
    if (!d.transcript) throw new Error('会话正文文件缺失: ' + d.dir);
    const a = analyzeTranscriptCached(d.transcript);
    const { results, others } = classifySessionFiles(a, d.transcript);
    return {
      ok: true,
      id: sessionId,
      dir: d.dir,
      title: a.title,
      header: a.header,
      turns: a.turns,
      toolCounts: a.toolCounts,
      codeBlocks: a.codeBlocks ?? [],
      files: {
        results,
        others,
        written: a.written,
        edited: a.edited,
      },
    };
  }

  function buildProbe(ctx2) {
    const reg = readWorkspaceRegistry();
    const dirs = scanSessionDirs();
    let selfTest = null;
    const sample = dirs.find((d) => d.transcript);
    if (sample) {
      try {
        const buf = readFileSync(sample.transcript);
        const frames = splitZstdFrames(buf);
        selfTest = { frames: frames.length, sampleFile: sample.transcript };
      } catch {
        selfTest = null;
      }
    }
    // 目录名编码样本：注册表 path vs 实际目录名（借助会话头 cwd 建立 workspace->目录 映射）
    const encodingSamples = [];
    for (const w of reg.workspaces) {
      const dirsOfWs = dirs.filter((d) => {
        try {
          const h = readSessionHeader(d.transcript);
          return h && normWsPath(h.cwd) === normWsPath(w.path);
        } catch {
          return false;
        }
      });
      if (dirsOfWs.length) {
        encodingSamples.push({
          path: w.path,
          dirName: dirsOfWs[0].workspaceDirName,
          match: true,
        });
      }
    }
    let hasConnection = false;
    try {
      hasConnection = Boolean(ctx2?.connection?.requestRejection);
    } catch {
      /* 未声明注入时不允许访问 connection 服务 */
    }
    return {
      ok: true,
      nodeVersion: process.version,
      hasZstd: hasZstdSupport(),
      selfTest,
      dshHome: dshHome(),
      sessionsRoot: sessionsRoot(),
      registryPath: reg.registryPath,
      workspaceCount: reg.workspaces.length,
      sessionDirCount: dirs.length,
      encodingSamples,
      services: {
        webServer: typeof ctx2?.webServer?.register === 'function',
        connection: hasConnection,
      },
    };
  }

  // ---------- 体检：数据一致性检测 + 一键修复 ----------
  /** 扫一遍注册表/磁盘/缓存，汇总所有可诊断问题；每项问题带 type 供一键修复定向处理 */
  function buildHealth() {
    const reg = readWorkspaceRegistry();
    const dirs = scanSessionDirs();
    const onDisk = new Set(dirs.map((d) => d.id));
    const issues = [];

    const danglingPinned = (reg.pinnedSessionIds ?? []).filter((id) => !onDisk.has(id));
    if (danglingPinned.length) {
      issues.push({ type: 'dangling-pinned', label: '置顶列表引用了不存在的会话（已删除/已进回收站）', items: danglingPinned });
    }
    const danglingArchived = (reg.archivedSessionIds ?? []).filter((id) => !onDisk.has(id));
    if (danglingArchived.length) {
      issues.push({ type: 'dangling-archived', label: '归档列表引用了不存在的会话', items: danglingArchived });
    }
    const danglingBound = [];
    for (const w of reg.workspaces) {
      for (const id of w.sessionIds ?? []) {
        if (!onDisk.has(id)) danglingBound.push({ workspaceTitle: w.title, sessionId: id });
      }
    }
    if (danglingBound.length) {
      issues.push({ type: 'dangling-bound', label: '工作区绑定了磁盘上已不存在的会话（重启后幽灵条目的来源）', items: danglingBound.map((x) => x.workspaceTitle + ' ← ' + x.sessionId) });
    }
    const wsIds = new Set(reg.workspaces.map((w) => w.id));
    if (reg.defaultWorkspaceId && !wsIds.has(reg.defaultWorkspaceId)) {
      issues.push({ type: 'bad-default-workspace', label: '默认工作区指向已不存在的工作区', items: [reg.defaultWorkspaceId] });
    }
    const pcDir = join(dshHome(), 'storages', 'session_projcache', 'sessions');
    const orphanProjcache = [];
    try {
      for (const f of readdirSync(pcDir)) {
        if (!f.endsWith('.json')) continue;
        if (!onDisk.has(f.slice(0, -'.json'.length))) orphanProjcache.push(f);
      }
    } catch {
      /* 目录不存在视为无孤儿 */
    }
    if (orphanProjcache.length) {
      issues.push({ type: 'orphan-projcache', label: '会话缓存文件没有对应的会话（孤儿 projcache，白占磁盘）', items: orphanProjcache });
    }
    const storagesDir = join(dshHome(), 'storages');
    let bakCount = 0;
    try {
      bakCount = readdirSync(storagesDir).filter((n) => n.startsWith('workspace.json.bak-swm-')).length;
    } catch {
      /* 忽略 */
    }
    if (bakCount > 10) {
      issues.push({ type: 'backup-pileup', label: '注册表备份超过 10 份（每小时自动轮转，也可立即清理）', items: [bakCount + ' 份'] });
    }
    return { ok: true, checkedAt: Date.now(), workspaceCount: reg.workspaces.length, sessionDirCount: dirs.length, bakCount, issues };
  }

  /** 一键修复：body.types 指定要修的问题类型；缺省 = 全部可修项。注册表修改前自动备份 */
  function fixHealthIssues(body) {
    const types = Array.isArray(body?.types) && body.types.length ? body.types.map(String) : null;
    const want = (t) => !types || types.includes(t);
    const done = [];
    const skipped = [];
    const regPath = join(dshHome(), 'storages', 'workspace.json');

    // 1) 注册表类修复（一次读取、一次备份、一次写盘）
    const regTypes = ['dangling-pinned', 'dangling-archived', 'dangling-bound', 'bad-default-workspace'];
    if ((!types || types.some((t) => regTypes.includes(t))) && existsSync(regPath)) {
      let raw = null;
      try {
        raw = JSON.parse(readFileSync(regPath, 'utf8'));
      } catch {
        raw = null;
      }
      if (raw) {
        const onDisk = new Set(scanSessionDirs().map((d) => d.id));
        const before = JSON.stringify(raw);
        if (raw.global) {
          if (want('dangling-pinned') && Array.isArray(raw.global.pinnedSessionIds)) {
            raw.global.pinnedSessionIds = raw.global.pinnedSessionIds.filter((id) => onDisk.has(id));
          }
          if (want('dangling-archived') && Array.isArray(raw.global.archivedSessionIds)) {
            raw.global.archivedSessionIds = raw.global.archivedSessionIds.filter((id) => onDisk.has(id));
          }
        }
        if (want('dangling-bound') && raw.tables?.workspaces) {
          for (const w of Object.values(raw.tables.workspaces)) {
            if (Array.isArray(w.sessionIds)) w.sessionIds = w.sessionIds.filter((id) => onDisk.has(id));
          }
        }
        if (want('bad-default-workspace')) {
          const ids = new Set(Object.keys(raw.tables?.workspaces ?? {}));
          if (raw.global && raw.global.defaultWorkspaceId && !ids.has(raw.global.defaultWorkspaceId)) {
            raw.global.defaultWorkspaceId = ids.size ? [...ids][0] : null;
          }
        }
        if (JSON.stringify(raw) !== before) {
          copyFileSync(regPath, regPath + '.bak-swm-' + Date.now());
          atomicWrite(regPath, JSON.stringify(raw, null, 2));
          done.push('注册表已清理（修改前已备份）');
        }
      } else {
        skipped.push('注册表读取失败，跳过注册表类修复');
      }
    }

    // 2) 孤儿 projcache：直接删除（缓存可由 DSH 重建，风险低）
    if (!types || types.includes('orphan-projcache')) {
      const onDisk2 = new Set(scanSessionDirs().map((d) => d.id));
      const pcDir = join(dshHome(), 'storages', 'session_projcache', 'sessions');
      let n = 0;
      try {
        for (const f of readdirSync(pcDir)) {
          if (!f.endsWith('.json')) continue;
          if (onDisk2.has(f.slice(0, -'.json'.length))) continue;
          try {
            rmSync(join(pcDir, f), { force: true });
            n += 1;
          } catch {
            /* 占用中跳过 */
          }
        }
      } catch {
        /* 目录不存在 */
      }
      if (n) done.push('已清理孤儿 projcache ' + n + ' 个');
    }

    // 3) 备份轮转立即执行
    if (!types || types.includes('backup-pileup')) {
      const removed = cleanOldRegistryBackups();
      if (removed) done.push('已清理过期备份 ' + removed + ' 份');
    }

    return { ok: true, done, skipped, health: buildHealth() };
  }

  logger?.info?.('dsh-session-ws-manager: 面板已挂载 -> /swm');
};
