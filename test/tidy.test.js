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
  assert.equal(tidyReferences('Ge 1:1-2\nGe 1:10'), 'Ge 1:1–2, 10')
  assert.equal(tidyReferences('Ge 1:1-2; 1:10; 2:5'), 'Ge 1:1–2, 10; 2:5')
})

test('a range is written with an en dash, whichever dash it was written with', () => {
  assert.equal(tidyReferences('Ge 1:1-3'), 'Ge 1:1\u20133')
  assert.equal(tidyReferences('Ge 1:1\u20133'), 'Ge 1:1\u20133')
  assert.equal(tidyReferences('Ge 1:30\u20142:2'), 'Ge 1:30\u20132:2')
  assert.equal(tidyText('See Ge 1-2 and Ro 8:1-2.'), 'See Ge 1\u20132 and Ro 8:1\u20132.')
  assert.equal(tidyReferences('2Sa 7:22-24'), '2Sa 7:22\u201324 (cf. 1Ch 17:20\u201322)')
})

test('joins verses that touch into ranges, within a chapter', () => {
  assert.equal(tidyReferences('Ge 1:1, 2, 3-4'), 'Ge 1:1–4')
  assert.equal(tidyReferences('Ge 1:3-5\nGe 1:1-4'), 'Ge 1:1–5')
  assert.equal(tidyReferences('Ge 1:1\nGe 1:3'), 'Ge 1:1, 3')
})

test('does not join verses across a chapter boundary', () => {
  assert.equal(tidyReferences('Ge 1:30-31; 2:1-2'), 'Ge 1:30–31; 2:1–2')
})

test('keeps a range across chapters, and joins verses to it', () => {
  assert.equal(tidyReferences('Ge 1:30-2:2'), 'Ge 1:30–2:2')
  assert.equal(tidyReferences('Ge 1:30-2:2; Ge 2:3'), 'Ge 1:30–2:3')
  assert.equal(tidyReferences('Ge 1:30-2:2; Ge 2:1-5'), 'Ge 1:30–2:5')
  assert.equal(tidyReferences('Ge 1:28; Ge 1:29; Ge 1:30-2:2'), 'Ge 1:28–2:2')
  assert.equal(tidyReferences('Ge 1:30-2:2; Ge 2:5'), 'Ge 1:30–2:2, 5')
})

test('a whole chapter stays on its own and does not merge with verses', () => {
  assert.equal(tidyReferences('Ro 3:1\nRo 3\nRo 3:2'), 'Ro 3; 3:1–2')
  assert.equal(tidyReferences('Ro 1-2\nRo 1-2\nRo 1:1'), 'Ro 1–2; 1:1')
})

test('a book of one chapter is written in full', () => {
  assert.equal(tidyReferences('Phm 1:3\nPhm 1:5'), 'Phm 1:3, 5')
})

test('in a book of one chapter a lone number is a verse, and 1 is the whole letter', () => {
  assert.equal(tidyReferences('Phm 3'), 'Phm 1:3')
  assert.equal(tidyReferences('Phm 3-5\nPhm 1:6'), 'Phm 1:3–6')
  assert.equal(tidyReferences('Jude 3, 5'), 'Jude 1:3, 5')
  assert.equal(tidyReferences('Phm 1'), 'Phm 1')
  assert.throws(() => tidyReferences('Phm 99'), /Philemon 1 has 25 verses/)
})

test('a translation stays with its references', () => {
  assert.equal(tidyReferences('Ex 3:1 KJV\nEx 3:2'), 'Ex 3:2; Ex 3:1 KJV')
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
  assert.equal(tidyText(text), 'Some prose, see Jn 3:16 here.\nGe 1:1; 2:2; Ge 1:2 KJV; Ro 8:1\nMore prose.\n\nJn 3:17–18; Phm 1:3\nThe end.\n')
})

test('a line with prose, an opt-out or an unknown book is not a list, and a blank line ends one', () => {
  const text = 'Ge 2:2\nGe 1:1 is first\nJn 3:17\nJn 3:16\n\nJn 1:1\n!Jn 1:2\nXx 1:1\nRev 1:1\nGe 1:1'
  assert.equal(tidyText(text), 'Ge 2:2\nGe 1:1 is first\nJn 3:16–17\n\nJn 1:1\n!Jn 1:2\nXx 1:1\nGe 1:1; Rev 1:1')
  assert.equal(tidyText('no references at all\n'), 'no references at all\n')
  assert.throws(() => tidyText('Ge 1:99'), /Genesis 1:99/)
})

