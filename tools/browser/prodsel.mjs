// Assert the SEARCH SELECTION state on production - the one thing audit4 never
// covers, because it types a query but never presses a key to move the selection.
// This commit changes exactly those two colours (selected row, selected match),
// so "the overlay renders" is not evidence; the selected row has to be measured.
import { puppeteer, CHROME } from './browser.mjs';
const ORIGIN = process.argv[2] || 'https://www.aravindhebbali.com';

const PROBE = () => {
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const [r, g, b, a = '1'] = m[1].split(',').map(parseFloat); return { r, g, b, a }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const bgOf = el => { let st = [], n = el;
    while (n && n.nodeType === 1) { const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { st.push(c); if (c.a >= 0.999) break; } n = n.parentElement; }
    if (!st.length) st = [{ r: 255, g: 255, b: 255, a: 1 }];
    let acc = st[st.length - 1];
    for (let i = st.length - 2; i >= 0; i--) acc = over(st[i], acc);
    return acc; };
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const token = el => getComputedStyle(document.documentElement).getPropertyValue(
    el.classList.contains('search-item') && el.closest('[aria-selected="true"]') ? '--accent' : '--muted').trim();

  const sel = document.querySelector('.aa-DetachedOverlay li.aa-Item[aria-selected="true"] .search-item');
  const unsel = document.querySelector('.aa-DetachedOverlay li.aa-Item[aria-selected="false"] .search-item');
  const out = { theme: document.documentElement.getAttribute('data-theme'), accent: '', onAccent: '', muted: '', rows: [] };
  const rs = getComputedStyle(document.documentElement);
  out.accent = rs.getPropertyValue('--accent').trim();
  out.onAccent = rs.getPropertyValue('--on-accent').trim();
  out.muted = rs.getPropertyValue('--muted').trim();
  if (!sel) return out;
  for (const [label, el] of [['selected', sel], ['unselected', unsel]]) {
    if (!el) continue;
    const cs = getComputedStyle(el), bg = bgOf(el), fg = parse(cs.color);
    const eff = fg.a < 1 ? over(fg, bg) : fg;
    const row = { label, rowBg: hex(bg), rowFg: hex(eff), rowCR: +ratio(eff, bg).toFixed(2), marks: [] };
    for (const m of el.querySelectorAll('mark.search-match')) {
      const mcs = getComputedStyle(m), mbg = bgOf(m), mfg = parse(mcs.color);
      const meff = mfg.a < 1 ? over(mfg, mbg) : mfg;
      row.marks.push({ bg: hex(mbg), fg: hex(meff), cr: +ratio(meff, mbg).toFixed(2), text: m.textContent.trim().slice(0, 24) });
    }
    out.rows.push(row);
  }
  return out;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
let bad = 0;
for (const sys of ['light', 'dark']) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: sys }]);
  await page.goto(ORIGIN + '/', { waitUntil: 'networkidle0' });
  await page.click('#quarto-search');
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.type('package');
  await new Promise(r => setTimeout(r, 1200));
  // Step down until the SELECTED row is one that actually contains a highlight.
  // The first result is often a bare nav/title hit with no <mark> in it, and
  // measuring only that would silently skip the chip - which is half the change.
  let steps = 0, marksInSelected = 0;
  for (; steps < 10; steps++) {
    await page.keyboard.press('ArrowDown');
    await new Promise(r => setTimeout(r, 350));
    marksInSelected = await page.evaluate(() =>
      document.querySelectorAll('.aa-DetachedOverlay li.aa-Item[aria-selected="true"] .search-item mark.search-match').length);
    if (marksInSelected) break;
  }
  if (!marksInSelected) console.log(`  note  no result within ${steps + 1} had a highlight; chip unverified`);
  const p = await page.evaluate(PROBE);
  console.log(`\n--- production, system ${sys} -> theme=${p.theme}  --accent=${p.accent} --on-accent=${p.onAccent}`);
  if (!p.rows.length) { console.log('  FAIL  no rows measured'); bad++; }
  for (const r of p.rows) {
    const okRow = r.rowCR >= 4.5;
    if (!okRow) bad++;
    console.log(`  ${okRow ? 'ok  ' : 'FAIL'} ${r.label} row  bg=${r.rowBg} fg=${r.rowFg}  ${r.rowCR}:1 (need 4.5)`);
    for (const m of r.marks) {
      const ok = m.cr >= 4.5; if (!ok) bad++;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.label} mark "${m.text}"  bg=${m.bg} fg=${m.fg}  ${m.cr}:1 (need 4.5)`);
    }
  }
  await ctx.close();
}
console.log(bad ? `\n${bad} FAILURE(S)` : '\nSELECTION STATE CLEAN IN BOTH SCHEMES');
await browser.close();
process.exit(bad ? 1 : 0);