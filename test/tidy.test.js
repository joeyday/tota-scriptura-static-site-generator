import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tidyReferences, tidyText } from '../lib/bible/tidy.js'

const buildJs = fileURLToPath(new URL('../build.js', import.meta.url))

test('a list of references is found in any text, and the rest is left out', () => {
  assert.equal(tidyReferences('Notes: see Genesis 1:1, and (Ex 3:14) too. I am 30 years old.'), 'Ge 1:1; Ex 3:14')
  assert.equal(tidyReferences('nothing here'), '')
})

test('removes duplicates, sorts canonically and uses the standard abbreviations', () => {
  assert.equal(tidyReferences('Revelation 1:1\nJohn 3:16\nGenesis 1:1\nJn 3:16\nGe 1:1'), 'Ge 1:1; Jn 3:16; Rev 1:1')
})

test('names a book once, and a chapter once', () => {
  assert.equal(tidyReferences('Ge 1:1\nGe 2:2'), 'Ge 1:1; 2:2')
  assert.equal(tidyReferences('Ge 1:1-2\nGe 1:10'), 'Ge 1:1-2, 10')
  assert.equal(tidyReferences('Ge 1:1-2; 1:10; 2:5'), 'Ge 1:1-2, 10; 2:5')
})

test('joins verses that touch into ranges, within a chapter', () => {
  assert.equal(tidyReferences('Ge 1:1, 2, 3-4'), 'Ge 1:1-4')
  assert.equal(tidyReferences('Ge 1:3-5\nGe 1:1-4'), 'Ge 1:1-5')
  assert.equal(tidyReferences('Ge 1:1\nGe 1:3'), 'Ge 1:1, 3')
})

test('does not join verses across a chapter boundary', () => {
  assert.equal(tidyReferences('Ge 1:30-31; 2:1-2'), 'Ge 1:30-31; 2:1-2')
})

test('keeps a range across chapters, and joins verses to it', () => {
  assert.equal(tidyReferences('Ge 1:30-2:2'), 'Ge 1:30-2:2')
  assert.equal(tidyReferences('Ge 1:30-2:2; Ge 2:3'), 'Ge 1:30-2:3')
  assert.equal(tidyReferences('Ge 1:30-2:2; Ge 2:1-5'), 'Ge 1:30-2:5')
  assert.equal(tidyReferences('Ge 1:28; Ge 1:29; Ge 1:30-2:2'), 'Ge 1:28-2:2')
  assert.equal(tidyReferences('Ge 1:30-2:2; Ge 2:5'), 'Ge 1:30-2:2, 5')
})

test('a whole chapter stays on its own and does not merge with verses', () => {
  assert.equal(tidyReferences('Ro 3:1\nRo 3\nRo 3:2'), 'Ro 3; 3:1-2')
  assert.equal(tidyReferences('Ro 1-2\nRo 1-2\nRo 1:1'), 'Ro 1-2; 1:1')
})

test('a book of one chapter is written in full', () => {
  assert.equal(tidyReferences('Phm 1:3\nPhm 1:5'), 'Phm 1:3, 5')
})

test('in a book of one chapter a lone number is a verse, and 1 is the whole letter', () => {
  assert.equal(tidyReferences('Phm 3'), 'Phm 1:3')
  assert.equal(tidyReferences('Phm 3-5\nPhm 1:6'), 'Phm 1:3-6')
  assert.equal(tidyReferences('Jude 3, 5'), 'Jude 1:3, 5')
  assert.equal(tidyReferences('Phm 1'), 'Phm 1')
  assert.throws(() => tidyReferences('Phm 99'), /Philemon 1 has 25 verses/)
})

test('a translation stays with its references', () => {
  assert.equal(tidyReferences('Ex 20:1 KJV\nEx 20:2'), 'Ex 20:2; Ex 20:1 KJV')
})

test('only references with the same translation combine', () => {
  assert.equal(tidyReferences('Ge 1:1 KJV; Ge 1:10; Ge 2:2 NASB'), 'Ge 1:10; Ge 1:1 KJV; Ge 2:2 NASB')
  assert.equal(tidyReferences('Ge 1:1 KJV; Ge 1:10 KJV; Ge 2:2 KJV'), 'Ge 1:1, 10; 2:2 KJV')
  assert.equal(tidyReferences('Jn 3:16; 5:24 KJV'), 'Jn 3:16; 5:24 KJV')
})

test('each line is its own list', () => {
  assert.equal(tidyReferences('Ge 1:1\n5:3'), 'Ge 1:1')
})

test('an opted-out reference is left out, and one that does not exist fails', () => {
  assert.equal(tidyReferences('!Ge 1:1 and Ge 1:2'), 'Ge 1:2')
  assert.throws(() => tidyReferences('Ge 1:99'), /Genesis 1:99: Genesis 1 has 31 verses/)
})

