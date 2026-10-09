export interface InjectionSignal {
  pattern: RegExp;
  weight: number;
  description: string;
}

export class InjectionDetector {
  private static readonly SIGNALS: InjectionSignal[] = [
    {
      pattern: /ignore\s+(all\s+)?(previous|prior)\s+(instructions|directives|prompts|rules)/i,
      weight: 0.85,
      description: 'Instruction override attempt',
    },
    {
      pattern: /(disregard|forget)\s+(all\s+)?(previous|past)\s+(context|instructions|rules|guidelines)/i,
      weight: 0.80,
      description: 'Instruction erasure attempt',
    },
    {
      pattern: /\b(DAN|do\s+anything\s+now|jailbreak\s+mode|unrestricted\s+ai|anti-gpt)\b/i,
      weight: 0.90,
      description: 'Known DAN / jailbreak persona persona invocation',
    },
    {
      pattern: /bypass\s+(all\s+)?(safety|content|security|policy|restrictions|filters)/i,
      weight: 0.85,
      description: 'Safety filter bypass attempt',
    },
    {
      pattern: /developer\s+mode\s+(is\s+)?(enabled|active|on)/i,
      weight: 0.75,
      description: 'Simulated developer mode override',
    },
    {
      pattern: /(print|repeat|show|reveal|output|display)\s+(your\s+)?(verbatim\s+)?(system\s+prompt|initial\s+instructions|hidden\s+prompt)/i,
      weight: 0.70,
      description: 'System prompt extraction attempt',
    },
    {
      pattern: /(<\|im_start\|>system|<\|system\|>|\[SYSTEM\s+PROMPT\]|```system)/i,
      weight: 0.85,
      description: 'Delimiter / role injection marker',
    },
    {
      pattern: /you\s+must\s+never\s+refuse\s+(any\s+)?request/i,
      weight: 0.65,
      description: 'Refusal negation constraint',
    },
  ];

  /**
   * Evaluate text for prompt injection / jailbreak attempts
   */
  public static evaluate(
    text: string,
    threshold = 0.70
  ): { isJailbreak: boolean; score: number; matchedSignals: string[] } {
    let maxWeight = 0;
    let accumulatedScore = 0;
    const matchedSignals: string[] = [];

    for (const signal of this.SIGNALS) {
      if (signal.pattern.test(text)) {
        matchedSignals.push(signal.description);
        if (signal.weight > maxWeight) {
          maxWeight = signal.weight;
        }
        accumulatedScore += signal.weight * 0.5;
      }
    }

    // Score is highest single signal weight plus combined boost, capped at 1.0
    const finalScore = Math.min(1.0, Math.round((maxWeight + accumulatedScore * 0.2) * 100) / 100);

    return {
      isJailbreak: finalScore >= threshold,
      score: finalScore,
      matchedSignals,
    };
  }
}
