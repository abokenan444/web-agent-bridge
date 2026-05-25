(async function () {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const state = await chrome.runtime.sendMessage({ type: 'wab:getState', tabId: tab.id });
  const $ = (id) => document.getElementById(id);
  if (!state) {
    $('host').textContent = tab.url || '';
    $('status').innerHTML = '<span class="pill missing">no data</span>';
    return;
  }
  $('host').textContent = state.host;
  $('status').innerHTML = `<span class="pill ${state.status}">${state.status}</span>` +
    (state.signed ? '<span class="pill verified">signed</span>' : '');
  const meta = [
    ['Manifest', `<a href="https://${state.host}/.well-known/wab.json" target="_blank">/.well-known/wab.json</a>`],
    ['Observatory', `<a href="https://webagentbridge.com/observatory" target="_blank">view registry</a>`],
    ['Notary', `<a href="https://webagentbridge.com/api/notary/attest/${state.host}" target="_blank">get attestation</a>`]
  ];
  $('meta').innerHTML = meta.map(([k,v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  if (state.manifest) {
    $('manifest').style.display = 'block';
    $('manifest').textContent = JSON.stringify(state.manifest, null, 2);
  }
})();
