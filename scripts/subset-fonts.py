#!/usr/bin/env python3
"""Rebuilds the site's web fonts in template/fonts/ from the upstream releases.

Run it when the set of faces, the character set or the upstream version changes. The built
files are committed; this script is not part of the site build, and the site never needs it.

    python3 -m venv /tmp/fonts-venv && /tmp/fonts-venv/bin/pip install fonttools brotli
    /tmp/fonts-venv/bin/python scripts/subset-fonts.py [--vault vault] [--cache DIR]

What it does to each font: keeps only the characters and OpenType features the site uses,
drops hinting and glyph names, limits a variable font to the weights the CSS asks for, and
writes WOFF2. With --vault it then lists every character in the vault's Markdown that none of
the fonts covers (Hebrew, today), so a new character shows up here and not as a fallback glyph.

All three families are SIL Open Font License; a subset is a "Modified Version". Source Serif
reserves the name "Source", so its subset is renamed (Tota Serif). Fira and Noto reserve nothing.
"""
import argparse
import io
import os
import sys
import tempfile
import urllib.request
import zipfile

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'template', 'fonts')

SOURCE_SERIF_ZIP = 'https://github.com/adobe-fonts/source-serif/releases/download/4.005R/source-serif-4.005_WOFF2.zip'
FIRA = 'https://raw.githubusercontent.com/bBoxType/FiraSans/master/Fira_Sans_4_3/Fonts/Fira_Sans_WEB_4301'
FIRA_MONO = 'https://raw.githubusercontent.com/bBoxType/FiraSans/master/Fira_Mono_3_2/Fonts/FiraMono_WEB_32'
NOTO = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserif'
NOTO_HEBREW = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifhebrew'
NOTO_SANS = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans'
NOTO_SANS_HEBREW = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanshebrew'

# Latin: Basic Latin, Latin-1, Latin Extended-A and Additional (transliteration: ō ē ḥ ṣ), the
# caron vowels of Latin Extended-B (ǎ), modifier letters (ʿ), combining marks, general
# punctuation (dashes, quotes, …; ¶ is Latin-1), arrows, a minus and a trademark sign.
LATIN = (
    '0020-007E,00A0-00FF,0100-017F,01CD-01DC,02B0-02FF,0300-036F,1E00-1EFF,'
    '2000-206F,2122,2190-2193,2212'
)
# Greek and Greek Extended (the polytonic letters with breathing marks and accents, which
# Source Serif lacks). Served as one face so a Greek word never mixes two typefaces.
GREEK = '0370-03FF,1F00-1FFF'

# Hebrew letters and points, and the Hebrew presentation forms. The Hebrew face is regular and bold
# only: Hebrew has no italic, and the CSS points its italic at the same file so nothing is slanted.
HEBREW = '0590-05FF,FB1D-FB4F'

# Where transliteration of Greek and Hebrew (and the usual scholarly Latin) draws its letters:
# Latin Extended-A and -B, IPA (ə ɛ ɔ), modifier letters (ʾ ʿ ʼ ʰ), the phonetic modifier letters
# (ᵉ ᵊ), Latin Extended Additional (ḥ ṭ ṣ ḏ ḵ ḇ ḳ …) and the Egyptological aleph and ayin. Source
# Serif has only part of each block, so the Noto face also carries every character of these that
# Source Serif lacks: the CSS puts it first in the stack, with a unicode-range of exactly those
# characters and Greek (the script prints it). Combining marks (U+0300-036F) are left out: a base
# letter from one font and its mark from another don't join, so use the precomposed letter.
TRANSLITERATION = '0100-024F,0250-02AF,02B0-02FF,1D2C-1D6A,1E00-1EFF,A723,A725'

# kern and ligatures, the figures (old-style and lining, proportional and tabular), small caps
# and capitals-to-small-caps, fractions, super- and subscripts, case-sensitive forms, and the
# plumbing that places marks and composes characters.
FEATURES = [
    'kern', 'liga', 'clig', 'calt', 'ccmp', 'locl', 'mark', 'mkmk',
    'onum', 'lnum', 'pnum', 'tnum', 'smcp', 'c2sc', 'frac', 'numr', 'dnom',
    'sups', 'subs', 'case'
]
GREEK_FEATURES = ['kern', 'liga', 'ccmp', 'locl', 'mark', 'mkmk']
HEBREW_FEATURES = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'rlig']

SERIF_SUPPLEMENT = 'serif-supplement'  # replaced by the sets of code points main() works out
SANS_SUPPLEMENT = 'sans-supplement'

