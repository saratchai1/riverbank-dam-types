import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProject,updateActiveScenario,saveAlternative,selectStation,serializeProject} from '../projects/s6006/project.js';
import {saveInvestigationMetadata,captureInvestigation,DEFAULT_SOIL_INVESTIGATION_METADATA,DEFAULT_WATER_INVESTIGATION_METADATA} from '../projects/s6006/investigations.js';
import {createStudyDocument} from '../projects/s6006/study-storage.js';
import {buildStudyReportPages,renderStudyReportPages,splitStudyReportText,STUDY_REPORT_TEXT_LIMIT} from '../projects/s6006/study-report.js';

const source=JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json',import.meta.url),'utf8'));
const stamp='2026-11-22T01:00:00.000Z';
const spec={stationId:'r1-row14',scenarioId:'current',parameterId:'geometry.slopeH',minimum:1.5,maximum:4,sampleCount:7};
const create=(project=createProject(source),config=spec)=>createStudyDocument(project,source,config,{id:'study-report-fixture',createdAt:stamp});
const report=(document,metricId='soil.dry.fs',pointId='sample-3')=>buildStudyReportPages({document,source,metricId,pointId,reportCreatedAt:stamp,snapshotToken:'report-fixture'});
const html=model=>renderStudyReportPages(model);
function basisProject(){
  let p=updateActiveScenario(createProject(source),{context:{boreholeReference:'SYNTHETIC_BH1',waterReference:'SYNTHETIC_WATER',waterHighLevel:0,waterLowLevel:0,groundwaterLevel:1e-8}},source);
  const soil={...DEFAULT_SOIL_INVESTIGATION_METADATA,boreholeId:'BH-1',locator:'SYNTHETIC p4/12',sampleDepthFromM:0,sampleDepthToM:2,depthReference:'SYNTHETIC ground',testMethod:'SYNTHETIC method',parameterInterpretation:'SYNTHETIC effective interpretation',applicabilityNote:'SYNTHETIC station applicability'};
  const water={...DEFAULT_WATER_INVESTIGATION_METADATA,locator:'SYNTHETIC table',datum:'SYNTHETIC datum',observationText:'SYNTHETIC time',applicabilityNote:'SYNTHETIC station applicability'};
  for(const [kind,metadata] of [['soil',soil],['water',water]]){p=saveInvestigationMetadata(p,kind,metadata,source);p=captureInvestigation(p,kind,source,{createdAt:stamp});}
  return p;
}

test('study report contains every sampled metric, full base inputs and selected formula substitutions',()=>{
  const created=create(),model=report(created.document),text=html(model),point=created.record.samples[2];
  assert.equal(model.metadata.sampleCount,7);assert.equal(model.metadata.pointId,point.id);
  for(const metric of created.record.metricDefinitions)assert.ok(text.includes(metric.label));
  for(const sample of created.record.samples)assert.ok(text.includes(sample.id));
  assert.ok(text.includes('externalMuKnM'));assert.ok(text.includes('groundwaterLevel'));
  assert.ok(text.includes(String(point.results.soil.cases[0].factorOfSafety)));
  assert.ok(text.includes('สูตรของจุดที่เลือก'));assert.ok(text.includes('S6006-R2'));
  assert.ok(text.includes('USACE-1902'));assert.ok(text.includes('SP-LEGACY-BEAM'));
  assert.ok(model.pages.filter(p=>p.kind==='all-results').every(p=>p.rowCount<=8));
  assert.ok(model.pages.filter(p=>p.kind==='formulas').every(p=>p.rowCount<=4));
});

test('study report includes only captured baseline evidence, without endorsing trial points',()=>{
  let p=basisProject();p=saveAlternative(p,'A base evidence',source,{id:'basis-a',createdAt:stamp});
  p=selectStation(p,'r1-row15',source);p=saveInvestigationMetadata(p,'soil',{...DEFAULT_SOIL_INVESTIGATION_METADATA,notes:'EXCLUDED_STATION'},source);
  p=selectStation(p,'r1-row14',source);
  const before=serializeProject(p,source),created=create(p,{...spec,scenarioId:'basis-a'}),model=report(created.document),text=html(model);
  assert.equal(serializeProject(p,source),before);
  assert.ok(text.includes('ภาคผนวกนี้เป็นของฐานก่อนทดลองเท่านั้น'));
  assert.ok(text.includes('r1-row14/basis-a'));assert.ok(!text.includes('EXCLUDED_STATION'));
  assert.ok(!text.includes('r1-row15/current'));
  assert.ok(text.includes('1e-8'));assert.ok(text.includes('BH-1'));
  assert.equal(model.record.baselineEvidence.groups[0].state,'current');
  assert.notEqual(model.record.samples[2].scenario.geometry.slopeH,model.record.baseline.scenario.geometry.slopeH);
});

