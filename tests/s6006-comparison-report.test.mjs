import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createProject, updateActiveScenario, selectStation, saveAlternative, removeAlternative,
  setComparisonReference, getActiveScenario, projectRevision, scenarioRevision,
  ALTERNATIVE_NAME_MAX_LENGTH,
} from '../projects/s6006/project.js';
import { buildComparison } from '../projects/s6006/comparison.js';
import {
  saveComparisonSnapshot, loadComparisonProject, COMPARISON_SNAPSHOT_PREFIX, COMPARISON_SNAPSHOT_MAX_BYTES,
} from '../projects/s6006/comparison-storage.js';
import {
  buildComparisonReportPages, renderComparisonReportPages, mountComparisonReport,
  formatComparisonTimestamp, splitComparisonText, COMPARISON_INPUT_ROWS_PER_PAGE,
  COMPARISON_RESULT_ROWS_PER_PAGE, COMPARISON_TEXT_CHARACTERS_PER_PAGE, COMPARISON_TEXT_LINE_BREAKS_PER_PAGE,
} from '../projects/s6006/comparison-report.js';
import { saveReportSnapshot, loadReportProject, REPORT_SNAPSHOT_PREFIX } from '../projects/s6006/project-storage.js';
import { buildReportPages } from '../projects/s6006/report.js';

