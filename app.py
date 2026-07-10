import csv
import glob
import json
import os
import re as _re_html
import urllib.request
import urllib.parse
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')


# ===== USER PROGRESS (file-based) =====
PROGRESS_FILE = os.path.join(os.path.dirname(__file__), 'user_progress.json')


def load_user_progress():
    if not os.path.exists(PROGRESS_FILE):
        return None
    try:
        with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def save_user_progress(data):
    try:
        with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"Failed to save progress: {e}")
        return False


# ===== LOAD .env =====
def _load_env():
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, val = line.split('=', 1)
            os.environ.setdefault(key.strip(), val.strip())


_load_env()

# ===== DEEPSEEK (primary model) =====
DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY', '')
DEEPSEEK_MODEL = 'deepseek-v4-flash'
# V4 Flash is a reasoning model: it spends tokens on hidden reasoning BEFORE the
# answer, so we pad the output budget to leave room for the actual content.
DEEPSEEK_REASONING_BUDGET = 2000

# ===== GEMINI (fallback model) =====
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
# Free-tier model — no credits consumed
GEMINI_MODEL = 'gemini-2.5-flash'


class AIUnavailable(Exception):
    """Raised when DeepSeek can't fulfil a request, so we fall back to Gemini."""


class GeminiQuotaExceeded(Exception):
    """Raised when the Gemini free tier quota is hit."""
    def __init__(self, retry_after_seconds=None, quota_kind='unknown'):
        self.retry_after_seconds = retry_after_seconds
        self.quota_kind = quota_kind  # 'per_minute', 'per_day', or 'unknown'
        super().__init__(f"Gemini quota exceeded ({quota_kind})")


def _parse_quota_error(err_body_text):
    """Parse a 429 error body and return (retry_seconds, kind)."""
    retry_seconds = None
    kind = 'unknown'
    try:
        err_json = json.loads(err_body_text)
        details = err_json.get('error', {}).get('details', [])
        for d in details:
            t = d.get('@type', '')
            if 'RetryInfo' in t:
                delay = d.get('retryDelay', '')
                # Format like "30s" or "3600s"
                m = _re_html.match(r'(\d+(?:\.\d+)?)s', delay)
                if m:
                    retry_seconds = int(float(m.group(1)))
            if 'QuotaFailure' in t:
                violations = d.get('violations', [])
                for v in violations:
                    qid = v.get('quotaId', '').lower()
                    if 'perday' in qid or 'per_day' in qid:
                        kind = 'per_day'
                    elif 'perminute' in qid or 'per_minute' in qid:
                        kind = 'per_minute'
    except Exception:
        pass

    # Heuristic fallback from retry time
    if kind == 'unknown' and retry_seconds is not None:
        kind = 'per_day' if retry_seconds > 120 else 'per_minute'

    return retry_seconds, kind


def gemini_generate(prompt, system_instruction=None, temperature=0.7, max_tokens=800):
    """
    Call Gemini free-tier API.
    Returns text string on success.
    Raises GeminiQuotaExceeded when the free-tier limit is hit.
    Returns None on other failures.
    """
    if not GEMINI_API_KEY:
        return None

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    )

    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            # Disable "thinking" so it can't consume the output budget and
            # truncate the visible answer (Gemini 2.5 Flash thinks by default).
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    if system_instruction:
        body["systemInstruction"] = {"parts": [{"text": system_instruction}]}

    data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(
        url, data=data,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        candidates = result.get('candidates', [])
        if not candidates:
            return None
        parts = candidates[0].get('content', {}).get('parts', [])
        if not parts:
            return None
        return parts[0].get('text', '').strip()
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='ignore')
        print(f"Gemini HTTPError {e.code}: {err_body[:500]}")
        if e.code == 429:
            retry_seconds, kind = _parse_quota_error(err_body)
            raise GeminiQuotaExceeded(retry_seconds, kind)
        return None
    except Exception as e:
        print(f"Gemini error: {e}")
        return None


def deepseek_generate(prompt, system_instruction=None, temperature=0.7,
                      max_tokens=800, timeout=45):
    """
    Call DeepSeek (OpenAI-compatible) chat completions with `deepseek-v4-flash`.
    Returns the text content on success.
    Raises AIUnavailable on any failure (no key, network, quota/billing, empty
    output) so the caller can fall back to Gemini.
    """
    if not DEEPSEEK_API_KEY:
        raise AIUnavailable('no key')

    messages = []
    if system_instruction:
        messages.append({"role": "system", "content": system_instruction})
    messages.append({"role": "user", "content": prompt})

    body = {
        "model": DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": temperature,
        # Pad for hidden reasoning tokens — max_tokens caps reasoning + answer.
        "max_tokens": max_tokens + DEEPSEEK_REASONING_BUDGET,
    }

    data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions",
        data=data,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {DEEPSEEK_API_KEY}',
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        choices = result.get('choices', [])
        if not choices:
            raise AIUnavailable('no choices')
        content = (choices[0].get('message', {}).get('content') or '').strip()
        if not content:
            # All budget went to reasoning, or model returned nothing.
            raise AIUnavailable('empty content')
        return content
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='ignore')
        print(f"DeepSeek HTTPError {e.code}: {err_body[:300]}")
        # 402 insufficient balance, 429 rate limit, 5xx — all mean "fall back".
        raise AIUnavailable(f'http {e.code}')
    except AIUnavailable:
        raise
    except Exception as e:
        print(f"DeepSeek error: {e}")
        raise AIUnavailable(str(e))


def ai_generate(prompt, system_instruction=None, temperature=0.7,
                max_tokens=800, timeout=45):
    """
    Unified generator: try DeepSeek (primary), fall back to Gemini if DeepSeek
    is unavailable (no key, error, or quota/billing exhausted).

    Returns text on success, or None if both fail for non-quota reasons.
    May raise GeminiQuotaExceeded if the Gemini fallback itself is rate-limited
    (callers already handle this).
    """
    if DEEPSEEK_API_KEY:
        try:
            return deepseek_generate(
                prompt, system_instruction, temperature, max_tokens, timeout,
            )
        except AIUnavailable as e:
            print(f"DeepSeek unavailable ({e}); falling back to Gemini.")
    return gemini_generate(prompt, system_instruction, temperature, max_tokens)


