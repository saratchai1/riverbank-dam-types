import { CALCULATION_REVISION, PROJECT_MAX_BYTES, parseProject, serializeProject } from './project.js';
import { STUDY_METHOD_REVISION, buildStudy } from './studies.js';

export const STUDY_DOCUMENT_MAX_BYTES = PROJECT_MAX_BYTES * 2;
export const STUDY_SNAPSHOT_PREFIX = 'riverbank.s6006.study-snapshot.v1.';
export const STUDY_SNAPSHOT_MAX_BYTES = STUDY_DOCUMENT_MAX_BYTES + 8192;
const DOCUMENT_SCHEMA = 'riverbank.s6006.study';
const REPORT_SCHEMA = 'riverbank.s6006.study-report';
const ID = /^[a-zA-Z0-9-]{8,80}$/;
const DOCUMENT_KEYS = 'calculationRevision,config,createdAt,id,integrity,methodRevision,project,projectRevision,schema,sourceRevision,studyRevision,version';
const REPORT_KEYS = 'createdAt,document,id,integrity,metricId,pointId,schema,version';
const bytes = value => new TextEncoder().encode(value).byteLength;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === keys;
const validTime = value => typeof value === 'string' && value.length === 24
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Inspect before serializing: no getters, toJSON hooks, cycles, sparse arrays or shared graphs. */
function requirePlainData(value) {
  const seen = new Set(); let nodes = 0;
  const visit = (item, depth) => {
    if (++nodes > 180000 || depth > 40) throw new RangeError('ชุดทดลองมีโครงสร้างเกินขอบเขตที่รองรับ');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || seen.has(item) || (!Array.isArray(item) && !plain(item))) {
      throw new TypeError('ชุดทดลองต้องเป็นข้อมูล JSON ธรรมดาและไม่อ้างอิงวัตถุซ้ำ');
    }
    seen.add(item);
    const keys = Reflect.ownKeys(item);
    if (Array.isArray(item) && (Object.getPrototypeOf(item) !== Array.prototype
      || keys.length !== item.length + 1)) throw new TypeError('รายการชุดทดลองต้องไม่เว้นช่องหรือมีคุณสมบัติเพิ่ม');
    for (const key of keys) {
      if (Array.isArray(item) && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key)) {
        throw new TypeError('พบชื่อคุณสมบัติที่ไม่รองรับในชุดทดลอง');
      }
      if (Array.isArray(item) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)) {
        throw new TypeError('ดัชนีรายการชุดทดลองไม่ถูกต้อง');
      }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
        throw new TypeError('ชุดทดลองต้องไม่มี getter หรือคุณสมบัติที่ซ่อนอยู่');
      }
      visit(descriptor.value, depth + 1);
    }
  };
  visit(value, 0);
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

// Consistency checksum, not a signature, certificate, or proof of document authenticity.
function checksum(value) {
  const text = canonical(value); let a = 2166136261, b = 2246822507;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 3266489909) >>> 0;
  }
  return 's6006study-' + a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
