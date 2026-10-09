import {Role, Snapshot} from "./core";
import {mentionPattern, promptMentions, resolvePromptReferences} from "./prompt-mentions";
import type {SavedPrompt} from "./prompt-mentions";
export function resolvePrompt(prompt: string, roles: Role[], prompts: SavedPrompt[] = []) {
  prompt = resolvePromptReferences(prompt, prompts);
  const pattern=mentionPattern(roles);
  return pattern ? prompt.replace(pattern,(_,name:string)=>{const role=roles.find(role=>role.name===name)!;return `${name}（${role.description || "保持角色设定"}）`;}) : prompt;
}

export function resolveReferencePrompt(prompt: string, data: Snapshot) {
  const items = promptMentions(data.roles, data), pattern = mentionPattern(items);
  return pattern ? prompt.replace(pattern, (_, name: string) => {
    const item = items.find(item => item.name === name)!;
    return item.kind === "role" ? `${name}（${item.description}）` : `参考图片（${item.description}）`;
  }) : prompt;
}
