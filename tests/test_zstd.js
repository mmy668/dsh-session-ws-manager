// 验证 1：zstd 多帧解析对照真实会话文件 + projectKey 对照真实目录名
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { decompressFirstFrame, decompressMultiframeZstd, splitZstdFrames, zstdCompressSync } from 'file:///D:/dsh-plugins/dsh-session-ws-manager/lib/zstd-multiframe.js';

const root = join(process.env.USERPROFILE, '.dsh', 'sessions');
const ZSTD_CLI = 'D:/mysy2/mingw64/bin/zstd.exe';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('✅', name, detail ?? ''); }
  else { fail++; console.log('❌', name, detail ?? ''); }
};

// 收集真实会话文件
const files = [];
for (const ws of readdirSync(root)) {
  const wsDir = join(root, ws);
  for (const s of readdirSync(wsDir)) {
    const t = join(wsDir, s, 'session.v4.jsonl.zstd');
    if (existsSync(t)) files.push({ wsDirName: ws, sessionId: s, path: t });
  }
}
console.log('找到真实会话文件:', files.length);

for (const f of files) {
  const buf = readFileSync(f.path);
  // 1) 帧切分
  const frames = splitZstdFrames(buf);
  ok(`帧切分 [${f.sessionId}]`, frames.length >= 1, `-> ${frames.length} 帧, 文件 ${buf.length} 字节`);
  // 2) 我的解压 vs zstd CLI 对第一帧
  const mine = decompressFirstFrame(buf).toString('utf8').split('\n', 1)[0];
  const cliOut = execFileSync(ZSTD_CLI, ['-dc'], { input: frames[0], maxBuffer: 32e6 }).toString('utf8').split('\n', 1)[0];
  ok(`首帧与 zstd CLI 一致 [${f.sessionId}]`, mine === cliOut);
  const header = JSON.parse(mine);
  ok(`会话头可解析 [${f.sessionId}]`, header.type === 'session' && typeof header.cwd === 'string', `cwd=${header.cwd}`);
  // 3) 全量解压行数 vs CLI 全量
  const mineAll = decompressMultiframeZstd(buf).toString('utf8');
  const cliAll = execFileSync(ZSTD_CLI, ['-dc'], { input: buf, maxBuffer: 64e6 }).toString('utf8');
  ok(`全量多帧解压一致 [${f.sessionId}]`, mineAll === cliAll, `-> ${mineAll.split('\n').length} 行`);
  // 4) 压缩往返（restoreFromTrash 的重写路径）
  const re = zstdCompressSync(Buffer.from(mineAll, 'utf8'));
  ok(`压缩往返 [${f.sessionId}]`, decompressMultiframeZstd(re).toString('utf8') === mineAll, `-> 重压 ${re.length} 字节`);
  // 5) projectKey 与真实目录名对照
  const expected = '--' + header.cwd.replace(/^([A-Za-z]):[\\/]/, (m, d) => d + '-').replace(/[\\/]+/g, '-').replace(/:/g, '-') + '--';
  ok(`目录名匹配 [${f.sessionId}]`, f.wsDirName === '--D-DSH-WORK-1--' || f.wsDirName === expected, `dir=${f.wsDirName}`);
}

// projectKey 精确对照（从 index.js 抽出的逻辑，直接对 D:\DSH-WORK-1 编码）
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
ok('projectKey(D:\\DSH-WORK-1) === --D-DSH-WORK-1--', projectKey('D:\\DSH-WORK-1') === '--D-DSH-WORK-1--', projectKey('D:\\DSH-WORK-1'));
ok('projectKey 带中文转义', /^--[A-Z]-[A-Za-z0-9~_-]+--$/.test(projectKey('D:\\工作区测试')), projectKey('D:\\工作区测试'));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
