const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_SETTINGS = {
	fwdMultiplier: 1,
	bwdMultiplier: 1,
	fwdTree: false,
	lettersPerWt: 0,
	manualMultiplier: 1,
	manualOverride: false
};

class CombinedGraphPlugin extends Plugin {

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.treeOptimizeMap = new Map();
		this.updateLoop = false;

		this.addSettingTab(new CombinedSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const leaf = this.app.workspace.getLeavesOfType("graph").first();
				if (!leaf) return;

				this.updateLoop = true;
				this.loop(leaf.view.renderer.nodes);
			})
		);
	}

	onunload() {
		this.updateLoop = false;
	}

	loop(nodes) {
		setTimeout(() => {
			this.updateNodes(nodes);
			if (this.updateLoop) this.loop(nodes);
		}, 20);
	}

	updateNodes(nodes) {
		this.treeOptimizeMap.clear();

		nodes.forEach(node => {
			node.weight = this.calculateWeight(node);
		});
	}

	calculateWeight(node) {

		const manualSize = this.getManualSize(node);

		if (this.settings.manualOverride && manualSize > 0)
			return manualSize;

		let weight = 0;

		// backward
		weight += Object.keys(node.reverse || {}).length * this.settings.bwdMultiplier;

		// forward
		if (this.settings.fwdTree)
			weight += this.forwardTree(node, node.id) * this.settings.fwdMultiplier;
		else
			weight += Object.keys(node.forward || {}).length * this.settings.fwdMultiplier;

		// letters
		if (this.settings.lettersPerWt > 0)
			weight += this.letterCount(node) / this.settings.lettersPerWt;

		// manual influence
		if (manualSize > 0)
			weight += manualSize * this.settings.manualMultiplier;

		return Math.round(weight);
	}

	getManualSize(node) {
		const file = this.app.vault.getFileByPath(node.id);
		if (!file) return 0;

		const cache = this.app.metadataCache.getFileCache(file);
		return (cache && cache.frontmatter && cache.frontmatter.node_size) || 0;
	}

	letterCount(node) {
		const file = this.app.vault.getFileByPath(node.id);
		if (!file || file.extension !== "md") return 0;
		return file.stat.size;
	}

	forwardTree(node, origin) {
		if (this.treeOptimizeMap.has(node.id))
			return this.treeOptimizeMap.get(node.id);

		let size = 0;

		Object.entries(node.forward || {}).forEach(([key, value]) => {
			if (key === origin) return;
			size++;
			size += this.forwardTree(value.target, origin);
		});

		this.treeOptimizeMap.set(node.id, size);
		return size;
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
			.addSlider(sl => sl.setLimits(0,20,1)
				.setValue(this.plugin.settings.fwdMultiplier)
				.onChange(async v => {
					this.plugin.settings.fwdMultiplier = v;
					await this.plugin.saveSettings();	
					this.plugin.updateLoop = false;
          const leaf = this.app.workspace.getLeavesOfType("graph").first();
          if (leaf) {
	this.plugin.updateLoop = true;
	this.plugin.loop(leaf.view.renderer.nodes);
}
				}));

		new Setting(containerEl)
			.setName("Backward multiplier")
			.addSlider(sl => sl.setLimits(0,20,1)
				.setValue(this.plugin.settings.bwdMultiplier)
				.onChange(async v => {
					this.plugin.settings.bwdMultiplier = v;
					await this.plugin.saveSettings();
					this.plugin.updateLoop = false;
          const leaf = this.app.workspace.getLeavesOfType("graph").first();
          if (leaf) {
	this.plugin.updateLoop = true;
	this.plugin.loop(leaf.view.renderer.nodes);
}
				}));

		new Setting(containerEl)
			.setName("Manual multiplier")
			.addSlider(sl => sl.setLimits(0,20,1)
				.setValue(this.plugin.settings.manualMultiplier)
				.onChange(async v => {
					this.plugin.settings.manualMultiplier = v;
					await this.plugin.saveSettings();
					this.plugin.updateLoop = false;
          const leaf = this.app.workspace.getLeavesOfType("graph").first();
          if (leaf) {
	this.plugin.updateLoop = true;
	this.plugin.loop(leaf.view.renderer.nodes);
}
				}));

    new Setting(containerEl)
    	.setName("Use forward tree")
    	.addToggle(t => t
    		.setValue(this.plugin.settings.fwdTree)
	    	.onChange(async v => {
	      		this.plugin.settings.fwdTree = v;
	      		await this.plugin.saveSettings();
	      		this.plugin.updateLoop = false;
            const leaf = this.app.workspace.getLeavesOfType("graph").first();
            if (leaf) {
	this.plugin.updateLoop = true;
	this.plugin.loop(leaf.view.renderer.nodes);
}
		}));

		new Setting(containerEl)
			.setName("Manual override")
			.addToggle(t => t
				.setValue(this.plugin.settings.manualOverride)
				.onChange(async v => {
					this.plugin.settings.manualOverride = v;
					await this.plugin.saveSettings();
					this.plugin.updateLoop = false;
          const leaf = this.app.workspace.getLeavesOfType("graph").first();
          if (leaf) {
	this.plugin.updateLoop = true;
	this.plugin.loop(leaf.view.renderer.nodes);
}
				}));
	}
}

module.exports = CombinedGraphPlugin;