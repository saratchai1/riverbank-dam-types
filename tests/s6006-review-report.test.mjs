import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createProject, updateActiveScenario, selectStation, saveAlternative, removeAlternative,
  projectRevision, getActiveScenario, ALTERNATIVE_NAME_MAX_LENGTH,
} from '../projects/s6006/project.js';
import { buildReview, selectReview, REVIEW_REVISION } from '../projects/s6006/review.js';
import { saveReviewSnapshot, loadReviewProject, REVIEW_SNAPSHOT_PREFIX, REVIEW_SNAPSHOT_MAX_BYTES } from '../projects/s6006/review-storage.js';
import {
  buildReviewReportPages, renderReviewReportPages, mountReviewReport, formatReviewTimestamp,
  splitReviewText, REVIEW_REGISTER_ROWS_PER_PAGE, REVIEW_FINDING_ROWS_PER_PAGE,
  REVIEW_TEXT_CHARACTERS_PER_PAGE, REVIEW_TEXT_LINE_BREAKS_PER_PAGE,
} from '../projects/s6006/review-report.js';
import { saveReportSnapshot, loadReportProject, REPORT_SNAPSHOT_PREFIX } from '../projects/s6006/project-storage.js';
import { saveComparisonSnapshot, loadComparisonProject, COMPARISON_SNAPSHOT_PREFIX } from '../projects/s6006/comparison-storage.js';

