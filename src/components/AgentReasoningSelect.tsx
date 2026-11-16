import { Select } from "@arco-design/web-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, Gauge } from "lucide-react";
import { post } from "../api";
import type { GenerationSelection } from "../generation-channels";
import "./agent-composer-menu.css";

const labels = {
  none: "关闭", minimal: "最低", low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高",
};
const eventName = "spielberg-agent-reasoning";

export const agentReasoningOptions = Object.entries(labels).map(([value, label]) => ({ value, label }));
const labelFor = (value: string) => labels[value as keyof typeof labels] ?? value;
const effortLabel = (value: string) => value === "" ? "默认思考" : value === "none" ? "关闭思考" : `${labelFor(value)}强度`;
type Capabilities = { levels: string[]; channel_id?: string; model: string };

function subscribe(listener: () => void) {
  window.addEventListener(eventName, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useAgentReasoning(projectId: string | undefined, selection: GenerationSelection, enabled: boolean, configuration: unknown) {
  const { channel_id, model } = selection;
  const requestKey = JSON.stringify([projectId, channel_id, model]);
  const [loaded, setLoaded] = useState<{ requestKey: string; configuration: unknown; capabilities: Capabilities }>();
  useEffect(() => {
    if (!projectId || !enabled) return;
    let cancelled = false;
    void post<Capabilities>("/agent/reasoning", { project_id: projectId, channel_id, model }).then(capabilities => {
      if (!cancelled) setLoaded({ requestKey, configuration, capabilities });
    }).catch(() => {
      if (!cancelled) setLoaded(undefined);
    });
    return () => { cancelled = true; };
  }, [projectId, enabled, channel_id, model, requestKey, configuration]);
  const capabilities = loaded && loaded.requestKey === requestKey && loaded.configuration === configuration ? loaded.capabilities : undefined;
  const storageKey = capabilities?.levels.length
    ? `${eventName}-${JSON.stringify([projectId, capabilities.channel_id, capabilities.model])}` : "";
  const saved = useSyncExternalStore(subscribe, () => {
    try { return storageKey ? localStorage.getItem(storageKey) ?? "" : ""; } catch { return ""; }
  });
  const [fallback, setFallback] = useState<{ key: string; value: string }>();
  const levels = capabilities?.levels ?? [];
  const selected = fallback?.key === storageKey ? fallback.value : saved;
  const value = levels.includes(selected) ? selected : "";
  function setValue(next: string) {
    if (!storageKey || (next && !levels.includes(next))) return;
    try {
      if (next) localStorage.setItem(storageKey, next);
      else localStorage.removeItem(storageKey);
      setFallback(undefined);
      window.dispatchEvent(new Event(eventName));
    } catch { setFallback({ key: storageKey, value: next }); }
  }
  return { levels, value, setValue, payload: value ? { reasoning_effort: value } : {} };
}

export function AgentReasoningSelect({ reasoning, disabled, popupClassName }: {
  reasoning: ReturnType<typeof useAgentReasoning>;
  disabled?: boolean;
  popupClassName?: string;
}) {
  if (!reasoning.levels.length) return null;
  return <div className="agent-reasoning-control" data-adjusted={!!reasoning.value && reasoning.value !== "none"}>
    <Select
      className="agent-reasoning-select" aria-label="思考强度" size="small" bordered={false}
      value={reasoning.value} onChange={reasoning.setValue} disabled={disabled}
      prefix={<Gauge size={14} aria-hidden="true" />}
      arrowIcon={<ChevronDown size={12} aria-hidden="true" />}
      dropdownMenuClassName="agent-reasoning-options"
      triggerProps={{
        className: popupClassName, position: "tl", popupAlign: { top: 6, bottom: 6 },
        autoAlignPopupWidth: false, style: { width: 148 }, updateOnScroll: true,
      }}
      renderFormat={(_, value) => effortLabel(String(value))}
      options={["", ...reasoning.levels].map(value => ({
        value, label: <span className="agent-reasoning-option">
          {effortLabel(value)}<Check size={13} aria-hidden="true" />
        </span>,
      }))}
    />
  </div>;
}
