import { RouteLlmConfig, RouteTarget, RoutingDecision } from './types.js';
import { ChatMessage } from '../adapters/types.js';

export class RouteLlmEngine {
  private config: RouteLlmConfig;

  constructor(customConfig?: Partial<RouteLlmConfig>) {
    this.config = {
      strongModel: customConfig?.strongModel ?? {
        provider: 'openai',
        model: 'gpt-4o',
      },
      weakModel: customConfig?.weakModel ?? {
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
      threshold: customConfig?.threshold ?? 0.5,
    };
  }

  public setConfig(updated: Partial<RouteLlmConfig>): void {
    this.config = {
      ...this.config,
      ...updated,
    };
  }

  public getConfig(): RouteLlmConfig {
    return { ...this.config };
  }

  /**
   * Scores query complexity on a 0.0 to 1.0 scale based on RouteLLM heuristics:
   * 1. Length & token density
   * 2. Code detection & syntax keywords
   * 3. Mathematical & multi-hop analytical reasoning keywords
   */
  public calculateComplexity(messages: ChatMessage[]): number {
    if (!messages || messages.length === 0) return 0.1;

    let fullText = '';
    for (const m of messages) {
      if (typeof m.content === 'string') {
        fullText += m.content + '\n';
      } else if (Array.isArray(m.content)) {
        for (const p of m.content) {
          if (p.type === 'text' && p.text) fullText += p.text + '\n';
        }
      }
    }

    const trimmed = fullText.trim();
    if (!trimmed) return 0.1;

    let score = 0;

    // 1. Length & volume heuristics
    const charLen = trimmed.length;
    if (charLen > 2500) score += 0.35;
    else if (charLen > 1000) score += 0.25;
    else if (charLen > 300) score += 0.15;
    else score += 0.05;

    // 2. Code & technical pattern detection
    const hasCodeBlock = /```[\s\S]*?```/.test(trimmed);
    const codeKeywords = /\b(function|def|class|interface|import|const|let|return|async|await|SELECT|WHERE|GROUP BY|INSERT|UPDATE|docker|regex|algorithm|refactor|compile|debug)\b/i;
    const codeMatchCount = (trimmed.match(codeKeywords) || []).length;

    if (hasCodeBlock) score += 0.3;
    else if (codeMatchCount >= 3) score += 0.25;
    else if (codeMatchCount >= 1) score += 0.1;

    // 3. Complex reasoning, math & multi-hop indicators
    const reasoningKeywords = /\b(prove|step-by-step|calculate|derive|differentiate|integrate|solve|logic|paradox|hypothetical|architect|compare and contrast|critique|trade-offs|root cause|benchmark)\b/i;
    const mathSymbols = /([∑∫√π^±≤≥≠×÷=]|\\frac|\\sqrt)/;
    const reasoningCount = (trimmed.match(reasoningKeywords) || []).length;

    if (mathSymbols.test(trimmed)) score += 0.25;
    if (reasoningCount >= 3) score += 0.3;
    else if (reasoningCount >= 1) score += 0.15;

    // 4. Constraint & instruction density
    const constraintKeywords = /\b(must not|strictly|only return|format as json|schema|deterministic|never)\b/i;
    if (constraintKeywords.test(trimmed)) score += 0.1;

    // Clamp score strictly between 0.0 and 1.0
    return Math.min(1.0, Math.max(0.0, Math.round(score * 100) / 100));
  }

  /**
   * Route request to strong or weak model based on calibrated threshold
   */
  public evaluate(messages: ChatMessage[], thresholdOverride?: number): {
    decision: RouteTarget;
    score: number;
    threshold: number;
    reason: string;
  } {
    const threshold = thresholdOverride ?? this.config.threshold;
    const score = this.calculateComplexity(messages);

    if (score >= threshold) {
      return {
        decision: this.config.strongModel,
        score,
        threshold,
        reason: `RouteLLM: High complexity (${score} >= ${threshold}), routed to strong frontier model (${this.config.strongModel.model})`,
      };
    } else {
      return {
        decision: this.config.weakModel,
        score,
        threshold,
        reason: `RouteLLM: Moderate/low complexity (${score} < ${threshold}), routed to efficient cost-saver model (${this.config.weakModel.model})`,
      };
    }
  }

  /**
   * Checks if requested model matches a RouteLLM virtual alias:
   * e.g., 'router-pareto', 'router-pareto-0.4', 'router-cost', 'router-quality'
   */
  public isRouteLlmVirtualModel(model: string): boolean {
    const lower = model.toLowerCase();
    return (
      lower.startsWith('router-') ||
      lower === 'auto' ||
      lower === 'routellm'
    );
  }

  public parseVirtualModelThreshold(model: string): number | undefined {
    const lower = model.toLowerCase();
    if (lower === 'router-cost' || lower === 'router-cost-saver') return 0.8; // mostly weak model
    if (lower === 'router-quality' || lower === 'router-frontier') return 0.2; // mostly strong model

    const match = lower.match(/^router-(?:pareto-)?([0-9\.]+)$/);
    if (match) {
      const val = parseFloat(match[1]);
      if (!isNaN(val) && val >= 0 && val <= 1) return val;
    }
    return undefined;
  }
}
