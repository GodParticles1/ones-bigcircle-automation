const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { test } = require('node:test');
const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
const draftKey = 'onesRelaySetupDraftV041';
const token = 'synthetic-test-token';
const flush = () => new Promise((resolve) => setImmediate(resolve));
const clone = (value) => value === undefined ? undefined : structuredClone(value);

// Actual service-worker message handlers + popup run against isolated Chrome API
// storage/permission fakes. No browser, Relay or production network is contacted.
function environment(options = {}) {
  const local = {};
  const session = {};
  const events = [];
  const packets=[],confirmations=[];
  let identityReads=0;
  const prepared={ok:true,status:'DIAGNOSTIC_PREPARED',nonce:'synthetic-nonce',marker:'NDP001122aabbcc',
    recovery:'CANCEL_AND_VERIFY_NO_AUTOMATIC_RESTORE',expiresAt:new Date(Date.now()+60000).toISOString(),
    target:{displayId:'SYN-1',projectUuid:'p',issueTypeUuid:'i',fieldId:'f'}};
  let last={ok:false,status:'NOT_RUN',pendingServerVerification:false};
  let identityLast={ok:false,status:'NOT_VERIFIED',readOnly:true,validBinding:false,historical:true};
  let handler;
  const noEvent = { addListener() {} };
  const background = {
    runtime: {
      onMessage: { addListener(fn) { handler = fn; } },
      onInstalled: noEvent, onStartup: noEvent
    },
    alarms: { get: async () => ({}), create() {}, onAlarm: noEvent },
    storage: { local: {
      get: async (key) => ({ [key]: clone(local[key]) }),
      set: async (obj) => {
        if (obj.onesRelayConfig?.onesOrigin && options.failPersistence) throw new Error('synthetic storage failure');
        Object.assign(local, clone(obj));
        if (obj.onesRelayConfig?.onesOrigin) events.push('CONFIG_PERSISTED');
      }
    } }
  };
  vm.runInNewContext(workerSource, {
    chrome: background, crypto: webcrypto, URL, console, importScripts() {},
    fetch: () => { throw new Error('Unexpected network request'); }
  }, { filename: 'service-worker.js' });
  const sendMessage = (message) => {
    events.push(message.type);
    packets.push(clone(message));
    if(options.stage1&&message.type==='ONES_NATIVE_DIAGNOSTIC_PREPARE')return Promise.resolve(clone(prepared));
    if(options.stage1&&message.type==='ONES_IDENTITY_BINDING_READ'){
      identityReads++;
      if(options.failSecondIdentity&&identityReads===2)return Promise.reject(Error('synthetic identity transport failure'));
      return Promise.resolve({
      ok:true,status:'IDENTITY_BINDING_READ_VERIFIED',readOnly:true,validBinding:!options.historicalIdentity,
      historical:!!options.historicalIdentity,preparedNonce:prepared.nonce,
      privateBinding:{accountUuid:'user',assigneeUuid:'user',taskUuid:'task',resolvedTaskUuid:'task',
        displayId:'SYN-1',teamUuid:'t',projectUuid:'p',issueTypeUuid:'i',fieldId:'f',fieldType:15}});}
    if(options.stage1&&['ONES_NATIVE_DIAGNOSTIC_RUN','ONES_NATIVE_DIAGNOSTIC_CANCEL_PREPARED'].includes(message.type))
      return Promise.resolve({ok:false,status:'SYNTHETIC_STOP',insertTextCount:0,saveDispatched:false});
    if (message.type === 'ONES_NATIVE_DIAGNOSTIC_LAST') return Promise.resolve(clone(last));
    if (message.type === 'ONES_IDENTITY_BINDING_LAST') return Promise.resolve(clone(identityLast));
    return new Promise((resolve) => {
      const handled = handler(clone(message), {}, (response) => resolve(clone(response)));
      assert.equal(handled, true);
    });
  };
  function popup(permission = () => true) {
    const elements = Object.fromEntries([...popupHtml.matchAll(/id="([^"]+)"/g)].map((m) => [m[1], {
      value: '', checked: false, disabled: false, textContent: '', listeners: {},
      addEventListener(event, fn) { this.listeners[event] = fn; }
    }]));
    const chrome = {
      runtime: { sendMessage },
      storage: { session: {
        get: async (key) => ({ [key]: clone(session[key]) }),
        set: async (obj) => { if (options.beforeDraftSet) await options.beforeDraftSet(); Object.assign(session, clone(obj)); events.push('DRAFT_SET'); },
        remove: async (key) => { delete session[key]; events.push('DRAFT_CLEARED'); }
      } },
      permissions: { request: async (request) => { events.push('PERMISSION_REQUEST'); return permission(clone(request)); } },
      tabs: { query: async () => options.stage1?[{id:1,url:'https://synthetic.invalid/project/#/team/t/issue/SYN-1'}]:[] }
    };
    vm.runInNewContext(popupSource, { chrome, URL,document: { getElementById: (id) => elements[id] },
      confirm:text=>{confirmations.push(text);return options.confirm!==false} }, { filename: 'popup.js' });
    return {
      elements,
      click: () => elements.saveConfig.listeners.click(),
      press:id=>elements[id].listeners.click(),
      input: (id) => elements[id].listeners.input(),
      output: () => JSON.parse(elements.output.textContent)
    };
  }
  return { local, session, events,packets,confirmations,prepared, sendMessage, popup,
    setLast: (x) => { last=clone(x); },setIdentityLast:(x)=>{identityLast=clone(x)} };
}

