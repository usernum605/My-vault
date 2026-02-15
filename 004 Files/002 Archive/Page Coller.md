```css
/* Global Variables */
:root {
  /* Base Pen Colors */
  --pen-white: #edf1fc;
  --pen-gray: #5f5d58;
  --pen-black: #26241f;
  --pen-red: #e14a49;
  --pen-green: #15b64f;
  --pen-blue: #3f76ed;
  --pen-light-blue: #54b6f8;
  --pen-purple: #9b4ff0;

  --neutral-pen-black: #272727;
  --neutral-pen-black-trans: #27272722;

  /* Page Colors */
  --page-white: #edf1fc;
  --page-manila: #f3deaf;
  --page-blue: #3f76ed;
  --page-black: #0A0A0A;
  --grid-size: 32px;
}

/* Recolors images on the page with the current accent color. */
.recolor-images img {
  filter: var(--image-effect);
}

/* ---------------------------- Page Backgrounds ---------------------------- */
/* All Pages */
.page-manila,
.page-white,
.page-blueprint,
.page-black {
  --text-normal: var(--accent-color);
  --text-muted: var(--accent-color);
  --text-faint: var(--accent-color-trans);
  --h1-color: var(--accent-color);
  --h2-color: var(--accent-color);
  --h3-color: var(--accent-color);
  --h4-color: var(--accent-color);
  --h5-color: var(--accent-color);
  --h6-color: var(--accent-color);
  --link-color: var(--pen-blue);
  --link-color-hover: var(--pen-light-blue);
  --link-unresolved-color: var(--pen-red);

  --hr-color: var(--accent-color);
  --blockquote-border-color: var(--accent-color);
  --embed-border-left: 2px solid var(--accent-color);
  --collapse-icon-color-collapsed: var(--accent-color);
  --checkbox-color: var(--accent-color);
  --checkbox-marker-color: var(--page-color);
  --checkbox-color-hover: var(--accent-color-trans);
  --checkbox-border-color: var(--accent-color);
  --checklist-done-color: var(--accent-color);
  --list-marker-color: var(--accent-color);

  --interactive-accent: var(--accent-color);
  --metadata-label-text-color: var(--accent-color);
  --metadata-input-text-color: var(--accent-color);
  --tag-color: var(--accent-color);
  --tag-background: var(--accent-color-trans);
  --pill-cover-hover: color-mix(in srgb, var(--accent-color) 60%, transparent);
  --background-modifier-border-focus: var(--accent-color);
  --background-modifier-border: var(--accent-color-trans);
  --background-modifier-hover: color-mix(
    in srgb,
    var(--accent-color) 60%,
    transparent
  );

  color: var(--accent-color);
  background-color: var(--page-color);
  font-weight: bold;
}

/* ----------------------- Manila/Tan Page Background ----------------------- */
/* Defaults to Black Pen */
.page-manila {
  --page-color: var(--page-manila);
  --accent-color: var(--pen-black);
  --accent-color-trans: color-mix(
    in srgb,
    var(--accent-color) 15%,
    transparent
  );
  --image-effect: brightness(0) saturate(100%) invert(14%) sepia(19%)
    saturate(296%) hue-rotate(5deg) brightness(90%) contrast(96%);
  color-scheme: light;
}
.embed-manila img {
  background-color: var(--page-manila);
}

/* --------------------------- White Page Background ------------------------ */
/* Defaults to Black Pen */
.page-white {
  --page-color: var(--page-white);
  --accent-color: var(--neutral-pen-black);
  --accent-color-trans: color-mix(
    in srgb,
    var(--accent-color) 15%,
    transparent
  );
  --image-effect: brightness(0) saturate(100%) invert(14%) sepia(19%)
    saturate(296%) hue-rotate(5deg) brightness(90%) contrast(96%);
  color-scheme: light;
}
.embed-white img {
  background-color: var(--page-white);
}

/* -------------------------- Blueprint Styled Page ------------------------- */
/* Defaults to White Pen */
.page-blueprint {
  --page-color: var(--page-blue);
  --accent-color: var(--pen-white);
  --accent-color-trans: color-mix(
    in srgb,
    var(--accent-color) 15%,
    transparent
  );
  --image-effect: brightness(0) saturate(100%) invert(89%) sepia(1%)
    saturate(2714%) hue-rotate(196deg) brightness(107%) contrast(98%);
  color-scheme: dark;

  --link-color: color-mix(in srgb, var(--pen-light-blue) 60%, var(--pen-white));
  --link-color-hover: color-mix(
    in srgb,
    var(--pen-light-blue) 20%,
    var(--pen-white)
  );
}
.embed-blueprint img {
  background-color: var(--page-blue);
}

/* ---------------------------- Black Page Background ----------------------- */
/* Defaults to White Pen */
.page-black {
  --page-color: var(--page-black);
  --accent-color: var(--pen-white);
  --accent-color-trans: color-mix(
    in srgb,
    var(--accent-color) 15%,
    transparent
  );
  --image-effect: brightness(0) saturate(100%) invert(89%) sepia(1%)
    saturate(2714%) hue-rotate(196deg) brightness(107%) contrast(98%);
  color-scheme: dark;

  --link-color: color-mix(in srgb, var(--pen-light-blue) 60%, var(--pen-white));
  --link-color-hover: color-mix(
    in srgb,
    var(--pen-light-blue) 20%,
    var(--pen-white)
  );
}
.embed-black img {
  background-color: var(--page-black);
}

/* Adds a grid layout on page background */
.page-grid {
  background-image: linear-gradient(
      0deg,
      transparent 0px,
      var(--accent-color-trans) 1px,
      var(--accent-color-trans) 2px,
      transparent 3px
    ),
    linear-gradient(
      90deg,
      transparent calc(var(--grid-size) - 3px),
      var(--accent-color-trans) calc(var(--grid-size) - 2px),
      var(--accent-color-trans) calc(var(--grid-size) - 1px),
      transparent var(--grid-size)
    );
  background-size: var(--grid-size) var(--grid-size);
}

/* ------------------------------- Pen Colors ------------------------------- */
/* Image Effects generated with:
    https://angel-rs.github.io/css-color-filter-generator */

/* SVGs */
:is(
    .page-white,
    .page-manila,
    .page-blueprint,
    .page-black,
    .pen-white,
    .pen-blue,
    .pen-red,
    .pen-green,
    .pen-black,
    .pen-gray,
    .pen-purple
  )
  svg {
  color: color-mix(in srgb, var(--accent-color) 60%, transparent);
}

/* Code Blocks */
:is(.page-white, .page-manila, .page-blueprint, .page-black) :is(code,
.HyperMD-codeblock, .cm-inline-code) {
  --code-normal: var(--accent-color);
  --code-background: color-mix(
    in srgb,
    var(--page-color) 80%,
    black
  ) !important;
}
div > pre {
  --code-background: color-mix(
    in srgb,
    var(--page-color) 80%,
    black
  ) !important;
}

:is(.page-white, .page-manila, .page-blueprint, .page-black) {
  --metadata-input-background-active: var(--accent-color-trans);
}

/* ------------------------------- Pen Colors ------------------------------- */

.pen-white {
  --accent-color: var(--pen-white);
  --accent-color-trans: color-mix(in srgb, var(--pen-white) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
  --image-effect: brightness(0) saturate(100%) invert(89%) sepia(1%)
    saturate(2714%) hue-rotate(196deg) brightness(107%) contrast(98%);
}
.pen-blue {
  --accent-color: var(--pen-blue);
  --accent-color-trans: color-mix(in srgb, var(--pen-blue) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
  --image-effect: brightness(0) saturate(100%) invert(36%) sepia(95%)
    saturate(945%) hue-rotate(199deg) brightness(95%) contrast(95%);
}
.pen-red {
  --accent-color: var(--pen-red);
  --accent-color-trans: color-mix(in srgb, var(--pen-red) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
  --image-effect: brightness(0) saturate(100%) invert(40%) sepia(41%)
    saturate(1024%) hue-rotate(316deg) brightness(99%) contrast(94%);
}
.pen-green {
  --accent-color: var(--pen-green);
  --accent-color-trans: color-mix(in srgb, var(--pen-green) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
  --image-effect: brightness(0) saturate(100%) invert(52%) sepia(60%)
    saturate(2521%) hue-rotate(105deg) brightness(96%) contrast(84%);
}
.pen-black {
  --accent-color: var(--pen-black);
  --accent-color-trans: color-mix(in srgb, var(--pen-black) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
  --image-effect: brightness(0) saturate(100%) invert(14%) sepia(19%)
    saturate(296%) hue-rotate(5deg) brightness(90%) contrast(96%);
}
.pen-gray {
  --accent-color: var(--pen-gray);
  --accent-color-trans: color-mix(in srgb, var(--pen-gray) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
  --image-effect: brightness(0) saturate(100%) invert(35%) sepia(13%)
    saturate(189%) hue-rotate(5deg) brightness(96%) contrast(86%);
}
.pen-purple {
  --accent-color: var(--pen-purple);
  --accent-color-trans: color-mix(in srgb, var(--pen-purple) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
  --image-effect: brightness(0) saturate(100%) invert(33%) sepia(59%)
    saturate(2620%) hue-rotate(249deg) brightness(98%) contrast(93%);
}
```
edited code:
```css
/* Global Variables */
:root {
  /* Base Pen Colors */
  --pen-white: #edf1fc;
  --pen-gray: #5f5d58;
  --pen-black: #26241f;
  --pen-red: #e14a49;
  --pen-green: #15b64f;
  --pen-blue: #3f76ed;
  --pen-light-blue: #54b6f8;
  --pen-purple: #9b4ff0;

  --neutral-pen-black: #272727;
  --neutral-pen-black-trans: #27272722;

  /* Page Colors */
  --page-white: #edf1fc;
  --page-manila: #f3deaf;
  --page-blue: #3f76ed;
  --page-black: #0A0A0A;
  --grid-size: 32px;
}

/* ================== ENHANCED IMAGE RECOLORING ================== */
/* Apply to ALL container elements with the recolor-images class */
.recolor-images,
.recolor-images .markdown-preview-view,
.recolor-images .markdown-reading-view {
  /* This ensures the class propagates */
}

/* Target images in various contexts */
.recolor-images img,
.recolor-images .image-embed img,
.recolor-images .internal-embed img,
.recolor-images .markdown-embed img {
  transition: filter 0.3s ease;
}

/* Special handling for blockquote images */
.recolor-images blockquote img {
  filter: inherit;
}

/* ================== PAGE-SPECIFIC IMAGE EFFECTS ================== */
/* Black page with recolor-images */
.page-black.recolor-images,
body:has(.page-black.recolor-images) {
  /* Apply to all images in black page */
  img:not([src*=".svg"]):not([src*="#icon"]):not([src*="data:image/svg+xml"]) {
    filter: 
      brightness(0.85) 
      contrast(1.1) 
      sepia(0.3) 
      saturate(1.2)
      hue-rotate(var(--hue-rotate, 0deg));
  }
}

/* Apply different hue rotations based on pen color */
.pen-red.page-black.recolor-images img:not([src*=".svg"]):not([src*="#icon"]):not([src*="data:image/svg+xml"]),
.page-black.recolor-images.pen-red img:not([src*=".svg"]):not([src*="#icon"]):not([src*="data:image/svg+xml"]) {
  filter: 
    brightness(0.85) 
    contrast(1.1) 
    sepia(0.5) 
    saturate(1.4)
    hue-rotate(340deg)
    opacity(0.9);
}

.pen-blue.page-black.recolor-images img:not([src*=".svg"]):not([src*="#icon"]):not([src*="data:image/svg+xml"]) {
  filter: 
    brightness(0.9) 
    contrast(1.05) 
    sepia(0.3) 
    saturate(1.3)
    hue-rotate(190deg);
}

.pen-green.page-black.recolor-images img:not([src*=".svg"]):not([src*="#icon"]):not([src*="data:image/svg+xml"]) {
  filter: 
    brightness(0.9) 
    contrast(1.05) 
    sepia(0.4) 
    saturate(1.3)
    hue-rotate(90deg);
}

/* For SVG/icon graphics - keep original complex filter */
.recolor-images img[src*=".svg"],
.recolor-images img[src$="#icon"],
.recolor-images img[src*="data:image/svg+xml"] {
  filter: var(--image-effect, none);
}


.page-black.recolor-images.pen-red::before {
  content: "✓ Page classes active: page-black recolor-images pen-red";
  position: fixed;
  top: 10px;
  right: 10px;
  background: var(--pen-red);
  color: white;
  padding: 5px 10px;
  border-radius: 5px;
  font-size: 12px;
  z-index: 9999;
  display: none; /* Change to 'block' for debugging */
}

/* ================== PAGE BACKGROUNDS ================== */
/* All Pages */
.page-manila,
.page-white,
.page-blueprint,
.page-black {
  --text-normal: var(--accent-color);
  --text-muted: var(--accent-color);
  --text-faint: var(--accent-color-trans);
  --h1-color: var(--accent-color);
  --h2-color: var(--accent-color);
  --h3-color: var(--accent-color);
  --h4-color: var(--accent-color);
  --h5-color: var(--accent-color);
  --h6-color: var(--accent-color);
  --link-color: var(--pen-blue);
  --link-color-hover: var(--pen-light-blue);
  --link-unresolved-color: var(--pen-red);

  --hr-color: var(--accent-color);
  --blockquote-border-color: var(--accent-color);
  --embed-border-left: 2px solid var(--accent-color);
  --collapse-icon-color-collapsed: var(--accent-color);
  --checkbox-color: var(--accent-color);
  --checkbox-marker-color: var(--page-color);
  --checkbox-color-hover: var(--accent-color-trans);
  --checkbox-border-color: var(--accent-color);
  --checklist-done-color: var(--accent-color);
  --list-marker-color: var(--accent-color);

  --interactive-accent: var(--accent-color);
  --metadata-label-text-color: var(--accent-color);
  --metadata-input-text-color: var(--accent-color);
  --tag-color: var(--accent-color);
  --tag-background: var(--accent-color-trans);
  --pill-cover-hover: color-mix(in srgb, var(--accent-color) 60%, transparent);
  --background-modifier-border-focus: var(--accent-color);
  --background-modifier-border: var(--accent-color-trans);
  --background-modifier-hover: color-mix(
    in srgb,
    var(--accent-color) 60%,
    transparent
  );

  color: var(--accent-color);
  background-color: var(--page-color);
  font-weight: bold;
}

/* Manila/Tan Page Background */
.page-manila {
  --page-color: var(--page-manila);
  --accent-color: var(--pen-black);
  --accent-color-trans: color-mix(in srgb, var(--accent-color) 15%, transparent);
  --image-effect: brightness(0) saturate(100%) invert(14%) sepia(19%)
    saturate(296%) hue-rotate(5deg) brightness(90%) contrast(96%);
  color-scheme: light;
}

/* White Page Background */
.page-white {
  --page-color: var(--page-white);
  --accent-color: var(--neutral-pen-black);
  --accent-color-trans: color-mix(in srgb, var(--accent-color) 15%, transparent);
  --image-effect: brightness(0) saturate(100%) invert(14%) sepia(19%)
    saturate(296%) hue-rotate(5deg) brightness(90%) contrast(96%);
  color-scheme: light;
}

/* Blueprint Styled Page */
.page-blueprint {
  --page-color: var(--page-blue);
  --accent-color: var(--pen-white);
  --accent-color-trans: color-mix(in srgb, var(--accent-color) 15%, transparent);
  --image-effect: brightness(0) saturate(100%) invert(89%) sepia(1%)
    saturate(2714%) hue-rotate(196deg) brightness(107%) contrast(98%);
  color-scheme: dark;
  --link-color: color-mix(in srgb, var(--pen-light-blue) 60%, var(--pen-white));
  --link-color-hover: color-mix(in srgb, var(--pen-light-blue) 20%, var(--pen-white));
}

/* Black Page Background */
.page-black {
  --page-color: var(--page-black);
  --accent-color: var(--pen-white);
  --accent-color-trans: color-mix(in srgb, var(--accent-color) 15%, transparent);
  --image-effect: brightness(0) saturate(100%) invert(89%) sepia(1%)
    saturate(2714%) hue-rotate(196deg) brightness(107%) contrast(98%);
  color-scheme: dark;
  --link-color: color-mix(in srgb, var(--pen-light-blue) 60%, var(--pen-white));
  --link-color-hover: color-mix(in srgb, var(--pen-light-blue) 20%, var(--pen-white));
}

/* Grid layout */
.page-grid {
  background-image: linear-gradient(0deg,
      transparent 0px,
      var(--accent-color-trans) 1px,
      var(--accent-color-trans) 2px,
      transparent 3px),
    linear-gradient(90deg,
      transparent calc(var(--grid-size) - 3px),
      var(--accent-color-trans) calc(var(--grid-size) - 2px),
      var(--accent-color-trans) calc(var(--grid-size) - 1px),
      transparent var(--grid-size));
  background-size: var(--grid-size) var(--grid-size);
}

/* ================== PEN COLORS ================== */
/* SVGs */
:is(.page-white, .page-manila, .page-blueprint, .page-black,
  .pen-white, .pen-blue, .pen-red, .pen-green,
  .pen-black, .pen-gray, .pen-purple) svg {
  color: color-mix(in srgb, var(--accent-color) 60%, transparent);
}

/* Code Blocks */
:is(.page-white, .page-manila, .page-blueprint, .page-black) :is(code, .HyperMD-codeblock, .cm-inline-code) {
  --code-normal: var(--accent-color);
  --code-background: color-mix(in srgb, var(--page-color) 80%, black) !important;
}

div>pre {
  --code-background: color-mix(in srgb, var(--page-color) 80%, black) !important;
}

:is(.page-white, .page-manila, .page-blueprint, .page-black) {
  --metadata-input-background-active: var(--accent-color-trans);
}

/* Pen Colors */
.pen-white {
  --accent-color: var(--pen-white);
  --accent-color-trans: color-mix(in srgb, var(--pen-white) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

.pen-blue {
  --accent-color: var(--pen-blue);
  --accent-color-trans: color-mix(in srgb, var(--pen-blue) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

.pen-red {
  --accent-color: var(--pen-red);
  --accent-color-trans: color-mix(in srgb, var(--pen-red) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

.pen-green {
  --accent-color: var(--pen-green);
  --accent-color-trans: color-mix(in srgb, var(--pen-green) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

.pen-black {
  --accent-color: var(--pen-black);
  --accent-color-trans: color-mix(in srgb, var(--pen-black) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

.pen-gray {
  --accent-color: var(--pen-gray);
  --accent-color-trans: color-mix(in srgb, var(--pen-gray) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

.pen-purple {
  --accent-color: var(--pen-purple);
  --accent-color-trans: color-mix(in srgb, var(--pen-purple) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

/* ================== FORCEFUL OVERRIDES ================== */
/* Use !important to override any conflicting styles */
.markdown-preview-view.page-black.recolor-images.pen-red img {
  filter: 
    brightness(0.85) 
    contrast(1.1) 
    sepia(0.5) 
    saturate(1.4)
    hue-rotate(340deg)
    opacity(0.9) !important;
}

/* Ensure blockquote images are targeted */
.markdown-preview-view.page-black.recolor-images.pen-red blockquote img,
.markdown-preview-view.page-black.recolor-images.pen-red .markdown-preview-section blockquote img {
  filter: 
    brightness(0.85) 
    contrast(1.1) 
    sepia(0.5) 
    saturate(1.4)
    hue-rotate(340deg)
    opacity(0.9) !important;
}

/* Make sure the page background applies */
.markdown-preview-view.page-black {
  background-color: var(--page-black) !important;
  color: var(--pen-white) !important;
}
/* Global Variables */
:root {
  /* Base Pen Colors */
  --pen-white: #edf1fc;
  --pen-gray: #5f5d58;
  --pen-black: #26241f;
  --pen-red: #e14a49;
  --pen-green: #15b64f;
  --pen-blue: #3f76ed;
  --pen-light-blue: #54b6f8;
  --pen-purple: #9b4ff0;

  --neutral-pen-black: #272727;
  --neutral-pen-black-trans: #27272722;

  /* Page Colors */
  --page-white: #edf1fc;
  --page-manila: #f3deaf;
  --page-blue: #3f76ed;
  --page-black: #0A0A0A;
  --grid-size: 32px;
}

/* ================== ENHANCED IMAGE RECOLORING ================== */
/* Apply to ALL container elements with the recolor-images class */
.recolor-images,
.recolor-images .markdown-preview-view,
.recolor-images .markdown-reading-view {
  /* This ensures the class propagates */
}

/* Target images in various contexts */
.recolor-images img,
.recolor-images .image-embed img,
.recolor-images .internal-embed img,
.recolor-images .markdown-embed img {
  transition: filter 0.3s ease;
}

/* Special handling for blockquote images */
.recolor-images blockquote img {
  filter: inherit;
}

/* ================== PAGE-SPECIFIC IMAGE EFFECTS ================== */
/* Black page with recolor-images */
.page-black.recolor-images,
body:has(.page-black.recolor-images) {
  /* Apply to all images in black page */
  img:not([src*=".svg"]):not([src*="#icon"]):not([src*="data:image/svg+xml"]) {
    filter: 
      brightness(0.85) 
      contrast(1.1) 
      sepia(0.3) 
      saturate(1.2)
      hue-rotate(var(--hue-rotate, 0deg));
  }
}

/* Apply different hue rotations based on pen color */
.pen-red.page-black.recolor-images img:not([src*=".svg"]):not([src*="#icon"]):not([src*="data:image/svg+xml"]),
.page-black.recolor-images.pen-red img:not([src*=".svg"]):not([src*="#icon"]):not([src*="data:image/svg+xml"]) {
  filter: 
    brightness(0.85) 
    contrast(1.1) 
    sepia(0.5) 
    saturate(1.4)
    hue-rotate(340deg)
    opacity(0.9);
}

.pen-blue.page-black.recolor-images img:not([src*=".svg"]):not([src*="#icon"]):not([src*="data:image/svg+xml"]) {
  filter: 
    brightness(0.9) 
    contrast(1.05) 
    sepia(0.3) 
    saturate(1.3)
    hue-rotate(190deg);
}

.pen-green.page-black.recolor-images img:not([src*=".svg"]):not([src*="#icon"]):not([src*="data:image/svg+xml"]) {
  filter: 
    brightness(0.9) 
    contrast(1.05) 
    sepia(0.4) 
    saturate(1.3)
    hue-rotate(90deg);
}

/* For SVG/icon graphics - keep original complex filter */
.recolor-images img[src*=".svg"],
.recolor-images img[src$="#icon"],
.recolor-images img[src*="data:image/svg+xml"] {
  filter: var(--image-effect, none);
}

/* ================== DEBUG/VERIFICATION STYLES ================== */
/* Add visual feedback to verify classes are applied */

.page-black.recolor-images.pen-red::before {
  content: "✓ Page classes active: page-black recolor-images pen-red";
  position: fixed;
  top: 10px;
  right: 10px;
  background: var(--pen-red);
  color: white;
  padding: 5px 10px;
  border-radius: 5px;
  font-size: 12px;
  z-index: 9999;
  display: none; /* Change to 'block' for debugging */
}

/* ================== PAGE BACKGROUNDS ================== */
/* All Pages */
.page-manila,
.page-white,
.page-blueprint,
.page-black {
  --text-normal: var(--accent-color);
  --text-muted: var(--accent-color);
  --text-faint: var(--accent-color-trans);
  --h1-color: var(--accent-color);
  --h2-color: var(--accent-color);
  --h3-color: var(--accent-color);
  --h4-color: var(--accent-color);
  --h5-color: var(--accent-color);
  --h6-color: var(--accent-color);
  --link-color: var(--pen-blue);
  --link-color-hover: var(--pen-light-blue);
  --link-unresolved-color: var(--pen-red);

  --hr-color: var(--accent-color);
  --blockquote-border-color: var(--accent-color);
  --embed-border-left: 2px solid var(--accent-color);
  --collapse-icon-color-collapsed: var(--accent-color);
  --checkbox-color: var(--accent-color);
  --checkbox-marker-color: var(--page-color);
  --checkbox-color-hover: var(--accent-color-trans);
  --checkbox-border-color: var(--accent-color);
  --checklist-done-color: var(--accent-color);
  --list-marker-color: var(--accent-color);

  --interactive-accent: var(--accent-color);
  --metadata-label-text-color: var(--accent-color);
  --metadata-input-text-color: var(--accent-color);
  --tag-color: var(--accent-color);
  --tag-background: var(--accent-color-trans);
  --pill-cover-hover: color-mix(in srgb, var(--accent-color) 60%, transparent);
  --background-modifier-border-focus: var(--accent-color);
  --background-modifier-border: var(--accent-color-trans);
  --background-modifier-hover: color-mix(
    in srgb,
    var(--accent-color) 60%,
    transparent
  );

  color: var(--accent-color);
  background-color: var(--page-color);
  font-weight: bold;
}

/* Manila/Tan Page Background */
.page-manila {
  --page-color: var(--page-manila);
  --accent-color: var(--pen-black);
  --accent-color-trans: color-mix(in srgb, var(--accent-color) 15%, transparent);
  --image-effect: brightness(0) saturate(100%) invert(14%) sepia(19%)
    saturate(296%) hue-rotate(5deg) brightness(90%) contrast(96%);
  color-scheme: light;
}

/* White Page Background */
.page-white {
  --page-color: var(--page-white);
  --accent-color: var(--neutral-pen-black);
  --accent-color-trans: color-mix(in srgb, var(--accent-color) 15%, transparent);
  --image-effect: brightness(0) saturate(100%) invert(14%) sepia(19%)
    saturate(296%) hue-rotate(5deg) brightness(90%) contrast(96%);
  color-scheme: light;
}

/* Blueprint Styled Page */
.page-blueprint {
  --page-color: var(--page-blue);
  --accent-color: var(--pen-white);
  --accent-color-trans: color-mix(in srgb, var(--accent-color) 15%, transparent);
  --image-effect: brightness(0) saturate(100%) invert(89%) sepia(1%)
    saturate(2714%) hue-rotate(196deg) brightness(107%) contrast(98%);
  color-scheme: dark;
  --link-color: color-mix(in srgb, var(--pen-light-blue) 60%, var(--pen-white));
  --link-color-hover: color-mix(in srgb, var(--pen-light-blue) 20%, var(--pen-white));
}

/* Black Page Background */
.page-black {
  --page-color: var(--page-black);
  --accent-color: var(--pen-white);
  --accent-color-trans: color-mix(in srgb, var(--accent-color) 15%, transparent);
  --image-effect: brightness(0) saturate(100%) invert(89%) sepia(1%)
    saturate(2714%) hue-rotate(196deg) brightness(107%) contrast(98%);
  color-scheme: dark;
  --link-color: color-mix(in srgb, var(--pen-light-blue) 60%, var(--pen-white));
  --link-color-hover: color-mix(in srgb, var(--pen-light-blue) 20%, var(--pen-white));
}

/* Grid layout */
.page-grid {
  background-image: linear-gradient(0deg,
      transparent 0px,
      var(--accent-color-trans) 1px,
      var(--accent-color-trans) 2px,
      transparent 3px),
    linear-gradient(90deg,
      transparent calc(var(--grid-size) - 3px),
      var(--accent-color-trans) calc(var(--grid-size) - 2px),
      var(--accent-color-trans) calc(var(--grid-size) - 1px),
      transparent var(--grid-size));
  background-size: var(--grid-size) var(--grid-size);
}

/* ================== PEN COLORS ================== */
/* SVGs */
:is(.page-white, .page-manila, .page-blueprint, .page-black,
  .pen-white, .pen-blue, .pen-red, .pen-green,
  .pen-black, .pen-gray, .pen-purple) svg {
  color: color-mix(in srgb, var(--accent-color) 60%, transparent);
}

/* Code Blocks */
:is(.page-white, .page-manila, .page-blueprint, .page-black) :is(code, .HyperMD-codeblock, .cm-inline-code) {
  --code-normal: var(--accent-color);
  --code-background: color-mix(in srgb, var(--page-color) 80%, black) !important;
}

div>pre {
  --code-background: color-mix(in srgb, var(--page-color) 80%, black) !important;
}

:is(.page-white, .page-manila, .page-blueprint, .page-black) {
  --metadata-input-background-active: var(--accent-color-trans);
}

/* Pen Colors */
.pen-white {
  --accent-color: var(--pen-white);
  --accent-color-trans: color-mix(in srgb, var(--pen-white) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

.pen-blue {
  --accent-color: var(--pen-blue);
  --accent-color-trans: color-mix(in srgb, var(--pen-blue) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

.pen-red {
  --accent-color: var(--pen-red);
  --accent-color-trans: color-mix(in srgb, var(--pen-red) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

.pen-green {
  --accent-color: var(--pen-green);
  --accent-color-trans: color-mix(in srgb, var(--pen-green) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

.pen-black {
  --accent-color: var(--pen-black);
  --accent-color-trans: color-mix(in srgb, var(--pen-black) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

.pen-gray {
  --accent-color: var(--pen-gray);
  --accent-color-trans: color-mix(in srgb, var(--pen-gray) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

.pen-purple {
  --accent-color: var(--pen-purple);
  --accent-color-trans: color-mix(in srgb, var(--pen-purple) 15%, transparent);
  color: var(--accent-color);
  --hr-color: var(--accent-color);
}

/* ================== FORCEFUL OVERRIDES ================== */
/* Use !important to override any conflicting styles */
.markdown-preview-view.page-black.recolor-images.pen-red img {
  filter: 
    brightness(0.85) 
    contrast(1.1) 
    sepia(0.5) 
    saturate(1.4)
    hue-rotate(340deg)
    opacity(0.9) !important;
}

/* Ensure blockquote images are targeted */
.markdown-preview-view.page-black.recolor-images.pen-red blockquote img,
.markdown-preview-view.page-black.recolor-images.pen-red .markdown-preview-section blockquote img {
  filter: 
    brightness(0.85) 
    contrast(1.1) 
    sepia(0.5) 
    saturate(1.4)
    hue-rotate(340deg)
    opacity(0.9) !important;
}

/* Make sure the page background applies */
.markdown-preview-view.page-black {
  background-color: var(--page-black) !important;
  color: var(--pen-white) !important;
}
```