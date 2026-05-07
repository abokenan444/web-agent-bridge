/**
 * Outreach Agent — site analysis, language detection, multilingual email drafts.
 *
 * Pipeline (per target URL):
 *   1) discover() to extract metadata
 *   2) Detect language from <html lang>, <meta>, content sniffing
 *   3) Detect site kind (ecommerce / saas / blog / news / agency / static)
 *   4) Pick relevant WAB features
 *   5) Try to find a public contact email (mailto: in /, /contact, /about)
 *   6) Compose subject + body in detected language
 *
 * STRICT HUMAN-IN-THE-LOOP:
 *   • All drafts saved with status='pending'.
 *   • Sending requires admin approval and respects the suppression list,
 *     a global hourly throttle, and per-recipient cooldown (30 days).
 */

'use strict';

const https = require('node:https');
const http = require('node:http');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const { discover } = require('../../sdk/auto-discovery');

// ─── Defaults ─────────────────────────────────────────────────────────
const FETCH_TIMEOUT = 9000;
const USER_AGENT = 'WAB-OutreachAgent/1.0 (+https://www.webagentbridge.com/about)';
const SUPPORTED_LANGS = ['en', 'ar', 'fr', 'es', 'de'];
const FALLBACK_LANG = 'en';

// ─── Tiny HTTP fetcher (no external deps) ─────────────────────────────
function _fetch(urlStr, { timeoutMs = FETCH_TIMEOUT, maxBytes = 600 * 1024, headers = {} } = {}) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(urlStr); } catch { return resolve(null); }
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request({
      method: 'GET',
      host: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname + url.search,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.8', ...headers },
      timeout: timeoutMs,
      rejectUnauthorized: false
    }, (res) => {
      // follow up to one redirect
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && !headers._followed) {
        try {
          const next = new URL(res.headers.location, url).toString();
          res.destroy();
          return resolve(_fetch(next, { timeoutMs, maxBytes, headers: { ...headers, _followed: 1 } }));
        } catch { /* fall through */ }
      }
      const chunks = []; let len = 0;
      res.on('data', (c) => {
        len += c.length;
        if (len > maxBytes) { res.destroy(); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8').slice(0, maxBytes) }));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ─── Language detection ──────────────────────────────────────────────
function _detectLang(env, html) {
  // 1) <html lang="..."> attribute
  const m1 = (html || '').match(/<html[^>]*\blang\s*=\s*["']?([a-zA-Z\-]{2,8})/i);
  if (m1) return _normalizeLang(m1[1]);

  // 2) <meta http-equiv="content-language"> or <meta name="language">
  const m2 = (html || '').match(/<meta[^>]*(?:http-equiv\s*=\s*["']?content-language|name\s*=\s*["']?(?:language|og:locale))["']?[^>]*content\s*=\s*["']?([a-zA-Z_\-]{2,8})/i);
  if (m2) return _normalizeLang(m2[1]);

  // 3) discover() locale hint
  if (env && env.site && env.site.locale) return _normalizeLang(env.site.locale);

  // 4) Content sniff (very light)
  const text = (html || '').replace(/<[^>]+>/g, ' ').slice(0, 4000);
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/\b(le|la|les|des|nous|vous|votre|pour|avec|aussi|merci|bienvenue)\b/i.test(text)) return 'fr';
  if (/\b(que|para|los|las|gracias|bienvenido|nuestro|también)\b/i.test(text)) return 'es';
  if (/\b(und|der|die|das|für|mit|wir|sie|willkommen|unser)\b/i.test(text)) return 'de';
  return FALLBACK_LANG;
}
function _normalizeLang(l) {
  if (!l) return FALLBACK_LANG;
  const base = String(l).toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGS.includes(base) ? base : FALLBACK_LANG;
}

// ─── Site kind heuristics ────────────────────────────────────────────
function _detectKind(env, html) {
  const signals = [];
  let kind = 'static';
  const h = (html || '').toLowerCase();
  if (/\bschema\.org\/product/i.test(html || '') || (env.products && env.products.length >= 2)) {
    kind = 'ecommerce'; signals.push('schema.org/Product');
  } else if (/<meta[^>]*woocommerce|wp-content\/plugins\/woocommerce|cdn\.shopify\.com|shopify\.com/i.test(html || '')) {
    kind = 'ecommerce'; signals.push('shop platform');
  } else if (/wp-content|wp-includes|wp-json/i.test(html || '')) {
    kind = 'wordpress'; signals.push('wordpress');
  } else if (/__next|next\.config|\/_next\//i.test(html || '')) {
    kind = 'nextjs'; signals.push('nextjs');
  } else if (/\bpricing\b|\bsign\s*up\b|\bsubscription\b|\bsaas\b|\bapi\b/i.test(h)) {
    kind = 'saas'; signals.push('saas keywords');
  } else if (/\bblog\b|\barticle\b|<article/i.test(html || '')) {
    kind = 'blog'; signals.push('blog');
  }
  if (env.sitemap && env.sitemap.length > 50) signals.push(`sitemap(${env.sitemap.length})`);
  return { kind, signals };
}

// ─── Feature suggestions per kind ────────────────────────────────────
function _suggestFeatures(kind, env) {
  const base = ['DNS Discovery (one-click activation)', 'wab.json action manifest'];
  const map = {
    ecommerce: [...base, 'ShieldQR signed catalog & checkout', 'SSL Monitor (cert expiry alerts)', 'Phone Shield for refund/order disputes', 'Schema discovery for AI shopping agents'],
    saas:      [...base, 'Scoped tokens (rate-limited agent API keys)', 'Governance audit chain (HMAC tamper-evident logs)', 'Plans Gateway for tier upsell', 'Human-Gate for sensitive actions'],
    wordpress: [...base, 'WordPress plugin (1-click install)', 'Comment shield + spam suppression', 'wab.json auto-generated from posts'],
    nextjs:    [...base, '@webagentbridge/next zero-config middleware', 'Edge functions for /.well-known/wab.json', 'Auto-discovery of API routes'],
    blog:      [...base, 'Sitemap → AI-readable index', 'Newsletter subscribe action for agents', 'Article schema for citation'],
    news:      [...base, 'Article action manifest', 'DNS Discovery for AI assistants'],
    static:    [...base, 'Cloudflare Worker zero-config snippet', 'Static .well-known/wab.json file']
  };
  const out = map[kind] || base;
  if (env && env.products && env.products.length) out.push('Schema discovery (product graph already detected)');
  return Array.from(new Set(out)).slice(0, 6);
}

// ─── Find a public contact email (mailto: only) ───────────────────────
async function _findContactEmail(baseUrl) {
  const candidates = ['/', '/contact', '/contact-us', '/contact.html', '/about', '/about-us', '/imprint', '/legal', '/contacto', '/kontakt', '/contactez-nous'];
  const seen = new Set();
  for (const path of candidates) {
    try {
      const u = new URL(path, baseUrl).toString();
      if (seen.has(u)) continue; seen.add(u);
      const r = await _fetch(u, { timeoutMs: 5000 });
      if (!r || !r.body) continue;
      const matches = r.body.match(/mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g) || [];
      const emails = matches.map((m) => m.replace(/^mailto:/, '').toLowerCase()).filter((e) => !/no-?reply|donot|wordpress@|admin@example/i.test(e));
      if (emails.length) return { email: emails[0], source: u };
    } catch { /* ignore */ }
  }
  return null;
}

// ─── TLS fingerprint (best effort) ────────────────────────────────────
function _tlsFp(host, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    try {
      const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
        if (done) return; done = true;
        const c = sock.getPeerCertificate(false);
        const fp = c && c.fingerprint256 ? String(c.fingerprint256).replace(/:/g, '').toLowerCase() : null;
        sock.end(); resolve(fp);
      });
      sock.setTimeout(timeoutMs, () => { if (!done) { done = true; sock.destroy(); resolve(null); } });
      sock.on('error', () => { if (!done) { done = true; resolve(null); } });
    } catch { resolve(null); }
  });
}

// ─── Multilingual templates ──────────────────────────────────────────
const T = {
  en: {
    subject: (site) => `Make ${site} discoverable to AI agents — open protocol, 5-minute setup`,
    greeting: (name) => `Hi ${name || 'there'},`,
    intro: (site, kind) => `I noticed ${site} looks like a great ${kind} site. We built <b>Web Agent Bridge (WAB)</b> — an open AI ↔ Web protocol that lets AI agents (ChatGPT, Claude, Gemini, etc.) safely interact with your site through declared, signed actions instead of fragile HTML scraping.`,
    why: 'Why now:',
    cta: 'Try the one-click adoption agent',
    closing: 'Best,',
    signature: 'The Web Agent Bridge team',
    unsubscribe: 'Don\'t want emails like this? Unsubscribe here',
    footnote: 'Open Core — MIT-licensed core, opt-in commercial features. No tracking pixels in this email.'
  },
  ar: {
    rtl: true,
    subject: (site) => `اجعل ${site} قابلًا للاكتشاف من قِبَل وكلاء الذكاء الاصطناعي — بروتوكول مفتوح، إعداد في 5 دقائق`,
    greeting: (name) => `مرحبًا${name ? ' ' + name : ''}،`,
    intro: (site, kind) => `لاحظنا أن موقع ${site} يبدو موقع <b>${kind}</b> رائعًا. لقد قمنا ببناء <b>Web Agent Bridge (WAB)</b> — بروتوكول مفتوح للويب يربط بين وكلاء الذكاء الاصطناعي (ChatGPT، Claude، Gemini …) وموقعك عبر إجراءات مُعلنة وموقَّعة بدلاً من تحليل HTML الهش.`,
    why: 'لماذا الآن:',
    cta: 'جرّب وكيل التبنّي بنقرة واحدة',
    closing: 'مع أطيب التحيات،',
    signature: 'فريق Web Agent Bridge',
    unsubscribe: 'لا ترغب في تلقّي مثل هذه الرسائل؟ إلغاء الاشتراك من هنا',
    footnote: 'مفتوح المصدر (Open Core) — رخصة MIT للجزء الأساسي، ميزات تجارية اختيارية. لا توجد أيّة بكسلات تتبّع في هذا البريد.'
  },
  fr: {
    subject: (site) => `Rendez ${site} découvrable par les agents IA — protocole ouvert, configuration en 5 minutes`,
    greeting: (name) => `Bonjour${name ? ' ' + name : ''},`,
    intro: (site, kind) => `Nous avons remarqué que ${site} semble être un excellent site ${kind}. Nous avons créé <b>Web Agent Bridge (WAB)</b> — un protocole IA ↔ Web ouvert qui permet aux agents IA (ChatGPT, Claude, Gemini, etc.) d'interagir avec votre site via des actions déclarées et signées plutôt que via du scraping HTML fragile.`,
    why: 'Pourquoi maintenant :',
    cta: 'Essayez l\'agent d\'adoption en un clic',
    closing: 'Cordialement,',
    signature: 'L\'équipe Web Agent Bridge',
    unsubscribe: 'Vous ne souhaitez pas recevoir de tels emails ? Désabonnez-vous ici',
    footnote: 'Open Core — noyau sous licence MIT, fonctionnalités commerciales optionnelles. Aucun pixel de suivi dans cet email.'
  },
  es: {
    subject: (site) => `Haz que ${site} sea descubrible para agentes de IA — protocolo abierto, 5 min`,
    greeting: (name) => `Hola${name ? ' ' + name : ''},`,
    intro: (site, kind) => `Hemos visto que ${site} parece un excelente sitio ${kind}. Creamos <b>Web Agent Bridge (WAB)</b> — un protocolo IA ↔ Web abierto que permite que los agentes (ChatGPT, Claude, Gemini, etc.) interactúen con tu sitio mediante acciones declaradas y firmadas en lugar de scraping frágil.`,
    why: 'Por qué ahora:',
    cta: 'Prueba el agente de adopción de un clic',
    closing: 'Saludos,',
    signature: 'El equipo de Web Agent Bridge',
    unsubscribe: '¿No deseas recibir estos correos? Cancela la suscripción aquí',
    footnote: 'Open Core — núcleo MIT, funciones comerciales opcionales. Sin píxeles de seguimiento.'
  },
  de: {
    subject: (site) => `Mach ${site} für KI-Agenten auffindbar — offenes Protokoll, in 5 Minuten`,
    greeting: (name) => `Hallo${name ? ' ' + name : ''},`,
    intro: (site, kind) => `Uns ist aufgefallen, dass ${site} eine ausgezeichnete ${kind}-Seite zu sein scheint. Wir haben <b>Web Agent Bridge (WAB)</b> entwickelt — ein offenes KI ↔ Web-Protokoll, mit dem KI-Agenten (ChatGPT, Claude, Gemini …) sicher mit Ihrer Website über deklarierte, signierte Aktionen interagieren statt über fragiles HTML-Scraping.`,
    why: 'Warum jetzt:',
    cta: 'Probieren Sie den 1-Klick-Adoptionsagenten',
    closing: 'Beste Grüße,',
    signature: 'Das Web Agent Bridge Team',
    unsubscribe: 'Keine solchen E-Mails mehr? Hier abmelden',
    footnote: 'Open Core — MIT-lizenzierter Kern, optionale kommerzielle Funktionen. Keine Tracking-Pixel.'
  }
};

function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function _composeEmail({ host, kind, lang, features, recipientName, unsubscribeUrl, adoptUrl }) {
  const t = T[lang] || T[FALLBACK_LANG];
  const dir = t.rtl ? 'rtl' : 'ltr';
  const align = t.rtl ? 'right' : 'left';
  const subject = t.subject(host);
  const featList = features.map((f) => `<li>${_esc(f)}</li>`).join('');
  const html = `<div dir="${dir}" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:620px;margin:0 auto;background:#0a0e1a;color:#e8eeff;padding:32px;border-radius:14px;text-align:${align};line-height:1.6">
  <div style="text-align:center;margin-bottom:18px"><img src="https://www.webagentbridge.com/images/wab-logo-128.png" alt="WAB" width="64" height="64" style="border-radius:12px"/></div>
  <p style="margin:0 0 14px">${_esc(t.greeting(recipientName))}</p>
  <p style="margin:0 0 14px">${t.intro(_esc(host), _esc(kind))}</p>
  <p style="margin:18px 0 6px;color:#a8b3cf"><b>${_esc(t.why)}</b></p>
  <ul style="margin:0 0 18px;padding-${t.rtl ? 'right' : 'left'}:22px;color:#cfe7ff">${featList}</ul>
  <p style="margin:22px 0"><a href="${_esc(adoptUrl)}" style="display:inline-block;background:linear-gradient(135deg,#7c5cff,#22d3ee);color:#0a0e1a;font-weight:700;padding:12px 22px;border-radius:10px;text-decoration:none">${_esc(t.cta)}</a></p>
  <p style="margin:0 0 6px">${_esc(t.closing)}</p>
  <p style="margin:0 0 18px;color:#a8b3cf">${_esc(t.signature)}<br><a href="https://www.webagentbridge.com" style="color:#22d3ee">webagentbridge.com</a></p>
  <hr style="border:0;border-top:1px solid #1f2a44;margin:18px 0"/>
  <p style="font-size:12px;color:#6a7793;margin:0 0 6px">${_esc(t.footnote)}</p>
  <p style="font-size:12px;color:#6a7793;margin:0"><a href="${_esc(unsubscribeUrl)}" style="color:#6a7793">${_esc(t.unsubscribe)}</a></p>
</div>`;
  const text = `${t.greeting(recipientName)}\n\n${host} — ${kind}.\n\nWeb Agent Bridge (WAB) — open AI↔Web protocol.\n\n${t.why}\n${features.map((f) => '  • ' + f).join('\n')}\n\n${t.cta}: ${adoptUrl}\n\n${t.closing}\n${t.signature}\nhttps://www.webagentbridge.com\n\n${t.footnote}\n${t.unsubscribe}: ${unsubscribeUrl}\n`;
  return { subject, html, text, lang, dir };
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Analyze a single URL and return a draft outreach package (no email sent).
 *
 * @param {string} siteUrl
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
async function analyzeSite(siteUrl, opts = {}) {
  if (!siteUrl) return { ok: false, error: 'missing url' };
  if (!/^https?:\/\//i.test(siteUrl)) siteUrl = `https://${siteUrl}`;
  let host, baseUrl;
  try { const u = new URL(siteUrl); host = u.hostname; baseUrl = `${u.protocol}//${u.hostname}`; }
  catch { return { ok: false, error: 'invalid url' }; }

  const env = await discover(baseUrl, { timeoutMs: opts.timeoutMs || FETCH_TIMEOUT });
  const root = await _fetch(baseUrl, { timeoutMs: 6000 });
  const html = (root && root.body) || '';
  const lang = _detectLang(env, html);
  const { kind, signals } = _detectKind(env, html);
  const features = _suggestFeatures(kind, env);
  const contact = await _findContactEmail(baseUrl);
  const tlsFp = await _tlsFp(host);
  const unsubToken = crypto.randomBytes(16).toString('hex');
  const publicBase = opts.publicBase || 'https://www.webagentbridge.com';
  const unsubscribeUrl = `${publicBase}/unsubscribe?token=${unsubToken}`;
  const adoptUrl = `${publicBase}/adopt?url=${encodeURIComponent(baseUrl)}`;
  const draft = _composeEmail({
    host, kind, lang, features,
    recipientName: '',
    unsubscribeUrl, adoptUrl
  });

  return {
    ok: true,
    site_url: baseUrl,
    host,
    contact_email: contact ? contact.email : null,
    contact_source: contact ? contact.source : null,
    detected_lang: lang,
    site_kind: kind,
    signals,
    suggested_features: features,
    tls_fingerprint: tlsFp,
    unsubscribe_token: unsubToken,
    draft
  };
}

module.exports = {
  analyzeSite,
  // exported for the route + tests
  _detectLang, _detectKind, _suggestFeatures, _composeEmail, SUPPORTED_LANGS
};
