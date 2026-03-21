<div dir="rtl" align="right">

# Web Agent Bridge (WAB) — جسر الوكيل الذكي

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
- **الأمان أولاً** — حظر المحددات، مصادقة الوكيل، حماية CSP

---

## 🚀 البدء السريع

### ١. التثبيت والتشغيل

```bash
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge
npm install
cp .env.example .env
npm start
```

الخادم يعمل على `http://localhost:3000`.

### باستخدام Docker:

```bash
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
docker run -p 3000:3000 -e JWT_SECRET=your-secret web-agent-bridge
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

## 🔒 الأمان

- **CSP (سياسة أمان المحتوى)** — حماية ضد XSS وحقن السكريبت
- **حماية iframe** — `frame-ancestors: 'none'` يمنع تحميل الموقع في إطارات غير موثوقة
- **تشفير كلمات المرور** — bcrypt بتكلفة 12
- **JWT** — توكن مؤقت ينتهي بعد 7 أيام
- **Rate Limiting** — تحديد معدل الطلبات
- **Helmet** — حماية رؤوس HTTP
- **حظر المحددات** — تقييد وصول الوكيل لعناصر محددة

---

## 🛠️ التقنيات

- **الخلفية**: Node.js + Express + WebSocket
- **قاعدة البيانات**: SQLite (better-sqlite3)
- **المصادقة**: JWT + bcrypt
- **الواجهة**: HTML/CSS/JS بدون أطر عمل
- **الأمان**: Helmet, CORS, CSP, Rate Limiting
- **الحاويات**: Docker + Docker Compose

---

## 🤝 المساهمة

نرحب بالمساهمات! اقرأ [دليل المساهمة](CONTRIBUTING.md) للبدء.

---

## 📄 الرخصة

MIT — مجاني للاستخدام والتعديل والتوزيع.

</div>
