const { Plugin, PluginSettingTab, Setting, MarkdownView, getIcon, getIconIds, SuggestModal, TFile, TFolder, debounce, Menu, Modal, Notice, setIcon, requestUrl } = require("obsidian");

const DEFAULT_SETTINGS = {
    enableBanner: true,
    bannerProperty: "banner",
    bannerPositionProperty: "banner_y",
    bannerHeight: 150,
    bannerMargin: 0,
    bannerFading: false,
    enableIcon: true,
    iconProperty: "icon",
    iconSize: 36,
    iconTopMargin: 70,
    iconTopMarginWithoutBanner: -10,
    iconLeftMargin: 0,
    iconGap: 10,
    bannerIconGap: 0,
    iconInTitle: true,
    showFileExplorerIcons: true,
    folderIcons: {},
    hiddenProperties: [],
    temporaryHiddenProperties: [], // الخصائص التي يمكن عرضها مؤقتاً
    temporaryViewTimeout: 60, // مدة العرض المؤقت بالثواني
    defaultNotePath: "",
    uiProperty: "ui",
    enableCache: true,
    cacheExpiryDays: 30,
    hideScrollbars: true
};

module.exports = class StyleshVault extends Plugin {
    async onload() {
        await this.loadSettings();
        
        // Add property editing tracking
        this.editingProperties = new Set();
        this.propertyEditTimeout = null;
        
        // إضافة متغيرات جديدة للعرض المؤقت
        this.temporaryVisibleProps = new Map(); // filePath -> {props: Set, timeout: timer}
        
        // Icon rendering tracking with timeout protection
        this.iconRenderPromises = new Map();
        this.iconRenderTimeouts = new Map();
        this.renderedIcons = new Map();
        this.pendingIconRenders = new Set();
        
        // Force mode watchers
        this.forceModeWatchers = new Map(); // leafId -> {interval: timer, targetMode: string}
        
        this.addSettingTab(new StyleshVaultSettingTab(this.app, this));
        this.updateCssVariables();
        this.updateHiddenPropertiesCSS();

        // Initialize cache
        await this.initCache();
        
        // 1. Commands
        this.addCommand({
            id: 'select-icon',
            name: 'Select Icon',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (file instanceof TFile) {
                    if (!checking) new IconSuggestModal(this.app, this, file).open();
                    return true;
                }
                return false;
            }
        });

        // Add force refresh command for debugging
        this.addCommand({
            id: 'force-refresh-icons',
            name: 'Force Refresh Icons',
            callback: async () => {
                this.renderedIcons.clear();
                this.iconRenderPromises.clear();
                this.pendingIconRenders.clear();
                await this.clearImageCache();
                this.updateAllViews();
                new Notice('Icons refreshed and cache cleared');
            }
        });

        // 2. File Explorer Context Menu
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFile || file instanceof TFolder) {
                    menu.addItem((item) => {
                        item.setTitle("Change Icon").setIcon("image-plus").onClick(() => {
                            new IconSuggestModal(this.app, this, file).open();
                        });
                    });
                }
            })
        );

        // 3. Property Menu Context Menu
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", debounce(() => {
                this.setupPropertyContextMenus();
            }, 100))
        );

        // Also trigger on layout-ready
        this.app.workspace.onLayoutReady(() => {
            this.setupPropertyContextMenus();
            this.addShowFullPropertiesButtons();
        });

        // 4. Banner/Icon Context Menu
        this.registerDomEvent(document, 'contextmenu', (evt) => {
            const target = evt.target;
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view || !view.file) return;

            if (target.closest('.banner-image')) {
                evt.preventDefault();
                const menu = new Menu();
                menu.addItem(i => i.setTitle("Change Banner").setIcon("image").onClick(() => new BannerSuggestModal(this.app, this, view.file).open()));
                menu.addItem(i => i.setTitle("Change Banner Position").setIcon("move-vertical").onClick(() => new BannerPositionModal(this.app, this, view.file).open()));
                menu.addItem(i => i.setTitle("Remove Banner").setIcon("trash").onClick(() => {
                    this.app.fileManager.processFrontMatter(view.file, (fm) => { delete fm[this.settings.bannerProperty]; });
                }));
                menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
            }

            if (target.closest('.icon-image') || target.closest('.pp-title-icon')) {
                evt.preventDefault();
                const menu = new Menu();
                menu.addItem(i => i.setTitle("Change Icon").setIcon("image-plus").onClick(() => new IconSuggestModal(this.app, this, view.file).open()));
                menu.addItem(i => i.setTitle("Remove Icon").setIcon("trash").onClick(() => {
                    this.app.fileManager.processFrontMatter(view.file, (fm) => { delete fm[this.settings.iconProperty]; });
                }));
                menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
            }
        });

        this.debouncedUpdate = debounce(() => {
            this.updateAllViews();
            this.updateTabIcons();
        }, 300, true); // Increased to 300ms for more stability

        // Events - FIXED: Added proper binding
        this.registerEvent(this.app.workspace.on("layout-change", () => this.debouncedUpdate()));
        this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
            this.debouncedUpdate();
            setTimeout(() => this.addShowFullPropertiesButtons(), 100);
        }));

        // FIX: Ensure metadata cache changes trigger updates with proper timing
        this.registerEvent(this.app.metadataCache.on("changed", (file) => {
            // Delay slightly to ensure frontmatter is fully processed
            setTimeout(() => {
                this.cleanupDuplicates(file);
                this.debouncedUpdate();
            }, 50);
        }));
        
        this.registerEvent(this.app.workspace.on("file-open", (file) => {
            // Delay to ensure file is fully loaded
            setTimeout(() => {
                this.handleViewMode(file);
                this.cleanupDuplicates(file);
                this.debouncedUpdate();
                this.addShowFullPropertiesButtons();
            }, 100);
        }));

        // FIX: Use a single onLayoutReady callback with proper sequencing
        this.app.workspace.onLayoutReady(() => {
            // Setup property context menus
            this.setupPropertyContextMenus();
            
            // Enforce UI mode for all currently open notes
            this.app.workspace.iterateAllLeaves((leaf) => {
                if (leaf.view instanceof MarkdownView && leaf.view.file) {
                    const fm = this.app.metadataCache.getFileCache(leaf.view.file)?.frontmatter;
                    const uiMode = fm?.[this.settings.uiProperty];
                    if (uiMode) {
                        this.enforceUIModeForLeaf(leaf, uiMode);
                    }
                }
            });
            
            // Update all views with a slight delay
            setTimeout(() => {
                this.debouncedUpdate();
            }, 200);
            
            // Add show full properties buttons
            setTimeout(() => this.addShowFullPropertiesButtons(), 300);
            
            // Open default note when Obsidian starts
            setTimeout(() => {
                this.openDefaultNote();
            }, 500); // Increased to 500ms
            
            // Watch for leaf changes to apply force mode to newly opened files
            this.registerEvent(this.app.workspace.on('active-leaf-change', debounce((leaf) => {
                if (leaf && leaf.view instanceof MarkdownView && leaf.view.file) {
                    const fm = this.app.metadataCache.getFileCache(leaf.view.file)?.frontmatter;
                    const uiMode = fm?.[this.settings.uiProperty];
                    if (uiMode) {
                        this.enforceUIModeForLeaf(leaf, uiMode);
                    }
                }
            }, 100)));
        });
        
        // Add command to clear cache
        this.addCommand({
            id: 'clear-image-cache',
            name: 'Clear Image Cache',
            callback: async () => {
                await this.clearImageCache();
                new Notice('Image cache cleared.');
            }
        });
        
        // إضافة أمر لعرض الخصائص المؤقتة
        this.addCommand({
            id: 'show-temporary-properties',
            name: 'Show Hidden Properties Temporarily',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (file instanceof TFile) {
                    if (!checking) {
                        this.showTemporaryProperties(file);
                    }
                    return true;
                }
                return false;
            }
        });
        
        this.updateScrollbarStyle(); 
        
        // Set up property edit listeners
        this.setupPropertyEditListeners();
    }

    // ============================================
    // ميزة إظهار الخصائص المؤقتة
    // ============================================
    
    async showTemporaryProperties(file) {
        if (!file || !file.path) return;
        
        const filePath = file.path;
        const activeProps = this.settings.temporaryHiddenProperties;
        
        if (activeProps.length === 0) {
            new Notice('No properties configured for temporary view. Add properties in plugin settings.');
            return;
        }
        
        // تنظيف المهلة السابقة إن وجدت
        if (this.temporaryVisibleProps.has(filePath)) {
            const previous = this.temporaryVisibleProps.get(filePath);
            if (previous.timeout) {
                clearTimeout(previous.timeout);
            }
        }
        
        // إضافة الخصائص للعرض المؤقت
        const propsSet = new Set(activeProps);
        this.temporaryVisibleProps.set(filePath, {
            props: propsSet,
            timeout: null
        });
        
        // تحديث CSS للعرض المؤقت
        this.updateHiddenPropertiesCSS();
        
        // إشعار المستخدم
        new Notice(`Showing ${activeProps.length} hidden properties for ${this.settings.temporaryViewTimeout} seconds`);
        
        // تعيين مهلة للإخفاء بعد الوقت المحدد
        const timeout = setTimeout(() => {
            this.hideTemporaryProperties(filePath);
        }, this.settings.temporaryViewTimeout * 1000);
        
        this.temporaryVisibleProps.get(filePath).timeout = timeout;
    }
    
    hideTemporaryProperties(filePath) {
        if (this.temporaryVisibleProps.has(filePath)) {
            const data = this.temporaryVisibleProps.get(filePath);
            if (data.timeout) {
                clearTimeout(data.timeout);
            }
            this.temporaryVisibleProps.delete(filePath);
            
            // تحديث CSS
            this.updateHiddenPropertiesCSS();
            
            // إشعار المستخدم
            new Notice('Temporary properties have been hidden');
        }
    }
    
    updateHiddenPropertiesCSS() {
        let styleEl = document.getElementById('pp-hidden-props') || document.head.createEl('style', { id: 'pp-hidden-props' });
        
        const rules = [];
        const currentFile = this.app.workspace.getActiveFile();
        const currentFilePath = currentFile ? currentFile.path : null;
        
        // قاعدة لكل خاصية مخفية
        this.settings.hiddenProperties.forEach(prop => {
            let shouldShow = false;
            
            // التحقق إذا كانت في وضع التحرير
            if (this.editingProperties.has(prop)) {
                shouldShow = true;
            }
            // التحقق إذا كانت في العرض المؤقت للفعال الحالي
            else if (currentFilePath && 
                    this.temporaryVisibleProps.has(currentFilePath) && 
                    this.temporaryVisibleProps.get(currentFilePath).props.has(prop)) {
                shouldShow = true;
            }
            
            if (shouldShow) {
                // عرض طبيعي بدون ألوان بارزة أو نصوص إضافية
                rules.push(`
                    .metadata-property[data-property-key="${prop}"] { 
                        opacity: 1 !important;
                        display: block !important;
                    }
                `);
            } else {
                rules.push(`.metadata-property[data-property-key="${prop}"] { display: none !important; }`);
            }
        });
        
        styleEl.innerText = rules.join("\n");
    }
    
    // إضافة أزرار "Show Full Properties" في قوائم الخصائص
    addShowFullPropertiesButtons() {
        // البحث عن جميع حاويات الخصائص
        const propertiesContainers = document.querySelectorAll('.metadata-container');
        
        propertiesContainers.forEach(container => {
            // التحقق إذا كان الزر موجود بالفعل
            if (container.querySelector('.show-full-properties-btn')) return;
            
            const header = container.querySelector('.metadata-container-heading');
            if (!header) return;
            
            const file = this.app.workspace.getActiveFile();
            if (!file) return;
            
            // إنشاء زر "Show Full Properties"
            const showFullBtn = document.createElement('button');
            showFullBtn.classList.add('show-full-properties-btn');
            showFullBtn.textContent = 'Show Full Properties';
            showFullBtn.title = 'Show temporary properties for 60 seconds';
            
            showFullBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                await this.showTemporaryProperties(file);
            });
            
            // إضافة الزر بجانب العنوان
            header.appendChild(showFullBtn);
        });
    }
    
    // تحديث handlePropertyContextMenu لدعم الخصائص المؤقتة
    handlePropertyContextMenu(evt, propertyEl) {
        evt.preventDefault();
        evt.stopPropagation();
        
        const propertyKey = propertyEl.getAttribute('data-property-key');
        if (!propertyKey) return;
        
        const isHidden = this.settings.hiddenProperties.includes(propertyKey);
        const isInTempView = this.settings.temporaryHiddenProperties.includes(propertyKey);
        
        const menu = new Menu();
        
        menu.addItem(item => 
            item
                .setTitle(isHidden ? `Unhide property "${propertyKey}"` : `Hide property "${propertyKey}"`)
                .setIcon(isHidden ? "eye" : "eye-off")
                .onClick(async () => {
                    if (isHidden) {
                        this.settings.hiddenProperties.remove(propertyKey);
                        // إزالة من القائمة المؤقتة أيضاً
                        this.settings.temporaryHiddenProperties.remove(propertyKey);
                        new Notice(`Property "${propertyKey}" is now permanently visible`);
                    } else {
                        this.settings.hiddenProperties.push(propertyKey);
                        new Notice(`Property "${propertyKey}" is now hidden`);
                        
                        // When hiding, give user a moment before it disappears
                        this.editingProperties.add(propertyKey);
                        await this.saveSettings();
                        this.updateHiddenPropertiesCSS();
                        
                        // Remove from editing set after a delay
                        setTimeout(() => {
                            this.editingProperties.delete(propertyKey);
                            this.updateHiddenPropertiesCSS();
                        }, 3000); // 3 seconds to allow user to move mouse away
                    }
                    await this.saveSettings();
                    this.updateHiddenPropertiesCSS();
                })
        );
        
        if (isHidden) {
            menu.addItem(item =>
                item
                    .setTitle(isInTempView ? `Remove from temporary view` : `Add to temporary view`)
                    .setIcon(isInTempView ? "square-dashed-mouse-pointer" : "square-dashed-mouse-pointer")
                    .onClick(async () => {
                        if (isInTempView) {
                            this.settings.temporaryHiddenProperties.remove(propertyKey);
                            new Notice(`"${propertyKey}" removed from temporary view`);
                        } else {
                            this.settings.temporaryHiddenProperties.push(propertyKey);
                            new Notice(`"${propertyKey}" added to temporary view`);
                        }
                        await this.saveSettings();
                    })
            );
        }
        
        menu.addSeparator();
        
        menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
    }
    
    setupPropertyEditListeners() {
        // Watch for property input focus/blur
        this.registerDomEvent(document, 'focusin', (evt) => {
            const input = evt.target;
            const propertyEl = input.closest('.metadata-property');
            if (propertyEl) {
                const propertyKey = propertyEl.getAttribute('data-property-key');
                if (propertyKey && this.settings.hiddenProperties.includes(propertyKey)) {
                    // User is editing a hidden property - keep it visible
                    this.editingProperties.add(propertyKey);
                    
                    // Clear any pending removal
                    if (this.propertyEditTimeout) {
                        clearTimeout(this.propertyEditTimeout);
                    }
                    
                    // Update CSS to show this property temporarily
                    this.updateHiddenPropertiesCSS();
                }
            }
        });
        
        this.registerDomEvent(document, 'focusout', (evt) => {
            const input = evt.target;
            const propertyEl = input.closest('.metadata-property');
            if (propertyEl) {
                const propertyKey = propertyEl.getAttribute('data-property-key');
                if (propertyKey && this.editingProperties.has(propertyKey)) {
                    // Delay removal to give user time to click elsewhere
                    this.propertyEditTimeout = setTimeout(() => {
                        this.editingProperties.delete(propertyKey);
                        this.updateHiddenPropertiesCSS();
                    }, 1000); // 1 second delay after editing
                }
            }
        });
    }

    // ============================================
    // Force UI Mode Implementation
    // ============================================
    
    async handleViewMode(file) {
        if (!file || !(file instanceof TFile)) return;
        
        // Wait for metadata cache to be ready
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const uiMode = fm?.[this.settings.uiProperty];
        if (!uiMode) return;
        
        // Find all leaves that have this file open and enforce UI mode
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView && leaf.view.file && leaf.view.file.path === file.path) {
                this.enforceUIModeForLeaf(leaf, uiMode);
            }
        });
    }
    
    async enforceUIModeForLeaf(leaf, uiMode) {
        const state = leaf.getViewState();
        const currentMode = state.state?.mode;
        
        let targetMode = null;
        let isForceMode = false;
        
        // Parse the UI mode
        if (uiMode === 'preview-force') {
            targetMode = 'preview';
            isForceMode = true;
        } else if (uiMode === 'edit-force') {
            targetMode = 'source'; // Obsidian uses 'source' for edit mode
            isForceMode = true;
        } else if (uiMode === 'preview') {
            targetMode = 'preview';
        } else if (uiMode === 'edit') {
            targetMode = 'source';
        }
        
        // If no target mode or already correct, return
        if (!targetMode || currentMode === targetMode) return;
        
        // Apply the mode change
        await leaf.setViewState({
            ...state,
            state: {
                ...state.state,
                mode: targetMode
            }
        });
        
        // If it's force mode, set up a watcher to enforce it
        if (isForceMode) {
            this.setupForceModeWatcher(leaf, uiMode);
        }
    }
    
    setupForceModeWatcher(leaf, uiMode) {
        const leafId = this.getLeafId(leaf);
        
        // Remove any existing watcher for this leaf
        if (this.forceModeWatchers.has(leafId)) {
            clearInterval(this.forceModeWatchers.get(leafId).interval);
            this.forceModeWatchers.delete(leafId);
        }
        
        // Parse the force mode
        let targetMode;
        if (uiMode === 'preview-force') {
            targetMode = 'preview';
        } else if (uiMode === 'edit-force') {
            targetMode = 'source';
        } else {
            return; // Not a force mode
        }
        
        // Create a watcher that checks and enforces the mode
        const watcher = {
            interval: setInterval(() => {
                if (!leaf.view || !(leaf.view instanceof MarkdownView)) {
                    this.removeForceModeWatcher(leafId);
                    return;
                }
                
                // Get current state
                const state = leaf.getViewState();
                const currentMode = state.state?.mode;
                
                // If mode changed, revert it immediately
                if (currentMode !== targetMode) {
                    console.log(`Force mode: Reverting from ${currentMode} to ${targetMode}`);
                    
                    // Immediately set back to target mode
                    leaf.setViewState({
                        ...state,
                        state: {
                            ...state.state,
                            mode: targetMode
                        }
                    }).catch(err => {
                        console.error('Error reverting force mode:', err);
                    });
                }
            }, 100), // Check every 100ms
            targetMode: targetMode
        };
        
        // Store watcher
        this.forceModeWatchers.set(leafId, watcher);
    }
    
    getLeafId(leaf) {
        return leaf.id || leaf.view?.file?.path || Math.random().toString(36).substr(2, 9);
    }
    
    removeForceModeWatcher(leafId) {
        if (this.forceModeWatchers.has(leafId)) {
            const watcher = this.forceModeWatchers.get(leafId);
            clearInterval(watcher.interval);
            this.forceModeWatchers.delete(leafId);
        }
    }

    // ============================================
    // باقي الوظائف الحالية (بدون تعديل)
    // ============================================

    // NEW: Improved cleanup with better duplicate detection
    cleanupDuplicates(file) {
        const filePath = file?.path;
        if (!filePath) return;
        
        // Track containers we've cleaned
        const cleanedContainers = new Set();
        
        // Find all relevant containers for this file
        const containers = [];
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === filePath) {
                const contentEl = leaf.view.contentEl;
                const scroller = contentEl.querySelector(".markdown-source-view > .cm-editor > .cm-scroller");
                const preview = contentEl.querySelector(".markdown-reading-view > .markdown-preview-view");
                if (scroller) containers.push(scroller);
                if (preview) containers.push(preview);
            }
        });
        
        // Remove duplicate icon wrappers
        containers.forEach(container => {
            if (cleanedContainers.has(container)) return;
            
            // Remove extra icon wrappers (keep only first)
            const iconWrappers = container.querySelectorAll(":scope > .icon-wrapper");
            if (iconWrappers.length > 1) {
                const firstWrapper = iconWrappers[0];
                for (let i = 1; i < iconWrappers.length; i++) {
                    // Check if it's actually a different icon or just a duplicate
                    const currentIcon = iconWrappers[i].getAttribute("data-icon");
                    const firstIcon = firstWrapper.getAttribute("data-icon");
                    if (currentIcon === firstIcon) {
                        iconWrappers[i].remove();
                    }
                }
            }
            
            // Remove extra banner images (keep only first)
            const bannerImages = container.querySelectorAll(":scope > .banner-image");
            if (bannerImages.length > 1) {
                const firstBanner = bannerImages[0];
                for (let i = 1; i < bannerImages.length; i++) {
                    const currentSrc = bannerImages[i].getAttribute("data-src");
                    const firstSrc = firstBanner.getAttribute("data-src");
                    if (currentSrc === firstSrc) {
                        bannerImages[i].remove();
                    }
                }
            }
            
            cleanedContainers.add(container);
        });
        
        // Clean up title icons too
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === filePath) {
                const contentEl = leaf.view.contentEl;
                const titleIcons = contentEl.querySelectorAll(".pp-title-icon");
                if (titleIcons.length > 1) {
                    const firstIcon = titleIcons[0];
                    const firstIconValue = firstIcon.getAttribute("data-icon");
                    for (let i = 1; i < titleIcons.length; i++) {
                        if (titleIcons[i].getAttribute("data-icon") === firstIconValue) {
                            titleIcons[i].remove();
                        }
                    }
                }
            }
        });
    }

    async initCache() {
        const data = await this.loadData();
        this.imageCache = data?.imageCache || {};
        this.cacheTimestamps = data?.cacheTimestamps || {};
        this.pendingFetches = new Map();
    }

    async saveCache() {
        await this.saveData({
            ...this.settings,
            imageCache: this.imageCache,
            cacheTimestamps: this.cacheTimestamps
        });
    }

    async clearImageCache() {
        this.imageCache = {};
        this.cacheTimestamps = {};
        this.pendingFetches.clear();
        this.renderedIcons.clear();
        this.iconRenderPromises.clear();
        await this.saveCache();
        this.debouncedUpdate();
    }

    async fetchAndCacheImage(url, sourcePath) {
        if (!url || !url.startsWith("http")) return url;
        
        const cacheKey = `${url}`;
        const now = Date.now();
        const expiryMs = this.settings.cacheExpiryDays * 24 * 60 * 60 * 1000;
        
        // Check if we have a valid cached version
        if (this.imageCache[cacheKey] && this.cacheTimestamps[cacheKey]) {
            const age = now - this.cacheTimestamps[cacheKey];
            if (age < expiryMs) {
                return this.imageCache[cacheKey];
            }
        }
        
        // Check for pending fetch
        if (this.pendingFetches.has(cacheKey)) {
            return await this.pendingFetches.get(cacheKey);
        }
        
        // Create new fetch promise
        const fetchPromise = (async () => {
            try {
                const response = await requestUrl({
                    url: url,
                    method: 'GET',
                    contentType: 'arraybuffer'
                });
                
                if (response.status >= 200 && response.status < 300) {
                    const contentType = response.headers['content-type'] || 'image/png';
                    const base64 = Buffer.from(response.arrayBuffer).toString('base64');
                    const dataUrl = `data:${contentType};base64,${base64}`;
                    
                    this.imageCache[cacheKey] = dataUrl;
                    this.cacheTimestamps[cacheKey] = now;
                    
                    await this.saveCache();
                    
                    return dataUrl;
                } else {
                    console.warn(`Failed to fetch image: ${response.status} ${url}`);
                    return this.imageCache[cacheKey] || url;
                }
            } catch (error) {
                console.error('Error fetching image:', error);
                return this.imageCache[cacheKey] || url;
            } finally {
                this.pendingFetches.delete(cacheKey);
            }
        })();
        
        this.pendingFetches.set(cacheKey, fetchPromise);
        return await fetchPromise;
    }

    async resolveLink(link, sourcePath) {
        if (!link) return "";
        
        if (link.startsWith("http")) {
            if (this.settings.enableCache) {
                return await this.fetchAndCacheImage(link, sourcePath);
            }
            return link;
        }
        
        // Handle local file paths
        const file = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
        return file ? this.app.vault.getResourcePath(file) : link;
    }

    async renderBanner(contentEl, containers, fm, sourcePath) {
        const bannerUrl = fm?.[this.settings.bannerProperty];
        if (!this.settings.enableBanner || !bannerUrl) {
            containers.forEach(c => c.querySelectorAll(":scope > .banner-image").forEach(el => el.remove()));
            contentEl.classList.remove("has-banner");
            return;
        }
        
        const bannerSrc = this.formatImageLink(bannerUrl);
        const bannerPos = fm[this.settings.bannerPositionProperty] || 50;

        for (const container of containers) {
            let bannerEl = container.querySelector(":scope > .banner-image");
            if (!bannerEl) {
                bannerEl = document.createElement("div");
                bannerEl.classList.add("banner-image");
                container.prepend(bannerEl);
            }
            
            // Only update if the source or position changed
            if (bannerEl.getAttribute("data-src") !== bannerSrc || bannerEl.getAttribute("data-pos") !== String(bannerPos)) {
                bannerEl.setAttribute("data-src", bannerSrc);
                bannerEl.setAttribute("data-pos", String(bannerPos));
                bannerEl.empty();
                
                try {
                    const img = document.createElement("img");
                    
                    // Resolve the image source
                    let imgSrc = bannerSrc;
                    if (bannerSrc.startsWith("http")) {
                        imgSrc = await this.resolveLink(bannerSrc, sourcePath);
                    } else if (!bannerSrc.startsWith("data:")) {
                        // It's a local file path
                        imgSrc = await this.resolveLink(bannerSrc, sourcePath);
                    }
                    
                    img.src = imgSrc;
                    img.style.objectPosition = `center ${bannerPos}%`;
                    img.onerror = () => {
                        console.warn(`Failed to load banner: ${bannerSrc}`);
                        bannerEl.style.display = "none";
                    };
                    img.onload = () => {
                        bannerEl.style.display = "";
                    };
                    
                    bannerEl.appendChild(img);
                } catch (error) {
                    console.error("Error rendering banner:", error);
                    bannerEl.remove();
                }
            }
        }
        
        contentEl.classList.add("has-banner");
    }

    // NEW: Improved processView with better error handling
    async processView(view) {
        const file = view.file;
        if (!file) return;
        
        try {
            // Wait a tiny bit to ensure DOM is ready
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Clean duplicates before processing
            this.cleanupDuplicates(file);
            
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            const contentEl = view.contentEl;

            // Find containers safely
            const scroller = contentEl.querySelector(".markdown-source-view > .cm-editor > .cm-scroller");
            const preview = contentEl.querySelector(".markdown-reading-view > .markdown-preview-view");
            const containers = [scroller, preview].filter(c => c !== null);

            // Clean up embed icons/banners
            contentEl.querySelectorAll(".markdown-embed .banner-image, .markdown-embed .icon-wrapper, .markdown-embed .pp-title-icon").forEach(el => el.remove());

            // Render banner and icon
            await this.renderBanner(contentEl, containers, fm, file.path);
            await this.renderIcon(contentEl, containers, fm, file.path);
        } catch (error) {
            console.error("Error processing view:", error);
        }
    }

    setupPropertyContextMenus() {
        document.querySelectorAll('.metadata-property:not([data-pp-has-listener])').forEach(propertyEl => {
            propertyEl.setAttribute('data-pp-has-listener', 'true');
            propertyEl.addEventListener('contextmenu', (evt) => this.handlePropertyContextMenu(evt, propertyEl));
        });
    }

    onunload() {
        // Clear all timeouts
        if (this.propertyEditTimeout) {
            clearTimeout(this.propertyEditTimeout);
        }
        
        // تنظيف جميع المهلات المؤقتة
        this.temporaryVisibleProps.forEach((data, filePath) => {
            if (data.timeout) {
                clearTimeout(data.timeout);
            }
        });
        this.temporaryVisibleProps.clear();
        
        // Clear icon rendering timeouts
        this.iconRenderTimeouts.forEach(timeout => clearTimeout(timeout));
        this.iconRenderTimeouts.clear();
        
        // Clear all force mode watchers
        this.forceModeWatchers.forEach((watcher, leafId) => {
            clearInterval(watcher.interval);
        });
        this.forceModeWatchers.clear();
        
        // Remove all added elements
        document.querySelectorAll(".banner-image, .icon-wrapper, .pp-title-icon, .pp-file-icon").forEach(el => el.remove());
        document.getElementById('pp-hidden-props')?.remove();
        
        // إزالة أزرار "Show Full Properties"
        document.querySelectorAll('.show-full-properties-btn').forEach(btn => btn.remove());
        
        // Restore original title wrappers
        document.querySelectorAll(".pp-title-wrapper").forEach(w => {
            const title = w.querySelector(".inline-title");
            if (title) w.parentNode.insertBefore(title, w);
            w.remove();
        });
        
        // Restore scrollbars
        document.body.classList.remove("hider-scroll");
        
        // Restore tab icons
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.tabHeaderEl) {
                const iconContainer = leaf.tabHeaderEl.querySelector(".workspace-tab-header-inner-icon");
                if (iconContainer) {
                    iconContainer.style.display = "";
                    setIcon(iconContainer, "lucide-file");
                }
                leaf.tabHeaderEl.removeAttribute("data-pp-icon");
                
                const customIcon = leaf.tabHeaderEl.querySelector(".pp-tab-icon");
                if (customIcon) customIcon.remove();
            }
        });
        
        // Clean up event listeners
        document.querySelectorAll('.metadata-property[data-pp-has-listener]').forEach(propertyEl => {
            propertyEl.removeAttribute('data-pp-has-listener');
        });
        
        // Clear tracking maps
        this.renderedIcons.clear();
        this.iconRenderPromises.clear();
        this.pendingIconRenders.clear();
    }

    updateAllViews() {
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView) {
                this.processView(leaf.view);
            }
        });
        this.updateTabIcons();
        if (this.settings.showFileExplorerIcons) this.updateFileExplorer();
    }

    updateTabIcons() {
        if (!this.settings.enableIcon) return;

        this.app.workspace.iterateAllLeaves((leaf) => {
            if (!(leaf.view instanceof MarkdownView) || !leaf.view.file) return;
            
            const file = leaf.view.file;
            const iconValue = this.app.metadataCache.getFileCache(file)?.frontmatter?.[this.settings.iconProperty];
            const tabEl = leaf.tabHeaderEl;
            if (!tabEl) return;

            const isStacked = tabEl.closest(".mod-stacked");

            if (isStacked) {
                const iconContainer = tabEl.querySelector(".workspace-tab-header-inner-icon");
                if (!iconContainer) return;

                if (iconValue) {
                    if (tabEl.getAttribute("data-pp-icon") !== iconValue) {
                        tabEl.setAttribute("data-pp-icon", iconValue);
                        this.appendIconContent(iconContainer, iconValue, file.path);
                    }
                } else {
                    if (tabEl.hasAttribute("data-pp-icon")) {
                        tabEl.removeAttribute("data-pp-icon");
                        setIcon(iconContainer, "lucide-file");
                    }
                }
            } else {
                const container = tabEl.querySelector(".workspace-tab-header-inner");
                if (!container) return;

                const defaultIcon = container.querySelector(".workspace-tab-header-inner-icon");
                let customIconEl = container.querySelector(".pp-tab-icon");

                if (iconValue) {
                    if (defaultIcon) defaultIcon.style.display = "none";

                    if (!customIconEl) {
                        customIconEl = document.createElement("div");
                        customIconEl.classList.add("pp-tab-icon");
                        const titleEl = container.querySelector(".workspace-tab-header-inner-title");
                        if (titleEl) container.insertBefore(customIconEl, titleEl);
                        else container.appendChild(customIconEl);
                    }

                    if (customIconEl.getAttribute("data-icon") !== iconValue) {
                        customIconEl.setAttribute("data-icon", iconValue);
                        this.appendIconContent(customIconEl, iconValue, file.path);
                    }
                } else {
                    if (customIconEl) customIconEl.remove();
                    if (defaultIcon) defaultIcon.style.display = "";
                }
            }
        });
    }

    updateScrollbarStyle() {
        document.body.classList.toggle("hider-scroll", this.settings.hideScrollbars);
    }

    // NEW: Improved renderIcon with better timing
    async renderIcon(contentEl, containers, fm, sourcePath) {
        const iconValue = fm?.[this.settings.iconProperty];
        const shouldRender = this.settings.enableIcon && iconValue;

        if (!shouldRender) {
            containers.forEach(c => c.querySelectorAll(":scope > .icon-wrapper").forEach(el => el.remove()));
            contentEl.querySelectorAll(".pp-title-icon").forEach(el => el.remove());
            return;
        }

        // Check if we're already rendering this icon
        const renderKey = `${sourcePath}-${iconValue}`;
        if (this.pendingIconRenders.has(renderKey)) {
            return; // Already processing
        }

        this.pendingIconRenders.add(renderKey);

        try {
            if (this.settings.iconInTitle) {
                containers.forEach(c => c.querySelectorAll(":scope > .icon-wrapper").forEach(el => el.remove()));
                await this.renderIconInTitle(contentEl, iconValue, sourcePath);
            } else {
                contentEl.querySelectorAll(".pp-title-icon").forEach(el => el.remove());
                await this.renderStandardIcon(containers, iconValue, sourcePath);
            }
        } catch (error) {
            console.error("Error rendering icon:", error);
        } finally {
            // Clean up after a delay to prevent immediate re-renders
            setTimeout(() => {
                this.pendingIconRenders.delete(renderKey);
            }, 100);
        }
    }

    async renderStandardIcon(containers, iconValue, sourcePath) {
        for (const container of containers) {
            let iconWrapper = container.querySelector(":scope > .icon-wrapper");
            if (!iconWrapper) {
                iconWrapper = document.createElement("div");
                iconWrapper.classList.add("icon-wrapper");
                const banner = container.querySelector(":scope > .banner-image");
                if (banner) banner.after(iconWrapper);
                else container.prepend(iconWrapper);
            }
            
            // Check if we need to update the icon
            if (iconWrapper.getAttribute("data-icon") !== iconValue) {
                iconWrapper.setAttribute("data-icon", iconValue);
                await this.appendIconContent(iconWrapper, iconValue, sourcePath, true);
            }
        }
    }

    async renderIconInTitle(contentEl, iconValue, sourcePath) {
        const inlineTitles = Array.from(contentEl.querySelectorAll(".inline-title")).filter(el => !el.closest(".markdown-embed"));
        
        for (const titleEl of inlineTitles) {
            let wrapper = titleEl.parentElement;
            if (!wrapper.classList.contains("pp-title-wrapper")) {
                wrapper = document.createElement("div");
                wrapper.classList.add("pp-title-wrapper");
                titleEl.parentNode.insertBefore(wrapper, titleEl);
                wrapper.appendChild(titleEl);
            }
            
            let iconEl = wrapper.querySelector(":scope > .pp-title-icon");
            if (!iconEl) {
                iconEl = document.createElement("span");
                iconEl.classList.add("pp-title-icon");
                wrapper.prepend(iconEl);
            }
            
            // Check if we need to update the icon
            if (iconEl.getAttribute("data-icon") !== iconValue) {
                iconEl.setAttribute("data-icon", iconValue);
                await this.appendIconContent(iconEl, iconValue, sourcePath);
            }
        }
    }

    updateFileExplorer() {
        if (!this.settings.showFileExplorerIcons) return;
        
        const fileExplorers = this.app.workspace.getLeavesOfType("file-explorer");
        fileExplorers.forEach(leaf => {
            const items = leaf.view.containerEl.querySelectorAll(".tree-item-self[data-path]");
            items.forEach(item => {
                const path = item.getAttribute("data-path");
                const file = this.app.vault.getAbstractFileByPath(path);
                let iconValue = null;
                let isFolder = false;
                
                if (file instanceof TFile) {
                    iconValue = this.app.metadataCache.getFileCache(file)?.frontmatter?.[this.settings.iconProperty];
                } else if (file instanceof TFolder) { 
                    iconValue = this.settings.folderIcons[file.path] || 'lucide-folder'; 
                    isFolder = true; 
                }
                
                this.renderFileExplorerIcon(item, iconValue, path, isFolder);
            });
        });
    }

    // NEW: Completely rewritten appendIconContent with robust error handling
    async appendIconContent(container, iconValue, sourcePath, isFloating = false) {
        if (!container || !iconValue) return;
        
        // Create a unique key for this render operation
        const renderKey = `${container.className}-${iconValue}-${sourcePath}-${Date.now()}`;
        
        // Check if we're already rendering this exact icon in this container
        if (this.iconRenderPromises.has(renderKey)) {
            return await this.iconRenderPromises.get(renderKey);
        }
        
        // Create a promise for this render operation
        const renderPromise = (async () => {
            try {
                // Clear existing content
                container.empty();
                
                // Create content container
                let contentContainer = isFloating ? container.createDiv({ cls: "icon-image" }) : container;
                
                // Try Lucide icon first
                const lucideIcon = getIcon(iconValue);
                if (lucideIcon) {
                    lucideIcon.classList.add("pp-svg-icon");
                    contentContainer.appendChild(lucideIcon);
                    return;
                }
                
                // Check if it's an emoji
                if (this.isEmoji(iconValue)) {
                    const emojiDiv = contentContainer.createDiv({ cls: "pp-text-icon" });
                    emojiDiv.innerText = iconValue;
                    return;
                }
                
                // It must be an image URL/path
                const formattedSrc = this.formatImageLink(iconValue);
                if (!formattedSrc) {
                    console.warn("Empty icon source:", iconValue);
                    return;
                }
                
                const img = document.createElement("img");
                img.alt = "Icon";
                
                try {
                    // Resolve the image source with timeout
                    let imgSrc;
                    if (formattedSrc.startsWith("http")) {
                        imgSrc = await Promise.race([
                            this.resolveLink(formattedSrc, sourcePath),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error("Image load timeout")), 5000)
                            )
                        ]);
                    } else if (formattedSrc.startsWith("data:")) {
                        imgSrc = formattedSrc;
                    } else {
                        // Local file path
                        imgSrc = await this.resolveLink(formattedSrc, sourcePath);
                    }
                    
                    img.src = imgSrc;
                    
                    // Set up error handling
                    img.onerror = () => {
                        console.warn(`Failed to load icon image: ${formattedSrc}`);
                        img.remove();
                        
                        // Try to show a fallback
                        const fallbackIcon = getIcon("lucide-file");
                        if (fallbackIcon) {
                            fallbackIcon.classList.add("pp-svg-icon");
                            contentContainer.appendChild(fallbackIcon);
                        }
                    };
                    
                    // Set up load handling
                    img.onload = () => {
                        // Success - image loaded
                        contentContainer.appendChild(img);
                    };
                    
                    // Add a timeout to handle images that never load or error
                    const loadTimeout = setTimeout(() => {
                        if (!img.parentElement) {
                            console.warn(`Icon image load timeout: ${formattedSrc}`);
                            img.remove();
                            
                            // Show fallback
                            const fallbackIcon = getIcon("lucide-file");
                            if (fallbackIcon) {
                                fallbackIcon.classList.add("pp-svg-icon");
                                contentContainer.appendChild(fallbackIcon);
                            }
                        }
                    }, 3000);
                    
                    // Store timeout for cleanup
                    this.iconRenderTimeouts.set(renderKey, loadTimeout);
                    
                } catch (error) {
                    console.error("Error resolving icon:", error);
                    // Show fallback icon
                    const fallbackIcon = getIcon("lucide-file");
                    if (fallbackIcon) {
                        fallbackIcon.classList.add("pp-svg-icon");
                        contentContainer.appendChild(fallbackIcon);
                    }
                }
                
            } catch (error) {
                console.error("Error in appendIconContent:", error);
            } finally {
                // Clean up
                this.iconRenderPromises.delete(renderKey);
                const timeout = this.iconRenderTimeouts.get(renderKey);
                if (timeout) {
                    clearTimeout(timeout);
                    this.iconRenderTimeouts.delete(renderKey);
                }
            }
        })();
        
        // Store the promise
        this.iconRenderPromises.set(renderKey, renderPromise);
        
        // Execute the render
        await renderPromise;
    }

    renderFileExplorerIcon(itemEl, iconValue, sourcePath, isFolder) {
        let iconEl = itemEl.querySelector(".pp-file-icon");
        
        // If no icon value and not a folder with default icon, remove existing icon
        if (!iconValue && !isFolder) { 
            if (iconEl) iconEl.remove(); 
            return; 
        }
        
        // For folders without custom icon, use default folder icon
        if (isFolder && !iconValue) {
            iconValue = 'lucide-folder';
        }
        
        if (!iconEl) {
            iconEl = document.createElement("div");
            iconEl.classList.add("pp-file-icon");
            if (isFolder) iconEl.classList.add("pp-folder-icon");
            const inner = itemEl.querySelector(".tree-item-inner");
            if (inner) itemEl.insertBefore(iconEl, inner);
            else itemEl.appendChild(iconEl);
        }
        
        // Check if we need to update
        if (iconEl.getAttribute("data-icon") !== iconValue) {
            iconEl.setAttribute("data-icon", iconValue || "");
            this.appendIconContent(iconEl, iconValue, sourcePath);
        }
    }

    formatImageLink(link) {
        if (!link || typeof link !== 'string') return "";
        // Remove wikilink brackets if present
        return link.replace(/^!?\[\[|\]\]$/g, "");
    }

    isEmoji(str) { 
        // Simple emoji detection
        const emojiRegex = /^\p{Emoji}$/u;
        return emojiRegex.test(str) && !str.includes(".") && !str.includes("/");
    }

    updateCssVariables() {
        const s = this.settings;
        const b = document.body;
        b.style.setProperty("--banner-height", s.bannerHeight + "px");
        b.style.setProperty("--banner-margin", s.bannerMargin + "px");
        b.style.setProperty("--banner-fading", s.bannerFading ? "linear-gradient(to bottom, black 25%, transparent)" : "none");
        b.style.setProperty("--pp-icon-size", s.iconSize + "px");
        b.style.setProperty("--pp-title-icon-size", s.iconSize + "px");
        b.style.setProperty("--pp-icon-top-margin", s.iconTopMargin + "px");
        b.style.setProperty("--pp-icon-top-margin-wb", s.iconTopMarginWithoutBanner + "px");
        b.style.setProperty("--pp-icon-gap", s.iconGap + "px");
        b.style.setProperty("--pp-banner-icon-gap", s.bannerIconGap + "px");
        b.style.setProperty("--pp-icon-left-margin", s.iconLeftMargin + "px");
    }

    async openDefaultNote() {
        if (!this.settings.defaultNotePath) {
            return;
        }
        
        // Wait a bit more for everything to initialize
        await new Promise(resolve => setTimeout(resolve, 800));
        
        const file = this.app.vault.getAbstractFileByPath(this.settings.defaultNotePath);
        if (!(file instanceof TFile)) {
            console.log("Default note file not found:", this.settings.defaultNotePath);
            return;
        }
        
        // Check if the default note is already open
        let defaultNoteLeaf = null;
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view && leaf.view.file && leaf.view.file.path === file.path) {
                defaultNoteLeaf = leaf;
            }
        });
        
        if (defaultNoteLeaf) {
            // Default note is already open, switch to that tab
            this.app.workspace.setActiveLeaf(defaultNoteLeaf);
            return;
        }
        
        // Check if there are any other files open
        let anyFileOpen = false;
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view && leaf.view.file && leaf.view.file.path !== file.path) {
                anyFileOpen = true;
            }
        });
        
        if (anyFileOpen) {
            // Try to open in the currently active leaf
            let activeLeaf = this.app.workspace.getLeaf();
            
            if (!activeLeaf || !(activeLeaf.view instanceof MarkdownView)) {
                const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
                if (markdownLeaves.length > 0) {
                    activeLeaf = markdownLeaves[0];
                }
            }
            
            if (activeLeaf) {
                try {
                    await activeLeaf.openFile(file);
                    this.app.workspace.setActiveLeaf(activeLeaf);
                    return;
                } catch (error) {
                    console.error("Error opening in existing leaf:", error);
                }
            }
        }
        
        // No files open or couldn't use existing leaf - open in new tab
        try {
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(file);
            this.app.workspace.setActiveLeaf(leaf);
        } catch (error) {
            console.error("Error opening default note:", error);
        }
    }

    async loadSettings() { 
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); 
        // تهيئة المتغيرات الجديدة إذا لم تكن موجودة
        if (!this.settings.temporaryHiddenProperties) {
            this.settings.temporaryHiddenProperties = [];
        }
        if (!this.settings.temporaryViewTimeout) {
            this.settings.temporaryViewTimeout = 60;
        }
    }
    
    async saveSettings() { 
        await this.saveData(this.settings); 
        this.updateCssVariables(); 
        this.updateHiddenPropertiesCSS(); 
        this.debouncedUpdate(); 
    }
};

