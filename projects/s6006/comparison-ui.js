import {
  getStationComparison, saveAlternative, removeAlternative,
  setComparisonReference, applyAlternative,
} from './project.js';
import { buildComparison, comparisonCSV, COMPARISON_GROUPS } from './comparison.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = value => Number(value).toLocaleString('en-US', {maximumFractionDigits:4});
const signed = value => (value > 0 ? '+' : '') + number(value);
const display = (value,rowId) => {
  if(value===null||value===undefined||value==='')return '—';
  if(typeof value==='number')return number(value);
  if(rowId==='input.soilInputs.mode'){
    if(value==='effective')return 'Effective stress · c′ / φ′';
    if(value==='undrained')return 'Total stress · Su';
  }
  return String(value);
};
const availabilityLabels = {computed:'คำนวณได้',gated:'ยังใช้ตรวจไม่ได้',missing:'ข้อมูลยังไม่ครบ','not-applicable':'คนละกรณี / ไม่ใช้'};
const statusLabels = {satisfied:'ผ่านเงื่อนไขย่อย',review:'ต้องทบทวน',illustrative:'ผลแบบจำลองย่อย',missing:'ข้อมูลยังไม่ครบ'};
const timestamp = value => value ? new Intl.DateTimeFormat('th-TH', {dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value)) : 'เปลี่ยนตามค่าที่กำลังแก้';

/** Presentation only: the adapter owns every result, gate and numeric delta. */
export function comparisonTableHTML(record, rows) {
  return '<div class="table-wrap comparison-scroll" tabindex="0" role="region" aria-label="ตารางเปรียบเทียบ เลื่อนแนวนอนเพื่อดูทุกทางเลือก"><table class="comparison-table"><thead><tr><th scope="col">รายการ / หน่วย</th>'
    + record.entries.map(entry => '<th scope="col" data-entry-id="'+escape(entry.id)+'" class="'+(entry.id===record.metadata.referenceId?'reference-column':'')+'"><span class="comparison-column-tag">'+(entry.id===record.metadata.referenceId?'ฐานเปรียบเทียบ':entry.kind==='current'?'ค่าปัจจุบัน':'ทางเลือกที่เก็บ')+'</span>'+escape(entry.name)+'</th>').join('')
    + '</tr></thead><tbody>'+rows.map(row => '<tr data-comparison-row="'+escape(row.id)+'"><th scope="row">'+escape(row.label)+'<small>'+escape(row.unit || 'ไม่มีหน่วย')+'</small>'+(row.reason?'<span class="comparison-row-note">'+escape(row.reason)+'</span>':'')+'</th>'
      + record.entries.map(entry => {
        const cell=row.cells[entry.id], available=cell.availability==='computed';
        const label=available?(statusLabels[cell.status] || ''):availabilityLabels[cell.availability];
        const delta=typeof cell.delta==='number' ? '<span class="comparison-delta">Δ '+signed(cell.delta)+(typeof cell.deltaPercent==='number'?' ('+signed(cell.deltaPercent)+'%)':'')+'</span>' : '';
        return '<td data-entry-id="'+escape(entry.id)+'" data-availability="'+escape(cell.availability)+'" data-value="'+escape(cell.value)+'" class="'+(entry.id===record.metadata.referenceId?'reference-column':'')+'"><strong class="comparison-value">'+escape(display(cell.value,row.id))+'</strong>'+(label?'<small class="comparison-status '+(available?'':'incomplete')+'">'+escape(label)+'</small>':'')+delta+(cell.reason?'<details class="comparison-reason"><summary>คำอธิบายค่า</summary><p>'+escape(cell.reason)+'</p></details>':'')+'</td>';
      }).join('')+'</tr>').join('')+'</tbody></table></div>';
}

