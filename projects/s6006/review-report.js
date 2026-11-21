import { REVIEW_REVISION, buildReview, selectReview } from './review.js';
import { loadReviewProject } from './review-storage.js';
import { SOURCE_FILES, sourceURL } from './case-data.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const stationLabel = value => Math.floor(value / 1000) + '+' + String(value % 1000).padStart(3, '0');
const availabilityLabel = value => ({
  computed: 'คำนวณได้', gated: 'ยังใช้ตรวจไม่ได้', missing: 'ข้อมูลไม่ครบ',
  'not-applicable': 'ไม่ใช้กรณีนี้', provided: 'ค่าที่บันทึก',
}[value] || value);
const dispositionLabel = value => ({
  attention: 'ต้องทบทวน', missing: 'ข้อมูลยังไม่ครบ', 'condition-met': 'ผ่านเงื่อนไขย่อย',
  'computed-only': 'ผลกลไกสมมติ', 'outside-scope': 'ต้องตรวจเพิ่มเติม',
  'not-applicable': 'ไม่ใช้กรณีนี้', recorded: 'มีข้อมูลอ้างอิง · รอตรวจ',
}[value] || value);
const groupLabel = value => ({ beam: 'โครงสร้างคาน', soil: 'ดินและกลไกลาด', context: 'น้ำ หลุมเจาะ และที่มา' }[value] || value);

export const REVIEW_REGISTER_ROWS_PER_PAGE = 6;
export const REVIEW_FINDING_ROWS_PER_PAGE = 6;
export const REVIEW_TEXT_CHARACTERS_PER_PAGE = 800;
export const REVIEW_TEXT_LINE_BREAKS_PER_PAGE = 14;

function numberText(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) throw new RangeError('รายงานตรวจงานต้องไม่มี NaN หรือ Infinity');
  if (value !== 0 && (Math.abs(value) < 0.00001 || Math.abs(value) >= 1e9)) return value.toExponential(6);
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export function formatReviewTimestamp(value) {
  if (typeof value !== 'string' || value.length !== 24 || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) throw new Error('เวลาสำเนารายงานตรวจงานต้องเป็น ISO UTC ที่ถูกต้อง');
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(value)) + ' (Asia/Bangkok, UTC+07:00)';
}

/** Split at code-point boundaries and bound explicit lines, preserving every character. */
export function splitReviewText(value) {
  if (typeof value !== 'string') throw new TypeError('ข้อความประกอบรายงานต้องเป็น string');
  const result = [];
  let part = '', count = 0, breaks = 0;
  for (const character of value) {
    const isBreak = /[\r\n]/.test(character);
    if (count >= REVIEW_TEXT_CHARACTERS_PER_PAGE || (isBreak && breaks >= REVIEW_TEXT_LINE_BREAKS_PER_PAGE)) {
      result.push(part); part = ''; count = 0; breaks = 0;
    }
    part += character; count++;
    if (isBreak) breaks++;
  }
  if (part || !result.length) result.push(part);
  return result;
}

