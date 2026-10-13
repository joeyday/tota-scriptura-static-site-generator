/* eslint-env browser */
/**
* CSS Naked
* Strips all styles from the document in two cases:
*   1. The `?css-naked` query param is present (manual toggle).
*   2. It's CSS Naked Day — April 9 anywhere in the world, i.e.
*      from 00:00 Apr 9 UTC+14:00 to 00:00 Apr 10 UTC-12:00
*      (10:00 Apr 8 UTC to 12:00 Apr 10 UTC).
*
* Styles are switched off, not deleted, so they can come back without a reload: stylesheets
* get `media="not all"`, inline `style` attributes are set aside, and the Font Awesome icons
* (inline SVGs) are hidden. `window.cssNaked` has `get()` and `set(naked)` for the settings
* page; a banner offers the way back (or, on the Day, the way in).
*
* This is a classic script in the head, ahead of the stylesheets, so that naked pages never
* paint styled. The user's choice is kept in localStorage: `css-naked` on an ordinary day, and
* `css-naked-<year>` on the Day (a visit then turns it on until the user opts out), so it
* resets each CSS Naked Day.
*/
(function () {
  // localStorage can be missing or throw (private windows, blocked site data);
  // without it a preference simply doesn't persist.
  function readPreference (key) {
    try { return window.localStorage.getItem(key) } catch { return null }
  }
  function writePreference (key, value) {
    try { window.localStorage.setItem(key, value) } catch {}
  }

  // Is it currently CSS Naked Day? 00:00 Apr 9 in UTC+14:00 → Apr 8 10:00 UTC, until
  // 00:00 Apr 10 in UTC-12:00 → Apr 10 12:00 UTC.
  const now = new Date()
  const year = now.getUTCFullYear()
  const isCSSNakedDay = now >= Date.UTC(year, 3, 8, 10, 0, 0) && now < Date.UTC(year, 3, 10, 12, 0, 0)

  // The key that decides today: the year's on the Day, the standing one otherwise.
  const key = isCSSNakedDay ? `css-naked-${now.getFullYear()}` : 'css-naked'

  // `?css-naked` turns it on (and is dropped from the address, so a reload doesn't turn it
  // on again after the user flips back). The first visit on the Day does too.
  if (new URLSearchParams(window.location.search).has('css-naked')) {
    writePreference(key, 'true')
    const url = new URL(window.location.href)
    url.searchParams.delete('css-naked')
    window.history.replaceState(null, '', url)
  } else if (isCSSNakedDay && readPreference(key) === null) {
    writePreference(key, 'true')
  }

  // ─── Switching styles off and on ───

  // What each touched element had: its media (stylesheets) and its style attribute.
  const touched = new Map()
  const BANNER = '[data-css-naked-banner]'

  function strip (el) {
    if (el.closest(BANNER)) return
    const isSheet = el.matches('link[rel~="stylesheet"], style')
    const isIcon = el.matches('svg.svg-inline--fa')
    if (!isSheet && !isIcon && !el.hasAttribute('style')) return
    if (!touched.has(el)) {
      touched.set(el, { media: el.getAttribute('media'), style: el.getAttribute('style') })
    }
    if (isSheet) el.media = 'not all'
    el.removeAttribute('style')
    // Font Awesome's kit swaps each icon for an inline SVG that only its own <style> sizes,
    // so without CSS they would fill the page.
    if (isIcon) el.style.display = 'none'
  }

  function stripWithin (root) {
    if (root.nodeType !== Node.ELEMENT_NODE) return
    strip(root)
    root.querySelectorAll('link[rel~="stylesheet"], style, svg.svg-inline--fa, [style]').forEach(strip)
  }

  // The kit loads late, and the parser is still adding elements: strip those as they arrive.
  const observer = new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach(stripWithin))
  })

  function strippedOn () {
    stripWithin(document.documentElement)
    observer.observe(document, { childList: true, subtree: true })
  }

  function strippedOff () {
    observer.disconnect()
    touched.forEach((was, el) => {
      if (was.media === null) el.removeAttribute('media')
      else el.setAttribute('media', was.media)
      if (was.style === null) el.removeAttribute('style')
      else el.setAttribute('style', was.style)
    })
    touched.clear()
  }

  // ─── The banner ───

  const CSS = '<abbr title="Cascading Style Sheets">CSS</abbr>'
  const DAY = `<a href="https://css-naked-day.org" class="external">${CSS} Naked Day</a>`

  function showBanner () {
    if (!document.body) return
    const old = document.querySelector(BANNER)
    if (old) old.remove()
    const naked = cssNaked.get()
    if (!naked && !isCSSNakedDay) return
    const $alert = document.createElement('div')
    $alert.setAttribute('data-css-naked-banner', '')
    if (naked) {
      // Marked to be skipped, so these inline styles survive the stripping.
      $alert.style.cssText = 'background: lightyellow; padding: 5px; margin: 15px 0;'
      $alert.innerHTML = [
        isCSSNakedDay ? `Happy ${DAY}!` : `You’re viewing the site with all ${CSS} removed.`,
        isCSSNakedDay ? `You’re viewing the site with all ${CSS} removed.` : `Any day can be ${DAY}!`,
        '<a href="./" id="naked-css-toggle">Flip back to the normal view</a>.'
      ].join(' ')
      document.body.prepend($alert)
    } else {
      // It's CSS Naked Day but the user opted out: a way back in.
      $alert.className = 'css-naked-alert'
      $alert.innerHTML = [
        `Happy ${DAY}!`,
        `<a href="./" id="naked-css-toggle" class="internal">View the site without any ${CSS}</a>.`
      ].join(' ')
      document.querySelector('main').prepend($alert)
    }
    $alert.querySelector('#naked-css-toggle').addEventListener('click', (e) => {
      e.preventDefault()
      cssNaked.set(!naked)
    })
  }

  // ─── The page's way in ───

  const cssNaked = window.cssNaked = {
    get () { return readPreference(key) === 'true' },
    set (naked) {
      if (naked === cssNaked.get()) return
      writePreference(key, naked ? 'true' : 'false')
      if (naked) strippedOn()
      else strippedOff()
      showBanner()
      window.dispatchEvent(new Event('cssnakedchange'))
    }
  }

  if (cssNaked.get()) strippedOn()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner)
  else showBanner()
})()
