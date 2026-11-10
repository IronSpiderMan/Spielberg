import { localId } from "./id";
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { Accessibility, Armchair, Camera, Footprints, Move3D, PersonStanding, Plus, RotateCcw, ScanLine, Trash2 } from 'lucide-react';
import { Button, Message, Modal } from '@arco-design/web-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Media, post } from './core';
import { applyPoseFigure, createPoseFigure, createWoodGrain, disposePoseFigure, joints, seatedDrop } from './pose-figure';
import type { Person } from './pose-figure';
import './pose-studio.css';

export type { Person } from './pose-figure';

type Angles = [number, number, number];
type Joint = typeof joints[number];
const presets = [
  { name: '站立', Icon: PersonStanding },
  { name: '举手', Icon: Accessibility },
  { name: '坐姿', Icon: Armchair },
  { name: '迈步', Icon: Footprints },
] as const;
const jointRows: Joint[][] = [
  ['头部', '腰部'],
  ['左肩', '左肘', '右肩', '右肘'],
  ['左髋', '左膝', '右髋', '右膝'],
];
const axes = ['前后弯曲', '左右扭转', '侧向摆动'];
const cameraViews = [
  { name: '正面', offset: [0, 0, 4.25] },
  { name: '侧面', offset: [4.25, 0, 0] },
  { name: '背面', offset: [0, 0, -4.25] },
  { name: '斜视', offset: [1.28, .55, 4.15] },
] as const;

