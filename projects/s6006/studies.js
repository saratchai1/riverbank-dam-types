import { calculateTypical } from './engine.js';
import { calculateBeam, calculateSoil, KSC_TO_MPA } from './engineering.js';
import {
  CALCULATION_REVISION, createDefaultScenario, scenarioRevision,
} from './project.js';
import { buildInvestigationReview } from './investigations.js';

// Finite, one-at-a-time trials over existing R2 functions. No new engineering
// equation, optimization, acceptance target, or mutation of a project lives here.
export const STUDY_METHOD_REVISION = 'S6006-STUDIES-1';
const MIN_SAMPLES = 3, MAX_SAMPLES = 31;
const RECORD_MAX_BYTES = 8 * 1024 * 1024, CSV_MAX_BYTES = 16 * 1024 * 1024;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = value => new TextEncoder().encode(value).byteLength;

function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

const SOIL_METRICS = ['soil.dry.fs', 'soil.parallel-seepage.fs', 'soil.undrained.fs'];
const CAPACITY_METRICS = ['beam.usablePhiMnKnM', 'beam.usablePhiVnKn', 'beam.momentUtilization', 'beam.shearUtilization'];
const SELFWEIGHT_METRICS = ['beam.selfWeightMuKnM', 'beam.selfWeightVuKn'];
const GEOMETRY_METRICS = ['geometry.rockVolume', 'geometry.sandMinVolume', 'geometry.geotextileSlopeArea'];
const parameter = (id, group, label, unit, minimum, maximum, minimumInclusive, modes, metricIds) => {
  const [section, field] = id.split('.');
  return { id, group, label, unit, section, field, minimum, maximum,
    minimumInclusive, maximumInclusive: true, modes, metricIds };
};

export const STUDY_PARAMETERS = freeze([
  parameter('geometry.slopeH', 'soil', 'อัตราลาดร่วมรูปตัดและดิน', 'H : 1V', 0.05, 20, false, null, [...SOIL_METRICS, ...GEOMETRY_METRICS]),
  parameter('soilInputs.verticalDepthM', 'soil', 'ความลึกแนวดิ่ง z ของระนาบสมมติ', 'm', 0, 100, false, null, [...SOIL_METRICS]),
  parameter('soilInputs.frictionAngleDeg', 'soil', 'มุมเสียดทานประสิทธิผล φ′', '°', 0, 60, true, ['effective'], [...SOIL_METRICS]),
  parameter('soilInputs.effectiveCohesionKpa', 'soil', 'ความเชื่อมแน่นประสิทธิผล c′', 'kPa', 0, 1000, true, ['effective'], [...SOIL_METRICS]),
  parameter('soilInputs.undrainedStrengthKpa', 'soil', 'กำลังเฉือนไม่ระบายน้ำ Su', 'kPa', 0, 1000, true, ['undrained'], [...SOIL_METRICS]),
  parameter('soilInputs.unitWeightKnM3', 'soil', 'น้ำหนักจำเพาะ γ สำหรับ u=0', 'kN/m³', 0, 40, false, ['effective'], [...SOIL_METRICS]),
  parameter('soilInputs.saturatedUnitWeightKnM3', 'soil', 'น้ำหนักจำเพาะอิ่มตัว γsat', 'kN/m³', 0, 40, false, null, [...SOIL_METRICS]),
  parameter('beamInputs.widthMm', 'beam', 'ความกว้างคาน b', 'mm', 50, 3000, false, null, [...CAPACITY_METRICS, ...SELFWEIGHT_METRICS]),
  parameter('beamInputs.heightMm', 'beam', 'ความสูงคาน h', 'mm', 100, 3000, false, null, [...CAPACITY_METRICS, ...SELFWEIGHT_METRICS]),
  parameter('beamInputs.tensionBarDiameterMm', 'beam', 'เส้นผ่านศูนย์กลางเหล็กดึงทดลอง', 'mm', 4, 50, false, null, [...CAPACITY_METRICS]),
  parameter('beamInputs.stirrupSpacingMm', 'beam', 'ระยะปลอกทดลอง s', 'mm', 0, 1000, false, null, ['beam.usablePhiVnKn', 'beam.shearUtilization']),
  parameter('beamInputs.fcKsc', 'beam', 'กำลังคอนกรีตทรงกระบอก f′c', 'kgf/cm²', 17 / KSC_TO_MPA, 60 / KSC_TO_MPA, true, null, [...CAPACITY_METRICS]),
  parameter('beamInputs.spanM', 'beam', 'ช่วงคานตัวอย่างรองรับง่าย L', 'm', 0, 50, false, null, [...SELFWEIGHT_METRICS]),
]);

