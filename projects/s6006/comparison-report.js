import { buildComparison, COMPARISON_GROUPS } from './comparison.js';
import { loadComparisonProject } from './comparison-storage.js';
import { METHOD_SOURCES, sourceURL } from './case-data.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const stationLabel = value => Math.floor(value / 1000) + '+' + String(value % 1000).padStart(3, '0');
const availabilityLabel = value => ({
  computed: 'คำนวณได้', gated: 'ยังใช้ตรวจไม่ได้', missing: 'ข้อมูลไม่ครบ', 'not-applicable': 'ไม่ใช้กรณีนี้',
}[value] || value);
const statusLabel = value => ({
  satisfied: 'เป็นไปตามเงื่อนไขนี้', 'not-satisfied': 'ต้องทบทวน', review: 'ต้องทบทวน',
  pending: 'ยังสรุปไม่ได้', 'requires-review': 'ต้องทบทวน', illustrative: 'กลไก/ตัวอย่างสมมติ',
  'not-required': 'ไม่จำเป็นในกรณีนี้', 'not-evaluated': 'ค่าที่บันทึก',
}[value] || value);

export const COMPARISON_RESULT_ROWS_PER_PAGE = 8;
export const COMPARISON_INPUT_ROWS_PER_PAGE = 12;
export const COMPARISON_TEXT_CHARACTERS_PER_PAGE = 800;
export const COMPARISON_TEXT_LINE_BREAKS_PER_PAGE = 14;

function numberText(value, exact = false) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) throw new RangeError('รายงานเปรียบเทียบต้องไม่มี NaN หรือ Infinity');
  if (exact) return String(value);
  if (value !== 0 && (Math.abs(value) < 0.00001 || Math.abs(value) >= 1e9)) return value.toExponential(6);
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function signedNumber(value) {
  return (value > 0 ? '+' : '') + numberText(value);
}

export function formatComparisonTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('เวลาบันทึกข้อมูลเปรียบเทียบไม่ถูกต้อง');
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(value)) + ' (Asia/Bangkok, UTC+07:00)';
}

/** Exact text preservation with both character and explicit-line bounds for print. */
export function splitComparisonText(value) {
  if (typeof value !== 'string') throw new TypeError('ข้อความประกอบต้องเป็น string');
  const chunks = [];
  let chunk = '', characters = 0, lineBreaks = 0;
  for (const character of value) {
    const isBreak = /[\r\n]/.test(character);
    if (characters >= COMPARISON_TEXT_CHARACTERS_PER_PAGE
      || (isBreak && lineBreaks >= COMPARISON_TEXT_LINE_BREAKS_PER_PAGE)) {
      chunks.push(chunk); chunk = ''; characters = 0; lineBreaks = 0;
    }
    chunk += character; characters++;
    if (isBreak) lineBreaks++;
  }
  if (chunk || !chunks.length) chunks.push(chunk);
  return chunks;
}

function chunksOf(items, maximum) {
  const chunks = [];
  for (let index = 0; index < items.length; index += maximum) chunks.push(items.slice(index, index + maximum));
  return chunks;
}

function reasonPages(items) {
  const pages = [];
  let page = [], lines = 0;
  for (const item of items) {
    const cost = Math.ceil(Array.from(item.value).length / 75) + (item.value.match(/[\r\n]/g) || []).length + 3;
    if (page.length && (page.length >= 7 || lines + cost > 32)) {
      pages.push(page); page = []; lines = 0;
    }
    page.push(item); lines += cost;
  }
  if (page.length) pages.push(page);
  return pages;
}

function simpleTable(headers, rows, className = '') {
  return '<table class="' + className + '"><thead><tr>'
    + headers.map(header => '<th>' + header + '</th>').join('') + '</tr></thead><tbody>'
    + rows.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('')
    + '</tbody></table>';
}

function missingContext(entry) {
  const { context, soilInputs, beamInputs } = entry.scenario;
  const missing = [];
  if (!context.boreholeReference.trim()) missing.push('หลุมเจาะ/ที่มาค่าดิน');
  if (!context.waterReference.trim()) missing.push('ที่มาและ datum ของน้ำ');
  const missingWaterLevels = ['waterHighLevel', 'waterLowLevel', 'groundwaterLevel'].filter(key => context[key] === null).length;
  if (missingWaterLevels) missing.push(missingWaterLevels === 3 ? 'ระดับน้ำ' : 'ระดับน้ำบางรายการ');
  if (beamInputs.externalMuKnM === null) missing.push('Mu');
  if (beamInputs.externalVuKn === null) missing.push('Vu');
  if (soilInputs.mode === 'undrained' && soilInputs.undrainedStrengthKpa === null) missing.push('Su');
  return missing.length ? missing.join(' · ') : 'มีค่าบันทึกในช่องข้างต้น; ยังต้องยืนยันแหล่งข้อมูลและขอบเขตจริง';
}

