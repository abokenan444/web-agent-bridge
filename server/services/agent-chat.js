/**
 * WAB Agent Chat — Real AI Agent Service
 *
 * Multi-backend AI agent that powers the WAB Browser chat.
 * Priority: OpenAI API → Local AI (Ollama/llama.cpp) → Smart Fallback
 *
 * Capabilities:
 *   - Page security analysis
 *   - Web search via WAB Search Engine
 *   - WAB feature explanations
 *   - General Q&A with conversation memory
 *   - Bilingual (Arabic + English)
 */

const { search } = require('./search-engine');
const crypto = require('crypto');

// ─── Conversation Memory (in-process, per-session) ───────────────────

const conversations = new Map();
const MAX_HISTORY = 20;
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

function getSession(sessionId) {
  let session = conversations.get(sessionId);
  if (!session) {
    session = { messages: [], lastActive: Date.now() };
    conversations.set(sessionId, session);
  }
  session.lastActive = Date.now();
  return session;
}

function addToHistory(session, role, content) {
  session.messages.push({ role, content });
  if (session.messages.length > MAX_HISTORY) {
    session.messages = session.messages.slice(-MAX_HISTORY);
  }
}

// Purge stale sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of conversations) {
    if (now - session.lastActive > SESSION_TTL) conversations.delete(id);
  }
}, 10 * 60 * 1000);

// ─── System Prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `أنت وكيل WAB Browser الذكي — مساعد تصفح وتنفيذ مهام ذكي يعمل داخل متصفح WAB.

هويتك:
- اسمك "وكيل WAB" (WAB Agent)
- أنت مدمج في متصفح WAB Browser
- تساعد المستخدمين في التصفح، البحث، الحجز، التسوق، وأي مهمة على الإنترنت

قدراتك الجديدة (نظام المهام الذكي):
1. حجز تذاكر الطيران — ابحث وقارن بين عدة مواقع
2. حجز فنادق ومواعيد
3. التسوق والمقارنة — ابحث عن أفضل الأسعار
4. التفاوض — أحلل العروض وأوجد أفضل صفقة
5. البحث المتقدم — أبحث في مصادر متعددة في وقت واحد
6. تحليل أمان المواقع

كيف تعمل المهام:
- عندما يطلب المستخدم حجز أو شراء أو بحث عن شيء محدد، أسأله أسئلة توضيحية إذا لزم الأمر
- ثم أبحث عبر مصادر موثوقة متعددة
- أقارن النتائج وأتفاوض للحصول على أفضل سعر
- أعرض النتائج مرتبة من الأفضل مع تفاصيل التوفير

قواعد:
- أجب بالعربية افتراضياً، وبلغة المستخدم إذا كتب بلغة أخرى
- كن مختصراً ومفيداً
- استخدم الإيموجي باعتدال
- إذا سُئلت عن شيء لا تعرفه، قل ذلك بصراحة

