/**
* Abbreviation popover
* Touch screens have no hover, so an abbreviation's `title` can't be reached. On a device
* without hover, a tap on `abbr[title]` shows the title in one shared popover (the Popover API:
* it sits in the top layer, and a tap elsewhere or Escape closes it). The `title` stays for
* hover and for screen readers. Abbreviations get no tab stop, and one inside a link leaves
* the tap to the link. Without JavaScript nothing changes.
*/

const MARGIN = 8 // the closest the popover comes to the edge of the screen, in px
const GAP = 6 // between the abbreviation and the popover

let popover = null
let current = null // the abbreviation the popover was last opened for
let openAtPress = null // the abbreviation whose popover was open when the current tap began

function getPopover () {
  if (popover) return popover
  popover = document.createElement('div')
  popover.id = 'abbr-popover'
  popover.popover = 'auto'
  document.body.append(popover)
  return popover
}

// The line box of the abbreviation under the tap (it can wrap onto several lines).
function rectAt (abbr, x, y) {
  const rects = [...abbr.getClientRects()]
  return rects.find((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) || rects[0]
}

function show (abbr, x, y) {
  const box = getPopover()
  if (box.matches(':popover-open')) box.hidePopover()
  box.textContent = abbr.title
  // Positioned by hand, below the abbreviation (above it when there is no room), centered on it
  // and kept on screen. Inline, so the popover works wherever the stylesheet doesn't reach.
  box.style.cssText = 'position: fixed; inset: auto; margin: 0; top: 0; left: 0;'
  box.showPopover()
  current = abbr
  const target = rectAt(abbr, x, y)
  const width = box.offsetWidth
  const height = box.offsetHeight
  const below = target.bottom + GAP + height + MARGIN <= window.innerHeight
  const left = Math.min(Math.max(target.left + target.width / 2 - width / 2, MARGIN), window.innerWidth - width - MARGIN)
  box.style.top = `${below ? target.bottom + GAP : Math.max(target.top - GAP - height, MARGIN)}px`
  box.style.left = `${Math.max(left, MARGIN)}px`
}

// A tap on the abbreviation that is open light-dismisses the popover before the click arrives,
// and the click would open it again. Note what was open as the tap begins, so that tap can
// leave it closed.
document.addEventListener('pointerdown', () => {
  openAtPress = popover && popover.matches(':popover-open') ? current : null
}, true)

document.addEventListener('click', (event) => {
  if (!window.matchMedia('(hover: none)').matches) return
  const abbr = event.target.closest && event.target.closest('abbr[title]')
  if (!abbr || abbr.closest('a') || !abbr.title) return
  if (abbr === openAtPress) return
  show(abbr, event.clientX, event.clientY)
})

// Where the popover opened is no longer where the abbreviation is.
const hide = () => { if (popover && popover.matches(':popover-open')) popover.hidePopover() }
window.addEventListener('scroll', hide, { passive: true })
window.addEventListener('resize', hide)
