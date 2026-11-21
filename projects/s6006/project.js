import { DEFAULT_INPUTS, validateInputs } from './engine.js';
import { DEFAULT_BEAM_INPUTS, DEFAULT_SOIL_INPUTS, calculateBeam, calculateSoil } from './engineering.js';

// A BOQ station is a source-row context, not a reconstructed survey profile.
// Calculated results are deliberately absent from the persisted project model.
export const PROJECT_SCHEMA = 'riverbank.s6006.project';
export const PROJECT_VERSION = 2;
export const CALCULATION_REVISION = 'S6006-R2';
export const PROJECT_MAX_BYTES = 1024 * 1024;
export const MAX_STATION_ALTERNATIVES = 3;
export const ALTERNATIVE_NAME_MAX_LENGTH = 48;
export const DEFAULT_CONTEXT = Object.freeze({
  waterHighLevel: null, waterLowLevel: null, groundwaterLevel: null,
  boreholeReference: '', waterReference: '', sourceNote: '',
});

const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const PROJECT_V1_KEYS = ['schema', 'version', 'calculationRevision', 'projectCode', 'selectedStationId', 'stationScenarios'];
const PROJECT_V2_KEYS = [...PROJECT_V1_KEYS, 'stationComparisons'];
const SCENARIO_KEYS = ['geometry', 'beamInputs', 'soilInputs', 'context'];
const SOIL_KEYS = Object.keys(DEFAULT_SOIL_INPUTS).filter(key => key !== 'slopeH');
const STATION_ID = /^r[1-9]\d*-row[1-9]\d*$/;
const ALTERNATIVE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clone = value => JSON.parse(JSON.stringify(value));

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

