import { KeyPool } from './pool.js';
import { KeySelectionStrategy, KeyPublicView } from './types.js';
import { AppConfig } from '../config/index.js';

export class SentinelEngine {
  private static instance: SentinelEngine;
  private pools: Map<string, KeyPool> = new Map();
  private recoveryIntervalId?: NodeJS.Timeout;

  private constructor() {
    // Initialized without background timer until startRecoveryLoop is called
  }

  public startRecoveryLoop(): void {
    if (!this.recoveryIntervalId) {
      this.recoveryIntervalId = setInterval(() => {
        this.checkAllRecoveries();
      }, 2000);
      this.recoveryIntervalId.unref?.();
    }
  }

  public static getInstance(): SentinelEngine {
    if (!SentinelEngine.instance) {
      SentinelEngine.instance = new SentinelEngine();
    }
    return SentinelEngine.instance;
  }

  public initFromConfig(config: AppConfig): void {
    for (const [providerName, pConfig] of Object.entries(config.providers)) {
      const pool = this.getOrCreatePool(providerName);
      for (const k of pConfig.keys) {
        pool.addKey(k.id, k.key, k.weight);
      }
    }
  }

  public getOrCreatePool(provider: string): KeyPool {
    const key = provider.toLowerCase();
    let pool = this.pools.get(key);
    if (!pool) {
      pool = new KeyPool(key);
      this.pools.set(key, pool);
    }
    return pool;
  }

  public addKey(provider: string, id: string, key: string, weight = 1): void {
    const pool = this.getOrCreatePool(provider);
    pool.addKey(id, key, weight);
  }

  public removeKey(provider: string, id: string): boolean {
    const pool = this.pools.get(provider.toLowerCase());
    return pool ? pool.removeKey(id) : false;
  }

  public async executeWithKeyRetry<T>(
    provider: string,
    action: (key: string, keyId: string) => Promise<T>,
    options: {
      strategy?: KeySelectionStrategy;
      maxRetries?: number;
    } = {}
  ): Promise<T> {
    const pool = this.getOrCreatePool(provider);
    const strategy = options.strategy ?? 'weighted';
    const maxRetries = options.maxRetries ?? 3;

    let attempts = 0;
    const triedKeyIds = new Set<string>();

    while (attempts < maxRetries) {
      attempts++;
      const acquired = pool.acquireKey(strategy);

      if (!acquired) {
        throw new Error(
          `All API keys for provider "${provider}" are currently cooling down or exhausted. Please try again shortly.`
        );
      }

      triedKeyIds.add(acquired.id);

      try {
        const result = await action(acquired.key, acquired.id);
        pool.releaseKey(acquired.id, true);
        return result;
      } catch (err: any) {
        const errMsg = err.message || '';
        const isRateLimit = errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit');
        const isTransient5xx =
          errMsg.includes('500') ||
          errMsg.includes('502') ||
          errMsg.includes('503') ||
          errMsg.includes('504');

        const statusCode = isRateLimit ? 429 : isTransient5xx ? 502 : undefined;

        // If rate limit or 5xx, place key on cooldown and retry with another key
        if (isRateLimit || isTransient5xx) {
          pool.releaseKey(acquired.id, false, statusCode, errMsg);

          // Check if there are other available keys to try
          const remainingKeys = pool.getAvailableKeys().filter((k) => !triedKeyIds.has(k.id));
          if (remainingKeys.length > 0 && attempts < maxRetries) {
            continue; // Retry transparently with next key
          }
        } else {
          // Non-retryable error (e.g. 400 Bad Request)
          pool.releaseKey(acquired.id, true);
        }

        throw err;
      }
    }

    throw new Error(`Exceeded maximum retry attempts (${maxRetries}) for provider "${provider}".`);
  }

  public checkAllRecoveries(): void {
    for (const pool of this.pools.values()) {
      pool.checkRecoveries();
    }
  }

  public getAllKeyViews(): KeyPublicView[] {
    const allViews: KeyPublicView[] = [];
    for (const pool of this.pools.values()) {
      allViews.push(...pool.getPublicViews());
    }
    return allViews;
  }

  public stop(): void {
    if (this.recoveryIntervalId) {
      clearInterval(this.recoveryIntervalId);
    }
  }
}
