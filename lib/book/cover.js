import { FONT_AWESOME_KIT } from '../layout.js'

// ─── The cover, as one HTML page ───
// A printer wants the cover as one flat sheet: the back, the spine and the front side by side, with
// bleed all round (the 2020 book's was 9.17 × 7.13 in). The sheet's width depends on the book: the
// spine is as thick as the pages are. Everything else is the 2020 cover's, in the site's fonts:
// a gray field cut by a 45° diagonal, the title, subtitle and author on the front, the spine's title
// and author, and 2 Timothy 3:16–17 on the back. template/cover.css has the look; this has the numbers.

// The trim size is the book's (template/book.css); the bleed is the usual eighth of an inch.
const TRIM_WIDTH = 4.25
const TRIM_HEIGHT = 6.8598
const BLEED = 0.125
// Chrome prints a page to the nearest 0.24 pt or so, either way (a 9.27 in page came out 0.48 pt short), so the page
// asked for is this many points more than the sheet, to be sure of one at least as big
const SLACK = 0.5
// Inches of spine per page (a side of a leaf). A placeholder until a printer and a paper are chosen:
// KDP's white paper. Change it, and nothing else, when the paper is known.
const PAPER = 0.002252

const TITLE = 'Tota Scriptura'
const SUBTITLE = ['A Systematic-Theological', 'Concordance of the Holy Bible']
const AUTHOR = 'Joey Day'
const QUOTE = [
  'All Scripture is breathed out by God and',
  'profitable for teaching, for reproof, for',
  'correction, and for training in righteousness,',
  'that the man of God may be competent,',
  'equipped for every good work.'
]
const CITATION = '— 2 Timothy 3:16–17'

// The sheet's measurements, for a book of `pages` pages (a printer's leaves are two pages each, so an odd
// count is rounded up). `width` and `height` are the sheet in inches, rounded up to a whole number of points,
// the extra falling in the bleed (`widthPt` and `heightPt` are the same in points): a viewer draws a PDF page
// in whole pixels, and a page that is a fraction of a point too large shows the rest of its last row and column
// as a hairline of white around the cover. `page` is what is printed, the sheet up to the hundredth of an inch
// that Chrome sizes a page by, and SLACK more; renderCoverPdf then cuts the PDF's page down to the sheet.
export function coverSize (pages) {
  const spine = Math.ceil(pages / 2) * 2 * PAPER
  const points = (inches) => Math.ceil(inches * 72 - 1e-6)
  const widthPt = points(2 * BLEED + 2 * TRIM_WIDTH + spine)
  const heightPt = points(2 * BLEED + TRIM_HEIGHT)
  const hundredths = (pt) => Math.ceil((pt + SLACK) / 72 * 100 - 1e-6) / 100
  return { spine, width: widthPt / 72, height: heightPt / 72, widthPt, heightPt, page: { width: hundredths(widthPt), height: hundredths(heightPt) } }
}

// The gray field: a polygon, in points from the page's top left, that leaves the top edge 23.5 pt in from the
// left (the 2020 cover's) and runs down to the right at 45°. It is vector artwork on purpose: as a CSS clip-path
// Chrome prints it through a soft mask with an edge of its own.
function field ({ width, height }) {
  const [w, h] = [width * 72, height * 72]
  const n = (x) => +x.toFixed(2)
  return `<svg class="field" width="${n(w)}pt" height="${n(h)}pt" viewBox="0 0 ${n(w)} ${n(h)}"><polygon points="23.5,0 ${n(w)},0 ${n(w)},${n(h)} ${n(23.5 + h)},${n(h)}"/></svg>`
}

export function composeCover ({ pages, dark = false, assets = '../asset/' }) {
  const { spine, page } = coverSize(pages)
  const inches = (n) => `${+n.toFixed(4)}in`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${TITLE}: cover</title>
<link rel="stylesheet" href="${assets}fonts.css">
<link rel="stylesheet" href="${assets}cover.css">
<style>
@page { size: ${inches(page.width)} ${inches(page.height)}; margin: 0; }
.cover { --bleed: ${inches(BLEED)}; --trim-width: ${inches(TRIM_WIDTH)}; --spine: ${inches(spine)}; width: ${inches(page.width)}; height: ${inches(page.height)}; }
</style>
<script src="https://kit.fontawesome.com/${FONT_AWESOME_KIT}.js" crossorigin="anonymous"></script>
</head>
<body>
<div class="cover${dark ? ' dark' : ''}">
${field(page)}
<section class="back">
<p class="quote">${QUOTE.join('<br>')}</p>
<p class="citation">${CITATION}</p>
</section>
<section class="spine">
<p class="spine-title">${TITLE}</p>
<p class="spine-author">${AUTHOR}</p>
</section>
<section class="front">
<p class="icon"><span class="fa-sharp fa-solid fa-feather-pointed"></span></p>
<h1>${TITLE}</h1>
<p class="subtitle">${SUBTITLE.join('<br>')}</p>
<hr>
<p class="author">${AUTHOR}</p>
</section>
</div>
</body>
</html>
`
}
