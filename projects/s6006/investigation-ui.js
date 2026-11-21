import { getStationComparison } from './project.js';
import {
  DEFAULT_SOIL_INVESTIGATION_METADATA, DEFAULT_WATER_INVESTIGATION_METADATA,
  INVESTIGATION_METADATA_FIELDS, INVESTIGATION_VALUE_FIELDS,
  getStationInvestigations, saveInvestigationMetadata, captureInvestigation,
  removeInvestigation, buildInvestigationReview, investigationCSV,
} from './investigations.js';
import { BOREHOLE_CATALOG, getBoreholeSource, INVESTIGATION_SOURCE_NOTES } from './investigation-sources.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy = value => JSON.parse(JSON.stringify(value));
const kinds = ['soil','water'];
const titles = {soil:'ฐานข้อมูลดิน',water:'ฐานข้อมูลน้ำ'};
const defaults = {soil:DEFAULT_SOIL_INVESTIGATION_METADATA,water:DEFAULT_WATER_INVESTIGATION_METADATA};
const states = {missing:'ยังไม่มีบันทึก',incomplete:'ข้อมูลยังไม่ครบ',current:'ตรงกับค่าที่ผูกไว้',stale:'มีค่าเปลี่ยน ต้องทบทวน'};
const stateDescriptions = {
  missing:'ยังไม่มีบันทึกฐานอ้างอิงของหมวดนี้ กรอกข้อมูลที่มีและเก็บช่องที่ยังไม่ทราบเป็นช่องว่าง',
  incomplete:'ยังขาดข้อมูลหรือยังไม่ได้ผูกบันทึกกับค่าปัจจุบัน อ่านรายการที่ขาดก่อนผูกข้อมูล',
  current:'ข้อมูลอ้างอิงและค่าที่เกี่ยวข้องยังตรงกับตอนผูกบันทึก สถานะนี้ไม่ได้ยืนยันความถูกต้องของเอกสารหรือรับรองการออกแบบ',
  stale:'ข้อมูลอ้างอิงหรือค่าที่เกี่ยวข้องเปลี่ยนจากตอนผูกบันทึก ต้องทบทวนผลที่อาศัยฐานข้อมูลเดิม',
};
const format = value => {
  if(value === null || value === undefined || value === '') return '—';
  if(typeof value !== 'number') return String(value);
  if(!Number.isFinite(value)) return 'ค่านอกขอบเขต';
  if(value !== 0 && (Math.abs(value) < .0001 || Math.abs(value) >= 1e9)) return value.toExponential(6);
  return value.toLocaleString('en-US',{maximumFractionDigits:6});
};
const draftValues = metadata => Object.fromEntries(Object.entries(metadata).map(([key,value])=>[key,value === null ? '' : String(value)]));
const identity = value => JSON.stringify(Object.keys(value).sort().map(key=>[key,value[key]]));
const stationLabel = station => 'R'+station.reach+' · STA '+Math.floor(station.station/1000)+'+'+String(station.station%1000).padStart(3,'0');
const timestamp = value => value ? new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value))+' (กรุงเทพฯ)' : 'ยังไม่ได้ผูกกับค่าชุดใด';

/** Local form drafts survive unrelated project renders and station inspection. */
export function createInvestigationDraftStore() {
  const entries = new Map();
  function get(key, metadata) {
    const latest = draftValues(metadata), base = identity(latest);
    let item = entries.get(key);
    if(!item || identity(item.values) === item.base) {
      item = {values:latest,base};
      entries.set(key,item);
    }
    return {values:copy(item.values),dirty:identity(item.values)!==item.base,conflict:item.base!==base};
  }
  return {
    get,
    set(key,field,value,metadata) {
      get(key,metadata);
      const item = entries.get(key);
      if(!Object.hasOwn(item.values,field)) throw new TypeError('ไม่รู้จักช่องข้อมูลอ้างอิง');
      item.values[field] = String(value);
      return get(key,metadata);
    },
    rebase(key,metadata) {
      get(key,metadata);
      entries.get(key).base = identity(draftValues(metadata));
      return get(key,metadata);
    },
    discard(key) { entries.delete(key); },
    dirtyKeys() { return [...entries.entries()].filter(([,item])=>identity(item.values)!==item.base).map(([key])=>key); },
  };
}

