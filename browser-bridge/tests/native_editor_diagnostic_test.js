const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {test} = require("node:test");
const {webcrypto} = require("node:crypto");
const {performance:hostPerformance} = require("node:perf_hooks");
const source = fs.readFileSync(require("node:path").join(__dirname,"..","native-editor-diagnostic.js"),"utf8");
const workerScopeSource=fs.readFileSync(require('node:path').join(__dirname,'..','service-worker.js'),'utf8');
const actualScopeValidators=workerScopeSource.slice(workerScopeSource.indexOf('function normalizeOnesOrigin('),
  workerScopeSource.indexOf('function validateInventoryUrl('));
const href="https://synthetic.invalid/project/#/team/t/project/p/issue/SYN-1";
const config={writeEnabled:false,rootCauseFieldId:"f",onesOrigin:"https://synthetic.invalid",teamUuid:"t",projectUuid:"p",issueTypeUuid:"i"};
function harness(opts={}) {
  const sent=[],store={},events={},observers=[],undeliveredMutations=[],fieldReads=[];
  let virtualTime=0;
  const now=()=>opts.realTimers?hostPerformance.now():virtualTime;
  const rect={left:30,top:40,right:230,height:25,width:200};
  const textSurface={textContent:opts.authoringText||""};
  const block={textContent:opts.authoringText||opts.accessoryText||(opts.dirty?"synthetic draft":""),
    isConnected:true,classList:{contains:(name)=>name==='focused' && !opts.noFocus},
    querySelectorAll:(q)=>q===".text"&&!opts.noTextSurface&&(opts.authoringText||opts.accessoryText||opts.emptySurface)?[textSurface]:[],
    getBoundingClientRect:()=>rect,contains:(x)=>x===block||x===anchor};
  const hiddenBlock={textContent:opts.hiddenDraft||"",isConnected:true,classList:{contains:(name)=>name==='focused' && !!opts.extraFocused},
    querySelectorAll:q=>q===".text"?[{textContent:opts.hiddenDraft||""}]:[],
    getBoundingClientRect:()=>rect,contains:(x)=>x===hiddenBlock};
  // Real DOM-shaped, synthetic-only text ownership fixtures. Never use real editor content.
  const leafText=opts.authoringText||opts.accessoryText||(opts.dirty?'synthetic draft':'');
  const leafOwner={nodeType:1,tagName:opts.ownerTag||'SPAN',parentElement:block,
    classList:{contains:(name)=>name==='text'&&!!opts.authoringText ||
      name==='placeholder'&&!!opts.placeholderLeaf},
    getAttribute:(name)=>name==='role'&&opts.controlLeaf?'button':
      name==='contenteditable'&&opts.editableLeaf?'true':
      name==='aria-hidden'&&opts.hiddenLeaf?'true':null,
    hasAttribute:(name)=>name==='data-placeholder'&&!!opts.placeholderLeaf ||
      name==='aria-hidden'&&!!opts.hiddenLeaf,
    childNodes:[]};
  const leafNode={nodeType:3,nodeValue:leafText,parentElement:leafOwner};
  leafOwner.childNodes=leafText?[leafNode]:[];
  block.childNodes=leafText?[leafOwner]:[];
  if(opts.hugeChildList) {
    // Synthetic NodeList with a large declared length and forbidden iterator.
    // The production probe must not spread/scan the entire collection.
    block.childNodes={length:1000000,0:leafOwner,
      [Symbol.iterator](){throw Error('SYNTHETIC_UNBOUNDED_ITERATOR');}};
  }
  const anchor={nodeType:3,parentElement:block};
  const foreign={nodeType:3,parentElement:{closest:()=>opts.foreignEditor?{id:"other-editor"}:null}};
  const selection={anchorNode:anchor,focusNode:anchor,anchorOffset:0,focusOffset:0,rangeCount:1,isCollapsed:true};
  if(opts.emptySelection || opts.popupDomLost) selection.rangeCount=0;
  if(opts.outsideSelection) {selection.anchorNode=foreign;selection.focusNode=foreign;}
  if(opts.competingRange) selection.isCollapsed=false;
  const textarea={tagName:"TEXTAREA",value:"",selectionStart:0,selectionEnd:0,
    disabled:false,readOnly:false,isConnected:true,contains:()=>false,closest:()=>null};
  const host={isConnected:true,contains:x=>x===block,closest:()=>host,isContentEditable:true};
  let finishing=false,finishMutationApplied=false,lateBlock=null;
  let active=opts.textarea?textarea:host;
  if(opts.popupBlur) active=null;
  if(opts.wrongHost) active={tagName:"INPUT"};
  if(opts.siblingHost) active={tagName:"TEXTAREA",value:"",selectionStart:0,selectionEnd:0};
  if(opts.badTextarea || opts.typedDraftTextarea) textarea.value="synthetic unsaved draft";
  if(opts.badTextareaSelection) textarea.selectionEnd=1;
  const root={id:"f",isConnected:true,contains:x=>[root,host,block,anchor,lateBlock,...(opts.textarea?[textarea]:[])].includes(x),
    querySelectorAll:q=>q==="textarea.editor-input"?opts.textarea?[textarea,...(opts.twoTextareas?[{...textarea}]:[])]:[]:
      q==='[contenteditable="true"]'?opts.textarea?[]:[host]:
      q.startsWith(".text-block[")?[...(opts.hiddenDraft||opts.extraFocused?[block,hiddenBlock]:[block]),...(lateBlock?[lateBlock]:[])]:[block],
    getBoundingClientRect:()=>rect};
  const doc={get activeElement(){return active},body:{},documentElement:{},hasFocus:()=>!opts.popupBlur,querySelectorAll:q=>q==="[id]"?[root]:q.startsWith("div.standard-")?opts.noEditor?[]:[root]:[],
    querySelector:()=>null,elementFromPoint:()=>block,
    createRange:()=>{let n=0;return{selectNodeContents(){},setEnd(_x,v){n=v},toString:()=>"a".repeat(n)}},
    addEventListener:(n,f)=>(events[n] ||= []).push(f),removeEventListener:(n,f)=>events[n]=(events[n]||[]).filter(x=>x!==f)};
  const location={href,origin:config.onesOrigin,pathname:new URL(href).pathname};
  const chrome={tabs:{query:async()=>[{id:1,url:opts.changedHash?href.replace("/team/t/","/team/other/"):href}],get:async()=>({url:opts.badTab?href+"/wrong":opts.changedHash?href.replace("/team/t/","/team/other/"):href,status:"complete"})},
    permissions:{contains:async()=>true},storage:{session:{get:async k=>({[k]:store[k]}),set:async v=>Object.assign(store,v)}},
    scripting:{executeScript:async({func,args})=>{
      if(func.name==="nedPageControl" && args[0]?.action==="BEFORE_INSERT" && opts.rebindBeforeInsert) {
        block.isConnected=false;
        for(const f of observers) f();
      }
      if(func.name==="nedPageControl" && args[0]?.action==="INSPECT") {
        opts.inspectCalls=(opts.inspectCalls||0)+1;
        if(opts.secondInspectSelectionLost && opts.inspectCalls===2) {
          selection.rangeCount=0; selection.anchorNode=null; selection.focusNode=null;
        }
        if (opts.dirtyAtInspect===opts.inspectCalls) {
          block.textContent="SYNTHETIC_PRIVATE_DRAFT_ONLY_IN_PAGE";
          leafNode.nodeValue=block.textContent;
          leafOwner.childNodes=[leafNode];block.childNodes=[leafOwner];
          textSurface.textContent="SYNTHETIC_PRIVATE_DRAFT_ONLY_IN_PAGE";
          opts.authoringText=textSurface.textContent;
        }
      }
      if(func.name==="nedPageControl" && args[0]?.action==="FINISH") finishing=true;
      const result=await func(...args);
      finishing=false;
      if(func.name==="nedPageControl" && args[0]?.action==="AFTER_NATIVE_CLICK" && opts.poisonPhase) {
        result.phases=[{stage:"PRIVATE_RAW_STAGE",activeHostKind:"PRIVATE_RAW_VALUE",focusedBlockCount:1e9,
          elapsedMs:Infinity,raw:"SYNTHETIC_PRIVATE_PHASE",events:Array(100).fill({type:"PRIVATE_EVENT"})}];
      }
      return [{result}];
    }},
    debugger:{attach:async()=>{if(opts.conflict)throw Error("private debugger details")},detach:async()=>{},
      sendCommand:async(_t,method,args)=>{
        sent.push(method);
        if(method==="Input.dispatchMouseEvent" && args.type==="mouseReleased") {
          if(opts.popupBlur && !opts.noClickFocus) { active=opts.textarea?textarea:host; opts.popupBlur=false; }
          if(opts.postClickSelectionInvalid) {selection.rangeCount=0;selection.anchorNode=null;selection.focusNode=null;}
          if(opts.postClickTextareaRange) textarea.selectionEnd=1;
          if(opts.postClickWrongHost) active={tagName:"INPUT"};
          if(opts.clickFocusDrift) opts.noFocus=true;
          if(opts.navigateAfterClick) opts.badTab=true;
        }
        if(method==="Input.dispatchKeyEvent" && args.type==="keyUp") {
          if(opts.ctrlAFocusDrift) opts.noFocus=true;
          if(opts.ctrlAMultipleBlocks) opts.extraFocused=true;
          if(opts.ctrlASelectionDrift) selection.isCollapsed=false;
        }
        if(method==="Input.insertText"){
          const event={target:block,isTrusted:true,inputType:"insertText",cancelable:true,defaultPrevented:false,isComposing:false};
          for(const f of events.beforeinput||[]) f(event);
          block.textContent=opts.partial?args.text.slice(0,4):opts.duplicate?args.text+args.text:args.text;
          textSurface.textContent=block.textContent;
          for(const f of events.input||[])f(event);
          for(const f of observers)f();
          if(opts.throwAfter)throw Error("secret token private endpoint");
        }
      }}
  };
  // Pause actual digest work only after FINISH has captured its input state.
  // This models the diagnostic's async observation boundary, not ONES input behavior.
  const diagnosticCrypto={randomUUID:()=>webcrypto.randomUUID(),
    getRandomValues:value=>webcrypto.getRandomValues(value),
    subtle:{digest:async(...args)=>{
      if(finishing && opts.finishMutation && !finishMutationApplied) {
        finishMutationApplied=true;
        await new Promise(resolve=>setImmediate(resolve));
        if(opts.finishMutation==="EXTRA_BLOCK") {
          lateBlock={textContent:block.textContent,isConnected:true,
            classList:{contains:()=>false},getBoundingClientRect:()=>rect,
            contains:node=>node===lateBlock};
        } else if(opts.finishMutation==="REBIND_BLOCK") block.isConnected=false;
        else if(opts.finishMutation==="DETACH_REATTACH") {block.isConnected=false;block.isConnected=true;}
        else if(opts.finishMutation==="PARTIAL") block.textContent=block.textContent.slice(0,4);
        else if(opts.finishMutation==="DETACH_HOST") (opts.textarea?textarea:host).isConnected=false;
        else if(opts.finishMutation==="ROOT_REPLACED") opts.noEditor=true;
        else if(opts.finishMutation==="FOCUS_DRIFT") opts.noFocus=true;
        // Focus-class changes are not covered by the text/child-list observer.
        // A delayed observer fixture also checks that fresh DOM queries matter.
        if(opts.finishMutation!=="FOCUS_DRIFT" && !opts.finishDelayObserver) {
          for(const observer of observers) observer();
        } else if(opts.finishDelayObserver) {
          undeliveredMutations.push({type:"childList"});
        }
      }
      return webcrypto.subtle.digest(...args);
    }}};
  const context=vm.createContext({chrome,URL,crypto:diagnosticCrypto,TextEncoder,window:{getSelection:()=>selection,APP_VERSION:"3.14.0"},
    document:doc,location,fetch:async()=>({ok:!opts.badIdentity,json:async()=>({display_id:"SYN-1",task_uuid:"task"})}),
    getComputedStyle:(node)=>({display:node===hiddenBlock&&!opts.extraFocused||node===leafOwner&&opts.hiddenLeaf?"none":"block",visibility:"visible",opacity:"1"}),innerWidth:1000,innerHeight:1000,
    MutationObserver:class{constructor(f){this.f=f}observe(){observers.push(this.f)}
      takeRecords(){return undeliveredMutations.splice(0)}
      disconnect(){const i=observers.indexOf(this.f);if(i>=0)observers.splice(i,1);undeliveredMutations.length=0}},
    // Virtual time accelerates locator tests only. The interval regression below
    // uses actual host timers and a deferred first authoritative result.
    performance:{now},queueMicrotask,setTimeout:(f,ms)=>opts.realTimers?setTimeout(f,ms):
      (virtualTime+=Number(ms)||0,setImmediate(f)),console,
    relayReadTaskFields:async(_s,p)=>{
      const row={dispatch:now()};fieldReads.push(row);
      if(fieldReads.length===1&&opts.firstReadDelayMs)await new Promise(r=>setTimeout(r,opts.firstReadDelayMs));
      const bad=opts.badRead||(fieldReads.length===1&&opts.firstReadState==='UNKNOWN');
      const nonempty=opts.nonempty||(fieldReads.length===1&&opts.firstReadState==='NONEMPTY');
      const result={ok:!bad,complete:!bad,readOnly:true,requestedTaskCount:1,fieldId:p.fieldId,
        reads:[{status:"READ_VERIFIED",onesTaskUuid:"task",fieldId:p.fieldId,value:nonempty?"something":""}]};
      row.complete=now();return result;
    }});
  vm.runInContext(actualScopeValidators,context);
  vm.runInContext(source,context);
  // Unit fixture for the already-authorized NATIVE core. Real identity/consent
  // acquisition is covered separately through the actual worker message path.
  const execution={run:'synthetic-run',marker:'NDP0123456789ab',taskUuid:'task',href,
    guard:async()=>!opts.executionDrift&&!(opts.stopAfterSecondRead&&fieldReads.length>=2)&&
      !(opts.rejectBeforeInsert&&sent.length>=5)};
  return {sent,root,opts,execution,fieldReads,currentText:()=>block.textContent,
    armed:()=>!!context.window[Symbol.for('ones.native.editor.diagnostic.v1')],
    blur:()=>{active=null;opts.popupBlur=true},finishMutationApplied:()=>finishMutationApplied,
    run:(c=config,e=execution)=>context.onesNativeEditorDiagnosticRun(c,1,e),
    runWithoutExecution:()=>context.onesNativeEditorDiagnosticRun(config,1),
    verify:()=>context.onesNativeEditorDiagnosticVerify(config,1),last:()=>context.onesNativeEditorDiagnosticLast()};
}
test("unprepared or mismatched execution never reaches native commands",async()=>{
  const missing=harness();await missing.runWithoutExecution();
  assert.equal(missing.sent.length,0);assert.equal(missing.fieldReads.length,0);
  for(const delta of [{marker:'another-marker'},{taskUuid:'another-task'},{href:href+'/other'},
    {run:''},{guard:null}]){
    const h=harness();await h.run(config,{...h.execution,...delta});
    assert.equal(h.sent.length,0);assert.equal(h.fieldReads.length,0);
  }
});
test("the sole inserted marker is the exact prepared value",async()=>{
  const h=harness(),r=await h.run();assert.equal(r.status,'TRACE_EXACT_ONCE');
  assert.equal(h.currentText(),h.execution.marker);
  assert.equal(h.sent.filter(x=>x==='Input.insertText').length,1);
});
test("native core accepts the exact necessary identity scope without unrelated department configuration",async()=>{
  const h=harness(),r=await h.run();
  assert.equal(Object.hasOwn(config,'assigneeDepartmentUuid'),false);
  assert.equal(r.status,'TRACE_EXACT_ONCE');
});
test("execution guard rejection stops before any native command",async()=>{
  const h=harness({executionDrift:true});await h.run();
  assert.equal(h.sent.length,0);assert.equal(h.fieldReads.length,0);
});
test("late execution rejection counts zero inserts but a dispatched uncertain insert counts one",async()=>{
  const denied=harness({rejectBeforeInsert:true}),blocked=await denied.run();
  assert.equal(denied.sent.filter(x=>x==='Input.insertText').length,0);
  assert.equal(blocked.insertTextCount,0);
  assert.equal((await denied.last()).pendingServerVerification,true);
  assert.equal((await denied.run()).status,'BLOCKED_PENDING_SERVER_VERIFICATION');
  const uncertain=harness({throwAfter:true}),result=await uncertain.run();
  assert.equal(uncertain.sent.filter(x=>x==='Input.insertText').length,1);
  assert.equal(result.insertTextCount,1);
  assert.equal((await uncertain.last()).pendingServerVerification,true);
});
test("first failed or nonempty authoritative read never dispatches a second",async()=>{
  for(const firstReadState of ['UNKNOWN','NONEMPTY']){
    const h=harness({firstReadState});await h.run();
    assert.equal(h.fieldReads.length,1);assert.equal(h.sent.length,0);
  }
});
test("real elapsed pre-read interval starts after the deferred successful first completion",async(t)=>{
  const h=harness({realTimers:true,firstReadDelayMs:35,stopAfterSecondRead:true});await h.run();
  assert.equal(h.fieldReads.length,2);
  assert.ok(h.fieldReads[0].complete-h.fieldReads[0].dispatch>=30);
  const elapsed=h.fieldReads[1].dispatch-h.fieldReads[0].complete;
  t.diagnostic(JSON.stringify({clock:'host_monotonic',firstCompleted:h.fieldReads[0].complete,
    secondDispatched:h.fieldReads[1].dispatch,elapsedMs:elapsed,minimumMs:750}));
  assert.ok(elapsed>=750,`real first-completion to second-dispatch interval: ${elapsed}ms`);
  assert.equal(h.sent.length,0);
});
test("one insert, metadata-only events, zero Save",async()=>{const h=harness(),r=await h.run();
  assert.equal(r.status,"TRACE_EXACT_ONCE");assert.equal(r.trace.semantic,"EXACT_ONCE");
  assert.equal(r.trace.observationStable,true);assert.equal(r.trace.pendingMutationRecordCount,0);
  assert.equal(r.trace.events.some(e=>e.type==="beforeinput"&&e.trusted),true);
  assert.equal(r.trace.samples.some(e=>e.kind==="MUTATION"),true);
  assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
  assert.equal(JSON.stringify(r).includes("NDP"),false);
  assert.equal(h.sent.includes("Save"),false);
  h.root.isConnected=false;
  assert.equal((await h.verify()).status,"SERVER_BLANK_OBSERVED");
});
test("synthetic duplicate and partial DOM states are rejected",async()=>{for(const key of ["duplicate","partial"]){const h=harness({[key]:true}),r=await h.run();assert.equal(r.status,"TRACE_MISMATCH");assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);assert.equal(r.saveDispatched,false)}});

