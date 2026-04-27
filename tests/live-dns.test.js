/**
 * Live DNS regression test for webagentbridge.com canonical records.
 * Uses Cloudflare DoH (no extra deps). Skipped automatically when offline
 * or when WAB_SKIP_LIVE_DNS=1.
 *
 * Set WAB_REQUIRE_LIVE_DNS=1 in CI to make missing records fail the build.
 */

const SKIP = process.env.WAB_SKIP_LIVE_DNS === '1';
const REQUIRE = process.env.WAB_REQUIRE_LIVE_DNS === '1';

const DOMAIN = 'webagentbridge.com';
const RR_TYPE = { TXT: 16, CAA: 257 };

async function dohQuery(name, type) {
  // do=1 asks the resolver to set AD when the answer is DNSSEC-validated.
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}&do=1`;
  const res = await fetch(url, { headers: { accept: 'application/dns-json' } });
  if (!res.ok) throw new Error(`DoH ${res.status}`);
  const data = await res.json();
  const want = RR_TYPE[type];
  const answers = (data.Answer || []).filter(a => a.type === want).map(a => a.data || '');
  answers.ad = !!data.AD;
  return answers;
}

function decodeCAA(hex) {
  // RFC 8659 wireformat — some resolvers return raw "\\# N hex" bytes.
  const m = /\\#\s*\d+\s*([0-9a-fA-F]+)/.exec(hex);
  const bytes = (m ? m[1] : hex).replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]+$/.test(bytes)) return hex; // already decoded
  const buf = bytes.match(/.{1,2}/g).map(b => parseInt(b, 16));
  const tagLen = buf[1];
  let tag = '', val = '';
  for (let i = 0; i < tagLen; i++) tag += String.fromCharCode(buf[2 + i]);
  for (let i = 2 + tagLen; i < buf.length; i++) val += String.fromCharCode(buf[i]);
  return `${tag} ${val}`;
}

async function safeQuery(name, type) {
  try { return { ok: true, answers: await dohQuery(name, type) }; }
  catch (err) { return { ok: false, err }; }
}

const describeOrSkip = SKIP ? describe.skip : describe;

describeOrSkip('Live DNS — canonical records for webagentbridge.com', () => {
  // Generous timeout for network round-trips.
  jest.setTimeout(15000);

  let online = true;
  beforeAll(async () => {
    const probe = await safeQuery(DOMAIN, 'TXT');
    online = probe.ok;
  });

  function assertOrWarn(label, predicate, detail) {
    if (predicate) return;
    if (REQUIRE) throw new Error(`Live DNS check failed for ${label}: ${detail}`);
    // eslint-disable-next-line no-console
    console.warn(`[live-dns] ${label} not satisfied (${detail}). Set WAB_REQUIRE_LIVE_DNS=1 to fail.`);
  }

  test('_wab TXT advertises v=wab1 and an endpoint URL', async () => {
    if (!online) return;
    const r = await safeQuery(`_wab.${DOMAIN}`, 'TXT');
    expect(r.ok).toBe(true);
    const joined = r.answers.join(' ');
    assertOrWarn('_wab', /v=wab1/.test(joined) && /endpoint=https:\/\//.test(joined), `got: ${joined}`);
  });

  test('_wab-trust TXT references trust + security URLs', async () => {
    if (!online) return;
    const r = await safeQuery(`_wab-trust.${DOMAIN}`, 'TXT');
    expect(r.ok).toBe(true);
    const joined = r.answers.join(' ');
    assertOrWarn('_wab-trust', /trust=https:\/\//.test(joined) && /security=https:\/\//.test(joined), `got: ${joined}`);
  });

  test('_dmarc TXT enforces at least quarantine policy', async () => {
    if (!online) return;
    const r = await safeQuery(`_dmarc.${DOMAIN}`, 'TXT');
    expect(r.ok).toBe(true);
    const joined = r.answers.join(' ');
    assertOrWarn('_dmarc', /v=DMARC1/.test(joined) && /p=(quarantine|reject)/.test(joined), `got: ${joined}`);
  });

  test('CAA authorizes letsencrypt.org', async () => {
    if (!online) return;
    const r = await safeQuery(DOMAIN, 'CAA');
    expect(r.ok).toBe(true);
    const decoded = r.answers.map(decodeCAA).join(' | ');
    assertOrWarn('CAA letsencrypt', /letsencrypt\.org/i.test(decoded), `got: ${decoded}`);
  });

  test('CAA contains iodef incident contact', async () => {
    if (!online) return;
    const r = await safeQuery(DOMAIN, 'CAA');
    expect(r.ok).toBe(true);
    const decoded = r.answers.map(decodeCAA).join(' | ');
    assertOrWarn('CAA iodef', /iodef/i.test(decoded) && /mailto:/i.test(decoded), `got: ${decoded}`);
  });

  test('DNSSEC AD flag on _wab (warn only — roadmap)', async () => {
    if (!online) return;
    const r = await safeQuery(`_wab.${DOMAIN}`, 'TXT');
    expect(r.ok).toBe(true);
    // We do not require AD=1 yet; this test surfaces zone DNSSEC status in CI logs.
    assertOrWarn('DNSSEC AD on _wab', r.answers.ad === true, `AD=${r.answers.ad} — enable DS at registrar to validate`);
  });
});
