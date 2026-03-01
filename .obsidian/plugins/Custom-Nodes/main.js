const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_SETTINGS = {
	manualMultiplier: 1,
	manualOverride: false,
	calculateForAll: false   // الخيار الجديد
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
				const [src, dst] = key.split("::");

				if (node.id === src && node.forward[dst]) {
					delete node.forward[dst];
				}
				if (node.id === dst && node.reverse[src]) {
					delete node.reverse[src];
				}
			});
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

		// هل نحسب لكل العقد؟
		const shouldCalculate =
			this.settings.calculateForAll || this.isTreeEnabled(node);

		if (!shouldCalculate)
			return manualSize > 0 ? manualSize : 1;

		const visited = new Set();
		this.collectDescendants(node, visited);

		return visited.size;
	}

	isTreeEnabled(node) {
		const file = this.app.vault.getFileByPath(node.id);
		if (!file) return false;

		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter?.culcultree === true;
	}

	collectDescendants(node, visited) {

		if (!node.forward) return;

		for (const key in node.forward) {

			const child = node.forward[key]?.target;
			if (!child) continue;

			if (visited.has(child.id)) continue;

			visited.add(child.id);

			this.collectDescendants(child, visited);
		}
	}

	getManualSize(node) {
		const file = this.app.vault.getFileByPath(node.id);
		if (!file) return 0;
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter?.node_size || 0;
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
			.setName("Calculate tree for all nodes")
			.setDesc("If enabled, tree size is calculated for every node.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.calculateForAll)
				.onChange(async (value) => {
					this.plugin.settings.calculateForAll = value;
					await this.plugin.saveSettings();
					this.plugin.initializeGraph();
				}));
	}
}

module.exports = OptimizedCombinedGraphPlugin;