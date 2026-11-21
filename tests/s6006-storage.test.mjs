import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, updateActiveScenario, getActiveScenario, getSoilInputs, selectStation, stationCatalog, projectRevision } from '../projects/s6006/project.js';
import { saveWorkingProject, loadWorkingProject, saveReportSnapshot, loadReportProject, REPORT_SNAPSHOT_PREFIX, WORKING_PROJECT_KEY } from '../projects/s6006/project-storage.js';
import { calculateBeam, calculateSoil } from '../projects/s6006/engineering.js';
import { typicalSectionSVG, scenarioSectionOptions } from '../projects/s6006/visuals.js';

const source=JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json',import.meta.url),'utf8'));
const memory=()=>{const items=new Map();return {getItem:key=>items.get(key)??null,setItem:(key,value)=>items.set(key,value)};};
const snapshotOptions={id:'report-test-0001',createdAt:'2026-11-21T11:00:00.000Z'};
const report=(storage,search='?snapshot=report-test-0001')=>loadReportProject({source,storage,search});

test('working project restores selected station and accepted geometry, beam, soil and water inputs together',()=>{
  const storage=memory();
  assert.equal(loadWorkingProject(source,storage),null);
  let project=selectStation(createProject(source),stationCatalog(source)[4].id,source);
  project=updateActiveScenario(project,{geometry:{slopeH:3},beamInputs:{externalMuKnM:30},soilInputs:{frictionAngleDeg:35},context:{waterHighLevel:99.5,boreholeReference:'BH trial reference'}},source);
  saveWorkingProject(project,source,storage);
  assert.deepEqual(loadWorkingProject(source,storage).project,project);
  const scenario=getActiveScenario(project);
  assert.equal(getSoilInputs(scenario).slopeH,3);
  assert.ok(Math.abs(calculateSoil(getSoilInputs(scenario)).angleDegrees-Math.atan(1/3)*180/Math.PI)<1e-12);
  assert.equal(calculateBeam(scenario.beamInputs).usablePhiMnKnM,null,'Project persistence cannot remove the R2 minimum-steel gate');
});

test('an opened report snapshot remains unchanged after later edits, station selection and working-project saves',()=>{
  const storage=memory();
  let project=updateActiveScenario(createProject(source),{geometry:{slopeH:3.5},soilInputs:{frictionAngleDeg:34}},source);
  const original=structuredClone(project);
  const saved=saveReportSnapshot(project,source,storage,snapshotOptions);
  assert.equal(saved.url,'report.html?snapshot=report-test-0001');
  project=updateActiveScenario(project,{geometry:{slopeH:1.5},beamInputs:{externalMuKnM:90}},source);
  project=selectStation(project,stationCatalog(source)[2].id,source);
  saveWorkingProject(project,source,storage);
  const loaded=report(storage);
  assert.equal(loaded.mode,'snapshot');assert.equal(loaded.createdAt,snapshotOptions.createdAt);
  assert.deepEqual(loaded.project,original);
  assert.notEqual(projectRevision(project),projectRevision(loaded.project));
});

test('report snapshot preserves incomplete undrained input and cannot fabricate a soil result',()=>{
  const storage=memory();
  const project=updateActiveScenario(createProject(source),{soilInputs:{mode:'undrained',undrainedStrengthKpa:null}},source);
  saveReportSnapshot(project,source,storage,snapshotOptions);
  const inputs=getSoilInputs(getActiveScenario(report(storage).project));
  assert.equal(inputs.undrainedStrengthKpa,null);
  assert.throws(()=>calculateSoil(inputs),/Su|undrained/);
});

test('direct report is explicitly baseline; missing, malformed or corrupt requested snapshots never fall back',()=>{
  const storage=memory();
  assert.equal(report(storage,'').mode,'baseline');
  assert.throws(()=>report(storage),/ไม่พบสำเนา/);
  for(const search of ['?snapshot=','?snapshot=short','?snapshot=report-test-0001&snapshot=report-test-0002','?snapshot=..%2F..%2Fbad'])assert.throws(()=>report(storage,search),/ลิงก์/);
  storage.setItem(REPORT_SNAPSHOT_PREFIX+snapshotOptions.id,'{broken');
  assert.throws(()=>report(storage),/เสียหาย/);
});

test('changed snapshot revision or selected station is rejected before reporting',()=>{
  const storage=memory();
  saveReportSnapshot(createProject(source),source,storage,snapshotOptions);
  const key=REPORT_SNAPSHOT_PREFIX+snapshotOptions.id;
  const original=JSON.parse(storage.getItem(key));
  storage.setItem(key,JSON.stringify({...original,revision:'wrong-revision'}));
  assert.throws(()=>report(storage),/รุ่นข้อมูล/);
  original.project.selectedStationId=stationCatalog(source)[1].id;
  storage.setItem(key,JSON.stringify(original));
  assert.throws(()=>report(storage),/รุ่นข้อมูล/);
});

test('storage failure and snapshot collisions surface errors without replacing existing report data',()=>{
  const project=createProject(source),storage=memory();
  saveReportSnapshot(project,source,storage,snapshotOptions);
  const before=storage.getItem(REPORT_SNAPSHOT_PREFIX+snapshotOptions.id);
  assert.throws(()=>saveReportSnapshot(project,source,storage,snapshotOptions),/มีสำเนา/);
  assert.equal(storage.getItem(REPORT_SNAPSHOT_PREFIX+snapshotOptions.id),before);
  const blocked={getItem:()=>null,setItem:()=>{throw new Error('quota blocked');}};
  assert.throws(()=>saveReportSnapshot(project,source,blocked,snapshotOptions),/quota blocked/);
  assert.throws(()=>saveWorkingProject(project,source,blocked),/quota blocked/);
  storage.setItem(WORKING_PROJECT_KEY,'broken');
  assert.throws(()=>loadWorkingProject(source,storage));
});

test('scenario section draws only supplied water context and never substitutes original drawing levels',()=>{
  let project=createProject(source),scenario=getActiveScenario(project);
  let svg=typicalSectionSVG(scenario.geometry,scenarioSectionOptions(scenario));
  assert.doesNotMatch(svg,/data-water-key=/);
  assert.match(svg,/ยังไม่มีระดับน้ำ/);
  project=updateActiveScenario(project,{context:{waterHighLevel:98.5,groundwaterLevel:96,waterReference:'Trial context'}},source);
  scenario=getActiveScenario(project);svg=typicalSectionSVG(scenario.geometry,scenarioSectionOptions(scenario));
  assert.match(svg,/น้ำสูง 98\.50 \(บริบทผู้ใช้\)/);
  assert.match(svg,/data-water-key="groundwater"/);
  assert.doesNotMatch(svg,/data-water-key="low"|data-water-key="survey"|99\.10|87\.40/);
});
