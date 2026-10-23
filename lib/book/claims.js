// ─── Claims that broke badly ───
// This runs inside the page, after Paged.js has laid the book out, so it can't use anything from this file's
// scope: it must stay one self-contained function (renderPdf sends its source to the page). A claim (a term and its descriptions, `.claim[data-c]`) breaks
// well when it is on one page, or when each of its pieces holds at least two lines (the term counts as one) and the
// first has some of a description with its term. Returns the ids (data-c) of the claims that don't, and how many of
// those are too tall to hold whole (about a page) and so are left as they broke.
export function badClaims (root = document) {
  const pieces = new Map()
  for (const el of root.querySelectorAll('.claim[data-c]')) {
    if (!pieces.has(el.dataset.c)) pieces.set(el.dataset.c, [])
    pieces.get(el.dataset.c).push(el)
  }
  // Lines are the clusters of the text's boxes by vertical centre: a superscript or a small-caps run sits within
  // half a line of its line's centre
  const lines = (el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const pitch = parseFloat(window.getComputedStyle(el.querySelector('dd') ?? el).lineHeight) || 16
    const centres = [...range.getClientRects()].filter((r) => r.height > 2).map((r) => r.top + r.height / 2).sort((a, b) => a - b)
    let count = 0
    let start = -Infinity
    for (const c of centres) {
      if (c - start > pitch / 2) {
        count++
        start = c
      }
    }
    return count
  }
  const bad = []
  let tall = 0
  for (const [id, parts] of pieces) {
    if (parts.length < 2) continue
    const wrongly = !parts[0].querySelector('dd') || parts.some((part) => lines(part) < 2)
    if (!wrongly) continue
    const height = parts.reduce((sum, part) => sum + part.getBoundingClientRect().height, 0)
    const room = parts[0].closest('.pagedjs_page').querySelector('.pagedjs_page_content').getBoundingClientRect().height
    if (height > room * 0.8) tall++
    else bad.push(id)
  }
  return { bad, tall }
}
