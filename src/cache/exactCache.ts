import crypto from 'crypto';
import { CacheConfig, CacheEntry, CacheKeyStrategy } from './types.js';
import { UniversalChatRequest, UniversalChatResponse, ChatMessage } from '../adapters/types.js';

export class ExactCache {
  private store: Map<string, CacheEntry> = new Map();
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  public setMaxEntries(max: number): void {
    this.maxEntries = Math.max(10, max);
    this.pruneIfNeeded();
  }

  public generateKey(
    req: UniversalChatRequest,
    strategy: CacheKeyStrategy = 'lastQuestion'
  ): { key: string; promptText: string; promptHash: string } {
    let promptText = '';

    if (strategy === 'lastQuestion') {
      const userMsgs = req.messages.filter((m: ChatMessage) => m.role === 'user');
      const lastMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : req.messages[req.messages.length - 1];
      promptText = typeof lastMsg?.content === 'string' ? lastMsg.content.trim() : JSON.stringify(lastMsg?.content ?? '');
    } else if (strategy === 'allQuestions') {
      promptText = req.messages
        .filter((m: ChatMessage) => m.role === 'user')
        .map((m: ChatMessage) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join(' | ')
        .trim();
    } else {
      // fullPayload
      promptText = JSON.stringify({
        messages: req.messages,
        temperature: req.temperature,
        top_p: req.top_p,
      });
    }

    const normalizedString = `${req.model.toLowerCase()}:::${promptText}`;
    const promptHash = crypto.createHash('sha256').update(normalizedString).digest('hex');
    const key = `exact:${req.model.toLowerCase()}:${promptHash.slice(0, 32)}`;

    return { key, promptText, promptHash };
  }

  public get(key: string): CacheEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // Refresh LRU position by re-inserting
    this.store.delete(key);
    entry.hitCount++;
    this.store.set(key, entry);
    return entry;
  }

  public set(
    key: string,
    promptHash: string,
    promptText: string,
    model: string,
    response: UniversalChatResponse,
    ttlSeconds: number,
    costUsd = 0
  ): CacheEntry {
    this.pruneIfNeeded();

    const now = Date.now();
    const entry: CacheEntry = {
      key,
      promptHash,
      promptText,
      model,
      response,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
      hitCount: 0,
      costUsd,
    };

    this.store.set(key, entry);
    return entry;
  }

  public delete(key: string): boolean {
    return this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }

  public getAllEntries(): CacheEntry[] {
    const now = Date.now();
    const valid: CacheEntry[] = [];
    for (const [key, entry] of this.store.entries()) {
      if (now <= entry.expiresAt) {
        valid.push(entry);
      } else {
        this.store.delete(key);
      }
    }
    return valid;
  }

  private pruneIfNeeded(): void {
    if (this.store.size >= this.maxEntries) {
      // Remove oldest inserted/accessed item (first in Map order)
      const firstKey = this.store.keys().next().value;
      if (firstKey) {
        this.store.delete(firstKey);
      }
    }
  }
}