def _format_retry_time(seconds):
    """Format seconds into a friendly 'you can use it again in X' message."""
    if seconds is None:
        return None
    if seconds < 60:
        return f"about {seconds} seconds"
    if seconds < 3600:
        mins = max(1, round(seconds / 60))
        return f"about {mins} minute{'s' if mins != 1 else ''}"
    hours = seconds / 3600
    if hours < 24:
        h = max(1, round(hours))
        return f"about {h} hour{'s' if h != 1 else ''}"
    days = max(1, round(hours / 24))
    return f"about {days} day{'s' if days != 1 else ''}"


def load_language(code):
    for filename in os.listdir(DATA_DIR):
        if not filename.endswith('.json') or filename == 'lessons.json':
            continue
        filepath = os.path.join(DATA_DIR, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if data.get('code') == code and 'levels' in data and 'language' in data:
                return data
        except (json.JSONDecodeError, OSError):
            continue
    return None


def get_all_languages():
    languages = []
    for filename in sorted(os.listdir(DATA_DIR)):
        if not filename.endswith('.json'):
            continue
        filepath = os.path.join(DATA_DIR, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            # Only include files that look like language course files
            if 'language' in data and 'code' in data and 'flag' in data:
                languages.append({
                    'language': data['language'],
                    'code': data['code'],
                    'flag': data['flag'],
                })
        except (json.JSONDecodeError, KeyError, OSError):
            continue
    return languages


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/languages')
def api_languages():
    return jsonify(get_all_languages())


@app.route('/api/exercises/<lang_code>')
def api_exercises(lang_code):
    data = load_language(lang_code)
    if data is None:
        return jsonify({'error': 'Language not found'}), 404
    return jsonify(data)


# ===== DICTIONARY =====
DICT_FILE = os.path.join(DATA_DIR, 'dictionary', 'dictionary.json')
_dict_cache = None


def load_dictionary():
    global _dict_cache
    if _dict_cache is None:
        with open(DICT_FILE, 'r', encoding='utf-8') as f:
            _dict_cache = json.load(f)
    return _dict_cache


def search_local(lang_from, lang_to, query):
    """Search the local dictionary for matches."""
    data = load_dictionary()
    query_lower = query.lower().strip()
    results = []
    for entry in data['entries']:
        if lang_from not in entry or lang_to not in entry:
            continue
        source_words = entry[lang_from]
        for sw in source_words:
            if query_lower in sw.lower():
                results.append({
                    'source': sw,
                    'translations': entry[lang_to],
                })
                break
        if len(results) >= 10:
            break
    return results


def _mymemory_get(query, langpair):
    """Single MyMemory API call."""
    url = (
        "https://api.mymemory.translated.net/get?"
        + urllib.parse.urlencode({"q": query, "langpair": langpair})
    )
    req = urllib.request.Request(url, headers={"User-Agent": "LinguaLeap/1.0"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def search_mymemory(lang_from, lang_to, query):
    """Use MyMemory API with multiple strategies for better translations."""
    langpair = f"{lang_from}|{lang_to}"
    query_lower = query.strip().lower()

    translations = []
    seen_lower = set()
    examples = []
    seen_ex = set()

    def add_trans(t):
        t = t.strip()
        if t and t.lower() != query_lower and t.lower() not in seen_lower:
            translations.append(t)
            seen_lower.add(t.lower())

    def add_example(src, trans):
        src, trans = src.strip(), trans.strip()
        key = src.lower()
        if src and trans and key not in seen_ex and key != query_lower:
            examples.append({"source": src, "translation": trans})
            seen_ex.add(key)

    # --- Strategy 1: Direct translation ---
    try:
        data = _mymemory_get(query, langpair)

        main = data.get("responseData", {}).get("translatedText", "")
        add_trans(main)

        for match in data.get("matches", []):
            seg = match.get("segment", "").strip()
            trans = match.get("translation", "").strip()
            if not trans:
                continue

            if seg.lower() == query_lower:
                add_trans(trans)
            elif (
                query_lower in seg.lower()
                and len(seg) > len(query) + 3
                and len(seg) < 300
            ):
                add_example(seg, trans)
    except Exception as e:
        print(f"MyMemory direct error: {e}")

    # --- Strategy 2: Context sentences to discover more meanings ---
    # Templates for extraction (only simple "is X" patterns)
    EXTRACT_CTXS = {
        "it": ["È {w}", "È molto {w}"],
        "es": ["Es {w}", "Es muy {w}"],
        "fr": ["C'est {w}", "C'est très {w}"],
        "de": ["Das ist {w}", "Das ist sehr {w}"],
        "en": ["It is {w}", "It is very {w}"],
    }
    # Templates for example sentences only (no extraction)
    EXAMPLE_CTXS = {
        "it": ["Un problema {w}", "Situazione {w}", "Ho un {w} dolore"],
        "es": ["Un problema {w}", "Situación {w}"],
        "fr": ["Un problème {w}", "Situation {w}"],
        "de": ["Ein {w} Problem", "Die Situation ist {w}"],
        "en": ["A {w} problem", "The situation is {w}"],
    }
    CONTEXTS = {}
    for lang in ["it", "es", "fr", "de", "en"]:
        CONTEXTS[lang] = (
            [(t, True) for t in EXTRACT_CTXS.get(lang, [])]
            + [(t, False) for t in EXAMPLE_CTXS.get(lang, [])]
        )

    # Known prefix translations for extracting keywords from context results
    PREFIX_MAP = {
        "È ": "It is ", "È molto ": "It is very ", "Es ": "It is ",
        "Es muy ": "It is very ", "C'est ": "It is ", "C'est très ": "It is very ",
        "Das ist ": "It is ", "Das ist sehr ": "It is very ",
        "It is ": "It is ", "It is very ": "It is very ",
        "Un problema ": "A problem ", "Un problème ": "A problem ",
        "Ein ": "A ", "A ": "A ",
    }

    if len(translations) < 3:
        for ctx_tmpl, do_extract in CONTEXTS.get(lang_from, [])[:5]:
            sentence = ctx_tmpl.format(w=query)
            try:
                data2 = _mymemory_get(sentence, langpair)
                main2 = data2.get("responseData", {}).get("translatedText", "").strip()
                if main2 and main2.lower() != sentence.lower():
                    add_example(sentence, main2)

                    # Extract keyword from simple context translations
                    if do_extract:
                        clean_trans = main2.strip(" .,!?;:\"'")
                        trans_words = clean_trans.split()
                        skip = {"is", "it", "a", "an", "the", "this", "that",
                                "very", "its", "are", "was", "be", "to", "of",
                                "in", "and", "i", "have", "has", "not", "so", "too"}
                        # Last meaningful word (works for "It is X" patterns)
                        for w in reversed(trans_words):
                            cw = w.strip(" .,!?;:\"'")
                            if cw.lower() not in skip and len(cw) > 2:
                                add_trans(cw)
                                break

                for match in data2.get("matches", []):
                    seg = match.get("segment", "").strip()
                    trans = match.get("translation", "").strip()
                    if seg.lower() == query_lower and trans:
                        add_trans(trans)
            except Exception:
                pass
            if len(translations) >= 6:
                break

    # --- Strategy 3: Reverse lookup for more synonyms ---
    if 1 <= len(translations) < 4:
        reverse_pair = f"{lang_to}|{lang_from}"
        for t in list(translations)[:2]:
            try:
                data3 = _mymemory_get(t, reverse_pair)
                for match in data3.get("matches", []):
                    seg = match.get("segment", "").strip()
                    trans = match.get("translation", "").strip()
                    # seg (target lang) -> trans (source lang) means seg is synonym
                    if trans.lower() == t.lower() and seg:
                        add_trans(seg)
                    elif seg.lower() == t.lower() and trans:
                        # trans is a synonym of the original in source lang
                        # We can re-translate to get another target translation
                        pass
            except Exception:
                pass

    return translations[:10], examples[:6]


@app.route('/api/dictionary/search/<lang_from>/<lang_to>/<query>')
def api_dictionary_search(lang_from, lang_to, query):
    """Search for translations: online API + local dictionary."""
    query = query.strip()

    # Online search
    online_translations, examples = search_mymemory(lang_from, lang_to, query)

    # Local search
    local_results = search_local(lang_from, lang_to, query)

    # Merge, dedup case-insensitive
    all_translations = []
    seen_lower = set()
    for t in online_translations:
        if t.lower() not in seen_lower:
            all_translations.append(t)
            seen_lower.add(t.lower())
    for lr in local_results:
        for t in lr['translations']:
            if t.lower() not in seen_lower:
                all_translations.append(t)
                seen_lower.add(t.lower())

    result = {
        'query': query,
        'translations': all_translations[:10],
        'examples': examples,
        'local_matches': local_results[:5],
    }
    return jsonify(result)


# ===== CHATBOT =====
import re

LANG_NAMES = {
    "en": "English", "es": "Spanish", "it": "Italian",
    "fr": "French", "de": "German", "pl": "Polish",
}

GRAMMAR_TIPS = {
    "es": {
        "ser_estar": "**ser** vs **estar** — both mean 'to be'. Use **ser** for permanent traits (Soy alto = I am tall) and **estar** for temporary states or location (Estoy cansado = I am tired).",
        "gender": "Spanish nouns have gender. Generally, words ending in **-o** are masculine (el libro) and **-a** are feminine (la casa).",
        "tu_usted": "**tú** is informal 'you', **usted** is formal. Use **usted** with strangers or in professional contexts.",
        "verbs": "Spanish verbs end in -ar, -er, or -ir. Each conjugates differently. Examples: hablar (to speak), comer (to eat), vivir (to live).",
    },
    "it": {
        "essere_stare": "**essere** vs **stare** — both can mean 'to be'. Use **essere** for identity/state (Sono italiano = I am Italian) and **stare** for location, health, or continuous actions (Sto bene = I am well).",
        "gender": "Italian nouns have gender. Words ending in **-o** are usually masculine (il libro), **-a** are usually feminine (la casa).",
        "tu_lei": "**tu** is informal 'you', **Lei** (capitalized) is formal. Use **Lei** in professional or polite contexts.",
        "articles": "Italian articles: **il/lo/la** (singular), **i/gli/le** (plural). Choice depends on gender and the next word's first letter.",
    },
    "fr": {
        "tu_vous": "**tu** is informal 'you', **vous** is formal or plural. Use **vous** with strangers or to be polite.",
        "gender": "French nouns have gender (masculine/feminine). There's no easy rule — you must learn each noun with its article (le/la).",
        "etre_avoir": "**être** (to be) and **avoir** (to have) are the most important verbs — they're also used to form past tenses.",
        "liaison": "In French, the final consonant of a word often connects to the next word's vowel (les amis sounds like 'lez-ami').",
    },
    "de": {
        "cases": "German has 4 cases: **Nominativ** (subject), **Akkusativ** (direct object), **Dativ** (indirect object), **Genitiv** (possession). Articles change with each case.",
        "gender": "German has 3 genders: **der** (masculine), **die** (feminine), **das** (neuter). Always learn the article with the noun.",
        "verb_position": "In main clauses, the conjugated verb is always in **second position**: 'Heute gehe ich ins Kino' (Today go I to the cinema).",
        "du_sie": "**du** is informal 'you', **Sie** (always capitalized) is formal. Use **Sie** with adults you don't know.",
    },
    "en": {
        "articles": "English has **a/an** (indefinite — any one) and **the** (definite — a specific one). Use **a** before consonants, **an** before vowel sounds.",
        "tenses": "English has 12 tenses, but the most common are: present simple (I work), present continuous (I am working), past simple (I worked), and present perfect (I have worked).",
        "phrasal_verbs": "English uses many **phrasal verbs** (verb + preposition) like 'give up' (quit), 'look up' (search), 'turn on' (activate). Their meaning often differs from the original verb.",
    },
}


LANG_KEYWORDS = {
    "en": ["english", "inglese", "inglés", "anglais", "englisch"],
    "it": ["italian", "italiano", "italien", "italienisch"],
    "es": ["spanish", "spagnolo", "español", "espagnol", "spanisch"],
    "fr": ["french", "francese", "francés", "français", "französisch"],
    "de": ["german", "tedesco", "alemán", "allemand", "deutsch"],
}


def extract_target_lang(text_lower):
    """Find a language mentioned with 'in [lang]' or 'to [lang]'."""
    for code, keywords in LANG_KEYWORDS.items():
        for kw in keywords:
            if (
                f"in {kw}" in text_lower
                or f"to {kw}" in text_lower
                or f"en {kw}" in text_lower
                or f"auf {kw}" in text_lower
            ):
                return code
    return None


def extract_quoted_phrase(text):
    """Pull out a quoted phrase from the text. Returns the phrase or None."""
    # Try double quotes, single quotes, curly quotes
    patterns = [
        r'"([^"]+)"',
        r"'([^']+)'",
        r'«([^»]+)»',
        r'"([^"]+)"',
        r"'([^']+)'",
    ]
    for p in patterns:
        m = re.search(p, text)
        if m:
            return m.group(1).strip()
    return None


def detect_question_pattern(text, default_target='es'):
    """
    Detect what the user is asking.
    Returns dict: {kind, word, target_lang (optional)}
    """
    text_lower = text.lower().strip()

    # 1) Grammar question
    grammar_keywords = ["grammar", "verb", "tense", "conjugation", "article",
                        "gender", "ser estar", "essere stare", "tu vs", "case",
                        "subjunctive", "past tense"]
    for kw in grammar_keywords:
        if kw in text_lower:
            return {"kind": "grammar", "word": text_lower}

    # 2) Detect target language from question (e.g. "in english", "in italian")
    target_from_question = extract_target_lang(text_lower)

    # 3) Try to get a quoted word first (priority)
    quoted = extract_quoted_phrase(text)

    # 4) Translation patterns — try to extract the word
    patterns_translate = [
        r"how (?:do|can|would) (?:you|i|one) say ['\"]?(.+?)['\"]?(?:\s+in\s+\w+)?\s*[?.\s]*$",
        r"how to say ['\"]?(.+?)['\"]?(?:\s+in\s+\w+)?\s*[?.\s]*$",
        r"(?:the\s+)?best way (?:in\s+\w+\s+)?to say ['\"]?(.+?)['\"]?\s*[?.\s]*$",
        r"(?:the\s+)?(?:better|best) way to say ['\"]?(.+?)['\"]?(?:\s+in\s+\w+)?\s*[?.\s]*$",
        r"translate ['\"]?(.+?)['\"]?(?:\s+(?:to|into)\s+\w+)?\s*[?.\s]*$",
        r"what (?:does|is) ['\"]?(.+?)['\"]? mean\s*[?.\s]*$",
        r"what is ['\"]?(.+?)['\"]?\s*[?.\s]*$",
        r"meaning of ['\"]?(.+?)['\"]?\s*[?.\s]*$",
        r"come si dice ['\"]?(.+?)['\"]?(?:\s+in\s+\w+)?\s*[?.\s]*$",
        r"cosa (?:significa|vuol dire) ['\"]?(.+?)['\"]?\s*[?.\s]*$",
        r"comment dit-on ['\"]?(.+?)['\"]?(?:\s+en\s+\w+)?\s*[?.\s]*$",
        r"qué significa ['\"]?(.+?)['\"]?\s*[?.\s]*$",
        r"cómo se dice ['\"]?(.+?)['\"]?(?:\s+en\s+\w+)?\s*[?.\s]*$",
        r"was bedeutet ['\"]?(.+?)['\"]?\s*[?.\s]*$",
    ]

    word = None
    for p in patterns_translate:
        m = re.search(p, text_lower)
        if m:
            word = m.group(1).strip(" .,!?;:'\"")
            break

    # Prefer quoted phrase (it's more precise than regex)
    if quoted:
        word = quoted

    # Fallback: if no pattern matched and no quote, treat whole message as word
    if not word:
        word = text.strip()

    result = {"kind": "translate", "word": word}
    if target_from_question:
        result["target_lang"] = target_from_question
    return result


def detect_word_language(word, candidates):
    """
    Heuristic: detect which language a word is in by checking characteristics.
    `candidates` is a list of language codes to consider.
    Returns the most likely language code.
    """
    w = word.lower()

    # Character-based hints
    if any(c in w for c in "äöüß"):
        return "de" if "de" in candidates else candidates[0]
    if any(c in w for c in "àèéìòù"):
        return "it" if "it" in candidates else candidates[0]
    if any(c in w for c in "àâçéèêëîïôûùüÿœæ"):
        return "fr" if "fr" in candidates else candidates[0]
    if any(c in w for c in "áéíóúñ¿¡"):
        return "es" if "es" in candidates else candidates[0]

    # Word-ending hints
    it_endings = ("are", "ere", "ire", "zione", "mente", "ità")
    es_endings = ("ar", "er", "ir", "ción", "mente", "idad")
    fr_endings = ("er", "ir", "tion", "ment", "eux", "euse")
    de_endings = ("ung", "keit", "heit", "lich", "chen")

    if any(w.endswith(e) for e in de_endings) and "de" in candidates:
        return "de"
    if any(w.endswith(e) for e in it_endings) and "it" in candidates:
        return "it"
    if any(w.endswith(e) for e in es_endings) and "es" in candidates:
        return "es"
    if any(w.endswith(e) for e in fr_endings) and "fr" in candidates:
        return "fr"

    # Common word checks
    common = {
        "it": ["sono", "hai", "abbiamo", "siamo", "questo", "quello", "dolci", "goloso"],
        "es": ["estoy", "somos", "tengo", "tiene", "esto", "eso"],
        "fr": ["suis", "avons", "êtes", "ceci", "cela"],
        "de": ["bin", "sind", "habe", "dies", "das"],
        "en": ["am", "have", "this", "that"],
    }
    for code, words in common.items():
        if code in candidates and any(cw in w.split() for cw in words):
            return code

    # Default to first candidate (usually English)
    return candidates[0]


def answer_grammar(target_lang, question):
    """Match grammar question to a tip."""
    tips = GRAMMAR_TIPS.get(target_lang, {})
    q = question.lower()
    matched = []

    keyword_map = {
        "ser_estar": ["ser", "estar"],
        "essere_stare": ["essere", "stare"],
        "gender": ["gender", "masculine", "feminine", "der die das"],
        "tu_usted": ["tu", "usted", "formal"],
        "tu_lei": ["tu", "lei", "formal"],
        "tu_vous": ["tu", "vous", "formal"],
        "du_sie": ["du", "sie", "formal"],
        "verbs": ["verb", "conjugation"],
        "articles": ["article", "the", "a/an"],
        "cases": ["case", "akkusativ", "dativ", "nominativ"],
        "verb_position": ["verb position", "word order"],
        "tenses": ["tense", "past", "present", "future"],
        "phrasal_verbs": ["phrasal"],
        "liaison": ["liaison", "pronunciation"],
    }

    for tip_key, keywords in keyword_map.items():
        if tip_key in tips and any(kw in q for kw in keywords):
            matched.append(tips[tip_key])

    if matched:
        return "\n\n".join(matched)
    if tips:
        return "Here's a useful grammar tip:\n\n" + list(tips.values())[0]
    return "I don't have a specific tip for that. Try asking 'how do you say X' or look up the word in the Dictionary."


def check_grammar_languagetool(text, lt_lang='en-US'):
    """Use LanguageTool free API (no key) to check grammar/spelling."""
    url = "https://api.languagetool.org/v2/check"
    data = urllib.parse.urlencode({
        "text": text,
        "language": lt_lang,
    }).encode('utf-8')
    try:
        req = urllib.request.Request(
            url, data=data,
            headers={"User-Agent": "LinguaLeap/1.0"}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        return result.get('matches', [])
    except Exception as e:
        print(f"LanguageTool error: {e}")
        return []


def apply_corrections(text, matches):
    """Apply top suggestion for each grammar match. Returns (corrected, explanations)."""
    # Sort by offset descending so we apply from end to start
    sorted_matches = sorted(matches, key=lambda m: -m.get('offset', 0))
    corrected = text
    explanations = []
    for m in sorted_matches:
        offset = m.get('offset', 0)
        length = m.get('length', 0)
        replacements = m.get('replacements', [])
        if not replacements:
            continue
        original = corrected[offset:offset + length]
        best = replacements[0].get('value', '')
        if not best or best == original:
            continue
        corrected = corrected[:offset] + best + corrected[offset + length:]
        explanations.append({
            'original': original,
            'suggestion': best,
            'message': m.get('shortMessage') or m.get('message', ''),
        })
    # Reverse to show in reading order
    explanations.reverse()
    return corrected, explanations


def generate_conversational_reply(text):
    """Return a short, natural reply based on topics detected in the text."""
    t = text.lower()
    topics = [
        (('study', 'studying', 'school', 'homework', 'exam', 'test', 'learn'),
         "Studying takes real discipline — be proud of yourself for pushing through. What subject are you working on today?"),
        (('tired', 'exhausted', 'sleep', 'sleepy', 'rest'),
         "Rest matters just as much as effort. Did you manage to sleep well last night?"),
        (('thoughts', 'anxious', 'anxiety', 'stressed', 'stress', 'overwhelmed', 'worried'),
         "Getting lost in your thoughts can really drain you. Try to start small today — one chore at a time is still progress."),
        (('sad', 'down', 'depressed', 'unmotivated', 'force', 'forces', 'energy'),
         "It's okay to have low-energy days. Be kind to yourself — showing up at all counts. What's one tiny thing you can tackle first?"),
        (('work', 'job', 'office', 'boss', 'meeting'),
         "Work can be heavy. How do you usually recharge afterwards?"),
        (('feel', 'feeling', 'mood', 'emotion'),
         "Thanks for sharing how you feel. It takes courage to name your emotions. What usually helps you shift your mood?"),
        (('happy', 'excited', 'great', 'amazing', 'wonderful'),
         "That's lovely to hear! What's bringing you joy right now?"),
        (('food', 'eat', 'hungry', 'meal', 'cook', 'cooking'),
         "Food is a great way to explore a culture. What's your favorite dish to cook or eat?"),
        (('travel', 'trip', 'vacation', 'holiday'),
         "Travel is fantastic for language practice. Where are you dreaming of going next?"),
        (('family', 'friend', 'friends'),
         "People matter more than anything. Do you get to see them often?"),
    ]
    for keywords, reply in topics:
        if any(kw in t for kw in keywords):
            return reply
    return "I hear you. Every sentence you write takes you closer to fluency. What else is on your mind?"


def is_writing_practice(text):
    """Detect if the user is writing a sentence (not asking for translation/grammar tip)."""
    t = text.lower().strip()
    translation_markers = [
        'how do you say', 'how can you say', 'how to say',
        'what does', 'what is the', 'what means', 'meaning of',
        'translate', 'best way to say', 'best way in', 'better way to say',
        'come si dice', 'cosa significa', 'cosa vuol dire',
        'comment dit', 'comment on dit',
        'qué significa', 'cómo se dice',
        'was bedeutet', 'wie sagt man',
    ]
    for m in translation_markers:
        if m in t:
            return False

    grammar_markers = ['grammar', 'conjugation', 'tense', 'ser estar',
                       'essere stare', 'tu vs', 'formal vs', 'subjunctive']
    for m in grammar_markers:
        if m in t:
            return False

    # If the text is long enough and looks like a sentence, treat as writing
    words = text.split()
    if len(words) >= 6:
        return True
    return False


def handle_writing_practice(message, user_source, user_target):
    """
    Check grammar of the user's sentence, offer corrections + translation
    + conversational reply.
    """
    # Detect language of the message
    all_langs = ["en", "it", "es", "fr", "de"]
    msg_lang = detect_word_language(message, all_langs)

    lt_lang_map = {
        'en': 'en-US', 'it': 'it', 'es': 'es',
        'fr': 'fr', 'de': 'de-DE',
    }
    lt_lang = lt_lang_map.get(msg_lang, 'en-US')

    matches = check_grammar_languagetool(message, lt_lang)
    corrected, explanations = apply_corrections(message, matches)

    parts = []

    if corrected != message and explanations:
        parts.append("**Here's your sentence corrected:**")
        parts.append(f"_{corrected}_")
        parts.append("**What I changed:**")
        bullet_list = []
        for exp in explanations[:6]:
            reason = exp['message'] or 'small fix'
            bullet_list.append(
                f"• \"{exp['original']}\" → **{exp['suggestion']}** — _{reason}_"
            )
        parts.append("\n".join(bullet_list))
    else:
        parts.append("**Your sentence looks good — no major mistakes found!** 🎉")

    # Offer translation to the other language
    other_lang = user_target if msg_lang != user_target else user_source
    if other_lang != msg_lang:
        translations, _ = search_mymemory(msg_lang, other_lang, corrected)
        # Filter API error strings
        bad = ['PLEASE SELECT', 'INVALID', 'MYMEMORY WARNING', 'LANGUAGE PAIR']
        translations = [t for t in translations if not any(b in t.upper() for b in bad)]
        if translations:
            other_name = LANG_NAMES.get(other_lang, other_lang)
            parts.append(f"**In {other_name}:**")
            parts.append(f"_{translations[0]}_")

    # Conversational reply
    parts.append("---")
    parts.append(generate_conversational_reply(message))

    saveable = None
    if corrected != message:
        saveable = {
            'source': message.strip(),
            'translation': corrected,
            'allTranslations': [corrected],
            'langFrom': msg_lang,
            'langTo': msg_lang,  # same lang — it's a correction, not translation
        }

    return {
        'reply': "\n\n".join(parts),
        'type': 'writing',
        'corrected': corrected,
        'saveable': saveable,
    }


CHAT_SYSTEM_PROMPT = """You are LinguaLeap's warm, encouraging {target_name} tutor.
The user is learning {target_name}. When you explain something, use {source_name} so they fully understand.

First decide what the user's message is:

A) A LANGUAGE QUESTION — "how do you say X?", "what does X mean?", or a grammar question.
   - Translation question: give 2-5 natural {target_name} options (most natural first, in **bold**) with one short example each.
   - Grammar question: a clear explanation in 4-6 sentences with an example.

B) ANYTHING ELSE — treat it as the user practicing {target_name} by telling you something.
   ALWAYS answer in these THREE parts, in this order:
   1. CORRECTION — If the sentence has any mistake (grammar, spelling, verb tense, word order, punctuation), show the fully corrected sentence in **bold**, then a short "• " list of what you changed and why. If it is already correct, just say "✓ Perfect — no mistakes!" and do NOT invent changes.
   2. MORE NATURAL — If a native speaker would normally say it in a more natural or common way, add a line starting with "More natural: " followed by the better version in **bold**. Skip this line entirely if their sentence already sounds natural.
   3. REPLY — Then genuinely reply to what they said, like a friendly person would: react to the content and ask ONE follow-up question to keep the conversation going. Write this reply in {target_name} so they keep practicing.

IMPORTANT RULES:
- NEVER "translate" the user's sentence into the same language they wrote it in. Only translate if they explicitly ask for a translation.
- Keep everything short and scannable. Use **bold** for corrected text and key words, and "• " for bullets.
- Never mention that you are an AI or a model.
- Always finish your WHOLE response — never stop in the middle of a sentence.

ALWAYS end your response with this JSON block on a new line (it is hidden from the user):
<META>{{"type": "translation|grammar|writing", "saveable": {{"source": "...", "translation": "...", "langFrom": "xx", "langTo": "xx"}} or null}}</META>

For a translation question: saveable = the queried word + its best {target_name} translation.
For practice (part B): saveable = their original sentence + your corrected sentence (langFrom == langTo == "{target_lang}").
For a grammar question: saveable = null.
"""


@app.route('/api/chat', methods=['POST'])
def api_chat():
    """Handle a chat message using Gemini (free tier)."""
    body = request.get_json() or {}
    message = (body.get('message') or '').strip()
    user_target = body.get('target_lang', 'es')
    user_source = body.get('source_lang', 'en')
    history = body.get('history', [])  # optional: prior chat turns

    if not message:
        return jsonify({'reply': 'Ask me how to say something, or a grammar question!'})

    target_name = LANG_NAMES.get(user_target, user_target)
    source_name = LANG_NAMES.get(user_source, user_source)

    system_instruction = CHAT_SYSTEM_PROMPT.format(
        target_name=target_name, target_lang=user_target,
        source_name=source_name, source_lang=user_source,
    )

    # Build a conversational prompt from history + current message
    history_text = ""
    for turn in history[-6:]:  # last 6 turns
        role = turn.get('role', 'user')
        text = turn.get('text', '')
        if not text:
            continue
        who = "User" if role == 'user' else "Tutor"
        history_text += f"{who}: {text}\n"

    full_prompt = f"{history_text}User: {message}\nTutor:"

    try:
        reply_text = ai_generate(
            full_prompt,
            system_instruction=system_instruction,
            temperature=0.7,
            max_tokens=1500,
        )
    except GeminiQuotaExceeded as e:
        retry_str = _format_retry_time(e.retry_after_seconds)
        if e.quota_kind == 'per_day':
            msg = (
                "⏳ **Daily free-tier limit reached.**\n\n"
                "You've used all the free Gemini requests for today — "
                "no charges, don't worry! The quota resets once a day.\n\n"
                f"You can use the chatbot again in **{retry_str or 'about 24 hours'}**."
            )
        elif e.quota_kind == 'per_minute':
            msg = (
                "⏳ **Too many requests in a short time.**\n\n"
                "The free tier allows a limited number of requests per minute. "
                "No charges — just take a short break!\n\n"
                f"You can try again in **{retry_str or 'about 1 minute'}**."
            )
        else:
            msg = (
                "⏳ **Free-tier limit reached.**\n\n"
                "You've hit a Gemini free-tier quota. No charges, don't worry.\n\n"
                + (f"You can try again in **{retry_str}**." if retry_str
                   else "Please try again in a little while.")
            )
        return jsonify({
            'reply': msg,
            'type': 'quota_exceeded',
            'retry_after_seconds': e.retry_after_seconds,
            'quota_kind': e.quota_kind,
        })

    if not reply_text:
        return jsonify({
            'reply': "I couldn't reach my brain right now. Please check your connection and try again.",
            'type': 'error',
        })

    # Extract META JSON block if present
    meta_match = _re_html.search(r'<META>(\{.*?\})</META>', reply_text, _re_html.DOTALL)
    meta = {}
    if meta_match:
        try:
            meta = json.loads(meta_match.group(1))
        except Exception:
            meta = {}
        # Remove META block from visible reply
        reply_text = reply_text[:meta_match.start()].rstrip() + reply_text[meta_match.end():].lstrip()
        reply_text = reply_text.strip()

    response_type = meta.get('type', 'chat')
    saveable = meta.get('saveable')

    # Normalize saveable object
    if saveable and isinstance(saveable, dict):
        if saveable.get('source') and saveable.get('translation'):
            saveable['allTranslations'] = [saveable['translation']]
        else:
            saveable = None
    else:
        saveable = None

    return jsonify({
        'reply': reply_text,
        'type': response_type,
        'saveable': saveable,
    })


# ===== MOVIE / TV PHRASES =====
MOVIE_PHRASES_PROMPT = """You are a language-learning content creator.

The user is learning {target_name}. Their native language is {native_name}.
They gave you the title of a film or TV series: "{title}".

Produce a list of useful, natural phrases / expressions / ways of saying things
in {target_name} that are characteristic of (or fit the tone, themes and famous
lines of) "{title}". These should be real, idiomatic {target_name} that a learner
can actually reuse in conversation — NOT just literal movie quotes.

Group them by CEFR difficulty level: B1, B2, C1, C2.
Give 4-5 phrases per level (so 16-20 total). Harder levels = more idiomatic,
nuanced or sophisticated expressions.

For every phrase provide:
- "phrase": the expression in {target_name}
- "translation": its meaning in {native_name}
- "note": (optional) a very short usage hint or context, or "" if none

Reply ONLY with valid JSON, no markdown fences, in EXACTLY this shape:
{{"B1": [{{"phrase": "...", "translation": "...", "note": "..."}}],
  "B2": [...], "C1": [...], "C2": [...]}}
"""


def _parse_json_block(reply):
    """Strip code fences and parse a JSON object from a model reply."""
    if not reply:
        return None
    cleaned = reply.strip()
    cleaned = _re_html.sub(r'^```(?:json)?\s*', '', cleaned)
    cleaned = _re_html.sub(r'\s*```\s*$', '', cleaned)
    try:
        return json.loads(cleaned)
    except Exception:
        m = _re_html.search(r'\{.*\}', cleaned, _re_html.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
    return None


@app.route('/api/movie-phrases', methods=['POST'])
def api_movie_phrases():
    """Generate level-graded phrases inspired by a film/TV series via Gemini."""
    body = request.get_json() or {}
    title = (body.get('title') or '').strip()
    target_lang = body.get('target_lang', 'en')
    native_lang = body.get('native_lang', 'en')

    if not title:
        return jsonify({'error': 'Please enter a film or series title.'}), 400

    if not (DEEPSEEK_API_KEY or GEMINI_API_KEY):
        return jsonify({'error': 'AI is not configured (missing API key).'}), 503

    target_name = LANG_NAMES.get(target_lang, target_lang)
    native_name = LANG_NAMES.get(native_lang, native_lang)

    prompt = MOVIE_PHRASES_PROMPT.format(
        target_name=target_name, native_name=native_name, title=title,
    )

    try:
        reply = ai_generate(prompt, temperature=0.8, max_tokens=4000, timeout=90)
    except GeminiQuotaExceeded as e:
        retry_str = _format_retry_time(e.retry_after_seconds)
        if e.quota_kind == 'per_day':
            msg = ("Daily free-tier limit reached — no charges. "
                   f"Try again in {retry_str or 'about 24 hours'}.")
        elif e.quota_kind == 'per_minute':
            msg = ("Too many requests right now — no charges. "
                   f"Try again in {retry_str or 'about 1 minute'}.")
        else:
            msg = "Free-tier limit reached. Please try again in a little while."
        return jsonify({'error': msg, 'quota_exceeded': True}), 429

    data = _parse_json_block(reply)
    if not isinstance(data, dict):
        print(f"Movie phrases: failed to parse Gemini reply: {str(reply)[:400]}")
        return jsonify({'error': "Couldn't generate phrases. Try another title."}), 502

    # Normalize: keep only the 4 levels, each a clean list of phrase objects
    levels = {}
    for lvl in ('B1', 'B2', 'C1', 'C2'):
        items = data.get(lvl) or []
        clean = []
        if isinstance(items, list):
            for it in items:
                if not isinstance(it, dict):
                    continue
                phrase = str(it.get('phrase', '')).strip()
                translation = str(it.get('translation', '')).strip()
                note = str(it.get('note', '')).strip()
                if phrase and translation:
                    clean.append({
                        'phrase': phrase,
                        'translation': translation,
                        'note': note,
                    })
        levels[lvl] = clean

    if not any(levels.values()):
        return jsonify({'error': "Couldn't generate phrases. Try another title."}), 502

    return jsonify({
        'title': title,
        'target_lang': target_lang,
        'native_lang': native_lang,
        'levels': levels,
    })


# ===== LESSONS =====
LESSONS_FILE = os.path.join(DATA_DIR, 'lessons.json')
_lessons_cache = None


def load_lessons():
    global _lessons_cache
    if _lessons_cache is None:
        if not os.path.exists(LESSONS_FILE):
            return None
        with open(LESSONS_FILE, 'r', encoding='utf-8') as f:
            _lessons_cache = json.load(f)
    return _lessons_cache


PRONUNCIATION_PROMPT = """You are a pronunciation coach for a {lang_name} learner.

TARGET (what they should say): "{target}"
TRANSCRIPT (what the speech recognition heard): "{transcript}"

BASELINE: A text-similarity algorithm scored these two strings at {baseline_score}/100 (a pure character-level similarity between TARGET and TRANSCRIPT, ignoring capitalization and punctuation).

Your job is to return a final pronunciation score that REFINES this baseline.

KEY RULES FOR SCORING:
- If TARGET and TRANSCRIPT are essentially the same (ignore case + punctuation), the pronunciation was almost certainly good. Score 90-100.
- If the baseline is already 85+, give at least 85 — don't penalize further.
- If the baseline is 60-85, score in that range and point out any obviously wrong words.
- If the baseline is under 50, the learner probably said the wrong thing or mispronounced badly. Score accordingly.
- NEVER default to 50 unless the baseline is near 50.

Also identify any words in TRANSCRIPT that differ from TARGET (case-insensitive), and give ONE short actionable tip.

Reply ONLY with valid JSON, nothing else, no markdown fences:
{{"score": <int 0-100>, "feedback": "<one short encouraging sentence>", "tip": "<one practical tip or empty string>", "mispronounced": [<list of words>]}}
"""


def _normalize_for_compare(s):
    """Lowercase and strip punctuation for text similarity."""
    return _re_html.sub(r'[^\w\s]', '', s.lower()).strip()


def _levenshtein_similarity(a, b):
    """Return 0.0-1.0 string similarity based on Levenshtein distance."""
    a = _normalize_for_compare(a)
    b = _normalize_for_compare(b)
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return 1.0 - dp[m][n] / max(m, n)


def _diff_words(target, transcript):
    """Return words present in target that differ from transcript (case-insensitive)."""
    t_words = set(_normalize_for_compare(transcript).split())
    result = []
    for w in target.split():
        clean = _normalize_for_compare(w)
        if clean and clean not in t_words:
            result.append(w.strip(" .,!?;:"))
    return result[:5]


@app.route('/api/pronunciation', methods=['POST'])
def api_pronunciation():
    body = request.get_json() or {}
    target = (body.get('target') or '').strip()
    transcript = (body.get('transcript') or '').strip()
    lang = body.get('lang', 'en')

    if not target or not transcript:
        return jsonify({'error': 'Missing target or transcript'}), 400

    # Compute a deterministic baseline score via Levenshtein similarity
    sim = _levenshtein_similarity(target, transcript)
    baseline_score = int(round(sim * 100))

    # Exact match shortcut — skip the API call
    if baseline_score >= 95:
        diffs = _diff_words(target, transcript)
        return jsonify({
            'score': baseline_score,
            'feedback': 'Excellent! That sounded spot on.',
            'tip': '',
            'mispronounced': diffs,
        })

    lang_name = LANG_NAMES.get(lang, lang)
    prompt = PRONUNCIATION_PROMPT.format(
        lang_name=lang_name, target=target, transcript=transcript,
        baseline_score=baseline_score,
    )

    try:
        reply = ai_generate(prompt, temperature=0.2, max_tokens=300)
    except GeminiQuotaExceeded as e:
        # Use baseline as-is
        return jsonify({
            'score': baseline_score,
            'feedback': 'Quota reached — using text-only comparison.',
            'tip': '',
            'mispronounced': _diff_words(target, transcript),
            'quota_exceeded': True,
            'quota_kind': e.quota_kind,
        })

    if not reply:
        # Use baseline
        return jsonify({
            'score': baseline_score,
            'feedback': 'Checked using text comparison (AI unavailable).',
            'tip': '',
            'mispronounced': _diff_words(target, transcript),
        })

    # Strip code fences if present
    cleaned = reply.strip()
    cleaned = _re_html.sub(r'^```(?:json)?\s*', '', cleaned)
    cleaned = _re_html.sub(r'\s*```\s*$', '', cleaned)

    data = None
    try:
        data = json.loads(cleaned)
    except Exception:
        m = _re_html.search(r'\{.*\}', cleaned, _re_html.DOTALL)
        if m:
            try:
                data = json.loads(m.group(0))
            except Exception:
                data = None

    if not data or not isinstance(data, dict):
        # Gemini failed to return JSON — fall back to baseline
        print(f"Pronunciation: failed to parse Gemini response: {reply[:200]}")
        return jsonify({
            'score': baseline_score,
            'feedback': 'Checked using text comparison.',
            'tip': '',
            'mispronounced': _diff_words(target, transcript),
        })

    # Parse score carefully — coerce anything non-numeric to the baseline
    try:
        score = int(data.get('score', baseline_score))
    except (TypeError, ValueError):
        score = baseline_score

    # Safety: if Gemini's score is wildly lower than baseline on a close match, trust the baseline
    if baseline_score >= 80 and score < baseline_score - 20:
        score = baseline_score

    return jsonify({
        'score': max(0, min(100, score)),
        'feedback': str(data.get('feedback', '')).strip(),
        'tip': str(data.get('tip', '')).strip(),
        'mispronounced': data.get('mispronounced') or _diff_words(target, transcript),
        'baseline': baseline_score,
    })


@app.route('/api/lessons/<lang_code>')
def api_lessons(lang_code):
    data = load_lessons()
    if not data or lang_code not in data:
        return jsonify({'error': 'No lessons for this language'}), 404
    return jsonify(data[lang_code])


@app.route('/api/placement/<lang_code>')
def api_placement(lang_code):
    """Return placement test questions for a language."""
    data = load_lessons()
    if not data or lang_code not in data:
        return jsonify({'error': 'No placement test'}), 404
    return jsonify({'questions': data[lang_code].get('placement_test', [])})


# ===== FAVOURITES IMPORT =====
_EM_TAG_RE = _re_html.compile(r'</?em[^>]*>|<hend>', _re_html.IGNORECASE)


def _strip_html(text):
    if not text:
        return ''
    return _EM_TAG_RE.sub('', text).strip()


def _parse_csv_rows(reader):
    """Parse CSV rows into word entries. Returns (complete, incomplete) lists."""
    complete = []
    incomplete = []
    seen = set()

    for row in reader:
        source = _strip_html(row.get('Search text', ''))
        translation = _strip_html(row.get('Translation text', ''))
        lang_from = (row.get('Search language') or 'en').strip().lower()
        lang_to = (row.get('Translation language') or 'it').strip().lower()
        tags = _strip_html(row.get('Tags / Comments', ''))
        src_example = _strip_html(row.get('Search example', ''))
        tr_example = _strip_html(row.get('Translation example', ''))

        # Build all translations from Translation text + Tags/Comments
        all_trans = []
        if translation:
            all_trans.append(translation)
        if tags:
            for t in tags.split(','):
                t = t.strip()
                if t and t not in all_trans:
                    all_trans.append(t)

        # Incomplete: missing source or translation
        if not source or not all_trans:
            # Still has some data worth showing for manual fix
            partial_source = source or translation or ''
            partial_trans = translation or ''
            if partial_source or partial_trans:
                incomplete.append({
                    'source': partial_source,
                    'translation': partial_trans,
                    'allTranslations': all_trans or [partial_trans] if partial_trans else [],
                    'langFrom': lang_from,
                    'langTo': lang_to,
                    'exampleSource': src_example,
                    'exampleTranslation': tr_example,
                    'incomplete': True,
                })
            continue

        key = (source.lower(), lang_from, lang_to)
        if key in seen:
            continue
        seen.add(key)

        complete.append({
            'source': source,
            'translation': all_trans[0],
            'allTranslations': all_trans,
            'langFrom': lang_from,
            'langTo': lang_to,
            'exampleSource': src_example,
            'exampleTranslation': tr_example,
            'incomplete': False,
        })
    return complete, incomplete


@app.route('/api/import-favourites')
def api_import_favourites():
    """Parse favourites CSV files in the project root and return word entries."""
    project_dir = os.path.dirname(__file__)
    csv_files = sorted(glob.glob(os.path.join(project_dir, 'favourites*.csv')))
    if not csv_files:
        return jsonify({'error': 'No favourites CSV found', 'words': [], 'incomplete': []}), 404

    all_complete = []
    all_incomplete = []
    for path in csv_files:
        with open(path, 'r', encoding='utf-8', newline='') as f:
            reader = csv.DictReader(f)
            c, i = _parse_csv_rows(reader)
            all_complete.extend(c)
            all_incomplete.extend(i)

    return jsonify({
        'words': all_complete,
        'incomplete': all_incomplete,
        'count': len(all_complete),
        'incompleteCount': len(all_incomplete),
    })


@app.route('/api/import-csv', methods=['POST'])
def api_import_csv():
    """Accept an uploaded CSV file and parse it."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if not file.filename or not file.filename.endswith('.csv'):
        return jsonify({'error': 'Please upload a .csv file'}), 400

    import io
    text = file.read().decode('utf-8', errors='ignore')
    reader = csv.DictReader(io.StringIO(text))
    complete, incomplete = _parse_csv_rows(reader)

    return jsonify({
        'words': complete,
        'incomplete': incomplete,
        'count': len(complete),
        'incompleteCount': len(incomplete),
    })


# ===== PROGRESS SYNC =====
@app.route('/api/progress', methods=['GET'])
def api_progress_load():
    """Load saved progress from disk."""
    data = load_user_progress()
    if data is None:
        return jsonify({'exists': False})
    return jsonify({'exists': True, 'data': data})


@app.route('/api/progress', methods=['POST'])
def api_progress_save():
    """Save progress to disk."""
    body = request.get_json()
    if not body:
        return jsonify({'error': 'No data'}), 400
    ok = save_user_progress(body)
    if ok:
        return jsonify({'saved': True})
    return jsonify({'error': 'Save failed'}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000, use_reloader=False)
