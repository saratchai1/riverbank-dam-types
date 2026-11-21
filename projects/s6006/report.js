import {calculateTypical,auditSourceQuantities} from './engine.js';
import {typicalSectionSVG,scenarioSectionOptions} from './visuals.js';
import {SOURCE_FILES,sourceURL,REPORTED_FS,SOIL_SOURCE,CASE_REVIEWS,QUESTIONS,METHOD_SOURCES,AGGREGATE_LABELS} from './case-data.js';
import {engineeringReportSections} from './engineering-ui.js';
import {getActiveScenario,getSoilInputs,stationCatalog,projectRevision,scenarioRevision,isBaselineScenario} from './project.js';
import {loadReportProject} from './project-storage.js';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const f=(value,d=3)=>value===null||value===undefined?'—':Number(value).toLocaleString('en-US',{maximumFractionDigits:d});
const u=value=>({m:'ม.',m2:'ตร.ม.',m3:'ลบ.ม.',degree:'องศา'}[value]||value);
const sta=value=>Math.floor(value/1000)+'+'+String(value%1000).padStart(3,'0');
const sourceLink=(key,label)=>'<a href="'+sourceURL(key)+'">'+label+'</a>';
const sourceRef=(key,location)=>'<p class="source-ref">ที่มา: '+sourceLink(key,location)+'</p>';
const table=(headers,rows,cls='',rowAttributes=[])=>'<table class="'+cls+'"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map((r,i)=>'<tr'+(rowAttributes[i]||'')+'>'+r.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
const referenceDate='21 พฤศจิกายน 2569';
const contextExcerpt=value=>{
  if(!value)return 'ยังไม่ได้ระบุ';
  const compact=value.replace(/\s+/g,' ').trim(),characters=Array.from(compact);
  if(!compact)return 'ยังไม่ได้ระบุ';
  return e(characters.length>115?characters.slice(0,115).join('')+'… (ดูรายละเอียดบริบท)':compact);
};

export function formatReportTimestamp(value){
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error('เวลาสร้าง snapshot ไม่ถูกต้อง');
  return new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value))+' (Asia/Bangkok, UTC+07:00)';
}

export function splitContextText(value){
  const chunks=[];let chunk='',lineBreaks=0;
  for(const character of value){
    if(chunk&&(chunk.length>=900||lineBreaks>=18)){chunks.push(chunk);chunk='';lineBreaks=0;}
    chunk+=character;if(character==='\n'||character==='\r')lineBreaks++;
  }
  if(chunk)chunks.push(chunk);
  return chunks;
}

/** Build exclusively from the resolved project, never from an unrelated current project. */
export function buildReportPages({project,source,mode='baseline',createdAt=null,snapshotToken=null}){
  if(!['snapshot','baseline'].includes(mode))throw new Error('ชนิดรายงานไม่ถูกต้อง');
  if(mode==='snapshot'&&(!snapshotToken||typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt))))throw new Error('ข้อมูลระบุตัวตนของ snapshot ไม่ครบ');
  const scenario=getActiveScenario(project),geometry=scenario.geometry,context=scenario.context;
  const selected=stationCatalog(source).find(row=>row.id===project.selectedStationId);
  if(!selected)throw new Error('ไม่พบสถานีที่เลือกในชุดข้อมูลต้นฉบับ');
  const audit=auditSourceQuantities(source);if(audit.errors.length)throw new Error(audit.errors.join('; '));
  const selectedRow=audit.rows.find(row=>row.sourceSheet===selected.sourceSheet&&row.sourceRow===selected.sourceRow);
  if(!selectedRow)throw new Error('ไม่พบแถวถอดปริมาณของสถานีที่เลือก');
  const calc=calculateTypical(geometry),baseline=isBaselineScenario(scenario);
  const metadata={projectCode:project.projectCode,calculationRevision:project.calculationRevision,
    projectRevision:projectRevision(project),scenarioRevision:scenarioRevision(scenario),
    scenarioId:selected.id+':'+scenarioRevision(scenario),selectedStationId:selected.id,
    stationLabel:sta(selected.station),reach:selectedRow.reach,mode,createdAt,
    createdAtDisplay:mode==='snapshot'?formatReportTimestamp(createdAt):null,snapshotToken,baseline};
  const pages=[];const add=(title,body)=>pages.push({title,body});
  const modeLabel=mode==='snapshot'?'สถานการณ์ที่บันทึก':'ค่าต้นแบบอ้างอิง';
  const identityRows=[
    ['โครงการ / สถานีที่เลือก',e(project.projectCode)+' · '+e(selectedRow.reach)+' / STA '+e(sta(selected.station))+'<small>บริบท BOQ: '+e(selected.sourceSheet)+' แถว '+selected.sourceRow+' · Lᵢ = '+f(selected.effectiveLength,2)+' ม.</small>'],
    ['Project revision / Scenario ID','<code>'+e(metadata.projectRevision)+'</code><br><code>'+e(metadata.scenarioId)+'</code>'],
    ['รุ่นสูตร / เวลาเก็บชุดข้อมูล',e(project.calculationRevision)+'<br>'+(mode==='snapshot'?e(metadata.createdAtDisplay):'ข้อมูลอ้างอิง ณ '+referenceDate)],
    ['รูปตัดร่วมที่ใช้คำนวณ','สัน '+f(geometry.crestLevel,2)+' / ตีน '+f(geometry.toeLevel,2)+' ม. · ลาด '+f(geometry.slopeH,3)+'H:1V<small>ความยาวปริซึมทดลอง '+f(geometry.length,2)+' ม.; ไม่ใช่ Lᵢ ของสถานี</small>'],
  ];
  if(mode==='snapshot')identityRows.splice(2,0,['Snapshot','<code>'+e(snapshotToken)+'</code>']);
  add('บริบทโครงการและสถานการณ์','<p class="eyebrow">S6006 / SAVED PROJECT CONTEXT</p><h1>บ้านแดนเมือง S6006<br>รายการคำนวณสถานการณ์</h1><div class="report-mode '+(mode==='baseline'?'reference':'snapshot')+'"><strong>'+modeLabel+'</strong><p>'+(mode==='snapshot'?'ค่าทั้งหมดในส่วนคำนวณมาจาก snapshot นี้ การแก้โครงการในหน้าจอภายหลังไม่เปลี่ยนรายงานฉบับนี้':'เปิดรายงานโดยไม่มี snapshot จึงแสดงค่าต้นแบบอ้างอิง ไม่ใช่ค่าปัจจุบันจากหน้าจอโครงการ')+'</p></div>'+table(['ข้อมูลร่วม','ค่าที่ใช้ในรายงาน'],identityRows,'context-table')+'<h3>น้ำและข้อมูลหลุมเจาะของสถานการณ์</h3>'+table(['บริบท','ค่าที่บันทึก'],[
    ['ระดับน้ำสูง / ต่ำ',f(context.waterHighLevel,2)+' / '+f(context.waterLowLevel,2)+' ม.'],
    ['ระดับน้ำใต้ดิน',f(context.groundwaterLevel,2)+' ม.'],
    ['หลุมเจาะ / ความสัมพันธ์กับสถานี',contextExcerpt(context.boreholeReference)],
    ['แหล่งข้อมูลน้ำ',contextExcerpt(context.waterReference)],
    ['หมายเหตุข้อมูล',contextExcerpt(context.sourceNote)],
  ],'context-table')+'<div class="note">สถานีนี้เป็นบริบทจาก BOQ รูปตัดยังเป็นรูปทรงทฤษฎีที่ตั้งต้นจาก SD-02; ไม่ได้สร้างหน้าตัดสำรวจหรือจับคู่หลุมเจาะให้เอง ระดับน้ำเป็นข้อมูลประกอบ ไม่ได้ถูกแปลงเป็น u ในสูตรลาดอนันต์โดยอัตโนมัติ</div><p class="source-ref">แหล่งหลัก: '+sourceLink('S-DWG','แบบ SD-02 หน้า 36 / BF1 หน้า 39')+' · '+sourceLink('S-CALC','รายงานวัสดุหน้า 3 / ดินหน้า 16–17')+' · '+sourceLink('S-XLS','BOQ ต้นฉบับ 1,000 ม.')+'</p>');
  const contextDetails=[['หลุมเจาะ / ความสัมพันธ์กับสถานี',context.boreholeReference],['แหล่งข้อมูลน้ำ',context.waterReference],['หมายเหตุข้อมูล',context.sourceNote]].filter(([,value])=>value&&(Array.from(value).length>115||/[\r\n]/.test(value)));
  for(const [label,value] of contextDetails){
    // Keep long supplied references complete, without forcing the context page to overflow.
    const chunks=splitContextText(value);
    for(const [index,chunk] of chunks.entries()){
      add('รายละเอียดบริบท · '+label,'<p class="eyebrow">PROJECT CONTEXT / USER-SUPPLIED REFERENCE</p><h2>'+e(label)+(chunks.length>1?' · ส่วน '+(index+1)+' / '+chunks.length:'')+'</h2><p>STA '+e(sta(selected.station))+' · '+e(selectedRow.reach)+' · <code>'+e(metadata.scenarioId)+'</code></p><div class="context-detail">'+e(chunk)+'</div><div class="note">ข้อความนี้เป็นข้อมูลประกอบที่เก็บใน snapshot ไม่ได้ยืนยันผลทดสอบ ตำแหน่งหลุมเจาะ หรือความสัมพันธ์กับผิววิบัติโดยอัตโนมัติ</div>');
    }
  }