test("FINISH preserves negative DOM states but refuses an unsettled exact observation",async()=>{
  for(const finishMutation of ["OBSERVATION_ONLY","EXTRA_BLOCK","PARTIAL"]) {
    const h=harness({finishMutation}),r=await h.run();
    assert.equal(h.finishMutationApplied(),true);
    assert.equal(r.status,finishMutation==="OBSERVATION_ONLY"?"TRACE_UNCERTAIN":"TRACE_MISMATCH");
    assert.equal(r.trace.observationStable,false);
    assert.equal(r.trace.semantic,finishMutation==="EXTRA_BLOCK"?"DUPLICATE":
      finishMutation==="PARTIAL"?"PARTIAL":"OBSERVATION_UNSTABLE");
    assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
    assert.equal(r.saveDispatched,false);
    assert.equal(h.armed(),false);
    assert.equal((await h.last()).pendingServerVerification,true);
    assert.equal((await h.run()).status,"BLOCKED_PENDING_SERVER_VERIFICATION");
    assert.equal(JSON.stringify(r).includes("NDP"),false);
  }
});

test("FINISH revalidates binding and focus after asynchronous digest work",async()=>{
  for(const options of [
    {finishMutation:"REBIND_BLOCK"},{finishMutation:"ROOT_REPLACED"},
    {finishMutation:"DETACH_HOST"},{finishMutation:"DETACH_HOST",textarea:true},
    {finishMutation:"FOCUS_DRIFT"}
  ]) {
    const h=harness(options),r=await h.run();
    assert.equal(h.finishMutationApplied(),true);
    assert.equal(r.status,"TRACE_MISMATCH");
    assert.equal(r.trace.semantic,"EDITOR_DRIFT");
    assert.equal(r.trace.hostBound,false);
    assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
    assert.equal(r.saveDispatched,false);
    assert.equal((await h.last()).pendingServerVerification,true);
    assert.equal((await h.run()).status,"BLOCKED_PENDING_SERVER_VERIFICATION");
  }
});

