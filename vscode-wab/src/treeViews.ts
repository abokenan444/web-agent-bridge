import * as vscode from 'vscode';

interface ActionItem { name: string; trigger?: string; description?: string; selector?: string; }

export class ActionsTreeProvider implements vscode.TreeDataProvider<ActionItem> {
  private _emit = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._emit.event;
  private items: ActionItem[] = [];

  set(items: ActionItem[]) { this.items = items; this._emit.fire(); }
  getTreeItem(el: ActionItem): vscode.TreeItem {
    const t = new vscode.TreeItem(el.name, vscode.TreeItemCollapsibleState.None);
    t.description = el.trigger;
    t.tooltip = el.description || el.selector || el.name;
    t.iconPath = new vscode.ThemeIcon('zap');
    return t;
  }
  getChildren(): ActionItem[] { return this.items; }
}

export class EventLogTreeProvider implements vscode.TreeDataProvider<any> {
  private _emit = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._emit.event;
  private events: any[] = [];
  private max = 200;

  push(ev: any) {
    this.events.unshift({ ts: new Date().toISOString(), ...ev });
    if (this.events.length > this.max) { this.events.length = this.max; }
    this._emit.fire();
  }
  clear() { this.events = []; this._emit.fire(); }
  getTreeItem(el: any): vscode.TreeItem {
    const label = `${el.ts?.slice(11, 19) ?? ''}  ${el.type ?? 'event'}`;
    const t = new vscode.TreeItem(label);
    t.description = typeof el.detail === 'string' ? el.detail : JSON.stringify(el.detail ?? '');
    t.tooltip = JSON.stringify(el, null, 2);
    t.iconPath = new vscode.ThemeIcon(el.error ? 'error' : 'pulse');
    return t;
  }
  getChildren(): any[] { return this.events; }
}
