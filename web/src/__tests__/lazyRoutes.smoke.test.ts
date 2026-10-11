import { describe, it, expect } from 'vitest'
import { LAZY_ROUTE_IMPORTS } from './lazyRoutes.list'
import { lazyBindings } from './lazyRoutes.parse'
import * as routeLoaders from '../lib/routeLoaders'

/**
 * Lazy-route bundle smoke test.
 *
 * Walks every lazy chunk wired into `App.tsx` (mirrored in
 * `lazyRoutes.list.ts`) and dynamically imports it. The intent is to
 * surface module-eval-time crashes — e.g. the production
 * "L is not defined" leaflet-plugin bug — that pass `tsc`, `eslint`,
 * and unit tests because the chunks are never imported in CI.
 *
 * Each route gets its own `it()` so failures point at a specific
 * chunk in the test report instead of a single combined failure.
 *
 * Per-test timeout is generous (30s) because Vite's first-hit transform
 * for a heavy chunk (Dashboard pulls in recharts + framer-motion + the
 * dashboard widget registry) can exceed the 5s default when the rest of
 * the suite is competing for the same transform pipeline. We're not
 * measuring perf here — just that import doesn't throw — so a long
 * ceiling is fine.
 */
const IMPORT_TIMEOUT_MS = 30_000
const sharedLoaders = new Map(Object.entries(routeLoaders))

describe('lazy route bundles boot without throwing', () => {
  for (const route of LAZY_ROUTE_IMPORTS) {
    it(
      `${route.name} chunk imports without throwing`,
      async () => {
        await expect(route.load()).resolves.toBeDefined()
        const sharedLoader = sharedLoaders.get(route.name)
        if (sharedLoader) {
          await expect(sharedLoader()).resolves.toHaveProperty('default', expect.any(Function))
        }
      },
      IMPORT_TIMEOUT_MS,
    )
  }

  it('parity check: lazy list count matches App.tsx', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, '../App.tsx'), 'utf8')
    const loaderSource = readFileSync(resolve(here, '../lib/routeLoaders.ts'), 'utf8')
    const lazyCount = lazyBindings(src, { './lib/routeLoaders': loaderSource }).length
    expect(LAZY_ROUTE_IMPORTS.length).toBe(lazyCount)
  })
})
