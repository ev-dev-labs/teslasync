#!/usr/bin/env node
/**
 * CLEAN-02 — runtime deprecation gate for the transform pipeline.
 *
 * `src/__tests__/viteTransformConfig.test.ts` pins the *shape* of the config.
 * This script proves the *behaviour*: it boots the real Vitest runtime (which
 * resolves its own nested Vite 8 / rolldown-OXC) against a single fast test
 * file and fails if Vite prints a deprecated-option warning.
 *
 * That distinction matters because the warning does not come from anything
 * this repository writes — it comes from a plugin handing Vite an option that
 * a newer major renamed. A static assertion cannot see a *dependency* starting
 * to do that after an upgrade; this can.
 *
 * The patterns below are deliberately narrow: they match Vite's deprecation
 * channel, not the word "deprecated" appearing in test output.
 *
 * Usage: node scripts/check-vite-deprecations.mjs   (npm run check:vite-deprecations)
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Cheap, dependency-light, and already required to exist by the config contract.
const PROBE_TEST = 'src/__tests__/viteTransformConfig.test.ts'

const DEPRECATION_PATTERNS = [
  /option was specified by "[^"]+" plugin\. This option is deprecated/i,
  /`?esbuild`? option .*deprecated/i,
  /`?optimizeDeps\.esbuildOptions`? .*deprecated/i,
  /Both esbuild and oxc options were set/i,
]

function main() {
  const result = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', PROBE_TEST, '--reporter=dot'],
    { cwd: WEB_ROOT, encoding: 'utf8', env: { ...process.env, CI: '1' } },
  )

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

  // Deprecations are reported BEFORE the probe's own pass/fail is considered:
  // Vite prints them while creating the server, so they are meaningful even
  // when the probe assertions themselves fail.
  const hits = output
    .split('\n')
    // Ignore source snippets Vitest echoes from a failing test file: this
    // script's own probe documents the warning text in a comment.
    .filter((line) => !/^\s*(?:\/\/|\*|\d+\|)/.test(line))
    .filter((line) => DEPRECATION_PATTERNS.some((re) => re.test(line)))

  if (hits.length > 0) {
    console.error('\n[vite-deprecations] the transform pipeline is using deprecated options:')
    for (const line of hits) console.error(`  ${line.trim()}`)
    console.error(
      '\n  A plugin is configuring the OXC pipeline through esbuild-era options.\n'
      + '  Guard it behind `isVitest` in vite.config.ts (see the CLEAN-02 note there),\n'
      + '  or migrate the plugin to a major that emits `oxc` / `optimizeDeps.rolldownOptions`\n'
      + '  once its peer range still covers the Vite the production build uses.\n',
    )
    process.exit(1)
  }

  if (result.status !== 0) {
    console.error('[vite-deprecations] probe run failed — cannot assess deprecation output:')
    console.error(output.split('\n').slice(-40).join('\n'))
    process.exit(1)
  }

  console.log('[vite-deprecations] OK — no deprecated transform options in the Vitest runtime\n')
}

main()
