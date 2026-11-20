// Exercise the shipped pagination function. Only the ONES fetch and browser globals are synthetic.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function main() {
  const {ids, failPage} = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).scenario;
  const origin = "https://synthetic.invalid";
  let calls = 0;
  const listener = {addListener() {}};
  const context = vm.createContext({
    importScripts() {},
    chrome: {runtime: {onInstalled: listener, onStartup: listener, onMessage: listener},
             alarms: {onAlarm: listener}},
    location: {origin, href: origin + "/team/team"},
    document: {body: {innerText: "共 " + ids.length + " 个"}},
    async fetch(url, options) {
      assert.equal(url, origin + "/project/api/ones-project/team/team/workitems/onesql");
      assert.equal(options.method, "POST");
      const {query} = JSON.parse(options.body);
      const cursor = calls ? "cursor-" + calls : "";
      assert.ok(query.includes("v$cursor > '" + cursor + "'"));
      calls++;
      if (calls === failPage) return {ok: false, status: 503, text: async () => "{}"};
      const id = ids[calls - 1];
      assert.ok(id);
      const item = {uuid: id, field004: {uuid: "user-a"}, field006: {uuid: "project"},
                    field007: {uuid: "type"}, field001: "[ABC-1] synthetic"};
      const body = {data: [{type: "item", item}], page_info: {
        page_count: 1, total_count: ids.length, start_pos: calls - 1, end_pos: calls,
        has_next_page: calls < ids.length, start_cursor: cursor, end_cursor: "cursor-" + calls
      }};
      return {ok: true, status: 200, text: async () => JSON.stringify(body)};
    }
  });
  const worker = fs.readFileSync(path.join(__dirname, "../../browser-bridge/service-worker.js"), "utf8");
  vm.runInContext(worker, context);
  const result = await context.relayReadExternalTicketInventory({
    teamUuid: "team", projectUuid: "project", issueTypeUuid: "type", assigneeDepartmentUuid: "dept"
  });
  assert.equal(calls, failPage || ids.length);
  if (failPage) {
    assert.equal(result.failedPage, failPage);
    assert.equal(result.httpStatus, 503);
  }
  console.log(JSON.stringify(result));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
