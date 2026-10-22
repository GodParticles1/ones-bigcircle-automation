const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {test} = require('node:test');
const workerSource = fs.readFileSync(path.join(__dirname,'..','service-worker.js'),'utf8');
const diagnosticSource = fs.readFileSync(path.join(__dirname,'..','native-editor-diagnostic.js'),'utf8');
const href='https://synthetic.invalid/project/#/team/t/project/p/issue/SYN-1';
const popupUrl='chrome-extension://synthetic-bridge/popup.html';
const secret='SYNTHETIC_PRIVATE_VALUE_MUST_NOT_ESCAPE';
const config={onesOrigin:'https://synthetic.invalid',teamUuid:'t',projectUuid:'p',issueTypeUuid:'i',
  rootCauseFieldId:'f',writeEnabled:false};
const stages=['DOM_BEFORE','USER_START','TASK_RESOLVE','TASK_INFO','FIELD_SCHEMA','FIELD_CONFIG','USER_END','DOM_AFTER'];
async function harness(options={}) {
  const requests=[],effects={debugger:0,relay:0,sessionWrites:0,cacheWrites:0,logs:0,bodyReads:0,poisonReads:0,permissionRequests:0};
  const stored={onesRelayConfig:{...config,baseUrl:'http://127.0.0.1:18731',enabled:false,
    executorId:'synthetic-executor',token:'synthetic-token',inventoryPageUrl:'',assigneeDepartmentUuid:'',...options.config}};
  const pending={onesNativeDiagnosticV1:{pending:true,verified:false,run:'unrelated-run'}};
  const beforePending=JSON.stringify(pending.onesNativeDiagnosticV1);
  const location={href,origin:config.onesOrigin};
  const rect={width:100,height:20};
  const field={id:'f',isConnected:true,getBoundingClientRect:()=>rect};
  for(const key of ['textContent','innerText']) Object.defineProperty(field,key,{get(){effects.bodyReads++;throw Error(secret);}});
  const wrapper={isConnected:true,getBoundingClientRect:()=>rect,contains:n=>n===field||n===label};
  const label={isConnected:true,innerText:'问题根因',textContent:'问题根因',getBoundingClientRect:()=>rect,
    closest:s=>s==='.oac-flex.oac-py-1.oac-items-start.oac-flex-col'?wrapper:null,querySelectorAll:()=>[]};
  field.closest=s=>s==='.oac-flex.oac-py-1.oac-items-start.oac-flex-col'?wrapper:null;
  const document={body:{},documentElement:{},querySelectorAll:s=>
    s==='.form-field-label.edit_form_field_label'?(options.missingDom?[]:options.duplicateLabel?[label,{...label}]:[label]):
    s==='[id="f"]'?(options.duplicateDomId?[field,{...field}]:[field]):[]};
  let heldResolve,heldStarted;
  const held=new Promise(resolve=>{heldResolve=resolve});
  const started=new Promise(resolve=>{heldStarted=resolve});
  const bodyFor=index=>index===0||index===5?{uuid:'user'}:index===1?
    {display_id:'SYN-1',task_uuid:'task'}:index===2?
    {uuid:'task',assign:'user',owner:'creator',project_uuid:'p',issue_type_uuid:'i'}:index===3?
    {fields:[{uuid:'f',name:'问题根因',type:15}]}:
    {field_configs:[{project_uuid:'p',issue_type_uuid:'i',field_uuid:'f'}]};
  let parseIndex=0;
  const pageJson={stringify:JSON.stringify,parse:text=>{
    const value=JSON.parse(text),index=parseIndex++;
    if(options.poisonRequired && index===0) Object.defineProperty(value,'uuid',{get(){effects.poisonReads++;throw Error(secret);}});
    if(options.poisonExtra) Object.defineProperty(value,'privateExtra',{get(){effects.poisonReads++;throw Error(secret);}});
    return value;
  }};
  const page=vm.createContext({URL,location,document,JSON:pageJson,Date,AbortController,
    console:{log(){effects.logs++},warn(){effects.logs++},error(){effects.logs++}},
    getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),
    setTimeout:(f,ms)=>setTimeout(f,options.fastTimeout?0:ms),clearTimeout,
    fetch:async(url,init)=>{
      const index=requests.length;requests.push({url,init});
      if(options.hold && index===0){heldStarted();await held;}
      if(options.timeoutAt===index) return new Promise(()=>{});
      if(options.errorAt===index) throw Error(secret);
      const body=bodyFor(index);
      if(options.changeBody) options.changeBody(index,body);
      if(options.navigationAt===index) location.href=href+'/changed';
      if(options.domDriftAt===index) field.isConnected=false;
      return {ok:options.httpAt!==index,status:options.httpAt===index?(options.httpCode??401):200,
        text:async()=>options.htmlAt===index?'<html>'+secret+'</html>':JSON.stringify(body)};
    }});
  let handler,worker,scriptCalls=0,activeId=1,activeUrl=options.activeUrl??href;
  const noEvent={addListener(){}};
  const chrome={runtime:{id:'synthetic-bridge',getURL:p=>'chrome-extension://synthetic-bridge/'+p,
      onMessage:{addListener:f=>{handler=f}},onInstalled:noEvent,onStartup:noEvent},
    alarms:{get:async()=>({}),create(){},onAlarm:noEvent},
    storage:{local:{get:async key=>({[key]:stored[key]}),set:async value=>Object.assign(stored,value)},
      session:{get:async key=>({[key]:pending[key]}),set:async value=>{
        if(Object.hasOwn(value,'onesNativeDiagnosticV1'))effects.sessionWrites++;else effects.cacheWrites++;
        Object.assign(pending,value)}}},
    tabs:{query:async()=>options.twoTabs?[{id:1,url:href},{id:2,url:href}]:[{id:activeId,url:activeUrl}],
      get:async id=>({id,url:activeUrl,status:'complete'})},
    permissions:{contains:async()=>!options.noPermission,request:async()=>{effects.permissionRequests++;throw Error(secret)}},
    debugger:{attach:async()=>{effects.debugger++;throw Error(secret)},sendCommand:async()=>{effects.debugger++;throw Error(secret)}},
    scripting:{executeScript:async({func,args,world,target})=>{
      scriptCalls++;assert.equal(world,'MAIN');assert.equal(target.tabId,1);
      if(options.scriptThrows) throw Error(secret);
      // Execute the actual serialized function without a worker lexical closure.
      const callable=vm.runInContext('('+func.toString()+')',page);
      const result=await callable(...args);
      if(options.afterScript) options.afterScript(stored,()=>{activeId=2},()=>{activeUrl=href+'/changed'});
      if(options.poisonReceipt) Object.defineProperty(result,'privateBinding',{get(){effects.poisonReads++;throw Error(secret);}});
      if(options.extraReceipt) result.raw=secret;
      return [{result}];
    }}};
  worker=vm.createContext({chrome,URL,crypto:webcrypto,setTimeout,clearTimeout,
    console:{log(){effects.logs++},error(){effects.logs++},warn(){effects.logs++}},
    fetch:()=>{effects.relay++;throw Error(secret)},
    importScripts:(...files)=>{if(files.includes('native-editor-diagnostic.js')) vm.runInContext(diagnosticSource,worker)}});
  vm.runInContext(workerSource,worker);
  await new Promise(resolve=>setImmediate(resolve));
  // Test the persisted read-time config, after legacy startup defaulting settles.
  if(options.config)Object.assign(stored.onesRelayConfig,options.config);
  if(options.poisonToken) Object.defineProperty(stored.onesRelayConfig,'token',{get(){effects.poisonReads++;throw Error(secret);}});
  const send=(message={type:'ONES_IDENTITY_BINDING_READ',tabId:1},sender={id:'synthetic-bridge',url:popupUrl})=>
    new Promise((resolve,reject)=>{try{const accepted=handler(message,sender,resolve);assert.equal(accepted,true)}catch(e){reject(e)}});
  return {send,requests,effects,stored,pending,beforePending,started,release:heldResolve,worker,
    setActive:(id,url)=>{activeId=id;activeUrl=url},
    scriptCalls:()=>scriptCalls,assertReadOnly(){assert.equal(effects.debugger,0);assert.equal(effects.relay,0);
      assert.equal(effects.sessionWrites,0);assert.equal(effects.permissionRequests,0);assert.equal(effects.bodyReads,0);
      assert.equal(effects.logs,0);assert.equal(JSON.stringify(pending.onesNativeDiagnosticV1),beforePending)}};
}
function denied(result) {
  assert.equal(result.ok,false);assert.equal(result.validBinding,false);assert.equal(result.readOnly,true);
  assert.equal(Object.hasOwn(result,'privateBinding'),false);assert.equal(JSON.stringify(result).includes(secret),false);
}
test('actual worker and isolated MAIN reader verify one private binding with six fixed read requests',async()=>{
  const h=await harness({poisonToken:true,poisonExtra:true,extraReceipt:true}),r=await h.send();
  assert.equal(r.status,'IDENTITY_BINDING_READ_VERIFIED');assert.equal(r.ok,true);assert.equal(r.validBinding,true);
  assert.equal(r.privacy,'LOCAL_PRIVATE_DO_NOT_SHARE');assert.equal(r.requestCount,6);
  assert.deepEqual(JSON.parse(JSON.stringify(r.privateBinding)),{accountUuid:'user',assigneeUuid:'user',taskUuid:'task',
    resolvedTaskUuid:'task',displayId:'SYN-1',teamUuid:'t',projectUuid:'p',issueTypeUuid:'i',fieldId:'f',fieldType:15});
  assert.deepEqual(Array.from(r.stages,x=>x.stage),stages);
  for(const s of r.stages) assert.equal(new Date(s.capturedAt).toISOString(),s.capturedAt);
  assert.deepEqual(h.requests.map(x=>new URL(x.url).pathname),['/project/api/project/users/me',
    '/project/api/ones-project/team/t/tasks/identifier','/project/api/project/team/t/task/task/info',
    '/project/api/project/team/t/fields','/project/api/project/team/t/field_configs','/project/api/project/users/me']);
  assert.deepEqual(h.requests.map(x=>x.init.method),['GET','POST','GET','GET','GET','GET']);
  for(const {init,url}of h.requests){assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');
    assert.equal(init.cache,'no-store');assert.equal(new URL(url).origin,config.onesOrigin);assert.equal(new URL(url).search,'');}
  assert.deepEqual(JSON.parse(h.requests[1].init.body),{display_id_path:'SYN-1'});
  assert.equal(JSON.stringify(r).includes(secret),false);assert.equal(h.effects.poisonReads,0);h.assertReadOnly();
});
test('canonical owner mismatches, creator confusion and missing identity never create a binding',async()=>{
  for(const changeBody of [
    (i,b)=>{if(i===0)delete b.uuid},(i,b)=>{if(i===0)b.uuid={name:'same display name'}},
    (i,b)=>{if(i===2){b.assign='other';b.owner='user';b.name='same display name'}},
    (i,b)=>{if(i===2)delete b.assign},(i,b)=>{if(i===2)b.assign={uuid:'user'}},
    (i,b)=>{if(i===5)b.uuid='other'}
  ]){const h=await harness({changeBody}),r=await h.send();denied(r);assert.ok(h.requests.length<=6);h.assertReadOnly()}
});
test('task resolver, canonical task and required project/type fields fail closed',async()=>{
  for(const [index,key,value]of [[1,'display_id','SYN-OTHER'],[1,'task_uuid',null],
    [2,'uuid','other'],[2,'project_uuid','other'],[2,'issue_type_uuid','other'],
    [2,'project_uuid',null],[2,'issue_type_uuid',null],[2,'uuid',null]]){
    const h=await harness({changeBody:(i,b)=>{if(i===index){if(value===null)delete b[key];else b[key]=value}}});
    denied(await h.send());assert.ok(h.requests.length<=3);h.assertReadOnly();
  }
});
test('field definition and exact field configuration must be unique and correctly typed',async()=>{
  for(const changeBody of [
    (i,b)=>{if(i===3)b.fields.push({...b.fields[0]})},(i,b)=>{if(i===3)b.fields[0].name='other'},
    (i,b)=>{if(i===3)b.fields[0].type='15'},(i,b)=>{if(i===3)b.fields[0].type=1},
    (i,b)=>{if(i===3)b.fields=[]},(i,b)=>{if(i===3)delete b.fields[0].uuid},
    (i,b)=>{if(i===4)b.field_configs.push({...b.field_configs[0]})},
    (i,b)=>{if(i===4)b.field_configs[0].project_uuid='other'},
    (i,b)=>{if(i===4)delete b.field_configs[0].issue_type_uuid}
  ]){const h=await harness({changeBody});denied(await h.send());assert.ok(h.requests.length<=5);h.assertReadOnly()}
  const h=await harness({changeBody:(i,b)=>{if(i===3)b.fields[0].name='【问题根因】'}});
  assert.equal((await h.send()).ok,true);h.assertReadOnly();
});
test('DOM lineage and configured field node stay bound without reading field content',async()=>{
  for(const options of [{missingDom:true},{duplicateLabel:true},{duplicateDomId:true},{domDriftAt:4},{navigationAt:1}]){
    const h=await harness(options);denied(await h.send());h.assertReadOnly();
  }
});
test('401, HTML, request failures, timeout and poisoned required schema have no raw error escape or retry',async()=>{
  for(const options of [{httpAt:0},{httpAt:0,httpCode:403},{httpAt:0,httpCode:404},
    {htmlAt:2},{errorAt:3},{timeoutAt:0,fastTimeout:true},{poisonRequired:true},
    {scriptThrows:true},{poisonReceipt:true}]){
    const h=await harness(options),r=await h.send();denied(r);assert.ok(h.requests.length<=6);
    if(options.httpAt===0){assert.equal(r.httpStatus,options.httpCode??401);assert.equal(r.stage,'USER_START');
      assert.equal(r.stages.at(-1).stage,'USER_START');assert.ok(Number.isFinite(Date.parse(r.stages.at(-1).capturedAt)));}
    assert.equal(h.effects.poisonReads,0);h.assertReadOnly();
  }
});
test('origin permission, extension sender, write gate, payload and single active tab are preflight guards',async()=>{
  for(const options of [{noPermission:true},{twoTabs:true},{config:{writeEnabled:true}},
    {config:{writeEnabled:undefined}},{config:{onesOrigin:'https://synthetic.invalid/arbitrary'}},
    {config:{teamUuid:''}},{config:{rootCauseFieldId:''}},
    {activeUrl:href.replace('synthetic.invalid','other.invalid')},
    {activeUrl:href.replace('/team/t/','/team/other/')},{activeUrl:href+'?arbitrary=true'}]){
    const h=await harness(options);denied(await h.send());assert.equal(h.scriptCalls(),0);h.assertReadOnly();
  }
  for(const [message,sender]of [
    [{type:'ONES_IDENTITY_BINDING_READ',tabId:1,url:'https://private.invalid'},undefined],
    [{type:'ONES_IDENTITY_BINDING_READ',tabId:1,onesTaskUuids:['a','b']},undefined],
    [{type:'ONES_IDENTITY_BINDING_READ',tabId:1},{id:'other',url:popupUrl}],
    [{type:'ONES_IDENTITY_BINDING_READ',tabId:1},{id:'synthetic-bridge',url:href}],
    [{type:'ONES_IDENTITY_BINDING_READ',tabId:2},undefined]
  ]){const h=await harness();denied(await h.send(message,sender));assert.equal(h.scriptCalls(),0);h.assertReadOnly()}
});
test('tab and necessary non-secret config are rechecked after the MAIN read',async()=>{
  for(const afterScript of [(s,tab)=>tab(),(s,t,url)=>url(),s=>{s.onesRelayConfig.projectUuid='changed'},
    s=>{s.onesRelayConfig.writeEnabled=true}]){
    const h=await harness({afterScript}),r=await h.send();denied(r);assert.equal(h.requests.length,6);h.assertReadOnly();
  }
});
test('identity reads and diagnostic actions share a one-operation lock without touching pending',async()=>{
  const h=await harness({hold:true}),reading=h.send();await h.started;
  denied(await h.send());
  const diag=await h.send({type:'ONES_NATIVE_DIAGNOSTIC_RUN',tabId:1});assert.equal(diag.status,'BLOCKED_IN_FLIGHT');
  h.release();assert.equal((await reading).ok,true);h.assertReadOnly();
  let release,started;
  const gate=new Promise(r=>{release=r}),signal=new Promise(r=>{started=r});
  h.worker.onesNativeEditorDiagnosticRun=async()=>{started();await gate;return{ok:false,status:'SYNTHETIC_STOP'}};
  const running=h.send({type:'ONES_NATIVE_DIAGNOSTIC_RUN',tabId:1});await signal;
  denied(await h.send());release();await running;h.assertReadOnly();
});
test('LAST is private historical observation only, with no request or active-ONES selection',async()=>{
  const h=await harness(),fresh=await h.send();assert.equal(fresh.ok,true);
  h.setActive(2,popupUrl);
  const last=await h.send({type:'ONES_IDENTITY_BINDING_LAST'});
  assert.equal(last.historical,true);assert.equal(last.validBinding,false);assert.equal(last.ok,true);
  assert.equal(last.privateBinding.accountUuid,'user');assert.equal(h.requests.length,6);
  denied(await h.send({type:'ONES_IDENTITY_BINDING_READ',tabId:2}));
  denied(await h.send({type:'ONES_IDENTITY_BINDING_LAST'}));
  assert.equal(JSON.stringify(h.pending).includes(secret),false);h.assertReadOnly();
});
test('expired, changed-config and poisoned cached results cannot expose an effective binding',async()=>{
  for(const mode of ['EXPIRED','INVALID','NAN','FUTURE','CONFIG','POISON']){
    const h=await harness();await h.send();
    const saved=h.pending.onesIdentityBindingReadV1;
    if(mode==='EXPIRED')saved.observedAt='2000-01-01T00:00:00.000Z';
    if(mode==='INVALID')saved.observedAt='not-a-date';
    if(mode==='NAN')saved.observedAt=Number.NaN;
    if(mode==='FUTURE')saved.observedAt=new Date(Date.now()+60000).toISOString();
    if(mode==='CONFIG')h.stored.onesRelayConfig.projectUuid='changed';
    if(mode==='POISON')Object.defineProperty(saved,'receipt',{get(){throw Error(secret)}});
    const last=await h.send({type:'ONES_IDENTITY_BINDING_LAST'});denied(last);
    assert.equal(last.historical,true);assert.equal(h.requests.length,6);h.assertReadOnly();
  }
});
test('a new failed READ replaces a previous success and invalid LAST payloads are rejected',async()=>{
  const h=await harness();await h.send();h.stored.onesRelayConfig.writeEnabled=true;
  denied(await h.send());const last=await h.send({type:'ONES_IDENTITY_BINDING_LAST'});denied(last);
  assert.equal(last.historical,true);assert.equal(h.requests.length,6);
  denied(await h.send({type:'ONES_IDENTITY_BINDING_LAST',url:href}));h.assertReadOnly();
});