export const STUDY_METRICS = freeze([
  { id: 'soil.dry.fs', group: 'soil', label: 'FS ลาดอนันต์: u=0', unit: '—', sourceKeys: ['USACE-1902'] },
  { id: 'soil.parallel-seepage.fs', group: 'soil', label: 'FS ลาดอนันต์: อิ่มตัวซึมขนานลาด', unit: '—', sourceKeys: ['USACE-1902'] },
  { id: 'soil.undrained.fs', group: 'soil', label: 'FS ลาดอนันต์: total stress ด้วย Su', unit: '—', sourceKeys: ['USACE-1902'] },
  { id: 'beam.usablePhiMnKnM', group: 'beam', label: 'กำลังดัดที่ใช้เทียบ Mu หลังตรวจเงื่อนไข', unit: 'kN·m', sourceKeys: ['SP-LEGACY-BEAM', 'SP-STRESS-BLOCK'] },
  { id: 'beam.usablePhiVnKn', group: 'beam', label: 'เพดานเฉือนที่ใช้เทียบ Vu หลังตรวจรายละเอียด', unit: 'kN', sourceKeys: ['SP-LEGACY-BEAM', 'SP-LEGACY-METRIC'] },
  { id: 'beam.momentUtilization', group: 'beam', label: 'Mu ที่ระบุ / กำลังดัดที่ใช้ตรวจได้', unit: '—', sourceKeys: ['SP-LEGACY-BEAM'] },
  { id: 'beam.shearUtilization', group: 'beam', label: 'Vu ที่ระบุ / เพดานเฉือนที่ใช้ตรวจได้', unit: '—', sourceKeys: ['SP-LEGACY-BEAM'] },
  { id: 'beam.selfWeightMuKnM', group: 'beam', label: 'โมเมนต์ตัวอย่างจากน้ำหนักตัวคาน', unit: 'kN·m', sourceKeys: ['ASSUMED-SIMPLE-SPAN', 'ASSUMED-SELF-WEIGHT-ONLY'] },
  { id: 'beam.selfWeightVuKn', group: 'beam', label: 'แรงเฉือนตัวอย่างจากน้ำหนักตัวคาน', unit: 'kN', sourceKeys: ['ASSUMED-SIMPLE-SPAN', 'ASSUMED-SELF-WEIGHT-ONLY'] },
  { id: 'geometry.rockVolume', group: 'geometry', label: 'ปริมาตรชั้นหินเรียงทฤษฎี', unit: 'm³', sourceKeys: ['S6006-SD-02'] },
  { id: 'geometry.sandMinVolume', group: 'geometry', label: 'ปริมาตรชั้นทรายขั้นต่ำจำลอง', unit: 'm³', sourceKeys: ['S6006-SD-02'] },
  { id: 'geometry.geotextileSlopeArea', group: 'geometry', label: 'พื้นที่แผ่นใยบนลาดทฤษฎี', unit: 'm²', sourceKeys: ['S6006-SD-02'] },
]);