# output name: (source, unicode ranges, features, axis pins or limits, rename)
# Noto is pinned a little lighter than 400 and 700 to sit beside Source Serif, and the CSS makes it a
# little smaller (size-adjust) for the same reason; the supplements are worked out in main().
# A source is a URL, or (zip URL, member) for a file inside a zip.
FACES = {
    'TotaSerif-Roman': ((SOURCE_SERIF_ZIP, 'source-serif-4.005_WOFF2/VAR/SourceSerif4Variable-Roman.otf.woff2'), LATIN, FEATURES, {'wght': (400, 700)}, 'Tota Serif'),
    'TotaSerif-Italic': ((SOURCE_SERIF_ZIP, 'source-serif-4.005_WOFF2/VAR/SourceSerif4Variable-Italic.otf.woff2'), LATIN, FEATURES, {'wght': (400, 700)}, 'Tota Serif'),
    'NotoSerifSupplement-Roman': (NOTO + '/NotoSerif%5Bwdth%2Cwght%5D.ttf', SERIF_SUPPLEMENT, GREEK_FEATURES, {'wght': 340, 'wdth': 100}, None),
    'NotoSerifSupplement-Bold': (NOTO + '/NotoSerif%5Bwdth%2Cwght%5D.ttf', SERIF_SUPPLEMENT, GREEK_FEATURES, {'wght': 620, 'wdth': 100}, None),
    'NotoSerifSupplement-Italic': (NOTO + '/NotoSerif-Italic%5Bwdth%2Cwght%5D.ttf', SERIF_SUPPLEMENT, GREEK_FEATURES, {'wght': 340, 'wdth': 100}, None),
    'NotoSerifSupplement-BoldItalic': (NOTO + '/NotoSerif-Italic%5Bwdth%2Cwght%5D.ttf', SERIF_SUPPLEMENT, GREEK_FEATURES, {'wght': 620, 'wdth': 100}, None),
    'NotoSerifHebrew-Regular': (NOTO_HEBREW + '/NotoSerifHebrew%5Bwdth%2Cwght%5D.ttf', HEBREW, HEBREW_FEATURES, {'wght': 340, 'wdth': 100}, None),
    'NotoSerifHebrew-Bold': (NOTO_HEBREW + '/NotoSerifHebrew%5Bwdth%2Cwght%5D.ttf', HEBREW, HEBREW_FEATURES, {'wght': 620, 'wdth': 100}, None),
    'NotoSansSupplement-Regular': (NOTO_SANS + '/NotoSans%5Bwdth%2Cwght%5D.ttf', SANS_SUPPLEMENT, GREEK_FEATURES, {'wght': 340, 'wdth': 87.5}, None),
    'NotoSansSupplement-Bold': (NOTO_SANS + '/NotoSans%5Bwdth%2Cwght%5D.ttf', SANS_SUPPLEMENT, GREEK_FEATURES, {'wght': 620, 'wdth': 87.5}, None),
    'NotoSansSupplement-Italic': (NOTO_SANS + '/NotoSans-Italic%5Bwdth%2Cwght%5D.ttf', SANS_SUPPLEMENT, GREEK_FEATURES, {'wght': 340, 'wdth': 87.5}, None),
    'NotoSansSupplement-BoldItalic': (NOTO_SANS + '/NotoSans-Italic%5Bwdth%2Cwght%5D.ttf', SANS_SUPPLEMENT, GREEK_FEATURES, {'wght': 620, 'wdth': 87.5}, None),
    'NotoSansHebrew-Regular': (NOTO_SANS_HEBREW + '/NotoSansHebrew%5Bwdth%2Cwght%5D.ttf', HEBREW, HEBREW_FEATURES, {'wght': 340, 'wdth': 87.5}, None),
    'NotoSansHebrew-Bold': (NOTO_SANS_HEBREW + '/NotoSansHebrew%5Bwdth%2Cwght%5D.ttf', HEBREW, HEBREW_FEATURES, {'wght': 620, 'wdth': 87.5}, None),
    'FiraSansCondensed-Book': (FIRA + '/Condensed/Roman/FiraSansCondensed-Book.woff2', LATIN, FEATURES, None, None),
    'FiraSansCondensed-BookItalic': (FIRA + '/Condensed/Italic/FiraSansCondensed-BookItalic.woff2', LATIN, FEATURES, None, None),
    'FiraSansCondensed-SemiBold': (FIRA + '/Condensed/Roman/FiraSansCondensed-SemiBold.woff2', LATIN, FEATURES, None, None),
    'FiraSansCondensed-SemiBoldItalic': (FIRA + '/Condensed/Italic/FiraSansCondensed-SemiBoldItalic.woff2', LATIN, FEATURES, None, None),
    'FiraSansCompressed-Book': (FIRA + '/Compressed/Roman/FiraSansCompressed-Book.woff2', LATIN, FEATURES, None, None),
    'FiraSansCompressed-BookItalic': (FIRA + '/Compressed/Italic/FiraSansCompressed-BookItalic.woff2', LATIN, FEATURES, None, None),
    'FiraSansCompressed-SemiBold': (FIRA + '/Compressed/Roman/FiraSansCompressed-SemiBold.woff2', LATIN, FEATURES, None, None),
    'FiraSansCompressed-SemiBoldItalic': (FIRA + '/Compressed/Italic/FiraSansCompressed-SemiBoldItalic.woff2', LATIN, FEATURES, None, None),
    'FiraSansCondensed-Book-Greek': (FIRA + '/Condensed/Roman/FiraSansCondensed-Book.woff2', GREEK, FEATURES, None, None),
    'FiraSansCondensed-BookItalic-Greek': (FIRA + '/Condensed/Italic/FiraSansCondensed-BookItalic.woff2', GREEK, FEATURES, None, None),
    'FiraSansCondensed-SemiBold-Greek': (FIRA + '/Condensed/Roman/FiraSansCondensed-SemiBold.woff2', GREEK, FEATURES, None, None),
    'FiraSansCondensed-SemiBoldItalic-Greek': (FIRA + '/Condensed/Italic/FiraSansCondensed-SemiBoldItalic.woff2', GREEK, FEATURES, None, None),
    'FiraSansCompressed-Book-Greek': (FIRA + '/Compressed/Roman/FiraSansCompressed-Book.woff2', GREEK, FEATURES, None, None),
    'FiraSansCompressed-BookItalic-Greek': (FIRA + '/Compressed/Italic/FiraSansCompressed-BookItalic.woff2', GREEK, FEATURES, None, None),
    'FiraSansCompressed-SemiBold-Greek': (FIRA + '/Compressed/Roman/FiraSansCompressed-SemiBold.woff2', GREEK, FEATURES, None, None),
    'FiraSansCompressed-SemiBoldItalic-Greek': (FIRA + '/Compressed/Italic/FiraSansCompressed-SemiBoldItalic.woff2', GREEK, FEATURES, None, None),
    'FiraMono-Regular': (FIRA_MONO + '/FiraMono-Regular.woff2', LATIN, ['kern', 'ccmp', 'locl', 'mark', 'mkmk', 'zero'], None, None),
    'FiraMono-Bold': (FIRA_MONO + '/FiraMono-Bold.woff2', LATIN, ['kern', 'ccmp', 'locl', 'mark', 'mkmk', 'zero'], None, None)
}


