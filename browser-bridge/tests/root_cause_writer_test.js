const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'root-cause-writer.js'), 'utf8');
const fieldId = 'synthetic_root_cause';
const taskUuid = 'synthetic_task';
const displayId = 'SYN-101';
const desired = 'Synthetic confirmed cause';
const blockSelector = '.text-block[data-type="editor-block"][data-block-type="text"]';

// A deterministic synthetic DOM boundary, not a live ONES acceptance.
// Selectors are evaluated against a tree, rather than returning canned selector results.
class Element {
  constructor(id = '', options = {}) {
    this.id = id;
    this.options = options;
    this.tagName = (options.tag || 'div').toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.disabled = !!options.disabled;
    this.classList = { contains: (name) => (options.classes || []).includes(name) || (name === 'focused' && !!options.focused) };
    for (const child of [...(options.children || []), ...(options.blocks || []), ...(options.saves || [])]) this.append(child);
  }
  append(child) { child.parentElement = this; this.children.push(child); }
  get innerText() { return (this.options.text || '') + this.children.map((el) => el.innerText).join(''); }
  get textContent() { return this.innerText; }
  get isConnected() { return this.tagName === 'BODY' || !!this.parentElement?.isConnected; }
  getBoundingClientRect() {
    return { left: this.options.save ? 300 : 10, top: 10, right: 210, width: this.options.hidden ? 0 : 200, height: 30 };
  }
  getAttribute(name) { return name === 'id' ? this.id : (this.options.attrs || {})[name] ?? null; }
  matches(selector) {
    return selector.split(',').some((part) => {
      if (part === '*') return true;
      const tag = part.match(/^[a-z][a-z0-9]*/i)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      for (const match of part.matchAll(/\.([a-zA-Z0-9_-]+)/g)) if (!this.classList.contains(match[1])) return false;
      for (const match of part.matchAll(/\[([a-z-]+)(?:=["']?([^"'\]]+)["']?)?\]/g)) {
        const actual = this.getAttribute(match[1]);
        if (match[2] === undefined ? actual === null : actual !== match[2]) return false;
      }
      return true;
    });
  }
  contains(el) { return el === this || this.children.some((child) => child.contains(el)); }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  click() { this.options.onClick?.(); }
}

function harness(options = {}) {
  const log = [];
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  let pumpScheduled = false;
  const pump = () => {
    if (pumpScheduled) return;
    pumpScheduled = true;
    setImmediate(() => {
      pumpScheduled = false;
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) return;
      timers.delete(next[0]);
      now = Math.max(now, next[1].at);
      next[1].fn();
      pump();
    });
  };
  const block = new Element('synthetic_text_block', { focused: true, classes: ['text-block'], attrs: { 'data-type': 'editor-block', 'data-block-type': 'text' } });
  const save = new Element('synthetic_save', { tag: 'button', text: '\u4fdd\u5b58', save: true });
  const root = new Element(options.wrongEditorId ? 'other_field' : fieldId, {
    classes: ['standard-co-editor-editing', 'task-rich-text-edit'],
    blocks: options.blocks || [block], saves: options.saves || [save]
  });
  const body = new Element('', { tag: 'body' });
  let container;
  if (options.display) {
    const labelLeaf = new Element('', { tag: 'span', text: options.bracketLabel ? '【问题根因】' : '问题根因' });
    const labelLeaves = options.duplicateLabelLeaf
      ? [labelLeaf, new Element('', { tag: 'span', text: options.bracketLabel ? '【问题根因】' : '问题根因' })]
      : [labelLeaf];
    const formLabel = new Element('', {
      classes: ['form-field-label', 'edit_form_field_label'],
      children: labelLeaves
    });
    const viewer = new Element('', {
      classes: ['standard-co-viewer'],
      text: options.viewerText || '',
      onClick: () => {
        log.push('open');
        if (options.throwOpen) throw new Error('synthetic click failure');
        if (options.driftDuringOpen) location.href = href.replace(displayId, 'SYN-102');
        if (!options.noTransition) {
          if (options.replaceContainer) {
            container.parentElement = null;
            body.append(root);
          } else {
            (options.editorOutside ? body : container).append(root);
          }
          if (options.duplicateOpenedRoot) body.append(new Element(fieldId, { classes: ['standard-co-editor-editing', 'task-rich-text-edit'] }));
          if (options.hiddenDuplicateRoot) body.append(new Element(fieldId, { hidden: true }));
        }
      }
    });
    const fieldChildren = [
      ...(options.missingLabel ? [] : [formLabel]),
      ...(options.missingViewer ? [new Element('', { text: '只读内容' })] : [viewer])
    ];
    if (options.duplicateViewer) fieldChildren.push(new Element('', { classes: ['standard-co-viewer'] }));
    container = options.missingContainer
      ? null
      : new Element('', { classes: ['oac-flex', 'oac-py-1', 'oac-items-start', 'oac-flex-col'], children: fieldChildren });
    if (options.missingContainer) {
      fieldChildren.forEach((child) => body.append(child));
    } else {
      body.append(container);
    }
    if (options.duplicateFormLabel) {
      const duplicateLabel = new Element('', {
        classes: ['form-field-label', 'edit_form_field_label'],
        children: [new Element('', { tag: 'span', text: '问题根因' })]
      });
      const duplicateWrap = new Element('', {
        classes: ['oac-flex', 'oac-py-1', 'oac-items-start', 'oac-flex-col'],
        children: [duplicateLabel, new Element('', { classes: ['standard-co-viewer'] })]
      });
      body.append(duplicateWrap);
    }
    if (options.historyLabel) {
      body.append(new Element('', {
        classes: ['message-v2-log-item-content'],
        children: [new Element('', { tag: 'span', text: '问题根因' })]
      }));
    }
  } else {
    (options.roots || [root]).forEach((el) => body.append(el));
  }
  let valueReads = 0;
  const href = 'https://synthetic.invalid/#/team/synthetic_team/issue/' + displayId;
  const location = { origin: 'https://synthetic.invalid', href };
  const context = vm.createContext({
    Element, TextEncoder, TextDecoder, crypto: webcrypto, URL, location, AbortController,
    performance: { now: () => now },
    setTimeout: (fn, delay = 0) => {
      const id = ++nextTimer;
      timers.set(id, { at: now + delay, fn });
      pump();
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    getComputedStyle: (el) => {
      let owner = el;
      while (owner && !owner.options.textAlign) owner = owner.parentElement;
      return { display: el.options.display || (el.tagName === 'SPAN' ? 'inline' : 'block'), visibility: 'visible', opacity: '1', cursor: el.options.cursor || 'auto', textAlign: owner?.options.textAlign || 'left' };
    },
    document: {
      body, documentElement: new Element('', { tag: 'html' }),
      getElementById: (id) => body.querySelectorAll('[id="' + id + '"]')[0] || null,
      querySelectorAll: (selector) => body.querySelectorAll(selector)
    },
    fetch: async (url, init) => {
      log.push(url.endsWith('/onesql') ? 'read' : url.endsWith('/identifier') ? 'identity' : 'events');
      let responseBody;
      if (url.endsWith('/identifier')) {
        responseBody = { display_id: displayId, task_uuid: options.wrongTask ? 'other_task' : taskUuid };
      } else if (url.endsWith('/onesql')) {
        assert.match(JSON.parse(init.body).query, /synthetic_root_cause/);
        const values = options.values || ['', ''];
        responseBody = { data: [{ item: { uuid: taskUuid, [fieldId]: values[valueReads++] } }] };
        if (options.driftDuringRead && valueReads === 2) location.href = href.replace(displayId, 'SYN-102');
      } else if (url.endsWith('/messages')) {
        responseBody = { messages: [] };
      } else throw new Error('Unexpected request: ' + url);
      return { ok: true, status: 200, text: async () => JSON.stringify(responseBody) };
    }
  });
  vm.runInContext(source, context);
  return { context, log, root, block, save, location, container, timers };
}

