import { describe, it, expect, beforeEach } from 'vitest';
import { MutationPipeline, ModelRewriter, PromptDecorator, ReasoningTranslator, SchemaCleaner } from '../src/mutations/index.js';
import { UniversalChatRequest } from '../src/adapters/types.js';

describe('Feature 9: Payload Mutation & Parameter Transformation', () => {
  let pipeline: MutationPipeline;

  beforeEach(() => {
    pipeline = new MutationPipeline();
  });

  describe('ModelRewriter', () => {
    it('rewrites shorthand alias "claude" to full sonnet model', () => {
      const rewriter = new ModelRewriter();
      const res = rewriter.resolve('claude');
      expect(res.rewritten).toBe(true);
      expect(res.resolved).toBe('claude-3-5-sonnet-20241022');
    });

    it('rewrites "fast" to "gpt-4o-mini" and "smart" to "gpt-4o"', () => {
      const rewriter = new ModelRewriter();
      expect(rewriter.resolve('fast').resolved).toBe('gpt-4o-mini');
      expect(rewriter.resolve('smart').resolved).toBe('gpt-4o');
    });

    it('supports custom alias registration', () => {
      const rewriter = new ModelRewriter();
      rewriter.setAlias('team-default', 'claude-3-5-sonnet-20241022');
      expect(rewriter.resolve('team-default').resolved).toBe('claude-3-5-sonnet-20241022');
    });
  });

  describe('PromptDecorator', () => {
    it('prepends organizational guidelines into existing system message', () => {
      const messages = [
        { role: 'system' as const, content: 'You are a helpful assistant.' },
        { role: 'user' as const, content: 'Hello!' },
      ];

      const res = PromptDecorator.decorate(messages, '[COMPANY POLICY]', undefined);
      expect(res.decorated).toBe(true);
      expect(res.messages[0].content).toBe('[COMPANY POLICY]\n\nYou are a helpful assistant.');
    });

    it('creates new system message if none was provided', () => {
      const messages = [{ role: 'user' as const, content: 'Write a poem.' }];
      const res = PromptDecorator.decorate(messages, 'Answer in rhyme.');
      expect(res.decorated).toBe(true);
      expect(res.messages[0].role).toBe('system');
      expect(res.messages[0].content).toBe('Answer in rhyme.');
    });
  });

  describe('ReasoningTranslator', () => {
    it('translates OpenAI reasoning_effort "high" to Anthropic thinking budget tokens', () => {
      const req: UniversalChatRequest = {
        model: 'o1-preview',
        messages: [{ role: 'user', content: 'Solve this riddle' }],
        reasoning_effort: 'high',
      } as any;

      const res = ReasoningTranslator.translate(req, 'anthropic');
      expect(res.translated).toBe(true);
      expect((res.req as any).thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
      expect((res.req as any).reasoning_effort).toBeUndefined();
    });

    it('translates Anthropic thinking budget to Google Gemini thinkingConfig', () => {
      const req: UniversalChatRequest = {
        model: 'claude-3-7-sonnet',
        messages: [{ role: 'user', content: 'Think carefully' }],
        thinking: { type: 'enabled', budget_tokens: 2048 },
      } as any;

      const res = ReasoningTranslator.translate(req, 'gemini');
      expect(res.translated).toBe(true);
      expect((res.req as any).thinkingConfig).toEqual({ thinkingBudget: 2048 });
      expect((res.req as any).thinking).toBeUndefined();
    });
  });

  describe('SchemaCleaner', () => {
    it('strips unsupported parameters like frequency_penalty and logit_bias before Anthropic', () => {
      const req: UniversalChatRequest = {
        model: 'claude-3-5-sonnet',
        messages: [{ role: 'user', content: 'Hi' }],
        frequency_penalty: 0.5,
        presence_penalty: 0.5,
        logit_bias: { '50256': -100 },
      } as any;

      const res = SchemaCleaner.clean(req, 'anthropic');
      expect(res.stripped).toContain('frequency_penalty');
      expect(res.stripped).toContain('presence_penalty');
      expect(res.stripped).toContain('logit_bias');
      expect((res.req as any).frequency_penalty).toBeUndefined();
      expect((res.req as any).presence_penalty).toBeUndefined();
    });
  });

  describe('MutationPipeline Integrated Execution', () => {
    it('applies aliases, system prompt decoration, and parameter stripping in one step', () => {
      pipeline.updateConfig({
        systemPromptDecoration: {
          enabled: true,
          prefix: '[ENTERPRISE SECURITY CONTEXT]',
        },
      });

      const req: UniversalChatRequest = {
        model: 'fast',
        messages: [{ role: 'user', content: 'What is 2+2?' }],
        frequency_penalty: 0.2,
      } as any;

      const result = pipeline.applyMutations(req, 'anthropic');
      expect(result.appliedAliases).toBe(true);
      expect(result.resolvedModel).toBe('gpt-4o-mini');
      expect(result.systemDecorated).toBe(true);
      expect(result.mutatedRequest.messages[0].content).toContain('[ENTERPRISE SECURITY CONTEXT]');
      expect(result.strippedParameters).toContain('frequency_penalty');
    });
  });

  describe('HTTP Mutations & Aliases Endpoints Integration', () => {
    it('serves /api/mutations/config and handles alias creation and deletion', async () => {
      const { buildServer } = await import('../src/server.js');
      const server = await buildServer({ logger: false });
      await server.ready();

      try {
        const configRes = await server.inject({
          method: 'GET',
          url: '/api/mutations/config',
        });
        expect(configRes.statusCode).toBe(200);
        const data = JSON.parse(configRes.body).config;
        expect(data).toHaveProperty('modelAliases');

        // Add custom alias
        const addAliasRes = await server.inject({
          method: 'POST',
          url: '/api/mutations/aliases',
          payload: { alias: 'research-expert', targetModel: 'claude-3-5-sonnet-20241022' },
        });
        expect(addAliasRes.statusCode).toBe(200);
        expect(JSON.parse(addAliasRes.body).aliases['research-expert']).toBe('claude-3-5-sonnet-20241022');

        // Delete custom alias
        const delAliasRes = await server.inject({
          method: 'DELETE',
          url: '/api/mutations/aliases/research-expert',
        });
        expect(delAliasRes.statusCode).toBe(200);
        expect(JSON.parse(delAliasRes.body).aliases['research-expert']).toBeUndefined();
      } finally {
        await server.close();
      }
    });
  });
});
