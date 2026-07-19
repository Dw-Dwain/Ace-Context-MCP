export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderRequest {
  model: string;
  system?: string;
  messages: ProviderMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderResponse {
  provider: string;
  model: string;
  content: string;
  usage: ProviderUsage;
  stopReason?: string;
}

export interface Provider {
  readonly id: string;
  chat(req: ProviderRequest): Promise<ProviderResponse>;
}

export interface RouteAttempt {
  provider: string;
  ok: boolean;
  error?: string;
}

export interface RouteOutcome {
  result: ProviderResponse;
  chosen: string;
  attempts: RouteAttempt[];
}
