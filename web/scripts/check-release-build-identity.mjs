/**
 * Release build-identity gate (the release half of the PWA build contract).
 *
 * NOTE: no `#!` line. This module is imported by
 * `src/__tests__/releaseBuildIdentity.contract.test.ts` so the mutation checks
 * exercise the real audit, and the Vite/OXC transform does not strip a shebang
 * from an imported module.
 *
 * Two production defects motivate this file. Both were invisible to every
 * existing gate because both produced a *successful* build of a *wrong* image.
 *
 * ── 1. A permanently stale client version ────────────────────────────────────
 * `release.yml` built the web image with `build-args: ""`. `Dockerfile.web`
 * therefore left `VITE_APP_VERSION` blank and `vite.config.ts` fell back to
 * `package.json`'s version, so every published SPA reported `2.0.0` while the
 * API reported its git tag. At the v2.1 release
 * `evaluateContractHandshake({ client: '2.0.0', server: '2.1.0' })` returns
 * `assets-stale` → `updateRequired: true`, which the UI renders as a
 * NON-DISMISSIBLE prompt. Reloading installs the next build… which also says
 * `2.0.0`. The prompt can never clear.
 *
 * ── 2. Cache buckets that never rotate ───────────────────────────────────────
 * `BUILD_ID = APP_VERSION + '+' + GIT_SHA` suffixes every versioned Cache
 * Storage bucket. The image has no `.git`, so `git rev-parse` failed inside the
 * container and `GIT_SHA` became `dev`. Combined with the `2.0.0` fallback,
 * EVERY deploy produced the identical `2.0.0+dev`, so `staleCacheNames()` found
 * nothing to delete on `activate` and the previous build's chunks were served
 * against the new API — precisely the PWA-04 failure the build id exists to
 * prevent.
 *
 * ── What is enforced ─────────────────────────────────────────────────────────
 * SOURCE (always, cheap, no build needed — wired into `npm run lint`):
 *   - Dockerfile.web declares AND threads both build args.
 *   - release.yml's web matrix leg passes both, sourced from the canonical
 *     version job output and the workflow's commit sha — not literals.
 *   - the web leg is still built exactly once, by the build-scan step that
 *     exports the promotion archive (build-once/scan-once/promote-the-same-
 *     bytes is not weakened by adding build args).
 * RELEASE IDENTITY (only when an explicit version is present, i.e. `--release`
 * or VITE_APP_VERSION set):
 *   - the resolved identity is parseable and does NOT end in `+dev`.
 *
 * Ordinary local/compose builds are unversioned BY DESIGN and never fail here:
 * `resolveBuildIdentity` gives them `dev-<pkg version>`, which `parseVersion`
 * cannot read, so the handshake stays `unknown` and never escalates.
 *
 * Usage:
 *   node scripts/check-release-build-identity.mjs            # source contract
 *   node scripts/check-release-build-identity.mjs --release  # + identity must
 *                                                            #   be publishable
 */
import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { releaseIdentityProblems, resolveBuildIdentity } from './buildIdentity.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(SCRIPT_DIR, '..')
const REPO_ROOT = resolve(WEB_ROOT, '..')

/** Build args the web image must receive to be publishable. */
export const REQUIRED_WEB_BUILD_ARGS = ['VITE_APP_VERSION', 'VITE_GIT_SHA', 'VITE_RELEASE_BUILD']

/**
 * Pure audit of the source configuration. Exported so the contract test can
 * feed MUTATED inputs and prove the gate actually rejects them — a gate that
 * has never been shown to fail is not evidence of anything.
 *
 * @param {Object} input
 * @param {string} input.dockerfile  Contents of Dockerfile.web.
 * @param {string} input.workflow    Contents of .github/workflows/release.yml.
 * @param {string} [input.compose]   Contents of docker-compose.yml.
 * @returns {string[]} problems (empty = contract holds)
 */
