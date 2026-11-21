import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createProject, getActiveScenario, getStationComparison, updateActiveScenario,
  saveAlternative, setComparisonReference, selectStation, stationCatalog,
  projectRevision, scenarioRevision,
} from '../projects/s6006/project.js';
import { buildComparison, comparisonCSV, COMPARISON_GROUPS } from '../projects/s6006/comparison.js';

const source = JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json', import.meta.url), 'utf8'));
const fresh = () => createProject(source);
const clone = value => JSON.parse(JSON.stringify(value));
const saved = (project = fresh(), id = 'alt-baseline-001', name = 'ค่าฐานที่บันทึก') => saveAlternative(project, name, source,
  { id, createdAt: '2026-11-21T12:00:00.000Z' });
const row = (record, id) => {
  const found = record.rows.find(item => item.id === id);
  assert.ok(found, 'Missing comparison row: ' + id);
  return found;
};
const cell = (record, id, entryId = 'current') => row(record, id).cells[entryId];
const near = (actual, expected) => assert.ok(typeof actual === 'number'
  && Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);

function assertFiniteNumbers(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (value && typeof value === 'object') for (const item of Object.values(value)) assertFiniteNumbers(item);
}

// Independent CSV reader for quoted commas, double quotes and embedded newlines.
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

test('current-only comparison preserves R2 gates, source-row context and every actual input', () => {
  const project = fresh(), before = JSON.stringify(project), originalSource = JSON.stringify(source);
  const record = buildComparison(project, source);
  assert.equal(record.entries.length, 1);
  const current = record.entries[0];
  assert.equal(current.id, 'current');
  assert.equal(current.name, 'ค่าที่กำลังแก้');
  assert.equal(current.kind, 'current');
  assert.equal(current.createdAt, null);
  assert.equal(current.revision, scenarioRevision(getActiveScenario(project)));
  assert.equal(record.metadata.projectRevision, projectRevision(project));
  assert.equal(record.metadata.calculationRevision, 'S6006-R2');
  assert.equal(record.metadata.referenceId, null);
  assert.deepEqual(record.metadata.station, stationCatalog(source)[0]);
  assert.equal(record.metadata.station.effectiveLength, 12.5);
  assert.equal(current.scenario.geometry.length, 1000);
  near(current.results.beam.phiMnKnM, 34.965780115954324);
  assert.equal(cell(record, 'beam.usablePhiMnKnM').availability, 'gated');
  assert.equal(cell(record, 'beam.usablePhiMnKnM').value, null);
  assert.match(cell(record, 'beam.usablePhiMnKnM').reason, /As|min/);
  near(cell(record, 'beam.usablePhiVnKn').value, 31.766401826458093);
  assert.equal(cell(record, 'beam.usablePhiVnKn').status, 'review');
  assert.match(cell(record, 'beam.usablePhiVnKn').reason, /φVc\/2/);
  assert.equal(cell(record, 'beam.MuKnM').availability, 'missing');
  assert.equal(cell(record, 'beam.momentUtilization').value, null);
  assert.equal(cell(record, 'soil.dry.factorOfSafety').status, 'illustrative');
  assert.equal(cell(record, 'soil.undrained.factorOfSafety').availability, 'not-applicable');
  for (const item of record.rows) assert.equal(item.cells.current.delta, null);
  assert.deepEqual(record.changedInputs, []);
  const actualPaths = Object.entries(current.scenario).flatMap(([section, values]) => Object.keys(values).map(key => 'input.' + section + '.' + key));
  assert.deepEqual(record.rows.filter(item => item.isInput).map(item => item.id).sort(), actualPaths.sort());
  assert.ok(record.rows.every(item => COMPARISON_GROUPS.some(group => group.id === item.group)));
  assert.equal(current.results.beam.projectApproved, false);
  assert.equal(current.results.soil.projectApproved, false);
  assert.equal(JSON.stringify(project), before);
  assert.equal(JSON.stringify(source), originalSource);
  assertFiniteNumbers(record);
});