async function preflight(options = {}) {
  const h = harness(options);
  const result = await h.context.rcPagePreflightWrite({ fieldId, taskUuid, displayId, desiredValue: desired });
  return { ...h, result };
}

test('already-open native editor preserves fresh double pre-read and readiness', async () => {
  const { result, log } = await preflight();
  assert.equal(result.status, 'PREWRITE_READY');
  assert.equal(result.textBlockId, 'synthetic_text_block');
  assert.deepEqual(log, ['identity', 'read', 'events', 'read']);
});

test('equal value is NOOP before requiring editor', async () => {
  assert.equal((await preflight({ values: [desired, desired], roots: [] })).result.status, 'NOOP_VERIFIED');
});

test('different nonempty value conflicts before requiring editor', async () => {
  assert.equal((await preflight({ values: ['other', 'other'], roots: [] })).result.status, 'CONFLICT_REVIEW');
});

test('fresh reads changing abort before requiring editor', async () => {
  assert.equal((await preflight({ values: ['', 'changed'], roots: [] })).result.status, 'CONCURRENT_CHANGE_ABORT');
});

test('wrong resolved task aborts before any field read', async () => {
  const { result, log } = await preflight({ wrongTask: true });
  assert.equal(result.status, 'TARGET_RESOLVE_FAILED');
  assert.deepEqual(log, ['identity']);
});

test('duplicate Save controls block', async () => {
  const saves = [new Element('save1', { tag: 'button', text: '\u4fdd\u5b58' }), new Element('save2', { tag: 'button', text: '\u4fdd\u5b58' })];
  assert.equal((await preflight({ saves })).result.status, 'SAVE_CONTROL_NOT_UNIQUE');
});

test('missing or ambiguous active text block blocks', async () => {
  for (const blocks of [[], [new Element('a'), new Element('b')]]) {
    assert.equal((await preflight({ blocks })).result.status, 'EDITOR_ACTIVE_BLOCK_NOT_UNIQUE');
  }
});

function acceptedJob(overrides = {}) {
  return { payload: {
    taskTargetPolicy: 'UNIQUE_ONES_TASK_ONLY', decision: 'SET_CANDIDATE', writeMode: 'fill_empty_only',
    planSha256: 'a'.repeat(64), desiredSha256: createHash('sha256').update(desired).digest('hex'),
    taskUuid, displayId, fieldId, desiredValue: desired, ...overrides
  } };
}

