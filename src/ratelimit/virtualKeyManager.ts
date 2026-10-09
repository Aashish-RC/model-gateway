import crypto from 'node:crypto';
import {
  VirtualKey,
  VirtualKeyView,
  VirtualKeyStatus,
  RateLimitCheckResult,
  CreateVirtualKeyParams,
  UpdateVirtualKeyParams,
} from './types.js';
import { SlidingWindowCounter } from './slidingWindow.js';

export class VirtualKeyManager {
  private static instance: VirtualKeyManager | null = null;

  private keysById = new Map<string, VirtualKey>();
  private idByKeyToken = new Map<string, string>();
  private countersByKeyId = new Map<string, SlidingWindowCounter>();

  private constructor() {
    this.seedDefaultKeys();
  }

  public static getInstance(): VirtualKeyManager {
    if (!VirtualKeyManager.instance) {
      VirtualKeyManager.instance = new VirtualKeyManager();
    }
    return VirtualKeyManager.instance;
  }

  private seedDefaultKeys(): void {
    this.createKey({
      customKey: 'sk-gw-prod-team-alpha',
      name: 'Production Core Service',
      rpmLimit: 120,
      tpmLimit: 150000,
      maxBudgetUsd: 100.0,
      allowedModels: ['*'],
    });

    this.createKey({
      customKey: 'sk-gw-mobile-client',
      name: 'Mobile App Tier',
      rpmLimit: 30,
      tpmLimit: 40000,
      maxBudgetUsd: 25.0,
      allowedModels: ['gpt-4o-mini', 'gemini-1.5-flash', 'claude-3-5-haiku', 'router-cost-saver'],
    });

    this.createKey({
      customKey: 'sk-gw-analytics-batch',
      name: 'Internal Analytics Batch',
      rpmLimit: 15,
      tpmLimit: 20000,
      maxBudgetUsd: 10.0,
      allowedModels: ['*'],
    });

    const exhaustedKey = this.createKey({
      customKey: 'sk-gw-demo-exhausted',
      name: 'Exhausted Quota Demo',
      rpmLimit: 60,
      tpmLimit: 50000,
      maxBudgetUsd: 5.0,
      allowedModels: ['*'],
    });
    exhaustedKey.currentSpendUsd = 5.0;
    exhaustedKey.status = 'exhausted';
  }

