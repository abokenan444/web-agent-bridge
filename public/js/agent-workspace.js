/**
 * WAB Agent Workspace — Frontend Controller
 * ════════════════════════════════════════════════════════════════════════
 * Manages the 4-panel workspace: Browser, Chat, Monitor, Results
 * Handles auth, subscription, real-time updates, agent communication
 * Full bilingual (AR/EN) with auto-detection and multilingual agent
 */

// ─── i18n Dictionary ─────────────────────────────────────────────────

const I18N = {
  // Page
  page_title: { ar: 'WAB Agent Workspace — مساحة عمل الوكيل الذكي', en: 'WAB Agent Workspace — Smart Agent Workspace' },

  // Auth
  auth_welcome:          { ar: 'مرحباً بك في WAB', en: 'Welcome to WAB' },
  auth_subtitle:         { ar: 'سجّل دخولك للوصول إلى مساحة عمل الوكيل الذكي', en: 'Sign in to access the Smart Agent Workspace' },
  auth_email:            { ar: 'البريد الإلكتروني', en: 'Email' },
  auth_email_ph:         { ar: 'you@email.com', en: 'you@email.com' },
  auth_password:         { ar: 'كلمة المرور', en: 'Password' },
  auth_password_ph:      { ar: '••••••••', en: '••••••••' },
  auth_login_btn:        { ar: 'تسجيل الدخول', en: 'Sign In' },
  auth_no_account:       { ar: 'ليس لديك حساب؟', en: "Don't have an account?" },
  auth_create_account:   { ar: 'إنشاء حساب جديد', en: 'Create a new account' },
  auth_register_title:   { ar: 'إنشاء حساب جديد', en: 'Create New Account' },
  auth_register_subtitle:{ ar: 'ابدأ مع الوكيل الذكي — ابحث، قارن، وفاوض بذكاء', en: 'Start with the Smart Agent — Search, Compare & Negotiate' },
  auth_name:             { ar: 'الاسم', en: 'Name' },
  auth_name_ph:          { ar: 'محمد', en: 'John' },
  auth_reg_password_ph:  { ar: '6 أحرف على الأقل', en: 'At least 6 characters' },
  auth_register_btn:     { ar: 'إنشاء حساب', en: 'Create Account' },
  auth_has_account:      { ar: 'لديك حساب بالفعل؟', en: 'Already have an account?' },
  auth_signin_link:      { ar: 'تسجيل الدخول', en: 'Sign In' },
  auth_plan_title:       { ar: 'اختر خطتك', en: 'Choose Your Plan' },
  auth_demo:             { ar: 'تجربة بدون حساب (وضع تجريبي)', en: 'Try without account (Demo Mode)' },
  auth_plan_subtitle:    { ar: 'ابدأ مجاناً أو اختر خطة تناسبك', en: 'Start free or pick a plan that fits you' },
  auth_signing_in:       { ar: 'جارِ التحقق...', en: 'Signing in...' },
  auth_creating:         { ar: 'جارِ الإنشاء...', en: 'Creating...' },

  // Plans
  plan_free:       { ar: 'مجاني', en: 'Free' },
  plan_per_month:  { ar: '/شهر', en: '/month' },
  plan_free_f1:    { ar: '5 مهام يومياً', en: '5 tasks/day' },
  plan_free_f2:    { ar: 'بحث أساسي', en: 'Basic search' },
  plan_free_f3:    { ar: 'نتائج محدودة', en: 'Limited results' },
  plan_pro_f1:     { ar: 'مهام غير محدودة', en: 'Unlimited tasks' },
  plan_pro_f2:     { ar: 'تفاوض متقدم', en: 'Advanced negotiation' },
  plan_pro_f3:     { ar: 'وكيل يُتمم الصفقات', en: 'Agent completes deals' },
  plan_pro_f4:     { ar: 'أولوية في الدعم', en: 'Priority support' },
  plan_ent_f1:     { ar: 'كل ميزات Pro', en: 'All Pro features' },
  plan_ent_f2:     { ar: 'API مخصص', en: 'Custom API' },
  plan_ent_f3:     { ar: 'فريق متعدد', en: 'Multi-team' },
  plan_ent_f4:     { ar: 'دعم مخصص 24/7', en: '24/7 Dedicated support' },

  // Topbar
  topbar_settings: { ar: 'الإعدادات', en: 'Settings' },
  topbar_logout:   { ar: 'خروج', en: 'Logout' },

  // Panels
  panel_browser:   { ar: 'المتصفح', en: 'Browser' },
  panel_agent:     { ar: 'الوكيل الذكي', en: 'Smart Agent' },
  panel_monitor:   { ar: 'شاشة التفاوض', en: 'Negotiation Monitor' },
  panel_results:   { ar: 'النتائج والإجراءات', en: 'Results & Actions' },

  // Status
  status_ready:      { ar: 'جاهز', en: 'Ready' },
  status_connected:  { ar: 'متصل', en: 'Connected' },
  status_waiting:    { ar: 'في الانتظار', en: 'Waiting' },
  status_awaiting:   { ar: 'بانتظار النتائج', en: 'Awaiting Results' },
  status_loading:    { ar: 'يحمّل...', en: 'Loading...' },
  status_loaded:     { ar: 'محمّل', en: 'Loaded' },
  status_working:    { ar: 'يعمل', en: 'Working' },
  status_done:       { ar: 'مكتمل', en: 'Done' },
  status_failed:     { ar: 'فشل', en: 'Failed' },

  // Browser
  browser_url_ph:    { ar: 'أدخل الرابط أو ابحث...', en: 'Enter a URL or search...' },
  browser_empty:     { ar: 'اطلب من الوكيل البحث عن شيء أو أدخل رابطاً في شريط العنوان', en: 'Ask the agent to search or enter a URL in the address bar' },
  browser_refresh:   { ar: 'تحديث', en: 'Refresh' },
  browser_back:      { ar: 'رجوع', en: 'Back' },
  browser_forward:   { ar: 'تقدم', en: 'Forward' },
  panel_maximize:    { ar: 'تكبير', en: 'Maximize' },

  // Chat
  chat_input_ph:     { ar: 'اكتب رسالتك هنا... (لا قيود — اكتب بحرية)', en: 'Type your message... (no limits — write freely)' },
  chat_send:         { ar: 'إرسال', en: 'Send' },
  chat_new:          { ar: 'محادثة جديدة', en: 'New Chat' },

  // Suggestion chips
  chip_hotels:         { ar: '🏨 فنادق تونس', en: '🏨 Tunisia Hotels' },
  chip_hotels_query:   { ar: 'ابحث عن فنادق رخيصة في تونس', en: 'Search for cheap hotels in Tunisia' },
  chip_laptop:         { ar: '🎮 لابتوب قيمنق', en: '🎮 Gaming Laptop' },
  chip_laptop_query:   { ar: 'اشتري لابتوب قيمنق بأقل سعر', en: 'Buy a gaming laptop at the lowest price' },
  chip_iphone:         { ar: '📱 iPhone 16', en: '📱 iPhone 16' },
  chip_iphone_query:   { ar: 'قارن أسعار iPhone 16 Pro', en: 'Compare iPhone 16 Pro prices' },
  chip_flight:         { ar: '✈️ رحلة طيران', en: '✈️ Flight' },
  chip_flight_query:   { ar: 'احجز رحلة من تونس إلى إسطنبول', en: 'Book a flight from Tunisia to Istanbul' },
  chip_url_paste:      { ar: '🔗 لصق رابط حجز', en: '🔗 Paste Booking Link' },
  chip_url_paste_prompt: { ar: 'الصق رابط الحجز هنا وسأبحث لك عن سعر أفضل...', en: 'Paste your booking link here and I\'ll find you a better price...' },
  chip_security:       { ar: '🔒 فحص أمان', en: '🔒 Security Check' },
  chip_security_query: { ar: 'هل هذا الموقع آمن؟', en: 'Is this website safe?' },

  // Welcome message
  welcome_msg: {
    ar: '🤖 مرحباً! أنا وكيل WAB الذكي — مساعدك الشخصي للبحث والتفاوض والشراء.<br><br>أخبرني ماذا تحتاج:<br>• ✈️ "احجز لي رحلة إلى إسطنبول"<br>• 🏨 "ابحث عن فندق رخيص في تونس"<br>• 🛒 "اشتري لابتوب بأقل سعر"<br>• 🔍 "قارن أسعار iPhone 16"<br><br>اكتب بأي لغة وسأبدأ فوراً! 💪',
    en: '🤖 Hello! I\'m WAB Smart Agent — your personal assistant for searching, negotiating & buying.<br><br>Tell me what you need:<br>• ✈️ "Book me a flight to Istanbul"<br>• 🏨 "Find a cheap hotel in Tunisia"<br>• 🛒 "Buy a gaming laptop at the best price"<br>• 🔍 "Compare iPhone 16 prices"<br><br>Type in any language and I\'ll start right away! 💪'
  },
  welcome_now: { ar: 'الآن', en: 'Now' },

  // Monitor
  monitor_empty:  { ar: 'عندما يبدأ الوكيل بالبحث والتفاوض، ستراقب كل خطوة هنا مباشرة', en: 'When the agent starts searching and negotiating, you\'ll monitor every step here in real-time' },

  // Results
  results_empty:  { ar: 'ستظهر هنا أفضل النتائج والروابط بعد انتهاء الوكيل من البحث والتفاوض', en: 'Best results and links will appear here after the agent finishes searching and negotiating' },
  summary_results:      { ar: '🔍 نتائج:', en: '🔍 Results:' },
  summary_best_saving:  { ar: '💰 أفضل توفير:', en: '💰 Best Saving:' },
  summary_time:         { ar: '⏱️ الوقت:', en: '⏱️ Time:' },
  result_best:          { ar: '⭐ الأفضل', en: '⭐ Best' },
  result_savings:       { ar: 'توفير', en: 'off' },
  result_save:          { ar: 'وفّر', en: 'Save' },
  result_open:          { ar: '🔗 فتح الصفقة', en: '🔗 Open Deal' },
  result_agent_do:      { ar: '🤖 الوكيل يُتمم', en: '🤖 Agent Do It' },
  result_view:          { ar: '🌐 عرض', en: '🌐 View' },

  // Mobile nav
  nav_browser:  { ar: 'المتصفح', en: 'Browser' },
  nav_agent:    { ar: 'الوكيل', en: 'Agent' },
  nav_monitor:  { ar: 'التفاوض', en: 'Negotiate' },
  nav_results:  { ar: 'النتائج', en: 'Results' },

  // Agent messages
  agent_error:          { ar: '⚠️ عذراً، حدث خطأ في الاتصال. حاول مرة أخرى.', en: '⚠️ Connection error. Please try again.' },
  agent_task_started:   { ar: '🚀 بدأ الوكيل بتنفيذ المهمة...', en: '🚀 Agent started executing task...' },
  agent_done:           { ar: '✅ انتهيت! راجع النتائج في شاشة النتائج ←', en: '✅ Done! Check the Results panel →' },
  agent_new_chat:       { ar: '🤖 محادثة جديدة! كيف أساعدك؟', en: '🤖 New chat! How can I help?' },
  agent_found:          { ar: 'وجدت', en: 'Found' },
  agent_offers:         { ar: 'عروض! الأفضل:', en: 'offers! Best:' },
  agent_pick:           { ar: '👆 اختر رقم العرض أو راجع التفاصيل في شاشة النتائج', en: '👆 Pick an offer number or check the Results panel for details' },
  agent_login_required: { ar: '🔑 تسجيل دخول مطلوب', en: '🔑 Login Required' },
  agent_login_site:     { ar: 'الموقع {site} يتطلب تسجيل دخول لإتمام العملية. اختر طريقة:', en: '{site} requires login to complete. Choose how:' },
  agent_give_creds:     { ar: '🤖 أعطِ الوكيل بياناتي (مشفّر)', en: '🤖 Give agent my credentials (encrypted)' },
  agent_manual_login:   { ar: '🌐 سأسجل الدخول بنفسي في المتصفح', en: "🌐 I'll log in myself in the browser" },
  agent_deal_start:     { ar: '🤖 الوكيل يبدأ إتمام الصفقة من {source}...', en: '🤖 Agent starting to complete deal from {source}...' },
  agent_deal_login:     { ar: '🔑 الموقع {source} يتطلب تسجيل دخول. اختر الطريقة من شاشة النتائج.', en: '🔑 {source} requires login. Choose method from the Results panel.' },
  agent_deal_opened:    { ar: '✅ فتحت الصفقة في المتصفح. السعر: ${price}\n\n💡 أكمل الدفع من المتصفح، أو أخبرني إذا تحتاج مساعدة.', en: '✅ Opened the deal in the browser. Price: ${price}\n\n💡 Complete payment in the browser, or tell me if you need help.' },
  agent_creds_request:  { ar: '🔑 أرسل لي بيانات تسجيل الدخول (البريد وكلمة المرور) وسأسجّل الدخول بشكل آمن.\n\n🔒 بياناتك مشفّرة ولا تُخزّن.', en: '🔑 Send me the login credentials (email and password) and I\'ll log in securely.\n\n🔒 Your data is encrypted and not stored.' },
  agent_manual_opened:  { ar: '🌐 فتحت الموقع في المتصفح. سجّل دخولك ثم أخبرني "جاهز" لأُكمل.', en: '🌐 Opened the site in the browser. Log in and then tell me "ready" to continue.' },

  // Tips
  tips_title:       { ar: '💡 نصائح ذكية', en: '💡 Smart Tips' },
  tip_weekday:      { ar: 'جرّب الحجز في أيام الأسبوع — الأسعار أقل عادةً', en: 'Try booking on weekdays — prices are usually lower' },
  tip_agent_do:     { ar: 'استخدم زر "الوكيل يُتمم" ليقوم الوكيل بإتمام العملية بدلاً عنك', en: 'Use "Agent Do It" to let the agent complete the purchase' },
  tip_compare:      { ar: 'قارن بين العروض جيداً — الأرخص ليس دائماً الأفضل', en: "Compare offers carefully — cheapest isn't always best" },
  tip_login:        { ar: 'إذا طلب الموقع تسجيل دخول، يمكنك إعطاء الوكيل إذناً أو تسجيل الدخول يدوياً', en: 'If a site requires login, you can authorize the agent or log in manually' },

  // Toasts
  toast_welcome:   { ar: '🎉 مرحباً بك في WAB!', en: '🎉 Welcome to WAB!' },
  toast_lang_ar:   { ar: 'تم التبديل إلى العربية', en: 'Switched to Arabic' },
  toast_lang_en:   { ar: 'تم التبديل إلى الإنجليزية', en: 'Switched to English' },
  toast_settings:  { ar: 'الإعدادات قريباً', en: 'Settings coming soon' },
  toast_no_results:{ ar: 'لا توجد نتائج', en: 'No results' },

  // URL Paste Negotiation
  url_paste_detected:    { ar: '🔗 اكتشفت رابط حجز! سأحلله وأبحث عن سعر أفضل...', en: '🔗 Booking link detected! Analyzing and searching for better prices...' },
  url_paste_hint:        { ar: '💡 الصق رابط حجز لأبحث لك عن سعر أفضل', en: '💡 Paste a booking link and I\'ll find you a better price' },
  url_original_label:    { ar: '📌 الرابط الأصلي', en: '📌 Original Link' },
  url_savings_found:     { ar: '🎯 وجدت توفير!', en: '🎯 Savings found!' },
  url_no_savings:        { ar: 'لم أجد سعراً أفضل حالياً', en: 'No better price found currently' },

  // Dynamic Pricing Shield
  shield_title:          { ar: 'درع التسعير الديناميكي', en: 'Dynamic Pricing Shield' },
  shield_scanning:       { ar: '🔍 يفحص الأسعار عبر {count} هوية مختلفة...', en: '🔍 Scanning prices across {count} different identities...' },
  shield_probe_done:     { ar: '✓ {persona}: {price}', en: '✓ {persona}: {price}' },
  shield_analyzing:      { ar: '🧮 يحلل فروقات الأسعار...', en: '🧮 Analyzing price differences...' },
  shield_clean:          { ar: '✅ لم يُكتشف تلاعب بالأسعار — السعر متسق عبر جميع الهويات', en: '✅ No price manipulation detected — price is consistent across all identities' },
  shield_detected:       { ar: '⚠️ تم اكتشاف تلاعب بالأسعار!', en: '⚠️ Price manipulation detected!' },
  shield_score:          { ar: 'درجة التلاعب: {score}/100 ({level})', en: 'Manipulation score: {score}/100 ({level})' },
  shield_spread:         { ar: 'فرق السعر: ${lowest} — ${highest} (فارق {pct}%)', en: 'Price spread: ${lowest} — ${highest} ({pct}% difference)' },
  shield_best_price:     { ar: '💰 أفضل سعر: ${price} عبر هوية "{persona}"', en: '💰 Best price: ${price} via "{persona}" identity' },
  shield_savings:        { ar: '🎯 توفير محتمل: ${amount} ({pct}%)', en: '🎯 Potential savings: ${amount} ({pct}%)' },
  shield_tip_device:     { ar: '📱 استخدم جهاز/متصفح مختلف للحصول على سعر أقل', en: '📱 Switch device/browser for a lower price' },
  shield_tip_cookies:    { ar: '🍪 امسح ملفات تعريف الارتباط وسجل التصفح قبل الشراء', en: '🍪 Clear cookies and browsing history before purchasing' },
  shield_tip_geo:        { ar: '🌍 استخدم VPN لتظهر من منطقة بأسعار أقل', en: '🌍 Use VPN to appear from a region with cheaper pricing' },
  shield_tip_referral:   { ar: '🔗 ادخل عبر موقع مقارنة أسعار للحصول على سعر أقل', en: '🔗 Arrive via a price comparison site for lower pricing' },
  shield_tip_incognito:  { ar: '🕵️ استخدم وضع التصفح المتخفي لتجنب رسوم الزيارات المتكررة', en: '🕵️ Use incognito mode to avoid repeat-visitor surcharges' },
  shield_level_none:     { ar: 'لا يوجد', en: 'none' },
  shield_level_minor:    { ar: 'طفيف', en: 'minor' },
  shield_level_moderate: { ar: 'متوسط', en: 'moderate' },
  shield_level_significant: { ar: 'كبير', en: 'significant' },
  shield_level_severe:   { ar: 'خطير', en: 'severe' },
};

