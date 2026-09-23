/* Bounded production root-cause writer.
 * Runtime target identifiers are supplied by the accepted unique-task plan.
 * No arbitrary field writer and no direct richtext update3 path exists here.
 */

function rcNorm(value) {
  return String(value ?? "").replace(/\u200B|\uFEFF/g, "").replace(/\r\n?/g, "\n").trim();
}

function rcSemanticFromRaw(raw) {
  if (raw == null) return "";
  const text = String(raw);
  const meta = text.match(/<meta[^>]+name=["']ones-editor-text["'][^>]+content=["']([^"']*)["']/i)
    || text.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']ones-editor-text["']/i);
  if (meta && meta[1]) {
    try {
      const bytes = Uint8Array.from(atob(meta[1]), (ch) => ch.charCodeAt(0));
      return rcNorm(new TextDecoder().decode(bytes));
    } catch (_) {}
  }
  try {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const bodyText = rcNorm((doc.body && (doc.body.innerText || doc.body.textContent)) || "");
    if (bodyText) return bodyText;
  } catch (_) {}
  return rcNorm(text.replace(/<!--version:[^>]*-->/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " "));
}

async function rcPagePreflightWrite(input) {
  const FIELD_UUID = String(input?.fieldId || "");
  const EXPECTED_DISPLAY_ID = String(input?.displayId || "");
  const EXPECTED_TASK_UUID = String(input?.taskUuid || "");
  const desired = rcNorm(input?.desiredValue);
  const ORIGIN = location.origin;
  const currentMatch = location.href.match(/\/issue\/([^/?#]+)/i);
  const currentDisplayId = currentMatch ? currentMatch[1] : null;
  const teamMatch = location.href.match(/\/team\/([^/?#]+)/i);
  const teamUuid = teamMatch ? teamMatch[1] : null;

  const fail = (status, error, extra = {}) => ({
    ok:false, status, error:String(error || status),
    currentDisplayId, expectedDisplayId:EXPECTED_DISPLAY_ID,
    expectedTaskUuid:EXPECTED_TASK_UUID, fieldId:FIELD_UUID, ...extra
  });
  const validId = (v) => /^[A-Za-z0-9_-]{1,128}$/.test(String(v || ""));
  if (!teamUuid || currentDisplayId !== EXPECTED_DISPLAY_ID) return fail("TARGET_GUARD_FAILED", "current detail page does not match expected display ID");
  if (!validId(FIELD_UUID) || !validId(EXPECTED_TASK_UUID)) return fail("INPUT_REJECTED", "invalid target identifier");
  if (!desired || desired.length > 2000 || /\u0000/.test(desired)) return fail("INPUT_REJECTED", "desired root cause must be 1-2000 characters");

  const jsonFetch = async (url, init = {}) => {
    const response = await fetch(url, { credentials:"same-origin", ...init });
    const text = await response.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (_) {} }
    return { response, json };
  };

  const identifier = await jsonFetch(
    ORIGIN + "/project/api/ones-project/team/" + encodeURIComponent(teamUuid) + "/tasks/identifier",
    {
      method:"POST",
      headers:{ "content-type":"application/json; charset=UTF-8" },
      body:JSON.stringify({ display_id_path:EXPECTED_DISPLAY_ID })
    }
  );
  if (!identifier.response.ok || identifier.json?.display_id !== EXPECTED_DISPLAY_ID || identifier.json?.task_uuid !== EXPECTED_TASK_UUID) {
    return fail("TARGET_RESOLVE_FAILED", "display ID did not resolve to the expected task UUID", {
      resolvedDisplayId:identifier.json?.display_id || null,
      resolvedTaskUuid:identifier.json?.task_uuid || null,
      httpStatus:identifier.response.status
    });
  }

  const onesqlUrl = ORIGIN + "/project/api/ones-project/team/" + encodeURIComponent(teamUuid) + "/workitems/onesql";
  const messagesUrl = ORIGIN + "/project/api/project/team/" + encodeURIComponent(teamUuid) + "/task/" + encodeURIComponent(EXPECTED_TASK_UUID) + "/messages";

  const loadValue = async () => {
    const query = "select uid(uuid,field903," + FIELD_UUID + ") from issue where uid(uuid) = uid('" + EXPECTED_TASK_UUID + "');";
    const loaded = await jsonFetch(onesqlUrl, {
      method:"POST",
      headers:{ "content-type":"application/json; charset=UTF-8" },
      body:JSON.stringify({ query })
    });
    const item = loaded.json?.data?.[0]?.item;
    if (!loaded.response.ok || !item || item.uuid !== EXPECTED_TASK_UUID) throw new Error("onesql HTTP " + loaded.response.status);
    return { raw:item[FIELD_UUID] ?? null, semantic:rcSemanticFromRaw(item[FIELD_UUID]) };
  };
  const loadEvents = async () => {
    const loaded = await jsonFetch(messagesUrl, { method:"GET" });
    if (!loaded.response.ok || !Array.isArray(loaded.json?.messages)) throw new Error("messages HTTP " + loaded.response.status);
    return loaded.json.messages.filter((m) => m?.type === "system" && m?.ext?.field_uuid === FIELD_UUID);
  };

  let first, second, events;
  try {
    first = await loadValue();
    events = await loadEvents();
    second = await loadValue();
  } catch (error) {
    return fail("PREWRITE_READ_FAILED", error);
  }
  if (first.semantic !== second.semantic) {
    return fail("CONCURRENT_CHANGE_ABORT", "field changed between pre-write reads", {
      firstSemantic:first.semantic, secondSemantic:second.semantic
    });
  }
  if (second.semantic === desired) {
    return {
      ok:true, status:"NOOP_VERIFIED", displayId:EXPECTED_DISPLAY_ID,
      taskUuid:EXPECTED_TASK_UUID, fieldId:FIELD_UUID, desired,
      currentSemantic:second.semantic, baselineEventIds:events.map((e) => e.uuid).filter(Boolean)
    };
  }
  if (second.semantic !== "") {
    return fail("CONFLICT_REVIEW", "current root cause is non-empty and differs from desired", {
      currentSemantic:second.semantic, desired
    });
  }

  const root = document.getElementById(FIELD_UUID);
  if (!root) return fail("EDITOR_NOT_READY", "open the root-cause field in edit mode before polling the write job");

  const visible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity || "1") > 0;
  };
  if (!visible(root)) return fail("EDITOR_NOT_READY", "root-cause editor is not visible");

  const blocks = [...root.querySelectorAll('.text-block[data-type="editor-block"][data-block-type="text"]')].filter(visible);
  const focusedBlocks = blocks.filter((el) => el.classList.contains("focused"));
  let inputBlock = null;
  let blockSelection = null;
  if (focusedBlocks.length === 1) {
    inputBlock = focusedBlocks[0];
    blockSelection = "UNIQUE_FOCUSED";
  } else if (blocks.length === 1) {
    inputBlock = blocks[0];
    blockSelection = "ONLY_VISIBLE";
  } else {
    return fail("EDITOR_ACTIVE_BLOCK_NOT_UNIQUE", "root-cause text block is not unique", {
      blockCount:blocks.length, focusedBlockCount:focusedBlocks.length,
      blockIds:blocks.map((el) => el.id || null)
    });
  }

  const saveControls = [...root.querySelectorAll("button,[role=button]")]
    .filter((el) => visible(el) && rcNorm(el.innerText || el.textContent) === "保存");
  if (saveControls.length !== 1) return fail("SAVE_CONTROL_NOT_UNIQUE", "root-cause save control is not unique", { saveControlCount:saveControls.length });

  const br = inputBlock.getBoundingClientRect();
  const sr = saveControls[0].getBoundingClientRect();
  return {
    ok:true,
    status:"PREWRITE_READY",
    displayId:EXPECTED_DISPLAY_ID,
    taskUuid:EXPECTED_TASK_UUID,
    fieldId:FIELD_UUID,
    desired,
    prewriteSemantic:second.semantic,
    baselineEventIds:events.map((e) => e.uuid).filter(Boolean),
    inputPoint:{ x:Math.round(Math.min(br.right - 8, br.left + 18)), y:Math.round(br.top + br.height / 2) },
    savePoint:{ x:Math.round(sr.left + sr.width / 2), y:Math.round(sr.top + sr.height / 2) },
    blockSelection,
    blockCount:blocks.length,
    focusedBlockCount:focusedBlocks.length,
    textBlockId:inputBlock.id || null
  };
}

function rcPageInspectSelection(expectedDisplayId, fieldId) {
  const currentMatch = location.href.match(/\/issue\/([^/?#]+)/i);
  const currentDisplayId = currentMatch ? currentMatch[1] : null;
  if (currentDisplayId !== expectedDisplayId) return { ok:false, status:"TARGET_GUARD_FAILED", currentDisplayId, expectedDisplayId };
  const root = document.getElementById(fieldId);
  if (!root) return { ok:false, status:"EDITOR_NOT_READY" };
  const selection = window.getSelection();
  const asElement = (node) => !node ? null : (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  const anchorEl = asElement(selection?.anchorNode || null);
  const focusEl = asElement(selection?.focusNode || null);
  return {
    ok:true,
    status:"SELECTION_INSPECTED",
    selectedText:rcNorm(selection?.toString() || ""),
    anchorInside:!!anchorEl && root.contains(anchorEl),
    focusInside:!!focusEl && root.contains(focusEl)
  };
}

function rcPageInspectDraft(expectedDisplayId, fieldId, desiredText, expectedTextBlockId) {
  const currentMatch = location.href.match(/\/issue\/([^/?#]+)/i);
  const currentDisplayId = currentMatch ? currentMatch[1] : null;
  if (currentDisplayId !== expectedDisplayId) return { ok:false, status:"TARGET_GUARD_FAILED", currentDisplayId, expectedDisplayId };
  const root = document.getElementById(fieldId);
  if (!root) return { ok:false, status:"EDITOR_NOT_READY" };
  const block = expectedTextBlockId ? document.getElementById(expectedTextBlockId) : null;
  if (!block || !root.contains(block) || !block.matches('.text-block[data-type="editor-block"][data-block-type="text"]')) {
    return { ok:false, status:"ACTIVE_BLOCK_LOST", expectedTextBlockId:expectedTextBlockId || null };
  }
  if (!block.classList.contains("focused")) return { ok:false, status:"ACTIVE_BLOCK_FOCUS_LOST", textBlockId:block.id || null };
  const textNodes = [...block.querySelectorAll(".text")].filter((el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
  });
  if (textNodes.length !== 1) return { ok:false, status:"DRAFT_TEXT_SURFACE_NOT_UNIQUE", textNodeCount:textNodes.length };
  const draft = rcNorm(textNodes[0].innerText || textNodes[0].textContent || "");
  const desired = rcNorm(desiredText);
  return { ok:draft === desired, status:draft === desired ? "DRAFT_DOM_VERIFIED" : "DRAFT_DOM_MISMATCH", draft, desired, textBlockId:block.id || null };
}

async function rcPageVerifyWrite(input) {
  const FIELD_UUID = String(input?.fieldId || "");
  const EXPECTED_DISPLAY_ID = String(input?.displayId || "");
  const EXPECTED_TASK_UUID = String(input?.taskUuid || "");
  const desired = rcNorm(input?.desiredValue);
  const baseline = new Set(Array.isArray(input?.baselineEventIds) ? input.baselineEventIds : []);
  const ORIGIN = location.origin;
  const currentMatch = location.href.match(/\/issue\/([^/?#]+)/i);
  const currentDisplayId = currentMatch ? currentMatch[1] : null;
  const teamMatch = location.href.match(/\/team\/([^/?#]+)/i);
  const teamUuid = teamMatch ? teamMatch[1] : null;
  if (!teamUuid || currentDisplayId !== EXPECTED_DISPLAY_ID) return { ok:false, status:"TARGET_GUARD_FAILED" };

  const jsonFetch = async (url, init = {}) => {
    const response = await fetch(url, { credentials:"same-origin", ...init });
    const text = await response.text();
    let json = null; if (text) { try { json = JSON.parse(text); } catch (_) {} }
    return { response, json };
  };

  const query = "select uid(uuid,field903," + FIELD_UUID + ") from issue where uid(uuid) = uid('" + EXPECTED_TASK_UUID + "');";
  const [valueResp, msgResp] = await Promise.all([
    jsonFetch(ORIGIN + "/project/api/ones-project/team/" + encodeURIComponent(teamUuid) + "/workitems/onesql", {
      method:"POST", headers:{ "content-type":"application/json; charset=UTF-8" }, body:JSON.stringify({ query })
    }),
    jsonFetch(ORIGIN + "/project/api/project/team/" + encodeURIComponent(teamUuid) + "/task/" + encodeURIComponent(EXPECTED_TASK_UUID) + "/messages", { method:"GET" })
  ]);
  const item = valueResp.json?.data?.[0]?.item;
  const currentSemantic = item?.uuid === EXPECTED_TASK_UUID ? rcSemanticFromRaw(item[FIELD_UUID]) : null;
  const messages = Array.isArray(msgResp.json?.messages) ? msgResp.json.messages : [];
  const event = messages.find((m) => {
    if (!m?.uuid || baseline.has(m.uuid)) return false;
    if (m?.type !== "system" || m?.ext?.field_uuid !== FIELD_UUID) return false;
    return rcNorm(m?.ext?.old_value) === "" && rcNorm(m?.ext?.new_value) === desired;
  });
  const verified = valueResp.response.ok && msgResp.response.ok && currentSemantic === desired && !!event;
  return {
    ok:verified,
    status:verified ? "WRITE_VERIFIED" : "READBACK_PENDING",
    displayId:EXPECTED_DISPLAY_ID,
    taskUuid:EXPECTED_TASK_UUID,
    fieldId:FIELD_UUID,
    currentSemantic,
    desired,
    fieldEvent:event ? {
      uuid:event.uuid, action:event.action || null,
      oldValue:rcNorm(event?.ext?.old_value), newValue:rcNorm(event?.ext?.new_value),
      fieldName:event?.ext?.field_name || null, fieldTypeUuid:event?.ext?.field_type_uuid || null,
      versionUuid:event.version_uuid || null
    } : null
  };
}

async function rcFindDetailTab(config, displayId) {
  const tabs = await chrome.tabs.query({ url:config.onesOrigin + "/*" });
  const matches = tabs.filter((tab) => {
    try {
      const u = new URL(tab.url || "");
      const m = u.href.match(/\/issue\/([^/?#]+)/i);
      return u.origin === config.onesOrigin && m?.[1] === displayId;
    } catch (_) { return false; }
  });
  if (matches.length !== 1) return { ok:false, status:"WRITE_TARGET_TAB_NOT_UNIQUE", tabCount:matches.length };
  return { ok:true, tab:matches[0] };
}

globalThis.onesRootCauseWriteExecute = async function(config, job) {
  const p = job?.payload || {};
  const validId = (v) => /^[A-Za-z0-9_-]{1,128}$/.test(String(v || ""));
  const planSha = String(p.planSha256 || "").toLowerCase();
  const desired = rcNorm(p.desiredValue);
  if (p.taskTargetPolicy !== "UNIQUE_ONES_TASK_ONLY" || p.decision !== "SET_CANDIDATE" || p.writeMode !== "fill_empty_only") {
    return { status:"WRITE_INPUT_REJECTED", result:{ ok:false, status:"WRITE_INPUT_REJECTED", error:"task-level SET_CANDIDATE / fill_empty_only required" } };
  }
  if (!/^[0-9a-f]{64}$/.test(planSha) || !validId(p.taskUuid) || !validId(p.fieldId) || !/^[A-Za-z0-9_.-]{1,128}$/.test(String(p.displayId || ""))) {
    return { status:"WRITE_INPUT_REJECTED", result:{ ok:false, status:"WRITE_INPUT_REJECTED", error:"invalid write provenance/target" } };
  }
  if (!desired || desired.length > 2000) {
    return { status:"WRITE_INPUT_REJECTED", result:{ ok:false, status:"WRITE_INPUT_REJECTED", error:"desired root cause must be 1-2000 characters" } };
  }

  const located = await rcFindDetailTab(config, String(p.displayId));
  if (!located.ok) return { status:located.status, result:{ ok:false, ...located, readOnly:false } };
  const tab = located.tab;
  const preArgs = [{ displayId:String(p.displayId), taskUuid:String(p.taskUuid), fieldId:String(p.fieldId), desiredValue:desired }];

  const [preExec] = await chrome.scripting.executeScript({ target:{tabId:tab.id}, world:"MAIN", func:rcPagePreflightWrite, args:preArgs });
  const preflight = preExec?.result || { ok:false, status:"NO_PREFLIGHT_RESULT" };
  if (preflight.ok && preflight.status === "NOOP_VERIFIED") {
    return { status:"NOOP_VERIFIED", result:{ ...preflight, writeAttempted:false, planSha256:planSha, decision:p.decision, writeMode:p.writeMode } };
  }
  if (!preflight.ok) return { status:preflight.status || "PREWRITE_FAILED", result:{ ...preflight, writeAttempted:false, planSha256:planSha } };

  const debuggee = { tabId:tab.id };
  let attached = false;
  let saveDispatched = false;
  let draft = null;
  try {
    await chrome.debugger.attach(debuggee, "1.3");
    attached = true;
    const x=preflight.inputPoint.x, y=preflight.inputPoint.y;
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mouseMoved",x,y});
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",clickCount:1});
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button:"left",clickCount:1});
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchKeyEvent",{type:"rawKeyDown",key:"a",code:"KeyA",modifiers:2,windowsVirtualKeyCode:65,nativeVirtualKeyCode:65});
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchKeyEvent",{type:"keyUp",key:"a",code:"KeyA",modifiers:2,windowsVirtualKeyCode:65,nativeVirtualKeyCode:65});
    await new Promise((resolve)=>setTimeout(resolve,80));

    const [selExec] = await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:rcPageInspectSelection,args:[String(p.displayId),String(p.fieldId)]});
    const selection = selExec?.result || {ok:false,status:"NO_SELECTION_RESULT"};
    if (!selection.ok || !selection.anchorInside || !selection.focusInside || selection.selectedText !== "") {
      return { status:"DIRTY_EDITOR_ABORT", result:{ ok:false,status:"DIRTY_EDITOR_ABORT",selection,writeAttempted:false,saveDispatched:false,planSha256:planSha } };
    }

    await chrome.debugger.sendCommand(debuggee,"Input.insertText",{text:desired});
    await new Promise((resolve)=>setTimeout(resolve,250));
    const [draftExec] = await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:rcPageInspectDraft,args:[String(p.displayId),String(p.fieldId),desired,preflight.textBlockId]});
    draft = draftExec?.result || {ok:false,status:"NO_DRAFT_RESULT"};
    if (!draft.ok || draft.status !== "DRAFT_DOM_VERIFIED") {
      return { status:draft.status || "DRAFT_DOM_MISMATCH", result:{ok:false,...preflight,draft,writeAttempted:false,saveDispatched:false,planSha256:planSha} };
    }

    const sx=preflight.savePoint.x, sy=preflight.savePoint.y;
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mouseMoved",x:sx,y:sy});
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mousePressed",x:sx,y:sy,button:"left",clickCount:1});
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mouseReleased",x:sx,y:sy,button:"left",clickCount:1});
    saveDispatched = true;
  } catch (error) {
    return { status:saveDispatched ? "WRITE_UNVERIFIED" : "NATIVE_INPUT_FAILED", result:{ok:false,status:saveDispatched?"WRITE_UNVERIFIED":"NATIVE_INPUT_FAILED",error:String(error),saveDispatched,writeAttempted:saveDispatched,planSha256:planSha,draft} };
  } finally {
    if (attached) { try { await chrome.debugger.detach(debuggee); } catch (_) {} }
  }

  const delays=[180,350,650,1100,1800,2600];
  let last=null;
  for(let i=0;i<delays.length;i+=1){
    if(i>0) await new Promise((resolve)=>setTimeout(resolve,delays[i]));
    const [verifyExec] = await chrome.scripting.executeScript({
      target:{tabId:tab.id}, world:"MAIN", func:rcPageVerifyWrite,
      args:[{displayId:String(p.displayId),taskUuid:String(p.taskUuid),fieldId:String(p.fieldId),desiredValue:desired,baselineEventIds:preflight.baselineEventIds}]
    });
    last=verifyExec?.result || null;
    if(last?.ok && last.status==="WRITE_VERIFIED"){
      return { status:"WRITE_VERIFIED", result:{...preflight,ok:true,status:"WRITE_VERIFIED",writeAttempted:true,saveDispatched:true,readbackAttempts:i+1,planSha256:planSha,decision:p.decision,writeMode:p.writeMode,draft,readback:last} };
    }
  }
  return { status:"WRITE_UNVERIFIED", result:{...preflight,ok:false,status:"WRITE_UNVERIFIED",writeAttempted:true,saveDispatched:true,planSha256:planSha,draft,readback:last,error:"save dispatched exactly once but authoritative readback did not verify; automatic retry forbidden"} };
};