function fill(p, changes = {}) {
  const form = {
    onesOrigin: 'https://synthetic.invalid:8443', teamUuid: 'synthetic_team',
    projectUuid: 'synthetic_project', issueTypeUuid: 'synthetic_issue',
    assigneeDepartmentUuid: 'synthetic_department', rootCauseFieldId: 'synthetic_root',
    relayUrl: 'http://127.0.0.1:18731', relayToken: token, ...changes
  };
  for (const [id, value] of Object.entries(form)) p.elements[id].value = value;
  p.elements.relayEnabled.checked = true;
  p.elements.writeEnabled.checked = false;
}

async function ready(env, permission) {
  const p = env.popup(permission);
  await flush();
  return p;
}

function noTokenOutput(p) {
  assert.equal(p.elements.output.textContent.includes(token), false);
}

test('validated SET and durable background storage precede exact-origin permission request', async () => {
  const env = environment();
  const p = await ready(env, (request) => {
    assert.deepEqual(request, { origins: ['https://synthetic.invalid:8443/*'] });
    assert.equal(env.local.onesRelayConfig.token, token);
    assert.equal(env.session[draftKey], undefined);
    return true;
  });
  fill(p);
  p.input('relayToken');
  await flush();
  env.events.length = 0;
  await p.click();
  assert.ok(env.events.indexOf('ONES_RELAY_SET_CONFIG') < env.events.indexOf('CONFIG_PERSISTED'));
  assert.ok(env.events.indexOf('CONFIG_PERSISTED') < env.events.indexOf('PERMISSION_REQUEST'));
  assert.ok(env.events.indexOf('DRAFT_CLEARED') < env.events.indexOf('PERMISSION_REQUEST'));
  assert.equal(p.output().config.tokenPresent, true);
  assert.equal(p.elements.relayToken.value, '');
  noTokenOutput(p);
});

test('failed durable config storage prevents permission prompt and retains draft', async () => {
  const env = environment({ failPersistence: true });
  const p = await ready(env);
  fill(p);
  p.input('relayToken');
  await flush();
  await p.click();
  assert.equal(env.events.includes('PERMISSION_REQUEST'), false);
  assert.equal(p.output().configSaved, false);
  assert.ok(env.session[draftKey]);
  noTokenOutput(p);
});

test('backend config validation failure prevents optional permission request', async () => {
  for (const changes of [{ teamUuid: '' }, { relayUrl: 'http://remote.invalid:18731' }, { rootCauseFieldId: 'bad field' }, { relayToken: '' }]) {
    const env = environment();
    const p = await ready(env);
    fill(p, changes);
    await p.click();
    assert.equal(env.events.includes('PERMISSION_REQUEST'), false);
    assert.equal(p.output().configSaved, false);
  }
});

