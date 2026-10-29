"""Run: python3 -m unittest discover -s scripts/qa -p test_comfyui_video_api.py"""
import importlib.util
import json
from pathlib import Path
import threading
import unittest
from urllib.request import urlopen, Request
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location('comfy', Path(__file__).resolve().parents[1] / 'comfyui_video_api.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class WorkflowTests(unittest.TestCase):
    def test_all_modes_and_av_decode(self):
        for mode in m.MODES:
            d = {'prompt': 'A walking character', 'seed': 7}
            if mode in ('i2v', 'fl2v'): d['image'] = 'first'
            if mode in ('l2v', 'fl2v'): d['last_image'] = 'last'
            if mode == 'ref2v':
                d.update(reference_images=['a', 'b'], reference_videos=['v'], reference_audios=['s'])
            g, info = m.build_workflow(mode, d, lambda v, k: v)
            self.assertEqual(info['frames'], 124)
            self.assertEqual(info['seed'], 7)
            decoders = [v['inputs']['samples'] for v in g.values() if v['class_type'] in ('VAEDecodeTiled', 'VAEDecodeAudio')]
            self.assertEqual(decoders[0], decoders[1])
            if mode == 'ref2v':
                cond = next(v['inputs'] for v in g.values() if v['class_type'] == 'MiniMaxH3ReferenceToVideo')
                self.assertIn('ref_images.ref_image_1', cond)
                self.assertIn('ref_videos.ref_video_0', cond)
                self.assertIn('ref_audios.ref_audio_0', cond)

    def test_bad_input_before_upload(self):
        for mode, fields in [('fl2v', {'image': 'a'}), ('ref2v', {}), ('i2v', {}), ('t2v', {'width': 801}), ('t2v', {'seed': True})]:
            with self.assertRaises(m.ApiError):
                m.build_workflow(mode, {'prompt': 'x', **fields}, lambda *_: self.fail('unexpected upload'))

    def test_upload_encoding_and_existing_path(self):
        c = m.ComfyClient('http://unused')
        calls = []
        c.request = lambda path, **kw: calls.append((path, kw)) or {'name': 'ref.mp4', 'subfolder': 'test'}
        self.assertEqual(c.upload('data:video/mp4;base64,YWJj', 'video'), 'test/ref.mp4')
        self.assertIn(b'name="image"', calls[0][1]['raw'])
        self.assertIn(b'abc', calls[0][1]['raw'])
        self.assertEqual(c.upload({'filename': 'refs/a.png'}, 'image'), 'refs/a.png')
        with self.assertRaises(m.ApiError): c.upload({'filename': '../a.png'}, 'image')

    def test_http_submit_poll_and_dry_run(self):
        class Client:
            def upload(self, v, kind): return 'image.png'
            def request(self, path, payload=None):
                if path == '/prompt': return {'prompt_id': 'test-id'}
                if path == '/history/test-id':
                    return {'test-id': {'status': {'completed': True}, 'outputs': {'15': {'images': [{'filename': 'a.mp4', 'subfolder': 'x', 'type': 'output'}]}}}}
                if path == '/history/no-video':
                    return {'no-video': {'status': {'completed': True}, 'outputs': {'1': {'images': [{'filename': 'preview.png'}]}}}}
                if path == '/history/failed':
                    return {'failed': {'status': {'completed': False, 'status_str': 'error'}}}
                if path == '/queue':
                    return {'queue_pending': [[0, 'pending']], 'queue_running': [[1, 'running']]}
                return {}
            url = 'http://comfy:8188'
        server = ThreadingHTTPServer(('127.0.0.1', 0), m.Handler)
        server.client = Client()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        root = 'http://127.0.0.1:' + str(server.server_port)
        try:
            req = Request(root + '/v1/generations/t2v', data=json.dumps({'prompt': 'x'}).encode())
            with urlopen(req) as r:
                self.assertEqual(r.status, 202)
                submission = json.load(r)
                self.assertEqual(submission['id'], 'test-id')
                self.assertEqual(submission['generation_id'], 'test-id')
            with urlopen(root + '/v1/generations/' + submission['generation_id']) as r:
                result = json.load(r)
                self.assertEqual(result['status'], 'completed')
                self.assertEqual(result['generation_id'], 'test-id')
                self.assertIn('/view?', result['result'][0]['url'])
            for task in ('no-video', 'failed'):
                with urlopen(root + '/v1/generations/' + task) as r:
                    result = json.load(r)
                    self.assertEqual(result['status'], 'failed')
                    self.assertTrue(result['error'])
            for task, state in [('pending', 'queued'), ('running', 'running')]:
                with urlopen(root + '/v1/generations/' + task) as r:
                    result = json.load(r)
                    self.assertEqual(result['status'], state)
                    self.assertEqual(result['generation_id'], task)
            with urlopen(root + '/tasks/test-id') as r:
                result = json.load(r)
                self.assertEqual(result['status'], 'succeeded')
                self.assertIn('/view?', result['outputs'][0]['url'])
            with urlopen(Request(root + '/v1/generations/t2v?dry_run=true', data=b'{"prompt":"x"}')) as r:
                self.assertIn('workflow', json.load(r))
            with self.assertRaises(HTTPError) as err:
                urlopen(Request(root + '/v1/generations/t2v', data=b'[]'))
            self.assertEqual(err.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__': unittest.main()
