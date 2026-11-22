import { inspectStudyDocument, loadStudySnapshot } from './study-storage.js';
import { studyChartSVG } from './study-ui.js';
import { STUDY_METHOD_REVISION } from './studies.js';
import { buildInvestigationAppendix } from './investigation-report.js';
import { ENGINEERING_REFERENCES } from './engineering.js';
import { SOURCE_FILES, sourceURL } from './case-data.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const sta = value => Math.floor(value / 1000) + '+' + String(value % 1000).padStart(3, '0');
const available = value => ({ computed:'คำนวณได้ในโมเดล', missing:'ข้อมูลไม่ครบ', gated:'ยังใช้เทียบแรงไม่ได้', 'not-applicable':'ไม่ใช้กรณีนี้', invalid:'อยู่นอกขอบเขต' }[value] || value);
const domainLabel = value => ({ geometry:'รูปตัดทฤษฎี', beam:'โครงสร้างคาน', soil:'ดินและกลไกลาด' }[value] || value);
const basisLabel = value => ({ missing:'ยังไม่มีบันทึก', incomplete:'ข้อมูลยังไม่ครบ', current:'ตรงกับค่าฐานที่ผูกไว้', stale:'มีค่าเปลี่ยน ต้องทบทวน' }[value] || value);
const checkLabel = value => ({ satisfied:'เป็นไปตามเงื่อนไขย่อย', review:'ต้องทบทวน', pending:'ยังสรุปไม่ได้', illustrative:'ตัวอย่าง/กลไกสมมติ', 'not-required':'ไม่ต้องใช้เงื่อนไขนี้' }[value] || value);
export const STUDY_REPORT_ROWS = 8;
export const STUDY_REPORT_TEXT_LIMIT = 700;
const INPUTS = {
  geometry: [
    ['length','ความยาวขยายรูปตัดทฤษฎี','m'],['crestLevel','ระดับสัน','m'],['toeLevel','ระดับตีน','m'],
    ['slopeH','ลาดร่วมรูปตัดและดิน','H : 1V'],['rockThickness','หินเรียงหนาตั้งฉากลาด','m'],
    ['sandMinThickness','ทรายขั้นต่ำหนาตั้งฉากลาด','m'],['walkwayWidth','ความกว้างทางเท้า','m'],
    ['toeTopWidth','ความกว้างบนตีนหินจำลอง','m'],['toeDepth','ความลึกตีนหินจำลอง','m'],['toeSlopeH','ลาดข้างตีนหินจำลอง','H : 1V'],
  ],
  beamInputs: [
    ['widthMm','ความกว้างคาน b','mm'],['heightMm','ความสูงคาน h','mm'],['coverMm','cover ถึงผิวนอกปลอก','mm'],
    ['tensionBarDiameterMm','เส้นผ่านศูนย์กลางเหล็กดึง','mm'],['tensionBarCount','จำนวนเหล็กดึงหนึ่งหน้า','เส้น'],
    ['stirrupDiameterMm','เส้นผ่านศูนย์กลางปลอก','mm'],['stirrupLegs','จำนวนขาปลอก','ขา'],['stirrupSpacingMm','ระยะปลอก s','mm'],
    ['fcKsc','กำลังคอนกรีตทรงกระบอก f′c','kgf/cm²'],['fyKsc','กำลังครากเหล็กดึง fy','kgf/cm²'],['fyvKsc','กำลังครากปลอก fyv','kgf/cm²'],
    ['concreteUnitWeightTfM3','น้ำหนักจำเพาะ ค.ส.ล.','tf/m³'],['spanM','ช่วงคานตัวอย่างรองรับง่าย','m'],['deadLoadFactor','ตัวคูณน้ำหนักตัวเอง','ตัวคูณ D'],
    ['externalMuKnM','Mu ออกแบบที่ป้อนแยก','kN·m'],['externalVuKn','Vu ออกแบบที่ป้อนแยก','kN'],
  ],
  soilInputs: [
    ['mode','ฐานกำลังดิน','effective / undrained'],['verticalDepthM','ความลึกแนวดิ่ง z','m'],
    ['unitWeightKnM3','น้ำหนักจำเพาะ γ กรณี u=0','kN/m³'],['saturatedUnitWeightKnM3','น้ำหนักจำเพาะอิ่มตัว γsat','kN/m³'],
    ['waterUnitWeightKnM3','น้ำหนักจำเพาะน้ำ γw','kN/m³'],['frictionAngleDeg','มุมเสียดทาน φ′','°'],
    ['effectiveCohesionKpa','แรงยึดเหนี่ยว c′','kPa'],['undrainedStrengthKpa','กำลังเฉือนไม่ระบายน้ำ Su','kPa'],
  ],
  context: [
    ['waterHighLevel','ระดับน้ำสูงที่บันทึก','m'],['waterLowLevel','ระดับน้ำต่ำที่บันทึก','m'],['groundwaterLevel','ระดับน้ำใต้ดินที่บันทึก','m'],
    ['boreholeReference','ที่มาดิน/หลุมเจาะ',''],['waterReference','ที่มาและระบบระดับน้ำ',''],['sourceNote','ที่มาของสถานการณ์/ข้อสมมติ',''],
  ],
};
const chunks = (rows, size = STUDY_REPORT_ROWS) => {
  const result=[]; for(let i=0;i<rows.length;i+=size)result.push(rows.slice(i,i+size)); return result;
};
const table = (headers, rows, className='') => '<div class="study-print-table-wrap"><table class="'+className+'"><thead><tr>'
  +headers.map(header=>'<th>'+header+'</th>').join('')+'</tr></thead><tbody>'
  +rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
