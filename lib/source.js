import { maskCode, restoreCode } from "./code.js";
import { expandPartials } from "./partials.js";

// Prepares a page's Markdown for the plain-text passes: code is masked, partials
// are expanded and %% comments are stripped (so a commented-out link or template
// tag does nothing). `restore` puts the code back; call it before markdown-it.
export function prepareSource(markdown, partials) {
  const stash = [];
  const mask = (text) => maskCode(text, stash);
  const text = expandPartials(mask(markdown), partials, mask).replace(
    /%%[\s\S]*?%%/g,
    "",
  );
  return { text, restore: (t) => restoreCode(t, stash) };
}
