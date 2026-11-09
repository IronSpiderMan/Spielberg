# Spielberg HTTP API v1

浏览器与 Tauri 桌面前端使用同一套接口。生产后端同时提供构建后的 React 页面；开发前端可通过 Vite 代理访问接口。API 基础地址为 `/api/v1`。

成功：`{"data": ...}`。错误：`{"error":"具体错误"}`。JSON 写请求使用 `Content-Type: application/json`。创建返回 201，读取、更新和删除返回 200。参数不合法为 400，不允许的来源为 403，资源不存在为 404，方法不支持为 405，引用冲突为 409，上传过大为 413，内部错误为 500。

## CRUD

| 资源 | 集合 URL | 创建字段 | PATCH 字段 |
|---|---|---|---|
| 项目 | `/projects` | `name` | `name`, `outline`, `agents_md`, `documents`, `timelines` |
| 资产 | `/projects/{pid}/assets` | `name`, `description?`, `enabled?`, `category?`, `design_media_id?` | 同创建字段 |
| 资产关系 | `/projects/{pid}/asset-relations` | `source_asset_id`, `target_asset_id`, `label`, `directed?`, `description?` | 同创建字段 |
| 素材 | `/projects/{pid}/media` | `name`, `extension`, `data_base64`, `asset_id?`；推荐二进制上传 | `name` |
| 剧集 | `/projects/{pid}/episodes` | `title`, `description?`, `cover_media_id?` | 同创建字段 |
| 场景 | `/projects/{pid}/episodes/{episode_id}/scenes` | `title`, `description?`, `shared_prompt?`, `reference_media_ids?`, `reference_audio_media_ids?`, `generation_mode?`, `generation_options?`, `clip_ids?` | `/projects/{pid}/scenes/{scene_id}`，支持调整成员，归属剧集固定 |
| 片段 | `/projects/{pid}/episodes/{episode_id}/clips` | `title`, `scene_id?`, `description?`, `prompt?`, `creation_mode?`, `first_media_id?`, `last_media_id?`, `reference_media_id?`, `generation_options?`, `anchor_clip_id?`, `position?` | `/projects/{pid}/clips/{clip_id}`，用场景的 `clip_ids` 调整归属 |
| 剧本 / 分镜头剧本 | `/projects/{pid}/episodes/{episode_id}/screenplays` | `title`, `content?`, `format?`（`markdown/csv`） | `/projects/{pid}/screenplays/{id}`；支持 `episode_id` 移至其他剧集 |
| Prompt | `/projects/{pid}/prompts` | `name`, `content?`, `category?` | 同创建字段 |

- `GET {集合}`：列表。项目、资产、剧集、场景、片段、剧本、Prompt 返回数组；素材返回 `{items,total}`。
- `POST {集合}`：创建并返回完整资源。
- `GET {集合}/{id}`：读取单个资源。
- `PATCH {集合}/{id}`：仅更新请求中的字段，返回更新后的资源；可空引用字段传 `null` 清除。
- `DELETE {集合}/{id}`：删除并返回 `{deleted:true}`。

批量删除使用 `DELETE /api/v1/projects/{pid}/{resource}`，其中 `resource` 为
`assets`、`asset-relations`、`media`、`episodes`、`scenes`、`clips` 或 `prompts`。
请求体示例为 `{"ids":[1,2]}`，接受 1–100 个不重复的正整数 ID。成功返回 HTTP 200，
响应为 `{"data":{"deleted":true,"ids":[1,2],"count":2}}`。
参数无效返回 400，任一 ID 不存在返回 404，素材仍被引用或存在运行中的后台任务时返回 409。
整个批次在同一事务中处理，失败时回滚。素材移入回收站，剧集沿用级联删除规则。

### 场景与片段

场景是剧集下的叙事单元，拥有有序的 `clips`。场景保存共享 `shared_prompt`、参考图片 `reference_media_ids`、参考音频 `reference_audio_media_ids`、`generation_mode`（`clips` 或 `one_take`）与生成参数。新建场景省略 `clip_ids` 时会创建一个初始片段，可同时传入本集的 `anchor_scene_id` 和 `position`（`before` 或 `after`），将新场景插在目标场景前方或后方。创建或更新时可用 `clip_ids` 指定本集连续的片段，数组必须和剧集顺序一致。被移出目标场景的片段成为独立的单片段场景，被移空的场景会删除。如果调整后其他场景的成员不再连续，整个操作回滚。

片段保存局部动作、对白、运镜、参考素材及视频版本。片段返回 `episode_id`、`scene_id`、引用图片、`videos`、`script` 和 `generation_options`。POST 片段省略 `scene_id` 时创建独立的单片段场景；指定 `anchor_clip_id` 和 `position: "before"` 或 `"after"` 可在同集锚点旁插入。GET 片段集合可按 `episode_id` 或 `scene_id` 筛选。删除场景会删除其成员片段，媒体文件留在素材库。`scenes/ungroup` 将多片段场景拆成各自独立的单片段场景，并将共享 Prompt 与参考素材复制到各新场景。

