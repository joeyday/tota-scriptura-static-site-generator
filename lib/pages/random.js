// Namespaces whose pages never come up at random.
import { info } from '../log.js'

const EXCLUDED_NAMESPACES = new Set(['category', 'meta', 'reference'])

// /random picks a random content page on the client and redirects to it.
export async function writeRandom ({
  output,
  renderLayout,
  listedNamespaces,
  alphabeticalByNs
}) {
  const randomUrls = listedNamespaces
    .filter((ns) => !EXCLUDED_NAMESPACES.has(ns))
    .flatMap((ns) => alphabeticalByNs[ns])
    .filter((item) => item.url) // exclude alias redirect stubs
    .map((item) => item.url)
  const randomContent = `<script>
  (function() {
    var pages = ${JSON.stringify(randomUrls)};
    if (!pages.length) { return; }
    window.location.replace(pages[Math.floor(Math.random() * pages.length)]);
  })();
  </script>
  <div class="callout"><p><em>The lot is cast into the lap, but its every decision is from the LORD.<br><small>—Proverbs 16:33</small></em></p></div>
  <noscript><div class="callout"><p>JavaScript is required for this feature. <a href="/index/alphabetical/topic">Browse the index</a> instead.</p></div></noscript>`
  const randomHtml = renderLayout(randomContent, {
    url: '/random',
    frontmatter: { title: 'Random page', permalink: 'random' }
  })
  await output.emit('/random', randomHtml)
  info(`Built: /random (${randomUrls.length} page(s))`)
}
