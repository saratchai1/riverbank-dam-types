// Riverbank dam types web viewer (v2): the five DPT standard types T1-01 … T5-01 (data/tN_01.glb, written by
// tools/damgen/export_web_igz.py) and the object library (data/site.json, written by tools/damgen/web_data_v2.py).
// Every number shown comes from those files; this page only formats and sums them.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const V3 = THREE.Vector3;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 2) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (v) => String(Number(Number(v).toFixed(3)));
const sta = (ch) => {
  const km = Math.floor(ch / 1000);
  const m = Math.round((ch - km * 1000) * 10) / 10;
  return `${km}+${m % 1 ? m.toFixed(1).padStart(5, '0') : String(m).padStart(3, '0')}`;
};
// item_code.pr4_line is "4", or a JSON object such as {"pile": "2.1", "cut": "3.1"}
const pr4Of = (u) => {
  const p = u.item_code?.pr4_line;
  if (!p) return [];
  if (typeof p === 'object') return Object.values(p);
  try { return p.trim().startsWith('{') ? Object.values(JSON.parse(p)) : [p]; } catch { return [p]; }
};
const groupOf = (p) => {
  const n = Number(p.split('.')[0]);
  return n <= 12 ? 'งานคอนกรีตเสริมเหล็ก' : n <= 29 ? 'งานหินเรียง' : 'งานอื่น ๆ';
};

const COUNT_UNITS = new Set(['ต้น', 'แผง', 'แห่ง', 'กล่อง', 'ชุด', 'จุด']);
const CATS = ['structural', 'fitting', 'work', 'earthworks', 'site'];
const PLACEMENT_TH = {
  sweep: 'กวาดตามแนวเขื่อน', pattern: 'วางซ้ำตามระยะ', stations: 'ตามรูปตัดสำรวจ', ends: 'หัว-ท้ายเขื่อน',
  surface: 'ผิว', survey_surface: 'ผิวจากรูปตัดสำรวจ', none: 'ปริมาณอย่างเดียว',
};
const SRC_CLASS = { READ: 'read', SPEC: 'spec', ASSUMED: 'assumed', UNUSED: 'plain' };

// ---- site data ------------------------------------------------------------------------------------------------
const loading = $('#loading');
let site;
try {
  site = await fetch('data/site.json').then((r) => { if (!r.ok) throw new Error(`site.json ${r.status}`); return r.json(); });
} catch (e) {
  loading.innerHTML = `โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}<br><small>ต้องเปิดผ่านเว็บเซิร์ฟเวอร์ เช่น <code>python3 -m http.server 8766</code> ในโฟลเดอร์ viewer_v2</small>`;
  throw e;
}
const TYPE = Object.fromEntries(site.types.map((t) => [t.id, t]));
const FAM = Object.fromEntries(site.families.map((f) => [f.id, f]));
const typeNo = (tid) => tid.split('-')[0];

// ---- shared materials ---------------------------------------------------------------------------------------------
const lineMat = new THREE.LineBasicMaterial({ color: 0x1e2b33, transparent: true, opacity: 0.3 });
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9fb0b7, transparent: true, opacity: 0.07, depthWrite: false });
const selMat = new THREE.MeshStandardMaterial({ color: 0xf2a541, emissive: 0x6b3d00, roughness: 0.6, side: THREE.DoubleSide });
const SHARED = [lineMat, ghostMat, selMat];

// ---- models, loaded on demand ----------------------------------------------------------------------------------------
const loader = new GLTFLoader();
const models = {};
const loadModel = (tid) => (models[tid] ??= loader.loadAsync(TYPE[tid].glb).then((g) => prepare(tid, g)));

