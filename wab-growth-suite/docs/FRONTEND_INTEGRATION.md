# WAB Growth Suite — دليل دمج الواجهة الأمامية (Frontend Integration Guide)

هذا الدليل يحتوي على **أكواد HTML وCSS جاهزة للنسخ واللصق** لإضافة الأفكار الثماني الجديدة إلى الصفحة الرئيسية لموقع Web Agent Bridge (WAB).

كل قسم مصمم ليكون جذاباً بصرياً، احترافياً، ويشرح الفكرة للمستخدم النهائي بوضوح تام.

---

## 1. قسم WAB Widget (زر حماية الروابط)

يُضاف هذا القسم في الصفحة الرئيسية لجذب أصحاب المواقع والمدونات.

```html
<!-- WAB Widget Section -->
<section class="wab-widget-section" style="padding: 80px 20px; background: #f8fafc; text-align: center;">
  <div style="max-width: 800px; margin: 0 auto;">
    <h2 style="font-size: 36px; color: #0f172a; margin-bottom: 16px;">احمِ زوار موقعك بسطر كود واحد</h2>
    <p style="font-size: 18px; color: #64748b; margin-bottom: 32px;">
      أضف <strong>WAB Widget</strong> إلى موقعك أو مدونتك. سيقوم تلقائياً بفحص كل رابط خارجي وإضافة درع حماية بجانبه، لمنع زوارك من الوقوع في فخ الاحتيال.
    </p>
    
    <div style="background: #0f172a; color: #e2e8f0; padding: 24px; border-radius: 12px; text-align: left; font-family: monospace; font-size: 14px; overflow-x: auto; margin-bottom: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.15);">
      <span style="color:#f472b6">&lt;script</span> <span style="color:#a78bfa">src=</span><span style="color:#a3e635">"https://cdn.webagentbridge.com/widget.js"</span><br>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#a78bfa">data-wab-key=</span><span style="color:#a3e635">"YOUR_API_KEY"</span><span style="color:#f472b6">&gt;&lt;/script&gt;</span>
    </div>

    <div style="display: flex; justify-content: center; gap: 16px;">
      <a href="/widget-demo" style="background: #3b82f6; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">تجربة الـ Widget الحية</a>
      <a href="/workspace" style="background: #fff; color: #0f172a; border: 1px solid #cbd5e1; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">احصل على مفتاح مجاني</a>
    </div>
  </div>
</section>
```

---

## 2. قسم AI Safety Layer (طبقة أمان الذكاء الاصطناعي)

يُضاف في صفحة المطورين (Developers) لاستهداف شركات الذكاء الاصطناعي.

```html
<!-- AI Safety Layer Section -->
<section class="ai-safety-section" style="padding: 80px 20px; background: #0f172a; color: white;">
  <div style="max-width: 1000px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center;">
    <div>
      <div style="color: #3b82f6; font-weight: 700; margin-bottom: 8px; letter-spacing: 1px;">FOR AI AGENTS</div>
      <h2 style="font-size: 32px; margin-bottom: 16px;">الطبقة الأمنية الإلزامية لروبوتات الإنترنت</h2>
      <p style="color: #94a3b8; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
        هل تبني وكيل ذكاء اصطناعي يتصفح الإنترنت نيابة عن المستخدمين؟ استخدم <strong>WAB AI Safety Layer</strong> لمنع الروبوت الخاص بك من زيارة مواقع التصيد أو إجراء معاملات على منصات غير موثوقة.
      </p>
      <ul style="list-style: none; padding: 0; color: #cbd5e1; margin-bottom: 32px;">
        <li style="margin-bottom: 12px;">✅ متوافق مع OpenAI Operator & Anthropic Computer Use</li>
        <li style="margin-bottom: 12px;">✅ يمنع المعاملات المالية الاحتيالية تلقائياً</li>
        <li style="margin-bottom: 12px;">✅ يرفع المسؤولية القانونية عن شركتك</li>
      </ul>
      <a href="/docs/ai-safety" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">قراءة التوثيق (NPM)</a>
    </div>
    <div style="background: #1e293b; padding: 24px; border-radius: 16px; border: 1px solid #334155;">
      <pre style="color: #e2e8f0; font-family: monospace; font-size: 13px; line-height: 1.5; margin: 0;">
<span style="color:#c678dd">import</span> { WABAgentWrapper } <span style="color:#c678dd">from</span> <span style="color:#98c379">'@wab/sdk'</span>;

<span style="color:#5c6370">// Wrap your AI Agent with WAB Safety</span>
<span style="color:#c678dd">const</span> safeAgent = <span style="color:#c678dd">new</span> WABAgentWrapper(myAgent, WAB_KEY, {
  <span style="color:#d19a66">blockCritical</span>: <span style="color:#d19a66">true</span>,
  <span style="color:#d19a66">minFairness</span>: <span style="color:#d19a66">60</span>
});

<span style="color:#5c6370">// WAB will block this if the site is a scam</span>
<span style="color:#c678dd">await</span> safeAgent.<span style="color:#61afef">purchase</span>(<span style="color:#98c379">'shady-shop.com'</span>, <span style="color:#98c379">'iPhone'</span>, <span style="color:#d19a66">99</span>);
<span style="color:#e06c75">→ WABFairnessError: Platform scored 32/100</span>
      </pre>
    </div>
  </div>
</section>
```