test('permission teardown cannot lose already persisted config or restore token from draft', async () => {
  const env = environment();
  const p = await ready(env, () => new Promise(() => {}));
  fill(p);
  p.input('relayToken');
  await flush();
  void p.click(); // Simulate popup teardown: permission continuation never runs.
  await flush();
  assert.equal(env.events.includes('PERMISSION_REQUEST'), true);
  const reopened = await ready(env);
  assert.equal(reopened.elements.onesOrigin.value, 'https://synthetic.invalid:8443');
  assert.equal(reopened.elements.relayToken.value, '');
  assert.equal(reopened.output().config.tokenPresent, true);
  assert.equal(reopened.output().draftPresent, false);
  assert.equal(env.local.onesRelayConfig.token, token);
  noTokenOutput(reopened);
});

test('denied permission preserves config and reopening uses the worker truth', async () => {
  const env = environment();
  const p = await ready(env, () => false);
  fill(p);
  await p.click();
  assert.equal(p.output().ok, false);
  assert.equal(p.output().configSaved, true);
  const reopened = await ready(env);
  assert.equal(reopened.output().config.tokenPresent, true);
  assert.equal(reopened.elements.projectUuid.value, 'synthetic_project');
  assert.equal(reopened.elements.relayToken.value, '');
});

test('cancelled/rejected permission does not roll back persisted config', async () => {
  const env = environment();
  const p = await ready(env, () => { throw new Error('synthetic prompt cancelled'); });
  fill(p);
  await p.click();
  assert.equal(p.output().configSaved, true);
  assert.equal(env.local.onesRelayConfig.token, token);
  assert.equal((await ready(env)).output().config.tokenPresent, true);
});

test('stale pre-save draft cannot override newly persisted worker configuration', async () => {
  const env = environment();
  const p = await ready(env);
  fill(p);
  p.input('relayToken');
  await flush();
  const stale = clone(env.session[draftKey]);
  await p.click();
  stale.form.onesOrigin = 'https://stale.invalid';
  stale.form.token = 'synthetic-stale-token';
  env.session[draftKey] = stale;
  const reopened = await ready(env);
  assert.equal(reopened.elements.onesOrigin.value, 'https://synthetic.invalid:8443');
  assert.equal(reopened.elements.relayToken.value, '');
  assert.equal(reopened.output().draftPresent, false);
});

test('new unsaved edits against unchanged saved config remain a session draft', async () => {
  const env = environment();
  const p = await ready(env, () => false);
  fill(p);
  await p.click();
  p.elements.projectUuid.value = 'unsaved_project';
  p.input('projectUuid');
  await flush();
  const reopened = await ready(env);
  assert.equal(reopened.elements.projectUuid.value, 'unsaved_project');
  assert.equal(reopened.output().config.projectUuid, 'synthetic_project');
  assert.equal(reopened.output().draftPresent, true);
  assert.equal(env.local.onesRelayConfig.projectUuid, 'synthetic_project');
});

test('legacy draft may restore first-time setup but cannot override persisted config', async () => {
  const env = environment();
  env.session[draftKey] = { onesOrigin: 'https://legacy.invalid', token: 'synthetic-legacy-token' };
  const first = await ready(env);
  assert.equal(first.elements.onesOrigin.value, 'https://legacy.invalid');
  fill(first);
  await first.click();
  env.session[draftKey] = { onesOrigin: 'https://stale.invalid', token: 'synthetic-stale-token' };
  const reopened = await ready(env);
  assert.equal(reopened.elements.onesOrigin.value, 'https://synthetic.invalid:8443');
  assert.equal(reopened.elements.relayToken.value, '');
});

test('exact origin rejection occurs before SET and permission request', async () => {
  for (const origin of ['http://synthetic.invalid', 'https://u:p@synthetic.invalid', 'https://synthetic.invalid/path', 'https://synthetic.invalid/?q=x', 'https://synthetic.invalid/#x', 'not a URL']) {
    const env = environment();
    const p = await ready(env);
    fill(p, { onesOrigin: origin });
    env.events.length = 0;
    await p.click();
    assert.equal(env.events.includes('ONES_RELAY_SET_CONFIG'), false);
    assert.equal(env.events.includes('PERMISSION_REQUEST'), false);
  }
});

