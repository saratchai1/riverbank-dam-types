import { DEFAULT_INPUTS, calculateTypical, normalizeSourceRows, auditSourceQuantities } from './engine.js';
import { typicalSectionSVG, scenarioSectionOptions, mountCaseScene } from './visuals.js';
import { SOURCE_FILES, sourceURL, REPORTED_FS, SOIL_SOURCE, CASE_REVIEWS, QUESTIONS, METHOD_SOURCES, AGGREGATE_LABELS } from './case-data.js';
import { mountEngineering } from './engineering-ui.js';
import { PROJECT_MAX_BYTES, createProject, getActiveScenario, stationCatalog, projectRevision, scenarioRevision, isBaselineScenario, updateActiveScenario, selectStation, parseProject, serializeProject } from './project.js';
import { saveWorkingProject, loadWorkingProject, saveReportSnapshot } from './project-storage.js';
import { mountComparison } from './comparison-ui.js';
import { getStationComparison } from './project.js';
import { saveComparisonSnapshot } from './comparison-storage.js';
import { mountReview } from './review-ui.js';
import { saveReviewSnapshot } from './review-storage.js';
import { mountInvestigations } from './investigation-ui.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format = (value, digits=3) => value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US',{maximumFractionDigits:digits});
const unit = value => ({m:'ม.',m2:'ตร.ม.',m3:'ลบ.ม.',degree:'องศา'}[value] || value);
const station = value => Math.floor(value/1000)+'+'+String(value%1000).padStart(3,'0');
let inputs = {...DEFAULT_INPUTS};
let source, audit, normalized, scene, project, catalog, engineeringView, comparisonView, reviewView, investigationView;
const activeScenario = () => getActiveScenario(project);
const fields = [
  ['length','ความยาวขยายรูปตัดทฤษฎี','ม. ไม่ใช่ช่วงสถานี',1000],['crestLevel','ระดับสันเขื่อน','ระดับสมมติ',101],['toeLevel','ระดับตีนเขื่อน','ระดับสมมติ',88],['slopeH','ลาดหน้าหิน','H : 1 V · ใช้ร่วมกับดิน',2.5],['rockThickness','ความหนาหินเรียง','ม. ตั้งฉากลาด',.5],['sandMinThickness','ชั้นทรายขั้นต่ำจำลอง','ม. ตั้งฉากลาด',1],['walkwayWidth','ความกว้างทางเท้า','ม.',2.95],['toeTopWidth','สันตีนหินจำลอง','ม.',1.5],['toeDepth','ความลึกตีนหินจำลอง','ม. ฐานราบสมมติ',2],['toeSlopeH','ลาดข้างตีนหิน','H : 1 V',1.5],
];

