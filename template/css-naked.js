/* eslint-env browser */
/**
* CSS Naked
* Strips all styles from the document in two cases:
*   1. The `?css-naked` query param is present (manual toggle).
*   2. It's CSS Naked Day — April 9 anywhere in the world, i.e.
*      from 00:00 Apr 9 UTC+14:00 to 00:00 Apr 10 UTC-12:00
*      (10:00 Apr 8 UTC to 12:00 Apr 10 UTC).
*
* The user can always toggle back via a banner link. Their preference
* is stored in localStorage scoped to the current year, so it resets
* each CSS Naked Day.
*/

// localStorage can be missing or throw (private windows, blocked site data);
// without it a preference simply doesn't persist.
function readPreference (key) {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function writePreference (key, value) {
  try { window.localStorage.setItem(key, value) } catch {}
}

// Determine if the user has explicitly toggled CSS Naked on with
// the css-naked parameter, and, if so, store their preference
let cssNakedPreference = readPreference('css-naked')
if (new URLSearchParams(window.location.search).has('css-naked')) {
  cssNakedPreference = 'true'
  writePreference('css-naked', 'true')
}

// Determine if it is currently CSS Naked Day
const isCSSNakedDay = (function (now) {
  const year = now.getUTCFullYear()

  // 00:00 Apr 9 in UTC+14:00 → Apr 8 10:00 UTC
  const start = Date.UTC(year, 3, 8, 10, 0, 0)
  // 00:00 Apr 10 in UTC-12:00 → Apr 10 12:00 UTC
  const end = Date.UTC(year, 3, 10, 12, 0, 0)

  return now >= start && now < end
})(new Date())

// Determine whether the user has opted out of CSS Naked Day
const cssNakedDayPreferenceKey = `css-naked-${new Date().getFullYear()}`
let cssNakedDayPreference = readPreference(cssNakedDayPreferenceKey)
if (isCSSNakedDay && cssNakedDayPreference === null) {
  cssNakedDayPreference = 'true'
  writePreference(cssNakedDayPreferenceKey, 'true')
}

if ((!isCSSNakedDay && cssNakedPreference === 'true') || (isCSSNakedDay && cssNakedDayPreference === 'true')) {
  // Remove all styles from external stylesheets or embedded <style> tags
  Array.from(document.querySelectorAll('style,link[rel="stylesheet"]'))
    .forEach(($node) => { $node.remove() })

  // Remove all styles from inline attributes
  Array.from(document.querySelectorAll('[style]'))
    .forEach(($node) => { $node.setAttribute('style', '') })

  // Font Awesome's kit loads late: it swaps each icon for an inline SVG that only
  // its own <style> sizes, so without CSS they would fill the page. Drop both
  // as they arrive.
  const removeLateStyling = () => {
    document.querySelectorAll('svg.svg-inline--fa, style').forEach(($node) => { $node.remove() })
  }
  new MutationObserver(removeLateStyling).observe(document.documentElement, { childList: true, subtree: true })

  // Embed a banner at the top indicating you are in "css-naked" mode
  const $alert = document.createElement('div')

  $alert.innerHTML = [
    isCSSNakedDay
      ? 'Happy <a href="https://css-naked-day.org"><abbr title="Cascading Style Sheets">CSS</abbr> Naked Day</a>!'
      : 'You’re viewing the site with all <abbr title="Cascading Style Sheets">CSS</abbr> removed.',
    isCSSNakedDay
      ? 'You’re viewing the site with all <abbr title="Cascading Style Sheets">CSS</abbr> removed.'
      : 'Any day can be <a href="https://css-naked-day.org"><abbr title="Cascading Style Sheets">CSS</abbr> Naked Day</a>!',
    '<a href="./" id="naked-css-toggle">Flip back to the normal view</a>.'
  ].join(' ')

  $alert.style.cssText = 'background: lightyellow; padding: 5px; margin: 15px 0;'

  $alert.querySelector('#naked-css-toggle').addEventListener('click', (e) => {
    e.preventDefault()
    if (isCSSNakedDay) writePreference(cssNakedDayPreferenceKey, 'false')
    else writePreference('css-naked', 'false')
    window.location.href = window.location.href.split('?')[0]
  })

  document.body.prepend($alert)
} else if (isCSSNakedDay) {
  // It's CSS Naked Day but the user opted out —
  // show a banner so they can easily toggle back to naked mode.
  const $alert = document.createElement('div')

  $alert.innerHTML = [
    'Happy <a href="https://css-naked-day.org" class="external"><abbr title="Cascading Style Sheets">CSS</abbr> Naked Day</a>!',
    '<a href="./" id="naked-css-toggle" class="internal">View the site without any <abbr title="Cascading Style Sheets">CSS</abbr></a>.'
  ].join(' ')

  $alert.className = 'css-naked-alert'

  $alert.querySelector('#naked-css-toggle').addEventListener('click', (e) => {
    e.preventDefault()
    writePreference(cssNakedDayPreferenceKey, 'true')
    window.location.href = window.location.href.split('?')[0]
  })

  document.querySelector('main').prepend($alert)
}
