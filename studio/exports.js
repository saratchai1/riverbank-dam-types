import {
  buildSection, lengthOf, pointAt, surveyStations, groundSection,
  quantityRows, analysisRows, projectRevision, validateProject, formatStation,
} from './core.js';

const round = (v) => Math.abs(v) < 1e-10 ? '0' : String(Number(Number(v).toFixed(8)));
const textCell = (v) => {
  let s = String(v ?? '');
  // Spreadsheet formula protection applies to text only; signed numeric values stay numbers.
  if (/^[\s\uFEFF]*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
export const csvCell = (v) => typeof v === 'number' && Number.isFinite(v) ? round(v) : textCell(v);
const csv = (rows) => '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function assertProject(p) {
  const check = validateProject(p);
  if (!check.valid) throw new Error(`ข้อมูลโครงการไม่ถูกต้อง: ${check.errors.join('; ')}`);
}

export function projectJSON(p) {
  assertProject(p);
  return JSON.stringify(p, null, 2) + '\n';
}

export function parseProjectJSON(text) {
  let p;
  try { p = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('อ่าน JSON ไม่ได้: ตรวจว่าเลือกไฟล์โครงการที่บันทึกจากระบบ'); }
  assertProject(p);
  return p;
}

export function quantityCSV(p) {
  assertProject(p);
  return csv([
    ['project', 'type', 'code', 'description', 'unit', 'quantity', 'material_rate', 'labour_rate', 'amount', 'price_source', 'formula', 'assumption', 'revision', 'status'],
    ...quantityRows(p).map((r) => [p.name, p.geometry.type, r.code, r.name, r.unit, r.quantity,
      r.materialRate, r.labourRate, r.amount, r.priceSource, r.formula, r.assumption,
      projectRevision(p), 'CONCEPT / DRAFT — ปริมาณเฉพาะองค์ประกอบที่แสดง; ไม่ใช่ ปร.4 ฉบับอนุมัติ']),
  ]);
}

export function surveyCSV(p) {
  assertProject(p);
  return csv([
    ['station', 'offset', 'elevation', 'source'],
    ...p.survey.map((r) => [r.station, r.offset, r.elevation, p.sources.survey.name]),
  ]);
}

export function analysisCSV(p) {
  assertProject(p);
  const revision = projectRevision(p);
  return csv([
    ['station', 'case', 'fs', 'reference', 'status', 'current_revision', 'result_revision'],
    ...analysisRows(p).map((r) => [r.station, r.case, r.fs, r.reference, r.status, revision,
      p.analysis.find((a) => Math.abs(a.station - r.station) < 1e-6 && a.case === r.case)?.revision ?? '']),
  ]);
}

export function pileCSV(p) {
  assertProject(p);
  const sec = buildSection(p, 0);
  const rows = [['pile_id', 'station', 'easting', 'northing', 'top_elevation', 'bottom_elevation', 'size', 'length', 'family', 'status']];
  for (const pile of sec.piles) {
    const count = Math.floor((lengthOf(p.alignment) + 1e-7) / pile.spacing) + 1;
    if (count > 100000) throw new Error('จำนวนเสาเข็มเกิน 100,000 ต้น กรุณาแบ่งโครงการก่อนส่งออก');
    for (let i = 0; i < count; i++) {
      const station = i * pile.spacing, at = pointAt(p.alignment, station);
      rows.push([`${pile.id}-${String(i + 1).padStart(4, '0')}`, station,
        at.x + at.nx * pile.top.offset, at.y + at.ny * pile.top.offset,
        pile.top.elevation, pile.bottom.elevation, pile.size,
        Math.hypot(pile.top.elevation - pile.bottom.elevation, pile.top.offset - pile.bottom.offset),
        pile.family, 'CONCEPT / DRAFT — one front row; not a construction setting-out schedule']);
    }
  }
  return csv(rows);
}

function dxfText(value) {
  // ASCII DXF uses Unicode escape sequences for non-ASCII titles.
  return String(value).replace(/[\r\n\x00-\x1f]/g, ' ').replace(/[^\x20-\x7e]/g,
    (c) => `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
}

export function sectionDXF(p, station = p.selectedStation) {
  assertProject(p);
  const s = buildSection(p, station), lines = [];
  const add = (...pairs) => pairs.forEach(([code, value]) => { lines.push(String(code), String(value)); });
  add([0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1015'], [9, '$INSUNITS'], [70, 6],
    [9, '$MEASUREMENT'], [70, 1], [0, 'ENDSEC']);
  const layers = [...new Set(['DRAFT', 'GROUND', 'WATER_HIGH', 'WATER_LOW', 'WATER_SURVEY', ...s.polygons.map((v) => layerName(v.id)), ...s.piles.map((v) => layerName(v.id))])];
  add([0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [5, '10'], [100, 'AcDbSymbolTable'], [70, layers.length]);
  layers.forEach((name, i) => add([0, 'LAYER'], [5, (0x20 + i).toString(16).toUpperCase()], [330, '10'], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbLayerTableRecord'],
    [2, name], [70, 0], [62, name.startsWith('WATER') ? 4 : name === 'GROUND' ? 3 : name === 'DRAFT' ? 1 : i % 6 + 1], [6, 'CONTINUOUS']));
  add([0, 'ENDTAB'], [0, 'ENDSEC'], [0, 'SECTION'], [2, 'ENTITIES']);
  const poly = (pts, layer, closed) => {
    if (pts.length < 2) return;
    add([0, 'LWPOLYLINE'], [100, 'AcDbEntity'], [8, layer], [100, 'AcDbPolyline'], [90, pts.length], [70, closed ? 1 : 0]);
    pts.forEach((v) => add([10, round(v.offset)], [20, round(v.elevation)]));
  };
  s.polygons.forEach((v) => poly(v.points, layerName(v.id), true));
  s.piles.forEach((v) => poly([
    { offset: v.top.offset - v.size / 2, elevation: v.top.elevation },
    { offset: v.top.offset + v.size / 2, elevation: v.top.elevation },
    { offset: v.bottom.offset + v.size / 2, elevation: v.bottom.elevation },
    { offset: v.bottom.offset - v.size / 2, elevation: v.bottom.elevation },
  ], layerName(v.id), true));
  poly(s.ground, 'GROUND', false);
  const all = [...s.polygons.flatMap((v) => v.points), ...s.ground];
  const minX = Math.min(-5, ...all.map((v) => v.offset)) - 2;
  const maxX = Math.max(5, ...all.map((v) => v.offset)) + 2;
  for (const [key, level] of [['HIGH', p.water.high], ['LOW', p.water.low], ['SURVEY', p.water.survey]]) {
    poly([{ offset: minX, elevation: level }, { offset: 0, elevation: level }], `WATER_${key}`, false);
  }
  add([0, 'TEXT'], [100, 'AcDbEntity'], [8, 'DRAFT'], [100, 'AcDbText'], [10, round(minX)], [20, round(p.geometry.crestLevel + 2)],
    [40, round(Math.max(0.15, (maxX - minX) / 100))], [1, dxfText(`${p.code} | ${p.geometry.type} | STA ${formatStation(station)} | CONCEPT / DRAFT - NOT FOR CONSTRUCTION`)]);
  add([0, 'ENDSEC'], [0, 'EOF']);
  return lines.join('\r\n') + '\r\n';
}

const layerName = (name) => `C_${String(name).toUpperCase().replace(/[^A-Z0-9_-]/g, '_')}`;

/** Shared pure mesh generator, in absolute Easting/Northing/Elevation (Z-up), metres.
 * Drawing section rings and takeoff dimensions originate in buildSection.
 * The scene may request decimation; OBJ export rejects excessive counts instead.
 */
export function conceptMesh(p, { maxPiles = 1000, maxSegments = 240, includeGround = true, includeWater = true } = {}) {
  assertProject(p);
  if (p.alignment.length > 5000 || p.survey.length > 20000) throw new Error('ภาพ 3D รองรับแนวเขื่อนไม่เกิน 5,000 จุดและสำรวจไม่เกิน 20,000 จุดต่อช่วง กรุณาแบ่งช่วงก่อนสร้างแบบจำลอง');
  const L = lengthOf(p.alignment);
  const sec = buildSection(p, 0), parts = [], warnings = [];
  let cumulative = 0;
  const chainages = [0];
  p.alignment.slice(1).forEach((pt, i) => { cumulative += Math.hypot(pt.x - p.alignment[i].x, pt.y - p.alignment[i].y); chainages.push(cumulative); });
  // Keep every alignment vertex so a corner cannot be replaced by a straight shortcut.
  const stationSet = new Set([...chainages, ...surveyStations(p).filter((v) => v >= 0 && v <= L)]);
  const regular = Math.min(maxSegments, Math.max(2, Math.ceil(L / 2)));
  for (let i = 0; i <= regular; i++) stationSet.add(L * i / regular);
  const stations = [...stationSet].sort((a, b) => a - b).filter((v, i, a) => !i || v - a[i - 1] > 1e-7);
  const world = (station, v) => {
    const at = pointAt(p.alignment, station);
    return [at.x + at.nx * v.offset, at.y + at.ny * v.offset, v.elevation];
  };
  for (const shape of sec.polygons) {
    const ringPoints = [...shape.points];
    const winding = ringPoints.reduce((sum, v, i) => sum + v.offset * ringPoints[(i + 1) % ringPoints.length].elevation - ringPoints[(i + 1) % ringPoints.length].offset * v.elevation, 0);
    if (winding < 0) ringPoints.reverse();
    const vertices = stations.flatMap((station) => ringPoints.map((v) => world(station, v)));
    const faces = [], n = ringPoints.length;
    for (let ring = 0; ring < stations.length - 1; ring++) {
      for (let j = 0; j < n; j++) {
        const a = ring * n + j, b = ring * n + (j + 1) % n;
        faces.push([a, b, b + n, a + n]);
      }
    }
    const cap = triangulate(ringPoints.map((v) => [v.offset, v.elevation]));
    cap.forEach((face) => { faces.push([...face].reverse()); faces.push(face.map((v) => (stations.length - 1) * n + v)); });
    parts.push({ id: shape.id, family: shape.family, name: shape.name, layer: 'structure', color: shape.color || '#ced3ca', vertices, faces });
  }
  for (const pile of sec.piles) {
    const count = Math.floor((L + 1e-7) / pile.spacing) + 1;
    const stride = Math.max(1, Math.ceil(count / maxPiles));
    if (stride > 1) warnings.push(`แสดงเสาเข็มทุก ${stride} ต้นจากทั้งหมด ${count.toLocaleString('en-US')} ต้น; ตารางปริมาณยังนับครบ`);
    const vertices = [], faces = [];
    for (let i = 0; i < count; i += stride) {
      const station = i * pile.spacing, at = pointAt(p.alignment, station), base = vertices.length;
      for (const end of [pile.top, pile.bottom]) {
        for (const [along, across] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const half = pile.size / 2;
          vertices.push([at.x + at.ny * along * half + at.nx * (end.offset + across * half),
            at.y - at.nx * along * half + at.ny * (end.offset + across * half), end.elevation]);
        }
      }
      [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].forEach((face) => faces.push(face.map((v) => v + base)));
    }
    parts.push({ id: pile.id, family: pile.family, name: pile.name, layer: 'piles', color: '#7b8d96', vertices, faces });
  }
  if (includeGround || includeWater) {
    const ground = { id: 'survey-ground', name: 'ผิวสำรวจ', layer: 'ground', color: '#b9bf9e', vertices: [], faces: [] };
    const water = { id: 'survey-water', name: 'น้ำขณะสำรวจ', layer: 'water', color: '#4e9abb', vertices: [], faces: [] };
    for (let i = 1; i < stations.length; i++) {
      const a = groundSection(p, stations[i - 1]), b = groundSection(p, stations[i]);
      if (!a.length || !b.length) continue;
      const lo = Math.max(a[0].offset, b[0].offset), hi = Math.min(a.at(-1).offset, b.at(-1).offset);
      if (hi <= lo) continue;
      const offsets = [...new Set([lo, hi, ...a.map((v) => v.offset), ...b.map((v) => v.offset)].filter((v) => v >= lo && v <= hi))].sort((x, y) => x - y);
      for (let j = 1; j < offsets.length; j++) {
        const x0 = offsets[j - 1], x1 = offsets[j];
        const vertices = [world(stations[i - 1], { offset: x0, elevation: interpolate(a, x0) }),
          world(stations[i - 1], { offset: x1, elevation: interpolate(a, x1) }),
          world(stations[i], { offset: x1, elevation: interpolate(b, x1) }),
          world(stations[i], { offset: x0, elevation: interpolate(b, x0) })];
        const n = ground.vertices.length;
        ground.vertices.push(...vertices); ground.faces.push([n, n + 1, n + 2, n + 3]);
      }
      for (const ia of submergedIntervals(a, p.water.survey)) {
        for (const ib of submergedIntervals(b, p.water.survey)) {
          const x0 = Math.max(lo, ia[0], ib[0]), x1 = Math.min(hi, ia[1], ib[1], 0);
          if (x1 <= x0) continue;
          const n = water.vertices.length;
          water.vertices.push(world(stations[i - 1], { offset: x0, elevation: p.water.survey }),
            world(stations[i - 1], { offset: x1, elevation: p.water.survey }),
            world(stations[i], { offset: x1, elevation: p.water.survey }),
            world(stations[i], { offset: x0, elevation: p.water.survey }));
          water.faces.push([n, n + 1, n + 2, n + 3]);
        }
      }
    }
    if (includeGround && ground.vertices.length) parts.push(ground);
    if (includeWater && water.vertices.length) parts.push(water);
  }
  return { parts, warnings, stations, revision: projectRevision(p) };
}

function interpolate(profile, x) {
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i];
    if (x >= a.offset - 1e-8 && x <= b.offset + 1e-8) return a.elevation + (b.elevation - a.elevation) * (x - a.offset) / (b.offset - a.offset);
  }
  return profile.at(-1).elevation;
}

function submergedIntervals(profile, level) {
  const out = [];
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i];
    if (a.elevation > level && b.elevation > level) continue;
    const cross = a.elevation === b.elevation ? a.offset : a.offset + (b.offset - a.offset) * (level - a.elevation) / (b.elevation - a.elevation);
    out.push([a.elevation <= level ? a.offset : cross, b.elevation <= level ? b.offset : cross]);
  }
  return out;
}

/** Ear clipping permits concave section polygons without filling across a notch. */
export function triangulate(points) {
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const signed = points.reduce((s, p, i) => s + p[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * p[1], 0);
  const indices = Array.from({ length: points.length }, (_, i) => i);
  if (signed < 0) indices.reverse();
  const out = [], epsilon = 1e-10;
  let guard = points.length * points.length;
  while (indices.length > 3 && guard-- > 0) {
    let found = false;
    for (let i = 0; i < indices.length; i++) {
      const a = indices[(i - 1 + indices.length) % indices.length], b = indices[i], c = indices[(i + 1) % indices.length];
      if (cross(points[a], points[b], points[c]) <= epsilon) continue;
      const contains = indices.some((j) => ![a, b, c].includes(j) &&
        cross(points[a], points[b], points[j]) >= -epsilon && cross(points[b], points[c], points[j]) >= -epsilon && cross(points[c], points[a], points[j]) >= -epsilon);
      if (contains) continue;
      out.push([a, b, c]); indices.splice(i, 1); found = true; break;
    }
    if (!found) throw new Error('รูปหน้าตัดซ้อนกันหรือเสื่อมรูป ไม่สามารถสร้างผิวแบบจำลองได้');
  }
  if (indices.length === 3) out.push(indices);
  return out;
}

export function sceneOBJ(p) {
  assertProject(p);
  const mesh = conceptMesh(p, { maxPiles: 5000, maxSegments: 300 });
  if (mesh.warnings.length) throw new Error('แบบจำลองเกิน 5,000 เสาเข็ม กรุณาแบ่งช่วงโครงการก่อนส่งออก OBJ; ไม่ส่งออกแบบลดจำนวน');
  const lines = [
    '# Riverbank Design Workspace — CONCEPT / DRAFT, not for construction',
    '# Coordinates: absolute Easting, Northing, Elevation. Units: metres. Z-up.',
    '# Constant conceptual section swept along alignment; imported survey surface only.',
    `# Revision: ${projectRevision(p)}`,
  ];
  let base = 1;
  mesh.parts.forEach((part) => {
    lines.push(`o ${part.id.replace(/[^A-Za-z0-9_-]/g, '_')}`);
    part.vertices.forEach((v) => lines.push(`v ${v.map(round).join(' ')}`));
    part.faces.forEach((face) => lines.push(`f ${face.map((i) => i + base).join(' ')}`));
    base += part.vertices.length;
  });
  return lines.join('\n') + '\n';
}
