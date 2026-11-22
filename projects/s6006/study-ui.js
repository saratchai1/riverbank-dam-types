import { getStationComparison } from './project.js';
import { studyOptions, studySourceRevision, studyCSV } from './studies.js';
import { ENGINEERING_REFERENCES } from './engineering.js';
import {
  STUDY_DOCUMENT_MAX_BYTES, createStudyDocument,
  serializeStudyDocument, parseStudyDocument,
} from './study-storage.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const available = cell => cell?.availability === 'computed' && finite(cell.value);
const availabilityLabels = {
  computed:'คำนวณได้ตามแบบจำลอง', missing:'ข้อมูลยังไม่ครบ', gated:'ยังใช้ตรวจไม่ได้',
  invalid:'อยู่นอกขอบเขตการคำนวณ', 'not-applicable':'ไม่ใช้ในกรณีนี้',
};
const evidenceLabels = {missing:'ยังไม่มีบันทึก',incomplete:'ข้อมูลยังไม่ครบ',current:'ตรงกับค่าที่ผูกไว้',stale:'มีค่าเปลี่ยน ต้องทบทวน'};
const checkLabels = {
  satisfied:'เป็นไปตามเงื่อนไขย่อย', 'not-satisfied':'ต้องทบทวน', review:'ต้องทบทวน',
  pending:'ยังสรุปไม่ได้', 'not-required':'ไม่จำเป็นในกรณีนี้', 'not-evaluated':'ยังไม่ตรวจ',
  illustrative:'ผลแบบจำลองย่อย', 'requires-review':'ต้องทบทวน',
};
const groupLabels = {beam:'โครงสร้างคาน',soil:'ดินและลาดอนันต์',geometry:'รูปตัดทฤษฎี'};
const configFields = ['stationId','scenarioId','parameterId','minimum','maximum','sampleCount'];
const stationLabel = station => 'R'+station.reach+' · STA '+Math.floor(station.station/1000)+'+'+String(station.station%1000).padStart(3,'0');
const timestamp = value => new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value))+' (กรุงเทพฯ)';

export function formatStudyValue(value) {
  if(value === null || value === undefined || value === '')return '—';
  if(typeof value !== 'number')return String(value);
  if(!Number.isFinite(value))return 'ค่านอกขอบเขต';
  if(value !== 0 && (Math.abs(value)<.0001 || Math.abs(value)>=1e9))return value.toExponential(6);
  return value.toLocaleString('en-US',{maximumFractionDigits:6});
}

const exactValue = value => value===null||value===undefined||value===''?'—':String(value);
const signed = value => finite(value)?(value>0?'+':'')+String(value):'—';
const axisNumber = value => value===0?'0':Math.abs(value)<.001||Math.abs(value)>=1e6?value.toExponential(2):Number(value.toPrecision(4)).toLocaleString('en-US',{maximumFractionDigits:6});
const cellFor = (point,metricId) => point.metrics[metricId];
const pointFor = (record,pointId) => pointId==='baseline'?record.baseline:record.samples.find(point=>point.id===pointId);
const metricFor = (record,metricId) => {
  const metric=record.metricDefinitions.find(item=>item.id===metricId);
  if(!metric || !record.parameter.metricIds.includes(metricId))throw new RangeError('ไม่พบผลลัพธ์ที่ใช้กับตัวแปรทดลองนี้');
  return metric;
};
const pointLabel = point => point.id==='baseline'?'ค่าฐาน':'จุด '+point.id.replace('sample-','');
const availabilityHTML = cell => '<span class="study-availability" data-availability="'+escape(cell?.availability||'missing')+'">'+escape(availabilityLabels[cell?.availability]||'ยังไม่มีผล')+'</span>';