معلومات عن ميزات WAB Browser:
- Ghost Mode: يحمي الخصوصية عبر تدوير User-Agent، إخفاء بصمة Canvas، حظر WebRTC، وإرسال DNT
- Scam Shield: يحلل المواقع تلقائياً ضد الاحتيال
- حجب الإعلانات: يحظر 80+ نطاق إعلاني ومتتبع معروف
- نظام العدالة: يعزز المواقع الصغيرة الموثوقة
- WAB Search: محرك بحث مستقل`;

// ─── AI Backend Selection ────────────────────────────────────────────

/**
 * Process a chat message through the best available AI backend.
 */
async function processMessage(message, context = {}) {
  const sessionId = context.sessionId || 'default';
  const session = getSession(sessionId);
  addToHistory(session, 'user', message);

  let reply;

  // 1. Try OpenAI API
  if (process.env.OPENAI_API_KEY) {
    try {
      reply = await _openaiChat(session, message, context);
    } catch (err) {
      console.error('[agent-chat] OpenAI error:', err.message);
    }
  }

  // 2. Try local AI (Ollama/llama.cpp)
  if (!reply) {
    try {
      reply = await _localAIChat(session, message, context);
    } catch (_) { /* no local models */ }
  }

  // 3. Smart fallback — context-aware response engine
  if (!reply) {
    reply = await _smartFallback(message, context);
  }

  addToHistory(session, 'assistant', reply);
  return { reply, type: 'text' };
}

// ─── OpenAI Backend ──────────────────────────────────────────────────

async function _openaiChat(session, message, context) {
  const messages = [{ role: 'system', content: _buildSystemPrompt(context) }];

  // Add conversation history
  for (const m of session.messages.slice(-10)) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content });
    }
  }

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages,
    max_tokens: 500,
    temperature: 0.7,
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}

// ─── Local AI Backend (Ollama / llama.cpp) ───────────────────────────

async function _localAIChat(session, message, context) {
  // Try Ollama first
  const ollamaModels = await _probeLocalModels();
  if (ollamaModels.length === 0) throw new Error('No local models');

  const model = ollamaModels[0];
  const messages = [{ role: 'system', content: _buildSystemPrompt(context) }];

  for (const m of session.messages.slice(-10)) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content });
    }
  }

  // Use OpenAI-compatible format (works with Ollama and llama.cpp)
  const body = {
    model: model.name,
    messages,
    max_tokens: 500,
    temperature: 0.7,
    stream: false,
  };

  const res = await fetch(`${model.endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Local AI ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}

async function _probeLocalModels() {
  const models = [];

  // Ollama
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      for (const m of (data.models || [])) {
        models.push({ name: m.name, endpoint: 'http://localhost:11434' });
      }
    }
  } catch (_) {}

  // llama.cpp
  try {
    const res = await fetch('http://localhost:8080/v1/models', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      for (const m of (data.data || [])) {
        models.push({ name: m.id, endpoint: 'http://localhost:8080' });
      }
    }
  } catch (_) {}

  return models;
}

// ─── Smart Fallback Engine ───────────────────────────────────────────

