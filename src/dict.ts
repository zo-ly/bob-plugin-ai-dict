import type { Addition, DictObject, Exchange, Part, Phonetic } from './types';

// 单词/短语判定：≤3 个拉丁词（允许连字符、撇号）
export function isDictQuery(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 60) return false;
  const words = t.split(/\s+/);
  if (words.length > 3) return false;
  return /^[A-Za-z][A-Za-z\-'’]*(\s+[A-Za-z][A-Za-z\-'’]*)*$/.test(t);
}

export function stripSlashes(s: string): string {
  return (s || '').replace(/^\/+|\/+$/g, '').trim();
}

// 紧凑行格式 → toDict；无词性词义时返回 null，由调用方兜底
export function parseDictText(text: string, queryText: string): DictObject | null {
  let word = queryText;
  const phonetics: Phonetic[] = [];
  const parts: Part[] = [];
  const exchanges: Exchange[] = [];
  const additions: Addition[] = [];

  for (const raw of (text || '').split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const tag = line.slice(0, idx).trim().toUpperCase();
    const val = line.slice(idx + 1).trim();
    if (!val) continue;

    switch (tag) {
      case 'WORD':
        word = val;
        break;
      case 'US':
        phonetics.push({ type: 'us', value: stripSlashes(val) });
        break;
      case 'UK':
        phonetics.push({ type: 'uk', value: stripSlashes(val) });
        break;
      case 'POS': {
        const pi = val.indexOf('|');
        const part = pi === -1 ? '' : val.slice(0, pi).trim();
        const meansStr = pi === -1 ? val : val.slice(pi + 1);
        const means = meansStr
          .split(/[;；]/)
          .map((m) => m.trim())
          .filter((m) => m);
        if (means.length) parts.push({ part, means });
        break;
      }
      case 'FORM': {
        const ei = val.indexOf('=');
        if (ei === -1) break;
        const name = val.slice(0, ei).trim();
        const words = val
          .slice(ei + 1)
          .split(/[,，、]/)
          .map((w) => w.trim())
          .filter((w) => w);
        if (name && words.length) exchanges.push({ name, words });
        break;
      }
      case 'EX': {
        const xi = val.indexOf('|');
        const value = xi === -1 ? val : `${val.slice(0, xi).trim()}\n${val.slice(xi + 1).trim()}`;
        additions.push({ name: '例句', value });
        break;
      }
      case 'NOTE':
        additions.push({ name: '记忆提示', value: val });
        break;
      default:
        break;
    }
  }

  if (!parts.length) return null;
  // ToDictObject 要求 phonetics 必填，为空也要带上
  const dict: DictObject = { word, parts, phonetics };
  if (exchanges.length) dict.exchanges = exchanges;
  if (additions.length) dict.additions = additions;
  return dict;
}

// 流式预览 / 解析失败兜底：紧凑行格式 → 易读段落
export function dictPreviewParagraphs(text: string): string[] {
  const out: string[] = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) {
      out.push(line);
      continue;
    }
    const tag = line.slice(0, idx).trim().toUpperCase();
    const val = line.slice(idx + 1).trim();
    switch (tag) {
      case 'WORD':
        out.push(val);
        break;
      case 'US':
        out.push(`美 /${stripSlashes(val)}/`);
        break;
      case 'UK':
        out.push(`英 /${stripSlashes(val)}/`);
        break;
      case 'POS':
        out.push(val.replace('|', ' ').trim());
        break;
      case 'FORM':
        out.push(val.replace('=', '：').trim());
        break;
      case 'EX':
        out.push(val.replace('|', ' — ').trim());
        break;
      case 'NOTE':
        out.push(`💡 ${val}`);
        break;
      default:
        out.push(val || line);
    }
  }
  return out.length ? out : [text || ''];
}

export function textToParagraphs(text: string): string[] {
  const paragraphs = (text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line);
  return paragraphs.length ? paragraphs : [text || ''];
}