test('outstanding draft writes drain before permission and cannot reappear after clear', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const env = environment({ beforeDraftSet: () => blocked });
  const p = await ready(env);
  fill(p);
  p.input('relayToken');
  await flush();
  const saving = p.click();
  await flush();
  assert.equal(env.events.includes('CONFIG_PERSISTED'), true);
  assert.equal(env.events.includes('PERMISSION_REQUEST'), false);
  release();
  await saving;
  assert.equal(env.session[draftKey], undefined);
  assert.equal(env.events.filter((event) => event === 'PERMISSION_REQUEST').length, 1);
});

test('double click does not dispatch duplicate config or permission operations', async () => {
  let finish;
  const env = environment();
  const p = await ready(env, () => new Promise((resolve) => { finish = resolve; }));
  fill(p);
  const saving = p.click();
  await flush();
  assert.equal(p.elements.saveConfig.disabled, true);
  await p.click();
  assert.equal(env.events.filter((event) => event === 'ONES_RELAY_SET_CONFIG').length, 1);
  assert.equal(env.events.filter((event) => event === 'PERMISSION_REQUEST').length, 1);
  finish(true);
  await saving;
  assert.equal(p.elements.saveConfig.disabled, false);
});

test('popup reopen restores last metadata only and pending readback without CDP',async()=>{
  const env=environment();
  env.setLast({ok:true,status:'TRACE_EXACT_ONCE',pendingServerVerification:true,
    serverVerification:'PENDING_CANCEL_AND_INDEPENDENT_READ',insertTextCount:1,
    trace:{semantic:'EXACT_ONCE'},secret:'hidden-private'});
  const first=await ready(env);
  await flush();
  assert.match(first.elements.nativeDiagStatus.textContent,/待服务端独立复核/);
  assert.equal(first.elements.nativeDiagOutput.textContent.includes('hidden-private'),false);
  const second=await ready(env);
  await flush();
  assert.match(second.elements.nativeDiagStatus.textContent,/待服务端独立复核/);
  assert.equal(second.elements.nativeDiagOutput.textContent.includes('TRACE_EXACT_ONCE'),true);
  assert.equal(env.events.filter(x=>x==='ONES_NATIVE_DIAGNOSTIC_LAST').length,2);
  assert.equal(env.events.filter(x=>x==='ONES_NATIVE_DIAGNOSTIC_RUN').length,0);
  env.setLast({ok:false,status:'SERVER_BLANK_OBSERVED',pendingServerVerification:false,
    serverVerification:'SERVER_BLANK_OBSERVED'});
  const third=await ready(env);await flush();
  assert.doesNotMatch(third.elements.nativeDiagStatus.textContent,/待服务端/);
  assert.equal(env.events.filter(x=>x==='ONES_NATIVE_DIAGNOSTIC_RUN').length,0);
});
test('popup reopened after ambiguous interruption retains pending warning',async()=>{
 const env=environment();
 env.setLast({ok:false,status:'DIAGNOSTIC_INTERRUPTED',pendingServerVerification:true,interrupted:true});
 const p=await ready(env);await flush();
 assert.match(p.elements.nativeDiagStatus.textContent,/待服务端独立复核/);
 assert.equal(p.elements.nativeDiagOutput.textContent.includes('DIAGNOSTIC_INTERRUPTED'),true);
 assert.equal(env.events.filter(x=>x==='ONES_NATIVE_DIAGNOSTIC_RUN').length,0);
});

