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
    if (!query) {
      results.innerHTML = ''
      return
    }
    if (!hits.length) {
      const searched = [...query.matchAll(WORD)].some((m) => processTerm(m[0]))
      results.innerHTML = searched
        ? '<p class="result-count">No results found.</p>'
        : '<p class="result-count">Common words and single letters aren’t searched.</p>'
      return
    }
    const pages = Math.ceil(hits.length / PER_PAGE)
    page = Math.min(page, pages)
    const shown = hits.slice((page - 1) * PER_PAGE, page * PER_PAGE)
    let html = `<p class="result-count">${hits.length} ${hits.length === 1 ? 'result' : 'results'}${pages > 1 ? ` · page ${page} of ${pages}` : ''}</p><ul>`
    for (const hit of shown) {
      const terms = new Set(hit.terms)
      html += `<li><a href="${esc(hit.url)}">${esc(hit.title)}</a> <span class="kind">${esc(hit.kind)}</span>` +
        `<p class="excerpt">${excerpt(bodies[hit.id], terms)}</p></li>`
    }
    html += '</ul>'
    if (pages > 1) {
      html += '<nav class="pager" aria-label="Pages of results">' +
        `<button type="button" data-page="${page - 1}"${page === 1 ? ' disabled' : ''}>Previous</button>` +
        `<span>Page ${page} of ${pages}</span>` +
        `<button type="button" data-page="${page + 1}"${page === pages ? ' disabled' : ''}>Next</button></nav>`
    }
    results.innerHTML = html
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
    const button = event.target.closest('button[data-page]')
    if (!button) return
    page = Number(button.dataset.page)
    search()
    input.scrollIntoView()
  })

  input.addEventListener('input', () => {
    page = 1
    search()
  })

  results.innerHTML = '<p class="result-count">Loading the search index…</p>'
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
