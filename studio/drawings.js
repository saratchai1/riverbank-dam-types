import { buildSection, lengthOf, pointAt, groundSection, surveyStations, formatStation } from './core.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v, digits = 2) => Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const levelLabel = (v) => `${v >= 0 ? '+' : ''}${n(v)}`;
const f = (v) => Number(v.toFixed(3));
const line = (x1, y1, x2, y2, attrs = '') => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ${attrs}/>`;
const text = (x, y, value, attrs = '') => `<text x="${f(x)}" y="${f(y)}" ${attrs}>${esc(value)}</text>`;
const niceStep = (range, count = 8) => {
  const raw = range / count, ten = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 5, 10].find((v) => v * ten >= raw) * ten;
};
const ticks = (lo, hi, step) => {
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-7; v += step) out.push(v);
  return out;
};
function svgStart(width, height, label, extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" ${extra}>
<style>text{font-family:Tahoma,'Noto Sans Thai',sans-serif;font-size:11px;fill:#526974} .title{font-size:15px;font-weight:700;fill:#173a4b} .mono{font-family:ui-monospace,monospace} .note{font-size:10px;fill:#7b693d} .grid{stroke:#e2e9e8;stroke-width:1} .axis{stroke:#bccbcd;stroke-width:1} .water{fill:none;stroke-width:1.4} .dim{fill:none;stroke:#687f85;stroke-width:1}</style>
<rect width="${width}" height="${height}" fill="#f7faf9"/>`;
}

