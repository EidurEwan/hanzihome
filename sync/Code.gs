/**
 * HanziHome sync — a Google Apps Script web app that keeps one copy of your
 * progress (statuses, lists, notes, study schedule) in this Google Sheet, so
 * every browser you use HanziHome in can share it.
 *
 * Setup (details in the project README, "Syncing between devices"):
 *   1. Create a Google Sheet, then Extensions → Apps Script. Paste this file.
 *   2. Deploy → New deployment → Web app. Execute as: Me. Who has access:
 *      Anyone. Copy the /exec URL.
 *   3. In HanziHome: Settings → Sync with Google Sheets → paste the URL.
 *
 * There is no password: anyone who has the /exec URL can read and replace
 * the synced copy, so treat the URL as private.
 *
 * The site talks to this script with POST requests whose body is JSON sent as
 * text/plain (so browsers do not send a CORS preflight, which Apps Script
 * cannot answer).
 *
 *   {action: "pull"}                 -> {ok, rev, updatedAt, data}
 *   {action: "push", baseRev, data}  -> {ok, rev, updatedAt}
 *                                          or {ok: false, conflict: true, rev, updatedAt, data}
 *
 * `rev` goes up by one on every accepted push. A push is only accepted when
 * its baseRev matches the stored rev; otherwise the caller gets the newer copy
 * back, merges, and tries again.
 *
 * @OnlyCurrentDoc  (this script can only open the sheet it is attached to)
 */

var SHEET_NAME = 'HanziHome sync';
var CHUNK = 45000;          // a cell holds at most 50,000 characters
var MAX_BYTES = 5000000;    // refuse anything absurd
var VERSION = 3;            // shown by doGet, so you can tell which code a deployment runs

function doGet() {
  // Opening the /exec URL in a browser shows this. It also checks the Sheet can
  // be opened, because that is what fails when the script isn't attached to one
  // or hasn't been authorised, while this page itself still loads.
  var info = { ok: true, app: 'HanziHome sync', version: VERSION };
  try {
    sheet_();
    info.sheet = 'ok';
  } catch (err) {
    info.ok = false;
    info.sheet = 'error';
    info.problem = messageOf_(err);
  }
  return json_(info);
}

function doPost(e) {
  // An uncaught exception makes Google answer with an HTML page the browser is
  // not allowed to read, so every failure is turned into a JSON reply instead.
  try {
    return handle_(e);
  } catch (err) {
    return json_({ ok: false, error: 'script-error', message: messageOf_(err) });
  }
}

function handle_(e) {
  var req;
  try {
    var body = e && e.postData ? e.postData.contents : '';
    if (body.length > MAX_BYTES) return json_({ ok: false, error: 'too-large' });
    req = JSON.parse(body || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad-json' });
  }

  if (req.action === 'pull') {
    var cur = read_();
    return json_({ ok: true, rev: cur.rev, updatedAt: cur.updatedAt, data: cur.data });
  }

  if (req.action === 'push') {
    if (!req.data || typeof req.data !== 'object') return json_({ ok: false, error: 'no-data' });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json_({ ok: false, error: 'busy' });
    try {
      var now = read_();
      if (Number(req.baseRev) !== now.rev) {
        return json_({ ok: false, conflict: true, rev: now.rev, updatedAt: now.updatedAt, data: now.data });
      }
      var saved = write_(req.data, now.rev + 1);
      return json_({ ok: true, rev: saved.rev, updatedAt: saved.updatedAt });
    } finally {
      lock.releaseLock();
    }
  }

  return json_({ ok: false, error: 'unknown-action' });
}

/* ---- storage: A1 rev, B1 time saved, column A from row 2 = JSON in chunks ---- */

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('This script is not attached to a Google Sheet. Open the Sheet, choose '
      + 'Extensions → Apps Script, paste the code there and deploy that project instead.');
  }
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange('A1:B1').setValues([[0, '']]);
  }
  return sh;
}

function read_() {
  var sh = sheet_();
  var head = sh.getRange('A1:B1').getValues()[0];
  var rev = Number(head[0]) || 0;
  var updatedAt = head[1] ? String(head[1]) : null;
  var last = sh.getLastRow();
  if (!rev || last < 2) return { rev: rev, updatedAt: updatedAt, data: null };
  var text = sh.getRange(2, 1, last - 1, 1).getValues()
    .map(function (r) { return String(r[0]).replace(/^~/, ''); }).join('');
  var data = null;
  try { data = JSON.parse(text); } catch (err) { data = null; }
  return { rev: rev, updatedAt: updatedAt, data: data };
}

function write_(data, rev) {
  var sh = sheet_();
  var text = JSON.stringify(data);
  var rows = [];
  for (var i = 0; i < text.length; i += CHUNK) rows.push([text.slice(i, i + CHUNK)]);
  var last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, 1).clearContent();
  // Each chunk starts with "~" and the column is plain text, so Sheets never
  // reads a chunk as a number, date or formula. read_() strips the marker.
  if (rows.length) {
    var range = sh.getRange(2, 1, rows.length, 1);
    range.setNumberFormat('@');
    range.setValues(rows.map(function (r) { return ['~' + r[0]]; }));
  }
  var updatedAt = new Date().toISOString();
  sh.getRange('A1:B1').setValues([[rev, updatedAt]]);
  return { rev: rev, updatedAt: updatedAt };
}

function messageOf_(err) {
  return String((err && err.message) || err);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