`scenes/merge` 将同一剧集里至少两个相邻场景合并到目标场景。目标默认取剧集顺序中的首个所选场景，也可通过 `target_scene_id` 选择任一所选场景。合并按剧集顺序移动原有片段，沿用目标场景的共享设定、生成方式和候选视频，并清除已选主视频。其他场景的记录及视频关联会移除，素材仍可在素材库中选用。

剧集包含按顺序排列的 `scenes`、`clips` 和 `playback_units`。每个播放项有 `kind`（`scene` 或 `clip`）、`id`、`scene_id`、`title` 和视频版本信息。`clips` 模式的场景按成员片段依次播放，`one_take` 模式的场景作为一个播放项。剧集预览和合并使用同一顺序。

项目升级时，旧 `scenes` 表与关联表改为 `clips`、`clip_options`、`clip_scripts`、`clip_videos`、`clip_canvases` 和 `clip_canvas_sources`，原片段 ID 继续对应旧记录。迁移为每个旧片段创建一个场景，并更新草稿、分镜、画布和历史工具调用的结构化字段。分镜与脚本草稿的成员数组改为 `clips`，绑定片段用 `clip_id`。引用片段图的 `@` 写法为 `@剧集名.clip001.first`、`.last`、`.ref`。

每个剧集最多一份 Markdown 剧本和一份 CSV 分镜头剧本，重复创建或移动到已有同类型内容的剧集返回 409；请读取已有资源并 PATCH。剧本按剧集归属：`GET/POST /projects/{pid}/episodes/{episode_id}/screenplays` 列出或创建该集剧本，路径指定归属。兼容 `/projects/{pid}/screenplays`，创建时必须提交有效 `episode_id`，GET 可用 `?episode_id=...` 筛选；单个资源的 GET/PATCH/DELETE 使用 `/projects/{pid}/screenplays/{id}`。PATCH 省略字段保持原值，更新 `episode_id` 可移动到当前项目的其他剧集，不能脱离剧集。资源包含 `id,episode_id,title,content,format,created_at,updated_at`。

资产的 `category` 为 `person`（人物）、`location`（地点）、`object`（物品）、`creature`（生物）、`vehicle`（载具）或 `other`（其他），默认 `person`。旧项目自动迁移为人物，PATCH 省略类别时保留原值，其他类别值会被拒绝。资产列表 GET 支持 `category`、`enabled`（true/false）、`query`（名称或描述，不区分大小写）筛选；省略筛选返回所有资产，包括禁用项。资产库使用 `/assets` 接口和 `assets` 数据字段；素材库使用 `/media` 接口和 `media` 数据字段，关联参数统一为 `asset_id` 与 `media_id`。数据库版本 16 将旧 `roles` 表原地更名为 `assets`，保留资产 ID、图片和音频关联及素材路径；`role_media`、`role_audio` 关联表沿用原名称，其外键更新为引用 `assets`。旧 Agent 会话的结构化工具参数会一次性迁移，用户原文不改写。

资产的 `enabled` 为布尔值，默认 `true`（包含旧项目资产）。设为 `false` 后，资产及其命名图片不再支持 `@` 引用；省略该字段的更新保留原状态。资产返回 `enabled` 和 `images`，剧集封面在 `cover_media`。资产、素材、场景和片段 ID 为项目内整数，项目 ID 为 UUID。

项目 DELETE 仅移除项目注册信息，返回额外的 `data_retained:true`，磁盘目录保留，可重新打开。素材 DELETE 使用回收站；使用中的素材拒绝删除。删除剧集会级联删除所属剧本、分镜头剧本、场景和片段及其关联；删除资产不会删除素材文件。

### 资产关系图

资产关系保存在 `asset_relations`，任意两类资产之间均可建立关系，包括人物与人物、人物与地点。`GET /projects/{pid}/asset-relations` 返回数组；单条关系使用 `/projects/{pid}/asset-relations/{id}` 的 GET/PATCH/DELETE。返回字段为 `id,source_asset_id,target_asset_id,label,directed,description,created_at,updated_at`。

```json
{"source_asset_id":1,"target_asset_id":2,"label":"兄妹","directed":false,"description":"魏来与魏宁"}
```

`label` 去除首尾空白后须为 1–80 个字符，`description` 最多 2000 字符，默认空文本；`directed` 默认为 `false`。无向关系将较小资产 ID 保存为 `source_asset_id`，有向关系保留用户指定的起终点。相同起终点、名称和方向的关系重复创建返回 409，允许同一对资产拥有不同名称的关系。资产必须属于当前项目；缺少资产返回 404，自关联或非法字段返回 400。删除资产会级联删除其关系及图中的对应坐标，不删除对端资产。

`GET /projects/{pid}/asset-graph` 返回项目共享的位置布局和修订号：

