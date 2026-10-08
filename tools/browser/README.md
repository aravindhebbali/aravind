# tools/browser

Browser-driven verification for this site. **Local only — none of this runs in CI.**

These scripts exist because every bug in the 2026-10-06→08 sessions was either
invisible to a static check or invisible to reading the source. Reading a
stylesheet told me a contrast figure was fine while the rendered element was
below AA; grepping the HTML told me all fourteen icons were masked when three of
them are injected at runtime by `quarto-search.js` and are not in the HTML at
all. A real browser was the thing that settled it, every time.

CI cannot do this. `.github/workflows/verify.yml` runs on `ubuntu-latest`, where
there is no browser. That is why these are **not** in `.github/scripts/`, even
though several of them would be a fine gate — that directory is committed and
reads as "this runs in CI", and nothing here could.

## Prerequisites

- **Google Chrome.** Found automatically on Windows, macOS and the usual Linux
  paths. Override with `CHROME_PATH` if it lives somewhere unusual.
- **`puppeteer-core`.** Not a dependency of this repo — the site has no npm
  install step at all, Quarto vendors its own libraries. Any of these work:
  - `npm i -g puppeteer-core` (auto-detected via the global prefix)
  - a global `npm i -g lighthouse`, which vendors `puppeteer-core` (auto-detected)
  - `PUPPETEER_PATH=<dir>` pointing at any `node_modules` that has it
- **Node 20+** for `import.meta.dirname`.

Both resolvers throw an error naming exactly what to set, rather than a
`MODULE_NOT_FOUND` pointing at an unrelated specifier.

## The scripts

| Script | What it proves |
|---|---|
| `audit4.mjs <siteDir>` | WCAG text contrast + unmasked icons across **all four theme states** — system-preference × stored-override, including the two crossed ones — on five pages, with the search overlay open. |
| `prodsel.mjs [origin]` | The **selected** search row and the **selected** match chip, measured, in both schemes. `audit4` types a query but never presses a key, so it never sees this state. |
| `pixdiff.mjs <scheme> <newDir> <oldDir> [outDir]` | Per-pixel diff of two builds. Decoded in-page via canvas, since Node has no image library. |
| `iconref.mjs <siteDir> [refDir] [--fetch]` | Every icon mask pixel-diffed against the bootstrap-icons 1.11.1 SVG it was derived from. Caches the 14 references; `--fetch` needs network. |
| `searchshot.mjs <newDir> <oldDir>` | Search overlay screenshots, both schemes, both builds, for side-by-side comparison. |
| `prodcheck.mjs` | The **deployed** site's text contrast and icon masks. Verifies production, not the local tree. |
| `prodtheme.mjs` | The **deployed** toggle in all four states, plus a click round-trip. |
| `serve.mjs <dir> [port]` | Static server over a `_site` tree. Used by the others and handy on its own. |

`browser.mjs` holds the Chrome and `puppeteer-core` resolution and a `launch()`
helper. The scripts keep `puppeteer` and `CHROME` as local names so their
`puppeteer.launch({ executablePath: CHROME })` call sites are unchanged.

Scratch output goes to `os.tmpdir()/aravind-browser/<name>` — portable, and
outside the repo so nothing here dirties a commit.

## A check that has never failed is not known to work

Run a new assertion against a build where it **should** fail before trusting it
on one where it passes.

This is not hypothetical. `prodsel.mjs` against the pre-fix `194e8bb` tree:

```
FAIL selected row   bg=#2780e3 fg=#343a40   2.89:1  (need 4.5)
FAIL selected mark  bg=#4b95e8 fg=#ffffff   3.10:1  (need 4.5)
```

`b6da658` shipped a dark-mode regression that made the selected row revert to
the surface colour, and it reached production because `audit4`, `verify-site.mjs`
and CI were all green — every one of them correct about what it measured, and
every one of them measuring the *unselected* row. Only a check that selects a row
could have caught it.

That run also corrected a number that had been quoted in a commit message and in
`pending_tasks.md` for a week: the light selected row was recorded as
**3.97:1**, which was computed as *white* on `#2780e3`. The rendered row's
foreground is `#343a40`, so the real figure was **2.89:1**. The mark's 3.10:1
was right. See `pending_tasks.md` §3 lesson 13 — measure what the build actually
did before quoting a number — and lesson 47 here for the variant, where the
number came from the stylesheet rather than from the element.