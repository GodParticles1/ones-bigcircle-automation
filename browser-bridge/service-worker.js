importScripts("root-cause-writer.js");
const RELAY_CONFIG_KEY = "onesRelayConfig";
const RELAY_RUNTIME_KEY = "onesRelayRuntime";
const RELAY_ALARM = "onesRelayPollV02";
const RELAY_DEFAULT_URL = "http://127.0.0.1:18731";
const RELAY_READ_CAPABILITIES = ["RELAY_PING", "ONES_INVENTORY_READ", "ONES_FIELD_READ"];
function relayCapabilities(config) {
  return config?.writeEnabled ? [...RELAY_READ_CAPABILITIES, "ONES_ROOT_CAUSE_WRITE"] : [...RELAY_READ_CAPABILITIES];
}

function validateRelayUrl(value) {
  const url = new URL(String(value || RELAY_DEFAULT_URL));
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "18731") {
    throw new Error("Relay v0.2 只允许 http://127.0.0.1:18731");
  }
  if (url.username || url.password || (url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("Relay URL 只能是 http://127.0.0.1:18731");
  }
  return RELAY_DEFAULT_URL;
}

function normalizeOnesOrigin(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new Error("ONES origin 必须使用 https");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("ONES origin 只允许 scheme + host + optional port");
  }
  return url.origin;
}

function normalizeScopeId(name, value) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(text)) throw new Error(name + " 未配置或格式非法");
  return text;
}

function validatedOnesScope(input) {
  return {
    onesOrigin: normalizeOnesOrigin(input?.onesOrigin),
    teamUuid: normalizeScopeId("teamUuid", input?.teamUuid),
    projectUuid: normalizeScopeId("projectUuid", input?.projectUuid),
    issueTypeUuid: normalizeScopeId("issueTypeUuid", input?.issueTypeUuid),
    assigneeDepartmentUuid: normalizeScopeId("assigneeDepartmentUuid", input?.assigneeDepartmentUuid)
  };
}

function validateInventoryUrl(value, config) {
  const scope = validatedOnesScope(config);
  const url = new URL(String(value || ""));
  if (url.origin !== scope.onesOrigin) throw new Error("inventory URL 必须属于已配置 ONES origin");
  if (!url.href.includes("/team/" + scope.teamUuid + "/")) throw new Error("当前页面不属于已配置 ONES team");
  return url.href;
}

async function getRelayConfig() {
  const data = await chrome.storage.local.get(RELAY_CONFIG_KEY);
  const current = data[RELAY_CONFIG_KEY] || {};
  let changed = false;
  if (!current.executorId) { current.executorId = "ones-chrome-" + crypto.randomUUID(); changed = true; }
  if (!current.baseUrl) { current.baseUrl = RELAY_DEFAULT_URL; changed = true; }
  if (typeof current.enabled !== "boolean") { current.enabled = false; changed = true; }
  if (typeof current.writeEnabled !== "boolean") { current.writeEnabled = false; changed = true; }
  if (typeof current.token !== "string") { current.token = ""; changed = true; }
  if (typeof current.inventoryPageUrl !== "string") { current.inventoryPageUrl = ""; changed = true; }
  for (const key of ["onesOrigin","teamUuid","projectUuid","issueTypeUuid","assigneeDepartmentUuid"]) {
    if (typeof current[key] !== "string") { current[key] = ""; changed = true; }
  }
  if (changed) await chrome.storage.local.set({ [RELAY_CONFIG_KEY]: current });
  return current;
}

async function saveRelayConfig(config) {
  await chrome.storage.local.set({ [RELAY_CONFIG_KEY]: config });
  return config;
}

async function setRelayRuntime(patch) {
  const data = await chrome.storage.local.get(RELAY_RUNTIME_KEY);
  const next = { ...(data[RELAY_RUNTIME_KEY] || {}), ...patch, updatedAt:new Date().toISOString() };
  await chrome.storage.local.set({ [RELAY_RUNTIME_KEY]: next });
  return next;
}

async function getRelayRuntime() {
  const data = await chrome.storage.local.get(RELAY_RUNTIME_KEY);
  return data[RELAY_RUNTIME_KEY] || {};
}

async function relayFetch(config, path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.auth !== false) {
    if (!config.token) throw new Error("Relay token 未配置");
    headers["X-Relay-Token"] = config.token;
  }
  if (options.body != null && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(config.baseUrl + path, {
    method:options.method || "GET",
    headers,
    body:options.body == null ? undefined : JSON.stringify(options.body),
    cache:"no-store"
  });
  if (response.status === 204) return { response, json:null };
  const text = await response.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch (_) {} }
  return { response, json, text };
}