test('privacy-safe dirty-block receipt survives popup reopen without diagnostic replay',async()=>{
 const env=environment();
 const secret='SYNTHETIC_CUSTOMER_TEXT_NEVER_EXPORT';
 env.setLast({status:'BLOCKED_DIRTY_DRAFT',insertTextCount:0,saveDispatched:false,
   pendingServerVerification:false,serverVerification:'NOT_VERIFIED',
   preflight:{stage:'INSPECT_2',reason:'UNCLASSIFIED_BLOCK_TEXT',nonemptyBlockCount:1,
    unclassifiedBlockCount:1,authoringSurfaceCount:1,possibleAuthoringCount:0,
    nonvisibleNonemptyCount:0,textareaCount:1,textareaState:'EMPTY',
    maxBlockLength:'ONE_TO_32',maxAuthoringLength:'ZERO',domCaretShape:'NO_DOM_RANGE',
    provenance:{schema:'LEAF_OWNER_V1',nonemptyLeafCount:1,inspectedNodeCount:2,
      maxLeafLength:'ONE_TO_32',unknownLeaves:1,incomplete:false,
      rawText:secret,html:'<private>',url:'https://private.invalid',sha256:'1234',
      arbitraryPayload:{secret}},
    actualText:secret,html:'<private>',url:'https://private.invalid',sha256:'1234'}});
 for(let i=0;i<2;i++){
  const p=await ready(env);await flush();
  assert.match(p.elements.nativeDiagStatus.textContent,/INSPECT_2.*UNCLASSIFIED_BLOCK_TEXT/);
  const shown=p.elements.nativeDiagOutput.textContent;
  assert.equal(shown.includes(secret),false);
  assert.equal(p.elements.nativeDiagOutput.textContent.includes('LEAF_OWNER_V1'),true);
  assert.equal(p.elements.nativeDiagOutput.textContent.includes('unknownLeaves'),true);
  for(const forbidden of ['private.invalid','sha256','actualText','html','<private>'])assert.equal(shown.includes(forbidden),false);
 }
 assert.equal(env.events.filter(x=>x==='ONES_NATIVE_DIAGNOSTIC_RUN').length,0);
});

test('phase focus evidence survives popup reopen through bounded metadata whitelist',async()=>{
 const env=environment(),secret='SYNTHETIC_PRIVATE_PHASE';
 env.setLast({status:'BLOCKED_FOCUS_DRIFT',insertTextCount:0,saveDispatched:false,
  pendingServerVerification:true,phase:'AFTER_NATIVE_CLICK',phases:[
   {stage:'AFTER_NATIVE_CLICK',elapsedMs:481,mutationCount:1,blockCount:2,
    focusedBlockCount:0,sameBoundBlock:false,hostKind:'TEXTAREA',activeHostKind:'TEXTAREA',
    hostConnected:true,blockConnected:true,rootConnected:true,nativeHostFocused:true,
    domRangeCount:0,domCollapsed:true,domInBoundBlock:false,selectionProof:'NATIVE_TEXTAREA_CARET',
    anchorOffset:0,focusOffset:0,raw:secret,
    events:[{type:'beforeinput',inputType:'insertText',trusted:true,raw:secret}]}]});
 for(let i=0;i<2;i++) {
  const p=await ready(env);await flush();
  const shown=JSON.parse(p.elements.nativeDiagOutput.textContent);
  assert.equal(shown.phase,'AFTER_NATIVE_CLICK');
  assert.equal(shown.phases[0].focusedBlockCount,0);
  assert.equal(shown.phases[0].hostKind,'TEXTAREA');
  assert.equal(shown.phases[0].events[0].type,'beforeinput');
  assert.equal(p.elements.nativeDiagOutput.textContent.includes(secret),false);
 }
 env.setLast({status:'BLOCKED_FOCUS_DRIFT',phase:secret,
   phases:Array(100).fill({stage:secret,hostKind:secret,focusedBlockCount:1e9,
    elapsedMs:Infinity,events:Array(100).fill({type:secret,inputType:secret,raw:secret}),raw:secret})});
 const p=await ready(env);await flush();
 const shown=JSON.parse(p.elements.nativeDiagOutput.textContent);
 assert.equal(shown.phase,'UNVERIFIED');assert.equal(shown.phases.length,6);
 assert.equal(shown.phases[0].focusedBlockCount,16);
 assert.equal(shown.phases[0].elapsedMs,0);assert.equal(shown.phases[0].events.length,40);
 assert.equal(p.elements.nativeDiagOutput.textContent.includes(secret),false);
 assert.equal(env.events.filter(x=>x==='ONES_NATIVE_DIAGNOSTIC_RUN').length,0);
});

