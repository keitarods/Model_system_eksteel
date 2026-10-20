const {test}=require('node:test');const assert=require('node:assert/strict');
const {autoRadiusNotes,labelBox}=require('../src/lib/drawing/autoDimensions.ts');
const {layoutLeaders}=require('../src/lib/drawing/leaderLayout.ts');
test('fabrication radius notes retain bend radii and exclude unrelated internal details',()=>{
 const arc=(x,r)=>({x,y:0,radius:r,mid:{x:x+r,y:0}});
 const view={id:'v',orientation:'front',x:100,y:80,scale:1,box:{minX:0,minY:0,width:50,height:40},arcs:[arc(0,2),arc(10,3),arc(20,1)],bendProfiles:[{id:'b',x:0,y:0,radius:2,outerRadius:4}]};
 assert.equal(autoRadiusNotes(view,true).length,1);assert.equal(autoRadiusNotes(view,false).length,3);
});
test('automatic dimension labels occupy separate lanes without moving their references',()=>{
 const dims=Array.from({length:4},(_,i)=>({id:String(i),viewId:'v',x1:50,y1:80,x2:110,y2:80,value:60,offset:-8,automatic:true,suffix:i%2?' (40°)':undefined}));
 const sheet={size:'A3',orientation:'landscape',views:[{id:'v',x:80,y:100,scale:1,box:{minX:0,minY:0,width:60,height:40}}],annotations:[],dimensions:dims};
 const out=layoutLeaders(sheet);const boxes=out.dimensions.map(labelBox);
 out.dimensions.forEach((d,i)=>{assert.equal(d.x1,dims[i].x1);assert.equal(d.y1,dims[i].y1);assert.equal(d.value,60);});
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
  const a=boxes[i],b=boxes[j];assert.ok(!(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y));
 }
 assert.deepEqual(sheet.dimensions,dims);
});
test('overall vertical dimension stays outside the three bend dimension lanes',()=>{
 const dim=(id,y1,y2)=>({id,viewId:'v',x1:80,y1,x2:80,y2,offset:8,value:y2-y1,automatic:true});
 const dimensions=[dim('overall',50,200),dim('upper',50,95),dim('middle',95,165),dim('lower',165,200)];
 const sheet={size:'A3',orientation:'landscape',views:[{id:'v',x:130,y:125,scale:1,box:{width:100,height:150}}],annotations:[],dimensions};
 const result=layoutLeaders(sheet).dimensions;
 const overall=result.find(d=>d.id==='overall');
 for(const d of result.filter(d=>d.id!=='overall'))assert.ok(overall.offset>=d.offset+7,'total outside local dimensions');
 assert.deepEqual(result.map(d=>d.id),dimensions.map(d=>d.id));
 for(const d of result){const original=dimensions.find(x=>x.id===d.id);assert.equal(d.y1,original.y1);assert.equal(d.y2,original.y2);}
 const twice=layoutLeaders({...sheet,dimensions:result});assert.deepEqual(twice.dimensions,result,'layout is stable when regenerated');
});
