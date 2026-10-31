#!/usr/bin/env python3
"""Real Agent HTTP regression with disposable projects and a local model fixture."""
import base64
import json
import os
from pathlib import Path
import subprocess
import struct
import tempfile
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
BINARY = Path(os.environ.get("SPIELBERG_TEST_BINARY", ROOT / "backend/target/debug/spielberg-backend"))
SECRET = "agent-qa-private-key"
FOREIGN_HISTORY_MARKER = "history-only-in-a-different-session-2908"


def message_text(message):
    content = message.get("content", "")
    if isinstance(content, list):
        return "\n".join(part.get("text", "") for part in content if part.get("type") == "text")
    return content or ""


def fixture_image():
    # A valid PNG larger than the old 80 KB history budget, without image libraries.
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
    pixels = b"".join(b"\0" + os.urandom(256 * 3) for _ in range(256))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 256, 256, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(png).decode()


def assert_tool_protocol(messages):
    pending = []
    for message in messages:
        if message["role"] == "tool":
            assert pending and message["tool_call_id"] == pending.pop(0), "Orphaned or reordered tool response"
        else:
            assert not pending, "Tool call lost its response during context compaction"
            pending = [item["id"] for item in message.get("tool_calls", [])]
    assert not pending, "Incomplete tool call sent to the model"


def call(name, arguments, call_id):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}