function prepare(tid, gltf) {
  const t = TYPE[tid];
  const [OX, OY, DATUM] = (gltf.asset || gltf.parser.json.asset).extras.offset;
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const mats = new Set();
  for (const m of meshes) {
    m.userData.mat = m.material;
    mats.add(m.material);
    if (m.material.transparent) m.material.depthWrite = false;
    m.geometry.computeBoundingBox();
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), lineMat);
    e.raycast = () => {};
    m.add(e);
    m.userData.edges = e;
  }
  const comps = new Map();
  for (const m of meshes) {
    const u = m.userData;
    if (!comps.has(u.component)) {
      comps.set(u.component, { id: u.component, family: u.family, name: u.name_th, color: `#${m.material.color.getHexString()}`, meshes: [] });
    }
    comps.get(u.component).meshes.push(m);
  }
  // straight alignment: chainage -> glTF point, fitted from any piece's from/to
  const ref = meshes.map((m) => m.userData.coords).find((c) => c && c.ch_to - c.ch_from > 1);
  const dx = (ref.xy_to[0] - ref.xy_from[0]) / (ref.ch_to - ref.ch_from);
  const dy = (ref.xy_to[1] - ref.xy_from[1]) / (ref.ch_to - ref.ch_from);
  const ax = ref.xy_from[0] - dx * ref.ch_from;
  const ay = ref.xy_from[1] - dy * ref.ch_from;
  const chPoint = (ch, y = 0) => new V3(ax + dx * ch - OX, y, -(ay + dy * ch - OY));
  const DIR = new V3(dx, 0, -dy).normalize();
  const box = new THREE.Box3().setFromObject(gltf.scene);
  // river side: where the water level plane lies, across the alignment
  const water = new THREE.Box3();
  meshes.filter((m) => m.userData.component === 'water').forEach((m) => water.expandByObject(m));
  const riverDir = water.isEmpty() ? new V3(0, 0, 1) : water.getCenter(new V3()).sub(chPoint(t.length / 2)).setY(0);
  riverDir.addScaledVector(DIR, -riverDir.dot(DIR)).normalize();
  const isoDir = riverDir.clone().addScaledVector(DIR, -0.5).add(new V3(0, 0.65, 0));
  const top = Math.max(...meshes.filter((m) => m.userData.family !== 'lighting').map((m) => m.geometry.boundingBox.max.y));
  return { tid, t, scene: gltf.scene, meshes, mats, comps, DATUM, chPoint, DIR, box, riverDir, isoDir, top };
}

// ---- a 3D view -------------------------------------------------------------------------------------------------------
class View {
  constructor(el, { labels = false, clipping = false } = {}) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = clipping;
    el.prepend(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeef3f5);
    lights(this.scene);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    if (labels) {
      this.css = new CSS2DRenderer();
      Object.assign(this.css.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
      el.append(this.css.domElement);
    }
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
  }
  resize() {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.css?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  look(target, dir, dist) {
    place(this.camera, target, dir, dist);
    this.controls.target.copy(target);
    this.controls.update();
  }
  frame(box, dir, k = 1) {
    const r = box.getSize(new V3()).length() / 2;
    this.look(box.getCenter(new V3()), dir, (r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * k);
  }
  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.css?.render(this.scene, this.camera);
  }
}
function lights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8d96, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(-40, 70, 50);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(50, 20, -40);
  scene.add(fill);
}
function place(camera, target, dir, dist) {
  camera.position.copy(target).addScaledVector(dir.clone().normalize(), dist);
  camera.near = dist / 300;
  camera.far = dist * 30;
  camera.updateProjectionMatrix();
  camera.lookAt(target);
}
const fitDist = (box, fov, k) => (box.getSize(new V3()).length() / 2 / Math.sin(THREE.MathUtils.degToRad(fov) / 2)) * k;

// ---- model tab ---------------------------------------------------------------------------------------------------------
const view = new View($('#stage-model'), { labels: true, clipping: true });
const labels = new THREE.Group();
view.scene.add(labels);
let cur = null;
let selected = null;
let focus = null;
let cutOn = false;
const plane = new THREE.Plane(new V3(1, 0, 0), 0);

const showLabels = () => {
  const ch = Number($('#cut').value);
  labels.children.forEach((l) => { l.visible = !cutOn || l.userData.ch >= ch - 1e-6; });
};
const setCutAt = (ch) => {
  if (cur) plane.constant = -cur.DIR.dot(cur.chPoint(ch));
  $('#cut-label').textContent = `STA ${sta(ch)}`;
  showLabels();
};
const setCut = (on) => {
  cutOn = on;
  for (const m of [...SHARED, ...(cur ? cur.mats : [])]) { m.clippingPlanes = on ? [plane] : []; m.needsUpdate = true; }
  showLabels();
};
$('#cut').addEventListener('input', (e) => {
  setCutAt(Number(e.target.value));
  if (!cutOn) { $('#cut-on').checked = true; setCut(true); }
});
$('#cut-on').addEventListener('change', (e) => setCut(e.target.checked));

