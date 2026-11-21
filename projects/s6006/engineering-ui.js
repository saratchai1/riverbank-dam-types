import {DEFAULT_BEAM_INPUTS, calculateBeam, DEFAULT_SOIL_INPUTS, calculateSoil} from './engineering.js';
import {sourceURL} from './case-data.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (v, n = 3) => v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', {maximumFractionDigits:n});
const beamFields = [
  ['widthMm','ความกว้าง b','mm'], ['heightMm','ความสูง h','mm'], ['coverMm','cover ถึงผิวนอกปลอก','mm · สมมติ'],
  ['tensionBarDiameterMm','ขนาดเหล็กดึง','mm'], ['tensionBarCount','จำนวนเหล็กดึงหนึ่งหน้า','เส้น'],
  ['stirrupDiameterMm','ขนาดเหล็กปลอก','mm'], ['stirrupLegs','จำนวนขาปลอก','ขา'], ['stirrupSpacingMm','ระยะปลอก','mm'],
  ['fcKsc','กำลังคอนกรีต f′c','kgf/cm²'], ['fyKsc','กำลังครากเหล็กดึง','kgf/cm²'], ['fyvKsc','กำลังครากเหล็กปลอก','kgf/cm²'],
  ['concreteUnitWeightTfM3','น้ำหนักจำเพาะ ค.ส.ล.','tf/m³'], ['spanM','ช่วงคานตัวอย่าง','m · รองรับง่าย'],
  ['deadLoadFactor','ตัวคูณน้ำหนักตัวเอง','ตัวคูณ D'], ['externalMuKnM','Mu ออกแบบจริง (ถ้ามี)','kN·m'],
  ['externalVuKn','Vu ออกแบบจริง (ถ้ามี)','kN'],
];
const soilFields = [
  ['slopeH','ลาดร่วมกับรูปตัด','H : 1V'], ['verticalDepthM','ความลึกแนวดิ่ง z','m · สมมติ'],
  ['unitWeightKnM3','น้ำหนักจำเพาะ γ','kN/m³'], ['saturatedUnitWeightKnM3','γsat','kN/m³ · สมมติ'],
  ['waterUnitWeightKnM3','γw','kN/m³'], ['frictionAngleDeg','มุมเสียดทาน φ′','°'],
  ['effectiveCohesionKpa','c′','kPa · สมมติ'], ['undrainedStrengthKpa','Su เมื่อใช้ total stress','kPa · ต้องกรอก'],
];
const inputHTML = (fields, input) => fields.map(([key,label,unit]) =>
  '<label class="field"><span>'+label+'<small>'+unit+'</small></span><input name="'+key+'" type="number" step="any" value="'+esc(input[key] ?? '')+'" aria-label="'+label+'"></label>').join('');
const checkLabel = status => ({
  pass:'เป็นไปตามเงื่อนไขนี้', fail:'ต้องทบทวน', passed:'เป็นไปตามเงื่อนไขนี้', failed:'ต้องทบทวน',
  satisfied:'เป็นไปตามเงื่อนไขนี้', 'not-satisfied':'ต้องทบทวน', review:'ต้องทบทวน', pending:'ยังสรุปไม่ได้',
  'not-required':'ไม่จำเป็นในกรณีนี้', 'not-evaluated':'ยังไม่ตรวจ', illustrative:'ตัวอย่างสมมติฐาน', 'requires-review':'ต้องทบทวน',
}[status] || status);
const formulas = rows => '<div class="table-wrap"><table class="formula-table"><thead><tr><th>รายการ</th><th>สูตร / การแทนค่า</th><th>ผล</th><th>หน่วย</th></tr></thead><tbody>'+rows.map(r =>
  '<tr><td>'+esc(r.label)+'</td><td class="formula">'+esc(r.formula)+'<small>'+esc(r.substitution)+'</small></td><td class="num n">'+fmt(r.value,4)+'</td><td>'+esc(r.unit)+'</td></tr>').join('')+'</tbody></table></div>';
const checks = rows => '<div class="table-wrap"><table><thead><tr><th>เงื่อนไข</th><th>ค่า / เกณฑ์</th><th>ผล</th><th>คำอธิบาย</th></tr></thead><tbody>'+rows.map(r =>
  '<tr><td>'+esc(r.label)+'</td><td>'+fmt(r.value,5)+' / '+fmt(r.limit,5)+'</td><td><span class="status amber">'+esc(checkLabel(r.status))+'</span></td><td>'+esc(r.note ?? '')+'</td></tr>').join('')+'</tbody></table></div>';
