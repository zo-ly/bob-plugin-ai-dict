// AI Dict 翻译 — Bob 插件
// 句子走普通翻译（toParagraphs），单词/短语走词典模式。
// 为了更快出结果，两条路径都用流式请求（$http.streamRequest）：
//   - 边生成边通过 query.onStream 推 toParagraphs 预览；
//   - 结束后再把词典模式的文本解析成 toDict，渲染成真正的词典卡片。
// 词典模式让 LLM 输出一种「每行一个字段」的紧凑纯文本（而非 JSON）：
// token 更少 → 生成更快，流式时本身就像词典条目，解析失败时已流出的文本就是天然兜底。
// translateResult 结构参考：https://bobtranslate.com/plugin/object/translateresult.html

var LANGUAGES = {
    'auto': '自动检测',
    'zh-Hans': '简体中文',
    'zh-Hant': '繁体中文',
    'en': '英语',
    'ja': '日语',
    'ko': '韩语',
    'fr': '法语',
    'de': '德语',
    'es': '西班牙语',
    'pt': '葡萄牙语',
    'it': '意大利语',
    'ru': '俄语',
    'nl': '荷兰语',
    'ar': '阿拉伯语',
    'th': '泰语',
    'vi': '越南语',
    'id': '印尼语',
    'tr': '土耳其语'
};

function supportLanguages() {
    return Object.keys(LANGUAGES);
}

function pluginTimeoutInterval() {
    return 60;
}

function langName(code) {
    return LANGUAGES[code] || code;
}

// 单词/短语判定：纯拉丁字母（允许连字符、撇号），最多 3 个词
function isDictQuery(text) {
    var t = text.trim();
    if (!t || t.length > 60) return false;
    var words = t.split(/\s+/);
    if (words.length > 3) return false;
    return /^[A-Za-z][A-Za-z\-'’]*(\s+[A-Za-z][A-Za-z\-'’]*)*$/.test(t);
}

function buildDictSystemPrompt(query) {
    var src = langName(query.detectFrom);
    var dst = langName(query.detectTo);
    var prompt = [
        '你是一个专业的词典引擎。用户输入一个' + src + '单词或词组，请用' + dst + '输出词典条目。',
        '只能输出下面这种「每行一个字段」的纯文本，禁止 Markdown、代码块标记、JSON、注释或任何解释性文字。',
        '每行以大写英文字段前缀开头（必须原样保留 WORD/US/UK/POS/FORM/EX/NOTE），冒号后是内容：',
        'WORD: <原词>',
        'US: <美式音标，不带斜杠；没有就省略整行>',
        'UK: <英式音标，不带斜杠；没有就省略整行>',
        'POS: <词性缩写，如 n./vt./adj.> | <释义1>；<释义2>；<释义3>',
        'FORM: <变形名，如 复数/过去式/现在分词/比较级> = <对应单词>',
        'EX: <原文例句> | <该例句的' + dst + '翻译>',
        'NOTE: <词根词缀或联想记忆，一句话>',
        '规则：',
        '- POS 至少一行，可多行，按常用程度排序；同一词性的多个释义写在同一行、用「；」分隔；',
        '- FORM 每种变形单独一行，只写真实存在的变形，没有就省略，禁止编造；',
        '- 词组或没有音标的词，省略 US/UK 行；',
        '- EX 给 1-2 行，NOTE 给 1 行；',
        '- 除上述字段行外，不要输出任何其他内容。'
    ].join('\n');

    var extra = ($option.dictPromptExtra || '').trim();
    if (extra) {
        prompt += '\n补充要求：' + extra;
    }
    return prompt;
}

function buildTranslateSystemPrompt(query) {
    var src = langName(query.detectFrom);
    var dst = langName(query.detectTo);
    var custom = ($option.translatePrompt || '').trim();
    if (custom) {
        return custom
            .replace(/\$sourceLang/g, src)
            .replace(/\$targetLang/g, dst)
            .replace(/\$text/g, query.text);
    }
    return '你是一个专业的翻译引擎。请将用户输入的' + src + '文本翻译成' + dst +
        '，只输出译文本身，保留原文的段落结构，不要任何解释或额外内容。';
}

function stripSlashes(s) {
    return (s || '').replace(/^\/+|\/+$/g, '').trim();
}

