/* books.js — books and long texts in the reader.
 *
 * An EPUB or a plain text file (UTF-8, or GB18030 as many Chinese .txt files are)
 * becomes chapters, and the chapters pages of at most PAGE characters, split
 * between paragraphs, so each page glosses quickly. Books are kept in this
 * browser's IndexedDB with the page you are on: a novel is too big for
 * localStorage, and a book is reading matter, not progress, so it isn't synced.
 * Chapters without Chinese (a copyright page, a cover) are left out.
 *
 *   await Books.open(file)   read a file and keep it: the book
 *   await Books.list()       [{id, title, author, pages, at}], newest first
 *   await Books.get(id)      the whole book: {…, pages: [{ch, text}]}
 *   await Books.seen(id, n)  remember the page
 *   await Books.remove(id)
 */

'use strict';

const Books = (() => {
  const PAGE = 5000;
  const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
  const hasHan = s => [...s].some(isHan);

  // ---------------------------------------------------------------- storage

  let _db = null;
  function db() {
    if (_db) return _db;
    _db = new Promise((res, rej) => {
      const r = indexedDB.open('hanzihome-books', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('books', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(new Error('This browser won\'t keep books (its storage is off or full).'));
    });
    return _db;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('books', mode), store = t.objectStore('books');
      const r = fn(store);
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = () => rej(t.error);
    });
  }
  const get = id => tx('readonly', s => s.get(id));
  const put = book => tx('readwrite', s => s.put(book));
  const remove = id => tx('readwrite', s => s.delete(id));
  async function list() {
    const all = (await tx('readonly', s => s.getAll())) || [];
    return all.map(b => ({ id: b.id, title: b.title, author: b.author, pages: b.pages.length, at: b.at || 0, added: b.added }))
      .sort((a, b) => b.added - a.added);
  }
  async function seen(id, n) {
    const b = await get(id);
    if (b && b.at !== n) { b.at = n; await put(b); }
  }

  // ---------------------------------------------------------------- reading

  async function open(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const book = buf[0] === 0x50 && buf[1] === 0x4b ? await epub(buf) : txt(buf, file.name);
    book.pages = paginate(book.chapters.filter(c => hasHan(c.text)));
    delete book.chapters;
    if (!book.pages.length) throw new Error('There is no Chinese in that file.');
    book.id = 'b' + Date.now().toString(36);
    book.added = Date.now();
    book.at = 0;
    await put(book);
    return book;
  }

  /* plain text: chapters start at lines like 第三章 or 第十回 */
  function txt(buf, name) {
    let text = new TextDecoder().decode(buf);
    if ((text.match(/�/g) || []).length > text.length / 200) {
      try { text = new TextDecoder('gb18030').decode(buf); } catch (e) { /* keep UTF-8 */ }
    }
    const chapters = [];
    let cur = { ch: '', text: '' };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (/^第[零〇一二三四五六七八九十百千万两0-9]+[章回节節卷部篇集]/.test(line) && [...line].length <= 40) {
        if (cur.text.trim()) chapters.push(cur);
        cur = { ch: line, text: '' };
      } else if (line) cur.text += line + '\n';
    }
    if (cur.text.trim()) chapters.push(cur);
    return { title: name.replace(/\.[^.]+$/, ''), author: '', chapters };
  }

  async function epub(buf) {
    const files = Zip.files(buf);
    const find = p => files[p] || files[decodeURIComponent(p)] || null;
    const text = async p => { const f = find(p); return f ? Zip.text(f) : null; };
    const container = await text('META-INF/container.xml');
    const opfPath = container && (container.match(/full-path\s*=\s*"([^"]+)"/) || [])[1];
    if (!opfPath) throw new Error("That file isn't a book this page can read (no EPUB contents).");
    const opf = new DOMParser().parseFromString(await text(opfPath), 'application/xml');
    const tag = (doc, n) => [...doc.getElementsByTagNameNS('*', n)];
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const hrefs = {};
    tag(opf, 'item').forEach(it => { hrefs[it.getAttribute('id')] = it.getAttribute('href'); });
    const chapters = [];
    for (const ref of tag(opf, 'itemref')) {
      const href = hrefs[ref.getAttribute('idref')];
      if (!href) continue;
      const src = await text(resolve(base, href.split('#')[0]));
      if (!src) continue;
      let doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
      if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(src, 'text/html');
      const body = doc.body || doc.getElementsByTagNameNS('*', 'body')[0];
      if (!body) continue;
      const head = body.querySelector('h1, h2, h3');
      chapters.push({ ch: head ? head.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : '', text: blocks(body) });
    }
    const meta = n => { const e = tag(opf, n)[0]; return e ? e.textContent.trim() : ''; };
    return { title: meta('title') || 'Book', author: meta('creator'), chapters };
  }

  function resolve(base, href) {
    const parts = (base + href).split('/');
    const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
    return out.join('/');
  }

  /* an XHTML body's text, a line per paragraph, heading or list item */
  function blocks(body) {
    const el = body.cloneNode(true);
    el.querySelectorAll('script, style, rt, rp').forEach(x => x.remove());      // ruby readings aren't text
    el.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, br, blockquote, tr, section')
      .forEach(x => x.parentNode.insertBefore(el.ownerDocument.createTextNode('\n'), x.nextSibling));
    return el.textContent.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  }

  /* chapters into pages: whole paragraphs, at most PAGE characters a page (a longer
     paragraph has a page of its own) */
  function paginate(chapters) {
    const pages = [];
    for (const c of chapters) {
      let cur = '';
      for (const para of c.text.split('\n')) {
        if (cur && cur.length + para.length > PAGE) { pages.push({ ch: c.ch, text: cur }); cur = ''; }
        cur += (cur ? '\n' : '') + para;
      }
      if (cur) pages.push({ ch: c.ch, text: cur });
    }
    return pages;
  }

  return { open, list, get, seen, remove, txt, paginate, PAGE };
})();