/** Build only from the accepted snapshot; no access to the live working project. */
export function buildComparisonReportPages({ project, source, createdAt, snapshotToken }) {
  if (typeof snapshotToken !== 'string' || snapshotToken !== snapshotToken.trim() || !/^[a-zA-Z0-9-]{8,80}$/.test(snapshotToken)
    || typeof createdAt !== 'string' || createdAt.length !== 24
    || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) {
    throw new Error('ข้อมูลระบุตัวตนของ snapshot รายงานเปรียบเทียบไม่ครบหรือไม่ถูกต้อง');
  }
  const comparison = buildComparison(project, source);
  const { entries, rows, changedInputs } = comparison;
  const reference = entries.find(entry => entry.id === comparison.metadata.referenceId) || null;
  if (!reference || reference.kind !== 'saved') throw new Error('ต้องบันทึกอย่างน้อยหนึ่งทางเลือกและมีฐานเทียบก่อนสร้างรายงานเปรียบเทียบ');
  const aliases = new Map(entries.map((entry, index) => [entry.id, entry.kind === 'current' ? 'ปัจจุบัน' : String.fromCharCode(65 + index)]));
  const selected = comparison.metadata.station;
  const metadata = {
    ...comparison.metadata, selectedStationId: selected.id, stationLabel: stationLabel(selected.station),
    mode: 'comparison-snapshot', snapshotToken, createdAt, createdAtDisplay: formatComparisonTimestamp(createdAt),
    referenceRevision: reference?.revision ?? null, referenceLabel: reference ? aliases.get(reference.id) : null,
    entryCount: entries.length,
    entries: entries.map(entry => ({ id: entry.id, name: entry.name, kind: entry.kind, revision: entry.revision,
      createdAt: entry.createdAt, label: aliases.get(entry.id) })),
  };
  const pages = [];
  const add = (title, body, kind = 'context', rowCount = 0) => pages.push({ title, body, kind, rowCount });
  const reasonReferences = new Map();
  const addReason = value => {
    if (!value) return null;
    if (!reasonReferences.has(value)) reasonReferences.set(value, 'R' + (reasonReferences.size + 1));
    return reasonReferences.get(value);
  };
  for (const row of rows) {
    addReason(row.reason);
    for (const entry of entries) addReason(row.cells[entry.id].reason);
  }
  const textDetails = [];
  const textReferences = new Map();
  for (const row of rows.filter(row => row.isInput)) {
    for (const entry of entries) {
      const value = row.cells[entry.id].value;
      if (typeof value === 'string' && (Array.from(value).length > 64 || /[\r\n\t]/.test(value))) {
        const detail = { reference: 'T' + (textDetails.length + 1), row, entry, value };
        textDetails.push(detail);
        textReferences.set(row.id + '\0' + entry.id, detail.reference);
      }
    }
  }
  const changed = new Set(changedInputs.map(input => 'input.' + input.path));
  const sourceLink = (key, label) => '<a href="' + escapeHTML(sourceURL(key)) + '">' + escapeHTML(label) + '</a>';
  const partLabel = (index, count) => count > 1 ? ' · ส่วน ' + (index + 1) + ' / ' + count : '';

  add('บริบทและทะเบียนทางเลือก', '<p class="eyebrow">S6006 / IMMUTABLE COMPARISON RECORD</p>'
    + '<h1>เปรียบเทียบทางเลือก<br>STA ' + escapeHTML(metadata.stationLabel) + ' · R' + selected.reach + '</h1>'
    + '<p class="comparison-intro">ทางเลือกที่บันทึกและค่าที่กำลังแก้ถูกเก็บพร้อมกันใน snapshot นี้ การแก้ชื่อ ลบทางเลือก เปลี่ยนค่าฐาน หรือแก้โครงการภายหลังไม่เปลี่ยนรายงานฉบับนี้</p>'
    + simpleTable(['รายการ', 'ข้อมูลรายงาน'], [
      ['สถานีบริบท BOQ', '<code>' + escapeHTML(selected.id) + '</code> · ' + escapeHTML(selected.sourceSheet) + ' แถว ' + selected.sourceRow + ' · Lᵢ = ' + escapeHTML(numberText(selected.effectiveLength)) + ' m'],
      ['Project revision / รุ่นสูตร', '<code>' + escapeHTML(metadata.projectRevision) + '</code> · ' + escapeHTML(metadata.calculationRevision)],
      ['Snapshot', '<code>' + escapeHTML(snapshotToken) + '</code>'],
      ['เวลาเก็บรายงาน', escapeHTML(metadata.createdAtDisplay)],
      ['ค่าฐานสำหรับผลต่าง', reference ? escapeHTML(aliases.get(reference.id)) + ' · <code>' + escapeHTML(reference.id) + '</code>' : 'ยังไม่มีทางเลือกอ้างอิง; ไม่แสดงผลต่าง'],
    ], 'comparison-identity')
    + '<h3>ทะเบียนคอลัมน์ในรายงาน</h3>'
    + simpleTable(['คอลัมน์', 'ชื่อที่บันทึก', 'ID / Scenario revision', 'เวลาบันทึก'], entries.map(entry => [
      '<b>' + escapeHTML(aliases.get(entry.id)) + '</b>' + (entry.id === metadata.referenceId ? '<span class="comparison-reference">ฐานเทียบ</span>' : ''),
      '<span class="entry-name">' + escapeHTML(entry.name) + '</span><small>' + (entry.kind === 'saved' ? 'ทางเลือกที่บันทึก' : 'ค่าปัจจุบัน ณ เวลา snapshot') + '</small>',
      '<code>' + escapeHTML(entry.id) + '</code><br><code>' + escapeHTML(entry.revision) + '</code>',
      escapeHTML(formatComparisonTimestamp(entry.createdAt ?? createdAt).replace(' (Asia/Bangkok, UTC+07:00)', '')) + '<small>Asia/Bangkok</small>',
    ]), 'entry-register')
    + '<div class="comparison-scope">คอลัมน์เรียงตามลำดับที่บันทึก แล้วตามด้วยค่าปัจจุบัน แถบ “ฐานเทียบ” ระบุเพียงต้นทางของผลต่าง ไม่มีคะแนนรวม อันดับ หรือการรับรองทางเลือก รูปตัดยังเป็นรูปทรงทฤษฎี; การเลือกสถานีไม่ได้สร้างหน้าตัดสำรวจหรือจับคู่หลุมเจาะให้อัตโนมัติ</div>'
    + '<p class="minor">พบข้อมูลตั้งต้นที่ต่างกันระหว่างคอลัมน์ ' + changedInputs.length + ' รายการ ตารางข้อมูลตั้งต้นแสดงครบทุกค่าและทำเครื่องหมายรายการที่ต่างกัน ข้อความยาวมีภาคผนวกครบถ้วน</p>');

  const noticeChunks = chunksOf(comparison.notices, 5);
  noticeChunks.forEach((notices, index) => {
    add('วิธีอ่านและข้อมูลที่ขาด' + partLabel(index, noticeChunks.length),
      '<p class="eyebrow">COMPARISON SCOPE / NO AUTOMATIC RANKING</p><h2>วิธีอ่านผลต่างและข้อจำกัด' + partLabel(index, noticeChunks.length) + '</h2>'
      + '<ul>' + notices.map(notice => '<li>' + escapeHTML(notice) + '</li>').join('') + '</ul>'
      + (index === 0 ? simpleTable(['คอลัมน์', 'ช่องที่ยังไม่มีข้อมูล / บริบทที่ต้องยืนยัน'], entries.map(entry => [escapeHTML(aliases.get(entry.id)), escapeHTML(missingContext(entry))])) : '')
      + '<div class="comparison-scope">Δ = คอลัมน์นั้น − ฐานเทียบ; ร้อยละ = Δ / |ฐานเทียบ| × 100 แสดงเฉพาะค่าที่คำนวณได้และเป็นกรณีเดียวกัน ฐานเป็นศูนย์จะไม่มีร้อยละ ผลต่างบวกหรือลบไม่ใช่คำตัดสินว่าดีกว่าหรือปลอดภัยกว่า</div>'
      + '<p class="minor">— ต้องอ่านพร้อมสถานะ: ข้อมูลขาด, กำลังถูกระงับ, หรือกรณีที่ไม่ใช้ในโหมดนั้น มีเหตุผล R… ให้ตรวจต่อท้ายรายงาน ศูนย์ที่เป็นตัวเลขยังคงเป็นศูนย์จริงของค่าที่บันทึกหรือผลคำนวณ</p>');
  });

  function gridCell(row, entry) {
    const cell = row.cells[entry.id];
    const textReference = textReferences.get(row.id + '\0' + entry.id);
    let displayed = numberText(cell.value, row.isInput);
    if (textReference) {
      const compact = String(cell.value).replace(/\s+/g, ' ').trim();
      displayed = Array.from(compact).slice(0, 44).join('') + (compact ? '…' : 'ข้อความประกอบ');
    } else if (typeof cell.value === 'string' && cell.value !== '' && !cell.value.trim()) displayed = 'ช่องว่างที่บันทึก';
    let state = row.isInput && cell.availability === 'computed' ? 'ค่าที่บันทึก' : availabilityLabel(cell.availability);
    if (!row.isInput && cell.availability === 'computed' && cell.status && cell.status !== 'illustrative') state = statusLabel(cell.status);
    let output = '<span class="metric-value">' + escapeHTML(displayed) + '</span><span class="metric-state">' + escapeHTML(state) + '</span>';
    if (!row.isInput && typeof cell.delta === 'number') {
      output += '<span class="metric-delta">Δ ' + escapeHTML(signedNumber(cell.delta))
        + (typeof cell.deltaPercent === 'number' ? '<br>(' + escapeHTML(signedNumber(cell.deltaPercent)) + '%)' : '<br>ร้อยละ: —') + '</span>';
    }
    const reason = reasonReferences.get(cell.reason);
    if (reason) output += '<span class="metric-reason">เหตุผล ' + reason + '</span>';
    if (textReference) output += '<span class="metric-reason">ข้อความครบ ' + textReference + '</span>';
    return '<td data-entry-id="' + escapeHTML(entry.id) + '" data-availability="' + escapeHTML(cell.availability)
      + '" data-status="' + escapeHTML(cell.status) + '">' + output + '</td>';
  }

  function grid(pageRows) {
    return '<div class="comparison-table-wrap"><table class="comparison-grid"><colgroup><col style="width:30%">'
      + entries.map(() => '<col style="width:' + (70 / entries.length) + '%">').join('')
      + '</colgroup><thead><tr><th>รายการ / หน่วย</th>'
      + entries.map(entry => '<th data-entry-id="' + escapeHTML(entry.id) + '"><span class="comparison-key">' + escapeHTML(aliases.get(entry.id))
        + '<small>' + (entry.kind === 'saved' ? 'ทางเลือกที่บันทึก' : 'ณ เวลา snapshot') + '</small></span>'
        + (entry.id === metadata.referenceId ? '<span class="comparison-reference">ฐานเทียบ</span>' : '') + '</th>').join('')
      + '</tr></thead><tbody>' + pageRows.map(row => '<tr data-row-id="' + escapeHTML(row.id) + '"'
        + (changed.has(row.id) ? ' class="input-changed" data-input-changed="true"' : '') + '><td class="metric-label">'
        + escapeHTML(row.label) + '<br><span class="metric-unit">' + escapeHTML(row.unit || 'ข้อความ') + '</span>'
        + (row.isInput ? '<br><code>' + escapeHTML(row.id.slice(6)) + '</code>' : '')
        + (changed.has(row.id) ? '<span class="change-label">ค่าต่างกันระหว่างคอลัมน์</span>' : '')
        + (row.reason && !row.isInput ? '<span class="metric-reason">ขอบเขต ' + reasonReferences.get(row.reason) + '</span>' : '')
        + '</td>' + entries.map(entry => gridCell(row, entry)).join('') + '</tr>').join('') + '</tbody></table></div>';
  }

  const outputSections = [];
  for (const group of COMPARISON_GROUPS) {
    if (group.id.startsWith('inputs-')) continue;
    const groupRows = rows.filter(row => row.group === group.id);
    if (group.id === 'materials') {
      outputSections.push({ id: 'materials-per-length', title: 'ปริมาณทฤษฎีต่อความยาว 1 m', rows: groupRows.filter(row => row.unit.endsWith('/m')) });
      outputSections.push({ id: 'materials-total', title: 'ปริมาณทฤษฎีตามความยาวที่ระบุ', rows: groupRows.filter(row => !row.unit.endsWith('/m')) });
    } else if (group.id === 'beam') {
      const isDemand = row => /^beam\.(MuKnM|VuKn|momentUtilization|shearUtilization)$/.test(row.id);
      outputSections.push({ id: 'beam-capacity', title: 'คาน: พื้นที่เหล็กและกำลังที่ใช้ตรวจได้', rows: groupRows.filter(row => !isDemand(row)) });
      outputSections.push({ id: 'beam-demand', title: 'คาน: แรงออกแบบและอัตราใช้กำลัง', rows: groupRows.filter(isDemand) });
    } else outputSections.push({ id: group.id, title: group.label, rows: groupRows });
  }
  const lengthSummary = entries.map(entry => escapeHTML(aliases.get(entry.id)) + ': L = ' + escapeHTML(numberText(entry.scenario.geometry.length, true)) + ' m').join(' · ');
  for (const section of outputSections) {
    const groups = chunksOf(section.rows, COMPARISON_RESULT_ROWS_PER_PAGE);
    groups.forEach((pageRows, index) => {
      add(section.title + partLabel(index, groups.length), '<p class="eyebrow">RECALCULATED RESULTS / NEUTRAL DIFFERENCES</p><h2>'
        + escapeHTML(section.title) + partLabel(index, groups.length) + '</h2><p class="comparison-intro">' + lengthSummary
        + '<br>L คือความยาวปริซึมทดลองของแต่ละคอลัมน์; Lᵢ ของแถว BOQ = ' + escapeHTML(numberText(selected.effectiveLength)) + ' m เป็นอีกขอบเขตหนึ่ง</p>'
        + grid(pageRows)
        + '<div class="comparison-scope">' + (section.id === 'soil'
          ? 'แยก u=0, อิ่มตัวซึมขนานลาด และ total stress ด้วย Su เป็นคนละกรณี ไม่เปรียบผลข้ามโหมดและไม่แทน global FS ระดับน้ำที่บันทึกเป็นบริบท ไม่ได้ถูกแปลงเป็น u โดยอัตโนมัติ'
          : section.id.startsWith('beam')
            ? 'กำลังที่ใช้ได้คือค่าหลังตรวจเงื่อนไขในโมดูล ค่า — ไม่ใช่กำลังศูนย์และห้ามแทนด้วยกำลังเชิงสมการที่ถูกระงับ ยังไม่รับรองระบบจริง แรงที่ไม่ระบุไม่ถูกแทนด้วยศูนย์หรือน้ำหนักตัวเอง'
            : 'รูปทรงและปริมาณเป็นองค์ประกอบของปริซึมทฤษฎี ไม่ใช่พื้นที่จากการสำรวจ ไม่รวมเป็นปริมาณสุทธิ และไม่แก้ BOQ ต้นฉบับ ผลต่างปริมาณรวมอาจเกิดจากความยาวที่ต่างกัน')
        + '</div><p class="minor">รายละเอียดเหตุผล R… และค่าตั้งต้นครบทุกคอลัมน์อยู่ท้ายรายงาน ตัวเลขผลแสดงไม่เกิน 6 ตำแหน่งทศนิยม; คำนวณผลต่างจากค่าที่ยังไม่ปัด</p>', 'results', pageRows.length);
    });
  }

  // Printed input rows vary in height (long labels, changed-field markers and
  // text previews). Keep both a hard row cap and a conservative line budget.
  function inputPageGroups(inputRows) {
    const groups = [];
    let pageRows = [], lineUnits = 0;
    for (const row of inputRows) {
      const labelLines = Math.ceil(Array.from(row.label).length / 32) + 1
        + Math.ceil(row.id.slice(6).length / 42) + (changed.has(row.id) ? 1 : 0);
      const cellLines = Math.max(...entries.map(entry => {
        const cell = row.cells[entry.id];
        const hasDetail = textReferences.has(row.id + '\0' + entry.id);
        const length = hasDetail ? 45 : Array.from(numberText(cell.value, true)).length;
        return Math.ceil(length / 19) + 2 + (hasDetail ? 1 : 0);
      }));
      const cost = Math.max(labelLines, cellLines) + 2;
      if (pageRows.length && (pageRows.length >= COMPARISON_INPUT_ROWS_PER_PAGE || lineUnits + cost > 44)) {
        groups.push(pageRows); pageRows = []; lineUnits = 0;
      }
      pageRows.push(row); lineUnits += cost;
    }
    if (pageRows.length) groups.push(pageRows);
    return groups;
  }
  for (const group of COMPARISON_GROUPS.filter(group => group.id.startsWith('inputs-'))) {
    const groups = inputPageGroups(rows.filter(row => row.group === group.id));
    groups.forEach((pageRows, index) => add(group.label + partLabel(index, groups.length),
      '<p class="eyebrow">COMPLETE SNAPSHOT INPUTS / INPUT PROVENANCE</p><h2>' + escapeHTML(group.label) + partLabel(index, groups.length) + '</h2>'
      + '<p class="comparison-intro">ค่าที่บันทึกจริงทุกคอลัมน์ รวมค่าที่ไม่ใช้ในโหมดปัจจุบัน แถวพื้นอ่อนคือค่าที่ต่างกันระหว่างคอลัมน์ การเท่ากับค่าเริ่มต้นไม่ได้ยืนยันว่าเป็นผลสำรวจหรือผลทดสอบของสถานี · ขอบเขต ' + reasonReferences.get(pageRows[0].reason) + '</p>'
      + grid(pageRows) + '<p class="minor">ข้อมูลตั้งต้นเป็นตัวเลขที่บันทึกโดยไม่ปัดเพิ่มในตารางนี้; — ต้องอ่านพร้อมสถานะและเหตุผล ช่องข้อความยาวแสดงตัวอย่างและรหัส T… ซึ่งมีข้อความครบในภาคผนวก ระดับน้ำและข้อความอ้างอิงไม่สร้างแรงหรือผลวิเคราะห์ระบบโดยอัตโนมัติ</p>',
      'inputs', pageRows.length));
  }

  for (const detail of textDetails) {
    const chunks = splitComparisonText(detail.value);
    chunks.forEach((chunk, index) => add('ข้อความประกอบ ' + detail.reference + partLabel(index, chunks.length),
      '<p class="eyebrow">COMPLETE USER-SUPPLIED CONTEXT / ' + detail.reference + '</p><h2>' + escapeHTML(detail.row.label) + partLabel(index, chunks.length) + '</h2>'
      + '<p class="comparison-intro">คอลัมน์ ' + escapeHTML(aliases.get(detail.entry.id)) + ' · <code>' + escapeHTML(detail.entry.id) + '</code><br>'
      + '<code>' + escapeHTML(detail.row.id.slice(6)) + '</code> · Scenario <code>' + escapeHTML(detail.entry.revision) + '</code></p>'
      + '<div class="context-detail" data-text-reference="' + detail.reference + '" data-text-part="' + (index + 1) + '">' + escapeHTML(chunk) + '</div>'
      + '<div class="comparison-scope">ข้อความนี้เก็บตาม snapshot ครบถ้วน เป็นแหล่งอ้างอิงหรือสมมติฐานที่ผู้ใช้บันทึก ยังไม่ได้ยืนยันผลทดสอบ ตำแหน่งหลุมเจาะ หรือความสัมพันธ์กับผิววิบัติจากข้อความเพียงอย่างเดียว</div>', 'text'));
  }

  const reasonDetails = [...reasonReferences.entries()].flatMap(([value, reference]) => {
    const chunks = splitComparisonText(value);
    return chunks.map((chunk, index) => ({ reference: reference + partLabel(index, chunks.length), value: chunk }));
  });
  const notes = reasonPages(reasonDetails);
  notes.forEach((items, index) => add('เหตุผลและขอบเขตของตัวเลข' + partLabel(index, notes.length),
    '<p class="eyebrow">RESULT AVAILABILITY / MODEL QUALIFICATIONS</p><h2>เหตุผลและขอบเขตของตัวเลข' + partLabel(index, notes.length) + '</h2>'
    + '<p class="comparison-intro">รหัส R… ในตารางชี้มายังข้อความจากตัวคำนวณหรือกติกาการเทียบเดียวกัน เหตุผลที่ซ้ำกันใช้รหัสเดียวกันเพื่อให้อ่านรายงานได้กระชับ โดยไม่ตัดคำอธิบายกำลังที่ถูกระงับหรือข้อมูลที่ขาด</p>'
    + '<dl class="reason-list">' + items.map(item => '<dt>' + escapeHTML(item.reference) + '</dt><dd>' + escapeHTML(item.value) + '</dd>').join('') + '</dl>', 'reasons', items.length));

  add('แหล่งข้อมูลและฐานของค่าตั้งต้น', '<p class="eyebrow">SOURCE EVIDENCE / INPUT INTERPRETATION</p><h2>แหล่งข้อมูลและฐานของค่าตั้งต้น</h2>'
    + '<p class="comparison-intro">เอกสารเดิมเป็นหลักฐานของค่าต้นแบบ ทุกคอลัมน์ในรายงานนี้ใช้ค่าที่บันทึกใน snapshot ตามตารางข้อมูลตั้งต้น หากผู้ใช้แก้ค่าแล้ว ไม่ได้อ้างว่าค่าที่แก้นั้นมาจากเอกสารเดิม</p>'
    + simpleTable(['กลุ่มข้อมูล', 'หลักฐานเดิมและสิ่งที่ต้องยืนยัน'], [
      ['รูปตัดและความยาว', sourceLink('S-DWG', 'SD-02 · PDF หน้า 36 / แผ่น 35') + '<br>รูปตัดต้นแบบและชั้นวัสดุ; ความลึกตีนฐานราบและความยาวปริซึมเป็นค่าจำลอง ต้องยืนยันหน้าตัดสำรวจและขอบเขตงานจริง'],
      ['หน้าตัดและเหล็ก BF1', sourceLink('S-DWG', 'SD-05 · PDF หน้า 39 / แผ่น 38') + '<br>ต้นแบบ 250 × 500 mm, 2Ø12 บน–ล่าง, ปลอก Ø6 @200; cover เป็นค่าที่ตั้งสมมติ ส่วนกำลังที่คำนวณใช้เหล็กดึงหนึ่งหน้า ไม่เพิ่มกำลังจากเหล็กอีกหน้า'],
      ['วัสดุและแรงคาน', sourceLink('S-CALC', 'รายการคำนวณเดิม · PDF หน้า 1–3') + '<br>ฐานวัสดุจากเอกสารเดิม; ช่วงรองรับง่ายและตัวคูณน้ำหนักตัวเองเป็นตัวอย่าง Mu/Vu ต้องเป็นแรงออกแบบที่ผู้ใช้ระบุ ไม่อนุมานจากการแก้รูปทรงหรือระดับน้ำ'],
      ['ค่าดิน', sourceLink('S-CALC', 'ตารางวัสดุดิน · PDF หน้า 16') + '<br>Sand, Filled มี γ = 20 kN/m³ และ φ = 32°; การใช้ φ เป็น φ′ และ γ สำหรับ u=0 เป็นการตีความที่ต้องยืนยัน ส่วน c′=0, γsat=20 และ z=2 m เป็นสมมติฐานตั้งต้น ค่า Su ที่ไม่ทราบคงเป็นข้อมูลขาด; ค่า c ในดินเหนียวต้องยืนยันชนิดพารามิเตอร์ก่อนใช้'],
      ['สถานีและ BOQ', sourceLink('S-XLS', 'หาปริมาณวัสดุ · แถว 14–25 / 104–132') + '<br>41 แถวในขอบเขตเดิม 1,000 m; สถานีที่เลือกคือ ' + escapeHTML(selected.sourceSheet) + ' แถว ' + selected.sourceRow + ' และ Lᵢ = ' + escapeHTML(numberText(selected.effectiveLength)) + ' m ใช้เป็นบริบท ไม่แทนความยาวปริซึมและไม่เปลี่ยนค่าต้นฉบับ'],
      ['น้ำ หลุมเจาะ และหมายเหตุ', 'ข้อความและระดับที่แสดงเป็นข้อมูลผู้ใช้ตาม snapshot ไม่มีการสร้างค่าที่ขาด จับคู่หลุมเจาะกับสถานี หรือแปลงระดับน้ำเป็นแรงดันน้ำโดยอัตโนมัติ'],
    ], 'source-table')
    + '<h3>ฐานสมการที่ใช้ตรวจสอบ</h3><ol>' + METHOD_SOURCES.filter(item => /USACE|StructurePoint/.test(item.title)).map(item => '<li><a href="' + escapeHTML(item.url) + '">' + escapeHTML(item.title) + '</a><br><span class="minor">' + escapeHTML(item.location) + '</span></li>').join('') + '</ol>'
    + '<div class="comparison-scope">ผล Slope/W ในเอกสารเดิมหน้า 16–17 เป็นหลักฐานเดิม ไม่ใช่ผลของทางเลือกในรายงานนี้ การเปลี่ยนหน้าตัด ค่าดิน หรือกรณีน้ำต้องวิเคราะห์ระบบใหม่ก่อนรับรอง รายงานนี้เป็นการตรวจตัวเลขและซอฟต์แวร์ในขอบเขตที่ระบุ ไม่ใช่การรับรองโครงการ</div>', 'sources');

  return { pages, metadata };
}

