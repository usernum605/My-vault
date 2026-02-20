const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_SETTINGS = {
	fwdMultiplier: 1,
	bwdMultiplier: 1,
	lettersPerWt: 0,
	manualMultiplier: 1,
	manualOverride: false
};

class OptimizedCombinedGraphPlugin extends Plugin {

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		this.folderCache = new Map();          // cache folder file lists
		
		this.addSettingTab(new CombinedSettingTab(this.app, this));

		// ---- Folder‑based graph edges (via metadata) ----
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file.extension === "md") {
					this.updateFolderBasedLinks(file);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file.extension === "md") {
					this.folderCache.clear();
					this.updateAllFolderBasedLinks();
				}
			})
		);

		// ---- Node resizing (weights) ----
		// Apply weights on layout change
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.applyNodeWeights();
			})
		);

		// Also run once when all files are loaded
		this.app.workspace.onLayoutReady(() => {
			this.updateAllFolderBasedLinks();
			this.applyNodeWeights();
		});

		// ---- Primitive, persistent reapplication ----
		// Every second, reapply weights to ensure they stay
		this.interval = setInterval(() => {
			this.applyNodeWeights();
		}, 1000);
	}

	onunload() {
		this.cleanupAllFolderLinks();
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	// ============================================================
	// FOLDER‑BASED GRAPH EDGES (metadata cache manipulation)
	// ============================================================

	updateAllFolderBasedLinks() {
		const markdownFiles = this.app.vault.getMarkdownFiles();
		for (const file of markdownFiles) {
			this.updateFolderBasedLinks(file);
		}
	}

	updateFolderBasedLinks(file) {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter) return;

		const linkPages = cache.frontmatter["links pages"];
		if (!Array.isArray(linkPages)) return;

		const folderPaths = this.parseFolderPaths(linkPages);
		if (folderPaths.length === 0) return;

		// Get all markdown files in these folders
		const targetFiles = new Set();
		for (const folderPath of folderPaths) {
			const files = this.getFolderMarkdownFiles(folderPath);
			for (const f of files) {
				targetFiles.add(f);
			}
		}

		this.createFolderBasedLinks(file.path, Array.from(targetFiles));
	}

	parseFolderPaths(linkPages) {
		const paths = [];
		for (const entry of linkPages) {
			if (typeof entry === "object" && entry !== null) {
				for (const key in entry) {
					if (key.toLowerCase() === "path") {
						const value = entry[key];
						if (typeof value === "string") {
							paths.push(value.trim());
						}
					}
				}
			}
			if (typeof entry === "string") {
				const match = entry.match(/path\s*:\s*(.+)/i);
				if (match) {
					let value = match[1].trim();
					value = value.replace(/^["']|["']$/g, "");
					paths.push(value);
				}
			}
		}
		return paths;
	}

	getFolderMarkdownFiles(folderPath) {
		if (this.folderCache.has(folderPath))
			return this.folderCache.get(folderPath);

		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder?.children) return [];

		const files = [];
		const walk = (items) => {
			for (const item of items) {
				if (item.children) {
					walk(item.children);
				} else if (item.extension === "md") {
					files.push(item.path);
				}
			}
		};
		walk(folder.children);

		this.folderCache.set(folderPath, files);
		return files;
	}

	createFolderBasedLinks(sourcePath, targetPaths) {
		const metadataCache = this.app.metadataCache;
		
		// Ensure resolvedLinks object exists
		if (!metadataCache.resolvedLinks[sourcePath]) {
			metadataCache.resolvedLinks[sourcePath] = {};
		}
		if (!metadataCache.unresolvedLinks[sourcePath]) {
			metadataCache.unresolvedLinks[sourcePath] = {};
		}

		// Store our added links for cleanup
		if (!metadataCache.folderBasedLinks) {
			metadataCache.folderBasedLinks = {};
		}
		if (!metadataCache.folderBasedLinks[sourcePath]) {
			metadataCache.folderBasedLinks[sourcePath] = new Set();
		}

		// Remove old folder‑based links
		for (const oldTarget of metadataCache.folderBasedLinks[sourcePath]) {
			delete metadataCache.resolvedLinks[sourcePath][oldTarget];
			delete metadataCache.unresolvedLinks[sourcePath][oldTarget];
		}
		metadataCache.folderBasedLinks[sourcePath].clear();

		// Add new links
		for (const targetPath of targetPaths) {
			if (targetPath === sourcePath) continue;
			const targetFile = this.app.vault.getFileByPath(targetPath);
			if (targetFile) {
				metadataCache.resolvedLinks[sourcePath][targetPath] = 
					(metadataCache.resolvedLinks[sourcePath][targetPath] || 0) + 1;
				metadataCache.folderBasedLinks[sourcePath].add(targetPath);
			} else {
				metadataCache.unresolvedLinks[sourcePath][targetPath] = 1;
			}
		}

		// Trigger graph update
		metadataCache.trigger("changed", this.app.vault.getFileByPath(sourcePath));
	}

	cleanupAllFolderLinks() {
		const metadataCache = this.app.metadataCache;
		if (!metadataCache.folderBasedLinks) return;
		
		for (const sourcePath in metadataCache.folderBasedLinks) {
			const links = metadataCache.folderBasedLinks[sourcePath];
			if (metadataCache.resolvedLinks[sourcePath]) {
				for (const targetPath of links) {
					delete metadataCache.resolvedLinks[sourcePath][targetPath];
				}
			}
			delete metadataCache.folderBasedLinks[sourcePath];
		}
		// Force a refresh
		const anyFile = this.app.vault.getMarkdownFiles()[0];
		if (anyFile) metadataCache.trigger("changed", anyFile);
	}

	// ============================================================
	// NODE RESIZING (weight calculation)
	// ============================================================

	applyNodeWeights() {
		const graphLeaf = this.app.workspace.getLeavesOfType("graph").first();
		if (!graphLeaf) return;

		const renderer = graphLeaf.view.renderer;
		if (!renderer?.nodes) return;

		// Update each node's weight based on current links + frontmatter
		this.updateWeights(renderer.nodes);

		// Force the graph to redraw (weights affect node sizes)
		if (renderer.zoom) {
			// Slight zoom change to trigger redraw
			const originalZoom = renderer.zoom;
			renderer.setZoom(originalZoom * 1.001);
			renderer.setZoom(originalZoom);
		} else {
			renderer.onZoom && renderer.onZoom();
		}
	}

	updateWeights(nodes) {
		nodes.forEach(node => {
			node.weight = this.calculateWeight(node);
		});
	}

	calculateWeight(node) {
		const manualSize = this.getManualSize(node);
		if (this.settings.manualOverride && manualSize > 0)
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
		// After settings change, reapply weights
		this.applyNodeWeights();
	}
}

