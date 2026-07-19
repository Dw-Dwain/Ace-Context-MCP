export type OpKind = 'save' | 'load' | 'search' | 'list' | 'forget' | 'chat';

export interface SaveRequest {
  slug: string;
  source: {
    thread?: unknown;
    files?: Array<{ path: string; content: string }>;
    urls?: string[];
    text?: string;
  };
  hints?: {
    tags?: string[];
    ttlDays?: number;
    extract?: Array<'decisions' | 'facts' | 'snippets'>;
    keepRaw?: boolean;
  };
}

export type Shape = 'pointer' | 'summary' | 'working' | 'full';

export interface LoadRequest {
  slug: string;
  shape?: Shape;
  budgetTokens?: number;
}

export interface SearchRequest {
  query: string;
  scope?: string;
  topK?: number;
  budgetTokens?: number;
}

export interface ListRequest {
  prefix?: string;
  tag?: string;
  limit?: number;
}

export interface ForgetRequest {
  slug: string;
  purge?: boolean;
}

export interface ChatRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export type Operation =
  | { kind: 'save'; input: SaveRequest }
  | { kind: 'load'; input: LoadRequest }
  | { kind: 'search'; input: SearchRequest }
  | { kind: 'list'; input: ListRequest }
  | { kind: 'forget'; input: ForgetRequest }
  | { kind: 'chat'; input: ChatRequest };

export interface TraceEntry {
  stage: string;
  phase: 'before' | 'after';
  startedAt: number;
  durationMs: number;
  decision?: unknown;
  error?: { name: string; message: string; stack?: string };
}

export interface RequestContext {
  readonly id: string;
  readonly op: Operation;
  response?: unknown;
  trace: TraceEntry[];
  meta: Record<string, unknown>;
}

export interface Middleware {
  name: string;
  appliesTo?: OpKind[];
  before?: (ctx: RequestContext) => Promise<void> | void;
  after?: (ctx: RequestContext) => Promise<void> | void;
  fatalOnError?: boolean;
}

export interface EngineRunResult {
  id: string;
  op: Operation;
  response: unknown;
  trace: TraceEntry[];
  meta: Record<string, unknown>;
}