/** Numeric chart geometry only. No gates, acceptance criteria or engineering results are derived here. */
export function studyChartSVG(record,metricId,{selectedPointId='baseline',prefix='study'}={}) {
  const metric=metricFor(record,metricId),base=cellFor(record.baseline,metricId);
  const usable=record.samples.filter(point=>available(cellFor(point,metricId)));
  const hasBaseline=available(base)&&finite(record.baseline.x);
  const titleId=String(prefix).replace(/[^a-zA-Z0-9_-]/g,'-')+'-chart-title';
  const descriptionId=String(prefix).replace(/[^a-zA-Z0-9_-]/g,'-')+'-chart-description';
  const baseOutside=hasBaseline&&(record.baseline.x<record.config.minimum||record.baseline.x>record.config.maximum);
  const title=metric.label+' ตาม '+record.parameter.label;
  const description='คำนวณได้ '+usable.length+' จาก '+record.samples.length+' จุดทดลอง เส้นเชื่อมเฉพาะจุดคำนวณที่อยู่ติดกัน จุดที่ไม่มีผลไม่ถูกแทนด้วยศูนย์'+(baseOutside?' ค่าฐานอยู่นอกช่วงทดลองและแสดงแยกจากเส้นของจุดทดลอง':'');
  const opening='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 360" role="img" aria-labelledby="'+titleId+' '+descriptionId+'" data-study-chart-metric="'+escape(metricId)+'" data-computed-points="'+usable.length+'" data-baseline-outside="'+baseOutside+'"><title id="'+titleId+'">'+escape(title)+'</title><desc id="'+descriptionId+'">'+escape(description)+'</desc><rect x="0" y="0" width="720" height="360" rx="7" fill="#fbfcf8"/>';
  if(!usable.length&&!hasBaseline) {
    return opening+'<text x="360" y="151" text-anchor="middle" font-family="Tahoma,Noto Sans Thai,sans-serif" font-size="21" fill="#8b7953" class="study-empty-chart-label">ผลนี้ยังไม่มีค่าที่ใช้วาดกราฟ</text><text x="360" y="185" text-anchor="middle" font-family="Tahoma,Noto Sans Thai,sans-serif" font-size="15" fill="#8b7953">อ่านเหตุผลของแต่ละจุดในตารางด้านล่าง</text><text x="360" y="220" text-anchor="middle" font-family="Tahoma,Noto Sans Thai,sans-serif" font-size="13" fill="#8b7953">ช่องว่างคงเป็นข้อมูลที่ยังไม่มีผลคำนวณ</text></svg>';
  }
  const left=89,right=693,top=34,bottom=278,width=right-left,height=bottom-top;
  const xs=[record.config.minimum,record.config.maximum,...(hasBaseline?[record.baseline.x]:[])];
  const xMin=Math.min(...xs),xMax=Math.max(...xs),xSpan=xMax-xMin;
  const values=[...usable.map(point=>cellFor(point,metricId).value),...(hasBaseline?[base.value]:[])];
  // Scale before padding to keep finite values near the floating-point limit drawable.
  const scale=Math.max(...values.map(value=>Math.abs(value)))||1;
  const normalized=values.map(value=>value/scale);
  const nMin=Math.min(...normalized),nMax=Math.max(...normalized),pad=(nMax-nMin||Math.max(Math.abs(nMax),1))*.09;
  const yMin=nMin>=0?Math.max(0,nMin-pad):Math.max(-Number.MAX_VALUE/scale,nMin-pad);
  let yMax=Math.min(Number.MAX_VALUE/scale,nMax+pad);
  if(yMax===yMin)yMax=yMin+1;
  const x=value=>left+(value-xMin)/xSpan*width;
  const y=value=>bottom-(value/scale-yMin)/(yMax-yMin)*height;
  const coord=value=>Number(value.toFixed(3));
  let svg=opening;
  for(let index=0;index<=4;index++) {
    const position=bottom-height*index/4,value=(yMin+(yMax-yMin)*index/4)*scale;
    svg+='<line x1="'+left+'" y1="'+coord(position)+'" x2="'+right+'" y2="'+coord(position)+'" stroke="#e1e8d9" stroke-width="1" class="study-grid"/><text x="'+(left-11)+'" y="'+coord(position+5)+'" text-anchor="end" font-family="Tahoma,Noto Sans Thai,sans-serif" font-size="14" fill="#708269">'+escape(axisNumber(value))+'</text>';
  }
  for(let index=0;index<=4;index++) {
    const value=xMin+xSpan*index/4,position=x(value);
    svg+='<line x1="'+coord(position)+'" y1="'+top+'" x2="'+coord(position)+'" y2="'+bottom+'" stroke="#edf1e6" stroke-width="1"/><text x="'+coord(position)+'" y="'+(bottom+34)+'" text-anchor="'+(index===0?'start':index===4?'end':'middle')+'" font-family="Tahoma,Noto Sans Thai,sans-serif" font-size="14" fill="#708269">'+escape(axisNumber(value))+'</text>';
  }
  svg+='<path d="M'+left+' '+top+'V'+bottom+'H'+right+'" fill="none" stroke="#a8b89f" stroke-width="1.2" class="study-axis"/><text x="'+((left+right)/2)+'" y="345" text-anchor="middle" font-family="Tahoma,Noto Sans Thai,sans-serif" font-size="15" fill="#506b4e" class="study-axis-title">ค่าที่ทดลอง ('+escape(record.parameter.unit)+')</text><text x="23" y="'+((top+bottom)/2)+'" transform="rotate(-90 23 '+((top+bottom)/2)+')" text-anchor="middle" font-family="Tahoma,Noto Sans Thai,sans-serif" font-size="15" fill="#506b4e" class="study-axis-title">'+escape(metric.unit||'ไม่มีหน่วย')+'</text>';
  if(baseOutside) {
    for(const edge of [record.config.minimum,record.config.maximum])svg+='<line x1="'+coord(x(edge))+'" y1="'+top+'" x2="'+coord(x(edge))+'" y2="'+bottom+'" stroke="#bdcbb2" stroke-dasharray="2 4" stroke-width="1" data-study-range-boundary="'+escape(edge)+'"/>';
  }
  if(hasBaseline) {
    const bx=x(record.baseline.x),by=y(base.value),nearRight=bx>(left+right)/2;
    svg+='<line x1="'+coord(bx)+'" y1="'+top+'" x2="'+coord(bx)+'" y2="'+bottom+'" stroke="#b19054" stroke-dasharray="6 5" stroke-width="1.4" class="study-baseline-line"/><line x1="'+left+'" y1="'+coord(by)+'" x2="'+right+'" y2="'+coord(by)+'" stroke="#b19054" stroke-dasharray="6 5" stroke-width="1" class="study-baseline-line"/><text x="'+coord(bx+(nearRight?-6:6))+'" y="22" text-anchor="'+(nearRight?'end':'start')+'" font-family="Tahoma,Noto Sans Thai,sans-serif" font-size="12" fill="#96783e" class="study-baseline-label">ค่าฐาน'+(baseOutside?' · นอกช่วงทดลอง':'')+'</text>';
  }
  let segment=[];
  const flush=()=>{
    if(segment.length>=2)svg+='<path d="'+segment.map((point,index)=>(index?'L':'M')+coord(x(point.x))+' '+coord(y(cellFor(point,metricId).value))).join(' ')+'" fill="none" stroke="#2a7061" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="study-line" data-study-segment="'+escape(segment.map(point=>point.id).join(','))+'"/>';
    segment=[];
  };
  for(const point of record.samples) {
    if(available(cellFor(point,metricId)))segment.push(point);else flush();
  }
  flush();
  for(const point of record.samples) {
    const cell=cellFor(point,metricId),px=x(point.x),selected=point.id===selectedPointId;
    const label=pointLabel(point)+'; '+record.parameter.label+' '+formatStudyValue(point.x)+' '+record.parameter.unit+'; '+(available(cell)?metric.label+' '+formatStudyValue(cell.value)+' '+metric.unit:availabilityLabels[cell.availability]+' '+cell.reason);
    if(available(cell))svg+='<g data-study-select-point="'+escape(point.id)+'" data-study-chart-point="'+escape(point.id)+'" aria-label="'+escape(label)+'"><title>'+escape(label)+'</title><circle cx="'+coord(px)+'" cy="'+coord(y(cell.value))+'" r="13" fill="transparent" class="study-point-hit"/><circle cx="'+coord(px)+'" cy="'+coord(y(cell.value))+'" r="'+(selected?6:4.5)+'" fill="'+(selected?'#fff':'#2a7061')+'" stroke="'+(selected?'#ae813c':'#fbfcf8')+'" stroke-width="'+(selected?3:2)+'" class="'+(selected?'study-selected':'study-dot')+'"/></g>';
    else svg+='<g data-study-select-point="'+escape(point.id)+'" data-study-chart-unavailable="'+escape(point.id)+'" aria-label="'+escape(label)+'"><title>'+escape(label)+'</title><circle cx="'+coord(px)+'" cy="'+(bottom+12)+'" r="12" fill="transparent"/><path d="M'+coord(px-4)+' '+(bottom+8)+'l8 8m-8 0l8-8" stroke="#ae9070" stroke-width="2" fill="none" class="study-missing-mark"/></g>';
  }
  if(hasBaseline) {
    const label='ค่าฐาน; '+record.parameter.label+' '+formatStudyValue(record.baseline.x)+' '+record.parameter.unit+'; '+metric.label+' '+formatStudyValue(base.value)+' '+metric.unit;
    svg+='<g data-study-select-point="baseline" data-study-chart-baseline aria-label="'+escape(label)+'"><title>'+escape(label)+'</title><circle cx="'+coord(x(record.baseline.x))+'" cy="'+coord(y(base.value))+'" r="14" fill="transparent"/><circle cx="'+coord(x(record.baseline.x))+'" cy="'+coord(y(base.value))+'" r="'+(selectedPointId==='baseline'?6.5:5)+'" fill="#b19054" stroke="'+(selectedPointId==='baseline'?'#71582e':'#fff')+'" stroke-width="2" class="study-baseline-dot"/></g>';
  }
  return svg+'</svg>';
}

