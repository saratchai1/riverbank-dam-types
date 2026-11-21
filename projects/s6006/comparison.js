import { calculateTypical } from './engine.js';
import { calculateBeam, calculateSoil } from './engineering.js';
import {
  validateProject, stationCatalog, projectRevision, scenarioRevision,
  getActiveScenario, getSoilInputs, getStationComparison,
} from './project.js';

// This adapter compares accepted inputs and the existing R2 results. It does not
// introduce an engineering equation, design load, acceptance target or winner.
export const COMPARISON_GROUPS = Object.freeze([
  ['geometry', 'รูปทรงที่ใช้คำนวณ'],
  ['materials', 'ปริมาณทฤษฎีแยกองค์ประกอบ'],
  ['beam', 'คาน: กำลังหลังตรวจเงื่อนไขและแรงที่ระบุ'],
  ['soil', 'ดิน: FS ของกลไกลาดอนันต์ที่เลือก'],
  ['inputs-geometry', 'ข้อมูลรูปทรงทั้งหมด'],
  ['inputs-beam', 'ข้อมูลคานทั้งหมด'],
  ['inputs-soil', 'ข้อมูลดินทั้งหมด'],
  ['inputs-context', 'บริบทน้ำและแหล่งข้อมูลทั้งหมด'],
].map(([id, label]) => Object.freeze({ id, label })));

const INPUT_GROUPS = [
  ['geometry', 'inputs-geometry', [
    ['length', 'ความยาวที่ใช้จำลอง', 'm'],
    ['crestLevel', 'ระดับสัน', 'm'], ['toeLevel', 'ระดับตีน', 'm'],
    ['slopeH', 'อัตราลาดร่วมรูปตัดและดิน', 'H : 1V'],
    ['rockThickness', 'ความหนาหินเรียงตั้งฉากลาด', 'm'],
    ['sandMinThickness', 'ความหนาชั้นทรายขั้นต่ำจำลองตั้งฉากลาด', 'm'],
    ['walkwayWidth', 'ความกว้างทางเท้า', 'm'],
    ['toeTopWidth', 'ความกว้างบนตีนหินจำลอง', 'm'],
    ['toeDepth', 'ความลึกตีนหินจำลอง', 'm'],
    ['toeSlopeH', 'อัตราลาดข้างตีนหินจำลอง', 'H : 1V'],
  ]],
  ['beamInputs', 'inputs-beam', [
    ['widthMm', 'ความกว้างคาน b', 'mm'], ['heightMm', 'ความสูงคาน h', 'mm'],
    ['coverMm', 'cover ถึงผิวนอกปลอก', 'mm'],
    ['tensionBarDiameterMm', 'ขนาดเหล็กดึง', 'mm'],
    ['tensionBarCount', 'จำนวนเหล็กดึงหนึ่งหน้า', 'เส้น'],
    ['stirrupDiameterMm', 'ขนาดเหล็กปลอก', 'mm'],
    ['stirrupLegs', 'จำนวนขาปลอก', 'ขา'], ['stirrupSpacingMm', 'ระยะปลอก', 'mm'],
    ['fcKsc', 'กำลังคอนกรีตทรงกระบอก f′c', 'kgf/cm²'],
    ['fyKsc', 'กำลังครากเหล็กดึง fy', 'kgf/cm²'],
    ['fyvKsc', 'กำลังครากเหล็กปลอก fyv', 'kgf/cm²'],
    ['concreteUnitWeightTfM3', 'น้ำหนักจำเพาะ ค.ส.ล.', 'tf/m³'],
    ['spanM', 'ช่วงคานตัวอย่างรองรับง่าย', 'm'],
    ['deadLoadFactor', 'ตัวคูณน้ำหนักตัวเองตัวอย่าง', 'ตัวคูณ D'],
    ['externalMuKnM', 'Mu ออกแบบที่ผู้ใช้ระบุ', 'kN·m'],
    ['externalVuKn', 'Vu ออกแบบที่ผู้ใช้ระบุ', 'kN'],
  ]],
  ['soilInputs', 'inputs-soil', [
    ['mode', 'วิธีใช้พารามิเตอร์ดิน', 'effective / undrained'],
    ['verticalDepthM', 'ความลึกแนวดิ่ง z ของระนาบสมมติ', 'm'],
    ['unitWeightKnM3', 'น้ำหนักจำเพาะ γ สำหรับ u=0', 'kN/m³'],
    ['saturatedUnitWeightKnM3', 'น้ำหนักจำเพาะอิ่มตัว γsat', 'kN/m³'],
    ['waterUnitWeightKnM3', 'น้ำหนักจำเพาะน้ำ γw', 'kN/m³'],
    ['frictionAngleDeg', 'มุมเสียดทานประสิทธิผล φ′', '°'],
    ['effectiveCohesionKpa', 'แรงยึดเหนี่ยวประสิทธิผล c′', 'kPa'],
    ['undrainedStrengthKpa', 'กำลังเฉือน Su สำหรับ total stress', 'kPa'],
  ]],
  ['context', 'inputs-context', [
    ['waterHighLevel', 'ระดับน้ำสูงที่บันทึกเป็นบริบท', 'm'],
    ['waterLowLevel', 'ระดับน้ำต่ำที่บันทึกเป็นบริบท', 'm'],
    ['groundwaterLevel', 'ระดับน้ำใต้ดินที่บันทึกเป็นบริบท', 'm'],
    ['boreholeReference', 'แหล่งอ้างอิงดิน/หลุมเจาะ', ''],
    ['waterReference', 'แหล่งอ้างอิงน้ำ', ''],
    ['sourceNote', 'บันทึกแหล่งข้อมูลและข้อสมมติ', ''],
  ]],
];