test('missing Su baseline, real zero trial and unavailable percentage remain distinct in print',()=>{
  const p=updateActiveScenario(createProject(source),{soilInputs:{mode:'undrained',undrainedStrengthKpa:null,frictionAngleDeg:null,effectiveCohesionKpa:null}},source);
  const created=create(p,{...spec,parameterId:'soilInputs.undrainedStrengthKpa',minimum:0,maximum:30,sampleCount:4});
  const model=report(created.document,'soil.undrained.fs','sample-1'),text=html(model);
  assert.equal(model.record.baseline.metrics['soil.undrained.fs'].availability,'missing');
  assert.equal(model.record.samples[0].metrics['soil.undrained.fs'].value,0);
  assert.equal(model.record.samples[0].metrics['soil.undrained.fs'].deltaPercent,null);
  assert.ok(text.includes('ข้อมูลไม่ครบ'));assert.ok(text.includes('>0</strong>'));
  assert.ok(!text.includes('NaN'));assert.ok(!text.includes('Infinity'));
});

test('invalid sampled beam points remain in tables with reasons and no substituted formulas',()=>{
  const created=create(createProject(source),{...spec,parameterId:'beamInputs.widthMm',minimum:60,maximum:250,sampleCount:5});
  const invalid=created.record.samples.find(point=>point.metrics['beam.usablePhiMnKnM'].availability==='invalid');assert.ok(invalid);
  const model=report(created.document,'beam.usablePhiMnKnM',invalid.id),text=html(model);
  assert.equal(model.record.samples.length,5);assert.ok(text.includes('อยู่นอกขอบเขต'));assert.ok(text.includes(invalid.id));
  assert.ok(text.includes('ไม่มีผลสูตรในหมวดนี้'));assert.ok(text.includes('รหัสจุดแทน'));
  assert.equal(model.record.samples.find(point=>point.id===invalid.id).results.beam,null);
});

test('long names and source text are escaped and preserved in bounded continuations',()=>{
  const long='ข้อความอ้างอิง <script>alert(1)</script>\n'.repeat(23)+'END_STUDY_SOURCE';
  let p=updateActiveScenario(basisProject(),{context:{sourceNote:long}},source);
  p=saveAlternative(p,'A\n'.repeat(22)+'END',source,{id:'long-study-a',createdAt:stamp});
  const created=create(p,{...spec,scenarioId:'long-study-a'}),model=report(created.document),text=html(model);
  assert.ok(text.includes('END_STUDY_SOURCE'));assert.ok(text.includes('&lt;script&gt;'));
  assert.ok(!text.includes('<script>alert'));assert.ok(model.pages.some(page=>page.kind==='detail'));
  const parts=splitStudyReportText(long);assert.equal(parts.join(''),long);
  assert.ok(parts.every(part=>Array.from(part).length<=STUDY_REPORT_TEXT_LIMIT));
  assert.ok(parts.every(part=>(part.match(/[\r\n]/g)||[]).length<=12));
});

test('report output remains fixed after working changes and rejects altered documents or views',()=>{
  let p=basisProject();const created=create(p),before=html(report(created.document));
  p=updateActiveScenario(p,{geometry:{slopeH:3.5},context:{sourceNote:'LATER_EDIT'}},source);
  assert.equal(html(report(created.document)),before);assert.ok(!before.includes('LATER_EDIT'));
  assert.throws(()=>report(created.document,'nonexistent'));assert.throws(()=>report(created.document,'soil.dry.fs','nonexistent'));
  const changed=JSON.parse(JSON.stringify(created.document));changed.config.sampleCount=11;assert.throws(()=>report(changed));
  assert.throws(()=>buildStudyReportPages({document:created.document,source,metricId:'soil.dry.fs',pointId:'baseline',reportCreatedAt:'bad-time'}));
});
