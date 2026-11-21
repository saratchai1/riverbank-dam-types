import { calculateBeam, calculateSoil, ENGINEERING_REFERENCES } from './engineering.js';
import {
  validateProject, stationCatalog, projectRevision, scenarioRevision,
  createDefaultScenario, getSoilInputs, isBaselineScenario,
} from './project.js';

// A derived review register, never a design approval or another solver. Inputs
// and results remain governed by the existing S6006-R2 project/engine boundary.
export const REVIEW_REVISION = 'S6006-REVIEW-1';

const clone = value => JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fmt = value => value === null ? 'ยังไม่ระบุ' : Number(value.toPrecision(10)).toString();
const action = (section, field = null) => ({
  panel: section === 'context' ? 'context' : section === 'model' ? 'model' : section === 'basis' ? 'basis' : 'engineering',
  section, field,
});
const beamPaths = (...fields) => fields.map(field => 'beamInputs.' + field);
const soilPaths = (...fields) => fields.map(field => 'soilInputs.' + field);

const LIMITATIONS = [
  {
    id: 'station-and-baseline', title: 'สถานีและค่าต้นแบบ',
    description: 'สถานีเป็นบริบทแถว BOQ รูปตัดยังเป็นรูปทรงทฤษฎี; ค่าต้นแบบหรือข้อมูลที่แก้แล้วไม่ยืนยันหน้าตัดสำรวจ การจับคู่หลุมเจาะ หรือการตรวจแบบ การเปลี่ยนบันทึกข้อความเพียงอย่างเดียวก็นับว่าต่างจากต้นแบบได้',
    sourceKeys: [],
  },
  {
    id: 'structural-system', title: 'ขอบเขตคานและแรงออกแบบ',
    description: 'ตรวจเฉพาะสมการหน้าตัดคาน BF1 ที่เลือกตามรูปแบบประวัติ ACI318M-02; ต้องยืนยันมาตรฐานโครงการ แรงครบทุกกรณี ระบบคานต่อเนื่อง แรงบิด จุดต่อ ระยะพัฒนาแรง การโก่งและแตกร้าว ตัวอย่างน้ำหนักตัวเองไม่แทน Mu/Vu ออกแบบจริง',
    sourceKeys: ['SP-LEGACY-BEAM', 'SP-LEGACY-METRIC', 'SP-STRESS-BLOCK'],
  },
  {
    id: 'soil-mechanism', title: 'ขอบเขตดินและเกณฑ์รับรอง',
    description: 'FS มาจากลาดอนันต์เนื้อเดียว ระนาบวิบัติขนานลาด และความลึกแนวดิ่งที่กำหนด; FS<1 เป็นข้อสังเกตของกลไกนี้ ส่วน FS≥1 ไม่ใช่เกณฑ์อนุมัติ ไม่มีผลเสถียรภาพรวม วงกลมวิบัติ หลายชั้นดิน หรือการคำนวณซ้ำ Slope/W เดิม',
    sourceKeys: ['USACE-1902'],
  },
  {
    id: 'water-mechanisms', title: 'ระดับน้ำและสภาวะการไหล',
    description: 'ระดับน้ำที่บันทึกเป็นบริบทไม่ได้สร้างแรงดันน้ำรูพรุนหรือแรงคาน; กรณีซึมขนานลาดสมมติอิ่มตัวถึงผิวและ steady seepage ไม่มีน้ำภายนอกค้ำยัน จึงไม่ใช่การวิเคราะห์น้ำลดฉับพลัน',
    sourceKeys: ['USACE-1902'],
  },
  {
    id: 'foundation-and-erosion', title: 'งานวิเคราะห์ระบบที่ต้องทำเพิ่มเติม',
    description: 'การทรุดตัว กำลังรับน้ำหนักฐานราก เสาเข็ม ปฏิสัมพันธ์ดิน–โครงสร้าง การกัดเซาะ และรายละเอียดการก่อสร้างยังต้องมีแบบจำลองและข้อมูลเฉพาะโครงการ ทะเบียนนี้ไม่สร้างผลตรวจเหล่านั้น',
    sourceKeys: [],
  },
  {
    id: 'evidence-confirmation', title: 'การยืนยันข้อมูลและเอกสาร',
    description: 'การกรอกค่า ระดับน้ำ ชื่อหลุมเจาะ หรือข้อความอ้างอิงหมายถึงบันทึกข้อมูลแล้วเท่านั้น ต้องตรวจเอกสาร วิธีทดสอบ ระบบระดับ และความเหมาะสมกับสถานีจริง; ไม่มีคะแนนความพร้อมหรือสถานะผ่านรวมทั้งโครงการ',
    sourceKeys: [],
  },
];

