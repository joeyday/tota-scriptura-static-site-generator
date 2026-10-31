/* global ResizeObserver */
/**
* Tables that fit
* A table that is wider than the page scrolls sideways inside its `.table-scroll` wrapper
* (`overflow-x: auto`). But a wrapper that scrolls is also what a sticky header row sticks to, and it
* never scrolls up and down, so the header row would never stick to the top of the screen. A table that
* fits its wrapper has nothing to scroll, so its wrapper is marked `fits` and style.css lifts its
* overflow. A table that doesn't fit (a phone) keeps scrolling, with its header row. Without JavaScript
* the wrappers scroll as before.
*/

const wrappers = [...document.querySelectorAll('.table-scroll')]

// With the overflow lifted, scrollWidth still counts what spills out of the wrapper, so the same test
// takes the mark off again when the page narrows.
const check = (wrapper) => wrapper.classList.toggle('fits', wrapper.scrollWidth <= wrapper.clientWidth)

if (wrappers.length) {
  const observer = new ResizeObserver((entries) => {
    for (const { target } of entries) check(target.matches('.table-scroll') ? target : target.parentElement)
  })
  for (const wrapper of wrappers) {
    check(wrapper)
    // The wrapper changes with the page, the table with its fonts loading or its text size.
    observer.observe(wrapper)
    observer.observe(wrapper.firstElementChild)
  }
}
