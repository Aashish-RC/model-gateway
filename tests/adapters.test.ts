import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAiAdapter } from '../src/adapters/openai.js';
import { AnthropicAdapter } from '../src/adapters/anthropic.js';
import { GeminiAdapter } from '../src/adapters/gemini.js';
import { AdapterRegistry } from '../src/adapters/registry.js';
import { UniversalChatRequest } from '../src/adapters/types.js';

describe('OpenAI Adapter', () => {
  const adapter = new OpenAiAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('translates request and formats standard response', async () => {
    const mockResponse = {
      id: 'chatcmpl-123',
      created: 1700000000,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello there!' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as any);

    const request: UniversalChatRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = await adapter.chatComplete(request, {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
    });

    expect(result.id).toBe('chatcmpl-123');
    expect(result.provider).toBe('openai');
    expect(result.choices[0].message.content).toBe('Hello there!');
    expect(result.usage?.total_tokens).toBe(15);
  });
});

describe('Anthropic Adapter', () => {
  const adapter = new AnthropicAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('translates messages, tools, and response format accurately', async () => {
    let capturedBody: any;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, options: any) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          id: 'msg-abc',
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Anthropic response' }],
          usage: { input_tokens: 20, output_tokens: 10 },
        }),
      } as any;
    });

    const request: UniversalChatRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
      ],
      reasoning_effort: 'medium',
    };

    const result = await adapter.chatComplete(request, {
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
    });

    expect(capturedBody.system).toBe('You are helpful');
    expect(capturedBody.messages).toHaveLength(1);
    expect(capturedBody.messages[0].role).toBe('user');
    expect(capturedBody.thinking?.type).toBe('enabled');
    expect(capturedBody.thinking?.budget_tokens).toBe(4096);

    expect(result.id).toBe('msg-abc');
    expect(result.provider).toBe('anthropic');
    expect(result.choices[0].message.content).toBe('Anthropic response');
    expect(result.usage?.prompt_tokens).toBe(20);
    expect(result.usage?.completion_tokens).toBe(10);
    expect(result.usage?.total_tokens).toBe(30);
  });
});

describe('Gemini Adapter', () => {
  const adapter = new GeminiAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('translates contents, systemInstruction and candidate output accurately', async () => {
    let capturedUrl = '';
    let capturedBody: any;

    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url: any, options: any) => {
      capturedUrl = url.toString();
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          modelVersion: 'gemini-1.5-pro',
          candidates: [
            {
              content: {
                parts: [{ text: 'Gemini says hi' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 8,
            totalTokenCount: 23,
          },
        }),
      } as any;
    });

    const request: UniversalChatRequest = {
      model: 'gemini-1.5-pro',
      messages: [
        { role: 'developer', content: 'Gemini system rule' },
        { role: 'user', content: 'What is 2+2?' },
      ],
      temperature: 0.7,
    };

    const result = await adapter.chatComplete(request, {
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'gemini-secret-key',
    });

    expect(capturedUrl).toContain('models/gemini-1.5-pro:generateContent');
    expect(capturedUrl).toContain('key=gemini-secret-key');
    expect(capturedBody.systemInstruction.parts[0].text).toBe('Gemini system rule');
    expect(capturedBody.contents[0].role).toBe('user');
    expect(capturedBody.generationConfig.temperature).toBe(0.7);

    expect(result.provider).toBe('gemini');
    expect(result.choices[0].message.content).toBe('Gemini says hi');
    expect(result.usage?.total_tokens).toBe(23);
  });
});

describe('Adapter Registry', () => {
  it('resolves standard and aliased provider names', () => {
    const registry = AdapterRegistry.getInstance();
    expect(registry.get('openai').providerName).toBe('openai');
    expect(registry.get('deepseek').providerName).toBe('openai');
    expect(registry.get('anthropic').providerName).toBe('anthropic');
    expect(registry.get('claude').providerName).toBe('anthropic');
    expect(registry.get('gemini').providerName).toBe('gemini');
    expect(registry.get('google').providerName).toBe('gemini');
  });
});
