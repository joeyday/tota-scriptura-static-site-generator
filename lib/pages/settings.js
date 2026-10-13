import { info } from '../log.js'

// How long a theme choice lasts unless the reader makes it permanent.
const TEMPORARY_HOURS = 12

// The System tile shows a laptop at the widths that get the sidebar and a phone below (see
// settings.css), so it has two icons.
const icon = (name) => `<span class="fa-sharp fa-solid ${name}" aria-hidden="true"></span>`
const THEMES = [
  ['system', 'System', `<span class="wide">${icon('fa-laptop')}</span><span class="narrow">${icon('fa-mobile-notch')}</span>`],
  ['light', 'Light', icon('fa-sun-bright')],
  ['dark', 'Dark', icon('fa-moon-stars')]
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
  var naked = document.getElementById('css-naked-switch')
  var temporary = document.getElementById('theme-temporary')
  var kept = document.getElementById('theme-kept')
  var left = document.getElementById('theme-left')

  var theme = null
  try { theme = JSON.parse(localStorage.getItem('theme')) } catch (e) {}
  var mode = theme && (!theme.until || theme.until > Date.now()) ? theme.mode : 'system'
  var until = mode !== 'system' && theme.until ? theme.until : 0 // 0: no temporary choice
  form.elements.theme.value = mode
  permanent.checked = !!(theme && !theme.until)
  try { entries.checked = localStorage.getItem('scripture-entries') === 'shown' } catch (e) {}

  // The notice: whether the choice lasts, and if it is temporary, how many whole hours are left
  // (rounded up; it never gets more exact than that).
  function render () {
    notice.hidden = form.elements.theme.value === 'system'
    temporary.hidden = permanent.checked
    kept.hidden = !permanent.checked
    if (until) {
      var hours = Math.ceil((until - Date.now()) / 3600000)
      left.textContent = hours <= 1 ? 'within the hour' : 'in ' + hours + ' hours'
    }
  }

  // A choice made here starts its ${TEMPORARY_HOURS} hours afresh (opening the page doesn't).
  function saveTheme () {
    var mode = form.elements.theme.value
    until = mode === 'system' || permanent.checked ? 0 : Date.now() + ${TEMPORARY_HOURS} * 3600000
    try {
      if (mode === 'system') localStorage.removeItem('theme')
      else localStorage.setItem('theme', JSON.stringify(until ? { mode: mode, until: until } : { mode: mode }))
    } catch (e) {}
    window.applyTheme(mode === 'system' ? null : mode)
    render()
  }
  render()
  form.elements.theme.forEach(function (radio) { radio.addEventListener('change', saveTheme) })
  permanent.addEventListener('change', saveTheme)

  // While the page stays open: count down, and go back to the system's theme when time is up.
  setInterval(function () {
    if (until && until <= Date.now()) {
      form.elements.theme.value = 'system'
      saveTheme()
    } else render()
  }, 30000)

  entries.addEventListener('change', function () {
    try { localStorage.setItem('scripture-entries', entries.checked ? 'shown' : 'hidden') } catch (e) {}
  })
  naked.checked = window.cssNaked.get()
  naked.addEventListener('change', function () { window.cssNaked.set(naked.checked) })
  window.addEventListener('cssnakedchange', function () { naked.checked = window.cssNaked.get() })
  form.hidden = false
})()
</script>`

export async function writeSettings ({ output, renderLayout }) {
  const choices = THEMES.map(([value, label, icons]) =>
    `<label><input type="radio" name="theme" value="${value}">${icons}<span>${label}</span></label>`
  ).join('\n')
  const body = `<p>Your preferences are stored locally in this browser, on this device.</p>
<noscript><div class="callout"><p>JavaScript is required for these settings.</p></div></noscript>
<form id="settings" hidden>
<h2>Theme</h2>
<fieldset class="theme-choice">
<legend class="visually-hidden">Theme</legend>
${choices}
</fieldset>
<p class="setting-switch"><label><input type="checkbox" role="switch" id="theme-permanent"><span>Make my theme choice permanent</span></label></p>
<div id="theme-notice" class="message" hidden>
<p><span id="theme-temporary">This choice is temporary: <span id="theme-left">in ${TEMPORARY_HOURS} hours</span> the site goes back to following your system’s theme.</span><span id="theme-kept">This choice stays until you change it.</span></p>
</div>
<h2>Commentary pages</h2>
<p class="setting-switch"><label><input type="checkbox" role="switch" id="interleave"><span>Interleave Scripture index entries on commentary pages</span></label></p>
<h2>CSS Naked</h2>
<p class="setting-switch"><label><input type="checkbox" role="switch" id="css-naked-switch"><span>View the site without any CSS</span></label></p>
<p>Any day can be <a href="https://css-naked-day.org">CSS Naked Day</a>. On April 9 the site goes naked by itself.</p>
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
