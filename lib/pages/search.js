// The search page and the index it loads. The page's script is template/search.js.
import { info } from '../log.js'

export async function writeSearch ({ output, renderLayout, searchDocs, cacheBust }) {
  await output.writeFile('search-index.json', JSON.stringify(searchDocs))
  info(`Built search index: ${searchDocs.length} document(s)`)

  const searchContent = `<div id="search-page">
  <form action="/search" method="GET" role="search">
    <label class="visually-hidden" for="search-input">Search</label>
    <input type="search" id="search-input" name="q" placeholder="Search" autofocus>
    <button type="submit"><span class="fa-sharp fa-solid fa-magnifying-glass" aria-hidden="true"></span><span class="visually-hidden">Search</span></button>
  </form>
  <div id="search-results" aria-live="polite"></div>
  <noscript><p>Search needs JavaScript.</p></noscript>
</div>
<script src="https://cdn.jsdelivr.net/npm/minisearch@7.2.0/dist/umd/index.min.js" integrity="sha384-9Eacb80ywplqCp0P/bR61+zYn5Pg2LmQ7T8rppdoKHcQMmXbRh1wHwRC8avUJvnz" crossorigin="anonymous"></script>
<script src="/asset/search.js?${cacheBust}"></script>`

  const searchHtml = renderLayout(searchContent, {
    url: '/search',
    frontmatter: { title: 'Search', permalink: 'search' }
  })

  await output.emit('/search', searchHtml)
  info('Built: /search')
}