test('references inside a sentence are tidied where they stand', () => {
  assert.equal(
    tidyText('God is a knower and God’s knowledge includes ‘propositional’ knowledge. (Gen. 3:5; Luke 16:15; 1 Cor. 3:20)'),
    'God is a knower and God’s knowledge includes ‘propositional’ knowledge. (Ge 3:5; Lk 16:15; 1Co 3:20)')
  assert.equal(tidyText('See Ro 8:1, Genesis 2:2; Genesis 1:1 KJV; Genesis 1:2 KJV.'), 'See Ge 2:2; Ge 1:1–2 KJV; Ro 8:1.')
})

test('references joined by words are tidied one by one, and the words stay', () => {
  assert.equal(tidyText('Compare Matthew 5:3 and Mt 5:3-4, and Gen. 1:2 or Jn 3:16.'), 'Compare Matthew 5:3 and Mt 5:3–4, and Ge 1:2 or Jn 3:16.')
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

// ─── Harmony passages ───
test('a harmony passage is written as the main passage with its parallels', () => {
  assert.equal(tidyReferences('2Sa 7:22; 1Ch 17:20'), '2Sa 7:22 (cf. 1Ch 17:20)')
  assert.equal(tidyReferences('2Sa 7:22'), '2Sa 7:22 (cf. 1Ch 17:20)')
  assert.equal(tidyReferences('1Ch 17:20'), '2Sa 7:22 (cf. 1Ch 17:20)')
  assert.equal(tidyReferences('1Ch 17:20; 2Sa 7:22'), '2Sa 7:22 (cf. 1Ch 17:20)')
})

test('a bare number after a semicolon is a chapter, and after a comma a verse', () => {
  assert.equal(tidyText('See Heb 4:2; 11 and Heb 4:2, 11.'), 'See Heb 4:2; 11 and Heb 4:2, 11.')
  assert.equal(tidyReferences('Heb 4:2; 11'), 'Heb 4:2; 11')
  assert.equal(tidyReferences('Heb 4:2, 11'), 'Heb 4:2, 11')
  assert.equal(tidyReferences('Heb 11; 4:2'), 'Heb 4:2; 11')
})

test('the first book canonically is the main passage, and a (cf. …) in the wrong order is put right', () => {
  assert.equal(tidyText('1Ch 17:20 (cf. 2Sa 7:22)'), '2Sa 7:22 (cf. 1Ch 17:20)')
  assert.equal(tidyText('2Sa 7:22 (cf. 1Ch 17:20)'), '2Sa 7:22 (cf. 1Ch 17:20)')
  assert.equal(tidyText('Lk 3:4 (cf. Mk 1:3)'), 'Mt 3:3 (cf. Mk 1:2–3; Lk 3:4–6; Jn 1:23)')
  assert.equal(tidyReferences('Lk 22:14-23'), 'Mt 26:20, 22–24, 26–29 (cf. Mk 14:17, 19–25; Lk 22:14, 16–23; Jn 13:26); Lk 22:15')
})

test('a passage with no Matthew has the first of the others as its main passage', () => {
  assert.equal(tidyReferences('Lk 4:31'), 'Mk 1:21 (cf. Lk 4:31)')
})

test('Psalms is the main passage of a Psalm that is reproduced in another book', () => {
  assert.equal(tidyReferences('1Ch 16:8-10'), 'Ps 105:1–3 (cf. 1Ch 16:8–10)')
  assert.equal(tidyReferences('2Sa 22:4; Ps 18:3'), 'Ps 18:3 (cf. 2Sa 22:4)')
  assert.equal(tidyReferences('Ps 18:3'), 'Ps 18:3 (cf. 2Sa 22:4)')
})

test('a Psalm repeated in the Psalms has the first of them as its main passage', () => {
  assert.equal(tidyReferences('Ps 53:1'), 'Ps 14:1 (cf. Ps 53:1)')
  assert.equal(tidyReferences('Ps 14:7; Ps 53:6'), 'Ps 14:7 (cf. Ps 53:6)')
})

test('verses that touch join in the main passage and in the parallels', () => {
  assert.equal(tidyReferences('2Sa 7:22-24, 26'), '2Sa 7:22–24, 26 (cf. 1Ch 17:20–22, 24)')
  assert.equal(tidyReferences('1Ch 17:20; 1Ch 17:21'), '2Sa 7:22–23 (cf. 1Ch 17:20–21)')
})

test('a whole chapter has whole chapters for parallels where they cover them', () => {
  assert.equal(tidyReferences('2Sa 7'), '2Sa 7 (cf. 1Ch 17)')
  assert.equal(tidyReferences('1Ch 17'), '2Sa 7 (cf. 1Ch 17)')
  assert.equal(tidyReferences('2Sa 7; 8'), '2Sa 7–8 (cf. 1Ch 17–18)')
  assert.equal(tidyReferences('2Sa 11'), '2Sa 11 (cf. 1Ch 20:1)')
  assert.equal(tidyReferences('Ps 53'), 'Ps 14 (cf. Ps 53)')
})

test('a passage whose telling differs is matched as a whole', () => {
  assert.equal(tidyReferences('Mt 3:3'), 'Mt 3:3 (cf. Mk 1:2–3; Lk 3:4–6; Jn 1:23)')
  assert.equal(tidyReferences('Lk 3:5'), 'Mt 3:3 (cf. Mk 1:2–3; Lk 3:4–6; Jn 1:23)')
})

test('the rest of a list stays, and each chapter of a main passage has its own parallels', () => {
  assert.equal(tidyReferences('2Sa 7:22\nJn 3:16\n1Ch 17:20'), '2Sa 7:22 (cf. 1Ch 17:20); Jn 3:16')
  assert.equal(tidyReferences('Jn 3:16; Ge 1:1'), 'Ge 1:1; Jn 3:16')
  assert.equal(tidyReferences('Mt 3:3; Mt 5:3; Jn 3:16'), 'Mt 3:3 (cf. Mk 1:2–3; Lk 3:4–6; Jn 1:23); Mt 5:3 (cf. Lk 6:20); Jn 3:16')
  assert.equal(tidyReferences('Mt 5:3\nMt 5:6\nMt 6:9'), 'Mt 5:3, 6 (cf. Lk 6:20–21); Mt 6:9 (cf. Lk 11:2)')
})

test('a main passage keeps its full name when it is written in full and is alone', () => {
  assert.equal(tidyReferences('2 Samuel 7:22'), '2 Samuel 7:22 (cf. 1Ch 17:20)')
  assert.equal(tidyReferences('2 Samuel 7:22; Genesis 1:1'), 'Ge 1:1; 2Sa 7:22 (cf. 1Ch 17:20)')
})

test('a translation goes with the main passage and the parallels, and only the same translation matches', () => {
  assert.equal(tidyReferences('2Sa 7:22 KJV'), '2Sa 7:22 KJV (cf. 1Ch 17:20 KJV)')
  assert.equal(tidyReferences('1Ch 17:20 KJV; 2Sa 7:22 KJV'), '2Sa 7:22 KJV (cf. 1Ch 17:20 KJV)')
  assert.equal(tidyReferences('1Ch 17:20 KJV; 2Sa 7:22'), '2Sa 7:22 (cf. 1Ch 17:20); 2Sa 7:22 KJV (cf. 1Ch 17:20 KJV)')
  assert.equal(tidyText('1Ch 17:20 KJV (cf. 2Sa 7:22 KJV)'), '2Sa 7:22 KJV (cf. 1Ch 17:20 KJV)')
})

test('a list in prose gets its parallels when it has two references, and a lone reference does not', () => {
  assert.equal(tidyText('See 2Sa 7:22 here.'), 'See 2Sa 7:22 here.')
  assert.equal(tidyText('See 2Sa 7:22; 1Ch 17:20 here.'), 'See 2Sa 7:22 (cf. 1Ch 17:20) here.')
  assert.equal(tidyText('See 2Sa 7:22 and 1Ch 17:20 here.'), 'See 2Sa 7:22 and 1Ch 17:20 here.')
  assert.equal(tidyText('See Jn 3:16; 2Sa 7:22 here.'), 'See 2Sa 7:22 (cf. 1Ch 17:20); Jn 3:16 here.')
})

test('a (cf. …) in prose that is all parallels is written over, and any other is left alone', () => {
  assert.equal(tidyText('See 2Sa 7:22 (cf. 1Ch 17:20) here.'), 'See 2Sa 7:22 (cf. 1Ch 17:20) here.')
  assert.equal(tidyText('See 1Ch 17:20 (cf. 2Sa 7:22) here.'), 'See 2Sa 7:22 (cf. 1Ch 17:20) here.')
  assert.equal(tidyText('Ge 1:1; 2Sa 7:22 (cf. 1Ch 17:20); Jn 3:16'), 'Ge 1:1; 2Sa 7:22 (cf. 1Ch 17:20); Jn 3:16')
  assert.equal(tidyText('Jn 3:16 (cf. Ro 5:8)'), 'Jn 3:16 (cf. Ro 5:8)')
  assert.equal(tidyText('2Sa 7:22 (cf. Ro 5:8)'), '2Sa 7:22 (cf. Ro 5:8)')
  assert.equal(tidyText('Mt 3:3 (cf. Lk 3:4; Ro 5:8)'), 'Mt 3:3 (cf. Lk 3:4; Ro 5:8)')
  assert.equal(tidyText('Ro 5:8 (cf. 2Sa 7:22; 1Ch 17:20)'), 'Ro 5:8 (cf. 2Sa 7:22; 1Ch 17:20)')
  assert.equal(tidyText('Mt 3:3 (cf. Lk 3:4) (cf. Ro 5:8)'), 'Mt 3:3 (cf. Mk 1:2–3; Lk 3:4–6; Jn 1:23) (cf. Ro 5:8)')
  assert.equal(tidyText('2Sa 7:22 (cf. 1Ch 17:19)'), '2Sa 7:22 (cf. 1Ch 17:19)')
})

test('a harmony list is the same when it is tidied again', () => {
  for (const text of ['2Sa 7:22-24, 26', '1Ch 17:20 KJV; 2Sa 7:22', 'Mt 5:3\nMt 5:6\nMt 6:9', 'Ps 18', '2Sa 11', 'Jn 6:5', '2Sa 5:1-6:23']) {
    const once = tidyReferences(text)
    assert.equal(tidyText(once), once)
  }
})

test('a harmony passage that does not exist fails, as any other does', () => {
  assert.throws(() => tidyText('2Sa 7:22 (cf. 1Ch 17:99)'), /1 Chronicles 17:99/)
})

test('without harmonies a list is tidied as any other, and a (cf. …) is left as written', () => {
  assert.equal(tidyReferences('1Ch 17:20; 2Sa 7:22', false), '2Sa 7:22; 1Ch 17:20')
  assert.equal(tidyText('2Sa 7:22\n', false), '2Sa 7:22\n')
  assert.equal(tidyText('See 2Sa 7:22; 1Ch 17:20 here.', false), 'See 2Sa 7:22; 1Ch 17:20 here.')
  assert.equal(tidyText('1Ch 17:20 (cf. 2Sa 7:22)', false), '1Ch 17:20 (cf. 2Sa 7:22)')
})

test('tsgen refs reads standard input and files', () => {
  const piped = spawnSync(process.execPath, [buildJs, 'refs'], { input: 'Jn 3:17\nJn 3:16\n', encoding: 'utf8' })
  assert.equal(piped.stdout, 'Jn 3:16–17\n')
  assert.equal(piped.status, 0)
  const bad = spawnSync(process.execPath, [buildJs, 'refs'], { input: 'Ge 1:99', encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /Genesis 1 has 31 verses/)
  const plain = spawnSync(process.execPath, [buildJs, 'refs', '--no-harmonies'], { input: '2Sa 7:22\n1Ch 17:20 (cf. 2Sa 7:22)\n', encoding: 'utf8' })
  assert.equal(plain.stdout, '2Sa 7:22\n1Ch 17:20 (cf. 2Sa 7:22)\n')
  assert.equal(plain.status, 0)
  const unknown = spawnSync(process.execPath, [buildJs, 'refs', '--nope'], { input: '', encoding: 'utf8' })
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /Usage/)
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
