# Spielberg HTTP API v1

浏览器与 Tauri 桌面前端使用同一套接口。生产后端同时提供构建后的 React 页面；开发前端可通过 Vite 代理访问接口。API 基础地址为 `/api/v1`。

成功：`{"data": ...}`。错误：`{"error":"具体错误"}`。JSON 写请求使用 `Content-Type: application/json`。创建返回 201，读取、更新和删除返回 200。参数不合法为 400，不允许的来源为 403，资源不存在为 404，方法不支持为 405，引用冲突为 409，上传过大为 413，内部错误为 500。

## CRUD

| 资源 | 集合 URL | 创建字段 | PATCH 字段 |
|---|---|---|---|
| 项目 | `/projects` | `name` | `name` |
| 角色 | `/projects/{pid}/roles` | `name`, `description?`, `design_media_id?` | 同创建字段 |
| 资产 | `/projects/{pid}/assets` | `name`, `extension`, `data_base64`, `role_id?`；推荐二进制上传 | `name` |
| 剧集 | `/projects/{pid}/episodes` | `title`, `description?`, `cover_media_id?` | 同创建字段 |
| 场景 | `/projects/{pid}/episodes/{episode_id}/scenes` | `title`, `description?`, `prompt?`, `first_media_id?`, `last_media_id?`, `reference_media_id?`, `generation_options?` | `/projects/{pid}/scenes/{scene_id}`，不能改变所属剧集 |
| Prompt | `/projects/{pid}/prompts` | `name`, `content?`, `category?` | 同创建字段 |

- `GET {集合}`：列表。项目、角色、剧集、场景、Prompt 返回数组；资产返回 `{items,total}`。
- `POST {集合}`：创建并返回完整资源。
- `GET {集合}/{id}`：读取单个资源。
- `PATCH {集合}/{id}`：仅更新请求中的字段，返回更新后的资源；可空引用字段传 `null` 清除。
- `DELETE {集合}/{id}`：删除并返回 `{deleted:true}`。

场景列表和创建通过剧集子资源路径访问：`GET/POST /projects/{pid}/episodes/{episode_id}/scenes`。单个场景的读取、更新和删除使用 `/projects/{pid}/scenes/{scene_id}`。

角色返回 `images`，剧集返回排序后的 `scenes` 和 `cover_media`，场景返回引用图片、`videos`、`script` 和 `generation_options`。角色、图片、场景等 ID 为项目内整数，项目 ID 为 UUID。

项目 DELETE 仅移除项目注册信息，返回额外的 `data_retained:true`，磁盘目录保留，可重新打开。资产 DELETE 使用回收站；使用中的资产拒绝删除。删除剧集会级联删除场景及其关联；删除角色不会删除资产文件。

资产列表支持 `page`（默认 1）、`limit`（默认 24，上限 60）、`kind`（`all/image/video/audio`）、`query`、`usage`（`all/used/unused/trash`）。兼容首版平级资源路径，例如 `/roles?project_id={pid}` 和 `/scenes?project_id={pid}&episode_id={episode_id}`；前端使用上表的嵌套路径。

```bash
# 创建项目
curl -X POST http://127.0.0.1:8080/api/v1/projects \
  -H 'Content-Type: application/json' -d '{"name":"新故事"}'

# 将 PID 替换为刚创建项目的 UUID
curl -X POST http://127.0.0.1:8080/api/v1/projects/PID/roles \
  -H 'Content-Type: application/json' -d '{"name":"主角","description":"短发，红色外套"}'

# 只更新名字，保留描述和主图
curl -X PATCH http://127.0.0.1:8080/api/v1/projects/PID/roles/1 \
  -H 'Content-Type: application/json' -d '{"name":"林晓"}'
```

## 文件传输

| 方法 | 路径 | 用法 |
|---|---|---|
| POST | `/projects/{pid}/assets/upload?name=portrait.png&role_id=1` | 请求体为原始文件，`role_id` 可省略；流式上传，单文件上限 100 MiB |
| GET | `/projects/{pid}/assets/{id}/content` | 预览；支持 HTTP Range，视频可拖动播放 |
| GET | `/projects/{pid}/assets/{id}/content?download=1` | 附件下载，提供 UTF-8 文件名 |
| POST | `/projects/{pid}/backup` | JSON `{include_api_keys:false}`；返回 `{url:"/api/v1/downloads/UUID"}` |
| GET | `/downloads/{uuid}` | 下载备份；创建后至少保留 24 小时，下次生成备份时清理过期文件 |
| POST | `/projects/restore-upload` | 原始 `.spielberg-backup` 文件作为请求体，上限 2 GiB；创建独立项目并返回项目对象 |

