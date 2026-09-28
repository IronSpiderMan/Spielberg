#!/usr/bin/env python3
"""Exercise the real HTTP service and SQLite/filesystem with disposable data only."""
import base64
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BINARY = Path(os.environ.get("SPIELBERG_TEST_BINARY", ROOT / "backend/target/debug/spielberg-backend"))
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSAAAAABJRU5ErkJggg==")


def main():
    with tempfile.TemporaryDirectory(prefix="spielberg-http-") as tmp:
        data_dir = Path(tmp) / "data"
        log = open(Path(tmp) / "server.log", "w+")
        process = subprocess.Popen([str(BINARY)], env={**os.environ, "SPIELBERG_DATA_DIR": str(data_dir), "SPIELBERG_BIND": "127.0.0.1:0"}, stdout=log, stderr=log)
        try:
            url = None
            for _ in range(200):
                log.flush(); log.seek(0)
                lines = log.read().splitlines()
                urls = [line.split("Spielberg listening at ", 1)[1] for line in lines if "Spielberg listening at " in line]
                if urls: url = urls[-1]; break
                if process.poll() is not None: raise AssertionError("Server exited: " + "\n".join(lines))
                time.sleep(0.05)
            assert url, "Server did not start"
            def raw(method, path, body=None, headers=None, expected=200):
                headers = dict(headers or {})
                if isinstance(body, (dict, list)):
                    body = json.dumps(body).encode(); headers["Content-Type"] = "application/json"
                req = urllib.request.Request(url + path, data=body, method=method, headers=headers)
                try: response = urllib.request.urlopen(req, timeout=30)
                except urllib.error.HTTPError as error: response = error
                contents = response.read()
                assert response.status == expected, (method, path, response.status, expected, contents[:1000])
                return contents, response.headers
            def api(method, path, body=None, expected=200):
                contents, _ = raw(method, "/api/v1" + path, body, expected=expected)
                response = json.loads(contents)
                assert ("error" if expected >= 400 else "data") in response, response
                return response.get("data", response)
            assert api("GET", "/health")["status"] == "ok"
            page, headers = raw("GET", "/")
            assert b"<html" in page and "text/html" in headers["Content-Type"]
            raw("GET", "/workspace/route")
            raw("GET", "/api/nonexistent", expected=404)
            project = api("POST", "/projects", {"name": "HTTP 测试项目"}, 201)
            pid = project["id"]; scope = "/projects/" + pid
            assert api("GET", scope)["name"] == project["name"]
            assert api("PATCH", scope, {"name": "Renamed"})["name"] == "Renamed"
            # Concurrent registry changes must not lose projects.
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
                created = list(executor.map(lambda i: api("POST", "/projects", {"name": str(i)}, 201), range(8)))
            assert len(api("GET", "/projects")) == 9
            for item in created: api("DELETE", "/projects/" + item["id"])
            role = api("POST", scope + "/roles", {"name": "主角", "description": "保留描述"}, 201)
            assert api("PATCH", scope + f'/roles/{role["id"]}', {"name": "新名字"})["description"] == "保留描述"
            episode = api("POST", scope + "/episodes", {"title": "第一集", "description": "剧情"}, 201)
            scene = api("POST", scope + "/scenes", {"episode_id": episode["id"], "title": "场景一", "description": "雨夜"}, 201)
            prompt = api("POST", scope + "/prompts", {"name": "风格", "content": "水墨", "category": "风格"}, 201)
            assert api("PATCH", scope + f'/prompts/{prompt["id"]}', {"name": "重命名"})["content"] == "水墨"
            # Binary upload, role assignment, Unicode query, real file download, and byte ranges.
            contents, _ = raw("POST", "/api/v1" + scope + "/assets/upload?" + urllib.parse.urlencode({"name": "参考图.png", "role_id": role["id"]}), PNG, expected=201)
            asset = json.loads(contents)["data"]; mid = asset["id"]
            assert api("GET", scope + f'/roles/{role["id"]}')["images"][0]["id"] == mid
            assets = api("GET", scope + "/assets?" + urllib.parse.urlencode({"query": "参考图", "limit": 1}))
            assert assets["total"] == 1 and len(assets["items"]) == 1
            api("PATCH", scope + f'/roles/{role["id"]}', {"design_media_id": mid})
            api("PATCH", scope + f'/roles/{role["id"]}', {"description": "新描述"})
            assert api("GET", scope + f'/roles/{role["id"]}')["design_media_id"] == mid
            api("DELETE", scope + f"/assets/{mid}", expected=409)
            content_path = "/api/v1" + scope + f"/assets/{mid}/content"
            contents, headers = raw("GET", content_path + "?download=1")
            assert contents == PNG and "attachment" in headers["Content-Disposition"]
            contents, headers = raw("GET", content_path, headers={"Range": "bytes=0-7"}, expected=206)
            assert contents == PNG[:8] and headers["Content-Range"].startswith("bytes 0-7/")
            api("PATCH", scope + f'/episodes/{episode["id"]}', {"cover_media_id": mid})
            api("PATCH", scope + f'/scenes/{scene["id"]}', {"first_media_id": mid})
            assert api("PATCH", scope + f'/scenes/{scene["id"]}', {"title": "新场景"})["description"] == "雨夜"
            assert api("GET", scope + "/scenes?episode_id=" + str(episode["id"]))[0]["id"] == scene["id"]
            api("PATCH", scope + f'/scenes/{scene["id"]}', {"last_media_id": 999999}, 400)
            api("GET", scope + "/roles/999999", expected=404)
            api("PATCH", scope + "/roles/999999", {"name": "missing"}, 404)
            api("DELETE", scope + "/roles/999999", expected=404)
            api("POST", scope + "/roles", {"name": ""}, 400)
            raw("POST", "/api/v1/projects", b"broken json", expected=400)
            raw("POST", "/api/v1/projects", b"[]", expected=400)
            raw("GET", "/api/v1/projects", headers={"Origin": "https://untrusted.example"}, expected=403)
            _, headers = raw("OPTIONS", "/api/v1/projects", headers={"Origin": "http://127.0.0.1:1420", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
            assert headers["Access-Control-Allow-Origin"] == "http://127.0.0.1:1420"
            _, headers = raw("GET", "/api/v1/projects", headers={"Origin": "tauri://localhost"})
            assert headers["Access-Control-Allow-Origin"] == "tauri://localhost"
            # Backup/download/upload/restore crosses the actual HTTP/file boundary.
            backup = api("POST", scope + "/backup", {"include_api_keys": False}, 201)
            archive, _ = raw("GET", backup["url"])
            restored_bytes, _ = raw("POST", "/api/v1/projects/restore-upload", archive, expected=201)
            restored = json.loads(restored_bytes)["data"]
            assert restored["id"] != pid
            assert api("GET", f'/projects/{restored["id"]}/roles')[0]["description"] == "新描述"
            for resource, identifier in [("prompts", prompt["id"]), ("roles", role["id"]), ("scenes", scene["id"]), ("episodes", episode["id"])]:
                api("GET", scope + f"/{resource}/{identifier}")
                api("DELETE", scope + f"/{resource}/{identifier}")
                api("GET", scope + f"/{resource}/{identifier}", expected=404)
            api("PATCH", scope + f"/assets/{mid}", {"name": "重命名.png"})
            api("DELETE", scope + f"/assets/{mid}")
            api("GET", scope + f"/assets/{mid}", expected=404)
            assert api("GET", scope + "/assets?usage=trash")["total"] == 1
            assert api("DELETE", scope)["data_retained"] is True
            assert Path(project["path"]).is_dir()
            api("GET", scope, expected=404)
            print("PASS: six-resource CRUD, PATCH preservation, concurrent projects, binary uploads, references, ranges, backup restore, validation, CORS, SPA hosting")
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
            log.close()

if __name__ == "__main__": main()
