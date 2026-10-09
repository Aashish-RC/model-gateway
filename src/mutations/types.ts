import { UniversalChatRequest } from '../adapters/types.js';

export type ReasoningEffortLevel = 'low' | 'medium' | 'high';

export interface MutationConfig {
  enabled: boolean;
  modelAliases: Record<string, string>;
  systemPromptDecoration: {
    enabled: boolean;
    prefix?: string;
    suffix?: string;
  };
  reasoningTranslation: {
    enabled: boolean;
    defaultBudget: number;
  };
  parameterSanitization: {
    enabled: boolean;
    stripUnsupported: boolean;
  };
}

export interface MutationResult {
  mutatedRequest: UniversalChatRequest;
  appliedAliases: boolean;
  originalModel: string;
  resolvedModel: string;
  systemDecorated: boolean;
  reasoningTranslated: boolean;
  strippedParameters: string[];
}
