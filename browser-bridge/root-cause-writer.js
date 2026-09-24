/* Bounded production root-cause writer.
 * Runtime target identifiers are supplied by the accepted unique-task plan.
 * No arbitrary field writer and no direct richtext update3 path exists here.
 */

function rcNorm(value) {
  return String(value ?? "").replace(/\u200B|\uFEFF/g, "").replace(/\r\n?/g, "\n").trim();
}

async function rcSha256Utf8(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  const norm = (value) => String(value ?? "").replace(/\u200B|\uFEFF/g, "").replace(/\r\n?/g, "\n").trim();
  const semanticFromRaw = (raw) => {
    if (raw == null) return "";
    const text = String(raw);
    const meta = text.match(/<meta[^>]+name=["\']ones-editor-text["\'][^>]+content=["\']([^"\']*)["\']/i)
      || text.match(/<meta[^>]+content=["\']([^"\']*)["\'][^>]+name=["\']ones-editor-text["\']/i);
    if (meta && meta[1]) { try { const bytes=Uint8Array.from(atob(meta[1]),(ch)=>ch.charCodeAt(0)); return norm(new TextDecoder().decode(bytes)); } catch (_) {} }
    try { const doc=new DOMParser().parseFromString(text,"text/html"); const bodyText=norm((doc.body&&(doc.body.innerText||doc.body.textContent))||""); if(bodyText) return bodyText; } catch (_) {}
    return norm(text.replace(/<!--version:[^>]*-->/gi,"").replace(/<!--[\s\S]*?-->/g,"").replace(/<[^>]+>/g," "));
  };
  const FIELD_UUID = String(input?.fieldId || "");
  const EXPECTED_DISPLAY_ID = String(input?.displayId || "");
  const EXPECTED_TASK_UUID = String(input?.taskUuid || "");
  const desired = norm(input?.desiredValue);
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
  if (!desired || desired.length > 300 || desired.includes("\n") || /\u0000/.test(desired)) return fail("INPUT_REJECTED", "bounded writer v1 requires 1-300 characters of single-paragraph root cause text");

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
    return { raw:item[FIELD_UUID] ?? null, semantic:semanticFromRaw(item[FIELD_UUID]) };
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
    .filter((el) => visible(el) && norm(el.innerText || el.textContent) === "保存");
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
  const norm = (value) => String(value ?? "").replace(/\u200B|\uFEFF/g, "").replace(/\r\n?/g, "\n").trim();
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
    selectedText:norm(selection?.toString() || ""),
    anchorInside:!!anchorEl && root.contains(anchorEl),
    focusInside:!!focusEl && root.contains(focusEl)
  };
}

function rcPageNormalizeDraftAlignment(expectedDisplayId, fieldId, desiredText, expectedTextBlockId) {
  const norm = (value) => String(value ?? "").replace(/\u200B|\uFEFF/g, "").replace(/\r\n?/g, "\n").trim();
  const currentMatch = location.href.match(/\/issue\/([^/?#]+)/i);
  const currentDisplayId = currentMatch ? currentMatch[1] : null;
  if (currentDisplayId !== expectedDisplayId) return { ok:false, status:"TARGET_GUARD_FAILED", currentDisplayId, expectedDisplayId };
  const root = document.getElementById(fieldId);
  if (!root) return { ok:false, status:"EDITOR_NOT_READY" };
  const block = expectedTextBlockId ? document.getElementById(expectedTextBlockId) : null;
  if (!block || !root.contains(block) || !block.matches('.text-block[data-type="editor-block"][data-block-type="text"]')) {
    return { ok:false, status:"ACTIVE_BLOCK_LOST", expectedTextBlockId:expectedTextBlockId || null };
  }
  const textNodes = [...block.querySelectorAll(".text")].filter((el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
  });
  if (textNodes.length !== 1) return { ok:false, status:"DRAFT_TEXT_SURFACE_NOT_UNIQUE", textNodeCount:textNodes.length };
  const desired = norm(desiredText);
  const before = norm(textNodes[0].innerText || textNodes[0].textContent || "");
  if (before !== desired) return { ok:false, status:"DRAFT_DOM_MISMATCH", draft:before, desired };

  const beforeAlign = String(getComputedStyle(block).textAlign || "").toLowerCase();
  if (beforeAlign !== "left" && beforeAlign !== "start") {
    const range = document.createRange();
    range.selectNodeContents(block);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const applied = document.execCommand("justifyLeft", false, null);
    selection.removeAllRanges();
    if (!applied) return { ok:false, status:"LEFT_ALIGN_COMMAND_FAILED", beforeAlign };
  }
  const after = norm(textNodes[0].innerText || textNodes[0].textContent || "");
  const afterAlign = String(getComputedStyle(block).textAlign || "").toLowerCase();
  const ok = after === desired && (afterAlign === "left" || afterAlign === "start");
  return {
    ok,
    status:ok ? "DRAFT_LEFT_ALIGN_VERIFIED" : "DRAFT_LEFT_ALIGN_FAILED",
    draft:after,
    desired,
    beforeAlign,
    afterAlign,
    textBlockId:block.id || null
  };
}

function rcPageInspectDraft(expectedDisplayId, fieldId, desiredText, expectedTextBlockId) {
  const norm = (value) => String(value ?? "").replace(/\u200B|\uFEFF/g, "").replace(/\r\n?/g, "\n").trim();
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
  const draft = norm(textNodes[0].innerText || textNodes[0].textContent || "");
  const desired = norm(desiredText);
  const textAlign = String(getComputedStyle(block).textAlign || "").toLowerCase();
  const visible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity || "1") > 0;
  };
  const saveControls = [...root.querySelectorAll("button,[role=button]")]
    .filter((el) => visible(el) && norm(el.innerText || el.textContent) === "保存");
  if (saveControls.length !== 1) {
    return { ok:false, status:"POST_DRAFT_SAVE_CONTROL_NOT_UNIQUE", draft, desired, textAlign, saveControlCount:saveControls.length };
  }
  const sr = saveControls[0].getBoundingClientRect();
  const aligned = textAlign === "left" || textAlign === "start";
  const ok = draft === desired && aligned;
  return {
    ok,
    status:ok ? "DRAFT_DOM_VERIFIED" : (draft !== desired ? "DRAFT_DOM_MISMATCH" : "DRAFT_ALIGNMENT_INVALID"),
    draft,
    desired,
    textAlign,
    textBlockId:block.id || null,
    savePoint:{ x:Math.round(sr.left + sr.width / 2), y:Math.round(sr.top + sr.height / 2) }
  };
}

async function rcPageVerifyWrite(input) {
  const norm = (value) => String(value ?? "").replace(/\u200B|\uFEFF/g, "").replace(/\r\n?/g, "\n").trim();
  const semanticFromRaw = (raw) => {
    if (raw == null) return "";
    const text = String(raw);
    const meta = text.match(/<meta[^>]+name=["\']ones-editor-text["\'][^>]+content=["\']([^"\']*)["\']/i)
      || text.match(/<meta[^>]+content=["\']([^"\']*)["\'][^>]+name=["\']ones-editor-text["\']/i);
    if (meta && meta[1]) { try { const bytes=Uint8Array.from(atob(meta[1]),(ch)=>ch.charCodeAt(0)); return norm(new TextDecoder().decode(bytes)); } catch (_) {} }
    try { const doc=new DOMParser().parseFromString(text,"text/html"); const bodyText=norm((doc.body&&(doc.body.innerText||doc.body.textContent))||""); if(bodyText) return bodyText; } catch (_) {}
    return norm(text.replace(/<!--version:[^>]*-->/gi,"").replace(/<!--[\s\S]*?-->/g,"").replace(/<[^>]+>/g," "));
  };
  const FIELD_UUID = String(input?.fieldId || "");
  const EXPECTED_DISPLAY_ID = String(input?.displayId || "");
  const EXPECTED_TASK_UUID = String(input?.taskUuid || "");
  const desired = norm(input?.desiredValue);
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
  const currentSemantic = item?.uuid === EXPECTED_TASK_UUID ? semanticFromRaw(item[FIELD_UUID]) : null;
  const messages = Array.isArray(msgResp.json?.messages) ? msgResp.json.messages : [];
  const event = messages.find((m) => {
    if (!m?.uuid || baseline.has(m.uuid)) return false;
    if (m?.type !== "system" || m?.ext?.field_uuid !== FIELD_UUID) return false;
    return norm(m?.ext?.old_value) === "" && norm(m?.ext?.new_value) === desired;
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
      oldValue:norm(event?.ext?.old_value), newValue:norm(event?.ext?.new_value),
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
  const expectedDesiredSha = String(p.desiredSha256 || "").toLowerCase();
  if (p.taskTargetPolicy !== "UNIQUE_ONES_TASK_ONLY" || p.decision !== "SET_CANDIDATE" || p.writeMode !== "fill_empty_only") {
    return { status:"WRITE_INPUT_REJECTED", result:{ ok:false, status:"WRITE_INPUT_REJECTED", error:"task-level SET_CANDIDATE / fill_empty_only required" } };
  }
  if (!/^[0-9a-f]{64}$/.test(planSha) || !/^[0-9a-f]{64}$/.test(expectedDesiredSha) || !validId(p.taskUuid) || !validId(p.fieldId) || !/^[A-Za-z0-9_.-]{1,128}$/.test(String(p.displayId || ""))) {
    return { status:"WRITE_INPUT_REJECTED", result:{ ok:false, status:"WRITE_INPUT_REJECTED", error:"invalid write provenance/target" } };
  }
  if (!desired || desired.length > 300 || desired.includes("\n")) {
    return { status:"WRITE_INPUT_REJECTED", result:{ ok:false, status:"WRITE_INPUT_REJECTED", error:"bounded writer v1 requires 1-300 characters of single-paragraph root cause text" } };
  }
  const actualDesiredSha = await rcSha256Utf8(desired);
  if (actualDesiredSha !== expectedDesiredSha) {
    return { status:"WRITE_INPUT_REJECTED", result:{ ok:false, status:"WRITE_INPUT_REJECTED", error:"DESIRED_VALUE_HASH_MISMATCH", expectedDesiredSha256:expectedDesiredSha, actualDesiredSha256:actualDesiredSha } };
  }
  if (!config?.rootCauseFieldId || String(p.fieldId) !== String(config.rootCauseFieldId)) {
    return { status:"WRITE_INPUT_REJECTED", result:{ ok:false, status:"WRITE_INPUT_REJECTED", error:"fieldId does not match locally configured root-cause field" } };
  }

  const located = await rcFindDetailTab(config, String(p.displayId));
  if (!located.ok) return { status:"WRITE_BLOCKED", result:{ ok:false, ...located, status:"WRITE_BLOCKED", blockedBy:located.status, readOnly:false } };
  const tab = located.tab;
  const preArgs = [{ displayId:String(p.displayId), taskUuid:String(p.taskUuid), fieldId:String(p.fieldId), desiredValue:desired }];

  const [preExec] = await chrome.scripting.executeScript({ target:{tabId:tab.id}, world:"MAIN", func:rcPagePreflightWrite, args:preArgs });
  const preflight = preExec?.result || { ok:false, status:"NO_PREFLIGHT_RESULT" };
  if (preflight.ok && preflight.status === "NOOP_VERIFIED") {
    return { status:"NOOP_VERIFIED", result:{ ...preflight, writeAttempted:false, planSha256:planSha, decision:p.decision, writeMode:p.writeMode } };
  }
  if (!preflight.ok) {
    if (preflight.status === "CONFLICT_REVIEW") return { status:"CONFLICT_REVIEW", result:{ ...preflight, writeAttempted:false, planSha256:planSha } };
    return { status:"WRITE_BLOCKED", result:{ ...preflight, status:"WRITE_BLOCKED", blockedBy:preflight.status || "PREWRITE_FAILED", writeAttempted:false, planSha256:planSha } };
  }

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
      return { status:"WRITE_BLOCKED", result:{ ok:false,status:"WRITE_BLOCKED",blockedBy:"DIRTY_EDITOR_ABORT",selection,writeAttempted:false,saveDispatched:false,planSha256:planSha } };
    }

    await chrome.debugger.sendCommand(debuggee,"Input.insertText",{text:desired});
    await new Promise((resolve)=>setTimeout(resolve,250));

    const [alignExec] = await chrome.scripting.executeScript({
      target:{tabId:tab.id}, world:"MAIN", func:rcPageNormalizeDraftAlignment,
      args:[String(p.displayId),String(p.fieldId),desired,preflight.textBlockId]
    });
    const alignment = alignExec?.result || {ok:false,status:"NO_ALIGNMENT_RESULT"};
    if (!alignment.ok || alignment.status !== "DRAFT_LEFT_ALIGN_VERIFIED") {
      return { status:"WRITE_BLOCKED", result:{ok:false,...preflight,status:"WRITE_BLOCKED",blockedBy:alignment.status || "DRAFT_LEFT_ALIGN_FAILED",alignment,writeAttempted:false,saveDispatched:false,planSha256:planSha} };
    }

    await new Promise((resolve)=>setTimeout(resolve,120));
    const [draftExec] = await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:rcPageInspectDraft,args:[String(p.displayId),String(p.fieldId),desired,preflight.textBlockId]});
    draft = draftExec?.result || {ok:false,status:"NO_DRAFT_RESULT"};
    if (!draft.ok || draft.status !== "DRAFT_DOM_VERIFIED") {
      return { status:"WRITE_BLOCKED", result:{ok:false,...preflight,status:"WRITE_BLOCKED",blockedBy:draft.status || "DRAFT_DOM_MISMATCH",alignment,draft,writeAttempted:false,saveDispatched:false,planSha256:planSha} };
    }

    const sx=draft.savePoint.x, sy=draft.savePoint.y;
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mouseMoved",x:sx,y:sy});
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mousePressed",x:sx,y:sy,button:"left",clickCount:1});
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mouseReleased",x:sx,y:sy,button:"left",clickCount:1});
    saveDispatched = true;
  } catch (error) {
    return { status:saveDispatched ? "WRITE_UNVERIFIED" : "WRITE_BLOCKED", result:{ok:false,status:saveDispatched?"WRITE_UNVERIFIED":"WRITE_BLOCKED",blockedBy:saveDispatched?null:"NATIVE_INPUT_FAILED",error:String(error),saveDispatched,writeAttempted:saveDispatched,planSha256:planSha,draft} };
  } finally {
    if (attached) { try { await chrome.debugger.detach(debuggee); } catch (_) {} }
  }

  const delays=[180,350,650,1100,1800,2600,4200,6500,9000];
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
  if (last?.currentSemantic === desired) {
    return { status:"WRITE_VALUE_VERIFIED_EVENT_PENDING", result:{...preflight,ok:false,status:"WRITE_VALUE_VERIFIED_EVENT_PENDING",writeAttempted:true,saveDispatched:true,planSha256:planSha,draft,readback:last,error:"authoritative value matches desired but field event is still pending; automatic retry forbidden"} };
  }
  return { status:"WRITE_UNVERIFIED", result:{...preflight,ok:false,status:"WRITE_UNVERIFIED",writeAttempted:true,saveDispatched:true,planSha256:planSha,draft,readback:last,error:"save dispatched exactly once but authoritative field value did not verify; automatic retry forbidden"} };
};


async function rcPagePreflightFormatRepair(input) {
  const norm = (value) => String(value ?? "").replace(/\u200B|\uFEFF/g, "").replace(/\r\n?/g, "\n").trim();
  const semanticFromRaw = (raw) => {
    if (raw == null) return "";
    const text = String(raw);
    const meta = text.match(/<meta[^>]+name=["\']ones-editor-text["\'][^>]+content=["\']([^"\']*)["\']/i)
      || text.match(/<meta[^>]+content=["\']([^"\']*)["\'][^>]+name=["\']ones-editor-text["\']/i);
    if (meta && meta[1]) { try { const bytes=Uint8Array.from(atob(meta[1]),(ch)=>ch.charCodeAt(0)); return norm(new TextDecoder().decode(bytes)); } catch (_) {} }
    try { const doc=new DOMParser().parseFromString(text,"text/html"); const bodyText=norm((doc.body&&(doc.body.innerText||doc.body.textContent))||""); if(bodyText) return bodyText; } catch (_) {}
    return norm(text.replace(/<!--version:[^>]*-->/gi,"").replace(/<!--[\s\S]*?-->/g,"").replace(/<[^>]+>/g," "));
  };
  const fieldId=String(input?.fieldId||"");
  const displayId=String(input?.displayId||"");
  const taskUuid=String(input?.taskUuid||"");
  const expected=norm(input?.expectedValue);
  const currentMatch=location.href.match(/\/issue\/([^/?#]+)/i);
  const currentDisplayId=currentMatch?currentMatch[1]:null;
  const teamMatch=location.href.match(/\/team\/([^/?#]+)/i);
  const teamUuid=teamMatch?teamMatch[1]:null;
  const fail=(status,error,extra={})=>({ok:false,status,error:String(error||status),...extra});
  if(!teamUuid||currentDisplayId!==displayId) return fail("TARGET_GUARD_FAILED","current detail page does not match expected display ID");
  const jsonFetch=async(url,init={})=>{const response=await fetch(url,{credentials:"same-origin",...init});const text=await response.text();let json=null;if(text){try{json=JSON.parse(text)}catch(_){}}return{response,json}};
  const idr=await jsonFetch(location.origin+"/project/api/ones-project/team/"+encodeURIComponent(teamUuid)+"/tasks/identifier",{
    method:"POST",headers:{"content-type":"application/json; charset=UTF-8"},body:JSON.stringify({display_id_path:displayId})
  });
  if(!idr.response.ok||idr.json?.display_id!==displayId||idr.json?.task_uuid!==taskUuid) return fail("TARGET_RESOLVE_FAILED","display ID did not resolve to expected task UUID");
  const query="select uid(uuid,field903,"+fieldId+") from issue where uid(uuid) = uid('"+taskUuid+"');";
  const read=async()=>{const r=await jsonFetch(location.origin+"/project/api/ones-project/team/"+encodeURIComponent(teamUuid)+"/workitems/onesql",{
    method:"POST",headers:{"content-type":"application/json; charset=UTF-8"},body:JSON.stringify({query})
  });const item=r.json?.data?.[0]?.item;if(!r.response.ok||!item||item.uuid!==taskUuid) throw new Error("onesql HTTP "+r.response.status);return semanticFromRaw(item[fieldId])};
  let first,second;
  try{first=await read();second=await read();}catch(error){return fail("PREFORMAT_READ_FAILED",error)}
  if(first!==second) return fail("CONCURRENT_CHANGE_ABORT","field changed between format preflight reads",{firstSemantic:first,secondSemantic:second});
  if(second!==expected) return fail("FORMAT_VALUE_MISMATCH","current semantic value differs from expected exact value",{currentSemantic:second,expected});

  const root=document.getElementById(fieldId);
  if(!root) return fail("EDITOR_NOT_READY","open the root-cause field in edit mode before polling the format repair job");
  const visible=(el)=>{if(!el||!(el instanceof Element))return false;const r=el.getBoundingClientRect();const cs=getComputedStyle(el);return r.width>0&&r.height>0&&cs.display!=="none"&&cs.visibility!=="hidden"&&Number(cs.opacity||"1")>0};
  const blocks=[...root.querySelectorAll('.text-block[data-type="editor-block"][data-block-type="text"]')].filter(visible);
  const focused=blocks.filter((el)=>el.classList.contains("focused"));
  const block=focused.length===1?focused[0]:(blocks.length===1?blocks[0]:null);
  if(!block) return fail("EDITOR_ACTIVE_BLOCK_NOT_UNIQUE","root-cause text block is not unique",{blockCount:blocks.length,focusedBlockCount:focused.length});
  const textNodes=[...block.querySelectorAll(".text")].filter(visible);
  if(textNodes.length!==1) return fail("DRAFT_TEXT_SURFACE_NOT_UNIQUE","format repair text surface is not unique",{textNodeCount:textNodes.length});
  const draft=norm(textNodes[0].innerText||textNodes[0].textContent||"");
  if(draft!==expected) return fail("FORMAT_EDITOR_VALUE_MISMATCH","editor text differs from authoritative expected value",{draft,expected});
  return {ok:true,status:"FORMAT_REPAIR_READY",displayId,taskUuid,fieldId,expectedValue:expected,textBlockId:block.id||null,beforeAlign:String(getComputedStyle(block).textAlign||"").toLowerCase()};
}

function rcPageVerifyRenderedAlignment(expectedDisplayId, fieldId, expectedValue) {
  const norm=(value)=>String(value??"").replace(/\u200B|\uFEFF/g,"").replace(/\r\n?/g,"\n").trim();
  const currentMatch=location.href.match(/\/issue\/([^/?#]+)/i);
  if((currentMatch?currentMatch[1]:null)!==expectedDisplayId) return {ok:false,status:"TARGET_GUARD_FAILED"};
  const root=document.getElementById(fieldId);
  if(!root) return {ok:false,status:"FIELD_CONTAINER_NOT_FOUND"};
  const expected=norm(expectedValue);
  const visible=(el)=>{if(!el||!(el instanceof Element))return false;const r=el.getBoundingClientRect();const cs=getComputedStyle(el);return r.width>0&&r.height>0&&cs.display!=="none"&&cs.visibility!=="hidden"};
  const candidates=[root,...root.querySelectorAll(".text,p,div,span")].filter((el)=>visible(el)&&norm(el.innerText||el.textContent||"")===expected);
  const rows=candidates.map((el)=>({tag:el.tagName,className:el.className||"",textAlign:String(getComputedStyle(el).textAlign||"").toLowerCase()}));
  const match=rows.find((row)=>row.textAlign==="left"||row.textAlign==="start")||null;
  return {ok:!!match,status:match?"RENDERED_LEFT_VERIFIED":"RENDERED_LEFT_PENDING",matches:rows.slice(-12)};
}

globalThis.onesRootCauseFormatRepairExecute = async function(config, job) {
  const p=job?.payload||{};
  const expected=rcNorm(p.expectedValue);
  const expectedSha=String(p.expectedValueSha256||"").toLowerCase();
  if(p.formatPolicy!=="EXACT_VALUE_LEFT_ALIGN_ONLY") return {status:"FORMAT_REPAIR_INPUT_REJECTED",result:{ok:false,status:"FORMAT_REPAIR_INPUT_REJECTED",error:"exact-value left-align policy required"}};
  if(!/^[0-9a-f]{64}$/.test(expectedSha)||!expected||expected.length>300||expected.includes("\n")) return {status:"FORMAT_REPAIR_INPUT_REJECTED",result:{ok:false,status:"FORMAT_REPAIR_INPUT_REJECTED",error:"invalid expected value/hash"}};
  if(!config?.rootCauseFieldId||String(p.fieldId)!==String(config.rootCauseFieldId)) return {status:"FORMAT_REPAIR_INPUT_REJECTED",result:{ok:false,status:"FORMAT_REPAIR_INPUT_REJECTED",error:"fieldId does not match locally configured root-cause field"}};
  const actualSha=await rcSha256Utf8(expected);
  if(actualSha!==expectedSha) return {status:"FORMAT_REPAIR_INPUT_REJECTED",result:{ok:false,status:"FORMAT_REPAIR_INPUT_REJECTED",error:"EXPECTED_VALUE_HASH_MISMATCH",expectedValueSha256:expectedSha,actualValueSha256:actualSha}};

  const located=await rcFindDetailTab(config,String(p.displayId));
  if(!located.ok) return {status:"FORMAT_REPAIR_BLOCKED",result:{ok:false,status:"FORMAT_REPAIR_BLOCKED",blockedBy:located.status}};
  const tab=located.tab;
  const [preExec]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:rcPagePreflightFormatRepair,args:[{displayId:String(p.displayId),taskUuid:String(p.taskUuid),fieldId:String(p.fieldId),expectedValue:expected}]});
  const pre=preExec?.result||{ok:false,status:"NO_PREFORMAT_RESULT"};
  if(!pre.ok) return {status:"FORMAT_REPAIR_BLOCKED",result:{...pre,ok:false,status:"FORMAT_REPAIR_BLOCKED",blockedBy:pre.status||"PREFORMAT_FAILED",saveDispatched:false}};

  const [alignExec]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:rcPageNormalizeDraftAlignment,args:[String(p.displayId),String(p.fieldId),expected,pre.textBlockId]});
  const alignment=alignExec?.result||{ok:false,status:"NO_ALIGNMENT_RESULT"};
  if(!alignment.ok||alignment.status!=="DRAFT_LEFT_ALIGN_VERIFIED") return {status:"FORMAT_REPAIR_BLOCKED",result:{ok:false,status:"FORMAT_REPAIR_BLOCKED",blockedBy:alignment.status||"ALIGNMENT_FAILED",alignment,saveDispatched:false}};

  const [draftExec]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:rcPageInspectDraft,args:[String(p.displayId),String(p.fieldId),expected,pre.textBlockId]});
  const draft=draftExec?.result||{ok:false,status:"NO_DRAFT_RESULT"};
  if(!draft.ok||draft.status!=="DRAFT_DOM_VERIFIED") return {status:"FORMAT_REPAIR_BLOCKED",result:{ok:false,status:"FORMAT_REPAIR_BLOCKED",blockedBy:draft.status||"DRAFT_VERIFY_FAILED",alignment,draft,saveDispatched:false}};

  const debuggee={tabId:tab.id};
  let attached=false,saveDispatched=false;
  try{
    await chrome.debugger.attach(debuggee,"1.3");attached=true;
    const sx=draft.savePoint.x,sy=draft.savePoint.y;
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mouseMoved",x:sx,y:sy});
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mousePressed",x:sx,y:sy,button:"left",clickCount:1});
    await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mouseReleased",x:sx,y:sy,button:"left",clickCount:1});
    saveDispatched=true;
  }catch(error){
    return {status:saveDispatched?"FORMAT_REPAIR_UNVERIFIED":"FORMAT_REPAIR_BLOCKED",result:{ok:false,status:saveDispatched?"FORMAT_REPAIR_UNVERIFIED":"FORMAT_REPAIR_BLOCKED",error:String(error),saveDispatched,alignment,draft}};
  }finally{if(attached){try{await chrome.debugger.detach(debuggee)}catch(_){}}}

  const delays=[350,700,1200,2000,3500,5500,8000];
  let lastRead=null,lastRender=null;
  for(let i=0;i<delays.length;i+=1){
    if(i>0) await new Promise((resolve)=>setTimeout(resolve,delays[i]));
    const [verifyExec]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:rcPageVerifyWrite,args:[{displayId:String(p.displayId),taskUuid:String(p.taskUuid),fieldId:String(p.fieldId),desiredValue:expected,baselineEventIds:[]}]});
    lastRead=verifyExec?.result||null;
    const [renderExec]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:rcPageVerifyRenderedAlignment,args:[String(p.displayId),String(p.fieldId),expected]});
    lastRender=renderExec?.result||null;
    if(lastRead?.currentSemantic===expected&&lastRender?.ok){
      return {status:"FORMAT_REPAIR_VERIFIED",result:{ok:true,status:"FORMAT_REPAIR_VERIFIED",saveDispatched:true,expectedValueSha256:expectedSha,alignment,draft,readback:lastRead,render:lastRender}};
    }
  }
  return {status:"FORMAT_REPAIR_UNVERIFIED",result:{ok:false,status:"FORMAT_REPAIR_UNVERIFIED",saveDispatched:true,expectedValueSha256:expectedSha,alignment,draft,readback:lastRead,render:lastRender,error:"format Save dispatched once but exact-value + rendered-left verification did not both pass; automatic retry forbidden"}};
};
