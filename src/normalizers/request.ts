import { UniversalChatRequest, ChatMessage } from '../adapters/types.js';

export function normalizeRequest(raw: unknown): UniversalChatRequest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid request payload: must be a JSON object');
  }

  const body = raw as Record<string, any>;

  if (!body.model || typeof body.model !== 'string') {
    throw new Error('Invalid request payload: "model" is required and must be a string');
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error('Invalid request payload: "messages" must be a non-empty array');
  }

  const normalizedMessages: ChatMessage[] = body.messages.map((m: any, idx: number) => {
    if (!m || typeof m !== 'object') {
      throw new Error(`Invalid message at index ${idx}: must be an object`);
    }
    const role = m.role;
    if (!role || typeof role !== 'string') {
      throw new Error(`Invalid message at index ${idx}: "role" is required`);
    }

    return {
      role: role as any,
      content: m.content ?? '',
      name: m.name,
      tool_call_id: m.tool_call_id,
      tool_calls: m.tool_calls,
    };
  });

  let reasoningEffort = body.reasoning_effort;
  if (reasoningEffort && !['low', 'medium', 'high', 'none'].includes(reasoningEffort)) {
    reasoningEffort = undefined;
  }

  return {
    ...body,
    model: body.model,
    messages: normalizedMessages,
    stream: Boolean(body.stream),
    reasoning_effort: reasoningEffort,
  };
}
