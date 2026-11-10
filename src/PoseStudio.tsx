import { localId } from "./id";
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Accessibility, Armchair, Box, Camera, Circle, Cone, Cylinder, Footprints, Layers, Move3D, Palette, PersonStanding, Pill, Plus, Pyramid, RotateCcw, Scaling, ScanLine, Shapes, Torus, Trash2, Triangle } from 'lucide-react';
import { Button, Dropdown, Menu, Message, Modal } from '@arco-design/web-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Media, post } from './core';
import { applyPoseFigure, createPoseFigure, createWoodGrain, disposePoseFigure, joints, seatedDrop } from './pose-figure';
import type { Person, PoseTransform } from './pose-figure';
import './pose-studio.css';

type Angles = [number, number, number];
type Joint = typeof joints[number];
const shapes = {
  box: { name: '长方体', Icon: Box, height: .3, color: '#6489ab', geometry: () => new THREE.BoxGeometry(.7, .6, .55) },
  sphere: { name: '球体', Icon: Circle, height: .35, color: '#b97660', geometry: () => new THREE.SphereGeometry(.35, 32, 24) },
  cylinder: { name: '圆柱', Icon: Cylinder, height: .4, color: '#639483', geometry: () => new THREE.CylinderGeometry(.28, .28, .8, 32) },
  cone: { name: '圆锥', Icon: Cone, height: .45, color: '#bb8660', geometry: () => new THREE.ConeGeometry(.36, .9, 32) },
  pyramid: { name: '四棱锥', Icon: Pyramid, height: .4, color: '#a38960', geometry: () => new THREE.ConeGeometry(.47, .8, 4).rotateY(Math.PI / 4) },
  triangularPrism: { name: '三棱柱', Icon: Triangle, height: .35, color: '#6e94a4', geometry: () => new THREE.CylinderGeometry(.44, .44, .7, 3) },
  capsule: { name: '胶囊体', Icon: Pill, height: .45, color: '#769b65', geometry: () => new THREE.CapsuleGeometry(.24, .42, 8, 24) },
  torus: { name: '圆环', Icon: Torus, height: .45, color: '#907ca9', geometry: () => new THREE.TorusGeometry(.35, .1, 16, 48) },
  plate: { name: '薄板', Icon: Layers, height: .05, color: '#a89483', geometry: () => new THREE.BoxGeometry(.9, .1, .65) },
};
type Shape = keyof typeof shapes;
type ModelColor = { color?: string };
type PrimitiveProperties = { widthScale?: number; heightScale?: number; depthScale?: number; roughness?: number; metalness?: number };
type Primitive = PoseTransform & ModelColor & PrimitiveProperties & { id: string; name: string; shape: Shape };
type PersonModel = Person & ModelColor;
export type PoseModel = PersonModel | Primitive;

const quickShapes = ['box', 'sphere', 'cylinder'] as const;
const extraShapes = ['cone', 'pyramid', 'triangularPrism', 'capsule', 'torus', 'plate'] as const;
const modelPanels = [
  { id: 'translate', label: '移动', Icon: Move3D },
  { id: 'rotate', label: '旋转', Icon: RotateCcw },
  { id: 'size', label: '尺寸', Icon: Scaling },
  { id: 'appearance', label: '外观', Icon: Palette },
] as const;
const sizeAxes = [
  { key: 'widthScale', label: '宽度倍率' },
  { key: 'heightScale', label: '高度倍率' },
  { key: 'depthScale', label: '深度倍率' },
] as const;
const scaleRange = [.25, 2.5, .05] as const;
const defaultFigureColor = '#ffffff';
const defaultRoughness = .65;
const defaultMetalness = 0;
const maxPeople = 8;
const maxPrimitives = 12;
const positionLimits = { x: [-5, 5], y: [-1, 3], z: [-5, 5] } as const;
const positionStep = .05;
const isPerson = (model: PoseModel): model is PersonModel => 'pose' in model;

