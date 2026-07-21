import type { TextTranslateQuery } from '@bob-translate/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../src/translate';

function sse(delta: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`;
}

type Cfg = any;
let onStreamReq: ((cfg: Cfg) => void) | null;
let onRequest: ((cfg: Cfg) => void) | null;

function mkQuery(over: Record<string, unknown> = {}): TextTranslateQuery {
  return {
    text: 'run',
    detectFrom: 'en',
    detectTo: 'zh-Hans',
    onStream: () => {},
    onCompletion: () => {},
    ...over,
  } as unknown as TextTranslateQuery;
}

function stubHttp(withStream = true): void {
  const http: Record<string, unknown> = { request: (cfg: Cfg) => onRequest?.(cfg) };
  if (withStream) http.streamRequest = (cfg: Cfg) => onStreamReq?.(cfg);
  vi.stubGlobal('$http', http);
}

beforeEach(() => {
  onStreamReq = null;
  onRequest = null;
  vi.stubGlobal('$option', { apiKey: 'sk-test' });
  stubHttp(true);
});
afterEach(() => vi.unstubAllGlobals());

describe('streaming happy path', () => {
  it('streams, reassembles chunk-split SSE, and finalizes to a dict card', () => {
    const deltas = [
      'WORD: r',
      'un\nPOS',
      ': v. | ',
      '跑；经营\n',
      'FORM: 过去式 = ran\n',
      'EX: I run.',
      ' | 我跑。\n',
      'NOTE: x',
    ];
    const full = `${deltas.map(sse).join('')}data: [DONE]\n\n`;
    const chunks: string[] = [];
    for (let i = 0; i < full.length; i += 5) chunks.push(full.slice(i, i + 5));

    const previews: string[][] = [];
    let final: Cfg = null;
    onStreamReq = (cfg) => {
      expect(cfg.body.stream).toBe(true);
      expect(cfg.cancelSignal).toBe('CANCEL');
      for (const c of chunks) cfg.streamHandler({ text: c });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    translate(
      mkQuery({
        cancelSignal: 'CANCEL',
        onStream: (p: Cfg) => previews.push(p.result.toParagraphs),
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );

    expect(previews.length).toBeGreaterThan(0);
    expect(final.result.toDict.word).toBe('run');
    expect(final.result.toDict.parts[0].means.join(',')).toBe('跑,经营');
    expect(final.result.toDict.exchanges[0].words[0]).toBe('ran');
    expect(final.result.toDict.additions[0].value).toBe('I run.\n我跑。');
  });
});

describe('fallback matrix', () => {
  it('empty 200 stream → retries blocking (which produces the dict)', () => {
    let blocking = false;
    let final: Cfg = null;
    onStreamReq = (cfg) => cfg.handler({ response: { statusCode: 200 }, data: '' });
    onRequest = (cfg) => {
      blocking = true;
      expect(cfg.body.stream).toBe(false);
      cfg.handler({
        response: { statusCode: 200 },
        data: { choices: [{ message: { content: 'WORD: run\nPOS: v. | 跑' } }] },
      });
    };
    translate(
      mkQuery({
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(blocking).toBe(true);
    expect(final.result.toDict.word).toBe('run');
  });

  it('400 during stream → retries blocking', () => {
    let blocking = false;
    let final: Cfg = null;
    onStreamReq = (cfg) =>
      cfg.handler({ response: { statusCode: 400 }, data: { error: { message: 'stream not supported' } } });
    onRequest = (cfg) => {
      blocking = true;
      cfg.handler({
        response: { statusCode: 200 },
        data: { choices: [{ message: { content: 'WORD: run\nPOS: v. | 跑' } }] },
      });
    };
    translate(
      mkQuery({
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(blocking).toBe(true);
    expect(final.result.toDict).toBeTruthy();
  });

  it('500 during stream → retries blocking', () => {
    let blocking = false;
    onStreamReq = (cfg) => cfg.handler({ response: { statusCode: 500 }, data: '' });
    onRequest = (cfg) => {
      blocking = true;
      cfg.handler({ response: { statusCode: 200 }, data: { choices: [{ message: { content: 'hola' } }] } });
    };
    translate(mkQuery({ text: 'hola mundo entero', detectFrom: 'es' }), () => {});
    expect(blocking).toBe(true);
  });

  it('401 during stream → secretKey error, no retry', () => {
    let blocking = false;
    let final: Cfg = null;
    onStreamReq = (cfg) => cfg.handler({ response: { statusCode: 401 }, data: { error: { message: 'bad key' } } });
    onRequest = () => {
      blocking = true;
    };
    translate(
      mkQuery({
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(final.error.type).toBe('secretKey');
    expect(blocking).toBe(false);
  });

  it('429 during stream → api error, no retry', () => {
    let blocking = false;
    let final: Cfg = null;
    onStreamReq = (cfg) => cfg.handler({ response: { statusCode: 429 }, data: { error: { message: 'rate limited' } } });
    onRequest = () => {
      blocking = true;
    };
    translate(
      mkQuery({
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(final.error.type).toBe('api');
    expect(blocking).toBe(false);
  });

  it('mid-stream API error → surfaced, no retry', () => {
    let blocking = false;
    let final: Cfg = null;
    onStreamReq = (cfg) => {
      cfg.streamHandler({ text: `data: ${JSON.stringify({ error: { message: 'content policy' } })}\n\n` });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    onRequest = () => {
      blocking = true;
    };
    translate(
      mkQuery({
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(final.error.message).toContain('content policy');
    expect(blocking).toBe(false);
  });

  it('partial content then trailing 500 → keeps streamed content, no retry', () => {
    let blocking = false;
    let final: Cfg = null;
    onStreamReq = (cfg) => {
      cfg.streamHandler({ text: sse('WORD: run\nPOS: v. | 跑') });
      cfg.handler({ response: { statusCode: 500 }, data: '' });
    };
    onRequest = () => {
      blocking = true;
    };
    translate(
      mkQuery({
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(final.result.toDict).toBeTruthy();
    expect(blocking).toBe(false);
  });
});

describe('compatibility & config', () => {
  it('old Bob without streamRequest → blocking path for a sentence', () => {
    stubHttp(false);
    let blocking = false;
    let final: Cfg = null;
    onRequest = (cfg) => {
      blocking = true;
      cfg.handler({ response: { statusCode: 200 }, data: { choices: [{ message: { content: 'hello world' } }] } });
    };
    translate(
      mkQuery({
        text: 'hola mundo amigo cuatro',
        detectFrom: 'es',
        onStream: undefined,
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(blocking).toBe(true);
    expect(final.result.toParagraphs[0]).toBe('hello world');
  });

  it('missing API key on an OpenAI URL → secretKey error before any request', () => {
    vi.stubGlobal('$option', { apiKey: '', apiUrl: 'https://api.openai.com/v1/chat/completions' });
    let requested = false;
    onStreamReq = () => {
      requested = true;
    };
    onRequest = () => {
      requested = true;
    };
    let final: Cfg = null;
    translate(
      mkQuery({
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(final.error.type).toBe('secretKey');
    expect(requested).toBe(false);
  });

  it('emitCompletion guards against double completion', () => {
    let count = 0;
    onStreamReq = (cfg) => {
      cfg.streamHandler({ text: sse('hi') });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    translate(
      mkQuery({
        text: 'hola mundo entero',
        detectFrom: 'es',
        onCompletion: () => {
          count += 1;
        },
      }),
      () => {},
    );
    expect(count).toBe(1);
  });
});