export function sectionSVG(p, station = p.selectedStation, { width = 1000, height = 500 } = {}) {
  const section = buildSection(p, station);
  const pilePolygons = section.piles.map((pile) => ({
    ...pile, color: '#859aa2', points: [
      { offset: pile.top.offset - pile.size / 2, elevation: pile.top.elevation },
      { offset: pile.top.offset + pile.size / 2, elevation: pile.top.elevation },
      { offset: pile.bottom.offset + pile.size / 2, elevation: pile.bottom.elevation },
      { offset: pile.bottom.offset - pile.size / 2, elevation: pile.bottom.elevation },
    ],
  }));
  const points = [...section.polygons.flatMap((v) => v.points), ...pilePolygons.flatMap((v) => v.points), ...section.ground];
  const loX = Math.min(-5, ...points.map((v) => v.offset)) - 1.5;
  const hiX = Math.max(5, ...points.map((v) => v.offset)) + 1.5;
  const loY = Math.min(p.water.low, ...points.map((v) => v.elevation)) - 1;
  const hiY = Math.max(p.geometry.crestLevel, p.water.high, ...points.map((v) => v.elevation)) + 2;
  const plot = { x: 62, y: 75, w: width - 172, h: height - 150 };
  const scale = Math.min(plot.w / (hiX - loX), plot.h / (hiY - loY));
  const xPad = (plot.w - (hiX - loX) * scale) / 2, yPad = (plot.h - (hiY - loY) * scale) / 2;
  const X = (x) => plot.x + xPad + (x - loX) * scale;
  const Y = (z) => plot.y + yPad + (hiY - z) * scale;
  const out = [svgStart(width, height, `รูปตัด STA ${formatStation(station)}`, `data-units="m" data-scale-x="${scale}" data-scale-y="${scale}"`),
    '<defs><pattern id="section-ground-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="9" stroke="#b7bea7" stroke-width="1"/></pattern></defs>',
    text(20, 27, `รูปตัด  STA ${formatStation(station)}`, 'class="title"'),
    text(width - 20, 25, `${p.geometry.type} · ${p.code}`, 'text-anchor="end" class="mono"'),
    text(20, 47, 'รูปทรงแนวคิด · มาตราส่วนแกน X/Y เท่ากัน · ระดับและระยะเป็นเมตร'),
  ];
  const stepX = niceStep(hiX - loX, 9), stepY = niceStep(hiY - loY, 7);
  ticks(loX, hiX, stepX).forEach((v) => {
    out.push(line(X(v), Y(loY), X(v), Y(hiY), 'class="grid"'));
    out.push(text(X(v), Y(loY) + 15, n(v, Number.isInteger(stepX) ? 0 : 1), 'text-anchor="middle" class="mono"'));
  });
  ticks(loY, hiY, stepY).forEach((v) => {
    out.push(line(X(loX), Y(v), X(hiX), Y(v), 'class="grid"'));
    out.push(text(X(loX) - 8, Y(v) + 4, n(v, Number.isInteger(stepY) ? 0 : 1), 'text-anchor="end" class="mono"'));
  });
  out.push(text(X(loX) - 8, Y(hiY) - 10, 'ระดับ (ม.)', 'text-anchor="end"'));
  out.push(text(X(hiX), Y(loY) + 30, 'ระยะจากแนวเขื่อน (ม.)', 'text-anchor="end"'));
  if (section.ground.length) {
    const g = section.ground;
    const fill = [...g, { offset: g.at(-1).offset, elevation: loY }, { offset: g[0].offset, elevation: loY }];
    out.push(`<polygon points="${fill.map((v) => `${f(X(v.offset))},${f(Y(v.elevation))}`).join(' ')}" fill="#dfe3d1" fill-opacity=".35"/>`);
    out.push(`<polygon points="${fill.map((v) => `${f(X(v.offset))},${f(Y(v.elevation))}`).join(' ')}" fill="url(#section-ground-hatch)" opacity=".45"/>`);
    out.push(`<polyline points="${g.map((v) => `${f(X(v.offset))},${f(Y(v.elevation))}`).join(' ')}" fill="none" stroke="#7a8f5d" stroke-width="2.2"/>`);
  } else {
    out.push(text(X(loX) + 6, Y(hiY) + 18, 'ยังไม่มีรูปตัดสำรวจที่ครอบคลุมสถานีนี้', 'class="note"'));
  }
  for (const [level, color, dash] of [[p.water.high, '#4d8fa7', '7 4'], [p.water.low, '#7eabc0', '3 4'], [p.water.survey, '#287ba2', '']]) {
    out.push(line(X(loX), Y(level), X(0), Y(level), `class="water" stroke="${color}" stroke-dasharray="${dash}"`));
  }
  for (const shape of [...section.polygons, ...pilePolygons]) {
    out.push(`<polygon data-component="${esc(shape.id)}" points="${shape.points.map((v) => `${f(X(v.offset))},${f(Y(v.elevation))}`).join(' ')}" fill="${esc(shape.color || '#c1cac9')}" stroke="#435c67" stroke-width="1.2"><title>${esc(shape.name)}</title></polygon>`);
  }
  out.push(line(X(0), Y(loY), X(0), Y(hiY), 'stroke="#b18c43" stroke-width="1" stroke-dasharray="3 5"'));
  // Height/deck dimensions share the drawing transform; no arbitrary screen offsets change geometry.
  const dimensionX = X(hiX) + 20;
  const top = p.geometry.crestLevel, toe = p.geometry.toeLevel;
  out.push(line(dimensionX, Y(top), dimensionX, Y(toe), 'class="dim"'));
  for (const level of [top, toe]) out.push(line(dimensionX - 4, Y(level), dimensionX + 4, Y(level), 'class="dim"'));
  out.push(text(dimensionX + 7, (Y(top) + Y(toe)) / 2 - 4, `H ${n(top - toe)} m`, 'class="mono"'));
  out.push(text(dimensionX + 7, Y(top) + 4, levelLabel(top), 'class="mono"'));
  out.push(text(dimensionX + 7, Y(toe) + 4, levelLabel(toe), 'class="mono"'));
  const dimensionShape = section.polygons.find((v) => v.id === 'deck') || section.polygons.find((v) => v.id === 'cap');
  if (dimensionShape) {
    const left = Math.min(...dimensionShape.points.map((v) => v.offset)), right = Math.max(...dimensionShape.points.map((v) => v.offset));
    const dimY = Y(top) - 15;
    out.push(line(X(left), dimY, X(right), dimY, 'class="dim"'));
    out.push(line(X(left), dimY - 4, X(left), dimY + 4, 'class="dim"'));
    out.push(line(X(right), dimY - 4, X(right), dimY + 4, 'class="dim"'));
    out.push(text((X(left) + X(right)) / 2, dimY - 6, `${n(right - left)} m`, 'text-anchor="middle" class="mono"'));
  }
  if (p.geometry.type === 'T1-01') {
    const x = -(top - toe) * p.geometry.slopeH / 2;
    out.push(text(X(x), Y((top + toe) / 2) - 13, `ลาด 1 : ${n(p.geometry.slopeH, 1)}`, 'text-anchor="middle"'));
  }
  const legends = [['#7a8f5d', 'ดินสำรวจ'], ['#435c67', 'โครงสร้างแนวคิด'], ['#4d8fa7', `น้ำสูง ${n(p.water.high)}`], ['#7eabc0', `น้ำต่ำ ${n(p.water.low)}`], ['#287ba2', `น้ำสำรวจ ${n(p.water.survey)}`]];
  legends.forEach(([color, label], i) => {
    const x = 20 + i * Math.min(167, (width - 40) / 5);
    out.push(line(x, height - 28, x + 13, height - 28, `stroke="${color}" stroke-width="2"`));
    out.push(text(x + 18, height - 24, label));
  });
  out.push(text(20, height - 8, 'ร่าง · ยังไม่ได้ยืนยันเสถียรภาพ · แสดงเฉพาะองค์ประกอบแนวคิด ไม่ใช่แบบก่อสร้าง', 'class="note"'));
  return out.join('\n') + '</svg>';
}

