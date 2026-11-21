import {
  createDemoProject, validateProject, lengthOf, formatStation, parseStation,
  parseAlignmentCSV, parseSurveyCSV, parseSoilCSV, parseDxf, surveyStations,
  groundSection, quantityRows, projectRevision, analysisRows, parseAnalysisCSV,
} from './core.js';
import { mountScene } from './scene.js';
import { sectionSVG, profileSVG, alignmentSVG } from './drawings.js';
import {
  sectionDXF, quantityCSV, surveyCSV, pileCSV, analysisCSV,
  projectJSON, parseProjectJSON, sceneOBJ,
} from './exports.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = (n, d = 2) => Number.isFinite(n) ? n.toLocaleString('en-US', {minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
const steps = ['survey','soil','section','review','export'];
const stepEyebrows = ['01 / PROJECT INPUT','02 / GROUND CONDITIONS','03 / SECTION DESIGN','04 / ENGINEERING REVIEW','05 / DELIVERABLES'];
const storeKey = 'riverbank-studio-project-v1';
const uploadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6"/></svg>';
const caseNames = {'construction':'ระหว่างก่อสร้าง','low-water':'ระยะยาว / น้ำต่ำ','drawdown':'น้ำลดเร็ว'};
let project = createDemoProject();
let step = steps.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'survey';
let drawingTab = 'section';
let scene = null;
let pendingDXF = null;
let undoStack = [];
let storageAvailable = true;
let saveTimer;
let activeSoil = 0;

try {
  const saved = localStorage.getItem(storeKey);
  if (saved) {
    try { project = parseProjectJSON(saved); }
    catch {
      // Preserve unreadable bytes so an automatic save cannot erase the only copy.
      localStorage.setItem(`${storeKey}-recovery-${Date.now()}`, saved);
      showNotice('เปิดข้อมูลที่เก็บในเบราว์เซอร์ไม่ได้ เก็บสำเนากู้คืนไว้แล้ว และเปิดข้อมูลสาธิตแทน', true);
    }
  }
} catch { storageAvailable = false; }

function showNotice(message, error = false) {
  const el = $('#notice');
  el.hidden = false;
  el.className = `notice${error ? ' error' : ''}`;
  el.replaceChildren();
  const span = document.createElement('span');
  span.textContent = message;
  const close = document.createElement('button');
  close.textContent = '×'; close.setAttribute('aria-label', 'ปิดข้อความ');
  close.onclick = () => { el.hidden = true; };
  el.append(span, close);
}

function saveLocal() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(storeKey, projectJSON(project));
      storageAvailable = true;
      $('#save-status').textContent = 'เก็บร่างในเบราว์เซอร์แล้ว';
    } catch {
      storageAvailable = false;
      $('#save-status').textContent = 'เก็บร่างไม่ได้ · กรุณาบันทึก JSON';
    }
  }, 250);
}

function commit(mutator, message, {refreshInspector = true} = {}) {
  try {
    const next = structuredClone(project);
    mutator(next);
    const result = validateProject(next);
    if (!result.valid) throw new Error(result.errors.join(' · '));
    const oldCurrent = analysisRows(project).some(r => r.status === 'current');
    const changedEngineering = projectRevision(project) !== projectRevision(next);
    undoStack.push(project); if (undoStack.length > 12) undoStack.shift();
    project = next;
    render({refreshInspector});
    saveLocal();
    if (message) showNotice(message);
    else if (changedEngineering && oldCurrent) showNotice('ข้อมูลออกแบบเปลี่ยนแล้ว ผลวิเคราะห์เดิมมีสถานะ “ล้าสมัย” โปรดวิเคราะห์และบันทึกผลใหม่');
    return true;
  } catch (error) {
    showNotice(error.message || 'ไม่สามารถใช้ข้อมูลนี้ได้', true);
    if (refreshInspector) renderInspector();
    else if (step === 'export') renderQuantities();
    return false;
  }
}

function textField(label, key, value, {help='', placeholder=''}={}) {
  return `<label class="field"><span>${esc(label)}</span><input data-field="${esc(key)}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="240">${help ? `<small class="field-help">${esc(help)}</small>`:''}</label>`;
}
function numericField(label, key, value, unit='ม.', extra='') {
  return `<label class="field"><span>${esc(label)}<span class="unit">${esc(unit)}</span></span><input data-number="${esc(key)}" type="number" step="any" value="${esc(value)}" ${extra}></label>`;
}
function nextButton(target,label) { return `<div class="next-step"><button class="button primary" data-go="${target}">${label} <span aria-hidden="true">→</span></button></div>`; }

