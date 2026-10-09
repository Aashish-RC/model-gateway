import { PIIMatch, PIIType } from './types.js';

export class PiiSanitizer {
  private static readonly PATTERNS: Record<PIIType, RegExp> = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    phone: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
    credit_card: /\b(?:\d{4}[- ]?){3}\d{4}\b/g,
    api_key: /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
    ip_address: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
  };

  /**
   * Scan and optionally redact PII in input text
   */
  public static sanitize(
    text: string,
    enabledTypes: PIIType[] = ['email', 'phone', 'ssn', 'credit_card', 'api_key'],
    placeholderPattern?: string
  ): { sanitizedText: string; matches: PIIMatch[] } {
    let sanitizedText = text;
    const matches: PIIMatch[] = [];

    for (const type of enabledTypes) {
      const pattern = this.PATTERNS[type];
      if (!pattern) continue;

      // Reset regex state
      pattern.lastIndex = 0;

      sanitizedText = sanitizedText.replace(pattern, (match) => {
        const replacement = placeholderPattern
          ? placeholderPattern.replace('{type}', type.toUpperCase())
          : `[${type.toUpperCase()}_REDACTED]`;

        matches.push({
          type,
          raw: match,
          masked: replacement,
        });

        return replacement;
      });
    }

    return { sanitizedText, matches };
  }

  public static hasPII(text: string, enabledTypes: PIIType[] = ['email', 'phone', 'ssn', 'credit_card', 'api_key']): boolean {
    for (const type of enabledTypes) {
      const pattern = this.PATTERNS[type];
      if (!pattern) continue;
      pattern.lastIndex = 0;
      if (pattern.test(text)) return true;
    }
    return false;
  }
}