const warnings = rows => '<ul class="inline-list">'+rows.map(w => '<li>'+esc(w)+'</li>').join('')+'</ul>';
const beamSourceHTML = '<p class="minor engineering-provenance"><strong>ข้อมูลอ้างอิงเดิม:</strong> <a href="'+sourceURL('S-DWG')+'">SD-05, PDF หน้า 39 / แผ่น 38</a> ให้ BF1 250 × 500 mm, 2Ø12 บนและล่าง, ปลอก Ø6 @200 mm และระยะเข็ม 3 m; <a href="'+sourceURL('S-CALC')+'">รายการคำนวณหน้า 1 และ 3</a> ให้กำลังวัสดุและน้ำหนักจำเพาะ ค่าในสถานการณ์ปัจจุบันแสดงแยกไว้ ต้องยืนยันที่มาของค่าที่ปรับแก้</p>';
const soilSourceHTML = '<p class="minor engineering-provenance"><strong>ข้อมูลอ้างอิงเดิม:</strong> <a href="'+sourceURL('S-CALC')+'">รายงานหน้า 16</a> แถว Sand, Filled ให้ γ = 20 kN/m³ และ φ = 32° การใช้เป็น effective φ′ และกรณีแห้งต้องยืนยันวิธีทดสอบ ค่าเริ่มต้น c′=0, z=2 m และ γsat=20 เป็นสมมติฐานเดิม มิใช่การยืนยันค่าปัจจุบันหรือการแปลงขีดในต้นฉบับเป็นศูนย์</p>';
const soilReferenceHTML = '<p class="minor">ฐานสมการ: USACE EM 1110-2-1902 (2003), §C-7 สมการ C-22/C-23/C-27/C-29; กรณี c′&gt;0 และ total stress ดู §E-5 สมการ E-15/E-16.</p>';