function renderInspector() {
  $('#step-eyebrow').textContent = stepEyebrows[steps.indexOf(step)];
  $('#undo').disabled = !undoStack.length;
  const p=project, g=p.geometry, L=lengthOf(p.alignment);
  if (step==='survey') {
    $('#inspector-content').innerHTML = `
      <h2>เริ่มจากพื้นที่จริง</h2><p class="intro">แนวเขื่อนและรูปตัดเป็นข้อมูลตั้งต้นร่วมกันของแบบจำลองและปริมาณงาน</p>
      ${textField('ชื่อโครงการ','name',p.name)}${textField('รหัสโครงการ','code',p.code)}
      <section class="field-section"><h3 class="section-label">01 · แนวเขื่อน <span class="count">${p.alignment.length} จุด</span></h3>
        <button class="upload-box" data-file="alignment">${uploadIcon}<span>นำเข้าแนวสำรวจ</span><small>CSV พิกัด X,Y / ASCII DXF · หน่วยเมตร</small></button>
        <p class="import-source">ที่มา: <strong>${esc(p.sources?.alignment?.name || 'ไม่ระบุ')}</strong></p>
        <div class="template-links"><button data-template="alignment">ตัวอย่าง CSV</button><button data-template="dxf">ตัวอย่าง DXF</button></div>
        <p class="field-help">เลือกเส้นและ layer จาก DXF ได้ · เส้นตรง/โพลีไลน์เปิดในระนาบ XY<br>นำเข้าแนวใหม่จะเริ่มรูปตัด ข้อมูลดิน และผลวิเคราะห์ใหม่ กดย้อนกลับเพื่อกู้ชุดเดิมได้</p>
      </section>
      <section class="field-section"><h3 class="section-label">02 · รูปตัดสำรวจ <span class="count">${surveyStations(p).length} สถานี</span></h3>
        <button class="upload-box compact" data-file="survey">${uploadIcon}<span>นำเข้ารูปตัด CSV<small>station, offset, elevation</small></span></button>
        <p class="import-source">ที่มา: <strong>${esc(p.sources?.survey?.name || 'ยังไม่มีข้อมูล')}</strong></p>
        <div class="template-links"><button data-template="survey">ดาวน์โหลดโครงตาราง</button></div>
        <p class="field-help">offset ติดลบ = ฝั่งน้ำ · บวก = ฝั่งบก<br>ต้องมีอย่างน้อย 2 สถานีและ 2 จุดต่อรูปตัด · เปลี่ยนชุดสำรวจจะเริ่มทะเบียนผลวิเคราะห์ใหม่</p>
      </section>
      <section class="field-section"><h3 class="section-label">ระดับน้ำอ้างอิง</h3><div class="field-row">${numericField('สูงสุดเฉลี่ย','water.high',p.water.high)}${numericField('ต่ำสุดเฉลี่ย','water.low',p.water.low)}</div><div class="field-row">${numericField('ขณะสำรวจ','water.survey',p.water.survey)}${numericField('น้ำใต้ดิน','water.ground',p.water.ground)}</div><p class="field-help">ระดับสัมบูรณ์ ใช้ datum เดียวกับรูปตัดสำรวจ</p></section>
      ${nextButton('soil','ต่อไป · ข้อมูลดิน')}`;
  } else if (step==='soil') {
    const bhs=p.boreholes || [];
    activeSoil=Math.min(activeSoil,Math.max(0,bhs.length-1));
    const b=bhs[activeSoil];
    $('#inspector-content').innerHTML=`
      <h2>รู้จักดินใต้เขื่อน</h2><p class="intro">ผูกหลุมเจาะกับช่วงสถานี เก็บชั้นดิน ค่ากำลังเฉือน และที่มาของแต่ละชุดข้อมูล</p>
      <button class="upload-box compact" data-file="soil">${uploadIcon}<span>นำเข้าชั้นดิน CSV<small>จัดกลุ่มตามชื่อหลุมเจาะ</small></span></button>
      <div class="template-links"><button data-template="soil">ตัวอย่างตารางชั้นดิน</button></div>
      <div class="field-section"><h3 class="section-label">หลุมเจาะ <span class="count">${bhs.length} หลุม</span></h3>
        ${bhs.length?`<label class="field"><span>เลือกหลุมเจาะ</span><select id="soil-select">${bhs.map((bh,i)=>`<option value="${i}" ${i===activeSoil?'selected':''}>${esc(bh.id)} · ${formatStation(bh.fromStation)}–${formatStation(bh.toStation)}</option>`).join('')}</select></label>`:''}
        <button class="button secondary full small" data-action="add-borehole">+ เพิ่มหลุมเจาะด้วยตนเอง</button>
      </div>
      ${b?boreholeForm(b,activeSoil):'<div class="note-card">ยังไม่มีข้อมูลดิน นำเข้า CSV หรือเพิ่มหลุมเจาะเพื่อเริ่มกรอก</div>'}
      <p class="field-help">รุ่นนี้รับข้อมูลที่อ่านจากผลทดสอบแล้ว ไม่ได้ประมาณค่า SPT หรืออ่าน Excel/PDF อัตโนมัติ</p>
      ${nextButton('section','ต่อไป · ออกแบบหน้าตัด')}`;
  } else if (step==='section') {
    $('#inspector-content').innerHTML=`
      <h2>ประกอบหน้าตัด</h2><p class="intro">ปรับองค์ประกอบแนวคิด แล้วตรวจรูปตัดตามแนวสำรวจ มิติทุกค่ามีผลต่อภาพและปริมาณ</p>
      <div class="type-options"><button class="type-option ${g.type==='T3-01'?'selected':''}" data-type="T3-01"><span class="type-code">T3</span><span><strong>เสาเข็ม + แผงกรุ</strong><small>แถวหน้า · คานหัวเข็ม · พื้นทางเท้า</small></span></button><button class="type-option ${g.type==='T1-01'?'selected':''}" data-type="T1-01"><span class="type-code">T1</span><span><strong>ลาดหินเรียง + คาน</strong><small>หินเรียง · ชั้นกรอง · ตีนเขื่อน</small></span></button></div>
      <p class="parameter-source">รูปแบบแนวคิดย่อยของคลังเดิม · ค่าตั้งต้นเป็นตัวอย่าง</p>
      <section class="field-section"><h3 class="section-label">${g.type==='T3-01'?'ระดับและทางเท้า':'ระดับหน้าตัด'}</h3><div class="field-row">${numericField('ระดับสัน','geometry.crestLevel',g.crestLevel)}${numericField('ระดับตีน','geometry.toeLevel',g.toeLevel)}</div>${g.type==='T3-01'?`<div class="field-row">${numericField('กว้างทางเท้า','geometry.deckWidth',g.deckWidth)}${numericField('หนาทางเท้า','geometry.deckThickness',g.deckThickness)}</div>`:''}</section>
      <section class="field-section"><h3 class="section-label">${g.type==='T3-01'?'โครงสร้างแถวหน้า':'คานตามแนวสัน'}</h3><div class="field-row">${numericField('กว้างคาน','geometry.capWidth',g.capWidth)}${numericField('ลึกคาน','geometry.capDepth',g.capDepth)}</div>${g.type==='T3-01'?`<div class="field-row">${numericField('ขนาดเสาเข็ม','geometry.pileSize',g.pileSize)}${numericField('ยาวเสาเข็ม','geometry.pileLength',g.pileLength)}</div><div class="field-row">${numericField('ระยะเสาเข็ม','geometry.pileSpacing',g.pileSpacing)}${numericField('หนาแผงกรุ','geometry.panelThickness',g.panelThickness)}</div><p class="field-help">วางเสาเข็มจาก STA 0 ทุกช่วงระยะที่กำหนด นับปลายแนวเมื่อระยะลงตัว · ยังไม่มีเสาเข็มหลัง/เอียงและสายสมอ</p>`:''}</section>
      ${g.type==='T1-01'?`<section class="field-section"><h3 class="section-label">ลาดและวัสดุป้องกัน</h3><div class="field-row">${numericField('ความลาด 1 : m','geometry.slopeH',g.slopeH,'H/V')}${numericField('หนาหินเรียง','geometry.rockThickness',g.rockThickness)}</div><div class="field-row">${numericField('หนาชั้นกรอง','geometry.filterThickness',g.filterThickness)}${numericField('กว้างตีนเขื่อน','geometry.toeWidth',g.toeWidth)}</div>${numericField('สูงตีนเขื่อน','geometry.toeHeight',g.toeHeight)}</section>`:''}
      <a class="button secondary full" href="index.html#${g.type}" target="_blank" rel="noopener">ดูแบบอ้างอิงเดิมและชิ้นส่วน ↗</a>
      ${nextButton('review','ต่อไป · ตรวจรูปตัด')}`;
  } else if (step==='review') {
    const rows=analysisRows(p), current=rows.filter(r=>r.status==='current').length, stale=rows.filter(r=>r.status==='stale').length;
    const v=validateProject(p);
    $('#inspector-content').innerHTML=`
      <h2>ตรวจให้ย้อนกลับได้</h2><p class="intro">ตรวจรูปตัดแต่ละสถานี และบันทึกผลจากโปรแกรมวิเคราะห์พร้อมชื่อรายงานอ้างอิง</p>
      <div class="readiness"><div><span class="symbol">1</span><span><strong>แนวสำรวจ ${number(L)} ม.</strong><small>${esc(p.sources?.alignment?.name)}</small></span></div><div><span class="symbol">2</span><span><strong>${surveyStations(p).length} รูปตัด / ${(p.boreholes||[]).length} หลุมเจาะ</strong><small>ตรวจขอบเขตข้อมูลและที่มาให้ครบตามแนว</small></span></div><div><span class="symbol">3</span><span><strong>${current} ผลตรงข้อมูลรุ่นนี้</strong><small>${stale} ผลล้าสมัย · ${rows.length-current-stale} ผลยังไม่บันทึก</small></span></div></div>
      <div class="note-card amber">สถานะ “ตรงรุ่นข้อมูล” หมายถึงข้อมูลออกแบบตรงกับตอนบันทึกผล ไม่ใช่การรับรองความถูกต้องหรือผ่านการออกแบบ</div>
      ${v.warnings.length?`<ul class="status-list">${v.warnings.slice(0,6).map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}
      <section class="field-section"><h3 class="section-label">นำเข้าผลวิเคราะห์ภายนอก</h3><button class="upload-box compact" data-file="analysis">${uploadIcon}<span>นำเข้าผล FS จาก CSV<small>station, case, fs, reference</small></span></button><div class="template-links"><button data-template="analysis">โครงตารางผลวิเคราะห์</button></div><p class="field-help">เก็บ 3 กรณี: ก่อสร้าง / ระยะยาวน้ำต่ำ / น้ำลดเร็ว<br>เว็บยังไม่มีตัวแก้สมการเสถียรภาพหรือไฟล์ GeoStudio native</p></section>
      <section class="field-section"><h3 class="section-label">บันทึกผลทีละรายการ</h3><form id="analysis-form">
      <label class="field"><span>สถานีที่มีผล</span><select name="station">${reviewStations(p).map(s=>`<option value="${s}" ${Math.abs(p.selectedStation-s)<.01?'selected':''}>${formatStation(s)}</option>`).join('')}</select></label>
      <label class="field"><span>กรณีวิเคราะห์</span><select name="case">${Object.entries(caseNames).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select></label>
      <label class="field"><span>Factor of safety จากรายงาน</span><input name="fs" type="number" min="0.001" step="any" placeholder="ยังไม่มีผล" required></label>
      <label class="field"><span>เลขรายงาน / ไฟล์ / ผู้วิเคราะห์</span><input name="reference" maxlength="240" placeholder="ระบุหลักฐานอ้างอิง" required></label>
      <button class="button secondary full" type="submit">บันทึกผลที่สถานีนี้</button></form></section>
      ${nextButton('export','ต่อไป · ปริมาณและส่งออก')}`;
  } else {
    const qr=quantityRows(p);
    const missing=qr.filter(r=>r.amount==null).length;
    $('#inspector-content').innerHTML=`
      <h2>ส่งต่องานที่ตรวจได้</h2><p class="intro">ส่งรูปตัด ปริมาณ และข้อมูลโครงการ พร้อมสมมุติฐานเพื่อให้ทีมออกแบบทำงานต่อ</p>
      <section class="field-section"><h3 class="section-label">แบบและโมเดลแนวคิด</h3><div class="export-grid"><button data-export="dxf"><strong>DXF ↗</strong>รูปตัดสถานีนี้<small>เส้นและ layer · หน่วยเมตร</small></button><button data-export="svg"><strong>SVG ↗</strong>รูปตัดเวกเตอร์<small>ภาพพร้อมระดับและสถานะร่าง</small></button><button data-export="obj"><strong>OBJ ↗</strong>โมเดลโครงการ<small>แกน Z-up · หน่วยเมตร</small></button><button data-export="print"><strong>PDF / PRINT</strong>ใบทบทวนโครงการ<small>ผ่านหน้าพิมพ์ของเบราว์เซอร์</small></button></div></section>
      <section class="field-section"><h3 class="section-label">ตารางข้อมูล CSV</h3><div class="export-grid"><button data-export="quantity"><strong>QUANTITY</strong>ปริมาณและราคา<small>สูตร · สมมุติฐาน · แหล่งราคา</small></button><button data-export="survey"><strong>SURVEY</strong>รูปตัดสำรวจ<small>station · offset · elevation</small></button><button data-export="piles"><strong>PILES</strong>พิกัดเสาเข็ม<small>ตำแหน่งตามแนวและระดับ</small></button><button data-export="analysis"><strong>ANALYSIS</strong>ผลวิเคราะห์ที่บันทึก<small>แหล่งอ้างอิง · revision</small></button></div></section>
      <div class="note-card">${missing ? `${missing} รายการยังกรอกราคาไม่ครบ ยอดด้านขวารวมเฉพาะรายการที่มีราคาแล้ว`:'กรอกราคาครบทุกรายการในขอบเขตแนวคิดแล้ว โปรดตรวจแหล่งราคา'}<br>ยังไม่ใช่ ปร.4 ฉบับสมบูรณ์</div>
      <label class="field"><span>หมายเหตุโครงการ</span><textarea data-field="notes" maxlength="4000" rows="4" placeholder="ข้อมูลที่ต้องตรวจสอบหรือคำอธิบายเพิ่มเติม">${esc(p.notes)}</textarea></label>
      <button class="button primary full" data-export="json">บันทึกโครงการทั้งหมด · JSON ↓</button>
      <p class="field-help">เก็บแนว รูปตัด ดิน มิติ ราคา และผลวิเคราะห์ไว้เปิดแก้ไขต่อได้</p>`;
  }
}

function boreholeForm(b, index) {
  const attr=`data-bh="${index}"`;
  const bfield=(label,key,value,numeric=false,unit='')=>`<label class="field"><span>${label}<span class="unit">${unit}</span></span><input ${attr} data-bh-field="${key}" ${numeric?'type="number" step="any"':'maxlength="240"'} value="${esc(value)}"></label>`;
  return `<section class="bh-card"><h3>${esc(b.id)}<button class="inline-remove" data-remove-bh="${index}">ลบหลุมนี้</button></h3>
    ${bfield('ชื่อหลุมเจาะ','id',b.id)}${bfield('ตำแหน่งหลุม STA','station',b.station,true,'ม.')}
    <div class="field-row">${bfield('ใช้ตั้งแต่','fromStation',b.fromStation,true,'ม.')}${bfield('ถึงสถานี','toStation',b.toStation,true,'ม.')}</div>
    ${bfield('ที่มา / เอกสาร','source',b.source)}
    ${b.layers.map((l,i)=>`<div class="bh-layer"><h3>ชั้นที่ ${i+1}<button class="inline-remove" data-remove-layer="${i}" ${attr} ${b.layers.length<=1?'disabled':''}>ลบ</button></h3>
      <label class="field"><span>ชื่อชั้นดิน</span><input ${attr} data-layer-index="${i}" data-layer-field="name" value="${esc(l.name)}" maxlength="120"></label>
      <div class="field-row">${[['ระดับล่าง','bottom','ม.'],['γ','unitWeight','kN/m³'],["φ′",'phi','°'],["c′",'cohesion','kPa']].map(([label,key,unit])=>`<label class="field"><span>${label}<span class="unit">${unit}</span></span><input ${attr} data-layer-index="${i}" data-layer-field="${key}" type="number" step="any" value="${esc(l[key])}"></label>`).join('')}</div>
    </div>`).join('')}
    <button class="button secondary full small" data-add-layer="${index}">+ เพิ่มชั้นดิน</button>
    <label class="check-row"><input type="checkbox" ${attr} data-bh-field="verified" ${b.verified?'checked':''}>ผู้ใช้ยืนยันว่าวิศวกรตรวจชุดข้อมูลดินนี้แล้ว</label>
    <p class="field-help">ระดับล่างเรียงจากบนลงล่าง ระบบไม่คำนวณความสามารถรับน้ำหนักจากข้อมูลนี้</p></section>`;
}

function reviewStations(p) {
  const s=surveyStations(p);
  return s.length?s:[0,lengthOf(p.alignment)];
}

function renderReview() {
  const rows=analysisRows(project);
  const count=status=>rows.filter(r=>r.status===status).length;
  $('#review-area').innerHTML=`<div class="summary-cards"><div class="summary-card"><strong>${count('current')}</strong><span>ผลตรงกับข้อมูลรุ่นนี้</span></div><div class="summary-card"><strong>${count('stale')}</strong><span>ผลล้าสมัยหลังแก้ข้อมูล</span></div><div class="summary-card"><strong>${count('missing')}</strong><span>ผลที่ยังไม่บันทึก</span></div></div>
    <h2>บันทึกผลวิเคราะห์รายสถานี</h2><p class="intro">ตัวเลข FS มาจากผลภายนอกที่ผู้ใช้บันทึก ไม่ได้คำนวณหรือรับรองโดยเว็บนี้ · รุ่นข้อมูล <code>${esc(projectRevision(project))}</code></p>
    <div class="table-card"><table class="data-table"><thead><tr><th>STA</th><th>กรณีวิเคราะห์</th><th>FS ภายนอก</th><th>สถานะข้อมูล</th><th>หลักฐานอ้างอิง</th></tr></thead><tbody>${rows.map(r=>`<tr class="${Math.abs(r.station-project.selectedStation)<.01?'selected':''}"><td><button class="station-button" data-station="${r.station}">${formatStation(r.station)}</button></td><td>${esc(r.label||caseNames[r.case])}</td><td class="numeric">${r.fs==null?'—':number(r.fs,3)}</td><td>${statusBadge(r.status)}</td><td>${esc(r.reference||'ยังไม่มีผลวิเคราะห์')}</td></tr>`).join('')}</tbody></table></div>
    <p class="report-note">ยังต้องตรวจเสถียรภาพลาดดิน การไหลซึม น้ำลดเร็ว การกัดเซาะ กำลังเสาเข็ม และรายละเอียดเหล็กเสริมด้วยวิธีที่เหมาะสมกับโครงการ ไม่ใช้ค่า FS ของกำแพงแรงโน้มถ่วงแทนระบบเสาเข็มหรือหินเรียง</p>`;
}

function statusBadge(status) {
  return status==='current'?'<span class="badge gray">ตรงรุ่นข้อมูล</span>':status==='stale'?'<span class="badge amber">ล้าสมัย</span>':'<span class="badge gray">ยังไม่มีผล</span>';
}

function renderQuantities() {
  const rows=quantityRows(project), priced=rows.filter(r=>r.amount!=null);
  const subtotal=priced.reduce((s,r)=>s+r.amount,0);
  $('#quantity-area').innerHTML=`<div class="summary-cards"><div class="summary-card"><strong>${rows.length}</strong><span>รายการในขอบเขตแนวคิด</span></div><div class="summary-card"><strong>${priced.length}/${rows.length}</strong><span>รายการที่กรอกราคาแล้ว</span></div><div class="summary-card"><strong style="font-size:20px">${priced.length?number(subtotal,2):'—'}</strong><span>บาท · ยอดเฉพาะรายการมีราคา</span></div></div>
    <h2>ปริมาณที่ตรวจสอบที่มาได้</h2><p class="intro">ใช้มิติจากหน้าตัดเดียวกับรูปและโมเดล · กรอกราคาวัสดุ ค่าแรง และแหล่งอ้างอิงแยกรายการ</p>
    <div class="table-card"><table class="data-table"><thead><tr><th>รายการ / สูตร</th><th>ปริมาณ</th><th>หน่วย</th><th>วัสดุ/หน่วย<br>บาท</th><th>แรง/หน่วย<br>บาท</th><th>แหล่งราคา</th><th>รวม บาท</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong><div class="muted"><code>${esc(r.code)}</code> · ${esc(r.formula)}<br>${esc(r.assumption||'')}</div></td><td class="numeric">${number(r.quantity,3)}</td><td>${esc(r.unit)}</td><td><input type="number" min="0" step="any" data-rate="material" data-code="${esc(r.code)}" value="${r.materialRate==null?'':r.materialRate}" placeholder="ยังไม่ระบุ" aria-label="ค่าวัสดุ ${esc(r.name)}"></td><td><input type="number" min="0" step="any" data-rate="labour" data-code="${esc(r.code)}" value="${r.labourRate==null?'':r.labourRate}" placeholder="ยังไม่ระบุ" aria-label="ค่าแรง ${esc(r.name)}"></td><td><input class="price-source" data-rate="source" data-code="${esc(r.code)}" value="${esc(r.priceSource||'')}" placeholder="เอกสาร / วันที่ราคา" maxlength="240" aria-label="แหล่งราคา ${esc(r.name)}"></td><td class="numeric">${r.amount==null?'—':number(r.amount)}</td></tr>`).join('')}</tbody></table></div>
    <p class="report-note">ปริมาณนี้เป็นองค์ประกอบแนวคิดบางส่วน ${project.geometry.type==='T3-01'?'ไม่รวมเสาเข็มหลัง/เอียง สายสมอ ราว และงานระบายน้ำ':'ไม่รวมงานถม ขุด และองค์ประกอบนอกหน้าตัดที่สร้าง'} · ยังไม่รวมเหล็กเสริม ราคาค่าใช้จ่ายอื่น Factor F และภาษี ดู BOQ ต้นฉบับของแบบมาตรฐานได้ในคลังแบบเดิม</p>`;
}

function renderDrawing() {
  const p=project, L=lengthOf(p.alignment);
  $('#station-title').textContent=formatStation(p.selectedStation);
  $('#station-input').value=formatStation(p.selectedStation);
  $('#station-range').max=String(L);
  $('#station-range').value=String(p.selectedStation);
  $('#station-max').textContent=formatStation(L);
  $('#station-min').textContent=formatStation(0);
  $('#previous-station').disabled=p.selectedStation<=0;
  $('#next-station').disabled=p.selectedStation>=L;
  const fn=drawingTab==='section'?()=>sectionSVG(p,p.selectedStation):drawingTab==='profile'?()=>profileSVG(p):()=>alignmentSVG(p);
  $('#drawing').innerHTML=fn();
  const hasGround=groundSection(p,p.selectedStation).length>0;
  $('#drawing-note').textContent=drawingTab==='section'?`มาตราส่วนแกนเท่ากัน · หน่วยเมตร${hasGround?'':' · ยังไม่มีสำรวจครอบคลุมสถานีนี้'}`:drawingTab==='profile'?'ระดับดินตามแนว offset 0 · แสดงเฉพาะขอบเขตข้อมูล':'พิกัดแผนที่ตามไฟล์โครงการ · หน่วยเมตร';
  $$('[data-drawing]').forEach(b=>b.classList.toggle('selected',b.dataset.drawing===drawingTab));
}

function render({refreshInspector=true}={}) {
  $('#project-name').textContent=project.name;
  $('#project-code').textContent=project.code;
  $('#length-value').textContent=number(lengthOf(project.alignment));
  $('#section-count').textContent=surveyStations(project).length;
  const demo=project.sources?.alignment?.kind==='demo'||project.sources?.survey?.kind==='demo';
  $('#source-badge').textContent=demo?'มีข้อมูลสาธิต':'ข้อมูลผู้ใช้';
  $('#source-badge').className=`badge ${demo?'amber':'gray'}`;
  $$('[data-step]').forEach(b=>b.dataset.step===step?b.setAttribute('aria-current','step'):b.removeAttribute('aria-current'));
  if(refreshInspector)renderInspector();
  renderDrawing();
  $('#review-area').hidden=step!=='review';
  $('#quantity-area').hidden=step!=='export';
  if(step==='review')renderReview();
  if(step==='export')renderQuantities();
  if(scene)scene.update(project);
  $('#save-status').textContent=storageAvailable?'ร่างอยู่ในเบราว์เซอร์ · บันทึก JSON เพื่อสำรอง':'กรุณาบันทึก JSON เพื่อสำรอง';
}

function goTo(next) {
  if(!steps.includes(next))return;
  step=next;
  history.replaceState(null,'',`#${step}`);
  render();
  $$('[data-step]').find(b=>b.dataset.step===step)?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
}

function setStation(s) {
  const L=lengthOf(project.alignment);
  if(!Number.isFinite(s)||s<0||s>L) { showNotice(`สถานีต้องอยู่ระหว่าง 0 ถึง ${number(L,3)} ม.`,true); $('#station-input').value=formatStation(project.selectedStation); return; }
  project.selectedStation=s;
  renderDrawing(); scene?.update(project);
  if(step==='review')renderReview();
  saveLocal();
}

function numericInput(el) {
  if(el.value.trim()==='')throw new Error('กรุณากรอกตัวเลข ช่องว่างไม่ใช่ค่า 0');
  const value=Number(el.value);
  if(!Number.isFinite(value))throw new Error('กรุณากรอกตัวเลขที่ใช้ได้');
  return value;
}

document.addEventListener('change',event=>{
  const el=event.target;
  try {
    if(el.matches('[data-field]')) {
      commit(p=>{p[el.dataset.field]=el.value;});
    } else if(el.matches('[data-number]')) {
      const value=numericInput(el),[group,key]=el.dataset.number.split('.');
      commit(p=>{p[group][key]=value;});
    } else if(el.matches('[data-bh-field]')) {
      const i=Number(el.dataset.bh),key=el.dataset.bhField;
      const value=key==='verified'?el.checked:el.type==='number'?numericInput(el):el.value;
      commit(p=>{p.boreholes[i][key]=value;if(key!=='verified')p.boreholes[i].verified=false;});
    } else if(el.matches('[data-layer-field]')) {
      const i=Number(el.dataset.bh),j=Number(el.dataset.layerIndex),key=el.dataset.layerField;
      const value=el.type==='number'?numericInput(el):el.value;
      commit(p=>{p.boreholes[i].layers[j][key]=value;p.boreholes[i].verified=false;});
    } else if(el.matches('[data-rate]')) {
      const key=el.dataset.rate,code=el.dataset.code;
      const value=key==='source'?el.value:el.value.trim()===''?null:numericInput(el);
      commit(p=>{p.prices[code]??={material:null,labour:null,source:''};p.prices[code][key]=value;},null,{refreshInspector:false});
    } else if(el.id==='soil-select') {
      activeSoil=Number(el.value);renderInspector();
    } else if(el.matches('[data-layer]')) scene?.setLayer(el.dataset.layer,el.checked);
  } catch(error) { showNotice(error.message,true);render(); }
});

document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button)return;
  if(button.dataset.step)goTo(button.dataset.step);
  else if(button.dataset.go)goTo(button.dataset.go);
  else if(button.dataset.file)$(`#file-${button.dataset.file}`).click();
  else if(button.dataset.template)downloadTemplate(button.dataset.template);
  else if(button.dataset.type) {
    const type=button.dataset.type;
    commit(p=>{
      if(p.geometry.type!==type){p.geometry.type=type;}
    });
  } else if(button.dataset.view) {
    scene?.setView(button.dataset.view);
    $$('[data-view]').forEach(b=>b.classList.toggle('selected',b===button));
  } else if(button.dataset.drawing) {
    drawingTab=button.dataset.drawing;renderDrawing();
  } else if(button.dataset.station) {
    setStation(Number(button.dataset.station));
    $('#drawing').scrollIntoView({block:'center',behavior:'instant'});
  } else if(button.dataset.export)doExport(button.dataset.export);
  else if(button.dataset.action==='add-borehole') {
    const ids=new Set(project.boreholes.map(b=>b.id));let n=1;while(ids.has(`BH-${String(n).padStart(2,'0')}`))n++;
    const id=`BH-${String(n).padStart(2,'0')}`;
    // New material properties are editable examples, explicitly not verified.
    activeSoil=project.boreholes.length;
    commit(p=>p.boreholes.push({id,station:p.selectedStation,fromStation:0,toStation:lengthOf(p.alignment),source:'กรอกเอง · ค่าตั้งต้นต้องแก้ตามผลทดสอบ',verified:false,layers:[{bottom:p.geometry.toeLevel-5,name:'ชั้นดินที่ 1 · ระบุชื่อจริง',unitWeight:18,phi:30,cohesion:0}]}),'เพิ่มหลุมเจาะแล้ว ค่าตั้งต้นเป็นตัวอย่าง กรุณาแก้ให้ตรงผลทดสอบและระบุที่มา');
  } else if(button.dataset.removeBh!==undefined)commit(p=>p.boreholes.splice(Number(button.dataset.removeBh),1));
  else if(button.dataset.addLayer!==undefined) {
    const i=Number(button.dataset.addLayer);
    commit(p=>{const bh=p.boreholes[i],last=bh.layers.at(-1);bh.layers.push({bottom:last.bottom-5,name:`ชั้นดินที่ ${bh.layers.length+1}`,unitWeight:last.unitWeight,phi:last.phi,cohesion:last.cohesion});bh.verified=false;},'เพิ่มชั้นดินโดยคัดลอกค่าจากชั้นก่อนหน้า กรุณาแก้ระดับและคุณสมบัติให้ตรงผลทดสอบ');
  } else if(button.dataset.removeLayer!==undefined) {
    commit(p=>{const bh=p.boreholes[Number(button.dataset.bh)];bh.layers.splice(Number(button.dataset.removeLayer),1);bh.verified=false;});
  }
});

