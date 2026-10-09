export type KeySelectionStrategy = 'round-robin' | 'weighted' | 'least-busy';

export interface KeyEntity {
  id: string;
  provider: string;
  key: string;
  weight: number;
  inFlightRequests: number;
  totalRequests: number;
  consecutiveFailures: number;
  isHealthy: boolean;
  cooldownUntil?: number;
  cooldownReason?: string;
  lastUsedAt?: number;
}

export interface CooldownOptions {
  baseCooldownMs: number;
  maxCooldownMs: number;
  jitterRatio: number;
}

export interface KeyPublicView {
  id: string;
  provider: string;
  maskedKey: string;
  weight: number;
  inFlightRequests: number;
  totalRequests: number;
  consecutiveFailures: number;
  isHealthy: boolean;
  isCoolingDown: boolean;
  cooldownRemainingSeconds: number;
  cooldownReason?: string;
}
