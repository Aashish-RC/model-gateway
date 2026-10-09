import { UniversalChatRequest } from '../adapters/types.js';

export class SchemaCleaner {
  /**
   * Strip parameters incompatible with the target provider to prevent upstream 400 Bad Request errors
   */
  public static clean(
    req: UniversalChatRequest,
    targetProvider: string
  ): { req: UniversalChatRequest; stripped: string[] } {
    const cloned = { ...req } as any;
    const stripped: string[] = [];

    const removeField = (field: string) => {
      if (cloned[field] !== undefined) {
        delete cloned[field];
        stripped.push(field);
      }
    };

    if (targetProvider === 'anthropic') {
      removeField('frequency_penalty');
      removeField('presence_penalty');
      removeField('logit_bias');
      removeField('user');
      if (cloned.n !== undefined && cloned.n > 1) {
        delete cloned.n;
        stripped.push('n');
      }
    } else if (targetProvider === 'gemini') {
      removeField('frequency_penalty');
      removeField('presence_penalty');
      removeField('logit_bias');
      removeField('user');
    }

    return { req: cloned, stripped };
  }
}
