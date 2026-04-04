<div dir="rtl" align="right">

# Web Agent Bridge (WAB) — جسر الوكيل الذكي

[![CI](https://github.com/abokenan444/web-agent-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/abokenan444/web-agent-bridge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://hub.docker.com/)

**برمجية وسيطة مفتوحة المصدر تربط وكلاء الذكاء الاصطناعي بالمواقع الإلكترونية — توفر واجهة أوامر موحدة للأتمتة الذكية.**

يتيح WAB لأصحاب المواقع إضافة سكريبت يكشف واجهة `window.AICommands` لوكلاء الذكاء الاصطناعي. بدلاً من تحليل شيفرة HTML المعقدة، يقرأ الوكيل قائمة الإجراءات المتاحة وينفذها بدقة وأمان.

**[English Documentation](README.md)** | **العربية**

---

## ✨ المميزات

- **اكتشاف تلقائي** — يكتشف الأزرار والنماذج وروابط التنقل تلقائياً
- **نظام صلاحيات** — تحكم دقيق بما يمكن لوكلاء الذكاء الاصطناعي فعله
- **واجهة موحدة** — كائن `window.AICommands` موحد يستخدمه أي وكيل
- **تحديد معدل الاستخدام** — حماية مدمجة ضد الإساءة
- **لوحة تحليلات** — تتبع تفاعل وكلاء الذكاء الاصطناعي مع موقعك
- **إجراءات مخصصة** — سجّل إجراءاتك الخاصة مع معالجات مخصصة
- **تحليلات فورية** — عبر WebSocket لمراقبة النشاط لحظياً
- **توافق WebDriver BiDi** — دعم البروتوكولات المعيارية للمتصفحات
- **مستويات اشتراك** — نواة مجانية + ميزات متقدمة مدفوعة
- **نظام أحداث** — اشترك في أحداث الجسر للمراقبة
- **صندوق حماية أمني** — عزل كامل مع توكنات جلسة، تحقق من الأصل، تأمين تلقائي
- **محددات ذاتية الإصلاح** — مقاومة لتغييرات DOM في المواقع الديناميكية (SPA)
- **وضع التخفي** — محاكاة سلوك بشري (حركة فأرة، كتابة طبيعية، تمرير تدريجي)
- **قواعد بيانات متعددة** — SQLite + PostgreSQL + MySQL عبر محوّلات قابلة للتبديل
- **SDK للوكلاء** — حزمة أدوات جاهزة لبناء وكلاء ذكاء اصطناعي

### الإصدار 2.0 — ميزات الحصن الرقمي

- **محرك التفاوض اللحظي** — يتفاوض وكيل الذكاء الاصطناعي على الأسعار مباشرة مع المواقع عبر جلسات متعددة الجولات، ٨ أنواع شروط، و٤ أنواع خصومات
- **درع مقاومة التزييف** — محرك تحقق متقاطع يقارن DOM مع لقطات الشاشة، يتحقق من الأسعار مقابل المعايير السوقية، يفحص الاتساق الزمني، ويقيس تشابه النصوص
- **نظام السمعة اللامركزي** — شهادات ثقة مشفرة من شبكة الوكلاء مع تقييم مرجح، مستويات ثقة (ناشئ ← موثق ← نموذجي)، ولوحة متصدرين عالمية
- **لوحة السيادة** — مركز قيادة لحظي يعرض رادار العدالة، درع الخصوصية، سجل التفاوض، فحوصات التحقق، ومبدّل نماذج الذكاء الاصطناعي
- **متجر قوالب الوكلاء** — ١١ قالب YAML جاهز (حجز فنادق، مقارنة بقالة، سوق حرفيين، صفقات طيران، إلخ) مع تشغيل من سطر الأوامر: `npx wab-agent run template.yaml`
- **تبديل عقل الوكيل** — بدّل بين Llama 3، GPT-4، Claude، Gemini، Mistral، أو Ollama (محلي) بدون إعادة إعداد
- **تنسيق الوكيل عبر المواقع** — وكيل واحد يدير عدة مواقع WAB في نفس الوقت عبر `WABMultiAgent`. قارن الأسعار بين المتاجر، اجمع البيانات، نفّذ إجراءات متوازية، واعثر على أفضل صفقة تلقائياً

---

## 🚀 البدء السريع

### ١. التثبيت والتشغيل

```bash
# الطريقة أ: استنساخ وتشغيل
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge
npm install
cp .env.example .env
npm start

# الطريقة ب: npx (أمر واحد)
npx web-agent-bridge start

# الطريقة ج: Docker
docker compose up -d
```

### ٢. إنشاء حساب

زُر `http://localhost:3000/register` وأنشئ حساباً، ثم أضف موقعك من لوحة التحكم.

### ٣. إضافة السكريبت لموقعك

```html
<script>
window.AIBridgeConfig = {
  licenseKey: "WAB-XXXXX-XXXXX-XXXXX-XXXXX",
  agentPermissions: {
    readContent: true,
    click: true,
    fillForms: true,
    scroll: true
  }
};
</script>
<script src="http://localhost:3000/script/ai-agent-bridge.js"></script>
```

### ٤. الآن يمكن لوكلاء الذكاء الاصطناعي التفاعل

```javascript
// من جانب وكيل الذكاء الاصطناعي
const bridge = window.AICommands;
const actions = bridge.getActions();           // اكتشاف الإجراءات
await bridge.execute("signup");                // تنفيذ إجراء
const info = bridge.getPageInfo();             // معلومات الصفحة
```

---

## 📁 هيكل المشروع

```
web-agent-bridge/
├── server/                 # خادم Express.js
│   ├── index.js            # نقطة البداية
│   ├── ws.js               # WebSocket للتحليلات الفورية
│   ├── routes/
│   │   ├── auth.js         # المصادقة (تسجيل/دخول)
│   │   ├── api.js          # واجهة المواقع والتحليلات
│   │   └── license.js      # التحقق من التراخيص والتتبع
│   ├── middleware/
│   │   └── auth.js         # وسيط JWT
│   └── models/
│       └── db.js           # قاعدة بيانات SQLite
├── public/                 # الواجهة الأمامية
│   ├── index.html          # الصفحة الرئيسية
│   ├── dashboard.html      # لوحة التحكم
│   ├── docs.html           # التوثيق
│   ├── login.html          # تسجيل الدخول
│   └── register.html       # التسجيل
├── script/
│   └── ai-agent-bridge.js  # سكريبت الجسر
├── tests/                  # الاختبارات
├── Dockerfile              # حاوية Docker
├── docker-compose.yml      # تشغيل Docker
└── package.json
```

---

## 🔌 واجهات API

### المصادقة
| النقطة | الطريقة | الوصف |
|---|---|---|
| `/api/auth/register` | POST | إنشاء حساب |
| `/api/auth/login` | POST | تسجيل الدخول |
| `/api/auth/me` | GET | بيانات المستخدم الحالي |

### المواقع
| النقطة | الطريقة | الوصف |
|---|---|---|
| `/api/sites` | GET | قائمة مواقعك |
| `/api/sites` | POST | إضافة موقع جديد |
| `/api/sites/:id` | GET | تفاصيل الموقع |
| `/api/sites/:id/config` | PUT | تحديث الإعدادات |
| `/api/sites/:id/tier` | PUT | تغيير مستوى الاشتراك |
| `/api/sites/:id` | DELETE | حذف الموقع |
| `/api/sites/:id/snippet` | GET | كود التضمين |
| `/api/sites/:id/analytics` | GET | بيانات التحليلات |

### التراخيص (عامة)
| النقطة | الطريقة | الوصف |
|---|---|---|
| `/api/license/verify` | POST | التحقق من مفتاح الترخيص |
| `/api/license/track` | POST | تسجيل حدث تحليلي |

### واجهات السيادة (الإصدار 2.0)
| النقطة | الطريقة | الوصف |
|---|---|---|
| `/api/sovereign/reputation/agents` | POST | تسجيل وكيل جديد |
| `/api/sovereign/reputation/attestations` | POST | إرسال شهادة ثقة |
| `/api/sovereign/reputation/sites/:siteId` | GET | سمعة الموقع |
| `/api/sovereign/reputation/leaderboard` | GET | لوحة المتصدرين |
| `/api/sovereign/negotiation/rules` | POST | إنشاء قاعدة تفاوض |
| `/api/sovereign/negotiation/sessions` | POST | فتح جلسة تفاوض |
| `/api/sovereign/negotiation/sessions/:id/propose` | POST | تقديم عرض مضاد |
| `/api/sovereign/negotiation/sessions/:id/confirm` | POST | تأكيد الصفقة |
| `/api/sovereign/verify/price` | POST | التحقق من السعر |
| `/api/sovereign/verify/text` | POST | التحقق من النص |
| `/api/sovereign/verify/page` | POST | التحقق الشامل للصفحة |
| `/api/sovereign/dashboard/sovereign` | GET | بيانات لوحة السيادة |

### WebSocket
| النقطة | الوصف |
|---|---|
| `ws://localhost:3000/ws/analytics` | تحليلات فورية لحظية |

---

## ⚙️ واجهة سكريبت الجسر

عند التحميل، يكشف `window.AICommands` الطرق التالية:

| الطريقة | الوصف |
|---|---|
| `getActions(category?)` | قائمة الإجراءات المتاحة |
| `getAction(name)` | الحصول على إجراء محدد |
| `execute(name, params?)` | تنفيذ إجراء |
| `readContent(selector)` | قراءة محتوى عنصر |
| `getPageInfo()` | معلومات الصفحة والجسر |
| `waitForElement(selector, timeout?)` | انتظار ظهور عنصر DOM |
| `waitForNavigation(timeout?)` | انتظار تغيير العنوان |
| `registerAction(def)` | تسجيل إجراء مخصص |
| `authenticate(key, meta?)` | مصادقة الوكيل |
| `refresh()` | إعادة مسح الصفحة |
| `toBiDi()` | الحصول على سياق WebDriver BiDi |
| `executeBiDi(command)` | تنفيذ أمر بصيغة BiDi |

---

## 🔧 الإعدادات

```javascript
window.AIBridgeConfig = {
  licenseKey: "WAB-XXXXX-XXXXX-XXXXX-XXXXX",
  agentPermissions: {
    readContent: true,      // قراءة النص
    click: true,            // النقر على العناصر
    fillForms: false,       // ملء/إرسال النماذج
    scroll: true,           // تمرير الصفحة
    navigate: false,        // التنقل بين الصفحات
    apiAccess: false,       // استدعاء API داخلي (Pro+)
    automatedLogin: false,  // تسجيل دخول تلقائي (Starter+)
    extractData: false      // استخراج البيانات (Pro+)
  },
  restrictions: {
    allowedSelectors: [],
    blockedSelectors: [".private", "[data-private]"],
    requireLoginForActions: ["apiAccess"],
    rateLimit: { maxCallsPerMinute: 60 }
  },
  logging: { enabled: false, level: "basic" }
};
```

---

## 🔄 توافق WebDriver BiDi

يدعم السكريبت بروتوكول WebDriver BiDi للتواصل مع الوكلاء عبر معايير موحدة:

```javascript
// الحصول على سياق BiDi
const context = window.__wab_bidi.getContext();

// إرسال أمر BiDi
const result = await window.__wab_bidi.send({
  id: 1,
  method: 'wab.executeAction',
  params: { name: 'signup', data: {} }
});

// الأوامر المدعومة:
// wab.getContext    — سياق الصفحة والقدرات
// wab.getActions    — قائمة الإجراءات
// wab.executeAction — تنفيذ إجراء
// wab.readContent   — قراءة محتوى
// wab.getPageInfo   — معلومات الصفحة
```

---

## 📊 التحليلات الفورية (WebSocket)

اتصل بنقطة WebSocket لتلقي إشعارات فورية:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws/analytics');

// المصادقة
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    token: 'your-jwt-token',
    siteId: 'your-site-id'
  }));
};