test("FINISH classifies fresh blocks even before an observer notification",async()=>{
  const h=harness({finishMutation:"EXTRA_BLOCK",finishDelayObserver:true}),r=await h.run();
  assert.equal(h.finishMutationApplied(),true);
  assert.equal(r.status,"TRACE_MISMATCH");
  assert.equal(r.trace.semantic,"DUPLICATE");
  assert.equal(r.trace.blockCount,2);
  assert.equal(r.trace.observationStable,false);
  assert.equal(r.trace.pendingMutationRecordCount,1);
  assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
  assert.equal(r.saveDispatched,false);
  assert.equal((await h.run()).status,"BLOCKED_PENDING_SERVER_VERIFICATION");
});

test("FINISH rejects queued detach/reattach records before observer delivery",async()=>{
  const h=harness({finishMutation:"DETACH_REATTACH",finishDelayObserver:true}),r=await h.run();
  assert.equal(h.finishMutationApplied(),true);
  assert.equal(r.status,"TRACE_UNCERTAIN");
  assert.equal(r.trace.semantic,"OBSERVATION_UNSTABLE");
  assert.equal(r.trace.observationStable,false);
  assert.equal(r.trace.pendingMutationRecordCount,1);
  assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
  assert.equal(r.saveDispatched,false);
  const last=await h.last();
  assert.equal(last.trace.pendingMutationRecordCount,1);
  assert.equal(last.pendingServerVerification,true);
  assert.equal((await h.run()).status,"BLOCKED_PENDING_SERVER_VERIFICATION");
});
test("preflight rejects gate, dirty draft, unknown server, editor absence, wrong tab and debugger conflict",async()=>{
  for(const [c,o] of [[{writeEnabled:true},{}],[{}, {dirty:true}],[{}, {nonempty:true}],
    [{},{badRead:true}],[{}, {noEditor:true}],[{}, {badTab:true}],[{}, {conflict:true}],
    [{},{noFocus:true}],[{}, {badIdentity:true}]]) {
    const h=harness(o),r=await h.run({...config,...c});
    assert.match(r.status,/^BLOCKED_/);
    assert.equal(h.sent.includes("Input.insertText"),false);
    assert.equal(r.saveDispatched,false);
  }
});
test("uncertain delivery does not retry, server change is escalated",async()=>{
  const h=harness({throwAfter:true}),r=await h.run();
  assert.equal(r.status,"TRACE_UNCERTAIN");assert.equal(r.insertTextCount,1);
  assert.equal((await h.run()).status,"BLOCKED_PENDING_SERVER_VERIFICATION");
  assert.equal(JSON.stringify(r).includes("secret"),false);
  const x=harness();await x.run();x.root.isConnected=false;x.opts.nonempty=true;
  assert.equal((await x.verify()).status,"SERVER_CHANGED_ESCALATE");
});
test("synthetic multi-ticket uses independent one-item fixtures, no real batch",async()=>{
  for(let i=0;i<3;i++){const h=harness({duplicate:i===1});await h.run();assert.ok(h.sent.filter(x=>x==="Input.insertText").length<=1);assert.equal(h.sent.includes("Save"),false)}
});

