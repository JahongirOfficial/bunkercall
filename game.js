import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as SU from 'three/addons/utils/SkeletonUtils.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
let quality = Q.get('q') === 'low' ? 0 : 1;

/* ================= renderer / scene ================= */
const cv = $('c');
const renderer = new THREE.WebGLRenderer({canvas: cv, antialias: true, powerPreference: 'high-performance'});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030304);
scene.fog = new THREE.FogExp2(0x040506, 0.05);
const camera = new THREE.PerspectiveCamera(72, 1, 0.04, 80);
camera.rotation.order = 'YXZ';
let prScale = 1;
function resize() {
  renderer.setPixelRatio((quality ? Math.min(devicePixelRatio, 1.25) : 1) * prScale);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
const ENV = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const AMB = new THREE.AmbientLight(0x202838, 1.7), HEMI = new THREE.HemisphereLight(0x303a50, 0x181210, 0.6); scene.add(AMB, HEMI);

/* ================= textures / materials ================= */
const TL = new THREE.TextureLoader();
const tcache = {};
function tex(name, kind, srgb, rep) {
  const k = name + kind + (rep || '');
  if (tcache[k]) return tcache[k];
  const t = TL.load(`tex/${name}/${kind}.webp`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.repeat.set(rep[0], rep[1]);
  return tcache[k] = t;
}
const mcache = {};
function PBR(name, o = {}) {
  const k = name + JSON.stringify(o);
  if (mcache[k]) return mcache[k];
  const rep = o.rep;
  const m = new THREE.MeshStandardMaterial({
    map: tex(name, 'diff', true, rep), normalMap: tex(name, 'nor', false, rep), roughnessMap: tex(name, 'rough', false, rep),
    color: o.tint ?? 0xffffff, metalness: o.metal ?? 0, roughness: o.rough ?? 1, envMap: ENV, envMapIntensity: o.env ?? 0.2,
    side: o.side ?? THREE.FrontSide
  });
  m.normalScale.set(o.n ?? 1, o.n ?? 1);
  return mcache[k] = m;
}
const plain = (c, r = .8, m = 0, e = .2) => new THREE.MeshStandardMaterial({color: c, roughness: r, metalness: m, envMap: ENV, envMapIntensity: e});
const TILE = 2.2;
const MAT = {
  ops: PBR('peeling_painted_wall', {tint: 0xb4bcae}), cor: PBR('preconcrete_wall_001', {tint: 0xa8a8a8}),
  gen: PBR('concrete_wall_006', {tint: 0x9a9a98}), sto: PBR('rough_concrete', {tint: 0xb4b0a6}),
  med: PBR('long_white_tiles', {tint: 0x9aa09c, rough: .8}), dorm: PBR('concrete_wall_006', {tint: 0xd4c4a8}),
  stair: PBR('concrete_wall_006', {tint: 0x707880}),
  fOps: PBR('old_linoleum_flooring_01', {tint: 0x9a9488}), fCor: PBR('worn_concrete_floor', {tint: 0x8c8c8c, env: .35}),
  fGen: PBR('hangar_concrete_floor', {tint: 0x8a8a88, env: .3}), fSto: PBR('concrete_floor_worn_001', {tint: 0x8a8782}),
  fMed: PBR('dirty_tiles', {tint: 0x8a9088, env: .4}), fDorm: PBR('old_linoleum_flooring_01', {tint: 0x807468}),
  fStair: PBR('metal_plate', {tint: 0x808890, metal: .5, env: .5}),
  ceil: PBR('rough_concrete', {tint: 0x6e6e6e}), rust: PBR('rusty_metal_02', {tint: 0xb0a090, metal: .55, env: .4}),
  pipe: PBR('rusty_metal_02', {tint: 0x9a8a7a, metal: .6, env: .4}),
  dark: plain(0x101113, .5, .6)
};

/* ================= geometry helpers ================= */
let world = new THREE.Group(); scene.add(world); const GROUPS = {}; let WHEEL = null;
function beginRoom(id) { world = new THREE.Group(); world.name = id; scene.add(world); GROUPS[id] = world; }
const COL = []; const ROOMS = [];
function addCol(x0, z0, x1, z1) { const c = {x0, z0, x1, z1, off: false}; COL.push(c); return c; }
function uvBox(g, w, h, d, tile = TILE) {
  const uv = g.attributes.uv, f = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < 6; i++) for (let v = 0; v < 4; v++) { const j = i * 4 + v; uv.setXY(j, uv.getX(j) * f[i][0] / tile, uv.getY(j) * f[i][1] / tile); }
}
function box(w, h, d, mat, x, y, z, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d); uvBox(g, w, h, d);
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z);
  m.receiveShadow = true; m.castShadow = !!o.cast; (o.parent || world).add(m); return m;
}
function floorPlane(x0, z0, x1, z1, mat, y = 0) {
  const w = x1 - x0, d = z1 - z0, g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / TILE, uv.getY(i) * d / TILE);
  const m = new THREE.Mesh(g, mat); m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = true; world.add(m); return m;
}
function ceilPlane(x0, z0, x1, z1, y, mat = MAT.ceil) {
  const w = x1 - x0, d = z1 - z0, g = new THREE.PlaneGeometry(w, d); g.rotateX(Math.PI / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / TILE, uv.getY(i) * d / TILE);
  const m = new THREE.Mesh(g, mat); m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = true; world.add(m); return m;
}
// shallow barrel vault along X
function vault(x0, x1, w, yBase, sag, mat) {
  const R = ((w / 2) ** 2 + sag ** 2) / (2 * sag), yc = yBase + sag - R, N = 20, pos = [], nor = [], uv = [], idx = [];
  const base = Math.sqrt(R * R - (w / 2) ** 2);
  for (let i = 0; i <= N; i++) {
    const z = -w / 2 + w * i / N, s = Math.sqrt(R * R - z * z), y = yBase + (s - base), arc = Math.asin(z / R) * R;
    for (const x of [x0, x1]) { pos.push(x, y, z); nor.push(0, (yc - y) / R, -z / R); uv.push(x / TILE, (arc + 5) / TILE); }
  }
  for (let i = 0; i < N; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const m = new THREE.Mesh(g, mat.clone()); m.material.side = THREE.DoubleSide; m.receiveShadow = true; world.add(m);
  return {R, yc, base};
}
function rib(xc, w, yBase, sag, thick = .2, depth = .32, mat = MAT.ceil) {
  const R = ((w / 2) ** 2 + sag ** 2) / (2 * sag), base = Math.sqrt(R * R - (w / 2) ** 2), N = 18;
  const sh = new THREE.Shape(), top = [], bot = [];
  for (let i = 0; i <= N; i++) { const z = -w / 2 + w * i / N, y = yBase + (Math.sqrt(R * R - z * z) - base); top.push([z, y]); bot.push([z, y - thick]); }
  sh.moveTo(top[0][0], top[0][1]); top.forEach(p => sh.lineTo(p[0], p[1])); bot.reverse().forEach(p => sh.lineTo(p[0], p[1]));
  const g = new THREE.ExtrudeGeometry(sh, {depth, bevelEnabled: true, bevelSize: .02, bevelThickness: .02, bevelSegments: 2});
  g.rotateY(Math.PI / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * .5, uv.getY(i) * .5);
  const m = new THREE.Mesh(g, mat); m.position.x = xc - depth / 2; m.castShadow = m.receiveShadow = true; world.add(m);
}
function tube(pts, r, mat, seg = 40, closed = false) {
  const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), closed, 'catmullrom', .3);
  const g = new THREE.TubeGeometry(c, seg, r, 12, closed);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * c.getLength() / 2, uv.getY(i));
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; world.add(m); return {mesh: m, curve: c};
}
function pipe(pts, r, flanges = true) {
  const t = tube(pts, r, MAT.pipe, pts.length * 14);
  if (flanges) {
    const len = t.curve.getLength(), n = Math.max(2, Math.floor(len / 1.9));
    for (let i = 1; i < n; i++) {
      const u = i / n, p = t.curve.getPointAt(u), tg = t.curve.getTangentAt(u);
      const f = new THREE.Mesh(new THREE.TorusGeometry(r * 1.22, r * .28, 8, 20), MAT.dark);
      f.position.copy(p); f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tg); f.castShadow = true; world.add(f);
    }
  }
  return t;
}
function valve(x, y, z, ry = 0, r = .11) {
  const g = new THREE.Group(), red = plain(0x7a1a14, .5, .3);
  g.add(new THREE.Mesh(new THREE.TorusGeometry(r, r * .12, 8, 24), red));
  for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(r * .06, r * .06, r * 2, 6), red); s.rotation.z = i * Math.PI / 3; g.add(s); }
  const st = new THREE.Mesh(new THREE.CylinderGeometry(r * .12, r * .12, r * .9, 8), MAT.dark); st.rotation.x = Math.PI / 2; st.position.z = -r * .4; g.add(st);
  g.position.set(x, y, z); g.rotation.y = ry; world.add(g);
}
function cable(a, b, sag, r = .014, color = 0x0a0a0a) {
  const mid = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - sag, (a[2] + b[2]) / 2];
  const q1 = [a[0] + (b[0] - a[0]) * .25, mid[1] + sag * .35, a[2] + (b[2] - a[2]) * .25], q3 = [a[0] + (b[0] - a[0]) * .75, mid[1] + sag * .35, a[2] + (b[2] - a[2]) * .75];
  tube([a, q1, mid, q3, b], r, plain(color, .5, 0), 30);
}
function chain(x, yTop, z, n, ry = 0) {
  const m = plain(0x2a2a2c, .5, .8, .5), g = new THREE.Group();
  for (let i = 0; i < n; i++) { const l = new THREE.Mesh(new THREE.TorusGeometry(.028, .007, 6, 12), m); l.scale.y = 1.5; l.position.y = -i * .055; l.rotation.y = i % 2 ? Math.PI / 2 : 0; l.castShadow = true; g.add(l); }
  g.position.set(x, yTop, z); g.rotation.y = ry; world.add(g); return g;
}
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const rnd = (() => { let s = 1234567; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
// soft stain / puddle textures
const softAlpha = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
  gr.addColorStop(0, '#fff'); gr.addColorStop(.7, '#aaa'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${150 + rnd() * 105 | 0},${150 + rnd() * 105 | 0},${150 + rnd() * 105 | 0},.4)`; g.fillRect(rnd() * w, rnd() * h, 6, 6); }
}, false);
const streakAlpha = canvasTex(64, 256, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9; i++) { const x = rnd() * w, wd = 2 + rnd() * 7, len = h * (.35 + rnd() * .65);
    const gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, `rgba(255,255,255,${.5 + rnd() * .5})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x, 0, wd, len); }
}, false);
function puddle(x, z, rx, rz, y = .004) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshStandardMaterial({color: 0x07080a, roughness: .03, metalness: 0, envMap: ENV, envMapIntensity: 1.6, transparent: true, alphaMap: softAlpha, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2}));
  m.rotation.x = -Math.PI / 2; m.rotation.z = rnd() * 6; m.scale.set(rx, rz, 1); m.position.set(x, y, z); m.renderOrder = 2; world.add(m);
}
function stain(x, y, z, ry, w, h, color = 0x060504, op = .75) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({color, roughness: 1, transparent: true, opacity: op, alphaMap: streakAlpha, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2}));
  m.position.set(x, y, z); m.rotation.y = ry; m.renderOrder = 2; world.add(m);
}
function groundStain(x, z, r, color = 0x0a0807, op = .6) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshStandardMaterial({color, roughness: 1, transparent: true, opacity: op, alphaMap: softAlpha, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1}));
  m.rotation.x = -Math.PI / 2; m.rotation.z = rnd() * 6; m.scale.set(r, r * (.7 + rnd() * .5), 1); m.position.set(x, .003, z); m.renderOrder = 1; world.add(m);
}
function sign(text, x, y, z, ry, w = .8, sub = '') {
  const t = canvasTex(512, 160, (g, W, H) => {
    g.fillStyle = '#16181a'; g.fillRect(0, 0, W, H); g.strokeStyle = '#8a7a4a'; g.lineWidth = 6; g.strokeRect(8, 8, W - 16, H - 16);
    g.fillStyle = '#d8c98a'; g.font = 'bold 64px "Arial Black",Impact,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, sub ? H * .4 : H / 2);
    if (sub) { g.font = 'bold 26px Arial'; g.fillText(sub, W / 2, H * .78); }
    for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * .5})`; g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 5, 1 + rnd() * 2); }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 160 / 512), new THREE.MeshStandardMaterial({map: t, roughness: .6, metalness: .3, envMap: ENV, envMapIntensity: .3}));
  m.position.set(x, y, z); m.rotation.y = ry; world.add(m); return m;
}

/* ================= walls & doors ================= */
const DOORS = [];
function doorMatRep() { return PBR('rusty_metal_02', {tint: 0x8a8a80, metal: .6, env: .5, rep: [.7, 1]}); }
function makeDoor(o) { // o: axis ('x' wall along x at z=fixed | 'z' wall along z at x=fixed), c, fixed, w, h, dir, locked, msg, name
  const {axis, c, fixed, w, h} = o, root = new THREE.Group(), pivot = new THREE.Group(); root.add(pivot);
  const lw = w - .03, leaf = new THREE.Group(); leaf.position.x = lw / 2; pivot.add(leaf);
  const body = new THREE.Mesh(new RoundedBoxGeometry(lw, h - .03, .1, 3, .02), doorMatRep()); body.position.y = h / 2; body.castShadow = body.receiveShadow = true; leaf.add(body);
  const steel = plain(0x3a3c3e, .45, .8, .5);
  for (const yy of [.35, h - .35]) { const b = new THREE.Mesh(new RoundedBoxGeometry(lw * .96, .09, .125, 2, .02), steel); b.position.y = yy; b.castShadow = true; leaf.add(b); }
  const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(.016, 6, 5), steel, 24); const mm = new THREE.Matrix4();
  for (let i = 0; i < 12; i++) for (const s of [-1, 1]) { mm.makeTranslation(-lw / 2 + .08 + i * (lw - .16) / 11, .35 + .04 * 0, s * .066); mm.setPosition(-lw / 2 + .08 + i * (lw - .16) / 11 + 0, i % 2 ? .39 : .31, s * .066); rivets.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), mm); }
  rivets.position.y = 0; rivets.position.x = 0; leaf.add(rivets);
  // wheel handle (both sides) - round, not boxy
  const wheel = new THREE.Group(), wm = plain(0x5a4a3a, .45, .7, .5);
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(.115, .016, 8, 28), wm));
  for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, .23, 6), wm); s.rotation.z = i * Math.PI / 4; wheel.add(s); }
  wheel.add(new THREE.Mesh(new THREE.SphereGeometry(.03, 10, 8), wm));
  for (const s of [-1, 1]) { const wcl = wheel.clone(); wcl.position.set(lw * .38, h * .5, s * .1); leaf.add(wcl); }
  for (const yy of [.25, h * .5, h - .25]) { const hg = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, .14, 10), steel); hg.position.set(-lw / 2 - .005, yy, 0); leaf.add(hg); }
  if (axis === 'x') { root.position.set(c - w / 2 + .015, 0, fixed); } else { root.position.set(fixed, 0, c - w / 2 + .015); root.rotation.y = -Math.PI / 2; }
  world.add(root);
  const col = axis === 'x' ? addCol(c - w / 2, fixed - .07, c + w / 2, fixed + .07) : addCol(fixed - .07, c - w / 2, fixed + .07, c + w / 2);
  const d = {pivot, col, locked: !!o.locked, msg: o.msg || 'Locked', open: 0, target: o.open ? 1 : 0, dir: o.dir || 1, x: axis === 'x' ? c : fixed, z: axis === 'x' ? fixed : c, shake: 0, name: o.name || 'door', room: ({'ops-east': 'ops', gen: 'gen', med: 'med', storage: 'sto', dorm: 'dorm', stair: 'stair'})[o.name]};
  if (o.open) col.off = true;
  DOORS.push(d); return d;
}
function frame(axis, c, fixed, w, h, t) {
  const m = MAT.rust, bw = .09;
  if (axis === 'x') { box(bw, h, t + .06, m, c - w / 2 - bw / 2, h / 2, fixed); box(bw, h, t + .06, m, c + w / 2 + bw / 2, h / 2, fixed); box(w + bw * 2, bw, t + .06, m, c, h + bw / 2, fixed); }
  else { box(t + .06, h, bw, m, fixed, h / 2, c - w / 2 - bw / 2); box(t + .06, h, bw, m, fixed, h / 2, c + w / 2 + bw / 2); box(t + .06, bw, w + bw * 2, m, fixed, h + bw / 2, c); }
}
// wall along X at fixed z: from x0 to x1. mats {n: material for -z face, s: material for +z face, e: top/edge}
function wallX(x0, x1, z, o) {
  const t = o.t || .3, H = o.H, mats = [o.e || o.n, o.e || o.n, o.e || o.n, o.e || o.n, o.s, o.n];
  let cur = x0;
  const seg = (a, b) => { if (b - a < .02) return; const g = new THREE.BoxGeometry(b - a, H, t); uvBox(g, b - a, H, t); const m = new THREE.Mesh(g, mats); m.position.set((a + b) / 2, H / 2, z); m.receiveShadow = true; world.add(m); addCol(a, z - t / 2, b, z + t / 2); };
  for (const op of [...(o.open || [])].sort((a, b) => a.c - b.c)) {
    const a = op.c - op.w / 2, b = op.c + op.w / 2; seg(cur, a);
    const g = new THREE.BoxGeometry(b - a, H - op.h, t); uvBox(g, b - a, H - op.h, t); const l = new THREE.Mesh(g, mats); l.position.set(op.c, op.h + (H - op.h) / 2, z); l.receiveShadow = true; world.add(l);
    frame('x', op.c, z, op.w, op.h, t); if (op.door) makeDoor({axis: 'x', c: op.c, fixed: z, w: op.w, h: op.h, ...op.door}); cur = b;
  }
  seg(cur, x1);
}
function wallZ(z0, z1, x, o) {
  const t = o.t || .3, H = o.H, mats = [o.e || o.w, o.e || o.w, o.e || o.w, o.e || o.w, o.e || o.w, o.e || o.w]; mats[0] = o.ee; mats[1] = o.w; // px(+x face)=ee east face, nx = west face
  let cur = z0;
  const seg = (a, b) => { if (b - a < .02) return; const g = new THREE.BoxGeometry(t, H, b - a); uvBox(g, t, H, b - a); const m = new THREE.Mesh(g, mats); m.position.set(x, H / 2, (a + b) / 2); m.receiveShadow = true; world.add(m); addCol(x - t / 2, a, x + t / 2, b); };
  for (const op of [...(o.open || [])].sort((a, b) => a.c - b.c)) {
    const a = op.c - op.w / 2, b = op.c + op.w / 2; seg(cur, a);
    const g = new THREE.BoxGeometry(t, H - op.h, b - a); uvBox(g, t, H - op.h, b - a); const l = new THREE.Mesh(g, mats); l.position.set(x, op.h + (H - op.h) / 2, op.c); l.receiveShadow = true; world.add(l);
    frame('z', op.c, x, op.w, op.h, t); if (op.door) makeDoor({axis: 'z', c: op.c, fixed: x, w: op.w, h: op.h, ...op.door}); cur = b;
  }
  seg(cur, z1);
}

/* ================= models / props ================= */
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const GLB = {};
async function loadModels(names, onp) {
  let n = 0;
  await Promise.all(names.map(async nm => {
    const g = await loader.loadAsync(`models/${nm}.glb`);
    g.scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.envMap = ENV; m.envMapIntensity = .35; if (m.map) m.map.anisotropy = 4; }); } });
    GLB[nm] = g.scene; onp(++n / names.length);
  }));
}
function prop(name, x, z, ry = 0, o = {}) {
  const src = GLB[name]; if (!src) { console.warn('missing', name); return null; }
  const inst = SU.clone(src), wrap = new THREE.Group(); wrap.add(inst);
  const bb = new THREE.Box3().setFromObject(inst), c = bb.getCenter(new THREE.Vector3());
  inst.position.set(-c.x, -bb.min.y, -c.z);
  const s = o.s ?? (o.h ? o.h / (bb.max.y - bb.min.y) : 1); wrap.scale.setScalar(s);
  wrap.position.set(x, o.y ?? 0, z); wrap.rotation.set(o.rx ?? 0, ry, o.rz ?? 0);
  wrap.traverse(m => { if (m.isMesh) { m.castShadow = o.cast !== false; m.receiveShadow = true; m.frustumCulled = true; } });
  (o.parent || world).add(wrap); wrap.updateMatrixWorld(true);
  if (o.solid !== false && !o.y && !o.rx && !o.rz) {
    const b = new THREE.Box3().setFromObject(wrap), sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
    if (sx > .3 && sz > .3 || o.solid) wrap.userData.col = addCol(b.min.x + .04, b.min.z + .04, b.max.x - .04, b.max.z - .04);
  }
  return wrap;
}

/* ================= light sources (pooled) ================= */
const SRC = [], POOL = [];
function lamp(x, y, z, o = {}) { const s = {p: new THREE.Vector3(x, y, z), c: new THREE.Color(o.c ?? 0xffffff), i: o.i ?? 10, d: o.d ?? 9, f: o.f ?? (() => 1), w: 0, mesh: o.mesh, base: o.mesh ? o.mesh.material.color.clone() : null}; SRC.push(s); return s; }
for (let i = 0; i < 6; i++) { const L = new THREE.PointLight(0xffffff, 0, 10, 2); L.castShadow = false; scene.add(L); POOL.push(L); }
const hash = n => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
const F = {
  steady: t => 1, hum: t => .96 + .04 * Math.sin(t * 100),
  dying: t => { const k = Math.floor(t * 9); return hash(k) > .72 ? .12 + hash(k + 9) * .3 : (Math.sin(t * 60) > .93 ? .5 : 1); },
  weak: t => { const k = Math.floor(t * 4); return hash(k + 3) > .93 ? .1 : .96; },
  pulse: t => .55 + .45 * Math.sin(t * 3.2), fire: t => .85 + .15 * Math.sin(t * 7) * Math.sin(t * 3.1)
};
function fluor(x, y, z, o = {}) {
  const tube = new THREE.Mesh(new THREE.CapsuleGeometry(.025, o.len ?? 1.0, 4, 8), new THREE.MeshBasicMaterial({color: 0xcfe0ff}));
  tube.rotation.z = Math.PI / 2; if (o.rotY) tube.rotation.set(0, 0, 0), tube.rotation.x = Math.PI / 2; tube.position.set(x, y - .02, z); world.add(tube);
  const hous = new THREE.Mesh(new RoundedBoxGeometry((o.len ?? 1.0) + .12, .06, .14, 2, .02), plain(0x2a2c2e, .6, .6)); hous.position.set(x, y + .02, z); if (o.rotY) hous.rotation.y = Math.PI / 2; world.add(hous);
  return lamp(x, y - .3, z, {c: o.c ?? 0xcfe0ff, i: o.i ?? 9, d: o.d ?? 9, f: o.f ?? F.hum, mesh: tube});
}
function caged(x, y, z, ry, o = {}) { // wall cage lamp model + light
  prop('industrial_wall_lamp', x, z, ry, {y, solid: false});
  const dx = Math.sin(ry) * .2, dz = Math.cos(ry) * .2;
  return lamp(x + dx, y + .05, z + dz, {c: o.c ?? 0xffb070, i: o.i ?? 8, d: o.d ?? 8, f: o.f ?? F.fire});
}

/* ================= BUILD LEVEL ================= */
const WALLT = .3;
function room(name, x0, z0, x1, z1) { ROOMS.push({name, id: world.name, x0, z0, x1, z1}); }
let SPOT_DESK, DESKLIGHT_ON = true, monMesh, monCtx, monTex, phoneLamp, pendulum, redSpin;
const monState = {line: 0};

function buildLevel() {
  const H = 2.9;
  /* ---- OPS ---- */
  beginRoom('ops'); room('Control Room', -3.5, -3, 3.5, 3);
  floorPlane(-3.5, -3, 3.5, 3, MAT.fOps); ceilPlane(-3.5, -3, 3.5, 3, H);
  wallX(-3.5, 3.5, -3, {H, n: MAT.cor, s: MAT.ops});
  wallX(-3.5, 3.5, 3, {H, n: MAT.ops, s: MAT.cor});
  wallZ(-3, 3, -3.5, {H, w: MAT.cor, ee: MAT.ops, open: [{c: 0, w: 1.1, h: 2.15, door: {locked: true, msg: 'Sealed. The lock is welded shut.', dir: 1, name: 'west'}}]});
  wallZ(-3, 3, 3.5, {H, w: MAT.ops, ee: MAT.cor, open: [{c: 0, w: 1.1, h: 2.15, door: {open: true, dir: 1, name: 'ops-east'}}]});
  // beams
  for (const x of [-2.2, 0, 2.2]) box(.28, .22, 6, MAT.ceil, x, H - .11, 0, {cast: true});
  box(7, .22, .28, MAT.ceil, 0, H - .11, 0, {cast: true});
  // desk set
  const desk = prop('metal_office_desk', 0, -2.15, 0);
  prop('television_02', -.6, -2.1, .05, {y: .79, solid: false, s: 1.25});
  prop('vintage_radio_transceiver', .8, -2.1, -.1, {y: .79, solid: false});
  prop('binder_notebook', -.05, -1.8, .3, {y: .79, solid: false});
  prop('portable_cassette_player', .3, -1.75, .6, {y: .79, solid: false});
  prop('desk_lamp_arm_01', 1.15, -1.78, -.4, {y: .79, solid: false});
  prop('modern_arm_chair_01', .05, -1.0, Math.PI + .25, {});
  prop('vintage_telephone_wall_clock', -1.9, -2.74, 0, {y: 1.35, solid: false});
  prop('wall_clock', 3.43, -1.5, -Math.PI / 2, {y: 2.0, solid: false});
  prop('steel_frame_shelves_03', -3.1, 1.75, Math.PI / 2);
  prop('drawer_cabinet', -3.15, -2.2, Math.PI / 2);
  prop('metal_trash_can', 2.7, 2.65, Math.PI, {});
  prop('cardboard_box_01', 2.9, 1.5, .4, {});
  prop('plastic_crate_01', 2.95, 1.0, .2, {y: 0});
  prop('korean_fire_extinguisher_01', 3.3, 1.9, -Math.PI / 2, {y: 1.0, solid: false});
  prop('security_camera_01', -3.2, 2.85, 2.6, {y: 2.55, solid: false, rx: .0});
  prop('trashbag', 1.7, 2.6, 1.2, {});
  sign('OPERATOR', 0, 2.35, -2.97, 0, .9, 'NIGHT SHIFT');
  puddle(2.4, .2, .5, .35); groundStain(-1.5, 1.2, 1.2); groundStain(1.2, -.4, .9, 0x0b0907, .45);
  stain(-3.46, 1.5, -1.6, Math.PI / 2, .8, 1.6); stain(1.6, 1.95, -2.97, 0, .5, 1.5);
  // monitor canvas
  monCtx = document.createElement('canvas'); monCtx.width = 512; monCtx.height = 384; monTex = new THREE.CanvasTexture(monCtx); monTex.colorSpace = THREE.SRGBColorSpace;
  monMesh = new THREE.Mesh(new THREE.PlaneGeometry(.31, .235), new THREE.MeshBasicMaterial({map: monTex, color: 0xbbffdd}));
  monMesh.position.set(-.62, 1.12, -1.915); monMesh.rotation.y = .05; world.add(monMesh);
  SPOT_DESK = new THREE.SpotLight(0xffb877, 120, 7, .75, .55, 1.6); SPOT_DESK.position.set(1.0, 1.55, -1.6);
  SPOT_DESK.target.position.set(.1, .8, -2.2); SPOT_DESK.castShadow = true; SPOT_DESK.shadow.mapSize.set(512, 512); SPOT_DESK.shadow.bias = -.0006; scene.add(SPOT_DESK, SPOT_DESK.target);
  lamp(-.62, 1.0, -1.6, {c: 0x77ffbb, i: 1.4, d: 3, f: F.hum});
  lamp(0, 2.5, 0.3, {c: 0xaab8d0, i: 14, d: 9, f: F.weak});
  phoneLamp = lamp(-1.9, 1.5, -2.6, {c: 0xff2010, i: 0, d: 3});

  /* ---- CORRIDOR ---- */
  const CX0 = 3.5, CX1 = 26, CW = 2.6;
  beginRoom('cor'); room('Main Corridor', CX0, -1.3, CX1, 1.3);
  floorPlane(CX0, -1.3, CX1, 1.3, MAT.fCor);
  vault(CX0, CX1, CW, 2.5, .55, MAT.ceil);
  for (let x = 5; x < CX1; x += 3.2) rib(x, CW, 2.5, .55);
  wallX(CX0, CX1, -1.3, {H, n: MAT.gen, s: MAT.cor, open: [
    {c: 11, w: 1.1, h: 2.15, door: {dir: 1, name: 'gen'}}, {c: 21.5, w: 1.1, h: 2.15, door: {dir: 1, name: 'med'}}]});
  wallX(CX0, CX1, 1.3, {H, n: MAT.cor, s: MAT.sto, open: [
    {c: 12, w: 1.1, h: 2.15, door: {dir: -1, name: 'storage'}}, {c: 22, w: 1.1, h: 2.15, door: {dir: -1, name: 'dorm'}}]});
  // lights & signs
  [[6.5, F.hum], [11.5, F.hum], [16.5, F.dying], [21.5, F.weak]].forEach(([x, f]) => { prop('mounted_fluorescent_lights', x, 0, 0, {y: 2.95, solid: false, cast: false, s: 1.0}); fluor(x, 2.78, 0, {f, i: 11}); });
  sign('GENERATOR', 11, 2.36, -1.12, 0, .8, 'LEVEL B1'); sign('MEDICAL', 21.5, 2.36, -1.12, 0, .8, 'LEVEL B1');
  sign('STORAGE', 12, 2.36, 1.12, Math.PI, .8, 'LEVEL B1'); sign('DORMITORY', 22, 2.36, 1.12, Math.PI, .8, 'LEVEL B1');
  sign('EXIT', 25.6, 2.25, 0, -Math.PI / 2, .7, 'SURFACE');
  // pipes (curved runs) along both sides
  pipe([[4, 2.5, -1.15], [9, 2.55, -1.15], [14, 2.48, -1.15], [18, 2.56, -1.15], [24.5, 2.5, -1.15]], .075);
  pipe([[4, 2.52, 1.15], [10, 2.5, 1.15], [16, 2.58, 1.15], [21, 2.5, 1.15], [24.5, 2.56, 1.15]], .09);
  valve(8, 2.2, -1.12, 0); valve(17.2, 2.2, 1.12, Math.PI, .13);
  for (let i = 0; i < 6; i++) cable([4.5 + i * 3.6, 2.62, .95], [4.5 + (i + 1) * 3.6, 2.62, .95], .2);
  for (let i = 0; i < 6; i++) cable([4.5 + i * 3.6, 2.6, -.9], [4.5 + (i + 1) * 3.6, 2.6, -.9], .14, .02, 0x14100c);
  caged(9.5, 2.0, 1.28, Math.PI, {i: 5}); caged(19, 2.0, -1.28, 0, {i: 5, f: F.dying});
  prop('security_camera_01', 4.2, 2.35, -.9, {y: 2.35, solid: false, rz: 0, s: 1.0});
  prop('security_camera_01', 24.8, -1.1, 2.4, {y: 2.35, solid: false});
  prop('korean_fire_extinguisher_01', 14.8, 1.08, Math.PI / 2 * 2, {y: 1.1, solid: false});
  WHEEL = prop('wheelchair_01', 16.2, -.85, 2.55, {});
  prop('metal_trash_can', 7, .95, Math.PI, {s: .9});
  prop('cardboard_box_01', 14.5, .8, .5, {});
  for (const [x, z, r] of [[6.5, .1, .8], [11.2, -.3, .7], [15, .4, 1.1], [18.7, -.2, .6], [23, .2, .9]]) puddle(x, z, r, r * .55);
  for (const [x, z, r] of [[9, -.5, 1.0], [13.5, .6, 1.1], [19.5, .4, .9]]) groundStain(x, z, r);
  for (const x of [7.7, 13.3, 18.2, 23.6]) stain(x, 1.6, -1.29, 0, .6, 1.5), stain(x + 1.4, 1.6, 1.29, Math.PI, .5, 1.3);
  lamp(8.5, 2.3, 0, {c: 0xff6a30, i: 0, d: 1});

  /* ---- GENERATOR ---- */
  beginRoom('gen'); room('Generator Room', 7, -9, 15, -1.3);
  floorPlane(7, -9, 15, -1.3, MAT.fGen); ceilPlane(7, -9, 15, -1.3, H);
  wallX(7, 15, -9, {H, n: MAT.gen, s: MAT.gen});
  wallZ(-9, -1.3, 7, {H, w: MAT.cor, ee: MAT.gen}); wallZ(-9, -1.3, 15, {H, w: MAT.gen, ee: MAT.cor});
  for (const x of [8.6, 13.4]) { const col = new THREE.Mesh(new THREE.CylinderGeometry(.22, .26, H, 20), MAT.gen); col.position.set(x, H / 2, -4.3); col.castShadow = col.receiveShadow = true; world.add(col); addCol(x - .26, -4.56, x + .26, -4.04); const cap = new THREE.Mesh(new THREE.CylinderGeometry(.34, .22, .22, 20), MAT.gen); cap.position.set(x, H - .11, -4.3); world.add(cap); const base = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .2, 20), MAT.gen); base.position.set(x, .1, -4.3); world.add(base); }
  for (const x of [9, 11, 13]) box(.3, .26, 7.7, MAT.ceil, x, H - .13, -5.15, {cast: true});
  prop('portable_generator', 11, -7.6, 0, {s: 1.8});
  prop('power_box_01', 14.7, -5.2, -Math.PI / 2, {y: 1.15, solid: false});
  prop('utility_box_01', 14.4, -7.5, -Math.PI / 2, {});
  prop('Barrel_01', 8.1, -8.3, 0); prop('barrel_03', 8.85, -8.35, 1); prop('Barrel_01', 8.5, -7.55, 2);
  prop('tool_cart', 13.4, -8.3, 0); prop('metal_toolbox', 13.2, -8.3, .3, {y: .96, solid: false});
  prop('ladder_sectioned_01', 14.7, -3.2, -Math.PI / 2, {rz: .09, y: 0, solid: false});
  prop('metal_stool_02', 9.5, -2.2, 1);
  prop('security_camera_01', 7.3, -1.7, -.9, {y: 2.55, solid: false});
  pipe([[7.2, 2.5, -8.8], [10, 2.55, -8.8], [12, 2.1, -8.8], [14.8, 2.3, -8.5], [14.8, 1.2, -6.5], [14.8, .5, -4.5]], .1);
  pipe([[7.2, 1.7, -8.75], [9, 1.75, -8.75], [10.3, 1.0, -8.75]], .07);
  pipe([[10.8, 2.88, -8.9], [10.8, 2.9, -5.5]], .12, false);
  valve(10.3, 1.3, -8.72, 0, .14); valve(12.9, 2.12, -8.76, 0, .12);
  for (let i = 0; i < 5; i++) cable([9.1 + i * 1, 2.7, -7.9], [10.1 + i * 1, 2.7, -7.9], .15);
  cable([11, 1.2, -7.1], [14.6, 1.3, -6.2], .5, .028); cable([11.2, 1.0, -7.1], [14.5, .06, -4.8], .3, .02);
  caged(11, 2.45, -8.9, 0, {i: 22}); caged(14.9, 2.2, -2.5, -Math.PI / 2, {i: 14, f: F.dying}); lamp(10, 1.6, -3.2, {c: 0x9fb0c8, i: 8, d: 8, f: F.weak});
  redSpin = lamp(11, 2.65, -5.8, {c: 0xff2418, i: 14, d: 8, f: F.pulse});
  const rb = new THREE.Mesh(new THREE.SphereGeometry(.09, 14, 10), new THREE.MeshBasicMaterial({color: 0xff2a18})); rb.position.set(11, 2.72, -5.8); world.add(rb); redSpin.mesh = rb; redSpin.base = rb.material.color.clone();
  puddle(11.5, -6, .9, .6); puddle(9.2, -3.2, .7, .5); puddle(12.8, -2.7, .55, .4); groundStain(11, -8.1, 1.3, 0x050404, .85);
  stain(8, 1.5, -8.97, 0, .8, 1.6); stain(13, 1.4, -8.97, 0, .6, 1.4); stain(7.15, 1.5, -5.5, Math.PI / 2, .7, 1.5);
  sign('HIGH VOLTAGE', 12, 1.8, -8.97, 0, .6);

  /* ---- STORAGE ---- */
  beginRoom('sto'); room('Storage', 8, 1.3, 17, 9);
  floorPlane(8, 1.3, 17, 9, MAT.fSto); ceilPlane(8, 1.3, 17, 9, H);
  wallX(8, 17, 9, {H, n: MAT.sto, s: MAT.sto});
  wallZ(1.3, 9, 8, {H, w: MAT.cor, ee: MAT.sto}); wallZ(1.3, 9, 17, {H, w: MAT.sto, ee: MAT.cor});
  for (const x of [10.5, 14]) box(.3, .26, 7.7, MAT.ceil, x, H - .13, 5.15, {cast: true});
  [9.3, 11.9, 14.5].forEach((x, i) => prop('steel_frame_shelves_03', x, 8.5, Math.PI, {}));
  [9.3, 11.9, 14.5].forEach((x, i) => {
    const L = [[.4, 'cardboard_box_01', .75], [.97, 'plastic_crate_01', 1], [1.52, 'metal_toolbox', 1]];
    L.forEach(([y, n, s], j) => { if ((i + j) % 4 === 3) return; prop(n, x - .55 + j * .5 + (i === 1 ? .1 : 0), 8.5, (i + j) * .7, {y, s, solid: false}); });
    if (i !== 1) prop('ammo_box', x + .6, 8.5, 1.5 + i, {y: .97, solid: false}); if (i === 2) prop('medical_box', x + .1, 8.5, 0, {y: 1.55, solid: false});
    if (i === 0) prop('binder_notebook', x, 8.5, .4, {y: 1.55, solid: false});
  });
  prop('old_military_crate', 16.0, 2.6, -Math.PI / 2); prop('old_military_crate', 16.1, 2.55, -Math.PI / 2 + .1, {y: .3, solid: false});
  prop('wooden_military_crate', 16.2, 4.8, -Math.PI / 2 + .2); prop('wooden_military_crate', 15.9, 6.4, -Math.PI / 2 - .15);
  prop('cardboard_box_01', 9, 2.2, .3); prop('cardboard_box_01', 9.5, 2.6, .7, {y: .34}); prop('cardboard_box_01', 8.9, 3.3, 2);
  prop('plastic_crate_01', 10, 6.2, 1); prop('plastic_crate_01', 10.05, 6.25, 1.6, {y: .26, solid: false});
  prop('trashbag', 9, 5.0, 0); prop('trashbag', 9.5, 5.6, 2, {}); prop('trashbag', 8.9, 4.3, 1);
  prop('metal_trash_can', 15.2, 8.5, Math.PI, {s: .85}); prop('ammo_box', 16.15, 3.2, -Math.PI / 2 + .2, {y: .6, solid: false});
  prop('Barrel_01', 16.4, 7.6, 1); prop('barrel_03', 16.45, 8.45, 0);
  prop('medical_box', 11.9, 8.5, 0, {y: 1.0, solid: false}); prop('metal_toolbox', 14.5, 8.5, 0, {y: .0, solid: false});
  prop('security_camera_01', 16.6, 1.7, .8, {y: 2.55, solid: false});
  // pendulum bulb (lathe shade + cord)
  pendulum = new THREE.Group(); pendulum.position.set(12.5, 2.9, 5);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .6, 6), plain(0x050505, .6)); cord.position.y = -.3; pendulum.add(cord);
  const shade = new THREE.Mesh(new THREE.LatheGeometry([[.0, .0], [.04, .0], [.09, -.03], [.17, -.1], [.19, -.12], [.18, -.125], [.16, -.11], [.08, -.05], [.0, -.04]].map(p => new THREE.Vector2(p[0], p[1])), 20), plain(0x3c4a3c, .45, .6, .5)); shade.material.side = THREE.DoubleSide; shade.position.y = -.58; shade.castShadow = true; pendulum.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.04, 12, 8), new THREE.MeshBasicMaterial({color: 0xffd9a0})); bulb.position.y = -.66; pendulum.add(bulb); world.add(pendulum);
  const pl = lamp(12.5, 2.2, 5, {c: 0xffc27a, i: 14, d: 9, f: F.hum}); pl.pend = true;
  const drain = new THREE.Mesh(new THREE.CircleGeometry(.28, 24), PBR('metal_grate_rusty', {tint: 0x9a8a7a, metal: .5})); drain.rotation.x = -Math.PI / 2; drain.position.set(12.5, .006, 5.4); world.add(drain);
  chain(10.3, 2.9, 3.2, 14, .3); chain(14.4, 2.9, 3.4, 10, 1);
  puddle(12.5, 5.4, 1.1, .8); puddle(14, 3.0, .6, .4); groundStain(10, 4, 1.5, 0x060505, .8);
  stain(8.15, 1.4, 4.0, Math.PI / 2, .8, 1.5); stain(16.85, 1.5, 6, -Math.PI / 2, .7, 1.4); stain(9.8, 1.4, 8.97, Math.PI, .7, 1.5);

  /* ---- MEDICAL ---- */
  beginRoom('med'); room('Medical Bay', 18, -8, 25, -1.3);
  floorPlane(18, -8, 25, -1.3, MAT.fMed); ceilPlane(18, -8, 25, -1.3, H);
  wallX(18, 25, -8, {H, n: MAT.med, s: MAT.med});
  wallZ(-8, -1.3, 18, {H, w: MAT.cor, ee: MAT.med}); wallZ(-8, -1.3, 25, {H, w: MAT.med, ee: MAT.cor});
  prop('old_bed_frame', 18.6, -6.2, Math.PI / 2 + Math.PI / 2 * 0, {}); prop('old_bed_frame', 18.6, -4.2, Math.PI / 2, {});
  prop('old_bed_frame', 24.4, -4.8, -Math.PI / 2, {}); prop('wheelchair_01', 22, -6.9, 2.4);
  prop('drawer_cabinet', 24.6, -7.4, -Math.PI / 2); prop('medical_box', 24.6, -7.3, 0, {y: 1.88, solid: false});
  prop('metal_stool_02', 20.6, -3.4, 1.2); prop('binder_notebook', 20.6, -3.4, .5, {y: .47, solid: false}); prop('metal_trash_can', 18.9, -2.0, 0, {s: .85});
  prop('trashbag', 23.5, -2.2, 1.3); prop('security_camera_01', 24.6, -1.8, -.8, {y: 2.55, solid: false});
  // IV stand: round pole, base ring, hook, bag
  { const g = new THREE.Group(), st = plain(0x9a9a9a, .35, .9, .6); const pole = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1.8, 10), st); pole.position.y = .9; g.add(pole);
    for (let i = 0; i < 5; i++) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.01, .01, .3, 6), st); leg.rotation.z = Math.PI / 2; leg.rotation.y = i * Math.PI * 2 / 5; leg.position.set(Math.cos(i * Math.PI * 2 / 5) * .15, .03, -Math.sin(i * Math.PI * 2 / 5) * .15); g.add(leg); const wh = new THREE.Mesh(new THREE.SphereGeometry(.022, 8, 6), MAT.dark); wh.position.set(Math.cos(i * Math.PI * 2 / 5) * .3, .022, -Math.sin(i * Math.PI * 2 / 5) * .3); g.add(wh); }
    const hook = new THREE.Mesh(new THREE.TorusGeometry(.05, .008, 6, 14, Math.PI * 1.4), st); hook.position.set(.05, 1.8, 0); g.add(hook);
    const bag = new THREE.Mesh(new THREE.CapsuleGeometry(.06, .13, 4, 10), new THREE.MeshStandardMaterial({color: 0xbfc8c0, roughness: .2, transparent: true, opacity: .7})); bag.position.set(.05, 1.6, 0); g.add(bag);
    g.position.set(19.4, 0, -5.2); g.castShadow = true; world.add(g); }
  fluor(21.5, 2.82, -4.5, {i: 12, f: F.dying, c: 0xd4ffe6, d: 9}); fluor(21.5, 2.82, -6.8, {i: 8, f: F.weak, c: 0xd4ffe6, d: 8});
  caged(22, 2.1, -1.5, 0, {i: 5, c: 0xff9a60});
  puddle(22.2, -4, .8, .5); groundStain(20, -5, 1.4, 0x0b0605, .5); groundStain(23, -3, .9, 0x0a0604, .55);
  stain(18.15, 1.5, -5, Math.PI / 2, .8, 1.5, 0x0a0504); stain(24.85, 1.4, -3, -Math.PI / 2, .6, 1.4);
  sign('WARD 2', 21.5, 2.3, -7.97, 0, .6);

  /* ---- DORMITORY ---- */
  beginRoom('dorm'); room('Dormitory', 19, 1.3, 25, 8);
  floorPlane(19, 1.3, 25, 8, MAT.fDorm); ceilPlane(19, 1.3, 25, 8, H);
  wallX(19, 25, 8, {H, n: MAT.dorm, s: MAT.dorm});
  wallZ(1.3, 8, 19, {H, w: MAT.cor, ee: MAT.dorm}); wallZ(1.3, 8, 25, {H, w: MAT.dorm, ee: MAT.cor});
  prop('old_bed_frame', 19.7, 3.6, Math.PI / 2, {}); prop('old_bed_frame', 19.7, 5.6, Math.PI / 2, {});
  prop('vintage_day_bed', 23.7, 7.4, Math.PI, {}); prop('drawer_cabinet', 24.6, 3.0, -Math.PI / 2);
  prop('metal_stool_02', 21.4, 2.6, 1); prop('boombox', 21.4, 2.6, 2.9, {y: .46, solid: false}); prop('alarm_clock_01', 19.6, 4.6, .6, {y: .55, solid: false, s: 1.0});
  prop('wooden_military_crate', 21.8, 7.4, 0, {}); prop('trashbag', 24.4, 6.3, 0); prop('security_camera_01', 24.6, 1.8, -2.4, {y: 2.55, solid: false});
  caged(22, 2.1, 7.9, Math.PI, {i: 16}); fluor(22, 2.82, 4.6, {i: 16, f: F.weak, c: 0xffe8c0, d: 8});
  puddle(22, 5, .8, .5); groundStain(21, 3.5, 1.3, 0x0a0806, .55); stain(19.15, 1.4, 6.7, Math.PI / 2, .8, 1.5); stain(24.85, 1.5, 5, -Math.PI / 2, .7, 1.4);

  /* ---- STAIRWELL ---- */
  const SH = 6.8;
  beginRoom('stair'); room('Stairwell', 26, -2.5, 31, 2.5);
  floorPlane(26, -2.5, 31, 2.5, MAT.fStair); ceilPlane(26, -2.5, 31, 2.5, SH);
  wallX(26, 31, -2.5, {H: SH, n: MAT.stair, s: MAT.stair}); wallX(26, 31, 2.5, {H: SH, n: MAT.stair, s: MAT.stair});
  wallZ(-2.5, 2.5, 31, {H: SH, w: MAT.stair, ee: MAT.stair});
  wallZ(-2.5, 2.5, 26, {H: SH, w: MAT.cor, ee: MAT.stair, open: [{c: 0, w: 1.4, h: 2.3, door: {dir: 1, locked: false, name: 'stair'}}]});
  for (let i = 0; i < 3; i++) prop('ladder_sectioned_01', 30.75, 0, -Math.PI / 2, {y: i * 2.12, solid: false});
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .12, 28), PBR('rusty_metal_02', {tint: 0x707880, metal: .6})); hatch.position.set(30.2, SH - .06, 0); world.add(hatch);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.58, .05, 10, 32), MAT.dark); ring.rotation.x = Math.PI / 2; ring.position.set(30.2, SH - .12, 0); world.add(ring);
  const hw = new THREE.Group(); { const wm = plain(0x5a4a3a, .45, .7, .5); hw.add(new THREE.Mesh(new THREE.TorusGeometry(.17, .02, 8, 28), wm)); for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(.01, .01, .34, 6), wm); s.rotation.z = i * Math.PI / 4; hw.add(s); } hw.rotation.x = Math.PI / 2; hw.position.set(30.2, SH - .15, 0); world.add(hw); }
  for (let y = 1.2; y < SH; y += 1.5) { const pl2 = new THREE.Mesh(new THREE.TorusGeometry(.16, .03, 8, 24), MAT.dark); }
  pipe([[26.2, 6.4, -2.35], [28, 6.45, -2.35], [30.8, 6.2, -2.35], [30.85, 4, -2.3], [30.85, 1, -2.2]], .11);
  pipe([[26.2, 5.6, 2.35], [29, 5.5, 2.35], [30.8, 5.2, 2.2], [30.85, 2.5, 2.2]], .08);
  chain(28.5, SH, -1, 22, .5); chain(27.4, SH, 1.4, 18, 0);
  prop('korean_public_payphone_01', 26.25, -1.9, Math.PI / 2, {y: 1.2, solid: false});
  prop('Barrel_01', 30.4, -2.0, 0); prop('barrel_03', 30.5, 1.9, 1); prop('metal_trash_can', 27.2, 2.15, Math.PI, {s: .85});
  prop('security_camera_01', 26.3, 2.35, 2.2, {y: 4.5, solid: false});
  lamp(30.2, 5.6, 0, {c: 0x7aa0ff, i: 40, d: 16, f: F.weak}); lamp(28.5, 1.2, 0, {c: 0x4060a0, i: 10, d: 7, f: F.steady});
  const spot = new THREE.SpotLight(0x8fb0ff, 90, 14, .5, .8, 1.4); spot.position.set(30.2, SH - .3, 0); spot.target.position.set(29, 0, 0); scene.add(spot, spot.target);
  caged(26.2, 2.6, 1.8, Math.PI / 2, {i: 8, c: 0xff9a60});
  puddle(28.2, 0, 1.2, .8); puddle(29.8, -1.4, .5, .4); groundStain(28, 1, 1.6, 0x050605, .7);
  sign('SURFACE ACCESS', 28.5, 2.4, -2.47, 0, .9, 'SEALED AFTER 02:00');
  stain(30.95, 2.2, 0, -Math.PI / 2, 1.3, 3.0, 0x060606, .6); stain(26.1, 2.6, 0, Math.PI / 2, 1.4, 2.6, 0x060606, .6);
}

/* ================= monitor ================= */
function drawMon(t) {
  const g = monCtx.getContext('2d'); g.fillStyle = '#04120c'; g.fillRect(0, 0, 512, 384);
  if (S.power < .15) { g.fillStyle = '#010302'; g.fillRect(0, 0, 512, 384); monTex.needsUpdate = true; return; }
  g.font = 'bold 26px monospace'; g.fillStyle = '#55ffaa'; g.fillText('HELP LINE  v2.1', 18, 38);
  g.font = '20px monospace'; for (let i = 0; i < 3; i++) { const act = (i === 2 && S.monLine === 3) || (i === 0 && S.monLine === 1); g.fillStyle = act ? '#ff5555' : '#44dd99'; g.fillText('LINE ' + (i + 1) + ': ' + (act ? 'ACTIVE' : 'IDLE'), 18, 84 + i * 28); }
  g.fillStyle = '#2a8a66'; g.fillText('-----------------------------', 18, 176);
  g.fillStyle = '#7fe8b8'; g.fillText('02:00  SHIFT START', 18, 206); g.fillText('02:14  NO INCOMING', 18, 234);
  if (Math.sin(t * 3) > 0) g.fillText('_', 18, 262);
  for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(120,255,180,' + (.05 + Math.random() * .08) + ')'; g.fillRect(0, Math.random() * 384, 512, 2); }
  monTex.needsUpdate = true;
}

/* ================= player ================= */
const P = {x: 0, z: 1.2, yaw: 0, pitch: -.04, vx: 0, vz: 0, bob: 0, eye: 1.65, eyeB: 1.65, R: .28, crouch: false, hidden: null, spike: 0, bat: 1, stam: 1, held: false};
const keys = {};
let locked = false, started = false;
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  if (!started) return;
  if (e.code === 'Tab') { S.showObj = 6; objApply(); }
  if (e.code === 'KeyF') toggleFlash();
  if (e.code === 'KeyE') interactKey();
  if (e.code === 'KeyQ') { quality = quality ? 0 : 1; resize(); applyQuality(); toast('Quality: ' + (quality ? 'High' : 'Low')); }
  if (e.code === 'KeyP') $('fps').style.display = $('fps').style.display === 'block' ? 'none' : 'block';
});
addEventListener('keyup', e => keys[e.code] = false);
cv.addEventListener('click', () => { if (started && !locked) cv.requestPointerLock && cv.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === cv; });
addEventListener('mousemove', e => { if (!locked) return; P.yaw -= e.movementX * .0022; P.pitch = Math.max(-1.4, Math.min(1.4, P.pitch - e.movementY * .0022)); });
let drag = false, lx = 0, ly = 0;
cv.addEventListener('pointerdown', e => { if ((e.pointerType === 'touch' || !locked)) { drag = true; lx = e.clientX; ly = e.clientY; } });
addEventListener('pointerup', () => drag = false);
addEventListener('pointermove', e => { if (drag && !locked) { P.yaw -= (e.clientX - lx) * .004; P.pitch = Math.max(-1.4, Math.min(1.4, P.pitch - (e.clientY - ly) * .004)); lx = e.clientX; ly = e.clientY; } });

const flash = new THREE.SpotLight(0xfff1d8, 80, 26, .42, .5, 1.3);
flash.castShadow = true; flash.shadow.mapSize.set(1024, 1024); flash.shadow.bias = -.0005; flash.shadow.camera.near = .1;
scene.add(flash, flash.target); let flashOn = false;
function toggleFlash() { if (!flashOn && P.bat <= .001) { toast('The flashlight is dead'); return; } flashOn = !flashOn; flash.visible = flashOn; toast(flashOn ? 'Flashlight on' : 'Flashlight off'); beep(flashOn ? 1800 : 1200, .03, .06); }
flash.visible = false;
function applyQuality() { flash.shadow.mapSize.set(quality ? 1024 : 512, quality ? 1024 : 512); flash.shadow.map && flash.shadow.map.dispose(); flash.shadow.map = null; SPOT_DESK.castShadow = !!quality; }

function collide(x, z) {
  for (let it = 0; it < 2; it++) for (const c of COL) {
    if (c.off) continue;
    const cx = Math.max(c.x0, Math.min(x, c.x1)), cz = Math.max(c.z0, Math.min(z, c.z1)), dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
    if (d2 < P.R * P.R) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (P.R - d) / d; x += dx * k; z += dz * k; }
      else { const l = x - c.x0, r = c.x1 - x, t = z - c.z0, b = c.z1 - z, m = Math.min(l, r, t, b); if (m === l) x = c.x0 - P.R; else if (m === r) x = c.x1 + P.R; else if (m === t) z = c.z0 - P.R; else z = c.z1 + P.R; }
    }
  }
  return [x, z];
}
function nearDoor() {
  let best = null, bd = 2.1;
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  for (const d of DOORS) { const dx = d.x - P.x, dz = d.z - P.z, dist = Math.hypot(dx, dz); if (dist < bd && (dx * fx + dz * fz) / (dist || 1) > .35) { bd = dist; best = d; } }
  return best;
}
function interact() {
  const d = nearDoor(); if (!d) return;
  if (d.locked) { d.shake = .4; toast(d.msg); thud(); return; }
  d.target = d.target ? 0 : 1; creak(); P.spike = Math.max(P.spike, .9);
}
let toastT = 0; function toast(t) { const e = $('prompt'); e.textContent = t; e.style.display = 'block'; toastT = 2.2; }

/* ================= audio (procedural + loop) ================= */
let AC, master, wetBus;
function beep(f, d, v) { if (!AC) return; const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = f; g.gain.value = v; o.connect(g); g.connect(master); o.start(); g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + d); o.stop(AC.currentTime + d); }
function noiseBurst(d, f, v, q = 1, pan) {
  if (!AC) return; const n = AC.createBuffer(1, AC.sampleRate * d, AC.sampleRate), a = n.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / a.length, 2);
  const s = AC.createBufferSource(); s.buffer = n; const fl = AC.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q; const g = AC.createGain(); g.gain.value = v;
  s.connect(fl); fl.connect(g); let out = g; if (pan) { out = pan; g.connect(pan); } out.connect(master); s.start();
}
const thud = () => { noiseBurst(.25, 140, 1.2, .7); beep(70, .2, .3); };
const creak = () => { noiseBurst(.9, 520, .22, 6); noiseBurst(.7, 300, .3, 3); };
function step() { noiseBurst(.16, 220 + Math.random() * 90, .5, .8); }
function drip() { if (!AC) return; const p = AC.createPanner(); p.panningModel = 'HRTF'; p.positionX.value = P.x + (Math.random() - .5) * 14; p.positionY.value = 0; p.positionZ.value = P.z + (Math.random() - .5) * 14;
  const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(1500 + Math.random() * 500, AC.currentTime); o.frequency.exponentialRampToValueAtTime(420, AC.currentTime + .09); g.gain.value = .12; g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + .22); o.connect(g); g.connect(p); p.connect(master); o.start(); o.stop(AC.currentTime + .25); }
function updAudioListener() {
  if (!AC) return; const L = AC.listener, fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  L.positionX.value = P.x; L.positionY.value = P.eye; L.positionZ.value = P.z; L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
}

/* ================= dust ================= */
const DN = 250, dustPos = new Float32Array(DN * 3);
for (let i = 0; i < DN; i++) { dustPos[i * 3] = (Math.random() - .5) * 14; dustPos[i * 3 + 1] = Math.random() * 3; dustPos[i * 3 + 2] = (Math.random() - .5) * 14; }
const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DN * 3), 3));
const dustTex = canvasTex(32, 32, (g, w, h) => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); });
const dust = new THREE.Points(dg, new THREE.PointsMaterial({size: .03, map: dustTex, transparent: true, opacity: .22, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xb8c0d0, sizeAttenuation: true}));
dust.frustumCulled = false; scene.add(dust);

/* ================= loop ================= */
let slowT = 0, fastT = 0;
function cullRooms() {
  const id = roomId(), vis = {}; vis[id] = 1;
  const open = k => { const d = DOORS.find(d => d.room === k); return d && d.open > .02; };
  if (id === 'cor' || open(id)) { vis.cor = 1; for (const d of DOORS) if (d.room && d.open > .02) vis[d.room] = 1; }
  for (const k in GROUPS) GROUPS[k].visible = !!vis[k];
}
const clock = new THREE.Clock(); let T = 0, curRoom = '', stepAcc = 0, dripT = 4, fpsN = 0, fpsT = 0;
function roomAt(x, z) { for (const r of ROOMS) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r.name; return ''; }
function frameLoop() {
  requestAnimationFrame(frameLoop);
  const dt = Math.min(.05, clock.getDelta()); if (!window.__ready) return; T += dt;
  // movement
  if (started && !S.freeze && !P.hidden) {
    P.crouch = !!(keys.KeyC || keys.ControlLeft); const sp = P.crouch ? 1.0 : ((keys.ShiftLeft || keys.ShiftRight || Math.hypot(TJ.x, TJ.y) > .95) ? 3.3 : 1.9);
    let ix = Math.max(-1, Math.min(1, (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + TJ.x)), iz = Math.max(-1, Math.min(1, (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0) + TJ.y));
    if (keys.ArrowLeft) P.yaw += dt * 1.8; if (keys.ArrowRight) P.yaw -= dt * 1.8;
    const l = Math.max(1, Math.hypot(ix, iz)); ix /= l; iz /= l;
    const c = Math.cos(P.yaw), s = Math.sin(P.yaw), tx = (ix * c + iz * s) * sp, tz = (-ix * s + iz * c) * sp;
    const k = Math.min(1, dt * 9); P.vx += (tx - P.vx) * k; P.vz += (tz - P.vz) * k;
    const [nx, nz] = collide(P.x + P.vx * dt, P.z + P.vz * dt); P.x = nx; P.z = nz;
    const spd = Math.hypot(P.vx, P.vz);
    if (spd > .3) { P.bob += dt * spd * 2.9; stepAcc += dt * spd; if (stepAcc > (sp > 2 ? 1.5 : 1.05)) { stepAcc = 0; step(); } }
  }
  P.eyeB += ((P.hidden ? .72 : P.crouch ? 1.2 : 1.65) - P.eyeB) * Math.min(1, dt * 7); P.eye = P.eyeB + Math.sin(P.bob) * .022 * Math.min(1, Math.hypot(P.vx, P.vz) / 1.9);
  if (P.hidden) { let dy = P.yaw - P.hidden.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); dy = Math.max(-1.1, Math.min(1.1, dy)); P.yaw = P.hidden.yaw + dy; P.pitch = Math.max(-.6, Math.min(.35, P.pitch)); }
  camera.position.set(P.x, P.eye, P.z); camera.rotation.set(P.pitch, P.yaw, Math.sin(P.bob * .5) * .0025 * Math.hypot(P.vx, P.vz));
  // flashlight follows view with a slight lag
  const fd = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  flash.position.copy(camera.position).addScaledVector(fd, .15).add(new THREE.Vector3(.12 * Math.cos(P.yaw), -.12, -.12 * Math.sin(P.yaw)));
  flash.target.position.copy(camera.position).addScaledVector(fd, 8);
  // doors
  for (const d of DOORS) {
    d.shake = Math.max(0, d.shake - dt); const prev = d.open; d.open += (d.target - d.open) * Math.min(1, dt * 2.6);
    if (Math.abs(d.target - d.open) < .01) d.open = d.target;
    const e = d.open * d.open * (3 - 2 * d.open); d.pivot.rotation.y = d.dir * e * 1.75 * (d.dir === -1 ? 1 : 1) + (d.shake ? Math.sin(T * 60) * .01 * d.shake : 0);
    d.col.off = d.open > .15;
  }
  // light pool
  const cp = camera.position;
  for (const s of SRC) { s.dist = s.p.distanceTo(cp); }
  const order = SRC.slice().sort((a, b) => a.dist - b.dist);
  order.forEach((s, i) => { const want = i < 6 && s.dist < 17 ? 1 : 0; s.w += (want - s.w) * Math.min(1, dt * 4); });
  const act = order.filter(s => s.w > .01).sort((a, b) => b.w - a.w).slice(0, 6);
  const pend = Math.sin(T * 1.1) * .22 + Math.sin(T * .63) * .1; pendulum.rotation.z = pend; pendulum.rotation.x = Math.sin(T * .9 + 1) * .08;
  POOL.forEach((L, i) => {
    const s = act[i]; if (!s) { L.intensity = 0; return; }
    let f = s.f(T); if (s.pend) s.p.set(12.5 + Math.sin(pend) * -.7, 2.9 - Math.cos(pend) * .66 + .0, 5 + Math.sin(pendulum.rotation.x) * .6);
    L.position.copy(s.p); L.color.copy(s.c); L.distance = s.d; L.intensity = s.i * f * s.w * (s.em ? 1 : S.power) * .8;
  });
  for (const s of SRC) if (s.mesh) { const f = s.f(T); s.mesh.material.color.copy(s.base).multiplyScalar((.12 + .88 * Math.min(1, f)) * (s.em ? 1 : Math.max(.03, S.power))); }
  // desk lamp subtle hum flicker
  SPOT_DESK.intensity = (S.deskOff ? 0 : 120 * S.power) * (.97 + .03 * Math.sin(T * 90) + (hash(Math.floor(T * 7)) > .985 ? -.3 : 0));
  AMB.intensity = 1.0 * (.08 + .92 * S.power); HEMI.intensity = .34 * (.08 + .92 * S.power);
  if (monCtx && Math.floor(T * 8) !== Math.floor((T - dt) * 8)) drawMon(T);
  // dust
  const pa = dg.attributes.position.array;
  for (let i = 0; i < DN; i++) {
    dustPos[i * 3] += Math.sin(T * .3 + i) * .002; dustPos[i * 3 + 1] += Math.cos(T * .2 + i * 1.3) * .0015; dustPos[i * 3 + 2] += Math.sin(T * .25 + i * .7) * .002;
    pa[i * 3] = P.x + ((dustPos[i * 3] + 7 + 140) % 14) - 7; pa[i * 3 + 1] = (dustPos[i * 3 + 1] % 3 + 3) % 3; pa[i * 3 + 2] = P.z + ((dustPos[i * 3 + 2] + 7 + 140) % 14) - 7;
  }
  dg.attributes.position.needsUpdate = true;
  // room name / prompts
  const rn = roomAt(P.x, P.z);
  if (rn && rn !== curRoom) { curRoom = rn; const e = $('room'); e.textContent = rn; e.style.opacity = 1; setTimeout(() => { if (curRoom === rn) e.style.opacity = 0; }, 2600); }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('prompt').style.display = 'none'; }
  else { const d = started && !curInt && !P.hidden ? nearDoor() : null; const e = $('prompt'); if (P.hidden) { e.textContent = 'E: come out   |   hold SPACE: hold your breath'; e.style.display = 'block'; } else if (curInt) { e.textContent = curInt.hold ? curInt.label : 'E: ' + curInt.label; e.style.display = 'block'; } else if (d) { e.textContent = (d.locked ? 'E: try the door' : d.target ? 'E: close' : 'E: open'); e.style.display = 'block'; } else e.style.display = 'none'; }
  // sfx
  dripT -= dt; if (dripT < 0 && AC) { drip(); dripT = 4 + Math.random() * 9; }
  storyTick(dt, T); entTick(dt, T); cullRooms();
  if (dt > .026) { slowT += dt; fastT = 0; } else if (dt < .0185) { fastT += dt; slowT = Math.max(0, slowT - dt); }
  if (slowT > 1.2 && prScale > .55) { prScale = Math.max(.55, prScale - .12); resize(); slowT = 0; }
  if (fastT > 6 && prScale < 1) { prScale = Math.min(1, prScale + .08); resize(); fastT = 0; }
  updAudioListener();
  renderer.render(scene, camera);
  fpsN++; fpsT += dt; if (fpsT > .5) { $('fps').textContent = Math.round(fpsN / fpsT) + ' fps  ' + renderer.info.render.triangles + ' tris  ' + renderer.info.render.calls + ' calls'; fpsN = 0; fpsT = 0; }
}

/* ================= STORY ================= */
const S = {night: 0, abort: false, base: 1, power: 1, flick: 0, freeze: false, walker: null, turnWatch: false, turned: null, loops: [], voices: new Set(), deskOff: false, monLine: 0, current: null, mute: false};
const LINES = {}, VB = {}, AB = {};
const V3 = THREE.Vector3;
const PHONE_POS = new V3(-1.9, 1.35, -2.7), PAYPHONE = new V3(26.45, 1.4, -1.9), RADIO = new V3(.8, 1.0, -2.1), CASSETTE = new V3(.3, .9, -1.75),
  WESTDOOR = new V3(-3.3, 1.3, 0), CORR_E = new V3(4.2, 1.3, 0), GENPOS = new V3(11, 0, -7.0);
const wait = ms => new Promise(r => setTimeout(r, ms));
const chk = () => { if (S.abort) throw 'abort'; };
async function until(c, ms = 1e9) { const t0 = performance.now(); while (!c()) { await wait(60); chk(); if (performance.now() - t0 > ms) return false; } return true; }
const sleep = ms => until(() => false, ms);
const bg = fn => { fn().catch(e => { if (e !== 'abort') console.error(e); }); };
let lastRoomId = 'ops';
function roomId() { for (const r of ROOMS) if (P.x > r.x0 && P.x < r.x1 && P.z > r.z0 && P.z < r.z1) { lastRoomId = r.id; return r.id; } return lastRoomId; }
const looked = (pos, deg = 38, maxd = 40) => { const dx = pos.x - P.x, dz = pos.z - P.z, d = Math.hypot(dx, dz); if (d > maxd) return false; return ((dx * -Math.sin(P.yaw) + dz * -Math.cos(P.yaw)) / (d || 1)) > Math.cos(deg * Math.PI / 180); };

/* ---- audio helpers ---- */
function setPan(p, v) { if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; } else p.setPosition(v.x, v.y, v.z); }
function mkPan(pos, ref = 1.4, roll = 1) { const p = AC.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 90; setPan(p, pos); return p; }
function voice(id, o = {}) {
  const b = VB[id] || AB[id]; if (!b) { console.warn('no audio', id); return {stop() {}, done: Promise.resolve(), g: {gain: {setTargetAtTime() {}}}}; }
  const s = AC.createBufferSource(); s.buffer = b; if (o.loop) s.loop = true; if (o.rate) s.playbackRate.value = o.rate;
  const g = AC.createGain(); g.gain.value = o.gain ?? 1; s.connect(g); let out = g, pan = null;
  if (o.pos) { pan = mkPan(o.pos, o.ref ?? 1.4, o.roll ?? 1); g.connect(pan); out = pan; }
  out.connect(master); if (o.wet) { const w = AC.createGain(); w.gain.value = o.wet; g.connect(w); w.connect(wetBus); }
  const h = {s, g, pan, done: new Promise(r => { s.onended = () => { S.voices.delete(h); r(); }; }), stop() { try { s.stop(); } catch (e) {} }};
  if (!o.keep) S.voices.add(h); s.start(); return h;
}
const fadeG = (h, v, t) => { try { h.g.gain.setTargetAtTime(v, AC.currentTime, t); } catch (e) {} };
function knock(pos, n = 3, gap = 380, vol = 1.6) {
  for (let i = 0; i < n; i++) setTimeout(() => { if (S.abort || !AC) return; const p = mkPan(pos, 1.5, 1); p.connect(master); noiseBurst(.28, 120, vol, .8, p); beep(62, .22, vol * .35); }, i * gap);
}
function bones(pos, n = 8) { for (let i = 0; i < n; i++) setTimeout(() => { if (S.abort || !AC) return; const p = mkPan(pos.clone().add(new V3((Math.random() - .5) * 2, 0, (Math.random() - .5) * 2)), 1.5, 1); p.connect(master); noiseBurst(.05, 2400 + Math.random() * 1800, .8, 6, p); }, i * (60 + Math.random() * 130)); }
function showSub(who, text) { if (!S.subs) { $('sub').innerHTML = ''; return; } $('sub').innerHTML = '<span><b>' + who + '</b>' + text + '</span>'; }
let subK = '';
async function say(id, o = {}) {
  const L = LINES[id] || {who: '', text: ''}; subK = id; if (!o.silent) showSub(o.who || L.who.replace(/ \(.*\)/, ''), o.sub || L.text);
  const h = voice(id, o); await h.done; chk(); if (subK === id) $('sub').innerHTML = ''; return h;
}
function objApply() { const e = $('obj'); e.textContent = S.objText || ''; e.style.opacity = (S.showObj > 0 && S.objText) ? 1 : 0; }
function setObj(t) { S.objText = t; S.showObj = t ? 5 : 0; objApply(); }
async function titleCard(a, b, ms = 3000) { $('title').innerHTML = '<small>' + a + '</small>' + b; $('title').style.opacity = 1; await sleep(ms); $('title').style.opacity = 0; await sleep(700); }
function fadeTo(v, s = 2.5) { const f = $('fade'); f.style.transition = 'opacity ' + s + 's'; f.style.opacity = v; return sleep(s * 1000); }
function note(t, ms = 7000) { const e = $('note'); e.innerHTML = t; e.style.display = 'block'; clearTimeout(note.t); note.t = setTimeout(() => e.style.display = 'none', ms); }
function setPower(v) { S.base = v; }
function flicker(sec) { S.flick = sec; }

/* ---- interactables ---- */
const INT = []; let curInt = null, holdT = 0;
function addInt(o) { const it = Object.assign({r: 1.8, hold: 0, label: 'Use', active: true, used: false}, o); INT.push(it); return it; }
function useInt(it) { it.active = !!it.repeat; it.used = true; holdT = 0; if (it.onUse) it.onUse(); }
function findInt() {
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw); let best = null, bd = 1e9;
  for (const it of INT) { if (!it.active) continue; const dx = it.pos.x - P.x, dz = it.pos.z - P.z, d = Math.hypot(dx, dz); if (d > it.r) continue; if (d > 1.0 && (dx * fx + dz * fz) / (d || 1) < .35) continue; if (d < bd) { bd = d; best = it; } }
  return best;
}
function interactKey() { if (P.hidden) { leaveHide(); return; } if (curInt && !curInt.hold) { useInt(curInt); return; } if (!curInt) interact(); }
async function waitInt(o) { const it = addInt(o); await until(() => it.used); return it; }
async function ringAnswer(pos, label, lamp) {
  const ring = voice('phone_ring', {pos, loop: true, gain: 1.0, ref: 2, wet: .25});
  if (lamp) { phoneLamp.i = 10; phoneLamp.f = t => Math.sin(t * 10) > 0 ? 1 : .06; }
  const it = addInt({pos, r: 2.6, label}); await until(() => it.used);
  ring.stop(); if (lamp) { phoneLamp.i = 0; phoneLamp.f = () => 1; }
}

/* ---- footsteps walker ---- */
function walkerStart(p0, gain = 2.8) {
  walkerStop(); const s = AC.createBufferSource(); s.buffer = AB.footsteps; s.loop = true; s.playbackRate.value = .93;
  const g = AC.createGain(); g.gain.value = 0; const pan = mkPan(p0, 1.2, 1.2); s.connect(g); g.connect(pan); pan.connect(master); s.start();
  S.walker = {s, g, pan, pos: p0.clone(), mode: 'hold', path: null, gainT: gain, t: 0, r: 1.1};
}
function walkerPath(pts, secs) { const w = S.walker; let len = 0; const segs = []; for (let i = 1; i < pts.length; i++) { const l = pts[i].distanceTo(pts[i - 1]); segs.push(l); len += l; } w.path = {pts, segs, len, v: len / secs, d: 0}; w.mode = 'path'; }
function walkerOrbit(r = 1.1) { const w = S.walker; if (!w) return; w.mode = 'orbit'; w.r = r; w.t = 0; }
function walkerStop() { if (S.walker) { try { S.walker.s.stop(); } catch (e) {} S.walker = null; } }
function walkerTick(dt) {
  const w = S.walker; if (!w) return; w.t += dt;
  if (w.mode === 'path' && w.path) { const p = w.path; p.d = Math.min(p.len, p.d + p.v * dt); let d = p.d, i = 0; while (i < p.segs.length - 1 && d > p.segs[i]) { d -= p.segs[i]; i++; } const u = p.segs[i] ? Math.min(1, d / p.segs[i]) : 1; w.pos.lerpVectors(p.pts[i], p.pts[i + 1], u); }
  else if (w.mode === 'orbit') { const a = Math.sin(w.t * .6) * .8; w.pos.set(P.x + Math.sin(P.yaw + a) * w.r, .2, P.z + Math.cos(P.yaw + a) * w.r); }
  setPan(w.pan, w.pos); w.g.gain.value += (w.gainT - w.g.gain.value) * Math.min(1, dt * 3);
  if (S.turnWatch) { const dx = w.pos.x - P.x, dz = w.pos.z - P.z, d = Math.hypot(dx, dz) || 1; if ((dx * -Math.sin(P.yaw) + dz * -Math.cos(P.yaw)) / d > .55) S.turned = true; }
}

/* ---- ghost silhouettes ---- */
const GH = {}; let ghost = null;
async function ghostLoad() { for (const n of ['Zombie_Basic', 'Characters_Lis']) GH[n] = await loader.loadAsync('models/ghost_' + n + '.glb'); }
const ghostMat = new THREE.MeshBasicMaterial({color: 0x000000});
function ghostShow(n, x, z, fx, fz) {
  ghostHide(true); const src = GH[n]; if (!src) return; const obj = SU.clone(src.scene);
  obj.traverse(m => { if (m.isMesh) { m.material = ghostMat; m.castShadow = false; m.frustumCulled = false; } });
  const bb = new THREE.Box3().setFromObject(obj), s = 1.75 / Math.max(.1, bb.max.y - bb.min.y), wrap = new THREE.Group(); wrap.add(obj); obj.position.y = -bb.min.y;
  wrap.scale.set(s * .82, s * 1.12, s * .82); wrap.position.set(x, 0, z); wrap.rotation.y = Math.atan2(fx - x, fz - z);
  const mixer = new THREE.AnimationMixer(obj), clip = src.animations.find(a => /^idle$/i.test(a.name)) || src.animations[0]; if (clip) mixer.clipAction(clip).play();
  scene.add(wrap); ghost = {wrap, mixer, seen: 0, age: 0};
}
function ghostHide(silent) { if (!ghost) return; scene.remove(ghost.wrap); ghost = null; if (!silent && AC) noiseBurst(.35, 80, .7, .7); }
function ghostTick(dt) {
  if (!ghost) return; ghost.age += dt; ghost.mixer.update(dt);
  const dx = ghost.wrap.position.x - P.x, dz = ghost.wrap.position.z - P.z, d = Math.hypot(dx, dz), dot = (dx * -Math.sin(P.yaw) + dz * -Math.cos(P.yaw)) / (d || 1);
  if (dot > .8 && d < 30) ghost.seen += dt;
  if (ghost.seen > .55 || d < 3 || ghost.age > 15 || (flashOn && dot > .93 && d < 14)) ghostHide(false);
}

/* ---- wheelchair that moves when unobserved ---- */
const WH = [[16.2, -.85, 2.55], [12.4, .6, 2.2], [8.6, -.55, 2.9], [5.4, .65, 2.45]];
function moveWheel(i) {
  if (!WHEEL) return; const [x, z, r] = WH[i]; WHEEL.position.x = x; WHEEL.position.z = z; WHEEL.rotation.y = r;
  const c = WHEEL.userData.col; if (c) { c.x0 = x - .4; c.x1 = x + .4; c.z0 = z - .4; c.z1 = z + .4; }
}
const wheelPos = () => new V3(WHEEL.position.x, 0, WHEEL.position.z);
async function wheelStep(i) { await until(() => !looked(wheelPos(), 62, 60)); moveWheel(i); }

/* ---- tapes ---- */
function makeTape(x, y, z, roomKey) {
  const g = new THREE.Group(); g.add(new THREE.Mesh(new RoundedBoxGeometry(.108, .068, .016, 2, .004), plain(0x1a1a1c, .5, .2)));
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(.07, .03), new THREE.MeshStandardMaterial({color: 0xd8d0b0, roughness: .7, emissive: 0x3a3626})); lab.position.set(0, .008, .0085); g.add(lab);
  for (const sx of [-1, 1]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .002, 12), plain(0xdddddd, .3, .4)); r.rotation.x = Math.PI / 2; r.position.set(sx * .025, -.012, .0085); g.add(r); }
  g.position.set(x, y, z); g.rotation.set(-Math.PI / 2 + .05, 0, .6); (GROUPS[roomKey] || scene).add(g); return g;
}

/* ---- night control ---- */
function save(n) { try { localStorage.setItem('ls_night', String(Math.max(n, +localStorage.getItem('ls_night') || 1))); } catch (e) {} }
function saved() { try { return Math.min(5, +localStorage.getItem('ls_night') || 1); } catch (e) { return 1; } }
let tapesGroup = [];
function resetWorld(n) {
  INT.length = 0; curInt = null; holdT = 0; $('hold').style.display = 'none';
  for (const d of DOORS) { const op = d.name === 'ops-east' ? 1 : 0; d.target = d.open = op; d.col.off = !!op; d.shake = 0; d.locked = d.name === 'west' || (d.name === 'stair' && n === 5 && false); }
  P.x = 0; P.z = 1.2; P.yaw = 0; P.pitch = -.04; P.vx = P.vz = 0; S.base = 1; S.flick = 0; S.deskOff = false; S.monLine = 0; S.freeze = false; S.mute = false; S.turnWatch = false; S.turned = null;
  flashOn = false; flash.visible = false; phoneLamp.i = 0; phoneLamp.f = () => 1; ghostHide(true); moveWheel(0);
  for (const t of tapesGroup) t.parent && t.parent.remove(t); tapesGroup = [];
  $('sub').innerHTML = ''; setObj(''); $('note').style.display = 'none'; $('choice').style.display = 'none'; $('ending').style.display = 'none'; if (master) master.gain.value = .9;
  entReset(); setupHides(); placeBatteries(n);
}
function stopAll() {
  for (const h of [...S.voices]) h.stop(); S.voices.clear(); walkerStop(); ghostHide(true);
}
async function abortNight() { S.abort = true; stopAll(); try { await S.current; } catch (e) {} S.abort = false; stopAll(); }
async function startNight(n) {
  if (S.current) await abortNight();
  S.night = n; const f = $('fade'); f.style.transition = 'none'; f.style.opacity = 1; resetWorld(n);
  const names = ['First Call', 'The Dead Voice', 'The Recordings', 'Below', 'The Listener']; const fns = [n1, n2, n3, n4, n5];
  S.current = (async () => {
    try { await titleCard('NIGHT ' + n, names[n - 1]); fadeTo(0, 2.5); await fns[n - 1](); if (n < 5) await endNight(n); }
    catch (e) { if (e !== 'abort') console.error(e); }
  })();
}
async function endNight(n) {
  setObj(''); $('sub').innerHTML = ''; await fadeTo(1, 2.2); save(n + 1); await sleep(600);
  $('title').innerHTML = '<small>NIGHT ' + n + '</small>complete'; $('title').style.opacity = 1; await sleep(2600); $('title').style.opacity = 0;
  setTimeout(() => startNight(n + 1), 0);
}
function ending(code, title, text) {
  setObj(''); $('sub').innerHTML = ''; const e = $('ending'); e.innerHTML = '<div><h1>' + code + '</h1><p style="font-size:20px;color:#e8dede">' + title + '</p><p>' + text + '</p><button id="endbtn">Back to menu</button></div>'; e.style.display = 'flex'; $('endbtn').onclick = () => location.reload();
  try { localStorage.setItem('ls_night', '5'); } catch (x) {}
}

/* ================= NIGHT 1: First Call ================= */
async function n1() {
  setObj('Listen to the radio.'); await sleep(1500);
  await say('1a', {pos: RADIO, gain: 1.6, wet: .3}); await sleep(2200);
  setObj('Answer the red wall phone.'); await ringAnswer(PHONE_POS, 'Answer', true); setObj('');
  S.monLine = 1; const st = voice('static', {loop: true, gain: .05});
  await sleep(500); await say('1b', {pos: PHONE_POS, gain: 1.8}); await sleep(600); await say('1c', {gain: 1.1}); await sleep(500);
  const T = VB['1d'].duration + VB['1e'].duration + VB['1f'].duration + 1.2;
  walkerStart(new V3(24, .2, -.2)); walkerPath([new V3(24, .2, -.2), new V3(5, .2, .2), new V3(2.6, .2, .1)], T);
  await say('1d', {pos: PHONE_POS, gain: 1.8}); await sleep(500);
  const hb = voice('heartbeat', {loop: true, gain: 0}); fadeG(hb, .5, 4);
  await say('1e', {gain: 1.1}); await sleep(400); await say('1f', {pos: PHONE_POS, gain: 1.8});
  S.walker.gainT = 0; st.stop(); S.monLine = 0; await sleep(1800);
  walkerOrbit(1.15); const bp = new V3(P.x + Math.sin(P.yaw) * 1.0 + Math.cos(P.yaw) * .5, 1.2, P.z + Math.cos(P.yaw) * 1.0 - Math.sin(P.yaw) * .5);
  S.walker.gainT = 2.8; setObj('Do not turn around.');
  await say('1g', {pos: bp, gain: 2.6, wet: .2}); S.turned = null; S.turnWatch = true;
  await until(() => S.turned === true, 9500); S.turnWatch = false;
  if (S.turned) {
    walkerStop(); hb.stop(); master.gain.value = 0; S.flick = 3; await sleep(3300); master.gain.value = .9;
    const bp2 = new V3(P.x + Math.cos(P.yaw) * .3, 1.4, P.z - Math.sin(P.yaw) * .3); const br = voice('breath', {pos: bp2, gain: 4, wet: .4}); await sleep(3200); br.stop();
  } else { walkerStop(); fadeG(hb, .9, .2); await sleep(3800); hb.stop(); }
  setObj(''); S.monLine = 3; await sleep(800); await say('1h', {pos: RADIO, gain: 1.6, wet: .3}); setObj('Line 3 is lit on the monitor.'); await sleep(3500);
}

/* ================= NIGHT 2: The Dead Voice ================= */
async function n2() {
  moveWheel(1); setPower(.85); setObj('Wait by the phone.'); await sleep(5000);
  setObj('Answer the phone.'); await ringAnswer(PHONE_POS, 'Answer', true); setObj('');
  S.monLine = 1; const st = voice('static', {loop: true, gain: .09});
  await say('2a', {pos: PHONE_POS, gain: 1.8}); await sleep(500); await say('2b', {gain: 1.1}); await sleep(400); await say('2c', {pos: PHONE_POS, gain: 1.8});
  S.flick = 1.6; await say('2d', {pos: CORR_E, gain: 2.0, wet: .5, sub: '[ a voice whispers backwards ]', who: 'Lis'}); await sleep(500);
  await say('2e', {pos: PHONE_POS, gain: 1.8}); await sleep(500); await say('2f', {gain: 1.1}); await sleep(500); await say('2g', {pos: PHONE_POS, gain: 1.8});
  st.stop(); S.monLine = 0; await sleep(1200); await say('2h', {pos: RADIO, gain: 1.6, wet: .3});
  setObj('Find the call log in the Medical Bay.'); entLevel(1);
  bg(async () => { await until(() => roomId() === 'cor'); await sleep(1500); ghostShow('Characters_Lis', 24.5, 0, 4, 0); });
  await waitInt({pos: new V3(20.6, .5, -3.4), r: 1.7, label: 'Read the call log'});
  note('<b>CALL LOG</b><br>03:41 &nbsp; Caller: L. &nbsp; Location: this building<br>03:58 &nbsp; Caller: L. &nbsp; Location: this building<br>04:12 &nbsp; Caller: L. &nbsp; Location: <i>behind you</i>');
  S.flick = 2; voice('2d', {pos: new V3(P.x, 1.3, P.z + 1.2), gain: 1.4, wet: .5}); await sleep(2500);
  setObj('Return to the Control Room.'); bg(async () => { await wheelStep(2); });
  await until(() => roomId() === 'ops'); await sleep(2500);
  entLevel(0); setObj('The phone is ringing again.'); await ringAnswer(PHONE_POS, 'Answer', true); setObj('');
  const st2 = voice('static', {loop: true, gain: .12}); S.flick = 3; S.monLine = 3; await sleep(3500); st2.stop(); await sleep(1200);
}

/* ================= NIGHT 3: The Recordings ================= */
async function n3() {
  moveWheel(2); setObj('Listen to the radio.'); await sleep(2000); await say('3a', {pos: RADIO, gain: 1.6, wet: .3});
  const spots = [{k: 'sto', p: new V3(16.0, .63, 2.6), n: 'Storage'}, {k: 'med', p: new V3(20.6, .48, -3.45), n: 'Medical Bay'}, {k: 'dorm', p: new V3(21.8, .5, 7.4), n: 'Dormitory'}];
  let got = 0; setPower(.72); entLevel(2); setObj('Find the 3 tapes: Storage, Medical Bay, Dormitory. (0/3)');
  const tapes = spots.map(s => { const t = makeTape(s.p.x, s.p.y, s.p.z, s.k); tapesGroup.push(t); return t; });
  const its = spots.map((s, i) => addInt({pos: s.p, r: 1.7, label: 'Take the tape', onUse: () => { tapes[i].visible = false; got++; setObj(got < 3 ? 'Find the 3 tapes: Storage, Medical Bay, Dormitory. (' + got + '/3)' : 'Return to the Control Room and play the tapes.'); noiseBurst(.1, 3000, .6, 3); } }));
  bg(async () => { await until(() => got >= 1); await until(() => roomId() === 'cor'); await sleep(1200); ghostShow('Zombie_Basic', 23, 0, 4, 0); });
  bg(async () => { await until(() => got >= 2); await sleep(2500); knock(new V3(P.x - 3, 1.2, P.z), 3, 450, 1.2); await wheelStep(3); });
  bg(async () => { await until(() => got >= 3); S.flick = 2.2; await sleep(500); walkerStart(new V3(P.x, .2, P.z + 6)); walkerOrbit(3.2); S.walker.gainT = 1.8; await sleep(7000); walkerStop(); });
  await until(() => got >= 3); await until(() => roomId() === 'ops');
  entLevel(0); setObj('Play the tapes on the cassette player (desk).'); await waitInt({pos: CASSETTE, r: 2.0, label: 'Play the tapes'}); setObj('');
  await sleep(600); await say('3b', {pos: CASSETTE, gain: 1.9}); await sleep(700); await say('3c', {pos: CASSETTE, gain: 1.9}); await sleep(500);
  S.flick = 1.2; await say('3d', {pos: CASSETTE, gain: 1.9}); await sleep(700); await say('3e', {gain: 1.1}); await sleep(900);
  S.deskOff = true; await say('3f', {pos: CASSETTE, gain: 2.2, wet: .3}); await sleep(2500);
}

/* ================= NIGHT 4: Below ================= */
async function n4() {
  moveWheel(3); setPower(0); phoneLamp.i = 3; phoneLamp.f = t => .6 + .4 * Math.sin(t * 2); S.deskOff = true; S.monLine = 0;
  await sleep(2500); await say('4a', {pos: RADIO, gain: 1.7, wet: .4}); setObj('Restart the generator (Generator Room). Press F for your flashlight.'); entLevel(3);
  bg(async () => { await until(() => roomId() === 'cor'); await sleep(1500); walkerStart(new V3(P.x + 6, .2, 0)); walkerOrbit(4); S.walker.gainT = 1.6; await sleep(9000); walkerStop(); });
  bg(async () => { await until(() => roomId() === 'cor' && P.x > 9); bones(new V3(12, 1, 5), 12); await sleep(5000); ghostShow('Zombie_Basic', 24, 0, 4, 0); });
  await until(() => roomId() === 'gen'); setObj('Hold E at the generator to restart it.');
  const gi = addInt({pos: GENPOS, r: 2.4, hold: 6, label: 'Hold E: restart the generator', onUse: () => { }});
  bg(async () => { while (!gi.used) { knock(new V3(P.x - 5, 1.2, P.z + 1), 2, 500, .9); await sleep(4500); } });
  await until(() => gi.used);
  S.flick = 3; setPower(1); await sleep(500); noiseBurst(.6, 70, 1.2, .5); setObj('Return to the Control Room.');
  await until(() => roomId() === 'ops'); entLevel(0); setObj(''); S.freeze = false; await sleep(2500);
  setPower(.35); S.flick = 2;
  knock(WESTDOOR, 3, 500, 2.0); await sleep(2200); await say('4b', {pos: WESTDOOR, gain: 2.2, wet: .3}); S.flick = 1;
  await say('4c', {pos: RADIO, gain: 1.7, wet: .3}); knock(WESTDOOR, 5, 260, 2.6); DOORS.find(d => d.name === 'west').shake = 1.2; await sleep(1800);
  await say('4d', {pos: WESTDOOR, gain: 2.6, wet: .5}); await say('4e', {pos: RADIO, gain: 1.6, wet: .3}); S.flick = 4; setPower(.1);
  await say('4f', {pos: WESTDOOR, gain: 3.0, wet: .6}); knock(WESTDOOR, 4, 700, 3.0); DOORS.find(d => d.name === 'west').shake = 2.0; await sleep(3500);
}

/* ================= NIGHT 5: The Listener ================= */
async function n5() {
  moveWheel(3); setPower(.7); entLevel(3); setObj('Reach the surface access at the end of the corridor.');
  const hb = voice('heartbeat', {loop: true, gain: .2}); const dr = voice('infrasound', {loop: true, gain: .5});
  bg(async () => { while (S.night === 5 && !S.abort) { const k = Math.max(0, Math.min(1, (P.x - 3) / 22)); if (!S.flick) setPower(.75 - k * .55 + (roomId() === 'stair' ? .15 : 0)); fadeG(hb, .2 + k * .9, .4); await sleep(250); } });
  bg(async () => { await until(() => roomId() === 'cor'); await sleep(2500); ghostShow('Characters_Lis', 25, 0, 4, 0); await sleep(5000); walkerStart(new V3(P.x + 7, .2, 0)); walkerOrbit(3.5); S.walker.gainT = 1.6; await sleep(8000); walkerStop(); });
  bg(async () => { await until(() => P.x > 13); S.flick = 2; knock(new V3(P.x + 4, 1.2, 0), 3, 400, 1.0); });
  await until(() => roomId() === 'stair'); entLevel(0); walkerStop(); ghostHide(true); S.flick = 0; setPower(.45);
  await sleep(2500); setObj('The payphone is ringing.'); await ringAnswer(PAYPHONE, 'Answer the payphone'); setObj('');
  await sleep(600); await say('5a', {gain: 1.1}); await sleep(900);
  await say('5b', {pos: PAYPHONE, gain: 2.2, wet: .3}); await sleep(500); await say('5c', {pos: PAYPHONE, gain: 2.2, wet: .3}); await sleep(600); S.flick = 1.5;
  await say('5d', {pos: PAYPHONE, gain: 2.2, wet: .3}); await sleep(700); await say('5e', {pos: PAYPHONE, gain: 1.8}); await sleep(700); await say('5f', {pos: PAYPHONE, gain: 2.4, wet: .5});
  // decision
  setObj(''); S.freeze = true; let pick = 0; const box = $('choice');
  box.innerHTML = '<b>What do you do?</b><button data-c="1">1. Hang up</button><button data-c="2">2. Answer</button><button data-c="3">3. Do nothing</button><small id="chtime"></small>'; box.style.display = 'block';
  box.querySelectorAll('button').forEach(b => b.onclick = () => { pick = +b.dataset.c; });
  window.__choose = v => { pick = v; };
  const kh = e => { if (e.key === '1' || e.key === '2' || e.key === '3') pick = +e.key; }; addEventListener('keydown', kh);
  const t0 = performance.now(); while (!pick && performance.now() - t0 < 25000) { $('chtime').textContent = Math.ceil(25 - (performance.now() - t0) / 1000) + 's'; await wait(100); chk(); }
  removeEventListener('keydown', kh); box.style.display = 'none'; if (!pick) pick = 3;
  hb.stop(); dr.stop(); S.freeze = false;
  if (pick === 1) { await say('5g', {pos: PAYPHONE, gain: 2.4, wet: .5}); await sleep(900); const r = voice('phone_ring', {pos: PAYPHONE, gain: 1, ref: 2, loop: true}); await sleep(3800); r.stop(); await fadeTo(1, 2.4); ending('ENDING A', 'The Loop', 'You hung up. The phone started to ring again. It always does. Every night you answer, and every night you forget.'); }
  else if (pick === 2) { S.flick = 2; await say('5h', {pos: PAYPHONE, gain: 1.9}); await sleep(900); await fadeTo(1, 2.6); ending('ENDING B', 'The Warning', 'You told yourself not to take the night shift. Somewhere, another Matt stayed home. Somewhere, the phone stopped ringing.'); }
  else { const d = DOORS.find(x => x.name === 'stair'); d.target = 1; creak(); await say('5i', {pos: RADIO, gain: 1.7, wet: .4}); await sleep(2500); await fadeTo(1, 3); ending('ENDING C', 'Inside', 'You did nothing. The door opened from the inside. It had always been open. You were never alone down here.'); }
}

/* ---- per-frame story hooks ---- */
function storyTick(dt, T) {
  S.flick > 0 && (S.flick = Math.max(0, S.flick - dt)); if (S.showObj > 0) { S.showObj -= dt; if (S.showObj <= 0) objApply(); }
  S.power = S.flick > 0 ? (hash(Math.floor(T * 17)) > .5 ? S.base : S.base * .04) : S.base;
  walkerTick(dt); ghostTick(dt);
  curInt = started && !P.hidden ? findInt() : null;
  const hd = $('hold');
  if (curInt && curInt.hold && keys.KeyE) { holdT += dt; hd.style.display = 'block'; hd.firstElementChild.style.width = Math.min(100, holdT / curInt.hold * 100) + '%'; if (holdT >= curInt.hold) useInt(curInt); }
  else { holdT = Math.max(0, holdT - dt * 2); hd.style.display = 'none'; }
}

/* ================= ENTITY: the Listener (hears you, hunts you) ================= */
const COORD = {o4: [.9, -1.6], o3: [-1.8, -1.2], o2: [0, .8], o1: [2.4, 0], c1: [4.6, 0], c2: [8, 0], c3: [11, 0], c3s: [12, 0], c4: [15, 0], c5: [18.5, 0], c6: [21.5, 0], c6s: [22, 0], c7: [25, 0],
  g1: [11, -4], g2: [8.9, -7.3], g3: [13.5, -7.5], m1: [21.5, -4], m2: [20.2, -4.6], m3: [23.4, -6], s1: [12, 4], s2: [10, 7], s3: [15.2, 4.4], d1: [22, 4], d2: [20.6, 4.4], d3: [23.5, 6.5], st1: [28.5, 0], st2: [30, -1.5]};
const EDG = [['o4', 'o2'], ['o3', 'o2'], ['o2', 'o1'], ['o1', 'c1', 'ops-east'], ['c1', 'c2'], ['c2', 'c3'], ['c3', 'c3s'], ['c3', 'c4'], ['c4', 'c5'], ['c5', 'c6'], ['c6', 'c6s'], ['c6', 'c7'],
  ['c3', 'g1', 'gen'], ['g1', 'g2'], ['g1', 'g3'], ['c6', 'm1', 'med'], ['m1', 'm2'], ['m1', 'm3'], ['c3s', 's1', 'storage'], ['s1', 's2'], ['s1', 's3'], ['c6s', 'd1', 'dorm'], ['d1', 'd2'], ['d1', 'd3'], ['c7', 'st1', 'stair'], ['st1', 'st2']];
const ADJ = {}; for (const k in COORD) ADJ[k] = [];
for (const [a, b, d] of EDG) { ADJ[a].push({to: b, door: d}); ADJ[b].push({to: a, door: d}); }
const doorByName = n => DOORS.find(d => d.name === n);
function nodeNear(x, z) { let b = null, bd = 1e9; for (const id in COORD) { const d = Math.hypot(COORD[id][0] - x, COORD[id][1] - z); if (d < bd) { bd = d; b = id; } } return b; }
function pathFind(a, b) {
  const dist = {}, prev = {}, Qs = new Set(Object.keys(COORD)); for (const k of Qs) dist[k] = 1e9; dist[a] = 0;
  while (Qs.size) {
    let u = null; for (const k of Qs) if (u === null || dist[k] < dist[u]) u = k; if (dist[u] >= 1e9) break; Qs.delete(u); if (u === b) break;
    for (const e of ADJ[u]) { if (e.door && doorByName(e.door).locked) continue; const w = dist[u] + Math.hypot(COORD[u][0] - COORD[e.to][0], COORD[u][1] - COORD[e.to][1]); if (w < dist[e.to]) { dist[e.to] = w; prev[e.to] = u; } }
  }
  if (dist[b] >= 1e9) return null; const ids = [b]; while (ids[0] !== a) ids.unshift(prev[ids[0]]); return {ids, len: dist[b]};
}
function roomIdAt(x, z) { for (const r of ROOMS) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r.id; return ''; }

const ENT = {on: false, level: 0, state: 'idle', pos: new V3(), node: 'st2', path: [], timer: 0, sight: 0, lost: 0, mesh: null, mixer: null, acts: {}, snd: null, wait: 0, hearT: 0, sniffT: 0, face: 0, exposed: 0, cur: ''};
const LV = [null, {hear: 10, patrol: 1.0, chase: 2.0, sniff: 70}, {hear: 16, patrol: 1.2, chase: 2.5, sniff: 45}, {hear: 24, patrol: 1.4, chase: 2.9, sniff: 25}];
const HIDES = [
  {id: 'desk', label: 'Hide under the desk', pos: [0, -1.5], hp: [0, -2.0], ex: [-1.0, -1.1], yaw: Math.PI, node: 'o4'},
  {id: 'dorm', label: 'Hide under the bed', pos: [21.0, 3.6], hp: [19.9, 3.6], ex: [21.3, 3.6], yaw: -Math.PI / 2, node: 'd2'},
  {id: 'med', label: 'Hide under the bed', pos: [20.2, -4.2], hp: [19.3, -4.2], ex: [20.6, -4.3], yaw: -Math.PI / 2, node: 'm2'},
  {id: 'sto', label: 'Hide behind the crates', pos: [15.2, 3.9], hp: [16.4, 3.9], ex: [14.8, 3.9], yaw: Math.PI / 2, node: 's3'},
  {id: 'gen', label: 'Hide behind the barrels', pos: [9.4, -7.0], hp: [7.6, -8.2], ex: [9.4, -6.9], yaw: -Math.PI / 2, node: 'g2'}];
function setupHides() { for (const h of HIDES) addInt({pos: new V3(h.pos[0], 1, h.pos[1]), r: 1.5, label: h.label, repeat: true, onUse: () => enterHide(h)}); }
function enterHide(h) { P.hidden = h; P.x = h.hp[0]; P.z = h.hp[1]; P.yaw = h.yaw; P.pitch = -.1; P.vx = P.vz = 0; P.spike = 0; note('Hold <b>SPACE</b> to hold your breath. Press <b>E</b> to come out.', 3500); }
function leaveHide() { if (!P.hidden) return; const h = P.hidden; P.hidden = null; P.x = h.ex[0]; P.z = h.ex[1]; }
const BAT_SPOTS = [['ops', 2.9, -1.0], ['cor', 9.5, .95], ['gen', 8.9, -8.0], ['sto', 16, 7.6], ['med', 23.8, -6.6], ['dorm', 24.2, 6.5], ['stair', 29, 1.9]];
function placeBatteries(n) {
  for (let i = 0; i < 3; i++) {
    const s = BAT_SPOTS[(n * 3 + i * 2) % BAT_SPOTS.length];
    const m = new THREE.Mesh(new THREE.CylinderGeometry(.017, .017, .07, 10), new THREE.MeshStandardMaterial({color: 0x2a6a2a, emissive: 0x1a4a1a, roughness: .5, metalness: .6}));
    m.rotation.z = Math.PI / 2; m.position.set(s[1], .02, s[2]); (GROUPS[s[0]] || scene).add(m); tapesGroup.push(m);
    addInt({pos: new V3(s[1], .3, s[2]), r: 1.5, label: 'Take the battery', onUse: () => { m.visible = false; P.bat = Math.min(1, P.bat + .6); P.spike = Math.max(P.spike, .3); toast('Flashlight battery restored'); }});
  }
}
function entReset() { entDespawn(); ENT.level = 0; P.hidden = null; P.bat = 1; P.spike = 0; P.stam = 1; S.caught = false; }
function entLevel(l) { ENT.level = l; if (l === 0) entDespawn(); else if (!ENT.on) entSpawn(); }
function entSpawn() {
  const pn = nodeNear(P.x, P.z); let best = null, bl = -1;
  for (const id in COORD) { const p = pathFind(pn, id); if (p && p.len > bl && p.len > 14) { bl = p.len; best = id; } }
  if (!best) return; ENT.node = best; ENT.pos.set(COORD[best][0], 0, COORD[best][1]); ENT.on = true; ENT.state = 'patrol'; ENT.path = []; ENT.timer = 0; ENT.sight = 0; ENT.sniffT = 0; ENT.lost = 0;
  const g = GH.Zombie_Basic; if (g) {
    const obj = SU.clone(g.scene); obj.traverse(m => { if (m.isMesh) { m.material = ghostMat; m.castShadow = false; m.frustumCulled = false; } });
    const bb = new THREE.Box3().setFromObject(obj), s = 1.95 / Math.max(.1, bb.max.y - bb.min.y), wrap = new THREE.Group(); wrap.add(obj); obj.position.y = -bb.min.y; wrap.scale.set(s * .8, s * 1.1, s * .8);
    ENT.mixer = new THREE.AnimationMixer(obj); ENT.acts = {}; for (const c of g.animations) ENT.acts[c.name] = ENT.mixer.clipAction(c); ENT.cur = ''; scene.add(wrap); ENT.mesh = wrap;
  }
  ENT.snd = {steps: voice('footsteps', {pos: ENT.pos, loop: true, gain: 0, ref: 1.2, roll: 1.2}), rasp: voice('breath', {pos: ENT.pos, loop: true, gain: 0, ref: 1.5}), heart: voice('heartbeat', {loop: true, gain: 0})};
}
function entDespawn() {
  if (ENT.snd) { for (const k in ENT.snd) ENT.snd[k].stop(); ENT.snd = null; } if (ENT.mesh) { scene.remove(ENT.mesh); ENT.mesh = null; } ENT.on = false; ENT.state = 'idle'; ENT.path = [];
  if (S.drone) fadeG(S.drone, .38, .5);
}
function entSetPath(node, state, speedK = 1) { const p = pathFind(ENT.node, node); ENT.path = p ? p.ids.slice(1) : []; ENT.state = state; ENT.speedK = speedK; ENT.target = node; }
function playerNoise() { if (P.hidden) return P.held ? .03 : .2; const sp = Math.hypot(P.vx, P.vz); const n = sp < .3 ? .06 : P.crouch ? .15 : sp > 2.6 ? 1 : .42; return Math.min(1.2, n + P.spike); }
function canSee(ed) {
  if (P.hidden) return false; const inCor = (x, z) => x > 3.5 && x < 26 && Math.abs(z) < 1.3;
  if (inCor(ENT.pos.x, ENT.pos.z) && inCor(P.x, P.z)) return ed < (flashOn ? 18 : 7);
  const a = roomIdAt(ENT.pos.x, ENT.pos.z); return a && a === roomIdAt(P.x, P.z) && ed < (flashOn ? 12 : 6);
}
function entMove(dt, speed) {
  if (!ENT.path.length) return true; const nxt = ENT.path[0], tgt = COORD[nxt], e = ADJ[ENT.node].find(e => e.to === nxt);
  if (e && e.door) {
    const d = doorByName(e.door); if (d.locked) { ENT.path = []; return true; }
    if (d.open < .6) { ENT.wait += dt; if (ENT.wait > 1.1 && d.target === 0) { d.target = 1; const p = mkPan(new V3(d.x, 1.2, d.z), 1.5, 1); noiseBurst(.9, 520, .5, 6, p); } if (d.open < .6) return false; }
  }
  ENT.wait = 0; const dx = tgt[0] - ENT.pos.x, dz = tgt[1] - ENT.pos.z, dist = Math.hypot(dx, dz);
  if (dist < .15) { ENT.node = nxt; ENT.path.shift(); return !ENT.path.length; }
  ENT.pos.x += dx / dist * speed * dt; ENT.pos.z += dz / dist * speed * dt; ENT.face = Math.atan2(dx, dz); return false;
}
async function caught() {
  if (S.caught) return; S.caught = true; S.freeze = true; ENT.state = 'kill';
  const dx = ENT.pos.x - P.x, dz = ENT.pos.z - P.z; P.yaw = Math.atan2(-dx, -dz);
  noiseBurst(1.0, 90, 3, .6); noiseBurst(.6, 2500, 1.6, 4); beep(55, .8, .8); master.gain.setTargetAtTime(.12, AC.currentTime, .05);
  await wait(450); const f = $('fade'); f.style.transition = 'opacity .25s'; f.style.opacity = 1; await wait(1200);
  leaveHide(); P.hidden = null; P.x = 0; P.z = 1.2; P.yaw = 0; P.pitch = -.04; P.vx = P.vz = 0; const lvl = ENT.level; entDespawn(); S.flick = 0; master.gain.value = .9;
  await wait(900); f.style.transition = 'opacity 1.6s'; f.style.opacity = 0; S.freeze = false; S.caught = false;
  if (lvl) setTimeout(() => { if (ENT.level && !ENT.on && !S.abort) entSpawn(); }, 10000);
}
function entTick(dt, T) {
  P.spike = Math.max(0, P.spike - dt * 1.6);
  if (flashOn) { P.bat = Math.max(0, P.bat - dt / 210); if (P.bat <= 0) { flashOn = false; flash.visible = false; toast('The flashlight died'); } }
  const bat = $('bat'); bat.style.display = (flashOn || P.bat < .99) ? 'block' : 'none'; bat.firstElementChild.style.width = P.bat * 100 + '%';
  const br = $('breath');
  if (P.hidden) { if (keys.Space && P.stam > 0) { P.stam = Math.max(0, P.stam - dt / 6); P.held = true; } else { P.held = false; P.stam = Math.min(1, P.stam + dt / 12); } br.style.display = 'block'; br.firstElementChild.style.width = P.stam * 100 + '%'; }
  else { P.held = false; br.style.display = 'none'; }
  flash.intensity = (flashOn && P.bat < .2) ? 80 * (hash(Math.floor(T * 13)) > .5 ? 1 : .25) : 80;
  if (!ENT.on || S.freeze || S.caught) return;
  const L = LV[ENT.level], ed = Math.hypot(ENT.pos.x - P.x, ENT.pos.z - P.z), pn = nodeNear(P.x, P.z);
  // senses
  ENT.hearT -= dt;
  if (ENT.hearT <= 0) {
    ENT.hearT = .35; const p = pathFind(ENT.node, pn);
    if (p && ENT.state !== 'chase' && ENT.state !== 'check' && p.len < playerNoise() * L.hear) entSetPath(pn, 'investigate', 1.5);
    if (canSee(ed)) ENT.sight += .35; else ENT.sight = Math.max(0, ENT.sight - .5);
    if (ENT.sight > (flashOn ? .35 : .8) && ENT.state !== 'chase' && ENT.state !== 'check') { ENT.state = 'chase'; ENT.lost = 0; noiseBurst(.5, 1500, .6, 3); if (S.drone) fadeG(S.drone, 0, .05); setTimeout(() => S.drone && fadeG(S.drone, .38, 2), 2500); }
    if (ENT.state === 'chase') { ENT.path = (pathFind(ENT.node, pn) || {ids: [ENT.node]}).ids.slice(1); if (canSee(ed)) ENT.lost = 0; else ENT.lost += .35; if (ENT.lost > 5) { ENT.state = 'search'; ENT.timer = 12; } }
  }
  ENT.sniffT += dt; if (ENT.sniffT > L.sniff && ENT.state === 'patrol') { ENT.sniffT = 0; entSetPath(pn, 'investigate', 1.2); }
  // behaviour
  let speed = L.patrol, moving = false;
  if (ENT.state === 'patrol') {
    if (!ENT.path.length) { const ids = Object.keys(COORD).filter(k => k !== ENT.node); entSetPath(ids[Math.floor(Math.random() * ids.length)], 'patrol'); }
    moving = !entMove(dt, speed) || ENT.path.length > 0;
  } else if (ENT.state === 'investigate') { speed = L.patrol * 1.5; moving = true; if (entMove(dt, speed)) { ENT.state = 'search'; ENT.timer = 9 + Math.random() * 4; } }
  else if (ENT.state === 'search') {
    ENT.timer -= dt; speed = L.patrol * 1.1; moving = ENT.path.length > 0;
    if (!ENT.path.length) { const hs = HIDES.filter(h => h.node !== ENT.node && Math.hypot(COORD[h.node][0] - ENT.pos.x, COORD[h.node][1] - ENT.pos.z) < 14); const nb = ADJ[ENT.node]; const pick = (hs.length && Math.random() < .5) ? hs[Math.floor(Math.random() * hs.length)].node : nb[Math.floor(Math.random() * nb.length)].to; entSetPath(pick, 'search'); ENT.state = 'search'; }
    else entMove(dt, speed);
    if (ENT.timer <= 0) { ENT.state = 'patrol'; ENT.path = []; }
  } else if (ENT.state === 'chase') { speed = L.chase; moving = true; entMove(dt, speed); }
  else if (ENT.state === 'check') { moving = false; ENT.timer -= dt; if (P.hidden && !P.held) ENT.exposed += dt; if (ENT.exposed > .9) { caught(); return; } if (ENT.timer <= 0) { ENT.state = 'search'; ENT.timer = 8; ENT.path = []; } }
  // checking hiding spots
  if ((ENT.state === 'search' || ENT.state === 'patrol' || ENT.state === 'investigate') && P.hidden && ENT.node === P.hidden.node && Math.hypot(ENT.pos.x - COORD[ENT.node][0], ENT.pos.z - COORD[ENT.node][1]) < .3) { ENT.state = 'check'; ENT.timer = 3.4; ENT.exposed = 0; ENT.path = []; }
  // catch
  if (!P.hidden && ed < 1.05 && ENT.state !== 'kill') { caught(); return; }
  // presentation
  if (ENT.mesh) {
    ENT.mesh.position.set(ENT.pos.x, 0, ENT.pos.z); ENT.mesh.rotation.y = ENT.face; ENT.mesh.visible = ed < 24;
    const want = ENT.state === 'chase' ? 'Run' : (moving ? 'Walk' : 'Idle'); if (want !== ENT.cur && ENT.acts[want]) { const a = ENT.acts[want]; a.reset().play(); if (ENT.acts[ENT.cur]) ENT.acts[ENT.cur].crossFadeTo(a, .3, false); ENT.cur = want; } ENT.mixer.update(dt);
  }
  const sn = ENT.snd; if (sn) {
    setPan(sn.steps.pan, ENT.pos); setPan(sn.rasp.pan, new V3(ENT.pos.x, 1.5, ENT.pos.z));
    sn.steps.g.gain.value += (((moving && ed < 40) ? (ENT.state === 'chase' ? 2.6 : 1.7) : 0) - sn.steps.g.gain.value) * Math.min(1, dt * 6); sn.steps.s.playbackRate.value = ENT.state === 'chase' ? 1.3 : .85;
    sn.rasp.g.gain.value = Math.max(0, (12 - ed) / 12) * 2.4; sn.heart.g.gain.value = Math.max(0, (14 - ed) / 14) * (ENT.state === 'chase' ? 1.3 : .8);
    if (ed < 7 && flashOn) flash.intensity = 80 * (hash(Math.floor(T * 16)) > .5 ? 1 : .15);
    if (ed < 5 && Math.random() < dt * .7) S.flick = .45;
    $('grain').style.opacity = .07 + Math.max(0, (10 - ed) / 10) * .3;
  }
}

/* ================= boot ================= */
const MODELS = ['metal_office_desk', 'modern_arm_chair_01', 'metal_stool_02', 'desk_lamp_arm_01', 'television_02', 'vintage_radio_transceiver', 'korean_public_payphone_01',
  'alarm_clock_01', 'mounted_fluorescent_lights', 'steel_frame_shelves_03', 'metal_toolbox', 'old_military_crate', 'wooden_military_crate', 'ammo_box', 'medical_box',
  'portable_generator', 'power_box_01', 'security_camera_01', 'korean_fire_extinguisher_01', 'wheelchair_01', 'old_bed_frame', 'vintage_day_bed', 'barrel_03', 'Barrel_01',
  'metal_trash_can', 'wall_clock', 'ladder_sectioned_01', 'boombox', 'portable_cassette_player', 'binder_notebook', 'plastic_crate_01', 'tool_cart', 'industrial_wall_lamp',
  'vintage_telephone_wall_clock', 'drawer_cabinet', 'trashbag', 'metal_stool_01', 'utility_box_01', 'cardboard_box_01'];
const isTouch = matchMedia('(pointer:coarse)').matches;
function createAudio() {
  AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = .9;
  const comp = AC.createDynamicsCompressor(); master.connect(comp); comp.connect(AC.destination);
  const len = AC.sampleRate * 2.2, ir = AC.createBuffer(2, len, AC.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  const conv = AC.createConvolver(); conv.buffer = ir; wetBus = AC.createGain(); wetBus.gain.value = .5; wetBus.connect(conv); conv.connect(master);
}
async function loadAudioAssets(onp) {
  Object.assign(LINES, await (await fetch('audio/lines.json')).json());
  const jobs = [...Object.keys(LINES).map(k => ['v', k, 'audio/voice/' + k + '.mp3']), ...['phone_ring', 'heartbeat', 'breath', 'knock', 'footsteps', 'static', 'infrasound'].map(k => ['a', k, 'audio/' + k + '.mp3'])];
  let n = 0; await Promise.all(jobs.map(async ([t, k, u]) => { const b = await AC.decodeAudioData(await (await fetch(u)).arrayBuffer()); (t === 'v' ? VB : AB)[k] = b; onp(++n / jobs.length); }));
}
async function warmup() {
  for (const k in GROUPS) GROUPS[k].visible = true; flash.visible = true;
  const spots = [[0, 1.3, 0], [8, 0, -90], [11, -2.4, 0], [12, 2.1, 180], [21.5, -2.4, 0], [22, 2.1, 180], [27, 0, -90], [4, 0, 90]];
  for (const [x, z, yaw] of spots) {
    camera.position.set(x, 1.65, z); camera.rotation.set(0, yaw * Math.PI / 180, 0); flash.position.copy(camera.position); flash.target.position.set(x - Math.sin(yaw * Math.PI / 180) * 6, 1, z - Math.cos(yaw * Math.PI / 180) * 6);
    renderer.render(scene, camera); await new Promise(r => requestAnimationFrame(r));
  }
  flash.visible = false;
}
function buildMenu() {
  const m = $('menu'), unlocked = saved(); m.innerHTML = '';
  const mk = (txt, fn, dis) => { const b = document.createElement('button'); b.textContent = txt; b.disabled = !!dis; b.onclick = fn; m.appendChild(b); return b; };
  try { S.subs = localStorage.getItem('ls_subs') === '1'; } catch (e) { S.subs = false; }
  const sb = mk('Subtitles: ' + (S.subs ? 'On' : 'Off'), () => { S.subs = !S.subs; try { localStorage.setItem('ls_subs', S.subs ? '1' : '0'); } catch (e) {} sb.textContent = 'Subtitles: ' + (S.subs ? 'On' : 'Off'); });
  mk('New game', () => begin(1)); if (unlocked > 1) mk('Continue: Night ' + unlocked, () => begin(unlocked));
  const row = document.createElement('div'); row.className = 'nights'; m.appendChild(row);
  for (let i = 1; i <= 5; i++) { const b = document.createElement('button'); b.textContent = 'Night ' + i; b.disabled = i > unlocked; b.onclick = () => begin(i); row.appendChild(b); }
}
async function begin(n) {
  await AC.resume(); $('load').style.display = 'none'; started = true;
  S.drone = voice('infrasound', {loop: true, gain: .38, keep: true}); setTimeout(() => { $('hud').style.transition = 'opacity 2s'; $('hud').style.opacity = 0; }, 18000); voice('static', {loop: true, gain: .025, keep: true});
  if (!isTouch && cv.requestPointerLock) cv.requestPointerLock();
  startNight(n);
}
(async () => {
  try {
    createAudio();
    await loadModels(MODELS, p => { $('bi').style.width = Math.round(p * 40) + '%'; });
    $('msg').textContent = 'Building bunker...'; await new Promise(r => setTimeout(r, 30));
    buildLevel(); drawMon(0); applyQuality(); moveWheel(0);
    $('msg').textContent = 'Loading sound...'; await loadAudioAssets(p => { $('bi').style.width = (40 + Math.round(p * 30)) + '%'; }); await ghostLoad();
    $('msg').textContent = 'Preparing graphics (prevents stutter)...'; $('bi').style.width = '80%';
    flash.visible = true; renderer.compile(scene, camera); await warmup(); $('bi').style.width = '100%';
    $('msg').textContent = 'Ready'; $('bar').style.display = 'none'; buildMenu(); window.__ready = true;
  } catch (e) { $('msg').textContent = 'Error: ' + e.message; console.error(e); }
})();
/* touch controls */
const TJ = {x: 0, y: 0};
if (isTouch) {
  $('touch').style.display = 'block'; const st = $('stick'), kn = st.firstElementChild; let sid = null;
  const upd = e => { const r = st.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } TJ.x = dx; TJ.y = dy; kn.style.transform = `translate(${dx * 30}px,${dy * 30}px)`; };
  st.addEventListener('pointerdown', e => { sid = e.pointerId; st.setPointerCapture(sid); upd(e); }); st.addEventListener('pointermove', e => { if (e.pointerId === sid) upd(e); });
  const end = () => { sid = null; TJ.x = TJ.y = 0; kn.style.transform = ''; }; st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
  $('tE').addEventListener('pointerdown', () => { keys.KeyE = true; interactKey(); }); $('tE').addEventListener('pointerup', () => { keys.KeyE = false; });
  $('tF').addEventListener('pointerdown', () => toggleFlash());
}
document.addEventListener('pointerlockchange', () => { $('pause').style.display = (started && !locked && !isTouch && !S.freeze && $('ending').style.display !== 'flex') ? 'flex' : 'none'; });
$('pause').onclick = () => { cv.requestPointerLock && cv.requestPointerLock(); };
addEventListener('blur', () => { if (document.pointerLockElement) document.exitPointerLock(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && document.pointerLockElement) document.exitPointerLock(); });
frameLoop();
window.__tp = (x, z, yawDeg, pitchDeg = 0) => { P.x = x; P.z = z; P.yaw = yawDeg * Math.PI / 180; P.pitch = pitchDeg * Math.PI / 180; started = true; $('load').style.display = 'none'; };
window.__flash = v => { flashOn = v; flash.visible = v; };
window.__door = (n, v) => { const d = DOORS.find(d => d.name === n); if (d) { d.target = v; d.open = v; } };
window.__info = () => renderer.info.render;
window.__G = {INT, keys, useInt, roomId, DOORS}; window.__begin = begin; window.__ENT = ENT; window.__HIDES = HIDES; window.__enterHide = enterHide; window.__S = S; window.__P = P; window.__next = () => { S.abort = false; };
