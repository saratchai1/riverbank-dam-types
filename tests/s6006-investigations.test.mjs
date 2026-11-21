import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROJECT_VERSION, INVESTIGATION_PROJECT_VERSION, PROJECT_MAX_BYTES,
  createProject, getActiveScenario, getSoilInputs, stationCatalog, selectStation,
  updateActiveScenario, saveAlternative, applyAlternative, removeAlternative,
  getStationComparison, validateProject, serializeProject, parseProject,
  projectRevision, scenarioRevision,
} from '../projects/s6006/project.js';
import { calculateBeam, calculateSoil } from '../projects/s6006/engineering.js';
import {
  DEFAULT_SOIL_INVESTIGATION_METADATA, DEFAULT_WATER_INVESTIGATION_METADATA,
  INVESTIGATION_METADATA_FIELDS, INVESTIGATION_VALUE_FIELDS,
  getStationInvestigations, saveInvestigationMetadata, captureInvestigation,
  removeInvestigation, buildInvestigationReview, buildInvestigationReviews, investigationCSV,
} from '../projects/s6006/investigations.js';
import { saveReportSnapshot, loadReportProject } from '../projects/s6006/project-storage.js';
import { saveComparisonSnapshot, loadComparisonProject } from '../projects/s6006/comparison-storage.js';
import { saveReviewSnapshot, loadReviewProject } from '../projects/s6006/review-storage.js';

const source = JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json', import.meta.url), 'utf8'));
const stations = stationCatalog(source), first = stations[0].id, second = stations[1].id;
const fresh = () => createProject(source);
const copy = value => JSON.parse(JSON.stringify(value));
const createdAt = '2026-11-22T01:00:00.000Z';
const laterAt = '2026-11-22T02:00:00.000Z';
const soilMetadata = () => ({
  ...DEFAULT_SOIL_INVESTIGATION_METADATA,
  boreholeId: 'BH user-1', documentRevision: 'Trial Rev.1', locator: 'Page 12 / sample 2',
  sampleDepthFromM: 0, sampleDepthToM: 1, depthReference: 'Below borehole ground at its survey date',
  testMethod: 'User-described laboratory method', parameterInterpretation: 'Illustrative effective stress parameters; engineering interpretation pending',
  applicabilityNote: 'User records this correlation for review; no automatic station match', notes: 'Synthetic test data',
});
const waterMetadata = () => ({
  ...DEFAULT_WATER_INVESTIGATION_METADATA,
  documentRevision: 'Trial Rev.2', locator: 'Page 5', datum: 'Explicit illustrative datum',
  observationText: 'Synthetic high, low and groundwater conditions',
  applicabilityNote: 'Recorded for this station only; interpretation pending', notes: 'Synthetic test data',
});
function withInputs(project = fresh()) {
  return updateActiveScenario(project, { context: {
    boreholeReference: 'Synthetic soil report', waterReference: 'Synthetic water report',
    waterHighLevel: 0, waterLowLevel: 0, groundwaterLevel: 0,
  } }, source);
}
function capture(project, kind, metadata = kind === 'soil' ? soilMetadata() : waterMetadata()) {
  return captureInvestigation(saveInvestigationMetadata(project, kind, metadata, source), kind, source, { createdAt });
}
const group = (project, kind, stationId, scenarioId) => buildInvestigationReview(project, source, stationId, scenarioId).groups.find(item => item.kind === kind);
const save = (project, id = 'option-a') => saveAlternative(project, id, source, { id, createdAt });
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
const search = url => url.slice(url.indexOf('?'));

test('evidence is absent by default without upgrading or inventing station or material data', () => {
  const project = fresh(), before = serializeProject(project, source);
  assert.equal(PROJECT_VERSION, 2);
  assert.equal(INVESTIGATION_PROJECT_VERSION, 3);
  assert.equal(project.version, 2);
  assert.deepEqual(getStationInvestigations(project), { soil: null, water: null });
  const review = buildInvestigationReview(project, source);
  assert.equal(review.station.id, first);
  assert.equal(review.kind, 'current');
  assert.deepEqual(review.groups.map(item => [item.state, item.hasRecord, item.binding]), [['missing', false, null], ['missing', false, null]]);
  assert.equal(review.groups[0].metadata.boreholeId, '');
  assert.equal(review.groups[1].currentValues['context.groundwaterLevel'], null);
  assert.equal(serializeProject(project, source), before);
});

