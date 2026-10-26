import { NAMESPACES } from '../model.js'
import { compareOrder } from '../titles.js'
import { escHtml } from '../html/escape.js'
import { info } from '../log.js'

// The two lines of the index menu, at the top of each index: the featured pages, the namespaces'
// lists and the Scripture index. A namespace with nothing listed is left out.
const MENU_ROWS = [
  ['featured', 'topic', 'commentary'],
  ['reference', 'meta', 'category', 'scripture']
]
const MENU_LABELS = { ...NAMESPACES, featured: 'Featured pages', scripture: 'Scripture' }

// The menu box, with `selected` (a name from MENU_ROWS) shown as the page you are on. Each row is its
// own list, so the line break between them never leaves a stray middot.
export function indexMenuHtml (selected, listedNamespaces) {
  const rows = MENU_ROWS.map((row) =>
    row.filter((name) => !(name in NAMESPACES) || listedNamespaces.includes(name))
  ).filter((row) => row.length > 0)
  let html = '<div class="namespace-menu index-menu" role="group" aria-label="Index sections">\n'
  for (const row of rows) {
    html += '<ul>\n'
    for (const name of row) {
      html += name === selected
        ? `  <li class="selected" aria-current="page">${MENU_LABELS[name]}</li>\n`
        : `  <li><a href="/index/${name}">${MENU_LABELS[name]}</a></li>\n`
    }
    html += '</ul>\n'
  }
  return html + '</div>\n'
}

// The category index's switch, at the foot of the page, is remembered, for the whole site, in the browser (the settings page
// has the same switch). The class on <html> is set before the lists are drawn, so they show right
// from the first paint, and the switch keeps it, and the saved choice, in step.
const CATEGORY_SHOWN_SCRIPT = `<script>
try { if (localStorage.getItem('category-list') === 'alphabetical') document.documentElement.classList.add('categories-alphabetical') } catch (e) {}
</script>`
const CATEGORY_SWITCH_SCRIPT = `<script>
(function () {
  var box = document.getElementById('list-alphabetically')
  var root = document.documentElement
  box.checked = root.classList.contains('categories-alphabetical')
  box.addEventListener('change', function () {
    root.classList.toggle('categories-alphabetical', box.checked)
    try { localStorage.setItem('category-list', box.checked ? 'alphabetical' : 'nested') } catch (e) {}
  })
})()
</script>`

// A page that sends the browser on to another
const redirectStub = (toUrl, what) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=${toUrl}">
  <link rel="canonical" href="${toUrl}">
  <title>Redirecting to the ${what}</title>
</head>
<body>
  <p>Redirecting to the <a href="${toUrl}">${what}</a>…</p>
