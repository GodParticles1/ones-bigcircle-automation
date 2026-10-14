const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {test} = require("node:test");
const {webcrypto} = require("node:crypto");
const source = fs.readFileSync(require("node:path").join(__dirname,"..","native-editor-diagnostic.js"),"utf8");
const href="https://synthetic.invalid/team/t/project/p/issue/SYN-1";
const config={writeEnabled:false,rootCauseFieldId:"f",onesOrigin:"https://synthetic.invalid",teamUuid:"t",projectUuid:"p",issueTypeUuid:"i"};
function harness(opts={}) {
  const sent=[],store={},events={},observers=[];
  const rect={left:30,top:40,right:230,height:25,width:200};
  const block={textContent:opts.dirty?"existing":"",isConnected:true,classList:{contains:()=>!opts.noFocus},
    getBoundingClientRect:()=>rect,contains:(x)=>x===block||x===anchor};
  const anchor={nodeType:3,parentElement:block};
  const selection={anchorNode:anchor,focusNode:anchor,anchorOffset:0,focusOffset:0,rangeCount:1,isCollapsed:true};
  const textarea={tagName:"TEXTAREA",value:"",selectionStart:0,selectionEnd:0,
    disabled:false,readOnly:false,isConnected:true,contains:()=>false,closest:()=>null};
  const host={isConnected:true,contains:x=>x===block,closest:()=>host,isContentEditable:true};
  let active=opts.textarea?textarea:host;
  if(opts.popupBlur) active=null;
  if(opts.wrongHost) active={tagName:"INPUT"};
  if(opts.siblingHost) active={tagName:"TEXTAREA",value:"",selectionStart:0,selectionEnd:0};
  if(opts.badTextarea) textarea.value="dirty";
  if(opts.badTextareaSelection) textarea.selectionEnd=1;
  const root={id:"f",isConnected:true,contains:x=>[root,host,block,anchor,...(opts.textarea?[textarea]:[])].includes(x),
    querySelectorAll:q=>q==="textarea.editor-input"?opts.textarea?[textarea,...(opts.twoTextareas?[{...textarea}]:[])]:[]:
      q==='[contenteditable="true"]'?opts.textarea?[]:[host]:[block],getBoundingClientRect:()=>rect};
  const doc={get activeElement(){return active},body:{},documentElement:{},hasFocus:()=>!opts.popupBlur,querySelectorAll:q=>q==="[id]"?[root]:q.startsWith("div.standard-")?opts.noEditor?[]:[root]:[],
    querySelector:()=>null,elementFromPoint:()=>block,
    createRange:()=>{let n=0;return{selectNodeContents(){},setEnd(_x,v){n=v},toString:()=>"a".repeat(n)}},
    addEventListener:(n,f)=>(events[n] ||= []).push(f),removeEventListener:(n,f)=>events[n]=(events[n]||[]).filter(x=>x!==f)};
  const location={href,origin:config.onesOrigin,pathname:new URL(href).pathname};
  const chrome={tabs:{query:async()=>[{id:1,url:href}],get:async()=>({url:opts.badTab?href+"/wrong":href,status:"complete"})},
    permissions:{contains:async()=>true},storage:{session:{get:async k=>({[k]:store[k]}),set:async v=>Object.assign(store,v)}},
    scripting:{executeScript:async({func,args})=>[{result:await func(...args)}]},
    debugger:{attach:async()=>{if(opts.conflict)throw Error("private debugger details")},detach:async()=>{},
      sendCommand:async(_t,method,args)=>{
        sent.push(method);
        if(method==="Input.dispatchMouseEvent" && args.type==="mouseReleased" && opts.popupBlur) { active=opts.textarea?textarea:host; opts.popupBlur=false; }
        if(method==="Input.insertText"){
          const event={target:block,isTrusted:true,inputType:"insertText",cancelable:true,defaultPrevented:false,isComposing:false};
          for(const f of events.beforeinput||[]) f(event);
          block.textContent=opts.partial?args.text.slice(0,4):opts.duplicate?args.text+args.text:args.text;
          for(const f of events.input||[])f(event);
          for(const f of observers)f();
          if(opts.throwAfter)throw Error("secret token private endpoint");
        }
      }}
  };
  const context=vm.createContext({chrome,URL,crypto:webcrypto,TextEncoder,window:{getSelection:()=>selection,APP_VERSION:"3.14.0"},
    document:doc,location,fetch:async()=>({ok:!opts.badIdentity,json:async()=>({display_id:"SYN-1",task_uuid:"task"})}),
    getComputedStyle:()=>({display:"block",visibility:"visible",opacity:"1"}),innerWidth:1000,innerHeight:1000,
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