function displayValue(value,field) {
  if(field === 'soilInputs.mode') {
    if(value === 'effective') return 'Effective stress · c′ / φ′';
    if(value === 'undrained') return 'Total stress · Su';
  }
  return format(value);
}

function valueHTML(value,field) {
  const text = displayValue(value,field);
  return text.length > 180 ? '<details class="investigation-long"><summary>อ่านข้อความ '+text.length+' ตัวอักษร</summary><p>'+escape(text)+'</p></details>' : '<span class="investigation-value">'+escape(text)+'</span>';
}

export function investigationStateHTML(group) {
  const state = Object.hasOwn(states,group.state) ? group.state : 'incomplete';
  const missing = [...group.missingMetadata,...group.missingInputs];
  return '<div class="investigation-state" data-investigation-state="'+escape(state)+'"><span class="investigation-status">'+escape(states[state])+'</span><p>'+escape(stateDescriptions[state])+'</p>'
    +'<p class="investigation-recorded-time">ผูกข้อมูลล่าสุด: '+escape(timestamp(group.binding?.recordedAt))+'</p>'
    +(missing.length ? '<details class="investigation-missing" open><summary>ข้อมูลที่ต้องเติมหรือทบทวน '+missing.length+' รายการ</summary><ul>'+missing.map(item=>'<li><strong>'+escape(item.label)+'</strong> — '+escape(item.reason)+'</li>').join('')+'</ul></details>' : '')+'</div>';
}

export function investigationChangesHTML(group) {
  return [['inputChanges','ค่าที่เกี่ยวข้องเปลี่ยน'],['metadataChanges','ข้อมูลอ้างอิงเปลี่ยน']].map(([key,title])=>{
    const rows = group[key];
    if(!rows.length) return '';
    return '<section class="investigation-changes" data-investigation-changes="'+key+'"><h4>'+title+' · '+rows.length+' รายการ</h4><div class="investigation-change-list">'+rows.map(row=>'<article data-investigation-changed-field="'+escape(row.field)+'"><h5>'+escape(row.label)+(row.unit?' <small>'+escape(row.unit)+'</small>':'')+'</h5><div><span>ตอนผูกบันทึก</span>'+valueHTML(row.captured,row.field)+'</div><div><span>ปัจจุบัน</span>'+valueHTML(row.current,row.field)+'</div></article>').join('')+'</div></section>';
  }).join('');
}

function metadataFieldsHTML(kind,metadata,{readOnly=false}={}) {
  if(readOnly) return '<dl class="investigation-readonly">'+INVESTIGATION_METADATA_FIELDS[kind].map(item=>'<div><dt>'+escape(item.label)+(item.unit?' <small>'+escape(item.unit)+'</small>':'')+'</dt><dd>'+valueHTML(metadata[item.field],item.field)+'</dd></div>').join('')+'</dl>';
  const areas = new Set(['parameterInterpretation','applicabilityNote','notes']);
  return '<div class="investigation-fields">'+INVESTIGATION_METADATA_FIELDS[kind].map(item=>{
    const id='investigation-'+kind+'-'+item.field;
    const text=metadata[item.field]??'';
    const label='<span>'+escape(item.label)+(item.unit?' <small>'+escape(item.unit)+'</small>':'')+(item.required?'<em>จำเป็นก่อนผูกข้อมูล</em>':'<em>ถ้ามีข้อมูล</em>')+'</span>';
    const attrs=' id="'+id+'" name="'+escape(item.field)+'" data-investigation-metadata="'+kind+'"';
    const input=areas.has(item.field)
      ? '<textarea'+attrs+' rows="3" maxlength="'+(item.maxLength||2000)+'">'+escape(text)+'</textarea>'
      : '<input'+attrs+' type="'+(item.type==='number'?'number':'text')+'" value="'+escape(text)+'"'+(item.type==='number'?' step="any" min="'+(item.min??0)+'" max="'+(item.max??10000)+'"':' maxlength="'+(item.maxLength||1000)+'"')+'>';
    return '<label for="'+id+'" class="'+(areas.has(item.field)?'investigation-field-wide':'')+'">'+label+input+'</label>';
  }).join('')+'</div>';
}

