# Generates the site's published imagery as WebP.
#
# WHY THIS EXISTS
# ---------------
# The originals were authored far larger than anything the site displays:
#   - hex stickers  : 1146x1328 to 2206x2557, displayed at 180px
#   - book covers   : 1410x2250, displayed at 72px tall
#   - avatar        : 855x761 (1.13 MB), used as the NAVBAR LOGO on every page
# Measured total for the 16 referenced assets: 4.07 MB.
#
# Targets are 2x the CSS display size for retina. As WebP q82 the same set is
# ~111 KB (-97%). WebP handles the alpha channel, so the hex silhouettes are
# safe.
#
# Originals are intentionally KEPT in the repo (git history also has them) as
# regeneration sources; only the outputs below are published. Do not publish
# the PNGs.
#
# Requires: R with the `magick` package. Run:  Rscript optimize-images.R

suppressPackageStartupMessages(library(magick))

img_dir <- "images"
webp_q  <- 82

stopifnot(dir.exists(img_dir))

# --- Alpha assertion --------------------------------------------------------
# The hex stickers MUST keep their alpha channel. Three of the eight shipped
# without it - hex-olsrr, hex-rbin and hex-vistributions each carried an opaque
# white plate instead - which is invisible on a white card and glaring on a dark
# one. It survived for as long as it did because nothing here looked.
#
# WHERE IT BREAKS, reproduced rather than guessed. All eight source PNGs are
# RGBA (IHDR colour type 6), and `image_resize(img, "360x")` preserves alpha for
# all eight - verified by writing the resized image to a PNG and reading the
# colour type back, since a PNG header is unambiguous where a WebP one is not.
# The loss is in `image_write(..., format = "webp")`, and it tracks the source
# size: the three that lost alpha are exactly the three 2206px-wide sources, while
# the five 1146px ones keep theirs. Going through an intermediate PNG changes
# nothing. That is as far as the diagnosis goes - the mechanism inside the codec
# is not established - but it is enough to make the failure loud instead of
# silent, which is the part that matters.
#
# WHY THE ASSERTION AND NOT A FIX. The three affected WebPs in `images/` are
# already correct (regenerated with the background knocked out), so re-running
# this script today would REGRESS them. The right outcome is therefore that the
# run stops and says so, rather than quietly writing three white plates again.
# Anyone who needs to regenerate has to solve the codec behaviour first.
#
# `image_data(img, channels = "rgba")` returns a 3-d bitmap whose FIRST dimension
# is the channel, so the alpha plane is `d[4, , ]` - all three indices, since
# `d[4, ]` is "incorrect number of dimensions", and it is not a data.frame so
# `$alpha` is an error. Both cost a run to find.
has_alpha <- function(path) {
  d <- image_data(image_read(path), channels = "rgba")
  min(as.numeric(d[4, , ])) < 250
}

#' Write a resized copy as WebP and report the saving.
save_webp <- function(src, out_name, geometry = NULL, quality = webp_q) {
  src_path <- file.path(img_dir, src)
  if (!file.exists(src_path)) {
    warning("missing source: ", src_path)
    return(invisible(NULL))
  }
  img  <- image_read(src_path)
  dims <- image_info(img)
  if (!is.null(geometry)) img <- image_resize(img, geometry)
  out_path <- file.path(img_dir, out_name)
  image_write(img, out_path, format = "webp", quality = quality)

  if (!has_alpha(out_path) && !has_alpha(src_path)) {
    stop("optimize-images: ", out_name, " was written WITHOUT an alpha channel, ",
         "and the source did not have one either. Refusing to continue: this is ",
         "the failure that put an opaque white plate behind the olsrr, rbin and ",
         "vistributions hex stickers, which is invisible on a white card and ",
         "glaring on a dark one. If the source is genuinely opaque, flatten it to ",
         "a colour type that says so deliberately; do not let the codec decide.")
  }
  if (!has_alpha(out_path) && has_alpha(src_path)) {
    stop("optimize-images: ", out_name, " LOST its alpha channel on the way to ",
         "WebP. The source has alpha and the output does not, so the sticker ",
         "would render as a rectangle instead of a hexagon.")
  }

  before <- file.size(src_path)
  after  <- file.size(out_path)
  out_i  <- image_info(image_read(out_path))
  cat(sprintf(
    "  %-26s %5.0fx%-5.0f -> %3.0fx%-3.0f  %7.0f KB -> %6.1f KB  (%+.0f%%)\n",
    out_name, dims$width, dims$height, out_i$width, out_i$height,
    before / 1024, after / 1024, 100 * (after - before) / before
  ))
  invisible(after)
}

saved <- c()

cat("avatar\n")
# Hero portrait: CSS width is 220px.
saved["avatar"]     <- save_webp("latest_profile.png", "avatar.webp",     "440x")
# Navbar logo: Quarto renders this ~40px tall on EVERY page. This was the
# single largest cost on the site - a 1.13 MB image for a 40px slot.
saved["avatar-sm"]  <- save_webp("latest_profile.png", "avatar-sm.webp",  "96x")

cat("\nhex stickers (360w, displayed at 180px)\n")
# hex_trial.png is the real high-resolution olsrr sticker; hex_olsrr.png is
# only 100x100 and was being upscaled to 180px, i.e. visibly blurry.
hex_src <- c("hex_trial.png", "hex_blorr.png", "hex_xplorerr.png",
             "hex_descriptr.png", "hex_inferr.png", "hex_rfm.png",
             "hex_vistributions.png", "hex_rbin.png")
hex_out <- c("hex-olsrr.webp", "hex-blorr.webp", "hex-xplorerr.webp",
             "hex-descriptr.webp", "hex-inferr.webp", "hex-rfm.webp",
             "hex-vistributions.webp", "hex-rbin.webp")
for (i in seq_along(hex_src)) saved[hex_out[i]] <- save_webp(hex_src[i], hex_out[i], "360x")

# Book covers are no longer generated here. They were raster renditions of
# intro-r.png / wrangle-r.png / viz-ggplot2.png / viz-base.png / rdbsql.png /
# ebook-bash-intro.png, and have been replaced by the standalone SVGs in
# images/covers/ - which are vector, stay sharp at any size, and cost ~9 KB for
# all six against ~15 KB of WebP. Those six PNGs are deleted; see the commit
# that removed them. Nothing in this script reads them any more.

cat("\nog card (1200x630 as JPEG - no transparency needed, far smaller than PNG)\n")
# Social scrapers universally accept JPEG. 1200x630 is retained because that is
# what the large card formats expect.
og_src <- file.path(img_dir, "og-card.png")
if (file.exists(og_src)) {
  og <- image_read(og_src)
  og_out <- file.path(img_dir, "og-card.jpg")
  image_write(og, og_out, format = "jpeg", quality = 88)
  b4 <- file.size(og_src); af <- file.size(og_out)
  cat(sprintf("  %-26s %5.0fx%-5.0f -> %3.0fx%-3.0f  %7.0f KB -> %6.1f KB  (%+.0f%%)\n",
              "og-card.jpg", image_info(og)$width, image_info(og)$height,
              image_info(image_read(og_out))$width, image_info(image_read(og_out))$height,
              b4 / 1024, af / 1024, 100 * (af - b4) / b4))
} else {
  warning("missing og-card.png - run make-og-card.ps1 first")
}

cat(sprintf("\nTotal published imagery: %.0f KB across %d files\n",
            sum(saved, na.rm = TRUE) / 1024, sum(!is.na(saved))))
cat("Originals retained in images/ as regeneration sources; only these outputs are published.\n")