test('private identity LAST is labeled historical and displayed through a UUID-only whitelist',async()=>{
 const env=environment(),secret='SYNTHETIC_RAW_PRIVATE_IDENTITY_EXTRA';
 env.setIdentityLast({ok:true,status:'IDENTITY_BINDING_READ_VERIFIED',readOnly:true,validBinding:false,historical:true,
  observedAt:'2026-10-23T00:00:00.000Z',requestCount:6,stages:[],raw:secret,
  privateBinding:{accountUuid:'user',assigneeUuid:'user',taskUuid:'task',resolvedTaskUuid:'task',displayId:'SYN-1',
   teamUuid:'t',projectUuid:'p',issueTypeUuid:'i',fieldId:'f',fieldType:15,name:secret,token:secret}});
 const p=await ready(env);await flush();
 const shown=JSON.parse(p.elements.identityBindingOutput.textContent);
 assert.equal(shown.historical,true);assert.equal(shown.validBinding,false);
 assert.equal(shown.privateBinding.accountUuid,'user');
 assert.match(p.elements.identityBindingStatus.textContent,/历史观测，不授写权限/);
 assert.equal(p.elements.identityBindingOutput.textContent.includes(secret),false);
 assert.equal(env.events.filter(x=>x==='ONES_IDENTITY_BINDING_READ').length,0);
 assert.match(popupHtml,/href="popup.html" target="_blank" rel="noopener"/);
 env.setIdentityLast({status:'BLOCKED_READ_HTTP',httpStatus:403,stage:'USER_START',historical:true,
  raw:secret,requestCount:1,stages:[{stage:'USER_START',capturedAt:'2026-10-23T00:00:00.000Z'}]});
 const again=await ready(env);await flush();
 assert.equal(JSON.parse(again.elements.identityBindingOutput.textContent).httpStatus,403);
 assert.equal(JSON.parse(again.elements.identityBindingOutput.textContent).stage,'USER_START');
 assert.equal(again.elements.identityBindingOutput.textContent.includes(secret),false);
 for(const status of ['BLOCKED_READ_FAILED','BLOCKED_READ_TIMEOUT']){
  env.setIdentityLast({status,stage:'FIELD_CONFIG',historical:true,requestCount:5,raw:secret,
    stages:[{stage:'FIELD_SCHEMA',capturedAt:'2026-10-23T00:00:00.000Z'}]});
  const failed=await ready(env);await flush();
  const receipt=JSON.parse(failed.elements.identityBindingOutput.textContent);
  assert.equal(receipt.stage,'FIELD_CONFIG');assert.equal(receipt.stages.at(-1).stage,'FIELD_SCHEMA');
  assert.equal(receipt.status,status);assert.equal(failed.elements.identityBindingOutput.textContent.includes(secret),false);
 }
});