add('บทสรุปและขอบเขต', '<p class="eyebrow">RIVERBANK STUDIO / ENGINEERING CALCULATION RECORD</p><h1>บ้านแดนเมือง S6006<br>จากแบบอ้างอิง<br>สู่เดโม่ที่ตรวจสอบได้</h1><p class="lead">รายการคำนวณเรขาคณิต ปริมาณ กำลังโครงสร้าง และด้านดิน พร้อมทะเบียนแหล่งข้อมูลและประเด็นทบทวนสำหรับวิศวกร</p><div class="cover-box"><span class="label">โครงการสาธิตหนึ่งโครงการ</span><strong>เขื่อนป้องกันตลิ่งริมแม่น้ำโขง</strong><p>บ้านแดนเมือง (ต่อเนื่องเขื่อนเดิมปี 43 เหนือน้ำ)<br>ต.วัดหลวง อ.โพนพิสัย จ.หนองคาย</p><span class="source-ref">ชุดข้อมูลอ้างอิง ณ 21 พฤศจิกายน 2569 · Calculation record R2</span></div><div class="grid3"><div class="metric">ขอบเขต BOQ<b>1,000 ม.</b>286 + 714 ม.</div><div class="metric">ข้อมูลตรวจย้อน<b>41 สถานี</b>13 องค์ประกอบ</div><div class="metric">ชุดแบบที่ทบทวน<b>6 หมวด</b>ทะเบียน 179 ไฟล์</div></div><h3>ผลที่ได้จากเดโม่</h3><p>แอปคำนวณรูปตัดทฤษฎีและตรวจผลคูณ/ยอดรวมของ BOQ ได้ เปิดสูตรและเซลล์ตั้งต้นได้ มีโมดูลกำลังดัด–เฉือนคาน BF1 และโมดูลดินเพื่อศึกษากำลังเฉือนและลาดอนันต์ พร้อมแยกผล Slope/W จากรายงานเดิมเป็นข้อมูลอ้างอิง</p><div class="note">การตรวจเลขและการทดสอบซอฟต์แวร์ยืนยันว่าคำนวณตามสมการที่ประกาศไว้ได้ ส่วนการยืนยันว่าแบบจำลอง แรง ค่าดิน และรายละเอียดครบสำหรับก่อสร้าง ยังต้องผ่านการทบทวนและรับรองของวิศวกรผู้ออกแบบ</div><p class="minor">ส่วนคำนวณในรายงานนี้ใช้ '+modeLabel+' ตามหน้าแรก ส่วนตาราง BOQ และผล Slope/W เป็นข้อมูลต้นฉบับที่แยกไว้ การแก้โครงการภายหลังไม่เปลี่ยนค่าของ snapshot ที่พิมพ์แล้ว</p>');