test('executor rejects incorrect provenance, policy, hash and configured field before browser access', async () => {
  for (const overrides of [
    { decision: 'NOOP' }, { writeMode: 'overwrite' }, { taskTargetPolicy: 'ANY_TASK' },
    { planSha256: 'invalid' }, { desiredSha256: '0'.repeat(64) }, { fieldId: 'other_field' }
  ]) {
    const { context, log } = harness();
    const result = await context.onesRootCauseWriteExecute({ rootCauseFieldId: fieldId }, acceptedJob(overrides));
    assert.equal(result.status, 'WRITE_INPUT_REJECTED');
    assert.deepEqual(log, []);
  }
});


test('target drift during the fresh reads blocks editor access', async () => {
  assert.equal((await preflight({ driftDuringRead: true })).result.status, 'TARGET_GUARD_FAILED');
});

test('duplicate editor IDs fail closed, even when one is hidden', async () => {
  const roots = [new Element(fieldId), new Element(fieldId, { hidden: true })];
  assert.equal((await preflight({ roots })).result.status, 'EDITOR_ROOT_NOT_UNIQUE');
});


for (const bracketLabel of [false, true]) {
  test('canonical detail-form label opens unique viewer and binds exact native field ID: bracket=' + bracketLabel, async () => {
    const { result, log } = await preflight({ display: true, bracketLabel, duplicateLabelLeaf: true, historyLabel: true });
    assert.equal(result.status, 'PREWRITE_READY');
    assert.equal(result.editorOpened, true);
    assert.deepEqual(log, ['identity', 'read', 'events', 'read', 'open']);
  });
}

test('duplicate semantic leaves inside one canonical form label de-duplicate cleanly', async () => {
  const { result, log } = await preflight({ display: true, duplicateLabelLeaf: true });
  assert.equal(result.status, 'PREWRITE_READY');
  assert.equal(log.filter((event) => event === 'open').length, 1);
});

test('activity/history root-cause text outside the detail form does not create ambiguity', async () => {
  const { result, log } = await preflight({ display: true, historyLabel: true });
  assert.equal(result.status, 'PREWRITE_READY');
  assert.equal(log.filter((event) => event === 'open').length, 1);
});

test('framework may replace the old field wrapper when exact configured editor root rebinds', async () => {
  const { result, log } = await preflight({ display: true, replaceContainer: true });
  assert.equal(result.status, 'PREWRITE_READY');
  assert.equal(result.editorOpened, true);
  assert.equal(log.filter((event) => event === 'open').length, 1);
});

const blockedTransitions = [
  ['missingLabel', 'ROOT_CAUSE_LABEL_NOT_UNIQUE', 0],
  ['duplicateFormLabel', 'ROOT_CAUSE_LABEL_NOT_UNIQUE', 0],
  ['missingContainer', 'ROOT_CAUSE_CONTAINER_NOT_UNIQUE', 0],
  ['missingViewer', 'ROOT_CAUSE_VIEWER_NOT_UNIQUE', 0],
  ['duplicateViewer', 'ROOT_CAUSE_VIEWER_NOT_UNIQUE', 0],
  ['noTransition', 'EDITOR_ROOT_NOT_UNIQUE', 1],
  ['wrongEditorId', 'EDITOR_FIELD_ID_MISMATCH', 1],
  ['duplicateOpenedRoot', 'EDITOR_ROOT_NOT_UNIQUE', 1],
  ['hiddenDuplicateRoot', 'EDITOR_ROOT_NOT_UNIQUE', 1],
  ['driftDuringOpen', 'TARGET_GUARD_FAILED', 1],
  ['throwOpen', 'EDITOR_OPEN_FAILED', 1]
];
for (const [option, status, clicks] of blockedTransitions) {
  test('fail closed without repeated viewer clicks: ' + option, async () => {
    const { result, log } = await preflight({ display: true, [option]: true });
    assert.equal(result.ok, false);
    assert.equal(result.status, status);
    assert.equal(log.filter((event) => event === 'open').length, clicks);
  });
}

function wireExecutor(h, verify, render) {
  let verifyAttempts = 0;
  let renderAttempts = 0;
  h.context.chrome = {
    tabs: { query: async () => [{ id: 42, url: h.location.href }] },
    scripting: { executeScript: async ({ func, args }) => {
      let result;
      if (func.name === 'rcPagePreflightWrite') {
        result = await func(...args);
        h.log.push('preflight:' + result.status);
      } else if (func.name === 'rcPageInspectSelection') result = { ok: true, anchorInside: true, focusInside: true, selectedText: '' };
      else if (func.name === 'rcPageNormalizeDraftAlignment') result = { ok: true, status: 'DRAFT_LEFT_ALIGN_VERIFIED' };
      else if (func.name === 'rcPageInspectDraft') result = { ok: true, status: 'DRAFT_DOM_VERIFIED', savePoint: { x: 400, y: 25 } };
      else if (func.name === 'rcPageVerifyWrite') {
        verifyAttempts += 1;
        h.log.push('verify:' + verifyAttempts);
        result = verify ? await verify(verifyAttempts, args[0]) : { ok: true, status: 'WRITE_VERIFIED' };
      }
      else if (func.name === 'rcPageVerifyRenderedAlignment') {
        renderAttempts += 1;
        h.log.push('render:' + renderAttempts);
        if (render) result = await render(renderAttempts, args);
        else {
          setRendered(h);
          result = func(...args);
        }
      }
      else throw new Error('Unexpected page function: ' + func.name);
      return [{ result }];
    } },
    debugger: {
      attach: async () => { h.log.push('attach'); }, detach: async () => {},
      sendCommand: async (_, method, params) => { h.log.push({ method, ...params }); }
    }
  };
}
const config = { rootCauseFieldId: fieldId, onesOrigin: 'https://synthetic.invalid' };

