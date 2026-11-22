import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject,updateActiveScenario,selectStation,stationCatalog } from '../projects/s6006/project.js';
import { buildStudy } from '../projects/s6006/studies.js';
import {
  formatStudyValue,studyChartSVG,studyChartHTML,studyTableHTML,studyPointDetailHTML,
  createStudyDraftStore,studyFreshness,
} from '../projects/s6006/study-ui.js';

const source=JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json',import.meta.url),'utf8'));
const project=createProject(source),[first,second]=stationCatalog(source);
const config={stationId:first.id,scenarioId:'current',parameterId:'geometry.slopeH',minimum:2,maximum:4,sampleCount:5};
const metric='soil.dry.fs';
const makeRecord=()=>buildStudy(project,source,config);
const copy=value=>JSON.parse(JSON.stringify(value));
const cell=(value,availability='computed',reason='ค่าทดลอง')=>({value,availability,reason,delta:null,deltaPercent:null});

test('study chart connects only consecutive computed points and leaves invalid/gated values as gaps',()=>{
  const record=makeRecord();
  record.samples[1].metrics[metric]=cell(null,'invalid','ข้อมูลนอกขอบเขต');
  record.samples[3].metrics[metric]=cell(123,'gated','ค่าระหว่างคำนวณห้ามใช้ตรวจ');
  const svg=studyChartSVG(record,metric);
  assert.equal((svg.match(/data-study-chart-point=/g)||[]).length,3);
  assert.equal((svg.match(/data-study-chart-unavailable=/g)||[]).length,2);
  assert.doesNotMatch(svg,/data-study-segment=/);
  assert.match(svg,/data-computed-points="3"/);
  const table=studyTableHTML(record,metric);
  assert.match(table,/data-study-value="sample-4">—<\/td>/);
  assert.doesNotMatch(table,/data-study-value="sample-4">123/);
  assert.match(table,/ข้อมูลนอกขอบเขต/);
  assert.match(table,/ค่าระหว่างคำนวณห้ามใช้ตรวจ/);
  record.samples[1].metrics[metric]=cell(1);
  const connected=studyChartSVG(record,metric);
  assert.match(connected,/data-study-segment="sample-1,sample-2,sample-3"/);
  assert.doesNotMatch(connected,/data-study-segment="[^"]*sample-4/);
});

test('study chart and table distinguish no result from an explicitly computed zero',()=>{
  const record=makeRecord();
  for(const point of [record.baseline,...record.samples])point.metrics[metric]=cell(null,'missing','ยังไม่มี Su');
  const empty=studyChartSVG(record,metric);
  assert.match(empty,/ผลนี้ยังไม่มีค่าที่ใช้วาดกราฟ/);
  assert.doesNotMatch(empty,/data-study-chart-point|data-study-chart-baseline|data-study-segment/);
  record.samples[0].metrics[metric]=cell(0);
  const zero=studyChartSVG(record,metric);
  assert.match(zero,/data-study-chart-point="sample-1"/);
  assert.doesNotMatch(zero,/data-study-chart-baseline/);
  const table=studyTableHTML(record,metric);
  assert.match(table,/data-study-value="sample-1">0<\/td>/);
  assert.match(table,/data-study-value="baseline">—<\/td>/);
  assert.match(table,/ยังไม่มี Su/);
});

test('a computed baseline outside the requested range is labelled and plotted at its own x without clamping',()=>{
  const record=buildStudy(project,source,{...config,minimum:3,maximum:4});
  const svg=studyChartSVG(record,metric);
  assert.match(svg,/data-baseline-outside="true"/);
  assert.match(svg,/ค่าฐาน · นอกช่วงทดลอง/);
  assert.equal((svg.match(/data-study-range-boundary=/g)||[]).length,2);
  const baseX=Number(svg.match(/data-study-chart-baseline[^]*?<circle cx="([^"]+)"/)[1]);
  const firstX=Number(svg.match(/data-study-chart-point="sample-1"[^]*?<circle cx="([^"]+)"/)[1]);
  assert.ok(baseX<firstX,'An out-of-range baseline must not be moved onto the first sampled value');
  assert.match(studyChartHTML(record,metric),/แกนนอนจึงครอบคลุมค่าฐานด้วย/);
  record.baseline.metrics[metric]=cell(null,'gated','ยังใช้ตรวจไม่ได้');
  const gated=studyChartSVG(record,metric);
  assert.doesNotMatch(gated,/data-study-chart-baseline/);
  assert.match(gated,/data-baseline-outside="false"/);
});

test('finite huge and tiny computed results remain drawable without NaN, Infinity or zero substitution',()=>{
  for(const value of [Number.MAX_VALUE,1e-300]) {
    const record=makeRecord();
    for(const point of [record.baseline,...record.samples])point.metrics[metric]=cell(value);
    const svg=studyChartSVG(record,metric);
    assert.doesNotMatch(svg,/NaN|Infinity/);
    assert.equal((svg.match(/data-study-chart-point=/g)||[]).length,5);
    const table=studyTableHTML(record,metric);
    assert.ok(table.includes(String(value)));
    assert.doesNotMatch(table,/data-study-value="sample-1">0<\/td>/);
  }
  assert.equal(formatStudyValue(0),'0');
  assert.equal(formatStudyValue(null),'—');
  assert.equal(formatStudyValue(-1e-8),'-1.000000e-8');
});

