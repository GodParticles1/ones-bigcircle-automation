/* Issue #110: operator-only, no-Save native editor diagnostic. No Relay job path. */
/* global chrome, relayReadTaskFields, validatedOnesScope */
const NED_SESSION_KEY = 'onesNativeDiagnosticV1';
let nedInFlight = false;
const nedWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nedId = (value) => /^[A-Za-z0-9_-]{1,128}$/.test(String(value || ''));

// Serialized by chrome.scripting into MAIN; deliberately no service-worker closure.
async function nedPageResolve(expected) {
  const id = (v) => /^[A-Za-z0-9_-]{1,128}$/.test(String(v || ''));
  if (location.href !== expected.href || location.origin !== expected.origin) return null;
  // ONES uses /project/#/team/.../issue/...; inspect only a real route, never URL search text.
  // This function runs serialized in MAIN world, so its route check is self-contained.
  const url = new URL(location.href);
  const routePath = url.pathname === '/project/' && url.hash.startsWith('#/team/')
    ? url.hash.slice(1).split('?')[0]
    : (!url.hash && url.pathname.startsWith('/team/') ? url.pathname : '');
  const route = routePath.match(/^\/team\/([A-Za-z0-9_-]{1,128})\/(?:[^/?#]+\/)*issue\/([A-Za-z0-9_-]{1,128})\/?$/);
  if (!route || route[1] !== expected.team || route[2] !== expected.display ||
      !id(expected.team) || !id(expected.display)) return null;
  try {
    const response = await fetch(location.origin + '/project/api/ones-project/team/' + encodeURIComponent(expected.team) + '/tasks/identifier', {
      method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{'content-type':'application/json; charset=UTF-8'},
      body:JSON.stringify({display_id_path:expected.display})
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (result?.display_id !== expected.display || !id(result?.task_uuid)) return null;
    if (location.href !== expected.href) return null;
    return {taskUuid:result.task_uuid};
  } catch (_) { return null; }
}

// All raw DOM text and the synthetic marker stay in the tab. Only capped metadata escapes.
async function nedPageControl(request) {
  const KEY = Symbol.for('ones.native.editor.diagnostic.v1');
  const safe = (v) => /^[A-Za-z0-9_-]{1,128}$/.test(String(v || ''));
  const normalize = (v) => String(v ?? '').replace(/[\u200B\uFEFF]/g, '').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();
  const hex = (a) => Array.from(new Uint8Array(a), (b) => b.toString(16).padStart(2,'0')).join('');
  const digest = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    return r.width > 10 && r.height > 8 && c.display !== 'none' && c.visibility !== 'hidden' && Number(c.opacity || '1') > 0;
  };
  // A textarea has a native caret independent of window.getSelection(). Never
  // manufacture a DOM range in MAIN world or infer an input target from a label.
  const domCaret = (block) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || !selection.isCollapsed ||
        !selection.anchorNode || !selection.focusNode ||
        !block.contains(selection.anchorNode) || !block.contains(selection.focusNode)) return null;
    try {
      const offset = (node, local) => {
        const range = document.createRange();
        range.selectNodeContents(block);
        range.setEnd(node, local);
        return range.toString().length;
      };
      const anchorOffset = offset(selection.anchorNode, selection.anchorOffset);
      const focusOffset = offset(selection.focusNode, selection.focusOffset);
      if (!Number.isInteger(anchorOffset) || !Number.isInteger(focusOffset) ||
          anchorOffset !== focusOffset) return null;
      return {anchorOffset, focusOffset, collapsed:true, selectionProof:'DOM_IN_BOUND_BLOCK'};
    } catch (_) { return null; }
  };
  const textareaCaret = (host) =>
    host?.tagName === 'TEXTAREA' && host.isConnected && !host.disabled && !host.readOnly &&
    host.value === '' && Number.isInteger(host.selectionStart) &&
    Number.isInteger(host.selectionEnd) && host.selectionStart === 0 &&
    host.selectionEnd === 0
      ? {anchorOffset:0, focusOffset:0, collapsed:true, selectionProof:'NATIVE_TEXTAREA_CARET'}
      : null;
  // A stale *collapsed* DOM selection outside the block can coexist with a
  // focused textarea; a noncollapsed range or one in another rich editor cannot.
  const competingSelection = (root) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    if (selection.rangeCount !== 1 || !selection.isCollapsed ||
        !selection.anchorNode || !selection.focusNode) return true;
    return [selection.anchorNode, selection.focusNode].some((node) => {
      const element = node.nodeType === 1 ? node : node.parentElement;
      const owner = element?.closest?.('div.standard-co-editor-editing.task-rich-text-edit');
      return owner && owner !== root;
    });
  };
  // Existing Writer reads a unique .text authoring surface, but the real
  // ONES editor has not established which other subtrees are non-authoring.
  // Categorize those subtrees without discarding any text. In particular,
  // visually hidden/off-screen blocks and textarea.value are still dirty.
  const dirtyPreflight = (root, stage) => {
    const bounded = (n) => Math.min(16, Math.max(0, n));
    const bucket = (n) => n === 0 ? 'ZERO' : n <= 32 ? 'ONE_TO_32' :
      n <= 128 ? 'THIRTYTHREE_TO_128' : 'OVER_128';
    const allBlocks = [...root.querySelectorAll('.text-block[data-type="editor-block"][data-block-type="text"]')];
    const textareas = [...root.querySelectorAll('textarea.editor-input')];
    let nonempty = 0, possibleAuthoring = 0, unclassified = 0, notVisible = 0;
    let surfaceCount = 0, maxBlockLength = 0, maxSurfaceLength = 0;
    for (const block of allBlocks) {
      // Values are used *only* in MAIN world for local predicates.
      const full = normalize(block.textContent);
      const surfaces = [...block.querySelectorAll('.text')];
      surfaceCount += surfaces.length;
      const authored = surfaces.map((node) => normalize(node.textContent)).join('');
      const fullLength = full.length;
      maxBlockLength = Math.max(maxBlockLength, fullLength);
      maxSurfaceLength = Math.max(maxSurfaceLength, authored.length);
      if (fullLength > 0 || authored.length > 0) {
        nonempty++;
        if (!visible(block)) notVisible++;
        if (authored.length > 0) possibleAuthoring++;
        if (fullLength > 0 && (authored.length === 0 || surfaces.length !== 1)) unclassified++;
      }
    }
    const nonemptyInputs = textareas.filter((node) => normalize(node.value).length > 0).length;
    const blocked = nonempty > 0 || nonemptyInputs > 0;
    if (!blocked) return null;
    // Evidence-only text ownership scan: never read outside the already bound
    // blocks, never export DOM strings/attributes, and never waive the dirty gate.
    const provenance = (() => {
      const limit = 160, leafLimit = 24;
      const counts = {authoringText:0, editableOther:0, controlLike:0,
        placeholderHint:0, hiddenDescendant:0, unknown:0};
      const tags = {span:0, div:0, paragraph:0, button:0, other:0};
      let visited = 0, leaves = 0, maxLeafLen = 0, truncated = false;
      for (const block of allBlocks) {
        if (!normalize(block.textContent)) continue;
        const stack = [block];
        while (stack.length) {
          if (visited >= limit || leaves >= leafLimit) { truncated = true; break; }
          const node = stack.pop();
          if (!node) continue;
          visited++;
          if (node.nodeType !== 3) {
            // A single DOM node can contain arbitrarily many siblings.
            // A spread of childNodes defeats the visit/leaf budget; read only
            // a bounded prefix and mark evidence incomplete instead.
            const children = node.childNodes;
            const total = Number.isSafeInteger(children?.length) && children.length >= 0
              ? children.length : 0;
            const take = Math.min(total, Math.max(0,limit-visited),
              Math.max(0,leafLimit-leaves));
            if (!children && node.hasChildNodes?.()) truncated = true;
            if (total > take) truncated = true;
            for (let i=take-1; i>=0; i--) {
              const child = children[i];
              if (child) stack.push(child);
            }
            continue;
          }
          const raw = normalize(node.nodeValue || '');
          if (!raw) continue;
          leaves++;
          maxLeafLen = Math.max(maxLeafLen, raw.length);
          let el = node.parentElement, depth=0;
          let authoring=false, editable=false, control=false, placeholder=false, hidden=false;
          const tag = el?.tagName === 'SPAN' ? 'span' :
            el?.tagName === 'DIV' ? 'div' : el?.tagName === 'P' ? 'paragraph' :
            el?.tagName === 'BUTTON' ? 'button' : 'other';
          tags[tag]++;
          while (el && depth++ < 24) {
            const cls = (name) => el.classList?.contains?.(name) === true;
            const attr = (name) => el.hasAttribute?.(name) === true;
            if (cls('text')) authoring=true;
            if (el.getAttribute?.('contenteditable') === 'true') editable=true;
            if (el.tagName === 'BUTTON' || ['button','toolbar'].includes(el.getAttribute?.('role'))) control=true;
            if (cls('placeholder') || attr('data-placeholder') || attr('placeholder') ||
                attr('aria-placeholder')) placeholder=true;
            if (el.hidden === true || attr('aria-hidden') && el.getAttribute?.('aria-hidden') === 'true') hidden=true;
            try {
              const style=getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' ||
                  style.visibility === 'collapse') hidden=true;
            } catch (_) { truncated=true; }
            if (el === block) break;
            el=el.parentElement;
          }
          if (depth > 24 || el !== block) truncated=true;
          // Categories are observations, not proof that any text is disposable.
          const category = hidden ? 'hiddenDescendant' : authoring ? 'authoringText' :
            control ? 'controlLike' : placeholder ? 'placeholderHint' :
            editable ? 'editableOther' : 'unknown';
          counts[category]++;
        }
        if (stack.length) truncated=true;
        if (visited >= limit || leaves >= leafLimit) break;
      }
      const cap = (v) => Math.min(16,v);
      return {schema:'LEAF_OWNER_V1',nonemptyLeafCount:cap(leaves),
        inspectedNodeCount:cap(visited),incomplete:truncated || (nonempty>0 && leaves===0),
        maxLeafLength:bucket(maxLeafLen),
        authoringTextLeaves:cap(counts.authoringText),
        editableOtherLeaves:cap(counts.editableOther),
        controlLikeLeaves:cap(counts.controlLike),
        placeholderHintLeaves:cap(counts.placeholderHint),
        hiddenDescendantLeaves:cap(counts.hiddenDescendant),
        unknownLeaves:cap(counts.unknown),
        ownerTagSpan:cap(tags.span),ownerTagDiv:cap(tags.div),
        ownerTagParagraph:cap(tags.paragraph),ownerTagButton:cap(tags.button),
        ownerTagOther:cap(tags.other),ownershipProof:'NOT_ESTABLISHED'};
    })();
    const reason = nonemptyInputs ? 'TEXTAREA_VALUE_PRESENT' :
      notVisible ? 'NONVISIBLE_BLOCK_CONTENT' :
      possibleAuthoring ? 'AUTHORING_SURFACE_CONTENT' :
      'UNCLASSIFIED_BLOCK_TEXT';
    const selection = window.getSelection();
    const domCaretShape = !selection || selection.rangeCount === 0 ? 'NO_DOM_RANGE' :
      (selection.rangeCount !== 1 || !selection.isCollapsed ? 'NONCOLLAPSED_OR_MULTIPLE' : 'COLLAPSED_DOM_RANGE');
    // No raw text, selectors containing field IDs, URLs, text hashes or node HTML.
    return {ok:false,status:'BLOCKED_DIRTY_DRAFT',preflight:{
      stage,reason,
      nonemptyBlockCount:bounded(nonempty),authoringSurfaceCount:bounded(surfaceCount),
      possibleAuthoringCount:bounded(possibleAuthoring),unclassifiedBlockCount:bounded(unclassified),
      nonvisibleNonemptyCount:bounded(notVisible),textareaCount:bounded(textareas.length),
      textareaState:nonemptyInputs ? 'HAS_VALUE' : textareas.length ? 'EMPTY' : 'NONE',
      maxBlockLength:bucket(maxBlockLength),maxAuthoringLength:bucket(maxSurfaceLength),
      domCaretShape,provenance,ownershipProof:'NOT_ESTABLISHED'
    }};
  };
  const state = window[KEY];
  const stage = request.action === 'INSPECT' ?
    (request.stage === 'INSPECT_2' ? 'INSPECT_2' : 'INSPECT_1') :
    ['ARM','AFTER_NATIVE_CLICK','AFTER_CTRL_A','BEFORE_INSERT'].includes(request.action) ? request.action : null;
  const phases = state?.phases || [];
  const withPhase = (result) => stage ? {...result,phase:stage,phases:phases.slice()} : result;
  const fail = (status) => withPhase({ok:false,status});
  const rootNow = () => {
    const all = [...document.querySelectorAll('div.standard-co-editor-editing.task-rich-text-edit')].filter(visible);
    const exact = all.filter((el) => el.id === request.field);
    return all.length === 1 && exact.length === 1 &&
      document.querySelectorAll('[id]').length >= 1 &&
      [...document.querySelectorAll('[id]')].filter((el) => el.id === request.field).length === 1 ? exact[0] : null;
  };
  const current = () => {
    const url = new URL(location.href);
    const routePath = url.pathname === '/project/' && url.hash.startsWith('#/team/')
        ? url.hash.slice(1).split('?')[0]
        : (!url.hash && url.pathname.startsWith('/team/') ? url.pathname : '');
      const route = routePath.match(/^\/team\/([A-Za-z0-9_-]{1,128})\/(?:[^/?#]+\/)*issue\/([A-Za-z0-9_-]{1,128})\/?$/);
    if (location.href !== request.href || url.origin !== request.origin ||
        !route || route[1] !== request.team || route[2] !== request.display) return null;
    return rootNow();
  };
  // Observe before checking a guard so a rejected phase remains diagnosable.
  // The observations never grant authority, retarget a host or repair a selection.
  const recordPhase = (root, bound=state) => {
    if (!stage) return;
    const bounded = (n, max=16) => Number.isInteger(n) && n >= 0 ? Math.min(max,n) : 0;
    const block = bound?.block, host = bound?.host, active = document.activeElement;
    const blocks = root ? [...root.querySelectorAll('.text-block[data-type="editor-block"][data-block-type="text"]')].filter(visible) : [];
    const focused = blocks.filter((el) => el.classList.contains('focused'));
    const selection = window.getSelection();
    const dom = block?.isConnected ? domCaret(block) : null;
    const native = bound?.hostKind === 'TEXTAREA' ? textareaCaret(host) : null;
    const nativeHostFocused = !!host && host.isConnected && !!root?.contains(host) &&
      (active === host || bound?.hostKind === 'CONTENTEDITABLE' && host.contains(active));
    const proof = bound?.hostKind === 'TEXTAREA' && nativeHostFocused && native ? native : dom;
    const observation = {stage,elapsedMs:bounded(Date.now()-(bound?.started || Date.now()),60000),
      mutationCount:bounded(bound?.changed,65535),blockCount:bounded(blocks.length),
      focusedBlockCount:bounded(focused.length),sameBoundBlock:focused.length===1 && focused[0]===block,
      rootConnected:!!root?.isConnected,blockConnected:!!block?.isConnected && !!root?.contains(block),
      hostConnected:!!host?.isConnected && !!root?.contains(host),hostKind:bound?.hostKind || 'UNVERIFIED',
      nativeHostFocused,pageHasFocus:document.hasFocus?.() === true,
      activeHostKind:active?.tagName === 'TEXTAREA' ? 'TEXTAREA' : active?.isContentEditable ? 'CONTENTEDITABLE' :
        !active || active === document.body || active === document.documentElement ? 'NEUTRAL' : 'OTHER',
      domRangeCount:bounded(selection?.rangeCount),domCollapsed:selection?.isCollapsed===true,
      domInBoundBlock:!!block && !!selection?.anchorNode && !!selection?.focusNode &&
        block.contains(selection.anchorNode) && block.contains(selection.focusNode),
      selectionProof:proof?.selectionProof || 'NOT_PROVEN',anchorOffset:proof?.anchorOffset ?? null,
      focusOffset:proof?.focusOffset ?? null,events:(bound?.events || []).slice(0,40)};
    // A phase is recorded once, replacing only its provisional ARM observation.
    if (phases.at(-1)?.stage === stage) phases[phases.length-1]=observation;
    else if (phases.length < 6) phases.push(observation);
  };
  if (request.action === 'CLEANUP') {
    if (state && state.run === request.run) {
      state.observer.disconnect();
      for (const [name, listener] of state.listeners) document.removeEventListener(name, listener, true);
      delete window[KEY];
    }
    return {ok:true,status:'CLEANED'};
  }
  if (request.action === 'CLOSED') {
    return {ok:true,status:current() ? 'EDITOR_STILL_OPEN' : 'EDITOR_CLOSED'};
  }
  if (request.action === 'ARM') {
    if (state) return fail('BLOCKED_ALREADY_ARMED');
    if (!safe(request.field) || !safe(request.display) || !safe(request.team) ||
        !safe(request.run) || !/^NDP[0-9a-f]{12}$/.test(request.marker)) return fail('BLOCKED_IDENTITY');
    const root = current();
    recordPhase(root);
    if (!root) return fail('BLOCKED_EDITOR_NOT_UNIQUE');
    const blocks = [...root.querySelectorAll('.text-block[data-type="editor-block"][data-block-type="text"]')].filter(visible);
    const focused = blocks.filter((el) => el.classList.contains('focused'));
    if (blocks.length < 1 || focused.length !== 1) return fail('BLOCKED_FOCUSED_BLOCK_NOT_UNIQUE');
    const dirt = dirtyPreflight(root,'ARM');
    if (dirt) return withPhase(dirt);
    const block = focused[0];
    const active = document.activeElement;
    // ONES may use a same-root sibling textarea.editor-input as its native input host.
    // A popup can also blur the page before this background MAIN-world probe runs.
    // Do not infer an arbitrary host from the DOM: require one exact-root candidate,
    // a uniquely focused text block and the independently checked collapsed selection.
    const textareas = [...root.querySelectorAll('textarea.editor-input')]
      .filter((el) => el.isConnected && el.tagName === 'TEXTAREA' && !el.disabled && !el.readOnly);
    if (textareas.length > 1) return fail('BLOCKED_EDIT_HOST_AMBIGUOUS');
    const editable = [...root.querySelectorAll('[contenteditable="true"]')]
      .filter((el) => el.isConnected && (el.contains(block) || block.contains(el)));
    const activeEditable = active?.closest?.('[contenteditable="true"]') ||
      (active?.isContentEditable ? active : null);
    const activeTextarea = textareas.length === 1 && active === textareas[0] ? active : null;
    let editorHost = null;
    let hostKind = null;
    let focusDeferred = false;
    if (activeTextarea) {
      editorHost = activeTextarea;
      hostKind = 'TEXTAREA';
    } else if (activeEditable && root.contains(activeEditable) &&
        (activeEditable.contains(block) || block.contains(activeEditable)) &&
        editable.length === 1 && editable[0] === activeEditable) {
      editorHost = activeEditable;
      hostKind = 'CONTENTEDITABLE';
    } else {
      const candidates = [...textareas, ...editable];
      const pageBlurred = document.hasFocus?.() === false;
      const neutralActive = !active || active === document.body || active === document.documentElement;
      if (!pageBlurred || !neutralActive || candidates.length !== 1) return fail('BLOCKED_EDIT_HOST');
      editorHost = candidates[0];
      hostKind = textareas.includes(editorHost) ? 'TEXTAREA' : 'CONTENTEDITABLE';
      focusDeferred = true;
    }
    if (!root.contains(editorHost) || !editorHost.isConnected) return fail('BLOCKED_EDIT_HOST');
    if (hostKind === 'TEXTAREA' &&
        (editorHost.value !== '' || !Number.isInteger(editorHost.selectionStart) ||
         editorHost.selectionStart !== editorHost.selectionEnd)) return fail('BLOCKED_TEXTAREA_SELECTION');
    const initialDomCaret = domCaret(block);
    if (competingSelection(root)) return fail('BLOCKED_SELECTION');
    if (hostKind === 'TEXTAREA') {
      if (!textareaCaret(editorHost)) return fail('BLOCKED_TEXTAREA_SELECTION');
    } else if (!initialDomCaret && document.hasFocus?.() !== false) {
      // A focused contenteditable must present its real DOM caret; a genuinely
      // blurred popup session may defer only until the one native CDP click.
      return fail('BLOCKED_SELECTION');
    }
    const next = {run:request.run, root, block, host:editorHost, hostKind, focusDeferred, preClickSelectionDeferred:!initialDomCaret, marker:request.marker,
      href:request.href, team:request.team, field:request.field, display:request.display,
      started:Date.now(), samples:[], events:[], phases, pending:Promise.resolve(), listeners:[], changed:0, inserted:false};
    recordPhase(root,next);
    const sample = (kind) => {
      const t = Date.now() - next.started;
      const values = [...root.querySelectorAll('.text-block[data-type="editor-block"][data-block-type="text"]')].filter(visible).map((el) => normalize(el.textContent));
      const bound = block.isConnected && root.contains(block);
      next.pending = next.pending.then(async () => {
        // Never hash user-authored content or unknown accessory DOM text.
        // Only the empty baseline and this synthetic marker may be hashed.
        const blocks = await Promise.all(values.map(async (text) => ({
          length:Math.min(256,text.length),
          sha256:(text === '' || text === next.marker) ? await digest(text) : null
        })));
        if (next.samples.length < 28) next.samples.push({t,kind,blocks,blockConnected:bound});
      });
    };
    next.sample = sample;
    for (const name of ['beforeinput','input','compositionstart','compositionupdate','compositionend']) {
      const listener = (event) => {
        if (!root.contains(event.target)) return;
        if (next.events.length >= 40) return;
        const entry = {t:Date.now()-next.started,type:name,trusted:event.isTrusted === true,
          inputType:/^[a-zA-Z]{1,32}$/.test(event.inputType || '') ? event.inputType : null,
          cancelable:event.cancelable === true,preventedCapture:event.defaultPrevented === true,
          preventedAfter:false,boundBlock:block.contains(event.target),isComposing:event.isComposing === true};
        next.events.push(entry);
        queueMicrotask(() => {entry.preventedAfter = event.defaultPrevented === true;});
        sample('EVENT_' + name);
      };
      document.addEventListener(name,listener,true);
      next.listeners.push([name,listener]);
    }
    next.observer = new MutationObserver(() => { next.changed++; sample('MUTATION'); });
    next.observer.observe(root,{subtree:true,childList:true,characterData:true});
    window[KEY] = next;
    sample('ARM');
    return withPhase({ok:true,status:'ARMED'});
  }
  if (!state || state.run !== request.run) return fail('BLOCKED_STALE_SESSION');
  const root = current();
  recordPhase(root);
  if (!root || root !== state.root || !state.block.isConnected || !root.contains(state.block)) {
    if (request.action === 'FINISH') {
      await state.pending;
      return {ok:false,status:'TRACE_MISMATCH',trace:{semantic:'EDITOR_DRIFT',
        events:state.events.slice(),samples:state.samples.slice(),mutationCount:state.changed}};
    }
    return fail('BLOCKED_DOM_DRIFT');
  }
  const blocks = [...root.querySelectorAll('.text-block[data-type="editor-block"][data-block-type="text"]')].filter(visible);
  const focused = blocks.filter((el) => el.classList.contains('focused'));
  if (focused.length !== 1 || focused[0] !== state.block) return fail('BLOCKED_FOCUS_DRIFT');
  const finishing = request.action === 'FINISH';
  if (!finishing && stage) {
    const dirt = dirtyPreflight(root,stage);
    if (dirt) return withPhase(dirt);
  }
  const rect = state.block.getBoundingClientRect();
  const x = Math.round(Math.min(rect.right-8,rect.left+18));
  const y = Math.round(rect.top+rect.height/2);
  if (!finishing && (!visible(state.block) || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight ||
      !state.block.contains(document.elementFromPoint(x,y)))) return fail('BLOCKED_COORDINATE_DRIFT');
  const active = document.activeElement;
  const hasNativeFocus = !!active && !!state.host && state.host.isConnected &&
    root.contains(state.host) && (state.host === active ||
      (state.hostKind === 'CONTENTEDITABLE' && state.host.contains(active)));
  // During pre-click INSPECT only, accept a browser-popup blur if the unique
  // host is still bound and no unrelated page control is the active element.
  // Each post-click gate must prove the native click reacquired the exact host.
  const neutralBlur = state.focusDeferred && request.action === 'INSPECT' &&
    document.hasFocus?.() === false &&
    (!active || active === document.body || active === document.documentElement);
  if (!finishing && !hasNativeFocus && !neutralBlur) return fail('BLOCKED_EDIT_HOST_DRIFT');
  if (!finishing && state.hostKind === 'TEXTAREA' &&
      (state.host.tagName !== 'TEXTAREA' || state.host.disabled || state.host.readOnly ||
       state.host.value !== '' || !Number.isInteger(state.host.selectionStart) ||
       state.host.selectionStart !== state.host.selectionEnd ||
       [...root.querySelectorAll('textarea.editor-input')].filter((el) => el.isConnected).length !== 1 ||
       root.querySelectorAll('textarea.editor-input')[0] !== state.host)) return fail('BLOCKED_TEXTAREA_SELECTION');
  if (!finishing && state.hostKind === 'CONTENTEDITABLE' &&
      [...root.querySelectorAll('[contenteditable="true"]')].filter((el) =>
        el.isConnected && (el.contains(state.block) || state.block.contains(el))).length !== 1)
    return fail('BLOCKED_EDIT_HOST_AMBIGUOUS');
  if (!finishing && competingSelection(root)) return fail('BLOCKED_SELECTION_DRIFT');
  const actualDomCaret = domCaret(state.block);
  const actualTextareaCaret = state.hostKind === 'TEXTAREA' ? textareaCaret(state.host) : null;
  let proof = null;
  if (finishing) {
    proof = state.postClickSelection || {anchorOffset:null,focusOffset:null,collapsed:false,
      selectionProof:'NOT_PROVEN'};
  } else if (state.hostKind === 'TEXTAREA') {
    // Post-click gates also require hasNativeFocus above: only the one real CDP
    // click may restore the bound textarea; its own collapsed caret is authority.
    if (!actualTextareaCaret) return fail('BLOCKED_TEXTAREA_SELECTION');
    proof = actualTextareaCaret;
  } else {
    if (!actualDomCaret && (['AFTER_NATIVE_CLICK','AFTER_CTRL_A','BEFORE_INSERT'].includes(request.action) ||
        document.hasFocus?.() !== false || (!hasNativeFocus && !neutralBlur)))
      return fail('BLOCKED_SELECTION_DRIFT');
    proof = actualDomCaret || {anchorOffset:null,focusOffset:null,collapsed:false,
      selectionProof:'DEFERRED_UNTIL_NATIVE_CLICK'};
  }
  const {anchorOffset, focusOffset, collapsed, selectionProof} = proof;
  if (request.action === 'INSPECT') {
    state.sample('PREFLIGHT');
    return withPhase({ok:true,status:'READY',point:{x,y},blockCount:blocks.length,focusedCount:focused.length,
      anchorOffset,focusOffset,collapsed,selectionProof,hostKind:state.hostKind,focusDeferred:state.focusDeferred,elapsedMs:Date.now()-state.started});
  }
  if (['AFTER_NATIVE_CLICK','AFTER_CTRL_A','BEFORE_INSERT'].includes(request.action)) {
    state.postClickSelection=proof;
    state.sample(request.action);
    return withPhase({ok:true,status:'SELECTION_READY',point:{x,y},anchorOffset,focusOffset,collapsed,selectionProof});
  }
  if (request.action !== 'FINISH') return fail('BLOCKED_UNKNOWN_ACTION');
  state.sample('FINAL');
  await state.pending;
  const values = blocks.map((el) => normalize(el.textContent));
  const occurrence = (str) => str.split(state.marker).length - 1;
  const count = values.reduce((sum,value) => sum + occurrence(value),0);
  const selected = normalize(state.block.textContent);
  let semantic;
  if (count > 1) semantic = 'DUPLICATE';
  else if (count === 1 && selected === state.marker && values.every((v,i) => blocks[i] === state.block || !v)) semantic = 'EXACT_ONCE';
  else if (count === 1) semantic = 'EXTRA_OR_INTERLEAVED';
  else if (values.every((v) => !v)) semantic = 'EMPTY';
  else if (values.some((v) => v.includes(state.marker.slice(0,5)) || state.marker.includes(v) && v.length > 2)) semantic = 'PARTIAL';
  else semantic = 'MISMATCH';
  const trace = {semantic,events:state.events.slice(),samples:state.samples.slice(),
    mutationCount:state.changed,selection:{anchorOffset,focusOffset,collapsed,selectionProof},
    hostBound:true,hostKind:state.hostKind,focusDeferred:state.focusDeferred,blockCount:blocks.length,focusedCount:focused.length,
    frontendVersion:(() => { const v = document.querySelector('meta[name="app-version"]')?.content || window.APP_VERSION;
      return /^\d{1,4}(?:\.\d{1,4}){1,3}$/.test(String(v||'')) ? String(v) : null; })()};
  return {ok:semantic==='EXACT_ONCE',status:semantic==='EXACT_ONCE'?'TRACE_EXACT_ONCE':'TRACE_MISMATCH',trace};
}

async function nedExecuteScript(tabId, func, args) {
  const [v] = await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func,args});
  return v?.result || null;
}
async function nedAuthoritativeBlank(config, tabId, taskUuid, field) {
  try {
    const result = await nedExecuteScript(tabId,relayReadTaskFields,[{
      teamUuid:config.teamUuid,projectUuid:config.projectUuid,issueTypeUuid:config.issueTypeUuid
    },{fieldId:field,onesTaskUuids:[taskUuid]}]);
    const row = result?.reads?.[0];
    if (result?.ok !== true || result?.complete !== true || result?.readOnly !== true ||
        result?.requestedTaskCount !== 1 || result?.reads?.length !== 1 ||
        result?.fieldId !== field || row?.onesTaskUuid !== taskUuid ||
        row?.fieldId !== field || row?.status !== 'READ_VERIFIED') return 'UNKNOWN';
    return row.value === '' ? 'BLANK' : 'NONEMPTY';
  } catch (_) { return 'UNKNOWN'; }
}
function nedRedacted(status, insertCount=0, extra={}) {
  return {ok:status==='TRACE_EXACT_ONCE',status,diagnosticOnly:true,writeGate:'OFF',
    saveDispatched:false,insertTextCount:insertCount,noSaveDispatched:true,
    serverVerification:'NOT_VERIFIED',...extra};
}
function nedSafePhaseName(value) {
  return ['ARM','INSPECT_1','INSPECT_2','AFTER_NATIVE_CLICK','AFTER_CTRL_A','BEFORE_INSERT'].includes(value)
    ? value : 'UNVERIFIED';
}
function nedSafePhases(value) {
  if (!Array.isArray(value)) return [];
  const count = (v,max=16) => Number.isInteger(v) && v >= 0 ? Math.min(max,v) : 0;
  const offset = (v) => Number.isInteger(v) && v >= 0 ? Math.min(256,v) : null;
  const choice = (v,allowed) => allowed.includes(v) ? v : 'UNVERIFIED';
  return value.slice(0,6).map((p) => ({
    stage:nedSafePhaseName(p?.stage),elapsedMs:count(p?.elapsedMs,60000),
    mutationCount:count(p?.mutationCount,65535),blockCount:count(p?.blockCount),
    focusedBlockCount:count(p?.focusedBlockCount),sameBoundBlock:p?.sameBoundBlock===true,
    rootConnected:p?.rootConnected===true,blockConnected:p?.blockConnected===true,
    hostConnected:p?.hostConnected===true,nativeHostFocused:p?.nativeHostFocused===true,
    pageHasFocus:p?.pageHasFocus===true,hostKind:choice(p?.hostKind,['TEXTAREA','CONTENTEDITABLE']),
    activeHostKind:choice(p?.activeHostKind,['TEXTAREA','CONTENTEDITABLE','NEUTRAL','OTHER']),
    domRangeCount:count(p?.domRangeCount),domCollapsed:p?.domCollapsed===true,
    domInBoundBlock:p?.domInBoundBlock===true,
    selectionProof:choice(p?.selectionProof,['NATIVE_TEXTAREA_CARET','DOM_IN_BOUND_BLOCK','NOT_PROVEN']),
    anchorOffset:offset(p?.anchorOffset),focusOffset:offset(p?.focusOffset),
    events:Array.isArray(p?.events) ? p.events.slice(0,40).map((e) => ({
      t:count(e?.t,60000),type:choice(e?.type,['beforeinput','input','compositionstart','compositionupdate','compositionend']),
      trusted:e?.trusted===true,inputType:choice(e?.inputType,['insertText','insertCompositionText',
        'insertFromComposition','deleteCompositionText','deleteContentBackward','deleteContentForward',
        'insertParagraph','insertLineBreak','historyUndo','historyRedo']),
      cancelable:e?.cancelable===true,preventedCapture:e?.preventedCapture===true,
      preventedAfter:e?.preventedAfter===true,boundBlock:e?.boundBlock===true,isComposing:e?.isComposing===true
    })) : []
  }));
}
function nedPhaseReceipt(result) {
  return result?.phase || Array.isArray(result?.phases)
    ? {phase:nedSafePhaseName(result?.phase),phases:nedSafePhases(result?.phases)} : {};
}
function nedSafeLeafProvenance(value) {
  if (!value || value.schema !== 'LEAF_OWNER_V1') return null;
  const count=(v)=>Number.isInteger(v)&&v>=0?Math.min(16,v):0;
  const bucket=(v)=>['ZERO','ONE_TO_32','THIRTYTHREE_TO_128','OVER_128'].includes(v)?v:'UNVERIFIED';
  return {schema:'LEAF_OWNER_V1',
    nonemptyLeafCount:count(value.nonemptyLeafCount),
    inspectedNodeCount:count(value.inspectedNodeCount),
    incomplete:value.incomplete===true,
    maxLeafLength:bucket(value.maxLeafLength),
    authoringTextLeaves:count(value.authoringTextLeaves),
    editableOtherLeaves:count(value.editableOtherLeaves),
    controlLikeLeaves:count(value.controlLikeLeaves),
    placeholderHintLeaves:count(value.placeholderHintLeaves),
    hiddenDescendantLeaves:count(value.hiddenDescendantLeaves),
    unknownLeaves:count(value.unknownLeaves),
    ownerTagSpan:count(value.ownerTagSpan),
    ownerTagDiv:count(value.ownerTagDiv),
    ownerTagParagraph:count(value.ownerTagParagraph),
    ownerTagButton:count(value.ownerTagButton),
    ownerTagOther:count(value.ownerTagOther),
    ownershipProof:'NOT_ESTABLISHED'};
}
function nedSafePreflight(value) {
  if (!value || typeof value !== 'object') return null;
  const allowed = (v, values, fallback) => values.includes(v) ? v : fallback;
  const count = (v) => Number.isInteger(v) && v >= 0 ? Math.min(16,v) : 0;
  const bucket = (v) => allowed(v,['ZERO','ONE_TO_32','THIRTYTHREE_TO_128','OVER_128'],'UNVERIFIED');
  return {
    stage:nedSafePhaseName(value.stage),
    reason:allowed(value.reason,['TEXTAREA_VALUE_PRESENT','NONVISIBLE_BLOCK_CONTENT',
      'AUTHORING_SURFACE_CONTENT','UNCLASSIFIED_BLOCK_TEXT'],'UNVERIFIED'),
    nonemptyBlockCount:count(value.nonemptyBlockCount),
    authoringSurfaceCount:count(value.authoringSurfaceCount),
    possibleAuthoringCount:count(value.possibleAuthoringCount),
    unclassifiedBlockCount:count(value.unclassifiedBlockCount),
    nonvisibleNonemptyCount:count(value.nonvisibleNonemptyCount),
    textareaCount:count(value.textareaCount),
    textareaState:allowed(value.textareaState,['NONE','EMPTY','HAS_VALUE'],'UNVERIFIED'),
    maxBlockLength:bucket(value.maxBlockLength),
    maxAuthoringLength:bucket(value.maxAuthoringLength),
    domCaretShape:allowed(value.domCaretShape,['NO_DOM_RANGE','NONCOLLAPSED_OR_MULTIPLE',
      'COLLAPSED_DOM_RANGE'],'UNVERIFIED'),
    ownershipProof:'NOT_ESTABLISHED',
    provenance:nedSafeLeafProvenance(value.provenance)
  };
}
function nedPageFailure(result,fallback) {
  const status = typeof result?.status === 'string' && /^BLOCKED_[A-Z_]{1,70}$/.test(result.status)
    ? result.status : fallback;
  return nedRedacted(status,0,{...nedPhaseReceipt(result),
    ...(status === 'BLOCKED_DIRTY_DRAFT' && result?.preflight
      ? {preflight:nedSafePreflight(result.preflight)} : {})});
}
async function nedCurrentTab(config, tabId, expectedHref) {
  const active = await chrome.tabs.query({active:true,currentWindow:true});
  if (active.length !== 1 || active[0].id !== tabId) return null;
  const tab = await chrome.tabs.get(tabId);
  if (!tab || tab.status === 'loading' || !tab.url || tab.url !== active[0].url) return null;
  const u = new URL(tab.url);
  // Bind only a genuine ONES path/hash route; query parameters never supply identities.
  const routePath = u.pathname === '/project/' && u.hash.startsWith('#/team/')
    ? u.hash.slice(1).split('?')[0]
    : (!u.hash && u.pathname.startsWith('/team/') ? u.pathname : '');
  const route = routePath.match(/^\/team\/([A-Za-z0-9_-]{1,128})\/(?:[^/?#]+\/)*issue\/([A-Za-z0-9_-]{1,128})\/?$/);
  if (u.origin !== config.onesOrigin || (expectedHref && u.href !== expectedHref) ||
      !route || route[1] !== config.teamUuid || !nedId(route[2])) return null;
  return {href:u.href,display:route[2]};
}
async function nedSaveState(value) { await chrome.storage.session.set({[NED_SESSION_KEY]:value}); }
async function nedLoadState() { return (await chrome.storage.session.get(NED_SESSION_KEY))?.[NED_SESSION_KEY] || null; }
async function nedRun(config, tabId) {
  if (nedInFlight) return nedRedacted('BLOCKED_IN_FLIGHT');
  nedInFlight = true;
  const tabTarget = {tabId};
  let run=null,armed=false,attached=false,insertCount=0;
  let pageRequest=null;
  let pending=null;
  let status='BLOCKED_PREFLIGHT';
  try {
    if (config.writeEnabled !== false || !nedId(config.rootCauseFieldId)) return nedRedacted('BLOCKED_WRITE_GATE_OR_FIELD');
    validatedOnesScope(config);
    const old=await nedLoadState();
    if (old?.pending && !old?.verified) return nedRedacted('BLOCKED_PENDING_SERVER_VERIFICATION');
    const target=await nedCurrentTab(config,tabId);
    if (!target) return nedRedacted('BLOCKED_TARGET_TAB');
    if (!await chrome.permissions.contains({origins:[config.onesOrigin+'/*']})) return nedRedacted('BLOCKED_ORIGIN_PERMISSION');
    run=crypto.randomUUID();
    const b=crypto.getRandomValues(new Uint8Array(6));
    const marker='NDP'+Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
    const req={href:target.href,origin:config.onesOrigin,team:config.teamUuid,
      display:target.display,field:config.rootCauseFieldId,run,marker};
    pageRequest=req;
    const ident=await nedExecuteScript(tabId,nedPageResolve,[req]);
    if (!nedId(ident?.taskUuid)) return nedRedacted('BLOCKED_TASK_IDENTITY');
    const taskUuid=ident.taskUuid;
    if (await nedAuthoritativeBlank(config,tabId,taskUuid,req.field)!=='BLANK') return nedRedacted('BLOCKED_PRE_READ');
    const start=await nedExecuteScript(tabId,nedPageControl,[{...req,action:'ARM'}]);
    if (!start?.ok) return nedPageFailure(start,'BLOCKED_EDITOR_PREPARE');
    armed=true;
    await nedWait(450);
    const before=await nedExecuteScript(tabId,nedPageControl,[{...req,action:'INSPECT',stage:'INSPECT_1'}]);
    if (!before?.ok) return nedPageFailure(before,'BLOCKED_EDITOR_UNSTABLE');
    if (await nedAuthoritativeBlank(config,tabId,taskUuid,req.field)!=='BLANK') return nedRedacted('BLOCKED_PRE_READ');
    const afterRead=await nedExecuteScript(tabId,nedPageControl,[{...req,action:'INSPECT',stage:'INSPECT_2'}]);
    if (!afterRead?.ok) return nedPageFailure(afterRead,'BLOCKED_EDITOR_UNSTABLE');
    if (!before.point || !afterRead.point ||
        Math.abs(before.point.x-afterRead.point.x)>2 || Math.abs(before.point.y-afterRead.point.y)>2) {
      return nedRedacted('BLOCKED_COORDINATE_DRIFT');
    }
    if (!await nedCurrentTab(config,tabId,req.href)) return nedRedacted('BLOCKED_NAVIGATION');
    pending={pending:true,verified:false,tabId,href:req.href,origin:config.onesOrigin,
      team:config.teamUuid,display:target.display,taskUuid,field:req.field,run};
    await nedSaveState(pending); // durable one-attempt barrier before any CDP command
    try { await chrome.debugger.attach(tabTarget,'1.3'); attached=true; }
    catch (_) { await nedSaveState({...pending,pending:false,verified:true}); return nedRedacted('BLOCKED_DEBUGGER_CONFLICT'); }
    const send=async (name,parameters)=>{
      if (!await nedCurrentTab(config,tabId,req.href)) throw new Error('NAVIGATION');
      await chrome.debugger.sendCommand(tabTarget,name,parameters);
    };
    const point=afterRead.point;
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
    const clicked=await nedExecuteScript(tabId,nedPageControl,[{...req,action:'AFTER_NATIVE_CLICK'}]);
    if (!clicked?.ok) return nedPageFailure(clicked,'BLOCKED_SELECTION_UNCERTAIN');
    if (!clicked.point || Math.abs(point.x-clicked.point.x)>2 || Math.abs(point.y-clicked.point.y)>2) {
      return nedRedacted('BLOCKED_COORDINATE_DRIFT',0,nedPhaseReceipt(clicked));
    }
    await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,nativeVirtualKeyCode:65});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,nativeVirtualKeyCode:65});
    await nedWait(80);
    const selected=await nedExecuteScript(tabId,nedPageControl,[{...req,action:'AFTER_CTRL_A'}]);
    if (!selected?.ok) return nedPageFailure(selected,'BLOCKED_SELECTION_UNCERTAIN');
    if (!selected.point || Math.abs(point.x-selected.point.x)>2 || Math.abs(point.y-selected.point.y)>2) {
      return nedRedacted('BLOCKED_COORDINATE_DRIFT',0,nedPhaseReceipt(selected));
    }
    const ready=await nedExecuteScript(tabId,nedPageControl,[{...req,action:'BEFORE_INSERT'}]);
    if (!ready?.ok) return nedPageFailure(ready,'BLOCKED_SELECTION_UNCERTAIN');
    if (!ready.point || Math.abs(point.x-ready.point.x)>2 || Math.abs(point.y-ready.point.y)>2) {
      return nedRedacted('BLOCKED_COORDINATE_DRIFT',0,nedPhaseReceipt(ready));
    }
    // Counts attempted sends, including an ambiguous rejection/timeout. Never retry.
    insertCount=1;
    await send('Input.insertText',{text:marker});
    await nedWait(2500);
    const result=await nedExecuteScript(tabId,nedPageControl,[{...req,action:'FINISH'}]);
    status=result?.status || 'TRACE_UNCERTAIN';
    if (!result?.trace) return nedRedacted('TRACE_UNCERTAIN',insertCount);
    const receipt=nedRedacted(status,insertCount,{trace:result.trace,...nedPhaseReceipt(ready),
      serverVerification:'PENDING_CANCEL_AND_INDEPENDENT_READ',
      warning:'SHAREDDOC_MAY_AUTOSYNC_CANCEL_IS_NOT_PROOF'});
    await nedSaveState({...pending,lastReceipt:receipt});
    return receipt;
  } catch (_) {
    // No raw browser/API/Chrome errors escape to popup or repository.
    return nedRedacted(insertCount?'TRACE_UNCERTAIN':'BLOCKED_UNCERTAIN',insertCount);
  } finally {
    if (armed && run) {
      try {const stored=await nedLoadState();
        if (stored?.run===run && !stored?.lastReceipt) await nedSaveState({...stored,lastReceipt:nedRedacted(status,insertCount)});
        // Pre-CDP rejection has no durable pending transaction, but must still
        // remove its exact-run local listeners. Cleanup never edits draft data.
        if (pageRequest) await nedExecuteScript(tabId,nedPageControl,[{...pageRequest,action:'CLEANUP'}]);
      } catch (_) {}
    }
    if (attached) {try {await chrome.debugger.detach(tabTarget);} catch (_) {}}
    nedInFlight=false;
  }
}
async function nedVerify(config,tabId) {
  if (nedInFlight) return nedRedacted('BLOCKED_IN_FLIGHT');
  nedInFlight=true;
  try {
    const old=await nedLoadState();
    if (!old?.pending || old.verified || old.tabId!==tabId || old.origin!==config.onesOrigin ||
        old.team!==config.teamUuid || old.field!==config.rootCauseFieldId) return nedRedacted('BLOCKED_NO_PENDING_DIAGNOSTIC');
    if (!await nedCurrentTab(config,tabId,old.href)) return nedRedacted('BLOCKED_TARGET_CHANGED');
    const state=await nedExecuteScript(tabId,nedPageControl,[{
      action:'CLOSED',href:old.href,origin:old.origin,team:old.team,display:old.display,field:old.field
    }]);
    if (state?.status!=='EDITOR_CLOSED') return nedRedacted('BLOCKED_CANCEL_NOT_OBSERVED');
    const a=await nedAuthoritativeBlank(config,tabId,old.taskUuid,old.field);
    await nedWait(750);
    const b=await nedAuthoritativeBlank(config,tabId,old.taskUuid,old.field);
    const status=(a==='NONEMPTY'||b==='NONEMPTY')?'SERVER_CHANGED_ESCALATE':
      (a==='BLANK'&&b==='BLANK')?'SERVER_BLANK_OBSERVED':'SERVER_UNVERIFIED';
    const receipt=nedRedacted(status,old.lastReceipt?.insertTextCount || 0,{
      ...nedPhaseReceipt(old.lastReceipt),serverVerification:status,warning:'CANCEL_DOES_NOT_PROVE_AUTOSYNC_ABSENT'});
    await nedSaveState({...old,pending:status!=='SERVER_BLANK_OBSERVED',
      verified:status==='SERVER_BLANK_OBSERVED',lastReceipt:receipt});
    return receipt;
  } catch (_) {return nedRedacted('SERVER_UNVERIFIED');}
  finally {nedInFlight=false;}
}

