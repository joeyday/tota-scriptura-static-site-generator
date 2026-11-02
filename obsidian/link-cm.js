import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import { bibleRefsInLine, proseLines } from './find-refs.js'

// ─── Links in the editing view ───
// A CodeMirror extension that marks the Bible references in the note being edited, so they look
// like links (styles.css) and open when clicked. Only the look is added: the text is the text the
// writer typed, so editing a reference is editing it. `active(state)` says whether to mark at all
// (the plugin marks in Live Preview) and `needsModifier()` whether a click must hold Cmd or Ctrl to
// open one (on a desktop, where a click is also how the cursor is placed; a tap on a phone opens).
export function bibleRefExtension ({ active, needsModifier }) {
  function mark (view) {
    if (!active(view.state)) return Decoration.none
    const { doc } = view.state
    const { to } = view.visibleRanges.at(-1) ?? { to: 0 }
    const last = doc.lineAt(to).number
    const lines = []
    for (let n = 1; n <= last; n++) lines.push(doc.line(n).text)
    const prose = proseLines(lines)
    const builder = new RangeSetBuilder()
    for (const { from: start, to: end } of view.visibleRanges) {
      for (let n = doc.lineAt(start).number; n <= doc.lineAt(end).number && n <= last; n++) {
        if (!prose[n - 1]) continue
        const line = doc.line(n)
        for (const ref of bibleRefsInLine(line.text)) {
          builder.add(line.from + ref.from, line.from + ref.to, Decoration.mark({ class: 'cm-bible-ref', attributes: { 'data-href': ref.url } }))
        }
      }
    }
    return builder.finish()
  }

  const marks = ViewPlugin.fromClass(class {
    constructor (view) {
      this.decorations = mark(view)
    }

    update (update) {
      if (update.docChanged || update.viewportChanged || active(update.state) !== active(update.startState)) {
        this.decorations = mark(update.view)
      }
    }
  }, { decorations: (plugin) => plugin.decorations })

  const open = EditorView.domEventHandlers({
    click (event, view) {
      const ref = event.target?.closest?.('.cm-bible-ref')
      if (!ref || !view.state.selection.main.empty) return false
      if (needsModifier() && !(event.metaKey || event.ctrlKey)) return false
      window.open(ref.dataset.href, '_blank')
      return true
    }
  })

  return [marks, open]
}
