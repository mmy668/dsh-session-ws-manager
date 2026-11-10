// DSH 数据读取与文件归属分析（只读，M1）
// 数据布局（本机实测）：
//   ~/.dsh/storages/workspace.json                      工作区注册表（workspaces[id] = {path,title,sessionIds[]}）
//   ~/.dsh/sessions/<工作区路径编码>/session-<uuid>/     session.v4.jsonl.zstd 会话正文（多帧 zstd JSONL）
//   ~/.dsh/storages/session_projcache/sessions/<id>.json 每会话缓存
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { decompressFirstFrame, decompressMultiframeZstd, hasZstdSupport } from './zstd-multiframe.js';

export function dshHome() {
  return process.env.DSH_HOME ? String(process.env.DSH_HOME) : join(homedir(), '.dsh');
}

export function sessionsRoot() {
  return join(dshHome(), 'sessions');
}

export function readWorkspaceRegistry() {
  const p = join(dshHome(), 'storages', 'workspace.json');
  if (!existsSync(p)) {
    return { workspaces: [], archivedSessionIds: [], pinnedSessionIds: [], defaultWorkspaceId: null, registryPath: p };
  }
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const tables = raw.tables?.workspaces ?? {};
  return {
    workspaces: Object.entries(tables).map(([id, w]) => ({
      id,
      path: w.path ?? null,
      title: w.title ?? null,
      sessionIds: w.sessionIds ?? [],
      createdAt: w.createdAt ?? null,
      updatedAt: w.updatedAt ?? null,
    })),
    defaultWorkspaceId: raw.global?.defaultWorkspaceId ?? null,
    archivedSessionIds: raw.global?.archivedSessionIds ?? [],
    pinnedSessionIds: raw.global?.pinnedSessionIds ?? [],
    registryPath: p,
  };
}

function statSafe(p, key) {
  try {
    return statSync(p)[key];
  } catch {
    return 0;
  }
}

/** 扫描 sessions 根目录，列出全部会话目录（不解压正文） */
export function scanSessionDirs() {
  const root = sessionsRoot();
  const out = [];
  if (!existsSync(root)) return out;
  for (const wsDirName of readdirSync(root)) {
    const wsDirPath = join(root, wsDirName);
    let entries;
    try {
      entries = readdirSync(wsDirPath);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.startsWith('session-')) continue;
      const dir = join(wsDirPath, name);
      const transcript = join(dir, 'session.v4.jsonl.zstd');
      out.push({
        id: name,
        dir,
        workspaceDirName: wsDirName,
        transcript: existsSync(transcript) ? transcript : null,
        sizeBytes: statSafe(transcript, 'size'),
        mtime: statSafe(dir, 'mtimeMs'),
      });
    }
  }
  return out;
}

/** 读会话头部（第一帧）：{ type:'session', id, cwd, createdAt, ... } */
export function readSessionHeader(transcriptPath) {
  if (!transcriptPath) return null;
  const first = decompressFirstFrame(readFileSync(transcriptPath));
  const line = first.toString('utf8').split('\n', 1)[0];
  return JSON.parse(line);
}

function argPath(args) {
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (!args || typeof args !== 'object') return null;
  return args.file_path ?? args.path ?? args.absolute_path ?? null;
}

/**
 * 全量解析会话正文，提取文件归属与统计。
 * 过程文件 = write/edit 工具调用写过的文件（含 AI 自建的脚本等中间产物）。
 * 成果文件 = univer_export 等导出工具的 output 目标、AI 最终答复中提到的文件、
 *            以及非临时目录下的文档类文件；其余（脚本、tmp 下的文件）归为过程文件。
 * pwsh 等命令的文件改动不可靠解析，默认不计（UI 里说明）。
 */
export function analyzeTranscript(transcriptPath) {
  const text = decompressMultiframeZstd(readFileSync(transcriptPath)).toString('utf8');
  const events = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      /* 忽略尾部残行 */
    }
  }
  const header = events.find((e) => e.type === 'session') ?? null;
  let title = null;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'session/title') {
      const d = events[i].data ?? {};
      title = d.title ?? d.text ?? d.value ?? null;
      break;
    }
  }
  const written = new Map();
  const edited = new Map();
  const exported = new Map();
  const toolCounts = {};
  const codeBlocks = [];
  const COMMAND_TOOLS = { pwsh: 'powershell', bash: 'bash', ops_bash: 'bash', sh: 'bash' };
  let finalAssistantText = '';
  for (const e of events) {
    if (e.type === 'assistant/message' && Array.isArray(e.data?.message?.content)) {
      const texts = e.data.message.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ');
      if (texts.trim()) {
        finalAssistantText = texts;
        // 提取 AI 回复里的 markdown 代码块
        for (const m of texts.matchAll(/```([a-zA-Z0-9+#._-]*)[ \t]*\r?\n([\s\S]*?)```/g)) {
          const text = (m[2] ?? '').trim();
          if (!text) continue;
          codeBlocks.push({ source: 'AI 代码', lang: m[1] || '', text: text.slice(0, 5000), time: e.time ?? null });
        }
      }
      continue;
    }
    if (e.type !== 'tool/call') continue;
    const n = e.data?.name;
    toolCounts[n] = (toolCounts[n] ?? 0) + 1;
    let args = e.data?.arguments;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = null;
      }
    }
    if (COMMAND_TOOLS[n]) {
      const cmd = typeof args?.command === 'string' ? args.command.trim() : '';
      if (cmd) codeBlocks.push({ source: '执行命令', lang: COMMAND_TOOLS[n], text: cmd.slice(0, 5000), time: e.time ?? null });
    }
    if (n === 'write' || n === 'edit') {
      const p = argPath(args);
      if (!p) continue;
      const map = n === 'write' ? written : edited;
      const rec = map.get(p) ?? { path: p, calls: 0, firstTime: e.time ?? null, lastTime: e.time ?? null };
      rec.calls += 1;
      rec.lastTime = e.time ?? rec.lastTime;
      map.set(p, rec);
    } else if (n === 'univer_export' || n === 'univer_print_pdf') {
      // 文档导出工具：output 是最终成果；file（.univer 工程）是中间产物
      const out = args?.output ?? null;
      if (out && typeof out === 'string') {
        const rec = exported.get(out) ?? { path: out, calls: 0, lastTime: e.time ?? null };
        rec.calls += 1;
        exported.set(out, rec);
      }
    }
  }
  return {
    header,
    title,
    turns: events.filter((e) => e.type === 'turn/start').length,
    // 最早事件时间：普通会话即开始时间；seeded 转移会话的重放事件保留原始时间戳，
    // 因此它等于“原始会话的开始时间”——供文件时间过滤使用
    firstEventTime: events.find((e) => typeof e.time === 'number')?.time ?? null,
    toolCounts,
    codeBlocks: codeBlocks.slice(0, 300),
    written: [...written.values()],
    edited: [...edited.values()],
    exported: [...exported.values()],
    finalAssistantText,
  };
}

