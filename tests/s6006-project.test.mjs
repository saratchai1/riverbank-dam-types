import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_INPUTS } from '../projects/s6006/engine.js';
import { calculateBeam, calculateSoil } from '../projects/s6006/engineering.js';
import {
  PROJECT_SCHEMA, PROJECT_VERSION, CALCULATION_REVISION, PROJECT_MAX_BYTES,
  createProject, createDefaultScenario, stationCatalog, getScenario, getActiveScenario,
  getSoilInputs, validateProject, updateActiveScenario, selectStation,
  projectRevision, scenarioRevision, isBaselineScenario, serializeProject, parseProject,
} from '../projects/s6006/project.js';

const source = JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json', import.meta.url), 'utf8'));
const catalog = stationCatalog(source);
const first = catalog[0].id, second = catalog[1].id, last = catalog.at(-1).id;
const fresh = () => createProject(source);
const copy = value => JSON.parse(JSON.stringify(value));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('unified project uses the 41 original BOQ row identities without inventing profiles', () => {
  const before = JSON.stringify(source);
  const p = fresh();
  assert.equal(p.schema, PROJECT_SCHEMA);
  assert.equal(p.version, PROJECT_VERSION);
  assert.equal(p.calculationRevision, CALCULATION_REVISION);
  assert.equal(p.selectedStationId, 'r1-row14');
  assert.deepEqual(p.stationScenarios, {});
  assert.equal(catalog.length, 41);
  assert.deepEqual(catalog[0], { id: 'r1-row14', reach: 1, station: 0,
    sourceRow: 14, sourceSheet: 'หาปริมาณวัสดุ', effectiveLength: 12.5 });
  assert.equal(catalog[11].station, 275);
  assert.equal(catalog[11].effectiveLength, 23.5);
  assert.equal(catalog[12].station, 300);
  assert.equal(catalog[12].effectiveLength, 26.5);
  assert.equal(catalog.at(-1).station, 1000);
  assert.equal(catalog.filter(row => row.reach === 1).reduce((sum, row) => sum + row.effectiveLength, 0), 286);
  assert.equal(catalog.filter(row => row.reach === 2).reduce((sum, row) => sum + row.effectiveLength, 0), 714);
  assert.equal(JSON.stringify(source), before);
  assert.equal('survey' in p, false);
  assert.equal('alignment' in p, false);
  assert.equal('boreholes' in p, false);
  assert.equal(validateProject(p, source).valid, true);
});

test('default engineering and missing field context preserve the reviewed R2 state', () => {
  const scenario = getActiveScenario(fresh());
  assert.deepEqual(scenario.geometry, DEFAULT_INPUTS);
  assert.equal('slopeH' in scenario.soilInputs, false);
  assert.equal(scenario.beamInputs.externalMuKnM, null);
  assert.equal(scenario.beamInputs.externalVuKn, null);
  assert.equal(scenario.soilInputs.undrainedStrengthKpa, null);
  assert.deepEqual(scenario.context, { waterHighLevel: null, waterLowLevel: null,
    groundwaterLevel: null, boreholeReference: '', waterReference: '', sourceNote: '' });
  const beam = calculateBeam(scenario.beamInputs), soil = calculateSoil(getSoilInputs(scenario));
  near(beam.phiMnKnM, 34.965780115954324);
  assert.equal(beam.usablePhiMnKnM, null);
  near(beam.usablePhiVnKn, 31.766401826458086);
  near(soil.cases[0].factorOfSafety, 1.5621733797733184);
  near(soil.cases[1].factorOfSafety, 0.7961890010356177);
  assert.equal(beam.projectApproved, false);
  assert.equal(soil.projectApproved, false);
  assert.equal(isBaselineScenario(scenario), true);
});

