import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProject, buildSection, projectRevision, quantityRows } from '../studio/core.js';
import { csvCell, projectJSON, parseProjectJSON, quantityCSV, surveyCSV, pileCSV, analysisCSV, sectionDXF, conceptMesh, sceneOBJ, triangulate } from '../studio/exports.js';
import { sectionSVG, profileSVG, alignmentSVG } from '../studio/drawings.js';

function straight(length = 100) {
  const p = createDemoProject();
  p.alignment = [{ x: 1000, y: 2000 }, { x: 1000 + length, y: 2000 }];
  p.survey = [0, length].flatMap((station) => [-20, 0, 10].map((offset) => ({ station, offset, elevation: 96 + (offset + 20) / 10 })));
  p.boreholes[0].toStation = length;
  p.boreholes[0].station = length / 2;
  p.selectedStation = length / 2;
  return p;
}

const near = (a, b, tol = 1e-5) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('JSON roundtrip preserves geometry, provenance, missing prices and external revision', () => {
  const p = straight();
  p.name = '<project & comparison>';
  p.analysis = [{ station: 0, case: 'construction', fs: 1.25, reference: 'Report A-05', revision: projectRevision(p) }];
  assert.deepEqual(parseProjectJSON(projectJSON(p)), p);
  assert.throws(() => parseProjectJSON('{broken'), /JSON/);
  assert.throws(() => parseProjectJSON(JSON.stringify({ ...p, geometry: {} })), /ไม่ถูกต้อง/);
});

test('CSV neutralizes formulas in text while preserving signed numeric measurements', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.test")'), '"\'=HYPERLINK(""https://example.test"")"');
  assert.equal(csvCell('  +SUM(A1:A2)'), '"\'  +SUM(A1:A2)"');
  assert.equal(csvCell(-25.5), '-25.5');
  assert.equal(csvCell(null), '""');
  const p = straight();
  p.sources.survey.name = '=source';
  assert.ok(surveyCSV(p).startsWith('\uFEFF'));
  assert.ok(surveyCSV(p).includes(',0,-20,') === false); // station is the first field, with no phantom column.
  assert.ok(surveyCSV(p).includes('0,-20,96,"\'=source"'));
  assert.ok(!quantityCSV(p).includes('NaN'));
  assert.ok(quantityCSV(p).includes(',"","","","",'));
});

test('pile coordinates follow the same count convention as takeoff, without a phantom end pile', () => {
  const p = straight(10);
  p.geometry.pileSpacing = 3;
  const rows = pileCSV(p).trim().split('\r\n');
  assert.equal(rows.length, 5); // header + station 0,3,6,9
  assert.equal(quantityRows(p).find((r) => r.code === 'PILE').quantity, 4);
  assert.ok(rows[1].includes(',0,1000,2000,'));
  assert.ok(rows[4].includes(',9,1009,2000,'));
});

test('DXF uses metre units, component layers, closed polygons and shared absolute elevation coordinates', () => {
  const p = straight(), dxf = sectionDXF(p, 50), section = buildSection(p, 50);
  assert.ok(dxf.includes('$INSUNITS\r\n70\r\n6\r\n'));
  assert.ok(dxf.endsWith('0\r\nEOF\r\n'));
  const parts = dxf.split('0\r\nLWPOLYLINE\r\n').slice(1);
  const cap = parts.find((s) => s.includes('8\r\nC_CAP\r\n'));
  assert.ok(cap.includes('90\r\n4\r\n70\r\n1\r\n'));
  for (const pt of section.polygons.find((s) => s.id === 'cap').points) {
    assert.ok(cap.includes(`10\r\n${pt.offset}\r\n20\r\n${Number(pt.elevation.toFixed(8))}\r\n`));
  }
  assert.ok(dxf.includes('CONCEPT / DRAFT - NOT FOR CONSTRUCTION'));
  assert.ok(!dxf.includes('NaN'));
});

test('section and plan maintain equal geometric axis scale and escape free text', () => {
  const p = straight();
  p.code = '<script>alert(1)</script>';
  for (const svg of [sectionSVG(p), alignmentSVG(p)]) {
    const sx = Number(svg.match(/data-scale-x="([^"]+)"/)[1]);
    const sy = Number(svg.match(/data-scale-y="([^"]+)"/)[1]);
    assert.equal(sx, sy);
    assert.ok(!svg.includes('<script>'));
  }
  assert.ok(sectionSVG(p).includes('&lt;script&gt;'));
  assert.ok(!profileSVG(p).includes('NaN'));
});