// Inspect descriptors before reading values so imports/updates cannot run getters.
// Reject shared/cyclic object graphs, unsupported prototypes and reserved keys.
function assertPlainData(root) {
  const seen = new WeakSet();
  const stack = [{ value: root, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (++count > 50000 || depth > 16) throw new RangeError('ข้อมูลโครงการซ้อนลึกหรือมีจำนวนรายการเกินขอบเขต');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RangeError('ข้อมูลโครงการต้องไม่มี NaN หรือ Infinity');
      continue;
    }
    if (typeof value !== 'object' || (!Array.isArray(value) && !plain(value))) throw new TypeError('ข้อมูลโครงการต้องเป็น JSON ปกติ');
    if (seen.has(value)) throw new TypeError('ข้อมูลโครงการต้องไม่มีวงจรหรือ object อ้างอิงร่วม');
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string' || RESERVED.has(key)) throw new TypeError('พบชื่อข้อมูลสงวนหรือชื่อที่ไม่รองรับ');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!own(descriptor, 'value')) throw new TypeError('ไม่อนุญาต getter/setter ในข้อมูลโครงการ');
      if (!descriptor.enumerable) throw new TypeError('ไม่อนุญาตข้อมูลซ่อนที่ JSON ไม่สามารถบันทึกได้');
      stack.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
}

function exactKeys(object, keys, label) {
  if (!plain(object)) throw new TypeError(`${label} ต้องเป็น object ปกติ`);
  const expected = new Set(keys);
  for (const key of Object.keys(object)) if (!expected.has(key)) throw new TypeError(`${label}: ไม่รองรับข้อมูล ${key}`);
  for (const key of keys) if (!own(object, key)) throw new TypeError(`${label}: ไม่มีข้อมูล ${key}`);
}

function assertProjectHeader(project) {
  if (!plain(project)) throw new TypeError('project ต้องเป็น object ปกติ');
  exactKeys(project, project.version === 2 ? PROJECT_V2_KEYS : PROJECT_V1_KEYS, 'project');
  if (project.schema !== PROJECT_SCHEMA || ![1, 2].includes(project.version)
    || project.calculationRevision !== CALCULATION_REVISION || project.projectCode !== 'S6006') {
    throw new TypeError('รูปแบบ รุ่นโครงการ หรือรุ่นการคำนวณไม่ตรงกับ S6006 ที่รองรับ');
  }
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

function fingerprint(text, prefix) {
  // Deterministic change identifier, not a cryptographic signature or approval.
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
  }
  return prefix + (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function createDefaultScenario() {
  return {
    geometry: { ...DEFAULT_INPUTS },
    beamInputs: { ...DEFAULT_BEAM_INPUTS },
    soilInputs: Object.fromEntries(SOIL_KEYS.map(key => [key, DEFAULT_SOIL_INPUTS[key]])),
    context: { ...DEFAULT_CONTEXT },
  };
}

export function stationCatalog(source) {
  if (!plain(source) || !Array.isArray(source.rows) || !source.rows.length || source.rows.length > 1000) {
    throw new TypeError('ไม่พบทะเบียนแถวสถานี BOQ ที่ใช้เป็นบริบทโครงการ');
  }
  const ids = new Set();
  return source.rows.map(row => {
    if (!plain(row) || !Number.isSafeInteger(row.reach) || row.reach < 1
      || !Number.isSafeInteger(row.sourceRow) || row.sourceRow < 1
      || !finite(row.stationM) || row.stationM < 0 || row.stationM > 100000
      || !finite(row.effectiveLengthM) || row.effectiveLengthM <= 0
      || typeof row.sourceSheet !== 'string' || !row.sourceSheet.trim()) {
      throw new TypeError('ทะเบียนแถวสถานี BOQ มีบริบทไม่ถูกต้อง');
    }
    const id = `r${row.reach}-row${row.sourceRow}`;
    if (ids.has(id)) throw new TypeError('ทะเบียนแถวสถานี BOQ มีรหัสซ้ำ');
    ids.add(id);
    return { id, reach: row.reach, station: row.stationM, sourceRow: row.sourceRow,
      sourceSheet: row.sourceSheet, effectiveLength: row.effectiveLengthM };
  });
}

export function createProject(source) {
  const [first] = stationCatalog(source);
  return {
    schema: PROJECT_SCHEMA, version: PROJECT_VERSION, calculationRevision: CALCULATION_REVISION,
    projectCode: 'S6006', selectedStationId: first.id, stationScenarios: {}, stationComparisons: {},
  };
}

export function getSoilInputs(scenario) {
  assertPlainData(scenario);
  exactKeys(scenario, SCENARIO_KEYS, 'scenario');
  exactKeys(scenario.soilInputs, SOIL_KEYS, 'soilInputs');
  return { ...scenario.soilInputs, slopeH: scenario.geometry.slopeH };
}

function validateScenario(scenario) {
  assertPlainData(scenario);
  exactKeys(scenario, SCENARIO_KEYS, 'scenario');
  const geometry = validateInputs(scenario.geometry);
  if (!geometry.valid) throw new RangeError('มิติต้องถูกต้องและระดับสันต้องสูงกว่าตีน: ' + geometry.errors.join('; '));
  exactKeys(scenario.beamInputs, Object.keys(DEFAULT_BEAM_INPUTS), 'beamInputs');
  // Calculation validates the R2 numerical/geometry gates as well as input types.
  calculateBeam(scenario.beamInputs);
  const soil = getSoilInputs(scenario);
  const missingSu = soil.mode === 'undrained' && soil.undrainedStrengthKpa === null;
  if (missingSu) {
    // A pending Su is allowed in saved drafts. Probe ONLY the other input and
    // numerical-domain conditions with 1 kPa, discard that result, and preserve
    // Su=null. The UI/report still calls calculateSoil(soil), which cannot return
    // a result until the user supplies Su. This is not an assumed design value.
    calculateSoil({ ...soil, undrainedStrengthKpa: 1 });
  } else calculateSoil(soil);
  exactKeys(scenario.context, Object.keys(DEFAULT_CONTEXT), 'context');
  for (const key of ['waterHighLevel', 'waterLowLevel', 'groundwaterLevel']) {
    const value = scenario.context[key];
    if (value !== null && (!finite(value) || Math.abs(value) > 100000)) throw new RangeError(`context.${key}: ต้องเป็นระดับตัวเลขที่มีค่าจำกัด หรือ null เมื่อยังไม่ทราบ`);
  }
  if (scenario.context.waterHighLevel !== null && scenario.context.waterLowLevel !== null
    && scenario.context.waterHighLevel < scenario.context.waterLowLevel) throw new RangeError('ระดับน้ำสูงต้องไม่น้อยกว่าระดับน้ำต่ำ');
  for (const key of ['boreholeReference', 'waterReference', 'sourceNote']) {
    if (typeof scenario.context[key] !== 'string' || scenario.context[key].length > 2000) throw new TypeError(`context.${key}: ต้องเป็นข้อความไม่เกิน 2000 ตัวอักษร`);
  }
  return { missingSu };
}

function validateAlternativeId(id) {
  // "current" is the comparison adapter's working-scenario entry, never a saved ID.
  if (typeof id !== 'string' || id !== id.trim() || !ALTERNATIVE_ID.test(id) || RESERVED.has(id) || id === 'current') {
    throw new TypeError('รหัสทางเลือกต้องเป็นตัวอักษรหรือตัวเลข ตามด้วยตัวอักษร ตัวเลข _ หรือ - ไม่เกิน 80 ตัว และไม่ใช้ชื่อสงวน');
  }
}

function normalizedAlternativeName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > ALTERNATIVE_NAME_MAX_LENGTH) {
    throw new TypeError(`ชื่อทางเลือกต้องเป็นข้อความที่ไม่ว่างและไม่เกิน ${ALTERNATIVE_NAME_MAX_LENGTH} ตัวอักษร`);
  }
  return name.trim();
}

function validateAlternativeTimestamp(value) {
  // Require an unambiguous UTC ISO timestamp and reject normalized invalid dates
  // such as February 30; Date.parse alone would accept several non-timestamps.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new TypeError('เวลาบันทึกทางเลือกต้องเป็น UTC ISO timestamp');
  }
  const time = Date.parse(value), canonical = value.includes('.') ? value : value.replace(/Z$/, '.000Z');
  if (!Number.isFinite(time) || new Date(time).toISOString() !== canonical) throw new TypeError('เวลาบันทึกทางเลือกไม่ถูกต้อง');
}