function frameSection() {
  const ch = Number($('#cut').value);
  const size = cur.box.getSize(new V3());
  const perp = new V3(-cur.DIR.z, 0, cur.DIR.x);
  const width = Math.abs(size.x * perp.x) + Math.abs(size.z * perp.z);
  const c = cur.box.getCenter(new V3());
  c.addScaledVector(cur.DIR, cur.chPoint(ch).sub(c).dot(cur.DIR));
  const r = Math.hypot(width, size.y) / 2;
  view.look(c, cur.DIR.clone().negate().add(new V3(0, 0.08, 0)), (r / Math.sin(THREE.MathUtils.degToRad(view.camera.fov) / 2)) * 0.9);
}
function setView(kind) {
  if (!cur) return;
  if (kind === 'iso') view.frame(cur.box, cur.isoDir, 0.95);
  else if (kind === 'river') view.frame(cur.box, cur.riverDir.clone().add(new V3(0, 0.22, 0)), 0.55);
  else if (kind === 'top') view.frame(cur.box, new V3(0, 1, 0.0005), 0.5);
  else if (kind === 'section') {
    if (!cutOn) { $('#cut-on').checked = true; setCut(true); }
    frameSection();
  }
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

function applyMaterials() {
  for (const m of cur.meshes) {
    const ghost = focus && !focus.has(m);
    m.material = m === selected ? selMat : ghost ? ghostMat : m.userData.mat;
    m.userData.edges.visible = !ghost;
  }
}
function markRow(row) {
  document.querySelectorAll('.comp.sel, .boq tr.sel').forEach((r) => r.classList.remove('sel'));
  row?.classList.add('sel');
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}
const EMPTY_INFO = 'คลิกชิ้นส่วนในแบบจำลอง<br>เพื่อดูปริมาณ รหัสรายการ และพิกัด';
function statusChip(u) {
  if (u.status === 'ASSUMED') return '<span class="chip assumed">ค่าสมมุติ (ASSUMED)</span>';
  if (u.status === 'DISPLAY') return '<span class="chip plain">ผิวแสดงผล ไม่มีปริมาณ</span>';
  return esc(u.status || '-');
}
function showInfo(m) {
  const el = $('#info');
  if (!m) { el.className = 'info empty'; el.innerHTML = EMPTY_INFO; return; }
  const u = m.userData;
  const f = FAM[u.family];
  const bb = m.geometry.boundingBox;
  const pr4 = pr4Of(u);
  const vol = u.qto?.volume_m3;
  const kmr = u.item_code?.kmr_code;
  // the group's own name (GLTFLoader sanitises node names: spaces and dots are lost)
  const title = `${u.name_th ?? ''} ${u.segment ?? ''}`.trim() || m.name;
  el.className = 'info';
  el.innerHTML = `<h4>${esc(title)}</h4>
    <div class="fam">${esc(cur.tid)} · family <b>${esc(u.family)}</b> · ${esc(f?.name_th)}</div>
    <dl class="kv">
      <dt>รายการ ปร.4</dt><dd>${pr4.length ? pr4.map((p) => `ข้อ ${esc(p)}`).join(', ') : '-'}</dd>
      <dt>รหัส กมร.</dt><dd>${kmr === 'MISSING' ? '<span class="chip missing">ยังไม่มี (MISSING)</span>' : esc(kmr || '-')}</dd>
      <dt>ปริมาตร (วัดจากโมเดล)</dt><dd>${vol != null ? `${num(vol, 3)} ลบ.ม.` : '-'}</dd>
      <dt>ช่วง</dt><dd>STA ${sta(u.coords.ch_from)} – ${sta(u.coords.ch_to)}</dd>
      <dt>ระดับ</dt><dd>+${num(bb.min.y + cur.DATUM, 3)} ถึง +${num(bb.max.y + cur.DATUM, 3)}</dd>
      <dt>พิกัดต้น (X, Y)</dt><dd>${u.coords.xy_from.map((v) => num(v, 3)).join(', ')}</dd>
      <dt>คลาส IFC</dt><dd>${esc(f?.ifc || '-')}</dd>
      <dt>Layer</dt><dd>${esc(u.layer)}</dd>
      <dt>สถานะ</dt><dd>${statusChip(u)}</dd>
    </dl>
    <button class="btn" id="to-lib">ดู family นี้ใน Object Library</button>`;
  $('#to-lib').onclick = () => { showTab('library'); selectFamily(u.family, { type: cur.tid, component: u.component }); };
}
function showSummary(list, label) {
  const el = $('#info');
  const vols = list.map((m) => m.userData.qto?.volume_m3).filter((v) => v != null);
  const ch0 = Math.min(...list.map((m) => m.userData.coords.ch_from));
  const ch1 = Math.max(...list.map((m) => m.userData.coords.ch_to));
  el.className = 'info';
  el.innerHTML = `<h4>${esc(label)}</h4><div class="fam">${esc(cur.tid)} · ไฮไลต์ ${list.length} ชิ้น · ชิ้นอื่นจางลง</div>
    <dl class="kv">
      <dt>ปริมาตรรวม (วัดจากโมเดล)</dt><dd>${vols.length ? `${num(vols.reduce((a, b) => a + b, 0), 3)} ลบ.ม.` : '-'}</dd>
      <dt>ช่วง</dt><dd>STA ${sta(ch0)} – ${sta(ch1)}</dd>
    </dl>`;
}
function highlight(list, label, row) {
  focus = new Set(list);
  selected = null;
  applyMaterials();
  markRow(row);
  showSummary(list, label);
}
function clearAll() {
  focus = null;
  selected = null;
  if (cur) applyMaterials();
  markRow(null);
  showInfo(null);
}
$('#clear').addEventListener('click', clearAll);

// picking: a click, not the end of a drag
const ray = new THREE.Raycaster();
let down = null;
const canvas = view.renderer.domElement;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!cur || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), view.camera);
  // display surfaces (ground, water) are not picked: they cover everything; the list still shows them
  const cand = cur.meshes.filter((m) => m.visible && m.userData.status !== 'DISPLAY' && !(focus && !focus.has(m)));
  const hit = ray.intersectObjects(cand, false).find((h) => !cutOn || plane.distanceToPoint(h.point) >= -1e-3);
  selected = hit ? hit.object : null;
  applyMaterials();
  if (selected) { markRow(null); showInfo(selected); } else if (!focus) showInfo(null);
});