export function studyChartHTML(record,metricId,options={}) {
  const cell=cellFor(record.baseline,metricId),outside=available(cell)&&finite(record.baseline.x)&&(record.baseline.x<record.config.minimum||record.baseline.x>record.config.maximum);
  return '<figure class="study-chart">'+studyChartSVG(record,metricId,options)+'<div class="study-chart-legend"><span><i></i>จุดทดลองที่คำนวณได้</span><span><i class="baseline"></i>ค่าฐานที่บันทึก</span><span><i class="unavailable">×</i>ไม่มีผลของจุดนั้น</span></div><figcaption>'+escape(record.parameter.label)+' · ช่วงทดลอง '+escape(formatStudyValue(record.config.minimum))+' ถึง '+escape(formatStudyValue(record.config.maximum))+' '+escape(record.parameter.unit)+' · '+record.samples.length+' จุด'+(outside?' · ค่าฐานอยู่นอกช่วงทดลอง แกนนอนจึงครอบคลุมค่าฐานด้วย':'')+'<br>เส้นเชื่อมช่วยอ่านจุดทดลอง ผลระหว่างจุดยังไม่ได้คำนวณ จุดที่ไม่ให้ผลไม่มีการแทนด้วยศูนย์</figcaption></figure>';
}

export function studyTableHTML(record,metricId,{selectedPointId='baseline'}={}) {
  const metric=metricFor(record,metricId);
  return '<div class="study-table-scroll" role="region" tabindex="0" aria-label="ผลทดลองทุกจุด เลื่อนแนวนอนเพื่ออ่านค่าและเหตุผล"><table class="study-table"><thead><tr><th scope="col">จุดที่ตรวจ</th><th scope="col">'+escape(record.parameter.label)+'<br>'+escape(record.parameter.unit)+'</th><th scope="col">'+escape(metric.label)+'<br>'+escape(metric.unit)+'</th><th scope="col">Δ เทียบฐาน</th><th scope="col">Δ %</th><th scope="col">สถานะ / เหตุผล</th></tr></thead><tbody>'+[record.baseline,...record.samples].map(point=>{
    const cell=cellFor(point,metricId),base=point.id==='baseline';
    return '<tr data-study-row="'+escape(point.id)+'" data-kind="'+(base?'baseline':'sample')+'" data-selected="'+(point.id===selectedPointId)+'" data-availability="'+escape(cell.availability)+'"><td><button type="button" data-study-select-point="'+escape(point.id)+'" aria-pressed="'+(point.id===selectedPointId)+'">'+escape(pointLabel(point))+' →</button></td><td class="num" data-study-x="'+escape(point.id)+'">'+escape(exactValue(point.x))+'</td><td class="num" data-study-value="'+escape(point.id)+'">'+escape(available(cell)?exactValue(cell.value):'—')+'</td><td class="num">'+escape(base?'—':signed(cell.delta))+'</td><td class="num">'+escape(base?'—':signed(cell.deltaPercent))+'</td><td>'+availabilityHTML(cell)+'<small>'+escape(cell.reason)+'</small></td></tr>';
  }).join('')+'</tbody></table></div><p class="study-table-caption">Δ = ผลจุดทดลอง − ผลฐาน · ไม่แสดงเปอร์เซ็นต์เมื่อผลฐานเป็นศูนย์หรือยังไม่มีผลที่ใช้เปรียบเทียบ ตัวเลขในตารางและไฟล์ส่งออกแสดงค่าที่เก็บครบความละเอียดของระบบ ส่วนข้อความกำกับกราฟปัดเศษเพื่อให้อ่านง่าย การแสดงค่าฐานแยกจากจุดทดลองไม่เพิ่มจำนวนจุดในช่วง</p>';
}