// Keep all the modal classes the same as before...
// IconSuggestModal, BannerSuggestModal, BannerPositionModal, DefaultNoteSuggestModal

class IconSuggestModal extends SuggestModal {
    constructor(app, plugin, targetItem) { 
        super(app); 
        this.plugin = plugin; 
        this.targetItem = targetItem; 
        this.iconIds = getIconIds(); 
    }
    
    getSuggestions(query) { 
        // Always include the current query as a custom option
        const suggestions = this.iconIds.filter(icon => icon.toLowerCase().includes(query.toLowerCase()));
        
        // If query is not empty and not already in suggestions, add it as a custom option
        if (query && !suggestions.includes(query) && query.length > 0) {
            // Check if it's a link/emoji/custom text
            if (this.isCustomIcon(query)) {
                suggestions.unshift(`Custom: ${query}`);
            }
        }
        
        return suggestions;
    }
    
    isCustomIcon(value) {
        // Check if it's a URL
        if (value.startsWith("http") || value.startsWith("![[") || value.includes(".")) {
            return true;
        }
        // Check if it's an emoji
        if (/\p{Emoji}/u.test(value)) {
            return true;
        }
        // Allow any custom text
        return true;
    }
    
    renderSuggestion(item, el) {
        el.classList.add("pp-icon-suggestion");
        
        // Handle custom items
        if (item.startsWith("Custom: ")) {
            const customValue = item.substring(8); // Remove "Custom: " prefix
            el.createSpan({ text: "Custom icon", cls: "pp-icon-custom" });
            el.createSpan({ text: `"${customValue}"`, cls: "pp-icon-name" });
            return;
        }
        
        // Handle regular icon suggestions
        const iconSvg = getIcon(item);
        if (iconSvg) el.appendChild(iconSvg);
        el.createSpan({ text: item, cls: "pp-icon-name" });
    }
    
