import { buildInvestigationReviews } from './investigations.js';
import { getBoreholeSource, INVESTIGATION_SOURCE_NOTES } from './investigation-sources.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sta = value => Math.floor(value / 1000) + '+' + String(value % 1000).padStart(3, '0');
export const INVESTIGATION_REPORT_ROWS = 6;
export const INVESTIGATION_REPORT_TEXT_LIMIT = 700;
const stateLabel = state => ({missing:'ยังไม่มีฐานอ้างอิง', incomplete:'ข้อมูลฐานยังไม่ครบ', current:'ข้อมูลตรงกับชุดที่บันทึก', stale:'มีค่าเปลี่ยน ต้องทบทวน'}[state] || state);
const labels = {
  boreholeId:'หลุมเจาะ / ตัวอย่าง', documentRevision:'รุ่นเอกสาร', locator:'หน้า / ตาราง / ตำแหน่ง',
  sampleDepthFromM:'เริ่มช่วงตัวอย่าง (m)', sampleDepthToM:'สิ้นสุดช่วงตัวอย่าง (m)', depthReference:'จุดอ้างอิงความลึก',
  testMethod:'วิธีทดสอบ / วิธีหาค่า', parameterInterpretation:'การตีความพารามิเตอร์และสภาพระบายน้ำ',
  applicabilityNote:'เหตุผลที่ใช้กับสถานีนี้', notes:'หมายเหตุ', datum:'ระบบระดับ / datum', observationText:'ช่วงสังเกต / กรณีระดับน้ำ',
  'geometry.slopeH':'ลาดร่วม H : 1 V', 'soilInputs.mode':'โหมดดิน', 'soilInputs.verticalDepthM':'ความลึกระนาบแนวดิ่ง z',
  'soilInputs.unitWeightKnM3':'หน่วยน้ำหนักดิน γ', 'soilInputs.saturatedUnitWeightKnM3':'หน่วยน้ำหนักอิ่มตัว γsat',
  'soilInputs.waterUnitWeightKnM3':'หน่วยน้ำหนักน้ำ γw', 'soilInputs.frictionAngleDeg':'มุมเสียดทาน φ′',
  'soilInputs.effectiveCohesionKpa':'แรงยึดเหนี่ยว c′', 'soilInputs.undrainedStrengthKpa':'กำลังเฉือน Su',
  'context.boreholeReference':'ที่มาหลุมเจาะ / ค่าดิน', 'context.waterReference':'ที่มาของระดับน้ำ',
  'context.sourceNote':'หมายเหตุที่มาของสถานี', 'context.waterHighLevel':'ระดับน้ำสูง',
  'context.waterLowLevel':'ระดับน้ำต่ำ', 'context.groundwaterLevel':'ระดับน้ำใต้ดินอ้างอิง',
};
const units = {
  'geometry.slopeH':'H : 1 V', 'soilInputs.verticalDepthM':'m', 'soilInputs.unitWeightKnM3':'kN/m³',
  'soilInputs.saturatedUnitWeightKnM3':'kN/m³', 'soilInputs.waterUnitWeightKnM3':'kN/m³',
  'soilInputs.frictionAngleDeg':'°', 'soilInputs.effectiveCohesionKpa':'kPa', 'soilInputs.undrainedStrengthKpa':'kPa',
  'context.waterHighLevel':'m', 'context.waterLowLevel':'m', 'context.groundwaterLevel':'m',
};
const chunks = (rows, size = INVESTIGATION_REPORT_ROWS) => {
  const result = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
};
const table = (heads, rows) => '<table class="investigation-print-table"><thead><tr>'
  + heads.map(head => '<th>' + esc(head) + '</th>').join('') + '</tr></thead><tbody>'
  + rows.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('') + '</tbody></table>';

export function splitInvestigationText(value) {
  const result = []; let text = '', count = 0, breaks = 0;
  for (const character of value) {
    if (count >= INVESTIGATION_REPORT_TEXT_LIMIT || (/[\r\n]/.test(character) && breaks >= 12)) {
      result.push(text); text = ''; count = 0; breaks = 0;
    }
    text += character; count++;
    if (/[\r\n]/.test(character)) breaks++;
  }
  if (text) result.push(text);
  return result;
}

function timestamp(value) {
  return new Intl.DateTimeFormat('th-TH', {timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)) + ' (Asia/Bangkok)';
}

