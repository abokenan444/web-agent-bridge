'use strict';

/**
 * Learning from Demonstration (LfD) Engine
 *
 * Records user actions on web pages, converts them to replayable recipes,
 * and enables agents to learn from human demonstrations.
 *
 * Flow:
 * 1. User starts a recording session
 * 2. Browser captures events (clicks, typing, navigation, scrolls)
 * 3. Each event includes DOM snapshot + screenshot hash + element info
 * 4. Session is saved as a "Recipe" (YAML/JSON task template)
 * 5. Recipes can be replayed by agents on the same or similar sites
 * 6. Recipes can be shared via the Marketplace
 */

const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════
// RECORDING SESSION
// ═══════════════════════════════════════════════════════════════════

class RecordingSession {
  constructor(config = {}) {
    this.id = crypto.randomUUID();
    this.name = config.name || 'Untitled Recording';
    this.description = config.description || '';
    this.agentId = config.agentId || null;
    this.startUrl = config.startUrl || '';
    this.status = 'recording'; // recording | paused | completed | cancelled
    this.events = [];
    this.snapshots = []; // DOM snapshots at key moments
    this.metadata = {
      startedAt: Date.now(),
      completedAt: null,
      duration: 0,
      pageCount: 0,
      actionCount: 0,
      domain: '',
      tags: config.tags || [],
    };
    try { this.metadata.domain = new URL(config.startUrl).hostname; } catch {}
  }

  /**
   * Record a user action event
   */
  addEvent(event) {
    if (this.status !== 'recording') return null;

    const recorded = {
      id: `evt-${this.events.length}`,
      seq: this.events.length,
      timestamp: Date.now(),
      relativeTime: Date.now() - this.metadata.startedAt,
      type: event.type, // click | type | navigate | scroll | select | hover | wait | assert
      target: {
        selector: event.selector || '',
        xpath: event.xpath || '',
        text: (event.text || '').slice(0, 200),
        tag: event.tag || '',
        attributes: event.attributes || {},
        rect: event.rect || {},
      },
      data: {}, // type-specific data
      url: event.url || '',
      pageTitle: event.pageTitle || '',
      screenshot: event.screenshotHash || null,
    };

    // Type-specific data
    switch (event.type) {
      case 'click':
        recorded.data = { x: event.x, y: event.y, button: event.button || 'left', doubleClick: !!event.doubleClick };
        break;
      case 'type':
        recorded.data = { value: event.value || '', key: event.key || '', clearFirst: !!event.clearFirst };
        break;
      case 'navigate':
        recorded.data = { url: event.url || '', method: event.method || 'goto' };
        this.metadata.pageCount++;
        break;
      case 'scroll':
        recorded.data = { x: event.scrollX || 0, y: event.scrollY || 0, direction: event.direction || 'down' };
        break;
      case 'select':
        recorded.data = { value: event.value || '', label: event.label || '', index: event.index };
        break;
      case 'hover':
        recorded.data = { duration: event.duration || 0 };
        break;
      case 'wait':
        recorded.data = { ms: event.ms || 1000, condition: event.condition || 'delay' };
        break;
      case 'assert':
        recorded.data = { assertion: event.assertion || '', expected: event.expected };
        break;
      case 'keypress':
        recorded.data = { key: event.key || '', modifiers: event.modifiers || [] };
        break;
    }

    this.events.push(recorded);
    this.metadata.actionCount = this.events.length;
    return recorded;
  }

  /**
   * Add a DOM snapshot at a key moment
   */
  addSnapshot(snapshot) {
    if (this.status !== 'recording') return;
    this.snapshots.push({
      seq: this.snapshots.length,
      timestamp: Date.now(),
      url: snapshot.url || '',
      title: snapshot.title || '',
      domHash: snapshot.domHash || '',
      elementCount: snapshot.elementCount || 0,
      interactiveElements: snapshot.interactiveElements || [],
    });
  }

  pause() { if (this.status === 'recording') this.status = 'paused'; }
  resume() { if (this.status === 'paused') this.status = 'recording'; }

  complete() {
    this.status = 'completed';
    this.metadata.completedAt = Date.now();
    this.metadata.duration = this.metadata.completedAt - this.metadata.startedAt;
  }

  cancel() {
    this.status = 'cancelled';
    this.metadata.completedAt = Date.now();
  }

  /**
   * Convert recording to a replayable Recipe
   */
  toRecipe() {
    return {
      id: crypto.randomUUID(),
      name: this.name,
      description: this.description,
      version: '1.0.0',
      sourceRecording: this.id,
      domain: this.metadata.domain,
      startUrl: this.startUrl,
      tags: this.metadata.tags,
      created: new Date().toISOString(),
      steps: this.events.map(evt => this._eventToStep(evt)),
      metadata: {
        recordedBy: this.agentId,
        duration: this.metadata.duration,
        pageCount: this.metadata.pageCount,
        actionCount: this.metadata.actionCount,
      },
    };
  }

