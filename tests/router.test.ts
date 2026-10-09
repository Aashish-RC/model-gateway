import { describe, it, expect, beforeEach } from 'vitest';
import { RouteLlmEngine } from '../src/router/routellm.js';
import { FallbackMatrix } from '../src/router/matrix.js';
import { RouterOrchestrator } from '../src/router/orchestrator.js';
import { UniversalChatRequest } from '../src/adapters/types.js';

describe('RouteLLM Engine', () => {
  let engine: RouteLlmEngine;

  beforeEach(() => {
    engine = new RouteLlmEngine({
      strongModel: { provider: 'openai', model: 'gpt-4o' },
      weakModel: { provider: 'openai', model: 'gpt-4o-mini' },
      threshold: 0.5,
    });
  });

  it('scores simple prompts as low complexity and routes to weak model', () => {
    const messages = [{ role: 'user' as const, content: 'Hi there!' }];
    const score = engine.calculateComplexity(messages);
    expect(score).toBeLessThan(0.5);

    const evaluation = engine.evaluate(messages);
    expect(evaluation.decision.model).toBe('gpt-4o-mini');
  });

  it('scores complex coding and mathematical reasoning as high complexity', () => {
    const complexPrompt = `
      Please write a high-performance concurrent priority queue in TypeScript:
      \`\`\`typescript
      interface PriorityItem<T> { priority: number; item: T; }
      \`\`\`
      Ensure you mathematically prove time complexity step-by-step and calculate worst-case tree depth.
    `;

    const messages = [{ role: 'user' as const, content: complexPrompt }];
    const score = engine.calculateComplexity(messages);
    expect(score).toBeGreaterThanOrEqual(0.5);

    const evaluation = engine.evaluate(messages);
    expect(evaluation.decision.model).toBe('gpt-4o');
  });

  it('parses virtual model thresholds correctly', () => {
    expect(engine.isRouteLlmVirtualModel('router-pareto')).toBe(true);
    expect(engine.isRouteLlmVirtualModel('router-0.35')).toBe(true);
    expect(engine.parseVirtualModelThreshold('router-0.35')).toBe(0.35);
    expect(engine.parseVirtualModelThreshold('router-cost')).toBe(0.8);
    expect(engine.parseVirtualModelThreshold('router-quality')).toBe(0.2);
  });
});

describe('Fallback Matrix', () => {
  const matrix = new FallbackMatrix();

  it('constructs cascade chains for providers without duplicates', () => {
    const chain = matrix.getCascadeChain({ provider: 'openai', model: 'gpt-4o' });
    expect(chain).toHaveLength(3);
    expect(chain[0].provider).toBe('openai');
    expect(chain[1].provider).toBe('anthropic');
    expect(chain[2].provider).toBe('gemini');
  });

  it('identifies retryable error messages accurately', () => {
    expect(matrix.isRetryableError(429, 'Rate limit exceeded')).toBe(true);
    expect(matrix.isRetryableError(503, 'Service unavailable')).toBe(true);
    expect(matrix.isRetryableError(undefined, 'Provider is overloaded')).toBe(true);
    expect(matrix.isRetryableError(400, 'Invalid JSON body')).toBe(false);
  });
});

describe('RouterOrchestrator Routing Resolution', () => {
  const orchestrator = RouterOrchestrator.getInstance();

  it('resolves direct models with fallback cascade', () => {
    const req: UniversalChatRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'hello' }],
    };

    const decision = orchestrator.resolveRouting(req);
    expect(decision.targetProvider).toBe('anthropic');
    expect(decision.cascadeChain.length).toBeGreaterThan(1);
    expect(decision.routedViaRouteLlm).toBe(false);
  });

  it('resolves RouteLLM auto-routing when virtual model is requested', () => {
    const req: UniversalChatRequest = {
      model: 'router-pareto-0.6',
      messages: [{ role: 'user', content: 'quick check' }],
    };

    const decision = orchestrator.resolveRouting(req);
    expect(decision.strategy).toBe('routellm-pareto');
    expect(decision.routedViaRouteLlm).toBe(true);
    expect(decision.score).toBeDefined();
  });
});