export function mountComparison(container, options) {
  const {getProject,getSource,onProjectChange,onNotice,onDownload,onReport,onEdit} = options;
  let draftName='', pendingRemoveId=null, previousStation=null;
  const openGroups=new Set();

  function render() {
    const project=getProject(),record=buildComparison(project,getSource());
    const saved=getStationComparison(project);
    if(previousStation!==project.selectedStationId){draftName='';pendingRemoveId=null;openGroups.clear();previousStation=project.selectedStationId;}
    const count=saved.alternatives.length,ready=count>0;
    const nextLabel=['A','B','C'][count] || '';
    container.dataset.stationId=project.selectedStationId;
    container.dataset.referenceId=saved.referenceId || '';
    container.dataset.projectRevision=record.metadata.projectRevision;
    container.innerHTML='<article class="comparison-intro"><div><p class="eyebrow">DESIGN OPTIONS / SAME STATION</p><h2>เก็บทางเลือก แล้วดูผลต่าง</h2><p>บันทึกค่าที่ต้องการเก็บเป็น A / B / C จากนั้นแก้หน้าตัด คาน หรือดินต่อได้ แต่ละทางเลือกเก็บข้อมูลของสถานีนี้ไว้ครบชุด</p></div><div class="comparison-count"><strong>'+count+'<span> / 3</span></strong><small>ทางเลือกที่เก็บ</small></div></article>'
      +'<form id="alternative-form" class="alternative-capture"><label for="alternative-name">ชื่อทางเลือก<input id="alternative-name" name="alternativeName" type="text" maxlength="48" autocomplete="off" placeholder="'+(ready?'เช่น '+nextLabel+' · เพิ่มเหล็กและปรับลาด':'เช่น A · รูปตัดตั้งต้น')+'" value="'+escape(draftName)+'"'+(count>=3?' disabled':'')+'></label><button id="save-alternative" type="submit" class="button primary"'+(count>=3?' disabled':'')+'>เก็บค่าปัจจุบันเป็นทางเลือก</button><p>'+ (count>=3?'เก็บครบ 3 ทางเลือกแล้ว นำทางเลือกที่ไม่ใช้แล้วออกเพื่อเก็บชุดใหม่':'รูปตัด · คาน · ดิน · น้ำและที่มา จะถูกเก็บพร้อมกัน')+'</p></form>'
      +'<div class="alternative-cards">'+record.entries.map(entry=>alternativeCard(entry,record.metadata.referenceId)).join('')+'</div>'
      +'<div class="comparison-toolbar"><div><strong>'+(ready?'ผลต่างเทียบกับ '+escape(record.entries.find(entry=>entry.id===saved.referenceId)?.name || ''):'เริ่มจากเก็บทางเลือกแรกเป็นฐาน')+'</strong><p>'+(ready?'Δ = ค่าของแต่ละทางเลือก − ฐานที่เลือก · ผลต่างแสดงด้วยเครื่องหมายบวก/ลบ':'เมื่อมีฐานแล้ว ตารางจะแสดงผลต่างของค่าที่กำลังแก้และทางเลือกที่เก็บ')+'</p></div><div class="comparison-export"><button class="button" id="export-comparison"'+(ready?'':' disabled')+'>ตารางเปรียบเทียบ CSV ↓</button><button class="button primary" id="report-comparison"'+(ready?'':' disabled')+'>รายงานเปรียบเทียบ ↗</button></div></div>'
      +'<div class="comparison-scope"><p>ผลดินแต่ละกรณีแสดงแยกกัน กำลังคานแสดงเฉพาะค่าที่ใช้ตรวจได้ตามเงื่อนไข ส่วนปริมาณวัสดุเป็นองค์ประกอบทฤษฎีตามความยาวที่ระบุ</p><p>เลือกทางเลือกจากข้อมูลและขอบเขตที่ครบถ้วน ตารางนี้ยังไม่จัดอันดับหรือรับรองแบบทั้งระบบ</p></div>'
      +COMPARISON_GROUPS.filter(group=>!group.id.startsWith('inputs-')).map(group=>'<article class="card comparison-group" data-comparison-group="'+escape(group.id)+'"><div class="card-head"><h3>'+escape(group.label)+'</h3></div>'+comparisonTableHTML(record,record.rows.filter(row=>row.group===group.id))+'</article>').join('')
      +'<details class="card comparison-inputs" data-comparison-details="changes"'+(openGroups.has('changes')?' open':'')+'><summary>ค่าตั้งต้นที่ต่างกัน <span>'+record.changedInputs.length+' รายการ</span></summary><p>อ่านค่าที่เปลี่ยนพร้อมผลคำนวณ เพื่อแยกผลจากมิติ วัสดุ แรงออกแบบ และสมมติฐานดิน</p>'+changedInputTables(record)+'</details>'
      +'<details class="card comparison-inputs" data-comparison-details="all"'+(openGroups.has('all')?' open':'')+'><summary>ค่าตั้งต้นครบทุกทางเลือก</summary><p>ช่องว่างคงเป็นข้อมูลที่ยังไม่ทราบ ค่าอ้างอิงหลุมเจาะและระดับน้ำเป็นบริบทที่ผู้ใช้กรอก</p>'+COMPARISON_GROUPS.filter(group=>group.id.startsWith('inputs-')).map(group=>'<h3>'+escape(group.label)+'</h3>'+comparisonTableHTML(record,record.rows.filter(row=>row.group===group.id))).join('')+'</details>'
      +'<details class="card comparison-inputs" data-comparison-details="scope"'+(openGroups.has('scope')?' open':'')+'><summary>วิธีอ่านผลและขอบเขตการเปรียบเทียบ</summary><ul>'+record.notices.map(text=>'<li>'+escape(text)+'</li>').join('')+'</ul><p>รายละเอียดสมการ การแทนค่า และต้นฉบับ ดูได้ที่ “04 โครงสร้างและดิน” และ “05 ที่มาวิศวกรรม” หากต้องการรายการคำนวณเต็มของทางเลือกที่เก็บ ให้กด “นำมาแก้ต่อ” แล้วเปิด “รายงานค่าปัจจุบัน”</p></details>';
    for(const details of container.querySelectorAll('[data-comparison-details]'))details.addEventListener('toggle',()=>{
      if(details.open)openGroups.add(details.dataset.comparisonDetails);else openGroups.delete(details.dataset.comparisonDetails);
    });
  }

  function alternativeCard(entry,referenceId){
    const current=entry.kind==='current',reference=entry.id===referenceId;
    const s=entry.scenario;
    return '<article class="alternative-card '+(current?'current':reference?'reference':'')+'" data-alternative-id="'+escape(entry.id)+'"><span class="alternative-marker">'+(current?'WORKING':reference?'REFERENCE':'SAVED OPTION')+'</span><h3>'+escape(entry.name)+'</h3><p class="alternative-dimensions">ลาด '+number(s.geometry.slopeH)+'H:1V · L '+number(s.geometry.length)+' ม.<br>คาน '+number(s.beamInputs.widthMm)+' × '+number(s.beamInputs.heightMm)+' mm · '+number(s.beamInputs.tensionBarCount)+'Ø'+number(s.beamInputs.tensionBarDiameterMm)+' ต่อด้าน</p><small>'+escape(timestamp(entry.createdAt))+'</small><code>'+escape(entry.revision)+'</code>'
      +(current?'<div class="alternative-actions"><button type="button" class="button" data-comparison-edit="model">แก้หน้าตัด</button><button type="button" class="button" data-comparison-edit="engineering">แก้คานและดิน</button></div>':pendingRemoveId===entry.id?'<div class="alternative-remove-confirm" role="group" aria-label="ยืนยันนำทางเลือกออก"><p>นำ “'+escape(entry.name)+'” ออกจากโครงการนี้?</p><button type="button" class="button" data-confirm-remove="'+escape(entry.id)+'">ยืนยันนำออก</button><button type="button" class="text-button" data-cancel-remove>เก็บไว้</button></div>':'<div class="alternative-actions"><button type="button" class="button" data-apply-alternative="'+escape(entry.id)+'">นำมาแก้ต่อ</button><button type="button" class="button" data-reference-alternative="'+escape(entry.id)+'"'+(reference?' disabled':'')+'>'+(reference?'เป็นฐานอยู่':'ใช้เป็นฐาน')+'</button><button type="button" class="text-button remove-option" data-remove-alternative="'+escape(entry.id)+'">นำออก</button></div>')+'</article>';
  }

  function changedInputTables(record){
    const rows=record.rows.filter(row=>row.isInput&&new Set(record.entries.map(entry=>JSON.stringify(row.cells[entry.id].value))).size>1);
    return rows.length?comparisonTableHTML(record,rows):'<p class="comparison-empty">ค่าตั้งต้นทุกชุดยังเหมือนกัน</p>';
  }

  function change(action,success){
    try{onProjectChange(action(getProject(),getSource()));onNotice(success);}
    catch(error){onNotice(error.message,true);}
  }
  container.addEventListener('input',event=>{if(event.target.id==='alternative-name')draftName=event.target.value;});
  container.addEventListener('submit',event=>{
    if(event.target.id!=='alternative-form')return;
    event.preventDefault();
    const name=draftName.trim();
    if(!name){onNotice('กรุณาตั้งชื่อทางเลือกก่อนเก็บข้อมูล',true);container.querySelector('#alternative-name').focus();return;}
    try{const next=saveAlternative(getProject(),name,getSource());draftName='';pendingRemoveId=null;onProjectChange(next);onNotice('เก็บทางเลือก “'+name+'” แล้ว · แก้ค่าปัจจุบันต่อได้โดยทางเลือกที่เก็บยังคงเดิม');}
    catch(error){onNotice(error.message,true);}
  });
  container.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.comparisonEdit){onEdit(button.dataset.comparisonEdit);return;}
    if(button.dataset.referenceAlternative){change((p,s)=>setComparisonReference(p,button.dataset.referenceAlternative,s),'เปลี่ยนฐานเปรียบเทียบแล้ว · ค่าที่กำลังแก้ยังคงเดิม');return;}
    if(button.dataset.applyAlternative){change((p,s)=>applyAlternative(p,button.dataset.applyAlternative,s),'นำค่าจากทางเลือกมาแก้ต่อแล้ว · ตารางคำนวณใหม่จากค่าชุดนี้');return;}
    if(button.dataset.removeAlternative){pendingRemoveId=button.dataset.removeAlternative;render();return;}
    if(button.hasAttribute('data-cancel-remove')){pendingRemoveId=null;render();return;}
    if(button.dataset.confirmRemove){const id=button.dataset.confirmRemove;pendingRemoveId=null;change((p,s)=>removeAlternative(p,id,s),'นำทางเลือกออกจากโครงการแล้ว · ค่าที่กำลังแก้ยังคงเดิม');return;}
    if(button.id==='export-comparison'){
      try{const record=buildComparison(getProject(),getSource());onDownload('S6006-'+getProject().selectedStationId+'-comparison.csv',comparisonCSV(record),'text/csv;charset=utf-8');onNotice('ส่งออกผลเทียบและค่าตั้งต้นแล้ว · มีสถานะ หน่วย และรุ่นข้อมูลกำกับ');}
      catch(error){onNotice(error.message,true);}return;
    }
    if(button.id==='report-comparison')onReport();
  });
  render();
  return {render};
}
