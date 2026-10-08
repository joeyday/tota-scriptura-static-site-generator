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

**Since then:** `TSGEN_OUT` (output directory; default `dist`) and `tsgen serve` (a local preview server, `serve.js`) shipped. `serve` watches the vault and template and rebuilds the whole site on change (v0.9.0); incremental builds were considered and rejected: the full build is about 0.5 s, and a page's HTML depends on the whole link graph and every listing, so invalidation would risk stale output.

## 1. Short-term goals (set 2026-10-01; audited 2026-10-08)

tsgen is a bespoke, single-site tool. Goals: **(a)** split `build.js` into modules (done), **(b)** make the build much faster (done: ~0.97 s to ~0.48 s, byte-identical), **(c)** hardcode folder roles and other generic decisions (partly done; see below).

### Safety net
- `vault/` is a local copy of the real vault; `baseline/dist` is the reference output; `scripts/compare-dist.mjs` checks a new build against it (see `CLAUDE.md` → Running and testing). Refactors must leave `dist/` **byte-identical**; output-changing fixes go in separate commits whose diffs are reviewed on their own.
- Refresh `vault/` with:
```sh
rsync -a --delete --exclude='.git/' --exclude='.obsidian/' --exclude='.trash/' --exclude='.github/' \
  --exclude='.DS_Store' --exclude='node_modules/' --exclude='dist/' \
  --exclude='/build.js' --exclude='/package.json' --exclude='/package-lock.json' \
  "$HOME/Documents/Obsidian/Tota Scriptura/" vault/
```

### Speed candidates still open
The build is ~0.5 s and Node startup is a fixed ~50 ms, so these are small. Measure before committing to any.
- **Bible refs, one pass:** the Scripture collector and the Bible-ref linker each walk the page's HTML (about 20 ms each). Fusing them into one walk would save about one walk. (The digit gate, done 2026-10-08, took ~27 ms off by skipping the ~99% of text runs with no digit.)
- **`resolveFileMapKey` key scan:** every bare link that misses the exact key scans all keys for the hyphen-as-space match. Measured 2026-10-08: no wikilink in the vault relies on it, so the fuzzy match can go (and the README line about it).
- **Possibly one tokenizer walk shared by all text transforms.** Only if profiling says so; ordering dependencies (abbr → roman/divine skip) make fusing harder.
- Profile again for what's left (markdown-it ~80 ms, layout render, reading sources).

### Hardcoding candidates
Done: fixed page folders (`PAGE_DIRS`/`KNOWN_DIRS` in `lib/vault.js`; Markdown anywhere else fails the build), `partial/` as partials-only, exact `folder/name` link lookup (`index.byPath`), lowercase frontmatter keys (a capital fails the build), body EJS only when the source contains `<%` (only `Colophon.md` and `partial/mt.md` use it).

Still open (Joey to confirm each):
- **Homepage:** hardcode `Home page.md` and drop `permalink` and the home/index logic. `Home page.md` is the only file in the vault with a `permalink`.
- **Assets only from `image/` and `template/`**, replacing the whole-tree scan and its skip list.
- **`abbreviations.json` and `alt-text.json` required** (today a missing or malformed file warns and skips, in `loadJsonMap`; per "fail loudly" it should probably fail the build).
- **Body EJS** could be retired in favour of partials; only two files use it.
- **Keep partial arguments.** They are in real use.

### Partials (done 2026-10-02)
The feature is called **partials** everywhere in the code (`expandPartials`, `splitPartialArgs`, the `partials` map). Only `partial/` is consulted, by basename; everything in it is a partial and never a page, and its frontmatter is ignored, so the vault can drop it gradually. Verified byte-identical against the baseline.

The HTML comments for missing and circular partials say "partial" too (changed in a separate commit after the refactor tied out). `![[image]]` is Obsidian's image embed, a different feature, and keeps its name.

### Notes pages and namespaces (done; live since v0.3.0)
Every top-level folder is a namespace, and each can have a `notes/` folder next to its pages (plus a root `notes/` for root pages). `<dir>/notes/X.md` is the notes page for `<dir>/X.md`, at the URL `<page url>/notes`. `aside of`, `asidesMap` and the "Could not find aside of target" warning are gone, and `resolveLink` matches qualified links by exact path and narrows bare names to the source's folder, then `topic/`, then the root. The layout's "Topic" label is the page's folder name ("Article" for root pages). Old `/notes/…` URLs are not redirected, on purpose.

`scripts/migrate-vault.mjs` is a no-op on the current vault. Still open, cosmetic: the `Topic` nav `li` keeps its `topic` CSS class (`layout.ejs`). (`isEmbed` in `lib/render.js` is the `![[…]]` flag, so its name is right.)

