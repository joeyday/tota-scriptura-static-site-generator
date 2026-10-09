# Decisions

Settled questions, so they aren't re-litigated. Each says who decided and when. If circumstances change, change the entry rather than adding a contradicting one. What was *built* is in `release-notes.md`; what is *open* is in `plan.md`.

## Scope
- **tsgen serves exactly one site** (and perhaps one very similar second). Hardcode folder roles, file names and frontmatter keys; no options, config or plugin hooks. Remove abstractions rather than adding them. (Joey, 2026-10-01)
- **Build speed is a first-class goal**: no extra pass over the corpus without a reason. Incremental builds were considered and rejected (2026-10-07): the full build takes about half a second, and a page's HTML depends on the whole link graph and every listing, so invalidation would risk stale output.
- **Expanding partials and resolving wikilinks twice per page** (once in the backlinks pre-pass, once to render) stays: the pre-pass must run before any page renders, because placeholders for hidden pages and the `planned` link class depend on every page's links. The duplicate work is about 1.3 ms of 0.5 s. (2026-10-07)
- **Failures are loud.** A content mistake fails the build; it doesn't warn. (Joey)

## Content model
- **`permalink` stays**, even for the home page: it lets Joey rename the home page. The home page is not hardcoded. (Joey, 2026-10-08)
- **A notes page with no topic page is a feature**: it builds, with a greyed Topic tab and no warning. (Joey, 2026-10-08)
- **`hidden` means "no page", except a placeholder** when a published page links to it. This is correct as it is. (Joey, 2026-10-08)
- **Old `/notes/…` URLs are not redirected**, on purpose (v0.2.0).
- **`meta` pages are in the Scripture index** even though they are out of the random pool; `category`, `reference` and notes pages are out of the index. (Joey, 2026-10-05)
- **Image links:** the canonical form is the real path, `image/<file>` (or `template/<file>`), because that is what Obsidian's link picker inserts. A bare `<file>` also works; it is always unique because two assets with the same name fail the build (names are flat in `dist/asset/`). An image in any other folder, or that doesn't exist, fails the build. (Joey, 2026-10-08)
- **Partial arguments stay.** They are in real use.
- **Stricter Scripture checks (failing the build on an impossible reference) are not wanted** for now: one documented mistake in 22,901 auto-links. False positives are handled with the `!` opt-out, so no heuristics. (Joey, 2026-10-08)
- **Numbered-book abbreviations are written without a space** (`1Jn`, `2Ki`, `1Ti`). A spaced form (`1 Jn 2:2`, `2 Ki 5`, `1 Tim 3:3`) is a mistake in the content and simply doesn't link; no aliases or special cases for it. The full names (`1 John`) take the space. (Joey, 2026-10-08)
- **Roman numerals:** Joey expects them only for the WCF and the Institutes. If an all-caps word ever collides (`MD`, `DC`, `MIX`…), the cheap fix is to stop the numeral range at 99 or add a deny list. The corpus has no collision today (audited 2026-10-07), and a term in `abbreviations.json` already wins.
- **Hidden `<h2>`s before the two navs stay** (Joey, 2026-10-06): the markup should make sense without CSS (CSS Naked Day), and a hidden heading is visible there while an `aria-label` is not.

## Statistics
- **`/statistics` is a generated page in the `meta` namespace**, the first one there: listed in `/index/alphabetical/meta`, linked from the sidebar, and kept out of search, the random pool and the Scripture index. (Joey, 2026-10-08)
- **Deterministic output.** No dates, no timings: the page shows the tsgen version and the content commit and is otherwise a function of the content, so builds still compare byte-for-byte.
- **What it counts.** Listed pages and their notes; hidden and unlisted pages are out. Scripture figures leave out reference pages and categories, whose long citation tables would swamp everything else. Notes pages are counted (most of the Scripture work is in them), though they stay out of the Scripture index.
- **A verse is covered when a citation includes it** (a whole-chapter citation covers every verse in it) and **named** only when cited as a verse. Versification is the Protestant numbering (1,189 chapters, 31,102 verses), from a public-domain KJV text checked against every book's known verse total; the ESV follows it.
- **Cost, measured 2026-10-08:** about 28 ms on a 500 ms build (+5.6%): roughly 9 ms for words (tokenizing and ranking), 7 ms for the Scripture coverage, 4.5 ms to render and emit the page, and the rest per-page bookkeeping. If it ever needs trimming, the most used words and the Greek, Hebrew and punctuation counts are the cheapest things to drop for the least loss.

## Template and CSS
- **The mobile footer's "· Colophon" middot is intentional**: it sets Colophon apart from the copyright. (2026-10-07)
- **`img { width: 100% }` stays**: no image in the vault is smaller than the column (the narrowest is 540px against a column of at most about 438px), and the home-page avatar is sized by its figure. (2026-10-07)
- **Every hue token in `:root` stays, used or not**, so they are ready to use. (Joey, 2026-10-07)
- **Head whitespace is not minified**; gzip hides it. (2026-10-07)
- **No SVG icon and no web manifest.** The feather is a Font Awesome Pro glyph (the licence bans standalone SVG copies in the repo), and a manifest would need a new 512px render, only worth it if the site should be installable on Android. Only rasterized PNGs live in `template/favicon/`. Text fonts come from Typekit, so there are no font files.
- **`theme-color` is always the nav gray** (`#585858` light, `#484848` dark), so Safari's chrome matches the sidebar at every width. (Joey, 2026-10-08) A thin light line at the top of the phone layout in Safari persists; the page itself has none, so it is presumed to be Safari's own chrome and is not ours to fix.
- **The only `!important`s** are the `.visually-hidden` utility and the print stylesheet's plain-text links, on purpose.
- **Known limitation:** the Font Awesome kit is a deferred script, so icons appear a moment after the page paints, and with JavaScript off the logo, search icon, star and the rest are absent (the search button is then an empty circle with its label).

## The archive
- **`archive/` (the Replit Agent docs) is kept indefinitely** for understanding why a feature was built the way it was. Never propose deleting it. They drift from the code; see `archive/README.md`. (Joey, 2026-10-08)
