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

// The sheet's measurements in inches, for a book of `pages` pages (a printer's leaves are two pages
// each, so an odd count is rounded up).
export function coverSize (pages) {
  const spine = Math.ceil(pages / 2) * 2 * PAPER
  return {
    spine,
    width: 2 * BLEED + 2 * TRIM_WIDTH + spine,
    height: 2 * BLEED + TRIM_HEIGHT
  }
}

// `dark` is the cover in the site's dark theme.
export function composeCover ({ pages, dark = false, assets = '../asset/' }) {
  const { spine, width, height } = coverSize(pages)
  const inches = (n) => `${+n.toFixed(4)}in`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${TITLE}: cover</title>
<link rel="stylesheet" href="${assets}fonts.css">
<link rel="stylesheet" href="${assets}cover.css">
<style>
@page { size: ${inches(width)} ${inches(height)}; margin: 0; }
.cover { --bleed: ${inches(BLEED)}; --trim-width: ${inches(TRIM_WIDTH)}; --spine: ${inches(spine)}; --height: ${inches(height)}; width: ${inches(width)}; height: ${inches(height)}; }
</style>
<script src="https://kit.fontawesome.com/${FONT_AWESOME_KIT}.js" crossorigin="anonymous"></script>
</head>
<body>
<div class="cover${dark ? ' dark' : ''}">
<div class="field"></div>
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