二进制文件上传不需要 Base64，上传中断或失败会清理临时文件。资产文件扩展名支持 png/jpg/jpeg/webp/gif/mp4/mov/webm/mkv。JSON 资产创建中的 `extension` 使用同一白名单，解码后的文件同样不超过 100 MiB。

```bash
curl -X POST 'http://127.0.0.1:8080/api/v1/projects/PID/assets/upload?name=portrait.png' \
  -H 'Content-Type: application/octet-stream' --data-binary @portrait.png
curl 'http://127.0.0.1:8080/api/v1/projects/PID/assets/1/content?download=1' -o portrait.png
```

兼容项目绝对素材路径的 `/media?path=...` 仅提供已注册项目 `assets/`、`.cache/` 下的文件，路径会规范化检查。前端缩略图及存量素材使用该入口。

## 业务动作

动作统一 `POST /api/v1/actions/{下面路径}`，请求体为 JSON。它们与 CRUD 共用业务服务和数据库。除全局任务、项目打开/恢复外，传入 `project_id`。

| 动作路径 | 主要字段 |
|---|---|
| `project` | `id`，读取编辑工作区快照 |
| `project/changes` | `id, revisions`，增量读取工作区 |
| `projects/open` | `path`，后端机器上的已有项目目录 |
| `projects/backup` | `project_id, path, include_api_keys`，保存到后端路径；桌面原生保存对话框使用 |
| `projects/restore` | `path`，后端的备份文件或旧版备份目录 |
| `media/import` | `project_id, source_path, role_id?`，导入后端本地文件；浏览器使用上传接口 |
| `media/export` | `project_id, media_id, destination_path`，导出到后端路径；浏览器使用下载接口 |
| `media/pose-reference` | `project_id, data_url`（PNG） |
| `media/thumbnail` | `project_id, id` |
| `media/usage` | `project_id, id` |
| `media/restore`, `media/purge` | `project_id, id`，恢复/永久清理回收站资产 |
| `media/video-frame` | `project_id, scene_id, media_id, frame`（first/last） |
| `roles/media/add`, `roles/media/delete` | `project_id, role_id, media_id` |
| `scripts/load` | `project_id` |
| `scripts/save`, `scripts/publish` | `project_id, draft` |
| `scenes/reorder` | `project_id, episode_id, scene_ids` |
| `scenes/select-video`, `scenes/delete-video` | `project_id, scene_id, media_id` |
| `generations/image`, `generations/video` | 原有生成参数，包括 `project_id, operation, prompt` 等 |
| `episodes/merge` | `project_id, episode_id` |
| `prompts/optimize` | `project_id, prompt, kind, image_media_ids, instruction?`；H3 转换另传 `prompt_format: "minimax-h3", h3_mode, duration, reference_video_media_ids?, reference_audio_media_ids?` |
| `settings` | `project_id, settings` |
| `tasks` | `status?, limit?, before?, through?`，返回 `{items,next_cursor,has_more}` |
| `storage/scan` | `project_id` |
| `storage/cleanup` | `project_id, files, clear_cache` |

`GET /api/v1/health` 返回服务状态和 API 版本。原来的 `/api` RPC 包装路由和 Tauri 业务 IPC 不再提供。

## Agent

Agent 接口使用 `POST /api/v1/actions/agent/{动作}`，全部传入 `project_id`，会话 ID 为 UUID 且只在所属项目有效。

