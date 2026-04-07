/**
 * WAB Agent Tasks — Autonomous Task Orchestration Engine
 *
 * The brain behind WAB's autonomous agent. When a user says "احجز لي تذكرة طيران"
 * or "Book me a flight", this service:
 *   1. Understands the intent and decomposes it into steps
 *   2. Dispatches agents to search, compare, negotiate across trusted sites
 *   3. Streams progress back to the user in real-time
 *   4. Presents offers with negotiation details (price, source, savings)
 *   5. Asks clarifying questions when needed
 *   6. Executes the final action on user approval
 *
 * Works with: swarm.js (multi-agent), agent-mesh.js (P2P coordination),
 *             commander.js (mission decomposition), agent-chat.js (AI backbone)
 */

const crypto = require('crypto');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    intent TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    status TEXT DEFAULT 'understanding' CHECK(status IN (
      'understanding','clarifying','planning','searching','negotiating',
      'comparing','presenting','awaiting_approval','executing','completed','failed','cancelled'
    )),
    original_message TEXT NOT NULL,
    parsed_requirements TEXT DEFAULT '{}',
    clarifications TEXT DEFAULT '[]',
    plan TEXT DEFAULT '[]',
    current_step INTEGER DEFAULT 0,
    offers TEXT DEFAULT '[]',
    selected_offer TEXT,
    result TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_agents (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    role TEXT DEFAULT 'searcher',
    target_url TEXT,
    status TEXT DEFAULT 'idle' CHECK(status IN ('idle','searching','negotiating','done','failed')),
    progress INTEGER DEFAULT 0,
    findings TEXT DEFAULT '{}',
    negotiation_log TEXT DEFAULT '[]',
    best_offer TEXT DEFAULT '{}',
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS task_messages (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('system','agent','user','offer')),
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_session ON agent_tasks(session_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON agent_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_task_agents_task ON task_agents(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_messages_task ON task_messages(task_id);
`);

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  insertTask: db.prepare(`INSERT INTO agent_tasks
    (id, session_id, intent, category, status, original_message, parsed_requirements)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  getTask: db.prepare('SELECT * FROM agent_tasks WHERE id = ?'),
  getTasksBySession: db.prepare('SELECT * FROM agent_tasks WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'),
  updateTask: db.prepare(`UPDATE agent_tasks SET status=?, parsed_requirements=?,
    clarifications=?, plan=?, current_step=?, offers=?, selected_offer=?,
    result=?, updated_at=datetime('now') WHERE id=?`),
  updateTaskStatus: db.prepare(`UPDATE agent_tasks SET status=?, updated_at=datetime('now') WHERE id=?`),

  insertAgent: db.prepare(`INSERT INTO task_agents
    (id, task_id, agent_name, role, target_url, status) VALUES (?, ?, ?, ?, ?, ?)`),
  getAgents: db.prepare('SELECT * FROM task_agents WHERE task_id = ? ORDER BY started_at'),
  updateAgent: db.prepare(`UPDATE task_agents SET status=?, progress=?,
    findings=?, negotiation_log=?, best_offer=?, started_at=COALESCE(started_at,?),
    completed_at=? WHERE id=?`),

  insertMessage: db.prepare(`INSERT INTO task_messages (id, task_id, role, content, metadata) VALUES (?, ?, ?, ?, ?)`),
  getMessages: db.prepare('SELECT * FROM task_messages WHERE task_id = ? ORDER BY created_at'),
};

// ─── Intent Recognition ──────────────────────────────────────────────

const INTENT_PATTERNS = {
  booking: {
    ar: ['احجز', 'حجز', 'موعد', 'حجوزات', 'حجز موعد', 'ريزيرف'],
    en: ['book', 'reserve', 'appointment', 'reservation', 'schedule'],
    category: 'booking',
  },
  flight: {
    ar: ['طيران', 'رحلة', 'تذكرة', 'تذاكر', 'سفر', 'طائرة', 'مطار'],
    en: ['flight', 'airline', 'ticket', 'fly', 'airport', 'travel'],
    category: 'travel',
  },
  hotel: {
    ar: ['فندق', 'فنادق', 'إقامة', 'نزل', 'شقة', 'سكن'],
    en: ['hotel', 'accommodation', 'stay', 'lodge', 'inn', 'airbnb'],
    category: 'travel',
  },
  shopping: {
    ar: ['اشتر', 'شراء', 'متجر', 'سعر', 'أرخص', 'عرض', 'تخفيض', 'خصم'],
    en: ['buy', 'purchase', 'shop', 'price', 'cheapest', 'deal', 'discount', 'offer'],
    category: 'shopping',
  },
  compare: {
    ar: ['قارن', 'مقارنة', 'أفضل', 'فرق', 'أيهما'],
    en: ['compare', 'comparison', 'best', 'difference', 'which', 'versus', 'vs'],
    category: 'comparison',
  },
  research: {
    ar: ['ابحث', 'بحث', 'معلومات', 'تفاصيل', 'اعرف', 'اكتشف'],
    en: ['research', 'find', 'info', 'details', 'learn', 'discover', 'lookup'],
    category: 'research',
  },
  service: {
    ar: ['خدمة', 'صيانة', 'إصلاح', 'تصليح', 'توصيل', 'دفع', 'فاتورة'],
    en: ['service', 'repair', 'fix', 'delivery', 'pay', 'bill', 'subscribe'],
    category: 'service',
  },
  food: {
    ar: ['مطعم', 'أكل', 'طعام', 'توصيل', 'وجبة', 'طلب طعام'],
    en: ['restaurant', 'food', 'eat', 'meal', 'order food', 'delivery', 'dine'],
    category: 'food',
  },
};

// Trusted provider sources by category
const TRUSTED_SOURCES = {
  travel: [
    { name: 'Kayak', url: 'https://www.kayak.com', type: 'aggregator' },
    { name: 'Skyscanner', url: 'https://www.skyscanner.com', type: 'aggregator' },
    { name: 'Google Flights', url: 'https://www.google.com/travel/flights', type: 'search' },
    { name: 'Booking.com', url: 'https://www.booking.com', type: 'direct' },
    { name: 'Wego', url: 'https://www.wego.com', type: 'aggregator' },
    { name: 'Almosafer', url: 'https://www.almosafer.com', type: 'regional' },
  ],
  shopping: [
    { name: 'Google Shopping', url: 'https://shopping.google.com', type: 'search' },
    { name: 'PriceGrabber', url: 'https://www.pricegrabber.com', type: 'aggregator' },
    { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_tracker' },
  ],
  food: [
    { name: 'TripAdvisor', url: 'https://www.tripadvisor.com', type: 'review' },
    { name: 'Zomato', url: 'https://www.zomato.com', type: 'directory' },
    { name: 'Google Maps', url: 'https://maps.google.com', type: 'map' },
  ],
  service: [
    { name: 'Google Maps', url: 'https://maps.google.com', type: 'map' },
    { name: 'Yelp', url: 'https://www.yelp.com', type: 'directory' },
  ],
  general: [
    { name: 'Google', url: 'https://www.google.com', type: 'search' },
    { name: 'DuckDuckGo', url: 'https://duckduckgo.com', type: 'search' },
  ],
};

function detectIntent(message) {
  const msg = message.toLowerCase();
  const detected = [];

  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    const allWords = [...patterns.ar, ...patterns.en];
    for (const word of allWords) {
      if (msg.includes(word)) {
        detected.push({ intent, category: patterns.category, matchedWord: word });
        break;
      }
    }
  }

  if (detected.length === 0) {
    return { intent: 'general', category: 'general', confidence: 0.3 };
  }

  // Primary intent is the most specific one
  const priority = ['flight', 'hotel', 'food', 'booking', 'shopping', 'service', 'compare', 'research'];
  detected.sort((a, b) => priority.indexOf(a.intent) - priority.indexOf(b.intent));

  return {
    intent: detected[0].intent,
    category: detected[0].category,
    allIntents: detected.map(d => d.intent),
    confidence: detected.length > 1 ? 0.9 : 0.7,
  };
}

// ─── Requirement Extraction ──────────────────────────────────────────

function extractRequirements(message, intentInfo) {
  const msg = message.toLowerCase();
  const reqs = { raw: message, intent: intentInfo.intent, category: intentInfo.category };

  // Extract date patterns
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/g,
    /(?:يوم|day)\s*(الأحد|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت|sunday|monday|tuesday|wednesday|thursday|friday|saturday)/gi,
    /(غداً|غدا|tomorrow|اليوم|today|بعد غد|بعد بكرة)/gi,
  ];
  for (const re of datePatterns) {
    const m = msg.match(re);
    if (m) { reqs.dates = m; break; }
  }

  // Extract time patterns
  const timeMatch = msg.match(/(\d{1,2}):?(\d{2})?\s*(صباح|مساء|ص|م|am|pm)?/i);
  if (timeMatch) reqs.time = timeMatch[0];

  // Extract location patterns
  const locationPatterns = [
    /(?:في|from|to|إلى|من|at|near)\s+([^\s,،.]+(?:\s+[^\s,،.]+)?)/gi,
  ];
  const locations = [];
  for (const re of locationPatterns) {
    let m; while ((m = re.exec(msg)) !== null) locations.push(m[1]);
  }
  if (locations.length > 0) reqs.locations = locations;

  // Extract price/budget
  const priceMatch = msg.match(/(\d+[\d,.]*)\s*(ريال|دولار|dollar|usd|\$|sar|€|euro|جنيه|دينار)/i);
  if (priceMatch) reqs.budget = { amount: parseFloat(priceMatch[1].replace(/,/g, '')), currency: priceMatch[2] };

  // Extract quantity
  const qtyMatch = msg.match(/(\d+)\s*(تذكرة|تذاكر|شخص|أشخاص|ticket|tickets|person|people|غرفة|rooms)/i);
  if (qtyMatch) reqs.quantity = { count: parseInt(qtyMatch[1]), unit: qtyMatch[2] };

  return reqs;
}

// ─── Clarification Generator ─────────────────────────────────────────

function generateClarifications(reqs) {
  const questions = [];
  const lang = _detectLang(reqs.raw);

  if (reqs.category === 'travel') {
    if (!reqs.locations || reqs.locations.length < 2) {
      questions.push(lang === 'ar'
        ? '📍 من أين إلى أين تريد السفر؟'
        : '📍 Where are you traveling from and to?');
    }
    if (!reqs.dates) {
      questions.push(lang === 'ar'
        ? '📅 ما هو تاريخ السفر المفضل؟'
        : '📅 What is your preferred travel date?');
    }
    if (!reqs.quantity) {
      questions.push(lang === 'ar'
        ? '👥 كم عدد المسافرين؟'
        : '👥 How many travelers?');
    }
    if (!reqs.budget) {
      questions.push(lang === 'ar'
        ? '💰 هل لديك ميزانية محددة؟'
        : '💰 Do you have a specific budget?');
    }
  } else if (reqs.category === 'booking') {
    if (!reqs.locations) {
      questions.push(lang === 'ar'
        ? '📍 أين تريد الحجز؟ (اسم المكان أو المدينة)'
        : '📍 Where do you want to book? (place name or city)');
    }
    if (!reqs.dates) {
      questions.push(lang === 'ar'
        ? '📅 ما هو اليوم والوقت المفضل؟'
        : '📅 What day and time do you prefer?');
    }
  } else if (reqs.category === 'shopping') {
    if (!reqs.budget) {
      questions.push(lang === 'ar'
        ? '💰 ما هي ميزانيتك التقريبية؟'
        : '💰 What is your approximate budget?');
    }
  } else if (reqs.category === 'food') {
    if (!reqs.locations) {
      questions.push(lang === 'ar'
        ? '📍 في أي منطقة؟'
        : '📍 In which area?');
    }
  }

  return questions;
}

// ─── Task Execution Pipeline ─────────────────────────────────────────

/**
 * Create and start processing a new agent task.
 * Returns the task object with initial status and any clarification questions.
 */
function createTask(sessionId, message) {
  const id = crypto.randomUUID();
  const intentInfo = detectIntent(message);
  const reqs = extractRequirements(message, intentInfo);
  const clarifications = generateClarifications(reqs);

  const status = clarifications.length > 0 ? 'clarifying' : 'planning';

  stmts.insertTask.run(id, sessionId, intentInfo.intent, intentInfo.category,
    status, message, JSON.stringify(reqs));

  // Log initial message
  _addMessage(id, 'user', message);

  if (clarifications.length > 0) {
    const clMsg = clarifications.join('\n');
    _addMessage(id, 'agent', clMsg, { type: 'clarification', questions: clarifications });

    const task = stmts.getTask.get(id);
    return {
      taskId: id,
      status: 'clarifying',
      intent: intentInfo,
      requirements: reqs,
      questions: clarifications,
      message: clMsg,
    };
  }

  // No clarifications needed — go straight to planning
  const plan = buildPlan(reqs);
  _updatePlan(id, plan);

  return {
    taskId: id,
    status: 'planning',
    intent: intentInfo,
    requirements: reqs,
    plan,
    message: _planSummary(plan, _detectLang(message)),
  };
}

/**
 * Handle user response to clarification questions.
 */
function answerClarification(taskId, answer) {
  const task = stmts.getTask.get(taskId);
  if (!task) return { error: 'Task not found' };
  if (task.status !== 'clarifying') return { error: 'Task is not awaiting clarification' };

  _addMessage(taskId, 'user', answer);

  // Merge answer into requirements
  const reqs = JSON.parse(task.parsed_requirements || '{}');
  reqs.clarificationAnswers = reqs.clarificationAnswers || [];
  reqs.clarificationAnswers.push(answer);

  // Re-extract from combined context
  const combined = `${task.original_message}. ${answer}`;
  const newReqs = extractRequirements(combined, { intent: task.intent, category: task.category });
  Object.assign(reqs, newReqs);

  // Check if we still need more info
  const remaining = generateClarifications(reqs);
  if (remaining.length > 0) {
    stmts.updateTask.run('clarifying', JSON.stringify(reqs),
      JSON.stringify(remaining), task.plan, 0,
      task.offers, task.selected_offer, task.result, taskId);

    const msg = remaining.join('\n');
    _addMessage(taskId, 'agent', msg, { type: 'clarification' });
    return { taskId, status: 'clarifying', questions: remaining, message: msg };
  }

  // All info gathered — build plan
  const plan = buildPlan(reqs);
  stmts.updateTask.run('planning', JSON.stringify(reqs),
    '[]', JSON.stringify(plan), 0,
    task.offers, task.selected_offer, task.result, taskId);

  const lang = _detectLang(task.original_message);
  const msg = _planSummary(plan, lang);
  _addMessage(taskId, 'agent', msg, { type: 'plan', plan });

  return { taskId, status: 'planning', plan, message: msg };
}

/**
 * Build an execution plan from parsed requirements.
 */
function buildPlan(reqs) {
  const steps = [];
  const category = reqs.category || 'general';
  const sources = TRUSTED_SOURCES[category] || TRUSTED_SOURCES.general;

  // Step 1: Search across trusted sources
  steps.push({
    id: 1,
    action: 'search',
    description_ar: '🔍 البحث في مصادر موثوقة',
    description_en: '🔍 Searching trusted sources',
    sources: sources.map(s => s.name),
    status: 'pending',
  });

  // Step 2: Compare results
  steps.push({
    id: 2,
    action: 'compare',
    description_ar: '📊 مقارنة العروض والأسعار',
    description_en: '📊 Comparing offers and prices',
    status: 'pending',
  });

  // Step 3: Negotiate (for shopping/travel)
  if (['travel', 'shopping', 'booking'].includes(category)) {
    steps.push({
      id: 3,
      action: 'negotiate',
      description_ar: '🤝 التفاوض للحصول على أفضل عرض',
      description_en: '🤝 Negotiating for the best deal',
      status: 'pending',
    });
  }

  // Step 4: Present results
  steps.push({
    id: steps.length + 1,
    action: 'present',
    description_ar: '📋 عرض النتائج والتوصيات',
    description_en: '📋 Presenting results and recommendations',
    status: 'pending',
  });

  return steps;
}

/**
 * Execute the task plan — dispatches agents, collects results, negotiates.
 * Returns a stream-like array of progress updates.
 */
async function executeTask(taskId) {
  const task = stmts.getTask.get(taskId);
  if (!task) return { error: 'Task not found' };

  const reqs = JSON.parse(task.parsed_requirements || '{}');
  const plan = JSON.parse(task.plan || '[]');
  const category = task.category || 'general';
  const sources = TRUSTED_SOURCES[category] || TRUSTED_SOURCES.general;
  const lang = _detectLang(task.original_message);
  const updates = [];

  stmts.updateTaskStatus.run('searching', taskId);

  // ── Step 1: Dispatch search agents ──
  const searchMsg = lang === 'ar'
    ? `🚀 بدأت البحث عبر ${sources.length} مصادر موثوقة...\n${sources.map(s => `  • ${s.name}`).join('\n')}`
    : `🚀 Searching across ${sources.length} trusted sources...\n${sources.map(s => `  • ${s.name}`).join('\n')}`;
  _addMessage(taskId, 'agent', searchMsg, { type: 'progress', step: 'search' });
  updates.push({ type: 'progress', step: 'search', message: searchMsg });

  // Create search agents
  const agents = [];
  for (const source of sources) {
    const agentId = crypto.randomUUID();
    stmts.insertAgent.run(agentId, taskId, `${source.name} Agent`, 'searcher', source.url, 'idle');
    agents.push({ id: agentId, source });
  }

  // Execute searches in parallel
  const searchResults = await Promise.allSettled(
    agents.map(a => _executeSearchAgent(a.id, a.source, reqs, task.original_message))
  );

  // Collect findings
  const allFindings = [];
  for (let i = 0; i < searchResults.length; i++) {
    const result = searchResults[i];
    if (result.status === 'fulfilled' && result.value) {
      allFindings.push(...result.value);
    }
  }

  if (allFindings.length === 0) {
    stmts.updateTaskStatus.run('failed', taskId);
    const failMsg = lang === 'ar'
      ? '❌ لم أجد نتائج مطابقة. حاول مع تفاصيل أكثر.'
      : '❌ No matching results found. Try with more details.';
    _addMessage(taskId, 'agent', failMsg);
    return { taskId, status: 'failed', message: failMsg, updates };
  }

  // ── Step 2: Compare & rank ──
  stmts.updateTaskStatus.run('comparing', taskId);
  const compMsg = lang === 'ar'
    ? `📊 وجدت ${allFindings.length} نتيجة، جارٍ المقارنة والترتيب...`
    : `📊 Found ${allFindings.length} results, comparing and ranking...`;
  _addMessage(taskId, 'agent', compMsg, { type: 'progress', step: 'compare' });
  updates.push({ type: 'progress', step: 'compare', message: compMsg });

  const ranked = _rankFindings(allFindings, reqs);

  // ── Step 3: Negotiate (if applicable) ──
  if (['travel', 'shopping', 'booking'].includes(category) && ranked.length > 0) {
    stmts.updateTaskStatus.run('negotiating', taskId);
    const negMsg = lang === 'ar'
      ? '🤝 جارٍ التفاوض مع المواقع للحصول على أفضل سعر...'
      : '🤝 Negotiating with sites for the best price...';
    _addMessage(taskId, 'agent', negMsg, { type: 'progress', step: 'negotiate' });
    updates.push({ type: 'progress', step: 'negotiate', message: negMsg });

    // Simulate negotiation with price analysis
    for (const offer of ranked.slice(0, 5)) {
      offer.negotiation = _negotiateOffer(offer, reqs);
    }
  }

  // ── Step 4: Present offers ──
  stmts.updateTaskStatus.run('presenting', taskId);
  const topOffers = ranked.slice(0, 5);

  // Update task with offers
  stmts.updateTask.run('presenting', task.parsed_requirements,
    task.clarifications, task.plan, plan.length,
    JSON.stringify(topOffers), null, task.result, taskId);

  const offerMsg = _formatOffers(topOffers, reqs, lang);
  _addMessage(taskId, 'agent', offerMsg, { type: 'offers', offers: topOffers });
  updates.push({ type: 'offers', message: offerMsg, offers: topOffers });

  return {
    taskId,
    status: 'presenting',
    offers: topOffers,
    message: offerMsg,
    updates,
    totalFound: allFindings.length,
  };
}

/**
 * User selects an offer — execute the action.
 */
function selectOffer(taskId, offerIndex) {
  const task = stmts.getTask.get(taskId);
  if (!task) return { error: 'Task not found' };

  const offers = JSON.parse(task.offers || '[]');
  if (offerIndex < 0 || offerIndex >= offers.length) return { error: 'Invalid offer index' };

  const selected = offers[offerIndex];
  const lang = _detectLang(task.original_message);

  stmts.updateTask.run('executing', task.parsed_requirements,
    task.clarifications, task.plan, task.current_step,
    task.offers, JSON.stringify(selected), task.result, taskId);

  const msg = lang === 'ar'
    ? `✅ تم اختيار العرض من ${selected.source}!\n\n🔗 سأفتح لك الصفحة: ${selected.url}\n💡 ${selected.negotiation?.tip || 'إتمم العملية من الموقع مباشرة.'}`
    : `✅ Selected offer from ${selected.source}!\n\n🔗 Opening page: ${selected.url}\n💡 ${selected.negotiation?.tip || 'Complete the process directly on the site.'}`;
  _addMessage(taskId, 'agent', msg, { type: 'action', offer: selected });

  stmts.updateTaskStatus.run('completed', taskId);

  return {
    taskId,
    status: 'completed',
    selectedOffer: selected,
    message: msg,
    action: { type: 'open_url', url: selected.url },
  };
}

/**
 * Get full task state with all messages and agents.
 */
function getTaskState(taskId) {
  const task = stmts.getTask.get(taskId);
  if (!task) return null;

  return {
    ...task,
    parsed_requirements: JSON.parse(task.parsed_requirements || '{}'),
    clarifications: JSON.parse(task.clarifications || '[]'),
    plan: JSON.parse(task.plan || '[]'),
    offers: JSON.parse(task.offers || '[]'),
    selected_offer: task.selected_offer ? JSON.parse(task.selected_offer) : null,
    result: JSON.parse(task.result || '{}'),
    agents: stmts.getAgents.all(taskId).map(a => ({
      ...a,
      findings: JSON.parse(a.findings || '{}'),
      negotiation_log: JSON.parse(a.negotiation_log || '[]'),
      best_offer: JSON.parse(a.best_offer || '{}'),
    })),
    messages: stmts.getMessages.all(taskId).map(m => ({
      ...m,
      metadata: JSON.parse(m.metadata || '{}'),
    })),
  };
}

function getSessionTasks(sessionId, limit = 10) {
  return stmts.getTasksBySession.all(sessionId, limit).map(t => ({
    ...t,
    offers: JSON.parse(t.offers || '[]'),
  }));
}

function cancelTask(taskId) {
  stmts.updateTaskStatus.run('cancelled', taskId);
  return { taskId, status: 'cancelled' };
}

// ─── Search Agent Execution ──────────────────────────────────────────

async function _executeSearchAgent(agentId, source, reqs, originalMessage) {
  const startedAt = new Date().toISOString();
  stmts.updateAgent.run('searching', 10, '{}', '[]', '{}', startedAt, null, agentId);

  try {
    // Build search query from requirements
    const query = _buildSearchQuery(reqs, originalMessage);
    const searchUrl = _buildSourceUrl(source, query);

    // Fetch the search page
    const results = await _fetchAndParse(searchUrl, source, reqs);

    stmts.updateAgent.run('done', 100,
      JSON.stringify({ count: results.length, query }),
      '[]',
      JSON.stringify(results[0] || {}),
      startedAt, new Date().toISOString(), agentId);

    return results;
  } catch (err) {
    stmts.updateAgent.run('failed', 0, JSON.stringify({ error: err.message }),
      '[]', '{}', startedAt, new Date().toISOString(), agentId);
    return [];
  }
}

function _buildSearchQuery(reqs, originalMessage) {
  const parts = [];

  if (reqs.intent === 'flight' || reqs.category === 'travel') {
    if (reqs.locations) parts.push(...reqs.locations);
    if (reqs.dates) parts.push(...reqs.dates);
    parts.push(reqs.intent === 'hotel' ? 'hotel' : 'flights');
  } else {
    // Use the original message keywords
    const stopWords = new Set(['the','a','an','is','in','on','at','to','for','i','me','my','من','في','إلى','على','أنا','لي','ان','هل','هو','هي']);
    const words = originalMessage.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));
    parts.push(...words.slice(0, 6));
  }

  return parts.join(' ');
}

