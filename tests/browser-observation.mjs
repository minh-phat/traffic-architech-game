import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(process.argv[2]??'http://127.0.0.1:5173',{waitUntil:'networkidle'});
  await page.evaluate(()=>localStorage.removeItem('pho-flow-observation-v1'));
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__PHO_FLOW__?.snapshot().vehicles>3);
  await page.click('#play-pause');await page.click('#tab-traffic');
  await page.selectOption('#observation-kind','bike');
  await page.locator('#observation-front-range').fill('23');
  assert.equal(await page.locator('#observation-front-range-value').textContent(),'23 m');
  await page.locator('#observation-rear-angle').fill('145');
  await page.locator('#observation-front-verticalAngle').fill('85');
  assert.equal(await page.locator('#observation-front-verticalAngle-value').textContent(),'85 °');
  await page.selectOption('#observation-kind','car');
  assert.equal(await page.locator('#observation-front-range').inputValue(),'25');
  await page.selectOption('#observation-kind','bike');
  assert.equal(await page.locator('#observation-front-range').inputValue(),'23');
  await page.reload({waitUntil:'networkidle'});await page.click('#tab-traffic');
  await page.selectOption('#observation-kind','bike');
  assert.equal(await page.locator('#observation-front-range').inputValue(),'23');
  assert.equal(await page.locator('#observation-rear-angle').inputValue(),'145');
  assert.equal(await page.locator('#observation-front-verticalAngle').inputValue(),'85');
  await page.waitForFunction(()=>window.__PHO_FLOW__.snapshot().vehicles>3);
  await page.click('#play-pause');await page.click('#camera-top');await page.waitForTimeout(200);
  const map=await page.locator('#city-canvas').boundingBox();
  const vehicles=await page.evaluate(()=>window.__PHO_FLOW__.simulation.vehicles.map(v=>({id:v.id,kind:v.kind,x:v.pose.x,z:v.pose.z})));
  let selected;
  for(const v of vehicles){
    const x=map.x+map.width/2+v.x*map.height/190,y=map.y+map.height/2+(v.z-3)*map.height/190;
    if(!await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id==='city-canvas',{x,y}))continue;
    await page.mouse.click(x,y);
    if((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).selectedVehicleId===v.id){selected=v;break;}
  }
  assert.ok(selected,'Could not select a rendered vehicle');
  await page.waitForFunction(()=>window.__PHO_FLOW__.snapshot().observationVisible);
  assert.equal(await page.locator('#observation-kind').inputValue(),selected.kind);
  await page.waitForFunction(id=>window.__PHO_FLOW__.snapshot().observedVehicleId===id,selected.id);
  const yieldingTo=await page.evaluate(id=>{
    const vehicles=window.__PHO_FLOW__.simulation.vehicles,observer=vehicles.find(v=>v.id===id);
    observer.yieldingTo=vehicles.filter(v=>v.id!==id).slice(0,2).map(v=>v.id);
    observer.reason=`Nhường xe #${observer.yieldingTo[0]}`;
    return observer.yieldingTo;
  },selected.id);
  await page.waitForFunction(ids=>document.getElementById('vehicle-details').textContent.includes(`Các xe cần nhường: ${ids.map(id=>`#${id}`).join(', ')}`),yieldingTo);

  // Place two paused vehicles in open 3D space so the detection and marker
  // can be checked without depending on the randomly spawned city traffic.
  const targetId=await page.evaluate(id=>{
    const vehicles=window.__PHO_FLOW__.simulation.vehicles;
    const observer=vehicles.find(v=>v.id===id),target=vehicles.find(v=>v.id!==id);
    for(const v of vehicles)if(v!==observer&&v!==target)v.pose={...v.pose,x:90,y:0,z:-90};
    observer.pose={...observer.pose,x:-90,y:30,z:80,angle:0};
    target.pose={...target.pose,x:-90,y:30,z:88,angle:0};
    return target.id;
  },selected.id);
  await page.waitForFunction(id=>window.__PHO_FLOW__.snapshot().observationLinkIds.includes(id),targetId);
  await page.evaluate(id=>{const v=window.__PHO_FLOW__.simulation.vehicles.find(v=>v.id===id);v.pose={...v.pose,x:90,y:0,z:-90};},targetId);
  await page.waitForFunction(id=>!window.__PHO_FLOW__.snapshot().observationLinkIds.includes(id),targetId);
  await page.waitForFunction(()=>{const s=window.__PHO_FLOW__.snapshot();const ids=[...new Set([...s.observations.front,...s.observations.rear].map(x=>x.id))];return ids.length===s.observationLinkIds.length&&ids.every(id=>s.observationLinkIds.includes(id));});
  await page.locator('#observation-front-angle').fill('0');
  await page.locator('#observation-rear-angle').fill('0');
  await page.waitForFunction(()=>{const o=window.__PHO_FLOW__.snapshot().observations;return o.front.length===0&&o.rear.length===0;});
  await page.waitForFunction(()=>window.__PHO_FLOW__.snapshot().observationLinkIds.length===0);
  await page.uncheck('#show-observation');
  await page.waitForFunction(()=>!window.__PHO_FLOW__.snapshot().observationVisible);
  assert.equal((await page.evaluate(()=>window.__PHO_FLOW__.snapshot())).observedVehicleId,selected.id);
  await page.check('#show-observation');
  await page.waitForFunction(()=>window.__PHO_FLOW__.snapshot().observationVisible);
  await page.click('#clear-vehicle');
  await page.waitForFunction(()=>window.__PHO_FLOW__.snapshot().selectedVehicleId===null&&!window.__PHO_FLOW__.snapshot().observationVisible&&window.__PHO_FLOW__.snapshot().observationLinkIds.length===0);
  await page.selectOption('#observation-kind','bike');await page.click('#observation-reset');
  assert.equal(await page.locator('#observation-front-range').inputValue(),'18');
  assert.deepEqual(errors,[]);
  console.log('Observation UI passed: type settings, persistence, selection, multiple yield targets, visibility and reset.');
}finally{await browser.close();}
