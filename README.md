# dsh-session-ws-manager

DSH（DeepSeek Harness）会话工作区管理插件。

## 功能

- **查看面板**：左侧导航栏「会话管理」入口；工作区/会话列表（真实标题、成果数）；成果/过程文件分类（导出、AI 答复交付、目录扫描）；文件定位与打开；对话中的代码查看；主题三档（适应DSH/浅色/暗色）。
- **安全删除**：会话行「删除」按钮 → 预览弹窗（成果默认勾选、过程文件默认不勾、图片按文件夹聚合、一键全选/分组开关）→ 三种模式（插件回收站 / 系统回收站 / 彻底删除）；批量删除；执行前自动备份 `workspace.json`；1 分钟内有写入的会话拒绝删除。
- **插件回收站**：已删除会话可恢复到原工作区（或指定工作区），自动修正 cwd；保留天数可配置，到期自动清理；支持批量彻底删除。
- **数据体检**：检测注册表悬空引用（置顶/归档/工作区绑定）、孤儿 projcache、失效的默认工作区、备份堆积，支持一键修复（修改前自动备份）。

> 历史版本曾提供跨工作区转移功能，现已按需求移除。

## 数据布局（插件依赖的 DSH 存储结构）

```
~/.dsh/storages/workspace.json                        工作区注册表（sessionIds 绑定关系）
~/.dsh/sessions/<工作区路径编码>/session-<uuid>/       会话正文 session.v4.jsonl.zstd（多帧 zstd JSONL）
~/.dsh/storages/session_projcache/sessions/<id>.json  每会话缓存（identity.cwd 等）
~/.dsh/session-trash/                                 插件回收站（删除的会话暂存于此，含 meta.json）
```

## 安装（开发版，手动挂载）

零依赖插件，直接拷贝即可：

```bash
cp -r dsh-session-ws-manager ~/.dsh/profiles/desktop/node_modules/
```

然后在 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 数组末尾加入 `"dsh-session-ws-manager"`（建议先备份该文件），重启 DSH 桌面端。

打开面板：`http://127.0.0.1:<web端口>/swm`（也可在 DSH 网页版内直接访问相对路径 `/swm`，或点侧栏「会话管理」入口）。

## 卸载

从 `dsh.profile.bundles` 移除该条目，删除 `~/.dsh/profiles/desktop/node_modules/dsh-session-ws-manager/`，重启 DSH。

## 技术要点

- 会话正文是**多帧拼接的 zstd**（每次追加重新压缩一帧），`node:zlib` 的一次性解压只认单帧；本插件按 RFC 8878 自行解析帧边界（magic + FHD + 块跳过 + 校验和）后逐帧解压。
- 文件归属以会话正文中 `tool/call` 事件的 `write` / `edit` 调用为准（`data.arguments` 为 JSON 字符串，含 `file_path`）；`pwsh` 等命令的文件改动不可靠解析，不纳入统计。
- 恢复会话时按官方 `projectKey()` 规则（分隔符折叠、`~XXXX` 转义、`--` 包裹）定位目标编码目录。
- 鉴权与官方插件一致：优先 `ctx.connection.requestRejection`，退化时仅允许本机回环访问。
- 删除会话时无论走官方 `detachSession` 服务还是 JSON 回退，都会统一清理注册表中 `pinnedSessionIds` / `archivedSessionIds` 的悬空引用。