const LIMITATIONS = freeze([
  'เปลี่ยนตัวแปรครั้งละหนึ่งตัว โดยตรึงค่าอื่นตามชุดฐาน เป็นการทดลองความสัมพันธ์ของสมการ R2 ไม่ใช่การค้นหาแบบที่ดีที่สุดหรือการอนุมัติแบบ',
  'ช่วงและจุดทดลองเป็นค่าที่ผู้ใช้กำหนด ขอบเขตตัวเลขเป็นข้อจำกัดซอฟต์แวร์ ไม่ใช่ช่วงค่าที่แนะนำทางวิศวกรรม; ช่วงเริ่มต้นรอบค่าฐานเป็นเพียงตัวอย่าง',
  'ค่าต่ำสุดและสูงสุดรายงานเฉพาะจุดที่ทดลองและคำนวณได้ ไม่ยืนยันค่าสูงสุดตลอดช่วง จุดตัดเกณฑ์ หรือพฤติกรรมระหว่างจุด; ผลอาจไม่ต่อเนื่องเมื่อเงื่อนไขรายละเอียดเปลี่ยน',
  'FS เป็นกลไกลาดอนันต์เนื้อเดียวตามโหมดที่เลือก ไม่ใช่เสถียรภาพรวม หลายชั้นดิน หรือการคำนวณซ้ำ Slope/W; FS≥1 ไม่ใช่เกณฑ์อนุมัติโครงการ',
  'กรณีซึมขนานลาดสมมติอิ่มตัวถึงผิวและ steady seepage ไม่มีน้ำภายนอกค้ำยัน ไม่ใช่กรณีน้ำลดฉับพลัน; ระดับน้ำในบริบทไม่สร้างแรงดันน้ำหรือแรงคานอัตโนมัติ',
  'กำลังคานแสดงค่าที่ผ่านหรือจำกัดตามเงื่อนไข R2; ค่าเชิงสมการ φMn/φVn ที่อยู่ในรายละเอียดไม่แทนกำลังที่ใช้ตรวจแรงได้ และยังไม่ตรวจมาตรฐานหรือระบบโครงสร้างครบทุกข้อ',
  'Mu/Vu ที่ไม่ทราบคงเป็นช่องว่าง ตัวอย่างน้ำหนักตัวคานไม่แทนหรือบวกเข้ากับแรงออกแบบจริง; การเปลี่ยนมิติไม่ได้สร้างผลวิเคราะห์ระบบคานใหม่',
  'ปริมาณเป็นรูปทรงทฤษฎีแยกองค์ประกอบ ยังไม่หักส่วนซ้อนและไม่รวมเป็นปริมาณสุทธิหรือประมาณราคาที่ผ่านตรวจ',
  'หลักฐานดินและน้ำที่แนบเป็นของชุดฐานเท่านั้น จุดทดลองไม่ได้รับหลักฐานหรือสถานะยืนยันใหม่จากการเปลี่ยนตัวเลข; ต้องตรวจความสัมพันธ์ของพารามิเตอร์และความเหมาะสมกับสถานีจริง',
  'ขนาดเหล็กและระยะที่ทดลองเป็นตัวเลขในสมการ ไม่ยืนยันขนาดผลิตภัณฑ์ที่มีจำหน่าย รายละเอียดการวางเหล็ก หรือความเป็นไปได้ในการก่อสร้าง',
]);

/** Reject unsafe descriptors before reading any caller-provided property. */
function assertData(root, maxNodes = 100000) {
  const stack = [{ value: root, depth: 0 }], seen = new WeakSet();
  let count = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (++count > maxNodes || depth > 24) throw new RangeError('ข้อมูลการทดลองมีขนาดหรือความลึกเกินขอบเขต');
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'string') {
      if (value.length > 200000) throw new RangeError('ข้อความการทดลองยาวเกินขอบเขต');
      continue;
    }
    if (typeof value === 'number') {
      if (!finite(value)) throw new TypeError('ข้อมูลการทดลองต้องไม่มี NaN หรือ Infinity');
      continue;
    }
    if (typeof value !== 'object' || (!plain(value) && !Array.isArray(value))) throw new TypeError('ข้อมูลการทดลองต้องเป็น JSON ปกติ');
    if (seen.has(value)) throw new TypeError('ข้อมูลการทดลองต้องไม่มีวงจรหรือ object อ้างอิงร่วม');
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value) && (Object.keys(value).length !== value.length
      || Object.keys(value).some((key, index) => key !== String(index)))) throw new TypeError('รายการการทดลองต้องเป็น array ต่อเนื่อง');
    for (const key of keys) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string' || RESERVED.has(key)) throw new TypeError('ชื่อข้อมูลการทดลองไม่รองรับหรือเป็นชื่อสงวน');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!own(descriptor, 'value') || !descriptor.enumerable) throw new TypeError('ข้อมูลการทดลองต้องไม่มี getter/setter หรือข้อมูลซ่อน');
      stack.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
}

function exact(value, keys, label) {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !own(value, key))) {
    throw new TypeError(label + ': ชื่อข้อมูลไม่ครบหรือมีข้อมูลที่ไม่รองรับ');
  }
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

