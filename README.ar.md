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
- **بنية الإضافات** — نظام إضافات ديناميكي مع تنفيذ قائم على الخطافات، تثبيت لكل موقع، ترتيب أولويات، تقييمات، وتدقيق
- **خدمة الرؤية** — تحليل لقطات شاشة متعدد الموفرين (Moondream محلي، OpenAI، Anthropic، Ollama) مع كشف العناصر التفاعلية وتشفير AES-256-GCM
- **محرك العدالة** — طبقة حياد تضمن فرصة متساوية للمواقع الصغيرة والكبيرة مع بحث مرجح بالعدالة وتتبع شفافية العمولات
- **ذاكرة الوكيل** — ذاكرة سلوكية دائمة مع ٤ أنواع ذاكرة، ٥ فئات، ارتباطات دلالية، تقييم الأهمية، وانتهاء صلاحية مؤقت
- **تحليل حركة المرور المتقدم** — كشف أكثر من ٣٠ نوع بوت، تحليل سلوكي، كشف شذوذ، كشف استغلالات أمنية (SQL injection، XSS)
- **خدمة البريد الإلكتروني** — بريد SMTP (ترحيب، تسجيل، إعادة تعيين كلمة المرور) مع قوالب HTML
- **تتبع بدون JavaScript** — نقطة بكسل تتبع ١×١ لجمع التحليلات عند عدم توفر JavaScript
- **محول WAB-MCP** — كشف قدرات مواقع WAB كأدوات MCP لـ Claude وGPT وGemini والوكلاء المتوافقة
- **إضافة WordPress** — إضافة WordPress أصلية مع صفحة إعدادات، صناديق وصف لكل صفحة، توليد مستند اكتشاف، وعنصر لوحة تحكم
- **متصفح WAB (سطح المكتب)** — متصفح Electron مستقل مع حاجب إعلانات مدمج (٨٠+ نطاق)، درع الاحتيال، تصنيف عدالة، دردشة وكيل، إشارات، سجل
- **متصفح PWA (الهاتف)** — تطبيق ويب تقدمي لـ Android/iOS مع حجب إعلانات، بحث DuckDuckGo، كشف احتيال، تصفية شركات التقنية الكبرى
- **SDK اكتشاف المخططات** — استخراج JSON-LD schema.org من جانب الخادم مع توليد تلميحات إجراءات WAB تلقائياً

### الإصدار 2.0 — ميزات الحصن الرقمي

- **محرك التفاوض اللحظي** — يتفاوض وكيل الذكاء الاصطناعي على الأسعار مباشرة مع المواقع عبر جلسات متعددة الجولات. ٨ أنواع شروط (كميات، ولاء، وقت، أول شراء، قيمة سلة، موسمية، عضوية، إحالة) و٤ أنواع خصومات (نسبة، مبلغ ثابت، شحن مجاني، هدية). يشمل حدود يومية وقيم حد أدنى وسجل كامل
- **درع مقاومة التزييف** — محرك تحقق متقاطع يقارن DOM مع لقطات الشاشة، يتحقق من الأسعار مقابل المعايير السوقية، يفحص الاتساق الزمني، ويقيس تشابه النصوص. ٤ مستويات خطورة (بسيط ← احتيال) و٥ إجراءات استجابة (تحذير، إيقاف، تأكيد بشري، تصحيح تلقائي، حظر)
- **نظام السمعة اللامركزي** — شهادات ثقة موقعة بـ HMAC من شبكة الوكلاء تغطي ٦ أنواع شهادات (شراء، حجز، استعلام، نموذج، تنقل، تحقق). ٧ مستويات ثقة (مجهول ← محظور)، اضمحلال زمني، مقاومة Sybil، لوحة متصدرين عالمية، ونظام طعن/نزاع
- **لوحة السيادة** — مركز قيادة لحظي يعرض رادار العدالة، درع الخصوصية، سجل التفاوض، فحوصات التحقق، ومبدّل نماذج الذكاء الاصطناعي. يكشف نقطة `/api/sovereign/dashboard/sovereign` للبيانات المجمعة
- **متجر قوالب الوكلاء** — ١١ قالب YAML جاهز (حجز فنادق، مقارنة بقالة، سوق حرفيين، صفقات طيران، إلخ) مع تشغيل من سطر الأوامر: `npx wab-agent run template.yaml`
- **تبديل عقل الوكيل** — نظام تشغيل AI محلي يكتشف Ollama وllama.cpp تلقائياً مع دعم APIs متوافقة مع OpenAI. تتبع قدرات النماذج (نص/رؤية)، إدارة نوافذ السياق، توجيه حسب زمن الاستجابة، وتسجيل الاستدلال
- **تنسيق الوكيل عبر المواقع** — وكيل واحد يدير عدة مواقع WAB في نفس الوقت عبر `WABMultiAgent`. قارن الأسعار بين المتاجر، اجمع البيانات، نفّذ إجراءات متوازية، واعثر على أفضل صفقة تلقائياً

