import * as THREE from 'three';

type Angles = [number, number, number];
export const joints = ['腰部', '头部', '左肩', '左肘', '右肩', '右肘', '左髋', '左膝', '右髋', '右膝'] as const;
type Joint = typeof joints[number];

export type PoseTransform = {
  x: number;
  y: number;
  z: number;
  turn: number;
  pitch?: number;
  roll?: number;
  size?: number;
};

export type Person = PoseTransform & {
  id: string;
  name: string;
  pose: Record<Joint, Angles>;
};

// The grain runs along the turned pieces. This texture is shared by all wooden
// figures in the editor and generated locally from periodic waves.
export function createWoodGrain() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const v = y / canvas.height * Math.PI * 2;
    for (let x = 0; x < canvas.width; x++) {
      const u = x / canvas.width * Math.PI * 2;
      const warp = .24 * Math.sin(3 * u + .5 * Math.sin(v)) + .12 * Math.sin(5 * u - v);
      const fiber = Math.sin(53 * (u + warp)) + .6 * Math.sin(91 * (u + warp));
      const bands = Math.sin(11 * (u + warp)) + .6 * Math.sin(19 * (u + warp));
      const pores = Math.max(0, Math.sin(127 * (u + warp) + 3 * Math.sin(3 * v))) ** 5;
      const shade = 1.4 * fiber + 3.2 * bands - 3 * pores;
      const pixel = (y * canvas.width + x) * 4;
      pixels.data.set([233 + shade, 197 + shade, 149 + shade, 255], pixel);
    }
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

type Position = [number, number, number];
type Profile = [radius: number, height: number][];

// Standing model in metres, scaled to an adult at about 7.6 head lengths.
const pelvisHeight = .912;
export const seatedDrop = .424;
const kneeHeight = pelvisHeight - seatedDrop;
const ankleHeight = .079;
const waistHeight = 1.076;
const shoulderHeight = 1.449;
const headPivotHeight = 1.552;
const upperArm = .308;
const forearm = .257;
const shin = kneeHeight - ankleHeight;
type Palette = { shell: THREE.MeshStandardMaterial; joint: THREE.MeshStandardMaterial; pin: THREE.MeshStandardMaterial; detail: THREE.MeshStandardMaterial };
const woodJointColor = 0xe6cfae;

