import { buildReview, selectReview, reviewCSV } from './review.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const format = value => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) return 'ค่านอกขอบเขต';
  if (value !== 0 && (Math.abs(value) < 0.0001 || Math.abs(value) >= 1e9)) return value.toExponential(6);
  return value.toLocaleString('en-US', {maximumFractionDigits:4});
};
const stationLabel = station => 'R' + station.reach + ' · STA ' + Math.floor(station.station / 1000) + '+' + String(station.station % 1000).padStart(3, '0');
const groups = [ ['beam', 'โครงสร้างคาน'], ['soil', 'ดินและกรณีการคำนวณ'], ['context', 'น้ำ หลุมเจาะ และที่มาข้อมูล'] ];

function dispositionLabel(value) {
  switch (value) {
    case 'attention': return 'ต้องทบทวน';
    case 'missing': return 'ข้อมูลยังไม่ครบ';
    case 'condition-met': return 'ผ่านเงื่อนไขย่อย';
    case 'computed-only': return 'ผลแบบจำลองย่อย';
    case 'outside-scope': return 'ต้องตรวจนอกโมดูล';
    case 'not-applicable': return 'ไม่ใช้ในกรณีนี้';
    case 'recorded': return 'มีข้อมูลบันทึก · ยังต้องยืนยัน';
    default: return String(value ?? '');
  }
}

function sourceHTML(sources, keys) {
  return (keys || []).map(key => {
    const item = sources.find(source => source.id === key);
    if (!item) return '<span class="review-source-ref">' + escape(key) + '</span>';
    const title = item.title || item.id;
    const label = /^https?:\/\//.test(item.url || '')
      ? '<a href="' + escape(item.url) + '" target="_blank" rel="noopener noreferrer">' + escape(title) + ' ↗</a>'
      : escape(title);
    return '<span class="review-source-ref">' + label + '</span>';
  }).join('');
}

/** Render a finding without deriving engineering acceptance in the presentation. */
export function reviewFindingHTML(finding, {entryKey = '', kind = 'current', sources = []} = {}) {
  const withheld = finding.availability === 'gated';
  const status = withheld ? 'ยังใช้ตรวจไม่ได้ · ' + dispositionLabel(finding.disposition) : dispositionLabel(finding.disposition);
  const action = finding.actionTarget;
  const actionLabel = kind === 'saved' ? 'เปิดทางเลือกที่เก็บ →'
    : action?.panel === 'basis' ? 'ดูที่มาและขอบเขต →'
      : finding.group === 'beam' ? 'แก้ข้อมูลคาน →'
        : finding.group === 'soil' ? 'แก้ข้อมูลดิน →' : 'กรอกข้อมูลอ้างอิง →';
  return '<article class="review-finding" data-review-finding="' + escape(finding.id) + '" data-availability="' + escape(finding.availability) + '" data-disposition="' + escape(finding.disposition) + '">'
    + '<div class="review-finding-title"><h4>' + escape(finding.label) + '</h4><span class="review-status" data-review-status="' + escape(finding.disposition) + '">' + escape(status) + '</span></div>'
    + '<div class="review-finding-body"><div class="review-finding-numbers"><div><small>ค่าที่ตรวจ</small><strong class="review-finding-value">' + escape(format(finding.value)) + '</strong>' + (finding.unit ? '<span class="review-unit">' + escape(finding.unit) + '</span>' : '') + '</div>'
    + (finding.limit !== null && finding.limit !== undefined && finding.limit !== '' ? '<div><small>เกณฑ์ / ขีดจำกัดของรายการ</small><strong class="review-finding-limit">' + escape(format(finding.limit)) + '</strong>' + (finding.unit ? '<span class="review-unit">' + escape(finding.unit) + '</span>' : '') + '</div>' : '') + '</div>'
    + '<p class="review-finding-reason">' + escape(finding.reason) + '</p>'
    + ((finding.inputPaths || []).length ? '<p class="review-input-paths"><span>ข้อมูลที่เกี่ยวข้อง</span> ' + finding.inputPaths.map(path => '<code>' + escape(path) + '</code>').join(' ') + '</p>' : '')
    + ((finding.sourceKeys || []).length ? '<details class="review-finding-sources"><summary>ที่มาของวิธีตรวจ</summary>' + sourceHTML(sources, finding.sourceKeys) + '</details>' : '') + '</div>'
    + (action ? '<div class="review-finding-action"><button type="button" class="text-button" data-review-navigate data-review-action="' + escape(entryKey) + '" data-review-action-finding="' + escape(finding.id) + '">' + actionLabel + '</button></div>' : '') + '</article>';
}