### الإصدار 2.3 — شبكة الوكلاء الخاصة (العقل الموزّع)

- **بروتوكول التواصل بين الوكلاء** — الوكلاء يتواصلون عبر شبكة خاصة مع ٥ قنوات مدمجة (تنبيهات، اكتشافات، تكتيكات، مفاوضات، تصويت). ٦ أنواع رسائل مع تقييم الثقة، إزالة الوكلاء الخاملين تلقائياً عبر نبضات القلب، تحقق الأقران من المعرفة المشتركة. كل الاتصال يبقى محلياً
- **التعلم المعزز المحلي** — الوكلاء يتعلمون من كل قرار للمستخدم باستخدام خوارزمية UCB1 متعددة الأذرع، تحديث السياسات بالنزول التدريجي مع تنشيط sigmoid، تخفيض زمني، واستخراج الأنماط المتسلسلة. بدون أي مكالمات API خارجية — التعلم بالكامل محلي
- **منسق السيمفونية** — أربعة وكلاء متخصصين (باحث، محلل، مفاوض، حارس) يتعاونون ذاتياً عبر محركات قائمة على القواعد. ٥ قوالب، خط أنابيب من ٦ مراحل (تحليل ← بحث ← تفاوض ← حراسة ← تركيب ← قرار)، حق نقض الحارس للأمان، إجماع مرجح. تسجيل كامل للمراحل مع تتبع المدة. بدون أي اعتماد على LLM خارجية
- **لوحة شبكة الوكلاء** — عرض مباشر لشبكة الوكلاء: الوكلاء النشطون، قنوات الاتصال، قاعدة المعرفة المشتركة، تركيبات السيمفونية، ومقاييس أداء التعلم

### الإصدار 2.4 — القائد والذكاء على الحافة

