import { CacheEntry } from './types.js';

export interface SemanticMatch {
  entry: CacheEntry;
  similarity: number;
}

export class SemanticCache {
  private entries: CacheEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  public setMaxEntries(max: number): void {
    this.maxEntries = Math.max(10, max);
    this.prune();
  }

  /**
   * Tokenize prompt into normalized word tokens and character n-grams
   */
  public extractFeatures(text: string): Map<string, number> {
    const counts = new Map<string, number>();
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = normalized.split(' ').filter((w) => w.length > 0);

    // 1. Unigram word frequency (weight: 1.0)
    for (const word of words) {
      counts.set(word, (counts.get(word) || 0) + 1.0);
    }

    // 2. Bigrams for word order semantics (weight: 1.5)
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]}_${words[i + 1]}`;
      counts.set(bigram, (counts.get(bigram) || 0) + 1.5);
    }

    // 3. Substring 3-grams for morphological similarity (weight: 0.5)
    for (let i = 0; i <= normalized.length - 3; i++) {
      const trigram = normalized.slice(i, i + 3);
      counts.set(`tri:${trigram}`, (counts.get(`tri:${trigram}`) || 0) + 0.5);
    }

    return counts;
  }

  /**
   * Compute Cosine Similarity between two feature maps
   */
  public computeCosineSimilarity(mapA: Map<string, number>, mapB: Map<string, number>): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const val of mapA.values()) {
      normA += val * val;
    }
    for (const val of mapB.values()) {
      normB += val * val;
    }

    if (normA === 0 || normB === 0) return 0;

    // Smallest map iteration for speed
    const [smaller, larger] = mapA.size < mapB.size ? [mapA, mapB] : [mapB, mapA];
    for (const [key, valA] of smaller.entries()) {
      const valB = larger.get(key);
      if (valB !== undefined) {
        dotProduct += valA * valB;
      }
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Search for the closest semantic match for a query prompt
   */
  public findBestMatch(
    queryText: string,
    model: string,
    threshold: number
  ): SemanticMatch | null {
    const now = Date.now();
    this.evictExpired(now);

    const queryFeatures = this.extractFeatures(queryText);
    let bestMatch: CacheEntry | null = null;
    let highestSim = 0;

    for (const entry of this.entries) {
      if (entry.model.toLowerCase() !== model.toLowerCase()) continue;

      const cachedFeatures = this.extractFeatures(entry.promptText);
      const sim = this.computeCosineSimilarity(queryFeatures, cachedFeatures);

      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = entry;
      }
    }

    if (bestMatch && highestSim >= threshold) {
      bestMatch.hitCount++;
      return { entry: bestMatch, similarity: Math.round(highestSim * 1000) / 1000 };
    }

    return null;
  }

  public addEntry(entry: CacheEntry): void {
    this.prune();
    // Prepend for recency
    this.entries.unshift(entry);
  }

  public clear(): void {
    this.entries = [];
  }

  public size(): number {
    return this.entries.length;
  }

  private evictExpired(now: number): void {
    this.entries = this.entries.filter((e) => e.expiresAt > now);
  }

  private prune(): void {
    const now = Date.now();
    this.evictExpired(now);
    if (this.entries.length >= this.maxEntries) {
      this.entries = this.entries.slice(0, this.maxEntries - 1);
    }
  }
}
