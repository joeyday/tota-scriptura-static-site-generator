import slugify from 'slugify'
import { escHtml } from './escape.js'
import { mapText, walkHtml } from './walk.js'

// Pure HTML → HTML post-passes. Each takes a whole page's HTML and returns it
// rewritten. Passes that touch text use mapText and leave tags alone.

// Text inside these tags is left alone by the abbreviation, initials, Roman
// numeral and divine-name passes. (An inline SVG's text can't hold a <span>; a diagram
// writes its own <tspan class="divine-name">.)
const WRAP_SKIP_TAGS = new Set(['abbr', 'code', 'pre', 'script', 'style', 'svg'])

// A web address in running text (a bare link's display text is its own address). The
// text passes leave these alone: a "VH" or "QA" in a path isn't an abbreviation.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"]+)/g

// mapText for the text passes: fn sees only the stretches of text outside tags in
// WRAP_SKIP_TAGS and outside web addresses.
function mapProse (html, fn) {
  return mapText(html, WRAP_SKIP_TAGS, (text) =>
    // split with a capture group: the odd pieces are the addresses
    text.split(URL_RE).map((piece, i) => i % 2 === 1 ? piece : fn(piece)).join('')
  )
}

// Builds the one regex that matches any abbreviation (case-sensitive), longest
// first to prevent prefix collisions. Null if there are none.
//   - If a key ends with a word character, use \b on both sides
//   - If it ends with punctuation (e.g. "e.g."), use \b on the left only
function abbreviationRegex (abbrMap) {
  const sorted = Object.keys(abbrMap).sort((a, b) => b.length - a.length)
  if (sorted.length === 0) return null
  const parts = sorted.map((abbr) => {
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const lastChar = abbr[abbr.length - 1]
    const rightBoundary = /\w/.test(lastChar) ? '\\b' : ''
    return `\\b${escaped}${rightBoundary}`
  })
  return new RegExp(`(${parts.join('|')})`, 'g')
}

// Returns a function that wraps abbreviations in a page's HTML. The regex is
// built once, not once per page.
export function makeAbbreviationWrapper (abbrMap) {
  const combinedRe = abbreviationRegex(abbrMap)

  return (html) =>
    mapProse(html, (text) =>
      text.replace(combinedRe, (match) => {
        return `<abbr title="${escHtml(abbrMap[match])}">${match}</abbr>`
      })
    )
}

