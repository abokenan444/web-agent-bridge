# 🚀 Quick Install Guide / دليل التنصيب السريع

> **Goal / الهدف:** get a sovereign WAB agent running on your domain in **5 minutes**.

**English** | **[العربية](#العربية)**

---

## English

**Web Agent Bridge (WAB)** is the open AI↔Web protocol. This guide takes you from zero
to a running WAB-enabled site (with DNS Discovery) in under five minutes.

### 1. Prerequisites

- **Node.js ≥ 18** (the WAB platform runs on Node, not Rust — there is no compile step).
- A domain you control (any registrar — Cloudflare, GoDaddy, Namecheap, Route 53, cPanel…).
- A terminal.

### 2. Make your site AI-discoverable (the 1-command path)

```bash
npx wab init --site https://yourdomain.com
```

That one command:

1. Writes `.well-known/wab.json` (the discovery contract).
2. Writes `.well-known/security.txt` (RFC 9116 contact channel).
3. Creates `.env` with safe defaults.
4. Prints the exact **TXT records** to paste into your DNS panel.

Output looks like this:

```
  ✓ Created .well-known/wab.json
  ✓ Created .well-known/security.txt
  ✓ Created .env

  Type   Name           Value
  TXT    _wab           v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json
  TXT    _wab-trust     trust=https://yourdomain.com/trust.json; security=…
  TXT    _wab-agent     agent=https://yourdomain.com/agent-bridge.json; ver=2
```

### 3. Paste the TXT records at your registrar

Cloudflare / GoDaddy / Namecheap / Route 53 / cPanel — pick **TXT**, paste the value, save. TTL `3600` (or `Auto`) is fine.

### 4. Verify with `wab-dns`

```bash
npx -y @wab/dns-verify yourdomain.com
# strict mode + machine-readable output for CI:
npx -y @wab/dns-verify yourdomain.com --trust --policy --json
```

You should see `✅ Valid WAP Protocol format.`. If `AD` is missing, enable DNSSEC at your registrar (recommended, not required).

### 5. Run the server (optional — only if you want the full WAB platform)

```bash
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge
npm install
npx wab init --env-only
npm start
```

The agent dashboard is now at `http://localhost:3000/`.

### Deploy to a real host

| Platform   | One-click                                                                                                                               |
|------------|------------------------------------------------------------------------------------------------------------------------------------------|
| Railway    | [Deploy](https://railway.app/template/web-agent-bridge?referralCode=wab) (persistent SQLite, recommended)                                |
| Vercel     | [Deploy](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fabokenan444%2Fweb-agent-bridge)                          |
| Cloudflare | [Deploy](https://deploy.workers.cloudflare.com/?url=https://github.com/abokenan444/web-agent-bridge) (edge, 100K req/day free)           |
| Docker     | `docker compose up -d`                                                                                                                   |

---

## 🛡️ Why WAB?

- **Sovereignty** — No middleman. You own your data, your keys, and your DNS records. No
  third party sees your agent traffic between the resolver and your origin.
- **Invisible Security** — Per-request CSP nonces, reward-anomaly clamping, cross-site PII
  redaction, URL-policy guard with audit log. Protection happens at the platform layer, not
  in the user's face.
- **DNS Discovery** — Agents resolve `_wab.{site}` over **DoH** (encrypted from the ISP).
  No HTTP probing, no scraping, no cookie-banner consent flow. The Silent Handshake
  negotiates intent in the background.
- **Open protocol** — The wire format, the discovery records, the verifier, and the SDK
  are open source. The platform-as-a-service is closed source, but the protocol is not.

---

## 📜 What's open source vs closed source?

WAB is intentionally **open core**:

| Layer                                                           | License        | Where                                                    |
|-----------------------------------------------------------------|----------------|----------------------------------------------------------|
| Protocol spec ([docs/SPEC.md](docs/SPEC.md))                    | **Open / MIT** | This repo                                                |
| `npm: web-agent-bridge` (CLI, server, SDK)                      | **Open / MIT** | This repo, `bin/`, `server/`, `sdk/`, `packages/`        |
| `npm: @wab/dns-verify` (DNS Discovery CLI)                      | **Open / MIT** | This repo, `packages/dns-verify/`                        |
| WordPress plugin                                                | **Open / GPL** | This repo, `web-agent-bridge-wordpress/`                 |
| React / Vue / Svelte / LangChain SDK                            | **Open / MIT** | This repo, `packages/{react,vue,svelte,langchain}/`      |
| Discovery records, JSON schema, ABNF grammar                    | **Open / MIT** | This repo, `docs/SPEC.md` §4.6                           |
| Sovereign Browser desktop app                                   | **Open / MIT** | This repo, `wab-browser/`                                |
| **webagentbridge.com** marketing site, dashboards, billing      | **Closed**     | Internal — not in this repo                              |
| **Hosted Agent Mesh** (multi-tenant orchestration, fairness)    | **Closed**     | Internal — runs at `webagentbridge.com`                  |
| **Premium analytics, plugin marketplace, license issuance**     | **Closed**     | Internal — described in [docs/SPEC.md](docs/SPEC.md) §10 |

The rule: **if it's a protocol, it's open. If it's a product, it's closed.** You can run
your own WAB platform end-to-end from this repo, never touching the hosted service.

---

<a id="العربية"></a>

## العربية

**مشروع Web Agent Bridge (WAB)** هو بروتوكول مفتوح للتفاعل بين الذكاء الاصطناعي والويب.
هذا الدليل يأخذك من الصفر إلى موقع يدعم WAB (مع اكتشاف DNS) خلال أقل من **5 دقائق**.

### 1. المتطلبات الأساسية

- **Node.js ≥ 18** (المنصة تعمل على Node، وليس Rust — لا يوجد خطوة تجميع compile).
- نطاق تتحكم به (أي مزود — Cloudflare، GoDaddy، Namecheap، Route 53، cPanel…).
- محرر سطر أوامر.

### 2. اجعل موقعك قابلاً للاكتشاف من الذكاء الاصطناعي (أمر واحد)

```bash
npx wab init --site https://yourdomain.com
```

هذا الأمر يقوم بـ:

1. إنشاء `.well-known/wab.json` (عقد الاكتشاف).
2. إنشاء `.well-known/security.txt` (قناة الاتصال الأمنية بمعيار RFC 9116).
3. إنشاء `.env` بإعدادات افتراضية آمنة.
4. **طباعة سجلات TXT** الجاهزة للنسخ إلى لوحة DNS.

### 3. الصق سجلات TXT في لوحة المسجل

Cloudflare / GoDaddy / Namecheap / Route 53 / cPanel — اختر **TXT**، الصق القيمة، احفظ.
قيمة TTL مثل `3600` (أو `Auto`) كافية.

### 4. تحقق باستخدام `wab-dns`

```bash
npx -y @wab/dns-verify yourdomain.com
# الوضع الصارم + إخراج JSON للأتمتة في CI:
npx -y @wab/dns-verify yourdomain.com --trust --policy --json
```

يجب أن ترى `✅ Valid WAP Protocol format.`. إذا غاب `AD`، فعّل DNSSEC في لوحة مسجلك (موصى به).

### 5. شغّل الخادم (اختياري — فقط إذا أردت المنصة الكاملة)

```bash
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge
npm install
npx wab init --env-only
npm start
```

لوحة الوكيل الآن متاحة على `http://localhost:3000/`.

---

## 🛡️ لماذا WAB؟

- **السيادة** — لا وسيط. تملك بياناتك ومفاتيحك وسجلات DNS الخاصة بك. لا طرف ثالث يرى
  حركة وكيلك بين خادم الـ DNS وموقعك الأصلي.
- **الأمن الخفي** — توقيعات CSP لكل طلب، حماية من التلاعب في المكافآت، تنقية البيانات
  الحساسة بين المواقع، حارس URL مع سجل تدقيق. الحماية تحدث في طبقة المنصة لا في وجه المستخدم.
- **اكتشاف عبر DNS** — يستعلم الوكلاء عن `_wab.{site}` عبر **DoH** (مشفر بعيداً عن مزود
  الإنترنت). بدون استكشاف HTTP، بدون كشط، بدون نوافذ موافقة على الكوكيز. *المصافحة الصامتة*
  تتفاوض على النية في الخلفية.
- **بروتوكول مفتوح** — صيغة البيانات وسجلات الاكتشاف وأداة التحقق والـ SDK كلها مفتوحة
  المصدر. المنصة-كخدمة مغلقة، لكن البروتوكول ليس كذلك.

---

## 📜 ما المفتوح وما المغلق؟

WAB مبني عمداً بنموذج **Open Core**:

| الطبقة                                                         | الترخيص          | الموقع                                                 |
|-----------------------------------------------------------------|------------------|--------------------------------------------------------|
| مواصفات البروتوكول ([docs/SPEC.md](docs/SPEC.md))               | **مفتوح / MIT**  | هذا المستودع                                           |
| `web-agent-bridge` (CLI، خادم، SDK)                             | **مفتوح / MIT**  | هذا المستودع، `bin/`, `server/`, `sdk/`, `packages/`    |
| `@wab/dns-verify` (أداة CLI لاكتشاف DNS)                       | **مفتوح / MIT**  | هذا المستودع، `packages/dns-verify/`                   |
| إضافة ووردبريس                                                  | **مفتوح / GPL**  | هذا المستودع، `web-agent-bridge-wordpress/`            |
| SDK لـ React / Vue / Svelte / LangChain                         | **مفتوح / MIT**  | هذا المستودع، `packages/{react,vue,svelte,langchain}/` |
| سجلات الاكتشاف، مخطط JSON، نحو ABNF                              | **مفتوح / MIT**  | هذا المستودع، `docs/SPEC.md` §4.6                       |
| تطبيق المتصفح السيادي                                           | **مفتوح / MIT**  | هذا المستودع، `wab-browser/`                           |
| **موقع webagentbridge.com**، اللوحات، الفوترة                    | **مغلق**         | داخلي — ليس في هذا المستودع                           |
| **شبكة الوكلاء المُستضافة** (تنسيق متعدد المستأجرين، الإنصاف)   | **مغلق**         | داخلي — يعمل على `webagentbridge.com`                  |
| **التحليلات المميزة، سوق الإضافات، إصدار التراخيص**             | **مغلق**         | داخلي — موصوف في [docs/SPEC.md](docs/SPEC.md) §10       |

القاعدة: **إذا كان بروتوكولاً فهو مفتوح. إذا كان منتجاً فهو مغلق.** يمكنك تشغيل منصة WAB
الكاملة من هذا المستودع دون لمس الخدمة المُستضافة.