test('all failed post-open bindings block executor before text input or Save', async () => {
  for (const [option, status] of blockedTransitions) {
    const h = harness({ display: true, [option]: true });
    wireExecutor(h);
    const result = await h.context.onesRootCauseWriteExecute(config, acceptedJob());
    assert.equal(result.status, 'WRITE_BLOCKED', option);
    assert.equal(result.result.blockedBy, status, option);
    assert.equal(h.log.some((e) => typeof e === 'object' || e === 'attach'), false, option);
  }
});

for (const display of [false, true]) {
  test('executor inputs only after binding and dispatches exactly one Save: display=' + display, async () => {
    const h = harness({ display });
    wireExecutor(h);
    const result = await h.context.onesRootCauseWriteExecute(config, acceptedJob());
    assert.equal(result.status, 'WRITE_VERIFIED');
    const input = h.log.findIndex((e) => e.method === 'Input.insertText');
    assert.ok(input > h.log.indexOf('preflight:PREWRITE_READY'));
    assert.equal(h.log.filter((e) => e.method === 'Input.insertText').length, 1);
    assert.equal(h.log.filter((e) => e.type === 'mouseReleased' && e.x === 400).length, 1);
    assert.equal(h.log.filter((e) => e === 'open').length, display ? 1 : 0);
  });
}


test('opened editor still requires a unique Save before any native input', async () => {
  const h = harness({ display: true, saves: [
    new Element('save1', { tag: 'button', text: '保存' }),
    new Element('save2', { tag: 'button', text: '保存' })
  ] });
  wireExecutor(h);
  const result = await h.context.onesRootCauseWriteExecute(config, acceptedJob());
  assert.equal(result.result.blockedBy, 'SAVE_CONTROL_NOT_UNIQUE');
  assert.equal(h.log.includes('attach'), false);
});

test('display-mode equal/conflict/concurrent values do not open an editor', async () => {
  for (const values of [[desired, desired], ['other', 'other'], ['', 'changed']]) {
    const h = await preflight({ display: true, values });
    assert.equal(h.log.includes('open'), false);
  }
});

test('a missing local viewer never falls back to a button in a sibling field', async () => {
  const h = harness({ display: true, missingViewer: true });
  h.container.parentElement.append(new Element('', { tag: 'button', text: '编辑另一个字段', onClick: () => { throw new Error('wrong field clicked'); } }));
  const result = await h.context.rcPagePreflightWrite({ fieldId, taskUuid, displayId, desiredValue: desired });
  assert.equal(result.status, 'ROOT_CAUSE_VIEWER_NOT_UNIQUE');
  assert.equal(h.log.includes('open'), false);
});

test('sibling Save controls do not replace the exact field viewer', async () => {
  const h = harness({ display: true });
  h.container.parentElement.append(new Element('', { tag: 'button', text: '保存', onClick: () => { throw new Error('sibling Save clicked'); } }));
  const result = await h.context.rcPagePreflightWrite({ fieldId, taskUuid, displayId, desiredValue: desired });
  assert.equal(result.status, 'PREWRITE_READY');
  assert.equal(h.log.filter((e) => e === 'open').length, 1);
});

test('nested interactive descendants do not widen the exact viewer locator', async () => {
  const h = harness({ display: true });
  h.container.children[1].append(new Element('', { tag: 'span', attrs: { role: 'button' }, text: '嵌套入口', onClick: () => { throw new Error('nested control clicked'); } }));
  const result = await h.context.rcPagePreflightWrite({ fieldId, taskUuid, displayId, desiredValue: desired });
  assert.equal(result.status, 'PREWRITE_READY');
  assert.equal(h.log.filter((e) => e === 'open').length, 1);
});

test('pointer icon inherited inside one entry does not cause a second click', async () => {
  const h = harness({ display: true });
  h.container.children[1].append(new Element('', { tag: 'span', cursor: 'pointer' }));
  const result = await h.context.rcPagePreflightWrite({ fieldId, taskUuid, displayId, desiredValue: desired });
  assert.equal(result.status, 'PREWRITE_READY');
  assert.equal(h.log.filter((e) => e === 'open').length, 1);
});


