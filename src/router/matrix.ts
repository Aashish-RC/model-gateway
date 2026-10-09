import { FallbackRouteDefinition, RouteTarget } from './types.js';

export class FallbackMatrix {
  private routes = new Map<string, FallbackRouteDefinition>();
  private defaultFallbacks: RouteTarget[];
  private retryableStatusCodes: Set<number>;

  constructor(
    defaultFallbackProviders: string[] = ['anthropic', 'gemini'],
    retryableStatusCodes: number[] = [429, 500, 502, 503, 504]
  ) {
    this.retryableStatusCodes = new Set(retryableStatusCodes);
    this.defaultFallbacks = defaultFallbackProviders.map((p) => this.getDefaultTargetForProvider(p));
    this.initializeDefaultRoutes();
  }

  private getDefaultTargetForProvider(provider: string): RouteTarget {
    switch (provider.toLowerCase()) {
      case 'anthropic':
        return { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' };
      case 'gemini':
      case 'google':
        return { provider: 'gemini', model: 'gemini-1.5-pro' };
      case 'deepseek':
        return { provider: 'deepseek', model: 'deepseek-chat' };
      case 'openai':
      default:
        return { provider: 'openai', model: 'gpt-4o' };
    }
  }

  private initializeDefaultRoutes() {
    this.registerRoute('openai', {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'gemini', model: 'gemini-1.5-pro' },
      ],
    });

    this.registerRoute('anthropic', {
      primary: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'gemini', model: 'gemini-1.5-pro' },
      ],
    });

    this.registerRoute('gemini', {
      primary: { provider: 'gemini', model: 'gemini-1.5-pro' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      ],
    });

    this.registerRoute('deepseek', {
      primary: { provider: 'deepseek', model: 'deepseek-chat' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o-mini' },
        { provider: 'gemini', model: 'gemini-1.5-flash' },
      ],
    });
  }

  public registerRoute(key: string, definition: FallbackRouteDefinition): void {
    this.routes.set(key.toLowerCase(), definition);
  }

  public getCascadeChain(primaryTarget: RouteTarget): RouteTarget[] {
    const key = primaryTarget.provider.toLowerCase();
    const route = this.routes.get(key);

    const chain: RouteTarget[] = [primaryTarget];

    if (route && route.fallbacks.length > 0) {
      for (const fb of route.fallbacks) {
        if (fb.provider.toLowerCase() !== primaryTarget.provider.toLowerCase()) {
          chain.push(fb);
        }
      }
    } else {
      for (const fb of this.defaultFallbacks) {
        if (fb.provider.toLowerCase() !== primaryTarget.provider.toLowerCase()) {
          chain.push(fb);
        }
      }
    }

    return chain;
  }

  public isRetryableError(statusCode?: number, errorMessage = ''): boolean {
    if (statusCode && this.retryableStatusCodes.has(statusCode)) return true;
    const lower = errorMessage.toLowerCase();
    return (
      lower.includes('429') ||
      lower.includes('rate limit') ||
      lower.includes('500') ||
      lower.includes('502') ||
      lower.includes('503') ||
      lower.includes('504') ||
      lower.includes('service unavailable') ||
      lower.includes('overloaded') ||
      lower.includes('timeout')
    );
  }
}
