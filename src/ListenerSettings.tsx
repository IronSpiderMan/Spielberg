import { useEffect, useState } from "react";
import { Button, Form, Input, Message, Space } from "@arco-design/web-react";
import { jsonRequest, request } from "./transport";
import "./settings.css";

type ListenerConfig = {
  host: string;
  port: number;
  active: string;
  overridden: boolean;
  restart_required: boolean;
};
const path = "/api/v1/app/listener";

export default function ListenerSettings({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const [config, setConfig] = useState<ListenerConfig | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = !!config && (host !== config.host || port !== String(config.port));
  const unavailable = !config || config.overridden || loading || saving;
  useEffect(() => {
    onDirtyChange(dirty || saving);
    return () => onDirtyChange(false);
  }, [dirty, saving, onDirtyChange]);

  const update = (next: ListenerConfig) => {
    setConfig(next);
    setHost(next.host);
    setPort(String(next.port));
  };
  const load = async () => {
    setLoading(true);
    setError("");
    try { update(await request<ListenerConfig>(path)); }
    catch (error) { setError((error as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (unavailable || !dirty) return;
    if (!host.trim()) { setError("请输入监听主机"); return; }
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      setError("端口必须是 1 到 65535 之间的整数");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const next = await jsonRequest<ListenerConfig>(path, "PUT", { host: host.trim(), port: Number(port) });
      update(next);
      Message.success(next.restart_required ? "端口设置已保存，重启后生效" : "端口设置已保存");
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  };

  return <section className="settings-shared-section settings-storage" aria-busy={loading || saving}>
    <div className="setting-heading">
      <div className="settings-panel-title"><h3>服务监听</h3><span className="settings-scope">工作室共享</span></div>
      <p>监听主机和端口适用于此工作室的所有项目。保存后重启桌面应用或后端服务即可生效。</p>
    </div>
    {loading && <p role="status">正在读取端口设置…</p>}
    {error && <div className="settings-feedback" role="alert">
      <div><strong>{config ? "端口设置未能保存" : "无法读取端口设置"}</strong><p>{error}</p></div>
      {!config && <Button size="small" loading={loading} onClick={() => void load()}>重新加载</Button>}
    </div>}
    {config && <Form layout="vertical" disabled={unavailable} onSubmit={() => void save()}>
      <Form.Item label="监听主机" extra="可填 IPv4、IPv6 或 localhost。127.0.0.1 仅供本机访问，0.0.0.0 监听所有 IPv4 接口。">
        <Input aria-label="监听主机" value={host} onChange={setHost} disabled={unavailable} />
      </Form.Item>
      <Form.Item label="监听端口" extra="输入 1 到 65535 之间的整数。">
        <Input aria-label="监听端口" inputMode="numeric" value={port} onChange={setPort} disabled={unavailable} />
      </Form.Item>
      <Space wrap>
        <Button type="primary" htmlType="submit" loading={saving} disabled={unavailable || !dirty}>保存端口设置</Button>
        <span className="settings-directory-state" role="status">
          当前监听 <code>{config.active}</code>
          {config.overridden ? " · 由启动参数指定" : config.restart_required ? " · 已保存的设置将在重启后生效" : ""}
        </span>
      </Space>
    </Form>}
  </section>;
}
