import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, updateActiveScenario, serializeProject } from '../projects/s6006/project.js';
import { buildStudy } from '../projects/s6006/studies.js';

// Independent numerical oracles for the study adapter. Expected answers below
// are algebraic reductions or 60-digit Decimal hand calculations, not values
// obtained by calling calculateBeam/calculateSoil in these tests.
const source = JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json', import.meta.url), 'utf8'));
const near = (actual, expected, message = '') => {
  assert.equal(typeof actual, 'number', message || 'An available numerical result is required');
  assert.ok(Number.isFinite(actual), message || 'Numerical results must stay finite');
  assert.ok(Math.abs(actual - expected) <= 2e-11 * Math.max(1, Math.abs(expected)),
    `${message}: ${actual} differs from independent expected ${expected}`);
};
const metric = (point, id) => {
  assert.ok(Object.hasOwn(point.metrics, id), `Expected metric ${id}`);
  return point.metrics[id];
};
const value = (point, id) => {
  const result = metric(point, id);
  assert.equal(result.availability, 'computed', `${id}: ${result.reason}`);
  return result.value;
};
const fresh = patch => updateActiveScenario(createProject(source), patch, source);
const run = (project, parameterId, minimum, maximum, sampleCount) => buildStudy(project, source, {
  stationId: project.selectedStationId, scenarioId: 'current',
  parameterId, minimum, maximum, sampleCount,
});
const effective = (patch = {}) => fresh({
  geometry: { slopeH: 2 },
  soilInputs: {
    mode: 'effective', verticalDepthM: 2, unitWeightKnM3: 20,
    saturatedUnitWeightKnM3: 20, waterUnitWeightKnM3: 10,
    frictionAngleDeg: 45, effectiveCohesionKpa: 5,
    ...patch,
  },
});
const undrained = (strength = 30) => fresh({
  geometry: { slopeH: 2 },
  soilInputs: {
    mode: 'undrained', verticalDepthM: 2, unitWeightKnM3: 20,
    saturatedUnitWeightKnM3: 20, waterUnitWeightKnM3: 10,
    frictionAngleDeg: null, effectiveCohesionKpa: null,
    undrainedStrengthKpa: strength,
  },
});
const beamBenchmark = () => fresh({ beamInputs: {
  widthMm: 300, heightMm: 550, coverMm: 30,
  stirrupDiameterMm: 10, tensionBarDiameterMm: 20, tensionBarCount: 3,
  stirrupLegs: 2, stirrupSpacingMm: 200,
  fcKsc: 25 / 0.0980665, fyKsc: 400 / 0.0980665, fyvKsc: 250 / 0.0980665,
  externalMuKnM: 100, externalVuKn: 50,
} });

test('study effective-stress slope samples match an independent rational hand table', () => {
  const project = effective(), before = serializeProject(project, source);
  const study = run(project, 'geometry.slopeH', 0.5, 3, 6);
  // tan45°=1, c/(gamma*z)=1/8 and gamma_w/gamma_sat=1/2.
  // Fdry=m+(m+1/m)/8; Fparallel=m/2+(m+1/m)/8.
  const xs = [0.5, 1, 1.5, 2, 2.5, 3];
  const dry = [13 / 16, 5 / 4, 85 / 48, 37 / 16, 229 / 80, 41 / 12];
  const seepage = [9 / 16, 3 / 4, 49 / 48, 21 / 16, 129 / 80, 23 / 12];
  assert.deepEqual(study.samples.map(point => point.x), xs);
  study.samples.forEach((point, i) => {
    near(value(point, 'soil.dry.fs'), dry[i], `dry m=${xs[i]}`);
    near(value(point, 'soil.parallel-seepage.fs'), seepage[i], `parallel m=${xs[i]}`);
    assert.equal(metric(point, 'soil.undrained.fs').availability, 'not-applicable');
    assert.equal(metric(point, 'soil.undrained.fs').value, null);
  });
  near(study.baseline.x, 2);
  near(value(study.baseline, 'soil.dry.fs'), 37 / 16);
  near(value(study.baseline, 'soil.parallel-seepage.fs'), 21 / 16);
  assert.equal(serializeProject(project, source), before, 'Trial runs must leave the working project unchanged');
});

