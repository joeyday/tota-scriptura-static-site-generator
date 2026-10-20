# Plan

Open work only: bugs to fix and features to build. When something is finished, delete it here; `release-notes.md` records what shipped and when, and `decisions.md` records the questions that are settled. Verify an item against the code before acting on it, since it may have gone stale.

## Features

- **Design the Search page** (Joey, 2026-10-12). `/search` needs some design attention. The sidebar's search box and button are done and stay.
- **Deterministic hero assignment from a larger pool**, for `og:image` and perhaps the page's visible hero. It would replace the single fallback image. Assign deterministically (for example a hash of the page path) so a page's card doesn't change between builds. Open: where the pool lives, and whether every page should show a hero or only some (Joey is undecided; don't build the visible part until he decides).
- **More statistics, if wanted:** the page is built (see `docs/decisions.md` for what it counts). Candidates not built: external links by domain, abbreviation and Roman numeral counts (each needs its pass to return a count), build-over-build trends (needs history, and breaks deterministic output), and an "as of" date.
- **Lazy-load the Scripture index entries on commentary pages** (Joey, 2026-10-19), when a much longer book than Titus arrives. Hidden entries are still downloaded with the page; a long book's could be fetched the first time the switch is turned on instead. Also check then that the Outline and the switch hold up at that length. Fine as it is for now.

**Crazypants future**
- **Static book generator.**

## Code

- **The Scripture index sorts a range across two chapters before one in a chapter.** `John 3:16–4:2` comes before `John 3:16–18`, because the sort compares `rangeVal` as a number, and that is an end chapter in one case and an end verse in the other. `test/corners.test.js` pins today's order. Open: which order is wanted (by where the range ends, most likely).
- **Which chapter a bare verse belongs to after a run across chapters.** In `Romans 12:1–15:13, 71` the `71` is read as Romans 12:71, the chapter the run started in; chapter 15, where it ended, may be what is meant. `test/bible-refs.test.js` pins today's reading, and the fuzzer avoids the case.
- **The statistics call a timestamp a commit.** A build with no `GITHUB_SHA` and no git repository uses the time in seconds as its cache-buster, which is all digits and so matches the `[0-9a-f]{7,}` test for a commit: `/statistics` prints it as one and links to a GitHub commit that does not exist, where it should say "a local build". `test/gaps.test.js` has the failing case as a `todo`.
- **`maskCode` closes a code fence on any fence of three or more** (found by the test suite; `test/source.test.js` has the failing case as a `todo`). CommonMark closes a fence only on one at least as long as the opening, so a four-backtick fence that holds a three-backtick line ends early, and the rest of the text becomes a second, unclosed fence. Only a page that shows Markdown fences inside a fence can hit it.
- **Dependency updates.** Checked 2026-10-12, `npm audit` is clean and the minor and patch updates are in (`markdown-it-attrs` 4.5.0, `markdown-it-bracketed-spans` 1.0.3, `slugify` 1.6.9; the output was identical). Three are a major version behind: `ejs` 4.0.1 → 7.0.1, `markdown-it` 14.3.2 → 15.0.2 and `markdown-it-attrs` 4.5.0 → 5.0.1. Read each changelog and compare the whole site, since markdown-it and its plugins decide how every page's Markdown renders. Do them one at a time, each its own commit.
- **Speed.** The build is about half a second and Node's startup is a fixed ~50 ms, so what is left is small; measure before committing to any. Candidates: one tokenizer walk shared by all text transforms (ordering dependencies, abbr → roman/divine skip, make fusing harder), and profiling again for markdown-it (~80 ms), the layout render and reading sources.
