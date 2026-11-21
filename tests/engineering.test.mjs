import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KSC_TO_MPA, TF_TO_KN, DEFAULT_BEAM_INPUTS, DEFAULT_SOIL_INPUTS,
  calculateBeam, calculateSoil, validateBeamInputs, validateSoilInputs,
  soilShearStrength, ENGINEERING_REFERENCES,
} from '../projects/s6006/engineering.js';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(
  typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
  `${actual} differs from independent expected ${expected}`,
);
const check = (result, id) => result.checks.find(item => item.id === id);

test('unit conversion preserves force units and frozen defaults', () => {
  near(KSC_TO_MPA, 0.0980665);
  near(TF_TO_KN, 9.80665);
  assert.ok(Object.isFrozen(DEFAULT_BEAM_INPUTS));
  assert.ok(Object.isFrozen(DEFAULT_SOIL_INPUTS));
  assert.equal(DEFAULT_BEAM_INPUTS.externalMuKnM, null);
  assert.equal(DEFAULT_BEAM_INPUTS.externalVuKn, null);
  assert.equal(DEFAULT_SOIL_INPUTS.undrainedStrengthKpa, null);
  assert.match(ENGINEERING_REFERENCES['USACE-1902'].url, /publications\.usace\.army\.mil/);
});

test('BF1 capacities match independent 40-digit Decimal hand arithmetic', () => {
  const r = calculateBeam(DEFAULT_BEAM_INPUTS);
  near(r.fcMpa, 20.593965);
  near(r.fyMpa, 392.266);
  near(r.fyvMpa, 235.3596);
  near(r.effectiveDepthMm, 448);
  near(r.AsMm2, 226.1946710584651131693103);
  near(r.AvMm2, 56.54866776461627829232758);
  near(r.blockDepthMm, 20.27515258787362358940597);
  near(r.neutralAxisMm, 23.85312069161602775224231);
  near(r.tensionStrain, 0.05334482872810824624557907);
  near(r.yieldStrain, 0.00196133);
  near(r.phiFlexure, 0.9);
  near(r.MnKnM, 38.85086679550480266238614);
  near(r.phiMnKnM, 34.96578011595432239614753);
  near(r.VcKn, 84.71040487055491185868668);
  near(r.VsKn, 29.81276888937307836371082);
  near(r.phiVnKn, 85.89238031994599266679812);
  near(r.usablePhiVnKn, 31.76640182645809194700750);
  near(r.AsMinMm2, 399.7287554873478710874764);
  near(r.AvMinMm2, 70.10548964223256667669388);
  assert.equal(r.formulaRows.length, 22);
  assert.ok(r.formulaRows.every(row => row.sourceKey && row.unit && row.assumption !== undefined));
});

test('BF1 does not turn low selfweight demand into project approval or hide minimum steel', () => {
  const r = calculateBeam(DEFAULT_BEAM_INPUTS);
  near(r.selfWeightKnM, 2.941995);
  near(r.factoredSelfWeightKnM, 4.118793);
  near(r.selfWeightMuKnM, 4.633642125);
  near(r.selfWeightVuKn, 6.1781895);
  assert.equal(r.projectApproved, false);
  assert.equal(check(r, 'minimum-flexural-steel').status, 'review');
  assert.equal(check(r, 'minimum-flexural-exception').status, 'pending');
  assert.equal(check(r, 'minimum-stirrups').status, 'review');
  assert.equal(check(r, 'external-moment').status, 'pending');
  assert.equal(check(r, 'external-shear').status, 'pending');
  assert.equal(check(r, 'selfweight-only').status, 'illustrative');
  assert.equal(r.externalDemand.momentUtilization, null);
  assert.equal(r.externalDemand.shearUtilization, null);
});

test('independent 25MPa/300×550mm benchmark verifies normal rectangular beam mechanics', () => {
  const p = { ...DEFAULT_BEAM_INPUTS, widthMm: 300, heightMm: 550, coverMm: 30,
    stirrupDiameterMm: 10, tensionBarDiameterMm: 20, tensionBarCount: 3,
    fcKsc: 25 / KSC_TO_MPA, fyKsc: 400 / KSC_TO_MPA, fyvKsc: 250 / KSC_TO_MPA };
  const r = calculateBeam(p);
  near(r.effectiveDepthMm, 500);
  near(r.AsMm2, 942.4777960769379715387930);
  near(r.blockDepthMm, 59.13586171463140213576740);
  near(r.MnKnM, 177.3487118918043186911926);
  near(r.phiMnKnM, 159.6138407026238868220733);
  near(r.VcKn, 125);
  near(r.VsKn, 98.17477042468103);
  near(r.AsMinMm2, 525);
  near(r.AvMinMm2, 79.2);
  near(r.stirrupSpacingLimitMm, 250);
  near(r.usablePhiVnKn, r.phiVnKn);
  assert.equal(check(r, 'minimum-flexural-steel').status, 'satisfied');
  assert.equal(r.projectApproved, false);
});

