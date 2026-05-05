import * as vscode from 'vscode';

const TOKEN_KEY = 'wab.apiToken';

export class WabApiClient {
  constructor(private ctx: vscode.ExtensionContext) {}

  get endpoint(): string {
    return vscode.workspace.getConfiguration('wab').get<string>('endpoint', 'https://www.webagentbridge.com').replace(/\/$/, '');
  }

  async getToken(): Promise<string | undefined> {
    const settings = vscode.workspace.getConfiguration('wab').get<string>('apiToken', '');
    if (settings) { return settings; }
    return this.ctx.secrets.get(TOKEN_KEY);
  }

  async setToken(token: string): Promise<void> {
    await this.ctx.secrets.store(TOKEN_KEY, token);
  }

  async clearToken(): Promise<void> {
    await this.ctx.secrets.delete(TOKEN_KEY);
  }

  async signInInteractive(): Promise<boolean> {
    const token = await vscode.window.showInputBox({
      prompt: `Paste a personal API token from ${this.endpoint}/dashboard`,
      placeHolder: 'wab_pat_...',
      ignoreFocusOut: true,
      password: true,
    });
    if (!token) { return false; }
    await this.setToken(token.trim());
    return true;
  }

  async fetchJson<T = any>(path: string, init?: { method?: string; body?: any }): Promise<T> {
    const token = await this.getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (token) { headers['Authorization'] = `Bearer ${token}`; }
    const res = await fetch(`${this.endpoint}${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`WAB API ${res.status} ${res.statusText} on ${path}`);
    }
    return res.json() as Promise<T>;
  }

  async listPlans() {
    return this.fetchJson<{ plans: any[]; features: any[] }>('/api/plans');
  }
}