test('native v1 and v2 shapes, revisions and old reports remain exact after basis reads', () => {
  const v1 = fresh(); v1.version = 1; delete v1.stationComparisons;
  assert.equal(projectRevision(v1), 's6006p-30d0acd78fa4ab75');
  assert.equal(projectRevision(fresh()), 's6006p-4b14aee8e1e69656');
  for (const original of [v1, fresh()]) {
    const text = serializeProject(original, source), revision = projectRevision(original), storage = memory();
    const snapshot = saveReportSnapshot(original, source, storage, { id: `old-report-v${original.version}`, createdAt });
    assert.equal(buildInvestigationReview(original, source).groups[0].state, 'missing');
    assert.deepEqual(parseProject(text, source), { project: original, migrated: false, notices: [] });
    assert.equal(serializeProject(loadReportProject({ search: search(snapshot.url), storage, source }).project, source), text);
    assert.equal(projectRevision(original), revision);
    assert.equal('stationInvestigations' in original, false);
  }
});

test('saving metadata upgrades a detached copy only and does not adopt inputs or create a binding', () => {
  const original = withInputs(), before = serializeProject(original, source), scenario = getActiveScenario(original);
  const metadata = soilMetadata();
  const updated = saveInvestigationMetadata(original, 'soil', metadata, source);
  assert.equal(updated.version, 3);
  assert.deepEqual(getActiveScenario(updated), scenario);
  assert.equal(scenarioRevision(getActiveScenario(updated)), scenarioRevision(scenario));
  assert.notEqual(projectRevision(updated), projectRevision(original));
  assert.equal(getStationInvestigations(updated).soil.binding, null);
  assert.equal(group(updated, 'soil').state, 'incomplete');
  metadata.notes = 'outside mutation';
  assert.equal(getStationInvestigations(updated).soil.metadata.notes, 'Synthetic test data');
  assert.equal(serializeProject(original, source), before);
});

test('first evidence mutation upgrades native v1 with empty comparisons without losing its scenario', () => {
  const original = withInputs(); original.version = 1; delete original.stationComparisons;
  const revision = projectRevision(original), text = serializeProject(original, source);
  const updated = capture(original, 'soil');
  assert.equal(updated.version, 3);
  assert.deepEqual(updated.stationComparisons, {});
  assert.deepEqual(getActiveScenario(updated), getActiveScenario(original));
  assert.equal(projectRevision(original), revision);
  assert.equal(serializeProject(original, source), text);
});

test('explicit capture binds the exact station, relevant values, metadata and time without altering R2 outputs', () => {
  const original = withInputs(), scenario = getActiveScenario(original);
  const updated = capture(capture(original, 'soil'), 'water');
  const review = buildInvestigationReview(updated, source);
  assert.deepEqual(review.groups.map(item => item.state), ['current', 'current']);
  assert.equal(review.groups[0].binding.stationId, first);
  assert.equal(review.groups[0].binding.recordedAt, createdAt);
  assert.deepEqual(Object.keys(review.groups[0].capturedValues), INVESTIGATION_VALUE_FIELDS.soil.map(item => item.field));
  assert.equal(review.groups[0].capturedValues['context.boreholeReference'], 'Synthetic soil report');
  assert.equal(review.groups[1].capturedValues['context.waterHighLevel'], 0);
  assert.deepEqual(calculateBeam(getActiveScenario(updated).beamInputs), calculateBeam(scenario.beamInputs));
  assert.deepEqual(calculateSoil(getSoilInputs(getActiveScenario(updated))), calculateSoil(getSoilInputs(scenario)));
  assert.equal('projectApproved' in review, false);
  assert.ok(review.limitations.some(text => text.includes('ไม่ใช่การรับรอง')));
});

