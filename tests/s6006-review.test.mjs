import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createProject, getActiveScenario, updateActiveScenario, saveAlternative,
  selectStation, setComparisonReference, stationCatalog, projectRevision,
} from '../projects/s6006/project.js';
import { REVIEW_REVISION, buildReview, selectReview, reviewCSV } from '../projects/s6006/review.js';

const source = JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json', import.meta.url), 'utf8'));
const catalog = stationCatalog(source), first = catalog[0].id, last = catalog.at(-1).id;
const fresh = () => createProject(source);
const clone = value => JSON.parse(JSON.stringify(value));
const current = project => buildReview(project, source).entries.find(entry => entry.station.id === project.selectedStationId && entry.kind === 'current');
const find = (entry, id) => {
  const item = entry.findings.find(finding => finding.id === id);
  assert.ok(item, 'Missing review finding ' + id);
  return item;
};
const save = (project, id = 'alt-A', name = 'A ที่เก็บ') => saveAlternative(project, name, source, { id, createdAt: '2026-11-22T01:00:00.000Z' });
const selection = (overrides = {}) => ({ stationId: 'all', kind: 'all', focus: 'all', ...overrides });
const adequate = () => updateActiveScenario(fresh(), { beamInputs: { tensionBarDiameterMm: 16, stirrupDiameterMm: 8, externalMuKnM: 30, externalVuKn: 50 } }, source);
const near = (actual, expected) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-10, `${actual} != ${expected}`);

