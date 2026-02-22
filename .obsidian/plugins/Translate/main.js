const { Plugin, PluginSettingTab, Setting } = require('obsidian');

// Default settings
const DEFAULT_SETTINGS = {
    doNotTranslate: [],
    manualTranslations: []
};

module.exports = class AutoTranslatePlugin extends Plugin {
    async onload() {
        await this.loadSettings();

        // Load persistent translation cache
        this.cache = (await this.loadData()) || {};
        this.pendingTranslations = new Map();

        // Core state
        this.currentView = null;
        this.currentFile = null;
        this.observer = null;
        this.mutationObserver = null;
        this.translationCache = new WeakMap(); // element -> final text (after rules)
        this.visibleElements = new Set();
        this.translationQueue = [];
        this.processing = false;

        this.targetSelectors = 'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote';

        // Debounced cache save
        this.saveCacheDebounced = this.debounce(() => {
            this.saveData(this.cache);
        }, 2000);

        // Register events
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
            this.reinitialize();
        }));
        this.registerEvent(this.app.workspace.on('layout-change', () => {
            this.reinitialize();
        }));
        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            if (this.currentFile && file.path === this.currentFile.path) {
                this.reinitialize();
            }
        }));

        // Add settings tab
        this.addSettingTab(new AutoTranslateSettingTab(this.app, this));

        this.reinitialize();
    }

    onunload() {
        this.saveData(this.cache);
        this.cleanup();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    cleanup() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
        this.translationCache = new WeakMap();
        this.visibleElements.clear();
        this.translationQueue = [];
        this.processing = false;
        this.currentView = null;
        this.currentFile = null;
    }

    shouldTranslate(file) {
        if (!file) return false;
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!frontmatter) return false;
        const val = frontmatter.translate;
        return val === true || val === 'true';
    }

    async reinitialize() {
        this.cleanup();

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || !this.shouldTranslate(activeFile)) {
            return;
        }
        this.currentFile = activeFile;

        const activeView = this.app.workspace.getActiveViewOfType(require('obsidian').MarkdownView);
        if (!activeView || activeView.getMode() !== 'preview') return;

        this.currentView = activeView;
        const previewEl = activeView.contentEl.querySelector('.markdown-reading-view, .markdown-preview-view');
        if (!previewEl) return;

        this.observer = new IntersectionObserver(
            (entries) => this.handleIntersection(entries),
            { threshold: 0.1 }
        );

        this.mutationObserver = new MutationObserver((mutations) => {
            let shouldReObserve = false;
            for (const mut of mutations) {
                if (mut.type === 'childList') {
                    shouldReObserve = true;
                } else if (mut.type === 'characterData') {
                    const element = mut.target.parentElement;
                    if (element && element.matches(this.targetSelectors)) {
                        if (element.dataset.original !== undefined) {
                            element.dataset.original = element.innerText;
                            this.translationCache.delete(element);
                        }
                    }
                }
            }
            if (shouldReObserve) {
                this.observeTargets(previewEl);
            }
        });

        this.mutationObserver.observe(previewEl, { childList: true, subtree: true, characterData: true });
        this.observeTargets(previewEl);
    }

    observeTargets(container) {
        const elements = container.querySelectorAll(this.targetSelectors);
        for (const el of elements) {
            if (!el.dataset.original) {
                el.dataset.original = el.innerText;
            }
            this.observer.observe(el);
        }
    }

    handleIntersection(entries) {
        for (const entry of entries) {
            const el = entry.target;
            if (entry.isIntersecting) {
                this.visibleElements.add(el);
                this.queueTranslation(el);
            } else {
                this.visibleElements.delete(el);
                this.restoreOriginal(el);
            }
        }
    }

    queueTranslation(el) {
        if (this.translationCache.has(el)) {
            this.applyTranslation(el, this.translationCache.get(el));
            return;
        }
        if (!this.translationQueue.includes(el)) {
            this.translationQueue.push(el);
        }
        this.processQueue();
    }

    async processQueue() {
        if (this.processing || this.translationQueue.length === 0) return;
        this.processing = true;

        const el = this.translationQueue.shift();
        if (!this.visibleElements.has(el)) {
            this.processing = false;
            this.processQueue();
            return;
        }

        const original = el.dataset.original;
        if (!original) {
            this.processing = false;
            this.processQueue();
            return;
        }

        try {
            // Apply user rules and get final text
            const finalText = await this.applyRulesAndTranslate(original);
            this.translationCache.set(el, finalText);
            if (this.visibleElements.has(el)) {
                this.applyTranslation(el, finalText);
            }
        } catch (err) {
            console.error('Translation failed:', err);
        } finally {
            this.processing = false;
            setTimeout(() => this.processQueue(), 300);
        }
    }

    // Apply do-not-translate and manual translation rules using placeholders
    async applyRulesAndTranslate(originalText) {
        // Prepare lists: sort by length descending to avoid partial overlaps
        const dntTerms = [...this.settings.doNotTranslate].sort((a, b) => b.length - a.length);
        const mtPairs = [...this.settings.manualTranslations].sort((a, b) => b.from.length - a.from.length);

        // Build placeholder map
        const placeholders = new Map(); // placeholder -> { type, original, replacement }
        let placeholderCounter = 0;

        // Function to generate unique placeholder
        function getPlaceholder() {
            return `__OBSD_TR_${placeholderCounter++}__`;
        }

        // Start with original text
        let textWithPlaceholders = originalText;

        // First, replace MT terms (manual translations)
        for (const { from, to } of mtPairs) {
            // Create a regex that matches the whole word/phrase (case-sensitive? could be configurable, but we'll use exact match with word boundaries)
            // Using word boundaries might not work for phrases with spaces, so we'll use simple string replace with a regex that escapes special chars.
            const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escaped, 'g');
            textWithPlaceholders = textWithPlaceholders.replace(regex, (match) => {
                const placeholder = getPlaceholder();
                placeholders.set(placeholder, { type: 'mt', original: match, replacement: to });
                return placeholder;
            });
        }

        // Then replace DNT terms (do not translate) – these should not be translated, so they will be restored as original
        for (const term of dntTerms) {
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escaped, 'g');
            textWithPlaceholders = textWithPlaceholders.replace(regex, (match) => {
                const placeholder = getPlaceholder();
                placeholders.set(placeholder, { type: 'dnt', original: match, replacement: match }); // replacement is same as original
                return placeholder;
            });
        }

        // Now translate the text with placeholders (Google will treat them as opaque tokens)
        const translatedWithPlaceholders = await this.getTranslation(textWithPlaceholders);

        // Replace placeholders back
        let finalText = translatedWithPlaceholders;
        for (const [placeholder, info] of placeholders) {
            finalText = finalText.replace(new RegExp(placeholder, 'g'), info.replacement);
        }

        return finalText;
    }

    async getTranslation(text) {
        if (this.cache[text]) {
            return this.cache[text];
        }
        if (this.pendingTranslations.has(text)) {
            return this.pendingTranslations.get(text);
        }

        const promise = this.translateText(text).then(translated => {
            this.cache[text] = translated;
            this.saveCacheDebounced();
            this.pendingTranslations.delete(text);
            return translated;
        }).catch(err => {
            this.pendingTranslations.delete(text);
            throw err;
        });

        this.pendingTranslations.set(text, promise);
        return promise;
    }

    applyTranslation(el, translatedText) {
        el.innerText = translatedText;
        el.setAttribute('dir', 'rtl');
    }

    restoreOriginal(el) {
        if (el.dataset.original) {
            el.innerText = el.dataset.original;
        }
        el.removeAttribute('dir');
    }

    async translateText(text, targetLang = 'ar') {
        const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' 
            + targetLang + '&dt=t&q=' + encodeURIComponent(text);

        const response = await fetch(url);
        const data = await response.json();
        return data[0].map(item => item[0]).join('');
    }
};