test('editing metadata keeps the old binding and reports changes until explicit recapture', () => {
  const original = capture(withInputs(), 'soil'), originalBinding = getStationInvestigations(original).soil.binding;
  const metadata = { ...soilMetadata(), documentRevision: 'Trial Rev.2', notes: '' };
  const updated = saveInvestigationMetadata(original, 'soil', metadata, source);
  const stale = group(updated, 'soil');
  assert.equal(stale.state, 'stale');
  assert.deepEqual(stale.binding, originalBinding);
  assert.deepEqual(stale.metadataChanges.map(item => item.field), ['documentRevision', 'notes']);
  assert.equal(stale.inputChanges.length, 0);
  const rebound = captureInvestigation(updated, 'soil', source, { createdAt: laterAt });
  assert.equal(group(rebound, 'soil').state, 'current');
  assert.equal(group(rebound, 'soil').binding.recordedAt, laterAt);
  assert.equal(group(rebound, 'soil').binding.metadata.documentRevision, 'Trial Rev.2');
  assert.equal(group(original, 'soil').binding.metadata.documentRevision, 'Trial Rev.1');
});

test('only captured dependencies stale the associated group; beam and unrelated geometry edits do not', () => {
  const original = capture(capture(withInputs(), 'soil'), 'water');
  const beam = updateActiveScenario(original, { beamInputs: { externalMuKnM: 100 }, geometry: { length: 150 } }, source);
  assert.deepEqual(buildInvestigationReview(beam, source).groups.map(item => item.state), ['current', 'current']);
  const soil = updateActiveScenario(beam, { geometry: { slopeH: 3 }, soilInputs: { frictionAngleDeg: 33 } }, source);
  assert.equal(group(soil, 'soil').state, 'stale');
  assert.deepEqual(group(soil, 'soil').inputChanges.map(item => item.field), ['geometry.slopeH', 'soilInputs.frictionAngleDeg']);
  assert.equal(group(soil, 'water').state, 'current');
  const water = updateActiveScenario(original, { context: { waterHighLevel: 1 } }, source);
  assert.equal(group(water, 'soil').state, 'current');
  assert.equal(group(water, 'water').state, 'stale');
  assert.deepEqual(group(water, 'water').inputChanges[0], { field: 'context.waterHighLevel', label: 'ระดับน้ำสูง', unit: 'm', captured: 0, current: 1 });
});

test('source document and scenario-note changes stale their corresponding bindings', () => {
  const original = capture(capture(withInputs(), 'soil'), 'water');
  const reference = updateActiveScenario(original, { context: { boreholeReference: 'Updated report' } }, source);
  assert.equal(group(reference, 'soil').state, 'stale');
  assert.equal(group(reference, 'water').state, 'current');
  const note = updateActiveScenario(original, { context: { sourceNote: 'Revised project assumption' } }, source);
  assert.deepEqual(buildInvestigationReview(note, source).groups.map(item => item.state), ['stale', 'stale']);
  assert.equal(group(note, 'water').inputChanges[0].field, 'context.sourceNote');
});

test('missing active Su or levels remain incomplete after capture; actual zero is present', () => {
  const undrained = updateActiveScenario(withInputs(), { soilInputs: { mode: 'undrained', frictionAngleDeg: null, effectiveCohesionKpa: null, undrainedStrengthKpa: null } }, source);
  const captured = capture(undrained, 'soil');
  assert.equal(group(captured, 'soil').state, 'incomplete');
  assert.deepEqual(group(captured, 'soil').missingInputs.map(item => item.field), ['soilInputs.undrainedStrengthKpa']);
  const zero = updateActiveScenario(captured, { soilInputs: { undrainedStrengthKpa: 0 } }, source);
  assert.equal(group(zero, 'soil').state, 'stale');
  assert.equal(group(zero, 'soil').inputChanges[0].captured, null);
  assert.equal(group(zero, 'soil').inputChanges[0].current, 0);
  const recaptured = captureInvestigation(zero, 'soil', source, { createdAt: laterAt });
  assert.equal(group(recaptured, 'soil').state, 'current');
  assert.equal(group(recaptured, 'soil').missingInputs.length, 0);
  const missingWater = capture(updateActiveScenario(fresh(), { context: { waterReference: 'Test water record' } }, source), 'water');
  assert.equal(group(missingWater, 'water').state, 'incomplete');
  assert.deepEqual(group(missingWater, 'water').missingInputs.map(item => item.field), ['context.waterHighLevel', 'context.waterLowLevel', 'context.groundwaterLevel']);
});