- **نظام القائد (Commander)** — محرك تنسيق مهام محلي يفكك الأهداف العليا إلى رسوم بيانية مهام (DAG). سجل وكلاء مع تتبع القدرات، محرك تنفيذ متوازٍ، تكامل تعلم لتغذية راجعة من النتائج، وتنسيق حوسبة طرفية
- **نظام الحوسبة الطرفية (Edge Compute)** — يحول كل جهاز مستخدم إلى عقدة AI سيادية. تحليل المعدات (CPU, RAM, GPU)، تشفير AES-256-GCM بين العقد، موازنة حمل مرجحة، مراقبة صحة بنبضات القلب مع تجاوز فشل تلقائي، وتشكيل أسراب حسب القدرات
- **محرك التنفيذ بالسرب** — إطلاق عدة وكلاء بالتوازي لحل مهمة واحدة. استراتيجيات قابلة للتكوين (متوازي، متسلسل، هجين)، دمج النتائج بأفضل درجة، تخصص بالأدوار، تجميع مرجح بالعدالة، وتقييم ثقة لكل وكيل

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
├── server/                         # خادم Express.js
│   ├── index.js                    # نقطة البداية
│   ├── ws.js                       # WebSocket للتحليلات الفورية
│   ├── routes/
│   │   ├── auth.js                 # المصادقة (تسجيل/دخول)
│   │   ├── api.js                  # واجهة المواقع والتحليلات
│   │   ├── license.js              # التحقق من التراخيص والتتبع
│   │   ├── admin.js                # واجهة الإدارة
│   │   ├── admin-premium.js        # تحليلات الإدارة المتقدمة
│   │   ├── billing.js              # تكامل Stripe للمدفوعات
│   │   ├── sovereign.js            # الإصدار 2.0: تفاوض، سمعة، تحقق، لوحة سيادة
│   │   ├── mesh.js                 # الإصدار 2.3: مسارات شبكة الوكلاء
│   │   ├── commander.js            # الإصدار 2.4: مسارات تنسيق المهام
│   │   ├── premium.js              # الميزات المتقدمة
│   │   ├── premium-v2.js           # ذاكرة، رؤية، إصلاح، سرب، إضافات
│   │   ├── discovery.js            # اكتشاف WAB + بحث مرجح بالعدالة
│   │   ├── wab-api.js              # نقل WAB عبر HTTP
│   │   └── noscript.js             # بكسل تتبع بدون JavaScript
│   ├── services/
│   │   ├── negotiation.js          # محرك التفاوض اللحظي
│   │   ├── verification.js         # درع مقاومة التزييف
│   │   ├── reputation.js           # نظام السمعة اللامركزي
│   │   ├── agent-mesh.js           # بروتوكول التواصل بين الوكلاء
│   │   ├── agent-learning.js       # التعلم المعزز المحلي (UCB1)
│   │   ├── agent-symphony.js       # منسق السيمفونية (٤ أدوار، ٦ مراحل)
│   │   ├── agent-memory.js         # ذاكرة الوكيل مع ارتباطات
│   │   ├── commander.js            # تنسيق المهام ورسوم المهام (DAG)
│   │   ├── edge-compute.js         # حوسبة طرفية / عقد AI سيادية
│   │   ├── swarm.js                # محرك التنفيذ بالسرب
│   │   ├── fairness.js             # محرك العدالة والحياد
│   │   ├── vision.js               # تحليل الرؤية (متعدد الموفرين)
│   │   ├── self-healing.js         # تصحيحات المحددات ذاتية الإصلاح
│   │   ├── local-ai.js             # نظام تشغيل AI المحلي
│   │   ├── plugins.js              # بنية الإضافات (خطافات، سجل)
│   │   ├── premium.js              # تحليل حركة المرور وكشف البوتات
│   │   ├── email.js                # خدمة البريد SMTP
│   │   └── stripe.js               # تكامل مدفوعات Stripe
│   ├── middleware/
│   │   ├── auth.js                 # وسيط JWT
│   │   ├── adminAuth.js            # مصادقة الإدارة
│   │   └── rateLimits.js           # تحديد معدل الطلبات متعدد الطبقات
│   ├── models/
│   │   ├── db.js                   # عمليات قاعدة البيانات
│   │   └── adapters/              # محولات SQLite, PostgreSQL, MySQL
│   ├── migrations/                 # ترحيلات SQL مرقمة
│   └── utils/
│       ├── cache.js                # ذاكرة مؤقتة TTL + طابور تحليلات
│       ├── migrate.js              # مشغل الترحيلات
│       └── secureFields.js         # أدوات تشفير الحقول
├── public/                         # الواجهة الأمامية
│   ├── index.html                  # الصفحة الرئيسية
│   ├── dashboard.html              # لوحة التحكم
│   ├── premium-dashboard.html      # لوحة التحليلات المتقدمة
│   ├── docs.html                   # التوثيق
│   ├── login.html / register.html  # صفحات المصادقة
│   ├── admin/                      # لوحة الإدارة
│   ├── pwa/                        # تطبيق الويب التقدمي (متصفح الهاتف)
│   │   ├── manifest.json           # بيان PWA
│   │   ├── sw.js                   # عامل الخدمة (أولوية غير متصل)
│   │   ├── index.html              # واجهة المتصفح للهاتف
│   │   ├── app.js                  # حاجب إعلانات، درع احتيال، عدالة
│   │   ├── app.css                 # سمة داكنة محسنة للهاتف
│   │   └── icons/                  # أيقونات PWA
│   ├── script/
│   │   ├── wab.min.js              # مكتبة WAB المصغرة
│   │   ├── wab-consent.js          # لافتة موافقة GDPR/CCPA
│   │   ├── wab-schema.js           # اكتشاف schema.org
│   │   ├── wab.d.ts                # تعريفات TypeScript
│   │   └── wab-consent.d.ts        # تعريفات TypeScript للموافقة
│   ├── js/                         # JavaScript الواجهة
│   └── css/                        # أوراق الأنماط
├── script/
│   └── ai-agent-bridge.js          # سكريبت الجسر (ضعه في موقعك)
├── examples/                       # أمثلة الوكلاء
│   ├── puppeteer-agent.js          # Puppeteer + window.AICommands
│   ├── bidi-agent.js               # بروتوكول WebDriver BiDi
│   ├── vision-agent.js             # تحليل رؤية/لغة طبيعية
│   ├── mcp-agent.js                # محول MCP لـ Claude/GPT
│   ├── cross-site-agent.js         # تنسيق متعدد النطاقات
│   ├── next-app-router/            # تكامل Next.js App Router
│   ├── shopify-hydrogen/           # واجهة Shopify Hydrogen
│   ├── wordpress-elementor/        # WordPress + Elementor
│   └── saas-dashboard/             # إجراءات لوحة SaaS
├── packages/                       # أغلفة أطر العمل
│   ├── react/                      # @web-agent-bridge/react
│   ├── vue/                        # @web-agent-bridge/vue
│   ├── svelte/                     # @web-agent-bridge/svelte
│   └── langchain/                  # @web-agent-bridge/langchain
├── sdk/                            # SDK الوكيل
│   ├── index.js                    # WABAgent لـ Puppeteer/Playwright
│   └── schema-discovery.js         # استخراج schema.org من الخادم
├── wab-mcp-adapter/                # محول MCP لـ Claude/GPT/Gemini
│   ├── index.js                    # تعريفات أدوات MCP
│   └── package.json
├── wab-browser/                    # متصفح Electron لسطح المكتب
│   ├── main.js                     # العملية الرئيسية لـ Electron
│   ├── preload.js                  # التحميل المسبق
│   └── package.json
├── web-agent-bridge-wordpress/     # إضافة WordPress
│   ├── web-agent-bridge.php        # نقطة دخول الإضافة
│   ├── includes/                   # فئات PHP (API, Actions, Dashboard)
│   └── assets/                     # CSS/JS الإضافة
├── bin/
│   ├── cli.js                      # نقطة دخول CLI (wab-agent)
│   └── wab.js                      # مشغل الوكلاء
├── templates/                      # ١١ قالب YAML لمتجر الوكلاء
├── docs/
│   ├── SPEC.md                     # مواصفة بروتوكول WAB
│   └── DEPLOY.md                   # دليل النشر
├── demo-store/                     # متجر تجريبي للاختبار
├── deploy/                         # إعدادات Nginx
├── tests/                          # اختبارات Jest + Supertest
├── .env                            # متغيرات البيئة
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
| `/api/license/token` | POST | تبادل `siteId` مقابل توكن جلسة |
| `/api/license/session` | POST | التحقق من توكن الجلسة |
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

