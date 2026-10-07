# Post-render fixups, run automatically by Quarto via `project: post-render`.
#
# Why this exists
# ---------------
# Quarto generates `_site/sitemap.xml` from OUTPUT FILE PATHS, so a source at
# `packages/index.qmd` is advertised as `/packages/index.html` - even though
# the page's canonical tag correctly says `/packages/`. Left alone, the
# sitemap would advertise exactly the `index.html` URLs this migration is
# trying to retire, reintroducing the duplicate-URL problem described in
# roadmap section 1. Quarto 1.6.40 has no `website: sitemap` option to disable
# generation (verified: "property name sitemap is invalid"), so we correct the
# output here rather than hand-maintain a file that the next render clobbers.
#
# Quarto's auto-generated robots.txt is also minimal (a bare Sitemap line), so
# a conformant one is written here too.
#
# The Bootstrap Icons font is also stripped here - see the icon block below.

site_dir <- "_site"
sitemap_path <- file.path(site_dir, "sitemap.xml")

if (!dir.exists(site_dir)) {
  stop("Expected rendered site at ", site_dir, " - run quarto render first.")
}

# The page set is the source of truth for what should be advertised.
# 404 is deliberately excluded: an error page should not be indexed.
public_pages <- c(
  "https://www.aravindhebbali.com/",
  "https://www.aravindhebbali.com/packages/",
  "https://www.aravindhebbali.com/apps/",
  "https://www.aravindhebbali.com/books/"
)

if (file.exists(sitemap_path)) {
  xml <- paste(readLines(sitemap_path, warn = FALSE), collapse = "\n")

  # Preserve Quarto's lastmod timestamps, keyed by output file.
  locs <- regmatches(xml, gregexpr("<loc>[^<]+</loc>", xml))[[1]]
  stamps <- regmatches(xml, gregexpr("<lastmod>[^<]+</lastmod>", xml))[[1]]

  output_to_url <- function(loc) {
    u <- sub("^<loc>", "", sub("</loc>$", "", loc))
    u <- sub("/index\\.html$", "/", u)
    u <- sub("\\.html$", "/", u)
    u
  }

  seen <- character(0)
  lines_out <- character(0)
  for (i in seq_along(locs)) {
    url <- output_to_url(locs[i])
    if (!url %in% public_pages || url %in% seen) next
    seen <- c(seen, url)
    lines_out <- c(lines_out, "  <url>", paste0("    <loc>", url, "</loc>"))
    if (i <= length(stamps)) {
      stamp <- sub("^<lastmod>", "", sub("</lastmod>$", "", stamps[i]))
      if (nzchar(stamp)) lines_out <- c(lines_out, paste0("    <lastmod>", stamp, "</lastmod>"))
    }
    lines_out <- c(lines_out, "  </url>")
  }

  # NOTE: build a character VECTOR of lines. Using paste0() with `lines_out`
  # as an argument would vectorise and emit one whole document per line.
  writeLines(c(
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    lines_out,
    "</urlset>"
  ), sitemap_path)
  message("post-render: sitemap normalised to ", length(seen), " clean URLs")
} else {
  warning("post-render: no sitemap.xml found at ", sitemap_path)
}

# Conformant robots.txt (Quarto's generated one lacks User-agent/Allow).
writeLines(c(
  "User-agent: *",
  "Allow: /",
  "",
  paste0("Sitemap: https://www.aravindhebbali.com/sitemap.xml")
), file.path(site_dir, "robots.txt"))
message("post-render: robots.txt written")

# NOTE: styles.scss is no longer copied into _site. Quarto used to copy the raw
# SCSS verbatim (it does not compile `css:` .scss files), which served invalid
# CSS; compile-styles.R now emits styles.css and _quarto.yml references that.
# If a stale styles.scss ever reappears in the output, drop it.

# --- Bootstrap Icons font -> inline SVG masks -------------------------------
#
# WHY
# ---
# `bootstrap-icons.woff` was 172 KB that gzip cannot compress (WOFF is already
# a compressed container, so there is nothing to squeeze). It was 47% of the
# 363 KB critical path and rendered 8 glyphs, and its `@font-face` was
# `font-display: block` - so on slow 4G the icons were invisible for up to
# ~3s, the same defect class the roadmap flags as a critical trust-breaker.
#
# styles.scss now paints every `.bi` with a CSS `mask-image` data-URI instead,
# and that stylesheet links after Bootstrap, so nothing here is load-bearing
# for rendering. Stripping the <link> makes the saving GUARANTEED rather than
# dependent on lazy font-loading behaviour, and eliminates the
# `font-display: block` risk outright. The CSS being removed is 96 KB carrying
# 2,050 per-icon `content: "\fXXXX"` rules, none of which exist now.
#
# No CSP change is needed: `_headers` already sets `img-src 'self' data: https:`,
# which permits data URIs.
#
# WHY THE GUARD RUNS FIRST
# ------------------------
# Order is deliberate. The check below runs before the <link> is removed or the
# asset files are deleted, so a failure aborts the render with reachability
# untouched. An uncovered `bi-*` class would otherwise render as *nothing* -
# silently - which is exactly the failure mode that makes this risky to ship
# without a check.

icons_dir <- file.path(site_dir, "site_libs", "bootstrap")
icons_css <- file.path(icons_dir, "bootstrap-icons.css")
icons_woff <- file.path(icons_dir, "bootstrap-icons.woff")

