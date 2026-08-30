import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * App.tsx → routeRegistry.ts freshness gate.
 *
 * `routeRegistry.ts` is the source of truth for privacy-safe route templating
 * on BOTH sides: `web/src/lib/routeTemplate.ts` imports it directly, and
 * `cmd/routetemplategen` mirrors it into `internal/api/webvitals`. A `:param`
 * route added to App.tsx but never regenerated means its opaque value — a
 * share token, a customer slug — is never templated and lands verbatim in a
 * Prometheus label and in buffered error payloads.
 *
 * CI runs `node scripts/generate-route-registry.mjs --check` in the
 * frontend-quality contract job (main + revamped-ui). These specs drive the
 * REAL CLI as a subprocess so they prove the gate actually catches drift,
 * rather than re-implementing its logic and trusting that it does.
 */

const SCRIPT = resolve(process.cwd(), 'scripts', 'generate-route-registry.mjs')
const APP_PATH = resolve(process.cwd(), 'src', 'App.tsx')
const REGISTRY_PATH = resolve(process.cwd(), 'src', 'lib', 'routeRegistry.ts')

const SYNTHETIC_PARAM_ROUTE =
  '<Route path="acceptance-probe/:token" element={<SafeRoute name="AcceptanceProbe"><AcceptanceProbe /></SafeRoute>} />'

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

function runGenerator(args: string[]): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

/** Write a synthetic App.tsx with one extra `:param` route into a temp dir. */
function appWithSyntheticParamRoute(): string {
  const src = readFileSync(APP_PATH, 'utf8')
  const anchor = '<Route path="s/:token"'
  expect(src).toContain(anchor)
  const mutated = src.replace(anchor, `${SYNTHETIC_PARAM_ROUTE}\n      ${anchor}`)
  expect(mutated).not.toBe(src)

  const dir = mkdtempSync(join(tmpdir(), 'routegate-'))
  const path = join(dir, 'App.tsx')
  writeFileSync(path, mutated)
  return path
}

describe('generate-route-registry — freshness gate', () => {
  it('passes against the committed tree', () => {
    const result = runGenerator(['--check'])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('up to date')
  })

  it('FAILS when App.tsx gains a synthetic :param route', () => {
    const syntheticApp = appWithSyntheticParamRoute()
    const result = runGenerator(['--check', '--app', syntheticApp, '--out', REGISTRY_PATH])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('stale')
    expect(result.stderr).toContain('go run ./cmd/routetemplategen')
  })

  it('the regenerated registry contains the new :param route as a parameterised entry', () => {
    const syntheticApp = appWithSyntheticParamRoute()
    const outDir = mkdtempSync(join(tmpdir(), 'routegate-out-'))
    const outPath = join(outDir, 'routeRegistry.ts')

    expect(runGenerator(['--app', syntheticApp, '--out', outPath]).status).toBe(0)

    const generated = readFileSync(outPath, 'utf8')
    // `hidden: true` is how the generator flags a parameterised route.
    expect(generated).toContain(
      "{ path: '/acceptance-probe/:token', name: 'AcceptanceProbe', label: 'Acceptance Probe', i18nKey: 'routes.acceptanceProbe', hidden: true },",
    )
    expect(generated).not.toBe(readFileSync(REGISTRY_PATH, 'utf8'))
  })

  it('is deterministic — two writes produce identical bytes', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'routegate-det-'))
    const a = join(outDir, 'a.ts')
    const b = join(outDir, 'b.ts')
    expect(runGenerator(['--out', a]).status).toBe(0)
    expect(runGenerator(['--out', b]).status).toBe(0)
    expect(readFileSync(a, 'utf8')).toBe(readFileSync(b, 'utf8'))
    // …and identical to what is committed.
    expect(readFileSync(a, 'utf8')).toBe(readFileSync(REGISTRY_PATH, 'utf8'))
  })

  it('FAILS when the committed registry is missing entirely', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'routegate-missing-'))
    const result = runGenerator(['--check', '--out', join(outDir, 'absent.ts')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('stale')
  })
})

describe('generate-route-registry — every :param route reaches the templater', () => {
  it('every parameterised registry entry is templated client-side', async () => {
    const { normalizeRouteTemplate } = await import('../routeTemplate')
    const { ROUTE_REGISTRY } = await import('../routeRegistry')

    const parameterised = ROUTE_REGISTRY.filter(e => e.path.includes('/:'))
    expect(parameterised.length).toBeGreaterThan(0)

    for (const entry of parameterised) {
      const probe = entry.path
        .split('/')
        .map(seg => (seg.startsWith(':') ? 'customer-private-slug' : seg))
        .join('/')
      expect(normalizeRouteTemplate(probe)).not.toContain('customer-private-slug')
    }
  })
})
