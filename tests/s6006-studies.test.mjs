import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createProject, stationCatalog, getActiveScenario, serializeProject, projectRevision,
  updateActiveScenario, selectStation, saveAlternative, removeAlternative,
} from '../projects/s6006/project.js';
import {
  DEFAULT_SOIL_INVESTIGATION_METADATA, saveInvestigationMetadata, captureInvestigation,
} from '../projects/s6006/investigations.js';
import {
  STUDY_METHOD_REVISION, STUDY_PARAMETERS, STUDY_METRICS,
  studyOptions, studySourceRevision, buildStudy, studyCSV,
} from '../projects/s6006/studies.js';

const source = JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json', import.meta.url), 'utf8'));
const [first, second] = stationCatalog(source), fresh = () => createProject(source);
const copy = value => JSON.parse(JSON.stringify(value));
const selection = (scenarioId = 'current', stationId = first.id) => ({ stationId, scenarioId });
const config = (changes = {}) => ({ ...selection(), parameterId: 'geometry.slopeH', minimum: 1, maximum: 4, sampleCount: 7, ...changes });
const build = (project = fresh(), changes = {}) => buildStudy(project, source, config(changes));
const changedPaths = (a, b, prefix = '') => Object.keys(a).flatMap(key => {
  const path = prefix ? prefix + '.' + key : key;
  return a[key] !== null && typeof a[key] === 'object' ? changedPaths(a[key], b[key], path) : a[key] === b[key] ? [] : [path];
});
const save = (project, id = 'option-a', name = 'Option A') => saveAlternative(project, name, source, { id, createdAt: '2026-11-22T03:00:00.000Z' });
const metadata = (notes = 'Synthetic fixture only') => ({
  ...DEFAULT_SOIL_INVESTIGATION_METADATA, boreholeId: 'BH-1', locator: 'SYNTHETIC sample',
  sampleDepthFromM: 0, sampleDepthToM: 2, depthReference: 'SYNTHETIC ground',
  testMethod: 'SYNTHETIC method', parameterInterpretation: 'SYNTHETIC effective stress',
  applicabilityNote: 'SYNTHETIC relationship, not a field correlation', notes,
});

test('study registry is frozen, explicit about domains, and filters inactive-mode parameters', () => {
  assert.equal(STUDY_METHOD_REVISION, 'S6006-STUDIES-1');
  assert.equal(STUDY_PARAMETERS.length, 13);
  assert.equal(STUDY_METRICS.length, 12);
  assert.ok(Object.isFrozen(STUDY_PARAMETERS));
  assert.ok(Object.isFrozen(STUDY_PARAMETERS[0]));
  assert.ok(Object.isFrozen(STUDY_PARAMETERS[0].metricIds));
  assert.ok(Object.isFrozen(STUDY_METRICS[0].sourceKeys));
  const p = fresh(), before = serializeProject(p, source), options = studyOptions(p, source, selection());
  assert.equal(options.parameters.length, 12);
  assert.equal(options.parameters[0].id, 'geometry.slopeH');
  assert.equal(options.parameters[0].maximum, 20);
  assert.equal(options.parameters[0].minimum, 0.05);
  assert.equal(options.parameters[0].minimumInclusive, false);
  assert.equal(options.parameters[0].baselineValue, 2.5);
  assert.deepEqual(options.parameters[0].suggestedRange, { minimum: 2, maximum: 3, sampleCount: 9 });
  assert.equal(options.parameters.find(item => item.id === 'soilInputs.effectiveCohesionKpa').suggestedRange, null);
  assert.equal(options.parameters.some(item => item.id === 'soilInputs.undrainedStrengthKpa'), false);
  assert.equal(options.parameters[0].metricIds.includes('soil.undrained.fs'), false);
  assert.deepEqual(options.limits, { minimumSamples: 3, maximumSamples: 31 });
  options.parameters[0].metricIds.length = 0;
  options.selection.station.station = 999;
  assert.equal(studyOptions(p, source, selection()).parameters[0].metricIds.length, 5);
  assert.equal(serializeProject(p, source), before);
  const total = updateActiveScenario(p, { soilInputs: { mode: 'undrained' } }, source);
  const totalOptions = studyOptions(total, source, selection());
  assert.equal(totalOptions.parameters.length, 10);
  assert.deepEqual(totalOptions.parameters[0].metricIds, ['soil.undrained.fs', 'geometry.rockVolume', 'geometry.sandMinVolume', 'geometry.geotextileSlopeArea']);
  assert.equal(totalOptions.parameters.find(item => item.id === 'soilInputs.undrainedStrengthKpa').baselineValue, null);
  assert.equal(totalOptions.parameters.find(item => item.id === 'soilInputs.undrainedStrengthKpa').suggestedRange, null);
  assert.equal(totalOptions.parameters.some(item => item.id === 'soilInputs.unitWeightKnM3'), false);
});