# Every `bi-*` class in the rendered output must have a mask rule.
#
# The scan reads `class="..."` ATTRIBUTES rather than grepping the raw HTML,
# and that is not fussiness: books/index.html contains the URL
# `.../cheatsheet/dbi-cheatsheet.pdf`, so a bare `bi-*` text search matches the
# substring "bi-cheatsheet" and reports an icon that does not exist.
icon_classes <- character(0)
for (page in list.files(site_dir, pattern = "\\.html$", recursive = TRUE,
                        full.names = TRUE)) {
  html <- paste(readLines(page, warn = FALSE), collapse = "\n")
  attrs <- regmatches(html, gregexpr('class="[^"]*"', html))[[1]]
  for (attr in attrs) {
    tokens <- strsplit(sub('^class="', "", sub('"$', "", attr)), "[[:space:]]+")[[1]]
    icon_classes <- c(icon_classes, grep("^bi-.+", tokens, value = TRUE))
  }
}
icon_classes <- sort(unique(icon_classes))

if (length(icon_classes)) {
  styles_file <- file.path(site_dir, "styles.css")
  if (!file.exists(styles_file)) {
    stop("post-render: expected ", styles_file,
         " - run Rscript compile-styles.R before quarto render.")
  }
  compiled <- paste(readLines(styles_file, warn = FALSE), collapse = "\n")

  uncovered <- icon_classes[!vapply(
    icon_classes,
    function(cls) grepl(paste0(".", cls, "::before"), compiled, fixed = TRUE),
    logical(1)
  )]

  if (length(uncovered)) {
    stop("post-render: these bi-* classes have no mask rule in styles.css and ",
         "would render as nothing: ", paste(uncovered, collapse = ", "),
         ". Add them to $bi-icons in styles.scss.")
  }
  message("post-render: ", length(icon_classes),
          " bi-* classes, all with mask rules")
}

# Three href shapes are in play, so match the whole tag on the filename rather
# than a fixed prefix: root pages emit `site_libs/...`, nested pages emit
# `../site_libs/...`, and 404.html emits an absolute `/site_libs/...`.
link_pat <- '<link[^>]*bootstrap-icons\\.css[^>]*>'

for (page in list.files(site_dir, pattern = "\\.html$", recursive = TRUE,
                        full.names = TRUE)) {
  html <- paste(readLines(page, warn = FALSE), collapse = "\n")
  if (!grepl(link_pat, html)) next
  writeLines(gsub(link_pat, "", html, perl = TRUE), page, useBytes = TRUE)
}
message("post-render: bootstrap-icons.css <link> stripped")

# Nothing references these once the <link> is gone, so they are deleted rather
# than left as 268 KB of unreachable weight in the committed _site/.
for (f in c(icons_css, icons_woff)) {
  if (file.exists(f)) {
    file.remove(f)
    message("post-render: removed ", f)
  }
}

# --- GA4 consent banner ----------------------------------------------------
#
# Injected here rather than via `include-before-body` in _quarto.yml, for two
# reasons:
#
#   1. Quarto 1.6.40 has no `include-in-body` at all, and `include-before-body`
#      places the banner inside <body> where Pandoc's search indexer picks it
#      up - the consent copy and both button labels became searchable text at the
#      top of every page's entry in search.json, so searching "Accept" surfaced
#      all four pages. Injecting after Pandoc has run keeps it out of the index
#      entirely, which is the actual fix rather than a filter over the symptom.
#   2. It is a position: fixed element, so its place in the DOM is purely
#      cosmetic, and the end of <body> is the conventional home for an overlay.
#
# The markup lives in consent-banner.html so the text and the stylesheet in
# styles.scss can be read together; this reads it once and stamps it into every
# page. A banner that only landed on some pages would be worse than none.
banner_file <- "consent-banner.html"
if (!file.exists(banner_file)) {
  stop("post-render: expected ", banner_file,
       " - it holds the GA4 consent banner markup.")
}
banner <- paste(readLines(banner_file, warn = FALSE), collapse = "\n")

# Quarto emits </body> with no leading whitespace, but tolerate either.
bannered <- 0
for (page in list.files(site_dir, pattern = "\\.html$", recursive = TRUE,
                        full.names = TRUE)) {
  html <- paste(readLines(page, warn = FALSE), collapse = "\n")
  if (grepl('id="consent-banner"', html, fixed = TRUE)) next   # already injected
  if (!grepl("</body>", html, fixed = TRUE)) next
  writeLines(sub("</body>", paste0(banner, "\n</body>"), html, fixed = TRUE),
             page, useBytes = TRUE)
  bannered <- bannered + 1
}
if (bannered) message("post-render: consent banner injected into ", bannered, " page(s)")

# ---------------------------------------------------------------------------
# Pre-cutover guard (now dormant).
#
# Quarto 1.6.40 DELETES a pre-existing root `index.html` when `index.qmd` is
# present, treating them as a path collision. That mattered BEFORE the cutover
# commit, when that legacy `index.html` was the live homepage: losing it from
# the working tree is harmless (the live site is served from committed state)
# but committing the deletion would have 404'd the homepage.
#
# `netlify.toml` now sets publish = "_site", so the legacy file is intentionally
# gone for good and this check no longer applies. It is retained but skips
# itself once the publish root has moved, so it cannot become permanent noise.
# ---------------------------------------------------------------------------
netlify <- if (file.exists("netlify.toml")) readLines("netlify.toml", warn = FALSE) else character(0)
cutover_done <- any(grepl('publish\\s*=\\s*"_site"', netlify))

if (!cutover_done && !file.exists("index.html")) {
  message(
    "post-render: WARNING - root index.html is missing. Quarto removes it ",
    "because index.qmd now owns that path. Confirm this deletion is ",
    "intentional. Restore with: git checkout -- index.html"
  )
}