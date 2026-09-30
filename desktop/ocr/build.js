/* Build desktop/ocr/bin/hanzi-ocr.exe with the C# compiler that ships with
 * Windows (.NET Framework 4.x): nothing to install, and the result runs on any
 * Windows 10 or 11. Windows' OCR engine is reached through the metadata files in
 * System32\WinMetadata.
 *
 *   node desktop/ocr/build.js            the helper
 *   node desktop/ocr/build.js render     also desktop/test/bin/render.exe, which
 *                                        draws test pictures for test/ocr.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WIN = process.env.WINDIR || 'C:\\Windows';
const FW = path.join(WIN, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const CSC = path.join(FW, 'csc.exe');
const WINMD = path.join(WIN, 'System32', 'WinMetadata');
// the facade that lets .NET Framework code see WinRT types as ordinary ones
const FACADE = path.join(WIN, 'Microsoft.NET', 'assembly', 'GAC_MSIL', 'System.Runtime',
  'v4.0_4.0.0.0__b03f5f7f11d50a3a', 'System.Runtime.dll');

function compile(sources, out, refs) {
  for (const f of [CSC, FACADE]) {
    if (!fs.existsSync(f)) throw new Error('missing ' + f + ' (it comes with Windows\' .NET Framework 4)');
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ['-nologo', '-optimize+', '-platform:x64', '-out:' + out,
    ...refs.map(r => '-r:' + r), ...sources];
  try {
    execFileSync(CSC, args, { stdio: 'pipe' });
  } catch (e) {
    throw new Error('csc failed:\n' + String(e.stdout || '') + String(e.stderr || ''));
  }
  console.log('built ' + path.relative(process.cwd(), out));
}

const here = __dirname;
compile([path.join(here, 'HanziOcr.cs'), path.join(here, 'TextReader.cs')], path.join(here, 'bin', 'hanzi-ocr.exe'), [
  'System.Drawing.dll', 'System.Web.Extensions.dll', FACADE,
  // UI Automation, for text read straight from programs (TextReader.cs)
  ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(n => path.join(FW, 'WPF', n + '.dll')),
  // for Windows.Foundation.Rect, which .NET maps to a struct of its own
  path.join(FW, 'System.Runtime.WindowsRuntime.dll'),
  ...['Foundation', 'Globalization', 'Graphics', 'Media', 'Security', 'Storage']
    .map(n => path.join(WINMD, 'Windows.' + n + '.winmd')),
]);

if (process.argv.includes('render')) {
  const test = path.join(here, '..', 'test');
  compile([path.join(test, 'render.cs')], path.join(test, 'bin', 'render.exe'),
    ['System.Drawing.dll', 'System.Web.Extensions.dll']);
}
