import {
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerMetrics,
} from './types.js';

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  successThreshold: 2,
  baseCooldownMs: 10000,
  maxCooldownMs: 60000,
  exponentialBackoff: true,
};

export class ProviderCircuitBreaker {
  private readonly provider: string;
  private readonly config: CircuitBreakerConfig;
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalTrips = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private cooldownEndsAt?: number;

  constructor(provider: string, configPartial: Partial<CircuitBreakerConfig> = {}) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...configPartial };
  }

  public getProvider(): string {
    return this.provider;
  }

  public getState(): CircuitState {
    this.evaluateState();
    return this.state;
  }

  public isAvailable(): boolean {
    this.evaluateState();
    return this.state === 'CLOSED' || this.state === 'HALF_OPEN';
  }

  public recordSuccess(): void {
    this.evaluateState();
    this.lastSuccessTime = Date.now();
    this.consecutiveFailures = 0;

    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        // Canary probes succeeded - close circuit
        this.state = 'CLOSED';
        this.consecutiveSuccesses = 0;
        this.cooldownEndsAt = undefined;
      }
    }
  }

  public recordFailure(error?: any): void {
    this.evaluateState();
    this.lastFailureTime = Date.now();
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;

    if (this.state === 'HALF_OPEN') {
      // Immediate re-trip on canary probe failure
      this.tripInternal();
      return;
    }

    if (this.state === 'CLOSED' && this.consecutiveFailures >= this.config.failureThreshold) {
      this.tripInternal();
    }
  }

  public trip(): void {
    this.tripInternal();
  }

  public reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.cooldownEndsAt = undefined;
  }

  public getMetrics(): CircuitBreakerMetrics {
    this.evaluateState();
    const now = Date.now();
    const remaining = this.cooldownEndsAt && this.cooldownEndsAt > now
      ? this.cooldownEndsAt - now
      : 0;

    return {
      provider: this.provider,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalTrips: this.totalTrips,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      cooldownEndsAt: this.cooldownEndsAt,
      cooldownRemainingMs: remaining,
    };
  }

  private tripInternal(): void {
    this.state = 'OPEN';
    this.totalTrips++;
    this.consecutiveSuccesses = 0;

    const multiplier = this.config.exponentialBackoff
      ? Math.pow(2, Math.max(0, this.totalTrips - 1))
      : 1;

    const cooldownMs = Math.min(
      this.config.baseCooldownMs * multiplier,
      this.config.maxCooldownMs
    );

    this.cooldownEndsAt = Date.now() + cooldownMs;
  }

  private evaluateState(): void {
    if (this.state === 'OPEN') {
      if (this.cooldownEndsAt && Date.now() >= this.cooldownEndsAt) {
        // Cooldown passed, transition to canary testing
        this.state = 'HALF_OPEN';
        this.consecutiveSuccesses = 0;
      }
    }
  }
}

export class ResilienceManager {
  private static instance: ResilienceManager;
  private breakers = new Map<string, ProviderCircuitBreaker>();
  private defaultConfig: CircuitBreakerConfig;

  private constructor(defaultConfig: Partial<CircuitBreakerConfig> = {}) {
    this.defaultConfig = { ...DEFAULT_CONFIG, ...defaultConfig };
  }

  public static getInstance(defaultConfig?: Partial<CircuitBreakerConfig>): ResilienceManager {
    if (!ResilienceManager.instance) {
      ResilienceManager.instance = new ResilienceManager(defaultConfig);
    }
    return ResilienceManager.instance;
  }

  public getBreaker(provider: string): ProviderCircuitBreaker {
    const key = provider.toLowerCase();
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = new ProviderCircuitBreaker(key, this.defaultConfig);
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  public isProviderAvailable(provider: string): boolean {
    return this.getBreaker(provider).isAvailable();
  }

  public recordSuccess(provider: string): void {
    this.getBreaker(provider).recordSuccess();
  }

  public recordFailure(provider: string, error?: any): void {
    this.getBreaker(provider).recordFailure(error);
  }

  public trip(provider: string): void {
    this.getBreaker(provider).trip();
  }

  public reset(provider: string): void {
    this.getBreaker(provider).reset();
  }

  public resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  public getAllMetrics(): Record<string, CircuitBreakerMetrics> {
    // Ensure standard providers are instantiated
    const knownProviders = ['openai', 'anthropic', 'gemini', 'deepseek'];
    for (const p of knownProviders) {
      this.getBreaker(p);
    }

    const result: Record<string, CircuitBreakerMetrics> = {};
    for (const [provider, breaker] of this.breakers.entries()) {
      result[provider] = breaker.getMetrics();
    }
    return result;
  }
}
