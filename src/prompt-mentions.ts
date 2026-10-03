import type {Media, Role, Snapshot} from "./core";

export type SavedPrompt = {id:number|string; name:string; content:string; category:string};
export type PromptMention = {id:string; name:string; description:string; media?:Media; content?:string; kind:"role"|"scene"|"prompt"|"template"};
export function templateMentions(templates:{id:string|number;name:string;content:string}[]):PromptMention[] {
  return templates.map(template=>({id:`template-${template.id}`,name:`template.${template.name}`,description:`模板 · ${template.name}`,content:template.content,kind:"template"}));
}
export function savedPromptMentions(prompts:SavedPrompt[]):PromptMention[] {
  return prompts.map(prompt=>({
    id:`prompt-${prompt.id}`,
    name:`prompt.${prompt.name}${prompts.filter(p=>p.name===prompt.name).length>1?`#${prompt.id}`:""}`,
    description:`Prompt · ${prompt.category} · ${prompt.content}`,
    kind:"prompt", content:prompt.content,
  }));
}
export function resolvePromptReferences(value:string,prompts:SavedPrompt[]) {
  const items=savedPromptMentions(prompts), pattern=mentionPattern(items);
  return pattern ? value.replace(pattern,(_,name:string)=>items.find(item=>item.name===name)!.content!) : value;
}
export function promptMentions(roles:Role[], data?:Snapshot):PromptMention[] {
  const result:PromptMention[]=roles.map(role=>({id:`role-${role.id}`,name:role.name,description:role.description || "保持角色设定",kind:"role",media:data?.media.find(m=>m.id===role.design_media_id)||role.images[0]}));
  for(const role of roles) for(const media of role.images||[]) {
    const stem=media.name.replace(/\.[^.]+$/,""), alias=stem.replace(/\s+/g,"_");
    if(alias && alias!==role.name) result.push({id:`role-${role.id}-media-${media.id}`,name:`${role.name}.${alias}`,description:`${role.name} · ${media.name}`,kind:"role",media});
  }
  for(const episode of data?.episodes || []) {
    const title=data!.episodes.filter(e=>e.title===episode.title).length>1 ? `${episode.title}#${episode.id}` : episode.title;
    [...episode.scenes].sort((a,b)=>a.sort_order-b.sort_order || a.id-b.id).forEach((scene,index)=>{
      for(const [suffix,key,label] of [["first","first","首帧"],["last","last","尾帧"],["ref","reference","参考图"]] as const) {
        const media=scene[`${key}_media`] || data!.media.find(m=>m.id===scene[`${key}_media_id`]);
        result.push({id:`scene-${scene.id}-${key}`,name:`${title}.scene${String(index+1).padStart(3,"0")}.${suffix}`,description:`${episode.title} / ${scene.title} / ${label}`,kind:"scene",media:media?.kind==="image"?media:undefined});
      }
    });
  }
  return result;
}
export function mentionPattern(items:{name:string}[]) {
  const names=[...new Set(items.map(item=>item.name).filter(Boolean))].sort((a,b)=>b.length-a.length).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
  return names.length ? new RegExp(`@(${names.join("|")})(?=$|[\\s，。！？、；：,.!?;:()（）])`,"g") : null;
}
export function findMentions(value:string,items:PromptMention[]) {
  const pattern=mentionPattern(items);
  const names=new Set(pattern?Array.from(value.matchAll(pattern),match=>match[1]):[]);
  return items.filter(item=>names.has(item.name));
}
