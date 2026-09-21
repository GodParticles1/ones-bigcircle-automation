const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");

class FakeElement {
  constructor() {
    this.value = "";
    this.checked = false;
    this.textContent = "";
    this.listeners = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  async dispatch(type) {
    for (const fn of this.listeners[type] || []) await fn({ type, target:this });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function makePopup(sessionStore, committedConfig = {}) {
  const ids = [
    "output", "onesOrigin", "teamUuid", "projectUuid", "issueTypeUuid",
    "assigneeDepartmentUuid", "relayUrl", "relayToken", "relayEnabled",
    "inventoryPage", "runtime", "saveConfig", "bindInventory", "testRelay", "pollNow"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  const localConfig = {
    baseUrl:"http://127.0.0.1:18731",
    enabled:false,
    executorId:"ones-chrome-test",
    tokenPresent:false,
    inventoryPageUrl:"",
    onesOrigin:"",
    teamUuid:"",
    projectUuid:"",
    issueTypeUuid:"",
    assigneeDepartmentUuid:"",
    ...committedConfig
  };
  const chrome = {
    storage:{
      session:{
        async get(key) { return { [key]: sessionStore[key] }; },
        async set(obj) { Object.assign(sessionStore, obj); },
        async remove(key) { delete sessionStore[key]; }
      }
    },
    runtime:{
      async sendMessage(message) {
        if (message.type === "ONES_RELAY_GET_CONFIG") {
          return {
            ok:true,
            config:{...localConfig},
            runtime:{state:"DISABLED"},
            capabilities:["RELAY_PING","ONES_INVENTORY_READ"]
          };
        }
        if (message.type === "ONES_RELAY_SET_CONFIG") {
          Object.assign(localConfig, {
            baseUrl:message.baseUrl,
            enabled:message.enabled,
            tokenPresent:!!message.token || localConfig.tokenPresent,
            onesOrigin:message.onesOrigin,
            teamUuid:message.teamUuid,
            projectUuid:message.projectUuid,
            issueTypeUuid:message.issueTypeUuid,
            assigneeDepartmentUuid:message.assigneeDepartmentUuid
          });
          return {
            ok:true,
            config:{...localConfig},
            runtime:{state:"CONFIGURED"},
            capabilities:["RELAY_PING","ONES_INVENTORY_READ"]
          };
        }
        return {ok:true};
      }
    },
    permissions:{ async request() { return true; } },
    tabs:{ async query() { return [{id:1,url:"https://example.invalid/team/test/"}]; } }
  };
  const context = vm.createContext({
    chrome,
    URL,
    console,
    document:{ getElementById:(id) => elements[id] },
    setTimeout,
    clearTimeout
  });
  vm.runInContext(source, context, {filename:"popup.js"});
  return {elements, localConfig};
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

(async () => {
  const session = {};

  const first = makePopup(session);
  await tick();
  first.elements.onesOrigin.value = "https://ones.example.internal:8443";
  await first.elements.onesOrigin.dispatch("input");
  first.elements.projectUuid.value = "PROJECT_TEST";
  await first.elements.projectUuid.dispatch("input");
  first.elements.relayToken.value = "super-secret-token";
  await first.elements.relayToken.dispatch("input");

  assert(session.onesRelaySetupDraftV041, "draft should be written to session storage");

  const second = makePopup(session);
  await tick();

  assert.equal(second.elements.onesOrigin.value, "https://ones.example.internal:8443");
  assert.equal(second.elements.projectUuid.value, "PROJECT_TEST");
  assert.equal(second.elements.relayToken.value, "super-secret-token");
  assert(
    !second.elements.output.textContent.includes("super-secret-token"),
    "token must not be rendered in status JSON"
  );

  second.elements.teamUuid.value = "TEAM_TEST";
  await second.elements.teamUuid.dispatch("input");
  second.elements.issueTypeUuid.value = "ISSUE_TEST";
  await second.elements.issueTypeUuid.dispatch("input");
  second.elements.assigneeDepartmentUuid.value = "DEPT_TEST";
  await second.elements.assigneeDepartmentUuid.dispatch("input");
  second.elements.relayUrl.value = "http://127.0.0.1:18731";
  await second.elements.relayUrl.dispatch("input");
  await second.elements.saveConfig.dispatch("click");
  await tick();

  assert(!session.onesRelaySetupDraftV041, "successful save must clear transient draft");
  assert.equal(second.localConfig.tokenPresent, true);

  const third = makePopup(session, {
    onesOrigin:"https://committed.example.internal:8443",
    teamUuid:"COMMITTED_TEAM",
    projectUuid:"COMMITTED_PROJECT",
    issueTypeUuid:"COMMITTED_ISSUE",
    assigneeDepartmentUuid:"COMMITTED_DEPT",
    tokenPresent:true
  });
  await tick();

  assert.equal(third.elements.onesOrigin.value, "https://committed.example.internal:8443");
  assert.equal(third.elements.teamUuid.value, "COMMITTED_TEAM");
  assert.equal(third.elements.relayToken.value, "", "committed token must not be rehydrated into the DOM");
  assert(third.elements.output.textContent.includes('"tokenPresent": true'));

  console.log("BROWSER_BRIDGE_V041_DRAFT_TEST_PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
