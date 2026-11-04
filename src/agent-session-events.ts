export const AGENT_SESSION_CHANGED = "spielberg:agent-session-changed";
export type AgentSessionChange = { projectId: string; sessionId: string; source: "float" | "workspace"; deleted?: boolean };

// The compact assistant and full workspace share the same persisted Agent sessions.
export function notifyAgentSessionChanged(projectId: string, sessionId: string, source: AgentSessionChange["source"], deleted = false) {
  window.dispatchEvent(new CustomEvent<AgentSessionChange>(AGENT_SESSION_CHANGED, { detail: { projectId, sessionId, source, deleted } }));
}