/** Append only the caller's selected entries. Old reports without records stay unchanged. */
export function buildInvestigationAppendix({ project, source, entries }) {
  if (!Array.isArray(entries) || !entries.length) throw new TypeError('ภาคผนวกต้องระบุสถานีและชุดข้อมูลในรายงาน');
  const keys = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.stationId !== 'string' || typeof entry.scenarioId !== 'string') throw new TypeError('ขอบเขตฐานอ้างอิงไม่ถูกต้อง');
    const key = entry.stationId + '/' + entry.scenarioId;
    if (keys.has(key)) throw new TypeError('ขอบเขตฐานอ้างอิงมีชุดข้อมูลซ้ำ');
    keys.add(key);
  }
  if (project.version < 3) return [];
  const records = buildInvestigationReviews(project, source, entries);
  if (!records.some(record => record.groups.some(group => group.hasRecord))) return [];
  const pages = [], details = new Map();
  const valueCell = value => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RangeError('ภาคผนวกต้องไม่มี NaN หรือ Infinity');
      return esc(String(value));
    }
    const valueText = String(value);
    if (Array.from(valueText).length > 64 || /[\r\n\t]/.test(valueText)) {
      if (!details.has(valueText)) details.set(valueText, 'D' + (details.size + 1));
      const preview = Array.from(valueText.replace(/\s+/g, ' ').trim()).slice(0, 42).join('');
      return esc(preview) + '… <b>[' + details.get(valueText) + ']</b>';
    }
    return esc(valueText);
  };
  const add = (title, content, record = null, group = null, rowCount = 0) => pages.push({
    title, kind:'investigation', rowCount, group:'',
    body:'<div class="investigation-appendix"'
      + (record ? ' data-investigation-entry-key="' + esc(record.station.id + '/' + record.scenarioId) + '"' : '')
      + (group ? ' data-investigation-kind="' + group.kind + '" data-investigation-state="' + group.state + '"' : '')
      + '><p class="eyebrow">SOIL & WATER / RECORDED BASIS</p>' + content + '</div>',
  });
  const caption = record => '<p class="investigation-print-identity">R' + record.station.reach + ' · STA ' + esc(sta(record.station.station))
    + ' · ' + valueCell(record.scenarioName) + '<br><code>' + esc(record.station.id + '/' + record.scenarioId)
    + '</code> · <code>' + esc(record.scenarioRevision) + '</code><br>รุ่นวิธีติดตามฐาน <code>' + esc(record.investigationRevision) + '</code></p>';
  const registryRows = records.map(record => [
    'R' + record.station.reach + ' · STA ' + esc(sta(record.station.station)) + '<br><code>' + esc(record.station.id) + '</code>',
    valueCell(record.scenarioName) + '<br><code>' + esc(record.scenarioId) + '</code>',
    esc(stateLabel(record.groups.find(group => group.kind === 'soil').state)),
    esc(stateLabel(record.groups.find(group => group.kind === 'water').state)),
  ]);
  chunks(registryRows).forEach((rows, index, parts) => add('ทะเบียนฐานอ้างอิงดินและน้ำ ' + (index + 1) + '/' + parts.length,
    '<h2>ฐานอ้างอิงดินและน้ำในขอบเขตรายงาน</h2>'
    + '<p>ภาคผนวกนี้ใช้เฉพาะ ' + records.length + ' ชุดที่รายงานเลือกไว้ สถานะ “ข้อมูลตรงกับชุดที่บันทึก” หมายถึงค่าที่ยังตรงกัน ไม่ได้ยืนยันความถูกต้องของเอกสาร การจับคู่หลุมเจาะ หรือการรับรองทางวิศวกรรม</p>'
    + table(['สถานี','ชุดข้อมูล','ฐานค่าดิน','ฐานระดับน้ำ'], rows)
    + '<p>ทะเบียนคำนวณและฐานอ้างอิงเป็นคนละรายการตรวจ ข้อมูลต้นฉบับของหลุมเจาะไม่ถูกนำไปแทนพารามิเตอร์ในแอปโดยอัตโนมัติ</p>', null, null, rows.length));

  for (const record of records) for (const group of record.groups) {
    if (!group.hasRecord) continue;
    const title = group.kind === 'soil' ? 'ฐานค่าดิน' : 'ฐานระดับน้ำ';
    const binding = group.binding;
    const missing = [...group.missingMetadata, ...group.missingInputs];
    add(title + ' · ' + record.station.id + '/' + record.scenarioId,
      '<h2>' + title + ' · ' + esc(stateLabel(group.state)) + '</h2>' + caption(record)
      + table(['รายการ','ข้อมูล'], [
        ['เวลาที่ผูกกับค่าชุดนี้', binding ? esc(timestamp(binding.recordedAt)) : 'ยังไม่ได้ผูกกับค่าปัจจุบัน'],
        ['สถานีของชุดที่บันทึก', binding ? esc(binding.stationId) : '—'],
        ['ค่าที่เปลี่ยน / ข้อมูลอ้างอิงที่เปลี่ยน', group.inputChanges.length + ' / ' + group.metadataChanges.length],
        ['ข้อมูลที่ยังขาด', missing.length ? esc(missing.map(item => item.label).join(' · ')) : 'กรอกช่องที่ติดตามครบแล้ว · ยังต้องตรวจเนื้อหาและความเหมาะสม'],
      ])
      + '<div class="investigation-print-note">' + (group.kind === 'water'
        ? 'ระดับน้ำที่บันทึกเป็นบริบท ยังไม่ได้แปลงเป็นแรงดันน้ำรูพรุนหรือผลน้ำลดฉับพลันใน R2 การผูกฐานนี้ไม่เพิ่มการวิเคราะห์ดังกล่าว'
        : 'พารามิเตอร์ใน R2 เป็นแบบจำลองดินเนื้อเดียวตามสมมติฐานที่เลือก การบันทึกหลุมเจาะ ช่วงตัวอย่าง และวิธีตีความไม่ทำให้กลายเป็นการวิเคราะห์ชั้นดินหลายชั้นหรือเสถียรภาพรวม') + '</div>', record, group, 4);

    const changedMetadata = new Set(group.metadataChanges.map(item => item.field));
    const metadataRows = Object.entries(group.metadata).map(([field, value]) => [
      esc(labels[field] || field) + '<small>' + esc(field) + '</small>',
      binding ? valueCell(binding.metadata[field]) : 'ยังไม่ผูก', valueCell(value),
      changedMetadata.has(field) || changedMetadata.has('metadata.' + field) ? 'เปลี่ยน ต้องทบทวน' : binding ? 'ตรงกัน' : 'ยังไม่ผูก',
    ]);
    chunks(metadataRows).forEach((rows, index, parts) => add(title + ' / ที่มา ' + (index + 1) + '/' + parts.length,
      '<h2>' + title + ' · รายละเอียดที่มา</h2>' + caption(record)
      + table(['รายการ','ตอนที่ผูกฐาน','ข้อมูลอ้างอิงใน snapshot','ความสัมพันธ์'], rows)
      + '<p>การแก้ข้อมูลอ้างอิงไม่ได้ผูกกับค่าปัจจุบันให้ใหม่ ต้องใช้ปุ่ม “ผูกกับค่าปัจจุบัน” อย่างชัดเจนหลังทบทวนแล้ว ข้อความ D… อยู่ครบในส่วนรายละเอียดท้ายภาคผนวก</p>', record, group, rows.length));

    const changedInputs = new Set(group.inputChanges.map(item => item.field));
    const inputRows = Object.entries(group.currentValues).map(([field, value]) => [
      esc(labels[field] || field) + '<small>' + esc(field) + '</small>',
      binding && own(binding.values, field) ? valueCell(binding.values[field]) : 'ยังไม่ผูก', valueCell(value),
      esc(units[field] || '—'), changedInputs.has(field) ? 'เปลี่ยน ต้องทบทวน' : binding ? 'ตรงกัน' : 'ยังไม่ผูก',
    ]);
    chunks(inputRows).forEach((rows, index, parts) => add(title + ' / ค่าอ้างอิง ' + (index + 1) + '/' + parts.length,
      '<h2>' + title + ' · ค่าที่ผูกไว้และค่าในรายงาน</h2>' + caption(record)
      + table(['รายการ','ค่าตอนผูกฐาน','ค่าใน snapshot','หน่วย','ความสัมพันธ์'], rows)
      + '<p>ตัวเลขแสดงค่าที่บันทึกโดยไม่ปัดเป็นศูนย์ เครื่องหมาย — หมายถึงยังไม่มีค่า ช่องที่ไม่ใช้ในโหมดดินนั้นไม่กลายเป็นผลคำนวณอีกกรณี และความตรงกันของค่าไม่ใช่ผลผ่านเกณฑ์ออกแบบ</p>', record, group, rows.length));

    if (group.kind === 'soil') {
      const ids = [...new Set([group.metadata.boreholeId, binding?.metadata.boreholeId].filter(Boolean))];
      const found = ids.map(getBoreholeSource).filter(Boolean);
      if (found.length) add('หลุมเจาะอ้างอิง · ' + record.station.id + '/' + record.scenarioId,
        '<h2>หน้าต้นฉบับของหลุมเจาะที่ระบุ</h2>' + caption(record)
        + found.map(hole => {
          const isCurrent = hole.id === group.metadata.boreholeId, isBound = hole.id === binding?.metadata.boreholeId;
          const role = isCurrent && isBound ? 'รหัสตรงกันในข้อมูลอ้างอิงของ snapshot และตอนผูกฐาน'
            : isCurrent ? 'รหัสในข้อมูลอ้างอิงของ snapshot' : 'รหัสตอนผูกฐานเดิม';
          return '<h3 data-investigation-source-role="' + (isCurrent ? 'current' : '') + (isBound ? ' bound' : '') + '">' + esc(hole.id + ' · ' + hole.environment) + '</h3><p>' + role + '</p>'
          + table(['รายการต้นฉบับ','ข้อความ / ตำแหน่ง'], [
            ['บันทึกเจาะ / ผลแล็บ', 'PDF หน้า ' + hole.logPage + ' / ' + hole.labPage + ' (' + (hole.labPosition === 'top' ? 'ครึ่งบน' : 'ครึ่งล่าง') + ')'],
            ['วันเจาะ / วันในสรุปแล็บ', esc(hole.boringStartedText + ' / ' + hole.laboratoryDateText)],
            ['W.L. ตามที่พิมพ์', hole.observedWaterLevelText === null ? 'ช่องว่างในต้นฉบับ · ไม่ทราบ' : esc(hole.observedWaterLevelText)],
          ]) + '<p><a href="' + esc(hole.sourceUrl) + '">เปิดรายการคำนวณต้นฉบับ S-CALC</a></p>';
        }).join('')
        + '<p class="minor">ไฟล์ต้นฉบับ SHA-256 <code>' + esc(found[0].sourceSha256) + '</code></p>'
        + '<p>เก็บวันที่และ W.L. เป็นข้อความต้นฉบับ ยังไม่ได้แปลงเป็นระดับน้ำใต้ดินของหน้าตัด และยังไม่ยืนยันความเป็นตัวแทนของหลุมเจาะต่อสถานี</p>', record, group, found.length * 3);
    }
  }
  chunks(INVESTIGATION_SOURCE_NOTES, 4).forEach((notes, index, parts) => add('ขอบเขตหลักฐานดินและน้ำ ' + (index + 1) + '/' + parts.length,
    '<h2>ขอบเขตหลักฐานดินและน้ำ</h2><ul>' + notes.map(note => '<li>' + esc(note) + '</li>').join('') + '</ul>'
    + '<p>ฐานอ้างอิงของทางเลือกที่บันทึกถูกเก็บแยกจากค่าที่กำลังแก้ การกลับไปใช้ทางเลือกจะคัดลอกฐานของทางเลือกนั้นกลับมาด้วย หากต้องส่งรายงานให้ผู้อื่น ให้บันทึกเป็น PDF; ข้อมูลที่แก้ต่อได้อยู่ในไฟล์โครงการ JSON</p>', null, null, notes.length));
  // Every long user string referenced above is preserved verbatim and escaped.
  for (const [value, reference] of details) splitInvestigationText(value).forEach((part, index, parts) => add('รายละเอียดฐานอ้างอิง ' + reference + ' · ' + (index + 1) + '/' + parts.length,
    '<h2>รายละเอียดฐานอ้างอิง ' + reference + '</h2><p>ส่วน ' + (index + 1) + ' / ' + parts.length + ' · ข้อความฉบับเต็มตามรหัสในตาราง</p>'
    + '<div class="investigation-print-text" data-investigation-text="' + reference + '">' + esc(part) + '</div>'));
  return pages;
}