function validateStationComparison(comparison) {
  exactKeys(comparison, ['referenceId', 'alternatives'], 'stationComparison');
  const { alternatives, referenceId } = comparison;
  if (!Array.isArray(alternatives) || alternatives.length > MAX_STATION_ALTERNATIVES
    || Object.keys(alternatives).length !== alternatives.length
    || Object.keys(alternatives).some((key, index) => key !== String(index))) {
    throw new TypeError(`รายการทางเลือกต้องเป็น array ต่อเนื่อง ไม่เกิน ${MAX_STATION_ALTERNATIVES} รายการต่อสถานี`);
  }
  const ids = new Set();
  for (const alternative of alternatives) {
    exactKeys(alternative, ['id', 'name', 'createdAt', 'scenario'], 'alternative');
    validateAlternativeId(alternative.id);
    if (ids.has(alternative.id)) throw new TypeError('รหัสทางเลือกซ้ำในสถานีเดียวกัน');
    ids.add(alternative.id);
    if (alternative.name !== normalizedAlternativeName(alternative.name)) throw new TypeError('ชื่อทางเลือกต้องไม่มีช่องว่างที่หัวหรือท้าย');
    validateAlternativeTimestamp(alternative.createdAt);
    validateScenario(alternative.scenario);
  }
  if ((!alternatives.length && referenceId !== null) || (alternatives.length && !ids.has(referenceId))) {
    throw new TypeError('ทางเลือกอ้างอิงต้องอยู่ในรายการของสถานี หรือเป็น null เมื่อยังไม่มีทางเลือก');
  }
}

/** Saved scenarios are independent copies; callers cannot modify them through this getter. */
export function getStationComparison(project, stationId) {
  assertPlainData(project);
  assertProjectHeader(project);
  const id = stationId === undefined ? project.selectedStationId : stationId;
  if (typeof id !== 'string' || !STATION_ID.test(id)) throw new TypeError('รหัสบริบทสถานีไม่ถูกต้อง');
  if (project.version === 1) return { referenceId: null, alternatives: [] };
  if (!plain(project.stationComparisons)) throw new TypeError('stationComparisons ต้องเป็น object ของสถานี');
  const comparison = own(project.stationComparisons, id)
    ? project.stationComparisons[id] : { referenceId: null, alternatives: [] };
  validateStationComparison(comparison);
  return clone(comparison);
}

