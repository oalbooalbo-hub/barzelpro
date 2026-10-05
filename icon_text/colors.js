// ═══════════════════════════════════════════════════════════════════════
//  BARZELPRO colours — edit the values below and reload the app.
//  Every body-part colour and every PR colour in the app reads from here.
//  (Use 6-digit hex values like '#e8ff47'.) After changing them, bump
//  APP_VERSION in service-worker.js so installed phones pick it up.
//    Chest:     '#e8ff47',
//    Back:      '#7ec8e3',
//    Legs:      '#ff8c42',
//    Shoulders: '#a78bfa',
//    Arms:      '#34d399',
//    Core:      '#f87171',
//    Mix:       '#20d4c8',
//    max:     '#e8ff47',
//    bestSet: '#ff8c42',
//    vol:     '#a78bfa',
// ═══════════════════════════════════════════════════════════════════════
window.BP_COLORS = {
  // Body parts — pills, cards, charts, pickers, body diagram…
  muscles: {
    Chest:     '#e8ff47',
    Back:      '#7ec8e3',
    Legs:      '#ff8c42',
    Shoulders: '#a78bfa',
    Arms:      '#34d399',
    Core:      '#f87171',
    Mix:       '#20d4c8',
  },
  // Personal records — PR pentagons, MAX / BEST SET / VOL labels and charts.
  // "vol" is also the app's volume colour (volume target, volume progress).
  pr: {
    max:     '#e8ff47',
    bestSet: '#ff8c42',
    vol:     '#a78bfa',
  },
};

// ── Nothing to edit below this line ─────────────────────────────────────
(function () {
  var C = window.BP_COLORS;
  // Body-part colours in the app's display order (for lists indexed by it).
  window.BP_MUSCLE_ORDER = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Mix'];
  window.BP_MUSCLE_LIST = window.BP_MUSCLE_ORDER.map(function (m) { return C.muscles[m]; });
  // '#e8ff47' + 0.08 → 'rgba(232,255,71,0.08)' — light fills under chart lines etc.
  window.bpAlpha = function (hex, a) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    var n = parseInt(h, 16);
    if (isNaN(n)) return hex;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  };
  // Same colours as CSS variables, for styles/markup that can't run JS:
  // --pr-max / --pr-best / --pr-vol, and --m-chest, --m-back, …
  var root = document.documentElement.style;
  root.setProperty('--pr-max', C.pr.max);
  root.setProperty('--pr-best', C.pr.bestSet);
  root.setProperty('--pr-vol', C.pr.vol);
  Object.keys(C.muscles).forEach(function (m) { root.setProperty('--m-' + m.toLowerCase(), C.muscles[m]); });
})();