test('stale takes precedence over missing while keeping all missing-field reasons', () => {
  const original = capture(withInputs(), 'soil');
  const changed = updateActiveScenario(original, { soilInputs: { mode: 'undrained', undrainedStrengthKpa: null }, context: { boreholeReference: '' } }, source);
  const metadata = { ...soilMetadata(), testMethod: '' };
  const updated = saveInvestigationMetadata(changed, 'soil', metadata, source);
  const result = group(updated, 'soil');
  assert.equal(result.state, 'stale');
  assert.ok(result.missingMetadata.some(item => item.field === 'testMethod'));
  assert.ok(result.missingInputs.some(item => item.field === 'soilInputs.undrainedStrengthKpa'));
  assert.ok(result.missingInputs.some(item => item.field === 'context.boreholeReference'));
  assert.ok(result.inputChanges.some(item => item.field === 'soilInputs.mode'));
});

test('a complete metadata draft cannot be current without capture or the authoritative document reference', () => {
  const metadataOnly = saveInvestigationMetadata(withInputs(), 'soil', soilMetadata(), source);
  assert.equal(group(metadataOnly, 'soil').state, 'incomplete');
  assert.equal(group(metadataOnly, 'soil').missingMetadata.length, 0);
  assert.equal(group(metadataOnly, 'soil').missingInputs.length, 0);
  assert.equal(group(capture(fresh(), 'soil'), 'soil').state, 'incomplete');
  assert.ok(group(capture(fresh(), 'soil'), 'soil').missingInputs.some(item => item.field === 'context.boreholeReference'));
});

test('matching numeric baselines cannot transfer a binding to another station', () => {
  const original = capture(fresh(), 'soil');
  const atOther = selectStation(original, second, source);
  assert.equal(scenarioRevision(getActiveScenario(original)), scenarioRevision(getActiveScenario(atOther)));
  assert.equal(projectRevision(original), projectRevision(atOther));
  assert.equal(group(atOther, 'soil').state, 'missing');
  assert.equal(group(atOther, 'soil', first).hasRecord, true);
  const forged = copy(original);
  forged.stationInvestigations[second] = copy(forged.stationInvestigations[first]);
  assert.equal(validateProject(forged, source).valid, false);
});

test('saved alternatives freeze copies of both evidence groups while current metadata and values change', () => {
  const captured = capture(capture(withInputs(), 'soil'), 'water');
  let project = save(captured);
  const savedBasis = getStationInvestigations(project, first, 'option-a');
  project = saveInvestigationMetadata(project, 'soil', { ...soilMetadata(), locator: 'New page' }, source);
  project = updateActiveScenario(project, { geometry: { slopeH: 4 }, context: { waterHighLevel: 2 } }, source);
  assert.deepEqual(getStationInvestigations(project, first, 'option-a'), savedBasis);
  assert.deepEqual(buildInvestigationReview(project, source, first, 'option-a').groups.map(item => item.state), ['current', 'current']);
  assert.deepEqual(buildInvestigationReview(project, source).groups.map(item => item.state), ['stale', 'stale']);
  const restored = applyAlternative(project, 'option-a', source);
  assert.deepEqual(getStationInvestigations(restored), savedBasis);
  assert.deepEqual(buildInvestigationReview(restored, source).groups.map(item => item.state), ['current', 'current']);
  assert.deepEqual(getStationComparison(restored), getStationComparison(project));
});

test('applying an older alternative without evidence clears current basis without changing that saved option', () => {
  const original = save(withInputs(), 'old-option');
  const edited = capture(original, 'soil');
  const restored = applyAlternative(edited, 'old-option', source);
  assert.equal(restored.version, 3);
  assert.deepEqual(getStationInvestigations(restored), { soil: null, water: null });
  assert.deepEqual(restored.stationInvestigations, {});
  assert.deepEqual(getStationComparison(restored), getStationComparison(original));
});

test('removing current or saved evidence preserves the other copy and prunes empty entries canonically', () => {
  let project = save(capture(withInputs(), 'soil'));
  project = removeInvestigation(project, 'soil', source);
  assert.equal(group(project, 'soil').state, 'missing');
  assert.equal(group(project, 'soil', first, 'option-a').state, 'current');
  project = removeAlternative(project, 'option-a', source);
  assert.deepEqual(project.stationInvestigations, {});
  assert.deepEqual(JSON.parse(serializeProject(project, source)).stationInvestigations, {});
  assert.equal(removeInvestigation(fresh(), 'soil', source).version, 2);
  const redundant = copy(project);
  redundant.stationInvestigations[first] = { current: { soil: null, water: null }, alternatives: {} };
  assert.equal(projectRevision(redundant), projectRevision(project));
});