export function renderComparisonReportPages({ pages, metadata }) {
  return pages.map((page, index) => '<section class="report-page comparison-page" data-page-title="' + escapeHTML(page.title)
    + '" data-page-kind="' + escapeHTML(page.kind) + '" data-row-count="' + page.rowCount + '">'
    + '<header class="running-head"><span>RIVERBANK STUDIO / ' + escapeHTML(metadata.projectCode) + ' · STA ' + escapeHTML(metadata.stationLabel)
    + '</span><span>' + escapeHTML(metadata.calculationRevision) + ' · COMPARISON SNAPSHOT</span></header>' + page.body
    + '<footer class="running-foot"><div class="foot-context"><span>Project ' + escapeHTML(metadata.projectRevision) + ' · ฐานเทียบ '
    + escapeHTML(metadata.referenceLabel ?? 'ยังไม่มี') + '</span><span>Snapshot ' + escapeHTML(metadata.snapshotToken) + '</span><span>'
    + escapeHTML(metadata.calculationRevision) + ' · ' + escapeHTML(metadata.createdAtDisplay) + '</span></div><div class="foot-page"><span>'
    + escapeHTML(page.title) + '</span><strong>' + String(index + 1).padStart(2, '0') + ' / ' + pages.length + '</strong></div></footer></section>').join('');
}

