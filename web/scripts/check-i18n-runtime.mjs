#!/usr/bin/env node
/**
 * Owns the preview lifecycle for the headless locale probe so perf gates do
 * not depend on, or leave behind, a developer server.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
        stdio: 'inherit',
      },
    )
    const code = await new Promise((resolve) => probe.once('exit', resolve))
    process.exitCode = code ?? 1
  } finally {
    if (!preview.killed) preview.kill()
  }
}

main().catch((error) => {
  console.error('[i18n-runtime] lifecycle failed:', error)
  process.exit(1)
})
