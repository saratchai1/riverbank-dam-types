import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInvestigationDraftStore, investigationStateHTML, investigationChangesHTML,
  investigationValuesHTML, investigationCatalogueHTML,
} from '../projects/s6006/investigation-ui.js';
import {
  DEFAULT_SOIL_INVESTIGATION_METADATA, DEFAULT_WATER_INVESTIGATION_METADATA,
  INVESTIGATION_VALUE_FIELDS,
} from '../projects/s6006/investigations.js';
import { BOREHOLE_CATALOG } from '../projects/s6006/investigation-sources.js';

const emptyGroup = overrides => ({
  id:'soil',state:'missing',metadata:{...DEFAULT_SOIL_INVESTIGATION_METADATA},
  binding:null,missingMetadata:[],missingInputs:[],inputChanges:[],metadataChanges:[],
  currentValues:Object.fromEntries(INVESTIGATION_VALUE_FIELDS.soil.map(item=>[item.field,null])),
  ...overrides,
});

test('investigation drafts survive unrelated renders and station/kind inspection without sharing edits',()=>{
  const store=createInvestigationDraftStore();
  const soil={...DEFAULT_SOIL_INVESTIGATION_METADATA};
  const water={...DEFAULT_WATER_INVESTIGATION_METADATA};
  store.get('r1/soil',soil);
  store.set('r1/soil','boreholeId','BH-1',soil);
  store.set('r1/soil','sampleDepthFromM','0',soil);
  store.set('r1/soil','sampleDepthToM','1.50',soil);
  store.set('r1/water','datum','BM-2',water);
  store.get('r2/soil',soil);
  const restored=store.get('r1/soil',{...soil});
  assert.equal(restored.values.boreholeId,'BH-1');
  assert.equal(restored.values.sampleDepthFromM,'0');
  assert.equal(restored.values.sampleDepthToM,'1.50');
  assert.equal(restored.dirty,true);
  assert.equal(restored.conflict,false);
  assert.equal(store.get('r2/soil',soil).values.boreholeId,'');
  assert.deepEqual(store.dirtyKeys(),['r1/soil','r1/water']);
  restored.values.boreholeId='MUTATED';
  assert.equal(store.get('r1/soil',soil).values.boreholeId,'BH-1');
  store.discard('r1/soil');
  assert.equal(store.get('r1/soil',soil).values.boreholeId,'');
  assert.deepEqual(store.dirtyKeys(),['r1/water']);
});

test('investigation drafts reveal an externally changed saved record and rebase only explicitly',()=>{
  const store=createInvestigationDraftStore();
  const original={...DEFAULT_WATER_INVESTIGATION_METADATA,datum:'BM-OLD'};
  store.set('station/water','notes','Keep my draft',original);
  const latest={...original,datum:'BM-NEW'};
  const conflict=store.get('station/water',latest);
  assert.equal(conflict.conflict,true);
  assert.equal(conflict.values.datum,'BM-OLD');
  assert.equal(conflict.values.notes,'Keep my draft');
  const rebased=store.rebase('station/water',latest);
  assert.equal(rebased.conflict,false);
  assert.equal(rebased.values.notes,'Keep my draft');
  assert.equal(rebased.dirty,true);
  store.discard('station/water');
  assert.equal(store.get('station/water',latest).values.datum,'BM-NEW');
  assert.equal(store.get('station/water',latest).dirty,false);
  assert.throws(()=>store.set('station/water','unknown','value',latest),/ไม่รู้จัก/);
});

test('pristine investigation drafts follow newly saved metadata without retaining stale empty values',()=>{
  const store=createInvestigationDraftStore();
  const original={...DEFAULT_SOIL_INVESTIGATION_METADATA};
  assert.equal(store.get('station/soil',original).dirty,false);
  const saved={...original,boreholeId:'BH-4',sampleDepthFromM:0,sampleDepthToM:2};
  const draft=store.get('station/soil',saved);
  assert.equal(draft.values.boreholeId,'BH-4');
  assert.equal(draft.values.sampleDepthFromM,'0');
  assert.equal(draft.dirty,false);
  assert.equal(draft.conflict,false);
  store.set('station/soil','notes','temporary',saved);
  assert.equal(store.set('station/soil','notes','',saved).dirty,false);
});

