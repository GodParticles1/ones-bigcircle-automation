const $ = (id) => document.getElementById(id);
const output = $("output");
const DRAFT_KEY = "onesRelaySetupDraftV041";
let draftBase = null;
let draftWrite = Promise.resolve();
let savingConfig = false;
const DRAFT_INPUT_IDS = [
  "onesOrigin",
  "teamUuid",
  "projectUuid",
  "issueTypeUuid",
  "assigneeDepartmentUuid",
  "rootCauseFieldId",
  "relayUrl",
  "relayToken"
];

function show(value) {
  output.textContent = JSON.stringify(value, null, 2);
}

function currentForm() {
  return {
    onesOrigin: $("onesOrigin").value.trim(),
    teamUuid: $("teamUuid").value.trim(),
    projectUuid: $("projectUuid").value.trim(),
    issueTypeUuid: $("issueTypeUuid").value.trim(),
    assigneeDepartmentUuid: $("assigneeDepartmentUuid").value.trim(),
    rootCauseFieldId: $("rootCauseFieldId").value.trim(),
    baseUrl: $("relayUrl").value.trim(),
    token: $("relayToken").value.trim(),
    enabled: $("relayEnabled").checked,
    writeEnabled: $("writeEnabled").checked
  };
}

function applyForm(value) {
  const v = value || {};
  $("onesOrigin").value = v.onesOrigin || "";
  $("teamUuid").value = v.teamUuid || "";
  $("projectUuid").value = v.projectUuid || "";
  $("issueTypeUuid").value = v.issueTypeUuid || "";
  $("assigneeDepartmentUuid").value = v.assigneeDepartmentUuid || "";
  $("rootCauseFieldId").value = v.rootCauseFieldId || "";
  $("relayUrl").value = v.baseUrl || "http://127.0.0.1:18731";
  $("relayToken").value = v.token || "";
  $("relayEnabled").checked = !!v.enabled;
  $("writeEnabled").checked = !!v.writeEnabled;
}

async function getDraft() {
  const data = await chrome.storage.session.get(DRAFT_KEY);
  const draft = data?.[DRAFT_KEY];
  return draft && typeof draft === "object" ? draft : null;
}

function persistDraft() {
  if (savingConfig) return Promise.resolve();
  const draft = { form:currentForm(), baseConfig:draftBase };
  // Serialize draft writes so an earlier input event cannot resurrect a draft
  // after a successful save clears it. Only session presentation state is queued.
  const write = () => chrome.storage.session.set({ [DRAFT_KEY]: draft });
  draftWrite = draftWrite.then(write, write);
  return draftWrite;
}

async function clearDraft() {
  await draftWrite.catch(() => {});
  await chrome.storage.session.remove(DRAFT_KEY);
}

function setSavingConfig(value) {
  savingConfig = value;
  for (const id of [...DRAFT_INPUT_IDS, "relayEnabled", "writeEnabled", "saveConfig"]) $(id).disabled = value;
}

function normalizeOrigin(raw) {
  const url = new URL(String(raw || ""));
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("ONES origin must be https scheme + host + optional port only");
  }
  return url.origin;
}

function formFromConfig(c) {
  return {
    onesOrigin:c.onesOrigin || "",
    teamUuid:c.teamUuid || "",
    projectUuid:c.projectUuid || "",
    issueTypeUuid:c.issueTypeUuid || "",
    assigneeDepartmentUuid:c.assigneeDepartmentUuid || "",
    rootCauseFieldId:c.rootCauseFieldId || "",
    baseUrl:c.baseUrl || "http://127.0.0.1:18731",
    token:"",
    enabled:!!c.enabled,
    writeEnabled:!!c.writeEnabled
  };
}