---

## 3. قسم WAB Score (التقييم الائتماني للمنصات)

يُضاف في الصفحة الرئيسية لإبراز دور WAB كمرجع عالمي.

```html
<!-- WAB Score Section -->
<section class="wab-score-section" style="padding: 80px 20px; background: white; text-align: center;">
  <div style="max-width: 800px; margin: 0 auto;">
    <h2 style="font-size: 36px; color: #0f172a; margin-bottom: 16px;">التقييم الائتماني للعالم الرقمي</h2>
    <p style="font-size: 18px; color: #64748b; margin-bottom: 40px;">
      كما تقيّم وكالات التصنيف البنوك، يقيّم WAB المنصات الرقمية. ابحث عن <strong>WAB Score</strong> قبل الشراء من أي متجر جديد للتأكد من عدالته وأمانه.
    </p>

    <!-- Example Score Badges -->
    <div style="display: flex; justify-content: center; gap: 24px; flex-wrap: wrap; margin-bottom: 40px;">
      
      <!-- Amazon -->
      <div style="border: 2px solid #22c55e; border-radius: 12px; padding: 16px 24px; display: flex; align-items: center; gap: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); text-align: left; width: 260px;">
        <div style="font-size: 32px; font-weight: 900; color: #22c55e; line-height: 1;">A-</div>
        <div>
          <div style="font-weight: 700; color: #1e293b;">Very Good</div>
          <div style="font-size: 12px; color: #64748b;">86/100 · amazon.com</div>
        </div>
      </div>

      <!-- AliExpress -->
      <div style="border: 2px solid #f59e0b; border-radius: 12px; padding: 16px 24px; display: flex; align-items: center; gap: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); text-align: left; width: 260px;">
        <div style="font-size: 32px; font-weight: 900; color: #f59e0b; line-height: 1;">C+</div>
        <div>
          <div style="font-weight: 700; color: #1e293b;">Below Average</div>
          <div style="font-size: 12px; color: #64748b;">68/100 · aliexpress.com</div>
        </div>
      </div>

    </div>

    <form action="/score" method="GET" style="display: flex; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border-radius: 8px; overflow: hidden;">
      <input type="text" name="domain" placeholder="أدخل رابط المتجر (مثال: shein.com)" style="flex: 1; padding: 16px; border: none; outline: none; font-size: 16px;">
      <button type="submit" style="background: #0f172a; color: white; border: none; padding: 0 24px; font-weight: 600; cursor: pointer;">افحص التقييم</button>
    </form>
  </div>
</section>
```

---

## 4. قسم Trust Layer Protocol (بروتوكول الثقة)

يُضاف في قسم أصحاب الأعمال (Business).

```html
<!-- Trust Protocol Section -->
<section style="padding: 60px 20px; background: #f1f5f9; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">
  <div style="max-width: 900px; margin: 0 auto; display: flex; align-items: center; gap: 40px;">
    <div style="flex: 1;">
      <h3 style="font-size: 24px; color: #0f172a; margin-bottom: 12px;">انضم إلى بروتوكول الثقة المفتوح</h3>
      <p style="color: #475569; line-height: 1.6; margin-bottom: 20px;">
        أثبت لعملائك أن متجرك عادل وآمن. أضف ملف <code>wab.json</code> إلى سيرفرك واطبع شارة <strong>WAB Certified</strong> على موقعك لزيادة ثقة المشترين ورفع نسبة التحويل (Conversion Rate).
      </p>
      <a href="/trust-protocol" style="color: #3b82f6; font-weight: 600; text-decoration: none;">كيف تصبح معتمداً؟ &rarr;</a>
    </div>
    <div style="flex: 1; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      <div style="font-family: monospace; font-size: 12px; color: #334155;">
        <span style="color:#94a3b8">// /.well-known/wab.json</span><br>
        {<br>
        &nbsp;&nbsp;"wab_certified": <span style="color:#22c55e">true</span>,<br>
        &nbsp;&nbsp;"fairness_score": <span style="color:#3b82f6">92</span>,<br>
        &nbsp;&nbsp;"last_audit": <span style="color:#a3e635">"2026-04-01"</span><br>
        }
      </div>
    </div>
  </div>
</section>
```

