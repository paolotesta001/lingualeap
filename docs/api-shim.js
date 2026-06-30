// ===== LinguaLeap PWA — client-side backend shim =====
// Intercepts every fetch('/api/...') the app makes and answers it entirely in
// the browser, so the app runs on GitHub Pages with no Python server.
// External APIs (MyMemory dictionary, Gemini) are called directly from here.
(function () {
    'use strict';

    const realFetch = window.fetch.bind(window);
    const DATA = './data/';
    const CODE_FILE = {
        en: 'english.json', es: 'spanish.json', it: 'italian.json',
        fr: 'french.json', de: 'german.json',
    };
    const LANG_NAMES = { en: 'English', es: 'Spanish', it: 'Italian', fr: 'French', de: 'German' };
    const DEEPSEEK_MODEL = 'deepseek-v4-flash';
    // V4 Flash is a reasoning model: it spends tokens on hidden reasoning before
    // the answer, so we pad the output budget to leave room for the content.
    const DEEPSEEK_REASONING_BUDGET = 2000;
    const DEEPSEEK_KEY_STORE = 'lingualeap_deepseek_key';
    const GEMINI_MODEL = 'gemini-2.5-flash';
    const KEY_STORE = 'lingualeap_gemini_key';

    let _dict = null, _lessons = null;

    function jsonResponse(obj, status) {
        return new Response(JSON.stringify(obj), {
            status: status || 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    async function getJSON(path) {
        const r = await realFetch(path, { cache: 'no-cache' });
        if (!r.ok) throw new Error('Failed to load ' + path);
        return r.json();
    }

    // ---------- API keys (browser, user's own keys, stored on device only) ----------
    // DeepSeek is the primary model; Gemini is the fallback.
    window.LinguaLeapDeepSeekKey = {
        get: () => (localStorage.getItem(DEEPSEEK_KEY_STORE) || '').trim(),
        set: (v) => localStorage.setItem(DEEPSEEK_KEY_STORE, (v || '').trim()),
        clear: () => localStorage.removeItem(DEEPSEEK_KEY_STORE),
        has: () => !!(localStorage.getItem(DEEPSEEK_KEY_STORE) || '').trim(),
    };
    window.LinguaLeapKey = {
        get: () => (localStorage.getItem(KEY_STORE) || '').trim(),
        set: (v) => localStorage.setItem(KEY_STORE, (v || '').trim()),
        clear: () => localStorage.removeItem(KEY_STORE),
        has: () => !!(localStorage.getItem(KEY_STORE) || '').trim(),
    };

    class QuotaError extends Error {}
    class NoKeyError extends Error {}
    // Thrown when DeepSeek can't fulfil a request, so we fall back to Gemini.
    class AIUnavailable extends Error {}

    // ---------- DeepSeek (primary, browser, user's own key) ----------
    async function deepseekGenerate(prompt, opts) {
        opts = opts || {};
        const key = window.LinguaLeapDeepSeekKey.get();
        if (!key) throw new AIUnavailable('no key');

        const messages = [];
        if (opts.system) messages.push({ role: 'system', content: opts.system });
        messages.push({ role: 'user', content: prompt });

        const body = {
            model: DEEPSEEK_MODEL,
            messages: messages,
            temperature: opts.temperature != null ? opts.temperature : 0.7,
            // Pad for hidden reasoning tokens — max_tokens caps reasoning + answer.
            max_tokens: (opts.maxTokens || 800) + DEEPSEEK_REASONING_BUDGET,
        };

        let res;
        try {
            res = await realFetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + key,
                },
                body: JSON.stringify(body),
            });
        } catch (e) {
            throw new AIUnavailable('network');
        }
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            console.warn('DeepSeek error', res.status, t.slice(0, 200));
            // 402 balance, 429 rate limit, 5xx — all mean "fall back to Gemini".
            throw new AIUnavailable('http ' + res.status);
        }
        const data = await res.json();
        const content = data && data.choices && data.choices[0] &&
            data.choices[0].message && data.choices[0].message.content;
        const text = (content || '').trim();
        if (!text) throw new AIUnavailable('empty content');
        return text;
    }

    // ---------- Unified generator: DeepSeek primary, Gemini fallback ----------
    async function aiGenerate(prompt, opts) {
        const hasDeep = window.LinguaLeapDeepSeekKey.has();
        const hasGem = window.LinguaLeapKey.has();
        if (!hasDeep && !hasGem) throw new NoKeyError();

        if (hasDeep) {
            try {
                return await deepseekGenerate(prompt, opts);
            } catch (e) {
                console.warn('DeepSeek unavailable, falling back to Gemini:', e && e.message);
                if (!hasGem) return null;  // no fallback configured
            }
        }
        return await geminiGenerate(prompt, opts);
    }

    async function geminiGenerate(prompt, opts) {
        opts = opts || {};
        const key = window.LinguaLeapKey.get();
        if (!key) throw new NoKeyError();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
        const body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: opts.temperature != null ? opts.temperature : 0.7,
                maxOutputTokens: opts.maxTokens || 800,
                // Disable "thinking" so it can't eat the budget and truncate the
                // visible answer (Gemini 2.5 Flash thinks by default).
                thinkingConfig: { thinkingBudget: 0 },
            },
        };
        if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };

        const res = await realFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.status === 429) throw new QuotaError();
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            console.warn('Gemini error', res.status, t.slice(0, 300));
            return null;
        }
        const data = await res.json();
        const parts = data && data.candidates && data.candidates[0] &&
            data.candidates[0].content && data.candidates[0].content.parts;
        if (!parts || !parts[0]) return null;
        return (parts[0].text || '').trim();
    }

    function parseJsonBlock(reply) {
        if (!reply) return null;
        let cleaned = reply.trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```\s*$/i, '');
        try { return JSON.parse(cleaned); } catch (e) {}
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
        return null;
    }

    const NO_KEY_REPLY =
        "🔑 **Add an API key to chat.**\n\nTap the ⚙️ Settings button (top-right) and paste your DeepSeek API key " +
        "(or a Google Gemini key as backup). It's stored only on this device — never uploaded anywhere.";
    const QUOTA_REPLY =
        "⏳ **Limit reached.** The model is temporarily unavailable (quota or rate limit). Please try again in a little while.";

    // ---------- Dictionary: MyMemory + bundled local dictionary ----------
    async function myMemoryGet(q, langpair) {
        const u = 'https://api.mymemory.translated.net/get?' +
            new URLSearchParams({ q: q, langpair: langpair }).toString();
        const r = await realFetch(u);
        return r.json();
    }

    const BAD_TRANS = ['PLEASE SELECT', 'INVALID', 'MYMEMORY WARNING', 'LANGUAGE PAIR', 'NO QUERY'];

    async function searchMyMemory(from, to, query) {
        const langpair = from + '|' + to;
        const ql = query.trim().toLowerCase();
        const translations = [], seen = new Set();
        const examples = [], seenEx = new Set();
        const addTrans = (t) => {
            t = (t || '').trim();
            const up = t.toUpperCase();
            if (t && t.toLowerCase() !== ql && !seen.has(t.toLowerCase()) &&
                !BAD_TRANS.some(b => up.includes(b))) {
                translations.push(t); seen.add(t.toLowerCase());
            }
        };
        const addEx = (s, tr) => {
            s = (s || '').trim(); tr = (tr || '').trim();
            const k = s.toLowerCase();
            if (s && tr && !seenEx.has(k) && k !== ql) {
                examples.push({ source: s, translation: tr }); seenEx.add(k);
            }
        };
        try {
            const data = await myMemoryGet(query, langpair);
            addTrans(data && data.responseData && data.responseData.translatedText);
            const matches = (data && data.matches) || [];
            for (const m of matches) {
                const seg = (m.segment || '').trim();
                const tr = (m.translation || '').trim();
                if (!tr) continue;
                if (seg.toLowerCase() === ql) addTrans(tr);
                else if (ql && seg.toLowerCase().includes(ql) &&
                    seg.length > query.length + 3 && seg.length < 300) addEx(seg, tr);
            }
        } catch (e) { console.warn('MyMemory error', e); }
        return { translations: translations.slice(0, 10), examples: examples.slice(0, 6) };
    }

    async function loadDict() {
        if (!_dict) _dict = await getJSON(DATA + 'dictionary/dictionary.json');
        return _dict;
    }

    async function searchLocal(from, to, query) {
        const data = await loadDict();
        const ql = query.toLowerCase().trim();
        const results = [];
        for (const entry of (data.entries || [])) {
            if (!(from in entry) || !(to in entry)) continue;
            for (const sw of entry[from]) {
                if (sw.toLowerCase().includes(ql)) {
                    results.push({ source: sw, translations: entry[to] });
                    break;
                }
            }
            if (results.length >= 10) break;
        }
        return results;
    }

    async function dictionarySearch(from, to, query) {
        query = query.trim();
        const online = await searchMyMemory(from, to, query);
        const local = await searchLocal(from, to, query);
        const all = [], seen = new Set();
        for (const t of online.translations) {
            if (!seen.has(t.toLowerCase())) { all.push(t); seen.add(t.toLowerCase()); }
        }
        for (const lr of local) {
            for (const t of lr.translations) {
                if (!seen.has(t.toLowerCase())) { all.push(t); seen.add(t.toLowerCase()); }
            }
        }
        return {
            query: query,
            translations: all.slice(0, 10),
            examples: online.examples,
            local_matches: local.slice(0, 5),
        };
    }

    // ---------- CSV import (Reverso favourites) ----------
    function parseCSV(text) {
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const rows = []; let field = '', row = [], inq = false, i = 0;
        while (i < text.length) {
            const c = text[i];
            if (inq) {
                if (c === '"') {
                    if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                    inq = false; i++; continue;
                }
                field += c; i++; continue;
            }
            if (c === '"') { inq = true; i++; continue; }
            if (c === ',') { row.push(field); field = ''; i++; continue; }
            if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
            field += c; i++;
        }
        if (field.length || row.length) { row.push(field); rows.push(row); }
        if (!rows.length) return [];
        const headers = rows[0].map(h => h.trim());
        return rows.slice(1)
            .filter(r => r.some(x => (x || '').trim().length))
            .map(r => {
                const o = {};
                headers.forEach((h, idx) => o[h] = r[idx] !== undefined ? r[idx] : '');
                return o;
            });
    }

    function stripHtml(t) { return (t || '').replace(/<\/?em[^>]*>|<hend>/gi, '').trim(); }

    function parseCsvRows(rowObjs) {
        const complete = [], incomplete = [], seen = new Set();
        for (const row of rowObjs) {
            const source = stripHtml(row['Search text']);
            const translation = stripHtml(row['Translation text']);
            const langFrom = (row['Search language'] || 'en').trim().toLowerCase();
            const langTo = (row['Translation language'] || 'it').trim().toLowerCase();
            const tags = stripHtml(row['Tags / Comments']);
            const srcEx = stripHtml(row['Search example']);
            const trEx = stripHtml(row['Translation example']);

            const all = [];
            if (translation) all.push(translation);
            if (tags) tags.split(',').forEach(t => {
                t = t.trim(); if (t && !all.includes(t)) all.push(t);
            });

            if (!source || !all.length) {
                const ps = source || translation || '';
                const pt = translation || '';
                if (ps || pt) incomplete.push({
                    source: ps, translation: pt,
                    allTranslations: all.length ? all : (pt ? [pt] : []),
                    langFrom, langTo, exampleSource: srcEx, exampleTranslation: trEx,
                    incomplete: true,
                });
                continue;
            }
            const key = source.toLowerCase() + '|' + langFrom + '|' + langTo;
            if (seen.has(key)) continue;
            seen.add(key);
            complete.push({
                source, translation: all[0], allTranslations: all,
                langFrom, langTo, exampleSource: srcEx, exampleTranslation: trEx,
                incomplete: false,
            });
        }
        return { complete, incomplete };
    }

    // ---------- Pronunciation (Levenshtein + optional Gemini refine) ----------
    function normCmp(s) { return (s || '').toLowerCase().replace(/[^\w\s]/g, '').trim(); }

    function levSim(a, b) {
        a = normCmp(a); b = normCmp(b);
        if (a === b) return 1;
        if (!a || !b) return 0;
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        return 1 - dp[m][n] / Math.max(m, n);
    }

    function diffWords(target, transcript) {
        const tw = new Set(normCmp(transcript).split(/\s+/));
        const out = [];
        for (const w of target.split(/\s+/)) {
            const c = normCmp(w);
            if (c && !tw.has(c)) out.push(w.replace(/[.,!?;:]/g, ''));
        }
        return out.slice(0, 5);
    }

    async function pronunciation(body) {
        const target = (body.target || '').trim();
        const transcript = (body.transcript || '').trim();
        const lang = body.lang || 'en';
        if (!target || !transcript) return jsonResponse({ error: 'Missing target or transcript' }, 400);

        const baseline = Math.round(levSim(target, transcript) * 100);
        if (baseline >= 95) {
            return jsonResponse({
                score: baseline, feedback: 'Excellent! That sounded spot on.',
                tip: '', mispronounced: diffWords(target, transcript),
            });
        }
        const langName = LANG_NAMES[lang] || lang;
        const prompt =
`You are a pronunciation coach for a ${langName} learner.
TARGET: "${target}"
TRANSCRIPT (speech recognition heard): "${transcript}"
BASELINE: a text-similarity algorithm scored these at ${baseline}/100.
Refine this into a final pronunciation score.
RULES: if essentially the same ignoring case/punctuation, score 90-100. If baseline >=85 give at least 85. Never default to 50 unless baseline is near 50.
Reply ONLY with valid JSON, no fences:
{"score": <int 0-100>, "feedback": "<one short encouraging sentence>", "tip": "<one practical tip or empty>", "mispronounced": [<words>]}`;

        let reply = null;
        try {
            reply = await aiGenerate(prompt, { temperature: 0.2, maxTokens: 300 });
        } catch (e) {
            return jsonResponse({
                score: baseline, feedback: 'Checked using text comparison.',
                tip: '', mispronounced: diffWords(target, transcript),
            });
        }
        const data = parseJsonBlock(reply);
        if (!data || typeof data !== 'object') {
            return jsonResponse({
                score: baseline, feedback: 'Checked using text comparison.',
                tip: '', mispronounced: diffWords(target, transcript),
            });
        }
        let score = parseInt(data.score, 10);
        if (isNaN(score)) score = baseline;
        if (baseline >= 80 && score < baseline - 20) score = baseline;
        return jsonResponse({
            score: Math.max(0, Math.min(100, score)),
            feedback: String(data.feedback || '').trim(),
            tip: String(data.tip || '').trim(),
            mispronounced: data.mispronounced || diffWords(target, transcript),
            baseline: baseline,
        });
    }

    // ---------- Chat ----------
    function chatSystemPrompt(targetName, targetLang, sourceName, sourceLang) {
        return `You are LinguaLeap's warm, encouraging ${targetName} tutor.
The user is learning ${targetName}. When you explain something, use ${sourceName} so they fully understand.

First decide what the user's message is:

A) A LANGUAGE QUESTION — "how do you say X?", "what does X mean?", or a grammar question.
   - Translation question: give 2-5 natural ${targetName} options (most natural first, in **bold**) with one short example each.
   - Grammar question: a clear explanation in 4-6 sentences with an example.