### Per-namespace alphabetical indexes (done; live since v0.3.0)
Each namespace (`topic`, `commentary`, `summary`, `reference`, `meta` for the root, and `category`, in menu order) has its own list at `/index/alphabetical/{namespace}`, with a menu to the others at the top. `/index/alphabetical` redirects to the Topic list. A namespace with nothing listed doesn't exist: no page, no menu entry. The nav tab says "Topic page", "Meta page" and so on. The random pool is every list except `category`, `meta` and `reference`.

The vault flags were migrated in v0.3.3; `unlisted` survives only on `404` and `Sandbox` (checked 2026-10-08). The `summary/` pages are no longer hidden, so the Summaries list exists.

The Scripture index includes every namespace's pages except `category`, `reference` and notes pages (Joey, 2026-10-05: `meta` stays in, even though it is out of the random pool). Search includes a namespace's pages whenever they're not unlisted. Whether `unlisted` should survive at all (it would cover only `404`, `Sandbox` and the auto-unlisted empty categories) is for later.

### `reading/` is now `summary/` (done; live since v0.3.0)
Menu label "Summaries", nav tab "Summary page". A summary page summarises the main arguments and Scripture citations of a book or article. Its notes page, like a commentary's, holds Joey's own observations and collected material.

## 2. Verified bugs and surprises

Each item below was reproduced in a scratch vault. The fixed ones are deleted. They are listed roughly by user impact.

- **Bible-ref false positives.** Matching is now case-sensitive, so "I am 30 years old" no longer links. A capitalised word still does: "Job 2 years ago" links to Job 2, and it lands in the Scripture index.
- **"Romans 3, 5"** is read as Romans 3:5, not chapters 3 and 5. The linker and the Scripture collector agree, so this is at least consistent.
- **Uppercase words read as Roman numerals** (`MD`, `DC`, `CD`, `CV`, `LI`, `MIX`, …): audited 2026-10-07, and the corpus has none. All 16 `roman-num` spans are genuine (WCF chapter.section such as `XXX.I`, Institutes `II.XVI`, plain numerals). Escapes today: a term in `abbreviations.json` wins (the abbreviation pass runs first and the Roman pass skips `<abbr>`, so `MD` listed as Maryland is an abbreviation, not a numeral), as does an `<abbr>MD</abbr>` or a code span. Joey (2026-10-07): deprioritized; he only expects numerals for the WCF and the Institutes. If a collision ever comes up, the cheap fix is to stop the numeral range at 99 (no `D`, `C` or `M`, which removes `MD`, `DC`, `CD`, `CV`, `MIX`, `DIV`), or a deny list.
- **Path-qualified image wikilinks** (`[[topic/pic.png]]`) aren't resolved and emit a relative href. Still true 2026-10-08, but the vault has no such link.
- **`[[Page#Heading]]` is unsupported** and renders as broken. Still true 2026-10-08, but the vault has no such link.

