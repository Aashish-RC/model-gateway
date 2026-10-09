import { UniversalChatRequest } from '../adapters/types.js';
import { ReasoningEffortLevel } from './types.js';

export class ReasoningTranslator {
  private static readonly EFFORT_TO_BUDGET: Record<ReasoningEffortLevel, number> = {
    low: 1024,
    medium: 2048,
    high: 4096,
  };

  /**
   * Translate reasoning parameters based on target provider
   */
  public static translate(
    req: UniversalChatRequest,
    targetProvider: string
  ): { req: UniversalChatRequest; translated: boolean } {
    const raw = req as any;
    const cloned = { ...req } as any;

    const hasEffort = Boolean(raw.reasoning_effort);
    const hasThinking = Boolean(raw.thinking?.budget_tokens);
    const hasThinkingConfig = Boolean(raw.thinkingConfig?.thinkingBudget);

    if (!hasEffort && !hasThinking && !hasThinkingConfig) {
      return { req, translated: false };
    }

    // Determine normalized budget & effort
    let budget = 2048;
    let effort: ReasoningEffortLevel = 'medium';

    if (hasEffort) {
      effort = raw.reasoning_effort;
      budget = this.EFFORT_TO_BUDGET[effort] || 2048;
    } else if (hasThinking) {
      budget = raw.thinking.budget_tokens;
      effort = budget <= 1024 ? 'low' : budget <= 2500 ? 'medium' : 'high';
    } else if (hasThinkingConfig) {
      budget = raw.thinkingConfig.thinkingBudget;
      effort = budget <= 1024 ? 'low' : budget <= 2500 ? 'medium' : 'high';
    }

    if (targetProvider === 'anthropic') {
      cloned.thinking = { type: 'enabled', budget_tokens: budget };
      delete cloned.reasoning_effort;
      delete cloned.thinkingConfig;
    } else if (targetProvider === 'gemini') {
      cloned.thinkingConfig = { thinkingBudget: budget };
      delete cloned.reasoning_effort;
      delete cloned.thinking;
    } else if (targetProvider === 'openai') {
      cloned.reasoning_effort = effort;
      delete cloned.thinking;
      delete cloned.thinkingConfig;
    }

    return { req: cloned, translated: true };
  }
}
