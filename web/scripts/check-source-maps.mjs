#!/usr/bin/env node
/**
 * CLEAN-04 — production source maps must never be publicly served.
 *
 * `vite.config.ts` used to set `build.sourcemap: true`, which emits both the
 * `.map` files and a `//# sourceMappingURL=` comment in every chunk.
 * `Dockerfile.web` copies `dist/` verbatim into the nginx document root and
 * `nginx.conf` serves any file that exists, so every deployment published a
 * byte-exact copy of the frontend source tree to anonymous visitors.
 *
 * This repository has no error-tooling (Sentry/Bugsnag/…) upload integration,
 * so there is nothing to symbolicate against and the honest default is "do not
 * build maps at all". CI can still opt into *private* maps for the analysis
 * gates that need module attribution.
 *
 * Two modes, selected by VITE_SOURCEMAP_MODE (same variable vite.config.ts
 * reads, so the gate can never disagree with the build):
 *
 *   unset / anything else  PUBLIC BUILD.
 *                          dist/ must contain zero `.map` files and zero
 *                          `sourceMappingURL` references.
 *
 *   private                PRIVATE CI BUILD.
 *                          `.map` files are expected (hidden source maps) but
 *                          no emitted asset may reference one, and the maps
 *                          must not be publishable — the script prints them so
 *                          a workflow can delete/upload them explicitly.
 *
 * Independently of the build mode it asserts the *serving* contract, because a
 * future `sourcemap: true` regression must not be able to reach production:
 *   - Dockerfile.web prunes `*.map` from the build output before the runtime
 *     stage copies it.
 *   - nginx (compose + Helm) refuses `.map` requests outright.
 *
 * Usage:
 *   node scripts/check-source-maps.mjs [--dist <dir>]
 *
 * Exit 0 = contract holds. Exit 1 + per-finding lines otherwise.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(SCRIPT_DIR, '..')
const REPO_ROOT = resolve(WEB_ROOT, '..')

const distFlagIndex = process.argv.indexOf('--dist')
const DIST_DIR = resolve(
  WEB_ROOT,
  distFlagIndex !== -1 ? process.argv[distFlagIndex + 1] : 'dist',
)

const PRIVATE_MODE = (process.env.VITE_SOURCEMAP_MODE ?? '').trim().toLowerCase() === 'private'

// Text assets a browser could follow a sourceMappingURL from.
const REFERENCING_EXT = ['.js', '.mjs', '.cjs', '.css']
const SOURCE_MAPPING_URL_RE = /[#@]\s*sourceMappingURL\s*=/

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/**
 * Serving-path contract — static, so it runs even without a build present.
 *
 * Skipped when the script is executing inside the web image build, where the
 * Docker context is `web/` only and the repository root files simply are not
 * there. CI runs this gate again from a real checkout (`npm run
 * check:source-maps` in ci.yml), which is where the serving contract is
 * actually enforced.
 */
function checkServingContract() {
  const failures = []

  const inCheckout = existsSync(join(REPO_ROOT, 'go.mod')) && existsSync(join(REPO_ROOT, '.github'))
  if (!inCheckout) {
    console.log(
      '[source-maps] repository root not visible (container build context) — '
      + 'serving-path contract deferred to the checkout-based CI run',
    )
    return failures
  }

  const dockerfile = readIfPresent(join(REPO_ROOT, 'Dockerfile.web'))
  if (dockerfile === null) {
    failures.push('Dockerfile.web not found — cannot verify the image never ships source maps')
  } else if (!/-name\s+['"]?\*\.map['"]?\s+-delete/.test(dockerfile)) {
    failures.push(
      'Dockerfile.web must prune build-output source maps before the runtime stage '
      + "(expected a `find ... -name '*.map' -delete` step after `npm run build`)",
    )
  }

  const nginxTargets = [
    ['web/nginx.conf', join(WEB_ROOT, 'nginx.conf')],
    ['helm/teslasync/templates/configmap-nginx.yaml', join(REPO_ROOT, 'helm', 'teslasync', 'templates', 'configmap-nginx.yaml')],
  ]
  for (const [label, path] of nginxTargets) {
    const conf = readIfPresent(path)
    if (conf === null) {
      failures.push(`${label} not found — cannot verify .map requests are refused`)
      continue
    }
    // A `location ~ \.map$ { ... return 404 ... }` block, in either nginx dialect.
    if (!/location[^\n]*\\\.map\$[^\n]*\{[\s\S]{0,400}?return\s+404/.test(conf)) {
      failures.push(
        `${label} must deny source-map requests `
        + '(expected a `location ~ \\.map$` block that returns 404)',
      )
    }
  }

  return failures
}

/** Build-output contract. */
function checkBuildOutput() {
  if (!existsSync(DIST_DIR)) {
    return {
      skipped: true,
      failures: [],
      maps: [],
    }
  }

  const files = walk(DIST_DIR)
  const maps = files.filter((f) => f.endsWith('.map'))
  const referencing = files
    .filter((f) => REFERENCING_EXT.some((ext) => f.endsWith(ext)))
    .filter((f) => SOURCE_MAPPING_URL_RE.test(readFileSync(f, 'utf8')))

  const failures = []

  for (const file of referencing) {
    failures.push(
      `${relative(REPO_ROOT, file)} contains a sourceMappingURL reference — `
      + 'browsers will fetch a map from the public origin '
      + '(build.sourcemap must be false or \'hidden\', never true/\'inline\')',
    )
  }

  if (!PRIVATE_MODE) {
    for (const file of maps) {
      failures.push(
        `${relative(REPO_ROOT, file)} is a source map in a public build — `
        + 'run without VITE_SOURCEMAP_MODE=private, or delete the maps before publishing',
      )
    }
  }

  return { skipped: false, failures, maps }
}

function main() {
  const servingFailures = checkServingContract()
  const build = checkBuildOutput()
  const failures = [...servingFailures, ...build.failures]

  if (build.skipped) {
    console.log(`[source-maps] ${relative(REPO_ROOT, DIST_DIR)} not found — build-output checks skipped`)
  } else if (PRIVATE_MODE) {
    console.log(
      `[source-maps] private mode: ${build.maps.length} hidden map(s) in `
      + `${relative(REPO_ROOT, DIST_DIR)}; they are CI-only artefacts and MUST NOT be published`,
    )
  } else {
    console.log(
      `[source-maps] public mode: ${relative(REPO_ROOT, DIST_DIR)} contains `
      + `${build.maps.length} map file(s) (must be 0)`,
    )
  }

  if (failures.length > 0) {
    console.error('\n[source-maps] CONTRACT VIOLATIONS:')
    for (const f of failures) console.error(`  - ${f}`)
    console.error('')
    process.exit(1)
  }

  console.log('[source-maps] OK — no publicly reachable source maps, serving path denies .map\n')
}

main()
