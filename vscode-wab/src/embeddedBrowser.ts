import * as vscode from 'vscode';

export class EmbeddedBrowserPanel {
  static show(_ctx: vscode.ExtensionContext, url: string) {
    const panel = vscode.window.createWebviewPanel(
      'wab.browser', `WAB Browser — ${url}`, vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.webview.onDidReceiveMessage((m) => {
      if (m?.type === 'openExternal' && typeof m.url === 'string') {
        vscode.env.openExternal(vscode.Uri.parse(m.url));
      }
    });

    let host = '';
    try { host = new URL(url).host; } catch { /* ignore */ }
    const isLocal = /^localhost(:|$)|^127\.0\.0\.1(:|$)|^\[::1\]/.test(host);
    const safeUrl = url.replace(/"/g, '&quot;');

    panel.webview.html = /* html */ `<!doctype html><html><head>
<meta charset="utf-8"/>
<style>
  html,body { margin:0; height:100vh; width:100vw; background:#1e1e1e; color:#ddd; font: 13px var(--vscode-font-family); }
  iframe { width:100%; height:calc(100vh - 44px); border:0; background:#fff; display:block; }
  .banner { padding: 10px 14px; background:#2d2d30; border-bottom:1px solid #3c3c3c; display:flex; align-items:center; gap:10px; }
  .banner code { background:#0e0e0e; padding:1px 6px; border-radius:3px; }
  .banner button { background:#0e639c; color:#fff; border:0; padding:5px 12px; border-radius:3px; cursor:pointer; font: inherit; }
  .banner button:hover { background:#1177bb; }
  .warn { background:#3a2a1a; border-color:#5a4020; }
  .muted { color:#888; }
  .center { display:flex; align-items:center; justify-content:center; flex-direction:column; height:calc(100vh - 50px); padding:20px; text-align:center; }
  .center h2 { margin: 0 0 8px; }
  .center p  { max-width: 560px; line-height: 1.5; color:#bbb; }
</style></head><body>
${isLocal ? `
  <div class="banner">
    <span>WAB Browser <span class="muted">— ${safeUrl}</span></span>
    <span style="flex:1"></span>
    <button onclick="ext()">Open in external browser</button>
  </div>
  <iframe src="${safeUrl}" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" referrerpolicy="no-referrer"></iframe>
` : `
  <div class="banner warn">
    <span>⚠️ External site — most production sites block iframe embedding (X-Frame-Options).</span>
    <span style="flex:1"></span>
    <button onclick="ext()">Open in external browser</button>
  </div>
  <div class="center">
    <h2>Cannot preview <code>${safeUrl}</code> here</h2>
    <p>The Embedded Browser only works for <code>http://localhost</code> and <code>127.0.0.1</code>
    URLs. Production sites (GitHub, Google, your deployed app, etc.) refuse to be embedded
    in an iframe for security reasons. Use <strong>Open in external browser</strong> instead.</p>
    <p class="muted">Tip: run your dev server (e.g. <code>npm run dev</code>) and reopen this panel
    pointing to <code>http://localhost:3000</code>.</p>
  </div>
` }
<script>
const vscode = acquireVsCodeApi();
function ext(){ vscode.postMessage({ type:'openExternal', url: ${JSON.stringify(url)} }); }
</script>
</body></html>`;
  }
}