</body>
</html>`

// The index for each namespace (/index/topic, /index/commentary, …: alphabetical, but the
// commentaries are in canonical order), plus the featured and drafts indexes. The category index
// holds two lists with a switch between them: the categories nested as they are
// (the default), and all of them alphabetically. Where the indexes used to be
// (/index/alphabetical/…, /index/categorical) there are redirects.
export async function writeIndexes ({
  output,
  renderLayout,
  filesToProcess,
  listedNamespaces,
  indexByNs,
  membersMap,
  featuredPages,
  draftPages,
  featuredWithMap
}) {
  // The categories as a tree: a category is under each category that lists it (they are in the order
  // of `order`), and a category in none is at the top. `trail` guards against a loop.
  const categories = new Map(
    filesToProcess
      .filter((fi) => fi.isCategory && !fi.hidden && !fi.unlisted)
      .map((fi) => [fi.finalUrlPath, { title: fi.title, url: fi.finalUrlPath, order: fi.order ?? undefined }])
  )
  const childrenOf = (url) => (membersMap[url] ?? []).filter((member) => categories.has(member.url))
  const nested = new Set([...categories.keys()].flatMap((url) => childrenOf(url).map((child) => child.url)))
  const treeHtml = (items, trail = []) => items.length === 0
    ? ''
    : `<ul>\n${items.map((item) => {
      const children = childrenOf(item.url).filter((child) => !trail.includes(child.url))
      return `<li><a href="${item.url}">${escHtml(item.title)}</a>${treeHtml(children, [...trail, item.url])}</li>`
    }).join('\n')}\n</ul>`
  const topLevelCategories = [...categories.values()].filter((item) => !nested.has(item.url)).sort(compareOrder)

  // `entries`: the lists of a namespace's pages, set in the muted color
  const listHtml = (items, { stars = false, featuredWith = false, entries = false } = {}) => {
    if (items.length === 0) return '<p>No pages yet.</p>'
    let html = entries ? '<ul class="entries">\n' : '<ul>\n'
    for (const item of items) {
      if (item.redirect) {
        html += `  <li>${escHtml(item.title)} <small>(see <a href="${item.redirect.url}">${escHtml(item.redirect.title)}</a>)</small></li>\n`
      } else {
        const starHtml =
          stars && item.featured
            ? ' <span class="featured-badge fa-sharp fa-solid fa-star" role="img" aria-label="Featured"></span>'
            : ''
        let withHtml = ''
        if (featuredWith) {
          const secondaries = featuredWithMap[item.url]
          if (secondaries && secondaries.length > 0) {
            const parts = secondaries.map(
              (w) => `<a href="${w.url}">${escHtml(w.title)}</a>`
            )
            withHtml = ` <small>(and ${parts.join(', ')})</small>`
          }
        }
        html += `  <li><a href="${item.url}">${escHtml(item.title)}</a>${starHtml}${withHtml}</li>\n`
      }
    }
    return `${html}</ul>`
  }

  const indexPages = [
    // The category index is always there, for the site links to it
    ...[...new Set([...listedNamespaces, 'category'])].map((ns) => ({
      slug: ns,
      title: `All ${ns} pages`,
      items: indexByNs[ns],
      menuNs: ns,
      menu: ns
    })),
    { slug: 'featured', title: 'Featured pages', items: featuredPages, featuredWith: true, menu: 'featured' },
    { slug: 'drafts', title: 'Drafts', items: draftPages }
  ]

  for (const indexPage of indexPages) {
    let html = ''
    if (indexPage.menu) html += indexMenuHtml(indexPage.menu, listedNamespaces)
    if (indexPage.menuNs === 'category') {
      // Both lists are in the page; the style sheet shows one, and the switch decides which
      html += `${CATEGORY_SHOWN_SCRIPT}
<section class="category-tree">
<h2 class="visually-hidden">Nested</h2>
${treeHtml(topLevelCategories)}
</section>
<section class="category-alphabetical">
<h2 class="visually-hidden">Alphabetical</h2>
${listHtml(indexPage.items, { stars: true, entries: true })}
</section>
<p class="index-toggle"><label><input type="checkbox" role="switch" id="list-alphabetically"> List alphabetically</label></p>
${CATEGORY_SWITCH_SCRIPT}`
    } else {
      html += listHtml(indexPage.items, { stars: !!indexPage.menuNs, featuredWith: indexPage.featuredWith, entries: !!indexPage.menuNs })
    }

    const page = renderLayout(html, {
      url: `/index/${indexPage.slug}`,
      nsLabel: 'Index page',
      frontmatter: { title: indexPage.title, permalink: indexPage.slug }
    })

    await output.emit(`/index/${indexPage.slug}`, page)
    info(`Built (index): /index/${indexPage.slug}`)
  }

  // The old addresses: /index/alphabetical sent visitors to the Topic index, and each namespace's list
  // and the categorical index have moved
  const moved = [
    ['/index/alphabetical', '/index/topic', 'topic index'],
    ['/index/categorical', '/index/category', 'category index'],
    ...listedNamespaces.map((ns) => [`/index/alphabetical/${ns}`, `/index/${ns}`, `${ns} index`])
  ]
  for (const [fromUrl, toUrl, what] of moved) {
    await output.emit(fromUrl, redirectStub(toUrl, what))
    info(`Built (index): ${fromUrl} -> ${toUrl}`)
  }
}
