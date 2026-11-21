/**
 * Selected engineering calculations, with explicit model limits.
 * RC: historical ACI 318M-02 equations, not a complete/current code check.
 * Soil: homogeneous infinite-slope mechanism, not the S6006 global Slope/W model.
 */
export const KSC_TO_MPA = 0.0980665;
export const TF_TO_KN = 9.80665;
export const STEEL_MODULUS_MPA = 200000;

export const ENGINEERING_REFERENCES = Object.freeze({
  'SP-LEGACY-BEAM': Object.freeze({
    title: 'StructurePoint spSlab/spBeam, Method of Solution',
    url: 'https://www.structurepoint.org/spSlab-spBeam-Online-Manual/spSlabPlusBeam/Chapter_2/Chapter_2.htm?rhtocid=_2',
    sections: '2.12.1 / Eq.2-54–2-57; 2.14 / Eq.2-83,2-87; selected ACI 318M-02 provisions',
  }),
  'SP-LEGACY-METRIC': Object.freeze({
    title: 'StructurePoint spSlab/spBeam Manual v5.50',
    url: 'https://structurepoint.org/pdfs/manuals/spSlabPlusBeam/spSlabPlusBeam%20Manual%20v5.50.pdf',
    sections: 'Eq.2-56: ACI 318M-02 Av,min = max(√fc/16,0.33)bws/fyt; distinct from later 0.35 formula',
  }),
  'SP-STRESS-BLOCK': Object.freeze({
    title: 'StructurePoint spColumn Manual v5.11, Method of Solution',
    url: 'https://structurepoint.org/pdfs/manuals/spColumn/spColumn%20manual%20v5.11.pdf',
    sections: 'Printed2-2: metric β1 = clamp((149−fc)/140,0.65,0.85); strain compatibility',
  }),
  'USACE-1902': Object.freeze({
    title: 'USACE EM1110-2-1902, Slope Stability, 31October2003',
    url: 'https://www.publications.usace.army.mil/Portals/76/Publications/EngineerManuals/EM_1110-2-1902.pdf?ver=2014-05-07-083439-823',
    sections: 'AppendixC §C-7 Eqs.C-22/C-23/C-27/C-29; AppendixE §E-5 Eqs.E-15/E-16',
  }),
});

export const DEFAULT_BEAM_INPUTS = Object.freeze({
  widthMm: 250, heightMm: 500, coverMm: 40,
  stirrupDiameterMm: 6, tensionBarDiameterMm: 12, tensionBarCount: 2,
  stirrupLegs: 2, stirrupSpacingMm: 200,
  fcKsc: 210, fyKsc: 4000, fyvKsc: 2400,
  concreteUnitWeightTfM3: 2.4, spanM: 3, deadLoadFactor: 1.4,
  externalMuKnM: null, externalVuKn: null,
});

export const DEFAULT_SOIL_INPUTS = Object.freeze({
  mode: 'effective', slopeH: 2.5, verticalDepthM: 2,
  unitWeightKnM3: 20, saturatedUnitWeightKnM3: 20, waterUnitWeightKnM3: 9.80665,
  frictionAngleDeg: 32, effectiveCohesionKpa: 0, undrainedStrengthKpa: null,
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const fmt = value => value === null ? 'ยังไม่มีข้อมูล' : Number(value.toPrecision(10)).toString();
const MIN_NORMAL_NUMBER = 2 ** -1022;

function requireFiniteDerived(values) {
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && !finite(value)) throw new RangeError(`ผลคำนวณ ${name} ไม่เป็นจำนวนจำกัด; ค่าที่ป้อนอยู่นอกช่วงตัวเลขที่โมดูลคำนวณได้`);
  }
}

function requireNormalPositiveDivisor(value, name) {
  // This is an IEEE-754 numerical limit, not an engineering minimum. Subnormal
  // divisors can underflow during multiplication or lose precision before a ratio.
  if (!finite(value) || value < MIN_NORMAL_NUMBER) throw new RangeError(`${name} ต้องเป็นตัวหารบวกในช่วงเลขปกติ; ค่าต่ำเกินช่วงตัวเลขที่โมดูลคำนวณได้`);
}

function checkObject(input, defaults) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return ['ต้องเป็นข้อมูล object ปกติ'];
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || reserved.has(key) || !own(defaults, key)
      || !own(Object.getOwnPropertyDescriptor(input, key), 'value')) errors.push('พบชื่อข้อมูลที่ไม่รองรับหรือ accessor');
  }
  for (const key of Object.keys(defaults)) if (!own(input, key)) errors.push(`ไม่มีข้อมูล ${key}`);
  return errors;
}

function bounded(errors, input, key, lower, upper, inclusiveLower = false) {
  const value = input[key];
  if (!finite(value) || (inclusiveLower ? value < lower : value <= lower) || value > upper) {
    errors.push(`${key} ต้องเป็นตัวเลข ${inclusiveLower ? 'ตั้งแต่' : 'มากกว่า'} ${lower} ถึง ${upper}`);
  }
}