async function _smartFallback(message, context) {
  const msg = message.toLowerCase();
  const url = context.url || '';
  const lang = _detectLanguage(message);

  // ── Security analysis request ──
  if (_matchesAny(msg, ['أمان', 'آمن', 'safe', 'secure', 'security', 'خطر', 'danger', 'احتيال', 'scam', 'فحص', 'check', 'حلل', 'analyze'])) {
    if (url) return _analyzeUrl(url, lang);
    return lang === 'ar'
      ? '🔍 أرسل لي رابط الموقع أو انتقل إلى صفحة وسأحللها لك.'
      : '🔍 Navigate to a page or send me a URL and I\'ll analyze it for you.';
  }

  // ── Search request ──
  if (_matchesAny(msg, ['ابحث', 'بحث عن', 'search for', 'search about', 'find', 'جد لي', 'ابحث عن', 'ما هو', 'ما هي', 'what is', 'who is', 'how to', 'كيف'])) {
    const query = _extractSearchQuery(message);
    if (query && query.length > 2) {
      return await _searchAndSummarize(query, lang);
    }
  }

  // ── Ghost Mode ──
  if (_matchesAny(msg, ['ghost', 'شبح', 'خصوصية', 'privacy', 'تتبع', 'tracking', 'بصمة', 'fingerprint'])) {
    return lang === 'ar'
      ? '👻 Ghost Mode يحمي خصوصيتك عبر:\n• تدوير User-Agent تلقائياً\n• إخفاء بصمة Canvas\n• حظر WebRTC (يمنع كشف IP الحقيقي)\n• إرسال إشارة Do Not Track\n\nفعّله من القائمة الجانبية للتصفح دون تتبع.'
      : '👻 Ghost Mode protects your privacy:\n• Auto-rotating User-Agent\n• Canvas fingerprint masking\n• WebRTC blocking (prevents IP leak)\n• Do Not Track signal\n\nEnable from the side menu for tracking-free browsing.';
  }

  // ── Scam Shield ──
  if (_matchesAny(msg, ['shield', 'درع', 'حماية', 'protection', 'احتيال', 'scam', 'مزيف', 'fake'])) {
    return lang === 'ar'
      ? '🛡️ Scam Shield يحلل كل موقع تلقائياً:\n• فحص نطاقات TLD المشبوهة (.xyz, .tk, .buzz...)\n• كشف انتحال العلامات التجارية\n• تحليل هجمات Homograph (أحرف متشابهة)\n• فحص أنماط الاحتيال في المحتوى\n\nيعمل تلقائياً في الخلفية — سيُنبهك إذا اكتشف خطراً.'
      : '🛡️ Scam Shield auto-analyzes every page:\n• Suspicious TLD detection (.xyz, .tk, .buzz...)\n• Brand impersonation detection\n• Homograph attack analysis\n• Content scam pattern scanning\n\nRuns automatically — alerts you when threats are detected.';
  }

  // ── Ad Blocker ──
  if (_matchesAny(msg, ['إعلان', 'اعلان', 'ads', 'ad block', 'adblock', 'حظر', 'block'])) {
    return lang === 'ar'
      ? '🚫 حاجب الإعلانات يحظر 80+ نطاق إعلاني ومتتبع:\n• Google Ads, Facebook Ads, Amazon Ads\n• متتبعات: Hotjar, Mixpanel, Amplitude\n• شبكات إعلانية: Criteo, Taboola, Outbrain\n\nيعمل تلقائياً ويعرض عدد العناصر المحظورة في الشريط السفلي.'
      : '🚫 Ad Blocker blocks 80+ ad & tracker domains:\n• Google Ads, Facebook Ads, Amazon Ads\n• Trackers: Hotjar, Mixpanel, Amplitude\n• Ad networks: Criteo, Taboola, Outbrain\n\nRuns automatically and shows blocked count in the bottom bar.';
  }

  // ── WAB Search ──
  if (_matchesAny(msg, ['search engine', 'محرك بحث', 'wab search', 'بحث'])) {
    return lang === 'ar'
      ? '🔍 WAB Search محرك بحث مستقل:\n• يجمع نتائج من مصادر متعددة\n• اقتراحات فورية أثناء الكتابة\n• ترتيب ذكي يعزز المواقع الصغيرة\n• عمليات البحث الرائجة\n\nاكتب في شريط العنوان وابدأ البحث!'
      : '🔍 WAB Search is an independent search engine:\n• Multi-source result aggregation\n• Real-time autocomplete suggestions\n• Smart ranking that boosts small sites\n• Trending searches\n\nType in the address bar to start searching!';
  }

  // ── Fairness ──
  if (_matchesAny(msg, ['عدالة', 'fairness', 'fair', 'عادل', 'monopoly', 'احتكار'])) {
    return lang === 'ar'
      ? '⚖️ نظام العدالة في WAB:\n• يعزز ترتيب المواقع الصغيرة الموثوقة\n• يوازن ضد هيمنة المواقع الكبيرة في نتائج البحث\n• يعمل تلقائياً مع WAB Search\n• يحقق توازناً بين الجودة والتنوع'
      : '⚖️ WAB Fairness System:\n• Boosts ranking of trusted small websites\n• Balances against big-tech dominance in search\n• Works automatically with WAB Search\n• Achieves quality-diversity balance';
  }

  // ── Help ──
  if (_matchesAny(msg, ['help', 'مساعدة', 'ساعدني', 'ماذا تفعل', 'what can you do', 'قدرات'])) {
    return lang === 'ar'
      ? '🤖 أنا وكيل WAB — مساعدك الذكي:\n\n• ✈️ حجز رحلات — "احجز لي رحلة من الرياض إلى دبي"\n• 🏨 فنادق — "ابحث عن فندق رخيص في إسطنبول"\n• 🛒 تسوق — "اشتري لي آيفون بأقل سعر"\n• 📅 مواعيد — "احجز موعد عند طبيب أسنان"\n• 🔍 بحث — "ابحث عن أفضل مطعم عربي"\n• 🔒 أمان — "هل هذا الموقع آمن؟"\n\nأبحث وأقارن وأتفاوض لك! 💪'
      : '🤖 I\'m WAB Agent — your smart assistant:\n\n• ✈️ Book flights — "Book a flight from NYC to London"\n• 🏨 Hotels — "Find a cheap hotel in Dubai"\n• 🛒 Shopping — "Buy me an iPhone at the best price"\n• 📅 Appointments — "Book a dentist appointment"\n• 🔍 Research — "Find the best Arabic restaurant"\n• 🔒 Security — "Is this site safe?"\n\nI search, compare, and negotiate for you! 💪';
  }

  // ── Greeting ──
  if (_matchesAny(msg, ['مرحب', 'هلا', 'سلام', 'أهلا', 'اهلا', 'hello', 'hi', 'hey', 'صباح', 'مساء'])) {
    return lang === 'ar'
      ? '🤖 مرحباً! أنا وكيل WAB — مساعدك الذكي. كيف أساعدك اليوم؟\n\nيمكنني تحليل أمان المواقع، البحث في الويب، وشرح ميزات المتصفح.'
      : '🤖 Hello! I\'m WAB Agent — your smart assistant. How can I help?\n\nI can analyze website security, search the web, and explain browser features.';
  }

  // ── Thanks ──
  if (_matchesAny(msg, ['شكر', 'thank', 'ممتاز', 'رائع', 'great', 'awesome', 'good', 'حلو', 'تمام'])) {
    return lang === 'ar' ? '😊 سعيد بمساعدتك! اسألني أي وقت.' : '😊 Happy to help! Ask anytime.';
  }

  // ── General question — try search ──
  if (message.length > 5) {
    try {
      return await _searchAndSummarize(message, lang);
    } catch (_) {}
  }

  // ── Default ──
  return lang === 'ar'
    ? '🤖 أنا وكيل WAB. يمكنني:\n• ✈️ حجز رحلات وفنادق\n• 🛒 البحث والتسوق بأفضل الأسعار\n• 🔒 تحليل أمان المواقع\n• 📅 حجز مواعيد\n\nجرّب: "احجز لي تذكرة طيران" أو "اشتري لي لابتوب"'
    : '🤖 I\'m WAB Agent. I can:\n• ✈️ Book flights & hotels\n• 🛒 Shop at the best prices\n• 🔒 Analyze website security\n• 📅 Book appointments\n\nTry: "Book me a flight" or "Buy me a laptop"';
}

