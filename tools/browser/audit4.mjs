// WCAG audit across all FOUR theme states. A media query alone only has two, and
// the two crossed ones (dark system + light choice, light system + dark choice)
// are new rendering paths that nothing has ever audited.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { puppeteer, CHROME } from './browser.mjs';

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.xml': 'application/xml', '.json': 'application/json' };
const site = path.resolve(process.argv[2]);
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(site, p), (e, b) => {
    if (e) return rs.writeHead(404).end();
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(b);
  });
});
await new Promise(r => server.listen(8881, '127.0.0.1', r));

const AUDIT = () => {
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const [r, g, b, a = '1'] = m[1].split(',').map(parseFloat); return { r, g, b, a }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const bgOf = el => { let st = [], n = el;
    while (n && n.nodeType === 1) { const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { st.push(c); if (c.a >= 0.999) break; } n = n.parentElement; }
    if (!st.length) st = [{ r: 255, g: 255, b: 255, a: 1 }];
    let acc = st[st.length - 1];
    for (let i = st.length - 2; i >= 0; i--) acc = over(st[i], acc);
    return acc; };
  const fails = [], unmasked = [];
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length)) continue;
    if (['script', 'style'].includes(el.tagName.toLowerCase())) continue;
    const bg = bgOf(el), fg = parse(cs.color);
    const eff = fg.a < 1 ? over(fg, bg) : fg;
    const cr = ratio(eff, bg);
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
    if (cr < need) fails.push({
      sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
      cr: +cr.toFixed(2), need, sample: el.textContent.trim().slice(0, 34) });
  }
  for (const el of document.querySelectorAll('.bi')) {
    const pb = getComputedStyle(el, '::before');
    if ((pb.maskImage || 'none') === 'none') unmasked.push(el.className);
  }
  return { fails, unmasked, theme: document.documentElement.getAttribute('data-theme') };
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const PAGES = [['home', '/'], ['packages', '/packages/'], ['apps', '/apps/'], ['books', '/books/'], ['privacy', '/privacy/']];
let total = 0;

for (const [sys, stored] of [['dark', null], ['dark', 'light'], ['light', null], ['light', 'dark']]) {
  const label = `system ${sys}, stored ${stored || '(none)'} -> ${sys === 'dark' && stored === 'light' ? 'light' : sys === 'light' && stored === 'dark' ? 'dark' : sys}`;
  console.log(`\n--- ${label}`);
  for (const [name, url] of PAGES) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: sys }]);
    await page.goto('http://127.0.0.1:8881/', { waitUntil: 'domcontentloaded' });
    if (stored) await page.evaluate(v => window.localStorage.setItem('theme', v), stored);
    await page.goto('http://127.0.0.1:8881' + url, { waitUntil: 'networkidle0' });
    // Open the search too - it is the largest surface and it is runtime-only.
    const t = await page.$('#quarto-search');
    if (t) { try { await t.click(); await new Promise(r => setTimeout(r, 500)); await page.keyboard.type('r'); await new Promise(r => setTimeout(r, 600)); } catch { } }
    const a = await page.evaluate(AUDIT);
    total += a.fails.length + a.unmasked.length;
    console.log(`  ${a.fails.length + a.unmasked.length ? 'FAIL' : 'ok  '} ${name.padEnd(9)} theme=${a.theme}  textFails=${a.fails.length}  unmaskedIcons=${a.unmasked.length}`);
    for (const f of a.fails) console.log(`        ${f.cr}:1 (need ${f.need}) ${f.sel} "${f.sample}"`);
    for (const i of a.unmasked) console.log(`        unmasked icon: ${i}`);
    await ctx.close();
  }
}
console.log(total ? `\n${total} FAILURE(S) ACROSS ALL FOUR STATES` : '\nALL FOUR STATES CLEAN');
await browser.close(); server.close();
process.exit(total ? 1 : 0);
