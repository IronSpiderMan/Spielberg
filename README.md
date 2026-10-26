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

### GitHub Actions 构建安装包

工作流位于 [desktop-build.yml](.github/workflows/desktop-build.yml)，推送到 `main` / `master`、向这些分支提交 PR 或推送 `v*` 标签时自动构建，也可在 GitHub 仓库的 **Actions → Build desktop installers → Run workflow** 手动运行（工作流需先合入默认分支）。

运行完成后，在该次运行页面底部的 **Artifacts** 下载并解压：

| Artifact | 安装包 |
|---|---|
| `Spielberg-macOS-arm64` | Apple Silicon Mac 的 `.dmg` |
| `Spielberg-macOS-x64` | Intel Mac 的 `.dmg` |
| `Spielberg-Windows-x64` | Windows x64 的 NSIS `-setup.exe` 安装包 |

产物保留 30 天，标签构建也通过 Artifacts 下载，不自动发布 GitHub Release。工作流使用 GitHub 托管 runner，无需连接本地电脑或配置额外 Secrets。版本号沿用 `src-tauri/tauri.conf.json`，推送标签前请同步更新该文件、`package.json` 和 Cargo 包版本。

当前安装包未配置 Apple Developer ID 签名/公证或 Windows 代码签名，系统可能显示安全提示。FFmpeg / FFprobe 不包含在安装包中，缩略图和音视频处理需要在目标电脑安装并确保应用能通过 `PATH` 找到。

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
| 场景集合 | `/api/v1/projects/{project_id}/episodes/{episode_id}/scenes` |
| Prompt | `/api/v1/projects/{project_id}/prompts` |

集合支持 `GET`、`POST`；场景集合位于剧集下。场景仍可通过 `/api/v1/projects/{project_id}/scenes/{scene_id}` 按 ID 读取、更新和删除。PATCH 只更新提交的字段。项目删除移除注册信息并保留目录；资产删除移入回收站，仍被引用时返回冲突。文件支持二进制上传、下载和 Range 请求；生成、脚本、任务、备份等操作也通过版本化 HTTP 接口执行。

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

## 剧本管理

打开项目后，点击侧栏「剧本管理」，可新建、搜索、重命名和删除多份剧本。左侧编写 Markdown，右侧实时预览，支持标题、粗体、引用对白、列表和表格。可使用剧本模板和格式快捷按钮。点击「保存」或按 `Ctrl / ⌘ + S` 保存到当前项目数据库；「导出 Markdown」下载当前编辑内容为 `.md` 文件。切换页面、项目或剧本时会提醒未保存的修改。

分镜头剧本：点击「新建分镜头剧本」在表格中添加、编辑或删除镜头，也可「导入 CSV」。CSV 列固定为 `编号,景别,运镜,画面,描述`；编号不可为空或重复，描述必填，画面可留空，或从资产库、角色图片、本地文件选择图片；本地图片上传后成为项目资产，CSV 画面列记录图片路径，表格显示缩略图并支持点击放大预览及清除。景别枚举：大远景、远景、全景、中景、近景、特写、大特写。运镜枚举：固定、推近、拉远、横摇、俯仰、平移、跟随、升高、降低、环绕、手持、变焦。景别和运镜使用下拉选择，导入及保存时校验枚举值。支持带 BOM 的 UTF-8 CSV、带引号的逗号和多行内容；「导出 CSV」下载带 BOM 的 `.csv` 文件。

旧项目打开时会自动升级数据库，剧本随项目备份和恢复。浏览器流程验证使用隔离的临时项目：

```bash
PLAYWRIGHT_PATH=/path/to/playwright node scripts/qa-screenplays.cjs
```

可通过 `PLAYWRIGHT_EXECUTABLE_PATH` 指定已有 Chromium 可执行文件。

## Agent 助手

打开项目，在侧栏选择「Agent 助手」，即可用自然语言安排创作工作，例如「根据这段故事创建剧本、角色和第一集场景」或「搜索雨夜车站的摄影参考，再整理成 Prompt」。Agent 会读取当前项目、调用业务工具并继续处理结果，界面显示每一步的参数和执行结果。

- 默认复用「设置」中的 LLM（分镜与 Prompt）配置。也可以在 Agent 配置中填写独立的 Base URL、模型名称和 API Key。模型服务须支持 OpenAI Chat Completions 的函数工具调用。
- 支持当前项目的剧本、角色、Prompt、剧集、场景和资产增删改查，以及脚本发布、素材关联、画布、分镜规划、图片与视频生成、剪辑保存与导出、剧集合并、任务查询和项目备份等业务工具。生成和导出仍需对应服务或 FFmpeg 可用。
- 联网搜索默认无需 Key，使用 DuckDuckGo，并在不可用时尝试 Bing；也可以配置 Brave Search 或 Tavily。搜索结果包含来源链接，Agent 可以继续读取公开网页。每次发送前可关闭联网。搜索服务受网络连通性和上游限流影响。
- 会话、消息与执行记录保存在当前项目数据库，支持新建、切换和删除会话。后台执行不依赖页面持续打开；「停止」阻止后续工具步骤，已经开始的生成或导出可能继续完成。
- 工具限定在当前项目，沿用已有校验和素材引用保护。Agent 不提供任意 Shell 或文件系统访问；本机文件选择、姿态编辑等交互仍由界面完成。项目内容和检索内容会发送给所配置的模型服务；API Key 不进入模型上下文，普通备份默认移除模型和搜索 Key。

