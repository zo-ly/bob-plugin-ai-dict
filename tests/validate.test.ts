import type { HttpResponse } from '@bob-translate/types';
import { describe, expect, it } from 'vitest';
import { validationOf } from '../src/validate';

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
});