// ─── URL Security Analysis ──────────────────────────────────────────

const SCAM_TLDS = ['.xyz', '.top', '.club', '.buzz', '.gq', '.ml', '.cf', '.tk', '.icu', '.cam', '.rest', '.click', '.link', '.surf'];
const BRAND_NAMES = ['paypal', 'apple', 'google', 'amazon', 'microsoft', 'netflix', 'facebook', 'instagram', 'whatsapp', 'bank', 'visa', 'mastercard'];

function _analyzeUrl(url, lang) {
  const issues = [];
  const good = [];

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // SSL check
    if (parsed.protocol === 'https:') {
      good.push(lang === 'ar' ? '🔒 اتصال مشفر SSL/TLS' : '🔒 SSL/TLS encrypted');
    } else {
      issues.push(lang === 'ar' ? '⚠️ اتصال غير مشفر (HTTP)' : '⚠️ No encryption (HTTP)');
    }

    // Suspicious TLD
    const tld = '.' + hostname.split('.').pop();
    if (SCAM_TLDS.includes(tld)) {
      issues.push(lang === 'ar' ? `⚠️ نطاق TLD مشبوه (${tld})` : `⚠️ Suspicious TLD (${tld})`);
    }

    // Brand impersonation
    for (const brand of BRAND_NAMES) {
      if (hostname.includes(brand) && !hostname.endsWith(`${brand}.com`) && !hostname.endsWith(`${brand}.net`)) {
        issues.push(lang === 'ar' ? `🚨 احتمال انتحال علامة ${brand}!` : `🚨 Possible ${brand} impersonation!`);
      }
    }

    // Very long hostname (common in phishing)
    if (hostname.length > 40) {
      issues.push(lang === 'ar' ? '⚠️ نطاق طويل جداً (شائع في التصيد)' : '⚠️ Very long domain (common in phishing)');
    }

    // IP address instead of domain
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      issues.push(lang === 'ar' ? '⚠️ عنوان IP بدل اسم نطاق' : '⚠️ IP address instead of domain');
    }

    // Too many subdomains
    const parts = hostname.split('.');
    if (parts.length > 4) {
      issues.push(lang === 'ar' ? '⚠️ عدد كبير من النطاقات الفرعية' : '⚠️ Too many subdomains');
    }

    // Homograph detection (mixed scripts)
    if (/[а-яА-Я]/.test(hostname) || /[\u0600-\u06FF]/.test(hostname)) {
      issues.push(lang === 'ar' ? '🚨 أحرف مشبوهة في النطاق (هجوم Homograph)!' : '🚨 Suspicious characters in domain (Homograph attack)!');
    }

    if (issues.length === 0) {
      good.push(lang === 'ar' ? '✅ لم يُكتشف تهديد واضح' : '✅ No obvious threats detected');
    }

    const header = lang === 'ar' ? `🔍 تحليل أمان: ${hostname}` : `🔍 Security analysis: ${hostname}`;
    const lines = [header, ''];
    if (good.length) lines.push(...good);
    if (issues.length) lines.push('', ...(lang === 'ar' ? ['⚠️ تحذيرات:'] : ['⚠️ Warnings:']), ...issues);
    lines.push('', lang === 'ar' ? '💡 Scam Shield يعمل تلقائياً لحمايتك.' : '💡 Scam Shield runs automatically to protect you.');

    return lines.join('\n');
  } catch (_) {
    return lang === 'ar' ? '⚠️ تعذر تحليل الرابط.' : '⚠️ Could not analyze the URL.';
  }
}

