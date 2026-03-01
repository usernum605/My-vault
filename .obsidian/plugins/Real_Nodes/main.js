const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

const DEFAULT_SETTINGS = {
    appendAfterBlock: true,
    autoRunOnChange: false,
};

module.exports = class RealNodesPlugin extends Plugin {
    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: 'append-bases-links-after-block',
            name: 'Bases Linker: Append after block',
            callback: () => this.processCurrentFile(false),
        });

        this.addCommand({
            id: 'append-bases-links-to-end',
            name: 'Bases Linker: Append to end',
            callback: () => this.processCurrentFile(true),
        });

        if (this.settings.autoRunOnChange) {
            this.registerEvent(
                this.app.workspace.on('file-change', (file) => {
                    if (!this.isManualChange && file.extension === 'md') {
                        this.processFile(file);
                    }
                })
            );
        }

        this.addSettingTab(new RealNodesSettingTab(this.app, this));
    }

    onunload() {
        console.log('RealNodesPlugin unloaded');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async processCurrentFile(forceAppendToEnd) {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file');
            return;
        }
        await this.processFile(activeFile, forceAppendToEnd);
    }

    async processFile(file, forceAppendToEnd) {
        console.log(`Processing file: ${file.path}`);
        const content = await this.app.vault.read(file);
        const newContent = await this.transformContent(content, file, forceAppendToEnd ?? !this.settings.appendAfterBlock);
        if (newContent !== content) {
            this.isManualChange = true;
            await this.app.vault.modify(file, newContent);
            this.isManualChange = false;
            new Notice(`Bases links updated in ${file.name}`);
            console.log('File updated successfully');
        } else {
            new Notice('No changes needed');
            console.log('No changes detected');
        }
    }

    async transformContent(content, file, appendToEnd) {
        const baseRegex = /```base\n([\s\S]*?)```/g;
        let match;
        let lastIndex = 0;
        const parts = [];
        let hasChanges = false;
        let allLinks = [];

        console.log('Searching for Base blocks...');
        while ((match = baseRegex.exec(content)) !== null) {
            const fullMatch = match[0];
            const yamlText = match[1].trim();
            const blockStart = match.index;
            const blockEnd = blockStart + fullMatch.length;

            console.log(`Found Base block at index ${blockStart}`);
            parts.push(content.slice(lastIndex, blockStart));
            parts.push(fullMatch);

            const linkedFiles = this.getFilesFromBaseQuery(yamlText, file);
            console.log(`Extracted ${linkedFiles.length} files from Base block`);

            if (linkedFiles.length > 0) {
                const linksText = this.formatLinks(linkedFiles);
                if (!appendToEnd) {
                    parts.push('\n\n' + linksText);
                    hasChanges = true;
                } else {
                    allLinks.push(...linkedFiles);
                    hasChanges = true;
                }
            }

            lastIndex = blockEnd;
        }

        parts.push(content.slice(lastIndex));

        if (appendToEnd && hasChanges && allLinks.length > 0) {
            const uniqueLinks = [...new Set(allLinks)];
            const linksText = this.formatLinks(uniqueLinks);
            parts.push('\n\n' + linksText);
            console.log(`Appended ${uniqueLinks.length} unique links to end`);
        }

        return parts.join('');
    }

    getFilesFromBaseQuery(yamlText, currentFile) {
        try {
            const parsed = this.parseBaseYAML(yamlText);
            console.log('Parsed filters:', JSON.stringify(parsed.filters, null, 2));

            if (!parsed || !parsed.filters) {
                console.log('No filters found');
                return [];
            }

            const filters = parsed.filters;
            const allFiles = this.app.vault.getMarkdownFiles();
            console.log(`Total files in vault: ${allFiles.length}`);

            const matchedFiles = allFiles.filter(file => {
                try {
                    return this.evaluateFilter(file, filters);
                } catch (e) {
                    console.error('Error evaluating filter for file:', file.path, e);
                    return false;
                }
            });

            console.log(`Matched files: ${matchedFiles.length}`);
            return matchedFiles.map(f => f.path);
        } catch (e) {
            console.error('Error in getFilesFromBaseQuery:', e);
            return [];
        }
    }

    // ======================== محلل YAML مخصص لـ Bases مع دعم "not:" كمفتاح ========================
    parseBaseYAML(text) {
        const lines = text.split('\n');
        const root = {};
        const stack = [{ indent: -1, obj: root }];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '' || line.trim().startsWith('#')) continue;

            const indent = line.search(/\S/);
            const trimmed = line.trim();

            // ضبط المكدس حسب المسافة البادئة
            while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
                stack.pop();
            }

            const currentObj = stack[stack.length - 1].obj;

            // عنصر قائمة يبدأ بـ -
            if (trimmed.startsWith('-')) {
                const itemText = trimmed.substring(1).trim();

                // التحقق مما إذا كان هذا العنصر يمثل مفتاحًا (ينتهي بنقطتين)
                if (itemText.endsWith(':')) {
                    // مفتاح لكائن فرعي (مثل "not:")
                    const key = itemText.slice(0, -1).trim(); // إزالة النقطتين
                    if (!currentObj[key]) currentObj[key] = {};
                    // دفع الكائن الجديد إلى المكدس بمسافة بادئة +2 (افتراضي)
                    stack.push({ indent: indent + 2, obj: currentObj[key] });
                } else {
                    // قيمة نصية عادية
                    if (!Array.isArray(currentObj._items)) currentObj._items = [];
                    currentObj._items.push(itemText);
                }
            }
            // مفتاح عادي (ليس ضمن قائمة)
            else if (trimmed.includes(':')) {
                const colonIndex = trimmed.indexOf(':');
                const key = trimmed.substring(0, colonIndex).trim();
                let value = trimmed.substring(colonIndex + 1).trim();

                if (value === '' || value === '|') {
                    // هذا المفتاح سيحتوي على كائن فرعي
                    if (!currentObj[key]) currentObj[key] = {};
                    stack.push({ indent, obj: currentObj[key] });
                } else {
                    // قيمة مباشرة
                    if (value === 'true') value = true;
                    else if (value === 'false') value = false;
                    else if (!isNaN(value) && value !== '') value = Number(value);
                    else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
                    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);

                    currentObj[key] = value;
                }
            }
        }

        // تحويل كل _items إلى مصفوفات حقيقية
        this.convertItems(root);
        return root;
    }

    convertItems(obj) {
        for (let key in obj) {
            if (obj[key] && typeof obj[key] === 'object') {
                if (Array.isArray(obj[key]._items)) {
                    obj[key] = obj[key]._items;
                }
                this.convertItems(obj[key]);
            }
        }
    }
    // ======================== نهاية المحلل ========================

    evaluateFilter(file, filter) {
        if (!filter) return true;

        if (typeof filter === 'string') {
            return this.evaluateStringCondition(file, filter);
        }

        if (Array.isArray(filter)) {
            return filter.every(sub => this.evaluateFilter(file, sub));
        }

        if (filter.and && Array.isArray(filter.and)) {
            return filter.and.every(sub => this.evaluateFilter(file, sub));
        }

        if (filter.or && Array.isArray(filter.or)) {
            return filter.or.some(sub => this.evaluateFilter(file, sub));
        }

        if (filter.not) {
            const notCondition = Array.isArray(filter.not) ? filter.not[0] : filter.not;
            return !this.evaluateFilter(file, notCondition);
        }

        for (let key in filter) {
            if (filter.hasOwnProperty(key)) {
                return this.evaluateSimpleCondition(file, key, filter[key]);
            }
        }

        return false;
    }

    evaluateStringCondition(file, condition) {
        const inFolderMatch = condition.match(/file\.inFolder\(["']([^"']+)["']\)/);
        if (inFolderMatch) {
            const folder = inFolderMatch[1];
            return file.path.startsWith(folder + '/') || file.path === folder;
        }

        const hasTagMatch = condition.match(/file\.hasTag\(["']([^"']+)["']\)/);
        if (hasTagMatch) {
            const tag = hasTagMatch[1];
            const cache = this.app.metadataCache.getFileCache(file);
            const tags = cache?.frontmatter?.tags;
            if (tags) {
                const arr = Array.isArray(tags) ? tags : [tags];
                return arr.includes(tag);
            }
            return false;
        }

        const nameEqMatch = condition.match(/file\.name\s*==\s*["']([^"']+)["']/);
        if (nameEqMatch) return file.basename === nameEqMatch[1];

        const nameContainsMatch = condition.match(/file\.name\.contains\(["']([^"']+)["']\)/);
        if (nameContainsMatch) return file.basename.includes(nameContainsMatch[1]);

        const topicMatch = condition.match(/note\["The Topic"\]\.contains\(["']([^"']+)["']\)/);
        if (topicMatch) {
            const val = topicMatch[1];
            const cache = this.app.metadataCache.getFileCache(file);
            const topic = cache?.frontmatter?.['The Topic'];
            return topic && topic.includes(val);
        }

        return false;
    }

    evaluateSimpleCondition(file, key, value) {
        if (key === 'file.inFolder') {
            return file.path.startsWith(value + '/') || file.path === value;
        }
        if (key === 'file.hasTag') {
            const cache = this.app.metadataCache.getFileCache(file);
            const tags = cache?.frontmatter?.tags;
            if (tags) {
                const arr = Array.isArray(tags) ? tags : [tags];
                return arr.includes(value);
            }
            return false;
        }
        if (key === 'file.name') {
            if (typeof value === 'object' && value.contains) {
                return file.basename.includes(value.contains);
            }
            return file.basename === value;
        }
        if (key === 'note["The Topic"].contains') {
            const cache = this.app.metadataCache.getFileCache(file);
            const topic = cache?.frontmatter?.['The Topic'];
            return topic && topic.includes(value);
        }
        return false;
    }

    formatLinks(filePaths) {
        if (filePaths.length === 0) return '';
        let result = '> [!note]- Bases Links\n';
        filePaths.forEach(path => {
            const fileName = path.split('/').pop().replace('.md', '') || path;
            result += `> [[${path}|${fileName}]]\n`;
        });
        return result;
    }
};

class RealNodesSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Append after block')
            .setDesc('If enabled, links will be appended right after each Base block. Otherwise, they will be appended at the end of the file.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.appendAfterBlock)
                .onChange(async (value) => {
                    this.plugin.settings.appendAfterBlock = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto run on file change')
            .setDesc('Automatically process file when it is changed. Disable if you experience performance issues.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoRunOnChange)
                .onChange(async (value) => {
                    this.plugin.settings.autoRunOnChange = value;
                    await this.plugin.saveSettings();
                }));
    }
}