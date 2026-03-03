const { Plugin, TFile, Platform, moment } = require('obsidian');

module.exports = class LinksPropertyPlugin extends Plugin {
  async onload() {
    console.log('Loading Links Property Plugin');

    this.registerMarkdownPostProcessor((el, ctx) => {
      this.processProperties(el, ctx);
    });

    this.addCommand({
      id: 'insert-links-property',
      name: 'Insert links property',
      editorCallback: (editor) => {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        
        if (line === '---' || cursor.line === 0) {
          editor.replaceRange(
            '---\nlinks: \n  - "[[New Note]]"\n---\n',
            { line: 0, ch: 0 },
            { line: 0, ch: 0 }
          );
        } else {
          editor.replaceRange('\nlinks: \n  - "[[New Note]]"\n', cursor);
        }
      }
    });

    this.registerDomEvent(document, 'click', (evt) => {
      const target = evt.target;
      if (target.hasClass('links-chip') && !target.hasClass('links-chip-remove')) {
        evt.preventDefault();
        evt.stopPropagation();
        const link = target.getAttribute('data-link');
        if (link) {
          const cleanPath = link.replace(/\[\[|\]\]/g, '').split('|')[0];
          this.app.workspace.openLinkText(cleanPath, '', false);
        }
      }
    });

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        setTimeout(() => this.processAllProperties(), 500);
      })
    );

    setTimeout(() => this.processAllProperties(), 1000);
  }

  processAllProperties() {
    const activeView = this.app.workspace.getActiveViewOfType(require('obsidian').MarkdownView);
    if (activeView && activeView.file) {
      const propertiesEl = activeView.contentEl.querySelector('.metadata-properties');
      if (propertiesEl) {
        this.processPropertyElements(propertiesEl, activeView.file);
      }
    }
  }

  processProperties(el, ctx) {
    if (!ctx.sourcePath) return;
    
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    const propertiesSection = el.querySelector('.metadata-properties');
    if (propertiesSection) {
      this.processPropertyElements(propertiesSection, file);
    }

    const observer = new MutationObserver(() => {
      const props = el.querySelector('.metadata-properties');
      if (props) {
        this.processPropertyElements(props, file);
      }
    });
    
    observer.observe(el, { childList: true, subtree: true });
    el.addEventListener('remove', () => observer.disconnect());
  }

  processPropertyElements(container, file) {
    if (!container) return;

    const propertyItems = container.querySelectorAll('.metadata-property');
    
    propertyItems.forEach((item) => {
      const keyEl = item.querySelector('.metadata-property-key');
      const valueEl = item.querySelector('.metadata-property-value');
      const iconContainer = item.querySelector('.metadata-property-icon');
      
      if (!keyEl || !valueEl) return;
      
      const key = keyEl.getText().trim(); // <-- IMPORTANT: trim to avoid empty key
      const content = valueEl.innerHTML;
      
      if (content.includes('[[') && content.includes(']]')) {
        if (iconContainer) {
          this.addLinkIcon(iconContainer);
        }
        this.transformToChips(item, valueEl, file, key);
      }
    });
  }

  addLinkIcon(iconContainer) {
    if (iconContainer.querySelector('.link-icon')) return;
    
    iconContainer.empty();
    const linkIcon = iconContainer.createSpan({ cls: 'link-icon' });
    linkIcon.innerHTML = '🔗';
    
    try {
      const { setIcon } = require('obsidian');
      setIcon(linkIcon, 'link');
      linkIcon.removeClass('link-icon');
      linkIcon.addClass('link-icon-svg');
    } catch (e) {}
  }

  transformToChips(propertyEl, valueEl, file, key) {
    if (propertyEl.hasClass('links-property-processed')) return;
    propertyEl.addClass('links-property-processed');

    const fullText = valueEl.getText();
    const links = this.extractLinks(fullText);
    
    // Clear existing content
    valueEl.empty();

    // Create chip container
    const chipContainer = valueEl.createDiv({ cls: 'links-chip-container' });

    // Create chips for each link
    links.forEach(link => {
      const chip = chipContainer.createSpan({ cls: 'links-chip' });
      
      let displayText = link;
      let fullLink = link;
      
      const match = link.match(/\[\[(.*?)\]\]/);
      if (match) {
        fullLink = match[1];
        const parts = fullLink.split('|');
        displayText = parts.length > 1 ? parts[1] : parts[0];
      }

      chip.setText(displayText);
      chip.setAttribute('data-link', link);
      
      const removeBtn = chip.createSpan({ cls: 'links-chip-remove', text: '×' });
      
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const currentLinks = this.extractLinks(fullText);
        const newLinks = currentLinks.filter(l => l !== link);
        await this.updateFrontmatter(file, key, newLinks);
        setTimeout(() => this.processAllProperties(), 100);
      });
    });

    // Create input field for adding new links (always visible)
    this.createInputField(valueEl, file, key, fullText);
  }

  createInputField(container, file, key, fullText) {
    const inputContainer = container.createDiv({ cls: 'links-input-container' });
    const input = inputContainer.createEl('input', {
      type: 'text',
      cls: 'links-input',
      placeholder: 'Type note name and press Enter...'
    });

    // Create datalist for suggestions
    const datalistId = 'links-suggestions-' + Math.random().toString(36).substr(2, 9);
    const datalist = document.createElement('datalist');
    datalist.id = datalistId;
    
    this.app.vault.getMarkdownFiles().forEach(f => {
      const option = document.createElement('option');
      option.value = f.basename;
      datalist.appendChild(option);
    });
    
    input.setAttribute('list', datalistId);
    inputContainer.appendChild(datalist);

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && input.value) {
        e.preventDefault();
        let newLink = input.value.trim();
        
        // Convert to wikilink format
        if (!newLink.startsWith('[[')) {
          newLink = `[[${newLink}]]`;
        }
        
        const currentLinks = this.extractLinks(fullText);
        if (!currentLinks.includes(newLink)) {
          currentLinks.push(newLink);
          // Use the correct key!
          await this.updateFrontmatter(file, key, currentLinks);
          input.value = '';
          setTimeout(() => this.processAllProperties(), 100);
        } else {
          input.value = '';
        }
      }
    });

    // Optional: allow adding on blur? (we'll keep it Enter only for clarity)
  }

  extractLinks(text) {
    if (!text) return [];
    const links = [];
    const regex = /\[\[(.*?)\]\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      links.push(match[0]);
    }
    return links;
  }

  async updateFrontmatter(file, key, links) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (links.length === 0) {
        delete frontmatter[key];
      } else {
        frontmatter[key] = links;
      }
    });
  }

  onunload() {
    console.log('Unloading Links Property Plugin');
  }
};