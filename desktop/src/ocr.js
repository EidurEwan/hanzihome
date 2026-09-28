/* ocr.js — talk to the OCR helper (desktop/ocr/bin/hanzi-ocr.exe).
 *
 * The helper stays running and answers one JSON line per request; see the top of
 * desktop/ocr/HanziOcr.cs for the commands. Requests are answered in order, and
 * each promise settles with its own reply (matched by id).
 *
 *   const ocr = new OcrHelper();
 *   const { lines } = await ocr.request('screen', { scale: 2 });
 *   ocr.close();
 */

'use strict';

const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

// In the installed app this file is inside resources/app.asar, which Windows can't run
// programs from; electron-builder unpacks the helper to app.asar.unpacked instead.
const HELPER = path.join(__dirname, '..', 'ocr', 'bin', 'hanzi-ocr.exe')
  .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);

class OcrHelper {
  constructor(exe = HELPER) {
    this.next = 1;
    this.waiting = new Map();
    this.proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.stderr = '';
    this.proc.stderr.on('data', d => { this.stderr += d; });
    readline.createInterface({ input: this.proc.stdout }).on('line', line => {
      let reply;
      try { reply = JSON.parse(line); } catch (e) { return; }
      const w = this.waiting.get(reply.id);
      if (!w) return;
      this.waiting.delete(reply.id);
      if (reply.ok) w.resolve(reply);
      else w.reject(new Error(reply.error || 'OCR helper error'));
    });
    const fail = err => {
      for (const w of this.waiting.values()) w.reject(err);
      this.waiting.clear();
      this.dead = err;
    };
    this.proc.on('error', fail);
    this.proc.on('exit', code => fail(new Error(`OCR helper exited (${code})${this.stderr ? ': ' + this.stderr.trim() : ''}`)));
  }

  request(cmd, args = {}) {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(Object.assign({ id, cmd }, args)) + '\n');
    });
  }

  close() {
    if (!this.dead) this.proc.stdin.end(JSON.stringify({ cmd: 'quit' }) + '\n');
  }
}

module.exports = { OcrHelper, HELPER };
