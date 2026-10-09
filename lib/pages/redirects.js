import { escHtml } from "../html/escape.js";
import { info } from "../log.js";

// Each alias writes a meta-refresh redirect at /{relDir}/{slugify(alias)}.
export async function writeAliasRedirects({ output, aliasRedirects }) {
  for (const { fromUrlPath, toUrl, toTitle } of aliasRedirects) {
    const redirectHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url=${toUrl}">
  <link rel="canonical" href="https://totascriptura.org${toUrl}">
  <title>Redirecting to ${escHtml(toTitle)}</title>
</head>
<body>
  <p>Redirecting to <a href="${toUrl}">${escHtml(toTitle)}</a>…</p>
</body>
</html>`;
    await output.emit(fromUrlPath, redirectHtml);
    info(`Built (alias redirect): ${fromUrlPath} -> ${toUrl}`);
  }
}
