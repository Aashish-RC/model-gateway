import { KeyEntity, KeySelectionStrategy, CooldownOptions, KeyPublicView } from './types.js';

export class KeyPool {
  readonly provider: string;
  private keys: Map<string, KeyEntity> = new Map();
  private roundRobinIndex = -1;
  private cooldownOptions: CooldownOptions;

  constructor(
    provider: string,
    initialKeys: Array<{ id: string; key: string; weight?: number }> = [],
    cooldownOptions: Partial<CooldownOptions> = {}
  ) {
    this.provider = provider.toLowerCase();
    this.cooldownOptions = {
      baseCooldownMs: cooldownOptions.baseCooldownMs ?? 5000,
      maxCooldownMs: cooldownOptions.maxCooldownMs ?? 300000,
      jitterRatio: cooldownOptions.jitterRatio ?? 0.2,
    };

    for (const k of initialKeys) {
      this.addKey(k.id, k.key, k.weight ?? 1);
    }
  }

  public addKey(id: string, key: string, weight = 1): void {
    this.keys.set(id, {
      id,
      provider: this.provider,
      key,
      weight: Math.max(1, weight),
      inFlightRequests: 0,
      totalRequests: 0,
      consecutiveFailures: 0,
      isHealthy: true,
      lastUsedAt: 0,
    });
  }

  public removeKey(id: string): boolean {
    return this.keys.delete(id);
  }

  public getAvailableKeys(now = Date.now()): KeyEntity[] {
    const available: KeyEntity[] = [];
    for (const k of this.keys.values()) {
      if (!k.isHealthy) continue;

      if (k.cooldownUntil && k.cooldownUntil > now) {
        // Still cooling down
        continue;
      }

      // If cooldown expired, clear it
      if (k.cooldownUntil && k.cooldownUntil <= now) {
        k.cooldownUntil = undefined;
        k.cooldownReason = undefined;
      }

      available.push(k);
    }
    return available;
  }

  public acquireKey(strategy: KeySelectionStrategy = 'weighted'): KeyEntity | null {
    const available = this.getAvailableKeys();
    if (available.length === 0) {
      return null;
    }

    let selected: KeyEntity;

    switch (strategy) {
      case 'least-busy': {
        // Pick key with lowest active concurrent in-flight requests
        selected = available.reduce((min, curr) =>
          curr.inFlightRequests < min.inFlightRequests ? curr : min
        );
        break;
      }
      case 'round-robin': {
        this.roundRobinIndex = (this.roundRobinIndex + 1) % available.length;
        selected = available[this.roundRobinIndex];
        break;
      }
      case 'weighted':
      default: {
        // Weighted selection
        const totalWeight = available.reduce((sum, k) => sum + k.weight, 0);
        let randomVal = Math.random() * totalWeight;
        selected = available[0];

        for (const k of available) {
          randomVal -= k.weight;
          if (randomVal <= 0) {
            selected = k;
            break;
          }
        }
        break;
      }
    }

    selected.inFlightRequests++;
    selected.totalRequests++;
    selected.lastUsedAt = Date.now();
    return selected;
  }

  public releaseKey(keyId: string, success: boolean, statusCode?: number, errorReason?: string): void {
    const key = this.keys.get(keyId);
    if (!key) return;

    key.inFlightRequests = Math.max(0, key.inFlightRequests - 1);

    if (success) {
      this.markKeySuccess(key);
    } else {
      this.markKeyFailure(key, statusCode, errorReason);
    }
  }

  public markKeySuccess(key: KeyEntity): void {
    key.consecutiveFailures = 0;
    key.cooldownUntil = undefined;
    key.cooldownReason = undefined;
  }

  public markKeyFailure(key: KeyEntity, statusCode?: number, reason?: string): void {
    key.consecutiveFailures++;

    // Calculate exponential backoff cooldown with jitter
    const exponent = Math.max(0, key.consecutiveFailures - 1);
    let backoff = this.cooldownOptions.baseCooldownMs * Math.pow(2, exponent);
    backoff = Math.min(this.cooldownOptions.maxCooldownMs, backoff);

    // Apply random jitter (e.g. +/- 20%)
    const jitter = (Math.random() * 2 - 1) * this.cooldownOptions.jitterRatio * backoff;
    const finalCooldownMs = Math.max(1000, Math.round(backoff + jitter));

    const now = Date.now();
    key.cooldownUntil = now + finalCooldownMs;
    key.cooldownReason = reason || (statusCode ? `HTTP ${statusCode}` : 'Unknown upstream failure');
  }

  public checkRecoveries(now = Date.now()): number {
    let recoveredCount = 0;
    for (const k of this.keys.values()) {
      if (k.cooldownUntil && k.cooldownUntil <= now) {
        k.cooldownUntil = undefined;
        k.cooldownReason = undefined;
        recoveredCount++;
      }
    }
    return recoveredCount;
  }

  public getPublicViews(now = Date.now()): KeyPublicView[] {
    const views: KeyPublicView[] = [];
    for (const k of this.keys.values()) {
      const isCoolingDown = Boolean(k.cooldownUntil && k.cooldownUntil > now);
      const remainingSec = isCoolingDown && k.cooldownUntil
        ? Math.max(0, Math.ceil((k.cooldownUntil - now) / 1000))
        : 0;

      const masked = k.key.length > 10
        ? `${k.key.slice(0, 6)}******${k.key.slice(-4)}`
        : '******';

      views.push({
        id: k.id,
        provider: k.provider,
        maskedKey: masked,
        weight: k.weight,
        inFlightRequests: k.inFlightRequests,
        totalRequests: k.totalRequests,
        consecutiveFailures: k.consecutiveFailures,
        isHealthy: k.isHealthy,
        isCoolingDown,
        cooldownRemainingSeconds: remainingSec,
        cooldownReason: k.cooldownReason,
      });
    }
    return views;
  }

  public getKeyCount(): number {
    return this.keys.size;
  }
}