    onChooseSuggestion(item, evt) {
        let iconValue;
        
        // Extract custom value from "Custom: " prefix
        if (item.startsWith("Custom: ")) {
            iconValue = item.substring(8);
        } else {
            iconValue = item;
        }
        
        if (this.targetItem instanceof TFile) {
            this.app.fileManager.processFrontMatter(this.targetItem, (fm) => { 
                fm[this.plugin.settings.iconProperty] = iconValue; 
            });
        } else if (this.targetItem instanceof TFolder) { 
            this.plugin.settings.folderIcons[this.targetItem.path] = iconValue; 
            this.plugin.saveSettings(); 
        }
    }
}

class BannerSuggestModal extends SuggestModal {
    constructor(app, plugin, targetFile) { 
        super(app); 
        this.plugin = plugin; 
        this.targetFile = targetFile; 
    }
    
    getSuggestions(query) {
        const files = this.app.vault.getFiles();
        const ext = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"];
        
        const fileSuggestions = files.filter(f => 
            ext.includes(f.extension) && f.path.toLowerCase().includes(query.toLowerCase())
        );
        
        // Always include the current query as a custom option if it looks like a URL
        const suggestions = [...fileSuggestions];
        
        // If query is not empty and looks like a URL or image link, add it as a custom option
        if (query && query.length > 0 && this.isImageLink(query)) {
            suggestions.unshift(`Custom: ${query}`);
        }
        
        return suggestions;
    }
    