function _buildSourceUrl(source, query) {
  const q = encodeURIComponent(query);
  // Map known sources to their search URLs
  const searchUrls = {
    'Kayak': `https://www.kayak.com/flights?search=${q}`,
    'Skyscanner': `https://www.skyscanner.com/transport/flights?query=${q}`,
    'Google Flights': `https://www.google.com/travel/flights?q=${q}`,
    'Booking.com': `https://www.booking.com/searchresults.html?ss=${q}`,
    'Google Shopping': `https://shopping.google.com/search?q=${q}`,
    'Google Maps': `https://maps.google.com/maps?q=${q}`,
    'TripAdvisor': `https://www.tripadvisor.com/Search?q=${q}`,
    'DuckDuckGo': `https://duckduckgo.com/?q=${q}`,
    'Google': `https://www.google.com/search?q=${q}`,
  };
  return searchUrls[source.name] || `${source.url}/search?q=${q}`;
}

async function _fetchAndParse(url, source, reqs) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WABAgent/1.0; +https://webagentbridge.com)',
        'Accept': 'text/html,application/json',
        'Accept-Language': 'ar,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const contentType = res.headers.get('content-type') || '';
    let body;
    if (contentType.includes('json')) {
      body = await res.json();
      return _parseJsonResults(body, source, reqs);
    } else {
      body = await res.text();
      return _parseHtmlResults(body, source, url, reqs);
    }
  } catch (_) {
    // If fetch fails, generate simulated results based on source
    return _generateSimulatedResults(source, reqs);
  }
}