test("textarea native host and popup blur recover only by exact click reacquisition",async()=>{
  for(const opts of [{textarea:true},{textarea:true,popupBlur:true},{popupBlur:true}]) {
    const h=harness(opts),r=await h.run();
    assert.equal(r.status,"TRACE_EXACT_ONCE");
    assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
    assert.equal(r.saveDispatched,false);
  }
});
test("wrong textarea/sibling/ambiguous host and selection fail closed",async()=>{
  for(const opts of [{textarea:true,twoTextareas:true},{textarea:true,badTextarea:true},
    {textarea:true,badTextareaSelection:true},{textarea:true,siblingHost:true},
    {wrongHost:true},{textarea:true,wrongHost:true}]) {
    const h=harness(opts),r=await h.run();
    assert.match(r.status,/^BLOCKED_/);
    assert.equal(h.sent.filter(x=>x==="Input.insertText").length,0);
  }
});
test("LAST is metadata only; pending, completed and interrupted states do not reinsert",async()=>{
  const h=harness();const first=await h.run();
  assert.equal(first.status,"TRACE_EXACT_ONCE");
  assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
  assert.equal((await h.last()).pendingServerVerification,true);
  h.root.isConnected=false;
  assert.equal((await h.verify()).status,"SERVER_BLANK_OBSERVED");
  const done=await h.last();
  assert.equal(done.pendingServerVerification,false);
  assert.equal(done.serverVerification,"SERVER_BLANK_OBSERVED");
  assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
});

