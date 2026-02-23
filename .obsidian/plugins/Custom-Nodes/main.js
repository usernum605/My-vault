const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_SETTINGS = {
	wordsPerWeight: 100,
	folderMultiplier: 1,
	manualMultiplier: 1,
	manualOverride: false
};

class OptimizedCombinedGraphPlugin extends Plugin {

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		this.virtualEdges = new Set();
		this.folderCache = new Map();
		this.wordCounts = new Map();

		this.addSettingTab(new CombinedSettingTab(this.app, this));

		// React to layout changes (graph opening)
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.initializeGraph();
			})
		);

		// Update word count when a file is modified
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file.extension === "md") {
					this.updateWordCountForFile(file).then(() => this.refreshGraph());
				}
			})
		);

		// Refresh graph when any file's links change (affects tree‑note sums)
		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				this.refreshGraph();
			})
		);
	}

	onunload() {
		this.cleanupVirtualEdges();
	}

	// =============================
	// INITIALIZATION
	// =============================

	initializeGraph() {
		const leaf = this.app.workspace.getLeavesOfType("graph").first();
		if (!leaf) return;

		const renderer = leaf.view.renderer;
		if (!renderer?.nodes) return;

		this.cleanupVirtualEdges();
		this.injectVirtualEdges(renderer.nodes);
		this.updateWeights(renderer.nodes);

		// Load word counts for nodes that need them (async)
		this.loadWordCountsForNodes(renderer.nodes);
	}

	// =============================
	// CLEANUP
	// =============================

	cleanupVirtualEdges() {
		const leaf = this.app.workspace.getLeavesOfType("graph").first();
		if (!leaf) return;

		const nodes = leaf.view.renderer.nodes;
		if (!nodes) return;

		nodes.forEach(node => {
			if (!node.forward || !node.reverse) return;

			this.virtualEdges.forEach(key => {
				const [src, dst] = key.split("->");
				if (node.id === src && node.forward[dst]) {
					delete node.forward[dst];
				}
				if (node.id === dst && node.reverse[src]) {
					delete node.reverse[src];
				}
			});
		});

		this.virtualEdges.clear();
	}

	// =============================
	// FRONTMATTER
	// =============================

	getFolderPathsFromFrontmatter(node) {
		const file = this.app.vault.getFileByPath(node.id);
		if (!file) return [];

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter) return [];

		const linkPages = cache.frontmatter["links pages"];
		if (!Array.isArray(linkPages)) return [];

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

	// =============================
	// EDGE INJECTION
	// =============================

	injectVirtualEdges(nodes) {
		const nodeMap = new Map();
		nodes.forEach(n => nodeMap.set(n.id, n));

		nodes.forEach(sourceNode => {
			if (!sourceNode.id.endsWith(".md")) return;

			const folderPaths = this.getFolderPathsFromFrontmatter(sourceNode);
			if (!folderPaths.length) return;

			for (const folderPath of folderPaths) {
				const files = this.getFolderMarkdownFiles(folderPath);

				for (const filePath of files) {
					if (filePath === sourceNode.id) continue;

					const targetNode = nodeMap.get(filePath);
					if (!targetNode) continue;

					const edgeKey = `${sourceNode.id}::${filePath}`;
					if (this.virtualEdges.has(edgeKey)) continue;

					if (!sourceNode.forward)
						sourceNode.forward = {};
					if (!targetNode.reverse)
						targetNode.reverse = {};

					sourceNode.forward[filePath] = {
						target: targetNode,
						_virtual: true
					};
					targetNode.reverse[sourceNode.id] = {
						source: sourceNode,
						_virtual: true
					};

					this.virtualEdges.add(edgeKey);
				}
			}
		});
	}

	// =============================
	// WEIGHT CALCULATION
	// =============================

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

		// ---- Word count contribution ----
		if (this.shouldCountWords(node) && this.wordCounts.has(node.id)) {
			const wordCount = this.wordCounts.get(node.id);
			if (this.settings.wordsPerWeight > 0) {
				weight += wordCount / this.settings.wordsPerWeight;
			}
		}

		// ---- Folder multiplier (virtual outlinks) ----
		// Count only virtual forward edges (injected via folder linking)
		const virtualForwardCount = Object.values(node.forward || {})
			.filter(e => e._virtual).length;
		weight += virtualForwardCount * this.settings.folderMultiplier;

		// ---- Tree‑note contribution ----
		if (this.shouldApplyTreeNote(node)) {
			const folderPaths = this.getFolderPathsFromFrontmatter(node);
			let totalOutlinks = 0;
			for (const folderPath of folderPaths) {
				const files = this.getFolderMarkdownFiles(folderPath);
				for (const filePath of files) {
					if (filePath === node.id) continue;
					totalOutlinks += this.getOutlinksCount(filePath);
				}
			}
			if (this.settings.wordsPerWeight > 0) {
				weight += totalOutlinks / this.settings.wordsPerWeight;
			}
		}

		// ---- Manual size ----
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

	shouldCountWords(node) {
		const file = this.app.vault.getFileByPath(node.id);
		if (!file || file.extension !== "md") return false;
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter?.["count-words"] === true;
	}

	shouldApplyTreeNote(node) {
		const file = this.app.vault.getFileByPath(node.id);
		if (!file || file.extension !== "md") return false;
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter?.["tree-note"] === true;
	}

	getOutlinksCount(filePath) {
		const resolved = this.app.metadataCache.resolvedLinks[filePath];
		return resolved ? Object.keys(resolved).length : 0;
	}

	// =============================
	// WORD COUNT MANAGEMENT
	// =============================

	async loadWordCountsForNodes(nodes) {
		for (const node of nodes) {
			if (this.shouldCountWords(node) && !this.wordCounts.has(node.id)) {
				await this.loadWordCountForNode(node);
			}
		}
	}

	async loadWordCountForNode(node) {
		const file = this.app.vault.getFileByPath(node.id);
		if (!file) return;

		const content = await this.app.vault.read(file);
		const words = content.split(/\s+/).filter(w => w.length > 0);
		this.wordCounts.set(node.id, words.length);
		node.weight = this.calculateWeight(node);
	}

	async updateWordCountForFile(file) {
		const nodeId = file.path;
		const cache = this.app.metadataCache.getFileCache(file);
		const shouldCount = cache?.frontmatter?.["count-words"] === true;

		if (shouldCount) {
			const content = await this.app.vault.read(file);
			const words = content.split(/\s+/).filter(w => w.length > 0);
			this.wordCounts.set(nodeId, words.length);
		} else {
			this.wordCounts.delete(nodeId);
		}
	}

	async refreshGraph() {
		const leaf = this.app.workspace.getLeavesOfType("graph").first();
		if (!leaf) return;

		const renderer = leaf.view.renderer;
		if (!renderer?.nodes) return;

		this.updateWeights(renderer.nodes);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.refreshGraph();
	}
}

