# Tota Scriptura Static Site Generator

The bespoke static site generator for [totascriptura.org](https://totascriptura.org). It turns the site's Obsidian vault into a static HTML site for GitHub Pages. `build.js` is the entry point, the generator proper lives in `lib/`, and the layout, CSS and fonts live in `template/`.

This reference was written from the code as of October 2026. It replaces the Replit-era `archive/replit.md`. Where the two disagree, this file is the correct one.

## Running

The content repo installs tsgen as a git dependency and runs its `tsgen` command from the vault root:

```jsonc
// totascriptura.org/package.json
"scripts": { "build": "tsgen" },
"devDependencies": { "tsgen": "github:joeyday/tota-scriptura-static-site-generator#v0.3.3" }
```

Commands (run from the vault root):
- `tsgen` or `tsgen build`: build the site (what CI runs).
- `tsgen serve`: build, then serve the output at <http://localhost:4000/> and rebuild when the vault or `template/` changes. `serve.js` mimics GitHub Pages: `/foo/` serves `foo/index.html`, `/foo` redirects to `/foo/`, and unmatched URLs get `404.html` with a 404 status. It binds to localhost, and the port is 4000 unless `--port <n>` says otherwise. Unless you pass `--verbose` it prints only warnings, errors and the address it serves at (not the "Built …" and "processed …" lines `build` prints).
  - **Watching** (on by default; `--no-watch` serves the first build only): a change to a page, a data file (`.json`), an image or other asset, or a template file starts a rebuild after 2.5 s of quiet (`quietMs` in `lib/watch.js`; Obsidian saves a file more than once while you work, so a short wait rebuilds over and over), so a burst of saves is one build. A change that arrives during a build restarts that wait like any other; builds never overlap, and a change whose wait ends mid-build is rebuilt as soon as the build finishes. Each rebuild prints a `Changed: …` line naming the files that triggered it (the first five) and a `Rebuilt in … s.` line, with or without `--verbose`. Dot-folders (`.obsidian`, `.git`, `.claude`), the output folder, `node_modules`, and the never-built `CLAUDE.md`, `PLAN.md` and `README.md` are ignored. The whole site is rebuilt (about half a second) into a staging folder (`.dist-next` beside the output) and swapped in only if the build succeeds; if it fails, the error is printed and the last good site keeps serving. Served pages carry a small script that reloads them when a rebuild finishes (only while watching; the built site never has it). Changes to tsgen's own code need a restart.
- `tsgen serve --show-hidden`: the same, but the `hidden` property is ignored, so hidden pages build like any others (rough drafts, the sandbox page). Only `serve` takes the flag, so a deploy can't publish hidden pages. Problems that only a shown-hidden page causes (a broken link, a URL or alias clash) are warnings, not build errors. Flags can be combined: `tsgen serve --show-hidden --verbose --port 4001`.

For a local `tsgen` command, run `npm link` once in the tsgen repo. During tsgen development you can also run `cd vault && node ../build.js` (see `CLAUDE.md`).

The vault scan, `abbreviations.json`, `alt-text.json` are resolved from the **working directory**. Output goes to `./dist`, or to the directory named by the `TSGEN_OUT` environment variable if set. CI sets nothing; locally it keeps build output out of the iCloud-synced vault (for example `export TSGEN_OUT="$HOME/Projects/tsgen/out"` in `~/.zshrc`). The template is resolved from tsgen's own directory.

The output directory is emptied at the start of every build, so deleted pages don't linger. The build refuses to clear a directory that is, or contains, the vault.

Dependencies: `yaml` (frontmatter), `markdown-it`, `markdown-it-footnote`, `markdown-it-mark`, `markdown-it-container`, `markdown-it-bracketed-spans`, `markdown-it-attrs`, `ejs`, `slugify`. The search page loads `minisearch@7.2.0` from jsDelivr (pinned, with an SRI hash) at runtime.

## Inputs

`template/` (in tsgen) holds `layout.ejs` and the site's CSS and JS. Icons come from a Font Awesome Pro kit that the layout loads as a script (`kit.fontawesome.com/….js`, deferred): the kit swaps each `<span class="fa-…">` for an inline SVG, so the kit's own settings decide which icons exist. The Pro licence forbids publishing standalone copies of the SVGs, so they aren't self-hosted. `css-naked.js` removes the SVGs and the kit's `<style>` in naked mode. Text fonts come from Typekit. The three icons in `template/favicon/` (`favicon.ico`, a 96px PNG and the 180px touch icon) are rasterized from the Pro feather-pointed icon; the layout's head links exactly those. Its assets are copied to `dist/asset/` along with the vault's.

The rest come from the vault:

| Path | Required | Purpose |
|---|---|---|
| `**/*.md` | | Pages. Skipped directories: `node_modules`, `dist`, `.git`, `.github`, `.local`, `template`, and any dot-prefixed directory. Skipped files, in any folder and whatever their case: `CLAUDE.md`, `PLAN.md` and `README.md` (notes and docs that live beside the content; they are never pages, partials or errors). |
| `image/**/*.{png,jpg,jpeg,gif,svg,webp,avif,ico,bmp,css,js,eot,otf,ttf,woff,woff2}` | | Copied flat into `dist/asset/`, together with tsgen's own `template/` assets. Assets anywhere else in the vault are ignored. Names are flat in `dist/asset/`, so two files with the same name (compared case-insensitively) **fail the build**, listing both. |
| `abbreviations.json` | **yes** (a missing or malformed file fails the build) | `{ "term": "expansion" \| null }` |
| `alt-text.json` | **yes** (same) | `{ "image-basename.png": "alt text" }` |

## URLs

- **Slug**: the `permalink` frontmatter value (leading `/` stripped, otherwise used **verbatim**, not slugified), or else `slugify(filename, {lower, strict})`.
- **URL**: `/{relDir}/{slug}`. Folder names are used verbatim, keeping their case and spaces. Two non-hidden pages at one URL fail the build.
- **Folders**: Markdown may live only in the root, `topic/`, `category/`, `commentary/`, `summary/`, `reference/`, `partial/`, each of the others' `notes/` folders, and the root `notes/`. Markdown anywhere else fails the build. So does an iCloud placeholder (`.Name.md.icloud`), since the file isn't downloaded.
- **Notes pages**: a file in `notes/` (root) or `<folder>/notes/` is the notes page for the page of the same name in the parent folder. Its URL is the page's URL plus `/notes`: `topic/notes/Foo.md` is `/topic/foo/notes`, and the home page's notes are `/notes`. A `permalink` on a notes page is ignored. A notes page needs no page: with none, it still builds, at the URL the page would have, and its "Topic" link is greyed out. It is left out of the alphabetical index, the random pool and the Scripture index. Hide it with `hidden: true` like any page. So `/topic/foo` and `/topic/foo/notes` are reached from each other by adding or removing `/notes`.
- **Homepage**: a *root-level* file whose slug is `home` or `index` becomes `/`. In practice that means a file named `home.md`/`index.md` or `permalink: home`/`index`. (`permalink: ""` or `/` does **not** make a homepage: an empty permalink falls back to the slugified filename.)
- **404**: the URL `/404` is written to `dist/404.html` instead of `dist/404/index.html`. `404.md` is always `unlisted`, whatever its frontmatter says.
- Each page is written to `dist/{url}/index.html`. An empty `dist/.nojekyll` is always written.

## Frontmatter

Frontmatter is a YAML block between `---` lines at the very top of the file (`lib/frontmatter.js`, parsed with `yaml`). A file without one has none. A block that is never closed, or isn't valid YAML (or isn't a set of `key: value` pairs), fails the build, listing every offending file. That includes files in `partial/`, whose frontmatter is otherwise ignored.

