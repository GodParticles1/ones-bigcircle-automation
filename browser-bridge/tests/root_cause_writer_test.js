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
      const tag = part.match(/^[a-z]+/i)?.[0];
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
  const block = new Element('synthetic_text_block', { focused: true, classes: ['text-block'], attrs: { 'data-type': 'editor-block', 'data-block-type': 'text' } });
  const save = new Element('synthetic_save', { tag: 'button', text: '\u4fdd\u5b58', save: true });
  const root = new Element(options.wrongEditorId ? 'other_field' : fieldId, {
    classes: ['standard-co-editor-editing', 'task-rich-text-edit'],
    blocks: options.blocks || [block], saves: options.saves || [save]
  });
  const body = new Element('', { tag: 'body' });
  let container;
  if (options.display) {
    const label = new Element('', { tag: 'span', text: options.bracketLabel ? '【问题根因】' : '问题根因' });
    const labelWrapper = new Element('', { children: [label] });
    const entry = new Element('', { tag: 'button', text: options.iconEntry ? '' : '编辑', onClick: () => {
      log.push('open');
      if (options.throwOpen) throw new Error('synthetic click failure');
      if (options.driftDuringOpen) location.href = href.replace(displayId, 'SYN-102');
      if (options.detachContainer) container.parentElement = null;
      if (!options.noTransition) {
        (options.editorOutside ? body : container).append(root);
        if (options.duplicateOpenedRoot) container.append(new Element(fieldId, { classes: ['standard-co-editor-editing', 'task-rich-text-edit'] }));
        if (options.hiddenDuplicateRoot) body.append(new Element(fieldId, { hidden: true }));
      }
    } });
    const children = [...(options.missingLabel ? [] : [labelWrapper]), ...(options.missingEntry ? [new Element('', { text: '只读内容' })] : [entry])];
    if (options.duplicateEntry) children.push(new Element('', { tag: 'button', text: '另一入口' }));
    if (options.duplicateLabel) children.push(new Element('', { tag: 'span', text: '问题根因' }));
    container = options.missingContainer ? body : new Element('', { children });
    if (options.missingContainer) children.forEach((child) => body.append(child));
    else body.append(container);
  } else {
    (options.roots || [root]).forEach((el) => body.append(el));
  }
  let valueReads = 0;
  const href = 'https://synthetic.invalid/#/team/synthetic_team/issue/' + displayId;
  const location = { origin: 'https://synthetic.invalid', href };
  const context = vm.createContext({
    Element, TextEncoder, TextDecoder, crypto: webcrypto, URL, location,
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout: () => {},
    getComputedStyle: (el) => ({ display: 'block', visibility: 'visible', opacity: '1', cursor: el.options.cursor || 'auto' }),
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
  return { context, log, root, block, save, location, container };
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
  test('display label opens and binds exact native field ID: bracket=' + bracketLabel, async () => {
    const { result, log } = await preflight({ display: true, bracketLabel, iconEntry: true });
    assert.equal(result.status, 'PREWRITE_READY');
    assert.equal(result.editorOpened, true);
    assert.deepEqual(log, ['identity', 'read', 'events', 'read', 'open']);
  });
}

const blockedTransitions = [
  ['missingLabel', 'ROOT_CAUSE_LABEL_NOT_UNIQUE', 0],
  ['duplicateLabel', 'ROOT_CAUSE_LABEL_NOT_UNIQUE', 0],
  ['missingContainer', 'ROOT_CAUSE_CONTAINER_NOT_UNIQUE', 0],
  ['missingEntry', 'ROOT_CAUSE_ENTRY_NOT_UNIQUE', 0],
  ['duplicateEntry', 'ROOT_CAUSE_ENTRY_NOT_UNIQUE', 0],
  ['noTransition', 'EDITOR_ROOT_NOT_UNIQUE', 1],
  ['wrongEditorId', 'EDITOR_FIELD_ID_MISMATCH', 1],
  ['duplicateOpenedRoot', 'EDITOR_ROOT_NOT_UNIQUE', 1],
  ['hiddenDuplicateRoot', 'EDITOR_ROOT_NOT_UNIQUE', 1],
  ['editorOutside', 'EDITOR_ROOT_NOT_UNIQUE', 1],
  ['detachContainer', 'ROOT_CAUSE_CONTAINER_LOST', 1],
  ['driftDuringOpen', 'TARGET_GUARD_FAILED', 1],
  ['throwOpen', 'EDITOR_OPEN_FAILED', 1]
];
for (const [option, status, clicks] of blockedTransitions) {
  test('fail closed without repeated clicks: ' + option, async () => {
    const { result, log } = await preflight({ display: true, [option]: true });
    assert.equal(result.ok, false);
    assert.equal(result.status, status);
    assert.equal(log.filter((event) => event === 'open').length, clicks);
  });
}

function wireExecutor(h) {
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
      else if (func.name === 'rcPageVerifyWrite') result = { ok: true, status: 'WRITE_VERIFIED' };
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

test('a missing local entry never falls back to a button in a sibling field', async () => {
  const h = harness({ display: true, missingEntry: true });
  h.container.parentElement.append(new Element('', { tag: 'button', text: '编辑另一个字段', onClick: () => { throw new Error('wrong field clicked'); } }));
  const result = await h.context.rcPagePreflightWrite({ fieldId, taskUuid, displayId, desiredValue: desired });
  assert.equal(result.status, 'ROOT_CAUSE_ENTRY_NOT_UNIQUE');
  assert.equal(h.log.includes('open'), false);
});

test('Save-only display surface cannot be mistaken for an edit entry', async () => {
  const h = harness({ display: true });
  h.container.children[1].options.text = '保存';
  const result = await h.context.rcPagePreflightWrite({ fieldId, taskUuid, displayId, desiredValue: desired });
  assert.equal(result.status, 'ROOT_CAUSE_ENTRY_NOT_UNIQUE');
  assert.equal(h.log.includes('open'), false);
});


test('nested independently interactive entries are ambiguous, not collapsed as icons', async () => {
  const h = harness({ display: true });
  h.container.children[1].append(new Element('', { tag: 'span', attrs: { role: 'button' }, text: '嵌套入口' }));
  const result = await h.context.rcPagePreflightWrite({ fieldId, taskUuid, displayId, desiredValue: desired });
  assert.equal(result.status, 'ROOT_CAUSE_ENTRY_NOT_UNIQUE');
  assert.equal(h.log.includes('open'), false);
});

test('pointer icon inherited inside one entry does not cause a second click', async () => {
  const h = harness({ display: true });
  h.container.children[1].append(new Element('', { tag: 'span', cursor: 'pointer' }));
  const result = await h.context.rcPagePreflightWrite({ fieldId, taskUuid, displayId, desiredValue: desired });
  assert.equal(result.status, 'PREWRITE_READY');
  assert.equal(h.log.filter((e) => e === 'open').length, 1);
});
