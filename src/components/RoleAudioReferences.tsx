import { useState } from "react";
import { Button, Empty, Form, Input, Message, Modal, Popconfirm, Select, Space } from "@arco-design/web-react";
import { imageUrl, post, type Media, type Role, type Snapshot } from "../core";
import { open } from "../platform";

export function RoleAudioReferences({role,data,reload,editable=false}:{role:Role;data:Snapshot;reload:()=>void;editable?:boolean}) {
  const [picker,setPicker]=useState(false);
  const [pending,setPending]=useState<{id:number;name:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const audios=role.audios || [];
  const save=async()=>{
    if(!pending?.name.trim() || busy) return;
    setBusy(true);
    try {await post("/roles/audio/save",{project_id:data.project.id,role_id:role.id,media_id:pending.id,name:pending.name.trim()});await reload();setPending(null);Message.success("音色参考已保存");}
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
  return <section className="role-audio-references" aria-label="音色参考">
    <div className="role-detail-gallery-heading"><div><h2>音色参考 <span>{audios.length}</span></h2><p>添加多段命名音频，记录角色的音色、语气与情绪。添加和修改后立即保存。</p></div></div>
    {editable&&<Space wrap><Button disabled={busy} onClick={()=>setPicker(true)}>从资产库选择音频</Button><Button loading={busy} onClick={upload}>导入角色音频</Button></Space>}
    {audios.length?audios.map(audio=><article key={audio.id} className="role-audio-item">
      <b>{audio.name}</b><audio controls preload="none" src={imageUrl(audio)} aria-label={`试听 ${audio.name}`}/>
      {editable&&<Space><Button size="small" disabled={busy} onClick={()=>setPending({id:audio.id,name:audio.name})}>修改名称</Button>
        <Popconfirm title="从角色中移除这段音频？资产库中的文件会保留。" onOk={async()=>{try{await post("/roles/audio/delete",{project_id:data.project.id,role_id:role.id,media_id:audio.id});await reload();}catch(e){Message.error(String(e));}}}><Button size="small" status="danger" disabled={busy}>移除</Button></Popconfirm></Space>}
    </article>):<Empty description="还没有音色参考，可添加多段音频并分别命名"/>}
    <Modal visible={picker} title="选择音色参考音频" footer={null} onCancel={()=>setPicker(false)}>
      <Select aria-label="选择音频资产" showSearch placeholder="选择资产库中的音频" value={undefined} options={data.media.filter(m=>m.kind==="audio"&&!audios.some(a=>a.id===m.id)).map(m=>({value:m.id,label:m.name}))}
        onChange={(id:number)=>{const media=data.media.find(m=>m.id===id)!;setPicker(false);setPending({id,name:media.name.replace(/\.[^.]+$/,"")});}}/>
      {!data.media.some(m=>m.kind==="audio"&&!audios.some(a=>a.id===m.id))&&<p className="helper">暂无可添加的音频，请先导入本地音频。</p>}
    </Modal>
    <Modal visible={!!pending} title="设置角色音频名称" okText="保存音色参考" confirmLoading={busy} okButtonProps={{disabled:!pending?.name.trim()}} maskClosable={!busy} closable={!busy} cancelButtonProps={{disabled:busy}} onCancel={()=>{if(!busy)setPending(null);}} onOk={save}>
      <Form layout="vertical"><Form.Item label="音频名称" required extra="例如：日常说话、温柔低语、愤怒。名称仅用于当前角色。"><Input autoFocus disabled={busy} value={pending?.name||""} onChange={name=>setPending(p=>p?{...p,name}:null)} onPressEnter={save}/></Form.Item></Form>
    </Modal>
  </section>;
}
