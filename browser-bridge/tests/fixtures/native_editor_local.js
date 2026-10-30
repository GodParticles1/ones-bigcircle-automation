/* Synthetic local regression only. Never call the Writer or diagnostic RUN. */
'use strict';
(() => {
  const arena = document.getElementById('arena');
  const output = document.getElementById('results');
  const summary = document.getElementById('summary');
  const runButton = document.getElementById('run-matrix');
  const expectedHash = '#/team/synthetic-team/project/synthetic-project/issue/SYN-1';
  const boundary = 'LOCAL_SYNTHETIC_NOT_ONES_ACCEPTANCE';
  const digest = document.querySelector('meta[name="fixture-source-sha256"]').content;
  const sourceGuard = () => location.protocol === 'http:' && location.hostname === '127.0.0.1' &&
    location.pathname === '/project/' && location.hash === expectedHash &&
    /^[a-f0-9]{64}$/.test(digest) && typeof nedPageControl === 'function';
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  function editor({id = 'fixture-field', mode = 'editing'} = {}) {
    const root = document.createElement('div');
    root.id = id;
    root.className = `standard-co-editor-${mode} task-rich-text-edit`;
    for (let index = 0; index < 4; index++) {
      const block = document.createElement('div');
      block.className = index === 0 ? 'text-block focused' : 'text-block';
      block.dataset.type = 'editor-block';
      block.dataset.blockType = 'text';
      root.append(block);
    }
    const host = document.createElement('textarea');
    host.className = 'editor-input';
    host.setAttribute('aria-label', 'Synthetic empty native caret host');
    host.readOnly = mode !== 'editing';
    root.append(host);
    arena.append(root);
    return {root, host};
  }

  const cases = [
    {name: 'EXACT_ROOT_FOUR_EMPTY_BLOCKS', reason: 'BOUND', ok: true},
    {name: 'VIEWING_ONLY', reason: 'VIEWING_ONLY', mode: 'viewing'},
    {name: 'NO_ROOT', reason: 'NO_VISIBLE_EDITING_ROOT', none: true},
    {name: 'MULTIPLE_VISIBLE_ROOTS', reason: 'MULTIPLE_VISIBLE_EDITING_ROOTS', second: true},
    {name: 'WRONG_TARGET_ID', reason: 'TARGET_EDITING_ROOT_MISMATCH', wrongId: true},
    {name: 'HIDDEN_DUPLICATE_ID', reason: 'TARGET_ID_NOT_UNIQUE', duplicate: true},
    {name: 'DISPLAY_NONE', reason: 'NO_VISIBLE_EDITING_ROOT', css: 'display:none'},
    {name: 'VISIBILITY_HIDDEN', reason: 'NO_VISIBLE_EDITING_ROOT', css: 'visibility:hidden'},
    {name: 'OPACITY_ZERO', reason: 'NO_VISIBLE_EDITING_ROOT', css: 'opacity:0'},
    {name: 'ROOT_TOO_SMALL', reason: 'NO_VISIBLE_EDITING_ROOT', css: 'width:8px;min-width:0;height:7px;min-height:0;padding:0;border:0;overflow:hidden'},
    {name: 'HOST_BLUR_ROOT_RETAINED', reason: 'BOUND', hostBlur: true},
    {name: 'INJECTED_ASYNC_EDITING_TO_VIEWING', reason: 'VIEWING_ONLY', asyncViewing: true},
  ];

  async function runCase(spec, index) {
    arena.replaceChildren();
    const fixture = spec.none ? null : editor({id: spec.wrongId ? 'fixture-other' : 'fixture-field', mode: spec.mode});
    if (spec.second) editor({id: 'fixture-second'});
    if (spec.duplicate) {
      const duplicate = editor();
      duplicate.root.style.display = 'none';
    }
    if (spec.css) fixture.root.style.cssText = spec.css;
    if (fixture && !fixture.host.readOnly && !spec.css) fixture.host.focus();
    if (spec.hostBlur) fixture.host.blur();
    if (spec.asyncViewing) {
      // Deliberate fault injection, not a claim about ONES blur behavior.
      await new Promise(resolve => setTimeout(() => {
        fixture.root.classList.replace('standard-co-editor-editing', 'standard-co-editor-viewing');
        fixture.host.readOnly = true;
        resolve();
      }, 0));
    }
    await frames();
    const request = {
      href: location.href, origin: location.origin, team: 'synthetic-team', display: 'SYN-1',
      field: 'fixture-field', run: `synthetic-local-${index}`, marker: 'NDP0123456789ab', action: 'ARM',
    };
    let result;
    try {
      // A background browser window may already be genuinely blurred. The
      // production helper permits only its documented neutral/deferred host
      // shape in that case, and still sends no native commands here.
      const pageHasFocus = document.hasFocus();
      result = await nedPageControl(request);
      const phase = result.phases?.find(item => item.stage === 'ARM');
      const reason = phase?.rootResolution?.reason;
      const expectedOk = spec.ok === true || spec.hostBlur === true && pageHasFocus === false;
      const expectedStatus = expectedOk ? 'ARMED' : spec.hostBlur ?
        'BLOCKED_EDIT_HOST' : 'BLOCKED_EDITOR_NOT_UNIQUE';
      const boundShape = !spec.ok || phase.blockCount === 4 && phase.focusedBlockCount === 1 &&
        phase.hostKind === 'TEXTAREA' && phase.hostConnected && phase.nativeHostFocused;
      const pass = result.ok === expectedOk && result.status === expectedStatus &&
        reason === spec.reason && boundShape;
      return {
        name: spec.name, pass, expectedStatus, expectedReason: spec.reason, pageHasFocus,
        status: result.status, rootResolution: phase?.rootResolution || null,
        blockCount: phase?.blockCount ?? null, focusedBlockCount: phase?.focusedBlockCount ?? null,
        hostKind: phase?.hostKind || null, nativeHostFocused: phase?.nativeHostFocused ?? null,
        injectedFault: spec.asyncViewing === true,
        insertTextDispatchCount: 0, saveCount: 0,
      };
    } finally {
      // Cleanup can only affect this request's synthetic run and instrumentation.
      await nedPageControl({...request, action: 'CLEANUP'});
    }
  }

  runButton.addEventListener('click', async () => {
    if (runButton.disabled) return;
    runButton.disabled = true;
    summary.textContent = 'RUNNING — synthetic local DOM only';
    const report = {
      scope: boundary, sourceSha256: digest, status: 'RUNNING', cases: [],
      insertTextDispatchCount: 0, saveCount: 0, productionTransport: 'NO_PRODUCTION_TRANSPORT',
      coverageExclusion: 'No real extension popup, ONES framework, native insertion or server acceptance.',
    };
    try {
      if (!sourceGuard()) throw new Error('SYNTHETIC_ROUTE_OR_SOURCE_GUARD');
      for (let index = 0; index < cases.length; index++) report.cases.push(await runCase(cases[index], index));
      report.passed = report.cases.filter(item => item.pass).length;
      report.total = cases.length;
      report.status = report.passed === report.total ? 'LOCAL_DOM_MATRIX_PASS' : 'LOCAL_DOM_MATRIX_FAIL';
    } catch (error) {
      report.status = 'LOCAL_DOM_MATRIX_ERROR';
      report.error = error instanceof Error ? error.message : 'SYNTHETIC_UNCLASSIFIED_ERROR';
    } finally {
      arena.replaceChildren();
      output.textContent = JSON.stringify(report, null, 2);
      summary.textContent = `${report.status} ${report.passed ?? 0}/${cases.length} — insertion=0, Save=0`;
      runButton.disabled = false;
    }
  });
})();
