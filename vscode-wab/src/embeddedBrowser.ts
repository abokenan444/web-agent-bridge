import * as vscode from 'vscode';

export class EmbeddedBrowserPanel {
  static show(_ctx: vscode.ExtensionContext, url: string) {
    const panel = vscode.window.createWebviewPanel(
      'wab.browser', `WAB Browser — ${url}`, vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const safe = url.replace(/"/g, '&quot;');
    panel.webview.html = /* html */ `<!doctype html><html><head>
<meta charset="utf-8"/>
<style>html,body,iframe{margin:0;height:100vh;width:100vw;border:0;background:#fff}</style>
</head><body>
<iframe src="${safe}" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" referrerpolicy="no-referrer"></iframe>
</body></html>`;
  }
}