async function load() {
  const result = await chrome.runtime.sendMessage({ type:"ONES_RELAY_GET_CONFIG" });
  if (!result?.ok) return show(result);
  const c = result.config || {};
  const savedForm = formFromConfig(c);
  // The baseline contains no token: GET_CONFIG exposes only tokenPresent.
  draftBase = JSON.stringify({ ...savedForm, tokenPresent:!!c.tokenPresent });
  const storedDraft = await getDraft();
  const draft = storedDraft?.baseConfig === draftBase ? storedDraft.form
    : storedDraft && !storedDraft.form && !c.onesOrigin && !c.tokenPresent ? storedDraft : null;
  applyForm({ ...savedForm, ...(draft || {}) });
  $("inventoryPage").textContent = "Inventory page: " + (c.inventoryPageUrl || "not bound");
  $("runtime").textContent = "Runtime: " + (result.runtime?.state || "unknown");
  show({
    config:{...c, tokenPresent:!!c.tokenPresent},
    runtime:result.runtime,
    capabilities:result.capabilities,
    draftPresent:!!draft
  });
  await nativeDiagRestore();
  await identityBindingRestore();
}

for (const id of DRAFT_INPUT_IDS) {
  $(id).addEventListener("input", () => { persistDraft().catch(() => {}); });
}
$("relayEnabled").addEventListener("change", () => { persistDraft().catch(() => {}); });
$("writeEnabled").addEventListener("change", () => { persistDraft().catch(() => {}); });

$("saveConfig").addEventListener("click", async () => {
  if (savingConfig) return;
  setSavingConfig(true);
  let configSaved = false;
  try {
    const form = currentForm();
    const origin = normalizeOrigin(form.onesOrigin);
    const result = await chrome.runtime.sendMessage({ type:"ONES_RELAY_SET_CONFIG", ...form, onesOrigin:origin });
    if (!result?.ok) throw new Error(result?.error || "Failed to save Browser Bridge configuration");
    configSaved = true;
    await clearDraft();
    // The permission prompt may destroy this popup. Config and draft cleanup
    // must already be committed; no continuation is required for persistence.
    const savedForm = formFromConfig(result.config || {});
    draftBase = JSON.stringify({ ...savedForm, tokenPresent:!!result.config?.tokenPresent });
    applyForm(savedForm);
    const granted = await chrome.permissions.request({ origins:[origin + "/*"] });
    if (!granted) throw new Error("Configuration saved; ONES origin permission was not granted");
    await load();
  } catch (error) {
    show({ ok:false, configSaved, error:String(error) });
  } finally {
    setSavingConfig(false);
  }
});

$("bindInventory").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
    if (!tab?.id || !tab.url) throw new Error("No active tab");
    const result = await chrome.runtime.sendMessage({ type:"ONES_RELAY_BIND_INVENTORY_PAGE", tabId:tab.id, url:tab.url });
    show(result);
    await load();
  } catch (error) { show({ ok:false, error:String(error) }); }
});

$("testRelay").addEventListener("click", async () => show(await chrome.runtime.sendMessage({ type:"ONES_RELAY_TEST" })));
$("pollNow").addEventListener("click", async () => show(await chrome.runtime.sendMessage({ type:"ONES_RELAY_POLL_NOW" })));

load().catch((error) => show({ok:false,error:String(error)}));