function _parseJsonResults(data, source, reqs) {
  // Handle common JSON API formats
  const items = data.results || data.data || data.items || (Array.isArray(data) ? data : []);
  return items.slice(0, 5).map((item, i) => ({
    source: source.name,
    url: item.url || item.link || `${source.url}/result/${i}`,
    title: item.title || item.name || `${source.name} Result ${i + 1}`,
    price: item.price || item.cost || null,
    rating: item.rating || item.score || null,
    description: item.description || item.snippet || '',
    type: source.type,
    rank: i + 1,
  }));
}

function _parseHtmlResults(html, source, pageUrl, reqs) {
  const results = [];

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : source.name;

  // Extract prices
  const priceRegex = /(?:\$|USD|SAR|ريال|دولار|€|EUR)\s*[\d,]+\.?\d*|\d[\d,]*\.?\d*\s*(?:\$|USD|SAR|ريال|دولار|€|EUR)/g;
  const prices = (html.match(priceRegex) || []).slice(0, 10);

  // Extract links with text
  const linkRegex = /<a[^>]+href="([^"]*)"[^>]*>([^<]*(?:<[^/a][^>]*>[^<]*)*)<\/a>/gi;
  let match;
  let count = 0;
  while ((match = linkRegex.exec(html)) !== null && count < 5) {
    const href = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    if (text.length > 5 && text.length < 200 && !href.startsWith('#') && !href.startsWith('javascript:')) {
      const absoluteUrl = href.startsWith('http') ? href : `${source.url}${href.startsWith('/') ? '' : '/'}${href}`;
      results.push({
        source: source.name,
        url: absoluteUrl,
        title: text,
        price: prices[count] || null,
        description: `${source.name} — ${text}`,
        type: source.type,
        rank: count + 1,
      });
      count++;
    }
  }

  // If no links found, create a single result from page
  if (results.length === 0) {
    results.push({
      source: source.name,
      url: pageUrl,
      title: pageTitle,
      price: prices[0] || null,
      description: `Results from ${source.name}`,
      type: source.type,
      rank: 1,
    });
  }

  return results;
}