document.addEventListener('submit',event=>{
  if(event.target.id!=='analysis-form')return;
  event.preventDefault();
  const fd=new FormData(event.target);
  const station=Number(fd.get('station')),scenario=String(fd.get('case')),fs=Number(fd.get('fs')),reference=String(fd.get('reference')).trim();
  if(!reference||!Number.isFinite(fs)||fs<=0){showNotice('ต้องระบุ FS เป็นค่าบวกและหลักฐานอ้างอิง',true);return;}
  commit(p=>{
    p.analysis=p.analysis.filter(r=>!(Math.abs(r.station-station)<1e-6&&r.case===scenario));
    p.analysis.push({station,case:scenario,fs,reference,revision:projectRevision(p)});
  },'บันทึกผลภายนอกพร้อมรุ่นข้อมูลแล้ว กรุณาตรวจหลักฐานและผลกับผู้วิเคราะห์');
});

$('#station-range').addEventListener('input',event=>setStation(Number(event.target.value)));
$('#station-input').addEventListener('change',event=>{try{setStation(parseStation(event.target.value));}catch(error){showNotice(error.message,true);renderDrawing();}});
$('#previous-station').onclick=()=>{const s=surveyStations(project).filter(s=>s<project.selectedStation-1e-6);setStation(s.length?s.at(-1):0);};
$('#next-station').onclick=()=>{const s=surveyStations(project).find(s=>s>project.selectedStation+1e-6);setStation(s??lengthOf(project.alignment));};
$('#fit-view').onclick=()=>scene?.fit();
$('#open-project').onclick=()=>$('#file-project').click();
$('#save-project').onclick=()=>doExport('json');
$('#export-section-quick').onclick=()=>doExport('svg');
$('#reset-demo').onclick=()=>$('#demo-dialog').showModal();
$('#confirm-demo').onclick=()=>{
  $('#demo-dialog').close();
  commit(p=>{Object.keys(p).forEach(k=>delete p[k]);Object.assign(p,createDemoProject());},'เปิดโครงการสาธิตแล้ว ทุกค่าต้องตรวจสอบก่อนนำไปใช้กับโครงการจริง');
  scene?.fit();
};
$('#undo').onclick=()=>{
  if(!undoStack.length)return;
  project=undoStack.pop();render();saveLocal();showNotice('ย้อนกลับไปข้อมูลก่อนแก้ไขแล้ว');
};

