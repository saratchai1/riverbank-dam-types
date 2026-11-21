import test from 'node:test';
import assert from 'node:assert/strict';
import {engineeringReportSections, mountEngineering} from '../projects/s6006/engineering-ui.js';
import {DEFAULT_BEAM_INPUTS, DEFAULT_SOIL_INPUTS, KSC_TO_MPA, calculateBeam, calculateSoil} from '../projects/s6006/engineering.js';

const clone = value => structuredClone(value);
const withoutSlope = ({slopeH, ...soil}) => soil;
const display = (value, digits = 3) => value.toLocaleString('en-US', {maximumFractionDigits:digits});
const baselineScenario = () => ({
  geometry:{slopeH:2.5}, beamInputs:clone(DEFAULT_BEAM_INPUTS),
  soilInputs:withoutSlope(DEFAULT_SOIL_INPUTS), context:{sourceNote:''},
});
const adequateBeam = () => ({...DEFAULT_BEAM_INPUTS,
  widthMm:300, heightMm:550, coverMm:30, stirrupDiameterMm:10,
  tensionBarDiameterMm:20, tensionBarCount:3,
  fcKsc:25/KSC_TO_MPA, fyKsc:400/KSC_TO_MPA, fyvKsc:250/KSC_TO_MPA,
  spanM:4, deadLoadFactor:1.2, externalMuKnM:100, externalVuKn:60,
});

test('standalone engineering report retains the reviewed R2 baseline and capacity gates', () => {
  const pages = engineeringReportSections();
  assert.equal(pages.length,6);
  assert.match(pages[0].body, /φMn ที่ใช้ตรวจ Mu<b>—<\/b>/);
  assert.match(pages[0].body, /As ต่ำกว่า As,min/);
  assert.match(pages[1].body, /34\.9658/);
  assert.match(pages[2].body, /31\.7664/);
  assert.match(pages[4].body, /1\.562173/);
  assert.match(pages[4].body, /0\.796189/);
  assert.match(pages[4].body, /C-22\/C-23\/C-27\/C-29/);
});

test('report uses current dimensions, materials, loads and soil while identifying original provenance separately', () => {
  const b = adequateBeam();
  const s = {...DEFAULT_SOIL_INPUTS, slopeH:3, verticalDepthM:4,
    unitWeightKnM3:18, saturatedUnitWeightKnM3:21, waterUnitWeightKnM3:10,
    frictionAngleDeg:35, effectiveCohesionKpa:5};
  const before = JSON.stringify({b,s});
  const pages = engineeringReportSections({beamInputs:b, soilInputs:s});
  const beam = calculateBeam(b), soil = calculateSoil(s);
  assert.match(pages[0].body, /ค่าที่ใช้ในสถานการณ์นี้/);
  assert.match(pages[0].body, /b = 300 mm; h = 550 mm/);
  assert.match(pages[0].body, /3Ø20 ด้านบนและด้านล่าง/);
  assert.match(pages[0].body, /ปลอก Ø10 @200 mm, 2 ขา/);
  assert.match(pages[0].body, /cover 30 mm/);
  assert.ok(pages[0].body.includes('fy = '+display(b.fyKsc)+' kgf/cm²'));
  assert.ok(pages[0].body.includes('φMn ที่ใช้ตรวจ Mu<b>'+display(beam.usablePhiMnKnM)));
  assert.doesNotMatch(pages[0].body, /ยังใช้ตรวจไม่ได้|เหล็กขั้นต่ำไม่ครบ/);
  assert.match(pages[0].body, /ข้อมูลอ้างอิงเดิม/);
  assert.match(pages[0].body, /BF1 250 × 500 mm/);
  for (const page of pages.slice(1,3)) {
    assert.match(page.body, /1\.2D/);
    assert.match(page.body, /Mu = 100 kN·m; Vu = 60 kN/);
    assert.doesNotMatch(page.body, /1\.4D|จริงเริ่มต้นเป็น null|ช่วงรองรับง่าย 3 ม\./);
  }
  assert.match(pages[3].body, /cover 30 mm และช่วงรองรับง่าย 4 m/);
  assert.doesNotMatch(pages[3].body, /cover 40 mm|ช่วงรองรับง่าย 3 m/);
  assert.match(pages[4].body, /ค่าปัจจุบัน: ลาด 3H:1V; z = 4 m/);
  assert.match(pages[4].body, /c′ = 5 kPa; φ′ = 35°/);
  assert.ok(pages[4].body.includes(display(soil.cases[0].factorOfSafety,6)));
  assert.ok(pages[4].body.includes(display(soil.cases[1].factorOfSafety,6)));
  assert.doesNotMatch(pages[5].body, /มีกรณี FS ต่ำกว่า 1/);
  assert.equal(JSON.stringify({b,s}),before,'Rendering cannot mutate accepted project inputs');
});

