# Plan

Living roadmap for tsgen. Update it as work lands; delete finished items rather than ticking them.

## 0. Finish the split: tsgen as a git-installed CLI (DONE 2026-10-01)

The content repo is `joeyday/totascriptura.org`. Both repos are public, so no CI token is needed. The content repo depends on tsgen as a git dependency. The lockfile pins the exact tsgen commit, so work on tsgen can't reach the live site until the content repo deliberately bumps it.

**tsgen (done in v0.1.0):**
- Added `bin`, a shebang, `files`, `engines` and `private: true`.
- `template/` moved here and is resolved from `import.meta.url`. The dead `embed.ejs` was dropped.
- Verified by installing the packed tarball into a copy of the vault and running `npm run build`: the output was identical to the baseline.

**Content repo (done in `fdc471e`; deployed successfully, live pages match the baseline):**
- Replace the nine dependencies with `"tsgen": "github:joeyday/tota-scriptura-static-site-generator#v0.1.0"` (pinned to a tag) and add `"build": "tsgen"`.
- Regenerate the lockfile.
- Delete `build.js`, and `template/` if it moved.
- Have `deploy.yml` run `npm ci && npm run build`, and bump Node 20 to 22, since 20 is end-of-life.
- To bump tsgen later, change the tag and regenerate the lockfile (see `CLAUDE.md` → Releasing).

**Added after v0.1.0:** the `TSGEN_OUT` environment variable (output directory; default `dist`). Not yet released or tagged, and CI doesn't need it. `tsgen serve` (a local preview server, `serve.js`) was added too. Planned next: possibly an incremental rebuild / watch mode, because Joey now expects to run builds locally.

## 1. Short-term goals (set 2026-10-01)

tsgen is a bespoke, single-site tool. There are three goals: **(a)** split `build.js` into modules, **(b)** make the build much faster (aim for about half the current time), and **(c)** hardcode folder roles and other decisions that are currently generic.

### Safety net (in place 2026-10-01)
- `vault/` is a copy of the real vault: 318 `.md` files, 222 built pages, 616 output files.
- `baseline/dist` is the original script's output.
- `scripts/compare-dist.mjs` checks a new build against it. The build is deterministic apart from the layout's cache-buster (the content commit's short hash, or a timestamp when there is no repo), which the script normalises.

Every refactor step must leave `dist/` **byte-identical**. Bug fixes and hardcoding changes that alter output go in separate commits, and each one's diff is reviewed on its own.

The real vault was migrated to the namespace layout (notes folders, `summary/`, listed meta pages) as of v0.3.3, and `vault/` copies it. A fresh `rsync` needs no migration, apart from the `aliases` on two notes pages (the next item); `scripts/migrate-vault.mjs` is a no-op otherwise.

Refresh `vault/` with:
```sh
rsync -a --delete --exclude='.git/' --exclude='.obsidian/' --exclude='.trash/' --exclude='.github/' \
  --exclude='.DS_Store' --exclude='node_modules/' --exclude='dist/' \
  --exclude='/build.js' --exclude='/package.json' --exclude='/package-lock.json' \
  "$HOME/Documents/Obsidian/Tota Scriptura/" vault/
```

### Baseline timing (M-series Mac, Node 22, 2026-10-01)
A clean build takes **~0.97 s** (5 runs: 0.957–1.002 s).

`--cpu-prof` breakdown of the ~950 ms:
- **312 ms idle**: waiting on strictly sequential file I/O.
- ~68 ms "(program)".
- ~90 ms in buffer/file-handle reads, opens and writes.
- ~70+ ms in EJS compilation, because the layout is recompiled for every page.
- The post-pass transforms take 10–17 ms each: initials, abbreviations, Roman numerals, divine names, Bible refs.
- ~21 ms in GC.

Node startup and module load are a fixed ~50 ms floor. Halving the total looks realistic, because I/O and EJS alone account for roughly half.

### Why (a) and (b) aren't really at odds
The features are already mostly pure `html → html` / `text → text` functions. What's slow is not the features but the **orchestration**. Each post-pass reads every file from disk, rewrites it, and writes it back: about 9 read/write round trips per page. The fix is to put each feature in its own module, exposing a pure per-page function, and have one orchestrator own the loop. Each page then flows through every stage in memory and is written once. With more modules, the corpus gets *fewer* passes, not more.

