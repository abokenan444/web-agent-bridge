# ⚡ Announcing: One-Click WAB Activation — Free, Hosted, Live Today

We just shipped the easiest way to put **any website on the AI-agent map**: a free hosted wizard that handles cryptographic identity, manifest signing, and DNS deployment — all from your browser.

🔗 **Try it now:** **https://www.webagentbridge.com/one-click**

---

## What it does

In **under 60 seconds**, the wizard will:

1. 🔐 **Generate a fresh Ed25519 keypair** server-side (raw 32-byte, RFC 8032 compatible).
2. ✍️ **Sign your `wab.json` manifest** using the canonical WAB v1.3 format and self-verify before returning it.
3. 🌐 **Deploy your DNS TXT records** automatically via:
   - **Cloudflare API** (Zone:DNS:Edit token — idempotent, upserts existing `v=wab1` records)
   - **Vercel DNS API**
   - **Netlify DNS API**
   - or copy-paste for any other provider (GoDaddy, Namecheap, Route 53, cPanel, Plesk…)
4. ⚙️ **(Optional) Generate a ready-to-paste Cloudflare Worker** that serves `/.well-known/wab.json` if you can't edit your origin.
5. 📊 **Verify your Trust Score** live, showing all 5 checks (DNS, DNSSEC, public key, manifest fetch, signature) with a real-time gauge.

---

## Why it's a big deal

| Before One-Click | After One-Click |
|---|---|
| Read a 5-page guide | Type your domain, click Generate |
| Install Node.js + run `npx wab init` | Zero install — runs in browser |
| Generate keys with `openssl genpkey` | One server-side click |
| Manually edit `wab.json`, sign it, upload it | Auto-signed + auto-downloadable |
| Open Cloudflare → DNS → Add record → paste TXT manually | One click, API does it |
| Wait, re-run a verifier on the command line | Trust gauge animates the score live |

**It's the difference between "I'll get to it later" and "done before my coffee cools."**

---

## 🛡️ Security model

- **Your API tokens are NEVER stored.** They are used for a single request and immediately wiped from both server memory and the form field.
- **Your private key is shown once.** It is generated server-side, returned in the prepare response, and the in-memory copy expires after 10 minutes. We don't have a copy after that.
- **All signing happens with audited code** (`server/services/wab-crypto.js` — same Ed25519 path that powers our own production signature).
- **No third-party origin sees your tokens.** All provider API calls are made server-to-server, never from the user's browser.
- **No tracking, no account required.** The wizard is fully anonymous.

---

## 💰 Pricing

**Free. Forever. For everyone.**

This is part of our commitment to keeping the WAB DNS Discovery protocol open and accessible. There is no premium tier, no gated feature, no rate limit beyond standard abuse protection. If you have a domain, you can use it.

---

## 🧪 Verify it yourself

The full API surface is also exposed for programmatic use:

```bash
# 1. Prepare a signed identity (returns wab.json + TXT value + token)
curl -X POST https://www.webagentbridge.com/api/activate/prepare \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com"}'

# 2. Deploy to Cloudflare in one call
curl -X POST https://www.webagentbridge.com/api/activate/cloudflare/deploy \
  -H 'Content-Type: application/json' \
  -d '{"token":"<from-prepare>", "api_token":"<your-cf-token>"}'

# 3. Verify trust score
curl -X POST https://www.webagentbridge.com/api/activate/verify \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com"}'
```

---

## 📚 Learn more

- 🌐 **Wizard:** https://www.webagentbridge.com/one-click
- 📖 **Manual guide:** https://www.webagentbridge.com/activate
- 🔍 **Live verifier:** https://www.webagentbridge.com/dns
- 📄 **EN docs:** [DNS-DISCOVERY.md](https://github.com/abokenan444/web-agent-bridge/blob/master/DNS-DISCOVERY.md)
- 📄 **AR docs:** [DNS-DISCOVERY.ar.md](https://github.com/abokenan444/web-agent-bridge/blob/master/DNS-DISCOVERY.ar.md)

---

## 🇸🇦 العربية

### ⚡ تفعيل WAB بنقرة واحدة — مجاناً، مُستضاف، متاح الآن

أطلقنا أسهل طريقة لوضع **أي موقع على خريطة وكلاء الذكاء الاصطناعي**: معالج مجاني مُستضاف يتولّى توليد الهوية التشفيرية، توقيع الـ manifest، ونشر سجلات DNS — كل ذلك من متصفّحك.

🔗 **جرّبه الآن:** **https://www.webagentbridge.com/one-click**

في أقل من **60 ثانية** سيقوم المعالج بـ:

1. 🔐 توليد زوج مفاتيح **Ed25519** جديد من جهة الخادم.
2. ✍️ توقيع ملف `wab.json` بصيغة WAB v1.3 الرسمية والتحقّق الذاتي قبل التسليم.
3. 🌐 **نشر سجلات DNS TXT تلقائياً** عبر:
   - **Cloudflare API** (idempotent — يُحدّث السجل الموجود بدل تكراره)
   - **Vercel DNS API**
   - **Netlify DNS API**
   - أو النسخ اليدوي لأي مزوّد آخر
4. ⚙️ توليد كود **Cloudflare Worker** جاهز للصق إذا لم تستطع تعديل خادمك الأصلي.
5. 📊 التحقّق من **تقييم الثقة** مباشرة بمؤشّر حيّ.

### 🛡️ نموذج الأمان

- رموز API الخاصة بك **لا تُحفظ أبداً** — تُستخدم لطلب واحد ثم تُمحى من الذاكرة وحقل الإدخال.
- المفتاح الخاص يُعرض مرة واحدة فقط، ويُحذف من ذاكرة الخادم بعد 10 دقائق.
- لا تتبّع، لا حساب مطلوب، لا قيود.

### 💰 السعر

**مجاني للأبد للجميع.** لا يوجد إصدار مدفوع، لا ميزة مغلقة. التزامنا بإبقاء بروتوكول WAB DNS Discovery مفتوحاً للجميع.

---

*Generated with care, open by default. — Web Agent Bridge*