```json
{"positions":{"1":{"x":100,"y":120},"2":{"x":450,"y":120}},"revision":1}
```

`PATCH` 相同路径提交完整 `positions` 与读取时的 `revision`，成功返回新布局并将修订号加一；版本过期返回 409，客户端应重新加载并提示用户。坐标键必须是当前项目资产的十进制 ID，`x/y` 必须是绝对值不超过 1000000 的有限数值，最多保存 5000 个资产位置。空项目初始返回 `{"positions":{},"revision":0}`。关系和布局随项目备份恢复，项目之间独立保存。

素材列表支持 `page`（默认 1）、`limit`（默认 24，上限 60）、`kind`（`all/image/video/audio`）、`query`、`usage`（`all/used/unused/trash`）。同时支持平级资源路径，例如 `/assets?project_id={pid}` 和 `/scenes?project_id={pid}&episode_id={episode_id}`；前端使用上表的嵌套路径。

```bash
# 创建项目
curl -X POST http://127.0.0.1:8080/api/v1/projects \
  -H 'Content-Type: application/json' -d '{"name":"新故事"}'

# 将 PID 替换为刚创建项目的 UUID
curl -X POST http://127.0.0.1:8080/api/v1/projects/PID/assets \
  -H 'Content-Type: application/json' -d '{"name":"主角","description":"短发，红色外套"}'

# 只更新名字，保留描述和主图
curl -X PATCH http://127.0.0.1:8080/api/v1/projects/PID/assets/1 \
  -H 'Content-Type: application/json' -d '{"name":"林晓"}'
```

## 文件传输

| 方法 | 路径 | 用法 |
|---|---|---|
| POST | `/projects/{pid}/media/upload?name=portrait.png&asset_id=1` | 请求体为原始文件，`asset_id` 可省略；流式上传，单文件上限 100 MiB |
| GET | `/projects/{pid}/media/{id}/content` | 预览；支持 HTTP Range，视频可拖动播放 |
| GET | `/projects/{pid}/media/{id}/content?download=1` | 附件下载，提供 UTF-8 文件名 |
| POST | `/projects/{pid}/backup` | JSON `{include_api_keys:false}`；返回 `{url:"/api/v1/downloads/UUID"}` |
| GET | `/downloads/{uuid}` | 下载备份；创建后至少保留 24 小时，下次生成备份时清理过期文件 |
| POST | `/projects/restore-upload` | 原始 `.spielberg-backup` 文件作为请求体，上限 2 GiB；创建独立项目并返回项目对象 |

二进制文件上传不需要 Base64，上传中断或失败会清理临时文件。素材文件扩展名支持 png/jpg/jpeg/webp/gif/mp4/mov/webm/mkv。JSON 素材创建中的 `extension` 使用同一白名单，解码后的文件同样不超过 100 MiB。