export function profileSVG(p, { width = 1000, height = 220 } = {}) {
  const L = lengthOf(p.alignment), stations = surveyStations(p);
  const samples = stations.map((station) => ({ station, elevation: atOffsetZero(groundSection(p, station)) }));
  const valid = samples.filter((r) => r.elevation !== null);
  const minZ = Math.min(p.water.low, p.geometry.toeLevel, ...valid.map((r) => r.elevation)) - 1;
  const maxZ = Math.max(p.water.high, p.geometry.crestLevel, ...valid.map((r) => r.elevation)) + 1;
  const plot = { x: 58, y: 40, w: width - 85, h: height - 83 };
  const X = (x) => plot.x + x / L * plot.w, Y = (z) => plot.y + (maxZ - z) / (maxZ - minZ) * plot.h;
  const out = [svgStart(width, height, 'รูปตัดตามยาว แนวเขื่อน'), text(18, 23, 'รูปตัดตามยาวที่ Offset 0', 'class="title"'),
    text(width - 20, 22, 'แกนระดับขยายเพื่ออ่านกราฟ · หน่วย m', 'text-anchor="end"')];
  ticks(minZ, maxZ, niceStep(maxZ - minZ, 4)).forEach((z) => {
    out.push(line(X(0), Y(z), X(L), Y(z), 'class="grid"'), text(plot.x - 8, Y(z) + 4, n(z, 1), 'text-anchor="end" class="mono"'));
  });
  ticks(0, L, niceStep(L, 6)).forEach((station) => {
    out.push(line(X(station), plot.y, X(station), plot.y + plot.h, 'class="grid"'), text(X(station), height - 22, formatStation(station), 'text-anchor="middle" class="mono"'));
  });
  out.push(line(X(0), Y(p.geometry.crestLevel), X(L), Y(p.geometry.crestLevel), 'stroke="#4a6977" stroke-width="2"'));
  out.push(line(X(0), Y(p.water.high), X(L), Y(p.water.high), 'stroke="#74a6ba" stroke-width="1.3" stroke-dasharray="6 4"'));
  // Adjacent observations are connected only when both actually contain offset zero.
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (a.elevation === null || b.elevation === null) continue;
    out.push(line(X(a.station), Y(a.elevation), X(b.station), Y(b.elevation), 'stroke="#7a8f5d" stroke-width="2.3"'));
  }
  valid.forEach((r) => out.push(`<circle cx="${f(X(r.station))}" cy="${f(Y(r.elevation))}" r="2.5" fill="#7a8f5d"/>`));
  out.push(line(X(p.selectedStation), plot.y, X(p.selectedStation), plot.y + plot.h, 'stroke="#b88b3a" stroke-width="1.7"'));
  out.push(text(X(p.selectedStation), plot.y + 12, `STA ${formatStation(p.selectedStation)}`, 'text-anchor="middle" fill="#9a742c"'));
  if (!valid.length) out.push(text(width / 2, height / 2, 'ยังไม่มีสำรวจที่ครอบคลุม Offset 0', 'text-anchor="middle" class="note"'));
  out.push(text(18, height - 6, 'เส้นเขียว: ดินสำรวจ / เทา: สันเขื่อน / ฟ้าประ: น้ำสูง / ส้ม: สถานีที่เลือก', 'font-size="10"'));
  return out.join('\n') + '</svg>';
}