### Speed candidates
These need measurement before we commit to them.
- **In-memory post-processing, written once.** Removes about 9 reads and up to 9 writes per page, plus the re-read for Scripture collection. This is probably the biggest win.
- **Compile `layout.ejs` once.** Today `ejs.render` recompiles it for every page, backlinks page and index.
- **Skip body EJS when the source has no `<%`.** Better still, drop body EJS entirely if the only user is a partial.
- **Expand partials and resolve wikilinks once per page.** The backlinks pre-pass currently repeats that work for the main render. Record outgoing links during the single pass.
- **Remove O(n) scans in link resolution.** That's the `resolveFileMapKey` key scan, the path-qualified filter, and the root tiebreaker's `.some`. Precomputed maps or hardcoded folders can replace them.
- **Bible refs: skip text nodes that contain no digit.** Also share one parse between the linker and the collector, and fix the case-insensitive matching (`gi`) while we're there. The huge alternation regex currently runs twice per text node.
- **Compile the abbreviation regex once** instead of once per file.
- **Parallel I/O** for reading sources, copying assets and writing output, instead of strictly sequential `await`s. Replace `ensureDir`'s access+mkdir with `mkdir({recursive})`.
- **Possibly a single tokenizer walk shared by all text transforms.** Only worth doing if profiling says so, because ordering dependencies (abbr → roman/divine skip) make fusing harder.

### Proposed module layout (draft)
```
build.js                orchestrator: load → model → resolve → render+post → generated pages
lib/vault.js            fixed folders → page records (frontmatter, urls)
lib/links.js            link resolution, wikilinks
lib/partials.js
lib/markdown.js         markdown-it setup, %%, ~small~, fenced attrs
lib/model.js            aliases, asides, categories, featured, backlinks
lib/layout.js           compiled layout, classifyLinks
lib/html/walk.js        one tag-tokenizer/skip-stack helper (replaces 6 copies)
lib/html/*.js           heading-ids, abbreviations, initials, roman, divine-names, ellipses, alt-text
lib/bible/              books table, ref parser, linker, scripture-index collector
lib/pages/*.js          indexes, search, random, backlinks, redirects, scripture
```

**Progress (2026-10-02):** the clean build went from **~0.97 s to ~0.48 s** (5 runs each, same machine), byte-identical to the baseline and to the previous `build.js` on edge-case scratch vaults. Done: `lib/html/walk.js` (one tag walker), `lib/html/passes.js` (the pure HTML passes, abbreviation regex built once), `lib/bible/{refs,link,collect}.js`, `lib/markdown.js`, `lib/partials.js`, `lib/links.js`, `lib/io.js` (capped-concurrency reads, copies and writes; same-path writes stay ordered), `lib/layout.js` (compiled layout and link classification), `lib/output.js` (the in-memory post-passes and the writer), `lib/vault.js` (file discovery, asset copying, page records), `lib/model.js` (categories, featured/draft, notes pairs, per-namespace lists, backlinks), `lib/titles.js` (one title comparator instead of ten pasted copies), one `loadJsonMap`, the layout compiled once, and the post-passes folded into `emitHtml`: every page flows through heading IDs → Scripture collection → the other passes in memory and is written once. Asset name collisions now keep only the later file (as on a case-insensitive filesystem). `build.js` is now a 190-line orchestrator; `lib/render.js` renders a body and `lib/pages/{redirects,backlinks,indexes,search,random,scripture}.js` write the generated pages, all addressed by URL through `output.emit`. The split (goal a) is done apart from tidying. Next: pull those apart (`lib/vault.js`, `lib/model.js`, `lib/layout.js`, `lib/pages/*`), then re-profile for what's left (markdown-it ~80 ms, Bible-ref linker ~50 ms, layout render, reading sources).

### What the vault actually uses (survey 2026-10-01)

| Folder | Files | Frontmatter seen |
|---|---|---|
| root | 7 | `unlisted` ×7, `quick nav` ×3, `title`, `permalink`, `hidden` |
| `topic/` | 141 | `categories` 89, `draft` 49, `hidden` 34, `stub` 27, `aliases` 21, `featured` 12, `featured with` 2, `disambiguation` 1, `title` 1 |
| `notes/` | 96 | **`aside of` 96**, `hidden` 15, `aliases` 2, `title` 1 |
| `partial/` | 44 | `hidden` 42 (the two without it, `god-eternity` and `spirit-eternity`, are published at `/partial/…`, probably by mistake) |
| `category/` | 21 | `categories` 16 |
| `reading/` | 5 | `hidden` 5, `categories` 5, `draft` 1 |
| `commentary/` | 4 | `unlisted` 4, `categories` 4 |
| `image/` | 43 | images and favicons (the only asset folder besides `template/`) |
| `template/` | | `layout.ejs`, `style.css`, `css-naked.js`, Font Awesome + Fontello CSS, `fonts/`, and a dead `embed.ejs` |