add('ข้อมูลตั้งต้นและขอบเขต', '<p class="eyebrow">01 / INPUTS, SCOPE & DATUM</p><h2>ขอบเขตและระดับจากต้นฉบับ</h2><p>ตารางหน้านี้เป็นหลักฐานเดิม ไม่ใช่ค่าระดับหรือความยาวที่ผู้ใช้แก้ในสถานการณ์</p>'+table(['ชุดข้อมูล','ค่า / ขอบเขต','หลักฐาน'],[
 ['แบบก่อสร้าง','1,195 ม.','ST-01 PDF หน้า 5 ระบุ 0+000–1+195'],['BOQ ปัจจุบันที่ใช้','1,000 = 286 + 714 ม.','ข้อมูลโครงการ!R3; ป.2!J8 = G10+G12'],['บล็อกคำนวณเก่า','1,222 = 286 + 714 + 222 ม.','หาปริมาณวัสดุ!F6/F95/F159 และ L6'],['สถานีถอดปริมาณ','41 แถว; ผลรวม Lᵢ = 1,000 ม.','แถว 14–25 และ 104–132'],['นอกขอบเขตเดโม่','บล็อกเก่า 222 ม.; แถว 133–139','แถวปลาย 1+025–1+175 มีความยาวช่วงว่าง'],
 ])+'<h3>ระดับอ้างอิง</h3>'+table(['รายการ','ระดับจริงตามตาราง','ระดับสมมติตามแบบ'],[['BM1','164.060','100.010'],['BM2','164.050','100.000'],['น้ำสูงเฉลี่ย','163.20','99.10'],['น้ำขณะสำรวจ','161.30','97.30'],['น้ำต่ำเฉลี่ย','151.50','87.40']])+'<p>BM ทั้งสองให้ส่วนต่าง 64.050 ม. ส่วนระดับน้ำพิมพ์ด้วยความละเอียดต่างกัน รายงานและแอปใช้ระดับสมมติที่พิมพ์ในแบบตามเดิม ไม่แปลงหรือแก้ค่าที่ปัดเศษเอง</p>'+sourceRef('S-DWG','S6006-ST-01 · PDF หน้า 5 / แผ่น 4')+'<h3>จุดที่ต้องจับคู่รุ่นเอกสาร</h3><ul><li>แผนผังบางหน้าและปลายรูปตัดมีป้าย 1+165, 1+196 และข้อความ 1,196 ต่างจากหัวเรื่อง 1,195 ม.</li><li>บางชีตเก่ามี #REF! และลิงก์ไปแฟ้มอื่น จึงไม่เปิดสูตรภายนอกหรือรวมทุกชีตเป็นชุดงานเดียว</li><li>BOQ มี mattress 514 + 1,285 ลบ.ม. ขณะที่มีหมายเหตุ “ไม่มี” ในชีตกลาง และยังเชื่อมกับรูปตัดที่อ่านไม่ได้ ต้องตรวจฉบับแบบ</li></ul><div class="note">ความต่างของชื่อโครงการ ความยาว BOQ และกรณีวิเคราะห์เป็นประเด็นประสานเอกสาร ไม่ใช่หลักฐานเพียงพอที่จะสรุปว่าแบบไม่ปลอดภัย</div>');

add('รูปตัดและสมมติฐาน', '<p class="eyebrow">02 / ACTIVE TYPICAL SECTION</p><h2>รูปตัดตามมิติในสถานการณ์นี้</h2><p>STA '+e(sta(selected.station))+' · '+e(selectedRow.reach)+' เป็นบริบท BOQ; ภาพนี้แสดงรูปทรงทฤษฎีตามมิติที่บันทึก ไม่ใช่รูปตัดสำรวจของสถานี</p><div class="svg-section">'+typicalSectionSVG(geometry,scenarioSectionOptions(scenario))+'</div>'+table(['พารามิเตอร์','สถานการณ์นี้','แบบ / ค่าต้นแบบอ้างอิง'],[
 ['ระดับสัน / ตีน',f(geometry.crestLevel,2)+' / '+f(geometry.toeLevel,2)+' ม.','101.00 / 88.00 ม. · ระดับสมมติในแบบ'],
 ['ลาดหน้าหิน',f(geometry.slopeH,3)+'H : 1V','2.5H : 1V'],
 ['ความหนาหินเรียง',f(geometry.rockThickness,3)+' ม.','0.50 ม. · การวัดตั้งฉากลาดเป็นสมมติฐานโมเดล'],
 ['ความหนาแถบทราย',f(geometry.sandMinThickness,3)+' ม.','ขั้นต่ำ 1.00 ม. · ไม่ใช่พื้นที่ทรายถมสำรวจ'],
 ['ทางเท้า',f(geometry.walkwayWidth,3)+' ม.','2.95 ม. · แสดงเฉพาะผิว'],
 ['ตีนหิน: สัน / ลาดข้าง',f(geometry.toeTopWidth,3)+' ม. / '+f(geometry.toeSlopeH,3)+'H:1V','1.50 ม. / 1.5H:1V'],
 ['ความลึกตีนหินจำลอง',f(geometry.toeDepth,3)+' ม.','เลือก 2.00 ม. เป็นตัวอย่างขั้นต่ำ; ตีนจริงขึ้นกับท้องน้ำ'],
 ['ความยาวปริซึมคำนวณ',f(geometry.length,2)+' ม.','ค่าเริ่มต้น 1,000 ม.; ไม่ใช่ความยาวช่วงของสถานี'],
 ])+'<div class="note">ตีนจริงปรับตามท้องน้ำ โมเดลนี้ใช้คางหมูฐานราบสมมาตรและชั้นวัสดุแยกกัน ยังไม่หักรอยต่อ ส่วนทับซ้อน และปลายงาน จึงไม่ใช่ปริมาณสุทธิทั้งโครงการ ระดับน้ำในภาพเป็นบริบทที่ผู้ใช้บันทึก; ช่องที่ว่างจะไม่มีเส้นน้ำแทนค่าให้</div>'+sourceRef('S-DWG','รูปตัดต้นแบบ S6006-SD-02 · PDF หน้า 36 / แผ่น 35'));