test('sample tables and captured inputs retain full numeric precision while chart labels may be rounded',()=>{
  const record=buildStudy(project,source,{...config,minimum:2.123456789123,maximum:3.987654321987});
  const point=record.samples[1],value=point.metrics[metric].value;
  const table=studyTableHTML(record,metric);
  assert.ok(table.includes('data-study-x="'+point.id+'">'+String(point.x)+'</td>'));
  assert.ok(table.includes('data-study-value="'+point.id+'">'+String(value)+'</td>'));
  assert.ok(table.includes(String(point.metrics[metric].delta)));
  const detail=studyPointDetailHTML(record,metric,point.id);
  assert.ok(detail.includes('</small></td><td>'+String(point.scenario.geometry.slopeH)+'</td>'));
  assert.ok(detail.includes('title="'+String(value)+'"'));
  assert.match(table,/แสดงค่าที่เก็บครบความละเอียด/);
});

test('chart, table and point details escape literal names, context, reasons and formula strings',()=>{
  const record=makeRecord();
  record.selection.scenarioName='<script>saved & current</script>';
  record.parameter.label='<img src=x onerror="boom">';
  record.baseline.scenario.context.sourceNote='constructor\n<img src=x onerror="boom">';
  record.baseline.metrics[metric].reason='<script>reason</script>';
  record.baseline.results.soil.formulaRows[0].substitution='<b>x & y</b>';
  record.baseline.results.soil.formulaRows[0].label='__proto__';
  for(const html of [studyChartSVG(record,metric,{prefix:'<bad id>'}),studyTableHTML(record,metric),studyPointDetailHTML(record,metric)]) {
    assert.doesNotMatch(html,/<script>|<img\s|<b>x & y<\/b>|id="<bad/);
    assert.match(html,/&lt;img src=x onerror=&quot;boom&quot;&gt;/);
  }
  const detail=studyPointDetailHTML(record,metric);
  assert.match(detail,/&lt;script&gt;saved &amp; current&lt;\/script&gt;/);
  assert.match(detail,/constructor/);
  assert.match(detail,/__proto__/);
  assert.match(detail,/&lt;b&gt;x &amp; y&lt;\/b&gt;/);
});

test('selected point detail displays the captured candidate inputs and errors without applying or approving it',()=>{
  const record=makeRecord();
  record.samples[2].metrics[metric]=cell(null,'invalid','กรณีทดสอบนอกขอบเขต');
  record.samples[2].errors.push({domain:'soil',availability:'invalid',message:'ตรวจค่าตั้งต้นของจุดนี้'});
  const detail=studyPointDetailHTML(record,metric,'sample-3');
  assert.match(detail,/data-study-detail-point="sample-3"/);
  assert.match(detail,/data-varied="true"/);
  assert.match(detail,/geometry\.slopeH/);
  assert.match(detail,/ตรวจค่าตั้งต้นของจุดนี้/);
  assert.match(detail,/data-study-calculation="soil"/);
  assert.match(detail,/data-study-calculation="geometry"/);
  assert.doesNotMatch(detail,/data-apply|นำจุดนี้มาใช้|ผ่านทั้งโครงการ|อนุมัติแบบ/);
  assert.throws(()=>studyPointDetailHTML(record,metric,'sample-unknown'),/ไม่พบจุด/);
  assert.throws(()=>studyChartSVG(record,'beam.usablePhiMnKnM'),/ไม่พบผลลัพธ์/);
});

test('study configuration drafts preserve exact text independently of later suggestions and other source selections',()=>{
  const store=createStudyDraftStore(),suggestion={minimum:2,maximum:3,sampleCount:9};
  assert.equal(store.get('one/current/slope',suggestion).suggested,true);
  store.set('one/current/slope','minimum','0',suggestion);
  store.set('one/current/slope','maximum','3.500',suggestion);
  store.set('one/saved-a/slope','minimum','2.25',suggestion);
  const current=store.get('one/current/slope',{minimum:10,maximum:20,sampleCount:5});
  assert.equal(current.minimum,'0');assert.equal(current.maximum,'3.500');assert.equal(current.suggested,false);
  assert.equal(store.get('one/saved-a/slope',suggestion).minimum,'2.25');
  assert.equal(store.get('two/current/slope',suggestion).minimum,'2');
  assert.equal(store.get('two/current/cohesion',null).minimum,'');
  current.minimum='mutated';
  assert.equal(store.get('one/current/slope',suggestion).minimum,'0');
  assert.throws(()=>store.set('one/current/slope','constructor','bad',suggestion),/ไม่รู้จัก/);
});

test('study freshness separates changed setup from changed captured source and ignores unrelated station edits',()=>{
  const record=makeRecord();
  assert.deepEqual(studyFreshness(record,project,source,config),{sourceState:'current',configState:'current'});
  const changedSetup={...config,maximum:5};
  assert.deepEqual(studyFreshness(record,project,source,changedSetup),{sourceState:'current',configState:'changed'});
  let other=selectStation(project,second.id,source);
  other=updateActiveScenario(other,{geometry:{slopeH:3.25}},source);
  assert.deepEqual(studyFreshness(record,other,source,config),{sourceState:'current',configState:'current'});
  const changedSource=updateActiveScenario(project,{geometry:{slopeH:3.5}},source);
  assert.deepEqual(studyFreshness(record,changedSource,source,config),{sourceState:'changed',configState:'current'});
  const bad=copy(record);bad.selection.scenarioId='missing-alternative';
  assert.deepEqual(studyFreshness(bad,project,source,config),{sourceState:'unavailable',configState:'current'});
});
