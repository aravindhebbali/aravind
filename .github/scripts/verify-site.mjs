// Offline checks against the committed _site/.
//
// WHY OUTPUT, NOT SOURCES: every bug in the last two sessions was output-level
// and invisible in the .qmd sources. Quarto resolves image paths relative to
// the SOURCE FILE (so 15 hex stickers 404ed while a grep for "images/" passed),
// and Pandoc silently drops attributes from link-wrapped markdown. Neither is
// visible from the markdown.
//
// Deliberately dependency-free: node's built-ins only, no npm install, so the
// job cannot fail on a registry outage. Reimplemented rather than shelling out
// to verify-links.R (that would need setup-r) or puppeteer (that would need a
// browser download).
//
// What it asserts, and why each one exists:
//   1. every <img src> resolves against its OWN page URL, not a grep for
//      "images/" - that check passed while 15 hexes were 404ing
//   2. every <img> carries width+height, except the navbar logo, which Quarto
//      generates from _quarto.yml with no such option (verified: the CSS gives
//      it a definite height + aspect-ratio instead)
//   3. every bi-* class has a mask rule - mirrors the post-render.R guard so a
//      hand-edited _site cannot silently drop an icon
//   4. no bootstrap-icons link/font anywhere; neither file should exist
//   5. forbidden hosts absent (rsquaredcomputing.com was sold; TLS fails)
//   6. nse2r must NOT link a docs host - that subdomain is NXDOMAIN
//   7. the four canonicals self-reference and the sitemap lists 4 URLs
//   8. _site is newer than every source file it was built from
//   9. styles.css in _site matches the repo-root copy byte for byte

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

const ROOT = resolve(process.argv[2] || ".");
const SITE = join(ROOT, "_site");

const failures = [];
const notes = [];
const fail = (m) => { failures.push(m); console.log("  FAIL  " + m); };
const pass = (m) => console.log("  ok    " + m);
const note = (m) => { notes.push(m); console.log("  note  " + m); };
const section = (t) => console.log("\n" + t);

if (!existsSync(SITE)) {
  console.error("_site/ not found at " + SITE + " - run `quarto render` first.");
  process.exit(1);
}

// --- collect ---------------------------------------------------------------

function walk(dir, pred) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, pred));
    else if (pred(full)) out.push(full);
  }
  return out;
}

const pages = walk(SITE, (f) => f.endsWith(".html")).sort();
const relPages = pages.map((f) => relative(SITE, f).replace(/\\/g, "/"));

console.log("Checking " + relPages.length + " rendered page(s) in _site/");

// Read once; several checks need the whole document.
const docs = new Map(pages.map((f) => [f, readFileSync(f, "utf8")]));

const stylesCss = existsSync(join(SITE, "styles.css"))
  ? readFileSync(join(SITE, "styles.css"), "utf8")
  : null;

// --- 1. images resolve against their own page ------------------------------

section("1. <img src> resolves against its own page URL");
{
  let checked = 0;
  let broken = 0;
  for (const [file, html] of docs) {
    const pageUrl = "/" + relative(SITE, file).replace(/\\/g, "/");
    const dir = dirname(pageUrl);
    for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
      const src = m[1];
      if (/^(https?:|data:)/.test(src)) continue;
      // Quarto emits THREE href shapes for one asset: `assets/...` on root
      // pages, `../assets/...` on nested ones, and an absolute `/assets/...`
      // on 404.html. An absolute path is site-root-relative, so resolve it
      // against _site rather than against the page's directory.
      const fromPage = src.startsWith("/")
        ? join(SITE, src)
        : resolve(dirname(file), src);
      checked++;
      if (!existsSync(fromPage)) {
        fail(`${pageUrl} -> ${src} does not exist (resolved to ${relative(SITE, fromPage)})`);
        broken++;
      }
    }
  }
  if (!broken) pass(`${checked} <img src> reference(s) resolve, all against their own page`);
}

// --- 2. images reserve their box -------------------------------------------

