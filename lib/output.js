import fs from "fs/promises";
import path from "path";
import { BuildError } from "./errors.js";
import { createWriter } from "./io.js";
import { processBibleRefs } from "./bible/process.js";
import {
  addHeadingIds,
  applyAltText,
  fixSpacedEllipses,
  makeAbbreviationWrapper,
  wrapDivineNames,
  wrapInitials,
  wrapRomanNumerals,
} from "./html/passes.js";
import { info } from "./log.js";

// Reads a required JSON object of { key: value } from the working directory.
async function loadJsonMap(file) {
  let data;
  try {
    data = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch (err) {
    throw new BuildError(
      err.code === "ENOENT" ? `${file} not found` : `${file} is not valid JSON`,
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new BuildError(`${file} must be a JSON object`);
  }
  return data;
}

// Every HTML file goes through the post-passes in memory and is written once.
// Heading IDs come first so the Scripture collector can link to sections; the
// collector runs before the Bible-ref linker, which would hide the refs inside
// <a> tags.
//
//   emit(url, html)             any generated page, at the file its URL maps to
//   emitPage(url, html, from, source)
//                               a content page; from is { url, title } if its
//                               Bible refs belong in the Scripture index
//   writeFile(relPath, data)    any other file under the output directory
//   fileFor(url)                the file a URL is written to
//   refs                        the collected refs
//   finish()                    waits for the writes, logs the pass counts
export async function createOutput({ outputDir }) {
  const abbrMap = await loadJsonMap("abbreviations.json");
  const altMap = await loadJsonMap("alt-text.json");
  const wrapAbbreviations =
    Object.keys(abbrMap).length > 0 ? makeAbbreviationWrapper(abbrMap) : null;
  const useAlt = Object.keys(altMap).length > 0;

  const writer = createWriter();
  const refs = [];
  const referenceProblems = []; // references that can't exist: they fail the build
  const referenceWarnings = []; // the same, on pages shown by serve --show-hidden
  let files = 0;
  let pages = 0;
  const rewrites = {};

  // /foo is written to foo/index.html; / to index.html. GitHub Pages serves
  // 404.html as the custom 404 page.
  function fileFor(url) {
    if (url === "/404") return path.join(outputDir, "404.html");
    const dir = url === "/" ? outputDir : path.join(outputDir, url.substring(1));
    return path.join(dir, "index.html");
  }

  // The <title> is plain text; the passes would put markup in it (a span in a
  // tab title). Park it behind a comment, which every pass already skips.
  const TITLE_RE = /<title>[\s\S]*?<\/title>/i;
  const TITLE_SLOT = "<!--tsgen-title-->";

  // `source` is { name, warnOnly } for a content page: the name its problems are
  // reported under, and whether they only warn (pages shown by serve --show-hidden).
  async function process(url, html, collectFrom, source) {
    const title = TITLE_RE.exec(html)?.[0];
    let out = title ? html.replace(TITLE_RE, TITLE_SLOT) : html;
    const pass = (name, fn) => {
      const next = fn(out);
      if (next !== out) rewrites[name] = (rewrites[name] ?? 0) + 1;
      out = next;
    };
    pass("Heading IDs", addHeadingIds);
    pass("Bible ref linker", (h) => {
      const result = processBibleRefs(h, collectFrom);
      refs.push(...result.refs);
      const found = source?.warnOnly ? referenceWarnings : referenceProblems;
      for (const problem of result.problems) found.push(`"${source?.name ?? url}": ${problem}`);
      return result.html;
    });
    if (wrapAbbreviations) pass("Abbreviation expander", wrapAbbreviations);
    pass("Initials wrapper", wrapInitials);
    pass("Roman numeral wrapper", wrapRomanNumerals);
    pass("Divine name wrapper", wrapDivineNames);
    pass("Ellipsis normaliser", fixSpacedEllipses);
    if (useAlt) pass("Alt text injector", (h) => applyAltText(h, altMap));
    if (title) out = out.replace(TITLE_SLOT, () => title);
    files++;
    await writer.write(fileFor(url), out);
  }

  return {
    refs,
    referenceProblems,
    referenceWarnings,
    fileFor,
    emit: (url, html) => process(url, html, null, null),
    emitPage(url, html, collectFrom, source) {
      pages++;
      return process(url, html, collectFrom, source);
    },
    writeFile: (relPath, data) => writer.write(path.join(outputDir, relPath), data),
    pageCount: () => pages,
    async finish() {
      await writer.flush();
      for (const [name, count] of Object.entries(rewrites)) {
        info(`${name}: processed ${files} HTML file(s), rewrote ${count}.`);
      }
    },
  };
}
