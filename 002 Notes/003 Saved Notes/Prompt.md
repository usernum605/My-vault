---
icon: lucide-notebook-pen
banner: https://images.unsplash.com/photo-1517842645767-c639042777db?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8bm90ZXN8ZW58MHx8MHx8fDA%3D
cssclasses:
  - card
---
# prompt 1

**Subject: Comprehensive Rebuild of the Obsidian Stylesh Vault Plugin for Stability and Performance**

"I am developing an Obsidian plugin that displays a banner and an icon based on file properties (YAML). The current code (attached) suffers from fundamental issues with performance, element duplication, and memory leaks.

Your task is to completely rebuild the code according to the following technical standards:

1.  **Events & Lifecycle Engineering:**
    *   **Prevent Memory Leaks:** All events must be registered exclusively via `this.registerEvent` and `this.registerMarkdownPostProcessor`.
    *   **`setTimeout` Alternative:** Completely eliminate `setTimeout` functions. Use `this.app.workspace.onLayoutReady()` to ensure the UI is ready, and use `MutationObserver` only if necessary to monitor specific elements.
    *   **Component Management:** Link the banner and icon to a class that inherits from `Component` to ensure `unload()` is called and the DOM is cleaned up when a note is closed or switched.

2.  **UI Rendering (Live Preview & Reading Mode):**
    *   **Live Preview (Editor Extensions System):** Use `StateField` and `ViewPlugin` from the `@codemirror/view` library. The banner and icon must be injected as `Decoration.widget` to be part of the page flow in CodeMirror 6. This prevents elements from disappearing on scroll.
    *   **Reading Mode:** Use `registerMarkdownPostProcessor` to inject elements at the beginning of `el`.
    *   **Prevent Duplication:** Use unique identifiers (IDs) for each injected element, and check for the element's existence based on `TFile.path` before creating it.

3.  **Data and Image Processing (Performance):**
    *   **Metadata Cache:** Do not traverse the DOM to find properties. Use `this.app.metadataCache.getFileCache(file)` to get values instantly.
    *   **Image Optimization:** Add `img.loading = "lazy"` property for banners, and implement a simple `Map` system to cache external image links to avoid re-downloading them with every note switch.

4.  **Property Control (Hidden Properties):**
    *   Instead of manual hiding via CSS, use `this.app.metadataTypeManager` (if possible) or implement a custom `property-render` to programmatically hide `banner` and `icon` properties from Obsidian's official properties interface to ensure compatibility with future updates.

5.  **Design and Structure (CSS & Layout):**
    *   **Normal Flow:** Make the banner appear as a block element that naturally pushes content downwards. Do not use `position: absolute` except for the icon if it overlaps with the banner.
    *   **Compatibility:** Use official Obsidian CSS variables (e.g., `--file-line-width`) to ensure the banner follows the line width specified in user settings (Readable line length)."
6. Improving the icon rendering system (Persistence):
Problem: Currently, the icon is deleted and rebuilt with every switch between read and edit mode, which consumes device resources.
The solution required: I want to use a Cached View. Instead of re-rendering, have the plugin check if the icon is already in the View Container when switching.
Use Map to store the icon state for each open file (TFile.path). If the modes are switched for the same file, re-attach the existing icon element instead of destroying and recreating it.
The icon is deleted and its resources released only when a tab onclose event occurs or the active file changes.
What's required now: Give me the complete code with all the improvements and features, without the /* continuing as in the previous code. I want a complete, integrated code.

# prompt 2

do you know what modification I liked most that you made? The icon rendering system in File Explorer is thousands of times better than the original code. However, I didn't like your other modifications at all; you removed many good old features So give me the old code as it was, but only replace the part that displays the icons in the file explorer.