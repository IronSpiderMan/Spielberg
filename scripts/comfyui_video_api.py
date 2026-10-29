#!/usr/bin/env python3
"""Standard-library HTTP adapter for native ComfyUI MiniMax H3 video generation."""
from __future__ import annotations

import argparse
import base64
import binascii
import json
import math
import os
import re
import secrets
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, parse_qs
from urllib.request import Request, urlopen

MODES = ('t2v', 'i2v', 'l2v', 'fl2v', 'ref2v')
MAX_BODY = 128 * 1024 * 1024


class ApiError(Exception):
    def __init__(self, status, message, details=None):
        super().__init__(message)
        self.status, self.details = status, details


class ComfyClient:
    def __init__(self, url):
        self.url = url.rstrip('/')

    def request(self, path, payload=None, *, raw=None, content_type=None):
        headers = {}
        if payload is not None:
            raw = json.dumps(payload).encode()
            headers['Content-Type'] = 'application/json'
        if content_type:
            headers['Content-Type'] = content_type
        try:
            with urlopen(Request(self.url + path, data=raw, headers=headers), timeout=90) as r:
                return json.load(r)
        except HTTPError as e:
            body = e.read().decode(errors='replace')
            try:
                body = json.loads(body)
            except ValueError:
                body = body[:4000]
            raise ApiError(502, 'ComfyUI 拒绝请求', body) from e
        except (URLError, TimeoutError, socket.timeout, ValueError) as e:
            raise ApiError(502, f'ComfyUI 连接或响应异常: {e}') from e

    def upload(self, value, kind):
        # An existing input filename avoids re-uploading large reference assets.
        if isinstance(value, dict) and set(value) == {'filename'}:
            name = value['filename']
            if not isinstance(name, str) or not name or '\\' in name or name.startswith('/') or '..' in name.split('/'):
                raise ApiError(400, 'filename 必须是 ComfyUI input 下的相对路径')
            return name
        if not isinstance(value, str) or not value:
            raise ApiError(400, f'{kind} 必须是 base64、data URL 或 {{"filename":"..."}}')
        mime = {'image': 'image/png', 'video': 'video/mp4', 'audio': 'audio/wav'}[kind]
        if value.startswith('data:'):
            match = re.fullmatch(r'data:([^;,]+);base64,(.+)', value, re.S)
            if not match or not match[1].startswith(kind + '/'):
                raise ApiError(400, f'需要 {kind} 类型的 base64 data URL')
            mime, value = match.groups()
        try:
            data = base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error) as e:
            raise ApiError(400, f'{kind} base64 无效') from e
        if not data or len(data) > 80 * 1024 * 1024:
            raise ApiError(413, '单个素材需为 1 字节至 80 MiB')
        ext = {'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/flac': 'flac', 'audio/mp4': 'm4a'}.get(mime, {'image': 'png', 'video': 'mp4', 'audio': 'wav'}[kind])
        boundary = 'Spielberg' + secrets.token_hex(12)
        name = secrets.token_hex(16) + '.' + ext
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n').encode() + data
        body += (f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n--{boundary}--\r\n').encode()
        result = self.request('/upload/image', raw=body, content_type=f'multipart/form-data; boundary={boundary}')
        return '/'.join(filter(None, [result.get('subfolder'), result['name']]))


def number(data, key, default, low, high, integer=True):
    v = data.get(key, default)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not low <= v <= high or (integer and not isinstance(v, int)):
        raise ApiError(400, f'{key} 必须是 {low} 至 {high} 的' + ('整数' if integer else '数值'))
    return v


def build_workflow(mode, data, upload):
    if mode not in MODES:
        raise ApiError(404, '不支持的生成模式')
    if not isinstance(data, dict) or not isinstance(data.get('prompt'), str) or not data['prompt'].strip():
        raise ApiError(400, 'prompt 必须是非空字符串')
    width = number(data, 'width', 832, 256, 2048)
    height = number(data, 'height', 480, 256, 2048)
    if width % 32 or height % 32:
        raise ApiError(400, 'width 和 height 必须为 32 的倍数')
    duration = number(data, 'duration', 5, 1, 15, False)
    frames = number(data, 'frames', math.ceil((duration * 24 - 5) / 17) * 17 + 5, 5, 362)
    frames = math.ceil((frames - 5) / 17) * 17 + 5
    seed = number(data, 'seed', secrets.randbits(63), 0, 2**64-1)
    steps = number(data, 'steps', 20, 1, 100)
    cfg = number(data, 'cfg', 1.0, 0, 20, False)
    refs = {}
    for field, limit in [('reference_images', 9), ('reference_videos', 3), ('reference_audios', 3)]:
        values = data.get(field, [])
        if not isinstance(values, list) or len(values) > limit:
            raise ApiError(400, f'{field} 必须是最多 {limit} 个素材的数组')
        refs[field] = values
    first = data.get('first_image', data.get('image', data.get('start_image')))
    last = data.get('last_image', data.get('end_image'))
    if mode in ('i2v', 'fl2v') and not first:
        raise ApiError(400, '需要 image 或 first_image')
    if mode in ('l2v', 'fl2v') and not last:
        raise ApiError(400, '需要 last_image')
    if mode == 'ref2v' and not any(refs.values()):
        raise ApiError(400, 'ref2v 至少需要一个参考素材')
    if mode != 'ref2v' and any(refs.values()):
        raise ApiError(400, '参考素材数组仅适用于 ref2v')
    if (mode in ('t2v', 'ref2v') and (first or last)) or (mode == 'i2v' and last) or (mode == 'l2v' and first):
        raise ApiError(400, '首尾帧参数与生成模式不匹配')
    ref_size = data.get('ref_image_size', 'match')
    if ref_size not in ('match', 'max'):
        raise ApiError(400, 'ref_image_size 必须是 match 或 max')
    g = {}
    def node(name, **inputs):
        key = str(len(g) + 1)
        g[key] = {'class_type': name, 'inputs': inputs}
        return [key, 0]
    model_name = os.environ.get('COMFY_H3_REF_MODEL' if mode == 'ref2v' else 'COMFY_H3_MODEL', 'minimax_h3_ref2va_pruned_int8_convrot.safetensors' if mode == 'ref2v' else 'minimax_h3_fl2va_pruned_int8_convrot.safetensors')
    model = node('UNETLoader', unet_name=model_name, weight_dtype='default')
    clip = node('CLIPLoader', clip_name=os.environ.get('COMFY_H3_CLIP', 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'), type='minimax', device='default')
    vae = node('VAELoader', vae_name=os.environ.get('COMFY_H3_VAE', 'minimax_h3_video_vae_fp16.safetensors'))
    avae = node('VAELoader', vae_name=os.environ.get('COMFY_H3_AUDIO_VAE', 'minimax_h3_audio_vae_fp32.safetensors'))
    inputs = dict(clip=clip, prompt=data['prompt'], width=width, height=height, length=frames)
    if mode == 'ref2v':
        inputs.update(vae=vae, audio_vae=avae, ref_image_size=ref_size)
        for i, value in enumerate(refs['reference_images']):
            inputs[f'ref_images.ref_image_{i}'] = node('LoadImage', image=upload(value, 'image'))
        for i, value in enumerate(refs['reference_videos']):
            video = node('LoadVideo', file=upload(value, 'video'))
            components = node('GetVideoComponents', video=video)
            inputs[f'ref_videos.ref_video_{i}'] = components
        for i, value in enumerate(refs['reference_audios']):
            inputs[f'ref_audios.ref_audio_{i}'] = node('LoadAudio', audio=upload(value, 'audio'))
        cond = node('MiniMaxH3ReferenceToVideo', **inputs)
    else:
        inputs['vae'] = vae
        if first:
            inputs['first_frame'] = node('LoadImage', image=upload(first, 'image'))
        if last:
            inputs['last_frame'] = node('LoadImage', image=upload(last, 'image'))
        cond = node('MiniMaxH3ImageToVideo', **inputs)
    latent = [cond[0], 1]
    model = node('MiniMaxH3SigmaShift', model=model, shift_video=12.0, shift_audio=3.0)
    if cfg == 1:
        guider = node('BasicGuider', model=model, conditioning=cond)
    else:
        neg = node('ConditioningZeroOut', conditioning=cond)
        guider = node('CFGGuider', model=model, positive=cond, negative=neg, cfg=cfg)
    noise = node('RandomNoise', noise_seed=seed)
    sampler = node('KSamplerSelect', sampler_name='res_multistep')
    sigmas = node('BasicScheduler', model=model, scheduler='simple', steps=steps, denoise=1.0)
    sampled = node('SamplerCustomAdvanced', noise=noise, guider=guider, sampler=sampler, sigmas=sigmas, latent_image=latent)
    images = node('VAEDecodeTiled', samples=sampled, vae=vae, tile_size=512, overlap=64, temporal_size=32, temporal_overlap=8)
    audio = node('VAEDecodeAudio', samples=sampled, vae=avae)
    video = node('CreateVideo', images=images, audio=audio, fps=24.0)
    node('SaveVideo', video=video, filename_prefix='spielberg/' + secrets.token_hex(8), format='mp4', **{'format.codec': 'h264'})
    return g, {'mode': mode, 'seed': seed, 'width': width, 'height': height, 'frames': frames, 'duration': frames / 24}


class Handler(BaseHTTPRequestHandler):
    server_version = 'SpielbergComfy/1.0'

    def reply(self, status, data):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def dispatch(self):
        token = os.environ.get('COMFY_ADAPTER_TOKEN')
        if token and not secrets.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
            raise ApiError(401, '需要有效的 Bearer token')
        path = urlsplit(self.path).path
        client = self.server.client
        if self.command == 'GET' and path == '/health':
            stats = client.request('/system_stats')
            return self.reply(200, {'ok': True, 'comfyui_url': client.url, 'native_video': {'modes': MODES}, 'system': stats})
        if self.command == 'POST' and path.startswith('/v1/generations/'):
            if self.headers.get('Transfer-Encoding'):
                raise ApiError(400, '请使用 Content-Length')
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                raise ApiError(400, 'Content-Length 无效')
            if not 0 < length <= MAX_BODY:
                raise ApiError(413, '请求体需为 1 字节至 128 MiB')
            try:
                data = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeError):
                raise ApiError(400, '请求体必须为 JSON')
            graph, info = build_workflow(path.rsplit('/', 1)[1], data, client.upload)
            if parse_qs(urlsplit(self.path).query).get('dry_run') == ['true']:
                return self.reply(200, {**info, 'workflow': graph})
            result = client.request('/prompt', {'prompt': graph, 'client_id': 'spielberg-' + secrets.token_hex(8)})
            if result.get('node_errors') or not result.get('prompt_id'):
                raise ApiError(502, 'ComfyUI 工作流校验失败', result)
            return self.reply(202, {'generation_id': result['prompt_id'], 'id': result['prompt_id'], 'status': 'queued', **info})
        match = re.fullmatch(r'/(?:v1/generations|tasks)/([A-Za-z0-9_-]+)', path)
        if self.command == 'GET' and match:
            task = match[1]
            history = client.request('/history/' + task).get(task)
            if history:
                status = history.get('status', {})
                outputs = []
                for value in history.get('outputs', {}).values():
                    for key in ('images', 'videos', 'gifs', 'audio'):
                        for item in value.get(key, []):
                            if isinstance(item, dict) and item.get('filename'):
                                outputs.append({**item, 'url': client.url + '/view?' + urlencode({k: item.get(k, '') for k in ('filename', 'subfolder', 'type')})})
                failed = status.get('status_str') == 'error'
                state = 'failed' if failed else ('succeeded' if status.get('completed') else 'running')
                if path.startswith('/v1/generations/'):
                    videos = [item for item in outputs if item['filename'].lower().endswith(('.mp4', '.webm', '.mov', '.mkv', '.m4v'))]
                    error = 'ComfyUI 工作流执行失败，请查看 ComfyUI 日志'
                    if state == 'succeeded':
                        state = 'completed' if videos else 'failed'
                        error = 'ComfyUI 任务结束，但未返回视频文件'
                    response = {'generation_id': task, 'id': task, 'status': state,
                                'result': videos, 'outputs': outputs, 'details': status}
                    if state == 'failed':
                        response['error'] = error
                    return self.reply(200, response)
                return self.reply(200, {'id': task, 'status': state, 'outputs': outputs, 'details': status})
            queue = client.request('/queue')
            for key, state in [('queue_running', 'running'), ('queue_pending', 'queued')]:
                if any(item[1] == task for item in queue.get(key, [])):
                    return self.reply(200, {'generation_id': task, 'id': task, 'status': state, 'result': [], 'outputs': []})
            raise ApiError(404, '任务不存在或 ComfyUI 历史已清除')
        raise ApiError(404, '接口不存在')

    def handle_request(self):
        self.connection.settimeout(120)
        try:
            self.dispatch()
        except ApiError as e:
            self.reply(e.status, {'error': str(e), 'details': e.details})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            self.log_error('%s', e)
            self.reply(500, {'error': '服务内部异常，请查看服务日志'})

    do_GET = handle_request
    do_POST = handle_request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--comfy-url', default=os.environ.get('COMFYUI_URL', 'http://192.168.1.10:8188'))
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8002)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.client = ComfyClient(args.comfy_url)
    print(f'ComfyUI video API: http://{args.host}:{args.port} -> {args.comfy_url}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
