import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ProviderCircuitBreaker,
  ResilienceManager,
  RequestHedger,
} from '../src/resilience/index.js';
import { buildServer } from '../src/server.js';

describe('Feature 4: Resilience & Circuit Breaker', () => {
  beforeEach(() => {
    ResilienceManager.getInstance().resetAll();
  });

  describe('ProviderCircuitBreaker State Transitions', () => {
    it('initializes in CLOSED state and is available', () => {
      const breaker = new ProviderCircuitBreaker('test-provider', {
        failureThreshold: 3,
        successThreshold: 2,
        baseCooldownMs: 50,
      });

      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.isAvailable()).toBe(true);
      const metrics = breaker.getMetrics();
      expect(metrics.consecutiveFailures).toBe(0);
      expect(metrics.totalTrips).toBe(0);
    });

    it('trips to OPEN after consecutive failures reach threshold', () => {
      const breaker = new ProviderCircuitBreaker('test-provider', {
        failureThreshold: 3,
        baseCooldownMs: 100,
      });

      breaker.recordFailure(new Error('fail 1'));
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.isAvailable()).toBe(true);

      breaker.recordFailure(new Error('fail 2'));
      expect(breaker.getState()).toBe('CLOSED');

      breaker.recordFailure(new Error('fail 3'));
      // Reached threshold of 3 -> trips to OPEN
      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.isAvailable()).toBe(false);
      expect(breaker.getMetrics().totalTrips).toBe(1);
    });

    it('recovers from OPEN to HALF_OPEN after cooldown, and to CLOSED upon successes', async () => {
      const breaker = new ProviderCircuitBreaker('test-provider', {
        failureThreshold: 2,
        successThreshold: 2,
        baseCooldownMs: 30,
      });

      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe('OPEN');

      // Wait for cooldown to expire
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(breaker.getState()).toBe('HALF_OPEN');
      expect(breaker.isAvailable()).toBe(true);

      // In HALF_OPEN, first success
      breaker.recordSuccess();
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Second success meets successThreshold (2) -> fully CLOSED
      breaker.recordSuccess();
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.isAvailable()).toBe(true);
    });

    it('immediately re-trips from HALF_OPEN to OPEN if probe fails', async () => {
      const breaker = new ProviderCircuitBreaker('test-provider', {
        failureThreshold: 2,
        successThreshold: 2,
        baseCooldownMs: 30,
      });

      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe('OPEN');

      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Probe failure -> immediately trips back to OPEN
      breaker.recordFailure();
      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.isAvailable()).toBe(false);
      expect(breaker.getMetrics().totalTrips).toBe(2);
    });

    it('allows manual trip and reset', () => {
      const breaker = new ProviderCircuitBreaker('test-provider');
      expect(breaker.getState()).toBe('CLOSED');

      breaker.trip();
      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.isAvailable()).toBe(false);

      breaker.reset();
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.isAvailable()).toBe(true);
    });
  });

  describe('ResilienceManager', () => {
    it('manages multiple provider breakers independently', () => {
      const manager = ResilienceManager.getInstance();
      manager.trip('openai');

      expect(manager.isProviderAvailable('openai')).toBe(false);
      expect(manager.isProviderAvailable('anthropic')).toBe(true);
      expect(manager.isProviderAvailable('gemini')).toBe(true);

      const metrics = manager.getAllMetrics();
      expect(metrics.openai.state).toBe('OPEN');
      expect(metrics.anthropic.state).toBe('CLOSED');

      manager.reset('openai');
      expect(manager.isProviderAvailable('openai')).toBe(true);
    });
  });

  describe('RequestHedger', () => {
    it('returns primary directly when hedging is disabled', async () => {
      const result = await RequestHedger.executeWithHedge(
        async () => 'primary-fast',
        async () => 'backup-never',
        { enabled: false, delayMs: 100 }
      );

      expect(result.result).toBe('primary-fast');
      expect(result.hedged).toBe(false);
      expect(result.winner).toBe('primary');
    });

    it('returns primary when primary completes before hedge delay', async () => {
      const backupSpy = vi.fn().mockResolvedValue('backup');
      const result = await RequestHedger.executeWithHedge(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return 'primary-done';
        },
        backupSpy,
        { enabled: true, delayMs: 100 }
      );

      expect(result.result).toBe('primary-done');
      expect(result.hedged).toBe(false);
      expect(result.winner).toBe('primary');
      expect(backupSpy).not.toHaveBeenCalled();
    });

    it('speculatively fires backup when primary is delayed and backup wins', async () => {
      const result = await RequestHedger.executeWithHedge(
        async () => {
          // Slow primary taking 200ms
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'primary-slow';
        },
        async () => {
          // Fast backup taking 20ms
          await new Promise((resolve) => setTimeout(resolve, 20));
          return 'backup-fast';
        },
        { enabled: true, delayMs: 40 }
      );

      expect(result.result).toBe('backup-fast');
      expect(result.hedged).toBe(true);
      expect(result.winner).toBe('backup');
    });
  });

  describe('Gateway HTTP Resilience Integration', () => {
    it('exposes /api/resilience status and handles /api/resilience/trip and reset', async () => {
      const server = await buildServer();

      // 1. GET /api/resilience
      const getRes = await server.inject({
        method: 'GET',
        url: '/api/resilience',
      });
      expect(getRes.statusCode).toBe(200);
      const data = JSON.parse(getRes.body);
      expect(data.breakers).toBeDefined();
      expect(data.breakers.openai.state).toBe('CLOSED');

      // 2. POST /api/resilience/trip
      const tripRes = await server.inject({
        method: 'POST',
        url: '/api/resilience/trip',
        payload: { provider: 'anthropic' },
      });
      expect(tripRes.statusCode).toBe(200);
      const tripData = JSON.parse(tripRes.body);
      expect(tripData.breakers.anthropic.state).toBe('OPEN');

      // 3. POST /api/resilience/reset
      const resetRes = await server.inject({
        method: 'POST',
        url: '/api/resilience/reset',
        payload: { provider: 'anthropic' },
      });
      expect(resetRes.statusCode).toBe(200);
      const resetData = JSON.parse(resetRes.body);
      expect(resetData.breakers.anthropic.state).toBe('CLOSED');

      await server.close();
    });
  });
});