async function readFile(input,maxBytes=12*1024*1024) {
  const file=input.files?.[0];input.value='';
  if(!file)return null;
  if(file.size>maxBytes)throw new Error('ไฟล์ใหญ่เกิน 12 MB โปรดตัดข้อมูลเป็นขอบเขตโครงการก่อนนำเข้า');
  return {file,text:await file.text()};
}

function applyAlignment(points,name,kind) {
  const ok=commit(p=>{
    p.alignment=points;p.survey=[];p.boreholes=[];p.analysis=[];
    p.sources={...p.sources,alignment:{kind,name},survey:{kind:'missing',name:'ยังไม่ได้นำเข้ารูปตัดสำหรับแนวนี้'}};
    p.selectedStation=Math.min(p.selectedStation,lengthOf(points));
  },`ใช้แนว ${name} แล้ว (${number(lengthOf(points))} ม.) เริ่มรูปตัด ดิน และผลวิเคราะห์ใหม่สำหรับแนวนี้ · กดย้อนกลับเพื่อกู้ชุดเดิม`);
  if(ok)scene?.fit();
}

$('#file-alignment').addEventListener('change',async event=>{
  try {
    const result=await readFile(event.target);if(!result)return;
    const {file,text}=result;
    if(/\.csv$/i.test(file.name)){applyAlignment(parseAlignmentCSV(text),file.name,'csv');return;}
    if(!/\.dxf$/i.test(file.name))throw new Error('รองรับ CSV และ ASCII DXF เท่านั้น โปรดแปลง DWG เป็น DXF หน่วยเมตรก่อน');
    const parsed=parseDxf(text);
    if(!parsed.paths.length)throw new Error(`ไม่พบแนวเปิดที่รองรับ ${parsed.warnings.join(' · ')}`);
    pendingDXF={...parsed,name:file.name};
    $('#import-content').innerHTML=`<p>เลือกเส้นแนวเขื่อนที่ต้องการจาก <strong>${esc(file.name)}</strong></p>${parsed.paths.map((path,i)=>`<label class="path-choice"><input type="radio" name="dxf-path" value="${i}" ${i===0?'checked':''}><span><strong>${esc(path.layer||'0')}</strong><small>${path.points.length} จุด · ${number(lengthOf(path.points))} ม. · ${esc(path.id)}</small></span></label>`).join('')}${parsed.warnings.length?`<div class="note-card amber">${parsed.warnings.map(esc).join('<br>')}</div>`:''}<label class="check-row"><input id="metres-confirm" type="checkbox">ยืนยันว่าพิกัดในไฟล์นี้มีหน่วยเป็นเมตร</label><p class="field-help">เลือกแนวใหม่จะเริ่มรูปตัด หลุมเจาะ และผลวิเคราะห์ใหม่ สามารถกดย้อนกลับได้</p>`;
    $('#import-dialog').showModal();
  } catch(error){showNotice(error.message,true);}
});

