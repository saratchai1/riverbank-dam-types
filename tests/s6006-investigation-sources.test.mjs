import test from 'node:test';
import assert from 'node:assert/strict';
import { BOREHOLE_CATALOG, INVESTIGATION_SOURCE_NOTES, getBoreholeSource } from '../projects/s6006/investigation-sources.js';
import { sourceURL } from '../projects/s6006/case-data.js';
import { createDefaultScenario } from '../projects/s6006/project.js';

test('source catalogue preserves the visually verified borehole/log/laboratory mapping', () => {
  assert.deepEqual(BOREHOLE_CATALOG.map(({ id, environment, logEnvironment, logPage, labPage, labPosition }) =>
    [id, environment, logEnvironment, logPage, labPage, labPosition]), [
    ['BH-1', 'LAND', 'ON LAND', 4, 12, 'top'],
    ['BH-2', 'LAND', 'ON LAND', 5, 12, 'bottom'],
    ['BH-3', 'LAND', 'ON LAND', 6, 13, 'top'],
    ['BH-4', 'LAND', 'ON LAND', 7, 13, 'bottom'],
    ['BH-5', 'LAND', 'ON LAND', 8, 14, 'top'],
    ['BH-6', 'LAND', 'ON LAND', 9, 14, 'bottom'],
    ['BH-7', 'RIVER', 'IN RIVER', 10, 15, 'top'],
    ['BH-8', 'RIVER', 'IN RIVER', 11, 15, 'bottom'],
  ]);
  for (const entry of BOREHOLE_CATALOG) {
    assert.equal(entry.sourceKey, 'S-CALC');
    assert.equal(entry.sourceUrl, sourceURL('S-CALC'));
    assert.equal(entry.sourceSha256, '5fe3eaf702d24d090fc51a502d19378b2c60584dde1e0e13669590340a1462f3');
  }
});

test('historical dates and water observations retain raw text and source blanks', () => {
  assert.deepEqual(BOREHOLE_CATALOG.map(x => x.boringStartedText), [
    '25/11/60', '23/11/60', '29/11/60', '02/12/60',
    '04/12/60', '07/12/60', '29/11/60', '05/12/60',
  ]);
  assert.deepEqual(BOREHOLE_CATALOG.map(x => x.observedWaterLevelText), [
    '-7.00 M.', '-6.40 M.', '-8.00 M.', '-7.30 M.', '-8.00 M.', '-6.90 M.', null, null,
  ]);
  for (const entry of BOREHOLE_CATALOG) {
    assert.equal(entry.boringFinishedText, entry.boringStartedText);
    assert.equal(entry.laboratoryDateText, '12/2/2561');
    assert.equal(entry.waterObservationTimingText, '24 Hrs. After Boring');
  }
});

test('source lookups cannot mutate shared evidence or infer matches from unrecognised values', () => {
  assert.ok(Object.isFrozen(BOREHOLE_CATALOG));
  assert.ok(Object.isFrozen(INVESTIGATION_SOURCE_NOTES));
  for (const entry of BOREHOLE_CATALOG) {
    assert.ok(Object.isFrozen(entry));
    assert.equal(getBoreholeSource(entry.id), entry);
    assert.throws(() => { entry.logPage = 999; }, TypeError);
  }
  assert.throws(() => BOREHOLE_CATALOG.push({ id: 'BH-9' }), TypeError);
  assert.throws(() => INVESTIGATION_SOURCE_NOTES.push('replaced'), TypeError);
  for (const value of ['bh-1', ' BH-1 ', 'BH-9', 'constructor', '__proto__', '', null, undefined, 1, {}]) {
    assert.equal(getBoreholeSource(value), null);
  }
  assert.equal(getBoreholeSource({ toString() { throw new Error('must not coerce'); } }), null);
});

test('reading catalogue evidence never adopts groundwater, material parameters or a station mapping', () => {
  const before = createDefaultScenario();
  for (const entry of BOREHOLE_CATALOG) {
    getBoreholeSource(entry.id);
    for (const key of ['stationId', 'groundwaterLevel', 'soilInputs', 'Su', 'cPrime', 'phiPrime', 'adoptedValues', 'factorOfSafety']) {
      assert.equal(Object.hasOwn(entry, key), false);
    }
    // The only numeric data in this metadata catalogue are source page numbers.
    assert.deepEqual(Object.keys(entry).filter(key => typeof entry[key] === 'number').sort(), ['labPage', 'logPage']);
  }
  assert.deepEqual(createDefaultScenario(), before);
  assert.equal(before.context.groundwaterLevel, null);
  assert.equal(before.soilInputs.undrainedStrengthKpa, null);
  assert.ok(INVESTIGATION_SOURCE_NOTES.some(note => note.includes('วงเล็บ')));
  assert.ok(INVESTIGATION_SOURCE_NOTES.some(note => note.includes('c′') && note.includes('Su')));
});