test('one geometry slope drives the active soil calculation after editing and reopening', () => {
  const original = fresh();
  const changed = updateActiveScenario(original, { geometry: { slopeH: 3 } }, source);
  const restored = parseProject(serializeProject(changed, source), source).project;
  const scenario = getActiveScenario(restored), soilInputs = getSoilInputs(scenario);
  assert.equal(scenario.geometry.slopeH, 3);
  assert.equal('slopeH' in scenario.soilInputs, false);
  assert.equal(soilInputs.slopeH, 3);
  near(calculateSoil(soilInputs).cases[0].factorOfSafety, 3 * Math.tan(32 * Math.PI / 180));
  assert.equal(getActiveScenario(original).geometry.slopeH, 2.5);
  assert.throws(() => updateActiveScenario(changed, { soilInputs: { slopeH: 2 } }, source), /slopeH/);
});

test('station selection preserves independent accepted scenarios and original source quantities', () => {
  const originalSource = JSON.stringify(source);
  let p = updateActiveScenario(fresh(), { geometry: { slopeH: 3 }, beamInputs: { externalMuKnM: 30 } }, source);
  const atFirst = getActiveScenario(p);
  p = selectStation(p, last, source);
  assert.equal(isBaselineScenario(getActiveScenario(p)), true);
  p = updateActiveScenario(p, { geometry: { slopeH: 4 }, soilInputs: { effectiveCohesionKpa: 5 },
    context: { boreholeReference: 'BH user reference only', sourceNote: 'ข้อมูลทดลอง ไม่มีรูปตัดสำรวจ' } }, source);
  assert.deepEqual(getScenario(p, first), atFirst);
  assert.equal(getScenario(p, last).geometry.slopeH, 4);
  assert.equal(getScenario(p, second).geometry.slopeH, 2.5);
  p = selectStation(p, first, source);
  assert.deepEqual(getActiveScenario(p), atFirst);
  assert.equal(JSON.stringify(source), originalSource);
});

test('one saved project restores selection, all station scenarios and evidence text', () => {
  let p = updateActiveScenario(fresh(), { geometry: { length: 150, slopeH: 3 },
    beamInputs: { tensionBarDiameterMm: 16, stirrupDiameterMm: 8, externalMuKnM: 30 },
    context: { waterHighLevel: 99.1, waterLowLevel: 87.4, groundwaterLevel: 94.2,
      waterReference: 'ระดับสมมติ / เอกสารน้ำที่ผู้ใช้ระบุ', boreholeReference: 'BH-01 user supplied', sourceNote: 'ฉบับทดสอบ R2' } }, source);
  p = selectStation(p, last, source);
  p = updateActiveScenario(p, { soilInputs: { mode: 'undrained', undrainedStrengthKpa: 30 },
    beamInputs: { externalVuKn: 10 }, context: { sourceNote: 'สถานีปลาย' } }, source);
  const serialized = serializeProject(p, source), parsed = parseProject(serialized, source);
  assert.equal(parsed.migrated, false);
  assert.deepEqual(parsed.notices, []);
  assert.deepEqual(parsed.project, p);
  assert.equal(parsed.project.selectedStationId, last);
  assert.equal(getScenario(parsed.project, first).context.groundwaterLevel, 94.2);
  assert.equal(getActiveScenario(parsed.project).soilInputs.undrainedStrengthKpa, 30);
  assert.equal(projectRevision(parsed.project), projectRevision(p));
  assert.equal('beamResults' in parsed.project, false);
  assert.equal('soilResults' in parsed.project, false);
  assert.equal('projectApproved' in parsed.project, false);
  assert.ok(new TextEncoder().encode(serialized).byteLength < PROJECT_MAX_BYTES);
});

test('project and scenario revisions react to content but not current station selection', () => {
  const p = fresh(), revision = projectRevision(p), baseline = scenarioRevision(getActiveScenario(p));
  assert.equal(projectRevision(selectStation(p, last, source)), revision);
  assert.equal(scenarioRevision(getActiveScenario(selectStation(p, last, source))), baseline);
  for (const patch of [
    { geometry: { slopeH: 3 } }, { beamInputs: { externalMuKnM: 30 } },
    { soilInputs: { frictionAngleDeg: 30 } }, { context: { waterReference: 'new reference' } },
  ]) {
    const changed = updateActiveScenario(p, patch, source);
    assert.notEqual(projectRevision(changed), revision);
    assert.notEqual(scenarioRevision(getActiveScenario(changed)), baseline);
    assert.equal(isBaselineScenario(getActiveScenario(changed)), false);
  }
  const elsewhere = updateActiveScenario(selectStation(p, last, source), { context: { sourceNote: 'other station' } }, source);
  assert.notEqual(projectRevision(elsewhere), revision);
  assert.equal(scenarioRevision(getScenario(elsewhere, first)), baseline);
});

