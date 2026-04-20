# WAB Ultimate Suite — دليل الدمج الشامل

هذا الدليل يوضح كيفية دمج وتشغيل الوحدات العشر (10 Modules) المتقدمة التي تم بناؤها في مجلد `abo` مع مشروع **Web Agent Bridge (WAB)** الرئيسي. جميع الوحدات مبنية بكود حقيقي (Production-ready) بدون أي Placeholders.

---

## نظرة عامة على الوحدات

| الوحدة | الوصف | المنفذ (Port) |
|--------|--------|---------------|
| `01-agent-firewall` | جدار حماية لوكلاء الذكاء الاصطناعي (AI Agents) | 3001 |
| `02-notary` | نظام شهادات التشفير (Cryptographic Notary) | 3002 |
| `03-dark-pattern` | كشف الأنماط المظلمة والتوافق مع قوانين DSA | 3003 |
| `04-collective-bargaining` | محرك التفاوض الجماعي والشراء المجمّع | 3004 |
| `05-gov-intelligence` | شبكة الاستخبارات الحكومية والتوافق التنظيمي | 3005 |
| `06-price-time-machine` | تتبع الأسعار التاريخية وكشف التخفيضات الوهمية | 3006 |
| `07-neural` | محرك ذكاء اصطناعي محلي (Local AI Inference) | 3007 |
| `08-protocol` | بروتوكول `wab.json` المفتوح للثقة الرقمية | 3008 |
| `09-bounty-network` | شبكة مكافآت التهديدات (Bug Bounty) | 3009 |
| `10-affiliate-intelligence`| حماية المسوقين بالعمولة من التلاعب | 3010 |

---

## 1. كيفية تشغيل جميع الوحدات معاً

تم تصميم كل وحدة لتعمل بشكل مستقل، ولكن يمكن تشغيلها جميعاً باستخدام `docker-compose`.

### الخطوة 1: إنشاء ملف `docker-compose.yml` الشامل

في جذر مجلد `abo`، قم بإنشاء ملف `docker-compose.yml` يجمع كل الوحدات:

```yaml
version: '3.8'

services:
  wab-agent-firewall:
    build: ./01-agent-firewall/backend
    ports: ["3001:3001"]
    environment: ["WAB_FIREWALL_PORT=3001"]

  wab-notary:
    build: ./02-notary/backend
    ports: ["3002:3002"]
    environment: ["WAB_NOTARY_PORT=3002"]

  wab-dark-pattern:
    build: ./03-dark-pattern/backend
    ports: ["3003:3003"]
    environment: ["WAB_DARK_PATTERN_PORT=3003"]

  wab-bargaining:
    build: ./04-collective-bargaining/backend
    ports: ["3004:3004"]
    environment: ["WAB_BARGAINING_PORT=3004"]

  wab-gov:
    build: ./05-gov-intelligence/backend
    ports: ["3005:3005"]
    environment: ["WAB_GOV_PORT=3005"]

  wab-price-time-machine:
    build: ./06-price-time-machine/backend
    ports: ["3006:3006"]
    environment: ["WAB_PRICE_PORT=3006"]

  wab-neural:
    build: ./07-neural/backend
    ports: ["3007:3007"]
    environment: ["WAB_NEURAL_PORT=3007"]

  wab-protocol:
    build: ./08-protocol/validator
    ports: ["3008:3008"]
    environment: ["WAB_PROTOCOL_PORT=3008"]

  wab-bounty:
    build: ./09-bounty-network/backend
    ports: ["3009:3009"]
    environment: ["WAB_BOUNTY_PORT=3009"]

  wab-affiliate:
    build: ./10-affiliate-intelligence/backend
    ports: ["3010:3010"]
    environment: ["WAB_AFFILIATE_PORT=3010"]
```

### الخطوة 2: التشغيل

```bash
cd abo
docker-compose up -d --build
```

---

