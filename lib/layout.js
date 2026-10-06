import ejs from "ejs";

// The description of every page that has none of its own.
const SITE_DESCRIPTION =
  "A small contribution to Christian systematic theology, bringing the total weight of the teaching of Scripture to bear on many important topics.";

// Compiles the page layout once and returns renderLayout(content, locals),
// which wraps content in the layout and classifies every link in the result.
// The URL sets say which classes an internal link gets: draft, category,
// notes (a notes page), featured, planned (a placeholder for a hidden page),
// or broken (not a known URL).
export function createLayout({
  template,
  draftUrls,
  categoryUrls,
  notesUrls,
  featuredUrls,
  plannedUrls,
  allKnownUrls,
  cacheBust,
}) {
  const renderTemplate = ejs.compile(template);

  function classifyLinks(html) {
    return html.replace(
      /<a\s([^>]*href="([^"]*)"[^>]*)>/g,
      (match, attrs, href) => {
        const classes = [];
        if (/^https?:\/\//.test(href)) {
          classes.push("external");
        } else {
          classes.push("internal");
          if (href.startsWith("/")) {
            // Strip fragment (#section) before checking URL sets
            const baseHref = href.split("#")[0];
            if (draftUrls.has(baseHref)) classes.push("draft");
            if (categoryUrls.has(baseHref)) classes.push("category");
            if (notesUrls.has(baseHref)) classes.push("notes");
            if (featuredUrls.has(baseHref)) classes.push("featured");
            if (plannedUrls.has(baseHref)) classes.push("planned");
            if (!allKnownUrls.has(baseHref) && !baseHref.startsWith("/index/"))
              classes.push("broken");
          }
        }
        if (/class="/.test(attrs)) {
          return `<a ${attrs.replace(/class="([^"]*)"/, `class="$1 ${classes.join(" ")}"`)}>`;
        }
        return `<a class="${classes.join(" ")}" ${attrs}>`;
      },
    );
  }

  // A page's body classes are its URL's path segments:
  // "/index/scripture/romans" → ["index", "scripture", "romans"]; "/" → ["home"].
  function urlBodyClasses(url) {
    if (url === "/") return ["home"];
    return (url || "").split("/").filter(Boolean);
  }

  return function renderLayout(content, locals = {}) {
    return classifyLinks(
      renderTemplate({
        frontmatter: locals.frontmatter || {},
        bodyClasses: urlBodyClasses(locals.url),
        content,
        cacheBust,
        url: locals.url || "/",
        hero: locals.hero || null,
        noindex: locals.noindex || false,
        description: locals.description || SITE_DESCRIPTION,
        // The page-actions tabs. A page, its notes and its backlinks share them: `view`
        // says which is showing ("page", "notes" or "backlinks"), `pageUrl` links back
        // to the page. Other generated pages have no `view`: the indexes show a lone
        // "Index page" tab, the rest (no nsLabel) have no nav at all.
        nsLabel: locals.nsLabel || null,
        view: locals.view || null,
        pageUrl: locals.pageUrl || null,
        noteUrl: locals.noteUrl || null,
        backlinksUrl: locals.backlinksUrl || null,
        categories: locals.categories || [],
        subcategories: locals.subcategories || [],
        pages: locals.pages || [],
        featuredWith: locals.featuredWith || null,
        featured: locals.featured || false,
      }),
    );
  };
}