let nativeDiagBusy = false;
let identityBindingBusy = false;
let preparedDiagnostic = null;
let nativeDiagCurrent = null;
let nativeDiagPendingHold = true;
let nativeDiagUnknownHold = false;
let nativeDiagLastKnown = null;
let nativeDiagLastRead = 0;
function nativePreparedRender(){
  if($("nativeDiagRun"))$("nativeDiagRun").disabled=nativeDiagBusy||identityBindingBusy||nativeDiagPendingHold||!preparedDiagnostic?.identityBound;
  if($("nativeDiagPrepare"))$("nativeDiagPrepare").disabled=nativeDiagBusy||identityBindingBusy||nativeDiagPendingHold;
  if($("nativeDiagPrepared"))$("nativeDiagPrepared").textContent=preparedDiagnostic?
    '本机私密 · 本次目标 '+preparedDiagnostic.target.displayId+' / '+preparedDiagnostic.target.fieldId+
    '\n实际 marker：'+preparedDiagnostic.marker+'\n恢复意图：取消后独立核查同一服务端字段；改变或未知即停止，不自动清理或覆盖。'+
    '\n恢复策略：'+preparedDiagnostic.recovery+'\n到期：'+preparedDiagnostic.expiresAt+
    '\n本次 fresh 身份绑定：'+(preparedDiagnostic.identityBound?'已核对':'尚未核对'):
    '先准备本次 marker，再只读核对身份；历史收据不授权输入。';
  if(preparedDiagnostic&&!nativeDiagPendingHold&&$("nativeDiagNextAction"))
    $("nativeDiagNextAction").textContent=preparedDiagnostic.identityBound?
      '身份已核对；请核对本次标记和恢复说明，再亲自决定是否确认。':
      preparedDiagnostic.identityAttempted?'本次身份未通过，请停止；不要复用历史收据或旧标记。':
      '准备完成；下一步仅点击“只读核对身份与工单”。';
}
$("nativeDiagPrepare")?.addEventListener('click',async()=>{
  if(nativeDiagBusy||identityBindingBusy||nativeDiagPendingHold)return;
  nativeDiagBusy=true;preparedDiagnostic=null;nativePreparedRender();
  try{
    const tabs=await chrome.tabs.query({active:true,currentWindow:true});
    if(tabs.length!==1||!Number.isInteger(tabs[0]?.id))
      return await nativeDiagPublish({ok:false,status:'BLOCKED_NO_ACTIVE_TAB'},'PREPARE');
    const p=await chrome.runtime.sendMessage({type:'ONES_NATIVE_DIAGNOSTIC_PREPARE',tabId:tabs[0].id});
    const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
    if(p?.ok===true&&p.status==='DIAGNOSTIC_PREPARED'&&id(p.nonce)&&typeof p.marker==='string'&&
      /^NDP[0-9a-f]{12}$/.test(p.marker)&&p.recovery==='CANCEL_AND_VERIFY_NO_AUTOMATIC_RESTORE'&&
      [p.target?.displayId,p.target?.projectUuid,p.target?.issueTypeUuid,p.target?.fieldId].every(id)&&
      Number.isFinite(Date.parse(p.expiresAt))){
      preparedDiagnostic={nonce:p.nonce,marker:p.marker,recovery:p.recovery,expiresAt:p.expiresAt,
        tabId:tabs[0].id,identityBound:false,target:{displayId:p.target.displayId,fieldId:p.target.fieldId}};
      await nativeDiagPublish(p,'PREPARE');
    }else await nativeDiagPublish(p,'PREPARE');
  }catch(_){await nativeDiagPublish({ok:false,status:'BLOCKED_PREPARED_UNCERTAIN'},'PREPARE');}
  finally{nativeDiagBusy=false;nativePreparedRender();}
});
async function nativeDiagPublish(value,action) {
  const receipt=nativeDiagReceipt(value);
  if(typeof receipt.status!=='string'||!receipt.status||
    ['BLOCKED_UNCERTAIN','BLOCKED_PREPARED_UNCERTAIN'].includes(receipt.status))nativeDiagUnknownHold=true;
  nativeDiagCurrent={receipt,action,receivedAt:new Date().toISOString()};
  show(nativeDiagCurrent.receipt);
  await nativeDiagRestore();
}
function nativeDiagRender(last,pendingCheck) {
  const receipt=nativeDiagCurrent?.receipt || last || {ok:false,status:'NOT_VERIFIED'};
  const unknown=nativeDiagUnknownHold;
  const pending=last?.pendingServerVerification===true||receipt.pendingServerVerification===true;
  nativeDiagPendingHold=pending||unknown||pendingCheck!=='CLEAR';
  const display={...receipt,receiptOrigin:nativeDiagCurrent?'CURRENT_ACTION':'HISTORICAL_LAST',
    pendingCheck:pending?'PENDING':unknown?'UNKNOWN_RESULT':pendingCheck,
    ...(nativeDiagCurrent?{action:nativeDiagCurrent.action,receivedAt:nativeDiagCurrent.receivedAt}:{})};
  const dirtyReason=receipt.status==='BLOCKED_DIRTY_DRAFT'&&receipt.preflight?
    ' · '+receipt.preflight.stage+' / '+receipt.preflight.reason:'';
  if($("nativeDiagStatus"))$("nativeDiagStatus").textContent=
    (nativeDiagCurrent?'本次操作结果：':'历史诊断（不代表本次操作）：')+(receipt.status||'UNKNOWN')+dirtyReason+
    (pending?' · 诊断待服务端独立复核（不得再次输入）':nativeDiagPendingHold?' · 未决状态未确认，请停止输入':'');
  if($("nativeDiagOutput"))$("nativeDiagOutput").textContent=JSON.stringify(display,null,2);
  if($("nativeDiagHistoryOutput"))$("nativeDiagHistoryOutput").textContent=JSON.stringify(last||{status:'NOT_VERIFIED'},null,2);
  if($("nativeDiagNextAction"))$("nativeDiagNextAction").textContent=pending?
    '请先在工单取消，再仅核查服务端；不要再次诊断。':nativeDiagPendingHold?
    '请停止并保留现场；不要重试、清状态或重新加载扩展。':
    receipt.status==='DIAGNOSTIC_PREPARED'?'下一步仅点击“只读核对身份与工单”。':
    receipt.status==='NOT_RUN'?'先点击问题根因右上角铅笔进入编辑态，再准备本次诊断。':
    receipt.status==='SERVER_BLANK_OBSERVED'?'本次服务端已观察为空；请停止，不再输入。':
    '请停止并交由 Leader 核查；不要重复点击诊断或复用旧标记。';
  nativePreparedRender();
}
async function nativeDiagRestore() {
  const read=++nativeDiagLastRead;
  try {
    const result=await chrome.runtime.sendMessage({type:"ONES_NATIVE_DIAGNOSTIC_LAST"});
    if(read!==nativeDiagLastRead)return;
    const receipt=nativeDiagReceipt(result);
    const noRecord=receipt.status==='NOT_RUN'&&receipt.insertTextCount===0&&receipt.saveDispatched===false;
    const hasPendingProof=typeof receipt.pendingServerVerification==='boolean'||noRecord;
    if(hasPendingProof)nativeDiagLastKnown=receipt;
    // The existing verifier binds the exact pending target. Its direct result
    // and the subsequent matching final LAST must both prove the readback.
    // A cancelled/rejected check or old CLEAR history cannot resolve unknown.
    if(nativeDiagCurrent?.action==='VERIFY'&&nativeDiagCurrent.receipt.status==='SERVER_BLANK_OBSERVED'&&
      nativeDiagCurrent.receipt.serverVerification==='SERVER_BLANK_OBSERVED'&&receipt.ok===true&&
      receipt.status==='SERVER_BLANK_OBSERVED'&&receipt.serverVerification==='SERVER_BLANK_OBSERVED'&&
      receipt.pendingServerVerification===false)nativeDiagUnknownHold=false;
    nativeDiagRender(hasPendingProof?receipt:nativeDiagLastKnown||receipt,
      receipt.pendingServerVerification===false||noRecord?'CLEAR':'UNAVAILABLE');
  } catch (_) {
    if(read!==nativeDiagLastRead)return;
    nativeDiagRender(nativeDiagLastKnown,'UNAVAILABLE');
  }
}
function nativeDiagReceipt(value) {
  // The worker returns only approved metadata; never render raw browser errors.
  const accepted = ["ok","status","diagnosticOnly","writeGate","saveDispatched",
    "insertTextCount","noSaveDispatched","serverVerification","pendingServerVerification","interrupted","warning","trace"];
  const out=Object.fromEntries(accepted.filter((k) => Object.prototype.hasOwnProperty.call(value || {},k))
    .map((k) => [k,value[k]]));
  const phaseNames=["ARM","INSPECT_1","INSPECT_2","AFTER_NATIVE_CLICK","AFTER_CTRL_A","BEFORE_INSERT"];
  const phaseEnum=(v,values)=>values.includes(v)?v:"UNVERIFIED";
  const phaseCount=(v,max=16)=>Number.isInteger(v)&&v>=0?Math.min(v,max):0;
  const phaseOffset=(v)=>Number.isInteger(v)&&v>=0?Math.min(v,256):null;
  const phaseRoot=(v)=>v?.schema==='ROOT_RESOLUTION_V1'?{
    schema:'ROOT_RESOLUTION_V1',reason:phaseEnum(v.reason,['BOUND','HREF_MISMATCH','ORIGIN_MISMATCH',
      'ROUTE_MISMATCH','NO_VISIBLE_EDITING_ROOT','VIEWING_ONLY','MULTIPLE_VISIBLE_EDITING_ROOTS',
      'TARGET_EDITING_ROOT_MISMATCH','TARGET_ID_NOT_UNIQUE']),domInspected:v.domInspected===true,
    visibleEditingRootCount:phaseCount(v.visibleEditingRootCount),
    visibleExactEditingRootCount:phaseCount(v.visibleExactEditingRootCount),
    targetIdCount:phaseCount(v.targetIdCount),visibleExactViewingRootCount:phaseCount(v.visibleExactViewingRootCount),
    viewingScanComplete:v.viewingScanComplete===true
  }:null;
  if (value?.phase || Array.isArray(value?.phases)) {
    out.phase=phaseEnum(value.phase,phaseNames);
    out.phases=Array.isArray(value.phases)?value.phases.slice(0,6).map((p)=>({
      stage:phaseEnum(p?.stage,phaseNames),...(phaseRoot(p?.rootResolution)?
        {rootResolution:phaseRoot(p.rootResolution)}:{}),elapsedMs:phaseCount(p?.elapsedMs,60000),
      mutationCount:phaseCount(p?.mutationCount,65535),blockCount:phaseCount(p?.blockCount),
      focusedBlockCount:phaseCount(p?.focusedBlockCount),sameBoundBlock:p?.sameBoundBlock===true,
      rootConnected:p?.rootConnected===true,blockConnected:p?.blockConnected===true,
      hostConnected:p?.hostConnected===true,nativeHostFocused:p?.nativeHostFocused===true,
      pageHasFocus:p?.pageHasFocus===true,hostKind:phaseEnum(p?.hostKind,["TEXTAREA","CONTENTEDITABLE"]),
      activeHostKind:phaseEnum(p?.activeHostKind,["TEXTAREA","CONTENTEDITABLE","NEUTRAL","OTHER"]),
      domRangeCount:phaseCount(p?.domRangeCount),domCollapsed:p?.domCollapsed===true,
      domInBoundBlock:p?.domInBoundBlock===true,
      selectionProof:phaseEnum(p?.selectionProof,["NATIVE_TEXTAREA_CARET","DOM_IN_BOUND_BLOCK","NOT_PROVEN"]),
      anchorOffset:phaseOffset(p?.anchorOffset),focusOffset:phaseOffset(p?.focusOffset),
      events:Array.isArray(p?.events)?p.events.slice(0,40).map((e)=>({
        t:phaseCount(e?.t,60000),type:phaseEnum(e?.type,["beforeinput","input","compositionstart","compositionupdate","compositionend"]),
        trusted:e?.trusted===true,inputType:phaseEnum(e?.inputType,["insertText","insertCompositionText",
          "insertFromComposition","deleteCompositionText","deleteContentBackward","deleteContentForward",
          "insertParagraph","insertLineBreak","historyUndo","historyRedo"]),
        cancelable:e?.cancelable===true,preventedCapture:e?.preventedCapture===true,
        preventedAfter:e?.preventedAfter===true,boundBlock:e?.boundBlock===true,isComposing:e?.isComposing===true
      })):[]
    })):[];
  }
  const raw=value?.preflight;
  if (value?.status==="BLOCKED_DIRTY_DRAFT" && raw && typeof raw==="object") {
    const enumValue=(v,values)=>values.includes(v)?v:"UNVERIFIED";
    const bounded=(v)=>Number.isInteger(v)&&v>=0?Math.min(v,16):0;
    out.preflight={
      stage:enumValue(raw.stage,phaseNames),
      reason:enumValue(raw.reason,["TEXTAREA_VALUE_PRESENT","NONVISIBLE_BLOCK_CONTENT",
        "AUTHORING_SURFACE_CONTENT","UNCLASSIFIED_BLOCK_TEXT"]),
      nonemptyBlockCount:bounded(raw.nonemptyBlockCount),
      authoringSurfaceCount:bounded(raw.authoringSurfaceCount),
      possibleAuthoringCount:bounded(raw.possibleAuthoringCount),
      unclassifiedBlockCount:bounded(raw.unclassifiedBlockCount),
      nonvisibleNonemptyCount:bounded(raw.nonvisibleNonemptyCount),
      textareaCount:bounded(raw.textareaCount),
      textareaState:enumValue(raw.textareaState,["NONE","EMPTY","HAS_VALUE"]),
      maxBlockLength:enumValue(raw.maxBlockLength,["ZERO","ONE_TO_32","THIRTYTHREE_TO_128","OVER_128"]),
      maxAuthoringLength:enumValue(raw.maxAuthoringLength,["ZERO","ONE_TO_32","THIRTYTHREE_TO_128","OVER_128"]),
      domCaretShape:enumValue(raw.domCaretShape,["NO_DOM_RANGE","NONCOLLAPSED_OR_MULTIPLE",
        "COLLAPSED_DOM_RANGE"]),
      ownershipProof:"NOT_ESTABLISHED"
    };
    const prov=raw.provenance;
    if (prov?.schema==="LEAF_OWNER_V1") {
      const fields=["nonemptyLeafCount","inspectedNodeCount","authoringTextLeaves",
        "editableOtherLeaves","controlLikeLeaves","placeholderHintLeaves",
        "hiddenDescendantLeaves","unknownLeaves","ownerTagSpan","ownerTagDiv",
        "ownerTagParagraph","ownerTagButton","ownerTagOther"];
      const evidence={schema:"LEAF_OWNER_V1",incomplete:prov.incomplete===true,
        maxLeafLength:enumValue(prov.maxLeafLength,
          ["ZERO","ONE_TO_32","THIRTYTHREE_TO_128","OVER_128"]),
        ownershipProof:"NOT_ESTABLISHED"};
      for (const key of fields) evidence[key]=bounded(prov[key]);
      out.preflight.provenance=evidence;
    }
  }
  return out;
}
async function nativeDiagAction(type) {
  if (nativeDiagBusy || identityBindingBusy) return;
  nativeDiagBusy = true;
  $("nativeDiagRun").disabled = true;
  $("nativeDiagVerify").disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id) return await nativeDiagPublish({ok:false,status:"BLOCKED_NO_ACTIVE_TAB"},'LOCAL_GUARD');
    let packet={type,tabId:tab.id};
    if (type === "ONES_NATIVE_DIAGNOSTIC_RUN") {
      if(nativeDiagPendingHold)return;
      const p=preparedDiagnostic;
      if(!p?.identityBound||p.tabId!==tab.id)
        return await nativeDiagPublish({ok:false,status:'BLOCKED_PREPARED_IDENTITY'},'LOCAL_GUARD');
      preparedDiagnostic=null;nativePreparedRender();
      if(!confirm('本次工单 '+p.target.displayId+'，问题根因字段 '+p.target.fieldId+
        '\n实际输入 marker：\n'+p.marker+'\n恢复意图：取消后独立核查服务端；改变或未知即停止，不自动清理/覆盖。'+
        '\n策略：'+p.recovery+'\n至多一次输入，Save=0；草稿可能自动同步。确认本次精确 marker？')){
        await chrome.runtime.sendMessage({type:'ONES_NATIVE_DIAGNOSTIC_CANCEL_PREPARED',nonce:p.nonce});
        return await nativeDiagPublish({ok:false,status:'OPERATOR_CANCELLED'},'CANCEL');
      }
      packet={...packet,nonce:p.nonce,marker:p.marker,recovery:p.recovery,confirmed:true};
    } else if (!confirm("请先在 ONES 页面点击取消，保持同一工单页面。现在只读核查服务器字段，继续？")) {
      return await nativeDiagPublish({ok:false,status:"OPERATOR_CANCELLED"},'CANCEL');
    }
    const result = await chrome.runtime.sendMessage(packet);
    await nativeDiagPublish(result,type==='ONES_NATIVE_DIAGNOSTIC_RUN'?'RUN':'VERIFY');
  } catch (_) { await nativeDiagPublish({ok:false,status:"BLOCKED_UNCERTAIN"},'UNKNOWN'); }
  finally { nativeDiagBusy=false; $("nativeDiagVerify").disabled=false;nativePreparedRender(); }
}
$("nativeDiagRun")?.addEventListener("click", () => nativeDiagAction("ONES_NATIVE_DIAGNOSTIC_RUN"));
$("nativeDiagVerify")?.addEventListener("click", () => nativeDiagAction("ONES_NATIVE_DIAGNOSTIC_VERIFY"));

