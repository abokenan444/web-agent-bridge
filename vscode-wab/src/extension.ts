import * as vscode from 'vscode';
import { MonitorPanel } from './monitorPanel';
import { EmbeddedBrowserPanel } from './embeddedBrowser';
import { ActionsTreeProvider, EventLogTreeProvider } from './treeViews';
import { AICommandsCompletionProvider, AICommandsCodeActionProvider } from './intellisense';
import { detectWabUsage, scaffoldStarterKit } from './workspace';
import { WabApiClient } from './api';
import { BridgeRunner } from './bridgeRunner';

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Web Agent Bridge');
  output.appendLine('[WAB] extension activated');

  const api = new WabApiClient(context);
  const bridge = new BridgeRunner(output);
  const actionsTree = new ActionsTreeProvider();
  const eventTree = new EventLogTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('wab.actions', actionsTree),
    vscode.window.registerTreeDataProvider('wab.eventLog', eventTree),
  );

  // ── Commands ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('wab.openMonitor', () => {
      MonitorPanel.show(context, api, actionsTree, eventTree);
    }),
    vscode.commands.registerCommand('wab.startBridge', async () => {
      await bridge.start();
      vscode.window.showInformationMessage(`WAB bridge listening on port ${bridge.port}`);
    }),
    vscode.commands.registerCommand('wab.stopBridge', async () => {
      await bridge.stop();
      vscode.window.showInformationMessage('WAB bridge stopped');
    }),
    vscode.commands.registerCommand('wab.generateSnippet', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const sel = editor.document.getText(editor.selection).trim();
      const name = await vscode.window.showInputBox({
        prompt: 'AICommand name (e.g. add_to_cart)',
        value: sel ? sel.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().slice(0, 40) : 'my_action',
        validateInput: (v) => /^[a-z][a-z0-9_]{1,40}$/.test(v) ? null : 'Use snake_case, 2–40 chars',
      });
      if (!name) { return; }
      const trigger = await vscode.window.showQuickPick(
        ['click', 'fill_and_submit', 'navigate', 'custom'],
        { placeHolder: 'Trigger type' },
      );
      if (!trigger) { return; }
      const selector = await vscode.window.showInputBox({
        prompt: 'CSS selector for the target element',
        value: sel.startsWith('#') || sel.startsWith('.') ? sel : '',
      });
      if (selector === undefined) { return; }
      const snippet = buildAICommandSnippet(name, trigger, selector);
      editor.edit((eb) => eb.replace(editor.selection, snippet));
    }),
    vscode.commands.registerCommand('wab.generateDnsRecord', async () => {
      const domain = await vscode.window.showInputBox({
        prompt: 'Your site domain (e.g. example.com)',
        validateInput: (v) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? null : 'Enter a valid domain',
      });
      if (!domain) { return; }
      const records = buildDnsRecords(domain);
      const doc = await vscode.workspace.openTextDocument({ language: 'plaintext', content: records });
      vscode.window.showTextDocument(doc, { preview: false });
    }),
    vscode.commands.registerCommand('wab.openEmbeddedBrowser', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'URL to open in embedded browser',
        value: 'http://localhost:3000',
      });
      if (!url) { return; }
      EmbeddedBrowserPanel.show(context, url);
    }),
    vscode.commands.registerCommand('wab.signIn', async () => {
      const ok = await api.signInInteractive();
      if (ok) { vscode.window.showInformationMessage('Signed in to WAB'); }
    }),
    vscode.commands.registerCommand('wab.scaffoldStarter', async () => {
      await scaffoldStarterKit();
    }),
  );

  // ── IntelliSense + Code Actions ─────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration('wab');
  if (cfg.get<boolean>('intelliSense.enabled', true)) {
    const langs = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'html'];
    for (const lang of langs) {
      context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
          lang, new AICommandsCompletionProvider(), '.', '\'', '"',
        ),
        vscode.languages.registerCodeActionsProvider(
          lang, new AICommandsCodeActionProvider(),
          { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite, vscode.CodeActionKind.QuickFix] },
        ),
      );
    }
  }

  // ── Auto-detect WAB usage on activation ─────────────────────────────
  if (cfg.get<boolean>('autoMonitorOnDetect', true)) {
    detectWabUsage().then(async (found) => {
      if (!found) { return; }
      const choice = await vscode.window.showInformationMessage(
        'Web Agent Bridge SDK detected in this workspace. Open the Agent Monitor?',
        'Open Monitor', 'Scaffold Starter', 'Dismiss',
      );
      if (choice === 'Open Monitor') {
        vscode.commands.executeCommand('wab.openMonitor');
      } else if (choice === 'Scaffold Starter') {
        vscode.commands.executeCommand('wab.scaffoldStarter');
      }
    });
  }

  context.subscriptions.push(output, bridge);
}

export function deactivate() { /* cleanup handled via subscriptions */ }

function buildAICommandSnippet(name: string, trigger: string, selector: string): string {
  const sel = JSON.stringify(selector || `#${name}`);
  return [
    `// AICommand: ${name}`,
    `AICommands.register({`,
    `  name: ${JSON.stringify(name)},`,
    `  trigger: ${JSON.stringify(trigger)},`,
    `  selector: ${sel},`,
    `  description: 'TODO: describe the user-visible effect of this action',`,
    `  fields: [`,
    `    // { name: 'qty', type: 'number', required: false }`,
    `  ],`,
    `});`,
  ].join('\n');
}

function buildDnsRecords(domain: string): string {
  return [
    `# Web Agent Bridge — DNS records for ${domain}`,
    `# Add the following at your DNS provider:`,
    ``,
    `# 1. Bridge discovery (TXT)`,
    `_wab.${domain}.   IN  TXT   "v=wab1; endpoint=https://www.webagentbridge.com; site=${domain}"`,
    ``,
    `# 2. CAA (lets your CA issue certs to .well-known/wab)`,
    `${domain}.        IN  CAA   0 issue "letsencrypt.org"`,
    `${domain}.        IN  CAA   0 iodef "mailto:admin@${domain}"`,
    ``,
    `# 3. Optional: well-known JSON pointer (HTTPS)`,
    `# Serve at https://${domain}/.well-known/web-agent-bridge.json`,
    `# {"version":"1","endpoint":"/wab","sdk":"https://www.webagentbridge.com/v1/ai-agent-bridge.js"}`,
    ``,
  ].join('\n');
}
