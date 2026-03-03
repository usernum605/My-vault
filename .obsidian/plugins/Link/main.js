const { App, Plugin, ItemView, WorkspaceLeaf, TFile } = require ('obsidian');
// Unique identifier for our view
const VIEW_TYPE = "links-property-view";

export default class LinksPropertyPlugin extends Plugin {
  async onload() {
    // Register a custom view that will display the Links property
    this.registerView(
      VIEW_TYPE,
      (leaf) => new LinksPropertyView(leaf, this)
    );

    // Add a ribbon icon to open the view
    this.addRibbonIcon("link", "Links property", () => {
      this.activateView();
    });

    // Add a command to open the view
    this.addCommand({
      id: "open-links-property-view",
      name: "Open Links property view",
      callback: () => this.activateView(),
    });

    // Refresh the view when the active note changes
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.refreshView();
      })
    );
  }

  async activateView() {
    const { workspace } = this.app;

    // If the view is already open, reveal it
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  refreshView() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (leaf && leaf.view instanceof LinksPropertyView) {
      leaf.view.renderLinks();
    }
  }
}

class LinksPropertyView extends ItemView {
  plugin: LinksPropertyPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: LinksPropertyPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Links property";
  }

  async onOpen() {
    this.renderLinks();
  }

  renderLinks() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      container.createEl("p", { text: "No active file" });
      return;
    }

    // Read the frontmatter
    this.app.vault.read(activeFile).then((content) => {
      const frontmatter = this.app.metadataCache.getFileCache(activeFile)?.frontmatter;
      if (!frontmatter) {
        container.createEl("p", { text: "No frontmatter found." });
        return;
      }

      // Look for a property named "links" (can be text or list)
      let links: string[] = [];
      if (frontmatter.links) {
        if (Array.isArray(frontmatter.links)) {
          links = frontmatter.links;
        } else {
          links = [frontmatter.links];
        }
      }

      container.createEl("h3", { text: "Links" });

      // Display each link as a clickable internal link
      const list = container.createEl("ul");
      links.forEach((link) => {
        const li = list.createEl("li");
        const linkText = link.replace(/^\[\[|\]\]$/g, ""); // strip double brackets if present
        li.createEl("a", {
          text: linkText,
          cls: "internal-link",
          href: "#",
        }).addEventListener("click", (e) => {
          e.preventDefault();
          this.app.workspace.openLinkText(linkText, "", false);
        });
      });

      // Simple input to add a new link
      const inputDiv = container.createDiv();
      const input = inputDiv.createEl("input", { type: "text", placeholder: "New link (e.g. [[Note]])" });
      const addBtn = inputDiv.createEl("button", { text: "Add" });
      addBtn.addEventListener("click", async () => {
        const newLink = input.value.trim();
        if (!newLink) return;

        // Get current frontmatter
        const fileCache = this.app.metadataCache.getFileCache(activeFile);
        let frontmatter = fileCache?.frontmatter || {};

        if (!frontmatter.links) {
          frontmatter.links = [];
        } else if (!Array.isArray(frontmatter.links)) {
          frontmatter.links = [frontmatter.links];
        }

        // Add the new link if not already present
        if (!frontmatter.links.includes(newLink)) {
          frontmatter.links.push(newLink);
          await this.updateFrontmatter(activeFile, frontmatter);
          input.value = "";
          this.renderLinks(); // refresh
        }
      });
    });
  }

  async updateFrontmatter(file: TFile, newFrontmatter: any) {
    await this.app.vault.process(file, (data) => {
      const frontmatterRegex = /^---\n(.*?\n)---\n(.*)/s;
      const match = data.match(frontmatterRegex);
      if (match) {
        // Replace existing frontmatter
        const existing = match[1];
        const rest = match[2];
        // Simple serialisation – for production use a library like js-yaml
        const yaml = Object.entries(newFrontmatter)
          .map(([k, v]) => {
            if (Array.isArray(v)) {
              return `${k}:\n  - ${v.join("\n  - ")}`;
            }
            return `${k}: ${v}`;
          })
          .join("\n");
        return `---\n${yaml}\n---\n${rest}`;
      } else {
        // No frontmatter, add it
        const yaml = Object.entries(newFrontmatter)
          .map(([k, v]) => {
            if (Array.isArray(v)) {
              return `${k}:\n  - ${v.join("\n  - ")}`;
            }
            return `${k}: ${v}`;
          })
          .join("\n");
        return `---\n${yaml}\n---\n${data}`;
      }
    });
  }
}