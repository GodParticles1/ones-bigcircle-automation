const $ = (id) => document.getElementById(id);
const output = $("output");

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
    enabled: $("relayEnabled").checked
  };
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
  $("onesOrigin").value = c.onesOrigin || "";
  $("teamUuid").value = c.teamUuid || "";
  $("projectUuid").value = c.projectUuid || "";
  $("issueTypeUuid").value = c.issueTypeUuid || "";
  $("assigneeDepartmentUuid").value = c.assigneeDepartmentUuid || "";
  $("relayUrl").value = c.baseUrl || "http://127.0.0.1:18731";
  $("relayEnabled").checked = !!c.enabled;
  $("inventoryPage").textContent = "Inventory page: " + (c.inventoryPageUrl || "not bound");
  $("runtime").textContent = "Runtime: " + (result.runtime?.state || "unknown");
  show({ config:{...c, tokenPresent:!!c.tokenPresent}, runtime:result.runtime, capabilities:result.capabilities });
}

$("saveConfig").addEventListener("click", async () => {
  try {
    const form = currentForm();
    const origin = normalizeOrigin(form.onesOrigin);
    const granted = await chrome.permissions.request({ origins:[origin + "/*"] });
    if (!granted) throw new Error("ONES origin permission was not granted");
    const result = await chrome.runtime.sendMessage({ type:"ONES_RELAY_SET_CONFIG", ...form, onesOrigin:origin });
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