  _eventToStep(evt) {
    const step = {
      seq: evt.seq,
      action: evt.type,
      selector: evt.target.selector,
      description: this._describeStep(evt),
      wait: { before: 0, after: 200 }, // Default delays
      retry: { maxAttempts: 3, delay: 500 },
      fallback: {},
    };

    // Add fallback selectors
    if (evt.target.text) step.fallback.text = evt.target.text;
    if (evt.target.xpath) step.fallback.xpath = evt.target.xpath;
    if (evt.target.attributes?.['aria-label']) step.fallback.ariaLabel = evt.target.attributes['aria-label'];

    switch (evt.type) {
      case 'click':
        step.options = { button: evt.data.button, doubleClick: evt.data.doubleClick };
        break;
      case 'type':
        step.value = evt.data.value;
        step.options = { clearFirst: evt.data.clearFirst };
        break;
      case 'navigate':
        step.url = evt.data.url;
        step.options = { method: evt.data.method };
        break;
      case 'scroll':
        step.options = { x: evt.data.x, y: evt.data.y, direction: evt.data.direction };
        break;
      case 'select':
        step.value = evt.data.value;
        step.options = { label: evt.data.label };
        break;
      case 'wait':
        step.options = { ms: evt.data.ms, condition: evt.data.condition };
        break;
      case 'assert':
        step.options = { assertion: evt.data.assertion, expected: evt.data.expected };
        break;
      case 'keypress':
        step.options = { key: evt.data.key, modifiers: evt.data.modifiers };
        break;
    }

    return step;
  }