section("2. every <img> carries intrinsic dimensions");
{
  const EXEMPT = /class="[^"]*\bnavbar-logo\b/;   // Quarto-generated from _quarto.yml
  let dimmed = 0;
  let exempt = 0;
  let missing = 0;
  for (const [file, html] of docs) {
    const pageUrl = "/" + relative(SITE, file).replace(/\\/g, "/");
    for (const m of html.matchAll(/<img[^>]*>/g)) {
      const tag = m[0];
      // Quarto builds this tag from `website.navbar.logo` in _quarto.yml, which
      // has no width/height option, so it is the one image on the site that
      // cannot carry attributes. styles.scss gives it a definite height plus
      // aspect-ratio instead, which reserves the box by the same mechanism.
      if (EXEMPT.test(tag)) { exempt++; continue; }
      if (/\swidth="\d+"/.test(tag) && /\sheight="\d+"/.test(tag)) { dimmed++; continue; }
      fail(`${pageUrl}: ${tag.slice(0, 90)} has no width/height - it will reflow on decode`);
      missing++;
    }
  }
  if (!missing) pass(`${dimmed} image(s) dimensioned, ${exempt} navbar logo exempt (Quarto generates it)`);
}

// --- 3. mask coverage ------------------------------------------------------

section("3. every bi-* class has a mask rule");
{
  if (!stylesCss) {
    fail("_site/styles.css is missing");
  } else {
    const icons = new Set();
    for (const html of docs.values()) {
      // Scan class ATTRIBUTES only. A bare text search for "bi-" matches the
      // substring in books/index.html's URL .../cheatsheet/dbi-cheatsheet.pdf
      // and reports an icon that does not exist.
      for (const m of html.matchAll(/class="([^"]*)"/g)) {
        for (const token of m[1].split(/\s+/)) {
          if (/^bi-.+/.test(token)) icons.add(token);
        }
      }
    }
    const uncovered = [...icons].filter(
      (cls) => !stylesCss.includes(`.${cls}::before`)
    );
    if (uncovered.length) {
      fail(`no mask rule for: ${uncovered.join(", ")} - these would render as nothing`);
    } else {
      pass(`${icons.size} bi-* class(es), all with mask rules (${[...icons].sort().join(", ")})`);
    }
  }
}

// --- 4. icon font gone -----------------------------------------------------

section("4. Bootstrap Icons font eliminated");
{
  let refs = 0;
  for (const [file, html] of docs) {
    const pageUrl = "/" + relative(SITE, file).replace(/\\/g, "/");
    if (/<link[^>]*bootstrap-icons\.css/.test(html)) {
      fail(`${pageUrl} still links bootstrap-icons.css`);
      refs++;
    }
  }
  for (const f of ["site_libs/bootstrap/bootstrap-icons.css", "site_libs/bootstrap/bootstrap-icons.woff"]) {
    if (existsSync(join(SITE, f))) {
      fail(`_site/${f} still exists - it should be removed by post-render.R`);
      refs++;
    }
  }
  if (stylesCss && /bootstrap-icons/.test(stylesCss)) {
    fail("styles.css references bootstrap-icons");
    refs++;
  }
  if (!refs) pass("no bootstrap-icons <link>, no .css, no .woff anywhere in _site/");
}

// --- 5/6. host policy ------------------------------------------------------

section("5. forbidden hosts absent");
{
  const FORBIDDEN = ["rsquaredcomputing.com"];
  let found = 0;
  for (const [file, html] of docs) {
    const pageUrl = "/" + relative(SITE, file).replace(/\\/g, "/");
    for (const host of FORBIDDEN) {
      if (html.includes(host)) { fail(`${pageUrl} links ${host} - no longer owned, TLS fails`); found++; }
    }
  }
  if (!found) pass(`none of: ${FORBIDDEN.join(", ")}`);
}

section("6. NXDOMAIN host is not linked");
{
  // nse2r.rsquaredacademy.com does not resolve; the package must link GitHub only.
  let found = 0;
  for (const [file, html] of docs) {
    if (html.includes("nse2r.rsquaredacademy.com")) {
      fail(relative(SITE, file) + " links nse2r.rsquaredacademy.com (NXDOMAIN)");
      found++;
    }
  }
  if (!found) pass("nse2r does not link a docs host, as intended");
}

// --- 7. canonicals + sitemap ----------------------------------------------

