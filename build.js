#!/usr/bin/env node
import { execFileSync } from "child_process";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import slugify from "slugify";
import { BuildError } from "./lib/errors.js";
import { createLayout } from "./lib/layout.js";
import { info, setVerbose } from "./lib/log.js";
import { findCategory } from "./lib/links.js";
import { backlinksUrlFor, buildModel, nsName } from "./lib/model.js";
import { createOutput } from "./lib/output.js";
import { writeBacklinksPages } from "./lib/pages/backlinks.js";
import { writeIndexes } from "./lib/pages/indexes.js";
import { writeRandom } from "./lib/pages/random.js";
import { writeAliasRedirects } from "./lib/pages/redirects.js";
import { writeScriptureIndex } from "./lib/pages/scripture.js";
import { writeSearch } from "./lib/pages/search.js";
import { writeStatistics } from "./lib/pages/statistics.js";
import { computeStatistics, countWords, measureHtml } from "./lib/stats.js";
import { describe, fallbackHero, findHero } from "./lib/html/describe.js";
import { renderBody } from "./lib/render.js";
import { createWatcher } from "./lib/watch.js";
import { ASSET_EXTENSIONS, NEVER_PAGES, copyAssets, loadVault } from "./lib/vault.js";

// The vault (content) is the working directory; the template ships with tsgen.
// Output goes to ./dist unless TSGEN_OUT names another directory (local use
// only, e.g. to keep build output out of the iCloud-synced vault; CI sets nothing).
const OUTPUT_DIR = process.env.TSGEN_OUT
  ? path.resolve(process.env.TSGEN_OUT)
  : "dist";
const TEMPLATE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "template",
);
const TEMPLATE_PATH = path.join(TEMPLATE_DIR, "layout.ejs");

// ─── Cache-buster ───
// The content repo's commit (CI sets GITHUB_SHA; locally, the vault's HEAD), so
// assets are refetched exactly when a deploy changes something. Without a repo,
// one timestamp for the whole build.
function cacheBuster() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return String(Math.floor(Date.now() / 1000));
  }
}

// "This topic page is under construction." (notes pages: "These notes are …")
const plannedNotice = (fileInfo) =>
  `<div class="message"><p><span class="fa-sharp fa-solid fa-person-digging"></span> <em>${
    fileInfo.isNote
      ? "These notes are"
      : `This ${nsName(fileInfo.nsDir || "meta").toLowerCase()} page is`
  } under construction.</em></p></div>`;