### شبكة الوكلاء (الإصدار 2.3)
| النقطة | الطريقة | الوصف |
|---|---|---|
| `/api/mesh/agents` | POST | تسجيل وكيل في الشبكة |
| `/api/mesh/agents` | GET | عرض وكلاء الشبكة |
| `/api/mesh/channels` | GET | عرض قنوات الاتصال |
| `/api/mesh/messages` | POST | نشر رسالة في قناة |
| `/api/mesh/messages/:channel` | GET | قراءة رسائل القناة |
| `/api/mesh/knowledge` | POST | مشاركة معرفة |
| `/api/mesh/knowledge` | GET | استعلام قاعدة المعرفة |
| `/api/mesh/votes` | POST | بدء تصويت |
| `/api/mesh/votes/:id/cast` | POST | الإدلاء بصوت |
| `/api/mesh/votes/:id/tally` | GET | نتائج التصويت |

### القائد (الإصدار 2.4)
| النقطة | الطريقة | الوصف |
|---|---|---|
| `/api/commander/missions` | POST | إنشاء مهمة جديدة |
| `/api/commander/missions/:id/launch` | POST | إطلاق المهمة |
| `/api/commander/missions/:id` | GET | حالة المهمة |
| `/api/commander/missions` | GET | عرض جميع المهام |
| `/api/commander/agents` | POST | تسجيل وكيل |
| `/api/commander/agents` | GET | عرض الوكلاء |
| `/api/commander/edge/nodes` | POST | تسجيل عقدة حوسبة طرفية |
| `/api/commander/edge/nodes` | GET | عرض العقد |
| `/api/commander/ai/models` | GET | اكتشاف نماذج AI المحلية |
| `/api/commander/ai/infer` | POST | تشغيل استدلال AI محلي |
| `/api/commander/stats` | GET | إحصائيات المنصة الموحدة |

