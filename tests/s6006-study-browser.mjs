import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  createProject,updateActiveScenario,saveAlternative,serializeProject,
  projectRevision,stationCatalog,
} from '../projects/s6006/project.js';
import {
  DEFAULT_SOIL_INVESTIGATION_METADATA,DEFAULT_WATER_INVESTIGATION_METADATA,
  saveInvestigationMetadata,captureInvestigation,
} from '../projects/s6006/investigations.js';
import { studyCSV } from '../projects/s6006/studies.js';
import { parseStudyDocument,STUDY_SNAPSHOT_PREFIX } from '../projects/s6006/study-storage.js';

// Every mutation below is synthetic data in fresh isolated browser contexts.
export async function runS6006StudyChecks({newPage,check,screenshot,assertNoErrors,assertNoOverflow,download,chooseFile,changeValue,baseURL,output}) {
  const source=JSON.parse(await readFile(new URL('../projects/s6006/source-data.json',import.meta.url),'utf8'));
  const [first,second]=stationCatalog(source),stamp='2026-11-22T03:00:00.000Z';
  const desktop=await newPage('S6006 sensitivity desktop',{width:1440,height:1050}),p=desktop.page;
  const panel=async(page,name)=>{
    await page.locator('#case-tabs [data-panel="'+name+'"]').click();
    await page.locator('#panel-'+name).waitFor({state:'visible'});
  };
  const ready=async page=>{
    await page.waitForFunction(()=>['true','error'].includes(document.body.dataset.ready));
    assert.equal(await page.locator('body').getAttribute('data-ready'),'true',await page.locator('#notice').textContent());
  };
  const scrollTop=async(page,selector)=>{
    await page.locator(selector).evaluate(element=>window.scrollTo({top:window.scrollY+element.getBoundingClientRect().top-12,behavior:'instant'}));
  };
  const importProject=async(page,project,name)=>{
    const file=path.join(output,'fixtures',name);
    await writeFile(file,serializeProject(project,source));
    await chooseFile(page,'#load-case',file);
    await page.waitForFunction(revision=>document.querySelector('#project-revision')?.textContent===revision&&document.querySelector('#notice')?.textContent.includes('เปิดโครงการครบ'),projectRevision(project));
    return file;
  };
  const configure=async(page,parameterId,minimum,maximum,sampleCount,scenarioId)=>{
    await panel(page,'study');
    if(scenarioId)await page.locator('#study-scenario').selectOption(scenarioId);
    await page.locator('#study-parameter').selectOption(parameterId);
    for(const [selector,value] of [['#study-min',minimum],['#study-max',maximum],['#study-count',sampleCount]])await changeValue(page,selector,value);
  };
  const run=async page=>{
    const previous=await page.locator('#study-results').count()?await page.locator('#study-results').getAttribute('data-run-id'):null;
    await page.locator('#run-study').click();
    await page.waitForFunction(old=>document.querySelector('#study-results')?.dataset.runId&&document.querySelector('#study-results').dataset.runId!==old,previous);
    assert.equal(await page.locator('#study-error').count(),0);
    return page.locator('#study-results').getAttribute('data-run-id');
  };
  const savedDocument=async(page,name)=>{
    const file=await download(page,'#export-study-json',name);
    return {...parseStudyDocument(await readFile(file,'utf8'),source),file};
  };
  const assertMetricCells=async(page,record,metricId)=>{
    for(const point of [record.baseline,...record.samples]){
      const cell=point.metrics[metricId];
      assert.equal(await page.locator('[data-study-row="'+point.id+'"]').getAttribute('data-availability'),cell.availability);
      assert.equal(await page.locator('[data-study-value="'+point.id+'"]').innerText(),cell.availability==='computed'?String(cell.value):'—');
      assert.equal(await page.locator('[data-study-x="'+point.id+'"]').innerText(),point.x===null?'—':String(point.x));
    }
  };
  const openReport=async page=>{
    const [report]=await Promise.all([page.waitForEvent('popup'),page.locator('#report-study').click()]);
    await report.waitForFunction(()=>document.querySelector('#study-report-ready')?.dataset.ready==='true'||document.body.dataset.reportState==='blocked');
    assert.equal(await report.locator('#study-report-ready').getAttribute('data-ready'),'true',await report.locator('body').innerText());
    assert.equal(await report.locator('#print-study-report').isEnabled(),true);
    return report;
  };
  const printReport=async(page,name,markers=[])=>{
    await page.emulateMedia({media:'print'});await page.setViewportSize({width:680,height:1100});
    await page.evaluate(()=>document.fonts.ready);
    const metrics=await page.locator('.report-page').evaluateAll(pages=>pages.map((sheet,index)=>{
      const footer=sheet.querySelector('.running-foot').getBoundingClientRect();
      const bottom=Math.max(...[...sheet.children].filter(node=>!node.classList.contains('running-foot')).map(node=>node.getBoundingClientRect().bottom));
      return {page:index+1,title:sheet.dataset.pageTitle,kind:sheet.dataset.pageKind,bottom,footerTop:footer.top,clearance:footer.top-bottom,fits:bottom<=footer.top-12};
    }));
    assert.ok(metrics.length>=10);
    await writeFile(path.join(output,name+'-page-metrics.json'),JSON.stringify(metrics,null,2));
    assert.deepEqual(metrics.filter(row=>!row.fits),[],'Every sensitivity/evidence page clears its footer');
    const file=path.join(output,name+'.pdf');
    await page.pdf({path:file,format:'A4',printBackground:true,preferCSSPageSize:true});
    const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8',maxBuffer:40*1024*1024});
    assert.ok((text.match(/[ก-๙]/g)||[]).length>500,'Thai text survives the sensitivity report export');
    for(const marker of markers)assert.ok(text.includes(marker),'PDF retains '+marker);
    await writeFile(path.join(output,name+'.txt'),text);
    await page.emulateMedia({media:'screen'});
    return {text,metrics};
  };
  const beamProject=updateActiveScenario(createProject(source),{
    beamInputs:{tensionBarDiameterMm:16,stirrupDiameterMm:8,externalMuKnM:30,externalVuKn:50},
    context:{boreholeReference:'SYNTHETIC_STUDY_BH1',waterReference:'SYNTHETIC_STUDY_DATUM',sourceNote:'SYNTHETIC software verification only',waterHighLevel:0,waterLowLevel:0,groundwaterLevel:0},
  },source);
  let optionsProject=updateActiveScenario(beamProject,{geometry:{slopeH:3.5}},source);
  optionsProject=saveAlternative(optionsProject,'A · ค่าฐานทดลอง',source,{id:'study-a',createdAt:stamp});
  optionsProject=updateActiveScenario(optionsProject,{geometry:{slopeH:3.8}},source);
  let originalStudy;

  await check('S6006 sensitivity runs explicitly, keeps the project unchanged, and retains the captured graph through draft and source edits',async()=>{
    await p.goto(baseURL+'/projects/s6006/');await ready(p);await panel(p,'study');
    assert.equal(await p.locator('#study-results').count(),0);
    assert.equal(await p.locator('#export-study-csv').isDisabled(),true);
    assert.equal(await p.locator('#report-study').isDisabled(),true);
    assert.equal(await p.locator('#study-parameter').inputValue(),'geometry.slopeH');
    assert.equal(await p.locator('#study-min').inputValue(),'2');
    assert.equal(await p.locator('#study-max').inputValue(),'3');
    assert.ok((await p.locator('#study-range-note').innerText()).includes('±20%'));
    const revision=await p.locator('#project-revision').innerText();
    const before=await download(p,'#save-case','s6006-study-before-project.json');
    const id=await run(p);
    originalStudy=await savedDocument(p,'s6006-study-first.json');
    assert.equal(originalStudy.document.project.version,2);
    assert.equal(originalStudy.record.samples.length,9);
    assert.equal(await p.locator('#project-revision').innerText(),revision);
    const after=await download(p,'#save-case','s6006-study-after-project.json');
    assert.equal(await readFile(after,'utf8'),await readFile(before,'utf8'));
    await assertMetricCells(p,originalStudy.record,'soil.dry.fs');
    assert.equal(await p.locator('svg [data-study-chart-point]').count(),9);
    assert.equal(await p.locator('#study-freshness').getAttribute('data-source-state'),'current');
    await scrollTop(p,'.study-result-head');await screenshot(p,'s6006-study-desktop.png',false);
    await changeValue(p,'#study-max','4.12500');
    assert.equal(await p.locator('#study-results').getAttribute('data-run-id'),id);
    assert.equal(await p.locator('#study-freshness').getAttribute('data-config-state'),'changed');
    const csv=await download(p,'#export-study-csv','s6006-study-first.csv');
    assert.equal(await readFile(csv,'utf8'),studyCSV(originalStudy.record),'Draft changes cannot change captured export');
    await panel(p,'engineering');await changeValue(p,'#beam-form [name="externalMuKnM"]',32);await panel(p,'study');
    assert.equal(await p.locator('#study-max').inputValue(),'4.12500','Unrelated form renders preserve the local study draft');
    assert.equal(await p.locator('#study-results').getAttribute('data-run-id'),id);
    assert.equal(await p.locator('#study-freshness').getAttribute('data-source-state'),'changed');
    await assertMetricCells(p,originalStudy.record,'soil.dry.fs');
    const changedRun=await run(p);assert.notEqual(changedRun,id);
    assert.equal(await p.locator('#study-freshness').getAttribute('data-source-state'),'current');
    assert.equal(await p.locator('#study-freshness').getAttribute('data-config-state'),'current');
    await assertNoOverflow(p,'Study desktop');assertNoErrors(desktop.diagnostics);
  });

  await check('S6006 sensitivity keeps gated and invalid beam points distinct and preserves missing Su versus an explicit zero trial',async()=>{
    await importProject(p,beamProject,'s6006-study-beam-project.json');
    await configure(p,'beamInputs.heightMm',200,900,8,'current');await run(p);
    await p.locator('#study-metric').selectOption('beam.usablePhiMnKnM');
    const beam=await savedDocument(p,'s6006-study-beam.json');
    await assertMetricCells(p,beam.record,'beam.usablePhiMnKnM');
    assert.equal(await p.locator('[data-study-row][data-availability="computed"]').count(),5,'Four sampled points plus the baseline');
    assert.equal(await p.locator('[data-study-row][data-availability="gated"]').count(),2);
    assert.equal(await p.locator('[data-study-row][data-availability="invalid"]').count(),2);
    assert.equal(await p.locator('svg [data-study-segment]').getAttribute('data-study-segment'),'sample-1,sample-2,sample-3,sample-4');
    await p.locator('#study-point').selectOption('sample-5');
    assert.equal(await p.locator('#study-point-detail .study-point-value strong').innerText(),'—');
    assert.ok((await p.locator('#study-point-detail').innerText()).includes('ยังใช้ตรวจไม่ได้'));
    await p.locator('#study-point').selectOption('sample-7');
    assert.ok((await p.locator('#study-point-detail').innerText()).includes('D-region'));
    assert.equal(await p.locator('#study-point-detail [data-study-calculation="beam"]').count(),0);
    await scrollTop(p,'.study-chart-card');await screenshot(p,'s6006-study-beam-limits.png',false);
    const missingSu=updateActiveScenario(beamProject,{soilInputs:{mode:'undrained',undrainedStrengthKpa:null}},source);
    await importProject(p,missingSu,'s6006-study-missing-su-project.json');await panel(p,'study');
    await p.locator('#study-parameter').selectOption('soilInputs.undrainedStrengthKpa');
    assert.equal(await p.locator('#study-min').inputValue(),'');assert.equal(await p.locator('#study-max').inputValue(),'');
    assert.equal(await p.locator('#study-parameter option[value="soilInputs.frictionAngleDeg"]').count(),0);
    await configure(p,'soilInputs.undrainedStrengthKpa',0,50,3);const revision=await p.locator('#project-revision').innerText();await run(p);
    const su=await savedDocument(p,'s6006-study-missing-su.json');
    await assertMetricCells(p,su.record,'soil.undrained.fs');
    assert.equal(await p.locator('[data-study-row="baseline"]').getAttribute('data-availability'),'missing');
    assert.equal(await p.locator('[data-study-value="sample-1"]').innerText(),'0');
    assert.equal(await p.locator('svg [data-study-chart-baseline]').count(),0);
    assert.equal(await p.locator('[data-study-row="sample-1"] td').nth(4).innerText(),'—');
    assert.equal(await p.locator('#project-revision').innerText(),revision);
    assertNoErrors(desktop.diagnostics);
  });

  await check('S6006 sensitivity preserves saved sources and exact JSON/CSV roundtrips without changing the working project on import',async()=>{
    await importProject(p,optionsProject,'s6006-study-options-project.json');
    await configure(p,'geometry.slopeH',2,4,9,'study-a');const revision=await p.locator('#project-revision').innerText();await run(p);
    const saved=await savedDocument(p,'s6006-study-saved-source.json');
    assert.equal(saved.record.selection.scenarioId,'study-a');assert.equal(saved.record.baseline.x,3.5);
    assert.equal(await p.locator('#geometry-form [name="slopeH"]').inputValue(),'3.8');
    assert.equal(await p.locator('#project-revision').innerText(),revision);
    await p.locator('#study-open-source').click();
    assert.equal(await p.locator('#panel-comparison').isVisible(),true);
    assert.equal(await p.locator('[data-alternative-id="study-a"]').evaluate(el=>el===document.activeElement),true);
    assert.equal(await p.locator('#geometry-form [name="slopeH"]').inputValue(),'3.8');
    await panel(p,'study');await changeValue(p,'#study-min','2.12500');
    await p.locator('#station-select').selectOption(second.id);
    await panel(p,'model');await changeValue(p,'#geometry-form [name="slopeH"]',4.5);
    await p.locator('#station-select').selectOption(first.id);await panel(p,'study');
    assert.equal(await p.locator('#study-scenario').inputValue(),'study-a');
    assert.equal(await p.locator('#study-min').inputValue(),'2.12500');
    assert.equal(await p.locator('#study-freshness').getAttribute('data-source-state'),'current','A different station cannot stale this captured source');
    await panel(p,'model');await changeValue(p,'#geometry-form [name="slopeH"]',4);await panel(p,'study');
    assert.equal(await p.locator('#study-freshness').getAttribute('data-source-state'),'current','Current edits cannot stale a frozen saved source');
    const workingRevision=await p.locator('#project-revision').innerText();
    await chooseFile(p,'#import-study-json',saved.file);
    await p.waitForFunction(id=>document.querySelector('#study-results')?.dataset.runId===id&&document.querySelector('.study-record-tag')?.textContent.includes('JSON'),saved.document.id);
    assert.equal(await p.locator('#project-revision').innerText(),workingRevision);
    assert.equal(await p.locator('#geometry-form [name="slopeH"]').inputValue(),'4');
    const roundtrip=await savedDocument(p,'s6006-study-saved-roundtrip.json');
    assert.deepEqual(roundtrip.document,saved.document);
    const csv=await download(p,'#export-study-csv','s6006-study-saved.csv');
    assert.equal(await readFile(csv,'utf8'),studyCSV(saved.record));
    const corrupted=JSON.parse(await readFile(saved.file,'utf8'));corrupted.config.maximum=9;
    const corruptFile=path.join(output,'fixtures','s6006-study-corrupt.json');await writeFile(corruptFile,JSON.stringify(corrupted));
    await chooseFile(p,'#import-study-json',corruptFile);
    await p.locator('#study-error').waitFor({state:'visible'});
    assert.equal(await p.locator('#study-results').getAttribute('data-run-id'),saved.document.id);
    assert.equal(await p.locator('#project-revision').innerText(),workingRevision);
    assertNoErrors(desktop.diagnostics);
  });

  await check('S6006 sensitivity reports freeze the selected metric and point, paginate long evidence and reject altered snapshots',async()=>{
    const longText=marker=>('<script>literal study evidence</script>\n'+'ข้อมูลสมมติเพื่อทดสอบรายงาน การอ้างอิงและขอบเขตของชุดทดลอง\n'.repeat(40)).slice(0,1750)+'\n'+marker;
    const soil={...DEFAULT_SOIL_INVESTIGATION_METADATA,boreholeId:'BH-1',documentRevision:'SYNTHETIC',locator:'SYNTHETIC · log p4 / lab p12',sampleDepthFromM:0,sampleDepthToM:2,depthReference:'SYNTHETIC datum',testMethod:'SYNTHETIC test',parameterInterpretation:'SYNTHETIC effective stress',applicabilityNote:'SYNTHETIC fixture only; not a real station correlation',notes:longText('END_STUDY_SOIL_OLD')};
    const water={...DEFAULT_WATER_INVESTIGATION_METADATA,documentRevision:'SYNTHETIC',locator:'SYNTHETIC water record',datum:'SYNTHETIC datum',observationText:'SYNTHETIC time',applicabilityNote:'SYNTHETIC context only',notes:longText('END_STUDY_WATER_OLD')};
    let long=updateActiveScenario(beamProject,{context:{sourceNote:longText('END_STUDY_CONTEXT')}},source);
    long=saveInvestigationMetadata(long,'soil',soil,source);long=saveInvestigationMetadata(long,'water',water,source);
    long=captureInvestigation(long,'soil',source,{createdAt:stamp});long=captureInvestigation(long,'water',source,{createdAt:stamp});
    long=saveInvestigationMetadata(long,'soil',{...soil,boreholeId:'BH-7',notes:longText('END_STUDY_SOIL_NEW')},source);
    long=saveInvestigationMetadata(long,'water',{...water,notes:longText('END_STUDY_WATER_NEW')},source);
    await importProject(p,long,'s6006-study-long-evidence-project.json');
    await configure(p,'soilInputs.frictionAngleDeg',0,30,31,'current');await run(p);
    await p.locator('#study-metric').selectOption('soil.parallel-seepage.fs');await p.locator('#study-point').selectOption('sample-31');
    const longStudy=await savedDocument(p,'s6006-study-long-evidence.json');
    assert.equal(await p.locator('svg[data-study-chart-metric]').getAttribute('data-baseline-outside'),'true');
    const report=await openReport(p),reportURL=report.url();
    assert.equal(await report.locator('#study-report-ready').getAttribute('data-metric-id'),'soil.parallel-seepage.fs');
    assert.equal(await report.locator('#study-report-ready').getAttribute('data-point-id'),'sample-31');
    assert.equal(await report.locator('#study-report-ready').getAttribute('data-sample-count'),'31');
    assert.equal(await report.locator('#study-report-ready').getAttribute('data-study-revision'),longStudy.record.studyRevision);
    const markers=['END_STUDY_CONTEXT','END_STUDY_SOIL_OLD','END_STUDY_SOIL_NEW','END_STUDY_WATER_OLD','END_STUDY_WATER_NEW'];
    const frozen=await report.locator('#study-report-ready').innerText();
    for(const marker of markers)assert.ok(frozen.includes(marker));
    assert.ok(frozen.includes('<script>literal study evidence</script>'));
    assert.equal(await report.locator('#study-report-ready script').count(),0);
    await changeValue(p,'#study-min',1);
    if(!await p.locator('#context-form').evaluate(el=>el.closest('details').open))await p.locator('.context-details > summary').click();
    await changeValue(p,'#context-form [name="sourceNote"]','WORKING_CHANGED_AFTER_STUDY');
    await report.reload();await report.waitForFunction(()=>document.querySelector('#study-report-ready')?.dataset.ready==='true');
    assert.equal(await report.locator('#study-report-ready').innerText(),frozen);
    await report.locator('.report-page[data-page-kind="chart"]').first().scrollIntoViewIfNeeded();await screenshot(report,'s6006-study-report.png',false);
    await printReport(report,'S6006-sensitivity-soil-31',markers);
    const token=new URL(reportURL).searchParams.get('snapshot');
    await p.evaluate(({key})=>{const value=JSON.parse(localStorage.getItem(key));value.metricId='soil.dry.fs';localStorage.setItem(key,JSON.stringify(value));},{key:STUDY_SNAPSHOT_PREFIX+token});
    const blocked=await p.context().newPage();await blocked.goto(reportURL);await blocked.waitForFunction(()=>document.body.dataset.reportState==='blocked');
    assert.equal(await blocked.locator('.report-page').count(),0);assert.equal(await blocked.locator('#print-study-report').isDisabled(),true);
    assert.ok((await blocked.locator('#study-report-error').innerText()).includes('ยังพิมพ์รายงานทดลองนี้ไม่ได้'));
    await report.close();await blocked.close();
    await importProject(p,beamProject,'s6006-study-beam-project.json');await configure(p,'beamInputs.heightMm',200,900,8,'current');await run(p);
    await p.locator('#study-metric').selectOption('beam.usablePhiMnKnM');await p.locator('#study-point').selectOption('sample-7');
    const beamReport=await openReport(p);
    assert.equal(await beamReport.locator('#study-report-ready').getAttribute('data-point-id'),'sample-7');
    const beamText=await beamReport.locator('#study-report-ready').innerText();
    assert.ok(beamText.includes('D-region'));assert.ok(beamText.includes('ยังใช้เทียบแรงไม่ได้'));
    assert.ok(beamText.includes('ไม่มีผลสูตรในหมวดนี้'));
    await printReport(beamReport,'S6006-sensitivity-beam-limits',['D-region','S6006-STUDIES-1']);
    await beamReport.close();assertNoErrors(desktop.diagnostics);
  });

  const mobile=await newPage('S6006 sensitivity mobile',{width:390,height:844},true);
  await check('S6006 sensitivity charts, exact tables and keyboard-accessible point details fit the 390px workflow',async()=>{
    const m=mobile.page;
    await m.goto(baseURL+'/projects/s6006/');await ready(m);await importProject(m,optionsProject,'s6006-study-options-project.json');
    await configure(m,'geometry.slopeH',2,4,7,'current');await run(m);
    await scrollTop(m,'#study-form');await screenshot(m,'s6006-study-setup-mobile.png',false);
    for(const selector of ['#study-scenario','#study-parameter','#study-min','#study-max','#study-count','#run-study','#export-study-json','#study-metric','#study-point','.study-chart svg']){
      const box=await m.locator(selector).boundingBox();assert.ok(box&&box.x>=-1&&box.x+box.width<=391,selector+' fits mobile');
    }
    await scrollTop(m,'.study-chart-card');await screenshot(m,'s6006-study-chart-mobile.png',false);
    const chartY=await m.evaluate(()=>window.scrollY);
    await m.locator('svg [data-study-select-point="sample-3"]').press('Enter');
    assert.equal(await m.locator('#study-point-detail').getAttribute('data-study-detail-point'),'sample-3');
    assert.equal(await m.locator('#study-point-detail').evaluate(el=>el===document.activeElement),true);
    await scrollTop(m,'#study-point-detail');
    assert.ok(await m.evaluate(()=>window.scrollY)>chartY+200,'Point-details screenshot actually shows the deeper result section');
    await screenshot(m,'s6006-study-point-mobile.png',false);
    await m.locator('[data-study-calculation="soil"] > summary').click();
    await scrollTop(m,'[data-study-calculation="soil"]');await screenshot(m,'s6006-study-formulas-mobile.png',false);
    await assertNoOverflow(m,'Study point/formula mobile');
    await m.locator('#study-scenario').selectOption('study-a');
    assert.equal(await m.locator('#geometry-form [name="slopeH"]').inputValue(),'3.8');
    await configure(m,'geometry.slopeH',2,4,7);await run(m);
    const saved=await savedDocument(m,'s6006-study-mobile.json');assert.equal(saved.record.selection.scenarioId,'study-a');
    const csv=await download(m,'#export-study-csv','s6006-study-mobile.csv');assert.equal(await readFile(csv,'utf8'),studyCSV(saved.record));
    await assertNoOverflow(m,'Study saved-source mobile');assertNoErrors(mobile.diagnostics);
  });
}
