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
  const route = location.pathname.match(/\/team\/([^/]+)\/.*\/issue\/([^/?#]+)/i);
  if (!route || route[1] !== expected.team || route[2] !== expected.display || !id(expected.display)) return null;
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
  const state = window[KEY];
  const fail = (status) => ({ok:false,status});
  const rootNow = () => {
    const all = [...document.querySelectorAll('div.standard-co-editor-editing.task-rich-text-edit')].filter(visible);
    const exact = all.filter((el) => el.id === request.field);
    return all.length === 1 && exact.length === 1 &&
      document.querySelectorAll('[id]').length >= 1 &&
      [...document.querySelectorAll('[id]')].filter((el) => el.id === request.field).length === 1 ? exact[0] : null;
  };
  const current = () => {
    if (location.href !== request.href || location.origin !== request.origin ||
        !location.pathname.includes('/team/' + request.team + '/') ||
        location.pathname.split('/issue/')[1]?.split('/')[0] !== request.display) return null;
    return rootNow();
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
    if (!root) return fail('BLOCKED_EDITOR_NOT_UNIQUE');
    const blocks = [...root.querySelectorAll('.text-block[data-type="editor-block"][data-block-type="text"]')].filter(visible);
    const focused = blocks.filter((el) => el.classList.contains('focused'));
    if (blocks.length < 1 || focused.length !== 1) return fail('BLOCKED_FOCUSED_BLOCK_NOT_UNIQUE');
    if (blocks.some((el) => normalize(el.textContent) !== '')) return fail('BLOCKED_DIRTY_DRAFT');
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
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const focus = selection?.focusNode;
    if (!selection || selection.rangeCount !== 1 || !selection.isCollapsed ||
        !anchor || !focus || !block.contains(anchor) || !block.contains(focus)) return fail('BLOCKED_SELECTION');
    const next = {run:request.run, root, block, host:editorHost, hostKind, focusDeferred, marker:request.marker,
      href:request.href, team:request.team, field:request.field, display:request.display,
      started:Date.now(), samples:[], events:[], pending:Promise.resolve(), listeners:[], changed:0, inserted:false};
    const sample = (kind) => {
      const t = Date.now() - next.started;
      const values = [...root.querySelectorAll('.text-block[data-type="editor-block"][data-block-type="text"]')].filter(visible).map((el) => normalize(el.textContent));
      const bound = block.isConnected && root.contains(block);
      next.pending = next.pending.then(async () => {
        const blocks = await Promise.all(values.map(async (text) => ({length:text.length,sha256:await digest(text)})));
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
    return {ok:true,status:'ARMED'};
  }
  if (!state || state.run !== request.run) return fail('BLOCKED_STALE_SESSION');
  const root = current();
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
  // AFTER_SELECT must prove the native click reacquired the exact bound host.
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
  const selection = window.getSelection();
  if (!finishing && (!selection || selection.rangeCount !== 1 || !selection.isCollapsed ||
      !state.block.contains(selection.anchorNode) || !state.block.contains(selection.focusNode))) return fail('BLOCKED_SELECTION_DRIFT');
  const offset = (node, local) => {
    try { const r = document.createRange(); r.selectNodeContents(state.block); r.setEnd(node,local); return r.toString().length; }
    catch (_) { return null; }
  };
  const anchorOffset = selection ? offset(selection.anchorNode,selection.anchorOffset) : null;
  const focusOffset = selection ? offset(selection.focusNode,selection.focusOffset) : null;
  if (!finishing && (anchorOffset === null || focusOffset === null)) return fail('BLOCKED_SELECTION_DRIFT');
  if (request.action === 'INSPECT') {
    if (blocks.some((el) => normalize(el.textContent) !== '')) return fail('BLOCKED_DIRTY_DRAFT');
    state.sample('PREFLIGHT');
    return {ok:true,status:'READY',point:{x,y},blockCount:blocks.length,focusedCount:focused.length,
      anchorOffset,focusOffset,collapsed:true,hostKind:state.hostKind,focusDeferred:state.focusDeferred,elapsedMs:Date.now()-state.started};
  }
  if (request.action === 'AFTER_SELECT') {
    if (blocks.some((el) => normalize(el.textContent) !== '')) return fail('BLOCKED_DIRTY_DRAFT');
    state.sample('AFTER_SELECT');
    return {ok:true,status:'SELECTION_READY',point:{x,y},anchorOffset,focusOffset,collapsed:true};
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
    mutationCount:state.changed,selection:{anchorOffset,focusOffset,collapsed:true},
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
async function nedCurrentTab(config, tabId, expectedHref) {
  const active = await chrome.tabs.query({active:true,currentWindow:true});
  if (active.length !== 1 || active[0].id !== tabId) return null;
  const tab = await chrome.tabs.get(tabId);
  if (!tab || tab.status === 'loading' || !tab.url || tab.url !== active[0].url) return null;
  const u = new URL(tab.url);
  if (u.origin !== config.onesOrigin || (expectedHref && u.href !== expectedHref) ||
      !u.pathname.includes('/team/' + config.teamUuid + '/')) return null;
  const m = u.pathname.match(/\/issue\/([^/?#]+)/i);
  if (!m || !nedId(m[1])) return null;
  return {href:u.href,display:m[1]};
}
async function nedSaveState(value) { await chrome.storage.session.set({[NED_SESSION_KEY]:value}); }
async function nedLoadState() { return (await chrome.storage.session.get(NED_SESSION_KEY))?.[NED_SESSION_KEY] || null; }
async function nedRun(config, tabId) {
  if (nedInFlight) return nedRedacted('BLOCKED_IN_FLIGHT');
  nedInFlight = true;
  const tabTarget = {tabId};
  let run=null,armed=false,attached=false,insertCount=0;
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
    const ident=await nedExecuteScript(tabId,nedPageResolve,[req]);
    if (!nedId(ident?.taskUuid)) return nedRedacted('BLOCKED_TASK_IDENTITY');
    const taskUuid=ident.taskUuid;
    if (await nedAuthoritativeBlank(config,tabId,taskUuid,req.field)!=='BLANK') return nedRedacted('BLOCKED_PRE_READ');
    const start=await nedExecuteScript(tabId,nedPageControl,[{...req,action:'ARM'}]);
    if (!start?.ok) return nedRedacted(start?.status || 'BLOCKED_EDITOR_PREPARE');
    armed=true;
    await nedWait(450);
    const before=await nedExecuteScript(tabId,nedPageControl,[{...req,action:'INSPECT'}]);
    if (!before?.ok) return nedRedacted(before?.status || 'BLOCKED_EDITOR_UNSTABLE');
    if (await nedAuthoritativeBlank(config,tabId,taskUuid,req.field)!=='BLANK') return nedRedacted('BLOCKED_PRE_READ');
    const afterRead=await nedExecuteScript(tabId,nedPageControl,[{...req,action:'INSPECT'}]);
    if (!afterRead?.ok || !before.point || !afterRead.point ||
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
    await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,nativeVirtualKeyCode:65});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,nativeVirtualKeyCode:65});
    await nedWait(80);
    const selected=await nedExecuteScript(tabId,nedPageControl,[{...req,action:'AFTER_SELECT'}]);
    if (!selected?.ok || Math.abs(point.x-selected.point?.x)>2 || Math.abs(point.y-selected.point?.y)>2) {
      status='BLOCKED_SELECTION_OR_GEOMETRY';
      return nedRedacted(status);
    }
    // Counts attempted sends, including an ambiguous rejection/timeout. Never retry.
    insertCount=1;
    await send('Input.insertText',{text:marker});
    await nedWait(2500);
    const result=await nedExecuteScript(tabId,nedPageControl,[{...req,action:'FINISH'}]);
    status=result?.status || 'TRACE_UNCERTAIN';
    if (!result?.trace) return nedRedacted('TRACE_UNCERTAIN',insertCount);
    const receipt=nedRedacted(status,insertCount,{trace:result.trace,
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
        // cleanup uses exact run only; cannot touch another instrumented editor
        const s=await nedLoadState();
        if (s?.href && s?.field) await nedExecuteScript(tabId,nedPageControl,[{
          action:'CLEANUP',run,href:s.href,origin:s.origin,team:s.team,display:s.display,field:s.field
        }]);
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
      serverVerification:status,warning:'CANCEL_DOES_NOT_PROVE_AUTOSYNC_ABSENT'});
    await nedSaveState({...old,pending:status!=='SERVER_BLANK_OBSERVED',
      verified:status==='SERVER_BLANK_OBSERVED',lastReceipt:receipt});
    return receipt;
  } catch (_) {return nedRedacted('SERVER_UNVERIFIED');}
  finally {nedInFlight=false;}
}

globalThis.onesNativeEditorDiagnosticRun = nedRun;
globalThis.onesNativeEditorDiagnosticVerify = nedVerify;
globalThis.onesNativeEditorDiagnosticLast = async () => {
  const state=await nedLoadState();
  if (!state) return nedRedacted('NOT_RUN');
  const receipt=state.lastReceipt || nedRedacted(state.pending?'DIAGNOSTIC_INTERRUPTED':'NOT_RUN');
  const pending=state.pending===true && state.verified!==true;
  return nedRedacted(receipt.status,receipt.insertTextCount||0,{
    trace:receipt.trace,
    serverVerification:state.verified===true?'SERVER_BLANK_OBSERVED':
      (receipt.serverVerification==='SERVER_CHANGED_ESCALATE'?'SERVER_CHANGED_ESCALATE':'PENDING_CANCEL_AND_INDEPENDENT_READ'),
    pendingServerVerification:pending,
    interrupted:pending && !state.lastReceipt,
    warning:receipt.warning || (pending?'CANCEL_DOES_NOT_PROVE_AUTOSYNC_ABSENT':undefined)
  });
};