// تلقي الأحداث
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('حدث جديد:', data);
  // { type: 'analytic', actionName: '...', agentId: '...', success: true }
};
```

---

## 💰 مستويات الاشتراك

| الميزة | مجاني | Starter | Pro | Enterprise |
|---|:---:|:---:|:---:|:---:|
| اكتشاف تلقائي | ✓ | ✓ | ✓ | ✓ |
| نقر/تمرير | ✓ | ✓ | ✓ | ✓ |
| ملء النماذج | ✓ | ✓ | ✓ | ✓ |
| تسجيل أساسي | ✓ | ✓ | ✓ | ✓ |
| تسجيل دخول تلقائي | ✗ | ✓ | ✓ | ✓ |
| لوحة تحليلات | ✗ | ✓ | ✓ | ✓ |
| وصول API | ✗ | ✗ | ✓ | ✓ |
| استخراج البيانات | ✗ | ✗ | ✓ | ✓ |
| تحديد معدل مخصص | ✗ | ✗ | ✗ | ✓ |
| Webhooks | ✗ | ✗ | ✗ | ✓ |

---

## 🐳 تشغيل باستخدام Docker

```bash
# بناء وتشغيل
docker compose up -d

# أو البناء يدوياً
docker build -t web-agent-bridge .
docker run -p 3000:3000 -e JWT_SECRET=your-secret -e JWT_SECRET_ADMIN=your-admin-secret web-agent-bridge
```

---

## 🧪 الاختبارات

```bash
npm test
```

تشمل الاختبارات:
- واجهات المصادقة (تسجيل، دخول، التحقق من التوكن)
- واجهات إدارة المواقع (CRUD، الإعدادات، المستويات)
- واجهات التراخيص (التحقق، التتبع)
- خدمة الصفحات الثابتة

---

## 🤖 Agent SDK — حزمة أدوات الوكيل

يضم WAB حزمة SDK جاهزة لبناء وكلاء ذكاء اصطناعي. راجع [`sdk/README.md`](sdk/README.md) للتوثيق الكامل.

```javascript
const puppeteer = require('puppeteer');
const { WABAgent } = require('web-agent-bridge/sdk');

