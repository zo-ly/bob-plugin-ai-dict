import { describe, expect, it } from 'vitest';
import {
  applyYoudaoPhones,
  dictHeadword,
  dictPreviewParagraphs,
  isCjkDictQuery,
  isDictQuery,
  parseDictText,
  parseYoudaoPhones,
} from '../src/dict';

const sample = [
  'WORD: run',
  'US: rʌn',
  'UK: /rʌn/',
  'POS: v. | 跑；经营；运行',
  'POS: n. | 奔跑；一段路程',
  'FORM: 过去式 = ran',
  'FORM: 现在分词 = running',
  'EX: I run every morning. | 我每天早上跑步。',
  'NOTE: 拟声/动作词，联想“奔跑”',
].join('\n');

describe('parseDictText', () => {
  const d = parseDictText(sample, 'run')!;

  it('parses word', () => expect(d.word).toBe('run'));

  it('strips slashes from phonetics', () => {
    expect(d.phonetics.map((p) => p.value)).toEqual(['rʌn', 'rʌn']);
    expect(d.phonetics.map((p) => p.type)).toEqual(['us', 'uk']);
  });

  it('attaches youdao tts url per phonetic type', () => {
    expect(d.phonetics[0]?.tts).toEqual({ type: 'url', value: 'https://dict.youdao.com/dictvoice?audio=run&type=2' });
    expect(d.phonetics[1]?.tts).toEqual({ type: 'url', value: 'https://dict.youdao.com/dictvoice?audio=run&type=1' });
  });

  it('builds tts url from the WORD line, url-encoded', () => {
    const x = parseDictText("WORD: mother's day\nUS: ˈmʌðərz deɪ\nPOS: n. | 母亲节", 'mothers day')!;
    expect(x.phonetics[0]?.tts?.value).toBe(
      `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent("mother's day")}&type=2`,
    );
  });

  it('splits parts and means', () => {
    expect(d.parts).toHaveLength(2);
    expect(d.parts[0]).toEqual({ part: 'v.', means: ['跑', '经营', '运行'] });
  });

  it('parses exchanges', () => {
    expect(d.exchanges).toHaveLength(2);
    expect(d.exchanges?.[0]).toEqual({ name: '过去式', words: ['ran'] });
  });

  it('joins example with newline', () => {
    expect(d.additions?.[0]).toEqual({ name: '例句', value: 'I run every morning.\n我每天早上跑步。' });
  });

  it('maps NOTE to 记忆提示', () => expect(d.additions?.[1]?.name).toBe('记忆提示'));

  it('maps ALT to 其他译法', () => {
    const x = parseDictText('WORD: happy\nPOS: adj. | 高兴的\nALT: glad, pleased', '高兴')!;
    expect(x.additions).toContainEqual({ name: '其他译法', value: 'glad, pleased' });
  });

  it('returns null when no parts', () => expect(parseDictText('WORD: foo\nUK: fu', 'foo')).toBeNull());

  it('handles POS without pipe (means only)', () => {
    const x = parseDictText('POS: 跑；走', 'x')!;
    expect(x.parts[0]?.part).toBe('');
    expect(x.parts[0]?.means).toEqual(['跑', '走']);
  });

  it('always includes a phonetics array (even empty)', () => {
    const x = parseDictText('POS: n. | 猫', 'cat')!;
    expect(x.phonetics).toEqual([]);
  });
});

describe('dictPreviewParagraphs', () => {
  const prev = dictPreviewParagraphs(sample);
  it('prettifies phonetics', () => {
    expect(prev).toContain('美 /rʌn/');
    expect(prev).toContain('英 /rʌn/');
  });
  it('prefixes NOTE with a bulb', () => expect(prev.some((l) => l.startsWith('💡'))).toBe(true));
  it('prefixes ALT with 又译', () => {
    expect(dictPreviewParagraphs('ALT: glad, pleased')).toEqual(['又译 glad, pleased']);
  });
  it('keeps the whole line for unknown colon lines (plain translation fallback)', () => {
    expect(dictPreviewParagraphs('He said: hello')).toEqual(['He said: hello']);
  });
});