export function createPoseFigure(grain: THREE.Texture) {
  const materials: Palette = {
    shell: new THREE.MeshStandardMaterial({ map: grain, bumpMap: grain, bumpScale: .003, roughness: .54 }),
    joint: new THREE.MeshStandardMaterial({ color: woodJointColor, map: grain, roughness: .60 }),
    pin: new THREE.MeshStandardMaterial({ color: 0xa1754b, metalness: .34, roughness: .38 }),
    detail: new THREE.MeshStandardMaterial({ color: 0x3b2a21, roughness: .65 }),
  };
  const root = new THREE.Group();
  const pivots = new Map<Joint, THREE.Group>();
  const sphere = new THREE.SphereGeometry(1, 32, 24);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 24);
  const box = new THREE.BoxGeometry(1, 1, 1);
  let grainOffset = 0;

  function mesh(parent: THREE.Group, geometry: THREE.BufferGeometry, position: Position, material = materials.shell) {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(...position);
    parent.add(part);
    return part;
  }

  function ball(parent: THREE.Group, position: Position, radius: number, material = materials.joint) {
    const part = mesh(parent, sphere, position, material);
    part.scale.setScalar(radius);
    return part;
  }

  function pivot(parent: THREE.Group, name: Joint, position: Position, radius: number) {
    const group = new THREE.Group();
    group.position.set(...position);
    parent.add(group);
    pivots.set(name, group);
    ball(group, [0, 0, 0], radius);
    return group;
  }

  function hinge(parent: THREE.Group, side: number, radius: number) {
    const washer = mesh(parent, cylinder, [side * radius * .90, 0, 0], materials.joint);
    washer.rotation.z = Math.PI / 2;
    washer.scale.set(radius * .64, radius * .22, radius * .64);
    const axle = mesh(parent, cylinder, [side * radius * 1.015, 0, 0], materials.pin);
    axle.rotation.z = Math.PI / 2;
    axle.scale.set(radius * .44, radius * .20, radius * .44);
    const slot = mesh(parent, box, [side * radius * 1.119, 0, 0], materials.detail);
    slot.rotation.x = side * .57;
    slot.scale.set(.001, radius * .54, radius * .09);
  }

  function turned(parent: THREE.Group, position: Position, outline: Profile, depth: number) {
    const profile = new THREE.CatmullRomCurve3(outline.map(([radius, y]) => new THREE.Vector3(radius, y, 0)));
    const points = profile.getPoints(outline.length * 5).map(point => new THREE.Vector2(Math.max(0, point.x), point.y));
    const geometry = new THREE.LatheGeometry(points, 48);
    geometry.scale(1, 1, depth);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) + grainOffset);
    grainOffset = (grainOffset + .382) % 1;
    return mesh(parent, geometry, position);
  }

  const waist = pivot(root, '腰部', [0, waistHeight, 0], .063);
  const head = pivot(waist, '头部', [0, headPivotHeight - waistHeight, 0], .040);

  // Rounded pelvis, lower ribcage and shoulder line remain separate turned pieces.
  turned(root, [0, 0, -.013], [
    [0, .883], [.091, .886], [.138, .906], [.158, .960], [.150, 1.025], [.116, 1.073], [0, 1.073],
  ], .70);
  turned(waist, [0, 0, .001], [
    [0, -.020], [.072, -.014], [.091, .035], [.097, .092], [.101, .136], [0, .145],
  ], .77);
  turned(waist, [0, 0, -.006], [
    [0, .117], [.100, .120], [.125, .148], [.151, .224], [.173, .313],
    [.171, .363], [.134, .399], [.061, .422], [0, .424],
  ], .65);
  turned(waist, [0, 0, -.014], [
    [0, .396], [.054, .400], [.050, .428], [.042, .453], [.045, .475], [0, .485],
  ], .91);
  turned(head, [0, 0, .010], [
    [0, .014], [.040, .015], [.053, .040], [.063, .070], [.072, .107],
    [.076, .159], [.069, .202], [.046, .233], [0, .248],
  ], 1.15);

  for (const side of [-1, 1]) {
    const label = side === -1 ? '左' : '右';
    const shoulder = pivot(waist, `${label}肩`, [side * .177, shoulderHeight - waistHeight, 0], .051);
    const elbow = pivot(shoulder, `${label}肘`, [0, -upperArm, 0], .039);
    const hip = pivot(root, `${label}髋`, [side * .098, pelvisHeight, 0], .062);
    const knee = pivot(hip, `${label}膝`, [0, -seatedDrop, 0], .045);
    const wrist = new THREE.Group();
    const ankle = new THREE.Group();
    wrist.position.y = -forearm;
    ankle.position.y = -shin;
    elbow.add(wrist);
    knee.add(ankle);
    ball(wrist, [0, 0, 0], .025);
    ball(ankle, [0, 0, 0], .030);

    turned(shoulder, [0, 0, .002], [
      [0, -upperArm + .027], [.030, -upperArm + .028], [.035, -.251], [.045, -.164],
      [.052, -.092], [.049, -.054], [.036, -.032], [0, -.030],
    ], .94);
    turned(elbow, [0, 0, .001], [
      [0, -forearm + .017], [.022, -forearm + .018], [.026, -.201], [.037, -.125],
      [.044, -.071], [.036, -.037], [0, -.029],
    ], .82);
    turned(hip, [0, 0, .002], [
      [0, -seatedDrop + .034], [.039, -seatedDrop + .035], [.045, -.349],
      [.065, -.251], [.079, -.151], [.077, -.093], [.053, -.043], [0, -.040],
    ], 1.08);
    // The shin has a high calf and a long taper towards the ankle.
    turned(knee, [0, 0, -.011], [
      [0, -shin + .023], [.026, -shin + .024], [.030, -.337], [.039, -.260],
      [.052, -.160], [.055, -.111], [.048, -.065], [.035, -.032], [0, -.028],
    ], 1.13);

    hinge(shoulder, side, .051);
    hinge(elbow, side, .039);
    hinge(knee, side, .045);
    hinge(wrist, side, .025);
    hinge(ankle, side, .030);

    const palm = turned(wrist, [0, 0, 0], [
      [0, -.178], [.018, -.170], [.028, -.144], [.034, -.111], [.034, -.079],
      [.027, -.040], [.019, -.018], [0, -.017],
    ], .44);
    palm.rotation.z = side * .04;
    const thumb = turned(wrist, [-side * .016, -.049, .005], [
      [0, -.075], [.009, -.073], [.013, -.054], [.013, -.027], [.010, -.007], [0, 0],
    ], .77);
    thumb.rotation.z = -side * .36;

    const foot = turned(ankle, [0, -.053, -.061], [
      [0, 0], [.031, .010], [.037, .040], [.039, .095], [.047, .156],
      [.049, .197], [.039, .228], [.022, .248], [0, .255],
    ], .69);
    // Flatten the sole and pitch the heel up slightly within the ankle socket.
    const vertices = foot.geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      const heel = Math.max(0, 1 - vertices.getY(i) / .105);
      vertices.setZ(i, Math.min(.026, vertices.getZ(i) - .013 * heel));
    }
    foot.geometry.computeVertexNormals();
    foot.rotation.set(Math.PI / 2, side * .065, 0, 'YXZ');
  }

  return { root, pivots, materials };
}

type Figure = ReturnType<typeof createPoseFigure>;

export function applyPoseFigure(figure: Figure, pose: Person['pose'], tint: string) {
  figure.materials.shell.color.set(tint);
  figure.materials.joint.color.setHex(woodJointColor).multiply(figure.materials.shell.color);
  figure.pivots.forEach((pivot, joint) => {
    const [x, y, z] = pose[joint];
    pivot.rotation.set(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z));
  });
}

export function disposePoseFigure(figure: Figure) {
  figure.root.removeFromParent();
  const geometries = new Set<THREE.BufferGeometry>();
  figure.root.traverse(part => {
    if (part instanceof THREE.Mesh) geometries.add(part.geometry);
  });
  geometries.forEach(geometry => geometry.dispose());
  Object.values(figure.materials).forEach(material => material.dispose());
}