// Recording a failed preflight must not create a pending server transaction.
// For a native-click/insert attempt, keep the existing pending barrier and
// replace only its generic fallback receipt with the exact scrubbed outcome.
async function nedRunWithReceipt(config, tabId) {
  const before = await nedLoadState().catch(() => null);
  const receipt = await nedRun(config, tabId);
  if (receipt?.status === 'BLOCKED_IN_FLIGHT' ||
      receipt?.status === 'BLOCKED_PENDING_SERVER_VERIFICATION') return receipt;
  const status = typeof receipt?.status === 'string' &&
    /^(?:BLOCKED|TRACE|SERVER|DIAGNOSTIC|NOT_RUN)[A-Z0-9_]{0,80}$/.test(receipt.status)
      ? receipt.status : 'BLOCKED_UNCERTAIN';
  const savedReceipt = nedRedacted(status, receipt?.insertTextCount === 1 ? 1 : 0, {
    ...nedPhaseReceipt(receipt),
    serverVerification:receipt?.serverVerification || 'NOT_VERIFIED',
    ...(receipt?.trace ? {trace:receipt.trace} : {}),
    ...(receipt?.status === 'BLOCKED_DIRTY_DRAFT' && receipt.preflight ?
      {preflight:nedSafePreflight(receipt.preflight)} : {}),
    ...(receipt?.warning ? {warning:receipt.warning} : {})
  });
  try {
    const state = await nedLoadState();
    // Never modify an older, not-yet-verified transaction. A newly-created
    // pending run is identified by a different exact run token.
    if (state?.pending && state.run === before?.run) return receipt;
    if (state?.pending) await nedSaveState({...state,lastReceipt:savedReceipt});
    else await nedSaveState({pending:false,verified:false,lastReceipt:savedReceipt});
  } catch (_) { /* Storage failure does not authorize CDP or retries. */ }
  return receipt;
}
globalThis.onesNativeEditorDiagnosticRun = nedRunWithReceipt;
globalThis.onesNativeEditorDiagnosticVerify = nedVerify;
globalThis.onesNativeEditorDiagnosticLast = async () => {
  const state=await nedLoadState();
  if (!state) return nedRedacted('NOT_RUN');
  const receipt=state.lastReceipt || nedRedacted(state.pending?'DIAGNOSTIC_INTERRUPTED':'NOT_RUN');
  const pending=state.pending===true && state.verified!==true;
  return nedRedacted(receipt.status,receipt.insertTextCount||0,{
    ok:!pending && state.verified===true && receipt.status==='SERVER_BLANK_OBSERVED',
    trace:receipt.trace,
    ...nedPhaseReceipt(receipt),
    ...(receipt.status === 'BLOCKED_DIRTY_DRAFT' && receipt.preflight ?
      {preflight:nedSafePreflight(receipt.preflight)} : {}),
    serverVerification:state.verified===true?'SERVER_BLANK_OBSERVED':
      (pending?'PENDING_CANCEL_AND_INDEPENDENT_READ':receipt.serverVerification || 'NOT_VERIFIED'),
    pendingServerVerification:pending,
    interrupted:pending && !state.lastReceipt,
    warning:receipt.warning || (pending?'CANCEL_DOES_NOT_PROVE_AUTOSYNC_ABSENT':undefined)
  });
};