/** Get translated string */
function i18n(key, replacements) {
  const entry = I18N[key];
  if (!entry) return key;
  let text = entry[state.lang] || entry.en || key;
  if (replacements) {
    Object.entries(replacements).forEach(([k, v]) => {
      text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
    });
  }
  return text;
}

/** Apply i18n to all data-i18n elements in DOM */
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const entry = I18N[key];
    if (entry) {
      if (el.tagName === 'TITLE') {
        document.title = entry[state.lang] || entry.en;
      } else {
        el.textContent = entry[state.lang] || entry.en;
      }
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const entry = I18N[key];
    if (entry) el.placeholder = entry[state.lang] || entry.en;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const entry = I18N[key];
    if (entry) el.title = entry[state.lang] || entry.en;
  });
}

// ─── State ───────────────────────────────────────────────────────────

const API = window.location.origin;
let state = {
  token: localStorage.getItem('wab_token') || null,
  user: null,
  sessionId: null,
  currentTask: null,
  lang: localStorage.getItem('wab_lang') || 'en',
  layout: 'grid',
  activeMobilePanel: 0,
  ws: null,
  taskStartTime: null,
  currentOffers: null,
  offlineMode: false,
};

// ─── Chat Archive (localStorage persistence) ────────────────────────

const ARCHIVE_KEY = 'wab_chat_archive';
const ARCHIVE_MAX = 200;

