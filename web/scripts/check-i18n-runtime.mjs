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
 *
 * Usage: node scripts/check-i18n-runtime.mjs [--dist <dir>]
 * Relative output paths resolve from web/; Vite previews that same directory.
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { localityFailures } from '../src/i18n/locale-request-locality.mjs'
import { collectProcessOutput } from '../src/i18n/probe-process.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')
const host = '127.0.0.1'
const port = process.env.LOCALE_PROBE_PORT ?? '4184'
const baseURL = `http://${host}:${port}`

export function resolveDistRoot(argv = process.argv.slice(2)) {
  const distFlagIndex = argv.indexOf('--dist')
  const distArgument = distFlagIndex === -1 ? 'dist' : argv[distFlagIndex + 1]
  if (!distArgument || distArgument.startsWith('--')) {
    throw new Error('--dist requires a directory argument')
  }
  return resolve(WEB_ROOT, distArgument)
}

function waitForServer(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let output = ''
    const finish = (error) => {
      clearTimeout(timeout)
      child.stdout.off('data', onOutput)
      child.stderr.off('data', onOutput)
      child.off('exit', onExit)
      child.off('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onOutput = (chunk) => {
      output = (output + chunk.toString()).slice(-8192)
      if (output.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').includes(baseURL)) finish()
    }
    const onExit = (code) => finish(new Error(`preview server exited early with code ${code}`))
    const onError = (error) => finish(error)
    const timeout = setTimeout(() => finish(new Error('preview server did not become ready')), timeoutMs)
    child.stdout.on('data', onOutput)
    child.stderr.on('data', onOutput)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

async function waitForClose(closed, timeoutMs) {
  let timeout
  try {
    return await Promise.race([
      closed.then(() => true),
      new Promise((resolve) => { timeout = setTimeout(() => resolve(false), timeoutMs) }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

export async function main({
  argv = process.argv.slice(2),
  spawnProcess = spawn,
  readyTimeoutMs = 30_000,
  cleanupTimeoutMs = 5_000,
} = {}) {
  const distRoot = resolveDistRoot(argv)
  if (!existsSync(distRoot) || !statSync(distRoot).isDirectory()) {
    throw new Error(`output directory not found: ${distRoot} — run build first`)
  }
  const preview = spawnProcess(
    process.execPath,
    [join(WEB_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', host, '--port', port, '--strictPort', '--outDir', distRoot],
    { cwd: WEB_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const previewClosed = new Promise((resolve) => preview.once('close', resolve))
  try {
    await waitForServer(preview, readyTimeoutMs)
    const probe = spawnProcess(
      process.execPath,
      [join(__dirname, 'probe-i18n-startup.mjs'), '--strict', '--dist', distRoot],
      {
        cwd: WEB_ROOT,
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
      return 1
    }
    if (code !== 0) {
      console.error(`[i18n-runtime] locale probe failed with code ${code ?? 'unknown'}`)
      return code ?? 1
    }
    console.log('[i18n-runtime] fallback locality OK — every route stayed inside its grouped-bundle allowance and request budget')
    return 0
  } finally {
    if (!preview.killed) preview.kill()
    if (!await waitForClose(previewClosed, cleanupTimeoutMs)) {
      preview.kill('SIGKILL')
      if (!await waitForClose(previewClosed, cleanupTimeoutMs)) {
        throw new Error('preview server did not close after cleanup')
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error('[i18n-runtime] lifecycle failed:', error)
    process.exitCode = 1
  })
}
