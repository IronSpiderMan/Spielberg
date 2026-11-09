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
            role = api("POST", scope + "/assets", {"name": "主角", "description": "保留描述"}, 201)
            assert api("PATCH", scope + f'/assets/{role["id"]}', {"name": "新名字"})["description"] == "保留描述"
            episode = api("POST", scope + "/episodes", {"title": "第一集", "description": "剧情"}, 201)
            scene = api("POST", scope + "/clips", {"episode_id": episode["id"], "title": "场景一", "description": "雨夜"}, 201)
            prompt = api("POST", scope + "/prompts", {"name": "风格", "content": "水墨", "category": "风格"}, 201)
            assert api("PATCH", scope + f'/prompts/{prompt["id"]}', {"name": "重命名"})["content"] == "水墨"
            # Screenplays persist Markdown, preserve content on rename, and refresh independently.
            markdown = "# 雨夜\n\n**林舟**\n> 你终于来了。"
            screenplay = api("POST", scope + "/screenplays", {"title": "雨夜", "content": markdown, "episode_id": episode["id"]}, 201)
            assert api("GET", scope + f'/episodes/{episode["id"]}/screenplays')[0]["id"] == screenplay["id"]
            api("POST", scope + "/screenplays", {"title": "无归属"}, 400)
            api("POST", scope + "/screenplays", {"title": "无效剧集", "episode_id": 999999}, 404)
            screenplay_path = scope + f'/screenplays/{screenplay["id"]}'
            assert api("PATCH", screenplay_path, {"title": "第一稿"})["content"] == markdown
            snapshot = api("POST", "/actions/project", {"id": pid})
            assert snapshot["assets"][0]["id"] == role["id"] and "roles" not in snapshot
            assert "assets" in snapshot["revisions"] and "roles" not in snapshot["revisions"]
            api("GET", scope + "/roles", expected=404)
            assert snapshot["screenplays"][0]["title"] == "第一稿"
            assert "screenplays" not in api("POST", "/actions/project/changes", {"id": pid, "revisions": snapshot["revisions"]})
            api("PATCH", screenplay_path, {"content": markdown + "\n\n---"})
            changed = api("POST", "/actions/project/changes", {"id": pid, "revisions": snapshot["revisions"]})
            assert changed["screenplays"][0]["content"].endswith("---") and "episodes" not in changed
            another = api("POST", "/projects", {"name": "剧本隔离"}, 201)
            assert api("GET", "/projects/" + another["id"] + "/screenplays") == []
            api("DELETE", "/projects/" + another["id"])
            api("POST", scope + "/screenplays", {"title": "  "}, 400)
            api("PATCH", screenplay_path, {"content": []}, 400)
            api("DELETE", screenplay_path)
            api("GET", screenplay_path, expected=404)
            assert api("GET", scope + "/screenplays") == []
            # Binary upload, role assignment, Unicode query, real file download, and byte ranges.
            contents, _ = raw("POST", "/api/v1" + scope + "/media/upload?" + urllib.parse.urlencode({"name": "参考图.png", "asset_id": role["id"]}), PNG, expected=201)
            asset = json.loads(contents)["data"]; mid = asset["id"]
            assert api("GET", scope + f'/assets/{role["id"]}')["images"][0]["id"] == mid
            assets = api("GET", scope + "/media?" + urllib.parse.urlencode({"query": "参考图", "limit": 1}))
            assert assets["total"] == 1 and len(assets["items"]) == 1
            api("PATCH", scope + f'/assets/{role["id"]}', {"design_media_id": mid})
            api("PATCH", scope + f'/assets/{role["id"]}', {"description": "新描述"})
            assert api("GET", scope + f'/assets/{role["id"]}')["design_media_id"] == mid
            api("DELETE", scope + f"/media/{mid}", expected=409)
            content_path = "/api/v1" + scope + f"/media/{mid}/content"
            contents, headers = raw("GET", content_path + "?download=1")
            assert contents == PNG and "attachment" in headers["Content-Disposition"]
            contents, headers = raw("GET", content_path, headers={"Range": "bytes=0-7"}, expected=206)
            assert contents == PNG[:8] and headers["Content-Range"].startswith("bytes 0-7/")
            api("PATCH", scope + f'/episodes/{episode["id"]}', {"cover_media_id": mid})
            api("PATCH", scope + f'/clips/{scene["id"]}', {"first_media_id": mid})
            assert api("PATCH", scope + f'/clips/{scene["id"]}', {"title": "新场景"})["description"] == "雨夜"
            assert api("GET", scope + "/clips?episode_id=" + str(episode["id"]))[0]["id"] == scene["id"]
            api("PATCH", scope + f'/clips/{scene["id"]}', {"last_media_id": 999999}, 400)
            # Narrative scenes own ordered clips and become one playback unit in one-take mode.
            episode_path = scope + f'/episodes/{episode["id"]}'
            parent = api("POST", episode_path + "/scenes", {
                "title": "连续片段", "shared_prompt": "暖色顶光", "reference_media_ids": [mid]
            }, 201)
            second = parent["clips"][0]
            third = api("POST", episode_path + "/clips", {"scene_id": parent["id"], "title": "后续动作"}, 201)
            members = api("GET", scope + "/clips?scene_id=" + str(parent["id"]))
            assert [clip["id"] for clip in members] == [second["id"], third["id"]]
            api("POST", "/actions/clips/reorder", {"project_id": pid, "episode_id": episode["id"],
                "clip_ids": [second["id"], scene["id"], third["id"]]}, 400)
            parent_path = scope + f'/scenes/{parent["id"]}'
            assert api("PATCH", parent_path, {"generation_mode": "one_take"})["shared_prompt"] == "暖色顶光"
            assert [unit["kind"] for unit in api("GET", episode_path)["playback_units"]] == ["clip", "scene"]
            api("POST", "/actions/scenes/reorder", {"project_id": pid, "episode_id": episode["id"],
                "scene_ids": [parent["id"], scene["scene_id"]]})
            assert [unit["kind"] for unit in api("GET", episode_path)["playback_units"]] == ["scene", "clip"]
            scene_collection = episode_path + "/scenes"
            before = api("POST", scene_collection, {
                "title": "前插场景", "anchor_scene_id": parent["id"], "position": "before"
            }, 201)
            after = api("POST", scene_collection, {
                "title": "后插场景", "anchor_scene_id": parent["id"], "position": "after"
            }, 201)
            api("POST", scene_collection, {"title": "缺少位置", "anchor_scene_id": parent["id"]}, 400)
            api("POST", scene_collection, {
                "title": "无效目标", "anchor_scene_id": 999999, "position": "after"
            }, 404)
            ordered = api("GET", episode_path)
            assert [item["id"] for item in ordered["scenes"]] == [before["id"], parent["id"], after["id"], scene["scene_id"]]
            assert [clip["id"] for clip in ordered["clips"]] == [
                before["clips"][0]["id"], second["id"], third["id"], after["clips"][0]["id"], scene["id"]
            ]
            for inserted in (before, after):
                api("DELETE", scope + f'/scenes/{inserted["id"]}')
            duplicates = [api("POST", "/actions/scenes/duplicate", {
                "project_id": pid, "id": parent["id"], "position": position
            }) for position in ("before", "after")]
            assert [item["id"] for item in api("GET", episode_path)["scenes"]] == [
                duplicates[0]["id"], parent["id"], duplicates[1]["id"], scene["scene_id"]
            ]
            for duplicate in duplicates:
                assert duplicate["title"] == parent["title"] + "（副本）"
                assert duplicate["shared_prompt"] == parent["shared_prompt"]
                assert duplicate["generation_mode"] == "one_take"
                assert duplicate["reference_media_ids"] == [mid]
                assert [clip["title"] for clip in duplicate["clips"]] == [second["title"], third["title"]]
                assert {clip["id"] for clip in duplicate["clips"]}.isdisjoint([second["id"], third["id"]])
                api("DELETE", scope + f'/scenes/{duplicate["id"]}')
            split = api("POST", "/actions/scenes/ungroup", {"project_id": pid, "scene_id": parent["id"]})
            assert len(split["scene_ids"]) == 2
            assert api("GET", scope + f'/scenes/{split["scene_ids"][0]}')["shared_prompt"] == "暖色顶光"
            api("GET", parent_path, expected=404)
            grouped = api("POST", episode_path + "/scenes", {
                "title": "重组", "clip_ids": [second["id"], third["id"]]
            }, 201)
            assert len(grouped["clips"]) == 2
            api("DELETE", scope + f'/scenes/{grouped["id"]}')
            api("GET", scope + f'/clips/{third["id"]}', expected=404)
            assert api("GET", scope + f'/media/{mid}')["kind"] == "image"
            api("GET", scope + "/assets/999999", expected=404)
            api("PATCH", scope + "/assets/999999", {"name": "missing"}, 404)
            api("DELETE", scope + "/assets/999999", expected=404)
            api("POST", scope + "/assets", {"name": ""}, 400)
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
            assert api("GET", f'/projects/{restored["id"]}/assets')[0]["description"] == "新描述"
            for resource, identifier in [("prompts", prompt["id"]), ("assets", role["id"]), ("clips", scene["id"]), ("episodes", episode["id"])]:
                api("GET", scope + f"/{resource}/{identifier}")
                api("DELETE", scope + f"/{resource}/{identifier}")
                api("GET", scope + f"/{resource}/{identifier}", expected=404)
            api("PATCH", scope + f"/media/{mid}", {"name": "重命名.png"})
            api("DELETE", scope + f"/media/{mid}")
            api("GET", scope + f"/media/{mid}", expected=404)
            assert api("GET", scope + "/media?usage=trash")["total"] == 1
            assert api("DELETE", scope)["data_retained"] is True
            assert Path(project["path"]).is_dir()
            api("GET", scope, expected=404)
            # SVG is an image throughout binary upload, inline serving, downloads,
            # direct Agent-style creation, thumbnails and model-reference storage.
            svg_project = api("POST", "/projects", {"name": "SVG validation"}, 201)
            svg_scope = "/projects/" + svg_project["id"]
            svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect width="120" height="80" fill="red"/></svg>'
            uploaded, _ = raw("POST", "/api/v1" + svg_scope + "/media/upload?name=vector.SVG", svg, expected=201)
            vector = json.loads(uploaded)["data"]
            assert vector["kind"] == "image"
            content_path = "/api/v1" + svg_scope + f'/media/{vector["id"]}/content'
            for suffix in ["", "?download=1"]:
                content, headers = raw("GET", content_path + suffix)
                assert content == svg and headers["Content-Type"] == "image/svg+xml"
                assert "sandbox" in headers["Content-Security-Policy"] and headers["X-Content-Type-Options"] == "nosniff"
                if suffix: assert "attachment" in headers["Content-Disposition"]
            thumb = api("POST", "/actions/media/thumbnail", {"project_id": svg_project["id"], "id": vector["id"]})
            from urllib.parse import urlencode
            content, _ = raw("GET", "/media?" + urlencode({"path": thumb["path"]}))
            assert content.startswith(b"\x89PNG")
            direct = api("POST", "/actions/media/create-svg", {"project_id": svg_project["id"], "name": "Agent vector", "svg": svg.decode()})
            assert direct["name"] == "Agent vector.svg" and direct["kind"] == "image"
            raw("POST", "/api/v1" + svg_scope + "/media/upload?name=bad.svg", b"<svg/>", expected=400)
            api("POST", "/actions/media/create-svg", {"project_id": svg_project["id"], "name": "bad", "svg": svg.decode().replace("<rect", '<script>alert(1)</script><rect')}, 400)
            assert api("GET", svg_scope + "/media?kind=image")["total"] == 2
            api("DELETE", svg_scope)
            print("PASS: scene and clip hierarchy, eight-resource CRUD, PATCH preservation, concurrent projects, binary uploads, references, ranges, backup restore, SVG upload/create/preview/download/thumbnail/validation, CORS, SPA hosting")
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
            log.close()

if __name__ == "__main__": main()