test("real-shaped hash route reaches exactly one diagnostic input",async()=>{
 const h=harness();const r=await h.run();
 assert.equal(r.status,"TRACE_EXACT_ONCE");
 assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
});
test("cross-team hash and hash navigation fail before insertion",async()=>{
 const h=harness({changedHash:true});const r=await h.run();
 assert.match(r.status,/^BLOCKED_/);assert.equal(h.sent.includes("Input.insertText"),false);
});

test("genuine textarea caret survives empty or out-of-block DOM Selection without forging a range",async()=>{
 for(const opts of [{textarea:true,emptySelection:true},{textarea:true,outsideSelection:true},
  {textarea:true,popupBlur:true,emptySelection:true}]) {
  const h=harness(opts),r=await h.run();
  assert.equal(r.status,"TRACE_EXACT_ONCE");
  assert.equal(r.trace.selection.selectionProof,"NATIVE_TEXTAREA_CARET");
  assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
  assert.equal(h.sent.includes("Save"),false);
 }
});
test("popup-blurred contenteditable may defer DOM proof but post-click must prove the real caret",async()=>{
 const good=harness({popupBlur:true,emptySelection:true}),ok=await good.run();
 assert.equal(ok.status,"BLOCKED_SELECTION_DRIFT"); // synthetic never manufactures the missing DOM caret
 assert.equal(good.sent.includes("Input.insertText"),false);
 const bad=harness({popupBlur:true,emptySelection:true,noClickFocus:true}),fail=await bad.run();
 assert.match(fail.status,/^BLOCKED_/);assert.equal(bad.sent.includes("Input.insertText"),false);
});
test("wrong host, competing selection, second preflight loss and post-click drift fail closed",async()=>{
 const patterns=[{textarea:true,competingRange:true},{textarea:true,outsideSelection:true,foreignEditor:true},
  {textarea:true,outsideSelection:true,wrongHost:true},
  {textarea:true,emptySelection:true,postClickWrongHost:true},
  {textarea:true,emptySelection:true,postClickTextareaRange:true},
  {textarea:true,emptySelection:true,secondInspectSelectionLost:true,postClickWrongHost:true},
  {textarea:true,twoTextareas:true,emptySelection:true},
  {textarea:true,popupBlur:true,emptySelection:true,noClickFocus:true}];
 for(const opts of patterns) {
  const h=harness(opts),r=await h.run();
  assert.match(r.status,/^BLOCKED_/);
  assert.equal(h.sent.filter(x=>x==="Input.insertText").length,0);
  assert.equal(r.saveDispatched,false);
 }
});
test("pre-click selection and post-click failures persist exact receipt without retries",async()=>{
 const arm=harness({textarea:true,competingRange:true});
 assert.equal((await arm.run()).status,"BLOCKED_SELECTION");
 const lastArm=await arm.last();
 assert.equal(lastArm.status,"BLOCKED_SELECTION");assert.equal(lastArm.pendingServerVerification,false);
 assert.equal(lastArm.serverVerification,"NOT_VERIFIED");
 assert.equal(arm.sent.length,0);
 const inspect=harness({popupBlur:true,emptySelection:true});
 const response=await inspect.run();
 assert.equal(response.status,"BLOCKED_SELECTION_DRIFT");
 assert.equal((await inspect.last()).status,response.status);
 assert.equal((await inspect.last()).pendingServerVerification,true);
 assert.equal(inspect.sent.includes("Input.insertText"),false);
 const post=harness({textarea:true,emptySelection:true,postClickWrongHost:true});
 const blocked=await post.run();
 assert.equal((await post.last()).status,blocked.status);
 assert.equal((await post.last()).pendingServerVerification,true);
 assert.equal(post.sent.filter(x=>x==="Input.insertText").length,0);
 assert.equal((await post.run()).status,"BLOCKED_PENDING_SERVER_VERIFICATION");
});

