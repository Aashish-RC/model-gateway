import { ChatMessage } from '../adapters/types.js';

export type PIIType = 'email' | 'phone' | 'ssn' | 'credit_card' | 'api_key' | 'ip_address';

export type GuardrailAction = 'mask' | 'block' | 'audit_only';

export interface GuardrailConfig {
  enabled: boolean;
  pii: {
    enabled: boolean;
    action: GuardrailAction;
    maskPlaceholder?: string;
    types: PIIType[];
  };
  jailbreak: {
    enabled: boolean;
    action: 'block' | 'audit_only';
    threshold: number; // 0.0 to 1.0 confidence
  };
  outputSanitizer: {
    enabled: boolean;
    maskPii: boolean;
  };
}

export interface PIIMatch {
  type: PIIType;
  raw: string;
  masked: string;
}

export interface InboundGuardrailResult {
  allowed: boolean;
  blockedReason?: string;
  statusCode?: number;
  piiDetected: boolean;
  piiMatches: PIIMatch[];
  jailbreakDetected: boolean;
  jailbreakScore: number;
  jailbreakSignals: string[];
  sanitizedMessages: ChatMessage[];
}

export interface OutboundGuardrailResult {
  content: string;
  piiDetected: boolean;
  piiMatches: PIIMatch[];
}