const BEAM_CONDITIONS = [
  ['flexural-yield', '—', ['tensionBarDiameterMm', 'tensionBarCount', 'heightMm', 'widthMm', 'fyKsc'], 'tensionBarDiameterMm', 'SP-LEGACY-BEAM'],
  ['flexural-strain', '—', ['tensionBarDiameterMm', 'tensionBarCount', 'heightMm', 'widthMm'], 'tensionBarDiameterMm', 'SP-LEGACY-BEAM'],
  ['minimum-flexural-steel', 'mm²', ['tensionBarDiameterMm', 'tensionBarCount', 'heightMm', 'widthMm', 'fcKsc', 'fyKsc'], 'tensionBarDiameterMm', 'SP-LEGACY-BEAM'],
  ['minimum-stirrups', 'mm²', ['stirrupDiameterMm', 'stirrupLegs', 'stirrupSpacingMm', 'fyvKsc', 'fcKsc'], 'stirrupDiameterMm', 'SP-LEGACY-METRIC'],
  ['stirrup-spacing', 'mm', ['stirrupSpacingMm', 'stirrupDiameterMm', 'stirrupLegs', 'heightMm', 'fyvKsc', 'fcKsc'], 'stirrupSpacingMm', 'SP-LEGACY-BEAM'],
  ['maximum-shear', 'kN', ['stirrupDiameterMm', 'stirrupLegs', 'stirrupSpacingMm', 'heightMm', 'widthMm', 'fyvKsc', 'fcKsc'], 'stirrupSpacingMm', 'SP-LEGACY-BEAM'],
];

function finding(id, group, label, options) {
  return {
    id, group, availability: 'computed', disposition: 'computed-only',
    label, value: null, limit: null, unit: '', reason: '', inputPaths: [], sourceKeys: [],
    actionTarget: action(group), ...options,
  };
}

