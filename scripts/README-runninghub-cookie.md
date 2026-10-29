# RunningHub 浏览器登录态 → Spielberg FastAPI

这是独立的 **Cookie 版** 服务，与 `runninghub_h3_api.py` 的 OpenAPI Key 版不同。
使用 RunningHub 网页已有登录态，不需要购买或填写 OpenAPI Key。

## 启动

在 Spielberg 项目根目录执行：

```sh
./scripts/start-runninghub.sh
# 自定义端口：
./scripts/start-runninghub.sh --port 8091
```

脚本自动创建 `.venv-runninghub`，缺少依赖时自动安装，默认监听 `127.0.0.1:8090`，
前台运行，按 Ctrl+C 停止。支持从任意目录调用；环境变量配置继续生效。
`RUNNINGHUB_VENV_DIR` 可覆盖虚拟环境目录。首次安装依赖需要联网。

也可手动准备环境并启动：

```sh
python3 -m venv .venv-runninghub
.venv-runninghub/bin/python -m pip install -r scripts/requirements-runninghub.txt

export RUNNINGHUB_CANVAS_ID=2105284694684114946
# 可选：只允许上游即时返回 totalPrice=0 的任务；非零或缺失报价直接拒绝。
export RUNNINGHUB_REQUIRE_FREE=1
.venv-runninghub/bin/python scripts/runninghub_cookie_api.py --port 8090
```

当前浏览器登录态已导入 `.runninghub/session.json`，文件权限 `0600`，目录已加入 `.gitignore`。
这是**登录态快照**，服务每次请求重新读取文件；不会持续控制 Chrome，也不会自动续期登录。
Cookie 失效后重新导入即可，无需重启服务。

- Swagger：<http://127.0.0.1:8090/docs>
- 健康检查：`GET /health`（仅说明服务在线，不代表上游登录态有效）
- 模型与参数：`GET /v1/models`（实时查询，缓存 5 分钟）

Spielberg「模型与接口」的视频 Base URL 填 **`http://127.0.0.1:8090`**，API Key 可留空。
如果设置了 `H3_API_TOKEN`，则把它填到 Spielberg 的 API Key 中；它是本地服务口令，不是 RunningHub Key。
默认只监听本机；指定非本机 `--host` 必须同时设置 `H3_API_TOKEN`。

## 四种操作

| 操作 | 本地 POST 路径 | 图片输入 | RunningHub subType |
|---|---|---|---|
| 文生视频 | `/v1/generations/t2v` | 无 | `text-video` |
| 全能参考 | `/v1/generations/ref2v`（兼容 `/i2v`） | `reference_images`（最多 9 张） | `multimodal-video` |
| 首帧 | `/v1/generations/first` | `image` 或 `start_image` | `start-video` |
| 首尾帧 | `/v1/generations/fl2v` | `start_image` 和 `end_image` | `start-end-video` |

`i2v` 默认明确表示**全能参考**。需要让 Spielberg 的现有 `i2v` 按首帧执行时，启动前设置：

```sh
export RUNNINGHUB_I2V_MODE=first
```

直接调用 API 时，也可在 `i2v` 请求里传 `"mode":"first"` 或 `"mode":"reference"` 覆盖该默认值。
Spielberg 的新全能参考接口使用 `/ref2v`，该路由始终使用参考模型，不受 `RUNNINGHUB_I2V_MODE` 影响，也不接受 `mode` 覆盖。
`first_frame_url` / `last_frame_url` 是 `start_image` / `end_image` 的别名。

兼容 Spielberg 的实际路由：只选择首帧时，它仍调用 `/fl2v` 并仅发送 `start_image`；
服务自动改用首帧模型。两张都提供时使用首尾帧模型。仅 `end_image` 不会被偷偷当成首帧：
H3 没有仅尾帧模式，此时需要同时选择首帧，或在 Spielberg 中把该图片设为首帧。

图片支持 HTTP(S) URL、纯 Base64、`data:image/png;base64,...`，Base64 内容支持 PNG/JPEG/WebP，单张最多 100 MiB。
上传走网页同款对象存储协议，素材获得可访问 URL；不要把私密素材 URL 分享给无关人员。
全能参考支持 `reference_audios`（最多 3 个 URL、纯 Base64 或 `data:audio/...;base64,...`），
Base64 支持 MP3、WAV、AAC、FLAC、OGG、M4A，单个最多 100 MiB。
兼容原来的 `audio_urls`（最多 3 个 HTTP(S) URL，首帧和首尾帧也可使用），但不能和 `reference_audios` 同时提供。
至少提供一种参考素材。`reference_videos` 最多 3 个，支持 URL、MP4/WebM Base64；
只有模型配置包含相应 `refVideo` 字段时才会发送。当前已采集的 H3 配置没有参考视频字段，
提供视频会在上传和提交前返回 HTTP 422，提示模型不支持参考视频。

