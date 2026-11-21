import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDemoProject, validateProject, lengthOf, pointAt, formatStation, parseStation,
  parseAlignmentCSV, parseSurveyCSV, parseSoilCSV, parseDxf, surveyStations,
  groundSection, buildSection, quantityRows, projectRevision, analysisRows,
  parseAnalysisCSV, escapeHTML
} from '../studio/core.js';

const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const demo = () => createDemoProject();
const csv = rows => rows.map(r => r.join(',')).join('\n');
const dxf = (entities, unit = 6, blocks = '') => [
  '0','SECTION','2','HEADER',...(unit === null ? [] : ['9','$INSUNITS','70',String(unit)]),'0','ENDSEC',
  ...(blocks ? ['0','SECTION','2','BLOCKS',blocks,'0','ENDSEC'] : []),
  '0','SECTION','2','ENTITIES',entities,'0','ENDSEC','0','EOF',''
].join('\n');
const line = (layer='ALIGNMENT') => ['0','LINE','8',layer,'10','0','20','0','30','0','11','3','21','4','31','0'].join('\n');
const polyline = (extra='') => ['0','LWPOLYLINE','8','BANK','90','3','70','0','10','0','20','0','10','3','20','4','10','10','20','4',extra].filter(Boolean).join('\n');
const soilHeaders = 'borehole,station,from_station,to_station,bottom,name,unit_weight,phi,cohesion,source\n';

test('demo is valid, independent per creation and clearly marked as unverified sample data', () => {
  const p = demo(), q = demo();
  assert.equal(validateProject(p).valid, true);
  assert.equal(p.sources.alignment.kind, 'demo');
  assert.equal(p.sources.survey.kind, 'demo');
  assert.equal(p.boreholes[0].verified, false);
  assert.ok(validateProject(p).warnings.some(x => x.includes('สาธิต')));
  close(lengthOf(p.alignment), 100);
  close(surveyStations(p).at(-1), lengthOf(p.alignment));
  p.geometry.deckWidth = 8;
  assert.equal(q.geometry.deckWidth, 3.7);
});

test('chainages handle decimals, carry at kilometre boundary and reject malformed input', () => {
  assert.equal(parseStation('1+025.125'), 1025.125);
  assert.equal(parseStation('25.25'), 25.25);
  assert.equal(formatStation(1025.125), '1+025.125');
  assert.equal(formatStation(999.9999), '1+000');
  assert.equal(formatStation(0), '0+000');
  for (const value of ['', ' ', '-1', '1+1000', '1+020+5', '1+020m', Infinity, null]) assert.throws(() => parseStation(value));
});

test('alignment length and local normal retain metre coordinates and use positive normal for land', () => {
  const points = [{x:100,y:200},{x:103,y:204},{x:106,y:204}];
  close(lengthOf(points), 8);
  assert.deepEqual(pointAt(points, 2.5), {x:101.5,y:202,nx:-0.8,ny:0.6});
  assert.deepEqual(pointAt(points, 7), {x:105,y:204,nx:0,ny:1});
  assert.deepEqual(pointAt(points, 100), {x:106,y:204,nx:0,ny:1});
  assert.ok(Number.isNaN(lengthOf([null,null])));
});

test('alignment CSV supports quoted fields, BOM, semicolons and exact aliases', () => {
  assert.deepEqual(parseAlignmentCSV('\ufeffindex;y;easting;note\n0;0;100;"first; point"\n1;4;103;"quoted ""note"""'), [{x:100,y:0},{x:103,y:4}]);
  assert.deepEqual(parseAlignmentCSV('x,y\n"0","0"\n"3","4"'), [{x:0,y:0},{x:3,y:4}]);
  assert.deepEqual(parseAlignmentCSV('x,y,note\n0,0,"first\nline"\n3,4,last'), [{x:0,y:0},{x:3,y:4}]);
});

test('alignment CSV never converts missing data to zero or silently filters corrupted rows', () => {
  for (const text of [
    'x,y\n,2\n3,4', 'x,y\n0,0\n3,not-number', 'x,y\n0,0\n3',
    'x,y\n0,0\n0,0', 'index,y\n0,0\n3,4', 'x,easting,y\n0,0,0\n3,3,4',
    'x,y\n0,0\n"3,4', 'x,y\n0,0\n"3"junk,4'
  ]) assert.throws(() => parseAlignmentCSV(text), undefined, text);
});

