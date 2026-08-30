import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const viteConfig = readFileSync(join(webRoot, 'vite.config.ts'), 'utf8')

/**
 * Guards the cold-start cost of manual vendor chunking.
 *
 * Naming a package in `rollupOptions.output.manualChunks` collapses every
 * module of that package the build reaches into one chunk. When the entry
 * statically imports that chunk, modules only lazy routes need become
 * cold-start weight. `lucide-react` was force-grouped this way: 421 icon
 * modules shipped in a single `vendor-icons` chunk the shell imported, so
 * ~220 icons that only lazy routes render were downloaded before first paint.
 *
 * `scripts/check-bundle-size.mjs` measures the built result; this test fails
 * fast on the config change that causes it, without needing a production
 * build.
 */
describe('vite manual chunking', () => {
  const manualChunks = /manualChunks:\s*\{([\s\S]*?)\n\s{6}\}/.exec(viteConfig)?.[1] ?? ''

  it('finds the manualChunks block', () => {
    expect(manualChunks).not.toBe('')
    expect(manualChunks).toContain('vendor-react')
  })

  it('does not force-group icon modules into a statically imported chunk', () => {
    const assignments = manualChunks
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')

    expect(assignments).not.toContain('lucide-react')
  })

  it('keeps the vendor groups that are genuinely shell-wide', () => {
    for (const group of ['react', 'react-dom', '@tanstack/react-query', 'i18next']) {
      expect(manualChunks).toContain(group)
    }
  })

  it('keeps route-only libraries grouped so a route pays for them once', () => {
    // recharts / leaflet are imported only by lazy routes, so grouping them
    // keeps them out of the startup closure while still deduplicating them.
    for (const group of ['recharts', 'leaflet']) {
      expect(manualChunks).toContain(group)
    }
  })
})