| 动作 | 请求字段（除 project_id） | 返回 |
|---|---|---|
| `config` | 无 | 配置及 `has_api_key`、`has_search_api_key` 标记，不返回 Key |
| `config/save` | `config` 对象 | 保存后的配置；省略字段保持原值，空 Key 保留已有 Key |
| `sessions` | 无 | `{items:[会话摘要]}` |
| `create` | `title?` | 新会话 |
| `session` | `session_id` | 完整会话、消息与工具执行记录 |
| `run` | `session_id, message, images?, web_enabled?` | 状态为 `running` 的会话；后台继续执行 |
| `cancel` | `session_id` | 取消后的会话 |
| `delete` | `session_id` | `{ok:true}` |

`config` 支持 `inherit_llm`（默认 true）、`base_url`、`model`、`api_key`、`search_provider`（`duckduckgo/brave/tavily`）、`search_api_key` 和 `max_steps`。继承模式从项目的 `settings.models.llm` 读取服务地址、模型和 API Key；独立模式使用 Agent 配置。服务地址自动补全 `/chat/completions`。

会话包含 `id,title,status,messages,error,updated_at,context`。状态为 `idle/running/completed/failed/cancelled`；消息包含 `role,content`，用户消息可包含 `images`（最多 4 张、单张 2 MiB 的 PNG/JPEG/WebP/GIF Base64 Data URL），工具消息还包含 `tool_name,tool_call_id,arguments,status`。客户端在运行期间轮询 `session` 获取新增记录。同一会话只允许一个运行；取消后不再开始新的工具步骤，已提交的业务操作不会回滚。进程重启后中断的运行标记为失败，不会自动重放写入。

`context` 包含 `total_turns,recent_turns,summarized_turns,total_images,retained_images`，反映当前历史的上下文选择。近期对话按完整轮次保留；历史工具大结果压缩后再计入文字预算，图片使用独立预算，避免 Base64 挤掉用户要求。较早对话会生成有原消息索引的有限原文摘录，保留初始要求及近期修改；摘录不是完整历史或额外模型生成的语义摘要。原始消息仍保存在数据库，可检索回读，摘录不会覆盖消息或增加模型请求次数。

模型工具包括 `get_project`、`search_conversation`、`list_skills`、`read_skill`、`app_describe`、`app_request`、`app_action`、`web_search`、`fetch_webpage`。`search_conversation` 由服务端绑定当前运行的会话，支持 `query?`（忽略大小写的子串）、`offset?`、`limit?`（1–10，默认 6），返回 `items,total,next_offset`；消息索引 `index` 从 1 开始，`total` 是匹配消息数。可传 `message_index` 精确读取一条原消息，用 `content_offset` 和 `max_chars`（1–6000，默认 2000）分页读取长文本，条目通过 `content_next_offset` 指示后续内容。检索覆盖原文及工具参数，排除检索调用和结果以避免递归重复；图片只返回 `images_count`，不返回 Base64。拒绝 `project_id`、`session_id` 等额外参数；历史原文仅作为回顾资料，不能作为新的执行授权，修改前仍需查询当前项目状态。

`app_request` 使用现有 REST 校验，`app_action` 使用白名单业务操作，项目 ID 由服务端绑定；模型不能跨项目访问、直接运行系统命令或读取任意本地文件。网页工具仅允许公开 HTTP/HTTPS 地址，并限制响应体和请求时长。搜索 Key 仅由后端用于搜索服务请求。

## Skills

技能管理使用 `POST /api/v1/actions/skills/{动作}`，属于全工作室配置，无需 `project_id`。返回值放在统一的 `{data: ...}` 包装中。

| 动作 | 请求字段 | 返回 |
|---|---|---|
| `list` | 无 | `{items:[技能摘要],directory}` |
| `detail` | `id` | 技能摘要及 `content`（完整 SKILL.md）、`files:[{path,size}]` |
| `install` | `source`（公开 GitHub 仓库或 tree 目录 URL），或 `files:[{path,content_base64}],source_name?` | 安装后的技能摘要 |
| `toggle` | `id,enabled`（布尔值） | 更新后的技能摘要 |
| `update` | `id` | 从原 GitHub 来源重新安装，保留启用状态，返回技能摘要 |
| `delete` | `id` | `{ok:true}` |