test('one-at-a-time studies retain exact endpoints, separate baseline and all other inputs', () => {
  const project = fresh(), before = serializeProject(project, source), revision = projectRevision(project);
  for (const sampleCount of [3, 9, 31]) {
    const record = build(project, { minimum: 1.1, maximum: 3.7, sampleCount });
    assert.equal(record.baseline.id, 'baseline');
    assert.equal(record.baseline.x, 2.5);
    assert.equal(record.samples.length, sampleCount);
    assert.equal(record.samples[0].x, 1.1);
    assert.equal(record.samples.at(-1).x, 3.7);
    assert.equal(record.samples[0].id, 'sample-1');
    assert.equal(record.samples.at(-1).id, 'sample-' + sampleCount);
    assert.equal(record.calculationRevision, 'S6006-R2');
    assert.equal(record.projectRevision, revision);
    for (const point of record.samples) {
      assert.deepEqual(changedPaths(record.baseline.scenario, point.scenario), point.x === 2.5 ? [] : ['geometry.slopeH']);
      assert.equal(point.scenario.geometry.slopeH, point.x);
      assert.equal(point.scenario.context.groundwaterLevel, null);
      assert.equal(point.results.beam.projectApproved, false);
      assert.equal(point.results.soil.projectApproved, false);
    }
    assert.equal(serializeProject(project, source), before);
  }
});

test('study records are defensive copies including source, inputs, metadata and summaries', () => {
  let project = saveInvestigationMetadata(fresh(), 'soil', metadata(), source);
  project = save(project);
  const before = serializeProject(project, source), record = build(project, { scenarioId: 'option-a' });
  const same = build(project, { scenarioId: 'option-a' });
  assert.deepEqual(record, same);
  record.selection.station.sourceSheet = 'changed';
  record.baseline.scenario.geometry.slopeH = 18;
  record.samples[0].scenario.context.sourceNote = 'changed';
  record.parameter.metricIds.length = 0;
  record.baselineEvidence.groups[0].metadata.notes = 'changed';
  record.summaries['soil.dry.fs'].minimum.value = -100;
  assert.equal(serializeProject(project, source), before);
  assert.deepEqual(build(project, { scenarioId: 'option-a' }), same);
});

test('localized source freshness ignores unrelated stations, alternatives and selection changes', () => {
  let project = fresh();
  const revision = studySourceRevision(project, source, selection());
  const initial = build(project);
  project = selectStation(project, second.id, source);
  assert.equal(studySourceRevision(project, source, selection()), revision);
  project = updateActiveScenario(project, { context: { sourceNote: 'Other station' } }, source);
  project = save(project, 'other-station');
  project = saveInvestigationMetadata(project, 'soil', metadata('Other evidence'), source);
  assert.equal(studySourceRevision(project, source, selection()), revision);
  assert.notEqual(projectRevision(project), initial.projectRevision);
  const unrelated = build(project);
  assert.equal(unrelated.studyRevision, initial.studyRevision);
  assert.equal(unrelated.sourceRevision, initial.sourceRevision);
  assert.deepEqual(unrelated.samples, initial.samples);
  project = selectStation(project, first.id, source);
  project = save(project, 'same-station-other');
  assert.equal(studySourceRevision(project, source, selection()), revision);
  project = updateActiveScenario(project, { context: { sourceNote: 'Changed selected source' } }, source);
  assert.notEqual(studySourceRevision(project, source, selection()), revision);
});

