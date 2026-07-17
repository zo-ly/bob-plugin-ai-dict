// AI Dict 翻译 — Bob 插件
// 句子走普通翻译（toParagraphs），单词/短语走词典模式：
// 让 LLM 输出严格 JSON，解析成 Bob 的 toDict 结构，渲染成真正的词典卡片。
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
        '严格输出一个 JSON 对象，禁止输出 markdown 代码块标记、注释或任何 JSON 以外的文字。结构如下：',
        '{',
        '  "word": "<原词>",',
        '  "phonetics": [{"type": "us", "value": "<美式音标，不带斜杠>"}, {"type": "uk", "value": "<英式音标，不带斜杠>"}],',
        '  "parts": [{"part": "<词性缩写，如 n. / vt. / adj.>", "means": ["<释义1>", "<释义2>"]}],',
        '  "exchanges": [{"name": "<形式名，如 复数 / 过去式 / 现在分词 / 比较级>", "words": ["<对应单词>"]}],',
        '  "additions": [{"name": "例句", "value": "<原文例句>\\n<例句的' + dst + '翻译>"}, {"name": "记忆提示", "value": "<词根词缀或联想记忆，一句话>"}]',
        '}',
        '要求：',
        '- parts 至少一项，按常用程度排序；',
        '- exchanges 只列真实存在的变形，没有就用空数组，禁止编造；',
        '- 词组或没有音标的词，phonetics 用空数组；',
        '- additions 建议包含 1-2 条例句和一条简短的记忆提示。'
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

// 剥掉可能的 ```json 围栏，截取首个 { 到最后一个 } 之间的内容再解析
function extractJson(text) {
    var t = (text || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var start = t.indexOf('{');
    var end = t.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
        return JSON.parse(t.slice(start, end + 1));
    } catch (e) {
        return null;
    }
}

// 把模型输出的 JSON 清洗成合法的 toDict；不合格返回 null，由调用方兜底
function buildToDict(queryText, obj) {
    if (!obj || typeof obj !== 'object') return null;

    var parts = [];
    (Array.isArray(obj.parts) ? obj.parts : []).forEach(function (p) {
        if (!p || !Array.isArray(p.means)) return;
        var means = p.means.filter(function (m) { return typeof m === 'string' && m.trim(); });
        if (!means.length) return;
        parts.push({ part: typeof p.part === 'string' ? p.part : '', means: means });
    });
    // 词典卡片至少要有词性词义，否则不如退回普通文本展示
    if (!parts.length) return null;

    var dict = {
        word: (typeof obj.word === 'string' && obj.word.trim()) ? obj.word.trim() : queryText,
        parts: parts
    };

    var phonetics = [];
    (Array.isArray(obj.phonetics) ? obj.phonetics : []).forEach(function (p) {
        if (!p || typeof p.value !== 'string' || !p.value.trim()) return;
        // 文档约束：type 必填且只能是 us / uk
        phonetics.push({ type: p.type === 'uk' ? 'uk' : 'us', value: p.value.trim() });
    });
    if (phonetics.length) dict.phonetics = phonetics;

    var exchanges = [];
    (Array.isArray(obj.exchanges) ? obj.exchanges : []).forEach(function (e) {
        if (!e || typeof e.name !== 'string' || !e.name.trim() || !Array.isArray(e.words)) return;
        var words = e.words.filter(function (w) { return typeof w === 'string' && w.trim(); });
        if (!words.length) return;
        exchanges.push({ name: e.name.trim(), words: words });
    });
    if (exchanges.length) dict.exchanges = exchanges;

    var additions = [];
    (Array.isArray(obj.additions) ? obj.additions : []).forEach(function (a) {
        if (!a || typeof a.name !== 'string' || !a.name.trim()) return;
        if (typeof a.value !== 'string' || !a.value.trim()) return;
        additions.push({ name: a.name.trim(), value: a.value });
    });
    if (additions.length) dict.additions = additions;

    return dict;
}

function textToParagraphs(text) {
    var paragraphs = (text || '').split('\n')
        .map(function (line) { return line.trim(); })
        .filter(function (line) { return line; });
    return paragraphs.length ? paragraphs : [text || ''];
}

function translate(query, completion) {
    var finished = false;
    function finish(payload) {
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
        finish({
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

    $http.request({
        method: 'POST',
        url: apiUrl,
        header: header,
        timeout: 60,
        body: {
            model: model,
            temperature: 0.2,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: query.text }
            ]
        },
        handler: function (resp) {
            if (resp.error) {
                finish({
                    error: {
                        type: 'network',
                        message: '接口请求失败：' + (resp.error.message || '未知网络错误'),
                        addtion: resp.error.debugMessage || ''
                    }
                });
                return;
            }

            var data = resp.data;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch (e) { data = null; }
            }

            var statusCode = (resp.response && resp.response.statusCode) || 0;
            if (statusCode >= 400 || !data || !data.choices || !data.choices.length) {
                var apiMessage = (data && data.error && data.error.message) || ('HTTP ' + statusCode);
                finish({
                    error: {
                        type: statusCode === 401 ? 'secretKey' : 'api',
                        message: '接口返回错误：' + apiMessage,
                        addtion: ''
                    }
                });
                return;
            }

            var content = (data.choices[0].message && data.choices[0].message.content) || '';
            var result = { from: query.detectFrom, to: query.detectTo };

            if (dictMode) {
                var dict = buildToDict(query.text.trim(), extractJson(content));
                if (dict) {
                    result.toDict = dict;
                } else {
                    // JSON 解析或校验失败时兜底成普通译文，避免插件报错
                    result.toParagraphs = textToParagraphs(content);
                }
            } else {
                result.toParagraphs = textToParagraphs(content);
            }

            finish({ result: result });
        }
    });
}
