/**
 * S6006 arithmetic only. No slope-stability, hydraulic, bearing or structural
 * acceptance calculation is implemented here. Source results remain external.
 */
export const DEFAULT_INPUTS = Object.freeze({
  length: 1000,
  crestLevel: 101,
  toeLevel: 88,
  slopeH: 2.5,
  rockThickness: 0.5,
  sandMinThickness: 1,
  walkwayWidth: 2.95,
  toeTopWidth: 1.5,
  toeDepth: 2,
  toeSlopeH: 1.5,
});

const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const INPUT_LIMITS = Object.freeze({
  length: [0, 100000], crestLevel: [-10000, 10000], toeLevel: [-10000, 10000],
  slopeH: [0, 20], rockThickness: [0, 10], sandMinThickness: [0, 100],
  walkwayWidth: [0, 100], toeTopWidth: [0, 100], toeDepth: [0, 100],
  toeSlopeH: [0, 20],
});
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonnegative = value => finite(value) && value >= 0;
const format = value => Number(value.toPrecision(12)).toString();

function plain(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
  const prototype = Object.getPrototypeOf(object);
  return (prototype === Object.prototype || prototype === null)
    && Reflect.ownKeys(object).every(key => typeof key === 'string'
      && !RESERVED.has(key) && own(Object.getOwnPropertyDescriptor(object, key), 'value'));
}

/** Validation limits are numeric/UI limits, never engineering design criteria. */
export function validateInputs(input) {
  const errors = [];
  try {
    if (!plain(input)) return { valid: false, errors: ['Inputs must be a plain data object without prototype keys or accessors.'] };
    for (const key of Object.keys(input)) {
      if (!own(DEFAULT_INPUTS, key)) errors.push(`Unknown input: ${key}.`);
    }
    for (const [key, [minimum, maximum]] of Object.entries(INPUT_LIMITS)) {
      const value = input[key];
      const level = key === 'crestLevel' || key === 'toeLevel';
      if (!own(input, key) || !finite(value)) errors.push(`${key} must be a finite number.`);
      else if ((level ? value < minimum : value <= minimum) || value > maximum) {
        errors.push(`${key} must be ${level ? 'at least' : 'greater than'} ${minimum} and at most ${maximum}.`);
      }
    }
    if (finite(input.crestLevel) && finite(input.toeLevel)) {
      if (input.crestLevel <= input.toeLevel) errors.push('crestLevel must be greater than toeLevel.');
      else if (input.crestLevel - input.toeLevel > 1000) errors.push('Section height exceeds the 1,000 m numeric illustration limit.');
    }
  } catch {
    errors.push('Inputs could not be read as plain data.');
  }
  return { valid: errors.length === 0, errors };
}

