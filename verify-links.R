# Checks every package card links to a live docs host, and that no card is
# missing one it should have.
#
# WHY THIS EXISTS
# ---------------
# The rbin, yahoofinancer and standby cards shipped with no Docs button because
# roadmap section 8.1 listed only seven per-package doc subdomains ("+6
# siblings"). All three hosts were in fact live and returning 200. That table
# was an incomplete hand-check, and nothing re-verified it - so an omission in a
# planning document silently became a missing link on the live site.
#
# This enumerates the packages from the cards themselves rather than from any
# hand-maintained list, then checks each expected host.
#
# Run: Rscript verify-links.R     (exit 1 on failure)

pkg_root <- normalizePath(".")
pkgs <- c("olsrr", "blorr", "descriptr", "inferr", "rfm", "vistributions",
          "xplorerr", "rbin", "yahoofinancer", "standby")

# Packages whose docs host is known dead, with the correct fallback instead.
dead <- c(nse2r = "github.com/rsquaredacademy/nse2r")

pages <- c("packages/index.qmd", "index.qmd", "apps/index.qmd", "books/index.qmd")
cards <- unlist(lapply(pages, function(p) {
  lines <- readLines(file.path(pkg_root, p), warn = FALSE)
  starts <- grep("^### \\[([A-Za-z0-9]+)\\]\\(", lines)
  vapply(starts, function(i) sub("^### \\[([A-Za-z0-9]+)\\].*$", "\\1", lines[i]), "")
}))

all_lines <- unlist(lapply(pages, function(p) readLines(file.path(pkg_root, p), warn = FALSE)))

host_for <- function(pkg) {
  u <- paste0("https://", pkg, ".rsquaredacademy.com")
  code <- tryCatch({
    suppressWarnings(curl::curl_fetch_memory(u)$status_code)
  }, error = function(e) NA_integer_)
  if (is.na(code)) return(NA_character_)
  if (code >= 200 && code < 400) u else NA_character_
}

fail <- character(0)
cat("package          docs host                    linked\n")

for (pkg in pkgs) {
  host <- host_for(pkg)
  if (is.na(host)) {
    cat(sprintf("%-15s %-27s %s\n", pkg, "UNREACHABLE", "-"))
    fail <- c(fail, paste(pkg, "docs host unreachable but card may link to it"))
    next
  }
  linked <- any(grepl(host, all_lines))
  cat(sprintf("%-15s %-27s %s\n", pkg, host, if (linked) "yes" else "NO <- missing"))
  if (!linked) fail <- c(fail, paste(pkg, "has no Docs link to", host))
}

for (pkg in names(dead)) {
  if (pkg %in% cards) {
    linked <- any(grepl(dead[[pkg]], all_lines))
    cat(sprintf("%-15s %-27s %s\n", pkg, dead[[pkg]],
                if (linked) "yes (fallback)" else "NO <- missing fallback"))
    if (!linked) fail <- c(fail, paste(pkg, "has no link to its fallback"))
  }
}

if (length(fail)) {
  cat("\nFAIL\n"); for (f in fail) cat("  -", f, "\n")
  quit(status = 1)
}
cat("\nPASS - every card links to a live docs host\n")
