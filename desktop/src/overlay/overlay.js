/* The overlay page: one transparent canvas over a whole display. The main
 * process (desktop/src/overlays.js) sends the words to mark, in this window's
 * coordinates, and this draws a thin bar under each: the site's green for
 * learned, blue for learning, and its red accent for new. Bars rather than
 * tints, so the text itself stays as it was. */

'use strict';

const COLOURS = {
  learned: 'rgba(34, 197, 94, .92)',    // --green
  learning: 'rgba(37, 99, 235, .92)',   // --blue
  new: 'rgba(183, 55, 70, .88)',        // --accent
};

const canvas = document.getElementById('bars');
const ctx = canvas.getContext('2d');
let bars = [];

function fit() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const b of bars) {
    // about a tenth of the text's height, 2-4 px, just under the characters
    const t = Math.max(2, Math.min(4, Math.round(b.h * 0.11)));
    ctx.fillStyle = COLOURS[b.s];
    ctx.beginPath();
    ctx.roundRect(b.x + 1, b.y + b.h + 1, Math.max(2, b.w - 2), t, t / 2);
    ctx.fill();
  }
}

window.overlay.onBars(list => { bars = list; draw(); });
addEventListener('resize', () => { fit(); draw(); });
fit();