test('revision is independent of key order and redundant explicit defaults', () => {
  const p = fresh(), explicit = copy(p);
  explicit.stationScenarios[first] = createDefaultScenario();
  assert.equal(projectRevision(explicit), projectRevision(p));
  assert.equal(serializeProject(explicit, source), serializeProject(p, source));
  const changed = updateActiveScenario(p, { geometry: { slopeH: 3 }, context: { sourceNote: 'A' } }, source);
  const reordered = Object.fromEntries(Object.entries(changed).reverse());
  reordered.stationScenarios = { [first]: Object.fromEntries(Object.entries(changed.stationScenarios[first]).reverse()) };
  assert.equal(projectRevision(reordered), projectRevision(changed));
  assert.equal(scenarioRevision(getActiveScenario(reordered)), scenarioRevision(getActiveScenario(changed)));
});

test('returning a scenario to baseline removes its override without changing other stations', () => {
  let p = updateActiveScenario(fresh(), { geometry: { slopeH: 3 } }, source);
  p = selectStation(p, last, source);
  p = updateActiveScenario(p, { beamInputs: { coverMm: 50 } }, source);
  p = selectStation(p, first, source);
  p = updateActiveScenario(p, { geometry: { slopeH: 2.5 } }, source);
  assert.equal(first in p.stationScenarios, false);
  assert.equal(getScenario(p, last).beamInputs.coverMm, 50);
});

test('undrained Su may remain unknown through save/reopen without inventing a result', () => {
  const p = updateActiveScenario(fresh(), { soilInputs: { mode: 'undrained',
    undrainedStrengthKpa: null, effectiveCohesionKpa: null, frictionAngleDeg: null } }, source);
  const validation = validateProject(p, source);
  assert.equal(validation.valid, true);
  assert.match(validation.warnings.join(' '), /Su/);
  const parsed = parseProject(serializeProject(p, source), source).project;
  const inputs = getSoilInputs(getActiveScenario(parsed));
  assert.equal(inputs.undrainedStrengthKpa, null);
  assert.equal(inputs.effectiveCohesionKpa, null);
  assert.equal(inputs.frictionAngleDeg, null);
  assert.throws(() => calculateSoil(inputs), /Su/);
  const completed = updateActiveScenario(parsed, { soilInputs: { undrainedStrengthKpa: 30 } }, source);
  near(calculateSoil(getSoilInputs(getActiveScenario(completed))).cases[0].factorOfSafety, 2.175);
});

test('pending Su does not bypass other soil validation or the R2 numerical boundary', () => {
  const p = updateActiveScenario(fresh(), { soilInputs: { mode: 'undrained', undrainedStrengthKpa: null } }, source);
  for (const soilInputs of [
    { unitWeightKnM3: '20' }, { unitWeightKnM3: null }, { verticalDepthM: 0 },
    { verticalDepthM: 1e-310 }, { saturatedUnitWeightKnM3: 9 },
    { waterUnitWeightKnM3: -1 }, { effectiveCohesionKpa: -1 }, { frictionAngleDeg: 70 },
  ]) assert.throws(() => updateActiveScenario(p, { soilInputs }, source));
  assert.equal(getActiveScenario(p).soilInputs.verticalDepthM, 2);
});

