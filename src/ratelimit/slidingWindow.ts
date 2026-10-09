/**
 * High-performance 60-second sliding window ring buffer.
 * Merged from APISIX (limit-count) and Higress (ai-token-ratelimit).
 * Zero-allocation circular buffer preventing boundary burst anomalies.
 */

interface WindowBucket {
  timestampSec: number;
  requests: number;
  tokens: number;
}

export class SlidingWindowCounter {
  private readonly buckets: WindowBucket[];
  private readonly windowSizeSec: number = 60;

  constructor() {
    this.buckets = Array.from({ length: 60 }, () => ({
      timestampSec: 0,
      requests: 0,
      tokens: 0,
    }));
  }

  /**
   * Returns current active requests and tokens within the rolling 60-second window.
   */
  public getUsage(nowSec = Math.floor(Date.now() / 1000)): {
    currentRequests: number;
    currentTokens: number;
    oldestBucketSec: number | null;
  } {
    const minValidSec = nowSec - (this.windowSizeSec - 1);
    let totalReq = 0;
    let totalTok = 0;
    let oldestActiveSec: number | null = null;

    for (let i = 0; i < 60; i++) {
      const b = this.buckets[i];
      if (b.timestampSec >= minValidSec && b.timestampSec <= nowSec) {
        totalReq += b.requests;
        totalTok += b.tokens;
        if (b.requests > 0 || b.tokens > 0) {
          if (oldestActiveSec === null || b.timestampSec < oldestActiveSec) {
            oldestActiveSec = b.timestampSec;
          }
        }
      }
    }

    return {
      currentRequests: totalReq,
      currentTokens: totalTok,
      oldestBucketSec: oldestActiveSec,
    };
  }

  /**
   * Atomically records request count and token usage into the current second's bucket.
   */
  public record(requests = 1, tokens = 0, nowSec = Math.floor(Date.now() / 1000)): void {
    const idx = nowSec % 60;
    const bucket = this.buckets[idx];

    if (bucket.timestampSec !== nowSec) {
      bucket.timestampSec = nowSec;
      bucket.requests = 0;
      bucket.tokens = 0;
    }

    bucket.requests += requests;
    bucket.tokens += tokens;
  }

  /**
   * Calculates seconds until sufficient capacity resets.
   */
  public getRetryAfterSeconds(nowSec = Math.floor(Date.now() / 1000)): number {
    const { oldestBucketSec } = this.getUsage(nowSec);
    if (!oldestBucketSec) {
      return 1;
    }
    const elapsed = nowSec - oldestBucketSec;
    return Math.max(1, Math.min(60, 60 - elapsed));
  }

  /**
   * Resets the circular buffer counters.
   */
  public reset(): void {
    for (const b of this.buckets) {
      b.timestampSec = 0;
      b.requests = 0;
      b.tokens = 0;
    }
  }
}