$('#apply-dxf').onclick=()=>{
  if(!pendingDXF)return;
  if(!$('#metres-confirm').checked){showNotice('โปรดยืนยันหน่วยเมตรก่อนใช้แนว DXF',true);return;}
  const index=Number($('input[name="dxf-path"]:checked').value);
  const path=pendingDXF.paths[index];
  applyAlignment(path.points,`${pendingDXF.name} / ${path.layer}`,'dxf');
  $('#import-dialog').close();pendingDXF=null;
};

$('#file-survey').addEventListener('change',async event=>{
  try{const r=await readFile(event.target);if(!r)return;const survey=parseSurveyCSV(r.text);
    commit(p=>{p.survey=survey;p.sources.survey={kind:'csv',name:r.file.name};p.analysis=[];},`นำเข้ารูปตัด ${r.file.name} แล้ว และเริ่มทะเบียนผลวิเคราะห์สำหรับชุดสำรวจนี้ใหม่`);
  }catch(error){showNotice(error.message,true);}
});
$('#file-soil').addEventListener('change',async event=>{
  try{const r=await readFile(event.target);if(!r)return;const bhs=parseSoilCSV(r.text);activeSoil=0;
    commit(p=>{p.boreholes=bhs;},`นำเข้าหลุมเจาะ ${bhs.length} หลุมแล้ว โปรดตรวจช่วงสถานีและที่มาของชั้นดิน`);
  }catch(error){showNotice(error.message,true);}
});
$('#file-analysis').addEventListener('change',async event=>{
  try{const r=await readFile(event.target);if(!r)return;const rows=parseAnalysisCSV(r.text,project);
    commit(p=>{for(const row of rows){p.analysis=p.analysis.filter(old=>!(Math.abs(old.station-row.station)<1e-6&&old.case===row.case));p.analysis.push(row);}},`บันทึกผลภายนอก ${rows.length} รายการกับข้อมูลรุ่นนี้แล้ว`);
  }catch(error){showNotice(error.message,true);}
});
$('#file-project').addEventListener('change',async event=>{
  try{const r=await readFile(event.target);if(!r)return;const imported=parseProjectJSON(r.text);
    commit(p=>{Object.keys(p).forEach(k=>delete p[k]);Object.assign(p,imported);},`เปิดโครงการ ${imported.name} แล้ว`);scene?.fit();
  }catch(error){showNotice(error.message,true);}
});