export function validateBeamInputs(input) {
  try {
    const errors = checkObject(input, DEFAULT_BEAM_INPUTS);
    if (errors.length) return { valid: false, errors };
    const bounds = {
      widthMm: [50, 3000], heightMm: [100, 3000], coverMm: [0, 200],
      stirrupDiameterMm: [2, 32], tensionBarDiameterMm: [4, 50],
      tensionBarCount: [0, 30], stirrupLegs: [0, 12], stirrupSpacingMm: [0, 1000],
      fcKsc: [17 / KSC_TO_MPA, 60 / KSC_TO_MPA],
      fyKsc: [100 / KSC_TO_MPA, 550 / KSC_TO_MPA],
      fyvKsc: [100 / KSC_TO_MPA, 420 / KSC_TO_MPA],
      concreteUnitWeightTfM3: [2, 2.7], spanM: [0, 50], deadLoadFactor: [0, 3],
    };
    for (const [key, [lower, upper]] of Object.entries(bounds)) bounded(errors, input, key, lower, upper, key === 'fcKsc' || key === 'concreteUnitWeightTfM3');
    for (const key of ['tensionBarCount', 'stirrupLegs']) if (!Number.isInteger(input[key])) errors.push(`${key} ต้องเป็นจำนวนเต็ม`);
    for (const key of ['externalMuKnM', 'externalVuKn']) if (input[key] !== null && (!finite(input[key]) || input[key] < 0 || input[key] > 1e7)) errors.push(`${key} ต้องเป็นขนาดแรงออกแบบไม่ติดลบ หรือ null เมื่อยังไม่ทราบ`);
    if (errors.length === 0) {
      const d = input.heightMm - input.coverMm - input.stirrupDiameterMm - input.tensionBarDiameterMm / 2;
      if (d <= 0 || d >= input.heightMm) errors.push('ระยะ cover/เหล็กทำให้ความลึกประสิทธิผล d ไม่ถูกต้อง');
      const clear = Math.max(25, input.tensionBarDiameterMm);
      const requiredWidth = input.tensionBarCount * input.tensionBarDiameterMm + (input.tensionBarCount - 1) * clear;
      const availableWidth = input.widthMm - 2 * (input.coverMm + input.stirrupDiameterMm);
      if (requiredWidth > availableWidth) errors.push('เหล็กดึงหนึ่งชั้นไม่พอดีกับความกว้างและระยะห่างขั้นต่ำเบื้องต้น; โมดูลยังไม่รองรับเหล็กหลายชั้น');
      const requiredHeight = 2 * (input.coverMm + input.stirrupDiameterMm + input.tensionBarDiameterMm) + clear;
      if (input.heightMm < requiredHeight) errors.push('เหล็กบนและล่างแบบ BF1 ไม่พอดีในความสูงภายในปลอกพร้อมระยะห่างเบื้องต้น; ยังต้องตรวจมวลรวมและรายละเอียดการยึดเหล็กแยกต่างหาก');
      if (input.spanM * 1000 <= 4 * input.heightMm) errors.push('ช่วง/ความลึกอยู่ในขอบเขตคานลึกหรือบริเวณ D-region; สูตรคานตื้นของโมดูลนี้ไม่ใช้กับกรณีนี้');
    }
    return { valid: errors.length === 0, errors };
  } catch {
    return { valid: false, errors: ['ไม่สามารถอ่านข้อมูลคานอย่างปลอดภัยได้'] };
  }
}

function formula(id, label, expression, substitution, value, unit, sourceKey, assumption = '') {
  return { id, label, formula: expression, substitution, value, unit, sourceKey, assumption };
}

