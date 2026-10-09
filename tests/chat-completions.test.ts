import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer, resolveProvider } from '../src/server.js';

describe('Provider Resolution Heuristic', () => {
  it('resolves provider from explicit header', () => {
    expect(resolveProvider('gpt-4o', 'anthropic')).toBe('anthropic');
  });

  it('infers provider from model name', () => {
    expect(resolveProvider('claude-3-5-sonnet-20241022')).toBe('anthropic');
    expect(resolveProvider('gemini-1.5-pro')).toBe('gemini');
    expect(resolveProvider('gpt-4o-mini')).toBe('openai');
    expect(resolveProvider('o1-preview')).toBe('openai');
    expect(resolveProvider('deepseek-chat')).toBe('deepseek');
  });

  it('falls back to default provider for unknown models', () => {
    expect(resolveProvider('my-custom-fine-tuned-model', undefined, 'openai')).toBe('openai');
  });
});

describe('POST /v1/chat/completions', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer({
      logger: false,
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns 400 when body is invalid', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'gpt-4o',
        messages: [],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('bad_request');
  });

  it('handles non-streaming completions for OpenAI successfully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'chatcmpl-server-test',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Server integration test response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    } as any);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello server' }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe('chatcmpl-server-test');
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toBe('Server integration test response');
  });

  it('handles non-streaming completions for Anthropic model correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'msg-claude-test',
        model: 'claude-3-5-sonnet-20241022',
        content: [{ type: 'text', text: 'Claude response through universal endpoint' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 12, output_tokens: 8 },
      }),
    } as any);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello Claude' }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.object).toBe('chat.completion');
    expect(body.provider).toBe('anthropic');
    expect(body.choices[0].message.content).toBe('Claude response through universal endpoint');
    expect(body.usage.total_tokens).toBe(20);
  });
});
