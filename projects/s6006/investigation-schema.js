import { DEFAULT_INPUTS, validateInputs } from './engine.js';
import { DEFAULT_SOIL_INPUTS, calculateSoil } from './engineering.js';

export const INVESTIGATION_REVISION = 'S6006-INVESTIGATIONS-1';
export const INVESTIGATION_KINDS = Object.freeze(['soil', 'water']);

const field = (name, label, type = 'text', required = true, extra = {}) => Object.freeze({ field: name, label, type, required, ...extra });
export const INVESTIGATION_METADATA_FIELDS = Object.freeze({
  soil: Object.freeze([
    field('boreholeId', 'รหัสหลุมเจาะ / ตัวอย่าง', 'text', true, { maxLength: 128 }),
    field('documentRevision', 'รุ่นเอกสาร', 'text', false, { maxLength: 200 }),
    field('locator', 'หน้า / ตาราง / เลขตัวอย่าง', 'text', true, { maxLength: 500 }),
    field('sampleDepthFromM', 'ความลึกช่วงตัวอย่างบน', 'number', true, { unit: 'm', min: 0, max: 10000 }),
    field('sampleDepthToM', 'ความลึกช่วงตัวอย่างล่าง', 'number', true, { unit: 'm', min: 0, max: 10000 }),
    field('depthReference', 'จุดอ้างอิงความลึก', 'text', true, { maxLength: 500 }),
    field('testMethod', 'วิธีทดสอบ / วิธีประเมิน', 'text', true, { maxLength: 1000 }),
    field('parameterInterpretation', 'การตีความกำลังดินและสภาพระบายน้ำ', 'text', true, { maxLength: 1000 }),
    field('applicabilityNote', 'เหตุผลที่ใช้กับสถานีและวัสดุนี้', 'text', true, { maxLength: 2000 }),
    field('notes', 'หมายเหตุ', 'text', false, { maxLength: 2000 }),
  ]),
  water: Object.freeze([
    field('documentRevision', 'รุ่นเอกสาร', 'text', false, { maxLength: 200 }),
    field('locator', 'หน้า / ตาราง / รายการตรวจวัด', 'text', true, { maxLength: 500 }),
    field('datum', 'Datum / หมุดหรือระดับอ้างอิง', 'text', true, { maxLength: 500 }),
    field('observationText', 'วัน ช่วงเวลา หรือกรณีระดับน้ำ', 'text', true, { maxLength: 1000 }),
    field('applicabilityNote', 'เหตุผลที่ใช้ระดับน้ำกับสถานีนี้', 'text', true, { maxLength: 2000 }),
    field('notes', 'หมายเหตุ', 'text', false, { maxLength: 2000 }),
  ]),
});

const defaults = kind => Object.freeze(Object.fromEntries(INVESTIGATION_METADATA_FIELDS[kind].map(item => [item.field, item.type === 'number' ? null : ''])));
export const DEFAULT_SOIL_INVESTIGATION_METADATA = defaults('soil');
export const DEFAULT_WATER_INVESTIGATION_METADATA = defaults('water');
export const INVESTIGATION_METADATA_DEFAULTS = Object.freeze({ soil: DEFAULT_SOIL_INVESTIGATION_METADATA, water: DEFAULT_WATER_INVESTIGATION_METADATA });

const value = (name, label, unit = '', type = 'number') => Object.freeze({ field: name, label, unit, type });
export const INVESTIGATION_VALUE_FIELDS = Object.freeze({
  soil: Object.freeze([
    value('geometry.slopeH', 'ความลาด H:1V', 'H:1V'),
    value('soilInputs.mode', 'ฐานกำลังดิน', '', 'text'),
    value('soilInputs.verticalDepthM', 'ความลึกแนวดิ่งของกลไกสมมติ z', 'm'),
    value('soilInputs.unitWeightKnM3', 'น้ำหนักจำเพาะกรณีแห้ง γ', 'kN/m³'),
    value('soilInputs.saturatedUnitWeightKnM3', 'น้ำหนักจำเพาะอิ่มตัว γsat', 'kN/m³'),
    value('soilInputs.waterUnitWeightKnM3', 'น้ำหนักจำเพาะน้ำ γw', 'kN/m³'),
    value('soilInputs.frictionAngleDeg', 'มุมเสียดทานประสิทธิผล φ′', '°'),
    value('soilInputs.effectiveCohesionKpa', 'ความเชื่อมแน่นประสิทธิผล c′', 'kPa'),
    value('soilInputs.undrainedStrengthKpa', 'กำลังเฉือนไม่ระบายน้ำ Su', 'kPa'),
    value('context.boreholeReference', 'เอกสาร / หลุมเจาะอ้างอิง', '', 'text'),
    value('context.sourceNote', 'หมายเหตุที่มาของสถานการณ์', '', 'text'),
  ]),
  water: Object.freeze([
    value('context.waterHighLevel', 'ระดับน้ำสูง', 'm'),
    value('context.waterLowLevel', 'ระดับน้ำต่ำ', 'm'),
    value('context.groundwaterLevel', 'ระดับน้ำใต้ดิน', 'm'),
    value('context.waterReference', 'เอกสาร / แหล่งระดับน้ำอ้างอิง', '', 'text'),
    value('context.sourceNote', 'หมายเหตุที่มาของสถานการณ์', '', 'text'),
  ]),
});

