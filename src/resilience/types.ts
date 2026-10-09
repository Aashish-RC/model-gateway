export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Consecutive failures before tripping to OPEN (default: 3) */
  failureThreshold: number;
  /** Consecutive successes in HALF_OPEN before restoring to CLOSED (default: 2) */
  successThreshold: number;
  /** Base cooldown in ms when tripped (default: 10000ms) */
  baseCooldownMs: number;
  /** Maximum cooldown cap in ms (default: 60000ms) */
  maxCooldownMs: number;
  /** Whether to apply exponential backoff (2^trips * baseCooldown) (default: true) */
  exponentialBackoff: boolean;
}

export interface CircuitBreakerMetrics {
  provider: string;
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalTrips: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  cooldownEndsAt?: number;
  cooldownRemainingMs: number;
}

export interface HedgeConfig {
  /** Whether request hedging is enabled */
  enabled: boolean;
  /** Speculative delay in ms before launching backup request (default: 2500ms) */
  delayMs: number;
}

export interface HedgedExecutionResult<T> {
  result: T;
  hedged: boolean;
  winner: 'primary' | 'backup';
  primaryLatencyMs: number;
  backupLatencyMs?: number;
}