// 把紧凑行格式解析成合法的 toDict；没有词性词义则返回 null，由调用方兜底
function parseDictText(text, queryText) {
    var dict = { word: queryText, parts: [] };
    var phonetics = [];
    var exchanges = [];
    var additions = [];

    (text || '').split('\n').forEach(function (raw) {
        var line = raw.replace(/\r$/, '').trim();
        if (!line) return;
        var idx = line.indexOf(':');
        if (idx === -1) return;
        var tag = line.slice(0, idx).trim().toUpperCase();
        var val = line.slice(idx + 1).trim();
        if (!val) return;

        switch (tag) {
            case 'WORD':
                dict.word = val;
                break;
            case 'US':
                phonetics.push({ type: 'us', value: stripSlashes(val) });
                break;
            case 'UK':
                phonetics.push({ type: 'uk', value: stripSlashes(val) });
                break;
            case 'POS': {
                var pi = val.indexOf('|');
                var part = pi === -1 ? '' : val.slice(0, pi).trim();
                var meansStr = pi === -1 ? val : val.slice(pi + 1);
                var means = meansStr.split(/[;；]/).map(function (m) { return m.trim(); })
                    .filter(function (m) { return m; });
                if (means.length) dict.parts.push({ part: part, means: means });
                break;
            }
            case 'FORM': {
                var ei = val.indexOf('=');
                if (ei === -1) break;
                var name = val.slice(0, ei).trim();
                var words = val.slice(ei + 1).split(/[,，、]/).map(function (w) { return w.trim(); })
                    .filter(function (w) { return w; });
                if (name && words.length) exchanges.push({ name: name, words: words });
                break;
            }
            case 'EX': {
                var xi = val.indexOf('|');
                var value = xi === -1 ? val : (val.slice(0, xi).trim() + '\n' + val.slice(xi + 1).trim());
                additions.push({ name: '例句', value: value });
                break;
            }
            case 'NOTE':
                additions.push({ name: '记忆提示', value: val });
                break;
            default:
                break;
        }
    });

    // 词典卡片至少要有词性词义，否则不如退回普通文本展示
    if (!dict.parts.length) return null;
    if (phonetics.length) dict.phonetics = phonetics;
    if (exchanges.length) dict.exchanges = exchanges;
    if (additions.length) dict.additions = additions;
    return dict;
}

// 流式预览 / 解析失败兜底：把紧凑行格式转成更易读的段落
function dictPreviewParagraphs(text) {
    var out = [];
    (text || '').split('\n').forEach(function (raw) {
        var line = raw.replace(/\r$/, '').trim();
        if (!line) return;
        var idx = line.indexOf(':');
        if (idx === -1) { out.push(line); return; }
        var tag = line.slice(0, idx).trim().toUpperCase();
        var val = line.slice(idx + 1).trim();
        switch (tag) {
            case 'WORD': out.push(val); break;
            case 'US': out.push('美 /' + stripSlashes(val) + '/'); break;
            case 'UK': out.push('英 /' + stripSlashes(val) + '/'); break;
            case 'POS': out.push(val.replace('|', ' ').trim()); break;
            case 'FORM': out.push(val.replace('=', '：').trim()); break;
            case 'EX': out.push(val.replace('|', ' — ').trim()); break;
            case 'NOTE': out.push('💡 ' + val); break;
            default: out.push(val || line);
        }
    });
    return out.length ? out : [text || ''];
}

function textToParagraphs(text) {
    var paragraphs = (text || '').split('\n')
        .map(function (line) { return line.trim(); })
        .filter(function (line) { return line; });
    return paragraphs.length ? paragraphs : [text || ''];
}

