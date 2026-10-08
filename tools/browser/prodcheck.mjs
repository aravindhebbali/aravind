// Verify the DEPLOYED site, not the local tree. Gotcha 24.
import { puppeteer, CHROME } from './browser.mjs';
const BASE = 'https://www.aravindhebbali.com';

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
  const fails = [];
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
    if (cr < need) fails.push({ sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), cr: +cr.toFixed(2), need, sample: el.textContent.trim().slice(0, 34) });
  }
  // Icons: a solid block means no mask.
  const icons = [];
  for (const el of document.querySelectorAll('.bi')) {
    const pb = getComputedStyle(el, '::before');
    icons.push({ cls: el.className, mask: (pb.maskImage || 'none').slice(0, 14), bg: pb.backgroundColor });
  }
  return { fails, icons, bodyBg: getComputedStyle(document.body).backgroundColor };
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
let totalFails = 0;
for (const [name, url] of [['home', '/'], ['packages', '/packages/'], ['apps', '/apps/'], ['books', '/books/'], ['privacy', '/privacy/']]) {
  const ctx = await browser.createBrowserContext();          // isolated per page
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.goto(BASE + url, { waitUntil: 'networkidle0' });
  const a = await page.evaluate(AUDIT);
  const noMask = a.icons.filter(i => i.mask === 'none');
  console.log(`${name.padEnd(9)} bodyBg=${a.bodyBg}  textFails=${a.fails.length}  icons=${a.icons.length} unmasked=${noMask.length}`);
  for (const f of a.fails) { console.log(`    FAIL ${f.cr}:1 (need ${f.need}) ${f.sel} "${f.sample}"`); totalFails++; }
  for (const i of noMask) console.log(`    FAIL icon with no mask: ${i.cls} (bg ${i.bg})`);
  totalFails += noMask.length;
  await ctx.close();
}
console.log(totalFails ? `\n${totalFails} FAILURE(S) ON PRODUCTION` : '\nPRODUCTION CLEAN: every text node clears WCAG and every icon is masked.');
await browser.close();
