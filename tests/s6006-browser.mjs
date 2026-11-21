import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Runs only in the existing CI Playwright harness. The checked source fixture is
// deliberately distinct from the editable ideal-section model.
export async function runS6006Checks({ newPage, check, screenshot, assertNoErrors, assertNoOverflow, download, chooseFile, changeValue, baseURL, output }) {
  const desktop = await newPage('S6006 desktop', { width: 1440, height: 1000 });
  const { page, diagnostics } = desktop;
  const fixtures = path.join(output, 'fixtures');
  await mkdir(fixtures, { recursive: true });
  let originalSummary, originalFS, originalFace, editedFace, savedCase;
  const panel = async (p, name) => {
    await p.locator(`#case-tabs [data-panel="${name}"]`).click();
    await p.waitForFunction(key => document.querySelector(`#panel-${key}`)?.hidden === false, name);
    assert.equal(await p.locator(`#case-tabs [data-panel="${name}"]`).getAttribute('aria-current'), 'page');
  };
  const waitReady = async (p) => {
    await p.waitForFunction(() => ['true', 'error'].includes(document.body.dataset.ready));
    assert.equal(await p.locator('body').getAttribute('data-ready'), 'true', await p.locator('#notice').textContent());
  };
  const svgScales = async (p, selector) => {
    const result = await p.locator(selector).evaluate(svg => ({ x: Number(svg.dataset.scaleX), y: Number(svg.dataset.scaleY) }));
    assert.ok(result.x > 0 && Number.isFinite(result.x));
    assert.equal(result.x, result.y, 'Section uses the same scale in both axes');
  };

  await check('S6006 source case opens a real 3D context and equal-scale source section', async () => {
    await page.goto(`${baseURL}/projects/s6006/`);
    await waitReady(page);
    assert.equal(await page.locator('#panel-overview').evaluate(el => el.hidden), false);
    assert.match(await page.locator('h1').innerText(), /บ้านแดนเมือง/);
    await page.waitForFunction(() => { const c = document.querySelector('#case-scene canvas'); return c?.width > 100 && c?.height > 100; });
    const webgl = await page.locator('#case-scene canvas').evaluate(canvas => {
      const gl = canvas.getContext('webgl2'); return gl ? gl.getParameter(gl.VERSION) : null;
    });
    assert.match(webgl || '', /WebGL/, 'CI uses the actual interactive scene, not fallback text');
    assert.equal(await page.locator('#case-scene > p').count(), 0, 'Loading placeholder does not displace the canvas');
    assert.match(await page.locator('#case-scene').innerText(), /100 ม\./);
    assert.match(await page.locator('#typical-drawing').textContent(), /ระดับสมมุติ/);
    await svgScales(page, '#typical-drawing svg');
    assert.equal(await page.locator('#typical-drawing [data-component="facing-rock"]').count(), 1);
    assert.equal(await page.locator('#typical-drawing [data-component="sand-minimum-strip"]').count(), 1);
    assert.equal(await page.locator('#typical-drawing [data-component="toe-ideal-trapezoid"]').count(), 1);
    originalFace = await page.locator('#typical-drawing [data-component="facing-rock"]').getAttribute('points');
    await assertNoOverflow(page, 'S6006 overview desktop');
    await screenshot(page, 's6006-overview-desktop.png');
    await page.locator('[data-view="section"]').click();
    await screenshot(page, 's6006-section-3d-desktop.png', false);
    await page.locator('[data-view="top"]').click();
    await page.locator('[data-view="iso"]').click();
    await page.locator('#fit-scene').click();
    assertNoErrors(diagnostics);
  });

  await check('S6006 audits 41 source stations and preserves missing-input versus missing-product distinctions', async () => {
    await panel(page, 'quantities');
    assert.equal(await page.locator('#station-table tbody tr').count(), 41);
    assert.match(await page.locator('#source-coverage').innerText(), /41 แถว.*1,000 ม\./);
    assert.equal(await page.locator('#measure-select').inputValue(), 'riprap_facing');
    const first = page.locator('#station-table tbody tr').first().locator('td');
    assert.match(await first.nth(2).innerText(), /^16\.02/);
    assert.equal((await first.nth(3).innerText()).trim(), '200.25');
    assert.equal((await first.nth(4).innerText()).trim(), '200.25');
    assert.match(await first.nth(6).innerText(), /V14 × B14/);
    assert.match(await first.nth(7).innerText(), /ตรงกัน/);
    originalSummary = await page.locator('#quantity-summary').innerText();
    assert.match(originalSummary, /ยอดเฉพาะค่าที่ทราบ/);
    assert.match(originalSummary, /17,295/);
    assert.match(originalSummary, /40,985/);

    await page.locator('#measure-select').selectOption('geotextile_front');
    const t25 = page.locator('#station-table tbody tr').filter({ hasText: 'ผลเดิม T25' }).locator('td');
    assert.equal(await t25.count(), 8);
    assert.match(await t25.nth(2).innerText(), /^40\.425/);
    assert.equal((await t25.nth(3).innerText()).trim(), '—');
    assert.equal((await t25.nth(4).innerText()).trim(), '949.9875');
    assert.equal((await t25.nth(5).innerText()).trim(), '—');
    assert.match(await t25.nth(7).innerText(), /ผลเดิมว่าง.*คำนวณได้/);

    await page.locator('#measure-select').selectOption('riprap_slope_adjustment');
    const missing = page.locator('#station-table tbody tr').first().locator('td');
    assert.match(await missing.nth(2).innerText(), /^—/);
    assert.equal((await missing.nth(3).innerText()).trim(), '0');
    assert.equal((await missing.nth(4).innerText()).trim(), '—');
    assert.match(await missing.nth(7).innerText(), /ตั้งต้นว่าง/);

    await page.locator('#measure-select').selectOption('earth_fill');
    const ai128 = page.locator('#station-table tbody tr').filter({ hasText: 'AI128 × B128' }).locator('td');
    assert.equal(await ai128.count(), 8);
    assert.match(await ai128.nth(2).innerText(), /^—/);
    assert.equal((await ai128.nth(4).innerText()).trim(), '—');
    await page.locator('#measure-select').selectOption('geotextile_front');
    await page.evaluate(() => scrollTo(0, 0));
    await assertNoOverflow(page, 'S6006 quantities desktop');
    await screenshot(page, 's6006-quantities-desktop.png', false);

    await panel(page, 'basis');
    assert.equal(await page.locator('#reported-fs tbody tr').count(), 3);
    originalFS = await page.locator('#reported-fs').innerText();
    for (const fs of ['3.378', '2.588', '2.164']) assert.ok(originalFS.includes(fs));
    assert.match(await page.locator('#basis-content').innerText(), /ข้อมูลอ้างอิงจากภายนอก/);
    assertNoErrors(diagnostics);
  });

  await check('S6006 edits only the ideal geometry, rejects invalid levels and round-trips the case JSON', async () => {
    await panel(page, 'model');
    await changeValue(page, '#geometry-form [name="slopeH"]', 2);
    await changeValue(page, '#geometry-form [name="length"]', 500);
    assert.match(await page.locator('#geometry-status').innerText(), /ปรับมิติแล้ว/);
    assert.match(await page.locator('#model-drawing').textContent(), /ระยะราบ 26\.00/);
    await svgScales(page, '#model-drawing svg');
    editedFace = await page.locator('#model-drawing [data-component="facing-rock"]').getAttribute('points');
    assert.notEqual(editedFace, originalFace);
    await changeValue(page, '#geometry-form [name="toeLevel"]', 102);
    assert.equal(await page.locator('#geometry-form [name="toeLevel"]').inputValue(), '88');
    assert.equal(await page.locator('#notice').evaluate(el => el.hidden), false);
    assert.match(await page.locator('#notice').innerText(), /ระดับสันต้องสูงกว่าตีน/);
    assert.equal(await page.locator('#model-drawing [data-component="facing-rock"]').getAttribute('points'), editedFace);
    assert.doesNotMatch(await page.locator('#model-drawing svg').getAttribute('viewBox'), /NaN|Infinity/);
    savedCase = await download(page, '#save-case', 's6006-edited-case.json');
    const saved = JSON.parse(await readFile(savedCase, 'utf8'));
    assert.equal(saved.schema, 'riverbank.s6006.case');
    assert.equal(saved.version, 1); assert.equal(saved.projectCode, 'S6006');
    assert.equal(saved.inputs.slopeH, 2); assert.equal(saved.inputs.length, 500);
    await page.locator('#reset-model').click();
    assert.equal(await page.locator('#geometry-form [name="slopeH"]').inputValue(), '2.5');
    assert.equal(await page.locator('#model-drawing [data-component="facing-rock"]').getAttribute('points'), originalFace);
    await chooseFile(page, '#load-case', savedCase);
    await page.waitForFunction(() => document.querySelector('#geometry-form [name="slopeH"]')?.value === '2');
    assert.equal(await page.locator('#geometry-form [name="length"]').inputValue(), '500');
    assert.equal(await page.locator('#model-drawing [data-component="facing-rock"]').getAttribute('points'), editedFace);
    await screenshot(page, 's6006-model-edited-desktop.png', false);

    const bad = path.join(fixtures, 's6006-invalid-case.json');
    await writeFile(bad, JSON.stringify({ ...saved, inputs: { ...saved.inputs, rockThickness: -1 } }));
    await chooseFile(page, '#load-case', bad);
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent.includes('เปิดไฟล์ไม่ได้'));
    assert.equal(await page.locator('#geometry-form [name="rockThickness"]').inputValue(), '0.5');

    await panel(page, 'quantities');
    assert.equal(await page.locator('#quantity-summary').innerText(), originalSummary, 'Editing the ideal model cannot change source takeoff');
    assert.match(await page.locator('#source-coverage').innerText(), /1,000 ม\./);
    await panel(page, 'basis');
    assert.equal(await page.locator('#reported-fs').innerText(), originalFS, 'Reported solver FS is never recomputed from an ideal-section edit');
    await panel(page, 'overview');
    assert.match(await page.locator('#case-scene').innerText(), /100 ม\./, '3D segment stays 100m when quantity length is 500m');
    assertNoErrors(diagnostics);
  });

  await check('S6006 exports source audit CSV and editable-case section SVG with explicit provenance', async () => {
    await panel(page, 'quantities');
    const file = await download(page, '#export-quantity', 's6006-quantity-audit.csv');
    const csv = parseCSV(await readFile(file, 'utf8'));
    assert.equal(csv.length, 1 + 41 * 13);
    const headings = csv[0];
    const rows = csv.slice(1).map(r => Object.fromEntries(headings.map((h, i) => [h, r[i]])));
    assert.ok(rows.every(r => r.source_scope_m === '1000'));
    const sourceGap = rows.find(r => r.source_product_cell === 'T25');
    assert.equal(sourceGap.source_cached_product, '');
    assert.equal(sourceGap.computed_product, '949.9875');
    const inputGap = rows.find(r => r.input_cell === 'AI128');
    assert.equal(inputGap.input_value, ''); assert.equal(inputGap.computed_product, '');
    assert.match(inputGap.input_status, /ตั้งต้นว่าง/);
    await panel(page, 'overview');
    const svgPath = await download(page, '#export-section', 's6006-edited-section.svg');
    const svg = await readFile(svgPath, 'utf8');
    assert.match(svg, /S6006/); assert.match(svg, /SD.?02/); assert.match(svg, /ระดับสมมุติ/);
    assert.match(svg, /ระยะราบ 26\.00/); assert.doesNotMatch(svg, /<script|javascript:|NaN|Infinity/i);
    const parsed = await page.evaluate(text => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      return { errors: doc.querySelectorAll('parsererror').length, scaleX: doc.documentElement.dataset.scaleX, scaleY: doc.documentElement.dataset.scaleY };
    }, svg);
    assert.equal(parsed.errors, 0); assert.equal(parsed.scaleX, parsed.scaleY);
    assertNoErrors(diagnostics);
  });

  await check('S6006 computes beam capacity and soil cases while preserving unknown actual demand and Su', async () => {
    await panel(page, 'engineering');
    const baselinePath = await download(page, '#save-engineering', 's6006-engineering-baseline.json');
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    assert.equal(baseline.schema, 'riverbank.s6006.engineering');
    assert.equal(baseline.beamInputs.externalMuKnM, null);
    assert.equal(baseline.beamInputs.externalVuKn, null);
    assert.equal(baseline.beamResults.checks.find(c => c.id === 'external-moment')?.status, 'pending');
    assert.equal(baseline.beamResults.checks.find(c => c.id === 'external-shear')?.status, 'pending');
    assert.ok(baseline.beamResults.phiMnKnM > 0);
    assert.ok(baseline.beamResults.phiVnKn > 0);
    assert.equal(await page.locator('#soil-results tbody tr').count(), 2);
    assert.equal(baseline.soilResults.cases.length, 2);
    assert.ok(baseline.soilResults.cases[0].factorOfSafety > baseline.soilResults.cases[1].factorOfSafety, 'Parallel saturated seepage lowers this illustrative frictional-soil FS');
    assert.match(await page.locator('#beam-output').innerText(), /แรงออกแบบจริง.*ขาด/);

    await changeValue(page, '#beam-form [name="coverMm"]', 50);
    await changeValue(page, '#beam-form [name="externalMuKnM"]', 100);
    const editedPath = await download(page, '#save-engineering', 's6006-engineering-overload.json');
    const edited = JSON.parse(await readFile(editedPath, 'utf8'));
    assert.equal(edited.beamInputs.coverMm, 50);
    assert.ok(edited.beamResults.phiMnKnM < baseline.beamResults.phiMnKnM, 'Greater cover reduces effective depth and this fixed-steel flexural capacity');
    assert.equal(edited.beamInputs.externalMuKnM, 100);
    assert.ok(edited.beamResults.phiMnKnM < edited.beamInputs.externalMuKnM);
    assert.equal(edited.beamResults.checks.find(c => c.id === 'external-moment')?.status, 'review', 'External design moment exceeds computed capacity and is flagged');
    assert.match(await page.locator('#beam-output').innerText(), /ต้องทบทวน/);
    await page.locator('#reset-beam').click();
    assert.equal(await page.locator('#beam-form [name="coverMm"]').inputValue(), '40');
    assert.equal(await page.locator('#beam-form [name="externalMuKnM"]').inputValue(), '');

    await page.locator('#soil-form [name="mode"]').selectOption('undrained');
    assert.equal(await page.locator('#soil-results').count(), 0, 'No stale effective-stress result remains after selecting an incomplete Su case');
    assert.match(await page.locator('#soil-output').innerText(), /ยังคำนวณไม่ได้/);
    assert.match(await page.locator('#engineering-notice').innerText(), /กรุณากรอก Su/);
    const missingPath = await download(page, '#save-engineering', 's6006-engineering-missing-su.json');
    const missing = JSON.parse(await readFile(missingPath, 'utf8'));
    assert.equal(missing.soilInputs.undrainedStrengthKpa, null);
    assert.equal(missing.soilResults, null, 'Missing Su is exported as missing, never zero strength');
    await changeValue(page, '#soil-form [name="undrainedStrengthKpa"]', 30);
    assert.equal(await page.locator('#soil-results tbody tr').count(), 1);
    const suPath = await download(page, '#save-engineering', 's6006-engineering-su30.json');
    const su = JSON.parse(await readFile(suPath, 'utf8'));
    assert.equal(su.soilInputs.mode, 'undrained'); assert.equal(su.soilInputs.undrainedStrengthKpa, 30);
    assert.equal(su.soilResults.cases.length, 1);
    assert.ok(Number.isFinite(su.soilResults.cases[0].factorOfSafety) && su.soilResults.cases[0].factorOfSafety > 0);
    await page.locator('#reset-soil').click();
    assert.equal(await page.locator('#soil-form [name="mode"]').inputValue(), 'effective');
    assert.equal(await page.locator('#soil-results tbody tr').count(), 2);
    await panel(page, 'quantities');
    assert.equal(await page.locator('#quantity-summary').innerText(), originalSummary);
    await panel(page, 'basis');
    assert.equal(await page.locator('#reported-fs').innerText(), originalFS, 'A new shallow-slope example never overwrites the source global-stability result');
    assertNoErrors(diagnostics);
  });

  await check('S6006 withholds moment acceptance until detailing gates pass and rejects impossible or numerically invalid scenarios', async () => {
    await panel(page, 'engineering');
    await page.locator('#reset-beam').click();
    await page.locator('#reset-soil').click();
    await changeValue(page, '#beam-form [name="externalMuKnM"]', 30);
    const gatedPath = await download(page, '#save-engineering', 's6006-engineering-gated-moment.json');
    const gated = JSON.parse(await readFile(gatedPath, 'utf8'));
    assert.equal(gated.calculationRevision, 'S6006-R2');
    assert.ok(gated.beamResults.phiMnKnM > 30, 'Intermediate strength alone would exceed the entered demand');
    assert.equal(gated.beamResults.usablePhiMnKnM, null, 'Minimum steel remains an unresolved gate');
    assert.equal(gated.beamResults.externalDemand.momentUtilization, null);
    assert.equal(gated.beamResults.checks.find(c => c.id === 'external-moment').status, 'review');
    assert.match(await page.locator('[data-metric="usable-moment"]').innerText(), /ยังใช้ตรวจไม่ได้/);

    await changeValue(page, '#beam-form [name="tensionBarDiameterMm"]', 16);
    await changeValue(page, '#beam-form [name="stirrupDiameterMm"]', 8);
    const detailedPath = await download(page, '#save-engineering', 's6006-engineering-detailed-section.json');
    const detailed = JSON.parse(await readFile(detailedPath, 'utf8'));
    assert.ok(detailed.beamResults.usablePhiMnKnM > 30);
    assert.equal(detailed.beamResults.checks.find(c => c.id === 'external-moment').status, 'satisfied');
    assert.equal(detailed.beamResults.projectApproved, false, 'A component check never approves the project');

    await page.locator('#reset-beam').click();
    await changeValue(page, '#beam-form [name="heightMm"]', 150);
    await changeValue(page, '#beam-form [name="coverMm"]', 65);
    assert.equal(await page.locator('#beam-form [name="coverMm"]').inputValue(), '40', 'Impossible two-face reinforcement fit is rejected');
    assert.match(await page.locator('#engineering-notice').innerText(), /ค่าคานไม่ถูกต้อง/);
    await page.locator('#reset-beam').click();
    await changeValue(page, '#soil-form [name="effectiveCohesionKpa"]', 1);
    await changeValue(page, '#soil-form [name="verticalDepthM"]', '1e-310');
    assert.equal(await page.locator('#soil-form [name="verticalDepthM"]').inputValue(), '2', 'An unstable numerical divisor cannot produce an infinite FS');
    assert.match(await page.locator('#engineering-notice').innerText(), /ค่าดินไม่ถูกต้อง/);
    await page.locator('#reset-soil').click();
    assertNoErrors(diagnostics);
  });

  await check('S6006 knowledge and engineering panels remain reviewable without fabricated project approval', async () => {
    await panel(page, 'knowledge');
    assert.equal(await page.locator('.knowledge-grid .card').count(), 6);
    assert.match(await page.locator('#knowledge-content').innerText(), /PBI|AYA/);
    await panel(page, 'engineering');
    assert.ok((await page.locator('#engineering-content').innerText()).trim().length > 100);
    await assertNoOverflow(page, 'S6006 engineering desktop');
    await screenshot(page, 's6006-engineering-desktop.png', false);
    assertNoErrors(diagnostics);
  });

  const reportPage = await newPage('S6006 calculation report', { width: 1100, height: 1050 });
  await check('S6006 calculation book prints to A4 with Thai source provenance and clear page boundaries', async () => {
    const p = reportPage.page;
    await p.goto(`${baseURL}/projects/s6006/report.html`);
    await p.waitForFunction(() => document.querySelector('#report-ready')?.dataset.ready === 'true');
    const body = await p.locator('#report-ready').innerText();
    for (const marker of ['บ้านแดนเมือง', 'รายการคำนวณ', '949.9875', 'T25', '3.378', '2.588', '2.164']) assert.ok(body.includes(marker), `Report contains ${marker}`);
    assert.ok(await p.locator('.report-page').count() >= 10);
    await assertNoOverflow(p, 'S6006 report desktop');
    await screenshot(p, 's6006-report-desktop.png', false);
    await p.emulateMedia({ media: 'print' });
    // A4 minus 15mm left/right margins is about 680.3 CSS px. Inspect at the
    // actual print content width rather than the desktop preview width.
    await p.setViewportSize({ width: 680, height: 1100 });
    await p.evaluate(() => document.fonts.ready);
    const metrics = await p.locator('.report-page').evaluateAll(pages => pages.map((page, index) => {
      const footer = page.querySelector('.running-foot').getBoundingClientRect();
      const children = [...page.children].filter(el => !el.classList.contains('running-foot'));
      const bottom = Math.max(...children.map(el => el.getBoundingClientRect().bottom));
      return { page: index + 1, title: page.querySelector('.running-foot')?.textContent, availableBottom: footer.top, contentBottom: bottom, fits: bottom <= footer.top - 2 };
    }));
    await writeFile(path.join(output, 's6006-report-page-metrics.json'), JSON.stringify(metrics, null, 2));
    assert.deepEqual(metrics.filter(m => !m.fits), [], 'Report content must stay above each printed footer');
    const pdfPath = path.join(output, 'S6006-engineering-calculations.pdf');
    await p.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true });
    const pdf = await readFile(pdfPath);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.length > 50000);
    const extracted = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    await writeFile(path.join(output, 'S6006-engineering-calculations.txt'), extracted);
    assert.ok((extracted.match(/[ก-๙]/g) || []).length > 500, 'Generated PDF embeds readable Thai text');
    assert.ok(extracted.replace(/\s+/g, '').includes('บ้านแดนเมือง'), 'Project title survives PDF text extraction');
    for (const marker of ['S6006', '949.9875', 'T25']) assert.ok(extracted.includes(marker), `PDF retains ${marker}`);
    assertNoErrors(reportPage.diagnostics);
  });

  const mobile = await newPage('S6006 mobile', { width: 390, height: 844 }, true);
  await check('S6006 workflow and calculation book remain usable on a 390px mobile viewport', async () => {
    const p = mobile.page;
    await p.goto(`${baseURL}/projects/s6006/`); await waitReady(p);
    await assertNoOverflow(p, 'S6006 overview mobile');
    await screenshot(p, 's6006-overview-mobile.png');
    for (const name of ['model', 'quantities', 'engineering', 'basis', 'knowledge']) {
      await panel(p, name); await assertNoOverflow(p, `S6006 ${name} mobile`);
      if (name === 'model' || name === 'engineering') {
        const bounds = await p.locator(`#panel-${name} form input, #panel-${name} form select`).evaluateAll(elements =>
          elements.map(el => {
            const r = el.getBoundingClientRect(), card = el.closest('.card').getBoundingClientRect();
            return { name: el.name, left: r.left, right: r.right, width: r.width, cardLeft: card.left, cardRight: card.right, viewport: window.innerWidth };
          }));
        assert.ok(bounds.length > 0);
        for (const b of bounds) {
          assert.ok(b.left >= Math.max(0, b.cardLeft) - 1 && b.right <= Math.min(b.viewport, b.cardRight) + 1,
            `${name} input ${b.name} must not be clipped by its card or the mobile viewport: ${JSON.stringify(b)}`);
          assert.ok(b.width >= 80, `${name} input ${b.name} stays usable`);
        }
      }
      if (name === 'engineering') {
        await p.locator('#beam-form').evaluate(el => el.scrollIntoView({ block: 'start' }));
        await screenshot(p, 's6006-engineering-mobile.png', false);
      }
    }
    await panel(p, 'model');
    await changeValue(p, '#geometry-form [name="rockThickness"]', .6);
    assert.match(await p.locator('#geometry-status').innerText(), /ปรับมิติแล้ว/);
    await screenshot(p, 's6006-model-mobile.png', false);
    await p.goto(`${baseURL}/projects/s6006/report.html`);
    await p.waitForFunction(() => document.querySelector('#report-ready')?.dataset.ready === 'true');
    await assertNoOverflow(p, 'S6006 report mobile');
    await screenshot(p, 's6006-report-mobile.png', false);
    assertNoErrors(mobile.diagnostics);
  });
  await desktop.context.close(); await reportPage.context.close(); await mobile.context.close();
}

function parseCSV(text) {
  const rows = [], row = []; let value = '', quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { if (quoted && s[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if ((c === '\r' || c === '\n') && !quoted) { if (c === '\r' && s[i + 1] === '\n') i++; row.push(value); rows.push([...row]); row.length = 0; value = ''; }
    else value += c;
  }
  if (value || row.length) { row.push(value); rows.push([...row]); }
  return rows;
}