/** Independent component envelopes; no net combined volume is claimed. */
export function calculateTypical(input) {
  const validation = validateInputs(input);
  if (!validation.valid) throw new RangeError(validation.errors.join(' '));
  const p = input;
  const height = p.crestLevel - p.toeLevel;
  const run = height * p.slopeH;
  const slopeLength = Math.hypot(height, run);
  const angleDegrees = Math.atan2(height, run) * 180 / Math.PI;
  const rockArea = slopeLength * p.rockThickness;
  const rockVolume = rockArea * p.length;
  const sandMinArea = slopeLength * p.sandMinThickness;
  const sandMinVolume = sandMinArea * p.length;
  const geotextileSlopeArea = slopeLength * p.length;
  const walkwayArea = p.walkwayWidth * p.length;
  const toeBottomWidth = p.toeTopWidth + 2 * p.toeSlopeH * p.toeDepth;
  const toeArea = (p.toeTopWidth + toeBottomWidth) * p.toeDepth / 2;
  const toeVolume = toeArea * p.length;
  const faceAssumption = 'ความหนาตั้งฉากกับลาด; เป็นรูปทรงทฤษฎี ไม่ใช่พื้นที่รูปตัดจากการสำรวจ';
  const toeAssumption = 'สมมติฐานตีนหินรูปสี่เหลี่ยมคางหมูสมมาตรและฐานราบ; H=2 ม. เป็นตัวอย่างขั้นต่ำ แบบจริงขึ้นกับระดับท้องน้ำแต่ละรูปตัด';
  const row = (id, label, formula, substitution, value, unit, assumption = '') => ({
    id, label, formula, substitution, value, unit, sourceKey: 'S6006-SD-02', assumption,
  });
  const f = format;
  const formulaRows = [
    row('height', 'ความสูงลาด', 'H = crest − toe', `${f(p.crestLevel)} − ${f(p.toeLevel)}`, height, 'm', 'ระดับสมมติตามแบบ ไม่ใช่การรับรองระดับน้ำทะเลปานกลาง'),
    row('run', 'ระยะราบลาด', 'R = H × slopeH', `${f(height)} × ${f(p.slopeH)}`, run, 'm'),
    row('slopeLength', 'ความยาวตามลาด', 'S = √(H² + R²)', `√(${f(height)}² + ${f(run)}²)`, slopeLength, 'm'),
    row('angleDegrees', 'มุมลาดกับแนวราบ', 'θ = atan(H/R)', `atan(${f(height)}/${f(run)}) × 180/π`, angleDegrees, 'degree'),
    row('rockArea', 'พื้นที่ชั้นหินเรียง', 'Arock = S × t', `${f(slopeLength)} × ${f(p.rockThickness)}`, rockArea, 'm2', faceAssumption),
    row('rockVolume', 'ปริมาตรชั้นหินเรียงทฤษฎี', 'Vrock = Arock × L', `${f(rockArea)} × ${f(p.length)}`, rockVolume, 'm3', faceAssumption),
    row('sandMinArea', 'พื้นที่ชั้นทรายขั้นต่ำจำลอง', 'Asand = S × tsand', `${f(slopeLength)} × ${f(p.sandMinThickness)}`, sandMinArea, 'm2', 'ชั้นความหนาตั้งฉากคงที่ ไม่ใช่ปริมาณทรายถมทั้งหมดระหว่างลาดกับดินเดิม'),
    row('sandMinVolume', 'ปริมาตรชั้นทรายขั้นต่ำจำลอง', 'Vsand = Asand × L', `${f(sandMinArea)} × ${f(p.length)}`, sandMinVolume, 'm3', 'ใช้เพื่อแสดงความสัมพันธ์ของรูปทรงเท่านั้น ไม่แทน BOQ ทรายถม'),
    row('geotextileSlopeArea', 'พื้นที่แผ่นใยบนลาดทฤษฎี', 'Ageo = S × L', `${f(slopeLength)} × ${f(p.length)}`, geotextileSlopeArea, 'm2', 'ไม่รวมทาบต่อ ยึดปลาย ปิดหัวท้าย หรือปรับตามพื้นจริง'),
    row('walkwayArea', 'พื้นที่ทางเท้าทฤษฎี', 'Awalk = width × L', `${f(p.walkwayWidth)} × ${f(p.length)}`, walkwayArea, 'm2', 'เฉพาะผิวทางเท้า ไม่สมมติความหนาพื้นหรือหักบันได'),
    row('toeBottomWidth', 'ความกว้างฐานตีนหินจำลอง', 'B = b + 2mHtoe', `${f(p.toeTopWidth)} + 2 × ${f(p.toeSlopeH)} × ${f(p.toeDepth)}`, toeBottomWidth, 'm', toeAssumption),
    row('toeArea', 'พื้นที่ตีนหินจำลอง', 'Atoe = (b+B)Htoe/2', `(${f(p.toeTopWidth)} + ${f(toeBottomWidth)}) × ${f(p.toeDepth)} / 2`, toeArea, 'm2', toeAssumption),
    row('toeVolume', 'ปริมาตรตีนหินจำลอง', 'Vtoe = Atoe × L', `${f(toeArea)} × ${f(p.length)}`, toeVolume, 'm3', toeAssumption),
  ];
  return {
    height, run, slopeLength, angleDegrees, rockArea, rockVolume, sandMinArea,
    sandMinVolume, geotextileSlopeArea, walkwayArea, toeBottomWidth, toeArea,
    toeVolume, formulaRows,
    warnings: [
      'รูปตัดนี้เป็นภาพและปริมาณทางเรขาคณิตทฤษฎีแยกองค์ประกอบ; ยังไม่หักส่วนทับซ้อนรอยต่อ ปลายงาน หรือบันได จึงไม่รวมเป็นปริมาณสุทธิทั้งโครงการ',
      'ชั้นหินและชั้นทรายใช้ความหนาตั้งฉากกับลาด; ปริมาณทรายถมจริงต้องอาศัยพื้นดินสำรวจแต่ละรูปตัด',
      'ตีนหินจำลองมีฐานราบสมมาตร; ความลึกขั้นต่ำ 2 ม. ไม่แทนความลึกที่ต้องออกแบบตามท้องน้ำและการกัดเซาะจริง',
      'ระดับเป็นระดับสมมติตามแบบ S6006; ไม่ได้สร้างแนวพิกัดหรือข้อมูลดินเดิมขึ้นใหม่',
      'การแก้รูปทรงไม่ตรวจสอบหรือรับรองค่า FS ขนาดหินทางชลศาสตร์ หรือกำลังโครงสร้าง',
    ],
  };
}

