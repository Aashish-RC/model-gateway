import {
  ProviderAdapter,
  ProviderAdapterConfig,
  UniversalChatRequest,
  UniversalChatResponse,
  UniversalStreamChunk,
  ChatMessage,
  ToolCall,
} from './types.js';
import { parseSseLines } from '../normalizers/stream.js';

export class AnthropicAdapter implements ProviderAdapter {
  readonly providerName = 'anthropic';

  private transformFinishReason(
    stopReason?: string | null
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (stopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }

  private transformMessages(messages: ChatMessage[]): {
    system?: string;
    anthropicMessages: any[];
  } {
    const systemParts: string[] = [];
    const anthropicMessages: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system' || msg.role === 'developer') {
        const text = typeof msg.content === 'string'
          ? msg.content
          : msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
        systemParts.push(text);
        continue;
      }

      if (msg.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id ?? '',
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            },
          ],
        });
        continue;
      }

      if (msg.role === 'assistant') {
        const contentBlocks: any[] = [];
        if (typeof msg.content === 'string' && msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text' && part.text) {
              contentBlocks.push({ type: 'text', text: part.text });
            }
          }
        }

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            let inputArgs = {};
            try {
              inputArgs = JSON.parse(tc.function.arguments || '{}');
            } catch {
              inputArgs = { raw: tc.function.arguments };
            }
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: inputArgs,
            });
          }
        }

        anthropicMessages.push({
          role: 'assistant',
          content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }],
        });
        continue;
      }

      // User role
      if (typeof msg.content === 'string') {
        anthropicMessages.push({
          role: 'user',
          content: msg.content,
        });
      } else if (Array.isArray(msg.content)) {
        const contentParts: any[] = [];
        for (const item of msg.content) {
          if (item.type === 'text') {
            contentParts.push({ type: 'text', text: item.text ?? '' });
          } else if (item.type === 'image_url' && item.image_url?.url) {
            const url = item.image_url.url;
            if (url.startsWith('data:')) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                contentParts.push({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: match[1],
                    data: match[2],
                  },
                });
                continue;
              }
            }
            contentParts.push({
              type: 'image',
              source: {
                type: 'url',
                url,
              },
            });
          }
        }
        anthropicMessages.push({
          role: 'user',
          content: contentParts,
        });
      }
    }

    return {
      system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
      anthropicMessages,
    };
  }

  private transformTools(tools?: UniversalChatRequest['tools']) {
    if (!tools || tools.length === 0) return undefined;
    return tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters ?? { type: 'object', properties: {} },
    }));
  }

  private transformToolChoice(toolChoice?: UniversalChatRequest['tool_choice']) {
    if (!toolChoice) return undefined;
    if (toolChoice === 'auto') return { type: 'auto' };
    if (toolChoice === 'required') return { type: 'any' };
    if (toolChoice === 'none') return undefined;
    if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
      return { type: 'tool', name: toolChoice.function.name };
    }
    return undefined;
  }

  private buildPayload(request: UniversalChatRequest, stream = false) {
    const { system, anthropicMessages } = this.transformMessages(request.messages);

    const payload: Record<string, any> = {
      model: request.model,
      messages: anthropicMessages,
      max_tokens: request.max_tokens ?? request.max_completion_tokens ?? 4096,
      stream,
    };

    if (system) payload.system = system;
    if (request.temperature != null) payload.temperature = request.temperature;
    if (request.top_p != null) payload.top_p = request.top_p;
    if (request.top_k != null) payload.top_k = request.top_k;
    if (request.stop) {
      payload.stop_sequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    }

    const tools = this.transformTools(request.tools);
    if (tools) {
      payload.tools = tools;
      const tc = this.transformToolChoice(request.tool_choice);
      if (tc) payload.tool_choice = tc;
    }

    if (request.reasoning_effort && request.reasoning_effort !== 'none') {
      const budgetMap: Record<string, number> = {
        low: 1024,
        medium: 4096,
        high: 16384,
      };
      payload.thinking = {
        type: 'enabled',
        budget_tokens: budgetMap[request.reasoning_effort] ?? 4096,
      };
    }

    return payload;
  }

  async chatComplete(
    request: UniversalChatRequest,
    config: ProviderAdapterConfig
  ): Promise<UniversalChatResponse> {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/v1/messages`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      ...config.headers,
    };

    const payload = this.buildPayload(request, false);

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
          `Anthropic API error (${response.status}): ${errorText || response.statusText}`
        );
      }

      const data = (await response.json()) as any;

      let textContent = '';
      const toolCalls: ToolCall[] = [];

      for (const block of data.content ?? []) {
        if (block.type === 'text') {
          textContent += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
        }
      }

      const promptTokens = data.usage?.input_tokens ?? 0;
      const completionTokens = data.usage?.output_tokens ?? 0;

      return {
        id: data.id ?? `msg-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: data.model ?? request.model,
        provider: this.providerName,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: textContent || (toolCalls.length > 0 ? null : ''),
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            },
            finish_reason: this.transformFinishReason(data.stop_reason),
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          prompt_tokens_details: {
            cached_tokens: data.usage?.cache_read_input_tokens ?? 0,
          },
        },
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async *streamChatComplete(
    request: UniversalChatRequest,
    config: ProviderAdapterConfig
  ): AsyncIterable<UniversalStreamChunk> {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/v1/messages`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      ...config.headers,
    };

    const payload = this.buildPayload(request, true);

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
        `Anthropic API stream error (${response.status}): ${errorText || response.statusText}`
      );
    }

    if (!response.body) {
      if (timeoutId) clearTimeout(timeoutId);
      throw new Error('Anthropic API returned empty response body');
    }

    let streamId = `chatcmpl-${Date.now()}`;
    let model = request.model;
    let promptTokens = 0;
    let cachedTokens = 0;
    let toolIndex = -1;

    try {
      for await (const line of parseSseLines(response.body)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed.startsWith('event: message_stop')) break;

        if (trimmed.startsWith('data: ')) {
          const rawData = trimmed.slice(6).trim();
          let event: any;
          try {
            event = JSON.parse(rawData);
          } catch {
            continue;
          }

          if (event.type === 'message_start') {
            if (event.message?.id) streamId = event.message.id;
            if (event.message?.model) model = event.message.model;
            promptTokens = event.message?.usage?.input_tokens ?? 0;
            cachedTokens = event.message?.usage?.cache_read_input_tokens ?? 0;

            yield {
              id: streamId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              provider: this.providerName,
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: '' },
                  finish_reason: null,
                },
              ],
            };
          } else if (event.type === 'content_block_start') {
            if (event.content_block?.type === 'tool_use') {
              toolIndex++;
              yield {
                id: streamId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                provider: this.providerName,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: toolIndex,
                          id: event.content_block.id,
                          type: 'function',
                          function: {
                            name: event.content_block.name,
                            arguments: '',
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              };
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta') {
              yield {
                id: streamId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                provider: this.providerName,
                choices: [
                  {
                    index: 0,
                    delta: { content: event.delta.text },
                    finish_reason: null,
                  },
                ],
              };
            } else if (event.delta?.type === 'thinking_delta') {
              yield {
                id: streamId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                provider: this.providerName,
                choices: [
                  {
                    index: 0,
                    delta: { reasoning_content: event.delta.thinking },
                    finish_reason: null,
                  },
                ],
              };
            } else if (event.delta?.type === 'input_json_delta') {
              yield {
                id: streamId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                provider: this.providerName,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: toolIndex >= 0 ? toolIndex : 0,
                          function: {
                            arguments: event.delta.partial_json,
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              };
            }
          } else if (event.type === 'message_delta') {
            const outputTokens = event.usage?.output_tokens ?? 0;
            const finishReason = this.transformFinishReason(event.delta?.stop_reason);
            yield {
              id: streamId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              provider: this.providerName,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: finishReason,
                },
              ],
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: outputTokens,
                total_tokens: promptTokens + outputTokens,
                prompt_tokens_details: {
                  cached_tokens: cachedTokens,
                },
              },
            };
          }
        }
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