test('Stage1 popup displays the actual prepared marker and confirms that same marker only after fresh identity',async()=>{
 const env=environment({stage1:true}),p=await ready(env);await flush();
 await p.press('nativeDiagRun');assert.equal(env.confirmations.length,0);
 await p.press('nativeDiagPrepare');
 assert.equal(p.elements.nativeDiagPrepared.textContent.includes(env.prepared.marker),true);
 assert.equal(p.elements.nativeDiagPrepared.textContent.includes(env.prepared.recovery),true);
 assert.equal(p.elements.nativeDiagRun.disabled,true);
 await p.press('identityBindingRead');assert.equal(p.elements.nativeDiagRun.disabled,false);
 await p.press('nativeDiagRun');
 assert.equal(env.confirmations.length,1);assert.equal(env.confirmations[0].includes(env.prepared.marker),true);
 assert.equal(env.confirmations[0].includes(env.prepared.recovery),true);
 const run=env.packets.find(x=>x.type==='ONES_NATIVE_DIAGNOSTIC_RUN');
 assert.deepEqual(Object.keys(run).sort(),['confirmed','marker','nonce','recovery','tabId','type']);
 assert.equal(run.marker,env.prepared.marker);assert.equal(run.nonce,env.prepared.nonce);assert.equal(run.confirmed,true);
 await p.press('nativeDiagRun');assert.equal(env.packets.filter(x=>x.type==='ONES_NATIVE_DIAGNOSTIC_RUN').length,1);
});
test('Stage1 popup cancellation and historical identity do not dispatch RUN',async()=>{
 for(const options of [{stage1:true,confirm:false},{stage1:true,historicalIdentity:true}]){
  const env=environment(options),p=await ready(env);await flush();
  await p.press('nativeDiagPrepare');await p.press('identityBindingRead');await p.press('nativeDiagRun');
  assert.equal(env.packets.filter(x=>x.type==='ONES_NATIVE_DIAGNOSTIC_RUN').length,0);
  if(options.confirm===false){const cancel=env.packets.find(x=>x.type==='ONES_NATIVE_DIAGNOSTIC_CANCEL_PREPARED');
    assert.equal(cancel.nonce,env.prepared.nonce);}
  else assert.equal(env.confirmations.length,0);
 }
});
test('Stage1 a failed fresh identity request removes a prior popup-ready indication',async()=>{
 const env=environment({stage1:true,failSecondIdentity:true}),p=await ready(env);await flush();
 await p.press('nativeDiagPrepare');await p.press('identityBindingRead');
 assert.equal(p.elements.nativeDiagRun.disabled,false);
 await p.press('identityBindingRead');assert.equal(p.elements.nativeDiagRun.disabled,true);
 await p.press('nativeDiagRun');assert.equal(env.confirmations.length,0);
 assert.equal(env.packets.filter(x=>x.type==='ONES_NATIVE_DIAGNOSTIC_RUN').length,0);
});
test('FIELD_SCHEMA popup projects only fixed invariant enums and bounded numeric type',async()=>{
 const env=environment();env.setIdentityLast({status:'BLOCKED_FIELD_SCHEMA',historical:true,
   fieldInvariant:'TARGET_TYPE_NOT_15',fieldTypeCode:8,raw:'PRIVATE_EXTRA'});
 const p=await ready(env);await flush();let r=JSON.parse(p.elements.identityBindingOutput.textContent);
 assert.equal(r.fieldInvariant,'TARGET_TYPE_NOT_15');assert.equal(r.fieldTypeCode,8);
 env.setIdentityLast({status:'BLOCKED_FIELD_SCHEMA',fieldInvariant:'PRIVATE_EXTRA',fieldTypeCode:999});
 const other=await ready(env);await flush();r=JSON.parse(other.elements.identityBindingOutput.textContent);
 assert.equal(r.fieldInvariant,undefined);assert.equal(r.fieldTypeCode,undefined);
 assert.equal(other.elements.identityBindingOutput.textContent.includes('PRIVATE_EXTRA'),false);
});

test('popup preserves validated richtext type UUID and rejects missing, invalid or contradictory type bindings',async()=>{
 const binding={accountUuid:'user',assigneeUuid:'user',taskUuid:'task',resolvedTaskUuid:'task',displayId:'SYN-1',
  teamUuid:'t',projectUuid:'p',issueTypeUuid:'i',fieldId:'f',fieldType:'richtext',fieldTypeUuid:'synthetic-richtext-type'};
 const receipt={ok:true,status:'IDENTITY_BINDING_READ_VERIFIED',readOnly:true,validBinding:false,historical:true,
  privateBinding:binding};
 const env=environment();env.setIdentityLast(receipt);const p=await ready(env);await flush();
 let shown=JSON.parse(p.elements.identityBindingOutput.textContent);
 assert.equal(shown.privateBinding.fieldType,'richtext');assert.equal(shown.privateBinding.fieldTypeUuid,'synthetic-richtext-type');
 assert.equal(shown.validBinding,false);assert.equal(shown.historical,true);
 for(const privateBinding of [{...binding,fieldTypeUuid:undefined},{...binding,fieldTypeUuid:'bad/id'},
  {...binding,fieldType:15},{...binding,fieldType:'15'}]){
  env.setIdentityLast({...receipt,privateBinding});const invalid=await ready(env);await flush();
  shown=JSON.parse(invalid.elements.identityBindingOutput.textContent);
  assert.equal(shown.ok,false);assert.equal(shown.privateBinding,undefined);
 }
 env.setIdentityLast({status:'BLOCKED_FIELD_SCHEMA',fieldInvariant:'TARGET_TYPE_UNSUPPORTED',fieldTypeCode:8,raw:'PRIVATE_EXTRA'});
 const failed=await ready(env);await flush();shown=JSON.parse(failed.elements.identityBindingOutput.textContent);
 assert.equal(shown.fieldInvariant,'TARGET_TYPE_UNSUPPORTED');assert.equal(shown.fieldTypeCode,8);
 assert.equal(failed.elements.identityBindingOutput.textContent.includes('PRIVATE_EXTRA'),false);
});