    isImageLink(value) {
        // Check if it's a URL
        if (value.startsWith("http") || value.startsWith("![[") || value.includes(".")) {
            return true;
        }
        return false;
    }
    
    renderSuggestion(item, el) {
        if (typeof item === 'string' && item.startsWith("Custom: ")) {
            const customValue = item.substring(8);
            el.createDiv({ text: "Custom image URL" });
            el.createDiv({ text: customValue, cls: "pp-suggestion-sub" });
        } else {
            el.createDiv({ text: item.name });
            el.createDiv({ text: item.path, cls: "pp-suggestion-sub" });
        }
    }
    
    onChooseSuggestion(item, evt) {
        let bannerValue;
        
        if (typeof item === 'string' && item.startsWith("Custom: ")) {
            const customValue = item.substring(8);
            // Format the value appropriately
            if (customValue.startsWith("http")) {
                bannerValue = customValue; // Direct URL
            } else if (customValue.includes(".") && !customValue.startsWith("[[")) {
                // If it looks like a file path but isn't a wikilink, wrap it
                bannerValue = `[[${customValue}]]`;
            } else {
                bannerValue = customValue; // Use as-is
            }
        } else {
            // Regular file selection
            bannerValue = `[[${item.path}]]`;
        }
        
        this.app.fileManager.processFrontMatter(this.targetFile, (fm) => { 
            fm[this.plugin.settings.bannerProperty] = bannerValue; 
        });
    }
}

