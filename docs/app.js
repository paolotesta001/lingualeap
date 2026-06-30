// ===== LinguaLeap - Language Learning App =====

const App = {
    // State
    languages: [],
    currentLang: null,
    currentLangData: null,
    currentSkill: null,
    currentLevel: null,
    exercises: [],
    exerciseIndex: 0,
    sessionCorrect: 0,
    sessionTotal: 0,
    selectedAnswer: null,
    isChecked: false,

    // Progress (persisted in localStorage)
    progress: {},
    xp: 0,
    streak: 0,
    lastPractice: null,
    hearts: 5,
    savedWords: [], // [{source, translation, langFrom, langTo, addedAt}]
    reverseWords: [], // Words deleted from flashcards — reversed direction
    learnedWords: [], // Words fully learned (deleted from reverse tab)
    mySentences: [], // Phrases saved from Movie Phrases [{source, translation, langFrom, langTo}]
    wordsLearned: 0, // legacy counter, kept for backwards compat
    currentWordsTab: 'saved', // 'saved', 'reverse', 'sentences', or 'learned' (virtual, via modal)

    // Movie phrases state
    moviePhrasesData: null,

    // Dictionary state
    dictFromLang: 'en',
    dictToLang: 'es',
    dictSearchTimeout: null,

    // Flashcard state
    flashcardDeck: [],
    flashcardIndex: 0,
    flashcardRevealed: false,

    // DOM refs
    screens: {},

    // TTS
    synth: window.speechSynthesis,

    // Speech Recognition
    recognition: null,
    speechSupported: false,

    async init() {
        await this.loadProgress();
        this.cacheDOM();
        this.bindEvents();
        this.checkSpeechSupport();
        this.fetchLanguages();
        this.updateTopBar();
    },

    // ===== PERSISTENCE =====
    _applyData(data) {
        this.progress = data.progress || {};
        this.xp = data.xp || 0;
        this.streak = data.streak || 0;
        this.lastPractice = data.lastPractice || null;
        this.hearts = data.hearts !== undefined ? data.hearts : 5;
        this.savedWords = data.savedWords || [];
        this.reverseWords = data.reverseWords || [];
        this.learnedWords = data.learnedWords || [];
        this.mySentences = data.mySentences || [];
        this.wordsLearned = data.wordsLearned || this.learnedWords.length || 0;
    },

    _getDataSnapshot() {
        return {
            progress: this.progress,
            xp: this.xp,
            streak: this.streak,
            lastPractice: this.lastPractice,
            hearts: this.hearts,
            savedWords: this.savedWords,
            reverseWords: this.reverseWords,
            learnedWords: this.learnedWords,
            mySentences: this.mySentences,
            wordsLearned: this.wordsLearned,
        };
    },

    async loadProgress() {
        // Try server first (survives browser data clearing)
        try {
            const res = await fetch('/api/progress');
            const json = await res.json();
            if (json.exists && json.data) {
                this._applyData(json.data);
                // Also sync to localStorage as cache
                localStorage.setItem('lingualeap_progress', JSON.stringify(json.data));
                this.checkStreak();
                return;
            }
        } catch (e) {
            // Server unreachable — fall through to localStorage
        }

        // Fallback: localStorage
        const saved = localStorage.getItem('lingualeap_progress');
        if (saved) {
            this._applyData(JSON.parse(saved));
        }
        this.checkStreak();
    },

    _saveTimeout: null,

    saveProgress() {
        const snapshot = this._getDataSnapshot();
        // Always save to localStorage immediately
        localStorage.setItem('lingualeap_progress', JSON.stringify(snapshot));

        // Debounce server save (avoid hammering on rapid changes)
        clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => {
            fetch('/api/progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(snapshot),
            }).catch(() => {});
        }, 500);
    },

    checkStreak() {
        const today = new Date().toDateString();
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        if (this.lastPractice === today) return;
        if (this.lastPractice === yesterday) return; // streak preserved
        if (this.lastPractice && this.lastPractice !== yesterday) {
            this.streak = 0; // streak broken
        }
    },

    recordPractice() {
        const today = new Date().toDateString();
        if (this.lastPractice !== today) {
            const yesterday = new Date(Date.now() - 86400000).toDateString();
            if (this.lastPractice === yesterday || !this.lastPractice) {
                this.streak++;
            } else {
                this.streak = 1;
            }
            this.lastPractice = today;
        }
        this.saveProgress();
    },

    getProgressKey(langCode, levelId, skill) {
        return `${langCode}_${levelId}_${skill}`;
    },

    getCompletedCount(langCode, levelId, skill) {
        const key = this.getProgressKey(langCode, levelId, skill);
        return (this.progress[key] || []).length;
    },

    markExerciseDone(langCode, levelId, skill, exerciseId) {
        const key = this.getProgressKey(langCode, levelId, skill);
        if (!this.progress[key]) this.progress[key] = [];
        if (!this.progress[key].includes(exerciseId)) {
            this.progress[key].push(exerciseId);
        }
        this.saveProgress();
    },

    // ===== DOM =====
    cacheDOM() {
        this.screens = {
            language: document.getElementById('languageScreen'),
            dashboard: document.getElementById('dashboardScreen'),
            exercise: document.getElementById('exerciseScreen'),
            results: document.getElementById('resultsScreen'),
            dictionary: document.getElementById('dictionaryScreen'),
            myWords: document.getElementById('myWordsScreen'),
            flashcard: document.getElementById('flashcardScreen'),
            chatbot: document.getElementById('chatbotScreen'),
            lessons: document.getElementById('lessonsScreen'),
            placement: document.getElementById('placementScreen'),
            lessonDetail: document.getElementById('lessonDetailScreen'),
            moviePhrases: document.getElementById('moviePhrasesScreen'),
        };
    },

    showScreen(name) {
        Object.values(this.screens).forEach(s => s.classList.remove('active'));
        this.screens[name].classList.add('active');
    },

    bindEvents() {
        document.getElementById('backToLanguages').addEventListener('click', () => {
            this.showScreen('language');
        });

        document.getElementById('backToDashboard').addEventListener('click', () => {
            this.showScreen('dashboard');
            this.renderDashboard();
        });

        document.getElementById('checkBtn').addEventListener('click', () => this.checkAnswer());
        document.getElementById('continueBtn').addEventListener('click', () => this.nextExercise());
        document.getElementById('continueToMenu').addEventListener('click', () => {
            this.showScreen('dashboard');
            this.renderDashboard();
        });

        // Skill cards
        document.querySelectorAll('.skill-card').forEach(card => {
            card.addEventListener('click', () => {
                const skill = card.dataset.skill;
                this.startSkillPractice(skill);
            });
        });

        // Vocabulary buttons
        document.getElementById('openDictionaryBtn').addEventListener('click', () => this.openDictionary());
        document.getElementById('openMyWordsBtn').addEventListener('click', () => this.openMyWords());
        document.getElementById('backFromDictionary').addEventListener('click', () => {
            this.showScreen('dashboard');
            this.renderDashboard();
        });
        document.getElementById('backFromMyWords').addEventListener('click', () => {
            this.showScreen('dashboard');
            this.renderDashboard();
        });
        document.getElementById('backFromFlashcard').addEventListener('click', () => {
            if (this.currentWordsTab === 'learned') {
                this.currentWordsTab = 'saved';
            }
            this.openMyWords();
        });

        // Dictionary search — only on button click or Enter
        document.getElementById('dictSearchBtn').addEventListener('click', () => {
            const q = document.getElementById('dictSearchInput').value.trim();
            if (q.length >= 1) this.searchDictionary(q);
        });
        document.getElementById('dictSearchInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const q = e.target.value.trim();
                if (q.length >= 1) this.searchDictionary(q);
            }
        });

        document.getElementById('dictSwapBtn').addEventListener('click', () => {
            const tmp = this.dictFromLang;
            this.dictFromLang = this.dictToLang;
            this.dictToLang = tmp;
            this.renderDictLangChips();
            const q = document.getElementById('dictSearchInput').value.trim();
            if (q) this.searchDictionary(q);
        });

        // Flashcard
        document.getElementById('practiceWordsBtn').addEventListener('click', () => this.startFlashcards());
        document.getElementById('importFavouritesBtn').addEventListener('click', () => this.importFavourites());
        document.querySelectorAll('.words-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.currentWordsTab = tab.dataset.tab;
                this.renderMyWords();
            });
        });

        // Learned words modal
        document.getElementById('openLearnedBtn').addEventListener('click', () => this.openLearnedModal());
        document.getElementById('learnedModalClose').addEventListener('click', () => this.closeLearnedModal());
        document.getElementById('learnedModalCancel').addEventListener('click', () => this.closeLearnedModal());
        document.getElementById('learnedModalPractice').addEventListener('click', () => this.practiceLearned());
        document.getElementById('learnedModal').addEventListener('click', (e) => {
            if (e.target.id === 'learnedModal') this.closeLearnedModal();
        });
        document.getElementById('csvFileInput').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.uploadCsvFile(file);
                e.target.value = '';  // reset so same file can be re-uploaded
            }
        });
        document.getElementById('flashcard').addEventListener('click', () => this.flipFlashcard());
        document.getElementById('flashcardGoodBtn').addEventListener('click', () => this.nextFlashcard(true));
        document.getElementById('flashcardBadBtn').addEventListener('click', () => this.nextFlashcard(false));
        document.getElementById('flashcardDeleteBtn').addEventListener('click', () => this.deleteFlashcard());
        document.getElementById('flashcardListenBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.listenFlashcard();
        });

        // Movie phrases
        document.getElementById('openMoviePhrasesBtn').addEventListener('click', () => this.openMoviePhrases());
        document.getElementById('backFromMoviePhrases').addEventListener('click', () => {
            this.showScreen('dashboard');
            this.renderDashboard();
        });
        document.getElementById('moviePhraseSearchBtn').addEventListener('click', () => this.searchMoviePhrases());
        document.getElementById('moviePhraseInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.searchMoviePhrases();
        });

        // Chatbot
        document.getElementById('openChatbotBtn').addEventListener('click', () => this.openChatbot());
        document.getElementById('backFromChatbot').addEventListener('click', () => {
            this.showScreen('dashboard');
            this.renderDashboard();
        });
        document.getElementById('chatSendBtn').addEventListener('click', () => this.sendChatMessage());
        document.getElementById('chatInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });

        // Save word modal
        document.getElementById('saveModalClose').addEventListener('click', () => this.closeSaveModal());
        document.getElementById('saveModalCancel').addEventListener('click', () => this.closeSaveModal());
        document.getElementById('saveModalConfirm').addEventListener('click', () => this.confirmSaveModal());
        document.getElementById('saveWordModal').addEventListener('click', (e) => {
            if (e.target.id === 'saveWordModal') this.closeSaveModal();
        });

        // Lessons
        document.getElementById('openLessonsBtn').addEventListener('click', () => this.openLessons());
        document.getElementById('backFromLessons').addEventListener('click', () => {
            this.showScreen('dashboard');
            this.renderDashboard();
        });
        document.getElementById('startPlacementBtn').addEventListener('click', () => this.startPlacement());
        document.getElementById('backFromPlacement').addEventListener('click', () => this.openLessons());
        document.getElementById('placementNextBtn').addEventListener('click', () => this.nextPlacement());
        document.getElementById('backFromLessonDetail').addEventListener('click', () => this.openLessons());
    },

    // ===== DICTIONARY =====
    dictLanguages: [
        { code: 'en', name: 'English', flag: '🇺🇸' },
        { code: 'es', name: 'Spanish', flag: '🇪🇸' },
        { code: 'it', name: 'Italian', flag: '🇮🇹' },
        { code: 'fr', name: 'French', flag: '🇫🇷' },
        { code: 'de', name: 'German', flag: '🇩🇪' },
    ],

    openDictionary() {
        // Default: search English -> current learning language
        this.dictFromLang = 'en';
        this.dictToLang = this.currentLang || 'es';
        if (this.dictFromLang === this.dictToLang) {
            this.dictToLang = this.dictFromLang === 'es' ? 'it' : 'es';
        }
        this.renderDictLangChips();
        document.getElementById('dictSearchInput').value = '';
        document.getElementById('dictResults').innerHTML = '<div class="dict-empty">Start typing to search the dictionary</div>';
        this.showScreen('dictionary');
        document.getElementById('dictSearchInput').focus();
    },

    renderDictLangChips() {
        const fromContainer = document.getElementById('dictFromChips');
        const toContainer = document.getElementById('dictToChips');

        fromContainer.innerHTML = this.dictLanguages.map(l => `
            <button class="dict-lang-chip ${l.code === this.dictFromLang ? 'active' : ''} ${l.code === this.dictToLang ? 'disabled' : ''}"
                    data-code="${l.code}">${l.flag} ${l.name}</button>
        `).join('');

        toContainer.innerHTML = this.dictLanguages.map(l => `
            <button class="dict-lang-chip ${l.code === this.dictToLang ? 'active' : ''} ${l.code === this.dictFromLang ? 'disabled' : ''}"
                    data-code="${l.code}">${l.flag} ${l.name}</button>
        `).join('');

        fromContainer.querySelectorAll('.dict-lang-chip:not(.disabled)').forEach(chip => {
            chip.addEventListener('click', () => {
                this.dictFromLang = chip.dataset.code;
                this.renderDictLangChips();
                const q = document.getElementById('dictSearchInput').value.trim();
                if (q) this.searchDictionary(q);
            });
        });

        toContainer.querySelectorAll('.dict-lang-chip:not(.disabled)').forEach(chip => {
            chip.addEventListener('click', () => {
                this.dictToLang = chip.dataset.code;
                this.renderDictLangChips();
                const q = document.getElementById('dictSearchInput').value.trim();
                if (q) this.searchDictionary(q);
            });
        });
    },

    async searchDictionary(query) {
        const container = document.getElementById('dictResults');
        container.innerHTML = '<div class="dict-empty">Searching...</div>';
        try {
            const res = await fetch(`/api/dictionary/search/${this.dictFromLang}/${this.dictToLang}/${encodeURIComponent(query)}`);
            const data = await res.json();
            this.renderDictResults(data);
        } catch (err) {
            container.innerHTML = '<div class="dict-empty">Search failed. Check your connection.</div>';
            console.error('Dictionary search failed:', err);
        }
    },

    renderDictResults(data) {
        const container = document.getElementById('dictResults');
        const translations = data.translations || [];
        const examples = data.examples || [];

        if (translations.length === 0 && examples.length === 0) {
            container.innerHTML = '<div class="dict-empty">No results found. Try another word.</div>';
            return;
        }

        let html = '';

        // Translations section
        if (translations.length > 0 || true) {
            html += `
                <div class="dict-result">
                    <div class="dict-result-header">
                        <div class="dict-result-source">${this.escapeHtml(data.query)}</div>
                        <button class="dict-listen-btn" id="dictListenSource" title="Listen">🔊</button>
                    </div>
                    <div class="dict-section-label">TRANSLATIONS</div>
                    <div class="dict-translations">
                        ${translations.map((t, i) => `
                            <button class="dict-translation-chip ${i === 0 ? 'default selected' : ''}" data-translation="${this.escapeHtml(t)}">${this.escapeHtml(t)}</button>
                        `).join('')}
                    </div>
                    <div class="dict-custom-row">
                        <input type="text" class="dict-custom-input" id="dictCustomInput" placeholder="Add your own translation..." autocomplete="off">
                        <button class="dict-custom-add-btn" id="dictCustomAddBtn">+</button>
                    </div>
                    <button class="dict-save-btn" data-source="${this.escapeHtml(data.query)}">+ Save Word</button>
                </div>
            `;
        }

        // Examples section
        if (examples.length > 0) {
            html += `<div class="dict-section-label" style="margin-top:8px">EXAMPLES IN CONTEXT</div>`;
            html += examples.map(ex => `
                <div class="dict-example">
                    <div class="dict-example-source">
                        ${this.highlightWord(this.escapeHtml(ex.source), data.query)}
                        <button class="dict-example-listen" data-text="${this.escapeHtml(ex.source)}" title="Listen">🔊</button>
                    </div>
                    <div class="dict-example-bottom">
                        <div class="dict-example-translation">${this.escapeHtml(ex.translation)}</div>
                        <button class="dict-example-save" data-source="${this.escapeHtml(ex.source)}" data-translation="${this.escapeHtml(ex.translation)}" title="Save this phrase">+ Save</button>
                    </div>
                </div>
            `).join('');
        }

        container.innerHTML = html;

        // Wire up translation chip selection
        const resultEl = container.querySelector('.dict-result');
        if (resultEl) {
            const chipsContainer = resultEl.querySelector('.dict-translations');
            const chips = resultEl.querySelectorAll('.dict-translation-chip');
            chips.forEach(chip => {
                chip.addEventListener('click', () => {
                    resultEl.querySelectorAll('.dict-translation-chip').forEach(c => c.classList.remove('selected'));
                    chip.classList.add('selected');
                });
            });

            // Custom translation input
            const customInput = document.getElementById('dictCustomInput');
            const customAddBtn = document.getElementById('dictCustomAddBtn');
            const addCustomChip = () => {
                const val = customInput.value.trim();
                if (!val) return;
                const chip = document.createElement('button');
                chip.className = 'dict-translation-chip selected';
                chip.dataset.translation = val;
                chip.textContent = val;
                // Deselect all others
                resultEl.querySelectorAll('.dict-translation-chip').forEach(c => c.classList.remove('selected'));
                chipsContainer.appendChild(chip);
                chip.addEventListener('click', () => {
                    resultEl.querySelectorAll('.dict-translation-chip').forEach(c => c.classList.remove('selected'));
                    chip.classList.add('selected');
                });
                customInput.value = '';
            };
            customAddBtn.addEventListener('click', addCustomChip);
            customInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') addCustomChip();
            });

            // Save button — saves selected + all other translations
            const saveBtn = resultEl.querySelector('.dict-save-btn');
            saveBtn.addEventListener('click', () => {
                const allChips = resultEl.querySelectorAll('.dict-translation-chip');
                const selected = resultEl.querySelector('.dict-translation-chip.selected');
                const chosenTranslation = selected ? selected.dataset.translation : (allChips[0]?.dataset.translation || '');
                if (!chosenTranslation) return;

                // Collect all translations, chosen first
                const allTranslations = [];
                allTranslations.push(chosenTranslation);
                allChips.forEach(c => {
                    const t = c.dataset.translation;
                    if (t && t !== chosenTranslation && !allTranslations.includes(t)) {
                        allTranslations.push(t);
                    }
                });

                this.saveWord(data.query, chosenTranslation, allTranslations);
                saveBtn.textContent = '✓ Saved';
                saveBtn.classList.add('saved');
                saveBtn.disabled = true;
            });

            // Listen to source word
            const listenBtn = document.getElementById('dictListenSource');
            if (listenBtn) {
                const ttsMap = { en: 'en-US', es: 'es-ES', it: 'it-IT', fr: 'fr-FR', de: 'de-DE' };
                listenBtn.addEventListener('click', () => {
                    this.speak(data.query, ttsMap[this.dictFromLang] || 'en-US');
                });
            }
        }

        // Listen buttons on examples
        const ttsMap = { en: 'en-US', es: 'es-ES', it: 'it-IT', fr: 'fr-FR', de: 'de-DE' };
        container.querySelectorAll('.dict-example-listen').forEach(btn => {
            btn.addEventListener('click', () => {
                this.speak(btn.dataset.text, ttsMap[this.dictFromLang] || 'en-US');
            });
        });

        // Save buttons on examples
        container.querySelectorAll('.dict-example-save').forEach(btn => {
            btn.addEventListener('click', () => {
                this.saveWord(btn.dataset.source, btn.dataset.translation, [btn.dataset.translation]);
                btn.textContent = '✓ Saved';
                btn.classList.add('saved');
                btn.disabled = true;
            });
        });
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    highlightWord(text, word) {
        const regex = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<strong class="dict-highlight">$1</strong>');
    },

    saveWord(source, translation, allTranslations) {
        // Avoid duplicates (same source + same language pair)
        const exists = this.savedWords.some(w =>
            w.source.toLowerCase() === source.toLowerCase() &&
            w.langFrom === this.dictFromLang && w.langTo === this.dictToLang
        );
        if (exists) return;

        this.savedWords.push({
            source,
            translation,  // chosen/preferred translation
            allTranslations: allTranslations || [translation],  // all available
            langFrom: this.dictFromLang,
            langTo: this.dictToLang,
            addedAt: Date.now(),
        });
        this.saveProgress();
    },

    // ===== MY WORDS =====
    openMyWords() {
        this.showScreen('myWords');
        this.renderMyWords();
    },

    _pendingIncomplete: [],
    _pendingIncompleteIdx: 0,

    async importFavourites() {
        const btn = document.getElementById('importFavouritesBtn');
        const originalLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = '⏳ Importing...';
        try {
            const resp = await fetch('/api/import-favourites');
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                alert(err.error || `Import failed (${resp.status})`);
                return;
            }
            const data = await resp.json();
            this._processImportData(data);
        } catch (e) {
            alert('Import failed: ' + e.message);
        } finally {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    },

    async uploadCsvFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        try {
            const resp = await fetch('/api/import-csv', { method: 'POST', body: formData });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                alert(err.error || `Upload failed (${resp.status})`);
                return;
            }
            const data = await resp.json();
            this._processImportData(data);
        } catch (e) {
            alert('Upload failed: ' + e.message);
        }
    },

    _processImportData(data) {
        const incoming = data.words || [];
        const incomplete = data.incomplete || [];
        let added = 0;
        let skipped = 0;

        for (const w of incoming) {
            const dup = this.savedWords.some(s =>
                s.source.toLowerCase() === w.source.toLowerCase() &&
                s.langFrom === w.langFrom && s.langTo === w.langTo
            );
            if (dup) { skipped++; continue; }
            this.savedWords.push({
                source: w.source,
                translation: w.translation,
                allTranslations: w.allTranslations || [w.translation],
                langFrom: w.langFrom,
                langTo: w.langTo,
                addedAt: Date.now(),
            });
            added++;
        }
        this.saveProgress();
        this.renderMyWords();

        let msg = `Imported ${added} new word${added !== 1 ? 's' : ''}`;
        if (skipped) msg += ` (${skipped} already saved)`;
        if (incomplete.length > 0) {
            msg += `\n\n${incomplete.length} word${incomplete.length !== 1 ? 's are' : ' is'} incomplete and need${incomplete.length === 1 ? 's' : ''} your input.`;
        }
        alert(msg);

        // Start processing incomplete words one by one
        if (incomplete.length > 0) {
            this._pendingIncomplete = incomplete;
            this._pendingIncompleteIdx = 0;
            this._showNextIncomplete();
        }
    },

    _showNextIncomplete() {
        if (this._pendingIncompleteIdx >= this._pendingIncomplete.length) {
            this._pendingIncomplete = [];
            this._pendingIncompleteIdx = 0;
            this.renderMyWords();
            return;
        }
        const w = this._pendingIncomplete[this._pendingIncompleteIdx];
        // Pre-fill the save modal
        document.getElementById('saveModalSource').value = w.source || '';
        document.getElementById('saveModalTranslation').value = w.translation || '';
        document.getElementById('saveModalLangFrom').value = w.langFrom || 'en';
        document.getElementById('saveModalLangTo').value = w.langTo || 'it';

        // Override modal title
        const remaining = this._pendingIncomplete.length - this._pendingIncompleteIdx;
        document.querySelector('#saveWordModal .modal-header h2').textContent =
            `✏️ Complete word (${this._pendingIncompleteIdx + 1}/${this._pendingIncomplete.length})`;

        document.getElementById('saveWordModal').classList.remove('hidden');
        // Focus the empty field
        if (!w.source) {
            document.getElementById('saveModalSource').focus();
        } else {
            document.getElementById('saveModalTranslation').focus();
        }

        // Temporarily override confirm to chain to next
        this._incompleteMode = true;
    },

    renderMyWords() {
        const container = document.getElementById('myWordsList');
        const practiceBtn = document.getElementById('practiceWordsBtn');

        // Update stats
        document.getElementById('myWordsTotal').textContent = this.savedWords.length;
        document.getElementById('myWordsLearned').textContent = this.wordsLearned;

        // Update tab counts + active state
        document.getElementById('tabCountSaved').textContent = this.savedWords.length;
        document.getElementById('tabCountReverse').textContent = this.reverseWords.length;
        document.getElementById('tabCountSentences').textContent = this.mySentences.length;
        document.querySelectorAll('.words-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === this.currentWordsTab);
        });

        const isReverse = this.currentWordsTab === 'reverse';
        const isSentences = this.currentWordsTab === 'sentences';
        const list = isReverse ? this.reverseWords
            : isSentences ? this.mySentences
            : this.savedWords;

        if (list.length === 0) {
            const emptyMsg = isSentences
                ? 'No sentences yet.<br>Use 🎬 Movie Phrases to find phrases and add them here.'
                : isReverse
                ? 'No words here yet.<br>Delete a word from the flashcards to practice it in reverse.'
                : 'No saved words yet.<br>Use the Dictionary to look up and save words.';
            container.innerHTML = `<div class="my-words-empty">${emptyMsg}</div>`;
            practiceBtn.disabled = true;
            return;
        }

        practiceBtn.disabled = false;
        const names = { en: 'EN', es: 'ES', it: 'IT', fr: 'FR', de: 'DE' };
        const ttsMap = { en: 'en-US', es: 'es-ES', it: 'it-IT', fr: 'fr-FR', de: 'de-DE' };

        container.innerHTML = list.slice().reverse().map((w, displayIdx) => {
            const realIdx = list.length - 1 - displayIdx;
            const others = (w.allTranslations || []).filter(t => t !== w.translation);
            const othersText = others.length > 0 ? others.join(', ') : '';

            return `
                <div class="my-word-item ${isReverse ? 'my-word-reverse' : ''}">
                    <button class="my-word-listen" data-text="${this.escapeHtml(w.source)}" data-lang="${ttsMap[w.langFrom] || 'en-US'}" title="Listen">🔊</button>
                    <div class="my-word-text">
                        <div class="my-word-source">${this.escapeHtml(w.source)}</div>
                        <div class="my-word-translation">${this.escapeHtml(w.translation)}${othersText ? ' <span class="my-word-others">| ' + this.escapeHtml(othersText) + '</span>' : ''}</div>
                    </div>
                    <div class="my-word-meta">
                        <div class="my-word-langs">${names[w.langFrom] || w.langFrom} › ${names[w.langTo] || w.langTo}</div>
                    </div>
                    <button class="my-word-delete" data-idx="${realIdx}" title="Remove">🗑️</button>
                </div>
            `;
        }).join('');

        // Listen buttons
        container.querySelectorAll('.my-word-listen').forEach(btn => {
            btn.addEventListener('click', () => {
                this.speak(btn.dataset.text, btn.dataset.lang);
            });
        });

        // Delete buttons
        container.querySelectorAll('.my-word-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                if (isReverse) {
                    this.reverseWords.splice(idx, 1);
                    this.wordsLearned++;
                } else if (isSentences) {
                    this.mySentences.splice(idx, 1);
                } else {
                    this.savedWords.splice(idx, 1);
                    this.wordsLearned++;
                }
                this.saveProgress();
                this.renderMyWords();
            });
        });
    },

    // ===== FLASHCARD GAME =====
    startFlashcards() {
        let source;
        if (this.currentWordsTab === 'reverse') source = this.reverseWords;
        else if (this.currentWordsTab === 'learned') source = this.learnedWords;
        else if (this.currentWordsTab === 'sentences') source = this.mySentences;
        else source = this.savedWords;
        if (source.length === 0) return;
        this.flashcardDeck = this.shuffle(source);
        this.flashcardIndex = 0;
        this.showScreen('flashcard');
        this.renderFlashcard();
    },

    // ===== LEARNED WORDS MODAL =====
    openLearnedModal() {
        const body = document.getElementById('learnedModalBody');
        const names = { en: 'EN', es: 'ES', it: 'IT', fr: 'FR', de: 'DE' };
        document.getElementById('learnedModalCount').textContent = this.learnedWords.length;

        if (this.learnedWords.length === 0) {
            body.innerHTML = '<div class="learned-empty">No words learned yet.<br>Delete a word from the Reverse Translation flashcards to mark it as learned!</div>';
            document.getElementById('learnedModalPractice').disabled = true;
        } else {
            document.getElementById('learnedModalPractice').disabled = false;
            body.innerHTML = this.learnedWords.slice().reverse().map(w => `
                <div class="learned-word-item">
                    <div class="learned-word-source">${this.escapeHtml(w.source)}</div>
                    <div class="learned-word-translation">${this.escapeHtml(w.translation)}</div>
                    <div class="learned-word-langs">${names[w.langFrom] || w.langFrom} › ${names[w.langTo] || w.langTo}</div>
                </div>
            `).join('');
        }
        document.getElementById('learnedModal').classList.remove('hidden');
    },

    closeLearnedModal() {
        document.getElementById('learnedModal').classList.add('hidden');
    },

    practiceLearned() {
        if (this.learnedWords.length === 0) return;
        this.currentWordsTab = 'learned';
        this.closeLearnedModal();
        this.startFlashcards();
    },

    renderFlashcard() {
        if (this.flashcardIndex >= this.flashcardDeck.length) {
            // Done — return to My Words
            alert(`Practice complete! You reviewed ${this.flashcardDeck.length} words.`);
            // If we were practicing learned words, reset to saved tab
            if (this.currentWordsTab === 'learned') {
                this.currentWordsTab = 'saved';
            }
            this.openMyWords();
            return;
        }

        const card = this.flashcardDeck[this.flashcardIndex];
        this.flashcardCard = card;
        document.getElementById('flashcardWord').textContent = card.source;
        document.getElementById('flashcardTranslation').textContent = card.translation;
        document.getElementById('flashcardFront').classList.remove('hidden');
        document.getElementById('flashcardBack').classList.add('hidden');
        document.getElementById('flashcardButtons').classList.add('hidden');
        this.flashcardRevealed = false;

        document.getElementById('flashcardCurrent').textContent = this.flashcardIndex + 1;
        document.getElementById('flashcardTotal').textContent = this.flashcardDeck.length;
        const pct = (this.flashcardIndex / this.flashcardDeck.length) * 100;
        document.getElementById('flashcardProgressFill').style.width = `${pct}%`;
    },

    flipFlashcard() {
        if (this.flashcardRevealed) return;
        document.getElementById('flashcardFront').classList.add('hidden');
        document.getElementById('flashcardBack').classList.remove('hidden');
        document.getElementById('flashcardButtons').classList.remove('hidden');
        this.flashcardRevealed = true;
    },

    nextFlashcard(gotIt) {
        if (gotIt) {
            this.xp += 5;
            this.updateTopBar();
            this.saveProgress();
        } else {
            const card = this.flashcardDeck[this.flashcardIndex];
            this.flashcardDeck.push(card);
        }
        this.flashcardIndex++;
        this.renderFlashcard();
    },

    deleteFlashcard() {
        const card = this.flashcardDeck[this.flashcardIndex];
        const fromReverse = this.currentWordsTab === 'reverse';
        const fromLearned = this.currentWordsTab === 'learned';
        const fromSentences = this.currentWordsTab === 'sentences';

        if (fromSentences) {
            // Deleting from sentences: just remove it from the saved sentences
            const idx = this.mySentences.findIndex(w =>
                w.source === card.source && w.translation === card.translation
            );
            if (idx !== -1) {
                this.mySentences.splice(idx, 1);
                this.saveProgress();
            }
        } else if (fromLearned) {
            // Permanently remove from learned list
            const idx = this.learnedWords.findIndex(w =>
                w.source === card.source && w.translation === card.translation &&
                w.langFrom === card.langFrom && w.langTo === card.langTo
            );
            if (idx !== -1) {
                this.learnedWords.splice(idx, 1);
                this.wordsLearned = this.learnedWords.length;
                this.saveProgress();
            }
        } else if (fromReverse) {
            // Deleting from reverse tab: word is fully learned
            const idx = this.reverseWords.findIndex(w =>
                w.source === card.source && w.translation === card.translation &&
                w.langFrom === card.langFrom && w.langTo === card.langTo
            );
            if (idx !== -1) {
                const w = this.reverseWords[idx];
                this.reverseWords.splice(idx, 1);
                // Add to learnedWords with original direction (the word they started with)
                const learned = {
                    source: w.originalSource || w.translation,  // original source
                    translation: w.source,  // original translation (which became the reverse source)
                    allTranslations: [w.source],
                    langFrom: w.langTo,  // flip back to original
                    langTo: w.langFrom,
                    learnedAt: Date.now(),
                };
                const dup = this.learnedWords.some(l =>
                    l.source.toLowerCase() === learned.source.toLowerCase() &&
                    l.langFrom === learned.langFrom && l.langTo === learned.langTo
                );
                if (!dup) {
                    this.learnedWords.push(learned);
                }
                this.wordsLearned = this.learnedWords.length;
                this.saveProgress();
            }
        } else {
            // Deleting from saved: move to reverse list with swapped direction
            const idx = this.savedWords.findIndex(w =>
                w.source === card.source && w.translation === card.translation &&
                w.langFrom === card.langFrom && w.langTo === card.langTo
            );
            if (idx !== -1) {
                const w = this.savedWords[idx];
                // Build the reversed entry
                const reversed = {
                    source: w.translation,
                    translation: w.source,
                    allTranslations: [w.source],
                    langFrom: w.langTo,
                    langTo: w.langFrom,
                    addedAt: Date.now(),
                    originalSource: w.source,
                };
                // Avoid duplicate in reverse list
                const dup = this.reverseWords.some(r =>
                    r.source.toLowerCase() === reversed.source.toLowerCase() &&
                    r.langFrom === reversed.langFrom && r.langTo === reversed.langTo
                );
                this.savedWords.splice(idx, 1);
                if (!dup) {
                    this.reverseWords.push(reversed);
                }
                this.saveProgress();
            }
        }
        // Remove all copies from deck (including re-queued ones)
        this.flashcardDeck = this.flashcardDeck.filter((c, i) =>
            i === this.flashcardIndex || !(c.source === card.source && c.translation === card.translation)
        );
        // Remove the current card too
        this.flashcardDeck.splice(this.flashcardIndex, 1);
        // Update total
        document.getElementById('flashcardTotal').textContent = this.flashcardDeck.length;
        this.renderFlashcard();
    },

    // ===== SPEECH =====
    checkSpeechSupport() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.speechSupported = true;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            this.recognition.maxAlternatives = 3;  // get multiple interpretations
        }
    },

    speak(text, langCode) {
        this.synth.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = langCode || 'en-US';
        utter.rate = 0.85;
        utter.pitch = 1;
        this.synth.speak(utter);
    },

    ttsCodeFor(lang) {
        const ttsMap = { en: 'en-US', es: 'es-ES', it: 'it-IT', fr: 'fr-FR', de: 'de-DE' };
        return ttsMap[lang] || 'en-US';
    },

    // Speak whichever side of the flashcard is currently showing, in its language
    listenFlashcard() {
        const card = this.flashcardCard;
        if (!card) return;
        if (this.flashcardRevealed) {
            this.speak(card.translation, this.ttsCodeFor(card.langTo));
        } else {
            this.speak(card.source, this.ttsCodeFor(card.langFrom));
        }
    },

    // ===== MOVIE / TV PHRASES =====
    movieTargetLang() {
        // Phrases are in the language being learned
        return this.currentLang || 'en';
    },

    movieNativeLang() {
        // Translate into a different language for understanding
        return this.movieTargetLang() === 'en' ? 'it' : 'en';
    },

    openMoviePhrases() {
        const names = { en: 'English', es: 'Spanish', it: 'Italian', fr: 'French', de: 'German' };
        const target = this.movieTargetLang();
        const native = this.movieNativeLang();
        document.getElementById('movieLangNote').innerHTML =
            `Phrases in <strong>${names[target]}</strong> with <strong>${names[native]}</strong> translations.`;
        document.getElementById('moviePhraseInput').value = '';
        if (!this.moviePhrasesData) {
            document.getElementById('movieResults').innerHTML =
                '<div class="dict-empty">Enter a title to discover phrases.</div>';
        }
        this.showScreen('moviePhrases');
        document.getElementById('moviePhraseInput').focus();
    },

    async searchMoviePhrases() {
        const title = document.getElementById('moviePhraseInput').value.trim();
        const results = document.getElementById('movieResults');
        if (!title) return;

        results.innerHTML = `<div class="movie-loading">🎬 Finding phrases from "${this.escapeHtml(title)}"...</div>`;

        try {
            const res = await fetch('/api/movie-phrases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    target_lang: this.movieTargetLang(),
                    native_lang: this.movieNativeLang(),
                }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                results.innerHTML = `<div class="dict-empty">${this.escapeHtml(data.error || 'Something went wrong. Try again.')}</div>`;
                return;
            }
            this.moviePhrasesData = data;
            this.renderMoviePhrases(data);
        } catch (e) {
            results.innerHTML = '<div class="dict-empty">Connection problem. Please try again.</div>';
        }
    },

    renderMoviePhrases(data) {
        const results = document.getElementById('movieResults');
        const target = data.target_lang;
        const native = data.native_lang;
        const ttsCode = this.ttsCodeFor(target);
        const levelMeta = {
            B1: 'Intermediate', B2: 'Upper-Intermediate',
            C1: 'Advanced', C2: 'Proficient',
        };

        let html = `<div class="movie-title-banner">🎬 ${this.escapeHtml(data.title)}</div>`;

        ['B1', 'B2', 'C1', 'C2'].forEach(lvl => {
            const items = data.levels[lvl] || [];
            if (items.length === 0) return;
            html += `
                <div class="movie-level-group">
                    <div class="movie-level-header">
                        <span class="movie-level-badge movie-level-${lvl}">${lvl}</span>
                        <span class="movie-level-name">${levelMeta[lvl] || ''}</span>
                    </div>
                    <div class="movie-phrase-list">
                        ${items.map((it) => `
                            <div class="movie-phrase-item">
                                <button class="movie-phrase-listen" data-text="${this.escapeHtml(it.phrase)}" data-lang="${ttsCode}" title="Listen">🔊</button>
                                <div class="movie-phrase-text">
                                    <div class="movie-phrase-source">${this.escapeHtml(it.phrase)}</div>
                                    <div class="movie-phrase-translation">${this.escapeHtml(it.translation)}</div>
                                    ${it.note ? `<div class="movie-phrase-note">💡 ${this.escapeHtml(it.note)}</div>` : ''}
                                </div>
                                <button class="movie-phrase-add"
                                    data-source="${this.escapeHtml(it.phrase)}"
                                    data-translation="${this.escapeHtml(it.translation)}"
                                    data-from="${target}" data-to="${native}"
                                    title="Add to My Sentences">＋</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });

        results.innerHTML = html;

        results.querySelectorAll('.movie-phrase-listen').forEach(btn => {
            btn.addEventListener('click', () => this.speak(btn.dataset.text, btn.dataset.lang));
        });
        results.querySelectorAll('.movie-phrase-add').forEach(btn => {
            btn.addEventListener('click', () => {
                const added = this.addSentence({
                    source: btn.dataset.source,
                    translation: btn.dataset.translation,
                    langFrom: btn.dataset.from,
                    langTo: btn.dataset.to,
                });
                btn.textContent = added ? '✓' : '✓';
                btn.classList.add('movie-phrase-added');
                btn.disabled = true;
            });
        });
    },

    addSentence(sentence) {
        const dup = this.mySentences.some(s =>
            s.source.toLowerCase() === sentence.source.toLowerCase() &&
            s.langFrom === sentence.langFrom && s.langTo === sentence.langTo
        );
        if (dup) return false;
        this.mySentences.push({
            source: sentence.source,
            translation: sentence.translation,
            allTranslations: [sentence.translation],
            langFrom: sentence.langFrom,
            langTo: sentence.langTo,
            addedAt: Date.now(),
        });
        this.saveProgress();
        return true;
    },

    // ===== DATA LOADING =====
    async fetchLanguages() {
        try {
            const res = await fetch('/api/languages');
            this.languages = await res.json();
            this.renderLanguages();
        } catch (err) {
            console.error('Failed to load languages:', err);
        }
    },

    async loadLanguage(code) {
        try {
            const res = await fetch(`/api/exercises/${code}`);
            if (!res.ok) {
                console.error('Language not found:', code);
                return false;
            }
            this.currentLangData = await res.json();
            this.currentLang = code;
            return true;
        } catch (err) {
            console.error('Failed to load language data:', err);
            return false;
        }
    },

    // ===== RENDERING =====
    renderLanguages() {
        const grid = document.getElementById('languageGrid');
        grid.innerHTML = this.languages.map(lang => `
            <div class="language-card" data-code="${lang.code}">
                <div class="language-flag">${lang.flag}</div>
                <div class="language-name">${lang.language}</div>
            </div>
        `).join('');

        grid.querySelectorAll('.language-card').forEach(card => {
            card.addEventListener('click', async () => {
                const ok = await this.loadLanguage(card.dataset.code);
                if (!ok) return;
                this.showScreen('dashboard');
                this.renderDashboard();
            });
        });
    },

    renderDashboard() {
        document.getElementById('dashboardTitle').textContent = this.currentLangData.language + ' ' + this.currentLangData.flag;

        // XP progress for current level
        const userLevel = Math.floor(this.xp / 100) + 1;
        const xpInLevel = this.xp % 100;
        document.getElementById('xpProgressFill').style.width = `${xpInLevel}%`;
        document.getElementById('xpProgressText').textContent = `${xpInLevel} / 100 XP to Level ${userLevel + 1}`;

        // Saved words count
        const swc = document.getElementById('savedWordsCount');
        if (swc) swc.textContent = this.savedWords.length;

        this.updateTopBar();

        // Skill progress
        const levels = this.currentLangData.levels;
        ['reading', 'writing', 'listening', 'speaking'].forEach(skill => {
            let total = 0, done = 0;
            levels.forEach(level => {
                const exs = level.exercises[skill] || [];
                total += exs.length;
                done += this.getCompletedCount(this.currentLang, level.id, skill);
            });
            const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
            document.getElementById(`${skill}Progress`).style.width = `${pct}%`;
        });

        // Levels
        const levelsList = document.getElementById('levelsList');
        levelsList.innerHTML = levels.map((level, idx) => {
            const totalExercises = ['reading', 'writing', 'listening', 'speaking'].reduce((sum, skill) => {
                return sum + (level.exercises[skill] || []).length;
            }, 0);
            const doneExercises = ['reading', 'writing', 'listening', 'speaking'].reduce((sum, skill) => {
                return sum + this.getCompletedCount(this.currentLang, level.id, skill);
            }, 0);
            const pct = totalExercises > 0 ? Math.round((doneExercises / totalExercises) * 100) : 0;
            const isComplete = pct === 100;
            const isLocked = idx > 0 && this.getLevelCompletion(levels[idx - 1]) < 60;

            return `
                <div class="level-card ${isComplete ? 'completed' : ''} ${isLocked ? 'locked' : ''}"
                     data-level-id="${level.id}" ${isLocked ? '' : ''}>
                    <div class="level-icon">${level.icon || '📚'}</div>
                    <div class="level-info">
                        <div class="level-name">${level.name}</div>
                        <div class="level-desc">${doneExercises}/${totalExercises} exercises · ${pct}%</div>
                    </div>
                    <div class="level-status">${isComplete ? '✅' : isLocked ? '🔒' : '▶️'}</div>
                </div>
            `;
        }).join('');

        levelsList.querySelectorAll('.level-card:not(.locked)').forEach(card => {
            card.addEventListener('click', () => {
                const levelId = parseInt(card.dataset.levelId);
                this.startLevel(levelId);
            });
        });
    },

    getLevelCompletion(level) {
        const total = ['reading', 'writing', 'listening', 'speaking'].reduce((sum, skill) => {
            return sum + (level.exercises[skill] || []).length;
        }, 0);
        const done = ['reading', 'writing', 'listening', 'speaking'].reduce((sum, skill) => {
            return sum + this.getCompletedCount(this.currentLang, level.id, skill);
        }, 0);
        return total > 0 ? (done / total) * 100 : 0;
    },

    updateTopBar() {
        document.getElementById('streakCount').textContent = this.streak;
        document.getElementById('xpCount').textContent = this.xp;
        document.getElementById('heartsCount').textContent = this.hearts;
        document.getElementById('exerciseHearts').textContent = this.hearts;
        const userLevel = Math.floor(this.xp / 100) + 1;
        document.getElementById('userLevel').textContent = userLevel;
    },

    // ===== STARTING EXERCISES =====
    startLevel(levelId) {
        const level = this.currentLangData.levels.find(l => l.id === levelId);
        if (!level) return;
        this.currentLevel = level;

        // Gather all undone exercises across all skills
        let exercises = [];
        ['reading', 'writing', 'listening', 'speaking'].forEach(skill => {
            const skillExercises = level.exercises[skill] || [];
            const done = this.progress[this.getProgressKey(this.currentLang, levelId, skill)] || [];
            skillExercises.forEach(ex => {
                if (!done.includes(ex.id)) {
                    exercises.push({ ...ex, _skill: skill });
                }
            });
        });

        // If all done, let them redo
        if (exercises.length === 0) {
            ['reading', 'writing', 'listening', 'speaking'].forEach(skill => {
                (level.exercises[skill] || []).forEach(ex => {
                    exercises.push({ ...ex, _skill: skill });
                });
            });
        }

        // Shuffle and take up to 10
        exercises = this.shuffle(exercises).slice(0, 10);
        this.startExerciseSession(exercises);
    },

    startSkillPractice(skill) {
        if (!this.currentLangData) return;
        this.currentSkill = skill;

        let exercises = [];
        this.currentLangData.levels.forEach(level => {
            const skillExercises = level.exercises[skill] || [];
            const done = this.progress[this.getProgressKey(this.currentLang, level.id, skill)] || [];
            skillExercises.forEach(ex => {
                exercises.push({ ...ex, _skill: skill, _levelId: level.id, _done: done.includes(ex.id) });
            });
        });

        // Prioritize undone
        const undone = exercises.filter(e => !e._done);
        const pool = undone.length > 0 ? undone : exercises;
        const session = this.shuffle(pool).slice(0, 8);

        // Assign level if not set
        session.forEach(ex => {
            if (!ex._levelId) {
                ex._levelId = this.currentLangData.levels[0].id;
            }
        });

        this.startExerciseSession(session);
    },

    startExerciseSession(exercises) {
        this.exercises = exercises;
        this.exerciseIndex = 0;
        this.sessionCorrect = 0;
        this.sessionTotal = exercises.length;
        this.hearts = Math.max(this.hearts, 3); // Ensure at least 3 hearts
        this.showScreen('exercise');
        this.renderExercise();
    },

    // ===== EXERCISE RENDERING =====
    renderExercise() {
        if (this.exerciseIndex >= this.exercises.length) {
            this.showResults();
            return;
        }

        const ex = this.exercises[this.exerciseIndex];
        this.selectedAnswer = null;
        this.isChecked = false;

        // Progress bar
        const pct = (this.exerciseIndex / this.sessionTotal) * 100;
        document.getElementById('exerciseProgressFill').style.width = `${pct}%`;

        // Reset buttons
        document.getElementById('checkBtn').classList.remove('hidden');
        document.getElementById('checkBtn').disabled = true;
        document.getElementById('continueBtn').classList.add('hidden');
        document.getElementById('feedbackArea').className = 'feedback-area';
        document.getElementById('feedbackArea').innerHTML = '';

        this.updateTopBar();

        const body = document.getElementById('exerciseBody');
        const skill = ex._skill;

        if (skill === 'reading') this.renderReadingExercise(body, ex);
        else if (skill === 'writing') this.renderWritingExercise(body, ex);
        else if (skill === 'listening') this.renderListeningExercise(body, ex);
        else if (skill === 'speaking') this.renderSpeakingExercise(body, ex);
    },

    renderReadingExercise(body, ex) {
        const q = ex.questions[0]; // Use first question
        body.innerHTML = `
            <div class="exercise-type-label">📖 Reading</div>
            <div class="exercise-instruction">Read and answer</div>
            <div class="reading-passage">
                ${ex.text}
                <div class="reading-translation">${ex.translation}</div>
            </div>
            <div class="exercise-instruction" style="font-size:1.1rem">${q.question}</div>
            <div class="options-grid">
                ${q.options.map((opt, i) => `
                    <button class="option-btn" data-index="${i}">${opt}</button>
                `).join('')}
            </div>
        `;

        body.querySelectorAll('.option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.isChecked) return;
                body.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.selectedAnswer = parseInt(btn.dataset.index);
                document.getElementById('checkBtn').disabled = false;
            });
        });
    },

    renderWritingExercise(body, ex) {
        if (ex.type === 'translate') {
            body.innerHTML = `
                <div class="exercise-type-label">✍️ Writing</div>
                <div class="exercise-instruction">${ex.prompt}</div>
                <div class="reading-passage" style="font-size:1.2rem; text-align:center; font-weight:700">
                    ${ex.sentence}
                </div>
                <input type="text" class="text-input" id="answerInput" placeholder="Type your answer..." autocomplete="off" spellcheck="false">
                ${ex.hint ? `<button class="hint-btn" id="hintBtn">💡 Need a hint?</button><div class="hint-text hidden" id="hintText">💡 ${ex.hint}</div>` : ''}
            `;
            if (ex.hint) {
                document.getElementById('hintBtn').addEventListener('click', () => {
                    document.getElementById('hintText').classList.remove('hidden');
                    document.getElementById('hintBtn').classList.add('hidden');
                });
            }
            const input = document.getElementById('answerInput');
            input.addEventListener('input', () => {
                document.getElementById('checkBtn').disabled = input.value.trim() === '';
                this.selectedAnswer = input.value.trim();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && this.selectedAnswer) {
                    if (!this.isChecked) this.checkAnswer();
                    else this.nextExercise();
                }
            });
            input.focus();
        } else if (ex.type === 'fill_blank') {
            body.innerHTML = `
                <div class="exercise-type-label">✍️ Writing</div>
                <div class="exercise-instruction">Fill in the blank</div>
                <div class="fill-sentence">${ex.sentence.replace('___', '<span class="blank-word" id="blankWord">___</span>')}</div>
                <div class="options-grid">
                    ${ex.options.map((opt, i) => `
                        <button class="option-btn" data-value="${opt}">${opt}</button>
                    `).join('')}
                </div>
            `;

            body.querySelectorAll('.option-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (this.isChecked) return;
                    body.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    document.getElementById('blankWord').textContent = btn.dataset.value;
                    this.selectedAnswer = btn.dataset.value;
                    document.getElementById('checkBtn').disabled = false;
                });
            });
        }
    },

    renderListeningExercise(body, ex) {
        const ttsCode = this.currentLangData.tts_code || 'en-US';

        if (ex.type === 'type_heard') {
            body.innerHTML = `
                <div class="exercise-type-label">👂 Listening</div>
                <div class="exercise-instruction">Type what you hear</div>
                <button class="listen-btn" id="listenBtn">🔊</button>
                <button class="listen-btn listen-btn-small" id="listenSlowBtn" title="Listen slowly">🐢</button>
                <input type="text" class="text-input" id="answerInput" placeholder="Type what you hear..." autocomplete="off" spellcheck="false">
            `;

            document.getElementById('listenBtn').addEventListener('click', () => {
                this.speak(ex.text, ttsCode);
            });
            document.getElementById('listenSlowBtn').addEventListener('click', () => {
                this.synth.cancel();
                const utter = new SpeechSynthesisUtterance(ex.text);
                utter.lang = ttsCode;
                utter.rate = 0.55;
                this.synth.speak(utter);
            });

            const input = document.getElementById('answerInput');
            input.addEventListener('input', () => {
                document.getElementById('checkBtn').disabled = input.value.trim() === '';
                this.selectedAnswer = input.value.trim();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && this.selectedAnswer) {
                    if (!this.isChecked) this.checkAnswer();
                    else this.nextExercise();
                }
            });

            // Auto-play
            setTimeout(() => this.speak(ex.text, ttsCode), 400);
            input.focus();

        } else if (ex.type === 'choose_translation') {
            body.innerHTML = `
                <div class="exercise-type-label">👂 Listening</div>
                <div class="exercise-instruction">What does this mean?</div>
                <button class="listen-btn" id="listenBtn">🔊</button>
                <div class="options-grid">
                    ${ex.options.map((opt, i) => `
                        <button class="option-btn" data-index="${i}">${opt}</button>
                    `).join('')}
                </div>
            `;

            document.getElementById('listenBtn').addEventListener('click', () => {
                this.speak(ex.text, ttsCode);
            });

            setTimeout(() => this.speak(ex.text, ttsCode), 400);

            body.querySelectorAll('.option-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (this.isChecked) return;
                    body.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    this.selectedAnswer = parseInt(btn.dataset.index);
                    document.getElementById('checkBtn').disabled = false;
                });
            });
        }
    },

    renderSpeakingExercise(body, ex) {
        const ttsCode = this.currentLangData.tts_code || 'en-US';

        if (!this.speechSupported) {
            body.innerHTML = `
                <div class="exercise-type-label">🗣️ Speaking</div>
                <div class="speech-support-note">⚠️ Speech recognition is not supported in your browser. Try Chrome for the full experience.</div>
                <div class="exercise-instruction">Listen and repeat out loud</div>
                <div class="reading-passage" style="text-align:center; font-size:1.3rem; font-weight:700">${ex.text}</div>
                <div class="hint-text" style="text-align:center">${ex.translation}</div>
                <button class="listen-btn" id="listenBtn">🔊</button>
                <div style="text-align:center; margin-top:16px; color: var(--text-secondary);">
                    Did you say it correctly?
                </div>
                <div class="options-grid" style="margin-top:8px">
                    <button class="option-btn" data-value="yes" style="text-align:center; color: var(--green)">👍 Yes, I said it</button>
                    <button class="option-btn" data-value="no" style="text-align:center; color: var(--red)">👎 Let me try again</button>
                </div>
            `;

            document.getElementById('listenBtn').addEventListener('click', () => {
                this.speak(ex.text, ttsCode);
            });
            setTimeout(() => this.speak(ex.text, ttsCode), 400);

            body.querySelectorAll('.option-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (this.isChecked) return;
                    body.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    this.selectedAnswer = btn.dataset.value;
                    document.getElementById('checkBtn').disabled = false;
                });
            });
            return;
        }

        body.innerHTML = `
            <div class="exercise-type-label">🗣️ Speaking</div>
            <div class="exercise-instruction">Say this out loud:</div>
            <div class="reading-passage" style="text-align:center; font-size:1.3rem; font-weight:700">${ex.text}</div>
            <div class="hint-text" style="text-align:center">${ex.translation}</div>
            <button class="listen-btn" id="listenBtn" style="margin-bottom:8px">🔊</button>
            <button class="speak-btn" id="speakBtn">🎤</button>
            <div class="speech-result" id="speechResult">Tap the microphone and speak</div>
        `;

        document.getElementById('listenBtn').addEventListener('click', () => {
            this.speak(ex.text, ttsCode);
        });
        setTimeout(() => this.speak(ex.text, ttsCode), 400);

        const speakBtn = document.getElementById('speakBtn');
        const resultEl = document.getElementById('speechResult');

        this._isListening = false;
        // Use continuous mode so the user controls when to stop
        this.recognition.continuous = true;
        this.recognition.interimResults = true;

        speakBtn.addEventListener('click', () => {
            if (this.isChecked) return;

            if (this._isListening) {
                // Second click: stop listening
                try { this.recognition.stop(); } catch (e) {}
                this._isListening = false;
                speakBtn.classList.remove('listening');
                speakBtn.textContent = '🎤';
                // onresult / onend will handle the transcript
                return;
            }

            // First click: start listening
            this.synth.cancel();
            this._isListening = true;
            this._currentTranscript = '';
            this.recognition.lang = ttsCode;
            resultEl.innerHTML = '<div class="speech-listening">🎙️ Listening... click the mic again to stop</div>';
            resultEl.className = 'speech-result';
            speakBtn.classList.add('listening');
            speakBtn.textContent = '⏹️';

            try {
                this.recognition.start();
            } catch (e) {
                this._isListening = false;
                speakBtn.classList.remove('listening');
                speakBtn.textContent = '🎤';
            }
        });

        // Accumulate finalized transcripts while listening
        this.recognition.onresult = (event) => {
            let finalText = '';
            let interimText = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const res = event.results[i];
                if (res.isFinal) {
                    finalText += res[0].transcript;
                } else {
                    interimText += res[0].transcript;
                }
            }
            if (finalText) {
                this._currentTranscript = (this._currentTranscript || '') + ' ' + finalText;
            }
            // Show live preview while listening
            if (this._isListening) {
                const preview = ((this._currentTranscript || '') + ' ' + interimText).trim();
                resultEl.innerHTML = `
                    <div class="speech-listening">🎙️ Listening... click ⏹️ to stop</div>
                    ${preview ? `<div class="speech-heard">"${this.escapeHtml(preview)}"</div>` : ''}
                `;
            }
        };

        this.recognition.onend = async () => {
            // When listening stops (user click or auto), evaluate
            const wasListening = this._isListening;
            this._isListening = false;
            speakBtn.classList.remove('listening');
            speakBtn.textContent = '🎤';

            const transcript = (this._currentTranscript || '').trim();
            if (!transcript) {
                resultEl.innerHTML = '<div class="speech-heard">Didn\'t hear anything. Try again.</div>';
                return;
            }

            resultEl.className = 'speech-result';
            resultEl.innerHTML = `
                <div class="speech-heard">You said: "${this.escapeHtml(transcript)}"</div>
                <div class="speech-analyzing">🎧 Analyzing pronunciation...</div>
            `;

            try {
                const res = await fetch('/api/pronunciation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        target: ex.text,
                        transcript: transcript,
                        lang: this.currentLang || 'en',
                    }),
                });
                const data = await res.json();
                this._renderPronunciationResult(resultEl, transcript, ex.text, data);
                this.selectedAnswer = data.score >= 60 ? 'correct' : 'wrong';
            } catch (err) {
                const sim = this._stringSimilarity(
                    transcript.toLowerCase().replace(/[.,!?¿¡;:]/g, ''),
                    ex.text.toLowerCase().replace(/[.,!?¿¡;:]/g, '')
                );
                const score = Math.round(sim * 100);
                this._renderPronunciationResult(resultEl, transcript, ex.text, {
                    score,
                    feedback: score >= 60 ? 'Pretty close!' : 'Try again — listen to the target first.',
                    tip: '', mispronounced: [],
                });
                this.selectedAnswer = score >= 60 ? 'correct' : 'wrong';
            }
            document.getElementById('checkBtn').disabled = false;
        };

        this.recognition.onerror = (event) => {
            this._isListening = false;
            speakBtn.classList.remove('listening');
            speakBtn.textContent = '🎤';
            if (event.error === 'no-speech') {
                resultEl.innerHTML = '<div class="speech-heard">Didn\'t hear anything. Click the mic to try again.</div>';
            } else if (event.error !== 'aborted') {
                resultEl.innerHTML = `<div class="speech-heard">Error: ${event.error}</div>`;
            }
        };

        // Expose helper methods (only if not already set)
        this._renderPronunciationResult = (el, transcript, target, data) => {
            const score = data.score || 0;
            let scoreClass = 'score-bad';
            let scoreEmoji = '😞';
            if (score >= 85) { scoreClass = 'score-great'; scoreEmoji = '🌟'; }
            else if (score >= 70) { scoreClass = 'score-good'; scoreEmoji = '😊'; }
            else if (score >= 50) { scoreClass = 'score-ok'; scoreEmoji = '🙂'; }

            const mispronounced = (data.mispronounced || []).slice(0, 4);
            const misText = mispronounced.length > 0
                ? `<div class="speech-mispronounced"><strong>Work on:</strong> ${mispronounced.map(w => this.escapeHtml(w)).join(', ')}</div>`
                : '';

            const tipText = data.tip
                ? `<div class="speech-tip">💡 ${this.escapeHtml(data.tip)}</div>`
                : '';

            el.className = 'speech-result ' + (score >= 60 ? 'good' : 'bad');
            el.innerHTML = `
                <div class="speech-heard">You said: "${this.escapeHtml(transcript)}"</div>
                <div class="speech-score ${scoreClass}">${scoreEmoji} Score: ${score}/100</div>
                ${data.feedback ? `<div class="speech-feedback">${this.escapeHtml(data.feedback)}</div>` : ''}
                ${misText}
                ${tipText}
            `;
        };

        this._stringSimilarity = (a, b) => {
            if (a === b) return 1;
            if (!a || !b) return 0;
            const longer = a.length >= b.length ? a : b;
            const shorter = a.length >= b.length ? b : a;
            // Levenshtein
            const m = longer.length, n = shorter.length;
            const dp = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));
            for (let i = 0; i <= m; i++) dp[i][0] = i;
            for (let j = 0; j <= n; j++) dp[0][j] = j;
            for (let i = 1; i <= m; i++) {
                for (let j = 1; j <= n; j++) {
                    if (longer[i - 1] === shorter[j - 1]) dp[i][j] = dp[i - 1][j - 1];
                    else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
                }
            }
            return 1 - dp[m][n] / Math.max(m, n);
        };
    },

    // ===== CHECKING ANSWERS =====
    checkAnswer() {
        if (this.isChecked || this.selectedAnswer === null) return;
        this.isChecked = true;

        const ex = this.exercises[this.exerciseIndex];
        const skill = ex._skill;
        let isCorrect = false;

        if (skill === 'reading') {
            isCorrect = this.selectedAnswer === ex.questions[0].correct;
            this.highlightOptions(ex.questions[0].correct);
        } else if (skill === 'writing') {
            if (ex.type === 'translate') {
                isCorrect = this.checkTextAnswer(this.selectedAnswer, ex.acceptable_answers);
                const input = document.getElementById('answerInput');
                input.classList.add(isCorrect ? 'correct' : 'wrong');
            } else if (ex.type === 'fill_blank') {
                isCorrect = this.selectedAnswer.toLowerCase() === ex.answer.toLowerCase();
                this.highlightFillOptions(ex.answer);
            }
        } else if (skill === 'listening') {
            if (ex.type === 'type_heard') {
                isCorrect = this.checkTextAnswer(this.selectedAnswer, ex.acceptable_answers);
                const input = document.getElementById('answerInput');
                input.classList.add(isCorrect ? 'correct' : 'wrong');
            } else if (ex.type === 'choose_translation') {
                isCorrect = this.selectedAnswer === ex.correct;
                this.highlightOptions(ex.correct);
            }
        } else if (skill === 'speaking') {
            if (!this.speechSupported) {
                isCorrect = this.selectedAnswer === 'yes';
            } else {
                isCorrect = this.selectedAnswer === 'correct';
            }
        }

        // Feedback
        const feedbackArea = document.getElementById('feedbackArea');
        if (isCorrect) {
            this.sessionCorrect++;
            feedbackArea.className = 'feedback-area show-correct';
            const encouragements = ['Great job! 🎉', 'Correct! ✨', 'Well done! 💪', 'Perfect! 🌟', 'Excellent! 🔥', 'Nice one! 👏'];
            feedbackArea.innerHTML = encouragements[Math.floor(Math.random() * encouragements.length)];

            // Mark as done
            const levelId = ex._levelId || (this.currentLevel ? this.currentLevel.id : 1);
            this.markExerciseDone(this.currentLang, levelId, skill, ex.id);

            // XP
            this.xp += 10;
        } else {
            feedbackArea.className = 'feedback-area show-wrong';
            let correctAnswer = '';
            if (skill === 'reading') correctAnswer = ex.questions[0].options[ex.questions[0].correct];
            else if (skill === 'writing' && ex.type === 'translate') correctAnswer = ex.acceptable_answers[0];
            else if (skill === 'writing' && ex.type === 'fill_blank') correctAnswer = ex.answer;
            else if (skill === 'listening' && ex.type === 'type_heard') correctAnswer = ex.text;
            else if (skill === 'listening' && ex.type === 'choose_translation') correctAnswer = ex.options[ex.correct];
            else if (skill === 'speaking') correctAnswer = ex.text;

            feedbackArea.innerHTML = `
                Oops, not quite.
                <div class="feedback-correct-answer">Correct answer: ${correctAnswer}</div>
            `;

            this.hearts = Math.max(0, this.hearts - 1);
            document.getElementById('exerciseBody').classList.add('shake');
            setTimeout(() => document.getElementById('exerciseBody').classList.remove('shake'), 400);
        }

        this.updateTopBar();
        document.getElementById('checkBtn').classList.add('hidden');
        document.getElementById('continueBtn').classList.remove('hidden');
        this.saveProgress();
    },

    checkTextAnswer(userAnswer, acceptableAnswers) {
        const normalize = (s) => s.toLowerCase()
            .replace(/[.,!?¿¡;:'"]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const userNorm = normalize(userAnswer);
        return acceptableAnswers.some(a => normalize(a) === userNorm);
    },

    highlightOptions(correctIndex) {
        const body = document.getElementById('exerciseBody');
        body.querySelectorAll('.option-btn').forEach(btn => {
            const idx = parseInt(btn.dataset.index);
            if (idx === correctIndex) btn.classList.add('correct');
            else if (btn.classList.contains('selected')) btn.classList.add('wrong');
        });
    },

    highlightFillOptions(correctAnswer) {
        const body = document.getElementById('exerciseBody');
        body.querySelectorAll('.option-btn').forEach(btn => {
            if (btn.dataset.value.toLowerCase() === correctAnswer.toLowerCase()) btn.classList.add('correct');
            else if (btn.classList.contains('selected')) btn.classList.add('wrong');
        });
    },

    // ===== NAVIGATION =====
    nextExercise() {
        this.exerciseIndex++;
        if (this.exerciseIndex >= this.exercises.length || this.hearts <= 0) {
            this.showResults();
        } else {
            this.renderExercise();
        }
    },

    showResults() {
        const accuracy = this.sessionTotal > 0 ? Math.round((this.sessionCorrect / this.sessionTotal) * 100) : 0;
        const xpEarned = this.sessionCorrect * 10;

        this.recordPractice();

        // Refill hearts over time
        this.hearts = Math.min(5, this.hearts + 2);
        this.saveProgress();

        document.getElementById('resultsIcon').textContent = accuracy >= 80 ? '🎉' : accuracy >= 50 ? '👍' : '💪';
        document.getElementById('resultsTitle').textContent =
            accuracy >= 80 ? 'Lesson Complete!' : accuracy >= 50 ? 'Good Effort!' : 'Keep Practicing!';
        document.getElementById('resultXP').textContent = `+${xpEarned}`;
        document.getElementById('resultAccuracy').textContent = `${accuracy}%`;
        document.getElementById('resultStreak').textContent = this.streak;

        this.updateTopBar();
        this.showScreen('results');

        // Celebration animation
        document.getElementById('resultsIcon').classList.add('pop');
    },

    // ===== CHATBOT =====
    chatHistory: [],

    openChatbot() {
        this.showScreen('chatbot');
        const messages = document.getElementById('chatMessages');
        if (this.chatHistory.length === 0) {
            const langName = this.currentLangData?.language || 'the language';
            this.addChatMessage('bot', `Hi! I can help you learn **${langName}**. Try asking:\n• "How do you say good morning?"\n• "What does *grazie* mean?"\n• "What's the best way in English to say 'sono goloso di dolci'?"`);
        } else {
            messages.innerHTML = '';
            this.chatHistory.forEach(m => this.renderChatMessage(m.role, m.text, m.saveable));
        }
        document.getElementById('chatInput').focus();
    },

    addChatMessage(role, text, saveable) {
        this.chatHistory.push({ role, text, saveable });
        this.renderChatMessage(role, text, saveable);
    },

    renderChatMessage(role, text, saveable) {
        const messages = document.getElementById('chatMessages');
        const div = document.createElement('div');
        div.className = `chat-msg chat-msg-${role}`;
        // Convert markdown-ish: **bold** and _italic_
        let formatted = this.escapeHtml(text)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/_(.+?)_/g, '<em>$1</em>')
            .replace(/^• /gm, '• ');
        div.innerHTML = formatted;

        // Add Save button if this bot message has something saveable
        if (role === 'bot' && saveable && saveable.source && saveable.translation) {
            const saveBtn = document.createElement('button');
            saveBtn.className = 'chat-save-btn';
            saveBtn.textContent = '💾 Save to My Words';
            saveBtn.addEventListener('click', () => {
                this.openSaveModal(saveable, saveBtn);
            });
            div.appendChild(document.createElement('br'));
            div.appendChild(saveBtn);
        }

        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    },

    async sendChatMessage() {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        this.addChatMessage('user', text);

        // Show typing indicator
        const messages = document.getElementById('chatMessages');
        const typing = document.createElement('div');
        typing.className = 'chat-msg chat-msg-bot';
        typing.id = 'chatTyping';
        typing.textContent = '...';
        messages.appendChild(typing);
        messages.scrollTop = messages.scrollHeight;

        try {
            // Send recent history (excluding the just-added user message)
            const recentHistory = this.chatHistory.slice(-10, -1).map(m => ({
                role: m.role,
                text: m.text,
            }));

            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    target_lang: this.currentLang || 'es',
                    // Native language for explanations: Italian when learning English, else English
                    source_lang: (this.currentLang === 'en' ? 'it' : 'en'),
                    history: recentHistory,
                }),
            });
            const data = await res.json();
            document.getElementById('chatTyping')?.remove();
            this.addChatMessage('bot', data.reply || 'Sorry, I had trouble with that.', data.saveable);
        } catch (err) {
            document.getElementById('chatTyping')?.remove();
            this.addChatMessage('bot', 'Connection error. Please try again.');
        }
    },

    // ===== SAVE WORD MODAL =====
    _saveModalBtn: null,

    openSaveModal(saveable, triggerBtn) {
        this._saveModalBtn = triggerBtn || null;
        document.getElementById('saveModalSource').value = saveable.source || '';
        document.getElementById('saveModalTranslation').value = saveable.translation || '';
        document.getElementById('saveModalLangFrom').value = saveable.langFrom || 'en';
        document.getElementById('saveModalLangTo').value = saveable.langTo || this.currentLang || 'es';
        document.getElementById('saveWordModal').classList.remove('hidden');
        document.getElementById('saveModalSource').focus();
    },

    _incompleteMode: false,

    closeSaveModal() {
        document.getElementById('saveWordModal').classList.add('hidden');
        document.querySelector('#saveWordModal .modal-header h2').textContent = '💾 Save to My Words';
        this._saveModalBtn = null;

        // If in incomplete chain, skip to next
        if (this._incompleteMode) {
            this._pendingIncompleteIdx++;
            this._showNextIncomplete();
        }
    },

    confirmSaveModal() {
        const source = document.getElementById('saveModalSource').value.trim();
        const translation = document.getElementById('saveModalTranslation').value.trim();
        const langFrom = document.getElementById('saveModalLangFrom').value;
        const langTo = document.getElementById('saveModalLangTo').value;

        if (!source || !translation) {
            alert('Please fill in both the word and the translation.');
            return;
        }
        if (langFrom === langTo) {
            alert('Please pick two different languages.');
            return;
        }

        const exists = this.savedWords.some(w =>
            w.source.toLowerCase() === source.toLowerCase() &&
            w.langFrom === langFrom && w.langTo === langTo
        );
        if (!exists) {
            this.savedWords.push({
                source,
                translation,
                allTranslations: [translation],
                langFrom,
                langTo,
                addedAt: Date.now(),
            });
            this.saveProgress();
        }

        // Mark the trigger button as saved (for chatbot use)
        if (this._saveModalBtn) {
            this._saveModalBtn.textContent = '✓ Saved';
            this._saveModalBtn.classList.add('saved');
            this._saveModalBtn.disabled = true;
        }

        document.getElementById('saveWordModal').classList.add('hidden');
        document.querySelector('#saveWordModal .modal-header h2').textContent = '💾 Save to My Words';
        this._saveModalBtn = null;

        // If in incomplete chain, go to next
        if (this._incompleteMode) {
            this._pendingIncompleteIdx++;
            if (this._pendingIncompleteIdx >= this._pendingIncomplete.length) {
                this._incompleteMode = false;
                this._pendingIncomplete = [];
                this.renderMyWords();
            } else {
                this._showNextIncomplete();
            }
        } else {
            this.renderMyWords();
        }
    },

    // ===== LESSONS =====
    lessonsData: null,
    placementQuestions: [],
    placementIndex: 0,
    placementCorrect: 0,
    placementSelected: null,
    recommendedLevel: null,

    async openLessons() {
        this.showScreen('lessons');
        if (!this.lessonsData || this.lessonsData._lang !== this.currentLang) {
            try {
                const res = await fetch(`/api/lessons/${this.currentLang}`);
                if (!res.ok) {
                    document.getElementById('lessonsGrid').innerHTML = '<div class="my-words-empty">No lessons available for this language.</div>';
                    return;
                }
                this.lessonsData = await res.json();
                this.lessonsData._lang = this.currentLang;
            } catch (err) {
                console.error(err);
                return;
            }
        }
        this.renderLessons();
    },

    renderLessons() {
        const grid = document.getElementById('lessonsGrid');
        const levels = this.lessonsData?.levels || [];

        // Show recommended level if available
        const savedLevel = localStorage.getItem(`lingualeap_level_${this.currentLang}`);
        if (savedLevel) {
            this.recommendedLevel = parseInt(savedLevel);
            document.getElementById('placementResult').classList.remove('hidden');
            document.getElementById('recommendedLevel').textContent = this.recommendedLevel;
        }

        grid.innerHTML = levels.map(level => {
            const isRec = this.recommendedLevel === level.id;
            return `
                <div class="lesson-card ${isRec ? 'recommended' : ''}" data-level-id="${level.id}">
                    <div class="lesson-card-icon">${level.icon}</div>
                    <div class="lesson-card-info">
                        <div class="lesson-card-level">Level ${level.id}</div>
                        <div class="lesson-card-name">${level.name}</div>
                        <div class="lesson-card-desc">${level.desc}</div>
                    </div>
                    <div class="lesson-card-arrow">›</div>
                </div>
            `;
        }).join('');

        grid.querySelectorAll('.lesson-card').forEach(card => {
            card.addEventListener('click', () => {
                const lid = parseInt(card.dataset.levelId);
                this.openLessonDetail(lid);
            });
        });
    },

    openLessonDetail(levelId) {
        const level = this.lessonsData.levels.find(l => l.id === levelId);
        if (!level) return;

        document.getElementById('lessonDetailTitle').textContent = `${level.icon} Level ${level.id}: ${level.name}`;
        const body = document.getElementById('lessonDetailBody');
        const ttsMap = { en: 'en-US', es: 'es-ES', it: 'it-IT', fr: 'fr-FR', de: 'de-DE' };
        const ttsCode = ttsMap[this.currentLang] || 'en-US';

        let html = `<p style="color: var(--text-secondary); margin-bottom: 20px;">${level.desc}</p>`;

        if (level.vocab && level.vocab.length > 0) {
            html += `
                <div class="lesson-section">
                    <div class="lesson-section-title">📝 Vocabulary (${level.vocab.length} words)</div>
                    <div class="lesson-vocab-grid">
                        ${level.vocab.map(v => `
                            <div class="lesson-vocab-item">
                                <div>
                                    <div class="lesson-vocab-target">${this.escapeHtml(v.target)}</div>
                                    <div class="lesson-vocab-translation">${this.escapeHtml(v.translation)}</div>
                                </div>
                                <button class="lesson-vocab-listen" data-text="${this.escapeHtml(v.target)}">🔊</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        if (level.phrases && level.phrases.length > 0) {
            html += `
                <div class="lesson-section">
                    <div class="lesson-section-title">💬 Useful Phrases</div>
                    ${level.phrases.map(p => `
                        <div class="lesson-phrase-item">
                            <div class="lesson-phrase-target">
                                ${this.escapeHtml(p.target)}
                                <button class="lesson-vocab-listen" data-text="${this.escapeHtml(p.target)}">🔊</button>
                            </div>
                            <div class="lesson-phrase-translation">${this.escapeHtml(p.translation)}</div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        body.innerHTML = html;

        body.querySelectorAll('.lesson-vocab-listen').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.speak(btn.dataset.text, ttsCode);
            });
        });

        this.showScreen('lessonDetail');
    },

    // ===== PLACEMENT TEST =====
    async startPlacement() {
        try {
            const res = await fetch(`/api/placement/${this.currentLang}`);
            const data = await res.json();
            this.placementQuestions = data.questions || [];
            if (this.placementQuestions.length === 0) return;
            this.placementIndex = 0;
            this.placementCorrect = 0;
            this.showScreen('placement');
            this.renderPlacementQuestion();
        } catch (err) {
            console.error(err);
        }
    },

    renderPlacementQuestion() {
        if (this.placementIndex >= this.placementQuestions.length) {
            this.finishPlacement();
            return;
        }

        const q = this.placementQuestions[this.placementIndex];
        this.placementSelected = null;

        document.getElementById('placementCurrent').textContent = this.placementIndex + 1;
        document.getElementById('placementTotal').textContent = this.placementQuestions.length;
        const pct = (this.placementIndex / this.placementQuestions.length) * 100;
        document.getElementById('placementProgressFill').style.width = `${pct}%`;
        document.getElementById('placementNextBtn').disabled = true;

        const body = document.getElementById('placementBody');
        body.innerHTML = `
            <div class="exercise-type-label">📝 Placement Test</div>
            <div class="exercise-instruction">${this.escapeHtml(q.question)}</div>
            <div class="options-grid">
                ${q.options.map((opt, i) => `
                    <button class="option-btn" data-index="${i}">${this.escapeHtml(opt)}</button>
                `).join('')}
            </div>
        `;

        body.querySelectorAll('.option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                body.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.placementSelected = parseInt(btn.dataset.index);
                document.getElementById('placementNextBtn').disabled = false;
            });
        });
    },

    nextPlacement() {
        if (this.placementSelected === null) return;
        const q = this.placementQuestions[this.placementIndex];
        if (this.placementSelected === q.correct) {
            this.placementCorrect++;
        }
        this.placementIndex++;
        this.renderPlacementQuestion();
    },

    finishPlacement() {
        // Determine recommended level (1-10) based on correct answers
        const total = this.placementQuestions.length;
        const score = this.placementCorrect;
        // Map score (0-10) to level (1-10), weight by question level
        let weightedScore = 0;
        this.placementQuestions.forEach((q, i) => {
            if (i < this.placementIndex) {
                // Was the answer correct?
                // Note: we don't store individual answers, so use rough mapping
            }
        });
        // Simple mapping: score / total * 10, min 1
        let level = Math.max(1, Math.min(10, Math.ceil((score / total) * 10)));
        if (score === 0) level = 1;

        this.recommendedLevel = level;
        localStorage.setItem(`lingualeap_level_${this.currentLang}`, String(level));
        this.openLessons();
    },

    // ===== UTILS =====
    shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
};

// Start the app
document.addEventListener('DOMContentLoaded', () => App.init());