公共字段：

| 字段 | 说明 |
|---|---|
| `prompt` | 最多 20,000 字符；t2v 必填 |
| `duration` | 4–15 秒整数；默认 5 秒 |
| `frames` | 兼容 Spielberg 的帧数，换算为时长；显式 duration 优先 |
| `width`, `height` | 默认 1024×576，用于推导比例，不指定精确输出像素 |
| `aspect_ratio` | `1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`9:16`、`16:9`、`21:9`、`auto` |
| `resolution` | 默认 `768p`；app 变体支持 `480p` / `768p` |
| `audio_mode` | 默认 `native`；也支持 `lock_source`、`remix_source`、`reference_only` |

Spielberg 当前会把部分比例转换成经过 32 像素对齐的尺寸，例如 `480×832`；服务会识别接近的标准比例。
Spielberg 原先把 `2:3` 和 `9:16` 发成同一组尺寸，适配器无法从尺寸还原二者区别；需要精确比例时直接传 `aspect_ratio`。
精确分辨率也应通过 `resolution` 指定。

## 请求示例

```sh
curl http://127.0.0.1:8090/v1/generations/t2v \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"橙色小球在深蓝背景前缓慢向右移动，固定镜头","duration":4,"resolution":"480p"}'
```

```json
{
  "prompt": "镜头缓缓拉近，保持人物和场景一致",
  "image": "<图片 Base64 或 URL>",
  "duration": 5,
  "resolution": "768p"
}
```

上面的图片请求可 POST 到 `/ref2v` 或 `/i2v`（全能参考），也可 POST 到 `/first`（首帧）。
Spielberg 的全能参考请求示例（音频可省略，也可以只提供音频）：

```json
{
  "prompt": "保持参考人物一致，按照参考音频生成对白",
  "reference_images": ["<图片 Base64 或 URL>"],
  "reference_audios": ["<音频 Base64 或 URL>"],
  "duration": 5
}
```

首尾帧示例：

```json
{
  "prompt": "从首帧自然过渡到尾帧",
  "start_image": "<首帧 Base64 或 URL>",
  "end_image": "<尾帧 Base64 或 URL>",
  "duration": 5
}
```

提交成功返回 HTTP 202：

```json
{"generation_id":"2105312676044087298"}
```

使用 `GET /v1/generations/{generation_id}` 轮询：

```json
{
  "generation_id": "2105312676044087298",
  "status": "completed",
  "upstream_status": "SUCCESS",
  "result": [{"url": "https://.../video.mp4"}]
}
```

执行中为 `running`；失败、取消或结束后没有有效视频为 `failed`，附 `error`。
任务 ID 就是上游 ID，重启服务后仍可查询，无需保留内存队列。

## 不生成视频的检查接口

- `POST /v1/preview/{t2v|ref2v|i2v|first|fl2v}`：同样的请求体，返回实际画布请求结构；不上传、不生成，Base64 替换为占位符。
- `POST /v1/estimate/{t2v|ref2v|i2v|first|fl2v}`：同样的请求体，返回当前报价；素材需使用 URL，不会自动上传。

`RUNNINGHUB_REQUIRE_FREE=1` 在真实提交前重新检查报价。报价与扣费之间仍由 RunningHub 决定，这不是平台计费承诺。
服务不自动重试生成请求；提交超时时结果可能不确定，先查看网页历史，避免重复生成。

## Cookie 更新

在已登录的 RunningHub 页面打开 Chrome DevTools → Network，保留该站点的一次成功请求。
Settings → Preferences → Network → 勾选 `Allow to generate HAR with sensitive data`，
导出 `Export HAR (with sensitive data)` 到本机临时文件，再执行：

```sh
.venv-runninghub/bin/python scripts/runninghub_cookie_api.py --import-har /path/to/capture.har
```

导入器仅提取发往 **`www.runninghub.cn`** 的 Cookie、Authorization、User-Agent、团队 ID，
不复制其他站点凭证或完整抓包。导入后请恢复 DevTools 的脱敏选项并移除临时 HAR。
不要把含敏感数据的 HAR 或 session 文件提交到 Git、上传、粘贴到聊天中。

也可通过服务端环境变量配置：

- `RUNNINGHUB_COOKIE`：浏览器该站点的 Cookie Header，服务提取 `Rh-Accesstoken` 并 URL 解码。
- `RUNNINGHUB_ACCESS_TOKEN`：可选，显式覆盖访问令牌。
- `RUNNINGHUB_SESSION_FILE`：替换默认 session 文件路径。
- `RUNNINGHUB_TEAM_ID`：仅团队画布需要；个人画布不设置。
- `RUNNINGHUB_H3_VARIANT=app`：默认，与本次浏览器请求一致。
- `RUNNINGHUB_H3_VARIANT=standard`：显式选择非 app 模型，可支持 `1080p`，权限和价格以平台响应为准。

认证信息只发送到固定的 RunningHub API 主机，不跟随重定向。上传使用该 API 返回的短期对象存储凭证。
服务不会把 Cookie、上传密钥、Base64 原图或上游原始错误响应返回给调用方。

## 已确认的网页接口

来源：当前页面实际加载的 [index-B2CPX5Ij.js](https://rhtv.runninghub.cn/project/assets/index-B2CPX5Ij.js)、
Chrome 中捕获的 `/canvas/task/run` 请求、登录态下实时返回的模型配置与已有任务结果。

所有路径的基础地址均为 `https://www.runninghub.cn`：

