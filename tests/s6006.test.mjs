import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_INPUTS, validateInputs, calculateTypical, integrateStationRows,
  normalizeSourceRows, auditSourceQuantities,
} from '../projects/s6006/engine.js';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(
  typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
  `${actual} differs from expected ${expected}`,
);

function row(station, effectiveLength, value, cachedProduct, options = {}) {
  return { station, reach: options.reach ?? 'R1', sourceRow: options.sourceRow ?? station + 1,
    sourceSheet: 'หาปริมาณวัสดุ', lengthCell: options.lengthCell ?? 'B1', effectiveLength,
    measures: [{ key: options.key ?? 'rock', label: 'Test quantity', value,
      inputUnit: options.inputUnit ?? 'm2', unit: options.unit ?? 'm3',
      valueCell: options.valueCell ?? 'V1', cachedProduct, productCell: options.productCell ?? 'W1',
      ...(options.depthMultiplier !== undefined ? { depthMultiplier: options.depthMultiplier, multiplierCell: 'F7' } : {}),
    }],
  };
}

test('S6006 typical geometry matches independent hand values without a stability result', () => {
  assert.ok(Object.isFrozen(DEFAULT_INPUTS));
  const actual = calculateTypical(DEFAULT_INPUTS);
  near(actual.height, 13);
  near(actual.run, 32.5);
  near(actual.slopeLength, 35.00357124637428);
  near(actual.angleDegrees, 21.80140948635181);
  near(actual.rockArea, 17.50178562318714);
  near(actual.rockVolume, 17501.78562318714);
  near(actual.sandMinArea, 35.00357124637428);
  near(actual.sandMinVolume, 35003.57124637428);
  near(actual.geotextileSlopeArea, 35003.57124637428);
  near(actual.walkwayArea, 2950);
  near(actual.toeBottomWidth, 7.5);
  near(actual.toeArea, 9);
  near(actual.toeVolume, 9000);
  assert.equal(actual.formulaRows.length, 13);
  assert.ok(actual.formulaRows.every(item => Number.isFinite(item.value) && item.sourceKey && item.unit));
  assert.ok(actual.warnings.some(item => item.includes('ทับซ้อน')));
  assert.equal('fs' in actual, false);
  assert.equal('totalNetVolume' in actual, false);
});

test('a 3-4-5 section independently checks normal thickness and length scaling', () => {
  const p = { ...DEFAULT_INPUTS, crestLevel: 3, toeLevel: 0, slopeH: 4 / 3,
    rockThickness: 0.2, sandMinThickness: 0.4, length: 10,
    toeTopWidth: 2, toeDepth: 1, toeSlopeH: 2 };
  const actual = calculateTypical(p);
  near(actual.slopeLength, 5);
  near(actual.rockArea, 1);
  near(actual.rockVolume, 10);
  near(actual.sandMinArea, 2);
  near(actual.sandMinVolume, 20);
  near(actual.toeBottomWidth, 6);
  near(actual.toeArea, 4);
  near(actual.toeVolume, 40);
  const doubled = calculateTypical({ ...p, length: 20 });
  near(doubled.rockArea, actual.rockArea);
  near(doubled.rockVolume, 20);
});

test('input validation rejects nonfinite, impossible, inherited and prototype-bearing input', () => {
  assert.equal(validateInputs(DEFAULT_INPUTS).valid, true);
  for (const update of [{ length: 0 }, { rockThickness: -1 }, { toeDepth: Infinity },
    { slopeH: NaN }, { crestLevel: 88 }, { toeLevel: 102 }, { length: '1000' },
    { walkwayWidth: 1000 }, { unlisted: 1 }]) {
    const input = { ...DEFAULT_INPUTS, ...update };
    assert.equal(validateInputs(input).valid, false);
    assert.throws(() => calculateTypical(input), RangeError);
  }
  assert.equal(validateInputs(Object.create(DEFAULT_INPUTS)).valid, false);
  const hostile = JSON.parse(JSON.stringify(DEFAULT_INPUTS));
  Object.defineProperty(hostile, '__proto__', { value: {}, enumerable: true });
  assert.equal(validateInputs(hostile).valid, false);
  let getterCalled = false;
  const accessor = { ...DEFAULT_INPUTS };
  Object.defineProperty(accessor, 'length', { get() { getterCalled = true; return 1; } });
  assert.equal(validateInputs(accessor).valid, false);
  assert.equal(getterCalled, false);
});

