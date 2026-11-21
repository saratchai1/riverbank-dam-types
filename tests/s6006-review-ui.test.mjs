import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewFindingHTML, reviewEntryDetailHTML } from '../projects/s6006/review-ui.js';

const finding = overrides => ({id:'beam.capacity',group:'beam',availability:'computed',disposition:'condition-met',label:'กำลังดัด',value:60.474157,limit:null,unit:'kN·m',reason:'ผลภายในขอบเขตของโมดูล',inputPaths:['beamInputs.widthMm'],sourceKeys:[],actionTarget:{panel:'engineering',section:'beam',field:'widthMm'},...overrides});

test('review presentation keeps withheld capacity, missing data and explicit zero distinct', () => {
  const withheld = reviewFindingHTML(finding({availability:'gated',disposition:'attention',value:null,reason:'ยังไม่ผ่านเงื่อนไขเหล็กขั้นต่ำ'}));
  assert.match(withheld,/data-availability="gated"/);
  assert.match(withheld,/ยังใช้ตรวจไม่ได้/);
  assert.match(withheld,/<strong class="review-finding-value">—<\/strong>/);
  const missing = reviewFindingHTML(finding({id:'beam.Mu',availability:'missing',disposition:'missing',label:'Mu ที่ระบุ',value:null}));
  assert.match(missing,/ข้อมูลยังไม่ครบ/);
  assert.doesNotMatch(missing,/ยังใช้ตรวจไม่ได้/);
  const zero = reviewFindingHTML(finding({id:'beam.Mu',availability:'provided',disposition:'recorded',label:'Mu ที่ระบุ',value:0}));
  assert.match(zero,/<strong class="review-finding-value">0<\/strong>/);
  assert.match(zero,/มีข้อมูลบันทึก · ยังต้องยืนยัน/);
  assert.doesNotMatch(zero,/ข้อมูลยังไม่ครบ|ผ่านเงื่อนไขย่อย/);
});

test('review presentation preserves tiny nonzero values and limits instead of rounding them to zero', () => {
  for (const value of [1e-7, -1e-7]) {
    const html = reviewFindingHTML(finding({value,limit:value}));
    const displayed = value.toExponential(6);
    assert.ok(html.includes('<strong class="review-finding-value">' + displayed + '</strong>'));
    assert.ok(html.includes('<strong class="review-finding-limit">' + displayed + '</strong>'));
    assert.doesNotMatch(html,/<strong class="review-finding-(value|limit)">0<\/strong>/);
  }
  const large = reviewFindingHTML(finding({value:1e12}));
  assert.match(large,/1\.000000e\+12/);
});

test('review context strings stay literal and escaped rather than resolving object property names', () => {
  for (const value of ['constructor','__proto__','toString','effective','undrained']) {
    const html = reviewFindingHTML(finding({group:'context',availability:'provided',disposition:'recorded',value,reason:value}));
    assert.ok(html.includes('<strong class="review-finding-value">' + value + '</strong>'));
    assert.doesNotMatch(html,/native code|\[object Object\]|Effective stress|Total stress/);
  }
  const html = reviewFindingHTML(finding({label:'<script>A & B</script>',value:'<img src=x onerror="alert(1)">',reason:'"hello" & <p>source</p>',inputPaths:['<input>'],sourceKeys:['bad']}), {entryKey:'<key>',sources:[{id:'bad',title:'<source>',url:'javascript:alert(1)'}]});
  assert.match(html,/&lt;script&gt;A &amp; B&lt;\/script&gt;/);
  assert.match(html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html,/<script>|<img\s|href="javascript:|<input>/);
  assert.match(html,/data-review-action="&lt;key&gt;"/);
});

test('saved review findings direct inspection without describing an automatic working-copy change', () => {
  const saved = reviewFindingHTML(finding({id:'beam.demand'}), {entryKey:'r1-row14/saved-a',kind:'saved'});
  assert.match(saved,/เปิดทางเลือกที่เก็บ →/);
  assert.doesNotMatch(saved,/แก้ข้อมูลคาน →|นำมาแก้ต่อ|apply-alternative/);
  const current = reviewFindingHTML(finding({id:'beam.demand'}), {entryKey:'r1-row14/current',kind:'current'});
  assert.match(current,/แก้ข้อมูลคาน →/);
  assert.match(current,/data-review-action-finding="beam.demand"/);
});

test('review detail preserves source identity and treats a changed saved scenario as unverified', () => {
  const entry = {key:'r1-row14/a',station:{id:'r1-row14',reach:1,station:0,sourceSheet:'หาปริมาณวัสดุ',sourceRow:14,effectiveLength:12.5},scenarioId:'a',scenarioName:'A <b>changed</b>',kind:'saved',baseline:false,scenarioRevision:'s6006s-sample',metrics:{usablePhiMnKnM:null,usablePhiVnKn:31.7664,MuKnM:0,VuKn:null},findings:[finding({group:'soil',availability:'not-applicable',disposition:'not-applicable',value:null,unit:'FS',reason:'คนละชนิดพารามิเตอร์'})]};
  const html = reviewEntryDetailHTML(entry, {sources:[]});
  assert.match(html,/A &lt;b&gt;changed&lt;\/b&gt;/);
  assert.match(html,/มีค่าต่างจากต้นแบบ/);
  assert.match(html,/การเปิดดูรายการไม่เปลี่ยนค่าที่กำลังแก้/);
  assert.match(html,/หาปริมาณวัสดุ แถว 14 · Lᵢ = 12.5 ม\./);
  assert.match(html,/ไม่ได้ยืนยันว่าข้อมูลผ่านการตรวจแล้ว/);
  assert.match(html,/ไม่ใช้ในกรณีนี้/);
  assert.doesNotMatch(html,/อนุมัติ|ผ่านทั้งโครงการ/);
});
