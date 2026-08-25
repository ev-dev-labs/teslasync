#!/usr/bin/env node
/**
 * Performance baseline measurement.
 *
 * Builds the app, serves it with `vite preview`, then drives Lighthouse
 * (via npx) against each route in ROUTES. Writes the resulting metrics
 * to web/perf-baseline.json so future PRs can diff against it.
 *
 * Usage:
 * cd web
 * npm run perf:baseline
 *
 * Requires Chrome / Chromium to be installed on the host. Lighthouse
 * itself is fetched via `npx -y lighthouse@latest`, so no permanent
 * dev-dependency is added — keep the install lean.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { gzipSync } from 'node:zlib'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  findEntryAssetNames,
  findModulePreloadAssetNames,
} from './bundle-assets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')
const BASELINE_PATH = join(WEB_ROOT, 'perf-baseline.json')
const DIST_DIR = join(WEB_ROOT, 'dist')
const PREVIEW_PORT = 4173
const VITE_BIN = join(WEB_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

const ROUTES = [
  '/',
  '/vehicles',
  '/drives',
  '/analytics',
  '/charging',
  '/battery',
]

function log(...args) {
  console.log('[perf:baseline]', ...args)
}

function npmCliPath(command) {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    return command === 'npx'
      ? join(dirname(npmExecPath), 'npx-cli.js')
      : npmExecPath
  }

  const candidate = join(
    dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    `${command}-cli.js`,
  )
  return existsSync(candidate) ? candidate : null
}

function buildIfNeeded() {
  if (existsSync(DIST_DIR) && existsSync(join(DIST_DIR, 'index.html'))) {
    log('reusing existing dist/ — delete to force a fresh build')
    return
  }
  log('running `npm run build`')
  const npmCli = npmCliPath('npm')
  const r = npmCli
    ? spawnSync(process.execPath, [npmCli, 'run', 'build'], {
        cwd: WEB_ROOT,
        stdio: 'inherit',
      })
    : spawnSync('npm', ['run', 'build'], {
        cwd: WEB_ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      })
  if (r.status !== 0) {
    throw new Error(`npm run build failed (exit ${r.status})`)
  }
}

function startPreview() {
  log(`starting vite preview on :${PREVIEW_PORT}`)
  const proc = spawn(process.execPath, [VITE_BIN, 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
    cwd: WEB_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', (d) => process.stdout.write(`[preview] ${d}`))
  proc.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  return proc
}

async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      /* not yet */
    }
    await sleep(500)
  }
  throw new Error(`server at ${url} did not become ready in ${attempts * 500}ms`)
}

function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.platform === 'win32'
      ? join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.platform === 'win32'
      ? join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : null,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

async function reservePort() {
  const server = createServer()
  server.unref()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('unable to reserve a Chrome debugging port')
  }
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()))
  })
  return address.port
}

async function startChrome() {
  const chromePath = resolveChromePath()
  if (!chromePath) {
    log('Chrome path not found; Lighthouse will use its own launcher')
    return null
  }

  const port = await reservePort()
  const profileDir = join(tmpdir(), `teslasync-lighthouse-${process.pid}-${Date.now()}`)
  mkdirSync(profileDir, { recursive: true })
  log(`starting shared headless Chrome on :${port}`)
  const proc = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  let stderr = ''
  proc.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })

  try {
    await waitForServer(`http://127.0.0.1:${port}/json/version`, 60)
    return { proc, port, profileDir }
  } catch (error) {
    proc.kill()
    throw new Error(`headless Chrome failed to start: ${stderr || error.message}`)
  }
}

async function stopChrome(session) {
  if (!session) return
  log('stopping shared headless Chrome')
  if (session.proc.exitCode === null) {
    session.proc.kill()
    await Promise.race([once(session.proc, 'exit'), sleep(5_000)])
  }
  try {
    rmSync(session.profileDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    })
  } catch (error) {
    log(`could not remove Chrome profile ${session.profileDir}: ${error.message}`)
  }
}

