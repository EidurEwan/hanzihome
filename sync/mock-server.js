// Runs sync/Code.gs locally, so the site's sync can be tried without a Google
// account. The Apps Script services it uses are stubbed with an in-memory sheet,
// and requests are answered the way a deployed web app answers them: the POST
// gets a 302 to a second URL that serves the JSON, both with CORS open.
//
//   node sync/mock-server.js [port] [mode]
//   then in HanziHome: Settings -> Sync, URL http://localhost:8787/exec
//
// mode reproduces a broken deployment:
//   signin      every request is sent to a Google sign-in page (access not "Anyone")
//   standalone  the script isn't attached to a Sheet
//
// Development aid only; the real thing is the deployed Apps Script. Required as a
// module (test/sync.js), it only loads the script: load(mode) -> {context, sheets}.

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const PORT = Number(process.argv[2]) || 8787;
const MODE = process.argv[3] || 'ok';

/* ---- a small stand-in for the Sheets / Properties / Lock / Content services ---- */

function makeSheet() {
  const cells = new Map();                 // "row,col" -> value
  let lastRow = 0;
  const a1 = ref => {                      // "A1:B1" -> [row, col, rows, cols]
    const m = ref.match(/^([A-Z])(\d+)(?::([A-Z])(\d+))?$/);
    const c1 = m[1].charCodeAt(0) - 64, r1 = +m[2];
    const c2 = m[3] ? m[3].charCodeAt(0) - 64 : c1, r2 = m[4] ? +m[4] : r1;
    return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
  };
  const range = (row, col, rows, cols) => ({
    getValues() {
      const out = [];
      for (let r = 0; r < rows; r++) {
        const line = [];
        for (let c = 0; c < cols; c++) {
          const v = cells.get(`${row + r},${col + c}`);
          line.push(v === undefined ? '' : v);
        }
        out.push(line);
      }
      return out;
    },
    setValues(values) {
      values.forEach((line, r) => line.forEach((v, c) => {
        cells.set(`${row + r},${col + c}`, v);
        if (v !== '' && row + r > lastRow) lastRow = row + r;
      }));
    },
    clearContent() {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.delete(`${row + r},${col + c}`);
      lastRow = 0;
      for (const k of cells.keys()) lastRow = Math.max(lastRow, +k.split(',')[0]);
    },
    setNumberFormat() { return this; },
  });
  return {
    getRange(a, b, c, d) { return typeof a === 'string' ? range(...a1(a)) : range(a, b, c || 1, d || 1); },
    getLastRow() { return lastRow; },
    getLastColumn() { let c = 0; for (const k of cells.keys()) c = Math.max(c, +k.split(',')[1]); return c; },
  };
}

function load(mode = MODE) {
const sheets = {};
const stored = new Map(), cache = new Map();
const props = {
  getProperty: k => stored.get(k) ?? null,
  setProperties: o => { for (const [k, v] of Object.entries(o)) stored.set(k, String(v)); },
  deleteProperty: k => { stored.delete(k); },
};
const context = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => (mode === 'standalone' ? null : {
      getSheetByName: name => sheets[name] || null,
      insertSheet: name => (sheets[name] = makeSheet()),
    }),
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => props },
  CacheService: { getScriptCache: () => ({ get: k => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, text) => [...crypto.createHash(alg).update(text, 'utf8').digest()].map(b => (b << 24) >> 24),
    base64Encode: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64'),
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: text => ({ text, setMimeType() { return this; } }),
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), context, { filename: 'Code.gs' });
return { context, sheets };
}

module.exports = { load, makeSheet };
if (require.main === module) serve();

function serve() {
const { context, sheets } = load();

/* ---- HTTP, shaped like script.google.com ---- */

const pending = new Map();
let nextId = 1;
const cors = { 'Access-Control-Allow-Origin': '*' };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') {           // Apps Script cannot answer a preflight either
    res.writeHead(405, cors); return res.end();
  }
  if (MODE === 'signin' && url.pathname === '/exec') {
    // Google's sign-in redirect carries no CORS header, so the browser can't read it
    res.writeHead(302, { Location: 'https://accounts.google.com/ServiceLogin' });
    return res.end();
  }
  if (url.pathname === '/exec' && req.method === 'GET') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end(context.doGet().text);
  }
  if (url.pathname === '/exec' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const out = context.doPost({ postData: { contents: body, type: req.headers['content-type'] } });
      const id = String(nextId++);
      pending.set(id, out.text);
      res.writeHead(302, { ...cors, Location: `/echo?id=${id}` });
      res.end();
    });
    return;
  }
  // a test hook: the sheet as it is half-way through a save in the first scripts,
  // its data rows cleared and not yet written again (the revision still the old one)
  if (url.pathname === '/mock/half-saved') {
    const sh = sheets['HanziHome sync'];
    if (sh && sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 1).clearContent();
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rev: sh ? sh.getRange('A1').getValues()[0][0] : 0 }));
  }
  if (url.pathname === '/echo') {
    const text = pending.get(url.searchParams.get('id'));
    pending.delete(url.searchParams.get('id'));
    res.writeHead(text ? 200 : 404, { ...cors, 'Content-Type': 'application/json' });
    return res.end(text || '{}');
  }
  res.writeHead(404, cors); res.end();
}).listen(PORT, () => console.log(`HanziHome sync mock on http://localhost:${PORT}/exec (${MODE})`));
}
