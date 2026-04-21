"""
add_debug.py — Re-injects the debug infrastructure into a stripped index.html.

The inline /* DBG_START *//* DBG_END */ markers remain in the file after stripping
(strip_debug.py removes their CONTENT but keeps the markers as empty shells).
This script re-injects the core engine (_dbgLog, panel, watchers) that powers them.

Run: python3 add_debug.py  (next to index.html)
"""
import sys

ANCHOR_BEFORE = 'function confirmKgEditor() {'
INFRA = """/* DBG_START */
// ── DEBUG OVERLAY ─────────────────────────────────────────────────────────
window._dbgLog = function(msg, color) {
  const el = document.getElementById('_dbg_panel');
  if (!el) return;
  const line = document.createElement('div');
  line.style.cssText = 'color:' + (color||'#e8ff47') + ';font-size:11px;border-bottom:1px solid #222;padding:3px 0;white-space:pre-wrap;word-break:break-all;';
  line.textContent = new Date().toISOString().slice(11,23) + ' ' + msg;
  el.insertBefore(line, el.firstChild);
  while (el.children.length > 60) el.removeChild(el.lastChild);
};

// ── PROPERTY WATCHERS — catch every write to key globals ──────────────────
(function _installWatchers() {
  function watchProp(name, color) {
    let _val = window[name];
    Object.defineProperty(window, name, {
      get() { return _val; },
      set(v) {
        const stack = new Error().stack.split('\n').slice(1,3).map(s=>s.trim().replace(/.*at /,'')).join(' → ');
        window._dbgLog('SET window.' + name + ' = ' + (v && typeof v === 'object' ? '[obj]' : v) + '  ← ' + stack, color);
        _val = v;
      },
      configurable: true
    });
  }
  // Watch after DOM ready so dbgLog panel exists
  document.addEventListener('DOMContentLoaded', () => {
    watchProp('_kgEditorVal', '#ff8c42');
    watchProp('_kgEditorInput', '#7ec8e3');
    watchProp('_kgEditorOpening', '#a78bfa');
    watchProp('_inlineKgEditorId', '#f87171');
  });
})();

(function _injectDbgUI() {
  const panel = document.createElement('div');
  panel.id = '_dbg_panel';
  panel.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#0a0a0aee;border-bottom:2px solid #e8ff47;padding:6px 8px;max-height:220px;overflow-y:auto;font-family:monospace;display:none;';
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;';
  const toggle2 = document.createElement('button');
  toggle2.textContent = 'CLEAR';
  toggle2.style.cssText = 'background:#333;color:#fff;font-size:10px;border:none;border-radius:4px;padding:2px 6px;cursor:pointer;';
  toggle2.onclick = () => { panel.querySelectorAll('div:not(:first-child)').forEach(d=>d.remove()); };
  hdr.appendChild(toggle2);
  const snapBtn = document.createElement('button');
  snapBtn.textContent = 'SNAP';
  snapBtn.style.cssText = 'background:#333;color:#e8ff47;font-size:10px;border:none;border-radius:4px;padding:2px 6px;cursor:pointer;';
  snapBtn.onclick = () => {
    window._dbgLog('SNAP: val=' + window._kgEditorVal + ' input=' + !!window._kgEditorInput + ' id=' + window._inlineKgEditorId + ' opening=' + window._kgEditorOpening + ' displayEl=' + !!document.getElementById('kgEditorDisplay'), '#ffffff');
  };
  hdr.appendChild(snapBtn);
  panel.appendChild(hdr);
  const toggle = document.createElement('button');
  toggle.textContent = 'DBG';
  toggle.style.cssText = 'position:fixed;top:4px;right:8px;z-index:100000;background:#e8ff47;color:#000;font-size:10px;font-weight:700;border:none;border-radius:6px;padding:5px 9px;cursor:pointer;';
  toggle.onclick = () => { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; };
  document.addEventListener('DOMContentLoaded', () => { document.body.appendChild(panel); document.body.appendChild(toggle); });
})();
// ─────────────────────────────────────────────────────────────────────────
/* DBG_END */
"""

with open('index.html', 'r') as f:
    content = f.read()

if '/* DBG_START */\n// ── DEBUG OVERLAY' in content:
    print("Debug infrastructure already present. Nothing to do.")
    sys.exit(0)

if ANCHOR_BEFORE not in content:
    print(f"ERROR: Anchor not found: {ANCHOR_BEFORE!r}")
    sys.exit(1)

content = content.replace(ANCHOR_BEFORE, INFRA + ANCHOR_BEFORE, 1)

with open('index.html', 'w') as f:
    f.write(content)

print("Done. Debug infrastructure re-injected.")
print("window._dbgLog() is now active. Open the app and tap DBG button.")
