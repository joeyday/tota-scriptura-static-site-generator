// ─── Page numbers ───
// This runs inside the page, after Paged.js has laid the book out, so it can't use anything from
// this file's scope: it must stay one self-contained function. Numbers are ours, not Paged.js's
// counter(page) and target-counter() (whose counter can't be reset without losing every
// cross-reference). The front matter (the title, copyright and dedication pages, the contents and
// the preface) counts in lower-case Roman numerals from the title page and shows its number from
// the preface on (the contents show none); the book proper restarts at 1 in Arabic on the first Part's page (a
// Part page shows no number). A blank page still counts, so a chapter stays on a right-hand page.
// The same numbers fill in every cross-reference, contents line and index entry (a page cited twice in
// one entry is listed once).
// Returns { first, pages, unresolved, folios } for the caller to check: the number each page shows
// ('' for none).
export function numberPages () {
  const roman = (n) => {
    let out = ''
    for (const [value, letters] of [[100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) {
      while (n >= value) {
        out += letters
        n -= value
      }
    }
    return out
  }
  const pages = [...document.querySelectorAll('.pagedjs_page')]
  const pageOf = (id) => {
    const found = document.querySelector(`[id="${id}"]`)
    return found ? pages.indexOf(found.closest('.pagedjs_page')) : -1
  }
  const first = Math.max(pageOf('part-1'), 0)
  const preface = pageOf('preface')
  const label = (i) => (i >= first ? String(i - first + 1) : roman(i + 1))

  const folios = pages.map((page, i) => {
    // No number on a blank page or a Part page, nor on the title, copyright and dedication pages
    const shown = page.classList.contains('pagedjs_blank_page') || page.querySelector('.part')
      ? false
      : i >= first || (preface >= 0 && i >= preface)
    if (!shown) return ''
    const folio = document.createElement('div')
    folio.className = 'folio'
    folio.textContent = label(i)
    ;(page.querySelector('.pagedjs_pagebox') ?? page).appendChild(folio)
    return folio.textContent
  })

  let unresolved = 0
  for (const link of document.querySelectorAll('.pagedjs_page a[data-p], .pagedjs_page a.pn')) {
    const i = pageOf((link.getAttribute('href') ?? '').slice(1))
    if (i < 0) {
      unresolved++
      continue
    }
    if (link.hasAttribute('data-p')) link.setAttribute('data-p', label(i))
    else link.textContent = label(i)
  }
  // An entry cited several times on one page lists that page once
  for (const entry of document.querySelectorAll('.pagedjs_page p.ix')) {
    const seen = new Set()
    for (const cited of entry.querySelectorAll('.pg')) {
      const n = cited.querySelector('a.pn')?.textContent
      if (seen.has(n)) cited.style.display = 'none'
      else seen.add(n)
    }
  }
  return { first, pages: pages.length, unresolved, folios }
}
