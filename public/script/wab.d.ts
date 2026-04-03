/**
 * Type definitions for the WAB browser client (wab.min.js).
 * Reference in tsconfig: "types": ["./node_modules/web-agent-bridge/public/script/wab.d.ts"]
 * Or copy this file next to your app and /// <reference path="wab.d.ts" />
 */

export interface WABActionParamSpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any' | string;
  description?: string;
  defaultValue?: unknown;
  required?: boolean;
}

export type WABActionParams = Record<string, unknown>;

export interface WABActionConfig<TParams extends WABActionParams = WABActionParams, TResult = unknown> {
  description?: string;
  params?: WABActionParamSpec[];
  run: (params: TParams) => TResult | Promise<TResult>;
  handler?: (params: TParams) => TResult | Promise<TResult>;
}

export type WABActionsMap = Record<
  string,
  WABActionConfig | ((params: WABActionParams) => unknown | Promise<unknown>)
>;

export interface WABInitConfig {
  name?: string;
  actions?: WABActionsMap;
  /** When set, discover() and execute() can proxy to this origin */
  serverUrl?: string;
}

export interface WABDiscoveryAction {
  name: string;
  description: string;
  params?: WABActionParamSpec[];
}

export interface WABDiscoverResult {
  wab_version: string;
  protocol?: string;
  name: string;
  actions: WABDiscoveryAction[];
  transport?: string[];
  timestamp?: string;
  error?: string;
}

export interface WABExecuteResult {
  success: boolean;
  error?: string;
  action?: string;
  status?: number;
  data?: unknown;
  [key: string]: unknown;
}

export type WABEventName = 'ready' | 'refresh' | 'execute' | 'action:before' | 'action:after' | string;

export interface WABInstance {
  name: string;
  serverUrl: string;
  discover(): Promise<WABDiscoverResult>;
  execute(actionName: string, params?: WABActionParams): Promise<WABExecuteResult>;
  getActions(): string[];
  getAuditLog(): unknown[];
  on(event: WABEventName, fn: (data?: unknown) => void): WABInstance;
}

export interface WABStatic {
  version: string;
  init(config?: WABInitConfig): WABInstance;
  connect(serverUrl: string): WABInstance;
  discover(): Promise<WABDiscoverResult>;
  execute(actionName: string, params?: WABActionParams): Promise<WABExecuteResult>;
  _instance: WABInstance | null;
}

declare global {
  interface Window {
    WAB: WABStatic;
    __wab_protocol?: {
      version: string;
      protocol: string;
      name: string;
      actions: WABDiscoveryAction[];
      transport: string[];
      ready: boolean;
      discover(): Promise<WABDiscoverResult>;
      execute(name: string, params?: WABActionParams): Promise<WABExecuteResult>;
    };
    WABConsent?: {
      showBanner: (options: Record<string, unknown>) => void;
      hasConsent: () => boolean;
      clear: () => void;
    };
    WABSchema?: {
      scanJsonLd: () => unknown[];
      suggestActions: (products: unknown[]) => unknown[];
      mergeWithManual: (manual: WABActionsMap, suggestions: unknown[]) => WABInitConfig;
    };
  }
}

export {};
