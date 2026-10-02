import type { TextTranslateQuery } from '@bob-translate/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../src/translate';

function sse(delta: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`;
}

type Cfg = any;
let onStreamReq: ((cfg: Cfg) => void) | null;
let onRequest: ((cfg: Cfg) => void) | null;
let onYoudao: (cfg: Cfg) => void;
let timers: Map<number, () => void>;

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
  const http: Record<string, unknown> = {
    request: (cfg: Cfg) => (String(cfg.url).includes('dict.youdao.com/jsonapi') ? onYoudao(cfg) : onRequest?.(cfg)),
  };
  if (withStream) http.streamRequest = (cfg: Cfg) => onStreamReq?.(cfg);
  vi.stubGlobal('$http', http);
}

beforeEach(() => {
  onStreamReq = null;
  onRequest = null;
  // 默认有道不可用：现有用例保持只用模型音标
  onYoudao = (cfg) => cfg.handler({ error: { message: 'offline' } });
  timers = new Map();
  let nextTimer = 1;
  vi.stubGlobal('$timer', {
    schedule: (o: Cfg) => {
      const id = nextTimer++;
      timers.set(id, o.handler);
      return id;
    },
    invalidate: (id: number) => timers.delete(id),
  });
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

describe('thinking models (reasoning-only responses)', () => {
  it('stream with only reasoning deltas → direct error, no blocking retry', () => {
    let blocking = false;
    let final: Cfg = null;
    onStreamReq = (cfg) => {
      cfg.streamHandler({
        text: `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking...' } }] })}\n\n`,
      });
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
    expect(blocking).toBe(false);
    expect(final.error.type).toBe('api');
    expect(final.error.message).toContain('非思考模型');
  });

  it('blocking response with reasoning but empty content → actionable error', () => {
    stubHttp(false);
    let final: Cfg = null;
    onRequest = (cfg) => {
      cfg.handler({
        response: { statusCode: 200 },
        data: { choices: [{ message: { content: '', reasoning_content: 'thinking' } }] },
      });
    };
    translate(
      mkQuery({
        onStream: undefined,
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(final.error.type).toBe('api');
    expect(final.error.message).toContain('reasoning_content');
  });

  it('blocking response with empty content and no reasoning → generic empty error', () => {
    stubHttp(false);
    let final: Cfg = null;
    onRequest = (cfg) => {
      cfg.handler({ response: { statusCode: 200 }, data: { choices: [{ message: { content: '' } }] } });
    };
    translate(
      mkQuery({
        onStream: undefined,
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(final.error.type).toBe('api');
    expect(final.error.message).toContain('message.content 为空');
  });
});

describe('reverse dict (中文查英文)', () => {
  it('short chinese word + detectTo en → reverse dict prompt; dict output parses to a card', () => {
    let final: Cfg = null;
    onStreamReq = (cfg) => {
      expect(cfg.body.messages[0].content).toContain('汉英词典');
      expect(cfg.body.max_tokens).toBeUndefined();
      cfg.streamHandler({ text: sse('WORD: Saturday\nUS: ˈsætərdeɪ\nPOS: n. | 星期六\nALT: Sat.') });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    translate(
      mkQuery({
        text: '星期六',
        detectFrom: 'zh-Hans',
        detectTo: 'en',
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(final.result.toDict.word).toBe('Saturday');
    expect(final.result.toDict.phonetics[0].tts.value).toContain('Saturday');
    expect(final.result.toDict.additions[0]).toEqual({ name: '其他译法', value: 'Sat.' });
  });

  it('model judges input as a sentence (plain text) → falls back to paragraphs', () => {
    let final: Cfg = null;
    onStreamReq = (cfg) => {
      cfg.streamHandler({ text: sse('I love you.') });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    translate(
      mkQuery({
        text: '我爱你',
        detectFrom: 'zh-Hans',
        detectTo: 'en',
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(final.result.toDict).toBeUndefined();
    expect(final.result.toParagraphs).toEqual(['I love you.']);
  });

  it('chinese word but detectTo is not en → plain translate prompt, no max_tokens', () => {
    onStreamReq = (cfg) => {
      expect(cfg.body.messages[0].content).toContain('翻译引擎');
      expect(cfg.body.max_tokens).toBeUndefined();
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    onRequest = (cfg) => {
      cfg.handler({ response: { statusCode: 200 }, data: { choices: [{ message: { content: '土曜日' } }] } });
    };
    translate(mkQuery({ text: '星期六', detectFrom: 'zh-Hans', detectTo: 'ja' }), () => {});
  });
});

describe('thinking hint during reasoning', () => {
  it('shows a placeholder hint while only reasoning deltas have arrived, replaced by real content', () => {
    const previews: string[][] = [];
    onStreamReq = (cfg) => {
      cfg.streamHandler({
        text: `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'hmm' } }] })}\n\n`,
      });
      cfg.streamHandler({
        text: `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'more' } }] })}\n\n`,
      });
      cfg.streamHandler({ text: sse('WORD: run\nPOS: v. | 跑') });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    let final: Cfg = null;
    translate(
      mkQuery({
        onStream: (p: Cfg) => previews.push(p.result.toParagraphs),
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(previews[0]?.join('\n')).toContain('思考中');
    expect(previews).toHaveLength(2); // 提示只发一次，不随思考增量刷屏
    expect(previews[1]?.join('\n')).toContain('run');
    expect(final.result.toDict.word).toBe('run');
  });
});

describe('extra request body (附加请求参数)', () => {
  it('merges extraBody JSON into the request body', () => {
    vi.stubGlobal('$option', { apiKey: 'sk-test', extraBody: '{"thinking": {"type": "disabled"}}' });
    let body: Cfg = null;
    onStreamReq = (cfg) => {
      body = cfg.body;
      cfg.streamHandler({ text: sse('WORD: run\nPOS: v. | 跑') });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    translate(mkQuery(), () => {});
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.stream).toBe(true);
  });

  it('extraBody cannot override stream or messages', () => {
    vi.stubGlobal('$option', { apiKey: 'sk-test', extraBody: '{"stream": false, "messages": []}' });
    let body: Cfg = null;
    onStreamReq = (cfg) => {
      body = cfg.body;
      cfg.streamHandler({ text: sse('WORD: run\nPOS: v. | 跑') });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    translate(mkQuery(), () => {});
    expect(body.stream).toBe(true);
    expect(body.messages).toHaveLength(2);
  });

  it('invalid extraBody JSON → param error before any request', () => {
    vi.stubGlobal('$option', { apiKey: 'sk-test', extraBody: '{thinking: disabled' });
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
    expect(requested).toBe(false);
    expect(final.error.type).toBe('param');
    expect(final.error.message).toContain('JSON');
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

describe('dict stream preview', () => {
  it('only renders complete lines, so frames never show raw tags or empty values', () => {
    const full = 'WORD: run\nUS: rʌn\nPOS: v. | 跑\nEX: I run. | 我跑。\n';
    const previews: string[][] = [];
    onStreamReq = (cfg) => {
      for (let i = 0; i < full.length; i += 2) cfg.streamHandler({ text: sse(full.slice(i, i + 2)) });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    translate(mkQuery({ onStream: (p: Cfg) => previews.push(p.result.toParagraphs) }), () => {});

    expect(previews.map((p) => p.length)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < previews.length; i++) {
      expect(previews[i]?.slice(0, -1)).toEqual(previews[i - 1]);
    }
    expect(previews.flat()).not.toContain('');
    expect(previews[1]).toEqual(['run', '美 /rʌn/']);
  });
});

describe('youdao phonetics', () => {
  const yd = (word: string, us?: string, uk?: string) => ({
    response: { statusCode: 200 },
    data: { ec: { word: [{ 'return-phrase': { l: { i: word } }, usphone: us, ukphone: uk }] } },
  });
  const dictText = 'WORD: pre\nPOS: prefix. | 在…之前\n';

  it('forward dict: looks up the query in parallel and fills phones the model omitted', () => {
    const order: string[] = [];
    let ydCfg: Cfg = null;
    onYoudao = (cfg) => {
      order.push('youdao');
      ydCfg = cfg;
      cfg.handler(yd('pre', 'prɪ', 'ˈpriː'));
    };
    onStreamReq = (cfg) => {
      order.push('model');
      cfg.streamHandler({ text: sse(dictText) });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    let final: Cfg = null;
    translate(
      mkQuery({
        text: 'pre',
        cancelSignal: 'CANCEL',
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(order).toEqual(['youdao', 'model']);
    expect(ydCfg.url).toContain('q=pre');
    expect(ydCfg.timeout).toBe(3);
    expect(ydCfg.cancelSignal).toBe('CANCEL');
    expect(final.result.toDict.phonetics.map((p: Cfg) => [p.type, p.value])).toEqual([
      ['us', 'prɪ'],
      ['uk', 'ˈpriː'],
    ]);
  });

  it('waits for youdao when the model finishes first', () => {
    let ydCfg: Cfg = null;
    onYoudao = (cfg) => {
      ydCfg = cfg;
    };
    onStreamReq = (cfg) => {
      cfg.streamHandler({ text: sse('WORD: run\nUS: rʌn\nUK: rʌn\nPOS: v. | 跑\n') });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
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
    expect(final).toBeNull();
    ydCfg.handler(yd('run', 'rʌn(yd)'));
    expect(final.result.toDict.phonetics.map((p: Cfg) => p.value)).toEqual(['rʌn(yd)', 'rʌn']);
  });

  it('youdao never answering: the 3s timer releases the card with model phones', () => {
    let ydCfg: Cfg = null;
    onYoudao = (cfg) => {
      ydCfg = cfg;
    };
    onStreamReq = (cfg) => {
      cfg.streamHandler({ text: sse('WORD: run\nUS: rʌn\nPOS: v. | 跑\n') });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
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
    expect(final).toBeNull();
    expect(timers.size).toBe(1);
    for (const fire of timers.values()) fire();
    expect(final.result.toDict.phonetics.map((p: Cfg) => p.value)).toEqual(['rʌn']);
    // 定时器之后才到的有道结果不再触发第二次回调
    ydCfg.handler({ response: { statusCode: 200 }, data: {} });
    expect(final.result.toDict.phonetics.map((p: Cfg) => p.value)).toEqual(['rʌn']);
  });

  it('youdao answering cancels the timer', () => {
    onYoudao = (cfg) => cfg.handler({ error: { message: 'offline' } });
    onStreamReq = (cfg) => cfg.handler({ response: { statusCode: 200 }, data: '' });
    onRequest = (cfg) =>
      cfg.handler({
        response: { statusCode: 200 },
        data: { choices: [{ message: { content: 'WORD: run\nPOS: v. | 跑' } }] },
      });
    translate(mkQuery(), () => {});
    expect(timers.size).toBe(0);
  });

  it('youdao failure falls back to model phones', () => {
    onStreamReq = (cfg) => {
      cfg.streamHandler({ text: sse('WORD: run\nUS: rʌn\nPOS: v. | 跑\n') });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
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
    expect(final.result.toDict.phonetics.map((p: Cfg) => [p.type, p.value])).toEqual([['us', 'rʌn']]);
  });

  it('reverse dict: looks up the english WORD once its line arrives', () => {
    const lookups: string[] = [];
    let modelDone = false;
    onYoudao = (cfg) => {
      expect(modelDone).toBe(false); // 流式途中就发起，而非等模型结束
      lookups.push(cfg.url);
      cfg.handler(yd('Saturday', 'ˈsætərdeɪ', 'ˈsætədeɪ'));
    };
    onStreamReq = (cfg) => {
      cfg.streamHandler({ text: sse('WORD: Saturday\n') });
      cfg.streamHandler({ text: sse('POS: n. | 星期六\n') });
      modelDone = true;
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    let final: Cfg = null;
    translate(
      mkQuery({
        text: '星期六',
        detectFrom: 'zh-Hans',
        detectTo: 'en',
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toContain('q=Saturday');
    expect(final.result.toDict.phonetics.map((p: Cfg) => p.value)).toEqual(['ˈsætərdeɪ', 'ˈsætədeɪ']);
  });

  it('blocking path merges youdao phones too', () => {
    stubHttp(false);
    onYoudao = (cfg) => cfg.handler(yd('pre', 'prɪ'));
    onRequest = (cfg) =>
      cfg.handler({ response: { statusCode: 200 }, data: { choices: [{ message: { content: dictText } }] } });
    let final: Cfg = null;
    translate(
      mkQuery({
        text: 'pre',
        onStream: undefined,
        onCompletion: (p: Cfg) => {
          final = p;
        },
      }),
      () => {},
    );
    expect(final.result.toDict.phonetics.map((p: Cfg) => [p.type, p.value])).toEqual([['us', 'prɪ']]);
  });

  it('sentence translation never calls youdao', () => {
    let called = false;
    onYoudao = () => {
      called = true;
    };
    onStreamReq = (cfg) => {
      cfg.streamHandler({ text: sse('你好，世界。') });
      cfg.handler({ response: { statusCode: 200 }, data: '' });
    };
    translate(mkQuery({ text: 'Hello there, how are you doing today?' }), () => {});
    expect(called).toBe(false);
  });
});