function download(content,name,mime='text/plain;charset=utf-8') {
  const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function fileStem(){return (project.code||'riverbank').replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,90)||'riverbank';}

function doExport(kind) {
  try {
    const validation=validateProject(project);if(!validation.valid)throw new Error(validation.errors.join(' · '));
    const base=fileStem(),station=formatStation(project.selectedStation).replace('+','-');
    switch(kind){
      case 'json': download(projectJSON(project),`${base}.json`,'application/json');break;
      case 'svg': download(sectionSVG(project,project.selectedStation),`${base}_STA_${station}.svg`,'image/svg+xml');break;
      case 'dxf': download(sectionDXF(project,project.selectedStation),`${base}_STA_${station}.dxf`,'application/dxf');break;
      case 'quantity':download(quantityCSV(project),`${base}_quantity_draft.csv`,'text/csv;charset=utf-8');break;
      case 'survey':download(surveyCSV(project),`${base}_survey.csv`,'text/csv;charset=utf-8');break;
      case 'piles':download(pileCSV(project),`${base}_pile_coordinates.csv`,'text/csv;charset=utf-8');break;
      case 'analysis':download(analysisCSV(project),`${base}_analysis_register.csv`,'text/csv;charset=utf-8');break;
      case 'obj':download(sceneOBJ(project),`${base}_concept.obj`,'text/plain;charset=utf-8');break;
      case 'print': renderReport();window.print();return;
    }
    showNotice('เตรียมไฟล์ดาวน์โหลดแล้ว · แบบและปริมาณมีสถานะร่างตามขอบเขตแนวคิด');
  }catch(error){showNotice(error.message,true);}
}

