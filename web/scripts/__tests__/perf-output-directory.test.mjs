import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { resolveDistRoot as pwaDistRoot } from '../check-pwa-precache.mjs'
import { resolveDistRoot as shellDistRoot, sourcePath } from '../check-i18n-shell-closure.mjs'
import { main as runRuntime, resolveDistRoot as runtimeDistRoot } from '../check-i18n-runtime.mjs'
import { localeByteSummary } from '../probe-i18n-startup.mjs'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtureRoot = join(WEB_ROOT, 'scripts', '__tests__', `.perf-output-directory-fixtures-${process.pid}`)
const privateDist = join(fixtureRoot, 'private output')
mkdirSync(join(privateDist, 'assets'), { recursive: true })
after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

const checkers = [
  ['check-pwa-precache.mjs', pwaDistRoot],
  ['check-i18n-shell-closure.mjs', shellDistRoot],
  ['check-i18n-runtime.mjs', runtimeDistRoot],
  ['probe-i18n-startup.mjs', runtimeDistRoot],
]

function checkCLI(script, args) {
  return spawnSync(process.execPath, [join(WEB_ROOT, 'scripts', script), ...args], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    timeout: 10_000,
  })
}

for (const [script, resolveDistRoot] of checkers) {
  test(`${script}: default and relative paths use web root, absolute private paths survive`, () => {
    assert.equal(resolveDistRoot([]), join(WEB_ROOT, 'dist'))
    assert.equal(resolveDistRoot(['--dist', 'isolated-output']), join(WEB_ROOT, 'isolated-output'))
    assert.equal(resolveDistRoot(['--dist', privateDist]), privateDist)
  })

  test(`${script}: missing and flag-shaped directory arguments fail explicitly`, () => {
    for (const args of [['--dist'], ['--dist', '--strict'], ['--dist', '']]) {
      assert.throws(() => resolveDistRoot(args), /--dist requires a directory argument/)
      const result = checkCLI(script, args)
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, /--dist requires a directory argument/)
    }
  })

  test(`${script}: nonexistent paths and files fail before reading or spawning`, () => {
    const file = join(fixtureRoot, `${script}.not-a-directory`)
    writeFileSync(file, '')
    for (const path of [join(fixtureRoot, 'missing'), file]) {
      const result = checkCLI(script, ['--dist', path])
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, /output directory not found/)
      assert.ok(result.stderr.includes(path), result.stderr)
    }
  })
}

test('PWA gate reads an external output with spaces without touching the default build', () => {
  writeFileSync(join(privateDist, 'offline.html'), '<html>offline fixture</html>')
  writeFileSync(join(privateDist, 'sw.js'), [
    '{"revision":null,"url":"offline.html"}',
    'i18n-locale-assets',
    'app-route-assets',
  ].join('\n'))
  for (const path of [privateDist, relative(WEB_ROOT, privateDist)]) {
    const result = checkCLI('check-pwa-precache.mjs', ['--dist', path])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /1 install assets/)
    assert.match(result.stdout, /OK — route chunks remain on-demand/)
  }
})

test('PWA gate still rejects a missing manifest asset in the selected output', () => {
  const invalidDist = join(fixtureRoot, 'invalid-pwa')
  mkdirSync(invalidDist)
  writeFileSync(join(invalidDist, 'sw.js'), [
    '{"revision":null,"url":"offline.html"}',
    'i18n-locale-assets',
    'app-route-assets',
  ].join('\n'))
  const result = checkCLI('check-pwa-precache.mjs', ['--dist', invalidDist])
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /manifest entries are missing from dist: offline.html/)
})

test('shell closure checks the selected assets directory without relying on mutable catalogs', () => {
  const selectedDist = join(fixtureRoot, 'shell without assets')
  mkdirSync(selectedDist)
  for (const path of [selectedDist, relative(WEB_ROOT, selectedDist)]) {
    const result = checkCLI('check-i18n-shell-closure.mjs', ['--dist', path])
    assert.equal(result.status, 1, result.stderr)
    assert.ok(result.stderr.includes(join(selectedDist, 'assets')), result.stderr)
    assert.match(result.stderr, /missing; run build first/)
  }
})