section("7. canonicals self-reference, sitemap lists the four pages");
{
  const EXPECTED = [
    "https://www.aravindhebbali.com/",
    "https://www.aravindhebbali.com/packages/",
    "https://www.aravindhebbali.com/apps/",
    "https://www.aravindhebbali.com/books/",
  ];
  // Only the four public pages carry a self-referencing canonical. 404.html is
  // an error page and is deliberately excluded from the sitemap, though Quarto
  // still emits a canonical for it; zohoverify/ is a standalone Zoho-verification
  // file outside the Quarto render list and is never indexed.
  const indexed = pages.filter((f) => {
    const rel = relative(SITE, f).replace(/\\/g, "/");
    return !rel.includes("404") && !rel.includes("zohoverify");
  });
  const seen = [];
  for (const file of indexed) {
    const rel = relative(SITE, file).replace(/\\/g, "/");
    const m = docs.get(file).match(/<link rel="canonical" href="([^"]+)"/);
    if (!m) { fail(`${rel} has no canonical tag`); continue; }
    seen.push(m[1]);
    // Self-referencing: the canonical must be the URL this page is served at.
    const pageUrl = "/" + rel.replace(/index\.html$/, "");
    if (m[1] !== "https://www.aravindhebbali.com" + pageUrl) {
      fail(`${rel} canonical is ${m[1]}, expected https://www.aravindhebbali.com${pageUrl}`);
    }
  }
  const want = [...EXPECTED].sort();
  if (JSON.stringify([...seen].sort()) === JSON.stringify(want)) {
    pass(`${seen.length} canonicals, each self-referencing`);
  } else if (!failures.length) {
    fail(`canonicals are ${JSON.stringify(seen.sort())}, expected ${JSON.stringify(want)}`);
  }

  const smPath = join(SITE, "sitemap.xml");
  if (!existsSync(smPath)) {
    fail("sitemap.xml missing");
  } else {
    const sm = readFileSync(smPath, "utf8");
    const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
    const want = [...EXPECTED].sort();
    if (JSON.stringify(locs) === JSON.stringify(want)) {
      pass(`sitemap lists exactly the ${locs.length} public pages`);
    } else {
      fail(`sitemap mismatch: ${JSON.stringify(locs)} != ${JSON.stringify(want)}`);
    }
  }
}

// --- 8. _site freshness ---------------------------------------------------

section("8. _site is newer than its sources");
{
  const sources = [];
  for (const f of ["_quarto.yml", "styles.scss", "styles.css", "head-includes.html", "_headers", "netlify.toml"]) {
    if (existsSync(join(ROOT, f))) sources.push(join(ROOT, f));
  }
  for (const f of ["index.qmd", "404.qmd"]) {
    if (existsSync(join(ROOT, f))) sources.push(join(ROOT, f));
  }
  for (const d of ["packages", "apps", "books"]) {
    const p = join(ROOT, d, "index.qmd");
    if (existsSync(p)) sources.push(p);
  }
  // A styles.css newer than _site/styles.css means styles.css was recompiled
  // without re-rendering, and the deploy would ship stale CSS.
  const siteMtime = existsSync(join(SITE, "styles.css"))
    ? statSync(join(SITE, "styles.css")).mtimeMs
    : 0;
  const stale = [];
  for (const s of sources) {
    if (statSync(s).mtimeMs > siteMtime + 1000) {
      stale.push(relative(ROOT, s).replace(/\\/g, "/"));
    }
  }
  if (stale.length) {
    fail(`sources newer than _site/styles.css - run compile-styles.R + quarto render: ${stale.join(", ")}`);
  } else {
    pass(`${sources.length} source file(s) all older than the rendered output`);
  }
}

// --- 9. styles.css agreement ---------------------------------------------

section("9. _site/styles.css matches the repo-root copy");
{
  const root = join(ROOT, "styles.css");
  if (!existsSync(root)) {
    fail("styles.css missing from the repo root");
  } else if (!stylesCss) {
    fail("_site/styles.css missing");
  } else {
    const a = readFileSync(root);
    const b = Buffer.from(stylesCss, "utf8");
    if (a.equals(b)) pass(`byte-identical (${(a.length / 1024).toFixed(1)} KB)`);
    else fail(`root copy is ${a.length} bytes, _site copy is ${b.length} - they differ`);
  }
}

// --- summary ---------------------------------------------------------------

console.log("\n" + "-".repeat(64));
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s)`);
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
console.log(`PASSED: ${notes.length ? notes.length + " note(s), " : ""}all output checks`);
process.exit(0);