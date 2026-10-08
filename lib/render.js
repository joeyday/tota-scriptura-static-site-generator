import path from "path";
import ejs from "ejs";
import { BuildError } from "./errors.js";
import { escHtml } from "./html/escape.js";
import { resolveLink } from "./links.js";
import { md, protectFencedAttrs } from "./markdown.js";
import { prepareSource } from "./source.js";
import { IMAGE_EXTENSIONS } from "./vault.js";

// Renders one page's Markdown source to HTML (no layout): partials, wikilinks,
// body EJS, small text, then markdown-it. These are plain text passes over the
// raw Markdown; code spans and blocks are masked so they stay literal.
// A wikilink that resolves to no page (or to several) is pushed onto `problems`;
// the caller fails the build, since only published pages are rendered.
export function renderBody(fileInfo, { partials, fileMap, index, imageMap, problems }) {
  // The one place a page's partial problems are reported (the backlinks pre-pass
  // expands the same source silently).
  const source = prepareSource(fileInfo.parsed.content, partials, (problem) =>
    console.warn(`Warning: "${fileInfo.filePath}": ${problem}`),
  );
  let markdownContent = source.text;

  markdownContent = markdownContent.replace(
    /(!?)\[\[(.*?)\]\]/g,
    (match, bang, inner) => {
      const isEmbed = bang === "!";
      let target = inner;
      let text = inner;
      if (inner.includes("|")) {
        const parts = inner.split("|");
        target = parts[0];
        text = parts.slice(1).join("|");
      }

      let searchTarget = target.trim();

      const ext = path.extname(searchTarget).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        const imgUrl = imageMap[searchTarget.toLowerCase()] || searchTarget;
        if (isEmbed) {
          let attrs = "";
          const dimMatch = text.match(/^(\d+)(?:x(\d+))?$/);
          if (dimMatch) {
            attrs += ` width="${dimMatch[1]}"`;
            if (dimMatch[2]) attrs += ` height="${dimMatch[2]}"`;
            return `<figure><img src="${escHtml(imgUrl)}" alt="${escHtml(searchTarget)}"${attrs}></figure>`;
          }
          const alt = text === inner ? searchTarget : text;
          return `<figure><img src="${escHtml(imgUrl)}" alt="${escHtml(alt)}"></figure>`;
        } else {
          const linkText = text === inner ? searchTarget : text;
          return `[${linkText}](${imgUrl})`;
        }
      }

      if (searchTarget.toLowerCase().endsWith(".md")) {
        searchTarget = searchTarget.substring(0, searchTarget.length - 3);
      }

      const resolved = resolveLink(searchTarget, fileMap, index, fileInfo.nsDir);
      if (resolved.shadowed) {
        console.warn(
          `Warning: Bare wikilink "${searchTarget}" in "${fileInfo.filePath}" matches several pages — using ${resolved.url}; qualify it`,
        );
      }
      if (resolved.url) {
        return `[${text}](${resolved.url})`;
      }
      problems.push(
        resolved.ambiguous
          ? `"${fileInfo.filePath}": [[${searchTarget}]] matches several pages; qualify it`
          : `"${fileInfo.filePath}": [[${searchTarget}]] matches no page`,
      );
      return `<span class="broken">${text}</span>`;
    },
  );

  // Only pages with template tags pay for EJS. A broken template fails the
  // build rather than publishing a blank page.
  if (markdownContent.includes("<%")) {
    try {
      markdownContent = ejs.render(markdownContent, {
        frontmatter: fileInfo.parsed.data,
        fileMap,
        imageMap,
      });
    } catch (err) {
      throw new BuildError(
        `EJS render error in "${fileInfo.filePath}": ${err.message}`,
      );
    }
  }

  markdownContent = markdownContent.replace(
    /(?<!~)~(?!~)([^~\n]+?)(?<!~)~(?!~)/g,
    "<small>$1</small>",
  );

  markdownContent = source.restore(protectFencedAttrs(markdownContent));
  const htmlContent = md.render(markdownContent);
  return htmlContent;
}
