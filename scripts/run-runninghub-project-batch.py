#!/usr/bin/env python3
"""Resumable RunningHub or native MiniMax H3 production for the 40-episode project.

--check only inspects local input; --run starts services and generates after
2026-10-31 00:00 Asia/Shanghai. State and logs live under output/runninghub-5090.
Never automatically resubmit an uncertain or failed generation.
"""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from types import SimpleNamespace
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import h3_prompt_workflow as h3_workflow
PID = 'c085ccc6-2d5e-471c-83b0-ff9ff94fee23'
DATA = Path.home() / 'Library/Application Support/com.spielberg.studio'
DB = DATA / 'projects' / PID / 'spielberg.sqlite'
OUT = ROOT / 'output/runninghub-5090'
BACKEND = 'http://127.0.0.1:8082'
RH = 'http://127.0.0.1:8090'
PROVIDER = 'runninghub'
NATIVE = 'http://zack-4090:8001'
START = dt.datetime(2026, 10, 31, tzinfo=dt.timezone(dt.timedelta(hours=8)))
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.replace(path)


def log(message):
    print(dt.datetime.now().astimezone().isoformat(timespec='seconds'), message, flush=True)


def rows(sql, args=()):
    with sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute(sql, args)]


def request(url, body=None, method=None, timeout=30):
    encoded = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(url, data=encoded, method=method,
                                 headers={'Content-Type': 'application/json'})
    try:
        with OPENER.open(req, timeout=timeout) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read(4000).decode(errors='replace')
        raise RuntimeError(f'{error.code} {url}: {detail}') from None
    return result


def action(name, body, timeout=30):
    return request(BACKEND + '/api/v1/actions/' + name,
                   {'project_id': PID, **body}, timeout=timeout)['data']


def health(base):
    try:
        return request(base + ('/api/v1/health' if base == BACKEND else '/health'), timeout=2)
    except (OSError, RuntimeError):
        return None


def start_services():
    if PROVIDER == 'native':
        value = request(NATIVE + '/health', timeout=15)
        if value.get('native_video', {}).get('status') != 'available':
            raise RuntimeError('4090 MiniMax H3 原生服务不可用。')
        video_url = NATIVE
    else:
        start_runninghub()
        video_url = RH
    start_backend()
    settings = json.loads(rows("SELECT value FROM settings WHERE key='models'")[0]['value'])
    if not (OUT / 'settings-before.json').exists():
        save(OUT / 'settings-before.json', settings)
        os.chmod(OUT / 'settings-before.json', 0o600)
    settings['video'] = {**settings.get('video', {}), 'base_url': video_url, 'url': '', 'api_key': ''}
    action('settings', {'settings': settings})
    log(f'Spielberg 视频接口已切换：{video_url}，提供方 {PROVIDER}。')