function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}
function boundedTextPages(items) {
  const result = [];
  let current = [], cost = 0;
  for (const item of items) {
    const lines = Math.ceil(Array.from(item.value).length / 90) + (item.value.match(/[\r\n]/g) || []).length + 3;
    if (current.length && (current.length >= 5 || cost + lines > 36)) {
      result.push(current); current = []; cost = 0;
    }
    current.push(item); cost += lines;
  }
  if (current.length) result.push(current);
  return result;
}
function table(headers, rows, className = '') {
  return '<div class="review-table-wrap"><table class="' + className + '"><thead><tr>'
    + headers.map(header => '<th>' + header + '</th>').join('') + '</tr></thead><tbody>'
    + rows.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('')
    + '</tbody></table></div>';
}
function scopeText(selection, record) {
  const station = selection.stationId === 'all' ? 'ทุกสถานีในทะเบียน BOQ'
    : (() => { const selected = record.stations.find(item => item.id === selection.stationId); return 'ช่วง ' + selected.reach + ' / STA ' + stationLabel(selected.station); })();
  const kind = { all: 'ค่าปัจจุบันและทางเลือกที่เก็บ', current: 'เฉพาะค่าปัจจุบัน', saved: 'เฉพาะทางเลือกที่เก็บ' }[selection.kind];
  const focus = { all: 'ทุกชุดในขอบเขต', attention: 'ชุดที่มีประเด็นต้องทบทวน', missing: 'ชุดที่มีข้อมูลขาด', baseline: 'ชุดที่ตรงกับค่าต้นแบบทั้งหมด' }[selection.focus];
  return { station, kind, focus };
}
function actionText(target) {
  if (!target) return 'ดูฐานสมการและขอบเขตที่เกี่ยวข้อง';
  const destination = target.panel === 'context' ? 'เปิดบริบทน้ำ หลุมเจาะ และที่มาของสถานี'
    : target.section === 'beam' ? 'เปิด 04 โครงสร้างและดิน / คาน'
      : target.section === 'soil' ? 'เปิด 04 โครงสร้างและดิน / ดิน'
        : target.panel === 'model' ? 'เปิด 02 ลองปรับหน้าตัด' : 'เปิด 05 ที่มาวิศวกรรม';
  return destination + (target.field ? ' · ช่อง ' + target.field : '');
}
function safeSourceLink(source) {
  return /^https?:\/\//.test(source.url || '')
    ? '<a href="' + esc(source.url) + '">' + esc(source.title) + '</a>'
    : esc(source.title);
}

