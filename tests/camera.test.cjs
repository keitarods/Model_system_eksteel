const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PerspectiveCamera,Vector3}=require('three');
const {OrbitControls}=require('three-stdlib');
const {orientCamera,applyCameraPose,cubeViewDirection}=require('../src/components/viewer/cameraNavigation.ts');

function scene() {
  const camera=new PerspectiveCamera(45,1,0.1,10000);
  camera.up.set(0,0,1);camera.position.set(180,-180,180);
  const controls=new OrbitControls(camera);
  controls.enableDamping=true;
  controls.target.set(80,-30,40);
  controls.update();
  return {camera,controls};
}
function close(a,b,epsilon=1e-7) {assert.ok(a.distanceTo(b)<epsilon,`${a.toArray()} != ${b.toArray()}`);}
function stable(camera,controls) {
  const position=camera.position.clone(),rotation=camera.quaternion.clone(),target=controls.target.clone();
  for(let i=0;i<120;i++)controls.update();
  close(camera.position,position);close(controls.target,target);
  assert.ok(camera.quaternion.angleTo(rotation)<1e-7);
}

test('all 26 cube directions retain pan, zoom and orientation over subsequent frames',()=>{
  const {camera,controls}=scene();
  const target=controls.target.clone(),radius=camera.position.distanceTo(target);
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
    if(!(x||y||z))continue;
    const direction=new Vector3(x,y,z).normalize();
    orientCamera(camera,controls,direction);
    close(controls.target,target);
    close(camera.position.clone().sub(target).normalize(),direction);
    assert.ok(Math.abs(camera.position.distanceTo(target)-radius)<1e-7);
    stable(camera,controls);
  }
});
test('a preset can be reapplied after orbiting, including top after a rolled view',()=>{
  const {camera,controls}=scene();
  orientCamera(camera,controls,new Vector3(0,0,1));
  const position=camera.position.clone();
  applyCameraPose(camera,controls,camera.position,controls.target,new Vector3(1,0,0));
  stable(camera,controls);
  camera.position.add(new Vector3(60,30,-20));controls.update();
  orientCamera(camera,controls,new Vector3(0,0,1));
  close(camera.position.clone().sub(controls.target).normalize(),new Vector3(0,0,1));
  close(camera.up,new Vector3(0,1,0));
  assert.ok(position.z>controls.target.z);
  stable(camera,controls);
});
test('plane focus and Home set target before controls update; roll preserves that target',()=>{
  const {camera,controls}=scene();
  const target=new Vector3(900,-450,75),position=target.clone().add(new Vector3(260,0,0));
  applyCameraPose(camera,controls,position,target,new Vector3(0,0,1));
  close(camera.position,position);close(controls.target,target);stable(camera,controls);
  const up=camera.up.clone().applyAxisAngle(target.clone().sub(position).normalize(),Math.PI/2);
  applyCameraPose(camera,controls,camera.position,controls.target,up);
  close(camera.position,position);close(controls.target,target);stable(camera,controls);
});
test('cube face normal and edge/corner centers resolve different orientations',()=>{
  close(cubeViewDirection(new Vector3(),new Vector3(0,-1,0)),new Vector3(0,-1,0));
  close(cubeViewDirection(new Vector3(.38,.38,0),new Vector3(1,0,0)),new Vector3(1,1,0).normalize());
  close(cubeViewDirection(new Vector3(-.38,.38,.38),new Vector3(1,0,0)),new Vector3(-1,1,1).normalize());
});
test('view commands discard pending orbit damping instead of drifting after the click',()=>{
  const {camera,controls}=scene();
  controls.setAzimuthalAngle(controls.getAzimuthalAngle()+0.8);
  controls.setPolarAngle(controls.getPolarAngle()+0.3);
  const target=controls.target.clone();
  orientCamera(camera,controls,new Vector3(0,-1,0));
  close(camera.position.clone().sub(target).normalize(),new Vector3(0,-1,0));
  assert.equal(controls.enableDamping,true);
  stable(camera,controls);
});