Keys are lowercase (`title`, `featured with`). A key with any capital letter, such as `Title:`, fails the build, since it would otherwise be silently ignored. A `title` or `permalink` that is a number (`title: 1984`) is read as text; any other non-text value fails the build.

| Key | Effect |
|---|---|
| `title` | Display title. Defaults to the filename without `.md`. A notes page gets " notes" appended (`Trinity notes`) wherever its title appears: its heading, search, backlinks lists, alias redirect pages. A backlinks page is titled `{title} backlinks`. |
| `permalink` | URL slug (see above). |
| `description` | The page's meta and Open Graph description. Defaults to the first paragraph that has text, as plain text trimmed to about 160 characters at a word boundary; generated pages and placeholders get a site-wide default. Every page also carries `og:title`, `og:url` (`https://totascriptura.org` + the URL), `og:site_name` and `twitter:card`. When a content page body opens with an image embed (its hero), that image is the `og:image` and the card is `summary_large_image` (`summary` if the embed is square-ish). Every other page shares one fallback image, `image/Trees-and-buildings.png` (always `summary_large_image`): pages without a hero, generated pages, placeholders, and the **home page** (whose opening image is the avatar). A **notes page** shares its page's hero, never its own opening image (a diagram or map); with no page hero, or no page, it gets the fallback. The build fails if the fallback file is missing. |
| `hidden` | No page is generated. Hidden pages are left out of every index, search, the random pool, backlinks, notes links and categories, and their `aliases` write no redirect stubs. **Exception, a placeholder:** a hidden page that a published page links to by wikilink (links from hidden pages don't count, and neither do category membership or the generated tabs) builds as a placeholder at its URL: the title and an "under construction" notice (`fa-person-digging`, "This topic page is under construction."), `noindex`, none of its content. A placeholder is in no index, search, Scripture index or random pool, has no backlinks page and no alias redirects, and links to it get the `planned` class (pink, like `broken`). A hidden page nobody links to builds nothing. With `serve --show-hidden` the page builds and shows the notice "This topic page is hidden." (a notes page: "These notes are hidden.") in place of the draft notice, if it is also a draft. |
| `unlisted` | The page is built and links to it count as valid. It is left out of all index pages (including the Scripture index), search, the random pool, featured/featured-with, and category membership. It still takes part in notes links and backlinks. |
| `draft` | Listed on `/index/drafts`. Links to it get the `draft` class. The page shows "This topic page is a working draft." (the namespace varies; a notes page says "These notes are a working draft."). |
| `featured` | Listed on `/index/featured`. Gets a star on the alphabetical indexes. Links to it get the `featured` class. |
| `featured with` | Value is a page name or `[[wikilink]]`. Shown as "(and …)" after the target on `/index/featured`. Gets a star on the alphabetical index. |
| `categories` | A string or list of page names/`[[wikilinks]]`, each naming a page in `category/`, by basename or as `category/Name` (case-insensitive). A page in `category/` is a category page. A category with no listed members is made `unlisted` automatically, which can empty its parent category in turn. A name with no matching page logs a warning and renders as a broken link. |
| `aliases` | A string or list. Each alias writes a meta-refresh redirect at `/{relDir}/{slugify(alias)}`, is listed on its namespace's alphabetical index as "Alias (see Title)", and works as a wikilink target. If the page has a notes page, the alias also redirects `/{relDir}/{alias}/notes` to it, so a notes page has no aliases of its own (the build fails if it does). |

For all page-name values, `[[Page|Display]]` is reduced to `Page`.

## Link resolution

`resolveLink` is used for wikilinks and `featured with`:

1. If the target contains `/`, it is **path-qualified** and matches the file at exactly that path from the vault root, case-insensitively: `topic/Trinity`, `topic/notes/Trinity`. There is no suffix matching.
2. Otherwise the target is looked up in `fileMap`, which is keyed by the lowercased basename, the permalink, the alias name and the alias slug.
3. When several candidates match, notes pages are dropped unless nothing else matches. Then the candidate in the source page's own folder wins (a notes page counts as in its page's folder), then the one in `topic/`, then the one at the vault root. When a tiebreak decides, a warning asks you to qualify the link. If none applies, the result is ambiguous: the build fails (see Wikilinks).