### الميزات المتقدمة (الإصدار 2)
| النقطة | الطريقة | الوصف |
|---|---|---|
| `/api/premium/v2/memory` | POST | تخزين ذاكرة الوكيل |
| `/api/premium/v2/memory/:agentId` | GET | استرجاع ذكريات الوكيل |
| `/api/premium/v2/memory/associate` | POST | إنشاء ارتباط بين ذكريات |
| `/api/premium/v2/vision/analyze` | POST | تحليل لقطة شاشة |
| `/api/premium/v2/vision/elements` | POST | استخراج عناصر تفاعلية |
| `/api/premium/v2/healing/corrections` | POST | تسجيل تصحيح محدد |
| `/api/premium/v2/healing/resolve` | POST | حل محدد معطل |
| `/api/premium/v2/swarm/execute` | POST | إطلاق مهمة سرب |
| `/api/premium/v2/swarm/:id` | GET | نتائج السرب |
| `/api/premium/v2/plugins` | GET | عرض الإضافات المتاحة |
| `/api/premium/v2/plugins/:id/install` | POST | تثبيت إضافة |
| `/api/premium/v2/plugins/:id/hooks` | POST | تنفيذ خطاف إضافة |

### الاكتشاف والعدالة
| النقطة | الطريقة | الوصف |
|---|---|---|
| `/api/discovery` | GET | مستند اكتشاف WAB |
| `/api/discovery/search` | GET | بحث مرجح بالعدالة |
| `/api/discovery/register` | POST | تسجيل موقع في دليل WAB |

### بروتوكول WAB (نقل HTTP)
| النقطة | الطريقة | الوصف |
|---|---|---|
| `/api/wab/session` | POST | تبادل توكن جلسة |
| `/api/wab/actions` | GET | الإجراءات المتاحة |
| `/api/wab/execute` | POST | تنفيذ إجراء عبر HTTP |

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
| `mcp-agent.js` | استخدام محول MCP لـ Claude وGPT مع اكتشاف الأدوات |
| `cross-site-agent.js` | تنسيق متعدد النطاقات — مقارنة أسعار، تجميع بيانات، أفضل الصفقات |

### أمثلة التكامل مع أطر العمل

| المسار | الوصف |
|---|---|
| `examples/next-app-router/` | تكامل Next.js App Router مع `@web-agent-bridge/react` |
| `examples/shopify-hydrogen/` | واجهة Shopify Hydrogen مع إجراءات سلة عملية |
| `examples/wordpress-elementor/` | إعداد WordPress + Elementor مع إجراءات مدعومة بالمخطط |
| `examples/saas-dashboard/` | لوحة SaaS بنمط Notion مع مؤشرات أداء وتشغيل سير عمل |

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

- **الخلفية**: Node.js + Express + WebSocket (ws)
- **قاعدة البيانات**: SQLite (عبر better-sqlite3) مع مشغل ترحيلات
- **المصادقة**: JWT + bcrypt + توكنات جلسة (مقفلة بالنطاق)
- **التخزين المؤقت**: ذاكرة مؤقتة TTL + طابور تحليلات مجمع
- **المدفوعات**: تكامل Stripe مع بوابة الفوترة
- **الواجهة**: HTML/CSS/JS بدون أطر عمل
- **أغلفة أطر العمل**: React, Vue 3, Svelte (اختيارية)
- **تكامل LLM**: محول LangChain، محول MCP
- **الأمان**: Helmet, CORS, CSP, Rate Limiting متعدد الطبقات
- **الحاويات**: Docker + Docker Compose
- **CI/CD**: GitHub Actions (اختبار + نشر تلقائي في npm)
- **الاختبارات**: Jest + Supertest

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

