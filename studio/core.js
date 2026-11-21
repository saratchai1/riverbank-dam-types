// Shared deterministic project model. Metres, absolute elevations and kN.
// No factor of safety or geotechnical capacity is calculated by this module.

const EPS = 1e-7;
const MAX_ROWS = 100000;
const MAX_ALIGNMENT_POINTS = 20000;
const MAX_SURVEY_POINTS = 50000;
const MAX_LENGTH = 100000;
const CASES = [
  ['construction', 'ระหว่างก่อสร้าง'],
  ['low-water', 'น้ำระดับต่ำ'],
  ['drawdown', 'น้ำลดเร็ว']
];
const DIMENSIONS = ['deckWidth', 'deckThickness', 'pileSize', 'pileLength', 'pileSpacing', 'panelThickness', 'capWidth', 'capDepth', 'slopeH', 'rockThickness', 'filterThickness', 'toeWidth', 'toeHeight'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const near = (a, b) => Math.abs(a - b) <= EPS;
const textOK = value => typeof value === 'string' && value.length <= 5000;

// Imported JSON is later copied into the active project. Reject keys that could
// alter a target object's prototype, and reject pathological trees before hash,
// cloning or persistence traverses optional user-provided data.
function assertPlainJSON(root) {
  const stack = [{value:root,depth:0}], seen = new WeakSet();
  let count = 0;
  while (stack.length) {
    const {value,depth} = stack.pop();
    if (++count > 1000000 || depth > 32) throw new Error('โครงการมีข้อมูลซ้อนลึกหรือจำนวนรายการมากเกินไป กรุณาแบ่งช่วงข้อมูล');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number') {if (!Number.isFinite(value)) throw new Error('ข้อมูล JSON ต้องไม่มี NaN/Infinity'); continue;}
    if (typeof value !== 'object') throw new Error('โครงการต้องประกอบด้วยข้อมูล JSON เท่านั้น');
    if (seen.has(value)) throw new Error('โครงการต้องไม่มีข้อมูลวนซ้ำหรือ object อ้างอิงร่วม');
    seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new Error('โครงการมี prototype ที่ไม่รองรับ');
    for (const [key,child] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(key)) throw new Error(`ไม่อนุญาตชื่อข้อมูลสงวน ${key}`);
      stack.push({value:child,depth:depth+1});
    }
  }
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

export function lengthOf(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    if (!isObject(points[i]) || !finite(points[i].x) || !finite(points[i].y)) return NaN;
    if (i) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}

export function pointAt(points, station) {
  const length = lengthOf(points);
  if (!(length > 0) || !finite(station)) return {x:0, y:0, nx:0, ny:1};
  const target = Math.max(0, Math.min(length, station));
  let covered = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y, span = Math.hypot(dx, dy);
    if (span <= EPS) continue;
    if (target <= covered + span + EPS) {
      const t = Math.max(0, Math.min(1, (target - covered) / span));
      return {x:a.x + dx * t, y:a.y + dy * t, nx:(-dy / span)||0, ny:(dx / span)||0};
    }
    covered += span;
  }
  const a = points[points.length - 2], b = points[points.length - 1];
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  return {x:b.x, y:b.y, nx:span ? (-(b.y - a.y) / span)||0 : 0, ny:span ? ((b.x - a.x) / span)||0 : 1};
}

function numberValue(value, label) {
  const s = typeof value === 'string' ? value.trim() : value;
  if (typeof s !== 'number' && (typeof s !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s))) {
    throw new Error(`${label}: ต้องเป็นตัวเลขและห้ามเว้นว่าง`);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`${label}: ตัวเลขต้องมีค่าจำกัด`);
  return Object.is(n, -0) ? 0 : n;
}

export function parseStation(value) {
  let n;
  if (typeof value === 'string' && value.includes('+')) {
    const match = /^(\d+)\+(\d{1,3}(?:\.\d+)?)$/.exec(value.trim());
    if (!match || Number(match[2]) >= 1000) throw new Error(`สถานี ${value}: ใช้รูปแบบ 0+025.50 หรือระยะเป็นเมตร`);
    n = Number(match[1]) * 1000 + Number(match[2]);
  } else n = numberValue(value, 'สถานี');
  if (!finite(n) || n < 0 || n > MAX_LENGTH) throw new Error('สถานีต้องอยู่ในช่วง 0–100000 เมตร');
  return n;
}

export function formatStation(metres) {
  if (!finite(metres) || metres < 0) return '—';
  const rounded = Math.round(metres * 1000) / 1000;
  const km = Math.floor(rounded / 1000);
  const part = (rounded - km * 1000).toFixed(3).replace(/\.?0+$/, '');
  const [whole = '0', fraction] = part.split('.');
  return `${km}+${whole.padStart(3, '0')}${fraction ? '.' + fraction : ''}`;
}