  _describeStep(evt) {
    const target = evt.target.text ? `"${evt.target.text.slice(0, 50)}"` : evt.target.selector;
    switch (evt.type) {
      case 'click': return `Click on ${target}`;
      case 'type': return `Type "${(evt.data.value || '').slice(0, 30)}" into ${target}`;
      case 'navigate': return `Navigate to ${evt.data.url}`;
      case 'scroll': return `Scroll ${evt.data.direction}`;
      case 'select': return `Select "${evt.data.label || evt.data.value}" in ${target}`;
      case 'hover': return `Hover over ${target}`;
      case 'wait': return `Wait ${evt.data.ms}ms`;
      case 'assert': return `Assert ${evt.data.assertion}`;
      case 'keypress': return `Press ${evt.data.modifiers?.length ? evt.data.modifiers.join('+') + '+' : ''}${evt.data.key}`;
      default: return `${evt.type} on ${target}`;
    }
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      agentId: this.agentId,
      startUrl: this.startUrl,
      status: this.status,
      events: this.events,
      snapshots: this.snapshots,
      metadata: this.metadata,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// RECIPE EXECUTOR — Replays recorded recipes
// ═══════════════════════════════════════════════════════════════════

class RecipeExecutor {
  constructor() {
    this.executions = new Map();
  }

  /**
   * Start executing a recipe
   * Returns an execution plan that can be consumed step-by-step
   */
  startExecution(recipe, options = {}) {
    const execution = {
      id: crypto.randomUUID(),
      recipeId: recipe.id,
      recipeName: recipe.name,
      status: 'running', // running | paused | completed | failed | aborted
      currentStep: 0,
      totalSteps: recipe.steps.length,
      startedAt: Date.now(),
      completedAt: null,
      results: [],
      variables: options.variables || {},
      config: {
        speed: options.speed || 1.0,         // Playback speed multiplier
        stopOnError: options.stopOnError !== false,
        skipWaits: !!options.skipWaits,
        adaptiveSelectors: options.adaptiveSelectors !== false, // Try fallbacks
        maxRetries: options.maxRetries || 3,
        humanInTheLoop: !!options.humanInTheLoop, // Pause on sensitive actions
      },
      steps: recipe.steps.map(s => ({ ...s })), // Clone steps
      errors: [],
    };

    // Variable substitution in steps
    if (Object.keys(execution.variables).length > 0) {
      for (const step of execution.steps) {
        if (step.value) step.value = this._substituteVars(step.value, execution.variables);
        if (step.url) step.url = this._substituteVars(step.url, execution.variables);
      }
    }

    this.executions.set(execution.id, execution);
    return execution;
  }

  /**
   * Get next step to execute
   */
  getNextStep(executionId) {
    const exec = this.executions.get(executionId);
    if (!exec || exec.status !== 'running') return null;
    if (exec.currentStep >= exec.totalSteps) {
      exec.status = 'completed';
      exec.completedAt = Date.now();
      return null;
    }

    const step = exec.steps[exec.currentStep];
    const sensitiveActions = ['type']; // Actions that might need human approval
    if (exec.config.humanInTheLoop && sensitiveActions.includes(step.action)) {
      step._requiresApproval = true;
    }

    return { ...step, executionId, stepIndex: exec.currentStep };
  }

  /**
   * Report step result
   */
  reportStepResult(executionId, stepIndex, result) {
    const exec = this.executions.get(executionId);
    if (!exec) return null;

    exec.results[stepIndex] = {
      stepIndex,
      action: exec.steps[stepIndex]?.action,
      success: result.success,
      error: result.error || null,
      duration: result.duration || 0,
      timestamp: Date.now(),
      selectorUsed: result.selectorUsed || exec.steps[stepIndex]?.selector,
    };

    if (result.success) {
      exec.currentStep = stepIndex + 1;
    } else {
      exec.errors.push({ stepIndex, error: result.error, timestamp: Date.now() });
      if (exec.config.stopOnError) {
        exec.status = 'failed';
        exec.completedAt = Date.now();
      } else {
        exec.currentStep = stepIndex + 1;
      }
    }

    // Auto-complete if done
    if (exec.currentStep >= exec.totalSteps && exec.status === 'running') {
      exec.status = 'completed';
      exec.completedAt = Date.now();
    }

    return exec;
  }

  pauseExecution(executionId) {
    const exec = this.executions.get(executionId);
    if (exec && exec.status === 'running') exec.status = 'paused';
    return exec;
  }

  resumeExecution(executionId) {
    const exec = this.executions.get(executionId);
    if (exec && exec.status === 'paused') exec.status = 'running';
    return exec;
  }

  abortExecution(executionId) {
    const exec = this.executions.get(executionId);
    if (exec) { exec.status = 'aborted'; exec.completedAt = Date.now(); }
    return exec;
  }

  getExecution(executionId) { return this.executions.get(executionId) || null; }

  listExecutions(limit = 50) {
    return [...this.executions.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  _substituteVars(str, vars) {
    if (typeof str !== 'string') return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`);
  }

  getStats() {
    const execs = [...this.executions.values()];
    return {
      total: execs.length,
      running: execs.filter(e => e.status === 'running').length,
      completed: execs.filter(e => e.status === 'completed').length,
      failed: execs.filter(e => e.status === 'failed').length,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// LfD ENGINE — Manages recordings, recipes, and executions
// ═══════════════════════════════════════════════════════════════════

class LfdEngine {
  constructor() {
    this.sessions = new Map();    // Active recording sessions
    this.recipes = new Map();     // Saved recipes
    this.executor = new RecipeExecutor();
    this.stats = {
      totalRecordings: 0,
      totalRecipes: 0,
      totalExecutions: 0,
      totalEvents: 0,
    };
  }

  // ── Recording ──

  startRecording(config) {
    const session = new RecordingSession(config);
    this.sessions.set(session.id, session);
    this.stats.totalRecordings++;
    return { id: session.id, status: session.status, startedAt: session.metadata.startedAt };
  }

  recordEvent(sessionId, event) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Recording session not found');
    const recorded = session.addEvent(event);
    if (recorded) this.stats.totalEvents++;
    return recorded;
  }

  recordSnapshot(sessionId, snapshot) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Recording session not found');
    session.addSnapshot(snapshot);
  }

  pauseRecording(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Recording session not found');
    session.pause();
    return { id: sessionId, status: session.status };
  }

  resumeRecording(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Recording session not found');
    session.resume();
    return { id: sessionId, status: session.status };
  }

  stopRecording(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Recording session not found');
    session.complete();

    // Auto-convert to recipe
    const recipe = session.toRecipe();
    this.recipes.set(recipe.id, recipe);
    this.stats.totalRecipes++;

    return { recording: session.toJSON(), recipe };
  }

  cancelRecording(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Recording session not found');
    session.cancel();
    return { id: sessionId, status: 'cancelled' };
  }

  getRecording(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return session.toJSON();
  }

  listRecordings(limit = 50) {
    return [...this.sessions.values()]
      .map(s => ({
        id: s.id, name: s.name, status: s.status, domain: s.metadata.domain,
        actionCount: s.metadata.actionCount, duration: s.metadata.duration,
        startedAt: s.metadata.startedAt,
      }))
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  // ── Recipes ──

  saveRecipe(recipe) {
    if (!recipe.id) recipe.id = crypto.randomUUID();
    if (!recipe.created) recipe.created = new Date().toISOString();
    this.recipes.set(recipe.id, recipe);
    this.stats.totalRecipes++;
    return recipe;
  }

  getRecipe(recipeId) { return this.recipes.get(recipeId) || null; }

  listRecipes(filters = {}, limit = 50) {
    let recipes = [...this.recipes.values()];
    if (filters.domain) recipes = recipes.filter(r => r.domain === filters.domain);
    if (filters.tag) recipes = recipes.filter(r => r.tags?.includes(filters.tag));
    if (filters.query) {
      const q = filters.query.toLowerCase();
      recipes = recipes.filter(r =>
        r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q)
      );
    }
    return recipes.sort((a, b) => new Date(b.created) - new Date(a.created)).slice(0, limit);
  }

  deleteRecipe(recipeId) {
    return this.recipes.delete(recipeId);
  }

  // ── Execution ──

  executeRecipe(recipeId, options = {}) {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) throw new Error('Recipe not found');
    this.stats.totalExecutions++;
    return this.executor.startExecution(recipe, options);
  }

  getNextStep(executionId) { return this.executor.getNextStep(executionId); }
  reportStep(executionId, stepIndex, result) { return this.executor.reportStepResult(executionId, stepIndex, result); }
  pauseExecution(executionId) { return this.executor.pauseExecution(executionId); }
  resumeExecution(executionId) { return this.executor.resumeExecution(executionId); }
  abortExecution(executionId) { return this.executor.abortExecution(executionId); }
  getExecution(executionId) { return this.executor.getExecution(executionId); }
  listExecutions(limit) { return this.executor.listExecutions(limit); }

  // ── Stats ──

  getStats() {
    return {
      ...this.stats,
      activeRecordings: [...this.sessions.values()].filter(s => s.status === 'recording').length,
      savedRecipes: this.recipes.size,
      executorStats: this.executor.getStats(),
    };
  }

  /**
   * Client-side recording script — inject into pages to capture user actions
   */
  getRecordingScript(sessionId, serverUrl) {
    return `(function(){
  var SID='${sessionId}',API='${serverUrl || ''}/api/os/lfd';
  var q=[];var sending=false;

  function send(evt){
    evt.url=location.href;evt.pageTitle=document.title;
    if(API){
      q.push(evt);if(!sending){flush();}
    }
  }

  function flush(){
    if(q.length===0){sending=false;return;}
    sending=true;var batch=q.splice(0,10);
    fetch(API+'/'+SID+'/events',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({events:batch})}).catch(function(){}).finally(function(){setTimeout(flush,100);});
  }

  function sel(el){
    if(!el||el===document)return'body';
    if(el.id)return'#'+CSS.escape(el.id);
    var t=el.tagName?.toLowerCase()||'';var c=el.className;
    if(c&&typeof c==='string'){var cls=c.trim().split(/\\s+/).slice(0,2).map(function(x){return'.'+CSS.escape(x);}).join('');if(cls)t+=cls;}
    return t||'unknown';
  }

  function attrs(el){
    var a={};if(!el||!el.attributes)return a;
    ['id','class','href','type','name','placeholder','role','aria-label','value','alt'].forEach(function(n){
      if(el.hasAttribute(n))a[n]=el.getAttribute(n);
    });return a;
  }

  function rect(el){if(!el)return{};var r=el.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};}

  document.addEventListener('click',function(e){
    send({type:'click',selector:sel(e.target),tag:e.target.tagName?.toLowerCase(),text:(e.target.textContent||'').trim().substring(0,100),
      attributes:attrs(e.target),rect:rect(e.target),x:e.clientX,y:e.clientY,button:e.button===0?'left':'right'});
  },true);

  document.addEventListener('input',function(e){
    if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){
      send({type:e.target.tagName==='SELECT'?'select':'type',selector:sel(e.target),tag:e.target.tagName.toLowerCase(),
        text:(e.target.labels?.[0]?.textContent||e.target.placeholder||'').substring(0,100),
        attributes:attrs(e.target),rect:rect(e.target),value:e.target.value?.substring(0,200)});
    }
  },true);

  document.addEventListener('keydown',function(e){
    if(['Enter','Escape','Tab','Backspace','Delete'].includes(e.key)||e.ctrlKey||e.metaKey){
      send({type:'keypress',key:e.key,modifiers:[e.ctrlKey&&'ctrl',e.shiftKey&&'shift',e.altKey&&'alt',e.metaKey&&'meta'].filter(Boolean),
        selector:sel(e.target),tag:e.target.tagName?.toLowerCase(),attributes:attrs(e.target)});
    }
  },true);

  var lastScroll=0;
  window.addEventListener('scroll',function(){
    var now=Date.now();if(now-lastScroll<500)return;lastScroll=now;
    send({type:'scroll',scrollX:window.scrollX,scrollY:window.scrollY,direction:window.scrollY>0?'down':'up'});
  },true);

  // Navigation detection
  var lastUrl=location.href;
  setInterval(function(){if(location.href!==lastUrl){send({type:'navigate',url:location.href,method:'spa'});lastUrl=location.href;}},500);

  console.log('[WAB LfD] Recording started — session '+SID);
})();`;
  }
}

const lfdEngine = new LfdEngine();
module.exports = { lfdEngine, LfdEngine, RecordingSession, RecipeExecutor };