```bash
curl -X POST 'http://127.0.0.1:8080/api/v1/projects/PID/media/upload?name=portrait.png' \
  -H 'Content-Type: application/octet-stream' --data-binary @portrait.png
curl 'http://127.0.0.1:8080/api/v1/projects/PID/media/1/content?download=1' -o portrait.png
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
| `media/import` | `project_id, source_path, asset_id?`，导入后端本地文件；浏览器使用上传接口 |
| `media/export` | `project_id, media_id, destination_path`，导出到后端路径；浏览器使用下载接口 |
| `media/pose-reference` | `project_id, data_url`（PNG） |
| `media/thumbnail` | `project_id, id` |
| `media/usage` | `project_id, id` |
| `media/restore`, `media/purge` | `project_id, id`，恢复/永久清理回收站素材 |
| `media/video-frame` | `project_id, clip_id, media_id, frame`（first/last） |
| `assets/media/add`, `assets/media/delete` | `project_id, asset_id, media_id`；新增可传 `name` 重命名图片素材 |
| `assets/audio/save` | `project_id, asset_id, media_id, name`；新增或修改该资产的音频参考名，不重命名源素材 |
| `assets/audio/delete` | `project_id, asset_id, media_id`；仅解除音频关联 |
| `scripts/load` | `project_id, episode_id?` |
| `scripts/save`, `scripts/publish` | `project_id, episode_id?, draft`，草稿成员在 `draft.clips` |
| `canvas/load`, `canvas/save` | `project_id, clip_id`，保存时还需 `draft, revision` |
| `storyboard/generate` | `project_id, script`，返回 `clips` 分镜结构 |
| `storyboard/plan`, `storyboard/validate` | `project_id, clip`，校验时还需 `plan` |
| `clips/reorder` | `project_id, episode_id, clip_ids`，提交完整片段顺序且各场景保持连续 |
| `clips/duplicate` | `project_id, id, position?` |
| `scenes/duplicate` | `project_id, id, position`（`before` 或 `after`）。复制场景设定和片段创作内容 |
| `clips/select-video`, `clips/delete-video` | `project_id, clip_id, media_id` |
| `scenes/reorder` | `project_id, episode_id, scene_ids`，提交完整场景顺序，成员随场景移动 |
| `scenes/merge` | `project_id, episode_id, scene_ids, target_scene_id?, title?`，返回合并后的场景 |
| `scenes/ungroup` | `project_id, scene_id`，返回新的 `scene_ids` |
| `scenes/select-video`, `scenes/delete-video` | `project_id, scene_id, media_id`，选择或解除场景的视频版本 |
| `generations/image` | `project_id, operation, prompt` 等图片生成参数 |
| `generations/video` | `project_id` 和视频生成参数，带 `clip_id` 时继承场景设定并将产物归入片段 |
| `generations/clip-preview` | `project_id, clip_id`，可覆写本次视频生成参数 |
| `generations/scene-preview`, `generations/scene-video` | `project_id, scene_id, generation_options?`，目标场景须为 `one_take` |
| `generations/tts` | `project_id, text`，可选 `channel_id, model, voice, format`；OpenAI 另支持 `speed`，支持风格指令的模型可传 `instructions` |
| `episodes/merge` | `project_id, episode_id` |
| `prompts/optimize` | `project_id, prompt, kind, image_media_ids, instruction?`；H3 转换另传 `prompt_format: "minimax-h3", h3_mode, duration, reference_video_media_ids?, reference_audio_media_ids?`；Wan 中文优化另传 `prompt_format: "wan3.0", duration?, video_mode?`（保留原文及 `@` 引用，正数时长约束总时长，自动时长 `-1` 保留原文时长） |
| `settings` | `project_id, settings` |
| `tasks` | `status?, limit?, before?, through?`，返回 `{items,next_cursor,has_more}` |
| `tasks/resume-video` | `project_id, job_id`，根据服务端已保存的远端任务编号继续查询及下载视频，同步返回素材 |
| `storage/scan` | `project_id` |
| `storage/cleanup` | `project_id, files, clear_cache` |

图片和视频渠道分别保存在 `settings.image.channels`、`settings.video.channels`。每组可设置 `default_channel_id`，每个渠道包含稳定的 `id`、`name`、`provider`、`base_url`、`api_key`、`models` 和可选 `default_model_id`。渠道 ID 在同组内唯一，模型 ID 在同一渠道内唯一；不同渠道可使用相同模型 ID。旧的 `settings.image/video`、t2i/i2i 等配置仍可读取，并在快照中兼容为一个渠道。

```json
{
  "image": {
    "default_channel_id": "image-primary",
    "channels": [{
      "id": "image-primary", "name": "千问图片", "provider": "qianwen-token-plan",
      "base_url": "https://token-plan.maas.qianwenaiapi.com", "api_key": "sk-sp-placeholder",
      "default_model_id": "qwen-image-3.0-pro",
      "models": [{"id": "qwen-image-3.0-pro", "name": "Qwen Image 3.0 Pro", "profile": "qwen-image"}]
    }]
  }
}
```

图片 `provider` 支持 `openai`、`qianwen-token-plan` 以及保留兼容的 `cast`；视频支持 `cast`、`qianwen-token-plan`。模型 `profile` 指向共享能力表 `src/generation-models.json`，Token Plan 模型 ID 与能力必须匹配。CAST 模型可另设 `base_url` 覆盖渠道地址、`send_model: true` 向服务发送所选模型 ID；默认不发送，以兼容固定模型适配服务。保存配置时校验重复 ID、默认项及能力与渠道类型。

`generations/image` 和 `generations/video` 可传 `channel_id`、`model` 选择已配置渠道和模型，不能在生成请求中覆盖渠道凭证。省略时使用默认渠道及支持当前方式的模型；显式选项不存在或参数不受支持时返回错误。

`POST /api/v1/actions/generations/tts` 使用 `settings.tts.channels` 和 `settings.tts.default_channel_id`，渠道结构与图片/视频一致。支持 `provider: "openai"`（能力 `openai-tts` 或支持风格指令的 `openai-tts-instruct`）及 `provider: "qianwen-token-plan"`（模型 `qwen-audio-3.0-tts-plus`，能力 `qwen-tts`）。文本必须非空且不超过 4096 字符，`format` 为 `mp3`（默认）或 `wav`，`voice` 默认 OpenAI `alloy`、千问 `longanhuan_v3.6`。OpenAI `speed` 范围为 0.25–4，默认 1；`instructions` 最多 4096 字符，`tts-1`/`tts-1-hd` 不支持。千问不接受语速和风格指令参数，使用固定 24000 Hz 采样率及 `sk-sp-` 专属 Key。显式选择无效渠道或模型会报错，不回退至其他渠道。

OpenAI Base URL 支持服务根地址、`/v1` 地址或完整 `/v1/audio/speech` 地址；千问支持根地址、控制台 `/compatible-mode/v1` 地址或完整 `/api/v1/services/audio/tts/SpeechSynthesizer` 地址。同步返回已入库的 `kind: "audio"` 素材对象（包含 `id, name, path, created_at`）；任务由后端记录，失败响应和无效音频不会入库。请求中不接收凭证覆盖。

千问上游非流式响应为 JSON，后端从 `output.audio.url` 提取下载地址并下载完整音频，下载时不转发渠道 API Key。仍兼容渠道直接返回音频文件的情况。HTTP 200 中的业务错误、缺少下载地址、下载失败和无效音频均记录为失败；不会因此重新提交合成请求。

```json
{"project_id":"项目 ID","text":"你好，欢迎来到工作室。","channel_id":"已配置的 TTS 渠道 ID","model":"gpt-4o-mini-tts","voice":"alloy","format":"mp3","speed":1,"instructions":"温柔、平静地讲述"}
```

`generations/video` 沿用 `video_mode: "fl2v"`（`first_media_id`、可选 `last_media_id`）、`video_mode: "i2v"` 或 `operation: "ref2v"`（`image_media_ids`、可选音视频参考）；省略模式与参考素材时为文生视频。Wan 3.0 的 `duration` 为 2–30 或 `-1`，可传布尔值 `audio`、`prompt_extend`、`watermark`；HappyHorse 各模型仅支持对应方式，时长 3–15。Token Plan 视频可传 `resolution: "480P"/"720P"/"1080P"`（默认 720P），不使用像素 `size`。千问图片使用 `size: "宽x高"`，后端转换为 DashScope 格式，并按模型校验像素面积、参考图数量与蒙版支持。

场景、片段的 `generation_options` 及画布节点可以保存模型选择与参数。后台任务持久化实际渠道、模型和远程任务编号，恢复时使用原选择。

`tasks/resume-video` 适用于已经取得远端任务编号、后来失败或中断的片段或场景视频任务。恢复操作只继续查询和下载已有任务。已完成的任务返回原结果，仍在执行的任务需要等待。

`generations/clip-preview` 解析片段的实际请求，返回 Prompt、参考素材、参数及警告。片段 `generation_options` 可设 `inherit_shared_prompt: false`，并用 `exclude_shared_reference_media_ids` 和 `exclude_shared_reference_audio_media_ids` 排除指定共享素材。全能参考的共享素材与局部素材按 ID 去重，参考编号在合并后解析。文生视频和首尾帧模式按各自的输入约束发送素材。片段生成时可用 `clip_id` 读取已保存的输入，也可传入本次参数。

`generations/scene-preview` 将 `one_take` 场景的片段编排成单镜头的连续动作，返回编译后的 Prompt、实际参考素材、模型参数、警告及 `beats`（每个片段的 `clip_id`、`start`、`end`、`title`）。总时长来自各片段的具体时长，并按所选模型校验。`generations/scene-video` 使用同一编排逻辑提交视频，结果作为该场景的视频版本。两种预览动作只解析输入。

`GET /api/v1/health` 返回服务状态和 API 版本。原来的 `/api` RPC 包装路由和 Tauri 业务 IPC 不再提供。

## Agent

Agent 的 `app_request` 使用 `resource=assets` 操作六类创作资产，使用 `resource=media` 操作图片、视频、音频素材；`get_project` 对应返回 `assets` 和 `media`。资产支持类别、启用状态和名称查询，图片关联使用 `assets/media/*`，音频关联使用 `assets/audio/*`。解除关联或删除创作资产保留源素材；素材删除沿用引用保护及回收站语义。

Agent 通过 `app_request` 的 `scenes` 和 `clips` 读写场景与片段，通过 `app_action` 的 `clips/*` 管理片段顺序与版本，通过 `scenes/*` 管理场景顺序、合并、解组与一镜到底版本。生成前可以用 `generations/clip-preview` 或 `generations/scene-preview` 核对实际请求。用 `app_describe` 读取当前工具字段和数据结构。

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

`config` 支持 `inherit_llm`（默认 true）、`base_url`、`model`、`api_key`、`search_provider`（`duckduckgo/brave/tavily`）、`search_api_key`、`max_steps`（1–64，默认 16）和 `request_timeout_seconds`（30–1800，默认 600）。继承模式从项目的 `settings.models.llm` 读取服务地址、模型和 API Key；独立模式使用 Agent 配置。服务地址自动补全 `/chat/completions`。

会话包含 `id,title,status,messages,error,updated_at,context,execution`。状态为 `idle/running/completed/limited/failed/cancelled`；`completed` 表示本轮模型正常返回，不能代替业务结果验证；`limited` 表示触发步数或重复失败保护后完成汇报，可继续发送消息。消息包含 `role,content`，用户消息可包含 `images`（最多 4 张、单张 2 MiB 的 PNG/JPEG/WebP/GIF Base64 Data URL），工具消息还包含 `tool_name,tool_call_id,arguments,status,duration_ms?`。工具状态包括 `running/completed/failed/skipped`，`skipped` 表示未执行，不消耗工具步数。助手消息的可选 `status` 为 `streaming/completed/interrupted`；流式文本在同一消息位置更新，正常结束时替换为完整回复，失败、取消或重启时保留已保存文本并标为 `interrupted`。客户端在运行期间轮询 `session` 获取新增及更新记录。同一会话只允许一个运行；取消会中断模型连接、响应体读取与重试等待，取消后不再开始新的工具步骤，已提交的业务操作不会回滚。进程重启后中断的运行标记为失败，不会自动重放写入。

`execution` 独立于消息保存，旧项目自动增加字段。新运行包含 `id`（每轮 UUID）、`phase`（`thinking/streaming/retrying/tool/finalizing/stopping/completed/limited/failed/cancelled`）、`tool_calls,max_steps,model_requests,retries,usage,plan`，可包含 `active_tool,explanation,stop_reason`。`usage` 累加服务返回的 `prompt_tokens,completion_tokens,total_tokens`；服务不提供时保持空对象。`stop_reason` 为 `budget_exhausted` 或 `repeated_tool_failure`。计数每轮重置；仍有未完成步骤的计划带入下一轮，全部完成的计划在下一轮清空。`session/run/cancel/create` 及 `sessions.items` 返回的 `execution.active` 根据后台运行注册表计算；`cancelled` 且仍有工具在收尾时，`active=true,phase=stopping`，客户端必须继续轮询并禁用再次运行与删除，直到 `active=false`。其他执行字段在旧会话中可能缺省。

`max_steps` 统计实际工具调用（包括 `update_plan`），达到上限后额外允许一次禁止工具调用的模型汇报，不执行超额工具，并为每个调用保存配对结果。同名同参数工具累计失败三次且期间未成功时进入汇报。模型连接错误及 HTTP 408/429/500/502/503/504 最多重试两次，退避至少 1、2 秒，短 `Retry-After` 等待可取消；不会重试业务工具、认证失败、无效响应或超时响应。自动重试增加 `model_requests/retries`，不增加 `tool_calls`。

`context` 包含 `total_turns,recent_turns,summarized_turns,total_images,retained_images,active_compacted_messages,estimated_text_bytes`，反映当前历史的上下文选择。近期对话按完整轮次保留；历史工具大结果压缩后再计入文字预算，图片使用独立预算，避免 Base64 挤掉用户要求。较早对话会生成有原消息索引的有限原文摘录，保留初始要求及近期修改；摘录不是完整历史或额外模型生成的语义摘要。原始消息仍保存在数据库，可检索回读，摘录不会覆盖消息或增加模型请求次数。当前回合超过 128 KB 文字预算时，按完整 assistant/tool 批次压缩较早的调用与结果，保留当前用户原文和最近批次；必要时缩小最近批次的大字段。`active_compacted_messages` 表示采用压缩投影的本轮消息数，`estimated_text_bytes` 仅估算对话文本 JSON 大小，不含图片、系统提示、工具定义和独立计划，也不是模型 token 数。

模型请求启用 Chat Completions `stream=true`，按 SSE 拼接公开文本、工具参数与 usage，亦兼容忽略流式请求并返回完整 JSON 的渠道。SSE 必须收到合法 `finish_reason` 和 `[DONE]` 才能交给执行循环；长度截断、异常结束或断流不会执行该响应中的工具，不会自动重试已开始的流。

模型工具包括 `update_plan`、`get_project`、`search_conversation`、`list_skills`、`read_skill`、`app_describe`、`app_request`、`app_action`、`web_search`、`fetch_webpage`。关闭联网时不向模型暴露网络工具，执行端仍强制校验联网权限。

`update_plan` 接收 `plan`（1–8 项 `{step,status}`）和可选 `explanation`（最多 1000 字）。步骤说明为 1–200 字，状态为 `pending/in_progress/completed`，最多一项 `in_progress`。参数完整校验后才替换计划，不能写入业务数据或改变权限。计划随执行记录持久化，并作为助手工作记录加入后续上下文。

`search_conversation` 由服务端绑定当前运行的会话，支持 `query?`（忽略大小写的子串）、`offset?`、`limit?`（1–10，默认 6），返回 `items,total,next_offset`；消息索引 `index` 从 1 开始，`total` 是匹配消息数。可传 `message_index` 精确读取一条原消息，用 `content_offset` 和 `max_chars`（1–6000，默认 2000）分页读取长文本，条目通过 `content_next_offset` 指示后续内容。有 query 且未显式提供 content_offset 时，节选自动从首个命中附近开始，返回实际 `content_offset` 和可空 `match_offset`（原文字符偏移）；显式提供偏移时保持精确分页。检索覆盖原文及工具参数，排除检索调用和结果以避免递归重复；图片只返回 `images_count`，不返回 Base64。拒绝 `project_id`、`session_id` 等额外参数；历史原文仅作为回顾资料，不能作为新的执行授权，修改前仍需查询当前项目状态。

`app_request` 使用现有 REST 校验，`app_action` 使用白名单业务操作，项目 ID 由服务端绑定；模型不能跨项目访问、直接运行系统命令或读取任意本地文件。网页工具仅允许公开 HTTP/HTTPS 地址，并限制响应体和请求时长。搜索 Key 仅由后端用于搜索服务请求。

`app_action` 的 `resource/text/read` 支持完整分页读取创作正文，`data` 必填 `resource,id,field`，可选 `offset`（默认 0，Unicode 字符下标）和 `max_chars`（1–1500，默认 1500）。支持 `screenplays/prompts.content`、`assets/episodes.description`、`scenes.description/shared_prompt`、`clips.description/prompt`，ID 必须为当前项目内对应资源的正整数。返回 `{resource,id,field,content,offset,total_chars,next_offset}`；按顺序拼接各页 `content`，直至 `next_offset` 为 null。普通资源查询仍有输出长度限制，按 ID 查询不能替代正文分页；修改前读取全文，保留未要求修改的内容，不用节选覆盖整个字段。

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

技能摘要为 `{id,name,description,enabled,source,installed_at,updated_at,files_count,builtin}`，`builtin` 区分系统内置和自装技能。自装技能的时间字段为 Unix 秒字符串；内置技能的 `installed_at` 为空，`updated_at` 在首次切换启用状态前为空，此后记录偏好修改时间。本地上传路径相对于 Skill 根目录，必须包含根目录的 `SKILL.md`；文件须以 YAML frontmatter 提供 `name` 和 `description`。本地重装使用 `install` 并增加 `replace_id`，新文件的 `name` 须与原技能相同，保留启用状态和安装时间。拒绝重复技能名、目录越界和符号链接。单技能上限为 256 个文件、10 MiB 总大小；说明文件上限 32 KiB，其余单文件上限 2 MiB。GitHub 安装仅下载指定目录中的技能文件，仓库根目录无说明文件时须指定 Skill 子目录。

`short-drama-storyboard` 随应用内置并默认启用，无需安装或联网，在首次 Agent 调用前即可发现。支持 `list`、`detail` 和 `toggle`，禁用偏好持久化；`delete`、`update` 和对内置技能的显式重装返回错误，内容随应用更新。升级前已存在的同名自装技能优先，沿用其内容、启用状态和管理行为；卸载这类自装技能后，内置版本保留为停用状态，避免自动重新启用。

Agent 的 `list_skills` 工具读取当前启用目录（含内置技能），支持 `offset` 和 `limit`（1–20）；`read_skill` 接受 `id,path?`（默认 `SKILL.md`）、`offset?`（Unicode 字符下标）、`max_chars?`（1–10000，另受单页字节上限约束）。返回 `{id,name,path,content,total_chars,offset,truncated,next_offset}`，有 `next_offset` 时继续读取。技能文件读取限于已启用的内置或自装 Skill 文件，不受联网开关影响；模型没有安装、卸载或执行脚本工具。技能库与项目数据库独立保存。

## 部署边界

静态页面与 API 默认同源，不需要 CORS 配置。默认允许 Tauri 页面源和 Vite 的 1420 端口，其他来源通过 `SPIELBERG_ALLOWED_ORIGINS` 精确配置；未授权跨源写入会被拒绝。服务器默认绑定回环地址，局域网访问须显式设置 `SPIELBERG_BIND=0.0.0.0:8080`。接口用于单用户/可信网络的工作室，不包含账号或多租户隔离；公网部署通过反向代理提供认证与 HTTPS。

### 全能参考视频

“全能参考”继续兼容已有片段的 `video_mode: "i2v"`，实际调用视频服务 `POST /v1/generations/ref2v`。可使用 `operation: "ref2v"` 或 `video_mode: "ref2v"` 直接调用。

本地请求支持 `image_media_ids`（最多 9 张）、`reference_video_media_ids`（最多 3 个）和 `reference_audio_media_ids`（最多 3 个）。至少选择一种参考素材；音视频均可省略。后端读取素材并按顺序编码为 Base64，发送 `reference_images`、`reference_videos`、`reference_audios`，未提供的类型不发送空数组。服务配置继续使用视频 Base URL，并兼容原有 `i2v` 地址配置。

音频支持上传 MP3、WAV、M4A、AAC、OGG、FLAC，保存为 `kind: "audio"` 的项目素材。场景的共享参考音频存于 `reference_audio_media_ids`，片段的局部参考音频和视频存于 `generation_options` 对应字段中。

## 简易剪辑

- `POST /actions/editor/probe`：`{project_id, media_id}`，返回 `{duration, video, audio}`（秒及轨道存在标记）。
- `POST /actions/editor/export`：同步渲染，返回素材资源 `{id,name,path,kind,created_at}`，自动写入项目素材库。

```json
{"project_id":"项目 UUID","name":"剪辑作品","format":"mp4","ratio":"16:9","clips":[{"media_id":1,"start":0,"end":5,"speed":1,"volume":1}]}
```

`format` 支持 `mp4/mp3`；`ratio` 支持 `16:9/9:16/1:1`（默认横屏）。片段按数组顺序拼接，入点/出点为原素材秒数，速度范围 0.5–2，音量范围 0–1，单片段至少 0.05 秒；最多 100 段、输出两小时。仅接受本项目未删除的音视频素材 ID，不接受客户端文件路径。需安装 FFmpeg/FFprobe。处理失败清理本次临时文件；不修改原素材。

导出可额外传入 `audio_clips` 数组，每项为 `{media_id,start,end,speed,volume,at}`，其中 `at` 为输出时间线上的起始秒数（非负）。独立音轨按时间位置混入主轨声音，成片时长取主轨和所有音轨的最大结束时间；主轨视频不足部分补黑。分离音轨时客户端将对应主轨片段的 `volume` 设为 `0`，避免重复播放。允许 `clips: []` 且 `audio_clips` 非空；两者合计最多 100 个片段，成片最长两小时。省略 `audio_clips` 保持原有单轨导出行为。

片段 `description` 保存手工描述，`prompt` 保存局部视频提示词。视频生成优先采用非空的 `prompt`，为空时使用 `description`，再按生成方式与场景的 `shared_prompt` 组合。优化片段描述将结果写入该片段的 `prompt`。

## 项目创作配置

`PATCH /api/v1/projects/{project_id}` 支持可选的 `name`、`outline`、`agents_md`（字符串）与 `documents`、`timelines`（数组）字段。未提交的字段保持原值；提交空文本或空数组可清空对应内容，项目名称不得为空。每份文档格式为 `{ "id": "唯一标识", "title": "文档标题", "content": "正文" }`，标题不得为空，同一项目文档 ID 不得重复。`GET /api/v1/projects/{project_id}` 与项目快照的 `project` 字段返回这些配置。项目列表仅返回基本信息。

`timelines` 支持一个项目的多条时间线，每条时间线按 `entries` 数组顺序排列时间点，每个时间点包含一个或多个事件：

```json
{
  "timelines": [{
    "id": "main", "title": "故事主线", "description": "按叙事顺序整理",
    "entries": [{
      "id": "school", "time": "高三开学",
      "events": [
        {"id": "return", "content": "主角回到高中"},
        {"id": "meet", "content": "好友来到教室"}
      ]
    }]
  }]
}
```

时间线的 `title`、时间点的 `time`、事件的 `content` 必须是非空文本，`description` 是字符串且允许为空。`time` 为自由文本，可填写日期、故事年代或相对时间，不自动排序；事件顺序也按数组保留。时间线允许空 `entries`，已添加的时间点必须至少有一个事件。所有层级的 `id` 必须是非空字符串，且同级数组中不得重复。旧项目默认返回 `timelines: []`；时间线随项目数据库、备份与恢复保留。PATCH 省略 `timelines` 时保留已有时间线，传 `[]` 清空全部时间线。

Agent 的 `app_action` 还支持以下当前项目内的操作（具体字段可用 `app_describe` 查询）：

- `project/config/read`：读取名称、大纲分页、文档目录。`offset` / `max_chars` 控制大纲分页（每页 1–1500 个 Unicode 字符），`documents_offset` 控制文档目录分页（每页 10 份）；分别沿 `outline.next_offset` 和 `documents_next_offset` 继续读取。
- `project/config/update`：只更新提供的 `name` / `outline`，保留所有文档。
- `project/document/read`：提供字符串 `id`，可用 `offset` / `max_chars` 分页读取正文，直至 `next_offset` 为 null。
- `project/document/save`：省略 `id` 新建文档，必须提供非空 `title`；提供已有 `id` 更新文档，未提交的 `title` / `content` 保持原值。`content` 是完整替换正文，不是增量追加；修改前须读完全文。
- `project/document/delete`：提供当前项目文档的 `id`，只删除这一份文档。

所有操作都固定在 Agent 当前项目内；文档修改与删除在项目锁内完成，保留其他文档和大纲，不允许传入其他项目的 ID。


### Agent 时间线工具

Agent 通过 `app_action` 的 `project/config/read` 获取时间线数量，通过 `project/timelines/read` 读取完整时间线 JSON。读取接口接受 `offset` 和 `max_chars`（1–1500），需沿 `next_offset` 读取至 null，按顺序拼接 `content` 后解析 JSON；旧项目返回 `[]`。该读取操作按只读工具处理。

`project/config/update` 支持 `timelines` 完整数组，可创建、修改、删除和重排时间线、时间点、事件，结构与项目 PATCH API 相同。修改前读取全部分页，保留无关内容和已有 ID；新建项使用唯一 ID。省略字段保留原值，显式 `[]` 清空时间线。更新复用项目 API 校验，不能跨项目操作，且不会修改项目文档或 Agent 规范。