test('saved order and chosen reference are stable and output snapshots are defensive copies', () => {
  let project = saved();
  project = updateActiveScenario(project, { geometry: { slopeH: 3 } }, source);
  project = saved(project, 'alt-second-002', 'ลาดอีกค่าหนึ่ง');
  project = setComparisonReference(project, 'alt-second-002', source);
  const before = JSON.stringify(project);
  const record = buildComparison(project, source);
  assert.deepEqual(record.entries.map(entry => entry.id), ['alt-baseline-001', 'alt-second-002', 'current']);
  assert.deepEqual(record.entries.map(entry => entry.kind), ['saved', 'saved', 'current']);
  assert.equal(record.metadata.referenceId, 'alt-second-002');
  assert.equal(record.entries[1].createdAt, '2026-11-21T12:00:00.000Z');
  assert.equal(cell(record, 'geometry.run').delta, 0);
  near(cell(record, 'geometry.run', 'alt-baseline-001').delta, -6.5);
  assert.equal(cell(record, 'beam.usablePhiMnKnM', 'alt-second-002').delta, null);
  assert.equal(cell(record, 'input.geometry.slopeH').delta, null);
  record.entries[0].scenario.geometry.slopeH = 10;
  record.entries.at(-1).scenario.context.sourceNote = 'Changed only the returned copy';
  assert.equal(JSON.stringify(project), before);
  assert.equal(getStationComparison(project).alternatives[0].scenario.geometry.slopeH, 2.5);
  assert.equal(getActiveScenario(project).context.sourceNote, '');
  assert.equal(buildComparison(project, source).entries[0].scenario.geometry.slopeH, 2.5);
});

test('adequate reinforcement becomes available without inventing a capacity delta from gated baseline', () => {
  let project = updateActiveScenario(fresh(), { beamInputs: { externalMuKnM: 30, externalVuKn: 50 } }, source);
  project = saved(project);
  project = updateActiveScenario(project, { beamInputs: { tensionBarDiameterMm: 16, stirrupDiameterMm: 8 } }, source);
  const record = buildComparison(project, source);
  const baseMoment = cell(record, 'beam.momentUtilization', 'alt-baseline-001');
  assert.equal(baseMoment.value, null);
  assert.equal(baseMoment.availability, 'gated');
  near(cell(record, 'beam.AsMm2').value, 402.1238596594935);
  near(cell(record, 'beam.AsMinMm2').value, 396.1597487419251);
  near(cell(record, 'beam.usablePhiMnKnM').value, 60.47415712991661);
  assert.equal(cell(record, 'beam.usablePhiMnKnM').availability, 'computed');
  assert.equal(cell(record, 'beam.usablePhiMnKnM').delta, null);
  assert.equal(cell(record, 'beam.usablePhiMnKnM').deltaPercent, null);
  near(cell(record, 'beam.usablePhiVnKn').value, 102.36099108125812);
  near(cell(record, 'beam.momentUtilization').value, 0.49607967144628423);
  near(cell(record, 'beam.shearUtilization').value, 0.4884673299060583);
  near(cell(record, 'beam.shearUtilization', 'alt-baseline-001').value, 1.5739900374349363);
  assert.equal(cell(record, 'beam.shearUtilization', 'alt-baseline-001').status, 'review');
  assert.equal(cell(record, 'beam.momentUtilization').status, 'satisfied');
  near(cell(record, 'beam.shearUtilization').delta, 0.4884673299060583 - 1.5739900374349363);
  assert.deepEqual(record.changedInputs.map(item => item.path).sort(), ['beamInputs.stirrupDiameterMm', 'beamInputs.tensionBarDiameterMm']);
});

test('changing a demand suppresses utilization deltas but preserves actual values and capacity deltas', () => {
  let project = updateActiveScenario(fresh(), { beamInputs: { tensionBarDiameterMm: 16, stirrupDiameterMm: 8, externalMuKnM: 30, externalVuKn: 50 } }, source);
  project = saved(project);
  project = updateActiveScenario(project, { beamInputs: { externalMuKnM: 20 } }, source);
  const record = buildComparison(project, source);
  near(cell(record, 'beam.MuKnM').value, 20);
  near(cell(record, 'beam.MuKnM').delta, -10);
  near(cell(record, 'beam.momentUtilization').value, 20 / 60.47415712991661);
  assert.equal(cell(record, 'beam.momentUtilization').delta, null);
  assert.equal(cell(record, 'beam.momentUtilization').deltaPercent, null);
  assert.match(cell(record, 'beam.momentUtilization').reason, /แรงออกแบบต่าง/);
  assert.equal(cell(record, 'beam.usablePhiMnKnM').delta, 0);
  assert.equal(cell(record, 'beam.shearUtilization').delta, 0);
});