function saveArchive() {
  try {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const msgs = [];
    container.querySelectorAll('.aws-msg').forEach(el => {
      const role = el.classList.contains('user') ? 'user' : el.classList.contains('system') ? 'system' : 'agent';
      msgs.push({ role, html: el.innerHTML, text: el.textContent });
    });
    // Keep only the last ARCHIVE_MAX messages
    const trimmed = msgs.slice(-ARCHIVE_MAX);
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(trimmed));
  } catch (_) {}
}

function loadArchive() {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return false;
    const msgs = JSON.parse(raw);
    if (!Array.isArray(msgs) || msgs.length === 0) return false;
    const container = document.getElementById('chatMessages');
    if (!container) return false;
    container.innerHTML = '';
    msgs.forEach(m => {
      const div = document.createElement('div');
      div.className = `aws-msg ${m.role}`;
      if (m.role === 'system') {
        div.textContent = m.text;
      } else {
        div.innerHTML = m.html;
      }
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
    return true;
  } catch (_) { return false; }
}

function clearArchive() {
  localStorage.removeItem(ARCHIVE_KEY);
}

// ─── Init ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setDirection();
  applyI18n();

  if (state.token) {
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        state.user = data.user || data;
        state.sessionId = 'ws-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        showWorkspace();
        connectWebSocket();
        // Load archived chat or inject welcome
        if (!loadArchive()) injectWelcomeMessage();
        return;
      }
    } catch (_) {
      // Server unreachable — enter offline/demo mode
      console.warn('[WAB] Server unreachable, entering offline mode');
      state.offlineMode = true;
      state.user = JSON.parse(localStorage.getItem('wab_user_cache') || 'null');
      if (state.user && state.token) {
        state.sessionId = 'offline-' + Date.now();
        showWorkspace();
        if (!loadArchive()) injectWelcomeMessage();
        return;
      }
    }
    // Only clear token if server explicitly rejected it (not if server is down)
    if (!state.offlineMode) {
      state.token = null;
      localStorage.removeItem('wab_token');
    }
  }
  showAuth();
});

function injectWelcomeMessage() {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'aws-msg agent';
  div.innerHTML = `${i18n('welcome_msg')}<span class="aws-msg-time">${i18n('welcome_now')}</span>`;
  container.appendChild(div);
}

// ─── Auth ────────────────────────────────────────────────────────────

function showAuth() {
  document.getElementById('authOverlay').classList.remove('hidden');
}

function hideAuth() {
  document.getElementById('authOverlay').classList.add('hidden');
}

function showLogin() {
  document.getElementById('authLogin').style.display = '';
  document.getElementById('authRegister').style.display = 'none';
  document.getElementById('authSubscription').style.display = 'none';
}

function showRegister() {
  document.getElementById('authLogin').style.display = 'none';
  document.getElementById('authRegister').style.display = '';
  document.getElementById('authSubscription').style.display = 'none';
}

