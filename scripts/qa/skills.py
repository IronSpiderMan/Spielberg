#!/usr/bin/env python3
"""Real Skills HTTP + Agent regression using disposable data and a local model."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
BINARY = Path(os.environ.get("SPIELBERG_TEST_BINARY", ROOT / "backend/target/debug/spielberg-backend"))
SECRET = "skills-qa-private-key"
BODY_MARKER = "SKILL_BODY_NOT_IN_INITIAL_CATALOG"
SKILL = """---
name: qa-story-workflow
description: Compose a short rain-night story using the installed QA workflow.
---
# QA story workflow

SKILL_BODY_NOT_IN_INITIAL_CATALOG

Read references/guide.md, then explain the workflow.
"""
GUIDE = "# 参考资料\n\n雨夜车站：先描述人物，再描述光线。🎬\n"
LONG = ("中文🎬分页验证：角色走进雨夜车站。\n" * 83) + "文件结尾✅"


def file(path, content):
    return {"path": path, "content_base64": base64.b64encode(content.encode()).decode()}


def tool(name, arguments, call_id):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}


class Model(BaseHTTPRequestHandler):
    requests = []
    errors = []

    def log_message(self, *_):
        pass

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            self.requests.append(body)
            assert SECRET not in json.dumps(body, ensure_ascii=False), "Credential leaked into model context"
            messages = body["messages"]
            last_user = max(i for i, message in enumerate(messages) if message["role"] == "user")
            task = json.loads(messages[last_user]["content"].split("SKILLS_QA:", 1)[1])
            results = [message for message in messages[last_user + 1:] if message["role"] == "tool"]
            system = "\n".join(message["content"] for message in messages if message["role"] == "system")
            assert BODY_MARKER not in system, "Full Skill body was injected instead of metadata"
            assert GUIDE not in system, "Auxiliary text was injected into metadata catalog"
            tools = {item["function"]["name"] for item in body["tools"]}
            assert {"list_skills", "read_skill"} <= tools
            assert (task["id"] in system) is task["enabled"], (task, system)
            calls = []
            if not results:
                calls = [tool("list_skills", {"offset": 0, "limit": 1}, "catalog")]
            elif len(results) == 1:
                catalog = json.loads(results[0]["content"])
                assert isinstance(catalog["items"], list) and isinstance(catalog["total"], int), catalog
                assert all(set(item) == {"id", "name", "description"} for item in catalog["items"]), catalog
                assert (task["id"] in [item["id"] for item in catalog["items"]]) is task["enabled"], catalog
                args = {"id": task["id"]}
                if task.get("path"):
                    args["path"] = task["path"]
                if task["scenario"] == "pagination":
                    args.update(path="references/long.txt", max_chars=137)
                calls = [tool("read_skill", args, "read-0")]
            elif task["scenario"] == "read" and len(results) == 2:
                result = json.loads(results[-1]["content"])
                assert result["content"] == SKILL and result["path"] == "SKILL.md", result
                assert result["truncated"] is False and result["next_offset"] is None, result
                calls = [tool("read_skill", {"id": task["id"], "path": "references/guide.md"}, "reference")]
            elif task["scenario"] == "pagination":
                result = json.loads(results[-1]["content"])
                assert "error" not in result, result
                pages = [json.loads(message["content"]) for message in results[1:]]
                for index, page in enumerate(pages):
                    assert page["total_chars"] == len(LONG), page
                    assert page["offset"] == sum(len(p["content"]) for p in pages[:index]), page
                    assert len(page["content"]) <= 137, page
                if result["next_offset"] is not None:
                    assert result["truncated"] is True
                    calls = [tool("read_skill", {"id": task["id"], "path": "references/long.txt", "offset": result["next_offset"], "max_chars": 137}, "page-" + str(len(pages)))]
                else:
                    assert "".join(page["content"] for page in pages) == LONG
            elif task["scenario"] == "read":
                result = json.loads(results[-1]["content"])
                assert result["content"] == GUIDE and result["path"] == "references/guide.md", result
            elif task["scenario"] == "reject":
                assert "error" in json.loads(results[-1]["content"]), results[-1]
            else:
                raise AssertionError((task, results))
            message = {"role": "assistant", "content": None, "tool_calls": calls} if calls else {"role": "assistant", "content": "已完成技能读取验证。"}
            payload = {"choices": [{"message": message, "finish_reason": "tool_calls" if calls else "stop"}]}
            status = 200
        except Exception as error:
            self.errors.append(repr(error))
            payload, status = {"error": {"message": repr(error)}}, 500
        encoded = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main():
    model = ThreadingHTTPServer(("127.0.0.1", 0), Model)
    threading.Thread(target=model.serve_forever, daemon=True).start()
    process = None
    with tempfile.TemporaryDirectory(prefix="spielberg-skills-qa-") as temporary:
        data_dir = Path(temporary) / "data"

        def start():
            child = subprocess.Popen([str(BINARY)], env={**os.environ, "SPIELBERG_DATA_DIR": str(data_dir), "SPIELBERG_BIND": "127.0.0.1:0"}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            line = child.stdout.readline()
            assert "Spielberg listening at " in line, (line, child.stderr.read() if child.poll() is not None else "")
            return child, line.split("Spielberg listening at ")[1].strip()

        def stop():
            if process and process.poll() is None:
                process.terminate()
                process.wait(timeout=10)

        try:
            process, base = start()

            def api(path, data=None, expected=200, method="POST", timeout=15):
                request = Request(base + "/api/v1" + path, data=None if data is None else json.dumps(data).encode(), method=method, headers={"Content-Type": "application/json"})
                try:
                    response = urlopen(request, timeout=timeout)
                except HTTPError as error:
                    response = error
                result = json.loads(response.read())
                assert response.status in (expected if isinstance(expected, tuple) else (expected,)), (path, response.status, expected, result)
                return result.get("data", result)

            def skills(action, data=None, expected=200, timeout=15):
                return api("/actions/skills/" + action, data or {}, expected, timeout=timeout)

            def items(value):
                return value if isinstance(value, list) else value["items"]

            def configure(pid):
                api("/actions/settings", {"project_id": pid, "settings": {"llm": {"base_url": f"http://127.0.0.1:{model.server_port}/v1", "model": "skills-qa-model", "api_key": SECRET}}})
                api("/actions/agent/config/save", {"project_id": pid, "config": {"max_steps": 64}})

            def run(pid, skill_id, scenario="read", enabled=True, session=None, path=None):
                session = session or api("/actions/agent/create", {"project_id": pid})
                task = {"scenario": scenario, "id": skill_id, "enabled": enabled, "path": path}
                api("/actions/agent/run", {"project_id": pid, "session_id": session["id"], "message": "SKILLS_QA:" + json.dumps(task), "web_enabled": False})
                for _ in range(600):
                    result = api("/actions/agent/session", {"project_id": pid, "session_id": session["id"]})
                    if result["status"] != "running":
                        assert not Model.errors, Model.errors
                        assert result["status"] == "completed", result
                        return result
                    time.sleep(0.05)
                raise AssertionError("Agent skill fixture timed out")

            assert items(skills("list")) == []
            upload = {"source_name": "本地 QA 文件夹", "files": [file("SKILL.md", SKILL), file("references/guide.md", GUIDE), file("references/long.txt", LONG)]}
            installed = skills("install", upload)
            skill_id = installed["id"]
            assert installed["name"] == "qa-story-workflow" and installed["enabled"] is True, installed
            assert installed["source"] == upload["source_name"] and installed["files_count"] == 3, installed
            assert installed["installed_at"] and installed["updated_at"], installed
            assert {"id", "name", "description", "enabled", "source", "installed_at", "updated_at", "files_count"} <= set(installed), installed
            detail = skills("detail", {"id": skill_id})
            assert detail["content"] == SKILL, detail
            assert {item["path"]: item["size"] for item in detail["files"]} == {"SKILL.md": len(SKILL.encode()), "references/guide.md": len(GUIDE.encode()), "references/long.txt": len(LONG.encode())}, detail
            skills("install", upload, expected=(400, 409))
            invalid = [
                {"files": [file("SKILL.md", "# Missing frontmatter\n")]},
                {"files": [file("SKILL.md", "---\nname: no-description\n---\nBody")]},
                {"files": [file("SKILL.md", "---\nname: invalid name\ndescription: Description\n---\nBody")]},
                {"files": [file("../SKILL.md", SKILL)]},
                {"files": [file("/SKILL.md", SKILL)]},
                {"files": [file("SKILL.md", SKILL), file("references/../../escape.md", "escape")]},
                {"files": [file("SKILL.md", SKILL), file("references\\escape.md", "escape")]},
                {"files": [file("SKILL.md", SKILL), file("SKILL.md", SKILL)]},
                {"files": [{"path": "SKILL.md", "content_base64": "not valid base64!"}]},
                {"files": [file("SKILL.md", SKILL + "a" * 32768)]},
                {"source": "http://github.com/owner/repo"},
                {"source": "https://example.com/owner/repo"},
            ]
            for value in invalid:
                skills("install", value, expected=(400, 409, 413, 422))
            for action in ["detail", "toggle", "delete", "update"]:
                skills(action, {"id": "../../outside", "enabled": False}, expected=(400, 404, 422))
            assert len(items(skills("list"))) == 1
            first = api("/projects", {"name": "Skills 项目一"}, 201)
            second = api("/projects", {"name": "Skills 项目二"}, 201)
            for project in [first, second]:
                configure(project["id"])
                assert [item["id"] for item in items(skills("list", {"project_id": project["id"]}))] == [skill_id]
            session = run(first["id"], skill_id)
            run(second["id"], skill_id)
            run(first["id"], skill_id, "pagination")
            run(first["id"], skill_id, "reject", path="../secret.txt")
            disabled = skills("toggle", {"id": skill_id, "enabled": False})
            assert disabled["enabled"] is False
            # Reuse the conversation containing previous instructions: disabled skills must stop being readable.
            run(first["id"], skill_id, "reject", enabled=False, session=session)
            assert skills("detail", {"id": skill_id})["content"] == SKILL
            stop()
            process, base = start()
            persisted = skills("detail", {"id": skill_id})
            assert persisted["enabled"] is False and persisted["content"] == SKILL
            assert persisted["installed_at"] == installed["installed_at"]
            skills("toggle", {"id": skill_id, "enabled": True})
            run(second["id"], skill_id)
            # GitHub update is unavailable for local imports; reimport explicitly replaces a local package.
            skills("toggle", {"id": skill_id, "enabled": False})
            skills("update", {"id": skill_id}, expected=400)
            updated_upload = {**upload, "replace_id": skill_id, "files": [file("SKILL.md", SKILL + "\nUpdated locally.\n"), file("references/guide.md", GUIDE)]}
            updated = skills("install", updated_upload)
            assert updated["id"] == skill_id and updated["enabled"] is False and updated["files_count"] == 2, updated
            assert skills("detail", {"id": skill_id})["content"].endswith("Updated locally.\n")
            assert skills("delete", {"id": skill_id})["ok"] is True
            assert items(skills("list")) == []
            skills("detail", {"id": skill_id}, expected=(400, 404))
            run(first["id"], skill_id, "reject", enabled=False, session=session)
            stop()
            process, base = start()
            assert items(skills("list")) == []
            # Opt in with a public Skill directory URL to exercise the real GitHub download/update path.
            github_source = os.environ.get("SKILLS_GITHUB_SMOKE")
            if github_source:
                github = skills("install", {"source": github_source}, timeout=120)
                assert github["source"].startswith("https://github.com/") and github["files_count"] >= 1, github
                skills("toggle", {"id": github["id"], "enabled": False})
                refreshed = skills("update", {"id": github["id"]}, timeout=120)
                assert refreshed["id"] == github["id"] and refreshed["enabled"] is False, refreshed
                assert refreshed["installed_at"] == github["installed_at"] and refreshed["files_count"] >= 1, refreshed
                assert skills("detail", {"id": github["id"]})["content"].startswith("---")
                assert skills("delete", {"id": github["id"]})["ok"] is True
                assert items(skills("list")) == []
                print("PASS: actual public GitHub Skill install, refresh with disabled preference preserved, detail and uninstall")
            assert Model.requests and not Model.errors, Model.errors
            print("PASS: real Skills HTTP install/list/detail/update/toggle/delete, validation, global cross-project sharing, offline Agent metadata/catalog/body/reference tools, Unicode pagination, disabled/uninstalled access denial and restart persistence")
        finally:
            stop()
            model.shutdown()


if __name__ == "__main__":
    main()
