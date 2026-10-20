// Runs serve.js (not the whole CLI) so a test can talk to the preview server and then stop
// it with process.exit(), which is what lets the coverage report count what it ran.
// Usage: node serve-runner.js <dir> <port> <static|watching>. Reads commands on stdin:
// "reload" tells open pages to reload, "stop" exits.
import { serve } from '../../serve.js'

const [dir, port, mode] = process.argv.slice(2)
try {
  const { reloadPages } = await serve(dir, Number(port), { watching: mode === 'watching' })
  console.log('READY')
  process.stdin.on('data', (data) => {
    for (const command of String(data).split('\n')) {
      if (command === 'reload') reloadPages()
      if (command === 'stop') process.exit(0)
    }
  })
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