// Compensated sums avoid unnecessary accumulated rounding; no per-row rounding.
function sum(values) {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const y = value - compensation;
    const next = total + y;
    compensation = (next - total) - y;
    total = next;
  }
  return total === 0 ? 0 : total;
}

function knownSum(values) {
  const known = values.filter(value => value !== null);
  return known.length ? sum(known) : null;
}

function difference(a, b) {
  return a === null || b === null ? null : a - b;
}

function close(a, b) {
  return Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
}

function validateStationRows(rows) {
  const errors = [];
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 10000) {
    return ['Station rows must be a nonempty array of at most 10,000 rows.'];
  }
  const sourceIds = new Set();
  const stationIds = new Set();
  let expectedKeys;
  const unitByKey = new Map();
  rows.forEach((row, i) => {
    const prefix = `Row ${i + 1}`;
    if (!plain(row)) { errors.push(`${prefix} must be a plain data object.`); return; }
    if (!nonnegative(row.station)) errors.push(`${prefix}: station must be a finite nonnegative number.`);
    if (!nonnegative(row.effectiveLength)) errors.push(`${prefix}: effectiveLength must be a finite nonnegative number.`);
    if (typeof row.reach !== 'string' || !row.reach.trim() || RESERVED.has(row.reach)) errors.push(`${prefix}: reach must be a nonempty safe string.`);
    if (!Number.isSafeInteger(row.sourceRow) || row.sourceRow < 1) errors.push(`${prefix}: sourceRow must be a positive integer.`);
    if (typeof row.sourceSheet !== 'string' || !row.sourceSheet.trim()) errors.push(`${prefix}: sourceSheet is required.`);
    const sourceId = JSON.stringify([row.sourceSheet, row.sourceRow]);
    const stationId = JSON.stringify([row.reach, row.station]);
    if (sourceIds.has(sourceId)) errors.push(`${prefix}: duplicate source sheet/row.`);
    if (stationIds.has(stationId)) errors.push(`${prefix}: duplicate station within reach.`);
    sourceIds.add(sourceId); stationIds.add(stationId);
    if (!Array.isArray(row.measures) || !row.measures.length || row.measures.length > 100) {
      errors.push(`${prefix}: measures must be a nonempty array of at most 100 items.`); return;
    }
    const keys = new Set();
    row.measures.forEach((measure, j) => {
      const here = `${prefix}, measure ${j + 1}`;
      if (!plain(measure)) { errors.push(`${here} must be a plain data object.`); return; }
      if (typeof measure.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(measure.key) || RESERVED.has(measure.key)) errors.push(`${here}: invalid measure key.`);
      if (keys.has(measure.key)) errors.push(`${here}: duplicate measure key.`);
      keys.add(measure.key);
      for (const field of ['value', 'cachedProduct']) {
        if (!own(measure, field) || (measure[field] !== null && !nonnegative(measure[field]))) errors.push(`${here}: ${field} must be a finite nonnegative number or explicit null.`);
      }
      const hasDepth = own(measure, 'depthMultiplier');
      if (hasDepth && (!finite(measure.depthMultiplier) || measure.depthMultiplier <= 0)) errors.push(`${here}: depthMultiplier must be a finite positive number.`);
      const dimensionallyValid = (measure.inputUnit === 'm2' && measure.unit === 'm3' && !hasDepth)
        || (measure.inputUnit === 'm' && measure.unit === 'm2' && !hasDepth)
        || (measure.inputUnit === 'm' && measure.unit === 'm3' && hasDepth);
      if (!dimensionallyValid) errors.push(`${here}: units require m2×m→m3, m×m→m2, or m×depthMultiplier×m→m3.`);
      const signature = JSON.stringify([measure.inputUnit, measure.unit, hasDepth]);
      if (unitByKey.has(measure.key) && unitByKey.get(measure.key) !== signature) errors.push(`${here}: inconsistent units for ${measure.key}.`);
      unitByKey.set(measure.key, signature);
      if (nonnegative(measure.value) && nonnegative(row.effectiveLength) && (!hasDepth || nonnegative(measure.depthMultiplier))) {
        if (!finite(measure.value * row.effectiveLength * (hasDepth ? measure.depthMultiplier : 1))) errors.push(`${here}: quantity multiplication overflows.`);
      }
    });
    const keyList = [...keys].sort().join('|');
    if (expectedKeys === undefined) expectedKeys = keyList;
    else if (expectedKeys !== keyList) errors.push(`${prefix}: every row must explicitly include the same measure keys; use null for missing inputs.`);
  });
  return errors;
}