## 🎯 نظام القائد (Commander)

محرك تنسيق مهام محلي يفكك الأهداف العليا إلى مهام مترابطة ويوزعها على وكلاء متخصصين:

```javascript
// إنشاء مهمة
const mission = await fetch('/api/commander/missions', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    goal: 'إيجاد أرخص زيت زيتون في ٥ متاجر',
    strategy: 'parallel',
    agents: ['researcher-1', 'analyst-1', 'negotiator-1']
  })
}).then(r => r.json());

// إطلاق المهمة
await fetch(`/api/commander/missions/${mission.id}/launch`, {
  method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
});
```

| القدرة | الوصف |
|---|---|
| **تفكيك المهام** | تحويل الأهداف إلى رسوم بيانية مهام (DAG) مع تتبع التبعيات |
| **سجل الوكلاء** | تتبع قدرات وأداء الوكلاء المسجلين |
| **تنفيذ متوازٍ** | تشغيل المهام المستقلة بالتوازي عبر عدة وكلاء |
| **تعلم من النتائج** | تسجيل النتائج لتغذية راجعة في التعلم المعزز |
| **تنسيق حوسبة طرفية** | توزيع المهام الثقيلة على عقد الحافة |

---

## 🖥️ نظام الحوسبة الطرفية (Edge Compute)

حوّل كل جهاز إلى عقدة AI سيادية — بدون سحابة مركزية:

```javascript
// تسجيل جهاز كعقدة حوسبة طرفية
await fetch('/api/commander/edge/nodes', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'حاسوبي',
    capabilities: { cpu: 8, ram: 16384, gpu: true },
    supportedTasks: ['text-inference', 'vision-analysis', 'price-comparison']
  })
}).then(r => r.json());
```

| القدرة | الوصف |
|---|---|
| **تحليل المعدات** | كشف إمكانيات CPU, RAM, GPU لكل عقدة |
| **تشفير AES-256-GCM** | كل البيانات بين العقد مشفرة من الطرف للطرف |
| **موازنة حمل مرجحة** | توجيه المهام حسب المعدات والتوفر |
| **مراقبة بنبضات القلب** | تجاوز فشل تلقائي عند عدم استجابة العقد |
| **تشكيل أسراب** | تجميع العقد حسب القدرات |

---

## 🐝 محرك التنفيذ بالسرب (Swarm)

أطلق عدة وكلاء بالتوازي لحل مهمة واحدة ثم ادمج نتائجهم بذكاء:

```javascript
const swarm = await fetch('/api/premium/v2/swarm/execute', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    task: 'أفضل عروض لاب توب تحت ١٠٠٠ دولار',
    strategy: 'parallel',        // parallel | sequential | hybrid
    agentCount: 4,
    roles: ['researcher', 'analyst', 'price-checker', 'reviewer'],
    mergeStrategy: 'best-score'  // best-score | fairness-weighted | consensus
  })
}).then(r => r.json());
```

---

## ⚖️ محرك العدالة (Fairness Engine)

طبقة حياد تضمن فرصة متساوية للمواقع الصغيرة والكبيرة:

```javascript
// بحث مرجح بالعدالة (بدلاً من ترتيب الصلة فقط)
const results = await fetch('/api/discovery/search?q=زيت+زيتون&fairness=true', {
  headers: { 'Authorization': 'Bearer ' + token }
}).then(r => r.json());
// المزارع الصغيرة تُرتّب بجانب أمازون — مرجحة بدرجة الحياد لا بـ SEO فقط
```

### كيف يعمل تقييم الحياد
| العامل | الوزن | الوصف |
|---|---|---|
| **اكتمال الإعداد** | ٢٥٪ | مدى جودة إعداد WAB في الموقع |
| **درجة الثقة** | ٢٥٪ | شهادات السمعة من شبكة الوكلاء |
| **الشفافية** | ٢٥٪ | إفصاح العمولة، وضوح التسعير |
| **الاستجابة** | ٢٥٪ | زمن استجابة API، وقت التشغيل، نجاح الإجراءات |

