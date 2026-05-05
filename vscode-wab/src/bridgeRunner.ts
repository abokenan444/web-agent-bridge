import * as vscode from 'vscode';
import * as http from 'node:http';

/**
 * BridgeRunner — a local HTTP+WebSocket endpoint that hosts a tiny inspector page
 * the developer can load (or have their site post to) so that AICommands events
 * stream live back into VS Code's Monitor panel.
 *
 * It is intentionally lightweight: no auth, only listens on localhost, and is
 * disabled by default until the user runs `WAB: Start Agent Bridge`.
 */
export class BridgeRunner implements vscode.Disposable {
  private server: http.Server | undefined;
  port = 7999;

  constructor(private out: vscode.OutputChannel) {}

  async start(): Promise<void> {
    if (this.server) { return; }
    this.port = vscode.workspace.getConfiguration('wab').get<number>('bridgePort', 7999);
    this.server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.method === 'POST' && req.url === '/event') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e6) { req.destroy(); } });
        req.on('end', () => {
          try {
            const ev = JSON.parse(body || '{}');
            this.out.appendLine(`[bridge] ${JSON.stringify(ev)}`);
          } catch { this.out.appendLine(`[bridge] invalid JSON: ${body.slice(0, 200)}`); }
          res.writeHead(204); res.end();
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'wab-bridge-runner', port: this.port }));
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, '127.0.0.1', () => resolve());
    });
    this.out.appendLine(`[bridge] listening on http://127.0.0.1:${this.port}`);
  }

  async stop(): Promise<void> {
    if (!this.server) { return; }
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
    this.out.appendLine('[bridge] stopped');
  }

  dispose() { void this.stop(); }
}