test('unified drafts retain minimum-steel gating and reject impossible reinforcement fit', () => {
  const gated = updateActiveScenario(fresh(), { beamInputs: { externalMuKnM: 30 } }, source);
  const output = calculateBeam(getActiveScenario(gated).beamInputs);
  assert.equal(output.usablePhiMnKnM, null);
  assert.equal(output.externalDemand.momentUtilization, null);
  assert.equal(output.checks.find(row => row.id === 'external-moment').status, 'review');
  assert.throws(() => updateActiveScenario(gated, { beamInputs: { heightMm: 150, coverMm: 65 } }, source), /เหล็กบนและล่าง/);
  assert.throws(() => updateActiveScenario(gated, { beamInputs: { stirrupSpacingMm: 1e-310 } }, source));
  const detailed = updateActiveScenario(gated, { beamInputs: { tensionBarDiameterMm: 16, stirrupDiameterMm: 8 } }, source);
  const acceptable = calculateBeam(getActiveScenario(detailed).beamInputs);
  assert.ok(acceptable.usablePhiMnKnM > 30);
  assert.equal(acceptable.checks.find(row => row.id === 'external-moment').status, 'satisfied');
  assert.equal(acceptable.projectApproved, false);
});

test('water context remains nullable evidence and does not fabricate pore-pressure analysis', () => {
  const p = fresh(), before = calculateSoil(getSoilInputs(getActiveScenario(p)));
  const edited = updateActiveScenario(p, { context: { waterHighLevel: 99.1, waterLowLevel: 87.4, groundwaterLevel: 94 } }, source);
  assert.equal(validateProject(edited, source).valid, true);
  assert.match(validateProject(edited, source).warnings.join(' '), /datum/);
  assert.deepEqual(calculateSoil(getSoilInputs(getActiveScenario(edited))), before);
  for (const context of [
    { waterHighLevel: 80, waterLowLevel: 90 }, { waterHighLevel: '99.1' },
    { groundwaterLevel: Number.NaN }, { groundwaterLevel: Infinity },
    { waterLowLevel: -100001 }, { boreholeReference: 12 }, { sourceNote: 'x'.repeat(2001) },
  ]) assert.throws(() => updateActiveScenario(p, { context }, source));
  const sameLevel = updateActiveScenario(p, { context: { waterHighLevel: 90, waterLowLevel: 90 } }, source);
  assert.equal(validateProject(sameLevel, source).valid, true);
});

test('legacy geometry files migrate with explicit notice and missing context preserved', () => {
  const legacy = { schema: 'riverbank.s6006.case', version: 1, projectCode: 'S6006',
    inputs: { ...DEFAULT_INPUTS, slopeH: 3, length: 500 } };
  const parsed = parseProject(JSON.stringify(legacy), source);
  assert.equal(parsed.migrated, true);
  assert.match(parsed.notices.join(' '), /ไฟล์เดิมไม่มีค่าคาน/);
  assert.equal(parsed.project.selectedStationId, first);
  assert.equal(getActiveScenario(parsed.project).geometry.slopeH, 3);
  assert.equal(getActiveScenario(parsed.project).geometry.length, 500);
  assert.equal(getActiveScenario(parsed.project).context.waterHighLevel, null);
  assert.equal(getActiveScenario(parsed.project).beamInputs.externalMuKnM, null);
  assert.deepEqual(getScenario(parsed.project, second), createDefaultScenario());
  assert.equal(parseProject(serializeProject(parsed.project, source), source).migrated, false);
  assert.throws(() => parseProject(JSON.stringify({ ...legacy, beamInputs: {} }), source));
  assert.throws(() => parseProject(JSON.stringify({ ...legacy, version: 2 }), source));
  assert.throws(() => parseProject(JSON.stringify({ ...legacy, inputs: { ...legacy.inputs, slopeH: 0 } }), source));
});