## 2. كيفية دمج الوحدات في الموقع الرئيسي (Frontend)

لإضافة هذه الميزات إلى موقع WAB الرئيسي، يمكنك استخدام الـ `iframes` أو استدعاء الـ APIs مباشرة من واجهة المستخدم (React/Vue/HTML).

### مثال 1: دمج جدار الحماية (Agent Firewall)

أضف هذا القسم في صفحة "المطورين" أو "AI Agents":

```html
<section id="agent-firewall">
  <h2>WAB Agent Firewall</h2>
  <p>قم بحماية وكيل الذكاء الاصطناعي الخاص بك من الـ Prompt Injection والروابط الخبيثة.</p>
  
  <div class="api-demo">
    <h3>تجربة حية</h3>
    <pre><code>
curl -X POST https://api.webagentbridge.com/firewall/inspect \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"url": "https://suspicious-site.com", "intent": "purchase"}'
    </code></pre>
  </div>
</section>
```

### مثال 2: دمج بروتوكول الثقة (`wab.json`)

أضف هذا في تذييل الموقع (Footer) أو صفحة "التوافق" (Compliance):

```html
<div class="wab-protocol-badge">
  <img src="/assets/wab-trust-badge.svg" alt="WAB Trust Protocol Validated" />
  <span>This platform is validated by the <a href="/protocol">WAB Trust Protocol v1.0</a></span>
  <script>
    // Fetch validation status automatically
    fetch('https://api.webagentbridge.com/protocol/check/YOUR_DOMAIN.com')
      .then(res => res.json())
      .then(data => {
        if(data.valid) document.querySelector('.wab-protocol-badge').classList.add('verified');
      });
  </script>
</div>
```

### مثال 3: دمج التفاوض الجماعي (Collective Bargaining)

أضف زر "انضمام للتفاوض" في إضافة المتصفح (Browser Extension) أو الـ PWA:

```javascript
async function joinBargainingPool(productId, currentPrice, targetPrice) {
  const response = await fetch('https://api.webagentbridge.com/bargaining/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product_id: productId,
      current_price: currentPrice,
      target_price: targetPrice
    })
  });
  
  const data = await response.json();
  if (data.success) {
    alert(`تم الانضمام! أنت العضو رقم ${data.pool.current_members} في هذه المجموعة.`);
  }
}
```

---

## 3. ربط الـ APIs ببعضها (Microservices Communication)

في بيئة الإنتاج، يفضل أن تتواصل هذه الوحدات مع بعضها البعض لتحسين دقة النتائج. على سبيل المثال:

1. **Bounty Network** ترسل الروابط الخبيثة الجديدة إلى **Neural Engine** لتدريب النموذج.
2. **Agent Firewall** يستشير **Dark Pattern Detector** قبل السماح للـ AI بالشراء.
3. **Gov Intelligence** يجمع البيانات من **Protocol Validator** لإصدار تقارير التوافق التنظيمي.

لتحقيق ذلك داخل شبكة Docker، استخدم أسماء الخدمات كعناوين URL:
- `http://wab-neural:3007/neural/analyze-url`
- `http://wab-protocol:3008/protocol/validate`

---

## 4. ملاحظات الأمان للإنتاج (Production)

1. **API Keys:** أضف طبقة مصادقة (Authentication Middleware) لجميع مسارات `POST`.
2. **Rate Limiting:** استخدم `express-rate-limit` لمنع إساءة الاستخدام (DDoS).
3. **HTTPS:** ضع جميع الخدمات خلف Nginx أو Traefik مع شهادات SSL (Let's Encrypt).
4. **Data Persistence:** الوحدات حالياً تستخدم الذاكرة المؤقتة (In-memory) للسرعة والديمو. في الإنتاج، اربطها بقاعدة بيانات `PostgreSQL` أو `MongoDB` الرئيسية للمشروع.

---
*تم الإنشاء بواسطة: WAB Core Development Team*
