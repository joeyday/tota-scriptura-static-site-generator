import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TSGEN_DIR = fileURLToPath(new URL('../..', import.meta.url))

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Polls `check` (which may be async) until it returns something truthy; fails after `timeout`.
export async function waitFor (check, { timeout = 30000, what = 'a condition' } = {}) {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${what}`)
    await sleep(50)
  }
}

// A promise of [code, signal] for a child process, kept until its output has all arrived: the
// text a process printed just before it exited can still be in the pipe when 'exit' fires, and
// 'close' (after the pipes end) is the event that comes after it. If something else holds a pipe
// open, don't wait for it for more than a moment.
function exitOf (child) {
  return new Promise((resolve) => {
    let result
    child.once('exit', (code, signal) => {
      result = [code, signal]
      setTimeout(() => resolve(result), 500).unref()
    })
    child.once('close', (code, signal) => resolve([code, signal]))
  })
}

// Makes a change to a watched vault and waits for `until` (a function) to become true; if it
// doesn't within `wait` ms, makes the change again, differently (`change(attempt)` is given the
// attempt number), up to `tries` times. `tsgen serve` says it is serving a moment before its
// watcher is ready, and a slow machine can miss a change made in that moment; a change made
// again is seen.
export async function changeUntil (change, until, { tries = 4, wait = 8000, what = 'the change to be noticed' } = {}) {
  for (let attempt = 0; ; attempt++) {
    await change(attempt)
    try {
      return await waitFor(until, { timeout: wait, what })
    } catch (err) {
      if (attempt + 1 >= tries) throw err
    }
  }
}

// A port nothing is listening on.
export function freePort () {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

// Copies the generator's code to `dir`, so a test can edit it. node_modules is linked.
export async function copyGenerator (dir) {
  await fs.mkdir(dir, { recursive: true })
  for (const name of ['build.js', 'serve.js', 'package.json', 'lib', 'template']) {
    await fs.cp(path.join(TSGEN_DIR, name), path.join(dir, name), { recursive: true })
  }
  await fs.symlink(path.join(TSGEN_DIR, 'node_modules'), path.join(dir, 'node_modules'))
  return path.join(dir, 'build.js')
}

// Runs `tsgen serve` in a scratch vault, in a process group of its own (stop() signals the
// group, as Ctrl-C does). Resolves once it is serving (or has exited):
// { port, output() (stdout and stderr so far), exit (a promise of [code, signal]),
//   url(path), get(path, options), stop(signal) }
// `port` is a number, or `=<number>` to be passed as --port=<number>.
export async function startServe (vault, dist, { args = [], buildJs = path.join(TSGEN_DIR, 'build.js'), env = {}, port: wanted } = {}) {
  const port = typeof wanted === 'string' ? Number(wanted.slice(1)) : wanted ?? await freePort()
  let output = ''
  const portArgs = typeof wanted === 'string' ? [`--port=${port}`] : ['--port', String(port)]
  const child = spawn(process.execPath, [buildJs, 'serve', ...portArgs, ...args], {
    cwd: vault,
    env: { ...process.env, TSGEN_OUT: dist, GITHUB_SHA: 'abcdef0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true // its own process group, so a stop reaches the supervisor's server too
  })
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const exit = exitOf(child)
  let exited = false
  exit.then(() => { exited = true })

  const server = {
    port,
    output: () => output,
    exit,
    url: (p) => `http://127.0.0.1:${port}${p}`,
    get: (p, options) => fetch(server.url(p), options),
    stop: async (signal = 'SIGINT') => {
      if (!exited) process.kill(-child.pid, signal)
      return exit
    },
    // Ctrl-C, then SIGKILL for whatever is still there after a while: the exit is what lets
    // the coverage report count what the process ran.
    close: async () => {
      if (exited) return
      process.kill(-child.pid, 'SIGINT')
      const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 5000)
      await exit
      clearTimeout(timer)
    },
    // The processes whose parent is the supervisor (its server).
    children: () => {
      try {
        return execFileSync('pgrep', ['-P', String(child.pid)], { encoding: 'utf-8' }).split('\n').filter(Boolean).map(Number)
      } catch {
        return []
      }
    },
    pid: child.pid
  }
  await waitFor(() => exited || /Serving .* at http/.test(output), { what: `the server to start:\n${output}` })
  return server
}

// Runs serve.js alone on a built site (see serve-runner.js). Resolves once it is serving or
// has exited: the same shape as startServe, plus reload() and quit() (exit cleanly).
export async function startStatic (dist, { watching = false, port } = {}) {
  port ??= await freePort()
  const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), 'serve-runner.js')
  let output = ''
  const child = spawn(process.execPath, [runner, dist, String(port), watching ? 'watching' : 'static'], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const exit = exitOf(child)
  let exited = false
  exit.then(() => { exited = true })
  const server = {
    port,
    output: () => output,
    exit,
    url: (p) => `http://127.0.0.1:${port}${p}`,
    get: (p, options) => fetch(server.url(p), options),
    reload: () => child.stdin.write('reload\n'),
    close: async () => {
      if (exited) return
      child.stdin.write('stop\n')
      await exit
    }
  }
  await waitFor(() => exited || /READY/.test(output), { what: `the server to start:\n${output}` })
  return server
}