test('legacy R2 engineering files recover inputs and recompute rather than trust cached capacities', () => {
  const baseline = createDefaultScenario();
  const legacy = { schema: 'riverbank.s6006.engineering', version: 1,
    calculationRevision: CALCULATION_REVISION,
    beamInputs: { ...baseline.beamInputs, externalMuKnM: 30 },
    soilInputs: { ...getSoilInputs(baseline), slopeH: 3 },
    beamResults: { usablePhiMnKnM: 999, projectApproved: true },
    soilResults: { cases: [{ factorOfSafety: 999 }], projectApproved: true },
    scope: 'Untrusted cached scenario results',
  };
  const parsed = parseProject(JSON.stringify(legacy), source), scenario = getActiveScenario(parsed.project);
  assert.equal(parsed.migrated, true);
  assert.match(parsed.notices.join(' '), /คำนวณผลใหม่/);
  assert.equal(parsed.project.selectedStationId, first);
  assert.equal(scenario.geometry.slopeH, 3);
  assert.equal(scenario.geometry.crestLevel, DEFAULT_INPUTS.crestLevel);
  assert.equal(scenario.geometry.length, DEFAULT_INPUTS.length);
  assert.equal(scenario.beamInputs.externalMuKnM, 30);
  assert.equal('slopeH' in scenario.soilInputs, false);
  assert.equal(scenario.context.waterHighLevel, null);
  const actual = calculateBeam(scenario.beamInputs);
  assert.equal(actual.usablePhiMnKnM, null);
  assert.equal(actual.projectApproved, false);
  assert.equal(actual.checks.find(row => row.id === 'external-moment').status, 'review');
  near(calculateSoil(getSoilInputs(scenario)).cases[0].factorOfSafety, 3 * Math.tan(32 * Math.PI / 180));
  assert.deepEqual(getScenario(parsed.project, last), baseline);
  assert.equal(serializeProject(parsed.project, source).includes('999'), false);
});

test('legacy R2 engineering migration preserves missing Su and rejects invalid actual inputs', () => {
  const baseline = createDefaultScenario();
  const legacy = { schema: 'riverbank.s6006.engineering', version: 1,
    calculationRevision: CALCULATION_REVISION, beamInputs: baseline.beamInputs,
    soilInputs: { ...getSoilInputs(baseline), mode: 'undrained', undrainedStrengthKpa: null },
    beamResults: {}, soilResults: null, scope: 'Draft',
  };
  const imported = parseProject(JSON.stringify(legacy), source).project;
  assert.equal(getActiveScenario(imported).soilInputs.undrainedStrengthKpa, null);
  assert.throws(() => calculateSoil(getSoilInputs(getActiveScenario(imported))), /Su/);
  for (const bad of [
    { ...legacy, calculationRevision: 'S6006-R1' },
    { ...legacy, inputs: DEFAULT_INPUTS },
    { ...legacy, beamInputs: { ...baseline.beamInputs, externalMuKnM: '30' } },
    { ...legacy, soilInputs: { ...legacy.soilInputs, slopeH: 0 } },
    { ...legacy, soilInputs: { ...legacy.soilInputs, verticalDepthM: 1e-310 } },
  ]) assert.throws(() => parseProject(JSON.stringify(bad), source));
});

test('import rejects unknown source station IDs and inactive corrupt scenarios', () => {
  const p = fresh();
  assert.throws(() => selectStation(p, 'r9-row999', source), /ทะเบียน BOQ/);
  assert.throws(() => parseProject(JSON.stringify({ ...p, selectedStationId: 'r9-row999' }), source));
  for (const scenario of [
    { ...createDefaultScenario(), geometry: { ...DEFAULT_INPUTS, slopeH: 0 } },
    { ...createDefaultScenario(), soilInputs: { ...createDefaultScenario().soilInputs, slopeH: 3 } },
    { ...createDefaultScenario(), beamInputs: { ...createDefaultScenario().beamInputs, externalMuKnM: '30' } },
  ]) {
    const bad = { ...p, stationScenarios: { [last]: scenario } };
    assert.equal(validateProject(bad, source).valid, false);
    assert.throws(() => parseProject(JSON.stringify(bad), source));
  }
  assert.equal(validateProject({ ...p, stationScenarios: { 'r9-row999': createDefaultScenario() } }, source).valid, false);
});

test('import does not trust serialized results, approval flags, or mismatched revisions', () => {
  const p = fresh();
  for (const changed of [
    { ...p, version: 999 }, { ...p, calculationRevision: 'S6006-R1' }, { ...p, projectCode: 'OTHER' },
    { ...p, projectApproved: true }, { ...p, beamResults: { usablePhiMnKnM: 999 } },
    { ...p, stationScenarios: { [first]: { ...createDefaultScenario(), soilResults: {} } } },
  ]) assert.throws(() => parseProject(JSON.stringify(changed), source));
  assert.throws(() => parseProject(JSON.stringify({ schema: 'riverbank.s6006.engineering', version: 1 }), source));
});

