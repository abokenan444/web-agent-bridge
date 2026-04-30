/* activate.js — WAB DNS Discovery Activation Page */
(function () {
  'use strict';

  /* ── Translations ── */
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
      step1_title: 'Log In to Your DNS Provider',
      step1_desc: 'Sign in to your domain registrar or DNS hosting dashboard. Common providers include Cloudflare, cPanel, GoDaddy, and Namecheap. Navigate to the DNS Management or DNS Records section.',
      prov_cloudflare: 'Go to <strong>dash.cloudflare.com</strong> → Select your domain → Click <strong>DNS</strong> in the top navigation → Click <strong>+ Add record</strong>.',
      prov_cpanel: 'Log in to cPanel → Scroll to <strong>Domains</strong> section → Click <strong>Zone Editor</strong> → Click <strong>Manage</strong> next to your domain → Click <strong>+ Add Record</strong>.',
      prov_godaddy: 'Log in to <strong>godaddy.com</strong> → My Products → Click <strong>DNS</strong> next to your domain → Click <strong>Add New Record</strong>.',
      prov_namecheap: 'Log in to <strong>namecheap.com</strong> → Domain List → Click <strong>Manage</strong> → Click <strong>Advanced DNS</strong> tab → Click <strong>Add New Record</strong>.',
      step2_title: 'Add the TXT Record',
      step2_desc: 'Create a new DNS TXT record with exactly these values. Replace <code style="color:#a5f3fc">yourdomain.com</code> with your actual domain.',
      step3_title: 'Create the wab.json Capabilities File',
      step3_desc: 'Create the file <code style="color:#a5f3fc">/.well-known/wab.json</code> on your web server. This file describes your site\'s capabilities to AI agents.',
      step4_title: 'Verify Your Setup',
      step4_desc: 'DNS propagation takes a few minutes. Use the Live Verifier to confirm your record is active. The verifier queries DNS over HTTPS (DoH) — no data is sent to our servers.',
      verify_btn: 'Verify Now',
      cta_title: 'Your Domain is Now AI-Ready',
      cta_desc: 'Once verified, AI agents using the WAB protocol can discover your site\'s capabilities automatically — no manual configuration needed on their end.',
      cta_full_guide: 'Full DNS Guide', cta_docs: 'Read the Docs'
    },
    ar: {
      nav_home: 'الرئيسية', nav_integrations: 'التكاملات', nav_dns: 'اكتشاف DNS',
      nav_phone: 'درع الهاتف', nav_sovereign: 'سيادي', nav_docs: 'التوثيق',
      hero_title: 'فعّل اكتشاف WAB<br><span class="gradient-text">بنقرة واحدة</span>',
      hero_sub: 'أضف سجل DNS TXT واحداً واجعل موقعك قابلاً للاكتشاف فوراً من قِبَل وكلاء الذكاء الاصطناعي — دون أي تغييرات في الكود.',
      cta_guide: 'عرض دليل الإعداد', cta_verify: 'المدقق المباشر',
      video_title: 'شاهد: الإعداد الكامل في 40 ثانية',
      video_fallback: 'متصفحك لا يدعم تشغيل الفيديو.',
      steps_title: 'دليل الإعداد خطوة بخطوة',
      step1_title: 'سجّل الدخول إلى مزود DNS',
      step1_desc: 'سجّل الدخول إلى مسجّل نطاقك أو لوحة تحكم استضافة DNS. المزودون الشائعون: Cloudflare وcPanel وGoDaddy وNamecheap. انتقل إلى قسم إدارة DNS أو سجلات DNS.',
      prov_cloudflare: 'اذهب إلى <strong>dash.cloudflare.com</strong> → اختر نطاقك → انقر على <strong>DNS</strong> في التنقل العلوي → انقر على <strong>+ إضافة سجل</strong>.',
      prov_cpanel: 'سجّل الدخول إلى cPanel → مرّر إلى قسم <strong>النطاقات</strong> → انقر على <strong>محرر المنطقة</strong> → انقر على <strong>إدارة</strong> بجانب نطاقك → انقر على <strong>+ إضافة سجل</strong>.',
      prov_godaddy: 'سجّل الدخول إلى <strong>godaddy.com</strong> → منتجاتي → انقر على <strong>DNS</strong> بجانب نطاقك → انقر على <strong>إضافة سجل جديد</strong>.',
      prov_namecheap: 'سجّل الدخول إلى <strong>namecheap.com</strong> → قائمة النطاقات → انقر على <strong>إدارة</strong> → انقر على تبويب <strong>Advanced DNS</strong> → انقر على <strong>إضافة سجل جديد</strong>.',
      step2_title: 'أضف سجل TXT',
      step2_desc: 'أنشئ سجل DNS TXT جديداً بهذه القيم بالضبط. استبدل <code style="color:#a5f3fc">yourdomain.com</code> بنطاقك الفعلي.',
      step3_title: 'أنشئ ملف قدرات wab.json',
      step3_desc: 'أنشئ الملف <code style="color:#a5f3fc">/.well-known/wab.json</code> على خادم الويب الخاص بك. يصف هذا الملف قدرات موقعك لوكلاء الذكاء الاصطناعي.',
      step4_title: 'تحقق من إعدادك',
      step4_desc: 'قد يستغرق انتشار DNS بضع دقائق. استخدم المدقق المباشر للتأكد من أن سجلك نشط. يستعلم المدقق عبر DNS over HTTPS (DoH) — لا يُرسَل أي بيانات إلى خوادمنا.',
      verify_btn: 'تحقق الآن',
      cta_title: 'نطاقك جاهز للذكاء الاصطناعي',
      cta_desc: 'بمجرد التحقق، يمكن لوكلاء الذكاء الاصطناعي الذين يستخدمون بروتوكول WAB اكتشاف قدرات موقعك تلقائياً — دون الحاجة إلى أي إعداد يدوي من جانبهم.',
      cta_full_guide: 'الدليل الكامل لـ DNS', cta_docs: 'اقرأ التوثيق'
    }
  };

  var currentLang = 'en';

  window.setActivateLang = function (lang) {
    currentLang = lang;
    var t = i18n[lang];
    var html = document.documentElement;
    html.setAttribute('lang', lang);
    html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (t[key] !== undefined) el.innerHTML = t[key];
    });

    var btnEn = document.getElementById('btnEn');
    var btnAr = document.getElementById('btnAr');
    if (btnEn && btnAr) {
      btnEn.classList.toggle('active', lang === 'en');
      btnAr.classList.toggle('active', lang === 'ar');
    }
  };

  /* ── Provider tabs ── */
  window.showProvider = function (name, btn) {
    document.querySelectorAll('.provider-content').forEach(function (el) { el.classList.remove('active'); });
    document.querySelectorAll('.provider-tab').forEach(function (el) { el.classList.remove('active'); });
    var content = document.getElementById('prov-' + name);
    if (content) content.classList.add('active');
    if (btn) btn.classList.add('active');
  };

  /* ── Live Verifier ── */
  function verifyDomain() {
    var input = document.getElementById('activateDomain');
    var result = document.getElementById('activateResult');
    if (!input || !result) return;
    var domain = input.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain) { input.focus(); return; }

    result.style.display = 'block';
    result.style.color = '#94a3b8';
    result.innerHTML = currentLang === 'ar' ? '⏳ جارٍ التحقق...' : '⏳ Verifying...';

    var url = 'https://cloudflare-dns.com/dns-query?name=_wab.' + encodeURIComponent(domain) + '&type=TXT';
    fetch(url, { headers: { 'Accept': 'application/dns-json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var answers = (data.Answer || []).filter(function (a) { return a.type === 16; });
        if (answers.length === 0) {
          result.style.color = '#f87171';
          result.innerHTML = currentLang === 'ar'
            ? '✗ لم يُعثر على سجل _wab. تأكد من إضافة السجل وانتظر انتشار DNS.'
            : '✗ No _wab record found. Make sure you added the record and wait for DNS propagation.';
          return;
        }
        var raw = answers[0].data.replace(/^"|"$/g, '');
        if (raw.indexOf('v=wab1') !== -1) {
          result.style.color = '#34d399';
          result.innerHTML = (currentLang === 'ar' ? '✓ سجل WAB صالح. ' : '✓ Valid WAB record found. ') +
            '<br><span style="color:#a5f3fc">' + raw + '</span>';
        } else {
          result.style.color = '#fbbf24';
          result.innerHTML = (currentLang === 'ar' ? '⚠ سجل TXT موجود لكن ليس سجل WAB صالحاً: ' : '⚠ TXT record found but not a valid WAB record: ') +
            '<br><span style="color:#a5f3fc">' + raw + '</span>';
        }
      })
      .catch(function () {
        result.style.color = '#f87171';
        result.innerHTML = currentLang === 'ar' ? '✗ خطأ في الاتصال. حاول مجدداً.' : '✗ Connection error. Please try again.';
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('activateVerifyBtn');
    if (btn) btn.addEventListener('click', verifyDomain);
    var inp = document.getElementById('activateDomain');
    if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') verifyDomain(); });

    /* Lang buttons */
    var btnEn = document.getElementById('btnEn');
    var btnAr = document.getElementById('btnAr');
    if (btnEn) btnEn.addEventListener('click', function () { setActivateLang('en'); });
    if (btnAr) btnAr.addEventListener('click', function () { setActivateLang('ar'); });
  });
})();