/**
 * value=null never becomes a numeric zero. knownValue is only the sum of known
 * products. sourceCachedSum is likewise a sum of known source products, and
 * sourceMissingCount must accompany it. deltaToCached compares the two known
 * sums, not necessarily two complete physical quantities.
 */
export function integrateStationRows(rows) {
  let errors;
  try { errors = validateStationRows(rows); }
  catch { errors = ['Station rows could not be read as plain data.']; }
  if (errors.length) return { rows: [], totals: {}, coverage: null, coverageByReach: {}, errors };
  const output = rows.map(row => ({
    station: row.station, reach: row.reach, sourceRow: row.sourceRow,
    sourceSheet: row.sourceSheet, effectiveLength: row.effectiveLength,
    lengthCell: row.lengthCell ?? null,
    measures: row.measures.map(measure => {
      const depth = own(measure, 'depthMultiplier') ? measure.depthMultiplier : 1;
      const contribution = measure.value === null ? null : measure.value * row.effectiveLength * depth;
      let status = 'matching';
      if (contribution === null) status = 'missing-input';
      else if (measure.cachedProduct === null) status = 'missing-source-product';
      else if (!close(contribution, measure.cachedProduct)) status = 'different-source-product';
      return { ...measure, contribution, computedProduct: contribution,
        deltaToCached: difference(contribution, measure.cachedProduct),
        status, complete: contribution !== null,
        formula: own(measure, 'depthMultiplier') ? 'value × effectiveLength × depthMultiplier' : 'value × effectiveLength',
      };
    }),
  }));
  const totals = {};
  for (const first of output[0].measures) {
    const values = output.map(row => row.measures.find(measure => measure.key === first.key));
    const missingCount = values.filter(measure => measure.contribution === null).length;
    const sourceMissingCount = values.filter(measure => measure.cachedProduct === null).length;
    const knownValue = knownSum(values.map(measure => measure.contribution));
    const sourceCachedSum = knownSum(values.map(measure => measure.cachedProduct));
    totals[first.key] = {
      value: missingCount === 0 ? knownValue : null, knownValue,
      complete: missingCount === 0, missingCount, sourceCachedSum,
      sourceMissingCount, deltaToCached: difference(knownValue, sourceCachedSum),
      comparisonComplete: missingCount === 0 && sourceMissingCount === 0,
      unit: first.unit,
    };
  }
  const coverageByReach = {};
  for (const reach of new Set(output.map(row => row.reach))) {
    coverageByReach[reach] = sum(output.filter(row => row.reach === reach).map(row => row.effectiveLength));
  }
  const coverage = sum(output.map(row => row.effectiveLength));
  if (!finite(coverage) || Object.values(totals).some(total => [total.knownValue, total.sourceCachedSum].some(value => value !== null && !finite(value)))) {
    return { rows: [], totals: {}, coverage: null, coverageByReach: {}, errors: ['Quantity or coverage sum overflows.'] };
  }
  return { rows: output, totals, coverage, coverageByReach, errors: [] };
}

