# Plan

Open work only: bugs to fix and features to build. When something is finished, delete it here; `release-notes.md` records what shipped and when, and `decisions.md` records the questions that are settled. Verify an item against the code before acting on it, since it may have gone stale.

## Features

- **Deterministic hero assignment from a larger pool**, for `og:image` and perhaps the page's visible hero. It would replace the single fallback image. Assign deterministically (for example a hash of the page path) so a page's card doesn't change between builds. Open: where the pool lives, and whether every page should show a hero or only some (Joey is undecided; don't build the visible part until he decides).
- **More statistics, if wanted:** the page is built (see `docs/decisions.md` for what it counts). Candidates not built: external links by domain, abbreviation and Roman numeral counts (each needs its pass to return a count), build-over-build trends (needs history, and breaks deterministic output), and an "as of" date.
- **Lazy-load the Scripture index entries on commentary pages** (Joey, 2026-10-19), when a much longer book than Titus arrives. Hidden entries are still downloaded with the page; a long book's could be fetched the first time the switch is turned on instead. Also check then that the Outline and the switch hold up at that length. Fine as it is for now.

- **Combining marks only come from Source Serif.** A transliteration written as a base letter plus a combining mark (`p̄`, not a precomposed letter) joins only when Source Serif has the mark (21 of 112). Greek in a small-caps term stays lowercase, since Noto has no small caps where Source Serif made Greek capitals. Four vault files carry a stray byte-order mark (U+FEFF); `scripts/subset-fonts.py --vault vault` lists what no font covers (only invisible marks and the sandbox's emoji, today).

- **Italics and abbreviations inside a term's italic aside.** In a topic term or `h3`, the generator wraps a parenthetical's words in `<em>` (so the parentheses stay upright). Two cases in the corpus look wrong or untested: an authored italic inside the aside (`(gr. <em>pas</em>)`, the four `fourfold-state-of-man` terms) stays italic, since an `<em>` inside an `<em>` doesn't flip, so the foreign word no longer stands out; `small em em { font-style: normal }` would flip it to roman. An abbreviation inside it (`LXX` in `baptism`, `OT` and `NT` in `hell`) renders as full-size italic capitals, because Source Serif's italic has no small caps; `small abbr { font-style: normal }` would give roman small caps. Neither rule is written, and neither case has been looked at in a browser.

**Crazypants future**
- **Static book generator.**

## Code

- **Dependency updates.** Checked 2026-10-12, `npm audit` is clean and the minor and patch updates are in (`markdown-it-attrs` 4.5.0, `markdown-it-bracketed-spans` 1.0.3, `slugify` 1.6.9; the output was identical). Three are a major version behind: `ejs` 4.0.1 → 7.0.1, `markdown-it` 14.3.2 → 15.0.2 and `markdown-it-attrs` 4.5.0 → 5.0.1. Read each changelog and compare the whole site, since markdown-it and its plugins decide how every page's Markdown renders. Do them one at a time, each its own commit.
- **Speed.** The build is about half a second and Node's startup is a fixed ~50 ms, so what is left is small; measure before committing to any. Candidates: one tokenizer walk shared by all text transforms (ordering dependencies, abbr → roman/divine skip, make fusing harder), and profiling again for markdown-it (~80 ms), the layout render and reading sources.
- **Make wikilinks, `%%` comments and `^block` ids markdown-it rules.** Today `render.js` handles them with regexes over the raw source, and `maskCode` (`lib/code.js`) hides code from those passes first. As parser rules they would skip code by construction (and `[[a|b]]` in a table cell would stop being a regex question). Partials and EJS stay textual preprocessing, since they output Markdown, so `maskCode` stays for them. Only these three move; the HTML post-passes stay, because they also run on generated pages and the layout, and the Bible-ref linker needs context across inline tags. Check the whole site with `compare-dist`. The corpus has no fenced code today, so this is robustness, not a fix.
