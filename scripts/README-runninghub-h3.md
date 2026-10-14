# RunningHub MiniMax H3 HTTP adapter

This standalone Python service exposes RunningHub MiniMax H3 RH Enhanced through the HTTP contract Spielberg expects. It uses only the Python standard library and does not change Spielberg's application code.

## Start

```sh
export RUNNINGHUB_API_KEY='your-runninghub-api-key'
# Required only for image endpoints. Use the image input field IDs from the
# RunningHub API JSON exported for the H3 workflow:
export RUNNINGHUB_H3_FIRST_IMAGE_FIELD='NODE_ID##image'
export RUNNINGHUB_H3_LAST_IMAGE_FIELD='NODE_ID##image'

# Optional: protect this adapter when Spielberg calls it.
export H3_API_TOKEN='your-private-adapter-token'
# Optional: configure bind address/port (defaults: 127.0.0.1:8090).
export H3_API_BIND='127.0.0.1'
export H3_API_PORT='8090'

python3 scripts/runninghub_h3_api.py
```

Set `H3_API_BIND=0.0.0.0` only when the machine/network setup requires remote access; set `H3_API_TOKEN` and use a trusted network or reverse proxy in that case. Keep both API keys in server environment variables, not in browser/client code.

## Endpoints

Generation endpoints accept Spielberg's JSON shape and return `{"generation_id":"..."}` (HTTP 202). Spielberg then polls the matching GET endpoint until it receives a completed result with `result[0].url`. If `H3_API_TOKEN` is configured, send `Authorization: Bearer <token>` on each request; set it to the API key configured in Spielberg.

### Text to video

`POST /v1/generations/t2v`

```json
{
  "prompt": "A cinematic shot of a red train crossing a mountain bridge",
  "width": 1024,
  "height": 576,
  "frames": 245
}
```

### Image to video

`POST /v1/generations/i2v`

```json
{
  "prompt": "The subject turns toward the camera",
  "reference_images": ["<base64 image bytes from Spielberg>"],
  "width": 1024,
  "height": 576,
  "frames": 245
}
```

### First and last frame to video

`POST /v1/generations/fl2v`

```json
{
  "prompt": "Move smoothly from the first composition to the final composition",
  "start_image": "<base64 first frame>",
  "end_image": "<base64 last frame>",
  "width": 1024,
  "height": 576,
  "frames": 245
}
```

Images can be URLs or base64 strings. Base64 images are uploaded to RunningHub automatically. The image field IDs are workflow-specific, so obtain their exact values from the API JSON exported in RunningHub and set the corresponding environment variables. `i2v` uses the first image field; `fl2v` uses both fields.

### Query a task

`GET /v1/generations/{generation_id}` maps RunningHub task status to Spielberg's response format. `GET /health` returns `{"status":"ok"}`.

Example:

```sh
curl -X POST http://127.0.0.1:8090/v1/generations/t2v \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your-private-adapter-token' \
  -d '{"prompt":"A quiet ocean at sunrise","duration":5}'
```

The Authorization header is only needed when `H3_API_TOKEN` is set. In Spielberg's model settings, set video Base URL to `http://localhost:8090`; Spielberg appends the generation route itself. This adapter submits generation jobs and translates poll results for Spielberg.