class Model(BaseHTTPRequestHandler):
    requests = []
    delayed = threading.Event()
    body_delayed = threading.Event()
    retry_delayed = threading.Event()
    retried_after_write = False

    def log_message(self, *_):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.requests.append(body)
        assert SECRET not in json.dumps(body, ensure_ascii=False), "Credential leaked into model context"
        messages = body["messages"]
        last_user = max(i for i, message in enumerate(messages) if message["role"] == "user")
        prompt = message_text(messages[last_user])
        tools = [m for m in messages[last_user + 1:] if m["role"] == "tool"]
        advertised = {tool["function"]["name"] for tool in body.get("tools", [])}
        if body.get("tool_choice") != "none":
            assert "update_plan" in advertised
            if "WEB_DISABLED" in prompt:
                assert "web_search" not in advertised and "fetch_webpage" not in advertised
        if "BODY_CANCEL" in prompt:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.flush()
            self.body_delayed.set()
            time.sleep(4)
            try:
                self.wfile.write(b'{"choices":[{"message":{"role":"assistant","content":"late response"}}]}')
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        if "RETRY_CANCEL" in prompt:
            self.send_response(429)
            self.send_header("Retry-After", "10")
            self.end_headers()
            self.retry_delayed.set()
            return
        if "LONG_RETRY_AFTER" in prompt:
            self.send_response(429)
            self.send_header("Retry-After", "60")
            self.end_headers()
            return
        if "DATE_RETRY_AFTER" in prompt:
            self.send_response(429)
            self.send_header("Retry-After", "Wed, 01 Jan 2031 00:00:00 GMT")
            self.end_headers()
            return
        if "AFTER_WRITE_RETRY" in prompt and tools and not Model.retried_after_write:
            Model.retried_after_write = True
            self.send_response(503)
            self.end_headers()
            return
        if "UPSTREAM_ERROR" in prompt:
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": {"message": "fixture unavailable"}}).encode())
            return
        calls = []
        if body.get("tool_choice") == "none":
            assert not body.get("tools"), "Finalization still advertises side effects"
            if "BUDGET_IGNORED" in prompt:
                calls = [call("app_request", {"resource": "roles", "method": "POST", "data": {"name": "Forbidden during finalization"}}, "forbidden-final-write")]
        elif "LIBRARY_ADAPT:" in prompt:
            refs = json.loads(prompt.split("LIBRARY_ADAPT:", 1)[1])
            instruction = message_text(messages[0])
            assert "resource=roles" in instruction and "resource=assets" in instruction
            assert "用户粘贴图片会自动加入项目素材库" in instruction
            action_schema = next(tool["function"] for tool in body["tools"] if tool["function"]["name"] == "app_action")
            assert "roles/audio/save" in action_schema["parameters"]["properties"]["operation"]["enum"]
            assert "roles/audio/delete" in action_schema["parameters"]["properties"]["operation"]["enum"]
            if not tools:
                calls = [call("app_describe", {"operation": name}, "library-describe-" + str(index))
                         for index, name in enumerate(["roles", "assets", "roles/audio/save"])]
            elif len(tools) == 3:
                calls = [call("app_request", {"resource": "roles", "method": "POST", "data": {
                    "name": "Agent category " + category, "category": category, "description": "Library integration fixture"
                }}, "library-create-" + category) for category in ["person", "location", "object", "creature", "vehicle", "other"]]
            elif len(tools) == 9:
                location = json.loads(tools[4]["content"])
                calls = [
                    call("app_action", {"operation": "roles/media/add", "data": {"role_id": location["id"], "media_id": refs["image_id"]}}, "library-image"),
                    call("app_action", {"operation": "roles/audio/save", "data": {"role_id": location["id"], "media_id": refs["audio_id"], "name": "车站环境音"}}, "library-audio"),
                    call("app_request", {"resource": "roles", "method": "PATCH", "id": location["id"], "data": {"enabled": False}}, "library-disable"),
                ]
            elif len(tools) == 12:
                calls = [
                    call("app_request", {"resource": "roles", "method": "GET", "data": {"category": "location", "enabled": False, "query": "Agent category"}}, "library-filter"),
                    call("app_request", {"resource": "assets", "method": "GET", "data": {"kind": "audio"}}, "library-media"),
                    call("get_project", {}, "library-verify"),
                ]
        elif "PLAN_RESUME" in prompt:
            assert "核对当前角色后继续" in json.dumps(messages, ensure_ascii=False), "Unfinished plan lost on resume"
            if not tools:
                calls = [call("update_plan", {"plan": [{"step": "核对当前角色后继续", "status": "completed"}]}, "plan-done")]
        elif "PLAN_PENDING" in prompt and not tools:
            calls = [call("update_plan", {"plan": [{"step": "核对当前角色后继续", "status": "in_progress"}, {"step": "验证结果", "status": "pending"}]}, "plan-start")]
        elif "AFTER_WRITE_RETRY" in prompt:
            if not tools:
                calls = [call("app_request", {"resource": "roles", "method": "POST", "data": {"name": "Retry creates only once"}}, "retry-write")]
        elif "BATCH_LIMIT" in prompt:
            calls = [call("app_request", {"resource": "roles", "method": "POST", "data": {"name": name}}, "budget-" + str(i)) for i, name in enumerate(["Budget first", "Budget skipped"])]
        elif "FAIL_LOOP" in prompt:
            calls = [call("unavailable_tool", {}, "failure-" + str(len(tools)))]
        elif "CANCEL" in prompt:
            self.delayed.set()
            time.sleep(1.5)
            calls = [call("app_request", {"resource": "roles", "method": "POST", "data": {"name": "Must not be created"}}, "cancelled-write")]
        elif "LOOP" in prompt:
            calls = [call("get_project", {}, "loop-" + str(len(tools)))]
        elif not tools and "HISTORY_SEARCH" in prompt:
            calls = [call("search_conversation", {"query": "memory_brief", "limit": 2}, "history-search")]
        elif not tools and "HISTORY_PAGE:" in prompt:
            index, offset = prompt.split("HISTORY_PAGE:")[1].strip().split(":")
            calls = [call("search_conversation", {"message_index": int(index), "content_offset": int(offset), "max_chars": 6000}, "history-page")]
        elif not tools and "HISTORY_FOREIGN" in prompt:
            calls = [call("search_conversation", {"query": FOREIGN_HISTORY_MARKER}, "history-foreign")]
        elif not tools and "HISTORY_SCOPE_SESSION:" in prompt:
            target = prompt.split("HISTORY_SCOPE_SESSION:")[1].strip()
            calls = [call("search_conversation", {"session_id": target}, "history-scope-session")]
        elif not tools and "HISTORY_SCOPE_PROJECT:" in prompt:
            target = prompt.split("HISTORY_SCOPE_PROJECT:")[1].strip()
            calls = [call("search_conversation", {"project_id": target}, "history-scope-project")]
        elif not tools and "WEB_LIVE" in prompt:
            calls = [call("web_search", {"query": "film cinematography lighting", "max_results": 3}, "web-live"), call("fetch_webpage", {"url": "https://example.com", "max_chars": 500}, "page-live")]
        elif not tools and "SCOPE:" in prompt:
            other = prompt.split("SCOPE:")[1].strip()
            calls = [call("app_request", {"resource": "roles", "method": "POST", "data": {"project_id": other, "name": "Escaped"}}, "scope")]
        elif not tools and "WEB_DISABLED" in prompt:
            calls = [call("web_search", {"query": "film composition"}, "web")]
        elif not tools and "UNKNOWN_TOOL" in prompt:
            calls = [call("unavailable_tool", {}, "unknown")]
        elif not tools and "MALFORMED" in prompt:
            calls = [call("get_project", {}, "malformed")]
            calls[0]["function"]["arguments"] = "invalid JSON"
        elif not tools and "CREATE" in prompt:
            calls = [
                call("app_request", {"resource": "roles", "method": "POST", "data": {"name": "林晓", "description": "红色外套"}}, "role"),
                call("app_request", {"resource": "episodes", "method": "POST", "data": {"title": "第一集"}}, "episode"),
            ]
        elif len(tools) == 2 and "CREATE" in prompt:
            episode = json.loads(tools[1]["content"])
            # Tool results are JSON objects, not sliced JSON text.
            if "data" in episode:
                episode = episode["data"]
            calls = [call("app_request", {"resource": "scenes", "method": "POST", "episode_id": episode["id"], "data": {"title": "车站", "description": "雨夜走进车站"}}, "scene"),
                call("app_request", {"resource": "screenplays", "method": "POST", "episode_id": episode["id"], "data": {"title": "Agent 剧本", "content": "# 雨夜\n\n主角走进车站。"}}, "script")]
        elif not tools and "PLAN_PENDING" not in prompt:
            calls = [call("get_project", {}, "overview")]
        reply = {"role": "assistant", "content": None, "tool_calls": calls} if calls else {"role": "assistant", "content": "已完成操作。"}
        payload = json.dumps({"choices": [{"message": reply, "finish_reason": "tool_calls" if calls else "stop"}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        try:
            self.wfile.write(payload)
        except BrokenPipeError:
            pass


def main():
    model = ThreadingHTTPServer(("127.0.0.1", 0), Model)
    threading.Thread(target=model.serve_forever, daemon=True).start()
    process = None
    with tempfile.TemporaryDirectory(prefix="spielberg-agent-qa-") as temporary:
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
            def api(path, data=None, expected=200, method="POST"):
                payload = None if data is None else json.dumps(data).encode()
                request = Request(base + "/api/v1" + path, data=payload, method=method, headers={"Content-Type": "application/json"})
                try:
                    response = urlopen(request, timeout=15)
                except HTTPError as error:
                    response = error
                body = json.loads(response.read())
                assert response.status in (expected if isinstance(expected, tuple) else (expected,)), (path, response.status, expected, body)
                return body.get("data", body)
            project = api("/projects", {"name": "Agent QA"}, 201)
            other = api("/projects", {"name": "Isolation QA"}, 201)
            pid = project["id"]
            def agent(action, **data):
                return api("/actions/agent/" + action, {"project_id": pid, **data})
            def wait(session):
                for _ in range(1200):
                    result = agent("session", session_id=session["id"])
                    if result["status"] != "running":
                        return result
                    time.sleep(0.05)
                raise AssertionError("Agent did not finish")
            assert agent("sessions")["items"] == []
            config = agent("config")
            assert config["inherit_llm"] is True and config["search_provider"] == "duckduckgo"
            # Missing model configuration must be reported without losing the conversation.
            no_model = agent("create")
            missing = api("/actions/agent/run", {"project_id": pid, "session_id": no_model["id"], "message": "hello"}, expected=400)
            assert "error" in missing
            api("/actions/settings", {"project_id": pid, "settings": {"llm": {"base_url": f"http://127.0.0.1:{model.server_port}/v1", "model": "qa-model", "api_key": SECRET}}})
            configured = agent("config")
            assert SECRET not in json.dumps(configured)
            created = agent("create", title="实际创建内容")
            running = agent("run", session_id=created["id"], message="CREATE", web_enabled=True)
            assert running["status"] == "running"
            finished = wait(created)
            assert finished["status"] == "completed", finished
            assert len([m for m in finished["messages"] if m["role"] == "tool"]) == 4
            assert len(api(f"/projects/{pid}/screenplays", method="GET")) == 1
            assert len(api(f"/projects/{pid}/roles", method="GET")) == 1
            assert len(api(f"/projects/{pid}/episodes", method="GET")[0]["scenes"]) == 1
            # Follow-up must preserve context and not repeat the previous mutations.
            agent("run", session_id=created["id"], message="查看项目", web_enabled=False)
            assert wait(created)["status"] == "completed"
            for message in ["SCOPE:" + other["id"], "WEB_DISABLED", "UNKNOWN_TOOL", "MALFORMED"]:
                session = agent("create")
                agent("run", session_id=session["id"], message=message, web_enabled=False)
                result = wait(session)
                assert result["status"] in ("completed", "failed"), result
                trace = [m for m in result["messages"] if m["role"] == "tool"]
                assert trace and any(m.get("status") == "failed" or "error" in m["content"] for m in trace), result
            assert api(f'/projects/{other["id"]}/roles', method="GET") == []
            if os.environ.get("AGENT_WEB_SMOKE") == "1":
                web = agent("create")
                agent("run", session_id=web["id"], message="WEB_LIVE", web_enabled=True)
                live = wait(web)
                assert live["status"] == "completed", live
                traces = [m for m in live["messages"] if m["role"] == "tool"]
                assert all(m["status"] == "completed" for m in traces), traces
                results = json.loads(traces[0]["content"])
                assert len(results["results"]) > 0, results
                assert "Example Domain" in json.loads(traces[1]["content"])["text"]
                print("PASS: actual public search + webpage reader; search provider:", results["provider"])
            # Upstream failures remain visible and the same conversation can recover.
            session = agent("create")
            agent("run", session_id=session["id"], message="UPSTREAM_ERROR")
            assert wait(session)["status"] == "failed"
            agent("run", session_id=session["id"], message="恢复")
            assert wait(session)["status"] == "completed"
            session = agent("create")
            agent("run", session_id=session["id"], message="CANCEL")
            assert Model.delayed.wait(timeout=5)
            api("/actions/agent/run", {"project_id": pid, "session_id": session["id"], "message": "overlapping run"}, expected=(400, 409))
            assert agent("cancel", session_id=session["id"])["status"] == "cancelled"
            time.sleep(1.8)
            assert wait(session)["status"] == "cancelled"
            assert len(api(f"/projects/{pid}/roles", method="GET")) == 1
            # Drive the actual Agent loop through both libraries, categories and associations.
            png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
            image_media = api(f"/projects/{pid}/assets", {"name": "station.png", "extension": "png", "data_base64": png}, 201)
            wav = b"RIFF" + struct.pack("<I", 38) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 16000, 2, 16) + b"data" + struct.pack("<I", 2) + b"\x00\x00"
            audio_media = api(f"/projects/{pid}/assets", {"name": "station.wav", "extension": "wav", "data_base64": base64.b64encode(wav).decode()}, 201)
            libraries = agent("create", title="六类资产与素材适配")
            agent("run", session_id=libraries["id"], message="LIBRARY_ADAPT:" + json.dumps({"image_id": image_media["id"], "audio_id": audio_media["id"]}))
            adapted = wait(libraries)
            assert adapted["status"] == "completed", adapted.get("error")
            traces = [message for message in adapted["messages"] if message["role"] == "tool"]
            assert len(traces) == 15 and all(message["status"] == "completed" for message in traces), traces
            subjects = api(f"/projects/{pid}/roles?query=Agent%20category", method="GET")
            assert {subject["category"] for subject in subjects} == {"person", "location", "object", "creature", "vehicle", "other"}
            location = next(subject for subject in subjects if subject["category"] == "location")
            assert location["enabled"] is False and location["images"][0]["id"] == image_media["id"]
            assert location["audios"][0]["name"] == "车站环境音"
            assert api(f"/projects/{pid}/assets/{audio_media['id']}", method="GET")["name"] == "station.wav"
            assert api(f"/projects/{pid}/roles?category=location&enabled=false&query=Agent%20category", method="GET") == [location]
            assert api(f"/projects/{pid}/roles?category=location&enabled=true&query=Agent%20category", method="GET") == []
            api(f"/projects/{pid}/roles?enabled=invalid", expected=400, method="GET")
            # Audio unlinking via the public action also retains the source media file.
            api("/actions/roles/audio/delete", {"project_id": pid, "role_id": location["id"], "media_id": audio_media["id"]})
            assert api(f"/projects/{pid}/roles/{location['id']}", method="GET")["audios"] == []
            assert api(f"/projects/{pid}/assets/{audio_media['id']}", method="GET")["id"] == audio_media["id"]
            print("PASS: Agent model loop uses six-category assets, image/audio media associations, disabled filtering and HTTP query booleans")
            # A prior image must not evict the user's brief on the next short follow-up.
            vision = agent("create", title="图片连续对话")
            image = fixture_image()
            assert len(image) > 80_000
            image_brief = "VISION_BRIEF: 林晓始终穿红色外套，保持雨夜车站的画风。"
            agent("run", session_id=vision["id"], message=image_brief, images=[image])
            assert wait(vision)["status"] == "completed"
            request_start = len(Model.requests)
            agent("run", session_id=vision["id"], message="VISION_FOLLOWUP: 按刚才的参考继续。")
            vision_result = wait(vision)
            assert vision_result["status"] == "completed", vision_result.get("error")
            wire = Model.requests[request_start]["messages"]
            assert any(image_brief in message_text(message) for message in wire), "Image follow-up lost the earlier user's requirements"
            assert any(part.get("image_url", {}).get("url") == image for message in wire if isinstance(message.get("content"), list) for part in message["content"]), "Image follow-up lost the reference image"
            assert vision_result["context"]["total_turns"] == 2
            assert vision_result["context"]["retained_images"] == 1

            # Old requirements survive compacted, tool-bearing turns, and newer corrections stay visible.
            memory = agent("create", title="长对话记忆")
            original_brief = "MEMORY_BRIEF: 主角叫林晓，固定红色外套；所有镜头保持雨夜车站。"
            agent("run", session_id=memory["id"], message=original_brief)
            assert wait(memory)["status"] == "completed"
            for index in range(18):
                agent("run", session_id=memory["id"], message=f"MEMORY_TURN:{index}\n" + "雨夜 scene detail " * 800)
                assert wait(memory)["status"] == "completed"
            correction = "MEMORY_CORRECTION: 按最新决定将外套改成蓝色，其余设定不变。"
            agent("run", session_id=memory["id"], message=correction)
            assert wait(memory)["status"] == "completed"
            request_start = len(Model.requests)
            agent("run", session_id=memory["id"], message="MEMORY_VERIFY: 接着完成下一镜。")
            memory_result = wait(memory)
            assert memory_result["status"] == "completed", memory_result.get("error")
            assert memory_result["context"]["summarized_turns"] > 0, "Fixture did not exercise long-history compaction"
            wire = Model.requests[request_start]["messages"]
            text = "\n".join(message_text(message) for message in wire)
            assert original_brief in text, "Compaction forgot the original user brief"
            assert correction in text, "Compaction lost the newer correction"
            assert sum(len(message_text(message).encode()) for message in wire) < 200_000, "Compacted history exceeds the text budget"

            # The Agent can recover original history, including turns outside its recent context.
            agent("run", session_id=memory["id"], message="HISTORY_SEARCH: 查回最初的用户要求。")
            searched = wait(memory)
            assert searched["status"] == "completed", searched.get("error")
            history_trace = next(message for message in reversed(searched["messages"]) if message.get("tool_name") == "search_conversation")
            assert history_trace["status"] == "completed", history_trace
            history = json.loads(history_trace["content"])
            assert any(item["role"] == "user" and original_brief in item["content"] for item in history["items"]), history
            assert len(history_trace["content"].encode()) < 32_000

            # Exact-message pagination can recover text omitted from the compact notes.
            long_index, long_message = next((index, message) for index, message in enumerate(searched["messages"], 1) if message.get("content", "").startswith("MEMORY_TURN:0\n"))
            recovered = ""
            content_offset = 0
            for _ in range(4):
                agent("run", session_id=memory["id"], message=f"HISTORY_PAGE:{long_index}:{content_offset}")
                paged = wait(memory)
                assert paged["status"] == "completed", paged.get("error")
                trace = next(message for message in reversed(paged["messages"]) if message.get("tool_name") == "search_conversation")
                assert trace["status"] == "completed", trace
                page = json.loads(trace["content"])
                item = page["items"][0]
                assert item["index"] == long_index and item["content_offset"] == content_offset, item
                recovered += item["content"]
                next_offset = item.get("content_next_offset")
                if next_offset is None:
                    break
                assert next_offset > content_offset, item
                content_offset = next_offset
            assert recovered == long_message["content"], "Paged history changed or lost Unicode text"

            # Search is bound to the current session, even within the same project.
            foreign = agent("create", title="独立会话")
            agent("run", session_id=foreign["id"], message=FOREIGN_HISTORY_MARKER)
            assert wait(foreign)["status"] == "completed"
            agent("run", session_id=memory["id"], message="HISTORY_FOREIGN: 检查独立会话隔离。")
            isolated = wait(memory)
            assert isolated["status"] == "completed", isolated.get("error")
            trace = next(message for message in reversed(isolated["messages"]) if message.get("tool_name") == "search_conversation")
            assert json.loads(trace["content"])["total"] == 0, trace
            for prompt in ["HISTORY_SCOPE_SESSION:" + foreign["id"], "HISTORY_SCOPE_PROJECT:" + other["id"]]:
                agent("run", session_id=memory["id"], message=prompt)
                isolated = wait(memory)
                assert isolated["status"] == "completed", isolated.get("error")
                trace = next(message for message in reversed(isolated["messages"]) if message.get("tool_name") == "search_conversation")
                assert trace["status"] == "failed", trace
                assert "error" in json.loads(trace["content"]), trace
                assert FOREIGN_HISTORY_MARKER not in trace["content"]

            # A second run cannot overlap the same session.
            limited = agent("config/save", config={"max_steps": 2, "search_api_key": "search-qa-secret"})
            assert "search-qa-secret" not in json.dumps(limited)
            session = agent("create")
            agent("run", session_id=session["id"], message="LOOP")
            assert wait(session)["status"] == "limited"
            assert len([m for m in wait(session)["messages"] if m["role"] == "tool"]) <= 2
            assert wait(session)["execution"]["stop_reason"] == "budget_exhausted"
            assert wait(session)["messages"][-1]["role"] == "assistant", "No final report after budget exhaustion"

            # A batch may exceed the remaining budget: preserve call/result pairing,
            # execute only the permitted operation, and report skipped work honestly.
            agent("config/save", config={"max_steps": 1})
            batch = agent("create")
            before_roles = len(api(f"/projects/{pid}/roles", method="GET"))
            agent("run", session_id=batch["id"], message="BATCH_LIMIT")
            bounded = wait(batch)
            assert bounded["status"] == "limited", bounded
            traces = [m for m in bounded["messages"] if m["role"] == "tool"]
            assert [m["status"] for m in traces] == ["completed", "skipped"], traces
            assert json.loads(traces[1]["content"])["executed"] is False
            roles = api(f"/projects/{pid}/roles", method="GET")
            assert len(roles) == before_roles + 1
            assert all(role["name"] != "Budget skipped" for role in roles)
            assert bounded["execution"]["tool_calls"] == 1
            assert bounded["execution"]["usage"]["total_tokens"] == 30
            noncompliant = agent("create")
            agent("run", session_id=noncompliant["id"], message="BUDGET_IGNORED")
            rejected = wait(noncompliant)
            assert rejected["status"] == "failed", rejected
            assert rejected["execution"]["tool_calls"] == 1
            assert len(api(f"/projects/{pid}/roles", method="GET")) == len(roles)

            agent("config/save", config={"max_steps": 16})
            failed_loop = agent("create")
            agent("run", session_id=failed_loop["id"], message="FAIL_LOOP")
            guarded = wait(failed_loop)
            assert guarded["status"] == "limited", guarded
            assert guarded["execution"]["stop_reason"] == "repeated_tool_failure"
            assert guarded["execution"]["tool_calls"] == 3

            # Retrying inference after a successful write must never replay the write.
            retried = agent("create")
            before_roles = len(roles)
            agent("run", session_id=retried["id"], message="AFTER_WRITE_RETRY")
            retry_result = wait(retried)
            assert retry_result["status"] == "completed", retry_result
            assert retry_result["execution"]["retries"] == 1
            assert retry_result["execution"]["model_requests"] == 3
            assert len(api(f"/projects/{pid}/roles", method="GET")) == before_roles + 1
            assert len([m for m in retry_result["messages"] if m["role"] == "tool"]) == 1
            for prompt in ["LONG_RETRY_AFTER", "DATE_RETRY_AFTER"]:
                deferred = agent("create")
                agent("run", session_id=deferred["id"], message=prompt)
                delayed_retry = wait(deferred)
                assert delayed_retry["status"] == "failed", delayed_retry
                assert delayed_retry["execution"]["retries"] == 0
                assert delayed_retry["execution"]["model_requests"] == 1

            # Cancellation must release the run slot during both response-body reads
            # and retry backoff, without waiting for the upstream timeout.
            for prompt, ready in [("BODY_CANCEL", Model.body_delayed), ("RETRY_CANCEL", Model.retry_delayed)]:
                cancelled = agent("create")
                agent("run", session_id=cancelled["id"], message=prompt)
                assert ready.wait(timeout=5), prompt
                agent("cancel", session_id=cancelled["id"])
                deadline = time.monotonic() + 1.2
                while True:
                    resumed = api("/actions/agent/run", {"project_id": pid, "session_id": cancelled["id"], "message": "恢复读取"}, expected=(200, 400, 409))
                    if resumed.get("status") == "running":
                        break
                    assert time.monotonic() < deadline, (f"Cancellation retained the worker during {prompt}", resumed)
                    time.sleep(0.03)
                assert wait(cancelled)["status"] == "completed"

            plan = agent("create")
            agent("run", session_id=plan["id"], message="PLAN_PENDING")
            planned = wait(plan)
            assert planned["status"] == "completed", planned
            assert planned["execution"]["plan"][0]["status"] == "in_progress"
            old_run_id = planned["execution"]["id"]
            assert agent("config/save", config={"search_api_key": ""})["has_search_api_key"] is True
            api("/actions/agent/session", {"project_id": other["id"], "session_id": created["id"]}, expected=404)
            persisted = agent("session", session_id=created["id"])["messages"]
            memory_persisted = agent("session", session_id=memory["id"])["messages"]
            stop()
            process, base = start()
            assert agent("session", session_id=plan["id"])["execution"] == planned["execution"]
            agent("run", session_id=plan["id"], message="PLAN_RESUME")
            resumed_plan = wait(plan)
            assert resumed_plan["status"] == "completed", resumed_plan
            assert resumed_plan["execution"]["id"] != old_run_id
            assert resumed_plan["execution"]["plan"][0]["status"] == "completed"
            assert agent("session", session_id=created["id"])["messages"] == persisted
            assert agent("session", session_id=memory["id"])["messages"] == memory_persisted
            request_start = len(Model.requests)
            agent("run", session_id=memory["id"], message="MEMORY_AFTER_RESTART: 按最后确认的要求继续。")
            restarted = wait(memory)
            assert restarted["status"] == "completed", restarted.get("error")
            text = "\n".join(message_text(message) for message in Model.requests[request_start]["messages"])
            assert original_brief in text and correction in text, "Restart lost compacted requirements or the newer correction"
            assert len(agent("sessions")["items"]) >= 8
            agent("delete", session_id=session["id"])
            assert session["id"] not in [s["id"] for s in agent("sessions")["items"]]
            assert all(SECRET not in json.dumps(request) for request in Model.requests)
            for request in Model.requests:
                assert_tool_protocol(request["messages"])
            print("PASS: real HTTP Agent CRUD; image/history context and isolation; durable plans; budget finalization/skipped calls; failure-loop guard; inference retries without duplicate writes; cancellable response reads/backoff; usage; credentials; restart persistence")
        finally:
            stop()
            model.shutdown()


if __name__ == "__main__":
    main()