test('v3 JSON round trip retains captured evidence, saved copies and derived states without cached results', () => {
  let project = save(capture(capture(withInputs(), 'soil'), 'water'));
  project = updateActiveScenario(project, { soilInputs: { effectiveCohesionKpa: 1 } }, source);
  const parsed = parseProject(serializeProject(project, source), source);
  assert.equal(parsed.migrated, false);
  assert.equal(parsed.project.version, 3);
  assert.equal(projectRevision(parsed.project), projectRevision(project));
  assert.deepEqual(buildInvestigationReview(parsed.project, source), buildInvestigationReview(project, source));
  assert.deepEqual(getStationInvestigations(parsed.project, first, 'option-a'), getStationInvestigations(project, first, 'option-a'));
  const text = serializeProject(parsed.project, source);
  assert.equal(text.includes('"state"'), false);
  assert.equal(text.includes('factorOfSafety'), false);
  const outside = getStationInvestigations(parsed.project);
  outside.soil.binding.values['soilInputs.frictionAngleDeg'] = 10;
  outside.soil.metadata.locator = 'outside';
  assert.equal(getStationInvestigations(parsed.project).soil.metadata.locator, 'Page 12 / sample 2');
});

test('all snapshot families accept v3 and preserve its frozen basis after further project changes', () => {
  const project = save(capture(withInputs(), 'soil')), storage = memory();
  const current = saveReportSnapshot(project, source, storage, { id: 'evidence-current-report', createdAt });
  const comparison = saveComparisonSnapshot(project, source, storage, { id: 'evidence-comparison-report', createdAt });
  const review = saveReviewSnapshot(project, source, storage, { stationId: first, kind: 'all', focus: 'all' }, { id: 'evidence-review-report', createdAt });
  const changed = saveInvestigationMetadata(project, 'soil', { ...soilMetadata(), locator: 'Later source revision' }, source);
  assert.notEqual(projectRevision(changed), projectRevision(project));
  for (const loaded of [
    loadReportProject({ search: search(current.url), storage, source }),
    loadComparisonProject({ search: search(comparison.url), storage, source }),
    loadReviewProject({ search: search(review.url), storage, source }),
  ]) {
    assert.equal(projectRevision(loaded.project), projectRevision(project));
    assert.equal(group(loaded.project, 'soil').metadata.locator, 'Page 12 / sample 2');
    assert.equal(group(loaded.project, 'soil').state, 'current');
  }
});

test('metadata accepts drafts and custom IDs but validates numeric intervals, text limits and exact keys', () => {
  assert.doesNotThrow(() => saveInvestigationMetadata(fresh(), 'soil', { ...DEFAULT_SOIL_INVESTIGATION_METADATA, boreholeId: 'CUSTOM-BH-999', sampleDepthFromM: 0 }, source));
  for (const invalid of [
    { ...soilMetadata(), sampleDepthFromM: -1 },
    { ...soilMetadata(), sampleDepthToM: 0 },
    { ...soilMetadata(), sampleDepthToM: Infinity },
    { ...soilMetadata(), sampleDepthFromM: '0' },
    { ...soilMetadata(), sampleDepthToM: 10001 },
    { ...soilMetadata(), boreholeId: 'A'.repeat(129) },
    { ...soilMetadata(), verified: true },
  ]) assert.throws(() => saveInvestigationMetadata(fresh(), 'soil', invalid, source));
  const absent = soilMetadata(); delete absent.notes;
  assert.throws(() => saveInvestigationMetadata(fresh(), 'soil', absent, source));
  assert.throws(() => captureInvestigation(fresh(), 'other', source));
  assert.throws(() => saveInvestigationMetadata(fresh(), 'water', soilMetadata(), source));
});