test('integration uses effective lengths, not station span or an invented interpolation', () => {
  const actual = integrateStationRows([row(0, 12.5, 2, 25), row(25, 23.5, 4, 94)]);
  assert.deepEqual(actual.errors, []);
  near(actual.coverage, 36);
  near(actual.coverageByReach.R1, 36);
  near(actual.totals.rock.value, 119);
  assert.equal(actual.totals.rock.complete, true);
  near(actual.totals.rock.deltaToCached, 0);
  near(actual.rows[1].measures[0].contribution, 94);
});

test('source allowance width requires explicit depth and correct dimensions', () => {
  const actual = integrateStationRows([row(25, 25, 15.709, 117.8175,
    { inputUnit: 'm', unit: 'm3', depthMultiplier: 0.3 })]);
  assert.deepEqual(actual.errors, []);
  near(actual.totals.rock.value, 117.8175);
  const missingDepth = row(25, 25, 15.709, 117.8175, { inputUnit: 'm', unit: 'm3' });
  assert.ok(integrateStationRows([missingDepth]).errors.length);
});

test('T25 omission remains visible while S25×B25 is independently computable', () => {
  const actual = integrateStationRows([row(275, 23.5, 40.425, null,
    { sourceRow: 25, key: 'geotextile_front', inputUnit: 'm', unit: 'm2',
      lengthCell: 'B25', valueCell: 'S25', productCell: 'T25' })]);
  const total = actual.totals.geotextile_front;
  near(total.value, 949.9875);
  assert.equal(total.complete, true);
  assert.equal(total.sourceCachedSum, null);
  assert.equal(total.sourceMissingCount, 1);
  assert.equal(total.comparisonComplete, false);
  assert.equal(actual.rows[0].measures[0].cachedProduct, null);
  assert.equal(actual.rows[0].measures[0].status, 'missing-source-product');
});

test('AI125:AI132 known values recover 871.725 m3 without filling blank AI128 or AJ cells', () => {
  const values = [0.46, 0.392, 1.813, null, 6.281, 6.12, 13.647, 12.312];
  const rows = values.map((value, i) => row(825 + i * 25, i === 7 ? 12.5 : 25,
    value, null, { key: 'earth_fill', sourceRow: 125 + i, reach: 'R2',
      valueCell: `AI${125 + i}`, productCell: `AJ${125 + i}` }));
  const actual = integrateStationRows(rows);
  assert.equal(actual.totals.earth_fill.value, null);
  near(actual.totals.earth_fill.knownValue, 871.725);
  assert.equal(actual.totals.earth_fill.missingCount, 1);
  assert.equal(actual.totals.earth_fill.sourceMissingCount, 8);
  assert.equal(actual.totals.earth_fill.sourceCachedSum, null);
  assert.equal(actual.rows.filter(r => r.measures[0].contribution > 0).length, 7);
});

test('missing inputs are distinct from true zero, even at zero effective length', () => {
  const actual = integrateStationRows([row(0, 10, 2, 20), row(25, 25, null, 0), row(50, 0, null, null)]);
  assert.equal(actual.totals.rock.value, null);
  near(actual.totals.rock.knownValue, 20);
  assert.equal(actual.totals.rock.complete, false);
  assert.equal(actual.totals.rock.missingCount, 2);
  assert.equal(actual.totals.rock.sourceMissingCount, 1);
  assert.equal(actual.rows[2].measures[0].contribution, null);
  const allMissing = integrateStationRows([row(0, 10, null, null)]);
  assert.equal(allMissing.totals.rock.knownValue, null);
  const zero = integrateStationRows([row(0, 10, 0, 0)]);
  assert.equal(zero.totals.rock.value, 0);
  assert.equal(zero.totals.rock.complete, true);
});