test('survey CSV is station+offset+elevation, sorts rows and distinguishes bedlevel from elevation', () => {
  const rows = parseSurveyCSV('station,offset,bedlevel,ground\n0+025,5,77,0\n0+000,-5,77,-2\n0+025,-5,77,2\n0+000,5,77,0');
  assert.deepEqual(rows, [{station:0,offset:-5,elevation:-2},{station:0,offset:5,elevation:0},{station:25,offset:-5,elevation:2},{station:25,offset:5,elevation:0}]);
  for (const bad of [
    'station,offset,elevation\n0,0,1\n0,0,2\n25,0,3\n25,5,3',
    'station,offset,elevation\n0,0,1\n0,5,2\n0,10,3\n25,5,3',
    'station,offset,elevation\n0,0,\n0,5,2\n25,0,3\n25,5,3'
  ]) assert.throws(() => parseSurveyCSV(bad));
});

test('soil CSV preserves descending layer order and explicit source; never marks imports verified', () => {
  const rows = parseSoilCSV(soilHeaders + 'BH-1,25,0,50,91,"Sand, silty",18,30,0,Report A\nBH-1,25,0,50,80,Clay,17,0,25,Report A');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verified, false);
  assert.equal(rows[0].layers[0].name, 'Sand, silty');
  assert.deepEqual(rows[0].layers.map(x => x.bottom), [91,80]);
  assert.throws(() => parseSoilCSV(soilHeaders + 'BH-1,25,0,50,91,Sand,18,30,0,R\nBH-1,25,0,50,92,Clay,17,0,25,R'));
  assert.throws(() => parseSoilCSV(soilHeaders + 'BH-1,25,0,50,91,Sand,18,30,0,R\nBH-1,30,0,50,80,Clay,17,0,25,R'));
  assert.throws(() => parseSoilCSV(soilHeaders + 'BH-1,25,0,50,91,Sand,18,30,0,'));
});

test('DXF reads LINE endpoints and returns all paths instead of selecting longest', () => {
  const result = parseDxf(dxf(line() + '\n' + polyline()));
  assert.equal(result.units, 'metres');
  assert.equal(result.paths.length, 2);
  assert.equal(result.paths[0].layer, 'ALIGNMENT');
  close(lengthOf(result.paths[0].points), 5);
  assert.equal(result.paths[1].layer, 'BANK');
  assert.equal(result.warnings.length, 0);
});

test('DXF reads only ENTITIES and accepts ordinary legacy 2D POLYLINE', () => {
  const legacy = ['0','POLYLINE','8','OLD','66','1','70','0','0','VERTEX','10','0','20','0','30','0','0','VERTEX','10','3','20','4','30','0','0','SEQEND'].join('\n');
  const result = parseDxf(dxf(legacy, 6, line('BLOCK-ONLY')));
  assert.equal(result.paths.length, 1);
  assert.equal(result.paths[0].layer, 'OLD');
  close(lengthOf(result.paths[0].points), 5);
});

test('DXF rejects non-metre units and warns before accepting unspecified units', () => {
  assert.throws(() => parseDxf(dxf(line(), 4)), /INSUNITS=4/);
  for (const unit of [null,0]) {
    const result = parseDxf(dxf(line(), unit));
    assert.equal(result.units, 'unspecified');
    assert.ok(result.warnings.some(x => x.includes('ยืนยัน')));
  }
});

test('DXF cannot silently flatten curves, closed paths or non-XY geometry', () => {
  const cases = [polyline('42\n0.5'), polyline().replace('70\n0','70\n1'), polyline('210\n1\n220\n0\n230\n0'), line().replace('31\n0','31\n2')];
  for (const bad of cases) {
    assert.throws(() => parseDxf(dxf(bad)));
    const result = parseDxf(dxf(bad + '\n' + line('VALID')));
    assert.equal(result.paths.length, 1);
    assert.ok(result.warnings.length > 0);
  }
  assert.throws(() => parseDxf('AutoCAD Binary DXF\u0000'));
});

test('ground interpolation respects coverage and zero levels without extrapolation or invented terrain', () => {
  const p = demo();
  p.survey = [{station:10,offset:-5,elevation:0},{station:10,offset:5,elevation:10},{station:30,offset:0,elevation:10},{station:30,offset:10,elevation:20}];
  assert.deepEqual(groundSection(p, 10), [{offset:-5,elevation:0},{offset:5,elevation:10}]);
  assert.deepEqual(groundSection(p, 20), [{offset:0,elevation:7.5},{offset:5,elevation:12.5}]);
  assert.deepEqual(groundSection(p, 0), []);
  assert.deepEqual(groundSection(p, 40), []);
  p.survey = [];
  assert.deepEqual(groundSection(p, 0), []);
});