function inputRows(scenario,section,variedId) {
  const data=scenario[section];
  return Object.entries(data).map(([field,value])=>'<tr data-varied="'+(section+'.'+field===variedId)+'"><td><code>'+escape(section+'.'+field)+'</code>'+(section+'.'+field===variedId?'<small>ตัวแปรที่เปลี่ยนในการทดลอง</small>':'')+'</td><td>'+escape(exactValue(value))+'</td></tr>').join('');
}

function calculationDetails(point,domain) {
  const result=point.results[domain];
  if(!result)return '';
  const rows=result.formulaRows||[],checks=result.checks||[],warnings=result.warnings||[];
  return '<details class="study-point-details" data-study-calculation="'+domain+'"><summary>'+escape(groupLabels[domain])+' · สูตรและการแทนค่า '+rows.length+' รายการ</summary><div>'
    +(rows.length?'<div class="table-wrap" tabindex="0" role="region" aria-label="สูตรและการแทนค่า '+escape(groupLabels[domain])+'"><table><thead><tr><th>รายการ</th><th>สมการ / การแทนค่า</th><th>ผล</th><th>หน่วย</th></tr></thead><tbody>'+rows.map(row=>'<tr><td>'+escape(row.label)+'</td><td class="formula">'+escape(row.formula)+'<small>'+escape(row.substitution)+'</small>'+(row.assumption?'<small>'+escape(row.assumption)+'</small>':'')+'</td><td class="num">'+escape(exactValue(row.value))+'</td><td>'+escape(row.unit)+'</td></tr>').join('')+'</tbody></table></div>':'')
    +(checks.length?'<h4>เงื่อนไขของแบบจำลองย่อย</h4><div class="table-wrap" tabindex="0" role="region" aria-label="เงื่อนไขของจุดทดลอง"><table><thead><tr><th>รายการ</th><th>ค่า / ขีดจำกัด</th><th>สถานะ</th><th>คำอธิบาย</th></tr></thead><tbody>'+checks.map(check=>'<tr><td>'+escape(check.label)+'</td><td>'+escape(exactValue(check.value))+' / '+escape(exactValue(check.limit))+'</td><td>'+escape(checkLabels[check.status]||check.status)+'</td><td>'+escape(check.note||'')+'</td></tr>').join('')+'</tbody></table></div>':'')
    +(warnings.length?'<ul class="study-details-note">'+warnings.map(item=>'<li>'+escape(item)+'</li>').join('')+'</ul>':'')+'</div></details>';
}

export function studyPointDetailHTML(record,metricId,pointId='baseline') {
  const metric=metricFor(record,metricId),point=pointFor(record,pointId);
  if(!point)throw new RangeError('ไม่พบจุดทดลองที่เลือก');
  const cell=cellFor(point,metricId),domains=record.parameter.group==='beam'?['beam']:record.parameter.section==='geometry'?['soil','geometry']:['soil'];
  const errors=point.errors.filter(error=>domains.includes(error.domain));
  return '<article class="card study-point-detail" id="study-point-detail" tabindex="-1" data-study-detail-point="'+escape(point.id)+'"><div class="study-point-head"><div><p class="eyebrow">'+(point.id==='baseline'?'CAPTURED BASELINE':'SAMPLED POINT / EXACT INPUTS')+'</p><h3>'+escape(pointLabel(point))+' · '+escape(record.parameter.label)+' '+escape(formatStudyValue(point.x))+' '+escape(record.parameter.unit)+'</h3><p>'+escape(stationLabel(record.selection.station))+' · '+escape(record.selection.scenarioName)+'</p></div><div class="study-point-value"><strong title="'+escape(available(cell)?exactValue(cell.value):'ไม่มีผล')+'">'+escape(available(cell)?formatStudyValue(cell.value):'—')+'</strong><span>'+escape(metric.unit)+'</span></div></div>'
    +availabilityHTML(cell)+'<p class="study-point-status">'+escape(cell.reason)+'</p>'
    +(errors.length?'<ul class="study-point-errors">'+errors.map(error=>'<li>'+escape(groupLabels[error.domain]||error.domain)+': '+escape(error.message)+'</li>').join('')+'</ul>':'')
    +'<div class="study-point-metrics">'+record.parameter.metricIds.map(id=>{
      const definition=metricFor(record,id),value=cellFor(point,id);
      return '<div data-study-detail-metric="'+escape(id)+'"><small>'+escape(definition.label)+'</small><strong>'+escape(available(value)?formatStudyValue(value.value):'—')+'</strong><span>'+escape(definition.unit)+' · '+escape(availabilityLabels[value.availability])+'</span></div>';
    }).join('')+'</div>'
    +'<details class="study-point-details" data-study-input-details><summary>ค่าตั้งต้นครบของจุดนี้</summary><div><p class="study-details-note">เปลี่ยนเฉพาะ '+escape(record.parameter.id)+' ค่าที่เหลือคัดลอกจากฐานของชุดทดลอง บริบทน้ำและข้อมูลอ้างอิงยังไม่ถูกตีความเป็นเงื่อนไขแรงดันน้ำใหม่</p>'+['geometry','beamInputs','soilInputs','context'].map(section=>'<h4>'+escape(({geometry:'มิติรูปตัด',beamInputs:'โครงสร้างคาน',soilInputs:'ดิน',context:'น้ำและที่มาของสถานการณ์'})[section])+'</h4><div class="table-wrap" tabindex="0" role="region" aria-label="ค่าตั้งต้น '+escape(section)+'"><table class="study-input-table"><thead><tr><th>ข้อมูล</th><th>ค่าที่ใช้</th></tr></thead><tbody>'+inputRows(point.scenario,section,record.parameter.id)+'</tbody></table></div>').join('')+'</div></details>'
    +domains.map(domain=>calculationDetails(point,domain)).join('')+'</article>';
}

