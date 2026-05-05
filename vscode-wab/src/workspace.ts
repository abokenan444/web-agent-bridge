import * as vscode from 'vscode';

const PROBES = [
  '**/web-agent-bridge-sdk/**',
  '**/ai-agent-bridge.js',
  '**/wab.config.json',
  '**/sdk/index.js',
];

export async function detectWabUsage(): Promise<boolean> {
  if (!vscode.workspace.workspaceFolders?.length) { return false; }
  for (const probe of PROBES) {
    const hits = await vscode.workspace.findFiles(probe, '**/node_modules/**', 1);
    if (hits.length) { return true; }
  }
  // Also check package.json deps
  const pkgs = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', 5);
  for (const p of pkgs) {
    try {
      const buf = await vscode.workspace.fs.readFile(p);
      const json = JSON.parse(Buffer.from(buf).toString('utf8'));
      const all = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
      if (Object.keys(all).some((k) => /web-agent-bridge|^@wab\//i.test(k))) { return true; }
    } catch { /* ignore */ }
  }
  return false;
}

export async function scaffoldStarterKit() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showWarningMessage('Open a workspace folder first.');
    return;
  }
  const root = folders[0].uri;
  const files: Array<[string, string]> = [
    ['wab.config.json', JSON.stringify({
      site: 'localhost',
      endpoint: 'https://www.webagentbridge.com',
      sdk: 'https://www.webagentbridge.com/v1/ai-agent-bridge.js',
    }, null, 2) + '\n'],
    ['public/.well-known/web-agent-bridge.json', JSON.stringify({
      version: '1',
      endpoint: '/wab',
      sdk: 'https://www.webagentbridge.com/v1/ai-agent-bridge.js',
    }, null, 2) + '\n'],
    ['examples/wab-agent.js',
      `// WAB starter agent — runs in your page or via the SDK\n` +
      `// Docs: https://www.webagentbridge.com/docs\n\n` +
      `AICommands.register({\n` +
      `  name: 'add_to_cart',\n` +
      `  trigger: 'click',\n` +
      `  selector: 'button.add-to-cart',\n` +
      `  description: 'Add the visible product to the cart',\n` +
      `});\n`],
  ];
  for (const [rel, content] of files) {
    const uri = vscode.Uri.joinPath(root, rel);
    try {
      await vscode.workspace.fs.stat(uri);
      // exists; skip
    } catch {
      const dir = vscode.Uri.joinPath(uri, '..');
      try { await vscode.workspace.fs.createDirectory(dir); } catch { /* ignore */ }
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    }
  }
  vscode.window.showInformationMessage('WAB starter kit scaffolded.');
}
