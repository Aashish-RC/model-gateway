export class ModelRewriter {
  private aliases: Map<string, string> = new Map();

  constructor(initialAliases?: Record<string, string>) {
    // Default smart aliases
    const defaults: Record<string, string> = {
      claude: 'claude-3-5-sonnet-20241022',
      'claude-sonnet': 'claude-3-5-sonnet-20241022',
      'claude-haiku': 'claude-3-5-haiku-20241022',
      'gpt-4': 'gpt-4o',
      'gpt-4-turbo': 'gpt-4o',
      gemini: 'gemini-1.5-flash',
      'gemini-pro': 'gemini-1.5-pro',
      fast: 'gpt-4o-mini',
      smart: 'gpt-4o',
      coding: 'claude-3-5-sonnet-20241022',
      deepseek: 'deepseek-chat',
      ...initialAliases,
    };

    for (const [key, val] of Object.entries(defaults)) {
      this.aliases.set(key.toLowerCase(), val);
    }
  }

  public resolve(modelName: string): { resolved: string; rewritten: boolean } {
    const key = modelName.toLowerCase().trim();
    if (this.aliases.has(key)) {
      return { resolved: this.aliases.get(key)!, rewritten: true };
    }
    return { resolved: modelName, rewritten: false };
  }

  public setAlias(alias: string, targetModel: string): void {
    this.aliases.set(alias.toLowerCase().trim(), targetModel);
  }

  public deleteAlias(alias: string): boolean {
    return this.aliases.delete(alias.toLowerCase().trim());
  }

  public getAllAliases(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [key, val] of this.aliases.entries()) {
      obj[key] = val;
    }
    return obj;
  }
}