function renderTypeList() {
  $('#type-list').innerHTML = site.types.map((t) => `<button class="type-btn" role="radio" aria-checked="false" data-type="${esc(t.id)}">
    <span class="tid">${esc(typeNo(t.id))}</span><span>${esc(t.short)}</span></button>`).join('');
  document.querySelectorAll('.type-btn').forEach((b) => b.addEventListener('click', () => showType(b.dataset.type)));
}
function renderCompList() {
  const el = $('#comp-list');
  el.innerHTML = '';
  for (const cat of CATS) {
    const cs = [...cur.comps.values()].filter((c) => FAM[c.family]?.category === cat);
    if (!cs.length) continue;
    el.insertAdjacentHTML('beforeend', `<div class="cat">${esc(FAM[cs[0].family].category_th)}</div>`);
    for (const c of cs) {
      const row = document.createElement('div');
      row.className = 'comp';
      row.innerHTML = `<input type="checkbox" checked aria-label="แสดง ${esc(c.name)}"><span class="sw" style="background:${c.color}"></span>
        <span class="nm">${esc(c.name)}</span><span class="ct">${c.meshes.length}</span>`;
      row.querySelector('input').addEventListener('change', (e) => c.meshes.forEach((m) => { m.visible = e.target.checked; }));
      row.querySelector('.nm').addEventListener('click', () => highlight(c.meshes, c.name, row));
      el.append(row);
    }
  }
}
// ปร.4 table (quantities from boq.json; rows link to pieces through item_code.pr4_line)
function renderBoq() {
  const t = $('#boq');
  t.innerHTML = '<thead><tr><th>ข้อ</th><th>รายการ</th><th style="text-align:right">ปริมาณ</th><th>หน่วย</th></tr></thead>';
  const tb = document.createElement('tbody');
  let last = null;
  for (const ln of cur.t.boq) {
    if (groupOf(ln.pr4) !== last) {
      last = groupOf(ln.pr4);
      tb.insertAdjacentHTML('beforeend', `<tr class="group"><td colspan="4">${last}</td></tr>`);
    }
    const list = cur.meshes.filter((m) => pr4Of(m.userData).includes(ln.pr4));
    const tr = document.createElement('tr');
    if (!list.length) tr.className = 'nogeo';
    tr.title = [ln.rule, ln.note].filter(Boolean).join(' · ');
    tr.innerHTML = `<td class="no">${esc(ln.pr4)}</td><td>${esc(ln.desc)}</td>
      <td class="n">${num(ln.qty, COUNT_UNITS.has(ln.unit) ? 0 : 2)}</td><td>${esc(ln.unit)}</td>`;
    tr.addEventListener('click', () => {
      if (list.length) highlight(list, `ปร.4 ข้อ ${ln.pr4} · ${ln.desc}`, tr);
      else toast(`ข้อ ${ln.pr4} ไม่มีรูปทรงในแบบจำลอง: ${ln.note || ln.rule}`);
    });
    tb.append(tr);
  }
  t.append(tb);
}

