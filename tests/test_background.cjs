'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');

function worker(options = {}) {
  let listener;
  let stored = {};
  const frame = options.frame || {documentId:'doc-1',result:{title:'Form',source:'fixture.test',items:[{section:'',kind:'field',label:'Name',value:'Alice'}]}};
  const context = vm.createContext({
    crypto:webcrypto,
    TextEncoder,
    fetch:async()=>({ok:true,json:async()=>({8536:'Acme'})}),
    chrome:{runtime:{id:'test-extension',getURL:name=>'chrome-extension://test-extension/'+name,onMessage:{addListener:fn=>listener=fn}},
      scripting:{executeScript:async()=>{if(options.injectionError)throw new Error('Cannot access page');return [structuredClone(frame)];}},
      storage:{session:{
        get:async()=>structuredClone(stored),
        set:async value=>{await new Promise(resolve=>setImmediate(resolve));if(options.quotaError)throw new Error('Quota exceeded');stored={...stored,...structuredClone(value)};},
        remove:async key=>{delete stored[key];}
      }}
    }
  });
  context.importScripts = (...names) => names.forEach(name => vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name}));
  vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context,{filename:'background.js'});
  return {
    send:message=>new Promise(resolve=>listener(message,{id:'test-extension'},resolve)),
    read:()=>structuredClone(stored.applicationRecord),
    frame,
    listener
  };
}

test('captures snapshot and suppresses unchanged duplicate',async()=>{
  const w=worker();assert.equal((await w.send({type:'capture',tabId:1})).count,1);
  const result=await w.send({type:'capture',tabId:1});assert.equal(result.duplicate,true);assert.equal(result.count,1);
  assert.equal(w.read().pages[0].items[0].value,'Alice');
});
test('changed answers add a snapshot',async()=>{
  const w=worker();await w.send({type:'capture',tabId:1});w.frame.result.items[0].value='Bob';
  assert.equal((await w.send({type:'capture',tabId:1})).count,2);
});
test('writer queue preserves a concurrent capture and rename',async()=>{
  const w=worker();await Promise.all([w.send({type:'capture',tabId:1}),w.send({type:'rename',title:'  My record  '})]);
  assert.equal(w.read().title,'My record');assert.equal(w.read().pages.length,1);
});
test('include updates do not duplicate exclusions and can restore fields',async()=>{
  const w=worker();await w.send({type:'capture',tabId:1});const pageId=w.read().pages[0].id;
  await Promise.all([w.send({type:'include',pageId,item:0,included:false}),w.send({type:'include',pageId,item:0,included:false})]);
  assert.deepEqual(w.read().pages[0].excluded,[0]);
  await w.send({type:'include',pageId,item:0,included:true});assert.deepEqual(w.read().pages[0].excluded,[]);
});
test('move, remove, and clear persist correctly',async()=>{
  const w=worker();await w.send({type:'capture',tabId:1});w.frame.documentId='doc-2';await w.send({type:'capture',tabId:1});
  const pageId=w.read().pages[1].id;await w.send({type:'move',pageId,direction:-1});assert.equal(w.read().pages[0].id,pageId);
  await w.send({type:'remove',pageId});assert.equal(w.read().pages.length,1);await w.send({type:'clear'});assert.equal(w.read(),undefined);
});
test('bad update reports an error without blocking later messages',async()=>{
  const w=worker();assert.equal((await w.send({type:'remove',pageId:'missing'})).ok,false);
  assert.equal((await w.send({type:'capture',tabId:1})).ok,true);
});
test('injection error returns actionable message',async()=>{
  const result=await worker({injectionError:true}).send({type:'capture',tabId:1});assert.equal(result.ok,false);assert.match(result.error,/extension icon/);
});
test('quota error returns save-and-clear guidance',async()=>{
  const result=await worker({quotaError:true}).send({type:'capture',tabId:1});assert.equal(result.ok,false);assert.match(result.error,/session is full/);
});
test('rejects another extension sender',()=>{
  const w=worker();let replied=false;assert.equal(w.listener({type:'clear'},{id:'other-extension'},()=>replied=true),false);assert.equal(replied,false);
});

