// The browser side of the text-fit checks (test/ui/room-fit.e2e.test.js, test/ui/lobby-hub.e2e.test.js — §35.18 review):
// a function passed to page.evaluate. Not a test file itself.

/**
 * In the page: the text problems under `rootSel`. Each visible text node's line boxes (a glyph box's middle ± half the line
 * height) against every ancestor up to the root that clips (overflow) or draws a box (background, border, a button) —
 * 2 px of slack for hairlines —, an ancestor that scrolls on that axis ending the climb; the viewport; the other labels'
 * text as it shows (clipped by its clipping ancestors); a line break inside a word (not at a space, a hyphen or between
 * CJK / kana / Hangul); an ellipsis anywhere but a player's name (.seat__name, .specbar__who); the page scrolling.
 */
export function textProblems(rootSel) {
  const TOL = 2;
  const out = [];
  const texts = [];
  const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className ?? '').trim().split(/\s+/)[0]}`;
  const isBox = (cs) => cs.backgroundImage !== 'none' || !/^(transparent|rgba\(\d+, \d+, \d+, 0\))$/.test(cs.backgroundColor)
    || ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none');
  const scrolls = (v) => v === 'auto' || v === 'scroll';
  const cjk = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/;
  for (const root of document.querySelectorAll(rootSel)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const txt = n.textContent.trim();
      const el = n.parentElement;
      if (!txt || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) || el.closest('.sr-only')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!rects.length) continue;
      const cs = getComputedStyle(el);
      const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
      const label = `${name(el)} "${txt.slice(0, 30)}"`;
      let boxes = rects.map((r) => { const m = (r.top + r.bottom) / 2, hh = Math.min(r.height, lh) / 2; return { l: r.left, r: r.right, t: m - hh, b: m + hh }; });
      // an ellipsis: allowed for a player's name only; what shows is the element's box
      const cut = [el, el.parentElement].find((a) => a && getComputedStyle(a).textOverflow === 'ellipsis' && a.scrollWidth > a.clientWidth + 1);
      if (cut) {
        if (!cut.matches('.seat__name, .specbar__who')) out.push(`ellipsis ${label}`);
        const ar = cut.getBoundingClientRect();
        boxes = boxes.map((b) => ({ ...b, l: Math.max(b.l, ar.left), r: Math.min(b.r, ar.right) }));
      }
      let pastX = false, pastY = false;
      for (let a = el; a && a !== root.parentElement && !(pastX && pastY); a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.display === 'contents') continue;
        const clipX = acs.overflowX !== 'visible', clipY = acs.overflowY !== 'visible';
        const box = isBox(acs) || a.tagName === 'BUTTON';
        if (!cut && (clipX || clipY || box)) {
          const ar = a.getBoundingClientRect();
          const L = ar.left + parseFloat(acs.borderLeftWidth) - TOL, R = ar.right - parseFloat(acs.borderRightWidth) + TOL;
          const T = ar.top + parseFloat(acs.borderTopWidth) - TOL, B = ar.bottom - parseFloat(acs.borderBottomWidth) + TOL;
          const checkX = (clipX || box) && !scrolls(acs.overflowX) && !pastX, checkY = (clipY || box) && !scrolls(acs.overflowY) && !pastY;
          const outX = checkX && boxes.some((b) => b.l < L || b.r > R), outY = checkY && boxes.some((b) => b.t < T || b.b > B);
          if (outX || outY) { out.push(`${outX ? 'x' : ''}${outY ? 'y' : ''} past ${name(a)}: ${label}`); break; }
        }
        if (scrolls(acs.overflowX)) pastX = true;
        if (scrolls(acs.overflowY)) pastY = true;
      }
      let shown = boxes;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        shown = shown.map((b) => ({ l: Math.max(b.l, ar.left), r: Math.min(b.r, ar.right), t: Math.max(b.t, ar.top), b: Math.min(b.b, ar.bottom) }))
          .filter((b) => b.r > b.l && b.b > b.t);
      }
      if (shown.some((b) => b.l < -1 || b.t < -1 || b.r > innerWidth + 1 || b.b > innerHeight + 1)) out.push(`off screen: ${label}`);
      texts.push({ el, label, shown });
      if (new Set(rects.map((r) => Math.round(r.top))).size > 1) {
        let prevTop = null;
        for (let i = 0; i < n.textContent.length; i++) {
          const c = n.textContent[i];
          if (/\s/.test(c)) continue;
          const cr = document.createRange();
          cr.setStart(n, i);
          cr.setEnd(n, i + 1);
          const rr = [...cr.getClientRects()].find((r) => r.width > 0);
          if (!rr) continue;
          const p = n.textContent[i - 1] || ' ';
          if (prevTop != null && rr.top > prevTop + rr.height / 2 && !/[\s\-\u2010\u2013\u2014/\u00b7\u30fb]/.test(p) && !cjk.test(p) && !cjk.test(c)) {
            out.push(`broken inside a word (${n.textContent.slice(Math.max(0, i - 6), i)}|${n.textContent.slice(i, i + 6)}): ${label}`);
            break;
          }
          prevTop = rr.top;
        }
      }
    }
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
    if (a.shown.some((p) => b.shown.some((q) => p.l < q.r - 2 && p.r > q.l + 2 && p.t < q.b - 2 && p.b > q.t + 2))) out.push(`over: ${a.label} / ${b.label}`);
  }
  const de = document.documentElement;
  if (de.scrollWidth > innerWidth + 1 || de.scrollHeight > innerHeight + 1) out.push(`the page scrolls (${de.scrollWidth}×${de.scrollHeight})`);
  return out;
}