const finite = value => typeof value === 'number' && Number.isFinite(value);
const check = (result, id) => result.checks.find(item => item.id === id);
const appendReason = (cell, reason) => { cell.reason = [cell.reason, reason].filter(Boolean).join('; '); };

function cell(value, availability = 'computed', status = 'illustrative', reason = '') {
  return { value, availability, status, reason, delta: null, deltaPercent: null };
}

function makeEntry({ id, name, kind, createdAt, scenario }) {
  const soilInputs = getSoilInputs(scenario);
  const missingSu = soilInputs.mode === 'undrained' && soilInputs.undrainedStrengthKpa === null;
  return {
    id, name, kind, createdAt, revision: scenarioRevision(scenario), scenario,
    results: {
      geometry: calculateTypical(scenario.geometry),
      beam: calculateBeam(scenario.beamInputs),
      soil: missingSu ? null : calculateSoil(soilInputs),
      soilError: missingSu ? 'ยังไม่มี Su สำหรับ total stress; ยังไม่มีผลกำลังเฉือนหรือ FS' : null,
    },
  };
}

function flexuralCell(entry) {
  const result = entry.results.beam;
  if (result.usablePhiMnKnM !== null) {
    return cell(result.usablePhiMnKnM, 'computed', 'satisfied', 'ผ่านเกณฑ์เหล็กคราก εt ≥ 0.004 และ As ≥ As,min ที่โมดูลตรวจ; ยังต้องมี Mu และรายละเอียดระบบจริง');
  }
  const reasons = ['flexural-yield', 'flexural-strain', 'minimum-flexural-steel']
    .map(id => check(result, id)).filter(item => item.status !== 'satisfied')
    .map(item => item.label + ' ยังไม่ครบเงื่อนไข: ' + item.note);
  return cell(null, 'gated', 'review', reasons.join('; ') + '; โมดูลไม่ใช้ข้อยกเว้น 4/3 As ที่ต้องการ');
}

function shearCell(entry) {
  const result = entry.results.beam;
  if (result.usablePhiVnKn === null) {
    return cell(null, 'gated', 'review', 'Vs เกินขีดจำกัดหน้าตัด; ไม่คืนกำลังเฉือนสำหรับตรวจแรง');
  }
  const limited = ['minimum-stirrups', 'stirrup-spacing'].map(id => check(result, id))
    .filter(item => item.status !== 'satisfied');
  return cell(result.usablePhiVnKn, 'computed', limited.length ? 'review' : 'satisfied',
    limited.length ? 'จำกัดเพดานเป็น φVc/2 เนื่องจาก ' + limited.map(item => item.label).join(' และ ')
      : 'เพดานหลังตรวจเหล็กปลอกขั้นต่ำ ระยะปลอก และขีดจำกัด Vs ในโมดูล; ยังต้องมี Vu และรายละเอียดระบบจริง');
}

