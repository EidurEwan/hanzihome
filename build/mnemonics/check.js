/* node build/mnemonics/check.js NAME [NAME…]   (e.g. words-03) — checks an agent's output
   against its input and BRIEF.md's rules; prints problems, exits 1 if there are any. */
'use strict';
const fs = require('fs'), path = require('path');
const dir = __dirname;
const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
let bad = 0;
const comps = (() => { try { return read('out/components.json'); } catch (e) { return []; } })();
const names = (() => { try { return new Set(read('out/components.json').map(x => x.name.toLowerCase())); } catch (e) { return null; } })();
for (const name of process.argv.slice(2)) {
  const n = name.replace(/\.json$/, '');
  const say = m => { bad++; console.log(`${n}: ${m}`); };
  let inp, out;
  try { inp = read(`in/${n}.json`); } catch (e) { say('no input'); continue; }
  try { out = read(`out/${n}.json`); } catch (e) { say('output missing or not JSON: ' + e.message); continue; }
  if (out.length !== inp.length) say(`${out.length} entries, input has ${inp.length}`);
  inp.forEach((x, i) => {
    const o = out[i] || {}, k = x.w || x.c, ok = o.w || o.c;
    if (ok !== k) return say(`#${i}: ${ok} where ${k} should be`);
    if (n.startsWith('scene')) {
      const m = o.m || '', words = m.split(/\s+/).length;
      if (words < 35 || words > 95) say(`${k}: ${words} words`);
      for (const sd of x.sound) if (!m.includes('{' + sd.replace(/^\S+ /, '') + '}')) say(`${k}: no {${sd.replace(/^\S+ /, '')}}`);
      if ((m.match(/\*\*[^*]+\*\*/g) || []).length < 2) say(`${k}: the meaning should be in **…** twice`);
      for (const [g, nm] of x.parts) if (!nm.toLowerCase().split(/\s+/).every(wd => m.toLowerCase().includes(wd.length > 4 ? wd.slice(0, -1) : wd))) say(`${k}: doesn't use ${g} "${nm}"`);
      return;
    }
    if (n.startsWith('compmn')) {
      const m = o.m || '';
      if (!/\*\*[^*]+\*\*/.test(m)) say(`${k}: no **name**`);
      for (const [g, nm] of x.parts) if (!m.toLowerCase().includes(nm.toLowerCase().split(/\s+/).pop().slice(0, 4))) say(`${k}: doesn't use ${g} "${nm}"`);
      if (m.split(/\s+/).length > 45) say(`${k}: too long`);
      return;
    }
    if (n.startsWith('components')) {
      if (!o.name || o.name.split(/\s+/).length > 3) say(`${k}: name "${o.name}"`);
      if (!o.why) say(`${k}: no why`);
    } else if (n.startsWith('chars')) {
      if (!o.key) say(`${k}: no key`);
      if (!/\*\*[^*]+\*\*/.test(o.m || '')) say(`${k}: mnemonic has no **meaning**`);
      if ((o.m || '').split(/\s+/).length > 45) say(`${k}: mnemonic too long`);
      if (names) for (const p of x.parts) {
        const c = comps.find(y => y.c === p);
        // every word of the name, allowing a plural or -ing ending ("kneeling men", "ladles")
        const m = (o.m || '').toLowerCase();
        if (c && !c.name.toLowerCase().split(/\s+/).every(wd => m.includes(wd.length > 4 ? wd.slice(0, wd.length - 1) : wd)))
          say(`${k}: doesn't use ${p} "${c.name}"`);
      }
    } else {
      if (!o.pos) say(`${k}: no pos`);
      if (!/\*\*[^*]+\*\*/.test(o.m || '')) say(`${k}: mnemonic has no **meaning**`);
      if (!Array.isArray(o.ex) || o.ex.length < 2) say(`${k}: needs two examples`);
      else o.ex.forEach(e => {
        if (!Array.isArray(e) || e.length !== 2 || !e[1]) say(`${k}: example not [zh, en]`);
        else if (!e[0].includes(k)) say(`${k}: example doesn't contain the word: ${e[0]}`);
        else if (/[a-z]/i.test(e[0])) say(`${k}: Latin letters in the Chinese: ${e[0]}`);
      });
      if (typeof o.use !== 'string') say(`${k}: use should be a string`);
    }
  });
}
console.log(bad ? `${bad} problem(s)` : 'ok');
process.exit(bad ? 1 : 0);