test('prose stays as it is, and each list of references is tidied on its own', () => {
  const text = 'Some prose, see Jn 3:16 here.\nRo 8:1\n- Ge 2:2\n* Ge 1:1; Ge 1:2 KJV\nMore prose.\n\nJn 3:18\nJn 3:17\nPhm 3.\nThe end.\n'
  assert.equal(tidyText(text), 'Some prose, see Jn 3:16 here.\nGe 1:1; 2:2; Ge 1:2 KJV; Ro 8:1\nMore prose.\n\nJn 3:17-18; Phm 1:3\nThe end.\n')
})

test('a line with prose, an opt-out or an unknown book is not a list, and a blank line ends one', () => {
  const text = 'Ge 2:2\nGe 1:1 is first\nJn 3:17\nJn 3:16\n\nJn 1:1\n!Jn 1:2\nXx 1:1\nRev 1:1\nGe 1:1'
  assert.equal(tidyText(text), 'Ge 2:2\nGe 1:1 is first\nJn 3:16-17\n\nJn 1:1\n!Jn 1:2\nXx 1:1\nGe 1:1; Rev 1:1')
  assert.equal(tidyText('no references at all\n'), 'no references at all\n')
  assert.throws(() => tidyText('Ge 1:99'), /Genesis 1:99/)
})

test('references inside a sentence are tidied where they stand', () => {
  assert.equal(
    tidyText('God is a knower and God’s knowledge includes ‘propositional’ knowledge. (Gen. 3:5; Luke 16:15; 1 Cor. 3:20)'),
    'God is a knower and God’s knowledge includes ‘propositional’ knowledge. (Ge 3:5; Lk 16:15; 1Co 3:20)')
  assert.equal(tidyText('See Ro 8:1, Genesis 2:2; Genesis 1:1 KJV; Genesis 1:2 KJV.'), 'See Ge 2:2; Ge 1:1-2 KJV; Ro 8:1.')
})

test('references joined by words are tidied one by one, and the words stay', () => {
  assert.equal(tidyText('Compare Matthew 5:3 and Mt 5:3-4, and Gen. 1:2 or Jn 3:16.'), 'Compare Matthew 5:3 and Mt 5:3-4, and Ge 1:2 or Jn 3:16.')
  assert.equal(tidyText('Compare Gen. 1:2 and Jn 3:16.'), 'Compare Ge 1:2 and Jn 3:16.')
})

test('a lone reference keeps its full name, and any abbreviation becomes the standard one', () => {
  assert.equal(tidyText('See Genesis 1:1.'), 'See Genesis 1:1.')
  assert.equal(tidyText('See 1 Corinthians 3:20, or 1 Cor. 3:20, or Rom 8:1, or Phil 4:13, or Ps. 23.'), 'See 1 Corinthians 3:20, or 1Co 3:20, or Ro 8:1, or Php 4:13, or Ps 23.')
  assert.equal(tidyText('See Phm 3.'), 'See Phm 1:3.')
  assert.equal(tidyText('See Philemon 3.'), 'See Philemon 1:3.')
})

test('a list always uses the abbreviations, written in full or not', () => {
  assert.equal(tidyText('See Genesis 2:2; Genesis 1:1 and 1 Cor. 3:20; Romans 8:1.'), 'See Ge 1:1; 2:2 and Ro 8:1; 1Co 3:20.')
  assert.equal(tidyText('Genesis 2:2\nGenesis 1:1\n'), 'Ge 1:1; 2:2\n')
})

test('ordinary words are not taken for book names', () => {
  assert.equal(tidyText('In 2020 Mark went to 3 places; Is 3 enough?'), 'In 2020 Mark went to 3 places; Is 3 enough?')
})

test('tsgen refs reads standard input and files', () => {
  const piped = spawnSync(process.execPath, [buildJs, 'refs'], { input: 'Jn 3:17\nJn 3:16\n', encoding: 'utf8' })
  assert.equal(piped.stdout, 'Jn 3:16-17\n')
  assert.equal(piped.status, 0)
  const bad = spawnSync(process.execPath, [buildJs, 'refs'], { input: 'Ge 1:99', encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /Genesis 1 has 31 verses/)
  const missing = spawnSync(process.execPath, [buildJs, 'refs', '/nonexistent/file.txt'], { encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /ENOENT/)
  const dir = mkdtempSync(path.join(tmpdir(), 'tsgen-refs-'))
  writeFileSync(path.join(dir, 'a.txt'), 'Ex 3:14\n')
  writeFileSync(path.join(dir, 'b.txt'), 'Ge 1:1\n')
  const files = spawnSync(process.execPath, [buildJs, 'refs', path.join(dir, 'a.txt'), path.join(dir, 'b.txt')], { encoding: 'utf8' })
  assert.equal(files.stdout, 'Ge 1:1; Ex 3:14\n')
  rmSync(dir, { recursive: true })
})
