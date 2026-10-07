/* anki.js — HanziHome and Anki, both ways. Loaded by the Study page's Anki card
 * when it is used.
 *
 * Export: your lessons and reviews as a text file Anki imports as it is (File →
 * Import): hanzi, pinyin, meaning, the sentence you found it in, your mnemonic,
 * and tags for its kind and stage.
 *
 * Import: an Anki deck (.apkg, or .colpkg for a whole collection) or Anki's "Notes
 * in Plain Text" export (.txt). A deck is a zip holding the collection, a SQLite
 * database, which Anki 2.1.50 and later also compress with zstd: unzipped by zip.js,
 * unpacked with fzstd and read with sql.js
 * (both MIT, site/vendor/; sql.js's plain JavaScript build, since a page opened from
 * disk can't fetch WebAssembly). Which field holds the hanzi, the pinyin and the
 * meaning is guessed from the field names and what is in them, and can be changed.
 */

'use strict';

const Anki = (() => {
  const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
  const TONED = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i;
  const PINYIN = /^[a-zü:āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ1-5\s'’·,\-]+$/i;

  // ------------------------------------------------------------------ export

  const clean = s => String(s || '').replace(/[\t\r\n]+/g, ' ').trim();

  /* items: {key: item} from the store -> the text of a file Anki imports */
  function exportText(items) {
    const lines = ['#separator:tab', '#html:false', '#columns:Hanzi\tPinyin\tMeaning\tExample\tMnemonic\tTags', '#tags column:6'];
    for (const [k, it] of Object.entries(items)) {
      if (it.kind !== 'char' && it.kind !== 'word') continue;     // components and sounds stay here
      const stage = it.stage ? Learn.stageName(it.stage).replace(/\s+/g, '_') : 'lesson_queue';
      lines.push([k, it.pin, it.mean, it.ex && it.ex.text, it.mnemonic, `HanziHome ${it.kind} ${stage}`].map(clean).join('\t'));
    }
    return lines.join('\n') + '\n';
  }

  // ------------------------------------------------------------------ import

  /* the notes in a file: {names: field names (if the file says), notes: [{fields, tags}]} */
  async function read(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf[0] === 0x50 && buf[1] === 0x4b) return readPackage(buf);           // "PK": a zip
    return readText(new TextDecoder().decode(buf));
  }

  function readText(text) {
    const notes = [];
    let sep = '\t';
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('#')) {
        const m = line.match(/^#separator:(.+)$/i);
        if (m) sep = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ', colon: ':' }[m[1].trim().toLowerCase()] || m[1];
        continue;
      }
      if (!line.trim()) continue;
      notes.push({ fields: splitLine(line, sep).map(strip), tags: '' });
    }
    return { names: [], notes };
  }

  /* one line, honouring "quoted, fields" */
  function splitLine(line, sep) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"' && !cur) q = true;
      else if (line.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  /* a field's text: no HTML, sounds or furigana-style brackets */
  function strip(s) {
    const t = String(s || '').replace(/\[sound:[^\]]*\]/g, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ');
    const el = strip.el || (strip.el = document.createElement('textarea'));
    el.innerHTML = t;
    return el.value.replace(/\s+/g, ' ').trim();
  }

  async function readPackage(buf) {
    const files = Zip.files(buf);
    const pick = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find(n => files[n]);
    if (!pick) throw new Error("That file isn't an Anki deck: it has no collection in it.");
    let db = await Zip.read(files[pick]);
    if (pick.endsWith('b')) db = fzstd.decompress(db);
    if (!window.initSqlJs) await loadScript('vendor/sql-asm.js');
    const SQL = await initSqlJs();
    const d = new SQL.Database(db);
    try {
      const rows = q(d, 'SELECT mid, flds, tags FROM notes');
      // field names: the notetypes' own tables (2.1.28+), or the models in col (older)
      const names = {};
      try {
        for (const [nt, ord, name] of q(d, 'SELECT ntid, ord, name FROM fields')) (names[nt] = names[nt] || [])[ord] = name;
      } catch (e) {
        try {
          const models = JSON.parse(q(d, 'SELECT models FROM col')[0][0] || '{}');
          for (const [id, m] of Object.entries(models)) names[id] = (m.flds || []).map(f => f.name);
        } catch (e2) { /* names stay unknown */ }
      }
      // the commonest note type decides the columns; the rest are read the same way
      const count = {};
      rows.forEach(r => { count[r[0]] = (count[r[0]] || 0) + 1; });
      const main = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
      return {
        names: names[main] || [],
        notes: rows.map(([, flds, tags]) => ({ fields: String(flds).split('\x1f').map(strip), tags: String(tags || '').trim() })),
      };
    } finally {
      d.close();
    }
  }

  const q = (d, sql) => { const r = d.exec(sql); return r.length ? r[0].values : []; };

  // ------------------------------------------------------------ which field

  /* {hanzi, pinyin, meaning}: field numbers (meaning and pinyin may be -1), from the
     names when they say, otherwise from what the fields hold */
  function guess(names, notes) {
    const n = Math.max(0, ...notes.map(x => x.fields.length));
    const sample = notes.slice(0, 300);
    const share = test => Array.from({ length: n }, (_, i) =>
      sample.filter(x => x.fields[i] && test(x.fields[i])).length / Math.max(1, sample.length));
    const han = share(f => { const cs = [...f.replace(/\s/g, '')]; return cs.length && cs.length <= 12 && cs.filter(isHan).length / cs.length >= 0.8; });
    const pin = share(f => PINYIN.test(f) && (TONED.test(f) || /[a-z][1-5]/i.test(f)));
    const eng = share(f => /[a-z]{2}/i.test(f) && !(PINYIN.test(f) && (TONED.test(f) || /[a-z][1-5]/i.test(f))) && ![...f].some(isHan));
    const byName = re => names.findIndex(x => re.test(x || ''));
    const best = (scores, not) => {
      let b = -1;
      scores.forEach((s, i) => { if (s >= 0.3 && !not.includes(i) && (b < 0 || s > scores[b])) b = i; });
      return b;
    };
    let hanzi = byName(/^(hanzi|chinese|simplified|characters?|word|front|汉字|简体|中文)$/i);
    if (hanzi < 0 || han[hanzi] < 0.3) hanzi = best(han, []);
    let pinyin = byName(/pinyin|拼音|reading/i);
    if (pinyin < 0 || pin[pinyin] < 0.3) pinyin = best(pin, [hanzi]);
    let meaning = byName(/^(meaning|english|definition|translation|back|gloss)/i);
    if (meaning < 0 || eng[meaning] < 0.3) meaning = best(eng, [hanzi, pinyin]);
    return { hanzi, pinyin, meaning, fields: n };
  }

  /* the items the notes make, given the columns: [{k, kind, pin, mean}], one per hanzi,
     simplified (learnKey), longest-found first dropped of repeats */
  function items(notes, cols) {
    const seen = new Set(), out = [];
    for (const x of notes) {
      const raw = String(x.fields[cols.hanzi] || '').replace(/[^㐀-鿿\u{20000}-\u{2ffff}]/gu, '');
      if (!raw || [...raw].length > 12) continue;
      const k = learnKey(raw);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ k, kind: [...k].length > 1 ? 'word' : 'char', written: raw,
        pin: cols.pinyin >= 0 ? x.fields[cols.pinyin] || '' : '', mean: cols.meaning >= 0 ? x.fields[cols.meaning] || '' : '' });
    }
    return out;
  }

  /* "ni3 hao3" -> "nǐ hǎo" (pinyin with tone marks passes through) */
  const MARKS = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', 'ü': 'ǖǘǚǜ' };
  function marks(pin) {
    return String(pin || '').trim().split(/\s+/).filter(Boolean).map(syl => {
      const m = syl.toLowerCase().replace(/u:|v/g, 'ü').match(/^([a-zü]+)([1-5])$/);
      if (!m) return syl;
      const [, letters, tone] = m;
      if (tone === '5') return letters;
      // the tone goes on a or e, on the o of ou, else on the last vowel
      const at = /[ae]/.test(letters) ? letters.search(/[ae]/) : letters.includes('ou') ? letters.indexOf('o')
        : Math.max(...['i', 'o', 'u', 'ü'].map(v => letters.lastIndexOf(v)));
      return at < 0 ? letters : letters.slice(0, at) + MARKS[letters[at]][+tone - 1] + letters.slice(at + 1);
    }).join(' ');
  }

  return { exportText, read, readText, splitLine, guess, items, strip, marks };
})();