/** Adapter for the reviewed read-only XLSX extraction; formulas are never run. */
export function normalizeSourceRows(extraction) {
  if (!plain(extraction) || !Array.isArray(extraction.rows) || !plain(extraction.columns)) throw new TypeError('Source extraction must contain rows and column definitions.');
  return extraction.rows.map(row => ({
    station: row.stationM,
    reach: `R${row.reach}`,
    sourceRow: row.sourceRow,
    sourceSheet: row.sourceSheet,
    effectiveLength: row.effectiveLengthM,
    lengthCell: row.effectiveLength?.cell ?? null,
    measures: Object.entries(extraction.columns).map(([key, column]) => {
      const quantity = row.quantities?.[key];
      if (!quantity || !quantity.input || !quantity.reportedQuantity) throw new TypeError(`Missing source measure ${key} at row ${row.sourceRow}.`);
      const measure = {
        key, label: column.labelTH, value: quantity.input.value,
        inputUnit: column.inputUnit, unit: column.quantityUnit,
        valueCell: quantity.input.cell, cachedProduct: quantity.reportedQuantity.value,
        productCell: quantity.reportedQuantity.cell,
      };
      if (column.depthMultiplierM !== null && column.depthMultiplierM !== undefined) {
        measure.depthMultiplier = extraction.allowanceDepth?.value;
        measure.multiplierCell = extraction.allowanceDepth?.cell ?? null;
      }
      return measure;
    }),
  }));
}

function cellValue(cell) {
  if (cell === null || cell === undefined) return null;
  if (!nonnegative(cell.value)) throw new TypeError(`Invalid nonnegative source value at ${cell.cell ?? 'unknown cell'}.`);
  return cell.value;
}

function composeReach(integration, definition) {
  if (!Array.isArray(definition.members) || !definition.members.length || new Set(definition.members).size !== definition.members.length) throw new TypeError('A composed quantity requires distinct member keys.');
  const members = definition.members.map(key => {
    if (!own(integration.totals, key)) throw new TypeError(`Unknown composed member: ${key}.`);
    const total = integration.totals[key];
    if (total.unit !== definition.unit) throw new TypeError(`Incompatible composed quantity units for ${key}.`);
    return total;
  });
  const hasClosure = definition.sourceEndClosureAddition !== null && definition.sourceEndClosureAddition !== undefined;
  const closure = hasClosure ? cellValue(definition.sourceEndClosureAddition) : null;
  // No closure definition means this group has no added component. An actual
  // missing source cell is not interpreted as a physical zero.
  const known = knownSum([...members.map(total => total.knownValue), ...(hasClosure ? [closure] : [])]);
  const complete = members.every(total => total.complete) && (!hasClosure || closure !== null);
  const sourceRaw = cellValue(definition.sourceRawTotal);
  const sourceAdopted = cellValue(definition.sourceAdoptedIntegerQuantity);
  return {
    members: [...definition.members], unit: definition.unit,
    value: complete ? known : null, knownValue: known, complete,
    missingCount: sum(members.map(total => total.missingCount)),
    sourceMissingCount: sum(members.map(total => total.sourceMissingCount)),
    reportedEndClosure: closure, endClosureCell: definition.sourceEndClosureAddition?.cell ?? null,
    sourceRawValue: sourceRaw, sourceRawCell: definition.sourceRawTotal?.cell ?? null,
    sourceAdoptedValue: sourceAdopted, sourceAdoptedCell: definition.sourceAdoptedIntegerQuantity?.cell ?? null,
    roundedDownValue: complete && known !== null ? Math.floor(known) : null,
    roundedDownKnownValue: known === null ? null : Math.floor(known),
    deltaKnownToSourceRaw: difference(known, sourceRaw),
    deltaRoundedKnownToSourceAdopted: difference(known === null ? null : Math.floor(known), sourceAdopted),
    method: 'Sum unrounded known row products and the reported end closure, then ROUNDDOWN separately for each reach. Missing inputs remain incomplete.',
  };
}

