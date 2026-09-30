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
 *   {action: "rev"}                  -> {ok, rev, updatedAt}  (cheap: has anything changed?)
 *   {action: "pull"}                 -> {ok, rev, updatedAt, data}
 *   {action: "push", baseRev, data, reset}
 *                                    -> {ok, rev, updatedAt}
 *                                          or {ok: false, conflict: true, rev, updatedAt, data}
 *                                          or {ok: false, error: "shrink", have, got}
 *   {action: "backups"}              -> {ok, backups: [{time, rev, heft}]}  (newest first)
 *   {action: "restore", rev}         -> {ok, rev, updatedAt}  (that earlier copy, saved anew)
 *   any may answer {ok: false, error: "busy"} (a save took too long to finish)
 *
 * `rev` goes up by one on every accepted push. A push is only accepted when
 * its baseRev matches the stored rev; otherwise the caller gets the newer copy
 * back, merges, and tries again.
 *
 * Reads and saves take turns (a script lock), so a copy is never read half-way
 * through a save, and the saved length is kept beside it to make sure: a copy
 * that doesn't come back whole is reported as "unreadable", never as empty.
 *
 * A push that would leave less than half of what the copy holds (statuses,
 * review items, known components, notes, list entries: heft_) is refused with
 * "shrink", unless it says reset (Reset everything, on purpose): a device whose
 * data was emptied can't empty everyone else's. And earlier copies are kept in a
 * second sheet, "HanziHome backups": the last 30, one at most every half hour,
 * and always before a big drop or a restore.
 *
 * @OnlyCurrentDoc  (this script can only open the sheet it is attached to)
 */

var SHEET_NAME = 'HanziHome sync';
var CHUNK = 45000;          // a cell holds at most 50,000 characters
var MAX_BYTES = 5000000;    // refuse anything absurd
var VERSION = 5;            // shown by doGet, so you can tell which code a deployment runs
var BACKUPS = 30;           // earlier copies kept
var BACKUP_EVERY = 30 * 60 * 1000;
var SHRINK_MIN = 20;        // copies smaller than this may shrink freely

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

  if (req.action === 'rev') {
    // the revision is written last, in one go, so it can be read at any time
    var h = head_();
    return json_({ ok: true, rev: h.rev, updatedAt: h.updatedAt });
  }

  if (req.action === 'backups') {
    return json_({ ok: true, backups: listBackups_() });
  }

  if (req.action === 'pull' || req.action === 'push' || req.action === 'restore') {
    if (req.action === 'push' && (!req.data || typeof req.data !== 'object')) return json_({ ok: false, error: 'no-data' });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json_({ ok: false, error: 'busy' });
    try {
      if (req.action === 'pull') {
        var cur = read_();
        return json_({ ok: true, rev: cur.rev, updatedAt: cur.updatedAt, data: cur.data });
      }
      var head = head_();
      if (req.action === 'restore') {
        var old = backupText_(Number(req.rev));
        if (old === null) return json_({ ok: false, error: 'no-backup' });
        backup_(head, true);
        var back = write_(JSON.parse(old), head.rev + 1);
        return json_({ ok: true, rev: back.rev, updatedAt: back.updatedAt });
      }
      if (Number(req.baseRev) !== head.rev) {
        var now = read_();
        return json_({ ok: false, conflict: true, rev: now.rev, updatedAt: now.updatedAt, data: now.data });
      }
      var had = currentHeft_(head), got = heft_(req.data);
      if (!req.reset && had >= SHRINK_MIN && got < had / 2) {
        return json_({ ok: false, error: 'shrink', rev: head.rev, have: had, got: got });
      }
      backup_(head, got < had * 0.8);
      var saved = write_(req.data, head.rev + 1);
      return json_({ ok: true, rev: saved.rev, updatedAt: saved.updatedAt });
    } catch (err) {
      if (err && err.unreadable) return json_({ ok: false, error: 'unreadable' });
      throw err;
    } finally {
      lock.releaseLock();
    }
  }

  return json_({ ok: false, error: 'unknown-action' });
}

/* ---- storage: A1 rev, B1 time saved, C1 length, D1 heft, column A from row 2 = JSON in chunks ---- */

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

function head_() {
  var head = sheet_().getRange('A1:D1').getValues()[0];
  return { rev: Number(head[0]) || 0, updatedAt: head[1] ? String(head[1]) : null, length: Number(head[2]) || 0,
    heft: head[3] === '' || head[3] === null ? null : Number(head[3]) };
}

/* how much a copy holds: statuses, review items, known components, notes, list entries */
function heft_(d) {
  if (!d || typeof d !== 'object') return 0;
  var n = function (o) { return o && typeof o === 'object' ? Object.keys(o).length : 0; };
  var lists = 0;
  if (Array.isArray(d.lists)) d.lists.forEach(function (l) { lists += ((l && l.chars) || []).length; });
  return n(d.status) + n(d.items) + n(d.comps) + n(d.notes) + lists;
}