export function studyFreshness(record,project,source,draftConfig) {
  let sourceState='current';
  try {
    if(studySourceRevision(project,source,{stationId:record.selection.station.id,scenarioId:record.selection.scenarioId})!==record.sourceRevision)sourceState='changed';
  } catch {sourceState='unavailable';}
  const configState=configFields.every(field=>draftConfig[field]===record.config[field])?'current':'changed';
  return {sourceState,configState};
}

/** UI-only drafts survive project renders; they are never written into a station scenario. */
export function createStudyDraftStore() {
  const drafts=new Map();
  return {
    get(key,suggestedRange) {
      if(!drafts.has(key))drafts.set(key,{minimum:suggestedRange?String(suggestedRange.minimum):'',maximum:suggestedRange?String(suggestedRange.maximum):'',sampleCount:String(suggestedRange?.sampleCount??9),suggested:!!suggestedRange});
      return {...drafts.get(key)};
    },
    set(key,field,value,suggestedRange) {
      if(!['minimum','maximum','sampleCount'].includes(field))throw new TypeError('ไม่รู้จักช่องตั้งค่าชุดทดลอง');
      this.get(key,suggestedRange);
      drafts.set(key,{...drafts.get(key),[field]:String(value),suggested:false});
      return {...drafts.get(key)};
    },
  };
}