function translate(query, completion) {
    var finished = false;
    function emitCompletion(payload) {
        if (finished) return;
        finished = true;
        // Bob 1.8+ 提供 query.onCompletion，更早版本用 completion 参数
        if (typeof query.onCompletion === 'function') {
            query.onCompletion(payload);
        } else {
            completion(payload);
        }
    }

    var apiUrl = ($option.apiUrl || '').trim() || 'https://api.openai.com/v1/chat/completions';
    var apiKey = ($option.apiKey || '').trim();
    var model = ($option.model || '').trim() || 'gpt-4o-mini';

    if (!apiKey && apiUrl.indexOf('api.openai.com') !== -1) {
        emitCompletion({
            error: {
                type: 'secretKey',
                message: '请在插件设置中填写 API Key',
                addtion: ''
            }
        });
        return;
    }

    var dictMode = isDictQuery(query.text);
    var systemPrompt = dictMode ? buildDictSystemPrompt(query) : buildTranslateSystemPrompt(query);

    var header = { 'Content-Type': 'application/json' };
    if (apiKey) {
        header['Authorization'] = 'Bearer ' + apiKey;
    }

    // 只走流式；老版本 Bob（无 streamRequest/onStream）自动回退非流式
    // 注意：温度 0.2 对少数推理模型（o1/o3 等）不被接受，此处默认 gpt-4o-mini 无碍
    var canStream = typeof $http.streamRequest === 'function'
        && typeof query.onStream === 'function';

    function buildBody(streamFlag) {
        var body = {
            model: model,
            temperature: 0.2,
            stream: streamFlag,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: query.text }
            ]
        };
        // 词典输出体量可控，加上限防止偶发超长生成拖慢；句子翻译不限长，避免截断
        if (dictMode) body.max_tokens = 700;
        return body;
    }

    function buildResult(fullText) {
        var result = { from: query.detectFrom, to: query.detectTo };
        if (dictMode) {
            var dict = parseDictText(fullText, query.text.trim());
            if (dict) {
                result.toDict = dict;
            } else {
                result.toParagraphs = dictPreviewParagraphs(fullText);
            }
        } else {
            result.toParagraphs = textToParagraphs(fullText);
        }
        return result;
    }

    function networkError(err) {
        return {
            error: {
                type: 'network',
                message: '接口请求失败：' + ((err && err.message) || '未知网络错误'),
                addtion: (err && err.debugMessage) || ''
            }
        };
    }

    function apiError(statusCode, message) {
        return {
            error: {
                type: statusCode === 401 ? 'secretKey' : 'api',
                message: '接口返回错误：' + message,
                addtion: ''
            }
        };
    }

    // 非流式请求（回退路径）
    function runBlocking() {
        $http.request({
            method: 'POST',
            url: apiUrl,
            header: header,
            timeout: 60,
            cancelSignal: query.cancelSignal,
            body: buildBody(false),
            handler: function (resp) {
                if (resp.error) {
                    emitCompletion(networkError(resp.error));
                    return;
                }
                var data = resp.data;
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (e) { data = null; }
                }
                var statusCode = (resp.response && resp.response.statusCode) || 0;
                if (statusCode >= 400 || !data || !data.choices || !data.choices.length) {
                    var apiMessage = (data && data.error && (data.error.message || data.error)) || ('HTTP ' + statusCode);
                    emitCompletion(apiError(statusCode, apiMessage));
                    return;
                }
                var content = (data.choices[0].message && data.choices[0].message.content) || '';
                emitCompletion({ result: buildResult(content) });
            }
        });
    }

    // 流式请求：边生成边推 toParagraphs 预览，结束后再收敛成 toDict
    function runStream() {
        var targetText = '';
        var streamError = null;
        var sseBuffer = '';

        $http.streamRequest({
            method: 'POST',
            url: apiUrl,
            header: header,
            timeout: 60,
            cancelSignal: query.cancelSignal,
            body: buildBody(true),
            streamHandler: function (stream) {
                if (!stream || !stream.text) return;
                // stream.text 是增量片段，可能从事件中间切断：缓冲住最后半行，只处理完整行
                sseBuffer += stream.text;
                var parts = sseBuffer.split('\n');
                sseBuffer = parts.pop();
                parts.forEach(function (line) {
                    line = line.replace(/\r$/, '');
                    var m = /^data:\s?(.*)$/.exec(line);
                    if (!m) return;
                    var payload = m[1];
                    if (!payload || payload === '[DONE]') return;
                    var obj;
                    try { obj = JSON.parse(payload); } catch (e) { return; }
                    if (obj.error) { streamError = obj.error; return; }
                    var choice = obj.choices && obj.choices[0];
                    var delta = choice && choice.delta && choice.delta.content;
                    if (typeof delta === 'string' && delta) {
                        targetText += delta;
                        query.onStream({
                            result: {
                                from: query.detectFrom,
                                to: query.detectTo,
                                toParagraphs: dictMode
                                    ? dictPreviewParagraphs(targetText)
                                    : textToParagraphs(targetText)
                            }
                        });
                    }
                });
            },
            handler: function (resp) {
                // 流内 API 错误：SSE 本身是通的，是应用层报错（模型无效/内容策略等），重试非流式也没用
                if (streamError) {
                    emitCompletion(apiError(0, streamError.message || '未知错误'));
                    return;
                }
                // 已经流出内容：直接用，不因收尾状态码/误报而丢弃
                if (targetText.trim()) {
                    emitCompletion({ result: buildResult(targetText) });
                    return;
                }
                // 以下都是「一个 delta 都没拿到」的情况
                if (resp && resp.error) {
                    emitCompletion(networkError(resp.error));
                    return;
                }
                var statusCode = (resp && resp.response && resp.response.statusCode) || 0;
                // 鉴权错误重试无意义；限流不重试，避免继续打爆端点
                if (statusCode === 401 || statusCode === 429) {
                    var data = resp.data;
                    if (typeof data === 'string') {
                        try { data = JSON.parse(data); } catch (e) { data = null; }
                    }
                    var msg = (data && data.error && (data.error.message || data.error)) || ('HTTP ' + statusCode);
                    emitCompletion(apiError(statusCode, msg));
                    return;
                }
                // 其余：200 但没流出内容（端点忽略了 stream），或 4xx/5xx 非鉴权非限流
                //（端点可能拒绝了 stream:true）——自动降级重试一次非流式
                runBlocking();
            }
        });
    }

    if (canStream) {
        runStream();
    } else {
        runBlocking();
    }
}
