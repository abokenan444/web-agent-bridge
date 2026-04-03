import { Readable } from 'svelte/store';

export interface WABInitConfig {
  siteUrl?: string;
  apiKey?: string;
  [key: string]: unknown;
}

export interface WABExecuteResult {
  ok: boolean;
  action?: string;
  status?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface WABStoreState {
  ready: boolean;
  error: Error | null;
  instance: any;
}

export interface WABStore extends Readable<WABStoreState> {
  init(config?: WABInitConfig): void;
  discover(): Promise<any>;
  execute(name: string, params?: Record<string, unknown>): Promise<WABExecuteResult>;
}

export interface WABActionState<TResult = WABExecuteResult> {
  loading: boolean;
  error: Error | null;
  result: TResult | null;
}

export interface WABActionStore<TResult = WABExecuteResult> extends Readable<WABActionState<TResult>> {
  run(params?: Record<string, unknown>): Promise<TResult>;
}

export interface CreateWABActionOptions {
  instance?: any;
}

export function createWAB(config?: WABInitConfig): WABStore;
export function createWABAction<TResult = WABExecuteResult>(
  actionName: string,
  options?: CreateWABActionOptions
): WABActionStore<TResult>;
