#!/usr/bin/env node
/**
 * Owns the preview lifecycle for the headless locale probe so perf gates do
 * not depend on, or leave behind, a developer server.
 *
 * On top of the probe's own pass/fail it enforces fallback locality: a route
 * may pull the grouped bundle its own feature owns, plus any number of
 * per-namespace `locale-detail-*` chunks. Downloading another feature's
 * grouped catalog (battery strings while rendering Drives, for example) fails
 * the gate even when the request count stays inside the probe's cap, and a
 * cold NotFound hit must download nothing at all.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { localityFailures } from '../src/i18n/locale-request-locality.mjs'
import { collectProcessOutput } from '../src/i18n/probe-process.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const host = '127.0.0.1'
const port = process.env.LOCALE_PROBE_PORT ?? '4184'
const baseURL = `http://${host}:${port}`

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('preview server did not become ready')), 30_000)
    const onOutput = (chunk) => {
      const output = chunk.toString().replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      if (output.includes(baseURL)) {
        clearTimeout(timeout)
        resolve()
      }
    }
    child.stdout.on('data', onOutput)
    child.stderr.on('data', onOutput)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`preview server exited early with code ${code}`))
    })
  })
}

async function main() {
  const preview = spawn(
    process.execPath,
    [join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', host, '--port', port, '--strictPort'],
    { cwd: join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] },
  )
  try {
    await waitForServer(preview)
    const probe = spawn(
      process.execPath,
      [join(__dirname, 'probe-i18n-startup.mjs'), '--strict'],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, LOCALE_PROBE_BASE_URL: baseURL },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    // The probe's report is the gate's only evidence, so completion is taken
    // from `close` (all stdio drained) rather than `exit` (process gone,
    // pipes possibly still buffered).
    const { code, output } = await collectProcessOutput(probe, {
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    })
    const failures = localityFailures(output)
    if (failures.length > 0) {
      console.error(`[i18n-runtime] fallback locality violations:\n  - ${failures.join('\n  - ')}`)
      process.exitCode = 1
      return
    }
    console.log('[i18n-runtime] fallback locality OK — every route stayed inside its grouped-bundle allowance and request budget')
    process.exitCode = code ?? 1
  } finally {
    if (!preview.killed) preview.kill()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[i18n-runtime] lifecycle failed:', error)
    process.exit(1)
  })
}
