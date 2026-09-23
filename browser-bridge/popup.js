const $ = (id) => document.getElementById(id);
const output = $("output");
const DRAFT_KEY = "onesRelaySetupDraftV041";
const DRAFT_INPUT_IDS = [
  "onesOrigin",
  "teamUuid",
  "projectUuid",
  "issueTypeUuid",
  "assigneeDepartmentUuid",
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

async function persistDraft() {
  await chrome.storage.session.set({ [DRAFT_KEY]: currentForm() });
}

async function clearDraft() {
  await chrome.storage.session.remove(DRAFT_KEY);
}

function normalizeOrigin(raw) {
  const url = new URL(String(raw || ""));
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("ONES origin must be https scheme + host + optional port only");
  }
  return url.origin;
}

async function load() {
  const result = await chrome.runtime.sendMessage({ type:"ONES_RELAY_GET_CONFIG" });
  if (!result?.ok) return show(result);
  const c = result.config || {};
  const draft = await getDraft();
  applyForm({
    onesOrigin:c.onesOrigin || "",
    teamUuid:c.teamUuid || "",
    projectUuid:c.projectUuid || "",
    issueTypeUuid:c.issueTypeUuid || "",
    assigneeDepartmentUuid:c.assigneeDepartmentUuid || "",
    baseUrl:c.baseUrl || "http://127.0.0.1:18731",
    token:"",
    enabled:!!c.enabled,
    writeEnabled:!!c.writeEnabled,
    ...(draft || {})
  });
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
  try {
    const form = currentForm();
    const origin = normalizeOrigin(form.onesOrigin);
    const granted = await chrome.permissions.request({ origins:[origin + "/*"] });
    if (!granted) throw new Error("ONES origin permission was not granted");
    const result = await chrome.runtime.sendMessage({ type:"ONES_RELAY_SET_CONFIG", ...form, onesOrigin:origin });
    if (!result?.ok) throw new Error(result?.error || "Failed to save Browser Bridge configuration");
    await clearDraft();
    show(result);
    await load();
  } catch (error) { show({ ok:false, error:String(error) }); }
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