const source = JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json', import.meta.url), 'utf8'));
const snapshotOptions = { id: 'comparison-test-0001', createdAt: '2026-11-21T08:30:00.000Z' };
const reportArgs = { createdAt: snapshotOptions.createdAt, snapshotToken: snapshotOptions.id };
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const load = (storage, search = '?snapshot=' + snapshotOptions.id, selectedSource = source) => loadComparisonProject({ search, storage, source: selectedSource });
const saved = (project = createProject(source), name = 'ต้นแบบ', id = 'alternative-a') => saveAlternative(project, name, source, { id, createdAt: '2026-11-21T08:00:00.000Z' });
const allHTML = record => renderComparisonReportPages(record);
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const unescape = value => value.replace(/&lt;|&gt;|&quot;|&#39;|&amp;/g, entity => ({ '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' }[entity]));

function fourColumnProject() {
  let project = saved(updateActiveScenario(createProject(source), { beamInputs: { externalMuKnM: 30 } }, source));
  project = updateActiveScenario(project, {
    geometry: { slopeH: 3.5, length: 500 },
    beamInputs: { tensionBarDiameterMm: 16, stirrupDiameterMm: 8, externalMuKnM: 30, externalVuKn: 50 },
    soilInputs: { frictionAngleDeg: 35 },
    context: { waterHighLevel: 99.5, waterLowLevel: 90.5, groundwaterLevel: 97.5, boreholeReference: 'BH-TEST-01', waterReference: 'ระดับสมมติทดสอบ' },
  }, source);
  project = saved(project, 'เหล็กและลาดที่แก้', 'alternative-b');
  project = updateActiveScenario(project, { soilInputs: { mode: 'undrained', undrainedStrengthKpa: null } }, source);
  project = saved(project, 'รอข้อมูล Su', 'alternative-c');
  return updateActiveScenario(project, { soilInputs: { undrainedStrengthKpa: 30 }, beamInputs: { externalMuKnM: 60 } }, source);
}

test('comparison snapshot is immutable through working edits, reference changes, deletions and station changes', () => {
  const storage = memory();
  let project = fourColumnProject();
  const before = structuredClone(project);
  const result = saveComparisonSnapshot(project, source, storage, snapshotOptions);
  const key = COMPARISON_SNAPSHOT_PREFIX + snapshotOptions.id;
  const originalText = storage.getItem(key);
  const first = buildComparisonReportPages({ ...load(storage), source, snapshotToken: snapshotOptions.id });
  assert.equal(result.url, 'comparison-report.html?snapshot=' + snapshotOptions.id);
  assert.equal(result.revision, projectRevision(project));
  assert.equal(result.createdAt, snapshotOptions.createdAt);
  project = setComparisonReference(project, 'alternative-b', source);
  project = removeAlternative(project, 'alternative-a', source);
  project = updateActiveScenario(project, { geometry: { slopeH: 1.5, length: 75 }, context: { sourceNote: 'later edit' } }, source);
  project = selectStation(project, 'r2-row128', source);
  const loaded = load(storage);
  assert.deepEqual(loaded.project, before);
  assert.notEqual(projectRevision(loaded.project), projectRevision(project));
  assert.equal(storage.getItem(key), originalText);
  assert.equal(allHTML(buildComparisonReportPages({ ...loaded, source, snapshotToken: snapshotOptions.id })), allHTML(first));
  const envelope = JSON.parse(originalText);
  assert.deepEqual(envelope.entries.map(entry => entry.id), ['alternative-a', 'alternative-b', 'alternative-c', 'current']);
  assert.equal(envelope.entries.at(-1).revision, scenarioRevision(getActiveScenario(before)));
  assert.doesNotMatch(originalText, /usablePhiMnKnM|factorOfSafety|beamResults|soilResults/);
});

test('comparison report requires a saved reference and an exact mandatory snapshot token', () => {
  const storage = memory(), project = saved();
  assert.throws(() => saveComparisonSnapshot(createProject(source), source, storage, snapshotOptions), /อย่างน้อยหนึ่งทางเลือก/);
  assert.throws(() => buildComparisonReportPages({ project: createProject(source), source, ...reportArgs }), /อย่างน้อยหนึ่งทางเลือก/);
  for (const search of ['', '?snapshot=', '?snapshot=short', '?snapshot=..%2Fbad-token', '?snapshot=valid-token%0A', '?snapshot=valid-token&snapshot=other-token']) {
    assert.throws(() => load(storage, search), /snapshot/);
  }
  assert.throws(() => load(storage), /ไม่พบสำเนา/);
  for (const id of ['short', 'valid-token\n', ' valid-token', 'valid-token ', 'bad/token']) {
    assert.throws(() => saveComparisonSnapshot(project, source, storage, { ...snapshotOptions, id }), /รหัส/);
    assert.throws(() => buildComparisonReportPages({ project, source, ...reportArgs, snapshotToken: id }), /snapshot/);
  }
  for (const createdAt of ['bad-date', '2026-02-30T08:30:00.000Z', '2026-11-21', '2026-11-21T08:30:00.000+00:00']) {
    assert.throws(() => saveComparisonSnapshot(project, source, storage, { ...snapshotOptions, createdAt }), /เวลา/);
    assert.throws(() => buildComparisonReportPages({ project, source, ...reportArgs, createdAt }), /snapshot/);
  }
});

test('corrupt, oversized and altered comparison snapshots fail without a fallback', () => {
  const storage = memory();
  saveComparisonSnapshot(fourColumnProject(), source, storage, snapshotOptions);
  const key = COMPARISON_SNAPSHOT_PREFIX + snapshotOptions.id;
  const original = JSON.parse(storage.getItem(key));
  for (const malformed of ['{broken', 'null', '[]']) {
    storage.setItem(key, malformed);
    assert.throws(() => load(storage));
  }
  storage.setItem(key, 'ก'.repeat(Math.floor(COMPARISON_SNAPSHOT_MAX_BYTES / 3) + 1));
  assert.throws(() => load(storage), /ขนาด/);
  const mutations = [
    value => { value.revision = 'wrong-revision'; },
    value => { value.referenceId = 'alternative-b'; },
    value => { value.selectedStationId = 'r2-row128'; },
    value => { value.project.selectedStationId = 'r2-row128'; },
    value => { value.station.effectiveLength += 1; },
    value => { value.entries[0].revision = 'wrong-scenario'; },
    value => { value.entries.reverse(); },
    value => { value.entries[0].extra = true; },
    value => { value.project.stationComparisons['r1-row14'].referenceId = 'alternative-b'; },
    value => { value.project.stationScenarios['r1-row14'].geometry.slopeH = 2; },
    value => { value.createdAt = '2026-02-30T08:30:00.000Z'; },
    value => { value.schema = 'riverbank.s6006.report-snapshot'; },
    value => { value.unexpected = 1; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original);
    mutate(changed); storage.setItem(key, JSON.stringify(changed));
    assert.throws(() => load(storage));
  }
  storage.setItem(key, JSON.stringify(original));
  const changedSource = structuredClone(source);
  changedSource.rows[0].effectiveLengthM += 1;
  assert.throws(() => load(storage, '?snapshot=' + snapshotOptions.id, changedSource), /รุ่นข้อมูล|สถานี/);
  assert.equal(load(storage).project.selectedStationId, 'r1-row14');
});

test('comparison storage collision and storage failure do not overwrite an existing immutable report', () => {
  const storage = memory(), project = saved();
  saveComparisonSnapshot(project, source, storage, snapshotOptions);
  const key = COMPARISON_SNAPSHOT_PREFIX + snapshotOptions.id, before = storage.getItem(key);
  assert.throws(() => saveComparisonSnapshot(project, source, storage, snapshotOptions), /มีสำเนา/);
  assert.equal(storage.getItem(key), before);
  const blocked = { getItem: () => null, setItem: () => { throw new Error('quota unavailable'); } };
  assert.throws(() => saveComparisonSnapshot(project, source, blocked, snapshotOptions), /quota unavailable/);
});

test('all actual inputs and computed rows print once with separate lengths, beam gates and soil cases', () => {
  const project = fourColumnProject(), before = JSON.stringify(project), sourceBefore = JSON.stringify(source);
  const comparison = buildComparison(project, source);
  const record = buildComparisonReportPages({ project, source, ...reportArgs });
  const html = allHTML(record);
  assert.equal(record.metadata.entryCount, 4);
  assert.equal(record.metadata.referenceId, 'alternative-a');
  assert.deepEqual(record.metadata.entries.map(entry => entry.label), ['A', 'B', 'C', 'ปัจจุบัน']);
  assert.match(record.pages[0].body, /r1-row14/);
  assert.match(record.pages[0].body, /Lᵢ = 12\.5 m/);
  for (const row of comparison.rows) {
    assert.equal(html.split('data-row-id="' + row.id + '"').length - 1, 1, row.id);
  }
  assert.equal(comparison.rows.length, 67);
  assert.match(html, /L = 1000 m/);
  assert.match(html, /L = 500 m/);
  assert.match(html, /ปริมาณทฤษฎีต่อความยาว 1 m/);
  assert.match(html, /ปริมาณทฤษฎีตามความยาวที่ระบุ/);
  const rowHTML = id => html.match(new RegExp('<tr data-row-id="' + id.replaceAll('.', '\\.') + '"[\\s\\S]*?</tr>'))[0];
  const cellHTML = (id, entry) => rowHTML(id).match(new RegExp('<td data-entry-id="' + entry + '"[\\s\\S]*?</td>'))[0];
  assert.match(cellHTML('beam.usablePhiMnKnM', 'alternative-a'), /data-availability="gated"[\s\S]*>—<\/span>/);
  assert.match(cellHTML('beam.usablePhiMnKnM', 'alternative-b'), /60\.474157/);
  assert.doesNotMatch(cellHTML('beam.usablePhiMnKnM', 'alternative-a'), /34\.965/);
  assert.match(cellHTML('soil.dry.factorOfSafety', 'alternative-b'), /2\.450726/);
  assert.match(cellHTML('soil.dry.factorOfSafety', 'alternative-c'), /not-applicable/);
  assert.match(cellHTML('soil.undrained.factorOfSafety', 'alternative-c'), /data-availability="missing"[\s\S]*>—<\/span>/);
  assert.match(cellHTML('soil.undrained.factorOfSafety', 'current'), /data-availability="computed"/);
  assert.match(html, /ยังไม่มี Su สำหรับ total stress/);
  assert.match(html, /โมดูลไม่ใช้ข้อยกเว้น 4\/3/);
  assert.match(html, /ไม่ใช่ global FS/);
  assert.match(html, /ไม่ใช่การรับรองโครงการ/);
  assert.doesNotMatch(html, /class="[^\"]*(?:winner|success|pass)[^\"]*"/);
  assert.equal(JSON.stringify(project), before);
  assert.equal(JSON.stringify(source), sourceBefore);
  for (const page of record.pages.filter(page => page.kind === 'results')) assert.ok(page.rowCount <= COMPARISON_RESULT_ROWS_PER_PAGE);
  for (const page of record.pages.filter(page => page.kind === 'inputs')) assert.ok(page.rowCount <= COMPARISON_INPUT_ROWS_PER_PAGE);
});

test('context strings including object-property names remain literal, and input differences are marked', () => {
  let project = saved(updateActiveScenario(createProject(source), {
    context: { boreholeReference: 'effective', waterReference: 'constructor', sourceNote: '__proto__' },
  }, source));
  project = updateActiveScenario(project, { context: { sourceNote: 'undrained' } }, source);
  const record = buildComparisonReportPages({ project, source, ...reportArgs }), html = allHTML(record);
  for (const value of ['effective', 'constructor', '__proto__', 'undrained']) assert.ok(html.includes('<span class="metric-value">' + value + '</span>'));
  assert.match(html, /data-row-id="input\.context\.sourceNote" class="input-changed" data-input-changed="true"/);
  assert.doesNotMatch(html, /\[object Object\]|function Object/);
});

test('maximum names and long multiline context are escaped and preserved in bounded pages', () => {
  const name = ('<img src=x onerror=alert(1)>' + 'ก'.repeat(48)).slice(0, ALTERNATIVE_NAME_MAX_LENGTH);
  const context = {
    boreholeReference: ('<script>alert("source")</script>' + 'ดิน&'.repeat(700)).slice(0, 2000),
    waterReference: 'แหล่งน้ำ '.repeat(250).slice(0, 2000),
    sourceNote: 'line\n'.repeat(200) + '😀'.repeat(500),
  };
  let project = saved(updateActiveScenario(createProject(source), { context }, source), name);
  project = saved(project, 'ข'.repeat(ALTERNATIVE_NAME_MAX_LENGTH), 'alternative-b');
  project = saved(project, 'ค\n'.repeat(ALTERNATIVE_NAME_MAX_LENGTH / 2 - 1) + 'คค', 'alternative-c');
  const record = buildComparisonReportPages({ project, source, ...reportArgs }), html = allHTML(record);
  assert.equal(record.metadata.entryCount, 4);
  assert.ok(html.includes(escape(name)));
  assert.doesNotMatch(html, /<img|<script>/);
  assert.ok(html.includes('&lt;script&gt;alert(&quot;source&quot;)&lt;/script&gt;'));
  const texts = new Map();
  for (const page of record.pages.filter(page => page.kind === 'text')) {
    const match = page.body.match(/data-text-reference="([^"]+)" data-text-part="(\d+)">([\s\S]*?)<\/div>/);
    assert.ok(match);
    const chunk = unescape(match[3]);
    assert.ok(Array.from(chunk).length <= COMPARISON_TEXT_CHARACTERS_PER_PAGE);
    assert.ok((chunk.match(/[\r\n]/g) || []).length <= COMPARISON_TEXT_LINE_BREAKS_PER_PAGE);
    assert.ok(!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(chunk));
    texts.set(match[1], (texts.get(match[1]) || '') + chunk);
  }
  assert.equal(texts.size, 12);
  for (const value of Object.values(context)) assert.equal([...texts.values()].filter(text => text === value).length, 4);
  for (const value of Object.values(context)) assert.equal(splitComparisonText(value).join(''), value);
  assert.ok(record.pages.filter(page => page.kind === 'inputs').every(page => page.rowCount <= COMPARISON_INPUT_ROWS_PER_PAGE));
});