Other root files that aren't site content: `NTOT.md`, `OTNT.md` and `Sandbox.md` (built as pages), `Topics.base` (Obsidian Bases), and the tooling leftovers `convert-wiki.py`, `do-pandoc.sh`, `ts-filter.lua` and `example-page.html`.

Usage counts:
- **Duplicate basenames:** 92 pairs, almost all `notes/X` ↔ `topic/X`. That is why **239 of 522 wikilinks are path-qualified**.
- **No `[[…#heading]]` links.**
- **EJS appears only in `Colophon.md` and `partial/mt.md`.**
- **228 partial uses.** 44 files use arguments or placeholders, so the argument machinery is in real use.
- **`permalink`** is used once (`Home page.md → home`).
- Small text `~x~` appears in 139 files, `:::` containers in 16, and `%%` comments in 4.
- `quick nav` and `disambiguation` are presumably read by `layout.ejs`. `stub` is read by nothing (checked 2026-10-06); the 27 pages that carry it are all also `hidden` and `draft`, so they become placeholders as soon as a published page links to them.

**Notes for topics that don't exist yet are a feature.** Joey sometimes writes notes before the topic page exists. One current example: `notes/Doubt.md` → `topic/Doubt`. Such a note should be treated as draft and/or hidden even without the flag, and shouldn't produce a warning. The exact behaviour is still to be decided.

Fixed in the vault on 2026-10-01: the stray `{{lds}}` embed, and the two unhidden partials. `baseline/` was regenerated afterwards (612 files).

### Hardcoding candidates
Joey to confirm each. The evidence comes from the survey above.
- **Fixed folder roles.** Scan only `topic/`, `notes/`, `category/`, `summary/`, `commentary/`, `partial/` and the root, plus the assets in `image/` and `template/`. This replaces the whole-tree walk and its skip lists.
- **`hidden` outside `partial/`.** It is still used in `topic/` (34), `notes/` (15) and `reading/` (5, to become `summary/`), so we need to decide what it means there. (`partial/` is now hardcoded as partials-only; see the next section.)
- **Resolve folder-qualified links via a `folder/name` map**, replacing suffix matching. Bare names resolve to `topic/` (or the root) before `notes/`. The root-file tiebreaker and generic ambiguity logic can probably go.
- **Hardcode the homepage** as `Home page.md`, and drop `permalink` and the home/index logic.
- **Canonical lowercase frontmatter keys.** This drops `getFrontmatterValue` and fixes the `Title:` bug.
- **Assets only from `image/` and `template/`**, which drops the whole-vault scan.
- **`abbreviations.json` and `alt-text.json` become required** and are simply imported.
- **Body EJS** could be replaced or retired, since only `Colophon.md` and `mt.md` use it.
- **Keep partial arguments.** They are in real use.
- **Unknown:** whether the fuzzy hyphen-as-space link matching is used. Measure it before removing.

### Partials (done 2026-10-02)
The feature is called **partials** everywhere in the code (`expandPartials`, `splitPartialArgs`, the `partials` map). Only `partial/` is consulted, by basename; everything in it is a partial and never a page, and its frontmatter is ignored, so the vault can drop it gradually. Verified byte-identical against the baseline.

The HTML comments for missing and circular partials say "partial" too (changed in a separate commit after the refactor tied out). `![[image]]` is Obsidian's image embed, a different feature, and keeps its name. The vault still has seven `{{[[violation-goals]]}}`/`{{[[draft]]}}` references to partials that don't exist; they sit in hidden pages, so they are silent.

### Notes pages and namespaces (done; live since v0.3.0)
Every top-level folder is a namespace, and each can have a `notes/` folder next to its pages (plus a root `notes/` for root pages). `<dir>/notes/X.md` is the notes page for `<dir>/X.md`, at the URL `<page url>/notes`. `aside of`, `asidesMap` and the "Could not find aside of target" warning are gone, and `resolveLink` matches qualified links by exact path and narrows bare names to the source's folder, then `topic/`, then the root. The layout's "Topic" label is the page's folder name ("Article" for root pages). Old `/notes/…` URLs are not redirected, on purpose.

