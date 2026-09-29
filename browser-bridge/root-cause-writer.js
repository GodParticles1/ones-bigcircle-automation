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
  const initialHref = location.href;
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

  // Recheck after asynchronous reads, before touching any native editor surface.
  if (location.href !== initialHref || location.origin !== ORIGIN) {
    return fail("TARGET_GUARD_FAILED", "detail page changed during pre-write reads");
  }
  const visible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity || "1") > 0;
  };
  const editorSelector = 'div.standard-co-editor-editing.task-rich-text-edit';
  const exactRoots = () => [...document.querySelectorAll('[id="' + FIELD_UUID + '"]')];
  let roots = exactRoots();
  if (roots.length > 1) return fail("EDITOR_ROOT_NOT_UNIQUE", "root-cause editor root is not unique", { editorRootCount:roots.length });
  let root = roots[0];
  if (!root || !visible(root) || !root.matches(editorSelector)) {
    // Real ONES detail pages can repeat the semantic text in activity/history.
    // Canonicalize only labels that belong to the detail-form field lineage.
    const isRootCauseText = (el) => {
      const text = norm(el.innerText || el.textContent);
      return text === "问题根因" || text === "【问题根因】";
    };
    const rawLabels = [...document.querySelectorAll('label,span,div,p,h1,h2,h3,h4,h5,h6')]
      .filter((el) => visible(el) && isRootCauseText(el));
    const formLabels = [...new Set(rawLabels
      .map((el) => el.closest(".form-field-label.edit_form_field_label"))
      .filter((el) => el && visible(el)))];
    if (formLabels.length !== 1) {
      return fail("ROOT_CAUSE_LABEL_NOT_UNIQUE", "root-cause detail-form label is missing or ambiguous", {
        rawLabelCount:rawLabels.length, labelCount:formLabels.length
      });
    }

    const fieldWrapperSelector = ".oac-flex.oac-py-1.oac-items-start.oac-flex-col";
    const containers = [...new Set(formLabels
      .map((el) => el.closest(fieldWrapperSelector))
      .filter((el) => el && el !== document.body && el !== document.documentElement && visible(el)))];
    if (containers.length !== 1) {
      return fail("ROOT_CAUSE_CONTAINER_NOT_UNIQUE", "root-cause detail field wrapper is missing or ambiguous", {
        containerCount:containers.length
      });
    }
    const container = containers[0];
    const viewers = [...container.querySelectorAll(".standard-co-viewer")].filter(visible);
    if (viewers.length !== 1) {
      return fail("ROOT_CAUSE_VIEWER_NOT_UNIQUE", "root-cause native viewer surface is missing or ambiguous", {
        viewerCount:viewers.length
      });
    }
    if (location.href !== initialHref || location.origin !== ORIGIN || !container.isConnected) {
      return fail("TARGET_GUARD_FAILED", "root-cause target changed before native editor open");
    }

    // The live ONES detail form can place this field far below the current viewport.
    // A CDP mouse point is viewport-relative, so scroll the exact accepted viewer first,
    // then recompute and hit-test the post-scroll geometry. Never click an offscreen point.
    const viewer = viewers[0];
    try {
      viewer.scrollIntoView({ behavior:"auto", block:"center", inline:"nearest" });
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (error) {
      return fail("VIEWER_SCROLL_FAILED", error);
    }
    if (location.href !== initialHref || location.origin !== ORIGIN || !container.isConnected || !viewer.isConnected) {
      return fail("TARGET_GUARD_FAILED", "root-cause target changed during viewer scroll");
    }
    const reboundViewers = [...container.querySelectorAll(".standard-co-viewer")].filter(visible);
    if (reboundViewers.length !== 1 || reboundViewers[0] !== viewer) {
      return fail("ROOT_CAUSE_VIEWER_NOT_UNIQUE", "root-cause viewer changed during bounded scroll", {
        viewerCount:reboundViewers.length
      });
    }

    const vr = viewer.getBoundingClientRect();
    const vx = Math.round(vr.left + vr.width / 2);
    const vy = Math.round(vr.top + vr.height / 2);
    const viewportWidth = Number(window.innerWidth || document.documentElement?.clientWidth || 0);
    const viewportHeight = Number(window.innerHeight || document.documentElement?.clientHeight || 0);
    if (!(vx >= 0 && vy >= 0 && vx < viewportWidth && vy < viewportHeight)) {
      return fail("VIEWER_POINT_OUTSIDE_VIEWPORT", "root-cause viewer center is outside the current viewport", {
        viewerPoint:{x:vx,y:vy}, viewport:{width:viewportWidth,height:viewportHeight}
      });
    }
    const hitStack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(vx, vy) : [];
    if (!hitStack.length) {
      return fail("VIEWER_HIT_TEST_EMPTY", "root-cause viewer point has no viewport hit target", {
        viewerPoint:{x:vx,y:vy}
      });
    }
    const topHit = hitStack[0];
    if (!(topHit === viewer || viewer.contains(topHit))) {
      return fail("VIEWER_HIT_TEST_MISMATCH", "root-cause viewer point is covered by an unrelated element", {
        viewerPoint:{x:vx,y:vy},
        topHitTag:topHit?.tagName || null,
        topHitId:topHit?.id || null
      });
    }
    // Retain node identity only across this one hover/readiness handoff. A new
    // preflight replaces the slot; readiness consumes it and cleanup removes it.
    const openBindingId = crypto.randomUUID();
    globalThis[Symbol.for("onesRootCauseViewerActionV0513")] = {
      openBindingId, viewer, container, label:formLabels[0], fieldId:FIELD_UUID,
      href:initialHref, origin:ORIGIN, createdAt:performance.now()
    };
    return {
      ok:true,
      status:"EDITOR_HOVER_REQUIRED",
      displayId:EXPECTED_DISPLAY_ID,
      taskUuid:EXPECTED_TASK_UUID,
      fieldId:FIELD_UUID,
      desired,
      editorOpened:false,
      prewriteSemantic:second.semantic,
      baselineEventIds:events.map((e) => e.uuid).filter(Boolean),
      hoverPoint:{ x:vx, y:vy },
      openBindingId,
      expectedHref:initialHref
    };
  }
  if (!visible(root) || !root.matches(editorSelector)) return fail("EDITOR_NOT_READY", "root-cause native editor is not visible");

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
    editorOpened:false,
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

function rcPageResolveViewerAction(expectedDisplayId, fieldId, expectedHref, openBindingId) {
  const key = Symbol.for("onesRootCauseViewerActionV0513");
  const binding = globalThis[key];
  const fail = (status, extra = {}) => ({ ok:false, status, ...extra });
  if (!binding || binding.openBindingId !== openBindingId) return fail("VIEWER_BINDING_LOST");
  delete globalThis[key]; // One readiness check only; no reuse after uncertainty.
  const { viewer, container, label } = binding;
  const targetMatches = () => location.href === expectedHref && location.href === binding.href &&
    location.origin === binding.origin && location.href.match(/\/issue\/([^/?#]+)/i)?.[1] === expectedDisplayId;
  if (!targetMatches() || fieldId !== binding.fieldId || performance.now() - binding.createdAt > 10000) return fail("TARGET_GUARD_FAILED");
  const visible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity || "1") > 0;
  };
  const wrapperSelector = ".oac-flex.oac-py-1.oac-items-start.oac-flex-col";
  if (!viewer.isConnected || !container.isConnected || !label.isConnected ||
      label.closest(wrapperSelector) !== container || viewer.closest(wrapperSelector) !== container) return fail("VIEWER_BINDING_LOST");
  const norm = (value) => String(value ?? "").replace(/\u200B|\uFEFF/g, "").replace(/\r\n?/g, "\n").trim();
  const semantic = (el) => ["问题根因", "【问题根因】"].includes(norm(el.innerText || el.textContent));
  const labels = [...document.querySelectorAll(".form-field-label.edit_form_field_label")].filter((el) =>
    visible(el) && (semantic(el) || [...el.querySelectorAll('label,span,div,p,h1,h2,h3,h4,h5,h6')].some((child) => visible(child) && semantic(child))));
  if (labels.length !== 1 || labels[0] !== label) return fail("ROOT_CAUSE_LABEL_NOT_UNIQUE");
  const viewers = [...container.querySelectorAll(".standard-co-viewer")].filter(visible);
  if (viewers.length !== 1 || viewers[0] !== viewer) return fail("ROOT_CAUSE_VIEWER_NOT_UNIQUE");
  const actions = [...viewer.querySelectorAll(".standard-co-viewer-action")].filter(visible);
  if (actions.length !== 1) return fail("VIEWER_ACTION_NOT_UNIQUE", { actionCount:actions.length });
  const action = actions[0];
  const buttons = [...action.querySelectorAll("button")].filter(visible);
  if (buttons.length !== 1) return fail("VIEWER_ACTION_BUTTON_NOT_UNIQUE", { buttonCount:buttons.length });
  const button = buttons[0];
  if (!viewer.contains(button) || action.closest(".standard-co-viewer") !== viewer ||
      button.closest(".standard-co-viewer-action") !== action || button.closest(".standard-co-viewer") !== viewer) return fail("VIEWER_ACTION_OWNERSHIP_FAILED");
  if (button.disabled || button.getAttribute("aria-disabled") === "true") return fail("VIEWER_ACTION_BUTTON_DISABLED");
  const rect = button.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2);
  const width = Number(window.innerWidth || document.documentElement?.clientWidth || 0);
  const height = Number(window.innerHeight || document.documentElement?.clientHeight || 0);
  if (!(x >= 0 && y >= 0 && x < width && y < height)) return fail("VIEWER_ACTION_POINT_OUTSIDE_VIEWPORT");
  const hits = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [];
  if (!hits.length) return fail("VIEWER_ACTION_HIT_TEST_EMPTY");
  if (!(hits[0] === button || button.contains(hits[0]))) return fail("VIEWER_ACTION_HIT_TEST_MISMATCH");
  if (!targetMatches() || !viewer.isConnected || !button.isConnected || !viewer.contains(button)) return fail("TARGET_GUARD_FAILED");
  return { ok:true, status:"EDITOR_OPEN_REQUIRED", buttonPoint:{x,y} };
}

function rcPageClearViewerAction(openBindingId) {
  const key = Symbol.for("onesRootCauseViewerActionV0513");
  if (globalThis[key]?.openBindingId === openBindingId) delete globalThis[key];
}

function rcPageBindOpenedEditor(expectedDisplayId, fieldId, expectedHref) {
  const norm = (value) => String(value ?? "").replace(/\u200B|\uFEFF/g, "").replace(/\r\n?/g, "\n").trim();
  const currentMatch = location.href.match(/\/issue\/([^/?#]+)/i);
  const currentDisplayId = currentMatch ? currentMatch[1] : null;
  const fail = (status, error, extra = {}) => ({
    ok:false, status, error:String(error || status),
    currentDisplayId, expectedDisplayId, fieldId, ...extra
  });
  if ((expectedHref && location.href !== expectedHref) || currentDisplayId !== expectedDisplayId) {
    return fail("TARGET_GUARD_FAILED", "detail page changed during native editor open");
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(fieldId || ""))) return fail("INPUT_REJECTED", "invalid configured field identifier");

  const visible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity || "1") > 0;
  };
  const editorSelector = 'div.standard-co-editor-editing.task-rich-text-edit';
  const openedRoots = [...document.querySelectorAll(editorSelector)].filter(visible);
  if (openedRoots.length !== 1) {
    return fail("EDITOR_ROOT_NOT_UNIQUE", "native editor transition did not produce one visible editor root", {
      editorRootCount:openedRoots.length
    });
  }
  const root = openedRoots[0];
  if (root.id !== fieldId) return fail("EDITOR_FIELD_ID_MISMATCH", "opened editor is not the configured root-cause field");
  const exactRoots = [...document.querySelectorAll('[id="' + fieldId + '"]')];
  if (exactRoots.length !== 1 || exactRoots[0] !== root) {
    return fail("EDITOR_ROOT_NOT_UNIQUE", "configured field root is not unique", { editorRootCount:exactRoots.length });
  }

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
  if (saveControls.length !== 1) {
    return fail("SAVE_CONTROL_NOT_UNIQUE", "root-cause save control is not unique", { saveControlCount:saveControls.length });
  }

  if ((expectedHref && location.href !== expectedHref) || currentDisplayId !== expectedDisplayId || !root.isConnected) {
    return fail("TARGET_GUARD_FAILED", "detail page changed while binding native editor");
  }
  const br = inputBlock.getBoundingClientRect();
  const sr = saveControls[0].getBoundingClientRect();
  return {
    ok:true,
    status:"PREWRITE_READY",
    displayId:expectedDisplayId,
    fieldId,
    editorOpened:true,
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
  // Persist an explicit native paragraph alignment even when inherited CSS
  // already looks left-aligned. Keep the accepted single paragraph verbatim:
  // no splitting, headings, reordering, or inferred solution/next-step facts.
  const range = document.createRange();
  range.selectNodeContents(block);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const applied = document.execCommand("justifyLeft", false, null);
  selection.removeAllRanges();
  if (!applied) return { ok:false, status:"LEFT_ALIGN_COMMAND_FAILED", beforeAlign };
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
  const initialHref = location.href;
  const currentMatch = location.href.match(/\/issue\/([^/?#]+)/i);
  const currentDisplayId = currentMatch ? currentMatch[1] : null;
  const teamMatch = location.href.match(/\/team\/([^/?#]+)/i);
  const teamUuid = teamMatch ? teamMatch[1] : null;
  if ((input.expectedHref && location.href !== input.expectedHref) || !teamUuid || currentDisplayId !== EXPECTED_DISPLAY_ID) return { ok:false, status:"TARGET_GUARD_FAILED" };

  const jsonFetch = async (url, init = {}) => {
    const controller = new AbortController();
    const timeoutMs = input.readTimeoutMs;
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(url, { credentials:"same-origin", ...init, signal:controller.signal });
      const text = await response.text();
      let json = null; if (text) { try { json = JSON.parse(text); } catch (_) {} }
      return { response, json };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  };

  const query = "select uid(uuid,field903," + FIELD_UUID + ") from issue where uid(uuid) = uid('" + EXPECTED_TASK_UUID + "');";
  const [valueRead, eventRead] = await Promise.allSettled([
    jsonFetch(ORIGIN + "/project/api/ones-project/team/" + encodeURIComponent(teamUuid) + "/workitems/onesql", {
      method:"POST", headers:{ "content-type":"application/json; charset=UTF-8" }, body:JSON.stringify({ query })
    }),
    jsonFetch(ORIGIN + "/project/api/project/team/" + encodeURIComponent(teamUuid) + "/task/" + encodeURIComponent(EXPECTED_TASK_UUID) + "/messages", { method:"GET" })
  ]);
  if (location.href !== initialHref || location.origin !== ORIGIN) return { ok:false, status:"TARGET_GUARD_FAILED" };
  const valueResp = valueRead.status === "fulfilled" ? valueRead.value : null;
  const msgResp = eventRead.status === "fulfilled" ? eventRead.value : null;
  const rows = valueResp?.json?.data;
  const item = Array.isArray(rows) && rows.length === 1 ? rows[0]?.item : null;
  const raw = item?.[FIELD_UUID];
  // Same raw/string-or-value-wrapper contract as the accepted field reader.
  const fieldValue = raw && typeof raw === "object" && !Array.isArray(raw) && Object.hasOwn(raw, "value") ? raw.value : raw;
  const valueReadVerified = !!valueResp?.response.ok && item?.uuid === EXPECTED_TASK_UUID &&
    Object.hasOwn(item, FIELD_UUID) && (fieldValue === null || typeof fieldValue === "string");
  const currentSemantic = valueReadVerified ? semanticFromRaw(fieldValue) : null;
  const messages = msgResp?.response.ok && Array.isArray(msgResp.json?.messages) ? msgResp.json.messages : [];
  const event = messages.find((m) => {
    if (!m?.uuid || baseline.has(m.uuid)) return false;
    if (m?.type !== "system" || m?.ext?.field_uuid !== FIELD_UUID) return false;
    return norm(m?.ext?.old_value) === "" && norm(m?.ext?.new_value) === desired;
  });
  const verified = valueReadVerified && currentSemantic === desired && !!event;
  return {
    ok:verified,
    status:verified ? "WRITE_VERIFIED" : "READBACK_PENDING",
    displayId:EXPECTED_DISPLAY_ID,
    taskUuid:EXPECTED_TASK_UUID,
    fieldId:FIELD_UUID,
    currentSemantic,
    valueReadVerified,
    desired,
    fieldEvent:event ? {
      uuid:event.uuid, action:event.action || null,
      oldValue:norm(event?.ext?.old_value), newValue:norm(event?.ext?.new_value),
      fieldName:event?.ext?.field_name || null, fieldTypeUuid:event?.ext?.field_type_uuid || null,
      versionUuid:event.version_uuid || null
    } : null
  };
}

async function rcAcceptedFieldRead(config, tabId, taskUuid, fieldId) {
  const [execution] = await chrome.scripting.executeScript({
    target:{tabId},
    world:"MAIN",
    func:relayReadTaskFields,
    args:[{
      teamUuid:config.teamUuid,
      projectUuid:config.projectUuid,
      issueTypeUuid:config.issueTypeUuid
    }, {
      fieldId:String(fieldId),
      onesTaskUuids:[String(taskUuid)]
    }]
  });
  const result=execution?.result;
  const row=result?.reads?.[0];
  if(!result?.ok || result?.status!=="FIELD_READ_VERIFIED" || result?.complete!==true ||
     row?.status!=="READ_VERIFIED" || row?.onesTaskUuid!==String(taskUuid) || row?.fieldId!==String(fieldId)) {
    throw new Error("ACCEPTED_FIELD_READ_FAILED");
  }
  return String(row.value ?? "");
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

// Read-only post-save policy. This helper has no access to native input or Save.
async function rcVerifyRootCauseAfterSave(tabId, input) {
  const started = performance.now();
  const maxElapsedMs = 90000;
  const readTimeoutMs = 5000;
  const verification = {
    source:"ONESQL_AND_FIELD_EVENTS", attempts:0, inlineAttempts:0,
    convergenceAttempts:0, elapsedMs:0, maxElapsedMs, readTimeoutMs
  };
  const phases = [
    { name:"inline", delays:[0,350,650,1100,1800,2600,4200,6500,9000] },
    { name:"convergence", delays:[5000,10000,15000] }
  ];
  let last = null;
  const remaining = () => maxElapsedMs - (performance.now() - started);
  const finish = (status) => ({
    status, readback:last,
    verification:{ ...verification, elapsedMs:Math.round(performance.now() - started) }
  });
  for (const phase of phases) {
    for (const delay of phase.delays) {
      if (remaining() <= delay) break;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (remaining() <= 0) break;
      verification.attempts += 1;
      verification[phase.name + "Attempts"] += 1;
      verification.phase = phase.name;
      const timeoutMs = Math.min(readTimeoutMs, remaining());
      let timer;
      try {
        const executions = await Promise.race([
          chrome.scripting.executeScript({
            target:{tabId}, world:"MAIN", func:rcPageVerifyWrite,
            // Leave time for aborted page fetches to return their partial evidence.
            args:[{ ...input, readTimeoutMs:Math.max(1, timeoutMs - 250) }]
          }),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve([{ result:{ ok:false, status:"READBACK_TIMEOUT" } }]), timeoutMs);
          })
        ]);
        last = executions?.[0]?.result || { ok:false, status:"NO_READBACK_RESULT" };
      } catch (_) {
        // An unavailable read is evidence of uncertainty, never of persistence.
        last = { ok:false, status:"READBACK_EXECUTION_FAILED" };
      } finally {
        clearTimeout(timer);
      }
      verification.lastStatus = last.status;
      if (last.ok && last.status === "WRITE_VERIFIED") return finish("WRITE_VERIFIED");
      if (last.status === "TARGET_GUARD_FAILED") return finish("WRITE_UNVERIFIED");
      // Keep the inline event-aware window intact. In convergence, stop once
      // authoritative persistence is proven; absence of an event is explicit.
      if (phase.name === "convergence" && last.valueReadVerified && last.currentSemantic === input.desiredValue) {
        return finish("WRITE_VALUE_VERIFIED_EVENT_PENDING");
      }
    }
    if (last?.valueReadVerified && last.currentSemantic === input.desiredValue) return finish("WRITE_VALUE_VERIFIED_EVENT_PENDING");
  }
  return finish("WRITE_UNVERIFIED");
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
  let preflight = preExec?.result || { ok:false, status:"NO_PREFLIGHT_RESULT" };
  if (preflight.ok && preflight.status === "NOOP_VERIFIED") {
    return { status:"NOOP_VERIFIED", result:{ ...preflight, writeAttempted:false, planSha256:planSha, decision:p.decision, writeMode:p.writeMode } };
  }
  if (!preflight.ok) {
    if (preflight.status === "CONFLICT_REVIEW") return { status:"CONFLICT_REVIEW", result:{ ...preflight, writeAttempted:false, planSha256:planSha } };
    return { status:"WRITE_BLOCKED", result:{ ...preflight, status:"WRITE_BLOCKED", blockedBy:preflight.status || "PREWRITE_FAILED", writeAttempted:false, planSha256:planSha } };
  }
  if (preflight.status !== "PREWRITE_READY" && preflight.status !== "EDITOR_HOVER_REQUIRED") {
    return { status:"WRITE_BLOCKED", result:{ ...preflight, status:"WRITE_BLOCKED", blockedBy:preflight.status || "PREWRITE_FAILED", writeAttempted:false, planSha256:planSha } };
  }

  const debuggee = { tabId:tab.id };
  let attached = false;
  let saveDispatched = false;
  let draft = null;
  try {
    await chrome.debugger.attach(debuggee, "1.3");
    attached = true;

    if (preflight.status === "EDITOR_HOVER_REQUIRED") {
      const hx=preflight.hoverPoint?.x, hy=preflight.hoverPoint?.y;
      if (!Number.isFinite(hx) || !Number.isFinite(hy)) {
        return { status:"WRITE_BLOCKED", result:{ ...preflight, ok:false, status:"WRITE_BLOCKED", blockedBy:"EDITOR_OPEN_POINT_INVALID", writeAttempted:false, saveDispatched:false, planSha256:planSha } };
      }
      await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mouseMoved",x:hx,y:hy});
      await new Promise((resolve)=>setTimeout(resolve,150));
      const [actionExec] = await chrome.scripting.executeScript({
        target:{tabId:tab.id}, world:"MAIN", func:rcPageResolveViewerAction,
        args:[String(p.displayId),String(p.fieldId),preflight.expectedHref,preflight.openBindingId]
      });
      const action = actionExec?.result || { ok:false, status:"NO_VIEWER_ACTION_RESULT" };
      if (!action.ok || action.status !== "EDITOR_OPEN_REQUIRED") {
        return { status:"WRITE_BLOCKED", result:{ ...preflight, ok:false, status:"WRITE_BLOCKED", blockedBy:action.status, action, writeAttempted:false, saveDispatched:false, planSha256:planSha } };
      }
      const ox=action.buttonPoint?.x, oy=action.buttonPoint?.y;
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
        return { status:"WRITE_BLOCKED", result:{ ...preflight, ok:false, status:"WRITE_BLOCKED", blockedBy:"EDITOR_OPEN_POINT_INVALID", writeAttempted:false, saveDispatched:false, planSha256:planSha } };
      }
      try {
        await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mouseMoved",x:ox,y:oy});
        await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mousePressed",x:ox,y:oy,button:"left",clickCount:1});
        await chrome.debugger.sendCommand(debuggee,"Input.dispatchMouseEvent",{type:"mouseReleased",x:ox,y:oy,button:"left",clickCount:1});
      } catch (error) {
        return { status:"WRITE_BLOCKED", result:{ ...preflight, ok:false, status:"WRITE_BLOCKED", blockedBy:"EDITOR_OPEN_FAILED", error:String(error), writeAttempted:false, saveDispatched:false, planSha256:planSha } };
      }
      await new Promise((resolve)=>setTimeout(resolve,1000));
      const [bindExec] = await chrome.scripting.executeScript({
        target:{tabId:tab.id}, world:"MAIN", func:rcPageBindOpenedEditor,
        args:[String(p.displayId),String(p.fieldId),tab.url]
      });
      const bound = bindExec?.result || { ok:false, status:"NO_EDITOR_BIND_RESULT" };
      if (!bound.ok || bound.status !== "PREWRITE_READY") {
        return { status:"WRITE_BLOCKED", result:{ ...preflight, ...bound, ok:false, status:"WRITE_BLOCKED", blockedBy:bound.status || "EDITOR_BIND_FAILED", writeAttempted:false, saveDispatched:false, planSha256:planSha } };
      }
      preflight = { ...preflight, ...bound, status:"PREWRITE_READY", editorOpened:true };
    }

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
    if (preflight.openBindingId) {
      try {
        await chrome.scripting.executeScript({ target:{tabId:tab.id}, world:"MAIN", func:rcPageClearViewerAction, args:[preflight.openBindingId] });
      } catch (_) {} // Consumed readiness bindings are already cleared; navigation destroys old page state.
    }
    if (attached) { try { await chrome.debugger.detach(debuggee); } catch (_) {} }
  }

  const checked = await rcVerifyRootCauseAfterSave(tab.id, {
    expectedHref:tab.url,
    displayId:String(p.displayId), taskUuid:String(p.taskUuid), fieldId:String(p.fieldId),
    desiredValue:desired, baselineEventIds:preflight.baselineEventIds
  });
  const semanticStatus = checked.status;
  const semanticVerified = semanticStatus === "WRITE_VERIFIED" || semanticStatus === "WRITE_VALUE_VERIFIED_EVENT_PENDING";
  const presentation = semanticVerified ? await rcVerifyRootCausePresentation(tab.id, {
    expectedHref:tab.url, displayId:String(p.displayId), fieldId:String(p.fieldId), expectedValue:desired
  }) : null;
  const status = semanticVerified && !presentation?.ok ? "WRITE_PRESENTATION_UNVERIFIED" : semanticStatus;
  const error = status === "WRITE_VERIFIED" ? null : status === "WRITE_PRESENTATION_UNVERIFIED"
    ? "semantic persistence verified but rendered presentation is unverified; automatic Save retry forbidden"
    : status === "WRITE_VALUE_VERIFIED_EVENT_PENDING"
    ? "authoritative value matches desired but field event is still pending; automatic retry forbidden"
    : "save dispatched exactly once but authoritative field value did not verify within bounded convergence; automatic retry forbidden";
  return { status, result:{
    ...preflight, ok:status === "WRITE_VERIFIED", status, writeAttempted:true, saveDispatched:true,
    readbackAttempts:checked.verification.attempts, verification:checked.verification,
    semanticStatus, presentation, presentationPolicy:"EXACT_SINGLE_PARAGRAPH_LEFT_V1",
    planSha256:planSha, decision:p.decision, writeMode:p.writeMode, draft, readback:checked.readback,
    ...(error ? { error } : {})
  } };
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
  const second=norm(input?.authoritativeSemantic);
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

function rcPageVerifyRenderedAlignment(expectedDisplayId, fieldId, expectedValue, expectedHref) {
  const norm = (value) => String(value ?? "").replace(/\u200B|\uFEFF/g, "").replace(/\r\n?/g, "\n").trim();
  const initialHref = location.href;
  const targetMatches = () => (!expectedHref || location.href === expectedHref) &&
    location.href === initialHref && location.href.match(/\/issue\/([^/?#]+)/i)?.[1] === expectedDisplayId;
  if (!targetMatches()) return { ok:false, status:"TARGET_GUARD_FAILED" };
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(fieldId || ""))) return { ok:false, status:"RENDERED_FIELD_INPUT_REJECTED" };
  const roots = [...document.querySelectorAll('[id="' + fieldId + '"]')];
  if (roots.length !== 1) return { ok:false, status:"RENDERED_FIELD_NOT_UNIQUE", fieldCount:roots.length };
  const root = roots[0];
  const visible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity || "1") > 0;
  };
  if (!root.isConnected || !visible(root)) return { ok:false, status:"RENDERED_FIELD_NOT_VISIBLE" };
  // A matching draft is not a saved/rendered field. Reject editor ancestors too.
  const editing = '.standard-co-editor-editing,[contenteditable="true"]';
  if (root.closest(editing) || root.querySelectorAll(editing).length) return { ok:false, status:"RENDERED_EDITOR_STILL_OPEN" };
  const expected = norm(expectedValue);
  if (!expected || expected.length > 300 || expected.includes("\n")) return { ok:false, status:"RENDERED_PARAGRAPH_POLICY_FAILED" };
  if (norm(root.innerText || root.textContent) !== expected) return { ok:false, status:"RENDERED_SEMANTIC_MISMATCH" };
  if ([...root.querySelectorAll('h1,h2,h3,h4,h5,h6,ul,ol,li,pre,blockquote')].some(visible)) {
    return { ok:false, status:"RENDERED_PARAGRAPH_POLICY_FAILED" };
  }
  const blocks = [root, ...root.querySelectorAll('*')].filter((el) => {
    const display = getComputedStyle(el).display;
    return visible(el) && display !== "inline" && display !== "contents" && norm(el.innerText || el.textContent) !== "";
  });
  const exactBlocks = blocks.filter((el) => norm(el.innerText || el.textContent) === expected);
  const textBlocks = exactBlocks.filter((el) => !exactBlocks.some((child) => child !== el && el.contains(child)));
  if (textBlocks.length !== 1) return { ok:false, status:"RENDERED_TEXT_BLOCK_NOT_UNIQUE", blockCount:textBlocks.length };
  // Check the text-owning block and all text-bearing descendant blocks. A left
  // ancestor cannot hide a centered/right-aligned paragraph or inline block.
  const textBlock = textBlocks[0];
  const rows = blocks.filter((el) => textBlock.contains(el)).map((el) => ({
    tag:el.tagName, textAlign:String(getComputedStyle(el).textAlign || "").toLowerCase()
  }));
  if (!targetMatches() || !root.isConnected) return { ok:false, status:"TARGET_GUARD_FAILED" };
  const ok = rows.length > 0 && rows.every((row) => row.textAlign === "left" || row.textAlign === "start");
  return { ok, status:ok ? "RENDERED_LEFT_VERIFIED" : "RENDERED_LEFT_PENDING", fieldId, matches:rows };
}

async function rcVerifyRootCausePresentation(tabId, input) {
  const started = performance.now();
  const maxElapsedMs = 5000;
  let last = { ok:false, status:"NO_RENDERED_RESULT" };
  let attempts = 0;
  for (const delay of [0,300,700]) {
    if (performance.now() - started + delay >= maxElapsedMs) break;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const remaining = maxElapsedMs - (performance.now() - started);
    if (remaining <= 0) break;
    attempts += 1;
    let timer;
    try {
      const executions = await Promise.race([
        chrome.scripting.executeScript({
          target:{tabId}, world:"MAIN", func:rcPageVerifyRenderedAlignment,
          args:[input.displayId,input.fieldId,input.expectedValue,input.expectedHref]
        }),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve([{ result:{ ok:false, status:"RENDERED_READ_TIMEOUT" } }]), Math.min(2000, remaining));
        })
      ]);
      last = executions?.[0]?.result || { ok:false, status:"NO_RENDERED_RESULT" };
    } catch (_) {
      last = { ok:false, status:"RENDERED_READ_FAILED" };
    } finally {
      clearTimeout(timer);
    }
    if ((last.ok && last.status === "RENDERED_LEFT_VERIFIED") || last.status === "TARGET_GUARD_FAILED") break;
  }
  return {
    ...last, ok:last.ok === true && last.status === "RENDERED_LEFT_VERIFIED",
    source:"RENDERED_FIELD_DOM", attempts, elapsedMs:Math.round(performance.now() - started), maxElapsedMs
  };
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
  let acceptedFormat1,acceptedFormat2;
  try {
    acceptedFormat1=await rcAcceptedFieldRead(config,tab.id,p.taskUuid,p.fieldId);
    acceptedFormat2=await rcAcceptedFieldRead(config,tab.id,p.taskUuid,p.fieldId);
  } catch(error) {
    return {status:"FORMAT_REPAIR_BLOCKED",result:{ok:false,status:"FORMAT_REPAIR_BLOCKED",blockedBy:"ACCEPTED_FIELD_READ_FAILED",error:String(error),saveDispatched:false}};
  }
  if(acceptedFormat1!==acceptedFormat2) return {status:"FORMAT_REPAIR_BLOCKED",result:{ok:false,status:"FORMAT_REPAIR_BLOCKED",blockedBy:"CONCURRENT_CHANGE_ABORT",firstSemantic:acceptedFormat1,secondSemantic:acceptedFormat2,saveDispatched:false}};
  const [preExec]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:rcPagePreflightFormatRepair,args:[{displayId:String(p.displayId),taskUuid:String(p.taskUuid),fieldId:String(p.fieldId),expectedValue:expected,authoritativeSemantic:acceptedFormat2}]});
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
    const [renderExec]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:rcPageVerifyRenderedAlignment,args:[String(p.displayId),String(p.fieldId),expected,tab.url]});
    lastRender=renderExec?.result||null;
    if(lastRead?.currentSemantic===expected&&lastRender?.ok){
      return {status:"FORMAT_REPAIR_VERIFIED",result:{ok:true,status:"FORMAT_REPAIR_VERIFIED",saveDispatched:true,expectedValueSha256:expectedSha,alignment,draft,readback:lastRead,render:lastRender}};
    }
  }
  return {status:"FORMAT_REPAIR_UNVERIFIED",result:{ok:false,status:"FORMAT_REPAIR_UNVERIFIED",saveDispatched:true,expectedValueSha256:expectedSha,alignment,draft,readback:lastRead,render:lastRender,error:"format Save dispatched once but exact-value + rendered-left verification did not both pass; automatic retry forbidden"}};
};