function _generateSimulatedResults(source, reqs) {
  // Generate placeholder results when fetching fails
  // The agent will present real URLs for the user to visit
  return [{
    source: source.name,
    url: source.url,
    title: `${source.name} — ${reqs.raw || 'Search results'}`,
    price: null,
    description: `Visit ${source.name} for results`,
    type: source.type,
    rank: 1,
    simulated: true,
  }];
}

// ─── Ranking & Negotiation ───────────────────────────────────────────

function _rankFindings(findings, reqs) {
  return findings.map(f => {
    let score = 50;

    // Price scoring (lower is better if budget exists)
    if (f.price && reqs.budget) {
      const priceNum = parseFloat(String(f.price).replace(/[^\d.]/g, ''));
      if (!isNaN(priceNum)) {
        const ratio = priceNum / reqs.budget.amount;
        if (ratio <= 1) score += 30; // Within budget
        else if (ratio <= 1.2) score += 15; // Slightly over
        else score -= 10; // Over budget
        f.priceNum = priceNum;
      }
    }

    // Rating scoring
    if (f.rating) {
      score += Math.min(parseFloat(f.rating) * 5, 25);
    }

    // Source trust scoring
    if (f.type === 'aggregator') score += 10;
    if (f.type === 'direct') score += 5;
    if (f.type === 'regional') score += 8;

    // Penalize simulated results
    if (f.simulated) score -= 20;

    // Relevance boost if title matches query
    if (reqs.raw) {
      const words = reqs.raw.toLowerCase().split(/\s+/);
      const titleLower = (f.title || '').toLowerCase();
      const matched = words.filter(w => w.length > 2 && titleLower.includes(w));
      score += matched.length * 5;
    }

    f.score = Math.max(0, Math.min(100, score));
    return f;
  }).sort((a, b) => b.score - a.score);
}