/**
 * Full-source arithmetic audit. Ignores supplied recomputedQuantity, auditStatus,
 * columnSums and combinedComposedTotals. Accepted end closures are explicitly
 * reported source additions, not independently measured CAD quantities.
 */
export function auditSourceQuantities(extraction) {
  try {
    const normalized = normalizeSourceRows(extraction);
    const integration = integrateStationRows(normalized);
    if (integration.errors.length) return { ...integration, byReach: {}, composedTotals: {}, discrepancies: [] };
    if (!Array.isArray(extraction.reaches) || !extraction.reaches.length) throw new TypeError('Source extraction must define reach compositions.');
    const byReach = {};
    for (const sourceReach of extraction.reaches) {
      const reach = `R${sourceReach.reach}`;
      if (own(byReach, reach)) throw new TypeError(`Duplicate source reach ${reach}.`);
      const part = integrateStationRows(normalized.filter(row => row.reach === reach));
      if (part.errors.length) throw new TypeError(part.errors.join(' '));
      if (!plain(sourceReach.composedTotals)) throw new TypeError(`Missing composed definitions for ${reach}.`);
      const composed = {};
      for (const [key, definition] of Object.entries(sourceReach.composedTotals)) {
        if (RESERVED.has(key)) throw new TypeError('Unsafe composed quantity key.');
        composed[key] = composeReach(part, definition);
      }
      byReach[reach] = { coverage: part.coverage, totals: part.totals, composed };
    }
    if (Object.keys(integration.coverageByReach).some(reach => !own(byReach, reach))) throw new TypeError('Some station reaches have no source composition.');
    const composedTotals = {};
    for (const key of new Set(Object.values(byReach).flatMap(reach => Object.keys(reach.composed)))) {
      const parts = Object.values(byReach).map(reach => reach.composed[key]);
      if (parts.some(part => !part)) throw new TypeError(`Composed quantity ${key} is missing in a reach.`);
      if (parts.some(part => part.unit !== parts[0].unit)) throw new TypeError(`Composed quantity ${key} changes units between reaches.`);
      const knownValue = knownSum(parts.map(part => part.knownValue));
      const complete = parts.every(part => part.complete);
      const roundedDownKnownValue = knownSum(parts.map(part => part.roundedDownKnownValue));
      const sourceAdoptedValue = knownSum(parts.map(part => part.sourceAdoptedValue));
      composedTotals[key] = {
        value: complete ? knownValue : null, knownValue, complete,
        unit: parts[0].unit, missingCount: sum(parts.map(part => part.missingCount)),
        sourceMissingCount: sum(parts.map(part => part.sourceMissingCount)),
        sourceRawValue: knownSum(parts.map(part => part.sourceRawValue)), sourceAdoptedValue,
        roundedDownValue: complete ? roundedDownKnownValue : null, roundedDownKnownValue,
        deltaRoundedKnownToSourceAdopted: difference(roundedDownKnownValue, sourceAdoptedValue),
        method: 'Sum of separate reach ROUNDDOWN values, not ROUNDDOWN of the combined raw total.',
      };
    }
    const discrepancies = integration.rows.flatMap(row => row.measures
      .filter(measure => measure.status !== 'matching')
      .map(measure => ({ reach: row.reach, station: row.station, sourceRow: row.sourceRow,
        sourceSheet: row.sourceSheet, lengthCell: row.lengthCell,
        effectiveLength: row.effectiveLength, ...measure })));
    const declaredCoverage = extraction.scope?.currentBudgetLengthM;
    return { ...integration, byReach, composedTotals, discrepancies,
      declaredCoverage: finite(declaredCoverage) ? declaredCoverage : null,
      coverageMatchesDeclared: finite(declaredCoverage) ? close(integration.coverage, declaredCoverage) : null,
      basis: 'Independent arithmetic from supplied measurements and effective lengths. Known partial sums do not certify missing inputs as physical zeros. Source closures remain reported quantities.',
    };
  } catch (error) {
    return { rows: [], totals: {}, coverage: null, coverageByReach: {}, byReach: {},
      composedTotals: {}, discrepancies: [], errors: [error.message || 'Invalid source extraction.'] };
  }
}
