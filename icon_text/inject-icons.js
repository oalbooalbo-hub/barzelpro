#!/usr/bin/env node
/**
 * inject-icons.js — BARZELPRO Tab Icon Injector
 *
 * Reads SVG files from the ui_icons/ folder and inlines them into
 * the tab buttons in index.html. Replaces stroke/fill colors with
 * currentColor so icons respond to active/inactive CSS states.
 *
 * Usage:
 *   node inject-icons.js
 *   node inject-icons.js --html ./index.html
 *   node inject-icons.js --icons ./ui_icons
 *   node inject-icons.js --dry-run
 *
 * Place your SVG files in the ui_icons/ folder:
 *   ui_icons/home_icon.svg      → Today tab
 *   ui_icons/workouts_icon.svg  → Workouts tab
 *   ui_icons/dumbbell_icon.svg  → Exercises tab
 */

const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

// Maps SVG filename → tab button id
const ICON_MAP = {
  'home_icon.svg':      'tab-log-btn',
  'workouts_icon.svg':  'tab-workouts-btn',
  'dumbbell_icon.svg':  'tab-exercises-btn',
};

// Icon display size in the tab bar
const ICON_SIZE = '22';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const isDryRun = args.includes('--dry-run');

const HTML_PATH  = path.resolve(getArg('--html')  || './index.html');
const ICONS_PATH = path.resolve(getArg('--icons') || './ui_icons');

// ── Colors ────────────────────────────────────────────────────────────────────
const green  = '\x1b[32m';
const yellow = '\x1b[33m';
const red    = '\x1b[31m';
const cyan   = '\x1b[36m';
const bold   = '\x1b[1m';
const reset  = '\x1b[0m';
const log = (msg, color = reset) => console.log(`${color}${msg}${reset}`);

// ── Validate paths ────────────────────────────────────────────────────────────
log(`\n${bold}BARZELPRO — Tab Icon Injector${reset}`, bold);

if (!fs.existsSync(HTML_PATH)) {
  log(`✗ index.html not found: ${HTML_PATH}`, red);
  process.exit(1);
}
if (!fs.existsSync(ICONS_PATH)) {
  log(`✗ Icons folder not found: ${ICONS_PATH}`, red);
  log(`  Create a 'ui_icons/' folder and add your SVG files.`, yellow);
  process.exit(1);
}

log(`HTML:  ${HTML_PATH}`, cyan);
log(`Icons: ${ICONS_PATH}`, cyan);

// ── Read HTML ─────────────────────────────────────────────────────────────────
let html = fs.readFileSync(HTML_PATH, 'utf8');

// ── Process each icon ─────────────────────────────────────────────────────────
let changes = 0;

for (const [svgFile, tabId] of Object.entries(ICON_MAP)) {
  const iconPath = path.join(ICONS_PATH, svgFile);

  if (!fs.existsSync(iconPath)) {
    log(`  ⚠ Skipping ${svgFile} — not found in ${ICONS_PATH}`, yellow);
    continue;
  }

  // Read SVG
  let svg = fs.readFileSync(iconPath, 'utf8').trim();

  // ── Clean up SVG ────────────────────────────────────────────────────────────

  // Remove XML declaration
  svg = svg.replace(/<\?xml[^?]*\?>/g, '').trim();

  // Remove <desc> blocks
  svg = svg.replace(/<desc>[\s\S]*?<\/desc>/g, '');

  // Replace hardcoded stroke colors with currentColor
  svg = svg.replace(/stroke="#[0-9a-fA-F]{3,8}"/g, 'stroke="currentColor"');
  svg = svg.replace(/stroke='#[0-9a-fA-F]{3,8}'/g, "stroke='currentColor'");

  // Replace hardcoded fill colors (but not fill="none")
  svg = svg.replace(/fill="#[0-9a-fA-F]{3,8}"/g, 'fill="currentColor"');
  svg = svg.replace(/fill='#[0-9a-fA-F]{3,8}'/g, "fill='currentColor'");

  // Set width and height
  svg = svg.replace(/(<svg[^>]*?)\s+width="[^"]*"/, `$1 width="${ICON_SIZE}"`);
  svg = svg.replace(/(<svg[^>]*?)\s+height="[^"]*"/, `$1 height="${ICON_SIZE}"`);
  if (!svg.slice(0, 100).includes('width=')) {
    svg = svg.replace('<svg ', `<svg width="${ICON_SIZE}" height="${ICON_SIZE}" `);
  }

  // Add display:block style
  svg = svg.replace(/(<svg[^>]*?)>/, '$1 style="display:block;flex-shrink:0;">');

  // Collapse whitespace
  svg = svg.replace(/\s+/g, ' ').trim();

  // ── Find tab button and inject ───────────────────────────────────────────────
  const btnPattern = new RegExp(`(<button[^>]*id="${tabId}"[^>]*>)([\\s\\S]*?)(</button>)`, '');
  const match = html.match(btnPattern);

  if (!match) {
    log(`  ✗ Tab button not found: id="${tabId}"`, red);
    continue;
  }

  const btnOpen  = match[1];
  const btnInner = match[2];
  const btnClose = match[3];

  // Remove any existing SVG from button
  const cleanInner = btnInner.replace(/<svg[\s\S]*?<\/svg>/g, '').trim();

  // Find existing label span
  const spanMatch = cleanInner.match(/<span[^>]*>[\s\S]*?<\/span>/);
  const labelHtml = spanMatch ? spanMatch[0] : cleanInner;

  const newInner = `\n  ${svg}\n  ${labelHtml}\n`;
  const newBtn = btnOpen + newInner + btnClose;

  html = html.replace(match[0], newBtn);
  log(`  ✓ Injected ${svgFile} → #${tabId}`, green);
  changes++;
}

// ── Inject tab CSS if not already present ─────────────────────────────────────
const CSS_MARKER = '/* Tab icon styles — injected by inject-icons.js */';
if (!html.includes(CSS_MARKER)) {
  const tabIconCss = `
${CSS_MARKER}
.tab{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;}
.tab svg{flex-shrink:0;}
`;
  html = html.replace('</style>', tabIconCss + '</style>');
  log(`  ✓ Tab icon CSS injected`, green);
}

// ── Write ─────────────────────────────────────────────────────────────────────
if (changes === 0) {
  log(`\n⚠ No icons were injected. Check that your SVG files exist in ${ICONS_PATH}`, yellow);
  log(`  Expected files: ${Object.keys(ICON_MAP).join(', ')}`, yellow);
  process.exit(0);
}

if (isDryRun) {
  log(`\n[dry-run] ${changes} icon(s) would be injected. Remove --dry-run to apply.`, yellow);
} else {
  fs.writeFileSync(HTML_PATH, html, 'utf8');
  log(`\n✓ ${changes} icon(s) injected into ${HTML_PATH}`, green);
}

log('');