describe('isDictQuery', () => {
  it('treats 1-3 latin words as dict queries', () => {
    expect(isDictQuery('run')).toBe(true);
    expect(isDictQuery("mother's day")).toBe(true);
    expect(isDictQuery('give up')).toBe(true);
  });
  it('rejects full sentences', () => expect(isDictQuery('this is a whole sentence to translate')).toBe(false));
  it('rejects non-latin input', () => expect(isDictQuery('你好')).toBe(false));
});

describe('isCjkDictQuery', () => {
  it('accepts all-han words up to 10 chars', () => {
    expect(isCjkDictQuery('星期六')).toBe(true);
    expect(isCjkDictQuery('高兴')).toBe(true);
    expect(isCjkDictQuery('一心一意')).toBe(true);
    expect(isCjkDictQuery('一言既出驷马难追')).toBe(true);
  });
  it('rejects text longer than 10 chars', () => {
    expect(isCjkDictQuery('这是一个需要翻译的完整句子')).toBe(false);
  });
  it('rejects punctuation, spaces, and mixed scripts', () => {
    expect(isCjkDictQuery('你好，世界')).toBe(false);
    expect(isCjkDictQuery('星期 六')).toBe(false);
    expect(isCjkDictQuery('周six')).toBe(false);
    expect(isCjkDictQuery('Saturday')).toBe(false);
  });
  it('rejects empty input', () => expect(isCjkDictQuery('  ')).toBe(false));
});

describe('youdao phones', () => {
  const yd = (word: string, us?: string, uk?: string) => ({
    ec: { word: [{ 'return-phrase': { l: { i: word } }, usphone: us, ukphone: uk }] },
  });

  it('parses us/uk phones from object or JSON string', () => {
    expect(parseYoudaoPhones(yd('record', 'ˈrekərd; rɪˈkɔːrd', 'ˈrekɔːd'), 'record')).toEqual({
      word: 'record',
      us: 'ˈrekərd; rɪˈkɔːrd',
      uk: 'ˈrekɔːd',
    });
    expect(parseYoudaoPhones(JSON.stringify(yd('Apple', 'ˈæp(ə)l')), 'apple')?.us).toBe('ˈæp(ə)l');
  });

  it('returns null for mismatched headword, no phones, or malformed data', () => {
    expect(parseYoudaoPhones(yd('receive', 'rɪˈsiːv'), 'recieve')).toBeNull();
    expect(parseYoudaoPhones(yd('recieve'), 'recieve')).toBeNull();
    expect(parseYoudaoPhones('<html>', 'run')).toBeNull();
    expect(parseYoudaoPhones({ ec: {} }, 'run')).toBeNull();
    expect(parseYoudaoPhones(null, 'run')).toBeNull();
  });

  const dict = parseDictText('WORD: run\nUS: rʌn\nUK: rʌn\nPOS: v. | 跑', 'run')!;

  it('youdao overrides the types it has and keeps model phones for the rest', () => {
    const out = applyYoudaoPhones(dict, { word: 'run', uk: 'rʌn(UK)' });
    expect(out.phonetics.map((p) => [p.type, p.value])).toEqual([
      ['us', 'rʌn'],
      ['uk', 'rʌn(UK)'],
    ]);
    expect(out.phonetics[1]?.tts?.value).toContain('type=1');
  });

  it('adds phones the model omitted', () => {
    const bare = parseDictText('WORD: pre\nPOS: prefix. | 在…之前', 'pre')!;
    const out = applyYoudaoPhones(bare, { word: 'pre', us: 'prɪ', uk: 'ˈpriː' });
    expect(out.phonetics.map((p) => p.type)).toEqual(['us', 'uk']);
    expect(out.phonetics[0]?.tts?.value).toContain('audio=pre');
  });

  it('ignores null or phones for a different word', () => {
    expect(applyYoudaoPhones(dict, null)).toBe(dict);
    expect(applyYoudaoPhones(dict, { word: 'ran', us: 'ræn' })).toBe(dict);
  });

  it('dictHeadword reads the WORD line', () => {
    expect(dictHeadword('WORD: Saturday\r\nUS: x\n')).toBe('Saturday');
    expect(dictHeadword('I love you.')).toBe('');
  });
});
