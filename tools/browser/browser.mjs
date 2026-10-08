// Shared browser harness for tools/browser/*.mjs.
//
// WHY THIS EXISTS AS A MODULE
// ---------------------------
// Every script here needs the same two things, and both were originally hardcoded
// to one machine: an absolute path to Chrome, and a `createRequire` pointed at
// `C:/Users/HP/AppData/Roaming/npm/node_modules/lighthouse` because that is where
// `puppeteer-core` happened to be vendored. Seven copies of that pair is seven
// places to fix when the machine changes, and a tracked script that cannot run on
// a clean checkout is worse than no script at all.
//
// puppeteer-core is resolved rather than depended on. It is not a direct
// dependency of this repo (the site has no npm install step at all - Quarto
// vendors its own libs), and the cheapest source of it on a dev machine is the
// copy `lighthouse` vendors under its own node_modules. So: try the places it
// might be, and if none has it, say exactly what to set instead of failing with
// a MODULE_NOT_FOUND that names an unrelated specifier.
//
// WHY THESE LIVE OUTSIDE .github/scripts/
// --------------------------------------
// verify.yml names the two files it runs explicitly, but that directory is
// committed and reads as "this runs in CI". None of these can: there is no
// browser in a GitHub Actions ubuntu runner. Keeping them separate means the
// CI gate stays honest about what it proves.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// --- Chrome ----------------------------------------------------------------

const WINDOWS_CHROME = [
  '%ProgramFiles%/Google/Chrome/Application/chrome.exe',
  '%ProgramFiles(x86)%/Google/Chrome/Application/chrome.exe',
  '%LOCALAPPDATA%/Google/Chrome/Application/chrome.exe',
];
const UNIX_CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // darwin
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

// Expanded here rather than at use, so an unset ProgramFiles(x86) on 64-bit
// Windows yields a miss instead of a literal "%ProgramFiles(x86)%" path that
// happens to exist.
function expand(p) {
  return p.replace(/%([^%]+)%/g, (m, name) => process.env[name] || m);
}

function findChrome() {
  if (process.env.CHROME_PATH) {
    if (!fs.existsSync(process.env.CHROME_PATH)) {
      throw new Error(
        `CHROME_PATH is set to "${process.env.CHROME_PATH}" but no such file exists.\n` +
        `Unset it to fall back to the usual install locations.`
      );
    }
    return process.env.CHROME_PATH;
  }
  const candidates =
    process.platform === 'win32'
      ? WINDOWS_CHROME
      : process.platform === 'darwin'
        ? UNIX_CHROME.slice(0, 1)
        : UNIX_CHROME;
  for (const c of candidates) {
    const p = expand(c);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    'Could not find Chrome. Tried:\n  ' + candidates.map(expand).join('\n  ') +
    '\nSet CHROME_PATH to your Chrome executable, e.g.\n' +
    '  CHROME_PATH="/usr/bin/google-chrome" node tools/browser/audit4.mjs _site\n' +
    '  (PowerShell: $env:CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")'
  );
}

export const CHROME = findChrome();

// --- puppeteer-core --------------------------------------------------------

// Each entry is a directory to resolve "puppeteer-core" from. Ordered by how
// likely it is to be right on a dev machine.
//
// Deliberately NOT shelling out to `npm root -g`. Node refuses to spawn a .cmd
// without a shell, so on Windows that needs `shell: true`, which prints a
// DEP0190 deprecation warning on every run of every script - and the argument
// is a constant, so the warning is pure noise. Every candidate below is
// derivable from the environment instead, and the whole thing costs no
// subprocess spawn.
function puppeteerRoots() {
  const roots = [];
  if (process.env.PUPPETEER_PATH) roots.push(process.env.PUPPETEER_PATH);

  if (process.platform === 'win32') {
    // npm's default global prefix for a per-user install is %APPDATA%\npm, and
    // the modules land beside it. Also covers a machine-wide nodejs install.
    if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules'));
    roots.push(path.join(process.env.ProgramFiles || 'C:/Program Files', 'nodejs', 'node_modules'));
  } else {
    roots.push('/usr/local/lib/node_modules');
    roots.push('/usr/lib/node_modules');
    if (process.env.NPM_CONFIG_PREFIX) roots.push(path.join(process.env.NPM_CONFIG_PREFIX, 'lib', 'node_modules'));
    if (process.env.HOME) roots.push(path.join(process.env.HOME, '.npm-global', 'lib', 'node_modules'));
  }

  roots.push(path.join(import.meta.dirname, '..', '..', 'node_modules'));
  return roots;
}

function loadPuppeteer() {
  // lighthouse vendors puppeteer-core under its own node_modules, so each
  // candidate is worth trying twice: as a parent of `lighthouse`, and directly.
  const roots = [];
  for (const r of puppeteerRoots()) {
    roots.push(path.join(r, 'lighthouse'));
    roots.push(r);
  }
  const tried = [];
  for (const root of roots) {
    tried.push(root);
    try {
      return createRequire(path.join(root, '/'))('puppeteer-core');
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    'Could not load "puppeteer-core". Looked in:\n  ' + tried.join('\n  ') +
    '\n\nIt is not a dependency of this repo, so install it somewhere and point at it:\n' +
    '  npm i -g puppeteer-core\n' +
    '  PUPPETEER_PATH="$(npm root -g)" node tools/browser/audit4.mjs _site\n' +
    '(a global "lighthouse" also works - it vendors puppeteer-core)'
  );
}

export const puppeteer = loadPuppeteer();

// --- convenience -----------------------------------------------------------

// `headless: 'new'` is what every script in this session used; keeping it in one
// place means a Chrome that drops the old headless mode breaks here once, loudly.
export function launch(opts = {}) {
  return puppeteer.launch({ executablePath: CHROME, headless: 'new', ...opts });
}

// Scratch output. The originals wrote to `%TEMP%/opencode/...`, which is a
// Windows-only path plus one person's username. os.tmpdir() is the portable
// form; nothing here is worth keeping across reboots.
export function outDir(name) {
  const dir = path.join(os.tmpdir(), 'aravind-browser', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}