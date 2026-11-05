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
};

export const agentFloatPreferencesKey = "spielberg-agent-float-preferences";

export function readAgentFloatPreferences(): AgentFloatPreferences {
  const defaults: AgentFloatPreferences = { visible: true, color: "default", intensity: 100 };
  try {
    const saved = JSON.parse(localStorage.getItem(agentFloatPreferencesKey) ?? "null") as Partial<AgentFloatPreferences> | null;
    if (!saved) return defaults;
    return {
      visible: typeof saved.visible === "boolean" ? saved.visible : defaults.visible,
      color: saved.color && Object.prototype.hasOwnProperty.call(agentFloatColors, saved.color) ? saved.color : defaults.color,
      intensity: typeof saved.intensity === "number" && Number.isFinite(saved.intensity)
        ? Math.min(200, Math.max(0, saved.intensity)) : defaults.intensity,
    };
  } catch {
    return defaults;
  }
}