function showSubscriptions() {
  document.getElementById('authLogin').style.display = 'none';
  document.getElementById('authRegister').style.display = 'none';
  document.getElementById('authSubscription').style.display = '';
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  const errEl = document.getElementById('authError');

  btn.disabled = true;
  btn.textContent = i18n('auth_signing_in');
  errEl.classList.remove('visible');

  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    state.token = data.token;
    state.user = data.user || { email, name: email.split('@')[0] };
    localStorage.setItem('wab_token', data.token);
    state.sessionId = 'ws-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    hideAuth();
    showWorkspace();
    connectWebSocket();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = i18n('auth_login_btn');
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const btn = document.getElementById('regBtn');
  const errEl = document.getElementById('regError');

  btn.disabled = true;
  btn.textContent = i18n('auth_creating');
  errEl.classList.remove('visible');

  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');

    state.token = data.token;
    state.user = data.user || { email, name };
    localStorage.setItem('wab_token', data.token);
    state.sessionId = 'ws-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    showSubscriptions();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = i18n('auth_register_btn');
  }
});

async function selectPlan(plan) {
  if (plan !== 'free') {
    try {
      await apiFetch('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
    } catch (_) {}
  }
  hideAuth();
  showWorkspace();
  connectWebSocket();
  showToast(i18n('toast_welcome'), 'success');
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('wab_token');
  if (state.ws) state.ws.close();
  location.reload();
}

// ─── Workspace Setup ─────────────────────────────────────────────────

function showWorkspace() {
  const user = state.user || {};
  const name = user.name || user.email || 'User';
  document.getElementById('userName').textContent = name;
  document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();

  // Cache user info for offline mode
  try { localStorage.setItem('wab_user_cache', JSON.stringify(user)); } catch (_) {}

  const tier = user.tier || 'premium';
  const tierEl = document.getElementById('userTier');
  tierEl.textContent = tier.charAt(0).toUpperCase() + tier.slice(1);
  tierEl.className = 'aws-tier-badge ' + (tier === 'pro' ? 'pro' : tier === 'starter' ? 'starter' : 'premium');

  if (state.offlineMode) {
    showToast(state.lang === 'ar' ? '📡 وضع عدم الاتصال — البيانات محفوظة محلياً' : '📡 Offline mode — data saved locally', 'info');
  }

  // On mobile, activate the chat panel (index 1) by default
  if (window.innerWidth <= 768) {
    switchMobilePanel(1, document.querySelectorAll('.aws-mobile-nav-item')[1]);
  }
}

// ─── WebSocket ───────────────────────────────────────────────────────

function connectWebSocket() {
  try {
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.ws = new WebSocket(`${wsProto}//${location.host}/ws/analytics`);

    state.ws.onopen = () => {
      state.ws.send(JSON.stringify({ type: 'auth', token: state.token }));
    };

    state.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
      } catch (_) {}
    };

    state.ws.onclose = () => {
      setTimeout(connectWebSocket, 5000);
    };
  } catch (_) {}
}

function handleWsMessage(data) {
  if (data.type === 'task_update') {
    updateMonitorFromWs(data);
  } else if (data.type === 'result') {
    addResultFromWs(data);
  }
}

// ─── Chat ────────────────────────────────────────────────────────────

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  autoResize(input);

  addChatMessage('user', message);
  document.getElementById('chatSuggestions').style.display = 'none';

  // Detect URL paste — show immediate feedback
  const hasUrl = /https?:\/\/[^\s]+/i.test(message);
  if (hasUrl) {
    addChatMessage('system', i18n('url_paste_detected'));
  }

  showTyping(true);

  try {
    const body = {
      message,
      context: { url: document.getElementById('urlInput').value, platform: 'workspace', lang: state.lang },
      sessionId: state.sessionId,
    };

    if (state.currentTask && !hasUrl) {
      body.taskId = state.currentTask.taskId;
      body.taskAction = 'answer';
    }

    const res = await apiFetch('/api/wab/agent-chat', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const data = await res.json();
    showTyping(false);

    if (data.type === 'task') {
      handleTaskResponse(data);
    } else {
      addChatMessage('agent', data.reply || data.message || 'OK');
    }
  } catch (err) {
    showTyping(false);
    // Offline fallback: generate smart local response
    const fallback = offlineFallbackReply(message);
    addChatMessage('agent', fallback);

    // If URL detected, try to navigate to it
    if (hasUrl) {
      const urlMatch = message.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) navigateTo(urlMatch[0]);
    }
  }
}

function handleTaskResponse(data) {
  state.currentTask = data;
  state.taskStartTime = state.taskStartTime || Date.now();

  if (data.status === 'clarifying') {
    addChatMessage('agent', data.message || data.questions?.join('\n'));
  } else if (data.status === 'planning') {
    addChatMessage('agent', data.message);
    addChatMessage('system', i18n('agent_task_started'));
    startMonitor(data);
    executeTask(data.taskId);
  } else if (data.status === 'presenting') {
    // Animate the monitor through all steps before showing results
    startMonitor(data);
    animateMonitorProgress(data);
    addChatMessage('agent', formatChatOffers(data));
    showResults(data);
    // For URL tasks, load original URL in browser; otherwise load first offer
    if (data.urlData?.url) {
      navigateTo(data.urlData.url);
    } else {
      const firstUrl = data.offers?.[0]?.url;
      if (firstUrl) navigateTo(firstUrl);
    }
    // Clear task so user can make new requests
    state.currentTask = null;
  } else if (data.status === 'completed') {
    addChatMessage('agent', data.message);
    if (data.action?.url) {
      navigateTo(data.action.url);
    }
    state.currentTask = null;
  } else if (data.status === 'failed') {
    addChatMessage('agent', data.message);
    updateMonitorFailed();
    state.currentTask = null;
  } else {
    addChatMessage('agent', data.message || JSON.stringify(data));
  }
}

async function executeTask(taskId) {
  let tries = 0;
  const maxTries = 30;

  const poll = async () => {
    if (tries++ >= maxTries) return;
    try {
      const res = await apiFetch(`/api/wab/agent-task/${taskId}`);
      const data = await res.json();

      updateMonitorFromTask(data);

      if (['presenting', 'completed', 'failed', 'cancelled'].includes(data.status)) {
        if (data.status === 'presenting') {
          showResults({ offers: data.offers, updates: data.messages });
          addChatMessage('agent', i18n('agent_done'));
          updateMonitorComplete();
        }
        return;
      }

      setTimeout(poll, 2000);
    } catch (_) {
      setTimeout(poll, 3000);
    }
  };

  setTimeout(poll, 2000);
}

function addChatMessage(role, content) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `aws-msg ${role}`;

  const time = new Date().toLocaleTimeString(state.lang === 'ar' ? 'ar-SA' : 'en-US', {
    hour: '2-digit', minute: '2-digit'
  });

  if (role === 'system') {
    div.textContent = content;
  } else {
    const formatted = content
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;font-size:0.8em">$1</code>');
    div.innerHTML = `${formatted}<span class="aws-msg-time">${time}</span>`;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  // Auto-save chat archive
  saveArchive();
}

function formatChatOffers(data) {
  const offers = data.offers || [];
  if (offers.length === 0) return data.message || i18n('toast_no_results');

  let text = `✅ ${i18n('agent_found')} ${offers.length} ${i18n('agent_offers')}\n\n`;

  offers.forEach((o, idx) => {
    const priceDisplay = o.price || (o.priceNum ? `$${o.priceNum}` : '');
    const savings = o.negotiation?.savings ? ` (${i18n('result_save')} $${o.negotiation.savings})` : '';
    text += `${idx + 1}. ${o.title || o.name} — **${priceDisplay}**${savings}\n   📍 ${o.source}\n\n`;
  });

  text += i18n('agent_pick');
  return text;
}