test('T3 quantities use the same exact polygon dimensions and one pile row', () => {
  const p = demo(), g = p.geometry, L = lengthOf(p.alignment), s = buildSection(p, 25);
  const q = Object.fromEntries(quantityRows(p).map(r => [r.code,r]));
  assert.deepEqual(s.polygons.map(x => x.id), ['cap','deck','panel']);
  close(q.CAP.quantity, g.capWidth * g.capDepth * L);
  close(q.DECK.quantity, g.deckWidth * g.deckThickness * L);
  close(q.PANEL.quantity, g.panelThickness * (g.crestLevel - g.capDepth - g.toeLevel) * L);
  assert.equal(q.PILE.quantity, 101);
  assert.equal(s.piles.length, 1);
  close(s.piles[0].top.elevation, g.crestLevel - g.capDepth);
  close(s.piles[0].top.elevation - s.piles[0].bottom.elevation, g.pileLength);
  assert.ok(quantityRows(p).every(r => r.amount === null));
  assert.ok(!quantityRows(p).some(r => /rebar|excavation/.test(r.code)));
});

test('pile counts include last point only when grid lands there; counts and lengths are distinct', () => {
  const p = demo();p.geometry.pileSpacing = 3;
  p.alignment = [{x:0,y:0},{x:10,y:0}];
  assert.equal(quantityRows(p).find(r => r.code === 'PILE').quantity, 4);
  p.alignment[1].x = 9;
  assert.equal(quantityRows(p).find(r => r.code === 'PILE').quantity, 4);
});

test('T1 slope volume uses normal thickness, shared toe and no invented terrain fill', () => {
  const p = demo();p.geometry.type = 'T1-01';
  const g=p.geometry,L=lengthOf(p.alignment),s=buildSection(p,0),q=Object.fromEntries(quantityRows(p).map(r=>[r.code,r]));
  const slopeLength=(g.crestLevel-g.toeLevel)*Math.hypot(1,g.slopeH);
  close(q.ROCK.quantity,slopeLength*g.rockThickness*L);
  close(q.FILTER.quantity,slopeLength*g.filterThickness*L);
  close(q.TOE.quantity,g.toeWidth*g.toeHeight*L);
  close(s.polygons.find(x=>x.id==='rock').points[0].offset,-(g.crestLevel-g.toeLevel)*g.slopeH);
  assert.equal(s.piles.length,0);
  assert.deepEqual(Object.keys(q),['ROCK','FILTER','TOE','CAP']);
});

test('missing rates remain null; explicit zero is distinct and full rates produce known amounts', () => {
  const p=demo();
  p.prices.CAP={material:100,labour:null,source:'Supplier'};
  assert.equal(quantityRows(p).find(r=>r.code==='CAP').amount,null);
  p.prices.CAP.labour=0;
  close(quantityRows(p).find(r=>r.code==='CAP').amount,7200);
  p.prices.CAP.material=0;
  assert.equal(quantityRows(p).find(r=>r.code==='CAP').amount,0);
  p.prices.CAP.material=-1;
  assert.equal(validateProject(p).valid,false);
});

test('project validation is total and rejects malformed, missing and physically impossible geometry', () => {
  for(const value of [null,[],{},true,{schemaVersion:1,alignment:[null,null]}]) assert.doesNotThrow(()=>validateProject(value));
  for(const mutate of [
    p=>p.alignment=[null,null],p=>p.alignment=[{x:0,y:0},{x:0,y:0}],p=>delete p.geometry.capDepth,
    p=>p.geometry.pileSpacing=0,p=>p.geometry.type='other',p=>p.geometry.toeLevel=p.geometry.crestLevel,
    p=>p.geometry.capWidth=.1,p=>p.geometry.deckThickness=2,p=>p.water.high=NaN,
    p=>p.geometry.rockThickness=-1,p=>p.selectedStation=101,p=>p.prices.CAP.material=Infinity,
    p=>p.survey[0].elevation=null,p=>p.boreholes[0].layers[1].bottom=99,p=>p.boreholes[0].verified='false'
  ]) {const p=demo();mutate(p);assert.equal(validateProject(p).valid,false);}
  const p=demo();p.survey=[];p.boreholes=[];
  assert.equal(validateProject(p).valid,true);
  assert.ok(validateProject(p).warnings.length>=2);
});

