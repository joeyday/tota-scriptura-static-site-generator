# Plan

Open work only: bugs to fix and features to build. When something is finished, delete it here; `release-notes.md` records what shipped and when, and `decisions.md` records the questions that are settled. Verify an item against the code before acting on it, since it may have gone stale.

## Bugs and quirks

- **Bible-ref false positives.** A capitalised word before a number still links: "Job 2 years ago" links to Job 2 and lands in the Scripture index. The `!` opt-out is the workaround.
- **`[[Page#Heading]]` is unsupported** and renders as broken. The vault has no such link.
- **Colors beyond sRGB.** Several hues still exceed sRGB at chroma 0.16 and rely on the browser's gamut mapping. Check by setting the Mac's display profile to sRGB.
- **Joey's to do:**
  - Typekit's CSS declares `font-display: auto`, often invisible text for up to three seconds. Check the Adobe Fonts project's settings for a `swap` option; it can't be changed from tsgen.
  - `404.md` still has `unlisted: true`; the generator now forces it, so the line can go.
  - `/statistics` lists the citations that point past the end of their chapter (19 on 2026-10-08, such as a `1Ch` meant as `2Ch`, or `Isaiah 16:40`): probably typos in the notes.

## Accessibility and standards (each needs a decision from Joey)

- **Links are underlined only on hover.** Colour alone is about 3:1 against body text, weakest in dark mode. Options: underline in running prose, or keep the bare style and accept the borderline WCAG 1.4.1 result.
- **Root font size is viewport-derived** (`html { font-size: clamp(0px, …, 22px) }`). It ignores the user's default font size, and at 200% browser zoom text grows only about 1.65×. A deliberate design, so it's a tradeoff; a percentage base plus a `vw` term would respect the preference. Also, `clamp(0px, x, 22px)` is just `min(x, 22px)`, and `-webkit-text-size-adjust: none` should be `100%`.
- **`abbr { text-decoration: none }`** hides the only cue that a `title` exists, and `title` doesn't work on touch. Audited 2026-10-08 against the current vault: 748 titled `<abbr>`s on 125 pages (51 distinct terms; NT, LXX, OT and UTC lead), all from the 112 entries in `abbreviations.json` (none is null-valued), so every one has a title that touch users can't reach. A further 19 `<abbr>`s on 10 pages have no title at all; they are not from `abbreviations.json` but from the initials pass (`D.A.`, `R.C.`, `J.I.`…), which uses `<abbr>` purely as a styling hook, so a span class would be more honest. Decide: keep the plain look, or add a visible cue (dotted underline) for titled ones; and move the initials to a span.
- **Tables:** add captions (9 pages have an authored one; there is no syntax for it yet), and look at `th { width: 20% }`, which applies per cell. Tables scroll sideways in a `.table-scroll` wrapper that is not keyboard-focusable, to avoid dozens of tab stops on the citation pages.
- **CSS Naked:** the deferred module script flashes styled content before it strips it; fixing that means a blocking script in the head.
- **Heading levels skip on 101 pages** (h1 → h3). It is authored content, since h3 carries the small-caps look. Decide whether to fix it in content or style by class.
- **Visual order differs from DOM order on desktop** (header and sidebar sit right of `main` but come first in the DOM). Probably acceptable.

## Features

**For Joey to build**
- **Stylesheet tweaks:** the search button's border color is hardcoded; think about the Search page's style.
- **`disambiguation` property.** Special handling, probably in the template only. Nothing in `lib/` or `layout.ejs` reads it; the vault has one use (`topic/Sacrament.md`).
- **Social media links** in the sidebar or footer. The Mastodon and Facebook icons are used in `Home page.md`; the layout has none.

