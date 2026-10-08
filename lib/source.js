import { maskCode, restoreCode } from "./code.js";
import { expandPartials } from "./partials.js";

// Prepares a page's Markdown for the plain-text passes: code is masked, partials
// are expanded and %% comments are stripped (so a commented-out link or template
// tag does nothing). `restore` puts the code back; call it before markdown-it.
// A missing or circular partial is reported to `warn`, if given.
export function prepareSource(markdown, partials, warn) {
  const stash = [];
  const mask = (text) => maskCode(text, stash);
  const text = expandPartials(mask(markdown), partials, mask, new Set(), warn).replace(
    /%%[\s\S]*?%%/g,
    "",
  );
  return { text, restore: (t) => restoreCode(t, stash) };
}
