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
