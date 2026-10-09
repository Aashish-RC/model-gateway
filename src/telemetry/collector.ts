import {
  RequestTelemetryEntry,
  TelemetryKPIs,
} from './types.js';

export class TelemetryCollector {
  private static instance: TelemetryCollector;
  private readonly maxEntries = 100;
  private recentRequests: RequestTelemetryEntry[] = [];

  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  private totalPromptTokens = 0;
  private totalCompletionTokens = 0;
  private totalTokens = 0;
  private totalCostUsd = 0;
  private totalLatencyMs = 0;
  private totalSpeedSum = 0;
  private speedCount = 0;

  private providerStats = new Map<string, { requests: number; tokens: number; costUsd: number }>();
  private modelStats = new Map<string, { requests: number; tokens: number; costUsd: number }>();

  private constructor() {}

  public static getInstance(): TelemetryCollector {
    if (!TelemetryCollector.instance) {
      TelemetryCollector.instance = new TelemetryCollector();
    }
    return TelemetryCollector.instance;
  }

  public recordRequest(entry: RequestTelemetryEntry): void {
    this.totalRequests++;

    if (entry.statusCode >= 200 && entry.statusCode < 400) {
      this.successfulRequests++;
    } else {
      this.failedRequests++;
    }

    this.totalPromptTokens += entry.promptTokens;
    this.totalCompletionTokens += entry.completionTokens;
    this.totalTokens += entry.totalTokens;
    this.totalCostUsd = Number((this.totalCostUsd + entry.costUsd).toFixed(6));
    this.totalLatencyMs += entry.latencyMs;

    if (entry.tokensPerSecond > 0) {
      this.totalSpeedSum += entry.tokensPerSecond;
      this.speedCount++;
    }

    // Provider Breakdown
    const pStat = this.providerStats.get(entry.provider) || { requests: 0, tokens: 0, costUsd: 0 };
    pStat.requests++;
    pStat.tokens += entry.totalTokens;
    pStat.costUsd = Number((pStat.costUsd + entry.costUsd).toFixed(6));
    this.providerStats.set(entry.provider, pStat);

    // Model Breakdown
    const mStat = this.modelStats.get(entry.model) || { requests: 0, tokens: 0, costUsd: 0 };
    mStat.requests++;
    mStat.tokens += entry.totalTokens;
    mStat.costUsd = Number((mStat.costUsd + entry.costUsd).toFixed(6));
    this.modelStats.set(entry.model, mStat);

    // Circular Buffer
    this.recentRequests.unshift(entry);
    if (this.recentRequests.length > this.maxEntries) {
      this.recentRequests.pop();
    }
  }

  public getKPIs(): TelemetryKPIs {
    const avgLatencyMs = this.totalRequests > 0
      ? Math.round(this.totalLatencyMs / this.totalRequests)
      : 0;

    const avgTokensPerSecond = this.speedCount > 0
      ? Number((this.totalSpeedSum / this.speedCount).toFixed(1))
      : 0;

    const providerBreakdown: Record<string, { requests: number; tokens: number; costUsd: number }> = {};
    for (const [k, v] of this.providerStats.entries()) {
      providerBreakdown[k] = { ...v };
    }

    const modelBreakdown: Record<string, { requests: number; tokens: number; costUsd: number }> = {};
    for (const [k, v] of this.modelStats.entries()) {
      modelBreakdown[k] = { ...v };
    }

    return {
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      totalPromptTokens: this.totalPromptTokens,
      totalCompletionTokens: this.totalCompletionTokens,
      totalTokens: this.totalTokens,
      totalCostUsd: Number(this.totalCostUsd.toFixed(6)),
      avgLatencyMs,
      avgTokensPerSecond,
      providerBreakdown,
      modelBreakdown,
    };
  }

  public getRecentRequests(limit = 50): RequestTelemetryEntry[] {
    return this.recentRequests.slice(0, limit);
  }

  public renderPrometheusMetrics(): string {
    const lines: string[] = [
      '# HELP gateway_requests_total Total number of AI gateway requests',
      '# TYPE gateway_requests_total counter',
    ];

    for (const [prov, stat] of this.providerStats.entries()) {
      lines.push(`gateway_requests_total{provider="${prov}"} ${stat.requests}`);
    }

    lines.push(
      '',
      '# HELP gateway_tokens_total Total tokens processed by the gateway',
      '# TYPE gateway_tokens_total counter'
    );
    lines.push(`gateway_tokens_total{type="prompt"} ${this.totalPromptTokens}`);
    lines.push(`gateway_tokens_total{type="completion"} ${this.totalCompletionTokens}`);
    lines.push(`gateway_tokens_total{type="total"} ${this.totalTokens}`);

    lines.push(
      '',
      '# HELP gateway_cost_dollars_total Total estimated spend in USD',
      '# TYPE gateway_cost_dollars_total counter'
    );
    for (const [model, stat] of this.modelStats.entries()) {
      lines.push(`gateway_cost_dollars_total{model="${model}"} ${stat.costUsd.toFixed(6)}`);
    }

    lines.push(
      '',
      '# HELP gateway_avg_latency_ms Average request latency in milliseconds',
      '# TYPE gateway_avg_latency_ms gauge'
    );
    const avgLatency = this.totalRequests > 0
      ? (this.totalLatencyMs / this.totalRequests).toFixed(2)
      : '0';
    lines.push(`gateway_avg_latency_ms ${avgLatency}`);

    return lines.join('\n') + '\n';
  }

  public reset(): void {
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalTokens = 0;
    this.totalCostUsd = 0;
    this.totalLatencyMs = 0;
    this.totalSpeedSum = 0;
    this.speedCount = 0;
    this.providerStats.clear();
    this.modelStats.clear();
    this.recentRequests = [];
  }
}
