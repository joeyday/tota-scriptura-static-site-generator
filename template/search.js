/* eslint-env browser */
/* global MiniSearch */
// The search page. MiniSearch (loaded from a CDN before this script) builds the index in the
// browser from /search-index.json and ranks the results; this script sets its options, shows
// an excerpt from around the first matched word, and pages the results. A search is live: every
// keystroke runs it. The query and the page number stay in the address (?q=…&page=2).

(() => {
  const PER_PAGE = 20
  const EXCERPT = 180 // characters; it starts a little before the first matched word

  // Left out of the index and of every query: they match nearly every page. (Not "will" or "no":
  // free will and "No second chance" are topics.)
  const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'if', 'in', 'into', 'is', 'it',
    'not', 'of', 'on', 'or', 'that', 'the', 'their', 'then', 'there', 'these', 'they', 'this', 'to',
    'was', 'with'
  ])

  // How MiniSearch turns a word into the term it files and looks up: lowercase, without accents
  // or the modifier letters of transliteration (ʿôlām is olam), and nothing at all for a stop
  // word or a lone letter (the "s" of "God's"). Returning nothing drops the word.
  const processTerm = (word) => {
    const term = word.normalize('NFD').replace(/[\p{M}\p{Lm}]/gu, '').toLowerCase()
    return !term || STOP_WORDS.has(term) || /^\p{L}$/u.test(term) ? null : term
  }

  const SEARCH_OPTIONS = {
    prefix: (term, i, terms) => i === terms.length - 1, // the word being typed is a prefix
    fuzzy: (term) => term.length > 5 ? 0.2 : false, // short words must match exactly
    boost: { title: 2 },
    boostDocument: (id) => id.endsWith('/notes') ? 0.5 : 1 // a topic before its notes
  }

  // A word as MiniSearch splits text into words: runs without spaces or punctuation.
  const WORD = /[^\n\r\p{Z}\p{P}]+/gu

  const input = document.getElementById('search-input')
  const results = document.getElementById('search-results')
  const status = document.getElementById('search-status')
  let index = null
  const bodies = {}
  let page = 1

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // About EXCERPT characters of the page from just before the first matched word (terms: the
  // index terms of a hit), cut between words, with … where it is cut. A hit on the title alone starts from the top of the page.
  function excerpt (body, terms) {
    let first = 0
    for (const m of body.matchAll(WORD)) {
      if (terms.has(processTerm(m[0]))) {
        first = m.index
        break
      }
    }
    let start = Math.max(0, first - 60)
    let end = Math.min(body.length, start + EXCERPT)
    while (start > 0 && body.charAt(start - 1) !== ' ') start--
    while (end < body.length && body.charAt(end) !== ' ') end++
    return (start > 0 ? '… ' : '') + esc(body.slice(start, end).trim()) + (end < body.length ? ' …' : '')
  }

  function render (query, hits) {
    results.innerHTML = ''
    if (!query) {
      status.textContent = ''
      return
    }
    if (!hits.length) {
      const searched = [...query.matchAll(WORD)].some((m) => processTerm(m[0]))
      status.textContent = searched ? 'No results found.' : 'Common words and single letters aren’t searched.'
      return
    }
    const pages = Math.ceil(hits.length / PER_PAGE)
    page = Math.min(page, pages)
    const shown = hits.slice((page - 1) * PER_PAGE, page * PER_PAGE)
    status.textContent = `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`
    let html = '<ul>'
    for (const hit of shown) {
      const terms = new Set(hit.terms)
      html += `<li><a href="${esc(hit.url)}">${esc(hit.title)}</a> <span class="kind">${esc(hit.kind)}</span>` +
        `<p class="excerpt">${excerpt(bodies[hit.id], terms)}</p></li>`
    }
    html += '</ul>'
    if (pages > 1) {
      html += `<nav class="pager" aria-label="Pages of results"><p>${pager(query, page, pages)}</p></nav>`
    }
    results.innerHTML = html
  }

  // « Previous · 1 · … · 4 · 5 · 6 · … · 20 · Next », like the book-to-book links of the Scripture
  // index. The current page is bold and unlinked; the first and last page and the two either side
  // of the current one are shown, and a gap is a …. (The result count is a live region of its own,
  // so a screen reader announces it, not the whole list, as a search runs.) A link keeps the query in its address, so it
  // works as a link too (the script takes the click).
  function pager (query, page, pages) {
    const link = (n, label) => `<a href="?q=${encodeURIComponent(query)}${n > 1 ? `&amp;page=${n}` : ''}" data-page="${n}">${label}</a>`
    const items = []
    if (page > 1) items.push(link(page - 1, '&laquo; Previous'))
    let last = 0
    for (let n = 1; n <= pages; n++) {
      if (n !== 1 && n !== pages && Math.abs(n - page) > 2) continue
      if (n - last > 1) items.push('…')
      items.push(n === page ? `<strong aria-current="page">${n}</strong>` : link(n, n))
      last = n
    }
    if (page < pages) items.push(link(page + 1, 'Next &raquo;'))
    return items.join(' &middot; ')
  }

  function search () {
    if (!index) return
    const query = input.value.trim()
    const url = new URL(window.location)
    if (query) url.searchParams.set('q', query)
    else url.searchParams.delete('q')
    if (page > 1) url.searchParams.set('page', page)
    else url.searchParams.delete('page')
    history.replaceState(null, '', url)
    render(query, query ? index.search(query, SEARCH_OPTIONS) : [])
  }

  results.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-page]')
    if (!link) return
    event.preventDefault()
    page = Number(link.dataset.page)
    search()
    input.scrollIntoView()
  })

  input.addEventListener('input', () => {
    page = 1
    search()
  })

  status.textContent = 'Loading the search index…'
  fetch('/search-index.json')
    .then((r) => r.json())
    .then((docs) => {
      index = new MiniSearch({ fields: ['title', 'body'], storeFields: ['title', 'url', 'kind'], processTerm })
      index.addAll(docs)
      for (const doc of docs) bodies[doc.id] = doc.body
      const params = new URLSearchParams(window.location.search)
      input.value = params.get('q') ?? ''
      page = Math.max(1, Number(params.get('page')) || 1)
      search()
    })
})()
