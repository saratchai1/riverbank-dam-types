import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {
  createProject, stationCatalog, updateActiveScenario, selectStation, saveAlternative,
  applyAlternative, serializeProject, projectRevision,
} from '../projects/s6006/project.js';
import {buildReview, selectReview, reviewCSV} from '../projects/s6006/review.js';

// Synthetic alternatives run in fresh browser contexts; no user project is edited.
export async function runS6006ReviewChecks({newPage,check,screenshot,assertNoErrors,assertNoOverflow,download,chooseFile,changeValue,baseURL,output}) {
  const source=JSON.parse(await readFile(new URL('../projects/s6006/source-data.json',import.meta.url),'utf8'));
  const [first,second]=stationCatalog(source);
  const desktop=await newPage('S6006 engineering review desktop',{width:1440,height:1050});
  const p=desktop.page;
  const panel=async(page,name)=>{
    await page.locator('#case-tabs [data-panel="'+name+'"]').click();
    await page.locator('#panel-'+name).waitFor({state:'visible'});
  };
  const ready=async page=>{
    await page.waitForFunction(()=>['true','error'].includes(document.body.dataset.ready));
    assert.equal(await page.locator('body').getAttribute('data-ready'),'true',await page.locator('#notice').textContent());
  };
  const importProject=async(page,project,name)=>{
    const file=path.join(output,'fixtures',name);
    await writeFile(file,serializeProject(project,source));
    await chooseFile(page,'#load-case',file);
    const revision=projectRevision(project);
    await page.waitForFunction(expected=>document.querySelector('#project-revision')?.textContent===expected&&document.querySelector('#notice')?.textContent.includes('เปิดโครงการครบ'),revision);
    return file;
  };
  const finding=(page,id)=>page.locator('#review-detail [data-review-finding="'+id+'"]');
  const inspect=async(page,key)=>{
    await page.locator('[data-review-inspect][data-review-entry-key="'+key+'"]').click();
    assert.equal(await page.locator('#review-detail').getAttribute('data-entry-key'),key);
  };
  const openReport=async page=>{
    const [report]=await Promise.all([page.waitForEvent('popup'),page.locator('#report-review').click()]);
    await report.waitForFunction(()=>document.querySelector('#review-report-ready')?.dataset.ready==='true'||document.body.dataset.reportState==='blocked');
    assert.equal(await report.locator('#review-report-ready').getAttribute('data-ready'),'true',await report.locator('#review-report-error').textContent());
    return report;
  };
  const printReport=async(page,name)=>{
    await page.emulateMedia({media:'print'});
    await page.setViewportSize({width:680,height:1100});
    await page.evaluate(()=>document.fonts.ready);
    const metrics=await page.locator('.report-page').evaluateAll(pages=>pages.map((sheet,index)=>{
      const footer=sheet.querySelector('.running-foot').getBoundingClientRect();
      const bottom=Math.max(...[...sheet.children].filter(node=>!node.classList.contains('running-foot')).map(node=>node.getBoundingClientRect().bottom));
      return {page:index+1,title:sheet.dataset.pageTitle,bottom,footerTop:footer.top,clearance:footer.top-bottom,fits:bottom<=footer.top-12};
    }));
    assert.ok(metrics.length>=4);
    await writeFile(path.join(output,name+'-page-metrics.json'),JSON.stringify(metrics,null,2));
    assert.deepEqual(metrics.filter(row=>!row.fits),[],'Every review page clears the footer');
    const file=path.join(output,name+'.pdf');
    await page.pdf({path:file,format:'A4',printBackground:true,preferCSSPageSize:true});
    const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8',maxBuffer:25*1024*1024});
    assert.ok((text.match(/[ก-๙]/g)||[]).length>500,'Readable Thai survives PDF export');
    assert.ok(text.includes('S6006-REVIEW-1'));
    await writeFile(path.join(output,name+'.txt'),text);
    await page.emulateMedia({media:'screen'});
    return {text,metrics};
  };
  let project=createProject(source);
  const stamp='2026-11-22T01:00:00.000Z';
  project=saveAlternative(project,'A · ค่าต้นแบบ',source,{id:'review-a',createdAt:stamp});
  project=updateActiveScenario(project,{
    geometry:{slopeH:3.5},
    beamInputs:{tensionBarDiameterMm:16,stirrupDiameterMm:8,externalMuKnM:30,externalVuKn:50},
    context:{waterHighLevel:0,waterLowLevel:0,groundwaterLevel:0,boreholeReference:'BH-TEST · synthetic only',waterReference:'TEST datum',sourceNote:'ค่าใช้ทดสอบซอฟต์แวร์ ไม่มีการยืนยันแบบจริง'},
  },source);
  project=saveAlternative(project,'B · ลาด 3.5 เหล็ก Ø16',source,{id:'review-b',createdAt:stamp});
  project=updateActiveScenario(project,{soilInputs:{mode:'undrained',undrainedStrengthKpa:null}},source);
  project=saveAlternative(project,'C · รอ Su',source,{id:'review-c',createdAt:stamp});
  project=applyAlternative(project,'review-b',source);
  project=updateActiveScenario(project,{beamInputs:{externalMuKnM:100}},source);
  project=selectStation(project,second.id,source);
  project=updateActiveScenario(project,{context:{sourceNote:'แก้ข้อความอย่างเดียว ยังไม่ได้ยืนยันข้อมูลสำรวจ'}},source);
  project=selectStation(project,first.id,source);
  let reviewReport,reportText,reportURL,fixtureFile;

  await check('S6006 review distinguishes baseline station contexts, missing demand, gated capacity and separate soil cases',async()=>{
    await p.goto(baseURL+'/projects/s6006/');await ready(p);await panel(p,'review');
    assert.equal(await p.locator('#review-station option').count(),42);
    assert.equal(await p.locator('#review-content').getAttribute('data-included-count'),'1');
    assert.equal(await finding(p,'beam.external-moment').getAttribute('data-disposition'),'missing');
    assert.equal(await finding(p,'beam.usable-moment').getAttribute('data-availability'),'gated');
    assert.equal(await finding(p,'beam.usable-moment').locator('.review-finding-value').innerText(),'—');
    assert.equal(await finding(p,'soil.dry').getAttribute('data-disposition'),'computed-only');
    assert.equal(await finding(p,'soil.parallel-seepage').getAttribute('data-disposition'),'attention');
    assert.equal(await finding(p,'soil.undrained').getAttribute('data-availability'),'not-applicable');
    await p.locator('#review-kind').selectOption('saved');
    assert.equal(await p.locator('#report-review').isDisabled(),true);
    assert.equal(await p.locator('#export-review').isDisabled(),true);
    await p.locator('#review-kind').selectOption('all');
    fixtureFile=await importProject(p,project,'s6006-review-project.json');await panel(p,'review');
    assert.equal(await p.locator('#review-content').getAttribute('data-included-count'),'4');
    assert.equal(await finding(p,'beam.external-moment').getAttribute('data-disposition'),'attention');
    await inspect(p,first.id+'/review-b');
    assert.equal(await finding(p,'beam.external-moment').getAttribute('data-disposition'),'condition-met');
    assert.equal(await finding(p,'context.waterHighLevel').getAttribute('data-disposition'),'recorded');
    assert.equal(await finding(p,'context.waterHighLevel').locator('.review-finding-value').innerText(),'0');
    await inspect(p,first.id+'/review-c');
    assert.equal(await finding(p,'soil.undrained').getAttribute('data-disposition'),'missing');
    assert.equal(await finding(p,'soil.dry').getAttribute('data-availability'),'not-applicable');
    assert.equal(await finding(p,'soil.undrained').locator('.review-finding-value').innerText(),'—');
    await p.locator('#review-station').selectOption('all');
    assert.equal(await p.locator('#review-content').getAttribute('data-included-count'),'44');
    await p.locator('#review-focus').selectOption('baseline');
    assert.equal(await p.locator('#review-content').getAttribute('data-included-count'),'40','39 current defaults plus saved baseline A');
    assert.equal(await p.locator('[data-review-entry-key="'+second.id+'/current"]').count(),0,'Context-only edit differs from baseline but is not verified');
    await p.locator('#review-station').selectOption(first.id);await p.locator('#review-focus').selectOption('all');
    await inspect(p,first.id+'/current');
    await p.locator('#review-content').scrollIntoViewIfNeeded();
    await screenshot(p,'s6006-review-desktop.png',false);
    await assertNoOverflow(p,'Review desktop');assertNoErrors(desktop.diagnostics);
  });

  await check('S6006 review navigates to exact current inputs and inspects saved alternatives without overwriting working data',async()=>{
    await inspect(p,first.id+'/review-c');
    const revision=await p.locator('#project-revision').innerText();
    await finding(p,'soil.undrained').locator('[data-review-navigate]').click();
    assert.equal(await p.locator('#panel-comparison').isVisible(),true);
    assert.equal(await p.locator('#project-revision').innerText(),revision);
    assert.equal(await p.locator('#soil-form [name="mode"]').inputValue(),'effective');
    assert.equal(await p.locator('#beam-form [name="externalMuKnM"]').inputValue(),'100');
    assert.equal(await p.locator('.alternative-card[data-alternative-id="review-c"]').evaluate(el=>el===document.activeElement),true);
    await panel(p,'review');await p.locator('#review-station').selectOption(second.id);
    await inspect(p,second.id+'/current');
    await finding(p,'beam.external-moment').locator('[data-review-navigate]').click();
    assert.equal(await p.locator('#station-select').inputValue(),second.id);
    assert.equal(await p.locator('#panel-engineering').isVisible(),true);
    assert.equal(await p.locator('#beam-form [name="externalMuKnM"]').evaluate(el=>el===document.activeElement),true);
    await changeValue(p,'#beam-form [name="externalMuKnM"]',0);
    await panel(p,'review');
    assert.equal(await finding(p,'beam.external-moment').getAttribute('data-availability'),'gated','Entered zero is supplied but cannot bypass withheld capacity');
    await finding(p,'context.boreholeReference').locator('[data-review-navigate]').click();
    assert.equal(await p.locator('#context-form [name="boreholeReference"]').evaluate(el=>el===document.activeElement),true);
    assert.equal(await p.locator('#context-form').evaluate(el=>el.closest('details').open),true);
    await importProject(p,project,'s6006-review-project.json');await panel(p,'review');
    await p.locator('#review-focus').selectOption('attention');
    const selected=selectReview(buildReview(project,source),{stationId:first.id,kind:'all',focus:'attention'});
    assert.equal(await p.locator('#review-content').getAttribute('data-included-count'),String(selected.includedCount));
    const csv=await download(p,'#export-review','s6006-review-filtered.csv');
    assert.equal(await readFile(csv,'utf8'),reviewCSV(buildReview(project,source),selected.selection));
    assert.ok((await readFile(csv,'utf8')).includes('condition-met'),'Entry filter retains every included finding');
    await p.locator('#review-focus').selectOption('all');
    const saved=await download(p,'#save-case','s6006-review-roundtrip.json');
    assert.equal(projectRevision(JSON.parse(await readFile(saved,'utf8'))),projectRevision(project));
    await p.reload();await ready(p);await panel(p,'review');
    assert.equal(await p.locator('#review-content').getAttribute('data-included-count'),'4');
    assertNoErrors(desktop.diagnostics);
  });

  await check('S6006 review reports freeze scope and findings and print all current and saved scenario conditions',async()=>{
    reviewReport=await openReport(p);reportURL=reviewReport.url();
    assert.equal(await reviewReport.locator('#review-report-ready').getAttribute('data-entry-count'),'4');
    assert.equal(await reviewReport.locator('#review-report-ready').getAttribute('data-project-revision'),projectRevision(project));
    reportText=await reviewReport.locator('#review-report-ready').innerText();
    for(const marker of ['A · ค่าต้นแบบ','B · ลาด 3.5 เหล็ก Ø16','C · รอ Su','60.474','100','S6006-REVIEW-1','Asia/Bangkok'])assert.ok(reportText.includes(marker),'Review report retains '+marker);
    await panel(p,'engineering');await changeValue(p,'#beam-form [name="externalMuKnM"]',0);
    await reviewReport.reload();await reviewReport.waitForFunction(()=>document.querySelector('#review-report-ready')?.dataset.ready==='true');
    assert.equal(await reviewReport.locator('#review-report-ready').innerText(),reportText);
    await screenshot(reviewReport,'s6006-review-report.png',false);
    await printReport(reviewReport,'S6006-engineering-review');
    const baseline=createProject(source);
    await importProject(p,baseline,'s6006-review-baseline.json');await panel(p,'review');await p.locator('#review-station').selectOption('all');
    const all=await openReport(p);
    assert.equal(await all.locator('#review-report-ready').getAttribute('data-entry-count'),'41');
    assert.equal(await all.locator('#review-report-ready').getAttribute('data-group-count'),'1','Identical baseline inputs stay one labeled findings set, not 41 independent designs');
    assert.equal(await all.locator('[data-review-entry-key]').count(),41);
    await printReport(all,'S6006-engineering-review-all-stations');await all.close();
    assertNoErrors(desktop.diagnostics);
  });

  await check('S6006 review refuses altered scope and missing snapshots and preserves complete escaped long context',async()=>{
    const blocked=await desktop.context.newPage();
    for(const suffix of ['review-report.html','review-report.html?snapshot=missing-review-000']){
      await blocked.goto(baseURL+'/projects/s6006/'+suffix);
      await blocked.waitForFunction(()=>document.body.dataset.reportState==='blocked');
      assert.equal(await blocked.locator('#print-review-report').isDisabled(),true);
      assert.equal(await blocked.locator('.report-page').count(),0);
    }
    const token=new URL(reportURL).searchParams.get('snapshot');
    await p.evaluate(id=>{
      const key='riverbank.s6006.review-snapshot.v1.'+id;
      const value=JSON.parse(localStorage.getItem(key));
      value.selection.kind='saved';
      localStorage.setItem(key,JSON.stringify(value));
    },token);
    await blocked.goto(reportURL);await blocked.waitForFunction(()=>document.body.dataset.reportState==='blocked');
    assert.equal(await blocked.locator('#print-review-report').isDisabled(),true);
    const longText=marker=>('เอกสารอ้างอิง <script>ไม่ได้เรียกใช้</script>\n'.repeat(45)).slice(0,1850)+marker;
    let long=createProject(source);
    long=updateActiveScenario(long,{context:{boreholeReference:longText('END_BOREHOLE'),waterReference:longText('END_WATER'),sourceNote:longText('END_NOTE')}},source);
    long=saveAlternative(long,('ก\n'.repeat(23)+'กก'),source,{id:'long-review',createdAt:stamp});
    await importProject(p,long,'s6006-review-long.json');await panel(p,'review');
    await p.locator('#review-kind').selectOption('saved');
    const longReport=await openReport(p);
    const text=await longReport.locator('#review-report-ready').innerText();
    for(const marker of ['END_BOREHOLE','END_WATER','END_NOTE','<script>ไม่ได้เรียกใช้</script>'])assert.ok(text.includes(marker));
    assert.equal(await longReport.locator('#review-report-ready script').count(),0);
    await printReport(longReport,'S6006-engineering-review-long-context');
    await longReport.close();await blocked.close();
  });

  const mobile=await newPage('S6006 engineering review mobile',{width:390,height:844},true);
  await check('S6006 review filters, finding actions and report remain usable within a 390px viewport',async()=>{
    const m=mobile.page;
    await m.goto(baseURL+'/projects/s6006/');await ready(m);
    await importProject(m,project,'s6006-review-project.json');await panel(m,'review');
    await m.locator('#review-content').scrollIntoViewIfNeeded();
    await screenshot(m,'s6006-review-mobile.png',false);
    await assertNoOverflow(m,'Review mobile');
    for(const id of ['review-station','review-kind','review-focus','export-review','report-review']){
      const box=await m.locator('#'+id).boundingBox();
      assert.ok(box&&box.x>=-1&&box.x+box.width<=391,id+' fits mobile viewport');
    }
    await inspect(m,first.id+'/review-c');
    await finding(m,'soil.undrained').scrollIntoViewIfNeeded();
    await screenshot(m,'s6006-review-soil-mobile.png',false);
    await assertNoOverflow(m,'Review findings mobile');
    await m.locator('#review-station').selectOption('all');
    assert.equal(await m.locator('#review-content').getAttribute('data-included-count'),'44');
    await assertNoOverflow(m,'Review all stations mobile');
    await m.locator('#review-station').selectOption(first.id);
    const report=await openReport(m);
    await report.setViewportSize({width:390,height:844});
    await assertNoOverflow(report,'Review report mobile');
    await screenshot(report,'s6006-review-report-mobile.png',false);
    assert.equal(await report.locator('#print-review-report').isEnabled(),true);
    assertNoErrors(mobile.diagnostics);await report.close();
  });
  await mobile.context.close();await desktop.context.close();
}