// A small strict CSV reader: quoted fields, escaped quotes, CRLF and quoted newlines.
// A bad row never silently disappears from an engineering input file.
function readCSV(text) {
  if (typeof text !== 'string' || text.length > 20000000) throw new Error('CSV ต้องเป็นข้อความขนาดไม่เกิน 20 MB');
  const input = text.replace(/^\uFEFF/, '');
  const counts = {',':0, ';':0, '\t':0};
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '"') {
      if (quoted && input[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && /[\r\n]/.test(input[i])) break;
    else if (!quoted && input[i] in counts) counts[input[i]]++;
  }
  const separator = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = [];
  let row = [], cell = '', inQuote = false, afterQuote = false;
  const endCell = () => { row.push(cell.trim()); cell = ''; afterQuote = false; };
  const endRow = () => {
    endCell();
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS + 1) throw new Error(`CSV มีข้อมูลเกิน ${MAX_ROWS} แถว`);
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuote) {
      if (c === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else { inQuote = false; afterQuote = true; }
      } else cell += c;
    } else if (c === separator) endCell();
    else if (c === '\n' || c === '\r') { endRow(); if (c === '\r' && input[i + 1] === '\n') i++; }
    else if (c === '"') {
      if (cell.trim() !== '' || afterQuote) throw new Error(`CSV แถว ${rows.length + 1}: เครื่องหมายคำพูดไม่ถูกต้อง`);
      cell = ''; inQuote = true;
    } else if (afterQuote && c.trim() !== '') throw new Error(`CSV แถว ${rows.length + 1}: มีข้อความหลังปิดเครื่องหมายคำพูด`);
    else if (!afterQuote) cell += c;
  }
  if (inQuote) throw new Error('CSV มีเครื่องหมายคำพูดที่ยังไม่ปิด');
  if (cell !== '' || row.length || afterQuote) endRow();
  if (rows.length < 2) throw new Error('CSV ต้องมีหัวตารางและข้อมูลอย่างน้อยหนึ่งแถว');
  const headers = rows.shift().map(v => v.toLowerCase().replace(/[\s_\-()]/g, ''));
  if (headers.some(v => !v) || new Set(headers).size !== headers.length) throw new Error('CSV มีชื่อคอลัมน์ว่างหรือซ้ำกัน');
  rows.forEach((r, i) => { if (r.length !== headers.length) throw new Error(`CSV แถว ${i + 2}: จำนวนคอลัมน์ไม่ตรงกับหัวตาราง`); });
  return {headers, rows};
}

function column(headers, aliases, label, required = true) {
  const matches = headers.map((h, i) => aliases.includes(h) ? i : -1).filter(i => i >= 0);
  if (matches.length > 1) throw new Error(`CSV มีคอลัมน์ ${label} หลายชื่อที่ซ้ำความหมายกัน`);
  if (!matches.length && required) throw new Error(`CSV ไม่พบคอลัมน์ ${label}`);
  return matches[0] ?? -1;
}

function assertAlignment(points) {
  if (points.length < 2) throw new Error('แนวต้องมีพิกัดอย่างน้อย 2 จุด');
  if (points.length > MAX_ALIGNMENT_POINTS) throw new Error('แนวต้องมีไม่เกิน 20000 จุด กรุณาลดความละเอียดก่อนนำเข้า');
  points.forEach((p, i) => {
    if (!finite(p.x) || !finite(p.y) || Math.abs(p.x) > 1e9 || Math.abs(p.y) > 1e9) throw new Error(`พิกัดจุด ${i + 1} ไม่ถูกต้อง`);
    if (i && Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) <= EPS) throw new Error(`พิกัดจุด ${i + 1} ซ้ำกับจุดก่อนหน้า`);
  });
  const length = lengthOf(points);
  if (!(length > EPS) || length > MAX_LENGTH) throw new Error('ความยาวแนวต้องมากกว่า 0 และไม่เกิน 100000 เมตร');
}

export function parseAlignmentCSV(text) {
  const {headers, rows} = readCSV(text);
  const ix = column(headers, ['x', 'easting', 'coordx'], 'x/easting');
  const iy = column(headers, ['y', 'northing', 'coordy'], 'y/northing');
  const points = rows.map((row, i) => ({x:numberValue(row[ix], `แถว ${i + 2} x`), y:numberValue(row[iy], `แถว ${i + 2} y`)}));
  assertAlignment(points);
  return points;
}

function checkSurvey(rows) {
  if (rows.length > MAX_SURVEY_POINTS) throw new Error('ข้อมูลรูปตัดต้องมีไม่เกิน 50000 จุด กรุณาแบ่งช่วงโครงการ');
  if (rows.length < 4) throw new Error('ข้อมูลสำรวจต้องมีอย่างน้อย 2 สถานี และอย่างน้อย 2 offsets ต่อสถานี');
  const keys = new Set(), counts = new Map();
  for (const row of rows) {
    const key = `${row.station}|${row.offset}`;
    if (keys.has(key)) throw new Error(`สถานี ${formatStation(row.station)} offset ${row.offset} ซ้ำกัน`);
    keys.add(key); counts.set(row.station, (counts.get(row.station) || 0) + 1);
  }
  if (counts.size < 2 || [...counts.values()].some(n => n < 2)) throw new Error('ต้องมีอย่างน้อย 2 สถานี และอย่างน้อย 2 offsets ที่ไม่ซ้ำต่อสถานี');
}

export function parseSurveyCSV(text) {
  const {headers, rows} = readCSV(text);
  const is = column(headers, ['station', 'stationm', 'chainage', 'สถานี'], 'station');
  const io = column(headers, ['offset', 'offsetm', 'ระยะเยื้อง'], 'offset');
  const iz = column(headers, ['elevation', 'elevationm', 'ground', 'level', 'z', 'ระดับ'], 'elevation');
  const survey = rows.map((row, i) => ({station:parseStation(row[is]), offset:numberValue(row[io], `แถว ${i + 2} offset`), elevation:numberValue(row[iz], `แถว ${i + 2} elevation`)}));
  if (survey.some(r => Math.abs(r.offset) > 100000 || Math.abs(r.elevation) > 100000)) throw new Error('offset/ระดับอยู่นอกช่วงที่รองรับ ±100000 เมตร');
  checkSurvey(survey);
  return survey.sort((a, b) => a.station - b.station || a.offset - b.offset);
}