开发验证使用临时项目及本地模型夹具，不调用真实模型或产生生成费用：

```bash
npm run build
cargo build --manifest-path backend/Cargo.toml
npm run test:agent
```

## Skills 技能

在「设置 → Skills 技能」中，可从公开 GitHub 仓库的 Skill 目录、单个 `SKILL.md` 或本地 Skill 文件夹安装技能。GitHub 仓库根目录没有 `SKILL.md` 时，请填写具体子目录链接，例如 `https://github.com/owner/repo/tree/main/skills/storyboard`。文件夹安装保留 `references/`、`scripts/` 等辅助文件；只上传 `SKILL.md` 时不会包含这些文件。

技能说明采用 Markdown，文件开头须有 YAML 元数据：

```markdown
---
name: storyboard-guide
description: 将故事整理为角色、剧集和镜头表，适用于分镜规划任务。
---

先读取当前项目的剧本和角色，再按剧情顺序整理镜头。
更多约定见 references/guide.md。
```

已安装列表支持搜索、启用/停用、查看说明和辅助文件清单、卸载，以及从原 GitHub 来源更新。技能保存在工作室数据目录下的 `skills/`，所有项目共用，重启后保留；项目备份不包含这份全局技能库。每个技能最多 256 个文件、总计 10 MiB；`SKILL.md` 最多 32 KiB，其他单个文件最多 2 MiB。

Agent 每次运行会获得已启用技能的目录；任务匹配或消息中点名技能（如 `$storyboard-guide`）时，通过 `read_skill` 分页读取说明和引用的文本文件。已安装技能的读取不需要开启联网。技能可指导现有项目工具的操作流程，脚本文件可作为参考读取；应用未提供 Shell 或脚本执行能力，依赖这些能力的技能只能执行现有工具支持的部分。

验证：`npm run test:skills` 使用临时技能库、临时项目与本地模型夹具，覆盖安装、状态持久化和 Agent 技能读取；`PLAYWRIGHT_PATH=/path/to/playwright node scripts/qa/skills-ui.cjs` 验证设置界面。

## License

Private

## 简易音视频剪辑

在项目侧栏打开「音视频剪辑」，导入音视频或点击已有素材添加到主轨道。支持预览、播放头分割、入点/出点裁剪、前后排序、删除、撤销/重做、0.5–2 倍速、音量/静音和三种画布比例。时间线草稿按项目保存在当前浏览器的本地存储中，不随项目备份或跨设备同步。

点击「导出作品」生成 MP4（H.264/AAC）或 MP3，结果自动加入素材库，并可下载。服务端需要 FFmpeg 和 FFprobe；视频输出为 30fps、横屏 1280×720 / 竖屏 720×1280 / 方形 720×720。素材按比例补黑边，无声视频补静音，音频片段导出视频时使用黑底。主轨按顺序拼接，支持将视频声音分离为独立音轨，不含转场或字幕；单次最多 100 个片段、两小时成片。导出期间请保持页面打开。

验证：`cargo test --manifest-path backend/Cargo.toml editor::tests`（需 FFmpeg/FFprobe）。界面测试见 `scripts/qa-media-editor.cjs`，使用隔离数据及 `EDITOR_FIXTURE` 指定的四秒带音轨 MP4（默认 `/tmp/editor-fixture.mp4`），需本地前端服务及 Playwright。

时间线按实际时长显示，支持缩放。点击片段内任意位置定位播放头，再点击「在播放头分割」；片段右上角及工具栏均可删除片段。「分离音轨」会将原视频静音，在下方生成独立音轨，保留分离时的裁剪、速度、音量和时间位置。选中音轨后可独立拆分、裁剪、调整位置/音量/速度和删除，全部操作支持撤销/重做。主轨删除后自动衔接，独立音轨不跟随移动；音轨超出视频的部分导出为黑底画面。仅保留音轨时也可导出 MP3 或黑底 MP4。

## 画布场景

在剧集下点击「新建场景」，可选择默认方式或画布方式。每个画布场景独立保存，和普通场景一起排序、复制与删除。画布空白处右键可添加图片、音频、视频和便签节点；点击素材节点输出端口，再点击视频输入端口建立连接。视频节点将连接的素材作为全能参考，复用现有生成接口、任务记录与资产库，生成结果可设为场景视频参与剧集合并。

点击「保存画布」保存节点、连线、便签、生成参数和视角；画布随项目备份恢复，已保存的素材引用纳入删除保护。旧版项目画布会迁移为剧集下的「原项目画布」场景。详细用法、接口与验证见 [画布场景说明](docs/infinite-canvas.md)。