B) ANYTHING ELSE — treat it as the user practicing ${targetName} by telling you something.
   ALWAYS answer in these THREE parts, in this order:
   1. CORRECTION — If the sentence has any mistake (grammar, spelling, verb tense, word order, punctuation), show the fully corrected sentence in **bold**, then a short "• " list of what you changed and why. If it is already correct, just say "✓ Perfect — no mistakes!" and do NOT invent changes.
   2. MORE NATURAL — If a native speaker would normally say it in a more natural or common way, add a line starting with "More natural: " followed by the better version in **bold**. Skip this line entirely if their sentence already sounds natural.
   3. REPLY — Then genuinely reply to what they said, like a friendly person would: react to the content and ask ONE follow-up question to keep the conversation going. Write this reply in ${targetName} so they keep practicing.

IMPORTANT RULES:
- NEVER "translate" the user's sentence into the same language they wrote it in. Only translate if they explicitly ask for a translation.
- Keep everything short and scannable. Use **bold** for corrected text and key words, and "• " for bullets.
- Never mention that you are an AI or a model.
- Always finish your WHOLE response — never stop in the middle of a sentence.

ALWAYS end with this JSON block on a new line (hidden from the user):
<META>{"type": "translation|grammar|writing", "saveable": {"source": "...", "translation": "...", "langFrom": "xx", "langTo": "xx"} or null}</META>
For a translation question: saveable = queried word + best ${targetName} translation. For practice (part B): saveable = original sentence + corrected sentence (langFrom == langTo == "${targetLang}"). For a grammar question: saveable = null.`;
    }

    async function chat(body) {
        const message = (body.message || '').trim();
        const targetLang = body.target_lang || 'es';
        const sourceLang = body.source_lang || 'en';
        const history = body.history || [];
        if (!message) return jsonResponse({ reply: 'Ask me how to say something, or a grammar question!' });

        const targetName = LANG_NAMES[targetLang] || targetLang;
        const sourceName = LANG_NAMES[sourceLang] || sourceLang;
        const system = chatSystemPrompt(targetName, targetLang, sourceName, sourceLang);

        let historyText = '';
        for (const turn of history.slice(-6)) {
            const text = turn.text || '';
            if (!text) continue;
            historyText += (turn.role === 'user' ? 'User' : 'Tutor') + ': ' + text + '\n';
        }
        const fullPrompt = historyText + 'User: ' + message + '\nTutor:';

        let reply;
        try {
            reply = await aiGenerate(fullPrompt, { system, temperature: 0.7, maxTokens: 1500 });
        } catch (e) {
            if (e instanceof NoKeyError) return jsonResponse({ reply: NO_KEY_REPLY, type: 'error' });
            if (e instanceof QuotaError) return jsonResponse({ reply: QUOTA_REPLY, type: 'quota_exceeded' });
            return jsonResponse({ reply: 'Connection error. Please try again.', type: 'error' });
        }
        if (!reply) return jsonResponse({ reply: "I couldn't reach my brain right now. Please try again.", type: 'error' });

        let meta = {};
        const mm = reply.match(/<META>(\{[\s\S]*?\})<\/META>/);
        if (mm) {
            try { meta = JSON.parse(mm[1]); } catch (e) { meta = {}; }
            reply = (reply.slice(0, mm.index).trimEnd() + reply.slice(mm.index + mm[0].length).trimStart()).trim();
        }
        let saveable = meta.saveable;
        if (saveable && typeof saveable === 'object' && saveable.source && saveable.translation) {
            saveable.allTranslations = [saveable.translation];
        } else saveable = null;

        return jsonResponse({ reply: reply, type: meta.type || 'chat', saveable: saveable });
    }

    // ---------- Movie / TV phrases ----------
    async function moviePhrases(body) {
        const title = (body.title || '').trim();
        const targetLang = body.target_lang || 'en';
        const nativeLang = body.native_lang || 'en';
        if (!title) return jsonResponse({ error: 'Please enter a film or series title.' }, 400);
        if (!window.LinguaLeapDeepSeekKey.has() && !window.LinguaLeapKey.has()) {
            return jsonResponse({ error: 'Add your DeepSeek (or Gemini) key in ⚙️ Settings to use Movie Phrases.' }, 503);
        }
        const targetName = LANG_NAMES[targetLang] || targetLang;
        const nativeName = LANG_NAMES[nativeLang] || nativeLang;

        const prompt =
`You are a language-learning content creator.
The user is learning ${targetName}. Their native language is ${nativeName}.
Film or TV series title: "${title}".

