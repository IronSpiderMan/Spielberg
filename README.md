# Spielberg · AI 漫剧工作室

React 前端 + 独立 Rust/Axum 后端 + Tauri 桌面壳。浏览器和桌面端的业务数据都通过 HTTP API 访问。

## 运行方式

需要 Node.js 18+、Rust 工具链；图片缩略图和视频处理需要 FFmpeg。打包桌面版另外需要对应系统的 Tauri 开发依赖。

```bash
npm install

# 同时启动独立后端（8080）和 Vite 前端（1420）
npm run dev

# Tauri 桌面开发：启动 Vite，桌面壳自动启动 127.0.0.1:8080 后端
npm run desktop:dev

# 构建前端并运行后端；直接打开 http://127.0.0.1:8080
npm run server

# 构建含前端页面的独立后端程序
npm run server:build

# 打包桌面应用 / macOS DMG
npm run desktop:build
npm run desktop:dmg
```

服务器只需运行一个 `spielberg-backend` 进程，它同时提供 `/api/v1` 接口、素材和前端页面。页面在构建时嵌入后端程序，无需额外启动 Vite、Node.js 或附带 `dist/`。构建产物为 `backend/target/release/spielberg-backend`（Windows 加 `.exe`）。服务器端不依赖 Tauri、GTK 或 WebKit；`npm run server:build:linux-arm64` 可使用 Podman/Docker 构建 Linux ARM64 程序。

桌面壳复用同一个后端库，绑定固定地址 `0.0.0.0:8080`，允许局域网设备连接；桌面界面本身仍通过 `127.0.0.1:8080` 调用 API。生产桌面端加载相同的前端构建，使用固定 Tauri 页面源保留主题等浏览器设置；开发时页面由 Vite 提供，API 地址由壳注入。窗口退出时本地服务随应用停止。后端没有用户认证，监听 `0.0.0.0` 会向本机网络开放 API 和素材，请只在可信网络中运行。

### 独立开发和部署

```bash
npm run backend:dev    # 仅后端
npm run frontend:dev   # 仅前端，/api 和 /media 默认代理到 8080

# 也可以独立部署前端，在构建时指定 API 源地址
VITE_API_BASE_URL=https://api.example.com npm run build
```

| 设置 | 含义 |
|---|---|
| `SPIELBERG_BIND` | 后端监听地址，默认 `127.0.0.1:8080`；局域网部署可设置 `0.0.0.0:8080` |
| `SPIELBERG_DATA_DIR` | 数据目录；服务器默认系统本地数据目录下的 `Spielberg`，桌面默认原 Tauri 应用数据目录 |
| `SPIELBERG_ALLOWED_ORIGINS` | 允许的跨域前端来源，逗号分隔；默认允许本地 Vite 的 1420 端口和 Tauri 页面源 |
| `VITE_API_BASE_URL` | 独立前端的后端源地址；同源托管和本地代理无需设置 |

后端设置通过进程环境变量传入；Vite 设置可写入 `.env.local`，示例见 `.env.example`。数据目录应放在持久化磁盘上。项目路径和旧数据库迁移逻辑继续保留；服务未提供多用户鉴权，局域网部署应使用可信网络，需要对外开放时在反向代理处提供认证和 HTTPS。

## API 与分层

六类资源的 REST CRUD 路径：

| 资源 | 集合路径 |
|---|---|
| 项目 | `/api/v1/projects` |
| 角色 | `/api/v1/projects/{project_id}/roles` |
| 资产 | `/api/v1/projects/{project_id}/assets` |
| 剧集 | `/api/v1/projects/{project_id}/episodes` |
| 场景 | `/api/v1/projects/{project_id}/scenes` |
| Prompt | `/api/v1/projects/{project_id}/prompts` |

集合支持 `GET`、`POST`；追加 `/{id}` 后支持 `GET`、`PATCH`、`DELETE`。PATCH 只更新提交的字段。项目删除移除注册信息并保留目录；资产删除移入回收站，仍被引用时返回冲突。文件支持二进制上传、下载和 Range 请求；生成、脚本、任务、备份等操作也通过版本化 HTTP 接口执行。

完整请求字段、示例、状态码和文件接口见 [API 文档](docs/api.md)。原 `/api` RPC 包装入口和业务 Tauri IPC 已移除。

```text
src/                 React 界面、API 客户端、文件对话框适配
  transport.ts       HTTP 地址配置、请求与下载
  api.ts             UI 业务调用到 REST/动作接口的映射
backend/             独立 Rust 后端（可单独构建和运行）
  src/lib.rs         现有业务服务
  src/rest.rs        CRUD、校验、部分更新
  src/http.rs        HTTP、上传下载、静态页面、服务生命周期
  src/storage.rs     SQLite 和历史数据兼容
src-tauri/           Tauri 桌面壳、窗口与打包配置
scripts/             开发启动器、打包脚本、隔离回归检查
```

## UI 回归检查

真实 HTTP 检查会使用临时目录和随机回环端口，不读取真实项目：

```bash
npm run build
cargo build --manifest-path backend/Cargo.toml
npm run test:api
PLAYWRIGHT_PATH=/path/to/playwright node scripts/qa/http-ui.cjs
```

界面夹具检查先启动 `npm run frontend:dev`，再运行：

```bash
STRICT_UI=1 node scripts/qa/ui-audit.cjs
```

需要可用的 Playwright 和 Chromium；若使用外部工具环境，可通过 `PLAYWRIGHT_PATH` 指向其 `playwright` 包目录。脚本在隔离的 HTTP 数据夹具中验证五种窗口尺寸、长内容、主要页面和弹窗，并检查脚本发布、未保存保护、角色生成、接口保存、Prompt 复用及项目切换。不会读写真实项目或调用生成服务。截图与测量结果写入 `/tmp/spielberg-ui/`。

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

新增回归检查（使用隔离数据）：

```bash
cargo test --manifest-path backend/Cargo.toml --lib
node scripts/qa/asset-management.cjs
node scripts/qa/asset-assignment.cjs
node scripts/qa/role-assets.cjs
```

可通过 `QA_URL` 指向生产预览地址，`PLAYWRIGHT_PATH` 指定已有 Playwright 安装。原生系统文件选择器使用模拟系统对话框，备份文件内容、恢复、引用保护和清理逻辑由 Rust 测试验证。

## License

Private