export function parseSoilCSV(text) {
  const {headers, rows} = readCSV(text);
  const fields = ['borehole','station','fromstation','tostation','bottom','name','unitweight','phi','cohesion','source'];
  const columns = Object.fromEntries(fields.map(f => [f, column(headers, [f], f)]));
  const groups = new Map();
  rows.forEach((row, i) => {
    const at = f => row[columns[f]], context = `ชั้นดินแถว ${i + 2}`;
    const id = at('borehole'), source = at('source'), name = at('name');
    if (!id || !source || !name) throw new Error(`${context}: ต้องมี borehole, name และ source`);
    const station = parseStation(at('station')), fromStation = parseStation(at('fromstation')), toStation = parseStation(at('tostation'));
    if (fromStation > station || station > toStation || fromStation >= toStation) throw new Error(`${context}: ช่วงสถานีหลุมเจาะไม่ถูกต้อง`);
    const layer = {bottom:numberValue(at('bottom'), `${context} bottom`), name, unitWeight:numberValue(at('unitweight'), `${context} unit_weight`), phi:numberValue(at('phi'), `${context} phi`), cohesion:numberValue(at('cohesion'), `${context} cohesion`)};
    if (layer.unitWeight <= 0 || layer.unitWeight > 100 || layer.phi < 0 || layer.phi >= 90 || layer.cohesion < 0 || Math.abs(layer.bottom) > 100000) throw new Error(`${context}: unit_weight, phi, cohesion หรือ bottom อยู่นอกช่วง`);
    if (!groups.has(id)) groups.set(id, {id, station, fromStation, toStation, source, verified:false, layers:[]});
    const b = groups.get(id);
    if (b.station !== station || b.fromStation !== fromStation || b.toStation !== toStation || b.source !== source) throw new Error(`${context}: ข้อมูลกำกับหลุม ${id} ไม่ตรงกัน`);
    if (b.layers.length && layer.bottom >= b.layers[b.layers.length - 1].bottom) throw new Error(`${context}: bottom ต้องลดลงตามลำดับชั้นและไม่ซ้ำ`);
    b.layers.push(layer);
  });
  return [...groups.values()].sort((a, b) => a.station - b.station || a.id.localeCompare(b.id));
}

