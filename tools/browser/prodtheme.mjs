// Verify the DEPLOYED toggle in all four theme states, plus a click.
import { puppeteer, CHROME } from './browser.mjs';
const B = 'https://www.aravindhebbali.com';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
let bad = 0;

for (const [sys, stored] of [['dark', null], ['dark', 'light'], ['light', null], ['light', 'dark']]) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: sys }]);
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  if (stored) await page.evaluate(v => window.localStorage.setItem('theme', v), stored);
  await page.goto(B + '/', { waitUntil: 'networkidle0' });
  // Everything the helper needs has to live INSIDE the evaluate.
  const r = await page.evaluate(() => {
    const hex = s => { const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return s;
      const [q, g, b] = m[1].split(',').map(v => Math.round(parseFloat(v)));
      return '#' + [q, g, b].map(v => v.toString(16).padStart(2, '0')).join(''); };
    const el = document.documentElement;
    const btn = document.querySelector('.theme-toggle');
    const d = document.querySelector('.theme-icon-dark');
    const l = document.querySelector('.theme-icon-light');
    return {
      theme: el.getAttribute('data-theme'),
      cs: el.style.colorScheme,
      bg: hex(getComputedStyle(document.body).backgroundColor),
      btn: btn ? getComputedStyle(btn).display : 'none',
      aria: btn ? btn.getAttribute('aria-label') : null,
      icons: d && l ? `${getComputedStyle(d).display}/${getComputedStyle(l).display}` : 'none',
    };
  });
  const want = stored || sys;
  const ok = r.theme === want && r.bg === (want === 'dark' ? '#020617' : '#fbfcfd') && r.btn !== 'none';
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} system ${sys.padEnd(5)} stored ${String(stored || '(none)').padEnd(5)} -> theme=${r.theme} bg=${r.bg} btn=${r.btn} icons=${r.icons} aria="${r.aria}"`);
  await ctx.close();
}

console.log('\nCLICK on production (light system, no stored choice)');
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(B + '/', { waitUntil: 'networkidle0' });
  const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.click('.theme-toggle');
  await new Promise(r => setTimeout(r, 250));
  const after = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    stored: window.localStorage.getItem('theme'),
    cs: document.documentElement.style.colorScheme,
  }));
  // And back again, so the round trip is proven rather than one direction.
  await page.click('.theme-toggle');
  await new Promise(r => setTimeout(r, 250));
  const back = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const ok = before === 'light' && after.theme === 'dark' && after.stored === 'dark' && after.cs === 'dark' && back === 'light';
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${before} -> ${after.theme} (stored ${after.stored}, colorScheme ${after.cs}) -> ${back}`);
  await ctx.close();
}

console.log(bad ? `\n${bad} PRODUCTION FAILURE(S)` : '\nPRODUCTION: all four states correct, toggle round-trips');
await browser.close();
process.exit(bad ? 1 : 0);
