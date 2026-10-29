# ComfyUI 本地视频接口

`comfyui_video_api.py` 是独立 Python 3.10+ 脚本，仅使用标准库。针对 `http://192.168.1.10:8188` 中已安装的原生 MiniMax H3 节点和模型生成 API 工作流，保留生成的声音。无需 RunningHub 密钥。

## 启动

```bash
./scripts/start-comfyui-video.sh
# Bash 启动器支持相同参数，无需在项目目录内运行
./scripts/start-comfyui-video.sh --host 0.0.0.0 --port 8002

# 也可直接使用 Python
python3 scripts/comfyui_video_api.py
# 自定义实例、监听地址、端口
python3 scripts/comfyui_video_api.py --comfy-url http://192.168.1.10:8188 --host 0.0.0.0 --port 8002
```

默认仅监听本机。需要鉴权时设置 `COMFY_ADAPTER_TOKEN`，客户端在所有接口携带 `Authorization: Bearer <token>`。ComfyUI 下载地址仍使用实例自己的访问控制。

## 接口

| 方法 | 地址 | 作用 |
| --- | --- | --- |
| GET | `/health` | 连接检查、模式、ComfyUI 系统信息 |
| POST | `/v1/generations/t2v` | 文生视频 |
| POST | `/v1/generations/i2v` | 首帧生视频 |
| POST | `/v1/generations/l2v` | 尾帧生视频 |
| POST | `/v1/generations/fl2v` | 首尾帧生视频 |
| POST | `/v1/generations/ref2v` | 图片、视频、音频多模态参考 |
| GET | `/v1/generations/{id}` 或 `/tasks/{id}` | 查询状态及输出下载地址 |

提交返回 HTTP 202：`{"generation_id":"ComfyUI prompt_id","id":"ComfyUI prompt_id","status":"queued", ...}`。
`/v1/generations/{id}` 兼容 Spielberg：状态为 `queued`、`running`、`completed`、`failed`，视频下载地址在 `result[0].url`，失败说明在 `error`。
`/tasks/{id}` 保留原格式：成功状态为 `succeeded`，文件在 `outputs`，失败详情在 `details`。
任务直接使用 ComfyUI 队列和历史，接口服务重启后可继续查询；ComfyUI 清理历史后会返回 404。

Spielberg 视频 Base URL 填 `http://127.0.0.1:8002`（适配脚本运行在其他机器时替换为该机器地址），不要填 ComfyUI 的 `8188` 端口。

### 通用字段

- `prompt`：必填字符串。
- `width`、`height`：默认 832×480，范围 256–2048，必须为 32 的倍数。
- `duration`：默认 5 秒，范围 1–15；`frames` 显式设置时优先，范围 5–362。
- 帧数向上对齐至 H3 的 `17k+5`，固定 24 fps。响应包含实际帧数和时长；5 秒对齐为 124 帧，约 5.17 秒。
- `seed`：可选，默认随机，响应返回实际值。
- `steps`：默认 20，范围 1–100；`cfg` 默认 1，范围 0–20。
- `ref_image_size`：`match`（默认）或 `max`，后者占用更多资源。

模型训练范围约为 124–362 帧；较短片段可用于测试，但质量未保证。分辨率和参考数量影响显存与耗时。

### 图片与参考字段

素材值支持原始 base64、对应 MIME 的 base64 data URL，或已在 ComfyUI `input` 下的 `{"filename":"目录/文件名.png"}`。脚本不读取调用方本地路径，也不自动抓取外部 URL。单素材最大 80 MiB，JSON 请求体最大 128 MiB。

- i2v：`image` 或 `first_image`（也兼容 `start_image`）。
- l2v：`last_image`（也兼容 `end_image`）。
- fl2v：同时提供首帧和尾帧。
- ref2v：`reference_images` 最多 9 张，`reference_videos` 最多 3 段，`reference_audios` 最多 3 段；至少提供一种。参考顺序保持不变，不会退化为首帧模式。

参考视频应提前转为 24 fps，单段 2–15 秒；脚本使用原视频帧率，不做重采样。视频自带音轨不会自动作为声音参考，如需参考声音请显式提供 `reference_audios`。参考图片可在提示词中按顺序说明主体及其关系。

```bash
curl http://127.0.0.1:8002/v1/generations/fl2v \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"镜头缓缓推进，人物转身望向远处", "first_image":{"filename":"first.png"}, "last_image":{"filename":"last.png"}, "duration":5, "seed":42}'

curl http://127.0.0.1:8002/v1/generations/ref2v \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"参考图一中的角色走进参考图二的场景", "reference_images":[{"filename":"character.png"},{"filename":"scene.png"}], "duration":5}'

curl http://127.0.0.1:8002/tasks/返回的任务ID
```

成功时 `outputs` 内含文件信息及 `url`，可直接下载：

```python
import json, time
from urllib.request import Request, urlopen, urlretrieve
root = 'http://127.0.0.1:8002'
body = {'prompt': '人物微笑，头发随风摆动', 'image': {'filename': 'first.png'}}
with urlopen(Request(root + '/v1/generations/i2v', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})) as r:
    task = json.load(r)
while True:
    with urlopen(root + '/tasks/' + task['id']) as r:
        result = json.load(r)
    if result['status'] == 'failed':
        raise RuntimeError(result['details'])
    if result['status'] == 'succeeded':
        urlretrieve(result['outputs'][0]['url'], 'result.mp4')
        break
    time.sleep(5)
```

POST 地址附加 `?dry_run=true` 可返回工作流而不提交生成。base64 素材仍会上传，以便生成的工作流可以执行。

## 模型配置

默认模型与此次读取的实例一致，可通过环境变量替换已安装模型文件名：

| 变量 | 默认值 |
| --- | --- |
| `COMFYUI_URL` | `http://192.168.1.10:8188` |
| `COMFY_H3_MODEL` | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` |
| `COMFY_H3_REF_MODEL` | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` |
| `COMFY_H3_CLIP` | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` |
| `COMFY_H3_VAE` | `minimax_h3_video_vae_fp16.safetensors` |
| `COMFY_H3_AUDIO_VAE` | `minimax_h3_audio_vae_fp32.safetensors` |

工作流使用 res_multistep、simple scheduler、视频 sigma shift 12 / 音频 shift 3、分块视频 VAE 解码。更换模型时应同步调整适用的采样参数；不自动套用 FastH3 的 8 步配置。

## 验证

```bash
python3 -m unittest discover -s scripts/qa -p test_comfyui_video_api.py
```

已检查目标实例的节点、模型及五种模式的工作流参数，完成本地模拟 HTTP 提交/轮询、输入校验、素材上传编码与音视频解码连接测试。尚未验证真实完整出片及显存占用。
