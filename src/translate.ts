import type { HttpResponse, TextTranslate, TextTranslateQuery, TextTranslateResult } from '@bob-translate/types';
import { dictPreviewParagraphs, isDictQuery, parseDictText, textToParagraphs } from './dict';
import { buildDictSystemPrompt, buildTranslateSystemPrompt } from './prompt';
import { createOpenAiSseParser } from './sse';
import type { ChatCompletion, ChatRequestBody, PluginOptions } from './types';

// onCompletion / onStream 的载荷类型未导出，从函数签名推导。
type CompletionPayload = Parameters<TextTranslateQuery['onCompletion']>[0];

function getOptions(): PluginOptions {
  // || 兜住空串，以走默认值
  return {
    apiUrl: ($option.apiUrl || '').trim() || 'https://api.openai.com/v1/chat/completions',
    apiKey: ($option.apiKey || '').trim(),
    model: ($option.model || '').trim() || 'gpt-4o-mini',
    dictPromptExtra: ($option.dictPromptExtra || '').trim(),
    translatePrompt: ($option.translatePrompt || '').trim(),
  };
}

function parseData(raw: HttpResponse['data']): ChatCompletion | null {
  let data: unknown = raw;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  return data && typeof data === 'object' ? (data as ChatCompletion) : null;
}

function apiMessageOf(data: ChatCompletion | null, statusCode: number): string {
  const errVal = data?.error;
  const msg = errVal && (typeof errVal === 'string' ? errVal : errVal.message);
  return msg || `HTTP ${statusCode}`;
}

export const translate: TextTranslate = (query, completion) => {
  let finished = false;
  function emitCompletion(payload: CompletionPayload): void {
    if (finished) return;
    finished = true;
    // Bob 1.8+ 用 onCompletion，更早版本用 completion 参数
    if (typeof query.onCompletion === 'function') {
      query.onCompletion(payload);
    } else {
      completion(payload);
    }
  }

  const { apiUrl, apiKey, model, dictPromptExtra, translatePrompt } = getOptions();

  if (!apiKey && apiUrl.indexOf('api.openai.com') !== -1) {
    emitCompletion({
      error: { type: 'secretKey', message: '请在插件设置中填写 API Key', addition: '' },
    });
    return;
  }

  const dictMode = isDictQuery(query.text);
  const systemPrompt = dictMode
    ? buildDictSystemPrompt(query, dictPromptExtra)
    : buildTranslateSystemPrompt(query, translatePrompt);

  const header: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    header.Authorization = `Bearer ${apiKey}`;
  }

  // 只走流式；老版本 Bob（无 streamRequest/onStream）回退非流式
  const canStream = typeof $http.streamRequest === 'function' && typeof query.onStream === 'function';

  function buildBody(streamFlag: boolean): ChatRequestBody {
    const body: ChatRequestBody = {
      model,
      temperature: 0.2,
      stream: streamFlag,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query.text },
      ],
    };
    // 词典加 max_tokens 上限防超长；句子不限长避免截断
    if (dictMode) body.max_tokens = 700;
    return body;
  }

  function buildResult(fullText: string): TextTranslateResult {
    const from = query.detectFrom;
    const to = query.detectTo;
    if (dictMode) {
      const dict = parseDictText(fullText, query.text.trim());
      if (dict) {
        // 词典结果按 Bob 约定不带 toParagraphs；类型要求它，故断言以保持载荷形状
        return { from, to, toDict: dict } as TextTranslateResult;
      }
      return { from, to, toParagraphs: dictPreviewParagraphs(fullText) };
    }
    return { from, to, toParagraphs: textToParagraphs(fullText) };
  }

  function networkError(err: HttpResponse['error']): CompletionPayload {
    const message = err && 'message' in err ? err.message : undefined;
    const debug = err && 'debugMessage' in err ? err.debugMessage : '';
    return {
      error: {
        type: 'network',
        message: `接口请求失败：${message || '未知网络错误'}`,
        addition: debug || '',
      },
    };
  }

  function apiError(statusCode: number, message: string): CompletionPayload {
    return {
      error: {
        type: statusCode === 401 ? 'secretKey' : 'api',
        message: `接口返回错误：${message}`,
        addition: '',
      },
    };
  }

  function runBlocking(): void {
    $http.request({
      method: 'POST',
      url: apiUrl,
      header,
      timeout: 60,
      cancelSignal: query.cancelSignal,
      body: buildBody(false),
      handler(resp) {
        if (resp.error) {
          emitCompletion(networkError(resp.error));
          return;
        }
        const data = parseData(resp.data);
        const statusCode = resp.response?.statusCode || 0;
        if (statusCode >= 400 || !data || !data.choices || !data.choices.length) {
          emitCompletion(apiError(statusCode, apiMessageOf(data, statusCode)));
          return;
        }
        const first = data.choices[0];
        const content = first?.message?.content || '';
        emitCompletion({ result: buildResult(content) });
      },
    });
  }

  function runStream(): void {
    let targetText = '';
    let streamError: { message?: string } | null = null;
    const parser = createOpenAiSseParser();

    $http.streamRequest({
      method: 'POST',
      url: apiUrl,
      header,
      timeout: 60,
      cancelSignal: query.cancelSignal,
      body: buildBody(true),
      streamHandler(stream) {
        if (!stream?.text) return;
        const { deltas, error } = parser.push(stream.text);
        if (error) streamError = error;
        for (const delta of deltas) {
          targetText += delta;
          query.onStream({
            result: {
              from: query.detectFrom,
              to: query.detectTo,
              toParagraphs: dictMode ? dictPreviewParagraphs(targetText) : textToParagraphs(targetText),
            },
          });
        }
      },
      handler(resp) {
        // 流内应用层报错（SSE 是通的），重试非流式无用
        if (streamError) {
          emitCompletion(apiError(0, streamError.message || '未知错误'));
          return;
        }
        // 已流出内容：直接用，不因收尾状态码丢弃
        if (targetText.trim()) {
          emitCompletion({ result: buildResult(targetText) });
          return;
        }
        // 以下均为一个 delta 都没拿到的情况
        if (resp?.error) {
          emitCompletion(networkError(resp.error));
          return;
        }
        const statusCode = resp?.response?.statusCode || 0;
        // 鉴权无意义、限流避免打爆：不重试
        if (statusCode === 401 || statusCode === 429) {
          emitCompletion(apiError(statusCode, apiMessageOf(parseData(resp.data), statusCode)));
          return;
        }
        // 空响应或非鉴权非限流错误（端点可能拒绝了 stream）：降级重试一次非流式
        runBlocking();
      },
    });
  }

  if (canStream) {
    runStream();
  } else {
    runBlocking();
  }
};