test('selected evidence edits and captures affect freshness while saved sources stay frozen', () => {
  let project = updateActiveScenario(fresh(), { context: { boreholeReference: 'Synthetic reference' } }, source);
  const inputRevision = studySourceRevision(project, source, selection());
  project = saveInvestigationMetadata(project, 'soil', metadata(), source);
  const metadataRevision = studySourceRevision(project, source, selection());
  assert.notEqual(metadataRevision, inputRevision);
  project = captureInvestigation(project, 'soil', source, { createdAt: '2026-11-22T03:01:00.000Z' });
  const captured = studySourceRevision(project, source, selection());
  assert.notEqual(captured, metadataRevision);
  project = save(project);
  const savedRevision = studySourceRevision(project, source, selection('option-a'));
  const savedRecord = build(project, { scenarioId: 'option-a' });
  assert.equal(savedRecord.baselineEvidence.groups[0].state, 'current');
  assert.equal(savedRecord.selection.kind, 'saved');
  project = updateActiveScenario(project, { geometry: { slopeH: 3 } }, source);
  project = saveInvestigationMetadata(project, 'soil', metadata('New source notes'), source);
  assert.notEqual(studySourceRevision(project, source, selection()), captured);
  assert.equal(studySourceRevision(project, source, selection('option-a')), savedRevision);
  assert.deepEqual(build(project, { scenarioId: 'option-a' }).baseline, savedRecord.baseline);
  assert.equal('baselineEvidence' in savedRecord.samples[0], false);
  assert.ok(savedRecord.limitations.some(note => note.includes('ชุดฐานเท่านั้น')));
  project = removeAlternative(project, 'option-a', source);
  assert.throws(() => studySourceRevision(project, source, selection('option-a')), /ไม่พบทางเลือก/);
});

test('invalid beam trials remain explicit gaps without hiding unaffected soil and geometry', () => {
  const record = build(fresh(), { parameterId: 'beamInputs.heightMm', minimum: 500, maximum: 1000, sampleCount: 5 });
  assert.deepEqual(record.samples.map(point => point.x), [500, 625, 750, 875, 1000]);
  assert.deepEqual(record.samples.map(point => point.metrics['beam.usablePhiVnKn'].availability), ['computed', 'computed', 'invalid', 'invalid', 'invalid']);
  assert.equal(record.samples[2].results.beam, null);
  assert.equal(record.samples[2].scenarioRevision, null);
  assert.match(record.samples[2].errors.find(item => item.domain === 'beam').message, /คานลึก|D-region/);
  assert.equal(record.samples[2].metrics['beam.usablePhiMnKnM'].value, null);
  assert.equal(record.samples[2].metrics['beam.selfWeightMuKnM'].value, null);
  assert.equal(record.samples[2].metrics['soil.dry.fs'].availability, 'computed');
  assert.equal(record.samples[2].metrics['geometry.rockVolume'].availability, 'computed');
  assert.equal(record.summaries['beam.usablePhiVnKn'].computedCount, 2);
  assert.equal(record.summaries['beam.usablePhiVnKn'].invalidCount, 3);
  assert.equal(record.summaries['soil.dry.fs'].computedCount, 5);
});

test('soil density coupling and numerical underflow are invalid trial-domain results', () => {
  const density = build(fresh(), { parameterId: 'soilInputs.saturatedUnitWeightKnM3', minimum: 19, maximum: 21, sampleCount: 3 });
  assert.equal(density.samples[0].metrics['soil.dry.fs'].availability, 'invalid');
  assert.equal(density.samples[0].metrics['soil.parallel-seepage.fs'].value, null);
  assert.equal(density.samples[0].metrics['soil.undrained.fs'].availability, 'not-applicable');
  assert.equal(density.samples[0].metrics['beam.usablePhiVnKn'].availability, 'computed');
  assert.equal(density.samples[1].metrics['soil.dry.fs'].availability, 'computed');
  assert.match(density.samples[0].errors[0].message, /γsat/);
  const tiny = build(fresh(), { parameterId: 'soilInputs.verticalDepthM', minimum: Number.MIN_VALUE, maximum: 1e-300, sampleCount: 3 });
  assert.equal(tiny.samples[0].metrics['soil.dry.fs'].availability, 'invalid');
  assert.equal(tiny.samples[0].metrics['soil.dry.fs'].value, null);
  assert.equal(tiny.samples[0].scenarioRevision, null);
  assert.equal(tiny.samples[0].metrics['beam.selfWeightMuKnM'].availability, 'computed');
});