function showTyping(show) {
  const el = document.getElementById('typingIndicator');
  el.classList.toggle('visible', show);
  if (show) {
    const container = document.getElementById('chatMessages');
    container.scrollTop = container.scrollHeight;
  }
}

function useSuggestion(text) {
  document.getElementById('chatInput').value = text;
  sendMessage();
}

function promptUrlPaste() {
  const input = document.getElementById('chatInput');
  input.value = '';
  input.placeholder = i18n('chip_url_paste_prompt');
  input.focus();
  // Try reading from clipboard
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(text => {
      if (/https?:\/\/[^\s]+/i.test(text)) {
        input.value = text;
        autoResize(input);
      }
    }).catch(() => { /* clipboard access denied, user will paste manually */ });
  }
}

function clearChat() {
  const container = document.getElementById('chatMessages');
  container.innerHTML = '';
  state.currentTask = null;
  clearArchive();
  addChatMessage('agent', i18n('agent_new_chat'));
  document.getElementById('chatSuggestions').style.display = '';
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ─── Monitor Panel ───────────────────────────────────────────────────

function startMonitor(data) {
  document.getElementById('monitorEmpty').style.display = 'none';
  document.getElementById('monitorSteps').style.display = '';
  document.getElementById('monitorStatus').textContent = i18n('status_working');
  document.getElementById('monitorStatus').className = 'aws-panel-status working';

  const plan = data.plan || [];
  const stepsEl = document.getElementById('progressSteps');
  stepsEl.innerHTML = '';

  plan.forEach((step, idx) => {
    const desc = state.lang === 'ar' ? step.description_ar : step.description_en;
    const div = document.createElement('div');
    div.className = `aws-progress-step ${idx === 0 ? 'active' : 'pending'}`;
    div.id = `step-${step.id}`;
    div.innerHTML = `
      <div class="aws-step-icon ${idx === 0 ? 'active' : 'pending'}">${idx === 0 ? '⏳' : '○'}</div>
      <span>${desc || step.action}</span>
    `;
    stepsEl.appendChild(div);
  });
}

function updateMonitorFromTask(taskData) {
  const agents = taskData.agents || [];
  const messages = taskData.messages || [];

  const agentsEl = document.getElementById('monitorAgents');
  agentsEl.innerHTML = '';

  agents.forEach(agent => {
    const card = document.createElement('div');
    card.className = 'aws-agent-card';

    const statusDot = agent.status === 'done' ? 'done' :
                      agent.status === 'failed' ? 'failed' :
                      agent.status === 'negotiating' ? 'negotiating' : 'searching';

    const foundText = agent.findings?.count
      ? (state.lang === 'ar' ? `وجد ${agent.findings.count} نتيجة` : `Found ${agent.findings.count} results`)
      : '';

    card.innerHTML = `
      <div class="aws-agent-card-header">
        <div class="aws-agent-name">
          <span class="dot ${statusDot}"></span>
          ${agent.agent_name}
        </div>
        <span style="font-size:0.7rem;color:#64748b">${agent.progress || 0}%</span>
      </div>
      <div class="aws-agent-progress">
        <div class="aws-agent-progress-bar" style="width:${agent.progress || 0}%"></div>
      </div>
      ${foundText ? `<div class="aws-agent-finding">${foundText}</div>` : ''}
    `;
    agentsEl.appendChild(card);
  });

  const status = taskData.status;
  const stepMap = { searching: 1, comparing: 2, negotiating: 3, presenting: 4 };
  const currentStep = stepMap[status] || 0;

  document.querySelectorAll('.aws-progress-step').forEach((el, idx) => {
    const stepNum = idx + 1;
    if (stepNum < currentStep) {
      el.className = 'aws-progress-step completed';
      el.querySelector('.aws-step-icon').className = 'aws-step-icon completed';
      el.querySelector('.aws-step-icon').textContent = '✓';
    } else if (stepNum === currentStep) {
      el.className = 'aws-progress-step active';
      el.querySelector('.aws-step-icon').className = 'aws-step-icon active';
      el.querySelector('.aws-step-icon').textContent = '⏳';
    }
  });

  const negEl = document.getElementById('monitorNegotiations');
  const negLabel = state.lang === 'ar' ? '🤝 تفاوض' : '🤝 Negotiation';
  const updateLabel = state.lang === 'ar' ? '🔍 تحديث' : '🔍 Update';

  messages.filter(m => m.metadata?.type === 'progress' || m.role === 'agent').forEach(m => {
    if (!document.getElementById(`neg-${m.id}`)) {
      const round = document.createElement('div');
      round.className = 'aws-neg-round';
      round.id = `neg-${m.id}`;
      round.innerHTML = `
        <div class="aws-neg-round-header">
          <span>${m.metadata?.step === 'negotiate' ? negLabel : updateLabel}</span>
          <span>${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="aws-neg-round-body">${m.content}</div>
      `;
      negEl.appendChild(round);
    }
  });
}

function updateMonitorFromWs(data) {
  if (data.step) {
    const agentsEl = document.getElementById('monitorAgents');
    const card = document.createElement('div');
    card.className = 'aws-agent-card';
    card.innerHTML = `
      <div class="aws-agent-card-header">
        <div class="aws-agent-name">
          <span class="dot searching"></span>
          ${data.agent || 'Agent'}
        </div>
      </div>
      <div class="aws-agent-progress">
        <div class="aws-agent-progress-bar" style="width:${data.progress || 50}%"></div>
      </div>
      <div class="aws-agent-finding">${data.message || ''}</div>
    `;
    agentsEl.appendChild(card);
  }
}

function updateMonitorComplete() {
  document.getElementById('monitorStatus').textContent = i18n('status_done');
  document.getElementById('monitorStatus').className = 'aws-panel-status active';

  document.querySelectorAll('.aws-progress-step').forEach(el => {
    el.className = 'aws-progress-step completed';
    const icon = el.querySelector('.aws-step-icon');
    if (icon) {
      icon.className = 'aws-step-icon completed';
      icon.textContent = '✓';
    }
  });
}

/**
 * Animate monitor steps from searching → comparing → negotiating → done
 * Gives the user a visual sense of progress even when the server returns results instantly.
 */
function animateMonitorProgress(data) {
  const steps = document.querySelectorAll('.aws-progress-step');
  if (steps.length === 0) return;

  const updates = data.updates || [];
  const agentsEl = document.getElementById('monitorAgents');
  const negEl = document.getElementById('monitorNegotiations');

  document.getElementById('monitorStatus').textContent = i18n('status_working');
  document.getElementById('monitorStatus').className = 'aws-panel-status working';

  let delay = 0;
  const stepDelay = 800;

  steps.forEach((step, idx) => {
    setTimeout(() => {
      // Mark previous steps as completed
      for (let i = 0; i < idx; i++) {
        steps[i].className = 'aws-progress-step completed';
        const icon = steps[i].querySelector('.aws-step-icon');
        if (icon) { icon.className = 'aws-step-icon completed'; icon.textContent = '✓'; }
      }
      // Mark current step as active
      step.className = 'aws-progress-step active';
      const icon = step.querySelector('.aws-step-icon');
      if (icon) { icon.className = 'aws-step-icon active'; icon.textContent = '⏳'; }

      // Show agent cards during search step
      if (idx === 0 && data.offers) {
        agentsEl.innerHTML = '';
        const sources = [...new Set(data.offers.map(o => o.source))];
        sources.forEach(src => {
          const card = document.createElement('div');
          card.className = 'aws-agent-card';
          card.innerHTML = `
            <div class="aws-agent-card-header">
              <div class="aws-agent-name"><span class="dot searching"></span>${src} Agent</div>
              <span style="font-size:0.7rem;color:#64748b">searching...</span>
            </div>
            <div class="aws-agent-progress"><div class="aws-agent-progress-bar" style="width:50%"></div></div>
          `;
          agentsEl.appendChild(card);
        });
      }

      // Update agent cards to done during compare step
      if (idx === 1) {
        agentsEl.querySelectorAll('.dot').forEach(d => d.className = 'dot done');
        agentsEl.querySelectorAll('.aws-agent-progress-bar').forEach(b => b.style.width = '100%');
        agentsEl.querySelectorAll('.aws-agent-card-header span:last-child').forEach(s => {
          s.textContent = state.lang === 'ar' ? 'تم' : 'done';
        });
      }

      // Show negotiation details
      if (idx >= 2 && updates.length > 0) {
        updates.forEach(u => {
          if (u.message && !document.querySelector(`[data-update-msg="${u.step}"]`)) {
            const round = document.createElement('div');
            round.className = 'aws-neg-round';
            round.setAttribute('data-update-msg', u.step || idx);
            round.innerHTML = `
              <div class="aws-neg-round-header"><span>${u.step === 'negotiate' ? '🤝' : '🔍'}</span>
              <span>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
              <div class="aws-neg-round-body">${u.message}</div>
            `;
            negEl.appendChild(round);
          }
        });
      }
    }, delay);
    delay += stepDelay;
  });

  // Final: mark all completed
  setTimeout(() => {
    updateMonitorComplete();
  }, delay + 300);
}

function updateMonitorFailed() {
  document.getElementById('monitorStatus').textContent = i18n('status_failed');
  document.getElementById('monitorStatus').className = 'aws-panel-status idle';
}

// ─── Results Panel ───────────────────────────────────────────────────

function showResults(data) {
  const offers = data.offers || [];
  if (offers.length === 0) return;

  document.getElementById('resultsEmpty').style.display = 'none';
  document.getElementById('resultsStatus').textContent = `${offers.length} ${state.lang === 'ar' ? 'نتائج' : 'results'}`;
  document.getElementById('resultsStatus').className = 'aws-panel-status active';

  const cardsEl = document.getElementById('resultsCards');
  cardsEl.innerHTML = '';

  offers.forEach((offer, idx) => {
    const card = document.createElement('div');
    card.className = `aws-result-card ${idx === 0 ? 'recommended' : ''}`;

    // Normalize price — handle "$95/night", "$285", or numeric values
    const rawPrice = offer.price || offer.finalPrice || offer.final_price;
    const priceNum = offer.priceNum || parseFloat(String(rawPrice).replace(/[^\d.]/g, '')) || null;
    const priceDisplay = rawPrice ? String(rawPrice) : (priceNum ? `$${priceNum}` : '');

    // Calculate savings from negotiation
    const origPriceNum = offer.negotiation?.originalPrice
      ? parseFloat(String(offer.negotiation.originalPrice).replace(/[^\d.]/g, ''))
      : priceNum;
    const negPrice = offer.negotiation?.negotiatedPrice || priceNum;
    const savings = origPriceNum && negPrice && origPriceNum > negPrice
      ? (origPriceNum - negPrice).toFixed(0) : null;
    const savingsPct = savings && origPriceNum ? Math.round((savings / origPriceNum) * 100) : null;

    // Rating display
    const rating = offer.rating ? `⭐ ${offer.rating}` : '';

    // Details chips
    const details = offer.details || [];
    const detailsHtml = details.length > 0
      ? `<div class="aws-result-details">${details.map(d => `<span class="aws-result-detail">${d}</span>`).join('')}</div>`
      : '';

    card.innerHTML = `
      ${idx === 0 ? `<span class="aws-result-badge best">${i18n('result_best')}</span>` : ''}
      ${savingsPct && savingsPct > 0 ? `<span class="aws-result-badge savings">${savingsPct}% ${i18n('result_savings')}</span>` : ''}
      
      <div class="aws-result-title">
        ${offer.title || offer.name || 'Offer ' + (idx + 1)}
        <span class="aws-result-source">${offer.source || ''}</span>
      </div>

      ${rating ? `<div class="aws-result-rating">${rating}</div>` : ''}
      
      <div class="aws-result-prices">
        ${savings > 0 ? `<span class="aws-result-original">$${origPriceNum}</span>` : ''}
        <span class="aws-result-final">${priceDisplay || '—'}</span>
        ${offer.totalPrice ? `<span class="aws-result-total">(${state.lang === 'ar' ? 'المجموع' : 'total'}: $${offer.totalPrice})</span>` : ''}
        ${savings > 0 ? `<span class="aws-result-savings-tag">${i18n('result_save')} $${savings}</span>` : ''}
      </div>

      ${detailsHtml}
      
      <div class="aws-result-actions">
        <a href="${sanitizeUrl(offer.url || '#')}" target="_blank" rel="noopener" class="aws-result-btn primary" 
           onclick="trackClick(${idx})">
          ${i18n('result_open')}
        </a>
        <button class="aws-result-btn agent-do" onclick="agentExecuteDeal(${idx})">
          ${i18n('result_agent_do')}
        </button>
        <button class="aws-result-btn secondary" onclick="openInBrowser(${idx})">
          ${i18n('result_view')}
        </button>
      </div>
    `;
    cardsEl.appendChild(card);
  });

  showTips(offers);

  const summaryEl = document.getElementById('resultsSummary');
  summaryEl.style.display = '';
  document.getElementById('summaryCount').textContent = offers.length;

  if (offers[0]) {
    const best = offers[0];
    const neg = best.negotiation;
    if (neg && neg.savings) {
      document.getElementById('summaryBestSaving').textContent = `$${neg.savings}`;
    } else {
      document.getElementById('summaryBestSaving').textContent = '-';
    }
  }

  if (state.taskStartTime) {
    const elapsed = Math.round((Date.now() - state.taskStartTime) / 1000);
    document.getElementById('summaryTime').textContent = `${elapsed}s`;
  }

  state.currentOffers = offers;

  // On mobile, auto-switch to results panel
  if (window.innerWidth <= 768) {
    switchMobilePanel(3, document.querySelectorAll('.aws-mobile-nav-item')[3]);
  }
}

function showTips(offers) {
  const tipsArea = document.getElementById('tipsArea');
  tipsArea.style.display = '';

  const tips = [i18n('tip_weekday'), i18n('tip_agent_do')];
  if (offers.length > 1) tips.push(i18n('tip_compare'));
  tips.push(i18n('tip_login'));

  tipsArea.innerHTML = `
    <div class="aws-tips-section">
      <h4>${i18n('tips_title')}</h4>
      ${tips.map(t => `<div class="aws-tip-item">${t}</div>`).join('')}
    </div>
  `;
}

function showLoginRequest(site, offerIndex) {
  const area = document.getElementById('loginRequestArea');
  area.style.display = '';
  area.innerHTML = `
    <div class="aws-login-request">
      <h4>${i18n('agent_login_required')}</h4>
      <p>${i18n('agent_login_site', { site })}</p>
      <div class="aws-login-options">
        <button class="aws-login-option-btn agent-login" onclick="agentLogin(${offerIndex})">
          ${i18n('agent_give_creds')}
        </button>
        <button class="aws-login-option-btn manual-login" onclick="manualLogin(${offerIndex})">
          ${i18n('agent_manual_login')}
        </button>
      </div>
    </div>
  `;
}

// ─── Deal Execution ──────────────────────────────────────────────────

function trackClick(index) {
  try {
    apiFetch('/api/license/track', {
      method: 'POST',
      body: JSON.stringify({ action: 'deal_click', index, sessionId: state.sessionId }),
    });
  } catch (_) {}
}

async function agentExecuteDeal(index) {
  const offer = state.currentOffers?.[index];
  if (!offer) return;

  addChatMessage('system', i18n('agent_deal_start', { source: offer.source }));

  if (offer.requiresLogin) {
    showLoginRequest(offer.source, index);
    addChatMessage('agent', i18n('agent_deal_login', { source: offer.source }));
    return;
  }

  if (offer.url) navigateTo(offer.url);

  addChatMessage('agent', i18n('agent_deal_opened', { price: offer.finalPrice || offer.price }));
}

function agentLogin(index) {
  addChatMessage('agent', i18n('agent_creds_request'));
  state.currentTask = { ...state.currentTask, awaitingLogin: true, offerIndex: index };
}

function manualLogin(index) {
  const offer = state.currentOffers?.[index];
  if (offer?.url) {
    navigateTo(offer.url);
    addChatMessage('agent', i18n('agent_manual_opened'));
  }
}

function openInBrowser(index) {
  const offer = state.currentOffers?.[index];
  if (offer?.url) navigateTo(offer.url);
}

// ─── Browser Panel ───────────────────────────────────────────────────

function navigateTo(url) {
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }

  const urlInput = document.getElementById('urlInput');
  const frame = document.getElementById('browserFrame');
  const empty = document.getElementById('browserEmpty');

  urlInput.value = url;
  empty.style.display = 'none';
  frame.style.display = '';
  frame.src = url;

  document.getElementById('browserStatus').textContent = i18n('status_loading');
  document.getElementById('browserStatus').className = 'aws-panel-status working';

  frame.onload = () => {
    document.getElementById('browserStatus').textContent = i18n('status_loaded');
    document.getElementById('browserStatus').className = 'aws-panel-status active';
    updateUrlLock(url);
  };
}

