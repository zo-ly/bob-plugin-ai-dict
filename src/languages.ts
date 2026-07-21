export const LANGUAGES: Record<string, string> = {
  auto: '自动检测',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁体中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  pt: '葡萄牙语',
  it: '意大利语',
  ru: '俄语',
  nl: '荷兰语',
  ar: '阿拉伯语',
  th: '泰语',
  vi: '越南语',
  id: '印尼语',
  tr: '土耳其语',
};

export function supportLanguages(): string[] {
  return Object.keys(LANGUAGES);
}

export function langName(code: string): string {
  return LANGUAGES[code] || code;
}
