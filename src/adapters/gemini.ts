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

export class GeminiAdapter implements ProviderAdapter {
  readonly providerName = 'gemini';

  private transformFinishReason(
    reason?: string | null
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  private transformMessages(messages: ChatMessage[]): {
    systemInstruction?: { parts: Array<{ text: string }> };
    contents: any[];
  } {
    const systemParts: string[] = [];
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system' || msg.role === 'developer') {
        const text = typeof msg.content === 'string'
          ? msg.content
          : msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
        systemParts.push(text);
        continue;
      }

      if (msg.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.name ?? 'function',
                response: {
                  output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                },
              },
            },
          ],
        });
        continue;
      }

      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: any[] = [];

      if (typeof msg.content === 'string' && msg.content) {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url' && part.image_url?.url) {
            const url = part.image_url.url;
            if (url.startsWith('data:')) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                parts.push({
                  inlineData: {
                    mimeType: match[1],
                    data: match[2],
                  },
                });
                continue;
              }
            }
          }
        }
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let args = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            args = {};
          }
          parts.push({
            functionCall: {
              name: tc.function.name,
              args,
            },
          });
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    return {
      systemInstruction: systemParts.length > 0
        ? { parts: systemParts.map(text => ({ text })) }
        : undefined,
      contents,
    };
  }

  private transformTools(tools?: UniversalChatRequest['tools']) {
    if (!tools || tools.length === 0) return undefined;
    return [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
  }

  private transformToolConfig(toolChoice?: UniversalChatRequest['tool_choice']) {
    if (!toolChoice) return undefined;
    if (toolChoice === 'auto') {
      return { functionCallingConfig: { mode: 'AUTO' } };
    }
    if (toolChoice === 'required') {
      return { functionCallingConfig: { mode: 'ANY' } };
    }
    if (toolChoice === 'none') {
      return { functionCallingConfig: { mode: 'NONE' } };
    }
    if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
      return {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: [toolChoice.function.name],
        },
      };
    }
    return undefined;
  }

  private buildPayload(request: UniversalChatRequest) {
    const { systemInstruction, contents } = this.transformMessages(request.messages);

    const generationConfig: Record<string, any> = {};
    if (request.temperature != null) generationConfig.temperature = request.temperature;
    if (request.top_p != null) generationConfig.topP = request.top_p;
    if (request.top_k != null) generationConfig.topK = request.top_k;
    if (request.max_tokens != null) generationConfig.maxOutputTokens = request.max_tokens;
    if (request.max_completion_tokens != null) generationConfig.maxOutputTokens = request.max_completion_tokens;
    if (request.stop) {
      generationConfig.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    }
    if (request.response_format?.type === 'json_object') {
      generationConfig.responseMimeType = 'application/json';
    } else if (request.response_format?.type === 'json_schema') {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = request.response_format.json_schema?.schema;
    }

    if (request.reasoning_effort && request.reasoning_effort !== 'none') {
      generationConfig.thinkingConfig = {
        thinkingLevel: request.reasoning_effort.toUpperCase(),
      };
    }

    const payload: Record<string, any> = {
      contents,
    };

    if (systemInstruction) payload.systemInstruction = systemInstruction;
    if (Object.keys(generationConfig).length > 0) payload.generationConfig = generationConfig;

    const tools = this.transformTools(request.tools);
    if (tools) payload.tools = tools;

    const toolConfig = this.transformToolConfig(request.tool_choice);
    if (toolConfig) payload.toolConfig = toolConfig;

    return payload;
  }

  async chatComplete(
    request: UniversalChatRequest,
    config: ProviderAdapterConfig
  ): Promise<UniversalChatResponse> {
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const model = request.model.startsWith('models/') ? request.model : `models/${request.model}`;
    const url = `${baseUrl}/v1beta/${model}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    const payload = this.buildPayload(request);

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
          `Gemini API error (${response.status}): ${errorText || response.statusText}`
        );
      }

      const data = (await response.json()) as any;
      const candidate = data.candidates?.[0];

      let textContent = '';
      const toolCalls: ToolCall[] = [];

      for (const part of candidate?.content?.parts ?? []) {
        if (part.text) {
          textContent += part.text;
        } else if (part.functionCall) {
          toolCalls.push({
            id: `call_${Date.now()}_${toolCalls.length}`,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args ?? {}),
            },
          });
        }
      }

      const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
      const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
      const totalTokens = data.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens;

      return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: data.modelVersion ?? request.model,
        provider: this.providerName,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: textContent || (toolCalls.length > 0 ? null : ''),
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            },
            finish_reason: toolCalls.length > 0 ? 'tool_calls' : this.transformFinishReason(candidate?.finishReason),
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          prompt_tokens_details: {
            cached_tokens: data.usageMetadata?.cachedContentTokenCount,
          },
          completion_tokens_details: {
            reasoning_tokens: data.usageMetadata?.thoughtsTokenCount,
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
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const model = request.model.startsWith('models/') ? request.model : `models/${request.model}`;
    const url = `${baseUrl}/v1beta/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.apiKey)}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    const payload = this.buildPayload(request);

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
        `Gemini API stream error (${response.status}): ${errorText || response.statusText}`
      );
    }

    if (!response.body) {
      if (timeoutId) clearTimeout(timeoutId);
      throw new Error('Gemini API returned empty response body');
    }

    const streamId = `chatcmpl-${Date.now()}`;
    let isFirstChunk = true;
    let toolIndex = -1;

    try {
      for await (const line of parseSseLines(response.body)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed.startsWith('data: ')) {
          const rawData = trimmed.slice(6).trim();
          let data: any;
          try {
            data = JSON.parse(rawData);
          } catch {
            continue;
          }

          if (isFirstChunk) {
            isFirstChunk = false;
            yield {
              id: streamId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: data.modelVersion ?? request.model,
              provider: this.providerName,
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: '' },
                  finish_reason: null,
                },
              ],
            };
          }

          const candidate = data.candidates?.[0];
          for (const part of candidate?.content?.parts ?? []) {
            if (part.text) {
              yield {
                id: streamId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: data.modelVersion ?? request.model,
                provider: this.providerName,
                choices: [
                  {
                    index: 0,
                    delta: { content: part.text },
                    finish_reason: null,
                  },
                ],
              };
            } else if (part.functionCall) {
              toolIndex++;
              yield {
                id: streamId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: data.modelVersion ?? request.model,
                provider: this.providerName,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: toolIndex,
                          id: `call_${Date.now()}_${toolIndex}`,
                          type: 'function',
                          function: {
                            name: part.functionCall.name,
                            arguments: JSON.stringify(part.functionCall.args ?? {}),
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              };
            }
          }

          if (candidate?.finishReason) {
            const finishReason = this.transformFinishReason(candidate.finishReason);
            const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
            const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
            yield {
              id: streamId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: data.modelVersion ?? request.model,
              provider: this.providerName,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: finishReason,
                },
              ],
              usage: data.usageMetadata
                ? {
                    prompt_tokens: promptTokens,
                    completion_tokens: completionTokens,
                    total_tokens: data.usageMetadata.totalTokenCount ?? promptTokens + completionTokens,
                    prompt_tokens_details: {
                      cached_tokens: data.usageMetadata.cachedContentTokenCount,
                    },
                    completion_tokens_details: {
                      reasoning_tokens: data.usageMetadata.thoughtsTokenCount,
                    },
                  }
                : undefined,
            };
          }
        }
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
