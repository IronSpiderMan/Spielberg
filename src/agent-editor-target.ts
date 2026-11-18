export type AgentEditorTarget = {
  resource: "scenes" | "clips";
  id: number;
  episode_id: number;
};

export function editorTargetLabel(target: AgentEditorTarget, title: string) {
  return `${target.resource === "clips" ? "片段" : "场景"} · ${title}`;
}
