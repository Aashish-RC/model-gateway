import { ExactCache } from './exactCache.js';
import { SemanticCache } from './semanticCache.js';
import {
  CacheConfig,
  CacheEntry,
  CacheLookupResult,
  CacheStats,
} from './types.js';
import { UniversalChatRequest, UniversalChatResponse } from '../adapters/types.js';

export * from './types.js';
export { ExactCache } from './exactCache.js';
export { SemanticCache } from './semanticCache.js';

export class ResponseCacheManager {
  private exactCache: ExactCache;
  private semanticCache: SemanticCache;
  private config: CacheConfig;

  private stats: {
    exactHits: number;
    semanticHits: number;
    misses: number;
    bypasses: number;
    savedTokens: number;
    savedCostUsd: number;
  } = {
    exactHits: 0,
    semanticHits: 0,
    misses: 0,
    bypasses: 0,
    savedTokens: 0,
    savedCostUsd: 0,
  };

  constructor(config?: Partial<CacheConfig>) {
    this.config = {
      enabled: true,
      ttlSeconds: 300, // 5 minutes
      maxEntries: 1000,
      enableSemantic: true,
      semanticSimilarityThreshold: 0.82,
      cacheKeyStrategy: 'lastQuestion',
      ...config,
    };

    this.exactCache = new ExactCache(this.config.maxEntries);
    this.semanticCache = new SemanticCache(this.config.maxEntries);
  }

  public getConfig(): CacheConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<CacheConfig>): CacheConfig {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.maxEntries) {
      this.exactCache.setMaxEntries(newConfig.maxEntries);
      this.semanticCache.setMaxEntries(newConfig.maxEntries);
    }
    return this.getConfig();
  }

  /**
   * Look up cached response for an incoming request
   */
  public lookup(
    req: UniversalChatRequest,
    headers: Record<string, any> = {}
  ): CacheLookupResult {
    if (!this.config.enabled) {
      return { status: 'BYPASS', entry: null };
    }

    // Check bypass headers (Portkey, Higress, Gateway standard)
    const skipHeader =
      headers['x-gateway-skip-cache'] ||
      headers['x-higress-skip-ai-cache'] ||
      headers['x-portkey-cache-force-refresh'] ||
      headers['cache-control'] === 'no-cache';

    if (skipHeader === 'true' || skipHeader === 'on' || skipHeader === '1' || skipHeader === true) {
      this.stats.bypasses++;
      return { status: 'BYPASS', entry: null };
    }

    // 1. Exact match attempt
    const { key, promptText, promptHash } = this.exactCache.generateKey(req, this.config.cacheKeyStrategy);
    const exactEntry = this.exactCache.get(key);

    if (exactEntry) {
      this.stats.exactHits++;
      const savedTok = exactEntry.response.usage?.total_tokens ?? 0;
      this.stats.savedTokens += savedTok;
      this.stats.savedCostUsd += exactEntry.costUsd || 0;
      return {
        status: 'HIT',
        entry: exactEntry,
        cacheKey: key,
      };
    }

    // 2. Semantic match attempt if enabled
    if (this.config.enableSemantic && promptText.length >= 8) {
      const match = this.semanticCache.findBestMatch(
        promptText,
        req.model,
        this.config.semanticSimilarityThreshold
      );

      if (match) {
        this.stats.semanticHits++;
        const savedTok = match.entry.response.usage?.total_tokens ?? 0;
        this.stats.savedTokens += savedTok;
        this.stats.savedCostUsd += match.entry.costUsd || 0;
        return {
          status: 'SEMANTIC_HIT',
          entry: match.entry,
          similarity: match.similarity,
          cacheKey: match.entry.key,
        };
      }
    }

    this.stats.misses++;
    return {
      status: 'MISS',
      entry: null,
      cacheKey: key,
    };
  }

  /**
   * Store a completed response in cache
   */
  public store(
    req: UniversalChatRequest,
    response: UniversalChatResponse,
    costUsd = 0
  ): CacheEntry | null {
    if (!this.config.enabled) return null;

    // Do not cache error responses
    if (!response.choices || response.choices.length === 0) return null;

    const { key, promptText, promptHash } = this.exactCache.generateKey(req, this.config.cacheKeyStrategy);

    // Deep clone response to prevent mutation
    const clonedResponse: UniversalChatResponse = JSON.parse(JSON.stringify(response));

    const entry = this.exactCache.set(
      key,
      promptHash,
      promptText,
      req.model,
      clonedResponse,
      this.config.ttlSeconds,
      costUsd
    );

    if (this.config.enableSemantic && promptText.length >= 8) {
      this.semanticCache.addEntry(entry);
    }

    return entry;
  }

  /**
   * Helper to replay a cached response as Server-Sent Events (SSE)
   */
  public async streamCachedResponse(
    response: UniversalChatResponse,
    writeChunk: (chunk: string) => void,
    chunkDelayMs = 5
  ): Promise<void> {
    const content = response.choices?.[0]?.message?.content ?? '';
    const id = response.id || `cache-${Date.now()}`;
    const model = response.model;

    // Send role header chunk
    const firstChunk = {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null,
        },
      ],
    };
    writeChunk(`data: ${JSON.stringify(firstChunk)}\n\n`);

    // Stream words/tokens
    const words = content.split(/(\s+)/);
    for (const piece of words) {
      if (!piece) continue;
      const chunk = {
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            delta: { content: piece },
            finish_reason: null,
          },
        ],
      };
      writeChunk(`data: ${JSON.stringify(chunk)}\n\n`);
      if (chunkDelayMs > 0) {
        await new Promise((r) => setTimeout(r, chunkDelayMs));
      }
    }

    // Send stop chunk
    const stopChunk = {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
      usage: response.usage,
    };
    writeChunk(`data: ${JSON.stringify(stopChunk)}\n\n`);
    writeChunk('data: [DONE]\n\n');
  }

  public getStats(): CacheStats {
    const totalLookups =
      this.stats.exactHits + this.stats.semanticHits + this.stats.misses;
    const totalHits = this.stats.exactHits + this.stats.semanticHits;
    const hitRatio =
      totalLookups > 0 ? Math.round((totalHits / totalLookups) * 1000) / 1000 : 0;

    return {
      totalEntries: this.exactCache.size(),
      exactHits: this.stats.exactHits,
      semanticHits: this.stats.semanticHits,
      misses: this.stats.misses,
      bypasses: this.stats.bypasses,
      hitRatio,
      savedTokens: this.stats.savedTokens,
      savedCostUsd: Math.round(this.stats.savedCostUsd * 100000) / 100000,
    };
  }

  public getAllEntries(): CacheEntry[] {
    return this.exactCache.getAllEntries();
  }

  public clear(): void {
    this.exactCache.clear();
    this.semanticCache.clear();
    this.stats = {
      exactHits: 0,
      semanticHits: 0,
      misses: 0,
      bypasses: 0,
      savedTokens: 0,
      savedCostUsd: 0,
    };
  }
}

export const globalCache = new ResponseCacheManager();