const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const STATION_ID = /^r[1-9]\d*-row[1-9]\d*$/;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const finite = number => typeof number === 'number' && Number.isFinite(number);
const plain = object => object !== null && typeof object === 'object' && !Array.isArray(object)
  && [Object.prototype, null].includes(Object.getPrototypeOf(object));

/** Validate descriptors before reading caller-provided data. */
export function assertInvestigationData(root) {
  const seen = new WeakSet(), stack = [{ value: root, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { value: item, depth } = stack.pop();
    if (++count > 50000 || depth > 16) throw new RangeError('ข้อมูลหลักฐานมีจำนวนรายการหรือความลึกเกินขอบเขต');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number') {
      if (!finite(item)) throw new TypeError('ข้อมูลหลักฐานต้องไม่มี NaN หรือ Infinity');
      continue;
    }
    if (typeof item !== 'object' || (!Array.isArray(item) && !plain(item))) throw new TypeError('ข้อมูลหลักฐานต้องเป็น JSON ปกติ');
    if (seen.has(item)) throw new TypeError('ข้อมูลหลักฐานต้องไม่มีวงจรหรือ object อ้างอิงร่วม');
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      if (typeof key !== 'string' || RESERVED.has(key)) throw new TypeError('ชื่อข้อมูลหลักฐานเป็นชื่อสงวนหรือไม่รองรับ');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!own(descriptor, 'value') || !descriptor.enumerable) throw new TypeError('ข้อมูลหลักฐานต้องไม่มี getter/setter หรือข้อมูลซ่อน');
      stack.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
}

function exactKeys(object, keys, label) {
  if (!plain(object)) throw new TypeError(`${label} ต้องเป็น object ปกติ`);
  if (Object.keys(object).length !== keys.length || keys.some(key => !own(object, key))) throw new TypeError(`${label} มีชื่อข้อมูลไม่ครบหรือมีชื่อข้อมูลที่ไม่รองรับ`);
}

export function requireInvestigationKind(kind) {
  if (!INVESTIGATION_KINDS.includes(kind)) throw new TypeError('ชนิดหลักฐานต้องเป็น soil หรือ water');
}

export function validateInvestigationMetadata(kind, metadata) {
  requireInvestigationKind(kind);
  assertInvestigationData(metadata);
  exactKeys(metadata, INVESTIGATION_METADATA_FIELDS[kind].map(item => item.field), 'metadata');
  for (const item of INVESTIGATION_METADATA_FIELDS[kind]) {
    const current = metadata[item.field];
    if (item.type === 'number') {
      if (current !== null && (!finite(current) || current < item.min || current > item.max)) throw new RangeError(`${item.label}: ต้องเป็นตัวเลข ${item.min}–${item.max} หรือเว้นว่าง`);
    } else if (typeof current !== 'string' || current.length > item.maxLength) throw new TypeError(`${item.label}: ต้องเป็นข้อความไม่เกิน ${item.maxLength} ตัวอักษร`);
  }
  if (kind === 'soil' && metadata.sampleDepthFromM !== null && metadata.sampleDepthToM !== null
    && metadata.sampleDepthToM <= metadata.sampleDepthFromM) throw new RangeError('ความลึกช่วงตัวอย่างล่างต้องมากกว่าความลึกช่วงตัวอย่างบน');
  return metadata;
}

