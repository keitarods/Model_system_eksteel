const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serializeDrawing,parseDrawing}=require('../src/lib/drawing/documentFormat.ts');
const {createSheetObject}=require('../src/lib/drawing/store.ts');
const {validateDocument}=require('../src/lib/project/cloudDocuments.ts');
test('editable drawing preserves sheets, title block and annotations independently of a part',async()=>{
 const sheet=createSheetObject('Folha 1');
 sheet.titleBlock.partName='Suporte';
 sheet.annotations.push({id:'note',viewId:null,kind:'text',x:10,y:20,text:'Conferir medidas'});
 const json=serializeDrawing([sheet,createSheetObject('Folha 2')]);
 assert.deepEqual(parseDrawing(json)[0],sheet);
 assert.equal(parseDrawing(json).length,2);
 assert.equal(await validateDocument('Suporte.eksdesenho',new Blob([json])),'drawing');
});
test('drawing rejects incompatible versions, duplicate sheets and malformed coordinates',()=>{
 const sheet=createSheetObject('Folha');
 assert.throws(()=>parseDrawing('{}'));
 assert.throws(()=>parseDrawing(JSON.stringify({format:'eksteel-drawing',version:2,sheets:[sheet]})));
 assert.throws(()=>serializeDrawing([sheet,sheet]));
 sheet.dimensions.push({id:'d',x1:'invalid'});
 assert.throws(()=>serializeDrawing([sheet]),/Cota/);
});

test('centers, leader notes and balloons survive saving and reject incomplete coordinates',()=>{
 const sheet=createSheetObject('Detalhamento');
 for (const kind of ['centerline','centermark','leader','balloon']) {
  sheet.annotations.push({id:kind,viewId:null,kind,x1:10,y1:20,x2:35,y2:40,text:kind==='balloon'?'12':'Nota'});
 }
 assert.deepEqual(parseDrawing(serializeDrawing([sheet]))[0].annotations,sheet.annotations);
 for (const annotation of sheet.annotations) {
  const invalid={...sheet,annotations:[{...annotation,x2:undefined,x:10,y:20}]};
  assert.throws(()=>serializeDrawing([invalid]),/Anotação/);
 }
});