def start_runninghub():
    env = dict(os.environ, RUNNINGHUB_REQUIRE_FREE='1',
               RUNNINGHUB_CANVAS_ID=os.environ.get('RUNNINGHUB_CANVAS_ID', '2105284694684114946'))
    if not health(RH):
        with (OUT / 'runninghub-api.log').open('ab') as output:
            child = subprocess.Popen([str(ROOT / 'scripts/start-runninghub.sh')], cwd=ROOT,
                                     env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        save(OUT / 'runninghub-service.json', {'pid': child.pid, 'require_free': True})
    for _ in range(60):
        value = health(RH)
        if value:
            if value.get('provider') != 'runninghub_cookie' or value.get('require_free') is not True:
                raise RuntimeError('8090 上的服务未确认启用零报价限制，请勿批量提交。')
            break
        time.sleep(1)
    else:
        raise RuntimeError('RunningHub 本机 API 未启动，查看 runninghub-api.log')
    request(RH + '/v1/models', timeout=45)  # Live login check; no generation.


def start_backend():
    if not health(BACKEND):
        binary = ROOT / 'backend/target/release/spielberg-backend'
        if not binary.is_file():
            raise RuntimeError('请先 cargo build --release --manifest-path backend/Cargo.toml')
        with (OUT / 'spielberg-backend.log').open('ab') as output:
            child = subprocess.Popen([str(binary)], cwd=ROOT,
                                     env=dict(os.environ, SPIELBERG_BIND='127.0.0.1:8082', SPIELBERG_DATA_DIR=str(DATA)),
                                     stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        save(OUT / 'backend-service.json', {'pid': child.pid})
    for _ in range(60):
        if health(BACKEND):
            break
        time.sleep(1)
    else:
        raise RuntimeError('Spielberg 批处理后端未启动，查看 spielberg-backend.log')


def prepare_episode(episode):
    return h3_workflow.prepare_episode(SimpleNamespace(**globals()), episode)


def existing_job(marker, scene_id=None, episode_id=None):
    jobs = rows('SELECT * FROM background_jobs WHERE CAST(created_at AS INTEGER)>=? ORDER BY id DESC',
                (int(marker['started_at']),))
    for job in jobs:
        body = json.loads(job.get('request_json') or '{}')
        if ((scene_id is not None and body.get('scene_id') == scene_id and job['operation'] == '/generations/video')
                or (episode_id is not None and body.get('episode_id') == episode_id and job['operation'] == '/episodes/merge')):
            return job
    return None


def tracked_action(markerfile, name, payload, scene_id=None, episode_id=None):
    if markerfile.exists():
        marker = json.loads(markerfile.read_text())
        if marker.get('status') == 'completed':
            return marker['result']
        job = existing_job(marker, scene_id, episode_id)
        if job is None:
            raise RuntimeError(f'{markerfile.name} 提交结果不确定，必须先核对历史，禁止重复提交。')
        while job['status'] == 'running':
            time.sleep(15)
            job = existing_job(marker, scene_id, episode_id)
        if (job['status'] == 'failed' and job.get('resume_json') and
                str(job.get('error', '')).startswith(('查询生成进度失败', '下载生成视频失败'))):
            resume = json.loads(job['resume_json'])
            # An accepted upstream ID permits resuming GET polling/downloads;
            # _resume bypasses POST submission in the Spielberg backend.
            remote = request(resume['url'].split('/v1/generations/')[0] +
                             '/v1/generations/' + resume['generation_id'], timeout=60)
            if remote.get('status') in ('queued', 'running', 'completed'):
                result = action(name, {**resume['payload'], '_resume': resume}, timeout=None)
                save(markerfile, {**marker, 'status': 'completed', 'result': result, 'completed_at': time.time()})
                return result
        if job['status'] != 'completed':
            raise RuntimeError(f'任务#{job["id"]} {job["status"]}: {job.get("error")}')
        result = json.loads(job['result_json'])
    else:
        marker = {'status': 'submitting', 'started_at': time.time(), 'scene_id': scene_id, 'episode_id': episode_id}
        save(markerfile, marker)
        # The backend durably stores the upstream task ID and imports/attaches the
        # downloaded result. A lost caller connection must not trigger a retry.
        result = action(name, payload, timeout=None)
    save(markerfile, {**marker, 'status': 'completed', 'result': result, 'completed_at': time.time()})
    return result


def generate_scene(scene):
    sid = scene['id']
    marker = OUT / 'jobs' / f'scene-{sid:04}.json'
    options = rows('SELECT value FROM scene_options WHERE scene_id=?', (sid,))
    options = json.loads(options[0]['value']) if options else {}
    mode = options.get('video_mode', 'i2v')
    refs = options.get('reference_media_ids') or ([scene['reference_media_id']] if scene.get('reference_media_id') else [])
    videos = options.get('reference_video_media_ids', [])
    audios = options.get('reference_audio_media_ids', [])
    h3_workflow.require_compiled(SimpleNamespace(**globals()), scene, refs)
    prompt = scene['prompt']
    if mode in ('i2v', 'ref2v'):
        if not refs and not videos and not audios:
            raise RuntimeError(f'场景 {sid} 没有参考素材。')
        payload = {'video_mode': 'i2v', 'operation': 'ref2v', 'image_media_ids': refs,
                   'reference_video_media_ids': videos, 'reference_audio_media_ids': audios}
    elif mode == 'fl2v':
        payload = {'video_mode': 'fl2v', 'operation': 'fl2v', 'first_media_id': scene['first_media_id'],
                   'last_media_id': scene['last_media_id']}
    else:
        payload = {'operation': 't2v'}
    options.update(aspect_ratio='16:9', size='1344x768', resolution='768p')
    request(f'{BACKEND}/api/v1/projects/{PID}/scenes/{sid}', {'generation_options': options}, method='PATCH')
    payload.update(scene_id=sid, prompt=prompt, duration=options.get('duration', 15),
                   aspect_ratio='16:9', size='1344x768', resolution='768p')
    log(f'生成场景 {sid}: {scene["title"]}')
    result = tracked_action(marker, 'generations/video', payload, scene_id=sid)
    action('scenes/select-video', {'scene_id': sid, 'media_id': result['id']})
    return result


def check():
    episodes = rows('SELECT id,title,sort_order FROM episodes ORDER BY sort_order,id')
    scenes = rows('SELECT id,episode_id FROM scenes')
    scripts = rows("SELECT episode_id FROM screenplays WHERE format='markdown' AND trim(content)!=''")
    covered = {s['episode_id'] for s in scenes} | {s['episode_id'] for s in scripts}
    missing = [e['title'] for e in episodes if e['id'] not in covered]
    if missing:
        raise RuntimeError(f'剧集缺少场景和剧本：{missing}')
    if PROVIDER == 'runninghub' and not (ROOT / '.runninghub/session.json').exists():
        raise RuntimeError('缺少 RunningHub 登录态。')
    print(json.dumps({'project_id': PID, 'episodes': len(episodes), 'existing_scenes': len(scenes),
                      'episodes_requiring_scene_planning': sum(not any(s['episode_id'] == e['id'] for s in scenes) for e in episodes),
                      'start_at': START.isoformat(), 'aspect_ratio': '16:9', 'resolution': '768p'}, ensure_ascii=False))
    return episodes


def main():
    global PROVIDER, NATIVE, OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', help='零点后启动并生成全部剧集；默认仅检查')
    parser.add_argument('--check', action='store_true', help='仅检查本地素材与剧本，不启动或提交生成')
    parser.add_argument('--provider', choices=['runninghub', 'native'], default='runninghub')
    parser.add_argument('--video-url', default=NATIVE, help='原生 MiniMax H3 地址')
    parser.add_argument('--prepare-only', action='store_true', help='仅重写和校验Prompt，不提交视频')
    parser.add_argument('--episode', type=int, help='只准备或生成指定剧集ID')
    args = parser.parse_args()
    PROVIDER = args.provider
    NATIVE = args.video_url.rstrip('/')
    if PROVIDER == 'native':
        OUT = ROOT / 'output/native-h3-5090-h3v2'
    episodes = check()
    if args.episode is not None:
        episodes = [e for e in episodes if e['id'] == args.episode]
        if not episodes:
            raise RuntimeError('指定剧集不存在')
    if not args.run and not args.prepare_only:
        return
    if dt.datetime.now(dt.timezone.utc) < START:
        raise RuntimeError('尚未到北京时间2026-10-31 00:00，禁止提前提交。')
    OUT.mkdir(parents=True, exist_ok=True)
    os.chmod(OUT, 0o700)
    lock = (OUT / 'batch.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    lock.write(str(os.getpid())); lock.flush()
    inhibitor = subprocess.Popen(['/usr/bin/caffeinate', '-i', '-w', str(os.getpid())])
    try:
        if args.prepare_only:
            start_backend()
        else:
            start_services()
        for episode in episodes:
            log(episode['title'])
            save(OUT / 'status.json', {'status': 'compiling_prompts', 'episode': episode['title'], 'updated_at': time.time()})
            scenes = prepare_episode(episode)
            if args.prepare_only:
                continue
            for scene in scenes:
                save(OUT / 'status.json', {'status': 'running', 'provider': PROVIDER,
                    'episode': episode['title'], 'scene_id': scene['id'], 'scene': scene['title'],
                    'total_episodes': len(episodes), 'updated_at': time.time()})
                generate_scene(scene)
            merged = tracked_action(OUT / f'episode-{episode["id"]:02}-merged.json', 'episodes/merge',
                                    {'episode_id': episode['id'], 'width': 1344, 'height': 768}, episode_id=episode['id'])
            save(OUT / 'status.json', {'status': 'running', 'last_completed_episode': episode['title'],
                                      'merged_asset_id': merged['id'], 'updated_at': time.time()})
        save(OUT / 'status.json', {'status': 'prompts_ready' if args.prepare_only else 'completed', 'episodes': len(episodes), 'updated_at': time.time()})
        log('所选剧集Prompt已按原剧本重写并校验。' if args.prepare_only else '全部剧集生成并合并完成。')
    except BaseException as error:
        save(OUT / 'status.json', {'status': 'needs_attention', 'error': str(error), 'updated_at': time.time()})
        log(f'暂停：{error}')
        raise
    finally:
        inhibitor.terminate()


if __name__ == '__main__':
    main()
