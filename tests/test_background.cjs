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