function beamFindings(inputs, beam) {
  const byId = id => {
    const check = beam.checks.find(item => item.id === id);
    if (!check) throw new RangeError('ไม่พบเงื่อนไขคาน R2: ' + id);
    return check;
  };
  const findings = BEAM_CONDITIONS.map(([id, unit, fields, field, source]) => {
    const check = byId(id);
    return finding('beam.' + id, 'beam', check.label, {
      disposition: check.status === 'satisfied' ? 'condition-met' : 'attention',
      value: check.value, limit: check.limit, unit, reason: check.note,
      inputPaths: beamPaths(...fields), sourceKeys: [source], actionTarget: action('beam', field),
    });
  });
  const exception = byId('minimum-flexural-exception');
  findings.push(finding('beam.minimum-flexural-exception', 'beam', exception.label, {
    availability: exception.status === 'not-required' ? 'not-applicable' : 'provided',
    disposition: exception.status === 'not-required' ? 'not-applicable' : 'outside-scope',
    reason: exception.note, inputPaths: beamPaths('tensionBarDiameterMm', 'tensionBarCount', 'externalMuKnM'),
    sourceKeys: ['SP-LEGACY-BEAM'], actionTarget: action('basis'),
  }));

  const flexuralReasons = ['flexural-yield', 'flexural-strain', 'minimum-flexural-steel']
    .map(byId).filter(check => check.status !== 'satisfied').map(check => check.label + ': ' + check.note);
  findings.push(finding('beam.usable-moment', 'beam', 'กำลังดัดที่ใช้เทียบ Mu หลังตรวจเงื่อนไข', {
    availability: beam.usablePhiMnKnM === null ? 'gated' : 'computed',
    disposition: beam.usablePhiMnKnM === null ? 'attention' : 'condition-met',
    value: beam.usablePhiMnKnM, unit: 'kN·m',
    reason: beam.usablePhiMnKnM === null ? flexuralReasons.join('; ') + '; ไม่ใช้ข้อยกเว้น 4/3 ในโมดูล'
      : 'ผ่านเกณฑ์เหล็กคราก εt≥0.004 และ As≥As,min ที่โมดูลตรวจ; ยังต้องตรวจ Mu และรายละเอียดระบบจริง',
    inputPaths: beamPaths('tensionBarDiameterMm', 'tensionBarCount', 'widthMm', 'heightMm', 'coverMm', 'fcKsc', 'fyKsc'),
    sourceKeys: ['SP-LEGACY-BEAM', 'SP-STRESS-BLOCK'], actionTarget: action('beam', 'tensionBarDiameterMm'),
  }));
  const deficientShear = ['minimum-stirrups', 'stirrup-spacing'].map(byId).filter(check => check.status !== 'satisfied');
  const shearReason = beam.usablePhiVnKn === null
    ? 'Vs เกินขีดจำกัดหน้าตัด; ยังไม่มีเพดานเฉือนที่ใช้ตรวจ Vu'
    : deficientShear.length ? 'จำกัดเพดานเป็น φVc/2 = ' + fmt(beam.usablePhiVnKn) + ' kN เนื่องจาก '
      + deficientShear.map(check => check.label).join(' และ ') + '; ค่า Vu ต่ำกว่าเพดานนี้ไม่ยกเลิกประเด็นรายละเอียดปลอก'
      : 'เพดานหลังตรวจปลอกขั้นต่ำ ระยะปลอก และขีดจำกัด Vs ในโมดูล; ยังต้องตรวจ Vu และรายละเอียดระบบจริง';
  findings.push(finding('beam.usable-shear', 'beam', 'เพดานเฉือนที่ใช้เทียบ Vu หลังตรวจรายละเอียด', {
    availability: beam.usablePhiVnKn === null ? 'gated' : 'computed',
    disposition: beam.usablePhiVnKn === null || deficientShear.length ? 'attention' : 'condition-met',
    value: beam.usablePhiVnKn, unit: 'kN', reason: shearReason,
    inputPaths: beamPaths('stirrupDiameterMm', 'stirrupLegs', 'stirrupSpacingMm', 'heightMm', 'widthMm', 'fcKsc', 'fyvKsc'),
    sourceKeys: ['SP-LEGACY-BEAM', 'SP-LEGACY-METRIC'], actionTarget: action('beam', 'stirrupSpacingMm'),
  }));
  for (const [id, key, capacity, unit] of [
    ['external-moment', 'externalMuKnM', beam.usablePhiMnKnM, 'kN·m'],
    ['external-shear', 'externalVuKn', beam.usablePhiVnKn, 'kN'],
  ]) {
    const check = byId(id), demand = inputs[key];
    const availability = demand === null ? 'missing' : capacity === null ? 'gated' : 'computed';
    const disposition = demand === null ? 'missing' : capacity === null || demand > capacity ? 'attention' : 'condition-met';
    findings.push(finding('beam.' + id, 'beam', check.label, {
      availability, disposition, value: demand, limit: capacity, unit,
      reason: check.note + (demand !== null && capacity !== null && demand > capacity ? '; แรงที่ระบุเกินกำลังที่ใช้ตรวจได้' : '')
        + '; ต้องยืนยันที่มาและการรวมแรงออกแบบที่คูณตัวคูณแล้ว ไม่บวกตัวอย่างน้ำหนักตัวเองอัตโนมัติ',
      inputPaths: beamPaths(key), sourceKeys: ['SP-LEGACY-BEAM'], actionTarget: action('beam', key),
    }));
  }
  findings.push(finding('beam.selfweight-only', 'beam', 'ตัวอย่างโมเมนต์จากน้ำหนักตัวคานเท่านั้น', {
    value: beam.selfWeightMuKnM, unit: 'kN·m',
    reason: 'คานรองรับง่าย L=' + fmt(inputs.spanM) + ' m; cover=' + fmt(inputs.coverMm) + ' mm; ตัวคูณน้ำหนักตัวเอง='
      + fmt(inputs.deadLoadFactor) + '; Mu,self=' + fmt(beam.selfWeightMuKnM) + ' kN·m และ Vu,self='
      + fmt(beam.selfWeightVuKn) + ' kN ไม่แทนแรงออกแบบครบทุกกรณี',
    inputPaths: beamPaths('spanM', 'coverMm', 'deadLoadFactor', 'concreteUnitWeightTfM3', 'widthMm', 'heightMm'),
    sourceKeys: ['SP-LEGACY-BEAM'], actionTarget: action('beam', 'spanM'),
  }));
  return findings;
}