test('invalid or orphan station/alternative bindings and cached approvals are rejected on import', () => {
  const original = save(capture(withInputs(), 'soil'));
  const changes = [
    value => { value.stationInvestigations['r9-row999'] = copy(value.stationInvestigations[first]); },
    value => { value.stationInvestigations[first].alternatives.absent = copy(value.stationInvestigations[first].current); },
    value => { value.stationInvestigations[first].current.soil.binding.stationId = second; },
    value => { value.stationInvestigations[first].current.soil.binding.values.factorOfSafety = 10; },
    value => { value.stationInvestigations[first].current.soil.metadata.verified = true; },
    value => { value.stationInvestigations[first].current.soil.binding.values['soilInputs.mode'] = 'unknown'; },
    value => { value.stationInvestigations[first].current.soil.binding.values['geometry.slopeH'] = 0; },
    value => { value.stationInvestigations[first].current.soil.binding.recordedAt = '2026-02-30T00:00:00.000Z'; },
  ];
  for (const change of changes) {
    const invalid = copy(original); change(invalid);
    assert.equal(validateProject(invalid, source).valid, false);
    assert.throws(() => parseProject(JSON.stringify(invalid), source));
  }
  assert.throws(() => buildInvestigationReview(original, source, 'r9-row999'));
  assert.throws(() => getStationInvestigations(original, first, 'missing-option'));
});

test('getters, prototypes, cycles and shared objects cannot execute or hide evidence data', () => {
  let calls = 0;
  const metadata = soilMetadata(); Object.defineProperty(metadata, 'locator', { enumerable: true, get() { calls++; return 'unsafe'; } });
  assert.throws(() => saveInvestigationMetadata(fresh(), 'soil', metadata, source));
  const unsafeProject = fresh(); Object.defineProperty(unsafeProject, 'selectedStationId', { enumerable: true, get() { calls++; return first; } });
  assert.throws(() => getStationInvestigations(unsafeProject));
  assert.throws(() => buildInvestigationReview(unsafeProject, source));
  const options = {}; Object.defineProperty(options, 'createdAt', { enumerable: true, get() { calls++; return createdAt; } });
  assert.throws(() => captureInvestigation(fresh(), 'soil', source, options));
  assert.equal(calls, 0);
  const original = capture(withInputs(), 'soil');
  const shared = copy(original); shared.stationInvestigations[first].current.soil.binding.metadata = shared.stationInvestigations[first].current.soil.metadata;
  assert.equal(validateProject(shared, source).valid, false);
  const reserved = JSON.parse(serializeProject(original, source));
  Object.defineProperty(reserved.stationInvestigations[first].current.soil.metadata, '__proto__', { enumerable: true, value: {} });
  assert.equal(validateProject(reserved, source).valid, false);
  const cycle = copy(original); cycle.stationInvestigations[first].current.soil.metadata.notes = cycle;
  assert.equal(validateProject(cycle, source).valid, false);
  const hidden = soilMetadata(); Object.defineProperty(hidden, 'extra', { enumerable: false, value: 'hidden' });
  assert.throws(() => saveInvestigationMetadata(fresh(), 'soil', hidden, source));
});

test('capture rejects invalid timestamps/options and accepts exact ISO UTC with or without milliseconds', () => {
  for (const time of ['2026-02-30T00:00:00.000Z', '2026-11-22', '2026-11-22T00:00:00+07:00', 'invalid', null]) {
    assert.throws(() => captureInvestigation(fresh(), 'soil', source, { createdAt: time }));
  }
  assert.throws(() => captureInvestigation(fresh(), 'soil', source, { createdAt, approved: true }));
  const captured = captureInvestigation(fresh(), 'soil', source, { createdAt: '2026-11-22T01:00:00Z' });
  assert.equal(getStationInvestigations(captured).soil.binding.recordedAt, '2026-11-22T01:00:00Z');
});

test('CSV includes all captured/current fields, null versus zero, source text and scoped revision identities', () => {
  let project = capture(capture(withInputs(), 'soil'), 'water');
  project = updateActiveScenario(project, { context: { groundwaterLevel: null, waterReference: '=HYPERLINK("unsafe")' } }, source);
  project = saveInvestigationMetadata(project, 'soil', { ...soilMetadata(), notes: '<script>literal</script>\nsecond line' }, source);
  const review = buildInvestigationReview(project, source), csv = investigationCSV(review);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes(projectRevision(project)));
  assert.ok(csv.includes('"context.groundwaterLevel"'));
  assert.ok(csv.includes('"0","","true","true"'));
  assert.ok(csv.includes("'="));
  assert.ok(csv.includes('<script>literal</script>\nsecond line'));
  assert.ok(csv.includes('"soilInputs.mode"'));
  assert.ok(csv.includes('"context.boreholeReference"'));
  assert.ok(csv.includes('"metadata","applicabilityNote"'));
  const expectedRows = INVESTIGATION_VALUE_FIELDS.soil.length + INVESTIGATION_VALUE_FIELDS.water.length + INVESTIGATION_METADATA_FIELDS.soil.length + INVESTIGATION_METADATA_FIELDS.water.length;
  assert.equal(csv.split('"S6006-INVESTIGATIONS-1"').length - 1, expectedRows);
});

