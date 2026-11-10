import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  const response=await page.goto(process.argv[2] ?? 'http://127.0.0.1:5173',{waitUntil:'networkidle'});assert.equal(response.status(),200);
  await page.waitForFunction(()=>window.__PHO_FLOW__?.snapshot().vehicles>3);
  await page.screenshot({path:'test-results/desktop.png',fullPage:true});
  await page.click('#play-pause');const paused=await page.evaluate(()=>window.__PHO_FLOW__.snapshot());assert.equal(paused.paused,true);
  await page.waitForTimeout(250);assert.equal((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).time,paused.time);
  await page.click('#tab-traffic');assert.equal(await page.locator('#traffic-panel').isVisible(),true);
  await page.locator('#density').fill('75');await page.locator('#density').dispatchEvent('input');assert.equal(await page.locator('#density-value').textContent(),'75');
  await page.check('#show-directions');assert.equal(await page.locator('#directions-legend').isVisible(),true);
  await page.waitForTimeout(100);await page.screenshot({path:'test-results/directions.png'});
  await page.uncheck('#show-directions');assert.equal(await page.locator('#directions-legend').isVisible(),false);
  // Select actual rendered vehicles using map clicks, with all-directions initially enabled.
  await page.click('#camera-top');await page.waitForTimeout(200);
  const map=await page.locator('#city-canvas').boundingBox();
  async function chooseVehicle(exclude=null){
    const vehicles=await page.evaluate(()=>window.__PHO_FLOW__.simulation.vehicles.map(v=>({id:v.id,x:v.pose.x,z:v.pose.z})));
    for(const v of vehicles.filter(v=>v.id!==exclude)){
      const x=map.x+map.width/2+v.x*map.height/190,y=map.y+map.height/2+(v.z-3)*map.height/190;
      if(!await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id==='city-canvas',{x,y}))continue;
      await page.mouse.click(x,y);
      if((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).selectedVehicleId===v.id)return v.id;
    }
    throw Error('No visible vehicle could be selected by clicking its map position');
  }
  await page.check('#show-directions');const firstSelected=await chooseVehicle();
  await page.waitForFunction(id=>{const s=window.__PHO_FLOW__.snapshot();return s.directionVehicleIds.length===1&&s.directionVehicleIds[0]===id;},firstSelected);
  assert.equal(await page.locator('#show-directions').isChecked(),false);assert.equal(await page.locator('#vehicle-inspector').isVisible(),true);
  await page.screenshot({path:'test-results/selected-vehicle.png'});
  const secondSelected=await chooseVehicle(firstSelected);assert.notEqual(secondSelected,firstSelected);
  await page.waitForFunction(id=>window.__PHO_FLOW__.snapshot().directionVehicleIds[0]===id,secondSelected);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__PHO_FLOW__.snapshot().selectedVehicleId===null);
  assert.equal(await page.locator('#vehicle-inspector').isVisible(),false);
  await chooseVehicle();await page.click('#clear-vehicle');assert.equal((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).selectedVehicleId,null);
  await chooseVehicle();await page.check('#show-directions');
  await page.waitForFunction(()=>{const s=window.__PHO_FLOW__.snapshot();return s.selectedVehicleId===null&&s.directionVehicleIds.length===s.vehicles;});
  await page.uncheck('#show-directions');await chooseVehicle();
  await page.mouse.click(map.x+map.width/2-100*map.height/190,map.y+map.height/2+72*map.height/190);
  assert.equal((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).selectedVehicleId,null);
  await page.click('#camera-home');
  await page.check('#debug');await page.click('#day-night');await page.screenshot({path:'test-results/night.png'});await page.click('#day-night');
  await page.click('#tab-build');await page.click('[data-tool=curve]');assert.equal(await page.locator('#drawing-banner').isVisible(),true);await page.keyboard.press('Escape');
  await page.click('#tab-traffic');
  assert.equal(await page.locator('#driving-side').inputValue(),'right');
  await page.selectOption('#driving-side','left');
  let sideState=await page.evaluate(()=>window.__PHO_FLOW__.snapshot());
  assert.equal(sideState.drivingSide,'left');assert.equal(sideState.vehicles,0);assert.equal(sideState.time,0);
  await page.click('#save');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pho-flow-city-v1')).drivingSide),'left');
  await page.selectOption('#driving-side','right');await page.click('#undo');
  assert.equal(await page.locator('#driving-side').inputValue(),'left');
  assert.equal((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).drivingSide,'left');
  await page.selectOption('#driving-side','right');await page.click('#load');
  assert.equal(await page.locator('#driving-side').inputValue(),'left');
  await page.screenshot({path:'test-results/driving-side.png'});
  await page.selectOption('#driving-side','right');await page.click('#tab-build');
  await page.click('#save');assert.ok(await page.evaluate(()=>localStorage.getItem('pho-flow-city-v1')));
  await page.click('#load');assert.equal((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).houses,paused.houses);
  await page.click('#help');assert.equal(await page.locator('#help-dialog').isVisible(),true);await page.click('#start-building');
  await page.click('#play-pause');
  // Build a road by clicking in the map. Use top view and the camera projection for stable world coordinates.
  await page.click('#camera-top');await page.click('[data-tool=road]');
  const canvas=await page.locator('#city-canvas').boundingBox();
  // Top view preserves world x/z. Draw at z=-80, away from the sample district.
  const worldPixel=(x,z)=>({x:canvas.x+canvas.width/2+x*canvas.height/190,y:canvas.y+canvas.height/2+(z-3)*canvas.height/190});
  const beforeRoads=(await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).roads;
  for(const p of [worldPixel(-40,-80),worldPixel(5,-80)])await page.mouse.click(p.x,p.y);
  const afterRoads=(await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).roads;assert.ok(afterRoads>beforeRoads,'Road tool must create a road');
  await page.click('[data-tool=house]');let p=worldPixel(-25,-67);await page.mouse.click(p.x,p.y);
  assert.equal((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).houses,paused.houses+1,'House tool must place a house beside the new road');
  await page.click('#undo');await page.click('#undo');assert.equal((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).roads,beforeRoads);
  await page.click('[data-tool=curve]');for(const point of [worldPixel(-100,-72),worldPixel(-85,-50),worldPixel(-105,-48)])await page.mouse.click(point.x,point.y);
  assert.ok((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).roads>beforeRoads,'Curve tool must create a road');await page.click('#undo');
  await page.click('[data-tool=bridge]');for(const point of [worldPixel(-5,-80),worldPixel(55,-80)])await page.mouse.click(point.x,point.y);
  assert.ok((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).roads>beforeRoads,'Bridge tool must create a road');await page.click('#undo');
  await page.click('[data-tool=roundabout]');p=worldPixel(-100,-66);await page.mouse.click(p.x,p.y);
  assert.ok((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).roads>beforeRoads,'Roundabout tool must create circular roads');await page.click('#undo');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile must not overflow horizontally');
  assert.deepEqual(errors,[]);console.log('Browser smoke passed: WebGL, traffic, single-vehicle selection/switch/clear, direction display modes, pause, density, driving-side switch/reset/undo/save/load, night mode, road/curve/bridge/roundabout/house placement, undo, save/load, help, mobile.');
} finally {await browser.close();}