function entryChoice(entry, selected) {
  return '<button type="button" class="review-entry-choice' + (selected ? ' selected' : '') + '" data-review-inspect data-review-entry="' + escape(entry.key) + '" data-review-entry-key="' + escape(entry.key) + '" aria-pressed="' + selected + '">'
    + '<span class="review-entry-station">' + escape(stationLabel(entry.station)) + ' <span>' + (entry.kind === 'saved' ? 'ทางเลือกที่เก็บ' : 'ค่าที่กำลังแก้') + '</span></span>'
    + '<strong>' + escape(entry.scenarioName) + '</strong><span class="review-entry-origin">' + (entry.baseline ? 'ค่าตรงกับต้นแบบ' : 'มีค่าต่างจากต้นแบบ') + (entry.isReference ? ' · ฐานเปรียบเทียบ' : '') + '</span>'
    + '<span class="review-entry-counts"><span>ต้องทบทวน <b>' + entry.counts.attention + '</b></span><span>ข้อมูลขาด <b>' + entry.counts.missing + '</b></span><span>กำลังยังใช้ไม่ได้ <b>' + entry.counts.withheld + '</b></span></span></button>';
}

export function reviewEntryDetailHTML(entry, record) {
  const metric = (label, value, unit) => '<div><small>' + label + '</small><strong>' + escape(format(value)) + '</strong><span>' + unit + '</span></div>';
  return '<article class="card review-entry-detail" id="review-detail" data-entry-key="' + escape(entry.key) + '" data-review-detail="' + escape(entry.key) + '"><header class="review-detail-head"><div><p class="eyebrow">SELECTED SCENARIO / TRACEABLE CHECKS</p><h3 id="review-detail-heading" tabindex="-1">' + escape(stationLabel(entry.station)) + ' · ' + escape(entry.scenarioName) + '</h3><p>' + (entry.kind === 'saved' ? 'ทางเลือกที่เก็บ · การเปิดดูรายการไม่เปลี่ยนค่าที่กำลังแก้' : 'ค่าที่กำลังแก้ของสถานีนี้') + '</p></div><span class="review-origin-badge">' + (entry.baseline ? 'ค่าตรงกับต้นแบบ' : 'มีค่าต่างจากต้นแบบ') + '</span></header>'
    + '<div class="review-entry-provenance"><span>' + escape(entry.station.sourceSheet) + ' แถว ' + escape(entry.station.sourceRow) + ' · Lᵢ = ' + escape(format(entry.station.effectiveLength)) + ' ม.</span><code>' + escape(entry.scenarioRevision) + '</code></div>'
    + '<p class="review-detail-scope">สถานีเป็นบริบทจาก BOQ รูปตัดยังเป็นรูปทรงทฤษฎี การเปลี่ยนค่าและการมีข้อความอ้างอิงไม่ได้ยืนยันว่าข้อมูลผ่านการตรวจแล้ว</p>'
    + '<div class="review-key-values">' + metric('φMn ที่ใช้ตรวจ Mu', entry.metrics.usablePhiMnKnM, 'kN·m') + metric('ขีดจำกัด Vu ในโมดูล', entry.metrics.usablePhiVnKn, 'kN') + metric('Mu ที่ระบุ', entry.metrics.MuKnM, 'kN·m') + metric('Vu ที่ระบุ', entry.metrics.VuKn, 'kN') + '</div>'
    + '<p class="review-value-explanation">เครื่องหมาย — ต้องอ่านร่วมกับสถานะและเหตุผลด้านล่าง: ข้อมูลที่ขาด กำลังที่ยังใช้ตรวจไม่ได้ และกรณีที่ไม่ใช้ แสดงแยกกัน</p>'
    + groups.map(([id, label]) => {
      const findings = entry.findings.filter(finding => finding.group === id);
      return findings.length ? '<section class="review-finding-group" data-review-group="' + id + '"><h3>' + label + '</h3>' + findings.map(finding => reviewFindingHTML(finding, {entryKey:entry.key, kind:entry.kind, sources:record.sources})).join('') + '</section>' : '';
    }).join('') + '</article>';
}

