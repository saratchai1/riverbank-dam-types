import { PROJECT_MAX_BYTES, parseProject, serializeProject } from './project.js';
import { buildComparison } from './comparison.js';

export const COMPARISON_SNAPSHOT_PREFIX = 'riverbank.s6006.comparison-snapshot.v1.';
export const COMPARISON_SNAPSHOT_MAX_BYTES = PROJECT_MAX_BYTES * 2;

const SNAPSHOT_SCHEMA = 'riverbank.s6006.comparison-snapshot';
const SNAPSHOT_ID = /^[a-zA-Z0-9-]{8,80}$/;
const ENVELOPE_KEYS = 'createdAt,entries,id,project,referenceId,revision,schema,selectedStationId,station,version';
const byteLength = value => new TextEncoder().encode(value).byteLength;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === keys;
const validTime = value => typeof value === 'string' && value.length === 24
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const entryIdentity = record => record.entries.map(({ id, revision }) => ({ id, revision }));
const validId = value => typeof value === 'string' && value === value.trim() && SNAPSHOT_ID.test(value);

function requireSavedReference(record) {
  if (!record.entries.some(entry => entry.kind === 'saved' && entry.id === record.metadata.referenceId)) {
    throw new Error('ต้องบันทึกอย่างน้อยหนึ่งทางเลือกและมีฐานเทียบก่อนสร้างรายงานเปรียบเทียบ');
  }
}

/** Store validated inputs only; results are recalculated from the same inputs on reopening. */
export function saveComparisonSnapshot(project, source, storage, options = {}) {
  const validated = JSON.parse(serializeProject(project, source));
  const record = buildComparison(validated, source);
  requireSavedReference(record);
  const id = options.id ?? globalThis.crypto.randomUUID();
  if (!validId(id)) throw new Error('รหัสสำเนารายงานเปรียบเทียบไม่ถูกต้อง');
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (!validTime(createdAt)) throw new Error('เวลาสร้างสำเนารายงานเปรียบเทียบต้องเป็น ISO UTC ที่ถูกต้อง');
  const revision = record.metadata.projectRevision;
  const snapshot = {
    schema: SNAPSHOT_SCHEMA, version: 1, id, createdAt, revision,
    selectedStationId: record.metadata.station.id, station: record.metadata.station,
    referenceId: record.metadata.referenceId,
    entries: entryIdentity(record), project: validated,
  };
  const text = JSON.stringify(snapshot);
  if (byteLength(text) > COMPARISON_SNAPSHOT_MAX_BYTES) throw new Error('สำเนารายงานเปรียบเทียบมีขนาดเกินขอบเขตที่รองรับ');
  const key = COMPARISON_SNAPSHOT_PREFIX + id;
  if (storage.getItem(key) !== null) throw new Error('มีสำเนารายงานเปรียบเทียบรหัสนี้แล้ว กรุณาสร้างรหัสใหม่');
  storage.setItem(key, text);
  return { url: 'comparison-report.html?snapshot=' + encodeURIComponent(id), revision, createdAt };
}

/** Comparison printing always requires its exact saved snapshot. There is no default report. */
export function loadComparisonProject({ search, storage, source }) {
  const ids = new URLSearchParams(search).getAll('snapshot');
  if (ids.length !== 1 || !validId(ids[0])) {
    throw new Error('ต้องเปิดรายงานเปรียบเทียบจากลิงก์ snapshot ที่ถูกต้อง กรุณากลับไปสร้างรายงานในโครงการ');
  }
  const text = storage.getItem(COMPARISON_SNAPSHOT_PREFIX + ids[0]);
  if (text === null) throw new Error('ไม่พบสำเนารายงานเปรียบเทียบนี้ในเบราว์เซอร์ กรุณาเปิด JSON โครงการแล้วสร้างรายงานอีกครั้ง');
  if (typeof text !== 'string' || byteLength(text) > COMPARISON_SNAPSHOT_MAX_BYTES) throw new Error('สำเนารายงานเปรียบเทียบมีขนาดเกินขอบเขตที่รองรับ');
  let snapshot;
  try { snapshot = JSON.parse(text); } catch { throw new Error('สำเนารายงานเปรียบเทียบเสียหาย กรุณาสร้างรายงานจากโครงการอีกครั้ง'); }
  if (!exactKeys(snapshot, ENVELOPE_KEYS) || snapshot.schema !== SNAPSHOT_SCHEMA || snapshot.version !== 1
    || snapshot.id !== ids[0] || !validTime(snapshot.createdAt)
    || typeof snapshot.revision !== 'string' || typeof snapshot.selectedStationId !== 'string'
    || !exactKeys(snapshot.station, 'effectiveLength,id,reach,sourceRow,sourceSheet,station')
    || (snapshot.referenceId !== null && typeof snapshot.referenceId !== 'string')
    || !Array.isArray(snapshot.entries) || snapshot.entries.length < 1 || snapshot.entries.length > 4
    || snapshot.entries.some(entry => !exactKeys(entry, 'id,revision')
      || typeof entry.id !== 'string' || typeof entry.revision !== 'string')) {
    throw new Error('รูปแบบสำเนารายงานเปรียบเทียบไม่ถูกต้อง');
  }
  const parsed = parseProject(JSON.stringify(snapshot.project), source);
  const record = buildComparison(parsed.project, source);
  requireSavedReference(record);
  if (parsed.migrated || record.metadata.station.id !== snapshot.selectedStationId
    || record.metadata.projectRevision !== snapshot.revision
    || Object.keys(record.metadata.station).some(key => record.metadata.station[key] !== snapshot.station[key])
    || record.metadata.referenceId !== snapshot.referenceId
    || JSON.stringify(entryIdentity(record)) !== JSON.stringify(snapshot.entries)) {
    throw new Error('รุ่นข้อมูล สถานี หรือรายการอ้างอิงในสำเนารายงานเปรียบเทียบไม่ตรงกัน กรุณาสร้างรายงานใหม่');
  }
  return { project: parsed.project, createdAt: snapshot.createdAt };
}
