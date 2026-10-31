import type {Media, Asset, Snapshot} from "./core";
import type {AssetCategory} from "./asset-categories";

export type SavedPrompt = {id:number|string; name:string; content:string; category:string};
export type PromptMention = {id:string; name:string; description:string; media?:Media; content?:string; category?:AssetCategory; kind:"role"|"scene"|"prompt"|"template"};
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
export function promptMentions(roles:Asset[], data?:Snapshot):PromptMention[] {
  const imageAlias=(name:string)=>name.replace(/\.[^.]+$/, "").replace(/\s+/g,"_");
  // Reserve role names even when disabled so an asset cannot reintroduce their mentions.
  const disabledRoleNames=new Set(roles.filter(role=>role.enabled===false).flatMap(role=>[role.name,...(role.images||[])
    .map(media=>imageAlias(media.name)).filter(alias=>alias&&alias!==role.name).map(alias=>`${role.name}.${alias}`)]));
  const enabledRoles=roles.filter(role=>role.enabled!==false);
  const result:PromptMention[]=enabledRoles.map(role=>({id:`role-${role.id}`,name:role.name,description:role.description || "保持资产设定",kind:"role",category:role.category,media:data?.media.find(m=>m.id===role.design_media_id)||role.images[0]}));
  for(const role of enabledRoles) for(const media of role.images||[]) {
    const alias=imageAlias(media.name);
    if(alias && alias!==role.name) result.push({id:`role-${role.id}-media-${media.id}`,name:`${role.name}.${alias}`,description:`${role.name} · ${media.name}`,kind:"role",category:role.category,media});
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
  for(const media of data?.media || []) {
    if(media.kind!=="image") continue;
    const name=media.name.replace(/\.[^.]+$/, "");
    if(name&&!disabledRoleNames.has(name)&&!result.some(item=>item.name===name)) result.push({id:`asset-${media.id}`,name,description:`图片资源 · ${media.name}`,media,kind:"scene"});
  }
  const seen=new Set<string>();
  return result.filter(item=>{if(seen.has(item.name))return false;seen.add(item.name);return true;});
}
export function mentionPattern(items:{name:string}[]) {
  const names=[...new Set(items.map(item=>item.name).filter(Boolean))].sort((a,b)=>b.length-a.length).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
  // A dot followed by a name continues a qualified mention, not a role boundary.
  return names.length ? new RegExp(`@(${names.join("|")})(?=$|[\\s，。！？、；：,!?;:()（）]|\\.(?=$|[\\s，。！？、；：,!?;:()（）]))`,"g") : null;
}
export function syncMentionReferences(existing:number[], previousAutomatic:number[], mentioned:number[], limit=9) {
  const manual=existing.filter(id=>!previousAutomatic.includes(id));
  const ids=[...new Set([...manual,...mentioned])].slice(0,limit);
  return {ids,automatic:ids.filter(id=>!manual.includes(id))};
}
export function findMentions(value:string,items:PromptMention[]) {
  const pattern=mentionPattern(items);
  const names=new Set(pattern?Array.from(value.matchAll(pattern),match=>match[1]):[]);
  return items.filter(item=>names.has(item.name));
}
