export interface ModelPricingRate {
  provider: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
}

export interface CostCalculationResult {
  promptCost: number;
  completionCost: number;
  totalCost: number;
  currency: 'USD';
  model: string;
  provider: string;
}

export interface RequestTelemetryEntry {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  strategy: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  ttftMs?: number;
  tokensPerSecond: number;
  costUsd: number;
  statusCode: number;
  circuitState?: string;
  hedged?: boolean;
  stream: boolean;
}

export interface TelemetryKPIs {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  avgTokensPerSecond: number;
  providerBreakdown: Record<string, { requests: number; tokens: number; costUsd: number }>;
  modelBreakdown: Record<string, { requests: number; tokens: number; costUsd: number }>;
}
