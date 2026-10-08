// Per-pixel diff of two _site trees, same flags, same viewport, same scheme.
// Node has no image library, so both PNGs are decoded in the page via Image +
// canvas and compared there - the method recorded in pending_tasks.md 3.12.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { puppeteer, CHROME, outDir as scratchDir } from './browser.mjs';

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.xml': 'application/xml', '.json': 'application/json' };
const serve = (root, port) => new Promise(r => {
  const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    fs.readFile(path.join(root, p), (e, b) => {
      if (e) return rs.writeHead(404).end();
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(b);
    });
  });
  s.listen(port, '127.0.0.1', () => r(s));
});

const PAGES = [['home', '/'], ['packages', '/packages/'], ['apps', '/apps/'], ['books', '/books/'], ['privacy', '/privacy/']];

// Diff runs inside a blank page: load both shots as data URIs, read pixels.
const DIFF = async (a, b) => {
  const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  if (ia.width !== ib.width || ia.height !== ib.height)
    return { sizeMismatch: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
  const px = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  const da = px(ia), db = px(ib);
  let diff = 0; const boxes = [];
  // Cluster differing pixels into row-bands so the report names regions, not counts.
  const bandTop = new Map();
  for (let i = 0; i < da.length; i += 4) {
    if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) {
      diff++;
      const px_ = i / 4, y = Math.floor(px_ / ia.width);
      if (!bandTop.has(y)) bandTop.set(y, [y, y]);
      else bandTop.get(y)[1] = y;
    }
  }
  const bands = [...bandTop.values()];
  const merged = [];
  for (const b of bands) {
    if (merged.length && b[0] - merged[merged.length - 1][1] <= 3) merged[merged.length - 1][1] = b[1];
    else merged.push(b);
  }
  return { w: ia.width, h: ia.height, diff, total: da.length / 4, bands: merged.slice(0, 12) };
};

const scheme = process.argv[2] || 'light';
const base = process.argv[3];
const head = process.argv[4];
const outDir = process.argv[5] || scratchDir('diff');
fs.mkdirSync(outDir, { recursive: true });

const sA = await serve(base, 8811), sB = await serve(head, 8812);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const blank = await browser.newPage();

console.log(`scheme=${scheme}\nold=${head}\nnew=${base}\n`);
let totalDiff = 0;
for (const [name, url] of PAGES) {
  const shots = [];
  for (const [port] of [[8811], [8812]]) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 3 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 400));
    const buf = await page.screenshot({ fullPage: true, type: 'png' });
    shots.push('data:image/png;base64,' + buf.toString('base64'));
    await ctx.close();
  }
  const d = await blank.evaluate(DIFF, shots[0], shots[1]);
  if (d.sizeMismatch) { console.log(`${name.padEnd(9)} SIZE MISMATCH ${d.sizeMismatch}`); continue; }
  totalDiff += d.diff;
  const pct = (100 * d.diff / d.total).toFixed(4);
  console.log(`${name.padEnd(9)} ${String(d.diff).padStart(8)} px differ (${pct}%) of ${d.total}  ${d.w}x${d.h}`);
  for (const b of d.bands) console.log(`             band y=${b[0]}..${b[1]}`);
}
console.log(`\nTOTAL: ${totalDiff} differing pixels across all pages in ${scheme}.`);
await browser.close(); sA.close(); sB.close();