function updateUrlLock(url) {
  const lock = document.getElementById('urlLock');
  lock.textContent = url.startsWith('https://') ? '🔒' : '⚠️';
  lock.style.color = url.startsWith('https://') ? '#10b981' : '#f59e0b';
}

function browserBack() {
  const frame = document.getElementById('browserFrame');
  try { frame.contentWindow.history.back(); } catch (_) {}
}

function browserForward() {
  const frame = document.getElementById('browserFrame');
  try { frame.contentWindow.history.forward(); } catch (_) {}
}

function refreshBrowser() {
  const frame = document.getElementById('browserFrame');
  try { frame.contentWindow.location.reload(); } catch (_) {
    if (frame.src) frame.src = frame.src;
  }
}

// ─── Layout ──────────────────────────────────────────────────────────

function setLayout(layout) {
  state.layout = layout;
  const ws = document.getElementById('workspace');
  ws.className = 'aws-workspace';
  if (layout !== 'grid') ws.classList.add(`layout-${layout}`);

  document.querySelectorAll('.aws-layout-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
}

function maximizePanel(panelId) {
  const panel = document.getElementById(panelId);
  if (panel.style.gridColumn === '1 / -1') {
    panel.style.gridColumn = '';
    panel.style.gridRow = '';
    document.querySelectorAll('.aws-panel').forEach(p => p.style.display = '');
  } else {
    document.querySelectorAll('.aws-panel').forEach(p => {
      if (p.id !== panelId) p.style.display = 'none';
    });
    panel.style.gridColumn = '1 / -1';
    panel.style.gridRow = '1 / -1';
  }
}

// ─── Mobile ──────────────────────────────────────────────────────────

function switchMobilePanel(index, btn) {
  state.activeMobilePanel = index;
  const panels = document.querySelectorAll('.aws-panel');
  panels.forEach((p, idx) => p.classList.toggle('active-mobile', idx === index));

  document.querySelectorAll('.aws-mobile-nav-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function toggleMobileMenu() {
  const nav = document.getElementById('mobileNav');
  nav.style.display = nav.style.display === 'flex' ? 'none' : 'flex';
}

// ─── Language ────────────────────────────────────────────────────────

function toggleLang() {
  state.lang = state.lang === 'ar' ? 'en' : 'ar';
  localStorage.setItem('wab_lang', state.lang);
  setDirection();
  applyI18n();
  injectWelcomeMessage();
  showToast(state.lang === 'ar' ? i18n('toast_lang_ar') : i18n('toast_lang_en'), 'info');
}

function setDirection() {
  const body = document.querySelector('.aws-body');
  const html = document.documentElement;
  if (state.lang === 'ar') {
    body.setAttribute('dir', 'rtl');
    html.setAttribute('dir', 'rtl');
    html.setAttribute('lang', 'ar');
  } else {
    body.setAttribute('dir', 'ltr');
    html.setAttribute('dir', 'ltr');
    html.setAttribute('lang', 'en');
  }
}

// ─── Settings ────────────────────────────────────────────────────────

function toggleSettings() {
  showToast(i18n('toast_settings'), 'info');
}

// ─── Toast ───────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `aws-toast ${type} visible`;
  setTimeout(() => toast.classList.remove('visible'), 3500);
}

// ─── API Helper ──────────────────────────────────────────────────────

function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  return fetch(`${API}${path}`, { ...options, headers });
}