## Per-page pipeline

For each non-hidden page, in order. Code (fenced blocks and inline code spans) is masked first, so steps 1–6 never touch it, and it is restored just before markdown-it. Indented code blocks are not recognised as code (four spaces is also how list items continue).

1. **Partials**: `{{name}}`, `{{[[name]]}}` and `{{name|arg1|arg2}}` are replaced by the body of `partial/name.md`. Only the `partial/` folder (flat, no subfolders) is consulted. The name is matched by basename, case-insensitively, with no path syntax, aliases or permalinks. Everything in `partial/` is a partial and never a page: no frontmatter is read from it (any that is present is stripped and ignored), it is not in the link maps, and it has no URL, alias redirects or backlinks. Inside the partial's text, `{{1}}`… are replaced by the arguments, unfilled ones become empty, `{{$args}}` becomes the arguments joined by `, `, and `{{$n}}` becomes the argument count. Partials are expanded recursively, and a circular partial is replaced by a comment with a warning. A `|` inside `[[…]]` does not split arguments. A bare numeric `{{3}}` anywhere becomes empty.
2. **Wikilinks**: `[[Target]]` and `[[Target|Text]]` become Markdown links. One that matches no page, or several, **fails the build** (all of them are listed, with the page that holds each), but only on pages that get published: a hidden page is never rendered, so a bad link there is ignored. Links inside `%%comments%%` and code are ignored. The link text is the raw inner text, not the target's title. A `.md` suffix is stripped. A leading `!` on a non-image wikilink is ignored. `#heading` fragments are not supported and produce a broken link.
   Image targets (by extension) are looked up in the asset map, by real path (`image/img.png`, which is what Obsidian's link picker inserts; `template/img.png` for tsgen's own) or by bare filename (`img.png`, always unique, see the asset table). An image that is in neither folder, or doesn't exist, **fails the build** like a broken page link (published pages only), listing each one with its page. Alt text and link text default to the bare file name.
   - `[[img.png]]` becomes a link.
   - `![[img.png]]` becomes `<figure><img alt="img.png"></figure>`.
   - `![[img.png|Alt]]` sets the alt text.
   - `![[img.png|300]]` and `|300x150` set the dimensions.