// A deterministic change identifier, not a cryptographic signature or approval.
function fingerprint(value, prefix) {
  const text = stable(value);
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
  }
  return prefix + (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

function sourceFingerprint(selection, scenario, evidenceReview) {
  // Scoped evidence fields are determined by the selected inputs and evidence.
  // The enclosing project's revision is deliberately excluded: other stations
  // and alternatives must not invalidate this selected source's freshness.
  const { projectRevision: omitted, ...localEvidence } = evidenceReview;
  return fingerprint({ calculationRevision: CALCULATION_REVISION,
    methodRevision: STUDY_METHOD_REVISION, selection, scenario, evidence: localEvidence }, 's6006study-source-');
}

function resolveSource(project, source, selection) {
  assertData(selection, 20);
  exact(selection, ['stationId', 'scenarioId'], 'ชุดฐานการทดลอง');
  if (typeof selection.stationId !== 'string' || typeof selection.scenarioId !== 'string'
    || selection.stationId.length > 128 || selection.scenarioId.length > 128) throw new TypeError('ต้องระบุรหัสสถานีและชุดข้อมูลอย่างชัดเจน');
  assertData(source);
  // This validates the complete project and exact selected source once. Reuse
  // its derived evidence and project revision instead of validating again below.
  const evidenceReview = buildInvestigationReview(project, source, selection.stationId, selection.scenarioId);
  const alternative = selection.scenarioId === 'current' ? null
    : project.stationComparisons?.[selection.stationId]?.alternatives.find(item => item.id === selection.scenarioId);
  const scenario = clone(alternative?.scenario ?? project.stationScenarios[selection.stationId] ?? createDefaultScenario());
  const selected = { station: clone(evidenceReview.station), scenarioId: selection.scenarioId,
    scenarioName: evidenceReview.scenarioName, kind: evidenceReview.kind };
  return { selection: selected, scenario, evidenceReview,
    sourceRevision: sourceFingerprint(selected, scenario, evidenceReview) };
}

function metricApplies(id, mode) {
  return !id.startsWith('soil.') || (mode === 'effective' ? id !== 'soil.undrained.fs' : id === 'soil.undrained.fs');
}

function forMode(item, mode) {
  return { ...clone(item), metricIds: item.metricIds.filter(id => metricApplies(id, mode)) };
}

function suggestRange(item, value) {
  // Visible, editable numerical illustration only. Unknown/zero bases get no
  // invented engineering range; the user must enter one explicitly.
  if (!finite(value) || value <= 0) return null;
  const lowerBoundary = item.minimumInclusive ? item.minimum : item.minimum + (value - item.minimum) / 4;
  let minimum = Math.max(value * 0.8, lowerBoundary);
  const maximum = Math.min(value * 1.2, item.maximum);
  if (!item.minimumInclusive && minimum <= item.minimum) minimum = value;
  if (!finite(minimum) || !finite(maximum) || minimum >= maximum) return null;
  return { minimum, maximum, sampleCount: 9 };
}

export function studySourceRevision(project, source, selection) {
  return resolveSource(project, source, selection).sourceRevision;
}

export function studyOptions(project, source, selection) {
  const base = resolveSource(project, source, selection), mode = base.scenario.soilInputs.mode;
  return {
    selection: base.selection, sourceRevision: base.sourceRevision,
    scenarioRevision: scenarioRevision(base.scenario),
    parameters: STUDY_PARAMETERS.filter(item => item.modes === null || item.modes.includes(mode)).map(item => {
      const baselineValue = base.scenario[item.section][item.field];
      return { ...forMode(item, mode), baselineValue, suggestedRange: suggestRange(item, baselineValue) };
    }),
    metricDefinitions: clone(STUDY_METRICS), limits: { minimumSamples: MIN_SAMPLES, maximumSamples: MAX_SAMPLES },
  };
}

function requireConfig(config, scenario) {
  assertData(config, 30);
  exact(config, ['stationId', 'scenarioId', 'parameterId', 'minimum', 'maximum', 'sampleCount'], 'ช่วงการทดลอง');
  const item = STUDY_PARAMETERS.find(value => value.id === config.parameterId);
  if (!item) throw new RangeError('ตัวแปรนี้ยังไม่รองรับการทดลอง');
  if (item.modes !== null && !item.modes.includes(scenario.soilInputs.mode)) throw new RangeError('ตัวแปรนี้ไม่ใช้ในโหมดดินของชุดฐาน');
  if (!finite(config.minimum) || !finite(config.maximum) || config.minimum >= config.maximum
    || (item.minimumInclusive ? config.minimum < item.minimum : config.minimum <= item.minimum)
    || config.maximum > item.maximum) throw new RangeError('ช่วงการทดลองต้องเพิ่มขึ้นและอยู่ในขอบเขตตัวเลขของตัวแปร');
  if (!Number.isInteger(config.sampleCount) || config.sampleCount < MIN_SAMPLES || config.sampleCount > MAX_SAMPLES) {
    throw new RangeError('จำนวนจุดทดลองต้องเป็นจำนวนเต็มตั้งแต่ 3 ถึง 31');
  }
  const values = Array.from({ length: config.sampleCount }, (_, index) => index === 0 ? config.minimum
    : index === config.sampleCount - 1 ? config.maximum
      : config.minimum + (config.maximum - config.minimum) * (index / (config.sampleCount - 1)));
  if (values.some((value, index) => !finite(value) || (index > 0 && value <= values[index - 1]))) {
    throw new RangeError('ช่วงตัวเลขละเอียดเกินกว่าจะสร้างจุดทดลองที่แตกต่างกันได้');
  }
  return { parameter: forMode(item, scenario.soilInputs.mode), values };
}

const cell = (value, availability, reason) => ({ value, availability, reason, delta: null, deltaPercent: null });
const condition = (beam, id) => beam.checks.find(item => item.id === id);

function flexuralCell(beam) {
  if (beam.usablePhiMnKnM !== null) return cell(beam.usablePhiMnKnM, 'computed', 'ผ่านเงื่อนไขเหล็กคราก ความเครียดและเหล็กขั้นต่ำที่ R2 ตรวจ; ต้องยืนยันแรงและรายละเอียดระบบจริง');
  const reason = ['flexural-yield', 'flexural-strain', 'minimum-flexural-steel']
    .map(id => condition(beam, id)).filter(item => item.status !== 'satisfied')
    .map(item => item.label + ': ' + item.note).join('; ');
  return cell(null, 'gated', reason + '; ไม่ใช้กำลังเชิงสมการหรือข้อยกเว้น 4/3 แทนเงื่อนไขที่ขาด');
}

function shearCell(beam) {
  if (beam.usablePhiVnKn === null) return cell(null, 'gated', condition(beam, 'maximum-shear').note);
  const deficient = ['minimum-stirrups', 'stirrup-spacing'].map(id => condition(beam, id)).filter(item => item.status !== 'satisfied');
  return cell(beam.usablePhiVnKn, 'computed', deficient.length
    ? 'จำกัดเพดานเป็น φVc/2 ตาม R2 เนื่องจาก ' + deficient.map(item => item.label).join(' และ ') + '; รายละเอียดปลอกยังต้องทบทวน'
    : 'เพดานหลังตรวจปลอกขั้นต่ำ ระยะปลอก และขีดจำกัด Vs ใน R2; ยังต้องยืนยันแรงและรายละเอียดระบบจริง');
}

function metricCells(scenario, results, errors) {
  const mode = scenario.soilInputs.mode, metrics = {};
  for (const definition of STUDY_METRICS) {
    const { id, group } = definition;
    if (!metricApplies(id, mode)) {
      metrics[id] = cell(null, 'not-applicable', 'ไม่ใช่กรณีของโหมดดินที่เลือก; ไม่เปรียบข้าม effective stress กับ total stress');
      continue;
    }
    if (results[group] === null) {
      const error = errors.find(item => item.domain === group);
      metrics[id] = cell(null, error?.availability ?? 'invalid', error?.message ?? 'ไม่มีผลคำนวณของหมวดนี้');
      continue;
    }
    if (group === 'geometry') {
      metrics[id] = cell(results.geometry[id.split('.')[1]], 'computed', 'รูปทรงทฤษฎีแยกองค์ประกอบ; ไม่ใช่ปริมาณสุทธิหรือ BOQ ที่แก้ให้แล้ว');
    } else if (group === 'soil') {
      const caseId = id.split('.')[1], result = results.soil.cases.find(item => item.id === caseId);
      if (!result) throw new Error('ไม่พบกรณีดินที่ประกาศไว้ในการทดลอง');
      const scope = caseId === 'dry' ? 'ลาดอนันต์ u=0 ใช้ γ ที่ระบุ'
        : caseId === 'parallel-seepage' ? 'ลาดอนันต์อิ่มตัวถึงผิว ซึมคงตัวขนานลาด ไม่มีน้ำภายนอกค้ำยัน; ไม่ใช่น้ำลดฉับพลัน'
          : 'ลาดอนันต์ total stress ใช้ Su และ γsat; ไม่หัก u ซ้ำ';
      metrics[id] = cell(result.factorOfSafety, 'computed', scope + '; ไม่ใช่ global FS หรือเกณฑ์อนุมัติ'
        + (result.factorOfSafety < 1 ? '; FS<1 สำหรับกลไกสมมตินี้' : ''));
    } else {
      const beam = results.beam;
      if (id === 'beam.usablePhiMnKnM') metrics[id] = flexuralCell(beam);
      else if (id === 'beam.usablePhiVnKn') metrics[id] = shearCell(beam);
      else if (id.endsWith('Utilization')) {
        const moment = id === 'beam.momentUtilization', demand = beam.externalDemand[moment ? 'MuKnM' : 'VuKn'];
        const check = condition(beam, moment ? 'external-moment' : 'external-shear');
        const capacity = moment ? flexuralCell(beam) : shearCell(beam);
        const value = beam.externalDemand[moment ? 'momentUtilization' : 'shearUtilization'];
        metrics[id] = demand === null ? cell(null, 'missing', check.note)
          : value === null ? cell(null, 'gated', capacity.reason)
            : cell(value, 'computed', check.note + '; ' + capacity.reason
              + (value > 1 ? '; แรงที่ระบุเกินกำลังที่ใช้ตรวจได้' : ''));
      } else metrics[id] = cell(beam[id.split('.')[1]], 'computed', 'ตัวอย่างน้ำหนักตัวคานบนช่วงรองรับง่ายเท่านั้น; ไม่แทนหรือบวกเข้ากับ Mu/Vu ออกแบบจริง');
    }
    if (metrics[id].value !== null && !finite(metrics[id].value)) throw new RangeError('ผลทดลองต้องเป็นจำนวนจำกัดหรือไม่มีผลอย่างชัดเจน');
  }
  return metrics;
}

function evaluatePoint(id, x, scenario) {
  const results = { geometry: null, beam: null, soil: null }, errors = [];
  const evaluate = (domain, calculate) => {
    try {
      const result = calculate();
      assertData(result, 10000);
      results[domain] = result;
    } catch (error) {
      errors.push({ domain, availability: 'invalid', message: error instanceof Error ? error.message : 'คำนวณหมวดนี้ไม่ได้' });
    }
  };
  evaluate('geometry', () => calculateTypical(scenario.geometry));
  evaluate('beam', () => calculateBeam(scenario.beamInputs));
  const soilInputs = { ...scenario.soilInputs, slopeH: scenario.geometry.slopeH };
  if (soilInputs.mode === 'undrained' && soilInputs.undrainedStrengthKpa === null) {
    try {
      // Match the native project's draft validation, discarding this probe. It
      // cannot become a baseline/trial value, result, formula, or export row.
      calculateSoil({ ...soilInputs, undrainedStrengthKpa: 1 });
      errors.push({ domain: 'soil', availability: 'missing', message: 'ยังไม่มี Su สำหรับ total stress; ไม่แทนข้อมูลที่ขาดด้วยศูนย์หรือค่าทดลองอื่น' });
    } catch (error) {
      errors.push({ domain: 'soil', availability: 'invalid', message: error instanceof Error ? error.message : 'ข้อมูลดินอยู่นอกขอบเขต' });
    }
  } else evaluate('soil', () => calculateSoil(soilInputs));
  let revision = null;
  if (!errors.some(item => item.availability === 'invalid')) revision = scenarioRevision(scenario);
  return { id, x, scenario: clone(scenario), scenarioRevision: revision, results,
    metrics: metricCells(scenario, results, errors), errors };
}

function withDifferences(point, baseline) {
  for (const definition of STUDY_METRICS) {
    const result = point.metrics[definition.id], base = baseline.metrics[definition.id];
    if (result.availability !== 'computed' || base.availability !== 'computed') continue;
    const delta = result.value - base.value;
    if (!finite(delta)) { result.reason += '; ผลต่างเกินช่วงตัวเลขที่รองรับ'; continue; }
    result.delta = delta === 0 ? 0 : delta;
    if (base.value !== 0) {
      const percentage = delta / Math.abs(base.value) * 100;
      if (finite(percentage)) result.deltaPercent = percentage === 0 ? 0 : percentage;
      else result.reason += '; ผลต่างร้อยละเกินช่วงตัวเลขที่รองรับ';
    }
  }
  return point;
}

function summaries(samples) {
  return Object.fromEntries(STUDY_METRICS.map(definition => {
    const summary = { computedCount: 0, missingCount: 0, gatedCount: 0, invalidCount: 0,
      notApplicableCount: 0, minimum: null, maximum: null };
    const counts = { computed: 'computedCount', missing: 'missingCount', gated: 'gatedCount', invalid: 'invalidCount', 'not-applicable': 'notApplicableCount' };
    for (const point of samples) {
      const result = point.metrics[definition.id];
      summary[counts[result.availability]]++;
      if (result.availability !== 'computed') continue;
      const extremum = { value: result.value, pointId: point.id, x: point.x };
      if (summary.minimum === null || result.value < summary.minimum.value) summary.minimum = { ...extremum };
      if (summary.maximum === null || result.value > summary.maximum.value) summary.maximum = { ...extremum };
    }
    return [definition.id, summary];
  }));
}

export function buildStudy(project, source, config) {
  assertData(config, 30);
  exact(config, ['stationId', 'scenarioId', 'parameterId', 'minimum', 'maximum', 'sampleCount'], 'ช่วงการทดลอง');
  const selected = resolveSource(project, source, { stationId: config.stationId, scenarioId: config.scenarioId });
  const { parameter: item, values } = requireConfig(config, selected.scenario);
  const baseline = evaluatePoint('baseline', selected.scenario[item.section][item.field], selected.scenario);
  withDifferences(baseline, baseline);
  const samples = values.map((value, index) => {
    const scenario = clone(selected.scenario);
    scenario[item.section][item.field] = value;
    return withDifferences(evaluatePoint('sample-' + (index + 1), value, scenario), baseline);
  });
  const record = {
    studyRevision: fingerprint({ methodRevision: STUDY_METHOD_REVISION, calculationRevision: CALCULATION_REVISION,
      sourceRevision: selected.sourceRevision, config }, 's6006study-'),
    calculationRevision: CALCULATION_REVISION, projectRevision: selected.evidenceReview.projectRevision,
    sourceRevision: selected.sourceRevision, selection: selected.selection, parameter: item,
    config: clone(config), baseline, samples, metricDefinitions: clone(STUDY_METRICS),
    summaries: summaries(samples), limitations: [...LIMITATIONS],
    baselineEvidence: selected.evidenceReview,
  };
  const text = JSON.stringify(record);
  if (bytes(text) > RECORD_MAX_BYTES) throw new RangeError('ผลการทดลองมีขนาดเกินขอบเขตที่รองรับ');
  // Detach every nested array/object, including registry metadata and evidence.
  return JSON.parse(text);
}

function csvCell(value) {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (typeof value === 'string' && /^\s*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function requireCSVRecord(record) {
  assertData(record);
  exact(record, ['studyRevision', 'calculationRevision', 'projectRevision', 'sourceRevision', 'selection', 'parameter',
    'config', 'baseline', 'samples', 'metricDefinitions', 'summaries', 'limitations', 'baselineEvidence'], 'ผลการทดลอง CSV');
  if (record.calculationRevision !== CALCULATION_REVISION || typeof record.studyRevision !== 'string'
    || typeof record.projectRevision !== 'string' || typeof record.sourceRevision !== 'string'
    || !Array.isArray(record.samples) || !Array.isArray(record.limitations)
    || stable(record.metricDefinitions) !== stable(STUDY_METRICS)
    || stable(record.limitations) !== stable(LIMITATIONS)) throw new TypeError('ต้องใช้ผลการทดลองและขอบเขตจากโมดูลปัจจุบัน');
  exact(record.selection, ['station', 'scenarioId', 'scenarioName', 'kind'], 'ชุดฐาน CSV');
  if (record.baselineEvidence.projectRevision !== record.projectRevision
    || record.baselineEvidence.scenarioId !== record.selection.scenarioId
    || record.baselineEvidence.scenarioName !== record.selection.scenarioName
    || record.baselineEvidence.kind !== record.selection.kind
    || record.baselineEvidence.scenarioRevision !== record.baseline.scenarioRevision
    || stable(record.baselineEvidence.station) !== stable(record.selection.station)
    || sourceFingerprint(record.selection, record.baseline.scenario, record.baselineEvidence) !== record.sourceRevision) {
    throw new TypeError('ข้อมูลอ้างอิงและตัวตนชุดฐานไม่ตรงกับรุ่นแหล่งข้อมูล');
  }
  const { parameter: item, values } = requireConfig(record.config, record.baseline.scenario);
  if (stable(item) !== stable(record.parameter) || record.samples.length !== values.length
    || record.baseline.id !== 'baseline' || record.baseline.x !== record.baseline.scenario[item.section][item.field]
    || record.selection.station.id !== record.config.stationId || record.selection.scenarioId !== record.config.scenarioId) {
    throw new TypeError('ชุดฐาน ตัวแปร หรือจำนวนจุดในผลการทดลองไม่ตรงกัน');
  }
  const expectedRevision = fingerprint({ methodRevision: STUDY_METHOD_REVISION, calculationRevision: CALCULATION_REVISION,
    sourceRevision: record.sourceRevision, config: record.config }, 's6006study-');
  if (record.studyRevision !== expectedRevision) throw new TypeError('รุ่นการทดลองไม่ตรงกับช่วงและชุดฐาน');
  const baseline = evaluatePoint('baseline', record.baseline.x, record.baseline.scenario);
  withDifferences(baseline, baseline);
  if (stable(baseline) !== stable(record.baseline)) throw new TypeError('ผลชุดฐานไม่ตรงกับค่าตั้งต้น');
  const samples = values.map((value, index) => {
    const scenario = clone(record.baseline.scenario); scenario[item.section][item.field] = value;
    return withDifferences(evaluatePoint('sample-' + (index + 1), value, scenario), baseline);
  });
  if (stable(samples) !== stable(record.samples) || stable(summaries(samples)) !== stable(record.summaries)) {
    throw new TypeError('ผลจุดทดลองไม่ตรงกับค่าตั้งต้นและสมการ R2');
  }
  if (bytes(JSON.stringify(record)) > RECORD_MAX_BYTES) throw new RangeError('ผลการทดลอง CSV มีขนาดเกินขอบเขต');
}

/** Long-form export retains inputs, governed results, formulas, conditions and baseline-only evidence. */
export function studyCSV(record) {
  requireCSVRecord(record);
  const headers = ['study_revision', 'study_method_revision', 'calculation_revision', 'project_revision', 'source_revision',
    'station_id', 'station_m', 'scenario_id', 'scenario_name', 'scenario_kind',
    'parameter', 'parameter_label', 'parameter_unit', 'range_minimum', 'range_maximum', 'sample_count',
    'point_id', 'point_kind', 'trial_value', 'point_scenario_revision', 'row_type', 'field', 'label', 'unit',
    'value', 'availability', 'delta', 'delta_percent', 'status', 'limit', 'reason', 'expression', 'substitution', 'source_keys'];
  const rows = [headers], baseColumns = [record.studyRevision, STUDY_METHOD_REVISION, record.calculationRevision,
    record.projectRevision, record.sourceRevision, record.selection.station.id, record.selection.station.station,
    record.selection.scenarioId, record.selection.scenarioName, record.selection.kind,
    record.parameter.id, record.parameter.label, record.parameter.unit,
    record.config.minimum, record.config.maximum, record.config.sampleCount];
  const add = (point, type, field, options = {}) => rows.push([...baseColumns,
    point.id, point.id === 'baseline' ? 'baseline' : 'trial', point.x, point.scenarioRevision,
    type, field, options.label ?? field, options.unit ?? '', options.value ?? null,
    options.availability ?? '', options.delta ?? null, options.deltaPercent ?? null,
    options.status ?? '', options.limit ?? null, options.reason ?? '', options.expression ?? '',
    options.substitution ?? '', options.sourceKeys ?? '']);
  for (const point of [record.baseline, ...record.samples]) {
    for (const [section, values] of Object.entries(point.scenario)) {
      for (const [field, value] of Object.entries(values)) {
        const path = section + '.' + field, item = STUDY_PARAMETERS.find(item => item.id === path);
        add(point, 'input', path, { label: item?.label, unit: item?.unit, value,
          availability: value === null || value === '' ? 'missing' : 'provided',
          reason: point.id === 'baseline' ? 'ค่าที่บันทึกในชุดฐาน' : path === record.parameter.id
            ? 'ค่าทดลองหนึ่งตัว; ไม่มีการรับรองหลักฐานใหม่' : 'ตรึงตามชุดฐาน' });
      }
    }
    for (const definition of record.metricDefinitions) add(point, 'metric', definition.id,
      { ...point.metrics[definition.id], label: definition.label, unit: definition.unit, sourceKeys: definition.sourceKeys.join(' | ') });
    for (const [domain, result] of Object.entries(point.results)) {
      if (result === null) continue;
      for (const formula of result.formulaRows) add(point, 'formula', domain + '.' + formula.id, {
        label: formula.label, unit: formula.unit, value: formula.value,
        availability: formula.value === null ? 'unavailable' : 'computed',
        expression: formula.formula, substitution: formula.substitution,
        reason: formula.assumption ?? '', sourceKeys: formula.sourceKey,
      });
      for (const check of result.checks ?? []) add(point, 'condition', domain + '.' + check.id, {
        label: check.label, value: check.value, limit: check.limit, status: check.status, reason: check.note,
      });
    }
    for (const error of point.errors) add(point, 'error', error.domain, { availability: error.availability, reason: error.message });
  }
  const evidenceLeaves = (value, path = '') => {
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) evidenceLeaves(child, path ? path + '.' + key : key);
    } else add(record.baseline, 'baseline_evidence', path, { value, reason: 'หลักฐานของชุดฐานเท่านั้น ไม่ยืนยันจุดทดลอง' });
  };
  evidenceLeaves(record.baselineEvidence);
  record.limitations.forEach((reason, index) => add(record.baseline, 'limitation', String(index + 1), { reason }));
  const text = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  if (bytes(text) > CSV_MAX_BYTES) throw new RangeError('CSV การทดลองมีขนาดเกินขอบเขตที่รองรับ');
  return text;
}