export function mountReview(container, {getProject, getSource, onNavigate, onNotice, onDownload, onReport}) {
  let previousStation = null, focusedKey = null;
  let selection = {stationId:getProject().selectedStationId, kind:'all', focus:'all'};
  let record, selected;

  function render() {
    const project = getProject();
    if (previousStation !== project.selectedStationId) {
      selection = {...selection, stationId:project.selectedStationId};
      focusedKey = null;
      previousStation = project.selectedStationId;
    }
    record = buildReview(project, getSource());
    selected = selectReview(record, selection);
    if (!selected.entries.some(entry => entry.key === focusedKey)) {
      focusedKey = (selected.entries.find(entry => entry.station.id === project.selectedStationId && entry.kind === 'current') || selected.entries[0])?.key || null;
    }
    const entry = selected.entries.find(item => item.key === focusedKey);
    const attention = selected.entries.filter(item => item.counts.attention > 0).length;
    const missing = selected.entries.filter(item => item.counts.missing > 0).length;
    container.dataset.projectRevision = record.metadata.projectRevision;
    container.dataset.reviewRevision = record.metadata.reviewRevision;
    container.dataset.scopeStationId = selection.stationId;
    container.dataset.scopeKind = selection.kind;
    container.dataset.scopeFocus = selection.focus;
    container.dataset.includedCount = String(selected.includedCount);
    container.dataset.eligibleCount = String(selected.eligibleCount);
    container.dataset.excludedCount = String(selected.excludedCount);
    container.dataset.selectedEntry = focusedKey || '';
    container.innerHTML = '<article class="review-intro"><div><p class="eyebrow">ENGINEERING REVIEW / STATIONS & OPTIONS</p><h2>เห็นสิ่งที่ต้องตรวจ แล้วกลับไปแก้ได้ตรงจุด</h2><p>อ่านผลของแต่ละสถานีและทางเลือก พร้อมข้อมูลที่ขาด เงื่อนไขที่ต้องทบทวน และที่มาของวิธีตรวจ</p></div><div class="review-scope-count"><strong>' + selected.includedCount + '</strong><span>ชุดข้อมูลที่แสดง</span></div></article>'
      + '<div class="review-project-register" id="review-project-register" aria-label="ทะเบียนทั้งโครงการ"><strong>ทะเบียนทั้งโครงการ</strong><span>' + record.summary.stationCount + ' สถานี</span><span>ค่าปัจจุบันตรงต้นแบบ <b>' + record.summary.baselineCurrentCount + '</b> ชุด</span><span>ค่าปัจจุบันต่างจากต้นแบบ <b>' + record.summary.modifiedCurrentCount + '</b> ชุด</span><span>ทางเลือกที่เก็บ <b>' + record.summary.savedCount + '</b> ชุด</span></div>'
      + '<form class="review-filters" id="review-filter-form"><label for="review-station">สถานีที่ตรวจ<select id="review-station" name="stationId"><option value="all"' + (selection.stationId === 'all' ? ' selected' : '') + '>ทุกสถานีในทะเบียน</option>' + record.stations.map(station => '<option value="' + escape(station.id) + '"' + (selection.stationId === station.id ? ' selected' : '') + '>' + escape(stationLabel(station)) + '</option>').join('') + '</select></label>'
      + '<label for="review-kind">ชุดข้อมูลที่ตรวจ<select id="review-kind" name="kind">' + [['all','ค่าที่กำลังแก้และทางเลือกที่เก็บ'],['current','ค่าที่กำลังแก้'],['saved','เฉพาะทางเลือกที่เก็บ']].map(([value,label]) => '<option value="' + value + '"' + (selection.kind === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label>'
      + '<label for="review-focus">กรองชุดที่ต้องการ<select id="review-focus" name="focus">' + [['all','ทุกชุดในขอบเขต'],['attention','มีเงื่อนไขต้องทบทวน'],['missing','มีข้อมูลที่ยังขาด'],['baseline','ค่าตรงกับต้นแบบ']].map(([value,label]) => '<option value="' + value + '"' + (selection.focus === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label></form>'
      + '<div class="review-summary"><div><strong>' + selected.includedCount + ' / ' + selected.eligibleCount + '</strong><span>ชุดที่แสดง / ก่อนกรอง</span></div><div><strong>' + attention + '</strong><span>ชุดที่มีเงื่อนไขต้องทบทวน</span></div><div><strong>' + missing + '</strong><span>ชุดที่มีข้อมูลขาด</span></div></div>'
      + '<div class="review-toolbar"><div><p id="review-scope-description">กรองออก ' + selected.excludedCount + ' ชุด · จำนวนประเด็นอาจซ้ำกันในชุดข้อมูลเดียวกัน</p><p>ตัวกรองเลือกชุดข้อมูล ตารางและรายงานส่งออก <strong>ทุกข้อของชุดที่แสดง</strong> พร้อมขอบเขตที่เลือก</p><code>' + escape(record.metadata.projectRevision) + '</code></div><div class="review-export"><button type="button" class="button" id="export-review"' + (selected.includedCount ? '' : ' disabled') + '>ทะเบียนตรวจ CSV ↓</button><button type="button" class="button primary" id="report-review"' + (selected.includedCount ? '' : ' disabled') + '>รายงานทะเบียนตรวจ ↗</button></div></div>'
      + '<div class="review-register-note">สถานีที่ยังใช้ค่าต้นแบบไม่ได้มีข้อมูลสำรวจเฉพาะตำแหน่งเพิ่มขึ้น จำนวนชุดและประเด็นเป็นทะเบียนสำหรับติดตามงาน ไม่ใช่เปอร์เซ็นต์ความพร้อมหรือผลอนุมัติแบบ</div>'
      + (selected.includedCount ? '<section class="card review-entry-picker"><div class="card-head"><h3>เลือกชุดเพื่ออ่านรายการตรวจ</h3><span>' + selected.includedCount + ' ชุด · รายการเลื่อนได้</span></div><div class="review-entry-grid" role="region" tabindex="0" aria-label="รายการชุดข้อมูล เลื่อนเพื่อเลือกสถานการณ์ที่ต้องการตรวจ">' + selected.entries.map(item => entryChoice(item, item.key === focusedKey)).join('') + '</div></section>' + reviewEntryDetailHTML(entry, record)
        : '<article class="card review-empty" role="status"><h3>ไม่มีชุดข้อมูลตรงตัวกรองนี้</h3><p>ปรับสถานี ชนิดชุดข้อมูล หรือตัวกรองเพื่อดูรายการอื่น หากต้องการตรวจทางเลือกที่เก็บ ให้เก็บทางเลือกในแท็บ 07 ก่อน</p><p>ผลการกรองว่างไม่ได้หมายความว่าโครงการผ่านการตรวจทั้งหมด</p></article>')
      + '<details class="card review-limitations"><summary>ขอบเขตที่ต้องตรวจต่อและแหล่งอ้างอิง</summary><div>' + record.limitations.map(item => '<section><h4>' + escape(item.title) + '</h4><p>' + escape(item.description) + '</p>' + sourceHTML(record.sources, item.sourceKeys) + '</section>').join('') + '</div></details>';
  }

  container.addEventListener('submit', event => { if (event.target.id === 'review-filter-form') event.preventDefault(); });
  container.addEventListener('change', event => {
    if (!['review-station','review-kind','review-focus'].includes(event.target.id)) return;
    const previous = selection;
    try {
      selection = {...selection, [event.target.name]:event.target.value};
      focusedKey = null;
      render();
      container.querySelector('#' + event.target.id)?.focus();
    } catch (error) { selection = previous; render(); onNotice(error.message, true); }
  });
  container.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.reviewEntry) {
      focusedKey = button.dataset.reviewEntry; render();
      container.querySelector('#review-detail-heading')?.focus({preventScroll:true});
      container.querySelector('.review-entry-detail')?.scrollIntoView({block:'start', behavior:'smooth'});
      return;
    }
    if (button.dataset.reviewAction) {
      const entry = selected.entries.find(item => item.key === button.dataset.reviewAction);
      const finding = entry?.findings.find(item => item.id === button.dataset.reviewActionFinding);
      if (finding?.actionTarget) onNavigate({stationId:entry.station.id, scenarioId:entry.scenarioId, target:finding.actionTarget});
      return;
    }
    if (button.id === 'export-review') {
      try {
        const fresh = buildReview(getProject(), getSource());
        const csv = reviewCSV(fresh, selection);
        onDownload('S6006-review-' + selection.stationId + '-' + selection.kind + '-' + selection.focus + '.csv', csv, 'text/csv;charset=utf-8');
        onNotice('ส่งออกทะเบียนตรวจแล้ว · มีทุกข้อของชุดที่เลือก พร้อมขอบเขต สถานะ และรุ่นข้อมูล');
      } catch (error) { onNotice(error.message, true); }
      return;
    }
    if (button.id === 'report-review') onReport({...selection});
  });
  render();
  return {render};
}