test('report identity and Bangkok timestamps repeat consistently without changing native v1 reports', () => {
  const legacy = createProject(source);
  legacy.version = 1; delete legacy.stationComparisons;
  assert.equal(projectRevision(legacy), 's6006p-30d0acd78fa4ab75');
  const storage = memory(), oldOptions = { id: 'legacy-report-0001', createdAt: snapshotOptions.createdAt };
  saveReportSnapshot(legacy, source, storage, oldOptions);
  const key = REPORT_SNAPSHOT_PREFIX + oldOptions.id, original = storage.getItem(key);
  const originalReport = buildReportPages({ ...loadReportProject({ search: '?snapshot=' + oldOptions.id, storage, source }), source, snapshotToken: oldOptions.id });
  const project = saved(legacy);
  saveComparisonSnapshot(project, source, storage, snapshotOptions);
  const oldReport = loadReportProject({ search: '?snapshot=' + oldOptions.id, storage, source });
  assert.equal(oldReport.project.version, 1);
  assert.equal(projectRevision(oldReport.project), 's6006p-30d0acd78fa4ab75');
  assert.equal(storage.getItem(key), original);
  const reopenedReport = buildReportPages({ ...oldReport, source, snapshotToken: oldOptions.id });
  assert.deepEqual(reopenedReport.metadata, originalReport.metadata);
  // SVG accessibility/pattern IDs are unique per render; their numeric suffix
  // is not project data. All source, input, formula and result content is equal.
  const normalizedPages = report => JSON.stringify(report.pages).replace(/s6006-section-\d+/g, 's6006-section-ID');
  assert.equal(normalizedPages(reopenedReport), normalizedPages(originalReport));
  const record = buildComparisonReportPages({ ...load(storage), source, snapshotToken: snapshotOptions.id }), html = allHTML(record);
  assert.equal(formatComparisonTimestamp(snapshotOptions.createdAt), '21/11/2569 15:30:00 (Asia/Bangkok, UTC+07:00)');
  assert.equal((html.match(/<footer class="running-foot">/g) || []).length, record.pages.length);
  assert.equal((html.match(/Snapshot comparison-test-0001/g) || []).length, record.pages.length);
  assert.equal((html.match(new RegExp('Project ' + record.metadata.projectRevision, 'g')) || []).length, record.pages.length);
});