// Settings tab
class AutoTranslateSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Auto Translate Settings' });

        // Do Not Translate section
        containerEl.createEl('h3', { text: 'Do Not Translate' });
        containerEl.createEl('p', { text: 'Words or phrases that should remain in English (case‑sensitive).' });

        const dntContainer = containerEl.createDiv();
        this.renderDntList(dntContainer);

        // Add new DNT term
        const addDntDiv = containerEl.createDiv({ cls: 'setting-item' });
        new Setting(addDntDiv)
            .setName('Add new term')
            .setDesc('Enter a word or phrase to preserve in English')
            .addText(text => text.setPlaceholder('e.g., Obsidian').onChange(async (value) => {
                if (value && !this.plugin.settings.doNotTranslate.includes(value)) {
                    this.plugin.settings.doNotTranslate.push(value);
                    await this.plugin.saveSettings();
                    this.display(); // refresh
                }
            }));

        // Manual Translations section
        containerEl.createEl('h3', { text: 'Manual Translations' });
        containerEl.createEl('p', { text: 'Override automatic translation for specific words/phrases.' });

        const mtContainer = containerEl.createDiv();
        this.renderMtList(mtContainer);

        // Add new MT pair
        const addMtDiv = containerEl.createDiv({ cls: 'setting-item' });
        let fromInput, toInput;
        new Setting(addMtDiv)
            .setName('Add new translation')
            .setDesc('Source phrase and desired Arabic translation')
            .addText(text => text.setPlaceholder('English').onChange(v => fromInput = v))
            .addText(text => text.setPlaceholder('العربية').onChange(v => toInput = v))
            .addButton(btn => btn.setButtonText('Add').onClick(async () => {
                if (fromInput && toInput) {
                    this.plugin.settings.manualTranslations.push({ from: fromInput, to: toInput });
                    await this.plugin.saveSettings();
                    this.display();
                }
            }));
    }

    renderDntList(container) {
        const list = container.createEl('ul');
        for (const term of this.plugin.settings.doNotTranslate) {
            const item = list.createEl('li', { text: term });
            item.style.marginBottom = '5px';
            new Setting(item)
                .setClass('mod-no-header')
                .addButton(btn => btn.setIcon('trash').setTooltip('Remove').onClick(async () => {
                    const idx = this.plugin.settings.doNotTranslate.indexOf(term);
                    if (idx !== -1) {
                        this.plugin.settings.doNotTranslate.splice(idx, 1);
                        await this.plugin.saveSettings();
                        this.display();
                    }
                }));
        }
    }

    renderMtList(container) {
        const list = container.createEl('ul');
        for (const pair of this.plugin.settings.manualTranslations) {
            const item = list.createEl('li', { text: `${pair.from} → ${pair.to}` });
            item.style.marginBottom = '5px';
            new Setting(item)
                .setClass('mod-no-header')
                .addButton(btn => btn.setIcon('pencil').setTooltip('Edit').onClick(async () => {
                    // Simple edit: prompt for new values
                    const newFrom = await this.prompt('Edit English phrase', pair.from);
                    if (newFrom === null) return;
                    const newTo = await this.prompt('Edit Arabic translation', pair.to);
                    if (newTo === null) return;
                    pair.from = newFrom;
                    pair.to = newTo;
                    await this.plugin.saveSettings();
                    this.display();
                }))
                .addButton(btn => btn.setIcon('trash').setTooltip('Remove').onClick(async () => {
                    const idx = this.plugin.settings.manualTranslations.indexOf(pair);
                    if (idx !== -1) {
                        this.plugin.settings.manualTranslations.splice(idx, 1);
                        await this.plugin.saveSettings();
                        this.display();
                    }
                }));
        }
    }

    async prompt(question, defaultValue = '') {
        // Simple modal prompt using Obsidian API
        const { Modal, App, Setting } = require('obsidian');
        return new Promise((resolve) => {
            const modal = new Modal(this.app);
            let inputValue = defaultValue;
            modal.titleEl.setText(question);
            new Setting(modal.contentEl)
                .addText(text => text.setValue(defaultValue).onChange(v => inputValue = v))
                .addButton(btn => btn.setButtonText('OK').onClick(() => {
                    modal.close();
                    resolve(inputValue);
                }))
                .addButton(btn => btn.setButtonText('Cancel').onClick(() => {
                    modal.close();
                    resolve(null);
                }));
            modal.open();
        });
    }
}