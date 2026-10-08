// What does a code block ACTUALLY render as, in two builds?
//
// Motivated by pixdiff reporting 0 px on the only page that has code blocks and
// a 30px height change on the only page that does not. One of those is wrong,
// so stop trusting the aggregate and read getComputedStyle off both trees.
import { puppeteer, CHROME } from './browser.mjs';

const PROBE = () => {
  const div = document.querySelector('div.sourceCode');
  const pre = document.querySelector('pre.sourceCode');
  const wrap = el => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundColor,
      borderTop: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      borderRightW: cs.borderRightWidth,
      borderBottomW: cs.borderBottomWidth,
      borderLeftW: cs.borderLeftWidth,
      height: Math.round(el.getBoundingClientRect().height * 100) / 100,
    };
  };
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    wrapper: wrap(div),
    pre: wrap(pre),
    // a generic <pre> that is NOT sourceCode, to prove the blast-radius claim
    otherPre: wrap([...document.querySelectorAll('pre')].find(p => !p.classList.contains('sourceCode')) || null),
  };
};

const [oldDir, newDir, pagePath = '/apps/'] = process.argv.slice(2);
const http = await import('node:http');
const fs = await import('node:fs');
const path = await import('node:path');
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

// Each side is either a _site directory (served locally) or a live origin, so
// the same comparison works old-build vs new-build and build vs production.
// Either side may be omitted, which is how you measure one build alone.
const isOrigin = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
const sides = [];
let closers = [];

if (isOrigin(oldDir)) sides.push(['this one', oldDir]);
else if (oldDir) { const s = await serve(oldDir, 8901); closers.push(s); sides.push(['old', 'http://127.0.0.1:8901']); }

if (isOrigin(newDir)) sides.push(['this one', newDir]);
else if (newDir && newDir !== 'unused') { const s = await serve(newDir, 8902); closers.push(s); sides.push(['new', 'http://127.0.0.1:8902']); }

if (!sides.length) throw new Error('usage: codeblock.mjs <oldDir|origin> [newDir|origin|none] [pagePath]');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

for (const scheme of ['light', 'dark']) {
  console.log(`\n================ system ${scheme} ================`);
  for (const [tag, origin] of sides) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await page.goto(`${origin}${pagePath}`, { waitUntil: 'networkidle0' });
    // wait out the consent banner so it cannot shift the measurement
    await new Promise(r => setTimeout(r, 800));
    const p = await page.evaluate(PROBE);
    console.log(`  ${tag}  theme=${p.theme}  ${origin}${pagePath}`);
    console.log(`       div.sourceCode  bg=${p.wrapper?.bg}  border=${p.wrapper?.borderTop}  h=${p.wrapper?.height}`);
    console.log(`       pre.sourceCode  bg=${p.pre?.bg}  border=${p.pre?.borderTop}  h=${p.pre?.height}`);
    console.log(`       other <pre>     ${p.otherPre ? 'present - NOT blast-radius-free' : 'none on this page'}`);
    await ctx.close();
  }
}

await browser.close();
for (const s of closers) s.close();