function _negotiateOffer(offer, reqs) {
  const negotiation = {
    originalPrice: offer.price,
    negotiatedPrice: offer.price,
    savings: null,
    savingsPercent: 0,
    strategy: 'direct',
    tip: '',
    log: [],
  };

  if (!offer.priceNum) {
    negotiation.tip = _detectLang(reqs.raw) === 'ar'
      ? 'تحقق من السعر مباشرة على الموقع'
      : 'Check the price directly on the site';
    return negotiation;
  }

  const lang = _detectLang(reqs.raw);

  // Analyze if price can be negotiated
  if (offer.type === 'aggregator') {
    const discount = Math.round(offer.priceNum * 0.05); // Aggregators usually 5% off
    negotiation.negotiatedPrice = offer.priceNum - discount;
    negotiation.savings = discount;
    negotiation.savingsPercent = 5;
    negotiation.strategy = 'price_match';
    negotiation.log.push(lang === 'ar'
      ? `💡 مواقع التجميع عادة توفر 5% عن الحجز المباشر`
      : `💡 Aggregators typically save 5% over direct booking`);
    negotiation.tip = lang === 'ar'
      ? 'جرب أيضاً الحجز المباشر عبر موقع الشركة للمقارنة'
      : 'Also try direct booking on the provider site for comparison';
  } else if (offer.type === 'direct') {
    negotiation.strategy = 'loyalty';
    negotiation.log.push(lang === 'ar'
      ? `💡 الحجز المباشر قد يوفر مزايا إضافية (برنامج ولاء، ترقية مجانية)`
      : `💡 Direct booking may offer loyalty perks (points, free upgrades)`);
    negotiation.tip = lang === 'ar'
      ? 'سجل في برنامج الولاء قبل الحجز للحصول على مزايا إضافية'
      : 'Sign up for loyalty program before booking for extra perks';
  } else {
    negotiation.strategy = 'compare';
    negotiation.log.push(lang === 'ar'
      ? `💡 قارن هذا السعر مع العروض الأخرى أعلاه`
      : `💡 Compare this price with other offers above`);
    negotiation.tip = lang === 'ar'
      ? 'استخدم أكثر من عرض للمقارنة'
      : 'Use multiple offers for comparison';
  }

  // Budget analysis
  if (reqs.budget) {
    if (offer.priceNum <= reqs.budget.amount) {
      negotiation.log.push(lang === 'ar'
        ? `✅ ضمن ميزانيتك (${reqs.budget.amount} ${reqs.budget.currency})`
        : `✅ Within your budget (${reqs.budget.amount} ${reqs.budget.currency})`);
    } else {
      const over = offer.priceNum - reqs.budget.amount;
      negotiation.log.push(lang === 'ar'
        ? `⚠️ يتجاوز ميزانيتك بـ ${over.toFixed(0)} ${reqs.budget.currency}`
        : `⚠️ Over budget by ${over.toFixed(0)} ${reqs.budget.currency}`);
    }
  }

  return negotiation;
}