export function validateInvestigationTime(time) {
  if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(time)) throw new TypeError('เวลาบันทึกหลักฐานต้องเป็น ISO UTC');
  const normalized = time.includes('.') ? time : time.replace(/Z$/, '.000Z');
  if (!Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== normalized) throw new TypeError('เวลาบันทึกหลักฐานไม่ถูกต้อง');
}

export function validateInvestigationValues(kind, values) {
  requireInvestigationKind(kind);
  assertInvestigationData(values);
  exactKeys(values, INVESTIGATION_VALUE_FIELDS[kind].map(item => item.field), 'binding.values');
  for (const item of INVESTIGATION_VALUE_FIELDS[kind]) {
    if (item.field.startsWith('context.') && item.type === 'text') {
      if (typeof values[item.field] !== 'string' || values[item.field].length > 2000) throw new TypeError(`${item.label}: ต้องเป็นข้อความไม่เกิน 2000 ตัวอักษร`);
    }
  }
  if (kind === 'soil') {
    const soil = Object.fromEntries(Object.keys(DEFAULT_SOIL_INPUTS).map(key => [key, values[key === 'slopeH' ? 'geometry.slopeH' : `soilInputs.${key}`]]));
    const geometry = validateInputs({ ...DEFAULT_INPUTS, slopeH: soil.slopeH });
    if (!geometry.valid) throw new RangeError('ความลาดที่เก็บในหลักฐานไม่ถูกต้อง');
    // Missing Su is a valid draft, matching the project's existing validation.
    // The probe validates only the remaining numerical domain; no result is stored.
    calculateSoil(soil.mode === 'undrained' && soil.undrainedStrengthKpa === null ? { ...soil, undrainedStrengthKpa: 1 } : soil);
  } else {
    for (const key of ['waterHighLevel', 'waterLowLevel', 'groundwaterLevel']) {
      const current = values[`context.${key}`];
      if (current !== null && (!finite(current) || Math.abs(current) > 100000)) throw new RangeError('ระดับน้ำที่เก็บต้องเป็นตัวเลขจำกัดหรือ null');
    }
    if (values['context.waterHighLevel'] !== null && values['context.waterLowLevel'] !== null
      && values['context.waterHighLevel'] < values['context.waterLowLevel']) throw new RangeError('ระดับน้ำสูงที่เก็บต้องไม่น้อยกว่าระดับน้ำต่ำ');
  }
  return values;
}

export function validateInvestigationRecord(kind, record, stationId) {
  requireInvestigationKind(kind);
  assertInvestigationData(record);
  exactKeys(record, ['metadata', 'binding'], 'investigation');
  validateInvestigationMetadata(kind, record.metadata);
  if (record.binding !== null) {
    exactKeys(record.binding, ['recordedAt', 'stationId', 'values', 'metadata'], 'binding');
    validateInvestigationTime(record.binding.recordedAt);
    if (typeof record.binding.stationId !== 'string' || !STATION_ID.test(record.binding.stationId)
      || (stationId !== undefined && record.binding.stationId !== stationId)) throw new TypeError('หลักฐานต้องผูกกับรหัสสถานีที่บันทึกไว้');
    validateInvestigationValues(kind, record.binding.values);
    validateInvestigationMetadata(kind, record.binding.metadata);
  }
  return record;
}

export function emptyInvestigationGroup() { return { soil: null, water: null }; }

export function validateInvestigationGroup(group, stationId) {
  assertInvestigationData(group);
  exactKeys(group, INVESTIGATION_KINDS, 'investigation group');
  for (const kind of INVESTIGATION_KINDS) if (group[kind] !== null) validateInvestigationRecord(kind, group[kind], stationId);
}

export function validateStationInvestigation(entry, stationId, alternativeIds = []) {
  assertInvestigationData(entry);
  exactKeys(entry, ['current', 'alternatives'], 'station investigation');
  validateInvestigationGroup(entry.current, stationId);
  if (!plain(entry.alternatives)) throw new TypeError('หลักฐานทางเลือกต้องเป็น object');
  for (const [id, group] of Object.entries(entry.alternatives)) {
    if (!alternativeIds.includes(id)) throw new TypeError('หลักฐานอ้างถึงทางเลือกที่ไม่มีในสถานี');
    validateInvestigationGroup(group, stationId);
  }
}

export const hasInvestigationGroup = group => group.soil !== null || group.water !== null;