test('missing Su baseline stays absent while explicitly specified Su trials can compute', () => {
  const project = updateActiveScenario(fresh(), { soilInputs: { mode: 'undrained' } }, source);
  const record = build(project, { parameterId: 'soilInputs.undrainedStrengthKpa', minimum: 0, maximum: 60, sampleCount: 3 });
  assert.equal(record.baseline.x, null);
  assert.equal(record.baseline.scenario.soilInputs.undrainedStrengthKpa, null);
  assert.equal(record.baseline.results.soil, null);
  assert.equal(record.baseline.metrics['soil.undrained.fs'].availability, 'missing');
  assert.ok(record.baseline.scenarioRevision.startsWith('s6006s-'));
  assert.deepEqual(record.samples.map(point => point.scenario.soilInputs.undrainedStrengthKpa), [0, 30, 60]);
  assert.deepEqual(record.samples.map(point => point.metrics['soil.undrained.fs'].availability), ['computed', 'computed', 'computed']);
  assert.equal(record.samples[0].metrics['soil.undrained.fs'].value, 0);
  assert.equal(record.samples[0].metrics['soil.undrained.fs'].delta, null);
  assert.ok(record.samples.every(point => point.metrics['soil.undrained.fs'].deltaPercent === null));
  assert.equal(record.baseline.metrics['beam.usablePhiVnKn'].availability, 'computed');
  assert.equal(getActiveScenario(project).soilInputs.undrainedStrengthKpa, null);
  assert.equal(record.samples[1].results.soil.cases[0].porePressureKpa, null);
});

test('gated capacity, missing demand and zero demand remain distinct during studies', () => {
  const missing = build();
  assert.equal(missing.baseline.results.beam.phiMnKnM > 0, true);
  assert.equal(missing.baseline.metrics['beam.usablePhiMnKnM'].availability, 'gated');
  assert.equal(missing.baseline.metrics['beam.usablePhiMnKnM'].value, null);
  assert.equal(missing.baseline.metrics['beam.momentUtilization'].availability, 'missing');
  assert.equal(missing.baseline.metrics['beam.shearUtilization'].availability, 'missing');
  const zero = updateActiveScenario(fresh(), { beamInputs: { externalMuKnM: 0, externalVuKn: 0 } }, source);
  const zeroRecord = build(zero);
  assert.equal(zeroRecord.baseline.metrics['beam.momentUtilization'].availability, 'gated');
  assert.equal(zeroRecord.baseline.metrics['beam.shearUtilization'].availability, 'computed');
  assert.equal(zeroRecord.baseline.metrics['beam.shearUtilization'].value, 0);
  assert.equal(zeroRecord.baseline.metrics['beam.shearUtilization'].delta, 0);
  assert.equal(zeroRecord.baseline.metrics['beam.shearUtilization'].deltaPercent, null);
  assert.match(zeroRecord.baseline.metrics['beam.usablePhiVnKn'].reason, /φVc\/2/);
});

test('sample summaries exclude the baseline and preserve zero and ties without optimization claims', () => {
  const record = build(fresh(), { parameterId: 'soilInputs.frictionAngleDeg', minimum: 0, maximum: 10, sampleCount: 3 });
  assert.ok(record.baseline.metrics['soil.dry.fs'].value > record.summaries['soil.dry.fs'].maximum.value);
  assert.deepEqual(record.summaries['soil.dry.fs'].minimum, { value: 0, pointId: 'sample-1', x: 0 });
  assert.equal(record.summaries['soil.dry.fs'].maximum.pointId, 'sample-3');
  assert.equal(record.summaries['beam.selfWeightMuKnM'].minimum.pointId, 'sample-1');
  assert.equal(record.summaries['beam.selfWeightMuKnM'].maximum.pointId, 'sample-1');
  assert.equal(record.summaries['beam.usablePhiMnKnM'].minimum, null);
  assert.equal(record.summaries['beam.usablePhiMnKnM'].gatedCount, 3);
  assert.equal(record.summaries['soil.undrained.fs'].notApplicableCount, 3);
  assert.ok(record.limitations.some(note => note.includes('เฉพาะจุดที่ทดลอง')));
  const zeroSoil = updateActiveScenario(fresh(), { soilInputs: { frictionAngleDeg: 0 } }, source);
  const zeroRecord = build(zeroSoil, { parameterId: 'soilInputs.frictionAngleDeg', minimum: 0, maximum: 10, sampleCount: 3 });
  assert.equal(zeroRecord.baseline.metrics['soil.dry.fs'].value, 0);
  assert.equal(zeroRecord.baseline.metrics['soil.dry.fs'].delta, 0);
  assert.equal(zeroRecord.samples[2].metrics['soil.dry.fs'].delta, zeroRecord.samples[2].metrics['soil.dry.fs'].value);
  assert.equal(zeroRecord.samples[2].metrics['soil.dry.fs'].deltaPercent, null);
});