3. **EJS**: the whole page body is rendered as an EJS template with `frontmatter`, `fileMap` and `imageMap`. It is skipped when the body has no `<%`. If rendering fails, the build fails.
4. **Comments**: `%%…%%` is stripped right after the partials are expanded, before wikilinks and EJS, so a commented-out link or template tag does nothing.
5. **Small text**: `~text~` becomes `<small>`.
6. **Fenced-div attribute protection**: `::: {…}` attributes are protected from `markdown-it-attrs`.
7. **markdown-it**: rendered with `html`, `linkify`, `typographer`, footnotes, `==mark==`, `~~strike~~`, tables (each wrapped in a `<div class="table-scroll">` that scrolls sideways), bracketed spans `[text]{.cls}`, generic attributes `{.cls #id k=v}`, and containers. Every `:::` fence becomes a `<div>`: a bare one is a callout (`<div class="callout">`, centred text), and `::: a b` produces `class="a b"`, and `:::{.a .b #id k=v}` sets the full attribute set.
8. **Layout**: `template/layout.ejs` is rendered, then **link classification** runs on the whole page:
   - `http(s)` links get `external`, plus `bare-url` when the link text is the address itself (ignoring the scheme, `www.`, case and a trailing slash). Everything else gets `internal`.
   - Absolute paths (`/…`) can also get `draft`, `category`, `notes`, `featured`, `planned` and `broken`. A path is `broken` when it is not a known URL and not under `/index/`.
   - Only double-quoted `href`s are classified.

Steps 1–6 are plain regex passes over the raw Markdown, outside code.

### Print

