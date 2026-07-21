# AI Dict 翻译 — Bob 插件

Bob 翻译插件：**句子正常翻译，单词/短语返回 Bob 原生词典卡片**（音标、词性词义、变形、例句）。

## 效果

| 单词 → 词典卡片 | 句子 → 普通翻译 |
|:---:|:---:|
| <img src="screenshots/dict-mode.png" width="380" alt="查单词：音标、词性词义、复数变形、例句、记忆提示"> | <img src="screenshots/sentence-mode.png" width="380" alt="翻译整句：与其他 AI 服务一致的普通译文"> |

查单词时展示音标（美/英）、词性词义、变形（可点击跳查）、例句和词根记忆提示；整句输入自动切回普通翻译模式。

## 原理

Bob 的词典 UI 只在服务返回 [`toDict`](https://bobtranslate.com/plugin/object/translateresult.html) 结构时才渲染。本插件判断输入是单词/短语（≤3 个拉丁词）还是整句：单词让 LLM 输出紧凑的「每行一个字段」文本再解析成 `toDict`，整句走普通翻译填 `toParagraphs`。两条路径都流式输出、边生成边预览；解析失败或老版本 Bob 自动回退为纯文本 / 非流式。

## 安装

到 [Releases](https://github.com/zo-ly/bob-plugin-ai-dict/releases) 下载最新的 `ai-dict-x.x.x.bobplugin`，双击安装进 Bob。之后 Bob 会通过 `appcast.json` 自动检查更新。

然后在 Bob「设置 → 服务」中添加「AI Dict 翻译」，填写配置。

## 配置项

| 选项 | 说明 |
|------|------|
| API 地址 | OpenAI 兼容接口。DeepSeek：`https://api.deepseek.com/chat/completions`；Ollama：`http://localhost:11434/v1/chat/completions` |
| API Key | 密钥；本地模型可留空 |
| 模型 | `gpt-4o-mini` / `deepseek-chat` / `qwen2.5` 等 |
| 词典模式附加要求 | 追加到单词 Prompt 末尾，如"例句偏向计算机领域" |
| 句子翻译 Prompt | 留空用内置；支持 `$sourceLang` `$targetLang` `$text` 变量 |

## 开发

TypeScript 源码在 `src/`，用 esbuild 打包成单个 `dist/main.js`（`dist/` 已 gitignore，发版时由 CI 构建）。

```bash
npm install         # 安装依赖
npm test            # Vitest 单元测试
npm run package     # 类型检查 + 构建 + 打包成 .bobplugin
npm run package:dev # 调试包（版本号自动用时间戳，便于反复安装）
```
