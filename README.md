# Spielberg · AI 漫剧工作室

基于 Tauri 构建的 AI 漫剧创作桌面应用。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Arco Design |
| 后端 | Rust + Tauri 2 |
| 数据库 | SQLite (rusqlite) |
| 构建 | Vite + tauri-cli |

## 快速开始

### 环境要求

- Node.js >= 18
- Rust >= 1.70
- 系统依赖：参考 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/)

### 安装依赖

```bash
npm install
```

### 开发

```bash
# 仅前端
npm run dev

# 桌面应用（含 Rust 后端）
npm run desktop:dev
```

### 构建

```bash
# 前端构建
npm run build

# 桌面应用构建
npm run desktop:build

# macOS DMG
npm run desktop:dmg

# 局域网服务器模式（服务器上首次运行需要 Rust 工具链）
npm run server

# 构建独立可执行文件（会把网页资源嵌入程序）
npm run server:build

# Apple Silicon/macOS 上交叉构建 Linux ARM64
npm run server:build:linux-arm64
```

服务器默认监听 `0.0.0.0:8080`，在同一局域网的浏览器打开 `http://服务器IP:8080`。数据目录默认使用系统本地数据目录下的 `Spielberg` 文件夹；可用 `SPIELBERG_DATA_DIR` 指定持久化位置，用 `SPIELBERG_BIND` 修改监听地址和端口（例如 `0.0.0.0:9000`）。请将该目录放在持久化磁盘上。服务器进程退出后，数据仍保留在该目录。

服务器模式需要 Node.js、Rust 工具链及 FFmpeg（缩略图和视频处理功能）。服务器会向局域网提供项目数据与素材访问；请只在可信网络中运行，并通过操作系统防火墙限制访问范围。`npm run server` 会先构建网页，再启动服务；更新代码后重新运行即可。

`npm run server:build` 会生成独立服务器程序，网页资源已嵌入程序，无需附带 `dist` 文件夹。macOS / Linux 的程序位于 `src-tauri/target/release/spielberg-studio`，Windows 为 `src-tauri/target/release/spielberg-studio.exe`。直接运行即可；可通过环境变量 `SPIELBERG_BIND` 配置监听地址端口，通过 `SPIELBERG_DATA_DIR` 配置数据目录。每种操作系统需在对应系统上分别构建。

Linux ARM64 可用 `npm run server:build:linux-arm64` 构建，产物为 `target-linux-arm64/release/spielberg-studio`。该命令需要可用的 Podman 或 Docker 和容器镜像仓库网络；可通过 `CONTAINER_ENGINE=docker` 切换到 Docker。

## 项目结构

```
Spielberg/
├── src/                # 前端源码 (React + TypeScript)
├── src-tauri/          # Tauri 后端 (Rust)
│   ├── src/            # Rust 源码
│   ├── Cargo.toml      # Rust 依赖配置
│   └── tauri.conf.json # Tauri 应用配置
├── public/             # 静态资源
├── scripts/            # 构建脚本
├── index.html          # 入口 HTML
├── vite.config.ts      # Vite 配置
└── package.json        # Node 依赖配置
```

## UI 回归检查

先启动 `npm run dev`，再运行：

```bash
STRICT_UI=1 node scripts/qa/ui-audit.cjs
```

需要可用的 Playwright 和 Chromium；若使用外部工具环境，可通过 `PLAYWRIGHT_PATH` 指向其 `playwright` 包目录。脚本在隔离的模拟 Tauri IPC 中验证五种窗口尺寸、长内容、主要页面和弹窗，并检查脚本发布、未保存保护、角色生成、接口保存、Prompt 复用及项目切换。不会读写真实项目或调用生成服务。截图与测量结果写入 `/tmp/spielberg-ui/`。

真实模型服务、系统文件对话框和原生视频解码仍需在桌面应用中验证。

## 名称与旧项目兼容

应用名称为 Spielberg，npm / Cargo 包名为 `spielberg-studio`，应用标识为 `com.spielberg.studio`，新数据库文件为 `spielberg.sqlite`。

首次启动新版会从旧应用目录导入项目列表，保留已有项目和素材的绝对路径。打开旧项目时，使用 SQLite 一致性快照生成新数据库，保留旧库作为备份；之后以新库为准。旧名称仅用于兼容识别，请勿与旧版本同时编辑同一项目，也不要删除旧应用目录中的原始素材。

## 资产管理与项目备份

- **资产追踪**：资产卡片显示用途数量，点击查看角色主图、角色图片、剧集封面、场景首尾帧、参考图及当前/候选视频，直接跳转到对应编辑位置。支持使用中、未使用和回收站筛选。
- **回收站**：移除资产先软删除，恢复保留原 ID；仍被引用的资产不能删除。永久删除才会释放原文件占用，共享文件只在没有其他资产记录使用时删除。
- **磁盘清理**：先扫描并展示未登记文件和缩略图缓存。未登记文件进入回收站，缓存可以重建；正在生成时暂不允许清理，避免误处理尚未入库的结果。
- **完整备份与恢复**：顶部「项目备份」生成单个 `.spielberg-backup` 压缩包，包含 SQLite 一致性快照、素材（含回收站与未登记文件）、剧本、角色、历史记录和模型配置。API Key 默认不导出，可自行勾选。复制压缩包到另一台电脑后，通过「从备份恢复」解压并创建独立项目；恢复会重建素材路径，不覆盖原项目。旧版 `.spielberg-backup` 文件夹仍可恢复。欢迎页也可直接恢复备份。
- **按需加载**：资产库由后端筛选和分页，每页 24 项；图片与视频缩略图仅在接近可视区时请求，缓存按源文件状态自动更新。缩略图依赖 FFmpeg；不可用时图片退回原图，视频提供点击预览入口。
- **增量刷新**：SQLite 触发器记录各数据部分的版本；项目轮询只返回变更部分，不再每 3 秒重读整个项目。窗口隐藏时暂停刷新，重新可见时检查更新。创作、资产和编辑页面按需加载。

备份和恢复仅操作选定的备份目录和新项目，不需要连接模型服务。缺少素材、备份路径不合法或数据库引用损坏时会报错，失败的临时目录会清理。

新增回归检查（同样使用隔离数据）：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
node scripts/qa/asset-management.cjs
node scripts/qa/asset-assignment.cjs
node scripts/qa/role-assets.cjs
```

可通过 `QA_URL` 指向生产预览地址，`PLAYWRIGHT_PATH` 指定已有 Playwright 安装。原生系统文件选择器的测试使用模拟 IPC，备份文件内容、恢复、引用保护和清理逻辑由 Rust 测试验证。

## License

Private
