#!/usr/bin/env python3
"""Standalone HTTP adapter for RunningHub MiniMax H3 RH Enhanced video APIs.

Run with RUNNINGHUB_API_KEY set, then POST to /v1/generations/{t2v|i2v|fl2v}.
This module uses only the Python standard library.
"""

from __future__ import annotations

import json
import math
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_ROOT = "https://www.runninghub.cn/openapi/v2/rhart-video/minimax-h3-rh-enhanced"
QUERY_URL = "https://www.runninghub.cn/openapi/v2/query"
UPLOAD_URL = "https://www.runninghub.cn/openapi/v2/media/upload/binary"
TASK_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


class ApiError(Exception):
    def __init__(self, status: int, message: str, details: Any = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.details = details


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ApiError(503, f"服务端未配置 {name}")
    return value


def _json_request(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    api_key = _required_env("RUNNINGHUB_API_KEY")
    request = Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=90) as response:
            raw = response.read().decode("utf-8")
            status = response.status
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            details = json.loads(raw)
        except json.JSONDecodeError:
            details = raw[:2000]
        raise ApiError(exc.code, "RunningHub 请求失败", details) from exc
    except URLError as exc:
        raise ApiError(502, f"无法连接 RunningHub：{exc.reason}") from exc
    try:
        result = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApiError(502, "RunningHub 返回了非 JSON 响应", raw[:1000]) from exc
    if status >= 400:
        raise ApiError(status, "RunningHub 请求失败", result)
    if not isinstance(result, dict):
        raise ApiError(502, "RunningHub 返回格式异常", result)
    return result


def _image_url(value: Any, label: str) -> str:
    """Accept Spielberg's base64 field or a URL, upload base64 to RunningHub."""
    if not isinstance(value, str) or not value.strip():
        raise ApiError(400, f"{label} 必填")
    value = value.strip()
    if value.startswith(("https://", "http://")):
        return value

    mime = "image/png"
    encoded = value
    match = re.fullmatch(r"data:(image/[A-Za-z0-9.+-]+);base64,(.+)", value, re.DOTALL)
    if match:
        mime, encoded = match.groups()
    try:
        import base64
        image_bytes = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise ApiError(400, f"{label} 必须是图片 URL 或 base64 图片") from exc
    if len(image_bytes) > 10 * 1024 * 1024:
        raise ApiError(413, f"{label} 超过 RunningHub 10 MB 上传限制")

    extension = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp"}.get(mime, "png")
    boundary = "----SpielbergH3" + os.urandom(12).hex()
    filename = f"input.{extension}"
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + image_bytes + f"\r\n--{boundary}--\r\n".encode()
    request = Request(UPLOAD_URL, data=body, headers={
        "Authorization": f"Bearer {_required_env('RUNNINGHUB_API_KEY')}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Accept": "application/json",
    }, method="POST")
    try:
        with urlopen(request, timeout=90) as response:
            uploaded = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise ApiError(exc.code, "RunningHub 图片上传失败", exc.read().decode("utf-8", errors="replace")[:2000]) from exc
    except (URLError, json.JSONDecodeError) as exc:
        raise ApiError(502, f"RunningHub 图片上传失败：{exc}") from exc
    url = uploaded.get("data", {}).get("download_url") if isinstance(uploaded, dict) else None
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ApiError(502, "RunningHub 图片上传未返回 download_url", uploaded)
    return url


def _image_field(env_name: str, image: Any, label: str) -> tuple[str, str]:
    field = _required_env(env_name)
    if not field.endswith("##image"):
        raise ApiError(500, f"{env_name} 应为 <nodeId>##image 格式")
    return field, _image_url(image, label)


def generate(mode: str, data: dict[str, Any]) -> dict[str, Any]:
    prompt = data.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ApiError(400, "prompt 必须是非空字符串")

    width, height = data.get("width", 1024), data.get("height", 576)
    if any(isinstance(x, bool) or not isinstance(x, int) or not 256 <= x <= 2048 for x in (width, height)):
        raise ApiError(400, "width 和 height 必须是 256 到 2048 的整数")
    duration = data.get("duration")
    frames = data.get("frames", 125)
    if duration is not None:
        if isinstance(duration, bool) or not isinstance(duration, int) or duration < 1:
            raise ApiError(400, "duration 必须是正整数")
        frames = ((duration * 24 - 5 + 16) // 17) * 17 + 5
    if isinstance(frames, bool) or not isinstance(frames, int) or frames < 1:
        raise ApiError(400, "frames 必须是正整数")
    aspect_ratio = data.get("aspect_ratio")
    if aspect_ratio is None:
        divisor = math.gcd(width, height)
        aspect_ratio = f"{width // divisor}:{height // divisor}"
    if not isinstance(aspect_ratio, str):
        raise ApiError(400, "aspect_ratio 必须是字符串")
    # RH Enhanced exposes a fixed duration selector; Spielberg sends frame count.
    duration_seconds = duration if duration is not None else max(1, round((frames - 5) / 24))
    resolution = data.get("resolution", "768p")
    if not isinstance(resolution, str) or resolution not in {"480p", "768p", "1080p"}:
        raise ApiError(400, "resolution 支持 480p、768p、1080p")

    # Field IDs below are from RunningHub's published RH Enhanced model API.
    payload: dict[str, Any] = {
        "84##value": prompt.strip(),
        "73##aspect_ratio": aspect_ratio,
        "73##megapixels": resolution,
        "74##value": duration_seconds,
        "225##value": "native",
    }

    if mode in {"i2v", "fl2v"}:
        reference_images = data.get("reference_images")
        if reference_images is not None:
            if not isinstance(reference_images, list) or not reference_images:
                raise ApiError(400, "reference_images 必须是非空数组")
            image_value = reference_images[0]
        else:
            image_value = data.get("image", data.get("first_image", data.get("start_image", data.get("first_frame_url"))))
        field, image_url = _image_field(
            "RUNNINGHUB_H3_FIRST_IMAGE_FIELD", image_value, "image / first_frame_url"
        )
        payload[field] = image_url
    if mode == "fl2v":
        field, image_url = _image_field(
            "RUNNINGHUB_H3_LAST_IMAGE_FIELD", data.get("end_image", data.get("last_frame_url")), "last_image_url"
        )
        payload[field] = image_url

    endpoint = "t2va" if mode == "t2v" else "i2va"
    result = _json_request(f"{API_ROOT}/{endpoint}", payload)
    task_id = result.get("taskId")
    if not isinstance(task_id, str) or not TASK_ID_RE.fullmatch(task_id):
        raise ApiError(502, "RunningHub 未返回有效 taskId", result)
    return {"generation_id": task_id}


def query_task(task_id: str) -> dict[str, Any]:
    if not TASK_ID_RE.fullmatch(task_id):
        raise ApiError(400, "task_id 格式无效")
    result = _json_request(QUERY_URL, {"taskId": task_id})
    status = result.get("status")
    if status == "SUCCESS":
        results = result.get("results") or []
        urls = [item.get("url") for item in results if isinstance(item, dict) and isinstance(item.get("url"), str)]
        return {"generation_id": task_id, "status": "completed", "result": [{"url": url} for url in urls]}
    if status in {"FAILED", "ERROR", "CANCELLED"}:
        return {"generation_id": task_id, "status": "failed", "error": result.get("errorMessage") or status}
    return {"generation_id": task_id, "status": "running"}


class Handler(BaseHTTPRequestHandler):
    server_version = "SpielbergH3Adapter/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        # Avoid logging prompt text or image URLs from request bodies.
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    def _send_json(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def _authorize(self) -> bool:
        token = os.environ.get("H3_API_TOKEN", "").strip()
        if not token:
            return True
        if self.headers.get("Authorization") == f"Bearer {token}":
            return True
        self._send_json(401, {"error": "unauthorized"})
        return False

    def do_GET(self) -> None:
        if not self._authorize():
            return
        if self.path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        match = re.fullmatch(r"/v1/generations/([^/?]+)", self.path) or re.fullmatch(r"/tasks/([^/?]+)", self.path)
        if match:
            try:
                self._send_json(200, query_task(match.group(1)))
            except ApiError as exc:
                body: dict[str, Any] = {"error": exc.message}
                if exc.details is not None:
                    body["details"] = exc.details
                self._send_json(exc.status, body)
            return
        self._send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if not self._authorize():
            return
        match = re.fullmatch(r"/v1/generations/(t2v|i2v|fl2v)", self.path)
        mode = match.group(1) if match else self.path.lstrip("/")
        if mode not in {"t2v", "i2v", "fl2v"}:
            self._send_json(404, {"error": "not_found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 16 * 1024 * 1024:
                raise ApiError(413 if size > 16 * 1024 * 1024 else 400, "JSON 请求体大小无效")
            raw = self.rfile.read(size)
            try:
                data = json.loads(raw)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ApiError(400, "请求体必须是 UTF-8 JSON") from exc
            if not isinstance(data, dict):
                raise ApiError(400, "JSON 请求体必须是对象")
            result = generate(mode, data)
            self._send_json(202, result)
        except ApiError as exc:
            body = {"error": exc.message}
            if exc.details is not None:
                body["details"] = exc.details
            self._send_json(exc.status, body)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    host = os.environ.get("H3_API_BIND", "127.0.0.1")
    port = int(os.environ.get("H3_API_PORT", "8090"))
    server = Server((host, port), Handler)
    print(f"MiniMax H3 HTTP adapter listening at http://{host}:{port}")
    print("Endpoints: POST /v1/generations/{t2v|i2v|fl2v}; GET /v1/generations/{generation_id}, /health")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
