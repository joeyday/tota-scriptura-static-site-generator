import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  notesParentDir,
  parseNameList,
  pathKey,
  resolveLink,
  splitFragment,
  stripBrackets
} from '../lib/links.js'

// ─── A tiny vault index ───
// Pages are { finalUrlPath, nsDir, isNote }; fileMap maps a lowercase bare name to URLs.
function makeVault (pages) {
  const index = { byPath: {}, byUrl: {} }
  const fileMap = {}
  for (const p of pages) {
    const fi = { finalUrlPath: p.url, nsDir: p.dir, isNote: !!p.isNote }
    const base = p.url.split('/').pop()
    index.byPath[pathKey(p.dir, base)] = fi
    index.byUrl[p.url] = fi
    ;(fileMap[base.toLowerCase()] ??= []).push(p.url)
  }
  return { index, fileMap }
}

test('a unique bare name resolves', () => {
  const { index, fileMap } = makeVault([{ url: '/topic/trinity', dir: 'topic' }])
  assert.deepEqual(resolveLink('Trinity', fileMap, index), { url: '/topic/trinity' })
})

test('an unknown name is notFound', () => {
  const { index, fileMap } = makeVault([{ url: '/topic/trinity', dir: 'topic' }])
  assert.deepEqual(resolveLink('Nope', fileMap, index), { notFound: true })
  assert.deepEqual(resolveLink('topic/Nope', fileMap, index), { notFound: true })
})

test('a qualified path matches exactly, case-insensitively, with or without a leading slash', () => {
  const { index, fileMap } = makeVault([
    { url: '/topic/trinity', dir: 'topic' },
    { url: '/commentary/trinity', dir: 'commentary' }
  ])
  assert.deepEqual(resolveLink('topic/Trinity', fileMap, index), { url: '/topic/trinity' })
  assert.deepEqual(resolveLink('/commentary/trinity', fileMap, index), { url: '/commentary/trinity' })
})

test('a bare name shared by several pages narrows to the source folder, then topic/, then the root', () => {
  const { index, fileMap } = makeVault([
    { url: '/commentary/grace', dir: 'commentary' },
    { url: '/topic/grace', dir: 'topic' },
    { url: '/grace', dir: '' }
  ])
  assert.deepEqual(resolveLink('Grace', fileMap, index, 'commentary'),
    { url: '/commentary/grace', shadowed: true })
  assert.deepEqual(resolveLink('Grace', fileMap, index, 'person'),
    { url: '/topic/grace', shadowed: true })

  const noTopic = makeVault([
    { url: '/commentary/grace', dir: 'commentary' },
    { url: '/grace', dir: '' }
  ])
  assert.deepEqual(resolveLink('Grace', noTopic.fileMap, noTopic.index, 'person'),
    { url: '/grace', shadowed: true })
})

test('a bare name with no tiebreak is ambiguous', () => {
  const { index, fileMap } = makeVault([
    { url: '/commentary/grace', dir: 'commentary' },
    { url: '/person/grace', dir: 'person' }
  ])
  assert.deepEqual(resolveLink('Grace', fileMap, index, 'topic'), { ambiguous: true })
})

test('notes pages only count when no ordinary page has the name', () => {
  const { index, fileMap } = makeVault([
    { url: '/topic/grace', dir: 'topic' },
    { url: '/topic/grace/notes', dir: 'topic/notes', isNote: true }
  ])
  // Same basename "grace" in both: the ordinary page wins without a shadow warning.
  fileMap.grace = ['/topic/grace', '/topic/grace/notes']
  assert.deepEqual(resolveLink('Grace', fileMap, index, 'topic'), { url: '/topic/grace' })
})

test('stripBrackets removes [[ ]] and a display-text suffix', () => {
  assert.equal(stripBrackets('[[Trinity]]'), 'Trinity')
  assert.equal(stripBrackets('[[Trinity|the Trinity]]'), 'Trinity')
  assert.equal(stripBrackets('Trinity'), 'Trinity')
  assert.equal(stripBrackets(7), 7)
})

test('splitFragment', () => {
  assert.deepEqual(splitFragment('topic/Foo#^abc'), { page: 'topic/Foo', fragment: '^abc' })
  assert.deepEqual(splitFragment(' Foo '), { page: 'Foo', fragment: null })
})

test('parseNameList takes a string, a list, or nothing', () => {
  assert.deepEqual(parseNameList(undefined), [])
  assert.deepEqual(parseNameList('[[A]]'), ['A'])
  assert.deepEqual(parseNameList(['[[A]]', 'B|b']), ['A', 'B'])
})

test('notesParentDir', () => {
  assert.equal(notesParentDir('notes'), '')
  assert.equal(notesParentDir('topic/notes'), 'topic')
  assert.equal(notesParentDir('topic'), null)
  assert.equal(notesParentDir('topic/notesy'), null)
})
