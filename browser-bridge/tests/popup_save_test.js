const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { test } = require('node:test');
const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
const draftKey = 'onesRelaySetupDraftV041';
const token = 'synthetic-test-token';
const flush = () => new Promise((resolve) => setImmediate(resolve));
const clone = (value) => value === undefined ? undefined : structuredClone(value);

// Actual service-worker message handlers + popup run against isolated Chrome API
// storage/permission fakes. No browser, Relay or production network is contacted.
function environment(options = {}) {
  const local = {};
  const session = {};
  const events = [];
  let handler;
  const noEvent = { addListener() {} };
  const background = {
    runtime: {
      onMessage: { addListener(fn) { handler = fn; } },
      onInstalled: noEvent, onStartup: noEvent
    },
    alarms: { get: async () => ({}), create() {}, onAlarm: noEvent },
    storage: { local: {
      get: async (key) => ({ [key]: clone(local[key]) }),
      set: async (obj) => {
        if (obj.onesRelayConfig?.onesOrigin && options.failPersistence) throw new Error('synthetic storage failure');
        Object.assign(local, clone(obj));
        if (obj.onesRelayConfig?.onesOrigin) events.push('CONFIG_PERSISTED');
      }
    } }
  };
  vm.runInNewContext(workerSource, {
    chrome: background, crypto: webcrypto, URL, console, importScripts() {},
    fetch: () => { throw new Error('Unexpected network request'); }
  }, { filename: 'service-worker.js' });
  const sendMessage = (message) => {
    events.push(message.type);
    return new Promise((resolve) => {
      const handled = handler(clone(message), {}, (response) => resolve(clone(response)));
      assert.equal(handled, true);
    });
  };
  function popup(permission = () => true) {
    const elements = Object.fromEntries([...popupHtml.matchAll(/id="([^"]+)"/g)].map((m) => [m[1], {
      value: '', checked: false, disabled: false, textContent: '', listeners: {},
      addEventListener(event, fn) { this.listeners[event] = fn; }
    }]));
    const chrome = {
      runtime: { sendMessage },
      storage: { session: {
        get: async (key) => ({ [key]: clone(session[key]) }),
        set: async (obj) => { if (options.beforeDraftSet) await options.beforeDraftSet(); Object.assign(session, clone(obj)); events.push('DRAFT_SET'); },
        remove: async (key) => { delete session[key]; events.push('DRAFT_CLEARED'); }
      } },
      permissions: { request: async (request) => { events.push('PERMISSION_REQUEST'); return permission(clone(request)); } },
      tabs: { query: async () => [] }
    };
    vm.runInNewContext(popupSource, { chrome, URL, document: { getElementById: (id) => elements[id] } }, { filename: 'popup.js' });
    return {
      elements,
      click: () => elements.saveConfig.listeners.click(),
      input: (id) => elements[id].listeners.input(),
      output: () => JSON.parse(elements.output.textContent)
    };
  }
  return { local, session, events, sendMessage, popup };
}

function fill(p, changes = {}) {
  const form = {
    onesOrigin: 'https://synthetic.invalid:8443', teamUuid: 'synthetic_team',
    projectUuid: 'synthetic_project', issueTypeUuid: 'synthetic_issue',
    assigneeDepartmentUuid: 'synthetic_department', rootCauseFieldId: 'synthetic_root',
    relayUrl: 'http://127.0.0.1:18731', relayToken: token, ...changes
  };
  for (const [id, value] of Object.entries(form)) p.elements[id].value = value;
  p.elements.relayEnabled.checked = true;
  p.elements.writeEnabled.checked = false;
}

async function ready(env, permission) {
  const p = env.popup(permission);
  await flush();
  return p;
}

function noTokenOutput(p) {
  assert.equal(p.elements.output.textContent.includes(token), false);
}

test('validated SET and durable background storage precede exact-origin permission request', async () => {
  const env = environment();
  const p = await ready(env, (request) => {
    assert.deepEqual(request, { origins: ['https://synthetic.invalid:8443/*'] });
    assert.equal(env.local.onesRelayConfig.token, token);
    assert.equal(env.session[draftKey], undefined);
    return true;
  });
  fill(p);
  p.input('relayToken');
  await flush();
  env.events.length = 0;
  await p.click();
  assert.ok(env.events.indexOf('ONES_RELAY_SET_CONFIG') < env.events.indexOf('CONFIG_PERSISTED'));
  assert.ok(env.events.indexOf('CONFIG_PERSISTED') < env.events.indexOf('PERMISSION_REQUEST'));
  assert.ok(env.events.indexOf('DRAFT_CLEARED') < env.events.indexOf('PERMISSION_REQUEST'));
  assert.equal(p.output().config.tokenPresent, true);
  assert.equal(p.elements.relayToken.value, '');
  noTokenOutput(p);
});

test('failed durable config storage prevents permission prompt and retains draft', async () => {
  const env = environment({ failPersistence: true });
  const p = await ready(env);
  fill(p);
  p.input('relayToken');
  await flush();
  await p.click();
  assert.equal(env.events.includes('PERMISSION_REQUEST'), false);
  assert.equal(p.output().configSaved, false);
  assert.ok(env.session[draftKey]);
  noTokenOutput(p);
});

test('backend config validation failure prevents optional permission request', async () => {
  for (const changes of [{ teamUuid: '' }, { relayUrl: 'http://remote.invalid:18731' }, { rootCauseFieldId: 'bad field' }, { relayToken: '' }]) {
    const env = environment();
    const p = await ready(env);
    fill(p, changes);
    await p.click();
    assert.equal(env.events.includes('PERMISSION_REQUEST'), false);
    assert.equal(p.output().configSaved, false);
  }
});