const source = JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json', import.meta.url), 'utf8'));
const selection = { stationId: 'r1-row14', kind: 'all', focus: 'all' };
const options = { id: 'review-test-0001', createdAt: '2026-11-22T01:30:00.000Z' };
const args = { createdAt: options.createdAt, snapshotToken: options.id };
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const saved = (project, name = 'ต้นแบบ', id = 'alternative-a') => saveAlternative(project, name, source, { id, createdAt: '2026-11-22T01:00:00.000Z' });
const load = (storage, search = '?snapshot=' + options.id, selectedSource = source) => loadReviewProject({ search, storage, source: selectedSource });
const html = record => renderReviewReportPages(record);
const esc = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const unescape = value => value.replace(/&lt;|&gt;|&quot;|&#39;|&amp;/g, entity => ({ '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' }[entity]));

function multipleScenarios() {
  let project = saved(createProject(source));
  project = updateActiveScenario(project, {
    geometry: { slopeH: 3.5 },
    beamInputs: { tensionBarDiameterMm: 16, stirrupDiameterMm: 8, externalMuKnM: 30, externalVuKn: 50 },
    context: { boreholeReference: 'BH-TEST-01', sourceNote: 'สมมติฐานเพื่อทดสอบ', waterReference: 'ระดับสมมติ', waterHighLevel: 100, waterLowLevel: 90, groundwaterLevel: 95 },
  }, source);
  project = saved(project, 'ลาดและเหล็กที่แก้', 'alternative-b');
  project = updateActiveScenario(project, { soilInputs: { mode: 'undrained', undrainedStrengthKpa: null } }, source);
  project = saved(project, 'รอข้อมูล Su', 'alternative-c');
  return updateActiveScenario(project, { soilInputs: { undrainedStrengthKpa: 30 }, beamInputs: { externalMuKnM: 90 } }, source);
}

test('review snapshot preserves exact selected inputs and all findings after edits, removal and station changes', () => {
  const storage = memory();
  let project = multipleScenarios();
  const before = structuredClone(project), originalSelection = { ...selection, focus: 'attention' };
  const result = saveReviewSnapshot(project, source, storage, originalSelection, options);
  assert.equal(result.url, 'review-report.html?snapshot=' + options.id);
  assert.equal(result.revision, projectRevision(before));
  const key = REVIEW_SNAPSHOT_PREFIX + options.id, original = storage.getItem(key);
  const firstReport = buildReviewReportPages({ ...load(storage), source, ...args });
  project = removeAlternative(project, 'alternative-a', source);
  project = updateActiveScenario(project, { geometry: { slopeH: 4 }, context: { sourceNote: 'later edit' } }, source);
  project = selectStation(project, 'r2-row128', source);
  const reopened = load(storage);
  assert.deepEqual(reopened.project, before);
  assert.deepEqual(reopened.selection, originalSelection);
  assert.notEqual(projectRevision(project), projectRevision(before));
  assert.equal(storage.getItem(key), original);
  assert.equal(html(buildReviewReportPages({ ...reopened, source, ...args })), html(firstReport));
  const envelope = JSON.parse(original);
  assert.equal(envelope.reviewRevision, REVIEW_REVISION);
  assert.equal(envelope.entries.length, 2);
  assert.equal(envelope.scope.eligibleCount, 4);
  assert.equal(envelope.scope.includedCount, 2);
  assert.equal(envelope.scope.excludedCount, 2);
  assert.doesNotMatch(original, /usablePhiMnKnM|factorOfSafety|findings|momentUtilization/);
});

test('review reports require a mandatory exact snapshot and a nonempty validated selection', () => {
  const storage = memory(), project = createProject(source);
  for (const search of ['', '?snapshot=', '?snapshot=short', '?snapshot=valid-token%0A', '?snapshot=valid-token&snapshot=other-token', '?snapshot=../bad-token']) {
    assert.throws(() => load(storage, search), /snapshot/);
  }
  assert.throws(() => load(storage), /ไม่พบสำเนา/);
  for (const id of ['short', 'valid-token\n', ' valid-token', 'valid-token ', 'bad/token']) {
    assert.throws(() => saveReviewSnapshot(project, source, storage, selection, { ...options, id }), /รหัส/);
    assert.throws(() => buildReviewReportPages({ project, source, selection, ...args, snapshotToken: id }), /snapshot/);
  }
  for (const createdAt of ['bad-date', '2026-02-30T08:30:00.000Z', '2026-11-22', '2026-11-22T01:30:00.000+00:00']) {
    assert.throws(() => saveReviewSnapshot(project, source, storage, selection, { ...options, createdAt }), /เวลา/);
    assert.throws(() => buildReviewReportPages({ project, source, selection, ...args, createdAt }), /เวลา/);
  }
  const emptySelection = { ...selection, kind: 'saved' };
  assert.throws(() => saveReviewSnapshot(project, source, storage, emptySelection, options), /ไม่มีชุดข้อมูล/);
  assert.throws(() => buildReviewReportPages({ project, source, selection: emptySelection, ...args }), /ไม่มีชุดข้อมูล/);
  for (const invalid of [{ ...selection, extra: true }, { ...selection, stationId: 'no-station' }, { ...selection, focus: 'passed' }]) {
    assert.throws(() => saveReviewSnapshot(project, source, storage, invalid, options));
  }
});

test('altered selection, time, project data, station context and envelope identity fail without fallback', () => {
  const storage = memory();
  saveReviewSnapshot(multipleScenarios(), source, storage, selection, options);
  const key = REVIEW_SNAPSHOT_PREFIX + options.id, original = JSON.parse(storage.getItem(key));
  for (const malformed of ['{broken', 'null', '[]']) {
    storage.setItem(key, malformed); assert.throws(() => load(storage));
  }
  storage.setItem(key, 'ก'.repeat(Math.floor(REVIEW_SNAPSHOT_MAX_BYTES / 3) + 1));
  assert.throws(() => load(storage), /ขนาด/);
  const mutations = [
    s => { s.selection.focus = 'attention'; },
    s => { s.selection.kind = 'current'; },
    s => { s.selection.stationId = 'all'; },
    s => { s.selection.extra = 'x'; },
    s => { s.scope.includedCount--; },
    s => { s.revision = 'wrong-project'; },
    s => { s.reviewRevision = 'S6006-REVIEW-999'; },
    s => { s.createdAt = '2026-11-22T02:30:00.000Z'; },
    s => { s.createdAt = '2026-02-30T08:30:00.000Z'; },
    s => { s.entries.reverse(); },
    s => { s.entries[0].scenarioRevision = 'wrong-scenario'; },
    s => { s.entries[0].key = 'r2-row128/current'; },
    s => { s.project.stationScenarios['r1-row14'].geometry.slopeH = 2; },
    s => { s.project.selectedStationId = 'r2-row128'; },
    s => { s.stations[0].effectiveLength++; },
    s => { s.identity = 's6006r-0000000000000000'; },
    s => { s.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed); storage.setItem(key, JSON.stringify(changed));
    assert.throws(() => load(storage));
  }
  storage.setItem(key, JSON.stringify(original));
  const changedSource = structuredClone(source);
  changedSource.rows[0].effectiveLengthM++;
  assert.throws(() => load(storage, '?snapshot=' + options.id, changedSource), /สถานี|ขอบเขต/);
  assert.deepEqual(load(storage).selection, selection);
});

test('report collisions and unavailable storage preserve existing snapshots', () => {
  const storage = memory(), project = createProject(source), key = REVIEW_SNAPSHOT_PREFIX + options.id;
  saveReviewSnapshot(project, source, storage, selection, options);
  const before = storage.getItem(key);
  assert.throws(() => saveReviewSnapshot(project, source, storage, selection, options), /มีสำเนา/);
  assert.equal(storage.getItem(key), before);
  assert.throws(() => saveReviewSnapshot(project, source, { getItem: () => null, setItem: () => { throw new Error('quota blocked'); } }, selection, options), /quota blocked/);
});

test('all-station report retains all 41 identities but deduplicates only fully identical input and finding sets', () => {
  const project = createProject(source), original = JSON.stringify(project);
  const record = buildReviewReportPages({ project, source, selection: { ...selection, stationId: 'all' }, ...args });
  const document = html(record);
  assert.equal(record.metadata.entryCount, 41);
  assert.equal(record.metadata.groupCount, 1);
  assert.equal((document.match(/data-review-entry-key=/g) || []).length, 41);
  const review = buildReview(project, source);
  assert.equal((document.match(/data-finding-id=/g) || []).length, review.entries[0].findings.length);
  for (const entry of review.entries) assert.match(document, new RegExp('data-review-entry-key="' + entry.key + '" data-review-group="G01"'));
  assert.match(document, /ไม่ได้สร้างการตรวจสำรวจอิสระ/);
  assert.equal(JSON.stringify(project), original);
  const contextOnly = updateActiveScenario(project, { context: { sourceNote: 'มีหมายเหตุเพิ่มเติม แต่ยังไม่ได้ยืนยัน' } }, source);
  const changed = buildReviewReportPages({ project: contextOnly, source, selection: { ...selection, stationId: 'all' }, ...args });
  assert.equal(changed.metadata.groupCount, 2);
  assert.equal(changed.metadata.entryCount, 41);
  assert.ok(record.pages.filter(page => page.kind === 'registry').every(page => page.rowCount <= REVIEW_REGISTER_ROWS_PER_PAGE));
  assert.ok(record.pages.filter(page => page.kind === 'findings').every(page => page.rowCount <= REVIEW_FINDING_ROWS_PER_PAGE));
});

test('finding report retains actual numeric values, withheld strengths, missing demands and distinct soil cases', () => {
  const project = multipleScenarios(), raw = JSON.stringify(project);
  const record = buildReviewReportPages({ project, source, selection, ...args }), document = html(record);
  assert.equal(record.metadata.entryCount, 4);
  assert.equal(record.metadata.groupCount, 4);
  const expected = selectReview(buildReview(project, source), selection);
  for (const entry of expected.entries) {
    const registryRow = document.match(new RegExp('<tr data-review-entry-key="' + entry.key + '" data-review-group="([^"]+)"'));
    assert.ok(registryRow);
    const group = registryRow[1];
    for (const finding of entry.findings) {
      const expression = new RegExp('<tr data-finding-id="' + finding.id.replaceAll('.', '\\.') + '" data-review-group="' + group + '"[^>]*>[\\s\\S]*?</tr>');
      const row = document.match(expression)?.[0];
      assert.ok(row, entry.key + '/' + finding.id);
      assert.ok(row.includes('data-availability="' + finding.availability + '"'));
      assert.ok(row.includes('data-disposition="' + finding.disposition + '"'));
    }
  }
  assert.match(document, /60\.474157/);
  assert.match(document, /102\.360991/);
  assert.match(document, /31\.766402/);
  assert.match(document, /data-finding-id="soil\.undrained"[^>]*data-availability="missing"/);
  assert.match(document, /data-finding-id="soil\.dry"[^>]*data-availability="not-applicable"/);
  assert.match(document, /data-finding-id="beam\.usable-moment"[^>]*data-availability="gated"/);
  assert.match(document, /ยังใช้ตรวจไม่ได้/);
  assert.match(document, /ไม่มีการอนุมัติทั้งโครงการ/);
  assert.doesNotMatch(document, /class="[^\"]*(?:winner|success|pass)[^\"]*"/);
  assert.equal(JSON.stringify(project), raw);
});

test('attention and missing scope filters retain every finding of each included scenario and report excluded counts', () => {
  const project = multipleScenarios(), review = buildReview(project, source);
  for (const focus of ['attention', 'missing']) {
    const selectedScope = { ...selection, focus }, expected = selectReview(review, selectedScope);
    const record = buildReviewReportPages({ project, source, selection: selectedScope, ...args });
    assert.equal(record.metadata.eligibleCount, expected.eligibleCount);
    assert.equal(record.metadata.entryCount, expected.includedCount);
    assert.equal(record.metadata.excludedCount, expected.excludedCount);
    assert.equal((html(record).match(/data-finding-id=/g) || []).length, expected.entries.reduce((sum, entry) => sum + entry.findings.length, 0));
    assert.match(html(record), /รวมทุกประเด็นของชุดที่เลือก/);
    assert.match(html(record), /ไม่ได้ตัดประเด็นอื่นออก/);
  }
});

test('long and hostile context, unusual literal strings and maximum names survive escaped bounded appendices', () => {
  const context = {
    boreholeReference: ('<script>bad()</script>' + 'ดิน&'.repeat(700)).slice(0, 2000),
    waterReference: 'รายงานน้ำ\n'.repeat(180).slice(0, 2000),
    sourceNote: 'line\n'.repeat(200) + '😀'.repeat(400),
  };
  const name = ('ข\n'.repeat(23) + '<>xxx').slice(0, ALTERNATIVE_NAME_MAX_LENGTH);
  let project = saved(updateActiveScenario(createProject(source), { context }, source), name);
  const record = buildReviewReportPages({ project, source, selection, ...args }), document = html(record);
  assert.equal(record.metadata.entryCount, 2);
  assert.equal(record.metadata.groupCount, 1);
  assert.ok(document.includes(esc(name)));
  assert.doesNotMatch(document, /<script>|<img/);
  assert.ok(document.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  const texts = new Map();
  for (const page of record.pages.filter(page => page.kind === 'text')) {
    const match = page.body.match(/data-text-reference="([^"]+)" data-text-part="(\d+)">([\s\S]*?)<\/div>/);
    assert.ok(match);
    const value = unescape(match[3]);
    assert.ok(Array.from(value).length <= REVIEW_TEXT_CHARACTERS_PER_PAGE);
    assert.ok((value.match(/[\r\n]/g) || []).length <= REVIEW_TEXT_LINE_BREAKS_PER_PAGE);
    assert.ok(!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(value));
    texts.set(match[1], (texts.get(match[1]) || '') + value);
  }
  assert.equal(texts.size, 3);
  for (const value of Object.values(context)) {
    assert.ok([...texts.values()].includes(value));
    assert.equal(splitReviewText(value).join(''), value);
  }
  project = updateActiveScenario(project, { context: { boreholeReference: 'constructor', waterReference: '__proto__', sourceNote: 'effective' } }, source);
  const literals = html(buildReviewReportPages({ project, source, selection: { ...selection, kind: 'current' }, ...args }));
  for (const value of ['constructor', '__proto__', 'effective']) assert.ok(literals.includes('>' + value + '</span>'));
  assert.doesNotMatch(literals, /\[object Object\]|function Object/);
});

test('native v1 inputs and existing single/comparison reports remain unchanged alongside review snapshots', () => {
  const legacy = createProject(source); legacy.version = 1; delete legacy.stationComparisons;
  assert.equal(projectRevision(legacy), 's6006p-30d0acd78fa4ab75');
  const storage = memory();
  saveReportSnapshot(legacy, source, storage, { ...options, id: 'legacy-report-001' });
  const legacyText = storage.getItem(REPORT_SNAPSHOT_PREFIX + 'legacy-report-001');
  saveReviewSnapshot(legacy, source, storage, selection, options);
  assert.equal(load(storage).project.version, 1);
  assert.equal(projectRevision(load(storage).project), projectRevision(legacy));
  const report = buildReviewReportPages({ ...load(storage), source, ...args });
  assert.equal(report.metadata.projectRevision, 's6006p-30d0acd78fa4ab75');
  assert.equal(storage.getItem(REPORT_SNAPSHOT_PREFIX + 'legacy-report-001'), legacyText);
  assert.deepEqual(loadReportProject({ search: '?snapshot=legacy-report-001', storage, source }).project, legacy);
  const alternativeProject = saved(legacy);
  saveComparisonSnapshot(alternativeProject, source, storage, { ...options, id: 'comparison-report-001' });
  const comparisonText = storage.getItem(COMPARISON_SNAPSHOT_PREFIX + 'comparison-report-001');
  saveReviewSnapshot(alternativeProject, source, storage, selection, { ...options, id: 'review-report-002' });
  assert.equal(storage.getItem(COMPARISON_SNAPSHOT_PREFIX + 'comparison-report-001'), comparisonText);
  assert.deepEqual(loadComparisonProject({ search: '?snapshot=comparison-report-001', storage, source }).project, alternativeProject);
});

test('valid alternative timestamps without milliseconds render without weakening the strict snapshot timestamp', () => {
  const project = saveAlternative(createProject(source), 'เวลาจากไฟล์เดิม', source, { id: 'seconds-only', createdAt: '2026-11-22T01:00:00Z' });
  const storage = memory();
  saveReviewSnapshot(project, source, storage, selection, options);
  const record = buildReviewReportPages({ ...load(storage), source, ...args });
  assert.match(html(record), /22\/11\/2569 08:00:00/);
  assert.equal(load(storage).project.stationComparisons['r1-row14'].alternatives[0].createdAt, '2026-11-22T01:00:00Z');
  assert.throws(() => buildReviewReportPages({ project, source, selection, ...args, createdAt: '2026-11-22T01:30:00Z' }), /เวลา/);
});

function mountFixture(storage, search) {
  const element = () => ({
    dataset: {}, innerHTML: '', textContent: '', disabled: false, hidden: true, handlers: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    replaceChildren() { this.innerHTML = ''; },
    addEventListener(name, handler) { this.handlers[name] = handler; },
  });
  const host = element(), print = element(), error = element(), status = element();
  const selectors = { '#review-report-ready': host, '#print-review-report': print, '#review-report-error': error, '#review-report-status': status };
  const document = { querySelector: selector => selectors[selector], body: { dataset: {} }, fonts: { ready: Promise.resolve() }, title: '' };
  let prints = 0;
  const window = { location: { search }, localStorage: storage, handlers: {}, fetch: async () => ({ ok: true, json: async () => source }),
    addEventListener(name, handler) { this.handlers[name] = handler; }, print() { prints++; } };
  return { document, window, host, print, error, status, prints: () => prints };
}

test('report mount blocks missing/corrupt snapshots and publishes exact scope identity only after rendering', async () => {
  const storage = memory();
  for (const search of ['', '?snapshot=review-missing', '?snapshot=' + options.id]) {
    storage.setItem(REVIEW_SNAPSHOT_PREFIX + options.id, '{broken');
    const fixture = mountFixture(storage, search);
    assert.equal(await mountReviewReport(fixture), null);
    assert.equal(fixture.document.body.dataset.reportState, 'blocked');
    assert.equal(fixture.host.dataset.ready, 'false');
    assert.equal(fixture.host.innerHTML, '');
    assert.equal(fixture.print.disabled, true);
    fixture.print.handlers.click(); fixture.window.handlers.beforeprint();
    assert.equal(fixture.prints(), 0);
  }
  const accepted = memory(), project = multipleScenarios();
  saveReviewSnapshot(project, source, accepted, selection, options);
  const fixture = mountFixture(accepted, '?snapshot=' + options.id);
  const report = await mountReviewReport(fixture);
  assert.equal(fixture.host.dataset.ready, 'true');
  assert.equal(fixture.host.dataset.mode, 'review-snapshot');
  assert.equal(fixture.host.dataset.entryCount, '4');
  assert.equal(fixture.host.dataset.groupCount, '4');
  assert.equal(fixture.host.dataset.projectRevision, projectRevision(project));
  assert.equal(fixture.host.dataset.stationId, selection.stationId);
  assert.equal(fixture.host.dataset.kind, selection.kind);
  assert.equal(fixture.host.dataset.focus, selection.focus);
  assert.equal(fixture.print.disabled, false);
  assert.equal(fixture.host.innerHTML, html(report));
  assert.equal(formatReviewTimestamp(options.createdAt), '22/11/2569 08:30:00 (Asia/Bangkok, UTC+07:00)');
  assert.equal((html(report).match(/<footer class="running-foot">/g) || []).length, report.pages.length);
  fixture.print.handlers.click(); assert.equal(fixture.prints(), 1);
});
