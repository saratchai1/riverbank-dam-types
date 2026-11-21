import { DEFAULT_INPUTS, validateInputs, calculateTypical } from './engine.js';

const COLORS = Object.freeze({ rock: '#7d9195', toe: '#526d77', sand: '#d8bb83', fabric: '#197a75', walk: '#e4d9bd', water: '#4e91b4', ink: '#203f4a' });
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, digits = 2) => Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const xy = (v) => Number(v.toFixed(3));
const signed = (v) => `${v >= 0 ? '+' : ''}${fmt(v)}`;
const pt = (x, y) => ({ x, y });
let svgSequence = 0;

/** Geometry has the same normal-thickness strips and ideal toe as calculateTypical.
 * x runs from land to river; y is the source's assumed elevation datum, in metres.
 * No surveyed ground, full fill envelope, real alignment, or slab thickness is inferred.
 */
function geometry(input) {
  const p = { ...DEFAULT_INPUTS, ...input };
  const check = validateInputs(p);
  if (!check.valid) throw new RangeError(check.errors.join(' · '));
  const c = calculateTypical(p);
  const a = pt(0, p.crestLevel), b = pt(c.run, p.toeLevel);
  const normal = pt(-c.height / c.slopeLength, -c.run / c.slopeLength);
  const shift = (v, t) => pt(v.x + normal.x * t, v.y + normal.y * t);
  const ar = shift(a, p.rockThickness), br = shift(b, p.rockThickness);
  const as = shift(ar, p.sandMinThickness), bs = shift(br, p.sandMinThickness);
  const toe = [b, pt(b.x + p.toeTopWidth, b.y), pt(b.x + p.toeTopWidth + p.toeSlopeH * p.toeDepth, b.y - p.toeDepth), pt(b.x - p.toeSlopeH * p.toeDepth, b.y - p.toeDepth)];
  return { p, c, a, b, normal, face: [a, b, br, ar], sand: [ar, br, bs, as], fabric: [ar, br], toe, walk: [pt(-p.walkwayWidth, p.crestLevel), a] };
}

/** Pure SVG; Three.js is imported only when mounting the interactive scene. */
export function scenarioSectionOptions(scenario) {
  return { waterSource: 'scenario', water: {
    high: scenario.context.waterHighLevel, low: scenario.context.waterLowLevel,
    groundwater: scenario.context.groundwaterLevel,
  } };
}