// ─── Security ────────────────────────────────────────────────────────

function sanitizeUrl(url) {
  if (!url) return '#';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '#';
    return parsed.href;
  } catch (_) {
    return '#';
  }
}

// ─── Offline Fallback Agent ──────────────────────────────────────────

function offlineFallbackReply(message) {
  const msg = message.toLowerCase();
  const isAr = /[\u0600-\u06FF]/.test(message);

  // URL detection: open in browser panel
  const urlMatch = message.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    return isAr
      ? `🔗 فتحت الرابط في المتصفح.\n\n📡 الوكيل غير متصل حالياً بالخادم. يمكنك تصفح الصفحة مباشرة من لوحة المتصفح.`
      : `🔗 Opened the link in the browser.\n\n📡 Agent is currently offline. You can browse the page directly from the Browser panel.`;
  }

  // Search/booking requests
  if (/ابحث|بحث|فندق|فنادق|رحل|طيران|حجز|احجز|hotel|flight|book|search|find/i.test(msg)) {
    const query = message.replace(/ابحث عن|ابحث|بحث عن|search for|find|look for/gi, '').trim();
    if (query.length > 2) {
      navigateTo(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    }
    return isAr
      ? `🔍 بحثت لك عن "${query}" — النتائج تظهر في لوحة المتصفح.\n\n📡 حالياً أعمل في الوضع المحلي. عند اتصال الخادم، سأتفاوض وأقارن الأسعار تلقائياً.`
      : `🔍 Searched for "${query}" — results shown in the Browser panel.\n\n📡 Currently in offline mode. When the server connects, I'll auto-negotiate and compare prices.`;
  }

  // Shopping requests
  if (/اشتري|شراء|سعر|أسعار|مقارن|لابتوب|laptop|buy|price|compare|iphone|shop/i.test(msg)) {
    const query = message.replace(/اشتري|شراء|buy|compare prices|قارن أسعار/gi, '').trim();
    if (query.length > 2) {
      navigateTo(`https://www.google.com/search?q=${encodeURIComponent(query + ' price')}`);
    }
    return isAr
      ? `🛒 أبحث عن أسعار "${query}" — راجع المتصفح.\n\n💡 نصيحة: عند الاتصال بالخادم، سأقارن الأسعار من عدة مصادر وأوجد لك أفضل صفقة.`
      : `🛒 Searching prices for "${query}" — check the Browser panel.\n\n💡 Tip: When connected to the server, I'll compare prices from multiple sources to find the best deal.`;
  }

  // Security check
  if (/أمان|آمن|safe|security|scam|احتيال/i.test(msg)) {
    return isAr
      ? `🔒 لفحص أمان موقع، الصق الرابط هنا وسأحلله عند اتصال الخادم.\n\n💡 تأكد دائماً من وجود 🔒 في شريط العنوان (HTTPS).`
      : `🔒 To check a site's security, paste the link here and I'll analyze it when the server connects.\n\n💡 Always look for 🔒 in the address bar (HTTPS).`;
  }

  // General greeting/help
  if (/مرحب|هلا|سلام|أهلا|hi|hello|hey|help|مساعد/i.test(msg)) {
    return isAr
      ? `🤖 أهلاً! أنا وكيل WAB الذكي. يمكنني مساعدتك في:\n\n• 🔍 البحث عن أي شيء\n• ✈️ حجز رحلات وفنادق\n• 🛒 مقارنة الأسعار\n• 🔒 فحص أمان المواقع\n\nاكتب ما تحتاجه بأي لغة!`
      : `🤖 Hello! I'm WAB Smart Agent. I can help with:\n\n• 🔍 Searching for anything\n• ✈️ Booking flights & hotels\n• 🛒 Comparing prices\n• 🔒 Security checks\n\nType what you need in any language!`;
  }

  // Navigate if it looks like a search
  if (msg.length > 3) {
    navigateTo(`https://www.google.com/search?q=${encodeURIComponent(message)}`);
    return isAr
      ? `🔍 بحثت عن "${message}" — راجع النتائج في لوحة المتصفح.\n\n📡 عند اتصال الخادم، سأقدم نتائج أذكى مع تفاوض ومقارنة.`
      : `🔍 Searched for "${message}" — check results in the Browser panel.\n\n📡 When the server connects, I'll provide smarter results with negotiation and comparison.`;
  }

  return isAr
    ? `🤖 أنا هنا لمساعدتك! اكتب ما تريد البحث عنه أو الصق رابطاً.`
    : `🤖 I'm here to help! Type what you want to search for or paste a link.`;
}