Old `/notes/…` URLs are not redirected, on purpose. The vault copy refreshed on 2026-10-02 has no aliases on notes pages and the migration script is a no-op on it. Still open: the `isEmbed` name is unchanged, and the `Topic` nav `li` keeps its `topic` CSS class.

### Per-namespace alphabetical indexes (done; live since v0.3.0)
Each namespace (`topic`, `commentary`, `summary`, `reference`, `meta` for the root, and `category`, in menu order) has its own list at `/index/alphabetical/{namespace}`, with a menu to the others at the top. `/index/alphabetical` redirects to the Topic list. A namespace with nothing listed doesn't exist: no page, no menu entry. The nav tab says "Topic page", "Meta page" and so on. The random pool is every list except `category`, `meta` and `reference`.

The vault flags were migrated in v0.3.3: `unlisted` is gone from `About`, `Colophon`, `NTOT`, `OTNT`, `Home page` and the commentary pages, and kept on `404` and `Sandbox`. The `summary/` pages are still `hidden`; un-hide them as they become real and the Summaries list appears by itself.

The Scripture index includes every namespace's pages except `category`, `reference` and notes pages (Joey, 2026-10-05: `meta` stays in, even though it is out of the random pool). Search includes a namespace's pages whenever they're not unlisted. Whether `unlisted` should survive at all (it would cover only `404`, `Sandbox` and the auto-unlisted empty categories) is for later.

### `reading/` is now `summary/` (done; live since v0.3.0)
Menu label "Summaries", nav tab "Summary page". A summary page summarises the main arguments and Scripture citations of a book or article. Its notes page, like a commentary's, holds Joey's own observations and collected material. The `Book summaries` / `Article summaries` categories have no pages yet; their members are hidden, so the build is silent about it.

### Template: stays in the vault or moves here?
`template/` holds the layout, CSS, JS and fonts. Content editors probably shouldn't need to touch it. If it moves to tsgen, the vault becomes pure content.

## 2. Verified bugs and surprises

Each item below was reproduced on 2026-10-01 in a scratch vault. The fixed ones are deleted. They are listed roughly by user impact.

- **Bible-ref false positives.** Matching is now case-sensitive, so "I am 30 years old" no longer links. A capitalised word still does: "Job 2 years ago" links to Job 2, and it lands in the Scripture index.
- **Distant translation capture.** In "Romans 3:23 is a great verse. Later the KJV renders it…", the KJV link applies to Romans 3:23. There is no adjacency requirement, unlike continuation refs.
- **"Romans 3, 5"** is read as Romans 3:5, not chapters 3 and 5. The linker and the Scripture collector agree, so this is at least consistent.
- **Uppercase words read as Roman numerals:** `MD`, `DC`, `MIX`, `CD`, `CV`, `LI`, …
- **Path-qualified image wikilinks** (`[[topic/pic.png]]`) aren't resolved and emit a relative href.
- **`[[Page#Heading]]` is unsupported** and renders as broken.
- **Unescaped interpolation** in a few places: abbreviation `title`, image `alt` and fenced-div attributes. `$` in embed arguments is treated as a replacement pattern.

### Open questions for Joey (from the 2026-10-02 code review)
Delete a question once its answer has been acted on.

11. **`~text~` and small text** (Joey, 2026-10-02: no problems so far; open to ignoring stray tildes, and to a battle-tested syntax if CommonMark has one, but typing `<small>` is a non-starter). Idea: make a parenthetical on content pages small implicitly. A survey of `vault/` on 2026-10-02 found 502 parentheticals already wrapped in `~…~` on content pages and **101 bare ones** (notes pages are mostly bare, 994 vs 146, so the rule would be content pages only). Not a "very small number"; the bare ones are a mix, so the rule would need an opt-out.

## 3. Joey's backlog (pasted 2026-10-05)

Documented as-is, not yet triaged. Joey cleared work on 2026-10-06 (the colonoscopy gate starts on 2026-10-10; it is a start date for the check-in, not a deadline). Some items may be stale, so verify each against the code before acting, and ask Joey the listed questions first. Already done and left out: the new feather favicons (v0.5.0) and the `build.js` split.