/* the current copy's heft: kept beside it, or (saved by an older script) counted once */
function currentHeft_(head) {
  if (head.heft !== null) return head.heft;
  if (!head.rev) return 0;
  try { return heft_(read_().data); } catch (err) { return 0; }
}

/* the current copy as saved text (not parsed) */
function rawText_() {
  var sh = sheet_(), last = sh.getLastRow();
  return last < 2 ? '' : sh.getRange(2, 1, last - 1, 1).getValues()
    .map(function (r) { return String(r[0]).replace(/^~/, ''); }).join('');
}

/* ---- earlier copies: sheet "HanziHome backups", A1 the next slot; slots in rows 2..,
   each [time, rev, heft, length, JSON in chunks from column E] ---- */

function backupSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('HanziHome backups');
  if (!sh) {
    sh = ss.insertSheet('HanziHome backups');
    sh.getRange('A1').setValues([[0]]);
  }
  return sh;
}

/* keep the current copy before it is replaced: if the last kept one is older than
   BACKUP_EVERY, or always (a big drop, a restore) */
function backup_(head, always) {
  if (!head.rev) return;
  var list = listBackups_();
  if (!always && list.length && Date.now() - new Date(list[0].time).getTime() < BACKUP_EVERY) return;
  var text = rawText_();
  if (!text) return;
  var sh = backupSheet_();
  var slot = (Number(sh.getRange('A1').getValues()[0][0]) || 0) % BACKUPS;
  var row = 2 + slot;
  var width = Math.max(sh.getLastColumn(), 4);
  sh.getRange(row, 1, 1, width).clearContent();
  var cells = [new Date().toISOString(), head.rev, currentHeft_(head), text.length];
  for (var i = 0; i < text.length; i += CHUNK) cells.push('~' + text.slice(i, i + CHUNK));
  var range = sh.getRange(row, 1, 1, cells.length);
  range.setNumberFormat('@');
  range.setValues([cells]);
  sh.getRange('A1').setValues([[slot + 1]]);
}

function listBackups_() {
  var sh = backupSheet_();
  var rows = sh.getRange(2, 1, BACKUPS, 3).getValues();
  var list = [];
  rows.forEach(function (r) { if (r[0]) list.push({ time: String(r[0]), rev: Number(r[1]), heft: Number(r[2]) }); });
  return list.sort(function (a, b) { return a.time < b.time ? 1 : -1; });
}

/* an earlier copy's text, by the revision it had */
function backupText_(rev) {
  var sh = backupSheet_();
  var width = Math.max(sh.getLastColumn(), 5);
  var rows = sh.getRange(2, 1, BACKUPS, width).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] && Number(rows[i][1]) === rev) {
      return rows[i].slice(4).filter(function (v) { return v !== ''; })
        .map(function (v) { return String(v).replace(/^~/, ''); }).join('');
    }
  }
  return null;
}

function read_() {
  var sh = sheet_();
  var head = head_();
  var last = sh.getLastRow();
  if (!head.rev) return { rev: 0, updatedAt: head.updatedAt, data: null };
  var text = last < 2 ? '' : sh.getRange(2, 1, last - 1, 1).getValues()
    .map(function (r) { return String(r[0]).replace(/^~/, ''); }).join('');
  // saved before, so there must be a whole copy: anything else is reported, not taken for empty
  var data = null;
  try { data = JSON.parse(text); } catch (err) { data = null; }
  if (!data || (head.length && text.length !== head.length)) {
    var e = new Error('The saved copy could not be read whole.');
    e.unreadable = true;
    throw e;
  }
  return { rev: head.rev, updatedAt: head.updatedAt, data: data };
}

function write_(data, rev) {
  var sh = sheet_();
  var text = JSON.stringify(data);
  var rows = [];
  for (var i = 0; i < text.length; i += CHUNK) rows.push([text.slice(i, i + CHUNK)]);
  var last = sh.getLastRow();
  // Each chunk starts with "~" and the column is plain text, so Sheets never
  // reads a chunk as a number, date or formula. read_() strips the marker.
  // The new chunks go over the old ones, and only rows left over are cleared.
  if (rows.length) {
    var range = sh.getRange(2, 1, rows.length, 1);
    range.setNumberFormat('@');
    range.setValues(rows.map(function (r) { return ['~' + r[0]]; }));
  }
  if (last > rows.length + 1) sh.getRange(rows.length + 2, 1, last - rows.length - 1, 1).clearContent();
  var updatedAt = new Date().toISOString();
  sh.getRange('A1:D1').setValues([[rev, updatedAt, text.length, heft_(data)]]);
  return { rev: rev, updatedAt: updatedAt };
}

function messageOf_(err) {
  return String((err && err.message) || err);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
