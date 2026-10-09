import { ModelRewriter } from './modelRewriter.js';
import { PromptDecorator } from './promptDecorator.js';
import { ReasoningTranslator } from './reasoningTranslator.js';
import { SchemaCleaner } from './schemaCleaner.js';
import { MutationConfig, MutationResult } from './types.js';
import { UniversalChatRequest } from '../adapters/types.js';

export * from './types.js';
export { ModelRewriter } from './modelRewriter.js';
export { PromptDecorator } from './promptDecorator.js';
export { ReasoningTranslator } from './reasoningTranslator.js';
export { SchemaCleaner } from './schemaCleaner.js';

export class MutationPipeline {
  private config: MutationConfig;
  private rewriter: ModelRewriter;

  constructor(config?: Partial<MutationConfig>) {
    this.config = {
      enabled: true,
      modelAliases: {},
      systemPromptDecoration: {
        enabled: false,
        prefix: undefined,
        suffix: undefined,
      },
      reasoningTranslation: {
        enabled: true,
        defaultBudget: 2048,
      },
      parameterSanitization: {
        enabled: true,
        stripUnsupported: true,
      },
      ...config,
    };

    this.rewriter = new ModelRewriter(this.config.modelAliases);
  }

  public getConfig(): MutationConfig {
    return {
      ...this.config,
      modelAliases: this.rewriter.getAllAliases(),
    };
  }

  public updateConfig(newConfig: Partial<MutationConfig>): MutationConfig {
    this.config = {
      ...this.config,
      ...newConfig,
      systemPromptDecoration: { ...this.config.systemPromptDecoration, ...newConfig.systemPromptDecoration },
      reasoningTranslation: { ...this.config.reasoningTranslation, ...newConfig.reasoningTranslation },
      parameterSanitization: { ...this.config.parameterSanitization, ...newConfig.parameterSanitization },
    };

    if (newConfig.modelAliases) {
      for (const [alias, target] of Object.entries(newConfig.modelAliases)) {
        this.rewriter.setAlias(alias, target);
      }
    }

    return this.getConfig();
  }

  public getRewriter(): ModelRewriter {
    return this.rewriter;
  }

  /**
   * Execute full mutation pipeline on an inbound request
   */
  public applyMutations(
    req: UniversalChatRequest,
    targetProvider?: string
  ): MutationResult {
    if (!this.config.enabled) {
      return {
        mutatedRequest: req,
        appliedAliases: false,
        originalModel: req.model,
        resolvedModel: req.model,
        systemDecorated: false,
        reasoningTranslated: false,
        strippedParameters: [],
      };
    }

    let currentReq: UniversalChatRequest = { ...req };
    const originalModel = req.model;

    // 1. Model Alias Rewriting
    const { resolved: resolvedModel, rewritten: appliedAliases } = this.rewriter.resolve(originalModel);
    currentReq.model = resolvedModel;

    // 2. System Prompt Decoration
    let systemDecorated = false;
    if (this.config.systemPromptDecoration.enabled) {
      const decResult = PromptDecorator.decorate(
        currentReq.messages,
        this.config.systemPromptDecoration.prefix,
        this.config.systemPromptDecoration.suffix
      );
      currentReq.messages = decResult.messages;
      systemDecorated = decResult.decorated;
    }

    // 3. Reasoning & Thinking Translation
    let reasoningTranslated = false;
    if (this.config.reasoningTranslation.enabled && targetProvider) {
      const transResult = ReasoningTranslator.translate(currentReq, targetProvider);
      currentReq = transResult.req;
      reasoningTranslated = transResult.translated;
    }

    // 4. Schema Parameter Cleaning
    let strippedParameters: string[] = [];
    if (this.config.parameterSanitization.enabled && this.config.parameterSanitization.stripUnsupported && targetProvider) {
      const cleanResult = SchemaCleaner.clean(currentReq, targetProvider);
      currentReq = cleanResult.req;
      strippedParameters = cleanResult.stripped;
    }

    return {
      mutatedRequest: currentReq,
      appliedAliases,
      originalModel,
      resolvedModel,
      systemDecorated,
      reasoningTranslated,
      strippedParameters,
    };
  }
}

export const globalMutations = new MutationPipeline();
