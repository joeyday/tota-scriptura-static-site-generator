import fs from 'fs/promises'
import { BuildError } from '../errors.js'
import { resolveLink } from '../links.js'

// ─── The book manifest ───
// `book.json` at the vault's root says what is in the book and in what order:
//
//   { "parts": [
//     { "title": "Prolegomena", "topics": ["Scripture", "Old Testament canon"] },
//     { "title": "Theology proper", "topics": ["Trinity", "Monotheism"] }
//   ], "index": { "groups": ["Church", "Preservation"] } }
//
// "index" is optional; its groups are headings the alphabetical index gathers entries under.
// A topic is named the way a wikilink names it (a bare name looks in topic/ first; "topic/Trinity"
// is exact). The order of the file is the order of the book. Anything that isn't a published topic
// fails the book, so a mistake never makes it into print.

export const MANIFEST_FILE = 'book.json'

const isText = (value) => typeof value === 'string' && value.trim() !== ''

// Why a page can't be in the book, or null.
function unusable (page) {
  if (page.hidden) return 'is hidden'
  if (page.draft) return 'is a draft'
  if (page.isNote) return 'is a notes page'
  if (page.isCategory) return 'is a category'
  return null
}

// { parts: [{ title, pages: [fileInfo] }], indexGroups: [text] }, from the manifest's text and the vault's page index.
export function resolveManifest (manifest, { index, fileMap }) {
  const problems = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new BuildError(`${MANIFEST_FILE} must be a JSON object with a "parts" list`)
  }
  if (!Array.isArray(manifest.parts) || manifest.parts.length === 0) {
    throw new BuildError(`${MANIFEST_FILE} needs a "parts" list with at least one part`)
  }

  const seen = new Map() // url → the part it is already in
  const parts = manifest.parts.map((part, i) => {
    const label = `part ${i + 1}${isText(part?.title) ? ` ("${part.title}")` : ''}`
    if (!part || typeof part !== 'object' || !isText(part.title)) {
      problems.push(`${MANIFEST_FILE}: ${label} needs a "title"`)
    }
    if (!Array.isArray(part?.topics) || part.topics.length === 0) {
      problems.push(`${MANIFEST_FILE}: ${label} needs a "topics" list`)
      return { title: part?.title, pages: [] }
    }
    const pages = []
    for (const name of part.topics) {
      if (!isText(name)) {
        problems.push(`${MANIFEST_FILE}: ${label} has a topic that isn't text`)
        continue
      }
      const found = resolveLink(name, fileMap, index, 'topic')
      if (found.notFound) {
        problems.push(`${MANIFEST_FILE}: "${name}" (${label}) is not a page`)
        continue
      }
      if (found.ambiguous) {
        problems.push(`${MANIFEST_FILE}: "${name}" (${label}) names more than one page; write it with its folder, like "topic/${name}"`)
        continue
      }
      const page = index.byUrl[found.url]
      const why = unusable(page)
      if (why) {
        problems.push(`${MANIFEST_FILE}: "${name}" (${label}) ${why}`)
        continue
      }
      if (seen.has(page.finalUrlPath)) {
        problems.push(`${MANIFEST_FILE}: "${name}" (${label}) is already in ${seen.get(page.finalUrlPath)}`)
        continue
      }
      seen.set(page.finalUrlPath, label)
      pages.push(page)
    }
    return { title: part.title, pages }
  })

  // The index may name headings that gather entries ("Church" gathers "Church discipline")
  const groups = manifest.index?.groups ?? []
  if (manifest.index !== undefined && (typeof manifest.index !== 'object' || manifest.index === null || Array.isArray(manifest.index))) {
    problems.push(`${MANIFEST_FILE}: "index" must be an object, like { "groups": ["Church"] }`)
  } else if (!Array.isArray(groups) || !groups.every(isText)) {
    problems.push(`${MANIFEST_FILE}: "index" "groups" must be a list of headings`)
  }

  if (problems.length > 0) throw new BuildError(`Problems in the book manifest:\n${problems.join('\n')}`)
  return { parts, indexGroups: groups }
}

export async function loadManifest ({ index, fileMap }) {
  let text
  try {
    text = await fs.readFile(MANIFEST_FILE, 'utf-8')
  } catch (err) {
    throw new BuildError(
      err.code === 'ENOENT' ? `${MANIFEST_FILE} not found: it lists the book's parts and topics` : `${MANIFEST_FILE} can't be read`
    )
  }
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch {
    throw new BuildError(`${MANIFEST_FILE} is not valid JSON`)
  }
  return resolveManifest(manifest, { index, fileMap })
}
