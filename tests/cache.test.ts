import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseCacheManager, ExactCache, SemanticCache } from '../src/cache/index.js';
import { UniversalChatRequest, UniversalChatResponse } from '../src/adapters/types.js';

describe('Feature 7: Exact & Semantic Response Cache', () => {
  let cacheManager: ResponseCacheManager;

  const mockRequestA: UniversalChatRequest = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is the capital of France?' },
    ],
    temperature: 0.7,
  };

  const mockRequestB_Paraphrase: UniversalChatRequest = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is the capital of France' },
    ],
    temperature: 0.7,
  };

  const mockRequestC_Unrelated: UniversalChatRequest = {
    model: 'gpt-4o',
    messages: [
      { role: 'user', content: 'How do you invert a binary tree in Rust?' },
    ],
  };

  const mockResponse: UniversalChatResponse = {
    id: 'chatcmpl-test-cache-1',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'The capital of France is Paris.',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 15,
      completion_tokens: 7,
      total_tokens: 22,
    },
  };

  beforeEach(() => {
    cacheManager = new ResponseCacheManager({
      ttlSeconds: 60,
      semanticSimilarityThreshold: 0.80,
    });
  });

  describe('ExactCache Module', () => {
    it('stores and retrieves cached entry with exact SHA-256 match', () => {
      const exact = new ExactCache();
      const { key, promptHash, promptText } = exact.generateKey(mockRequestA, 'lastQuestion');
      exact.set(key, promptHash, promptText, mockRequestA.model, mockResponse, 60, 0.0001);

      const hit = exact.get(key);
      expect(hit).not.toBeNull();
      expect(hit?.response.choices[0].message.content).toBe('The capital of France is Paris.');
      expect(hit?.hitCount).toBe(1);
    });

    it('returns null when entry expires after TTL', async () => {
      const exact = new ExactCache();
      const { key, promptHash, promptText } = exact.generateKey(mockRequestA, 'lastQuestion');
      // Set TTL to 0 seconds (expires immediately)
      exact.set(key, promptHash, promptText, mockRequestA.model, mockResponse, -1);

      const res = exact.get(key);
      expect(res).toBeNull();
    });

    it('evicts oldest entry when maxEntries is exceeded', () => {
      const exact = new ExactCache(2);
      exact.set('key1', 'h1', 'p1', 'm1', mockResponse, 60);
      exact.set('key2', 'h2', 'p2', 'm2', mockResponse, 60);
      expect(exact.size()).toBe(2);

      exact.set('key3', 'h3', 'p3', 'm3', mockResponse, 60);
      expect(exact.size()).toBe(2);
      expect(exact.get('key1')).toBeNull(); // Oldest evicted
      expect(exact.get('key2')).not.toBeNull();
      expect(exact.get('key3')).not.toBeNull();
    });
  });

  describe('SemanticCache Module', () => {
    it('matches semantically equivalent queries using cosine similarity', () => {
      const semantic = new SemanticCache();
      const entry = {
        key: 'exact:test',
        promptHash: 'hash1',
        promptText: 'What is the capital of France?',
        model: 'gpt-4o',
        response: mockResponse,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60000,
        hitCount: 0,
      };
      semantic.addEntry(entry);

      const match = semantic.findBestMatch('What is the capital of France', 'gpt-4o', 0.80);
      expect(match).not.toBeNull();
      expect(match?.similarity).toBeGreaterThanOrEqual(0.85);
      expect(match?.entry.response.choices[0].message.content).toBe('The capital of France is Paris.');
    });

    it('rejects semantically distant queries below threshold', () => {
      const semantic = new SemanticCache();
      const entry = {
        key: 'exact:test',
        promptHash: 'hash1',
        promptText: 'What is the capital of France?',
        model: 'gpt-4o',
        response: mockResponse,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60000,
        hitCount: 0,
      };
      semantic.addEntry(entry);

      const match = semantic.findBestMatch('How do you invert a binary tree in Rust?', 'gpt-4o', 0.80);
      expect(match).toBeNull();
    });
  });

  describe('ResponseCacheManager High-Level Pipeline', () => {
    it('returns MISS on first lookup and HIT on subsequent identical request', () => {
      // First lookup -> MISS
      const lookup1 = cacheManager.lookup(mockRequestA);
      expect(lookup1.status).toBe('MISS');
      expect(lookup1.entry).toBeNull();

      // Store response
      cacheManager.store(mockRequestA, mockResponse, 0.00015);

      // Second lookup -> HIT
      const lookup2 = cacheManager.lookup(mockRequestA);
      expect(lookup2.status).toBe('HIT');
      expect(lookup2.entry?.response.choices[0].message.content).toBe('The capital of France is Paris.');

      // Check stats
      const stats = cacheManager.getStats();
      expect(stats.exactHits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.savedTokens).toBe(22);
      expect(stats.savedCostUsd).toBe(0.00015);
    });

    it('returns SEMANTIC_HIT for similar query when semantic caching is enabled', () => {
      cacheManager.store(mockRequestA, mockResponse, 0.0002);

      // Slightly paraphrased prompt
      const lookup = cacheManager.lookup(mockRequestB_Paraphrase);
      expect(['HIT', 'SEMANTIC_HIT']).toContain(lookup.status);
      expect(lookup.entry).not.toBeNull();

      const stats = cacheManager.getStats();
      expect(stats.exactHits + stats.semanticHits).toBe(1);
    });

    it('bypasses cache when x-gateway-skip-cache header is provided', () => {
      cacheManager.store(mockRequestA, mockResponse, 0.0001);

      const bypassLookup = cacheManager.lookup(mockRequestA, { 'x-gateway-skip-cache': 'true' });
      expect(bypassLookup.status).toBe('BYPASS');
      expect(bypassLookup.entry).toBeNull();

      const stats = cacheManager.getStats();
      expect(stats.bypasses).toBe(1);
    });

    it('supports streaming cached response chunks via SSE helper', async () => {
      const chunks: string[] = [];
      await cacheManager.streamCachedResponse(
        mockResponse,
        (chunk) => chunks.push(chunk),
        0 // 0 delay for fast tests
      );

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toContain('chat.completion.chunk');
      expect(chunks[chunks.length - 1]).toBe('data: [DONE]\n\n');
      expect(chunks.some((c) => c.includes('Paris'))).toBe(true);
    });
  });

  describe('HTTP Cache Endpoints Integration', () => {
    it('serves /api/cache/stats, /api/cache/config, and /api/cache/clear', async () => {
      const { buildServer } = await import('../src/server.js');
      const server = await buildServer({ logger: false });
      await server.ready();

      try {
        const statsRes = await server.inject({
          method: 'GET',
          url: '/api/cache/stats',
        });
        expect(statsRes.statusCode).toBe(200);
        const stats = JSON.parse(statsRes.body).stats;
        expect(stats).toHaveProperty('totalEntries');
        expect(stats).toHaveProperty('exactHits');

        const configRes = await server.inject({
          method: 'POST',
          url: '/api/cache/config',
          payload: { ttlSeconds: 600 },
        });
        expect(configRes.statusCode).toBe(200);
        expect(JSON.parse(configRes.body).config.ttlSeconds).toBe(600);

        const clearRes = await server.inject({
          method: 'POST',
          url: '/api/cache/clear',
        });
        expect(clearRes.statusCode).toBe(200);
        expect(JSON.parse(clearRes.body).success).toBe(true);
      } finally {
        await server.close();
      }
    });
  });
});