def fetch (url, cache):
    path = os.path.join(cache, url.rsplit('/', 1)[-1].replace('%5B', '[').replace('%5D', ']').replace('%2C', ','))
    if not os.path.exists(path):
        print('downloading', url)
        with urllib.request.urlopen(url) as r, open(path, 'wb') as f:
            f.write(r.read())
    return path


# recalcTimestamp=False keeps the upstream modification time, so a rebuild of the same sources is
# byte-for-byte the same file and git shows no change.
def load (source, cache):
    if isinstance(source, tuple):
        zip_path = fetch(source[0], cache)
        with zipfile.ZipFile(zip_path) as z:
            return TTFont(io.BytesIO(z.read(source[1])), recalcTimestamp=False)
    return TTFont(fetch(source, cache), recalcTimestamp=False)


def ranges (spec):
    if isinstance(spec, (set, frozenset)):
        return set(spec)
    out = set()
    for part in spec.split(','):
        lo, _, hi = part.partition('-')
        out.update(range(int(lo, 16), int(hi or lo, 16) + 1))
    return out


def css_ranges (cps):
    cps = sorted(cps)
    runs = [[cps[0], cps[0]]]
    for c in cps[1:]:
        if c == runs[-1][1] + 1:
            runs[-1][1] = c
        else:
            runs.append([c, c])
    return ', '.join(f'U+{a:04X}' if a == b else f'U+{a:04X}-{b:04X}' for a, b in runs)


