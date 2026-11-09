import { post } from "./core";

export type Skill = {
  id: string; name: string; description: string; enabled: boolean; source: string;
  installed_at: string; updated_at: string; files_count: number; builtin: boolean;
};

export const skillName = (skill: Skill) => skill.builtin && skill.id === "short-drama-storyboard" ? "短剧分镜与关键帧" : skill.name;

export const listSkills = () => post<{ items: Skill[]; directory: string }>("/skills/list");
