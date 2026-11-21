import {
  createProject, parseProject, serializeProject, projectRevision,
  getActiveScenario, scenarioRevision,
} from './project.js';

export const WORKING_PROJECT_KEY = 'riverbank.s6006.working-project.v1';
export const REPORT_SNAPSHOT_PREFIX = 'riverbank.s6006.report-snapshot.v1.';

/** Inputs are persisted; all engineering results are recalculated on reopening. */
export function saveWorkingProject(project, source, storage) {
  const text = serializeProject(project, source);
  storage.setItem(WORKING_PROJECT_KEY, text);
}

export function loadWorkingProject(source, storage) {
  const text = storage.getItem(WORKING_PROJECT_KEY);
  return text === null ? null : parseProject(text, source);
}

/** Each report keeps its own immutable input snapshot, independent of later edits. */
export function saveReportSnapshot(project, source, storage, options = {}) {
  const validated = JSON.parse(serializeProject(project, source));
  const id = options.id ?? globalThis.crypto.randomUUID();
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('รหัสสำเนารายงานไม่ถูกต้อง');
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) throw new Error('เวลาสร้างสำเนารายงานไม่ถูกต้อง');
  const revision = projectRevision(validated);
  const snapshot = {
    schema: 'riverbank.s6006.report-snapshot', version: 1, id, createdAt, revision,
    scenarioRevision: scenarioRevision(getActiveScenario(validated)), selectedStationId: validated.selectedStationId,
    project: validated,
  };
  const key = REPORT_SNAPSHOT_PREFIX + id;
  if (storage.getItem(key) !== null) throw new Error('มีสำเนารายงานรหัสนี้แล้ว กรุณาสร้างรหัสใหม่');
  storage.setItem(key, JSON.stringify(snapshot));
  return { url: 'report.html?snapshot=' + encodeURIComponent(id), revision, createdAt };
}

/** A requested snapshot may never silently turn into a baseline report. */
export function loadReportProject({ search, storage, source }) {
  const params = new URLSearchParams(search);
  if (!params.has('snapshot')) return { project: createProject(source), mode: 'baseline', createdAt: null };
  const ids = params.getAll('snapshot');
  if (ids.length !== 1 || !/^[a-zA-Z0-9-]{8,80}$/.test(ids[0])) throw new Error('ลิงก์สำเนารายงานไม่ถูกต้อง กรุณาเปิดรายงานจากโครงการอีกครั้ง');
  const text = storage.getItem(REPORT_SNAPSHOT_PREFIX + ids[0]);
  if (text === null) throw new Error('ไม่พบสำเนาข้อมูลของรายงานนี้ในเบราว์เซอร์ กรุณาเปิดไฟล์โครงการ JSON แล้วกดรายการคำนวณอีกครั้ง');
  if (text.length > 2000000) throw new Error('สำเนารายงานมีขนาดเกินขอบเขตที่รองรับ');
  let snapshot;
  try { snapshot = JSON.parse(text); } catch { throw new Error('สำเนารายงานเสียหาย กรุณาสร้างรายงานจากไฟล์โครงการอีกครั้ง'); }
  const keys = 'createdAt,id,project,revision,scenarioRevision,schema,selectedStationId,version';
  if (!snapshot || Array.isArray(snapshot) || Object.keys(snapshot).sort().join(',') !== keys
    || snapshot.schema !== 'riverbank.s6006.report-snapshot' || snapshot.version !== 1
    || snapshot.id !== ids[0] || typeof snapshot.createdAt !== 'string'
    || !Number.isFinite(Date.parse(snapshot.createdAt))) throw new Error('รูปแบบสำเนารายงานไม่ถูกต้อง');
  const parsed = parseProject(JSON.stringify(snapshot.project), source);
  if (parsed.migrated || parsed.project.selectedStationId !== snapshot.selectedStationId || projectRevision(parsed.project) !== snapshot.revision
    || scenarioRevision(getActiveScenario(parsed.project)) !== snapshot.scenarioRevision) {
    throw new Error('รุ่นข้อมูลในสำเนารายงานไม่ตรงกัน กรุณาสร้างรายงานจากโครงการอีกครั้ง');
  }
  return { project: parsed.project, mode: 'snapshot', createdAt: snapshot.createdAt };
}