// ============================================================
// SETTINGS TAB
// ============================================================

class CombinedSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Forward multiplier")
			.addSlider(sl => sl.setLimits(0, 20, 1)
				.setValue(this.plugin.settings.fwdMultiplier)
				.onChange(async v => {
					this.plugin.settings.fwdMultiplier = v;
					await this.plugin.saveSettings();
					this.plugin.applyNodeWeights();
				}));

		new Setting(containerEl)
			.setName("Backward multiplier")
			.addSlider(sl => sl.setLimits(0, 20, 1)
				.setValue(this.plugin.settings.bwdMultiplier)
				.onChange(async v => {
					this.plugin.settings.bwdMultiplier = v;
					await this.plugin.saveSettings();
					this.plugin.applyNodeWeights();
				}));

		new Setting(containerEl)
			.setName("Letters per weight")
			.addSlider(sl => sl.setLimits(0, 1000, 10)
				.setValue(this.plugin.settings.lettersPerWt)
				.onChange(async v => {
					this.plugin.settings.lettersPerWt = v;
					await this.plugin.saveSettings();
					this.plugin.applyNodeWeights();
				}));

		new Setting(containerEl)
			.setName("Manual multiplier")
			.addSlider(sl => sl.setLimits(0, 20, 1)
				.setValue(this.plugin.settings.manualMultiplier)
				.onChange(async v => {
					this.plugin.settings.manualMultiplier = v;
					await this.plugin.saveSettings();
					this.plugin.applyNodeWeights();
				}));

		new Setting(containerEl)
			.setName("Manual override")
			.setDesc("If enabled, only manual node_size will be used")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.manualOverride)
				.onChange(async v => {
					this.plugin.settings.manualOverride = v;
					await this.plugin.saveSettings();
					this.plugin.applyNodeWeights();
				}));
	}
}

module.exports = OptimizedCombinedGraphPlugin;