async function showType(tid) {
  if (!TYPE[tid]) tid = site.types[0].id;
  document.querySelectorAll('.type-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === tid)));
  $('#busy').classList.add('on');
  const m = await loadModel(tid);
  $('#busy').classList.remove('on');
  if (cur === m) return m;
  if (cur) view.scene.remove(cur.scene);
  cur = m;
  view.scene.add(m.scene);
  for (const mesh of m.meshes) mesh.visible = true;
  focus = null;
  selected = null;
  applyMaterials();
  labels.clear();
  for (let ch = 0; ch <= m.t.length + 1e-6; ch += 25) {
    const div = document.createElement('div');
    div.className = 'sta';
    div.textContent = `STA ${sta(ch)}`;
    const label = new CSS2DObject(div);
    label.position.copy(m.chPoint(ch, m.top + 1.5));
    label.userData.ch = ch;
    labels.add(label);
  }
  plane.normal.copy(m.DIR);
  const slider = $('#cut');
  slider.max = m.t.length;
  if (Number(slider.value) > m.t.length) slider.value = m.t.length / 2;
  setCutAt(Number(slider.value));
  setCut(cutOn);
  $('#type-title').innerHTML = `<b>${esc(m.t.id)} · ${esc(m.t.title)}</b><small>ยาว ${num(m.t.length, 2)} ม. · ${esc(m.t.status)}</small>`;
  renderCompList();
  renderBoq();
  showInfo(null);
  markRow(null);
  setView('iso');
  history.replaceState(null, '', `#${tid}`);
  return m;
}

// ---- library tab -------------------------------------------------------------------------------------------------------
const prev = new View($('#stage-lib'));
prev.controls.autoRotateSpeed = 1.2;
prev.controls.addEventListener('start', () => { prev.controls.autoRotate = false; });
const prevGroup = new THREE.Group();
prev.scene.add(prevGroup);

// the pieces of a family shown in the library: from its preview type's model, inside the chainage window
async function previewPieces(f) {
  if (!f.preview) return { list: [], model: null };
  const model = await loadModel(f.preview.type);
  const w = f.preview.window;
  let list = model.meshes.filter((m) => m.userData.family === f.id);
  if (w === 'first') list = list.sort((a, b) => a.userData.coords.ch_from - b.userData.coords.ch_from).slice(0, 1);
  else if (Array.isArray(w)) list = list.filter((m) => m.userData.coords.ch_from >= w[0] - 1e-6 && m.userData.coords.ch_to <= w[1] + 1e-6);
  return { list, model };
}
function copyPieces(list, group) {
  for (const m of list) {
    const c = new THREE.Mesh(m.geometry, m.userData.mat);
    c.add(new THREE.LineSegments(m.userData.edges.geometry, lineMat));
    group.add(c);
  }
}

function typeChips(f) {
  return [...new Set(f.in_models.map((u) => typeNo(u.type)))].map((n) => `<span class="tchip">${esc(n)}</span>`).join('');
}
function renderGallery() {
  let html = `<h2>Family ที่มีแล้ว <small>${site.families.length} ตัว · คลิกเพื่อดู 3D พารามิเตอร์ และชนิดที่ใช้</small></h2><div class="grid">`;
  for (const cat of CATS) {
    for (const f of site.families.filter((x) => x.category === cat)) {
      const pic = f.picture
        ? `<div class="pic" style="background-image:url('${esc(f.picture)}')"><span class="chip cat">${esc(f.category_th)}</span></div>`
        : f.preview
          ? `<div class="pic gen" data-gen="${esc(f.id)}"><span class="chip cat">${esc(f.category_th)}</span><span class="wait">กำลังสร้างภาพ…</span></div>`
          : `<div class="pic none"><span class="chip cat">${esc(f.category_th)}</span><b>ไม่มีรูปทรง</b><span>ถอดปริมาณอย่างเดียว</span></div>`;
      html += `<button class="card" data-fam="${esc(f.id)}">${pic}
        <div class="body"><div class="t">${esc(f.name_th)}</div>
          <div class="m">${f.pr4.length ? `ปร.4 ข้อ ${esc(f.pr4.join(', '))}` : 'ไม่มีรายการ ปร.4'}${f.ifc ? ` · ${esc(f.ifc)}` : ''}</div>
          <div class="types">${typeChips(f)}</div></div>
      </button>`;
    }
  }
  html += `</div><h2>Family ตามแผน <small>${site.planned.length} ตัว ยังไม่มีแบบมาตรฐานชนิดไหนใช้</small></h2><div class="grid">`;
  for (const p of site.planned) {
    html += `<div class="card planned"><div class="body"><span class="chip plain">ตามแผน</span>
      <div class="t" style="margin-top:6px">${esc(p.name_th)}</div>
      <div class="m">ปร.4 ข้อ ${esc(p.pr4)} · ${esc(p.types_th.join(' · '))}</div></div></div>`;
  }
  $('#gallery').innerHTML = `${html}</div>`;
  document.querySelectorAll('[data-fam]').forEach((b) => b.addEventListener('click', () => selectFamily(b.dataset.fam)));
}

// thumbnails for families with no captured picture: rendered here from the same model pieces
let thumbsMade = false;
async function makeThumbs() {
  if (thumbsMade) return;
  thumbsMade = true;
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(480, 360);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe3e5);
  lights(scene);
  const cam = new THREE.PerspectiveCamera(38, 480 / 360, 0.1, 5000);
  for (const el of document.querySelectorAll('[data-gen]')) {
    const f = FAM[el.dataset.gen];
    const { list, model } = await previewPieces(f);
    const g = new THREE.Group();
    copyPieces(list, g);
    scene.add(g);
    const box = new THREE.Box3().setFromObject(g);
    place(cam, box.getCenter(new V3()), model.isoDir.clone().addScaledVector(model.DIR, 0.5), fitDist(box, cam.fov, 1.1));
    r.render(scene, cam);
    el.style.backgroundImage = `url('${r.domElement.toDataURL('image/jpeg', 0.86)}')`;
    el.querySelector('.wait')?.remove();
    scene.remove(g);
  }
  r.dispose();
}