const pendingRead = (value = '') => ({ ok: false, status: 'READBACK_PENDING', valueReadVerified: true, currentSemantic: value });
const fullRead = () => ({ ok: true, status: 'WRITE_VERIFIED', valueReadVerified: true, currentSemantic: desired, fieldEvent: { uuid: 'synthetic_new_event' } });

async function convergenceCase(verify) {
  const h = harness({ display: true });
  wireExecutor(h, verify);
  const output = await h.context.onesRootCauseWriteExecute(config, acceptedJob());
  assert.equal(h.log.filter((e) => e.type === 'mouseReleased' && e.x === 400).length, 1, 'exactly one Save');
  assert.equal(h.log.filter((e) => e.method === 'Input.insertText').length, 1, 'no write retry');
  assert.equal(h.log.filter((e) => e === 'open').length, 1, 'no editor reopen');
  const metadata = output.result.verification;
  assert.equal(metadata.source, 'ONESQL_AND_FIELD_EVENTS');
  assert.ok(metadata.elapsedMs <= metadata.maxElapsedMs);
  assert.equal(metadata.attempts, metadata.inlineAttempts + metadata.convergenceAttempts);
  assert.equal(output.result.saveDispatched, true);
  return { ...h, ...output };
}

test('post-save immediate full verification needs only one read', async () => {
  const out = await convergenceCase(() => fullRead());
  assert.equal(out.status, 'WRITE_VERIFIED');
  assert.equal(out.result.verification.attempts, 1);
  assert.equal(out.result.verification.convergenceAttempts, 0);
  assert.equal(out.result.verification.elapsedMs, 0);
});

test('semantic persistence delayed beyond inline window converges without an event', async () => {
  const out = await convergenceCase((n) => pendingRead(n === 11 ? desired : ''));
  assert.equal(out.status, 'WRITE_VALUE_VERIFIED_EVENT_PENDING');
  assert.equal(out.result.ok, false);
  assert.equal(out.result.verification.inlineAttempts, 9);
  assert.equal(out.result.verification.convergenceAttempts, 2);
  assert.equal(out.result.verification.elapsedMs, 41200);
});

test('semantic and new event delayed beyond inline window converge fully', async () => {
  const out = await convergenceCase((n) => n === 12 ? fullRead() : pendingRead());
  assert.equal(out.status, 'WRITE_VERIFIED');
  assert.equal(out.result.verification.attempts, 12);
  assert.equal(out.result.verification.elapsedMs, 56200);
});

test('event delayed after exact semantic read remains in existing event-aware loop', async () => {
  const out = await convergenceCase((n) => n === 5 ? fullRead() : pendingRead(desired));
  assert.equal(out.status, 'WRITE_VERIFIED');
  assert.equal(out.result.verification.attempts, 5);
  assert.equal(out.result.verification.convergenceAttempts, 0);
});

test('exact semantic value at inline end reports event pending, never unverified', async () => {
  const out = await convergenceCase(() => pendingRead(desired));
  assert.equal(out.status, 'WRITE_VALUE_VERIFIED_EVENT_PENDING');
  assert.equal(out.result.verification.attempts, 9);
});

test('semantic never exact exhausts the bounded policy with no second Save', async () => {
  const out = await convergenceCase(() => pendingRead('different'));
  assert.equal(out.status, 'WRITE_UNVERIFIED');
  assert.equal(out.result.verification.attempts, 12);
  assert.equal(out.result.verification.elapsedMs, 56200);
});

test('script read failures remain explicit uncertainty, not persistence', async () => {
  const out = await convergenceCase(() => { throw new Error('synthetic failure'); });
  assert.equal(out.status, 'WRITE_UNVERIFIED');
  assert.equal(out.result.verification.lastStatus, 'READBACK_EXECUTION_FAILED');
  assert.equal(out.result.verification.attempts, 12);
});

test('a hung read is time-bounded across the entire post-save policy', async () => {
  const out = await convergenceCase(() => new Promise(() => {}));
  assert.equal(out.status, 'WRITE_UNVERIFIED');
  assert.equal(out.result.verification.lastStatus, 'READBACK_TIMEOUT');
  assert.ok(out.result.verification.attempts <= 12);
  assert.ok(out.result.verification.elapsedMs <= 90000);
});

test('target drift terminates read-only convergence without another Save', async () => {
  const out = await convergenceCase((n) => n === 10 ? { ok: false, status: 'TARGET_GUARD_FAILED' } : pendingRead());
  assert.equal(out.status, 'WRITE_UNVERIFIED');
  assert.equal(out.result.verification.lastStatus, 'TARGET_GUARD_FAILED');
  assert.equal(out.result.verification.attempts, 10);
});