/** Single tension face, no axial force, torsion, prestress, or compression-bar credit. */
export function calculateBeam(input) {
  const validation = validateBeamInputs(input);
  if (!validation.valid) throw new RangeError(validation.errors.join('; '));
  const p = input;
  const fcMpa = p.fcKsc * KSC_TO_MPA;
  const fyMpa = p.fyKsc * KSC_TO_MPA;
  const fyvMpa = p.fyvKsc * KSC_TO_MPA;
  const b = p.widthMm;
  const effectiveDepthMm = p.heightMm - p.coverMm - p.stirrupDiameterMm - p.tensionBarDiameterMm / 2;
  const d = effectiveDepthMm;
  const AsMm2 = p.tensionBarCount * Math.PI * p.tensionBarDiameterMm ** 2 / 4;
  const AvMm2 = p.stirrupLegs * Math.PI * p.stirrupDiameterMm ** 2 / 4;
  const AsMinMm2 = Math.max(Math.sqrt(fcMpa) / 4, 1.4) * b * d / fyMpa;
  const beta1 = Math.min(0.85, Math.max(0.65, (149 - fcMpa) / 140));
  const blockDepthMm = AsMm2 * fyMpa / (0.85 * fcMpa * b);
  const neutralAxisMm = blockDepthMm / beta1;
  const tensionStrain = 0.003 * (d - neutralAxisMm) / neutralAxisMm;
  const yieldStrain = fyMpa / STEEL_MODULUS_MPA;
  const steelYields = tensionStrain >= yieldStrain;
  const flexuralStrainSatisfies = tensionStrain >= 0.004;
  const trialPhiFlexure = tensionStrain >= 0.005 ? 0.9
    : tensionStrain <= yieldStrain ? 0.65
      : 0.65 + 0.25 * (tensionStrain - yieldStrain) / (0.005 - yieldStrain);
  // a=As*fy/(.85fc*b) assumes steel yields. Reject that capacity if its own
  // strain compatibility check disproves the assumption; do not use a trial Mn.
  const phiFlexure = steelYields ? trialPhiFlexure : null;
  const MnKnM = steelYields ? AsMm2 * fyMpa * (d - blockDepthMm / 2) / 1e6 : null;
  const phiMnKnM = MnKnM === null ? null : phiFlexure * MnKnM;
  const VcKn = Math.sqrt(fcMpa) * b * d / 6 / 1000;
  requireNormalPositiveDivisor(p.stirrupSpacingMm, 'ระยะปลอก s');
  const VsKn = AvMm2 * fyvMpa * d / p.stirrupSpacingMm / 1000;
  const VnKn = VcKn + VsKn;
  const phiShear = 0.75;
  const phiVnKn = phiShear * VnKn;
  const AvMinMm2 = Math.max(Math.sqrt(fcMpa) / 16, 0.33) * b * p.stirrupSpacingMm / fyvMpa;
  const VsSpacingThresholdKn = Math.sqrt(fcMpa) * b * d / 3 / 1000;
  const VsLimitKn = 2 * Math.sqrt(fcMpa) * b * d / 3 / 1000;
  const stirrupSpacingLimitMm = VsKn > VsSpacingThresholdKn ? Math.min(d / 4, 300) : Math.min(d / 2, 600);
  const shearMinimumSatisfied = AvMm2 >= AvMinMm2;
  const shearSpacingSatisfied = p.stirrupSpacingMm <= stirrupSpacingLimitMm;
  const shearUpperLimitSatisfied = VsKn <= VsLimitKn;
  // StructurePoint's documented investigation policy provides a conservative
  // ceiling when the minimum transverse reinforcement/detailing is not met.
  const usablePhiVnKn = !shearUpperLimitSatisfied ? null
    : shearMinimumSatisfied && shearSpacingSatisfied ? phiVnKn : phiShear * VcKn / 2;
  const concreteUnitWeightKnM3 = p.concreteUnitWeightTfM3 * TF_TO_KN;
  const selfWeightKnM = concreteUnitWeightKnM3 * (b / 1000) * (p.heightMm / 1000);
  const factoredSelfWeightKnM = selfWeightKnM * p.deadLoadFactor;
  const selfWeightMuKnM = factoredSelfWeightKnM * p.spanM ** 2 / 8;
  const selfWeightVuKn = factoredSelfWeightKnM * p.spanM / 2;
  const minimumFlexuralSteelSatisfied = AsMm2 >= AsMinMm2;
  // Keep the equation-only capacity visible, but do not use it to accept a
  // demand until the implemented prerequisites hold. The 4/3 As,required
  // exception is intentionally not implemented or inferred from self-weight.
  const usablePhiMnKnM = steelYields && flexuralStrainSatisfies && minimumFlexuralSteelSatisfied ? phiMnKnM : null;
  const numericResults = {
    effectiveDepthMm, AsMm2, AvMm2, AsMinMm2, AvMinMm2, fcMpa, fyMpa, fyvMpa,
    beta1, blockDepthMm, neutralAxisMm, tensionStrain, yieldStrain,
    phiFlexure, MnKnM, phiMnKnM, usablePhiMnKnM, VcKn, VsKn, VnKn, phiShear, phiVnKn, usablePhiVnKn,
    VsLimitKn, stirrupSpacingLimitMm, selfWeightKnM, factoredSelfWeightKnM,
    selfWeightMuKnM, selfWeightVuKn,
  };
  requireFiniteDerived(numericResults);
  const check = (id, label, status, value, limit, note) => ({ id, label, status, value, limit, note });
  const externalDemand = {
    MuKnM: p.externalMuKnM, VuKn: p.externalVuKn,
    momentUtilization: p.externalMuKnM === null || usablePhiMnKnM === null ? null : p.externalMuKnM / usablePhiMnKnM,
    shearUtilization: p.externalVuKn === null || usablePhiVnKn === null ? null : p.externalVuKn / usablePhiVnKn,
    basis: 'ผู้ใช้ต้องป้อนแรงออกแบบที่คูณตัวคูณแล้ว; ไม่บวกแรงนี้เข้ากับตัวอย่างน้ำหนักตัวเองอัตโนมัติ',
  };
  requireFiniteDerived({ momentUtilization: externalDemand.momentUtilization, shearUtilization: externalDemand.shearUtilization });
  const checks = [
    check('flexural-yield', 'ตรวจสมมติฐานเหล็กดึงคราก', steelYields ? 'satisfied' : 'review', tensionStrain, yieldStrain,
      steelYields ? 'εt ≥ fy/Es จึงใช้สมดุลแรงด้วย Asfy ได้ในโมเดลนี้' : 'εt < fy/Es: ไม่คืนค่า Mn/φMn จากสมมติฐานเหล็กคราก ต้องวิเคราะห์ strain compatibility เพิ่ม'),
    check('flexural-strain', 'ความเครียดดึงขั้นต่ำของคาน', flexuralStrainSatisfies ? 'satisfied' : 'review', tensionStrain, 0.004,
      'เงื่อนไข εt ≥ 0.004 ตามรูปแบบ ACI318-02 ที่เลือก; ไม่ใช่การตรวจ code ทุกข้อ'),
    check('minimum-flexural-steel', 'เหล็กดึงขั้นต่ำ As,min', minimumFlexuralSteelSatisfied ? 'satisfied' : 'review', AsMm2, AsMinMm2,
      minimumFlexuralSteelSatisfied ? 'As ≥ As,min ในหน้าตัดที่เลือก' : 'As ต่ำกว่าเกณฑ์ขั้นต่ำทั่วไป ต้องยืนยันการออกแบบเดิมและเงื่อนไขข้อยกเว้นก่อนใช้กำลังเพื่อรับรองคาน'),
    check('minimum-flexural-exception', 'ข้อยกเว้น 4/3 ของ As ที่ต้องการ', minimumFlexuralSteelSatisfied ? 'not-required' : 'pending', null, null,
      minimumFlexuralSteelSatisfied ? 'As ≥ As,min จึงไม่ต้องอาศัยข้อยกเว้นนี้'
        : 'โมดูลไม่ใช้ข้อยกเว้นนี้และไม่ใช้แรงน้ำหนักตัวเองเพียงกรณีเดียวแทนแรงครบทุกหน้าตัด; ยังไม่ให้ใช้ φMn เพื่อตัดสินแรงจริง'),
    check('minimum-stirrups', 'เหล็กปลอกขั้นต่ำเมื่อ Vu > φVc/2', shearMinimumSatisfied ? 'satisfied' : 'review', AvMm2, AvMinMm2,
      `Av,min ตาม ACI318M-02; เกณฑ์เริ่มต้องมีเหล็กขั้นต่ำ φVc/2 = ${fmt(phiShear * VcKn / 2)} kN. หากไม่ครบ โมดูลไม่ให้ใช้ Vs เต็มเพื่อรับรองแรงสูงกว่านี้`),
    check('stirrup-spacing', 'ระยะปลอกในโมเดลเฉือน', shearSpacingSatisfied ? 'satisfied' : 'review', p.stirrupSpacingMm, stirrupSpacingLimitMm,
      'เกณฑ์ d/2 หรือ d/4 ตามระดับ Vs พร้อมเพดาน 600/300 mm; ยังไม่ตรวจระยะพัฒนาแรงและขอปลอก'),
    check('maximum-shear', 'ขีดจำกัด Vs ของหน้าตัด', shearUpperLimitSatisfied ? 'satisfied' : 'review', VsKn, VsLimitKn,
      'หากเกินขีดจำกัด ไม่คืนกำลังเฉือนที่ใช้ตรวจแรงได้'),
    check('external-moment', 'Mu ออกแบบจริงเทียบกำลังดัดหลังตรวจเงื่อนไข', p.externalMuKnM === null ? 'pending'
      : usablePhiMnKnM === null || p.externalMuKnM > usablePhiMnKnM ? 'review' : 'satisfied', p.externalMuKnM, usablePhiMnKnM,
      p.externalMuKnM === null ? 'ยังไม่มี Mu จริง; ไม่แทนช่องว่างด้วยศูนย์'
        : usablePhiMnKnM === null ? 'ยังไม่ให้ใช้กำลังดัด: ต้องมีเหล็กคราก, εt ≥ 0.004 และ As ≥ As,min; โมดูลไม่ใช้ข้อยกเว้น 4/3'
          : 'เทียบกับ usablePhiMn หลังผ่านเกณฑ์เหล็กคราก ความเครียดและเหล็กขั้นต่ำในโมดูล; ยังไม่รับรองแรง/รายละเอียดทั้งระบบ'),
    check('external-shear', 'Vu ออกแบบจริงเทียบกำลังเฉือนที่จำกัดด้วยรายละเอียด', p.externalVuKn === null ? 'pending'
      : usablePhiVnKn === null || p.externalVuKn > usablePhiVnKn ? 'review' : 'satisfied', p.externalVuKn, usablePhiVnKn,
      p.externalVuKn === null ? 'ยังไม่มี Vu จริง; ไม่แทนช่องว่างด้วยศูนย์'
        : 'ใช้ usablePhiVn ซึ่งลดเพดานเมื่อเหล็กปลอกขั้นต่ำหรือระยะปลอกไม่ครบ ไม่ใช้ φ(Vc+Vs) โดยไม่มีเงื่อนไข'),
    check('selfweight-only', 'น้ำหนักตัวคานบนช่วงรองรับง่าย', 'illustrative', selfWeightMuKnM, phiMnKnM,
      `ตัวอย่าง ${fmt(p.deadLoadFactor)}D เท่านั้น: Mu=${fmt(selfWeightMuKnM)} kN·m, Vu=${fmt(selfWeightVuKn)} kN; ไม่รับรองแรงทั้งระบบ`),
  ];
  const F = (id, label, expression, substitution, value, unit, sourceKey = 'SP-LEGACY-BEAM', assumption = '') => formula(id, label, expression, substitution, value, unit, sourceKey, assumption);
  const formulaRows = [
    F('fcMpa', 'กำลังวัสดุใน SI', 'MPa = kgf/cm² × 0.0980665', `fc=${fmt(fcMpa)}, fy=${fmt(fyMpa)}, fyv=${fmt(fyvMpa)}`, fcMpa, 'MPa', 'S6006-CALC-P3', 'fc เป็นกำลังอัดทรงกระบอกตามข้อมูลโครงการ; ไม่แปลงกำลังลูกบาศก์โดยปริยาย'),
    F('effectiveDepthMm', 'ความลึกประสิทธิผล d', 'd = h − cover − dst − db/2', `${p.heightMm} − ${p.coverMm} − ${p.stirrupDiameterMm} − ${p.tensionBarDiameterMm}/2`, d, 'mm', 'S6006-SD-05', 'cover สมมติถึงผิวนอกปลอก'),
    F('AsMm2', 'เหล็กดึงหนึ่งหน้า', 'As = nπdb²/4', `${p.tensionBarCount}π(${p.tensionBarDiameterMm})²/4`, AsMm2, 'mm2', 'S6006-SD-05'),
    F('AvMm2', 'พื้นที่ขาปลอก', 'Av = nlegsπdst²/4', `${p.stirrupLegs}π(${p.stirrupDiameterMm})²/4`, AvMm2, 'mm2', 'S6006-SD-05'),
    F('beta1', 'ตัวคูณบล็อกอัด', 'β1 = clamp((149−fc)/140,0.65,0.85)', `clamp((149−${fmt(fcMpa)})/140,0.65,0.85)`, beta1, '—', 'SP-STRESS-BLOCK', 'สูตร metric ในคู่มือฉบับประวัติที่อ้าง; ไม่ใช่การเลือกมาตรฐานปัจจุบันแทนโครงการ'),
    F('blockDepthMm', 'ความลึกบล็อกอัด a', 'a = Asfy/(0.85fcb)', `${fmt(AsMm2)}×${fmt(fyMpa)}/(0.85×${fmt(fcMpa)}×${b})`, blockDepthMm, 'mm', 'SP-LEGACY-BEAM', 'ค่า trial ต้องตรวจว่าเหล็กคราก'),
    F('neutralAxisMm', 'แกนสะเทิน c', 'c = a/β1', `${fmt(blockDepthMm)}/${fmt(beta1)}`, neutralAxisMm, 'mm'),
    F('tensionStrain', 'ความเครียดเหล็กดึง', 'εt = 0.003(d−c)/c', `0.003(${fmt(d)}−${fmt(neutralAxisMm)})/${fmt(neutralAxisMm)}`, tensionStrain, '—'),
    F('yieldStrain', 'ความเครียดคราก', 'εy = fy/Es', `${fmt(fyMpa)}/200000`, yieldStrain, '—'),
    F('phiFlexure', 'ตัวคูณลดกำลังดัด', 'φ = 0.90 if εt≥0.005; interpolate 0.65→0.90 from εy→0.005', `εt=${fmt(tensionStrain)}; εy=${fmt(yieldStrain)}`, phiFlexure, '—'),
    F('MnKnM', 'กำลังดัดระบุ', 'Mn = Asfy(d−a/2)/10⁶', `${fmt(AsMm2)}×${fmt(fyMpa)}×(${fmt(d)}−${fmt(blockDepthMm)}/2)/10⁶`, MnKnM, 'kN·m', 'SP-LEGACY-BEAM', 'คืน null หากสมมติฐานเหล็กครากไม่ถูกต้อง'),
    F('phiMnKnM', 'กำลังดัดเชิงสมการ (ค่าระหว่างคำนวณ)', 'φMn = φ × Mn', `${fmt(phiFlexure)}×${fmt(MnKnM)}`, phiMnKnM, 'kN·m', 'SP-LEGACY-BEAM', 'ยังไม่ใช่กำลังที่ใช้ตัดสิน Mu; ต้องอ่าน usablePhiMn หลังตรวจความเครียดและเหล็กขั้นต่ำ'),
    F('AsMinMm2', 'เหล็กดึงขั้นต่ำทั่วไป', 'As,min = max(√fc/4,1.4)bd/fy', `max(√${fmt(fcMpa)}/4,1.4)×${b}×${fmt(d)}/${fmt(fyMpa)}`, AsMinMm2, 'mm2', 'SP-LEGACY-BEAM', 'ยังไม่ใช้ข้อยกเว้น 4/3 As,required'),
    F('VcKn', 'กำลังเฉือนคอนกรีต', 'Vc = √fc bd/(6×1000)', `√${fmt(fcMpa)}×${b}×${fmt(d)}/6000`, VcKn, 'kN', 'SP-LEGACY-BEAM', 'normal weight λ=1; ไม่มีแรงอัดร่วม'),
    F('VsKn', 'กำลังเฉือนจากปลอก', 'Vs = Avfyv d/(s×1000)', `${fmt(AvMm2)}×${fmt(fyvMpa)}×${fmt(d)}/(${p.stirrupSpacingMm}×1000)`, VsKn, 'kN'),
    F('AvMinMm2', 'พื้นที่ปลอกขั้นต่ำ', 'Av,min = max(√fc/16,0.33)bs/fyv', `max(√${fmt(fcMpa)}/16,0.33)×${b}×${p.stirrupSpacingMm}/${fmt(fyvMpa)}`, AvMinMm2, 'mm2', 'SP-LEGACY-METRIC', 'เกณฑ์ ACI318M-02 เมื่อ Vu>φVc/2'),
    F('phiVnKn', 'กำลังเฉือนจากสมการระบุ', 'φVn = 0.75(Vc+Vs)', `0.75(${fmt(VcKn)}+${fmt(VsKn)})`, phiVnKn, 'kN', 'SP-LEGACY-BEAM', 'ค่าเชิงกลศาสตร์ ต้องอ่านกำลังที่จำกัดด้วยรายละเอียดบรรทัดถัดไป'),
    F('usablePhiVnKn', 'เพดานเฉือนหลังตรวจรายละเอียด', 'φVc/2 if Av,min or stirrup spacing is not met; else φ(Vc+Vs)', `${shearMinimumSatisfied && shearSpacingSatisfied ? 'รายละเอียดปลอกครบในโมดูล' : 'จำกัด 0.75×Vc/2'}; Vs≤${fmt(VsLimitKn)} kN`, usablePhiVnKn, 'kN', 'SP-LEGACY-BEAM', 'นโยบาย investigation แบบอนุรักษนิยมในคู่มือ; ไม่รวมข้อยกเว้นเฉพาะระบบ'),
    F('selfWeightKnM', 'น้ำหนักตัวคาน', 'w = γc b h', `${p.concreteUnitWeightTfM3}×9.80665×${b / 1000}×${p.heightMm / 1000}`, selfWeightKnM, 'kN/m', 'S6006-CALC-P1'),
    F('factoredSelfWeightKnM', 'น้ำหนักตัวคูณตัวคูณ', 'wu = factor × w', `${p.deadLoadFactor}×${fmt(selfWeightKnM)}`, factoredSelfWeightKnM, 'kN/m', 'ASSUMED-SELF-WEIGHT-ONLY'),
    F('selfWeightMuKnM', 'โมเมนต์ตัวอย่าง', 'Mu,self = wuL²/8', `${fmt(factoredSelfWeightKnM)}×${p.spanM}²/8`, selfWeightMuKnM, 'kN·m', 'ASSUMED-SIMPLE-SPAN', 'แรงกระจายสม่ำเสมอบนช่วงรองรับง่าย ไม่แทนคานต่อเนื่องจริง'),
    F('selfWeightVuKn', 'แรงเฉือนตัวอย่าง', 'Vu,self = wuL/2', `${fmt(factoredSelfWeightKnM)}×${p.spanM}/2`, selfWeightVuKn, 'kN', 'ASSUMED-SIMPLE-SPAN'),
    F('usablePhiMnKnM', 'กำลังดัดที่ใช้เทียบ Mu ในโมดูล', 'usableφMn = φMn only if steel yields, εt≥0.004 and As≥As,min; otherwise unavailable', `เหล็กคราก=${steelYields}; εt=${fmt(tensionStrain)}; As=${fmt(AsMm2)} / As,min=${fmt(AsMinMm2)}`, usablePhiMnKnM, 'kN·m', 'SP-LEGACY-BEAM', 'นโยบายโมดูลแบบอนุรักษนิยม; ไม่ใช้ข้อยกเว้น 4/3 และไม่ใช่การรับรองทั้งระบบ'),
  ];
  const warnings = [
    'ใช้หน้าตัด BF1 จาก SD-05: เหล็กดึงหนึ่งหน้าเท่านั้น ไม่เพิ่มกำลังจากเหล็กอัดอีกหน้า; ไม่มีแรงอัดร่วม บิด ดัดสองแกน หรือ prestress',
    'cover 40 mm และช่วงรองรับง่าย 3 m เป็นสมมติฐานที่ต้องยืนยัน แม้แบบระบุระยะเข็ม 3 m ก็ยังไม่ได้ยืนยันสภาพยึดปลายคานจริง',
    'สมการที่เลือกเป็นรูปแบบประวัติ ACI318M-02 ไม่ใช่การตรวจมาตรฐานปัจจุบันครบทุกข้อ; ต้องยืนยันหลักเกณฑ์ออกแบบที่ใช้จริง',
    'φ(Vc+Vs) เป็นค่าจากสมการกำลังระบุ; ใช้ usablePhiVnKn ในการเทียบ Vu เพราะปลอกขั้นต่ำ/ระยะปลอกอาจจำกัดกำลังที่ใช้ได้',
    'φMn เป็นค่าระหว่างคำนวณ; ใช้ usablePhiMnKnM เทียบ Mu ได้เมื่อเหล็กคราก, εt ≥ 0.004 และ As ≥ As,min เท่านั้น; โมดูลไม่ใช้ข้อยกเว้น 4/3',
    'ยังไม่ตรวจแรงราวกันตก ลม แรงบิด คานต่อเนื่อง จุดต่อ ระยะพัฒนาแรง/สมอ การโก่ง การแตกร้าว เสาเข็ม และปฏิสัมพันธ์ดิน–โครงสร้าง',
    'การผ่านเงื่อนไขกำลังข้อใดข้อหนึ่งไม่ใช่การอนุมัติหน้าตัดหรือระบบทั้งโครงการ; Mu/Vu ที่ไม่ทราบยังคงเป็น null',
  ];
  if (!minimumFlexuralSteelSatisfied) warnings.push(`As=${fmt(AsMm2)} mm² ต่ำกว่า As,min=${fmt(AsMinMm2)} mm²; ข้อยกเว้นต้องมีการวิเคราะห์แรงครบ ไม่ใช้ตัวอย่างน้ำหนักตัวเองเป็นเหตุรับรอง`);
  if (!steelYields) warnings.push('เหล็กไม่ครากตาม strain trial: โมดูลไม่คืนกำลังดัดที่อาศัย Asfy ต้องใช้การวิเคราะห์หน้าตัดเพิ่มเติม');
  return {
    method: 'Selected historical ACI318M-02 rectangular singly reinforced normal-weight beam equations',
    ...numericResults, steelYields, externalDemand, checks, formulaRows, warnings,
    projectApproved: false,
  };
}

