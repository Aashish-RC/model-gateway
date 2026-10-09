# Smart AI Gateway

A high-performance, resilient, and enterprise-grade Universal AI Gateway written in TypeScript & Node.js Fastify.

Synthesizes the best design patterns and algorithms converged across **12 leading open-source AI gateways**:
- **RouteLLM** (LMSYS Pareto routing heuristics)
- **Portkey** (Universal adapters, request hedging, 3-state circuit breaker)
- **LiteLLM** (100+ provider mappings, micro-dollar pricing catalog, thinking tokens)
- **APISIX** (api-breaker finite state machine, Prometheus exposition, sliding-window rate limit)
- **Helicone** (Precise cost & token calculations, tracing headers)
- **Higress** (Dual-tier RPM/TPM token rate limit, streaming SSE cache replay)
- **New-API & One-API** (Customer virtual keys, spend quotas, model mapping & rewriting)
- **OmniRoute** (Fastify streaming architecture, multi-key rotation, cooldown jitter)
- **Envoy AI Gateway** (Outlier detection, parameter sanitization, quota policy)
- **Arch** (Inbound/outbound regex & heuristic PII masking, prompt injection & jailbreak defense)
- **Kong AI Proxy** (AI proxy filter chain, SHA-256 and semantic vector response caching)

---

## Features (F1 – F9)

1. **F1: Universal Protocol Normalization & Adapters**: Bidirectional translation between OpenAI (`/v1/chat/completions`), Anthropic Messages, and Google Gemini. Full streaming SSE chunk normalization.
2. **F2: Key Pool & 429 Sentinel Engine**: Multi-key load balancing (weighted, round-robin, least-busy), exponential backoff with randomized jitter on HTTP 429/5xx, self-healing background recovery heartbeat.
3. **F3: Smart Routing & Fallback Matrix**: LMSYS RouteLLM Pareto auto-routing with heuristic query complexity scoring (`router-pareto`, `router-cost-saver`), multi-provider fallback cascade.
4. **F4: Resilience & Circuit Breaker**: 3-state Circuit Breaker (`CLOSED` ➔ `OPEN` ➔ `HALF-OPEN`), zero-latency short-circuiting, Portkey speculative request hedging, canary probe recovery.
5. **F5: Token Counting, Cost Engine & Telemetry**: Exact cl100k + heuristic tokenizer, dynamic micro-dollar model pricing catalog, Prometheus exporter (`/metrics`), Helicone tracing headers, live rolling request audit log.
6. **F6: Rate Limiting & Virtual Key Quota**: Dual-tier RPM & TPM 60-bucket circular ring buffer, customer virtual API keys (`sk-gw-*`), spend budget caps ($ USD), model whitelist restrictions.
7. **F7: Exact & Semantic Response Cache**: Exact SHA-256 payload LRU cache (`< 1ms`) + high-speed TF-IDF semantic cosine similarity vector cache, instant SSE streaming playback, bypass headers.
8. **F8: Guardrails, PII Sanitizer & Security**: Inbound/outbound regex & pattern PII masking (Email, Phone, SSN, Credit Cards, API Keys, IPs), heuristic prompt injection & jailbreak detector, system shielding.
9. **F9: Payload Mutation & Parameter Transformation**: Dynamic model rewriting & aliasing, reasoning effort translation (`reasoning_effort` $\leftrightarrow$ `thinking_budget` $\leftrightarrow$ `thinkingConfig`), system prompt decoration, schema cleaner.

---

## Quick Start

### Installation

```bash
npm install
```

### Development Mode

```bash
npm run dev
```

The gateway server starts at `http://localhost:8080/`. Open your browser to access the interactive Control Plane & AI Playground.

### Running Tests

```bash
npm test
```

Runs the complete Vitest test suite (94 tests across 12 suites).

### Production Build

```bash
npm run build
npm start
```

---

## API Endpoints

- `POST /v1/chat/completions`: Universal chat completions endpoint (OpenAI-compatible)
- `GET /health`: Gateway health check & uptime
- `GET /metrics`: Prometheus v0.0.4 metrics exporter
- `GET /api/pool`: Live upstream key pool status & in-flight concurrency
- `GET /api/resilience`: Circuit breaker state machine status
- `POST /api/resilience/trip`: Simulate upstream provider outage
- `POST /api/resilience/reset`: Reset provider circuit breakers
- `GET /api/telemetry/stats`: Rollup KPIs (spend, token counts, latency)
- `GET /api/telemetry/requests`: Rolling 100-request audit log
- `GET /api/pricing`: Dynamic micro-dollar pricing catalog
- `GET /api/virtual-keys`: List customer virtual keys & spend quotas
- `POST /api/virtual-keys`: Create customer virtual API key (`sk-gw-*`)
- `PUT /api/virtual-keys/:id`: Update limits, budgets, or status
- `DELETE /api/virtual-keys/:id`: Revoke/delete virtual key
- `GET /api/cache/stats`: Cache hit ratio, saved tokens & spend
- `POST /api/cache/clear`: Flush response cache
- `POST /api/cache/config`: Update cache TTL and semantic threshold
- `GET /api/guardrails/config`: Active PII & jailbreak policies and metrics
- `POST /api/guardrails/test`: Live test prompt against guardrails
- `GET /api/mutations/config`: Active model aliases & transformation settings
- `POST /api/mutations/aliases`: Register new model alias