test('entering sketch preserves perspective scale and pan at any model size',()=>{
 const {focusSketchPlane}=require('../src/components/viewer/cameraNavigation.ts');
 for(const radius of [5,260,8000]) {
  const {camera,controls}=scene();
  applyCameraPose(camera,controls,new Vector3(80,-30,40+radius),new Vector3(80,-30,40),new Vector3(0,1,0));
  const target=focusSketchPlane(camera,controls,new Vector3(0,0,100),new Vector3(0,0,1),new Vector3(0,1,0));
  close(target,new Vector3(80,-30,100));
  assert.ok(Math.abs(camera.position.distanceTo(target)-radius)<1e-7);
  stable(camera,controls);
 }
});
test('entering sketch preserves orthographic zoom on an offset inclined plane',()=>{
 const {OrthographicCamera}=require('three');
 const {focusSketchPlane}=require('../src/components/viewer/cameraNavigation.ts');
 const camera=new OrthographicCamera(-400,400,300,-300,0.1,10000);
 camera.zoom=4;camera.updateProjectionMatrix();
 camera.position.set(500,400,700);
 const controls=new OrbitControls(camera);controls.target.set(30,40,50);controls.update();
 const distance=camera.position.distanceTo(controls.target);
 const origin=new Vector3(0,100,0),normal=new Vector3(1,1,0).normalize();
 const target=focusSketchPlane(camera,controls,origin,normal,new Vector3(0,0,1));
 assert.equal(camera.zoom,4);assert.ok(Math.abs(target.clone().sub(origin).dot(normal))<1e-7);
 assert.ok(Math.abs(camera.position.distanceTo(target)-distance)<1e-7);stable(camera,controls);
});

test('entering sketch backs out to show the whole part in both projections, including narrow viewports',()=>{
 const {OrthographicCamera}=require('three');
 const {focusSketchPlane}=require('../src/components/viewer/cameraNavigation.ts');
 const vertices=[];
 for(const x of [100,2100])for(const y of [-500,500])for(const z of [200,210])vertices.push(x,y,z);
 for(const camera of [new OrthographicCamera(-200,200,300,-300,.1,10000),new PerspectiveCamera(45,0.6,.1,10000)]) {
  camera.position.set(1100,0,250);camera.zoom=4;camera.updateProjectionMatrix();
  const controls=new OrbitControls(camera);controls.target.set(1100,0,200);controls.update();
  const oldZoom=camera.zoom;
  focusSketchPlane(camera,controls,new Vector3(0,0,200),new Vector3(0,0,1),new Vector3(0,1,0),vertices);
  for(let i=0;i<vertices.length;i+=3){
   const p=new Vector3(...vertices.slice(i,i+3)).project(camera);
   assert.ok(Math.abs(p.x)<0.81&&Math.abs(p.y)<0.81,`${camera.type}: ${p.toArray()}`);
   assert.ok(p.z>=-1&&p.z<=1);
  }
  assert.ok(camera.zoom<=oldZoom);stable(camera,controls);
 }
});
test('fitting the sketch never zooms into a part that is already comfortably framed',()=>{
 const {OrthographicCamera}=require('three');const {focusSketchPlane}=require('../src/components/viewer/cameraNavigation.ts');
 const camera=new OrthographicCamera(-400,400,300,-300,.1,10000);camera.zoom=.1;camera.position.set(0,0,1000);camera.updateProjectionMatrix();
 const controls=new OrbitControls(camera);controls.update();
 focusSketchPlane(camera,controls,new Vector3(),new Vector3(0,0,1),new Vector3(0,1,0),[-10,-10,0,10,10,2]);
 assert.equal(camera.zoom,.1);assert.equal(camera.position.distanceTo(controls.target),1000);
});
