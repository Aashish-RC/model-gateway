import { ChatMessage, TokenUsage } from '../adapters/types.js';

export class TokenizerHelper {
  /**
   * Fast, reliable token estimation matching cl100k / tiktoken distribution.
   * Average English text is ~3.8 to 4 characters per token; code/special characters
   * have higher density.
   */
  public static estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0;

    const len = text.length;
    if (len <= 4) return 1;

    let nonAsciiCount = 0;
    for (let i = 0; i < Math.min(len, 200); i++) {
      if (text.charCodeAt(i) > 127) nonAsciiCount++;
    }

    const hasHighNonAscii = nonAsciiCount > 20;
    const charsPerToken = hasHighNonAscii ? 2.2 : 3.8;

    return Math.max(1, Math.ceil(len / charsPerToken));
  }

  /**
   * Computes prompt tokens for an array of chat messages, accounting for
   * per-message role delimiters and framing tokens.
   */
  public static estimatePromptTokens(messages: ChatMessage[]): number {
    if (!messages || messages.length === 0) return 0;

    let total = 2; // Primer tokens
    for (const msg of messages) {
      total += 4; // Per-message framing tokens
      if (typeof msg.content === 'string') {
        total += TokenizerHelper.estimateTokens(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            total += TokenizerHelper.estimateTokens(part.text);
          }
        }
      }
    }
    return total;
  }

  /**
   * Resolves final token usage, preferring exact provider-reported metrics
   * when available, and falling back to heuristic token estimation.
   */
  public static resolveUsage(
    reportedUsage?: Partial<TokenUsage>,
    messages?: ChatMessage[],
    completionText = ''
  ): TokenUsage {
    const promptTokens =
      reportedUsage?.prompt_tokens ??
      (messages ? TokenizerHelper.estimatePromptTokens(messages) : 0);

    const completionTokens =
      reportedUsage?.completion_tokens ??
      (completionText ? TokenizerHelper.estimateTokens(completionText) : 0);

    const totalTokens =
      reportedUsage?.total_tokens ?? (promptTokens + completionTokens);

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    };
  }
}