// Autodesk DXF references (codes are format definitions, not engineering rules):
// https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-748FC305-F3F2-4F74-825A-61F04D757A50.htm
// https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-DXF/files/GUID-ABF6B778-BE20-4B49-9B58-A94E64CEFFF3.htm
// https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-DXF/files/GUID-A85E8E67-27CD-4C59-BE61-4DC9FADBE74A.htm
export function parseDxf(text) {
  if (typeof text !== 'string' || text.length > 20000000 || /AutoCAD Binary DXF|\x00/.test(text)) throw new Error('รองรับ ASCII DXF ขนาดไม่เกิน 20 MB เท่านั้น; ไม่รองรับ DWG/Binary DXF');
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length % 2) throw new Error('DXF มีคู่ group code/value ไม่ครบ');
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    if (!/^\d+$/.test(lines[i].trim())) throw new Error(`DXF group code ไม่ถูกต้องที่บรรทัด ${i + 1}`);
    pairs.push({code:Number(lines[i].trim()), value:lines[i + 1].trim()});
  }
  let section = '', seenEntities = false, unitCode = null;
  const entities = []; let current = null;
  const finish = () => { if (current) entities.push(current); current = null; };
  for (let i = 0; i < pairs.length; i++) {
    const {code, value} = pairs[i];
    if (code === 0 && value === 'SECTION') {
      finish(); if (pairs[i + 1]?.code !== 2) throw new Error('DXF SECTION ไม่มีชื่อ');
      section = pairs[++i].value; if (section === 'ENTITIES') seenEntities = true; continue;
    }
    if (code === 0 && value === 'ENDSEC') { finish(); section = ''; continue; }
    if (section === 'HEADER' && code === 9 && value === '$INSUNITS') {
      if (pairs[i + 1]?.code !== 70) throw new Error('DXF $INSUNITS ไม่มีค่า group 70');
      unitCode = numberValue(pairs[i + 1].value, '$INSUNITS');
    }
    if (section !== 'ENTITIES') continue;
    if (code === 0) { finish(); current = {type:value, pairs:[]}; }
    else if (current) current.pairs.push({code, value});
  }
  finish();
  if (!seenEntities) throw new Error('DXF ไม่มีส่วน ENTITIES');
  if (unitCode !== null && unitCode !== 0 && unitCode !== 6) throw new Error(`DXF $INSUNITS=${unitCode} ไม่ใช่เมตร กรุณาแปลงหน่วยเป็นเมตรก่อนนำเข้า`);
  const warnings = [], paths = [];
  if (unitCode !== 6) warnings.push('DXF ไม่ระบุหน่วยเมตร: ต้องยืนยันว่า 1 หน่วยพิกัด = 1 เมตรก่อนใช้');
  const valueOf = (e, code, fallback) => e.pairs.find(p => p.code === code)?.value ?? fallback;
  const numeric = (e, code, fallback) => numberValue(valueOf(e, code, fallback), `${e.type} group ${code}`);
  const isXY = e => near(numeric(e, 210, 0), 0) && near(numeric(e, 220, 0), 0) && near(numeric(e, 230, 1), 1);
  const reject = (e, reason) => warnings.push(`${e.type} layer ${valueOf(e, 8, '0')}: ${reason}`);
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i], type = entity.type;
    if (!['LINE','LWPOLYLINE','POLYLINE'].includes(type)) {
      if (!['SEQEND','VERTEX','EOF'].includes(type)) reject(entity, 'ข้ามชนิดวัตถุที่ไม่รองรับเป็นแนว');
      continue;
    }
    try {
      if (!isXY(entity)) { reject(entity, 'ข้าม extrusion ที่ไม่ใช่ระนาบ XY'); continue; }
      if (!near(numeric(entity, 39, 0), 0)) { reject(entity, 'ข้ามวัตถุที่มี thickness'); continue; }
      let points = [], unsupported = '';
      if (type === 'LINE') {
        const za = numeric(entity, 30, 0), zb = numeric(entity, 31, 0);
        if (!near(za, zb)) unsupported = 'ปลายเส้นมี Z ไม่เท่ากัน';
        points = [{x:numeric(entity,10),y:numeric(entity,20)},{x:numeric(entity,11),y:numeric(entity,21)}];
      } else if (type === 'LWPOLYLINE') {
        const flags = numeric(entity, 70, 0);
        if (!Number.isInteger(flags) || (flags & 1)) unsupported = 'ไม่รองรับเส้นปิด';
        let point = null;
        for (const {code, value} of entity.pairs) {
          if (code === 10) { point = {x:numberValue(value, 'DXF X')}; points.push(point); }
          if (code === 20) { if (!point || 'y' in point) throw new Error('ลำดับ X/Y ไม่ถูกต้อง'); point.y = numberValue(value, 'DXF Y'); }
          if (code === 42 && !near(numberValue(value,'bulge'),0)) unsupported = 'มี bulge/ส่วนโค้งที่ไม่รองรับ';
        }
        const count = numeric(entity, 90, points.length);
        if (!Number.isInteger(count) || count !== points.length) throw new Error('จำนวน vertices ไม่ตรงกับ group 90');
      } else {
        const flags = numeric(entity, 70, 0);
        if (!Number.isInteger(flags) || (flags & 127)) unsupported = 'ไม่รองรับเส้นปิด/curve-fit/spline/3D/mesh';
        let ended = false;
        while (i + 1 < entities.length && ['VERTEX','SEQEND'].includes(entities[i + 1].type)) {
          const vertex = entities[++i];
          if (vertex.type === 'SEQEND') { ended = true; break; }
          if (numeric(vertex,70,0) !== 0 || !near(numeric(vertex,42,0),0)) unsupported = 'มี vertex flags/bulge ที่ไม่รองรับ';
          if (!near(numeric(vertex,30,0),0)) unsupported = 'มีค่า vertex Z ที่ไม่รองรับสำหรับ 2D polyline';
          points.push({x:numeric(vertex,10),y:numeric(vertex,20)});
        }
        if (!ended) throw new Error('POLYLINE ไม่มี SEQEND');
      }
      if (points.length >= 2 && near(points[0].x,points[points.length - 1].x) && near(points[0].y,points[points.length - 1].y)) unsupported = 'เส้นกลับมาปิดที่จุดเริ่ม';
      if (unsupported) { reject(entity, `ข้าม: ${unsupported}`); continue; }
      assertAlignment(points);
      paths.push({id:`path-${paths.length + 1}`,layer:valueOf(entity,8,'0'),points});
    } catch (error) { reject(entity, `ข้ามข้อมูลไม่ถูกต้อง: ${error.message}`); }
  }
  if (!paths.length) throw new Error(`ไม่พบแนวตรงเปิดที่ใช้ได้ใน ENTITIES${warnings.length ? ': ' + warnings.slice(0,4).join('; ') : ''}`);
  return {paths, warnings:[...new Set(warnings)], units:unitCode === 6 ? 'metres' : 'unspecified'};
}

export function surveyStations(p) {
  return [...new Set((Array.isArray(p?.survey) ? p.survey : []).filter(r => finite(r?.station)).map(r => r.station))].sort((a,b) => a-b);
}

function sectionAt(p, station) {
  return p.survey.filter(r => r.station === station).map(r => ({offset:r.offset,elevation:r.elevation})).sort((a,b) => a.offset-b.offset);
}

function interpolateOffset(section, offset) {
  if (!section.length || offset < section[0].offset - EPS || offset > section[section.length-1].offset + EPS) return null;
  const exact = section.find(p => near(p.offset,offset));
  if (exact) return exact.elevation;
  for (let i=1;i<section.length;i++) if (offset < section[i].offset) {
    const a=section[i-1],b=section[i],t=(offset-a.offset)/(b.offset-a.offset);
    return a.elevation + (b.elevation-a.elevation)*t;
  }
  return section[section.length-1].elevation;
}

