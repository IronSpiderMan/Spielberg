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
| 场景 | `/projects/{pid}/episodes/{episode_id}/scenes` | `title`, `description?`, `first_media_id?`, `last_media_id?`, `reference_media_id?`, `generation_options?` | `/projects/{pid}/scenes/{scene_id}`，不能改变所属剧集 |
| Prompt | `/projects/{pid}/prompts` | `name`, `content?`, `category?` | 同创建字段 |

- `GET {集合}`：列表。项目、角色、剧集、场景、Prompt 返回数组；资产返回 `{items,total}`。
- `POST {集合}`：创建并返回完整资源。
- `GET {集合}/{id}`：读取单个资源。
- `PATCH {集合}/{id}`：仅更新请求中的字段，返回更新后的资源；可空引用字段传 `null` 清除。
- `DELETE {集合}/{id}`：删除并返回 `{deleted:true}`。

场景列表和创建通过剧集子资源路径访问：`GET/POST /projects/{pid}/episodes/{episode_id}/scenes`。单个场景的读取、更新和删除使用 `/projects/{pid}/scenes/{scene_id}`。

角色返回 `images`，剧集返回排序后的 `scenes` 和 `cover_media`，场景返回引用图片、`videos`、`script` 和 `generation_options`。角色、图片、场景等 ID 为项目内整数，项目 ID 为 UUID。

项目 DELETE 仅移除项目注册信息，返回额外的 `data_retained:true`，磁盘目录保留，可重新打开。资产 DELETE 使用回收站；使用中的资产拒绝删除。删除剧集会级联删除场景及其关联；删除角色不会删除资产文件。

资产列表支持 `page`（默认 1）、`limit`（默认 24，上限 60）、`kind`（`all/image/video`）、`query`、`usage`（`all/used/unused/trash`）。兼容首版平级资源路径，例如 `/roles?project_id={pid}` 和 `/scenes?project_id={pid}&episode_id={episode_id}`；前端使用上表的嵌套路径。

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
| `prompts/optimize` | `project_id, prompt, kind, image_media_ids` |
| `settings` | `project_id, settings` |
| `tasks` | `status?, limit?, before?, through?`，返回 `{items,next_cursor,has_more}` |
| `storage/scan` | `project_id` |
| `storage/cleanup` | `project_id, files, clear_cache` |

`GET /api/v1/health` 返回服务状态和 API 版本。原来的 `/api` RPC 包装路由和 Tauri 业务 IPC 不再提供。

## 部署边界

静态页面与 API 默认同源，不需要 CORS 配置。默认允许 Tauri 页面源和 Vite 的 1420 端口，其他来源通过 `SPIELBERG_ALLOWED_ORIGINS` 精确配置；未授权跨源写入会被拒绝。服务器默认绑定回环地址，局域网访问须显式设置 `SPIELBERG_BIND=0.0.0.0:8080`。接口用于单用户/可信网络的工作室，不包含账号或多租户隔离；公网部署通过反向代理提供认证与 HTTPS。