function momentGateReason(r) {
  if (r.usablePhiMnKnM !== null) return 'ผ่านเงื่อนไขกำลังดัดในโมดูล';
  const reasons = [];
  if (!r.steelYields) reasons.push('เหล็กดึงไม่ครากตามสมมติฐาน');
  if (r.tensionStrain < 0.004) reasons.push('εt ต่ำกว่า 0.004');
  if (r.AsMm2 < r.AsMinMm2) reasons.push('As ต่ำกว่า As,min');
  return 'ยังใช้ตรวจไม่ได้: '+reasons.join('; ');
}
function flexuralCapacityText(r) {
  const intermediate = 'φMn จากสมการหน้าตัด = '+fmt(r.phiMnKnM,3)+' kN·m';
  return r.usablePhiMnKnM === null
    ? intermediate+'; '+momentGateReason(r)+' โมดูลไม่ใช้ข้อยกเว้น 4/3 As ที่ต้องการ จึงไม่ให้ผลผ่านจากค่าระหว่างคำนวณ'
    : intermediate+'; กำลังที่ใช้เทียบ Mu = '+fmt(r.usablePhiMnKnM,3)+' kN·m หลังผ่านเกณฑ์เหล็กคราก ความเครียดและเหล็กขั้นต่ำในโมดูล';
}
function shearCapacityText(r) {
  const intermediate = 'φ(Vc+Vs) จากสมการ = '+fmt(r.phiVnKn,3)+' kN';
  if (r.usablePhiVnKn === null) return intermediate+'; ยังไม่ให้เพดานเฉือนสำหรับเทียบ Vu เพราะ Vs เกินขีดจำกัดหน้าตัด';
  const failed = r.checks.filter(c => ['minimum-stirrups','stirrup-spacing'].includes(c.id) && c.status === 'review').map(c => c.label);
  return intermediate+'; เพดานที่ใช้เทียบ Vu = '+fmt(r.usablePhiVnKn,3)+' kN'
    +(failed.length ? ' โดยจำกัดด้วย '+failed.join(' และ ') : ' ตามเงื่อนไขปลอกที่ตรวจในโมดูล');
}
function beamDemandText(p) {
  const value = (v, unit) => v === null ? 'ยังไม่ระบุ' : fmt(v,4)+' '+unit;
  return 'แรงออกแบบจริงที่บันทึก: Mu = '+value(p.externalMuKnM,'kN·m')+'; Vu = '+value(p.externalVuKn,'kN')+' ค่าที่ไม่ระบุยังเป็นข้อมูลที่ขาดและไม่ถูกแทนด้วยศูนย์';
}
function beamWarnings(p, r) {
  const rows = [
    'โมเดลหน้าตัดปัจจุบันอิงรูปแบบ BF1 คิดเหล็กดึงหนึ่งหน้า ไม่เพิ่มกำลังจากเหล็กอีกหน้า; ไม่มีแรงอัดร่วม บิด ดัดสองแกน หรือ prestress',
    'cover '+fmt(p.coverMm)+' mm และช่วงรองรับง่าย '+fmt(p.spanM)+' m เป็นค่าที่กำหนดในสถานการณ์ ต้องยืนยันรายละเอียดและสภาพยึดปลายจริง',
    'สมการที่เลือกเป็นรูปแบบประวัติ ACI318M-02 ไม่ใช่การตรวจมาตรฐานปัจจุบันครบทุกข้อ; ต้องยืนยันหลักเกณฑ์ออกแบบที่ใช้จริง',
    'φ(Vc+Vs) เป็นค่าจากสมการกำลังระบุ; ใช้ usablePhiVnKn เทียบ Vu เพราะปลอกขั้นต่ำและระยะปลอกอาจจำกัดกำลัง',
    'φMn เป็นค่าระหว่างคำนวณ; ใช้ usablePhiMnKnM เทียบ Mu เมื่อเหล็กคราก, εt ≥ 0.004 และ As ≥ As,min; โมดูลไม่ใช้ข้อยกเว้น 4/3',
    'ยังไม่ตรวจแรงราวกันตก ลม แรงบิด คานต่อเนื่อง จุดต่อ ระยะพัฒนาแรง/สมอ การโก่ง การแตกร้าว เสาเข็ม และปฏิสัมพันธ์ดิน–โครงสร้าง',
    'การผ่านเงื่อนไขกำลังข้อใดข้อหนึ่งไม่ใช่การอนุมัติหน้าตัดหรือระบบทั้งโครงการ; แรงที่ไม่ได้ระบุยังเป็นข้อมูลที่ขาด',
  ];
  if (r.AsMm2 < r.AsMinMm2) rows.push('As='+fmt(r.AsMm2,3)+' mm² ต่ำกว่า As,min='+fmt(r.AsMinMm2,3)+' mm²; ไม่ใช้แรงน้ำหนักตัวเองเพียงกรณีเดียวรับรองข้อยกเว้น');
  if (!r.steelYields) rows.push('เหล็กไม่ครากตาม strain trial: ไม่คืนกำลังดัดที่อาศัย Asfy ต้องวิเคราะห์หน้าตัดเพิ่มเติม');
  return rows;
}
function soilParameterText(p) {
  const common = 'ค่าปัจจุบัน: ลาด '+fmt(p.slopeH)+'H:1V; z = '+fmt(p.verticalDepthM)+' m ในแนวดิ่ง; γsat = '+fmt(p.saturatedUnitWeightKnM3)+' kN/m³';
  return p.mode === 'undrained'
    ? common+'; total stress ใช้ Su = '+(p.undrainedStrengthKpa === null ? 'ยังไม่ระบุ' : fmt(p.undrainedStrengthKpa)+' kPa')+' โดยไม่ใช้ c′/φ′ และไม่หัก u ซ้ำ'
    : common+'; γ = '+fmt(p.unitWeightKnM3)+' kN/m³; γw = '+fmt(p.waterUnitWeightKnM3)+' kN/m³; c′ = '+fmt(p.effectiveCohesionKpa)+' kPa; φ′ = '+fmt(p.frictionAngleDeg)+'°';
}
function soilMethodHTML(p) {
  return p.mode === 'undrained'
    ? '<div class="method">σ = γsat z cos²β · τ = γsat z sinβ cosβ<br>τf = Su · FS = Su/τ<br>Total stress: ไม่หักแรงดันน้ำซ้ำจาก Su</div>'
    : '<div class="method">σ = γz cos²β · τ = γz sinβ cosβ<br>σ′ = σ − u · τf = c′ + σ′ tanφ′<br>FS = τf / τ<br>กรณี u=0 ใช้ γ ที่กำหนด<br>กรณีอิ่มตัวซึมขนานลาดใช้ γsat และ u = γw z cos²β</div>';
}
function soilMissingHTML(p, error) {
  const message = p.mode === 'undrained' && p.undrainedStrengthKpa === null
    ? 'ยังคำนวณไม่ได้: ยังไม่มี Su สำหรับ total stress ต้องกรอกค่าที่มีแหล่งอ้างอิงก่อนสร้างกำลังเฉือนและ FS'
    : 'ยังคำนวณไม่ได้: '+error;
  return '<div class="callout" data-state="missing-soil-result">'+esc(message)+'</div>';
}
function soilCalculation(p) {
  try { return {result:calculateSoil(p), error:null}; }
  catch (error) { return {result:null, error:error.message}; }
}
function soilWarnings(p) {
  const modeNote = p.mode === 'effective'
    ? 'ใช้ c′='+fmt(p.effectiveCohesionKpa)+' kPa และ φ′='+fmt(p.frictionAngleDeg)+'° กับ σ−u; ต้องยืนยันชนิดพารามิเตอร์และสภาพระบายน้ำจากแหล่งข้อมูลของสถานการณ์'
    : 'ใช้ Su='+(p.undrainedStrengthKpa === null ? 'ยังไม่ระบุ' : fmt(p.undrainedStrengthKpa)+' kPa')+' ใน total stress โดยไม่หัก u ซ้ำ; ช่อง u และ σ′ ที่ไม่ใช้คงเป็นข้อมูลไม่เกี่ยวข้อง มิใช่ศูนย์';
  const rows = [modeNote,
    'ลาดอนันต์เนื้อเดียวและระนาบวิบัติขนานลาด ไม่ใช่ FS รวมของ S6006 หรือผล Slope/W เดิม',
    'ความลึก z วัดในแนวดิ่ง ไม่ใช่ความหนาตั้งฉากลาดหรือความสูงเขื่อน',
    'ไม่มีการตั้งเกณฑ์ผ่านทั้งโครงการจากโมดูลนี้ ต้องตรวจระบบจริงด้วยแบบจำลองและกรณีน้ำที่เหมาะสม',
  ];
  if (p.mode === 'effective') rows.push('กรณีซึมขนานลาดสมมติอิ่มตัวถึงผิวลาดและ steady seepage ไม่มีน้ำภายนอกค้ำยัน จึงไม่ใช่กรณีน้ำลดฉับพลัน');
  if (p.mode === 'effective' && p.effectiveCohesionKpa > 0) rows.push('ค่า c′ ที่กำหนดไม่ได้ทำให้สูตรนี้ตรวจรอยแยกแรงดึงหรือการวิบัติกลไกอื่น ต้องยืนยันฐานพารามิเตอร์จากผลทดสอบ');
  return rows;
}

