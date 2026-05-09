/* activate.js — WAB DNS Discovery Activation Page (v3.4.1) */
(function () {
  'use strict';

  // ─── i18n ──────────────────────────────────────────────────────────
  var i18n = {
    en: {
      nav_home: 'Home', nav_integrations: 'Integrations', nav_dns: 'DNS Discovery',
      nav_phone: 'Phone Shield', nav_sovereign: 'Sovereign', nav_docs: 'Docs',
      hero_title: 'Activate WAB Discovery<br><span class="gradient-text">in One Click</span>',
      hero_sub: 'Add a single DNS TXT record and make your website instantly discoverable by AI agents — no code changes required.',
      cta_guide: 'View Setup Guide', cta_verify: 'Live Verifier',
      video_title: 'Watch: Full Setup in 40 Seconds',
      video_fallback: 'Your browser does not support the video tag.',
      steps_title: 'Step-by-Step Setup Guide',

      // Step 1 — wab.json (with Adoption Agent generator)
      step1_title: 'Create your <code style="color:#a5f3fc">/.well-known/wab.json</code> file',
      step1_desc: 'This file lives on your web server and tells AI agents what your site can do. We\'ll generate one for you — paste your URL and click <strong>Generate</strong>. No data is stored.',
      step1_path: 'Save the generated JSON at this exact path on your server: <code style="color:#a5f3fc">/.well-known/wab.json</code> — the URL must respond with <code style="color:#a5f3fc">Content-Type: application/json</code>.',
      gen_btn: 'Generate wab.json',

      // Step 2 — DNS provider + Cloudflare
      step2_title: 'Open your DNS provider\'s control panel',
      step2_desc: 'Sign in to whoever hosts your DNS (often the same place where you bought your domain). Find the <strong>DNS</strong> or <strong>DNS Records</strong> page.',
      prov_cloudflare: 'Go to <strong>dash.cloudflare.com</strong> → select your domain → click <strong>DNS → Records</strong> in the side menu → click <strong>Add record</strong>.',
      prov_cpanel: 'Log in to cPanel → in the <strong>Domains</strong> section open <strong>Zone Editor</strong> → click <strong>Manage</strong> next to your domain → click <strong>Add Record</strong> and choose <strong>TXT</strong>.',
      prov_godaddy: 'Log in to <strong>godaddy.com</strong> → My Products → click <strong>DNS</strong> next to your domain → <strong>Add New Record</strong>.',
      prov_namecheap: 'Log in to <strong>namecheap.com</strong> → Domain List → <strong>Manage</strong> → <strong>Advanced DNS</strong> tab → <strong>Add New Record</strong>.',
      cf_title: '⚠ Cloudflare-specific tips (read this if you use Cloudflare):',
      cf_tip1: '<strong>Page Rules / Cache Rules:</strong> add a rule for <code>*example.com/.well-known/*</code> with <strong>Cache Level: Bypass</strong>. Otherwise your wab.json updates can stay stale for hours.',
      cf_tip2: '<strong>Email Address Obfuscation:</strong> turn it <strong>OFF</strong> for the <code>/.well-known/</code> path (Scrape Shield → Email Obfuscation). It rewrites JSON content and breaks parsing.',
      cf_tip3: '<strong>Always Use HTTPS:</strong> keep it ON, but make sure your origin actually serves the file on HTTPS — otherwise Cloudflare returns a redirect loop.',
      cf_tip4: '<strong>The proxy (orange cloud) is fine for the website itself.</strong> The <code>_wab</code> TXT record has no proxy toggle (TXT records are always DNS-only).',

      // Step 3 — TXT generator
      step3_title: 'Add the <code style="color:#a5f3fc">_wab</code> TXT record',
      step3_desc: 'In the panel you just opened, create a new TXT record. Type your domain below and we\'ll fill in the exact values to copy/paste.',
      txt_type: 'Type:', txt_name: 'Name / Host:', txt_value: 'Value / Content:', txt_ttl: 'TTL:',
      copy: 'Copy', copied: 'Copied!',
      step3_propagate: '<strong>Propagation time:</strong> usually 1–5 minutes. In rare cases up to 24 hours if your old record had a long TTL. Some panels prepend your domain automatically — if you see <code>_wab.yourdomain.com.yourdomain.com</code> after saving, change <strong>Name</strong> to just <code>_wab</code>.',

      // Step 4 — Diagnostic
      step4_title: 'Verify everything works',
      step4_desc: 'Run a full diagnostic. We check the TXT record across three public DNS resolvers, fetch your wab.json, validate its JSON, and warn about Cloudflare cache or wrong Content-Type headers. If something is off, we tell you exactly what to fix.',
      verify_btn: 'Run Diagnostic',
      step4_note: 'If the very first check (<em>DNS TXT record at _wab</em>) fails, give DNS another 1–2 minutes and try again — propagation is the most common culprit.',

      // CTA
      cta_title: 'Your Domain is Now AI-Ready',
      cta_desc: 'Once verified, AI agents using the WAB protocol can discover your site\'s capabilities automatically — no manual configuration needed on their end.',
      cta_full_guide: 'Full DNS Guide', cta_docs: 'Read the Docs',

      // Diagnostic UI
      diag_running: 'Running diagnostic… attempt {n} of {max}',
      diag_passed_all: '✓ All checks passed — your domain is fully AI-ready',
      diag_passed_with_warnings: '⚠ Working, but with warnings (see below)',
      diag_failed: '✗ Some checks failed — see the diagnostic table below',
      diag_summary: '<strong>{pass}</strong> passed · <strong>{warn}</strong> warnings · <strong>{fail}</strong> failed · {info} info',
      diag_fix: 'Fix:',
      diag_endpoint: 'Endpoint',

      // Generator UI
      gen_running: 'Analyzing your site…',
      gen_success: '✓ Your wab.json was generated. Save it at <code>/.well-known/wab.json</code> on your web server.',
      gen_failed: 'We couldn\'t analyze that URL. You can still use the example below as a starting point.',
      gen_download: 'Download wab.json'
    },
    ar: {
      nav_home: 'الرئيسية', nav_integrations: 'التكاملات', nav_dns: 'اكتشاف DNS',
      nav_phone: 'درع الهاتف', nav_sovereign: 'سيادي', nav_docs: 'التوثيق',
      hero_title: 'فعّل اكتشاف WAB<br><span class="gradient-text">بنقرة واحدة</span>',
      hero_sub: 'أضِف سجل DNS TXT واحدًا واجعل موقعك قابلًا للاكتشاف فورًا من قِبَل وكلاء الذكاء الاصطناعي — دون أي تعديل في الكود.',
      cta_guide: 'دليل الإعداد', cta_verify: 'المدقّق المباشر',
      video_title: 'شاهد: الإعداد الكامل في 40 ثانية',
      video_fallback: 'متصفّحك لا يدعم تشغيل الفيديو.',
      steps_title: 'دليل الإعداد خطوة بخطوة',

      // Step 1
      step1_title: 'أنشئ ملف <code style="color:#a5f3fc">/.well-known/wab.json</code>',
      step1_desc: 'يوجد هذا الملف على خادم موقعك ويُخبر وكلاء الذكاء الاصطناعي بما يستطيع موقعك فعله. سننشئه نيابةً عنك — الصق رابط موقعك واضغط <strong>إنشاء</strong>. لا نحفظ أي بيانات.',
      step1_path: 'احفظ الـ JSON المُنشأ في هذا المسار بالضبط على خادمك: <code style="color:#a5f3fc">/.well-known/wab.json</code> — ويجب أن يستجيب الرابط بترويسة <code style="color:#a5f3fc">Content-Type: application/json</code>.',
      gen_btn: 'إنشاء wab.json',

      // Step 2
      step2_title: 'افتح لوحة تحكّم مزوّد DNS',
      step2_desc: 'سجّل الدخول إلى الجهة التي تستضيف DNS الخاص بك (غالبًا نفس الجهة التي اشتريت منها النطاق). افتح صفحة <strong>DNS</strong> أو <strong>سجلات DNS</strong>.',
      prov_cloudflare: 'اذهب إلى <strong>dash.cloudflare.com</strong> ← اختر نطاقك ← من القائمة الجانبية اضغط <strong>DNS ← Records</strong> ← اضغط <strong>Add record</strong>.',
      prov_cpanel: 'سجّل الدخول إلى cPanel ← في قسم <strong>Domains</strong> افتح <strong>Zone Editor</strong> ← اضغط <strong>Manage</strong> بجانب نطاقك ← اضغط <strong>Add Record</strong> واختر <strong>TXT</strong>.',
      prov_godaddy: 'سجّل الدخول إلى <strong>godaddy.com</strong> ← My Products ← اضغط <strong>DNS</strong> بجانب نطاقك ← <strong>Add New Record</strong>.',
      prov_namecheap: 'سجّل الدخول إلى <strong>namecheap.com</strong> ← Domain List ← <strong>Manage</strong> ← تبويب <strong>Advanced DNS</strong> ← <strong>Add New Record</strong>.',
      cf_title: '⚠ ملاحظات خاصة بـ Cloudflare (اقرأها إذا كنت تستخدم Cloudflare):',
      cf_tip1: '<strong>قواعد الصفحات / Cache Rules:</strong> أضف قاعدة على المسار <code>*example.com/.well-known/*</code> بقيمة <strong>Cache Level: Bypass</strong>. وإلا قد تبقى تحديثات wab.json مخزّنة في الكاش لساعات.',
      cf_tip2: '<strong>تشويش البريد الإلكتروني (Email Address Obfuscation):</strong> أوقفه <strong>OFF</strong> على مسار <code>/.well-known/</code> (Scrape Shield ← Email Obfuscation)، لأنه يُعدِّل محتوى JSON ويُعطّل تحليله.',
      cf_tip3: '<strong>Always Use HTTPS:</strong> اتركه مُفعّلاً، لكن تأكّد أنّ خادم الأصل (Origin) فعلاً يُقدّم الملف عبر HTTPS — وإلا ستحدث حلقة إعادة توجيه.',
      cf_tip4: '<strong>الـ Proxy (السحابة البرتقالية) لا مشكلة فيها للموقع نفسه.</strong> أمّا سجل <code>_wab</code> من نوع TXT فلا يوجد عليه مفتاح Proxy أصلاً (سجلات TXT دائمًا DNS فقط).',

      // Step 3
      step3_title: 'أضِف سجل TXT باسم <code style="color:#a5f3fc">_wab</code>',
      step3_desc: 'في اللوحة التي فتحتَها للتو، أنشئ سجل TXT جديدًا. اكتب نطاقك في الحقل أدناه وسنعبّئ القيم الدقيقة جاهزة للنسخ.',
      txt_type: 'النوع (Type):', txt_name: 'الاسم / Host:', txt_value: 'القيمة / المحتوى:', txt_ttl: 'TTL:',
      copy: 'نسخ', copied: 'تم النسخ!',
      step3_propagate: '<strong>زمن انتشار DNS:</strong> عادةً من 1 إلى 5 دقائق. وقد يصل في حالات نادرة إلى 24 ساعة إذا كان TTL القديم كبيرًا. بعض اللوحات تُضيف اسم النطاق تلقائيًا — إذا رأيت بعد الحفظ <code>_wab.yourdomain.com.yourdomain.com</code> فعدّل قيمة <strong>الاسم</strong> إلى <code>_wab</code> فقط.',

      // Step 4
      step4_title: 'تحقّق من أنّ كل شيء يعمل',
      step4_desc: 'سنُجري فحصًا شاملاً: نتحقّق من سجل TXT عبر ثلاثة محلِّلات DNS عامّة، ونجلب ملف wab.json، ونتحقّق من صحّته، وننبّهك إذا كان Cloudflare يخزّنه في الكاش أو إذا كانت ترويسة Content-Type خاطئة. وإن وُجد خطأ، سنُخبرك بالضبط بما يجب إصلاحه.',
      verify_btn: 'تشغيل الفحص',
      step4_note: 'إن فشل أوّل فحص (<em>سجل DNS TXT عند _wab</em>)، أمهِل DNS دقيقة أو دقيقتين ثم أعِد المحاولة — فالانتشار هو السبب الأكثر شيوعًا.',

      // CTA
      cta_title: 'نطاقك أصبح جاهزًا للذكاء الاصطناعي',
      cta_desc: 'بمجرّد التحقّق، يستطيع أي وكيل ذكاء اصطناعي يستخدم بروتوكول WAB أن يكتشف قدرات موقعك تلقائيًا — دون أي إعداد يدوي من جهته.',
      cta_full_guide: 'الدليل الكامل لـ DNS', cta_docs: 'اقرأ التوثيق',

      // Diagnostic
      diag_running: 'جارٍ الفحص… المحاولة {n} من {max}',
      diag_passed_all: '✓ نجحت جميع الفحوص — نطاقك جاهز تمامًا للذكاء الاصطناعي',
      diag_passed_with_warnings: '⚠ يعمل، ولكن مع تحذيرات (انظر الجدول أدناه)',
      diag_failed: '✗ فشِلَت بعض الفحوص — انظر الجدول التشخيصي أدناه',
      diag_summary: '<strong>{pass}</strong> ناجح · <strong>{warn}</strong> تحذير · <strong>{fail}</strong> فاشل · {info} معلومات',
      diag_fix: 'الحل:',
      diag_endpoint: 'نقطة النهاية',

      gen_running: 'نُحلّل موقعك…',
      gen_success: '✓ تم إنشاء wab.json. احفظه في المسار <code>/.well-known/wab.json</code> على خادم موقعك.',
      gen_failed: 'تعذّر تحليل هذا الرابط. يمكنك استخدام المثال أدناه كنقطة انطلاق.',
      gen_download: 'تنزيل wab.json'
    }
  };

  // Localized fix hints, keyed by check id from /api/diagnose
  var FIX_HINTS = {
    en: {
      dns_txt: 'Add a TXT record: Name=_wab, Value=v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json. Then wait 1–5 minutes.',
      dns_propagation: 'This is normal during the first 1–10 minutes after adding the record.',
      dnssec: 'Enable DNSSEC at your registrar (Cloudflare → DNS → Settings → DNSSEC). Optional.',
      txt_multi_segment: 'Re-paste the value as a single quoted string if your panel allows it.',
      txt_extra_quotes: 'Edit the TXT record and remove any leading/trailing quote marks from the Value field.',
      endpoint_https: 'Change your endpoint= URL to start with https:// (not http://).',
      wabjson_reachable: 'Make sure /.well-known/wab.json exists at the exact URL — and that your firewall/Cloudflare does not block it.',
      wabjson_content_type: 'Configure your server to send Content-Type: application/json for /.well-known/wab.json. (Many AI clients reject text/html.)',
      wabjson_valid: 'Validate the file at jsonlint.com — common mistakes: trailing commas, single quotes, BOM, comments.',
      wabjson_fields: 'Add the missing top-level fields. See https://www.webagentbridge.com/docs for the schema.',
      wabjson_signed: 'Optional: run `node scripts/sign-wab-domain.js` from the WAB repo to add an Ed25519 signature.',
      actions_count: 'Add at least one action to actions[] (e.g. "discovery", "search"). Use the generator in Step 1.',
      tls_cert: 'Renew your TLS certificate (Let\'s Encrypt is free and automatic).',
      cf_cache: 'Cloudflare is caching wab.json. Add a Page Rule: URL=*example.com/.well-known/* → Cache Level: Bypass.'
    },
    ar: {
      dns_txt: 'أضِف سجل TXT: Name=_wab، Value=v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json. ثم انتظر من 1 إلى 5 دقائق.',
      dns_propagation: 'هذا طبيعي خلال أوّل 1 إلى 10 دقائق بعد إضافة السجل.',
      dnssec: 'فعّل DNSSEC من لوحة المسجِّل (Cloudflare ← DNS ← Settings ← DNSSEC). اختياري.',
      txt_multi_segment: 'الصق القيمة كسلسلة واحدة بين علامتَي اقتباس إن سمحت لوحة التحكّم بذلك.',
      txt_extra_quotes: 'عدِّل سجل TXT واحذف أيّ علامات اقتباس زائدة من بداية أو نهاية الحقل Value.',
      endpoint_https: 'غيّر رابط endpoint= ليبدأ بـ https:// (وليس http://).',
      wabjson_reachable: 'تأكّد أنّ الملف /.well-known/wab.json موجود على هذا الرابط بالضبط، وأنّ Cloudflare أو الجدار الناري لا يحجبه.',
      wabjson_content_type: 'اضبط خادمك ليُرسل ترويسة Content-Type: application/json للمسار /.well-known/wab.json. (كثير من الوكلاء يرفضون text/html.)',
      wabjson_valid: 'تحقّق من الملف عبر jsonlint.com — أخطاء شائعة: فاصلة زائدة، اقتباسات مفردة، BOM، تعليقات.',
      wabjson_fields: 'أضف الحقول الأساسية الناقصة. الـ schema موضّح في https://www.webagentbridge.com/docs.',
      wabjson_signed: 'اختياري: شغّل `node scripts/sign-wab-domain.js` من مستودع WAB لإضافة توقيع Ed25519.',
      actions_count: 'أضف إجراءً واحدًا على الأقل في actions[] (مثل "discovery" أو "search"). استخدم المُولِّد في الخطوة 1.',
      tls_cert: 'جدِّد شهادة TLS (شهادات Let\'s Encrypt مجانية وتلقائية).',
      cf_cache: 'Cloudflare يُخزِّن wab.json في الكاش. أضِف Page Rule: URL=*example.com/.well-known/* ← Cache Level: Bypass.'
    }
  };

  var currentLang = 'en';

  function t(key) { return (i18n[currentLang] && i18n[currentLang][key]) || (i18n.en && i18n.en[key]) || key; }
  function fmt(s, vars) { return s.replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; }); }

  window.setActivateLang = function (lang) {
    if (!i18n[lang]) lang = 'en';
    currentLang = lang;
    var dict = i18n[lang];
    var html = document.documentElement;
    html.setAttribute('lang', lang);
    html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (dict[key] !== undefined) el.innerHTML = dict[key];
    });
    var btnEn = document.getElementById('btnEn');
    var btnAr = document.getElementById('btnAr');
    if (btnEn && btnAr) {
      btnEn.classList.toggle('active', lang === 'en');
      btnAr.classList.toggle('active', lang === 'ar');
    }
  };

  // ─── Provider tabs (kept) ──────────────────────────────────────────
  window.showProvider = function (name, btn) {
    document.querySelectorAll('.provider-content').forEach(function (el) { el.classList.remove('active'); });
    document.querySelectorAll('.provider-tab').forEach(function (el) { el.classList.remove('active'); });
    var content = document.getElementById('prov-' + name);
    if (content) content.classList.add('active');
    if (btn) btn.classList.add('active');
  };

  // ─── Helpers ───────────────────────────────────────────────────────
  function sanitizeDomain(s) {
    if (!s) return '';
    return String(s).trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      .replace(/:\d+$/, '').replace(/^www\./, '');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function copyText(text, btn) {
    var done = function () {
      if (!btn) return;
      var orig = btn.textContent;
      btn.textContent = t('copied');
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = orig; btn.classList.remove('copied'); }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { /* ignore */ });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* */ }
      document.body.removeChild(ta);
    }
  }

  // ─── Step 3: interactive TXT generator ─────────────────────────────
  function updateTxtGen() {
    var input = document.getElementById('txtGenDomain');
    var nameEl = document.getElementById('txtGenName');
    var valEl = document.getElementById('txtGenValue');
    if (!input || !nameEl || !valEl) return;
    var d = sanitizeDomain(input.value) || 'yourdomain.com';
    nameEl.textContent = '_wab';
    valEl.textContent = 'v=wab1; endpoint=https://' + d + '/.well-known/wab.json';
  }

  // ─── Step 1: wab.json generator (uses /api/adopt/suggest) ──────────
  function generateWabJson() {
    var input = document.getElementById('genUrl');
    var out = document.getElementById('genResult');
    if (!input || !out) return;
    var url = input.value.trim();
    if (!url) { input.focus(); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    out.style.display = 'block';
    out.innerHTML = '<div style="color:#94a3b8;font-size:0.85rem;">⏳ ' + t('gen_running') + '</div>';

    fetch('/api/adopt/suggest?url=' + encodeURIComponent(url))
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        var wabJson = (res.body && (res.body.wab_json || res.body.payload)) || null;
        if (!res.ok || !wabJson) {
          // Fallback: minimal stub
          var d = sanitizeDomain(url);
          wabJson = {
            version: 'wab1',
            name: d || 'Your site',
            description: 'AI agents can discover this site via WAB.',
            endpoint: 'https://' + (d || 'yourdomain.com') + '/.well-known/wab.json',
            capabilities: ['browse'],
            actions: [{ id: 'discovery', method: 'GET', path: '/' }]
          };
          renderGenResult(wabJson, /*fallback*/ true);
        } else {
          renderGenResult(wabJson, false);
        }
        // Also seed the TXT generator domain field
        var txtInput = document.getElementById('txtGenDomain');
        if (txtInput && !txtInput.value) {
          txtInput.value = sanitizeDomain(url);
          updateTxtGen();
        }
      })
      .catch(function () {
        var d = sanitizeDomain(url);
        var stub = {
          version: 'wab1',
          name: d || 'Your site',
          endpoint: 'https://' + (d || 'yourdomain.com') + '/.well-known/wab.json',
          capabilities: ['browse'],
          actions: [{ id: 'discovery', method: 'GET', path: '/' }]
        };
        renderGenResult(stub, true);
      });
  }

  function renderGenResult(json, isFallback) {
    var out = document.getElementById('genResult');
    if (!out) return;
    var pretty = JSON.stringify(json, null, 2);
    var dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(pretty);
    var msg = isFallback ? t('gen_failed') : t('gen_success');
    var msgColor = isFallback ? '#fbbf24' : '#34d399';
    out.innerHTML =
      '<div style="color:' + msgColor + ';font-size:0.85rem;margin-bottom:10px;">' + msg + '</div>' +
      '<div style="position:relative;">' +
      '<pre style="background:#0a0e1a;border:1px solid #1e293b;border-radius:8px;padding:14px;color:#a5f3fc;font-size:0.78rem;overflow:auto;max-height:280px;margin:0;">' + escapeHtml(pretty) + '</pre>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">' +
      '<button class="copy-btn" id="genCopyBtn">' + escapeHtml(t('copy')) + '</button>' +
      '<a class="copy-btn" href="' + dataUrl + '" download="wab.json" style="text-decoration:none;display:inline-block;">' + escapeHtml(t('gen_download')) + '</a>' +
      '</div>';
    var cBtn = document.getElementById('genCopyBtn');
    if (cBtn) cBtn.addEventListener('click', function () { copyText(pretty, cBtn); });
  }

  // ─── Step 4: diagnostic verifier with polling ──────────────────────
  var POLL_ATTEMPTS = 5;
  var POLL_DELAY_MS = 6000;

  function pillFor(status) {
    var sym = status === 'pass' ? '✓' : status === 'warn' ? '!' : status === 'fail' ? '✗' : 'i';
    return '<span class="diag-pill ' + status + '">' + sym + '</span>';
  }
  function localizedFix(check) {
    var hint = (FIX_HINTS[currentLang] && FIX_HINTS[currentLang][check.id]) || (FIX_HINTS.en && FIX_HINTS.en[check.id]) || check.fix;
    return hint || check.fix || '';
  }
  function renderDiagnostic(report) {
    var out = document.getElementById('activateResult');
    if (!out) return;

    var headerColor, headerText;
    if (report.summary.fail > 0) { headerColor = '#f87171'; headerText = t('diag_failed'); }
    else if (report.summary.warn > 0) { headerColor = '#fbbf24'; headerText = t('diag_passed_with_warnings'); }
    else { headerColor = '#34d399'; headerText = t('diag_passed_all'); }

    var summary = fmt(t('diag_summary'), report.summary);
    var rows = report.checks.map(function (c) {
      var titleText = c.title || c.id;
      var detail = c.detail ? '<div class="diag-detail">' + escapeHtml(c.detail) + '</div>' : '';
      var fix = (c.status !== 'pass' && c.status !== 'info') ? localizedFix(c) : '';
      var fixBlock = fix ? '<div class="diag-fix"><strong>' + escapeHtml(t('diag_fix')) + '</strong> ' + escapeHtml(fix) + '</div>' : '';
      return '<div class="diag-row">' +
        pillFor(c.status) +
        '<div class="diag-body"><div class="diag-title">' + escapeHtml(titleText) + '</div>' +
        detail + fixBlock +
        '</div></div>';
    }).join('');

    var endpointRow = report.endpoint
      ? '<div style="margin-top:10px;font-size:0.78rem;color:#64748b;">' + escapeHtml(t('diag_endpoint')) + ': <span style="color:#a5f3fc;">' + escapeHtml(report.endpoint) + '</span></div>'
      : '';

    out.style.display = 'block';
    out.innerHTML =
      '<div style="font-weight:600;color:' + headerColor + ';margin-bottom:10px;">' + headerText + '</div>' +
      '<div class="diag-summary">' + summary + '</div>' +
      rows + endpointRow;
  }

  function pollDiagnose(domain) {
    var status = document.getElementById('activateStatus');
    var btn = document.getElementById('activateVerifyBtn');
    var attempt = 0;
    var lastReport = null;

    function tick() {
      attempt++;
      if (status) {
        status.style.display = 'block';
        status.textContent = '⏳ ' + fmt(t('diag_running'), { n: attempt, max: POLL_ATTEMPTS });
      }
      fetch('/api/diagnose?domain=' + encodeURIComponent(domain))
        .then(function (r) { return r.json(); })
        .then(function (report) {
          lastReport = report;
          // If TXT exists, show result immediately; otherwise keep polling
          var txtCheck = (report.checks || []).find(function (c) { return c.id === 'dns_txt'; });
          var txtOk = txtCheck && txtCheck.status === 'pass';
          if (txtOk || attempt >= POLL_ATTEMPTS) {
            if (status) status.style.display = 'none';
            if (btn) btn.disabled = false;
            renderDiagnostic(report);
          } else {
            setTimeout(tick, POLL_DELAY_MS);
          }
        })
        .catch(function () {
          if (attempt >= POLL_ATTEMPTS) {
            if (status) status.style.display = 'none';
            if (btn) btn.disabled = false;
            var out = document.getElementById('activateResult');
            if (out) {
              out.style.display = 'block';
              out.innerHTML = '<div style="color:#f87171;">' + escapeHtml(currentLang === 'ar' ? '✗ خطأ في الاتصال بخادم الفحص. حاول مجددًا.' : '✗ Could not reach the diagnostic server. Please try again.') + '</div>';
            }
          } else {
            setTimeout(tick, POLL_DELAY_MS);
          }
        });
    }
    tick();
  }

  function startVerify() {
    var input = document.getElementById('activateDomain');
    if (!input) return;
    var domain = sanitizeDomain(input.value);
    if (!domain) { input.focus(); return; }
    var btn = document.getElementById('activateVerifyBtn');
    if (btn) btn.disabled = true;
    var out = document.getElementById('activateResult');
    if (out) { out.style.display = 'none'; out.innerHTML = ''; }
    pollDiagnose(domain);
  }

  // ─── Wire up ───────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    // Verifier
    var vbtn = document.getElementById('activateVerifyBtn');
    if (vbtn) vbtn.addEventListener('click', startVerify);
    var vinp = document.getElementById('activateDomain');
    if (vinp) vinp.addEventListener('keydown', function (e) { if (e.key === 'Enter') startVerify(); });

    // Generator
    var gbtn = document.getElementById('genBtn');
    if (gbtn) gbtn.addEventListener('click', generateWabJson);
    var ginp = document.getElementById('genUrl');
    if (ginp) ginp.addEventListener('keydown', function (e) { if (e.key === 'Enter') generateWabJson(); });

    // TXT generator
    var tinp = document.getElementById('txtGenDomain');
    if (tinp) {
      tinp.addEventListener('input', updateTxtGen);
      updateTxtGen();
    }

    // Generic copy buttons (data-copy-target="elementId")
    document.querySelectorAll('[data-copy-target]').forEach(function (b) {
      b.addEventListener('click', function () {
        var target = document.getElementById(b.getAttribute('data-copy-target'));
        if (target) copyText(target.textContent, b);
      });
    });

    // Lang buttons
    var btnEn = document.getElementById('btnEn');
    var btnAr = document.getElementById('btnAr');
    if (btnEn) btnEn.addEventListener('click', function () { setActivateLang('en'); });
    if (btnAr) btnAr.addEventListener('click', function () { setActivateLang('ar'); });
  });
})();
