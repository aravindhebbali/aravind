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
  "https://www.aravindhebbali.com/books/",
  # Not linked from the navbar on purpose - a privacy page reachable from
  # navigation is discoverable, which is the point of having one.
  "https://www.aravindhebbali.com/privacy/"
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
#
# A BARE `bi` TOKEN IS ALSO COLLECTED, and this is not a refinement - it is a bug
# this check was written too narrowly to catch. Quarto's own copy button is
# `<button class="code-copy-button"><i class="bi"></i></button>`: a `bi` class
# with no `bi-*` name, because the glyph is not chosen by class but by a
# `background-image` on `pre:hover`. The generic `.bi::before` rule then matched
# it and gave it a 1em `background-color: currentColor` with no mask to punch
# through, so it rendered as a solid filled square on every code block - black in
# light mode, white in dark. Shipped, unnoticed, and invisible to a `bi-*` scan.
#
# The failure is worse than an uncovered `bi-*`, which renders as nothing: a bare
# `bi` with no mask renders as an opaque BLOCK. So both are collected and both
# are required to have a mask rule, and the error message says which kind is
# missing rather than making the reader work it out.
icon_classes <- character(0)
bare_bi <- 0L
for (page in list.files(site_dir, pattern = "\\.html$", recursive = TRUE,
                        full.names = TRUE)) {
  html <- paste(readLines(page, warn = FALSE), collapse = "\n")
  attrs <- regmatches(html, gregexpr('class="[^"]*"', html))[[1]]
  for (attr in attrs) {
    tokens <- strsplit(sub('^class="', "", sub('"$', "", attr)), "[[:space:]]+")[[1]]
    icon_classes <- c(icon_classes, grep("^bi-.+", tokens, value = TRUE))
    # A lone `bi` with no `bi-*` sibling on the same element.
    if ("bi" %in% tokens && !any(grepl("^bi-.+", tokens))) bare_bi <- bare_bi + 1L
  }
}
icon_classes <- sort(unique(icon_classes))