function downloadTemplate(kind) {
  const L=lengthOf(project.alignment),mid=L/2,end=L;
  if(kind==='alignment')download('x,y\n500000,1500000\n500050,1500000\n500100,1500010\n','alignment_example.csv','text/csv');
  if(kind==='survey'){
    const rows=['station,offset,elevation'];
    for(const s of [0,mid,end])for(const [o,z]of [[-20,92],[-10,95],[0,99],[10,100]])rows.push(`${s},${o},${z}`);
    download(rows.join('\n')+'\n','survey_example.csv','text/csv');
  }
  if(kind==='soil')download(`borehole,station,from_station,to_station,bottom,name,unit_weight,phi,cohesion,source\nBH-01,${mid},0,${end},94,Sand example,18,30,0,DEMO - replace with borehole report\nBH-01,${mid},0,${end},85,Clay example,19,22,10,DEMO - replace with borehole report\n`,'soil_example.csv','text/csv');
  if(kind==='analysis')download('station,case,fs,reference\n','analysis_template.csv','text/csv');
  if(kind==='dxf')download('0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nALIGNMENT\n90\n3\n70\n0\n10\n500000\n20\n1500000\n10\n500050\n20\n1500000\n10\n500100\n20\n1500010\n0\nENDSEC\n0\nEOF\n','alignment_example.dxf','application/dxf');
}