---

## 🧠 ذاكرة الوكيل (Agent Memory)

ذاكرة سلوكية دائمة تسمح للوكلاء بتذكر تفضيلات المستخدم وبناء ارتباطات:

```javascript
// تخزين ذاكرة
await fetch('/api/premium/v2/memory', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentId: 'agent-1',
    type: 'preference',         // preference | interaction | correction | pattern
    category: 'purchase',       // navigation | purchase | search | form | custom
    key: 'العلامة-المفضلة',
    value: 'عضوي-فقط',
    importance: 0.9
  })
}).then(r => r.json());

// إنشاء ارتباطات بين الذكريات
await fetch('/api/premium/v2/memory/associate', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sourceId: 'memory-1',
    targetId: 'memory-2',
    relationship: 'leads_to'   // leads_to | similar_to | replaces | depends_on
  })
}).then(r => r.json());
```

---

## 👁️ خدمة الرؤية (Vision Analysis)

تحليل لقطات شاشة متعدد الموفرين لكشف العناصر التفاعلية واستخراج البيانات:

| الموفر | محلي؟ | الوصف |
|---|---|---|
| **Moondream** | ✅ | نموذج رؤية محلي خفيف |
| **Ollama** | ✅ | نماذج محلية عبر Ollama (llava, bakllava) |
| **OpenAI** | ❌ | GPT-4 Vision |
| **Anthropic** | ❌ | Claude Vision |

---

## 🔌 بنية الإضافات (Plugin Architecture)

نظام إضافات ديناميكي يسمح بامتدادات من أطراف ثالثة:

```javascript
// عرض الإضافات المتاحة
const plugins = await fetch('/api/premium/v2/plugins', {
  headers: { 'Authorization': 'Bearer ' + token }
}).then(r => r.json());

// تثبيت إضافة لموقعك
await fetch('/api/premium/v2/plugins/price-alert/install', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ siteId: 'site-uuid', config: { threshold: 10 } })
}).then(r => r.json());
```

---

## 🔍 تحليل حركة المرور المتقدم (Traffic Intelligence)

| القدرة | الوصف |
|---|---|
| **٣٠+ نوع بوت** | كشف Google, Bing, ChatGPT, Claude, Perplexity وغيرها |
| **تحليل سلوكي** | تصنيف سلوك الوكلاء حسب البصمة والمنصة والنوع |
| **كشف شذوذ** | كشف الارتفاعات المفاجئة وتحليل أنماط غير عادية |
| **كشف استغلالات أمنية** | رصد أنماط SQL injection, XSS, Rate anomalies |
| **تنبيهات Webhook** | إطلاق webhooks عند نشاط مشبوه |
| **تدقيق للامتثال** | سجل تدقيق كامل للتوافق التنظيمي |

---

## 🔗 محول WAB-MCP