function identityBindingReceipt(value) {
  const own=(o,k)=>{const d=o&&typeof o==='object'?Object.getOwnPropertyDescriptor(o,k):null;
    return d&&Object.prototype.hasOwnProperty.call(d,'value')?d.value:undefined;};
  const allowed=['NOT_VERIFIED','IDENTITY_BINDING_READ_VERIFIED','BLOCKED_EXTENSION_SOURCE','BLOCKED_INPUT',
    'BLOCKED_IN_FLIGHT','BLOCKED_WRITE_GATE','BLOCKED_CONFIG','BLOCKED_ORIGIN_PERMISSION','BLOCKED_ACTIVE_TAB',
    'BLOCKED_TAB_DRIFT','BLOCKED_CONFIG_DRIFT','BLOCKED_DOM_BINDING','BLOCKED_NAVIGATION','BLOCKED_READ_HTTP',
    'BLOCKED_READ_RESPONSE','BLOCKED_READ_TIMEOUT','BLOCKED_READ_FAILED','BLOCKED_IDENTITY_SCHEMA',
    'BLOCKED_IDENTITY_CHANGED','BLOCKED_TASK_RESOLVE','BLOCKED_TASK_SCHEMA','BLOCKED_TASK_SCOPE',
    'BLOCKED_OWNER_MISMATCH','BLOCKED_FIELD_SCHEMA','BLOCKED_FIELD_CONFIG','BLOCKED_SCRIPT_RESULT','BLOCKED_UNCERTAIN'];
  const empty=()=>({ok:false,status:'NOT_VERIFIED',readOnly:true,validBinding:false,privacy:'LOCAL_PRIVATE_DO_NOT_SHARE'});
  try {
    const status=own(value,'status'),historical=own(value,'historical')===true;
    if(!allowed.includes(status))return empty();
    const out={...empty(),status,historical},count=own(value,'requestCount');
    out.requestCount=Number.isInteger(count)&&count>=0&&count<=6?count:0;
    const stageNames=['DOM_BEFORE','USER_START','TASK_RESOLVE','TASK_INFO','FIELD_SCHEMA','FIELD_CONFIG','USER_END','DOM_AFTER'];
    const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v));
    const stages=own(value,'stages');
    const stage=own(value,'stage');if(stageNames.includes(stage))out.stage=stage;
    out.stages=Array.isArray(stages)?stages.slice(0,8).flatMap(s=>{
      const stage=own(s,'stage'),capturedAt=own(s,'capturedAt');
      return stageNames.includes(stage)&&date(capturedAt)?[{stage,capturedAt}]:[];
    }):[];
    const observedAt=own(value,'observedAt');if(date(observedAt))out.observedAt=observedAt;
    if(status==='BLOCKED_READ_HTTP'){
      const code=own(value,'httpStatus');out.httpStatus=Number.isInteger(code)&&code>=0&&code<=599?code:0;
    }
    if(status==='BLOCKED_READ_RESPONSE'&&['TEXT_NOT_STRING','CHAR_LIMIT_EXCEEDED','JSON_PARSE_FAILED','ROOT_NOT_OBJECT'].includes(own(value,'responseInvariant')))
      out.responseInvariant=own(value,'responseInvariant');
    if(status==='BLOCKED_FIELD_CONFIG'&&['FORM_SCOPE_MISMATCH','FORM_ID_INVALID','FORM_TREE_INVALID','TARGET_NOT_UNIQUE','TARGET_FROZEN'].includes(own(value,'fieldConfigInvariant')))
      out.fieldConfigInvariant=own(value,'fieldConfigInvariant');
    if(status==='BLOCKED_FIELD_SCHEMA'){
      const reason=own(value,'fieldInvariant'),code=own(value,'fieldTypeCode');
      if(['FIELDS_ARRAY_MISSING_OR_INVALID','FIELDS_TOO_MANY','TARGET_MATCH_ZERO','TARGET_MATCH_MULTIPLE',
        'TARGET_NAME_MISMATCH','TARGET_TYPE_NOT_15','TARGET_TYPE_UNSUPPORTED'].includes(reason))out.fieldInvariant=reason;
      if(['TARGET_TYPE_NOT_15','TARGET_TYPE_UNSUPPORTED'].includes(reason)&&Number.isInteger(code)&&code>=0&&code<=255)out.fieldTypeCode=code;
    }
    if(status!=='IDENTITY_BINDING_READ_VERIFIED')return out;
    const raw=own(value,'privateBinding'),keys=['accountUuid','assigneeUuid','taskUuid','resolvedTaskUuid',
      'displayId','teamUuid','projectUuid','issueTypeUuid','fieldId'];
    const b=Object.fromEntries(keys.map(k=>[k,own(raw,k)]));
    const fieldType=own(raw,'fieldType'),metadataKeys=['fieldTypeUuid','fieldFormUuid','fieldLayoutUuid'];
    const metadata=Object.fromEntries(metadataKeys.map(k=>[k,own(raw,k)]));
    const richtext=fieldType==='richtext'&&Object.values(metadata).every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v));
    const legacy=fieldType===15&&metadataKeys.every(k=>!Object.getOwnPropertyDescriptor(raw,k));
    if(own(value,'ok')!==true||!Object.values(b).every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v))||
      b.accountUuid!==b.assigneeUuid||b.taskUuid!==b.resolvedTaskUuid||(!legacy&&!richtext))return empty();
    const nonce=own(value,'preparedNonce');
    return {...out,ok:true,validBinding:!historical&&own(value,'validBinding')===true,privateBinding:{...b,fieldType,...(richtext?metadata:{})},
      ...(!historical&&typeof nonce==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(nonce)?{preparedNonce:nonce}:{})};
  }catch(_){return empty();}
}
function identityBindingShow(value) {
  const receipt=identityBindingReceipt(value);
  if($("identityBindingOutput"))$("identityBindingOutput").textContent=JSON.stringify(receipt,null,2);
  if($("identityBindingStatus"))$("identityBindingStatus").textContent='本机私密 · '+
    (receipt.historical?'历史观测，不授写权限 · ':'本次只读观测 · ')+receipt.status;
}
async function identityBindingRestore() {
  try{identityBindingShow(await chrome.runtime.sendMessage({type:'ONES_IDENTITY_BINDING_LAST'}));}
  catch(_){identityBindingShow({status:'NOT_VERIFIED'});}
}
$("identityBindingRead")?.addEventListener('click',async()=>{
  if(identityBindingBusy||nativeDiagBusy)return;
  identityBindingBusy=true;$("identityBindingRead").disabled=true;
  if(preparedDiagnostic){preparedDiagnostic.identityBound=false;preparedDiagnostic.identityAttempted=true;}
  nativePreparedRender();
  if($("nativeDiagRun"))$("nativeDiagRun").disabled=true;
  if($("nativeDiagVerify"))$("nativeDiagVerify").disabled=true;
  try{
    const tabs=await chrome.tabs.query({active:true,currentWindow:true});
    if(tabs.length!==1||!Number.isInteger(tabs[0]?.id))return identityBindingShow({status:'BLOCKED_ACTIVE_TAB'});
    const receipt=identityBindingReceipt(await chrome.runtime.sendMessage({type:'ONES_IDENTITY_BINDING_READ',tabId:tabs[0].id}));
    identityBindingShow(receipt);
    if(preparedDiagnostic)preparedDiagnostic.identityBound=receipt.ok===true&&receipt.validBinding===true&&
      receipt.historical!==true&&receipt.preparedNonce===preparedDiagnostic.nonce;
  }catch(_){identityBindingShow({status:'BLOCKED_UNCERTAIN'});}
  finally{identityBindingBusy=false;$("identityBindingRead").disabled=false;
    if($("nativeDiagVerify"))$("nativeDiagVerify").disabled=false;nativePreparedRender();}
});
nativePreparedRender();