export function groundSection(p, station) {
  if (!Array.isArray(p?.survey) || !finite(station)) return [];
  const stations=surveyStations(p);
  if (!stations.length || station < stations[0]-EPS || station > stations[stations.length-1]+EPS) return [];
  const exact=stations.find(s => near(s,station));
  if (exact !== undefined) return sectionAt(p,exact);
  const hi=stations.findIndex(s => s>station);
  if (hi<=0) return [];
  const a=sectionAt(p,stations[hi-1]),b=sectionAt(p,stations[hi]);
  const loOffset=Math.max(a[0].offset,b[0].offset),hiOffset=Math.min(a[a.length-1].offset,b[b.length-1].offset);
  if (loOffset>hiOffset) return [];
  const offsets=[...new Set([loOffset,hiOffset,...a.map(x=>x.offset),...b.map(x=>x.offset)])].filter(x=>x>=loOffset&&x<=hiOffset).sort((x,y)=>x-y);
  const t=(station-stations[hi-1])/(stations[hi]-stations[hi-1]);
  return offsets.map(offset=>({offset,elevation:interpolateOffset(a,offset)*(1-t)+interpolateOffset(b,offset)*t}));
}

function rect(left,right,bottom,top) { return [{offset:left,elevation:bottom},{offset:right,elevation:bottom},{offset:right,elevation:top},{offset:left,elevation:top}]; }

export function buildSection(p, station) {
  const g=p.geometry, polygons=[],piles=[];
  const add=(id,name,family,material,color,points)=>polygons.push({id,name,family,material,color,points});
  if (g.type==='T3-01') {
    add('cap','คานครอบหัวเสาเข็ม','cap','concrete','#93a9b6',rect(-g.capWidth/2,g.capWidth/2,g.crestLevel-g.capDepth,g.crestLevel));
    add('deck','พื้นทางเดิน (ช่วงแนวคิด)','deck','concrete','#b8c9cc',rect(g.capWidth/2,g.capWidth/2+g.deckWidth,g.crestLevel-g.deckThickness,g.crestLevel));
    add('panel','แผงกันดินหลังแนวเสาเข็ม','panel','concrete','#8a9caa',rect(g.pileSize/2,g.pileSize/2+g.panelThickness,g.toeLevel,g.crestLevel-g.capDepth));
    piles.push({id:'front-pile',name:'เสาเข็มแนวหน้า 1 แถว',family:'piles',top:{offset:0,elevation:g.crestLevel-g.capDepth},bottom:{offset:0,elevation:g.crestLevel-g.capDepth-g.pileLength},size:g.pileSize,spacing:g.pileSpacing});
  } else if (g.type==='T1-01') {
    const height=g.crestLevel-g.toeLevel,toe=-height*g.slopeH;
    // Normal thickness converted to vertical depth; end cuts are vertical.
    // Shoelace area is therefore exactly slope length × specified thickness.
    const normalFactor=Math.hypot(1,g.slopeH)/g.slopeH;
    const band=(depth,thickness)=>[
      {offset:toe,elevation:g.toeLevel-depth*normalFactor},
      {offset:0,elevation:g.crestLevel-depth*normalFactor},
      {offset:0,elevation:g.crestLevel-(depth+thickness)*normalFactor},
      {offset:toe,elevation:g.toeLevel-(depth+thickness)*normalFactor}
    ];
    add('rock','หินเรียงป้องกันลาด','rock','rock','#c2aa7d',band(0,g.rockThickness));
    add('filter','ชั้นกรองใต้หินเรียง','filter','filter','#b9ad8e',band(g.rockThickness,g.filterThickness));
    add('toe','หินตีนลาด (หน้าตัดสี่เหลี่ยมสมมติ)','toe','rock','#9e947d',rect(toe-g.toeWidth,toe,g.toeLevel-g.toeHeight,g.toeLevel));
    add('cap','คาน BF ที่สันลาด (แนวคิด)','cap','concrete','#a3b4bb',rect(0,g.capWidth,g.crestLevel-g.capDepth,g.crestLevel));
  } else throw new Error('รองรับรูปตัด T1-01 และ T3-01 เท่านั้น');
  return {station,polygons,piles,ground:groundSection(p,station),levels:{crest:g.crestLevel,toe:g.toeLevel,waterHigh:p.water.high,waterLow:p.water.low,waterSurvey:p.water.survey}};
}

function polygonArea(points) {
  // Translate before summation to avoid cancellation at large absolute datums.
  const origin=points[0];let sum=0;
  for(let i=0;i<points.length;i++) {const a=points[i],b=points[(i+1)%points.length];sum+=(a.offset-origin.offset)*(b.elevation-origin.elevation)-(b.offset-origin.offset)*(a.elevation-origin.elevation);}
  return Math.abs(sum)/2;
}

export function quantityRows(p) {
  const length=lengthOf(p.alignment),section=buildSection(p,0),rows=[];
  const add=(code,name,unit,quantity,formula,assumption,family)=>{
    const price=p.prices?.[code];
    const materialRate=finite(price?.material)&&price.material>=0?price.material:null;
    const labourRate=finite(price?.labour)&&price.labour>=0?price.labour:null;
    rows.push({code,name,unit,quantity,formula,assumption,family,materialRate,labourRate,amount:materialRate===null||labourRate===null?null:quantity*(materialRate+labourRate),priceSource:typeof price?.source==='string'?price.source:''});
  };
  for(const polygon of section.polygons) {
    const area=polygonArea(polygon.points);
    add(polygon.id.toUpperCase(),polygon.name,'ม³',area*length,`พื้นที่หน้าตัด ${area.toFixed(6)} ม² × ความยาวแนว ${length.toFixed(6)} ม.`, 'หน้าตัดคงที่ × ความยาวแนวอ้างอิง; ยังไม่ปรับความยาวแนวเยื้องและรอยต่อมุมโค้ง ไม่รวมเผื่อสูญเสียหรือรายละเอียดเหล็ก',polygon.family);
  }
  for(const pile of section.piles) {
    const count=Math.floor((length+EPS)/pile.spacing)+1;
    const pileLength=pile.top.elevation-pile.bottom.elevation;
    add('PILE',pile.name,'ต้น',count,`floor(L / ${pile.spacing}) + 1 = ${count} ต้น; เริ่ม STA 0`, `เสาเข็ม ${pile.size} × ${pile.size} ม. ยาว ${pileLength.toFixed(3)} ม./ต้น; 1 แถว; มีต้นปลายแนวเฉพาะเมื่อระยะกริดลงตัว; ราคาต่อต้น`,pile.family);
  }
  return rows;
}

