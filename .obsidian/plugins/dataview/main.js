const { Plugin, PluginSettingTab, Setting, Notice } = require("obsidian");

const DEFAULT_SETTINGS = {
	fwdMultiplier: 1,
	bwdMultiplier: 1,
	lettersPerWt: 0,
	manualMultiplier: 1,
	manualOverride: false,
	autoUpdateLinks: true // تفعيل التحديث التلقائي
};

class SimpleFolderLinksPlugin extends Plugin {

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		
		// كاش للمجلدات لتجنب القراءة المتكررة
		this.folderCache = new Map();
		
		// إضافة تبويب الإعدادات
		this.addSettingTab(new SimpleSettingTab(this.app, this));

		// مراقبة التغييرات في الملاحظات
		this.registerEvent(
			this.app.metadataCache.on("changed", async (file) => {
				if (file.extension === "md" && this.settings.autoUpdateLinks) {
					await this.updateFolderLinksInFile(file);
				}
			})
		);

		// مراقبة إعادة تسمية/نقل الملفات
		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				if (file.extension === "md") {
					this.folderCache.clear(); // مسح الكاش
					if (this.settings.autoUpdateLinks) {
						await this.updateAllFolderLinks();
					}
				}
			})
		);

		// تحديث أولي بعد تحميل كل شيء
		this.app.workspace.onLayoutReady(async () => {
			if (this.settings.autoUpdateLinks) {
				await this.updateAllFolderLinks();
			}
		});

		// أمر يدوي لتحديث كل الروابط
		this.addCommand({
			id: 'update-all-folder-links',
			name: 'تحديث كل روابط المجلدات',
			callback: async () => {
				await this.updateAllFolderLinks();
				new Notice('تم تحديث روابط المجلدات بنجاح');
			}
		});

		// أمر لحذف كل الروابط المضافة
		this.addCommand({
			id: 'remove-all-folder-links',
			name: 'إزالة كل روابط المجلدات',
			callback: async () => {
				await this.removeAllFolderLinks();
				new Notice('تم إزالة روابط المجلدات');
			}
		});
	}

	// =============================
	// إدارة الروابط في الملاحظات
	// =============================

	async updateAllFolderLinks() {
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			await this.updateFolderLinksInFile(file);
		}
	}

	async updateFolderLinksInFile(file) {
		try {
			// قراءة محتوى الملف
			let content = await this.app.vault.read(file);
			
			// البحث عن frontmatter
			const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
			if (!frontmatterMatch) return;

			const frontmatter = frontmatterMatch[1];
			
			// البحث عن خاصية "links pages" أو "path"
			const linksPagesMatch = frontmatter.match(/links pages:\s*\[([\s\S]*?)\]/);
			if (!linksPagesMatch) return;

			// استخراج مسارات المجلدات
			const linksPagesStr = linksPagesMatch[1];
			const folderPaths = this.extractFolderPaths(linksPagesStr);
			
			if (folderPaths.length === 0) return;

			// الحصول على كل ملفات المجلدات
			const targetFiles = await this.getAllFilesInFolders(folderPaths);
			
			// إنشاء نص الروابط الجديد
			const newLinksSection = this.createLinksSection(targetFiles, file.path);
			
			// البحث عن قسم الروابط الموجود أو إنشاء جديد
			await this.updateFileContent(file, content, newLinksSection);
			
		} catch (error) {
			console.error(`خطأ في تحديث ملف ${file.path}:`, error);
		}
	}

	extractFolderPaths(linksPagesStr) {
		const paths = [];
		
		// البحث عن pattern: {path: "folder"} أو path: "folder"
		const pathMatches = linksPagesStr.matchAll(/\{?\s*path\s*:\s*["']([^"']+)["']\s*\}?/gi);
		
		for (const match of pathMatches) {
			if (match[1]) {
				paths.push(match[1].trim());
			}
		}
		
		return paths;
	}

	async getAllFilesInFolders(folderPaths) {
		const allFiles = new Set();
		
		for (const folderPath of folderPaths) {
			// استخدام الكاش إن وجد
			if (this.folderCache.has(folderPath)) {
				const cached = this.folderCache.get(folderPath);
				cached.forEach(f => allFiles.add(f));
				continue;
			}
			
			// البحث عن المجلد
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder?.children) continue;
			
			const files = [];
			
			// دالة تكرارية لجمع كل الملفات
			const collectFiles = (items) => {
				for (const item of items) {
					if (item.children) {
						collectFiles(item.children);
					} else if (item.extension === "md" && item.path) {
						files.push(item.path);
						allFiles.add(item.path);
					}
				}
			};
			
			collectFiles(folder.children);
			this.folderCache.set(folderPath, files);
		}
		
		return Array.from(allFiles);
	}

	createLinksSection(targetFiles, sourcePath) {
		if (targetFiles.length === 0) return '';
		
		// تجنب ربط الملاحظة بنفسها
		const filteredFiles = targetFiles.filter(f => f !== sourcePath);
		
		// ترتيب الملفات أبجدياً
		filteredFiles.sort();
		
		// إنشاء نص الروابط
		let linksSection = '\n\n###### روابط المجلد:\n';
		
		for (const filePath of filteredFiles) {
			// استخراج اسم الملف بدون مسار
			const fileName = filePath.split('/').pop().replace('.md', '');
			linksSection += `- [[${fileName}]] \n`;
		}
		
		return linksSection;
	}

	async updateFileContent(file, currentContent, newLinksSection) {
		// البحث عن قسم الروابط الموجود
		const linksSectionRegex = /\n\n###### روابط المجلد:[\s\S]*?(?=\n\n##|\n---|$)/;
		
		let newContent;
		
		if (linksSectionRegex.test(currentContent)) {
			// استبدال القسم الموجود
			newContent = currentContent.replace(linksSectionRegex, newLinksSection || '');
		} else if (newLinksSection) {
			// إضافة القسم في نهاية الملف
			newContent = currentContent + newLinksSection;
		} else {
			return; // لا تغيير
		}
		
		// كتابة المحتوى الجديد فقط إذا تغير
		if (newContent !== currentContent) {
			await this.app.vault.modify(file, newContent);
		}
	}

	async removeAllFolderLinks() {
		const files = this.app.vault.getMarkdownFiles();
		
		for (const file of files) {
			try {
				let content = await this.app.vault.read(file);
				const linksSectionRegex = /\n\n###### روابط المجلد:[\s\S]*?(?=\n\n##|\n---|$)/;
				
				if (linksSectionRegex.test(content)) {
					const newContent = content.replace(linksSectionRegex, '');
					await this.app.vault.modify(file, newContent);
				}
			} catch (error) {
				console.error(`خطأ في إزالة روابط ملف ${file.path}:`, error);
			}
		}
		
		this.folderCache.clear();
	}

	// =============================
	// حساب الأوزان للرسم البياني
	// =============================

	initializeGraph() {
		const leaf = this.app.workspace.getLeavesOfType("graph").first();
		if (!leaf) return;

		const renderer = leaf.view.renderer;
		if (!renderer?.nodes) return;

		this.updateWeights(renderer.nodes);
	}

	updateWeights(nodes) {
		nodes.forEach(node => {
			node.weight = this.calculateWeight(node);
		});
	}

	calculateWeight(node) {
		const manualSize = this.getManualSize(node);
		if (this.settings.manualOverride)
			return manualSize;

		let weight = 0;

		const backwardCount = Object.keys(node.reverse || {}).length;
		weight += backwardCount * this.settings.bwdMultiplier;

		const forwardCount = Object.keys(node.forward || {}).length;
		weight += forwardCount * this.settings.fwdMultiplier;

		if (this.settings.lettersPerWt > 0)
			weight += this.letterCount(node) / this.settings.lettersPerWt;

		if (manualSize > 0)
			weight += manualSize * this.settings.manualMultiplier;

		return Math.round(weight);
	}

	getManualSize(node) {
		const file = this.app.vault.getFileByPath(node.id);
		if (!file) return 0;
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter?.node_size || 0;
	}

	letterCount(node) {
		const file = this.app.vault.getFileByPath(node.id);
		if (!file || file.extension !== "md") return 0;
		return file.stat.size;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SimpleSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'إعدادات الروابط التلقائية' });

		new Setting(containerEl)
			.setName('تحديث تلقائي للروابط')
			.setDesc('عند التفعيل، يتم تحديث روابط المجلدات تلقائياً عند تغيير الملفات')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoUpdateLinks)
				.onChange(async value => {
					this.plugin.settings.autoUpdateLinks = value;
					await this.plugin.saveSettings();
				})
			);

		containerEl.createEl('h2', { text: 'إعدادات أوزان الرسم البياني' });

		new Setting(containerEl)
			.setName("معامل الروابط الأمامية")
			.addSlider(sl => sl.setLimits(0, 20, 1)
				.setValue(this.plugin.settings.fwdMultiplier)
				.onChange(async v => {
					this.plugin.settings.fwdMultiplier = v;
					await this.plugin.saveSettings();
					this.plugin.initializeGraph();
				}));

		new Setting(containerEl)
			.setName("معامل الروابط الخلفية")
			.addSlider(sl => sl.setLimits(0, 20, 1)
				.setValue(this.plugin.settings.bwdMultiplier)
				.onChange(async v => {
					this.plugin.settings.bwdMultiplier = v;
					await this.plugin.saveSettings();
					this.plugin.initializeGraph();
				}));

		new Setting(containerEl)
			.setName("الحروف لكل وحدة وزن")
			.addSlider(sl => sl.setLimits(0, 1000, 10)
				.setValue(this.plugin.settings.lettersPerWt)
				.onChange(async v => {
					this.plugin.settings.lettersPerWt = v;
					await this.plugin.saveSettings();
					this.plugin.initializeGraph();
				}));
	}
}

module.exports = SimpleFolderLinksPlugin;