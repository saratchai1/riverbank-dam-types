import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROJECT_VERSION, PROJECT_MAX_BYTES, MAX_STATION_ALTERNATIVES,
  createProject, createDefaultScenario, stationCatalog, getActiveScenario, getScenario,
  getSoilInputs, getStationComparison, saveAlternative, removeAlternative,
  setComparisonReference, applyAlternative, updateActiveScenario, selectStation,
  validateProject, serializeProject, parseProject, projectRevision, scenarioRevision,
} from '../projects/s6006/project.js';
import { calculateBeam, calculateSoil } from '../projects/s6006/engineering.js';
import {
  saveWorkingProject, saveReportSnapshot, loadReportProject, REPORT_SNAPSHOT_PREFIX,
} from '../projects/s6006/project-storage.js';

const source = JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json', import.meta.url), 'utf8'));
const catalog = stationCatalog(source), first = catalog[0].id, last = catalog.at(-1).id;
const copy = value => JSON.parse(JSON.stringify(value));
const createdAt = '2026-11-21T12:00:00.000Z';
const save = (project, id = 'alt-baseline-001', name = 'ทางเลือกเริ่มต้น') =>
  saveAlternative(project, name, source, { id, createdAt });
const fresh = () => createProject(source);
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const originalV1 = () => ({
  schema: 'riverbank.s6006.project', version: 1, calculationRevision: 'S6006-R2',
  projectCode: 'S6006', selectedStationId: first, stationScenarios: {},
});

function issuedV1() {
  let project = updateActiveScenario(originalV1(), {
    geometry: { slopeH: 3 }, beamInputs: { externalMuKnM: 30 }, soilInputs: { frictionAngleDeg: 34 },
    context: { waterHighLevel: 99.1, waterReference: 'Trial datum', sourceNote: 'Issued v1 scenario' },
  }, source);
  project = selectStation(project, last, source);
  return updateActiveScenario(project, {
    geometry: { length: 150 }, soilInputs: { mode: 'undrained', undrainedStrengthKpa: null },
  }, source);
}

test('new v2 projects start with no saved alternatives or inferred reference scenario', () => {
  const project = fresh(), empty = getStationComparison(project);
  assert.equal(PROJECT_VERSION, 2);
  assert.equal(project.version, 2);
  assert.equal(MAX_STATION_ALTERNATIVES, 3);
  assert.deepEqual(project.stationComparisons, {});
  assert.deepEqual(empty, { referenceId: null, alternatives: [] });
  empty.alternatives.push({ name: 'outside edit' });
  assert.deepEqual(getStationComparison(project, last), { referenceId: null, alternatives: [] });
  assert.equal(validateProject(project, source).valid, true);
});

