/* Measures the pitch of the recordings, for build/tones/classify.js. Paste into the console of
 * a page served from site/ (any page: only fetch and Web Audio are used), then call
 *   await measure({words: ['可以', …], syl: ['ma1', …]})
 * and save what it returns as JSON. Takes a few minutes for all of them.
 * A browser because it is what can decode the mp3s without installing anything. */
async function pitch(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const ab = await new OfflineAudioContext(1, 16000, 16000).decodeAudioData(buf);
  const x = ab.getChannelData(0), sr = ab.sampleRate, hop = Math.round(sr * 0.01), win = Math.round(sr * 0.04);
  const lo = Math.floor(sr / 400), hi = Math.ceil(sr / 70), out = [], es = [];
  let maxE = 0;
  for (let i = 0; i + win + hi < x.length; i += hop) { let e = 0; for (let j = 0; j < win; j++) e += x[i + j] * x[i + j]; es.push(e); if (e > maxE) maxE = e; }
  es.forEach((e, k) => {
    const i = k * hop;
    if (e < maxE * 0.04) { out.push(null); return; }
    let best = 0, bl = 0;
    for (let l = lo; l <= hi; l++) {
      let c = 0, a = 0, b = 0;
      for (let j = 0; j < win; j++) { c += x[i + j] * x[i + j + l]; a += x[i + j] * x[i + j]; b += x[i + j + l] * x[i + j + l]; }
      const n = c / Math.sqrt(a * b + 1e-12);
      if (n > best) { best = n; bl = l; }
    }
    out.push(best > 0.6 ? 12 * Math.log2(sr / bl / 100) : null);       // semitones above 100 Hz
  });
  return out;
}
/* octave slips put right against the median, then smoothed */
async function track(url) {
  let c = await pitch(url);
  const vs = c.filter(z => z != null).sort((a, b) => a - b), med = vs[vs.length >> 1];
  c = c.map(z => { if (z == null) return null; while (z - med > 8) z -= 12; while (med - z > 8.5) z += 12; return z; });
  return c.map((z, i) => { if (z == null) return null; const w = c.slice(Math.max(0, i - 2), i + 3).filter(y => y != null).sort((a, b) => a - b); return w[w.length >> 1]; });
}
/* a word into its two syllables: at the gap nearest the middle, else the middle */
function two(c) {
  const idx = c.map((z, i) => (z == null ? -1 : i)).filter(i => i >= 0), first = idx[0], last = idx[idx.length - 1];
  let cut = Math.floor((first + last) / 2), bestGap = null;
  for (let i = first; i < last; i++) {
    if (c[i] != null) continue;
    let j = i; while (c[j] == null && j < last) j++;
    const m = (i + j) / 2, d = Math.abs(m - (first + last) / 2);
    if (j - i >= 2 && (bestGap == null || d < bestGap) && d < (last - first) * 0.3) { bestGap = d; cut = Math.round(m); }
    i = j;
  }
  return [c.slice(0, cut), c.slice(cut)];
}
function feat(v) {
  v = v.filter(z => z != null);
  if (v.length < 3) return null;
  const n = v.length, q = Math.max(1, Math.floor(n / 4)), m = a => a.reduce((s, z) => s + z, 0) / a.length, r = x => Math.round(x * 10) / 10;
  return [r(m(v.slice(0, q))), r(m(v)), r(m(v.slice(-q))), r(Math.min(...v)), r(Math.max(...v)), n];
}
async function measure(cand) {
  const out = { w: {}, s: {} };
  for (const s of cand.syl) out.s[s] = feat(await track(`/audio/s/${s}.mp3`));
  for (const w of cand.words) { const c = await track('/audio/w/' + encodeURIComponent(w) + '.mp3'), [a, b] = two(c); out.w[w] = [feat(a), feat(b), feat(c)]; }
  return out;
}