test('investigation state labels distinguish absent, incomplete, exact and stale records without approval',()=>{
  const missing=investigationStateHTML(emptyGroup({missingInputs:[{field:'soilInputs.undrainedStrengthKpa',label:'Su',reason:'ยังไม่ทราบ'}]}));
  assert.match(missing,/ยังไม่มีบันทึก/);
  assert.match(missing,/Su/);
  assert.match(missing,/ยังไม่ทราบ/);
  const incomplete=investigationStateHTML(emptyGroup({state:'incomplete'}));
  assert.match(incomplete,/ข้อมูลยังไม่ครบ/);
  const current=investigationStateHTML(emptyGroup({state:'current',binding:{recordedAt:'2026-11-21T10:00:00Z'}}));
  assert.match(current,/ตรงกับค่าที่ผูกไว้/);
  assert.match(current,/ไม่ได้ยืนยันความถูกต้องของเอกสารหรือรับรองการออกแบบ/);
  assert.match(current,/17:00/);
  assert.doesNotMatch(current,/ผ่านเงื่อนไข|อนุมัติ/);
  const stale=investigationStateHTML(emptyGroup({state:'stale'}));
  assert.match(stale,/มีค่าเปลี่ยน ต้องทบทวน/);
});

test('investigation differences preserve numeric zero, missing values, small numbers and literal user text',()=>{
  const html=investigationChangesHTML(emptyGroup({
    inputChanges:[
      {field:'context.groundwaterLevel',label:'น้ำใต้ดิน',unit:'m',captured:null,current:0},
      {field:'soilInputs.effectiveCohesionKpa',label:'c′',unit:'kPa',captured:1e-8,current:-1e-8},
      {field:'context.sourceNote',label:'ที่มา',captured:'constructor',current:'<img src=x onerror="boom">'},
    ],
    metadataChanges:[{field:'notes',label:'<script>note</script>',captured:'__proto__',current:'effective'}],
  }));
  assert.match(html,/>—<\/span>/);
  assert.match(html,/>0<\/span>/);
  assert.match(html,/1\.000000e-8/);
  assert.match(html,/-1\.000000e-8/);
  assert.match(html,/constructor/);
  assert.match(html,/__proto__/);
  assert.match(html,/&lt;img src=x onerror=&quot;boom&quot;&gt;/);
  assert.match(html,/&lt;script&gt;note&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>|<img\s|native code/);
  assert.match(html,/>effective<\/span>/);
});

test('saved investigation values expose inspection rather than working-copy mutation',()=>{
  const values=Object.fromEntries(INVESTIGATION_VALUE_FIELDS.water.map(item=>[item.field,null]));
  values['context.waterHighLevel']=0;
  values['context.waterReference']='water report <b>literal</b>';
  values['context.sourceNote']='constructor';
  const group=emptyGroup({id:'water',currentValues:values});
  const html=investigationValuesHTML(group,true);
  assert.match(html,/เปิดทางเลือกที่เก็บ →/);
  assert.doesNotMatch(html,/ไปที่ช่องข้อมูล →|data-apply-alternative|<input|<textarea/);
  assert.match(html,/data-investigation-value-field="context.waterHighLevel"/);
  assert.match(html,/>0<\/span>/);
  assert.match(html,/water report &lt;b&gt;literal&lt;\/b&gt;/);
  assert.match(html,/>constructor<\/span>/);
  const current=investigationValuesHTML(group,false);
  assert.match(current,/ไปที่ช่องข้อมูล →/);
});

test('borehole catalogue preserves raw missing river water levels and offers only draft source selection',()=>{
  const html=investigationCatalogueHTML(false);
  assert.equal((html.match(/data-investigation-borehole=/g)||[]).length,8);
  for(const item of BOREHOLE_CATALOG){
    assert.ok(html.includes('data-investigation-borehole="'+item.id+'"'));
    assert.ok(html.includes('PDF หน้า '+item.logPage));
  }
  assert.match(html,/ไม่ระบุในต้นฉบับ/);
  assert.match(html,/-7\.00 M\./);
  assert.match(html,/24 Hrs\. After Boring/);
  assert.match(html,/การเลือกไม่ระบุว่าหลุมเจาะนั้นตรงกับสถานีนี้/);
  assert.match(html,/data-investigation-use-borehole="BH-1"/);
  assert.doesNotMatch(investigationCatalogueHTML(true),/data-investigation-use-borehole=/);
});
