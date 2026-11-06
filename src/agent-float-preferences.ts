export const agentFloatColors = {
  default: "蓝紫（默认）",
  violet: "紫粉",
  rose: "玫红",
  amber: "琥珀",
  teal: "青绿",
  coral: "珊瑚红",
  orange: "橙金",
  lime: "草绿",
  jade: "翡翠绿",
  ice: "冰蓝",
  indigo: "靛蓝",
} as const;

export type AgentFloatPreferences = {
  visible: boolean;
  color: keyof typeof agentFloatColors;
  intensity: number;
  clickAction: "panel" | "voice";
  speechAutoSend: boolean;
};

export const agentFloatPreferencesKey = "spielberg-agent-float-preferences";

export function readAgentFloatPreferences(): AgentFloatPreferences {
  const defaults: AgentFloatPreferences = { visible: true, color: "default", intensity: 100, clickAction: "panel", speechAutoSend: false };
  try {
    const saved = JSON.parse(localStorage.getItem(agentFloatPreferencesKey) ?? "null") as Partial<AgentFloatPreferences> | null;
    if (!saved) return defaults;
    return {
      visible: typeof saved.visible === "boolean" ? saved.visible : defaults.visible,
      color: saved.color && Object.prototype.hasOwnProperty.call(agentFloatColors, saved.color) ? saved.color : defaults.color,
      intensity: typeof saved.intensity === "number" && Number.isFinite(saved.intensity)
        ? Math.min(200, Math.max(0, saved.intensity)) : defaults.intensity,
      clickAction: saved.clickAction === "voice" || saved.clickAction === "panel" ? saved.clickAction : defaults.clickAction,
      speechAutoSend: typeof saved.speechAutoSend === "boolean" ? saved.speechAutoSend : defaults.speechAutoSend,
    };
  } catch {
    return defaults;
  }
}
import { useCallback, useEffect, useState } from "react";


export type AgentFloatSpeechPreferences = {
  asr: { provider: "system" | "cloud"; channel_id?: string; model?: string };
  tts: { provider: "system" | "cloud"; channel_id?: string; model?: string; voice: string; speed: number };
  autoRead: boolean;
};

export const agentFloatSpeechPreferencesChanged = "spielberg-agent-float-speech-changed";
const speechKey = (projectId: string) => `spielberg-agent-float-speech-${projectId}`;
const readLocal = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const selectionId = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;

function normalizeSpeechPreferences(value: unknown, legacyProvider?: string | null): AgentFloatSpeechPreferences {
  const saved = record(value), asr = record(saved.asr), tts = record(saved.tts);
  return {
    asr: {
      provider: asr.provider === "cloud" || asr.provider === "system" ? asr.provider : legacyProvider === "cloud" ? "cloud" : "system",
      channel_id: selectionId(asr.channel_id), model: selectionId(asr.model),
    },
    tts: {
      provider: tts.provider === "system" ? "system" : "cloud",
      channel_id: selectionId(tts.channel_id), model: selectionId(tts.model),
      voice: typeof tts.voice === "string" ? tts.voice.trim() : "",
      speed: typeof tts.speed === "number" && Number.isFinite(tts.speed) ? Math.min(4, Math.max(0.25, tts.speed)) : 1,
    },
    autoRead: typeof saved.autoRead === "boolean" ? saved.autoRead : true,
  };
}

export function readAgentFloatSpeechPreferences(projectId?: string): AgentFloatSpeechPreferences {
  if (!projectId) return normalizeSpeechPreferences(null);
  const saved = readLocal(speechKey(projectId));
  try { return normalizeSpeechPreferences(saved ? JSON.parse(saved) : null, saved ? null : readLocal(`spielberg-agent-float-provider-${projectId}`)); }
  catch { return normalizeSpeechPreferences(null); }
}

/** Project-scoped local preferences shared by the settings page and floating assistant. */
export function useAgentFloatSpeechPreferences(projectId?: string): [AgentFloatSpeechPreferences, (next: AgentFloatSpeechPreferences) => void] {
  const [state, setState] = useState(() => ({ projectId, value: readAgentFloatSpeechPreferences(projectId) }));
  // A project switch must never expose the previous project's choices for one render.
  const preferences = state.projectId === projectId ? state.value : readAgentFloatSpeechPreferences(projectId);
  useEffect(() => {
    const refresh = () => setState({ projectId, value: readAgentFloatSpeechPreferences(projectId) });
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; preferences?: unknown }>).detail;
      if (detail?.projectId === projectId) setState({ projectId, value: normalizeSpeechPreferences(detail.preferences) });
    };
    const storage = (event: StorageEvent) => {
      if (projectId && (event.key === null || event.key === speechKey(projectId) || event.key === `spielberg-agent-float-provider-${projectId}`)) refresh();
    };
    window.addEventListener(agentFloatSpeechPreferencesChanged, changed);
    window.addEventListener("storage", storage);
    if (projectId && !readLocal(speechKey(projectId))) {
      const legacyKey = `spielberg-agent-float-provider-${projectId}`;
      const legacy = readLocal(legacyKey);
      if (legacy === "system" || legacy === "cloud") {
        try {
          localStorage.setItem(speechKey(projectId), JSON.stringify(readAgentFloatSpeechPreferences(projectId)));
          localStorage.removeItem(legacyKey);
        } catch { /* Preferences still work for this session without storage. */ }
      }
    }
    refresh();
    return () => { window.removeEventListener(agentFloatSpeechPreferencesChanged, changed); window.removeEventListener("storage", storage); };
  }, [projectId]);
  const update = useCallback((next: AgentFloatSpeechPreferences) => {
    const value = normalizeSpeechPreferences(next);
    setState({ projectId, value });
    if (!projectId) return;
    try { localStorage.setItem(speechKey(projectId), JSON.stringify(value)); } catch { /* Keep controls usable when storage is unavailable. */ }
    window.dispatchEvent(new CustomEvent(agentFloatSpeechPreferencesChanged, { detail: { projectId, preferences: value } }));
  }, [projectId]);
  return [preferences, update];
}
