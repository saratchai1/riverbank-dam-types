import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildSection, lengthOf, pointAt, projectRevision, formatStation } from './core.js';
import { conceptMesh } from './exports.js';

const V3 = THREE.Vector3;

/** A metre-accurate concept viewport; the original five-type GLBs remain in the reference viewer. */
export function mountScene(container, initial, onStation) {
  let p = initial, revision = '', mode = 'iso', disposed = false, lastPointer = null;
  let geometryRoot = null, marker = null, grid = null, origin = new V3();
  let bounds = new THREE.Box3(), frameHandle = 0, forceFrame = true;
  const visibility = { ground: true, structure: true, water: true, piles: true };
  container.style.position = 'relative';
  const status = document.createElement('div');
  status.className = 'studio-scene-status';
  Object.assign(status.style, { position: 'absolute', left: '12px', bottom: '11px', right: '12px', pointerEvents: 'none', zIndex: '1', color: '#45616d', font: '11px Tahoma,sans-serif', lineHeight: '1.6' });
  const stationTag = document.createElement('div');
  stationTag.className = 'studio-station-tag';
  Object.assign(stationTag.style, { position: 'absolute', pointerEvents: 'none', zIndex: '2', padding: '4px 8px', borderRadius: '5px', background: '#173a4bea', color: '#fff', whiteSpace: 'nowrap', font: '600 11px ui-monospace,monospace' });
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  } catch {
    status.textContent = 'เครื่องนี้เปิดภาพ 3D ไม่ได้ — ใช้แปลนและรูปตัด 2D ต่อได้';
    container.append(status);
    return { update() {}, setView() {}, fit() {}, setLayer() {}, downloadPng() { throw new Error('ภาพ 3D ยังไม่พร้อม'); }, dispose() { status.remove(); } };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0xeaf0f0);
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;
  renderer.domElement.setAttribute('aria-label', 'แบบจำลองแนวคิดสามมิติ ลากเพื่อหมุน ล้อเมาส์เพื่อซูม คลิกเลือกสถานี');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  container.prepend(renderer.domElement);
  container.append(stationTag, status);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eaf0f0');
  scene.add(new THREE.HemisphereLight(0xf8ffff, 0x807c66, 2.1));
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.4);
  sun.position.set(-70, 110, 50); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xd2edf5, 1.1);
  fill.position.set(60, 30, -80); scene.add(fill);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 1000000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI * 0.98;
  controls.addEventListener('change', () => { forceFrame = true; });
  const clipPlane = new THREE.Plane();

  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    forceFrame = true;
  }

  function destroyObject(object) {
    if (!object) return;
    object.traverse((o) => {
      o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose();
    });
    scene.remove(object);
  }

  function rebuild() {
    const previousOrigin = origin.clone();
    destroyObject(geometryRoot); destroyObject(grid);
    let geometry;
    try { geometry = conceptMesh(p, { maxPiles: 800, maxSegments: 180 }); }
    catch (e) { geometry = { parts: [], warnings: [`แสดง 3D ไม่ได้: ${e.message} · ใช้รูปตัด/ตารางต่อได้`] }; }
    const points = p.alignment;
    origin = new V3((Math.min(...points.map((v) => v.x)) + Math.max(...points.map((v) => v.x))) / 2,
      (Math.min(...points.map((v) => v.y)) + Math.max(...points.map((v) => v.y))) / 2, p.geometry.crestLevel);
    geometryRoot = new THREE.Group();
    for (const part of geometry.parts) {
      const positions = part.vertices.flatMap(([x, y, z]) => [x - origin.x, z - origin.z, -(y - origin.y)]);
      const indices = part.faces.flatMap((face) => {
        const tris = [];
        for (let j = 1; j < face.length - 1; j++) tris.push(face[0], face[j], face[j + 1]);
        return tris;
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex(indices); g.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: part.color, side: THREE.DoubleSide, roughness: part.layer === 'water' ? 0.25 : 0.89,
        metalness: 0, transparent: part.layer === 'water', opacity: part.layer === 'water' ? 0.64 : 1,
        depthWrite: part.layer !== 'water', polygonOffset: part.layer === 'water', polygonOffsetFactor: -1,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.userData.layer = part.layer;
      mesh.userData.id = part.id;
      mesh.visible = visibility[part.layer];
      geometryRoot.add(mesh);
      if (part.layer === 'structure') {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: 0x3e5b64, transparent: true, opacity: 0.38 }));
        edges.userData.layer = part.layer;
        edges.raycast = () => {};
        mesh.add(edges);
      }
    }
    scene.add(geometryRoot);
    bounds = new THREE.Box3().setFromObject(geometryRoot);
    if (bounds.isEmpty()) bounds.set(new V3(-10, -5, -10), new V3(10, 5, 10));
    const size = bounds.getSize(new V3());
    const groundSize = Math.max(size.x, size.z, 30) * 1.35;
    grid = new THREE.GridHelper(groundSize, 20, 0xc4d0ce, 0xd6e0de);
    grid.position.y = bounds.min.y - 0.3;
    grid.material.transparent = true; grid.material.opacity = 0.34;
    scene.add(grid);
    if (revision) {
      // Keep the view centred on the same project coordinates after edits.
      const shift = new V3(previousOrigin.x - origin.x, previousOrigin.z - origin.z, -(previousOrigin.y - origin.y));
      camera.position.add(shift); controls.target.add(shift);
    }
    status.textContent = geometry.warnings.length ? geometry.warnings.join(' · ') :
      `${p.sources.alignment.kind === 'demo' ? 'ข้อมูลสาธิต · ' : ''}แบบจำลองแนวคิด · หน่วยเมตร · คลิกที่แบบเลือกสถานี`;
    revision = projectRevision(p);
    updateMarker(); applyClip();
  }

  function local(station, offset, elevation) {
    const at = pointAt(p.alignment, station);
    return new V3(at.x + at.nx * offset - origin.x, elevation - origin.z, -(at.y + at.ny * offset - origin.y));
  }

  function updateMarker() {
    destroyObject(marker);
    marker = new THREE.Group();
    const s = buildSection(p, p.selectedStation);
    const offsets = [...s.polygons.flatMap((v) => v.points.map((v) => v.offset)), ...s.ground.map((v) => v.offset)];
    const lo = Math.min(-5, ...offsets), hi = Math.max(5, ...offsets);
    const a = local(p.selectedStation, lo, p.geometry.crestLevel + 0.15), b = local(p.selectedStation, hi, p.geometry.crestLevel + 0.15);
    const cut = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color: 0xc8943d, dashSize: 0.65, gapSize: 0.35, depthTest: false, transparent: true, opacity: 0.9 }));
    cut.computeLineDistances(); cut.renderOrder = 10;
    marker.add(cut);
    const pinAt = local(p.selectedStation, 0, p.geometry.crestLevel + 0.3);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), new THREE.MeshBasicMaterial({ color: 0xd29e4a, depthTest: false }));
    ball.position.copy(pinAt); ball.renderOrder = 11; marker.add(ball);
    marker.userData.labelAt = pinAt.clone().add(new V3(0, 0.6, 0));
    scene.add(marker);
    stationTag.textContent = `STA ${formatStation(p.selectedStation)}`;
    forceFrame = true;
  }

  function applyClip() {
    const at = pointAt(p.alignment, p.selectedStation);
    const normal = new V3(at.ny, 0, at.nx).negate();
    clipPlane.setFromNormalAndCoplanarPoint(normal, local(p.selectedStation, 0, p.geometry.crestLevel));
    geometryRoot?.traverse((obj) => {
      if (!obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((mat) => { mat.clippingPlanes = mode === 'section' ? [clipPlane] : []; mat.needsUpdate = true; });
    });
    forceFrame = true;
  }

  function setView(kind) {
    mode = ['iso', 'top', 'section'].includes(kind) ? kind : 'iso';
    const at = pointAt(p.alignment, mode === 'section' ? p.selectedStation : lengthOf(p.alignment) / 2);
    const river = new V3(-at.nx, 0, at.ny), tangent = new V3(at.ny, 0, at.nx);
    let target = bounds.getCenter(new V3()), radius = bounds.getSize(new V3()).length() / 2;
    let dir = river.clone().addScaledVector(tangent, -0.5).add(new V3(0, 0.7, 0));
    if (mode === 'top') dir.set(0, 1, 0.00001);
    if (mode === 'section') {
      const s = buildSection(p, p.selectedStation);
      const vertices = [...s.polygons.flatMap((v) => v.points), ...s.piles.flatMap((v) => [v.top, v.bottom]), ...s.ground];
      const box = new THREE.Box3().setFromPoints(vertices.map((v) => local(p.selectedStation, v.offset, v.elevation)));
      target = box.getCenter(new V3()); radius = box.getSize(new V3()).length() / 2;
      dir = tangent;
    }
    const limitingFov = Math.min(camera.fov * Math.PI / 180, 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
    const distance = Math.max(12, radius / Math.sin(limitingFov / 2) * 1.16);
    camera.position.copy(target).addScaledVector(dir.normalize(), distance);
    camera.near = Math.max(0.03, distance / 10000);
    camera.far = Math.max(500, distance * 12);
    camera.updateProjectionMatrix();
    controls.target.copy(target); controls.update();
    applyClip(); forceFrame = true;
  }

  function update(next) {
    const previousStation = p.selectedStation;
    p = next;
    if (projectRevision(p) !== revision) rebuild();
    else if (p.selectedStation !== previousStation) { updateMarker(); applyClip(); }
    else updateMarker(); // Also accommodates callers mutating their state object before update.
    if (mode === 'section') setView('section');
    forceFrame = true;
  }

  const raycaster = new THREE.Raycaster();
  function down(e) { lastPointer = [e.clientX, e.clientY]; }
  function up(e) {
    if (!onStation || !lastPointer || Math.hypot(e.clientX - lastPointer[0], e.clientY - lastPointer[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObjects(geometryRoot.children, false).find((h) => h.object.visible);
    if (!hit) return;
    const x = hit.point.x + origin.x, y = -hit.point.z + origin.y;
    let cumulative = 0, best = { station: 0, distance: Infinity };
    for (let i = 1; i < p.alignment.length; i++) {
      const a = p.alignment[i - 1], b = p.alignment[i];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (len * len)));
      const distance = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
      if (distance < best.distance) best = { station: cumulative + t * len, distance };
      cumulative += len;
    }
    onStation(Math.max(0, Math.min(lengthOf(p.alignment), Number(best.station.toFixed(2)))));
  }

  function render() {
    if (disposed) return;
    controls.update();
    if (forceFrame) {
      renderer.render(scene, camera);
      const point = marker?.userData.labelAt?.clone().project(camera);
      if (point) {
        const x = (point.x + 1) / 2 * container.clientWidth, y = (1 - point.y) / 2 * container.clientHeight;
        stationTag.style.left = `${Math.max(6, Math.min(container.clientWidth - 105, x - 45))}px`;
        stationTag.style.top = `${Math.max(6, Math.min(container.clientHeight - 50, y - 28))}px`;
        stationTag.style.display = point.z > 1 ? 'none' : '';
      }
      forceFrame = false;
    }
    frameHandle = requestAnimationFrame(render);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointerup', up);
  resize(); rebuild(); setView('iso'); render();

  return {
    update,
    setView,
    fit() { setView(mode); },
    setLayer(id, visible) {
      if (!(id in visibility)) return;
      visibility[id] = !!visible;
      geometryRoot.children.forEach((obj) => { if (obj.userData.layer === id) obj.visible = !!visible; });
      forceFrame = true;
    },
    downloadPng() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
    dispose() {
      disposed = true; cancelAnimationFrame(frameHandle); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up);
      destroyObject(geometryRoot); destroyObject(marker); destroyObject(grid);
      renderer.dispose(); renderer.domElement.remove(); status.remove(); stationTag.remove();
    },
  };
}