test('external factored demands stay separate and use the detailing-limited shear ceiling', () => {
  const base = calculateBeam(DEFAULT_BEAM_INPUTS);
  const r = calculateBeam({ ...DEFAULT_BEAM_INPUTS, externalMuKnM: 100, externalVuKn: 50 });
  assert.equal(check(r, 'external-moment').status, 'review');
  assert.equal(check(r, 'external-shear').status, 'review');
  assert.ok(50 < r.phiVnKn && 50 > r.usablePhiVnKn);
  near(r.externalDemand.momentUtilization, 100 / 34.965780115954322);
  near(r.externalDemand.shearUtilization, 50 / 31.766401826458092);
  near(r.selfWeightMuKnM, base.selfWeightMuKnM);
  near(r.phiMnKnM, base.phiMnKnM);
  const zero = calculateBeam({ ...DEFAULT_BEAM_INPUTS, externalMuKnM: 0, externalVuKn: 0 });
  assert.equal(zero.externalDemand.momentUtilization, 0);
  assert.equal(zero.externalDemand.MuKnM, 0);
  assert.equal(zero.projectApproved, false);
});

test('cover sensitivity is physical, and the source/default object is not mutated', () => {
  const p = { ...DEFAULT_BEAM_INPUTS };
  const before = JSON.stringify(p);
  const a = calculateBeam(p);
  const b = calculateBeam({ ...p, coverMm: 50 });
  assert.equal(JSON.stringify(p), before);
  near(b.effectiveDepthMm, 438);
  assert.ok(b.phiMnKnM < a.phiMnKnM);
  assert.ok(b.VcKn < a.VcKn);
  assert.equal(DEFAULT_BEAM_INPUTS.coverMm, 40);
});

test('historical metric beta1 bounds, tension transition and nonyielding rejection are explicit', () => {
  near(calculateBeam({ ...DEFAULT_BEAM_INPUTS, fcKsc: 37 / KSC_TO_MPA }).beta1, 0.8);
  near(calculateBeam({ ...DEFAULT_BEAM_INPUTS, fcKsc: 60 / KSC_TO_MPA }).beta1, 0.65);
  const transition = calculateBeam({ ...DEFAULT_BEAM_INPUTS, widthMm: 350,
    tensionBarDiameterMm: 25, tensionBarCount: 5 });
  assert.ok(transition.steelYields);
  assert.ok(transition.tensionStrain < 0.005 && transition.tensionStrain > 0.004);
  assert.ok(transition.phiFlexure < 0.9 && transition.phiFlexure > 0.65);
  const over = calculateBeam({ ...DEFAULT_BEAM_INPUTS, widthMm: 800, heightMm: 300,
    tensionBarDiameterMm: 32, tensionBarCount: 10 });
  assert.equal(over.steelYields, false);
  assert.equal(over.MnKnM, null);
  assert.equal(over.phiMnKnM, null);
  assert.equal(over.phiFlexure, null);
  assert.equal(check(over, 'flexural-yield').status, 'review');
});

test('beam validation rejects unavailable dimensions, impossible layers, deep beams and unsafe objects', () => {
  for (const update of [{ coverMm: null }, { fcKsc: NaN }, { widthMm: -250 },
    { heightMm: 50 }, { tensionBarCount: 2.1 }, { tensionBarCount: 25 },
    { spanM: 1 }, { externalMuKnM: '-1' }, { externalVuKn: -1 }, { bogus: 2 }]) {
    const p = { ...DEFAULT_BEAM_INPUTS, ...update };
    assert.equal(validateBeamInputs(p).valid, false);
    assert.throws(() => calculateBeam(p), RangeError);
  }
  const hostile = JSON.parse(JSON.stringify(DEFAULT_BEAM_INPUTS));
  Object.defineProperty(hostile, '__proto__', { value: {}, enumerable: true });
  assert.equal(validateBeamInputs(hostile).valid, false);
  let evaluated = false;
  const accessor = { ...DEFAULT_BEAM_INPUTS };
  Object.defineProperty(accessor, 'widthMm', { get() { evaluated = true; return 250; } });
  assert.equal(validateBeamInputs(accessor).valid, false);
  assert.equal(evaluated, false);
});

test('soil strength uses effective stress and does not subtract pore pressure from Su twice', () => {
  const effective = soilShearStrength({ mode: 'effective', normalStressKpa: 100,
    porePressureKpa: 40, effectiveCohesionKpa: 5, frictionAngleDeg: 30 });
  near(effective.effectiveNormalStressKpa, 60);
  near(effective.shearStrengthKpa, 39.64101615137754);
  const undrained = soilShearStrength({ mode: 'undrained', normalStressKpa: 100,
    porePressureKpa: 99, effectiveCohesionKpa: 5, frictionAngleDeg: 30, undrainedStrengthKpa: 35 });
  near(undrained.shearStrengthKpa, 35);
  assert.equal(undrained.effectiveNormalStressKpa, null);
  assert.equal(undrained.porePressureKpa, null);
  assert.throws(() => soilShearStrength({ mode: 'effective', normalStressKpa: 100,
    porePressureKpa: 110, effectiveCohesionKpa: 0, frictionAngleDeg: 30 }), RangeError);
  assert.throws(() => soilShearStrength({ mode: 'undrained', normalStressKpa: 100 }), RangeError);
});