add('รายการคำนวณรูปตัด', '<p class="eyebrow">03 / GEOMETRIC CALCULATIONS</p><h2>สูตรและการแทนค่าเรขาคณิต</h2><table class="formula-table geometry-formulas"><thead><tr><th>รายการ</th><th>สูตร / แทนค่า</th><th>ผล</th><th>หน่วย</th></tr></thead><tbody>'+calc.formulaRows.map(r=>'<tr><td>'+e(r.label)+'</td><td class="formula">'+e(r.formula)+'<small>'+e(r.substitution)+'</small></td><td class="n">'+f(r.value,4)+'</td><td>'+u(r.unit)+'</td></tr>').join('')+'</tbody></table><h3>วิธีอ่านผล</h3><p>ปริมาตรหินเรียง '+f(calc.rockVolume,3)+' ลบ.ม. คือพื้นที่ชั้นหินตามรูปตัดทฤษฎี × '+f(geometry.length,2)+' ม. ของสถานการณ์นี้ ขณะที่ BOQ ต้นฉบับ ใช้พื้นที่ที่ต่างกันในแต่ละสถานีและมีการหักบันได การไม่เท่ากันจึงอธิบายได้จากวิธีและขอบเขต ต้องไม่บังคับตัวเลขให้ตรงกันด้วยค่าชดเชยที่ไม่มีที่มา</p><p>พื้นที่ทรายขั้นต่ำ '+f(calc.sandMinArea,3)+' ตร.ม. แสดงเพียงชั้นความหนาคงที่ ไม่ใช่ทรายทั้งหมดระหว่างลาดออกแบบกับผิวดินจริง ปริมาตรตีนจำลอง '+f(calc.toeVolume,0)+' ลบ.ม. ใช้ฐานราบลึก '+f(geometry.toeDepth,3)+' ม. ของสถานการณ์นี้ จึงไม่แทนปริมาณหินทิ้งจากรูปตัดจริง</p><div class="method">หน่วย: H, R, S, t, L เป็น m<br>A เป็น m² · V = A × L เป็น m³<br>คำนวณเต็มความละเอียดก่อนแสดงผล ไม่ปัดค่าระหว่างสูตร</div>');

add('วิธีตรวจปริมาณ', '<p class="eyebrow">04 / QUANTITY METHOD & SOURCE DISCREPANCIES</p><h2>แยกสูตร ค่าต้นฉบับ และข้อมูลที่ขาด</h2><div class="method">Qᵢ = Aᵢ × Lᵢ [m³]<br>Qallowance,ᵢ = widthᵢ × 0.30 × Lᵢ [m³]<br>Ageotextile,ᵢ = sectionLengthᵢ × Lᵢ [m²]<br>Qreach = ROUNDDOWN(ΣQᵢ + sourceEndClosure, 0)<br>Qproject = Qreach1 + Qreach2</div><p>พื้นที่หน้าตัดและความยาวตามหน้าตัดมาจากชีต <b>หาปริมาณวัสดุ</b> ของ Excel ต้นฉบับ เดโม่นี้ตรวจเลขคูณและการรวมอิสระ ยังไม่วัดพื้นที่ใหม่จาก CAD การเลือก Lᵢ ตามต้นฉบับรวมได้ 286 และ 714 ม. โดยจุดเปลี่ยนช่วงอนุมานจากน้ำหนักระยะที่กำหนด</p>'+table(['ตัวอย่าง','แทนค่า','ผล'],[['หินเรียงสถานี 0+000','16.02 × 12.5','200.25 ลบ.ม.'],['แผ่นใยแถว 25','S25 × B25 = 40.425 × 23.5','949.9875 ตร.ม.; T25 ว่าง'],['ผลคูณดินถมที่ขาด 7 แถว','AJ125–132 เฉพาะแถวที่มี AI','รวม 871.725 ลบ.ม.'],['แถว 128','AI128 และ AJ128 ว่าง','ยังคำนวณแถวนี้ไม่ได้']])+'<h3>กติกาข้อมูลว่าง</h3><ul><li>ไม่มีพื้นที่ตั้งต้น → ผลคำนวณแถวนั้นเป็น “ไม่ทราบ” ไม่เปลี่ยนเป็นศูนย์</li><li>พื้นที่ครบแต่ผลคูณต้นฉบับว่าง → คำนวณได้และชี้ช่องผลคูณที่ขาด</li><li>รวมเฉพาะค่าที่ทราบได้ แต่ต้องแสดงจำนวนข้อมูลขาดและไม่เรียกว่าเป็นยอดครบ</li><li>ศูนย์ที่บันทึกในช่องผลต้นฉบับยังคงเป็น “ค่าที่ต้นฉบับบันทึก” หากตั้งต้นว่าง ก็ไม่ยืนยันว่าปริมาณกายภาพเป็นศูนย์</li></ul><h3>สองประเด็นที่มีผลต่อยอดรวม</h3><p>แผ่นใย: ค่าตั้งต้นครบทุกแถว ยอดเดิม 40,035 ตร.ม. เทียบยอดคำนวณซ้ำ 40,985 ตร.ม. เมื่อปัดลงแยกช่วง ผลต่าง 950 ตร.ม. ต่างจากผลคูณขาด 949.9875 เล็กน้อยเพราะลำดับการปัด</p><p>ดินถม: ยอดเดิม 1,694 ลบ.ม. เทียบยอดจากค่าที่ทราบ 2,566 ลบ.ม. หลังปัดแยกช่วง แต่ยังมีพื้นที่ตั้งต้นว่าง 2 ค่า จึงเป็นยอดบางส่วนสำหรับตรวจสอบ ไม่ใช่ยอดแก้ BOQ ที่อนุมัติแล้ว</p>'+sourceRef('S-XLS','หาปริมาณวัสดุ!B14:AJ132; F7 = 0.30 ม.')); 

