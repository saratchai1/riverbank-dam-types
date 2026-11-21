import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProject,updateActiveScenario,saveAlternative,selectStation,projectRevision,getActiveScenario,serializeProject,parseProject} from '../projects/s6006/project.js';
import {DEFAULT_SOIL_INVESTIGATION_METADATA,DEFAULT_WATER_INVESTIGATION_METADATA,saveInvestigationMetadata,captureInvestigation,getStationInvestigations} from '../projects/s6006/investigations.js';
import {buildInvestigationAppendix,splitInvestigationText,INVESTIGATION_REPORT_ROWS} from '../projects/s6006/investigation-report.js';
import {buildReportPages} from '../projects/s6006/report.js';
import {buildComparisonReportPages} from '../projects/s6006/comparison-report.js';
import {buildReviewReportPages} from '../projects/s6006/review-report.js';
import {saveReportSnapshot,loadReportProject,REPORT_SNAPSHOT_PREFIX} from '../projects/s6006/project-storage.js';
import {saveComparisonSnapshot,loadComparisonProject,COMPARISON_SNAPSHOT_PREFIX} from '../projects/s6006/comparison-storage.js';
import {saveReviewSnapshot,loadReviewProject,REVIEW_SNAPSHOT_PREFIX} from '../projects/s6006/review-storage.js';

const source=JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json',import.meta.url),'utf8'));
const first='r1-row14',second='r1-row15',createdAt='2026-11-22T03:00:00.000Z',id='investigation-fixture';
const reportArgs={createdAt,snapshotToken:id};
const selection={stationId:first,kind:'all',focus:'all'};
const current=[{stationId:first,scenarioId:'current'}];
const soilMetadata={...DEFAULT_SOIL_INVESTIGATION_METADATA,boreholeId:'BH-1',documentRevision:'SYNTHETIC',locator:'PDF 4 / 12',sampleDepthFromM:0,sampleDepthToM:2,depthReference:'TEST depth reference',testMethod:'Synthetic test method',parameterInterpretation:'Test assumptions only',applicabilityNote:'Synthetic relationship, not an actual design',notes:'fixture soil'};
const waterMetadata={...DEFAULT_WATER_INVESTIGATION_METADATA,locator:'TEST water record',datum:'SYNTHETIC datum',observationText:'Synthetic design case',applicabilityNote:'TEST applicability only',notes:'fixture water'};
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
const html=record=>record.pages.map(page=>page.body).join('\n');
const appendix=project=>buildInvestigationAppendix({project,source,entries:current});
function fixture(){
  let project=updateActiveScenario(createProject(source),{context:{boreholeReference:'TEST source BH-1',waterReference:'TEST water document',waterHighLevel:0,waterLowLevel:0,groundwaterLevel:0}},source);
  for(const [kind,metadata] of [['soil',soilMetadata],['water',waterMetadata]]){
    project=saveInvestigationMetadata(project,kind,metadata,source);
    project=captureInvestigation(project,kind,source,{createdAt});
  }
  return project;
}
function reportSet(project){
  return [
    buildReportPages({project,source,mode:'snapshot',...reportArgs}),
    buildComparisonReportPages({project,source,...reportArgs}),
    buildReviewReportPages({project,source,selection,...reportArgs}),
  ];
}

test('investigation appendices leave native legacy reports unchanged when the scope has no records',()=>{
  const v2=createProject(source),v1={...v2,version:1};delete v1.stationComparisons;
  assert.deepEqual(appendix(v1),[]);assert.deepEqual(appendix(v2),[]);
  let project=fixture();project=selectStation(project,second,source);
  assert.deepEqual(buildInvestigationAppendix({project,source,entries:[{stationId:second,scenarioId:'current'}]}),[]);
  assert.throws(()=>buildInvestigationAppendix({project,source,entries:[]}),/ขอบเขต|ระบุ/);
  assert.throws(()=>buildInvestigationAppendix({project,source,entries:[...current,...current]}),/ซ้ำ/);
});

test('current, comparison and review reports include frozen native v3 basis with independent current/saved states',()=>{
  let project=saveAlternative(fixture(),'A source basis',source,{id:'basis-a',createdAt});
  project=updateActiveScenario(project,{geometry:{slopeH:3},context:{groundwaterLevel:1e-8}},source);
  const soil={...getStationInvestigations(project).soil.metadata,notes:'CURRENT_NEW_METADATA'};
  project=saveInvestigationMetadata(project,'soil',soil,source);
  const [single,comparison,review]=reportSet(project);
  for(const record of [single,comparison,review]){
    assert.match(html(record),/data-investigation-state="stale"/);
    assert.match(html(record),/CURRENT_NEW_METADATA/);
    assert.match(html(record),/1e-8/);
    assert.ok(record.pages.filter(page=>page.kind==='investigation').every(page=>page.rowCount<=INVESTIGATION_REPORT_ROWS));
  }
  assert.doesNotMatch(html(single),/data-investigation-entry-key="r1-row14\/basis-a"/);
  for(const record of [comparison,review]){
    assert.match(html(record),/data-investigation-entry-key="r1-row14\/basis-a"[^>]*data-investigation-state="current"/);
    assert.match(html(record),/fixture soil/);
  }
});