test('explicit zero is a value, missing demand is missing, and zero reference has no percentage', () => {
  let project = updateActiveScenario(fresh(), { beamInputs: { tensionBarDiameterMm: 16, stirrupDiameterMm: 8 },
    soilInputs: { frictionAngleDeg: 0, effectiveCohesionKpa: 0 } }, source);
  project = saved(project);
  project = updateActiveScenario(project, { beamInputs: { externalMuKnM: 0, externalVuKn: 0 }, soilInputs: { frictionAngleDeg: 32 } }, source);
  const record = buildComparison(project, source);
  assert.equal(cell(record, 'beam.momentUtilization', 'alt-baseline-001').availability, 'missing');
  assert.equal(cell(record, 'beam.momentUtilization').value, 0);
  assert.equal(cell(record, 'beam.momentUtilization').availability, 'computed');
  assert.equal(cell(record, 'beam.momentUtilization').delta, null);
  assert.equal(cell(record, 'beam.shearUtilization').value, 0);
  const zero = cell(record, 'soil.dry.factorOfSafety', 'alt-baseline-001');
  assert.equal(zero.value, 0);
  assert.equal(zero.delta, 0);
  assert.equal(zero.deltaPercent, null);
  assert.equal(zero.status, 'illustrative');
  near(cell(record, 'soil.dry.factorOfSafety').delta, 1.5621733797733188);
  assert.equal(cell(record, 'soil.dry.factorOfSafety').deltaPercent, null);
});

test('strain and upper-shear gates remain unavailable even if mechanical capacities exist', () => {
  let project = updateActiveScenario(fresh(), { beamInputs: { widthMm: 350,
    tensionBarDiameterMm: 26, tensionBarCount: 5, externalMuKnM: 100, stirrupSpacingMm: 1, externalVuKn: 1 } }, source);
  let record = buildComparison(project, source);
  assert.ok(record.entries[0].results.beam.phiMnKnM > 100);
  assert.equal(cell(record, 'beam.usablePhiMnKnM').availability, 'gated');
  assert.match(cell(record, 'beam.usablePhiMnKnM').reason, /0\.004/);
  assert.equal(cell(record, 'beam.momentUtilization').value, null);
  assert.equal(cell(record, 'beam.usablePhiVnKn').availability, 'gated');
  assert.equal(cell(record, 'beam.shearUtilization').value, null);
  assert.match(cell(record, 'beam.shearUtilization').reason, /Vs/);
  project = updateActiveScenario(fresh(), { beamInputs: { widthMm: 800, heightMm: 300,
    tensionBarDiameterMm: 32, tensionBarCount: 10, externalMuKnM: 1 } }, source);
  record = buildComparison(project, source);
  assert.equal(record.entries[0].results.beam.phiMnKnM, null);
  assert.equal(cell(record, 'beam.usablePhiMnKnM').availability, 'gated');
  assert.match(cell(record, 'beam.usablePhiMnKnM').reason, /ไม่คืนค่า Mn/);
});