function mountFixture(storage, search) {
  const element = () => ({
    dataset: {}, innerHTML: '', textContent: '', disabled: false, hidden: true, handlers: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    replaceChildren() { this.innerHTML = ''; },
    addEventListener(name, handler) { this.handlers[name] = handler; },
  });
  const host = element(), print = element(), error = element(), status = element();
  const selectors = { '#comparison-report-ready': host, '#print-comparison-report': print, '#comparison-report-error': error, '#comparison-report-status': status };
  const document = { querySelector: selector => selectors[selector], body: { dataset: {} }, fonts: { ready: Promise.resolve() }, title: '' };
  let prints = 0;
  const window = { location: { search }, localStorage: storage, handlers: {}, fetch: async () => ({ ok: true, json: async () => source }),
    addEventListener(name, handler) { this.handlers[name] = handler; }, print() { prints++; } };
  return { document, window, host, print, error, status, prints: () => prints };
}

test('report mounting blocks printing missing or damaged snapshots and exposes accepted snapshot identity', async () => {
  const storage = memory();
  for (const search of ['', '?snapshot=comparison-missing', '?snapshot=' + snapshotOptions.id]) {
    storage.setItem(COMPARISON_SNAPSHOT_PREFIX + snapshotOptions.id, '{broken');
    const fixture = mountFixture(storage, search);
    assert.equal(await mountComparisonReport(fixture), null);
    assert.equal(fixture.host.dataset.ready, 'false');
    assert.equal(fixture.document.body.dataset.reportState, 'blocked');
    assert.equal(fixture.print.disabled, true);
    assert.equal(fixture.host.innerHTML, '');
    assert.match(fixture.error.innerHTML, /ไม่มีการแทน snapshot/);
    fixture.print.handlers.click(); fixture.window.handlers.beforeprint();
    assert.equal(fixture.prints(), 0);
  }
  const successStorage = memory(), project = fourColumnProject();
  saveComparisonSnapshot(project, source, successStorage, snapshotOptions);
  const fixture = mountFixture(successStorage, '?snapshot=' + snapshotOptions.id);
  const record = await mountComparisonReport(fixture);
  assert.equal(fixture.host.dataset.ready, 'true');
  assert.equal(fixture.host.dataset.mode, 'comparison-snapshot');
  assert.equal(fixture.host.dataset.projectRevision, projectRevision(project));
  assert.equal(fixture.host.dataset.stationId, 'r1-row14');
  assert.equal(fixture.host.dataset.referenceId, 'alternative-a');
  assert.equal(fixture.host.dataset.snapshot, snapshotOptions.id);
  assert.equal(fixture.host.dataset.entryCount, '4');
  assert.equal(fixture.host.innerHTML, allHTML(record));
  assert.equal(fixture.print.disabled, false);
  fixture.print.handlers.click();
  assert.equal(fixture.prints(), 1);
});