function runLighthouse(url, chromePort) {
  log(`lighthouse ${url}`)
  const args = [
    '-y', 'lighthouse@latest',
    url,
    '--quiet',
    '--output=json',
    '--only-categories=performance',
    '--max-wait-for-load=45000',
  ]
  if (chromePort) {
    args.push(`--port=${chromePort}`)
  } else {
    args.push('--chrome-flags=--headless=new --no-sandbox --disable-gpu')
  }

  const npxCli = npmCliPath('npx')
  const r = npxCli
    ? spawnSync(process.execPath, [npxCli, ...args], {
        cwd: WEB_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
      })
    : spawnSync('npx', args, {
        cwd: WEB_ROOT,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
      })
  if (r.status !== 0) {
    console.error(r.stderr)
    if (r.error) console.error(r.error)
    throw new Error(`lighthouse failed for ${url} (exit ${r.status})`)
  }
  const json = JSON.parse(r.stdout)
  const audits = json.audits ?? {}
  const num = (k) => (audits[k]?.numericValue ?? null)
  return {
    fcp: num('first-contentful-paint'),
    lcp: num('largest-contentful-paint'),
    tbt: num('total-blocking-time'),
    cls: num('cumulative-layout-shift'),
    tti: num('interactive'),
    speedIndex: num('speed-index'),
    transferKB: Math.round(((audits['total-byte-weight']?.numericValue ?? 0) / 1024) * 100) / 100,
  }
}

function summariseBundle() {
  const assetsDir = join(DIST_DIR, 'assets')
  if (!existsSync(assetsDir)) {
    return {
      totalGzippedJsKB: null,
      entryGzippedKB: null,
      initialGzippedJsKB: null,
      chunkCount: null,
    }
  }
  const files = readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
  const entryNames = findEntryAssetNames(DIST_DIR)
  const preloadedNames = findModulePreloadAssetNames(DIST_DIR)
  let totalGz = 0
  let entryGz = 0
  let initialGz = 0
  for (const f of files) {
    const buf = readFileSync(join(assetsDir, f))
    const gz = gzipSync(buf).length
    totalGz += gz
    if (entryNames.has(f)) entryGz += gz
    if (entryNames.has(f) || preloadedNames.has(f)) initialGz += gz
  }
  const kb = (n) => Math.round((n / 1024) * 100) / 100
  return {
    totalGzippedJsKB: kb(totalGz),
    entryGzippedKB: entryNames.size > 0 ? kb(entryGz) : null,
    initialGzippedJsKB: entryNames.size > 0 ? kb(initialGz) : null,
    chunkCount: files.length,
  }
}

async function main() {
  buildIfNeeded()
  if (!existsSync(DIST_DIR)) {
    throw new Error('dist/ not found — build must succeed first')
  }
  if (!statSync(DIST_DIR).isDirectory()) {
    throw new Error('dist/ exists but is not a directory')
  }

  mkdirSync(dirname(BASELINE_PATH), { recursive: true })

  const preview = startPreview()
  let exitCode = 0
  try {
    await waitForServer(`http://localhost:${PREVIEW_PORT}/`)
    const routeResults = {}
    for (const route of ROUTES) {
      let chrome = null
      try {
        chrome = await startChrome()
        routeResults[route] = runLighthouse(
          `http://localhost:${PREVIEW_PORT}${route}`,
          chrome?.port,
        )
      } catch (err) {
        log(`route ${route} failed:`, err.message)
        routeResults[route] = { error: err.message }
        exitCode = 1
      } finally {
        await stopChrome(chrome)
      }
    }

    const baseline = {
      $schema: './perf-baseline.schema.json',
      comment: 'Performance baseline — regenerated by `npm run perf:baseline`. Phase 40 / Prompt 35.',
      generatedAt: new Date().toISOString(),
      lighthouseVersion: 'latest (via npx)',
      build: summariseBundle(),
      routes: routeResults,
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n')
    log(`wrote ${BASELINE_PATH}`)
  } finally {
    log('stopping preview server')
    preview.kill()
  }
  process.exit(exitCode)
}

main().catch((err) => {
  console.error('[perf:baseline] fatal:', err)
  process.exit(1)
})
