import {
  ProviderAdapter,
  ProviderAdapterConfig,
  UniversalChatRequest,
  UniversalChatResponse,
  UniversalStreamChunk,
} from './types.js';
import { parseSseLines } from '../normalizers/stream.js';

export class OpenAiAdapter implements ProviderAdapter {
  readonly providerName = 'openai';

  async chatComplete(
    request: UniversalChatRequest,
    config: ProviderAdapterConfig
  ): Promise<UniversalChatResponse> {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...config.headers,
    };

    const payload = {
      ...request,
      stream: false,
    };

    const controller = new AbortController();
    const timeoutId = config.timeoutMs
      ? setTimeout(() => controller.abort(), config.timeoutMs)
      : null;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenAI API error (${response.status}): ${errorText || response.statusText}`
        );
      }

      const data = (await response.json()) as any;
      return {
        id: data.id ?? `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: data.created ?? Math.floor(Date.now() / 1000),
        model: data.model ?? request.model,
        provider: this.providerName,
        choices: (data.choices ?? []).map((c: any, idx: number) => ({
          index: c.index ?? idx,
          message: {
            role: 'assistant',
            content: c.message?.content ?? null,
            ...(c.message?.tool_calls ? { tool_calls: c.message.tool_calls } : {}),
          },
          finish_reason: c.finish_reason ?? 'stop',
        })),
        usage: data.usage
          ? {
              prompt_tokens: data.usage.prompt_tokens ?? 0,
              completion_tokens: data.usage.completion_tokens ?? 0,
              total_tokens: data.usage.total_tokens ?? 0,
              prompt_tokens_details: data.usage.prompt_tokens_details,
              completion_tokens_details: data.usage.completion_tokens_details,
            }
          : undefined,
        system_fingerprint: data.system_fingerprint,
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async *streamChatComplete(
    request: UniversalChatRequest,
    config: ProviderAdapterConfig
  ): AsyncIterable<UniversalStreamChunk> {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...config.headers,
    };

    const payload = {
      ...request,
      stream: true,
      stream_options: {
        include_usage: true,
      },
    };

    const controller = new AbortController();
    const timeoutId = config.timeoutMs
      ? setTimeout(() => controller.abort(), config.timeoutMs)
      : null;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      throw err;
    }

    if (!response.ok) {
      if (timeoutId) clearTimeout(timeoutId);
      const errorText = await response.text();
      throw new Error(
        `OpenAI API stream error (${response.status}): ${errorText || response.statusText}`
      );
    }

    if (!response.body) {
      if (timeoutId) clearTimeout(timeoutId);
      throw new Error('OpenAI API returned empty response body');
    }

    try {
      for await (const line of parseSseLines(response.body)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') break;

        if (trimmed.startsWith('data: ')) {
          const rawData = trimmed.slice(6).trim();
          if (rawData === '[DONE]') break;

          try {
            const parsed = JSON.parse(rawData);
            const chunk: UniversalStreamChunk = {
              id: parsed.id ?? `chunk-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: parsed.created ?? Math.floor(Date.now() / 1000),
              model: parsed.model ?? request.model,
              provider: this.providerName,
              choices: (parsed.choices ?? []).map((c: any) => ({
                index: c.index ?? 0,
                delta: {
                  role: c.delta?.role,
                  content: c.delta?.content ?? null,
                  reasoning_content: c.delta?.reasoning_content ?? null,
                  tool_calls: c.delta?.tool_calls,
                },
                finish_reason: c.finish_reason ?? null,
              })),
              usage: parsed.usage
                ? {
                    prompt_tokens: parsed.usage.prompt_tokens ?? 0,
                    completion_tokens: parsed.usage.completion_tokens ?? 0,
                    total_tokens: parsed.usage.total_tokens ?? 0,
                    prompt_tokens_details: parsed.usage.prompt_tokens_details,
                    completion_tokens_details: parsed.usage.completion_tokens_details,
                  }
                : undefined,
            };
            yield chunk;
          } catch {
            // Ignore unparseable intermediate SSE data lines
          }
        }
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