test("visible-blank authoring surface plus unproven accessory text is classified, never ignored",async()=>{
  const secret="SYNTHETIC_NONAUTHORING_CANDIDATE_PRIVATE_STRING";
  const h=harness({accessoryText:secret});
  const r=await h.run(),last=await h.last();
  assert.equal(r.status,"BLOCKED_DIRTY_DRAFT");
  assert.equal(r.preflight.stage,"ARM");
  assert.equal(r.preflight.reason,"UNCLASSIFIED_BLOCK_TEXT");
  assert.equal(r.preflight.possibleAuthoringCount,0);
  assert.equal(r.preflight.unclassifiedBlockCount,1);
  assert.equal(r.preflight.ownershipProof,"NOT_ESTABLISHED");
  assert.equal(last.preflight.reason,"UNCLASSIFIED_BLOCK_TEXT");
  assert.equal(last.pendingServerVerification,false);
  assert.equal(h.sent.length,0);
  for(const receipt of [r,last]) {
    assert.equal(JSON.stringify(receipt).includes(secret),false);
    assert.equal(JSON.stringify(receipt).includes("synthetic.invalid"),false);
    assert.equal(JSON.stringify(receipt).includes("sha256"),false);
  }
});
test("actual authoring text, obscured text block and textarea value all independently block",async()=>{
  const cases=[
    [{authoringText:"SYNTHETIC_GENUINE_DRAFT"}, "AUTHORING_SURFACE_CONTENT",1,0],
    [{hiddenDraft:"SYNTHETIC_OFFSCREEN_AUTHORING"}, "NONVISIBLE_BLOCK_CONTENT",1,1],
    [{textarea:true,typedDraftTextarea:true}, "TEXTAREA_VALUE_PRESENT",0,0]
  ];
  for(const [opts,reason,nonempty,hidden] of cases) {
    const h=harness(opts),r=await h.run();
    assert.equal(r.status,"BLOCKED_DIRTY_DRAFT");
    assert.equal(r.preflight.stage,"ARM");
    assert.equal(r.preflight.reason,reason);
    assert.equal(r.preflight.nonemptyBlockCount,nonempty);
    assert.equal(r.preflight.nonvisibleNonemptyCount,hidden);
    assert.equal(r.insertTextCount,0);
    assert.equal(r.saveDispatched,false);
    assert.equal(h.sent.length,0);
    assert.equal(JSON.stringify(await h.last()).includes("SYNTHETIC_"),false);
  }
});
test("empty editor and empty unique text surface keep single guarded insertion",async()=>{
  const h=harness({emptySurface:true}),r=await h.run();
  assert.equal(r.status,"TRACE_EXACT_ONCE");
  assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
  assert.equal(h.sent.includes("Save"),false);
});
test("late real draft before first or second INSPECT reports exact stage and prevents CDP",async()=>{
  for(const stage of [1,2]) {
    const h=harness({emptySurface:true,dirtyAtInspect:stage});
    const r=await h.run(),last=await h.last();
    assert.equal(r.status,"BLOCKED_DIRTY_DRAFT");
    assert.equal(r.preflight.stage,stage===1?"INSPECT_1":"INSPECT_2");
    assert.equal(r.preflight.reason,"AUTHORING_SURFACE_CONTENT");
    assert.equal(last.status,r.status);
    assert.equal(last.preflight.stage,r.preflight.stage);
    assert.equal(last.pendingServerVerification,false);
    assert.equal(r.saveDispatched,false);
    assert.equal(h.sent.length,0);
    assert.equal(JSON.stringify(last).includes("SYNTHETIC_PRIVATE_DRAFT_ONLY_IN_PAGE"),false);
  }
});
test("nonempty content remains blocked despite server BLANK and valid textarea caret",async()=>{
  const h=harness({textarea:true,emptySelection:true,authoringText:"SYNTHETIC_HIDDEN_CONTENT"});
  const r=await h.run();
  assert.equal(r.status,"BLOCKED_DIRTY_DRAFT");
  assert.equal(r.preflight.reason,"AUTHORING_SURFACE_CONTENT");
  assert.equal(h.sent.length,0);
  assert.equal((await h.last()).serverVerification,"NOT_VERIFIED");
});


