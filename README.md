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

# Windows：构建桌面 EXE 和 NSIS 安装包
npm run desktop:exe
```

macOS 的 `npm run desktop:dmg` 无窗口生成并校验 DMG，成功后直接安装到 `/Applications/Spielberg.app`，无需拖拽。更新前请先退出 Spielberg。使用 `INSTALL_APP=0 npm run desktop:dmg` 可只生成安装包；`INSTALL_DIR="$HOME/Applications" npm run desktop:dmg` 可安装到个人应用目录；CI 环境默认只生成安装包。

Windows 构建需要 Node.js、Rust MSVC 工具链及 Visual Studio C++ Build Tools；首次运行脚本会自动安装前端依赖。默认输出为 `src-tauri/target/x86_64-pc-windows-msvc/release/spielberg-studio.exe` 和其下 `bundle/nsis/*-setup.exe`，脚本结束会打印实际路径。可通过 `npm run desktop:exe -- -Target aarch64-pc-windows-msvc` 指定目标架构（需先安装对应 Rust target 和编译工具）。

发布版桌面 EXE 使用 Windows GUI 子系统，启动时不弹出控制台；FFmpeg/FFprobe 子进程也隐藏控制台。开发模式和独立服务器仍保留终端日志。

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

### 全局语音 Agent

所有页面右下角都有可拖动的 Agent 悬浮球，默认点击展开或收起对话，点击面板内的麦克风开始中文听写。识别完成后先校对文字，再点击发送；在「设置 → Agent 悬浮按钮」可将点击行为改为「开始语音」，并开启「语音识别后自动发送」，恢复一键说话、说完自动执行的方式。按 Esc 或收起面板会取消本次听写，已开始的 Agent 任务可通过停止按钮结束。

浮标拖动后自动贴边，聚焦浮标后可用方向键调整位置，也可在设置中重置到右下角。面板会自适应可用空间，避免遮挡浮标；支持 Markdown 回复、Enter 发送、Shift+Enter 换行、查看执行结果和打开完整对话。位置保存在本机，对话与文字草稿按项目保存；使用已配置的 Agent / 默认 LLM 模型，执行后的项目内容会自动刷新。

在「设置 → Agent 悬浮按钮 → 语音服务」中分别配置 ASR 识别与 TTS 朗读，选择系统能力或项目渠道，并为项目渠道指定模型。渠道需先在「语音识别」/「语音合成」分类配置并保存；未指定模型时沿用项目默认配置，已指定的渠道或模型被删除后会明确提示重新选择。TTS 默认使用项目渠道，音色 ID 留空使用模型默认音色；支持语速的模型及系统朗读可调整语速，系统朗读使用默认中文音色。切换 TTS 模型会重置音色和语速。点击「试听声音」可直接检查当前配置；切换设置分类或开始录音会停止试听。外观与点击习惯集中在「浮标与交互」，分组导航固定显示。

本机网络中的 Kokoro 服务示例：Base URL 为 `http://zack-4090:8880/v1`，模型 ID 为 `kokoro`，音色 ID 为 `zm_yunxi`。音色 ID 不应填入模型 ID。HTTP 服务误填为 HTTPS 可能出现 `record overflow`、`wrong version number` 等连接错误，应核对服务实际协议后修正 Base URL。

Agent 回复完成后默认自动朗读，也可关闭「自动朗读 Agent 回复」并在浮标中手动播放。识别方式、识别与朗读模型、音色、语速和自动朗读偏好按项目保存在本机，并在浮标与设置页之间同步；原浮标的识别方式会自动迁移。外观、点击行为和语音自动发送仍为本机通用偏好。

macOS 10.15+ 桌面版使用系统 Speech 与麦克风能力，首次使用需允许麦克风和语音识别权限；可在系统设置的「隐私与安全性」中调整。设备支持时优先本地识别，否则系统可能使用 Apple 在线服务。浏览器及其他桌面平台尝试内置 Web Speech，需要 HTTPS 或 localhost；不支持或未授权时仍可输入文字。无须配置单独的语音 API。原生权限声明和桥接随桌面构建打包，更新此功能需重新构建桌面应用。

浮动助手集成测试：`node scripts/qa/agent-float.cjs`（需先 `npm run build`、构建独立后端并安装 Playwright）。测试使用独立临时项目和本地模型、模拟语音事件，不请求真实模型；真实麦克风识别需在桌面端授权后验证。

### 生成渠道与模型

「工作室设置」可分别管理多个图片、视频和 TTS 渠道。每个渠道有独立名称、接口地址、API Key、模型列表和默认模型；也可设置默认渠道。旧项目的单组配置会兼容转换为「原图片渠道」「原视频渠道」，保留原地址、Key 和不同生成方式的旧接口。

- 统一渠道配置：LLM 支持 OpenAI、DeepSeek 和 Qwen Token Plan，可添加多个渠道及预设/自定义模型，分别设置默认渠道与默认模型。分镜生成、Prompt 优化及沿用项目配置的 Agent 共用默认选择；旧版 LLM 地址、密钥和模型自动兼容为「原 LLM 渠道」。切换渠道类型会重置该渠道的地址、密钥和模型，保存后生效。
- LLM 接口使用 [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)；[DeepSeek](https://api-docs.deepseek.com/) 默认地址为 `https://api.deepseek.com`；[Qwen Token Plan](https://platform.qianwenai.com/docs/token-plan/overview) 使用专属 Key 和 `https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1`。可修改地址接入兼容代理；模型的视觉输入和工具调用能力以实际服务为准。DeepSeek 渠道的 Agent 使用普通模式，以兼容连续工具调用。
- 图片渠道：OpenAI 兼容图片接口、千问 Token Plan；已有 CAST 图片配置继续兼容。OpenAI 可添加自定义模型 ID 与名称；千问预设包含 `qwen-image-3.0-pro`、`wan2.7-image` 和 `wan2.7-image-pro`。
- 视频渠道：RunningHub / ComfyUI 兼容接口、千问 Token Plan。千问预设包含 `wan3.0-video`、`happyhorse-1.1-t2v`、`happyhorse-1.1-i2v` 和 `happyhorse-1.1-r2v`，每个 ID 是独立可选模型。
- TTS 渠道：OpenAI 兼容语音接口、QwenTokenPlan（千问 Token Plan）。OpenAI 预设 `gpt-4o-mini-tts`、`tts-1`、`tts-1-hd`，支持自定义模型；千问预设 `qwen-audio-3.0-tts-plus`。在工作台「语音合成」输入文本，选择渠道、模型、音色 ID 和 MP3/WAV 格式；OpenAI 可设置语速，GPT-4o mini TTS 可设置风格指令。生成音频自动保存到素材库，可试听、用于资产音频参考和剪辑，任务及失败原因显示在后台任务中。默认音色分别为 `alloy`、`longanhuan_v3.6`，千问固定使用 24000 Hz。当前单次文本上限为 4096 字符。

TTS 请求格式见 [OpenAI Speech API](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)、[千问 Token Plan 多模态文档](https://platform.qianwenai.com/docs/token-plan/best-practices/multimodal-generation)和[千问语音合成 HTTP API](https://platform.qianwenai.com/docs/api-reference/speech-synthesis/qwen-audio-tts/http-api)。千问非流式返回 JSON 中的 `output.audio.url`，后端下载音频后保存到素材库。OpenAI 官方已公告上述 Speech API 模型将于 2027-01-06 停用；兼容渠道的模型可用性以服务商为准。

在工作台、图片生成弹窗、资产图生成、场景生成和画布中选择渠道、模型，再设置生成参数。场景和画布节点会保存选择，批量生成使用各场景已保存的选择。分镜补图也可选择图片渠道、模型。未明确指定时使用默认渠道及支持当前生成方式的默认模型；指定的模型或渠道被删除时会提示重新选择，不会悄悄改用其他渠道。

| 模型能力 | 生成参数 |
|---|---|
| OpenAI 图片接口 | 文生图、参考图编辑、蒙版；尺寸映射为 1024×1024、1536×1024、1024×1536 |
| Qwen Image 3.0 Pro | 文生图、最多 3 张参考图；像素面积 512²–2048²，不传 PNG 蒙版 |
| Wan 2.7 Image / Pro | 文生图、最多 9 张参考图；普通版最高 2K，Pro 文生图最高 4K，图生图最高 2K；不传 PNG 蒙版 |
| RunningHub / ComfyUI | 沿用现有文生视频、首尾帧和全能参考；像素尺寸与 3–15 秒时长 |
| Wan 3.0 | 文生视频、首尾帧、全能参考；2–30 秒或智能时长；480P/720P/1080P；可开关声音 |
| HappyHorse T2V | 仅文生视频；3–15 秒、480P/720P/1080P |
| HappyHorse I2V | 仅单张首帧；无尾帧，画幅跟随首帧；3–15 秒、480P/720P/1080P |
| HappyHorse R2V | 仅图片参考，最多 9 张；无音视频参考；3–15 秒、480P/720P/1080P |

模型能力由前后端共用的 `src/generation-models.json` 定义，界面按能力显示参数，后端再次校验。图片批量数量仍通过多次单图请求实现。参考素材顺序保留，可使用 `[Image 1]`、`[Image 2]` 引用对应图片。

千问 Token Plan 使用[个人版 API Keys 页面](https://platform.qianwenai.com/home/api-keys?target=individual)创建的 `sk-sp-` 专属 Key。默认地址为 `https://token-plan.maas.qianwenaiapi.com`，也可粘贴控制台 `/compatible-mode/v1` 地址；必须使用配套 Key 和地址。参考图通过 Base64 data URL 提交，SVG 会转换为 PNG，无需公开本地素材或调用独立上传接口。Wan 3.0 参考视频支持 MP4/MOV（单段不超过 100 MB）、音频支持 MP3/WAV（单段不超过 15 MB），视频和音频各自总时长不超过 15 秒，输入视频与输出视频总时长不超过 30 秒；时长、帧率和尺寸由远程服务进一步校验。

RunningHub 类固定模型服务不接收 `model` 字段时保持「接口接收 model 参数」关闭；不同模型使用不同服务时，在模型下填写独立服务地址。支持按 `model` 分发的兼容服务可开启该开关。视频提交、轮询、下载入库自动完成；后台任务保存实际渠道、模型和远程任务编号，重启后恢复查询，避免重复提交。

接口依据[千问多模态接入文档](https://platform.qianwenai.com/docs/token-plan/best-practices/multimodal-generation)、[图片生成文档](https://platform.qianwenai.com/docs/developer-guides/image-generation/text-to-image)和[Wan 3.0 文档](https://platform.qianwenai.com/docs/api-reference/video-generation/wan30-video/create-task)实现。

## API 与分层

七类资源的 REST CRUD 路径：

| 资源 | 集合路径 |
|---|---|
| 项目 | `/api/v1/projects` |
| 创作资产 | `/api/v1/projects/{project_id}/assets` |
| 素材 | `/api/v1/projects/{project_id}/media` |
| 剧集 | `/api/v1/projects/{project_id}/episodes` |
| 场景集合 | `/api/v1/projects/{project_id}/episodes/{episode_id}/scenes` |
| 剧本 / 分镜头剧本 | `/api/v1/projects/{project_id}/episodes/{episode_id}/screenplays` |
| Prompt | `/api/v1/projects/{project_id}/prompts` |

集合支持 `GET`、`POST`；场景集合位于剧集下。场景仍可通过 `/api/v1/projects/{project_id}/scenes/{scene_id}` 按 ID 读取、更新和删除。PATCH 只更新提交的字段。项目删除移除注册信息并保留目录；素材删除移入回收站，仍被引用时返回冲突。文件支持二进制上传、下载和 Range 请求；生成、脚本、任务、备份等操作也通过版本化 HTTP 接口执行。

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

UI 细节回归：`PLAYWRIGHT_PATH=/path/to/playwright node scripts/qa/ui-details.cjs`。使用隔离数据检查 8 个页面在 5 种窗口尺寸、明暗主题下的布局，以及手机导航焦点、Prompt 搜索、取消草稿和保存失败重试。截图与报告输出到 `/tmp/spielberg-ui-details/`。

参考图标注回归：`PLAYWRIGHT_PATH=/path/to/playwright node scripts/qa/reference-annotation.cjs`。使用隔离图片和接口检查形状填充、文字输入、撤销重做、深浅主题及窄窗口布局，并验证 PNG 原分辨率导出和上传失败重试。

### 参考图标注

在场景编辑器的参考图上点击铅笔图标，可使用画笔、矩形、圆形 / 椭圆和文字工具（快捷键 B / R / O / T）。矩形和圆形支持空心或填充；按住 Shift 拖动可绘制正方形或正圆。可设置颜色、线宽、字号和不透明度，设置只影响之后添加的标注。

选择文字工具后点击图片输入文字，Enter 完成，Shift + Enter 换行，Esc 取消当前文字。撤销 / 重做支持 Ctrl / ⌘ Z 和 Ctrl / ⌘ Shift Z，清空操作也可撤销。点击「用作参考图」会按原图尺寸导出 PNG 并替换当前参考图，原图仍保留在素材库，保存场景后生效。

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

## 工作室设置

设置页按文本与推理、图片生成、视频生成、语音合成、Skills 技能和项目存储分类。服务渠道使用左侧列表与右侧编辑区，可按渠道名称、接口地址或模型搜索；模型以简洁列表展示，点击后展开编辑。渠道和模型较多时分别滚动，分类与保存入口始终可见。

服务配置保存在当前项目中，切换分类或渠道会保留草稿，统一点击「保存配置」保存；分类旁的小圆点提示未保存修改。Skills 和项目存储由工作室共享，技能操作立即生效，存储路径单独保存。小窗口下渠道列表横向排列，分类支持方向键、Home / End 切换。

布局回归使用隔离接口数据：`PLAYWRIGHT_PATH=/path/to/playwright node scripts/qa/settings-layout.cjs`，覆盖 24 个渠道、每渠道 16 个模型、保存失败重试、草稿保留、五种窗口尺寸和深色模式。

## 项目配置

进入项目后，在侧栏选择「项目配置」，可修改项目名称、编写项目故事大纲，并管理世界观、人物关系、创作笔记等项目文档。文档支持直接新建、编辑、删除、导入 Markdown / TXT（单份不超过 2 MB）和导出 Markdown；修改后统一点击「保存配置」。未保存时离开页面会提醒。大纲与文档保存在各自项目的数据库中，随项目备份和恢复保留。

Agent 可通过 `app_action` 的 `project/config/read`、`project/config/update` 读取或修改项目名称和大纲，通过 `project/document/read`、`project/document/save`、`project/document/delete` 读取、新建、修改或删除项目文档。创作前先读取大纲、文档目录及相关文档；长文本按 Unicode 字符分页，沿 `next_offset` 读取全文。文档按 ID 单独更新，保留其他文档；仅在用户要求时修改项目配置。可直接对 Agent 说「根据项目大纲完善第一集」或「新建一份人物关系文档」。

## 剧本与分镜

进入「剧集 → 编辑」，每集固定一份剧本和一份分镜头剧本。打开即编辑，无需新建或导入；剧本标题沿用剧集名称。Markdown 编辑器支持实时预览、模板和格式按钮，输入 `@` 即可搜索引用角色、场景、素材或 Prompt；用方向键选择、回车或 Tab 插入，Esc 关闭提示，可导出 Markdown。分镜表支持添加和删除镜头、选择景别及运镜、从资产或角色选择画面、上传图片并导出 CSV。

页面顶部只有一个「保存」入口，同时保存剧本、分镜头剧本、剧集信息和 AI 分镜规划。切换三个标签保留全部草稿；离开页面或项目时提醒未保存修改。

「分镜头剧本 → AI 分镜与场景制作」直接使用本集剧本，支持分镜生成、参考图补全、Prompt 和场景写入。「转为分镜表」写入本集唯一的分镜表；已有镜头时先确认替换。时长、声音和原始镜头说明保留在描述中。

旧项目自动升级：原剧集正文保留为本集 Markdown 剧本；独立管理中的内容迁入「原项目剧本」剧集。如果同一集已有同类型的多份内容，最新一份保留在原集，其余完整保留到「原集名称 · 旧稿 N」剧集，保留原 ID、标题、内容和时间，避免覆盖。数据库约束和 API 同时保证每集每种格式最多一份。剧本、分镜随项目备份恢复，删除剧集会级联删除这些内容和场景。

隔离数据回归：

```bash
PLAYWRIGHT_PATH=/path/to/playwright node scripts/qa-screenplays.cjs
PLAYWRIGHT_PATH=/path/to/playwright node scripts/qa-screenplay-layout.cjs
```

## Agent 助手

打开项目，在侧栏选择「Agent 助手」，即可用自然语言安排创作工作，例如「根据这段故事创建剧本、角色和第一集场景」或「搜索雨夜车站的摄影参考，再整理成 Prompt」。Agent 会读取当前项目、调用业务工具并继续处理结果，界面显示每一步的参数和执行结果。

- 渠道、模型和 API Key 在「工作室设置 → 统一渠道配置」中管理，使用时可在输入框右下角选择渠道与模型。Agent 设置仅包含搜索服务、模型请求等待时间和最多执行步数；旧版已保存的独立配置仍可使用。模型服务须支持 OpenAI Chat Completions 的函数工具调用。
- 支持当前项目的剧本、六类创作资产、图片/视频/音频素材、Prompt、剧集和场景增删改查，以及资产类别和启用状态管理、按类别/启用状态/名称查询、资产图片及命名音频参考关联、脚本发布、画布、分镜规划、图片与视频生成、TTS 语音合成、剪辑保存与导出、剧集合并、任务查询和项目备份等业务工具。生成和导出仍需对应服务或 FFmpeg 可用。
- 长剧本、Prompt、资产与剧集描述、场景描述和提示词支持正文分页读取。Agent 可通过 `resource/text/read` 逐页取得全文；修改前读完相关正文，保留未要求修改的部分，避免把截断的查询结果当作全文。
- 配置 TTS 渠道后，可以直接说「把这段台词生成配音」。Agent 使用 `generations/tts`，沿用默认渠道或按要求选择渠道、模型、音色及 MP3/WAV 格式；支持模型允许的语速、风格指令，单次正文最多 4096 字符。音频自动保存到素材库，并在聊天中显示试听播放器。
- 图片、TTS 音频和视频生成成功后，对话自动显示预览：图片可点击放大，音频可直接试听，视频支持播放与放大预览。素材查询、任务查询、剪辑导出等其他工具操作不附带预览，普通媒体链接保持为链接。失败或仍在运行的生成结果不显示预览，媒体加载失败时可打开原文件。
- 支持直接生成 SVG：例如「画一个 SVG 标志并保存到素材库」。Agent 会编写 SVG 源码并调用 `media/create-svg`，无需配置图片生成服务；结果直接显示在对话中，可预览、下载及关联资产。图片素材支持 JPG/JPEG、PNG、WebP、GIF、SVG；SVG 保留矢量原文件，用于模型参考时自动转为 PNG。支持自包含的静态 SVG（形状、文字、渐变、内部引用及内嵌位图），不接受脚本、事件、动画、嵌入网页和外部资源；单个 SVG 最大 5 MB，单边不超过 8192 像素且总面积不超过 16,777,216 像素。
- 联网搜索默认无需 Key，使用 DuckDuckGo，并在不可用时尝试 Bing；也可以配置 Brave Search 或 Tavily。搜索结果包含来源链接，Agent 可以继续读取公开网页。每次发送前可关闭联网。搜索服务受网络连通性和上游限流影响。
- 会话、消息与执行记录保存在当前项目数据库，支持新建、切换和删除会话。复杂任务可显示分步计划，保留待办和执行进度；重启后发送“继续”时，Agent 会结合原记录和当前项目状态接着处理。计划是工作记录，完成标记仍需真实工具结果支持。 首次发送失败时保留已创建的会话与文字、图片草稿，重试沿用同一会话。
- 回复支持流式显示，生成中的文字逐步保存到同一条消息；取消、断流或重启后保留已保存的部分回复并标为“回复已中断”。工具参数必须完整接收且响应正常结束后才执行，断流不会执行半截工具调用。仍兼容返回完整 JSON 的模型渠道。
- 后台执行不依赖页面持续打开；「停止」会中断等待中的模型请求和自动重试，并阻止后续工具步骤。已经开始的业务工具（如生成或导出）可能继续完成，实际结果仍会保留。此时界面保持“正在停止”并持续刷新，后台退出后才允许再次发送或删除会话；加载失败可直接重试。
- 界面显示正在思考、执行工具、重试或整理结果，以及本轮已用步数。达到步数上限后，Agent 会进入只汇报结果的阶段，多出的工具调用明确标记“未执行”，会话显示“已暂停，可继续”。相同参数的工具失败三次会暂停，避免反复消耗步数。模型临时连接故障或限流、部分 5xx 错误最多自动重试两次；重试仅针对模型请求，不会重放已经完成的业务工具。
- 连续对话保留近期原文，并将较早的要求、回复及工具执行结果整理为有限摘录；需要细节时，Agent 可检索当前会话的原始记录并分页回读。图片与文字使用独立的上下文预算，避免一张参考图挤掉此前要求。单次长任务也会按完整工具调用与结果压缩较早记录，保留本次用户原文、近期调用及写入结果线索；工具协议配对保持完整。历史搜索默认定位到命中段落，并可按原消息索引分页回读。界面提示压缩情况，完整记录仍保存在项目中，重启后可继续使用。
- 工具限定在当前项目，沿用已有校验和素材引用保护。Agent 不提供任意 Shell 或文件系统访问；本机文件选择、姿态编辑等交互仍由界面完成。项目内容和检索内容会发送给所配置的模型服务；API Key 不进入模型上下文，普通备份默认移除模型和搜索 Key。

开发验证使用临时项目及本地模型夹具，不调用真实模型或产生生成费用：

```bash
npm run build
cargo build --manifest-path backend/Cargo.toml
npm run test:agent
npm run test:skills
PLAYWRIGHT_PATH=/path/to/playwright node scripts/qa/agent-ui.cjs
```

实现分为执行循环（`backend/src/agent.rs`）、模型传输（`agent_model.rs`）、运行状态与计划（`agent_execution.rs`）、上下文投影/历史检索和项目业务工具。参考 [Codex App Server 的 turn、计划与中断设计](https://learn.chatgpt.com/docs/app-server)，在现有 OpenAI 兼容模型接口上实现独立运行状态，保留 Spielberg 自身的业务工具和项目权限边界。

## Skills 技能

系统默认提供并启用「短剧分镜与关键帧」技能（`short-drama-storyboard`），用于把现有剧本和视觉设定整理成有叙事职责、合理时长、人物站位与动作连续性的分镜，以及首尾关键帧提示词。它改编自 [zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills/tree/main/skills/short-drama-storyboard)，通过 Spielberg 的项目工具读取剧本、资产和素材，并在用户要求保存时写入本集分镜表；不依赖本地脚本，也不会仅因规划分镜就启动图片或视频生成。来源版本和 MIT 许可证随技能附带。

默认技能随应用打包，新工作室和已有工作室都可离线读取。在「设置 → Skills 技能」中标记为「系统内置」，可查看或停用，停用状态在重启后保留；内容随应用版本更新，不提供卸载、GitHub 更新或文件重装。已有的同名自装技能优先保留，不会被内置版本覆盖；卸载该自装技能后，内置版本以停用状态显示。可直接对 Agent 说「用 $short-drama-storyboard 给第一集做分镜并保存」。

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

已安装列表支持搜索、启用/停用、查看说明和辅助文件清单；自装技能还支持卸载，以及从原 GitHub 来源更新。自装技能和内置技能的启用偏好保存在工作室数据目录下的 `skills/`，所有项目共用，重启后保留；项目备份不包含这份全局技能库。每个技能最多 256 个文件、总计 10 MiB；`SKILL.md` 最多 32 KiB，其他单个文件最多 2 MiB。

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

### 资产库与素材库

资产库管理人物、地点、物品、生物、载具、其他六类创作资产，可设置类别、按类别筛选，并关联参考图片及音频。已有角色自动归为人物，原有名称、图片、音频、启用状态和 `@名称` / `@名称.图片名` 引用保留。禁用资产默认隐藏，勾选“显示已禁用资产”可查看并重新启用。

在资产列表上方输入名称或描述即可即时搜索，忽略英文大小写及搜索词首尾空格；搜索可与类别、启用状态筛选组合使用。清空搜索会保留当前筛选条件。

素材库管理图片、视频、音频等基础文件，供资产、场景与剪辑使用。两者沿用原有存储和 API 路径。

在「资产库」点击「关系图」，可以在同一张图上查看人物、地点、物品等资产。通过节点连接点选择两个资产，填写关系名称（如「兄妹」「老家」）、方向和说明；点击关系可修改或删除。节点支持拖动，画布支持平移和缩放，布局保存在当前项目中并随备份恢复。

数据库版本 16 将创作资产表 `roles` 自动重命名为 `assets`，保留原资产 ID、类别、启用状态、主图及图片/音频关联。新增 `asset_relations` 保存资产之间的关系，`asset_graph` 保存节点位置和布局修订号。现有图片、音频关联表及 API 路径继续兼容；关系可通过项目 Agent 的 `app_request` 使用 `resource=asset-relations` 查询和维护。

关系图验证（使用临时项目与真实 HTTP 接口）：`node scripts/qa/asset-relations.cjs`，可通过 `PLAYWRIGHT_PATH` 指定 Playwright 安装路径。

### ASR 语音识别

在项目设置的「语音识别」中配置 OpenAI 或 Qwen Token Plan 渠道与默认模型，然后在工作台「语音识别」选择素材库音频进行转写。结果可编辑、下载为 TXT，任务记录保留转写结果；Agent 也可通过 `generations/asr` 调用，参数为 `media_id`，可选 `channel_id`、`model`、`language`。

- OpenAI：预置 `gpt-4o-mini-transcribe`、`gpt-4o-transcribe`、`whisper-1`，使用 `/v1/audio/transcriptions` 文件上传接口，支持自定义兼容模型与地址。
- Qwen Token Plan：`qwen-audio-3.0-asr-flash`，使用 DashScope 接口与 `sk-sp-` 专属 Key，单次音频不超过 5 分钟。
- 本地限制：音频最大 25 MB；支持 mp3、wav、m4a、mp4、mpeg、mpga、webm、ogg、flac。文件需先导入项目素材库。

协议参考：[OpenAI 文件转写](https://developers.openai.com/api/docs/guides/speech-to-text)、[Qwen Token Plan 语音识别](https://platform.qianwenai.com/docs/token-plan/best-practices/speech-recognition)。

悬浮语音助手默认使用系统自带识别（macOS 原生 Speech，浏览器使用 Web Speech）；也可在「Agent 悬浮按钮」的浮标语音设置中选择「项目 ASR 渠道」和指定模型。系统模式无需配置 API Key；系统识别可能使用 Apple 网络服务。项目渠道模式点击麦克风录音，停顿约 1.8 秒或手动结束后转写，默认校对后发送给 Agent；开启「语音识别后自动发送」可自动执行。单次最长 60 秒；关闭面板会取消本次输入。录音通过 `/speech/transcribe` 转写，不加入素材库或任务记录。