function stable(value) {
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(isObject(value)) return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}

export function projectRevision(p) {
  const data={alignment:p.alignment,survey:[...(p.survey||[])].sort((a,b)=>a.station-b.station||a.offset-b.offset),geometry:p.geometry,water:p.water,boreholes:[...(p.boreholes||[])].sort((a,b)=>(a.station-b.station)||String(a.id).localeCompare(String(b.id)))};
  const value=stable(data);let a=2166136261,b=2246822519;
  for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),3266489917);}
  return 'r1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}

export function analysisRows(p) {
  const stations=surveyStations(p),revision=projectRevision(p);
  if(!stations.length) stations.push(0,lengthOf(p.alignment));
  // Bucket by chainage tolerance: a large result register must not require
  // stations × cases × results linear scans on every UI redraw.
  const index=new Map();
  (p.analysis||[]).forEach((row,position)=>{
    const key=`${row.case}|${Math.round(row.station/EPS)}`;
    if(!index.has(key)) index.set(key,[]);
    index.get(key).push({row,position});
  });
  return stations.flatMap(station=>CASES.map(([code,label])=>{
    const bucket=Math.round(station/EPS);
    const candidates=[-1,0,1].flatMap(delta=>index.get(`${code}|${bucket+delta}`)||[]).filter(v=>near(v.row.station,station));
    const entry=candidates.sort((a,b)=>a.position-b.position)[0]?.row;
    return {station,case:code,label,fs:entry?.fs??null,reference:entry?.reference??'',status:!entry?'missing':entry.revision===revision?'current':'stale',revision:entry?.revision??''};
  }));
}

export function parseAnalysisCSV(text,p) {
  const {headers,rows}=readCSV(text);
  const is=column(headers,['station','stationm','chainage'],'station');
  const ic=column(headers,['case','loadcase'],'case');
  const iff=column(headers,['fs','factorofsafety'],'fs');
  const ir=column(headers,['reference','source'],'reference');
  const resultRevisionColumn=column(headers,['resultrevision','revision'],'result_revision',false);
  const statusColumn=column(headers,['status'],'status',false);
  const revision=projectRevision(p),stations=analysisRows(p).filter(r=>r.case===CASES[0][0]).map(r=>r.station),keys=new Set();
  return rows.map((row,i)=>{
    const inputStation=parseStation(row[is]);
    const station=stations.find(s=>near(s,inputStation));
    if(station===undefined) throw new Error(`ผลแถว ${i+2}: สถานีไม่มีในชุดหน้าตัดปัจจุบัน`);
    const caseName=row[ic],fs=numberValue(row[iff],`ผลแถว ${i+2} FS`),reference=row[ir];
    if(!CASES.some(([code])=>code===caseName)) throw new Error(`ผลแถว ${i+2}: case ต้องเป็น construction, low-water หรือ drawdown`);
    if(fs<=0) throw new Error(`ผลแถว ${i+2}: FS ต้องมากกว่า 0`);
    if(!reference) throw new Error(`ผลแถว ${i+2}: ต้องระบุเอกสาร/โปรแกรมอ้างอิง`);
    if(resultRevisionColumn>=0&&row[resultRevisionColumn]!==revision) throw new Error(`ผลแถว ${i+2}: result_revision ไม่ตรงกับข้อมูลปัจจุบัน ต้องวิเคราะห์ใหม่ ไม่สามารถนำผลเก่ามายืนยันเป็นผลปัจจุบัน`);
    if(statusColumn>=0&&row[statusColumn]==='stale') throw new Error(`ผลแถว ${i+2}: ผลมีสถานะ stale ต้องตรวจและวิเคราะห์ใหม่ก่อนนำเข้า`);
    const key=`${station}|${caseName}`;
    if(keys.has(key)) throw new Error(`ผลแถว ${i+2}: สถานีและกรณีซ้ำกัน`);
    keys.add(key);
    return {station,case:caseName,fs,reference,revision};
  });
}