test('missing Su stays missing and effective cases never pair with an undrained case', () => {
  let project = saved();
  project = updateActiveScenario(project, { soilInputs: { mode: 'undrained', undrainedStrengthKpa: null } }, source);
  let record = buildComparison(project, source);
  assert.equal(record.entries.at(-1).results.soil, null);
  assert.match(record.entries.at(-1).results.soilError, /Su/);
  assert.equal(cell(record, 'soil.undrained.factorOfSafety').availability, 'missing');
  assert.equal(cell(record, 'soil.dry.factorOfSafety').availability, 'not-applicable');
  assert.equal(cell(record, 'soil.parallel-seepage.factorOfSafety').value, null);
  project = updateActiveScenario(project, { soilInputs: { undrainedStrengthKpa: 30 } }, source);
  record = buildComparison(project, source);
  near(cell(record, 'soil.undrained.factorOfSafety').value, 2.175);
  assert.equal(cell(record, 'soil.undrained.factorOfSafety').status, 'illustrative');
  assert.equal(cell(record, 'soil.undrained.factorOfSafety').delta, null);
  assert.equal(cell(record, 'soil.dry.factorOfSafety').delta, null);
  const result = record.entries.at(-1).results.soil.cases[0];
  assert.equal(result.id, 'undrained');
  assert.equal(result.porePressureKpa, null);
  assert.equal(result.effectiveNormalStressKpa, null);
  assert.equal(cell(record, 'input.soilInputs.frictionAngleDeg').value, 32);
  assert.match(cell(record, 'input.soilInputs.frictionAngleDeg').reason, /ไม่ใช้/);
});

test('shared slope updates geometry and the corresponding soil cases without inferring beam loads', () => {
  let project = saved();
  project = updateActiveScenario(project, { geometry: { slopeH: 3.5 } }, source);
  const record = buildComparison(project, source);
  near(cell(record, 'geometry.run').value, 45.5);
  near(cell(record, 'geometry.run').delta, 13);
  near(cell(record, 'soil.dry.factorOfSafety').value, 2.1870427316826464);
  near(cell(record, 'soil.parallel-seepage.factorOfSafety').value, 1.1146646014498651);
  assert.equal(cell(record, 'soil.parallel-seepage.factorOfSafety').status, 'illustrative');
  assert.deepEqual(record.entries[0].results.beam, record.entries[1].results.beam);
  assert.equal(cell(record, 'beam.MuKnM').value, null);
  assert.deepEqual(record.changedInputs.map(item => item.path), ['geometry.slopeH']);
});

test('different modeled lengths qualify total quantities and leave per-length quantities unchanged', () => {
  let project = saved();
  project = updateActiveScenario(project, { geometry: { length: 500 } }, source);
  const record = buildComparison(project, source);
  near(cell(record, 'materials.rockVolume').value, 8750.892811593569);
  near(cell(record, 'materials.rockVolume').deltaPercent, -50);
  assert.equal(cell(record, 'materials.rockArea').delta, 0);
  assert.equal(cell(record, 'materials.sandMinArea').delta, 0);
  assert.equal(cell(record, 'materials.toeArea').delta, 0);
  assert.equal(cell(record, 'materials.geotextilePerLength').delta, 0);
  assert.equal(cell(record, 'soil.dry.factorOfSafety').delta, 0);
  assert.equal(cell(record, 'beam.usablePhiVnKn').delta, 0);
  assert.match(row(record, 'materials.rockVolume').reason, /1000 \/ 500/);
  assert.match(cell(record, 'materials.rockVolume').reason, /L = 500 m/);
  assert.ok(record.notices.some(item => /ความยาว.*ต่างกัน/.test(item)));
  assert.equal(record.metadata.station.effectiveLength, 12.5);
});

test('full context is traceable but cannot change engineering results or carry references across stations', () => {
  let project = saved();
  const note = 'รายละเอียดจากผู้ใช้ — '.repeat(60);
  project = updateActiveScenario(project, { context: { waterHighLevel: 100, waterLowLevel: 90,
    groundwaterLevel: 95, boreholeReference: 'BH-02', waterReference: 'Water source', sourceNote: note } }, source);
  let record = buildComparison(project, source);
  assert.deepEqual(record.entries[0].results, record.entries[1].results);
  assert.equal(cell(record, 'input.context.sourceNote').value, note);
  assert.equal(record.changedInputs.find(item => item.path === 'context.sourceNote').values.current, note);
  assert.match(cell(record, 'input.context.groundwaterLevel').reason, /ไม่แปลง/);
  project = selectStation(project, stationCatalog(source)[1].id, source);
  record = buildComparison(project, source);
  assert.equal(record.entries.length, 1);
  assert.equal(record.metadata.referenceId, null);
  assert.equal(record.metadata.station.id, stationCatalog(source)[1].id);
  assert.equal(record.entries[0].scenario.context.sourceNote, '');
});

