import type { HttpResponse, PluginValidate, ValidationCompletion } from '@bob-translate/types';
import { apiMessageOf, emptyContentMessage, getOptions, parseData } from './translate';

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
  // 空正文不算验证通过：思考模型可能只返回 reasoning_content，翻译时会一直空白
  const content = data.choices[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    return {
      result: false,
      error: {
        type: 'api',
        message: `接口返回错误：${emptyContentMessage(data)}`,
        addition: '',
      },
    };
  }
  return { result: true };
}

// 设置页「验证服务」按钮：发一次最小的非流式 chat 请求，校验 API 地址 / Key / 模型是否可用
export const pluginValidate: PluginValidate = (completion) => {
  const { apiUrl, apiKey, model } = getOptions();

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
      stream: false,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    },
    handler(resp) {
      completion(validationOf(resp));
    },
  });
};
