// Pixel-diff every icon mask against the reference SVG it was derived from.
//
// This replaces an opacity-percentage check, which was not good enough: a real
// dense glyph (bi-linkedin, 75.5% opaque) and a malformed one (bi-file-richtext
// rendered as a solid 74%-opaque block) both sat under a 90% threshold. Ink
// coverage cannot tell "correct and dense" from "correct and sparse" apart, let
// alone from "broken". Comparing against the reference rendering can.
//
//   node iconref.mjs <siteDir> <refDir>
//
// refDir holds <name>.svg fetched from bootstrap-icons 1.11.1. Run with
// --fetch once to populate it; after that no network is needed.

import fs from 'node:fs';
import path from 'node:path';
import { puppeteer, CHROME, outDir as scratchDir } from './browser.mjs';

const site = path.resolve(process.argv[2]);
const refDir = path.resolve(process.argv[3] || scratchDir('iconref'));
const fetchRefs = process.argv.includes('--fetch');
const VERSION = '1.11.1';

// Which icons came from where. `$bi-clipboard` is Bootstrap's own glyph lifted
// from the bundle rather than from the CDN, so its reference is the bundle.
const NAMES = ['book', 'code', 'envelope', 'github', 'link-45deg', 'linkedin', 'rss', 'window', 'caret-down-fill', 'file-richtext', 'moon-fill', 'sun-fill', 'clipboard', 'check2'];

fs.mkdirSync(refDir, { recursive: true });
if (fetchRefs) {
  for (const n of NAMES) {
    const url = `https://cdn.jsdelivr.net/npm/bootstrap-icons@${VERSION}/icons/${n}.svg`;
    const r = await fetch(url);
    if (!r.ok) { console.error(`fetch failed ${n}: ${r.status}`); process.exit(1); }
    fs.writeFileSync(path.join(refDir, `${n}.svg`), await r.text());
  }
  console.log(`cached ${NAMES.length} reference SVGs in ${refDir}\n`);
}
for (const n of NAMES) {
  if (!fs.existsSync(path.join(refDir, `${n}.svg`))) { console.error(`missing reference: ${n}.svg (run with --fetch)`); process.exit(1); }
}

const css = fs.readFileSync(path.join(site, 'styles.css'), 'utf8');
const masks = {};
for (const m of css.matchAll(/\.(bi-[a-z0-9-]+)::before\s*\{[^}]*?mask-image:\s*url\("([^"]+)"\)/g))
  masks[m[1].replace(/^bi-/, '')] = m[2];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 200, height: 200 });

let bad = 0;
for (const n of NAMES) {
  if (!masks[n]) { console.log(`  FAIL ${n.padEnd(16)} no mask rule in styles.css`); bad++; continue; }
  const ref = 'data:image/svg+xml,' + encodeURIComponent(fs.readFileSync(path.join(refDir, `${n}.svg`), 'utf8'));
  const r = await page.evaluate(async (ours, theirs) => {
    const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode')); i.src = src; });
    const S = 96;
    // Both are black-on-transparent SVGs, and both are used as ALPHA masks, so
    // the alpha channel IS the glyph. Draw each to the same canvas and compare
    // alpha: that is exactly what the browser does with mask-image, with no
    // dependence on how the URI happens to be escaped.
    const alpha = async (src) => {
      const img = await load(src);
      const c = document.createElement('canvas'); c.width = S; c.height = S;
      const x = c.getContext('2d'); x.clearRect(0, 0, S, S); x.drawImage(img, 0, 0, S, S);
      return x.getImageData(0, 0, S, S).data;
    };
    let a, b;
    // A mask that will not decode is a FAILURE TO REPORT, not a crash: it means
    // the browser is applying no mask at all, so the element renders as a solid
    // currentColor block. Say that, rather than throwing a stack trace.
    try { a = await alpha(ours); } catch { return { decodeFail: true }; }
    try { b = await alpha(theirs); } catch { return { refDecodeFail: true }; }
    let diff = 0, ink = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] > 128) ink++;
      if (Math.abs(a[i + 3] - b[i + 3]) > 40) diff++;
    }
    return { diff, ink, total: S * S };
  }, masks[n], ref);

  if (r.decodeFail) {
    console.log(`  FAIL ${n.padEnd(16)} mask URI does not decode - no mask is applied, so the element renders as a solid block`);
    bad++; continue;
  }
  if (r.refDecodeFail) {
    console.log(`  FAIL ${n.padEnd(16)} the REFERENCE svg does not decode - the test is broken, not the icon`);
    bad++; continue;
  }

  const inkPct = (100 * r.ink / r.total).toFixed(1);
  // Anti-aliasing on edges only; a wrong glyph differs over a large fraction.
  const diffPct = (100 * r.diff / r.total);
  const ok = diffPct < 2;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n.padEnd(16)} ink ${inkPct.padStart(5)}%   differs from reference in ${diffPct.toFixed(2)}% of pixels`);
}

console.log(bad ? `\n${bad} icon(s) DO NOT MATCH their reference` : `\nAll ${NAMES.length} icons are pixel-equivalent to bootstrap-icons ${VERSION}.`);
await browser.close();
process.exit(bad ? 1 : 0);