  public createKey(params: CreateVirtualKeyParams): VirtualKey {
    const id = 'vk-' + crypto.randomBytes(4).toString('hex');
    const keyToken =
      params.customKey || `sk-gw-${crypto.randomBytes(12).toString('hex')}`;

    const newKey: VirtualKey = {
      id,
      key: keyToken,
      name: params.name,
      rpmLimit: params.rpmLimit ?? 60,
      tpmLimit: params.tpmLimit ?? 100000,
      maxBudgetUsd: params.maxBudgetUsd,
      currentSpendUsd: 0,
      allowedModels: params.allowedModels && params.allowedModels.length > 0 ? params.allowedModels : ['*'],
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    this.keysById.set(id, newKey);
    this.idByKeyToken.set(keyToken, id);
    this.countersByKeyId.set(id, new SlidingWindowCounter());

    return newKey;
  }

  public getKeyByToken(keyToken: string): VirtualKey | null {
    const id = this.idByKeyToken.get(keyToken);
    if (!id) return null;
    return this.keysById.get(id) ?? null;
  }

  public getKeyById(id: string): VirtualKey | null {
    return this.keysById.get(id) ?? null;
  }

  public validateAndReserve(
    keyToken: string,
    requestedModel: string,
    estimatedTokens = 0
  ): RateLimitCheckResult {
    const key = this.getKeyByToken(keyToken);
    if (!key) {
      return {
        allowed: false,
        reason: 'key_not_found',
        retryAfterSeconds: 0,
        limitRequests: 0,
        remainingRequests: 0,
        limitTokens: 0,
        remainingTokens: 0,
        resetSeconds: 0,
      };
    }

    if (key.status === 'revoked') {
      return {
        allowed: false,
        reason: 'key_revoked',
        retryAfterSeconds: 0,
        limitRequests: key.rpmLimit,
        remainingRequests: 0,
        limitTokens: key.tpmLimit,
        remainingTokens: 0,
        resetSeconds: 0,
      };
    }

    // Budget Cap Enforcement
    if (
      key.status === 'exhausted' ||
      (key.maxBudgetUsd != null && key.currentSpendUsd >= key.maxBudgetUsd)
    ) {
      key.status = 'exhausted';
      return {
        allowed: false,
        reason: 'budget_exceeded',
        retryAfterSeconds: 3600,
        limitRequests: key.rpmLimit,
        remainingRequests: 0,
        limitTokens: key.tpmLimit,
        remainingTokens: 0,
        resetSeconds: 3600,
      };
    }

    // Model Whitelist Permission Check
    if (
      !key.allowedModels.includes('*') &&
      !key.allowedModels.includes(requestedModel)
    ) {
      return {
        allowed: false,
        reason: 'model_not_allowed',
        retryAfterSeconds: 0,
        limitRequests: key.rpmLimit,
        remainingRequests: key.rpmLimit,
        limitTokens: key.tpmLimit,
        remainingTokens: key.tpmLimit,
        resetSeconds: 0,
      };
    }

    // Sliding Window Rate Limiting (RPM and TPM)
    const counter = this.countersByKeyId.get(key.id);
    if (!counter) {
      return {
        allowed: true,
        retryAfterSeconds: 0,
        limitRequests: key.rpmLimit,
        remainingRequests: key.rpmLimit,
        limitTokens: key.tpmLimit,
        remainingTokens: key.tpmLimit,
        resetSeconds: 60,
      };
    }

    const { currentRequests, currentTokens } = counter.getUsage();

    if (currentRequests >= key.rpmLimit) {
      const retryAfter = counter.getRetryAfterSeconds();
      return {
        allowed: false,
        reason: 'rpm_limit_exceeded',
        retryAfterSeconds: retryAfter,
        limitRequests: key.rpmLimit,
        remainingRequests: 0,
        limitTokens: key.tpmLimit,
        remainingTokens: Math.max(0, key.tpmLimit - currentTokens),
        resetSeconds: retryAfter,
      };
    }

    if (currentTokens + estimatedTokens > key.tpmLimit) {
      const retryAfter = counter.getRetryAfterSeconds();
      return {
        allowed: false,
        reason: 'tpm_limit_exceeded',
        retryAfterSeconds: retryAfter,
        limitRequests: key.rpmLimit,
        remainingRequests: Math.max(0, key.rpmLimit - currentRequests),
        limitTokens: key.tpmLimit,
        remainingTokens: 0,
        resetSeconds: retryAfter,
      };
    }

    const remainingReq = Math.max(0, key.rpmLimit - (currentRequests + 1));
    const remainingTok = Math.max(0, key.tpmLimit - (currentTokens + estimatedTokens));

    return {
      allowed: true,
      retryAfterSeconds: 0,
      limitRequests: key.rpmLimit,
      remainingRequests: remainingReq,
      limitTokens: key.tpmLimit,
      remainingTokens: remainingTok,
      resetSeconds: 60,
    };
  }

  public recordUsage(keyToken: string, actualTokens: number, costUsd: number): void {
    const key = this.getKeyByToken(keyToken);
    if (!key) return;

    const counter = this.countersByKeyId.get(key.id);
    if (counter) {
      counter.record(1, actualTokens);
    }

    key.currentSpendUsd = Number((key.currentSpendUsd + costUsd).toFixed(6));
    key.lastUsedAt = new Date().toISOString();

    if (key.maxBudgetUsd != null && key.currentSpendUsd >= key.maxBudgetUsd) {
      key.status = 'exhausted';
    }
  }

  public updateKey(id: string, updates: UpdateVirtualKeyParams): VirtualKey | null {
    const key = this.keysById.get(id);
    if (!key) return null;

    if (updates.name !== undefined) key.name = updates.name;
    if (updates.rpmLimit !== undefined) key.rpmLimit = updates.rpmLimit;
    if (updates.tpmLimit !== undefined) key.tpmLimit = updates.tpmLimit;
    if (updates.maxBudgetUsd !== undefined) key.maxBudgetUsd = updates.maxBudgetUsd;
    if (updates.allowedModels !== undefined) key.allowedModels = updates.allowedModels;
    if (updates.status !== undefined) key.status = updates.status;

    // Reactivate if budget was increased
    if (
      key.status === 'exhausted' &&
      key.maxBudgetUsd != null &&
      key.currentSpendUsd < key.maxBudgetUsd
    ) {
      key.status = 'active';
    }

    return key;
  }

  public revokeKey(id: string): boolean {
    const key = this.keysById.get(id);
    if (!key) return false;
    key.status = 'revoked';
    return true;
  }

  public deleteKey(id: string): boolean {
    const key = this.keysById.get(id);
    if (!key) return false;
    this.idByKeyToken.delete(key.key);
    this.countersByKeyId.delete(id);
    return this.keysById.delete(id);
  }

  public listKeys(): VirtualKeyView[] {
    const result: VirtualKeyView[] = [];

    for (const key of this.keysById.values()) {
      const counter = this.countersByKeyId.get(key.id);
      const usage = counter?.getUsage() ?? { currentRequests: 0, currentTokens: 0 };

      let budgetPct: number | undefined;
      if (key.maxBudgetUsd && key.maxBudgetUsd > 0) {
        budgetPct = Math.min(100, Number(((key.currentSpendUsd / key.maxBudgetUsd) * 100).toFixed(1)));
      }

      result.push({
        id: key.id,
        name: key.name,
        maskedKey: this.maskKey(key.key),
        rpmLimit: key.rpmLimit,
        tpmLimit: key.tpmLimit,
        currentRpm: usage.currentRequests,
        currentTpm: usage.currentTokens,
        maxBudgetUsd: key.maxBudgetUsd,
        currentSpendUsd: key.currentSpendUsd,
        budgetPercentage: budgetPct,
        allowedModels: key.allowedModels,
        status: key.status,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
      });
    }

    return result;
  }

  public maskKey(key: string): string {
    if (!key) return '';
    if (key.length <= 8) return '****';
    const prefix = key.slice(0, 8);
    const suffix = key.slice(-4);
    return `${prefix}****${suffix}`;
  }

  public reset(): void {
    this.keysById.clear();
    this.idByKeyToken.clear();
    this.countersByKeyId.clear();
    this.seedDefaultKeys();
  }
}