`style.css` ends with a print stylesheet, and the layout's footer carries a print-only line, "Retrieved from {canonical URL} on {date}", above the copyright. `print.js` fills in the date when the page loads and again on `beforeprint`; without JavaScript the line leaves the date out. In print the page is the article and nothing else:
- The logo, both navs, the quick nav, the namespace menu, the search form, the featured star, the footnote back-links and the categories line are hidden, as is the footer's About/Colophon line.
- Links are plain text. An `external` link spells out its address in parentheses, except `bible-ref` links (Scripture references stay bare) and `bare-url` links (their text already is the address).
- Print is always light, even on a dark-mode machine (the dark colors apply to `screen` only). Colors are kept, and `print-color-adjust: exact` makes browsers print backgrounds (mark highlights, table headers) without the "background graphics" option.
- Headings follow a type scale: h3 keeps its size, h2 is one step up and h1 two, each step `--print-scale` (1.667) times the one below, so about 18pt and 31pt against the 11pt body.
- Callouts keep their screen width (the screen column is 1/0.044 rem, less the article's padding), so their text wraps at the same words.
- The type is a fixed 11pt in a full-width column with page margins of 1in above and below and 1.5in at the sides and page numbers (where the browser supports `@page` margin boxes). A heading stays with the text after it (including a "Main topic" line between them), and figures, blockquotes and table rows don't split across pages.

### Layout template variables

`frontmatter`, `bodyClasses`, `content`, `nsLabel`, `view`, `pageUrl`, `noteUrl`, `backlinksUrl`, `categories`, `subcategories`, `pages`, `featured`, `featuredWith` and `shownHidden` (true for a page that `serve --show-hidden` shows despite `hidden`).

- `bodyClasses`: the URL's path segments, or `["home"]` for `/`.
- `nsLabel`: the page's folder name, capitalised, plus " page" (`Topic page`, `Commentary page`), or `Meta page` for root pages. A notes page uses its page's folder. Generated pages have no Notes or Backlinks tab: the alphabetical, featured and Scripture indexes show a lone `Index page` tab, and search, random and backlinks pages have no page-actions nav at all.
- `view`: which tab is showing: `page`, `notes` or `backlinks` (null for generated pages other than backlinks, which show no Notes or Backlinks tab). `pageUrl` is the page's own URL (null for a notes page whose page doesn't exist or is hidden). `noteUrl` is the notes URL, or null. `backlinksUrl` is the page's backlinks page, or null when the page is missing or hidden.
- `categories`, `subcategories`, `pages`: arrays of `{title,url}`. `subcategories` holds members that are category pages, and `pages` holds the rest.
- `featured`: true only for `featured: true`.
- `featuredWith`: the raw page-name string, or null.

## Generated pages

- **Backlinks**: `/{url}/backlinks` (or `/backlinks` for `/`) for every non-hidden page that isn't a notes page. It lists the non-hidden pages whose wikilinks resolve to the page and, in a second section below, those that resolve to its notes page. The two sections get headings ("Links to the topic page", "Links to the notes"; the kind comes from the folder: topic, category, reference, … or meta for root pages) only when there is a notes section. An empty list says "No pages link to this topic page." Its Topic/Notes/Backlinks tabs match the page's and its notes page's, with Backlinks selected; a notes page's Backlinks tab points here. This is counted on partial-expanded Markdown with code and comments removed, before EJS. A page's links to itself are not counted.
- **Alias redirects**: written after the pages. The build fails if an alias would replace a page, or two aliases redirect the same URL to different pages.
- **Indexes**:
  - `/index/alphabetical/{namespace}`: one list per namespace, for `topic`, `commentary`, `summary`, `reference`, `meta` (the root) and `category`, in that order (also the order of the menu). Each lists that folder's pages that are not hidden, unlisted or notes pages, plus their aliases. A namespace with nothing listed has no page and no menu entry. Each list starts with a menu linking to the other namespaces' lists, on two lines (`Topics · Commentaries · Summaries`, then `Reference · Meta · Categories`); a line or entry with nothing listed is left out. `/index/alphabetical` is a stub that redirects to the Topic list.
  - `/index/categorical`: a flat list of top-level category pages only: category pages that are not hidden, not unlisted (so not empty) and not themselves in a category.
  - `/index/featured`
  - `/index/drafts`

  All lists are sorted ignoring a leading "A/An/The" and ignoring case.