function numeric(value) {
  if(value===null||value===undefined)return '—';
  if(typeof value!=='number'||!Number.isFinite(value))throw new RangeError('รายงานทดลองต้องมีเฉพาะค่าตัวเลขจำกัดหรือข้อมูลที่ขาด');
  return String(value);
}
export function splitStudyReportText(value) {
  if(typeof value!=='string')throw new TypeError('ข้อความประกอบต้องเป็น string');
  const result=[];let text='',count=0,lines=0;
  for(const character of value){
    if(count>=STUDY_REPORT_TEXT_LIMIT||(/[\r\n]/.test(character)&&lines>=12)){result.push(text);text='';count=0;lines=0;}
    text+=character;count++;if(/[\r\n]/.test(character))lines++;
  }
  if(text||!result.length)result.push(text);return result;
}
function timestamp(value) {
  if(typeof value!=='string'||value.length!==24||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new TypeError('เวลารายงานไม่ถูกต้อง');
  return new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value))+' (Asia/Bangkok)';
}

/** Recompute from a validated captured experiment; the selected view never changes its inputs. */
export function buildStudyReportPages({document,source,metricId,pointId,reportCreatedAt=document?.createdAt,snapshotToken=''}) {
  const {document:captured,record}=inspectStudyDocument(document,source);
  const metric=record.metricDefinitions.find(item=>item.id===metricId);
  const selected=[record.baseline,...record.samples].find(item=>item.id===pointId);
  if(!metric||!record.parameter.metricIds.includes(metricId)||!selected)throw new TypeError('ไม่พบผลลัพธ์หรือจุดที่เลือกในชุดทดลอง');
  const {station,scenarioId,scenarioName,kind}=record.selection;
  const metadata={studyRevision:record.studyRevision,projectRevision:record.projectRevision,sourceRevision:record.sourceRevision,
    calculationRevision:record.calculationRevision,createdAtDisplay:timestamp(captured.createdAt),
    reportCreatedAtDisplay:timestamp(reportCreatedAt),snapshotToken,station,scenarioId,metricId,pointId,sampleCount:record.samples.length};
  const pages=[],details=new Map();
  const literal=value=>{
    if(value===null||value===undefined||value==='')return '—';
    if(typeof value==='number')return esc(numeric(value));
    const text=String(value);
    if(Array.from(text).length>64||/[\r\n\t]/.test(text)){
      if(!details.has(text))details.set(text,'T'+(details.size+1));
      return esc(Array.from(text.replace(/\s+/g,' ').trim()).slice(0,35).join(''))+'… <b>['+details.get(text)+']</b>';
    }
    return esc(text);
  };
  const add=(title,body,kind='study',rowCount=0)=>pages.push({title,body,kind,rowCount});
  const pointName=point=>point.id==='baseline'?'ฐานก่อนทดลอง':point.id;
  const metricCell=cell=>'<strong class="study-print-number">'+esc(numeric(cell.value))+'</strong><span class="study-print-state">'+esc(available(cell.availability))+'</span>'
    +(cell.reason?'<small>'+literal(cell.reason)+'</small>':'');
  const sourceNotice='<p class="note">หลักฐานดินและน้ำในรายงานนี้เป็นของฐานก่อนทดลอง ค่าที่เปลี่ยนในแต่ละจุดเป็นสมมติฐานทดลอง ไม่ได้รับการยืนยันหรือผูกหลักฐานใหม่ให้อัตโนมัติ</p>';
  add('ขอบเขตชุดทดลอง','<p class="eyebrow">CONTROLLED SENSITIVITY / ONE INPUT AT A TIME</p><h1>รายงานทดลองความไว</h1>'
    +'<p class="lead">S6006 · ช่วง '+esc(station.reach)+' / STA '+sta(station.station)+'</p>'
    +table(['รายการ','ข้อมูลที่เก็บในชุดทดลอง'],[
      ['ชุดฐาน',literal(scenarioName)+'<small>'+esc(kind==='saved'?'ทางเลือกที่บันทึก':'ค่าปัจจุบัน ณ เวลาสร้างชุดทดลอง')+'</small>'],
      ['ตัวแปรที่เปลี่ยน',esc(record.parameter.label)+' <small>'+esc(record.parameter.id)+'</small>'],
      ['ช่วงทดลอง / จำนวนจุด',numeric(record.config.minimum)+' ถึง '+numeric(record.config.maximum)+' '+esc(record.parameter.unit)+' / '+record.samples.length+' จุด'],
      ['ค่าฐานของตัวแปร',numeric(record.baseline.x)+' '+esc(record.parameter.unit)],
      ['ผลลัพธ์ที่เลือกแสดงกราฟ',esc(metric.label)+' · '+esc(metric.unit)],
      ['จุดที่เปิดรายละเอียด',esc(pointName(selected))+' / '+numeric(selected.x)+' '+esc(record.parameter.unit)],
      ['เวลาสร้างชุดทดลอง',esc(metadata.createdAtDisplay)],
      ['เวลาสร้างรายงาน',esc(metadata.reportCreatedAtDisplay)],
    ],'study-print-identity')
    +'<p>เปลี่ยนค่าเดียวจากฐานที่เก็บไว้ ค่าที่ไม่ได้เลือกคงเดิม รวมถึง Mu/Vu ที่ผู้ใช้ป้อนแยกจากตัวอย่างน้ำหนักตัวเอง ผลต่ำสุด/สูงสุดระบุเฉพาะจุดที่คำนวณได้ ไม่ค้นหาค่าที่เหมาะสมหรือเกณฑ์อนุมัติแบบ</p>'+sourceNotice,'cover',8);
  const summary=record.summaries[metricId];
  const extremum=item=>item?numeric(item.value)+' '+esc(metric.unit)+'<small>'+esc(item.pointId)+' · '+numeric(item.x)+' '+esc(record.parameter.unit)+'</small>':'ไม่มีจุดที่คำนวณได้';
  add('กราฟและขอบเขตการอ่านผล','<h2>'+esc(metric.label)+'</h2><div class="study-print-chart">'
    +studyChartSVG(record,metricId,{selectedPointId:pointId,prefix:'study-report-chart'})+'</div>'
    +table(['ค่าฐาน','ต่ำสุดในจุดที่คำนวณได้','สูงสุดในจุดที่คำนวณได้'],[[metricCell(record.baseline.metrics[metricId]),extremum(summary.minimum),extremum(summary.maximum)]],'study-print-summary')
    +'<p>มีจุดที่คำนวณได้ '+summary.computedCount+' จาก '+record.samples.length+' จุด ช่องว่างบนกราฟรักษาผลที่ยังคำนวณหรือใช้เทียบไม่ได้ เส้นเชื่อมแสดงลำดับจุดทดลองเท่านั้น ไม่ยืนยันค่าระหว่างจุดหรือจุดตัดเกณฑ์</p>'
    +'<p>ตัวแปรฐานอาจอยู่นอกช่วงทดลองได้ โดยยังแสดงแยกจากจุดทดลอง ค่าเปอร์เซ็นต์ผลต่างไม่มีค่าหากฐานเป็นศูนย์หรือยังไม่มีผลคำนวณ</p>'+sourceNotice,'chart');
  const chosenRows=[record.baseline,...record.samples].map(point=>{
    const cell=point.metrics[metricId];
    return [esc(pointName(point))+(point.id===pointId?'<small>จุดที่เลือก</small>':''),numeric(point.x),metricCell(cell),numeric(cell.delta),numeric(cell.deltaPercent)];
  });
  chunks(chosenRows).forEach((rows,i)=>add('ตารางผลที่เลือก '+(i+1),'<h2>'+esc(metric.label)+' · ผลต่างจากฐาน</h2><p>'+esc(record.parameter.label)+' ('+esc(record.parameter.unit)+') · ผลลัพธ์ '+esc(metric.unit)+'</p>'
    +table(['จุด','ค่าตัวแปร','ผลและสถานะ','ผลต่าง','ผลต่าง %'],rows,'study-print-selected'),'selected-results',rows.length));
  for(const [section,fields] of Object.entries(INPUTS)){
    const group={geometry:'รูปตัด',beamInputs:'คาน',soilInputs:'ดิน',context:'บริบทและที่มา'}[section];
    const rows=fields.map(([field,label,unit])=>[esc(label)+'<small>'+esc(section+'.'+field)+'</small>',literal(record.baseline.scenario[section][field]),esc(unit)+(record.parameter.id===section+'.'+field?'<small>ตัวแปรที่ทดลองเปลี่ยน</small>':'')]);
    chunks(rows).forEach((part,i)=>add('ข้อมูลฐาน · '+group+' '+(i+1),'<h2>ข้อมูลฐานก่อนทดลอง · '+group+'</h2><p>ทุกจุดใช้ค่าชุดนี้ โดยเปลี่ยนเฉพาะ '+esc(record.parameter.label)+' ตามตารางจุดทดลอง</p>'+table(['ข้อมูล','ค่าฐาน','หน่วย / บทบาท'],part,'study-print-inputs'),'inputs',part.length));
  }
  // Every metric remains available in the report, including inactive/missing outputs.
  for(const [groupIndex,definitions] of chunks(record.metricDefinitions,3).entries()){
    const rows=[record.baseline,...record.samples].map(point=>[esc(pointName(point))+'<small>'+numeric(point.x)+' '+esc(record.parameter.unit)+'</small>',...definitions.map(definition=>metricCell(point.metrics[definition.id]))]);
    chunks(rows).forEach((part,i)=>add('ผลทุกกรณี · ชุด '+(groupIndex+1)+' หน้า '+(i+1),'<h2>ผลลัพธ์ทุกกรณี · ชุด '+(groupIndex+1)+' หน้า '+(i+1)+'</h2>'
      +'<p>แยกกรณีและหน่วยตามหัวตาราง ช่องที่ไม่ใช้หรือข้อมูลขาดยังแสดงตามสถานะจริง</p>'
      +table(['จุด / ค่าตัวแปร',...definitions.map(definition=>esc(definition.label)+'<small>'+esc(definition.unit)+'</small>')],part,'study-print-metrics'),'all-results',part.length));
  }
  add('จุดที่เลือกและข้อจำกัด','<h2>ตรวจจุด '+esc(pointName(selected))+'</h2>'
    +table(['รายการ','ค่าที่ใช้'],[['ตัวแปร',esc(record.parameter.label)],['ก่อนทดลอง',numeric(record.baseline.x)+' '+esc(record.parameter.unit)],['จุดที่เลือก',numeric(selected.x)+' '+esc(record.parameter.unit)],['รุ่นสถานการณ์',selected.scenarioRevision?esc(selected.scenarioRevision):'จุดอยู่นอกขอบเขตสถานการณ์ · ระบุด้วยรุ่นชุดทดลองและรหัสจุดแทน']],'study-print-identity')
    +'<p>ข้อมูลอื่นทั้งหมดเหมือนตารางฐานก่อนทดลอง สูตรต่อไปนี้เป็นของจุดที่เลือกเพียงจุดเดียว</p>'
    +(selected.errors.length?table(['หมวด','สถานะ / เหตุผล'],selected.errors.map(item=>[esc(domainLabel(item.domain)),esc(available(item.availability))+'<small>'+literal(item.message)+'</small>'])):'<p>ตัวตรวจขอบเขตย่อยไม่มีข้อผิดพลาดของข้อมูลในจุดนี้ ยังต้องอ่านเงื่อนไขกำลังและขอบเขตของแต่ละโมดูล</p>')+sourceNotice,'point');
  for(const domain of ['geometry','beam','soil']){
    const result=selected.results[domain];
    if(!result){add('สูตร · '+domainLabel(domain),'<h2>'+domainLabel(domain)+' · จุดที่เลือก</h2><p>ไม่มีผลสูตรในหมวดนี้ อ่านเหตุผลของจุดที่เลือกและตารางสถานะ ไม่แทนผลที่ขาดด้วยศูนย์</p>','formulas');continue;}
    const rows=(result.formulaRows||[]).map(row=>[esc(row.label),'<span class="study-print-formula">'+esc(row.formula)+'</span><small>'+esc(row.substitution)+'</small>'+(row.assumption?'<small>'+literal(row.assumption)+'</small>':''),numeric(row.value)+'<small>'+esc(row.unit)+'</small>',esc(row.sourceKey||'S6006 geometry')]);
    chunks(rows,4).forEach((part,i)=>add('สูตร · '+domainLabel(domain)+' '+(i+1),'<h2>สูตรของจุดที่เลือก · '+domainLabel(domain)+'</h2>'+table(['รายการ','สูตร / การแทนค่า','ผล / หน่วย','อ้างอิง'],part,'study-print-formulas'),'formulas',part.length));
    const checks=(result.checks||[]).map(check=>[esc(check.label),esc(checkLabel(check.status)),numeric(check.value)+(check.limit===null||check.limit===undefined?'':'<small>เกณฑ์ย่อย '+numeric(check.limit)+'</small>'),literal(check.note||'')]);
    chunks(checks,5).forEach((part,i)=>add('เงื่อนไข · '+domainLabel(domain)+' '+(i+1),'<h2>เงื่อนไขของจุดที่เลือก · '+domainLabel(domain)+'</h2>'+table(['เงื่อนไข','สถานะ','ค่า / เกณฑ์','คำอธิบาย'],part,'study-print-checks'),'checks',part.length));
    for(const list of chunks(result.warnings||[],4))add('ขอบเขต · '+domainLabel(domain),'<h2>ขอบเขตของ '+domainLabel(domain)+'</h2><ul>'+list.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul>','limitations');
  }
  const evidenceRows=record.baselineEvidence.groups.map(group=>[esc(group.id==='soil'?'ดิน':'น้ำ'),esc(basisLabel(group.state)),group.binding?esc(timestamp(group.binding.recordedAt)):'ยังไม่ได้ผูก']);
  add('ฐานอ้างอิงก่อนทดลอง','<h2>หลักฐานของฐานก่อนทดลอง</h2>'+sourceNotice+table(['หมวด','สถานะของฐาน','เวลาที่ผูกฐาน'],evidenceRows)
    +'<p>สถานะเหล่านี้อธิบายชุดฐานที่เก็บไว้เท่านั้น การมีค่าทดลองที่คำนวณได้ไม่ทำให้ข้อมูลตัวอย่าง วิธีทดสอบ ระบบระดับ หรือความสัมพันธ์ของหลุมเจาะกับสถานีได้รับการยืนยัน</p>'
    +'<p>ไฟล์ชุดทดลองเก็บโครงการและช่วงทดลองเพื่อคำนวณซ้ำด้วยรุ่นสมการที่ระบุ ค่า checksum ใช้ตรวจความสอดคล้องของไฟล์ ไม่ใช่ลายเซ็นรับรองผู้จัดทำหรือความแท้ของเอกสาร</p>','basis',evidenceRows.length);
  for(const list of chunks(record.limitations,4))add('ข้อจำกัดชุดทดลอง','<h2>ขอบเขตการใช้ชุดทดลอง</h2><ul>'+list.map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul>','limitations');
  const references=[...Object.entries(ENGINEERING_REFERENCES).map(([key,item])=>({key,title:item.title,url:item.url,location:item.sections})),...SOURCE_FILES.slice(0,3).map(item=>({...item,url:sourceURL(item.key)}))];
  chunks(references,3).forEach((list,i)=>add('เอกสารและฐานสมการ '+(i+1),'<h2>เอกสารและฐานสมการ</h2>'+table(['รหัส / เอกสาร','ตำแหน่งอ้างอิง'],list.map(item=>['<b>'+esc(item.key)+'</b><br><a href="'+esc(item.url)+'">'+esc(item.title)+'</a>',esc(item.location)]),'study-print-sources')
    +'<p>ใช้สมการและขอบเขตของ '+esc(record.calculationRevision)+' ตามเดิม การทดลองนี้ไม่เลือกมาตรฐานใหม่หรือแปลงผลวิเคราะห์ Slope/W เดิมเป็นผลของจุดทดลอง</p>','sources',list.length));
  const appendix=buildInvestigationAppendix({project:captured.project,source,entries:[{stationId:station.id,scenarioId}]});
  for(const page of appendix)pages.push({...page,title:'ฐานก่อนทดลอง · '+page.title,body:'<p class="study-basis-heading">ภาคผนวกนี้เป็นของฐานก่อนทดลองเท่านั้น · ไม่ยืนยันค่าทดลอง</p>'+page.body});
  const textParts=[];
  for(const [value,id] of details)splitStudyReportText(value).forEach((text,index)=>textParts.push({id,part:index+1,text}));
  let group=[],cost=0;
  const flush=()=>{if(!group.length)return;add('ข้อความเต็มและเหตุผล '+(pages.filter(page=>page.kind==='detail').length+1),'<h2>ข้อความเต็มและเหตุผลอ้างอิง</h2>'+group.map(item=>'<h3>['+item.id+'] ส่วน '+item.part+'</h3><div class="study-print-literal">'+esc(item.text)+'</div>').join(''),'detail',group.length);group=[];cost=0;};
  for(const item of textParts){const lines=Math.ceil(Array.from(item.text).length/75)+(item.text.match(/[\r\n]/g)||[]).length+5;if(group.length&&(group.length>=4||cost+lines>32))flush();group.push(item);cost+=lines;}flush();
  return {pages,metadata,record};
}

export function renderStudyReportPages({pages,metadata}) {
  return pages.map((page,index)=>'<section class="report-page study-print-page" data-page-title="'+esc(page.title)+'" data-page-kind="'+esc(page.kind)+'" data-row-count="'+page.rowCount+'">'
    +'<header class="running-head"><span>S6006 · STA '+sta(metadata.station.station)+' · SENSITIVITY STUDY</span><span>'+esc(metadata.calculationRevision)+'</span></header>'+page.body
    +'<footer class="running-foot"><div class="foot-context"><span>'+esc(metadata.studyRevision)+' · '+esc(STUDY_METHOD_REVISION)+'</span><span>'+esc(metadata.projectRevision)+' · '+esc(metadata.sourceRevision)+'</span><span>'+esc(metadata.createdAtDisplay)+'</span></div>'
    +'<div class="foot-page"><span>'+esc(page.title)+'</span><strong>'+String(index+1).padStart(2,'0')+' / '+pages.length+'</strong></div></footer></section>').join('');
}

export async function mountStudyReport({document:doc=globalThis.document,window:view=globalThis.window}={}) {
  const host=doc.querySelector('#study-report-ready'),errorBox=doc.querySelector('#study-report-error'),status=doc.querySelector('#study-report-status'),printButton=doc.querySelector('#print-study-report');
  const fail=error=>{
    host.replaceChildren();host.dataset.ready='false';host.dataset.error='true';host.setAttribute('aria-busy','false');
    doc.body.dataset.reportState='blocked';printButton.disabled=true;errorBox.hidden=false;status.textContent='สำเนาชุดทดลองยังไม่พร้อมพิมพ์';
    errorBox.innerHTML='<h1>ยังพิมพ์รายงานทดลองนี้ไม่ได้</h1><p>'+esc(error?.message||'ไม่สามารถอ่านข้อมูลชุดทดลอง')+'</p><p>กรุณาเปิดไฟล์ชุดทดลองเดิมในแท็บ 10 แล้วสร้างรายงานใหม่ ไม่มีการแทนผลด้วยโครงการปัจจุบันหรือค่าต้นแบบ</p><a href="index.html">กลับโครงการ S6006</a>';
  };
  printButton.disabled=true;doc.body.dataset.reportState='loading';
  printButton.addEventListener('click',()=>{if(host.dataset.ready==='true')view.print();});
  view.addEventListener('beforeprint',()=>{if(host.dataset.ready!=='true')fail(new Error('ข้อมูลชุดทดลองยังไม่ได้ผ่านการตรวจสำเนา'));});
  try{
    const response=await view.fetch('source-data.json');if(!response.ok)throw new Error('อ่านข้อมูลอ้างอิง S6006 ไม่สำเร็จ');
    const source=await response.json(),resolved=loadStudySnapshot({search:view.location.search,storage:view.localStorage,source});
    const model=buildStudyReportPages({...resolved,source,snapshotToken:new URLSearchParams(view.location.search).get('snapshot')});
    host.innerHTML=renderStudyReportPages(model);
    Object.assign(host.dataset,{studyRevision:model.metadata.studyRevision,projectRevision:model.metadata.projectRevision,sourceRevision:model.metadata.sourceRevision,
      stationId:model.metadata.station.id,scenarioId:model.metadata.scenarioId,metricId:model.metadata.metricId,pointId:model.metadata.pointId,sampleCount:String(model.metadata.sampleCount)});
    if(doc.fonts?.ready)await doc.fonts.ready;
    host.dataset.ready='true';host.dataset.error='false';host.setAttribute('aria-busy','false');errorBox.hidden=true;doc.body.dataset.reportState='ready';printButton.disabled=false;
    status.textContent='S6006 / ชุดทดลอง '+model.metadata.sampleCount+' จุด · STA '+sta(model.metadata.station.station);
    doc.title='S6006 · ทดลองความไว · STA '+sta(model.metadata.station.station);return model;
  }catch(error){fail(error);return null;}
}
if(typeof document!=='undefined'&&typeof window!=='undefined'&&document.querySelector('#study-report-ready'))mountStudyReport();
