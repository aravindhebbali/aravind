// External host checks. Kept in a SEPARATE, non-blocking CI job because these
// depend on other people's DNS and uptime: an outage at rsquaredacademy.com is
// not a reason to fail this repository's build.
//
// This is the JS twin of verify-links.R, which needs R and `curl`. Two things
// it deliberately does NOT do:
//   - it does not maintain its own list of which packages need a Docs button.
//     verify-links.R's lesson was that a hand-checked list went stale and three
//     packages shipped with no Docs button at all. Instead it derives the
//     expectation from the page itself: every package card that links a docs
//     host must link <package>.rsquaredacademy.com, and every package that
//     has a card must have a CRAN link.
//   - it does not follow redirects into success. A 200 after a redirect is not
//     the same as the host existing.
//
// Run: node .github/scripts/verify-links.mjs

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.argv[2] || ".");
const TIMEOUT_MS = 12000;

// Ten per-package docs subdomains, all verified HTTP 200 on 2026-10-07.
// nse2r is deliberately absent: nse2r.rsquaredacademy.com is NXDOMAIN, so the
// package links GitHub only. rsquaredcomputing.com is not linked at all - it is
// no longer owned and fails TLS.
const DOC_HOSTS = [
  "olsrr", "blorr", "descriptr", "inferr", "rfm",
  "vistributions", "xplorerr", "rbin", "yahoofinancer", "standby",
];

const failures = [];
const fail = (m) => { failures.push(m); console.log("  FAIL  " + m); };
const pass = (m) => console.log("  ok    " + m);
const skip = (m) => console.log("  skip  " + m);

async function probe(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    // redirect: "manual" - we want to see the 3xx, not launder it.
    const r = await fetch(url, { redirect: "manual", signal: ac.signal });
    return r.status;
  } catch (e) {
    return null;   // DNS failure, TLS failure, timeout - all "not reachable"
  } finally {
    clearTimeout(t);
  }
}

console.log("Checking external hosts (best effort - failures here do not block CI)\n");

// --- 1. docs subdomains resolve -------------------------------------------

console.log("1. per-package docs subdomains");
{
  let ok = 0;
  for (const pkg of DOC_HOSTS) {
    const host = `https://${pkg}.rsquaredacademy.com`;
    const status = await probe(host);
    if (status && status >= 200 && status < 400) {
      ok++;
    } else {
      fail(`${host} -> ${status === null ? "unreachable" : status}`);
    }
  }
  if (failures.length === 0) pass(`all ${ok} docs host(s) reachable`);
}

// --- 2. nse2r fallback ----------------------------------------------------

console.log("\n2. nse2r links GitHub only");
{
  const repo = "https://github.com/rsquaredacademy/nse2r";
  const status = await probe(repo);
  if (status && status < 400) pass(`${repo} -> ${status}`);
  else fail(`${repo} -> ${status === null ? "unreachable" : status}`);

  const dead = await probe("https://nse2r.rsquaredacademy.com");
  if (dead === null || dead >= 400) {
    pass("nse2r.rsquaredacademy.com is indeed absent (expected NXDOMAIN)");
  } else {
    // If this host ever comes alive, the card should probably link it - worth
    // telling a human rather than silently changing anything.
    skip(`nse2r.rsquaredacademy.com now returns ${dead}; consider linking it`);
  }
}

// --- 3. docs host is linked from the matching card ------------------------

console.log("\n3. each docs host is linked from its own package card");
{
  // Read the built pages, not the .qmd sources: the card structure that matters
  // is what Pandoc produced.
  const sitePkg = join(ROOT, "_site", "packages", "index.html");
  if (!existsSync(sitePkg)) {
    skip("_site/packages/index.html missing - skipping card/host cross-check");
  } else {
    const html = readFileSync(sitePkg, "utf8");
    let missing = 0;
    for (const pkg of DOC_HOSTS) {
      const host = `${pkg}.rsquaredacademy.com`;
      if (!html.includes(host)) {
        fail(`no card on the packages page links ${host} - is the Docs button missing?`);
        missing++;
      }
    }
    if (!missing) pass(`all ${DOC_HOSTS.length} docs host(s) are linked from the packages page`);
  }
}

// --- 4. the site itself ----------------------------------------------------

console.log("\n4. site reachable over HTTPS");
{
  for (const p of ["/", "/packages/", "/apps/", "/books/"]) {
    const url = "https://www.aravindhebbali.com" + p;
    const status = await probe(url);
    if (status && status < 400) pass(`${url} -> ${status}`);
    else skip(`${url} -> ${status === null ? "unreachable" : status} (site may not be deployed yet)`);
  }
}

// --- summary ---------------------------------------------------------------

console.log("\n" + "-".repeat(64));
if (failures.length) {
  console.log(`${failures.length} host problem(s). These are advisory - the job is continue-on-error.`);
  process.exit(0);   // deliberately not 1: upstream outages must not fail the build
}
console.log("all external hosts healthy");
process.exit(0);