export function auditReleaseSources({ dockerfile, workflow, compose }) {
  const problems = []

  // ── docker-compose.yml ────────────────────────────────────────────────────
  // The SPA identity must never be driven by the SHARED `VERSION` variable the
  // Go images use. It was, and a self-hoster who set `VERSION` in `.env` for
  // their API image got `<version>+dev` in the web image — an unpublishable
  // identity that failed `docker compose build` on the web service alone.
  if (typeof compose === 'string') {
    const composeWeb = /VITE_APP_VERSION:\s*\$\{([A-Z_]+)[:-]/.exec(compose)
    if (!composeWeb) {
      problems.push(
        'docker-compose.yml does not wire VITE_APP_VERSION for the web image — expected an '
        + 'opt-in `${WEB_APP_VERSION:-}`',
      )
    } else if (composeWeb[1] === 'VERSION') {
      problems.push(
        'docker-compose.yml maps the SHARED `VERSION` variable into the web image\'s '
        + 'VITE_APP_VERSION. `VERSION` stamps the Go images; reusing it here means setting it '
        + 'for the API also half-configures the SPA identity. Use a web-specific variable '
        + '(`WEB_APP_VERSION`).',
      )
    }
    const composeSha = /VITE_GIT_SHA:\s*\$\{([A-Z_]+)[:-]/.exec(compose)
    if (composeSha && composeSha[1] === 'VERSION') {
      problems.push('docker-compose.yml must not derive VITE_GIT_SHA from `VERSION`')
    }
    // Match the YAML key, not the prose in the surrounding comment.
    if (/^[^\S\r\n]*VITE_RELEASE_BUILD\s*:/m.test(compose)) {
      problems.push(
        'docker-compose.yml must NOT set VITE_RELEASE_BUILD — release intent belongs to the '
        + 'release workflow only, otherwise a local build can fail on a half-configured identity',
      )
    }
  }

  // ── Dockerfile.web ────────────────────────────────────────────────────────
  for (const arg of REQUIRED_WEB_BUILD_ARGS) {
    if (!new RegExp(`^\\s*ARG\\s+${arg}\\b`, 'm').test(dockerfile)) {
      problems.push(
        `Dockerfile.web does not declare \`ARG ${arg}\` — docker ignores build args that `
        + 'are not declared in the stage that consumes them, so the value would be dropped silently',
      )
    }
    // The ARG only reaches Vite if it is promoted to an ENV in the build stage.
    if (!new RegExp(`${arg}=\\$${arg}\\b`).test(dockerfile)) {
      problems.push(
        `Dockerfile.web declares ${arg} but never threads it into ENV `
        + `(expected \`${arg}=$${arg}\`), so vite.config.ts would not see it`,
      )
    }
  }

  // ── release.yml ───────────────────────────────────────────────────────────
  let doc
  try {
    doc = yaml.load(workflow)
  } catch (error) {
    problems.push(`release.yml is not parseable YAML: ${error.message}`)
    return problems
  }

  const buildScan = doc?.jobs?.['build-scan']
  if (!buildScan) {
    problems.push('release.yml has no `build-scan` job — the build-once/scan-once stage is gone')
    return problems
  }

  const include = buildScan?.strategy?.matrix?.include
  if (!Array.isArray(include)) {
    problems.push('release.yml build-scan has no matrix include list')
    return problems
  }

  const webLegs = include.filter((leg) => leg?.image === 'web')
  if (webLegs.length !== 1) {
    problems.push(
      `release.yml build-scan must have exactly one \`web\` matrix leg (found ${webLegs.length}) — `
      + 'a second leg would mean the promoted archive is not the only web build',
    )
    return problems
  }
  const web = webLegs[0]
  const buildArgs = typeof web['build-args'] === 'string' ? web['build-args'] : ''

  const REQUIRED_ARG_RATIONALE = {
    VITE_APP_VERSION:
      'The published SPA would carry package.json\'s version forever and the PWA handshake '
      + 'would pin an undismissible "update required" prompt at the next minor release.',
    VITE_GIT_SHA:
      'BUILD_ID would end in `+dev` on every deploy, so versioned Cache Storage buckets would '
      + 'never rotate and stale chunks would survive activate().',
    VITE_RELEASE_BUILD:
      'Without declared release intent a half-configured identity DEGRADES to the unversioned '
      + 'build instead of failing — which is right for an operator\'s own compose build and '
      + 'wrong for a publish, where `<version>+dev` must be rejected outright.',
  }

  for (const arg of REQUIRED_WEB_BUILD_ARGS) {
    if (!new RegExp(`(^|\\n)\\s*${arg}=`).test(buildArgs)) {
      problems.push(
        `release.yml does not pass \`${arg}\` to the web image. ${REQUIRED_ARG_RATIONALE[arg]}`,
      )
    }
  }

  if (/VITE_RELEASE_BUILD=/.test(buildArgs) && !/VITE_RELEASE_BUILD=\s*(1|true)\s*(\n|$)/.test(buildArgs)) {
    problems.push('release.yml must set `VITE_RELEASE_BUILD=1` for the web image')
  }

  // The version must come from the canonical version job, not a literal that
  // can drift from the tag the API reports.
  if (/VITE_APP_VERSION=/.test(buildArgs)
    && !/VITE_APP_VERSION=\$\{\{\s*needs\.version\.outputs\.(version|new_tag)\s*\}\}/.test(buildArgs)) {
    problems.push(
      'release.yml must source VITE_APP_VERSION from `needs.version.outputs.version` '
      + '(or `new_tag`) so the SPA and the API agree on the release version',
    )
  }
  if (/VITE_GIT_SHA=/.test(buildArgs) && !/VITE_GIT_SHA=\$\{\{\s*github\.sha\s*\}\}/.test(buildArgs)) {
    problems.push(
      'release.yml must source VITE_GIT_SHA from `github.sha` so the cache-busting half '
      + 'of BUILD_ID is immutable and unique per build',
    )
  }

  // ── build-once / promote-the-scanned-bytes must be preserved ──────────────
  const steps = Array.isArray(buildScan.steps) ? buildScan.steps : []
  const builds = steps.filter((step) => String(step?.uses ?? '').includes('docker/build-push-action'))
  if (builds.length !== 1) {
    problems.push(
      `release.yml build-scan must run docker/build-push-action exactly once (found ${builds.length}) — `
      + 'a second build breaks "the bytes that were scanned are the bytes that were published"',
    )
  } else {
    const build = builds[0]
    const withBlock = build.with ?? {}
    if (withBlock.push !== false) {
      problems.push('release.yml build-scan must build with `push: false` (no registry side effects)')
    }
    if (!String(withBlock.outputs ?? '').includes('type=docker,dest=')) {
      problems.push(
        'release.yml build-scan must export the build to a local archive '
        + '(`outputs: type=docker,dest=…`) so the scanned artefact is the promoted artefact',
      )
    }
    if (!String(withBlock['build-args'] ?? '').includes('matrix.build-args')) {
      problems.push(
        'release.yml build-scan must pass `${{ matrix.build-args }}` to the single build step, '
        + 'so the build identity is baked into the archive that gets promoted',
      )
    }
  }

  return problems
}

/**
 * Assert a BUILT service worker actually carries the identity the build was
 * given. This is the artifact-level half: the source contract proves the args
 * are wired, this proves they survived the build into the shipped bytes.
 *
 * @param {Object} input
 * @param {string} input.worker  Contents of dist/sw.js.
 * @param {{appVersion: string, gitSha: string, buildId: string}} input.identity
 * @returns {string[]} problems
 */
export function auditBuiltWorkerIdentity({ worker, identity }) {
  const problems = []
  if (!worker.includes(identity.appVersion)) {
    problems.push(
      `dist/sw.js does not embed the build version "${identity.appVersion}" — `
      + 'the define block did not reach the nested service-worker build',
    )
  }
  if (!worker.includes(identity.gitSha)) {
    problems.push(
      `dist/sw.js does not embed the build sha "${identity.gitSha}" — `
      + 'versioned cache buckets would not rotate for this deploy',
    )
  }
  return problems
}

function main() {
  const requireRelease = process.argv.includes('--release')

  const inCheckout = existsSync(join(REPO_ROOT, 'go.mod')) && existsSync(join(REPO_ROOT, '.github'))
  if (!inCheckout) {
    console.log(
      '[release-identity] repository root not visible (container build context) — '
      + 'source contract deferred to the checkout-based CI run',
    )
    return
  }

  const dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile.web'), 'utf8')
  const workflow = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8')
  const composePath = join(REPO_ROOT, 'docker-compose.yml')
  const compose = existsSync(composePath) ? readFileSync(composePath, 'utf8') : undefined
  const problems = auditReleaseSources({ dockerfile, workflow, compose })

  const pkgVersion = JSON.parse(readFileSync(join(WEB_ROOT, 'package.json'), 'utf8')).version
  const identity = resolveBuildIdentity({
    env: process.env,
    packageVersion: pkgVersion,
    readGitSha: () => {
      try {
        return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
          .toString()
          .trim()
      } catch {
        return null
      }
    },
  })

  if (requireRelease || identity.isRelease || identity.releaseIntent) {
    problems.push(...releaseIdentityProblems(identity))

    // When the caller declared a release identity AND a build is present, the
    // shipped worker must actually carry it.
    const workerPath = join(WEB_ROOT, 'dist', 'sw.js')
    if (existsSync(workerPath)) {
      problems.push(
        ...auditBuiltWorkerIdentity({ worker: readFileSync(workerPath, 'utf8'), identity }),
      )
      console.log('[release-identity] verified dist/sw.js against the declared identity')
    }
  }

  if (identity.degradedFrom !== null) {
    // Visible, not silent: the operator asked for a version and did not get one.
    console.warn(
      `[release-identity] WARNING: VITE_APP_VERSION="${identity.degradedFrom}" was supplied `
      + 'without a resolvable VITE_GIT_SHA, so the build degraded to the unversioned identity '
      + `"${identity.buildId}". A version without an immutable commit id cannot rotate the `
      + 'service-worker cache buckets. Supply both to stamp a real identity.',
    )
  }

  console.log(
    `[release-identity] identity: ${identity.buildId} `
    + `(release=${identity.isRelease}, rotates=${identity.rotatesPerBuild}, `
    + `intent=${identity.releaseIntent})`,
  )

  if (problems.length > 0) {
    console.error('\n[release-identity] CONTRACT VIOLATIONS:')
    for (const p of problems) console.error(`  - ${p}`)
    console.error('')
    process.exit(1)
  }

  console.log(
    '[release-identity] OK — release threads VITE_APP_VERSION + VITE_GIT_SHA + '
    + 'VITE_RELEASE_BUILD into the single build-scan/export step; compose uses its own opt-in '
    + 'variables and unversioned builds stay unparseable and harmless\n',
  )
}

// Only run the CLI when invoked directly, so the contract test can import the
// pure audit without triggering a process.exit.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