كشف قدرات مواقع WAB كأدوات [MCP](https://modelcontextprotocol.io/) لـ Claude وGPT وGemini:

```javascript
const { WABMCPAdapter } = require('wab-mcp-adapter');

const adapter = new WABMCPAdapter({
  siteUrl: 'https://shop.example.com',
  transport: 'http'           // http | websocket | direct
});

const tools = await adapter.getTools();
const result = await adapter.executeTool('execute_action', {
  name: 'addToCart', params: { sku: 'ABC123' }
});
```

### أدوات MCP المدمجة
| الأداة | الوصف |
|---|---|
| `discover` | اكتشاف الإجراءات المتاحة تلقائياً |
| `get_actions` | قائمة كل الإجراءات مع المعاملات |
| `execute_action` | تنفيذ إجراء محدد |
| `read_content` | قراءة محتوى من الصفحة |
| `get_page_info` | معلومات وصفية عن الصفحة |
| `fairness_search` | بحث في دليل WAB مرجح بالعدالة |
| `authenticate` | مصادقة وكيل مع الموقع |

---

## 🖥️ متصفح WAB (سطح المكتب)

متصفح Electron مستقل مع ميزات خصوصية وعدالة مدمجة:

- **حاجب الإعلانات** — ٨٠+ نطاق محظور + مطابقة أنماط URL + قواعد CSS تجميلية
- **درع الاحتيال** — كشف نطاقات TLD مشبوهة وانتحال أسماء العلامات التجارية
- **تصنيف العدالة** — أولوية للمواقع المستقلة، تنبيه عن تركز الشركات الكبرى
- **دردشة الوكيل** — مساعد AI مدمج للتصفح
- **الإشعارات** — تحليل الصفحة مع تنبيهات أمان وعدالة
- **وضع الشبح** — تصفح بخصوصية بدون تتبع
- **بحث ذكي** — تكامل DuckDuckGo للبحث الخاص

```bash
# تشغيل متصفح WAB
cd wab-browser
npm install
npx electron .

# بناء المثبت (Windows NSIS)
npm run build:win
```

---

## 📱 متصفح PWA (الهاتف)

تطبيق ويب تقدمي لـ Android وiOS — قابل للتثبيت من أي متصفح هاتف:

- **حاجب إعلانات** — ٤٥+ نطاق إعلاني محظور + مطابقة أنماط URL
- **كشف الاحتيال** — تنبيهات TLD مشبوهة وفحوصات انتحال العلامات
- **وضع العدالة** — تصفية مواقع التقنية الكبرى لتعزيز البدائل المستقلة
- **أولوية غير متصل** — عامل الخدمة يخزن أصول الواجهة مؤقتاً للتشغيل بدون إنترنت
- **بحث خاص** — تكامل DuckDuckGo (بدون تتبع Google)
- **دردشة وكيل** — مساعد AI مع احتياطي محلي

ثبّته من: `https://yourserver.com/pwa/`

---

## 📦 إضافة WordPress

إضافة WordPress أصلية لإضافة دعم WAB لأي موقع WordPress:

| القدرة | الوصف |
|---|---|
| **صفحة إعدادات** | إعداد عنوان API، معرف الموقع، الصلاحيات |
| **إجراءات لكل صفحة** | صندوق وصف لإضافة إجراءات WAB مخصصة لكل صفحة/مقال |
| **مستند اكتشاف** | توليد تلقائي لنقطة اكتشاف WAB |
| **عنصر لوحة تحكم** | عرض حالة WAB وإحصائيات تفاعل الوكلاء |
| **كود قصير** | `[wab_bridge]` لتضمين WAB في صفحات محددة |
| **خطافات** | `wab_before_action` / `wab_after_action` لمنطق مخصص |

راجع [`web-agent-bridge-wordpress/README.md`](web-agent-bridge-wordpress/README.md) للتوثيق الكامل.

---

## 📋 مواصفة بروتوكول WAB

المواصفة المعيارية الكاملة متاحة في [`docs/SPEC.md`](docs/SPEC.md):

| الطبقة | الوصف |
|---|---|
| **طبقة البروتوكول** | صيغة مستند الاكتشاف، بروتوكول الأوامر، بروتوكول العدالة |
| **طبقة التشغيل** | واجهة `window.AICommands`، محرك الاكتشاف التلقائي، صندوق الأمان |
| **طبقة النقل** | متغير JavaScript عام، WebSocket, HTTP, WebDriver BiDi, MCP |

### دورة الحياة من ٥ مراحل
١. **اكتشاف** — الوكيل يجد مستند اكتشاف WAB (`.well-known/wab.json` أو وسم سكريبت)
٢. **مصادقة** — الوكيل يستبدل `siteId` بتوكن جلسة
٣. **تخطيط** — الوكيل يقرأ الإجراءات المتاحة ومعلومات الصفحة
٤. **تنفيذ** — الوكيل يشغل الإجراءات عبر الجسر
٥. **تأكيد** — النتائج تُتحقق عبر درع مقاومة التزييف

---

## 🤝 المساهمة

نرحب بالمساهمات! اقرأ [دليل المساهمة](CONTRIBUTING.md) للبدء.

---

## 📄 الرخصة

MIT — مجاني للاستخدام والتعديل والتوزيع.

</div>
