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

// ─── WABMultiAgent — Cross-Site Agent Orchestration ────────────────────

export interface WABMultiAgentOptions {
  /** Per-site timeout in ms (default 15000). */
  timeout?: number;
  /** Launch headless browsers (default true). */
  headless?: boolean;
  /** Puppeteer launch options. */
  launchOptions?: Record<string, unknown>;
  /** Use BiDi protocol. */
  useBiDi?: boolean;
}

export interface MultiAgentLaunchResult {
  connected: string[];
  failed: string[];
}

export interface MultiAgentSiteResult {
  site: string;
  status: 'fulfilled' | 'rejected';
  value?: any;
  error?: string;
}

export interface MultiAgentDiscovery {
  site: string;
  actions: WABActionDescriptor[];
  meta: Record<string, unknown>;
  error?: string;
}

export interface PriceResult {
  site: string;
  product?: string;
  price?: number;
  currency?: string;
  error?: string;
}

export interface PriceComparison {
  results: PriceResult[];
  cheapest: PriceResult | null;
  savings: number | null;
}

export interface MultiAgentNavigateResult {
  site: string;
  ok: boolean;
  error?: string;
}

export interface MultiAgentScreenshotResult {
  site: string;
  screenshot?: string;
  error?: string;
}

export declare class WABMultiAgent {
  constructor(sites: string[], options?: WABMultiAgentOptions);

  /** Launch browsers and connect to all sites. */
  launch(): Promise<MultiAgentLaunchResult>;

  /** Discover all sites — return actions and metadata per site. */
  discoverAll(): Promise<MultiAgentDiscovery[]>;

  /** Execute an action on all connected sites in parallel. */
  executeAll(actionName: string, params?: Record<string, unknown>): Promise<MultiAgentSiteResult[]>;

  /** Compare prices for a product across all sites. */
  comparePrices(sku: string): Promise<PriceComparison>;

  /** Compare a specific action result across all sites with optional ranking. */
  compareAction(
    actionName: string,
    params?: Record<string, unknown>,
    rankFn?: (results: MultiAgentSiteResult[]) => MultiAgentSiteResult[]
  ): Promise<{ results: MultiAgentSiteResult[]; ranked: MultiAgentSiteResult[] }>;

  /** Navigate all sessions to a new path. */
  navigateAll(path: string): Promise<MultiAgentNavigateResult[]>;

  /** Take screenshots from all sites. */
  screenshotAll(opts?: { fullPage?: boolean }): Promise<MultiAgentScreenshotResult[]>;

  /** Get a summary of all sessions. */
  status(): { total: number; connected: string[] };

  /** Close all browser sessions. */
  close(): Promise<void>;
}

// ─── WABUniversalAgent — Works on ANY page, no bridge needed ───────────

export interface UniversalAnalysis {
  url: string;
  domain: string;
  products?: Array<{
    name?: string;
    price?: number;
    currency?: string;
    originalPrice?: number;
    rating?: number;
    method?: string;
  }>;
  fairness?: {
    total: number;
    category: string;
    breakdown: Record<string, number>;
    wabBridge?: { installed: boolean; bonus?: number; hasNegotiation?: boolean };
    platform?: { size: string; commission: number };
  };
  darkPatterns?: Array<{ type: string; severity?: string; matches?: string[] }>;
  alerts?: Array<{ title: string; description?: string; severity?: string }>;
}

export interface UniversalDeal {
  name?: string;
  source?: string;
  domain?: string;
  priceUsd?: number;
  rating?: number;
  url?: string;
  compositeScore?: number;
  wabBridge?: boolean;
  canNegotiate?: boolean;
  fairness?: { total: number; category: string };
}

export interface UniversalDealsResult {
  deals: UniversalDeal[];
  insights?: Array<{ icon?: string; text: string }>;
  sourcesChecked?: number;
}

export interface UniversalFairness {
  domain: string;
  total: number;
  category: string;
  breakdown: Record<string, number>;
  wabBridge?: { installed: boolean; bonus?: number };
  platform?: { size: string; commission: number };
}

export declare class WABUniversalAgent {
  constructor(serverUrl?: string);

  /** Extract products, prices, and metadata from any URL. */
  extract(url: string): Promise<any>;

  /** Full analysis: extract + fairness + fraud detection + dark patterns. */
  analyze(url: string): Promise<UniversalAnalysis>;

  /** Compare prices across multiple sources. */
  compare(query: string, category?: string): Promise<any>;

  /** Find and rank the best deals with fairness scoring. */
  deals(query: string, category?: string, lang?: string): Promise<UniversalDealsResult>;

  /** Get fairness score for a domain. */
  fairness(domain: string): Promise<UniversalFairness>;

  /** Detect dark patterns on a URL. */
  darkPatterns(url: string): Promise<any>;

  /** Get price history for a domain. */
  priceHistory(domain: string): Promise<any>;

  /** Get top fairness-scored sites. */
  topFair(limit?: number): Promise<any>;

  /** Get all known competing sources. */
  sources(): Promise<any>;
}
