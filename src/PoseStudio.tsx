import { localId } from "./id";
import { useEffect, useRef, useState } from 'react';
import { Button, Message, Modal } from '@arco-design/web-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Media, post } from './core';
import './pose-studio.css';

type Angles = [number, number, number];
const joints = ['腰部','头部','左肩','左肘','右肩','右肘','左髋','左膝','右髋','右膝'] as const;
type Joint = typeof joints[number];
export type Person = { id:string; name:string; x:number; y:number; z:number; turn:number; pose:Record<Joint,Angles> };
const neutral = ():Record<Joint,Angles> => {
  const pose=Object.fromEntries(joints.map(j=>[j,[0,0,0]])) as Record<Joint,Angles>;
  pose['左肩']=[0,0,-8];pose['右肩']=[0,0,8];
  return pose;
};
const person = (n:number):Person => ({id:localId(),name:`人物 ${n}`,x:0,y:0,z:0,turn:0,pose:neutral()});
const colors = [0xced9e6,0xe4bb9c,0xa9c9bd,0xc5b5dc];
function mannequin(p:Person,index:number) {
  const root=new THREE.Group(), pivots={} as Record<Joint,THREE.Group>;
  const material=new THREE.MeshStandardMaterial({color:colors[index%colors.length],roughness:.72});
  const jointMaterial=new THREE.MeshStandardMaterial({color:0x667789,roughness:.8});
  function ellipsoid(parent:THREE.Group,position:Angles,scale:Angles,mat=material) {
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,20,14),mat);
    mesh.position.set(...position);mesh.scale.set(...scale);parent.add(mesh);
  }
  function pivot(parent:THREE.Group,name:Joint,position:Angles) {
    const g=new THREE.Group();g.position.set(...position);parent.add(g);pivots[name]=g;
    ellipsoid(g,[0,0,0],[.06,.06,.06],jointMaterial);return g;
  }
  // A built-in adult mannequin: tapered torso and limbs, roughly 7.5 heads tall.
  // All parts stay attached to the editable joint hierarchy; no remote assets are needed.
  function tapered(parent:THREE.Group,position:Angles,profile:Angles[],depth:number) {
    const geometry=new THREE.LatheGeometry(profile.map(([radius,y])=>new THREE.Vector2(radius,y)),32);
    geometry.scale(1,1,depth);
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...position);parent.add(mesh);
  }
  ellipsoid(root,[0,.96,0],[.19,.14,.13]);
  const waist=pivot(root,'腰部',[0,1.06,0]);
  tapered(waist,[0,0,0],[[0,-.07,0],[.13,-.04,0],[.145,.04,0],[.17,.16,0],[.225,.3,0],[.23,.39,0],[.18,.45,0],[.07,.49,0],[0,.5,0]],.62);
  ellipsoid(waist,[0,.53,0],[.06,.09,.06]);
  const head=pivot(waist,'头部',[0,.61,0]);
  ellipsoid(head,[0,.09,0],[.095,.13,.105]);
  ellipsoid(head,[0,.025,.035],[.075,.075,.075]);
  ellipsoid(head,[0,.07,.103],[.022,.032,.025]);
  for(const side of [-1,1]) {
    const left=side===-1;
    const shoulder=pivot(waist,left?'左肩':'右肩',[side*.255,.41,0]);
    ellipsoid(shoulder,[0,-.04,0],[.085,.1,.08]);
    tapered(shoulder,[0,0,0],[[0,-.32,0],[.05,-.3,0],[.065,-.2,0],[.073,-.1,0],[.065,-.03,0],[0,0,0]],1);
    const elbow=pivot(shoulder,left?'左肘':'右肘',[0,-.32,0]);
    tapered(elbow,[0,0,0],[[0,-.28,0],[.035,-.265,0],[.045,-.19,0],[.062,-.08,0],[.05,-.02,0],[0,0,0]],.9);
    ellipsoid(elbow,[0,-.32,0],[.047,.085,.028]);
    const hip=pivot(root,left?'左髋':'右髋',[side*.13,.93,0]);
    tapered(hip,[0,0,0],[[0,-.44,0],[.062,-.41,0],[.085,-.28,0],[.108,-.13,0],[.1,-.04,0],[0,.02,0]],1.05);
    const knee=pivot(hip,left?'左膝':'右膝',[0,-.44,0]);
    tapered(knee,[0,0,0],[[0,-.42,0],[.04,-.4,0],[.05,-.27,0],[.078,-.14,0],[.06,-.03,0],[0,0,0]],1);ellipsoid(knee,[0,-.42,.065],[.09,.065,.16]);
  }
  joints.forEach(j=>pivots[j].rotation.set(...p.pose[j].map(THREE.MathUtils.degToRad) as Angles));
  root.position.set(p.x,p.y,p.z);root.rotation.y=THREE.MathUtils.degToRad(p.turn);
  return root;
}
function disposeObject(object:THREE.Object3D) {
  object.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose());}});
}
export default function PoseStudio({projectId,size,onUse,onClose,initialPeople,onPeopleChange}:{projectId:string;size:string;initialPeople?:Person[];onPeopleChange:(people:Person[])=>void;onUse:(m:Media)=>void;onClose:()=>void}) {
  const [people,setPeople]=useState<Person[]>(()=>initialPeople?.length?initialPeople:[person(1)]),[selected,setSelected]=useState(''),[joint,setJoint]=useState<Joint>('左肩'),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [host,setHost]=useState<HTMLDivElement|null>(null);
  const runtime=useRef<{renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.PerspectiveCamera;controls:OrbitControls;models:THREE.Group;grid:THREE.GridHelper}>();
  const counter=useRef(Math.max(1,...people.map(p=>Number(p.name.split(' ')[1])||1))),saveLock=useRef(false);
  const current=people.find(p=>p.id===selected)||people[0];
  const dimensions=size.split('x').map(Number),width=dimensions[0]||1152,height=dimensions[1]||640;
  const aspect=width/height;
  useEffect(()=>{
    if(!host)return;
    const container=host;let renderer:THREE.WebGLRenderer;
    try { renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); } catch {setError('无法启动 3D 画布，请启用硬件加速或换用支持 WebGL 的设备。');return;}
    const scene=new THREE.Scene();scene.background=new THREE.Color('#eceef2');
    const camera=new THREE.PerspectiveCamera(38,aspect,.01,100);camera.position.set(3,2.5,5);
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.9,0);controls.minDistance=1;controls.maxDistance=20;controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff,0x737b89,2.5));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,6,4);scene.add(light);
    const grid=new THREE.GridHelper(12,24,0x9da7b5,0xcdd3dc);grid.position.y=-.03;scene.add(grid);
    const models=new THREE.Group();scene.add(models);container.appendChild(renderer.domElement);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    runtime.current={renderer,scene,camera,controls,models,grid};
    const resize=()=>{renderer.setSize(container.clientWidth,container.clientHeight);};
    const observer=new ResizeObserver(resize);observer.observe(container);resize();
    renderer.setAnimationLoop(()=>renderer.render(scene,camera));
    return ()=>{observer.disconnect();renderer.setAnimationLoop(null);controls.dispose();disposeObject(models);grid.geometry.dispose();(grid.material as THREE.Material).dispose();renderer.dispose();renderer.domElement.remove();runtime.current=undefined;};
  },[aspect,host]);
  useEffect(()=>{const rt=runtime.current;if(!rt)return;disposeObject(rt.models);rt.models.clear();people.forEach((p,i)=>rt.models.add(mannequin(p,i)));},[people,aspect,host]);
  useEffect(()=>onPeopleChange(people),[people,onPeopleChange]);
  function patch(change:Partial<Person>) {setPeople(all=>all.map(p=>p.id===current.id?{...p,...change}:p));}
  function preset(name:string) {
    const pose=neutral();let y=0;
    if(name==='举手'){pose['左肩']=[0,0,-155];pose['右肩']=[0,0,155];pose['左肘']=[-20,0,0];pose['右肘']=[-20,0,0];}
    if(name==='坐姿'){pose['左髋']=[-90,0,0];pose['右髋']=[-90,0,0];pose['左膝']=[90,0,0];pose['右膝']=[90,0,0];y=-.42;}
    if(name==='迈步'){pose['左髋']=[-35,0,0];pose['右髋']=[30,0,0];pose['右膝']=[35,0,0];pose['左肩']=[30,0,0];pose['右肩']=[-30,0,0];}
    patch({pose,y});
  }
  async function capture() {
    const rt=runtime.current;if(!rt||saveLock.current)return;saveLock.current=true;setSaving(true);
    try {
      const oldSize=rt.renderer.getSize(new THREE.Vector2()),pixelRatio=rt.renderer.getPixelRatio();let dataUrl:string;
      try {rt.grid.visible=false;rt.renderer.setPixelRatio(1);rt.renderer.setSize(width,height,false);rt.renderer.render(rt.scene,rt.camera);dataUrl=rt.renderer.domElement.toDataURL('image/png');}
      finally {rt.grid.visible=true;rt.renderer.setPixelRatio(pixelRatio);rt.renderer.setSize(oldSize.x,oldSize.y,false);rt.renderer.render(rt.scene,rt.camera);}
      const media=await post<Media>('/media/pose-reference',{project_id:projectId,data_url:dataUrl});
      onUse(media);Message.success('姿势截图已入库，并加入参考图片');
    } catch(e){Message.error(`保存姿势截图失败：${String(e)}`);}finally{saveLock.current=false;setSaving(false);}
  }
  function range(label:string,value:number,min:number,max:number,step:number,onChange:(v:number)=>void) {
    return <label className="pose-range">{label}<output>{value}</output><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;
  }
  return <Modal visible title="3D 姿势参考" className="pose-modal" style={{width:'min(1180px, 96vw)'}} onCancel={onClose} maskClosable={false} closable={!saving} footer={<><Button disabled={saving} onClick={onClose}>关闭</Button><Button type="primary" loading={saving} disabled={!!error} onClick={capture}>截图并用作参考图</Button></>}>
    <div className="pose-layout"><div><div ref={setHost} className="pose-viewport" style={{aspectRatio:aspect}} aria-label="3D 人体姿势画布"/>{error&&<p role="alert">{error}</p>}<p className="helper">拖动画布旋转视角 · 右键拖动平移 · 滚轮缩放。截图 {width} × {height}，不含网格和操作面板。</p><div className="pose-camera">{['正面','侧面','背面'].map((name,i)=><Button key={name} onClick={()=>{const rt=runtime.current;if(rt){rt.controls.target.set(0,.9,0);rt.camera.position.set(i===1?5:0,1.7,i===2?-5:i===1?0:5);rt.controls.update();}}}>{name}</Button>)}</div></div>
    <fieldset className="pose-settings" disabled={saving}><div className="pose-model-preset"><strong>标准人体</strong><span>内置 3D 模型 · 成人比例</span></div><label>当前人物<select aria-label="当前人物" value={current.id} onChange={e=>setSelected(e.target.value)}>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="pose-actions"><Button disabled={people.length>=8} onClick={()=>{const next=person(++counter.current);next.x=(people.length%4)*.7;next.z=Math.floor(people.length/4)*.8;setPeople([...people,next]);setSelected(next.id);}}>添加人物</Button><Button disabled={people.length<=1} onClick={()=>setPeople(people.filter(p=>p.id!==current.id))}>删除人物</Button></div><p className="helper">支持最多 8 人；分别设置站位和动作。</p>
    {range('左右位置',current.x,-5,5,.05,x=>patch({x}))}{range('前后位置',current.z,-5,5,.05,z=>patch({z}))}{range('高度',current.y,-1,3,.05,y=>patch({y}))}{range('人物朝向',current.turn,-180,180,1,turn=>patch({turn}))}
    <label>动作预设<select aria-label="动作预设" value="" onChange={e=>preset(e.target.value)}><option value="" disabled>选择动作</option>{['站立','举手','坐姿','迈步'].map(p=><option key={p}>{p}</option>)}</select></label>
    <label>编辑关节<select aria-label="编辑关节" value={joint} onChange={e=>setJoint(e.target.value as Joint)}>{joints.map(j=><option key={j}>{j}</option>)}</select></label>
    {['前后弯曲','左右扭转','侧向摆动'].map((label,i)=>range(label,current.pose[joint][i],-180,180,1,value=>{const angles=[...current.pose[joint]] as Angles;angles[i]=value;patch({pose:{...current.pose,[joint]:angles}});}))}
    </fieldset></div></Modal>;
}
