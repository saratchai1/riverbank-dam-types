import {
  validateProject, projectRevision, scenarioRevision, stationCatalog, getScenario,
  createDefaultScenario, MAX_STATION_ALTERNATIVES, getProjectInvestigations, replaceCurrentInvestigations,
} from './project.js';
import {
  INVESTIGATION_REVISION, INVESTIGATION_KINDS, INVESTIGATION_METADATA_FIELDS,
  INVESTIGATION_VALUE_FIELDS, INVESTIGATION_METADATA_DEFAULTS,
  assertInvestigationData, requireInvestigationKind, validateInvestigationMetadata,
  validateInvestigationTime,
} from './investigation-schema.js';

export {
  INVESTIGATION_REVISION, INVESTIGATION_KINDS, INVESTIGATION_METADATA_FIELDS,
  INVESTIGATION_VALUE_FIELDS, DEFAULT_SOIL_INVESTIGATION_METADATA,
  DEFAULT_WATER_INVESTIGATION_METADATA,
} from './investigation-schema.js';
export const INVESTIGATION_FIELDS = INVESTIGATION_METADATA_FIELDS;
export const INPUT_FIELDS = INVESTIGATION_VALUE_FIELDS;

export const INVESTIGATION_LIMITATIONS = Object.freeze([
  'การบันทึกเอกสารและชุดค่าไม่ได้ยืนยันว่าหลุมเจาะ ตัวอย่าง วิธีทดสอบ หรือ datum ใช้แทนสถานีนี้ได้ ต้องตรวจการเชื่อมโยงโดยวิศวกร',
  'ไม่สร้างชั้นดินหรือแปลงค่าจากขีดเป็นศูนย์ ไม่แปลง c ในตารางเดิมเป็น c′ หรือ Su โดยอัตโนมัติ',
  'ระดับน้ำเป็นบริบทที่บันทึกไว้ ยังไม่ได้แปลงเป็นแรงดันน้ำรูพรุนหรือผลน้ำลดฉับพลัน และไม่เปลี่ยนสมการ S6006-R2',
  'สถานะตรงกับชุดที่บันทึกหมายถึงค่าที่เกี่ยวข้องและข้อความที่มาตรงกันเท่านั้น ไม่ใช่การรับรองผลทดสอบ การวิเคราะห์ หรือความปลอดภัยของโครงการ',
]);

const clone = value => JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const exactEqual = (left, right) => left === right;
const missing = value => value === null || (typeof value === 'string' && !value.trim());

function requireProject(project, source) {
  const validation = validateProject(project, source);
  if (!validation.valid) throw new RangeError(validation.errors.join('; '));
}

function captureValues(scenario, kind) {
  return Object.fromEntries(INVESTIGATION_VALUE_FIELDS[kind].map(item => {
    const [group, key] = item.field.split('.');
    return [item.field, scenario[group][key]];
  }));
}

export function getStationInvestigations(project, stationId, scenarioId = 'current') {
  return getProjectInvestigations(project, stationId, scenarioId);
}

/** Saving metadata does not refresh an earlier binding or modify engineering inputs. */
export function saveInvestigationMetadata(project, kind, metadata, source) {
  requireProject(project, source);
  requireInvestigationKind(kind);
  validateInvestigationMetadata(kind, metadata);
  const group = getStationInvestigations(project);
  group[kind] = { metadata: clone(metadata), binding: group[kind]?.binding ?? null };
  return replaceCurrentInvestigations(project, group, source);
}

/** Explicitly bind accepted relevant values and metadata to the selected station. */
export function captureInvestigation(project, kind, source, options = {}) {
  requireProject(project, source);
  requireInvestigationKind(kind);
  assertInvestigationData(options);
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => key !== 'createdAt')) throw new TypeError('ตัวเลือกการจับคู่หลักฐานรองรับเฉพาะ createdAt');
  const recordedAt = own(options, 'createdAt') ? options.createdAt : new Date().toISOString();
  validateInvestigationTime(recordedAt);
  const group = getStationInvestigations(project);
  const metadata = group[kind]?.metadata ?? INVESTIGATION_METADATA_DEFAULTS[kind];
  const scenario = getScenario(project, project.selectedStationId);
  group[kind] = {
    metadata: clone(metadata),
    binding: {
      recordedAt, stationId: project.selectedStationId,
      values: captureValues(scenario, kind), metadata: clone(metadata),
    },
  };
  return replaceCurrentInvestigations(project, group, source);
}