Produce useful, natural, reusable phrases/expressions in ${targetName} that fit the tone, themes and famous lines of "${title}" — real idiomatic ${targetName}, not just literal movie quotes.
Group them by CEFR level: B1, B2, C1, C2. Give 4-5 phrases per level (16-20 total). Harder level = more idiomatic/nuanced.
For each: "phrase" (in ${targetName}), "translation" (in ${nativeName}), "note" (short usage hint or "").
Reply ONLY with valid JSON, no fences, EXACTLY:
{"B1":[{"phrase":"...","translation":"...","note":"..."}],"B2":[...],"C1":[...],"C2":[...]}`;

        let reply;
        try {
            reply = await aiGenerate(prompt, { temperature: 0.8, maxTokens: 4000 });
        } catch (e) {
            if (e instanceof NoKeyError) return jsonResponse({ error: 'Add your DeepSeek (or Gemini) key in ⚙️ Settings.' }, 503);
            if (e instanceof QuotaError) return jsonResponse({ error: 'Free-tier limit reached. Try again in a little while.', quota_exceeded: true }, 429);
            return jsonResponse({ error: 'Something went wrong. Try again.' }, 502);
        }
        const data = parseJsonBlock(reply);
        if (!data || typeof data !== 'object') {
            return jsonResponse({ error: "Couldn't generate phrases. Try another title." }, 502);
        }
        const levels = {};
        let any = false;
        for (const lvl of ['B1', 'B2', 'C1', 'C2']) {
            const items = Array.isArray(data[lvl]) ? data[lvl] : [];
            const clean = [];
            for (const it of items) {
                if (!it || typeof it !== 'object') continue;
                const phrase = String(it.phrase || '').trim();
                const translation = String(it.translation || '').trim();
                const note = String(it.note || '').trim();
                if (phrase && translation) { clean.push({ phrase, translation, note }); any = true; }
            }
            levels[lvl] = clean;
        }
        if (!any) return jsonResponse({ error: "Couldn't generate phrases. Try another title." }, 502);
        return jsonResponse({ title, target_lang: targetLang, native_lang: nativeLang, levels });
    }

    // ---------- Router ----------
    async function readBody(init) {
        if (!init || init.body == null) return {};
        if (typeof init.body === 'string') {
            try { return JSON.parse(init.body); } catch (e) { return {}; }
        }
        return init.body; // FormData
    }

    async function route(path, init) {
        // progress -> localStorage only (handled by app.js); make server a no-op
        if (path === '/api/progress') {
            if (init && (init.method || '').toUpperCase() === 'POST') {
                return jsonResponse({ saved: true });
            }
            return jsonResponse({ exists: false });
        }

        if (path === '/api/languages') {
            return jsonResponse(await getJSON(DATA + 'languages.json'));
        }

        let m;
        if ((m = path.match(/^\/api\/exercises\/(\w+)$/))) {
            const file = CODE_FILE[m[1]];
            if (!file) return jsonResponse({ error: 'Language not found' }, 404);
            return jsonResponse(await getJSON(DATA + file));
        }

        if ((m = path.match(/^\/api\/dictionary\/search\/(\w+)\/(\w+)\/(.+)$/))) {
            const query = decodeURIComponent(m[3]);
            return jsonResponse(await dictionarySearch(m[1], m[2], query));
        }

        if ((m = path.match(/^\/api\/lessons\/(\w+)$/))) {
            if (!_lessons) _lessons = await getJSON(DATA + 'lessons.json');
            if (!_lessons[m[1]]) return jsonResponse({ error: 'No lessons for this language' }, 404);
            return jsonResponse(_lessons[m[1]]);
        }

        if ((m = path.match(/^\/api\/placement\/(\w+)$/))) {
            if (!_lessons) _lessons = await getJSON(DATA + 'lessons.json');
            if (!_lessons[m[1]]) return jsonResponse({ error: 'No placement test' }, 404);
            return jsonResponse({ questions: _lessons[m[1]].placement_test || [] });
        }

        if (path === '/api/import-favourites') {
            let text;
            try {
                const r = await realFetch(DATA + 'favourites.csv', { cache: 'no-cache' });
                if (!r.ok) throw new Error();
                text = await r.text();
            } catch (e) {
                return jsonResponse({ error: 'No favourites file bundled. Use "Upload CSV file" instead.', words: [], incomplete: [] }, 404);
            }
            const { complete, incomplete } = parseCsvRows(parseCSV(text));
            return jsonResponse({ words: complete, incomplete, count: complete.length, incompleteCount: incomplete.length });
        }

        if (path === '/api/import-csv') {
            const form = await readBody(init);
            const file = form && form.get ? form.get('file') : null;
            if (!file) return jsonResponse({ error: 'No file uploaded' }, 400);
            const text = await file.text();
            const { complete, incomplete } = parseCsvRows(parseCSV(text));
            return jsonResponse({ words: complete, incomplete, count: complete.length, incompleteCount: incomplete.length });
        }

        if (path === '/api/chat') return chat(await readBody(init));
        if (path === '/api/movie-phrases') return moviePhrases(await readBody(init));
        if (path === '/api/pronunciation') return pronunciation(await readBody(init));

        return jsonResponse({ error: 'Unknown endpoint: ' + path }, 404);
    }

    window.fetch = function (input, init) {
        let url = typeof input === 'string' ? input : (input && input.url) || '';
        const origin = location.origin;
        let path = url;
        if (path.startsWith(origin)) path = path.slice(origin.length);
        if (!path.startsWith('/api/')) return realFetch(input, init);
        path = path.split('?')[0];
        // If a Request object was passed, fold its method/body into init
        if (typeof input !== 'string' && input) {
            init = init || {};
            if (!init.method) init.method = input.method;
        }
        return route(path, init).catch(err => {
            console.error('API shim error', path, err);
            return jsonResponse({ error: String((err && err.message) || err) }, 500);
        });
    };
})();
