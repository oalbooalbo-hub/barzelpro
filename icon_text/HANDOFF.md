# BARZELPRO — Developer Handoff Document
> Give this file to Claude at the start of a new chat along with the latest `index.html`.

---

## Project Overview
**BARZELPRO** is a PWA workout tracker (`index.html`, currently v3.7). It is a single-file app with Firebase auth, LocalForage storage, and a custom inline KG weight editor. The UI is mobile-first (430px max-width), dark theme, with accent color `#e8ff47` (yellow).

---

## Tooling You Must Know About

### 1. `strip_debug.py`
Removes all debug code from `index.html` for production.

- Replaces `/* DBG_START */ ... /* DBG_END */` blocks with empty `/* DBG_START *//* DBG_END */` shells
- The shells stay in the file so `add_debug.py` can restore later
- Run: `python3 strip_debug.py` (next to `index.html`)

### 2. `add_debug.py`
Re-injects the debug infrastructure (`_dbgLog` function, panel UI, property watchers) into a stripped `index.html`.

- The inline `_dbgLog(...)` call sites are already in the file as empty `/* DBG_START *//* DBG_END */` shells
- This script only re-adds the **engine** that powers them
- Run: `python3 add_debug.py` (next to `index.html`)
- After running: open `index.html` in browser → tap yellow **DBG** button (top-right) to open panel
- Panel has **CLEAR** and **SNAP** buttons. SNAP dumps current editor state.

### 3. Debug Markup Rule
**Every debug line you add must be wrapped:**
```js
/* DBG_START */ window._dbgLog('your message', '#color'); /* DBG_END */
```
Multi-line blocks:
```js
/* DBG_START */
// any debug code
/* DBG_END */
```
`strip_debug.py` will automatically catch everything between markers — **the script never needs updating**.

### 4. `regression_tests.html`
A self-contained test suite covering all key bug fixes. 36 tests across 8 suites.

**How to run:**
1. Serve `index.html` via VS Code Live Server
2. Open `index.html` in browser
3. Open F12 console and paste:
```js
fetch('regression_tests.html').then(r=>r.text()).then(html=>{const d=document.createElement('div');d.innerHTML=html;document.body.appendChild(d.querySelector('#test-runner-root'));document.body.appendChild(d.querySelector('#test-dom'));const s=d.querySelector('script[data-runner]');const fn=new Function(s.textContent+'window.runAll=runAll;window._suites=_suites;');fn();})
```
4. Click **▶ Run All Tests** in the panel that appears
5. To copy results: paste in console:
```js
console.log([...document.querySelectorAll('.test')].map(t=>{const badge=t.querySelector('.badge').textContent;const name=t.querySelector('.test-name').childNodes[0].textContent.trim();const err=t.querySelector('.error-detail')?.textContent||'';return `[${badge}] ${name}${err?' → '+err:''}`}).join('\n'))
```

**What is tested:**
- `_updateKgDisplay` — plain kg and BW mode display, live updates, KG unit
- BW label creation/removal, color handling, raw total prevention
- Display formatting — white number, yellow `+` prefix
- Cancel — restores value, visibility, color, BW label, resets flags
- RST button — uses `defaultSets`, no-op without prevKg, resets BW mode
- `resetCardSets` — closes editor first, removes both row types
- `_kgEditorOpening` guard — per-input, not global block
- Source code integrity checks

**When adding new features or fixing bugs, add new `it(...)` tests to the relevant suite.**

---

## Key Architecture — Inline KG Editor

The inline KG editor is the most complex component. Key facts:

### Two script blocks
- **Block 1** (~line 1570): `confirmKgEditor`, `kgPadPress/Add/Back/Reset`, `addSet`, `resetCardSets`
- **Block 2** (~line 16893): `openInlineKgEditor`, `closeInlineKgEditor`, `cancelInlineKgEditor`, `_updateKgDisplay`, `_applyBWMode`

Functions in Block 2 are exposed globally at the bottom:
```js
window.openInlineKgEditor = openInlineKgEditor;
window.closeInlineKgEditor = closeInlineKgEditor;
window.cancelInlineKgEditor = cancelInlineKgEditor;
window.showExFloatBar = showExFloatBar;
window.hideExFloatBar = hideExFloatBar;
window.exFloatAction = exFloatAction;
```

