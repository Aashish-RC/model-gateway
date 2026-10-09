import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { KeyPool } from '../src/keys/pool.js';
import { SentinelEngine } from '../src/keys/sentinel.js';

describe('KeyPool Selection & Concurrency', () => {
  let pool: KeyPool;

  beforeEach(() => {
    pool = new KeyPool('openai', [
      { id: 'key-1', key: 'sk-key-one', weight: 1 },
      { id: 'key-2', key: 'sk-key-two', weight: 3 },
    ]);
  });

  it('acquires and releases keys tracking concurrency', () => {
    const key = pool.acquireKey('least-busy');
    expect(key).toBeDefined();
    expect(key?.inFlightRequests).toBe(1);

    pool.releaseKey(key!.id, true);
    expect(key?.inFlightRequests).toBe(0);
    expect(key?.totalRequests).toBe(1);
    expect(key?.consecutiveFailures).toBe(0);
  });

  it('selects least-busy key under load', () => {
    const k1 = pool.acquireKey('least-busy');
    expect(k1?.id).toBe('key-1'); // Both had 0 inFlight, picked first

    const k2 = pool.acquireKey('least-busy');
    expect(k2?.id).toBe('key-2'); // key-1 had 1 inFlight, key-2 had 0

    pool.releaseKey(k1!.id, true);
    pool.releaseKey(k2!.id, true);
  });

  it('puts key on cooldown on 429 rate limit failure', () => {
    const k = pool.acquireKey('round-robin');
    expect(k).toBeDefined();

    pool.releaseKey(k!.id, false, 429, 'Rate limit exceeded');

    expect(k?.consecutiveFailures).toBe(1);
    expect(k?.cooldownUntil).toBeGreaterThan(Date.now());
    expect(k?.cooldownReason).toBe('Rate limit exceeded');

    // Key is now cooling down, only other key should be available
    const available = pool.getAvailableKeys();
    expect(available.map((x) => x.id)).not.toContain(k!.id);
  });

  it('recovers cooled down key after timer expires', () => {
    const k = pool.acquireKey('round-robin')!;
    pool.releaseKey(k.id, false, 429, 'Rate limited');

    // Simulate clock advancing past cooldown
    const recovered = pool.checkRecoveries(Date.now() + 100000);
    expect(recovered).toBe(1);

    const available = pool.getAvailableKeys(Date.now() + 100000);
    expect(available.map((x) => x.id)).toContain(k.id);
  });
});

describe('SentinelEngine Transparent Failover', () => {
  let sentinel: SentinelEngine;

  beforeEach(() => {
    sentinel = SentinelEngine.getInstance();
    const pool = sentinel.getOrCreatePool('test-provider');
    pool.addKey('test-k1', 'key-will-fail-429', 1);
    pool.addKey('test-k2', 'key-will-succeed', 1);
  });

  it('transparently retries and succeeds with next key when first key hits 429', async () => {
    const executionOrder: string[] = [];

    const result = await sentinel.executeWithKeyRetry(
      'test-provider',
      async (key, keyId) => {
        executionOrder.push(keyId);
        if (keyId === 'test-k1') {
          throw new Error('OpenAI API error (429): Rate limit exceeded');
        }
        return `Success with ${key}`;
      },
      { strategy: 'round-robin' }
    );

    expect(result).toBe('Success with key-will-succeed');
    expect(executionOrder).toContain('test-k1');
    expect(executionOrder).toContain('test-k2');

    // Check that test-k1 is now in cooldown
    const views = sentinel.getAllKeyViews();
    const k1View = views.find((v) => v.id === 'test-k1');
    expect(k1View?.isCoolingDown).toBe(true);
    expect(k1View?.consecutiveFailures).toBe(1);
  });

  afterAll(() => {
    sentinel.stop();
  });
});