export function validateSoilInputs(input) {
  try {
    const errors = checkObject(input, DEFAULT_SOIL_INPUTS);
    if (errors.length) return { valid: false, errors };
    if (!['effective', 'undrained'].includes(input.mode)) errors.push('mode ต้องเป็น effective หรือ undrained');
    bounded(errors, input, 'slopeH', 0.05, 50);
    bounded(errors, input, 'verticalDepthM', 0, 100);
    bounded(errors, input, 'unitWeightKnM3', 0, 40);
    bounded(errors, input, 'saturatedUnitWeightKnM3', 0, 40);
    bounded(errors, input, 'waterUnitWeightKnM3', 0, 15);
    if (input.saturatedUnitWeightKnM3 < input.unitWeightKnM3) errors.push('γsat ต้องไม่น้อยกว่า γ ที่เลือกสำหรับกรณีแห้ง');
    if (input.saturatedUnitWeightKnM3 <= input.waterUnitWeightKnM3) errors.push('กรณีซึมขนานลาดต้องมี γsat > γw');
    for (const [key, maximum] of [['frictionAngleDeg', 60], ['effectiveCohesionKpa', 1000], ['undrainedStrengthKpa', 1000]]) {
      if (input[key] !== null && (!finite(input[key]) || input[key] < 0 || input[key] > maximum)) errors.push(`${key} ต้องเป็นตัวเลขไม่ติดลบถึง ${maximum} หรือ null ในโหมดที่ไม่ใช้`);
    }
    if (input.mode === 'effective' && (input.frictionAngleDeg === null || input.effectiveCohesionKpa === null)) errors.push('Effective stress ต้องระบุ c′ และ φ′; ข้อมูลที่หายไปไม่ใช่ศูนย์');
    if (input.mode === 'undrained' && input.undrainedStrengthKpa === null) errors.push('Total stress ต้องระบุ Su ที่มีฐานข้อมูล; ไม่แปลงช่องว่างหรือขีดเป็นศูนย์');
    return { valid: errors.length === 0, errors };
  } catch {
    return { valid: false, errors: ['ไม่สามารถอ่านข้อมูลดินอย่างปลอดภัยได้'] };
  }
}