export function investigationValuesHTML(group,readOnly=false) {
  return '<details class="investigation-inputs" open><summary>ค่าของชุดที่กำลังตรวจ</summary><dl>'+INVESTIGATION_VALUE_FIELDS[group.id].map(item=>{
    const value=group.currentValues[item.field];
    return '<div data-investigation-value-field="'+escape(item.field)+'"><dt>'+escape(item.label)+(item.unit?' <small>'+escape(item.unit)+'</small>':'')+'</dt><dd>'+valueHTML(value,item.field)+'</dd><dd class="investigation-input-action"><button type="button" class="text-button" data-investigation-navigate="'+escape(item.field)+'">'+(readOnly?'เปิดทางเลือกที่เก็บ →':'ไปที่ช่องข้อมูล →')+'</button></dd></div>';
  }).join('')+'</dl></details>';
}

export function investigationCatalogueHTML(readOnly=false) {
  return '<details class="card investigation-catalogue"><summary>หลุมเจาะในเอกสาร S6006 · '+BOREHOLE_CATALOG.length+' หลุม</summary><div class="investigation-catalogue-body"><p>เลือกได้เฉพาะรหัสและเลขหน้าลงในฉบับร่าง การเลือกไม่ระบุว่าหลุมเจาะนั้นตรงกับสถานีนี้ และไม่เปลี่ยนค่าดินหรือระดับน้ำ</p><div class="investigation-source-grid">'+BOREHOLE_CATALOG.map(item=>'<article data-investigation-borehole="'+escape(item.id)+'"><div class="investigation-source-head"><h4>'+escape(item.id)+'</h4><span>'+escape(item.logEnvironment)+'</span></div><p>บันทึกหลุมเจาะ PDF หน้า '+item.logPage+' · ผลทดสอบ PDF หน้า '+item.labPage+' ('+(item.labPosition==='top'?'ส่วนบน':'ส่วนล่าง')+')</p><dl><div><dt>วันที่เริ่ม / สิ้นสุดตามบันทึก</dt><dd>'+escape(item.boringStartedText)+' / '+escape(item.boringFinishedText)+'</dd></div><div><dt>วันที่เอกสารผลทดสอบ</dt><dd>'+escape(item.laboratoryDateText)+'</dd></div><div><dt>ข้อความระดับน้ำตามต้นฉบับ</dt><dd>'+escape(item.observedWaterLevelText===null?'ไม่ระบุในต้นฉบับ':item.observedWaterLevelText)+'</dd></div><div><dt>เงื่อนไขเวลาตามต้นฉบับ</dt><dd>'+escape(item.waterObservationTimingText)+'</dd></div></dl><div class="investigation-source-actions"><a href="'+escape(item.sourceUrl)+'" target="_blank" rel="noopener noreferrer">เปิดเอกสารต้นฉบับ ↗</a>'+(readOnly?'':'<button type="button" class="text-button" data-investigation-use-borehole="'+escape(item.id)+'">ใช้รหัสและเลขหน้านี้</button>')+'</div></article>').join('')+'</div><ul class="investigation-source-notes">'+INVESTIGATION_SOURCE_NOTES.map(note=>'<li>'+escape(note)+'</li>').join('')+'</ul></div></details>';
}