export function getScenario(project, stationId) {
  assertPlainData(project);
  if (!plain(project.stationScenarios) || typeof stationId !== 'string' || !STATION_ID.test(stationId)) throw new TypeError('รหัสบริบทสถานีไม่ถูกต้อง');
  const scenario = own(project.stationScenarios, stationId) ? project.stationScenarios[stationId] : createDefaultScenario();
  validateScenario(scenario);
  return clone(scenario);
}

export function getActiveScenario(project) {
  assertPlainData(project);
  return getScenario(project, project.selectedStationId);
}

export function isBaselineScenario(scenario) {
  validateScenario(scenario);
  return stable(scenario) === stable(createDefaultScenario());
}

export function scenarioRevision(scenario) {
  validateScenario(scenario);
  return fingerprint(CALCULATION_REVISION + '|' + stable(scenario), 's6006s-');
}

function canonicalProject(project) {
  const stationScenarios = {};
  for (const id of Object.keys(project.stationScenarios).sort()) {
    const scenario = project.stationScenarios[id];
    if (!isBaselineScenario(scenario)) stationScenarios[id] = clone(scenario);
  }
  const canonical = {
    schema: project.schema, version: project.version, calculationRevision: project.calculationRevision,
    projectCode: project.projectCode, selectedStationId: project.selectedStationId, stationScenarios,
  };
  // Native v1 records retain their exact old shape and hash. This is essential
  // for immutable report snapshots already issued before alternatives existed.
  if (project.version === 2) {
    if (!plain(project.stationComparisons)) throw new TypeError('stationComparisons ต้องเป็น object ของสถานี');
    canonical.stationComparisons = {};
    for (const id of Object.keys(project.stationComparisons).sort()) {
      const comparison = project.stationComparisons[id];
      validateStationComparison(comparison);
      if (comparison.alternatives.length) canonical.stationComparisons[id] = clone(comparison);
    }
  }
  return canonical;
}

export function projectRevision(project) {
  assertPlainData(project);
  assertProjectHeader(project);
  const { selectedStationId, ...content } = canonicalProject(project);
  return fingerprint(stable(content), 's6006p-');
}

export function validateProject(project, source) {
  const errors = [], warnings = [];
  try {
    assertPlainData(project);
    assertProjectHeader(project);
    const catalog = stationCatalog(source), ids = new Set(catalog.map(row => row.id));
    if (typeof project.selectedStationId !== 'string' || !ids.has(project.selectedStationId)) throw new RangeError('สถานีที่เลือกไม่มีในทะเบียน BOQ ต้นฉบับ');
    if (!plain(project.stationScenarios)) throw new TypeError('stationScenarios ต้องเป็น object ของสถานี');
    for (const [id, scenario] of Object.entries(project.stationScenarios)) {
      if (!ids.has(id)) throw new RangeError(`ไม่พบรหัสสถานี ${id} ในทะเบียน BOQ ต้นฉบับ`);
      try { validateScenario(scenario); } catch (error) { errors.push(`${id}: ${error.message}`); }
    }
    if (project.version === 2) {
      if (!plain(project.stationComparisons)) throw new TypeError('stationComparisons ต้องเป็น object ของสถานี');
      for (const [id, comparison] of Object.entries(project.stationComparisons)) {
        if (!ids.has(id)) throw new RangeError(`ไม่พบรหัสสถานี ${id} ในทะเบียน BOQ ต้นฉบับ`);
        try { validateStationComparison(comparison); } catch (error) { errors.push(`${id}: ${error.message}`); }
      }
    }
    if (!errors.length) {
      const active = getActiveScenario(project);
      if (active.soilInputs.mode === 'undrained' && active.soilInputs.undrainedStrengthKpa === null) warnings.push('บริบทที่เลือกยังไม่มี Su: บันทึกโครงการได้ แต่ยังไม่มีผลคำนวณดินแบบ total stress');
      const hasWater = ['waterHighLevel', 'waterLowLevel', 'groundwaterLevel'].some(key => active.context[key] !== null);
      if (hasWater && !active.context.waterReference.trim()) warnings.push('มีระดับน้ำที่กรอก แต่ยังไม่ระบุที่มาและ datum ของระดับน้ำ');
    }
    if (new TextEncoder().encode(JSON.stringify(project)).byteLength > PROJECT_MAX_BYTES) errors.push('ไฟล์โครงการมีขนาดเกิน 1 MiB');
  } catch (error) { errors.push(error.message || 'ข้อมูลโครงการไม่ถูกต้อง'); }
  return { valid: errors.length === 0, errors, warnings };
}

