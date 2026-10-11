import { BuildError } from '../errors.js'

// ─── Page descriptions ───
// The meta description of a content page: its first paragraph with any text,
// as plain text trimmed to a whole word. Returns "" when there is none.
const MAX_LENGTH = 160

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }

export function describe (html) {
  for (const [, inner] of html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)) {
    const text = inner
      .replace(/<sup class="footnote-ref">[\s\S]*?<\/sup>/g, '') // "[1]" markers
      .replace(/<[^>]*>/g, '')
      .replace(/&(amp|lt|gt|quot|#39);/g, (m, name) => ENTITIES[name])
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue // an image-only paragraph, say
    if (text.length <= MAX_LENGTH) return text
    const cut = text.slice(0, MAX_LENGTH + 1).replace(/\s+\S*$/, '')
    return cut.replace(/[\s,;:.\-–—]+$/, '') + '…'
  }
  return ''
}

// ─── Hero images ───
// A page's hero is the image embed that opens its body (`![[Town.png|300x137]]`).
// Returns { url, wide } or null; `wide` is false for a square-ish image such as
// the home page's avatar, which gets the small share card.
export function findHero (markdown, imageMap) {
  const m = markdown.match(/^\s*!\[\[([^\]|]+)(?:\|(\d+)x(\d+))?[^\]]*\]\]/)
  if (!m) return null
  const url = imageMap[m[1].trim().toLowerCase()]
  if (!url) return null
  return { url, wide: !m[2] || m[2] / m[3] > 1.5 }
}

// The share image of every page without a hero of its own, plus the home page
// and notes pages. A missing file fails the build rather than dropping the image.
const FALLBACK_HERO = 'trees-and-buildings.png'

export function fallbackHero (imageMap) {
  const url = imageMap[FALLBACK_HERO]
  if (!url) {
    throw new BuildError('The fallback share image image/Trees-and-buildings.png is missing')
  }
  return { url, wide: true }
}