export function mountStudies(container,{getProject,getSource,onNotice,onDownload,onReport,onNavigate}) {
  const choices=new Map(),parameterChoices=new Map(),drafts=createStudyDraftStore();
  let rendered=null,captured=null,metricId=null,pointId='baseline',errorMessage='',actionSequence=0;

  function setupContext() {
    const project=getProject(),source=getSource();
    if(!project||!source)return null;
    const stationId=project.selectedStationId,alternatives=getStationComparison(project,stationId).alternatives;
    let scenarioId=choices.get(stationId)||'current';
    if(scenarioId!=='current'&&!alternatives.some(item=>item.id===scenarioId))scenarioId='current';
    choices.set(stationId,scenarioId);
    const options=studyOptions(project,source,{stationId,scenarioId});
    const selectionKey=stationId+'/'+scenarioId;
    let parameterId=parameterChoices.get(selectionKey)||options.parameters[0].id;
    if(!options.parameters.some(item=>item.id===parameterId))parameterId=options.parameters[0].id;
    parameterChoices.set(selectionKey,parameterId);
    const parameter=options.parameters.find(item=>item.id===parameterId),draftKey=selectionKey+'/'+parameterId;
    const draft=drafts.get(draftKey,parameter.suggestedRange);
    return {options,alternatives,stationId,scenarioId,selectionKey,parameterId,parameter,draftKey,draft};
  }

  function configFromDraft(context) {
    const numeric=field=>context.draft[field].trim()===''?null:Number(context.draft[field]);
    return {stationId:context.stationId,scenarioId:context.scenarioId,parameterId:context.parameterId,minimum:numeric('minimum'),maximum:numeric('maximum'),sampleCount:numeric('sampleCount')};
  }

  function freshnessHTML(context) {
    if(!captured)return '';
    const state=studyFreshness(captured.record,getProject(),getSource(),configFromDraft(context));
    const sourceText=state.sourceState==='current'?'ค่าฐานและหลักฐานของต้นทางยังตรงกับตอนคำนวณ':state.sourceState==='changed'?'ต้นทางมีค่าเปลี่ยนหลังคำนวณ · ผลที่เห็นยังเป็นชุดที่บันทึกไว้':'ไม่พบต้นทางชุดเดียวกันในโครงการที่เปิดอยู่ · กำลังอ่านผลจากข้อมูลที่บันทึกไว้';
    return '<div id="study-freshness" class="study-freshness" role="status" data-source-state="'+state.sourceState+'" data-config-state="'+state.configState+'"><strong>'+sourceText+'</strong><p>'+(state.configState==='changed'?'การตั้งค่าด้านซ้ายต่างจากชุดผลที่แสดง กด “คำนวณชุดทดลอง” เพื่อสร้างผลใหม่':'การตั้งค่าตรงกับชุดทดลองที่แสดง')+' · CSV / JSON / รายงาน ใช้ชุดผลที่บันทึกไว้นี้</p></div>';
  }

  function sourceAction(context) {
    return '<button type="button" class="text-button" id="study-open-source">'+(context.scenarioId==='current'?'เปิดค่าต้นทางของตัวแปรนี้ →':'เปิดทางเลือกที่เก็บไว้ →')+'</button>';
  }

  function setupHTML(context) {
    const {options,parameter,draft,alternatives}=context;
    return '<aside><form id="study-form" class="card study-setup"><span class="study-step"><b>01</b>ตั้งค่าชุดทดลอง</span><h3>เลือกฐาน แล้วเปลี่ยนหนึ่งค่า</h3><p class="study-source-id">'+escape(stationLabel(options.selection.station))+'<code>'+escape(options.scenarioRevision)+'</code></p>'
      +'<label class="study-field" for="study-scenario"><span>ใช้ข้อมูลชุดใดเป็นฐาน</span><select id="study-scenario"><option value="current"'+(context.scenarioId==='current'?' selected':'')+'>ค่าที่กำลังแก้</option>'+alternatives.map(item=>'<option value="'+escape(item.id)+'"'+(context.scenarioId===item.id?' selected':'')+'>'+escape(item.name)+' · ทางเลือกที่เก็บ</option>').join('')+'</select></label>'
      +'<label class="study-field" for="study-parameter"><span>ตัวแปรที่ต้องการทดลอง</span><select id="study-parameter">'+['soil','beam'].map(group=>'<optgroup label="'+escape(groupLabels[group])+'">'+options.parameters.filter(item=>item.group===group).map(item=>'<option value="'+escape(item.id)+'"'+(parameter.id===item.id?' selected':'')+'>'+escape(item.label)+' ('+escape(item.unit)+')</option>').join('')+'</optgroup>').join('')+'</select></label>'
      +'<div class="study-baseline-value"><span>ค่าฐานของตัวแปร</span><strong id="study-baseline-input" title="'+escape(exactValue(parameter.baselineValue))+'">'+escape(formatStudyValue(parameter.baselineValue))+' <small>'+escape(parameter.unit)+'</small></strong></div>'
      +'<div class="study-range-fields"><label class="study-field" for="study-min"><span>ค่าต่ำสุด<small>'+escape(parameter.unit)+'</small></span><input id="study-min" name="minimum" type="number" step="any" value="'+escape(draft.minimum)+'" required></label><label class="study-field" for="study-max"><span>ค่าสูงสุด<small>'+escape(parameter.unit)+'</small></span><input id="study-max" name="maximum" type="number" step="any" value="'+escape(draft.maximum)+'" required></label><label class="study-field study-count" for="study-count"><span>จำนวนจุด รวมปลายทั้งสอง<small>'+options.limits.minimumSamples+'–'+options.limits.maximumSamples+' จุด · ระยะห่างเท่ากัน</small></span><input id="study-count" name="sampleCount" type="number" min="'+options.limits.minimumSamples+'" max="'+options.limits.maximumSamples+'" step="1" value="'+escape(draft.sampleCount)+'" required></label></div>'
      +'<p class="study-range-note" id="study-range-note">'+rangeNote(context)+'</p><button type="submit" class="button primary study-run-button" id="run-study">คำนวณชุดทดลอง →</button><p class="study-run-help">ค่าทดลองเป็นสำเนาของฐาน ไม่เขียนทับค่าของสถานีหรือทางเลือกที่บันทึก</p><div class="study-source-action">'+sourceAction(context)+'</div></form>'
      +'<article class="card study-transfer"><h3>เก็บหรือเปิดชุดทดลอง</h3><p>ผลล่าสุดอยู่ในหน้านี้ ส่งออก JSON เพื่อเก็บข้อมูลฐานและช่วงทดลอง เปิดกลับได้โดยไม่เปลี่ยนโครงการที่กำลังทำงาน</p><div class="study-transfer-actions"><button type="button" class="button" id="import-study-json">เปิดชุดทดลอง JSON</button><button type="button" class="button" id="export-study-json"'+(captured?'':' disabled')+'>บันทึก JSON ↓</button><button type="button" class="button" id="export-study-csv"'+(captured?'':' disabled')+'>ผลทุกจุด CSV ↓</button><button type="button" class="button primary" id="report-study"'+(captured?'':' disabled')+'>รายงานชุดทดลอง ↗</button><input type="file" id="study-import-file" accept=".json,application/json" hidden></div>'+(captured?'<p style="margin-top:12px">ชุดที่ส่งออก <code>'+escape(captured.document.id)+'</code></p>':'')+'</article></aside>';
  }

  function rangeNote(context) {
    const {parameter,draft}=context;
    const bounds='ขอบเขตตัวเลขของโมดูล '+(parameter.minimumInclusive?'ตั้งแต่ ':'มากกว่า ')+escape(formatStudyValue(parameter.minimum))+' ถึง '+escape(formatStudyValue(parameter.maximum))+' '+escape(parameter.unit);
    return (draft.suggested?'ช่วงเริ่มต้นเป็นสมมติฐาน ±20% ของค่าฐานภายในขอบเขตตัวเลข ไม่ใช่ช่วงที่ยืนยันจากผลทดสอบ':parameter.suggestedRange===null?'ค่าฐานเป็นศูนย์หรือยังไม่ทราบ กรุณาระบุช่วงทดลองเองจากโจทย์ที่ต้องการศึกษา':'ช่วงที่ผู้ใช้กำหนด ใช้ศึกษาการเปลี่ยนทีละค่า')+'<br>'+bounds+' · เงื่อนไขร่วมของแต่ละจุดยังอาจทำให้คำนวณไม่ได้';
  }

  function emptyHTML() {
    return '<article class="study-empty"><p class="eyebrow">ONE QUESTION. A TRACEABLE EXPERIMENT.</p><h3>ค่าที่เปลี่ยนไป ส่งผลกับคำตอบแค่ไหน?</h3><p>กำหนดช่วงที่ต้องการศึกษาแล้วคำนวณทีเดียว เห็นผลทุกจุด เลือกอ่านสูตรการแทนค่า และเก็บชุดทดลองไว้เทียบกับข้อมูลที่ได้ภายหลัง</p><div class="study-empty-rules"><span><b>01</b>เปลี่ยนหนึ่งตัวแปร ค่าที่เหลือคงตามฐาน</span><span><b>02</b>แยกผลคำนวณได้ ข้อมูลขาด และเงื่อนไขที่ใช้ตรวจไม่ได้</span><span><b>03</b>กลับไปอ่านค่าตั้งต้นและสมการของทุกจุดได้</span></div></article>';
  }

  function evidenceHTML(record) {
    const groups=record.baselineEvidence?.groups||[];
    return '<section class="study-evidence"><h3>หลักฐานนี้เป็นของค่าฐานที่บันทึกไว้</h3><p>จุดทดลองเปลี่ยนตัวแปรเพื่อศึกษาผล จึงยังไม่ได้รับการยืนยันว่าค่าที่ทดลองมีฐานพารามิเตอร์หรือเหมาะกับสถานีนี้</p><div class="study-evidence-status">'+groups.map(group=>'<span data-study-evidence-state="'+escape(group.state)+'">'+(group.id==='soil'?'ดิน':'น้ำ')+' · '+escape(evidenceLabels[group.state]||group.state)+'</span>').join('')+'</div>'
      +'<p>เอกสารดิน: '+escape(record.baseline.scenario.context.boreholeReference||'ยังไม่ได้ระบุ')+'<br>เอกสารน้ำ: '+escape(record.baseline.scenario.context.waterReference||'ยังไม่ได้ระบุ')+'</p><p>ระดับน้ำในบริบทเป็นข้อมูลประกอบ ยังไม่ถูกแปลงเป็นแรงดันน้ำรูพรุนหรือการวิเคราะห์น้ำลดฉับพลันใน R2</p></section>';
  }

  function resultsHTML(context) {
    if(!captured)return emptyHTML();
    const {record,document,imported}=captured;
    if(!record.parameter.metricIds.includes(metricId))metricId=record.parameter.metricIds.find(id=>record.summaries[id].computedCount>0)||record.parameter.metricIds[0];
    if(!pointFor(record,pointId))pointId='baseline';
    const metric=metricFor(record,metricId),summary=record.summaries[metricId],baseline=cellFor(record.baseline,metricId);
    const unavailableCount=record.samples.length-summary.computedCount;
    return '<div id="study-results" data-run-id="'+escape(document.id)+'" data-study-revision="'+escape(record.studyRevision)+'" data-source-revision="'+escape(record.sourceRevision)+'" data-study-metric="'+escape(metricId)+'" data-study-point="'+escape(pointId)+'"><header class="study-result-head"><div><p class="eyebrow">02 / CAPTURED EXPERIMENT</p><h3>'+escape(record.parameter.label)+' · '+escape(formatStudyValue(record.config.minimum))+'–'+escape(formatStudyValue(record.config.maximum))+' '+escape(record.parameter.unit)+'</h3><p>'+escape(stationLabel(record.selection.station))+' · '+escape(record.selection.scenarioName)+'<br>'+escape(timestamp(document.createdAt))+'</p><code>'+escape(record.studyRevision)+'</code></div><span class="study-record-tag">'+(imported?'เปิดจากชุดทดลอง JSON':'ผลจากฐานที่บันทึก')+'</span></header>'+freshnessHTML(context)
      +'<article class="card study-chart-card"><div class="study-chart-toolbar"><div><h4>อ่านผลตามตัวแปรที่เปลี่ยน</h4><p>แกนนอน: '+escape(record.parameter.label)+' · แกนตั้ง: ผลลัพธ์ที่เลือก</p></div><label class="study-field study-metric-field" for="study-metric"><span>ผลลัพธ์ที่แสดง</span><select id="study-metric">'+record.parameter.metricIds.map(id=>{const item=metricFor(record,id);return '<option value="'+escape(id)+'"'+(id===metricId?' selected':'')+'>'+escape(item.label)+' ('+escape(item.unit)+')</option>';}).join('')+'</select></label></div>'
      +'<div class="study-summary"><article><small>ผลของค่าฐาน</small><strong>'+escape(available(baseline)?formatStudyValue(baseline.value):'—')+'</strong><em>'+escape(metric.unit)+' · '+escape(availabilityLabels[baseline.availability])+'</em></article><article><small>ต่ำสุด–สูงสุดในจุดที่คำนวณได้</small><strong>'+escape(summary.minimum?formatStudyValue(summary.minimum.value)+'–'+formatStudyValue(summary.maximum.value):'—')+'</strong><em>'+escape(metric.unit)+' · '+summary.computedCount+' จุดทดลอง</em></article><article><small>จุดที่ไม่มีผลของรายการนี้</small><strong class="study-unavailable-count">'+unavailableCount+' / '+record.samples.length+'</strong><em>ดูสถานะและเหตุผลรายจุด</em></article></div>'
      +studyChartHTML(record,metricId,{selectedPointId:pointId})+'<p class="study-chart-limit">ค่าที่ไม่ได้เลือกคงเดิม ผลแสดงเฉพาะจุดที่คำนวณ ไม่ค้นหาค่าที่เหมาะสมหรือรับรองแบบ ผลคานใช้กำลังที่ผ่านเงื่อนไขของโมดูล ส่วนผลดินแยกตามกลไกสมมติ</p></article>'
      +'<article class="card study-sample-card"><div class="study-sample-heading"><div><h3>ทุกจุดมีตัวเลขและที่มา</h3><p>เลือกแถวหรือจุดบนกราฟเพื่อดูค่าตั้งต้นและการแทนค่า</p></div><label class="study-field" for="study-point"><span>จุดที่ต้องการตรวจ</span><select id="study-point">'+[record.baseline,...record.samples].map(point=>'<option value="'+escape(point.id)+'"'+(point.id===pointId?' selected':'')+'>'+escape(pointLabel(point))+' · '+escape(formatStudyValue(point.x))+' '+escape(record.parameter.unit)+'</option>').join('')+'</select></label></div>'+studyTableHTML(record,metricId,{selectedPointId:pointId})+'</article>'
      +studyPointDetailHTML(record,metricId,pointId)+evidenceHTML(record)+'<details class="card study-limitations"><summary>วิธีทดลอง ขอบเขต และแหล่งสมการ</summary><div><ul>'+record.limitations.map(item=>'<li>'+escape(item)+'</li>').join('')+'</ul>'+Object.entries(ENGINEERING_REFERENCES).map(([key,item])=>'<p><a href="'+escape(item.url)+'" target="_blank" rel="noopener noreferrer">'+escape(item.title)+' ↗</a><br>'+escape(item.sections)+'</p>').join('')+'</div></details></div>';
  }

  function render() {
    const context=setupContext();
    if(!context){container.innerHTML='<p class="study-loading">กำลังเตรียมข้อมูลโครงการสำหรับชุดทดลอง…</p>';return;}
    rendered=context;
    container.dataset.stationId=context.stationId;container.dataset.scenarioId=context.scenarioId;
    container.innerHTML='<article class="study-intro"><div><p class="eyebrow">SENSITIVITY LAB / ONE PARAMETER AT A TIME</p><h2>ทดลองความไว · เปลี่ยนทีละค่า</h2><p>จับค่าฐานไว้ แล้วสำรวจว่าความลาด กำลังดิน หรือมิติคานที่เปลี่ยน ส่งผลต่อคำตอบอย่างไร พร้อมอ่านสูตรและเก็บผลทุกจุดกลับไปทบทวน</p></div><span><b>R2</b>คาน · ดิน · รูปตัดทฤษฎี</span></article>'+(errorMessage?'<div class="study-inline-error" id="study-error" role="alert">'+escape(errorMessage)+'</div>':'')+'<div class="study-workspace">'+setupHTML(context)+'<div id="study-output">'+resultsHTML(context)+'</div></div>';
    for(const point of container.querySelectorAll('svg [data-study-select-point]')){point.setAttribute('role','button');point.setAttribute('tabindex','0');}
  }

  function updateDraft(field,value) {
    if(!rendered)return;
    rendered.draft=drafts.set(rendered.draftKey,field,value,rendered.parameter.suggestedRange);
    container.querySelector('#study-range-note').innerHTML=rangeNote(rendered);
    if(captured)container.querySelector('#study-freshness').outerHTML=freshnessHTML(rendered);
  }

  function setPoint(id,{focus=false}={}) {
    if(!captured||!pointFor(captured.record,id))return;
    pointId=id;render();
    if(focus){const detail=container.querySelector('#study-point-detail');detail.focus({preventScroll:true});detail.scrollIntoView({block:'start',behavior:'smooth'});}
    else container.querySelector('#study-point')?.focus({preventScroll:true});
  }

  function fail(error) {
    errorMessage=error.message||String(error);render();onNotice(errorMessage,true);
  }

  container.addEventListener('input',event=>{
    if(['study-min','study-max','study-count'].includes(event.target.id))updateDraft(event.target.name,event.target.value);
  });
  container.addEventListener('submit',event=>{
    if(event.target.id!=='study-form')return;
    event.preventDefault();actionSequence++;
    try {
      const context=setupContext(),config=configFromDraft(context);
      if(['minimum','maximum','sampleCount'].some(field=>config[field]===null))throw new Error('กรอกค่าต่ำสุด ค่าสูงสุด และจำนวนจุดก่อนคำนวณชุดทดลอง');
      const result=createStudyDocument(getProject(),getSource(),config);
      captured={...result,imported:false};metricId=null;pointId='baseline';errorMessage='';render();
      onNotice('คำนวณชุดทดลอง '+result.record.samples.length+' จุดแล้ว · ค่าของโครงการและทางเลือกที่เก็บยังคงเดิม');
    } catch(error){fail(error);}
  });
  container.addEventListener('change',async event=>{
    const id=event.target.id;
    if(id==='study-scenario'){choices.set(getProject().selectedStationId,event.target.value);errorMessage='';render();container.querySelector('#study-scenario').focus();return;}
    if(id==='study-parameter'){parameterChoices.set(rendered.selectionKey,event.target.value);errorMessage='';render();container.querySelector('#study-parameter').focus();return;}
    if(id==='study-metric'){metricId=event.target.value;render();container.querySelector('#study-metric').focus({preventScroll:true});return;}
    if(id==='study-point'){setPoint(event.target.value);return;}
    if(id!=='study-import-file')return;
    const file=event.target.files?.[0];if(!file)return;
    const sequence=++actionSequence;
    try {
      if(file.size>STUDY_DOCUMENT_MAX_BYTES)throw new Error('ไฟล์ชุดทดลองมีขนาดเกินขอบเขตที่รองรับ');
      const text=await file.text();
      if(sequence!==actionSequence)return;
      const result=parseStudyDocument(text,getSource());
      captured={...result,imported:true};metricId=null;pointId='baseline';errorMessage='';render();
      onNotice('เปิดชุดทดลองที่บันทึกไว้แล้ว · โครงการที่กำลังทำงานยังคงเดิม');
    }catch(error){if(sequence===actionSequence)fail(error);}
  });
  container.addEventListener('keydown',event=>{
    const target=event.target.closest('svg [data-study-select-point]');
    if(target&&(event.key==='Enter'||event.key===' ')){event.preventDefault();setPoint(target.dataset.studySelectPoint,{focus:true});}
  });
  container.addEventListener('click',event=>{
    const point=event.target.closest('[data-study-select-point]');
    if(point){setPoint(point.dataset.studySelectPoint,{focus:true});return;}
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.id==='import-study-json'){container.querySelector('#study-import-file').click();return;}
    if(button.id==='study-open-source') {
      const parameter=rendered.parameter;
      onNavigate({stationId:rendered.stationId,scenarioId:rendered.scenarioId,target:{section:parameter.section==='geometry'?'model':parameter.group,field:parameter.field}});return;
    }
    if(!captured)return;
    const name='S6006-study-'+captured.record.selection.station.id+'-'+captured.document.id;
    try {
      if(button.id==='export-study-csv'){onDownload(name+'.csv',studyCSV(captured.record),'text/csv;charset=utf-8');onNotice('ส่งออกผลทุกจุดของชุดทดลองที่บันทึกแล้ว · รวมสถานะ เหตุผล ค่าตั้งต้น และผลต่าง');}
      if(button.id==='export-study-json'){onDownload(name+'.json',serializeStudyDocument(captured.document,getSource()),'application/json');onNotice('บันทึกชุดทดลอง JSON แล้ว · เปิดกลับเพื่อตรวจค่าฐานและช่วงทดลองเดิมได้');}
      if(button.id==='report-study')onReport({document:captured.document,metricId,pointId});
    }catch(error){fail(error);}
  });
  render();
  return {render};
}
