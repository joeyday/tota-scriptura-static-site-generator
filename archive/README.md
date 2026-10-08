# The Replit Agent docs

Legacy documentation from when this project lived in Replit. Joey keeps it indefinitely (2026-10-08): it has proven useful for understanding why Replit Agent built a feature the way it did. Don't propose deleting it.

**Don't trust it either.** The code is the source of truth (`README.md` is the accurate reference). Read these for intent and history, and check every claim against the code.

- `replit.md`: the project overview and pipeline description.
- `replit.txt`: a copy of `.replit`. It describes a Postgres/`npm run dev` template that never matched this project; the only real content is the dev loop `node build.js && npx serve -l 5000 dist`.
- `project-documents/`: task briefs, useful only as design history. Its README wrongly says the files are under `.agents`.

## Where the docs drifted from the code
Found when `README.md` was written from the code (2026-10-01), so nobody trusts them by accident. Items marked *since* were true of the code then and have changed.

- The heading-ID pass and the whole Scripture index are missing from `replit.md`'s pipeline. Its pass numbering is also internally inconsistent: the Roman numeral pass is called "pass 10" in one place and "11" in another.
- The divine-name docs list only LORD/GOD/YHWH. The code also handles the I AM / I WILL BE forms, and YHWH gets no initial span.
- The categorical index is described as "pages grouped under categories". It is actually a flat list of top-level categories.
- The featured index shows secondaries as inline "(and …)", not grouped beneath their primary.
- `bodyClasses` is a template variable but isn't documented.
- The homepage docs claim an empty permalink works. It doesn't.
- Task briefs describe the star as `entypo-icon ★`. The code uses Font Awesome classes.
- Task briefs describe the Scripture index as a `<ul>` with "Title (§Section)". The code uses a `<dl>` with `›` separators, and also excludes categories and asides (and, *since* 0.5.6, reference pages).
- Backlinks are described as "other pages", but self-links were included (*since* 0.7.0 they are excluded).
- `replit.md` describes the model from before 0.2.0 and 0.4.0 (see `docs/release-notes.md`): any `.md` file can be embedded (`contentMap`), not just those in `partial/`; `aside of` pages with an `asides` array; one `/index/alphabetical` list; a category is any page that has members; the link class is `aside` (now `notes`).
