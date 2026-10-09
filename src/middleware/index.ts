// LRU cache, safe compaction, PII sanitizer middleware
export interface MiddlewareContext {
  requestId: string;
  timestamp: number;
}