/** Mohr-Coulomb effective strength or undrained total-stress strength. */
export function soilShearStrength({ mode, normalStressKpa, porePressureKpa = null,
  effectiveCohesionKpa = null, frictionAngleDeg = null, undrainedStrengthKpa = null }) {
  if (!finite(normalStressKpa) || normalStressKpa < 0) throw new RangeError('ความเค้นรวมต้องเป็นตัวเลขไม่ติดลบ');
  if (mode === 'undrained') {
    if (!finite(undrainedStrengthKpa) || undrainedStrengthKpa < 0) throw new RangeError('ต้องมี Su สำหรับ total stress');
    return { shearStrengthKpa: undrainedStrengthKpa, effectiveNormalStressKpa: null,
      porePressureKpa: null, basis: 'Total stress: τf=Su; ไม่หัก u ซ้ำ' };
  }
  if (mode !== 'effective' || !finite(porePressureKpa) || porePressureKpa < 0
    || !finite(effectiveCohesionKpa) || effectiveCohesionKpa < 0
    || !finite(frictionAngleDeg) || frictionAngleDeg < 0 || frictionAngleDeg > 60) {
    throw new RangeError('Effective stress ต้องมี σ,u,c′,φ′ ที่เป็นตัวเลขถูกต้อง');
  }
  const effectiveNormalStressKpa = normalStressKpa - porePressureKpa;
  if (effectiveNormalStressKpa < 0) throw new RangeError('σ′<0 อยู่นอกขอบเขต frictional contact; ไม่ clamp เป็นศูนย์อย่างเงียบๆ');
  const shearStrengthKpa = effectiveCohesionKpa + effectiveNormalStressKpa * Math.tan(frictionAngleDeg * Math.PI / 180);
  requireFiniteDerived({ effectiveNormalStressKpa, shearStrengthKpa });
  return { shearStrengthKpa,
    effectiveNormalStressKpa, porePressureKpa, basis: 'Effective stress: τf=c′+(σ−u)tanφ′' };
}

