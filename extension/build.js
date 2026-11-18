/* build.js — make the browser extension ready to load, and pack it.
 *
 *   node extension/build.js          copy the reader's engine and data into extension/hz/
 *                                    and make a copy for Firefox in extension/dist/firefox/
 *                                    (then load extension/ or that copy unpacked: see README)
 *   node extension/build.js --zip    ...and pack extension/dist/hanzihome-extension-<version>-{chrome,firefox}.zip,
 *                                    for the Chrome Web Store and Firefox Add-ons
 *
 * The extension uses the site's own files, so they aren't kept twice in the repo:
 * site/textstory.js and site/learn.js, and site/data/{index,readings,readerwords}.js
 * (built by build/export_reader.py). */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EXT = __dirname;
const SITE = path.join(EXT, '..', 'site');
const COPY = {
  'hz/textstory.js': 'textstory.js',
  'hz/learn.js': 'learn.js',
  'hz/index.js': 'data/index.js',
  'hz/readings.js': 'data/readings.js',
  'hz/readerwords.js': 'data/readerwords.js',
};
// everything the extension is made of (the zip holds these and nothing else)
const FILES = ['manifest.json', 'background.js', 'hz-init.js', 'content.js', 'content.css', 'bridge.js', 'page.js',
  'action.html', 'action.css', 'action.js',
  'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png', ...Object.keys(COPY)];

fs.mkdirSync(path.join(EXT, 'hz'), { recursive: true });
for (const [to, from] of Object.entries(COPY)) fs.copyFileSync(path.join(SITE, from), path.join(EXT, to));
console.log('copied the reader into extension/hz/');

/* Firefox runs the background as an event page, not a service worker: the same files,
   listed in its manifest instead of loaded by importScripts. manifest.json is Chrome's
   (and Edge's); Firefox's is made from it into dist/firefox/, a complete copy. */
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const firefox = Object.assign({}, manifest, {
  background: { scripts: ['hz-init.js', ...Object.keys(COPY).filter(f => f !== 'hz/textstory.js' && f !== 'hz/learn.js'),
    'hz/textstory.js', 'hz/learn.js', 'background.js'] },
  browser_specific_settings: { gecko: { id: 'hanzihome@eidurewan.github.io', strict_min_version: '140.0' } },
});
const FF = path.join(EXT, 'dist', 'firefox');
for (const f of FILES) {
  fs.mkdirSync(path.dirname(path.join(FF, f)), { recursive: true });
  if (f === 'manifest.json') fs.writeFileSync(path.join(FF, f), JSON.stringify(firefox, null, 2) + '\n');
  else fs.copyFileSync(path.join(EXT, f), path.join(FF, f));
}
console.log('made the Firefox copy in extension/dist/firefox/');

if (process.argv.includes('--zip')) {
  for (const [name, dir] of [['chrome', EXT], ['firefox', FF]]) {
    const out = path.join(EXT, 'dist', `hanzihome-extension-${manifest.version}-${name}.zip`);
    fs.writeFileSync(out, zip(FILES.map(f => [f, fs.readFileSync(path.join(dir, f))])));
    console.log('packed', path.relative(process.cwd(), out), (fs.statSync(out).size / 1e6).toFixed(1) + ' MB');
  }
}

/* a plain zip file (deflated), [[name, Buffer]] -> Buffer */
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1;
  for (const [name, data] of files) {
    const nameB = Buffer.from(name, 'utf8');
    const body = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8); head.writeUInt16LE(DOS_TIME, 10); head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameB.length, 26); head.writeUInt16LE(0, 28);
    local.push(head, nameB, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10); c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameB.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameB);
    offset += 30 + nameB.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