- **Search**: `/search`, plus `dist/search.js` and `dist/search-index.json`. The index holds `{id,title,url,body}` for non-hidden, non-unlisted pages, with the body being the page's whole tag-stripped text. Searches use MiniSearch with prefix matching, fuzzy 0.2 and a 2× title boost. The `?q=` parameter stays in sync with the search box.
- **Random**: `/random` redirects on the client to a random page from the alphabetical-index pool, minus the `category`, `meta` and `reference` namespaces. Its body (a Proverbs 16:33 quotation) is hardcoded.
- **Scripture index**: `/index/scripture` lists the referenced books. `/index/scripture/{book-slug}` is a `<dl>` with one `<dt>` per unique reference, which links to each page or section where that reference appears. References come from content pages, in any namespace except `reference` (whose pages are long citation tables); unlisted pages, category pages and notes pages are left out. Meta (root) pages are included.
- **Statistics**: `/statistics`, the first generated page in the `meta` namespace (it is in `/index/alphabetical/meta` and linked from the sidebar, with the lone `Meta page` tab). Everything on it is counted from structures the build already holds, with no extra pass over the files: counts by namespace, drafts, featured, aliases; words (totals, longest and shortest pages, the most used words, the divine names, Greek and Hebrew words); links (most linked to, pages nothing links to); categories; the headings, tables, footnotes and so on on the pages, and page weight; and Scripture: references, books, chapters and verses cited, the most cited books, chapters and verses, records, a table by book and a heatmap of all 1,189 chapters (each book takes the next theme color in hue order, pink last, looping after twelve books; the legend stays the primary green). The output is deterministic: no dates or timings, only the tsgen version and the content commit. Hidden and unlisted pages are not counted anywhere, and there are no figures about them. The words, links, categories and page figures count the listed pages and their notes; the Scripture figures count exactly the references the Scripture index lists, so notes pages, reference pages and categories are left out of them. Verse coverage uses `lib/bible/versification.js`, the Protestant numbering (1,189 chapters, 31,102 verses). A chapter is *cited* when any citation touches it; a verse is *cited* only when a citation names it, on its own or in a range of fifteen verses or fewer (`MAX_CITED_RANGE` in `lib/stats.js`), so `Romans 5` cites the chapter but none of its verses, `Romans 12:1–15:13` cites its chapters but not its verses, and `Romans 5:1` cites both. The computation is `lib/stats.js`, the page `lib/pages/statistics.js`; it adds about 26 ms to a build of about 500 ms.

## Post-processing (every `.html` under `dist/`, in order)