test('span trials keep actual design demands and governed capacities fixed', () => {
  const project = updateActiveScenario(fresh(), { beamInputs: {
    tensionBarDiameterMm: 16, stirrupDiameterMm: 8, externalMuKnM: 30, externalVuKn: 50,
  } }, source);
  const record = build(project, { parameterId: 'beamInputs.spanM', minimum: 2.5, maximum: 3.5, sampleCount: 3 });
  assert.deepEqual(record.parameter.metricIds, ['beam.selfWeightMuKnM', 'beam.selfWeightVuKn']);
  for (const point of record.samples) {
    assert.equal(point.results.beam.externalDemand.MuKnM, 30);
    assert.equal(point.results.beam.externalDemand.VuKn, 50);
    assert.equal(point.metrics['beam.momentUtilization'].value, record.baseline.metrics['beam.momentUtilization'].value);
    assert.equal(point.metrics['beam.shearUtilization'].value, record.baseline.metrics['beam.shearUtilization'].value);
    assert.equal(point.metrics['beam.usablePhiMnKnM'].value, record.baseline.metrics['beam.usablePhiMnKnM'].value);
  }
  assert.notEqual(record.samples[0].results.beam.selfWeightMuKnM, record.samples[2].results.beam.selfWeightMuKnM);
});

test('configuration rejects unknown, inactive, nonfinite, degenerate and unrepresentable sweeps', () => {
  for (const patch of [
    { parameterId: 'context.groundwaterLevel' }, { parameterId: 'soilInputs.undrainedStrengthKpa' },
    { minimum: 4 }, { maximum: 1 }, { minimum: 0.05 }, { maximum: 20.000001 },
    { sampleCount: 2 }, { sampleCount: 32 }, { sampleCount: 3.5 }, { sampleCount: '9' },
    { minimum: NaN }, { maximum: Infinity }, { minimum: null }, { minimum: '1' },
    { minimum: 1, maximum: 1 + Number.EPSILON, sampleCount: 31 }, { unknown: 1 },
  ]) assert.throws(() => build(fresh(), patch));
  for (const field of Object.keys(config())) {
    const incomplete = config(); delete incomplete[field];
    assert.throws(() => buildStudy(fresh(), source, incomplete));
  }
  assert.throws(() => build(fresh(), { stationId: 'not-a-station' }), /สถานี/);
  assert.throws(() => build(fresh(), { scenarioId: 'not-an-alternative' }), /ไม่พบทางเลือก/);
  const total = updateActiveScenario(fresh(), { soilInputs: { mode: 'undrained' } }, source);
  assert.throws(() => build(total, { parameterId: 'soilInputs.frictionAngleDeg' }), /ไม่ใช้ในโหมด/);
  assert.throws(() => studyOptions(fresh(), source, {}));
  assert.throws(() => studyOptions(fresh(), source, { ...selection(), extra: true }));
  assert.throws(() => studySourceRevision(fresh(), source, selection('missing')));
});

test('study entry points reject unsafe objects before executing getters', () => {
  let called = false;
  const input = config();
  Object.defineProperty(input, 'minimum', { enumerable: true, get() { called = true; return 1; } });
  assert.throws(() => buildStudy(fresh(), source, input));
  assert.equal(called, false);
  const selected = selection();
  Object.defineProperty(selected, 'stationId', { enumerable: true, get() { called = true; return first.id; } });
  assert.throws(() => studyOptions(fresh(), source, selected));
  assert.equal(called, false);
  const unsafeSource = copy(source);
  Object.defineProperty(unsafeSource.rows[0], 'stationM', { enumerable: true, get() { called = true; return 0; } });
  assert.throws(() => buildStudy(fresh(), unsafeSource, config()));
  assert.equal(called, false);
  const unsafeProject = fresh();
  Object.defineProperty(unsafeProject, 'selectedStationId', { enumerable: true, get() { called = true; return first.id; } });
  assert.throws(() => buildStudy(unsafeProject, source, config()));
  assert.equal(called, false);
  const reserved = config(); Object.defineProperty(reserved, '__proto__', { value: {}, enumerable: true });
  assert.throws(() => buildStudy(fresh(), source, reserved));
  assert.throws(() => buildStudy(fresh(), source, Object.create(config())));
});