test('malformed, duplicate, negative and dimensionally inconsistent rows fail closed', () => {
  const a = row(0, 10, 2, 20);
  const badCases = [[], [a, structuredClone(a)], [row(0, -1, 2, 0)],
    [row(0, 1, -2, 0)], [row(0, 1, 2, -2)], [row(0, 1, 2, NaN)],
    [row(0, 1, 2, 2, { inputUnit: 'm2', unit: 'm2' })],
    [a, row(25, 10, 1, 10, { key: 'different' })],
  ];
  for (const rows of badCases) {
    const actual = integrateStationRows(rows);
    assert.ok(actual.errors.length);
    assert.equal(actual.coverage, null);
    assert.deepEqual(actual.totals, {});
  }
});

function smallExtraction() {
  const cell = (name, value) => ({ cell: name, value });
  return {
    columns: { rock: { labelTH: 'หิน', inputUnit: 'm2', quantityUnit: 'm3', depthMultiplierM: null } },
    rows: [1, 2].map((reach, index) => ({
      reach, stationM: index, sourceRow: 14 + index, sourceSheet: 'หาปริมาณวัสดุ',
      effectiveLengthM: 1, effectiveLength: cell(`B${14 + index}`, 1),
      quantities: { rock: { input: cell(`V${14 + index}`, 1.8),
        reportedQuantity: cell(`W${14 + index}`, 1.8), recomputedQuantity: 99999 } },
    })),
    reaches: [1, 2].map(reach => ({ reach, composedTotals: { rock: {
      members: ['rock'], unit: 'm3', sourceEndClosureAddition: null,
      sourceRawTotal: cell('Y90', 1.8), sourceAdoptedIntegerQuantity: cell('Y91', 1),
      recomputedRawTotalWithReportedEndClosure: 99999,
    } } })),
    scope: { currentBudgetLengthM: 2 },
    combinedComposedTotals: { rock: { recomputedRoundedDown: 99999 } },
  };
}

test('source audit recomputes inputs independently and floors each reach before adding', () => {
  const source = smallExtraction();
  const actual = auditSourceQuantities(source);
  assert.deepEqual(actual.errors, []);
  near(actual.composedTotals.rock.knownValue, 3.6);
  assert.equal(actual.composedTotals.rock.roundedDownKnownValue, 2);
  assert.equal(Math.floor(actual.composedTotals.rock.knownValue), 3);
  assert.equal(actual.coverageMatchesDeclared, true);
  const normalized = normalizeSourceRows(source);
  assert.equal(normalized[0].measures[0].value, 1.8);
  assert.equal('recomputedQuantity' in normalized[0].measures[0], false);
  source.rows[0].quantities.rock.input.value = 2.8;
  assert.equal(auditSourceQuantities(source).composedTotals.rock.roundedDownKnownValue, 3);
});

test('reported end closure stays identified and missing source input remains incomplete', () => {
  const source = smallExtraction();
  source.reaches[0].composedTotals.rock.sourceEndClosureAddition = { cell: 'L88', value: 0.4 };
  source.rows[1].quantities.rock.input.value = null;
  const actual = auditSourceQuantities(source);
  assert.deepEqual(actual.errors, []);
  near(actual.byReach.R1.composed.rock.knownValue, 2.2);
  near(actual.byReach.R1.composed.rock.reportedEndClosure, 0.4);
  assert.equal(actual.byReach.R1.composed.rock.endClosureCell, 'L88');
  assert.equal(actual.composedTotals.rock.value, null);
  assert.equal(actual.composedTotals.rock.complete, false);
  near(actual.composedTotals.rock.knownValue, 2.2);
});

const source = JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json', import.meta.url), 'utf8'));

test('committed S6006 measurements cover exactly current 286+714m, excluding legacy reaches', () => {
  const actual = auditSourceQuantities(source);
  assert.deepEqual(actual.errors, []);
  assert.equal(actual.rows.length, 41);
  assert.equal(actual.rows.every(r => r.measures.length === 13), true);
  assert.equal(actual.coverage, 1000);
  assert.deepEqual(actual.coverageByReach, { R1: 286, R2: 714 });
  assert.equal(actual.coverageMatchesDeclared, true);
  assert.equal(actual.rows.some(r => r.reach === 'R3' || r.station > 1000), false);
  assert.equal(source.scope.drawingCoverLengthM, 1195);
  assert.equal(source.scope.legacyTakeoffLengthM, 1222);
});