export function removeInvestigation(project, kind, source) {
  requireProject(project, source);
  requireInvestigationKind(kind);
  const group = getStationInvestigations(project);
  if (group[kind] === null) return clone(project);
  group[kind] = null;
  return replaceCurrentInvestigations(project, group, source);
}

function requiredInputs(kind, values) {
  if (kind === 'water') return ['context.waterHighLevel', 'context.waterLowLevel', 'context.groundwaterLevel', 'context.waterReference'];
  return [
    'geometry.slopeH', 'soilInputs.mode', 'soilInputs.verticalDepthM',
    'soilInputs.unitWeightKnM3', 'soilInputs.saturatedUnitWeightKnM3', 'soilInputs.waterUnitWeightKnM3',
    ...(values['soilInputs.mode'] === 'undrained' ? ['soilInputs.undrainedStrengthKpa'] : ['soilInputs.frictionAngleDeg', 'soilInputs.effectiveCohesionKpa']),
    'context.boreholeReference',
  ];
}

function buildGroup(kind, record, scenario) {
  const metadata = clone(record?.metadata ?? INVESTIGATION_METADATA_DEFAULTS[kind]);
  const binding = record?.binding ? clone(record.binding) : null;
  const currentValues = captureValues(scenario, kind), capturedValues = binding ? clone(binding.values) : null;
  const missingMetadata = INVESTIGATION_METADATA_FIELDS[kind]
    .filter(item => item.required && missing(metadata[item.field]))
    .map(item => ({ field: item.field, label: item.label, reason: 'ยังไม่มีข้อมูลประกอบช่องนี้' }));
  const required = new Set(requiredInputs(kind, currentValues));
  const missingInputs = INVESTIGATION_VALUE_FIELDS[kind]
    .filter(item => required.has(item.field) && missing(currentValues[item.field]))
    .map(item => ({ field: item.field, label: item.label, reason: 'ค่าหรือเอกสารอ้างอิงที่ใช้กับกรณีนี้ยังไม่ครบ' }));
  const inputChanges = binding ? INVESTIGATION_VALUE_FIELDS[kind]
    .filter(item => !exactEqual(binding.values[item.field], currentValues[item.field]))
    .map(item => ({ field: item.field, label: item.label, unit: item.unit || '', captured: binding.values[item.field], current: currentValues[item.field] })) : [];
  const metadataChanges = binding ? INVESTIGATION_METADATA_FIELDS[kind]
    .filter(item => !exactEqual(binding.metadata[item.field], metadata[item.field]))
    .map(item => ({ field: item.field, label: item.label, unit: item.unit || '', captured: binding.metadata[item.field], current: metadata[item.field] })) : [];
  const state = record === null ? 'missing'
    : inputChanges.length || metadataChanges.length ? 'stale'
      : !binding || missingMetadata.length || missingInputs.length ? 'incomplete' : 'current';
  return {
    id: kind, kind, state, hasRecord: record !== null,
    metadata, binding, missingMetadata, missingInputs,
    inputChanges, metadataChanges, capturedValues, currentValues,
    limitations: [...INVESTIGATION_LIMITATIONS],
  };
}

