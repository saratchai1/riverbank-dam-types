import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProject,updateActiveScenario,saveAlternative,projectRevision,serializeProject} from '../projects/s6006/project.js';
import {saveInvestigationMetadata,DEFAULT_SOIL_INVESTIGATION_METADATA} from '../projects/s6006/investigations.js';
import {studyCSV} from '../projects/s6006/studies.js';
import {createStudyDocument,serializeStudyDocument,parseStudyDocument,inspectStudyDocument,saveStudySnapshot,loadStudySnapshot,STUDY_DOCUMENT_MAX_BYTES,STUDY_SNAPSHOT_PREFIX,STUDY_SNAPSHOT_MAX_BYTES} from '../projects/s6006/study-storage.js';

const source=JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json',import.meta.url),'utf8'));
const stamp='2026-11-22T01:00:00.000Z',id='study-storage-fixture';
const config={stationId:'r1-row14',scenarioId:'current',parameterId:'geometry.slopeH',minimum:1.5,maximum:4,sampleCount:7};
const clone=value=>JSON.parse(JSON.stringify(value));
const memory=()=>{const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
const create=(project=createProject(source),spec=config)=>createStudyDocument(project,source,spec,{id,createdAt:stamp});
const view={metricId:'soil.dry.fs',pointId:'sample-3'};
const reportOptions={id:'study-report-fixture',createdAt:stamp};

test('study files preserve native v1/v2/v3 and recompute the same frozen experiment',()=>{
  const v2=createProject(source),v1={...v2,version:1};delete v1.stationComparisons;
  const v3=saveInvestigationMetadata(v2,'soil',{...DEFAULT_SOIL_INVESTIGATION_METADATA,boreholeId:'BH-7',notes:'SYNTHETIC source fixture'},source);
  for(const project of [v1,v2,v3]){
    const original=serializeProject(project,source),created=create(project),text=serializeStudyDocument(created.document,source),loaded=parseStudyDocument(text,source);
    assert.equal(loaded.document.project.version,project.version);
    assert.equal(serializeProject(project,source),original);
    assert.equal(loaded.record.projectRevision,projectRevision(project));
    assert.equal(studyCSV(loaded.record),studyCSV(created.record));
    assert.equal(serializeStudyDocument(loaded.document,source),text);
    assert.ok(!Object.hasOwn(loaded.document,'results'));
    assert.ok(!Object.hasOwn(loaded.document,'samples'));
    assert.ok(Object.isFrozen(loaded.document.project));
    assert.ok(Object.isFrozen(loaded.record.samples[0].scenario));
  }
});

test('saved-source documents and report views stay unchanged after working edits',()=>{
  let project=saveAlternative(createProject(source),'A · frozen base',source,{id:'study-base-a',createdAt:stamp});
  const before=serializeProject(project,source),created=create(project,{...config,scenarioId:'study-base-a'}),storage=memory();
  const report=saveStudySnapshot(created.document,source,storage,view,reportOptions);
  project=updateActiveScenario(project,{geometry:{slopeH:3.9},context:{sourceNote:'WORKING_CHANGED'}},source);
  const loaded=loadStudySnapshot({search:new URL(report.url,'https://example.test').search,storage,source});
  assert.notEqual(serializeProject(project,source),before);
  assert.equal(loaded.record.selection.scenarioId,'study-base-a');
  assert.equal(loaded.record.baseline.scenario.geometry.slopeH,2.5);
  assert.equal(loaded.metricId,view.metricId);assert.equal(loaded.pointId,view.pointId);
  assert.equal(loaded.document.createdAt,stamp);
  assert.equal(studyCSV(loaded.record),studyCSV(created.record));
});

test('study document edits to time, identity, configuration, evidence and revisions are rejected',()=>{
  const p=saveInvestigationMetadata(createProject(source),'soil',{...DEFAULT_SOIL_INVESTIGATION_METADATA,notes:'ORIGINAL'},source);
  const created=create(p);
  const mutations=[
    d=>{d.createdAt='2026-11-23T01:00:00.000Z';},d=>{d.id='another-valid-id';},d=>{d.config.maximum=5;},
    d=>{d.project.stationInvestigations['r1-row14'].current.soil.metadata.notes='CHANGED';},
    d=>{d.projectRevision+='x';},d=>{d.sourceRevision+='x';},d=>{d.studyRevision+='x';},
    d=>{d.calculationRevision='S6006-R99';},d=>{d.methodRevision='S6006-STUDIES-99';},
    d=>{d.extra='unexpected';},d=>{d.integrity='invented';},
  ];
  for(const mutate of mutations){const d=clone(created.document);mutate(d);assert.throws(()=>parseStudyDocument(JSON.stringify(d),source));}
});

test('unsafe document objects and creation options fail before getters can execute',()=>{
  const original=create().document;let called=0;
  for(const key of ['project','config','integrity']){
    const d=clone(original);Object.defineProperty(d,key,{enumerable:true,get(){called++;return original[key];}});
    assert.throws(()=>inspectStudyDocument(d,source));
  }
  const options={};Object.defineProperty(options,'id',{enumerable:true,get(){called++;return id;}});
  assert.throws(()=>createStudyDocument(createProject(source),source,config,options));
  assert.equal(called,0);
  const d=clone(original);d.loop=d;assert.throws(()=>inspectStudyDocument(d,source));
  const bad=clone(original);bad.toJSON=()=>{called++;return original;};assert.throws(()=>inspectStudyDocument(bad,source));assert.equal(called,0);
});

test('malformed, oversized and incompatible files have no project or default-study fallback',()=>{
  for(const text of ['',null,'{','[]','null','x'.repeat(STUDY_DOCUMENT_MAX_BYTES+1)])assert.throws(()=>parseStudyDocument(text,source));
  const created=create();const d=clone(created.document);delete d.config;assert.throws(()=>parseStudyDocument(JSON.stringify(d),source));
  assert.throws(()=>createStudyDocument(createProject(source),source,config,{id:'short'}));
  assert.throws(()=>createStudyDocument(createProject(source),source,config,{createdAt:'2026-11-22'}));
});

test('study report snapshots require exact query, existing view and matching protected content',()=>{
  const created=create(),storage=memory(),saved=saveStudySnapshot(created.document,source,storage,view,reportOptions);
  const search=new URL(saved.url,'https://example.test').search;
  for(const bad of ['','?snapshot=missing-valid-id',search+'&snapshot=second-valid-id','?snapshot=bad!'])assert.throws(()=>loadStudySnapshot({search:bad,storage,source}));
  for(const bad of [{...view,pointId:'absent'},{...view,metricId:'bogus'},{...view,metricId:'beam.selfWeightMuKnM'},{...view,extra:true}])assert.throws(()=>saveStudySnapshot(created.document,source,storage,bad));
  const key=STUDY_SNAPSHOT_PREFIX+reportOptions.id,original=storage.getItem(key);
  for(const mutate of [s=>{s.metricId='soil.parallel-seepage.fs';},s=>{s.pointId='baseline';},s=>{s.createdAt='2026-11-23T01:00:00.000Z';},s=>{s.document.config.minimum=1;}]){
    const changed=JSON.parse(original);mutate(changed);storage.setItem(key,JSON.stringify(changed));
    assert.throws(()=>loadStudySnapshot({search,storage,source}));
  }
  storage.setItem(key,'x'.repeat(STUDY_SNAPSHOT_MAX_BYTES+1));assert.throws(()=>loadStudySnapshot({search,storage,source}));
  storage.setItem(key,original);assert.equal(loadStudySnapshot({search,storage,source}).record.studyRevision,created.record.studyRevision);
});

test('snapshot collisions and quota failures never replace an existing study report',()=>{
  const created=create(),storage=memory();saveStudySnapshot(created.document,source,storage,view,reportOptions);
  const original=storage.getItem(STUDY_SNAPSHOT_PREFIX+reportOptions.id);
  assert.throws(()=>saveStudySnapshot(created.document,source,storage,{...view,pointId:'baseline'},reportOptions),/รหัสนี้/);
  assert.equal(storage.getItem(STUDY_SNAPSHOT_PREFIX+reportOptions.id),original);
  const denied={getItem:()=>null,setItem:()=>{throw new Error('quota');}};
  assert.throws(()=>saveStudySnapshot(created.document,source,denied,view,reportOptions),/quota/);
});
