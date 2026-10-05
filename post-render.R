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