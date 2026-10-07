const {test}=require('node:test');
const assert=require('node:assert/strict');
const {OrthographicCamera,Vector3}=require('three');
const {cameraWithProjection}=require('../src/components/viewer/cameraProjection.ts');
test('projection switch preserves panned target, viewing angle and apparent scale',()=>{
 const target=new Vector3(30,-20,50), size={width:900,height:600};
 const camera=new OrthographicCamera(-450,450,300,-300,0.1,10000);
 camera.zoom=3; camera.up.set(0,0,1);camera.position.copy(target).add(new Vector3(100,-100,100));camera.lookAt(target);camera.updateProjectionMatrix();
 const perspective=cameraWithProjection(camera,target,size,'perspective');
 assert.ok(perspective.isPerspectiveCamera);
 assert.ok(perspective.quaternion.angleTo(camera.quaternion)<1e-7);
 const height=2*perspective.position.distanceTo(target)*Math.tan(perspective.fov*Math.PI/360);
 assert.ok(Math.abs(height-200)<1e-7);
 const flat=cameraWithProjection(perspective,target,size,'orthographic');
 assert.ok(flat.isOrthographicCamera);
 assert.ok(Math.abs(flat.zoom-3)<1e-7);
 // In the top view, depth does not alter the apparent X/Y location.
 flat.up.set(0,1,0);flat.position.set(0,0,200);flat.lookAt(0,0,0);flat.updateMatrixWorld();
 const a=new Vector3(10,20,0).project(flat),b=new Vector3(10,20,100).project(flat);
 assert.ok(Math.abs(a.x-b.x)<1e-9&&Math.abs(a.y-b.y)<1e-9);
});