test('native project shapes and existing revisions are unchanged by options, studies and CSV', () => {
  const versions = [fresh(), fresh(), saveInvestigationMetadata(fresh(), 'soil', metadata(), source)];
  versions[0].version = 1; delete versions[0].stationComparisons;
  assert.deepEqual(versions.map(project => project.version), [1, 2, 3]);
  for (const project of versions) {
    const before = serializeProject(project, source), revision = projectRevision(project);
    studyOptions(project, source, selection());
    const record = build(project, { sampleCount: 3 });
    assert.ok(studyCSV(record).startsWith('\uFEFF'));
    assert.equal(serializeProject(project, source), before);
    assert.equal(projectRevision(project), revision);
  }
});

test('CSV preserves all inputs, formulas, conditions, zero/missing and baseline-only evidence safely', () => {
  let project = updateActiveScenario(fresh(), { context: { sourceNote: '=1+1\nLiteral, "note"' } }, source);
  project = saveInvestigationMetadata(project, 'soil', metadata('=SUM(1,2)\nEvidence text'), source);
  project = save(project, 'csv-a', '=SUM(1,2)');
  const record = build(project, { scenarioId: 'csv-a', sampleCount: 3 });
  const csv = studyCSV(record);
  assert.ok(csv.startsWith('\uFEFF"study_revision","study_method_revision"'));
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"\'=1+1\nLiteral, ""note"""'));
  assert.ok(csv.includes('"\'=SUM(1,2)\nEvidence text"'));
  assert.ok(csv.includes('"input","soilInputs.undrainedStrengthKpa"'));
  assert.ok(csv.includes('"formula","soil.dry-FS"'));
  assert.ok(csv.includes('"condition","beam.minimum-flexural-steel"'));
  assert.ok(csv.includes('"metric","beam.usablePhiMnKnM"'));
  assert.ok(csv.includes('"gated"'));
  assert.ok(csv.includes('"missing"'));
  assert.ok(csv.includes('"baseline_evidence"'));
  assert.ok(csv.includes('หลักฐานของชุดฐานเท่านั้น'));
  const again = studyCSV(build(project, { scenarioId: 'csv-a', sampleCount: 3 }));
  assert.equal(csv, again);
});

test('CSV rejects altered numeric outputs, sample inputs and malformed or unsafe records', () => {
  const record = build(fresh(), { sampleCount: 3 });
  for (const mutate of [
    value => { value.samples[0].metrics['soil.dry.fs'].value = 999; },
    value => { value.samples[0].results.soil.cases[0].factorOfSafety = 999; },
    value => { value.samples[0].scenario.beamInputs.externalMuKnM = 0; },
    value => { value.samples[0].id = 'other'; },
    value => { value.samples[0].x = 9; },
    value => { value.config.maximum = 5; },
    value => { value.summaries['soil.dry.fs'].minimum.value = 0; },
    value => { value.metricDefinitions[0].label = 'Approved'; },
    value => { value.calculationRevision = 'other'; },
    value => { value.selection.scenarioName = 'Changed source'; },
    value => { value.baselineEvidence.groups[0].metadata.notes = 'Changed source'; },
    value => { value.baselineEvidence.groups[0].state = 'current'; },
    value => { value.baselineEvidence.limitations = []; },
    value => { value.limitations = []; },
  ]) { const changed = copy(record); mutate(changed); assert.throws(() => studyCSV(changed)); }
  const sparse = copy(record); delete sparse.samples[0];
  assert.throws(() => studyCSV(sparse));
  const oversized = copy(record); oversized.limitations[0] = 'x'.repeat(200001);
  assert.throws(() => studyCSV(oversized));
  let called = false;
  Object.defineProperty(record.samples[0].metrics['soil.dry.fs'], 'value', { enumerable: true, get() { called = true; return 0; } });
  assert.throws(() => studyCSV(record));
  assert.equal(called, false);
});