test('section absolute elevation labels preserve negative datums without a double sign', () => {
  const p = straight();
  p.geometry.crestLevel = -3;
  p.geometry.toeLevel = -7.6;
  p.water = { high: -4, low: -8, survey: -6, ground: -4.5 };
  p.survey.forEach((r) => { r.elevation -= 103.4; });
  p.boreholes.forEach((b) => b.layers.forEach((l) => { l.bottom -= 103.4; }));
  const svg = sectionSVG(p);
  assert.ok(svg.includes('>-3.00</text>'));
  assert.ok(svg.includes('>-7.60</text>'));
  assert.ok(!svg.includes('+-'));
  assert.ok(sectionSVG(straight()).includes('>+100.40</text>'));
});

function signedVolume(part) {
  let total = 0;
  // Translation keeps the independent volume calculation stable at absolute project coordinates.
  const origin = part.vertices[0], v = part.vertices.map((a) => a.map((x, i) => x - origin[i]));
  for (const face of part.faces) {
    for (let i = 1; i < face.length - 1; i++) {
      const a = v[face[0]], b = v[face[i]], c = v[face[i + 1]];
      total += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  }
  return total;
}

test('closed straight 3D cap and rock solids have hand-computable volumes matching takeoff', () => {
  const p = straight();
  const cap = conceptMesh(p).parts.find((v) => v.id === 'cap');
  near(signedVolume(cap), p.geometry.capWidth * p.geometry.capDepth * 100);
  p.geometry.type = 'T1-01';
  const rock = conceptMesh(p).parts.find((v) => v.id === 'rock');
  const independent = (p.geometry.crestLevel - p.geometry.toeLevel) * Math.hypot(1, p.geometry.slopeH) * p.geometry.rockThickness * 100;
  near(signedVolume(rock), independent);
  near(signedVolume(rock), quantityRows(p).find((v) => v.code === 'ROCK').quantity);
});

test('mesh preserves alignment vertices and only creates terrain inside observed survey coverage', () => {
  const p = straight();
  p.survey = p.survey.map((r) => ({ ...r, station: r.station === 0 ? 25 : 75 }));
  const mesh = conceptMesh(p);
  assert.ok(mesh.stations.includes(25) && mesh.stations.includes(75));
  const ground = mesh.parts.find((r) => r.layer === 'ground');
  assert.ok(ground.vertices.every((v) => v[0] >= 1025 && v[0] <= 1075));
  p.survey = [];
  assert.ok(!conceptMesh(p).parts.some((r) => r.layer === 'ground' || r.layer === 'water'));
});

test('analysis export retains missing results and reports stale external results after geometry changes', () => {
  const p = straight();
  p.analysis = [{ station: 0, case: 'construction', fs: 1.27, reference: 'External report', revision: projectRevision(p) }];
  assert.ok(analysisCSV(p).includes('1.27,"External report","current"'));
  assert.ok(analysisCSV(p).includes('"missing"'));
  p.geometry.capDepth += 0.1;
  assert.ok(analysisCSV(p).includes('1.27,"External report","stale"'));
});

test('OBJ reports Z-up metres, valid vertex indices and keeps absolute survey coordinates', () => {
  const obj = sceneOBJ(straight());
  assert.ok(obj.includes('Units: metres. Z-up.'));
  const lines = obj.trim().split('\n'), vertices = lines.filter((r) => r.startsWith('v '));
  assert.ok(vertices.length > 0 && vertices.some((r) => r.startsWith('v 1000 ')));
  assert.ok(vertices.every((r) => r.split(' ').slice(1).every((v) => Number.isFinite(Number(v)))));
  for (const face of lines.filter((r) => r.startsWith('f '))) {
    assert.ok(face.split(' ').slice(1).every((v) => Number(v) >= 1 && Number(v) <= vertices.length));
  }
});

test('concave cap triangulation preserves area rather than filling across a notch', () => {
  const points = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]];
  const area = triangulate(points).reduce((sum, f) => {
    const [a, b, c] = f.map((i) => points[i]);
    return sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }, 0);
  assert.equal(area, 5);
});