/** Review findings only; the full calculation book remains a separate report. */
export function buildReviewReportPages({ project, source, selection, createdAt, snapshotToken }) {
  if (typeof snapshotToken !== 'string' || snapshotToken !== snapshotToken.trim() || !/^[a-zA-Z0-9-]{8,80}$/.test(snapshotToken)) {
    throw new Error('ข้อมูลระบุตัวตน snapshot รายงานตรวจงานไม่ถูกต้อง');
  }
  const createdAtDisplay = formatReviewTimestamp(createdAt);
  const record = buildReview(project, source), selected = selectReview(record, selection);
  if (!selected.entries.length) throw new Error('ไม่มีชุดข้อมูลในขอบเขตที่เลือกสำหรับรายงานตรวจงาน');
  const scope = scopeText(selected.selection, record);
  const metadata = {
    ...record.metadata, reviewRevision: REVIEW_REVISION, mode: 'review-snapshot',
    snapshotToken, createdAt, createdAtDisplay, selection: { ...selected.selection }, scope,
    totalEntryCount: record.entries.length, eligibleCount: selected.eligibleCount,
    entryCount: selected.includedCount, excludedCount: selected.excludedCount,
    entries: selected.entries.map(entry => ({ key: entry.key, stationId: entry.station.id, scenarioId: entry.scenarioId, scenarioRevision: entry.scenarioRevision })),
  };
  const pages = [];
  const add = (title, body, kind = 'review', rowCount = 0, group = '') => pages.push({ title, body, kind, rowCount, group });
  const groups = [], groupByContent = new Map(), entryGroup = new Map();
  for (const entry of selected.entries) {
    // Same findings alone are insufficient: group only identical complete inputs.
    const content = JSON.stringify([entry.inputs, entry.metrics, entry.findings]);
    let group = groupByContent.get(content);
    if (!group) {
      group = { id: 'G' + String(groups.length + 1).padStart(2, '0'), exemplar: entry, entries: [] };
      groups.push(group); groupByContent.set(content, group);
    }
    group.entries.push(entry); entryGroup.set(entry.key, group);
  }
  metadata.groupCount = groups.length;
  const reasonReferences = new Map(), textDetails = [];
  const reasonReference = finding => {
    const value = finding.reason + '\nขั้นต่อไป: ' + actionText(finding.actionTarget)
      + '\nข้อมูลที่เกี่ยวข้อง: ' + (finding.inputPaths?.join(', ') || 'ขอบเขตโมดูล')
      + '\nอ้างอิง: ' + (finding.sourceKeys?.join(', ') || 'ข้อมูลที่ผู้ใช้บันทึก');
    if (!reasonReferences.has(value)) reasonReferences.set(value, 'R' + (reasonReferences.size + 1));
    return reasonReferences.get(value);
  };
  const displayValue = (finding, group) => {
    if (typeof finding.value !== 'string') return '<span class="finding-value">' + esc(numberText(finding.value)) + '</span>';
    if (Array.from(finding.value).length <= 64 && !/[\r\n\t]/.test(finding.value)) return '<span class="finding-value literal-value">' + esc(finding.value) + '</span>';
    const reference = 'T' + (textDetails.length + 1);
    textDetails.push({ reference, value: finding.value, group: group.id, finding });
    return '<span class="finding-value literal-value">' + esc(Array.from(finding.value).slice(0, 42).join('')) + '…</span><small>ข้อความครบในภาคผนวก ' + reference + '</small>';
  };

  add('ขอบเขตและตัวตนรายงาน', '<p class="eyebrow">S6006 / ENGINEERING REVIEW REGISTER</p><h1>ทะเบียนตรวจงานวิศวกรรม</h1>'
    + '<p class="review-intro">บันทึกประเด็นโครงสร้าง ดิน และที่มาของข้อมูลจากค่าที่ยอมรับไว้ใน snapshot นี้ รายงานระบุค่าที่ใช้ตรวจได้ ข้อมูลที่ขาด และเงื่อนไขย่อยที่ต้องทบทวน โดยคงข้อมูลแต่ละสถานีและทางเลือกแยกกัน</p>'
    + table(['รายการ', 'ขอบเขตที่บันทึก'], [
      ['โครงการ / รุ่นข้อมูล', esc(record.metadata.projectCode) + ' · <code>' + esc(record.metadata.projectRevision) + '</code>'],
      ['รุ่นสมการ / รุ่นทะเบียน', esc(record.metadata.calculationRevision) + ' · ' + esc(REVIEW_REVISION)],
      ['Snapshot', '<code>' + esc(snapshotToken) + '</code>'],
      ['เวลาเก็บรายงาน', esc(createdAtDisplay)],
      ['สถานี', esc(scope.station)], ['ชนิดชุดข้อมูล', esc(scope.kind)], ['ตัวกรองชุดข้อมูล', esc(scope.focus)],
      ['จำนวนชุดก่อนตัวกรอง', String(selected.eligibleCount)],
      ['จำนวนชุดในรายงาน / ไม่นำเข้าตามตัวกรอง', selected.includedCount + ' / ' + selected.excludedCount],
      ['จำนวนชุดทั้งหมดในโครงการ', String(record.entries.length)],
    ], 'review-identity')
    + '<div class="review-scope"><strong>รายงานรวมทุกประเด็นของชุดที่เลือกเข้ามา</strong><br>ตัวกรอง “ต้องทบทวน” หรือ “ข้อมูลขาด” เลือกชุดข้อมูล แต่ไม่ได้ตัดประเด็นอื่นออกจากชุดนั้น จำนวนที่ไม่นำเข้าอ้างถึงตัวกรองภายในสถานีและชนิดชุดข้อมูลที่เลือก ไม่ใช่จำนวนงานที่ตรวจผ่าน</div>'
    + '<p class="minor">ชุดข้อมูลตั้งต้นและผลตรวจที่เหมือนกันทุกค่าถูกรวมเป็นชุดตรวจ G… จำนวน ' + groups.length + ' ชุด โดยทะเบียนหน้าถัดไประบุว่าสถานีและทางเลือกใดอ้างถึงชุดใด การรวมนี้ไม่ได้สร้างการตรวจสำรวจอิสระให้แต่ละสถานี</p>', 'cover');

  add('วิธีอ่านและขอบเขตของทะเบียน', '<p class="eyebrow">READING THE REGISTER / NO OVERALL APPROVAL</p><h2>วิธีอ่านสถานะและขอบเขต</h2>'
    + table(['สถานะ', 'ความหมาย'], [
      ['ต้องทบทวน', 'เงื่อนไขย่อยไม่เป็นไปตามกติกาที่โมดูลตรวจ หรือ FS < 1 สำหรับกลไกลาดอนันต์สมมติที่ระบุ'],
      ['ข้อมูลยังไม่ครบ', 'ช่องข้อมูลที่เกี่ยวข้องยังไม่มีค่า ไม่ใช้ศูนย์แทนข้อมูลที่ขาด'],
      ['ยังใช้ตรวจไม่ได้', 'กำลังหรือผลถูกระงับด้วยเงื่อนไข ไม่ใช่ค่ากำลังศูนย์'],
      ['ผ่านเงื่อนไขย่อย', 'ผ่านเฉพาะเงื่อนไขที่แสดงภายใต้ค่าตั้งต้นและสมการนี้ ยังต้องอ่านข้อจำกัดและประเด็นอื่น'],
      ['ผลกลไกสมมติ', 'มีผลคำนวณในแบบจำลองย่อย ค่า FS ตั้งแต่ 1 ขึ้นไปยังไม่ได้เทียบเกณฑ์ยอมรับของโครงการ'],
      ['มีข้อมูลอ้างอิง · รอตรวจ', 'มีข้อความที่ผู้ใช้บันทึก ยังไม่ได้ยืนยันเอกสาร หลุมเจาะ datum หรือการจับคู่กับสถานี'],
      ['ไม่ใช้กรณีนี้ / ต้องตรวจเพิ่มเติม', 'พารามิเตอร์หรือกลไกไม่ใช้ในโหมดนั้น หรืออยู่นอกขอบเขตที่โมดูลคำนวณ'],
    ], 'review-legend')
    + '<h3>วิธีใช้ทะเบียนกลับไปทำงาน</h3><ol><li>หาสถานีและชื่อชุดข้อมูลจากทะเบียน แล้วเปิดชุดตรวจ G… ที่ระบุ</li><li>อ่านค่า หน่วย สถานะ และเหตุผล R… ของแต่ละประเด็น โดยใช้รหัสช่องข้อมูลเพื่อกลับไปแก้ให้ถูกจุด</li><li>ค่าปัจจุบันแก้ได้ที่สถานีนั้น ส่วนทางเลือกที่เก็บต้องไปหน้า 07 เทียบทางเลือก และเลือก “นำมาแก้ต่อ” โดยเจตนา</li><li>หากต้องการสมการและการแทนค่าครบ ให้เปิด “รายงานค่าปัจจุบัน” ของชุดที่เลือก รายงานฉบับนี้เป็นทะเบียนตรวจงาน</li></ol>'
    + '<div class="review-scope">ค่าต้นแบบเดิมตรงกับข้อมูลตั้งต้นทั้งหมด ส่วน “มีข้อมูลเปลี่ยนจากต้นแบบ” ระบุเพียงความต่างของค่า การเพิ่มหมายเหตุอย่างเดียวก็เป็นความต่างได้ ทั้งสองสถานะไม่ได้ยืนยันหน้าตัดสำรวจหรือการออกแบบของแต่ละสถานี</div>', 'legend');

  chunks(selected.entries, REVIEW_REGISTER_ROWS_PER_PAGE).forEach((entries, index, parts) => {
    add('ทะเบียนชุดข้อมูล ' + (index + 1) + '/' + parts.length,
      '<p class="eyebrow">STATION / SCENARIO / EXACT INPUT IDENTITY</p><h2>ทะเบียนชุดข้อมูล ' + (index + 1) + ' / ' + parts.length + '</h2>'
      + '<p class="review-intro">G… เชื่อมกับชุดผลตรวจที่มีข้อมูลตั้งต้นเหมือนกันครบทุกค่า ชื่อสถานีมาจาก BOQ และยังเป็นบริบทของรูปตัดทฤษฎี</p>'
      + '<div class="review-table-wrap"><table class="review-register"><thead><tr><th>สถานีและต้นทาง</th><th>ชุดข้อมูล</th><th>ตัวตนและสภาพข้อมูล</th><th>ชุดตรวจ</th></tr></thead><tbody>'
      + entries.map(entry => '<tr data-review-entry-key="' + esc(entry.key) + '" data-review-group="' + entryGroup.get(entry.key).id + '"><td><b>R' + entry.station.reach + ' · STA ' + esc(stationLabel(entry.station.station)) + '</b><small>'
        + esc(entry.station.sourceSheet) + ' แถว ' + entry.station.sourceRow + '<br>Lᵢ = ' + esc(numberText(entry.station.effectiveLength)) + ' m<br><code>' + esc(entry.station.id) + '</code></small></td><td><span class="review-entry-name">'
        + esc(entry.scenarioName) + '</span><small>' + (entry.kind === 'current' ? 'ค่าปัจจุบัน ณ เวลา snapshot' : 'ทางเลือกที่เก็บ')
        + (entry.isReference ? ' · ฐานเปรียบเทียบ' : '') + '</small></td><td><code>' + esc(entry.scenarioRevision) + '</code><small>'
        + (entry.baseline ? 'ค่าต้นแบบเดิม' : 'มีข้อมูลเปลี่ยนจากต้นแบบ') + '<br>' + (entry.createdAt ? esc(formatReviewTimestamp(new Date(entry.createdAt).toISOString())) : esc(createdAtDisplay))
        + '</small><code class="review-scenario-id">' + esc(entry.scenarioId) + '</code></td><td><strong>' + entryGroup.get(entry.key).id + '</strong><small>ทบทวน ' + entry.counts.attention + '<br>ข้อมูลขาด ' + entry.counts.missing + '<br>ระงับผล ' + entry.counts.withheld + '</small></td></tr>').join('')
      + '</tbody></table></div><p class="minor">Lᵢ เป็นความยาวรับผิดชอบของแถว BOQ ไม่ใช่ความยาวขยายรูปตัดทฤษฎี จำนวนประเด็นข้างต้นอาจทับซ้อนกันและไม่ใช่คะแนนผ่านงาน</p>',
      'registry', entries.length);
  });

  for (const group of groups) {
    const entry = group.exemplar;
    for (const category of ['beam', 'soil', 'context']) {
      const findings = entry.findings.filter(finding => finding.group === category);
      chunks(findings, REVIEW_FINDING_ROWS_PER_PAGE).forEach((items, index, parts) => {
        const title = group.id + ' · ' + groupLabel(category) + (parts.length > 1 ? ' ' + (index + 1) + '/' + parts.length : '');
        add(title, '<p class="eyebrow">' + group.id + ' / COMPLETE FINDINGS FOR IDENTICAL INPUTS</p><h2>' + esc(title) + '</h2>'
          + '<p class="review-intro">อ้างถึง ' + group.entries.length + ' ชุดข้อมูลตามทะเบียน · Scenario <code>' + esc(entry.scenarioRevision) + '</code><br>'
          + (entry.baseline ? 'ค่าต้นแบบเดิม' : 'มีข้อมูลเปลี่ยนจากต้นแบบ') + ' · การผ่านเงื่อนไขย่อยยังไม่ใช่การรับรองโครงการ</p>'
          + '<div class="review-table-wrap"><table class="review-findings"><thead><tr><th>ประเด็น / ช่องข้อมูล</th><th>ค่า / เกณฑ์ย่อย</th><th>สถานะ</th><th>เหตุผล / ที่มา</th></tr></thead><tbody>'
          + items.map(finding => '<tr data-finding-id="' + esc(finding.id) + '" data-review-group="' + group.id + '" data-availability="' + esc(finding.availability) + '" data-disposition="' + esc(finding.disposition) + '"><td><span class="finding-label">'
            + esc(finding.label) + '</span><small><code>' + esc(finding.id) + '</code></small></td><td>' + displayValue(finding, group)
            + '<small>' + esc(finding.unit || '—') + '</small>' + (finding.limit === null || finding.limit === undefined ? '' : '<span class="finding-limit">เกณฑ์ย่อย ' + esc(numberText(finding.limit)) + '</span>')
            + '</td><td><span class="finding-state">' + esc(dispositionLabel(finding.disposition)) + '</span><small>' + esc(availabilityLabel(finding.availability))
            + '</small></td><td><b>' + reasonReference(finding) + '</b><small>' + (finding.sourceKeys?.length ? finding.sourceKeys.map(esc).join('<br>') : 'ข้อความที่ผู้ใช้บันทึก') + '</small></td></tr>').join('')
          + '</tbody></table></div><div class="review-scope">' + (category === 'beam'
            ? 'อ่านเงื่อนไขเหล็กและรายละเอียดร่วมกับการเทียบแรง กำลังเฉือนที่ใช้ได้อาจถูกจำกัดแม้มีค่าตัวเลข แรงน้ำหนักตัวเองตัวอย่างไม่เติม Mu/Vu ที่ยังขาด'
            : category === 'soil' ? 'กรณีดินแยกตามกลไกและชนิดพารามิเตอร์ FS เป็นของลาดอนันต์เนื้อเดียว ไม่ใช่เสถียรภาพรวม หรือผลน้ำลดฉับพลันของโครงการ'
              : 'การมีข้อความอ้างอิงหรือระดับน้ำยังไม่ยืนยันเอกสาร การเลือกกรณีน้ำ หรือแรงดันน้ำรูพรุน ต้องอ่านและตรวจข้อมูลที่บันทึกจริง')
          + '</div>', 'findings', items.length, group.id);
      });
    }
  }

  for (const detail of textDetails) {
    const parts = splitReviewText(detail.value);
    parts.forEach((part, index) => add('ข้อความ ' + detail.reference + ' · ' + (index + 1) + '/' + parts.length,
      '<p class="eyebrow">COMPLETE RECORDED TEXT / ' + detail.group + '</p><h2>ข้อความอ้างอิง ' + detail.reference + ' · ' + (index + 1) + ' / ' + parts.length + '</h2>'
      + '<p class="review-intro">ชุดตรวจ ' + detail.group + ' · ' + esc(detail.finding.label) + '<br><code>' + esc(detail.finding.inputPaths?.join(', ') || detail.finding.id) + '</code></p>'
      + '<div class="context-detail" data-text-reference="' + detail.reference + '" data-text-part="' + (index + 1) + '">' + esc(part) + '</div>'
      + '<div class="review-scope">ข้อความบันทึกตาม snapshot ครบถ้วนและยังต้องตรวจเอกสารต้นทาง ข้อความนี้ไม่ได้ยืนยันการจับคู่หลุมเจาะหรือสภาพน้ำกับสถานีด้วยตัวมันเอง</div>', 'text', 0, detail.group));
  }
  const reasons = [...reasonReferences.entries()].flatMap(([value, reference]) => {
    const parts = splitReviewText(value);
    return parts.map((part, index) => ({ reference: reference + (parts.length > 1 ? ' (' + (index + 1) + '/' + parts.length + ')' : ''), value: part }));
  });
  boundedTextPages(reasons).forEach((items, index, parts) => add('เหตุผลและขั้นต่อไป ' + (index + 1) + '/' + parts.length,
    '<p class="eyebrow">FINDING BASIS / INPUT DESTINATION</p><h2>เหตุผลและขั้นต่อไป ' + (index + 1) + ' / ' + parts.length + '</h2>'
    + '<p class="review-intro">รหัส R… ใช้ร่วมกันเมื่อข้อความเหตุผล ขั้นต่อไป และแหล่งอ้างอิงตรงกันครบถ้วน ค่าตัวเลขของแต่ละชุดยังคงอยู่ในตาราง G…</p>'
    + '<dl class="review-reasons">' + items.map(item => '<dt>' + esc(item.reference) + '</dt><dd>' + esc(item.value) + '</dd>').join('') + '</dl>', 'reasons', items.length));

  const limits = record.limitations.map(item => ({ reference: item.id + ' · ' + item.title, value: item.description + '\nอ้างอิง: ' + (item.sourceKeys?.join(', ') || 'ขอบเขตโมดูล') }));
  boundedTextPages(limits).forEach((items, index, parts) => add('งานวิเคราะห์ที่ยังอยู่นอกโมดูล ' + (index + 1) + '/' + parts.length,
    '<p class="eyebrow">SHARED MODEL LIMITS / PROJECT-SPECIFIC REVIEW</p><h2>งานวิเคราะห์ที่ยังอยู่นอกโมดูล</h2>'
    + '<p class="review-intro">รายการนี้เป็นขอบเขตงานที่ต้องจัดทำหรือยืนยันเพิ่ม ไม่ใช่ผลวิเคราะห์ว่าทุกสถานีวิบัติ และไม่มีการนับเป็นคะแนนผ่าน/ไม่ผ่านของโครงการ</p>'
    + '<dl class="review-reasons">' + items.map(item => '<dt>' + esc(item.reference) + '</dt><dd>' + esc(item.value) + '</dd>').join('') + '</dl>', 'scope', items.length));
  add('เอกสารโครงการและบริบทสถานี', '<p class="eyebrow">PROJECT SOURCE / STATION CONTEXT</p><h2>เอกสารโครงการและบริบทสถานี</h2>'
    + '<p class="review-intro">รายการต่อไปนี้เป็นหลักฐานของค่าต้นแบบและทะเบียน BOQ การแก้ข้อมูลในสถานการณ์ไม่ได้ทำให้เอกสารเดิมกลายเป็นหลักฐานยืนยันค่าที่แก้</p>'
    + table(['หลักฐานต้นแบบ', 'ตำแหน่งและการใช้งาน'], SOURCE_FILES.filter(item => ['S-DWG', 'S-CALC', 'S-XLS'].includes(item.key)).map(item => [
      '<a href="' + esc(sourceURL(item.key)) + '">' + esc(item.title) + '</a>',
      esc(item.location) + '<br><span class="minor">' + esc(item.use) + '</span>',
    ]), 'review-sources')
    + '<div class="review-scope">รูปตัดต้นแบบเป็น SD-02 และคาน BF1 จาก SD-05 ส่วนทะเบียน 41 สถานีใช้แถว 14–25 / 104–132 ในชีตหาปริมาณวัสดุ ชื่อสถานีไม่ได้สร้างหน้าตัดสำรวจหรือจับคู่หลุมเจาะให้โดยอัตโนมัติ ผล Slope/W เดิมยังเป็นหลักฐานของแบบจำลองเดิมเท่านั้น</div>'
    + '<p class="review-intro">ข้อความบริบทที่ผู้ใช้กรอกแสดงครบในตารางหรือภาคผนวก T… เอกสารฉบับนี้บันทึกการมีข้อมูล ไม่ได้ตรวจสอบความถูกต้องของเอกสารที่อ้างด้วยข้อความนั้น</p>', 'sources', 3);
  chunks(record.sources, 5).forEach((sources, index, parts) => add('แหล่งข้อมูลและฐานสมการ ' + (index + 1) + '/' + parts.length,
    '<p class="eyebrow">SOURCE DOCUMENTS / SELECTED HISTORICAL METHODS</p><h2>แหล่งข้อมูลและฐานสมการ</h2>'
    + '<p class="review-intro">เอกสารเดิมให้ที่มาของค่าต้นแบบและสมการที่เลือก ข้อมูลที่แก้หรือข้อความที่ผู้ใช้บันทึกต้องตรวจยืนยันแยกตามรุ่นสถานการณ์</p>'
    + table(['รหัส', 'เอกสารและตำแหน่งอ้างอิง'], sources.map(item => [esc(item.id), safeSourceLink(item) + '<br><span class="minor">' + esc(item.sections || '') + '</span>']), 'review-sources')
    + '<div class="review-scope">รายงานนี้คงสมการ S6006-R2 และไม่มีการอนุมัติทั้งโครงการ การเลือกมาตรฐานโครงการ เกณฑ์ยอมรับ แรงออกแบบ และกรณีน้ำยังต้องได้รับการตรวจทางวิศวกรรม</div>', 'sources', sources.length));
  return { pages, metadata };
}

