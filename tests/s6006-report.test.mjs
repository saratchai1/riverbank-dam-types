import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProject,selectStation,updateActiveScenario,getActiveScenario,getSoilInputs,projectRevision,scenarioRevision} from '../projects/s6006/project.js';
import {saveReportSnapshot,loadReportProject,saveWorkingProject} from '../projects/s6006/project-storage.js';
import {calculateSoil,calculateBeam} from '../projects/s6006/engineering.js';
import {calculateTypical} from '../projects/s6006/engine.js';
import {buildReportPages,renderReportPages,formatReportTimestamp,splitContextText} from '../projects/s6006/report.js';

const source=JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json',import.meta.url),'utf8'));
const format=(value,digits=3)=>Number(value).toLocaleString('en-US',{maximumFractionDigits:digits});
const page=(record,title)=>{
  const found=record.pages.find(item=>item.title===title);
  assert.ok(found,`Page exists: ${title}`);
  return found.body;
};
const snapshotArgs={mode:'snapshot',createdAt:'2026-11-21T08:00:00.000Z',snapshotToken:'report-test-0001'};
const store=()=>{
  const values=new Map();
  return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,value)};
};

test('direct report is an explicitly identified baseline with missing field context',()=>{
  const project=createProject(source),before=JSON.stringify(project),sourceBefore=JSON.stringify(source);
  const record=buildReportPages({project,source});
  assert.equal(record.pages.length,22);
  assert.equal(record.metadata.mode,'baseline');
  assert.equal(record.metadata.selectedStationId,'r1-row14');
  assert.equal(record.metadata.calculationRevision,'S6006-R2');
  assert.match(record.pages[0].body,/ค่าต้นแบบอ้างอิง/);
  assert.match(record.pages[0].body,/ยังไม่ได้ระบุ/);
  assert.match(record.pages[0].body,/ไม่ใช่ค่าปัจจุบันจากหน้าจอโครงการ/);
  assert.match(page(record,'รูปตัดและสมมติฐาน'),/ยังไม่มีระดับน้ำของสถานการณ์นี้/);
  assert.doesNotMatch(page(record,'รูปตัดและสมมติฐาน'),/99\.10|97\.30|87\.40/);
  assert.match(renderReportPages(record),/REFERENCE BASELINE/);
  assert.equal(JSON.stringify(project),before);
  assert.equal(JSON.stringify(source),sourceBefore);
});

test('saved report uses active geometry, derived soil slope, beam inputs and selected source row',()=>{
  let project=selectStation(createProject(source),'r2-row128',source);
  project=updateActiveScenario(project,{
    geometry:{slopeH:3.25,length:725.5,toeDepth:2.8},
    beamInputs:{tensionBarDiameterMm:16,externalMuKnM:30},
    soilInputs:{effectiveCohesionKpa:3,frictionAngleDeg:29},
    context:{waterHighLevel:100.2,waterLowLevel:88.5,groundwaterLevel:96.1,boreholeReference:'BH-2, matching to station pending'},
  },source);
  const record=buildReportPages({project,source,...snapshotArgs}),scenario=getActiveScenario(project);
  const geometry=calculateTypical(scenario.geometry),soil=calculateSoil(getSoilInputs(scenario)),beam=calculateBeam(scenario.beamInputs);
  assert.equal(record.metadata.stationLabel,'0+900');
  assert.equal(record.metadata.projectRevision,projectRevision(project));
  assert.equal(record.metadata.scenarioRevision,scenarioRevision(scenario));
  assert.match(record.pages[0].body,/r2-row128/);
  assert.match(record.pages[0].body,/725\.5/);
  assert.match(page(record,'รูปตัดและสมมติฐาน'),/3\.25H : 1V/);
  assert.match(page(record,'รูปตัดและสมมติฐาน'),/100\.20/);
  assert.ok(page(record,'รายการคำนวณรูปตัด').includes(format(geometry.rockVolume,4)));
  const engineering=record.pages.filter(item=>/^คาน BF1|^ดิน —/.test(item.title)).map(item=>item.body).join('');
  assert.match(engineering,/Mu = 30/);
  assert.match(engineering,/2\s*Ø16/);
  assert.ok(engineering.includes(format(beam.AsMm2,2)));
  assert.ok(engineering.includes(format(soil.cases[0].factorOfSafety,6)));
  assert.ok(engineering.includes(format(soil.cases[1].factorOfSafety,6)));
  const html=renderReportPages(record);
  assert.equal((html.match(/data-selected-station="r2-row128"/g)||[]).length,1);
  assert.match(page(record,'แถวต้นฉบับของสถานีที่เลือก'),/AI128/);
  assert.match(page(record,'แถวต้นฉบับของสถานีที่เลือก'),/ค่าตั้งต้นว่าง/);
  assert.match(page(record,'ยอดรวมและความครบถ้วน'),/40,985/);
  assert.match(page(record,'ยอดรวมและความครบถ้วน'),/ขอบเขตเดิม 1,000/);
  assert.match(page(record,'ข้อมูลดินและผลเสถียรภาพเดิม'),/ต้องวิเคราะห์ระบบและกรณีน้ำใหม่/);
  for(const value of ['3.378','2.588','2.164'])assert.ok(page(record,'ข้อมูลดินและผลเสถียรภาพเดิม').includes(value));
});

