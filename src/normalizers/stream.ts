import { UniversalStreamChunk } from '../adapters/types.js';

export async function* parseSseLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      // Keep incomplete trailing line in buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        yield line;
      }
    }

    // Flush any remaining content in buffer
    if (buffer.trim()) {
      yield buffer.trim();
    }
  } finally {
    reader.releaseLock();
  }
}

export function formatOpenAiSseChunk(chunk: UniversalStreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export const OPENAI_SSE_DONE = 'data: [DONE]\n\n';