### Bugs
- **Color system review (2026-10-06).** Fixed: muted nav text, the search field now derives from the nav text and background (`--color-nav-text-muted` and `--color-nav-field-background`); `color-scheme: light dark`; light/dark `theme-color`; dark `mark` lightened with lifted link colors inside it. Also done (0.6.0): `--c` is 0.16 as the sRGB fallback and 0.25 / 0.17 under `@media (color-gamut: p3)`. Several hues still exceed sRGB at 0.16 and rely on the browser's gamut mapping; checkable by setting the Mac's display profile to sRGB. Open: the stroke ladder has two identical steps (`stroke` and `thin-stroke`), and the brand-link `!important` rules.

### Improvements
- **Dark-mode `mark`.** The highlight background is too dark. Copy how Logos does its yellow highlight in dark mode, and lighten the colors of text sitting on it.
- **`reference/` namespace: waiting on the content move.** The code is done (the `reference/` folder, "Reference page" tab, "All reference pages" index, "Reference" menu label). Joey is moving `OTNT.md` and `NTOT.md` into `reference/` in the real vault himself, with the new `title`s ("Old Testament citations in New Testament", "New Testament citations of Old Testament"). Open: whether to rename the files for nicer URLs, and the old root URLs `/otnt` and `/ntot` (no redirects for now; see cross-namespace aliases below). Delete this item once the content repo has the move.

### HTML/CSS review (Claude, 2026-10-06)
Findings from a read of `template/` and the generated pages (plus a scan of all 523 built pages), listed in the order I'd do them. Joey wants all of it done eventually. Line numbers are as of 2026-10-06; verify before acting. The contrast figures are hand-computed from the oklch values, so confirm them in a checker. The "Markup accessibility" and "Stylesheet tweaks" items elsewhere in this section overlap with this list; fold them in when working on either.