test("read-only leaf-provenance distinguishes structural hints but never waives dirty block",async()=>{
 for(const [options,field] of [
   [{accessoryText:"SYNTHETIC_LEAF_UNKNOWN",noTextSurface:true},"unknownLeaves"],
   [{accessoryText:"SYNTHETIC_LEAF_CONTROL",controlLeaf:true,noTextSurface:true,ownerTag:"BUTTON"},"controlLikeLeaves"],
   [{accessoryText:"SYNTHETIC_LEAF_PLACEHOLDER",placeholderLeaf:true,noTextSurface:true},"placeholderHintLeaves"],
   [{accessoryText:"SYNTHETIC_LEAF_HIDDEN",hiddenLeaf:true,noTextSurface:true},"hiddenDescendantLeaves"],
   [{authoringText:"SYNTHETIC_LEAF_AUTHORING"},"authoringTextLeaves"],
   [{accessoryText:"SYNTHETIC_LEAF_EDITABLE",editableLeaf:true,noTextSurface:true},"editableOtherLeaves"]
 ]) {
   const h=harness(options),result=await h.run(),last=await h.last();
   assert.equal(result.status,"BLOCKED_DIRTY_DRAFT");
   assert.equal(result.preflight.stage,"ARM");
   assert.equal(result.preflight.provenance.schema,"LEAF_OWNER_V1");
   assert.equal(result.preflight.provenance[field],1);
   assert.equal(result.preflight.provenance.ownershipProof,"NOT_ESTABLISHED");
   assert.equal(result.preflight.provenance.incomplete,false);
   assert.equal(last.preflight.provenance[field],1);
   assert.equal(result.insertTextCount,0);
   assert.equal(result.saveDispatched,false);
   assert.deepEqual(h.sent,[]);
   for(const receipt of [result,last]){
     assert.equal(JSON.stringify(receipt).includes("SYNTHETIC_LEAF_"),false);
     assert.equal(JSON.stringify(receipt).includes("synthetic.invalid"),false);
   }
 }
});
test("unresolved text leaf remains blocked without fabricated provenance",async()=>{
 const h=harness({accessoryText:"SYNTHETIC_UNKNOWN_NODE",noTextSurface:true});
 const r=await h.run();
 assert.equal(r.status,"BLOCKED_DIRTY_DRAFT");
 assert.equal(r.preflight.provenance.nonemptyLeafCount,1);
 assert.equal(r.preflight.provenance.authoringTextLeaves,0);
 assert.equal(r.preflight.ownershipProof,"NOT_ESTABLISHED");
 assert.equal(r.insertTextCount,0);
});

test("provenance scan stays bounded on one million synthetic siblings",async()=>{
 const h=harness({accessoryText:"SYNTHETIC_UNKNOWN_LEAF",noTextSurface:true,hugeChildList:true});
 const r=await h.run();
 assert.equal(r.status,"BLOCKED_DIRTY_DRAFT");
 assert.equal(r.insertTextCount,0);
 assert.equal(r.saveDispatched,false);
 assert.equal(r.preflight.provenance.schema,"LEAF_OWNER_V1");
 assert.equal(r.preflight.provenance.incomplete,true);
 assert.equal(r.preflight.provenance.unknownLeaves,1);
 assert.deepEqual(h.sent,[]);
 assert.equal(JSON.stringify(r).includes("SYNTHETIC_UNKNOWN_LEAF"),false);
});

