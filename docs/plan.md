# Plan

Open work only: bugs to fix and features to build. When something is finished, delete it here; `release-notes.md` records what shipped and when, and `decisions.md` records the questions that are settled. Verify an item against the code before acting on it, since it may have gone stale.

## Accessibility and standards (each needs a decision from Joey)

- **Tables:** add captions (9 pages have an authored one; there is no syntax for it yet). Tables scroll sideways in a `.table-scroll` wrapper that is not keyboard-focusable, to avoid dozens of tab stops on the citation pages.

## Features

- **Design the Search page** (Joey, 2026-10-12). `/search` needs some design attention. The sidebar's search box and button are done and stay.
- **Deterministic hero assignment from a larger pool**, for `og:image` and perhaps the page's visible hero. It would replace the single fallback image. Assign deterministically (for example a hash of the page path) so a page's card doesn't change between builds. Open: where the pool lives, and whether every page should show a hero or only some (Joey is undecided; don't build the visible part until he decides).
- **More statistics, if wanted:** the page is built (see `docs/decisions.md` for what it counts). Candidates not built: external links by domain, abbreviation and Roman numeral counts (each needs its pass to return a count), build-over-build trends (needs history, and breaks deterministic output), and an "as of" date.
- **Scripture index entries on commentary pages, the rest** (Joey, 2026-10-12). The entries and their switch exist (see the README). Open: whether the Outline and the switch hold up for a much longer book than Titus (page size too: hidden entries are still downloaded, and a long book's could be fetched the first time the switch is turned on instead), and how the entries should look between the paragraphs.
- **Implicit small text for parentheticals.** `~text~` makes small text, and typing `<small>` is a non-starter. On 2026-10-02, content pages had 502 parentheticals already wrapped in `~…~` and 101 bare ones (notes pages are mostly bare, 994 vs 146, so the rule would apply to content pages only). The bare ones are a mix, so the rule would need an opt-out.

**Crazypants future**
- **Static book generator.**

## Code

- **An automated test suite.** The repo has none; what guards it today is `scripts/compare-dist.mjs` against a baseline build, plus differential and fuzz checks run by hand. Use Node's built-in runner (`node --test`, no new dependency) with an `npm test` script, and put in the repo the checks that have paid for themselves:
  - the Bible-reference scanner: books of one chapter (`Phm 1:3` reads `Phm 3`, `Phm 1` reads `Phm`, a lone `Phm 3` fails), continuations (`John 3:16, 18`), chapter-level continuations (`Romans 3, 5`, `Romans 3–5, 7`), numbered-book spacing (`1Jn 2:2` links, `1 Jn 2:2` doesn't), the digit-after-year case, single-chapter books, `!` opt-outs, translations (`Jn 3:16; 5:24 KJV`), and that the linker and the collector agree on every reference
  - link resolution (bare names narrowing to the source's folder, then `topic/`, then the root; qualified paths) and image links (`image/<file>`, bare names, failures)
  - the checks that fail a build (a collision, bad frontmatter, a broken wikilink), each against a tiny scratch vault
  - the statistics: the verse table totals 31,102 verses and matches every book's known total, and coverage numbers come out right on a small hand-made set of references
  - a differential/fuzz harness for the Bible code, kept out of the default run but available when that code changes

  Wanted before a 1.0.
- **Dependency updates.** Checked 2026-10-12, `npm audit` is clean and the minor and patch updates are in (`markdown-it-attrs` 4.5.0, `markdown-it-bracketed-spans` 1.0.3, `slugify` 1.6.9; the output was identical). Three are a major version behind: `ejs` 4.0.1 → 7.0.1, `markdown-it` 14.3.2 → 15.0.2 and `markdown-it-attrs` 4.5.0 → 5.0.1. Read each changelog and compare the whole site, since markdown-it and its plugins decide how every page's Markdown renders. Do them one at a time, each its own commit.
- **Speed.** The build is about half a second and Node's startup is a fixed ~50 ms, so what is left is small; measure before committing to any. Candidates: one tokenizer walk shared by all text transforms (ordering dependencies, abbr → roman/divine skip, make fusing harder), and profiling again for markdown-it (~80 ms), the layout render and reading sources.
