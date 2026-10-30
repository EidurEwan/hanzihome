/* motion.js — the app's movement, kept in one place.
 *
 * Most of it is CSS (style.css, "Motion"): a page's cards rise in one after another
 * when you go to it, bars and rings fill, popups grow out of where they point.
 * This file does what CSS can't on its own: tells the CSS when a page is new (not
 * just redrawn), counts numbers up as a page comes in, replays a one-off animation
 * on an element, and throws confetti when a session is done.
 *
 * Everything stands still with the system's "reduce motion" setting. Needs nothing
 * else; app.js calls Motion.enter() from render(). */

'use strict';

const Motion = (() => {
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const root = () => document.getElementById('app');
  let lastPath = null, timer = 0, observer = null;

  /* a new page (not a redraw of this one): its parts rise in (#app.entering, in the
     CSS) and its numbers count up, for those drawn in the next moment too (pages
     that fill in as their data loads) */
  function enter(path) {
    if (path === lastPath) return;
    const first = lastPath === null;
    lastPath = path;
    const app = root();
    if (!app || reduced()) return;
    app.classList.remove('entering');
    void app.offsetWidth;                          // (restarts the animations)
    app.classList.add('entering');
    if (first) app.classList.add('first');
    clearTimeout(timer);
    timer = setTimeout(() => app.classList.remove('entering', 'first'), 1000);
    watch(app);
    requestAnimationFrame(() => countUp(app));
  }

  function watch(app) {
    if (observer || !window.MutationObserver) return;
    let queued = false;
    observer = new MutationObserver(() => {
      if (queued || !app.classList.contains('entering')) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; countUp(app); });
    });
    observer.observe(app, { childList: true, subtree: true });
  }

  /* numbers count up from nothing: the big ones, on tiles and stat cards */
  const COUNTED = ['.lx-tile > span', '.st-tiles b', '.lx-stages b', '.quad b', '.streak .big b',
    '.rs-stats b', '.rs-ring b'].join(', ');
  function countUp(within) {
    if (reduced()) return;
    for (const el of within.querySelectorAll(COUNTED)) {
      if (el.dataset.counted || el.children.length) continue;
      el.dataset.counted = '1';
      const m = /^([\d,]+)(%?)$/.exec(el.textContent.trim());
      if (!m) continue;
      const end = +m[1].replace(/,/g, ''), commas = m[1].includes(',');
      if (end < 2) continue;
      const fmt = v => (commas ? v.toLocaleString('en-US') : String(v)) + m[2];
      const start = performance.now(), ms = Math.min(1100, 450 + end * 4);
      const tick = t => {
        if (!el.isConnected) return;
        const f = Math.min(1, (t - start) / ms), e = 1 - (1 - f) ** 3;   // ease out
        el.textContent = fmt(Math.round(end * e));
        if (f < 1) requestAnimationFrame(tick);
      };
      el.textContent = fmt(0);
      requestAnimationFrame(tick);
    }
  }

  /* replay a one-off animation (a class in the CSS) on an element, or on its
     children (m-stagger), taking the class off again once it has played */
  function play(el, cls, ms = 1400) {
    if (!el || reduced()) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    clearTimeout(el._motion);
    el._motion = setTimeout(() => el.classList.remove(cls), ms);
  }

  /* confetti, from the top of the screen (or from an element), for a session done */
  const COLORS = ['#fde24d', '#f44285', '#42f4b0', '#4286f4', '#7c5ce0', '#ff9f43'];
  function confetti(from) {
    if (reduced()) return;
    const c = document.createElement('canvas');
    c.className = 'm-confetti';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.width = innerWidth * dpr, H = c.height = innerHeight * dpr;
    const ctx = c.getContext('2d');
    const r = from ? from.getBoundingClientRect() : null;
    const ox = (r ? r.left + r.width / 2 : innerWidth / 2) * dpr, oy = (r ? r.top + r.height / 3 : innerHeight * 0.3) * dpr;
    const N = innerWidth < 600 ? 90 : 150;
    const bits = Array.from({ length: N }, () => {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9, v = (6 + Math.random() * 9) * dpr;
      return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2 * dpr, w: (6 + Math.random() * 6) * dpr,
        h: (8 + Math.random() * 8) * dpr, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)], round: Math.random() < 0.3 };
    });
    const t0 = performance.now(), LIFE = 2200;
    const frame = t => {
      const age = t - t0;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - LIFE * 0.6) / (LIFE * 0.4));
      for (const b of bits) {
        b.vy += 0.32 * dpr; b.vx *= 0.985; b.vy *= 0.985;
        b.x += b.vx; b.y += b.vy; b.rot += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.scale(1, Math.cos(b.rot * 2));          // (a flutter, as it turns)
        ctx.fillStyle = b.color;
        if (b.round) { ctx.beginPath(); ctx.arc(0, 0, b.w / 2, 0, 7); ctx.fill(); }
        else ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      if (age < LIFE) requestAnimationFrame(frame); else c.remove();
    };
    requestAnimationFrame(frame);
  }

  return { enter, countUp, play, confetti, reduced };
})();