const browser = await puppeteer.launch();
const page = await browser.newPage();
const agent = new WABAgent(page);

await agent.navigateAndWait('https://example.com');
const actions = await agent.getActions();
await agent.execute('signup', { email: 'user@test.com' });
await browser.close();
```

---

## 📚 أمثلة الوكلاء

أمثلة جاهزة للتشغيل في مجلد [`examples/`](examples/):

| الملف | الوصف |
|---|---|
| `puppeteer-agent.js` | وكيل أساسي باستخدام Puppeteer و `window.AICommands` |
| `bidi-agent.js` | وكيل يستخدم بروتوكول WebDriver BiDi عبر `window.__wab_bidi` |
| `vision-agent.js` | وكيل رؤية — يحل أوصاف اللغة الطبيعية إلى إجراءات WAB |

```bash
node examples/puppeteer-agent.js http://localhost:3000
node examples/bidi-agent.js http://localhost:3000
node examples/vision-agent.js http://localhost:3000
```

---

## 🗄️ دعم قواعد بيانات متعددة

يستخدم WAB قاعدة SQLite افتراضياً ويدعم PostgreSQL و MySQL عبر محوّلات قاعدة البيانات.

```bash
# SQLite (افتراضي — لا حاجة لإعداد)
npm start

# PostgreSQL
npm install pg
DB_ADAPTER=postgresql DATABASE_URL=postgres://user:pass@localhost:5432/wab npm start

