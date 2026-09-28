/* data.js — load the site's data files into Node.
 *
 * Each site/data/*.js file is a script assigning to a global HZ (so the site
 * works from file://). Running them in a sandbox with an HZ object gives Node
 * the same data the browser has.
 *
 *   const HZ = loadHZ(['index', 'readings', 'readerwords']);
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DATA = path.join(__dirname, '..', '..', 'site', 'data');

function loadHZ(files, HZ = { index: {}, chunk: {}, phoneticSets: {}, meta: {}, radicalMap: {} }) {
  const ctx = vm.createContext({ HZ });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(DATA, f + '.js'), 'utf8'), ctx);
  return HZ;
}

module.exports = { loadHZ, DATA };