function buildReviews(project, source, scope, singleSelection = null) {
  requireProject(project, source);
  // Resolve the default station only after validating project descriptors.
  const entries = singleSelection ? [{
    stationId: singleSelection.stationId === undefined ? project.selectedStationId : singleSelection.stationId,
    scenarioId: singleSelection.scenarioId,
  }] : scope;
  assertInvestigationData(entries);
  const catalog = stationCatalog(source), byStation = new Map(catalog.map(station => [station.id, station]));
  if (!Array.isArray(entries) || !entries.length || entries.length > catalog.length * (MAX_STATION_ALTERNATIVES + 1)
    || Object.keys(entries).length !== entries.length
    || Object.keys(entries).some((key, index) => key !== String(index))) throw new TypeError('ขอบเขตหลักฐานต้องเป็นรายการชุดข้อมูลต่อเนื่องและไม่ว่าง');
  const seen = new Set();
  const selected = entries.map(entry => {
    if (!entry || Array.isArray(entry) || typeof entry !== 'object'
      || Object.keys(entry).length !== 2 || !own(entry, 'stationId') || !own(entry, 'scenarioId')
      || typeof entry.stationId !== 'string' || typeof entry.scenarioId !== 'string') throw new TypeError('ขอบเขตหลักฐานต้องระบุเฉพาะ stationId และ scenarioId');
    const station = byStation.get(entry.stationId);
    if (!station) throw new RangeError('สถานีที่ตรวจหลักฐานไม่มีในทะเบียน BOQ');
    const key = entry.stationId + '/' + entry.scenarioId;
    if (seen.has(key)) throw new TypeError('ขอบเขตหลักฐานมีชุดข้อมูลซ้ำ');
    seen.add(key);
    // These are internal reads of the one fully validated project. Do not call
    // public getters here: each intentionally validates the complete graph again.
    const alternative = entry.scenarioId === 'current' ? null
      : project.stationComparisons?.[entry.stationId]?.alternatives.find(item => item.id === entry.scenarioId);
    if (entry.scenarioId !== 'current' && !alternative) throw new RangeError('ไม่พบทางเลือกนี้ในสถานีที่เลือก');
    const scenario = alternative ? alternative.scenario : project.stationScenarios[entry.stationId] ?? createDefaultScenario();
    const investigation = project.version >= 3 ? project.stationInvestigations[entry.stationId] : null;
    const group = entry.scenarioId === 'current' ? investigation?.current : investigation?.alternatives[entry.scenarioId];
    return { station, scenarioId: entry.scenarioId, scenario,
      scenarioName: alternative ? alternative.name : 'ค่าที่กำลังแก้', kind: alternative ? 'saved' : 'current',
      investigations: group ?? { soil: null, water: null } };
  });
  const revision = projectRevision(project);
  return selected.map(item => ({
    investigationRevision: INVESTIGATION_REVISION,
    station: clone(item.station), scenarioId: item.scenarioId, scenarioName: item.scenarioName, kind: item.kind,
    projectRevision: revision, scenarioRevision: scenarioRevision(item.scenario),
    groups: INVESTIGATION_KINDS.map(kind => buildGroup(kind, item.investigations[kind], item.scenario)),
    limitations: [...INVESTIGATION_LIMITATIONS],
  }));
}

/** Validate a complete scoped batch once, preserving caller order and per-entry identity. */
export function buildInvestigationReviews(project, source, entries) {
  return buildReviews(project, source, entries);
}

/** Recompute comparison status through the same validated batch implementation. */
export function buildInvestigationReview(project, source, stationId, scenarioId = 'current') {
  return buildReviews(project, source, null, { stationId, scenarioId })[0];
}

function csvCell(value) {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/** Long-form CSV keeps every input and metadata field, including blank values. */
export function investigationCSV(record) {
  assertInvestigationData(record);
  if (!record || record.investigationRevision !== INVESTIGATION_REVISION || !Array.isArray(record.groups)
    || record.groups.length !== 2 || record.groups.some((group, index) => group.kind !== INVESTIGATION_KINDS[index])) throw new TypeError('ต้องใช้ทะเบียนหลักฐานที่สร้างจากโครงการ');
  const headers = ['project_revision', 'scenario_revision', 'investigation_revision', 'station_id', 'reach', 'station_m', 'scenario_id', 'scenario_name', 'scenario_kind', 'group', 'state', 'has_record', 'recorded_at', 'binding_station_id', 'field_group', 'field', 'label', 'unit', 'captured_value', 'current_value', 'changed', 'missing', 'limitations'];
  const rows = [headers];
  for (const group of record.groups) {
    for (const [section, fields] of [['input', INVESTIGATION_VALUE_FIELDS[group.kind]], ['metadata', INVESTIGATION_METADATA_FIELDS[group.kind]]]) {
      const current = section === 'input' ? group.currentValues : group.metadata;
      const captured = section === 'input' ? group.capturedValues : group.binding?.metadata;
      const changes = section === 'input' ? group.inputChanges : group.metadataChanges;
      const absent = section === 'input' ? group.missingInputs : group.missingMetadata;
      for (const item of fields) rows.push([
        record.projectRevision, record.scenarioRevision, record.investigationRevision,
        record.station.id, record.station.reach, record.station.station,
        record.scenarioId, record.scenarioName, record.kind, group.kind, group.state, group.hasRecord,
        group.binding?.recordedAt ?? null, group.binding?.stationId ?? null,
        section, item.field, item.label, item.unit || '', captured?.[item.field] ?? null,
        current[item.field], changes.some(change => change.field === item.field), absent.some(itemMissing => itemMissing.field === item.field),
        record.limitations.join(' | '),
      ]);
    }
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
