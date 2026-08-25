#!/usr/bin/env node
/**
 * PWA precache guard.
 *
 * Route chunks are intentionally runtime-cached after use. This check reads
 * the generated Workbox manifest from dist/sw.js and prevents a future broad
 * glob from restoring the multi-megabyte first-install download.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_ROOT = resolve(__dirname, '..', 'dist')
const SW_PATH = join(DIST_ROOT, 'sw.js')
const RAW_LIMIT_KB = Number(process.env.PWA_PRECACHE_RAW_LIMIT_KB ?? 150)

function fmtKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function main() {
  if (!existsSync(SW_PATH)) {
    console.error('[pwa-precache] dist/sw.js not found — run `npm run build` first')
    process.exit(1)
  }

  const worker = readFileSync(SW_PATH, 'utf8')
  const manifestUrls = [...worker.matchAll(
    /\{"revision":(?:null|"[^"]*"),"url":"([^"]+)"\}/g,
  )].map((match) => match[1])
  const urls = [...new Set(manifestUrls)]

  if (urls.length === 0) {
    console.error('[pwa-precache] no Workbox manifest entries found in dist/sw.js')
    process.exit(1)
  }

  const rows = urls.map((url) => {
    const path = join(DIST_ROOT, url.replace(/^\/+/, ''))
    if (!existsSync(path) || !statSync(path).isFile()) {
      return { url, raw: 0, gzip: 0, missing: true }
    }
    const contents = readFileSync(path)
    return {
      url,
      raw: contents.length,
      gzip: gzipSync(contents).length,
      missing: false,
    }
  })
  const rawTotal = rows.reduce((sum, row) => sum + row.raw, 0)
  const gzipTotal = rows.reduce((sum, row) => sum + row.gzip, 0)
  const failures = []
  const duplicateUrls = manifestUrls.filter((url, index) =>
    manifestUrls.indexOf(url) !== index)
  const routeChunks = urls.filter((url) => /\.(?:js|css|map|html)(?:$|\?)/i.test(url))
  const oversizedBrandSources = urls.filter((url) =>
    /icons\/(?:logo|logo-original)\.(?:svg|png)$/i.test(url))

  if (routeChunks.length > 0) {
    failures.push(`route assets are precached: ${routeChunks.join(', ')}`)
  }
  if (duplicateUrls.length > 0) {
    failures.push(`duplicate manifest entries: ${[...new Set(duplicateUrls)].join(', ')}`)
  }
  if (oversizedBrandSources.length > 0) {
    failures.push(`large branding sources are precached: ${oversizedBrandSources.join(', ')}`)
  }
  if (rows.some((row) => row.missing)) {
    failures.push(`manifest entries are missing from dist: ${
      rows.filter((row) => row.missing).map((row) => row.url).join(', ')
    }`)
  }
  if (rawTotal > RAW_LIMIT_KB * 1024) {
    failures.push(
      `precache is ${fmtKB(rawTotal)} raw, above the ${RAW_LIMIT_KB} KB budget`,
    )
  }

  console.log(
    `[pwa-precache] ${rows.length} install assets, ${fmtKB(rawTotal)} raw, ${fmtKB(gzipTotal)} gzip`,
  )
  for (const row of rows) {
    console.log(`  ${fmtKB(row.raw).padStart(9)}  ${row.url}`)
  }

  if (failures.length > 0) {
    console.error('[pwa-precache] BUDGET VIOLATIONS:')
    failures.forEach((failure) => console.error(`  - ${failure}`))
    process.exit(1)
  }

  console.log('[pwa-precache] OK — route chunks remain on-demand')
}

main()