function seal(value) { return { ...value, integrity: checksum(value) }; }
function verifySeal(value) {
  const { integrity, ...content } = value;
  if (typeof integrity !== 'string' || checksum(content) !== integrity) {
    throw new Error('ข้อมูลชุดทดลองเปลี่ยนจากสำเนาที่บันทึกไว้ กรุณาเปิดไฟล์เดิมหรือคำนวณชุดทดลองใหม่');
  }
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function identity(options) {
  requirePlainData(options);
  if (!plain(options) || Object.keys(options).some(key => !['id', 'createdAt'].includes(key))) {
    throw new TypeError('ตัวเลือกการบันทึกชุดทดลองไม่ถูกต้อง');
  }
  const id = options.id ?? globalThis.crypto.randomUUID();
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (typeof id !== 'string' || !ID.test(id)) throw new TypeError('รหัสชุดทดลองไม่ถูกต้อง');
  if (!validTime(createdAt)) throw new TypeError('เวลาชุดทดลองต้องเป็น ISO UTC ที่ถูกต้อง');
  return { id, createdAt };
}
function boundedText(text, maximum, label) {
  if (typeof text !== 'string' || bytes(text) > maximum) throw new RangeError(label + 'มีขนาดเกินขอบเขตที่รองรับ');
}

/** A portable, frozen experiment contains inputs, never persisted numerical results. */
export function createStudyDocument(project, source, config, options = {}) {
  const capturedProject = JSON.parse(serializeProject(project, source));
  const record = buildStudy(capturedProject, source, config);
  const document = seal({
    schema: DOCUMENT_SCHEMA, version: 1, ...identity(options),
    methodRevision: STUDY_METHOD_REVISION, calculationRevision: CALCULATION_REVISION,
    studyRevision: record.studyRevision, sourceRevision: record.sourceRevision,
    projectRevision: record.projectRevision,
    config: JSON.parse(JSON.stringify(record.config)), project: capturedProject,
  });
  boundedText(JSON.stringify(document, null, 2) + '\n', STUDY_DOCUMENT_MAX_BYTES, 'ไฟล์ชุดทดลอง');
  return { document: freeze(document), record: freeze(record) };
}

function validateDocument(document, source) {
  requirePlainData(document);
  if (!exactKeys(document, DOCUMENT_KEYS) || document.schema !== DOCUMENT_SCHEMA || document.version !== 1
    || typeof document.id !== 'string' || !ID.test(document.id) || !validTime(document.createdAt)
    || document.methodRevision !== STUDY_METHOD_REVISION || document.calculationRevision !== CALCULATION_REVISION) {
    throw new TypeError('รูปแบบหรือรุ่นสมการของไฟล์ชุดทดลองไม่ตรงกับแอปนี้');
  }
  boundedText(JSON.stringify(document, null, 2) + '\n', STUDY_DOCUMENT_MAX_BYTES, 'ไฟล์ชุดทดลอง');
  verifySeal(document);
  const parsed = parseProject(JSON.stringify(document.project), source);
  if (parsed.migrated) throw new TypeError('ไฟล์ชุดทดลองต้องเก็บโครงการต้นฉบับที่ตรวจแล้วโดยไม่แปลงรูปแบบอัตโนมัติ');
  const record = buildStudy(parsed.project, source, document.config);
  if (record.studyRevision !== document.studyRevision || record.sourceRevision !== document.sourceRevision
    || record.projectRevision !== document.projectRevision) {
    throw new Error('รุ่นชุดทดลอง สถานี ข้อมูลฐาน หรือค่าที่ใช้ทดลองไม่ตรงกับสำเนาที่บันทึกไว้');
  }
  return record;
}

export function serializeStudyDocument(document, source) {
  validateDocument(document, source);
  return JSON.stringify(document, null, 2) + '\n';
}

export function inspectStudyDocument(document, source) {
  const record = validateDocument(document, source);
  return { document: freeze(JSON.parse(JSON.stringify(document))), record: freeze(record) };
}

/** Loading a study is inspection only; it returns no replacement working project. */
export function parseStudyDocument(text, source) {
  boundedText(text, STUDY_DOCUMENT_MAX_BYTES, 'ไฟล์ชุดทดลอง');
  let document;
  try { document = JSON.parse(text); } catch { throw new TypeError('ไฟล์ชุดทดลองไม่ใช่ JSON ที่อ่านได้'); }
  const record = validateDocument(document, source);
  return { document: freeze(document), record: freeze(record) };
}

function requireView(record, view) {
  requirePlainData(view);
  if (!exactKeys(view, 'metricId,pointId')
    || !record.metricDefinitions.some(metric => metric.id === view.metricId)
    || !record.parameter.metricIds.includes(view.metricId)
    || ![record.baseline, ...record.samples].some(point => point.id === view.pointId)) {
    throw new TypeError('ต้องเลือกผลลัพธ์และจุดทดลองที่มีอยู่ในชุดทดลองนี้');
  }
}

/** Each print action creates its own immutable view of the captured experiment. */
export function saveStudySnapshot(document, source, storage, view, options = {}) {
  const record = validateDocument(document, source);
  requireView(record, view);
  const snapshot = seal({
    schema: REPORT_SCHEMA, version: 1, ...identity(options),
    document: JSON.parse(JSON.stringify(document)), metricId: view.metricId, pointId: view.pointId,
  });
  const text = JSON.stringify(snapshot);
  boundedText(text, STUDY_SNAPSHOT_MAX_BYTES, 'สำเนารายงานทดลอง');
  const key = STUDY_SNAPSHOT_PREFIX + snapshot.id;
  if (storage.getItem(key) !== null) throw new Error('มีสำเนารายงานทดลองรหัสนี้แล้ว กรุณาสร้างรหัสใหม่');
  storage.setItem(key, text);
  return { url: 'study-report.html?snapshot=' + encodeURIComponent(snapshot.id),
    createdAt: snapshot.createdAt, studyRevision: record.studyRevision };
}

export function loadStudySnapshot({ search, storage, source }) {
  const ids = new URLSearchParams(search).getAll('snapshot');
  if (ids.length !== 1 || !ID.test(ids[0])) throw new Error('ต้องเปิดรายงานทดลองจากลิงก์ snapshot ที่ถูกต้อง');
  const text = storage.getItem(STUDY_SNAPSHOT_PREFIX + ids[0]);
  if (text === null) throw new Error('ไม่พบสำเนารายงานทดลองนี้ กรุณาเปิดไฟล์ชุดทดลองแล้วสร้างรายงานอีกครั้ง');
  boundedText(text, STUDY_SNAPSHOT_MAX_BYTES, 'สำเนารายงานทดลอง');
  let snapshot;
  try { snapshot = JSON.parse(text); } catch { throw new TypeError('สำเนารายงานทดลองเสียหาย กรุณาสร้างรายงานอีกครั้ง'); }
  requirePlainData(snapshot);
  if (!exactKeys(snapshot, REPORT_KEYS) || snapshot.schema !== REPORT_SCHEMA || snapshot.version !== 1
    || snapshot.id !== ids[0] || !validTime(snapshot.createdAt)) throw new TypeError('รูปแบบสำเนารายงานทดลองไม่ถูกต้อง');
  verifySeal(snapshot);
  const loaded = parseStudyDocument(JSON.stringify(snapshot.document), source);
  requireView(loaded.record, { metricId: snapshot.metricId, pointId: snapshot.pointId });
  return { ...loaded, metricId: snapshot.metricId, pointId: snapshot.pointId, reportCreatedAt: snapshot.createdAt };
}