test('external sourcemap sources still resolve into the original web source namespace', () => {
  const expected = join(WEB_ROOT, 'src', 'components', 'ui', 'Button.tsx')
  for (const source of [
    '../../src/components/ui/Button.tsx',
    'file:///private-build/web/src/components/ui/Button.tsx',
    'F:\\private-build\\web\\src\\components\\ui\\Button.tsx',
  ]) assert.equal(sourcePath(source), expected)
  assert.equal(sourcePath('../../node_modules/package/index.js'), null)
})

// Only the child-process transport is substituted; readiness, argument wiring,
// drained probe output, locality validation and cleanup run in the real checker.
function childProcess() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = false
  child.closed = false
  child.signals = []
  child.kill = (signal = 'SIGTERM') => {
    child.signals.push(signal)
    child.killed = true
    child.emit('exit', null, signal)
    setImmediate(() => {
      child.closed = true
      child.emit('close', null, signal)
    })
    return true
  }
  return child
}

const validReport = ['cold NotFound', 'Dashboard', 'Drives', 'Charging', 'Vehicles']
  .map((route) => `[i18n-runtime] ${route}: 0 deferred locale requests\n`).join('')

function runtimeHarness({ ready = true, probeCode = 0, report = validReport, previewError, probeError } = {}) {
  const preview = childProcess()
  const probe = childProcess()
  const calls = []
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options })
    if (calls.length === 1) {
      setImmediate(() => {
        if (previewError) {
          preview.emit('error', previewError)
          preview.closed = true
          preview.emit('close', null)
        } else if (ready === 'exit') {
          preview.emit('exit', 7)
          preview.closed = true
          preview.emit('close', 7)
        } else if (ready) {
          const url = `http://127.0.0.1:${process.env.LOCALE_PROBE_PORT ?? '4184'}`
          preview.stdout.write(`  Local: \u001b[32m${url.slice(0, 10)}`)
          preview.stdout.write(`${url.slice(10)}\u001b[0m/\n`)
        }
      })
      return preview
    }
    setImmediate(() => {
      if (probeError) {
        probe.emit('error', probeError)
        probe.emit('close', null)
        return
      }
      probe.emit('exit', probeCode)
      setImmediate(() => {
        probe.stdout.write(report)
        probe.emit('close', probeCode)
      })
    })
    return probe
  }
  return { preview, probe, calls, spawnProcess }
}

