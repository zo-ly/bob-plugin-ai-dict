import type { TextTranslateQuery } from '@bob-translate/types';
import { langName } from './languages';

export function buildDictSystemPrompt(query: TextTranslateQuery, dictPromptExtra: string): string {
  const src = langName(query.detectFrom);
  const dst = langName(query.detectTo);
  let prompt = [
    `你是一个专业的词典引擎。用户输入一个${src}单词或词组，请用${dst}输出词典条目。`,
    '只能输出下面这种「每行一个字段」的纯文本，禁止 Markdown、代码块标记、JSON、注释或任何解释性文字。',
    '每行以大写英文字段前缀开头（必须原样保留 WORD/US/UK/POS/FORM/EX/NOTE），冒号后是内容：',
    'WORD: <原词>',
    'US: <美式音标，不带斜杠；没有就省略整行>',
    'UK: <英式音标，不带斜杠；没有就省略整行>',
    'POS: <词性缩写，如 n./vt./adj.> | <释义1>；<释义2>；<释义3>',
    'FORM: <变形名，如 复数/过去式/现在分词/比较级> = <对应单词>',
    `EX: <原文例句> | <该例句的${dst}翻译>`,
    'NOTE: <词根词缀或联想记忆，一句话>',
    '规则：',
    '- POS 至少一行，可多行，按常用程度排序；同一词性的多个释义写在同一行、用「；」分隔；',
    '- FORM 每种变形单独一行，只写真实存在的变形，没有就省略，禁止编造；',
    '- 词组或没有音标的词，省略 US/UK 行；',
    '- EX 给 1-2 行，NOTE 给 1 行；',
    '- 除上述字段行外，不要输出任何其他内容。',
  ].join('\n');

  if (dictPromptExtra) {
    prompt += `\n补充要求：${dictPromptExtra}`;
  }
  return prompt;
}

export function buildTranslateSystemPrompt(query: TextTranslateQuery, translatePrompt: string): string {
  const src = langName(query.detectFrom);
  const dst = langName(query.detectTo);
  if (translatePrompt) {
    return translatePrompt
      .replace(/\$sourceLang/g, src)
      .replace(/\$targetLang/g, dst)
      .replace(/\$text/g, query.text);
  }
  return (
    '你是一个专业的翻译引擎。请将用户输入的' +
    src +
    '文本翻译成' +
    dst +
    '，只输出译文本身，保留原文的段落结构，不要任何解释或额外内容。'
  );
}