// ─── Search & Summarize ──────────────────────────────────────────────

async function _searchAndSummarize(query, lang) {
  try {
    const ipHash = crypto.createHash('sha256').update('agent-chat').digest('hex').slice(0, 16);
    const result = await search(query, ipHash);
    const results = result.results || [];

    if (results.length === 0) {
      return lang === 'ar'
        ? `🔍 بحثت عن "${query}" ولم أجد نتائج. جرّب صياغة مختلفة.`
        : `🔍 Searched for "${query}" — no results found. Try different wording.`;
    }

    const top = results.slice(0, 5);
    const header = lang === 'ar' ? `🔍 نتائج البحث عن "${query}":` : `🔍 Search results for "${query}":`;
    const lines = [header, ''];

    for (let i = 0; i < top.length; i++) {
      const r = top[i];
      const domain = _extractDomain(r.url);
      lines.push(`${i + 1}. ${r.title}`);
      lines.push(`   ${domain}`);
      if (r.snippet) lines.push(`   ${r.snippet.slice(0, 120)}`);
      lines.push('');
    }

    lines.push(lang === 'ar' ? '📊 يمكنك فتح أي نتيجة من شريط العنوان.' : '📊 Open any result from the address bar.');
    return lines.join('\n');
  } catch (err) {
    return lang === 'ar'
      ? '🔍 تعذر البحث الآن. جرّب لاحقاً.'
      : '🔍 Search unavailable right now. Try again later.';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function _buildSystemPrompt(context) {
  let prompt = SYSTEM_PROMPT;
  if (context.url) {
    prompt += `\n\nالمستخدم يتصفح حالياً: ${context.url}`;
  }
  if (context.platform) {
    prompt += `\nالمنصة: ${context.platform}`;
  }
  return prompt;
}

function _matchesAny(text, keywords) {
  return keywords.some(k => text.includes(k));
}

function _detectLanguage(text) {
  // Simple detection: if text contains Arabic characters, it's Arabic
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  return 'en';
}

function _extractSearchQuery(message) {
  // Remove common prefixes
  let q = message
    .replace(/^(ابحث عن|ابحث|بحث عن|جد لي|search for|search about|find|what is|who is|how to|ما هو|ما هي|كيف)\s*/i, '')
    .trim();
  return q || message;
}

function _extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return url;
  }
}

module.exports = { processMessage };
