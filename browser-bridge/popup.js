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
async function nativeDiagRestore() {
  try {
    const result=await chrome.runtime.sendMessage({type:"ONES_NATIVE_DIAGNOSTIC_LAST"});
    const receipt=nativeDiagReceipt(result);
    const pending=receipt.pendingServerVerification === true;
    const dirtyReason=receipt.status==="BLOCKED_DIRTY_DRAFT" && receipt.preflight ?
      " · " + receipt.preflight.stage + " / " + receipt.preflight.reason : "";
    if ($("nativeDiagStatus")) $("nativeDiagStatus").textContent =
      pending ? "诊断待服务端独立复核（不得再次输入）" :
      receipt.status==="NOT_RUN" ? "尚无诊断结果" :
      "上次诊断状态：" + (receipt.status || "UNKNOWN") + dirtyReason;
    if ($("nativeDiagOutput")) $("nativeDiagOutput").textContent=JSON.stringify(receipt,null,2);
  } catch (_) {
    if ($("nativeDiagStatus")) $("nativeDiagStatus").textContent="诊断状态读取失败，请停止输入";
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
  if (value?.phase || Array.isArray(value?.phases)) {
    out.phase=phaseEnum(value.phase,phaseNames);
    out.phases=Array.isArray(value.phases)?value.phases.slice(0,6).map((p)=>({
      stage:phaseEnum(p?.stage,phaseNames),elapsedMs:phaseCount(p?.elapsedMs,60000),
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
  if (nativeDiagBusy) return;
  nativeDiagBusy = true;
  $("nativeDiagRun").disabled = true;
  $("nativeDiagVerify").disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id) return show({ok:false,status:"BLOCKED_NO_ACTIVE_TAB"});
    if (type === "ONES_NATIVE_DIAGNOSTIC_RUN") {
      const config = await chrome.runtime.sendMessage({type:"ONES_RELAY_GET_CONFIG"});
      if (!config?.ok || config.config?.writeEnabled !== false)
        return show({ok:false,status:"BLOCKED_WRITE_GATE"});
      if (!confirm("仅允许一个工单一个问题根因字段、一次合成文本输入，绝不点击保存。ONES 协作草稿可能自动同步；取消后还必须独立核查服务端。确认开始？"))
        return show({ok:false,status:"OPERATOR_CANCELLED"});
    } else if (!confirm("请先在 ONES 页面点击取消，保持同一工单页面。现在只读核查服务器字段，继续？")) {
      return show({ok:false,status:"OPERATOR_CANCELLED"});
    }
    const result = await chrome.runtime.sendMessage({type,tabId:tab.id});
    show(nativeDiagReceipt(result));
    await nativeDiagRestore();
  } catch (_) { show({ok:false,status:"BLOCKED_UNCERTAIN"}); }
  finally { nativeDiagBusy=false; $("nativeDiagRun").disabled=false; $("nativeDiagVerify").disabled=false; }
}
$("nativeDiagRun")?.addEventListener("click", () => nativeDiagAction("ONES_NATIVE_DIAGNOSTIC_RUN"));
$("nativeDiagVerify")?.addEventListener("click", () => nativeDiagAction("ONES_NATIVE_DIAGNOSTIC_VERIFY"));