function soilFindings(inputs, soil) {
  const results = new Map((soil?.cases ?? []).map(item => [item.id, item]));
  const parameterText = 'ลาด=' + fmt(inputs.slopeH) + 'H:1V; z=' + fmt(inputs.verticalDepthM) + ' m แนวดิ่ง; γsat='
    + fmt(inputs.saturatedUnitWeightKnM3) + ' kN/m³; ' + (inputs.mode === 'effective'
      ? 'γ=' + fmt(inputs.unitWeightKnM3) + ' kN/m³; γw=' + fmt(inputs.waterUnitWeightKnM3)
        + ' kN/m³; c′=' + fmt(inputs.effectiveCohesionKpa) + ' kPa; φ′=' + fmt(inputs.frictionAngleDeg) + '°'
      : 'Su=' + fmt(inputs.undrainedStrengthKpa) + ' kPa');
  return [
    ['dry', 'FS ลาดอนันต์: u=0', 'ใช้ γ ที่ระบุและ u=0'],
    ['parallel-seepage', 'FS ลาดอนันต์: อิ่มตัวน้ำซึมขนานลาด', 'อิ่มตัวถึงผิว steady seepage ขนานลาด ไม่มีน้ำภายนอกค้ำยัน; ไม่ใช่น้ำลดฉับพลัน'],
    ['undrained', 'FS ลาดอนันต์: total stress ด้วย Su', 'ใช้ Su และ γsat ใน total stress; ไม่หัก u ซ้ำ'],
  ].map(([id, label, scope]) => {
    const applies = inputs.mode === 'effective' ? id !== 'undrained' : id === 'undrained';
    const result = results.get(id);
    if (applies && soil !== null && !result) throw new RangeError('ไม่พบกรณีดิน R2: ' + id);
    const missing = applies && soil === null;
    return finding('soil.' + id, 'soil', label, {
      availability: !applies ? 'not-applicable' : missing ? 'missing' : 'computed',
      disposition: !applies ? 'not-applicable' : missing ? 'missing' : result.factorOfSafety < 1 ? 'attention' : 'computed-only',
      value: result?.factorOfSafety ?? null, unit: '—',
      // 1 is an equilibrium observation, never an adopted design acceptance target.
      limit: null,
      reason: !applies ? 'ไม่ใช่กรณีของโหมดดินที่เลือก; ไม่เทียบข้าม effective stress กับ total stress'
        : missing ? 'ยังไม่มี Su สำหรับ total stress; ยังไม่มีผลกำลังเฉือนหรือ FS ไม่แทนช่องว่างด้วยค่าทดลอง; ' + parameterText
          : scope + '; ' + parameterText + '; '
            + (result.factorOfSafety < 1 ? 'FS<1 สำหรับกลไกสมมตินี้; ต้องทบทวนสมมติฐานและแบบ' : 'คำนวณกลไกสมมติได้ ยังไม่มีเกณฑ์อนุมัติโครงการ')
            + '; ไม่ใช่ global FS และต้องยืนยันฐานพารามิเตอร์/วิธีทดสอบ',
      inputPaths: ['geometry.slopeH', ...soilPaths('mode', 'verticalDepthM',
        ...(id === 'undrained' ? ['undrainedStrengthKpa', 'saturatedUnitWeightKnM3']
          : ['effectiveCohesionKpa', 'frictionAngleDeg', id === 'dry' ? 'unitWeightKnM3' : 'saturatedUnitWeightKnM3',
            ...(id === 'parallel-seepage' ? ['waterUnitWeightKnM3'] : [])]))],
      sourceKeys: ['USACE-1902'], actionTarget: action('soil', id === 'undrained' ? 'undrainedStrengthKpa' : 'frictionAngleDeg'),
    });
  });
}