async function findOnesTabs(config) {
  let scope;
  try { scope = validatedOnesScope(config); } catch (_) { return []; }
  try { return await chrome.tabs.query({ url: scope.onesOrigin + "/*" }); } catch (_) { return []; }
}

async function relayHeartbeat(config) {
  const tabs = await findOnesTabs(config);
  const result = await relayFetch(config, "/v1/extension/heartbeat", {
    method:"POST",
    body:{
      executorId:config.executorId,
      extensionVersion:chrome.runtime.getManifest().version,
      capabilities:relayCapabilities(config),
      onesTabCount:tabs.length
    }
  });
  if (!result.response.ok || !result.json?.ok) throw new Error("heartbeat HTTP " + result.response.status);
  return result.json;
}

async function postRelayResult(config, job, status, result) {
  const posted = await relayFetch(config, "/v1/extension/result", {
    method:"POST",
    body:{ jobId:job.jobId, executorId:config.executorId, status, result }
  });
  if (!posted.response.ok || !posted.json?.ok) throw new Error("result HTTP " + posted.response.status);
  return posted.json;
}

async function probeInventoryPage() {
  const text = String(document.body?.innerText || "");
  const total = text.match(/共\s*(\d+)\s*个/);
  const team = location.href.match(/\/team\/([^/?#]+)/i);
  return { href:location.href, teamUuid:team ? team[1] : null, visiblePageTotal:total ? Number(total[1]) : null, title:document.title };
}

async function waitForInventoryPageReady(expectedTeamUuid, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = String(document.body?.innerText || "");
    const total = text.match(/共\s*(\d+)\s*个/);
    const team = location.href.match(/\/team\/([^/?#]+)/i);
    if (team?.[1] === expectedTeamUuid && total) {
      return { ok:true, href:location.href, visiblePageTotal:Number(total[1]), title:document.title };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const team = location.href.match(/\/team\/([^/?#]+)/i);
  return { ok:false, href:location.href, teamUuid:team ? team[1] : null, title:document.title };
}

async function relayReadExternalTicketInventory(scope) {
  const TEAM_UUID = String(scope?.teamUuid || "");
  const PROJECT_UUID = String(scope?.projectUuid || "");
  const ISSUE_TYPE_UUID = String(scope?.issueTypeUuid || "");
  const ASSIGNEE_DEPARTMENT_UUID = String(scope?.assigneeDepartmentUuid || "");
  const PAGE_SIZE = 50;
  const MAX_PAGES = 20;
  const ORIGIN = location.origin;

  const teamMatch = location.href.match(/\/team\/([^/?#]+)/i);
  const teamUuid = teamMatch ? teamMatch[1] : null;
  if (teamUuid !== TEAM_UUID) {
    return { ok:false, status:"TEAM_SCOPE_GUARD_FAILED", teamUuid, expectedTeamUuid:TEAM_UUID, readOnly:true };
  }

  const jsonFetch = async (url, init = {}) => {
    const response = await fetch(url, { credentials:"same-origin", ...init });
    const text = await response.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (_) {} }
    return { response, text, json };
  };

  const buildAllTree = () => {
    const root = { uuids:["__ALL__"] };
    let cursor = root;
    for (let i = 1; i < 10; i += 1) {
      const child = { uuids:["__ALL__"] };
      cursor.children = [child];
      cursor = child;
    }
    return root;
  };

  const hierarchy = {
    lock_query:
      "uid(field006) IN ( uid('" + PROJECT_UUID + "') ) AND " +
      "uid(field007) IN ( uid('" + ISSUE_TYPE_UUID + "') )",
    perspective:false,
    flat:false,
    path:{ upstream_field:"field014", downstream_field:"field114" },
    config:{ field:"field007", tree:buildAllTree() }
  };

  const escapeCursor = (value) => String(value || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
  const buildQuery = (cursor) =>
    "select uid(uuid,field007.uuid,field006.uuid,field005.uuid," +
    "field073 as frozen_fields,field072.uuid,field072.can_view," +
    "field072.current_approver,field072.scene,field072.approval_sub_status," +
    "field903,field001,field007.name,field007.icon,field007.icon_uuid," +
    "toDate(field013),field017,field065.value,field066.value," +
    "field005.name,field005.category,field007.detail_type," +
    "field004.uuid,field004.name,field004.email,field004.avatar," +
    "field009,field019,field012.uuid,field012.value," +
    "field012.background_color,field012.color)," +
    "v$path as path,v$display_id_path as display_id_path," +
    "v$sub_workitem_count as downstream_task_count," +
    "v$sub_workitem_done_count as downstream_task_done_count " +
    "from issue where (( uid(field004) IN ( DepartmentOf(uid('" +
    ASSIGNEE_DEPARTMENT_UUID +
    "')) ) )) AND (v$cursor > '" + escapeCursor(cursor) + "') " +
    "order by field009 desc limit 10000, " + PAGE_SIZE;

  const extractRawItems = (data) => {
    const rawItems = [];
    const seenNodes = new Set();
    const walk = (node) => {
      if (node == null) return;
      if (Array.isArray(node)) {
        for (const value of node) walk(value);
        return;
      }
      if (typeof node !== "object" || seenNodes.has(node)) return;
      seenNodes.add(node);
      if (node.type === "item" && node.item && typeof node.item === "object") rawItems.push(node.item);
      for (const value of Object.values(node)) {
        if (value && (Array.isArray(value) || typeof value === "object")) walk(value);
      }
    };
    walk(data);
    return rawItems;
  };

  const sourceKeyFromTitle = (title) => {
    const text = String(title || "").trim();
    const m = text.match(/^[【\[]\s*([^】\]]+?)\s*[】\]]/);
    if (!m) return { raw:null, normalized:null };
    const raw = m[1].trim();
    return { raw, normalized:raw.toUpperCase().replace(/\s+/g,"") };
  };

  const isoFromMs = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    try { return new Date(n).toISOString(); } catch (_) { return null; }
  };

  const fail = (status, extra = {}) => ({
    ok:false,
    status,
    readOnly:true,
    schemaVersion:"ones.external-ticket-inventory/v1alpha1",
    ...extra
  });

  const allItems = [];
  const seenTaskUuids = new Set();
  const seenEndCursors = new Set();
  const pages = [];
  const httpStatuses = [];
  let cursor = "";
  let serverTotalCount = null;
  let terminalSeen = false;

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const query = buildQuery(cursor);
    const loaded = await jsonFetch(
      ORIGIN + "/project/api/ones-project/team/" + encodeURIComponent(teamUuid) + "/workitems/onesql",
      {
        method:"POST",
        headers:{ "content-type":"application/json; charset=UTF-8" },
        body:JSON.stringify({ query, hierarchy })
      }
    );
    httpStatuses.push(loaded.response.status);

    if (!loaded.response.ok || !loaded.json || !Array.isArray(loaded.json.data)) {
      return fail("INVENTORY_PAGE_QUERY_FAILED", {
        failedPage:pageNumber,
        httpStatus:loaded.response.status,
        responsePreview:loaded.text.slice(0,2000),
        pages
      });
    }

    const pageInfo = loaded.json.page_info;
    if (!pageInfo || typeof pageInfo !== "object") {
      return fail("INVENTORY_PAGE_INFO_MISSING", { failedPage:pageNumber, pages });
    }

    const rawItems = extractRawItems(loaded.json.data);
    const pageCount = Number(pageInfo.page_count);
    const totalCount = Number(pageInfo.total_count);
    const startPos = Number(pageInfo.start_pos);
    const endPos = Number(pageInfo.end_pos);
    const hasNextPage = pageInfo.has_next_page;
    const startCursor = pageInfo.start_cursor == null ? null : String(pageInfo.start_cursor);
    const endCursor = pageInfo.end_cursor == null ? null : String(pageInfo.end_cursor);

    if (!Number.isInteger(pageCount) || pageCount < 0 || pageCount > PAGE_SIZE ||
        !Number.isInteger(totalCount) || totalCount < 0 ||
        !Number.isInteger(startPos) || startPos < 0 ||
        !Number.isInteger(endPos) || endPos < startPos ||
        typeof hasNextPage !== "boolean") {
      return fail("INVENTORY_PAGE_INFO_INVALID", { failedPage:pageNumber, pageInfo, pages });
    }

    if (rawItems.length !== pageCount) {
      return fail("INVENTORY_PAGE_COUNT_MISMATCH", {
        failedPage:pageNumber,
        rawItemCount:rawItems.length,
        pageCount,
        pageInfo,
        pages
      });
    }

    const expectedStartPos = allItems.length;
    if (startPos !== expectedStartPos || endPos !== startPos + pageCount) {
      return fail("INVENTORY_CURSOR_POSITION_MISMATCH", {
        failedPage:pageNumber,
        expectedStartPos,
        pageInfo,
        pages
      });
    }

    if (serverTotalCount == null) serverTotalCount = totalCount;
    if (serverTotalCount !== totalCount) {
      return fail("INVENTORY_TOTAL_CHANGED_DURING_SCAN", {
        failedPage:pageNumber,
        firstTotalCount:serverTotalCount,
        currentTotalCount:totalCount,
        pages
      });
    }

    const scopedItems = rawItems.filter((item) =>
      item?.uuid &&
      (!item?.field007?.uuid || item.field007.uuid === ISSUE_TYPE_UUID) &&
      (!item?.field006?.uuid || item.field006.uuid === PROJECT_UUID)
    );
    if (scopedItems.length !== pageCount) {
      return fail("INVENTORY_SCOPE_ITEM_MISMATCH", {
        failedPage:pageNumber,
        pageCount,
        scopedItemCount:scopedItems.length,
        pages
      });
    }

    for (const item of scopedItems) {
      if (seenTaskUuids.has(item.uuid)) {
        return fail("INVENTORY_DUPLICATE_TASK_UUID", {
          failedPage:pageNumber,
          duplicateTaskUuid:item.uuid,
          pages
        });
      }
      seenTaskUuids.add(item.uuid);
      allItems.push(item);
    }

    pages.push({
      pageNumber,
      cursorIn:cursor || null,
      startCursor,
      endCursor,
      startPos,
      endPos,
      pageCount,
      totalCount,
      hasNextPage,
      httpStatus:loaded.response.status
    });

    if (!hasNextPage) {
      terminalSeen = true;
      break;
    }

    if (!endCursor || endCursor === cursor || seenEndCursors.has(endCursor) || pageCount === 0) {
      return fail("INVENTORY_CURSOR_NO_PROGRESS", {
        failedPage:pageNumber,
        cursorIn:cursor || null,
        endCursor,
        pageCount,
        pages
      });
    }
    seenEndCursors.add(endCursor);
    cursor = endCursor;
  }

  if (!terminalSeen) {
    return fail("INVENTORY_PAGE_LIMIT_REACHED", { maxPages:MAX_PAGES, pages, ticketCount:allItems.length });
  }

  const tickets = allItems.map((item) => {
    const title = item.field001 == null ? "" : String(item.field001);
    const source = sourceKeyFromTitle(title);
    const prefixPattern = /^[【\[]\s*[^】\]]+?\s*[】\]]\s*/;
    return {
      onesDisplayId:item.field903 || item.display_id_path || null,
      onesTaskUuid:item.uuid || null,
      sourceTicketNo:source.raw,
      sourceTicketKey:source.normalized,
      title,
      titleWithoutSourceTicket:title.replace(prefixPattern,"").trim(),
      assignee:item.field004 ? { uuid:item.field004.uuid || null, name:item.field004.name || null } : null,
      status:item.field005 ? {
        uuid:item.field005.uuid || null,
        name:item.field005.name || null,
        category:item.field005.category || null
      } : null,
      priority:item.field012 ? {
        uuid:item.field012.uuid || null,
        name:item.field012.value || item.field012.name || null
      } : null,
      project:item.field006 ? { uuid:item.field006.uuid || null, name:item.field006.name || null } : { uuid:PROJECT_UUID, name:null },
      createdAtMs:item.field009 ?? null,
      createdAt:isoFromMs(item.field009),
      dueDate:item.field013 ?? null
    };
  });

  const bodyText = String(document.body?.innerText || "");
  const totalMatch = bodyText.match(/共\s*(\d+)\s*个/);
  const visiblePageTotal = totalMatch ? Number(totalMatch[1]) : null;
  const ticketCount = tickets.length;
  const keyedCount = tickets.filter((x) => !!x.sourceTicketKey).length;
  const serverCountMatches = Number.isInteger(serverTotalCount) && serverTotalCount === ticketCount;
  const visibleCountMatches = visiblePageTotal != null && visiblePageTotal === ticketCount;
  const inventoryComplete = terminalSeen && serverCountMatches && visibleCountMatches;

  const baseResult = {
    schemaVersion:"ones.external-ticket-inventory/v1alpha1",
    capturedAt:new Date().toISOString(),
    readOnly:true,
    scope:{
      teamUuid,
      projectUuid:PROJECT_UUID,
      issueTypeUuid:ISSUE_TYPE_UUID,
      assigneeDepartmentUuid:ASSIGNEE_DEPARTMENT_UUID,
      peopleHardcoded:false
    },
    queryMode:"page_native_cursor_pagination_limit_10000_50",
    pageSize:PAGE_SIZE,
    pageCount:pages.length,
    pages,
    httpStatuses,
    serverTotalCount,
    visiblePageTotal,
    ticketCount,
    keyedCount,
    unkeyedCount:ticketCount - keyedCount,
    inventoryComplete,
    reconciliationAllowed:inventoryComplete,
    tickets
  };

  if (visiblePageTotal == null) {
    return { ok:true, status:"INVENTORY_VISIBLE_TOTAL_UNAVAILABLE", ...baseResult, reconciliationAllowed:false, inventoryComplete:false };
  }
  if (!serverCountMatches || !visibleCountMatches) {
    return { ok:true, status:"INVENTORY_COUNT_MISMATCH", ...baseResult, reconciliationAllowed:false, inventoryComplete:false };
  }
  return { ok:true, status:"INVENTORY_VERIFIED", ...baseResult };
}


async function relayReadTaskFields(scope, payload) {
  const TEAM_UUID = String(scope?.teamUuid || "");
  const PROJECT_UUID = String(scope?.projectUuid || "");
  const ISSUE_TYPE_UUID = String(scope?.issueTypeUuid || "");
  const ORIGIN = location.origin;
  const fieldId = String(payload?.fieldId || "").trim();
  const taskUuids = Array.isArray(payload?.onesTaskUuids) ? payload.onesTaskUuids.map((x) => String(x || "").trim()) : [];

  const teamMatch = location.href.match(/\/team\/([^/?#]+)/i);
  const teamUuid = teamMatch ? teamMatch[1] : null;
  const validId = (value) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
  if (teamUuid !== TEAM_UUID) {
    return { ok:false, status:"FIELD_READ_TEAM_SCOPE_GUARD_FAILED", readOnly:true, complete:false };
  }
  if (!validId(fieldId)) {
    return { ok:false, status:"FIELD_READ_INPUT_REJECTED", readOnly:true, complete:false, error:"fieldId invalid" };
  }
  if (!taskUuids.length || taskUuids.length > 100 || taskUuids.some((x) => !validId(x)) || new Set(taskUuids).size !== taskUuids.length) {
    return { ok:false, status:"FIELD_READ_INPUT_REJECTED", readOnly:true, complete:false, error:"onesTaskUuids invalid" };
  }

  const jsonFetch = async (url, init = {}) => {
    const response = await fetch(url, { credentials:"same-origin", ...init });
    const text = await response.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (_) {} }
    return { response, text, json };
  };
  const extractRawItems = (data) => {
    const rawItems = [];
    const seenNodes = new Set();
    const walk = (node) => {
      if (node == null) return;
      if (Array.isArray(node)) { for (const value of node) walk(value); return; }
      if (typeof node !== "object" || seenNodes.has(node)) return;
      seenNodes.add(node);
      if (node.type === "item" && node.item && typeof node.item === "object") rawItems.push(node.item);
      for (const value of Object.values(node)) {
        if (value && (Array.isArray(value) || typeof value === "object")) walk(value);
      }
    };
    walk(data);
    return rawItems;
  };
  const buildAllTree = () => {
    const root = { uuids:["__ALL__"] };
    let cursor = root;
    for (let i = 1; i < 10; i += 1) {
      const child = { uuids:["__ALL__"] };
      cursor.children = [child];
      cursor = child;
    }
    return root;
  };
  const hierarchy = {
    lock_query:
      "uid(field006) IN ( uid('" + PROJECT_UUID + "') ) AND " +
      "uid(field007) IN ( uid('" + ISSUE_TYPE_UUID + "') )",
    perspective:false,
    flat:false,
    path:{ upstream_field:"field014", downstream_field:"field114" },
    config:{ field:"field007", tree:buildAllTree() }
  };
  const normalizeSemanticText = (raw) => {
    if (raw == null) return "";
    const text = String(raw);
    const norm = (value) => String(value ?? "")
      .replace(/\u200B|\uFEFF/g, "")
      .replace(/\r\n?/g, "\n")
      .trim();

    const meta = text.match(/<meta[^>]+name=["']ones-editor-text["'][^>]+content=["']([^"']*)["']/i)
      || text.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']ones-editor-text["']/i);
    if (meta && meta[1]) {
      try {
        const bytes = Uint8Array.from(atob(meta[1]), (ch) => ch.charCodeAt(0));
        return norm(new TextDecoder().decode(bytes));
      } catch (_) {}
    }

    if (/<[a-z!][\s\S]*>/i.test(text)) {
      try {
        const doc = new DOMParser().parseFromString(text, "text/html");
        const bodyText = norm((doc.body && (doc.body.innerText || doc.body.textContent)) || "");
        if (bodyText) return bodyText;
      } catch (_) {}
    }

    return norm(text
      .replace(/<!--version:[^>]*-->/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " "));
  };

  const readValue = (raw) => {
    if (raw === null || typeof raw === "string") {
      return { ok:true, value:normalizeSemanticText(raw) };
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw) &&
        Object.prototype.hasOwnProperty.call(raw, "value") &&
        (raw.value === null || typeof raw.value === "string")) {
      return { ok:true, value:normalizeSemanticText(raw.value) };
    }
    return { ok:false, value:null };
  };

  const reads = [];
  for (const onesTaskUuid of taskUuids) {
    const query =
      "select uid(uuid,field006.uuid,field007.uuid," + fieldId + ") " +
      "from issue where uid(uuid) IN ( uid('" + onesTaskUuid + "') ) limit 0, 2";
    const loaded = await jsonFetch(
      ORIGIN + "/project/api/ones-project/team/" + encodeURIComponent(teamUuid) + "/workitems/onesql",
      {
        method:"POST",
        headers:{ "content-type":"application/json; charset=UTF-8" },
        body:JSON.stringify({ query, hierarchy })
      }
    );
    const capturedAt = new Date().toISOString();
    if (!loaded.response.ok || !loaded.json || !Array.isArray(loaded.json.data)) {
      reads.push({ onesTaskUuid, fieldId, status:"READ_FAILED", value:null, capturedAt, reason:"QUERY_FAILED" });
      continue;
    }
    const items = extractRawItems(loaded.json.data).filter((item) => item?.uuid === onesTaskUuid);
    if (items.length !== 1) {
      reads.push({ onesTaskUuid, fieldId, status:"READ_FAILED", value:null, capturedAt, reason:items.length ? "TASK_NOT_UNIQUE" : "TASK_NOT_FOUND" });
      continue;
    }
    const item = items[0];
    if ((item.field006?.uuid && item.field006.uuid !== PROJECT_UUID) ||
        (item.field007?.uuid && item.field007.uuid !== ISSUE_TYPE_UUID)) {
      reads.push({ onesTaskUuid, fieldId, status:"READ_FAILED", value:null, capturedAt, reason:"TASK_SCOPE_MISMATCH" });
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(item, fieldId)) {
      reads.push({ onesTaskUuid, fieldId, status:"READ_FAILED", value:null, capturedAt, reason:"FIELD_NOT_RETURNED" });
      continue;
    }
    const normalized = readValue(item[fieldId]);
    if (!normalized.ok) {
      reads.push({ onesTaskUuid, fieldId, status:"READ_FAILED", value:null, capturedAt, reason:"UNSUPPORTED_FIELD_VALUE_TYPE" });
      continue;
    }
    reads.push({ onesTaskUuid, fieldId, status:"READ_VERIFIED", value:normalized.value, capturedAt });
  }

  const complete = reads.length === taskUuids.length && reads.every((row) => row.status === "READ_VERIFIED");
  return {
    ok:complete,
    status:complete ? "FIELD_READ_VERIFIED" : "FIELD_READ_FAILED",
    schema:"ones.root-cause-field-read/v1alpha1",
    capturedAt:new Date().toISOString(),
    readOnly:true,
    complete,
    fieldId,
    requestedTaskCount:taskUuids.length,
    reads
  };
}

async function executeFieldReadJob(config, job) {
  const tabState = await ensureInventoryTab(config);
  if (!tabState.ok) {
    return {
      status:"FIELD_READ_FAILED",
      result:{
        ok:false,
        status:"FIELD_READ_FAILED",
        schema:"ones.root-cause-field-read/v1alpha1",
        readOnly:true,
        complete:false,
        fieldId:String(job?.payload?.fieldId || ""),
        reads:[],
        reason:tabState.status,
        error:tabState.error || null
      }
    };
  }
  try {
    const [execution] = await chrome.scripting.executeScript({
      target:{ tabId:tabState.tabId },
      world:"MAIN",
      func:relayReadTaskFields,
      args:[{
        teamUuid:config.teamUuid,
        projectUuid:config.projectUuid,
        issueTypeUuid:config.issueTypeUuid
      }, job.payload || {}]
    });
    const result = execution?.result || {
      ok:false,
      status:"FIELD_READ_FAILED",
      schema:"ones.root-cause-field-read/v1alpha1",
      readOnly:true,
      complete:false,
      reads:[],
      error:"MAIN world did not return field-read result"
    };
    return { status:result.status || "FIELD_READ_FAILED", result:{ ...result, relayJobId:job.jobId, relayExecutedAt:new Date().toISOString() } };
  } catch (error) {
    return {
      status:"FIELD_READ_FAILED",
      result:{
        ok:false,
        status:"FIELD_READ_FAILED",
        schema:"ones.root-cause-field-read/v1alpha1",
        readOnly:true,
        complete:false,
        reads:[],
        error:String(error),
        relayJobId:job.jobId
      }
    };
  }
}

async function ensureInventoryTab(config) {
  if (!config.inventoryPageUrl) return { ok:false, status:"ONES_TAB_UNAVAILABLE", error:"尚未绑定共享外网单页面" };
  const scope = validatedOnesScope(config);
  const expectedUrl = validateInventoryUrl(config.inventoryPageUrl, config);
  let tabs = await findOnesTabs(config);
  let tab = tabs.find((x) => x.url === expectedUrl) || tabs.find((x) => x.url && x.url.split("#")[0] === expectedUrl.split("#")[0] && x.url.includes("/team/" + scope.teamUuid + "/"));
  let created = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url:expectedUrl, active:false });
    created = true;
  }
  if (!tab?.id) return { ok:false, status:"ONES_TAB_UNAVAILABLE", error:"无法创建或定位 ONES 页面" };
  try {
    const [readyExec] = await chrome.scripting.executeScript({
      target:{ tabId:tab.id }, world:"MAIN", func:waitForInventoryPageReady, args:[scope.teamUuid, 30000]
    });
    const ready = readyExec?.result;
    if (!ready?.ok) {
      const href = ready?.href || tab.url || "";
      const status = href && !href.includes("/team/" + scope.teamUuid + "/") ? "ONES_LOGIN_REQUIRED" : "INVENTORY_PAGE_NOT_READY";
      return { ok:false, status, error:"外网单页面未在 30 秒内进入可读状态", tabId:tab.id, created, probe:ready || null };
    }
    return { ok:true, tabId:tab.id, created, ready };
  } catch (error) {
    return { ok:false, status:"ONES_TAB_UNAVAILABLE", error:String(error), tabId:tab.id, created };
  }
}

async function executeInventoryJob(config, job) {
  const tabState = await ensureInventoryTab(config);
  if (!tabState.ok) return { status:tabState.status, result:{ ok:false, readOnly:true, ...tabState } };
  try {
    const [execution] = await chrome.scripting.executeScript({
      target:{ tabId:tabState.tabId }, world:"MAIN", func:relayReadExternalTicketInventory, args:[{
        teamUuid:config.teamUuid,
        projectUuid:config.projectUuid,
        issueTypeUuid:config.issueTypeUuid,
        assigneeDepartmentUuid:config.assigneeDepartmentUuid
      }]
    });
    const result = execution?.result || { ok:false, status:"INVENTORY_READ_FAILED", readOnly:true, error:"MAIN world 未返回 inventory 结果" };
    return { status:result.status || "INVENTORY_READ_FAILED", result:{ ...result, relayJobId:job.jobId, relayExecutedAt:new Date().toISOString() } };
  } catch (error) {
    return { status:"INVENTORY_READ_FAILED", result:{ ok:false, readOnly:true, error:String(error), relayJobId:job.jobId } };
  }
}

async function executeClaimedJob(config, job) {
  if (job.jobType === "RELAY_PING") {
    return {
      status:"RELAY_PING_OK",
      result:{ executorId:config.executorId, extensionVersion:chrome.runtime.getManifest().version, receivedAt:new Date().toISOString(), echo:job.payload || {} }
    };
  }
  if (job.jobType === "ONES_INVENTORY_READ") return executeInventoryJob(config, job);
  if (job.jobType === "ONES_FIELD_READ") return executeFieldReadJob(config, job);
  if (job.jobType === "ONES_ROOT_CAUSE_WRITE") {
    if (!config.writeEnabled) return { status:"WRITE_GATE_DISABLED", result:{ ok:false, status:"WRITE_GATE_DISABLED", error:"production root-cause write gate is disabled" } };
    return globalThis.onesRootCauseWriteExecute(config, job);
  }
  return { status:"INPUT_REJECTED", result:{ receivedJobType:job.jobType, allowedJobTypes:relayCapabilities(config) } };
}

async function pollRelayOnce(reason = "alarm") {
  const config = await getRelayConfig();
  if (!config.enabled) return setRelayRuntime({ state:"DISABLED", reason });
  if (!config.token) return setRelayRuntime({ state:"CONFIG_REQUIRED", error:"Relay token 未配置", reason });
  let scope;
  try { scope = validatedOnesScope(config); } catch (error) {
    return setRelayRuntime({ state:"CONFIG_REQUIRED", error:String(error), reason });
  }
  const hasPermission = await chrome.permissions.contains({ origins:[scope.onesOrigin + "/*"] });
  if (!hasPermission) return setRelayRuntime({ state:"CONFIG_REQUIRED", error:"未授权已配置 ONES origin", reason });
  try {
    await relayHeartbeat(config);
    const claimed = await relayFetch(config, "/v1/extension/claim", {
      method:"POST", body:{ executorId:config.executorId, capabilities:relayCapabilities(config) }
    });
    if (claimed.response.status === 204) {
      return setRelayRuntime({ state:"CONNECTED_IDLE", error:null, lastPollReason:reason, lastPollAt:new Date().toISOString() });
    }
    if (!claimed.response.ok || !claimed.json?.ok || !claimed.json?.job) throw new Error("claim HTTP " + claimed.response.status);
    const job = claimed.json.job;
    const executed = await executeClaimedJob(config, job);
    await postRelayResult(config, job, executed.status, executed.result);
    return setRelayRuntime({
      state:executed.status,
      lastJobId:job.jobId,
      lastJobType:job.jobType,
      lastResultAt:new Date().toISOString(),
      error:executed.result?.error || null,
      lastPollReason:reason
    });
  } catch (error) {
    return setRelayRuntime({ state:"EXECUTOR_OFFLINE", error:String(error), lastPollReason:reason });
  }
}

async function ensureRelayAlarm() {
  await getRelayConfig();
  const existing = await chrome.alarms.get(RELAY_ALARM);
  if (!existing) chrome.alarms.create(RELAY_ALARM, { delayInMinutes:0.1, periodInMinutes:1 });
}

chrome.runtime.onInstalled.addListener(() => { ensureRelayAlarm().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { ensureRelayAlarm().catch(() => {}); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === RELAY_ALARM) pollRelayOnce("alarm").catch(() => {}); });
ensureRelayAlarm().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ONES_RELAY_GET_CONFIG") {
    (async () => {
      const config = await getRelayConfig();
      const runtime = await getRelayRuntime();
      sendResponse({ ok:true, config:{ baseUrl:config.baseUrl, enabled:config.enabled, writeEnabled:!!config.writeEnabled, executorId:config.executorId, tokenPresent:!!config.token, inventoryPageUrl:config.inventoryPageUrl || "", onesOrigin:config.onesOrigin || "", teamUuid:config.teamUuid || "", projectUuid:config.projectUuid || "", issueTypeUuid:config.issueTypeUuid || "", assigneeDepartmentUuid:config.assigneeDepartmentUuid || "" }, runtime, capabilities:relayCapabilities(config) });
    })().catch((error) => sendResponse({ ok:false, error:String(error) }));
    return true;
  }
  if (message?.type === "ONES_RELAY_SET_CONFIG") {
    (async () => {
      const current = await getRelayConfig();
      const baseUrl = validateRelayUrl(message.baseUrl || current.baseUrl);
      const token = typeof message.token === "string" && message.token.trim() ? message.token.trim() : current.token;
      const enabled = !!message.enabled;
      const writeEnabled = !!message.writeEnabled;
      const scope = validatedOnesScope(message);
      if (enabled && !token) throw new Error("启用 Relay 前必须配置 token");
      if (writeEnabled && !enabled) throw new Error("启用 production write gate 前必须启用 background polling");
      const next = { ...current, baseUrl, token, enabled, writeEnabled, ...scope };
      await saveRelayConfig(next);
      await ensureRelayAlarm();
      const runtime = await setRelayRuntime({ state:enabled ? "CONFIGURED" : "DISABLED", error:null });
      sendResponse({ ok:true, config:{ baseUrl, enabled, writeEnabled, executorId:next.executorId, tokenPresent:!!token, inventoryPageUrl:next.inventoryPageUrl || "", onesOrigin:next.onesOrigin, teamUuid:next.teamUuid, projectUuid:next.projectUuid, issueTypeUuid:next.issueTypeUuid, assigneeDepartmentUuid:next.assigneeDepartmentUuid }, runtime, capabilities:relayCapabilities(next) });
    })().catch((error) => sendResponse({ ok:false, error:String(error) }));
    return true;
  }
  if (message?.type === "ONES_RELAY_BIND_INVENTORY_PAGE") {
    (async () => {
      const current = await getRelayConfig();
      const url = validateInventoryUrl(message.url, current);
      if (!message.tabId) throw new Error("tabId missing");
      const [probeExec] = await chrome.scripting.executeScript({ target:{tabId:message.tabId}, world:"MAIN", func:probeInventoryPage });
      const probe = probeExec?.result;
      if (probe?.teamUuid !== current.teamUuid || !Number.isInteger(probe?.visiblePageTotal)) throw new Error("当前页不是可验证的外网单列表页");
      current.inventoryPageUrl = url;
      await saveRelayConfig(current);
      sendResponse({ ok:true, inventoryPageUrl:url, probe });
    })().catch((error) => sendResponse({ ok:false, error:String(error) }));
    return true;
  }
  if (message?.type === "ONES_RELAY_TEST") {
    (async () => {
      const config = await getRelayConfig();
      validateRelayUrl(config.baseUrl);
      if (!config.token) throw new Error("Relay token 未配置");
      const health = await relayFetch(config, "/health", { auth:false });
      if (!health.response.ok || !health.json?.ok) throw new Error("health HTTP " + health.response.status);
      const heartbeat = await relayHeartbeat(config);
      const runtime = await setRelayRuntime({ state:"RELAY_CONNECTED", error:null, lastHealthAt:new Date().toISOString() });
      sendResponse({ ok:true, health:health.json, heartbeat, runtime });
    })().catch(async (error) => {
      const runtime = await setRelayRuntime({ state:"EXECUTOR_OFFLINE", error:String(error) });
      sendResponse({ ok:false, error:String(error), runtime });
    });
    return true;
  }
  if (message?.type === "ONES_RELAY_POLL_NOW") {
    (async () => {
      const runtime = await pollRelayOnce("manual");
      sendResponse({ ok:runtime.state !== "EXECUTOR_OFFLINE", runtime });
    })().catch((error) => sendResponse({ ok:false, error:String(error) }));
    return true;
  }
});