export function renderReviewReportPages({ pages, metadata }) {
  return pages.map((page, index) => '<section class="report-page review-page" data-page-title="' + esc(page.title)
    + '" data-page-kind="' + esc(page.kind) + '" data-row-count="' + page.rowCount + '" data-review-group="' + esc(page.group) + '">'
    + '<header class="running-head"><span>RIVERBANK STUDIO / ' + esc(metadata.projectCode) + ' · ENGINEERING REVIEW</span><span>' + esc(metadata.calculationRevision) + '</span></header>' + page.body
    + '<footer class="running-foot"><div class="foot-context"><span>Project ' + esc(metadata.projectRevision) + ' · ' + metadata.entryCount + ' ชุดในขอบเขต</span><span>Snapshot ' + esc(metadata.snapshotToken) + '</span><span>'
    + esc(metadata.reviewRevision) + ' · ' + esc(metadata.createdAtDisplay) + '</span></div><div class="foot-page"><span>' + esc(page.title) + '</span><strong>'
    + String(index + 1).padStart(2, '0') + ' / ' + pages.length + '</strong></div></footer></section>').join('');
}

export async function mountReviewReport({ document: doc = globalThis.document, window: view = globalThis.window } = {}) {
  const host = doc.querySelector('#review-report-ready'), printButton = doc.querySelector('#print-review-report');
  const errorBox = doc.querySelector('#review-report-error'), status = doc.querySelector('#review-report-status');
  const showError = error => {
    host.dataset.ready = 'false'; host.dataset.error = 'true'; host.setAttribute('aria-busy', 'false'); host.replaceChildren();
    doc.body.dataset.reportState = 'blocked'; printButton.disabled = true;
    status.textContent = 'ไม่สามารถจัดทะเบียนตรวจงานจาก snapshot ที่ร้องขอ';
    errorBox.hidden = false;
    errorBox.innerHTML = '<h1>ยังพิมพ์รายงานตรวจงานนี้ไม่ได้</h1><p>' + esc(error?.message || 'ไม่สามารถอ่านสำเนารายงานได้')
      + '</p><p>ไม่มีการแทน snapshot ที่ขาดหรือเสียหายด้วยค่าปัจจุบันหรือค่าต้นแบบ กรุณากลับไปเปิดโครงการและสร้างรายงานอีกครั้ง</p><a href="index.html">กลับไปโครงการ S6006</a>';
  };
  printButton.disabled = true; doc.body.dataset.reportState = 'loading';
  printButton.addEventListener('click', () => { if (host.dataset.ready === 'true') view.print(); });
  view.addEventListener('beforeprint', () => {
    if (host.dataset.ready !== 'true') showError(new Error('snapshot ทะเบียนตรวจงานยังไม่พร้อมหรือไม่ถูกต้อง การพิมพ์ผลถูกระงับ'));
  });
  try {
    const response = await view.fetch('source-data.json');
    if (!response.ok) throw new Error('อ่านชุดข้อมูลอ้างอิง S6006 ไม่สำเร็จ');
    const source = await response.json();
    const resolved = loadReviewProject({ search: view.location.search, storage: view.localStorage, source });
    const snapshotToken = new URLSearchParams(view.location.search).get('snapshot');
    const record = buildReviewReportPages({ ...resolved, source, snapshotToken });
    host.innerHTML = renderReviewReportPages(record);
    Object.assign(host.dataset, {
      mode: record.metadata.mode, projectRevision: record.metadata.projectRevision,
      reviewRevision: record.metadata.reviewRevision, snapshot: snapshotToken,
      stationId: record.metadata.selection.stationId, kind: record.metadata.selection.kind,
      focus: record.metadata.selection.focus, entryCount: String(record.metadata.entryCount),
      excludedCount: String(record.metadata.excludedCount), groupCount: String(record.metadata.groupCount),
    });
    if (doc.fonts?.ready) await doc.fonts.ready;
    host.dataset.ready = 'true'; host.dataset.error = 'false'; host.setAttribute('aria-busy', 'false');
    errorBox.hidden = true; doc.body.dataset.reportState = 'ready'; printButton.disabled = false;
    status.textContent = 'S6006 / ทะเบียนตรวจงาน ' + record.metadata.entryCount + ' ชุด · ' + record.metadata.scope.station;
    doc.title = 'S6006 · ทะเบียนตรวจงานวิศวกรรม · ' + record.metadata.entryCount + ' ชุด';
    return record;
  } catch (error) { showError(error); return null; }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && document.querySelector('#review-report-ready')) mountReviewReport();