test('report gives the actual strain gate reason and mode-specific total-stress results', () => {
  const b = {...DEFAULT_BEAM_INPUTS, widthMm:800, heightMm:300,
    tensionBarDiameterMm:32, tensionBarCount:10};
  const s = {...DEFAULT_SOIL_INPUTS, slopeH:3, mode:'undrained', undrainedStrengthKpa:30};
  const pages = engineeringReportSections({beamInputs:b, soilInputs:s});
  assert.match(pages[0].body, /เหล็กดึงไม่ครากตามสมมติฐาน/);
  assert.doesNotMatch(pages[0].body, /As ต่ำกว่า As,min|เหล็กขั้นต่ำไม่ครบ/);
  assert.match(pages[4].body, /กำลังเฉือนดิน · Total stress/);
  assert.match(pages[4].body, /Su = 30 kPa/);
  assert.equal((pages[4].body.match(/<tbody><tr>/g) ?? []).length,1);
  assert.doesNotMatch(pages[4].body, /ลาดอนันต์: u=0|อิ่มตัวและน้ำซึมขนานลาด/);
  assert.match(pages[5].body, /Total stress ด้วย Su/);
  assert.doesNotMatch(pages[5].body, /สองเงื่อนไขน้ำ|1\.5622|0\.7962/);
});

test('report keeps missing Su explicit without throwing or substituting baseline soil results', () => {
  const pages = engineeringReportSections({beamInputs:DEFAULT_BEAM_INPUTS,
    soilInputs:{...DEFAULT_SOIL_INPUTS, mode:'undrained', undrainedStrengthKpa:null}});
  assert.equal(pages.length,6);
  for (const page of pages.slice(4)) {
    assert.match(page.body, /ยังไม่มี Su/);
    assert.doesNotMatch(page.body, /1\.562173|0\.796189|1\.5622|0\.7962/);
  }
});

// This fixture tests the shared-state controller contract, not browser layout.
class Element {
  innerHTML = '';
  textContent = '';
  value = '';
  hidden = false;
  listeners = new Map();
  children = new Map();
  classList = {toggle(){}};
  addEventListener(event, listener) { this.listeners.set(event,listener); }
  querySelector(selector) {
    assert.ok(this.children.has(selector),'Unexpected fixture selector: '+selector);
    return this.children.get(selector);
  }
  fire(event, details = {}) { return this.listeners.get(event)?.(details); }
}
function viewFixture() {
  const container = new Element();
  for (const id of ['beam-form','soil-form','beam-output','soil-output','engineering-notice','engineering-context','reset-beam','reset-soil','save-engineering']) {
    container.children.set('#'+id,new Element());
  }
  const soilForm = container.querySelector('#soil-form');
  soilForm.children.set('select',new Element());
  soilForm.children.set('.input-two',new Element());
  return container;
}
const valueFromMarkup = (element, key) => element.innerHTML.match(new RegExp('name="'+key+'"[^>]*value="([^"]*)"'))?.[1];

