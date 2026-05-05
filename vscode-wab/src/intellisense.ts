import * as vscode from 'vscode';

const METHODS: Array<{ name: string; detail: string; insert: string }> = [
  { name: 'register',   detail: 'Register an AICommand on this page', insert: 'register({\n  name: \'$1\',\n  trigger: \'${2|click,fill_and_submit,navigate,custom|}\',\n  selector: \'$3\',\n  description: \'$4\',\n});\n' },
  { name: 'execute',    detail: 'Execute a registered command',       insert: 'execute(\'$1\', { $2 });\n' },
  { name: 'getActions', detail: 'List all registered actions',        insert: 'getActions();\n' },
  { name: 'readContent',detail: 'Read DOM content by selector',       insert: 'readContent(\'$1\');\n' },
  { name: 'getPageInfo',detail: 'Get current page info',              insert: 'getPageInfo();\n' },
];

export class AICommandsCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] | undefined {
    const line = doc.lineAt(pos.line).text.slice(0, pos.character);
    if (!/AICommands\.\w*$/.test(line)) { return; }
    return METHODS.map((m) => {
      const it = new vscode.CompletionItem(m.name, vscode.CompletionItemKind.Method);
      it.detail = m.detail;
      it.documentation = new vscode.MarkdownString(`\`AICommands.${m.name}\` — ${m.detail}.\n\n[WAB docs](https://www.webagentbridge.com/docs)`);
      it.insertText = new vscode.SnippetString(m.insert);
      return it;
    });
  }
}

export class AICommandsCodeActionProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.RefactorRewrite, vscode.CodeActionKind.QuickFix];

  provideCodeActions(doc: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const text = doc.getText(range).trim();
    if (!text) { return []; }
    // Suggest converting a button/anchor into an AICommand
    const isButtonish = /<(button|a)\b/i.test(text) || /onclick\s*=/.test(text) || /onClick\s*=/.test(text);
    if (!isButtonish) { return []; }

    const action = new vscode.CodeAction('WAB: Wrap as AICommand', vscode.CodeActionKind.RefactorRewrite);
    action.command = { command: 'wab.generateSnippet', title: 'WAB: Generate AICommand' };
    return [action];
  }
}