**A. Accessibility, small and mechanical** (done; the namespace menu is a labelled `role="group"`, and the nav's muted text clears 4.5:1 in both schemes)
- **Keep the hidden `<h2>`s before the two navs** (Joey, 2026-10-06): the markup should make sense without CSS (CSS Naked Day), and a hidden heading is visible there while an `aria-label` is not.

**B. Accessibility, needs a decision from Joey**
- **Links are underlined only on hover** (colour alone, about 3:1 against body text; dark mode weakest). Options: underline in running prose, or keep the bare style and accept the borderline WCAG 1.4.1 result.
- **Root font size is viewport-derived** (`html { font-size: clamp(0px, …, 22px) }`): ignores the user's default font size; at 200% browser zoom text grows only about 1.65×. A deliberate design, so it's a tradeoff. A percentage base plus a `vw` term would respect the preference. Also `clamp(0px, x, 22px)` is `min(x, 22px)`, and `-webkit-text-size-adjust: none` should be `100%`.
- `abbr { text-decoration: none }` hides the only cue that a title exists, and `title` doesn't work on touch. 11 pages have bare `<abbr>` (used purely as a styling hook; a span class would be more honest).
- Tables: add captions (9 pages have an authored one; there's no syntax for it yet), and look at `th { width: 20% }`, which applies per cell. Each table now scrolls sideways in a `.table-scroll` wrapper (not keyboard-focusable, to avoid dozens of tab stops on the citation pages).
- CSS Naked: the deferred module script flashes styled content before it strips it; fixing that means a blocking script in the head.
- Heading levels skip on 101 pages (h1 → h3); authored content, since h3 carries the small-caps look. Decide whether to fix in content or style by class.
- Visual order differs from DOM order on desktop (header and sidebar are right of `main` but first in the DOM). Probably acceptable.

**C. Standards and correctness**
- Footer on mobile shows a dangling "· Colophon" (`style.css:830` hides "About" but leaves the middot from `layout.ejs:154`).
- `img { width: 100% }` upscales small images; the usual reset is `max-width: 100%`.
- `--main-width: min(100vw, 412px)` includes the classic-scrollbar width, so narrow desktop windows scroll horizontally.
- No print stylesheet: nav/footer text is white (invisible without background printing) and every `@media` rule is `screen`-only.

**D. Head and load cost**
- Trim the favicon block (`layout.ejs:13-29`): nine apple-touch sizes (iOS uses 180), five PNG favicons, `rel="shortcut icon"` and `msapplication-*` are obsolete. Replace with a 32px `.ico`, an SVG icon, one 180px touch icon and manifest 192/512; unify the `?` and `?v=` cache-bust forms. Saves about 2KB per page. Favicons are Joey's work (v0.5.0), so confirm the replacement set with him.
- `preconnect` for the Typekit origins; check Typekit's `font-display` is `swap`; ask whether the Font Awesome kit supports subsetting (the site uses five glyphs).

**E. CSS simplification** (done; checked by headless-Chrome screenshots, 3 widths × light/dark, against the baseline: pixel-identical apart from a half-pixel shift in one `h3` containing "I AM" and ±1 gradient dithering at the desktop column split)
- Kept on purpose (Joey, 2026-10-07): every hue token in `:root`, used or not, so they are ready to use. The duplicate `neutral-gray` and `light-gray` tokens are merged into one `--color-gray`. `--color-main-thin-stroke` still equals `--color-main-stroke` in light mode (the open stroke-ladder item under Bugs).
- Not done: head whitespace minification (gzip hides it).
- Small caps and numerals now use `font-variant-*`. Old-style figures are switched off in small caps (`font-variant-numeric: normal`), as the old `font-feature-settings` did by accident; drop those lines if you'd rather have old-style figures there.

### Features Joey can develop himself
- **Stylesheet tweaks:** the search box placeholder is very faint (maybe a hardcoded color); the search button border color is hardcoded; think about the Search page's style.
- **`disambiguation` property.** Special handling, probably in the template only. The vault has one use (`topic/`).
- **Social media links** in the sidebar or footer.

### Features that might be easier with Claude
- **Statistics page.** Number of pages, Scripture citations, and what percent of the Bible is cited (possibly scarily low). Joey wants more ideas for what to include.
- **Table of contents**, maybe only on notes pages. It could double as the full book outline on commentary pages.
- **`aliases` parity with Obsidian.** Understand how Obsidian uses `aliases` and match it. Obsidian disallows wikilinks in `aliases`; tsgen optionally allows them. tsgen assumes all aliases sit in the same folder as the page; check whether Obsidian thinks about it that way or more subtly.
- **Aliases that cross namespaces** (Joey, 2026-10-05; eventually, not urgent). Today an alias redirects only inside its page's own folder (`/{relDir}/{alias}`). It would be nice for an alias to point at another namespace, for example the old root URLs `/otnt` and `/ntot` redirecting to `/reference/…`. No design yet: the frontmatter syntax, how the alphabetical index and wikilinks should treat such an alias (which namespace lists it?), and collisions with real pages there are all open. The `reference/` move does not wait for this; those two old URLs will simply 404 for now.

### Crazypants future
- **Static book generator.**

### Visually hidden snippets
Joey's four variants (`.visually-hidden` ×3 with slightly different property sets, and the `.sr-only` form with `!important`) are not copied here. The `template/style.css` should get exactly one; ask Joey which, or pick the modern `clip-path` form without `clip`, since the `ie9+` fallback is unneeded.

## 4. Retire the Replit docs

`README.md` now carries the accurate reference. The Replit docs were moved to `archive/` on 2026-10-01. Joey will decide whether and when to delete them:
- `replit.md`
- `replit.txt` (a copy of `.replit`). It describes a Postgres/`npm run dev` template that never matched this project. The only real content is the dev loop `node build.js && npx serve -l 5000 dist`.
- `project-documents/`. Its task briefs are useful only as design history. Its README wrongly says the files are under `.agents`.

Ways the Replit docs drifted from the code (so nobody trusts them by accident):
- The heading-ID pass and the whole Scripture index are missing from `replit.md`'s pipeline. Its pass numbering is also internally inconsistent: the Roman numeral pass is called "pass 10" in one place and "11" in another.
- The divine-name docs list only LORD/GOD/YHWH. The code also handles the I AM / I WILL BE forms, and YHWH gets no initial span.
- The categorical index is described as "pages grouped under categories". It is actually a flat list of top-level categories.
- The featured index shows secondaries as inline "(and …)", not grouped beneath their primary.
- `bodyClasses` is a template variable but isn't documented.
- The homepage docs claim an empty permalink works. It doesn't.
- Task briefs describe the star as `entypo-icon ★`. The code uses Font Awesome classes.
- Task briefs describe the Scripture index as a `<ul>` with "Title (§Section)". The code uses a `<dl>` with `›` separators, and also excludes categories and asides.
- Backlinks are described as "other pages", but self-links are included.