# The bare-`bi` case is checked by selector rather than by class name, because
# there is no class name to check - the mask hangs off `.code-copy-button .bi`.
if (bare_bi && file.exists(file.path(site_dir, "styles.css"))) {
  compiled_bare <- paste(readLines(file.path(site_dir, "styles.css"),
                                   warn = FALSE), collapse = "\n")
  if (!grepl(".code-copy-button .bi::before", compiled_bare, fixed = TRUE)) {
    stop("post-render: ", bare_bi, " element(s) carry a bare `bi` class with no ",
         "bi-* sibling (the code-copy button), and styles.css has no ",
         ".code-copy-button .bi::before mask rule. Such an element renders as a ",
         "solid filled square, not as a missing icon.")
  }
}

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
if (bare_bi) {
  message("post-render: ", bare_bi, " bare `bi` element(s), mask rule present")
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

# --- Suppress the Google Fonts @import in the built Bootstrap CSS ----------
#
# cosmo compiles to an @import of fonts.googleapis.com at the very top of its
# stylesheet. That is a network request made BY THE STYLESHEET, before any of
# this page's script runs, so it reaches Google BEFORE the consent banner is
# answered and the consent gate cannot intercept it. Measured on first paint with
# the banner still visible: fonts.googleapis.com plus one fonts.gstatic.com
# request per page load.
#
# styles.scss now declares Source Sans Pro itself (same two files Google was
# serving: w400 and w600, latin subset, 14.5 KB + 14.3 KB), so the @import is
# redundant - but declaring the font does NOT suppress an @import. Verified in a
# scratch project: with both present, the @import survives into the built CSS and
# is still fetched. @import is a top-of-file statement the browser acts on before
# it has applied any later rule.
#
# So the statement itself is removed from the BUILT stylesheet here. Editing
# _site rather than the Quarto theme is deliberate: the theme is a shared SCSS
# partial under the Quarto install, and `theme: [cosmo]` in _quarto.yml is a
# named reference to it. Rewriting a file inside the Quarto installation would
# break on upgrade and would not survive a reinstall, whereas _site is a build
# artefact that post-render.R already corrects for other reasons.
#
# Matched on the quoted URL. cosmo writes the statement with the URL in DOUBLE
# QUOTES - `@import"https://…:wght@300;400;700&display=swap";` - so `@import"[^"]*";`
# matches exactly one statement and cannot overrun.
#
# Two approaches were tried and rejected first, both verified against this file:
#
#   - `[^;]*` up to the first semicolon: stops INSIDE the URL, because the weight
#     list contains semicolons (wght@300;400;700). Removing what it matched left
#     a dangling `400;700&display=swap";` at the head of the file. That is invalid
#     CSS at position 0 and can invalidate the whole stylesheet - a worse outcome
#     than leaving the @import in.
#   - matching through to the next `}`: there is no brace of its own. The import
#     is immediately followed by `:root,[data-bs-theme=light]{…}`, so a `.*?\}`
#     match swallows the entire :root block and deletes the design tokens.
boot_css <- list.files(file.path(site_dir, "site_libs", "bootstrap"),
                       pattern = "\\.css$", full.names = TRUE)
font_import <- '@import"[^"]*";'
for (f in boot_css) {
  css <- paste(readLines(f, warn = FALSE), collapse = "\n")
  if (!grepl(font_import, css)) next
  # Only touch a stylesheet that really does import from Google; a future
  # Bootstrap build with no Google import must be left byte-identical.
  if (!grepl("fonts\\.googleapis\\.com", css)) next

  stripped <- gsub(font_import, "", css)

  # Belt and braces: the removal must be small (this statement is 96 bytes) and
  # must leave the tokens and the file tail intact. If any check fails, keep the
  # original rather than shipping a truncated stylesheet.
  removed <- nchar(css) - nchar(stripped)
  intact <- grepl(":root,\\[data-bs-theme=light\\]", stripped) &&
           !grepl("fonts\\.googleapis", stripped)
  if (removed <= 0 || removed > 500 || !intact) {
    warning("post-render: @import strip of ", basename(f),
            " looked unsafe (removed ", removed, " bytes); left unchanged")
    next
  }
  writeLines(stripped, f, useBytes = TRUE)
  message("post-render: Google Fonts @import removed from ", basename(f),
          " (", removed, " bytes)")
}

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

# --- Inject the theme toggle into the navbar --------------------------------
#
# WHY HERE AND NOT IN A QUARTER FILE. The navbar is generated by Quarto from
# `website.navbar` in _quarto.yml, and Quarto 1.6.40 offers no raw-HTML slot for
# it - the same constraint that forced the Bootstrap Icons font to become CSS
# masks in the first place. The only knob is `right:`, which takes a link with an
# `icon:` and gives no control over the element, its attributes or its
# accessibility text. So the button is stamped in here, the same way and for the
# same reason as the consent banner above.
#
# NOT `include-before-body`: that was tried for the banner and put the copy AND
# both button labels at the top of every page's entry in search.json, so searching
# "Accept" surfaced all four pages. Injecting after Pandoc has run keeps the label
# out of the index entirely. The visible label here is an SVG mask, and the
# accessible name is an aria-label plus a visually-hidden span - neither is
# indexed, and both are asserted by verify-site.mjs so a future Quarto cannot
# quietly change that.
#
# Anchored on the whole `#quarto-search` element rather than on `<nav` or on a
# class, because the surrounding markup differs between root and nested pages
# (relative hrefs, `quarto:offset`) while this element does not. If the anchor
# ever stops matching, the counter below is 0 and that is a build failure rather
# than a silently missing button.
toggle_button <- paste0(
  '<button type="button" class="theme-toggle" aria-label="Switch colour theme">',
  '<span class="visually-hidden">Switch colour theme</span>',
  '<i class="bi bi-moon-fill theme-icon-dark" aria-hidden="true"></i>',
  '<i class="bi bi-sun-fill theme-icon-light" aria-hidden="true"></i>',
  '</button>'
)
# Quarto indents this line by 10 spaces in both root and nested output.
toggle_anchor <- '<div id="quarto-search" class="" title="Search"></div>'
toggled <- 0
for (page in list.files(site_dir, pattern = "[.]html$", recursive = TRUE,
                        full.names = TRUE)) {
  html <- paste(readLines(page, warn = FALSE), collapse = "\n")
  if (grepl('class="theme-toggle"', html, fixed = TRUE)) next   # already injected
  if (!grepl(toggle_anchor, html, fixed = TRUE)) next
  stamped <- sub(toggle_anchor, paste0(toggle_anchor, "\n          ", toggle_button),
                 html, fixed = TRUE)
  if (!identical(html, stamped)) {
    writeLines(stamped, page, useBytes = TRUE)
    toggled <- toggled + 1
  }
}
if (!toggled) {
  stop("post-render: the theme toggle was injected into 0 pages - the anchor ",
       toggle_anchor, " no longer appears in the output. Quarto's navbar markup ",
       "has probably changed; refusing to ship a navbar with no toggle is safer ",
       "than shipping one that silently does not exist.")
}
message("post-render: theme toggle injected into ", toggled, " page(s)")

# --- Normalise mangled root-relative links on 404.html ---------------------
#
# Quarto renders 404.html with `quarto:offset` = "/", and on Windows it resolves
# the homepage's root-relative Explore links (`packages/`, `apps/`, `books/`)
# against that offset with the OS separator, emitting:
#
#     href="/.\packages/"      href="/.\apps/"      href="/.\books/"
#
# These are wrong markup. Verified 2026-10-07 that Netlify happens to normalise
# them and serve the correct pages, so this was never a user-facing break - but
# nothing guarantees another host will, and a 404 page whose own links are
# malformed is a bad thing to ship. Only 404.html is affected; the other pages
# carry clean relative paths.
#
# Fixed here rather than in 404.qmd because it is a renderer artefact, and
# post-render.R already exists for output that has to be corrected after the
# fact. Rewritten to a plain absolute path, which is correct from any depth.
backslash_fix <- 0
# The pattern is the three characters / . \ - i.e. slash, dot, backslash. In an
# R string literal that is "/.\\" and NOT '/\\.\\', which is FOUR characters
# (slash, backslash, dot, backslash) and silently never matches.
backslash_pat <- "/.\\"
for (page in list.files(site_dir, pattern = "[.]html$", recursive = TRUE,
                        full.names = TRUE)) {
  html <- paste(readLines(page, warn = FALSE), collapse = "\n")
  if (!grepl(backslash_pat, html, fixed = TRUE)) next
  fixed <- gsub(backslash_pat, "/", html, fixed = TRUE)
  if (!identical(html, fixed)) {
    writeLines(fixed, page, useBytes = TRUE)
    backslash_fix <- backslash_fix + 1
  }
}
if (backslash_fix) {
  message("post-render: normalised mangled root-relative links in ", backslash_fix, " page(s)")
}

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