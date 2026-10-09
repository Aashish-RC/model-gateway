import { describe, it, expect, beforeEach } from 'vitest';
import {
  SlidingWindowCounter,
  VirtualKeyManager,
} from '../src/ratelimit/index.js';
import { buildServer } from '../src/server.js';

describe('Feature 6: Rate Limiting & Virtual Key Quota', () => {
  let vkManager: VirtualKeyManager;

  beforeEach(() => {
    vkManager = VirtualKeyManager.getInstance();
    vkManager.reset();
  });

  describe('SlidingWindowCounter', () => {
    it('aggregates requests and tokens within 60s window', () => {
      const counter = new SlidingWindowCounter();
      const now = 100000;

      counter.record(1, 50, now);
      counter.record(2, 100, now + 10);
      counter.record(1, 25, now + 20);

      const usage = counter.getUsage(now + 20);
      expect(usage.currentRequests).toBe(4);
      expect(usage.currentTokens).toBe(175);
    });

    it('prunes expired buckets older than 60 seconds', () => {
      const counter = new SlidingWindowCounter();
      const t0 = 100000;

      counter.record(5, 500, t0);
      counter.record(2, 200, t0 + 30);

      // At t0 + 61, the bucket at t0 has rolled out
      const usageLater = counter.getUsage(t0 + 61);
      expect(usageLater.currentRequests).toBe(2);
      expect(usageLater.currentTokens).toBe(200);
    });

    it('calculates retry-after seconds until oldest bucket expires', () => {
      const counter = new SlidingWindowCounter();
      const t0 = 100000;

      counter.record(1, 100, t0);
      const retryAfter = counter.getRetryAfterSeconds(t0 + 10);
      expect(retryAfter).toBe(50); // 60 - 10
    });
  });

  describe('VirtualKeyManager Core Logic', () => {
    it('allows valid active key and computes remaining allowances', () => {
      const key = vkManager.createKey({
        name: 'Test Key',
        rpmLimit: 10,
        tpmLimit: 1000,
        customKey: 'sk-gw-test-active',
      });

      const check = vkManager.validateAndReserve('sk-gw-test-active', 'gpt-4o', 100);
      expect(check.allowed).toBe(true);
      expect(check.limitRequests).toBe(10);
      expect(check.remainingRequests).toBe(9);
      expect(check.limitTokens).toBe(1000);
      expect(check.remainingTokens).toBe(900);
    });

    it('rejects unknown or invalid keys with key_not_found', () => {
      const check = vkManager.validateAndReserve('sk-gw-invalid-ghost-key', 'gpt-4o');
      expect(check.allowed).toBe(false);
      expect(check.reason).toBe('key_not_found');
    });

    it('rejects revoked keys with key_revoked', () => {
      const key = vkManager.createKey({
        name: 'Revoked Key',
        customKey: 'sk-gw-test-revoked',
      });
      vkManager.revokeKey(key.id);

      const check = vkManager.validateAndReserve('sk-gw-test-revoked', 'gpt-4o');
      expect(check.allowed).toBe(false);
      expect(check.reason).toBe('key_revoked');
    });

    it('enforces model restrictions whitelist', () => {
      vkManager.createKey({
        name: 'Mini Models Only',
        customKey: 'sk-gw-test-restricted-models',
        allowedModels: ['gpt-4o-mini', 'claude-3-5-haiku'],
      });

      // Permitted model
      const allowedCheck = vkManager.validateAndReserve(
        'sk-gw-test-restricted-models',
        'gpt-4o-mini'
      );
      expect(allowedCheck.allowed).toBe(true);

      // Disallowed model
      const blockedCheck = vkManager.validateAndReserve(
        'sk-gw-test-restricted-models',
        'gpt-4o'
      );
      expect(blockedCheck.allowed).toBe(false);
      expect(blockedCheck.reason).toBe('model_not_allowed');
    });

    it('enforces spend budget caps and marks exhausted', () => {
      const key = vkManager.createKey({
        name: 'Budget Capped Key',
        customKey: 'sk-gw-test-budget',
        maxBudgetUsd: 1.0,
      });

      // Record spend under budget
      vkManager.recordUsage('sk-gw-test-budget', 500, 0.5);
      const check1 = vkManager.validateAndReserve('sk-gw-test-budget', 'gpt-4o');
      expect(check1.allowed).toBe(true);

      // Record spend hitting cap
      vkManager.recordUsage('sk-gw-test-budget', 500, 0.55);
      const check2 = vkManager.validateAndReserve('sk-gw-test-budget', 'gpt-4o');
      expect(check2.allowed).toBe(false);
      expect(check2.reason).toBe('budget_exceeded');
    });

    it('enforces RPM rate limit when exceeded', () => {
      vkManager.createKey({
        name: 'Low RPM Key',
        customKey: 'sk-gw-test-low-rpm',
        rpmLimit: 2,
      });

      // First 2 requests succeed
      vkManager.recordUsage('sk-gw-test-low-rpm', 10, 0.0001);
      vkManager.recordUsage('sk-gw-test-low-rpm', 10, 0.0001);

      // Third request is rate limited
      const check = vkManager.validateAndReserve('sk-gw-test-low-rpm', 'gpt-4o');
      expect(check.allowed).toBe(false);
      expect(check.reason).toBe('rpm_limit_exceeded');
      expect(check.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('enforces TPM rate limit when estimated tokens exceed allowance', () => {
      vkManager.createKey({
        name: 'Low TPM Key',
        customKey: 'sk-gw-test-low-tpm',
        rpmLimit: 100,
        tpmLimit: 500,
      });

      vkManager.recordUsage('sk-gw-test-low-tpm', 400, 0.001);

      // Request with 150 prompt tokens exceeds remaining 100
      const check = vkManager.validateAndReserve('sk-gw-test-low-tpm', 'gpt-4o', 150);
      expect(check.allowed).toBe(false);
      expect(check.reason).toBe('tpm_limit_exceeded');
    });

    it('lists keys with masked token strings', () => {
      const keys = vkManager.listKeys();
      expect(keys.length).toBeGreaterThan(0);
      const prodKey = keys.find((k) => k.name === 'Production Core Service');
      expect(prodKey).toBeDefined();
      expect(prodKey!.maskedKey).toContain('****');
      expect(prodKey!.maskedKey).not.toBe('sk-gw-prod-team-alpha');
    });
  });

  describe('HTTP Virtual Key Management & Completions Integration', () => {
    it('serves CRUD operations on /api/virtual-keys', async () => {
      const server = await buildServer();

      // 1. GET /api/virtual-keys
      const listRes = await server.inject({
        method: 'GET',
        url: '/api/virtual-keys',
      });
      expect(listRes.statusCode).toBe(200);
      const listData = JSON.parse(listRes.body);
      expect(Array.isArray(listData.keys)).toBe(true);

      // 2. POST /api/virtual-keys (create)
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/virtual-keys',
        payload: {
          name: 'Integration Test Key',
          rpmLimit: 50,
          tpmLimit: 75000,
          maxBudgetUsd: 15.0,
          allowedModels: ['gpt-4o', 'gpt-4o-mini'],
        },
      });
      expect(createRes.statusCode).toBe(200);
      const createData = JSON.parse(createRes.body);
      expect(createData.success).toBe(true);
      expect(createData.key.key).toContain('sk-gw-');
      const createdId = createData.key.id;

      // 3. PUT /api/virtual-keys/:id (update)
      const updateRes = await server.inject({
        method: 'PUT',
        url: `/api/virtual-keys/${createdId}`,
        payload: {
          name: 'Updated Test Key',
          rpmLimit: 80,
        },
      });
      expect(updateRes.statusCode).toBe(200);
      const updateData = JSON.parse(updateRes.body);
      expect(updateData.key.name).toBe('Updated Test Key');
      expect(updateData.key.rpmLimit).toBe(80);

      // 4. DELETE /api/virtual-keys/:id
      const delRes = await server.inject({
        method: 'DELETE',
        url: `/api/virtual-keys/${createdId}`,
      });
      expect(delRes.statusCode).toBe(200);

      await server.close();
    });

    it('rejects chat completion when virtual key is exhausted', async () => {
      const server = await buildServer();

      const res = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          authorization: 'Bearer sk-gw-demo-exhausted',
        },
        payload: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      expect(res.statusCode).toBe(429);
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('budget_exceeded');
      expect(res.headers['x-ratelimit-remaining-requests']).toBe('0');

      await server.close();
    });

    it('rejects chat completion when model is not permitted', async () => {
      const server = await buildServer();

      // Mobile key only allows gpt-4o-mini, gemini-1.5-flash, claude-3-5-haiku
      const res = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          authorization: 'Bearer sk-gw-mobile-client',
        },
        payload: {
          model: 'gpt-4o', // Not permitted
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      expect(res.statusCode).toBe(403);
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('model_not_allowed');

      await server.close();
    });

    it('injects rate limit headers on valid virtual key request', async () => {
      const server = await buildServer();

      const res = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          authorization: 'Bearer sk-gw-prod-team-alpha',
        },
        payload: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      // Headers injected even if upstream fails due to mock key
      expect(res.headers['x-ratelimit-limit-requests']).toBe('120');
      expect(res.headers['x-ratelimit-limit-tokens']).toBe('150000');
      expect(res.headers['x-ratelimit-remaining-requests']).toBeDefined();

      await server.close();
    });
  });
});
