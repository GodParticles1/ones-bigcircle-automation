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
