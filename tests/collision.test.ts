import test from 'node:test';
import assert from 'node:assert/strict';
import {pt,overlaps} from '../src/simulation';
import {sweptOverlaps,movingBodiesOverlap} from '../src/collision';
import {driveArc} from '../src/kinematics';

test('a rotating truck passing a nearby corner is not trapped by the padded prediction envelope',()=>{
  const start={x:-25.443974624294523,y:0,z:38.72402474285062,angle:-1.6064368514463612};
  const other={x:-28.506048236591848,y:0,z:41.46763567409141,angle:.9608585552776239};
  const from=driveArc(start,.5775,-.35,3.7),to=driveArc(from,.1155,-.35,3.7);
  assert.equal(sweptOverlaps(from,to,'truck',other,'car',.06),false);
  assert.equal(movingBodiesOverlap(from,to,'truck',other,other,'car',.06),false);
});

test('continuous movement catches a vehicle between two clear endpoints',()=>{
  const a={...pt(-6,0),angle:Math.PI/2},b={...pt(6,0),angle:Math.PI/2},other={...pt(0,0),angle:0};
  assert.equal(overlaps(a,'car',other,'bike',0),false);assert.equal(overlaps(b,'car',other,'bike',0),false);
  assert.equal(sweptOverlaps(a,b,'car',other,'bike',0),true);
});
test('continuous rotation catches a corner contact between clear endpoint poses',()=>{
  const a={...pt(0,0),angle:-Math.PI/4},b={...pt(0,0),angle:Math.PI/4},other={...pt(0,2.92),angle:0};
  assert.equal(overlaps(a,'car',other,'bike',0),false);assert.equal(overlaps(b,'car',other,'bike',0),false);
  assert.equal(sweptOverlaps(a,b,'car',other,'bike',0),true);
});
test('a parallel near miss and a separate bridge remain clear during the sweep',()=>{
  const a={...pt(-6,0),angle:Math.PI/2},b={...pt(6,0),angle:Math.PI/2};
  assert.equal(sweptOverlaps(a,b,'car',{...pt(0,2.5),angle:Math.PI/2},'car'),false);
  assert.equal(sweptOverlaps(a,b,'car',{...pt(0,0,6),angle:Math.PI/2},'truck'),false);
});

test('a microscopic reverse away from a neighbouring corner is not a collision',async()=>{
  const {driveArc}=await import('../src/kinematics');
  const a={x:-16.10750893500982,y:0,z:45.28779767424101,angle:2.995476032009486};
  const neighbours=[{kind:'truck' as const,pose:{x:-15.741024729158815,y:0,z:38.542641095509765,angle:-.5798919916045208}},
    {kind:'bike' as const,pose:{x:-13.613637652465696,y:0,z:44.314835760171164,angle:4.712234468617694}}];
  for(const distance of [-.0003,-.001,-.05])for(const other of neighbours){
    const next=driveArc(a,distance,-.35,3.7);assert.equal(overlaps(next,'truck',other.pose,other.kind,.06),false);
    assert.equal(sweptOverlaps(a,next,'truck',other.pose,other.kind,.06),false);
  }
});
