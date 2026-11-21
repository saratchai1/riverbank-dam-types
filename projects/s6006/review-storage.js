import { PROJECT_MAX_BYTES, parseProject, serializeProject } from './project.js';
import { REVIEW_REVISION, buildReview, selectReview } from './review.js';

export const REVIEW_SNAPSHOT_PREFIX = 'riverbank.s6006.review-snapshot.v1.';
export const REVIEW_SNAPSHOT_MAX_BYTES = PROJECT_MAX_BYTES * 2;

const SCHEMA = 'riverbank.s6006.review-snapshot';
const ID_PATTERN = /^[a-zA-Z0-9-]{8,80}$/;
const ENVELOPE_KEYS = 'createdAt,entries,id,identity,project,reviewRevision,revision,schema,scope,selectedStationId,selection,stations,version';
const bytes = value => new TextEncoder().encode(value).byteLength;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === keys;
const validId = value => typeof value === 'string' && value === value.trim() && ID_PATTERN.test(value);
const validTime = value => typeof value === 'string' && value.length === 24
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const identities = selected => selected.entries.map(entry => ({ key: entry.key, scenarioRevision: entry.scenarioRevision }));
const scopeCounts = selected => ({ eligibleCount: selected.eligibleCount, includedCount: selected.includedCount, excludedCount: selected.excludedCount });

// Detect accidental changes to scope, time, identity and input data as well as the
// existing project/scenario revisions. This is not an authentication signature.
function envelopeIdentity(snapshot) {
  const content = JSON.stringify([
    snapshot.schema, snapshot.version, snapshot.id, snapshot.createdAt, snapshot.revision,
    snapshot.reviewRevision, snapshot.selectedStationId, snapshot.selection, snapshot.scope,
    snapshot.entries, snapshot.stations, snapshot.project,
  ]);
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (const byte of new TextEncoder().encode(content)) {
    first = Math.imul(first ^ byte, 0x01000193) >>> 0;
    second = Math.imul(second ^ byte, 0x85ebca6b) >>> 0;
  }
  return 's6006r-' + first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0');
}

function nonempty(selected) {
  if (!selected.entries.length) throw new Error('ไม่มีชุดข้อมูลในขอบเขตที่เลือกสำหรับรายงานตรวจงาน');
}

/** Persist accepted inputs and exact review scope; computed findings are never trusted from storage. */
export function saveReviewSnapshot(project, source, storage, selection, options = {}) {
  const validated = JSON.parse(serializeProject(project, source));
  const record = buildReview(validated, source);
  const selected = selectReview(record, selection);
  nonempty(selected);
  const id = options.id ?? globalThis.crypto.randomUUID();
  if (!validId(id)) throw new Error('รหัสสำเนารายงานตรวจงานไม่ถูกต้อง');
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (!validTime(createdAt)) throw new Error('เวลาสร้างสำเนารายงานตรวจงานต้องเป็น ISO UTC ที่ถูกต้อง');
  const snapshot = {
    schema: SCHEMA, version: 1, id, createdAt, revision: record.metadata.projectRevision,
    reviewRevision: REVIEW_REVISION, selectedStationId: validated.selectedStationId,
    selection: { ...selected.selection }, scope: scopeCounts(selected),
    entries: identities(selected), stations: record.stations, project: validated,
  };
  snapshot.identity = envelopeIdentity(snapshot);
  const text = JSON.stringify(snapshot);
  if (bytes(text) > REVIEW_SNAPSHOT_MAX_BYTES) throw new Error('สำเนารายงานตรวจงานมีขนาดเกินขอบเขตที่รองรับ');
  const key = REVIEW_SNAPSHOT_PREFIX + id;
  if (storage.getItem(key) !== null) throw new Error('มีสำเนารายงานตรวจงานรหัสนี้แล้ว กรุณาสร้างรหัสใหม่');
  storage.setItem(key, text);
  return { url: 'review-report.html?snapshot=' + encodeURIComponent(id), revision: snapshot.revision, createdAt };
}

/** Missing, altered or incompatible snapshots never fall back to working/default inputs. */
export function loadReviewProject({ search, storage, source }) {
  const ids = new URLSearchParams(search).getAll('snapshot');
  if (ids.length !== 1 || !validId(ids[0])) throw new Error('ต้องเปิดรายงานตรวจงานจากลิงก์ snapshot ที่ถูกต้อง');
  const text = storage.getItem(REVIEW_SNAPSHOT_PREFIX + ids[0]);
  if (text === null) throw new Error('ไม่พบสำเนารายงานตรวจงานนี้ในเบราว์เซอร์ กรุณาเปิด JSON โครงการแล้วสร้างรายงานอีกครั้ง');
  if (typeof text !== 'string' || bytes(text) > REVIEW_SNAPSHOT_MAX_BYTES) throw new Error('สำเนารายงานตรวจงานมีขนาดเกินขอบเขตที่รองรับ');
  let snapshot;
  try { snapshot = JSON.parse(text); } catch { throw new Error('สำเนารายงานตรวจงานเสียหาย กรุณาสร้างรายงานอีกครั้ง'); }
  if (!exactKeys(snapshot, ENVELOPE_KEYS) || snapshot.schema !== SCHEMA || snapshot.version !== 1
    || snapshot.id !== ids[0] || !validTime(snapshot.createdAt)
    || snapshot.reviewRevision !== REVIEW_REVISION || typeof snapshot.revision !== 'string'
    || typeof snapshot.selectedStationId !== 'string' || typeof snapshot.identity !== 'string'
    || !exactKeys(snapshot.selection, 'focus,kind,stationId')
    || !exactKeys(snapshot.scope, 'eligibleCount,excludedCount,includedCount')
    || Object.values(snapshot.scope).some(value => !Number.isSafeInteger(value) || value < 0)
    || !Array.isArray(snapshot.stations) || snapshot.stations.length < 1 || snapshot.stations.length > 1000
    || snapshot.stations.some(station => !exactKeys(station, 'effectiveLength,id,reach,sourceRow,sourceSheet,station'))
    || !Array.isArray(snapshot.entries) || snapshot.entries.length < 1 || snapshot.entries.length > snapshot.stations.length * 4
    || snapshot.entries.some(entry => !exactKeys(entry, 'key,scenarioRevision')
      || typeof entry.key !== 'string' || typeof entry.scenarioRevision !== 'string')) {
    throw new Error('รูปแบบสำเนารายงานตรวจงานไม่ถูกต้อง');
  }
  if (envelopeIdentity(snapshot) !== snapshot.identity) throw new Error('ข้อมูลหรือขอบเขตในสำเนารายงานตรวจงานเปลี่ยนจากที่บันทึก กรุณาสร้างรายงานใหม่');
  const parsed = parseProject(JSON.stringify(snapshot.project), source);
  const record = buildReview(parsed.project, source);
  const selected = selectReview(record, snapshot.selection);
  nonempty(selected);
  if (parsed.migrated || parsed.project.selectedStationId !== snapshot.selectedStationId
    || record.metadata.projectRevision !== snapshot.revision
    || JSON.stringify(record.stations) !== JSON.stringify(snapshot.stations)
    || JSON.stringify(scopeCounts(selected)) !== JSON.stringify(snapshot.scope)
    || JSON.stringify(identities(selected)) !== JSON.stringify(snapshot.entries)) {
    throw new Error('รุ่นข้อมูล สถานี หรือขอบเขตสำเนารายงานตรวจงานไม่ตรงกัน กรุณาสร้างรายงานใหม่');
  }
  return { project: parsed.project, selection: { ...selected.selection }, createdAt: snapshot.createdAt };
}