class CombinedSettingTab extends PluginSettingTab {

	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Words per weight unit")
			.setDesc("Number of words (or outlinks for tree‑notes) that increase node size by 1")
			.addSlider(sl => sl.setLimits(1, 1000, 10)
				.setValue(this.plugin.settings.wordsPerWeight)
				.onChange(async v => {
					this.plugin.settings.wordsPerWeight = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Folder multiplier")
			.setDesc("How much each note in a folder increases the folder node’s size")
			.addSlider(sl => sl.setLimits(0, 20, 1)
				.setValue(this.plugin.settings.folderMultiplier)
				.onChange(async v => {
					this.plugin.settings.folderMultiplier = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Manual multiplier")
			.setDesc("Multiplier for manual node_size frontmatter")
			.addSlider(sl => sl.setLimits(0, 20, 1)
				.setValue(this.plugin.settings.manualMultiplier)
				.onChange(async v => {
					this.plugin.settings.manualMultiplier = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Manual override")
			.setDesc("If a node has manual size, use it directly (ignores other factors)")
			.addToggle(t => t.setValue(this.plugin.settings.manualOverride)
				.onChange(async v => {
					this.plugin.settings.manualOverride = v;
					await this.plugin.saveSettings();
				}));
	}
}

module.exports = OptimizedCombinedGraphPlugin;