test('capture names and timestamps a complete scenario without cached results or mutation', () => {
  const originalSource = JSON.stringify(source);
  const project = updateActiveScenario(fresh(), {
    geometry: { length: 150, slopeH: 3 },
    beamInputs: { externalMuKnM: 30 },
    soilInputs: { frictionAngleDeg: 35 },
    context: { waterHighLevel: 99.1, waterReference: 'Trial datum', boreholeReference: 'BH trial', sourceNote: 'Trial geometry' },
  }, source);
  const originalText = serializeProject(project, source), scenario = getActiveScenario(project);
  const captured = save(project, 'alt-baseline-001', '  รูปตัดทดลอง  ');
  const comparison = getStationComparison(captured), alternative = comparison.alternatives[0];
  assert.equal(comparison.referenceId, alternative.id);
  assert.deepEqual(alternative, { id: 'alt-baseline-001', name: 'รูปตัดทดลอง', createdAt, scenario });
  assert.equal('slopeH' in alternative.scenario.soilInputs, false);
  assert.equal(getSoilInputs(alternative.scenario).slopeH, 3);
  assert.equal('beamResults' in alternative, false);
  assert.equal('soilResults' in alternative.scenario, false);
  assert.equal('projectApproved' in alternative, false);
  assert.deepEqual(getActiveScenario(captured), scenario);
  assert.equal(serializeProject(project, source), originalText);
  assert.equal(JSON.stringify(source), originalSource);
  const generated = saveAlternative(fresh(), 'ชื่ออัตโนมัติ', source);
  const generatedAlternative = getStationComparison(generated).alternatives[0];
  assert.match(generatedAlternative.id, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
  assert.equal(new Date(generatedAlternative.createdAt).toISOString(), generatedAlternative.createdAt);
});

test('saved alternatives and all getters remain independent of later working edits and caller mutation', () => {
  const project = updateActiveScenario(fresh(), { geometry: { slopeH: 3 }, context: { sourceNote: 'captured' } }, source);
  const captured = save(project), originalSnapshot = copy(getStationComparison(captured));
  project.stationScenarios[first].geometry.slopeH = 8;
  project.stationScenarios[first].context.sourceNote = 'mutated old argument';
  const edited = updateActiveScenario(captured, { geometry: { slopeH: 4 }, context: { sourceNote: 'working edit' } }, source);
  const returned = getStationComparison(edited);
  returned.referenceId = 'outside';
  returned.alternatives[0].name = 'outside';
  returned.alternatives[0].scenario.geometry.slopeH = 10;
  returned.alternatives[0].scenario.context.sourceNote = 'outside';
  returned.alternatives.pop();
  assert.deepEqual(getStationComparison(captured), originalSnapshot);
  assert.deepEqual(getStationComparison(edited), originalSnapshot);
  assert.equal(getActiveScenario(captured).geometry.slopeH, 3);
  assert.equal(getActiveScenario(edited).geometry.slopeH, 4);
  assert.notEqual(projectRevision(captured), projectRevision(edited));
});

test('each BOQ station owns independent working inputs, snapshots and reference selection', () => {
  let project = save(updateActiveScenario(fresh(), { geometry: { slopeH: 3 } }, source), 'alt-common-id');
  const firstComparison = getStationComparison(project), firstScenario = getActiveScenario(project);
  project = selectStation(project, last, source);
  assert.deepEqual(getStationComparison(project), { referenceId: null, alternatives: [] });
  assert.throws(() => applyAlternative(project, 'alt-common-id', source), /สถานี/);
  project = save(updateActiveScenario(project, { geometry: { slopeH: 4 } }, source), 'alt-common-id');
  project = save(project, 'alt-second-id');
  project = setComparisonReference(project, 'alt-second-id', source);
  assert.deepEqual(getStationComparison(project, first), firstComparison);
  assert.deepEqual(getScenario(project, first), firstScenario);
  assert.equal(getStationComparison(project).referenceId, 'alt-second-id');
  project = removeAlternative(project, 'alt-common-id', source);
  assert.deepEqual(getStationComparison(project, first), firstComparison);
  assert.equal(getStationComparison(project).alternatives.length, 1);
});

test('one project JSON roundtrip preserves all station alternatives, metadata, selection and working state', () => {
  let project = save(updateActiveScenario(fresh(), {
    geometry: { slopeH: 3 }, context: { sourceNote: 'ต้นทาง <script>text only</script>' },
  }, source));
  project = save(updateActiveScenario(project, { beamInputs: { tensionBarDiameterMm: 16, stirrupDiameterMm: 8, externalMuKnM: 30 } }, source), 'alt-rebar-002', 'เปลี่ยนเหล็ก');
  project = setComparisonReference(project, 'alt-rebar-002', source);
  project = selectStation(project, last, source);
  project = save(updateActiveScenario(project, { soilInputs: { mode: 'undrained', undrainedStrengthKpa: null } }, source), 'alt-soil-003', 'รอผล Su');
  project = updateActiveScenario(project, { context: { waterLowLevel: 87.4, waterReference: 'User datum' } }, source);
  const text = serializeProject(project, source), restored = parseProject(text, source);
  assert.deepEqual(restored, { project, migrated: false, notices: [] });
  assert.equal(restored.project.selectedStationId, last);
  assert.equal(getStationComparison(restored.project, first).referenceId, 'alt-rebar-002');
  assert.equal(getStationComparison(restored.project).alternatives[0].scenario.context.waterLowLevel, null);
  assert.equal(getActiveScenario(restored.project).context.waterLowLevel, 87.4);
  assert.equal(projectRevision(restored.project), projectRevision(project));
  assert.equal(serializeProject(restored.project, source), text);
});

test('at most three alternatives may be saved per station and collisions never overwrite a snapshot', () => {
  let project = save(fresh(), 'alt-first');
  const firstText = serializeProject(project, source);
  assert.throws(() => save(project, 'alt-first', 'replacement'), /รหัสนี้/);
  assert.equal(serializeProject(project, source), firstText);
  project = save(project, 'alt-second');
  project = save(project, 'alt-third');
  const full = serializeProject(project, source);
  assert.throws(() => save(project, 'alt-fourth'), /3/);
  assert.equal(serializeProject(project, source), full);
  project = removeAlternative(project, 'alt-second', source);
  project = save(project, 'alt-fourth');
  assert.deepEqual(getStationComparison(project).alternatives.map(item => item.id), ['alt-first', 'alt-third', 'alt-fourth']);
  const nextStation = save(selectStation(project, last, source), 'alt-fourth');
  assert.equal(getStationComparison(nextStation).alternatives.length, 1);
});

test('reference selection and removal are deterministic without changing working inputs', () => {
  let project = save(save(save(fresh(), 'alt-first'), 'alt-second'), 'alt-third');
  const scenario = getActiveScenario(project), original = copy(getStationComparison(project));
  project = setComparisonReference(project, 'alt-third', source);
  assert.equal(getStationComparison(project).referenceId, 'alt-third');
  project = removeAlternative(project, 'alt-second', source);
  assert.equal(getStationComparison(project).referenceId, 'alt-third');
  project = removeAlternative(project, 'alt-third', source);
  assert.equal(getStationComparison(project).referenceId, 'alt-first');
  assert.deepEqual(getStationComparison(project).alternatives, [original.alternatives[0]]);
  project = removeAlternative(project, 'alt-first', source);
  assert.deepEqual(getStationComparison(project), { referenceId: null, alternatives: [] });
  assert.equal(first in project.stationComparisons, false);
  assert.deepEqual(getActiveScenario(project), scenario);
  for (const action of [removeAlternative, setComparisonReference, applyAlternative]) {
    assert.throws(() => action(project, 'alt-first', source), /สถานี/);
    assert.throws(() => action(project, null, source), /รหัส/);
  }
});

test('applying a saved alternative restores all input sections with shared slope but does not alter snapshots', () => {
  let project = save(fresh(), 'alt-default');
  project = updateActiveScenario(project, {
    geometry: { length: 150, slopeH: 3 },
    beamInputs: { tensionBarDiameterMm: 16, stirrupDiameterMm: 8, externalMuKnM: 30 },
    soilInputs: { frictionAngleDeg: 35 },
    context: { waterHighLevel: 99, waterLowLevel: 87, waterReference: 'Trial datum', boreholeReference: 'Trial BH' },
  }, source);
  project = save(project, 'alt-edited');
  const expected = getActiveScenario(project), snapshots = getStationComparison(project);
  project = updateActiveScenario(project, { geometry: { slopeH: 4 }, context: { waterReference: 'later' } }, source);
  const applied = applyAlternative(project, 'alt-edited', source);
  assert.deepEqual(getActiveScenario(applied), expected);
  assert.deepEqual(getStationComparison(applied), snapshots);
  assert.equal(getSoilInputs(getActiveScenario(applied)).slopeH, 3);
  assert.equal(getActiveScenario(project).geometry.slopeH, 4);
  const baseline = applyAlternative(applied, 'alt-default', source);
  assert.deepEqual(getActiveScenario(baseline), createDefaultScenario());
  assert.equal(first in baseline.stationScenarios, false);
  assert.deepEqual(getStationComparison(baseline), snapshots);
});

test('capture and apply preserve R2 minimum-steel gating and unknown Su without introducing engineering results', () => {
  let project = updateActiveScenario(fresh(), {
    geometry: { slopeH: 3 }, beamInputs: { externalMuKnM: 30 },
    soilInputs: { mode: 'undrained', undrainedStrengthKpa: null },
    context: { waterHighLevel: 99, groundwaterLevel: 95, waterReference: 'Context only' },
  }, source);
  project = save(project, 'alt-pending-su');
  project = updateActiveScenario(project, { beamInputs: { tensionBarDiameterMm: 16, stirrupDiameterMm: 8 }, soilInputs: { undrainedStrengthKpa: 30 } }, source);
  project = applyAlternative(parseProject(serializeProject(project, source), source).project, 'alt-pending-su', source);
  const scenario = getActiveScenario(project), beam = calculateBeam(scenario.beamInputs);
  assert.equal(beam.usablePhiMnKnM, null);
  assert.equal(beam.externalDemand.momentUtilization, null);
  assert.equal(beam.projectApproved, false);
  assert.equal(getSoilInputs(scenario).slopeH, 3);
  assert.equal(scenario.soilInputs.undrainedStrengthKpa, null);
  assert.throws(() => calculateSoil(getSoilInputs(scenario)), /Su/);
  assert.match(validateProject(project, source).warnings.join(' '), /Su/);
});

test('revision includes alternative snapshots, names, timestamps and reference choice but excludes station selection', () => {
  const project = save(save(fresh(), 'alt-first'), 'alt-second');
  const revision = projectRevision(project), scenario = scenarioRevision(getActiveScenario(project));
  assert.equal(projectRevision(selectStation(project, last, source)), revision);
  assert.equal(scenarioRevision(getActiveScenario(project)), scenario);
  assert.notEqual(projectRevision(setComparisonReference(project, 'alt-second', source)), revision);
  for (const mutate of [
    alternative => { alternative.name = 'renamed in imported file'; },
    alternative => { alternative.createdAt = '2026-11-22T12:00:00.000Z'; },
    alternative => { alternative.scenario.geometry.slopeH = 3; },
    alternative => { alternative.scenario.context.sourceNote = 'new evidence'; },
  ]) {
    const changed = copy(project);
    mutate(changed.stationComparisons[first].alternatives[0]);
    assert.equal(validateProject(changed, source).valid, true);
    assert.notEqual(projectRevision(changed), revision);
    assert.equal(scenarioRevision(getActiveScenario(changed)), scenario);
  }
  const explicitEmpty = copy(project);
  explicitEmpty.stationComparisons[last] = { referenceId: null, alternatives: [] };
  const reordered = Object.fromEntries(Object.entries(explicitEmpty).reverse());
  assert.equal(projectRevision(reordered), revision);
  assert.equal(serializeProject(reordered, source), serializeProject(project, source));
});

test('native v1 keeps exact original baseline and edited revision values without migration', () => {
  const baseline = originalV1(), edited = issuedV1();
  // Golden values were captured from project.js v1 before introducing alternatives.
  assert.equal(projectRevision(baseline), 's6006p-30d0acd78fa4ab75');
  assert.equal(scenarioRevision(getActiveScenario(baseline)), 's6006s-46819e1877942dbc');
  assert.equal(serializeProject(baseline, source), JSON.stringify(baseline, null, 2) + '\n');
  assert.equal(projectRevision(edited), 's6006p-51d786fc5c50feca');
  assert.equal(scenarioRevision(getActiveScenario(edited)), 's6006s-95ae20b4ca8d32aa');
  for (const project of [baseline, edited]) {
    const parsed = parseProject(serializeProject(project, source), source);
    assert.deepEqual(parsed, { project, migrated: false, notices: [] });
    assert.equal(parsed.project.version, 1);
    assert.equal('stationComparisons' in parsed.project, false);
    assert.deepEqual(getStationComparison(parsed.project), { referenceId: null, alternatives: [] });
  }
  assert.equal(updateActiveScenario(baseline, { geometry: { slopeH: 3 } }, source).version, 1);
  assert.equal(selectStation(baseline, last, source).version, 1);
});

test('first v1 capture upgrades only its returned copy and previously issued report envelopes still load unchanged', () => {
  const project = issuedV1(), storage = memory(), id = 'issued-v1-report-001';
  const key = REPORT_SNAPSHOT_PREFIX + id;
  const envelope = {
    schema: 'riverbank.s6006.report-snapshot', version: 1, id, createdAt,
    revision: 's6006p-51d786fc5c50feca', scenarioRevision: 's6006s-95ae20b4ca8d32aa',
    selectedStationId: last, project,
  };
  const oldBytes = JSON.stringify(envelope);
  storage.setItem(key, oldBytes);
  const loadOld = () => loadReportProject({ source, storage, search: '?snapshot=' + id });
  assert.deepEqual(loadOld().project, project);
  const upgraded = save(loadOld().project, 'alt-upgrade');
  assert.equal(upgraded.version, 2);
  assert.equal(project.version, 1);
  assert.equal('stationComparisons' in project, false);
  assert.deepEqual(upgraded.stationScenarios, project.stationScenarios);
  assert.equal(upgraded.selectedStationId, project.selectedStationId);
  saveWorkingProject(upgraded, source, storage);
  saveReportSnapshot(upgraded, source, storage, { id: 'new-v2-report-001', createdAt });
  assert.equal(storage.getItem(key), oldBytes);
  assert.equal(projectRevision(loadOld().project), envelope.revision);
  const newReport = loadReportProject({ source, storage, search: '?snapshot=new-v2-report-001' });
  assert.deepEqual(newReport.project, upgraded);
  assert.deepEqual(getStationComparison(newReport.project), getStationComparison(upgraded));
});

test('capture rejects invalid names, reserved IDs, invalid timestamps and unknown options atomically', () => {
  const project = save(fresh()), before = serializeProject(project, source);
  for (const name of ['', '  \n ', 'x'.repeat(49), null, 123, {}]) {
    assert.throws(() => saveAlternative(project, name, source, { id: 'alt-new', createdAt }));
  }
  assert.equal(getStationComparison(save(project, 'alt-long-name', 'x'.repeat(48))).alternatives.at(-1).name.length, 48);
  for (const id of ['', 'current', 'current\n', 'abc\n', '__proto__', 'prototype', 'constructor', '../bad', '-start', 'bad id', 'x'.repeat(81), null, 123]) {
    assert.throws(() => saveAlternative(project, 'valid name', source, { id, createdAt }));
  }
  for (const timestamp of ['', '2026', '2026-11-21', '2026-02-30T12:00:00.000Z', '2026-11-21T24:00:00.000Z', '2026-11-21T12:60:00.000Z', null, 123]) {
    assert.throws(() => saveAlternative(project, 'valid name', source, { id: 'alt-new', createdAt: timestamp }));
  }
  assert.throws(() => saveAlternative(project, 'name', source, { id: 'alt-new', createdAt, cachedResults: {} }));
  assert.throws(() => saveAlternative(project, 'name', source, null));
  const leap = saveAlternative(project, 'leap date', source, { id: 'alt-leap', createdAt: '2024-02-29T12:00:00Z' });
  assert.equal(getStationComparison(leap).alternatives.at(-1).createdAt, '2024-02-29T12:00:00Z');
  assert.equal(serializeProject(project, source), before);
});

test('strict imports reject malformed and hidden inactive comparisons, stale references and cached result claims', () => {
  const project = save(fresh()), before = serializeProject(project, source);
  const mutations = [
    p => { p.stationComparisons = []; },
    p => { p.stationComparisons[last] = null; },
    p => { p.stationComparisons['r9-row999'] = copy(p.stationComparisons[first]); },
    p => { p.stationComparisons[first].referenceId = null; },
    p => { p.stationComparisons[first].referenceId = 'missing'; },
    p => { p.stationComparisons[first].referenceId = 1; },
    p => { p.stationComparisons[first].alternatives = []; },
    p => { p.stationComparisons[first].extra = true; },
    p => { p.stationComparisons[first].alternatives.push(copy(p.stationComparisons[first].alternatives[0])); },
    p => { const a = p.stationComparisons[first].alternatives[0]; p.stationComparisons[first].alternatives = Array.from({ length: 4 }, (_, i) => ({ ...copy(a), id: 'alt-' + i })); },
    p => { p.stationComparisons[first].alternatives[0].beamResults = { usablePhiMnKnM: 999 }; },
    p => { p.stationComparisons[first].alternatives[0].scenario.projectApproved = true; },
    p => { p.stationComparisons[first].alternatives[0].scenario.soilInputs.slopeH = 3; },
    p => { p.stationComparisons[first].alternatives[0].scenario.beamInputs.externalMuKnM = '30'; },
    p => { p.stationComparisons[first].alternatives[0].scenario.geometry.slopeH = 0; },
    p => { p.stationComparisons[first].alternatives[0].scenario.context.waterHighLevel = -1; p.stationComparisons[first].alternatives[0].scenario.context.waterLowLevel = 1; },
    p => { p.stationComparisons[first].alternatives[0].name = ' untrimmed '; },
    p => { p.stationComparisons[first].alternatives[0].createdAt = '2026-02-30T12:00:00Z'; },
    p => { p.stationComparisons[first].alternatives[0].id = 'current'; p.stationComparisons[first].referenceId = 'current'; },
    p => { delete p.stationComparisons[first].alternatives[0].createdAt; },
    p => { delete p.stationComparisons; },
    p => { p.version = 1; },
  ];
  for (const mutate of mutations) {
    const bad = copy(project);
    mutate(bad);
    assert.equal(validateProject(bad, source).valid, false);
    assert.throws(() => parseProject(JSON.stringify(bad), source));
  }
  assert.equal(serializeProject(project, source), before);
});

test('alternative entry points reject accessors, prototype pollution, shared references and non-JSON arrays without invoking them', () => {
  let invoked = 0;
  const project = save(fresh()), getter = () => { invoked++; return 'injected'; };
  const selectedAccessor = copy(project);
  Object.defineProperty(selectedAccessor, 'selectedStationId', { enumerable: true, get: getter });
  assert.throws(() => getStationComparison(selectedAccessor));
  const nestedAccessor = copy(project);
  Object.defineProperty(nestedAccessor.stationComparisons[first].alternatives[0], 'scenario', { enumerable: true, get: getter });
  assert.equal(validateProject(nestedAccessor, source).valid, false);
  assert.throws(() => getStationComparison(nestedAccessor));
  assert.throws(() => projectRevision(nestedAccessor));
  for (const action of [removeAlternative, setComparisonReference, applyAlternative]) {
    assert.throws(() => action(nestedAccessor, 'alt-baseline-001', source));
  }
  const options = { createdAt };
  Object.defineProperty(options, 'id', { enumerable: true, get: getter });
  assert.throws(() => saveAlternative(project, 'safe', source, options));
  const badPrototype = copy(project);
  Object.setPrototypeOf(badPrototype.stationComparisons[first].alternatives[0], { dangerous: true });
  assert.equal(validateProject(badPrototype, source).valid, false);
  const sparse = copy(project);
  sparse.stationComparisons[first].alternatives.length = 2;
  assert.equal(validateProject(sparse, source).valid, false);
  const extraArrayField = copy(project);
  extraArrayField.stationComparisons[first].alternatives.note = 'would vanish in JSON';
  assert.equal(validateProject(extraArrayField, source).valid, false);
  const shared = copy(project);
  shared.stationScenarios[first] = shared.stationComparisons[first].alternatives[0].scenario;
  assert.equal(validateProject(shared, source).valid, false);
  const pollutedText = JSON.stringify(project).replace('"name":"ทางเลือกเริ่มต้น"', '"name":"ทางเลือกเริ่มต้น","__proto__":{"polluted":true}');
  assert.throws(() => parseProject(pollutedText, source));
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(invoked, 0);
});

test('all 41 BOQ stations can persist three alternatives plus working inputs within existing data bounds', () => {
  const project = fresh();
  for (const row of catalog) {
    const current = createDefaultScenario();
    current.context.sourceNote = `working ${row.id}`;
    project.stationScenarios[row.id] = current;
    const alternatives = Array.from({ length: 3 }, (_, index) => {
      const scenario = createDefaultScenario();
      scenario.geometry.slopeH = 2.5 + index;
      scenario.context.sourceNote = `saved ${row.id} ${index}`;
      return { id: `alt-${index}`, name: `ทางเลือก ${index + 1}`, createdAt, scenario };
    });
    project.stationComparisons[row.id] = { referenceId: 'alt-0', alternatives };
  }
  project.selectedStationId = last;
  const validation = validateProject(project, source);
  assert.deepEqual(validation.errors, []);
  const text = serializeProject(project, source), restored = parseProject(text, source).project;
  assert.ok(new TextEncoder().encode(text).byteLength < PROJECT_MAX_BYTES);
  assert.equal(Object.keys(restored.stationComparisons).length, 41);
  assert.equal(Object.values(restored.stationComparisons).reduce((sum, value) => sum + value.alternatives.length, 0), 123);
  assert.deepEqual(restored, project);
  assert.equal(projectRevision(restored), projectRevision(project));
  const oversized = copy(project);
  for (const comparison of Object.values(oversized.stationComparisons)) {
    for (const alternative of comparison.alternatives) {
      for (const key of ['sourceNote', 'waterReference', 'boreholeReference']) alternative.scenario.context[key] = 'ก'.repeat(2000);
    }
  }
  assert.equal(validateProject(oversized, source).valid, false);
  assert.throws(() => serializeProject(oversized, source), /1 MiB/);
  assert.throws(() => parseProject(JSON.stringify(oversized), source), /1 MiB/);
});
