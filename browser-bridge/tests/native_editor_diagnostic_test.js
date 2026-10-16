const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {test} = require("node:test");
const {webcrypto} = require("node:crypto");
const source = fs.readFileSync(require("node:path").join(__dirname,"..","native-editor-diagnostic.js"),"utf8");
const href="https://synthetic.invalid/project/#/team/t/project/p/issue/SYN-1";
const config={writeEnabled:false,rootCauseFieldId:"f",onesOrigin:"https://synthetic.invalid",teamUuid:"t",projectUuid:"p",issueTypeUuid:"i"};
function harness(opts={}) {
  const sent=[],store={},events={},observers=[];
  const rect={left:30,top:40,right:230,height:25,width:200};
  const textSurface={textContent:opts.authoringText||""};
  const block={textContent:opts.authoringText||opts.accessoryText||(opts.dirty?"synthetic draft":""),
    isConnected:true,classList:{contains:()=>!opts.noFocus},
    querySelectorAll:(q)=>q===".text"&&(opts.authoringText||opts.accessoryText||opts.emptySurface)?[textSurface]:[],
    getBoundingClientRect:()=>rect,contains:(x)=>x===block||x===anchor};
  const hiddenBlock={textContent:opts.hiddenDraft||"",isConnected:true,classList:{contains:()=>false},
    querySelectorAll:q=>q===".text"?[{textContent:opts.hiddenDraft||""}]:[],
    getBoundingClientRect:()=>rect,contains:(x)=>x===hiddenBlock};
  const anchor={nodeType:3,parentElement:block};
  const foreign={nodeType:3,parentElement:{closest:()=>opts.foreignEditor?{id:"other-editor"}:null}};
  const selection={anchorNode:anchor,focusNode:anchor,anchorOffset:0,focusOffset:0,rangeCount:1,isCollapsed:true};
  if(opts.emptySelection || opts.popupDomLost) selection.rangeCount=0;
  if(opts.outsideSelection) {selection.anchorNode=foreign;selection.focusNode=foreign;}
  if(opts.competingRange) selection.isCollapsed=false;
  const textarea={tagName:"TEXTAREA",value:"",selectionStart:0,selectionEnd:0,
    disabled:false,readOnly:false,isConnected:true,contains:()=>false,closest:()=>null};
  const host={isConnected:true,contains:x=>x===block,closest:()=>host,isContentEditable:true};
  let active=opts.textarea?textarea:host;
  if(opts.popupBlur) active=null;
  if(opts.wrongHost) active={tagName:"INPUT"};
  if(opts.siblingHost) active={tagName:"TEXTAREA",value:"",selectionStart:0,selectionEnd:0};
  if(opts.badTextarea || opts.typedDraftTextarea) textarea.value="synthetic unsaved draft";
  if(opts.badTextareaSelection) textarea.selectionEnd=1;
  const root={id:"f",isConnected:true,contains:x=>[root,host,block,anchor,...(opts.textarea?[textarea]:[])].includes(x),
    querySelectorAll:q=>q==="textarea.editor-input"?opts.textarea?[textarea,...(opts.twoTextareas?[{...textarea}]:[])]:[]:
      q==='[contenteditable="true"]'?opts.textarea?[]:[host]:
      q.startsWith(".text-block[")?(opts.hiddenDraft?[block,hiddenBlock]:[block]):[block],
    getBoundingClientRect:()=>rect};
  const doc={get activeElement(){return active},body:{},documentElement:{},hasFocus:()=>!opts.popupBlur,querySelectorAll:q=>q==="[id]"?[root]:q.startsWith("div.standard-")?opts.noEditor?[]:[root]:[],
    querySelector:()=>null,elementFromPoint:()=>block,
    createRange:()=>{let n=0;return{selectNodeContents(){},setEnd(_x,v){n=v},toString:()=>"a".repeat(n)}},
    addEventListener:(n,f)=>(events[n] ||= []).push(f),removeEventListener:(n,f)=>events[n]=(events[n]||[]).filter(x=>x!==f)};
  const location={href,origin:config.onesOrigin,pathname:new URL(href).pathname};
  const chrome={tabs:{query:async()=>[{id:1,url:opts.changedHash?href.replace("/team/t/","/team/other/"):href}],get:async()=>({url:opts.badTab?href+"/wrong":opts.changedHash?href.replace("/team/t/","/team/other/"):href,status:"complete"})},
    permissions:{contains:async()=>true},storage:{session:{get:async k=>({[k]:store[k]}),set:async v=>Object.assign(store,v)}},
    scripting:{executeScript:async({func,args})=>{
      if(func.name==="nedPageControl" && args[0]?.action==="INSPECT") {
        opts.inspectCalls=(opts.inspectCalls||0)+1;
        if(opts.secondInspectSelectionLost && opts.inspectCalls===2) {
          selection.rangeCount=0; selection.anchorNode=null; selection.focusNode=null;
        }
        if (opts.dirtyAtInspect===opts.inspectCalls) {
          block.textContent="SYNTHETIC_PRIVATE_DRAFT_ONLY_IN_PAGE";
          textSurface.textContent="SYNTHETIC_PRIVATE_DRAFT_ONLY_IN_PAGE";
          opts.authoringText=textSurface.textContent;
        }
      }
      return [{result:await func(...args)}];
    }},
    debugger:{attach:async()=>{if(opts.conflict)throw Error("private debugger details")},detach:async()=>{},
      sendCommand:async(_t,method,args)=>{
        sent.push(method);
        if(method==="Input.dispatchMouseEvent" && args.type==="mouseReleased") {
          if(opts.popupBlur && !opts.noClickFocus) { active=opts.textarea?textarea:host; opts.popupBlur=false; }
          if(opts.postClickSelectionInvalid) {selection.rangeCount=0;selection.anchorNode=null;selection.focusNode=null;}
          if(opts.postClickTextareaRange) textarea.selectionEnd=1;
          if(opts.postClickWrongHost) active={tagName:"INPUT"};
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
  const context=vm.createContext({chrome,URL,crypto:webcrypto,TextEncoder,window:{getSelection:()=>selection,APP_VERSION:"3.14.0"},
    document:doc,location,fetch:async()=>({ok:!opts.badIdentity,json:async()=>({display_id:"SYN-1",task_uuid:"task"})}),
    getComputedStyle:(node)=>({display:node===hiddenBlock?"none":"block",visibility:"visible",opacity:"1"}),innerWidth:1000,innerHeight:1000,
    MutationObserver:class{constructor(f){this.f=f}observe(){observers.push(this.f)}disconnect(){const i=observers.indexOf(this.f);if(i>=0)observers.splice(i,1)}},
    queueMicrotask,setTimeout:(f)=>setImmediate(f),console,
    relayReadTaskFields:async(_s,p)=>({ok:!opts.badRead,complete:!opts.badRead,readOnly:true,requestedTaskCount:1,fieldId:p.fieldId,
      reads:[{status:"READ_VERIFIED",onesTaskUuid:"task",fieldId:p.fieldId,value:opts.nonempty?"something":""}]}),
    validatedOnesScope:()=>config});
  vm.runInContext(source,context);
  return {sent,root,opts,blur:()=>{active=null;opts.popupBlur=true},run:(c=config)=>context.onesNativeEditorDiagnosticRun(c,1),
    verify:()=>context.onesNativeEditorDiagnosticVerify(config,1),last:()=>context.onesNativeEditorDiagnosticLast()};
}
test("one insert, metadata-only events, zero Save",async()=>{const h=harness(),r=await h.run();
  assert.equal(r.status,"TRACE_EXACT_ONCE");assert.equal(r.trace.semantic,"EXACT_ONCE");
  assert.equal(r.trace.events.some(e=>e.type==="beforeinput"&&e.trusted),true);
  assert.equal(r.trace.samples.some(e=>e.kind==="MUTATION"),true);
  assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);
  assert.equal(JSON.stringify(r).includes("NDP"),false);
  assert.equal(h.sent.includes("Save"),false);
  h.root.isConnected=false;
  assert.equal((await h.verify()).status,"SERVER_BLANK_OBSERVED");
});
test("duplicate and partial real mutations are rejected",async()=>{for(const key of ["duplicate","partial"]){const h=harness({[key]:true}),r=await h.run();assert.equal(r.status,"TRACE_MISMATCH");assert.equal(h.sent.filter(x=>x==="Input.insertText").length,1);assert.equal(r.saveDispatched,false)}});
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
