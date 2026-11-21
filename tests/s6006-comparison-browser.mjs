import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { getActiveScenario, getStationComparison, projectRevision } from '../projects/s6006/project.js';

// All edits and corrupt-storage fixtures below run in isolated CI contexts.
export async function runS6006ComparisonChecks({newPage,check,screenshot,assertNoErrors,assertNoOverflow,download,chooseFile,changeValue,baseURL,output}) {
  const desktop=await newPage('S6006 alternatives desktop',{width:1440,height:1050});
  const p=desktop.page;
  const ready=async page=>{
    await page.waitForFunction(()=>['true','error'].includes(document.body.dataset.ready));
    assert.equal(await page.locator('body').getAttribute('data-ready'),'true',await page.locator('#notice').textContent());
  };
  const panel=async (page,name)=>{
    await page.locator(`#case-tabs [data-panel="${name}"]`).click();
    await page.locator(`#panel-${name}`).waitFor({state:'visible'});
  };
  const capture=async (page,name)=>{
    await page.locator('#alternative-name').fill(name);
    await page.locator('#save-alternative').click();
    assert.match(await page.locator('#notice').innerText(),/เก็บทางเลือก/);
  };
  const savedIds=async page=>page.locator('.alternative-card:not(.current)').evaluateAll(cards=>cards.map(card=>card.dataset.alternativeId));
  const importProject=async (page,file)=>{
    const revision=projectRevision(JSON.parse(await readFile(file,'utf8')));
    await chooseFile(page,'#load-case',file);
    await page.waitForFunction(expected=>document.querySelector('#project-revision')?.textContent===expected&&document.querySelector('#notice')?.textContent.includes('เปิดโครงการครบ'),revision);
  };
  const cell=(page,row,id='current')=>page.locator(`[data-comparison-row="${row}"] td[data-entry-id="${id}"]`).first();
  let a,b,c,projectFile,projectJSON,comparisonReport,snapshotText,snapshotRevision;

  await check('S6006 saves same-station A/B/C alternatives and preserves strength gates and distinct soil cases',async()=>{
    await p.goto(`${baseURL}/projects/s6006/`);await ready(p);
    await p.locator('[data-open-panel="comparison"]').click();
    assert.equal(await p.locator('#report-comparison').isDisabled(),true);
    assert.equal(await p.locator('#export-comparison').isDisabled(),true);
    await capture(p,'A · รูปตัดและเหล็กเดิม');
    [a]=await savedIds(p);
    assert.equal(await p.locator('#comparison-content').getAttribute('data-reference-id'),a);
    assert.equal(await cell(p,'beam.usablePhiMnKnM',a).getAttribute('data-availability'),'gated');
    assert.equal(await cell(p,'beam.usablePhiMnKnM',a).locator('.comparison-value').innerText(),'—');
    await panel(p,'model');await changeValue(p,'#geometry-form [name="slopeH"]',3.5);
    await panel(p,'engineering');
    await changeValue(p,'#beam-form [name="tensionBarDiameterMm"]',16);
    await changeValue(p,'#beam-form [name="stirrupDiameterMm"]',8);
    await changeValue(p,'#beam-form [name="externalMuKnM"]',30);
    await changeValue(p,'#beam-form [name="externalVuKn"]',50);
    await panel(p,'comparison');await capture(p,'B · ลาด 3.5 และเหล็ก Ø16');
    [,b]=await savedIds(p);
    assert.ok(Math.abs(Number(await cell(p,'beam.usablePhiMnKnM',b).getAttribute('data-value'))-60.47415713)<1e-6);
    assert.equal(await cell(p,'beam.usablePhiMnKnM',b).locator('.comparison-delta').count(),0,'A gated reference never becomes a zero capacity delta');
    assert.ok(Math.abs(Number(await cell(p,'soil.dry.factorOfSafety',b).getAttribute('data-value'))-2.187042732)<1e-6);
    assert.ok(Math.abs(Number(await cell(p,'soil.parallel-seepage.factorOfSafety',b).getAttribute('data-value'))-1.114664601)<1e-6);
    assert.equal(await cell(p,'geometry.run',a).getAttribute('data-value'),'32.5');
    assert.equal(await cell(p,'geometry.run',b).getAttribute('data-value'),'45.5');
    await panel(p,'engineering');await p.locator('#soil-form [name="mode"]').selectOption('undrained');
    await panel(p,'comparison');await capture(p,'C · รอค่า Su จากผลทดสอบ');
    [,,c]=await savedIds(p);
    assert.equal(await cell(p,'soil.undrained.factorOfSafety',c).getAttribute('data-availability'),'missing');
    assert.equal(await cell(p,'soil.dry.factorOfSafety',c).getAttribute('data-availability'),'not-applicable');
    assert.equal(await cell(p,'soil.undrained.factorOfSafety',c).locator('.comparison-delta').count(),0);
    assert.equal(await p.locator('#save-alternative').isDisabled(),true,'Three stored alternatives is the visible cap');
    await p.locator(`[data-reference-alternative="${b}"]`).click();
    assert.equal(await p.locator('#comparison-content').getAttribute('data-reference-id'),b);
    assert.equal(await p.locator('#soil-form [name="mode"]').inputValue(),'undrained','Reference selection does not apply inputs');
    await p.locator(`[data-apply-alternative="${b}"]`).click();
    assert.equal(await p.locator('#soil-form [name="mode"]').inputValue(),'effective');
    assert.equal(await p.locator('#geometry-form [name="slopeH"]').inputValue(),'3.5');
    await assertNoOverflow(p,'Comparison desktop');
    await p.locator('#comparison-content').scrollIntoViewIfNeeded();
    await screenshot(p,'s6006-alternatives-desktop.png',false);
    await p.locator('[data-comparison-group="beam"]').scrollIntoViewIfNeeded();
    await screenshot(p,'s6006-alternatives-beam.png',false);
    assertNoErrors(desktop.diagnostics);
  });

  await check('S6006 alternatives stay isolated by station and survive JSON, reload, reference changes and explicit removal',async()=>{
    await p.locator('#next-station').click();
    assert.deepEqual(await savedIds(p),[]);
    assert.equal(await p.locator('#report-comparison').isDisabled(),true);
    await capture(p,'สถานี 0+025 · ชุดแยก');
    assert.equal((await savedIds(p)).length,1);
    await p.locator('#previous-station').click();
    assert.deepEqual(await savedIds(p),[a,b,c]);
    assert.equal(await p.locator('#comparison-content').getAttribute('data-reference-id'),b);
    projectFile=await download(p,'#save-case','s6006-alternatives-project.json');
    projectJSON=JSON.parse(await readFile(projectFile,'utf8'));
    assert.equal(projectJSON.version,2);
    assert.equal(Object.keys(projectJSON.stationComparisons).length,2);
    assert.equal(getStationComparison(projectJSON).alternatives.length,3);
    assert.equal(getActiveScenario(projectJSON).beamInputs.externalMuKnM,30);
    await p.reload();await ready(p);await panel(p,'comparison');
    assert.deepEqual(await savedIds(p),[a,b,c]);
    assert.equal(await p.locator('#save-alternative').isDisabled(),true,'Loading readiness does not bypass the stored count limit');
    await p.locator(`[data-remove-alternative="${c}"]`).click();
    assert.equal((await savedIds(p)).length,3,'First removal click asks for explicit confirmation');
    await p.locator('[data-cancel-remove]').click();
    assert.equal((await savedIds(p)).length,3);
    await p.locator(`[data-remove-alternative="${c}"]`).click();
    await p.locator(`[data-confirm-remove="${c}"]`).click();
    assert.equal((await savedIds(p)).length,2);
    assert.equal(await p.locator('#save-alternative').isEnabled(),true);
    await importProject(p,projectFile);
    assert.deepEqual(await savedIds(p),[a,b,c]);
    const corrupt=structuredClone(projectJSON);
    corrupt.stationComparisons[corrupt.selectedStationId].alternatives[0].scenario.geometry.rockThickness=-1;
    const badFile=path.join(output,'fixtures','s6006-invalid-alternative.json');
    await writeFile(badFile,JSON.stringify(corrupt));
    const oldRevision=await p.locator('#project-revision').innerText();
    await chooseFile(p,'#load-case',badFile);
    await p.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('เปิดไฟล์ไม่ได้'));
    assert.match(await p.locator('#notice').innerText(),/เปิดไฟล์ไม่ได้/);
    assert.equal(await p.locator('#project-revision').innerText(),oldRevision);
    assert.deepEqual(await savedIds(p),[a,b,c]);
    const csv=await download(p,'#export-comparison','s6006-alternatives-comparison.csv');
    const text=await readFile(csv,'utf8');
    for(const marker of ['S6006',a,b,c,'usablePhiMnKnM','dry','undrained'])assert.ok(text.includes(marker),`Comparison CSV keeps ${marker}`);
    assertNoErrors(desktop.diagnostics);
  });

  async function verifyPrint(page,filename){
    await page.emulateMedia({media:'print'});
    await page.setViewportSize({width:680,height:1100});
    await page.evaluate(()=>document.fonts.ready);
    const metrics=await page.locator('.report-page').evaluateAll(pages=>pages.map((sheet,index)=>{
      const footer=sheet.querySelector('.running-foot').getBoundingClientRect();
      const bottom=Math.max(...[...sheet.children].filter(node=>!node.classList.contains('running-foot')).map(node=>node.getBoundingClientRect().bottom));
      return {page:index+1,title:sheet.dataset.pageTitle,bottom,footerTop:footer.top,clearance:footer.top-bottom,fits:bottom<=footer.top-12};
    }));
    assert.ok(metrics.length>=3,'Comparison prints provenance and full input/result tables');
    await writeFile(path.join(output,filename+'-page-metrics.json'),JSON.stringify(metrics,null,2));
    assert.deepEqual(metrics.filter(row=>!row.fits),[],'Every comparison page clears its footer by at least 12px');
    const pdfPath=path.join(output,filename+'.pdf');
    await page.pdf({path:pdfPath,format:'A4',printBackground:true,preferCSSPageSize:true});
    const extracted=execFileSync('pdftotext',['-layout',pdfPath,'-'],{encoding:'utf8',maxBuffer:15*1024*1024});
    assert.ok((extracted.match(/[ก-๙]/g)||[]).length>500,'Comparison PDF contains readable Thai text');
    assert.ok(extracted.includes('S6006'));
    await writeFile(path.join(output,filename+'.txt'),extracted);
    await page.emulateMedia({media:'screen'});
    return metrics;
  }

  await check('S6006 comparison report freezes all alternatives, reference and actual inputs and prints readable A4 pages',async()=>{
    snapshotRevision=await p.locator('#project-revision').innerText();
    [comparisonReport]=await Promise.all([p.waitForEvent('popup'),p.locator('#report-comparison').click()]);
    await comparisonReport.waitForFunction(()=>document.querySelector('#comparison-report-ready')?.dataset.ready==='true');
    assert.equal(await comparisonReport.locator('#comparison-report-ready').getAttribute('data-project-revision'),snapshotRevision);
    assert.equal(await comparisonReport.locator('#comparison-report-ready').getAttribute('data-reference-id'),b);
    assert.equal(await comparisonReport.locator('#print-comparison-report').isEnabled(),true);
    snapshotText=await comparisonReport.locator('#comparison-report-ready').innerText();
    for(const marker of ['A · รูปตัดและเหล็กเดิม','B · ลาด 3.5 และเหล็ก Ø16','C · รอค่า Su จากผลทดสอบ','3.5','60.474','Asia/Bangkok'])assert.ok(snapshotText.includes(marker),`Report retains ${marker}`);
    await panel(p,'model');await changeValue(p,'#geometry-form [name="slopeH"]',4);
    await comparisonReport.reload();
    await comparisonReport.waitForFunction(()=>document.querySelector('#comparison-report-ready')?.dataset.ready==='true');
    assert.equal(await comparisonReport.locator('#comparison-report-ready').innerText(),snapshotText,'Later edits cannot mutate the stored comparison');
    await screenshot(comparisonReport,'s6006-comparison-report.png',false);
    await assertNoOverflow(comparisonReport,'Comparison report desktop');
    await verifyPrint(comparisonReport,'S6006-alternatives-comparison');
    assertNoErrors(desktop.diagnostics);
  });

  await check('S6006 comparison report refuses missing/corrupt snapshots and paginates long context completely',async()=>{
    const bad=await desktop.context.newPage();
    await bad.goto(`${baseURL}/projects/s6006/comparison-report.html`);
    await bad.locator('#comparison-report-error').waitFor({state:'visible'});
    assert.equal(await bad.locator('#print-comparison-report').isDisabled(),true);
    assert.equal(await bad.locator('.report-page').count(),0);
    await bad.goto(`${baseURL}/projects/s6006/comparison-report.html?snapshot=missing-comparison-0001`);
    await bad.locator('#comparison-report-error').waitFor({state:'visible'});
    assert.equal(await bad.locator('#print-comparison-report').isDisabled(),true);
    await bad.evaluate(()=>localStorage.setItem('riverbank.s6006.comparison-snapshot.v1.corrupt-comparison-0001','{invalid'));
    await bad.goto(`${baseURL}/projects/s6006/comparison-report.html?snapshot=corrupt-comparison-0001`);
    await bad.locator('#comparison-report-error').waitFor({state:'visible'});
    assert.equal(await bad.locator('.report-page').count(),0);await bad.close();
    const long=structuredClone(projectJSON),station=long.selectedStationId;
    const alternatives=long.stationComparisons[station].alternatives;
    for(let i=0;i<alternatives.length;i++){
      alternatives[i].name=i===1?('ข\n'.repeat(23)+'ขข'):['ก','ข','ค'][i].repeat(48);
      for(const field of ['boreholeReference','waterReference','sourceNote'])alternatives[i].scenario.context[field]=('ทดสอบ '+field+' <script>ข้อความ</script> ').repeat(70).slice(0,1900)+' END-'+i+'-'+field;
    }
    const longFile=path.join(output,'fixtures','s6006-long-comparison.json');
    await writeFile(longFile,JSON.stringify(long));
    await importProject(p,longFile);await panel(p,'comparison');
    const [longReport]=await Promise.all([p.waitForEvent('popup'),p.locator('#report-comparison').click()]);
    await longReport.waitForFunction(()=>document.querySelector('#comparison-report-ready')?.dataset.ready==='true');
    const longText=await longReport.locator('#comparison-report-ready').innerText();
    for(let i=0;i<3;i++)for(const field of ['boreholeReference','waterReference','sourceNote'])assert.ok(longText.includes('END-'+i+'-'+field),'Full context ending remains printable');
    assert.equal(await longReport.locator('#comparison-report-ready script').count(),0);
    await verifyPrint(longReport,'S6006-alternatives-long-context');
    await longReport.close();await comparisonReport.close();
    await importProject(p,projectFile);
    assertNoErrors(desktop.diagnostics);
  });

  const mobile=await newPage('S6006 alternatives mobile',{width:390,height:844},true);
  await check('S6006 mobile alternatives keep actions, inputs and scrollable comparisons inside the viewport',async()=>{
    const page=mobile.page;await page.goto(`${baseURL}/projects/s6006/`);await ready(page);
    await importProject(page,projectFile);await panel(page,'comparison');
    await assertNoOverflow(page,'Comparison mobile four alternatives');
    const controls=await page.locator('#comparison-content input,#comparison-content button').evaluateAll(nodes=>nodes.filter(node=>node.getBoundingClientRect().width>0).map(node=>{
      const r=node.getBoundingClientRect();return {label:node.textContent||node.id,left:r.left,right:r.right,width:r.width};
    }));
    for(const control of controls)assert.ok(control.left>=0&&control.right<=391,'Mobile comparison control stays visible: '+JSON.stringify(control));
    await page.locator('#comparison-content').scrollIntoViewIfNeeded();
    await screenshot(page,'s6006-alternatives-mobile.png',false);
    await page.locator('[data-comparison-group="beam"]').scrollIntoViewIfNeeded();
    await screenshot(page,'s6006-alternatives-beam-mobile.png',false);
    const [report]=await Promise.all([page.waitForEvent('popup'),page.locator('#report-comparison').click()]);
    await report.waitForFunction(()=>document.querySelector('#comparison-report-ready')?.dataset.ready==='true');
    await assertNoOverflow(report,'Comparison report mobile');
    await screenshot(report,'s6006-comparison-report-mobile.png',false);
    assertNoErrors(mobile.diagnostics);await report.close();
  });
  await desktop.context.close();await mobile.context.close();
}