test('45-degree hand benchmark yields dryFS1 and parallel-seepageFS0.5', () => {
  const r = calculateSoil({ ...DEFAULT_SOIL_INPUTS, slopeH: 1, frictionAngleDeg: 45,
    verticalDepthM: 2, unitWeightKnM3: 20, saturatedUnitWeightKnM3: 20,
    waterUnitWeightKnM3: 10 });
  near(r.angleDegrees, 45);
  near(r.cases[0].normalStressKpa, 20);
  near(r.cases[0].shearDemandKpa, 20);
  near(r.cases[0].shearStrengthKpa, 20);
  near(r.cases[0].factorOfSafety, 1);
  near(r.cases[1].porePressureKpa, 10);
  near(r.cases[1].effectiveNormalStressKpa, 10);
  near(r.cases[1].shearStrengthKpa, 10);
  near(r.cases[1].factorOfSafety, 0.5);
  assert.equal(r.projectApproved, false);
});

test('S6006 shallow-slope sensitivity matches independent numerical checks, not source global FS', () => {
  const r = calculateSoil(DEFAULT_SOIL_INPUTS);
  near(r.angleDegrees, 21.80140948635181);
  near(r.cases[0].normalStressKpa, 34.482758620689655);
  near(r.cases[0].shearDemandKpa, 13.793103448275862);
  near(r.cases[0].shearStrengthKpa, 21.54721903135612);
  near(r.cases[0].factorOfSafety, 1.5621733797733188);
  near(r.cases[1].porePressureKpa, 16.90801724137931);
  near(r.cases[1].shearStrengthKpa, 10.981917255663697);
  near(r.cases[1].factorOfSafety, 0.7961890010356181);
  assert.equal(r.formulaRows.length, 11);
  assert.equal(r.cases.every(c => c.status === 'illustrative'), true);
  assert.equal(r.cases.some(c => c.id === 'drawdown' || c.id === 'global'), false);
  assert.equal(r.projectApproved, false);
});

test('cohesionless infinite-slope FS is depth independent; cohesion and Su retain depth dependence', () => {
  const shallow = calculateSoil(DEFAULT_SOIL_INPUTS);
  const deep = calculateSoil({ ...DEFAULT_SOIL_INPUTS, verticalDepthM: 10 });
  near(shallow.cases[0].factorOfSafety, deep.cases[0].factorOfSafety);
  near(shallow.cases[1].factorOfSafety, deep.cases[1].factorOfSafety);
  const withC = calculateSoil({ ...DEFAULT_SOIL_INPUTS, effectiveCohesionKpa: 10 });
  near(withC.cases[0].factorOfSafety - shallow.cases[0].factorOfSafety, 0.725);
  const u = calculateSoil({ ...DEFAULT_SOIL_INPUTS, mode: 'undrained', undrainedStrengthKpa: 30 });
  assert.equal(u.cases.length, 1);
  assert.equal(u.cases[0].id, 'undrained');
  near(u.cases[0].factorOfSafety, 2.175);
  assert.equal(u.cases[0].porePressureKpa, null);
  assert.equal(u.cases[0].effectiveNormalStressKpa, null);
  near(calculateSoil({ ...DEFAULT_SOIL_INPUTS, mode: 'undrained', undrainedStrengthKpa: 30,
    verticalDepthM: 4 }).cases[0].factorOfSafety, 1.0875);
});

test('soil missing strengths, impossible stresses and nonnumeric inputs do not become zeros', () => {
  for (const update of [{ mode: 'undrained' }, { frictionAngleDeg: null },
    { effectiveCohesionKpa: null }, { effectiveCohesionKpa: '-' }, { unitWeightKnM3: NaN },
    { saturatedUnitWeightKnM3: 8 }, { slopeH: 0 }, { verticalDepthM: 0 }, { mode: 'automatic' }]) {
    const p = { ...DEFAULT_SOIL_INPUTS, ...update };
    assert.equal(validateSoilInputs(p).valid, false);
    assert.throws(() => calculateSoil(p), RangeError);
  }
  const totalStress = { ...DEFAULT_SOIL_INPUTS, mode: 'undrained',
    frictionAngleDeg: null, effectiveCohesionKpa: null, undrainedStrengthKpa: 30 };
  assert.equal(validateSoilInputs(totalStress).valid, true);
  near(calculateSoil(totalStress).cases[0].factorOfSafety, 2.175);
});
