import type { HttpResponse, PluginValidate, ValidationCompletion } from '@bob-translate/types';
import {
  apiMessageOf,
  emptyContentMessage,
  extraBodyErrorMessage,
  getOptions,
  parseData,
  parseExtraBody,
} from './translate';

type ValidationResult = Parameters<ValidationCompletion>[0];

// 响应 → 验证结果，抽成纯函数便于测试
export function validationOf(resp: HttpResponse): ValidationResult {
  if (resp.error) {
    const message = 'message' in resp.error ? resp.error.message : undefined;
    const debug = 'debugMessage' in resp.error ? resp.error.debugMessage : '';
    return {
      result: false,
      error: { type: 'network', message: `接口请求失败：${message || '未知网络错误'}`, addition: debug || '' },
    };
  }
  const data = parseData(resp.data);
  const statusCode = resp.response?.statusCode || 0;
  if (statusCode >= 400 || !data || !data.choices || !data.choices.length) {
    return {
      result: false,
      error: {
        type: statusCode === 401 ? 'secretKey' : 'api',
        message: `接口返回错误：${apiMessageOf(data, statusCode)}`,
        addition: '',
      },
    };
  }
  // 验证只管连通性：思考模型可能被服务端输出上限截在思考阶段、只回 reasoning_content，
  // 但这同样证明 URL/Key/模型有效，放行；content 与 reasoning_content 皆空才算异常
  const message = data.choices[0]?.message;
  const content = message?.content;
  if (typeof content === 'string' && content.trim()) return { result: true };
  if (message?.reasoning_content?.trim()) return { result: true };
  return {
    result: false,
    error: {
      type: 'api',
      message: `接口返回错误：${emptyContentMessage(data)}`,
      addition: '',
    },
  };
}

// 设置页「验证服务」按钮：发一次最小的非流式 chat 请求，校验 API 地址 / Key / 模型是否可用
export const pluginValidate: PluginValidate = (completion) => {
  const { apiUrl, apiKey, model, extraBody } = getOptions();

  let extra: Record<string, unknown> | null = null;
  try {
    extra = parseExtraBody(extraBody);
  } catch {
    completion({
      result: false,
      error: { type: 'param', message: extraBodyErrorMessage, addition: '' },
    });
    return;
  }

  if (!apiKey && apiUrl.indexOf('api.openai.com') !== -1) {
    completion({
      result: false,
      error: { type: 'secretKey', message: '请在插件设置中填写 API Key', addition: '' },
    });
    return;
  }

  const header: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    header.Authorization = `Bearer ${apiKey}`;
  }

  $http.request({
    method: 'POST',
    url: apiUrl,
    header,
    timeout: 15,
    body: {
      model,
      temperature: 0,
      ...extra,
      // stream 和 messages 是结构性字段，附加参数不可覆盖
      stream: false,
      messages: [{ role: 'user', content: 'ping' }],
    },
    handler(resp) {
      completion(validationOf(resp));
    },
  });
};
