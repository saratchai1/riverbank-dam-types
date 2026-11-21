import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { runS6006Checks } from './s6006-browser.mjs';

// Normal end-to-end tests run in CI with Playwright's installed Chromium.
// Studio fixtures are synthetic. S6006 uses the reviewed derived numeric dataset; raw uploaded source files and tutorial images are not served.
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'test-results');
const fixtures = path.join(output, 'fixtures');
const baseURL = 'http://127.0.0.1:8769';
const report = { started: new Date().toISOString(), checks: [], pages: [], screenshots: [], status: 'running' };
let server;
let serverError;
let serverLog = '';
let browser;
let currentPage;

await mkdir(fixtures, { recursive: true });

async function check(name, run) {
  const result = { name, started: new Date().toISOString(), status: 'running' };
  report.checks.push(result);
  try {
    await run();
    result.status = 'passed';
    console.log(`PASS ${name}`);
  } catch (error) {
    result.status = 'failed';
    result.error = error.stack || error.message;
    throw error;
  } finally {
    result.finished = new Date().toISOString();
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (serverError) throw serverError;
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Static server exited: ${serverLog}`);
    try {
      const response = await fetch(`${baseURL}/studio.html`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.text()).includes('Riverbank Studio')) return;
    } catch { /* The child process may still be binding its port. */ }
    await delay(125);
  }
  throw new Error(`Static server did not become ready: ${serverLog}`);
}

async function newPage(label, viewport, mobile = false) {
  const context = await browser.newContext({
    viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(45000);
  const diagnostics = { label, viewport, pageErrors: [], consoleErrors: [], failedLocalRequests: [] };
  report.pages.push(diagnostics);
  page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    if (request.url().startsWith(baseURL)) diagnostics.failedLocalRequests.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  page.on('response', response => {
    if (response.url().startsWith(baseURL) && response.status() >= 400) {
      diagnostics.failedLocalRequests.push(`${response.status()} ${response.url()}`);
    }
  });
  // The legacy reference viewer requests a remote font. Font hosting is outside
  // this regression scope; the app's documented local fallback fonts are used.
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  currentPage = page;
  return { page, context, diagnostics };
}

function assertNoErrors(diagnostics) {
  assert.deepEqual(diagnostics.pageErrors, [], `${diagnostics.label}: uncaught page errors`);
  assert.deepEqual(diagnostics.consoleErrors, [], `${diagnostics.label}: browser console errors`);
  assert.deepEqual(diagnostics.failedLocalRequests, [], `${diagnostics.label}: missing/failed local resources`);
}

async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(dimensions.document <= dimensions.width + 1, `${label}: horizontal page overflow ${JSON.stringify(dimensions)}`);
}

async function screenshot(page, filename, fullPage = true) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(output, filename), fullPage, animations: 'disabled' });
  report.screenshots.push(filename);
}

async function goToStep(page, step) {
  await page.locator(`[data-step="${step}"]`).click();
  await page.waitForFunction(value => document.querySelector(`[data-step="${value}"]`)?.getAttribute('aria-current') === 'step', step);
  assert.ok((await page.locator('#inspector-content h2').innerText()).trim(), `Step ${step} has a heading`);
  await assertNoOverflow(page, `Studio ${step}`);
}

async function changeValue(page, selector, value) {
  const field = page.locator(selector);
  await field.fill(String(value));
  await field.press('Tab');
}

async function download(page, selector, filename) {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  const result = await pending;
  assert.equal(await result.failure(), null, `Download ${filename} completed`);
  const destination = path.join(fixtures, filename);
  await result.saveAs(destination);
  return destination;
}

async function chooseFile(page, button, filename) {
  const pending = page.waitForEvent('filechooser');
  await page.locator(button).click();
  await (await pending).setFiles(filename);
}

async function waitForStudio(page) {
  await page.waitForSelector('#drawing svg');
  await page.waitForSelector('#scene canvas');
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#scene canvas');
    return canvas?.width > 100 && canvas?.height > 100;
  });
  assert.equal(await page.locator('#scene .scene-fallback').count(), 0, 'CI renders the actual 3D scene');
}

async function fixture(name, text) {
  const destination = path.join(fixtures, name);
  await writeFile(destination, text);
  return destination;
}

try {
  server = spawn('python3', ['-m', 'http.server', '8769', '--bind', '127.0.0.1', '--directory', root], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.on('error', error => { serverError = error; });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { serverLog = (serverLog + data.toString()).slice(-16000); });
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  const desktop = await newPage('studio-desktop', { width: 1440, height: 1080 });
  const page = desktop.page;
  await check('Studio loads the T3 sample and all five workflow steps', async () => {
    await page.goto(`${baseURL}/studio.html`, { waitUntil: 'domcontentloaded' });
    await waitForStudio(page);
    assert.equal(await page.locator('.workflow [data-step]').count(), 5);
    assert.equal(await page.locator('#section-count').innerText(), '5');
    await screenshot(page, 'studio-sample-t3-desktop.png');
    for (const step of ['survey', 'soil', 'section', 'review', 'export']) await goToStep(page, step);
    await page.locator('#review-area').waitFor({ state: 'hidden' });
    await page.locator('#quantity-area').waitFor({ state: 'visible' });
  });

  await check('Changing T1 geometry and station updates the displayed section', async () => {
    await goToStep(page, 'section');
    await page.locator('[data-type="T1-01"]').click();
    await page.locator('[data-number="geometry.slopeH"]').waitFor();
    const before = await page.locator('#drawing').innerHTML();
    await changeValue(page, '[data-number="geometry.slopeH"]', 2.5);
    assert.equal(await page.locator('[data-number="geometry.slopeH"]').inputValue(), '2.5');
    assert.notEqual(await page.locator('#drawing').innerHTML(), before, 'Geometry edit changes section drawing');
    await changeValue(page, '#station-input', '0+025');
    await page.waitForFunction(() => document.querySelector('#station-title').textContent === '0+025');
    assert.equal(await page.locator('#station-range').inputValue(), '25');
    await screenshot(page, 'studio-sample-t1-desktop.png');
  });

  const manualReference = 'CI SYNTHETIC REPORT — demonstration only';
  await check('A manual external FS becomes stale after an engineering edit', async () => {
    await goToStep(page, 'review');
    await page.locator('#analysis-form [name="station"]').selectOption('25');
    await page.locator('#analysis-form [name="case"]').selectOption('construction');
    await page.locator('#analysis-form [name="fs"]').fill('1.65');
    await page.locator('#analysis-form [name="reference"]').fill(manualReference);
    await page.locator('#analysis-form [type="submit"]').click();
    const resultRow = page.locator('#review-area tbody tr').filter({ hasText: manualReference });
    assert.equal(await resultRow.count(), 1);
    assert.equal(await resultRow.locator('.badge').innerText(), 'ตรงรุ่นข้อมูล');
    assert.equal(await resultRow.locator('td').nth(2).innerText(), '1.650');
    await goToStep(page, 'section');
    await changeValue(page, '[data-number="geometry.slopeH"]', 3);
    await goToStep(page, 'review');
    assert.equal(await resultRow.locator('.badge').innerText(), 'ล้าสมัย');
    assert.equal(await resultRow.locator('td').nth(2).innerText(), '1.650', 'Stale result keeps its recorded value');
  });

  await check('Invalid unit prices are rejected without changing the accepted amount', async () => {
    await goToStep(page, 'export');
    const code = await page.locator('[data-rate="material"]').first().getAttribute('data-code');
    const selector = rate => `[data-rate="${rate}"][data-code="${code}"]`;
    await changeValue(page, selector('material'), 2500);
    await changeValue(page, selector('labour'), 500);
    await changeValue(page, selector('source'), 'CI sample price, not approved');
    const row = page.locator(selector('material')).locator('xpath=ancestor::tr');
    const amount = await row.locator('td').last().innerText();
    assert.notEqual(amount, '—');
    assert.match(await page.locator('#price-completeness').innerText(), /3 รายการยังกรอกราคาไม่ครบ/, 'Sidebar remaining count updates after one complete price');
    await changeValue(page, selector('material'), -1);
    await page.locator('#notice.error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#notice.error').innerText(), /ค่าวัสดุและค่าแรง/, 'Price validation uses a human-facing Thai message');
    assert.equal(await page.locator(selector('material')).inputValue(), '2500');
    assert.equal(await row.locator('td').last().innerText(), amount);
    assert.match(await page.locator('#price-completeness').innerText(), /3 รายการยังกรอกราคาไม่ครบ/, 'Rejected price preserves the sidebar remaining count');
    await screenshot(page, 'studio-export-desktop.png');
    const csv = await download(page, '[data-export="quantity"]', 'quantity-draft.csv');
    assert.ok((await readFile(csv, 'utf8')).length > 100, 'Quantity CSV contains data');
    const dxf = await download(page, '[data-export="dxf"]', 'section-concept.dxf');
    assert.match(await readFile(dxf, 'utf8'), /ENTITIES/);
    const svg = await download(page, '[data-export="svg"]', 'section-concept.svg');
    assert.match(await readFile(svg, 'utf8'), /<svg\b/);
  });

  await check('JSON download and reopen preserve the complete edited project', async () => {
    const savedPath = await download(page, '#save-project', 'roundtrip-before.json');
    const expected = JSON.parse(await readFile(savedPath, 'utf8'));
    assert.equal(expected.geometry.type, 'T1-01');
    assert.equal(expected.geometry.slopeH, 3);
    assert.equal(expected.selectedStation, 25);
    assert.equal(expected.analysis.length, 1);
    await goToStep(page, 'survey');
    await changeValue(page, '[data-field="name"]', 'Temporary CI name');
    assert.equal(await page.locator('#project-name').innerText(), 'Temporary CI name');
    await chooseFile(page, '#open-project', savedPath);
    await page.waitForFunction(name => document.querySelector('#project-name').textContent === name, expected.name);
    const reopened = await download(page, '#save-project', 'roundtrip-after.json');
    assert.deepEqual(JSON.parse(await readFile(reopened, 'utf8')), expected);
    await goToStep(page, 'review');
    assert.equal(await page.locator('#review-area tbody tr').filter({ hasText: manualReference }).locator('.badge').innerText(), 'ล้าสมัย');
  });

  await check('CSV alignment, survey, soil and referenced analysis import through the UI', async () => {
    const alignment = await fixture('synthetic-alignment.csv', 'x,y\n500000,1500000\n500050,1500000\n500100,1500000\n');
    const surveyRows = ['station,offset,elevation'];
    for (const station of [0, 50, 100]) for (const [offset, elevation] of [[-15, 94], [0, 98], [10, 99]]) surveyRows.push(`${station},${offset},${elevation}`);
    const survey = await fixture('synthetic-survey.csv', surveyRows.join('\n') + '\n');
    const soil = await fixture('synthetic-soil.csv', 'borehole,station,from_station,to_station,bottom,name,unit_weight,phi,cohesion,source\nBH-CI,50,0,100,90,Synthetic sand,18,30,0,CI fixture only\n');
    const analysis = await fixture('synthetic-analysis.csv', 'station,case,fs,reference\n0,low-water,1.72,CI synthetic external analysis\n');
    await goToStep(page, 'survey');
    await chooseFile(page, '[data-file="alignment"]', alignment);
    await page.waitForFunction(() => document.querySelector('#section-count').textContent === '0');
    assert.equal(await page.locator('#length-value').innerText(), '100.00');
    await page.locator('#file-survey').setInputFiles(survey);
    await page.waitForFunction(() => document.querySelector('#section-count').textContent === '3');
    await goToStep(page, 'soil');
    await chooseFile(page, '[data-file="soil"]', soil);
    await page.waitForFunction(() => document.querySelector('#soil-select')?.textContent.includes('BH-CI'));
    assert.equal(await page.locator('[data-bh-field="verified"]').isChecked(), false, 'Import does not certify soil');
    await goToStep(page, 'review');
    assert.equal(await page.locator('#review-area tbody tr').filter({ hasText: manualReference }).count(), 0, 'New alignment clears previous analysis');
    await page.locator('#file-analysis').setInputFiles(analysis);
    const imported = page.locator('#review-area tbody tr').filter({ hasText: 'CI synthetic external analysis' });
    await imported.waitFor();
    assert.equal(await imported.locator('.badge').innerText(), 'ตรงรุ่นข้อมูล');
    assert.equal(await imported.locator('td').nth(2).innerText(), '1.720');
  });

  await check('DXF import requires explicit path choice and metre acknowledgement', async () => {
    const dxfText = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n'
      + '0\nLWPOLYLINE\n8\nBANK_A\n90\n2\n70\n0\n10\n500000\n20\n1500000\n10\n500100\n20\n1500000\n'
      + '0\nLINE\n8\nBANK_B\n10\n500000\n20\n1500010\n11\n500100\n21\n1500010\n0\nENDSEC\n0\nEOF\n';
    const dxf = await fixture('synthetic-alignment.dxf', dxfText);
    await goToStep(page, 'survey');
    await chooseFile(page, '[data-file="alignment"]', dxf);
    await page.locator('#import-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#import-content .path-choice').count(), 2);
    await page.locator('#import-content input[name="dxf-path"]').nth(1).check();
    await page.locator('#apply-dxf').click();
    assert.equal(await page.locator('#import-dialog').isVisible(), true, 'Unacknowledged units keep the import dialog open');
    await page.locator('#metres-confirm').check();
    await page.locator('#apply-dxf').click();
    await page.locator('#import-dialog').waitFor({ state: 'hidden' });
    assert.match(await page.locator('.import-source').first().innerText(), /BANK_B/);
    assert.equal(await page.locator('#section-count').innerText(), '0');
    assert.equal(await page.locator('#length-value').innerText(), '100.00');
    await assertNoOverflow(page, 'Studio after DXF import');
    assertNoErrors(desktop.diagnostics);
  });
  await desktop.context.close();

  const mobile = await newPage('studio-mobile', { width: 390, height: 844 }, true);
  await check('Mobile studio remains usable through all five steps without page overflow', async () => {
    await mobile.page.goto(`${baseURL}/studio.html`, { waitUntil: 'domcontentloaded' });
    await waitForStudio(mobile.page);
    for (const step of ['survey', 'soil', 'section', 'review', 'export']) await goToStep(mobile.page, step);
    await goToStep(mobile.page, 'section');
    await mobile.page.locator('[data-type="T1-01"]').click();
    await changeValue(mobile.page, '[data-number="geometry.slopeH"]', 2.5);
    const oldStation = await mobile.page.locator('#station-title').innerText();
    await mobile.page.locator('#next-station').click();
    assert.notEqual(await mobile.page.locator('#station-title').innerText(), oldStation);
    await screenshot(mobile.page, 'studio-mobile.png');
    await assertNoOverflow(mobile.page, 'Studio mobile drawing');
    assertNoErrors(mobile.diagnostics);
  });
  await mobile.context.close();

  for (const [label, viewport, isMobile] of [
    ['reference-desktop', { width: 1440, height: 960 }, false],
    ['reference-mobile', { width: 390, height: 844 }, true],
  ]) {
    const reference = await newPage(label, viewport, isMobile);
    await check(`${label}: original five types and Object Library still load`, async () => {
      const p = reference.page;
      await p.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#loading.gone', { state: 'attached' });
      assert.equal(await p.locator('#type-list [data-type]').count(), 5);
      for (const id of ['T1-01', 'T2-01', 'T3-01', 'T4-01', 'T5-01']) {
        await p.locator(`#type-list [data-type="${id}"]`).click();
        await p.waitForFunction(type => document.querySelector('#type-title b')?.textContent.startsWith(type) && !document.querySelector('#busy')?.classList.contains('on'), id);
        assert.equal(await p.locator(`#type-list [data-type="${id}"]`).getAttribute('aria-checked'), 'true');
        assert.ok(await p.locator('#comp-list .comp').count() > 0, `${id} has component rows`);
        assert.ok(await p.locator('#boq tbody tr').count() > 0, `${id} has BOQ rows`);
        await p.locator('#stage-model canvas').waitFor();
        await assertNoOverflow(p, `${label} ${id}`);
        if (id === 'T3-01') {
          await p.locator('#stage-model').scrollIntoViewIfNeeded();
          await screenshot(p, `${label}-t3.png`, !isMobile);
        }
      }
      await p.locator('[data-tab="library"]').click();
      await p.locator('#tab-library.on').waitFor();
      assert.equal(await p.locator('.card[data-fam]').count(), 27);
      for (const id of ['pile', 'rock_toe']) {
        await p.locator(`.card[data-fam="${id}"]`).click();
        await p.waitForFunction(family => document.querySelector('#fam-detail .id')?.textContent === family && !document.querySelector('#lib-hint')?.textContent.includes('กำลังโหลด'), id);
        assert.ok((await p.locator('#fam-detail h2').innerText()).length > 0);
      }
      await p.locator('#fam-detail').scrollIntoViewIfNeeded();
      await screenshot(p, `${label}-library.png`, !isMobile);
      await assertNoOverflow(p, `${label} library`);
      await p.locator('#to-model').click();
      await p.locator('#tab-model.on').waitFor();
      assertNoErrors(reference.diagnostics);
    });
    await reference.context.close();
  }
  await runS6006Checks({newPage,check,screenshot,assertNoErrors,assertNoOverflow,download,chooseFile,changeValue,baseURL,output});
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack || error.message;
  console.error(report.error);
  if (currentPage && !currentPage.isClosed()) {
    try { await screenshot(currentPage, 'failure.png'); } catch { /* Keep the original test failure. */ }
  }
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit').catch(() => {});
    server.kill('SIGTERM');
    await Promise.race([exited, delay(3000)]);
    if (server.exitCode === null && server.signalCode === null) { server.kill('SIGKILL'); await exited; }
  }
  report.finished = new Date().toISOString();
  await writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(output, 'static-server.log'), serverLog);
  console.log(`Browser smoke ${report.status}. Evidence: test-results/browser-report.json`);
}
