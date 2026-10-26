#!/usr/bin/env python3
"""Real Agent HTTP regression with disposable projects and a local model fixture."""
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
SECRET = "agent-qa-private-key"


def call(name, arguments, call_id):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}


class Model(BaseHTTPRequestHandler):
    requests = []
    delayed = threading.Event()

    def log_message(self, *_):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.requests.append(body)
        assert SECRET not in json.dumps(body, ensure_ascii=False), "Credential leaked into model context"
        messages = body["messages"]
        last_user = max(i for i, message in enumerate(messages) if message["role"] == "user")
        prompt = messages[last_user]["content"]
        tools = [m for m in messages[last_user + 1:] if m["role"] == "tool"]
        if "UPSTREAM_ERROR" in prompt:
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": {"message": "fixture unavailable"}}).encode())
            return
        calls = []
        if "CANCEL" in prompt:
            self.delayed.set()
            time.sleep(1.5)
            calls = [call("app_request", {"resource": "roles", "method": "POST", "data": {"name": "Must not be created"}}, "cancelled-write")]
        elif "LOOP" in prompt:
            calls = [call("get_project", {}, "loop-" + str(len(tools)))]
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
                call("app_request", {"resource": "screenplays", "method": "POST", "data": {"title": "Agent 剧本", "content": "# 雨夜\n\n主角走进车站。"}}, "script"),
                call("app_request", {"resource": "roles", "method": "POST", "data": {"name": "林晓", "description": "红色外套"}}, "role"),
                call("app_request", {"resource": "episodes", "method": "POST", "data": {"title": "第一集"}}, "episode"),
            ]
        elif len(tools) == 3 and "CREATE" in prompt:
            episode = json.loads(tools[2]["content"])
            # Tool results are JSON objects, not sliced JSON text.
            if "data" in episode:
                episode = episode["data"]
            calls = [call("app_request", {"resource": "scenes", "method": "POST", "episode_id": episode["id"], "data": {"title": "车站", "description": "雨夜走进车站"}}, "scene")]
        elif not tools:
            calls = [call("get_project", {}, "overview")]
        reply = {"role": "assistant", "content": None, "tool_calls": calls} if calls else {"role": "assistant", "content": "已完成操作。"}
        payload = json.dumps({"choices": [{"message": reply, "finish_reason": "tool_calls" if calls else "stop"}]}, ensure_ascii=False).encode()
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
            # A second run cannot overlap the same session.
            limited = agent("config/save", config={"max_steps": 2, "search_api_key": "search-qa-secret"})
            assert "search-qa-secret" not in json.dumps(limited)
            session = agent("create")
            agent("run", session_id=session["id"], message="LOOP")
            assert wait(session)["status"] in ("failed", "completed")
            assert len([m for m in wait(session)["messages"] if m["role"] == "tool"]) <= 2
            assert agent("config/save", config={"search_api_key": ""})["has_search_api_key"] is True
            api("/actions/agent/session", {"project_id": other["id"], "session_id": created["id"]}, expected=404)
            persisted = agent("session", session_id=created["id"])["messages"]
            stop()
            process, base = start()
            assert agent("session", session_id=created["id"])["messages"] == persisted
            assert len(agent("sessions")["items"]) >= 8
            agent("delete", session_id=session["id"])
            assert session["id"] not in [s["id"] for s in agent("sessions")["items"]]
            assert all(SECRET not in json.dumps(request) for request in Model.requests)
            print("PASS: real HTTP Agent tools create scripts, roles, episodes and scenes; follow-up, project isolation, disabled web, malformed/unknown tools, upstream recovery, cancellation, limits, private keys and restart persistence")
        finally:
            stop()
            model.shutdown()


if __name__ == "__main__":
    main()
