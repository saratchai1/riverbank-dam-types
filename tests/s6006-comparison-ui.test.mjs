import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProject,updateActiveScenario,saveAlternative} from '../projects/s6006/project.js';
import {buildComparison} from '../projects/s6006/comparison.js';
import {comparisonTableHTML} from '../projects/s6006/comparison-ui.js';

const source=JSON.parse(readFileSync(new URL('../projects/s6006/source-data.json',import.meta.url),'utf8'));

test('comparison presentation preserves context text even when it matches a mode or object property name',()=>{
  for(const value of ['effective','undrained','constructor','__proto__','toString']){
    const project=updateActiveScenario(createProject(source),{context:{waterReference:value}},source);
    const record=buildComparison(project,source);
    const html=comparisonTableHTML(record,record.rows.filter(row=>row.id==='input.context.waterReference'));
    assert.ok(html.includes('<strong class="comparison-value">'+value+'</strong>'));
    assert.doesNotMatch(html,/native code|\[object Object\]|Effective stress|Total stress/);
    const mode=comparisonTableHTML(record,record.rows.filter(row=>row.id==='input.soilInputs.mode'));
    assert.match(mode,/Effective stress · c′ \/ φ′/);
  }
});

test('comparison names and complete reference text render as escaped data',()=>{
  let project=updateActiveScenario(createProject(source),{context:{sourceNote:'<img src=x onerror="alert(1)"> & "source"'}},source);
  project=saveAlternative(project,'<script>A & B</script>',source,{id:'option-safe',createdAt:'2026-11-21T08:00:00.000Z'});
  const record=buildComparison(project,source);
  const html=comparisonTableHTML(record,record.rows.filter(row=>row.id==='input.context.sourceNote'));
  assert.match(html,/&lt;script&gt;A &amp; B&lt;\/script&gt;/);
  assert.match(html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html,/<script>|<img\s/);
});

test('comparison presentation distinguishes gated strength, missing demand and an explicitly entered zero',()=>{
  let project=saveAlternative(createProject(source),'ฐาน',source,{id:'base',createdAt:'2026-11-21T08:00:00.000Z'});
  project=updateActiveScenario(project,{beamInputs:{tensionBarDiameterMm:16,stirrupDiameterMm:8,externalMuKnM:0}},source);
  const record=buildComparison(project,source);
  const capacity=comparisonTableHTML(record,record.rows.filter(row=>row.id==='beam.usablePhiMnKnM'));
  assert.match(capacity,/data-availability="gated"/);
  assert.match(capacity,/ยังใช้ตรวจไม่ได้/);
  assert.doesNotMatch(capacity,/comparison-delta/);
  const demand=comparisonTableHTML(record,record.rows.filter(row=>row.id==='beam.MuKnM'));
  assert.match(demand,/data-availability="missing"/);
  assert.match(demand,/<strong class="comparison-value">0<\/strong>/);
});
