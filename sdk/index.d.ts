/**
 * WAB Agent SDK — TypeScript definitions.
 */

export interface WABAgentOptions {
  /** Default timeout in ms (default 10000). */
  timeout?: number;
  /** Use BiDi interface instead of AICommands. */
  useBiDi?: boolean;
}

export interface WABActionDescriptor {
  name: string;
  description?: string;
  category?: string;
  params?: Array<{
    name: string;
    type?: string;
    required?: boolean;
    description?: string;
    label?: string;
  }>;
  [key: string]: unknown;
}

export interface WABExecuteResult {
  ok: boolean;
  action?: string;
  status?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface WABPageInfo {
  title?: string;
  url?: string;
  bridgeVersion?: string;
  [key: string]: unknown;
}

export interface PipelineStep {
  name: string;
  params?: Record<string, unknown>;
}

export interface PipelineResult {
  name: string;
  ok: boolean;
  result?: any;
  error?: string;
}

export interface ParallelResult {
  name: string;
  status: 'fulfilled' | 'rejected';
  value?: any;
  reason?: string;
}

export interface RunPipelineOptions {
  /** Stop on first error (default true). */
  stopOnError?: boolean;
}

export declare class WABAgent {
  constructor(page: any, options?: WABAgentOptions);

  /** Wait for the WAB bridge to be ready on the page. */
  waitForBridge(): Promise<boolean>;

  /** Check if the bridge is loaded on the current page. */
  hasBridge(): Promise<boolean>;

  /** Get all available actions, optionally filtered by category. */
  getActions(category?: string): Promise<WABActionDescriptor[]>;

  /** Get a single action by name. */
  getAction(name: string): Promise<WABActionDescriptor | null>;

  /** Execute an action by name. */
  execute(name: string, params?: Record<string, unknown>): Promise<WABExecuteResult>;

  /** Read text content of an element. */
  readContent(selector: string): Promise<{ text: string; [key: string]: unknown }>;

  /** Get page info and bridge metadata. */
  getPageInfo(): Promise<WABPageInfo>;

  /** Authenticate an agent with the bridge. */
  authenticate(apiKey: string, meta?: Record<string, unknown>): Promise<any>;

  /** Navigate to a URL and wait for the bridge. */
  navigateAndWait(url: string): Promise<void>;

  /** Execute multiple actions in sequence. */
  executeSteps(steps: PipelineStep[]): Promise<any[]>;

  /** Get BiDi context (only available when useBiDi is true). */
  getBiDiContext(): Promise<any>;

  /** Check if the page has granted consent for agent interactions. */
  hasConsent(): Promise<boolean>;

  /** Wait until consent is granted (blocks until user clicks Allow). */
  waitForConsent(pollMs?: number): Promise<boolean>;

  /** Discover the page and return the list of actions. */
  discover(): Promise<{ actions: WABActionDescriptor[]; meta?: WABPageInfo }>;

  /** Run a sequence of actions, stopping on the first failure by default. */
  runPipeline(steps: PipelineStep[], options?: RunPipelineOptions): Promise<PipelineResult[]>;

  /** Execute multiple actions in parallel. */
  executeParallel(actions: PipelineStep[]): Promise<ParallelResult[]>;

  /** Take a screenshot and return as base64. */
  screenshot(opts?: { fullPage?: boolean }): Promise<string>;
}
