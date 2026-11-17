'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../shared.js'),'utf8'),context);
const api = vm.runInContext('({draftFor,validateDraft,comparePages,versionsFor,formIdentity,settingsFor,pageIncluded,itemIncluded,sectionsFor,unanswered})',context);
const field=(label,value,section='')=>({kind:'field',label,value,section});
const page=(id='one',items=[field('Name','Alice')])=>({id,title:'Form',source:'portal.test',sourcePath:'/form',capturedAt:'2026-11-17T00:00:00.000Z',items,excluded:[]});
const draft=()=>({format:'MapleRecord',version:1,record:{title:'Record',pages:[page()],settings:{paper:'letter'}}});

test('draft round-trip retains selections, layouts, notes and paper size',()=>{
 const d=draft();d.record.pages[0].items.push({kind:'table',label:'History',section:'',rows:[[{text:'City',header:true,colSpan:1,rowSpan:1}],[{text:'Toronto',header:false,colSpan:1,rowSpan:1}]]});
 Object.assign(d.record.pages[0],{enabled:false,excluded:[0],layouts:{1:'cards'},warnings:['Expand sections.']});d.record.settings.paper='a4';
 const restored=api.validateDraft(d);
 assert.deepEqual(structuredClone(api.validateDraft(api.draftFor(restored))),structuredClone(restored));
});
test('malformed drafts reject invalid dates, duplicate IDs, table spans and exclusions',()=>{
 for (const mutate of [d=>d.version=2,d=>d.record.pages[0].capturedAt='no date',d=>d.record.pages.push(page()),d=>d.record.pages[0].excluded=[999],d=>d.record.pages[0].items[0].value={},d=>d.record.settings.paper='bogus',d=>d.record.pages[0].items=[{kind:'table',label:'T',section:'',rows:[[{text:'x',header:false,colSpan:0,rowSpan:1}]]}]]) {
  const d=draft();mutate(d);assert.throws(()=>api.validateDraft(d));
 }
});
test('unknown draft properties are stripped and HTML stays plain text',()=>{
 const d=JSON.parse(JSON.stringify(draft()).replace('Alice','<img src=x onerror=alert(1)>'));
 d.record.pages[0].script='alert(1)';d.record.secret='ignored';
 const r=api.validateDraft(d);assert.equal(r.secret,undefined);assert.equal(r.pages[0].script,undefined);assert.equal(r.pages[0].items[0].value,'<img src=x onerror=alert(1)>');
});
test('old drafts without settings or metadata remain usable',()=>{
 const d=draft();delete d.record.settings;delete d.record.pages[0].sourcePath;
 const r=api.validateDraft(d);assert.equal(r.settings.paper,'letter');assert.equal(r.pages[0].enabled,true);assert.equal(r.pages[0].sourcePath,'');
});
test('comparisons distinguish repeated labels, changed, new and removed answers',()=>{
 const before=page('one',[field('Name','Alice'),field('Name','Bob'),field('Old question','Old answer')]);
 const after=page('two',[field('Name','Alice'),field('Name','Carol'),field('New question','New answer')]);
 const diff=api.comparePages(after,before);assert.equal(diff.changes.size,2);assert.equal(diff.changes.get(1).before.value,'Bob');assert.equal(diff.changes.get(2).type,'added');assert.equal(diff.removed[0].label,'Old question');
});
test('comparison ignores display order and exclusion settings',()=>{
 const before=page('one',[field('Name','Alice'),field('City','Toronto')]);
 const after={...page('two',[field('City','Toronto'),field('Name','Alice')]),excluded:[1],enabled:false};
 const diff=api.comparePages(after,before);assert.equal(diff.changes.size,0);assert.equal(diff.removed.length,0);
});
test('versions sort chronologically and separate different sources and paths',()=>{
 const early=page('one');const later={...page('two'),capturedAt:'2026-11-17T01:00:00.000Z'};
 const other={...page('three'),sourcePath:'/other'};
 const versions=api.versionsFor({pages:[later,other,early]},early);assert.deepEqual(versions.map(v=>v.id),['one','two']);
});
test('page inclusion and sections respect disabled captures and exclusions',()=>{
 const p=page('one',[field('Name','Alice','A'),field('City','Toronto','A'),field('Notes','','B')]);
 p.excluded=[0];assert.equal(api.pageIncluded(p),true);assert.equal(api.itemIncluded(p,0),false);
 assert.equal(api.unanswered(p.items[2]),true);assert.deepEqual(structuredClone(api.sectionsFor(p)),[{name:'A',indices:[0,1]},{name:'B',indices:[2]}]);
 p.enabled=false;assert.equal(api.pageIncluded(p),false);assert.equal(api.itemIncluded(p,1),false);
});