---

## 5. قسم WAB Bounty Network (شبكة المكافآت)

يُضاف في الصفحة الرئيسية لجذب المستخدمين العاديين للمساهمة.

```html
<!-- Bounty Network Section -->
<section style="padding: 80px 20px; background: #0f172a; color: white; text-align: center;">
  <div style="max-width: 700px; margin: 0 auto;">
    <div style="font-size: 48px; margin-bottom: 16px;">💰</div>
    <h2 style="font-size: 36px; margin-bottom: 16px;">اربح المال باكتشاف الاحتيال</h2>
    <p style="font-size: 18px; color: #94a3b8; margin-bottom: 32px; line-height: 1.6;">
      انضم إلى <strong>WAB Bounty Network</strong>. أبلغ عن الروابط الاحتيالية، المتاجر الوهمية، أو رسائل التصيد التي لم تكتشفها الأنظمة بعد. احصل على نقاط (Credits) مقابل كل بلاغ صحيح، وحوّلها إلى اشتراكات أو مكافآت مالية.
    </p>
    <div style="display: flex; justify-content: center; gap: 24px; margin-bottom: 40px;">
      <div style="background: #1e293b; padding: 16px 24px; border-radius: 8px;">
        <div style="font-size: 24px; font-weight: 700; color: #ef4444;">50 نقطة</div>
        <div style="font-size: 13px; color: #94a3b8;">للاكتشافات الحرجة</div>
      </div>
      <div style="background: #1e293b; padding: 16px 24px; border-radius: 8px;">
        <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">25 نقطة</div>
        <div style="font-size: 13px; color: #94a3b8;">للاحتيال المؤكد</div>
      </div>
    </div>
    <a href="/bounty" style="background: #22c55e; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px;">سجل كصائد احتيال (Bounty Hunter)</a>
  </div>
</section>
```

---

## 6. قسم Data Marketplace (سوق البيانات)

يُضاف في قسم الشركات (Enterprise).

```html
<!-- Data Marketplace Section -->
<section style="padding: 80px 20px; background: white;">
  <div style="max-width: 1000px; margin: 0 auto; text-align: center;">
    <h2 style="font-size: 32px; color: #0f172a; margin-bottom: 16px;">بيانات حصرية لتدريب نماذج الذكاء الاصطناعي</h2>
    <p style="font-size: 18px; color: #64748b; margin-bottom: 48px; max-width: 700px; margin-left: auto; margin-right: auto;">
      يوفر <strong>WAB Data Marketplace</strong> أضخم قاعدة بيانات لحظية لأنماط الاحتيال، وعدالة المنصات، وسلوكيات التسعير. مثالية لشركات الأمن السيبراني ومطوري الـ AI.
    </p>
    
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; text-align: left;">
      <!-- Card 1 -->
      <div style="border: 1px solid #e2e8f0; padding: 24px; border-radius: 12px;">
        <h4 style="font-size: 18px; margin-bottom: 8px; color: #0f172a;">Threat Intelligence Feed</h4>
        <p style="color: #64748b; font-size: 14px; margin-bottom: 16px;">تدفق لحظي (Real-time API) لأحدث الروابط الاحتيالية وبرمجيات الفدية المكتشفة عبر شبكتنا.</p>
        <a href="/data/threats" style="color: #3b82f6; font-weight: 600; text-decoration: none; font-size: 14px;">استعرض العينة &rarr;</a>
      </div>
      <!-- Card 2 -->
      <div style="border: 1px solid #e2e8f0; padding: 24px; border-radius: 12px;">
        <h4 style="font-size: 18px; margin-bottom: 8px; color: #0f172a;">Platform Fairness Dataset</h4>
        <p style="color: #64748b; font-size: 14px; margin-bottom: 16px;">بيانات تاريخية لعدالة أكثر من 500 منصة تجارية (تلاعب بالأسعار، سياسات استرجاع، إلخ).</p>
        <a href="/data/fairness" style="color: #3b82f6; font-weight: 600; text-decoration: none; font-size: 14px;">استعرض العينة &rarr;</a>
      </div>
      <!-- Card 3 -->
      <div style="border: 1px solid #e2e8f0; padding: 24px; border-radius: 12px;">
        <h4 style="font-size: 18px; margin-bottom: 8px; color: #0f172a;">Affiliate Fraud Patterns</h4>
        <p style="color: #64748b; font-size: 14px; margin-bottom: 16px;">أنماط الاحتيال في التسويق بالعمولة، بما في ذلك حشو ملفات الارتباط (Cookie Stuffing).</p>
        <a href="/data/affiliate" style="color: #3b82f6; font-weight: 600; text-decoration: none; font-size: 14px;">استعرض العينة &rarr;</a>
      </div>
    </div>
  </div>
</section>
```