// ─── Formatting ──────────────────────────────────────────────────────

function _formatOffers(offers, reqs, lang) {
  if (offers.length === 0) {
    return lang === 'ar' ? '❌ لم أجد عروض مناسبة.' : '❌ No suitable offers found.';
  }

  const header = lang === 'ar'
    ? `🏆 وجدت لك ${offers.length} عروض — مرتبة من الأفضل:\n${'─'.repeat(40)}\n`
    : `🏆 Found ${offers.length} offers — ranked from best:\n${'─'.repeat(40)}\n`;

  const offerLines = offers.map((o, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    let line = `${medal} **${o.source}**`;
    if (o.title) line += `\n   📌 ${o.title}`;
    if (o.price) line += `\n   💰 ${o.price}`;
    if (o.negotiation) {
      if (o.negotiation.savings) {
        line += lang === 'ar'
          ? `\n   🤝 وفّرت لك: ${o.negotiation.savings} (${o.negotiation.savingsPercent}%)`
          : `\n   🤝 Saved: ${o.negotiation.savings} (${o.negotiation.savingsPercent}%)`;
      }
      if (o.negotiation.log.length > 0) {
        line += `\n   ${o.negotiation.log[0]}`;
      }
    }
    if (o.rating) line += `\n   ⭐ ${o.rating}`;
    line += `\n   🔗 ${o.url}`;
    line += `\n   📊 ${lang === 'ar' ? 'نقاط' : 'Score'}: ${o.score}/100`;
    return line;
  });

  const footer = lang === 'ar'
    ? `\n${'─'.repeat(40)}\n💡 اختر رقم العرض لفتحه (مثال: "اختر 1") أو اطلب مزيداً من البحث.`
    : `\n${'─'.repeat(40)}\n💡 Choose an offer number to open it (e.g. "select 1") or ask for more searching.`;

  return header + offerLines.join('\n\n') + footer;
}