test('invalid project, saved geometry and numerical domains are rejected rather than becoming missing results', () => {
  const unknown = fresh(); unknown.selectedStationId = 'r1-row999';
  assert.throws(() => buildComparison(unknown, source), RangeError);
  const impossible = saved();
  Object.assign(impossible.stationComparisons[impossible.selectedStationId].alternatives[0].scenario.beamInputs,
    { heightMm: 150, coverMm: 65, stirrupSpacingMm: 18 });
  assert.throws(() => buildComparison(impossible, source), /เหล็กบนและล่าง/);
  for (const [section, patch] of [
    ['beamInputs', { stirrupSpacingMm: Number.MIN_VALUE }],
    ['soilInputs', { verticalDepthM: 1e-310, effectiveCohesionKpa: 1 }],
    ['soilInputs', { effectiveCohesionKpa: null }],
  ]) {
    const invalid = fresh();
    invalid.stationScenarios[invalid.selectedStationId] = getActiveScenario(invalid);
    Object.assign(invalid.stationScenarios[invalid.selectedStationId][section], patch);
    assert.throws(() => buildComparison(invalid, source), RangeError);
  }
});

test('percentage overflow is explicitly unavailable while finite scenario results remain finite', () => {
  let project = saved();
  project = updateActiveScenario(project, { soilInputs: { verticalDepthM: 1e-305, effectiveCohesionKpa: 1000 } }, source);
  const record = buildComparison(project, source);
  assert.ok(cell(record, 'soil.dry.factorOfSafety').value > 1e307);
  assert.ok(Number.isFinite(cell(record, 'soil.dry.factorOfSafety').delta));
  assert.equal(cell(record, 'soil.dry.factorOfSafety').deltaPercent, null);
  assert.match(cell(record, 'soil.dry.factorOfSafety').reason, /ร้อยละเกินช่วงตัวเลข/);
  assertFiniteNumbers(record);
});

test('CSV includes complete provenance, explicit missing states and zero without spreadsheet formula injection', () => {
  const note = ' \t=HYPERLINK("https://example.test","x")\nบรรทัดสอง, "ข้อความ"';
  let project = updateActiveScenario(fresh(), { geometry: { crestLevel: -80, toeLevel: -93 },
    beamInputs: { externalVuKn: 0 }, context: { sourceNote: note, waterReference: '@SUM(1,2)', boreholeReference: '-1+2' } }, source);
  project = saved(project, 'alt-csv-001', '=2+3');
  const record = buildComparison(project, source), text = comparisonCSV(record);
  assert.equal(text.charCodeAt(0), 0xfeff);
  const csv = readCSV(text);
  assert.equal(csv.length, record.rows.length * record.entries.length);
  assert.ok(csv.every(item => item.project_revision === record.metadata.projectRevision));
  assert.ok(csv.every(item => item.reference_id === 'alt-csv-001'));
  assert.ok(csv.every(item => item.source_effective_length_m === '12.5'));
  assert.ok(csv.filter(item => item.entry_id === 'alt-csv-001').every(item => item.entry_name === "'=2+3"));
  const find = id => csv.find(item => item.entry_id === 'current' && item.metric_id === id);
  assert.equal(find('input.context.sourceNote').value, "'" + note);
  assert.equal(find('input.context.waterReference').value, "'@SUM(1,2)");
  assert.equal(find('input.context.boreholeReference').value, "'-1+2");
  assert.equal(find('input.geometry.crestLevel').value, '-80');
  assert.equal(find('beam.MuKnM').value, '');
  assert.equal(find('beam.MuKnM').availability, 'missing');
  assert.equal(find('beam.VuKn').value, '0');
  assert.equal(find('beam.VuKn').availability, 'computed');
  assert.equal(find('beam.usablePhiMnKnM').availability, 'gated');
  assert.equal(find('beam.usablePhiMnKnM').delta, '');
  const tampered = clone(record);
  tampered.rows[0].cells.current.value = Infinity;
  assert.throws(() => comparisonCSV(tampered), /NaN|Infinity/);
});