test('engineering view reads fresh accepted state, shares slope and refreshes after a station switch', async () => {
  let scenario = baselineScenario(), revision = 'r1', saves = 0;
  const changes = [], container = viewFixture();
  const view = mountEngineering(container, {
    getScenario:() => clone(scenario), getRevision:() => revision,
    onChange:(section,patch) => {
      changes.push({section,patch:clone(patch)});
      if (patch.coverMm === 500) throw new RangeError('cover ไม่ถูกต้อง');
      scenario = {...scenario,[section]:{...scenario[section],...patch}};
      revision = 'r2';
    },
    onSave:() => { saves++; },
  });
  const beamForm = container.querySelector('#beam-form'), soilForm = container.querySelector('#soil-form');
  soilForm.fire('change',{target:{name:'slopeH',value:'3'}});
  assert.deepEqual(changes.at(-1),{section:'geometry',patch:{slopeH:3}});
  assert.equal(Object.hasOwn(scenario.soilInputs,'slopeH'),false);
  assert.equal(valueFromMarkup(soilForm.querySelector('.input-two'),'slopeH'),'3');
  assert.match(container.querySelector('#engineering-context').textContent,/r2.*3H:1V/);

  scenario = {...scenario,beamInputs:adequateBeam(),geometry:{slopeH:4},context:{sourceNote:'สถานีทดสอบ'}};
  revision = 'station-b';
  view.render();
  assert.equal(valueFromMarkup(beamForm,'widthMm'),'300');
  assert.equal(valueFromMarkup(soilForm.querySelector('.input-two'),'slopeH'),'4');
  assert.match(container.querySelector('#engineering-context').textContent,/station-b.*สถานีทดสอบ/);
  beamForm.fire('change',{target:{name:'coverMm',value:'35'}});
  assert.deepEqual(changes.at(-1),{section:'beamInputs',patch:{coverMm:35}});
  assert.equal(scenario.beamInputs.widthMm,300,'An edit must not restore a previous station copy');

  beamForm.fire('change',{target:{name:'coverMm',value:'500'}});
  assert.equal(valueFromMarkup(beamForm,'coverMm'),'35');
  assert.match(container.querySelector('#engineering-notice').textContent,/ค่าคานไม่ถูกต้อง/);
  await container.querySelector('#save-engineering').fire('click');
  assert.equal(saves,1,'Unified project owner performs the save');
});

test('engineering reset touches only its shared section and incomplete Su removes stale results', () => {
  let scenario = baselineScenario();
  scenario.geometry.slopeH = 3;
  scenario.beamInputs.coverMm = 50;
  const changes = [], container = viewFixture();
  mountEngineering(container, {
    getScenario:() => clone(scenario), getRevision:() => 'r1', onSave(){},
    onChange:(section,patch) => {
      changes.push({section,patch:clone(patch)});
      scenario = {...scenario,[section]:{...scenario[section],...patch}};
    },
  });
  const soilForm = container.querySelector('#soil-form');
  soilForm.fire('change',{target:{name:'mode',value:'undrained'}});
  assert.equal(scenario.soilInputs.undrainedStrengthKpa,null);
  assert.doesNotMatch(container.querySelector('#soil-output').innerHTML,/id="soil-results"/);
  assert.match(container.querySelector('#soil-output').innerHTML,/ยังไม่มี Su/);
  assert.match(container.querySelector('#engineering-notice').textContent,/กรุณากรอก Su/);
  soilForm.fire('change',{target:{name:'undrainedStrengthKpa',value:'30'}});
  assert.match(container.querySelector('#soil-output').innerHTML,/id="soil-results"/);
  container.querySelector('#reset-soil').fire('click');
  assert.equal(changes.at(-1).section,'soilInputs');
  assert.equal(Object.hasOwn(changes.at(-1).patch,'slopeH'),false);
  assert.equal(scenario.geometry.slopeH,3);
  assert.equal(scenario.beamInputs.coverMm,50);
  assert.equal(scenario.soilInputs.mode,'effective');
  container.querySelector('#reset-beam').fire('click');
  assert.equal(changes.at(-1).section,'beamInputs');
  assert.equal(scenario.beamInputs.coverMm,40);
  assert.equal(scenario.geometry.slopeH,3);
});
