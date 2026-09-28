import {Role} from "./core";
import {mentionPattern} from "./prompt-mentions";
export function resolvePrompt(prompt: string, roles: Role[]) {
  const pattern=mentionPattern(roles);
  return pattern ? prompt.replace(pattern,(_,name:string)=>{const role=roles.find(role=>role.name===name)!;return `${name}（${role.description || "保持角色设定"}）`;}) : prompt;
}
