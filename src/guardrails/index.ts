import { PiiSanitizer } from './piiSanitizer.js';
import { InjectionDetector } from './injectionDetector.js';
import {
  GuardrailConfig,
  InboundGuardrailResult,
  OutboundGuardrailResult,
  PIIMatch,
} from './types.js';
import { ChatMessage } from '../adapters/types.js';

export * from './types.js';
export { PiiSanitizer } from './piiSanitizer.js';
export { InjectionDetector } from './injectionDetector.js';

export class GuardrailsEngine {
  private config: GuardrailConfig;
  private metrics = {
    totalInspected: 0,
    blockedJailbreaks: 0,
    blockedPii: 0,
    redactedPii: 0,
    outboundPiiCleaned: 0,
  };

  constructor(config?: Partial<GuardrailConfig>) {
    this.config = {
      enabled: true,
      pii: {
        enabled: true,
        action: 'mask', // 'mask' | 'block' | 'audit_only'
        types: ['email', 'phone', 'ssn', 'credit_card', 'api_key'],
      },
      jailbreak: {
        enabled: true,
        action: 'block', // 'block' | 'audit_only'
        threshold: 0.70,
      },
      outputSanitizer: {
        enabled: true,
        maskPii: true,
      },
      ...config,
    };
  }

  public getConfig(): GuardrailConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<GuardrailConfig>): GuardrailConfig {
    this.config = {
      ...this.config,
      ...newConfig,
      pii: { ...this.config.pii, ...newConfig.pii },
      jailbreak: { ...this.config.jailbreak, ...newConfig.jailbreak },
      outputSanitizer: { ...this.config.outputSanitizer, ...newConfig.outputSanitizer },
    };
    return this.getConfig();
  }

  public getMetrics() {
    return { ...this.metrics };
  }

  public resetMetrics() {
    this.metrics = {
      totalInspected: 0,
      blockedJailbreaks: 0,
      blockedPii: 0,
      redactedPii: 0,
      outboundPiiCleaned: 0,
    };
  }

  /**
   * Inspect inbound user messages before forwarding upstream
   */
  public inspectInbound(messages: ChatMessage[]): InboundGuardrailResult {
    this.metrics.totalInspected++;

    if (!this.config.enabled) {
      return {
        allowed: true,
        piiDetected: false,
        piiMatches: [],
        jailbreakDetected: false,
        jailbreakScore: 0,
        jailbreakSignals: [],
        sanitizedMessages: messages,
      };
    }

    // Extract all user input text
    const userTexts = messages
      .filter((m) => m.role === 'user')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
    const concatenatedUserText = userTexts.join('\n');

    // 1. Jailbreak & Prompt Injection Check
    let jailbreakDetected = false;
    let jailbreakScore = 0;
    let jailbreakSignals: string[] = [];

    if (this.config.jailbreak.enabled && concatenatedUserText.length > 0) {
      const evaluation = InjectionDetector.evaluate(
        concatenatedUserText,
        this.config.jailbreak.threshold
      );
      jailbreakDetected = evaluation.isJailbreak;
      jailbreakScore = evaluation.score;
      jailbreakSignals = evaluation.matchedSignals;
    }

    // 2. PII Sanitization Check
    let piiDetected = false;
    const allPiiMatches: PIIMatch[] = [];
    const sanitizedMessages: ChatMessage[] = [];

    for (const msg of messages) {
      if (typeof msg.content === 'string' && this.config.pii.enabled) {
        const { sanitizedText, matches } = PiiSanitizer.sanitize(
          msg.content,
          this.config.pii.types,
          this.config.pii.maskPlaceholder
        );

        if (matches.length > 0) {
          piiDetected = true;
          allPiiMatches.push(...matches);
        }

        sanitizedMessages.push({
          ...msg,
          content: this.config.pii.action === 'mask' ? sanitizedText : msg.content,
        });
      } else {
        sanitizedMessages.push({ ...msg });
      }
    }

    // 3. Evaluate Block Actions
    if (jailbreakDetected && this.config.jailbreak.action === 'block') {
      this.metrics.blockedJailbreaks++;
      return {
        allowed: false,
        statusCode: 400,
        blockedReason: `Request blocked by security guardrails: prompt injection or jailbreak pattern detected (${jailbreakSignals.join(', ')})`,
        piiDetected,
        piiMatches: allPiiMatches,
        jailbreakDetected: true,
        jailbreakScore,
        jailbreakSignals,
        sanitizedMessages: messages,
      };
    }

    if (piiDetected) {
      if (this.config.pii.action === 'block') {
        this.metrics.blockedPii++;
        return {
          allowed: false,
          statusCode: 400,
          blockedReason: `Request blocked by guardrails: input contains prohibited sensitive data (${[...new Set(allPiiMatches.map((m) => m.type))].join(', ')})`,
          piiDetected: true,
          piiMatches: allPiiMatches,
          jailbreakDetected,
          jailbreakScore,
          jailbreakSignals,
          sanitizedMessages: messages,
        };
      } else if (this.config.pii.action === 'mask') {
        this.metrics.redactedPii += allPiiMatches.length;
      }
    }

    return {
      allowed: true,
      piiDetected,
      piiMatches: allPiiMatches,
      jailbreakDetected,
      jailbreakScore,
      jailbreakSignals,
      sanitizedMessages,
    };
  }

  /**
   * Inspect outbound assistant response text before returning to client
   */
  public inspectOutbound(responseText: string): OutboundGuardrailResult {
    if (!this.config.enabled || !this.config.outputSanitizer.enabled) {
      return {
        content: responseText,
        piiDetected: false,
        piiMatches: [],
      };
    }

    if (!this.config.outputSanitizer.maskPii) {
      return {
        content: responseText,
        piiDetected: false,
        piiMatches: [],
      };
    }

    const { sanitizedText, matches } = PiiSanitizer.sanitize(
      responseText,
      this.config.pii.types
    );

    if (matches.length > 0) {
      this.metrics.outboundPiiCleaned += matches.length;
    }

    return {
      content: sanitizedText,
      piiDetected: matches.length > 0,
      piiMatches: matches,
    };
  }
}

export const globalGuardrails = new GuardrailsEngine();