function contextFindings(context) {
  return [
    ['waterHighLevel', 'ระดับน้ำสูง', 'm'],
    ['waterLowLevel', 'ระดับน้ำต่ำ', 'm'],
    ['groundwaterLevel', 'ระดับน้ำใต้ดินอ้างอิง', 'm'],
    ['boreholeReference', 'ที่มาดิน/หลุมเจาะและความสัมพันธ์กับสถานี', ''],
    ['waterReference', 'ที่มาระดับน้ำและระบบระดับ', ''],
    ['sourceNote', 'บันทึกแหล่งข้อมูลและข้อสมมติ', ''],
  ].map(([key, label, unit]) => {
    const value = context[key], missing = value === null || (typeof value === 'string' && !value.trim());
    const reason = missing ? 'ยังไม่ระบุ ' + label + '; ต้องรวบรวมและตรวจข้อมูลที่สัมพันธ์กับสถานีจริง'
      : typeof value === 'number' ? 'บันทึกระดับน้ำเป็นบริบทแล้ว ยังต้องตรวจที่มาและ datum; ค่านี้ไม่สร้างแรงดันน้ำรูพรุนหรือแรงคานอัตโนมัติ'
        : 'บันทึกข้อความอ้างอิงแล้ว ยังไม่ได้ยืนยันเอกสาร วิธีทดสอบ หรือความเหมาะสมกับสถานีจริง';
    return finding('context.' + key, 'context', label, {
      availability: missing ? 'missing' : 'provided', disposition: missing ? 'missing' : 'recorded',
      value, unit, reason, inputPaths: ['context.' + key], sourceKeys: [], actionTarget: action('context', key),
    });
  });
}

function entryCounts(findings) {
  return {
    attention: findings.filter(item => item.disposition === 'attention').length,
    missing: findings.filter(item => item.disposition === 'missing').length,
    withheld: findings.filter(item => item.availability === 'gated').length,
  };
}

function summarize(entries) {
  const current = entries.filter(entry => entry.kind === 'current');
  return {
    stationCount: new Set(entries.map(entry => entry.station.id)).size,
    entryCount: entries.length, currentCount: current.length,
    savedCount: entries.filter(entry => entry.kind === 'saved').length,
    baselineCurrentCount: current.filter(entry => entry.baseline).length,
    modifiedCurrentCount: current.filter(entry => !entry.baseline).length,
    attentionEntryCount: entries.filter(entry => entry.counts.attention > 0).length,
    missingEntryCount: entries.filter(entry => entry.counts.missing > 0).length,
    withheldEntryCount: entries.filter(entry => entry.counts.withheld > 0).length,
    attentionFindingCount: entries.reduce((sum, entry) => sum + entry.counts.attention, 0),
    missingFindingCount: entries.reduce((sum, entry) => sum + entry.counts.missing, 0),
    withheldFindingCount: entries.reduce((sum, entry) => sum + entry.counts.withheld, 0),
  };
}