test('capture returns its summary and duplicate review target',async()=>{
  const w=worker();w.frame.result.warnings=['Expand a collapsed section.'];
  const result=await w.send({type:'capture',tabId:1});
  assert.equal(result.title,'Form');assert.equal(result.fields,1);assert.equal(result.pageId,w.read().pages[0].id);
  assert.deepEqual(structuredClone(result.warnings),['Expand a collapsed section.']);
  const duplicate=await w.send({type:'capture',tabId:1});assert.equal(duplicate.pageId,result.pageId);
});
test('distinct SPA form paths do not suppress identical answers',async()=>{
  const w=worker();w.frame.result.sourcePath='/form-one';await w.send({type:'capture',tabId:1});
  w.frame.result.sourcePath='/form-two';assert.equal((await w.send({type:'capture',tabId:1})).count,2);
});
test('recapturing after resolving capture notes keeps the updated snapshot',async()=>{
  const w=worker();w.frame.result.warnings=['Expand a collapsed section.'];await w.send({type:'capture',tabId:1});
  w.frame.result.warnings=[];assert.equal((await w.send({type:'capture',tabId:1})).count,2);
  assert.deepEqual(w.read().pages[1].warnings,[]);assert.equal(w.read().pages[0].warnings.length,1);
});
test('section selection is atomic and rejects invalid indices',async()=>{
  const w=worker();w.frame.result.items.push({section:'',kind:'field',label:'City',value:'Toronto'});
  await w.send({type:'capture',tabId:1});const pageId=w.read().pages[0].id;
  assert.equal((await w.send({type:'includeMany',pageId,items:[0,9],included:false})).ok,false);
  assert.deepEqual(w.read().pages[0].excluded,[]);
  await w.send({type:'includeMany',pageId,items:[0,1],included:false});assert.deepEqual(w.read().pages[0].excluded,[0,1]);
  await w.send({type:'includeMany',pageId,items:[0,1],included:true});assert.deepEqual(w.read().pages[0].excluded,[]);
});
test('version selection preserves all snapshots and field selections',async()=>{
  const w=worker();await w.send({type:'capture',tabId:1});const first=w.read().pages[0].id;
  await w.send({type:'include',pageId:first,item:0,included:false});
  w.frame.result.items[0].value='Bob';await w.send({type:'capture',tabId:1});const second=w.read().pages[1].id;
  w.frame.result.title='Different form';await w.send({type:'capture',tabId:1});
  await w.send({type:'useVersion',pageId:second});
  const pages=w.read().pages;assert.equal(pages.length,3);assert.equal(pages[0].enabled,false);assert.equal(pages[1].enabled,true);
  assert.notEqual(pages[2].enabled,false);assert.deepEqual(pages[0].excluded,[0]);
  await w.send({type:'enable',pageId:first,enabled:true});assert.deepEqual(w.read().pages[0].excluded,[0]);
});
test('paper and table layout persist with validation',async()=>{
  const w=worker();w.frame.result.items=[{section:'',kind:'table',label:'History',rows:[[{text:'City',header:true,colSpan:1,rowSpan:1}],[{text:'Toronto',header:false,colSpan:1,rowSpan:1}]]}];
  await w.send({type:'capture',tabId:1});const pageId=w.read().pages[0].id;
  await w.send({type:'paper',paper:'a4'});assert.equal(w.read().settings.paper,'a4');
  assert.equal((await w.send({type:'paper',paper:'bogus'})).ok,false);assert.equal(w.read().settings.paper,'a4');
  await w.send({type:'layout',pageId,item:0,layout:'cards'});assert.equal(w.read().pages[0].layouts[0],'cards');
  assert.equal((await w.send({type:'layout',pageId,item:0,layout:'bogus'})).ok,false);
});
test('invalid restore leaves current data intact and valid restore replaces it',async()=>{
  const w=worker();await w.send({type:'capture',tabId:1});const before=w.read();
  assert.equal((await w.send({type:'restore',draft:{format:'wrong'}})).ok,false);assert.deepEqual(w.read(),before);
  const draft={format:'MapleRecord',version:1,record:{...before,title:'Restored title',settings:{paper:'a4'}}};
  const request = await w.send({type:'restore', draft});
  assert.deepEqual(w.read(), before);
  await w.send({type:'restore', draft, confirmedState:request.confirmation.state});
  assert.equal(w.read().title,'Restored title');assert.equal(w.read().pages.length,1);
});

test('restore checks the queued record and asks again if it changes before confirmation', async () => {
  const w = worker();
  const draft = {format:'MapleRecord', version:1, record:{title:'Saved draft', pages:[]}};
  const restore = {type:'restore', draft};
  const [capture, first] = await Promise.all([w.send({type:'capture', tabId:1}), w.send(restore)]);
  assert.equal(capture.ok, true);
  assert.equal(w.read().pages.length, 1);
  assert.equal(first.confirmation.count, 1);
  w.frame.result.items[0].value = 'Bob';
  await w.send({type:'capture', tabId:1});
  const next = await w.send({...restore, confirmedState:first.confirmation.state});
  assert.equal(w.read().pages.length, 2);
  assert.equal(next.confirmation.count, 2);
  assert.notEqual(next.confirmation.state, first.confirmation.state);
  assert.equal((await w.send({...restore, confirmedState:next.confirmation.state})).ok, true);
  assert.equal(w.read().title, 'Saved draft');
  assert.equal(w.read().pages.length, 0);
});

test('restore into an empty record completes without confirmation', async () => {
  const w = worker();
  const draft = {format:'MapleRecord', version:1, record:{title:'Restored directly', pages:[]}};
  const reply = await w.send({type:'restore', draft});
  assert.equal(reply.ok, true);
  assert.equal(reply.confirmation, undefined);
  assert.equal(w.read().title, 'Restored directly');
});