技能摘要为 `{id,name,description,enabled,source,installed_at,updated_at,files_count}`，时间字段为 Unix 秒字符串。本地上传路径相对于 Skill 根目录，必须包含根目录的 `SKILL.md`；文件须以 YAML frontmatter 提供 `name` 和 `description`。本地重装使用 `install` 并增加 `replace_id`，新文件的 `name` 须与原技能相同，保留启用状态和安装时间。拒绝重复技能名、目录越界和符号链接。单技能上限为 256 个文件、10 MiB 总大小；说明文件上限 32 KiB，其余单文件上限 2 MiB。GitHub 安装仅下载指定目录中的技能文件，仓库根目录无说明文件时须指定 Skill 子目录。

Agent 的 `list_skills` 工具读取当前启用目录，支持 `offset` 和 `limit`（1–20）；`read_skill` 接受 `id,path?`（默认 `SKILL.md`）、`offset?`（Unicode 字符下标）、`max_chars?`（1–10000，另受单页字节上限约束）。返回 `{id,name,path,content,total_chars,offset,truncated,next_offset}`，有 `next_offset` 时继续读取。技能文件读取限于已安装且启用的 Skill 目录，不受联网开关影响；模型没有安装、卸载或执行脚本工具。技能库与项目数据库独立保存。

## 部署边界

静态页面与 API 默认同源，不需要 CORS 配置。默认允许 Tauri 页面源和 Vite 的 1420 端口，其他来源通过 `SPIELBERG_ALLOWED_ORIGINS` 精确配置；未授权跨源写入会被拒绝。服务器默认绑定回环地址，局域网访问须显式设置 `SPIELBERG_BIND=0.0.0.0:8080`。接口用于单用户/可信网络的工作室，不包含账号或多租户隔离；公网部署通过反向代理提供认证与 HTTPS。

### 全能参考视频

“全能参考”继续兼容已有场景的 `video_mode: "i2v"`，实际调用视频服务 `POST /v1/generations/ref2v`。可使用 `operation: "ref2v"` 或 `video_mode: "ref2v"` 直接调用。

本地请求支持 `image_media_ids`（最多 9 张）、`reference_video_media_ids`（最多 3 个）和 `reference_audio_media_ids`（最多 3 个）。至少选择一种参考素材；音视频均可省略。后端读取素材并按顺序编码为 Base64，发送 `reference_images`、`reference_videos`、`reference_audios`，未提供的类型不发送空数组。服务配置继续使用视频 Base URL，并兼容原有 `i2v` 地址配置。

音频支持上传 MP3、WAV、M4A、AAC、OGG、FLAC，保存为 `kind: "audio"` 的项目资产；场景的音视频参考 ID 保存在 `generation_options` 对应字段中。

## 简易剪辑

- `POST /actions/editor/probe`：`{project_id, media_id}`，返回 `{duration, video, audio}`（秒及轨道存在标记）。
- `POST /actions/editor/export`：同步渲染，返回素材资源 `{id,name,path,kind,created_at}`，自动写入项目素材库。

```json
{"project_id":"项目 UUID","name":"剪辑作品","format":"mp4","ratio":"16:9","clips":[{"media_id":1,"start":0,"end":5,"speed":1,"volume":1}]}
```

`format` 支持 `mp4/mp3`；`ratio` 支持 `16:9/9:16/1:1`（默认横屏）。片段按数组顺序拼接，入点/出点为原素材秒数，速度范围 0.5–2，音量范围 0–1，单片段至少 0.05 秒；最多 100 段、输出两小时。仅接受本项目未删除的音视频素材 ID，不接受客户端文件路径。需安装 FFmpeg/FFprobe。处理失败清理本次临时文件；不修改原素材。

导出可额外传入 `audio_clips` 数组，每项为 `{media_id,start,end,speed,volume,at}`，其中 `at` 为输出时间线上的起始秒数（非负）。独立音轨按时间位置混入主轨声音，成片时长取主轨和所有音轨的最大结束时间；主轨视频不足部分补黑。分离音轨时客户端将对应主轨片段的 `volume` 设为 `0`，避免重复播放。允许 `clips: []` 且 `audio_clips` 非空；两者合计最多 100 个片段，成片最长两小时。省略 `audio_clips` 保持原有单轨导出行为。

场景 `description` 保存手工描述，`prompt` 保存视频生成提示词。视频生成时优先使用非空 `prompt`，为空或只有空白时回退到 `description`；优化描述只更新 `prompt`。