add('แถวต้นฉบับของสถานีที่เลือก','<p class="eyebrow">05 / SELECTED SOURCE STATION</p><h2>ต้นฉบับที่ STA '+e(sta(selected.station))+' · '+e(selectedRow.reach)+'</h2><p>'+e(selected.sourceSheet)+' แถว '+selected.sourceRow+' · Lᵢ = '+f(selected.effectiveLength,2)+' ม. ข้อมูลต่อไปนี้เป็นค่าต้นฉบับและการคูณซ้ำตามแถวเดิม ไม่ได้แทนที่ด้วยพื้นที่จากรูปตัดทฤษฎีที่ผู้ใช้แก้</p>'+table(['องค์ประกอบ','ค่ารูปตัดเดิม','ผลเดิม','คูณซ้ำ','หน่วยผล','เซลล์ / สถานะ'],selectedRow.measures.map(m=>[
  e(m.label),f(m.value,4)+' '+u(m.inputUnit),f(m.cachedProduct,4),f(m.contribution,4),u(m.unit),
  '<code>'+e(m.valueCell)+' × '+e(selectedRow.lengthCell)+(m.multiplierCell?' × '+e(m.multiplierCell):'')+'</code><small>ผลเดิม '+e(m.productCell)+' · '+(m.value===null?'ค่าตั้งต้นว่าง':m.cachedProduct===null?'ผลเดิมว่าง แต่คำนวณได้':'มีข้อมูลเปรียบเทียบ')+'</small>',
]),'dense selected-source-table')+'<div class="note">ความยาวช่วง '+f(selected.effectiveLength,2)+' ม. ใช้เฉพาะการตรวจแถว BOQ นี้ ส่วนความยาวปริซึม '+f(geometry.length,2)+' ม. ในสถานการณ์เป็นค่าทดลองอีกขอบเขตหนึ่ง การเลือกสถานีไม่ได้ทำให้ SD-02 กลายเป็นหน้าตัดสำรวจของสถานีนั้น</div>'+sourceRef('S-XLS',e(selected.sourceSheet)+' แถว '+selected.sourceRow));

function stationPage(rows,title){
  const isSelected=row=>row.sourceSheet===selected.sourceSheet&&row.sourceRow===selected.sourceRow;
  return '<p class="eyebrow">05 / ORIGINAL STATION QUANTITIES</p><h2>'+title+'</h2><p>ข้อมูลต้นฉบับ 41 สถานีคงเดิม แสดงรายการหลักเพื่ออ่านสะดวก แถวที่เน้นคือบริบทของสถานการณ์นี้ หน่วยผล: หิน/ทราย/ดิน = ลบ.ม.; แผ่นใย = ตร.ม.</p>'+table(['ช่วง / STA','แถวเดิม','Lᵢ (ม.)','หินเรียง','ทรายหน้า¹','แผ่นใย','ดินถม'],rows.map(r=>{
    const m=k=>r.measures.find(x=>x.key===k);return[e(r.reach)+' / '+e(sta(r.station))+(isSelected(r)?'<small>สถานีที่เลือก</small>':''),r.sourceRow,f(r.effectiveLength,2),f(m('riprap_facing').contribution),f(m('sand_fill_front_section').contribution),f(m('geotextile_front').contribution),f(m('earth_fill').contribution)];
  }),'dense',rows.map(r=>isSelected(r)?' class="selected-station" data-selected-station="'+e(selected.id)+'"':''))+'<p class="minor">¹ ทรายหน้าในตารางนี้เป็นเฉพาะพื้นที่รูปตัด × Lᵢ ยังไม่รวมรายการเผื่อและงานปิดหัวท้าย<br>— = ข้อมูลตั้งต้นไม่พอ; ศูนย์ที่มีตัวเลข = ตั้งต้นระบุศูนย์ไว้จริง<br>พื้นที่/ผลเดิมตรวจได้ที่ V/W (หิน), N/O (ทราย), S/T (ใย), AI/AJ (ดิน), B (Lᵢ) ของชีต หาปริมาณวัสดุ</p><div class="note">ยอดตารางนี้เป็นการคำนวณแต่ละสถานีโดยไม่ปัดกลางทาง การถอดปริมาณสุทธิยังมีการรวมรายการเผื่อ งานปิดหัวท้าย และหักองค์ประกอบตามเอกสาร ตารางนี้ไม่เปลี่ยนจากการแก้สถานการณ์เรขาคณิตหรือคาน/ดิน</div>';
}
add('ต้นฉบับสถานี 0+000 ถึง 0+500',stationPage(audit.rows.slice(0,21),'ต้นฉบับ 41 สถานี · ส่วนที่ 1 / 2'));
add('ต้นฉบับสถานี 0+525 ถึง 1+000',stationPage(audit.rows.slice(21),'ต้นฉบับ 41 สถานี · ส่วนที่ 2 / 2'));

add('ยอดรวมและความครบถ้วน', '<p class="eyebrow">06 / RECONCILIATION</p><h2>ผลรวม BOQ ต้นฉบับและความครบถ้วน</h2><p>ขอบเขตเดิม 1,000 ม. = 286 + 714 ม. ค่าตารางนี้ไม่เปลี่ยนตามมิติหรือความยาวปริซึมในสถานการณ์</p>'+table(['รายการ','ยอดเดิม','ยอดที่ทราบคำนวณซ้ำ','หน่วย','ความครบ'],Object.entries(audit.composedTotals).map(([k,r])=>[AGGREGATE_LABELS[k],f(r.sourceAdoptedValue,0),f(r.roundedDownKnownValue,0),u(r.unit),r.complete?'ครบ':r.missingCount+' ค่าตั้งต้นว่าง']),'dense')+'<p>“ยอดที่ทราบคำนวณซ้ำ” รวมผลที่หาค่าได้และใช้ส่วนปิดหัวท้ายที่ต้นฉบับระบุ จากนั้นปัดลงแต่ละช่วง ข้อมูลตั้งต้นที่ขาดยังคงแยกสถานะ ไม่เติมศูนย์เพื่อทำให้ยอดครบ</p>'+table(['องค์ประกอบแยก','รวมค่าที่คำนวณได้','ค่าตั้งต้นว่าง','ผลเดิมว่าง'],Object.entries(audit.totals).map(([k,r])=>[source.columns[k].labelTH,f(r.knownValue)+' '+u(r.unit),r.missingCount,r.sourceMissingCount]),'dense')+'<h3>หักบันไดและงานนอกขอบเขตรูปตัดทฤษฎี</h3><p>ต้นฉบับหักหินเรียงบันไดช่วง 1 จำนวน 86 ลบ.ม. และช่วง 2 จำนวน 172 ลบ.ม. จากยอดก่อนหัก 17,295 เหลือ 17,037 ลบ.ม. มีช่องปรับอื่นว่างจึงบันทึกยอดสุทธินี้เป็นค่าเดิม รายการทางเท้า ราวกันตก คันหิน บ่อพัก และ mattress ต้องตรวจตามแบบรายละเอียดและรุ่น BOQ ของตัวเอง</p>');

