import { ChatMessage } from '../adapters/types.js';

export class PromptDecorator {
  /**
   * Decorate messages by injecting prefix/suffix into system message
   */
  public static decorate(
    messages: ChatMessage[],
    prefix?: string,
    suffix?: string
  ): { messages: ChatMessage[]; decorated: boolean } {
    if (!prefix && !suffix) {
      return { messages, decorated: false };
    }

    const cloned: ChatMessage[] = JSON.parse(JSON.stringify(messages));
    const systemIdx = cloned.findIndex((m) => m.role === 'system');

    if (systemIdx >= 0) {
      let content = typeof cloned[systemIdx].content === 'string'
        ? (cloned[systemIdx].content as string)
        : JSON.stringify(cloned[systemIdx].content);

      if (prefix) content = `${prefix.trim()}\n\n${content}`;
      if (suffix) content = `${content}\n\n${suffix.trim()}`;

      cloned[systemIdx].content = content;
    } else {
      // Prepend brand new system prompt
      const content = [prefix, suffix].filter(Boolean).map((s) => s?.trim()).join('\n\n');
      cloned.unshift({
        role: 'system',
        content,
      });
    }

    return { messages: cloned, decorated: true };
  }
}
