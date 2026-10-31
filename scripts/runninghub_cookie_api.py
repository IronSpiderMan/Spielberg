#!/usr/bin/env python3
"""RunningHub canvas MiniMax H3 adapter. See README-runninghub-cookie.md.

Browser protocol verified against index-B2CPX5Ij.js and live canvas requests.
No OpenAPI key is used. Credentials are read locally and never returned.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import math
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, Literal
from urllib.parse import unquote, urlparse

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

ROOT = Path(__file__).resolve().parents[1]
API = "https://www.runninghub.cn"
ORIGIN = "https://rhtv.runninghub.cn"
SESSION = ROOT / ".runninghub/session.json"
MODES = {
    "t2v": ("text-video", "t2va"),
    "i2v": ("multimodal-video", "ref2va"),
    "ref2v": ("multimodal-video", "ref2va"),
    "first": ("start-video", "i2va"),
    "fl2v": ("start-end-video", "i2va"),
}
RATIOS = {"1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"}
MAX_IMAGE = 100 * 1024 * 1024


class Generation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(default="", max_length=20000)
    width: int = Field(default=1024, ge=64, le=8192, strict=True)
    height: int = Field(default=576, ge=64, le=8192, strict=True)
    frames: int | None = Field(default=None, ge=1, le=1000, strict=True)
    duration: int | None = Field(default=None, ge=4, le=15, strict=True)
    aspect_ratio: str | None = None
    resolution: Literal["480p", "768p", "1080p"] = "768p"
    audio_mode: Literal["native", "lock_source", "remix_source", "reference_only"] = "native"
    image: str | None = None
    reference_images: list[str] = Field(default_factory=list, max_length=9)
    reference_videos: list[str] = Field(default_factory=list, max_length=3)
    reference_audios: list[str] = Field(default_factory=list, max_length=3)
    start_image: str | None = None
    end_image: str | None = None
    first_frame_url: str | None = None
    last_frame_url: str | None = None
    audio_urls: list[str] = Field(default_factory=list, max_length=3)
    # Spielberg can keep its i2v route while selecting first-frame behavior.
    mode: Literal["reference", "first"] | None = None

    @model_validator(mode="after")
    def normalized(self):
        if self.duration is None:
            self.duration = 5 if self.frames is None else round((self.frames - 5) / 24)
        if not 4 <= self.duration <= 15:
            raise ValueError("H3 时长为 4–15 秒；请调整 duration 或 Spielberg 的 frames")
        if self.aspect_ratio == "auto":
            self.aspect_ratio = None
        elif self.aspect_ratio is None:
            divisor = math.gcd(self.width, self.height)
            self.aspect_ratio = f"{self.width // divisor}:{self.height // divisor}"
            if self.aspect_ratio not in RATIOS:
                ratio = self.width / self.height
                nearest = min(RATIOS, key=lambda r: abs(math.log(ratio / (int(r.split(':')[0]) / int(r.split(':')[1])))))
                a, b = map(int, nearest.split(":"))
                if abs(ratio / (a / b) - 1) < 0.04:
                    self.aspect_ratio = nearest
        if self.aspect_ratio is not None and self.aspect_ratio not in RATIOS:
            raise ValueError("不支持的画面比例；请显式传 aspect_ratio 或 auto")
        if self.start_image and self.first_frame_url and self.start_image != self.first_frame_url:
            raise ValueError("start_image 与 first_frame_url 冲突")
        if self.end_image and self.last_frame_url and self.end_image != self.last_frame_url:
            raise ValueError("end_image 与 last_frame_url 冲突")
        for url in self.audio_urls:
            media_url(url)
        if self.audio_urls and self.reference_audios:
            raise ValueError("audio_urls 与 reference_audios 只能提供一个")
        return self


def media_url(value: str) -> str:
    p = urlparse(value)
    if p.scheme not in {"https", "http"} or not p.hostname or p.username or p.password:
        raise ValueError("素材 URL 必须是无用户名密码的 HTTP(S) URL")
    return value


def read_session() -> dict[str, str]:
    path = Path(os.environ.get("RUNNINGHUB_SESSION_FILE", str(SESSION)))
    try:
        saved = json.loads(path.read_text()) if path.exists() else {}
    except (OSError, ValueError):
        raise HTTPException(503, "无法读取 RunningHub session 文件") from None
    cookie = os.environ.get("RUNNINGHUB_COOKIE", saved.get("cookie", "")).strip()
    token = os.environ.get("RUNNINGHUB_ACCESS_TOKEN", "").strip()
    if not token and cookie:
        jar = SimpleCookie()
        try:
            jar.load(cookie)
            token = unquote(jar["Rh-Accesstoken"].value) if "Rh-Accesstoken" in jar else ""
        except Exception:
            raise HTTPException(503, "RUNNINGHUB_COOKIE 格式无效") from None
    if not token:
        token = str(saved.get("authorization", "")).removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(503, "请导入浏览器 HAR 登录态或设置 RUNNINGHUB_COOKIE")
    if any(c in token + cookie for c in "\r\n"):
        raise HTTPException(503, "登录态包含无效字符")
    result = {"authorization": f"Bearer {token}", "cookie": cookie}
    if saved.get("user-agent"):
        result["user-agent"] = saved["user-agent"]
    team = os.environ.get("RUNNINGHUB_TEAM_ID", saved.get("x-team-id", ""))
    if team:
        result["x-team-id"] = team
    return result


def import_har(source: Path, destination: Path = SESSION) -> None:
    """Only import headers destined for the exact RunningHub API host."""
    entries = json.loads(source.read_text())["log"]["entries"]
    session: dict[str, str] = {}
    for entry in entries:
        request = entry["request"]
        if urlparse(request["url"]).hostname != "www.runninghub.cn":
            continue
        headers = {h["name"].lower(): h["value"] for h in request.get("headers", [])}
        if not headers.get("authorization"):
            continue
        session = {k: v for k, v in headers.items()
                   if k in {"authorization", "cookie", "user-agent", "x-team-id"}}
    if not session.get("authorization"):
        raise ValueError("HAR 不含认证信息；请导出 with sensitive data 版本")
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(session, stream)


def image_bytes(value: str) -> tuple[bytes, str, str]:
    encoded = value
    if value.startswith("data:"):
        match = re.fullmatch(r"data:image/[\w.+-]+;base64,(.*)", value, re.DOTALL)
        if not match:
            raise HTTPException(422, "图片必须是 base64 data URL")
        encoded = match[1]
    if len(encoded) > (MAX_IMAGE + 2) // 3 * 4:
        raise HTTPException(413, "单张图片超过 100 MiB")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(422, "图片不是有效的 base64") from None
    if not raw or len(raw) > MAX_IMAGE:
        raise HTTPException(413, "图片为空或超过 100 MiB")
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return raw, "image/png", "png"
    if raw.startswith(b"\xff\xd8\xff"):
        return raw, "image/jpeg", "jpg"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return raw, "image/webp", "webp"
    raise HTTPException(422, "图片内容必须是 PNG、JPEG 或 WebP")


def reference_bytes(value: str, kind: str) -> tuple[bytes, str, str]:
    if kind == "image":
        return image_bytes(value)
    encoded = value
    if value.startswith("data:"):
        match = re.fullmatch(rf"data:{kind}/[\w.+-]+;base64,(.*)", value, re.DOTALL)
        if not match:
            raise HTTPException(422, f"{kind} 素材必须是对应类型的 base64 data URL")
        encoded = match[1]
    if len(encoded) > (MAX_IMAGE + 2) // 3 * 4:
        raise HTTPException(413, "单个参考素材超过 100 MiB")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(422, "参考素材不是有效的 base64") from None
    if not raw or len(raw) > MAX_IMAGE:
        raise HTTPException(413, "参考素材为空或超过 100 MiB")
    if kind == "audio":
        if raw.startswith(b"RIFF") and raw[8:12] == b"WAVE":
            return raw, "audio/wav", "wav"
        if len(raw) > 1 and raw[0] == 0xff and raw[1] & 0xf6 == 0xf0:
            return raw, "audio/aac", "aac"
        if raw.startswith(b"ID3") or (len(raw) > 1 and raw[0] == 0xff and raw[1] & 0xe0 == 0xe0):
            return raw, "audio/mpeg", "mp3"
        if raw.startswith(b"fLaC"):
            return raw, "audio/flac", "flac"
        if raw.startswith(b"OggS"):
            return raw, "audio/ogg", "ogg"
        if raw[4:8] == b"ftyp":
            return raw, "audio/mp4", "m4a"
    elif kind == "video":
        if raw[4:8] == b"ftyp":
            return raw, "video/mp4", "mp4"
        if raw.startswith(b"\x1a\x45\xdf\xa3"):
            return raw, "video/webm", "webm"
    raise HTTPException(422, f"不支持的 {kind} 参考素材格式")


class RunningHub:
    def __init__(self, client: httpx.AsyncClient):
        self.client = client
        self.catalog: list[dict] = []
        self.catalog_at = 0.0

    async def post(self, path: str, body: dict) -> Any:
        headers = read_session()
        headers.update({"Origin": ORIGIN, "Referer": ORIGIN + "/", "version": "1.0.0",
                        "X-RH-Lang": "zh", "User-Language": "zh_CN"})
        if headers.get("x-team-id") and path == "/canvas/task/run":
            body = {**body, "teamId": headers["x-team-id"]}
        try:
            response = await self.client.post(API + path, json=body, headers=headers)
        except httpx.TimeoutException:
            raise HTTPException(504, "RunningHub 请求超时；提交结果可能不确定，请先查看网页历史，勿盲目重试") from None
        except httpx.HTTPError:
            raise HTTPException(502, "无法连接 RunningHub") from None
        if response.status_code in {401, 403, 412}:
            raise HTTPException(401, "RunningHub 登录态已失效或无权限，请重新导入浏览器登录态")
        if response.status_code == 429:
            raise HTTPException(429, "RunningHub 限流或并发已满")
        if not response.is_success:
            raise HTTPException(502, f"RunningHub HTTP {response.status_code}")
        try:
            result = response.json()
        except ValueError:
            raise HTTPException(502, "RunningHub 返回非 JSON 响应") from None
        if not isinstance(result, dict) or "code" not in result:
            raise HTTPException(502, "RunningHub 响应结构发生变化")
        if str(result["code"]) != "0":
            code = str(result["code"])
            # Do not echo arbitrary upstream bodies or tokens to the caller.
            if code in {"401", "403", "412"} or result.get("msg") == "TOKEN_INVALID":
                raise HTTPException(401, "RunningHub 登录态失效，请重新导入")
            raise HTTPException(502, f"RunningHub 拒绝请求，业务码 {code}；请检查模型权限、余额和参数")
        return result.get("data")

    async def models(self) -> list[dict]:
        if not self.catalog or time.monotonic() - self.catalog_at > 300:
            groups = await self.post("/canvas/model/list", {
                "types": list(dict.fromkeys(x[0].upper().replace("-", "_") for x in MODES.values()))})
            if not isinstance(groups, list):
                raise HTTPException(502, "模型列表结构异常")
            models = [dict(m, mode=g["type"].lower().replace("_", "-"))
                      for g in groups for m in g.get("modelList", [])
                      if "rhart-video-minimax-h3-rh-enhanced-" in m.get("modelCode", "")]
            if not models:
                raise HTTPException(503, "当前账号未返回 H3 RH Enhanced 模型")
            self.catalog, self.catalog_at = models, time.monotonic()
        return self.catalog

    async def model(self, mode: str, request: Generation) -> dict:
        variant = os.environ.get("RUNNINGHUB_H3_VARIANT", "app")
        if variant not in {"app", "standard"}:
            raise HTTPException(503, "RUNNINGHUB_H3_VARIANT 必须为 app 或 standard")
        subtype, suffix = MODES[mode]
        code = f"{subtype}-rhart-video-minimax-h3-rh-enhanced-{suffix}"
        if variant == "app":
            code += "-app"
        model = next((m for m in await self.models() if m["modelCode"] == code), None)
        if not model or not model.get("available", False):
            raise HTTPException(503, "当前账号无法使用所选 H3 模型")
        config = {c["paramName"]: c for c in model["config"] if c.get("paramName")}
        options = [o["value"] for o in config["resolution"]["optionValue"]]
        if request.resolution not in options:
            raise HTTPException(422, f"当前模型支持的分辨率为 {options}")
        return model

    async def upload(self, value: str, kind: str = "image") -> str:
        if value.startswith(("https://", "http://")):
            try:
                return media_url(value)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None
        raw, mime, extension = reference_bytes(value, kind)
        credential = await self.post("/api/storage/getCredentials", {"scene": "canvas"})
        if not isinstance(credential, dict) or not all(credential.get(k) for k in
                ("accessKey", "secretKey", "bucket", "region", "endpoint", "cdnDomain")):
            raise HTTPException(502, "图片上传凭证不完整")
        session = read_session()
        jar = SimpleCookie(); jar.load(session.get("cookie", ""))
        identify = unquote(jar["Rh-Identify"].value) if "Rh-Identify" in jar else ""
        if not identify:
            try:
                token = session["authorization"].split(" ", 1)[1].split(".")[1]
                identify = str(json.loads(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)))["username"])
            except (ValueError, KeyError, IndexError):
                raise HTTPException(503, "登录态缺少 Rh-Identify") from None
        if not re.fullmatch(r"[A-Za-z0-9_-]+", identify):
            raise HTTPException(503, "Rh-Identify 格式异常")
        key = f"{identify}/uploads/{hashlib.md5(raw).hexdigest()}.{extension}"

        def put():
            import boto3
            from botocore.config import Config
            endpoint = credential["endpoint"]
            if not endpoint.startswith("https://"):
                raise HTTPException(502, "上传端点必须使用 HTTPS")
            s3 = boto3.client("s3", endpoint_url=endpoint, region_name=credential["region"],
                aws_access_key_id=credential["accessKey"], aws_secret_access_key=credential["secretKey"],
                aws_session_token=credential.get("sessionToken"),
                config=Config(signature_version="s3v4", connect_timeout=10, read_timeout=35,
                    retries={"max_attempts": 1}, request_checksum_calculation="when_required",
                    s3={"addressing_style": "path" if credential.get("type") == "minio" else "virtual"}))
            try:
                s3.put_object(Bucket=credential["bucket"], Key=key, Body=raw, ACL="public-read",
                    ContentType=mime, Metadata={"contentType": mime, "contentLength": str(len(raw))})
            finally:
                s3.close()
        try:
            await asyncio.to_thread(put)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(502, "RunningHub 素材上传失败，请检查登录态和网络") from None
        return f"https://{credential['cdnDomain']}/{key}"

    async def prepare(self, mode: str, request: Generation, *, upload: bool = True) -> tuple[dict, dict]:
        if mode not in MODES:
            raise HTTPException(404, "未知生成模式")
        canvas_id = os.environ.get("RUNNINGHUB_CANVAS_ID", "").strip()
        if not re.fullmatch(r"\d+", canvas_id):
            raise HTTPException(503, "请设置 RUNNINGHUB_CANVAS_ID 为画布 URL 中的数字")
        if mode == "i2v":
            requested_mode = request.mode or os.environ.get("RUNNINGHUB_I2V_MODE", "reference")
            if requested_mode not in {"reference", "first"}:
                raise HTTPException(503, "RUNNINGHUB_I2V_MODE 必须为 reference 或 first")
            if requested_mode == "first":
                mode = "first"
        elif request.mode:
            raise HTTPException(422, "mode 仅适用于 i2v 路由")
        reference_mode = mode in {"i2v", "ref2v"}
        audios = request.reference_audios or request.audio_urls
        videos = request.reference_videos
        if not reference_mode and (videos or request.reference_audios):
            raise HTTPException(422, "reference_videos 和 reference_audios 仅适用于全能参考模式")
        first = request.start_image or request.first_frame_url
        last = request.end_image or request.last_frame_url
        # Spielberg routes either first_media_id OR last_media_id to /fl2v.
        # A start-only request is therefore its normal first-frame contract.
        if mode == "fl2v" and first and not last:
            mode = "first"
        elif mode == "fl2v" and last and not first:
            raise HTTPException(422, "Spielberg 当前只选择了尾帧；H3 不支持仅尾帧生成，请同时选择首帧，或将图片设为首帧")
        images = request.reference_images[:]
        if request.image:
            if images:
                raise HTTPException(422, "image 与 reference_images 只能提供一个")
            images = [request.image]
        if mode == "t2v" and (images or first or last or audios):
            raise HTTPException(422, "t2v 不接受图片或音频参考")
        if mode == "t2v" and not request.prompt.strip():
            raise HTTPException(422, "文生视频需要 prompt")
        if reference_mode and (first or last):
            raise HTTPException(422, "全能参考使用 reference_images；首尾帧请使用 fl2v")
        if reference_mode and not (images or audios or videos):
            raise HTTPException(422, "全能参考至少需要一种参考素材（图片、视频或音频）")
        if mode == "first":
            if last or len(images) > 1 or (first and images):
                raise HTTPException(422, "首帧模式只接受一张首帧图片")
            first = first or (images[0] if images else None)
            if not first:
                raise HTTPException(422, "首帧模式需要 image 或 start_image")
        if mode == "fl2v" and (images or not first or not last):
            raise HTTPException(422, "首尾帧模式需要 start_image 和 end_image")
        values = images if reference_mode else [v for v in (first, last) if v]
        # Validate all references and model capabilities before any upload.
        for value, kind in ([(v, "image") for v in values] +
                            [(v, "audio") for v in audios] + [(v, "video") for v in videos]):
            if value.startswith(("http://", "https://")):
                try:
                    media_url(value)
                except ValueError as exc:
                    raise HTTPException(422, str(exc)) from None
            else:
                reference_bytes(value, kind)
        model = await self.model(mode, request)
        fields = {c.get("paramName") for c in model["config"]}
        fields.update(p.get("paramName") for c in model["config"] for p in c.get("paramNames", []))
        for prefix, refs, label in [("refVideo", videos, "视频"), ("refAudio", audios, "音频")]:
            if any(f"{prefix}{i}" not in fields for i in range(1, len(refs) + 1)):
                raise HTTPException(422, f"当前 RunningHub H3 模型不支持所选参考{label}")
        params = {"prompt": request.prompt, "aspectRatio": request.aspect_ratio,
                  "resolution": request.resolution, "duration": str(request.duration),
                  "audioMode": request.audio_mode}
        for prefix, refs, kind in [("refAudio", audios, "audio"), ("refVideo", videos, "video")]:
            for n, value in enumerate(refs, 1):
                params[f"{prefix}{n}"] = await self.upload(value, kind) if upload else (
                    value if value.startswith(("http://", "https://")) else f"<base64-{kind}-upload-on-submit>")
        names = [f"refImage{i+1}" for i in range(len(values))] if reference_mode else ["firstFrameUrl", "lastFrameUrl"]
        for key, value in zip(names, values):
            params[key] = await self.upload(value) if upload else (
                value if value.startswith(("http://", "https://")) else "<base64-image-upload-on-submit>")
        node_id = "spielberg_" + uuid.uuid4().hex
        node = {"id": node_id, "type": "rh-video", "position": {"x": 0, "y": 0},
                "data": {"label": "Spielberg H3", "title": "Spielberg H3", "status": "",
                         "modelCode": model["modelCode"], "modelType": model["modelType"],
                         "subType": MODES[mode][0], "generateNum": 1,
                         "prompt": request.prompt, "params": params}}
        return {"canvasId": canvas_id, "targetType": "NODE", "targetId": node_id,
                "canvas": {"nodes": [node], "edges": []}, "name": "Spielberg H3"}, model

    async def price(self, payload: dict, model: dict) -> dict:
        params = payload["canvas"]["nodes"][0]["data"]["params"]
        factors = [{"type": c["type"], "fieldKey": c["paramName"], "fieldValue": params[c["paramName"]]}
                   for c in model["config"] if c.get("paramName") in params]
        return await self.post("/canvas/price/calculate", {"skuId": str(model["skuId"]), "priceFactors": factors})

    async def status(self, task_id: str) -> dict:
        if not re.fullmatch(r"\d{1,64}", task_id):
            raise HTTPException(422, "generation_id 格式无效")
        data = await self.post("/canvas/task/batchStatus", {"taskIds": [task_id], "includeResults": True})
        tasks = data.get("tasks", []) if isinstance(data, dict) else []
        task = next((t for t in tasks if str(t.get("taskId")) == task_id), None)
        if task is None:
            raise HTTPException(404, "任务不存在或不属于当前登录账号")
        return normalize_task(task_id, task)


def normalize_task(task_id: str, task: dict) -> dict:
    state = str(task.get("status", "")).upper()
    result = {"generation_id": task_id, "status": "running", "upstream_status": state}
    plans = task.get("plans") or []
    failed = {"FAILED", "FAIL", "ERROR", "CANCELLED", "CANCELED"}
    if state in failed or any(str(p.get("status", "")).upper() in failed for p in plans):
        result.update(status="failed", error="RunningHub 任务失败或已取消；请在画布历史查看详情")
    elif state == "SUCCESS":
        outputs = [o for p in plans for o in (p.get("outputs") or [])]
        urls = [o["url"] for o in outputs if o.get("url") and o.get("success") is not False
                and str(o.get("code", 0)) == "0" and
                (o.get("mediaCategory") == "video" or o.get("outputType") in {"mp4", "webm", "mov"})]
        if urls:
            result.update(status="completed", result=[{"url": u} for u in dict.fromkeys(urls)])
        else:
            result.update(status="failed", error="RunningHub 已结束但没有可下载的视频结果")
    elif state not in {"PENDING", "QUEUED", "RUNNING", "PROCESSING", "WAITING", "INIT"}:
        raise HTTPException(502, "RunningHub 返回未知任务状态")
    return result


async def authorize(request: Request, authorization: str = Header(default=""), origin: str = Header(default="")):
    # Allow this service's local Swagger UI; Spielberg's Rust backend has no Origin.
    if origin and (origin != str(request.base_url).rstrip("/") or
                   urlparse(origin).hostname not in {"127.0.0.1", "localhost", "::1"}):
        raise HTTPException(403, "此适配器供服务端调用")
    token = os.environ.get("H3_API_TOKEN", "")
    if token and not hmac.compare_digest(authorization, "Bearer " + token):
        raise HTTPException(401, "适配器访问令牌无效")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient(timeout=httpx.Timeout(45, connect=10), follow_redirects=False) as client:
        app.state.rh = RunningHub(client)
        yield


app = FastAPI(title="Spielberg RunningHub Cookie H3 API", version="1.0.0", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # Pydantic's default response echoes input, potentially including large images.
    return JSONResponse(status_code=422, content={"detail": [
        {"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]})


@app.get("/health")
async def health():
    return {"status": "ok", "provider": "runninghub_cookie",
            "require_free": os.environ.get("RUNNINGHUB_REQUIRE_FREE", "0") == "1"}


@app.get("/v1/models", dependencies=[Depends(authorize)])
async def models(request: Request):
    return {"models": await request.app.state.rh.models()}


@app.post("/v1/preview/{mode}", dependencies=[Depends(authorize)])
async def preview(mode: str, body: Generation, request: Request):
    payload, model = await request.app.state.rh.prepare(mode, body, upload=False)
    return {"model_code": model["modelCode"], "request": payload, "submitted": False}


@app.post("/v1/estimate/{mode}", dependencies=[Depends(authorize)])
async def estimate(mode: str, body: Generation, request: Request):
    payload, model = await request.app.state.rh.prepare(mode, body, upload=False)
    if any(str(v).startswith("<base64-") for v in payload["canvas"]["nodes"][0]["data"]["params"].values()):
        raise HTTPException(422, "精确估价请提供素材 URL；Base64 可用 preview 检查")
    return {"model_code": model["modelCode"], "price": await request.app.state.rh.price(payload, model)}


@app.post("/v1/generations/{mode}", status_code=202, dependencies=[Depends(authorize)])
async def generate(mode: str, body: Generation, request: Request):
    rh = request.app.state.rh
    payload, model = await rh.prepare(mode, body)
    if os.environ.get("RUNNINGHUB_REQUIRE_FREE", "0") == "1":
        price = await rh.price(payload, model)
        try:
            zero = float(price["totalPrice"]) == 0
        except (KeyError, TypeError, ValueError):
            zero = False
        if not zero:
            raise HTTPException(402, "当前报价不为零或报价缺失，RUNNINGHUB_REQUIRE_FREE 已阻止提交")
    result = await rh.post("/canvas/task/run", payload)
    task_id = str(result.get("taskId", "")) if isinstance(result, dict) else ""
    if not re.fullmatch(r"\d{1,64}", task_id):
        raise HTTPException(502, "提交未返回有效 taskId；请先检查网页历史再重试")
    return {"generation_id": task_id}


@app.get("/v1/generations/{generation_id}", dependencies=[Depends(authorize)])
async def query(generation_id: str, request: Request):
    return await request.app.state.rh.status(generation_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--import-har", type=Path, help="从本地 HAR 导入站点 Cookie，不输出凭证")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8090)
    args = parser.parse_args()
    if args.import_har:
        import_har(args.import_har, Path(os.environ.get("RUNNINGHUB_SESSION_FILE", str(SESSION))))
        print("RunningHub 登录态已导入（文件权限 0600），未输出凭证。")
        return
    if args.host not in {"127.0.0.1", "::1", "localhost"} and not os.environ.get("H3_API_TOKEN"):
        parser.error("监听非本机地址时必须设置 H3_API_TOKEN")
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
