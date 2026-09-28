import { Button,Checkbox,Dropdown,Menu,Message,Modal } from "@arco-design/web-react";
import { open,save,downloadName } from "./platform";
import { Archive } from "lucide-react";
import { useState } from "react";
import { Project,post } from "./core";
export default function ProjectTools({project,onRestored}: {project?:Project;onRestored:(id:string)=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[includeKeys,setIncludeKeys]=useState(false);
  const backup=async()=>{
    if(!project)return;
    const safeName=project.name.replace(/[\\/:*?"<>|]/g,"_");
    const path=await save({title:"保存项目备份压缩包",defaultPath:`${safeName}-${new Date().toISOString().slice(0,10)}.spielberg-backup`,filters:[{name:"Spielberg 备份",extensions:["spielberg-backup"]}]});
    if(!path)return;
    setBusy(true);
    try{await post("/projects/backup",{project_id:project.id,path,include_api_keys:includeKeys});setConfirm(false);Message.success(downloadName(path)!==null?"备份已开始下载":`备份已保存：${path}`);}catch(e){Message.error(String(e));throw e;}finally{setBusy(false);}
  };
  const restore=async(legacy=false)=>{
    try{
      const path=await open(legacy?{directory:true,multiple:false,title:"选择旧版项目备份文件夹"}:{multiple:false,title:"选择项目备份压缩包",filters:[{name:"Spielberg 备份",extensions:["spielberg-backup"]}]});
      if(typeof path!=="string")return;setBusy(true);
      const restored=await post<Project>("/projects/restore",{path});await onRestored(restored.id);Message.success("已恢复为独立项目");
    }catch(e){Message.error(String(e));}finally{setBusy(false);}
  };
  return <>
    {project?<Dropdown trigger="click" droplist={<Menu onClickMenuItem={key=>{if(key==="backup"){setIncludeKeys(false);setConfirm(true);}else void restore(key==="legacy");}}><Menu.Item key="backup">备份当前项目</Menu.Item><Menu.Item key="restore">从备份恢复</Menu.Item><Menu.Item key="legacy">从旧版备份文件夹恢复</Menu.Item></Menu>}><Button loading={busy} icon={<Archive size={16}/>}>项目备份</Button></Dropdown>:<Dropdown trigger="click" droplist={<Menu onClickMenuItem={key=>void restore(key==="legacy")}><Menu.Item key="restore">选择备份压缩包</Menu.Item><Menu.Item key="legacy">选择旧版备份文件夹</Menu.Item></Menu>}><Button loading={busy} icon={<Archive size={16}/>}>从备份恢复</Button></Dropdown>}
    <Modal className="project-tools" visible={confirm} title="备份当前项目" okText="选择位置并备份" confirmLoading={busy} maskClosable={!busy} closable={!busy} onCancel={()=>{if(!busy)setConfirm(false);}} onOk={backup}>
      <p>保存剧本、角色、所有素材（含回收站）、生成记录和模型配置，生成可复制到其他电脑的单个压缩包。</p>
      <p>恢复时会创建独立项目，不覆盖现有内容。备份期间需等待生成任务结束。</p>
      <Checkbox checked={includeKeys} onChange={setIncludeKeys}>包含模型 API Key（仅在个人设备间迁移时勾选）</Checkbox>
    </Modal>
  </>;
}