async function pageRead(options = {}) {
  const h = harness();
  let aborted = 0;
  h.context.fetch = async (url, init) => {
    if (url.endsWith('/onesql')) {
      assert.equal(init.method, 'POST');
      assert.match(JSON.parse(init.body).query, /synthetic_root_cause/);
      if (options.hungValue) return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => { aborted += 1; reject(new Error('aborted')); });
      });
      if (options.drift) h.location.href += '/changed';
      return { ok: !options.badHttp, text: async () => JSON.stringify({ data: [
        { item: { uuid: options.wrongTask ? 'other' : taskUuid, [fieldId]: options.unsupportedValue ? { unexpected: desired } : options.wrappedValue ? { value: '<p>' + desired + '</p>' } : '<p>' + desired + '</p>' } }
      ] }) };
    }
    assert.ok(url.endsWith('/messages'));
    assert.equal(init.method, 'GET');
    if (options.eventFailure) throw new Error('event read unavailable');
    return { ok: true, text: async () => JSON.stringify({ messages: options.noEvent ? [] : [{
      uuid: options.oldEvent ? 'synthetic_baseline_event' : 'synthetic_new_event', type: 'system',
      ext: { field_uuid: options.wrongFieldEvent ? 'other_field' : fieldId, old_value: '', new_value: desired }
    }] }) };
  };
  const result = await h.context.rcPageVerifyWrite({ fieldId, taskUuid, displayId, desiredValue: desired, baselineEventIds: ['synthetic_baseline_event'], readTimeoutMs: 5000 });
  return { result, aborted, h };
}

test('actual ONESQL/event verifier proves exact semantic plus new event', async () => {
  assert.equal((await pageRead()).result.status, 'WRITE_VERIFIED');
});

test('event failures/absence/old or wrong-field events do not erase a valid semantic read', async () => {
  for (const option of ['eventFailure', 'noEvent', 'oldEvent', 'wrongFieldEvent']) {
    const { result } = await pageRead({ [option]: true });
    assert.equal(result.status, 'READBACK_PENDING');
    assert.equal(result.valueReadVerified, true);
    assert.equal(result.currentSemantic, desired);
    assert.equal(result.fieldEvent, null);
  }
});

test('failed HTTP or wrong task cannot masquerade as authoritative exact value', async () => {
  for (const option of ['badHttp', 'wrongTask']) {
    const { result } = await pageRead({ [option]: true });
    assert.equal(result.ok, false);
    assert.equal(result.valueReadVerified, false);
    assert.equal(result.currentSemantic, null);
  }
});

test('page verification aborts a hung fetch and does not fabricate value proof', async () => {
  const { result, aborted } = await pageRead({ hungValue: true });
  assert.equal(aborted, 1);
  assert.equal(result.valueReadVerified, false);
});

test('page identity is rechecked after asynchronous readback', async () => {
  assert.equal((await pageRead({ drift: true })).result.status, 'TARGET_GUARD_FAILED');
});


test('accepted value-wrapper semantics are retained without coercing unsupported values', async () => {
  assert.equal((await pageRead({ wrappedValue: true })).result.status, 'WRITE_VERIFIED');
  assert.equal((await pageRead({ unsupportedValue: true })).result.valueReadVerified, false);
});

test('integrated page read converges after delayed persistence using ONESQL and event requests only', async () => {
  const h = harness({ display: true });
  let requests = 0;
  wireExecutor(h, async (attempt, input) => {
    h.context.fetch = async (url, init) => {
      requests += 1;
      if (url.endsWith('/onesql')) {
        assert.equal(init.method, 'POST');
        return { ok: true, text: async () => JSON.stringify({ data: [{ item: {
          uuid: taskUuid, [fieldId]: attempt >= 11 ? { value: desired } : ''
        } }] }) };
      }
      assert.ok(url.endsWith('/messages'));
      assert.equal(init.method, 'GET');
      return { ok: true, text: async () => JSON.stringify({ messages: [] }) };
    };
    return h.context.rcPageVerifyWrite(input);
  });
  const out = await h.context.onesRootCauseWriteExecute(config, acceptedJob());
  assert.equal(out.status, 'WRITE_VALUE_VERIFIED_EVENT_PENDING');
  assert.equal(out.result.verification.attempts, 11);
  assert.equal(requests, 22);
  assert.equal(h.log.filter((e) => e.type === 'mouseReleased' && e.x === 400).length, 1);
});

test('hung event read returns exact semantic evidence before the outer script deadline', async () => {
  const h = harness();
  wireExecutor(h, async (_, input) => {
    h.context.fetch = async (url, init) => {
      if (url.endsWith('/onesql')) return { ok: true, text: async () => JSON.stringify({ data: [{ item: { uuid: taskUuid, [fieldId]: desired } }] }) };
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('event read aborted'))));
    };
    return h.context.rcPageVerifyWrite(input);
  });
  const out = await h.context.onesRootCauseWriteExecute(config, acceptedJob());
  assert.equal(out.status, 'WRITE_VALUE_VERIFIED_EVENT_PENDING');
  assert.equal(out.result.verification.attempts, 9);
  assert.equal(out.result.readback.valueReadVerified, true);
  assert.equal(h.log.filter((e) => e.type === 'mouseReleased' && e.x === 400).length, 1);
});


test('post-save guard rejects a different team route even with the same display ID', async () => {
  const h = harness();
  const expectedHref = h.location.href;
  h.location.href = expectedHref.replace('synthetic_team', 'other_team');
  const result = await h.context.rcPageVerifyWrite({ fieldId, taskUuid, displayId, expectedHref, desiredValue: desired });
  assert.equal(result.status, 'TARGET_GUARD_FAILED');
  assert.deepEqual(h.log, []);
});


