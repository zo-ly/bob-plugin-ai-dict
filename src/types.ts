export interface Phonetic {
  type: 'us' | 'uk';
  value: string;
}

export interface Part {
  part: string;
  means: string[];
}

export interface Exchange {
  name: string;
  words: string[];
}

export interface Addition {
  name: string;
  value: string;
}

// 对应 Bob 的 ToDictObject（该接口在 @bob-translate/types 内未导出，按结构复刻）。
export interface DictObject {
  word: string;
  parts: Part[];
  phonetics: Phonetic[];
  exchanges?: Exchange[];
  additions?: Addition[];
}

export interface PluginOptions {
  apiUrl: string;
  apiKey: string;
  model: string;
  dictPromptExtra: string;
  translatePrompt: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequestBody {
  model: string;
  temperature: number;
  stream: boolean;
  messages: ChatMessage[];
  max_tokens?: number;
}

export interface ChatCompletionChoice {
  message?: { content?: string };
  delta?: { content?: string };
}

export interface ChatCompletion {
  choices?: ChatCompletionChoice[];
  error?: { message?: string } | string;
}