export function typicalSectionSVG(inputs, { width = 1000, height = 420, water = { high: 99.10, survey: 97.30, low: 87.40 }, waterSource = 'reference' } = {}) {
  if (![width, height].every(Number.isFinite) || width < 600 || height < 360) throw new RangeError('รูปตัดต้องมีขนาดอย่างน้อย 600 × 360');
  const g = geometry(inputs), { p, c } = g;
  if (!['reference', 'scenario'].includes(waterSource)) throw new RangeError('ต้องระบุที่มาของระดับน้ำ');
  const levels = waterSource === 'reference' ? { high: 99.10, survey: 97.30, low: 87.40, ...water } : { ...water };
  if (!Object.entries(levels).every(([key, value]) => ['high', 'survey', 'low', 'groundwater'].includes(key)
    && (waterSource === 'scenario' && value === null || Number.isFinite(value)))) throw new RangeError('ระดับน้ำต้องเป็นตัวเลขที่มีค่าจำกัด หรือยังไม่ทราบ');
  const knownLevels = Object.values(levels).filter(Number.isFinite);
  const id = `s6006-section-${++svgSequence}`;
  const pts = [...g.face, ...g.sand, ...g.toe, ...g.walk];
  const loX = Math.min(...pts.map(v => v.x)) - 1.2, hiX = Math.max(...pts.map(v => v.x)) + 1.4;
  const loY = Math.min(...pts.map(v => v.y), ...knownLevels) - 1.1;
  const hiY = Math.max(p.crestLevel, ...knownLevels) + 1.4;
  const plot = { x: 70, y: 89, w: width - 285, h: height - 183 };
  const scale = Math.min(plot.w / (hiX - loX), plot.h / (hiY - loY));
  const padX = (plot.w - (hiX - loX) * scale) / 2, padY = (plot.h - (hiY - loY) * scale) / 2;
  const X = (x) => plot.x + padX + (x - loX) * scale;
  const Y = (y) => plot.y + padY + (hiY - y) * scale;
  const line = (x1, y1, x2, y2, attrs = '') => `<line x1="${xy(x1)}" y1="${xy(y1)}" x2="${xy(x2)}" y2="${xy(y2)}" ${attrs}/>`;
  const text = (x, y, value, attrs = '') => `<text x="${xy(x)}" y="${xy(y)}" ${attrs}>${esc(value)}</text>`;
  const polygon = (name, points, fill, stroke = COLORS.ink) => `<polygon data-component="${name}" points="${points.map(v => `${xy(X(v.x))},${xy(Y(v.y))}`).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1.1"/>`;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" id="${id}" role="img" aria-labelledby="${id}-title ${id}-desc" data-scale-x="${scale}" data-scale-y="${scale}" data-units="m">`,
    `<title id="${id}-title">S6006 รูปตัดอ้างอิง SD02 และมิติที่เลือก</title><desc id="${id}-desc">รูปตัดมีมาตราส่วนแกนเท่ากัน ระดับสมมุติตามแบบ หน้าหินและทรายเป็นแถบความหนาตั้งฉากลาด ตีนเขื่อนเป็นรูปคางหมูฐานราบสมมุติ ไม่มีผิวดินสำรวจหรือผลคำนวณเสถียรภาพ</desc>`,
    `<defs><pattern id="${id}-rock" width="23" height="20" patternUnits="userSpaceOnUse"><rect width="23" height="20" fill="#dde5e3"/><path d="M0 4 7 1 13 5 11 13 3 14ZM14 0 23 3 22 11 16 13 12 6M0 16 8 17 11 20M13 16 21 14 23 20" fill="none" stroke="#829796" stroke-width=".75"/></pattern><pattern id="${id}-sand" width="11" height="11" patternUnits="userSpaceOnUse"><rect width="11" height="11" fill="#f0dfbb"/><circle cx="2" cy="3" r=".7" fill="#c5a268"/><circle cx="8" cy="8" r=".65" fill="#c5a268"/></pattern></defs>`,
    `<style>#${id} text{font-family:Tahoma,'Noto Sans Thai',sans-serif;font-size:11px;fill:${COLORS.ink}} #${id} .title{font-size:16px;font-weight:700}.sub{font-size:10px;fill:#697d83}.mono{font-family:ui-monospace,monospace}.dim{stroke:#6b8189;stroke-width:1;fill:none}.small{font-size:10px}.halo{paint-order:stroke;stroke:#fbfcfa;stroke-width:5;stroke-linejoin:round}.water-label{fill:#347b9b;font-size:10px}.note{font-size:10px;fill:#7a6748}</style>`,
    `<rect width="${width}" height="${height}" rx="10" fill="#fbfcfa"/>`,
    text(20, 26, 'รูปตัดอ้างอิง · บ้านแดนเมือง', 'class="title"'),
    text(width - 20, 24, 'S6006–SD–02  ·  PDF 36 / แผ่น 35', 'text-anchor="end" class="small mono"'),
    text(20, 46, 'ระดับสมมุติตามแบบ (ไม่ใช่ระดับ รทก.) · แกน X/Y มาตราส่วนเท่ากัน · หน่วยเมตร', 'class="sub"'),
    text(width - 20, 46, 'ภาพเรขาคณิตตามมิติที่เลือก', 'text-anchor="end" class="sub"')];
  // Reference grid is a drawing grid, never a fabricated terrain line.
  const rawStep = (hiY - loY) / 5, power = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].find(v => v * power >= rawStep) * power;
  for (let z = Math.ceil(loY / step) * step; z <= hiY; z += step) {
    out.push(line(X(loX), Y(z), X(hiX), Y(z), 'stroke="#e9edE8" stroke-width=".8"'), text(X(loX) - 9, Y(z) + 3, fmt(z, 0), 'text-anchor="end" class="small mono"'));
  }
  out.push(polygon('sand-minimum-strip', g.sand, `url(#${id}-sand)`, '#b39766'));
  out.push(polygon('toe-ideal-trapezoid', g.toe, `url(#${id}-rock)`, COLORS.toe));
  out.push(polygon('facing-rock', g.face, `url(#${id}-rock)`));
  out.push(line(X(g.fabric[0].x), Y(g.fabric[0].y), X(g.fabric[1].x), Y(g.fabric[1].y), `stroke="${COLORS.fabric}" stroke-width="1.8" stroke-dasharray="5 2"`));
  out.push(line(X(g.walk[0].x), Y(g.walk[0].y), X(g.walk[1].x), Y(g.walk[1].y), `stroke="#a99473" stroke-width="4"`));
  out.push(line(X(0), Y(p.crestLevel) - 18, X(0), Y(p.crestLevel) + 24, 'stroke="#b78c47" stroke-width="1" stroke-dasharray="4 4"'));
  const dimH = (x1, x2, y, label, labelY = y - 7) => {
    out.push(line(X(x1), y, X(x2), y, 'class="dim"'));
    [x1, x2].forEach(x => out.push(line(X(x), y - 4, X(x), y + 4, 'class="dim"')));
    out.push(text((X(x1) + X(x2)) / 2, labelY, label, 'text-anchor="middle" class="small mono halo"'));
  };
  const topDimY = Y(p.crestLevel) - 29;
  dimH(-p.walkwayWidth, 0, topDimY, fmt(p.walkwayWidth));
  dimH(0, c.run, topDimY, `ระยะราบ ${fmt(c.run)} ม.`);
  // Walkway scope is labeled in the legend, clear of elevation ticks and dimensions.
  out.push(text(X(0) + 8, Y(p.crestLevel) - 9, `สันเขื่อน ${signed(p.crestLevel)}`, 'class="small halo"'));
  // The vertical dimension is independent of water-label leaders.
  const heightX = X(loX) - 32;
  out.push(line(heightX, Y(p.crestLevel), heightX, Y(p.toeLevel), 'class="dim"'));
  [p.crestLevel, p.toeLevel].forEach(y => out.push(line(heightX - 4, Y(y), heightX + 4, Y(y), 'class="dim"')));
  out.push(text(heightX - 9, (Y(p.crestLevel) + Y(p.toeLevel)) / 2, `H ${fmt(c.height)} ม.`, `text-anchor="middle" class="small mono" transform="rotate(-90 ${xy(heightX - 9)} ${xy((Y(p.crestLevel) + Y(p.toeLevel)) / 2)})"`));
  // Scenario levels remain context only; no pore-pressure field is inferred.
  const waterX = width - 202;
  for (const [key, label, dash] of [['high', 'น้ำสูง', '7 4'], ['survey', 'น้ำขณะสำรวจ', '3 3'], ['low', 'น้ำต่ำ', '7 4'], ['groundwater', 'น้ำใต้ดินอ้างอิง', '2 4']]) {
    if (!Number.isFinite(levels[key])) continue;
    const z = levels[key], faceX = Math.max(0, Math.min(c.run, (p.crestLevel - z) * p.slopeH));
    out.push(line(X(faceX), Y(z), width - 20, Y(z), `data-water-key="${key}" stroke="${COLORS.water}" stroke-width="1" stroke-dasharray="${dash}" opacity=".62"`));
    out.push(text(waterX, Y(z) - 5, `${label} ${fmt(z)} (${waterSource === 'reference' ? 'แบบ' : 'บริบทผู้ใช้'})`, 'class="water-label halo"'));
  }
  if (!knownLevels.length) out.push(text(waterX, 74, 'ยังไม่มีระดับน้ำของสถานการณ์นี้', 'class="water-label"'));
  const faceAt = (fraction, t = 0) => pt(c.run * fraction + g.normal.x * t, p.crestLevel - c.height * fraction + g.normal.y * t);
  const near = faceAt(.37), inner = faceAt(.37, p.rockThickness);
  out.push(line(X(near.x), Y(near.y), X(inner.x), Y(inner.y), 'stroke="#344f59" stroke-width="1.4"'));
  out.push(line(X(near.x), Y(near.y), X(near.x) + 25, Y(near.y) - 32, 'class="dim"'));
  out.push(text(X(near.x) + 29, Y(near.y) - 36, `ลาด ${fmt(p.slopeH, 2)}H : 1V`, 'class="small halo"'));
  out.push(text(X(near.x) + 29, Y(near.y) - 20, `หินหนา ${fmt(p.rockThickness)} ม. ตั้งฉากลาด`, 'class="small halo"'));
  const sandAt = faceAt(.47, p.rockThickness + p.sandMinThickness);
  out.push(line(X(sandAt.x), Y(sandAt.y), X(sandAt.x) - 22, Y(sandAt.y) + 26, 'class="dim"'));
  out.push(text(X(sandAt.x) - 26, Y(sandAt.y) + 37, `ทรายขั้นต่ำ ${fmt(p.sandMinThickness)} ม.*`, 'text-anchor="end" class="small halo"'));
  dimH(c.run, c.run + p.toeTopWidth, Y(p.toeLevel) - 25, `${fmt(p.toeTopWidth)} ม.`);
  out.push(text(X(c.run) - 8, Y(p.toeLevel) + 19, `ตีนเขื่อน ${signed(p.toeLevel)}`, 'text-anchor="end" class="small halo"'));
  const toeRight = c.run + p.toeTopWidth + p.toeSlopeH * p.toeDepth;
  const toeDimX = X(toeRight) + 12;
  out.push(line(toeDimX, Y(p.toeLevel), toeDimX, Y(p.toeLevel - p.toeDepth), 'class="dim"'));
  [p.toeLevel, p.toeLevel - p.toeDepth].forEach(z => out.push(line(toeDimX - 4, Y(z), toeDimX + 4, Y(z), 'class="dim"')));
  out.push(text(toeDimX + 8, Y(p.toeLevel - p.toeDepth) + 6, `ลึก ${fmt(p.toeDepth)} ม.*`, 'class="small halo"'));
  out.push(text(X(c.run + p.toeTopWidth / 2), Y(p.toeLevel - p.toeDepth) + 20, `ลาดข้าง ${fmt(p.toeSlopeH, 1)}H : 1V · ฐานราบสมมุติ`, 'text-anchor="middle" class="small"'));
  const footerY = height - 67;
  const legend = [[COLORS.rock, 'หินเรียง'], [COLORS.sand, 'ทรายขั้นต่ำ'], [COLORS.fabric, 'ใยสังเคราะห์'], [COLORS.walk, 'ทางเท้า: แสดงเฉพาะผิว']];
  legend.forEach(([color, label], i) => {
    const lx = 20 + i * 133;
    out.push(`<rect x="${lx}" y="${footerY - 10}" width="12" height="9" rx="2" fill="${color}"/>`, text(lx + 18, footerY - 1, label, 'class="small"'+(color === COLORS.walk ? ' data-annotation="walkway"' : '')));
  });
  out.push(text(20, height - 43, '* ทรายเป็นแถบขั้นต่ำสมมุติ; ตีนเขื่อนฐานราบสมมาตร H ขั้นต่ำในแบบ 2 ม. รูปจริงต้องใช้พื้นท้องน้ำแต่ละหน้าตัด', 'class="note"'));
  out.push(text(20, height - 25, 'ยังไม่หักส่วนซ้อนที่รอยต่อและปลายงาน · ไม่แสดงดินสำรวจ/ปริมาตรถมทั้งหมด · ไม่ใช่แบบก่อสร้าง', 'class="note"'));
  out.push(text(20, height - 9, 'ต้นแบบ: S6006–SD–02, PDF 36 · ' + (waterSource === 'reference' ? 'ระดับน้ำคงตามแบบอ้างอิง' : 'ระดับน้ำเป็นบริบทสถานการณ์ ไม่ใช่ผลวิเคราะห์แรงดันน้ำ'), 'class="sub"'));
  return out.join('\n') + '</svg>';
}

