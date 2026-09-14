// Runs sync/Code.gs locally, so the site's sync can be tried without a Google
// account. The Apps Script services it uses are stubbed with an in-memory sheet,
// and requests are answered the way a deployed web app answers them: the POST
// gets a 302 to a second URL that serves the JSON, both with CORS open.
//
//   node sync/mock-server.js [port] [sync-key]
//   then in HanziHome: Settings -> Sync, URL http://localhost:8787/exec
//
// Development aid only; the real thing is the deployed Apps Script.

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PORT = Number(process.argv[2]) || 8787;
const KEY = process.argv[3] || 'test-key';

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
  };
}

const sheets = {};
const context = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: name => sheets[name] || null,
      insertSheet: name => (sheets[name] = makeSheet()),
    }),
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'SYNC_KEY' ? KEY : null) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: text => ({ text, setMimeType() { return this; } }),
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), context, { filename: 'Code.gs' });

/* ---- HTTP, shaped like script.google.com ---- */

const pending = new Map();
let nextId = 1;
const cors = { 'Access-Control-Allow-Origin': '*' };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') {           // Apps Script cannot answer a preflight either
    res.writeHead(405, cors); return res.end();
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
  if (url.pathname === '/echo') {
    const text = pending.get(url.searchParams.get('id'));
    pending.delete(url.searchParams.get('id'));
    res.writeHead(text ? 200 : 404, { ...cors, 'Content-Type': 'application/json' });
    return res.end(text || '{}');
  }
  res.writeHead(404, cors); res.end();
}).listen(PORT, () => console.log(`HanziHome sync mock on http://localhost:${PORT}/exec (key: ${KEY})`));
