import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { loadConfig, AppConfig } from './config/index.js';
import { AdapterRegistry } from './adapters/registry.js';
import { SentinelEngine } from './keys/index.js';
import { RouterOrchestrator } from './router/index.js';
import { normalizeRequest } from './normalizers/request.js';
import { normalizeResponse } from './normalizers/response.js';
import { formatOpenAiSseChunk, OPENAI_SSE_DONE } from './normalizers/stream.js';
import { ProviderAdapterConfig } from './adapters/types.js';
import { ResilienceManager, RequestHedger } from './resilience/index.js';
import { PricingEngine, TokenizerHelper, TelemetryCollector } from './telemetry/index.js';
import { VirtualKeyManager, RateLimitCheckResult } from './ratelimit/index.js';
import { globalCache } from './cache/index.js';
import { globalGuardrails } from './guardrails/index.js';
import { globalMutations } from './mutations/index.js';

export interface ServerOptions extends FastifyServerOptions {
  config?: AppConfig;
}

export function resolveProvider(
  model: string,
  explicitHeader?: string,
  defaultProvider = 'openai'
): string {
  const router = RouterOrchestrator.getInstance();
  return router.inferProvider(model, explicitHeader);
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const registry = AdapterRegistry.getInstance();
  const sentinel = SentinelEngine.getInstance();
  const router = RouterOrchestrator.getInstance();
  const resilience = ResilienceManager.getInstance();
  const pricing = PricingEngine.getInstance();
  const telemetry = TelemetryCollector.getInstance();
  const virtualKeys = VirtualKeyManager.getInstance();

  sentinel.initFromConfig(config);
  sentinel.startRecoveryLoop();
  router.initFromConfig(config);

  const server = fastify({
    logger: {
      level: config.server.logLevel,
      transport:
        process.env.NODE_ENV !== 'production'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
    ...options,
  });

  await server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  server.addHook('onClose', async () => {
    sentinel.stop();
  });

  // Serve static UI assets from public folder
  await server.register(fastifyStatic, {
    root: path.resolve(process.cwd(), 'public'),
    prefix: '/',
  });

  // Health check endpoint
  server.get('/health', async (_request, _reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '0.1.0',
    };
  });

  // Key pool inspector endpoint
  server.get('/api/pool', async (_request, _reply) => {
    return { pool: sentinel.getAllKeyViews() };
  });

  // Add key to backend pool
  server.post('/api/keys', async (request, reply) => {
    const body = request.body as any;
    if (!body || !body.provider || !body.key) {
      reply.status(400);
      return { error: 'Missing required fields: provider and key' };
    }
    const id = body.id || `${body.provider}-key-${Date.now()}`;
    const weight = Number(body.weight) || 1;
    sentinel.addKey(body.provider, id, body.key, weight);
    return { success: true, id, provider: body.provider, weight };
  });

  // Delete key from pool
  server.delete('/api/keys/:provider/:id', async (request, reply) => {
    const { provider, id } = request.params as { provider: string; id: string };
    const deleted = sentinel.removeKey(provider, id);
    if (!deleted) {
      reply.status(404);
      return { error: 'Key not found' };
    }
    return { success: true, id, provider };
  });

  // Router inspector & RouteLLM stats endpoint
  server.get('/api/router', async (_request, _reply) => {
    return {
      stats: router.getStats(),
      routeLlm: router.getRouteLlm().getConfig(),
    };
  });

  // Update RouteLLM settings dynamically
  server.post('/api/router/routellm', async (request, _reply) => {
    const body = request.body as any;
    if (body) {
      router.getRouteLlm().setConfig(body);
    }
    return {
      success: true,
      routeLlm: router.getRouteLlm().getConfig(),
    };
  });

  // Resilience & Circuit Breaker inspection endpoint
  server.get('/api/resilience', async (_request, _reply) => {
    return {
      breakers: resilience.getAllMetrics(),
    };
  });

  // Reset circuit breaker(s)
  server.post('/api/resilience/reset', async (request, _reply) => {
    const body = (request.body as any) || {};
    if (body.provider) {
      resilience.reset(body.provider);
    } else {
      resilience.resetAll();
    }
    return {
      success: true,
      breakers: resilience.getAllMetrics(),
    };
  });

  // Manually trip a circuit breaker (Chaos / Demo testing)
  server.post('/api/resilience/trip', async (request, reply) => {
    const body = (request.body as any) || {};
    if (!body.provider) {
      reply.status(400);
      return { error: 'Missing required field: provider' };
    }
    resilience.trip(body.provider);
    return {
      success: true,
      provider: body.provider,
      breakers: resilience.getAllMetrics(),
    };
  });

  // Prometheus metrics endpoint
  server.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return telemetry.renderPrometheusMetrics();
  });

  // Telemetry KPIs rollup endpoint
  server.get('/api/telemetry/stats', async (_request, _reply) => {
    return { kpis: telemetry.getKPIs() };
  });

  // Recent request logs audit endpoint
  server.get('/api/telemetry/requests', async (request, _reply) => {
    const limit = parseInt((request.query as any)?.limit || '50', 10);
    return { requests: telemetry.getRecentRequests(limit) };
  });

  // Model pricing catalog endpoint
  server.get('/api/pricing', async (_request, _reply) => {
    return { pricing: pricing.getAllRates() };
  });

  // Virtual Keys & Team Quota endpoints
  server.get('/api/virtual-keys', async (_request, _reply) => {
    return { keys: virtualKeys.listKeys() };
  });

  server.post('/api/virtual-keys', async (request, reply) => {
    const body = (request.body as any) || {};
    if (!body.name) {
      reply.status(400);
      return { error: 'Missing required field: name' };
    }
    const newKey = virtualKeys.createKey({
      name: body.name,
      rpmLimit: body.rpmLimit ? Number(body.rpmLimit) : undefined,
      tpmLimit: body.tpmLimit ? Number(body.tpmLimit) : undefined,
      maxBudgetUsd: body.maxBudgetUsd !== undefined ? Number(body.maxBudgetUsd) : undefined,
      allowedModels: Array.isArray(body.allowedModels) ? body.allowedModels : undefined,
      customKey: body.customKey,
    });
    return { success: true, key: newKey };
  });

  server.put('/api/virtual-keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as any) || {};
    const updated = virtualKeys.updateKey(id, {
      name: body.name,
      rpmLimit: body.rpmLimit !== undefined ? Number(body.rpmLimit) : undefined,
      tpmLimit: body.tpmLimit !== undefined ? Number(body.tpmLimit) : undefined,
      maxBudgetUsd: body.maxBudgetUsd !== undefined ? Number(body.maxBudgetUsd) : undefined,
      allowedModels: Array.isArray(body.allowedModels) ? body.allowedModels : undefined,
      status: body.status,
    });
    if (!updated) {
      reply.status(404);
      return { error: 'Virtual key not found' };
    }
    return { success: true, key: updated };
  });

  server.delete('/api/virtual-keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = virtualKeys.deleteKey(id);
    if (!deleted) {
      reply.status(404);
      return { error: 'Virtual key not found' };
    }
    return { success: true, id };
  });

  // Feature 7: Exact & Semantic Response Cache Endpoints
  server.get('/api/cache/stats', async (_request, _reply) => {
    return { stats: globalCache.getStats() };
  });

  server.get('/api/cache/entries', async (_request, _reply) => {
    return { entries: globalCache.getAllEntries() };
  });

  server.post('/api/cache/clear', async (_request, _reply) => {
    globalCache.clear();
    return { success: true, message: 'Response cache cleared successfully' };
  });

  server.post('/api/cache/config', async (request, _reply) => {
    const body = (request.body as any) || {};
    const updated = globalCache.updateConfig(body);
    return { success: true, config: updated };
  });

  // Feature 8: Guardrails, PII Sanitizer & Security Endpoints
  server.get('/api/guardrails/config', async (_request, _reply) => {
    return {
      config: globalGuardrails.getConfig(),
      metrics: globalGuardrails.getMetrics(),
    };
  });

  server.post('/api/guardrails/config', async (request, _reply) => {
    const body = (request.body as any) || {};
    const updated = globalGuardrails.updateConfig(body);
    return { success: true, config: updated };
  });

  server.post('/api/guardrails/test', async (request, _reply) => {
    const body = (request.body as any) || {};
    const text = body.text || '';
    const inspectRes = globalGuardrails.inspectInbound([{ role: 'user', content: text }]);
    return {
      allowed: inspectRes.allowed,
      blockedReason: inspectRes.blockedReason,
      piiDetected: inspectRes.piiDetected,
      piiMatches: inspectRes.piiMatches,
      jailbreakDetected: inspectRes.jailbreakDetected,
      jailbreakScore: inspectRes.jailbreakScore,
      jailbreakSignals: inspectRes.jailbreakSignals,
      sanitizedText: inspectRes.sanitizedMessages[0]?.content,
    };
  });

  // Feature 9: Payload Mutation & Parameter Transformation Endpoints
  server.get('/api/mutations/config', async (_request, _reply) => {
    return { config: globalMutations.getConfig() };
  });

  server.post('/api/mutations/config', async (request, _reply) => {
    const body = (request.body as any) || {};
    const updated = globalMutations.updateConfig(body);
    return { success: true, config: updated };
  });

  server.post('/api/mutations/aliases', async (request, reply) => {
    const body = (request.body as any) || {};
    if (!body.alias || !body.targetModel) {
      reply.status(400);
      return { error: 'Both alias and targetModel are required' };
    }
    globalMutations.getRewriter().setAlias(body.alias, body.targetModel);
    return { success: true, aliases: globalMutations.getRewriter().getAllAliases() };
  });

  server.delete('/api/mutations/aliases/:alias', async (request, reply) => {
    const { alias } = request.params as { alias: string };
    const deleted = globalMutations.getRewriter().deleteAlias(alias);
    if (!deleted) {
      reply.status(404);
      return { error: `Alias '${alias}' not found` };
    }
    return { success: true, aliases: globalMutations.getRewriter().getAllAliases() };
  });

  // Chat completions endpoint with RouteLLM + Fallback Matrix Cascade + 429 Sentinel + Circuit Breaker + Hedging + Telemetry
  server.post('/v1/chat/completions', async (request, reply) => {
    const requestStartTime = performance.now();
    const requestId = 'req-' + Math.random().toString(36).substring(2, 10);

    let normalizedReq;
    try {
      normalizedReq = normalizeRequest(request.body);
    } catch (err: any) {
      reply.status(400);
      return {
        error: {
          message: err.message || 'Invalid request body',
          type: 'invalid_request_error',
          code: 'bad_request',
        },
      };
    }

    // 1. Feature 8: Inbound Guardrails (PII & Prompt Injection / Jailbreak)
    const guardrailResult = globalGuardrails.inspectInbound(normalizedReq.messages);
    if (!guardrailResult.allowed) {
      reply.status(guardrailResult.statusCode || 400);
      return {
        error: {
          message: guardrailResult.blockedReason || 'Request blocked by safety guardrails',
          type: 'guardrail_violation_error',
          code: 'guardrail_blocked',
        },
      };
    }
    normalizedReq.messages = guardrailResult.sanitizedMessages;
    reply.header('x-gateway-guardrails', guardrailResult.piiDetected ? 'SANITIZED' : 'PASSED');
    if (guardrailResult.piiDetected) {
      reply.header('x-gateway-pii-detected', 'true');
    }

    // 2. Feature 9: Payload Mutation & Parameter Transformation
    const mutationResult = globalMutations.applyMutations(normalizedReq);
    normalizedReq = mutationResult.mutatedRequest;
    if (mutationResult.appliedAliases) {
      reply.header('x-gateway-original-model', mutationResult.originalModel);
      reply.header('x-gateway-aliased-model', mutationResult.resolvedModel);
    }

    // 3. Feature 7: Exact & Semantic Response Cache Lookup
    const cacheLookup = globalCache.lookup(normalizedReq, request.headers as Record<string, any>);
    if (cacheLookup.status === 'HIT' || cacheLookup.status === 'SEMANTIC_HIT') {
      const cachedRes = cacheLookup.entry!.response;
      const usage = cachedRes.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      reply.header('x-gateway-request-id', requestId);
      reply.header('x-gateway-cache', cacheLookup.status);
      reply.header('x-gateway-cache-key', cacheLookup.cacheKey || 'cache-hit');
      if (cacheLookup.similarity) {
        reply.header('x-gateway-cache-similarity', cacheLookup.similarity.toString());
      }
      reply.header('x-gateway-latency-ms', '0');
      reply.header('x-gateway-cached', 'true');

      telemetry.recordRequest({
        id: requestId,
        timestamp: new Date().toISOString(),
        provider: 'cache',
        model: normalizedReq.model,
        strategy: 'cache-hit',
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        latencyMs: 0,
        tokensPerSecond: 999.0,
        costUsd: 0,
        statusCode: 200,
        circuitState: 'CLOSED',
        stream: Boolean(normalizedReq.stream),
      });

      if (normalizedReq.stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('x-gateway-cache', cacheLookup.status);
        reply.raw.flushHeaders?.();
        await globalCache.streamCachedResponse(cachedRes, (chunk) => reply.raw.write(chunk), 0);
        reply.raw.end();
        return reply;
      }

      return cachedRes;
    }

    reply.header('x-gateway-cache', 'MISS');

    const providerHeader = (request.headers['x-provider'] as string) || undefined;
    const enableRouteLlmHeader =
      request.headers['x-routellm'] === 'true' ||
      request.headers['x-route'] === 'pareto';
    const thresholdHeader = request.headers['x-threshold']
      ? parseFloat(request.headers['x-threshold'] as string)
      : undefined;

    const enableHedgingHeader =
      request.headers['x-hedging'] === 'true' ||
      (request.body as any)?.hedging === true;
    const hedgeDelayMs = request.headers['x-hedge-delay']
      ? parseInt(request.headers['x-hedge-delay'] as string, 10)
      : 2000;

    const isHelicone =
      Boolean(request.headers['helicone-auth']) ||
      request.headers['x-helicone-trace'] === 'true';

    // Resolve routing (RouteLLM Pareto or Direct + Fallback Cascade)
    const routingDecision = router.resolveRouting(normalizedReq, {
      providerHeader,
      enableRouteLlm: enableRouteLlmHeader,
      thresholdOverride: thresholdHeader,
    });

    const authHeader = (request.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '');
    const clientApiKey = (request.headers['x-api-key'] as string) || authHeader;
    const isVirtualKey = Boolean(clientApiKey && clientApiKey.startsWith('sk-gw-'));

    let virtualKeyRecord: RateLimitCheckResult | null = null;
    if (isVirtualKey) {
      const estimatedPromptTokens = TokenizerHelper.estimatePromptTokens(normalizedReq.messages);
      const rlResult = virtualKeys.validateAndReserve(
        clientApiKey,
        normalizedReq.model,
        estimatedPromptTokens
      );

      reply.header('x-ratelimit-limit-requests', rlResult.limitRequests.toString());
      reply.header('x-ratelimit-remaining-requests', rlResult.remainingRequests.toString());
      reply.header('x-ratelimit-limit-tokens', rlResult.limitTokens.toString());
      reply.header('x-ratelimit-remaining-tokens', rlResult.remainingTokens.toString());
      reply.header('x-ratelimit-reset-requests', rlResult.resetSeconds.toString());

      if (!rlResult.allowed) {
        if (rlResult.retryAfterSeconds > 0) {
          reply.header('retry-after', rlResult.retryAfterSeconds.toString());
        }

        if (rlResult.reason === 'budget_exceeded') {
          reply.status(429);
          return {
            error: {
              message: 'Virtual API key spend budget limit exceeded',
              type: 'budget_exceeded_error',
              code: 'budget_exceeded',
            },
          };
        }

        if (rlResult.reason === 'model_not_allowed') {
          reply.status(403);
          return {
            error: {
              message: `Model '${normalizedReq.model}' is not permitted for this virtual API key`,
              type: 'permission_error',
              code: 'model_not_allowed',
            },
          };
        }

        if (rlResult.reason === 'key_revoked') {
          reply.status(401);
          return {
            error: {
              message: 'Virtual API key has been revoked',
              type: 'authentication_error',
              code: 'key_revoked',
            },
          };
        }

        if (rlResult.reason === 'key_not_found') {
          reply.status(401);
          return {
            error: {
              message: 'Invalid or unknown virtual API key',
              type: 'authentication_error',
              code: 'invalid_api_key',
            },
          };
        }

        reply.status(429);
        return {
          error: {
            message: `Rate limit exceeded: ${rlResult.reason}`,
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
          },
        };
      }

      virtualKeyRecord = rlResult;
    }

    const customApiKey = clientApiKey;
    const hasCustomKey =
      customApiKey &&
      !isVirtualKey &&
      customApiKey !== 'dummy-key' &&
      !customApiKey.startsWith('sk-demo-');

    const cascadeChain = routingDecision.cascadeChain;

    // Hedged execution branch for non-streaming multi-provider requests
    if (enableHedgingHeader && !normalizedReq.stream && cascadeChain.length > 1) {
      const primaryTarget = cascadeChain[0];
      const backupTarget = cascadeChain[1];

      // Verify availability of primary
      if (resilience.isProviderAvailable(primaryTarget.provider)) {
        try {
          const hedgedResult = await RequestHedger.executeWithHedge(
            async () => {
              const effectiveReq = { ...normalizedReq, model: primaryTarget.model };
              const provConfig = config.providers[primaryTarget.provider] ?? config.providers[config.routing.defaultProvider];
              const baseUrl = provConfig?.baseUrl || 'https://api.openai.com/v1';
              const adapter = registry.get(primaryTarget.provider);

              if (hasCustomKey) {
                const adapterConfig: ProviderAdapterConfig = { baseUrl, apiKey: customApiKey, timeoutMs: config.gateway.timeoutMs };
                return await adapter.chatComplete(effectiveReq, adapterConfig);
              }
              return await sentinel.executeWithKeyRetry(
                primaryTarget.provider,
                async (selectedKey) => {
                  const adapterConfig: ProviderAdapterConfig = { baseUrl, apiKey: selectedKey, timeoutMs: config.gateway.timeoutMs };
                  return await adapter.chatComplete(effectiveReq, adapterConfig);
                },
                { maxRetries: config.gateway.retryAttempts }
              );
            },
            async () => {
              const effectiveReq = { ...normalizedReq, model: backupTarget.model };
              const provConfig = config.providers[backupTarget.provider] ?? config.providers[config.routing.defaultProvider];
              const baseUrl = provConfig?.baseUrl || 'https://api.openai.com/v1';
              const adapter = registry.get(backupTarget.provider);

              if (hasCustomKey) {
                const adapterConfig: ProviderAdapterConfig = { baseUrl, apiKey: customApiKey, timeoutMs: config.gateway.timeoutMs };
                return await adapter.chatComplete(effectiveReq, adapterConfig);
              }
              return await sentinel.executeWithKeyRetry(
                backupTarget.provider,
                async (selectedKey) => {
                  const adapterConfig: ProviderAdapterConfig = { baseUrl, apiKey: selectedKey, timeoutMs: config.gateway.timeoutMs };
                  return await adapter.chatComplete(effectiveReq, adapterConfig);
                },
                { maxRetries: config.gateway.retryAttempts }
              );
            },
            { enabled: true, delayMs: hedgeDelayMs }
          );

          const winningTarget = hedgedResult.winner === 'primary' ? primaryTarget : backupTarget;
          resilience.recordSuccess(winningTarget.provider);

          const durationMs = performance.now() - requestStartTime;
          const usage = TokenizerHelper.resolveUsage(
            hedgedResult.result.usage,
            normalizedReq.messages,
            hedgedResult.result.choices?.[0]?.message?.content ?? undefined
          );
          const cost = pricing.calculateCost(winningTarget.model, usage.prompt_tokens, usage.completion_tokens);
          const speed = usage.completion_tokens / Math.max(0.001, durationMs / 1000);

          telemetry.recordRequest({
            id: requestId,
            timestamp: new Date().toISOString(),
            provider: winningTarget.provider,
            model: winningTarget.model,
            strategy: routingDecision.strategy,
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            latencyMs: Math.round(durationMs),
            tokensPerSecond: Number(speed.toFixed(1)),
            costUsd: cost.totalCost,
            statusCode: 200,
            circuitState: resilience.getBreaker(winningTarget.provider).getState(),
            hedged: true,
            stream: false,
          });

          if (isVirtualKey) {
            virtualKeys.recordUsage(clientApiKey, usage.total_tokens, cost.totalCost);
          }

          reply.header('x-gateway-request-id', requestId);
          reply.header('x-gateway-provider', winningTarget.provider);
          reply.header('x-gateway-model', winningTarget.model);
          reply.header('x-gateway-strategy', routingDecision.strategy);
          reply.header('x-gateway-hedged', 'true');
          reply.header('x-gateway-hedge-winner', hedgedResult.winner);
          reply.header('x-gateway-circuit-state', resilience.getBreaker(winningTarget.provider).getState());
          reply.header('x-gateway-prompt-tokens', usage.prompt_tokens.toString());
          reply.header('x-gateway-completion-tokens', usage.completion_tokens.toString());
          reply.header('x-gateway-total-tokens', usage.total_tokens.toString());
          reply.header('x-gateway-cost-usd', cost.totalCost.toString());
          reply.header('x-gateway-latency-ms', Math.round(durationMs).toString());
          reply.header('x-gateway-tokens-per-second', Number(speed.toFixed(1)).toString());

          if (isHelicone) {
            reply.header('helicone-request-id', requestId);
            reply.header('helicone-latency-ms', Math.round(durationMs).toString());
            reply.header('helicone-tokens-total', usage.total_tokens.toString());
            reply.header('helicone-cost-usd', cost.totalCost.toString());
          }

          if (routingDecision.score != null) {
            reply.header('x-gateway-routellm-score', routingDecision.score.toString());
          }

          const normalizedRes = normalizeResponse(hedgedResult.result);
          const choiceMsg = normalizedRes.choices?.[0]?.message;
          if (choiceMsg && typeof choiceMsg.content === 'string') {
            const outSanitize = globalGuardrails.inspectOutbound(choiceMsg.content);
            if (outSanitize.piiDetected) {
              choiceMsg.content = outSanitize.content;
              reply.header('x-gateway-response-sanitized', 'true');
            }
          }
          normalizedRes.usage = { ...usage, estimated_cost_usd: cost.totalCost };
          globalCache.store(normalizedReq, normalizedRes, cost.totalCost);
          return normalizedRes;
        } catch (hedgeErr: any) {
          server.log.warn({ hedgeErr: hedgeErr.message }, 'Hedged execution failed, falling back to standard cascade');
        }
      }
    }

    // Standard Cascade loop with Circuit Breaker protection
    let lastError: Error | null = null;

    for (let i = 0; i < cascadeChain.length; i++) {
      const target = cascadeChain[i];
      const isFallbackHop = i > 0;

      // 1. Check Circuit Breaker availability before making network attempt
      if (!resilience.isProviderAvailable(target.provider)) {
        const breakerState = resilience.getBreaker(target.provider).getState();
        server.log.warn(
          { provider: target.provider, state: breakerState },
          'Circuit breaker is OPEN for provider; short-circuiting to next fallback'
        );
        lastError = new Error(`Circuit breaker is OPEN for provider '${target.provider}'`);
        continue; // Fast-fail without waiting for network timeout!
      }

      if (isFallbackHop) {
        router.recordFallbackTriggered();
        server.log.warn(
          { hopIndex: i, previousError: lastError?.message, target },
          'Cascading to fallback provider...'
        );
      }

      const effectiveReq = {
        ...normalizedReq,
        model: target.model,
      };

      const providerConfigDef =
        config.providers[target.provider] ?? config.providers[config.routing.defaultProvider];
      const baseUrl = providerConfigDef?.baseUrl || 'https://api.openai.com/v1';

      let adapter;
      try {
        adapter = registry.get(target.provider);
      } catch (err: any) {
        lastError = err;
        continue;
      }

      // STREAMING REQUEST EXECUTION
      if (effectiveReq.stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Accel-Buffering', 'no');
        reply.raw.setHeader('x-gateway-request-id', requestId);
        reply.raw.setHeader('x-gateway-provider', target.provider);
        reply.raw.setHeader('x-gateway-model', target.model);
        reply.raw.setHeader('x-gateway-strategy', routingDecision.strategy);
        reply.raw.setHeader('x-gateway-circuit-state', resilience.getBreaker(target.provider).getState());
        if (routingDecision.score != null) {
          reply.raw.setHeader('x-gateway-routellm-score', routingDecision.score.toString());
        }
        if (isVirtualKey && virtualKeyRecord) {
          reply.raw.setHeader('x-ratelimit-limit-requests', virtualKeyRecord.limitRequests.toString());
          reply.raw.setHeader('x-ratelimit-remaining-requests', virtualKeyRecord.remainingRequests.toString());
          reply.raw.setHeader('x-ratelimit-limit-tokens', virtualKeyRecord.limitTokens.toString());
          reply.raw.setHeader('x-ratelimit-remaining-tokens', virtualKeyRecord.remainingTokens.toString());
          reply.raw.setHeader('x-ratelimit-reset-requests', virtualKeyRecord.resetSeconds.toString());
        }
        reply.raw.flushHeaders?.();

        let firstTokenTime = 0;
        let streamedText = '';

        try {
          if (hasCustomKey) {
            const adapterConfig: ProviderAdapterConfig = {
              baseUrl,
              apiKey: customApiKey,
              timeoutMs: config.gateway.timeoutMs,
            };
            const stream = await adapter.streamChatComplete(effectiveReq, adapterConfig);
            for await (const chunk of stream) {
              if (!firstTokenTime) firstTokenTime = performance.now();
              if (chunk.choices?.[0]?.delta?.content) {
                streamedText += chunk.choices[0].delta.content;
              }
              reply.raw.write(formatOpenAiSseChunk(chunk));
            }
          } else {
            await sentinel.executeWithKeyRetry(
              target.provider,
              async (selectedKey) => {
                const adapterConfig: ProviderAdapterConfig = {
                  baseUrl,
                  apiKey: selectedKey,
                  timeoutMs: config.gateway.timeoutMs,
                };
                const stream = await adapter.streamChatComplete(effectiveReq, adapterConfig);
                for await (const chunk of stream) {
                  if (!firstTokenTime) firstTokenTime = performance.now();
                  if (chunk.choices?.[0]?.delta?.content) {
                    streamedText += chunk.choices[0].delta.content;
                  }
                  reply.raw.write(formatOpenAiSseChunk(chunk));
                }
              },
              { maxRetries: config.gateway.retryAttempts }
            );
          }
          resilience.recordSuccess(target.provider);
          reply.raw.write(OPENAI_SSE_DONE);

          const durationMs = performance.now() - requestStartTime;
          const ttftMs = firstTokenTime ? firstTokenTime - requestStartTime : durationMs;
          const usage = TokenizerHelper.resolveUsage(undefined, effectiveReq.messages, streamedText);
          const cost = pricing.calculateCost(target.model, usage.prompt_tokens, usage.completion_tokens);
          const speed = usage.completion_tokens / Math.max(0.001, (durationMs - ttftMs) / 1000);

          telemetry.recordRequest({
            id: requestId,
            timestamp: new Date().toISOString(),
            provider: target.provider,
            model: target.model,
            strategy: routingDecision.strategy,
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            latencyMs: Math.round(durationMs),
            ttftMs: Math.round(ttftMs),
            tokensPerSecond: Number(speed.toFixed(1)),
            costUsd: cost.totalCost,
            statusCode: 200,
            circuitState: resilience.getBreaker(target.provider).getState(),
            stream: true,
          });

          if (isVirtualKey) {
            virtualKeys.recordUsage(clientApiKey, usage.total_tokens, cost.totalCost);
          }

          return reply;
        } catch (err: any) {
          lastError = err;
          resilience.recordFailure(target.provider, err);

          const canFallback =
            router.getFallbackMatrix().isRetryableError(undefined, err.message) &&
            i < cascadeChain.length - 1;

          if (!canFallback) {
            reply.raw.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
            reply.raw.write(OPENAI_SSE_DONE);
            return reply;
          }
          continue; // Hop to next fallback
        } finally {
          reply.raw.end();
        }
      }

      // NON-STREAMING REQUEST EXECUTION
      try {
        let response;
        if (hasCustomKey) {
          const adapterConfig: ProviderAdapterConfig = {
            baseUrl,
            apiKey: customApiKey,
            timeoutMs: config.gateway.timeoutMs,
          };
          response = await adapter.chatComplete(effectiveReq, adapterConfig);
        } else {
          response = await sentinel.executeWithKeyRetry(
            target.provider,
            async (selectedKey) => {
              const adapterConfig: ProviderAdapterConfig = {
                baseUrl,
                apiKey: selectedKey,
                timeoutMs: config.gateway.timeoutMs,
              };
              return await adapter.chatComplete(effectiveReq, adapterConfig);
            },
            { maxRetries: config.gateway.retryAttempts }
          );
        }

        resilience.recordSuccess(target.provider);

        const durationMs = performance.now() - requestStartTime;
        const usage = TokenizerHelper.resolveUsage(
          response.usage,
          effectiveReq.messages,
          response.choices?.[0]?.message?.content ?? undefined
        );
        const cost = pricing.calculateCost(target.model, usage.prompt_tokens, usage.completion_tokens);
        const speed = usage.completion_tokens / Math.max(0.001, durationMs / 1000);

        telemetry.recordRequest({
          id: requestId,
          timestamp: new Date().toISOString(),
          provider: target.provider,
          model: target.model,
          strategy: routingDecision.strategy,
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          latencyMs: Math.round(durationMs),
          tokensPerSecond: Number(speed.toFixed(1)),
          costUsd: cost.totalCost,
          statusCode: 200,
          circuitState: resilience.getBreaker(target.provider).getState(),
          stream: false,
        });

        if (isVirtualKey) {
          virtualKeys.recordUsage(clientApiKey, usage.total_tokens, cost.totalCost);
        }

        reply.header('x-gateway-request-id', requestId);
        reply.header('x-gateway-provider', target.provider);
        reply.header('x-gateway-model', target.model);
        reply.header('x-gateway-strategy', routingDecision.strategy);
        reply.header('x-gateway-circuit-state', resilience.getBreaker(target.provider).getState());
        reply.header('x-gateway-prompt-tokens', usage.prompt_tokens.toString());
        reply.header('x-gateway-completion-tokens', usage.completion_tokens.toString());
        reply.header('x-gateway-total-tokens', usage.total_tokens.toString());
        reply.header('x-gateway-cost-usd', cost.totalCost.toString());
        reply.header('x-gateway-latency-ms', Math.round(durationMs).toString());
        reply.header('x-gateway-tokens-per-second', Number(speed.toFixed(1)).toString());

        if (isHelicone) {
          reply.header('helicone-request-id', requestId);
          reply.header('helicone-latency-ms', Math.round(durationMs).toString());
          reply.header('helicone-tokens-total', usage.total_tokens.toString());
          reply.header('helicone-cost-usd', cost.totalCost.toString());
        }

        if (routingDecision.score != null) {
          reply.header('x-gateway-routellm-score', routingDecision.score.toString());
        }

        const normalizedRes = normalizeResponse(response);
        const choiceMsg = normalizedRes.choices?.[0]?.message;
        if (choiceMsg && typeof choiceMsg.content === 'string') {
          const outSanitize = globalGuardrails.inspectOutbound(choiceMsg.content);
          if (outSanitize.piiDetected) {
            choiceMsg.content = outSanitize.content;
            reply.header('x-gateway-response-sanitized', 'true');
          }
        }
        normalizedRes.usage = { ...usage, estimated_cost_usd: cost.totalCost };
        globalCache.store(normalizedReq, normalizedRes, cost.totalCost);
        return normalizedRes;
      } catch (err: any) {
        lastError = err;
        resilience.recordFailure(target.provider, err);

        const canFallback =
          router.getFallbackMatrix().isRetryableError(undefined, err.message) &&
          i < cascadeChain.length - 1;

        if (canFallback) {
          continue; // Hop to next fallback target
        }
        break; // Stop and return error
      }
    }

    server.log.error({ lastError }, 'All cascade targets failed');
    const failedDuration = performance.now() - requestStartTime;
    telemetry.recordRequest({
      id: requestId,
      timestamp: new Date().toISOString(),
      provider: cascadeChain[0]?.provider || 'unknown',
      model: cascadeChain[0]?.model || 'unknown',
      strategy: routingDecision.strategy,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Math.round(failedDuration),
      tokensPerSecond: 0,
      costUsd: 0,
      statusCode: 502,
      stream: false,
    });

    reply.status(502);
    return {
      error: {
        message: lastError?.message || 'All primary and fallback providers failed',
        type: 'gateway_cascade_error',
        code: 'all_targets_exhausted',
      },
    };
  });

  return server;
}
