import type { ReactNode, MutableRefObject } from 'react';

export type WABActionParams = Record<string, unknown>;

export interface WABActionSpec<TParams extends WABActionParams = WABActionParams, TResult = unknown> {
  description?: string;
  params?: Array<{ name: string; type: string; required?: boolean }>;
  run?: (params: TParams) => TResult | Promise<TResult>;
  handler?: (params: TParams) => TResult | Promise<TResult>;
}

export interface WABInitConfig {
  name?: string;
  actions?: Record<string, WABActionSpec | ((params: WABActionParams) => unknown)>;
  serverUrl?: string;
}

export interface WABInstance {
  discover: () => Promise<unknown>;
  execute: (name: string, params?: WABActionParams) => Promise<unknown>;
  getActions?: () => string[];
}

export interface UseWABResult {
  ready: boolean;
  error: Error | null;
  discover: () => Promise<unknown>;
  execute: (name: string, params?: WABActionParams) => Promise<unknown>;
  instance: MutableRefObject<WABInstance | null>;
}

export function useWAB(config: WABInitConfig | null): UseWABResult;

export interface UseWABActionOptions {
  instance?: MutableRefObject<WABInstance | null> | null;
}

export interface UseWABActionResult<TResult = unknown> {
  run: (params?: WABActionParams) => Promise<TResult>;
  loading: boolean;
  error: Error | null;
  result: TResult | null;
}

export function useWABAction<TResult = unknown>(
  actionName: string,
  options?: UseWABActionOptions
): UseWABActionResult<TResult>;

export interface UseWABActionsResult {
  executeOne: (name: string, params?: WABActionParams) => Promise<unknown>;
  executeMany: (payloadMap?: Record<string, WABActionParams>) => Promise<PromiseSettledResult<unknown>[]>;
  loading: boolean;
  error: Error | null;
  results: Record<string, unknown>;
}

export function useWABActions(
  actionNames: string[],
  options?: UseWABActionOptions
): UseWABActionsResult;

export interface WABProviderProps {
  scriptSrc?: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function WABProvider(props: WABProviderProps): import('react').ReactElement;