test('independent complete-source raw and per-reach rounded sums match reviewed hand controls', () => {
  const actual = auditSourceQuantities(source);
  const controls = [
    ['excavation', 19417.5724, 19417, 19417, true],
    ['rock_toe_with_end_closures', 32841.100978, 32840, 32840, false],
    ['sand_fill_front', 148206.99235, 148206, 148206, false],
    ['geotextile_front_with_end_closures', 40986.847, 40985, 40035, true],
    ['riprap_facing_before_stairs', 17296.25, 17295, 17295, false],
    ['earth_fill', 2567.186, 2566, 1694, false],
  ];
  for (const [key, raw, candidateInteger, sourceInteger, complete] of controls) {
    const total = actual.composedTotals[key];
    near(total.knownValue, raw, 1e-8);
    assert.equal(total.roundedDownKnownValue, candidateInteger, key);
    assert.equal(total.sourceAdoptedValue, sourceInteger, key);
    assert.equal(total.complete, complete, key);
    if (!complete) assert.equal(total.value, null, `${key} must remain incomplete`);
  }
  assert.equal(actual.composedTotals.sand_fill_back.knownValue, null);
  assert.equal(actual.composedTotals.sand_fill_back.value, null);
  assert.equal(actual.composedTotals.sand_fill_back.sourceAdoptedValue, 0);
});

test('full source preserves and identifies exactly the T25 and seven computable AJ omissions', () => {
  const actual = auditSourceQuantities(source);
  const omissions = actual.discrepancies.filter(item => item.status === 'missing-source-product');
  assert.deepEqual(omissions.map(item => item.productCell),
    ['T25', 'AJ125', 'AJ126', 'AJ127', 'AJ129', 'AJ130', 'AJ131', 'AJ132']);
  near(omissions[0].contribution, 949.9875);
  near(omissions.slice(1).reduce((total, item) => total + item.contribution, 0), 871.725);
  const missing128 = actual.discrepancies.find(item => item.productCell === 'AJ128');
  assert.equal(missing128.status, 'missing-input');
  assert.equal(missing128.contribution, null);
  assert.equal(actual.discrepancies.some(item => item.status === 'different-source-product'), false);
  near(actual.composedTotals.geotextile_front_with_end_closures.knownValue
    - actual.composedTotals.geotextile_front_with_end_closures.sourceRawValue, 949.9875);
  near(actual.composedTotals.earth_fill.knownValue
    - actual.composedTotals.earth_fill.sourceRawValue, 871.725);
});

test('audit does not trust precomputed extraction totals or mutate source cells', () => {
  const changed = structuredClone(source);
  const originalCell = source.rows[0].quantities.excavation_section.input.value;
  changed.rows[0].quantities.excavation_section.recomputedQuantity = 9e9;
  changed.rows[0].quantities.excavation_section.auditStatus = 'forged';
  changed.reaches[0].columnSums.excavation_section.recomputedRowSum = 9e9;
  changed.reaches[0].composedTotals.excavation.recomputedRoundedDown = 9e9;
  changed.combinedComposedTotals = { forged: 9e9 };
  const before = JSON.stringify(changed);
  const audited = auditSourceQuantities(changed);
  near(audited.composedTotals.excavation.knownValue, 19417.5724);
  assert.equal(JSON.stringify(changed), before);
  changed.rows[0].quantities.excavation_section.input.value = originalCell + 1;
  const edited = auditSourceQuantities(changed);
  near(edited.composedTotals.excavation.knownValue - audited.composedTotals.excavation.knownValue, 12.5);
  assert.equal(source.rows[0].quantities.excavation_section.input.value, originalCell);
  assert.equal(edited.discrepancies.some(item => item.status === 'different-source-product'
    && item.sourceRow === 14 && item.key === 'excavation_section'), true);
});
