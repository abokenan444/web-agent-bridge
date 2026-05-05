import * as vscode from 'vscode';
import { WabApiClient } from './api';
import { ActionsTreeProvider, EventLogTreeProvider } from './treeViews';

export class MonitorPanel {
  static current: MonitorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  static show(ctx: vscode.ExtensionContext, api: WabApiClient, actions: ActionsTreeProvider, events: EventLogTreeProvider) {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (MonitorPanel.current) {
      MonitorPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'wab.monitor', 'WAB Agent Monitor', column,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    MonitorPanel.current = new MonitorPanel(panel, ctx, api, actions, events);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private ctx: vscode.ExtensionContext,
    private api: WabApiClient,
    private actions: ActionsTreeProvider,
    private events: EventLogTreeProvider,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
    this.refreshPlans();
  }

  private async onMessage(msg: any) {
    switch (msg?.type) {
      case 'event':
        this.events.push(msg.payload);
        this.panel.webview.postMessage({ type: 'eventAck' });
        break;
      case 'actions':
        this.actions.set(msg.payload || []);
        break;
      case 'refreshPlans':
        await this.refreshPlans();
        break;
      case 'openExternal':
        if (typeof msg.url === 'string') { vscode.env.openExternal(vscode.Uri.parse(msg.url)); }
        break;
    }
  }

  private async refreshPlans() {
    try {
      const data = await this.api.listPlans();
      this.panel.webview.postMessage({ type: 'plans', payload: data });
    } catch (e: any) {
      this.panel.webview.postMessage({ type: 'plansError', error: String(e?.message || e) });
    }
  }

  dispose() {
    MonitorPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) { this.disposables.pop()?.dispose(); }
  }

  private html(): string {
    const endpoint = this.api.endpoint;
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src ${endpoint} ws://localhost:* wss://localhost:*; img-src https: data:;`;
    return /* html */ `<!doctype html><html><head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<style>
  body { font: 13px var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px; }
  h2 { margin: 4px 0 8px; font-size: 14px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px; }
  pre  { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; max-height: 240px; overflow: auto; font-size: 12px; }
  table { width:100%; border-collapse: collapse; }
  th, td { text-align:left; padding: 4px 6px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; }
  .pill { display:inline-block; padding:1px 6px; border-radius:10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size:11px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border:0; padding: 4px 10px; border-radius:3px; cursor:pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .row { display:flex; gap: 8px; align-items:center; margin-bottom: 8px; }
  .muted { color: var(--vscode-descriptionForeground); }
</style></head>
<body>
  <div class="row">
    <h2 style="flex:1; margin:0">WAB Agent Monitor</h2>
    <span class="pill" id="status">disconnected</span>
    <button id="refresh">Refresh plans</button>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Plans (live from ${endpoint}/api/plans)</h2>
      <div id="plans" class="muted">loading…</div>
    </div>
    <div class="card">
      <h2>Recent Bridge Events</h2>
      <pre id="events">// events from local bridge runner appear here</pre>
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <h2>Quick Actions</h2>
    <button onclick="open('${endpoint}/dashboard')">Open Dashboard</button>
    <button onclick="open('${endpoint}/admin/plans')">Manage Plans</button>
    <button onclick="open('${endpoint}/docs')">Open Docs</button>
  </div>

<script>
const vscode = acquireVsCodeApi();
function open(url){ vscode.postMessage({ type: 'openExternal', url }); }
document.getElementById('refresh').onclick = () => vscode.postMessage({ type: 'refreshPlans' });
window.addEventListener('message', (ev) => {
  const m = ev.data || {};
  if (m.type === 'plans') {
    const plans = (m.payload && m.payload.plans) || [];
    document.getElementById('plans').innerHTML = plans.length
      ? '<table><tr><th>Plan</th><th>Price</th><th>CTA</th><th>Features</th></tr>' +
        plans.map(p => '<tr><td>'+esc(p.name)+'</td><td>'+(p.price_cents/100)+' '+esc(p.currency)+'/'+esc(p.billing_period)+'</td><td>'+esc(p.cta_type)+'</td><td>'+Object.keys(p.features||{}).filter(k=>p.features[k]).length+'</td></tr>').join('') + '</table>'
      : '<span class="muted">no plans</span>';
  } else if (m.type === 'plansError') {
    document.getElementById('plans').innerHTML = '<span class="muted">error: '+esc(m.error)+'</span>';
  } else if (m.type === 'eventLog') {
    document.getElementById('events').textContent = (m.payload || []).map(e => JSON.stringify(e)).join('\\n');
  }
});
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
</script>
</body></html>`;
  }
}