test('malformed, oversized and prototype-polluting imports are rejected atomically', () => {
  const p = fresh(), before = serializeProject(p, source);
  for (const text of ['{', 'null', '[]', '"text"', ' '.repeat(PROJECT_MAX_BYTES + 1),
    '{"__proto__":{"polluted":true}}',
    JSON.stringify(p).replace('"stationScenarios":{}', '"stationScenarios":{"constructor":{}}'),
  ]) assert.throws(() => parseProject(text, source));
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(serializeProject(p, source), before);
  assert.deepEqual(parseProject('\uFEFF' + before, source).project, p);
});

test('all project entry points reject accessors without executing them', () => {
  let invoked = 0;
  const accessor = fresh();
  Object.defineProperty(accessor, 'selectedStationId', { enumerable: true, get() { invoked++; return first; } });
  assert.equal(validateProject(accessor, source).valid, false);
  assert.throws(() => getActiveScenario(accessor));
  assert.throws(() => projectRevision(accessor));
  assert.throws(() => serializeProject(accessor, source));
  const patch = { context: {} };
  Object.defineProperty(patch.context, 'sourceNote', { enumerable: true, get() { invoked++; return 'injected'; } });
  assert.throws(() => updateActiveScenario(fresh(), patch, source));
  const hidden = fresh();
  Object.defineProperty(hidden, 'hiddenField', { value: 'lost on export' });
  assert.equal(validateProject(hidden, source).valid, false);
  assert.equal(invoked, 0);
});

test('non-JSON values and cyclic or aliased graphs cannot enter saved projects', () => {
  for (const invalid of [new Date(), { ...fresh(), extra: undefined }, { ...fresh(), extra: Symbol('x') },
    { ...fresh(), extra: BigInt(2) }, { ...fresh(), extra: () => true }]) {
    assert.equal(validateProject(invalid, source).valid, false);
  }
  const cyclic = fresh(); cyclic.stationScenarios[first] = cyclic;
  assert.equal(validateProject(cyclic, source).valid, false);
  const shared = createDefaultScenario(), aliased = fresh();
  aliased.stationScenarios[first] = shared; aliased.stationScenarios[last] = shared;
  assert.equal(validateProject(aliased, source).valid, false);
  const deep = fresh(); let cursor = deep;
  for (let i = 0; i < 20; i++) { cursor.extra = {}; cursor = cursor.extra; }
  assert.equal(validateProject(deep, source).valid, false);
});

test('caller mutations cannot change accepted projects or shared default values', () => {
  const p = fresh(), extracted = getActiveScenario(p);
  extracted.geometry.slopeH = 10;
  extracted.context.sourceNote = 'outside edit';
  assert.equal(getActiveScenario(p).geometry.slopeH, 2.5);
  const patch = { context: { sourceNote: 'accepted' } };
  const changed = updateActiveScenario(p, patch, source);
  patch.context.sourceNote = 'later mutation';
  assert.equal(getActiveScenario(changed).context.sourceNote, 'accepted');
  assert.equal(getActiveScenario(p).context.sourceNote, '');
  const invalidPatch = { geometry: { crestLevel: 80 } };
  assert.throws(() => updateActiveScenario(changed, invalidPatch, source));
  assert.equal(getActiveScenario(changed).geometry.crestLevel, 101);
});

test('all 41 stations can retain separate meaningful scenarios in one small project', () => {
  let p = fresh();
  for (const row of catalog) {
    p = selectStation(p, row.id, source);
    p = updateActiveScenario(p, { context: { sourceNote: `ข้อมูลทดลอง ${row.id}` } }, source);
  }
  const text = serializeProject(p, source), reopened = parseProject(text, source).project;
  assert.equal(Object.keys(reopened.stationScenarios).length, 41);
  assert.equal(reopened.selectedStationId, last);
  for (const row of catalog) assert.equal(getScenario(reopened, row.id).context.sourceNote, `ข้อมูลทดลอง ${row.id}`);
  assert.ok(new TextEncoder().encode(text).byteLength < PROJECT_MAX_BYTES / 4);
  assert.equal(projectRevision(reopened), projectRevision(p));
});