function disposePrimitive(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>) {
  mesh.removeFromParent();
  mesh.geometry.dispose();
  mesh.material.dispose();
}
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
export default function PoseStudio({projectId,size,onUse,onClose,initialModels,onModelsChange}:{projectId:string;size:string;initialModels?:PoseModel[];onModelsChange:(models:PoseModel[])=>void;onUse:(m:Media)=>void;onClose:()=>void}) {
  const [models, setModels] = useState<PoseModel[]>(() => initialModels ?? [person(1)]);
  const [selected, setSelected] = useState<string | undefined>(() => (models.find(isPerson) ?? models[0])?.id);
  const [joint,setJoint]=useState<Joint>('左肩'),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [panel, setPanel] = useState<'joint' | 'position'>('joint');
  const [modelPanel, setModelPanel] = useState<typeof modelPanels[number]['id']>('translate');
  const transformMode = modelPanel === 'translate' || modelPanel === 'rotate' ? modelPanel : undefined;
  const markers = useRef(new Map<Joint, HTMLButtonElement>());
  const markerPerson = useRef('');
  const drag = useRef<{ pointerId: number; personId: string; joint: Joint; x: number; y: number; angles: Angles }>();
  const [host,setHost]=useState<HTMLDivElement|null>(null);
  const runtime = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    transform: TransformControls;
    figures: Map<string, ReturnType<typeof createPoseFigure>>;
    primitives: Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>;
    grain: THREE.Texture;
    grid: THREE.GridHelper;
  }>();
  const people = models.filter(isPerson);
  const primitives = models.filter((model): model is Primitive => !isPerson(model));
  const shapeAddDisabled = saving || !!error || primitives.length >= maxPrimitives;
  const counter = useRef(Math.max(1, ...people.map(p => Number(p.name.split(' ')[1]) || 1)));
  const saveLock = useRef(false);
  const current = models.find(model => model.id === selected);
  const currentPerson = current && isPerson(current) ? current : undefined;
  const currentPrimitive = current && !isPerson(current) ? current : undefined;
  const currentColor = current?.color ?? (currentPrimitive ? shapes[currentPrimitive.shape].color : defaultFigureColor);
  const editJoints = panel === 'joint' && !!currentPerson;
  const dimensions=size.split('x').map(Number),width=dimensions[0]||1152,height=dimensions[1]||640;
  const aspect=width/height;
  useEffect(() => { markerPerson.current = selected ?? ''; }, [selected]);
  useEffect(()=>{
    if(!host)return;
    const container=host;let renderer:THREE.WebGLRenderer;
    try { renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); } catch {setError('无法启动 3D 画布，请启用硬件加速或换用支持 WebGL 的设备。');return;}
    const scene=new THREE.Scene();scene.background=new THREE.Color('#e9e7e2');
    renderer.toneMapping = THREE.NeutralToneMapping;
    const camera=new THREE.PerspectiveCamera(38,aspect,.01,100);camera.position.set(1.28,1.52,3.95);
    const canvas = renderer.domElement;
    // Connect the gizmo first so it can claim the pointer before orbiting starts.
    const transform = new TransformControls(camera, canvas);
    transform.setSize(.8);
    transform.setTranslationSnap(positionStep);
    transform.setRotationSnap(THREE.MathUtils.degToRad(1));
    // Three's runtime uses minX, which is misspelled in the bundled typings.
    Object.assign(transform, {
      minX: positionLimits.x[0], maxX: positionLimits.x[1],
      minY: positionLimits.y[0], maxY: positionLimits.y[1],
      minZ: positionLimits.z[0], maxZ: positionLimits.z[1],
    });
    scene.add(transform.getHelper());
    const controls=new OrbitControls(camera,canvas);controls.target.set(0,.97,0);controls.minDistance=1;controls.maxDistance=20;controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff,0xbab3a8,1.1));
    const key = new THREE.DirectionalLight(0xfff4e7, 2.25);
    key.position.set(-3, 5, 4);
    const rim = new THREE.DirectionalLight(0xffffff, 1.0);
    rim.position.set(3, 3, -4);
    scene.add(key, rim);
    const grid=new THREE.GridHelper(12,24,0x9da7b5,0xcdd3dc);grid.position.y=-.03;scene.add(grid);
    const grain = createWoodGrain();
    const figures = new Map<string, ReturnType<typeof createPoseFigure>>();
    const primitives = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let click: { id: number; x: number; y: number } | undefined;
    const startClick = (event: PointerEvent) => {
      if (event.isPrimary) container.focus({ preventScroll: true });
      click = event.isPrimary && event.button === 0 && !transform.dragging && !saveLock.current
        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
        : undefined;
    };
    const trackClick = (event: PointerEvent) => {
      if (click?.id === event.pointerId && Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4) click = undefined;
    };
    const pickModel = (event: PointerEvent) => {
      trackClick(event);
      if (click?.id !== event.pointerId || saveLock.current) return;
      click = undefined;
      const rect = canvas.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
      raycaster.setFromCamera(pointer, camera);
      const roots = [...Array.from(figures.values(), figure => figure.root), ...primitives.values()];
      let hit = raycaster.intersectObjects(roots, true)[0]?.object;
      if (!hit) return;
      while (hit.parent && hit.parent !== scene) hit = hit.parent;
      setSelected(hit.userData.poseId);
      setPanel('position');
    };
    const cancelPointer = () => {
      click = undefined;
      if (transform.dragging) transform.pointerUp(null);
    };
    canvas.addEventListener('pointerdown', startClick);
    canvas.addEventListener('pointermove', trackClick);
    canvas.addEventListener('pointerup', pickModel);
    canvas.addEventListener('lostpointercapture', cancelPointer);
    transform.addEventListener('dragging-changed', () => { controls.enabled = !transform.dragging; });
    transform.addEventListener('objectChange', () => {
      const object = transform.object;
      if (!object) return;
      const { x, y, z } = object.position;
      const { x: pitch, y: turn, z: roll } = object.rotation;
      const degrees = THREE.MathUtils.radToDeg;
      const change = transform.mode === 'translate' ? { x, y, z } : { pitch: degrees(pitch), turn: degrees(turn), roll: degrees(roll) };
      setModels(all => all.map(model => model.id === object.userData.poseId ? { ...model, ...change } : model));
    });
    container.appendChild(canvas);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    runtime.current={renderer,scene,camera,controls,transform,figures,primitives,grain,grid};
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
    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      canvas.removeEventListener('pointerdown', startClick);
      canvas.removeEventListener('pointermove', trackClick);
      canvas.removeEventListener('pointerup', pickModel);
      canvas.removeEventListener('lostpointercapture', cancelPointer);
      transform.dispose();
      controls.dispose();
      figures.forEach(disposePoseFigure);
      primitives.forEach(disposePrimitive);
      grain.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      canvas.remove();
      runtime.current = undefined;
    };
  },[aspect,host]);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt) return;
    const activeIds = new Set(models.map(model => model.id));
    for (const [id, figure] of rt.figures) {
      if (activeIds.has(id)) continue;
      disposePoseFigure(figure);
      rt.figures.delete(id);
    }
    for (const [id, mesh] of rt.primitives) {
      if (activeIds.has(id)) continue;
      disposePrimitive(mesh);
      rt.primitives.delete(id);
    }
    for (const model of models) {
      let object: THREE.Object3D;
      const size = model.size ?? 1;
      if (isPerson(model)) {
        let figure = rt.figures.get(model.id);
        if (!figure) {
          figure = createPoseFigure(rt.grain);
          rt.figures.set(model.id, figure);
        }
        applyPoseFigure(figure, model.pose, model.color ?? defaultFigureColor);
        figure.root.scale.setScalar(size);
        object = figure.root;
      } else {
        let mesh = rt.primitives.get(model.id);
        if (!mesh) {
          mesh = new THREE.Mesh(shapes[model.shape].geometry(), new THREE.MeshStandardMaterial());
          rt.primitives.set(model.id, mesh);
        }
        mesh.material.color.set(model.color ?? shapes[model.shape].color);
        mesh.material.roughness = model.roughness ?? defaultRoughness;
        mesh.material.metalness = model.metalness ?? defaultMetalness;
        mesh.scale.set(size * (model.widthScale ?? 1), size * (model.heightScale ?? 1), size * (model.depthScale ?? 1));
        object = mesh;
      }
      if (!object.parent) {
        object.userData.poseId = model.id;
        rt.scene.add(object);
      }
      object.position.set(model.x, model.y, model.z);
      const radians = THREE.MathUtils.degToRad;
      object.rotation.set(radians(model.pitch ?? 0), radians(model.turn), radians(model.roll ?? 0), 'YXZ');
    }
  }, [models, aspect, host]);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt) return;
    if (rt.transform.dragging) rt.transform.pointerUp(null);
    const object = selected ? rt.figures.get(selected)?.root ?? rt.primitives.get(selected) : undefined;
    if (editJoints || !object || !transformMode) rt.transform.detach();
    else {
      rt.transform.setMode(transformMode);
      rt.transform.attach(object);
    }
  }, [selected, editJoints, transformMode, aspect, host]);
  useEffect(() => {
    if (runtime.current) runtime.current.transform.enabled = !saving;
  }, [saving, aspect, host]);
  useEffect(()=>onModelsChange(models),[models,onModelsChange]);
  function patch(change: Partial<PoseTransform & ModelColor>) {
    setModels(all => all.map(model => model.id === selected ? { ...model, ...change } : model));
  }
  function patchPrimitive(change: Partial<PrimitiveProperties>) {
    setModels(all => all.map(model => model.id === selected && !isPerson(model) ? { ...model, ...change } : model));
  }
  function updateJoint(id: string, name: Joint, angles: Angles) {
    setModels(all => all.map(model => model.id === id && isPerson(model) ? { ...model, pose: { ...model.pose, [name]: angles } } : model));
  }
  function startJointDrag(event: ReactPointerEvent<HTMLButtonElement>, name: Joint) {
    if (event.button !== 0 || !event.isPrimary || !currentPerson) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setJoint(name);
    drag.current = { pointerId: event.pointerId, personId: currentPerson.id, joint: name, x: event.clientX, y: event.clientY, angles: currentPerson.pose[name] };
  }
  function moveJoint(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const angle = (value: number) => THREE.MathUtils.clamp(Math.round(value), -180, 180);
    updateJoint(start.personId, start.joint, [angle(start.angles[0] + dy), start.angles[1], angle(start.angles[2] + dx)]);
  }
  function endJointDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = undefined;
  }
  function setView([x, y, z]: readonly [number, number, number]) {
    const rt = runtime.current;
    if (!rt) return;
    if (current) rt.controls.target.set(current.x, current.y + (currentPerson ? .97 * (current.size ?? 1) : 0), current.z);
    else rt.controls.target.set(0, .97, 0);
    rt.camera.position.set(x, y, z).add(rt.controls.target);
    rt.controls.update();
  }
  function addPerson() {
    const next = person(++counter.current);
    next.x = (people.length % 4) * .7;
    next.z = Math.floor(people.length / 4) * .8;
    setModels(all => [...all, next]);
    setSelected(next.id);
  }
  function addPrimitive(shape: Shape) {
    const { name, height } = shapes[shape];
    let number = 1;
    while (primitives.some(model => model.name === `${name} ${number}`)) number++;
    const slots = [0, -.8, .8, -1.6, 1.6].flatMap(z => [-.85, .85, 0, -1.7, 1.7].map(x => ({ x, z })));
    const { x, z } = slots.find(slot => models.every(model => Math.hypot(slot.x - model.x, slot.z - model.z) >= .7)) ?? slots[0];
    const next: Primitive = { id: localId(), name: `${name} ${number}`, shape, x, y: height, z, turn: 0 };
    setModels(all => [...all, next]);
    setSelected(next.id);
    setModelPanel('translate');
    setPanel('position');
  }
  function removeCurrent() {
    if (!current || saveLock.current || error || runtime.current?.transform.dragging || drag.current) return;
    setModels(all => all.filter(model => model.id !== current.id));
    setSelected(undefined);
    host?.focus({ preventScroll: true });
  }
  function handleDeleteKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input:not([type="range"]), textarea, select'))) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) removeCurrent();
  }
  function resetCurrent() {
    if (!current) return;
    const defaults = { x: 0, y: 0, z: 0, turn: 0 };
    setModels(all => all.map(model => {
      if (model.id !== current.id) return model;
      const { id, name } = model;
      if (isPerson(model)) return { id, name, ...defaults, pose: neutral() };
      const { shape } = model;
      return { id, name, shape, ...defaults, y: shapes[shape].height };
    }));
  }
  function preset(name: typeof presets[number]['name']) {
    if (!currentPerson) return;
    const pose=neutral();let y=0;
    if(name==='举手'){pose['左肩']=[0,0,-155];pose['右肩']=[0,0,155];pose['左肘']=[-20,0,0];pose['右肘']=[-20,0,0];}
    if(name==='坐姿'){
      pose['左髋']=[-90,0,0];pose['右髋']=[-90,0,0];pose['左膝']=[90,0,0];pose['右膝']=[90,0,0];
      y = Math.max(positionLimits.y[0], -seatedDrop * (currentPerson.size ?? 1));
    }
    if(name==='迈步'){pose['左髋']=[-35,0,0];pose['右髋']=[30,0,0];pose['右膝']=[35,0,0];pose['左肩']=[30,0,0];pose['右肩']=[-30,0,0];}
    setModels(all => all.map(model => model.id === currentPerson.id ? { ...model, pose, y } : model));
  }
  async function capture() {
    const rt=runtime.current;if(!rt||saveLock.current)return;saveLock.current=true;setSaving(true);
    try {
      const oldSize=rt.renderer.getSize(new THREE.Vector2()),pixelRatio=rt.renderer.getPixelRatio();let dataUrl:string;
      const gizmo = rt.transform.getHelper();
      const gizmoVisible = gizmo.visible;
      try {rt.grid.visible=false;gizmo.visible=false;rt.renderer.setPixelRatio(1);rt.renderer.setSize(width,height,false);rt.renderer.render(rt.scene,rt.camera);dataUrl=rt.renderer.domElement.toDataURL('image/png');}
      finally {rt.grid.visible=true;gizmo.visible=gizmoVisible;rt.renderer.setPixelRatio(pixelRatio);rt.renderer.setSize(oldSize.x,oldSize.y,false);rt.renderer.render(rt.scene,rt.camera);}
      const media=await post<Media>('/media/pose-reference',{project_id:projectId,data_url:dataUrl});
      onUse(media);Message.success('姿势截图已入库，并加入参考图片');
    } catch(e){Message.error(`保存姿势截图失败：${String(e)}`);}finally{saveLock.current=false;setSaving(false);}
  }
  function range(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, unit = '') {
    return <label key={label} className="pose-range">
      <span>{label}</span>
      <output>{Number(value.toFixed(2))}{unit}</output>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}/>
    </label>;
  }

  return <Modal
    visible
    title={<div className="pose-title"><span className="pose-title-icon"><ScanLine size={19}/></span><span><strong>3D 参考</strong><small>摆设人物和基础体积，为图生图构图</small></span></div>}
    className="pose-modal"
    style={{ width: 'min(1280px, 96vw)' }}
    onCancel={onClose}
    maskClosable={false}
    closable={!saving}
    escToExit={!saving}
    footer={<div className="pose-footer">
      <span className="helper">截图 {width} × {height} · 导出场景模型与背景</span>
      <Button disabled={saving} onClick={onClose}>关闭</Button>
      <Button type="primary" loading={saving} disabled={!!error || !host} icon={<Camera size={16}/>} onClick={capture}>截图并用作参考图</Button>
    </div>}
  >
    <div className="pose-layout" onKeyDown={handleDeleteKey}>
      <section className="pose-workspace" aria-label="姿势画布">
        <div className="pose-preset-bar">
          <strong>动作预设</strong>
          <div className="pose-presets" role="group" aria-label="动作预设">
            {presets.map(({name, Icon}) => <Button key={name} size="small" disabled={saving || !!error || !currentPerson} icon={<Icon size={16}/>} onClick={() => { preset(name); setPanel('joint'); }}>{name}</Button>)}
          </div>
        </div>
        <div className="pose-stage">
          <div className="pose-frame" style={{ '--pose-aspect': aspect } as CSSProperties}>
            <div ref={setHost} className="pose-viewport" tabIndex={0} role="group" aria-label="3D 场景画布"/>
            {!error && editJoints && <div className="pose-markers" role="group" aria-label="画布关节">
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
          <span className="pose-view-hint">点击模型选中 · Delete / Backspace 删除 · 拖动空白处旋转视角 · 右键平移 · 滚轮缩放</span>
        </div>
      </section>
      <fieldset className="pose-settings" disabled={saving || !!error} aria-label="场景模型与编辑">
        <section className="pose-cast">
          <div className="pose-section-heading">
            <strong>场景人物 <small>{people.length}/{maxPeople}</small></strong>
            <Button size="small" icon={<Plus size={16}/>} title="添加人物" aria-label="添加人物" disabled={people.length >= maxPeople} onClick={addPerson}/>
          </div>
          <div className="pose-model-list" role="group" aria-label="当前人物">
            {people.map(p => <button key={p.id} type="button" aria-pressed={p.id === selected} onClick={() => setSelected(p.id)}>{p.name}</button>)}
          </div>
        </section>
        <section className="pose-cast pose-shapes">
          <div className="pose-section-heading">
            <strong>基础体积 <small>{primitives.length}/{maxPrimitives}</small></strong>
            <Dropdown trigger="click" position="br" disabled={shapeAddDisabled} droplist={
              <Menu onClickMenuItem={key => addPrimitive(key as typeof extraShapes[number])}>
                {extraShapes.map(shape => {
                  const { name, Icon } = shapes[shape];
                  return <Menu.Item key={shape}><span className="pose-shape-option"><Icon size={15}/>{name}</span></Menu.Item>;
                })}
              </Menu>
            }>
              <Button size="small" icon={<Shapes size={14}/>} disabled={shapeAddDisabled} aria-haspopup="menu">更多形状</Button>
            </Dropdown>
          </div>
          <div className="pose-shape-actions" role="group" aria-label="添加基础体积">
            {quickShapes.map(shape => {
              const { name, Icon } = shapes[shape];
              return <Button key={shape} size="small" icon={<Icon size={14}/>} aria-label={`添加${name}`} disabled={shapeAddDisabled} onClick={() => addPrimitive(shape)}>{name}</Button>;
            })}
          </div>
          {primitives.length > 0 && <div className="pose-model-list" role="group" aria-label="当前体积">
            {primitives.map(model => <button key={model.id} type="button" aria-pressed={model.id === selected} onClick={() => { setSelected(model.id); setPanel('position'); }}>{model.name}</button>)}
          </div>}
        </section>
        <div className="pose-section-heading pose-selection">
          <strong>{current?.name ?? '未选中模型'}</strong>
          <div className="pose-model-actions">
            <Button size="small" icon={<RotateCcw size={14}/>} disabled={!current} title="恢复选中模型的默认状态" onClick={resetCurrent}>复位</Button>
            <Button size="small" icon={<Trash2 size={15}/>} disabled={!current} aria-label="删除选中模型" aria-keyshortcuts="Delete Backspace" onClick={removeCurrent}>删除</Button>
          </div>
        </div>
        {currentPerson && <div className="pose-panel-switch" role="group" aria-label="编辑内容">
          <button type="button" aria-pressed={editJoints} onClick={() => setPanel('joint')}><Accessibility size={15}/>关节</button>
          <button type="button" aria-pressed={!editJoints} onClick={() => setPanel('position')}><Move3D size={15}/>模型设置</button>
        </div>}
        {editJoints && currentPerson ? <div className="pose-inspector">
          <p className="pose-inspector-hint">直接拖动圆点调整关节，也可在这里选中后微调。</p>
          <div className="pose-joint-list" role="group" aria-label="编辑关节">
            {jointRows.map(row => <div key={row[0]}>{row.map(name => <button key={name} type="button" aria-pressed={joint === name} onClick={() => setJoint(name)}>{name}</button>)}</div>)}
          </div>
          <div className="pose-section-heading pose-adjust-heading">
            <strong>{joint}角度</strong>
            <Button size="mini" type="text" icon={<RotateCcw size={13}/>} onClick={() => updateJoint(currentPerson.id, joint, neutral()[joint])}>重置关节</Button>
          </div>
          {axes.map((label, i) => range(label, currentPerson.pose[joint][i], -180, 180, 1, value => {
            const angles: Angles = [...currentPerson.pose[joint]];
            angles[i] = value;
            updateJoint(currentPerson.id, joint, angles);
          }, '°'))}
        </div> : current && <div className="pose-inspector">
          <div className="pose-model-tabs" role="group" aria-label="模型操作">
            {modelPanels.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={modelPanel === id} onClick={() => setModelPanel(id)}><Icon size={14}/>{label}</button>)}
          </div>
          {modelPanel === 'translate' && <>
            <p className="pose-inspector-hint">拖动箭头移动模型，或用滑杆微调。</p>
            {range('左右位置', current.x, ...positionLimits.x, positionStep, x => patch({x}))}
            {range('前后位置', current.z, ...positionLimits.z, positionStep, z => patch({z}))}
            {range('高度', current.y, ...positionLimits.y, positionStep, y => patch({y}))}
          </>}
          {modelPanel === 'rotate' && <>
            <p className="pose-inspector-hint">拖动圆环旋转模型，或用滑杆微调。</p>
            {range(currentPerson ? '人物朝向' : '左右转向', current.turn, -180, 180, 1, turn => patch({turn}), '°')}
            {range('前后倾斜', current.pitch ?? 0, -180, 180, 1, pitch => patch({pitch}), '°')}
            {range('左右倾斜', current.roll ?? 0, -180, 180, 1, roll => patch({roll}), '°')}
          </>}
          {modelPanel === 'size' && <>
            <div className="pose-section-heading">
              <strong>缩放比例</strong>
              <Button size="mini" type="text" icon={<RotateCcw size={13}/>} onClick={() => {
                patch({ size: undefined });
                if (currentPrimitive) patchPrimitive({ widthScale: undefined, heightScale: undefined, depthScale: undefined });
              }}>重置尺寸</Button>
            </div>
            {range('整体大小', current.size ?? 1, ...scaleRange, size => patch({ size }), '×')}
            {currentPrimitive && sizeAxes.map(({ key, label }) => range(label, currentPrimitive[key] ?? 1, ...scaleRange, value => patchPrimitive({ [key]: value }), '×'))}
          </>}
          {modelPanel === 'appearance' && <>
            <div className="pose-section-heading">
              <strong>{currentPerson ? '人物外观' : '材质'}</strong>
              <Button size="mini" type="text" icon={<RotateCcw size={13}/>} onClick={() => {
                patch({ color: undefined });
                if (currentPrimitive) patchPrimitive({ roughness: undefined, metalness: undefined });
              }}>重置外观</Button>
            </div>
            <label className="pose-color">
              <span>{currentPerson ? '木纹色调' : '模型颜色'}</span>
              <output>{currentColor.toUpperCase()}</output>
              <input aria-label={currentPerson ? '木纹色调' : '模型颜色'} type="color" value={currentColor} onChange={event => patch({ color: event.target.value })}/>
            </label>
            {currentPrimitive && <>
              {range('粗糙度', currentPrimitive.roughness ?? defaultRoughness, 0, 1, .05, roughness => patchPrimitive({ roughness }))}
              {range('金属度', currentPrimitive.metalness ?? defaultMetalness, 0, 1, .05, metalness => patchPrimitive({ metalness }))}
            </>}
          </>}
        </div>}
      </fieldset>
    </div>
  </Modal>;
}