1. **Heading IDs**: every `<h2>`/`<h3>` without an `id` gets one, using slugified text (HTML entities such as `&amp;` decoded first, so `Faith & Works` is `faith-and-works`) and `-2`, `-3`… for duplicates. Existing IDs are kept and reserved first.
2. **Scripture collection and index generation**: see above. The index pages then get heading IDs and go through the remaining passes. Collection and step 3 are one pass (`lib/bible/process.js`): each text run is scanned for references once (`scan.js`), then linked, and on content pages collected.
3. **Bible reference linker**: turns references into `<a class="external bible-ref" href="https://ref.ly/{Abbr}{ch}[.{v}[-{v2}|-{ch2}.{v2}]|-{ch2}];{TRANS}">`.
   - Books are matched by full name or abbreviation, **case-sensitively** (`Ro 3:23`, not `ro 3:23`). A numbered book's abbreviation has **no space** after the number (`1Jn 2:2`, `2Ki 5`); `1 Jn 2:2` and `2 Ki 5` aren't references and don't link (`Jn` after a lone `1`, `2` or `3` and a space isn't read as John either). The full names (`1 John`, `2 Kings`) take the space. The abbreviations come from the last entry of each book's `names` list in `BIBLE_BOOKS`.
   - Formats: `Book ch`, `Book ch–ch`, `Book ch:v`, `Book ch:v–v`, `Book ch:v–ch:v`. A hyphen, a spaced hyphen or an em dash in a range is shown as an en dash in the link text (`Jn 3:16-18` reads `Jn 3:16–18`); an opted-out reference (`!Jn 3:16-18`) is left exactly as written.
   - Books of one chapter (Obadiah, Philemon, 2 John, 3 John, Jude) are written in full: `Phm 1:3` is verse 3 and `Phm 1:3–5` verses 3–5, and `Phm 1` is the whole letter. A lone number is a chapter, so `Phm 3` is chapter 3, which doesn't exist and fails the build (see below). They are shown without the chapter: `Phm 1:3` reads `Phm 3`, `Phm 1:3–5` reads `Phm 3–5`, and `Phm 1` or `Philemon 1` reads just `Phm` or `Philemon`, still linked to the whole chapter. A bare number after such a reference is a verse (`Jude 1:3, 5`). The links are always explicit (`Phm1.3`, `Phm1`), and the Scripture index lists the same entries.
   - **A reference that can't exist fails the build**, like a broken wikilink: a chapter or verse its book doesn't have (`Romans 17`, `Isaiah 16:40`, `Phm 3`), a range that runs backwards (`Jn 3:18–16`), or a number that is really something else read as a continuation (`Romans 12:1–15:13, 71 verses` reads the 71 as Romans 12:71). Every one is listed with its page and the reason, and a one-chapter book gets a hint on how to write the verse. It is checked against `lib/bible/versification.js` (the verse count of every chapter). Only published pages count: a hidden page is never rendered, and a page shown by `serve --show-hidden` only warns. A `!` before a reference opts it out (`!Romans 17` is plain text); a continuation can't be opted out, so reword it.
   - Continuations: after `;` or `,` with only whitespace in between, `ch:v` or a bare number carries the current book forward. What a bare number means depends on the reference before it:
     - after a chapter-level reference (`Romans 3`, `Romans 3–5`), it is a chapter, or a range of chapters: `Romans 3, 5` is chapters 3 and 5 (two links), `Romans 3, 5–7` is chapter 3 and chapters 5–7. A further bare number stays at chapter level (`Romans 3, 5, 7`), until a `ch:v` returns to verses.
     - after a reference with a verse (`Romans 3:16, 18`, and `Romans 3:16; 5` too), it is a verse in the last chapter.
     - a `1`, `2` or `3` followed by a capitalized word is the start of a numbered book (`; 1 Tim 3:3`), not a continuation.
   - Translation: an `ESV|KJV|NASB|NIV|NKJV|NLT|NRSV` that directly follows a named reference and its continuations (only whitespace in between, as in `Jn 3:16; 5:24 KJV`) applies to all of them. Any word or punctuation in between, such as `Jn 3:16 (KJV)`, means it isn't about that reference. ESV is the default. The translation is moved inside the last link.
   - A reference prefixed with `!` is not linked.
   - Skipped inside `a`, `code`, `pre`, `script`, `style` and `h1`–`h6`. Context resets at block tags.
   - In the link text, spaces become non-breaking spaces and range dashes become en-dashes.
4. **Abbreviations**: each `abbreviations.json` key becomes `<abbr title="…">`, or a plain `<abbr>` when the value is null. Matching is case-sensitive and longest-first. There is always a leading `\b`, and a trailing `\b` only when the key ends in a word character. Skipped inside `abbr`, `code`, `pre`, `script`, `style`. Anchors are *not* skipped.
5. **Initials**: two or more consecutive `X.` (for example `C.S.`) become `<abbr>`. Same skip list as abbreviations.
6. **Roman numerals**: valid uppercase numerals of two or more letters, and dotted pairs like `X.III`, become `<span class="roman-num">`. Same skip list.
7. **Divine names**: `LORD`, `GOD`, `YHWH`, `I AM` (+ ` THAT/WHAT/WHO I AM`) and `I WILL BE` (+ the same suffixes) become `<span class="divine-name">`. In each, the letters `G`, `L` and a standalone `I` are wrapped in `<span class="divine-name-initial">`, so `YHWH` gets no initial span. Same skip list.
8. **Spaced ellipses**: `. . .` becomes `.&nbsp;.&nbsp;.` (with a leading `&nbsp;` when preceded by whitespace). This applies everywhere in the file, with no skip list.
9. **Alt text**: an `<img>` whose `src` basename is a key in `alt-text.json` gets its `alt` set or replaced. Matching is case-sensitive.

These passes run over the **entire** HTML file, including `<head>`, except the `<title>` element, which is set aside first and put back untouched (it is plain text, so no pass may put markup in it).