| 方法和路径 | 用途 |
|---|---|
| `POST /canvas/model/list` | `types` 使用 `TEXT_VIDEO`、`MULTIMODAL_VIDEO`、`START_VIDEO`、`START_END_VIDEO` |
| `POST /canvas/task/run` | 提交 `{canvasId,targetType:"NODE",targetId,canvas:{nodes,edges},name}` |
| `POST /canvas/task/batchStatus` | `{taskIds:[...],includeResults:true}`，视频在 `data.tasks[].plans[].outputs[]` |
| `POST /canvas/price/calculate` | `{skuId,priceFactors:[{type,fieldKey,fieldValue}]}` |
| `POST /api/storage/getCredentials` | `{scene:"canvas"}`，获取 S3 兼容上传凭证 |

网页请求头：`Authorization: Bearer <Rh-Accesstoken>`、Cookie、`version:1.0.0`、
`X-RH-Lang:zh`、`User-Language:zh_CN`、Origin、Referer；团队请求还有 `X-Team-Id`。

默认 app 模型代码：

```text
t2v:   text-video-rhart-video-minimax-h3-rh-enhanced-t2va-app
i2v:   multimodal-video-rhart-video-minimax-h3-rh-enhanced-ref2va-app
first: start-video-rhart-video-minimax-h3-rh-enhanced-i2va-app
fl2v:  start-end-video-rhart-video-minimax-h3-rh-enhanced-i2va-app
```

`rh-video` 节点的 `data.params` 使用通用字段 `prompt,aspectRatio,resolution,duration,audioMode`。
全能参考图片分别是 `refImage1`…`refImage9`，首帧是 `firstFrameUrl`，尾帧是 `lastFrameUrl`。
与旧脚本中的 OpenAPI `84##value` 等节点字段不是同一套接口。
每次调用创建唯一任务节点 ID，不复用浏览器中已有的视频节点。

上传与网页一致：`<Rh-Identify>/uploads/<图片MD5>.<后缀>`，S3 `PutObject`，ACL `public-read`。
Cookie 不含 Rh-Identify 时，使用 JWT 的 **username** 字段，不能误用 sub（用户数字 ID）。

这是网页内部接口，平台更新后可能变化；不要把这里的接口当成官方稳定 SDK。

## 测试

2026-09-30 已使用本机浏览器登录态完成四种模式的真实端到端测试：
文生视频、全能参考、首帧、首尾帧均返回 `completed` 和视频 URL。
图片模式使用程序生成的测试图片，实际验证了 Base64 → 对象存储上传 → 提交 → 轮询链路。
每次提交前的报价均为 0，使用 4 秒、480p；测试结果保存在本机 `.runninghub/verification.json`（不入 Git）。
离线协议测试 23 项通过。

```sh
.venv-runninghub/bin/python -m pip install pytest
.venv-runninghub/bin/python -m pytest scripts/qa/test_runninghub_cookie_api.py -q
```

离线测试覆盖四种模型与图片字段映射、Spielberg 帧数换算、错误参数、Cookie 导入隔离、
上传协议、真实任务结果格式、登录态过期、本地授权、零报价提交保护。不会调用线上生成。
`qa/fixtures/runninghub-h3-models.json` 是这次读到的非敏感模型配置，用于协议回归。