test('permission teardown cannot lose already persisted config or restore token from draft', async () => {
  const env = environment();
  const p = await ready(env, () => new Promise(() => {}));
  fill(p);
  p.input('relayToken');
  await flush();
  void p.click(); // Simulate popup teardown: permission continuation never runs.
  await flush();
  assert.equal(env.events.includes('PERMISSION_REQUEST'), true);
  const reopened = await ready(env);
  assert.equal(reopened.elements.onesOrigin.value, 'https://synthetic.invalid:8443');
  assert.equal(reopened.elements.relayToken.value, '');
  assert.equal(reopened.output().config.tokenPresent, true);
  assert.equal(reopened.output().draftPresent, false);
  assert.equal(env.local.onesRelayConfig.token, token);
  noTokenOutput(reopened);
});

test('denied permission preserves config and reopening uses the worker truth', async () => {
  const env = environment();
  const p = await ready(env, () => false);
  fill(p);
  await p.click();
  assert.equal(p.output().ok, false);
  assert.equal(p.output().configSaved, true);
  const reopened = await ready(env);
  assert.equal(reopened.output().config.tokenPresent, true);
  assert.equal(reopened.elements.projectUuid.value, 'synthetic_project');
  assert.equal(reopened.elements.relayToken.value, '');
});

test('cancelled/rejected permission does not roll back persisted config', async () => {
  const env = environment();
  const p = await ready(env, () => { throw new Error('synthetic prompt cancelled'); });
  fill(p);
  await p.click();
  assert.equal(p.output().configSaved, true);
  assert.equal(env.local.onesRelayConfig.token, token);
  assert.equal((await ready(env)).output().config.tokenPresent, true);
});

test('stale pre-save draft cannot override newly persisted worker configuration', async () => {
  const env = environment();
  const p = await ready(env);
  fill(p);
  p.input('relayToken');
  await flush();
  const stale = clone(env.session[draftKey]);
  await p.click();
  stale.form.onesOrigin = 'https://stale.invalid';
  stale.form.token = 'synthetic-stale-token';
  env.session[draftKey] = stale;
  const reopened = await ready(env);
  assert.equal(reopened.elements.onesOrigin.value, 'https://synthetic.invalid:8443');
  assert.equal(reopened.elements.relayToken.value, '');
  assert.equal(reopened.output().draftPresent, false);
});

test('new unsaved edits against unchanged saved config remain a session draft', async () => {
  const env = environment();
  const p = await ready(env, () => false);
  fill(p);
  await p.click();
  p.elements.projectUuid.value = 'unsaved_project';
  p.input('projectUuid');
  await flush();
  const reopened = await ready(env);
  assert.equal(reopened.elements.projectUuid.value, 'unsaved_project');
  assert.equal(reopened.output().config.projectUuid, 'synthetic_project');
  assert.equal(reopened.output().draftPresent, true);
  assert.equal(env.local.onesRelayConfig.projectUuid, 'synthetic_project');
});

test('legacy draft may restore first-time setup but cannot override persisted config', async () => {
  const env = environment();
  env.session[draftKey] = { onesOrigin: 'https://legacy.invalid', token: 'synthetic-legacy-token' };
  const first = await ready(env);
  assert.equal(first.elements.onesOrigin.value, 'https://legacy.invalid');
  fill(first);
  await first.click();
  env.session[draftKey] = { onesOrigin: 'https://stale.invalid', token: 'synthetic-stale-token' };
  const reopened = await ready(env);
  assert.equal(reopened.elements.onesOrigin.value, 'https://synthetic.invalid:8443');
  assert.equal(reopened.elements.relayToken.value, '');
});

test('exact origin rejection occurs before SET and permission request', async () => {
  for (const origin of ['http://synthetic.invalid', 'https://u:p@synthetic.invalid', 'https://synthetic.invalid/path', 'https://synthetic.invalid/?q=x', 'https://synthetic.invalid/#x', 'not a URL']) {
    const env = environment();
    const p = await ready(env);
    fill(p, { onesOrigin: origin });
    env.events.length = 0;
    await p.click();
    assert.equal(env.events.includes('ONES_RELAY_SET_CONFIG'), false);
    assert.equal(env.events.includes('PERMISSION_REQUEST'), false);
  }
});

test('outstanding draft writes drain before permission and cannot reappear after clear', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const env = environment({ beforeDraftSet: () => blocked });
  const p = await ready(env);
  fill(p);
  p.input('relayToken');
  await flush();
  const saving = p.click();
  await flush();
  assert.equal(env.events.includes('CONFIG_PERSISTED'), true);
  assert.equal(env.events.includes('PERMISSION_REQUEST'), false);
  release();
  await saving;
  assert.equal(env.session[draftKey], undefined);
  assert.equal(env.events.filter((event) => event === 'PERMISSION_REQUEST').length, 1);
});

test('double click does not dispatch duplicate config or permission operations', async () => {
  let finish;
  const env = environment();
  const p = await ready(env, () => new Promise((resolve) => { finish = resolve; }));
  fill(p);
  const saving = p.click();
  await flush();
  assert.equal(p.elements.saveConfig.disabled, true);
  await p.click();
  assert.equal(env.events.filter((event) => event === 'ONES_RELAY_SET_CONFIG').length, 1);
  assert.equal(env.events.filter((event) => event === 'PERMISSION_REQUEST').length, 1);
  finish(true);
  await saving;
  assert.equal(p.elements.saveConfig.disabled, false);
});