// Every build starts from an empty output directory, so pages deleted from the
// vault don't linger. Refuses a directory that is the vault or holds it.
async function cleanOutputDir(dir) {
  const rel = path.relative(path.resolve(dir), process.cwd());
  if (rel === "" || !(rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new BuildError(
      `Refusing to clear "${path.resolve(dir)}": it holds the vault. Point TSGEN_OUT somewhere else.`,
    );
  }
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function build({ showHidden = false, outputDir = OUTPUT_DIR } = {}) {
  await cleanOutputDir(outputDir);

  const imageMap = await copyAssets({
    outputDir,
    templateDir: TEMPLATE_DIR,
  });
  const { fileMap, partials, filesToProcess, index, aliasRedirects } =
    await loadVault({ outputDir, showHidden });

  const {
    membersMap,
    featuredPages,
    draftPages,
    featuredWithMap,
    notesByPage,
    pageByNotes,
    allKnownUrls,
    draftUrls,
    featuredUrls,
    categoryUrls,
    notesUrls,
    alphabeticalByNs,
    listedNamespaces,
    backlinksMap,
    plannedUrls,
  } = buildModel({ filesToProcess, index, fileMap, partials, imageMap, aliasRedirects });

  const commit = cacheBuster();
  const renderLayout = createLayout({
    template: await fs.readFile(TEMPLATE_PATH, "utf-8"),
    draftUrls,
    categoryUrls,
    notesUrls,
    featuredUrls,
    plannedUrls,
    allKnownUrls,
    fallbackHero: fallbackHero(imageMap),
    cacheBust: commit,
  });

  const searchDocs = [];
  const pageStats = []; // per published page, for /statistics
  const linkProblems = [];
  const draftLinkProblems = []; // from pages that --show-hidden shows: warnings only

  const output = await createOutput({ outputDir });

  // A hidden page that a published page links to builds as a placeholder: its
  // title and a notice, nothing else. It stays out of the Scripture index,
  // search and every list, and has no backlinks page.
  const emitPlaceholder = (fileInfo) =>
    output.emitPage(
      fileInfo.finalUrlPath,
      renderLayout(plannedNotice(fileInfo), {
        url: fileInfo.finalUrlPath,
        frontmatter: { title: fileInfo.title, planned: true },
        nsLabel: `${nsName(fileInfo.nsDir || "meta")} page`,
        view: fileInfo.isNote ? "notes" : "page",
        pageUrl: fileInfo.isNote ? pageByNotes[fileInfo.finalUrlPath] : fileInfo.finalUrlPath,
        noteUrl: notesByPage[fileInfo.finalUrlPath] || null,
      }),
      null,
    );

  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) {
      if (plannedUrls.has(fileInfo.finalUrlPath)) {
        await emitPlaceholder(fileInfo);
      }
      continue;
    }

    const htmlContent = renderBody(fileInfo, {
      partials,
      fileMap,
      index,
      imageMap,
      problems: fileInfo.shownHidden ? draftLinkProblems : linkProblems,
    });

    const resolvedCategories = fileInfo.categories.map((catName) => {
      const target = findCategory(index, catName);
      return target
        ? { title: target.title, url: target.finalUrlPath }
        : {
            title: catName,
            url: `/${slugify(catName, { lower: true, strict: true })}`,
          };
    });

    const allMembers = membersMap[fileInfo.finalUrlPath] || [];
    const subcategories = [];
    const pages = [];
    for (const member of allMembers) {
      if (categoryUrls.has(member.url)) {
        subcategories.push(member);
      } else {
        pages.push(member);
      }
    }

    // The page itself, for a notes page's "Topic page" tab (null when its page is missing or hidden).
    const pageUrl = fileInfo.isNote
      ? pageByNotes[fileInfo.finalUrlPath]
      : fileInfo.finalUrlPath;

    const heroOf = (page) =>
      page && page.finalUrlPath !== "/"
        ? findHero(page.parsed.content, imageMap)
        : null;

    // A notes page shares its page's hero, never its own opening image (a diagram,
    // a map). The home page never shares its avatar. No hero: the fallback.
    const hero = heroOf(pageUrl && index.byUrl[pageUrl]);

    const finalHtml = renderLayout(htmlContent, {
      url: fileInfo.finalUrlPath,
      frontmatter: fileInfo.parsed.data,
      // The frontmatter's `description`, else the first paragraph with text.
      description:
        String(fileInfo.parsed.data.description || "").trim() || describe(htmlContent),
      hero,
      // The page's folder names its namespace: "topic" → "Topic page". Root pages: "Meta page".
      nsLabel: `${nsName(fileInfo.nsDir || "meta")} page`,
      view: fileInfo.isNote ? "notes" : "page",
      pageUrl,
      noteUrl: notesByPage[fileInfo.finalUrlPath] || null,
      backlinksUrl: pageUrl && !fileInfo.hidden ? backlinksUrlFor(pageUrl) : null,
      categories: resolvedCategories,
      subcategories,
      pages,
      featuredWith: fileInfo.featuredWith || null,
      featured: fileInfo.featured || false,
      shownHidden: fileInfo.shownHidden || false,
    });

    const outFilePath = output.fileFor(fileInfo.finalUrlPath);
    // Notes pages, category pages, reference pages (long citation tables) and
    // unlisted pages stay out of the Scripture index, and out of the Scripture
    // statistics, which count the same references.
    const collected = !(
      fileInfo.unlisted ||
      fileInfo.relDir === "reference" ||
      categoryUrls.has(fileInfo.finalUrlPath) ||
      notesUrls.has(fileInfo.finalUrlPath)
    );
    await output.emitPage(
      fileInfo.finalUrlPath,
      finalHtml,
      collected ? { url: fileInfo.finalUrlPath, title: fileInfo.title } : null,
      { name: fileInfo.filePath, warnOnly: !!fileInfo.shownHidden },
    );
    info(
      `Built: ${fileInfo.filePath} -> ${outFilePath} (URL: ${fileInfo.finalUrlPath})`,
    );

    let words = 0;
    if (!fileInfo.unlisted) {
      const bodyText = htmlContent
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      words = countWords(bodyText);
      searchDocs.push({
        id: fileInfo.finalUrlPath,
        title: fileInfo.title,
        url: fileInfo.finalUrlPath,
        body: bodyText,
      });
    }
    pageStats.push({
      title: fileInfo.title,
      url: fileInfo.finalUrlPath,
      ns: fileInfo.nsDir || "meta",
      isNote: !!fileInfo.isNote,
      listed: !fileInfo.unlisted,
      words,
      bytes: Buffer.byteLength(finalHtml),
      ...measureHtml(htmlContent),
    });
  }

  // Hidden pages are never rendered, so a bad link there doesn't count. Shown ones
  // (--show-hidden) only warn.
  for (const problem of draftLinkProblems) console.warn(`Warning: ${problem}`);
  for (const problem of output.referenceWarnings) console.warn(`Warning: ${problem}`);
  // A reference to a chapter or verse its book doesn't have (a typo, or a number
  // read as a verse) fails the build like a broken link; `!` opts a reference out.
  const failures = [];
  if (linkProblems.length > 0) {
    failures.push(`Broken links in published pages:\n${linkProblems.join("\n")}`);
  }
  if (output.referenceProblems.length > 0) {
    failures.push(
      `Scripture references that can't exist (write a ! before one to opt it out):\n${output.referenceProblems.join("\n")}`,
    );
  }
  if (failures.length > 0) throw new BuildError(failures.join("\n\n"));

  await writeAliasRedirects({ output, aliasRedirects });

  await writeBacklinksPages({
    output,
    renderLayout,
    filesToProcess,
    backlinksMap,
    notesByPage,
  });
  await writeIndexes({
    output,
    renderLayout,
    filesToProcess,
    listedNamespaces,
    alphabeticalByNs,
    featuredPages,
    draftPages,
    featuredWithMap,
  });
  await writeSearch({ output, renderLayout, searchDocs });
  await writeRandom({ output, renderLayout, listedNamespaces, alphabeticalByNs });
  await output.writeFile(".nojekyll", "");
  await writeScriptureIndex({ output, renderLayout });
  await writeStatistics({
    output,
    renderLayout,
    stats: computeStatistics({
      pages: pageStats,
      bodies: searchDocs,
      filesToProcess,
      refs: output.refs,
      backlinksMap,
      membersMap,
      alphabeticalByNs,
      notesByPage,
      imageMap,
      version: JSON.parse(
        await fs.readFile(new URL("./package.json", import.meta.url), "utf-8"),
      ).version,
      commit: /^[0-9a-f]{7,}$/.test(commit) ? commit : "a local build",
    }),
  });

  // Generated pages are written after the check above; they hold only references
  // that came from checked pages, so this should never fire.
  if (output.referenceProblems.length > 0) {
    throw new BuildError(
      `Scripture references that can't exist:\n${output.referenceProblems.join("\n")}`,
    );
  }

  await output.finish();
}