for(const item of engineeringReportSections({beamInputs:scenario.beamInputs,soilInputs:getSoilInputs(scenario)}))add(item.title,item.body);

add('ข้อมูลดินและผลเสถียรภาพเดิม', '<p class="eyebrow">09 / ORIGINAL GEOTECHNICAL EVIDENCE</p><h2>ค่าดินและกรณีเสถียรภาพในเอกสาร</h2><div class="note historical-analysis" data-analysis-status="requires-new-analysis">'+(baseline?'ค่าของสถานการณ์นี้ตรงต้นแบบที่กำหนด แต่ยังไม่ได้สร้างหรือรับรองแบบจำลอง Slope/W ของสถานีนี้':'สถานการณ์มีข้อมูลต่างจากต้นแบบ ต้องวิเคราะห์ระบบและกรณีน้ำใหม่ก่อนรับรองแบบที่แก้')+' ผลเดิมด้านล่างเป็นหลักฐานอ้างอิงเท่านั้น ไม่ใช่ผลวิเคราะห์ของ snapshot นี้</div>'+table(['วัสดุ','γ (kN/m³)','c ตามหัวตาราง (kPa)','φ ตามหัวตาราง (°)'],SOIL_SOURCE.map(row=>row.map(v=>v===null?'—':v)))+sourceRef('S-CALC','รายการคำนวณ S6006 PDF หน้า 16')+'<p>เครื่องหมายขีดไม่ถือเป็นเลขศูนย์อัตโนมัติ ค่า c ของดินเหนียวต้องยืนยันความหมายและสภาพระบายน้ำก่อนนำไปเป็น Su หรือ c′ ส่วนค่าที่ใช้คำนวณลาดอนันต์ในรายงานฉบับนี้แสดงในส่วนสถานการณ์ด้านดิน โดยยังเป็นสมมติฐานที่ต้องตรวจฐานการทดสอบ ไม่ได้นำขีดในเอกสารมาเปลี่ยนเป็นศูนย์</p>'+table(['กรณี','FS ที่รายงาน','เกณฑ์ในรายงาน','หน้า'],REPORTED_FS.map(r=>[r.case,r.value.toFixed(3),r.criterion.toFixed(1),r.page]))+'<p>ทั้งหมดเป็นผล Slope/W เดิม ยังไม่ได้รันแบบจำลองเดิมซ้ำ ไม่ใช่ผลของสถานการณ์นี้และไม่เปลี่ยนตามการแก้มิติใหม่ เกณฑ์ 1.3 / 1.5 เป็นเกณฑ์ในรายงานนี้ ไม่ประกาศว่าเป็นเกณฑ์สากลของทุกโครงการ</p><h3>การสำรวจที่มีและการเชื่อมข้อมูลที่ยังต้องทำ</h3><p>ชุดแบบและรายงานมี borehole และผลทดสอบ เช่น BH-1, BH-2, BH-3 ในแบบ GT-01 (PDF หน้า 44) พร้อมชั้นดินและ SPT จึงไม่ใช่โครงการที่ไม่มีข้อมูลดิน แต่ต้องยืนยันตำแหน่งหลุม ระดับผิวดิน วิธีแปลงผลทดสอบ พารามิเตอร์ออกแบบ และหน้าตัดที่นำไปวิเคราะห์ให้สัมพันธ์กัน</p><h3>เงื่อนไขที่มีผลต่อการวิเคราะห์จริง</h3><ul><li>หน้าตัดพื้นที่จริงและชั้นดินหลายชั้น รวมผิววิบัติที่อาจผ่านตีนหรือฐานเขื่อน</li><li>แรงดันน้ำเริ่มต้น น้ำคงตัว น้ำลดตามเวลา และความสามารถระบายของดิน</li><li>แรงบรรทุก การก่อสร้างตามขั้น และกำลังดินที่สอดคล้องกับช่วงเวลานั้น</li><li>การทรุดตัว การเคลื่อนตัว การกัดเซาะ และระบบเสาเข็ม/ฐานรากขององค์ประกอบ</li></ul>');

add('ชลศาสตร์และการตรวจทั้งระบบ', '<p class="eyebrow">10 / HYDRAULICS & SYSTEM CHECKS</p><h2>ข้อมูลที่เชื่อมไปสู่การออกแบบครบระบบ</h2><h3>ขนาดหินและชั้นป้องกัน</h3><p>รายการคำนวณหน้า 2–3 มีความสัมพันธ์ของความหนาชั้นป้องกันกับกระแสน้ำและคลื่น แต่ไม่มีชุดค่าตัวเลขเฉพาะพื้นที่ครบให้ตรวจขนาดหินได้</p><div class="method">Δm D = 0.035 (φ/ψ) (Kₜ Kₕ/Kₛ) (u_cr² / 2g)<br>Hₛ / (Δm D) = φ cos α / √ζz</div><p>สัญลักษณ์ φ ในสมการชลศาสตร์นี้เป็นสัมประสิทธิ์ตามนิยามของสมการเดิม ไม่ใช่มุมเสียดทานดิน φ′ และไม่ใช่ตัวคูณลดกำลังคอนกรีต ต้องเก็บชื่อ หน่วย และแหล่งนิยามแยกกัน</p>'+table(['ต้องมีข้อมูล','ใช้ตัดสินใจ'],[['อัตราการไหล/ความเร็วและทิศทางที่หน้าตลิ่ง','แรงกระทำและขนาดหินที่ต้องการ'],['ระดับน้ำตามเวลาและการลดระดับน้ำ','แรงดันน้ำ/น้ำซึมและกรณีเปลี่ยนผ่าน'],['ท้องน้ำและการกัดเซาะคาดการณ์','ระดับและความลึกตีนเขื่อน'],['น้ำหนักจำเพาะหิน การคละ และความหนา','เสถียรภาพผิวหน้าหินและการจัดวาง'],['ระบบกรอง/ใยสังเคราะห์และคุณสมบัติดิน','การสูญเสียเม็ดดิน การระบาย และความเข้ากันได้ของชั้นวัสดุ']])+'<h3>ลำดับที่แนะนำสำหรับการรับรองโครงการจริง</h3><ol><li>ตกลงชุดแบบ/BOQ/รายงานรุ่นเดียวกันและขอบเขตสถานี</li><li>ตรวจพิกัด ระดับ ผิวดิน ท้องน้ำ หลุมเจาะ และเงื่อนไขน้ำ</li><li>วิเคราะห์เสถียรภาพรวมและการเคลื่อนตัวในกรณีก่อสร้าง ใช้งาน และน้ำลด</li><li>ส่งแรงที่มีหน่วยและกรณีชัดเจนเข้าโมดูลโครงสร้าง ตรวจทุกองค์ประกอบและจุดต่อ</li><li>ตรวจชลศาสตร์ การกัดเซาะ ระบบกรอง และรายละเอียดก่อสร้าง</li><li>สรุปรายการคำนวณตามมาตรฐานที่เลือก ให้ผู้ตรวจและผู้ออกแบบรับรอง</li></ol><div class="note">เดโม่ช่วยให้ขั้นตอนและเลขคำนวณตรวจสอบได้ การมีโมดูลคำนวณบางส่วนไม่ได้ทำให้ขั้นตอนที่ยังไม่มีข้อมูลกลายเป็นรายการผ่าน</div>');

