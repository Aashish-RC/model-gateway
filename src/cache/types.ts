import { UniversalChatResponse } from '../adapters/types.js';

export type CacheKeyStrategy = 'lastQuestion' | 'allQuestions' | 'fullPayload';

export type CacheStatus = 'HIT' | 'SEMANTIC_HIT' | 'MISS' | 'BYPASS';

export interface CacheEntry {
  key: string;
  promptHash: string;
  promptText: string;
  model: string;
  vector?: number[];
  tokens?: string[];
  response: UniversalChatResponse;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
  isSemantic?: boolean;
  costUsd?: number;
}

export interface CacheConfig {
  enabled: boolean;
  ttlSeconds: number;
  maxEntries: number;
  enableSemantic: boolean;
  semanticSimilarityThreshold: number; // default 0.82 - 0.85
  cacheKeyStrategy: CacheKeyStrategy;
}

export interface CacheStats {
  totalEntries: number;
  exactHits: number;
  semanticHits: number;
  misses: number;
  bypasses: number;
  hitRatio: number;
  savedTokens: number;
  savedCostUsd: number;
}

export interface CacheLookupResult {
  status: CacheStatus;
  entry: CacheEntry | null;
  similarity?: number;
  cacheKey?: string;
}
