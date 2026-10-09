import { ModelPricingRate, CostCalculationResult } from './types.js';

export const DEFAULT_MODEL_PRICING: Record<string, ModelPricingRate> = {
  // OpenAI
  'gpt-4o': {
    provider: 'openai',
    inputPerMillion: 2.50,
    outputPerMillion: 10.00,
    cacheReadPerMillion: 1.25,
  },
  'gpt-4o-mini': {
    provider: 'openai',
    inputPerMillion: 0.15,
    outputPerMillion: 0.60,
    cacheReadPerMillion: 0.075,
  },
  'o1-preview': {
    provider: 'openai',
    inputPerMillion: 15.00,
    outputPerMillion: 60.00,
  },
  'o1-mini': {
    provider: 'openai',
    inputPerMillion: 3.00,
    outputPerMillion: 12.00,
  },
  'o3-mini': {
    provider: 'openai',
    inputPerMillion: 1.10,
    outputPerMillion: 4.40,
  },
  'gpt-4-turbo': {
    provider: 'openai',
    inputPerMillion: 10.00,
    outputPerMillion: 30.00,
  },

  // Anthropic
  'claude-3-5-sonnet-20241022': {
    provider: 'anthropic',
    inputPerMillion: 3.00,
    outputPerMillion: 15.00,
    cacheReadPerMillion: 0.30,
  },
  'claude-3-5-sonnet': {
    provider: 'anthropic',
    inputPerMillion: 3.00,
    outputPerMillion: 15.00,
    cacheReadPerMillion: 0.30,
  },
  'claude-3-5-haiku-20241022': {
    provider: 'anthropic',
    inputPerMillion: 0.80,
    outputPerMillion: 4.00,
    cacheReadPerMillion: 0.08,
  },
  'claude-3-5-haiku': {
    provider: 'anthropic',
    inputPerMillion: 0.80,
    outputPerMillion: 4.00,
    cacheReadPerMillion: 0.08,
  },
  'claude-3-opus-20240229': {
    provider: 'anthropic',
    inputPerMillion: 15.00,
    outputPerMillion: 75.00,
  },

  // Google
  'gemini-1.5-pro': {
    provider: 'gemini',
    inputPerMillion: 1.25,
    outputPerMillion: 5.00,
  },
  'gemini-1.5-flash': {
    provider: 'gemini',
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
  'gemini-2.0-flash-exp': {
    provider: 'gemini',
    inputPerMillion: 0.00,
    outputPerMillion: 0.00,
  },

  // DeepSeek
  'deepseek-chat': {
    provider: 'deepseek',
    inputPerMillion: 0.14,
    outputPerMillion: 0.28,
    cacheReadPerMillion: 0.014,
  },
  'deepseek-reasoner': {
    provider: 'deepseek',
    inputPerMillion: 0.55,
    outputPerMillion: 2.19,
    cacheReadPerMillion: 0.14,
  },
};

const DEFAULT_FALLBACK_RATE: ModelPricingRate = {
  provider: 'generic',
  inputPerMillion: 1.00,
  outputPerMillion: 3.00,
};

export class PricingEngine {
  private static instance: PricingEngine;
  private pricingCatalog: Map<string, ModelPricingRate>;

  private constructor() {
    this.pricingCatalog = new Map(Object.entries(DEFAULT_MODEL_PRICING));
  }

  public static getInstance(): PricingEngine {
    if (!PricingEngine.instance) {
      PricingEngine.instance = new PricingEngine();
    }
    return PricingEngine.instance;
  }

  public getRate(model: string): ModelPricingRate {
    const key = model.toLowerCase();
    // Direct match
    if (this.pricingCatalog.has(key)) {
      return this.pricingCatalog.get(key)!;
    }

    // Prefix match
    for (const [k, rate] of this.pricingCatalog.entries()) {
      if (key.includes(k) || k.includes(key)) {
        return rate;
      }
    }

    return DEFAULT_FALLBACK_RATE;
  }

  public calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
    cacheReadTokens = 0
  ): CostCalculationResult {
    const rate = this.getRate(model);

    const normalPromptTokens = Math.max(0, promptTokens - cacheReadTokens);
    const promptCost = (normalPromptTokens * rate.inputPerMillion) / 1_000_000;
    const cacheCost = rate.cacheReadPerMillion
      ? (cacheReadTokens * rate.cacheReadPerMillion) / 1_000_000
      : 0;

    const completionCost = (completionTokens * rate.outputPerMillion) / 1_000_000;
    const totalCost = Number((promptCost + cacheCost + completionCost).toFixed(7));

    return {
      promptCost: Number((promptCost + cacheCost).toFixed(7)),
      completionCost: Number(completionCost.toFixed(7)),
      totalCost,
      currency: 'USD',
      model,
      provider: rate.provider,
    };
  }

  public setRate(model: string, rate: ModelPricingRate): void {
    this.pricingCatalog.set(model.toLowerCase(), rate);
  }

  public getAllRates(): Record<string, ModelPricingRate> {
    const rates: Record<string, ModelPricingRate> = {};
    for (const [k, v] of this.pricingCatalog.entries()) {
      rates[k] = v;
    }
    return rates;
  }
}
