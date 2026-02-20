```js
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

		this.virtualEdges = new Set();
		this.folderCache = new Map();

		this.addSettingTab(new CombinedSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.initializeGraph();
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

		// فقط markdown
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

				// تأكد من وجود forward
				if (!sourceNode.forward)
					sourceNode.forward = {};

				// تأكد من وجود reverse
				if (!targetNode.reverse)
					targetNode.reverse = {};

				// حقن forward
				sourceNode.forward[filePath] = {
					target: targetNode,
					_virtual: true
				};

				// حقن reverse الحقيقي
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
					this.plugin.initializeGraph();
				}));

		new Setting(containerEl)
			.setName("Backward multiplier")
			.addSlider(sl => sl.setLimits(0, 20, 1)
				.setValue(this.plugin.settings.bwdMultiplier)
				.onChange(async v => {
					this.plugin.settings.bwdMultiplier = v;
					await this.plugin.saveSettings();
					this.plugin.initializeGraph();
				}));
	}
}

module.exports = OptimizedCombinedGraphPlugin;
```