function makeEntry(station, scenario, { id, name, kind, createdAt, isReference }) {
  const inputs = clone(scenario), beam = calculateBeam(inputs.beamInputs), soilInputs = getSoilInputs(inputs);
  const missingSu = soilInputs.mode === 'undrained' && soilInputs.undrainedStrengthKpa === null;
  const soil = missingSu ? null : calculateSoil(soilInputs);
  const findings = [...beamFindings(inputs.beamInputs, beam), ...soilFindings(soilInputs, soil), ...contextFindings(inputs.context)];
  const soilCases = { dry: null, 'parallel-seepage': null, undrained: null };
  for (const item of soil?.cases ?? []) soilCases[item.id] = item.factorOfSafety;
  return {
    key: station.id + '/' + id, station: { ...station }, scenarioId: id, scenarioName: name,
    kind, createdAt, scenarioRevision: scenarioRevision(inputs), baseline: isBaselineScenario(inputs), isReference,
    inputs,
    metrics: {
      usablePhiMnKnM: beam.usablePhiMnKnM, usablePhiVnKn: beam.usablePhiVnKn,
      MuKnM: beam.externalDemand.MuKnM, VuKn: beam.externalDemand.VuKn,
      momentUtilization: beam.externalDemand.momentUtilization, shearUtilization: beam.externalDemand.shearUtilization,
      soilMode: soilInputs.mode, soilCases,
    }, findings, counts: entryCounts(findings),
  };
}

/** Every BOQ station has one current context followed by its saved snapshots. */
export function buildReview(project, source) {
  const validation = validateProject(project, source);
  if (!validation.valid) throw new RangeError(validation.errors.join('; '));
  const stations = stationCatalog(source), entries = [];
  // Full validation above permits reading these plain, accessor-free structures
  // directly; avoid rescanning the whole project once per entry.
  for (const station of stations) {
    const scenario = own(project.stationScenarios, station.id) ? project.stationScenarios[station.id] : createDefaultScenario();
    const comparison = project.version >= 2 && own(project.stationComparisons, station.id)
      ? project.stationComparisons[station.id] : { referenceId: null, alternatives: [] };
    entries.push(makeEntry(station, scenario, { id: 'current', name: 'ค่าที่กำลังแก้', kind: 'current', createdAt: null, isReference: false }));
    for (const alternative of comparison.alternatives) entries.push(makeEntry(station, alternative.scenario, {
      id: alternative.id, name: alternative.name, kind: 'saved', createdAt: alternative.createdAt,
      isReference: alternative.id === comparison.referenceId,
    }));
  }
  return {
    metadata: { projectCode: project.projectCode, projectRevision: projectRevision(project),
      calculationRevision: project.calculationRevision, reviewRevision: REVIEW_REVISION },
    stations, entries, summary: summarize(entries), limitations: clone(LIMITATIONS),
    sources: Object.entries(ENGINEERING_REFERENCES).map(([id, reference]) => ({ id, ...reference })),
  };
}

function validateSelection(record, selection) {
  if (!record || record.metadata?.reviewRevision !== REVIEW_REVISION || !Array.isArray(record.entries) || !Array.isArray(record.stations)) {
    throw new TypeError('ต้องใช้ทะเบียนตรวจงานที่สร้างจาก S6006 รุ่นที่รองรับ');
  }
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(selection))) throw new TypeError('ตัวกรองต้องเป็นข้อมูล object ปกติ');
  const keys = Reflect.ownKeys(selection), expected = ['stationId', 'kind', 'focus'];
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key)
    || !own(Object.getOwnPropertyDescriptor(selection, key), 'value')
    || !Object.getOwnPropertyDescriptor(selection, key).enumerable)) throw new TypeError('ตัวกรองรองรับเฉพาะ stationId, kind และ focus ครบทุกช่อง');
  const { stationId, kind, focus } = selection;
  if (typeof stationId !== 'string' || (stationId !== 'all' && !record.stations.some(station => station.id === stationId))) throw new RangeError('ไม่พบสถานีที่ใช้กรองในทะเบียน');
  if (!['all', 'current', 'saved'].includes(kind)) throw new RangeError('ชนิดสถานการณ์ที่ใช้กรองไม่ถูกต้อง');
  if (!['all', 'attention', 'missing', 'baseline'].includes(focus)) throw new RangeError('สถานะที่ใช้กรองไม่ถูกต้อง');
  return { stationId, kind, focus };
}