# The OFL reserves a font's name for the original: a subset keeps the copyright, trademark and
# licence notices (name IDs 0, 7, 13, 14) and takes a new family name.
def rename (font, family, style):
    keep = {0, 7, 13, 14}
    names = font['name']
    names.names = [n for n in names.names if n.nameID in keep or n.nameID >= 256 or 'Source' not in n.toUnicode()]
    ps = family.replace(' ', '') + '-' + style
    for platform in ((3, 1, 0x409), (1, 0, 0)):
        names.setName(family, 1, *platform)
        names.setName(style, 2, *platform)
        names.setName(f'{family} {style}', 4, *platform)
        names.setName(ps, 6, *platform)
        names.removeNames(nameID=16)
        names.removeNames(nameID=17)
    names.removeNames(nameID=3)


def build (name, spec, cache):
    source, unicodes, features, axes, new_family = spec
    font = load(source, cache)
    if axes:
        instancer.instantiateVariableFont(font, axes, inplace=True)
    opts = subset.Options()
    opts.layout_features = features
    opts.glyph_names = False
    opts.hinting = False
    opts.notdef_outline = True
    opts.name_IDs = ['*']
    opts.name_languages = [0x409]
    opts.flavor = 'woff2'
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=ranges(unicodes))
    sub.subset(font)
    if new_family:
        rename(font, new_family, name.rsplit('-', 1)[-1])
    out = os.path.join(OUT, name + '.woff2')
    subset.save_font(font, out, opts)
    return out


def main ():
    parser = argparse.ArgumentParser()
    parser.add_argument('--vault', help='report characters in this folder\'s Markdown that no font covers')
    parser.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'tsgen-font-sources'))
    args = parser.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    # The Noto Serif supplement carries all of Greek (Tota Serif has none, and a Greek word shouldn't
    # mix typefaces) and every transliteration character the text face's subset lacks. The Noto Sans
    # supplement carries only what the Fira subsets lack, Greek included: Fira's Greek is its own
    # *-Greek files, a separate unicode-range so a page downloads them only when it has Greek. What a
    # subset holds is its source's coverage within LATIN (and GREEK), not the whole source. Only what
    # Noto has, in roman and italic.
    def cmap (face):
        return set(load(FACES[face][0], args.cache).getBestCmap())
    latin = ranges(LATIN)
    wanted = ranges(TRANSLITERATION)
    tota = latin & cmap('TotaSerif-Roman') & cmap('TotaSerif-Italic')
    fira = (latin | ranges(GREEK)) & cmap('FiraSansCondensed-Book') & cmap('FiraSansCompressed-Book')
    serif = (ranges(GREEK) | (wanted - tota)) & cmap('NotoSerifSupplement-Roman') & cmap('NotoSerifSupplement-Italic')
    sans = ((ranges(GREEK) | wanted) - fira) & cmap('NotoSansSupplement-Regular') & cmap('NotoSansSupplement-Italic')
    sets = {SERIF_SUPPLEMENT: serif, SANS_SUPPLEMENT: sans}
    for name, spec in list(FACES.items()):
        if spec[1] in sets:
            FACES[name] = (spec[0], sets[spec[1]], spec[2], spec[3], spec[4])
    total = 0
    for name, spec in FACES.items():
        out = build(name, spec, args.cache)
        size = os.path.getsize(out)
        total += size
        print(f'{name + ".woff2":42} {size / 1024:7.1f} KB')
    print(f'{"total":42} {total / 1024:7.1f} KB')
    with open(os.path.join(OUT, '..', 'fonts.css'), encoding='utf8') as f:
        css = f.read()
    for label, chars in (('Noto Serif Supplement', serif), ('Noto Sans Supplement', sans)):
        unicode_range = css_ranges(chars)
        print(f'{label} covers {len(chars)} characters')
        if unicode_range not in css:
            print(f'template/fonts.css does not have this unicode-range on the {label} faces; paste it in:')
            print('    unicode-range: ' + unicode_range + ';')
        else:
            print('template/fonts.css has the matching unicode-range.')
    if args.vault:
        text = ''
        for root, _, files in os.walk(args.vault):
            for f in files:
                if f.endswith('.md'):
                    with open(os.path.join(root, f), encoding='utf8') as fh:
                        text += fh.read()
        covered = set()
        for name in FACES:
            covered |= set(TTFont(os.path.join(OUT, name + '.woff2')).getBestCmap())
        missing = sorted({c for c in text if ord(c) > 32 and ord(c) not in covered})
        print('not covered by any font:', ' '.join(f'{c}(U+{ord(c):04X})' for c in missing) or 'nothing')


if __name__ == '__main__':
    sys.exit(main())