add('บทเรียนจากหกชุดแบบ', '<p class="eyebrow">11 / SIX-CATEGORY REVIEW</p><h2>ความรู้ที่นำมาปรับโครงสร้างของแอป</h2>'+table(['โครงการ / ระบบ','ข้อค้นพบที่มีผลต่อแอป'],CASE_REVIEWS.map(c=>['<b>'+c.code+'</b><br>'+c.type+'<br><small>'+c.scope+'</small>',c.system+'<br><br><b>ทบทวน:</b> '+c.finding+'<br><small>บทเรียน: '+c.lesson+'</small>']),'review-table')+'<p class="minor">ทะเบียนไฟล์หลังช่วงรออัปโหลด: L-Wall 19, พื้นยื่น/โต๊ะ 21, เสาเข็ม+หินเรียง 23, เสาเข็ม+หินทิ้ง 34, เกเบี้ยน 29, หินเรียง 53 รวม 179 ไฟล์ การอ่านเนื้อหามุ่งแบบ PDF รายงาน BOQ และไฟล์แบบจำลองที่ระบุในบันทึกการรีวิว ไม่ได้อ้างว่าเปิดตรวจทุก DWG entity หรือรันทุก native model</p>');

add('คำถามสำหรับวิศวกร 1', '<p class="eyebrow">12 / ENGINEER QUESTIONS</p><h2>คำตอบที่มีหลักฐาน · ส่วนที่ 1</h2>'+QUESTIONS.slice(0,4).map(([q,a])=>'<article class="question"><h3>'+q+'</h3><p>'+a+'</p></article>').join('')+'<h3>ตัวอย่างอธิบายสายที่มาของปริมาณ</h3><div class="method">หาปริมาณวัสดุ!S25 = 40.425 m<br>หาปริมาณวัสดุ!B25 = 23.5 m<br>สูตรอิสระ: 40.425 × 23.5 = 949.9875 m²<br>ผลคูณ T25 ในต้นฉบับ = ช่องว่าง<br>แสดงผลตรวจ: คำนวณได้ / ยังไม่แก้ไขต้นฉบับ</div><h3>ตัวอย่างอธิบายสายที่มาของกำลัง</h3><p>แบบ SD-05 ให้หน้าตัดและเหล็ก BF1; รายการคำนวณหน้า 3 ให้กำลังวัสดุ; cover และรูปแบบรองรับเป็นสมมติฐานที่ต้องยืนยัน; สมการกำลังระบุฉบับและข้อจำกัด; แรงออกแบบจริงต้องมาจากกรณีแรงของระบบ ไม่ใช่ใช้แรงน้ำหนักตัวเองแทนทุกกรณี</p>');

add('คำถามสำหรับวิศวกร 2', '<p class="eyebrow">13 / ENGINEER QUESTIONS</p><h2>คำตอบที่มีหลักฐาน · ส่วนที่ 2</h2>'+QUESTIONS.slice(4).map(([q,a])=>'<article class="question"><h3>'+q+'</h3><p>'+a+'</p></article>').join('')+'<h3>แบบบันทึกการส่งตรวจที่ควรแนบทุกครั้ง</h3><ul><li>รหัสโครงการ / รุ่นแบบ / วันที่ข้อมูลสำรวจและค่าดิน</li><li>มาตรฐานและเกณฑ์ที่ใช้ พร้อมชนิดพารามิเตอร์และหน่วย</li><li>ค่าตั้งต้น สมมติฐาน วิธีวิเคราะห์ และกรณีแรง/น้ำ</li><li>สูตรและผลที่สร้างใหม่ แยกจากค่ารายงานภายนอก</li><li>รายการข้อมูลที่ขาด ประเด็นที่รอยืนยัน และผลทดสอบซอฟต์แวร์</li></ul><div class="signature"><span>ผู้จัดทำ / รุ่นข้อมูล</span><span>ผู้ตรวจสอบ / วันที่</span><span>ผู้ออกแบบรับรอง / วันที่</span></div>');