export function validateProject(p) {
  const errors=[],warnings=[];
  try {
    if(!isObject(p)) return {valid:false,errors:['โครงการต้องเป็น JSON object'],warnings};
    assertPlainJSON(p);
    if(p.schemaVersion!==1) errors.push('schemaVersion ต้องเป็น 1');
    for(const key of ['name','code']) if(!textOK(p[key])||!p[key].trim()) errors.push(`${key} ต้องเป็นข้อความที่ไม่ว่าง`);
    if(p.notes!==undefined&&!textOK(p.notes)) errors.push('notes ต้องเป็นข้อความ');
    let length=NaN;
    if(!Array.isArray(p.alignment)||p.alignment.length>MAX_ALIGNMENT_POINTS) errors.push('alignment ต้องเป็นรายการไม่เกิน 20000 จุด');
    else {try {
      assertAlignment(p.alignment);length=lengthOf(p.alignment);
      const hasTurn=p.alignment.some((pt,i,points)=>{
        if(i<1||i>=points.length-1)return false;
        const a=points[i-1],b=points[i+1],ux=pt.x-a.x,uy=pt.y-a.y,vx=b.x-pt.x,vy=b.y-pt.y;
        return Math.abs(ux*vy-uy*vx)>1e-8*Math.hypot(ux,uy)*Math.hypot(vx,vy)||(ux*vx+uy*vy)<0;
      });
      if(hasTurn)warnings.push('แนวมีส่วนโค้ง/หักมุม: ปริมาณใช้ความยาวแนวอ้างอิง ยังไม่แก้แนวเยื้อง รอยต่อมุมหรือการซ้อนของรูปทรง');
    }catch(e){errors.push(e.message);}}
    if(!isObject(p.geometry)) errors.push('ไม่พบ geometry');
    else {
      const g=p.geometry;
      if(!['T1-01','T3-01'].includes(g.type)) errors.push('geometry.type รองรับ T1-01 หรือ T3-01');
      for(const key of ['crestLevel','toeLevel']) if(!finite(g[key])||Math.abs(g[key])>100000) errors.push(`geometry.${key} ต้องเป็นระดับตัวเลขที่ใช้ได้`);
      if(finite(g.crestLevel)&&finite(g.toeLevel)&&g.crestLevel<=g.toeLevel) errors.push('ระดับสันต้องสูงกว่าระดับตีนลาด');
      for(const key of DIMENSIONS) if(!finite(g[key])||g[key]<=0||g[key]>1000) errors.push(`geometry.${key} ต้องมากกว่า 0 และไม่เกิน 1000 เมตร/อัตราส่วน`);
      if(g.type==='T3-01') {
        if(g.crestLevel-g.capDepth<=g.toeLevel) errors.push('ตีนแผงต้องอยู่ต่ำกว่าท้องคานครอบหัวเสาเข็ม');
        if(g.capWidth<g.pileSize+2*g.panelThickness) errors.push('คานครอบต้องกว้างพอคลุมเสาเข็มและแผงด้านหลัง');
        if(g.deckThickness>g.capDepth) errors.push('พื้นทางเดินต้องไม่หนากว่าคานครอบ');
        if(finite(length)&&g.pileSpacing>0&&Math.floor(length/g.pileSpacing)+1>MAX_ROWS) errors.push('จำนวนเสาเข็มเกิน 100000 ต้น กรุณาแบ่งช่วงโครงการ');
      }
    }
    if(!isObject(p.water)) errors.push('ไม่พบ water');
    else {
      for(const key of ['high','low','survey','ground']) if(!finite(p.water[key])||Math.abs(p.water[key])>100000) errors.push(`water.${key} ต้องเป็นระดับตัวเลขที่ใช้ได้`);
      if(p.water.high<p.water.low) errors.push('ระดับน้ำสูงต้องไม่น้อยกว่าระดับน้ำต่ำ');
      if(p.water.survey<p.water.low||p.water.survey>p.water.high) warnings.push('ระดับน้ำวันสำรวจอยู่นอกช่วงน้ำสูง–ต่ำที่ระบุ');
    }
    if(!Array.isArray(p.survey)||p.survey.length>MAX_SURVEY_POINTS) errors.push('survey ต้องเป็นรายการไม่เกิน 50000 จุด');
    else if(!p.survey.length) warnings.push('ยังไม่มีรูปตัดสำรวจ');
    else {
      let validRows=true;
      for(const [i,r] of p.survey.entries()) {
        if(!isObject(r)||!finite(r.station)||!finite(r.offset)||!finite(r.elevation)||r.station<0||Math.abs(r.offset)>100000||Math.abs(r.elevation)>100000){errors.push(`survey แถว ${i+1} ไม่ถูกต้อง`);validRows=false;break;}
        if(finite(length)&&r.station>length+EPS){errors.push(`survey สถานี ${formatStation(r.station)} เกินความยาวแนว`);validRows=false;break;}
      }
      if(validRows){try {checkSurvey(p.survey);}catch(e){errors.push(e.message);}}
      const stations=surveyStations(p);
      if(validRows&&finite(length)&&(stations[0]>EPS||stations[stations.length-1]<length-EPS)) warnings.push('รูปตัดสำรวจยังครอบคลุมแนวไม่ครบ; พื้นที่นอกช่วงจะไม่สร้างภูมิประเทศ');
    }
    if(!Array.isArray(p.boreholes)||p.boreholes.length>1000) errors.push('boreholes ต้องเป็นรายการไม่เกิน 1000 หลุม');
    else if(!p.boreholes.length) warnings.push('ยังไม่มีข้อมูลหลุมเจาะและชั้นดิน');
    else {
      const ids=new Set();
      for(const [i,b] of p.boreholes.entries()) {
        if(!isObject(b)||!textOK(b.id)||!b.id.trim()||ids.has(b.id)){errors.push(`หลุมเจาะ ${i+1}: id ว่างหรือซ้ำ`);continue;}
        ids.add(b.id);
        if(![b.station,b.fromStation,b.toStation].every(finite)||b.fromStation<0||b.fromStation>b.station||b.station>b.toStation||b.fromStation>=b.toStation||(finite(length)&&b.toStation>length+EPS)) errors.push(`หลุม ${b.id}: ช่วงสถานีไม่ถูกต้อง`);
        if(typeof b.verified!=='boolean') errors.push(`หลุม ${b.id}: verified ต้องเป็น boolean`);
        else if(!b.verified) warnings.push(`หลุม ${b.id}: ยังไม่ยืนยันข้อมูลดิน`);
        if(!textOK(b.source)) errors.push(`หลุม ${b.id}: source ต้องเป็นข้อความ`);
        else if(!b.source.trim()) warnings.push(`หลุม ${b.id}: ยังไม่ระบุที่มา`);
        if(!Array.isArray(b.layers)||!b.layers.length||b.layers.length>1000) errors.push(`หลุม ${b.id}: ต้องมีชั้นดิน 1–1000 ชั้น`);
        else {let previous=Infinity;
          for(const layer of b.layers){
            if(!isObject(layer)||![layer.bottom,layer.unitWeight,layer.phi,layer.cohesion].every(finite)||!textOK(layer.name)||!layer.name.trim()||Math.abs(layer.bottom)>100000||layer.bottom>=previous||layer.unitWeight<=0||layer.unitWeight>100||layer.phi<0||layer.phi>=90||layer.cohesion<0){errors.push(`หลุม ${b.id}: ลำดับหรือค่าชั้นดินไม่ถูกต้อง`);break;}
            previous=layer.bottom;
          }
        }
      }
    }
    if(!isObject(p.sources)) errors.push('ไม่พบ sources ของข้อมูล');
    else for(const key of ['alignment','survey']) {
      const s=p.sources[key];
      if(!isObject(s)||!textOK(s.kind)||!textOK(s.name)) errors.push(`sources.${key} ต้องมี kind และ name`);
      else if(s.kind==='demo') warnings.push(`${key}: ใช้ข้อมูลสาธิต`);
    }
    if(!isObject(p.prices)) errors.push('prices ต้องเป็น object');
    else for(const [code,rate] of Object.entries(p.prices)) {
      if(!isObject(rate)||!textOK(rate.source)||!['material','labour'].every(key=>rate[key]===null||(finite(rate[key])&&rate[key]>=0&&rate[key]<=1e12))) errors.push(`ราคา ${code}: ต้องระบุ material/labour เป็น null หรือเลข 0–10¹² และ source เป็นข้อความ`);
    }
    if(!finite(p.selectedStation)||p.selectedStation<0||(finite(length)&&p.selectedStation>length+EPS)) errors.push('selectedStation ต้องอยู่บนแนวโครงการ');
    if(!Array.isArray(p.analysis)||p.analysis.length>MAX_ROWS) errors.push('analysis ต้องเป็นรายการ');
    else {const seen=new Set();
      for(const r of p.analysis){
        if(!isObject(r)||!finite(r.station)||r.station<0||r.station>MAX_LENGTH||!CASES.some(([c])=>c===r.case)||!finite(r.fs)||r.fs<=0||!textOK(r.reference)||!r.reference.trim()||!textOK(r.revision)||!r.revision.trim()){errors.push('analysis มีสถานี/กรณี/FS/อ้างอิง/revision ไม่ถูกต้อง');break;}
        const key=`${r.station}|${r.case}`;if(seen.has(key)){errors.push('analysis มีสถานีและกรณีซ้ำ');break;}seen.add(key);
      }
    }
  } catch(error) {errors.push(`ข้อมูลโครงการไม่ถูกต้อง: ${error.message}`);}
  return {valid:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
}

export function createDemoProject() {
  const alignment=Array.from({length:21},(_,i)=>({x:i*5,y:4*Math.sin(i*Math.PI/20)}));
  const factor=100/lengthOf(alignment);alignment.forEach(p=>{p.x*=factor;p.y*=factor;});
  const length=lengthOf(alignment),stations=[0,25,50,75,length];
  const offsets=[-25,-15,-8,-4,0,5,15],levels=[92,94,96.2,97.8,98.8,99,99.1];
  const survey=stations.flatMap(station=>offsets.map((offset,i)=>({station,offset,elevation:levels[i]+0.15*Math.sin(station/100*Math.PI*2)})));
  const p={
    schemaVersion:1,name:'โครงการตัวอย่าง • เขื่อนป้องกันตลิ่ง',code:'RB-DEMO-001',alignment,survey,
    sources:{alignment:{kind:'demo',name:'แนวโค้งสาธิต 100 เมตร'},survey:{kind:'demo',name:'รูปตัดสาธิตทุก 25 เมตร'}},
    geometry:{type:'T3-01',crestLevel:100.4,toeLevel:95.8,deckWidth:3.7,deckThickness:0.18,pileSize:0.4,pileLength:18,pileSpacing:1,panelThickness:0.12,capWidth:1.2,capDepth:0.6,slopeH:2,rockThickness:0.35,filterThickness:0.25,toeWidth:3,toeHeight:1.5},
    water:{high:99,low:95.55,survey:97,ground:98.5},
    boreholes:[{id:'BH-DEMO-01',station:50,fromStation:0,toStation:length,source:'ข้อมูลสมมติเพื่อสาธิตเท่านั้น',verified:false,layers:[{bottom:91,name:'ทราย (สาธิต)',unitWeight:18,phi:30,cohesion:0},{bottom:78,name:'ดินเหนียว (สาธิต)',unitWeight:17,phi:0,cohesion:20}]}],
    prices:{},selectedStation:50,notes:'แบบจำลองส่วนประกอบแนวคิด ใช้ข้อมูลสำรวจและดินสมมติ ต้องตรวจสอบแบบและข้อมูลโครงการจริง',analysis:[]
  };
  for(const row of quantityRows(p)) p.prices[row.code]={material:null,labour:null,source:''};
  return p;
}
