import { Ref } from 'vue';

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

export interface UseWABReturn {
  ready: Ref<boolean>;
  error: Ref<Error | null>;
  discover: () => Promise<any>;
  execute: (name: string, params?: Record<string, unknown>) => Promise<WABExecuteResult>;
  instance: Ref<any>;
}

export interface UseWABActionReturn<TResult = WABExecuteResult> {
  run: (params?: Record<string, unknown>) => Promise<TResult>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  result: Ref<TResult | null>;
}

export interface UseWABActionsReturn {
  executeOne: (name: string, params?: Record<string, unknown>) => Promise<WABExecuteResult>;
  executeMany: (payloadMap?: Record<string, Record<string, unknown>>) => Promise<PromiseSettledResult<WABExecuteResult>[]>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  results: Ref<Record<string, WABExecuteResult>>;
}

export interface UseWABActionOptions {
  instance?: Ref<any>;
}

export function useWAB(config?: WABInitConfig | null): UseWABReturn;
export function useWABAction<TResult = WABExecuteResult>(
  actionName: string,
  options?: UseWABActionOptions
): UseWABActionReturn<TResult>;
export function useWABActions(
  actionNames: string[],
  options?: UseWABActionOptions
): UseWABActionsReturn;