test('runtime preview propagates the private output and waits for readiness and actual close', async () => {
  for (const path of [privateDist, relative(WEB_ROOT, privateDist)]) {
    const harness = runtimeHarness()
    const code = await runRuntime({ argv: ['--dist', path], spawnProcess: harness.spawnProcess })
    assert.equal(code, 0)
    assert.equal(harness.calls.length, 2)
    const [preview, probe] = harness.calls
    assert.equal(preview.command, process.execPath)
    assert.deepEqual(preview.args, [
      join(WEB_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      'preview', '--host', '127.0.0.1', '--port', process.env.LOCALE_PROBE_PORT ?? '4184',
      '--strictPort', '--outDir', privateDist,
    ])
    assert.equal(preview.options.cwd, WEB_ROOT)
    assert.deepEqual(probe.args, [join(WEB_ROOT, 'scripts', 'probe-i18n-startup.mjs'), '--strict', '--dist', privateDist])
    assert.equal(probe.args.at(-1), preview.args.at(-1))
    assert.equal(probe.options.env.LOCALE_PROBE_BASE_URL, `http://127.0.0.1:${process.env.LOCALE_PROBE_PORT ?? '4184'}`)
    assert.equal(harness.preview.closed, true)
    assert.deepEqual(harness.preview.signals, ['SIGTERM'])
    assert.equal(harness.preview.stdout.listenerCount('data'), 0)
    assert.equal(harness.preview.stderr.listenerCount('data'), 0)
    assert.equal(harness.preview.listenerCount('error'), 0)
    assert.equal(harness.preview.listenerCount('exit'), 0)
  }
})

test('nested probe measures exact raw and gzip bytes from the runtime-selected private output', async () => {
  const name = 'locale-detail-fixture-private-12345678.js'
  const contents = Buffer.from('export const privateLocale = "selected private output";\n')
  writeFileSync(join(privateDist, 'assets', name), contents)
  for (const path of [privateDist, relative(WEB_ROOT, privateDist)]) {
    const harness = runtimeHarness()
    assert.equal(await runRuntime({ argv: ['--dist', path], spawnProcess: harness.spawnProcess }), 0)
    const probeArgs = harness.calls[1].args.slice(1)
    const selectedOutput = runtimeDistRoot(probeArgs)
    assert.equal(selectedOutput, privateDist)
    assert.deepEqual(localeByteSummary([`/assets/${name}`], selectedOutput), [
      `${name} (${contents.length} raw / ${gzipSync(contents).length} gzip bytes)`,
    ])
  }
})

test('nested probe never falls back to the default output when a selected asset is missing', () => {
  const missingName = 'locale-detail-does-not-exist-12345678.js'
  assert.throws(() => localeByteSummary([`/assets/${missingName}`], privateDist), (error) => {
    assert.equal(error.code, 'ENOENT')
    assert.equal(error.path, join(privateDist, 'assets', missingName))
    return true
  })
  assert.deepEqual(localeByteSummary([], privateDist), [])
})

test('runtime rejects invalid output before spawning a preview', async () => {
  for (const argv of [['--dist'], ['--dist', join(fixtureRoot, 'missing')]]) {
    const harness = runtimeHarness()
    await assert.rejects(runRuntime({ argv, spawnProcess: harness.spawnProcess }))
    assert.equal(harness.calls.length, 0)
  }
})

test('runtime readiness timeout, early exit and spawn errors clean up without starting the probe', async () => {
  for (const [options, expected] of [
    [{ ready: false }, /did not become ready/],
    [{ ready: 'exit' }, /exited early with code 7/],
    [{ previewError: new Error('fixture spawn failure') }, /fixture spawn failure/],
  ]) {
    const harness = runtimeHarness(options)
    await assert.rejects(runRuntime({
      argv: ['--dist', privateDist],
      spawnProcess: harness.spawnProcess,
      readyTimeoutMs: 10,
    }), expected)
    assert.equal(harness.calls.length, 1)
    assert.equal(harness.preview.closed, true)
    assert.equal(harness.preview.stdout.listenerCount('data'), 0)
    assert.equal(harness.preview.listenerCount('error'), 0)
  }
})

test('runtime retains probe failure exit status and reads locality violations after exit', async () => {
  for (const [options, expected] of [
    [{ probeCode: 9 }, 9],
    [{ report: validReport.replace('Drives: 0 deferred locale requests', 'Drives: 1 deferred locale requests /assets/locale-battery-12345678.js') }, 1],
    [{ report: '' }, 1],
  ]) {
    const harness = runtimeHarness(options)
    const code = await runRuntime({ argv: ['--dist', privateDist], spawnProcess: harness.spawnProcess })
    assert.equal(code, expected)
    assert.equal(harness.preview.closed, true)
  }
})

test('runtime probe spawn failure still waits for preview cleanup', async () => {
  const harness = runtimeHarness({ probeError: new Error('fixture probe spawn failure') })
  await assert.rejects(runRuntime({
    argv: ['--dist', privateDist], spawnProcess: harness.spawnProcess,
  }), /fixture probe spawn failure/)
  assert.equal(harness.calls.length, 2)
  assert.equal(harness.preview.closed, true)
})

test('runtime cleanup escalates and fails explicitly when a child never closes', async () => {
  for (const closesOnKill of [true, false]) {
    const harness = runtimeHarness()
    harness.preview.kill = (signal = 'SIGTERM') => {
      harness.preview.killed = true
      harness.preview.signals.push(signal)
      if (signal === 'SIGKILL' && closesOnKill) {
        setImmediate(() => {
          harness.preview.closed = true
          harness.preview.emit('close', null, signal)
        })
      }
      return true
    }
    const result = runRuntime({
      argv: ['--dist', privateDist],
      spawnProcess: harness.spawnProcess,
      cleanupTimeoutMs: 10,
    })
    if (closesOnKill) assert.equal(await result, 0)
    else await assert.rejects(result, /did not close after cleanup/)
    assert.deepEqual(harness.preview.signals, ['SIGTERM', 'SIGKILL'])
  }
})
