// ═══════════ Button event listeners (CSP-safe, no onclick attributes) ═══════════
// Direct event listener attachment (script loads at end of body, DOM is ready)
(function() {
  var enBtn = document.getElementById('enBtn');
  var arBtn = document.getElementById('arBtn');
  var verifyBtn = document.getElementById('dnsVerifyBtn');
  var copyBtn = document.getElementById('dnsCopyBtn');
  
  if (enBtn) enBtn.addEventListener('click', function() { window.setLang('en'); });
  if (arBtn) arBtn.addEventListener('click', function() { window.setLang('ar'); });
  if (verifyBtn) verifyBtn.addEventListener('click', function() { window.verifyDns(); });
  if (copyBtn) copyBtn.addEventListener('click', function() { window.copyExample(); });
})();


    // ═══════════ Bilingual toggle ═══════════
    window.setLang = function(lang){
      const isAr = lang === 'ar';
      document.documentElement.lang = isAr ? 'ar' : 'en';
      document.documentElement.dir = isAr ? 'rtl' : 'ltr';
      document.getElementById('enBtn').classList.toggle('active', !isAr);
      document.getElementById('arBtn').classList.toggle('active', isAr);
      document.querySelectorAll('[data-en]').forEach(el=>{
        el.textContent = isAr ? (el.getAttribute('data-ar') || el.textContent) : (el.getAttribute('data-en') || el.textContent);
      });
    }

    // ═══════════ Live DoH Verifier ═══════════
    window.verifyDns = async function(){
      const domain = (document.getElementById('dnsDomain').value || '').trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'');
      const resolver = document.getElementById('dnsResolver').value;
      const status = document.getElementById('dnsStatus');
      const out = document.getElementById('dnsOut');
      if(!domain){ status.innerHTML = '<span class="danger">Please enter a domain.</span>'; return; }
      const fqdn = '_wab.' + domain;
      status.innerHTML = '<span class="warn">Querying ' + fqdn + ' …</span>';
      out.textContent = '';
      try {
        const url = resolver + '?name=' + encodeURIComponent(fqdn) + '&type=TXT';
        const res = await fetch(url, { headers: { 'accept': 'application/dns-json' } });
        const data = await res.json();
        out.textContent = JSON.stringify(data, null, 2);
        const answers = (data.Answer || []).filter(a => a.type === 16);
        if (!answers.length) {
          status.innerHTML = '<span class="danger">No _wab TXT record found for <b>' + domain + '</b>. The domain has not enabled WAB DNS Discovery (yet).</span>';
          return;
        }
        const value = answers.map(a => (a.data || '').replace(/^"|"$/g,'').replace(/" "/g,'')).join(' ');
        const versionMatch = /v=([^;\s]+)/.exec(value);
        const endpointMatch = /endpoint=([^;\s]+)/.exec(value);
        if (versionMatch && endpointMatch && versionMatch[1].startsWith('wab')) {
          status.innerHTML = '<span class="ok">✓ Valid WAB record found. Version: <b>' + versionMatch[1] + '</b> · Endpoint: <a href="' + endpointMatch[1] + '" target="_blank" style="color:#7dd3fc">' + endpointMatch[1] + '</a></span>';
        } else {
          status.innerHTML = '<span class="warn">TXT record found but it does not match the WAB format (v=wab1; endpoint=…).</span>';
        }
      } catch (err) {
        status.innerHTML = '<span class="danger">Lookup failed: ' + (err && err.message || err) + '</span>';
      }
    }

    window.copyExample = function(){
      const txt = 'v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json';
      navigator.clipboard.writeText(txt).then(()=>{
        const s = document.getElementById('dnsStatus');
        s.innerHTML = '<span class="ok">✓ Example record copied to clipboard.</span>';
      });
    }

    // ═══════════ Canonical records — live status ═══════════
    const RR_TYPE = { TXT: 16, CAA: 257, A: 1, AAAA: 28, CNAME: 5 };

    function _decodeCAARdata(hex){
      // RFC 8659: 1 byte flags, 1 byte tag-length, tag, value (rest)
      try {
        const bytes = hex.replace(/\\#\s*\d+\s*/, '').replace(/\s+/g, '');
        const buf = bytes.match(/.{1,2}/g).map(b => parseInt(b, 16));
        const tagLen = buf[1];
        let tag = '', val = '';
        for (let i = 0; i < tagLen; i++) tag += String.fromCharCode(buf[2 + i]);
        for (let i = 2 + tagLen; i < buf.length; i++) val += String.fromCharCode(buf[i]);
        return { tag, value: val };
      } catch { return null; }
    }

    function _normalizeAnswer(answer, type){
      const data = answer.data || '';
      if (type === 'CAA') {
        const decoded = _decodeCAARdata(data);
        if (decoded) return decoded.tag + ' ' + decoded.value;
        // Some resolvers return the parsed form already (e.g. '0 issue "letsencrypt.org"')
        return data;
      }
      return data.replace(/^"|"$/g, '').replace(/"\s*"/g, '');
    }

    async function _doh(name, type){
      // do=1 asks Cloudflare to set the AD flag when the answer is DNSSEC-validated.
      const url = 'https://cloudflare-dns.com/dns-query?name=' +
        encodeURIComponent(name) + '&type=' + encodeURIComponent(type) + '&do=1';
      const res = await fetch(url, { headers: { 'accept': 'application/dns-json' } });
      const data = await res.json();
      const want = RR_TYPE[type];
      const answers = (data.Answer || []).filter(a => a.type === want)
        .map(a => _normalizeAnswer(a, type));
      // Attach AD flag (DNSSEC validated) as a non-enumerable property
      Object.defineProperty(answers, '_ad', { value: !!data.AD, enumerable: false });
      return answers;
    }

    async function checkDnssecForWab(){
      const el = document.getElementById('dnssecLiveStatus');
      const rowState = document.getElementById('dnssecRowState');
      if (!el) return;
      try {
        const ans = await _doh('_wab.webagentbridge.com', 'TXT');
        if (ans._ad) {
          el.className = 'ok';
          el.textContent = '✓ DNSSEC validated (AD=1) at resolver';
          if (rowState) { rowState.className = 'ok'; rowState.textContent = '✓ DNSSEC validated'; }
        } else {
          el.className = 'warn';
          el.textContent = '⚠ DNSSEC not yet enabled on this zone (AD=0). Roadmap: enable DS at registrar.';
        }
      } catch {
        el.className = 'warn';
        el.textContent = '… could not verify (DoH unreachable)';
      }
    }

    async function checkCanonicalRecords(){
      const rows = document.querySelectorAll('#recordsTable tr[data-record]');
      const summary = document.getElementById('recordsLiveStatus');
      let pass = 0, fail = 0;
      const tasks = Array.from(rows).map(async (row) => {
        const cell = row.querySelector('.live-cell');
        const name = row.dataset.record;
        const type = row.dataset.rtype;
        const match = row.dataset.match;
        try {
          const answers = await _doh(name, type);
          const hit = answers.some(a => a.toLowerCase().includes(match.toLowerCase()));
          if (hit) {
            cell.innerHTML = '<span class="ok" title="Verified live via Cloudflare DoH">✓ live</span>';
            pass++;
          } else {
            cell.innerHTML = '<span class="danger" title="Record not yet propagated or missing">✗ missing</span>';
            fail++;
          }
        } catch (err) {
          cell.innerHTML = '<span class="warn" title="Lookup failed">… error</span>';
        }
      });
      await Promise.allSettled(tasks);
      const total = pass + fail;
      summary.innerHTML = '<span class="' + (fail === 0 ? 'ok' : 'warn') + '">' +
        (fail === 0 ? '✓ All ' + total + ' canonical records verified live (Cloudflare DoH).'
                    : '⚠ ' + pass + '/' + total + ' records live — ' + fail + ' missing or propagating.') + '</span>';
    }

    document.addEventListener('DOMContentLoaded', () => {
      // Don't block the page; run the live checks in the background.
      checkCanonicalRecords().catch(()=>{});
      checkDnssecForWab().catch(()=>{});
    });
  

    // navbar scroll background (consistent with other pages)
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
      if (!navbar) return;
      navbar.style.background = window.scrollY > 50
        ? 'rgba(7, 13, 25, 0.92)'
        : 'rgba(7, 13, 25, 0.78)';
    });
  