function requireProject(project, source) {
  const validation = validateProject(project, source);
  if (!validation.valid) throw new RangeError(validation.errors.join('; '));
}

export function updateActiveScenario(project, patch, source) {
  requireProject(project, source);
  assertPlainData(patch);
  if (!plain(patch) || Object.keys(patch).some(key => !SCENARIO_KEYS.includes(key))) throw new TypeError('แก้ได้เฉพาะ geometry, beamInputs, soilInputs และ context');
  const active = getActiveScenario(project);
  for (const [key, values] of Object.entries(patch)) {
    if (!plain(values)) throw new TypeError(`${key} ที่แก้ต้องเป็น object`);
    active[key] = { ...active[key], ...values };
  }
  validateScenario(active);
  const updated = clone(project);
  if (isBaselineScenario(active)) delete updated.stationScenarios[updated.selectedStationId];
  else updated.stationScenarios[updated.selectedStationId] = active;
  requireProject(updated, source);
  return updated;
}

export function selectStation(project, stationId, source) {
  requireProject(project, source);
  const updated = { ...clone(project), selectedStationId: stationId };
  requireProject(updated, source);
  return updated;
}

/** Capture accepted inputs only; first capture upgrades v1 without changing its source object. */
export function saveAlternative(project, name, source, options = {}) {
  requireProject(project, source);
  assertPlainData(options);
  if (!plain(options) || Object.keys(options).some(key => !['id', 'createdAt'].includes(key))) {
    throw new TypeError('ตัวเลือกการบันทึกทางเลือกรองรับเฉพาะ id และ createdAt');
  }
  const normalizedName = normalizedAlternativeName(name);
  const comparison = getStationComparison(project);
  if (comparison.alternatives.length >= MAX_STATION_ALTERNATIVES) {
    throw new RangeError(`บันทึกได้ไม่เกิน ${MAX_STATION_ALTERNATIVES} ทางเลือกต่อสถานี กรุณาลบทางเลือกเดิมก่อน`);
  }
  const id = own(options, 'id') ? options.id : globalThis.crypto.randomUUID();
  const createdAt = own(options, 'createdAt') ? options.createdAt : new Date().toISOString();
  validateAlternativeId(id);
  validateAlternativeTimestamp(createdAt);
  if (comparison.alternatives.some(alternative => alternative.id === id)) throw new RangeError('มีทางเลือกรหัสนี้ในสถานีแล้ว');
  comparison.alternatives.push({ id, name: normalizedName, createdAt, scenario: getActiveScenario(project) });
  if (comparison.referenceId === null) comparison.referenceId = id;
  const updated = clone(project);
  if (updated.version === 1) {
    updated.version = PROJECT_VERSION;
    updated.stationComparisons = {};
  }
  updated.stationComparisons[updated.selectedStationId] = comparison;
  requireProject(updated, source);
  return updated;
}

function selectedAlternative(project, id) {
  validateAlternativeId(id);
  const comparison = getStationComparison(project);
  const alternative = comparison.alternatives.find(item => item.id === id);
  if (!alternative) throw new RangeError('ไม่พบทางเลือกนี้ในสถานีที่เลือก');
  return { comparison, alternative };
}

export function removeAlternative(project, id, source) {
  requireProject(project, source);
  const { comparison } = selectedAlternative(project, id);
  comparison.alternatives = comparison.alternatives.filter(alternative => alternative.id !== id);
  if (comparison.referenceId === id) comparison.referenceId = comparison.alternatives[0]?.id ?? null;
  const updated = clone(project);
  if (comparison.alternatives.length) updated.stationComparisons[updated.selectedStationId] = comparison;
  else delete updated.stationComparisons[updated.selectedStationId];
  requireProject(updated, source);
  return updated;
}

export function setComparisonReference(project, id, source) {
  requireProject(project, source);
  const { comparison } = selectedAlternative(project, id);
  comparison.referenceId = id;
  const updated = clone(project);
  updated.stationComparisons[updated.selectedStationId] = comparison;
  requireProject(updated, source);
  return updated;
}