**With Claude**
- **Table of contents**, maybe only on notes pages. It could double as the full book outline on commentary pages.
- **Deterministic hero assignment from a larger pool**, for `og:image` and perhaps the page's visible hero. It would replace the single fallback image. Assign deterministically (for example a hash of the page path) so a page's card doesn't change between builds. Open: where the pool lives, and whether every page should show a hero or only some (Joey is undecided; don't build the visible part until he decides).
- **`aliases` parity with Obsidian.** Understand how Obsidian uses `aliases` and match it. Obsidian disallows wikilinks in `aliases`; tsgen optionally allows them. tsgen assumes all aliases sit in the same folder as the page; check whether Obsidian thinks about it that way or more subtly.
- **Aliases that cross namespaces** (eventually, not urgent). Today an alias redirects only inside its page's own folder (`/{relDir}/{alias}`). It would let the old root URLs `/otnt` and `/ntot`, which now 404, redirect to `/reference/…`. No design yet: the frontmatter syntax, how the alphabetical index and wikilinks treat such an alias (which namespace lists it?), and collisions with real pages there.
- **More statistics, if wanted:** the page is built (see `docs/decisions.md` for what it counts). Candidates not built: external links by domain, footnotes per page, abbreviation and Roman numeral counts (each needs its pass to return a count), build-over-build trends (needs history, and breaks deterministic output), and an "as of" date.
- **Implicit small text for parentheticals.** `~text~` makes small text, and typing `<small>` is a non-starter. On 2026-10-02, content pages had 502 parentheticals already wrapped in `~…~` and 101 bare ones (notes pages are mostly bare, 994 vs 146, so the rule would apply to content pages only). The bare ones are a mix, so the rule would need an opt-out.
- **Whether `unlisted` should survive at all.** It would cover only `404`, `Sandbox` and the auto-unlisted empty categories.

**Crazypants future**
- **Static book generator.**

## Code

- **An automated test suite.** The repo has none; what guards it today is `scripts/compare-dist.mjs` against a baseline build, plus differential and fuzz checks run by hand. Use Node's built-in runner (`node --test`, no new dependency) with an `npm test` script, and put in the repo the checks that have paid for themselves:
  - the Bible-reference scanner: continuations (`John 3:16, 18`), chapter-level continuations (`Romans 3, 5`, `Romans 3–5, 7`), numbered-book spacing (`1Jn 2:2` links, `1 Jn 2:2` doesn't), the digit-after-year case, single-chapter books, `!` opt-outs, translations (`Jn 3:16; 5:24 KJV`), and that the linker and the collector agree on every reference
  - link resolution (bare names narrowing to the source's folder, then `topic/`, then the root; qualified paths) and image links (`image/<file>`, bare names, failures)
  - the checks that fail a build (a collision, bad frontmatter, a broken wikilink), each against a tiny scratch vault
  - the statistics: the verse table totals 31,102 verses and matches every book's known total, and coverage numbers come out right on a small hand-made set of references
  - a differential/fuzz harness for the Bible code, kept out of the default run but available when that code changes

  Wanted before a 1.0.
- **Dependency updates.** Checked 2026-10-08, `npm audit` is clean. Three are a major version behind: `ejs` 4.0.1 → 7.0.1, `markdown-it` 14.3.2 → 15.0.2 and `markdown-it-attrs` 4.3.1 → 5.0.1; three have minor or patch updates inside their ranges: `markdown-it-attrs` 4.5.0, `markdown-it-bracketed-spans` 1.0.3 and `slugify` 1.6.9. Take the in-range ones first and compare the output with `compare-dist` (it should be identical); for the majors, read each changelog and compare the whole site, since markdown-it and its plugins decide how every page's Markdown renders. Do them one at a time, each its own commit.
- **Retire body EJS** in favour of partials. Only `Colophon.md` and `partial/mt.md` use it.
- **Delete `scripts/migrate-vault.mjs`.** It is a no-op on the current vault.
- **Speed.** The build is about half a second and Node's startup is a fixed ~50 ms, so what is left is small; measure before committing to any. Candidates: one tokenizer walk shared by all text transforms (ordering dependencies, abbr → roman/divine skip, make fusing harder), and profiling again for markdown-it (~80 ms), the layout render and reading sources.