export function mountInvestigations(container,{getProject,getSource,onProjectChange,onNotice,onDownload,onNavigate}) {
  const drafts=createInvestigationDraftStore(),selection=new Map();
  let rendered=null, pendingRemove=null;
  const keyFor=(stationId,kind)=>stationId+'/'+kind;
  const getMetadata=group=>group.metadata||defaults[group.id];

  function groupHTML(group,record,saved) {
    const kind=group.id,readOnly=record.kind==='saved',key=keyFor(record.station.id,kind);
    const draft=readOnly?{values:getMetadata(group),dirty:false,conflict:false}:drafts.get(key,getMetadata(group));
    const missing=group.missingMetadata.length+group.missingInputs.length;
    const hasRecord=saved[kind]!==null;
    const bindDisabled=draft.dirty||missing>0||!hasRecord;
    return '<article class="card investigation-group" data-investigation-kind="'+kind+'" data-state="'+escape(group.state)+'" data-readonly="'+readOnly+'" data-dirty="'+draft.dirty+'"><div class="investigation-group-head"><div><p class="eyebrow">'+(kind==='soil'?'SOIL / PARAMETER BASIS':'WATER / SOURCE & DATUM')+'</p><h3>'+titles[kind]+'</h3></div>'+(!readOnly&&hasRecord?'<button type="button" class="text-button investigation-delete" data-investigation-remove="'+kind+'">ลบบันทึกหมวดนี้</button>':'')+'</div>'
      +investigationStateHTML(group)+investigationChangesHTML(group)
      +(kind==='water'?'<p class="investigation-boundary">ระดับน้ำที่กรอกเป็นบริบทของรูปตัดและรายงาน ยังไม่ได้แปลงเป็นแรงดันน้ำรูพรุนใน R2 และไม่ได้สร้างผลวิเคราะห์น้ำลดฉับพลัน</p>':'<p class="investigation-boundary">บันทึกวิธีเลือกพารามิเตอร์และความสัมพันธ์กับสถานีให้ชัดเจน ค่าที่เขียนว่า cohesion ในเอกสารยังไม่ถูกแปลงเป็น c′ หรือ Su อัตโนมัติ</p>')
      +investigationValuesHTML(group,readOnly)
      +(readOnly?'<section class="investigation-saved-metadata"><h4>ข้อมูลอ้างอิงที่เก็บกับทางเลือกนี้</h4>'+metadataFieldsHTML(kind,getMetadata(group),{readOnly:true})+'</section>'
        :'<form id="investigation-'+kind+'-form" class="investigation-form" data-investigation-form="'+kind+'"><h4>ข้อมูลอ้างอิงของหมวดนี้</h4><p>บันทึกข้อมูลอ้างอิงก่อน แล้วใช้ “ผูกกับค่าปัจจุบัน” เมื่อทบทวนความสัมพันธ์กับค่าชุดนี้แล้ว</p>'+metadataFieldsHTML(kind,draft.values)+'<p class="investigation-draft-message" data-investigation-draft-message="'+kind+'" role="status"'+(draft.dirty?'':' hidden')+'>มีฉบับร่างที่ยังไม่บันทึก · การบันทึกข้อมูลอ้างอิงไม่ผูกข้อมูลใหม่ให้อัตโนมัติ</p><div class="investigation-draft-conflict" data-investigation-draft-conflict="'+kind+'"'+(draft.conflict?'':' hidden')+'><p>ข้อมูลที่บันทึกเปลี่ยนระหว่างแก้ฉบับร่าง ตรวจข้อความทั้งสองชุดก่อนเลือกใช้ร่างนี้ต่อหรือทิ้งร่าง</p><button type="button" class="text-button" data-investigation-use-draft="'+kind+'">ใช้ฉบับร่างนี้ต่อกับข้อมูลล่าสุด</button></div><div class="investigation-form-actions"><button type="submit" class="button primary" data-investigation-save="'+kind+'"'+(draft.conflict?' disabled':'')+'>บันทึกข้อมูลอ้างอิง</button><button type="button" class="button" data-investigation-bind="'+kind+'"'+(bindDisabled?' disabled':'')+'>ผูกกับค่าปัจจุบัน</button><button type="button" class="text-button" data-investigation-discard="'+kind+'"'+(draft.dirty?'':' disabled')+'>ทิ้งฉบับร่าง</button></div><p class="investigation-bind-help" data-investigation-bind-help="'+kind+'">'+(draft.dirty?'บันทึกฉบับร่างก่อนผูกกับค่าปัจจุบัน':missing?'ยังมีข้อมูลที่ต้องเติม '+missing+' รายการก่อนผูกข้อมูล':!hasRecord?'บันทึกข้อมูลอ้างอิงก่อนผูกกับค่าปัจจุบัน':'การผูกเก็บค่าชุดนี้ไว้สำหรับตรวจการเปลี่ยนแปลง ไม่ใช่การรับรองผลออกแบบ')+'</p></form>')
      +(pendingRemove===key&&!readOnly?'<div class="investigation-remove-confirm" role="group" aria-label="ยืนยันลบบันทึก '+titles[kind]+'"><p>ลบบันทึกและฉบับร่างของหมวดนี้? ค่าที่ใช้คำนวณของสถานียังคงเดิม</p><button type="button" class="button" data-investigation-confirm-remove="'+kind+'">ยืนยันลบบันทึก</button><button type="button" class="text-button" data-investigation-cancel-remove>เก็บบันทึกไว้</button></div>':'')+'</article>';
  }

  function render() {
    const project=getProject(),stationId=project.selectedStationId;
    const alternatives=getStationComparison(project,stationId).alternatives;
    let scenarioId=selection.get(stationId)||'current';
    if(scenarioId!=='current'&&!alternatives.some(item=>item.id===scenarioId))scenarioId='current';
    selection.set(stationId,scenarioId);
    const record=buildInvestigationReview(project,getSource(),stationId,scenarioId);
    const saved=getStationInvestigations(project,stationId,scenarioId);
    const readOnly=record.kind==='saved';
    rendered={record,saved};
    container.dataset.stationId=stationId;container.dataset.scenarioId=scenarioId;
    container.dataset.projectRevision=record.projectRevision;container.dataset.scenarioRevision=record.scenarioRevision;
    container.dataset.readonly=String(readOnly);
    container.innerHTML='<article class="investigation-intro"><p class="eyebrow">INVESTIGATION BASIS / STATION & SCENARIO</p><h2>รู้ว่าค่าดินและน้ำมาจากไหน</h2><p>บันทึกหลักฐานที่ใช้กับค่าชุดนี้ แล้วติดตามว่าข้อมูลอ้างอิงหรือค่าที่เกี่ยวข้องเปลี่ยนหลังผูกบันทึกหรือไม่</p></article><div class="investigation-toolbar"><div><strong>'+escape(stationLabel(record.station))+'</strong><p>'+escape(record.station.sourceSheet)+' แถว '+record.station.sourceRow+' · '+escape(record.scenarioName)+'</p><code>'+escape(record.scenarioRevision)+'</code></div><label for="investigation-scenario">ชุดข้อมูลที่ตรวจ<select id="investigation-scenario"><option value="current"'+(scenarioId==='current'?' selected':'')+'>ค่าที่กำลังแก้</option>'+alternatives.map(item=>'<option value="'+escape(item.id)+'"'+(scenarioId===item.id?' selected':'')+'>'+escape(item.name)+' · ทางเลือกที่เก็บ</option>').join('')+'</select></label><button type="button" class="button" id="export-investigations">ส่งออกฐานข้อมูล CSV ↓</button></div>'
      +'<p class="investigation-draft-summary" id="investigation-draft-summary" role="status"></p>'
      +(readOnly?'<div class="investigation-readonly-note"><strong>กำลังอ่านข้อมูลที่เก็บกับทางเลือก</strong><p>การเลือกดูไม่เปลี่ยนค่าที่กำลังแก้ หากต้องการปรับข้อมูล ให้เปิดทางเลือกนี้ในหน้าเปรียบเทียบแล้วเลือก “นำมาแก้ต่อ”</p><button type="button" class="text-button" data-investigation-open-saved>เปิดทางเลือกที่เก็บ →</button></div>':'<p class="investigation-scope-note">แก้เฉพาะบันทึกของค่าที่กำลังทำงานในสถานีนี้ การบันทึกหรือผูกข้อมูลไม่ได้ยืนยันเอกสาร หลุมเจาะ หรือความถูกต้องของพารามิเตอร์</p>')
      +'<div class="investigation-groups">'+record.groups.map(group=>groupHTML(group,record,saved)).join('')+'</div>'
      +investigationCatalogueHTML(readOnly)
      +'<details class="card investigation-limitations"><summary>ขอบเขตและการส่งต่อข้อมูล</summary><div><p>CSV ใช้ข้อมูลที่บันทึกของชุดที่เลือก ไม่รวมฉบับร่างที่ยังไม่บันทึก ใช้รายงานค่าปัจจุบันหรือรายงานเปรียบเทียบเพื่อเก็บฐานอ้างอิงร่วมกับผลคำนวณ</p><ul>'+record.limitations.map(item=>'<li>'+escape(typeof item==='string'?item:item.description||item.title||'')+'</li>').join('')+'</ul><p>ฉบับร่างในแบบฟอร์มอยู่ในหน้านี้ชั่วคราว กรุณากดบันทึกข้อมูลอ้างอิงและบันทึกโครงการ JSON ก่อนปิดหรือโหลดหน้าใหม่</p></div></details>';
    updateDraftSummary();
  }

  function updateDraftSummary() {
    const dirty=drafts.dirtyKeys(),stationId=rendered.record.station.id;
    const here=dirty.filter(key=>key.startsWith(stationId+'/')).length;
    const el=container.querySelector('#investigation-draft-summary');
    el.hidden=!dirty.length;
    el.textContent='มีฉบับร่างที่ยังไม่บันทึก '+dirty.length+' หมวด'+(here?' · สถานีนี้ '+here+' หมวด':' · อยู่ในสถานีอื่น')+' · สลับสถานีแล้วกลับมาแก้ต่อได้ แต่ต้องบันทึกก่อนปิดหน้า';
  }

  function updateDraftIndicators(kind) {
    const group=rendered.record.groups.find(item=>item.id===kind);
    const state=drafts.get(keyFor(rendered.record.station.id,kind),getMetadata(group));
    const box=container.querySelector('[data-investigation-kind="'+kind+'"]');
    box.dataset.dirty=String(state.dirty);
    box.querySelector('[data-investigation-draft-message]').hidden=!state.dirty;
    box.querySelector('[data-investigation-draft-conflict]').hidden=!state.conflict;
    box.querySelector('[data-investigation-save]').disabled=state.conflict;
    box.querySelector('[data-investigation-discard]').disabled=!state.dirty;
    const missing=group.missingMetadata.length+group.missingInputs.length;
    box.querySelector('[data-investigation-bind]').disabled=state.dirty||missing>0||rendered.saved[kind]===null;
    box.querySelector('[data-investigation-bind-help]').textContent=state.dirty?'บันทึกฉบับร่างก่อนผูกกับค่าปัจจุบัน':missing?'ยังมีข้อมูลที่ต้องเติม '+missing+' รายการก่อนผูกข้อมูล':'การผูกเก็บค่าชุดนี้ไว้สำหรับตรวจการเปลี่ยนแปลง ไม่ใช่การรับรองผลออกแบบ';
    updateDraftSummary();
  }

  function currentGroup(kind) {
    if(!kinds.includes(kind)||rendered.record.kind!=='current')throw new TypeError('แก้ได้เฉพาะฐานข้อมูลของค่าที่กำลังแก้');
    return buildInvestigationReview(getProject(),getSource(),getProject().selectedStationId,'current').groups.find(item=>item.id===kind);
  }

  function write(change,message,{discardKind=null}={}) {
    try {
      const next=change();
      onProjectChange(next);
      if(discardKind)drafts.discard(keyFor(getProject().selectedStationId,discardKind));
      pendingRemove=null;
      render();
      onNotice(message);
    } catch(error) {onNotice(error.message,true);}
  }

  container.addEventListener('input',event=>{
    const kind=event.target.dataset.investigationMetadata;
    if(!kinds.includes(kind)||rendered?.record.kind!=='current')return;
    const group=rendered.record.groups.find(item=>item.id===kind);
    if(!INVESTIGATION_METADATA_FIELDS[kind].some(item=>item.field===event.target.name))return;
    drafts.set(keyFor(rendered.record.station.id,kind),event.target.name,event.target.value,getMetadata(group));
    updateDraftIndicators(kind);
  });
  container.addEventListener('change',event=>{
    if(event.target.id!=='investigation-scenario')return;
    selection.set(getProject().selectedStationId,event.target.value);pendingRemove=null;render();
    container.querySelector('#investigation-scenario')?.focus();
  });
  container.addEventListener('submit',event=>{
    const kind=event.target.dataset.investigationForm;
    if(!kinds.includes(kind))return;
    event.preventDefault();
    write(()=>{
      const group=currentGroup(kind),draft=drafts.get(keyFor(getProject().selectedStationId,kind),getMetadata(group));
      if(draft.conflict)throw new Error('ข้อมูลที่บันทึกเปลี่ยนระหว่างแก้ฉบับร่าง โปรดเลือกใช้ร่างนี้ต่อหรือทิ้งร่างก่อน');
      const metadata=Object.fromEntries(INVESTIGATION_METADATA_FIELDS[kind].map(item=>[item.field,item.type==='number'?(draft.values[item.field].trim()===''?null:Number(draft.values[item.field])):draft.values[item.field]]));
      return saveInvestigationMetadata(getProject(),kind,metadata,getSource());
    },'บันทึกข้อมูลอ้างอิงแล้ว · ยังไม่ได้ผูกใหม่กับค่าปัจจุบัน',{discardKind:kind});
  });
  container.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button||button.disabled)return;
    const stationId=getProject().selectedStationId,scenarioId=selection.get(stationId)||'current';
    if(button.id==='export-investigations') {
      try {const record=buildInvestigationReview(getProject(),getSource(),stationId,scenarioId);onDownload('S6006-'+stationId+'-'+scenarioId+'-investigations.csv',investigationCSV(record),'text/csv;charset=utf-8');onNotice('ส่งออกฐานข้อมูลที่บันทึกของชุดนี้แล้ว · ฉบับร่างที่ยังไม่บันทึกไม่รวมในไฟล์');}
      catch(error){onNotice(error.message,true);}
      return;
    }
    if(button.hasAttribute('data-investigation-open-saved')){onNavigate({stationId,scenarioId,section:'comparison',field:null});return;}
    if(button.hasAttribute('data-investigation-navigate')) {
      const path=button.dataset.investigationNavigate;
      const known=Object.values(INVESTIGATION_VALUE_FIELDS).flat().some(item=>item.field===path);
      if(!known)return;
      const [prefix,field]=path.split('.');
      onNavigate({stationId,scenarioId,section:scenarioId!=='current'?'comparison':prefix==='geometry'?'model':prefix==='soilInputs'?'soil':'context',field});
      return;
    }
    if(rendered.record.kind!=='current')return;
    if(button.hasAttribute('data-investigation-use-borehole')) {
      const item=getBoreholeSource(button.dataset.investigationUseBorehole);if(!item)return;
      const group=currentGroup('soil'),key=keyFor(stationId,'soil');
      drafts.set(key,'boreholeId',item.id,getMetadata(group));
      drafts.set(key,'locator','S-CALC · บันทึกหลุมเจาะ PDF หน้า '+item.logPage+' · ผลทดสอบ PDF หน้า '+item.labPage+' ('+(item.labPosition==='top'?'ส่วนบน':'ส่วนล่าง')+')',getMetadata(group));
      render();container.querySelector('#investigation-soil-boreholeId')?.focus();
      onNotice('คัดลอกรหัสและเลขหน้าลงฉบับร่างแล้ว · ยังไม่ได้บันทึก จับคู่สถานี หรือเปลี่ยนค่าดินและระดับน้ำ');
      return;
    }
    for(const action of ['discard','use-draft','bind','remove','confirm-remove']) {
      if(!button.hasAttribute('data-investigation-'+action))continue;
      const kind=button.getAttribute('data-investigation-'+action);if(!kinds.includes(kind))return;
      const key=keyFor(stationId,kind);
      if(action==='discard'){drafts.discard(key);render();onNotice('ทิ้งฉบับร่างของหมวดนี้แล้ว ข้อมูลที่บันทึกยังคงเดิม');return;}
      if(action==='use-draft'){const group=currentGroup(kind);drafts.rebase(key,getMetadata(group));render();onNotice('เลือกใช้ฉบับร่างกับข้อมูลล่าสุดแล้ว กรุณาตรวจแล้วกดบันทึกข้อมูลอ้างอิง');return;}
      if(action==='remove'){pendingRemove=key;render();return;}
      if(action==='confirm-remove'){write(()=>{currentGroup(kind);return removeInvestigation(getProject(),kind,getSource());},'ลบบันทึกหมวดนี้แล้ว ค่าที่ใช้คำนวณยังคงเดิม',{discardKind:kind});return;}
      if(action==='bind'){write(()=>{const group=currentGroup(kind);if(drafts.get(key,getMetadata(group)).dirty)throw new Error('กรุณาบันทึกฉบับร่างก่อนผูกข้อมูล');return captureInvestigation(getProject(),kind,getSource());},'ผูกบันทึกกับค่าปัจจุบันแล้ว · สถานะตรงกันไม่ได้รับรองเอกสารหรือการออกแบบ');return;}
    }
    if(button.hasAttribute('data-investigation-cancel-remove')){pendingRemove=null;render();}
  });
  render();
  return {render};
}
