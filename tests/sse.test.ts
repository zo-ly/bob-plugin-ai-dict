import { describe, expect, it } from 'vitest';
import { createOpenAiSseParser } from '../src/sse';

function sse(delta: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`;
}

describe('createOpenAiSseParser', () => {
  it('reassembles deltas when the stream is chopped into 5-char chunks (mid-JSON / across events)', () => {
    const deltas = ['Hel', 'lo ', 'wor', 'ld'];
    const full = `${deltas.map(sse).join('')}data: [DONE]\n\n`;
    const parser = createOpenAiSseParser();
    let acc = '';
    for (let i = 0; i < full.length; i += 5) {
      const { deltas: ds } = parser.push(full.slice(i, i + 5));
      for (const d of ds) acc += d;
    }
    expect(acc).toBe('Hello world');
  });

  it('captures a mid-stream error event and ignores [DONE]', () => {
    const parser = createOpenAiSseParser();
    const r = parser.push(`data: ${JSON.stringify({ error: { message: 'boom' } })}\n\ndata: [DONE]\n\n`);
    expect(r.error?.message).toBe('boom');
    expect(r.deltas).toEqual([]);
  });

  it('separates reasoning_content deltas from displayable content', () => {
    const parser = createOpenAiSseParser();
    const reasoning = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking' } }] })}\n\n`;
    const r = parser.push(`${reasoning}${sse('answer')}`);
    expect(r.reasoningDeltas).toEqual(['thinking']);
    expect(r.deltas).toEqual(['answer']);
  });

  it('skips malformed JSON lines but keeps valid deltas', () => {
    const parser = createOpenAiSseParser();
    const r = parser.push(`data: {not json}\n\n${sse('ok')}`);
    expect(r.deltas).toEqual(['ok']);
  });
});