# MySQL
npm install mysql2
DB_ADAPTER=mysql DATABASE_URL=mysql://user:pass@localhost:3306/wab npm start
```

---

## 💻 واجهة سطر الأوامر (CLI)

```bash
# تشغيل الخادم
npx web-agent-bridge start
npx web-agent-bridge start --port 8080

# تهيئة مشروع جديد
npx web-agent-bridge init
```

---

## 🔒 الأمان

### صندوق الحماية الأمني (Security Sandbox)

كل نسخة من الجسر تعمل داخل صندوق حماية يوفر:

- **توكنات جلسة** — توكن تشفيري فريد لكل جلسة يمنع هجمات الإعادة (Replay Attacks)
- **التحقق من الأصل** — فقط الأصول المصرح بها يمكنها التفاعل مع الجسر
- **تحقق من الأوامر** — كل أمر يُفحص من حيث الصيغة والطول وقائمة الحظر
- **سجل تدقيق** — كل إجراء يُسجّل بالتوقيت وبصمة الوكيل والحالة
- **حماية التصعيد** — محاولات الوصول لميزات أعلى تؤدي لتأمين تلقائي بعد 5 مخالفات
- **القفل التلقائي** — الجسر يصبح للقراءة فقط عند اكتشاف انتهاكات أمنية

### حماية الخادم

- **CSP (سياسة أمان المحتوى)** — حماية ضد XSS وحقن السكريبت
- **حماية iframe** — `frame-ancestors: 'none'` يمنع تحميل الموقع في إطارات غير موثوقة
- **تشفير كلمات المرور** — bcrypt بتكلفة 12
- **JWT** — توكن مؤقت ينتهي بعد 7 أيام
- **Rate Limiting** — تحديد معدل الطلبات
- **Helmet** — حماية رؤوس HTTP
- **حظر المحددات** — تقييد وصول الوكيل لعناصر محددة

---

## 🔄 المحددات ذاتية الإصلاح (Self-Healing Selectors)

المواقع الحديثة (SPAs) تتغير باستمرار. نظام الإصلاح الذاتي يضمن استمرار عمل المحددات:

1. **البصمات** — عند اكتشاف الإجراءات، يُخزن WAB بصمة غنية لكل عنصر
2. **7 استراتيجيات** — عند تعطل محدد، يجرب WAB: `data-wab-id`، `data-testid`، ID، `aria-label`، `name`، مطابقة نصية ضبابية، موضع + دور
3. **مراقب SPA** — `MutationObserver` يرصد تغييرات DOM ويعيد اكتشاف الإجراءات تلقائياً

```javascript
// أضف هذا للاستقرار الأقصى
<button data-wab-id="signup-btn">إنشاء حساب</button>
```

---

## 🥷 وضع التخفي (Stealth Mode)

لمواجهة أنظمة الحماية من البوتات:

```javascript
window.AIBridgeConfig = { stealth: { enabled: true } };
```

| الميزة | الوصف |
|---|---|
| سلسلة أحداث الفأرة | `mouseover → mouseenter → mousemove → mousedown → mouseup → click` |
| محاكاة الكتابة | حرف بحرف مع تأخير 30-120 مللي ثانية |
| تمرير تدريجي | خطوات متعددة بسرعة متغيرة |
| تأخيرات عشوائية | 50-400 مللي ثانية بين الإجراءات |

---

## 🛠️ التقنيات

- **الخلفية**: Node.js + Express + WebSocket
- **قاعدة البيانات**: SQLite / PostgreSQL / MySQL
- **المصادقة**: JWT + bcrypt
- **الواجهة**: HTML/CSS/JS بدون أطر عمل
- **الأمان**: Helmet, CORS, CSP, Rate Limiting, Security Sandbox
- **الحاويات**: Docker + Docker Compose

---

## 💰 محرك التفاوض اللحظي

يحدد أصحاب المواقع قواعد التفاوض. يتفاوض وكيل الذكاء الاصطناعي على الأسعار في جلسات متعددة الجولات:

```javascript
// فتح جلسة تفاوض
const session = await fetch('/api/sovereign/negotiation/sessions', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    siteId: 'site-uuid',
    agentId: 'agent-id',
    originalPrice: 49.99,
    itemId: 'product-123',
    itemName: 'زيت زيتون ١ لتر'
  })
}).then(r => r.json());

