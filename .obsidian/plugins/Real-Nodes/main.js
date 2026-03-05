const { Plugin, PluginSettingTab, Setting, Notice, TFolder } = require('obsidian');

const DEFAULT_SETTINGS = {
    appendAfterBlock: true,
    autoRunOnChange: false,
    enableBases: true,
    enableDataview: true,
    autoUpdateFiles: [],   // الملفات المحددة للتحديث التلقائي
    autoUpdateAll: false,  // تحديث تلقائي لكل الملفات
};

module.exports = class RealNodesPlugin extends Plugin {
    async onload() {
        await this.loadSettings();

        // أوامر يدوية
        this.addCommand({
            id: 'append-bases-links-after-block',
            name: 'Real Nodes: Append after block',
            callback: () => this.processCurrentFile(false),
        });

        this.addCommand({
            id: 'append-bases-links-to-end',
            name: 'Real Nodes: Append to end',
            callback: () => this.processCurrentFile(true),
        });

        // أمر لإضافة الملف الحالي إلى قائمة التحديث التلقائي
        this.addCommand({
            id: 'add-current-file-to-auto-update',
            name: 'Real Nodes: Add current file to auto update list',
            callback: () => this.addCurrentFileToAutoUpdate(),
        });

        // تفعيل المراقبة التلقائية
        this.setupAutoUpdate();

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

    // ======================== دوال التحديث التلقائي ========================
    setupAutoUpdate() {
        // مراقبة تغييرات الملفات
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (!this.isManualChange && file.extension === 'md') {
                    this.checkAndProcessFile(file);
                }
            })
        );

        // مراقبة إنشاء ملفات جديدة
        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (!this.isManualChange && file.extension === 'md') {
                    this.checkAndProcessFile(file);
                }
            })
        );

        // مراقبة تغيير اسم الملف
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (!this.isManualChange && file.extension === 'md') {
                    this.checkAndProcessFile(file);
                }
            })
        );
    }

    checkAndProcessFile(file) {
        // التحقق مما إذا كان التحديث التلقائي مفعل
        if (!this.settings.autoRunOnChange) return;

        // التحقق من تفعيل التحديث لكل الملفات
        if (this.settings.autoUpdateAll) {
            console.log(`Auto updating all files: ${file.path}`);
            this.processFile(file);
            return;
        }

        // التحقق مما إذا كان الملف في قائمة الملفات المحددة
        if (this.settings.autoUpdateFiles.includes(file.path)) {
            console.log(`Auto updating specific file: ${file.path}`);
            this.processFile(file);
            return;
        }
    }

    async addCurrentFileToAutoUpdate() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file');
            return;
        }

        if (!this.settings.autoUpdateFiles.includes(activeFile.path)) {
            this.settings.autoUpdateFiles.push(activeFile.path);
            await this.saveSettings();
            new Notice(`Added ${activeFile.name} to auto update list`);
        } else {
            new Notice(`${activeFile.name} is already in auto update list`);
        }
    }

    async removeCurrentFileFromAutoUpdate() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file');
            return;
        }

        const index = this.settings.autoUpdateFiles.indexOf(activeFile.path);
        if (index > -1) {
            this.settings.autoUpdateFiles.splice(index, 1);
            await this.saveSettings();
            new Notice(`Removed ${activeFile.name} from auto update list`);
        } else {
            new Notice(`${activeFile.name} is not in auto update list`);
        }
    }

    // ======================== دوال معالجة الملفات ========================
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

        const cleanContent = this.removeExistingLinks(content);

        const newContent = await this.transformContent(cleanContent, file, forceAppendToEnd ?? !this.settings.appendAfterBlock);

        if (newContent !== cleanContent) {
            this.isManualChange = true;
            await this.app.vault.modify(file, newContent);
            this.isManualChange = false;
            new Notice(`Real Nodes updated in ${file.name}`);
            console.log('File updated successfully');
        } else {
            console.log('No changes detected');
        }
    }

    removeExistingLinks(content) {
        const linkBlockRegex = /> \[!link\]- Real Links.*\n(> .*\n)*/g;
        return content.replace(linkBlockRegex, '');
    }

    async transformContent(content, file, appendToEnd) {
        const baseRegex = /```base\n([\s\S]*?)```/g;
        const dataviewRegex = /```dataview\n([\s\S]*?)```/g;

        let match;
        let lastIndex = 0;
        const parts = [];
        let hasChanges = false;
        let allLinks = [];

        console.log('Searching for query blocks...');

        if (this.settings.enableBases) {
            while ((match = baseRegex.exec(content)) !== null) {
                const fullMatch = match[0];
                const queryText = match[1].trim();
                const blockStart = match.index;
                const blockEnd = blockStart + fullMatch.length;

                console.log(`Found Base block at index ${blockStart}`);
                parts.push(content.slice(lastIndex, blockStart));
                parts.push(fullMatch);

                const linkedFiles = this.getFilesFromBaseQuery(queryText, file);
                console.log(`Extracted ${linkedFiles.length} files from Base block`);

                if (linkedFiles.length > 0) {
                    const linksText = this.formatLinks(linkedFiles, 'Base');
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
        }

        if (this.settings.enableDataview) {
            dataviewRegex.lastIndex = lastIndex;

            while ((match = dataviewRegex.exec(content)) !== null) {
                const fullMatch = match[0];
                const queryText = match[1].trim();
                const blockStart = match.index;
                const blockEnd = blockStart + fullMatch.length;

                console.log(`Found Dataview block at index ${blockStart}`);

                parts.push(content.slice(lastIndex, blockStart));
                parts.push(fullMatch);

                const linkedFiles = await this.getFilesFromDataviewQuery(queryText, file);
                console.log(`Extracted ${linkedFiles.length} files from Dataview block`);

                if (linkedFiles.length > 0) {
                    const linksText = this.formatLinks(linkedFiles, 'Dataview');
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
        }

        parts.push(content.slice(lastIndex));

        if (appendToEnd && hasChanges && allLinks.length > 0) {
            const uniqueLinks = [...new Set(allLinks)];
            const linksText = this.formatLinks(uniqueLinks, 'Combined');
            parts.push('\n\n' + linksText);
            console.log(`Appended ${uniqueLinks.length} unique links to end`);
        }

        return parts.join('');
    }

    // ======================== دوال Bases ========================
    getFilesFromBaseQuery(yamlText, currentFile) {
        try {
            const conditions = this.parseBaseConditions(yamlText);
            console.log('Parsed conditions:', JSON.stringify(conditions, null, 2));

            const allFiles = this.app.vault.getMarkdownFiles();
            console.log(`Total files in vault: ${allFiles.length}`);

            const matchedFiles = allFiles.filter(file => {
                return this.evaluateBaseConditions(file, conditions);
            });

            console.log(`Matched files: ${matchedFiles.length}`);
            return matchedFiles.map(f => f.path);
        } catch (e) {
            console.error('Error in getFilesFromBaseQuery:', e);
            return [];
        }
    }

    parseBaseConditions(yamlText) {
        const conditions = {
            or: []
        };

        const lines = yamlText.split('\n');
        let i = 0;

        while (i < lines.length && !lines[i].trim().startsWith('filters:')) i++;
        i++;

        while (i < lines.length && !lines[i].trim().startsWith('or:')) i++;
        i++;

        let currentAnd = null;

        while (i < lines.length) {
            const line = lines[i].trim();
            const fullLine = lines[i];
            const indent = fullLine.search(/\S/);

            if (line.startsWith('views:')) break;

            if (line.startsWith('-')) {
                const item = line.substring(1).trim();

                if (item === 'and:') {
                    currentAnd = { and: [] };
                    conditions.or.push(currentAnd);
                }
                else if (currentAnd && indent > 4) {
                    currentAnd.and.push(item);
                }
                else {
                    conditions.or.push(item);
                    currentAnd = null;
                }
            }

            i++;
        }

        return conditions;
    }

    evaluateBaseConditions(file, conditions) {
        if (!conditions || !conditions.or) return false;

        return conditions.or.some(condition => {
            if (typeof condition === 'string') {
                return this.evaluateBaseCondition(file, condition);
            }
            else if (condition.and && Array.isArray(condition.and)) {
                return condition.and.every(subCond => 
                    this.evaluateBaseCondition(file, subCond)
                );
            }
            return false;
        });
    }

    evaluateBaseCondition(file, condition) {
        const folderEqMatch = condition.match(/file\.folder\s*==\s*["']([^"']+)["']/);
        if (folderEqMatch) {
            const targetFolder = folderEqMatch[1];
            const fileFolder = file.path.includes('/') ? 
                file.path.substring(0, file.path.lastIndexOf('/')) : '';
            return fileFolder === targetFolder;
        }

        const folderNeMatch = condition.match(/file\.folder\s*!=\s*["']([^"']+)["']/);
        if (folderNeMatch) {
            const targetFolder = folderNeMatch[1];
            const fileFolder = file.path.includes('/') ? 
                file.path.substring(0, file.path.lastIndexOf('/')) : '';
            return fileFolder !== targetFolder;
        }

        const nameNeMatch = condition.match(/file\.name\s*!=\s*["']([^"']+)["']/);
        if (nameNeMatch) {
            const forbiddenName = nameNeMatch[1];
            return file.basename !== forbiddenName;
        }

        const hasPropMatch = condition.match(/file\.hasProperty\(["']([^"']+)["']\)/);
        if (hasPropMatch) {
            const prop = hasPropMatch[1];
            const cache = this.app.metadataCache.getFileCache(file);
            return cache?.frontmatter?.hasOwnProperty(prop) || false;
        }

        if (condition.includes('!file.name.contains("Tem")')) {
            return !file.basename.includes('Tem') && !file.basename.includes('tem') && !file.basename.includes('TEM');
        }

        const nameContainsMatch = condition.match(/file\.name\.contains\(["']([^"']+)["']\)/);
        if (nameContainsMatch) {
            const text = nameContainsMatch[1];
            return file.basename.includes(text);
        }

        const nameNotContainsMatch = condition.match(/!file\.name\.contains\(["']([^"']+)["']\)/);
        if (nameNotContainsMatch) {
            const text = nameNotContainsMatch[1];
            return !file.basename.includes(text);
        }

        return false;
    }

    // ======================== دوال Dataview ========================
    async getFilesFromDataviewQuery(queryText, currentFile) {
        try {
            const dataview = this.app.plugins.getPlugin('dataview');
            if (!dataview) {
                console.log('Dataview plugin not found');
                return [];
            }

            console.log('Executing Dataview query:', queryText);

            const result = await dataview.api.query(queryText);

            if (!result.successful) {
                console.log('Dataview query failed:', result.error);
                return [];
            }

            const files = [];

            if (result.value.type === 'table' && result.value.headers) {
                if (result.value.headers[0] === 'File') {
                    result.value.values.forEach(row => {
                        if (row[0] && row[0].path) {
                            files.push(row[0].path);
                        }
                    });
                }
            } else if (result.value.type === 'list') {
                result.value.values.forEach(item => {
                    if (item && item.path) {
                        files.push(item.path);
                    }
                });
            }

            return [...new Set(files)];
        } catch (e) {
            console.error('Error executing Dataview query:', e);
            return [];
        }
    }

    formatLinks(filePaths, source = '') {
        if (filePaths.length === 0) return '';
        const sourceText = source ? ` (${source})` : '';
        let result = `> [!link]- Real Links${sourceText}\n`;

        const sortedPaths = [...filePaths].sort();

        sortedPaths.forEach(path => {
            const fileName = path.split('/').pop().replace('.md', '') || path;
            result += `> - [[${fileName}]]\n`;
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

        // الإعدادات الأساسية
        containerEl.createEl('h2', { text: 'General Settings' });

        new Setting(containerEl)
            .setName('Append after block')
            .setDesc('If enabled, links will be appended right after each block. Otherwise, they will be appended at the end of the file.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.appendAfterBlock)
                .onChange(async (value) => {
                    this.plugin.settings.appendAfterBlock = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable Bases support')
            .setDesc('Process ```base blocks')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableBases)
                .onChange(async (value) => {
                    this.plugin.settings.enableBases = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable Dataview support')
            .setDesc('Process ```dataview blocks')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDataview)
                .onChange(async (value) => {
                    this.plugin.settings.enableDataview = value;
                    await this.plugin.saveSettings();
                }));

        // إعدادات التحديث التلقائي
        containerEl.createEl('h2', { text: 'Auto Update Settings' });

        new Setting(containerEl)
            .setName('Enable auto update')
            .setDesc('Turn on automatic updates for selected files')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoRunOnChange)
                .onChange(async (value) => {
                    this.plugin.settings.autoRunOnChange = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto update all files')
            .setDesc('⚠️ Warning: This will auto update EVERY markdown file in your vault')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoUpdateAll)
                .onChange(async (value) => {
                    this.plugin.settings.autoUpdateAll = value;
                    await this.plugin.saveSettings();
                }));

        // قائمة الملفات المحددة
        containerEl.createEl('h3', { text: 'Selected Files for Auto Update' });

        if (this.plugin.settings.autoUpdateFiles.length === 0) {
            containerEl.createEl('p', { 
                text: 'No files selected. Use commands to add files:',
                cls: 'setting-item-description'
            });
            containerEl.createEl('ul', { cls: 'setting-item-description' }).innerHTML = `
                <li>「Real Nodes: Add current file to auto update list」</li>
                <li>「Real Nodes: Remove current file from auto update list」</li>
            `;
        } else {
            const fileList = containerEl.createEl('div', { cls: 'setting-item' });
            this.plugin.settings.autoUpdateFiles.forEach(filePath => {
                const fileSetting = new Setting(fileList)
                    .setName(filePath.split('/').pop())
                    .setDesc(filePath);

                fileSetting.addButton(btn => btn
                    .setButtonText('Remove')
                    .onClick(async () => {
                        const index = this.plugin.settings.autoUpdateFiles.indexOf(filePath);
                        if (index > -1) {
                            this.plugin.settings.autoUpdateFiles.splice(index, 1);
                            await this.plugin.saveSettings();
                            this.display();
                        }
                    }));
            });
        }
    }
}