function demandCell(entry, type, utilization = false) {
  const result = entry.results.beam;
  const moment = type === 'moment';
  const demand = result.externalDemand[moment ? 'MuKnM' : 'VuKn'];
  const condition = check(result, moment ? 'external-moment' : 'external-shear');
  if (demand === null) return cell(null, 'missing', 'pending', condition.note);
  if (!utilization) return cell(demand, 'computed', condition.status, condition.note);
  const value = result.externalDemand[moment ? 'momentUtilization' : 'shearUtilization'];
  if (value === null) return cell(null, 'gated', 'review', moment ? flexuralCell(entry).reason : shearCell(entry).reason);
  return cell(value, 'computed', condition.status, condition.note);
}

function soilCell(entry, caseId) {
  const mode = entry.scenario.soilInputs.mode;
  const applies = mode === 'effective' ? caseId !== 'undrained' : caseId === 'undrained';
  if (!applies) return cell(null, 'not-applicable', 'not-required', 'ไม่ใช่กรณีของโหมดดินที่เลือก; ไม่เปรียบข้าม effective stress กับ total stress');
  if (entry.results.soil === null) return cell(null, 'missing', 'pending', entry.results.soilError);
  const result = entry.results.soil.cases.find(item => item.id === caseId);
  if (!result) throw new RangeError('ไม่พบกรณีดินที่ตรงกับโหมดและรหัสกรณี ' + caseId);
  const scope = caseId === 'dry' ? 'ลาดอนันต์ u=0 ใช้ γ ที่ระบุ'
    : caseId === 'parallel-seepage' ? 'ลาดอนันต์อิ่มตัวถึงผิว ซึมคงตัวขนานลาด ไม่มีน้ำภายนอกค้ำยัน; ไม่ใช่น้ำลดฉับพลัน'
      : 'ลาดอนันต์ total stress ใช้ Su และ γsat; ไม่หัก u ซ้ำ';
  return cell(result.factorOfSafety, 'computed', result.status,
    scope + '; ไม่ใช่ global FS หรือเกณฑ์อนุมัติโครงการ' + (result.factorOfSafety < 1 ? '; FS < 1 สำหรับกลไกสมมตินี้' : ''));
}

function inputCell(entry, section, key) {
  const value = entry.scenario[section][key];
  const unused = section === 'soilInputs' && (entry.scenario.soilInputs.mode === 'effective'
    ? key === 'undrainedStrengthKpa'
    : ['frictionAngleDeg', 'effectiveCohesionKpa', 'waterUnitWeightKnM3', 'unitWeightKnM3'].includes(key));
  const missing = value === null || value === '';
  const reason = unused ? 'ไม่ใช้ค่านี้ในโหมดดินที่เลือก; คงค่าที่บันทึกจริงไว้'
    : missing ? 'ยังไม่ระบุ; ไม่แทนข้อมูลที่ขาดด้วยศูนย์'
      : section === 'context' ? 'ข้อมูลบริบทที่ผู้ใช้บันทึก; ไม่แปลงเป็นแรงดันน้ำหรือแรงออกแบบอัตโนมัติ'
        : 'ค่าที่บันทึกในสถานการณ์นี้; ต้องยืนยันฐานข้อมูลและข้อสมมติที่ใช้';
  return cell(value, missing ? unused ? 'not-applicable' : 'missing' : 'computed', 'not-evaluated', reason);
}