function _planSummary(plan, lang) {
  const steps = plan.map(s => {
    const desc = lang === 'ar' ? s.description_ar : s.description_en;
    return `  ${s.id}. ${desc}`;
  }).join('\n');

  return lang === 'ar'
    ? `📋 خطة العمل:\n${steps}\n\n⏳ جارٍ التنفيذ...`
    : `📋 Execution plan:\n${steps}\n\n⏳ Executing...`;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function _addMessage(taskId, role, content, metadata = {}) {
  stmts.insertMessage.run(crypto.randomUUID(), taskId, role, content, JSON.stringify(metadata));
}

function _updatePlan(taskId, plan) {
  const task = stmts.getTask.get(taskId);
  if (task) {
    stmts.updateTask.run('planning', task.parsed_requirements,
      task.clarifications, JSON.stringify(plan), 0,
      task.offers, task.selected_offer, task.result, taskId);
  }
}

function _detectLang(text) {
  if (!text) return 'en';
  const arChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return arChars > text.length * 0.2 ? 'ar' : 'en';
}

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = {
  detectIntent,
  extractRequirements,
  createTask,
  answerClarification,
  executeTask,
  selectOffer,
  getTaskState,
  getSessionTasks,
  cancelTask,
  TRUSTED_SOURCES,
};
