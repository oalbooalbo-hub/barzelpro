// ── App name: change it HERE only ─────────────────────────────────────────
// name      → full name: browser tab, install screen, iPhone home screen,
//             Share text, backup file names.
// shortName → label under the icon on Android (keep it short, ~12 characters).
// After changing either one, run:  node sync-manifest.js
// (copies them into manifest.json, index.html, install.html, offline.html).
window.BRAND_CONFIG = {
  id: 'icon_test_1',
  name: 'ALBO',
  shortName: 'ALBO',
  subtitle: 'icon_test_3',
  tagline: 'icon_test_4',
  accentColor: '#7CD9D7'
};

// Small sound effects — add new ones here as they come up, referenced by key
// from index.html via _playSound('key') rather than hardcoding file paths inline.
window.SOUNDS = {
  targetMet: './sound/target_done.mp3'
};