const neutral = ():Record<Joint,Angles> => {
  const pose=Object.fromEntries(joints.map(j=>[j,[0,0,0]])) as Record<Joint,Angles>;
  pose['左肩']=[0,0,-8];pose['右肩']=[0,0,8];
  return pose;
};
const person = (n:number):Person => ({id:localId(),name:`人物 ${n}`,x:0,y:0,z:0,turn:0,pose:neutral()});
export default function PoseStudio({projectId,size,onUse,onClose,initialPeople,onPeopleChange}:{projectId:string;size:string;initialPeople?:Person[];onPeopleChange:(people:Person[])=>void;onUse:(m:Media)=>void;onClose:()=>void}) {
  const [people,setPeople]=useState<Person[]>(()=>initialPeople?.length?initialPeople:[person(1)]),[selected,setSelected]=useState(''),[joint,setJoint]=useState<Joint>('左肩'),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [panel, setPanel] = useState<'joint' | 'position'>('joint');
  const markers = useRef(new Map<Joint, HTMLButtonElement>());
  const markerPerson = useRef('');
  const drag = useRef<{ pointerId: number; personId: string; joint: Joint; x: number; y: number; angles: Angles }>();
  const [host,setHost]=useState<HTMLDivElement|null>(null);
  const runtime=useRef<{renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.PerspectiveCamera;controls:OrbitControls;figures:Map<string, ReturnType<typeof createPoseFigure>>;grain:THREE.Texture;grid:THREE.GridHelper}>();
  const counter=useRef(Math.max(1,...people.map(p=>Number(p.name.split(' ')[1])||1))),saveLock=useRef(false);
  const current=people.find(p=>p.id===selected)||people[0];
  const dimensions=size.split('x').map(Number),width=dimensions[0]||1152,height=dimensions[1]||640;
  const aspect=width/height;
  useEffect(() => { markerPerson.current = current.id; }, [current.id]);
  useEffect(()=>{
    if(!host)return;
    const container=host;let renderer:THREE.WebGLRenderer;
    try { renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); } catch {setError('无法启动 3D 画布，请启用硬件加速或换用支持 WebGL 的设备。');return;}
    const scene=new THREE.Scene();scene.background=new THREE.Color('#e9e7e2');
    renderer.toneMapping = THREE.NeutralToneMapping;
    const camera=new THREE.PerspectiveCamera(38,aspect,.01,100);camera.position.set(1.28,1.52,3.95);
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.97,0);controls.minDistance=1;controls.maxDistance=20;controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff,0xbab3a8,1.1));
    const key = new THREE.DirectionalLight(0xfff4e7, 2.25);
    key.position.set(-3, 5, 4);
    const rim = new THREE.DirectionalLight(0xffffff, 1.0);
    rim.position.set(3, 3, -4);
    scene.add(key, rim);
    const grid=new THREE.GridHelper(12,24,0x9da7b5,0xcdd3dc);grid.position.y=-.03;scene.add(grid);
    const grain = createWoodGrain();
    const figures = new Map<string, ReturnType<typeof createPoseFigure>>();
    container.appendChild(renderer.domElement);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    runtime.current={renderer,scene,camera,controls,figures,grain,grid};
    const resize=()=>{renderer.setSize(container.clientWidth,container.clientHeight,false);};
    const observer=new ResizeObserver(resize);observer.observe(container);resize();
    const point = new THREE.Vector3();
    renderer.setAnimationLoop(() => {
      renderer.render(scene, camera);
      const figure = figures.get(markerPerson.current);
      for (const [name, marker] of markers.current) {
        const pivot = figure?.pivots.get(name);
        if (pivot) point.setFromMatrixPosition(pivot.matrixWorld).project(camera);
        const visible = !!pivot && Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1;
        marker.style.visibility = visible ? 'visible' : 'hidden';
        if (!visible) continue;
        marker.style.left = `${(point.x + 1) * 50}%`;
        marker.style.top = `${(1 - point.y) * 50}%`;
        marker.style.zIndex = marker.getAttribute('aria-pressed') === 'true' ? '100000' : String(Math.round((1 - point.z) * 49000));
      }
    });
    return ()=>{observer.disconnect();renderer.setAnimationLoop(null);controls.dispose();figures.forEach(disposePoseFigure);grain.dispose();grid.geometry.dispose();(grid.material as THREE.Material).dispose();renderer.dispose();renderer.domElement.remove();runtime.current=undefined;};
  },[aspect,host]);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt) return;
    const activeIds = new Set(people.map(person => person.id));
    for (const [id, figure] of rt.figures) {
      if (activeIds.has(id)) continue;
      disposePoseFigure(figure);
      rt.figures.delete(id);
    }
    people.forEach(person => {
      let figure = rt.figures.get(person.id);
      if (!figure) {
        figure = createPoseFigure(rt.grain);
        rt.scene.add(figure.root);
        rt.figures.set(person.id, figure);
      }
      applyPoseFigure(figure, person);
    });
  }, [people, aspect, host]);
  useEffect(()=>onPeopleChange(people),[people,onPeopleChange]);
  function patch(change:Partial<Person>) {setPeople(all=>all.map(p=>p.id===current.id?{...p,...change}:p));}
  function updateJoint(id: string, name: Joint, angles: Angles) {
    setPeople(all => all.map(p => p.id === id ? { ...p, pose: { ...p.pose, [name]: angles } } : p));
  }
  function startJointDrag(event: PointerEvent<HTMLButtonElement>, name: Joint) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setJoint(name);
    drag.current = { pointerId: event.pointerId, personId: current.id, joint: name, x: event.clientX, y: event.clientY, angles: current.pose[name] };
  }
  function moveJoint(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const angle = (value: number) => THREE.MathUtils.clamp(Math.round(value), -180, 180);
    updateJoint(start.personId, start.joint, [angle(start.angles[0] + dy), start.angles[1], angle(start.angles[2] + dx)]);
  }
  function endJointDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = undefined;
  }
  function setView([x, y, z]: readonly [number, number, number]) {
    const rt = runtime.current;
    if (!rt) return;
    rt.controls.target.set(current.x, .97 + current.y, current.z);
    rt.camera.position.set(x, y, z).add(rt.controls.target);
    rt.controls.update();
  }
  function addPerson() {
    const next = person(++counter.current);
    next.x = (people.length % 4) * .7;
    next.z = Math.floor(people.length / 4) * .8;
    setPeople([...people, next]);
    setSelected(next.id);
  }
  function preset(name: typeof presets[number]['name']) {
    const pose=neutral();let y=0;
    if(name==='举手'){pose['左肩']=[0,0,-155];pose['右肩']=[0,0,155];pose['左肘']=[-20,0,0];pose['右肘']=[-20,0,0];}
    if(name==='坐姿'){pose['左髋']=[-90,0,0];pose['右髋']=[-90,0,0];pose['左膝']=[90,0,0];pose['右膝']=[90,0,0];y=-seatedDrop;}
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
  function range(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, unit = '') {
    return <label key={label} className="pose-range">
      <span>{label}</span>
      <output>{value}{unit}</output>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}/>
    </label>;
  }

  return <Modal
    visible
    title={<div className="pose-title"><span className="pose-title-icon"><ScanLine size={19}/></span><span><strong>3D 姿势参考</strong><small>为图生图摆设人物动作和构图</small></span></div>}
    className="pose-modal"
    style={{ width: 'min(1280px, 96vw)' }}
    onCancel={onClose}
    maskClosable={false}
    closable={!saving}
    escToExit={!saving}
    footer={<div className="pose-footer">
      <span className="helper">截图 {width} × {height} · 仅导出人物与背景</span>
      <Button disabled={saving} onClick={onClose}>关闭</Button>
      <Button type="primary" loading={saving} disabled={!!error || !host} icon={<Camera size={16}/>} onClick={capture}>截图并用作参考图</Button>
    </div>}
  >
    <div className="pose-layout">
      <section className="pose-workspace" aria-label="姿势画布">
        <div className="pose-preset-bar">
          <strong>动作预设</strong>
          <div className="pose-presets" role="group" aria-label="动作预设">
            {presets.map(({name, Icon}) => <Button key={name} size="small" disabled={saving || !!error} icon={<Icon size={16}/>} onClick={() => { preset(name); setPanel('joint'); }}>{name}</Button>)}
          </div>
        </div>
        <div className="pose-stage">
          <div className="pose-frame" style={{ '--pose-aspect': aspect } as CSSProperties}>
            <div ref={setHost} className="pose-viewport" aria-label="3D 人体姿势画布"/>
            {!error && panel === 'joint' && <div className="pose-markers" role="group" aria-label="画布关节">
              {joints.map(name => <button
                key={name}
                type="button"
                className="pose-marker"
                ref={element => { if (element) markers.current.set(name, element); else markers.current.delete(name); }}
                disabled={saving}
                aria-label={`画布关节 · ${name}`}
                aria-pressed={joint === name}
                title={name}
                onClick={() => setJoint(name)}
                onPointerDown={event => startJointDrag(event, name)}
                onPointerMove={moveJoint}
                onLostPointerCapture={endJointDrag}
              />)}
            </div>}
            {error && <p className="pose-error" role="alert">{error}</p>}
          </div>
        </div>
        <div className="pose-view-bar">
          <div className="pose-camera" role="group" aria-label="视角">
            {cameraViews.map(({name, offset}) => <Button key={name} size="small" disabled={saving || !!error} onClick={() => setView(offset)}>{name}</Button>)}
          </div>
          <span className="pose-view-hint">拖动空白处旋转 · 右键平移 · 滚轮缩放</span>
        </div>
      </section>
      <fieldset className="pose-settings" disabled={saving || !!error} aria-label="人物与姿势">
        <section className="pose-cast">
          <div className="pose-section-heading">
            <strong>场景人物 <small>{people.length}/8</small></strong>
            <div className="pose-cast-actions">
              <Button size="small" icon={<Plus size={16}/>} title="添加人物" aria-label="添加人物" disabled={people.length >= 8} onClick={addPerson}/>
              <Button size="small" icon={<Trash2 size={15}/>} title="删除人物" aria-label="删除人物" disabled={people.length <= 1} onClick={() => setPeople(all => all.filter(p => p.id !== current.id))}/>
            </div>
          </div>
          <div className="pose-person-list" role="group" aria-label="当前人物">
            {people.map(p => <button key={p.id} type="button" aria-pressed={p.id === current.id} onClick={() => setSelected(p.id)}>{p.name}</button>)}
          </div>
        </section>
        <div className="pose-panel-switch" role="group" aria-label="编辑内容">
          <button type="button" aria-pressed={panel === 'joint'} onClick={() => setPanel('joint')}><Accessibility size={15}/>关节</button>
          <button type="button" aria-pressed={panel === 'position'} onClick={() => setPanel('position')}><Move3D size={15}/>站位与朝向</button>
        </div>
        {panel === 'joint' ? <div className="pose-inspector">
          <p className="pose-inspector-hint">直接拖动圆点调整关节，也可在这里选中后微调。</p>
          <div className="pose-joint-list" role="group" aria-label="编辑关节">
            {jointRows.map(row => <div key={row[0]}>{row.map(name => <button key={name} type="button" aria-pressed={joint === name} onClick={() => setJoint(name)}>{name}</button>)}</div>)}
          </div>
          <div className="pose-section-heading pose-adjust-heading">
            <strong>{joint}角度</strong>
            <Button size="mini" type="text" icon={<RotateCcw size={13}/>} onClick={() => updateJoint(current.id, joint, neutral()[joint])}>重置关节</Button>
          </div>
          {axes.map((label, i) => range(label, current.pose[joint][i], -180, 180, 1, value => {
            const angles: Angles = [...current.pose[joint]];
            angles[i] = value;
            updateJoint(current.id, joint, angles);
          }, '°'))}
        </div> : <div className="pose-inspector">
          <div className="pose-section-heading"><strong>{current.name}的位置</strong></div>
          {range('左右位置', current.x, -5, 5, .05, x => patch({x}))}
          {range('前后位置', current.z, -5, 5, .05, z => patch({z}))}
          {range('高度', current.y, -1, 3, .05, y => patch({y}))}
          {range('人物朝向', current.turn, -180, 180, 1, turn => patch({turn}), '°')}
        </div>}
      </fieldset>
    </div>
  </Modal>;
}