// Adds or replaces the alt attribute on any <img> whose src basename matches
// a key in altMap.  Matching is case-sensitive and against the filename only
// (no directory path, no query string).  Values are HTML-escaped.  An image with
// no entry is pushed to `problems`: it fails the build.
export function applyAltText (html, altMap, problems) {
  return html.replace(/<img\s[^>]*>/g, (tag) => {
    const srcMatch = tag.match(/\bsrc=(["'])([^"']+)\1/)
    if (!srcMatch) {
      problems.push(`an image with no src: ${tag}`)
      return tag
    }

    const src = srcMatch[2]
    // Strip any query/hash, then take the last path segment
    const basename = src.split('/').pop().split(/[?#]/)[0]
    if (!Object.prototype.hasOwnProperty.call(altMap, basename)) {
      problems.push(`image ${basename} has no entry in alt-text.json`)
      return tag
    }

    const altText = escHtml(altMap[basename])

    if (/\balt=/.test(tag)) {
      // Replace existing alt value (handles both quote styles)
      return tag.replace(/\balt=(["'])[^"']*\1/, () => `alt="${altText}"`)
    }
    // Insert alt before the closing > or />
    return tag.replace(/(\s?\/?>)$/, (end) => ` alt="${altText}"${end}`)
  })
}

// ─── Initials Wrapping ────────────────────────────────────────────────────────

// Matches two or more consecutive "UppercaseLetter + period" groups, e.g.
// "D.A.", "R.C.", "J.R.R.", "U.S.A."  Single-letter abbreviations like "Dr."
// are intentionally excluded (they require two or more such groups).
const INITIALS_RE = /\b([A-Z]\.){2,}/g

// The surname beside the initials: "Sproul, " just before them, or " Sproul" just after.
const SURNAME_BEFORE_RE = /([A-Z][\p{L}-]*),\s*$/u
const SURNAME_AFTER_RE = /^\s+([A-Z][\p{L}-]*)/u

// Wraps initials in <abbr>, titled with the expansion that initials.json gives the
// person: the key is the initials and the surname, "R.C. Sproul", found whether the
// name reads "R.C. Sproul" or "Sproul, R.C." Initials with no entry (or no surname beside
// them) are pushed to `problems` and left plain: they fail the build.
export function wrapInitials (html, initialsMap, problems) {
  return mapProse(html, (text) =>
    text.replace(INITIALS_RE, (match, _group, offset) => {
      const before = SURNAME_BEFORE_RE.exec(text.slice(0, offset))?.[1]
      const after = SURNAME_AFTER_RE.exec(text.slice(offset + match.length))?.[1]
      // A name before the initials ("Carson, D.A. The Difficult…") beats one after them.
      const keys = [before, after].filter(Boolean).map((surname) => `${match} ${surname}`)
      const key = keys.find((k) => typeof initialsMap[k] === 'string')
      if (key) return `<abbr title="${escHtml(initialsMap[key])}">${match}</abbr>`
      problems.push(keys.length > 0
        ? `initials "${match}" need an entry in initials.json: ${keys.map((k) => `"${k}"`).join(' or ')}`
        : `initials "${match}" have no surname beside them to look up in initials.json (write "${match} Surname" or "Surname, ${match}")`)
      return match
    })
  )
}

// ─── End Initials Wrapping ────────────────────────────────────────────────────

// ─── Spaced Ellipsis Normalisation ───────────────────────────────────────────

// Converts spaced ellipses (". . ." with any whitespace, including U+00A0) to
// the typographically correct form with non-breaking spaces as HTML entities.
// The longer pattern (leading space) is applied first so it is not partially
// consumed by the shorter one.
export function fixSpacedEllipses (html) {
  return html
    .replace(/\s\.\s\.\s\./g, '&nbsp;.&nbsp;.&nbsp;.')
    .replace(/\.\s\.\s\./g, '.&nbsp;.&nbsp;.')
}

// ─── End Spaced Ellipsis Normalisation ───────────────────────────────────────

// ─── Roman Numeral Wrapping ───────────────────────────────────────────────────

// Matches strictly valid Roman numerals (1–3999), uppercase only.
// Two branches:
//   1. Dotted pair ROMAN.ROMAN — each half ≥ 1 char (e.g. X.III, I.I, XIV.II)
//   2. Standalone — ≥ 2 chars (lookahead (?=[MDCLXVI]{2}) excludes bare I, V, X, etc.)
// Dotted branch is listed first so it wins the longer match.
// The match.length >= 2 guard in the replacement callback is a safety net against
// empty matches that the all-optional structural pattern can produce at word boundaries.
const ROMAN_RE_SRC =
  'M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})'
const ROMAN_NUM_RE = new RegExp(
  `\\b(?=[MDCLXVI])${ROMAN_RE_SRC}\\.(?=[MDCLXVI])${ROMAN_RE_SRC}\\b` +
    `|\\b(?=[MDCLXVI]{2})${ROMAN_RE_SRC}\\b`,
  'g'
)

export function wrapRomanNumerals (html) {
  return mapProse(html, (text) =>
    text.replace(ROMAN_NUM_RE, (match) =>
      match.length >= 2 ? `<span class="roman-num">${match}</span>` : match
    )
  )
}

// ─── End Roman Numeral Wrapping ───────────────────────────────────────────────

// ─── Divine Name Wrapping ─────────────────────────────────────────────────────
// LORD, GOD, YHWH, I AM, etc. (all-caps) →
//   <span class="divine-name">
//     <span class="divine-name-initial">L</span>ORD
//   </span>
// First letter wrapped in .divine-name-initial so it can be styled independently
// of the remaining small-capped letters (::first-letter only works on block elements).

const DIVINE_NAME_RE =
  /\b(LORD|GOD|YHWH|I AM( THAT I AM| WHAT I AM| WHO I AM)?|I WILL BE( THAT I WILL BE| WHAT I WILL BE| WHO I WILL BE)?)\b/g

export function wrapDivineNames (html) {
  return mapProse(html, (text) =>
    text.replace(DIVINE_NAME_RE, (match) => {
      const newMatch = match.replace(
        /\b(G|L|I\b)/g,
        '<span class="divine-name-initial">$1</span>'
      )
      return `<span class="divine-name">${newMatch}</span>`
    })
  )
}

// ─── End Divine Name Wrapping ─────────────────────────────────────────────────

// ─── Small Asides ─────────────────────────────────────────────────────────────
// In a term (<dt>) or a definition (<dd>), a parenthetical is small text, and in a definition
// an em dash starts italic, small text, as if they were written ~(like this)~ and
// *~— like this~*. The outermost pair of parentheses is wrapped in <small>, across links and the
// like when both sit in the same element, unless it is part of a word ("Son(s)"). An em dash
// starts an <em> and a <small> that run to the end of the element holding it (the <dd>, or its
// paragraph). Only the first dash in an element counts; the rest are inside the aside. Nothing
// is wrapped twice with the same extent: a pair of parentheses that has exactly the extent of
// an existing <small> is skipped, and so is a dash's <em> when the dash is in one already, and
// its <small> when it is in one. A smaller <small> inside a bigger one is wanted, so
// parentheses inside one get their own. Left alone: a dash inside parentheses, a dash with
// nothing after it (an empty definition's placeholder), a term or definition that is one pair of
// parentheses from start to end, web addresses and code. Run on pages whose terms and
// definitions are prose, not commentary.

const VOID_TAGS = new Set(['br', 'hr', 'img', 'wbr'])

export function smallAsides (html) {
  if (!html.includes('<dd') && !html.includes('<dt')) return html
  const parts = []
  let at = 0
  walkHtml(html, WRAP_SKIP_TAGS, {
    onText: (s, skipped) => { parts.push({ s, skipped, at }); at += s.length },
    onTag: (name, s) => { parts.push({ s, name, at }); at += s.length }
  })

  const inserts = [] // [offset, markup, closing, the other end of the element, order]
  let stack = null // the elements open inside the <dd>: { name, start, end, dash }
  let found = [] // the <dd>'s candidates: { dash, start, end, parent, inEm, inSmall }
  let parens = [] // the "(" not yet closed
  const wrap = (tag, start, end) => {
    inserts.push([start, `<${tag}>`, false, end, inserts.length], [end, `</${tag}>`, true, start, inserts.length + 1])
  }
  const finish = () => {
    const pairs = found.filter((c) => !c.dash)
    for (const c of found) {
      if (!c.dash) {
        // all there is in the term or definition
        if (c.parent === c.root && !html.slice(c.root.start, c.start).trim() && !html.slice(c.end, c.root.end).trim()) continue
        // the same extent as the <small> it is in
        if (c.parent.name === 'small' && c.start === c.parent.start && c.end === c.parent.end) continue
        wrap('small', c.start, c.end)
        continue
      }
      const end = c.parent.end
      const inPair = pairs.some((p) => p.start < c.start && c.start < p.end)
      if (inPair || html.slice(c.start + 1, end).replace(/<[^>]*>|\s/g, '') === '') continue
      if (!c.inEm) wrap('em', c.start, end)
      if (!c.inSmall) wrap('small', c.start, end)
    }
  }
  for (const part of parts) {
    if (part.name !== undefined) {
      if (!part.name) continue // a comment
      const closing = part.s.startsWith('</')
      if (stack === null) {
        if ((part.name === 'dd' || part.name === 'dt') && !closing) {
          stack = [{ name: part.name, start: part.at + part.s.length }]
          found = []
          parens = []
        }
        continue
      }
      if (closing) {
        const i = stack.map((e) => e.name).lastIndexOf(part.name)
        if (i === -1) continue
        for (const e of stack.splice(i)) e.end = part.at
        if (i === 0) {
          finish()
          stack = null
        }
      } else if (!VOID_TAGS.has(part.name) && !part.s.endsWith('/>')) {
        stack.push({ name: part.name, start: part.at + part.s.length })
      }
      continue
    }
    if (stack === null || part.skipped) continue
    const urls = [...part.s.matchAll(URL_RE)].map((m) => [m.index, m.index + m[0].length])
    const parent = stack[stack.length - 1]
    for (const m of part.s.matchAll(/[()\u2014]/g)) {
      if (urls.some(([from, to]) => m.index >= from && m.index < to)) continue
      const here = part.at + m.index
      if (m[0] === '(') {
        // "Son(s)" is a word, not an aside
        parens.push({ at: here, parent, attached: /[\p{L}\p{N}]/u.test(part.s[m.index - 1] ?? '') })
      } else if (m[0] === ')') {
        const start = parens.pop()
        const attached = /[\p{L}\p{N}]/u.test(part.s[m.index + 1] ?? '')
        if (start && parens.length === 0 && start.parent === parent && !start.attached && !attached) {
          found.push({ dash: false, start: start.at, end: here + 1, parent, root: stack[0] })
        }
      } else if (stack[0].name === 'dd' && !stack.some((e) => e.dash)) {
        parent.dash = true
        found.push({
          dash: true,
          start: here,
          parent,
          inEm: stack.some((e) => e.name === 'em'),
          inSmall: stack.some((e) => e.name === 'small')
        })
      }
    }
  }
  if (inserts.length === 0) return html

  // At one offset the ends come before the starts, the inner element's end first and the
  // outer element's start first (two of the same extent: the one wrapped first is the outer):
  // "(a)(b)" is two smalls, and "— (a)" ends two at once.
  inserts.sort((x, y) => x[0] - y[0] || y[2] - x[2] || y[3] - x[3] || (x[2] ? y[4] - x[4] : x[4] - y[4]))
  let out = ''
  let from = 0
  for (const [offset, markup] of inserts) {
    out += html.slice(from, offset) + markup
    from = offset
  }
  return out + html.slice(from)
}

// ─── End Small Asides ─────────────────────────────────────────────────────────

// ─── Unknown Abbreviations ────────────────────────────────────────────────────

// Two or more capitals, then more capitals or digits: "NASA", "UBS5". Dotted forms
// ("A.5") are not looked for.
const ALL_CAPS_RE = /\b[A-Z]{2,}[A-Z0-9]*\b/g
// A "!" in front of one opts it out of the check, as it does for a Scripture reference.
// (?<![\w<]) keeps "Wow!NASA" from counting, and the "<!DOCTYPE" the walker sees as text.
const OPT_OUT_RE = /(?<![\w<])!([A-Z]{2,}[A-Z0-9]*)\b/g
const ROMAN_WHOLE_RE = new RegExp(`^(?=[MDCLXVI])${ROMAN_RE_SRC}$`)

// Returns a function that lists the all-caps words in a page's text that nothing
// explains: not covered by a key of abbreviations.json (a key like "JS–H" covers its "JS"),
// not a Roman numeral, not a divine name. Same skip list as the passes, which means it
// runs before they wrap anything.
export function makeUnknownAbbreviationFinder (abbrMap) {
  const knownRe = abbreviationRegex(abbrMap)
  return (html) => {
    const unknown = new Set()
    walkHtml(html.replace(/^<!DOCTYPE[^>]*>/i, ''), WRAP_SKIP_TAGS, {
      onText: (text, skipped) => {
        if (skipped) return
        let rest = text.replace(URL_RE, ' ').replace(DIVINE_NAME_RE, ' ').replace(OPT_OUT_RE, ' ')
        if (knownRe) rest = rest.replace(knownRe, ' ')
        for (const [word] of rest.matchAll(ALL_CAPS_RE)) {
          if (!ROMAN_WHOLE_RE.test(word)) unknown.add(word)
        }
      },
      onTag: () => {}
    })
    return [...unknown]
  }
}

// Drops the "!" of each opt-out, once the check has seen it. Runs before the wrapping
// passes, which then treat the word like any other.
export function stripOptOuts (html) {
  return mapProse(html, (text) => text.replace(OPT_OUT_RE, '$1'))
}

// ─── End Unknown Abbreviations ────────────────────────────────────────────────

// ─── Heading ID Injection ─────────────────────────────────────────────────────
// Adds id attributes to <h2> and <h3> elements that don't already have one, and to the <dt>
// terms of a page whose terms are its headings (`terms`: a topic page's h3-and-paragraph
// pairs are terms and definitions; a commentary page's terms are not headings).
// IDs are generated by slugifying the element's plain-text content. A heading or term named
// like the one just before it (an h2 and the term under it that repeats its title) gets no id,
// so a link to that name goes to the first. The same name anywhere else on the page is a
// problem (a link couldn't tell the two apart), which the caller turns into a build failure.
// Runs as the first post-processing step so all downstream passes and the
// future Scripture index can rely on the IDs being present.

// Alternation order matters: comments, CDATA, script blocks, and style blocks are matched and
// consumed first so we never accidentally process heading-like text that appears inside those
// contexts.
// Group 1 = full heading element, group 2 = tag name (h2|h3, or dt),
// group 3 = attribute string (may be empty).
// Backreference \2 ties the closing tag to the opening tag (h2↔h2, h3↔h3).
const HEADING_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|(<(h[23])(\s[^>]*)?>[\s\S]*?<\/\2>)/gi
const TERM_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|(<(h[23]|dt)(\s[^>]*)?>[\s\S]*?<\/\2>)/gi

// The plain text of a heading's HTML and its slug. The text is still HTML, so the entities
// markdown-it escapes are decoded ("&amp;" would otherwise slugify to "andamp"); &amp; goes
// last. An empty or symbol-only heading is "section".
export function headingSlug (html) {
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
  return { text, base: slugify(text, { lower: true, strict: true }) || 'section' }
}

export function addHeadingIds (html, terms = false, problems = []) {
  const usedIds = new Set()
  const H_RE = terms ? TERM_RE : HEADING_RE

  // First pass: pre-reserve all IDs that already exist on h2/h3 elements.
  // This prevents generated IDs from colliding with explicit IDs that appear
  // later in the document, regardless of source order.
  let m
  H_RE.lastIndex = 0
  while ((m = H_RE.exec(html)) !== null) {
    if (!m[2]) continue // comment / CDATA / script / style — skip
    const attrs = m[3] || ''
    if (/\bid\s*=/.test(attrs)) {
      const existing = attrs.match(/\bid\s*=\s*["']?([^"'\s>]+)["']?/)
      if (existing) usedIds.add(existing[1])
    }
  }

  // Second pass: generate and inject IDs for headings that lack one. `previous` is the id of
  // the heading before this one (null for a repeat that took none).
  let previous = null
  H_RE.lastIndex = 0
  return html.replace(H_RE, (match, fullHeading, tag, attrs) => {
    if (!tag) return match // comment / CDATA / script / style — preserve

    attrs = attrs || ''
    // Already has an id — preserve it exactly as written
    if (/\bid\s*=/.test(attrs)) {
      previous = attrs.match(/\bid\s*=\s*["']?([^"'\s>]+)["']?/)?.[1] ?? null
      return match
    }

    const { text, base } = headingSlug(fullHeading)

    // A repeat of the name just above takes no id; anywhere else it is a problem.
    if (usedIds.has(base)) {
      if (previous !== base) problems.push(`"${text}" (#${base}) names two headings or terms that aren't next to each other`)
      return match
    }
    usedIds.add(base)
    previous = base

    // Inject id into the opening tag
    return fullHeading.replace(
      new RegExp(`^<${tag}(\\s[^>]*)?>`, 'i'),
      (_, a) => `<${tag}${a || ''} id="${base}">`
    )
  })
}

// ─── End Heading ID Injection ─────────────────────────────────────────────────

// ─── Table of Contents ────────────────────────────────────────────────────────
// A list of the article's h2 headings (each links to its id, so this runs after the
// heading IDs), put in front of the first of them: after any introduction, before the
// first section. The h3s are left out. A page with fewer than three h2s gets none. The
// title ("Contents" on a notes page, "Outline" on a commentary page) is a <p>, not a heading, so the Scripture collector doesn't take it for a section.

const TOC_MIN = 3

export function addTableOfContents (html, title) {
  const start = html.indexOf('<article')
  const end = html.indexOf('</article>', start)
  if (start === -1 || end === -1) return html

  const items = []
  const H2_RE = /<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/gi
  const article = html.slice(start, end)
  let first = -1
  let m
  while ((m = H2_RE.exec(article)) !== null) {
    const id = /\bid\s*=\s*["']([^"']+)["']/.exec(m[1] || '')?.[1]
    // The text is already escaped HTML, so it goes back in as it is.
    const text = m[2].replace(/<[^>]*>/g, '').trim()
    if (!id || !text) continue
    if (first === -1) first = m.index
    items.push(`<li><a class="internal" href="#${id}">${text}</a></li>`)
  }
  if (items.length < TOC_MIN) return html

  const toc = `<nav class="toc" aria-label="Table of contents">\n<p class="toc-title">${title}</p>\n<ul>\n${items.join('\n')}\n</ul>\n</nav>\n`
  const at = start + first
  return html.slice(0, at) + toc + html.slice(at)
}

// ─── End Table of Contents ────────────────────────────────────────────────────