test('study undrained slope results preserve the nonmonotonic fixed-vertical-depth mechanism', () => {
  const study = run(undrained(), 'geometry.slopeH', 0.5, 3, 6);
  // Su/(gamma_sat*z)=30/40=3/4, so F=(3/4)(m+1/m).
  const expected = [15 / 8, 3 / 2, 13 / 8, 15 / 8, 87 / 40, 5 / 2];
  study.samples.forEach((point, i) => {
    near(value(point, 'soil.undrained.fs'), expected[i]);
    assert.equal(metric(point, 'soil.dry.fs').availability, 'not-applicable');
    assert.equal(metric(point, 'soil.parallel-seepage.fs').availability, 'not-applicable');
    assert.equal(point.results.soil.cases[0].porePressureKpa, null);
    assert.equal(point.results.soil.cases[0].effectiveNormalStressKpa, null);
  });
  assert.ok(expected[0] > expected[1] && expected[2] > expected[1],
    'The method has its minimum at 45 degrees for this fixed vertical depth; no blanket monotonic claim');
});

test('study cohesionless depth sweeps preserve both independent constant FS answers', () => {
  const study = run(effective({ effectiveCohesionKpa: 0 }), 'soilInputs.verticalDepthM', 1, 5, 5);
  for (const point of study.samples) {
    near(value(point, 'soil.dry.fs'), 2);
    near(value(point, 'soil.parallel-seepage.fs'), 1);
    near(metric(point, 'soil.dry.fs').delta, 0);
    near(metric(point, 'soil.parallel-seepage.fs').delta, 0);
  }
});

test('study cohesive depth sweeps reduce only the cohesive contribution', () => {
  const study = run(effective(), 'soilInputs.verticalDepthM', 1, 4, 4);
  // m=2 gives (m+1/m)c/gamma=5/8; frictional terms are 2 and 1.
  const dry = [21 / 8, 37 / 16, 53 / 24, 69 / 32];
  const seepage = [13 / 8, 21 / 16, 29 / 24, 37 / 32];
  study.samples.forEach((point, i) => {
    near(value(point, 'soil.dry.fs'), dry[i]);
    near(value(point, 'soil.parallel-seepage.fs'), seepage[i]);
  });
  near(value(study.samples[1], 'soil.dry.fs') - 2,
    (value(study.samples[0], 'soil.dry.fs') - 2) / 2);
});

test('study explicit Su trials calculate against a missing baseline without inventing its value', () => {
  const project = undrained(null), before = serializeProject(project, source);
  const study = run(project, 'soilInputs.undrainedStrengthKpa', 0, 30, 4);
  const baseline = metric(study.baseline, 'soil.undrained.fs');
  assert.equal(study.baseline.x, null);
  assert.equal(baseline.availability, 'missing');
  assert.equal(baseline.value, null);
  for (const [i, point] of study.samples.entries()) {
    const result = metric(point, 'soil.undrained.fs');
    near(value(point, 'soil.undrained.fs'), [0, 5 / 8, 5 / 4, 15 / 8][i]);
    assert.equal(result.delta, null);
    assert.equal(result.deltaPercent, null);
  }
  assert.equal(serializeProject(project, source), before);
});

test('study real zero Su baseline retains zero and absolute differences without a percentage denominator', () => {
  const study = run(undrained(0), 'soilInputs.undrainedStrengthKpa', 0, 30, 4);
  near(value(study.baseline, 'soil.undrained.fs'), 0);
  for (const [i, point] of study.samples.entries()) {
    const expected = [0, 5 / 8, 5 / 4, 15 / 8][i];
    near(value(point, 'soil.undrained.fs'), expected);
    near(metric(point, 'soil.undrained.fs').delta, expected);
    assert.equal(metric(point, 'soil.undrained.fs').deltaPercent, null);
  }
});

test('study undrained unit-weight sweep matches inverse-weight scaling with all other inputs fixed', () => {
  const study = run(undrained(), 'soilInputs.saturatedUnitWeightKnM3', 20, 30, 3);
  // Su*(m+1/m)/z=37.5, with gamma_sat equal to 20, 25, 30.
  [15 / 8, 3 / 2, 5 / 4].forEach((expected, i) => near(value(study.samples[i], 'soil.undrained.fs'), expected));
});