function beamSection(p) {
  const n = p.tensionBarCount, radius = Math.min(4,n > 1 ? 34/(n-1) : 4), points = [];
  for (let i=0;i<n;i++) {
    const x = n === 1 ? 133 : 82+i*(102/(n-1));
    points.push('<circle cx="'+x+'" cy="57" r="'+radius+'"/><circle cx="'+x+'" cy="183" r="'+radius+'"/>');
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 235" role="img" aria-label="หน้าตัดคานจากค่าปัจจุบัน แสดงเหล็กสองหน้า ภาพประกอบไม่ใช่มาตราส่วนก่อสร้าง"><rect width="400" height="235" rx="8" fill="#f5f7ef"/><g stroke="#526f5d" fill="none"><rect x="65" y="38" width="136" height="165" stroke-width="2"/><rect x="77" y="50" width="112" height="141" rx="7"/><path d="M65 28h136M65 23v10m136-10v10M219 38v165m-5-165h10m-10 165h10"/></g><g fill="#526f5d">'+points.join('')+'</g><g font-family="Tahoma,Noto Sans Thai,sans-serif" font-size="11" fill="#345341"><text x="133" y="19" text-anchor="middle">b = '+fmt(p.widthMm)+' mm</text><text x="231" y="118">h = '+fmt(p.heightMm)+' mm</text><text x="245" y="64">'+p.tensionBarCount+' Ø'+p.tensionBarDiameterMm+' / หน้า</text><text x="245" y="87">ปลอก Ø'+p.stirrupDiameterMm+' @'+p.stirrupSpacingMm+'</text><text x="245" y="152">cover '+p.coverMm+' mm*</text><text x="245" y="174">*ค่าที่กำหนด</text><text x="65" y="223" font-size="9">คิดเหล็กดึงหนึ่งหน้า · ภาพประกอบไม่ใช่มาตราส่วนก่อสร้าง</text></g></svg>';
}
function beamResultHTML(p, r) {
  return '<div class="engineering-results beam-metrics"><div class="fact"><small>พื้นที่เหล็กดึง As</small><strong>'+fmt(r.AsMm2,2)+' <small>mm²</small></strong></div><div class="fact"><small>φMn จากสมการหน้าตัด</small><strong>'+fmt(r.phiMnKnM,2)+' <small>kN·m</small></strong></div><div class="fact" data-metric="usable-moment"><small>φMn ที่ใช้ตรวจ Mu</small><strong>'+fmt(r.usablePhiMnKnM,2)+' <small>kN·m</small></strong><small>'+esc(momentGateReason(r))+'</small></div><div class="fact"><small>ขีดจำกัด Vu ที่ใช้ตรวจในโมดูล</small><strong>'+fmt(r.usablePhiVnKn,2)+' <small>kN</small></strong></div></div>'
    +'<div class="callout">'+esc(flexuralCapacityText(r))+'<br>'+esc(shearCapacityText(r))+'<br>'+esc(beamDemandText(p))+' การรับรองคานยังต้องตรวจแรงครบทุกกรณี รายละเอียด จุดต่อ และการใช้งานร่วมกัน</div>'
    +'<div class="two-col"><div>'+beamSection(p)+'</div><div><h3>แรงตัวอย่าง: น้ำหนักตัวเองเท่านั้น</h3><p>สมมติคานรองรับง่ายช่วง '+fmt(p.spanM)+' ม. ใช้ตัวคูณ '+fmt(p.deadLoadFactor)+' กับน้ำหนักตัวคาน</p><div class="formula-box">w = '+fmt(r.selfWeightKnM,4)+' kN/m<br>Mu = '+fmt(r.selfWeightMuKnM,4)+' kN·m<br>Vu = '+fmt(r.selfWeightVuKn,4)+' kN</div><p class="engineering-note">ยังไม่รวมแรงราวกันตก ลม แรงด้านข้าง/บิด น้ำหนักส่วนอื่น การต่อเนื่อง และปฏิสัมพันธ์กับเสาเข็ม</p></div></div>'
    +'<h3>เงื่อนไขและสถานะการตรวจ</h3>'+checks(r.checks)+'<details><summary class="small-heading">เปิดสูตรและการแทนค่าทั้งหมด</summary>'+formulas(r.formulaRows)+'</details><details><summary class="small-heading">ขอบเขตและข้อสมมติ</summary>'+warnings(beamWarnings(p,r))+'</details>';
}
function soilResultHTML(p, r) {
  return '<p class="engineering-current-inputs">'+esc(soilParameterText(p))+'</p>'
    +'<div class="engineering-results">'+r.cases.map(c => '<div class="fact"><small>'+esc(c.label)+'</small><strong>'+fmt(c.factorOfSafety,3)+' <small>FS แบบจำลองย่อย</small></strong></div>').join('')+'</div>'
    +'<div class="callout">ผลนี้เป็นลาดอนันต์เนื้อเดียวและระนาบวิบัติขนานลาด ใช้ศึกษากลไกตื้นและความไวต่อน้ำ ไม่ใช่ FS รวมของเขื่อนหลายชั้นดินหรือผลน้ำลดฉับพลัน Slope/W เดิม</div>'
    +'<div class="table-wrap"><table id="soil-results"><thead><tr><th>กรณี</th><th>σ (kPa)</th><th>u (kPa)</th><th>σ′ (kPa)</th><th>τ ที่ต้องต้าน (kPa)</th><th>กำลังเฉือน (kPa)</th><th>FS</th></tr></thead><tbody>'+r.cases.map(c =>
      '<tr><td>'+esc(c.label)+'</td><td class="num">'+fmt(c.normalStressKpa)+'</td><td class="num">'+fmt(c.porePressureKpa)+'</td><td class="num">'+fmt(c.effectiveNormalStressKpa)+'</td><td class="num">'+fmt(c.shearDemandKpa)+'</td><td class="num">'+fmt(c.shearStrengthKpa)+'</td><td class="num">'+fmt(c.factorOfSafety)+'</td></tr>').join('')+'</tbody></table></div>'
    +soilSourceHTML+formulas(r.formulaRows)+warnings(soilWarnings(p));
}

/** All accepted inputs belong to the project owner; this view retains no scenario copy. */
export function mountEngineering(container, options) {
  for (const key of ['getScenario','onChange','onSave','getRevision']) {
    if (typeof options?.[key] !== 'function') throw new TypeError('mountEngineering requires '+key);
  }
  const {getScenario, onChange, onSave, getRevision} = options;
  const readScenario = () => {
    const scenario = getScenario();
    return {beam:scenario.beamInputs, soil:{...scenario.soilInputs, slopeH:scenario.geometry.slopeH}, context:scenario.context};
  };
  container.innerHTML = '<div class="callout subtle">โครงสร้าง ดิน และรูปตัดใช้สถานการณ์โครงการเดียวกัน ความลาดในโมดูลดินเชื่อมกับรูปตัดที่เลือก บันทึกโครงการ JSON เพื่อเก็บค่าทุกส่วนร่วมกัน</div><p id="engineering-context" class="engineering-note" style="overflow-wrap:anywhere"></p>'
    +'<article class="card"><div class="card-head"><div><p class="eyebrow">RC BEAM / BF1</p><h2>กำลังดัดและเฉือนคานราวกันตก</h2></div><button id="save-engineering" class="button">บันทึกโครงการ JSON ↓</button></div>'
    +beamSourceHTML+'<div class="engineering-grid"><div><form id="beam-form" class="input-two"></form><button class="button full" id="reset-beam">คืนค่าคานตัวอย่าง BF1</button></div><div id="beam-output"></div></div></article>'
    +'<article class="card"><p class="eyebrow">SOIL STRENGTH / INFINITE SLOPE</p><h2>กำลังเฉือนดินและความไวต่อแรงดันน้ำ</h2><div class="engineering-grid"><div><form id="soil-form"><label class="field"><span>ชนิดพารามิเตอร์</span><select name="mode"><option value="effective">Effective stress: c′ / φ′</option><option value="undrained">Total stress: Su (ต้องกรอก)</option></select></label><div class="input-two"></div></form><button class="button full" id="reset-soil">คืนค่าดินตัวอย่าง · คงลาดรูปตัด</button></div><div id="soil-output"></div></div></article>'
    +'<div id="engineering-notice" class="notice" role="status" aria-live="polite" hidden></div>';
  const beamForm = container.querySelector('#beam-form'), soilForm = container.querySelector('#soil-form');
  const beamOut = container.querySelector('#beam-output'), soilOut = container.querySelector('#soil-output');
  const message = container.querySelector('#engineering-notice'), revision = container.querySelector('#engineering-context');
  const info = (text, error = false) => { message.textContent = text; message.hidden = false; message.classList.toggle('error',error); };

  const render = () => {
    const {beam, soil, context} = readScenario();
    beamForm.innerHTML = inputHTML(beamFields,beam);
    soilForm.querySelector('select').value = soil.mode;
    soilForm.querySelector('.input-two').innerHTML = inputHTML(soilFields,soil);
    revision.textContent = 'รุ่นสถานการณ์: '+getRevision()+' · ความลาดร่วม '+fmt(soil.slopeH)+'H:1V'
      +(context?.sourceNote ? ' · ที่มาสถานการณ์: '+context.sourceNote : '');
    try { beamOut.innerHTML = beamResultHTML(beam,calculateBeam(beam)); }
    catch (error) { beamOut.innerHTML = '<div class="callout">ยังคำนวณไม่ได้: '+esc(error.message)+'</div>'; }
    const {result, error} = soilCalculation(soil);
    soilOut.innerHTML = result ? soilResultHTML(soil,result)
      : '<p class="engineering-current-inputs">'+esc(soilParameterText(soil))+'</p>'+soilMissingHTML(soil,error)+soilSourceHTML;
    message.hidden = true;
  };
  const change = (section, patch, label) => {
    try {
      onChange(section,patch);
      render();
      const {soil} = readScenario();
      if (soil.mode === 'undrained' && soil.undrainedStrengthKpa === null) info('กรุณากรอก Su ที่มีแหล่งอ้างอิงก่อนคำนวณแบบ total stress');
    } catch (error) {
      render();
      info(label+': '+error.message,true);
    }
  };
  beamForm.addEventListener('submit', event => event.preventDefault());
  soilForm.addEventListener('submit', event => event.preventDefault());
  beamForm.addEventListener('change', event => {
    const {beam} = readScenario(), key = event.target.name;
    if (!Object.hasOwn(beam,key)) return;
    const raw = event.target.value;
    change('beamInputs',{[key]:raw.trim() === '' ? null : Number(raw)},'ค่าคานไม่ถูกต้อง');
  });
  soilForm.addEventListener('change', event => {
    const {soil} = readScenario(), key = event.target.name;
    if (!Object.hasOwn(soil,key)) return;
    const raw = event.target.value, value = key === 'mode' ? raw : raw.trim() === '' ? null : Number(raw);
    change(key === 'slopeH' ? 'geometry' : 'soilInputs',{[key]:value},'ค่าดินไม่ถูกต้อง');
  });
  container.querySelector('#reset-beam').addEventListener('click', () => {
    readScenario();
    change('beamInputs',{...DEFAULT_BEAM_INPUTS},'คืนค่าคานไม่ได้');
  });
  container.querySelector('#reset-soil').addEventListener('click', () => {
    readScenario();
    const {slopeH, ...defaults} = DEFAULT_SOIL_INPUTS;
    change('soilInputs',{...defaults},'คืนค่าดินไม่ได้');
  });
  container.querySelector('#save-engineering').addEventListener('click', async () => {
    try {
      readScenario();
      await onSave();
    } catch (error) { info('บันทึกโครงการไม่ได้: '+error.message,true); }
  });
  render();
  return {render};
}

/** Standalone calls retain the reference baseline; supplied scenarios are used in full. */
export function engineeringReportSections(options = {beamInputs:DEFAULT_BEAM_INPUTS, soilInputs:DEFAULT_SOIL_INPUTS}) {
  const b = {...options.beamInputs}, s = {...options.soilInputs}, r = calculateBeam(b);
  const {result:g, error:soilError} = soilCalculation(s);
  const soilInputHTML = '<p class="engineering-current-inputs">'+esc(soilParameterText(s))+'</p>';
  const soilTable = g ? '<table><thead><tr><th>กรณี</th><th>σ′</th><th>τ ที่ต้องต้าน</th><th>กำลังเฉือน</th><th>FS</th></tr></thead><tbody>'+g.cases.map(c =>
    '<tr><td>'+esc(c.label)+'</td><td>'+fmt(c.effectiveNormalStressKpa)+'</td><td>'+fmt(c.shearDemandKpa)+'</td><td>'+fmt(c.shearStrengthKpa)+'</td><td>'+fmt(c.factorOfSafety,6)+'</td></tr>').join('')+'</tbody></table>' : soilMissingHTML(s,soilError);
  const soilInterpretation = s.mode === 'undrained'
    ? 'สถานการณ์นี้ใช้ total stress: กำลังเฉือนมาจาก Su ที่บันทึก ไม่หักแรงดันน้ำซ้ำและไม่ใช้ c′/φ′ แทน Su ถ้ายังไม่ระบุ Su จะไม่มีผลกำลังเฉือนหรือ FS'
    : 'สถานการณ์นี้ใช้ effective stress: u ลด σ′ และส่วนกำลังเสียดทานเมื่อ φ′&gt;0 กรณี u=0 และกรณีอิ่มตัวใช้ค่าน้ำหนักจำเพาะตามที่กำหนด จึงต้องพิจารณาทั้งน้ำหนักและแรงดันน้ำ';
  const lowFS = g?.cases.some(c => c.factorOfSafety < 1);
  const soilScope = 'สูตรให้ผลตามสมมติฐานเนื้อดินเดียวและระนาบขนานลาด ไม่ครอบคลุมการวิบัติรวมหลายชั้นดินหรือแรงค้ำยันน้ำด้านนอก '
    +(lowFS ? 'มีกรณี FS ต่ำกว่า 1 ในสถานการณ์นี้ แต่ผลแบบจำลองย่อยยังไม่ใช่ข้อสรุปความปลอดภัยของทั้งโครงการ'
      : 'ค่าที่แสดงไม่ใช่ผลผ่านอัตโนมัติของทั้งโครงการ ต้องเลือกเงื่อนไขน้ำ พารามิเตอร์ และแบบจำลองให้ตรงกับปัญหาจริง');
  return [
    {
      title:'คาน BF1 — ค่าปัจจุบันและกำลัง',
      body:'<p class="eyebrow">07 / REINFORCED-CONCRETE STRENGTH</p><h2>คาน BF1: ค่าปัจจุบันและกำลังหน้าตัด</h2>'
        +'<div class="grid2"><div>'+beamSection(b)+'</div><div><p><strong>ค่าที่ใช้ในสถานการณ์นี้</strong><br>b = '+fmt(b.widthMm)+' mm; h = '+fmt(b.heightMm)+' mm<br>'+b.tensionBarCount+'Ø'+fmt(b.tensionBarDiameterMm)+' ด้านบนและด้านล่าง<br>ปลอก Ø'+fmt(b.stirrupDiameterMm)+' @'+fmt(b.stirrupSpacingMm)+' mm, '+b.stirrupLegs+' ขา<br>ช่วงรองรับง่าย '+fmt(b.spanM)+' m</p><p>f′c = '+fmt(b.fcKsc)+' kgf/cm²<br>fy = '+fmt(b.fyKsc)+' kgf/cm²<br>fyv = '+fmt(b.fyvKsc)+' kgf/cm²</p></div></div>'
        +'<p>ใช้ cover '+fmt(b.coverMm)+' mm ถึงผิวนอกปลอกเป็นค่ากำหนดที่ต้องยืนยัน โมเดลคิดเหล็กดึงหนึ่งหน้า ไม่เพิ่มกำลังจากเหล็กอีกหน้า และพิจารณาดัดแกนเดียวแบบไม่มีแรงอัดร่วม</p>'
        +'<div class="method">1 kgf/cm² = 0.0980665 MPa · 1 tf = 9.80665 kN<br>d = h − cover − dst − db/2 · As = nπdb²/4<br>a = As fy / (0.85 f′c b)<br>Mn = As fy (d − a/2) / 10⁶ [kN·m]<br>Vc = √f′c b d / (6×1000) [kN]<br>Vs = Av fyv d / (s×1000) [kN]</div>'
        +'<div class="grid3"><div class="metric">As<b>'+fmt(r.AsMm2,2)+' mm²</b>d = '+fmt(r.effectiveDepthMm,1)+' mm</div><div class="metric">φMn ที่ใช้ตรวจ Mu<b>'+fmt(r.usablePhiMnKnM,3)+'</b>kN·m · '+esc(momentGateReason(r))+'</div><div class="metric">ขีดจำกัด Vu ในโมดูล<b>'+fmt(r.usablePhiVnKn,3)+'</b>kN</div></div>'
        +'<h3>เหล็กขั้นต่ำและขอบเขตการใช้กำลัง</h3><div class="note">'+esc(flexuralCapacityText(r))+'<br>As = '+fmt(r.AsMm2,3)+' / As,min = '+fmt(r.AsMinMm2,3)+' mm²; Av = '+fmt(r.AvMm2,3)+' / Av,min = '+fmt(r.AvMinMm2,3)+' mm²<br>'+esc(shearCapacityText(r))+'</div>'
        +beamSourceHTML+'<p class="minor">ใช้สมการประวัติที่ระบุ ไม่ใช่การตรวจมาตรฐานปัจจุบันครบทุกข้อ และไม่รับรองระบบคาน–ราว–เข็มทั้งโครงการ</p>',
    },
    {
      title:'คาน BF1 — สูตรและแรงตัวอย่าง',
      body:'<p class="eyebrow">07 / BEAM CALCULATION DETAILS</p><h2>การแทนค่า · กำลังดัด</h2>'+formulas(r.formulaRows.slice(0,13))
        +'<div class="note">แรงตัวอย่างคำนวณเฉพาะน้ำหนักตัวคานบนช่วงรองรับง่าย '+fmt(b.spanM)+' ม. ภายใต้ตัวคูณ '+fmt(b.deadLoadFactor)+'D ไม่ใช่แรงครบทั้งระบบ '+esc(beamDemandText(b))+'</div>'
        +'<p class="minor">ต้องตรวจแรงราวกันตก/ลม บิด ดัดสองแกน คานต่อเนื่อง จุดต่อ–สมอ ระยะพัฒนาแรง เสาเข็ม กำลังดินรับเข็ม การโก่งและการแตกร้าวเพิ่มเติมตามระบบจริง</p>',
    },
    {
      title:'คาน BF1 — เฉือนและแรงตัวอย่าง',
      body:'<p class="eyebrow">07 / SHEAR & LOAD BENCHMARK</p><h2>การแทนค่า · เฉือนและแรงตัวอย่าง</h2>'+formulas(r.formulaRows.filter(row => row.id !== 'usablePhiMnKnM').slice(13))
        +'<div class="note">'+esc(shearCapacityText(r))+' ตัวเลขแรงจากน้ำหนักตัวเองเป็นกรณีสาธิต ไม่ครอบคลุมแรงราวกันตก ลม บิด คานต่อเนื่อง จุดต่อ และเสาเข็ม</div>'
        +'<p>ตัวอย่างนี้ใช้ '+fmt(b.deadLoadFactor)+'D กับช่วง '+fmt(b.spanM)+' ม. '+esc(beamDemandText(b))+' ผู้ใช้ต้องระบุแรงที่รวมกรณีและคูณตัวคูณแล้ว โมดูลไม่บวกแรงตัวอย่างซ้ำเข้าไป</p>',
    },
    {
      title:'คาน BF1 — เงื่อนไขการพิจารณา',
      body:'<p class="eyebrow">07 / CAPACITY CONDITIONS</p><h2>ตรวจเงื่อนไขก่อนใช้กำลังหน้าตัด</h2>'+checks(r.checks)
        +'<h3>ขอบเขตของโมดูลคาน</h3>'+warnings(beamWarnings(b,r))
        +'<div class="note">ตัวเลขกำลังต้องอ่านร่วมกับเงื่อนไขทั้งหมด รายงานนี้ไม่มีผล “ผ่านทั้งโครงการ” และไม่สรุปว่าแบบต้นฉบับผิดจากการตรวจสถานการณ์หรือเกณฑ์ทั่วไปเพียงข้อเดียว</div>',
    },
    {
      title:'ดิน — กำลังเฉือนและลาดอนันต์',
      body:'<p class="eyebrow">08 / SOIL STRENGTH & WATER SENSITIVITY</p><h2>กำลังเฉือนดิน · '+(s.mode === 'undrained' ? 'Total stress' : 'Effective stress')+'</h2>'
        +soilInputHTML+(g ? '<p>มุมลาด β = '+fmt(g.angleDegrees,4)+'°</p>' : '')+soilMethodHTML(s)+soilTable
        +'<p>ความเค้นและกำลังเฉือนมีหน่วย kPa; ค่า “—” คือข้อมูลที่ขาดหรือไม่ใช้ในโหมดนี้ ไม่ได้หมายถึงศูนย์</p>'
        +'<h3>การตีความผลของสถานการณ์</h3><p>'+soilInterpretation+'</p>'
        +'<div class="note">ลาดอนันต์เนื้อเดียวและระนาบวิบัติขนานลาด ใช้ศึกษากลไกตื้น ไม่แทนการวิบัติวงกลม/หลายชั้นดินของ S6006 ไม่ใช่กรณีน้ำลดฉับพลัน และไม่เปรียบตรงกับ FS ของ Slope/W เดิม</div>'
        +soilSourceHTML+soilReferenceHTML,
    },
    {
      title:'ดิน — สูตรและการแทนค่า',
      body:'<p class="eyebrow">08 / SOIL CALCULATION DETAILS</p><h2>การแทนค่าด้านดิน · '+(s.mode === 'undrained' ? 'Total stress ด้วย Su' : 'สองเงื่อนไขน้ำ')+'</h2>'
        +(g ? formulas(g.formulaRows) : soilInputHTML+soilMissingHTML(s,soilError)+soilMethodHTML(s))
        +'<div class="note">'+esc(soilScope)+'</div>',
    },
  ];
}
