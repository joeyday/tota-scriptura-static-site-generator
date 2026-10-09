# Release notes

What changed in each tsgen release, newest first, and (at the end) what the generator did before tsgen existed.

- **Dates** are the tag's date (local time). **Live** is the date the content repo bumped to that tag, which is what deploys the site. A release with no Live date was never deployed on its own; its changes went out with the next release that was.
- **Commits** is the `git log` range that shows exactly what is in the release.
- Output changes are called out. Unless a release says otherwise, a refactor or speed-up left the built site byte-identical to the previous release, which `scripts/compare-dist.mjs` checks.
- "The vault" is the content repo. Its own side of each change (migrations, files edited) is Joey's and lives in that repo's history.

Contents: [0.11](#0116--2026-10-09) · [0.10](#0102--2026-10-08) · [0.9](#090--2026-10-07) · [0.8](#080--2026-10-07) · [0.7](#070--2026-10-06) · [0.6](#060--2026-10-06) · [0.5](#050--2026-10-02) · [0.4](#040--2026-10-02) · [0.3](#030--2026-10-02) · [0.2](#020--2026-10-02) · [0.1](#010--2026-10-01) · [Before tsgen](#before-tsgen-buildjs-in-the-content-repo-2026-02-28--2026-10-01)

---

## 0.11.6 — 2026-10-09
Live: not yet deployed · Commits `git log v0.11.5..v0.11.6`

- **Changed (output, every page with a table):** tables have no lines. The header row is white text on a dark shade of violet (never lighter than 0.5 in lightness, so the text holds up in dark mode), over rows that alternate the page background and a light violet tint, with the first row plain. The header text is left-aligned; it was centered. The stylesheet defines `--color-table` (violet) for it.
- **Changed (output, statistics):** the h3 headings are back to the site's small-caps serif, which 0.11.5 had changed on this page. The paragraph after an h3 stays ordinary body text, neither muted nor indented.
- **Changed (output, statistics):** in the two-wide headline tile of each group, the "/ y" of an "x / y" is body size; the small tiles keep label size, since "1,189 / 1,189" would not fit there.
- **Changed (stylesheet):** the semantic colors are named by role instead of by rank: `--color-primary` is now `--color-link`, `secondary` is `--color-link-external`, `tertiary` is `--color-link-broken`, `quaternary` is `--color-quote` and `quinary` is `--color-highlight`. Each is the same color as before; no page's HTML changes, which `scripts/compare-dist.mjs` confirms against a build of 0.11.5 (only the two stylesheets differ). The statistics heatmap legend names green directly.
- Only the stylesheets change; every page's HTML is byte-identical to 0.11.5, apart from the tsgen version and commit that `/statistics` prints.

## 0.11.5 — 2026-10-09
Live: not yet deployed · Commits `git log v0.11.4..v0.11.5`

- **Changed (output, statistics):** the big-number tiles are redone. They run three across, each with a rule on top in its own hue, the number in that hue and a muted label; the colors are all twelve theme colors, taken in turn across the whole page, each group picking up where the last left off. The first tile of each group is its headline and spans two columns, and a last row left short is stretched to fill it. An "x / y" tile shows its "/ y" small beside the number, on the same line. A tile can name an icon, which is drawn as a big tilted watermark in its hue, clipped along the top by the rule; the icons are chosen for twelve tiles (the Site group, Words, Links between pages, Categories and References) and the rest have none for now.
- **Changed (output, statistics):** on `/statistics` the h3 headings are set in the same face as h1 and h2 without small caps, and the paragraph after an h3 is ordinary body text, not muted or indented.
- **Changed (output, statistics):** the Scripture group leads with Verses cited and Chapters cited, and the Site group with Words and Scripture references.
- **Removed (statistics):** the tiles Aliases, Pages citing and Pages and notes counted, and the "Behind the scenes" paragraph (notes pages without a topic page, pages with their own share image, the page with the most aliases), along with the counts that only they used.
- **Added:** `/statistics` has its own stylesheet, `template/statistics.css`, linked after `style.css` on that page only, and loads its own Font Awesome kit (`ecf9c95079`, which has the core icons plus the statistics icons) in place of the main one. The layout takes a `stylesheet` and a `kit` for this; every other page is unchanged.
- Only `/statistics` and the stylesheets change; every other page is byte-identical to 0.11.4, checked with `scripts/compare-dist.mjs` against a build of the tag. The new kit has to have every icon the layout uses, or the sidebar and header icons will be missing on that page.

## 0.11.4 — 2026-10-09
Live: not yet deployed · Commits `git log v0.11.3..v0.11.4`

- **Changed (output, statistics):** the chapter heatmap gives each book its own theme color, taking the colors in turn in hue order (red, orange, yellow, puke, green, teal, slate, blue, indigo, violet, magenta, pink last) and starting over after twelve, so Genesis is red, Exodus orange, and 1 Chronicles red again. The legend stays the primary green.
- **Changed (output, statistics):** the percentage bar for each book in the "Book by book" table takes the same color as its heatmap row. The Old Testament, New Testament and Whole Bible bars stay green.
- **Changed (output, statistics):** the bars in the topic titles by first letter take the same twelve colors by place in the alphabet (A red, B orange, … M red again), so a letter keeps its color whatever letters are missing. The grid is two columns that read down, A–L on the left and M–V on the right, where it used to alternate across.
- **Docs:** the decision log records that the verse table uses the KJV numbering.
- Only `/statistics` and the stylesheet change; every other file is byte-identical to 0.11.3.

## 0.11.3 — 2026-10-09
Live: not yet deployed · Commits `git log v0.11.2..v0.11.3`

**Read before bumping the content repo:** this release fails the build on 41 references in the content as of 2026-10-09: 22 lone numbers in books of one chapter (`Jude 25`, `Phm 3`, `Ob 10`, `3Jn 7`, mostly in notes pages) and 19 that can't exist (`Isaiah 16:40`, `Isaiah 35:21`, `Isaiah 54:24`, `Exodus 24:23`, `Psalms 21:14–15`, `Rev 4:11–14`, `1 John 3:24–25`, `1Th 1:11–12`, `John 17:52`, a `1Ch` meant as `2Ch` in the Sabbath notes, seven `1 Chronicles` references in the Joseph notes, and more). The build lists each with its page and the reason. Fix them in the content repo first.

- **Changed, can fail a build:** a Scripture reference that can't exist fails the build, like a broken wikilink. It is checked against the verse table (`lib/bible/validate.js`, from `versification.js`): a chapter or verse its book doesn't have (`Romans 17`, `Isaiah 16:40`), a range that runs backwards (`Jn 3:18–16`), or a number that is really a count read as a continuation (`Romans 12:1–15:13, 71 verses` reads the 71 as Romans 12:71). Every one is listed with its page and the reason. A `!` before a reference opts it out; a continuation can't be opted out, so reword it. Hidden pages are never rendered, so they are never checked, and a page shown by `serve --show-hidden` only warns. An impossible reference is never collected, so no generated page can hold one.
- **Changed, can fail a build:** books of one chapter (Obadiah, Philemon, 2 John, 3 John, Jude) are written in full. `Phm 1:3` is verse 3 and `Phm 1` is the whole letter; a lone `Phm 3` is chapter 3, which doesn't exist, so it fails with a hint on how to write the verse. This replaces 0.11.1's rule that `Phm 3` and `Phm 1:3` are the same reference.
- **Changed (output):** a book of one chapter is shown without its chapter: `Phm 1:3` reads `Phm 3`, `Phm 1:3–5` reads `Phm 3–5`, and `Phm 1` or `Philemon 1` reads just `Phm` or `Philemon`, still linked to the whole chapter (so a bare book name, in these books, is opt-in). Links are always explicit (`Phm1.3`, `Phm1`). The Scripture index and the statistics print the full form and the linker collapses it, so every generated reference is valid.
- **Removed (statistics):** the "citations that point past the end" section, since a build can no longer have any.
- **Checked:** the new linker against the released one on 296 real pages and 30,000 fuzzed inputs, with every difference involving a book of one chapter; scratch vaults for each kind of failure, the accepted forms, and hidden and `--show-hidden` pages.
- **Open:** the verse table is the KJV numbering. The ESV mostly follows it, but 3 John may have 15 verses in the ESV (14 in the KJV), which would make a real `3 John 15` fail. Unverified; in the plan.

## 0.11.2 — 2026-10-08
Live: not yet deployed · Commits `git log v0.11.1..v0.11.2`

- **Fixed (statistics):** two false Scripture links on the page itself. The linker read a number after a reference as a continuation, so "Romans 12:1–15:13, 71 verses" linked the 71 as Romans 12:71 (a verse that doesn't exist) and "Romans 1–4, 4 chapters" linked the 4 as Romans 4. The records now put the number before the reference ("The longest passage cited, at 71 verses, is Romans 12:1–15:13…"), and the example in the explanation is opted out. The page has no Scripture link it shouldn't.
- **Changed (statistics):** a verse range of more than 15 verses cites its chapters but not its verses, so an outline that cites whole sections can't "cite" most of a book. On the vault, Romans goes from 97.7% of its verses to 80.8%, and the whole Bible from 26.1% to **23.5%** (7,304 of 31,102 verses); chapters are unchanged at 913 of 1,189. 62 passages are affected, 8 of them over 40 verses (seven in the Romans commentary's outline, plus two long Ezekiel chapters). The longest-passage record still shows them. The limit is `MAX_CITED_RANGE` in `lib/stats.js`; 10 and 20 were tried first.

## 0.11.1 — 2026-10-08
Live: not yet deployed · Commits `git log v0.11.0..v0.11.1`

- **Changed:** books of one chapter (Obadiah, Philemon, 2 John, 3 John, Jude). A lone number is a verse, so `Phm 3` is Philemon 1:3 and `Phm 3–5` is verses 3–5, and `Phm 1:3` is the same reference. Both forms link to the same explicit URL (`Phm1.3`; a lone number used to link as a chapter, `Phm3`), both read `Phm 3` in the link text (the chapter is dropped), and both are one entry in the Scripture index, which shows `3`. `Phm 1` is verse 1, not the whole letter: write `Phm 1–25` for that. `Phm 2:3` stays as written, since chapter 2 doesn't exist. After such a reference a bare number is a verse (`Jude 3, 5`). On the vault, 85 link texts on 46 pages change, and no link is added or lost.
- **Changed (statistics):** the Scripture figures count exactly the references the Scripture index lists, so notes pages, reference pages and categories are left out; counting notes had inflated the coverage.
- **Changed (statistics):** two ideas instead of four. A chapter is cited when any citation touches it; a verse is cited only when a citation names it, alone or in a range, so `Romans 5` cites the chapter but none of its verses, and `Romans 5:1` cites both. The covered/named split is gone, and the coverage and book tables have one verse column. On the vault: 913 of 1,189 chapters and 8,125 of 31,102 verses (26.1%) are cited, where 0.11.0 said 40.9% of verses were covered.
- **Changed (statistics):** hidden and unlisted pages are not counted anywhere on the page, and it has no figures of their own about them (the hidden, placeholder, unlisted and empty-category counts are gone). Pages, the Meta count, links and page weight no longer include the 404 page and other unlisted pages. The "Redirects from aliases" tile is now "Aliases" and counts aliases (32), not redirect pages (59, which included each alias's notes mirror).
- **Removed (statistics):** the partials count, an implementation detail.
- **Fixed:** the Philemon coverage read 100%, because `Philemon 1` (the last item in a list of whole chapters in the Slavery notes) was read as chapter 1, which in a one-chapter book is every verse. It reads as verse 1 now (52%, before the verse rule below), so that line should say `Philemon 1–25` if it means the whole letter.
- **Cost:** the statistics page adds about 26 ms to a build of about 500 ms (+5.3%).
- **Checked:** the Scripture figures were recounted independently from the `ref.ly` links in the built HTML (8,961 links, 65 books, 913 chapters, 8,125 verses, 8 impossible citations), and the one-chapter change against the previous code on every page and 30,000 fuzzed inputs.

## 0.11.0 — 2026-10-08
Live: not yet deployed · Commits `git log v0.10.2..v0.11.0`

- **Added:** a statistics page at `/statistics`, the first generated page in the `meta` namespace. It is in `/index/alphabetical/meta` and linked from the sidebar under "About this project", and stays out of search, the random pool and the Scripture index. Everything on it is counted from structures the build already holds, with no new pass over the files, and the output is deterministic (no dates or timings; it shows the tsgen version and the content commit):
  - **The site:** pages and notes by namespace, drafts, featured, aliases, images, partials, and how many pages carry their own share image.
  - **Words:** totals, the median page, longest and shortest pages, a length histogram, the most used words (citation abbreviations left out), the divine names, questions, exclamation marks, Greek and Hebrew words, title records, and reading time.
  - **Links:** the most linked-to pages, the pages that link out most, and the pages nothing links to.
  - **Categories:** sizes, depth, pages in several categories and pages in none.
  - **What is on the pages:** headings, images, tables, footnotes, quotations and callouts, with the page that has the most of each, and page weight.
  - **Scripture:** references, different references, books, chapters and verses cited (a verse is *covered* when a citation includes it, a whole-chapter citation covering every verse in it, and *named* when cited as a verse), the most cited books, chapters and verses, the longest passage cited, the longest uncited stretch of the canon, translations used, the pages that cite the most, a table by book, and a heatmap of all 1,189 chapters. Citations that name a chapter or verse their book does not have (19 on the vault, probably typos) are listed in a collapsed section.
- **Added:** `lib/bible/versification.js`, the number of verses in every chapter (the Protestant numbering the ESV follows: 1,189 chapters, 31,102 verses), taken from a public-domain KJV text and checked against the known verse total of all 66 books. In a book of one chapter (Jude, Philemon…) a lone number counts as a verse.
- **Changed:** the Scripture collector also gathers the references on notes pages, which hold most of the citations. Each reference is tagged, and the Scripture index still lists only the pages that are not notes, so the index is unchanged.
- **Changed:** `scripts/compare-dist.mjs` ignores the build hash shown on the statistics page.
- **Cost:** about 28 ms on a build of about 500 ms (+5.6%): roughly 9 ms for words, 7 ms for the Scripture coverage and 4.5 ms to write the page. The rest of the site is byte-identical apart from the new sidebar link, the Meta list entry and the new CSS.
- **Checked:** the Scripture figures were recomputed independently in Python from the `ref.ly` links in the built HTML, and match: 66 of 66 books, 1,088 of 1,189 chapters, 40.9% of verses covered.

## 0.10.2 — 2026-10-08
Live: not yet deployed · Commits `git log v0.10.1..v0.10.2`

A patch release that includes new ways to fail a build, all of them for content that was already broken.

- **Changed, can fail a build:** an image link must name a real image in `image/` or `template/`. `image/<file>` or `template/<file>` is the canonical form (what Obsidian's link picker inserts), and a bare `<file>` works too. A link to an image in any other folder, to one that doesn't exist, or with a typo fails the build, listing each one with its page, on published pages only. Before it silently emitted a broken `<img>` (and a path-qualified hero embed silently lost its hero and `og:image`). Alt text and link text default to the bare file name.
- **Changed, can fail a build:** two assets with the same name (compared case-insensitively) fail the build, listing both files. Asset names are flat in `dist/asset/`, so one used to overwrite the other with only a warning. This also keeps every bare image name unambiguous.
- **Fixed:** `Romans 3, 5` is chapters 3 and 5 (two links), not Romans 3:5. After a chapter-level reference (`Romans 3`, `Romans 3–5`) a bare number after a comma or semicolon is a chapter or a range of chapters (`Romans 3, 5–7`), and it stays at chapter level until a `ch:v` returns to verses. After a reference with a verse it is still a verse (`Romans 3:16, 18`).
- **Fixed:** a `1`, `2` or `3` followed by a capitalized word after a separator is the start of a numbered book, not a continuation. `Heb 7:26; 1 Pet 3:15` no longer links the `1` as Hebrews 7:1. This was live on four pages (13 wrong links).
- **Changed:** a numbered book's abbreviation has no space after the number: `1Jn 2:2` and `2Ki 5` link; `1 Jn 2:2`, `2 Ki 5` and `1 Tim 3:3` are not references and don't link. The full names (`1 John`) take the space. A book abbreviation after a lone `1`, `2` or `3` and a space also no longer matches, so `1 Jn 2:2` can't turn into a link to John 2:2.
- **Output on the vault (compared with 0.10.1):** 18 Scripture links removed and none added, on six notes pages. 13 were wrong links (a bare `1` or `2` linked as a verse). Five were spaced numbered abbreviations that worked before and are now plain text until written `1Jn`, `1Ti`, `2Ki`: `1 Jn 2:2`, `1 Ti 4:13–16`, `1 Jn 1:1–2; 5:11–13` and `2 Ki 5`.
- Verified against the previous Bible code on every page and 30,000 fuzzed inputs; every difference is one of the rules above.

## 0.10.1 — 2026-10-08
Live 2026-10-08 · Commits `git log v0.10.0..v0.10.1`

- **Changed:** `theme-color` is now always the nav gray (`#585858` light, `#484848` dark) at every width, so Safari's window chrome matches the sidebar. It was white (light) and `#161616` (dark), the main column's colors.
- **Not fixed:** a thin light line at the top of the phone layout in Safari persists. The page itself has none (the top pixel rows are solid nav gray in headless Chrome at 3× and 2.5×), so it is presumed to be part of Safari's own chrome.

## 0.10.0 — 2026-10-08
Live 2026-10-08 · Commits `git log v0.9.2..v0.10.0`

- **Faster:** the Bible-reference pass skips text runs with no digit (about 99% of them), and the Scripture collector and the Bible-ref linker are now one pass (`lib/bible/scan.js` finds each reference once; `link.js` renders links; `collect.js` builds index entries; `process.js` does the single tag walk). Build time went from about 519 ms to about 486 ms. The two passes can no longer disagree about what counts as a reference, and `lib/bible/` is 100 lines shorter. Verified against the old code on every page and 30,000 fuzzed inputs (HTML and collected references).
- **Changed, can fail a build:** `abbreviations.json` and `alt-text.json` are required. A missing, malformed or non-object file fails the build with its name; before it only warned and skipped.
- **Changed:** assets are copied only from the vault's `image/` folder (and tsgen's own `template/`). Assets elsewhere in the vault are ignored; before, the whole tree was scanned.
- **Removed:** fuzzy link matching. A wikilink no longer matches a hyphenated key by reading hyphens as spaces (`[[foo bar]]` finding `foo-bar`). Nothing in the vault used it.
- **Changed (markup):** the first tab in the page-actions nav has class `page` instead of `topic`, since it names the page in any namespace. No CSS used the old class.

## 0.9.2 — 2026-10-08
Live 2026-10-08 · Commits `git log v0.9.1..v0.9.2`

- **Changed (output):** a notes page uses its page's hero image as its `og:image`, with the card type to match, instead of the fallback. A notes page never uses its own opening image (a diagram or a map); with no page hero it gets the fallback.

## 0.9.1 — 2026-10-08
Live 2026-10-08 · Commits `git log v0.9.0..v0.9.1`

- **Added (output):** every page gets an `og:image`. A page that has no hero of its own, every generated page and the 404, and the home page share `image/Trees-and-buildings.png` with a `summary_large_image` card. The home page keeps its avatar on the page itself; only its role as the share image is gone. The build fails if the fallback image is missing.

## 0.9.0 — 2026-10-07
Live 2026-10-07 · Commits `git log v0.8.3..v0.9.0`

- **Added:** `tsgen serve` watches and rebuilds. A change to a page, a `.json` data file, an image or other asset, or a template file starts a rebuild after 2.5 s of quiet (Obsidian saves a file more than once, so a short wait would rebuild over and over). The whole site is rebuilt into a staging folder and swapped in only if the build succeeds; a failed build prints its error and the last good site keeps serving. Open pages reload themselves when a rebuild finishes (only while watching; the built site never has the script). `--no-watch` serves the first build only. Each rebuild prints which files triggered it. Incremental builds were considered and rejected: the full build is about half a second, and a page depends on the whole link graph and every listing, so invalidation would risk stale output.

## 0.8.3 — 2026-10-07
Live 2026-10-07 · Commits `git log v0.8.2..v0.8.3`

- **Changed:** a missing or circular partial is reported once per page, naming the page, instead of once per expansion.
- **Changed (CSS):** the Mastodon and Facebook link colors win on specificity (`a.external[href^=…]`) and no longer need `!important`.
- Notes and backlinks titles briefly read "Trinity · notes" in this release's history and were reverted before the tag ("Do babies go to heaven? · notes" reads badly), so titles are unchanged: "Trinity notes".

## 0.8.2 — 2026-10-07
Live 2026-10-07 · Commits `git log v0.8.1..v0.8.2`

- **Added:** a page shown by `serve --show-hidden` says "This topic page is hidden." (a notes page: "These notes are hidden.") with an eye-slash icon, standing in for the draft notice. The layout receives `shownHidden`.
- **Added:** `serve --port <n>`; `serve` is quiet by default, printing only warnings, errors and the address, and `--verbose` brings back the "Built …" and "processed …" lines.
- **Fixed:** interpolated attributes are escaped (abbreviation `title`, image `alt`, fenced-div attributes), and a `$` in a partial's argument is no longer read as a replacement pattern.
- **Changed (CSS):** the stroke ladder lost a duplicate step (`thinner-stroke`); no visual change.

## 0.8.1 — 2026-10-07
Live 2026-10-07 · Commits `git log v0.8.0..v0.8.1`

- **Changed (print):** callouts keep their screen width, so their text wraps at the same words; headings follow a type scale (h3 keeps its size, h2 is one step up, h1 two, each 1.667×).

## 0.8.0 — 2026-10-07
Live 2026-10-07 · Commits `git log v0.7.3..v0.8.0`

- **Added:** a print stylesheet. A printed page is the article and nothing else: no logo, navs, search, featured star, footnote back-links or categories line. Links are plain text, and an external link spells out its address in parentheses, except Scripture references and links whose text already is the address (the new `bare-url` class). Print is always light, with colors and backgrounds kept. Body type is a fixed 11pt in a full-width column with 1in margins above and below, 1.5in at the sides, and page numbers where supported. Headings stay with their text (and with a "Main topic" line between them); figures, blockquotes and table rows don't split. A print-only footer line reads "Retrieved from {URL} on {date}" (`print.js` fills in the date).
- **Added:** `CLAUDE.md`, `PLAN.md` and `README.md` (any folder, any case) are never built as pages, partials or errors.
- **Added:** `tsgen serve --show-hidden` builds pages marked `hidden`, for previewing rough drafts. Only `serve` takes it, so a deploy can't publish hidden pages. Problems that only such a page causes (a broken link, a URL or alias clash) are warnings.
- **Changed:** `404.md` is always unlisted, whatever its frontmatter says.
- **Fixed:** a Bible translation applies only when it directly follows a reference and its continuations (`Jn 3:16; 5:24 KJV`). Before, the first translation anywhere later in the text run, up to the next named reference, captured it ("Romans 3:23 is a great verse. Later the KJV renders it…" linked to the KJV).
- **Fixed (layout):** the article stays inside the viewport when a classic scrollbar takes width (`min(var(--main-width), 100%)` replaces `100vw`), so narrow desktop windows no longer scroll sideways.
- **Changed (head):** the icon set is three files (`favicon.ico`, a 96px PNG and the 180px touch icon); the other twelve files and the `shortcut icon` and `msapplication-*` tags are gone. `preconnect` hints for Typekit and Font Awesome.
- **Changed (CSS):** the dark-mode highlight (`mark`) background matches Logos's contrast.

## 0.7.3 — 2026-10-07
Live 2026-10-07 · Commits `git log v0.7.2..v0.7.3` (a hotfix branched from v0.7.2; the work in 0.8.0 was not in it)

- **Fixed:** every icon disappeared. After the Font Awesome kit was pruned it became an SVG-with-JavaScript kit and its `.css` URL returned a 19-byte stub. The layout now loads the kit as a deferred script, and `css-naked.js` removes the kit's SVGs and `<style>` in CSS Naked mode. Icons appear a moment after the page paints, and with JavaScript off they are absent.

## 0.7.2 — 2026-10-07
Live 2026-10-07 · Commits `git log v0.7.1..v0.7.2`

- **Changed:** `viewport-fit=cover` so the page paints under the notch strips, and `overscroll-behavior: none` on the root, since iOS paints the rubber-band bounce with a flat color, never the desktop two-field gradient.

## 0.7.1 — 2026-10-07
Live 2026-10-07 · Commits `git log v0.7.0..v0.7.1`

- **Changed (CSS, no visible change except as noted):** small caps and numerals use `font-variant-*` instead of `font-feature-settings` (old-style figures stay off inside small caps, as before); one link reset; no `!important` on the footer; the duplicate gray tokens merged into `--color-gray`; dead vendor prefixes removed.
- **Changed (output):** a bare `:::` fence is a `<div class="callout">` (it was an unmarked `<div>`, which also caught hand-written divs); `data-name` is gone from divine-name spans (nothing read it); the draft notice text is no longer italic; the hidden words in the sidebar links ("Featured *topics*", "Alphabetical *index*") use the shared visually-hidden class.
- **Fixed (accessibility):** the alphabetical-index namespace menu is a labelled `role="group"`, and the light nav is darker so muted text clears 4.5:1 (it was about 3.2:1).
- Checked in headless Chrome at three widths in light and dark, pixel-identical to the previous release apart from a half-pixel shift in one `h3` containing "I AM" and ±1 gradient dithering at the desktop column split.

## 0.7.0 — 2026-10-06
Live 2026-10-06 · Commits `git log v0.6.3..v0.7.0`

- **Added (accessibility):** footnote references, back-links and the footnotes section carry DPUB-ARIA roles, and each back-link says which footnote it returns to; decorative icons are `aria-hidden`; the featured star has a text alternative; the selected tab and namespace carry `aria-current`; search fields are `type="search"` with a real label on the search page, which no longer autofocuses; decorative CSS separators have empty alt text; links get a `:focus-visible` underline.
- **Added (head):** every page has a meta description (the frontmatter's `description`, else the first paragraph with text trimmed to about 160 characters at a word boundary, else a site default) and Open Graph / Twitter card tags; a page that opens with an image embed uses it as `og:image` with the large card. Absolute canonical links on every page and alias redirect; backlinks pages are `noindex`; `meta charset` first.
- **Changed:** generated titles are HTML-escaped (index, Scripture, redirect pages, search results). The search index keeps each page's whole text instead of the first 5,000 characters. The search script is pinned to MiniSearch 7.2.0 with an SRI hash.
- **Changed, can fail a build:** frontmatter keys must be lowercase (`Title:` used to be silently ignored); a numeric `title` or `permalink` becomes text and any other non-text value fails the build.
- **Fixed:** fenced blocks and inline code are masked before partials, wikilinks, EJS, comments and small text run, and restored before markdown-it. Commented-out (`%%`) links and template tags now do nothing, and backlinks skip comments, code and self-links.
- **Changed:** every build empties the output directory first (refusing one that holds the vault). Tables scroll sideways in a `.table-scroll` wrapper. `/random` gets the divine-name treatment. CSS Naked guards `localStorage` and has descriptive link text. The Mastodon and Facebook link colors match only links that start with those hosts. Dead skip lists removed.

## 0.6.3 — 2026-10-06
Live 2026-10-06 · Commits `git log v0.6.2..v0.6.3`

- **Fixed (CSS):** mobile menu columns align to the top.

## 0.6.2 — 2026-10-06
Live 2026-10-06 · Commits `git log v0.6.1..v0.6.2`

- **Changed (output):** the sidebar menu is reordered (Indexes and Random page first, then Home and About, then search) so the two mobile columns balance. The desktop rule that hides the Home link now targets the last section.

## 0.6.1 — 2026-10-06
Live 2026-10-06 · Commits `git log v0.6.0..v0.6.1`

- **Changed:** the search button is an inset magnifying-glass circle. The field has a fixed height so Safari and Firefox match Chrome (they ignore a `line-height` below the font's normal one, which made the field taller). Field and button have `aria-label`s; the placeholder is "Search" (it was "Keywords").

## 0.6.0 — 2026-10-06
Live 2026-10-06 · Commits `git log v0.5.7..v0.6.0`

- **Added:** a hidden page that a published page links to builds as an under-construction placeholder at its URL: the title and a `fa-person-digging` notice, `noindex`, none of its content, and in no list. Links to it get the `planned` class. A hidden page nobody links to still builds nothing.
- **Changed, can fail a build:** a wikilink on a published page that matches no page, or several, fails the build, with every problem listed. (Hidden pages are never rendered, so a bad link there doesn't count.)
- **Changed:** the draft notice is namespace-aware ("This topic page is a working draft."; notes pages: "These notes are a working draft.").
- **Changed (CSS):** `planned`, `broken` and `span.broken` are pink. Color system: the muted nav text, the search field derives from the nav text and background so they can never collapse into it (`--color-nav-text-muted`, `--color-nav-field-background`); `color-scheme: light dark`; light and dark `theme-color`; a lighter dark-mode `mark` with lifted link colors inside it; the chroma `--c` is 0.16 as the sRGB fallback and 0.25 (light) / 0.17 (dark) under `color-gamut: p3`.

## 0.5.7 — 2026-10-05
Live 2026-10-05 · Commits `git log v0.5.6..v0.5.7`

- **Changed:** the draft notice's pencil is a Font Awesome icon instead of the Unicode character.

## 0.5.6 — 2026-10-05
Live 2026-10-05 · Commits `git log v0.5.5..v0.5.6`

- **Changed (output):** reference pages are kept out of the Scripture index.

## 0.5.5 — 2026-10-05
Live 2026-10-05 · Commits `git log v0.5.4..v0.5.5`

- **Changed (output):** the namespace menu splits into two lines (Reference, Meta and Categories on line two), and the separator dot no longer turns bold with the selected item. Backlinks sections are headed by kind ("Links to the topic page", "Links to the category page"…). Notes pages are titled "X notes" and backlinks pages "X backlinks", which also tells them apart in search.

## 0.5.4 — 2026-10-05
Live 2026-10-05 · Commits `git log v0.5.3..v0.5.4`

- **Changed (output):** the Reference namespace is out of the random pool, and Categories moves last in the namespace menu.

## 0.5.3 — 2026-10-05
Live 2026-10-05 (with the Reference namespace of 0.5.2) · Commits `git log v0.5.2..v0.5.3`

- **Changed, can fail a build:** `gray-matter` is replaced by the `yaml` package (`lib/frontmatter.js` splits the leading `---` block itself). gray-matter pinned `js-yaml` 3, which left `npm audit` with unfixable advisories. Output is identical on the vault. Unclosed or invalid frontmatter (partials included) now fails the build, listing every offending file, instead of skipping the page with a warning.

## 0.5.2 — 2026-10-05
Not deployed on its own · Commits `git log v0.5.1..v0.5.2`

- **Added:** the Reference namespace: a `reference/` folder, a "Reference page" tab and an "All reference pages" index. `/random` draws from every namespace except Category and Meta.
- **Changed (output):** one backlinks page per page, for non-notes pages only. It lists links to the page and, in a second section, links to its notes page. A page, its notes and its backlinks share the Topic/Notes/Backlinks tabs; index pages show a lone "Index page" tab; search and random show no page-actions nav.

## 0.5.1 — 2026-10-03
Live 2026-10-03 · Commits `git log v0.5.0..v0.5.1`

- **Fixed:** the sidebar, the footer and the random page's no-script message linked to `/index/alphabetical`, which only redirects to the Topic list; they now link straight to `/index/alphabetical/topic`.

## 0.5.0 — 2026-10-02
Live 2026-10-02 · Commits `git log v0.4.0..v0.5.0`

- **Changed:** new feather-pointed favicons, Android, Windows-tile and apple-touch PNGs and ICO, regenerated from the Font Awesome icon and shipped in `template/favicon/` instead of the content repo. Icons in the page still load from the Pro kit, since the Pro licence bans publishing standalone SVG copies.

## 0.4.0 — 2026-10-02
Live 2026-10-02 · Commits `git log v0.3.3..v0.4.0`

- **Changed, can fail a build:** the build now fails (with a `BuildError`, no stack trace) on: two pages at one URL, an alias that replaces a page or collides with another, Markdown outside the known folders, an aliased notes page, a broken body-EJS template, and an iCloud placeholder file.
- **Added:** each alias of a page also redirects `/{alias}/notes` to its notes page. Hidden pages write no alias stubs.
- **Changed:** body EJS runs only on pages that contain `<%`. Bible references match case-sensitively. The `aside` link class is now `notes`. The copyright shows the full year.
- **Fixed:** `<title>` is set aside before the post-passes, so no markup lands in tab titles. Heading text is entity-decoded before slugifying (`Faith & Works` → `faith-and-works`). The Backlinks tab links to an absolute URL and only appears on pages that have a backlinks page.
- **Changed:** the layout's asset cache-buster is the content commit's short hash (`GITHUB_SHA`, else `git rev-parse`, else a build timestamp) instead of 18 separate `Date.now()` calls.
- **Removed:** the unused Entypo, Fontello and Font Awesome 3 fonts and CSS.

## 0.3.3 — 2026-10-02
Live 2026-10-02 · Commits `git log v0.3.2..v0.3.3`

- **Changed:** the project is renamed from Press to tsgen (Tota Scriptura Static Site Generator): the command is `tsgen`, the environment variable `TSGEN_OUT`, the repo `joeyday/tota-scriptura-static-site-generator`. No functional change; the content repo updated its dependency key, build script and lockfile to match. `markdown-it` requires `^14.3.2`.

## 0.3.2 — 2026-10-02
Live 2026-10-02 · Commits `git log v0.3.1..v0.3.2`

- **Fixed (security):** patch bumps to `markdown-it` 14.3.2, `linkify-it` 5.0.2, `js-yaml` 3.15.2 and `brace-expansion` 2.1.7 for their denial-of-service advisories. `npm audit` reports 0 vulnerabilities; the built site is byte-identical.

## 0.3.1 — 2026-10-02
Live 2026-10-02 · Commits `git log v0.3.0..v0.3.1`

- **Changed (output):** the namespace indexes are titled "All topic pages", "All commentary pages" and so on (the sidebar link still says Alphabetical index), and the namespace menu gets the tinted rounded box the categories line uses.

## 0.3.0 — 2026-10-02
Live 2026-10-02 (with the content migration to the namespace layout) · Commits `git log v0.2.0..v0.3.0`

The refactor and speed release. A clean build of the vault went from about 0.97 s to about 0.48 s, byte-identical apart from the fixes below.

- **Changed:** `build.js` is split into `lib/` (vault, links, partials, markdown, render, model, layout, output, io, titles, `html/`, `bible/`, `pages/`) and is a 190-line orchestrator. One HTML tag walker replaces six hand-rolled copies. Every page flows through the post-passes in memory and is written once, where the old flow wrote every page and then re-read and rewrote the whole output directory once per pass. Reads, asset copies and writes run with capped concurrency. The layout template and the abbreviation regex are compiled once. One title comparator replaces six pasted copies.
- **Fixed (output):** continuation Bible references chained after a named reference used the wrong translation (`Ge 1:5; 2:11 KJV` always linked to ESV); 11 links on 3 pages now use the translation their citation names.
- **Fixed:** directory listings are sorted, so tie order and collision winners no longer depend on the filesystem (macOS vs the Linux CI runner). Asset name collisions keep only the later file, as on a case-insensitive filesystem.
- **Removed:** dead code (the unused `TRANSLATIONS` set and `osis` field, `titleMap`, `urlToFileInfo`, `ensureDir`, unused layout variables).

## 0.2.0 — 2026-10-02
Not deployed on its own (0.3.0 was the first deploy after 0.1.0) · Commits `git log v0.1.0..v0.2.0`

The "hardcode the folder roles" release. The content repo was migrated to match with `scripts/migrate-notes.mjs`, later `migrate-vault.mjs`.

- **Changed:** partials are hardcoded to `partial/`. `{{name}}` pulls in only a partial; everything in `partial/` is a partial and never a page, and its frontmatter is ignored. The feature is renamed from "embed" to "partial", and the HTML comments for a missing or circular partial say so.
- **Changed:** notes pages. `<dir>/notes/X.md` is the notes page for `<dir>/X.md`, served at `<page url>/notes` (the home page's notes are `/notes`). Every top-level folder is a namespace with its own `notes/`. `aside of` is retired. Qualified links match the exact path from the vault root; bare names narrow to the source's folder, then `topic/`, then the root, and warn when a tiebreak decides. The "Topic" tab shows the page's folder name ("Article" for root pages). Old `/notes/…` URLs are not redirected, on purpose.
- **Changed:** categories are hardcoded to `category/`: a category is a page there, not any page that has members. A category with no listed members is unlisted, repeating so it cascades to parent categories. (The empty Commentary category dropped out of the alphabetical index, search and random pool.)
- **Added:** a separate alphabetical index per namespace, `/index/alphabetical/{topic,category,commentary,summary,meta}` (root pages are the `meta` namespace), each with a menu to the others. `/index/alphabetical` redirects to the Topic list. A namespace with nothing listed has no page and no menu entry. `reading/` becomes `summary/`. The random pool is every list except `category`.
- **Added:** `tsgen serve` (then `press serve`), a local preview server at `http://localhost:4000/` that mimics GitHub Pages (directory indexes, redirects to a trailing slash, `404.html` with a 404 status, path-traversal protection, localhost only), and the `PRESS_OUT` (now `TSGEN_OUT`) environment variable to choose the output directory. The output directory's name is skipped when scanning the vault. (A same-day attempt to serve at `press.lvh.me` on port 80 was reverted.)

## 0.1.0 — 2026-10-01
Live 2026-10-01 · Commits `git log v0.1.0`

The first release: the site's generator, split out of the content repo.

- **Added:** the repository, importing `build.js` from the shared content repo, with a README written from a careful read of the code, `CLAUDE.md`, a plan, and the legacy Replit Agent docs preserved under `archive/`.
- **Changed:** the generator is an installable CLI (`press`, later `tsgen`): a shebang, `bin`, `files`, `engines >=22`, `private: true`. `template/` (layout, CSS, JS, fonts) moved here from the content repo and is resolved from `build.js`'s own directory; the dead `embed.ejs` was dropped.
- **Added:** `scripts/compare-dist.mjs`, which byte-compares two builds ignoring the cache-buster. Output was identical to the baseline both from the repo and installed from a packed tarball.
- The content repo switched to `"tsgen": "github:…#vX.Y.Z"` in commit `fdc471e`: it dropped its own `build.js` and nine dependencies, and its workflow now runs `npm ci && npm run build` on Node 22 (20 was end-of-life).

---

## Before tsgen: `build.js` in the content repo (2026-02-28 → 2026-10-01)

tsgen began as one 711-line file, `build.js`, in the content repo `joeyday/totascriptura.org`, written with Replit Agent. That repo's own history is the record of its first seven months, and it is far better than I expected: 69 commits touch `build.js`, about 400 touch `template/`, `package.json` or the workflow, and every one is dated. The messages are terse ("fix?", "random improvement"), so this section was written from reading the diffs. Dates are commit dates. There were no tags or versions.

**What this can't recover.** The repo itself starts earlier (2024-12-01, an Obsidian-only vault). On 2026-02-28 it was cleared ("Preparing the way for the new hotness") and the generator arrived in that day's "Initial commit" as a finished 711-line `build.js`, so the Replit Agent sessions that produced it are not in git. The `archive/` docs (`replit.md`, `project-documents/tasks/*`) describe intent for several features but are undated and, as `archive/README.md` lists, drift from the code. They aren't enough to date or order that first version, and I wouldn't try. Between 2026-04-26 and 2026-10-01 the generator did not change at all; the repo's commits in that stretch are content.

### What the first commit already did (2026-02-28)
Walked the vault for Markdown and images; read frontmatter; resolved Obsidian-style `[[wikilinks]]` and `![[image]]` embeds; built categories, aliases (as redirect pages), "asides" (notes pages) and a file map; expanded `{{…}}` shorthand through EJS partials; stripped `%%` comments; rendered Markdown with markdown-it plus footnotes; wrapped pages in an EJS layout; copied images and wrote `dist/`; deployed with a GitHub Actions workflow. The same day: comments are stripped later in the build, a better `<title>`, the first layout, partial fixes.

### Timeline
- **2026-03-01:** home page; fenced-div containers (`:::`) and `~small~`.
- **2026-03-02:** partials moved from EJS (`.ejs`) to Markdown files in `partial/`; client-side search (MiniSearch, with a generated search page) and bracketed spans (`[text]{.cls}`); `build.js` cleaned up around one shared file finder; first CSS, fonts and Reftagger styling (Logos's Reftagger linked Scripture references from 03-02 until the in-house linker replaced it on 03-24).
- **2026-03-03:** permalink body class; CSS reset.
- **2026-03-04 to 03-13:** design, almost entirely in `template/`: the grid layout and nav tabs, the featured badge, categories line, search box, footnote style, home-page avatar and notes link, dark mode (03-08, thirteen commits), and a long run of responsive breakpoints (03-07 to 03-11). A `quick nav` frontmatter key (03-08). Draft support fixed (03-13).
- **2026-03-19:** the build script reformatted.
- **2026-03-23:** embed expansion rewritten as `resolveEmbeds` (arguments `{{name|a|b}}` filling positional `{{1}}` placeholders directly, instead of through EJS locals); notes pages with no topic page get a muted Topic tab; `aliases` replace the old `alias of` key and appear in the alphabetical index; prep for CSS Naked Day.
- **2026-03-24 (the biggest day):** hidden pages hidden everywhere; the **Bible-reference auto-linker** (a table of books and their CWMS abbreviations, links to `ref.ly`, continuation references like `; 5:24`, the `!` opt-out, translations with ESV as the default, no linking inside headings); the **abbreviation expander** (`abbreviations.json`); **Roman numerals** wrapped in a span; a fix to the continuation chaining rule so a year after a comma isn't read as a verse; the `featured with` property; `unlisted`; the featured star in the alphabetical index; the random page.
- **2026-03-25:** CSS Naked Day (`css-naked.js`, 28 commits); **divine names** (LORD, GOD, YHWH, with the first letter wrapped for styling).
- **2026-03-26:** duplicate file names allowed across folders (the "(notes)" suffix on notes files dropped), `resolveLink` introduced; a bracket-aware splitter so pipes inside `[[…]]` don't split partial arguments; images wrapped in `<figure>`.
- **2026-03-27 to 03-30:** the 404 page (`dist/404.html`); accessibility pass for assistive technology and a list in the quick nav; a book-abbreviation typo (2 Samuel).
- **2026-04-05:** the **Scripture index** (`/index/scripture`, with an index page per book), heading IDs on h2/h3 so references can link to sections, body classes taken from the URL path, the `›` separator replacing `§`.
- **2026-04-06:** chapter-only ranges (`Romans 1–2`).
- **2026-04-07 to 04-10:** Font Awesome icons and social icons; the site logo; featured badges on the alphabetical index; a page's permalink indexed in the link map so `[[home]]` finds "Home page".
- **2026-04-12 to 04-15:** Scripture index fixes; more divine names (the I AM forms); the home page's notes association fixed with a root-file tiebreaker for bare links.
- **2026-04-17 to 04-19:** a new color palette (several tries), link underlines, the `mark` background in light and dark.
- **2026-04-24:** the **alt-text map** (`alt-text.json`) and **initials** wrapping (`C.S.` → `<abbr>`); a new avatar; spaced-ellipsis normalising.
- **2026-04-25:** **backlinks pages**, a pre-pass that records which pages link to which; the share and print tabs removed.
- **2026-04-26:** article-aware title sorting ("The law of Christ" sorts under L), applied to category members and backlinks.
- **2026-10-01:** the content repo switches to tsgen v0.1.0 (above).
