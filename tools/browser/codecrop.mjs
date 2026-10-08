// Crop one code block out of two builds, and report page height, so the visual
// result of a ground/outline change can be judged rather than inferred.
import { puppeteer, CHROME, outDir as scratchDir } from './browser.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [oldDir, newDir, pagePath = '/apps/'] = process.argv.slice(2);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.xml': 'application/xml', '.json': 'application/json' };
const serve = (root, port) => new Promise(r => {
  const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    fs.readFile(path.join(root, p), (e, b) => {
      if (e) return rs.writeHead(404).end();
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      rs.end(b);
    });
  });
  s.listen(port, '127.0.0.1', () => r(s));
});

const out = scratchDir('codeblock');
const a = await serve(oldDir, 8903), b = await serve(newDir, 8904);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

const PROBE = () => {
  const blocks = [...document.querySelectorAll('div.sourceCode')];
  return {
    blocks: blocks.length,
    pageHeight: document.documentElement.scrollHeight,
    firstBox: blocks[0] ? (r => ({ x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }))(blocks[0].getBoundingClientRect()) : null,
  };
};

for (const scheme of ['light', 'dark']) {
  console.log(`\n======== system ${scheme} ========`);
  for (const [tag, port] of [['old', 8903], ['new', 8904]]) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 2000, deviceScaleFactor: 2 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await page.goto(`http://127.0.0.1:${port}${pagePath}`, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 800));
    const p = await page.evaluate(PROBE);
    console.log(`  ${tag}: code blocks=${p.blocks}  page height=${p.pageHeight}`);
    if (p.firstBox) {
      const box = { ...p.firstBox, y: p.firstBox.y + (await page.evaluate(() => window.scrollY)) };
      await page.screenshot({ path: path.join(out, `code-${scheme}-${tag}.png`), clip: box });
    }
    await ctx.close();
  }
}
console.log(`\nwrote crops to ${out}`);
await browser.close(); a.close(); b.close();