function paramValue(v) {
  if (Array.isArray(v)) return v.length && Array.isArray(v[0]) ? 'รายการพิกัด' : esc(v.map(short).join(', '));
  if (typeof v === 'number') return short(v);
  if (typeof v === 'boolean') return v ? 'ใช่' : 'ไม่';
  return esc(v ?? '-');
}
let famSel = { id: null, use: 0 };
function renderFamDetail(f) {
  const uses = f.in_models;
  const u = uses[famSel.use];
  const asm = u ? TYPE[u.type].assumptions[u.component] || {} : {};
  const rows = Object.entries(f.params).map(([k, p]) => {
    const a = asm[k] || {};
    const src = a.src || p.src;
    return `<tr><td>${esc(k)}</td><td class="v">${paramValue(p.default)}</td><td class="v">${k in asm ? paramValue(a.value) : '-'}</td>
      <td>${esc(p.unit)}</td><td><span class="chip ${SRC_CLASS[src] || 'plain'}">${esc(site.src_th[src] || src)}</span></td>
      <td class="note">${esc(a.note ?? p.note)}</td></tr>`;
  }).join('');
  const chips = uses.map((x, i) => `<button class="use" aria-pressed="${i === famSel.use}" data-use="${i}">
    <b>${esc(typeNo(x.type))}</b> ${esc(x.name_th)}${x.count ? ` · ${x.count} ชิ้น` : ''}</button>`).join('');
  $('#fam-detail').innerHTML = `<h2>${esc(f.name_th)}</h2><div class="id">${esc(f.id)}</div>
    <div class="chips"><span class="chip cat">${esc(f.category_th)}</span>
      ${f.ifc ? `<span class="chip plain">${esc(f.ifc)}</span>` : ''}
      ${f.unit ? `<span class="chip plain">หน่วยถอด: ${esc(f.unit)}</span>` : ''}
      <span class="chip plain">การวาง: ${esc(PLACEMENT_TH[f.placement] || f.placement)}</span>
      ${f.layer ? `<span class="chip plain">layer ${esc(f.layer)}</span>` : ''}</div>
    ${f.rule ? `<div class="rule"><b>ถอดปริมาณ:</b> ${esc(f.rule)}</div>` : ''}
    <dl class="kv">
      <dt>รายการ ปร.4</dt><dd>${f.pr4.length ? `ข้อ ${esc(f.pr4.join(', '))}` : '-'}</dd>
      <dt>รายการประกอบแบบ</dt><dd>${f.spec.length ? `ข้อ ${f.spec.join(', ')}` : '-'}</dd>
      <dt>แบบมาตรฐาน</dt><dd>${esc(f.std_drawing || '-')}</dd>
      <dt>ใช้ได้กับเขื่อนชนิด</dt><dd>${esc(f.types_th.join(' · ') || '-')}</dd>
    </dl>
    <h3>ใช้ในแบบจำลอง <small>คลิกเพื่อดูค่าที่ใช้</small></h3>
    <div class="uses">${chips || '<span class="note">ยังไม่มีชนิดไหนใช้</span>'}</div>
    ${rows ? `<h3>พารามิเตอร์และที่มา ${u ? `<small>ค่าใน ${esc(u.type)} · ${esc(u.name_th)}</small>` : ''}</h3>
      <table class="params"><thead><tr><th>พารามิเตอร์</th><th>ค่าตั้งต้น</th><th>ค่าที่ใช้</th><th>หน่วย</th><th>ที่มา</th><th>หมายเหตุ</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    ${u && u.count ? `<div class="btn-row"><button class="btn primary" id="to-model">ดูชิ้นส่วนนี้ในแบบจำลอง ${esc(u.type)}</button></div>` : ''}`;
  document.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => { famSel.use = Number(b.dataset.use); renderFamDetail(f); }));
  const btn = $('#to-model');
  if (btn) {
    btn.onclick = async () => {
      showTab('model');
      const m = await showType(u.type);
      const c = m.comps.get(u.component);
      if (c) highlight(c.meshes, `${u.type} · ${c.name}`, null);
    };
  }
}

let prevToken = 0;
async function selectFamily(fid, pick = null) {
  const f = FAM[fid];
  if (!f) return;
  famSel = { id: fid, use: pick ? Math.max(0, f.in_models.findIndex((x) => x.type === pick.type && x.component === pick.component)) : 0 };
  document.querySelectorAll('.card.sel').forEach((c) => c.classList.remove('sel'));
  const card = $(`.card[data-fam="${CSS.escape(fid)}"]`);
  card?.classList.add('sel');
  card?.scrollIntoView({ block: 'nearest' });
  renderFamDetail(f);
  const token = ++prevToken;
  prevGroup.clear();
  $('#lib-hint').textContent = f.preview ? 'กำลังโหลดแบบจำลอง…' : 'family นี้ไม่มีรูปทรง (ถอดปริมาณอย่างเดียว)';
  const { list, model } = await previewPieces(f);
  if (token !== prevToken) return;
  copyPieces(list, prevGroup);
  if (list.length) {
    prev.frame(new THREE.Box3().setFromObject(prevGroup), model.isoDir.clone().addScaledVector(model.DIR, 0.5), 1.15);
    prev.controls.autoRotate = true;
    const w = f.preview.window;
    $('#lib-hint').textContent = `ตัวอย่างจากแบบจำลอง ${f.preview.type}: ${list.length} ชิ้น${Array.isArray(w) ? ` ช่วง STA ${sta(w[0])} – ${sta(w[1])}` : ''} · ลากเพื่อหมุน`;
  }
}

// ---- tabs and loop -----------------------------------------------------------------------------------------------------
let active = 'model';
function showTab(name) {
  active = name;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('on', s.id === `tab-${name}`));
  if (name === 'library') {
    if (!famSel.id) selectFamily(site.families[0].id);
    makeThumbs();
  }
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

renderTypeList();
renderGallery();
await showType(decodeURIComponent(location.hash.slice(1)) || site.types[0].id);
window.addEventListener('hashchange', () => {
  const tid = decodeURIComponent(location.hash.slice(1));
  if (TYPE[tid] && cur?.tid !== tid) { showTab('model'); showType(tid); }
});
loading.classList.add('gone');
(function loop() {
  requestAnimationFrame(loop);
  (active === 'model' ? view : prev).render();
}());
window.viewer = { view, prev, models, site, showType, selectFamily, showTab, current: () => cur };
