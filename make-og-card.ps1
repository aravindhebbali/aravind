# Generates images/og-card.png (1200x630) - the social card.
# Replaces images/logo.jpg, which is a 183x255 PORTRAIT and therefore unusable
# as a social card regardless of resolution (roadmap section 1, og:image).
# The designed version lands in Phase 3; this is the interim fallback so
# shares stop rendering badly today.
#
# ASCII-only by design: Windows PowerShell reads .ps1 files as ANSI unless
# they carry a BOM, so a literal middle dot renders as mojibake. The separator
# is built from a char code instead.
Add-Type -AssemblyName System.Drawing

$W = 1200; $H = 630
$navy   = [System.Drawing.Color]::FromArgb(15, 23, 42)     # #0f172a
$indigo = [System.Drawing.Color]::FromArgb(37, 99, 235)    # #2563eb
$white  = [System.Drawing.Color]::FromArgb(255, 255, 255)
$muted  = [System.Drawing.Color]::FromArgb(203, 213, 225)  # #cbd5e1
$dot    = [string][char]0x00B7

$bmp = New-Object System.Drawing.Bitmap $W, $H
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear($navy)

# Indigo accent bar
$bar = New-Object System.Drawing.SolidBrush $indigo
$g.FillRectangle($bar, 0, 0, 10, $H)

# Circular profile photo, left - clipped once, then ringed.
$src = [System.Drawing.Image]::FromFile((Resolve-Path "images\latest_profile.png"))
$size = 340
$cx = 110; $cy = [int](($H - $size) / 2)
$clip = New-Object System.Drawing.Drawing2D.GraphicsPath
$clip.AddEllipse($cx, $cy, $size, $size)
$g.SetClip($clip)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle $cx, $cy, $size, $size))
$g.ResetClip()
$ring = New-Object System.Drawing.Pen $indigo, 5
$g.DrawEllipse($ring, $cx, $cy, $size, $size)
$src.Dispose()

$tx = 500
$avail = ($W - $tx) - 60
$wb = New-Object System.Drawing.SolidBrush $white
$mb = New-Object System.Drawing.SolidBrush $muted

# Auto-fit: draw at the requested point size, shrinking until the string fits
# the available width. Prevents the overflow that clipped "CRAN downloads".
function Draw-Fitted($text, [float]$pt, $style, $brush, [float]$y) {
  $size = $pt
  while ($size -ge 10) {
    $f = New-Object System.Drawing.Font "Segoe UI", $size, $style, ([System.Drawing.GraphicsUnit]::Point)
    $w = $g.MeasureString($text, $f).Width
    $f.Dispose()
    if ($w -le $avail) { break }
    $size -= 0.5
  }
  $font = New-Object System.Drawing.Font "Segoe UI", $size, $style, ([System.Drawing.GraphicsUnit]::Point)
  $g.DrawString($text, $font, $brush, $tx, $y)
  $font.Dispose()
}

$bold = [System.Drawing.FontStyle]::Bold
$reg  = [System.Drawing.FontStyle]::Regular

Draw-Fitted "Aravind Hebbali" 46 $bold $wb 160
Draw-Fitted "Statistical Software" 25 $reg $mb 232
Draw-Fitted "& Quantitative Consulting" 25 $reg $mb 266
Draw-Fitted "olsrr $dot rfm $dot xplorerr $dot blorr" 29 $bold $wb 340
Draw-Fitted "Open-source packages & textbooks" 21 $reg $mb 404
Draw-Fitted "aravindhebbali.com" 21 $reg $mb 442

# Save BEFORE disposing.
$out = Join-Path (Get-Location) "images\og-card.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $wb.Dispose(); $mb.Dispose(); $bar.Dispose()

$check = [System.Drawing.Image]::FromFile($out)
"og-card.png = $($check.Width) x $($check.Height)  ratio=$([math]::Round($check.Width / $check.Height, 3))  size=$([math]::Round((Get-Item $out).Length / 1KB))KB"
$check.Dispose()