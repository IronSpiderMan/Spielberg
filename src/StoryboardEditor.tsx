import { PreviewImage } from "./components/ImagePreviewModal";
import {useRef, useState} from 'react';
import {Button, Input, Message, Popconfirm, Select} from '@arco-design/web-react';
import {Snapshot, Media, Scene, post, imageUrl, defaultOptions} from './core';
import {PromptInput} from './PromptInput';
import {resolvePromptReferences} from './prompt-mentions';
import './storyboard.css';
export type Shot={duration:number;description:string;camera:string;sound:string};
type ImageTask={name:string;operation:'t2i'|'i2i';source_media_ids:number[];prompt:string;media_id?:number};
type Plan={reference_media_ids:number[];image_tasks:ImageTask[];prompt:string};
type BoardScene={title:string;duration:number;shots:Shot[];plan?:Plan;scene_id?:number};
export type Storyboard={scenes:BoardScene[];source_script?:string};
export function StoryboardEditor({data,episodeId,script,onScript,board,onChange,onBusy,reload,disabled,readOnlySource=false}:{data:Snapshot;episodeId:number;script:string;onScript:(v:string)=>void;board?:Storyboard;onChange:(v:Storyboard)=>void;onBusy:(v:boolean)=>void;reload:()=>void;disabled:boolean;readOnlySource?:boolean}){
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[target,setTarget]=useState<Record<number,number>>({});
 const boardRef=useRef(board);boardRef.current=board;
 const [batchProgress,setBatchProgress]=useState<{current:number;total:number}|null>(null);
 const run=async(key:string,work:()=>Promise<void>)=>{setBusy(key);onBusy(true);setError('');try{await work();}catch(e){setError(String(e));Message.error(String(e));}finally{setBusy('');onBusy(false);}};
 const locked=disabled||!!busy;
 const editShot=(scene:BoardScene,index:number,i:number,patch:Partial<Shot>)=>{const shots=scene.shots.map((s,n)=>n===i?{...s,...patch}:s);update(index,{...scene,shots,duration:Math.round(shots.reduce((sum,s)=>sum+s.duration,0)*1000)/1000,plan:undefined});};
 const update=(index:number,scene:BoardScene)=>{const next={...boardRef.current!,scenes:boardRef.current!.scenes.map((s,i)=>i===index?scene:s)};boardRef.current=next;onChange(next);};
 const generate=()=>run('board',async()=>{const result=await post<Storyboard>('/storyboard/generate',{project_id:data.project.id,script:resolvePromptReferences(script,data.prompts)});onChange({...result,source_script:script});});
 const saveScene=async(scene:BoardScene,index:number)=>{
  const plan=scene.plan!;await post('/storyboard/validate',{project_id:data.project.id,scene,plan});if(plan.image_tasks.some(t=>!t.media_id))throw new Error('请先生成所有补图，确保 Picture 编号与实际参考图一致');
  const ids=[...plan.reference_media_ids,...plan.image_tasks.map(t=>t.media_id!)];if(!ids.length)throw new Error('场景至少需要一张参考图');
  const selected=target[index] ?? scene.scene_id;const existing=data.episodes.find(e=>e.id===episodeId)?.scenes.find(s=>s.id===selected);
  if(selected&&!existing)throw new Error('目标场景已不存在，请重新选择');
  const description=existing?.description ?? scene.shots.map(shot=>shot.description).join("\n");
  const created=existing||await post<Scene>('/scenes',{project_id:data.project.id,episode_id:episodeId,title:scene.title,description,prompt:plan.prompt});
  // Remember the new scene before updating it so retrying cannot create a duplicate.
  const saved={...scene,scene_id:created.id};update(index,saved);setTarget(current=>({...current,[index]:created.id}));
  await post('/scenes/update',{project_id:data.project.id,id:created.id,title:scene.title,description,prompt:plan.prompt,reference_media_id:ids[0],generation_options:{...defaultOptions,custom:true,video_mode:'i2v',first:false,last:false,reference:true,duration:scene.duration,reference_media_ids:ids}});
  await reload();Message.success('参考图与 H3 Prompt 已写入本集场景');
 };
 const generateImage=(task:ImageTask)=>post<Media>('/generations/image',{project_id:data.project.id,operation:task.operation,prompt:task.prompt,image_media_ids:task.source_media_ids,aspect_ratio:'16:9'});
 const prepareScene=async(scene:BoardScene,index:number)=>{
  const plan=await post<Plan>('/storyboard/plan',{project_id:data.project.id,scene});
  let prepared={...scene,plan};update(index,prepared);
  // Complete planned reference images in Picture order before saving the prompt.
  for(let i=0;i<plan.image_tasks.length;i++){
   const media=await generateImage(prepared.plan.image_tasks[i]);
   prepared={...prepared,plan:{...prepared.plan,image_tasks:prepared.plan.image_tasks.map((task,n)=>n===i?{...task,media_id:media.id}:task)}};
   update(index,prepared);
  }
  await saveScene(prepared,index);
 };
 const prepare=(scene:BoardScene,index:number)=>run(`plan-${index}`,()=>prepareScene(scene,index));
 const prepareAll=()=>run('all',async()=>{
  const scenes=[...(boardRef.current?.scenes??[])];
  try{
   for(let index=0;index<scenes.length;index++){
    setBatchProgress({current:index+1,total:scenes.length});
    try{await prepareScene(scenes[index],index);}catch(e){throw new Error(`场景 ${index+1} 生成失败，批量生成已停止：${String(e)}`);}
   }
   Message.success(`全部 ${scenes.length} 个场景已生成并保存`);
  }finally{setBatchProgress(null);}
 });
 const supplement=(scene:BoardScene,index:number,task:ImageTask,taskIndex:number)=>run(`image-${index}-${taskIndex}`,async()=>{
  const media=await generateImage(task);const prepared={...scene,plan:{...scene.plan!,image_tasks:scene.plan!.image_tasks.map((t,i)=>i===taskIndex?{...t,media_id:media.id}:t)}};
  update(index,prepared);
  if(prepared.plan.image_tasks.every(t=>t.media_id))await saveScene(prepared,index);else await reload();
 });
 const apply=(scene:BoardScene,index:number)=>run(`apply-${index}`,()=>saveScene(scene,index));
 return <div className="storyboard-columns">
  <div className="storyboard-source"><div className="storyboard-panel-heading"><span className="editor-step">01</span><h3>剧本</h3><small>故事起点</small></div>{readOnlySource ? <pre className="storyboard-script-preview">{script || "请先在剧本页新建或导入剧本，保存后即可生成分镜。"}</pre> : <PromptInput value={script} onChange={onScript} roles={data.assets} data={data} prompts={data.prompts} disabled={locked} placeholder="填写剧本，输入 @ 引用已有资产、造型、图片资源或 Prompt；输入 @prompt 搜索 Prompt 库"/>}
   <p className="subtle">生成前检查所有 @ 引用；每个场景最长 15 秒。</p>
   {board?.scenes.length?<Popconfirm title="重新生成将替换当前分镜及补图计划，继续？" onOk={generate} disabled={locked}><Button type="primary" disabled={locked||!script.trim()} loading={busy==='board'}>一键生成分镜头剧本</Button></Popconfirm>:<Button type="primary" disabled={locked||!script.trim()} loading={busy==='board'} onClick={generate}>一键生成分镜头剧本</Button>}
   {error&&<p role="alert" className="storyboard-error">{error}</p>}
  </div>
  <div className="storyboard-results"><div className="storyboard-panel-heading"><span className="editor-step">02</span><h3>分镜头剧本</h3><small>{board?.scenes.length ? `${board.scenes.length} 个场景` : '镜头规划'}</small></div>{board?.source_script!==undefined&&board.source_script!==script&&<p className="storyboard-error">剧本已修改，当前分镜来自之前的剧本。</p>}
   {!!board?.scenes.length&&<div className="storyboard-batch"><Button type="primary" disabled={locked} loading={busy==='all'} onClick={prepareAll}>全部生成（参考图 + Prompt）</Button><p className="subtle" role="status" aria-live="polite">{batchProgress?`正在生成场景 ${batchProgress.current} / ${batchProgress.total}，完成后自动保存到本集场景。`:`按顺序生成全部 ${board.scenes.length} 个场景，并自动保存到本集场景。`}</p></div>}
   {!board?.scenes.length&&<p className="subtle">生成结果按场景显示。选择场景准备参考图与视频 Prompt。</p>}
   {board?.scenes.map((scene,index)=><div className="storyboard-scene" key={index}>
    <div className="storyboard-scene-heading"><b>场景 {String(index+1).padStart(2,'0')}</b><span>{scene.shots.length} 个镜头 · {scene.duration} 秒</span></div><Input aria-label={`场景 ${index+1} 标题`} value={scene.title} disabled={locked} onChange={title=>update(index,{...scene,title})}/>
    {scene.shots.map((shot,i)=><div className="storyboard-shot" key={i}><b>镜头 {i+1} · {shot.duration} 秒</b><Input.TextArea aria-label={`场景 ${index+1} 镜头 ${i+1} 描述`} value={shot.description} disabled={locked} autoSize onChange={description=>update(index,{...scene,plan:undefined,shots:scene.shots.map((s,n)=>n===i?{...s,description}:s)})}/><div className="storyboard-shot-meta"><label>秒数<input type="number" min="0.1" max="15" step="0.1" value={shot.duration} disabled={locked} onChange={e=>editShot(scene,index,i,{duration:Number(e.target.value)})}/></label><Input aria-label="景别与运镜" value={shot.camera} disabled={locked} placeholder="景别与运镜" onChange={camera=>editShot(scene,index,i,{camera})}/><Input aria-label="声音与对白" value={shot.sound} disabled={locked} placeholder="声音与对白" onChange={sound=>editShot(scene,index,i,{sound})}/></div></div>)}
    <Button disabled={locked} loading={busy===`plan-${index}`} onClick={()=>prepare(scene,index)}>生成场景信息（参考图 + Prompt）</Button><p className="subtle">生成后自动保存到本集场景；需要补图时会自动生成参考图。</p>
    {scene.plan&&<div className="storyboard-plan"><h4>参考图（按 Picture 顺序）</h4><div className="storyboard-refs">{scene.plan.reference_media_ids.map((id,i)=>{const media=data.media.find(m=>m.id===id);return <figure key={id}>{media&&<PreviewImage media={media} alt={media.name}/>}<figcaption>Picture {i+1} · {media?.name||'图片已删除'}</figcaption></figure>;})}</div>
     {scene.plan.image_tasks.map((task,i)=><div className="storyboard-task" key={i}><b>Picture {scene.plan!.reference_media_ids.length+i+1} · {task.name} · {task.operation}</b>{task.media_id&&data.media.find(m=>m.id===task.media_id)&&<PreviewImage media={data.media.find(m=>m.id===task.media_id)!} alt={task.name}/>}<Input.TextArea value={task.prompt} disabled={locked} autoSize onChange={prompt=>update(index,{...scene,plan:{...scene.plan!,image_tasks:scene.plan!.image_tasks.map((t,n)=>n===i?{...t,prompt,media_id:undefined}:t)}})}/><Button disabled={locked} loading={busy===`image-${index}-${i}`} onClick={()=>supplement(scene,index,task,i)}>{task.media_id?'重新生成补图':'生成补图'}</Button></div>)}
     <h4>MiniMax-H3 · 全能参考 Prompt</h4><Input.TextArea value={scene.plan.prompt} disabled={locked} rows={8} onChange={prompt=>update(index,{...scene,plan:{...scene.plan!,prompt}})}/>
     <Select disabled={locked} value={target[index]??scene.scene_id??0} onChange={id=>setTarget({...target,[index]:id})}><Select.Option value={0}>创建新场景</Select.Option>{data.episodes.find(e=>e.id===episodeId)?.scenes.map(s=><Select.Option key={s.id} value={s.id}>更新：{s.title}</Select.Option>)}</Select>
     <Popconfirm title="将参考图与 Prompt 写入所选场景，立即保存，继续？" onOk={()=>apply(scene,index)} disabled={locked}><Button type="primary" disabled={locked||scene.plan.image_tasks.some(t=>!t.media_id)} loading={busy===`apply-${index}`}>写入本集场景</Button></Popconfirm>
    </div>}
   </div>)}
  </div>
 </div>;
}
