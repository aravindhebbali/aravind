// Screenshot the search overlay with a query, in both schemes, for two builds so
// the selected row and the match chip can be compared side by side.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { puppeteer, CHROME, outDir as scratchDir } from './browser.mjs';
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.xml': 'application/xml', '.json': 'application/json' };
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
const NEW = path.resolve(process.argv[2]), OLD = path.resolve(process.argv[3]);
const a = await serve(NEW, 8933), b = await serve(OLD, 8934);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const out = scratchDir('regions');

const grab = async (port, scheme, tag) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
  await (await page.$('#quarto-search')).click();
  await new Promise(r => setTimeout(r, 600));
  await page.keyboard.type('package');
  await new Promise(r => setTimeout(r, 1000));
  // Crop to just the results panel.
  const box = await page.evaluate(() => {
    const p = document.querySelector('.aa-Panel');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.min(420, Math.round(r.height)) };
  });
  if (box) await page.screenshot({ path: path.join(out, `search-${scheme}-${tag}.png`), clip: box });
  console.log(`  wrote search-${scheme}-${tag}.png`);
  await ctx.close();
};

for (const scheme of ['light', 'dark']) {
  console.log(scheme);
  await grab(8933, scheme, 'new');
  await grab(8934, scheme, 'old');
}
await browser.close(); a.close(); b.close();