class BannerPositionModal extends Modal {
    constructor(app, plugin, targetFile) {
        super(app);
        this.plugin = plugin;
        this.targetFile = targetFile;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        const fm = this.app.metadataCache.getFileCache(this.targetFile)?.frontmatter || {};
        const currentPos = fm[this.plugin.settings.bannerPositionProperty] || 50;
        
        const sliderContainer = contentEl.createDiv({ cls: "banner-position-slider" });
        const slider = sliderContainer.createEl("input", {
            type: "range",
            attr: { min: "0", max: "100", value: String(currentPos) }
        });
        
        const valueDisplay = sliderContainer.createEl("span", { 
            text: `${currentPos}%`,
            cls: "position-value"
        });
        
        slider.addEventListener("input", (e) => {
            const value = e.target.value;
            valueDisplay.textContent = `${value}%`;
        });
        
        slider.addEventListener("change", async (e) => {
            const value = parseInt(e.target.value);
            await this.app.fileManager.processFrontMatter(this.targetFile, (fm) => {
                fm[this.plugin.settings.bannerPositionProperty] = value;
            });
            this.plugin.debouncedUpdate();
            this.close();
        });
        
        // Add preset buttons
        const presets = contentEl.createDiv({ cls: "position-presets" });
        const positions = ["Top", "Center", "Bottom"];
        const values = [0, 50, 100];
        
        positions.forEach((label, index) => {
            const btn = presets.createEl("button", { text: label });
            btn.addEventListener("click", async () => {
                await this.app.fileManager.processFrontMatter(this.targetFile, (fm) => {
                    fm[this.plugin.settings.bannerPositionProperty] = values[index];
                });
                this.plugin.debouncedUpdate();
                this.close();
            });
        });
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class DefaultNoteSuggestModal extends SuggestModal {
    constructor(app, plugin, setting) {
        super(app);
        this.plugin = plugin;
        this.setting = setting;
    }
    
    getSuggestions(query) {
        // Get all markdown files
        const files = this.app.vault.getMarkdownFiles();
        
        if (!query) {
            return files.slice(0, 20); // Return first 20 files if no query
        }
        
        const queryLower = query.toLowerCase();
        return files.filter(file => 
            file.name.toLowerCase().includes(queryLower) || 
            file.path.toLowerCase().includes(queryLower)
        ).slice(0, 20); // Limit to 20 suggestions
    }
    
    renderSuggestion(file, el) {
        el.createDiv({ text: file.name });
        el.createDiv({ 
            text: file.path, 
            cls: "pp-suggestion-sub" 
        });
    }
    
    onChooseSuggestion(file) {
        this.plugin.settings.defaultNotePath = file.path;
        this.plugin.saveSettings();
        this.setting.settingEl.parentElement.querySelector('.setting-item-description').textContent = `Current: ${file.name}`;
        new Notice(`Set "${file.name}" as default note`);
        this.close();
    }
}

// ============================================
// تحديث فئة إعدادات البلاگين مع أيقونة square-dashed-mouse-pointer
// ============================================

class StyleshVaultSettingTab extends PluginSettingTab {
    constructor(app, plugin) { 
        super(app, plugin); 
        this.plugin = plugin; 
    }
    
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Banners" });
        new Setting(containerEl).setName("Enable Banners").addToggle(t => t.setValue(this.plugin.settings.enableBanner).onChange(async v => { this.plugin.settings.enableBanner = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName("Banner Height").addText(t => t.setValue(String(this.plugin.settings.bannerHeight)).onChange(async v => { this.plugin.settings.bannerHeight = Number(v); await this.plugin.saveSettings(); }));
        
        containerEl.createEl("h2", { text: "Icons" });
        new Setting(containerEl).setName("Enable Icons").addToggle(t => t.setValue(this.plugin.settings.enableIcon).onChange(async v => { this.plugin.settings.enableIcon = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName("Icon Size").addText(t => t.setValue(String(this.plugin.settings.iconSize)).onChange(async v => { this.plugin.settings.iconSize = Number(v); await this.plugin.saveSettings(); }));

        containerEl.createEl("h2", { text: "Image Cache" });
        new Setting(containerEl)
            .setName("Enable Image Cache")
            .setDesc("Cache remote images locally for offline access")
            .addToggle(t => t.setValue(this.plugin.settings.enableCache).onChange(async v => { 
                this.plugin.settings.enableCache = v; 
                await this.plugin.saveSettings(); 
            }));
        new Setting(containerEl)
            .setName("Cache Expiry Days")
            .setDesc("How many days to keep cached images")
            .addText(t => t.setValue(String(this.plugin.settings.cacheExpiryDays)).onChange(async v => { 
                this.plugin.settings.cacheExpiryDays = Number(v); 
                await this.plugin.saveSettings(); 
            }));
        
        containerEl.createEl("h2", { text: "UI Mode" });
        new Setting(containerEl)
            .setName("UI Mode Property Key")
            .setDesc("Frontmatter key to force 'edit' or 'preview' mode. Use 'preview-force' or 'edit-force' to prevent user from changing the mode.")
            .addText(t => t.setValue(this.plugin.settings.uiProperty).onChange(async v => {
                this.plugin.settings.uiProperty = v;
                await this.plugin.saveSettings();
            }));
        
        containerEl.createEl("h2", { text: "hide scrollbar" });
        new Setting(containerEl)
            .setName("hide Scrollbars")
            .setDesc("enable to hide scrollbars")
            .addToggle(t => t
                .setValue(this.plugin.settings.hideScrollbars)
                .onChange(async v => {
                    this.plugin.settings.hideScrollbars = v;
                    await this.plugin.saveSettings();
                    this.plugin.updateScrollbarStyle();
                })
            );

        containerEl.createEl("h2", { text: "Default Note" });

        // Get current file name for display
        let currentNoteName = "None";
        if (this.plugin.settings.defaultNotePath) {
            const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.defaultNotePath);
            if (file) {
                currentNoteName = file.name;
            }
        }

        const defaultNoteSetting = new Setting(containerEl)
            .setName("Default Note")
            .setDesc(`Note that opens automatically when Obsidian starts (Current: ${currentNoteName})`)
            .addButton(btn => btn
                .setButtonText("Choose Note")
                .setCta()
                .onClick(() => {
                    new DefaultNoteSuggestModal(this.app, this.plugin, defaultNoteSetting).open();
                }))
            .addButton(btn => btn
                .setButtonText("Clear")
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.defaultNotePath = "";
                    await this.plugin.saveSettings();
                    defaultNoteSetting.settingEl.parentElement.querySelector('.setting-item-description').textContent = 
                        "Note that opens automatically when Obsidian starts (Current: None)";
                    new Notice("Default note cleared");
                }));
        
        containerEl.createEl("h2", { text: "Hidden Properties" });

        // إعداد المهلة الزمنية للعرض المؤقت
        new Setting(containerEl)
            .setName("Temporary View Timeout")
            .setDesc("How many seconds to show properties in temporary view")
            .addText(t => t
                .setValue(String(this.plugin.settings.temporaryViewTimeout))
                .onChange(async v => {
                    const seconds = parseInt(v);
                    if (!isNaN(seconds) && seconds > 0) {
                        this.plugin.settings.temporaryViewTimeout = seconds;
                        await this.plugin.saveSettings();
                    }
                }));

        // Create dropdown container
        const hiddenPropsContainer = containerEl.createDiv({ cls: "hidden-props-container" });

        // Create dropdown header
        const dropdownHeader = hiddenPropsContainer.createDiv({ cls: "hidden-props-dropdown-header" });
        dropdownHeader.createEl("h3", { text: "Hidden Properties" });

        const countSpan = dropdownHeader.createEl("span", { 
            cls: "hidden-props-count",
            text: `(${this.plugin.settings.hiddenProperties.length})`
        });

        const toggleIcon = dropdownHeader.createEl("span", { 
            cls: "hidden-props-toggle",
            text: "▼"
        });

        let isExpanded = false;
        const hiddenList = hiddenPropsContainer.createDiv({ cls: "hidden-props-list" });

        // Update dropdown content
        const updateHiddenList = () => {
            hiddenList.empty();
            
            if (this.plugin.settings.hiddenProperties.length === 0) {
                hiddenList.createEl("div", { 
                    text: "No hidden properties", 
                    cls: "hidden-props-empty" 
                });
            } else {
                this.plugin.settings.hiddenProperties.forEach(prop => {
                    const propItem = hiddenList.createDiv({ cls: "hidden-prop-item" });
                    
                    // Property name
                    propItem.createEl("span", { 
                        text: prop, 
                        cls: "hidden-prop-name" 
                    });
                    
                    // حاوية الأزرار
                    const buttonContainer = propItem.createDiv({ cls: "hidden-prop-buttons" });
                    
                    // الحصول على أيقونة square-dashed-mouse-pointer
                    const tempIcon = getIcon("square-dashed-mouse-pointer");
                    
                    // زر "Show in Temporary View" باستخدام أيقونة Lucide
                    const showInTempBtn = buttonContainer.createEl("button", {
                        cls: "hidden-prop-show-temp",
                        attr: { title: "Show this property in temporary view" }
                    });
                    
                    if (tempIcon) {
                        // استنساخ الأيقونة لمنع مشاكل التكرار
                        const clonedIcon = tempIcon.cloneNode(true);
                        showInTempBtn.appendChild(clonedIcon);
                    } else {
                        // fallback للنص
                        showInTempBtn.textContent = "T";
                    }
                    
                    // زر "Unhide" (×)
                    const removeBtn = buttonContainer.createEl("button", { 
                        cls: "hidden-prop-remove" 
                    });
                    removeBtn.innerHTML = "×";
                    removeBtn.title = "Unhide property permanently";
                    
                    // تحديث مظهر الزر إذا كانت الخاصية في القائمة المؤقتة
                    if (this.plugin.settings.temporaryHiddenProperties.includes(prop)) {
                        showInTempBtn.classList.add("is-active");
                        showInTempBtn.title = "Will show in temporary view";
                    }
                    
                    // معالجة النقر على زر "Show in Temporary View"
                    showInTempBtn.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        
                        if (!this.plugin.settings.temporaryHiddenProperties.includes(prop)) {
                            this.plugin.settings.temporaryHiddenProperties.push(prop);
                            await this.plugin.saveSettings();
                            
                            new Notice(`"${prop}" will appear in temporary view`);
                            
                            // تحديث مظهر الزر
                            showInTempBtn.classList.add("is-active");
                            showInTempBtn.title = "Will show in temporary view";
                        } else {
                            this.plugin.settings.temporaryHiddenProperties.remove(prop);
                            await this.plugin.saveSettings();
                            
                            new Notice(`"${prop}" removed from temporary view`);
                            
                            // إعادة تعيين مظهر الزر
                            showInTempBtn.classList.remove("is-active");
                            showInTempBtn.title = "Show this property in temporary view";
                        }
                    });
                    
                    // معالجة النقر على زر "Unhide"
                    removeBtn.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        
                        // إزالة من القائمة المخفية
                        this.plugin.settings.hiddenProperties.remove(prop);
                        
                        // إزالة من القائمة المؤقتة إن كانت موجودة
                        if (this.plugin.settings.temporaryHiddenProperties.includes(prop)) {
                            this.plugin.settings.temporaryHiddenProperties.remove(prop);
                        }
                        
                        await this.plugin.saveSettings();
                        
                        // تحديث الواجهة
                        updateHiddenList();
                        countSpan.textContent = `(${this.plugin.settings.hiddenProperties.length})`;
                        new Notice(`Property "${prop}" is now permanently visible`);
                    });
                });
            }
            
            // Update toggle icon
            toggleIcon.textContent = isExpanded ? "▲" : "▼";
        };

        // Initial update
        updateHiddenList();

        // Toggle dropdown
        dropdownHeader.addEventListener("click", () => {
            isExpanded = !isExpanded;
            if (isExpanded) {
                hiddenList.style.display = "block";
            } else {
                hiddenList.style.display = "none";
            }
            toggleIcon.textContent = isExpanded ? "▲" : "▼";
        });

        // Start with list collapsed
        hiddenList.style.display = "none";
    }
}