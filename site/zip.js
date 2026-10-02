/* zip.js — reading zip archives in the page: Anki decks (anki.js) and EPUB books
 * (books.js). The browser's own DecompressionStream does the inflating.
 *
 *   Zip.files(bytes)        {name: {method, data}} from the central directory
 *   await Zip.read(file)    a file's bytes, inflated
 *   await Zip.text(file)    the same as UTF-8 text
 */

'use strict';

const Zip = (() => {
  function files(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("That file isn't a zip archive.");
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      out[name] = { method, data: buf.subarray(start, start + size) };
      p += 46 + nameLen + extra + comment;
    }
    return out;
  }

  async function read(f) {
    if (f.method === 0) return f.data;
    if (f.method !== 8) throw new Error('That file is packed in a way this page can\'t read (zip method ' + f.method + ').');
    const stream = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const text = async f => new TextDecoder().decode(await read(f));

  return { files, read, text };
})();