// ─── Dynamic Pricing Shield UI ───────────────────────────────────────

/**
 * Show the Price Shield scanning overlay in the monitor panel.
 * Call this when the agent starts a multi-identity price scan.
 */
function showPriceShield(scanData) {
  const section = document.getElementById('priceShieldSection');
  const statusEl = document.getElementById('shieldStatus');
  const probesEl = document.getElementById('shieldProbes');
  const resultEl = document.getElementById('shieldResult');
  const badgeEl = document.getElementById('shieldBadge');
  if (!section) return;

  section.style.display = 'block';
  badgeEl.textContent = '';
  badgeEl.className = 'aws-shield-badge';
  resultEl.innerHTML = '';

  const personaCount = scanData?.personas?.length || 12;
  statusEl.innerHTML = `<div class="aws-shield-scanning">${i18n('shield_scanning', { count: personaCount })}</div>`;
  probesEl.innerHTML = '';

  // Scroll monitor into view
  document.getElementById('monitorEmpty')?.style && (document.getElementById('monitorEmpty').style.display = 'none');
}

/**
 * Update a single probe result as it comes in.
 */
function updateShieldProbe(personaLabel, price, currency = 'USD') {
  const probesEl = document.getElementById('shieldProbes');
  if (!probesEl) return;

  const div = document.createElement('div');
  div.className = 'aws-shield-probe-item';
  const priceStr = price != null ? `${currency === 'USD' ? '$' : currency}${price}` : '—';
  div.textContent = i18n('shield_probe_done', { persona: personaLabel, price: priceStr });
  probesEl.appendChild(div);
}

/**
 * Show the final Price Shield analysis result.
 */
function showShieldResult(analysis) {
  const statusEl = document.getElementById('shieldStatus');
  const resultEl = document.getElementById('shieldResult');
  const badgeEl = document.getElementById('shieldBadge');
  if (!resultEl) return;

  statusEl.innerHTML = '';

  if (!analysis || !analysis.manipulation || !analysis.manipulation.detected) {
    badgeEl.textContent = '✅';
    badgeEl.className = 'aws-shield-badge shield-clean';
    resultEl.innerHTML = `<div class="aws-shield-clean">${i18n('shield_clean')}</div>`;
    return;
  }

  const m = analysis.manipulation;
  const p = analysis.prices;
  const r = analysis.recommendation;

  const levelKey = `shield_level_${m.level || 'none'}`;
  const levelText = I18N[levelKey] ? i18n(levelKey) : m.level;

  // Badge
  const badgeClass = m.score >= 70 ? 'shield-severe' : m.score >= 45 ? 'shield-significant' : m.score >= 20 ? 'shield-moderate' : 'shield-minor';
  badgeEl.textContent = `${m.score}/100`;
  badgeEl.className = `aws-shield-badge ${badgeClass}`;

  let html = `<div class="aws-shield-alert">
    <div class="aws-shield-alert-title">${i18n('shield_detected')}</div>
    <div class="aws-shield-score">${i18n('shield_score', { score: m.score, level: levelText })}</div>
    <div class="aws-shield-spread">${i18n('shield_spread', { lowest: p.lowest, highest: p.highest, pct: p.spreadPct })}</div>`;

  if (r && r.bestPrice) {
    html += `<div class="aws-shield-best">${i18n('shield_best_price', { price: r.bestPrice, persona: r.bestPersonaLabel || r.bestPersona })}</div>`;
    if (r.savings > 0) {
      html += `<div class="aws-shield-savings">${i18n('shield_savings', { amount: r.savings.toFixed(2), pct: r.savingsPct })}</div>`;
    }
  }

  // Tips from strategy
  if (r && r.strategy && r.strategy.tips && r.strategy.tips.length > 0) {
    html += `<div class="aws-shield-tips">`;
    for (const tip of r.strategy.tips) {
      html += `<div class="aws-shield-tip">💡 ${escapeHtml(tip)}</div>`;
    }
    html += `</div>`;
  }

  // Manipulation types
  if (analysis.manipulations && analysis.manipulations.length > 0) {
    html += `<div class="aws-shield-types">`;
    for (const manip of analysis.manipulations) {
      const severityClass = `severity-${manip.severity}`;
      html += `<div class="aws-shield-type-item ${severityClass}">
        <span class="aws-shield-type-label">${escapeHtml(manip.type.replace(/_/g, ' '))}</span>
        <span class="aws-shield-type-severity">${manip.severity}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // Probe comparison table
  if (analysis.probes && analysis.probes.length > 0) {
    html += `<div class="aws-shield-probes-table"><table>
      <tr><th>${state.lang === 'ar' ? 'الهوية' : 'Identity'}</th><th>${state.lang === 'ar' ? 'السعر' : 'Price'}</th></tr>`;
    const sortedProbes = [...analysis.probes].sort((a, b) => (a.price || 999999) - (b.price || 999999));
    for (const probe of sortedProbes) {
      const isBest = probe.price === p.lowest;
      const isWorst = probe.price === p.highest;
      const cls = isBest ? 'probe-best' : isWorst ? 'probe-worst' : '';
      html += `<tr class="${cls}">
        <td>${escapeHtml(probe.label)}</td>
        <td>${probe.price != null ? '$' + probe.price : '—'}${isBest ? ' ⭐' : ''}${isWorst ? ' ⚠️' : ''}</td>
      </tr>`;
    }
    html += `</table></div>`;
  }

  html += `</div>`;
  resultEl.innerHTML = html;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
