/**
* Print
* Fills in the date of the print-only "Retrieved from … on …" line in the footer.
* Without JavaScript the line just omits the date.
*/

function fillPrintDate () {
  const element = document.querySelector('.print-date')
  if (!element) return
  element.textContent = ' on ' + new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

fillPrintDate()
window.addEventListener('beforeprint', fillPrintDate)