test("phase gates distinguish native click focus loss from Ctrl+A drift before input",async()=>{
  for(const [options,stage,keyCount,reason] of [
    [{clickFocusDrift:true},"AFTER_NATIVE_CLICK",0,"BLOCKED_FOCUS_DRIFT"],
    [{ctrlAFocusDrift:true},"AFTER_CTRL_A",2,"BLOCKED_FOCUS_DRIFT"],
    [{ctrlAMultipleBlocks:true},"AFTER_CTRL_A",2,"BLOCKED_FOCUS_DRIFT"],
    [{ctrlASelectionDrift:true},"AFTER_CTRL_A",2,"BLOCKED_SELECTION_DRIFT"]
  ]) {
    const h=harness(options),r=await h.run(),last=await h.last();
    assert.equal(r.status,reason);
    assert.equal(r.phase,stage);
    assert.equal(r.phases.at(-1).stage,stage);
    assert.equal(h.sent.filter(x=>x==="Input.dispatchKeyEvent").length,keyCount);
    assert.equal(h.sent.includes("Input.insertText"),false);
    assert.equal(r.saveDispatched,false);
    assert.equal(last.phase,stage);
    assert.deepEqual(JSON.parse(JSON.stringify(last.phases)),JSON.parse(JSON.stringify(r.phases)));
    assert.equal(last.pendingServerVerification,true);
    assert.equal((await h.run()).status,"BLOCKED_PENDING_SERVER_VERIFICATION");
  }
});
test("every successful pre-insert phase records bounded same-host and selection evidence",async()=>{
  for(const options of [{},{textarea:true,emptySelection:true}]) {
    const h=harness(options),r=await h.run();
    assert.equal(r.status,"TRACE_EXACT_ONCE");
    assert.deepEqual(Array.from(r.phases,p=>p.stage),
      ["ARM","INSPECT_1","INSPECT_2","AFTER_NATIVE_CLICK","AFTER_CTRL_A","BEFORE_INSERT"]);
    for(const p of r.phases) {
      assert.equal(p.sameBoundBlock,true);assert.equal(p.hostConnected,true);
      assert.equal(p.focusedBlockCount,1);assert.equal(p.nativeHostFocused,true);
      assert.equal(typeof p.elapsedMs,"number");assert.equal(typeof p.mutationCount,"number");
      assert.equal(p.hostKind,options.textarea?"TEXTAREA":"CONTENTEDITABLE");
    }
    assert.equal(r.phases.at(-1).selectionProof,options.textarea?"NATIVE_TEXTAREA_CARET":"DOM_IN_BOUND_BLOCK");
    assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
    assert.equal((await h.last()).phases.length,6);
  }
});
test("async block rebind before insertion is phase-specific and does not resend",async()=>{
  const h=harness({rebindBeforeInsert:true}),r=await h.run(),last=await h.last();
  assert.equal(r.status,"BLOCKED_DOM_DRIFT");assert.equal(r.phase,"BEFORE_INSERT");
  assert.equal(r.phases.at(-1).blockConnected,false);
  assert.equal(r.phases.at(-1).mutationCount,1);
  assert.equal(last.pendingServerVerification,true);
  assert.equal(h.sent.filter(x=>x==="Input.insertText").length,0);
});
test("stale active tab after native click stops before Ctrl+A and preserves pending barrier",async()=>{
  const h=harness({navigateAfterClick:true}),r=await h.run();
  assert.equal(r.status,"BLOCKED_UNCERTAIN");
  assert.equal(h.sent.filter(x=>x==="Input.dispatchKeyEvent").length,0);
  assert.equal(h.sent.includes("Input.insertText"),false);
  assert.equal((await h.last()).pendingServerVerification,true);
});
test("failed independent verification retains phase evidence and cannot clear pending",async()=>{
  const h=harness({clickFocusDrift:true}),r=await h.run();
  h.root.isConnected=false;h.opts.badRead=true;
  const verify=await h.verify(),last=await h.last();
  assert.equal(verify.status,"SERVER_UNVERIFIED");
  assert.equal(last.pendingServerVerification,true);
  assert.equal(last.phase,r.phase);
  assert.equal((await h.run()).status,"BLOCKED_PENDING_SERVER_VERIFICATION");
  assert.equal(h.sent.includes("Input.insertText"),false);
});
test("pre-CDP phase rejection removes only its local observer session without creating pending",async()=>{
  const h=harness({dirtyAtInspect:1}),r=await h.run();
  assert.equal(r.status,"BLOCKED_DIRTY_DRAFT");assert.equal(r.phase,"INSPECT_1");
  assert.equal(h.armed(),false);
  assert.equal((await h.last()).pendingServerVerification,false);
  assert.deepEqual(h.sent,[]);
});
test("phase receipts whitelist malformed metadata and do not trust oversized page payloads",async()=>{
  const h=harness({clickFocusDrift:true,poisonPhase:true}),r=await h.run(),last=await h.last();
  for(const receipt of [r,last]) {
    assert.ok(receipt.phases.length<=6);
    assert.equal(JSON.stringify(receipt).includes("PRIVATE_"),false);
    assert.equal(receipt.phases.at(-1).focusedBlockCount,16);
    assert.equal(receipt.phases.at(-1).stage,"UNVERIFIED");
    assert.equal(receipt.phases.at(-1).elapsedMs,0);
  }
});