function atOffsetZero(profile) {
  if (!profile.length || profile[0].offset > 0 || profile.at(-1).offset < 0) return null;
  const exact = profile.find((v) => v.offset === 0);
  if (exact) return exact.elevation;
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i];
    if (a.offset <= 0 && b.offset >= 0) return a.elevation + (b.elevation - a.elevation) * -a.offset / (b.offset - a.offset);
  }
  return null;
}

export function alignmentSVG(p, { width = 1000, height = 300 } = {}) {
  const pts = p.alignment, L = lengthOf(pts);
  const minX = Math.min(...pts.map((v) => v.x)), maxX = Math.max(...pts.map((v) => v.x));
  const minY = Math.min(...pts.map((v) => v.y)), maxY = Math.max(...pts.map((v) => v.y));
  const w = Math.max(maxX - minX, 30), h = Math.max(maxY - minY, 30);
  const scale = Math.min((width - 150) / w, (height - 100) / h);
  const X = (x) => width / 2 + (x - (minX + maxX) / 2) * scale;
  const Y = (y) => height / 2 + 8 - (y - (minY + maxY) / 2) * scale;
  const out = [svgStart(width, height, 'แปลนแนวเขื่อน', `data-units="m" data-scale-x="${scale}" data-scale-y="${scale}"`),
    text(20, 26, 'แนวเขื่อนและสถานีสำรวจ', 'class="title"'), text(width - 20, 24, `${n(L)} m`, 'text-anchor="end" class="mono"'),
    `<path d="${pts.map((v, i) => `${i ? 'L' : 'M'}${f(X(v.x))},${f(Y(v.y))}`).join(' ')}" fill="none" stroke="#1c717b" stroke-width="3" stroke-linejoin="round"/>`];
  const stations = surveyStations(p).filter((v) => v >= 0 && v <= L);
  const stride = Math.max(1, Math.ceil(stations.length / 12));
  stations.forEach((station, i) => {
    const at = pointAt(pts, station), reach = 8 / scale;
    out.push(line(X(at.x - at.nx * reach), Y(at.y - at.ny * reach), X(at.x + at.nx * reach), Y(at.y + at.ny * reach), 'stroke="#829e9f" stroke-width="1"'));
    if (i % stride === 0) out.push(text(X(at.x) + 4, Y(at.y) + 23, formatStation(station), 'class="mono"'));
  });
  const at = pointAt(pts, p.selectedStation);
  out.push(`<circle cx="${f(X(at.x))}" cy="${f(Y(at.y))}" r="6" fill="#c3903e" stroke="#fff" stroke-width="2"/>`);
  out.push(text(X(at.x), Y(at.y) - 15, `STA ${formatStation(p.selectedStation)}`, 'text-anchor="middle" fill="#98703a" font-weight="700"'));
  out.push(line(width - 40, height - 39, width - 40, height - 70, 'stroke="#526974" stroke-width="1.5"'));
  out.push(`<path d="M${width - 44},${height - 63} L${width - 40},${height - 74} L${width - 36},${height - 63}" fill="none" stroke="#526974"/>`);
  out.push(text(width - 40, height - 79, 'N', 'text-anchor="middle" class="mono"'));
  out.push(text(20, height - 15, `${p.sources.alignment.kind === 'demo' ? 'ข้อมูลสาธิต' : 'พิกัดนำเข้า'} · ${p.sources.alignment.name} · ไม่มีแผนที่ฐาน`, 'class="note"'));
  return out.join('\n') + '</svg>';
}
