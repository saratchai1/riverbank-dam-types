import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {
  createProject,stationCatalog,updateActiveScenario,selectStation,saveAlternative,
  serializeProject,projectRevision,
} from '../projects/s6006/project.js';
import {
  DEFAULT_SOIL_INVESTIGATION_METADATA,DEFAULT_WATER_INVESTIGATION_METADATA,
  saveInvestigationMetadata,captureInvestigation,buildInvestigationReview,investigationCSV,
} from '../projects/s6006/investigations.js';

// Only synthetic records in fresh browser contexts are changed by these checks.
export async function runS6006InvestigationChecks({newPage,check,screenshot,assertNoErrors,assertNoOverflow,download,chooseFile,changeValue,baseURL,output}) {
  const source=JSON.parse(await readFile(new URL('../projects/s6006/source-data.json',import.meta.url),'utf8'));
  const [first,second]=stationCatalog(source),stamp='2026-11-22T02:00:00.000Z';
  const desktop=await newPage('S6006 investigation basis desktop',{width:1440,height:1050}),p=desktop.page;
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
    await page.waitForFunction(revision=>document.querySelector('#project-revision')?.textContent===revision&&document.querySelector('#notice')?.textContent.includes('เปิดโครงการครบ'),projectRevision(project));
    return file;
  };
  const group=(page,kind)=>page.locator('#investigation-content [data-investigation-kind="'+kind+'"]');
  const assertState=async(page,kind,state)=>assert.equal(await group(page,kind).getAttribute('data-state'),state);
  const fillMetadata=async(page,kind,metadata)=>{
    for(const [field,value] of Object.entries(metadata))await page.locator('#investigation-'+kind+'-'+field).fill(value===null?'':String(value));
  };
  const saveMetadata=async(page,kind)=>{
    await page.locator('[data-investigation-save="'+kind+'"]').click();
    assert.equal(await group(page,kind).getAttribute('data-dirty'),'false',await page.locator('#notice').innerText());
  };
  const reports={
    current:{panel:null,button:'[data-current-report]',host:'#report-ready',print:'#print-report'},
    comparison:{panel:'comparison',button:'#report-comparison',host:'#comparison-report-ready',print:'#print-comparison-report'},
    review:{panel:'review',button:'#report-review',host:'#review-report-ready',print:'#print-review-report'},
  };
  const reportReady=async(page,kind)=>{
    const spec=reports[kind];
    await page.waitForFunction(selector=>document.querySelector(selector)?.dataset.ready==='true'||document.body.dataset.reportState==='blocked',spec.host);
    assert.equal(await page.locator(spec.host).getAttribute('data-ready'),'true',await page.locator('body').innerText());
    assert.equal(await page.locator(spec.print).isEnabled(),true);
  };
  const openReport=async(page,kind)=>{
    const spec=reports[kind];
    if(spec.panel)await panel(page,spec.panel);
    if(kind==='review'){
      await page.locator('#review-station').selectOption(first.id);
      await page.locator('#review-kind').selectOption('all');
      await page.locator('#review-focus').selectOption('all');
    }
    const [report]=await Promise.all([page.waitForEvent('popup'),page.locator(spec.button).first().click()]);
    await reportReady(report,kind);
    return report;
  };
  const printReport=async(page,name,markers=[])=>{
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
    assert.deepEqual(metrics.filter(row=>!row.fits),[],'Every calculation/evidence page clears its footer');
    const file=path.join(output,name+'.pdf');
    await page.pdf({path:file,format:'A4',printBackground:true,preferCSSPageSize:true});
    const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8',maxBuffer:30*1024*1024});
    assert.ok((text.match(/[ก-๙]/g)||[]).length>500,'Thai text survives evidence PDF export');
    for(const marker of markers)assert.ok(text.includes(marker),'PDF retains '+marker);
    await writeFile(path.join(output,name+'.txt'),text);
    await page.emulateMedia({media:'screen'});
    return {text,metrics};
  };

  const soilMetadata={
    ...DEFAULT_SOIL_INVESTIGATION_METADATA,boreholeId:'BH-1',documentRevision:'SYNTHETIC-REV1',
    locator:'SYNTHETIC TEST · PDF p4',sampleDepthFromM:0,sampleDepthToM:2,
    depthReference:'SYNTHETIC ground reference',testMethod:'SYNTHETIC test method',
    parameterInterpretation:'SYNTHETIC effective-stress interpretation',
    applicabilityNote:'SYNTHETIC software fixture only; no real borehole-to-station correlation',
    notes:'SOIL_BOUND_ORIGINAL',
  };
  const waterMetadata={
    ...DEFAULT_WATER_INVESTIGATION_METADATA,documentRevision:'SYNTHETIC-REV1',
    locator:'SYNTHETIC water table',datum:'SYNTHETIC datum zero',
    observationText:'SYNTHETIC test time',applicabilityNote:'SYNTHETIC station context only',
    notes:'WATER_BOUND_ORIGINAL',
  };
  const context={
    waterHighLevel:0,waterLowLevel:0,groundwaterLevel:0,
    boreholeReference:'SYNTHETIC_BOREHOLE_FIRST',waterReference:'SYNTHETIC_WATER_FIRST',
    sourceNote:'SYNTHETIC software fixture; no field data or design approval',
  };
  const completeProject=()=>{
    let project=createProject(source);
    project=updateActiveScenario(project,{
      geometry:{slopeH:3.5},
      beamInputs:{tensionBarDiameterMm:16,stirrupDiameterMm:8,externalMuKnM:30,externalVuKn:50},
      context,
    },source);
    project=saveInvestigationMetadata(project,'soil',soilMetadata,source);
    project=saveInvestigationMetadata(project,'water',waterMetadata,source);
    project=captureInvestigation(project,'soil',source,{createdAt:stamp});
    project=captureInvestigation(project,'water',source,{createdAt:stamp});
    return project;
  };
  let fixture=completeProject();
  fixture=saveAlternative(fixture,'A · ฐานที่ผูกไว้',source,{id:'basis-a',createdAt:stamp});
  fixture=updateActiveScenario(fixture,{geometry:{slopeH:3.8},context:{waterHighLevel:2}},source);
  fixture=saveInvestigationMetadata(fixture,'soil',{...soilMetadata,notes:'SOIL_CURRENT_REVISED'},source);
  fixture=saveInvestigationMetadata(fixture,'water',{...waterMetadata,notes:'WATER_CURRENT_REVISED'},source);
  fixture=selectStation(fixture,second.id,source);
  fixture=saveInvestigationMetadata(fixture,'soil',{...soilMetadata,notes:'EXCLUDED_SECOND_STATION'},source);
  fixture=selectStation(fixture,first.id,source);
  let currentReportURL;

  await check('S6006 investigation records preserve source-only selection and require explicit complete-data binding',async()=>{
    await p.goto(baseURL+'/projects/s6006/');await ready(p);await panel(p,'investigation');
    await assertState(p,'soil','missing');await assertState(p,'water','missing');
    assert.equal(await p.locator('[data-investigation-borehole]').count(),8);
    await p.locator('.investigation-catalogue > summary').click();
    assert.equal(await p.locator('[data-investigation-borehole="BH-7"]').isVisible(),true);
    assert.ok((await p.locator('[data-investigation-borehole="BH-7"]').innerText()).includes('ไม่ระบุในต้นฉบับ'));
    assert.ok((await p.locator('[data-investigation-borehole="BH-1"]').innerText()).includes('-7.00 M.'));
    const beforeRevision=await p.locator('#project-revision').innerText();
    const beforeSoil=await p.locator('#soil-form').evaluate(form=>Object.fromEntries([...form.elements].filter(el=>el.name).map(el=>[el.name,el.value])));
    await p.locator('[data-investigation-use-borehole="BH-1"]').click();
    assert.equal(await p.locator('#investigation-soil-boreholeId').inputValue(),'BH-1');
    assert.ok((await p.locator('#investigation-soil-locator').inputValue()).includes('PDF หน้า 4'));
    assert.equal(await p.locator('#project-revision').innerText(),beforeRevision,'Picking a source changes only an unsaved metadata draft');
    assert.deepEqual(await p.locator('#soil-form').evaluate(form=>Object.fromEntries([...form.elements].filter(el=>el.name).map(el=>[el.name,el.value]))),beforeSoil);
    assert.equal(await p.locator('#context-form [name="groundwaterLevel"]').inputValue(),'');
    await saveMetadata(p,'soil');await assertState(p,'soil','incomplete');
    assert.equal(await p.locator('[data-investigation-bind="soil"]').isDisabled(),true);
    const partialFile=await download(p,'#save-case','s6006-investigation-partial.json');
    const partial=JSON.parse(await readFile(partialFile,'utf8'));
    assert.equal(partial.version,3);
    assert.equal(partial.stationInvestigations[first.id].current.soil.binding,null);
    await fillMetadata(p,'soil',soilMetadata);await saveMetadata(p,'soil');
    assert.equal(await p.locator('[data-investigation-bind="soil"]').isDisabled(),true,'Borehole context is still missing');
    await group(p,'soil').locator('[data-investigation-navigate="context.boreholeReference"]').click();
    assert.equal(await p.locator('#context-form [name="boreholeReference"]').evaluate(el=>el===document.activeElement),true);
    assert.equal(await p.locator('#context-form').evaluate(el=>el.closest('details').open),true);
    for(const [field,value] of Object.entries(context))await changeValue(p,'#context-form [name="'+field+'"]',value);
    await panel(p,'investigation');
    await p.locator('[data-investigation-bind="soil"]').click();await assertState(p,'soil','current');
    await fillMetadata(p,'water',waterMetadata);await saveMetadata(p,'water');
    await assertState(p,'water','incomplete');
    await p.locator('[data-investigation-bind="water"]').click();await assertState(p,'water','current');
    assert.equal(await group(p,'water').locator('[data-investigation-value-field="context.groundwaterLevel"] .investigation-value').innerText(),'0');
    await assertNoOverflow(p,'Investigation full form desktop');assertNoErrors(desktop.diagnostics);
  });

  await check('S6006 investigation drafts and saved alternatives stay isolated while stale records, JSON and CSV retain exact values',async()=>{
    await importProject(p,fixture,'s6006-investigation-project.json');await panel(p,'investigation');
    await assertState(p,'soil','stale');await assertState(p,'water','stale');
    assert.equal(await group(p,'soil').locator('[data-investigation-changed-field="geometry.slopeH"]').count(),1);
    assert.equal(await group(p,'soil').locator('[data-investigation-changed-field="notes"]').count(),1);
    assert.equal(await group(p,'water').locator('[data-investigation-changed-field="context.waterHighLevel"]').count(),1);
    await p.locator('#investigation-content').scrollIntoViewIfNeeded();await screenshot(p,'s6006-investigation-desktop.png',false);
    const revision=await p.locator('#project-revision').innerText();
    await p.locator('#investigation-scenario').selectOption('basis-a');
    await assertState(p,'soil','current');await assertState(p,'water','current');
    assert.equal(await p.locator('[data-investigation-metadata]').count(),0);
    assert.equal(await p.locator('[data-investigation-use-borehole]').count(),0);
    await p.locator('[data-investigation-open-saved]').click();
    assert.equal(await p.locator('#panel-comparison').isVisible(),true);
    assert.equal(await p.locator('#project-revision').innerText(),revision);
    assert.equal(await p.locator('#geometry-form [name="slopeH"]').inputValue(),'3.8');
    assert.equal(await p.locator('.alternative-card[data-alternative-id="basis-a"]').evaluate(el=>el===document.activeElement),true);
    await panel(p,'investigation');await p.locator('#investigation-scenario').selectOption('current');
    await p.locator('#investigation-soil-notes').fill('UNSAVED_STATION_DRAFT');
    assert.equal(await p.locator('[data-investigation-bind="soil"]').isDisabled(),true);
    await p.locator('#station-select').selectOption(second.id);
    assert.equal(await p.locator('#investigation-soil-notes').inputValue(),'EXCLUDED_SECOND_STATION');
    assert.ok((await p.locator('#investigation-draft-summary').innerText()).includes('สถานีอื่น'));
    await p.locator('#station-select').selectOption(first.id);
    assert.equal(await p.locator('#investigation-soil-notes').inputValue(),'UNSAVED_STATION_DRAFT');
    await panel(p,'engineering');await changeValue(p,'#beam-form [name="externalMuKnM"]',31);await panel(p,'investigation');
    assert.equal(await p.locator('#investigation-soil-notes').inputValue(),'UNSAVED_STATION_DRAFT','Unrelated engineering rerender keeps the local draft');
    await p.locator('[data-investigation-discard="soil"]').click();
    assert.equal(await p.locator('#investigation-soil-notes').inputValue(),'SOIL_CURRENT_REVISED');
    for(const kind of ['soil','water']){await p.locator('[data-investigation-bind="'+kind+'"]').click();await assertState(p,kind,'current');}
    const json=await download(p,'#save-case','s6006-investigation-roundtrip.json');
    const accepted=JSON.parse(await readFile(json,'utf8'));
    assert.equal(accepted.version,3);
    const csv=await download(p,'#export-investigations','s6006-investigation-current.csv');
    assert.equal(await readFile(csv,'utf8'),investigationCSV(buildInvestigationReview(accepted,source,first.id,'current')));
    await p.locator('#investigation-scenario').selectOption('basis-a');
    const savedCSV=await download(p,'#export-investigations','s6006-investigation-saved.csv');
    assert.equal(await readFile(savedCSV,'utf8'),investigationCSV(buildInvestigationReview(accepted,source,first.id,'basis-a')));
    await p.reload();await ready(p);await panel(p,'investigation');
    assert.equal(await p.locator('#project-revision').innerText(),projectRevision(accepted));
    await assertState(p,'soil','current');await assertState(p,'water','current');
    await p.locator('#investigation-scenario').selectOption('basis-a');await assertState(p,'soil','current');
    assertNoErrors(desktop.diagnostics);
  });

  await check('S6006 existing reports freeze station-scoped investigation evidence and print current, comparison and review appendices',async()=>{
    await importProject(p,fixture,'s6006-investigation-project.json');await panel(p,'investigation');
    await p.locator('#investigation-scenario').selectOption('current');
    const opened=[];
    for(const kind of ['current','comparison','review']){
      const report=await openReport(p,kind),host=reports[kind].host;
      const text=await report.locator(host).innerText();
      assert.ok(text.includes('SOIL_CURRENT_REVISED'));assert.ok(text.includes('SOIL_BOUND_ORIGINAL'));
      assert.ok(!text.includes('EXCLUDED_SECOND_STATION'),'Report scope excludes the second-station record');
      const entries=await report.locator('[data-investigation-entry-key]').evaluateAll(els=>[...new Set(els.map(el=>el.dataset.investigationEntryKey))]);
      assert.deepEqual(entries.sort(),(kind==='current'?[first.id+'/current']:[first.id+'/current',first.id+'/basis-a']).sort());
      assert.equal(await report.locator('[data-investigation-entry-key="'+first.id+'/current"][data-investigation-kind="soil"]').first().getAttribute('data-investigation-state'),'stale');
      if(kind!=='current')assert.equal(await report.locator('[data-investigation-entry-key="'+first.id+'/basis-a"][data-investigation-kind="soil"]').first().getAttribute('data-investigation-state'),'current');
      opened.push({kind,report,text});
      if(kind==='current')currentReportURL=report.url();
    }
    await panel(p,'investigation');await p.locator('#investigation-scenario').selectOption('current');
    await p.locator('#investigation-soil-notes').fill('POST_REPORT_METADATA_EDIT');await saveMetadata(p,'soil');
    for(const {kind,report,text} of opened){
      await report.reload();await reportReady(report,kind);
      assert.equal(await report.locator(reports[kind].host).innerText(),text,'Changing working metadata does not rewrite '+kind+' snapshot');
      if(kind==='current'){
        await report.locator('.investigation-appendix').first().scrollIntoViewIfNeeded();
        await screenshot(report,'s6006-investigation-report.png',false);
      }
      await printReport(report,'S6006-investigation-'+kind,['SOIL_CURRENT_REVISED','SOIL_BOUND_ORIGINAL','WATER_CURRENT_REVISED','WATER_BOUND_ORIGINAL']);
      await report.close();
    }
    assertNoErrors(desktop.diagnostics);
  });

  await check('S6006 investigation reports reject altered v3 evidence and retain complete captured/current long metadata',async()=>{
    const token=new URL(currentReportURL).searchParams.get('snapshot');
    await p.evaluate(({token,stationId})=>{
      const key='riverbank.s6006.report-snapshot.v1.'+token;
      const snapshot=JSON.parse(localStorage.getItem(key));
      snapshot.project.stationInvestigations[stationId].current.soil.metadata.notes='TAMPERED_V3_METADATA';
      localStorage.setItem(key,JSON.stringify(snapshot));
    },{token,stationId:first.id});
    const blocked=await desktop.context.newPage();
    await blocked.goto(currentReportURL);
    await blocked.waitForFunction(()=>document.body.dataset.reportState==='blocked');
    assert.equal(await blocked.locator('#print-report').isDisabled(),true);
    assert.equal(await blocked.locator('.report-page').count(),0);
    const longText=marker=>('หลักฐาน <script>literal only</script>\n'.repeat(60)).slice(0,1820)+marker;
    let long=completeProject();
    long=saveInvestigationMetadata(long,'soil',{...soilMetadata,notes:longText('END_OLD_SOIL')},source);
    long=saveInvestigationMetadata(long,'water',{...waterMetadata,notes:longText('END_OLD_WATER')},source);
    long=captureInvestigation(long,'soil',source,{createdAt:stamp});
    long=captureInvestigation(long,'water',source,{createdAt:stamp});
    long=saveAlternative(long,'ก\n'.repeat(23)+'กก',source,{id:'basis-long',createdAt:stamp});
    long=saveInvestigationMetadata(long,'soil',{...soilMetadata,notes:longText('END_NEW_SOIL')},source);
    long=saveInvestigationMetadata(long,'water',{...waterMetadata,notes:longText('END_NEW_WATER')},source);
    await importProject(p,long,'s6006-investigation-long.json');
    const report=await openReport(p,'comparison');
    const text=await report.locator('#comparison-report-ready').innerText();
    const markers=['END_OLD_SOIL','END_NEW_SOIL','END_OLD_WATER','END_NEW_WATER'];
    for(const marker of markers)assert.ok(text.includes(marker));
    assert.ok(text.includes('<script>literal only</script>'));
    assert.equal(await report.locator('#comparison-report-ready script').count(),0);
    await printReport(report,'S6006-investigation-long-metadata',markers);
    await report.close();await blocked.close();
  });

  const mobile=await newPage('S6006 investigation basis mobile',{width:390,height:844},true);
  await check('S6006 investigation forms, changes, source catalogue and saved inspection fit the 390px mobile workflow',async()=>{
    const m=mobile.page;
    await m.goto(baseURL+'/projects/s6006/');await ready(m);
    await importProject(m,fixture,'s6006-investigation-project.json');await panel(m,'investigation');
    await m.locator('#investigation-content').scrollIntoViewIfNeeded();
    await screenshot(m,'s6006-investigation-mobile.png',false);
    await assertNoOverflow(m,'Investigation mobile');
    for(const selector of ['#investigation-scenario','#export-investigations','#investigation-soil-boreholeId','#investigation-soil-applicabilityNote','[data-investigation-save="soil"]','[data-investigation-bind="soil"]']){
      const box=await m.locator(selector).boundingBox();
      assert.ok(box&&box.x>=-1&&box.x+box.width<=391,selector+' fits mobile viewport');
    }
    await group(m,'soil').locator('.investigation-changes').first().scrollIntoViewIfNeeded();
    await screenshot(m,'s6006-investigation-changes-mobile.png',false);
    await m.locator('.investigation-catalogue > summary').click();
    assert.ok((await m.locator('[data-investigation-borehole="BH-8"]').innerText()).includes('ไม่ระบุในต้นฉบับ'));
    await m.locator('[data-investigation-borehole="BH-8"]').scrollIntoViewIfNeeded();
    await assertNoOverflow(m,'Investigation source catalogue mobile');
    await m.locator('#investigation-scenario').selectOption('basis-a');
    assert.equal(await m.locator('[data-investigation-metadata]').count(),0);
    await assertState(m,'soil','current');
    await m.locator('#investigation-content').scrollIntoViewIfNeeded();
    await screenshot(m,'s6006-investigation-saved-mobile.png',false);
    await assertNoOverflow(m,'Investigation saved metadata mobile');
    const csv=await download(m,'#export-investigations','s6006-investigation-mobile-saved.csv');
    assert.equal(await readFile(csv,'utf8'),investigationCSV(buildInvestigationReview(fixture,source,first.id,'basis-a')));
    assertNoErrors(mobile.diagnostics);
  });
  await mobile.context.close();await desktop.context.close();
}