// Independent quoted CSV reader: exercise embedded commas, newlines and quotes.
function readCSV(text) {
  const rows = [], fields = [];
  let field = '', quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && character === ',') { fields.push(field); field = ''; }
    else if (!quoted && (character === '\r' || character === '\n')) {
      if (character === '\r' && text[i + 1] === '\n') i++;
      fields.push(field); rows.push([...fields]); fields.length = 0; field = '';
    } else field += character;
  }
  assert.equal(quoted, false);
  if (fields.length || field) { fields.push(field); rows.push([...fields]); }
  const [headers, ...data] = rows;
  return data.map(values => {
    assert.equal(values.length, headers.length);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

test('review enumerates 41 default station contexts without claiming independent design completion', () => {
  const project = fresh(), before = JSON.stringify(project), beforeSource = JSON.stringify(source);
  const record = buildReview(project, source);
  assert.equal(REVIEW_REVISION, 'S6006-REVIEW-1');
  assert.equal(record.metadata.projectRevision, projectRevision(project));
  assert.equal(record.metadata.calculationRevision, 'S6006-R2');
  assert.equal(record.summary.stationCount, 41);
  assert.equal(record.summary.entryCount, 41);
  assert.equal(record.summary.currentCount, 41);
  assert.equal(record.summary.savedCount, 0);
  assert.equal(record.summary.baselineCurrentCount, 41);
  assert.equal(record.summary.modifiedCurrentCount, 0);
  assert.equal(record.summary.attentionEntryCount, 41);
  assert.equal(record.summary.missingEntryCount, 41);
  assert.deepEqual(record.stations, catalog);
  assert.deepEqual(record.entries.map(entry => entry.station.id), catalog.map(station => station.id));
  assert.ok(record.entries.every(entry => entry.baseline && !entry.isReference && entry.createdAt === null));
  assert.ok(record.entries.every(entry => entry.inputs.geometry.length === 1000));
  assert.equal(record.entries[0].station.effectiveLength, 12.5);
  assert.equal(record.entries[0].counts.missing, 8, 'Mu/Vu and six context fields are missing');
  assert.equal(JSON.stringify(project), before);
  assert.equal(JSON.stringify(source), beforeSource);
  assert.ok(record.limitations.some(item => item.id === 'station-and-baseline'));
  assert.ok(record.limitations.some(item => item.id === 'soil-mechanism'));
  for (const entry of record.entries) for (const finding of entry.findings) {
    assert.equal('approved' in finding, false);
    assert.ok(finding.value === null || ['number', 'string'].includes(typeof finding.value));
    for (const key of finding.sourceKeys) assert.ok(record.sources.some(item => item.id === key));
  }
});

test('review ordering, scenario identities and reference flags remain isolated by station', () => {
  let project = save(fresh(), 'shared-id', 'A เดิม');
  project = updateActiveScenario(project, { geometry: { slopeH: 3.5 } }, source);
  project = save(project, 'alt-B', 'B ลาดใหม่');
  project = setComparisonReference(project, 'alt-B', source);
  project = selectStation(project, last, source);
  project = save(project, 'shared-id', 'ปลายโครงการ');
  const record = buildReview(project, source);
  assert.equal(record.summary.entryCount, 44);
  assert.equal(record.summary.stationCount, 41);
  assert.equal(record.summary.savedCount, 3);
  assert.deepEqual(record.entries.slice(0, 3).map(entry => entry.scenarioId), ['current', 'shared-id', 'alt-B']);
  assert.deepEqual(record.entries.slice(0, 3).map(entry => entry.isReference), [false, false, true]);
  assert.deepEqual(record.entries.slice(0, 3).map(entry => entry.baseline), [false, true, false]);
  assert.deepEqual(record.entries.slice(-2).map(entry => entry.scenarioId), ['current', 'shared-id']);
  assert.equal(new Set(record.entries.map(entry => entry.key)).size, 44);
  assert.notEqual(record.entries[1].key, record.entries.at(-1).key);
  assert.equal(record.entries[1].inputs.geometry.slopeH, 2.5);
  assert.equal(record.entries[2].inputs.geometry.slopeH, 3.5);
});

test('native v1 review preserves original shape and revision without migration', () => {
  const project = {
    schema: 'riverbank.s6006.project', version: 1, calculationRevision: 'S6006-R2',
    projectCode: 'S6006', selectedStationId: first, stationScenarios: {},
  };
  const before = JSON.stringify(project);
  const record = buildReview(project, source);
  assert.equal(record.metadata.projectRevision, 's6006p-30d0acd78fa4ab75');
  assert.equal(record.summary.entryCount, 41);
  assert.equal(record.summary.savedCount, 0);
  assert.equal(JSON.stringify(project), before);
  assert.equal('stationComparisons' in project, false);
});

test('baseline withheld moment, reduced shear and missing demands remain distinct', () => {
  const entry = current(fresh());
  assert.equal(entry.metrics.usablePhiMnKnM, null);
  near(entry.metrics.usablePhiVnKn, 31.766401826458093);
  assert.equal(find(entry, 'beam.usable-moment').availability, 'gated');
  assert.equal(find(entry, 'beam.usable-moment').disposition, 'attention');
  assert.equal(find(entry, 'beam.usable-shear').availability, 'computed');
  assert.equal(find(entry, 'beam.usable-shear').disposition, 'attention');
  assert.match(find(entry, 'beam.usable-shear').reason, /φVc\/2/);
  for (const id of ['beam.external-moment', 'beam.external-shear']) {
    assert.equal(find(entry, id).availability, 'missing');
    assert.equal(find(entry, id).disposition, 'missing');
    assert.equal(find(entry, id).value, null);
  }
  assert.equal(find(entry, 'beam.minimum-flexural-exception').disposition, 'outside-scope');
  assert.equal(find(entry, 'beam.selfweight-only').disposition, 'computed-only');
});

test('actual demand distinguishes withheld capacity, overload and the satisfied local condition', () => {
  const gated = current(updateActiveScenario(fresh(), { beamInputs: { externalMuKnM: 30, externalVuKn: 50 } }, source));
  assert.equal(find(gated, 'beam.external-moment').availability, 'gated');
  assert.equal(find(gated, 'beam.external-moment').value, 30);
  assert.equal(find(gated, 'beam.external-moment').limit, null);
  assert.equal(find(gated, 'beam.external-shear').availability, 'computed');
  assert.equal(find(gated, 'beam.external-shear').disposition, 'attention');
  assert.match(find(gated, 'beam.external-shear').reason, /เกินกำลัง/);
  const entry = current(adequate());
  near(entry.metrics.usablePhiMnKnM, 60.47415712991661);
  near(entry.metrics.usablePhiVnKn, 102.36099108125812);
  near(entry.metrics.momentUtilization, 0.49607967144628423);
  near(entry.metrics.shearUtilization, 0.4884673299060583);
  assert.equal(find(entry, 'beam.external-moment').disposition, 'condition-met');
  assert.equal(find(entry, 'beam.external-shear').disposition, 'condition-met');
  const overloaded = current(updateActiveScenario(adequate(), { beamInputs: { externalMuKnM: 70, externalVuKn: 110 } }, source));
  assert.equal(find(overloaded, 'beam.external-moment').availability, 'computed');
  assert.equal(find(overloaded, 'beam.external-moment').disposition, 'attention');
  assert.equal(find(overloaded, 'beam.external-shear').disposition, 'attention');
});

test('small Vu within the reduced ceiling does not remove transverse-detail findings', () => {
  const entry = current(updateActiveScenario(fresh(), { beamInputs: { externalVuKn: 5 } }, source));
  assert.equal(find(entry, 'beam.external-shear').disposition, 'condition-met');
  assert.equal(find(entry, 'beam.minimum-stirrups').disposition, 'attention');
  assert.equal(find(entry, 'beam.usable-shear').disposition, 'attention');
  near(entry.metrics.shearUtilization, 5 / 31.766401826458093);
  assert.ok(entry.counts.attention > 0);
  assert.match(find(entry, 'beam.usable-shear').reason, /ไม่ยกเลิก/);
});

test('strain and upper-shear gates retain null usable values even for small entered demands', () => {
  const entry = current(updateActiveScenario(fresh(), { beamInputs: {
    widthMm: 350, tensionBarDiameterMm: 26, tensionBarCount: 5,
    externalMuKnM: 1, stirrupSpacingMm: 1, externalVuKn: 1,
  } }, source));
  assert.equal(entry.metrics.usablePhiMnKnM, null);
  assert.equal(entry.metrics.usablePhiVnKn, null);
  assert.equal(entry.metrics.momentUtilization, null);
  assert.equal(entry.metrics.shearUtilization, null);
  assert.equal(find(entry, 'beam.flexural-strain').disposition, 'attention');
  assert.equal(find(entry, 'beam.maximum-shear').disposition, 'attention');
  assert.equal(find(entry, 'beam.external-moment').availability, 'gated');
  assert.equal(find(entry, 'beam.external-shear').availability, 'gated');
});

test('soil mechanism flags only FS below unity and never turns a larger FS into design acceptance', () => {
  const entry = current(fresh());
  near(entry.metrics.soilCases.dry, 1.5621733797733188);
  near(entry.metrics.soilCases['parallel-seepage'], 0.7961890010386198);
  assert.equal(find(entry, 'soil.dry').disposition, 'computed-only');
  assert.equal(find(entry, 'soil.parallel-seepage').disposition, 'attention');
  assert.equal(find(entry, 'soil.parallel-seepage').limit, null);
  assert.match(find(entry, 'soil.parallel-seepage').reason, /FS<1/);
  assert.equal(find(entry, 'soil.undrained').availability, 'not-applicable');
  assert.equal(entry.metrics.soilCases.undrained, null);
  const flatter = current(updateActiveScenario(fresh(), { geometry: { slopeH: 3.5 } }, source));
  near(flatter.metrics.soilCases['parallel-seepage'], 1.1146646014540677);
  assert.equal(find(flatter, 'soil.parallel-seepage').disposition, 'computed-only');
  assert.equal(find(flatter, 'soil.parallel-seepage').limit, null);
});

test('missing Su yields no numerical result or borrowed effective-stress case', () => {
  const entry = current(updateActiveScenario(fresh(), { soilInputs: { mode: 'undrained', undrainedStrengthKpa: null } }, source));
  assert.deepEqual(entry.metrics.soilCases, { dry: null, 'parallel-seepage': null, undrained: null });
  assert.equal(find(entry, 'soil.undrained').availability, 'missing');
  assert.equal(find(entry, 'soil.undrained').disposition, 'missing');
  assert.equal(find(entry, 'soil.undrained').value, null);
  assert.equal(find(entry, 'soil.dry').disposition, 'not-applicable');
  assert.equal(find(entry, 'soil.parallel-seepage').disposition, 'not-applicable');
  assert.match(find(entry, 'soil.undrained').reason, /ไม่แทนช่องว่าง/);
});

test('explicit zero demands, Su and levels remain supplied numerical values', () => {
  const entry = current(updateActiveScenario(adequate(), {
    beamInputs: { externalMuKnM: 0, externalVuKn: 0 },
    soilInputs: { mode: 'undrained', undrainedStrengthKpa: 0 },
    context: { waterHighLevel: 0, waterLowLevel: 0, groundwaterLevel: 0 },
  }, source));
  assert.equal(entry.metrics.momentUtilization, 0);
  assert.equal(entry.metrics.shearUtilization, 0);
  assert.equal(entry.metrics.soilCases.undrained, 0);
  assert.equal(find(entry, 'soil.undrained').availability, 'computed');
  assert.equal(find(entry, 'soil.undrained').disposition, 'attention');
  for (const id of ['beam.external-moment', 'beam.external-shear']) {
    assert.equal(find(entry, id).value, 0);
    assert.equal(find(entry, id).disposition, 'condition-met');
  }
  for (const key of ['waterHighLevel', 'waterLowLevel', 'groundwaterLevel']) {
    assert.equal(find(entry, 'context.' + key).value, 0);
    assert.equal(find(entry, 'context.' + key).availability, 'provided');
    assert.equal(find(entry, 'context.' + key).disposition, 'recorded');
  }
  assert.equal(find(entry, 'context.waterReference').availability, 'missing');
});

test('context-only changes and arbitrary source text do not certify a station or material basis', () => {
  const project = updateActiveScenario(fresh(), { context: {
    sourceNote: 'constructor <script>literal</script>',
    boreholeReference: 'BH-01 stated by user', waterReference: '  \t\n ',
  } }, source);
  const record = buildReview(project, source), entry = record.entries[0];
  assert.equal(entry.baseline, false);
  assert.equal(record.summary.modifiedCurrentCount, 1);
  assert.equal(entry.inputs.geometry.slopeH, 2.5);
  assert.equal(find(entry, 'context.sourceNote').value, 'constructor <script>literal</script>');
  assert.equal(find(entry, 'context.sourceNote').disposition, 'recorded');
  assert.equal(find(entry, 'context.boreholeReference').disposition, 'recorded');
  assert.match(find(entry, 'context.boreholeReference').reason, /ยังไม่ได้ยืนยัน/);
  assert.equal(find(entry, 'context.waterReference').disposition, 'missing');
  assert.equal(find(entry, 'context.waterReference').value, '  \t\n ');
  assert.equal(find(entry, 'soil.dry').disposition, 'computed-only');
});

test('review explanations use actual edited parameters instead of baseline constants', () => {
  const entry = current(updateActiveScenario(fresh(), {
    beamInputs: { coverMm: 50, spanM: 4, deadLoadFactor: 1.2 },
    geometry: { slopeH: 3 },
    soilInputs: { unitWeightKnM3: 18, saturatedUnitWeightKnM3: 21, frictionAngleDeg: 34, effectiveCohesionKpa: 2, verticalDepthM: 3 },
  }, source));
  const beam = find(entry, 'beam.selfweight-only').reason;
  assert.match(beam, /L=4 m/);
  assert.match(beam, /cover=50 mm/);
  assert.match(beam, /ตัวคูณน้ำหนักตัวเอง=1.2/);
  const soil = find(entry, 'soil.dry').reason;
  assert.match(soil, /ลาด=3H:1V/);
  assert.match(soil, /z=3 m/);
  assert.match(soil, /γ=18 kN/);
  assert.match(soil, /γsat=21 kN/);
  assert.match(soil, /φ′=34°/);
  assert.match(soil, /c′=2 kPa/);
});

test('selection scopes station and kind before focus, retaining all findings of included entries', () => {
  let project = updateActiveScenario(adequate(), { geometry: { slopeH: 3.5 }, context: {
    waterHighLevel: 99, waterLowLevel: 98, groundwaterLevel: 97,
    boreholeReference: 'BH source', waterReference: 'Survey datum', sourceNote: 'Reviewed externally, unverified text',
  } }, source);
  project = save(project, 'alt-adequate', 'Adequate local conditions');
  project = updateActiveScenario(project, { beamInputs: { externalMuKnM: 100 } }, source);
  project = save(project, 'alt-overload', 'Overload');
  const record = buildReview(project, source);
  const allFirst = selectReview(record, selection({ stationId: first }));
  assert.equal(allFirst.eligibleCount, 3);
  assert.equal(allFirst.includedCount, 3);
  const attentionSaved = selectReview(record, selection({ stationId: first, kind: 'saved', focus: 'attention' }));
  assert.equal(attentionSaved.eligibleCount, 2);
  assert.equal(attentionSaved.includedCount, 1);
  assert.equal(attentionSaved.excludedCount, 1);
  assert.equal(attentionSaved.entries[0].scenarioId, 'alt-overload');
  assert.equal(attentionSaved.entries[0].findings.length, record.entries.find(entry => entry.scenarioId === 'alt-overload').findings.length);
  assert.ok(attentionSaved.entries[0].findings.some(item => item.disposition === 'recorded'));
  const missing = selectReview(record, selection({ stationId: first, focus: 'missing' }));
  assert.equal(missing.eligibleCount, 3);
  assert.equal(missing.includedCount, 0);
  assert.equal(missing.summary.entryCount, 0);
  assert.equal(missing.summary.stationCount, 0);
  const baselines = selectReview(record, selection({ focus: 'baseline' }));
  assert.equal(baselines.includedCount, 40);
  assert.equal(baselines.summary.baselineCurrentCount, 40);
  assert.equal(baselines.summary.modifiedCurrentCount, 0);
});

test('selection rejects unknown keys, stations, prototypes, symbols and getters before reading values', () => {
  const record = buildReview(fresh(), source);
  const invalid = [
    null, [], {}, { stationId: 'all', kind: 'all' },
    selection({ extra: 'all' }), selection({ stationId: 'r9-row999' }), selection({ kind: 'winner' }),
    selection({ focus: 'approved' }), selection({ stationId: 0 }), selection({ kind: null }),
    Object.assign(Object.create({ arbitrary: true }), selection()),
    Object.defineProperty(selection(), Symbol('extra'), { value: 'all', enumerable: true }),
    Object.defineProperty(selection(), 'kind', { value: 'all', enumerable: false }),
  ];
  for (const value of invalid) assert.throws(() => selectReview(record, value));
  let accessed = false;
  const accessor = { stationId: 'all', kind: 'all', get focus() { accessed = true; return 'all'; } };
  assert.throws(() => selectReview(record, accessor));
  assert.equal(accessed, false);
  assert.equal(selectReview(record, Object.assign(Object.create(null), selection())).includedCount, 41);
});

test('derived review and filtered snapshots are defensive copies and invalid projects fail before output', () => {
  const project = save(adequate()), original = JSON.stringify(project);
  const record = buildReview(project, source);
  record.entries[0].inputs.geometry.slopeH = 10;
  record.entries[1].inputs.context.sourceNote = 'external mutation';
  record.limitations[0].title = 'external';
  assert.equal(JSON.stringify(project), original);
  const rebuilt = buildReview(project, source);
  const selected = selectReview(rebuilt, selection({ stationId: first }));
  selected.entries[0].inputs.beamInputs.externalMuKnM = 900;
  selected.entries[0].findings[0].reason = 'changed';
  selected.sources[0].title = 'changed';
  assert.equal(rebuilt.entries[0].inputs.beamInputs.externalMuKnM, 30);
  assert.notEqual(rebuilt.entries[0].findings[0].reason, 'changed');
  assert.notEqual(rebuilt.sources[0].title, 'changed');
  const corrupt = clone(project);
  corrupt.stationScenarios[first].soilInputs.unitWeightKnM3 = -1;
  assert.throws(() => buildReview(corrupt, source));
  corrupt.stationScenarios[first] = getActiveScenario(project);
  corrupt.stationScenarios[first].beamInputs.externalMuKnM = NaN;
  assert.throws(() => buildReview(corrupt, source));
  const missingSuInvalid = clone(project);
  missingSuInvalid.stationScenarios[first].soilInputs.mode = 'undrained';
  missingSuInvalid.stationScenarios[first].soilInputs.undrainedStrengthKpa = null;
  missingSuInvalid.stationScenarios[first].soilInputs.verticalDepthM = 0;
  assert.throws(() => buildReview(missingSuInvalid, source));
});

test('CSV keeps full selected findings, identities, empty versus zero values and escaped text', () => {
  const note = '=SUM(1,2)\nquoted "text" <script>literal</script>';
  let project = updateActiveScenario(adequate(), {
    beamInputs: { externalMuKnM: 0, externalVuKn: null },
    context: { sourceNote: note, waterHighLevel: 0, waterLowLevel: -1 },
  }, source);
  project = save(project, 'alt-csv', '+formula-like name');
  const record = buildReview(project, source);
  const filter = selection({ stationId: first, kind: 'saved', focus: 'missing' });
  const csv = reviewCSV(record, filter), rows = readCSV(csv);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(rows.length, record.entries[1].findings.length);
  assert.ok(rows.every(row => row.station_id === first && row.scenario_id === 'alt-csv'));
  assert.ok(rows.every(row => row.filter_kind === 'saved' && row.filter_focus === 'missing'));
  assert.ok(rows.every(row => row.included_entry_count === '1' && row.eligible_entry_count === '1'));
  assert.ok(rows.every(row => row.project_revision === record.metadata.projectRevision));
  assert.ok(rows.every(row => row.scenario_name === "'+formula-like name"));
  assert.ok(rows.every(row => row.source_row === '14' && row.source_effective_length_m === '12.5'));
  assert.equal(rows.find(row => row.finding_id === 'beam.external-moment').value, '0');
  assert.equal(rows.find(row => row.finding_id === 'beam.external-shear').value, '');
  assert.equal(rows.find(row => row.finding_id === 'beam.external-shear').availability, 'missing');
  assert.equal(rows.find(row => row.finding_id === 'context.waterLowLevel').value, '-1');
  assert.equal(rows.find(row => row.finding_id === 'context.sourceNote').value, "'" + note);
  assert.equal(rows.find(row => row.finding_id === 'context.sourceNote').disposition, 'recorded');
  assert.ok(rows.some(row => row.disposition === 'condition-met'), 'A missing-focused export retains other findings');
  assert.ok(rows.every(row => row.shared_scope_limitations.includes('ไม่มีผลเสถียรภาพรวม')));
  assert.ok(rows.find(row => row.finding_id === 'soil.dry').source_references.includes('publications.usace.army.mil'));
  assert.throws(() => reviewCSV(record, selection({ stationId: last, kind: 'saved' })), /ไม่มีสถานการณ์/);
});