/** Current station only; all results are recomputed from validated snapshots. */
export function buildComparison(project, source) {
  const validation = validateProject(project, source);
  if (!validation.valid) throw new RangeError(validation.errors.join('; '));
  const station = stationCatalog(source).find(item => item.id === project.selectedStationId);
  if (!station) throw new RangeError('ไม่พบสถานีที่เลือกในทะเบียนต้นฉบับ');
  const comparison = getStationComparison(project);
  const entries = comparison.alternatives.map(alternative => makeEntry({ ...alternative, kind: 'saved' }));
  entries.push(makeEntry({ id: 'current', name: 'ค่าที่กำลังแก้', kind: 'current', createdAt: null, scenario: getActiveScenario(project) }));
  const reference = entries.find(entry => entry.id === comparison.referenceId);
  const rows = [];
  const lengths = [...new Set(entries.map(entry => entry.scenario.geometry.length))];
  const mixedLengths = lengths.length > 1;
  const addRow = ({ id, group, label, unit, reason = '', isInput = false, read, demandKey }) => {
    const cells = Object.fromEntries(entries.map(entry => [entry.id, read(entry)]));
    if (!isInput && reference) {
      const base = cells[reference.id];
      for (const entry of entries) {
        const current = cells[entry.id];
        if (base.availability !== 'computed' || current.availability !== 'computed'
          || !finite(base.value) || !finite(current.value)) continue;
        if (demandKey && entry.scenario.beamInputs[demandKey] !== reference.scenario.beamInputs[demandKey]) {
          appendReason(current, 'แรงออกแบบต่างจากค่าฐาน; ไม่แสดงผลต่างอัตราใช้กำลัง');
          continue;
        }
        const delta = current.value - base.value;
        if (!finite(delta)) {
          appendReason(current, 'ผลต่างเกินช่วงตัวเลขที่แสดงได้');
          continue;
        }
        current.delta = delta === 0 ? 0 : delta;
        if (base.value !== 0) {
          const percentage = delta / Math.abs(base.value) * 100;
          if (finite(percentage)) current.deltaPercent = percentage === 0 ? 0 : percentage;
          else appendReason(current, 'ผลต่างร้อยละเกินช่วงตัวเลขที่แสดงได้');
        }
      }
    }
    rows.push({ id, group, label, unit, isInput, reason, cells });
  };

  for (const [key, label, unit] of [
    ['height', 'ความสูงลาด', 'm'], ['run', 'ระยะราบลาด', 'm'],
    ['slopeLength', 'ความยาวตามลาด', 'm'], ['angleDegrees', 'มุมลาดกับแนวราบ', '°'],
  ]) addRow({ id: 'geometry.' + key, group: 'geometry', label, unit,
    reason: 'รูปทรงทฤษฎีตามมิติที่เลือก ไม่ใช่รูปตัดพื้นดินสำรวจ',
    read: entry => cell(entry.results.geometry[key]) });

  const materialBasis = 'ปริมาณทฤษฎีแยกองค์ประกอบ ไม่รวมเป็นปริมาณสุทธิหรือยอด BOQ';
  for (const [id, label, unit, read, perLength] of [
    ['rockArea', 'หินเรียงทฤษฎีต่อความยาว 1 m', 'm³/m', entry => entry.results.geometry.rockArea, true],
    ['sandMinArea', 'ชั้นทรายขั้นต่ำจำลองต่อความยาว 1 m', 'm³/m', entry => entry.results.geometry.sandMinArea, true],
    ['toeArea', 'ตีนหินจำลองต่อความยาว 1 m', 'm³/m', entry => entry.results.geometry.toeArea, true],
    ['geotextilePerLength', 'แผ่นใยบนลาดทฤษฎีต่อความยาว 1 m', 'm²/m', entry => entry.results.geometry.slopeLength, true],
    ['walkwayPerLength', 'ผิวทางเท้าทฤษฎีต่อความยาว 1 m', 'm²/m', entry => entry.scenario.geometry.walkwayWidth, true],
    ['rockVolume', 'ปริมาตรหินเรียงทฤษฎีตามความยาวที่ระบุ', 'm³', entry => entry.results.geometry.rockVolume, false],
    ['sandMinVolume', 'ปริมาตรชั้นทรายขั้นต่ำจำลองตามความยาวที่ระบุ', 'm³', entry => entry.results.geometry.sandMinVolume, false],
    ['toeVolume', 'ปริมาตรตีนหินจำลองตามความยาวที่ระบุ', 'm³', entry => entry.results.geometry.toeVolume, false],
    ['geotextileSlopeArea', 'พื้นที่แผ่นใยบนลาดทฤษฎีตามความยาวที่ระบุ', 'm²', entry => entry.results.geometry.geotextileSlopeArea, false],
    ['walkwayArea', 'พื้นที่ผิวทางเท้าทฤษฎีตามความยาวที่ระบุ', 'm²', entry => entry.results.geometry.walkwayArea, false],
  ]) addRow({ id: 'materials.' + id, group: 'materials', label, unit,
    reason: materialBasis + (!perLength && mixedLengths ? '; ใช้ความยาวต่างกัน (' + lengths.join(' / ') + ' m) ต้องอ่านค่าต่อความยาว 1 m ประกอบ' : ''),
    read: entry => cell(read(entry), 'computed', 'illustrative', perLength
      ? 'ต่อความยาวตามแนวงาน 1 m; ไม่ขึ้นกับความยาวรวมที่เลือก'
      : 'ความยาวที่ใช้ L = ' + entry.scenario.geometry.length + ' m; ไม่อนุมานความประหยัดหรือแทนความยาวแถว BOQ') });

  for (const [key, label, conditionId] of [
    ['AsMm2', 'พื้นที่เหล็กดึงหนึ่งหน้า As', 'minimum-flexural-steel'],
    ['AsMinMm2', 'เหล็กดึงขั้นต่ำ As,min', null],
    ['AvMm2', 'พื้นที่ขาปลอก Av', 'minimum-stirrups'],
    ['AvMinMm2', 'พื้นที่ขาปลอกขั้นต่ำ Av,min', null],
  ]) addRow({ id: 'beam.' + key, group: 'beam', label, unit: 'mm²',
    read: entry => {
      const condition = conditionId ? check(entry.results.beam, conditionId) : null;
      return cell(entry.results.beam[key], 'computed', condition?.status || 'illustrative', condition?.note || 'เกณฑ์ที่คำนวณจากหน้าตัดและวัสดุปัจจุบัน');
    } });
  addRow({ id: 'beam.usablePhiMnKnM', group: 'beam', label: 'φMn ที่ใช้เทียบ Mu หลังตรวจเงื่อนไข', unit: 'kN·m',
    reason: 'ไม่ใช้ φMn เชิงสมการแทนกำลังที่ถูกระงับ; ไม่ใช้ข้อยกเว้น 4/3', read: flexuralCell });
  addRow({ id: 'beam.usablePhiVnKn', group: 'beam', label: 'เพดานเฉือนที่ใช้เทียบ Vu หลังตรวจรายละเอียด', unit: 'kN',
    reason: 'ใช้เพดานที่จำกัดด้วยเหล็กปลอก ระยะปลอก และขีดจำกัด Vs', read: shearCell });
  for (const [type, demandId, ratioId, label, unit, demandKey] of [
    ['moment', 'MuKnM', 'momentUtilization', 'Mu', 'kN·m', 'externalMuKnM'],
    ['shear', 'VuKn', 'shearUtilization', 'Vu', 'kN', 'externalVuKn'],
  ]) {
    addRow({ id: 'beam.' + demandId, group: 'beam', label: label + ' ออกแบบที่ระบุ', unit,
      reason: 'แรงออกแบบที่คูณตัวคูณแล้ว; ไม่เติมหรือบวกตัวอย่างน้ำหนักตัวเองอัตโนมัติ', read: entry => demandCell(entry, type) });
    addRow({ id: 'beam.' + ratioId, group: 'beam', label: 'อัตราใช้กำลัง ' + label + ' / กำลังที่ใช้ได้', unit: 'อัตราส่วน',
      reason: 'เทียบแรงกับกำลังหลังตรวจเงื่อนไข; ไม่สรุปผลทั้งโครงการ', demandKey, read: entry => demandCell(entry, type, true) });
  }
  for (const [caseId, label] of [
    ['dry', 'FS ลาดอนันต์: effective stress, u=0'],
    ['parallel-seepage', 'FS ลาดอนันต์: effective stress, อิ่มตัวซึมขนานลาด'],
    ['undrained', 'FS ลาดอนันต์: total stress ด้วย Su'],
  ]) addRow({ id: 'soil.' + caseId + '.factorOfSafety', group: 'soil', label, unit: '—',
    reason: 'เปรียบเฉพาะรหัสกรณีเดียวกัน; ผลเป็นตัวอย่างกลไกสมมติ ไม่ตั้งเกณฑ์ผ่านอัตโนมัติ', read: entry => soilCell(entry, caseId) });

  const changedInputs = [];
  for (const [section, group, definitions] of INPUT_GROUPS) {
    for (const [key, label, unit] of definitions) {
      const path = section + '.' + key;
      const values = Object.fromEntries(entries.map(entry => [entry.id, entry.scenario[section][key]]));
      if (Object.values(values).some(value => value !== values[entries[0].id])) changedInputs.push({ path, label, unit, values });
      addRow({ id: 'input.' + path, group, label, unit, isInput: true,
        reason: 'แสดงค่าที่บันทึกครบทุกสถานการณ์ รวมค่าที่ไม่ใช้ในโหมดปัจจุบัน', read: entry => inputCell(entry, section, key) });
    }
  }
  const notices = [
    'เปรียบเทียบเฉพาะสถานีบริบทเดียวกัน; ตัวเลขและผลต่างไม่ใช่อันดับ ความประหยัด หรือการรับรองทางเลือกทั้งระบบ',
    'ปริมาณเป็นรูปทรงทฤษฎีแยกองค์ประกอบ; ไม่ปรับยอด BOQ ต้นฉบับ ไม่รวมเป็นปริมาณสุทธิ และไม่อนุมานปริมาณเหล็กหรือต้นทุน',
    'FS เป็นของลาดอนันต์เนื้อเดียวและระนาบวิบัติขนานลาด; ไม่ใช่ global FS ของโครงการหรือการคำนวณซ้ำ Slope/W',
    'ระดับน้ำที่บันทึกเป็นบริบทไม่ถูกแปลงเป็นแรงดันน้ำ; การเปลี่ยนรูปตัดหรือชั้นหินไม่สร้างแรงคานอัตโนมัติ',
    'กำลังคานอิงสมการประวัติ ACI318M-02 เฉพาะเงื่อนไขที่โมดูลตรวจ; ไม่มีผลผ่านรวมทั้งโครงการ',
  ];
  if (!reference) notices.push('ยังไม่มีทางเลือกอ้างอิง; ไม่แสดงผลต่างจนกว่าจะบันทึกและเลือกค่าฐาน');
  if (mixedLengths) notices.push('ความยาวที่ใช้คำนวณต่างกัน: ' + lengths.join(' / ') + ' m; อ่านปริมาณต่อความยาว 1 m ประกอบผลต่างปริมาณรวม');
  if (['externalMuKnM', 'externalVuKn'].some(key => entries.some(entry => entry.scenario.beamInputs[key] !== entries[0].scenario.beamInputs[key]))) {
    notices.push('แรงออกแบบที่ระบุต่างกันระหว่างสถานการณ์; ผลต่างอัตราใช้กำลังจะแสดงเฉพาะเมื่อเทียบแรงเดียวกัน');
  }
  return {
    metadata: {
      projectCode: project.projectCode, calculationRevision: project.calculationRevision,
      projectRevision: projectRevision(project), station: { ...station }, referenceId: comparison.referenceId,
    },
    entries, rows, changedInputs, notices,
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'number' && !finite(value)) throw new RangeError('CSV ต้องไม่มี NaN หรือ Infinity');
  let text = String(value);
  // Quoting alone does not stop spreadsheet formula interpretation. Preserve
  // actual numeric negatives, but neutralize formula-like user text, including
  // leading whitespace/control characters, before quoting the whole field.
  if (typeof value === 'string' && (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/** Long-form CSV, UTF-8 BOM included; explicit states preserve blank vs zero. */
export function comparisonCSV(record) {
  const metadata = record.metadata;
  const station = metadata.station;
  const header = ['project_code', 'calculation_revision', 'project_revision', 'station_id', 'reach', 'station_m',
    'source_sheet', 'source_row', 'source_effective_length_m', 'reference_id', 'entry_id', 'entry_name', 'entry_kind',
    'entry_created_at', 'scenario_revision', 'group', 'metric_id', 'label', 'unit', 'is_input', 'value',
    'availability', 'status', 'reason', 'delta', 'delta_percent'];
  const records = [header];
  for (const row of record.rows) {
    for (const entry of record.entries) {
      const value = row.cells[entry.id];
      records.push([metadata.projectCode, metadata.calculationRevision, metadata.projectRevision, station.id,
        station.reach, station.station, station.sourceSheet, station.sourceRow, station.effectiveLength,
        metadata.referenceId, entry.id, entry.name, entry.kind, entry.createdAt, entry.revision,
        row.group, row.id, row.label, row.unit, row.isInput, value.value, value.availability, value.status,
        [row.reason, value.reason].filter(Boolean).join('; '), value.delta, value.deltaPercent]);
    }
  }
  return '\ufeff' + records.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
