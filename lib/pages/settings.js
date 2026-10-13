import { info } from '../log.js'

// How long a theme choice lasts unless the reader makes it permanent.
const TEMPORARY_HOURS = 12

// The theme icons are placeholders (Font Awesome's) until Joey supplies his own.
const THEMES = [
  ['system', 'System', 'fa-circle-half-stroke'],
  ['light', 'Light', 'fa-sun-bright'],
  ['dark', 'Dark', 'fa-moon']
]

// The reader's choices live in their browser (localStorage), so the page is static and needs
// script. `theme` is {mode, until}: `until` (a time in ms) is absent for a permanent choice, and
// the script in every page's head (layout.ejs) drops a choice past it. `scripture-entries` is
// the commentary pages' switch, which shares it (see commentary.js).
const SCRIPT = `<script>
(function () {
  var form = document.getElementById('settings')
  var notice = document.getElementById('theme-notice')
  var permanent = document.getElementById('theme-permanent')
  var entries = document.getElementById('interleave')

  var theme = null
  try { theme = JSON.parse(localStorage.getItem('theme')) } catch (e) {}
  var mode = theme && (!theme.until || theme.until > Date.now()) ? theme.mode : 'system'
  form.elements.theme.value = mode
  permanent.checked = !!(theme && !theme.until)
  try { entries.checked = localStorage.getItem('scripture-entries') === 'shown' } catch (e) {}

  function saveTheme () {
    var mode = form.elements.theme.value
    notice.hidden = mode === 'system'
    document.getElementById('theme-temporary').hidden = permanent.checked
    document.getElementById('theme-kept').hidden = !permanent.checked
    try {
      if (mode === 'system') localStorage.removeItem('theme')
      else localStorage.setItem('theme', JSON.stringify(permanent.checked ? { mode: mode } : { mode: mode, until: Date.now() + ${TEMPORARY_HOURS} * 3600000 }))
    } catch (e) {}
    window.applyTheme(mode === 'system' ? null : mode)
  }
  saveTheme()
  form.elements.theme.forEach(function (radio) { radio.addEventListener('change', saveTheme) })
  permanent.addEventListener('change', saveTheme)

  entries.addEventListener('change', function () {
    try { localStorage.setItem('scripture-entries', entries.checked ? 'shown' : 'hidden') } catch (e) {}
  })
  form.hidden = false
})()
</script>`

export async function writeSettings ({ output, renderLayout }) {
  const choices = THEMES.map(([value, label, icon]) =>
    `<label><input type="radio" name="theme" value="${value}"><span class="fa-sharp fa-solid ${icon}" aria-hidden="true"></span><span>${label}</span></label>`
  ).join('\n')
  const body = `<p>These settings are kept in this browser, on this device.</p>
<noscript><div class="callout"><p>JavaScript is required for these settings.</p></div></noscript>
<form id="settings" hidden>
<h2>Theme</h2>
<fieldset class="theme-choice">
<legend class="visually-hidden">Theme</legend>
${choices}
</fieldset>
<div id="theme-notice" class="message" hidden>
<p><span id="theme-temporary">This choice is temporary: after ${TEMPORARY_HOURS} hours the site goes back to following your system’s theme.</span><span id="theme-kept">This choice stays until you change it.</span></p>
</div>
<p class="setting-switch"><label><input type="checkbox" role="switch" id="theme-permanent"> Make my theme choice permanent</label></p>
<h2>Commentary pages</h2>
<p class="setting-switch"><label><input type="checkbox" role="switch" id="interleave"> Interleave Scripture index entries on commentary pages</label></p>
<h2>CSS Naked</h2>
<p><a href="/settings?css-naked">View the site without any CSS</a>. The choice is remembered until you use the banner’s link to flip back to the normal view. (On <a href="https://css-naked-day.org">CSS Naked Day</a>, April 9, the site goes naked by itself.)</p>
</form>
${SCRIPT}`
  const html = renderLayout(body, {
    url: '/settings',
    stylesheet: 'settings.css',
    frontmatter: { title: 'Settings', permalink: 'settings' }
  })
  await output.emit('/settings', html)
  info('Built: /settings')
}
