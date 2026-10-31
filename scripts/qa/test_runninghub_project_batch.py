"""Offline checks for the scheduled batch; no credentials or real submissions."""
import importlib.util
import json
from pathlib import Path
import sys

import pytest

spec = importlib.util.spec_from_file_location('runninghub_batch', Path(__file__).parents[1] / 'run-runninghub-project-batch.py')
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)


def test_never_submits_before_midnight(monkeypatch):
    monkeypatch.setattr(sys, 'argv', ['batch', '--run'])
    monkeypatch.setattr(batch, 'check', lambda: [])
    monkeypatch.setattr(batch, 'START', batch.dt.datetime.max.replace(tzinfo=batch.dt.timezone.utc))
    monkeypatch.setattr(batch, 'start_services', lambda: pytest.fail('started too early'))
    with pytest.raises(RuntimeError, match='禁止提前提交'):
        batch.main()


def test_uncertain_submission_is_not_retried(monkeypatch, tmp_path):
    marker = tmp_path / 'scene.json'
    calls = []
    def submit(*args, **kwargs):
        calls.append(args)
        raise OSError('caller disconnected')
    monkeypatch.setattr(batch, 'action', submit)
    monkeypatch.setattr(batch, 'existing_job', lambda *args: None)
    with pytest.raises(OSError):
        batch.tracked_action(marker, 'generations/video', {}, scene_id=1)
    assert json.loads(marker.read_text())['status'] == 'submitting'
    with pytest.raises(RuntimeError, match='禁止重复提交'):
        batch.tracked_action(marker, 'generations/video', {}, scene_id=1)
    assert len(calls) == 1


def test_completed_backend_job_is_reused_after_restart(monkeypatch, tmp_path):
    marker = tmp_path / 'scene.json'
    batch.save(marker, {'started_at': 100, 'status': 'submitting'})
    monkeypatch.setattr(batch, 'existing_job', lambda *args: {'status': 'completed', 'result_json': '{"id":42}'})
    monkeypatch.setattr(batch, 'action', lambda *args, **kwargs: pytest.fail('duplicated generation'))
    assert batch.tracked_action(marker, 'generations/video', {}, scene_id=1) == {'id': 42}
    assert json.loads(marker.read_text())['status'] == 'completed'


def test_scene_preserves_references_and_duration_and_sets_requested_output(monkeypatch, tmp_path):
    monkeypatch.setattr(batch, 'OUT', tmp_path)
    monkeypatch.setattr(batch, 'rows', lambda *args: [{'value': json.dumps({
        'video_mode': 'ref2v', 'reference_media_ids': [56, 42], 'duration': 15})}])
    monkeypatch.setattr(batch, 'request', lambda *args, **kwargs: {})
    monkeypatch.setattr(batch.h3_workflow, 'require_compiled', lambda *args: None)
    monkeypatch.setattr(batch, 'action', lambda *args, **kwargs: {})
    captured = []
    def track(marker, action, payload, **kwargs):
        captured.append(payload)
        return {'id': 42}
    monkeypatch.setattr(batch, 'tracked_action', track)
    batch.generate_scene({'id': 1, 'title': 'scene', 'prompt': 'validated H3 prompt 768p', 'description': '', 'reference_media_id': 56})
    assert captured[0]['image_media_ids'] == [56, 42]
    assert captured[0]['duration'] == 15
    assert captured[0]['aspect_ratio'] == '16:9'
    assert captured[0]['resolution'] == '768p'
    assert '768p' in captured[0]['prompt']


def test_failed_poll_resumes_existing_upstream_id_without_submission(monkeypatch, tmp_path):
    marker = tmp_path / 'scene.json'
    batch.save(marker, {'started_at': 100, 'status': 'submitting'})
    resume = {'url': 'http://zack-4090:8001/v1/generations/ref2v', 'generation_id': 'accepted-id',
              'payload': {'scene_id': 1, 'prompt': 'unchanged'}, 'generation_row_id': 7}
    monkeypatch.setattr(batch, 'existing_job', lambda *args: {'status': 'failed',
        'error': '查询生成进度失败：temporary network failure', 'resume_json': json.dumps(resume)})
    monkeypatch.setattr(batch, 'request', lambda *args, **kwargs: {'status': 'completed'})
    calls = []
    def action(name, body, **kwargs):
        calls.append(body)
        return {'id': 42}
    monkeypatch.setattr(batch, 'action', action)
    assert batch.tracked_action(marker, 'generations/video', {}, scene_id=1) == {'id': 42}
    assert calls[0]['_resume']['generation_id'] == 'accepted-id'


def test_old_uncompiled_prompt_is_blocked_before_video_submission(monkeypatch, tmp_path):
    monkeypatch.setattr(batch, 'OUT', tmp_path)
    monkeypatch.setattr(batch, 'rows', lambda *args: [{'value': '{"reference_media_ids":[42]}'}])
    monkeypatch.setattr(batch, 'tracked_action', lambda *args, **kwargs: pytest.fail('submitted uncompiled prompt'))
    with pytest.raises(ValueError, match='禁止直接提交旧描述'):
        batch.generate_scene({'id': 1, 'prompt': '旧中文描述', 'reference_media_id': 42})
