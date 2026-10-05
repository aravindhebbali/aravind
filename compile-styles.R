# Compiles styles.scss -> styles.css.
#
# WHY THIS EXISTS
# ---------------
# Quarto 1.6.40 does NOT compile a `.scss` file referenced via `css:`. It
# copies the file verbatim into the output and emits:
#
#     <link rel="stylesheet" href="styles.scss">
#
# so the browser is handed raw SCSS - `$variables` and `&:hover` nesting are
# invalid CSS and get silently discarded. The entire design system was
# therefore inert: no custom colours, no grid rules, nothing. Verified by
# grepping the rendered page for the token `#0f172a`, which returned 0 hits.
#
# `_quarto.yml` points at `styles.css` (the compiled artefact). Both files are
# committed so a plain `quarto render` works without running this first.
#
# Run:  Rscript compile-styles.R

suppressPackageStartupMessages(library(sass))

src <- "styles.scss"
out <- "styles.css"

if (!file.exists(src)) stop("missing source: ", src)

before <- sass_options_get()
on.exit(sass_options_set(before), add = TRUE)
sass_options_set(output_style = 3L, precision = 5)

# NOTE: sass_file() in this version returns an `@import` stub rather than the
# compiled CSS, so the source lines are passed to sass() directly.
css <- sass(input = readLines(src, warn = FALSE))
writeLines(css, out, useBytes = TRUE)

x <- paste(css, collapse = "")
cat(sprintf("%s -> %s   %.1f KB -> %.1f KB\n",
            src, out, file.size(src) / 1024, file.size(out) / 1024))

# Fail loudly if compilation silently produced nothing useful.
stopifnot(nchar(x) > 500)
for (tok in c("$ink", "$accent", "&:")) {
  if (grepl(tok, x, fixed = TRUE)) {
    stop("compiled CSS still contains unexpanded `", tok, "` - compilation failed")
  }
}
cat("  variables resolved, nesting flattened, output looks valid\n")