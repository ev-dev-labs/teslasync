import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEV_MARKER,
  isReleaseIntent,
  normalizeReleaseVersion,
  releaseIdentityProblems,
  resolveBuildIdentity,
} from '../../scripts/buildIdentity.mjs'
import {
  auditBuiltWorkerIdentity,
  auditReleaseSources,
} from '../../scripts/check-release-build-identity.mjs'
import {
  APP_VERSION,
  BUILD_ID,
  CACHE_PREFIX,
  VERSIONED_BUCKETS,
  cacheName,
  currentCacheNames,
  evaluateContractHandshake,
  parseVersion,
  staleCacheNames,
} from '@/sw/buildContract'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const repoRoot = join(webRoot, '..')
const dockerfile = readFileSync(join(repoRoot, 'Dockerfile.web'), 'utf8')
const releaseWorkflow = readFileSync(join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8')
const compose = readFileSync(join(repoRoot, 'docker-compose.yml'), 'utf8')
const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8')
const viteConfig = readFileSync(join(webRoot, 'vite.config.ts'), 'utf8')
const pkgVersion = (JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as {
  version: string
}).version

/**
 * Release / Docker / PWA build-identity contract.
 *
 * Two defects this pins, both of which produced a *successful* build of a
 * *wrong* image and were therefore invisible to every other gate:
 *
 *  1. `release.yml` passed no build args to the web image, so the SPA reported
 *     `package.json`'s version forever while the API reported its git tag.
 *     From the first minor release onward the handshake read the client as
 *     older than the server and pinned a NON-DISMISSIBLE update prompt that
 *     reloading could never clear.
 *  2. The image has no `.git`, so `GIT_SHA` fell back to `dev` and every deploy
 *     produced the identical `BUILD_ID`. Versioned Cache Storage buckets are
 *     suffixed with it, so nothing was ever evicted on `activate()`.
 */
describe('release build identity — version threading', () => {
  it('a simulated v2.1 release build resolves to 2.1.0', () => {
    const identity = resolveBuildIdentity({
      env: { VITE_APP_VERSION: 'v2.1.0', VITE_GIT_SHA: 'abc1234' },
      packageVersion: pkgVersion,
    })
    expect(identity.appVersion).toBe('2.1.0')
    expect(identity.gitSha).toBe('abc1234')
    expect(identity.buildId).toBe('2.1.0+abc1234')
    expect(identity.isRelease).toBe(true)
    expect(identity.rotatesPerBuild).toBe(true)
    expect(releaseIdentityProblems(identity)).toEqual([])
  })

  it('the simulated v2.1 build is embedded in the worker and is compatible with a v2.1 server', () => {
    const identity = resolveBuildIdentity({
      env: { VITE_APP_VERSION: '2.1.0', VITE_GIT_SHA: 'abc1234' },
      packageVersion: pkgVersion,
    })
    // What the nested service-worker build would contain: vite.config.ts
    // stringifies the identity into `__PWA_APP_VERSION__` / `__PWA_GIT_SHA__`,
    // which buildContract reads into APP_VERSION / GIT_SHA.
    const simulatedWorker = `const V=${JSON.stringify(identity.appVersion)};const S=${JSON.stringify(identity.gitSha)};`
    expect(auditBuiltWorkerIdentity({ worker: simulatedWorker, identity })).toEqual([])
    expect(simulatedWorker).toContain('2.1.0')

    const handshake = evaluateContractHandshake({
      clientAppVersion: identity.appVersion,
      serverAppVersion: 'v2.1.0',
    })
    expect(handshake.verdict).toBe('compatible')
    expect(handshake.updateRequired).toBe(false)
  })

  it('reproduces the defect: an unthreaded 2.0.0 client is permanently stale against a 2.1 server', () => {
    // This is exactly what shipped before the fix — kept as the regression
    // witness so the assertions above cannot be satisfied vacuously.
    const broken = evaluateContractHandshake({
      clientAppVersion: pkgVersion,
      serverAppVersion: 'v2.1.0',
    })
    expect(broken.verdict).toBe('assets-stale')
    expect(broken.updateRequired).toBe(true)
  })

  it('an unversioned build is unparseable, so it can never look stale', () => {
    const identity = resolveBuildIdentity({ env: {}, packageVersion: pkgVersion })
    expect(identity.isRelease).toBe(false)
    expect(identity.appVersion).toBe(`${DEV_MARKER}-${pkgVersion}`)
    // The whole point: parseVersion must refuse it.
    expect(parseVersion(identity.appVersion)).toBeNull()

    const handshake = evaluateContractHandshake({
      clientAppVersion: identity.appVersion,
      serverAppVersion: 'v2.1.0',
    })
    expect(handshake.verdict).toBe('unknown')
    expect(handshake.updateRequired).toBe(false)

    // …while still carrying the package version as human-readable provenance,
    // which the PWA precache/contract gates grep for in the built worker.
    expect(identity.appVersion).toContain(pkgVersion)
  })

  it('refuses to pass a malformed release version through as if it were valid', () => {
    expect(normalizeReleaseVersion('')).toBeNull()
    expect(normalizeReleaseVersion('   ')).toBeNull()
    expect(normalizeReleaseVersion('latest')).toBeNull()
    expect(normalizeReleaseVersion(undefined)).toBeNull()
    expect(normalizeReleaseVersion('v2.1.0')).toBe('2.1.0')
    expect(normalizeReleaseVersion('2.1.0-rc.branch.gabc123')).toBe('2.1.0-rc.branch.gabc123')

    // A junk arg must fall back to the harmless unversioned identity, not to a
    // parseable-but-wrong version.
    const identity = resolveBuildIdentity({
      env: { VITE_APP_VERSION: 'latest' },
      packageVersion: pkgVersion,
    })
    expect(identity.isRelease).toBe(false)
    expect(parseVersion(identity.appVersion)).toBeNull()
  })
})

describe('release build identity — cache rotation', () => {
  it('two SHAs produce distinct build ids and distinct cache names', () => {
    const a = resolveBuildIdentity({ env: { VITE_APP_VERSION: '2.1.0', VITE_GIT_SHA: 'aaaaaaa' } })
    const b = resolveBuildIdentity({ env: { VITE_APP_VERSION: '2.1.0', VITE_GIT_SHA: 'bbbbbbb' } })

    expect(a.buildId).not.toBe(b.buildId)
    for (const bucket of VERSIONED_BUCKETS) {
      expect(`${CACHE_PREFIX}-${bucket}-${a.buildId}`)
        .not.toBe(`${CACHE_PREFIX}-${bucket}-${b.buildId}`)
    }
  })

  it("a previous build's versioned buckets are classified stale by the real activate() logic", () => {
    // Uses the SHIPPING staleCacheNames/currentCacheNames rather than a
    // re-implementation, so this fails if cache naming stops depending on
    // BUILD_ID for any reason.
    const previous = resolveBuildIdentity({
      env: { VITE_APP_VERSION: '2.0.0', VITE_GIT_SHA: 'oldsha1' },
    })
    const previousVersioned = VERSIONED_BUCKETS.map(
      (bucket) => `${CACHE_PREFIX}-${bucket}-${previous.buildId}`,
    )

    const stale = staleCacheNames([...previousVersioned, ...currentCacheNames()])
    expect(stale.sort()).toEqual([...previousVersioned].sort())
    // Nothing this build owns is swept.
    for (const name of currentCacheNames()) expect(stale).not.toContain(name)
  })

  it('a non-rotating identity is rejected outright when a release is declared', () => {
    const frozen = resolveBuildIdentity({ env: { VITE_APP_VERSION: '2.1.0', VITE_RELEASE_BUILD: '1' } })
    expect(frozen.buildId).toBe(`2.1.0+${DEV_MARKER}`)
    const problems = releaseIdentityProblems(frozen)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('+dev')

    // Without declared release intent the SAME inputs degrade instead, so an
    // operator's own build cannot be broken by a half-configured identity.
    const degraded = resolveBuildIdentity({
      env: { VITE_APP_VERSION: '2.1.0' },
      packageVersion: pkgVersion,
    })
    expect(degraded.degradedFrom).toBe('2.1.0')
    expect(degraded.isRelease).toBe(false)
  })

  it('cache names are a pure function of BUILD_ID in the shipping module', () => {
    for (const bucket of VERSIONED_BUCKETS) {
      expect(cacheName(bucket)).toBe(`${CACHE_PREFIX}-${bucket}-${BUILD_ID}`)
    }
    expect(BUILD_ID.startsWith(`${APP_VERSION}+`)).toBe(true)
  })
})

describe('release build identity — source configuration', () => {
  it('the checked-in Dockerfile + release workflow satisfy the contract', () => {
    expect(auditReleaseSources({ dockerfile, workflow: releaseWorkflow, compose })).toEqual([])
  })

  it('vite.config.ts resolves the identity through the shared module', () => {
    expect(viteConfig).toContain("from './scripts/buildIdentity.mjs'")
    expect(viteConfig).toMatch(/resolveBuildIdentity\(\{/)
    expect(viteConfig).toContain('__PWA_APP_VERSION__: JSON.stringify(appVersion)')
    expect(viteConfig).toContain('__PWA_GIT_SHA__: JSON.stringify(gitSha)')
    // The old, defective resolution must not come back.
    expect(viteConfig).not.toMatch(/process\.env\.VITE_APP_VERSION\s*\|\|\s*pkg\.version/)
  })

  it('the bare-package-version identity is reachable ONLY under Vitest', () => {
    // `usePwaUpdate`'s handshake specs need a parseable ambient APP_VERSION,
    // so the Vitest run — and nothing else — may fall back to package.json's
    // version. If that escape hatch ever loses its `isVitest` guard, or stops
    // yielding to an explicit VITE_APP_VERSION, a shipped build could again
    // report a bare version it can never keep current.
    expect(viteConfig).toMatch(
      /isVitest && !process\.env\.VITE_APP_VERSION\s*\?\s*\{ \.\.\.process\.env, VITE_APP_VERSION: pkg\.version \}\s*:\s*process\.env/,
    )
    const fallbackCount = (viteConfig.match(/VITE_APP_VERSION: pkg\.version/g) ?? []).length
    expect(fallbackCount).toBe(1)
  })

  // ── Mutation checks ───────────────────────────────────────────────────────
  // A gate nobody has watched fail is not evidence. Each case removes exactly
  // one thing and asserts the audit rejects it.
  it('fails when release.yml stops passing VITE_APP_VERSION', () => {
    const mutated = releaseWorkflow.replace(
      /^\s*VITE_APP_VERSION=.*$/m,
      '',
    )
    const problems = auditReleaseSources({ dockerfile, workflow: mutated })
    expect(problems.join('\n')).toContain('does not pass `VITE_APP_VERSION`')
  })

  it('fails when release.yml stops passing VITE_GIT_SHA', () => {
    const mutated = releaseWorkflow.replace(/^\s*VITE_GIT_SHA=.*$/m, '')
    const problems = auditReleaseSources({ dockerfile, workflow: mutated })
    expect(problems.join('\n')).toContain('does not pass `VITE_GIT_SHA`')
  })

  it('fails when the version build arg is hardcoded instead of sourced from the version job', () => {
    const mutated = releaseWorkflow.replace(
      /VITE_APP_VERSION=\$\{\{[^}]*\}\}/,
      'VITE_APP_VERSION=2.0.0',
    )
    const problems = auditReleaseSources({ dockerfile, workflow: mutated })
    expect(problems.join('\n')).toContain('needs.version.outputs.version')
  })

  it('fails when Dockerfile.web stops declaring an ARG', () => {
    for (const arg of ['VITE_APP_VERSION', 'VITE_GIT_SHA']) {
      const mutated = dockerfile.replace(new RegExp(`^ARG ${arg}=""$`, 'm'), '')
      const problems = auditReleaseSources({ dockerfile: mutated, workflow: releaseWorkflow })
      expect(problems.join('\n')).toContain(`does not declare \`ARG ${arg}\``)
    }
  })

  it('fails when Dockerfile.web declares an ARG but never threads it into ENV', () => {
    const mutated = dockerfile.replace('VITE_GIT_SHA=$VITE_GIT_SHA', '')
    const problems = auditReleaseSources({ dockerfile: mutated, workflow: releaseWorkflow })
    expect(problems.join('\n')).toContain('never threads it into ENV')
  })

  it('fails when the build-once/promote-the-scanned-bytes property is broken', () => {
    // Anchored to the YAML key, not the prose in the surrounding comment.
    const pushed = releaseWorkflow.replace(/^(\s*)push: false\s*$/m, '$1push: true')
    expect(pushed).not.toBe(releaseWorkflow)
    expect(auditReleaseSources({ dockerfile, workflow: pushed }).join('\n'))
      .toContain('push: false')

    const noArchive = releaseWorkflow.replace(
      /outputs: type=docker,dest=[^\r\n]*/,
      'load: true',
    )
    expect(noArchive).not.toBe(releaseWorkflow)
    expect(auditReleaseSources({ dockerfile, workflow: noArchive }).join('\n'))
      .toContain('local archive')

    const argsDropped = releaseWorkflow.replace(
      'build-args: ${{ matrix.build-args }}',
      'build-args: ""',
    )
    expect(argsDropped).not.toBe(releaseWorkflow)
    expect(auditReleaseSources({ dockerfile, workflow: argsDropped }).join('\n'))
      .toContain('matrix.build-args')
  })

  it('detects a built worker that lost the identity', () => {
    const identity = resolveBuildIdentity({
      env: { VITE_APP_VERSION: '2.1.0', VITE_GIT_SHA: 'abc1234' },
    })
    const problems = auditBuiltWorkerIdentity({ worker: 'const V="2.0.0";', identity })
    expect(problems.join('\n')).toContain('does not embed the build version "2.1.0"')
    expect(problems.join('\n')).toContain('does not embed the build sha "abc1234"')
  })

  it('fails when release.yml stops asserting release intent', () => {
    const mutated = releaseWorkflow.replace(/^\s*VITE_RELEASE_BUILD=.*$/m, '')
    expect(mutated).not.toBe(releaseWorkflow)
    expect(auditReleaseSources({ dockerfile, workflow: mutated, compose }).join('\n'))
      .toContain('does not pass `VITE_RELEASE_BUILD`')
  })

  it('fails when Dockerfile.web stops declaring/threading VITE_RELEASE_BUILD', () => {
    const noArg = dockerfile.replace(/^ARG VITE_RELEASE_BUILD=""$/m, '')
    expect(auditReleaseSources({ dockerfile: noArg, workflow: releaseWorkflow, compose }).join('\n'))
      .toContain('does not declare `ARG VITE_RELEASE_BUILD`')

    const noEnv = dockerfile.replace('VITE_RELEASE_BUILD=$VITE_RELEASE_BUILD', '')
    expect(auditReleaseSources({ dockerfile: noEnv, workflow: releaseWorkflow, compose }).join('\n'))
      .toContain('never threads it into ENV')
  })
})

/**
 * Compose identity safety.
 *
 * `VERSION` is a SHARED variable: four Go image builds in docker-compose.yml
 * read it. It used to also drive the web image's `VITE_APP_VERSION`, so a
 * self-hoster who set `VERSION=1.2.3` in `.env` to stamp their API image
 * simultaneously half-configured the SPA — version present, commit id absent —
 * producing the unpublishable `1.2.3+dev` identity and failing
 * `docker compose build` on the web service alone, with no obvious cause.
 */
describe('compose build identity is opt-in and cannot be broken by shared VERSION', () => {
  it('docker-compose no longer wires the shared VERSION into the web image', () => {
    expect(compose).toMatch(/VITE_APP_VERSION:\s*\$\{WEB_APP_VERSION:-\}/)
    expect(compose).toMatch(/VITE_GIT_SHA:\s*\$\{WEB_GIT_SHA:-\}/)
    expect(compose).not.toMatch(/VITE_APP_VERSION:\s*\$\{VERSION[:-]/)
    // …while the Go images still use it.
    expect(compose).toMatch(/VERSION:\s*\$\{VERSION:-dev\}/)
  })

  it('rejects a compose file that reintroduces the shared VERSION coupling', () => {
    const mutated = compose.replace(
      /VITE_APP_VERSION:\s*\$\{WEB_APP_VERSION:-\}/,
      'VITE_APP_VERSION: ${VERSION:-}',
    )
    expect(mutated).not.toBe(compose)
    expect(auditReleaseSources({ dockerfile, workflow: releaseWorkflow, compose: mutated }).join('\n'))
      .toContain('maps the SHARED `VERSION` variable')
  })

  it('rejects a compose file that declares release intent', () => {
    const mutated = compose.replace(
      /(\n(\s*)VITE_GIT_SHA:\s*\$\{WEB_GIT_SHA:-\})/,
      '$1\n$2VITE_RELEASE_BUILD: "1"',
    )
    expect(mutated).not.toBe(compose)
    expect(auditReleaseSources({ dockerfile, workflow: releaseWorkflow, compose: mutated }).join('\n'))
      .toContain('must NOT set VITE_RELEASE_BUILD')
  })

  it('a version without a resolvable SHA DEGRADES instead of breaking the build', () => {
    // Exactly the reported scenario, evaluated through the shipping resolver:
    // a container build (no `.git`, so `readGitSha` returns null).
    const identity = resolveBuildIdentity({
      env: { VITE_APP_VERSION: '1.2.3' },
      packageVersion: pkgVersion,
      readGitSha: () => null,
    })
    expect(identity.degradedFrom).toBe('1.2.3')
    expect(identity.isRelease).toBe(false)
    expect(identity.appVersion).toBe(`${DEV_MARKER}-${pkgVersion}`)
    // Degraded means UNPARSEABLE, so it can never pin an update prompt.
    expect(parseVersion(identity.appVersion)).toBeNull()
    expect(
      evaluateContractHandshake({
        clientAppVersion: identity.appVersion,
        serverAppVersion: 'v2.1.0',
      }).updateRequired,
    ).toBe(false)
  })

  it('does NOT degrade when a real commit id is resolvable', () => {
    const identity = resolveBuildIdentity({
      env: { VITE_APP_VERSION: '1.2.3' },
      packageVersion: pkgVersion,
      readGitSha: () => 'abc1234',
    })
    expect(identity.degradedFrom).toBeNull()
    expect(identity.buildId).toBe('1.2.3+abc1234')
    expect(identity.rotatesPerBuild).toBe(true)
    expect(releaseIdentityProblems(identity)).toEqual([])
  })

  it('a DECLARED release still fails hard on the same half-configuration', () => {
    const identity = resolveBuildIdentity({
      env: { VITE_APP_VERSION: '2.1.0', VITE_RELEASE_BUILD: '1' },
      packageVersion: pkgVersion,
      readGitSha: () => null,
    })
    expect(identity.releaseIntent).toBe(true)
    expect(identity.degradedFrom).toBeNull()
    expect(identity.buildId).toBe(`2.1.0+${DEV_MARKER}`)
    const problems = releaseIdentityProblems(identity)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('+dev')
  })

  it('parses release intent only from an explicit truthy flag', () => {
    expect(isReleaseIntent({ VITE_RELEASE_BUILD: '1' })).toBe(true)
    expect(isReleaseIntent({ VITE_RELEASE_BUILD: 'true' })).toBe(true)
    expect(isReleaseIntent({ VITE_RELEASE_BUILD: '' })).toBe(false)
    expect(isReleaseIntent({ VITE_RELEASE_BUILD: '0' })).toBe(false)
    expect(isReleaseIntent({})).toBe(false)
  })

  it('.env.example documents the opt-in pair and warns off VERSION', () => {
    expect(envExample).toMatch(/#\s*WEB_APP_VERSION=/)
    expect(envExample).toMatch(/#\s*WEB_GIT_SHA=/)
    expect(envExample).toContain('does NOT reach the web image')
  })
})

describe('release gate tooling dependencies are declared', () => {
  it('js-yaml is a direct devDependency, not a transitive hoist', () => {
    // `check-release-build-identity.mjs` imports js-yaml to parse release.yml.
    // It worked only because ESLint happened to hoist the package; a lockfile
    // change that dropped that transitive edge would have broken `npm run lint`
    // with a module-not-found from a gate, not from a dependency.
    const pkg = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(pkg.devDependencies?.['js-yaml']).toBeTruthy()
    expect(pkg.devDependencies?.['@types/js-yaml']).toBeTruthy()

    const gate = readFileSync(
      join(webRoot, 'scripts', 'check-release-build-identity.mjs'),
      'utf8',
    )
    expect(gate).toMatch(/^import yaml from 'js-yaml'$/m)

    const lock = JSON.parse(readFileSync(join(webRoot, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { devDependencies?: Record<string, string> }>
    }
    expect(lock.packages['']?.devDependencies?.['js-yaml']).toBe(pkg.devDependencies!['js-yaml'])
  })
})