add('แหล่งข้อมูลและการทดสอบ', '<p class="eyebrow">14 / REFERENCES & VERIFICATION</p><h2>เปิดแหล่งข้อมูลและตรวจซ้ำได้</h2>'+table(['รหัส / แหล่ง','ตำแหน่งและการใช้'],SOURCE_FILES.map(s=>['<a href="https://drive.google.com/file/d/'+s.id+'/view">'+s.key+' · '+s.title+'</a>',s.location+'<br><small>'+s.use+'</small>']),'source-table')+'<h3>ฐานสมการที่ค้นเพิ่มเติม</h3><ol>'+METHOD_SOURCES.map(s=>'<li><a href="'+s.url+'">'+s.title+'</a><br><span class="minor">'+s.location+' · '+s.use+'</span></li>').join('')+'</ol><h3>การตรวจความถูกต้องของซอฟต์แวร์</h3><p>ชุดทดสอบตรวจสูตรเรขาคณิตจากค่าที่คำนวณด้วยมือ ตรวจความยาวรวม 1,000 ม. ตรวจยอดและช่องว่างกับข้อมูลต้นฉบับ ตรวจการปัดลงแยกช่วง ตรวจหน่วย การรับข้อมูลผิดรูปแบบ และการคงค่าต้นฉบับเมื่อแก้มิติ รวมทั้งเกณฑ์ของโมดูลโครงสร้าง/ดินในขอบเขตที่ประกาศ</p><p>การทดสอบเบราว์เซอร์เปิดโมเดลและตารางจริง ตรวจการแก้มิติ ส่งออก–นำเข้า และการแสดงผลบนจอใหญ่/มือถือ รายงานผลทดสอบเก็บเป็นหลักฐานใน GitHub Actions ของ PR รุ่นนั้น</p><h3>ตำแหน่งโค้ดและข้อมูล</h3><p><a href="https://github.com/saratchai1/riverbank-dam-types">github.com/saratchai1/riverbank-dam-types</a><br><code>projects/s6006/engine.js</code> — รูปทรงและปริมาณ<br><code>projects/s6006/engineering.js</code> — โครงสร้างและดิน<br><code>projects/s6006/source-data.json</code> — ค่าที่อ่านจากต้นฉบับ<br><code>projects/s6006/source-fingerprints.json</code> — SHA-256 ของแหล่งหลัก<br><code>docs/source-review/</code> — บันทึกรีวิวและทะเบียน 179 ไฟล์</p><div class="note">ไฟล์ต้นฉบับจากผู้ใช้ไม่ได้ถูกรัน macro หรือแก้สูตรเดิม รายงานนี้เป็นการคำนวณและทบทวนที่แยกจากเอกสารออกแบบต้นฉบับ ผลตรวจต้องอ่านร่วมกับขอบเขตของแต่ละรายการ</div>');

  return {pages,metadata};
}

export function renderReportPages({pages,metadata}){
  const timestamp=metadata.mode==='snapshot'?metadata.createdAtDisplay:'อ้างอิง '+referenceDate;
  return pages.map((page,i)=>'<section class="report-page" data-page-title="'+e(page.title)+'"><header class="running-head"><span>RIVERBANK STUDIO / '+e(metadata.projectCode)+' · STA '+e(metadata.stationLabel)+'</span><span>'+e(metadata.calculationRevision)+' · '+(metadata.mode==='snapshot'?'SNAPSHOT':'REFERENCE BASELINE')+'</span></header>'+page.body+'<footer class="running-foot"><div class="foot-context"><span>Project '+e(metadata.projectRevision)+' · Scenario '+e(metadata.scenarioId)+'</span><span>'+e(metadata.calculationRevision)+' · '+e(timestamp)+'</span></div><div class="foot-page"><span>'+e(page.title)+'</span><strong>'+String(i+1).padStart(2,'0')+' / '+pages.length+'</strong></div></footer></section>').join('');
}

/** A requested snapshot is mandatory: a resolution error never falls back to defaults. */
export async function mountReport({document:doc=globalThis.document,window:view=globalThis.window}={}){
  const host=doc.querySelector('#report-ready'),printButton=doc.querySelector('#print-report');
  const errorBox=doc.querySelector('#report-error'),status=doc.querySelector('#report-status');
  const showError=error=>{
    host.dataset.ready='false';host.dataset.error='true';host.setAttribute('aria-busy','false');host.replaceChildren();
    doc.body.dataset.reportState='blocked';printButton.disabled=true;
    status.textContent='ไม่สามารถจัดรายงานจากชุดข้อมูลที่ร้องขอ';
    errorBox.hidden=false;
    errorBox.innerHTML='<h1>ยังพิมพ์รายงานนี้ไม่ได้</h1><p>'+e(error?.message||'ไม่สามารถอ่านข้อมูลรายงานได้')+'</p><p>ไม่มีการแทน snapshot ที่ขาดหรือเสียหายด้วยค่าต้นแบบ กรุณากลับไปเปิดโครงการและสร้างรายงานจากสถานการณ์ที่ยอมรับอีกครั้ง</p><a href="index.html">กลับไปโครงการ S6006</a>';
  };
  printButton.disabled=true;doc.body.dataset.reportState='loading';
  printButton.addEventListener('click',()=>{if(host.dataset.ready==='true')view.print();});
  view.addEventListener('beforeprint',()=>{
    if(host.dataset.ready!=='true')showError(new Error('ข้อมูลรายงานยังไม่พร้อมหรือ snapshot ไม่ถูกต้อง การพิมพ์ผลคำนวณถูกระงับ'));
  });
  try{
    const response=await view.fetch('source-data.json');
    if(!response.ok)throw new Error('อ่านชุดข้อมูลอ้างอิงของ S6006 ไม่สำเร็จ');
    const source=await response.json();
    const resolved=loadReportProject({search:view.location.search,storage:view.localStorage,source});
    const snapshotToken=new URLSearchParams(view.location.search).get('snapshot');
    const record=buildReportPages({...resolved,source,snapshotToken});
    host.innerHTML=renderReportPages(record);
    host.dataset.mode=record.metadata.mode;
    host.dataset.projectRevision=record.metadata.projectRevision;
    host.dataset.scenarioRevision=record.metadata.scenarioRevision;
    host.dataset.stationId=record.metadata.selectedStationId;
    host.dataset.scenarioId=record.metadata.scenarioId;
    host.dataset.snapshot=snapshotToken||'';
    if(doc.fonts?.ready)await doc.fonts.ready;
    host.dataset.ready='true';host.dataset.error='false';host.setAttribute('aria-busy','false');errorBox.hidden=true;
    doc.body.dataset.reportState='ready';printButton.disabled=false;
    status.textContent=record.metadata.mode==='snapshot'?'S6006 / สถานการณ์ที่บันทึก · STA '+record.metadata.stationLabel:'S6006 / ค่าต้นแบบอ้างอิง · ไม่มี snapshot';
    doc.title='S6006 · STA '+record.metadata.stationLabel+' · '+(record.metadata.mode==='snapshot'?'รายงานสถานการณ์':'รายงานอ้างอิง');
    return {status:'ready',record};
  }catch(error){showError(error);return {status:'blocked',error};}
}

if(typeof document!=='undefined'&&typeof window!=='undefined'&&document.querySelector('#report-ready')){
  void mountReport();
}