/** Apply a copy to the selected working scenario; the saved alternative remains unchanged. */
export function applyAlternative(project, id, source) {
  requireProject(project, source);
  const { alternative } = selectedAlternative(project, id);
  return updateActiveScenario(project, alternative.scenario, source);
}

export function serializeProject(project, source) {
  requireProject(project, source);
  const text = JSON.stringify(canonicalProject(project), null, 2) + '\n';
  if (new TextEncoder().encode(text).byteLength > PROJECT_MAX_BYTES) throw new RangeError('ไฟล์โครงการมีขนาดเกิน 1 MiB');
  return text;
}

export function parseProject(text, source) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > PROJECT_MAX_BYTES) throw new RangeError('ไฟล์โครงการต้องเป็นข้อความ JSON ขนาดไม่เกิน 1 MiB');
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new SyntaxError('อ่าน JSON โครงการไม่ได้'); }
  assertPlainData(value);
  if (plain(value) && value.schema === 'riverbank.s6006.case') {
    exactKeys(value, ['schema', 'version', 'projectCode', 'inputs'], 'legacy case');
    if (value.version !== 1 || value.projectCode !== 'S6006') throw new TypeError('รองรับไฟล์มิติเดิม S6006 version 1 เท่านั้น');
    const geometry = validateInputs(value.inputs);
    if (!geometry.valid) throw new RangeError('มิติต้องถูกต้องและระดับสันต้องสูงกว่าตีน: ' + geometry.errors.join('; '));
    const project = updateActiveScenario(createProject(source), { geometry: value.inputs }, source);
    return {
      project, migrated: true,
      notices: ['นำเข้าไฟล์มิติเดิมแล้ว: ผูกมิติกับแถวสถานี BOQ แรก ไฟล์เดิมไม่มีค่าคาน ดิน หรือบริบทน้ำ จึงใช้ค่าตัวอย่างที่ระบุเป็นสมมติฐาน และคงระดับน้ำที่ไม่ทราบเป็นช่องว่าง กรุณาบันทึกใหม่เป็นไฟล์โครงการรวม'],
    };
  }
  if (plain(value) && value.schema === 'riverbank.s6006.engineering') {
    exactKeys(value, ['schema', 'version', 'calculationRevision', 'beamInputs', 'soilInputs', 'beamResults', 'soilResults', 'scope'], 'legacy engineering');
    if (value.version !== 1 || value.calculationRevision !== CALCULATION_REVISION) throw new TypeError('รองรับไฟล์ค่าคำนวณเดิม S6006 version 1 / R2 เท่านั้น');
    exactKeys(value.beamInputs, Object.keys(DEFAULT_BEAM_INPUTS), 'legacy beamInputs');
    exactKeys(value.soilInputs, Object.keys(DEFAULT_SOIL_INPUTS), 'legacy soilInputs');
    if (!plain(value.beamResults) || (value.soilResults !== null && !plain(value.soilResults))
      || typeof value.scope !== 'string' || value.scope.length > 5000) throw new TypeError('โครงสร้างไฟล์ค่าคำนวณเดิมไม่ถูกต้อง');
    // Cached results and their claimed statuses are never copied or trusted.
    const project = updateActiveScenario(createProject(source), {
      geometry: { slopeH: value.soilInputs.slopeH },
      beamInputs: value.beamInputs,
      soilInputs: Object.fromEntries(SOIL_KEYS.map(key => [key, value.soilInputs[key]])),
    }, source);
    return {
      project, migrated: true,
      notices: ['นำเข้าค่าคานและดินจากไฟล์ R2 เดิมแล้ว โดยคำนวณผลใหม่และไม่นำผลลัพธ์ที่บันทึกมาใช้ ตั้งความลาดร่วมตามค่าดินเดิม ผูกกับแถวสถานี BOQ แรก ส่วนมิติอื่นใช้ค่าตัวอย่าง SD-02 และบริบทน้ำยังว่าง เพราะไฟล์เดิมไม่มีข้อมูลเหล่านี้'],
    };
  }
  requireProject(value, source);
  return { project: canonicalProject(value), migrated: false, notices: [] };
}