// ─── Watching ─────────────────────────────────────────────────────────────────
// serve rebuilds (the whole site, which takes about half a second) when the vault
// or the template changes. A rebuild goes into a staging directory and replaces the
// served one only when it succeeds, so a mistake that fails the build leaves the
// last good site up. Pages open in a browser then reload themselves.

const STAGE_DIR = path.join(path.dirname(OUTPUT_DIR), `.${path.basename(OUTPUT_DIR)}-next`);
const OLD_DIR = path.join(path.dirname(OUTPUT_DIR), `.${path.basename(OUTPUT_DIR)}-old`);

// Files that can change the site: pages, data, assets (and the template's layout).
const WATCHED_EXTENSIONS = new Set([".md", ".json", ".ejs", ...ASSET_EXTENSIONS]);

function isSiteFile(relPath, skipNames) {
  const parts = relPath.split("/");
  if (parts.some((p) => p.startsWith(".") || skipNames.has(p))) return false;
  if (NEVER_PAGES.has(parts[parts.length - 1].toLowerCase())) return false;
  return WATCHED_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

function watchAndRebuild({ showHidden, reloadPages }) {
  let building = false;

  // A rebuild always says what started it and how long it took (the other build
  // output is verbose-only), so a rebuild nobody asked for can be traced.
  async function rebuild(files) {
    if (building) {
      // The quiet period ended while a build was still running: those changes wait
      // out a fresh quiet period instead of starting a build the moment this one ends.
      watcher.notify(files);
      return;
    }
    const shown = files.slice(0, 5).join(", ");
    console.log(`Changed: ${shown}${files.length > 5 ? ` and ${files.length - 5} more` : ""}`);
    building = true;
    const started = performance.now();
    try {
      await build({ showHidden, outputDir: STAGE_DIR });
      await fs.rm(OLD_DIR, { recursive: true, force: true });
      await fs.rename(OUTPUT_DIR, OLD_DIR);
      await fs.rename(STAGE_DIR, OUTPUT_DIR);
      await fs.rm(OLD_DIR, { recursive: true, force: true });
      console.log(`Rebuilt in ${((performance.now() - started) / 1000).toFixed(2)} s.`);
      reloadPages();
    } catch (err) {
      console.error(
        "Build failed (still serving the last good build):",
        err instanceof BuildError ? err.message : err,
      );
    } finally {
      building = false;
    }
  }

  const watcher = createWatcher({ onChange: rebuild });

  const outputNames = new Set(["dist", "node_modules", path.basename(OUTPUT_DIR)]);
  watcher.watch(".", (rel) => isSiteFile(rel, outputNames));
  watcher.watch(TEMPLATE_DIR, (rel) => isSiteFile(rel, new Set()));

  // The staging directories are dot-folders inside the vault; don't leave them behind.
  const cleanUp = () => {
    watcher.stop();
    fsSync.rmSync(STAGE_DIR, { recursive: true, force: true });
    fsSync.rmSync(OLD_DIR, { recursive: true, force: true });
  };
  process.on("SIGINT", () => {
    cleanUp();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanUp();
    process.exit(0);
  });
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
// tsgen [build]     build the site (what CI runs)
// tsgen serve       build, then serve the output locally (see serve.js) and rebuild
//                   whenever the vault or the template changes, with:
//   --show-hidden   build pages marked `hidden` too, for previewing rough drafts.
//                   Only serve takes it, so a deploy can't publish them by accident.
//   --verbose       print every "Built …" line; without it serve prints only warnings,
//                   errors and the address it serves at.
//   --port <n>      serve on port n instead of 4000 (also --port=n).
//   --no-watch      serve the first build without rebuilding on changes.

const USAGE =
  "Usage: tsgen [build | serve [--show-hidden] [--verbose] [--no-watch] [--port <n>]]";
const [command = "build", ...args] = process.argv.slice(2);
let showHidden = false;
let verbose = false;
let watching = true;
let port;
let usageOk = command === "build" || command === "serve";
for (let i = 0; usageOk && i < args.length; i++) {
  const [flag, inlineValue] = args[i].split(/=(.*)/s);
  if (command !== "serve") usageOk = false;
  else if (flag === "--show-hidden" && inlineValue === undefined) showHidden = true;
  else if (flag === "--verbose" && inlineValue === undefined) verbose = true;
  else if (flag === "--no-watch" && inlineValue === undefined) watching = false;
  else if (flag === "--port") {
    const value = inlineValue ?? args[++i];
    port = Number(value);
    if (!/^\d+$/.test(value ?? "") || port < 1 || port > 65535) usageOk = false;
  } else usageOk = false;
}
if (!usageOk) {
  console.error(USAGE);
  process.exit(1);
}
setVerbose(command === "build" || verbose);
if (showHidden) console.log("Showing hidden pages (--show-hidden).");

try {
  await build({ showHidden });
} catch (err) {
  console.error("Build failed:", err instanceof BuildError ? err.message : err);
  process.exit(1);
}

if (command === "serve") {
  try {
    const { serve } = await import("./serve.js");
    const { reloadPages } = await serve(OUTPUT_DIR, port, { watching });
    if (watching) watchAndRebuild({ showHidden, reloadPages });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
