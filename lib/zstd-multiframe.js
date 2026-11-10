// 多帧 zstd 解析（DSH 的 session.v4.jsonl.zstd 是"每次追加重新压缩一帧再拼接"的多帧文件）。
// node:zlib 的一次性 zstdDecompressSync 只认单帧，这里按 RFC 8878 自行遍历帧边界
// （magic + Frame_Header_Descriptor + 块序列 + 可选校验和 + 可跳过帧），再逐帧交给 node:zlib 解压。
import { zstdCompressSync as nodeZstdCompressSync, zstdDecompressSync } from 'node:zlib';

const FRAME_MAGIC = 0xFD2FB528; // 28 B5 2F FD 小端读取

export function hasZstdSupport() {
  return typeof nodeZstdCompressSync === 'function' && typeof zstdDecompressSync === 'function';
}

/** 把多帧 zstd 缓冲切分为独立帧（含可跳过帧），返回帧缓冲数组；格式非法时抛错 */
export function splitZstdFrames(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('splitZstdFrames: 需要 Buffer');
  const frames = [];
  let i = 0;
  while (i < buf.length) {
    if (i + 4 > buf.length) break; // 尾部残字节（写入中断的半帧），丢弃
    const magic = buf.readUInt32LE(i);
    if (magic === FRAME_MAGIC) {
      const start = i;
      i += 4;
      // ---- Frame_Header ----
      if (i >= buf.length) throw new Error('zstd: 帧头被截断');
      const fhd = buf[i];
      i += 1;
      const fcsFlag = (fhd >> 6) & 0x3;
      const singleSegment = (fhd >> 5) & 0x1;
      const checksumFlag = (fhd >> 2) & 0x1;
      const didCode = fhd & 0x3;
      const didSize = didCode === 0 ? 0 : didCode === 1 ? 1 : didCode === 2 ? 2 : 4;
      // Window_Descriptor 在非 singleSegment 时存在
      if (!singleSegment) i += 1;
      i += didSize;
      // Frame_Content_Size 字段宽度
      let fcsSize = 0;
      if (fcsFlag === 0) fcsSize = singleSegment ? 1 : 0;
      else if (fcsFlag === 1) fcsSize = 2;
      else if (fcsFlag === 2) fcsSize = 4;
      else fcsSize = 8;
      i += fcsSize;
      if (i > buf.length) throw new Error('zstd: 帧头被截断');
      // ---- Blocks ----
      let last = false;
      while (!last) {
        if (i + 3 > buf.length) throw new Error('zstd: 块头被截断');
        const header = buf.readUIntLE(i, 3);
        i += 3;
        last = Boolean(header & 0x1);
        const blockType = (header >> 1) & 0x3;
        const blockSize = header >> 3;
        if (blockType === 1) i += 1; // RLE_Block：负载只有 1 字节
        else i += blockSize; // Raw / Compressed：负载即 Block_Size 字节
        if (i > buf.length) throw new Error('zstd: 块负载被截断');
      }
      if (checksumFlag) i += 4; // Content_Checksum（对解压内容的 xxh64 低 4 字节）
      frames.push(buf.subarray(start, i));
    } else if (magic >= 0x184D2A50 && magic <= 0x184D2A5F) {
      // Skippable frame：magic + 4 字节长度 + 负载
      if (i + 8 > buf.length) break;
      const size = buf.readUInt32LE(i + 4);
      i += 8 + size;
      if (i > buf.length) throw new Error('zstd: 可跳过帧被截断');
    } else {
      throw new Error('zstd: 非法的帧 magic @ offset ' + i);
    }
  }
  return frames;
}

/** 多帧解压：逐帧 node:zlib 解压后拼接 */
export function decompressMultiframeZstd(buf) {
  const frames = splitZstdFrames(buf);
  if (!frames.length) return Buffer.alloc(0);
  const parts = frames.map((f) => zstdDecompressSync(f));
  return Buffer.concat(parts);
}

/** 只解压第一帧（读会话头足够，避免全量解压大文件） */
export function decompressFirstFrame(buf) {
  const frames = splitZstdFrames(buf);
  if (!frames.length) return Buffer.alloc(0);
  return zstdDecompressSync(frames[0]);
}

/** 单帧压缩（重写会话文件时整文件压成一帧，仍是合法的多帧容器） */
export function zstdCompressSync(data) {
  return nodeZstdCompressSync(data);
}