test('size limits apply to legitimate large evidence graphs as well as oversized serialized imports', () => {
  let project = withInputs();
  for (const kind of ['soil', 'water']) {
    const metadata = kind === 'soil' ? soilMetadata() : waterMetadata();
    for (const item of INVESTIGATION_METADATA_FIELDS[kind]) if (item.type === 'text') metadata[item.field] = 'ก'.repeat(item.maxLength);
    project = capture(project, kind, metadata);
  }
  const full = copy(project), entry = copy(project.stationInvestigations[first]);
  for (const station of stations) {
    full.stationInvestigations[station.id] = copy(entry);
    for (const kind of ['soil', 'water']) full.stationInvestigations[station.id].current[kind].binding.stationId = station.id;
  }
  assert.ok(new TextEncoder().encode(JSON.stringify(full)).byteLength > PROJECT_MAX_BYTES);
  assert.equal(validateProject(full, source).valid, false);
  assert.throws(() => serializeProject(full, source));
  assert.throws(() => parseProject(JSON.stringify(full), source), /1 MiB/);
});

test('batch review preserves exact single-entry output, caller order and independent data copies', () => {
  let project = save(capture(capture(withInputs(), 'soil'), 'water'));
  project = saveInvestigationMetadata(project, 'soil', { ...soilMetadata(), locator: 'Changed page' }, source);
  project = selectStation(project, second, source);
  project = capture(withInputs(project), 'water');
  const entries = [
    { stationId: first, scenarioId: 'option-a' },
    { stationId: second, scenarioId: 'current' },
    { stationId: first, scenarioId: 'current' },
  ];
  const batch = buildInvestigationReviews(project, source, entries);
  assert.deepEqual(batch, entries.map(entry => buildInvestigationReview(project, source, entry.stationId, entry.scenarioId)));
  assert.deepEqual(batch.map(record => record.station.id + '/' + record.scenarioId), entries.map(entry => entry.stationId + '/' + entry.scenarioId));
  assert.equal(batch[0].groups[0].state, 'current');
  assert.equal(batch[1].groups[0].state, 'missing');
  assert.equal(batch[2].groups[0].state, 'stale');
  batch[0].groups[0].metadata.locator = 'caller mutation';
  assert.equal(getStationInvestigations(project, first, 'option-a').soil.metadata.locator, 'Page 12 / sample 2');
  assert.equal(batch[2].groups[0].metadata.locator, 'Changed page');
  assert.deepEqual(buildInvestigationReviews(fresh(), source, [{ stationId: first, scenarioId: 'current' }]), [buildInvestigationReview(fresh(), source)]);
});

test('batch review rejects duplicate, unknown, malformed and accessor scopes without executing getters', () => {
  const project = save(capture(withInputs(), 'soil'));
  const item = { stationId: first, scenarioId: 'current' };
  for (const scope of [
    [], undefined, null, {}, [copy(item), copy(item)],
    [{ stationId: 'r9-row999', scenarioId: 'current' }],
    [{ stationId: first, scenarioId: 'missing-option' }],
    [{ stationId: first }], [{ ...item, extra: true }], [null],
    [{ stationId: first, scenarioId: 1 }],
  ]) assert.throws(() => buildInvestigationReviews(project, source, scope));
  let called = 0;
  const getter = copy(item); Object.defineProperty(getter, 'stationId', { enumerable: true, get() { called++; return first; } });
  assert.throws(() => buildInvestigationReviews(project, source, [getter]));
  const hidden = copy(item); Object.defineProperty(hidden, 'hidden', { value: 'hidden', enumerable: false });
  assert.throws(() => buildInvestigationReviews(project, source, [hidden]));
  const sparse = []; sparse[1] = copy(item);
  assert.throws(() => buildInvestigationReviews(project, source, sparse));
  const extra = [copy(item)]; extra.note = 'extra';
  assert.throws(() => buildInvestigationReviews(project, source, extra));
  assert.equal(called, 0);
});
