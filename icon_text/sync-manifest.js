#!/usr/bin/env node
/**
 * sync-manifest.js — BARZELPRO PWA Metadata Sync
 *
 * Reads BRAND_CONFIG from config.js and updates manifest.json.
 *
 * Usage:
 *   node sync-manifest.js
 *   node sync-manifest.js --config ./path/to/config.js
 *   node sync-manifest.js --manifest ./path/to/manifest.json
 *   node sync-manifest.js --dry-run   (preview changes without writing)
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};
const isDryRun = args.includes('--dry-run');

const CONFIG_PATH   = path.resolve(getArg('--config')   || './config.js');
const MANIFEST_PATH = path.resolve(getArg('--manifest') || './manifest.json');

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg, color = '\x1b[0m') {
  console.log(`${color}${msg}\x1b[0m`);
}
const green  = '\x1b[32m';
const yellow = '\x1b[33m';
const red    = '\x1b[31m';
const cyan   = '\x1b[36m';
const bold   = '\x1b[1m';

// ── Read config.js ────────────────────────────────────────────────────────────
log(`\n${bold}BARZELPRO — Manifest Sync${'\x1b[0m'}`, bold);
log(`Reading config: ${CONFIG_PATH}`, cyan);

if (!fs.existsSync(CONFIG_PATH)) {
  log(`✗ config.js not found at: ${CONFIG_PATH}`, red);
  log(`  Run with --config ./path/to/config.js`, yellow);
  process.exit(1);
}

let BRAND_CONFIG;

try {
  const source = fs.readFileSync(CONFIG_PATH, 'utf8');

  // Create a sandbox with a mock window object to capture BRAND_CONFIG
  const sandbox = {
    window: {},
    self:   {},
    console,
  };

  // Execute config.js in sandbox
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  // BRAND_CONFIG may be on window or at top level
  BRAND_CONFIG = sandbox.window?.BRAND_CONFIG || sandbox.BRAND_CONFIG;

  if (!BRAND_CONFIG) {
    // Try extracting via regex as fallback (handles some edge cases)
    const match = source.match(/BRAND_CONFIG\s*=\s*(\{[\s\S]*?\});/);
    if (match) {
      BRAND_CONFIG = eval(`(${match[1]})`); // eslint-disable-line no-eval
    }
  }

  if (!BRAND_CONFIG) {
    throw new Error('BRAND_CONFIG not found in config.js');
  }

} catch (err) {
  log(`✗ Failed to parse config.js: ${err.message}`, red);
  process.exit(1);
}

log(`✓ BRAND_CONFIG loaded`, green);

// ── Extract fields ────────────────────────────────────────────────────────────
const {
  name,
  shortName,
  accentColor,
  backgroundColor,
  themeColor,
  description,
} = BRAND_CONFIG;

// Resolve values with sensible fallbacks
const resolvedName        = name        || null;
const resolvedShortName   = shortName   || (name ? name.split(' ')[0] : null);
const resolvedThemeColor  = themeColor  || null;  // Only from themeColor — not accentColor
const resolvedBgColor     = backgroundColor || null;
const resolvedDescription = description || null;

log(`\nExtracted values:`, cyan);
if (resolvedName)        log(`  name:         ${resolvedName}`);
if (resolvedShortName)   log(`  short_name:   ${resolvedShortName}`);
if (resolvedThemeColor)  log(`  theme_color:  ${resolvedThemeColor}`);
if (resolvedBgColor)     log(`  bg_color:     ${resolvedBgColor}`);
if (resolvedDescription) log(`  description:  ${resolvedDescription}`);

// ── Read manifest.json ────────────────────────────────────────────────────────
log(`\nReading manifest: ${MANIFEST_PATH}`, cyan);

if (!fs.existsSync(MANIFEST_PATH)) {
  log(`✗ manifest.json not found at: ${MANIFEST_PATH}`, red);
  log(`  Run with --manifest ./path/to/manifest.json`, yellow);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
} catch (err) {
  log(`✗ Failed to parse manifest.json: ${err.message}`, red);
  process.exit(1);
}

log(`✓ manifest.json loaded`, green);

// ── Apply changes ─────────────────────────────────────────────────────────────
const before = JSON.stringify(manifest, null, 2);
const changes = [];

function applyField(key, value, label) {
  if (value === null || value === undefined) return;
  if (manifest[key] === value) return;
  changes.push({ key, from: manifest[key], to: value });
  manifest[key] = value;
}

applyField('name',             resolvedName,        'name');
applyField('short_name',       resolvedShortName,   'short_name');
applyField('theme_color',      resolvedThemeColor,  'theme_color');
applyField('background_color', resolvedBgColor,     'background_color');
applyField('description',      resolvedDescription, 'description');

// ── Report ────────────────────────────────────────────────────────────────────
if (changes.length === 0) {
  log(`\n✓ manifest.json is already up to date.`, green);
  // Don't exit — still need to sync HTML files below
}

log(`\nChanges to apply:`, cyan);
changes.forEach(({ key, from, to }) => {
  log(`  ${key}:`);
  log(`    before: ${JSON.stringify(from)}`, yellow);
  log(`    after:  ${JSON.stringify(to)}`, green);
});

// ── Write ─────────────────────────────────────────────────────────────────────
if (isDryRun) {
  log(`\n[dry-run] No files written. Remove --dry-run to apply.`, yellow);
  process.exit(0);
}

try {
  const after = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(MANIFEST_PATH, after + '\n', 'utf8');
  log(`\n✓ manifest.json updated successfully (${changes.length} field${changes.length > 1 ? 's' : ''} changed).`, green);
} catch (err) {
  log(`✗ Failed to write manifest.json: ${err.message}`, red);
  process.exit(1);
}

// ── Sync HTML files (theme-color + install.html name) ────────────────────────
const HTML_FILES = ['index.html', 'install.html', 'offline.html'];
let htmlUpdated = 0;

HTML_FILES.forEach(file => {
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) return;

  let html = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Update theme-color meta tag
  if (resolvedThemeColor) {
    const updated = html.replace(
      /(<meta\s+name="theme-color"\s+content=")[^"]*(")/,
      `$1${resolvedThemeColor}$2`
    );
    if (updated !== html) { html = updated; changed = true; log(`  ✓ Updated theme-color in ${file}`, green); }
  }

  // Update hardcoded app name in install.html
  if (file === 'install.html' && resolvedName) {
    const t = html.replace(/<title>[^<]*— Install<\/title>/, `<title>${resolvedName} — Install</title>`);
    if (t !== html) { html = t; changed = true; }
    const a = html.replace(/alt="[^"]*icon"/, `alt="${resolvedName} icon"`);
    if (a !== html) { html = a; changed = true; }
    const l = html.replace(/(<div class="app-icon-label">)[^<]*(<\/div>)/, `$1${resolvedName}$2`);
    if (l !== html) { html = l; changed = true; }
    if (changed) log(`  ✓ Updated app name in install.html → "${resolvedName}"`, green);
  }

  // Update <title> in index.html
  if (file === 'index.html' && resolvedName) {
    const t = html.replace(/<title>[^<]*<\/title>/, `<title>${resolvedName}</title>`);
    if (t !== html) { html = t; changed = true; log(`  ✓ Updated <title> in index.html → "${resolvedName}"`, green); }
  }

  if (changed) {
    if (!isDryRun) fs.writeFileSync(filePath, html, 'utf8');
    htmlUpdated++;
  }
});

if (htmlUpdated > 0) {
  log(`✓ ${htmlUpdated} HTML file${htmlUpdated > 1 ? 's' : ''} synced.`, green);
}

log('');
