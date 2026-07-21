// OpenAI 兼容的 SSE 增量解析器。stream.text 是增量片段、可能从事件中间切断，
// 故缓冲最后半行、只处理完整行。每个请求 new 一个实例，切勿跨请求复用 buffer。

export interface SseParseResult {
  deltas: string[];
  error: { message?: string } | null;
}

export function createOpenAiSseParser(): { push(chunk: string): SseParseResult } {
  let buffer = '';

  return {
    push(chunk: string): SseParseResult {
      const deltas: string[] = [];
      let error: { message?: string } | null = null;

      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';

      for (const raw of parts) {
        const line = raw.replace(/\r$/, '');
        const m = /^data:\s?(.*)$/.exec(line);
        if (!m) continue;
        const payload = m[1];
        if (!payload || payload === '[DONE]') continue;
        let obj: { error?: { message?: string }; choices?: Array<{ delta?: { content?: string } }> };
        try {
          obj = JSON.parse(payload);
        } catch {
          continue;
        }
        if (obj.error) {
          error = obj.error;
          continue;
        }
        const choice = obj.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta) {
          deltas.push(delta);
        }
      }

      return { deltas, error };
    },
  };
}