/** 成果文件判定用的扩展名集合（文档/图片/数据/压缩包） */
export const DELIVERABLE_EXT = new Set([
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'csv',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp',
  'md', 'txt', 'sql', 'html', 'htm', 'ipynb', 'zip', '7z', 'rar',
]);

export function normPath(p) {
  return String(p ?? '').replace(/\\/g, '/').toLowerCase();
}

function extOf(p) {
  const m = /\.([a-z0-9]+)$/i.exec(String(p ?? ''));
  return m ? m[1].toLowerCase() : '';
}

export function isTempDirPath(p) {
  return /(^|\/)(tmp|temp|\.tmp|\.temp|cache|~tmp)(\/|$)/i.test(normPath(p));
}

/** 从最终答复文本中提取“像文件路径/文件名”的片段（盘符路径 + 反引号引用） */
export function filePathTokens(text) {
  const out = new Set();
  if (!text) return out;
  for (const m of text.matchAll(/[A-Za-z]:[\\/][^\s`'"，。；、）)】\]]{2,}/g)) {
    out.add(m[0].replace(/[.,;:，。；：]+$/, ''));
  }
  for (const m of text.matchAll(/`([^`]{2,200})`/g)) out.add(m[1].trim());
  return out;
}

/**
 * 把会话的全部文件分成成果/过程两组。
 * results 来源：① 导出工具的 output；② 最终答复中提到的文件；③ 非临时目录下的文档类扩展名文件。
 */
export function classifyFiles(analysis) {
  const ft = normPath(analysis.finalAssistantText ?? '');
  const tokens = [...filePathTokens(analysis.finalAssistantText ?? '')].map(normPath);
  const mentioned = (p) => {
    const n = normPath(p);
    const base = n.split('/').pop();
    if (!base || base.length < 3) return false;
    if (ft.includes(n) || ft.includes(base)) return true;
    return tokens.some((t) => t === n || n.endsWith(t) || t.endsWith(base));
  };
  const results = new Map(); // path -> {path, ops:[], sources:[]}
  const others = new Map();
  const addResult = (p, op, source) => {
    const r = results.get(p) ?? { path: p, ops: [], sources: [] };
    if (!r.ops.includes(op)) r.ops.push(op);
    if (!r.sources.includes(source)) r.sources.push(source);
    results.set(p, r);
  };
  const addOther = (p, op) => {
    const r = others.get(p) ?? { path: p, ops: [] };
    if (!r.ops.includes(op)) r.ops.push(op);
    others.set(p, r);
  };
  for (const f of analysis.exported ?? []) addResult(f.path, 'export', 'export');
  for (const f of analysis.written ?? []) {
    const ext = extOf(f.path);
    if (mentioned(f.path)) addResult(f.path, 'write', 'final-answer');
    else if (DELIVERABLE_EXT.has(ext) && !isTempDirPath(f.path)) addResult(f.path, 'write', 'doc-type');
    else addOther(f.path, 'write');
  }
  for (const f of analysis.edited ?? []) {
    const ext = extOf(f.path);
    if (results.has(f.path)) {
      addResult(f.path, 'edit', 'edit');
    } else if (mentioned(f.path)) addResult(f.path, 'edit', 'final-answer');
    else if (DELIVERABLE_EXT.has(ext) && !isTempDirPath(f.path)) addResult(f.path, 'edit', 'doc-type');
    else addOther(f.path, 'edit');
  }
  return { results: [...results.values()], others: [...others.values()] };
}

const mtimeCache = new Map(); // transcriptPath -> mtimeMs，避免重复全量解析
const detailCache = new Map();

/** 会话被删除后清掉内存缓存 */
export function dropAnalysisCache(transcriptPath) {
  detailCache.delete(transcriptPath);
  mtimeCache.delete(transcriptPath);
}

export function analyzeTranscriptCached(transcriptPath) {
  const mtime = statSafe(transcriptPath, 'mtimeMs');
  if (detailCache.has(transcriptPath) && mtimeCache.get(transcriptPath) === mtime) {
    return detailCache.get(transcriptPath);
  }
  const result = analyzeTranscript(transcriptPath);
  mtimeCache.set(transcriptPath, mtime);
  detailCache.set(transcriptPath, result);
  return result;
}

export { hasZstdSupport };
