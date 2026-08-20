import type { HttpResponse } from '@bob-translate/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pluginValidate, validationOf } from '../src/validate';

// 只构造被 validationOf 读取的字段，整体断言为 HttpResponse
function resp(partial: { data?: unknown; statusCode?: number; error?: unknown }): HttpResponse {
  const { data, statusCode, error } = partial;
  return { data, error, response: statusCode ? { statusCode } : undefined } as unknown as HttpResponse;
}

describe('validationOf', () => {
  it('passes when choices are present', () => {
    const r = validationOf(resp({ data: { choices: [{ message: { content: 'pong' } }] }, statusCode: 200 }));
    expect(r).toEqual({ result: true });
  });

  it('maps network error', () => {
    const r = validationOf(resp({ error: { message: 'timeout', debugMessage: 'ETIMEDOUT' } }));
    expect(r.result).toBe(false);
    expect(r.error?.type).toBe('network');
    expect(r.error?.message).toContain('timeout');
  });

  it('maps 401 to secretKey error', () => {
    const r = validationOf(resp({ data: { error: { message: 'Incorrect API key provided' } }, statusCode: 401 }));
    expect(r.error?.type).toBe('secretKey');
    expect(r.error?.message).toContain('Incorrect API key');
  });

  it('maps other http errors to api error with message', () => {
    const r = validationOf(resp({ data: { error: { message: 'model not found' } }, statusCode: 404 }));
    expect(r.error?.type).toBe('api');
    expect(r.error?.message).toContain('model not found');
  });

  it('rejects 200 responses without choices', () => {
    const r = validationOf(resp({ data: '{}', statusCode: 200 }));
    expect(r.result).toBe(false);
    expect(r.error?.type).toBe('api');
    expect(r.error?.message).toContain('HTTP 200');
  });

  it('rejects choices whose message.content is empty', () => {
    const r = validationOf(resp({ data: { choices: [{ message: { content: '' } }] }, statusCode: 200 }));
    expect(r.result).toBe(false);
    expect(r.error?.message).toContain('message.content 为空');
  });

  it('passes reasoning-only responses: they prove url/key/model are all valid', () => {
    const r = validationOf(
      resp({ data: { choices: [{ message: { content: '', reasoning_content: 'thinking' } }] }, statusCode: 200 }),
    );
    expect(r).toEqual({ result: true });
  });
});

describe('pluginValidate extra request body', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('merges extraBody into the validation request', () => {
    vi.stubGlobal('$option', { apiKey: 'sk-test', model: 'm', extraBody: '{"thinking": {"type": "disabled"}}' });
    let body: any = null;
    vi.stubGlobal('$http', {
      request: (cfg: any) => {
        body = cfg.body;
        cfg.handler({ response: { statusCode: 200 }, data: { choices: [{ message: { content: 'pong' } }] } });
      },
    });
    let result: any = null;
    pluginValidate((r: any) => {
      result = r;
    });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.stream).toBe(false);
    expect(result.result).toBe(true);
  });

  it('rejects invalid extraBody JSON before any request', () => {
    vi.stubGlobal('$option', { apiKey: 'sk-test', extraBody: '{bad json' });
    let requested = false;
    vi.stubGlobal('$http', {
      request: () => {
        requested = true;
      },
    });
    let result: any = null;
    pluginValidate((r: any) => {
      result = r;
    });
    expect(requested).toBe(false);
    expect(result.result).toBe(false);
    expect(result.error.type).toBe('param');
  });
});
