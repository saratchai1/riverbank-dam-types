import { sourceURL } from './case-data.js';

/**
 * Source-only catalogue, visually checked against S6006 calculation PDF pp4–15.
 * Printed dates and water observations remain text. No station assignment,
 * elevation conversion, soil parameter interpretation, or numeric adoption occurs.
 */
const sourceUrl = sourceURL('S-CALC');
const sourceSha256 = '5fe3eaf702d24d090fc51a502d19378b2c60584dde1e0e13669590340a1462f3';

const sourceRows = [
  ['BH-1', 'LAND', 4, 12, 'top',    '25/11/60', '-7.00 M.'],
  ['BH-2', 'LAND', 5, 12, 'bottom', '23/11/60', '-6.40 M.'],
  ['BH-3', 'LAND', 6, 13, 'top',    '29/11/60', '-8.00 M.'],
  ['BH-4', 'LAND', 7, 13, 'bottom', '02/12/60', '-7.30 M.'],
  ['BH-5', 'LAND', 8, 14, 'top',    '04/12/60', '-8.00 M.'],
  ['BH-6', 'LAND', 9, 14, 'bottom', '07/12/60', '-6.90 M.'],
  ['BH-7', 'RIVER', 10, 15, 'top',    '29/11/60', null],
  ['BH-8', 'RIVER', 11, 15, 'bottom', '05/12/60', null],
];

export const BOREHOLE_CATALOG = Object.freeze(sourceRows.map(
  ([id, environment, logPage, labPage, labPosition, date, observedWaterLevelText]) => Object.freeze({
    id,
    environment,
    logEnvironment: environment === 'LAND' ? 'ON LAND' : 'IN RIVER',
    sourceKey: 'S-CALC', sourceUrl, sourceSha256,
    logPage, labPage, labPosition,
    boringStartedText: date,
    boringFinishedText: date,
    laboratoryDateText: '12/2/2561',
    observedWaterLevelText,
    waterObservationTimingText: '24 Hrs. After Boring',
  }),
));

export const INVESTIGATION_SOURCE_NOTES = Object.freeze([
  'BH-1 ถึง BH-6 ระบุ LAND และ BH-7/BH-8 ระบุ RIVER ในเอกสารเดิม การมีรายการหลุมเจาะยังไม่ได้ยืนยันการจับคู่กับสถานี BOQ หรือชุดข้อมูลที่กำลังแก้',
  'วันที่เจาะคงข้อความปี 60 และวันที่ตารางผลทดสอบคง 12/2/2561 ตามต้นฉบับ ระบบไม่แปลงเป็นวันที่ปฏิทินหรือเวลาวัดน้ำใหม่ให้เอง',
  'ค่า W.L. เป็นข้อความสังเกตใน log เดิม พร้อมกำกับ 24 Hrs. After Boring ไม่ใช่ค่าระดับน้ำใต้ดินแบบสัมบูรณ์ที่แปลงเข้าระบบระดับของแบบแล้ว',
  'W.L. ของ BH-7 และ BH-8 ว่างในต้นฉบับ ช่องว่างคงเป็นข้อมูลที่ยังไม่ทราบ ไม่ใช้ศูนย์หรือระดับน้ำของหลุมอื่นแทน',
  'แกน DEPTH ของ log และช่วงลึกตัวอย่างต้องอ่านพร้อมจุดอ้างอิงของหลุมเจาะ ก่อนเชื่อมกับระบบระดับของแบบหรือความลึกแนวดิ่ง z ของโมดูลลาดอนันต์',
  'ตารางผลทดสอบเดิมระบุว่าตัวเลขในวงเล็บเป็นค่าประมาณ และแยกคอลัมน์ Qu/2, Torvane, UU Su, pocket penetrometer, SPT และ direct shear จึงไม่ใช้ค่าเหล่านี้แทนกันอัตโนมัติ',
  'ค่า c ที่รายงานในตารางพารามิเตอร์หน้า 16 ไม่ถูกตีความเป็น c′ หรือ Su ให้เอง การเลือกพารามิเตอร์ต้องมีฐานการทดสอบ สภาพระบายน้ำ และเหตุผลว่าตัวอย่างแทนชั้นดินของสถานีได้อย่างไร',
]);

/** Exact source identifier only; unknown or non-string values have no match. */
export function getBoreholeSource(id) {
  if (typeof id !== 'string') return null;
  return BOREHOLE_CATALOG.find(entry => entry.id === id) ?? null;
}