test('filtered review appendix includes only selected entries and never borrows another station basis',()=>{
  let project=saveAlternative(fixture(),'A original',source,{id:'basis-a',createdAt});
  project=updateActiveScenario(project,{geometry:{slopeH:3.5},beamInputs:{tensionBarDiameterMm:16,stirrupDiameterMm:8,externalMuKnM:30,externalVuKn:50}},source);
  project=saveAlternative(project,'B improved test',source,{id:'basis-b',createdAt});
  project=saveInvestigationMetadata(project,'soil',{...soilMetadata,notes:'CURRENT_ONLY_SECRET_SCOPE'},source);
  project=selectStation(project,second,source);
  project=saveInvestigationMetadata(project,'soil',{...soilMetadata,notes:'SECOND_STATION_EXCLUDED_SCOPE'},source);
  project=selectStation(project,first,source);
  const report=buildReviewReportPages({project,source,selection:{stationId:first,kind:'saved',focus:'attention'},...reportArgs});
  assert.equal(report.metadata.entryCount,1);
  assert.match(html(report),/r1-row14\/basis-a/);
  assert.doesNotMatch(html(report),/data-investigation-entry-key="r1-row14\/basis-b"|CURRENT_ONLY_SECRET_SCOPE|SECOND_STATION_EXCLUDED_SCOPE/);
});

test('snapshot loaders preserve native v3 investigation records and reject altered basis in all report types',()=>{
  const project=saveAlternative(fixture(),'A basis',source,{id:'basis-a',createdAt});
  const storage=memory(),options={id,createdAt};
  const definitions=[
    [REPORT_SNAPSHOT_PREFIX,()=>saveReportSnapshot(project,source,storage,options),()=>loadReportProject({search:'?snapshot='+id,storage,source})],
    [COMPARISON_SNAPSHOT_PREFIX,()=>saveComparisonSnapshot(project,source,storage,options),()=>loadComparisonProject({search:'?snapshot='+id,storage,source})],
    [REVIEW_SNAPSHOT_PREFIX,()=>saveReviewSnapshot(project,source,storage,selection,options),()=>loadReviewProject({search:'?snapshot='+id,storage,source})],
  ];
  for(const [prefix,save,load] of definitions){
    save();const original=storage.getItem(prefix+id);
    assert.deepEqual(load().project,project);
    const changed=saveInvestigationMetadata(project,'soil',{...soilMetadata,notes:'later edit'},source);
    assert.notEqual(projectRevision(changed),projectRevision(project));
    assert.deepEqual(load().project,project);
    const corrupt=JSON.parse(original);corrupt.project.stationInvestigations[first].current.soil.metadata.notes='tampered';
    storage.setItem(prefix+id,JSON.stringify(corrupt));assert.throws(load);
    storage.setItem(prefix+id,original);
  }
});

test('native v2 snapshots survive later v3 evidence writes without changing legacy fingerprints',()=>{
  const project=saveAlternative(createProject(source),'A legacy',source,{id:'legacy-a',createdAt});
  const storage=memory();saveReportSnapshot(project,source,storage,{id,createdAt});saveComparisonSnapshot(project,source,storage,{id,createdAt});saveReviewSnapshot(project,source,storage,selection,{id,createdAt});
  const revision=projectRevision(project),text=serializeProject(project,source);
  const upgraded=saveInvestigationMetadata(project,'soil',soilMetadata,source);
  assert.equal(upgraded.version,3);assert.equal(project.version,2);
  for(const load of [loadReportProject,loadComparisonProject,loadReviewProject]){
    const restored=load({search:'?snapshot='+id,storage,source}).project;
    assert.equal(projectRevision(restored),revision);assert.equal(serializeProject(restored,source),text);
  }
  assert.equal(parseProject(text,source).migrated,false);
});

test('long metadata and captured text survive complete escaped pagination including metadata changes',()=>{
  let project=fixture();
  const firstText='<script>not-code</script>\n'+'อ้างอิงค่าดินและน้ำ '.repeat(70)+' END_ORIGINAL_BASIS';
  const secondText='constructor __proto__ effective undrained\n'+'ทบทวนเอกสาร\n'.repeat(70)+' END_UPDATED_BASIS';
  project=saveInvestigationMetadata(project,'soil',{...soilMetadata,notes:firstText},source);
  project=captureInvestigation(project,'soil',source,{createdAt});
  project=saveInvestigationMetadata(project,'soil',{...soilMetadata,notes:secondText},source);
  const pages=appendix(project),body=pages.map(page=>page.body).join('\n');
  assert.match(body,/END_ORIGINAL_BASIS/);assert.match(body,/END_UPDATED_BASIS/);
  assert.match(body,/&lt;script&gt;not-code&lt;\/script&gt;/);assert.doesNotMatch(body,/<script>/);
  assert.match(body,/constructor __proto__ effective undrained/);
  for(const value of [firstText,secondText])assert.equal(splitInvestigationText(value).join(''),value);
});

test('source W.L. blanks remain unknown and borehole catalogue links do not inject levels or material parameters',()=>{
  let project=fixture();const scenario=getActiveScenario(project);
  project=saveInvestigationMetadata(project,'soil',{...soilMetadata,boreholeId:'BH-7'},source);
  assert.deepEqual(getActiveScenario(project),scenario);
  const body=appendix(project).map(page=>page.body).join('\n');
  assert.match(body,/BH-7/);assert.match(body,/ช่องว่างในต้นฉบับ · ไม่ทราบ/);
  assert.match(body,/PDF หน้า 10 \/ 15/);
  assert.match(body,/BH-1/); // The old captured source is preserved alongside the changed one.
  assert.match(body,/data-investigation-source-role="current">BH-7[^<]*<\/h3><p>รหัสในข้อมูลอ้างอิงของ snapshot/);
  assert.match(body,/data-investigation-source-role=" bound">BH-1[^<]*<\/h3><p>รหัสตอนผูกฐานเดิม/);
  assert.match(body,/S6006-INVESTIGATIONS-1/);
  assert.match(body,/5fe3eaf702d24d090fc51a502d19378b2c60584dde1e0e13669590340a1462f3/);
});