function notice(message, error=false) {
  const n=$('#notice');n.textContent=message;n.classList.toggle('error',error);n.hidden=false;
  n.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function download(name, content, type) {
  const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function setPanel(name) {
  if(!document.getElementById('panel-'+name))return;
  for(const button of document.querySelectorAll('#case-tabs [data-panel]')){
    const active=button.dataset.panel===name;if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }
  for(const panel of document.querySelectorAll('.panel'))panel.hidden=panel.id!=='panel-'+name;
  if(name==='overview')requestAnimationFrame(()=>scene?.fit());
  $('#notice').hidden=true;
}
function formFields() {
  $('#geometry-form').innerHTML=fields.map(([key,label,u])=>'<label class="field"><span>'+label+'<small>'+u+'</small></span><input name="'+key+'" type="number" step="any" value="'+inputs[key]+'" aria-label="'+label+'"></label>').join('');
}
function renderModel() {
  const calc=calculateTypical(inputs);
  const sectionOptions=scenarioSectionOptions(activeScenario());
  $('#typical-drawing').innerHTML=typicalSectionSVG(inputs,sectionOptions);
  $('#model-drawing').innerHTML=typicalSectionSVG(inputs,sectionOptions);
  $('#typical-formulas').innerHTML='<table><thead><tr><th>รายการ</th><th>สูตร / การแทนค่า</th><th>ผล</th><th>หน่วย</th></tr></thead><tbody>'+calc.formulaRows.map(r=>'<tr><td>'+escape(r.label)+(r.assumption?'<small>'+escape(r.assumption)+'</small>':'')+'</td><td class="formula">'+escape(r.formula)+'<small>'+escape(r.substitution)+'</small></td><td class="num">'+format(r.value,4)+'</td><td>'+unit(r.unit)+'</td></tr>').join('')+'</tbody></table>';
  const changed=Object.keys(DEFAULT_INPUTS).some(k=>inputs[k]!==DEFAULT_INPUTS[k]);
  $('#geometry-status').textContent=changed?'ปรับมิติแล้ว · ค่าทฤษฎีเปลี่ยน / ข้อมูลต้นฉบับคงเดิม':'ค่าตั้งต้นตามแบบและสมมติฐานของเดโม่';
  $('#active-slope').textContent=format(inputs.slopeH,3);
  $('#active-levels').textContent='สัน '+format(inputs.crestLevel,2)+' ถึงตีน '+format(inputs.toeLevel,2)+' · สถานการณ์ที่เลือก';
  scene?.update(inputs);
}
function applyInputs(next){
  applyProject(updateActiveScenario(project,{geometry:next},source));
}
function persistProject(){
  try{saveWorkingProject(project,source,window.localStorage);$('#persistence-status').textContent='เก็บงานล่าสุดในเบราว์เซอร์แล้ว · บันทึก JSON เพื่อเก็บหรือย้ายเครื่อง';$('#persistence-status').classList.remove('error');}
  catch{$('#persistence-status').textContent='เบราว์เซอร์เก็บงานอัตโนมัติไม่ได้ กรุณาบันทึกโครงการ JSON ก่อนปิดหน้า';$('#persistence-status').classList.add('error');}
}
function renderProjectContext(){
  const scenario=activeScenario(),row=catalog.find(s=>s.id===project.selectedStationId);
  $('#station-select').value=project.selectedStationId;
  $('#station-context').textContent=row.reach+' / STA '+station(row.station)+' · '+row.sourceSheet+' แถว '+row.sourceRow+' · ความยาวรับผิดชอบใน BOQ '+format(row.effectiveLength)+' ม.';
  $('#project-revision').textContent=projectRevision(project);
  $('#scenario-revision').textContent=scenarioRevision(scenario);
  const alternativeCount=getStationComparison(project).alternatives.length;
  $('#alternative-count').textContent=alternativeCount?'สถานีนี้เก็บไว้ '+alternativeCount+' ทางเลือก · แก้ต่อหรือเทียบผลได้':'เก็บ A / B / C เพื่อเทียบกับค่าที่กำลังแก้';
  $('#external-analysis-status').textContent=isBaselineScenario(scenario)?'รูปตัดและค่าทดลองเริ่มต้น · Slope/W เดิมเป็นหลักฐานภายนอก ยังไม่ยืนยันผลของสถานีนี้':'สถานการณ์มีการแก้ไข · ต้องวิเคราะห์เสถียรภาพรวมใหม่ก่อนใช้ผลกับแบบนี้';
  for(const field of $('#context-form').elements){if(field.name&&Object.hasOwn(scenario.context,field.name))field.value=scenario.context[field.name]??'';}
  const missing=[];
  if(!scenario.context.boreholeReference.trim())missing.push('ยังไม่ได้จับคู่หลุมเจาะ');
  if([scenario.context.waterHighLevel,scenario.context.waterLowLevel,scenario.context.groundwaterLevel].some(v=>v===null))missing.push('ระดับน้ำยังไม่ครบ');
  if([scenario.context.waterHighLevel,scenario.context.waterLowLevel,scenario.context.groundwaterLevel].some(v=>v!==null)&&!scenario.context.waterReference.trim())missing.push('ระดับน้ำที่กรอกยังไม่มีแหล่งอ้างอิง');
  $('#context-status').textContent=missing.length?missing.join(' · '):'บันทึกบริบทแล้ว · ข้อมูลที่กรอกยังต้องตรวจยืนยันกับเอกสารและหน้าตัดจริง';
  const index=catalog.findIndex(s=>s.id===project.selectedStationId);
  $('#previous-station').disabled=index===0;$('#next-station').disabled=index===catalog.length-1;
}
function applyProject(next,{persist=true}={}){
  project=next;inputs=activeScenario().geometry;
  formFields();renderModel();renderProjectContext();engineeringView?.render();comparisonView?.render();reviewView?.render();investigationView?.render();renderStations();
  if(persist)persistProject();
}
function saveProject(){
  if(!project){notice('ข้อมูลโครงการยังไม่พร้อม',true);return;}
  download('S6006-project.json',serializeProject(project,source)+'\n','application/json');
  notice('บันทึกโครงการเดียวแล้ว: สถานี มิติ คาน ดิน ระดับน้ำ ที่มา ทางเลือก และฐานอ้างอิงดิน–น้ำที่บันทึกไว้');
}
function changeStation(id){
  applyProject(selectStation(project,id,source));
  $('#notice').hidden=true;
}
function setProjectControlsEnabled(enabled){
  for(const control of document.querySelectorAll('button,input,select,textarea'))control.disabled=!enabled;
  if(enabled){renderProjectContext();comparisonView?.render();reviewView?.render();investigationView?.render();}
}
function navigateReview({stationId,scenarioId,target}){
  try{
    if(!catalog.some(row=>row.id===stationId))throw new Error('ไม่พบสถานีที่ต้องการตรวจ');
    const saved=scenarioId==='current'?null:getStationComparison(project,stationId).alternatives.find(item=>item.id===scenarioId);
    if(scenarioId!=='current'&&!saved)throw new Error('ไม่พบทางเลือกที่ต้องการตรวจ');
    if(project.selectedStationId!==stationId)changeStation(stationId);
    if(saved){
      setPanel('comparison');
      const card=Array.from(document.querySelectorAll('.alternative-card')).find(item=>item.dataset.alternativeId===scenarioId);
      if(card){card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({block:'center',behavior:'smooth'});}
      notice('เปิดทางเลือก “'+saved.name+'” ในหน้าเปรียบเทียบแล้ว · ใช้ “นำมาแก้ต่อ” เมื่อต้องการคัดลอกชุดนี้เป็นค่าที่กำลังแก้');
      return;
    }
    const destinations={beam:['engineering','beam-form'],soil:['engineering','soil-form'],model:['model','geometry-form'],context:['review','context-form'],basis:['basis',null]};
    if(!target||!Object.hasOwn(destinations,target.section))throw new Error('ไม่พบจุดแก้ไขที่รองรับ');
    const [panel,formId]=destinations[target.section];
    setPanel(panel);
    const form=formId?document.getElementById(formId):null;
    if(target.section==='context')form.closest('details').open=true;
    const control=form&&Array.from(form.elements).find(item=>item.name===target.field);
    const destination=control||form||document.getElementById('panel-'+panel);
    if(!control)destination.tabIndex=-1;
    destination.focus({preventScroll:true});destination.scrollIntoView({block:'center',behavior:'smooth'});
  }catch(error){notice('เปิดจุดตรวจไม่ได้: '+error.message,true);}
}
function openReviewReport(selection){
  try{
    const snapshot=saveReviewSnapshot(project,source,window.localStorage,selection);
    window.open(snapshot.url,'_blank','noopener');
    notice('เตรียมทะเบียนตรวจงานตามชุดที่เลือกแล้ว หากแท็บใหม่ไม่เปิด ให้กดลิงก์นี้: ');
    const link=document.createElement('a');link.href=snapshot.url;link.target='_blank';link.rel='noopener';link.textContent='เปิดทะเบียนตรวจงานฉบับนี้ ↗';$('#notice').append(link);
  }catch(error){notice('เปิดทะเบียนตรวจงานไม่ได้: '+error.message,true);}
}
function openComparisonReport(){
  try{
    const snapshot=saveComparisonSnapshot(project,source,window.localStorage);
    window.open(snapshot.url,'_blank','noopener');
    notice('เตรียมรายงานเปรียบเทียบจากค่าที่บันทึกแล้ว หากแท็บใหม่ไม่เปิด ให้กดลิงก์นี้: ');
    const link=document.createElement('a');link.href=snapshot.url;link.target='_blank';link.rel='noopener';link.textContent='เปิดรายงานเปรียบเทียบฉบับนี้ ↗';$('#notice').append(link);
  }catch(error){notice('เปิดรายงานเปรียบเทียบไม่ได้: '+error.message,true);}
}
function renderSummary(){
  const rows=Object.entries(audit.composedTotals).map(([key,r])=>'<tr><td>'+escape(AGGREGATE_LABELS[key]||key)+'</td><td class="num">'+format(r.sourceAdoptedValue,0)+'</td><td class="num">'+format(r.roundedDownKnownValue,0)+'</td><td class="num delta">'+format(r.deltaRoundedKnownToSourceAdopted,0)+'</td><td>'+unit(r.unit)+'</td><td><span class="status '+(r.complete?'':'amber')+'">'+(r.complete?'ข้อมูลตั้งต้นครบ':'ยอดเฉพาะค่าที่ทราบ')+'</span><small>'+(r.complete?'':r.missingCount+' ค่าตั้งต้นว่าง · ')+r.sourceMissingCount+' ผลคูณเดิมว่าง</small></td></tr>');
  rows.push('<tr><td>หินเรียงสุทธิหลังหักบันได</td><td class="num">17,037</td><td class="num">—</td><td class="num">—</td><td>ลบ.ม.</td><td><span class="status amber">รอตรวจข้อมูลหักงานครบ</span><small>เดิม 17,295 − (86 + 172); รายการปรับอื่นมีช่องว่าง</small></td></tr>');
  $('#quantity-summary').innerHTML='<table><thead><tr><th>รายการ</th><th>ยอดเดิม</th><th>คำนวณจากค่าที่ทราบ</th><th>ผลต่าง</th><th>หน่วย</th><th>ความครบถ้วน</th></tr></thead><tbody>'+rows.join('')+'</tbody></table>';
  $('#source-coverage').textContent=normalized.length+' แถว · ผลรวมความยาวช่วง '+format(audit.coverage,0)+' ม. (286 + 714) · ต้นฉบับชีต หาปริมาณวัสดุ';
  $('#measure-select').innerHTML=Object.entries(source.columns).map(([key,col])=>'<option value="'+key+'">'+escape(col.labelTH)+' ('+unit(col.quantityUnit)+')</option>').join('');
  $('#measure-select').value='riprap_facing';renderStations();
}
function statusText(m){
  if(m.value===null)return 'พื้นที่/ความยาวตั้งต้นว่าง';
  if(m.cachedProduct===null)return 'ผลเดิมว่าง · คำนวณได้';
  return Math.abs((m.contribution??0)-m.cachedProduct)<1e-7?'ตรงกัน':'ผลต่างต้องทบทวน';
}
function renderStations(){
  const key=$('#measure-select').value;
  $('#station-table tbody').innerHTML=audit.rows.map(row=>{
    const m=row.measures.find(x=>x.key===key);
    const delta=m.contribution===null||m.cachedProduct===null?null:m.contribution-m.cachedProduct;
    // The audit labels reaches as R1/R2; catalog reach is numeric. Join on source identity.
    const stationId=catalog.find(s=>s.sourceSheet===row.sourceSheet&&s.sourceRow===row.sourceRow)?.id;
    if(!stationId)throw new Error('ไม่พบสถานีอ้างอิงของแถว '+row.sourceRow);
    return '<tr'+(stationId===project.selectedStationId?' class="selected-station"':'')+'><td><button type="button" class="text-button station-link" data-station-id="'+escape(stationId)+'" aria-label="เลือกสถานี '+station(row.station)+' ช่วง '+escape(row.reach)+'">'+row.reach+' / '+station(row.station)+'</button></td><td class="num">'+format(row.effectiveLength)+'</td><td class="num">'+format(m.value,4)+'<small>'+unit(m.inputUnit)+(m.depthMultiplier?' × '+m.depthMultiplier+' ม.':'')+'</small></td><td class="num">'+format(m.cachedProduct,4)+'</td><td class="num">'+format(m.contribution,4)+'</td><td class="num">'+format(delta,4)+'</td><td><code>'+m.valueCell+' × '+row.lengthCell+(m.multiplierCell?' × '+m.multiplierCell:'')+'</code><small>ผลเดิม '+m.productCell+'</small></td><td><span class="status '+(m.value===null||m.cachedProduct===null?'amber':'')+'">'+statusText(m)+'</span></td></tr>';
  }).join('');
}
function renderBasis(){
  $('#basis-content').innerHTML='<div class="section-title"><div><p class="eyebrow">ENGINEERING BASIS</p><h2>จากเอกสารถึงผลที่ตรวจสอบได้</h2><p>แยกหลักฐานต้นฉบับ การคำนวณซ้ำ และขอบเขตแบบจำลองอย่างชัดเจน</p></div><button type="button" class="button primary" data-current-report>รายการคำนวณฉบับเต็ม ↗</button></div>'
    +'<div class="two-col"><article class="card"><h2>ขอบเขตและระดับอ้างอิง</h2><p>เดโม่เลือก BOQ ปัจจุบัน 1,000 ม. จากช่วง 286 + 714 ม. แบบ ST-01 ระบุปลายโครงการ 1+195 ส่วนตารางเก่ามี 222 ม. เพิ่มเป็น 1,222 ม. ต้องยืนยันรุ่นและขอบเขตก่อนใช้งานจริง</p><p>BM1: ระดับจริง 164.060 / สมมติ 100.010 และ BM2: 164.050 / 100.000 ให้ส่วนต่าง 64.050 ม. การแสดงรูปตัดใช้ระดับสมมติในแบบ ไม่แปลงระดับน้ำที่พิมพ์ปัดเศษโดยอัตโนมัติ</p><a href="'+sourceURL('S-DWG')+'" target="_blank" rel="noopener">แบบ ST-01 · PDF หน้า 5 ↗</a></article><article class="card"><h2>อะไรคือสมมติฐานของโมเดล</h2><p>ความหนาหินและทรายวัดตั้งฉากกับลาด ตีนหินใช้รูปคางหมูสมมาตรฐานราบลึก 2 ม. เพื่อคำนวณตัวอย่าง ทั้งที่ตีนจริงเปลี่ยนตามท้องน้ำ ภาพ 3D ใช้ช่วงตรง 100 ม. ไม่มีแนวพิกัดและผิวดินสำรวจที่สร้างขึ้นเอง</p><p>ไม่รวมปริมาตรต่างชนิดเป็นยอดวัสดุรวม และไม่อ้างปริมาณองค์ประกอบทฤษฎีเป็น BOQ สุทธิ</p><a href="'+sourceURL('S-DWG')+'" target="_blank" rel="noopener">แบบ SD-02 · PDF หน้า 36 ↗</a></article></div>'
    +'<article class="card"><div class="card-head"><h2>ผลเสถียรภาพในรายงาน Slope/W เดิม</h2><span class="status amber">ข้อมูลอ้างอิงจากภายนอก</span></div><div class="table-wrap"><table id="reported-fs"><thead><tr><th>กรณีเดิม</th><th>FS ที่รายงาน</th><th>เกณฑ์ในรายงาน</th><th>อ้างอิง</th><th>ขอบเขต</th></tr></thead><tbody>'+REPORTED_FS.map(r=>'<tr><td>'+r.case+'</td><td class="num">'+r.value.toFixed(3)+'</td><td class="num">'+r.criterion.toFixed(1)+'</td><td>PDF หน้า '+r.page+'</td><td>'+r.note+'</td></tr>').join('')+'</tbody></table></div><p class="engineering-note">ยังไม่ได้สร้างแบบจำลอง Slope/W เดิมซ้ำ จึงไม่ใช้ตัวเลขเหล่านี้รับรองมิติที่ผู้ใช้แก้ ค่า FS จากโมดูลลาดอนันต์เป็นคนละกลไกและคนละสมมติฐาน</p></article>'
    +'<article class="card"><h2>พารามิเตอร์ดินในเอกสารเดิม</h2><div class="table-wrap"><table><thead><tr><th>วัสดุ</th><th>γ (kN/m³)</th><th>c ตามหัวตาราง (kPa)</th><th>φ ตามหัวตาราง (°)</th></tr></thead><tbody>'+SOIL_SOURCE.map(r=>'<tr>'+r.map((v,i)=>'<td'+(i?' class="num"':'')+'>'+(v===null?'—':v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><p>แหล่ง: รายการคำนวณ หน้า 16 · เครื่องหมายขีดเก็บเป็นข้อมูลที่ไม่ได้ระบุ ไม่เปลี่ยนเป็นศูนย์โดยอัตโนมัติ ต้องยืนยันว่า c เป็น Su หรือ c′ และใช้กับเงื่อนไขระบายน้ำใดก่อนวิเคราะห์จริง</p></article>'
    +'<article class="card"><h2>ความแข็งแรงที่ต้องตรวจทั้งระบบ</h2><ol class="inline-list"><li>โครงสร้าง: แรงจากลำดับก่อสร้างและสภาพใช้งาน → แรงภายในคาน/เสาเข็ม/จุดต่อ → กำลังดัด เฉือน แรงอัดร่วมดัด บิด และการแตกร้าว/การโก่ง</li><li>ดิน: แบบจำลองหน้าตัดและน้ำ → กำลังเฉือนตามชนิดพารามิเตอร์ → เสถียรภาพรวม การทรุดตัว กำลังรับน้ำหนัก และพฤติกรรมเสาเข็มร่วมกับดิน</li><li>ชลศาสตร์: ความเร็ว/ทิศทางกระแส ระดับน้ำตามเวลา คลื่น และการกัดเซาะ → ขนาดหิน ความหนา ความลึกตีนเขื่อนและระบบกรอง</li></ol><p>เอกสาร S6006 ให้รูปสมการชลศาสตร์ แต่ยังไม่ให้ชุดค่าความเร็วและสัมประสิทธิ์ที่คำนวณขนาดหินเป็นตัวเลขได้ครบ จึงยังไม่สรุปการตรวจขนาดหินหรือความลึกกัดเซาะ</p></article>'
    +'<article class="card"><h2>ทะเบียนแหล่งข้อมูล</h2><ol class="source-list">'+SOURCE_FILES.map(s=>'<li><a href="https://drive.google.com/file/d/'+s.id+'/view" target="_blank" rel="noopener">'+s.key+' · '+s.title+' ↗</a><small>'+s.location+'</small><small>'+s.use+'</small></li>').join('')+'</ol><h3>ฐานสมการและวิธีคิด</h3><ul class="source-list">'+METHOD_SOURCES.map(s=>'<li><a href="'+s.url+'" target="_blank" rel="noopener">'+s.title+' ↗</a><small>'+s.location+' · '+s.use+'</small></li>').join('')+'</ul></article>';
}
function renderKnowledge(){
  $('#knowledge-content').innerHTML='<div class="section-title"><div><p class="eyebrow">KNOWLEDGE FROM SIX DRAWING SETS</p><h2>สิ่งที่เรียนรู้จากชุดแบบที่อัปโหลด</h2><p>ตรวจทะเบียนไฟล์ครบ 6 หมวด และอ่านแบบ PDF รายการคำนวณ BOQ และไฟล์แบบจำลองที่เกี่ยวข้องตามขอบเขตที่บันทึก</p></div></div><div class="knowledge-grid">'+CASE_REVIEWS.map(c=>'<article class="card"><span class="case-code">'+c.code+'</span><h3>'+c.type+'</h3><p class="muted">'+c.place+'<br>'+c.scope+'</p><p>'+c.system+'</p><div class="callout subtle">'+c.finding+'</div><p><b>บทเรียนสำหรับแอป</b><br>'+c.lesson+'</p>'+(c.id?'<a target="_blank" rel="noopener" href="https://drive.google.com/file/d/'+c.id+'/view">'+c.page+' ↗</a>':'<small>'+c.page+' · ดูทะเบียนในรายงาน</small>')+'</article>').join('')+'</div><article class="card"><h2>คำถามที่ใช้คุยกับวิศวกร</h2>'+QUESTIONS.map(([q,a],i)=>'<details class="question"'+(i===0?' open':'')+'><summary>'+q+'</summary><p>'+a+'</p></details>').join('')+'</article><div class="callout">รีวิวนี้ไม่ได้เปิดทุก entity ใน DWG หรือรัน native model ของทุกโครงการ ภาคผนวกระบุไฟล์ที่อ่านและสิ่งที่ยังไม่ยืนยัน เพื่อให้ทบทวนต่อได้ตรงจุด</div>';
}
function csvCell(value){
  if(value===null||value===undefined)return '""';
  let text=String(value);if(typeof value==='string'&&/^[=+@\-]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
function exportQuantities(){
  const header=['project','source_scope_m','reach','station_m','sheet','source_row','component','input_value','input_unit','input_cell','effective_length_m','length_cell','depth_multiplier_m','multiplier_cell','source_cached_product','source_product_cell','computed_product','quantity_unit','input_status'];
  const rows=[header];
  for(const row of audit.rows)for(const m of row.measures)rows.push(['S6006',audit.coverage,row.reach,row.station,row.sourceSheet,row.sourceRow,m.key,m.value,m.inputUnit,m.valueCell,row.effectiveLength,row.lengthCell,m.depthMultiplier??null,m.multiplierCell??null,m.cachedProduct,m.productCell,m.contribution,m.unit,statusText(m)]);
  download('S6006-station-quantity-audit.csv','\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
}
document.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>setPanel(b.dataset.panel)));
document.querySelectorAll('[data-open-panel]').forEach(b=>b.addEventListener('click',()=>setPanel(b.dataset.openPanel)));
$('#geometry-form').addEventListener('submit',event=>event.preventDefault());
$('#geometry-form').addEventListener('change',event=>{
  const key=event.target.name;if(!Object.hasOwn(DEFAULT_INPUTS,key))return;
  const text=event.target.value;
  try{if(text.trim()==='')throw new Error('กรุณาระบุมิติ ไม่ใช้ช่องว่างแทนศูนย์');applyInputs({...inputs,[key]:Number(text)});$('#notice').hidden=true;}
  catch(error){event.target.value=inputs[key];notice(error.message,true);}
});
$('#reset-model').addEventListener('click',()=>{applyInputs({...DEFAULT_INPUTS});notice('คืนค่าหน้าตัดตามแบบและสมมติฐานตั้งต้นแล้ว');});
$('#measure-select').addEventListener('change',renderStations);
$('#save-case').addEventListener('click',saveProject);
$('#load-case').addEventListener('click',()=>$('#case-file').click());
$('#case-file').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try{
    if(file.size>PROJECT_MAX_BYTES)throw new Error('ไฟล์โครงการมีขนาดเกิน 1 MiB');
    const parsed=parseProject(await file.text(),source);
    applyProject(parsed.project);notice('เปิดโครงการครบจากไฟล์แล้ว · '+(parsed.notices.length?parsed.notices.join(' '):'มิติ คาน ดิน น้ำ และสถานีตรงกับข้อมูลที่บันทึก'));
  }catch(error){notice('เปิดไฟล์ไม่ได้: '+error.message,true);}
});
$('#export-quantity').addEventListener('click',exportQuantities);
$('#export-section').addEventListener('click',()=>download('S6006-'+project.selectedStationId+'-section.svg',typicalSectionSVG(inputs,scenarioSectionOptions(activeScenario())),'image/svg+xml'));
$('#station-select').addEventListener('change',event=>changeStation(event.target.value));
for(const [id,delta] of [['previous-station',-1],['next-station',1]])$('#'+id).addEventListener('click',()=>{const index=catalog.findIndex(s=>s.id===project.selectedStationId);if(catalog[index+delta])changeStation(catalog[index+delta].id);});
$('#station-table').addEventListener('click',event=>{const button=event.target.closest('[data-station-id]');if(button)changeStation(button.dataset.stationId);});
$('#context-form').addEventListener('submit',event=>event.preventDefault());
$('#context-form').addEventListener('change',event=>{
  const key=event.target.name,context=activeScenario().context;if(!Object.hasOwn(context,key))return;
  const raw=event.target.value,value=event.target.type==='number'?(raw.trim()===''?null:Number(raw)):raw;
  try{applyProject(updateActiveScenario(project,{context:{[key]:value}},source));$('#notice').hidden=true;}
  catch(error){event.target.value=context[key]??'';notice('บันทึกบริบทไม่ได้: '+error.message,true);}
});
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-current-report]');if(!button)return;
  try{
    // Explicit action buttons cannot open an unprepared baseline via middle-click.
    const snapshot=saveReportSnapshot(project,source,window.localStorage);
    window.open(snapshot.url,'_blank','noopener');
    notice('เตรียมรายงานจากรุ่น '+snapshot.revision+' แล้ว หากแท็บใหม่ไม่เปิด ให้กดลิงก์นี้: ');
    const link=document.createElement('a');link.href=snapshot.url;link.target='_blank';link.rel='noopener';link.textContent='เปิดรายงานของรุ่นนี้ ↗';$('#notice').append(link);
  }catch(error){event.preventDefault();notice('เปิดรายงานไม่ได้: '+error.message+' กรุณาบันทึกโครงการ JSON ไว้ก่อน',true);}
});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{scene?.setView(b.dataset.view);document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('selected',x===b));}));
$('#fit-scene').addEventListener('click',()=>scene?.fit());
setProjectControlsEnabled(false);
try{
  const response=await fetch('source-data.json');if(!response.ok)throw new Error('โหลดชุดข้อมูลไม่สำเร็จ');source=await response.json();
  normalized=normalizeSourceRows(source);audit=auditSourceQuantities(source);if(audit.errors.length)throw new Error(audit.errors.join('; '));
  catalog=stationCatalog(source);project=createProject(source);
  $('#station-select').innerHTML=catalog.map(row=>'<option value="'+row.id+'">'+row.reach+' · STA '+station(row.station)+'</option>').join('');
  let restored=false,restoreError='';
  try{const saved=loadWorkingProject(source,window.localStorage);if(saved){project=saved.project;restored=true;}}
  catch(error){restoreError=error.message;}
  inputs=activeScenario().geometry;
  renderSummary();renderBasis();renderKnowledge();
  engineeringView=mountEngineering($('#engineering-content'),{
    getScenario:activeScenario,getRevision:()=>scenarioRevision(activeScenario()),
    onChange:(section,patch)=>applyProject(updateActiveScenario(project,{[section]:patch},source)),onSave:saveProject,
  });
  comparisonView=mountComparison($('#comparison-content'),{
    getProject:()=>project,getSource:()=>source,onProjectChange:applyProject,
    onNotice:notice,onDownload:download,onReport:openComparisonReport,
    onEdit:name=>{setPanel(name);$('#panel-'+name).scrollIntoView({block:'start',behavior:'smooth'});},
  });
  reviewView=mountReview($('#review-content'),{
    getProject:()=>project,getSource:()=>source,onNotice:notice,onDownload:download,
    onNavigate:navigateReview,onReport:openReviewReport,
  });
  investigationView=mountInvestigations($('#investigation-content'),{
    getProject:()=>project,getSource:()=>source,onProjectChange:applyProject,
    onNotice:notice,onDownload:download,
    onNavigate:({stationId,scenarioId,section,field})=>navigateReview({stationId,scenarioId,target:{section,field}}),
  });
  applyProject(project,{persist:false});
  if(restoreError){notice('เปิดงานล่าสุดในเบราว์เซอร์ไม่ได้: '+restoreError+' ขณะนี้แสดงชุดเริ่มต้น กรุณาเปิดไฟล์โครงการที่บันทึกไว้',true);$('#persistence-status').textContent='งานล่าสุดยังไม่ได้โหลด · โปรดเปิดไฟล์โครงการ JSON';}
  else if(restored){notice('กลับมาที่โครงการและสถานีที่แก้ล่าสุดแล้ว');$('#persistence-status').textContent='เปิดงานล่าสุดจากเบราว์เซอร์แล้ว · บันทึก JSON เพื่อเก็บหรือย้ายเครื่อง';}
  else $('#persistence-status').textContent='โครงการเริ่มต้น · การแก้ไขจะเก็บในเบราว์เซอร์ และบันทึกทุกสถานีเป็น JSON ไฟล์เดียวได้';
  setProjectControlsEnabled(false);
  scene=mountCaseScene($('#case-scene'),inputs);await scene.ready;
  setProjectControlsEnabled(true);
  document.body.dataset.ready='true';
}catch(error){setProjectControlsEnabled(false);notice('ไม่สามารถเปิดโครงการได้ครบ: '+error.message,true);document.body.dataset.ready='error';}