function setRendered(h, options = {}) {
  h.root.options.classes = options.editorStillOpen ? ['standard-co-editor-editing'] : [];
  h.root.options.textAlign = options.rootAlign || 'left';
  h.root.children = [];
  const paragraph = new Element('synthetic_rendered_paragraph', {
    tag: 'p', text: options.text ?? desired, textAlign: options.align || 'left'
  });
  h.root.append(paragraph);
  return paragraph;
}

function renderedRead(h) {
  return h.context.rcPageVerifyRenderedAlignment(displayId, fieldId, desired, 'https://synthetic.invalid/#/team/synthetic_team/issue/' + displayId);
}

for (const align of ['left', 'start']) {
  test('saved single paragraph verifies rendered alignment: ' + align, () => {
    const h = harness();
    setRendered(h, { align });
    assert.equal(renderedRead(h).status, 'RENDERED_LEFT_VERIFIED');
  });
}

for (const align of ['center', 'right', 'justify']) {
  test('left ancestor cannot hide final text alignment: ' + align, () => {
    const h = harness();
    setRendered(h, { rootAlign: 'left', align });
    assert.equal(renderedRead(h).status, 'RENDERED_LEFT_PENDING');
  });
}

test('visible editor draft is never rendered presentation proof', () => {
  const h = harness();
  setRendered(h, { editorStillOpen: true });
  assert.equal(renderedRead(h).status, 'RENDERED_EDITOR_STILL_OPEN');
});

test('contenteditable descendant is not a saved field', () => {
  const h = harness();
  const paragraph = setRendered(h);
  paragraph.options.attrs = { contenteditable: 'true' };
  assert.equal(renderedRead(h).status, 'RENDERED_EDITOR_STILL_OPEN');
});

test('rendered root missing or duplicate fails closed including a hidden duplicate', () => {
  for (const roots of [[], [new Element(fieldId), new Element(fieldId, { hidden: true })]]) {
    assert.equal(renderedRead(harness({ roots })).status, 'RENDERED_FIELD_NOT_UNIQUE');
  }
});

test('rendered root visibility and exact semantic text are required', () => {
  const h = harness();
  setRendered(h, { text: desired + ' unsupported extra fact' });
  assert.equal(renderedRead(h).status, 'RENDERED_SEMANTIC_MISMATCH');
  setRendered(h);
  h.root.options.hidden = true;
  assert.equal(renderedRead(h).status, 'RENDERED_FIELD_NOT_VISIBLE');
});

test('decorative heading is not the accepted verbatim single paragraph', () => {
  const h = harness();
  const paragraph = setRendered(h);
  paragraph.tagName = 'H2';
  assert.equal(renderedRead(h).status, 'RENDERED_PARAGRAPH_POLICY_FAILED');
});

test('right-aligned text-bearing inline block cannot hide within a left paragraph', () => {
  const h = harness();
  const paragraph = setRendered(h, { text: '' });
  paragraph.append(new Element('', { tag: 'span', text: 'Synthetic ', display: 'inline-block', textAlign: 'right' }));
  paragraph.append(new Element('', { tag: 'span', text: 'confirmed cause' }));
  assert.equal(renderedRead(h).status, 'RENDERED_LEFT_PENDING');
});

test('rendered verification binds exact field ID and original issue URL', () => {
  const h = harness();
  setRendered(h);
  h.root.id = 'other_field';
  assert.equal(renderedRead(h).status, 'RENDERED_FIELD_NOT_UNIQUE');
  h.location.href = h.location.href.replace('synthetic_team', 'other_team');
  assert.equal(renderedRead(h).status, 'TARGET_GUARD_FAILED');
});

test('target drift during rendered DOM inspection fails closed', () => {
  const h = harness();
  const paragraph = setRendered(h);
  paragraph.getBoundingClientRect = () => {
    h.location.href += '/changed';
    return { left: 0, top: 0, width: 100, height: 30 };
  };
  assert.equal(renderedRead(h).status, 'TARGET_GUARD_FAILED');
});

async function presentationCase(render, verify = () => fullRead()) {
  const h = harness({ display: true });
  wireExecutor(h, verify, (n, args) => render(h, n, args));
  const out = await h.context.onesRootCauseWriteExecute(config, acceptedJob());
  assert.equal(h.log.filter((e) => e.type === 'mouseReleased' && e.x === 400).length, 1);
  assert.equal(h.log.filter((e) => e.method === 'Input.insertText').length, 1);
  assert.equal(h.log.filter((e) => e === 'open').length, 1);
  assert.equal(out.result.presentationPolicy, 'EXACT_SINGLE_PARAGRAPH_LEFT_V1');
  assert.equal(out.result.desired, desired);
  return { ...out, h };
}

test('semantic persistence plus rendered-left is accepted only after rendered read', async () => {
  const out = await presentationCase((h) => { setRendered(h); return renderedRead(h); });
  assert.equal(out.status, 'WRITE_VERIFIED');
  assert.equal(out.result.semanticStatus, 'WRITE_VERIFIED');
  assert.equal(out.result.presentation.status, 'RENDERED_LEFT_VERIFIED');
  assert.ok(out.h.log.indexOf('render:1') > out.h.log.indexOf('verify:1'));
});

