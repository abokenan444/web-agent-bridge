export interface WABToolkitOptions {
  /** Site URL for HTTP-based discovery and execution. */
  siteUrl?: string;
  /** WABAgent instance for browser-based execution (Puppeteer/Playwright). */
  agent?: any;
  /** Request timeout in milliseconds (default 15000). */
  timeout?: number;
  /** API key sent as Authorization header for server-side calls. */
  apiKey?: string;
}

export interface WABLangChainTool {
  name: string;
  description: string;
  schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  invoke(input: Record<string, unknown>): Promise<string>;
  call?(input: Record<string, unknown>): Promise<string>;
}

export declare class WABToolkit {
  constructor(options: WABToolkitOptions);
  /** Discover WAB actions and return them as LangChain-compatible tools. */
  getTools(category?: string): Promise<WABLangChainTool[]>;
  /** Return the raw discovery document. */
  getDiscovery(): Promise<any>;
}

export interface WABLiveToolOptions {
  /** WAB registry base URL (default https://api.webagentbridge.com). */
  registry?: string;
  /** Request timeout in ms (default 15000). */
  timeout?: number;
  /** API key sent as Authorization header during site execution. */
  apiKey?: string;
  /** Agent identity advertised via X-Agent header. */
  agentName?: string;
  /** Override the LangChain tool name. */
  name?: string;
  /** Override the LangChain tool description. */
  description?: string;
}

export interface WABLiveToolInput {
  domain: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface WABLiveToolResult {
  ok: boolean;
  stage: 'input' | 'discover' | 'verify' | 'revoked' | 'execute';
  domain?: string;
  action?: string;
  statuses?: Record<string, string>;
  revocation?: Record<string, unknown> | null;
  result?: unknown;
  error?: string;
  hint?: string;
}

/**
 * Single LangChain tool that performs WAB discover → verify-live → execute
 * as one safe call. Refuses to transact with revoked domains.
 */
export declare function WABLiveTool(options?: WABLiveToolOptions): WABLangChainTool;

/** Lower-level helper used by WABLiveTool. */
export declare function runWabFlow(
  input: WABLiveToolInput,
  options?: WABLiveToolOptions
): Promise<WABLiveToolResult>;