export async function mountComparisonReport({ document: doc = globalThis.document, window: view = globalThis.window } = {}) {
  const host = doc.querySelector('#comparison-report-ready');
  const printButton = doc.querySelector('#print-comparison-report');
  const errorBox = doc.querySelector('#comparison-report-error');
  const status = doc.querySelector('#comparison-report-status');
  const showError = error => {
    host.dataset.ready = 'false'; host.dataset.error = 'true'; host.setAttribute('aria-busy', 'false'); host.replaceChildren();
    doc.body.dataset.reportState = 'blocked'; printButton.disabled = true;
    status.textContent = 'ไม่สามารถจัดรายงานเปรียบเทียบจาก snapshot ที่ร้องขอ';
    errorBox.hidden = false;
    errorBox.innerHTML = '<h1>ยังพิมพ์รายงานเปรียบเทียบนี้ไม่ได้</h1><p>' + escapeHTML(error?.message || 'ไม่สามารถอ่านสำเนารายงานเปรียบเทียบได้')
      + '</p><p>ไม่มีการแทน snapshot ที่ขาดหรือเสียหายด้วยค่าปัจจุบันหรือค่าต้นแบบ กรุณากลับไปเปิดโครงการและสร้างรายงานเปรียบเทียบอีกครั้ง</p><a href="index.html">กลับไปโครงการ S6006</a>';
  };
  printButton.disabled = true; doc.body.dataset.reportState = 'loading';
  printButton.addEventListener('click', () => { if (host.dataset.ready === 'true') view.print(); });
  view.addEventListener('beforeprint', () => {
    if (host.dataset.ready !== 'true') showError(new Error('snapshot รายงานเปรียบเทียบยังไม่พร้อมหรือไม่ถูกต้อง การพิมพ์ผลคำนวณถูกระงับ'));
  });
  try {
    const response = await view.fetch('source-data.json');
    if (!response.ok) throw new Error('อ่านชุดข้อมูลอ้างอิง S6006 ไม่สำเร็จ');
    const source = await response.json();
    const resolved = loadComparisonProject({ search: view.location.search, storage: view.localStorage, source });
    const snapshotToken = new URLSearchParams(view.location.search).get('snapshot');
    const record = buildComparisonReportPages({ ...resolved, source, snapshotToken });
    host.innerHTML = renderComparisonReportPages(record);
    host.dataset.mode = record.metadata.mode;
    host.dataset.projectRevision = record.metadata.projectRevision;
    host.dataset.stationId = record.metadata.selectedStationId;
    host.dataset.referenceId = record.metadata.referenceId ?? '';
    host.dataset.referenceRevision = record.metadata.referenceRevision ?? '';
    host.dataset.snapshot = snapshotToken;
    host.dataset.entryCount = String(record.metadata.entryCount);
    if (doc.fonts?.ready) await doc.fonts.ready;
    host.dataset.ready = 'true'; host.dataset.error = 'false'; host.setAttribute('aria-busy', 'false');
    errorBox.hidden = true; doc.body.dataset.reportState = 'ready'; printButton.disabled = false;
    status.textContent = 'S6006 / เปรียบเทียบ ' + record.metadata.entryCount + ' คอลัมน์ · STA ' + record.metadata.stationLabel;
    doc.title = 'S6006 · STA ' + record.metadata.stationLabel + ' · รายงานเปรียบเทียบทางเลือก';
    return record;
  } catch (error) { showError(error); return null; }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && document.querySelector('#comparison-report-ready')) {
  mountComparisonReport();
}