/** Shallow plane parallel to a homogeneous slope; z is VERTICAL depth. */
export function calculateSoil(input) {
  const validation = validateSoilInputs(input);
  if (!validation.valid) throw new RangeError(validation.errors.join('; '));
  const p = input;
  const beta = Math.atan(1 / p.slopeH);
  const angleDegrees = beta * 180 / Math.PI;
  const cosSquared = p.slopeH ** 2 / (1 + p.slopeH ** 2);
  const sinCos = p.slopeH / (1 + p.slopeH ** 2);
  const makeCase = (id, label, gamma, porePressureKpa) => {
    const normalStressKpa = gamma * p.verticalDepthM * cosSquared;
    const shearDemandKpa = gamma * p.verticalDepthM * sinCos;
    requireFiniteDerived({ normalStressKpa, shearDemandKpa, porePressureKpa });
    requireNormalPositiveDivisor(shearDemandKpa, 'แรงเฉือนที่ต้องต้าน τ');
    const strength = soilShearStrength({ ...p, normalStressKpa, porePressureKpa });
    const factorOfSafety = strength.shearStrengthKpa / shearDemandKpa;
    requireFiniteDerived({ factorOfSafety });
    return { id, label, normalStressKpa, porePressureKpa: strength.porePressureKpa,
      effectiveNormalStressKpa: strength.effectiveNormalStressKpa,
      shearDemandKpa, shearStrengthKpa: strength.shearStrengthKpa,
      factorOfSafety,
      status: 'illustrative', gammaKnM3: gamma, basis: strength.basis };
  };
  const cases = p.mode === 'effective' ? [
    makeCase('dry', 'ลาดอนันต์: u=0', p.unitWeightKnM3, 0),
    makeCase('parallel-seepage', 'ลาดอนันต์: อิ่มตัวและน้ำซึมขนานลาด', p.saturatedUnitWeightKnM3,
      p.waterUnitWeightKnM3 * p.verticalDepthM * cosSquared),
  ] : [makeCase('undrained', 'ลาดอนันต์: total stress ด้วย Su', p.saturatedUnitWeightKnM3, null)];
  const formulaRows = [formula('angleDegrees', 'มุมลาดกับแนวราบ', 'β=atan(1/slopeH)', `atan(1/${fmt(p.slopeH)})×180/π`, angleDegrees, 'degree', 'S6006-SD-02')];
  for (const c of cases) {
    const F = (id, label, expression, substitution, value, unit) => formula(`${c.id}-${id}`, `${c.label}: ${label}`, expression, substitution, value, unit, 'USACE-1902', 'ลาดอนันต์เนื้อเดียว ระนาบวิบัติขนานลาด; ไม่ใช่ global FS ของโครงการ');
    formulaRows.push(
      F('sigma', 'ความเค้นรวม', 'σ=γz cos²β', `${fmt(c.gammaKnM3)}×${fmt(p.verticalDepthM)}×${fmt(cosSquared)}`, c.normalStressKpa, 'kPa'),
      F('tau', 'แรงเฉือนที่ต้องต้าน', 'τ=γz sinβ cosβ', `${fmt(c.gammaKnM3)}×${fmt(p.verticalDepthM)}×${fmt(sinCos)}`, c.shearDemandKpa, 'kPa'),
    );
    if (p.mode === 'effective') formulaRows.push(
      F('u', 'แรงดันน้ำ', c.id === 'dry' ? 'u=0' : 'u=γwz cos²β', c.id === 'dry' ? '0' : `${fmt(p.waterUnitWeightKnM3)}×${fmt(p.verticalDepthM)}×${fmt(cosSquared)}`, c.porePressureKpa, 'kPa'),
      F('strength', 'กำลังเฉือนประสิทธิผล', 'τf=c′+(σ−u)tanφ′', `${fmt(p.effectiveCohesionKpa)}+(${fmt(c.normalStressKpa)}−${fmt(c.porePressureKpa)})tan${fmt(p.frictionAngleDeg)}°`, c.shearStrengthKpa, 'kPa'),
    );
    else formulaRows.push(F('strength', 'กำลังเฉือน total stress', 'τf=Su', `${fmt(p.undrainedStrengthKpa)}`, c.shearStrengthKpa, 'kPa'));
    formulaRows.push(F('FS', 'FS ของกลไกสมมติ', 'FS=τf/τ', `${fmt(c.shearStrengthKpa)}/${fmt(c.shearDemandKpa)}`, c.factorOfSafety, '—'));
  }
  return {
    method: 'Homogeneous infinite-slope equilibrium; USACE EM1110-2-1902 AppendixC',
    mode: p.mode, angleDegrees, cases, formulaRows,
    checks: [
      { id: 'soil-method-scope', label: 'ขอบเขตแบบจำลองดิน', status: 'illustrative', value: null, limit: null,
        note: 'มีระนาบวิบัติเดียวขนานลาด เนื้อดินเดียว ความลึกแนวดิ่งคงที่; ไม่ตรวจวงกลมวิบัติ หลายชั้นดิน เสาเข็ม หรือการกัดเซาะ' },
      { id: 'soil-parameter-basis', label: 'ฐานพารามิเตอร์กำลังดิน', status: 'pending', value: null, limit: null,
        note: p.mode === 'effective' ? 'รายงานให้ตัวเลข γ20 และ φ32; การตีความ φ เป็น effective φ′ และใช้ γ20 กับกรณีแห้งเป็นสมมติฐาน ต้องยืนยันสภาพระบายน้ำ/วิธีทดสอบ เช่นเดียวกับ c′0, γsat20 และ z2; ไม่ได้แปลงขีดเป็นศูนย์' : 'Su ต้องมาจากการทดสอบ/การประเมินที่เหมาะกับชั้นดินและช่วงเวลา; ไม่รวม effective parameters ซ้ำ' },
    ],
    warnings: [
      'ผลเป็นกำลังเฉือนดินและ FS ของลาดอนันต์เนื้อเดียว ไม่ใช่ FS รวมของเขื่อน S6006 และไม่ใช่การคำนวณซ้ำของ Slope/W เดิม',
      'ความลึก z วัดในแนวดิ่ง; ไม่ใช่ความหนาตั้งฉากลาด และไม่ใช่ความสูงเขื่อน 13 m',
      'กรณีซึมขนานลาดสมมติอิ่มตัวถึงผิวลาดและ steady seepage ไม่มีน้ำภายนอกค้ำยัน จึงไม่ใช่กรณีน้ำลดฉับพลัน',
      'การมี c′>0 ในสูตรย่อยไม่ได้ตรวจรอยแยกแรงดึงหรือการวิบัติกลไกอื่น ต้องเลือกพารามิเตอร์จากผลทดสอบที่เหมาะสม',
      p.mode === 'effective' ? 'ใช้ c′,φ′ และความเค้นประสิทธิผล σ−u; Su ไม่ถูกนำมาปะปนในสูตร'
        : 'ใช้ Su ใน total stress โดยไม่หัก u ซ้ำ; ช่อง u และ σ′ จึงแสดง null ไม่ใช่ศูนย์',
      'ไม่มีการตั้งเกณฑ์ผ่านอัตโนมัติจาก FS ตัวอย่างนี้; ต้องตรวจระบบจริงด้วยแบบจำลองและกรณีน้ำที่เหมาะสม',
    ],
    projectApproved: false,
  };
}
