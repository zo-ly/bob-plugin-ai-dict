import type { TextTranslateQuery } from '@bob-translate/types';
import { describe, expect, it } from 'vitest';
import { buildDictSystemPrompt, buildReverseDictSystemPrompt, buildTranslateSystemPrompt } from '../src/prompt';

const q = { text: 'hello', detectFrom: 'en', detectTo: 'zh-Hans' } as unknown as TextTranslateQuery;

describe('buildDictSystemPrompt', () => {
  it('includes the field tags and localized languages', () => {
    const p = buildDictSystemPrompt(q, '');
    expect(p).toContain('WORD:');
    expect(p).toContain('POS:');
    expect(p).toContain('英语');
    expect(p).toContain('简体中文');
  });
  it('pins phonetic conventions for US/UK', () => {
    const p = buildDictSystemPrompt(q, '');
    expect(p).toContain('GenAm');
    expect(p).toContain('RP');
  });
  it('appends extra requirement when provided', () => {
    expect(buildDictSystemPrompt(q, '例句偏计算机')).toContain('补充要求：例句偏计算机');
  });
  it('omits 补充要求 when extra is empty', () => {
    expect(buildDictSystemPrompt(q, '')).not.toContain('补充要求');
  });
});

describe('buildReverseDictSystemPrompt', () => {
  const rq = { text: '星期六', detectFrom: 'zh-Hans', detectTo: 'en' } as unknown as TextTranslateQuery;
  it('asks for the english headword and includes field tags', () => {
    const p = buildReverseDictSystemPrompt(rq, '');
    expect(p).toContain('英文对应词');
    expect(p).toContain('WORD:');
    expect(p).toContain('ALT:');
    expect(p).toContain('简体中文');
  });
  it('lets the model fall back to plain translation for sentences', () => {
    expect(buildReverseDictSystemPrompt(rq, '')).toContain('句子');
  });
  it('covers multi-word idiom headwords', () => {
    expect(buildReverseDictSystemPrompt(rq, '')).toContain('idiom');
  });
  it('appends extra requirement when provided', () => {
    expect(buildReverseDictSystemPrompt(rq, '例句偏日常口语')).toContain('补充要求：例句偏日常口语');
  });
});

describe('buildTranslateSystemPrompt', () => {
  it('substitutes $sourceLang/$targetLang/$text in a custom template', () => {
    const p = buildTranslateSystemPrompt(q, '把 $sourceLang 翻成 $targetLang：$text');
    expect(p).toBe('把 英语 翻成 简体中文：hello');
  });
  it('falls back to the built-in prompt when empty', () => {
    expect(buildTranslateSystemPrompt(q, '')).toContain('专业的翻译引擎');
  });
});
