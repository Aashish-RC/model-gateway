import { describe, it, expect } from 'vitest';
import { normalizeRequest } from '../src/normalizers/request.js';
import { normalizeResponse } from '../src/normalizers/response.js';
import { parseSseLines, formatOpenAiSseChunk } from '../src/normalizers/stream.js';
import { UniversalStreamChunk } from '../src/adapters/types.js';

describe('Normalizers', () => {
  it('validates and normalizes chat completion requests', () => {
    const raw = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello world' }],
      reasoning_effort: 'high',
      stream: false,
    };

    const normalized = normalizeRequest(raw);
    expect(normalized.model).toBe('gpt-4o');
    expect(normalized.messages).toHaveLength(1);
    expect(normalized.reasoning_effort).toBe('high');
    expect(normalized.stream).toBe(false);
  });

  it('rejects invalid request payloads', () => {
    expect(() => normalizeRequest(null)).toThrow();
    expect(() => normalizeRequest({ model: '' })).toThrow();
    expect(() => normalizeRequest({ model: 'gpt-4', messages: [] })).toThrow();
    expect(() => normalizeRequest({ model: 'gpt-4', messages: [{}] })).toThrow();
  });

  it('normalizes response envelope cleanly', () => {
    const raw: any = {
      id: 'test-id',
      model: 'gpt-4o',
      provider: 'openai',
      choices: [{ index: 0, message: { role: 'assistant', content: 'test' } }],
    };

    const normalized = normalizeResponse(raw);
    expect(normalized.object).toBe('chat.completion');
    expect(normalized.choices[0].finish_reason).toBe('stop');
  });

  it('parses SSE lines accurately across chunk boundaries', async () => {
    const chunks = [
      new TextEncoder().encode('event: test\ndata: {"part": 1}'),
      new TextEncoder().encode('\n\nevent: done\ndata: [DONE]\n\n'),
    ];

    let chunkIdx = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunkIdx < chunks.length) {
          controller.enqueue(chunks[chunkIdx++]);
        } else {
          controller.close();
        }
      },
    });

    const lines: string[] = [];
    for await (const line of parseSseLines(stream)) {
      lines.push(line);
    }

    expect(lines).toContain('event: test');
    expect(lines).toContain('data: {"part": 1}');
    expect(lines).toContain('event: done');
    expect(lines).toContain('data: [DONE]');
  });

  it('formats OpenAI SSE chunks properly', () => {
    const chunk: UniversalStreamChunk = {
      id: 'chunk-1',
      object: 'chat.completion.chunk',
      created: 123456,
      model: 'gpt-4o',
      provider: 'openai',
      choices: [
        {
          index: 0,
          delta: { content: 'chunk text' },
          finish_reason: null,
        },
      ],
    };

    const formatted = formatOpenAiSseChunk(chunk);
    expect(formatted.startsWith('data: {')).toBe(true);
    expect(formatted.endsWith('\n\n')).toBe(true);
    expect(JSON.parse(formatted.slice(6).trim()).id).toBe('chunk-1');
  });
});