function renderReport() {
  const p=project,qr=quantityRows(p),ar=analysisRows(p),validation=validateProject(p),rev=projectRevision(p);
  $('#print-report').innerHTML=`
    <div class="report-meta"><div><h1>${esc(p.name)}</h1><span>${esc(p.code)} · ${esc(p.geometry.type)} · ยาว ${number(lengthOf(p.alignment))} ม.</span></div><div>RIVERBANK STUDIO<br>รุ่นข้อมูล ${esc(rev)}<br>${new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date())}</div></div>
    <div class="draft-mark">ร่างแนวคิด · ยังไม่ใช่แบบก่อสร้างหรือ ปร.4 ฉบับสมบูรณ์ · ผลเสถียรภาพเป็นข้อมูลจากภายนอกที่ผู้ใช้บันทึก</div>
    <h2>รูปตัด STA ${formatStation(p.selectedStation)}</h2>${sectionSVG(p,p.selectedStation)}
    <p>ที่มาแนว: ${esc(p.sources?.alignment?.name)} · ที่มารูปตัด: ${esc(p.sources?.survey?.name)}</p>
    <p>ระดับน้ำสูงสุด ${number(p.water.high)} · ต่ำสุด ${number(p.water.low)} · ขณะสำรวจ ${number(p.water.survey)} · น้ำใต้ดิน ${number(p.water.ground)} ม.</p>
    <p>${esc(p.notes)}</p>
    <div class="page-break"></div><h2>ปริมาณในขอบเขตแนวคิด</h2>
    <table><thead><tr><th>รายการ</th><th>ปริมาณ</th><th>หน่วย</th><th>สูตรและสมมุติฐาน</th><th>วัสดุ/หน่วย</th><th>แรง/หน่วย</th><th>รวม บาท</th><th>แหล่งราคา</th></tr></thead><tbody>${qr.map(r=>`<tr><td>${esc(r.code)}<br>${esc(r.name)}</td><td class="numeric">${number(r.quantity,3)}</td><td>${esc(r.unit)}</td><td>${esc(r.formula)}<br>${esc(r.assumption)}</td><td>${r.materialRate==null?'ยังไม่ระบุ':number(r.materialRate)}</td><td>${r.labourRate==null?'ยังไม่ระบุ':number(r.labourRate)}</td><td>${r.amount==null?'ยังไม่ระบุ':number(r.amount)}</td><td>${esc(r.priceSource)}</td></tr>`).join('')}</tbody></table>
    <p class="report-note">ไม่รวมเหล็กเสริม งานขุด/ถม และองค์ประกอบที่ไม่อยู่ในแบบจำลองแนวคิด · ไม่มี Factor F หรือภาษี</p>
    <h2>ทะเบียนผลวิเคราะห์ภายนอก</h2><table><thead><tr><th>STA</th><th>กรณี</th><th>FS</th><th>สถานะรุ่นข้อมูล</th><th>หลักฐานอ้างอิง</th></tr></thead><tbody>${ar.map(r=>`<tr><td>${formatStation(r.station)}</td><td>${esc(r.label||caseNames[r.case])}</td><td>${r.fs==null?'—':number(r.fs,3)}</td><td>${r.status==='current'?'ตรงรุ่นข้อมูล':r.status==='stale'?'ล้าสมัย':'ยังไม่มีผล'}</td><td>${esc(r.reference)}</td></tr>`).join('')}</tbody></table>
    ${validation.warnings.length?`<h2>รายการที่ต้องตรวจสอบ</h2><ul>${validation.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}`;
}

window.addEventListener('hashchange',()=>{const target=location.hash.slice(1);if(steps.includes(target)){step=target;render();}});
window.addEventListener('pagehide',()=>{
  clearTimeout(saveTimer);
  try{localStorage.setItem(storeKey,projectJSON(project));}catch{}
});

render();
try {
  $('#scene').replaceChildren();
  scene=mountScene($('#scene'),project,station=>setStation(station));
} catch(error) {
  $('#scene').innerHTML='<div class="scene-fallback">เครื่องนี้เปิดภาพ 3D ไม่ได้ คุณยังแก้ข้อมูล ดูรูปตัด 2D และส่งออกได้ตามปกติ</div>';
  console.warn('3D viewer unavailable:',error.message);
}

// A deliberately read-only inspection surface helps browser smoke checks verify
// UI round trips without bypassing normal user interactions.
Object.defineProperty(window,'riverbankStudio',{value:Object.freeze({getProject:()=>structuredClone(project),getStep:()=>step}),writable:false});