/** Interactive 100 m straight illustrative segment; no actual route is implied.
 * Returns synchronously. .ready resolves when WebGL succeeds or its fallback is shown.
 */
export function mountCaseScene(container, inputs) {
  if (!container || typeof container.append !== 'function') throw new TypeError('ต้องมีพื้นที่แสดงภาพ 3D');
  let current = geometry(inputs), view = 'iso', disposed = false, runtime = null;
  const doc = container.ownerDocument, root = doc.createElement('div');
  Object.assign(root.style, { position: 'relative', width: '100%', height: '100%', minHeight: '280px', overflow: 'hidden', background: '#edf2ef' });
  const caption = doc.createElement('div');
  Object.assign(caption.style, { position: 'absolute', left: '14px', right: '14px', bottom: '12px', zIndex: '3', pointerEvents: 'none', font: '11px/1.65 Tahoma,sans-serif', color: '#34545f', padding: '9px 12px', borderRadius: '8px', background: '#fffffff0', boxShadow: '0 2px 12px #203f4a0d' });
  caption.textContent = 'กำลังเตรียมภาพ 3D…';
  root.append(caption); container.replaceChildren(root);
  const api = {
    update(next) { current = geometry(next); runtime?.rebuild(current); },
    setView(next) { if (!['iso', 'section', 'top'].includes(next)) throw new RangeError('มุมมองต้องเป็น iso, section หรือ top'); view = next; runtime?.fit(view); },
    fit() { runtime?.fit(view); },
    dispose() { if (disposed) return; disposed = true; runtime?.dispose(); root.remove(); },
    ready: null,
  };
  api.ready = Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]).then(([THREE, { OrbitControls }]) => {
    if (disposed) return api;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
    catch { caption.textContent = 'เปิด WebGL ไม่ได้ · ใช้รูปตัด 2D ด้านล่างได้ · ภาพนี้ใช้แนวตรงสมมุติ 100 ม.'; return api; }
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.setClearColor('#edf2ef');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', 'แบบจำลอง S6006 แนวตรงสมมุติ 100 เมตร ลากเพื่อหมุน เลื่อนเพื่อซูม ไม่มีดินสำรวจ');
    Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
    root.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#927954', 2.1));
    const sun = new THREE.DirectionalLight('#fff7e5', 2.8); sun.position.set(-40, 70, 45); scene.add(sun);
    const fill = new THREE.DirectionalLight('#d8efff', 1.4); fill.position.set(70, 25, -60); scene.add(fill);
    const camera = new THREE.PerspectiveCamera(35, 1, .05, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .09; controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * .94;
    let model = null, frame = 0, redraw = true, first = true;
    let box = new THREE.Box3(), labels = [];
    const textureCanvas = doc.createElement('canvas'); textureCanvas.width = 256; textureCanvas.height = 256;
    const ctx = textureCanvas.getContext('2d');
    let rockTexture = null;
    if (ctx) {
      ctx.fillStyle = '#cad3d0'; ctx.fillRect(0, 0, 256, 256);
      let seed = 6006; const rand = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
      for (let row = -1; row < 9; row++) for (let col = -1; col < 9; col++) {
        const x = col * 35 + (row % 2) * 17, y = row * 32;
        const shade = Math.floor(155 + rand() * 38);
        ctx.fillStyle = `rgb(${shade},${shade + 12},${shade + 10})`; ctx.strokeStyle = '#697d7a'; ctx.lineWidth = 1.7;
        ctx.beginPath(); ctx.moveTo(x + 4, y + 3); ctx.lineTo(x + 26, y); ctx.lineTo(x + 34, y + 12); ctx.lineTo(x + 27, y + 28); ctx.lineTo(x + 10, y + 32); ctx.lineTo(x, y + 19); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      rockTexture = new THREE.CanvasTexture(textureCanvas); rockTexture.colorSpace = THREE.SRGBColorSpace;
      rockTexture.wrapS = rockTexture.wrapT = THREE.RepeatWrapping; rockTexture.repeat.set(.38, .38);
      rockTexture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    }
    function disposeModel() {
      if (!model) return;
      scene.remove(model);
      model.traverse(o => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material?.dispose(); });
      labels.forEach(l => l.element.remove()); labels = []; model = null;
    }
    function label(value, at, placement = 'above', color = '#24434e') {
      const el = doc.createElement('div'); el.textContent = value;
      Object.assign(el.style, { position: 'absolute', top: '0', left: '0', color, font: '600 10px/1.5 Tahoma,sans-serif', padding: '3px 6px', borderRadius: '4px', background: '#fffffff0', border: '1px solid #dfe7e2', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: '2' });
      if (placement === 'below') {
        const leader = doc.createElement('span');
        Object.assign(leader.style, { position: 'absolute', left: '50%', top: '-13px', width: '1px', height: '12px', background: '#738c91' });
        el.append(leader);
      }
      root.append(el); labels.push({ element: el, point: at, placement });
    }
    function renderLines(points, color = '#536b71', dash = false) {
      const mat = dash ? new THREE.LineDashedMaterial({ color, dashSize: .8, gapSize: .5, transparent: true, opacity: .8 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity: .75 });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), mat);
      if (dash) line.computeLineDistances(); model.add(line); return line;
    }
    function rebuild(g) {
      const oldCenter = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      disposeModel(); model = new THREE.Group();
      const midX = (Math.min(...g.walk.map(p => p.x)) + Math.max(...g.toe.map(p => p.x))) / 2;
      const local = (p, z) => new THREE.Vector3(p.x - midX, p.y - g.p.toeLevel, z);
      function prism(points, color, textured = false) {
        const shape = new THREE.Shape(); points.forEach((p, i) => i ? shape.lineTo(p.x - midX, p.y - g.p.toeLevel) : shape.moveTo(p.x - midX, p.y - g.p.toeLevel)); shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 100, bevelEnabled: false, steps: 1 }); geo.translate(0, 0, -50);
        const mat = new THREE.MeshStandardMaterial({ color, roughness: .94, metalness: 0, map: textured ? rockTexture : null, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
        const mesh = new THREE.Mesh(geo, mat); model.add(mesh);
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: '#435a60', transparent: true, opacity: .58 })); model.add(edge);
      }
      prism(g.sand, COLORS.sand);
      prism(g.toe, '#a7babd', true);
      prism(g.face, '#c2cecb', true);
      function surface(a, b, color, opacity = 1) {
        const vertices = [local(a, -50), local(b, -50), local(b, 50), local(a, 50)];
        const geo = new THREE.BufferGeometry().setFromPoints(vertices); geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: .85, transparent: opacity < 1, opacity, depthWrite: opacity === 1 });
        const mesh = new THREE.Mesh(geo, mat); model.add(mesh); return mesh;
      }
      surface(g.walk[0], g.walk[1], COLORS.walk);
      // Fabric is a zero-thickness interface, marked on the exposed section ends.
      for (const z of [-50.015, 50.015]) renderLines(g.fabric.map(p => local(p, z)), COLORS.fabric);
      renderLines([local(g.walk[0], -50), local(g.walk[0], 50)], '#a58b64');
      renderLines([local(g.a, -50), local(g.a, 50)], '#ad884a', true);
      const frontZ = 50.04;
      label(`สัน ${signed(g.p.crestLevel)} · ระดับสมมุติ`, local(g.a, frontZ));
      label(`ตีน ${signed(g.p.toeLevel)}`, local(g.b, frontZ));
      label('0 ม. สมมุติ', local(g.walk[0], -50));
      // Keep the near-end station below its exact anchor, clear of the crest label.
      label('100 ม. สมมุติ', local(g.walk[0], 50), 'below');
      scene.add(model); box = new THREE.Box3().setFromObject(model);
      caption.textContent = `แนวตรงสมมุติ 100 ม. · ไม่ใช่แนวสำรวจ/UTM · ลาด ${fmt(g.p.slopeH, 1)}H:1V · หินหนาตั้งฉาก ${fmt(g.p.rockThickness)} ม. · ทรายแถบขั้นต่ำ/ตีนฐานราบสมมุติ · ทางเท้าแสดงเฉพาะผิว`;
      if (first) { first = false; fit(view); }
      else { const delta = box.getCenter(new THREE.Vector3()).sub(oldCenter); camera.position.add(delta); controls.target.add(delta); }
      redraw = true;
    }
    function fit(mode = 'iso') {
      const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
      let direction, spanH, spanV, depth;
      if (mode === 'section') { direction = new THREE.Vector3(0, 0, 1); spanH = size.x; spanV = size.y; depth = size.z; }
      else if (mode === 'top') { direction = new THREE.Vector3(0, 1, .001); spanH = size.x; spanV = size.z; depth = size.y; }
      else { direction = new THREE.Vector3(.85, .6, 1.15).normalize(); spanH = Math.hypot(size.x, size.z); spanV = Math.hypot(size.y, size.z * .45); depth = Math.hypot(size.x, size.y, size.z); }
      const distance = Math.max(spanH / (2 * Math.tan(hfov / 2)), spanV / (2 * Math.tan(vfov / 2))) * 1.18 + depth * .5;
      controls.target.copy(center); camera.up.set(0, 1, 0); camera.position.copy(center).addScaledVector(direction, distance); camera.lookAt(center);
      controls.minDistance = 2; controls.maxDistance = Math.max(2000, distance * 6); controls.update(); redraw = true;
    }
    let previousWidth = 0, previousHeight = 0;
    function resize() {
      const w = root.clientWidth, h = Math.max(root.clientHeight, 280);
      if (w <= 0) return;
      const changed = w !== previousWidth || h !== previousHeight;
      previousWidth = w; previousHeight = h;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      if (changed && model) fit(view);
      redraw = true;
    }
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(root); if (!resizeObserver) globalThis.addEventListener?.('resize', resize);
    controls.addEventListener('change', () => { redraw = true; });
    runtime = {
      rebuild, fit,
      dispose() { cancelAnimationFrame(frame); resizeObserver?.disconnect(); if (!resizeObserver) globalThis.removeEventListener?.('resize', resize); controls.dispose(); disposeModel(); rockTexture?.dispose(); renderer.dispose(); },
    };
    function tick() {
      if (disposed) return;
      const changed = controls.update();
      if (redraw || changed) {
        renderer.render(scene, camera);
        const w = root.clientWidth, h = root.clientHeight;
        labels.forEach(({ element, point, placement }) => {
          const q = point.clone().project(camera);
          element.style.display = q.z > 1 || q.z < -1 || Math.abs(q.x) > 1.1 || Math.abs(q.y) > 1.1 ? 'none' : '';
          element.style.transform = `translate(${(q.x + 1) / 2 * w}px,${(1 - q.y) / 2 * h}px) translate(-50%,${placement === 'below' ? '12px' : '-135%'})`;
        });
        redraw = false;
      }
      frame = requestAnimationFrame(tick);
    }
    resize(); rebuild(current); tick(); return api;
  }).catch(() => {
    if (!disposed) caption.textContent = 'เปิดภาพ 3D ไม่ได้ · ใช้รูปตัด 2D ได้ · ภาพนี้เป็นแนวตรงสมมุติ 100 ม. ไม่มีผิวดินสำรวจ';
    return api;
  });
  return api;
}