test('saved report remains tied to its snapshot after working project changes',()=>{
  const storage=store();
  let original=updateActiveScenario(createProject(source),{geometry:{slopeH:3,length:800}},source);
  const saved=saveReportSnapshot(original,source,storage,{id:snapshotArgs.snapshotToken,createdAt:snapshotArgs.createdAt});
  const search=saved.url.slice(saved.url.indexOf('?'));
  const before=buildReportPages({...loadReportProject({search,storage,source}),source,snapshotToken:snapshotArgs.snapshotToken});
  let later=selectStation(original,'r2-row132',source);
  later=updateActiveScenario(later,{geometry:{slopeH:4,length:450}},source);
  saveWorkingProject(later,source,storage);
  const after=buildReportPages({...loadReportProject({search,storage,source}),source,snapshotToken:snapshotArgs.snapshotToken});
  assert.deepEqual(after.metadata,before.metadata);
  assert.equal(page(after,'รายการคำนวณรูปตัด'),page(before,'รายการคำนวณรูปตัด'));
  assert.equal(after.metadata.projectRevision,projectRevision(original));
  assert.notEqual(after.metadata.projectRevision,projectRevision(later));
});

test('missing undrained Su prints an incomplete soil section without substituting baseline FS',()=>{
  const project=updateActiveScenario(createProject(source),{soilInputs:{mode:'undrained',undrainedStrengthKpa:null}},source);
  const record=buildReportPages({project,source,...snapshotArgs});
  assert.equal(record.pages.length,22);
  const soil=record.pages.filter(item=>/^ดิน —/.test(item.title)).map(item=>item.body).join('');
  assert.match(soil,/Su/);
  assert.match(soil,/ยังคำนวณไม่ได้/);
  assert.doesNotMatch(soil,/1\.562173|0\.796189/);
  const beam=record.pages.filter(item=>/^คาน BF1/.test(item.title)).map(item=>item.body).join('');
  assert.match(beam,/ยังใช้ตรวจไม่ได้/);
  assert.match(beam,/As/);
});

test('long context is escaped and fully preserved in bounded appendix chunks',()=>{
  const longReference='<script>alert("source")</script> '+('หลุมเจาะข้อมูล '.repeat(150)).slice(0,1850);
  const multiline=('line\n'.repeat(200))+'😀'.repeat(100);
  for(const value of [longReference,multiline]){
    const chunks=splitContextText(value);
    assert.equal(chunks.join(''),value);
    assert.ok(chunks.length>1);
    assert.ok(chunks.every(chunk=>Array.from(chunk).length<=900));
    assert.ok(chunks.every(chunk=>(chunk.match(/[\r\n]/g)||[]).length<=18));
    assert.ok(chunks.every(chunk=>!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(chunk)));
  }
  const project=updateActiveScenario(createProject(source),{context:{boreholeReference:longReference,waterReference:'แหล่งน้ำ '.repeat(240).slice(0,2000),sourceNote:multiline}},source);
  const record=buildReportPages({project,source,...snapshotArgs});
  assert.ok(record.pages.length>22);
  assert.match(record.pages[0].body,/ดูรายละเอียดบริบท/);
  const appendix=record.pages.filter(item=>item.title.startsWith('รายละเอียดบริบท'));
  assert.ok(appendix.length>=6);
  const html=renderReportPages(record);
  assert.ok(html.includes('&lt;script&gt;alert(&quot;source&quot;)&lt;/script&gt;'));
  assert.doesNotMatch(html,/<script>/);
  assert.ok(appendix.every(item=>item.body.includes('context-detail')));
});

test('snapshot identity and Bangkok time are stable and present on every report page',()=>{
  assert.equal(formatReportTimestamp(snapshotArgs.createdAt),'21/11/2569 15:00:00 (Asia/Bangkok, UTC+07:00)');
  assert.throws(()=>formatReportTimestamp('not-a-date'));
  const project=createProject(source),record=buildReportPages({project,source,...snapshotArgs});
  const html=renderReportPages(record);
  assert.equal((html.match(/<footer class="running-foot">/g)||[]).length,record.pages.length);
  assert.equal((html.match(/Scenario r1-row14:s6006s-/g)||[]).length,record.pages.length);
  assert.equal((html.match(/Asia\/Bangkok, UTC\+07:00/g)||[]).length,record.pages.length+1);
  assert.throws(()=>buildReportPages({project,source,mode:'snapshot',createdAt:snapshotArgs.createdAt}),/snapshot/);
});
