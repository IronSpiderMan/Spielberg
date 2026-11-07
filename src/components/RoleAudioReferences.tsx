import { ConfirmPopover } from "./ConfirmAction";
import { RevealFileButton } from "./RevealFileButton";
import { useEffect, useRef, useState } from "react";
import { Button, Empty, Form, Input, Message, Modal } from "@arco-design/web-react";
import { AudioLines, Music2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { imageUrl, post, type Media, type Asset, type Snapshot } from "../core";
import { open } from "../platform";
import { supportsAudioReferences } from "../asset-categories";
import "./role-audio-references.css";

export function RoleAudioReferences({role,data,reload,editable=false}:{role:Asset;data:Snapshot;reload:()=>void;editable?:boolean}) {
  const [picker,setPicker]=useState(false);
  const [query,setQuery]=useState("");
  const [pending,setPending]=useState<{id:number;name:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const playing = useRef<HTMLAudioElement | null>(null);
  const audios=(role.audios || []).filter(audio=>audio.kind==="audio");
  const available=data.media.filter(media=>media.kind==="audio"&&!audios.some(audio=>audio.id===media.id));
  const matches=available.filter(media=>media.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(()=>()=>{playing.current?.pause();},[]);
  const playOne=(audio:HTMLAudioElement)=>{
    if(playing.current!==audio)playing.current?.pause();
    playing.current=audio;
  };
  const closePicker=()=>{playing.current?.pause();setPicker(false);setQuery("");};
  const chooseAudio=(media:Media)=>{
    closePicker();
    setPending({id:media.id,name:media.name.replace(/\.[^.]+$/,"")});
  };
  const save=async()=>{
    if(!pending?.name.trim() || busy) return;
    setBusy(true);
    try {await post("/assets/audio/save",{project_id:data.project.id,asset_id:role.id,media_id:pending.id,name:pending.name.trim()});await reload();setPending(null);Message.success("音频参考已保存");}
    catch(e){Message.error(String(e));}finally{setBusy(false);}
  };
  const upload=async()=>{
    setBusy(true);
    try {
      const source=await open({multiple:false,filters:[{name:"音频",extensions:["mp3","wav","m4a","aac","ogg","flac"]}]});
      if(typeof source!=="string")return;
      const media=await post<Media>("/media/import",{project_id:data.project.id,source_path:source});
      await reload();setPending({id:media.id,name:media.name.replace(/\.[^.]+$/,"")});
    }catch(e){Message.error(String(e));}finally{setBusy(false);}
  };
  if (!supportsAudioReferences(role.category)) return null;
  return <section className={`role-audio-references${editable?" is-editable":""}`} aria-label="音频参考">
    <div className="role-detail-gallery-heading"><div><h2>音频参考 <span>{audios.length}</span></h2><p>{editable?"保存人物音色或生物叫声，可分别命名。添加和修改后立即保存。":"保存人物音色与生物叫声，点击播放试听。"}</p></div></div>
    {editable&&<div className="role-audio-add-actions"><Button icon={<Plus size={15}/>} disabled={busy} onClick={()=>{setQuery("");setPicker(true);}}>从素材库选择音频</Button><Button icon={<Upload size={15}/>} loading={busy} onClick={upload}>导入资产音频</Button></div>}
    {audios.length?<div className="role-audio-grid">{audios.map(audio=><article key={audio.id} className="role-audio-item">
      <div className="role-audio-title"><span className="role-audio-icon"><AudioLines size={19}/></span><div><b title={audio.name}>{audio.name}</b><small>音频参考</small></div></div>
      <audio controls preload="none" src={imageUrl(audio)} aria-label={`试听 ${audio.name}`} onPlay={event=>playOne(event.currentTarget)}/>
      <div className="role-audio-actions"><RevealFileButton className="role-audio-reveal" size="mini" path={audio.path} disabled={busy}/>
        {editable&&<><Button type="text" size="mini" icon={<Pencil size={13}/>} disabled={busy} aria-label={`修改音频名称 ${audio.name}`} onClick={()=>setPending({id:audio.id,name:audio.name})}>修改名称</Button>
          <ConfirmPopover title="移除这段音频参考？" content={`将从资产中移除「${audio.name}」，素材库中的文件会保留。移除立即生效。`} okText="移除音频" disabled={busy} onOk={async()=>{setBusy(true);try{await post("/assets/audio/delete",{project_id:data.project.id,asset_id:role.id,media_id:audio.id});await reload();}catch(e){Message.error(String(e));throw e;}finally{setBusy(false);}}}><Button type="text" size="mini" status="danger" icon={<Trash2 size={13}/>} disabled={busy} aria-label={`移除音频 ${audio.name}`}>移除</Button></ConfirmPopover></>}
      </div>
    </article>)}</div>:<div className="role-audio-empty"><Empty description="还没有音频参考，可添加多段音频并分别命名"/></div>}
    <Modal className="role-audio-picker-modal" visible={picker} title="选择参考音频" footer={null} unmountOnExit style={{width:640,maxWidth:"calc(100vw - 32px)"}} onCancel={closePicker}>
      <div className="role-audio-picker-toolbar"><Input.Search aria-label="搜索音频素材" value={query} onChange={setQuery} allowClear placeholder="搜索音频素材名称"/><span role="status">{query.trim()?`找到 ${matches.length} 段音频`:`${available.length} 段可用音频`}</span></div>
      <p className="role-audio-picker-note">先试听，再选择音频并设置资产中的名称。</p>
      <div className="role-audio-picker-list">{matches.length?matches.map(media=><article className="role-audio-picker-item" key={media.id}>
        <div className="role-audio-picker-copy"><Music2 size={18}/><b title={media.name}>{media.name}</b><Button size="small" type="primary" onClick={()=>chooseAudio(media)} aria-label={`选择音频素材 ${media.name}`}>选择音频</Button></div>
        <audio controls preload="none" src={imageUrl(media)} aria-label={`试听素材 ${media.name}`} onPlay={event=>playOne(event.currentTarget)}/>
      </article>):<div className="role-audio-picker-empty"><Empty description={query.trim()?"没有匹配的音频素材":"暂无可添加的音频，请先导入本地音频"}/>{query.trim()&&<Button type="text" onClick={()=>setQuery("")}>清除搜索</Button>}</div>}</div>
    </Modal>
    <Modal visible={!!pending} title="设置资产音频名称" okText="保存音频参考" confirmLoading={busy} okButtonProps={{disabled:!pending?.name.trim()}} maskClosable={!busy} closable={!busy} escToExit={!busy} cancelButtonProps={{disabled:busy}} onCancel={()=>{if(!busy)setPending(null);}} onOk={save}>
      <Form layout="vertical"><Form.Item label="音频名称" required extra="例如：日常说话、低声耳语、生物叫声。名称仅用于当前资产。"><Input autoFocus aria-label="资产音频名称" disabled={busy} value={pending?.name||""} onChange={name=>setPending(p=>p?{...p,name}:null)} onPressEnter={save}/></Form.Item></Form>
    </Modal>
  </section>;
}