for (const align of ['center', 'right']) {
  test('semantic PASS plus rendered ' + align + ' returns distinct presentation state without Save retry', async () => {
    const out = await presentationCase((h) => { setRendered(h, { align }); return renderedRead(h); });
    assert.equal(out.status, 'WRITE_PRESENTATION_UNVERIFIED');
    assert.equal(out.result.ok, false);
    assert.equal(out.result.semanticStatus, 'WRITE_VERIFIED');
    assert.equal(out.result.presentation.status, 'RENDERED_LEFT_PENDING');
    assert.equal(out.result.presentation.attempts, 3);
  });
}

test('delayed normal view uses bounded DOM reads, no input or Save retry', async () => {
  const out = await presentationCase((h, n) => {
    setRendered(h, { editorStillOpen: n < 3 });
    return renderedRead(h);
  });
  assert.equal(out.status, 'WRITE_VERIFIED');
  assert.equal(out.result.presentation.attempts, 3);
  assert.equal(out.result.presentation.elapsedMs, 1000);
});

test('semantic exact but event pending remains distinct even after presentation passes', async () => {
  const out = await presentationCase((h) => { setRendered(h); return renderedRead(h); }, () => pendingRead(desired));
  assert.equal(out.status, 'WRITE_VALUE_VERIFIED_EVENT_PENDING');
  assert.equal(out.result.presentation.ok, true);
  assert.equal(out.result.ok, false);
});

test('presentation failure retains semantic/event-pending evidence', async () => {
  const out = await presentationCase((h) => { setRendered(h, { align: 'right' }); return renderedRead(h); }, () => pendingRead(desired));
  assert.equal(out.status, 'WRITE_PRESENTATION_UNVERIFIED');
  assert.equal(out.result.semanticStatus, 'WRITE_VALUE_VERIFIED_EVENT_PENDING');
});

test('no rendered acceptance when semantic persistence itself remains unverified', async () => {
  const out = await presentationCase(() => { throw new Error('must not inspect presentation'); }, () => pendingRead());
  assert.equal(out.status, 'WRITE_UNVERIFIED');
  assert.equal(out.result.presentation, null);
  assert.equal(out.h.log.some((e) => typeof e === 'string' && e.startsWith('render:')), false);
});

test('rendered target drift stops immediately with no second Save', async () => {
  const out = await presentationCase((h) => { h.location.href += '/changed'; return renderedRead(h); });
  assert.equal(out.status, 'WRITE_PRESENTATION_UNVERIFIED');
  assert.equal(out.result.presentation.status, 'TARGET_GUARD_FAILED');
  assert.equal(out.result.presentation.attempts, 1);
});

test('hung or failed rendered inspection is bounded and never a success', async () => {
  for (const render of [() => new Promise(() => {}), () => { throw new Error('synthetic unavailable'); }]) {
    const out = await presentationCase(render);
    assert.equal(out.status, 'WRITE_PRESENTATION_UNVERIFIED');
    assert.ok(out.result.presentation.attempts <= 3);
    assert.ok(out.result.presentation.elapsedMs <= 5000);
  }
});

test('native paragraph normalization is explicit even if computed alignment is already left', () => {
  const h = harness();
  h.block.append(new Element('', { classes: ['text'], text: desired }));
  h.context.document.createRange = () => ({ selectNodeContents: (block) => assert.equal(block, h.block) });
  h.context.window = { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) };
  let commands = 0;
  h.context.document.execCommand = (command) => { assert.equal(command, 'justifyLeft'); commands += 1; return true; };
  const out = h.context.rcPageNormalizeDraftAlignment(displayId, fieldId, desired, h.block.id);
  assert.equal(out.status, 'DRAFT_LEFT_ALIGN_VERIFIED');
  assert.equal(commands, 1);
  assert.equal(h.block.innerText, desired);
});


for (const mode of ['missing', 'duplicate']) {
  test('semantic PASS plus ' + mode + ' rendered field fails closed without a second Save', async () => {
    const out = await presentationCase((h, n) => {
      if (n === 1) {
        setRendered(h);
        if (mode === 'missing') h.root.id = 'other_field';
        else h.root.parentElement.append(new Element(fieldId, { hidden: true }));
      }
      return renderedRead(h);
    });
    assert.equal(out.status, 'WRITE_PRESENTATION_UNVERIFIED');
    assert.equal(out.result.presentation.status, 'RENDERED_FIELD_NOT_UNIQUE');
  });
}

test('native alignment command failure cannot be reported as draft alignment success', () => {
  const h = harness();
  h.block.append(new Element('', { classes: ['text'], text: desired }));
  h.context.document.createRange = () => ({ selectNodeContents() {} });
  h.context.window = { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) };
  h.context.document.execCommand = () => false;
  assert.equal(h.context.rcPageNormalizeDraftAlignment(displayId, fieldId, desired, h.block.id).status, 'LEFT_ALIGN_COMMAND_FAILED');
  assert.equal(h.block.innerText, desired);
});
