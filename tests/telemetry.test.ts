import { describe, it, expect, beforeEach } from 'vitest';
import {
  PricingEngine,
  TokenizerHelper,
  TelemetryCollector,
} from '../src/telemetry/index.js';
import { buildServer } from '../src/server.js';

describe('Feature 5: Token Counting, Cost Engine & Telemetry', () => {
  beforeEach(() => {
    TelemetryCollector.getInstance().reset();
  });

  describe('PricingEngine', () => {
    it('accurately calculates prompt and completion costs for GPT-4o', () => {
      const pricing = PricingEngine.getInstance();
      // GPT-4o is $2.50 input / $10.00 output per 1M tokens
      const result = pricing.calculateCost('gpt-4o', 1000, 500);

      expect(result.model).toBe('gpt-4o');
      expect(result.provider).toBe('openai');
      // 1000 * 2.50 / 1M = 0.0025
      expect(result.promptCost).toBe(0.0025);
      // 500 * 10.00 / 1M = 0.0050
      expect(result.completionCost).toBe(0.005);
      expect(result.totalCost).toBe(0.0075);
    });

    it('calculates prompt cache read discounts for Anthropic Claude 3.5 Sonnet', () => {
      const pricing = PricingEngine.getInstance();
      // 10,000 prompt tokens with 8,000 cached read ($0.30/M vs normal $3.00/M)
      const result = pricing.calculateCost('claude-3-5-sonnet', 10000, 1000, 8000);

      // normal: 2000 * 3.00 / 1M = 0.006
      // cached: 8000 * 0.30 / 1M = 0.0024
      // promptTotal = 0.0084
      // completion: 1000 * 15.00 / 1M = 0.015
      expect(result.promptCost).toBe(0.0084);
      expect(result.completionCost).toBe(0.015);
      expect(result.totalCost).toBe(0.0234);
    });

    it('handles Gemini 2.0 Flash free tier rate', () => {
      const pricing = PricingEngine.getInstance();
      const result = pricing.calculateCost('gemini-2.0-flash-exp', 5000, 2000);
      expect(result.totalCost).toBe(0);
    });
  });

  describe('TokenizerHelper', () => {
    it('estimates token count for English text accurately', () => {
      const text = 'Hello, this is an automated test for the universal AI Gateway!';
      const tokens = TokenizerHelper.estimateTokens(text);
      expect(tokens).toBeGreaterThan(10);
      expect(tokens).toBeLessThan(25);
    });

    it('estimates prompt tokens with message framing delimiters', () => {
      const messages = [
        { role: 'system' as const, content: 'You are an AI assistant.' },
        { role: 'user' as const, content: 'Summarize quantum physics.' },
      ];
      const tokens = TokenizerHelper.estimatePromptTokens(messages);
      expect(tokens).toBeGreaterThan(15);
    });

    it('prefers reported usage when available', () => {
      const usage = TokenizerHelper.resolveUsage(
        { prompt_tokens: 42, completion_tokens: 18, total_tokens: 60 },
        [{ role: 'user', content: 'test' }],
        'response'
      );
      expect(usage.prompt_tokens).toBe(42);
      expect(usage.completion_tokens).toBe(18);
      expect(usage.total_tokens).toBe(60);
    });
  });

  describe('TelemetryCollector & Prometheus Exporter', () => {
    it('records requests and aggregates KPIs correctly', () => {
      const collector = TelemetryCollector.getInstance();

      collector.recordRequest({
        id: 'req-1',
        timestamp: new Date().toISOString(),
        provider: 'openai',
        model: 'gpt-4o',
        strategy: 'direct',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        latencyMs: 250,
        tokensPerSecond: 200,
        costUsd: 0.00075,
        statusCode: 200,
        stream: false,
      });

      collector.recordRequest({
        id: 'req-2',
        timestamp: new Date().toISOString(),
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        strategy: 'fallback-cascade',
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        latencyMs: 350,
        tokensPerSecond: 285.7,
        costUsd: 0.0021,
        statusCode: 200,
        stream: false,
      });

      const kpis = collector.getKPIs();
      expect(kpis.totalRequests).toBe(2);
      expect(kpis.successfulRequests).toBe(2);
      expect(kpis.totalPromptTokens).toBe(300);
      expect(kpis.totalCompletionTokens).toBe(150);
      expect(kpis.totalTokens).toBe(450);
      expect(kpis.totalCostUsd).toBe(0.00285);
      expect(kpis.avgLatencyMs).toBe(300);
      expect(kpis.providerBreakdown.openai.requests).toBe(1);
      expect(kpis.providerBreakdown.anthropic.requests).toBe(1);
    });

    it('renders valid Prometheus metrics text', () => {
      const collector = TelemetryCollector.getInstance();
      collector.recordRequest({
        id: 'req-prom',
        timestamp: new Date().toISOString(),
        provider: 'openai',
        model: 'gpt-4o',
        strategy: 'direct',
        promptTokens: 50,
        completionTokens: 25,
        totalTokens: 75,
        latencyMs: 120,
        tokensPerSecond: 208,
        costUsd: 0.000375,
        statusCode: 200,
        stream: false,
      });

      const metrics = collector.renderPrometheusMetrics();
      expect(metrics).toContain('gateway_requests_total{provider="openai"} 1');
      expect(metrics).toContain('gateway_tokens_total{type="total"} 75');
      expect(metrics).toContain('gateway_cost_dollars_total{model="gpt-4o"}');
      expect(metrics).toContain('gateway_avg_latency_ms 120.00');
    });
  });

  describe('HTTP Telemetry Endpoints Integration', () => {
    it('serves /metrics, /api/telemetry/stats, /api/telemetry/requests, and /api/pricing', async () => {
      const server = await buildServer();

      // 1. GET /metrics
      const promRes = await server.inject({
        method: 'GET',
        url: '/metrics',
      });
      expect(promRes.statusCode).toBe(200);
      expect(promRes.headers['content-type']).toContain('text/plain');
      expect(promRes.body).toContain('gateway_requests_total');

      // 2. GET /api/telemetry/stats
      const statsRes = await server.inject({
        method: 'GET',
        url: '/api/telemetry/stats',
      });
      expect(statsRes.statusCode).toBe(200);
      const statsData = JSON.parse(statsRes.body);
      expect(statsData.kpis).toBeDefined();
      expect(statsData.kpis.totalRequests).toBeGreaterThanOrEqual(0);

      // 3. GET /api/telemetry/requests
      const reqsRes = await server.inject({
        method: 'GET',
        url: '/api/telemetry/requests?limit=10',
      });
      expect(reqsRes.statusCode).toBe(200);
      const reqsData = JSON.parse(reqsRes.body);
      expect(Array.isArray(reqsData.requests)).toBe(true);

      // 4. GET /api/pricing
      const pricingRes = await server.inject({
        method: 'GET',
        url: '/api/pricing',
      });
      expect(pricingRes.statusCode).toBe(200);
      const pricingData = JSON.parse(pricingRes.body);
      expect(pricingData.pricing).toBeDefined();
      expect(pricingData.pricing['gpt-4o']).toBeDefined();
      expect(pricingData.pricing['gpt-4o'].inputPerMillion).toBe(2.5);

      await server.close();
    });
  });
});
