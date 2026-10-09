import { ProviderAdapter } from './types.js';
import { OpenAiAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';

export class AdapterRegistry {
  private static instance: AdapterRegistry;
  private adapters = new Map<string, ProviderAdapter>();

  private constructor() {
    this.registerDefaults();
  }

  public static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  private registerDefaults() {
    const openai = new OpenAiAdapter();
    const anthropic = new AnthropicAdapter();
    const gemini = new GeminiAdapter();

    this.register('openai', openai);
    this.register('azure-openai', openai);
    this.register('deepseek', openai);
    this.register('groq', openai);
    this.register('mistral', openai);
    this.register('ollama', openai);
    this.register('openrouter', openai);
    this.register('together', openai);

    this.register('anthropic', anthropic);
    this.register('claude', anthropic);

    this.register('gemini', gemini);
    this.register('google', gemini);
    this.register('vertex-ai', gemini);
  }

  public register(providerName: string, adapter: ProviderAdapter): void {
    this.adapters.set(providerName.toLowerCase(), adapter);
  }

  public get(providerName: string): ProviderAdapter {
    const adapter = this.adapters.get(providerName.toLowerCase());
    if (!adapter) {
      // Default fallback to OpenAI-compatible adapter for custom endpoints
      const defaultAdapter = this.adapters.get('openai');
      if (defaultAdapter) return defaultAdapter;
      throw new Error(`No adapter registered for provider: ${providerName}`);
    }
    return adapter;
  }

  public has(providerName: string): boolean {
    return this.adapters.has(providerName.toLowerCase());
  }

  public listProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}