// تقديم عرض مضاد
const counter = await fetch(`/api/sovereign/negotiation/sessions/${session.sessionId}/propose`, {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ agentId: 'agent-id', proposedPrice: 39.99 })
}).then(r => r.json());
// → { status: 'accepted', finalPrice: 42.49, message: 'صفقة! ...' }
```

### أنواع الشروط
| الشرط | الوصف |
|---|---|
| `bulk_quantity` | خصم على الكميات الكبيرة |
| `loyalty` | مكافأة للعملاء المتكررين |
| `time_based` | عروض الساعة السعيدة |
| `first_purchase` | خصم ترحيبي للمشترين الجدد |
| `cart_value` | حد أدنى لقيمة السلة |
| `seasonal` | عروض موسمية بتواريخ محددة |
| `membership` | أسعار خاصة للأعضاء |
| `referral` | خصومات الإحالة |

---

## 🛡️ درع مقاومة التزييف (Anti-Hallucination Shield)

محرك تحقق متقاطع يكتشف أكاذيب الذكاء الاصطناعي قبل وصولها للمستخدم:

```javascript
// التحقق من سعر
const result = await fetch('/api/sovereign/verify/price', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    siteId: 'site-uuid',
    domValue: 29.99,
    visionValue: 29.99,
    category: 'electronics',
    itemName: 'كابل USB'
  })
}).then(r => r.json());
// → { verified: true, confidence: 0.98, severity: 'none' }
```

### طبقات التحقق
١. **DOM مقابل الرؤية** — يقارن السعر المستخرج من DOM مع قراءة لقطة الشاشة
٢. **المعيار السوقي** — يتحقق من السعر مقابل البيانات التاريخية للفئة
٣. **الاتساق الزمني** — يفحص هل تغير السعر بشكل مريب منذ آخر تحقق
٤. **النتيجة المركبة** — مزيج مرجح من جميع الطبقات مع تصنيف الخطورة

---

## 📦 متجر قوالب الوكلاء (Community Agent Hub)

قوالب YAML جاهزة لحالات الاستخدام الشائعة. شغّل أي قالب من سطر الأوامر:

```bash
# عرض القوالب المتاحة
npx wab-agent templates

