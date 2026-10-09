import { UniversalChatResponse } from '../adapters/types.js';

export function normalizeResponse(response: UniversalChatResponse): UniversalChatResponse {
  return {
    id: response.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: response.created || Math.floor(Date.now() / 1000),
    model: response.model,
    provider: response.provider,
    choices: (response.choices || []).map((c, idx) => ({
      index: c.index ?? idx,
      message: {
        role: 'assistant',
        content: c.message?.content ?? null,
        ...(c.message?.tool_calls ? { tool_calls: c.message.tool_calls } : {}),
      },
      finish_reason: c.finish_reason ?? 'stop',
    })),
    usage: response.usage
      ? {
          prompt_tokens: response.usage.prompt_tokens ?? 0,
          completion_tokens: response.usage.completion_tokens ?? 0,
          total_tokens: response.usage.total_tokens ?? (response.usage.prompt_tokens + response.usage.completion_tokens),
          prompt_tokens_details: response.usage.prompt_tokens_details,
          completion_tokens_details: response.usage.completion_tokens_details,
        }
      : undefined,
    system_fingerprint: response.system_fingerprint,
  };
}