/** Filters entries only; every finding of an included entry remains available. */
export function selectReview(record, selection = { stationId: 'all', kind: 'all', focus: 'all' }) {
  const accepted = validateSelection(record, selection);
  const eligible = record.entries.filter(entry => (accepted.stationId === 'all' || entry.station.id === accepted.stationId)
    && (accepted.kind === 'all' || entry.kind === accepted.kind));
  const entries = eligible.filter(entry => accepted.focus === 'all'
    || (accepted.focus === 'attention' && entry.counts.attention > 0)
    || (accepted.focus === 'missing' && entry.counts.missing > 0)
    || (accepted.focus === 'baseline' && entry.baseline));
  return clone({
    metadata: record.metadata, selection: accepted, entries,
    eligibleCount: eligible.length, includedCount: entries.length, excludedCount: eligible.length - entries.length,
    summary: summarize(entries), limitations: record.limitations, sources: record.sources,
  });
}

function csvCell(value) {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'number' && !finite(value)) throw new RangeError('CSV ต้องไม่มี NaN หรือ Infinity');
  let text = String(value);
  // Actual numeric negatives remain numbers; formula-like text is inert.
  if (typeof value === 'string' && (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/** One row per finding, with immutable identities and explicit export scope. */
export function reviewCSV(record, selection) {
  const selected = selectReview(record, selection);
  if (!selected.entries.length) throw new RangeError('ไม่มีสถานการณ์ตามตัวกรอง จึงยังไม่สร้างไฟล์ส่งออก');
  const m = selected.metadata, s = selected.selection;
  const scope = selected.limitations.map(item => item.id + ': ' + item.description).join(' | ');
  const references = new Map(selected.sources.map(item => [item.id, item]));
  const rows = [[
    'project_code', 'project_revision', 'calculation_revision', 'review_revision',
    'filter_station_id', 'filter_kind', 'filter_focus', 'eligible_entry_count', 'included_entry_count', 'excluded_entry_count',
    'station_id', 'reach', 'station_m', 'source_sheet', 'source_row', 'source_effective_length_m',
    'entry_key', 'scenario_id', 'scenario_name', 'scenario_kind', 'scenario_created_at', 'scenario_revision', 'is_baseline', 'is_reference',
    'finding_id', 'group', 'label', 'value', 'limit', 'unit', 'availability', 'disposition', 'reason',
    'input_paths', 'source_keys', 'source_references', 'action_panel', 'action_section', 'action_field', 'shared_scope_limitations',
  ]];
  for (const entry of selected.entries) for (const item of entry.findings) rows.push([
    m.projectCode, m.projectRevision, m.calculationRevision, m.reviewRevision,
    s.stationId, s.kind, s.focus, selected.eligibleCount, selected.includedCount, selected.excludedCount,
    entry.station.id, entry.station.reach, entry.station.station, entry.station.sourceSheet, entry.station.sourceRow, entry.station.effectiveLength,
    entry.key, entry.scenarioId, entry.scenarioName, entry.kind, entry.createdAt, entry.scenarioRevision, entry.baseline, entry.isReference,
    item.id, item.group, item.label, item.value, item.limit, item.unit, item.availability, item.disposition, item.reason,
    item.inputPaths.join(' | '), item.sourceKeys.join(' | '), item.sourceKeys.map(key => {
      const reference = references.get(key);
      return reference ? key + ': ' + reference.title + '; ' + reference.sections + '; ' + reference.url : key;
    }).join(' | '), item.actionTarget.panel, item.actionTarget.section, item.actionTarget.field, scope,
  ]);
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