test('revision is stable under object order and presentation changes, changes with all engineering inputs', () => {
  const p=demo(),revision=projectRevision(p);
  p.name='Renamed';p.code='NEW';p.prices.CAP.material=100;p.selectedStation=25;p.notes='changed';p.analysis=[];
  p.geometry=Object.fromEntries(Object.entries(p.geometry).reverse());p.survey.reverse();
  assert.equal(projectRevision(p),revision);
  for(const mutate of [q=>q.geometry.pileLength+=1,q=>q.water.high+=1,q=>q.survey[0].elevation+=1,q=>q.alignment[0].x+=1,q=>q.boreholes[0].layers[0].phi+=1]) {
    const q=demo();mutate(q);assert.notEqual(projectRevision(q),revision);
  }
});

test('external FS remains missing until imported and becomes stale after engineering edits', () => {
  const p=demo();
  assert.equal(analysisRows(p).length,15);
  assert.ok(analysisRows(p).every(r=>r.fs===null&&r.status==='missing'));
  p.analysis=parseAnalysisCSV('station,case,fs,reference\n0+025,construction,1.234,External report A',p);
  assert.equal(analysisRows(p).find(r=>r.station===25&&r.case==='construction').status,'current');
  p.prices.CAP.material=200;
  assert.equal(analysisRows(p).find(r=>r.station===25&&r.case==='construction').status,'current');
  p.geometry.pileLength+=1;
  const entry=analysisRows(p).find(r=>r.station===25&&r.case==='construction');
  assert.equal(entry.status,'stale');assert.equal(entry.fs,1.234);
  assert.ok(!('pass' in entry));
});

test('analysis CSV requires supported station/case, positive FS, unique rows and traceable reference', () => {
  const p=demo(),head='station,case,fs,reference\n';
  for(const tail of ['23,construction,1.5,R','25,normal,1.5,R','25,construction,0,R','25,construction,1.5,','25,construction,1.5,R\n25,construction,1.6,R']) assert.throws(()=>parseAnalysisCSV(head+tail,p));
  p.survey=[];
  assert.equal(analysisRows(p).length,6);
});

test('exported stale result metadata cannot be relabelled current by importing it again', () => {
  const p=demo(),oldRevision=projectRevision(p);
  const row=`station,case,fs,reference,status,result_revision\n25,construction,1.25,External report A,current,${oldRevision}`;
  assert.equal(parseAnalysisCSV(row,p)[0].revision,oldRevision);
  p.geometry.pileLength+=1;
  assert.throws(()=>parseAnalysisCSV(row,p),/result_revision/);
  assert.throws(()=>parseAnalysisCSV(`station,case,fs,reference,status\n25,construction,1.25,R,stale`,p),/stale/);
  assert.equal(parseAnalysisCSV('station,case,fs,reference\n25,construction,1.30,New analysis report B',p)[0].revision,projectRevision(p));
});

test('project import rejects reserved prototype keys and excessive optional nesting', () => {
  const text=JSON.stringify(demo());
  const dangerous=JSON.parse(text.slice(0,-1)+',"__proto__":{"unexpected":true}}');
  assert.equal(validateProject(dangerous).valid,false);
  const p=demo();p.geometry.extra=JSON.parse('{"constructor":{"prototype":{"polluted":true}}}');
  assert.equal(validateProject(p).valid,false);
  const q=demo();let cursor=q;
  for(let i=0;i<40;i++){cursor.extra={};cursor=cursor.extra;}
  assert.equal(validateProject(q).valid,false);
  assert.equal({}.polluted,undefined);
});

test('quantity assumptions disclose reference alignment and curve limitations', () => {
  const p=demo();
  assert.ok(validateProject(p).warnings.some(w=>w.includes('หักมุม')));
  assert.ok(quantityRows(p).filter(r=>r.unit==='ม³').every(r=>r.assumption.includes('แนวเยื้อง')));
});

test('HTML escaping treats user text as text', () => {
  assert.equal(escapeHTML('<img src="x" onerror=alert(1)>&\''),'&lt;img src=&quot;x&quot; onerror=alert(1)&gt;&amp;&#39;');
});