test('study shear-spacing curve matches independent hand capacities across the detailing discontinuity', () => {
  const study = run(beamBenchmark(), 'beamInputs.stirrupSpacingMm', 100, 400, 7);
  // d=500 mm, Av=50*pi mm², Vc=125 kN, Vs=6250*pi/s kN.
  // Independently evaluated at 60 decimal digits. The spacing gate is s<=250.
  const expected = [
    241.0121556370215580529364085912,
    191.9247704246810387019576057275,
    167.3810778185107790264682042956,
    152.6548622548086232211745634365,
    46.875, 46.875, 46.875,
  ];
  const flexure = 159.6138407026238868220733;
  study.samples.forEach((point, i) => {
    near(value(point, 'beam.usablePhiVnKn'), expected[i], `shear s=${point.x}`);
    near(value(point, 'beam.usablePhiMnKnM'), flexure);
    near(value(point, 'beam.shearUtilization'), 50 / expected[i]);
    near(value(point, 'beam.momentUtilization'), 100 / flexure);
    near(point.results.beam.VcKn, 125);
    if (point.x > 250) {
      assert.ok(point.results.beam.phiVnKn > expected[i], 'The unrestricted intermediate is not the usable capacity');
      assert.equal(point.results.beam.checks.find(row => row.id === 'stirrup-spacing').status, 'review');
    }
  });
  near(value(study.baseline, 'beam.usablePhiVnKn'), expected[2]);
});

test('study flexure curve removes usable capacity when tensile strain drops below its gate', () => {
  const project = fresh({ beamInputs: {
    widthMm: 350, tensionBarDiameterMm: 25, tensionBarCount: 5, externalMuKnM: 100,
  } });
  const study = run(project, 'beamInputs.tensionBarDiameterMm', 25, 26, 3);
  // 60-digit Decimal independent calculation, pi explicitly provided to 59 decimals.
  // Intermediate phiMn rises while epsilon_t crosses below 0.004.
  const strains = [0.004164357662436419726617870459, 0.003882257626651284056985956138, 0.003616349858634959448186489527];
  const rawCapacities = [290.4512565894968928655796810, 290.9766669334179915726848271, 291.4547248968716186613519570];
  study.samples.forEach((point, i) => {
    near(point.results.beam.tensionStrain, strains[i]);
    near(point.results.beam.phiMnKnM, rawCapacities[i]);
    if (i === 0) near(value(point, 'beam.usablePhiMnKnM'), rawCapacities[i]);
    else {
      for (const id of ['beam.usablePhiMnKnM', 'beam.momentUtilization']) {
        assert.equal(metric(point, id).availability, 'gated');
        assert.equal(metric(point, id).value, null);
        assert.equal(metric(point, id).delta, null);
        assert.equal(metric(point, id).deltaPercent, null);
      }
      assert.equal(point.results.beam.checks.find(row => row.id === 'flexural-strain').status, 'review');
    }
  });
});

test('study retains the exact two-face reinforcement-fit boundary as an invalid sample', () => {
  const study = run(createProject(source), 'beamInputs.heightMm', 140, 142, 3);
  // 2(cover40+stirrup6+bar12)+clear25 = 141 mm for the displayed two-face arrangement.
  assert.deepEqual(study.samples.map(point => point.x), [140, 141, 142]);
  assert.equal(metric(study.samples[0], 'beam.usablePhiMnKnM').availability, 'invalid');
  assert.equal(metric(study.samples[0], 'beam.usablePhiMnKnM').value, null);
  assert.equal(study.samples[0].results.beam, null);
  assert.ok(study.samples[0].errors.some(error => error.availability === 'invalid'));
  for (const point of study.samples.slice(1)) {
    near(point.results.beam.effectiveDepthMm, point.x - 52);
    assert.equal(metric(point, 'beam.usablePhiMnKnM').availability, 'computed');
  }
  near(study.baseline.x, 500, 'The original baseline remains separately evaluated outside the requested interval');
});