---

## 7. قسم Email Protection (إضافة البريد الإلكتروني)

يُضاف في صفحة التحميل (Downloads).

```html
<!-- Email Protection Section -->
<section style="padding: 60px 20px; background: #f8fafc; border-radius: 16px; margin: 40px auto; max-width: 900px; display: flex; align-items: center; gap: 40px;">
  <div style="flex: 1;">
    <h3 style="font-size: 28px; color: #0f172a; margin-bottom: 16px;">حماية البريد الإلكتروني من WAB</h3>
    <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
      94% من الاختراقات تبدأ برسالة بريد إلكتروني. قم بتثبيت إضافة WAB لمتصفحك، وسنقوم بفحص كل رابط وكل مرسل داخل <strong>Gmail</strong> و <strong>Outlook</strong> تلقائياً قبل أن تضغط على أي شيء.
    </p>
    <div style="display: flex; gap: 12px;">
      <a href="/downloads/chrome" style="background: #fff; border: 1px solid #cbd5e1; padding: 10px 20px; border-radius: 6px; color: #0f172a; text-decoration: none; font-weight: 600; display: flex; align-items: center; gap: 8px;">
        <img src="/assets/chrome-icon.png" width="20" height="20" alt="Chrome"> أضف إلى Chrome
      </a>
      <a href="/downloads/firefox" style="background: #fff; border: 1px solid #cbd5e1; padding: 10px 20px; border-radius: 6px; color: #0f172a; text-decoration: none; font-weight: 600; display: flex; align-items: center; gap: 8px;">
        <img src="/assets/firefox-icon.png" width="20" height="20" alt="Firefox"> أضف إلى Firefox
      </a>
    </div>
  </div>
  <div style="flex: 1; background: white; padding: 16px; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.1);">
    <!-- Mockup of Gmail warning -->
    <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; border-radius: 4px; margin-bottom: 12px;">
      <strong style="color: #991b1b; font-size: 13px;">🚫 WAB Security Alert:</strong>
      <div style="color: #b91c1c; font-size: 12px; margin-top: 4px;">PHISHING DETECTED: 2 dangerous links found. Do NOT click.</div>
    </div>
    <div style="height: 12px; background: #f1f5f9; width: 60%; margin-bottom: 8px; border-radius: 4px;"></div>
    <div style="height: 12px; background: #f1f5f9; width: 80%; margin-bottom: 8px; border-radius: 4px;"></div>
    <div style="height: 12px; background: #f1f5f9; width: 40%; border-radius: 4px;"></div>
  </div>
</section>
```

---

## 8. قسم Affiliate Intelligence (حماية المسوقين بالعمولة)

يُضاف كمنتج مستقل للمسوقين.

```html
<!-- Affiliate Intelligence Section -->
<section style="padding: 80px 20px; background: #0f172a; color: white; text-align: center;">
  <div style="max-width: 800px; margin: 0 auto;">
    <h2 style="font-size: 36px; margin-bottom: 16px;">هل تسرق شبكات التسويق عمولاتك؟</h2>
    <p style="font-size: 18px; color: #94a3b8; margin-bottom: 32px; line-height: 1.6;">
      أداة <strong>WAB Affiliate Intelligence</strong> تحلل بيانات حملاتك الإعلانية وتقارنها بمعايير الصناعة لاكتشاف (Commission Shaving) والتلاعب بنسب التحويل وتأخير الدفعات.
    </p>
    
    <div style="background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; text-align: left; max-width: 600px; margin: 0 auto 32px;">
      <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #334155; padding-bottom: 16px; margin-bottom: 16px;">
        <div>
          <div style="color: #94a3b8; font-size: 12px; margin-bottom: 4px;">Network Analyzed</div>
          <div style="font-weight: 700; font-size: 16px;">ClickBank</div>
        </div>
        <div style="text-align: right;">
          <div style="color: #94a3b8; font-size: 12px; margin-bottom: 4px;">Fraud Risk</div>
          <div style="font-weight: 700; font-size: 16px; color: #f59e0b;">MEDIUM</div>
        </div>
      </div>
      <div style="color: #cbd5e1; font-size: 14px; margin-bottom: 8px;">⚠️ <strong>Suspicious Low CVR:</strong> Actual 0.8% vs Expected 2.5%</div>
      <div style="color: #cbd5e1; font-size: 14px;">⚠️ <strong>Payment Delays:</strong> 3 of last 10 payments were late</div>
    </div>

    <a href="/affiliate" style="background: #3b82f6; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px;">اربط حساباتك وافحص أرباحك الآن</a>
  </div>
</section>
```