# تشغيل قالب
npx wab-agent run olive-oil-tunisia --budget 50 --region tunis

# تشغيل مع خادم مخصص
npx wab-agent run hotel-direct-booking --server https://yourserver.com
```

### القوالب المتاحة
| القالب | الوصف |
|---|---|
| `olive-oil-tunisia` | زيت زيتون من مزارع تونسية صغيرة |
| `hotel-direct-booking` | حجز فنادق مباشر بدون وسطاء |
| `artisan-marketplace` | منتجات يدوية من حرفيين مستقلين |
| `grocery-price-compare` | مقارنة أسعار البقالة بين المتاجر المحلية |
| `freelancer-direct` | مستقلون بدون رسوم منصات |
| `restaurant-direct` | مطاعم بدون تطبيقات توصيل |
| `book-price-scout` | كتب من مكتبات مستقلة |
| `flight-deal-hunter` | رحلات مباشرة من شركات الطيران |
| `electronics-price-tracker` | تتبع أسعار الإلكترونيات |
| `local-services` | مزودي خدمات محليين |
| `organic-farm-fresh` | منتجات عضوية مباشرة من المزارع |

---

## 🤝 المساهمة

نرحب بالمساهمات! اقرأ [دليل المساهمة](CONTRIBUTING.md) للبدء.

---

## 📄 الرخصة

MIT — مجاني للاستخدام والتعديل والتوزيع.

</div>
