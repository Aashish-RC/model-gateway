import { RouteLlmEngine } from './routellm.js';
import { FallbackMatrix } from './matrix.js';
import { RouteTarget, RoutingDecision, RouterStats } from './types.js';
import { UniversalChatRequest } from '../adapters/types.js';
import { AppConfig } from '../config/index.js';

export class RouterOrchestrator {
  private static instance: RouterOrchestrator;
  private routeLlm: RouteLlmEngine;
  private fallbackMatrix: FallbackMatrix;
  private stats: RouterStats = {
    totalRouted: 0,
    strongModelCount: 0,
    weakModelCount: 0,
    fallbacksTriggered: 0,
    costSavingsEstimatedPercent: 0,
  };

  private constructor() {
    this.routeLlm = new RouteLlmEngine();
    this.fallbackMatrix = new FallbackMatrix();
  }

  public static getInstance(): RouterOrchestrator {
    if (!RouterOrchestrator.instance) {
      RouterOrchestrator.instance = new RouterOrchestrator();
    }
    return RouterOrchestrator.instance;
  }

  public initFromConfig(config: AppConfig): void {
    if (config.routing?.fallbackProviders) {
      this.fallbackMatrix = new FallbackMatrix(config.routing.fallbackProviders);
    }
  }

  public resolveRouting(
    request: UniversalChatRequest,
    options: {
      providerHeader?: string;
      enableRouteLlm?: boolean;
      thresholdOverride?: number;
    } = {}
  ): RoutingDecision {
    this.stats.totalRouted++;
    const requestedModel = request.model;
    const isRouteLlmRequested =
      options.enableRouteLlm ||
      this.routeLlm.isRouteLlmVirtualModel(requestedModel) ||
      requestedModel.startsWith('router-');

    if (isRouteLlmRequested) {
      const thresholdFromModel = this.routeLlm.parseVirtualModelThreshold(requestedModel);
      const effectiveThreshold = options.thresholdOverride ?? thresholdFromModel ?? 0.5;

      const evalResult = this.routeLlm.evaluate(request.messages, effectiveThreshold);
      const isStrong = evalResult.decision.model === this.routeLlm.getConfig().strongModel.model;

      if (isStrong) {
        this.stats.strongModelCount++;
      } else {
        this.stats.weakModelCount++;
      }

      this.updateSavingsPercent();

      const cascade = this.fallbackMatrix.getCascadeChain(evalResult.decision);

      return {
        targetProvider: evalResult.decision.provider,
        targetModel: evalResult.decision.model,
        reason: evalResult.reason,
        strategy: 'routellm-pareto',
        cascadeChain: cascade,
        score: evalResult.score,
        routedViaRouteLlm: true,
      };
    }

    // Direct model request
    const detectedProvider = this.inferProvider(requestedModel, options.providerHeader);
    const primaryTarget: RouteTarget = {
      provider: detectedProvider,
      model: requestedModel,
    };

    const cascade = this.fallbackMatrix.getCascadeChain(primaryTarget);

    return {
      targetProvider: primaryTarget.provider,
      targetModel: primaryTarget.model,
      reason: `Direct model target: ${primaryTarget.provider}/${primaryTarget.model}`,
      strategy: 'fallback-cascade',
      cascadeChain: cascade,
      routedViaRouteLlm: false,
    };
  }

  public inferProvider(model: string, explicitHeader?: string): string {
    if (explicitHeader) return explicitHeader.toLowerCase();

    const lower = model.toLowerCase();
    if (lower.startsWith('claude') || lower.includes('anthropic')) return 'anthropic';
    if (lower.startsWith('gemini') || lower.includes('google') || lower.startsWith('models/gemini')) return 'gemini';
    if (lower.startsWith('deepseek')) return 'deepseek';
    if (
      lower.startsWith('gpt') ||
      lower.startsWith('o1') ||
      lower.startsWith('o3') ||
      lower.startsWith('text-embedding')
    ) {
      return 'openai';
    }

    return 'openai';
  }

  public recordFallbackTriggered(): void {
    this.stats.fallbacksTriggered++;
  }

  public getStats(): RouterStats {
    return { ...this.stats };
  }

  public getRouteLlm(): RouteLlmEngine {
    return this.routeLlm;
  }

  public getFallbackMatrix(): FallbackMatrix {
    return this.fallbackMatrix;
  }

  private updateSavingsPercent(): void {
    const total = this.stats.strongModelCount + this.stats.weakModelCount;
    if (total === 0) return;
    // Assuming weak model is ~80% cheaper than strong model
    const weakRatio = this.stats.weakModelCount / total;
    this.stats.costSavingsEstimatedPercent = Math.round(weakRatio * 75);
  }
}