### Backlog: stricter Scripture checks (Joey, 2026-10-07, deprioritized)
Idea to chew on: fail the build on an impossible reference (a chapter beyond the book's last, found by a table of chapter counts), the way other content mistakes fail it. The corpus audit of 2026-10-07 found no false positives in the 22,901 auto-links; the one real mistake, `Pr 50:13–15` in `summary/The Pleasures of God.md`, has since been fixed in the vault. Single-chapter books (Jude, Phm, Ob, 2Jn, 3Jn) read a lone number as a chapter, not a verse. False positives are handled with the `!` opt-out, so no heuristics.

### Open questions for Joey (from the 2026-10-02 code review)
Delete a question once its answer has been acted on.

11. **`~text~` and small text** (Joey, 2026-10-02: no problems so far; open to ignoring stray tildes, and to a battle-tested syntax if CommonMark has one, but typing `<small>` is a non-starter). Idea: make a parenthetical on content pages small implicitly. A survey of `vault/` on 2026-10-02 found 502 parentheticals already wrapped in `~…~` on content pages and **101 bare ones** (notes pages are mostly bare, 994 vs 146, so the rule would be content pages only). Not a "very small number"; the bare ones are a mix, so the rule would need an opt-out.

## 3. Joey's backlog (pasted 2026-10-05)

Pasted 2026-10-05; audited against the code and the content repo on 2026-10-08 (finished items deleted). The colonoscopy gate starts on 2026-10-10; it is a start date for the check-in, not a deadline.

### Bugs
- **Color system review (2026-10-06).** Fixed: muted nav text, the search field now derives from the nav text and background (`--color-nav-text-muted` and `--color-nav-field-background`); `color-scheme: light dark`; light/dark `theme-color`; dark `mark` lightened with lifted link colors inside it. Also done (0.6.0): `--c` is 0.16 as the sRGB fallback and 0.25 / 0.17 under `@media (color-gamut: p3)`. Several hues still exceed sRGB at 0.16 and rely on the browser's gamut mapping; checkable by setting the Mac's display profile to sRGB. The stroke ladder is three steps (`thick`, `stroke`, `thin`). The brand-link rules no longer use `!important` (they win on specificity: `a.external[href^=…]`). The only `!important`s left are the `.visually-hidden` utility and the print stylesheet's plain-text links, on purpose.

### HTML/CSS review (Claude, 2026-10-06)
Findings from a read of `template/` and the generated pages (plus a scan of all 523 built pages), listed in the order I'd do them. Joey wants all of it done eventually. Line numbers are as of 2026-10-06; verify before acting. The contrast figures are hand-computed from the oklch values, so confirm them in a checker. The "Markup accessibility" and "Stylesheet tweaks" items elsewhere in this section overlap with this list; fold them in when working on either.

**A. Accessibility, small and mechanical** (done; the namespace menu is a labelled `role="group"`, and the nav's muted text clears 4.5:1 in both schemes)
- **Keep the hidden `<h2>`s before the two navs** (Joey, 2026-10-06): the markup should make sense without CSS (CSS Naked Day), and a hidden heading is visible there while an `aria-label` is not.

**B. Accessibility, needs a decision from Joey**
- **Links are underlined only on hover** (colour alone, about 3:1 against body text; dark mode weakest). Options: underline in running prose, or keep the bare style and accept the borderline WCAG 1.4.1 result.
- **Root font size is viewport-derived** (`html { font-size: clamp(0px, …, 22px) }`): ignores the user's default font size; at 200% browser zoom text grows only about 1.65×. A deliberate design, so it's a tradeoff. A percentage base plus a `vw` term would respect the preference. Also `clamp(0px, x, 22px)` is `min(x, 22px)`, and `-webkit-text-size-adjust: none` should be `100%`.
- `abbr { text-decoration: none }` hides the only cue that a title exists, and `title` doesn't work on touch. 11 pages had bare `<abbr>` on 2026-10-06 (recheck: the vault sources now contain only one) (used purely as a styling hook; a span class would be more honest).
- Tables: add captions (9 pages have an authored one; there's no syntax for it yet), and look at `th { width: 20% }`, which applies per cell. Each table now scrolls sideways in a `.table-scroll` wrapper (not keyboard-focusable, to avoid dozens of tab stops on the citation pages).
- CSS Naked: the deferred module script flashes styled content before it strips it; fixing that means a blocking script in the head.
- Heading levels skip on 101 pages (h1 → h3); authored content, since h3 carries the small-caps look. Decide whether to fix in content or style by class.
- Visual order differs from DOM order on desktop (header and sidebar are right of `main` but first in the DOM). Probably acceptable.

**C. Standards and correctness**
- Done 2026-10-07: the print stylesheet (see README → Print), checked by printing pages to PDF in headless Chrome.
- Decided not to change: the mobile footer's "· Colophon" middot is intentional (the two paragraphs inline, and the separator sets Colophon apart from the copyright). `img { width: 100% }` stays: no image in the vault is smaller than the column (checked 2026-10-07; the narrowest is 540px against a column of at most about 438px), and the home-page avatar is sized by its figure.
- Done 2026-10-07: `article` and `.css-naked-alert` use `min(var(--main-width), 100%)`, because `100vw` includes a classic scrollbar and narrow desktop windows scrolled sideways. Checked in headless Chrome with a forced 15px scrollbar (iframes from 320 to 500px wide).

**D. Head and load cost** (done 2026-10-07)
- The icon block is now three links: `favicon.ico`, `favicon-96x96.png` and the 180px touch icon (the other twelve files are deleted, as are `rel="shortcut icon"` and the `msapplication-*` tags). No SVG icon and no manifest: the feather is a Pro glyph (no standalone SVGs in the repo), and a manifest would need a new 512px render, only worth it if Joey wants the site installable on Android.
- `preconnect` added for the Typekit and Font Awesome origins.
- **Joey's to do:** Typekit's CSS declares `font-display: auto` (the browser's default, often invisible text for up to three seconds); I can't change that from here, so check the Adobe Fonts project's settings for a `swap` option. The Font Awesome kit uses `font-display: block`, which is right for icons. Font Awesome now offers limiting a kit to a subset of icons (the site uses five glyphs); pruning the kit needs no change in tsgen.

**E. CSS simplification** (done; checked by headless-Chrome screenshots, 3 widths × light/dark, against the baseline: pixel-identical apart from a half-pixel shift in one `h3` containing "I AM" and ±1 gradient dithering at the desktop column split)
- Kept on purpose (Joey, 2026-10-07): every hue token in `:root`, used or not, so they are ready to use. 
- Not done: head whitespace minification (gzip hides it).
- Small caps and numerals now use `font-variant-*`. Old-style figures are switched off in small caps (`font-variant-numeric: normal`), as the old `font-feature-settings` did by accident; drop those lines if you'd rather have old-style figures there.

### Font Awesome kit (2026-10-07)
Joey pruned the kit to a subset and the kit became an SVG-with-JavaScript kit (`"method":"js"`); its `.css` URL then returned a 19-byte stub and every icon disappeared. The layout now loads `kit.fontawesome.com/4a9f54cbf1.js` instead (hotfix 0.7.3, branched from v0.7.2). Watch for: icons appear a moment after the page paints (the script is deferred), and with JavaScript off the logo, search icon, star and the rest are absent (the search button is then an empty circle with its label). Icons in use: `feather-pointed`, `magnifying-glass`, `tags`, `star`, `pencil` and `person-digging` (Sharp Solid), and `mastodon` and `facebook` (Brands).

### Blacklist, `serve --show-hidden`, 404 (2026-10-07)
`CLAUDE.md`, `PLAN.md` and `README.md` (any folder, any case) are never read as Markdown. `tsgen serve --show-hidden` ignores `hidden`; problems that only a shown-hidden page causes are warnings. `404.md` is always `unlisted` in code, so `unlisted: true` can go from its frontmatter (still there 2026-10-08; Joey's file). (The alias/notes clash found while testing was fixed in the vault by Joey on 2026-10-07; the vault now builds with `--show-hidden` and no warnings.)

### Hero images and Open Graph (Joey, 2026-10-08)
Done (band-aid): every page without a hero of its own, and the home page, share `image/Trees-and-buildings.png` as `og:image` with a `summary_large_image` card (`fallbackHero` in `lib/html/describe.js`; the build fails if the file is missing). A notes page shares its page's hero (never its own opening image), else the fallback. The home page keeps its avatar on the page itself.

Backlog, lower priority: **deterministic hero assignment from a larger pool**, for `og:image` and perhaps for the visible hero of the page itself. It would replace the single fallback. Assign deterministically (for example a hash of the page path) so a page's card doesn't change between builds. Open: where the pool lives, and whether every page should show a hero or only some (Joey is undecided; don't build the visible part until he decides).

### Features Joey can develop himself
- **Stylesheet tweaks:** the search placeholder color is now derived from the nav tokens (done); still open to check: the search button's border color and the Search page's style.
- **`disambiguation` property.** Special handling, probably in the template only. Not implemented (nothing in `lib/` or `layout.ejs` reads it); the vault has one use (`topic/Sacrament.md`).
- **Social media links** in the sidebar or footer. (The Mastodon and Facebook icons are already used in `Home page.md`; the layout has none.)

### Features that might be easier with Claude
- **Statistics page.** Number of pages, Scripture citations, and what percent of the Bible is cited (possibly scarily low). Joey wants more ideas for what to include.
- **Table of contents**, maybe only on notes pages. It could double as the full book outline on commentary pages.
- **`aliases` parity with Obsidian.** Understand how Obsidian uses `aliases` and match it. Obsidian disallows wikilinks in `aliases`; tsgen optionally allows them. tsgen assumes all aliases sit in the same folder as the page; check whether Obsidian thinks about it that way or more subtly.
- **Aliases that cross namespaces** (Joey, 2026-10-05; eventually, not urgent). Today an alias redirects only inside its page's own folder (`/{relDir}/{alias}`). It would be nice for an alias to point at another namespace, for example the old root URLs `/otnt` and `/ntot` redirecting to `/reference/…`. No design yet: the frontmatter syntax, how the alphabetical index and wikilinks should treat such an alias (which namespace lists it?), and collisions with real pages there are all open. `OTNT` and `NTOT` have moved to `reference/` (titles set, files not renamed), and the old root URLs `/otnt` and `/ntot` simply 404 now, with no redirects.

### Crazypants future
- **Static book generator.**

## 4. The Replit docs (kept in `archive/`)

`README.md` carries the accurate reference. The Replit docs live in `archive/` **indefinitely** (Joey, 2026-10-08: they have proven useful for understanding why Replit Agent built a feature the way it did). Don't propose deleting them. Don't trust them either. The contents:
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