### Key globals
| Variable | Purpose |
|---|---|
| `window._kgEditorInput` | The `<input>` element currently being edited |
| `window._kgEditorVal` | Current string value in the editor (not yet saved) |
| `window._kgEditorExId` | Exercise card ID of current edit |
| `window._kgEditorBWMode` | Whether BW+ mode is active |
| `window._kgEditorPrevKg` | The `defaultSets[setIndex].kg` value (frozen at card load) |
| `window._activeInlineEditorDiv` | Direct ref to open editor div (avoids stale ID lookups) |
| `window._kgEditorOpening` | Double-fire guard flag |
| `window._kgOpeningInput` | Which input triggered the guard (per-input, not global) |
| `window._kgEditorOrigVal` | Input value at editor open time (for Cancel) |
| `window._kgEditorOrigBWLabelHTML` | BW label HTML at open time (for Cancel) |
| `window._userBW` | User's body weight in kg |

### Duplicate ID issue (fixed)
The old modal editor (`kgEditorOverlay`) uses IDs `kgEditorDisplayModal`, `kgEditorUnitModal`, `kgBWBtnModal` etc. The inline editor uses `kgEditorDisplay`, `kgEditorUnit`, `kgBWBtnInline`. **Never reuse the Modal-suffixed IDs** in inline editor code.

### Live update flow
`_updateKgDisplay(val, isBWMode)` is called on every keypress:
- Finds `#kg-display-row` via `window._activeInlineEditorDiv.querySelector(...)` (NOT `document.getElementById`)
- In BW mode: hides input, creates/updates `.bw-display-label` in cell, writes BW total to `input.value`
- In plain mode: removes BW label, shows input, writes value to `input.value`
- Calls `updateVolProgressBar(exId)` for live Analyze Session updates

### prev / RST value source
`prevKg` = `card.dataset.defaultSets[setIndex].kg` — frozen when exercise card loads, **never updated by Done**. This is intentional: RST always goes back to the original prefilled value, not the last saved value.

### Cancel vs Done
- **Cancel** → `cancelInlineKgEditor()` → restores from `_kgEditorOrig*` snapshot → calls `closeInlineKgEditor()`
- **Done** → `confirmKgEditor()` → saves to input, creates BW label if BW mode → calls `closeKgEditor()` then `closeInlineKgEditor()`
- `closeInlineKgEditor()` **clears editor innerHTML** (prevents stale `#kg-display-row` IDs in DOM)

---

## Bugs Fixed in This Session (for context)

1. **Editor visually dead on second set** — `document.getElementById('kgEditorDisplay')` was finding the hidden modal's span first (duplicate ID). Fixed by renaming modal IDs and using `_activeInlineEditorDiv.querySelector(...)`.
2. **`_kgEditorOpening` guard blocking different sets** — guard was global, now per-input (`_kgOpeningInput`).
3. **`window._kgEditorBWMode` not set on second open** — `_applyBWMode` was returning early before setting flag. Fixed by setting flag as first line.
4. **Raw BW total (e.g. 135) showing in cell** — live update was writing to input while it was still visible. Fixed by hiding input and showing BW label immediately on BW mode.
5. **Cancel not restoring** — original state not snapshotted before live updates modified input. Fixed by saving `_kgEditorOrig*` at open time.
6. **RST not working after `resetCardSets`** — rows removed without closing editor first, leaving stale `_kgEditorInput`. Fixed by calling `closeInlineKgEditor()` first.
7. **Green input color** — `input.style.color = '#34d399'` was set in BW path unnecessarily. Removed.
8. **`showExFloatBar` / `openInlineKgEditor` not defined** — defined in late script block. Fixed by exposing on `window`.
9. **Duplicate `_setNumEl` declaration** — renamed to `_prevSetNumEl` in prevKg lookup.

---

## File Structure
```
index.html              — Main app (single file, ~17,900 lines)
strip_debug.py          — Remove debug code for production
add_debug.py            — Restore debug infrastructure
regression_tests.html   — Test suite (run inside index.html scope)
HANDOFF.md              — This file
```

---

## Coding Conventions
- All debug lines: `/* DBG_START */ window._dbgLog('msg', '#color'); /* DBG_END */`
- New functions in Block 2 must be exposed on `window` at the bottom of that block
- `card.dataset.defaultSets` is read-only after card load — never write to it
- Always call `closeInlineKgEditor()` before removing set rows
- Use `window._activeInlineEditorDiv.querySelector(...)` not `document.getElementById(...)` for editor-internal elements

## Regression Test Update Rule
**Every bug fix or new feature must be accompanied by a corresponding update to `regression_tests.html`.**

Specifically:
- **Bug fix** → add an `it(...)` test that would have caught the bug (tests the correct behaviour)
- **New feature** → add `it(...)` tests covering the happy path and edge cases
- Add to an existing `describe(...)` suite if it fits, or create a new one
- After adding tests, run the suite and confirm all pass before delivering the updated `index.html`
- Never leave a bug fix without a test — if the bug comes back, the test must catch it
