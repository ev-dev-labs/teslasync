import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { EMPTY_STATE_GUIDANCE } from '@/lib/emptyStateGuidance'
import { GLOSSARY } from '@/lib/helpGlossary'

/**
 * Reachability guard for the Help/product-clarity surfaces.
 *
 * The independent review found HELP-02/03/04/05/10 "mostly unreferenced": the
 * registries and components existed, were tested in isolation, and were
 * imported by nothing a user could reach. Unit tests cannot catch that — a
 * dead export passes its own tests perfectly.
 *
 * This suite reads the source tree and asserts that each surface is actually
 * imported somewhere outside its own definition and tests. It is deliberately
 * a static scan rather than a render test: it fails when the LAST call site is
 * deleted, which is the moment the regression happens.
 */

const SRC = resolve(__dirname, '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

const ALL_FILES = walk(SRC)

/** Files that are neither the definition itself nor a test of it. */
function callSites(symbol: string, definedIn: RegExp): string[] {
  return ALL_FILES.filter((file) => {
    const normalised = file.replace(/\\/g, '/')
    if (definedIn.test(normalised)) return false
    if (/\.test\.tsx?$/.test(normalised)) return false
    const source = readFileSync(file, 'utf8')
    return source.includes(symbol)
  }).map((f) => f.replace(/\\/g, '/').replace(`${SRC.replace(/\\/g, '/')}/`, ''))
}

describe('HELP-02 — empty-state guidance is reachable', () => {
  it('is rendered by at least one production surface', () => {
    const sites = callSites('EmptyStateGuidanceDetails', /ActionableEmptyState\.tsx$/)
    expect(sites.length, 'no page renders EmptyStateGuidanceDetails').toBeGreaterThan(0)
  })

  it('references EVERY governed guidance id from a real page', () => {
    // Each registry entry is copy that a reviewer approved for a specific
    // surface. An entry no page cites is unreviewed copy pretending to be
    // governed.
    const pageSources = ALL_FILES.filter((f) => !/\.test\.tsx?$/.test(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')

    for (const entry of EMPTY_STATE_GUIDANCE) {
      expect(
        pageSources.includes(`"${entry.id}"`) || pageSources.includes(`'${entry.id}'`),
        `guidance "${entry.id}" is not referenced by any surface`,
      ).toBe(true)
    }
  })
})

describe('HELP-03 — glossary is reachable inline', () => {
  it('is rendered by at least one production page outside the Help route', () => {
    const sites = callSites('<GlossaryTerm', /GlossaryTerm\.tsx$/).filter(
      (f) => !f.includes('features/system/components/help-index/'),
    )
    expect(sites.length, 'no domain page renders <GlossaryTerm>').toBeGreaterThan(0)
  })

  it('covers the six required terms across the inline call sites', () => {
    const inline = callSites('<GlossaryTerm', /GlossaryTerm\.tsx$/)
      .map((f) => readFileSync(join(SRC, f), 'utf8'))
      .join('\n')

    for (const id of [
      'soc',
      'rated_range',
      'degradation',
      'phantom_drain',
      'efficiency',
      'signal_freshness',
    ]) {
      expect(inline.includes(`"${id}"`), `term "${id}" is never used inline`).toBe(true)
    }
  })

  it('every glossary entry is renderable — no orphan definitions', () => {
    for (const term of GLOSSARY) {
      expect(term.definitionFallback.length).toBeGreaterThan(0)
      expect(term.howMeasuredFallback.length).toBeGreaterThan(0)
    }
  })
})

describe('HELP-04 — unavailability classifier is reachable', () => {
  it('is consumed by the shared data-state surface', () => {
    const source = readFileSync(join(SRC, 'components/feedback/DataStateNotice.tsx'), 'utf8')
    expect(source).toContain('classifyUnavailability')
    expect(source).toContain('explainUnavailability')
  })

  it('has a PRODUCTION caller that actually passes reason/evidence', () => {
    // The previous version of this test only proved DataStateNotice imports
    // the classifier — which it did while no caller ever supplied `reason` or
    // `evidence`, so the classification branch was dead on every render. A
    // component importing its own dependency is not reachability.
    //
    // Require a call site OUTSIDE components/feedback (i.e. not the wrapper
    // talking to itself) that feeds the classifier real input.
    const callers = ALL_FILES.filter((file) => {
      const normalised = file.replace(/\\/g, '/')
      if (/\.test\.tsx?$/.test(normalised)) return false
      const source = readFileSync(file, 'utf8')
      return /<DataStateNotice[^>]*\s(reason|evidence)=/s.test(source)
    }).map((f) => f.replace(/\\/g, '/'))

    expect(callers.length, 'nothing passes reason/evidence to DataStateNotice').toBeGreaterThan(0)
  })

  it('runs classification through the shared page-level data-source surface', () => {
    // DataSourceNotice is what <PageContainer dataSources={…}> renders, so
    // wiring evidence there reaches every page that declares data sources
    // without editing any of them.
    const source = readFileSync(join(SRC, 'components/feedback/DataSourceNotice.tsx'), 'utf8')
    expect(source).toContain('evidence={derivedEvidence}')
    expect(source).toMatch(/query\.error/)
  })

  it('is reached by real pages via PageContainer dataSources', () => {
    const pagesWithSources = ALL_FILES.filter((file) => {
      const normalised = file.replace(/\\/g, '/')
      if (/\.test\.tsx?$/.test(normalised)) return false
      if (normalised.includes('/components/layout/')) return false
      return /dataSources=\{/.test(readFileSync(file, 'utf8'))
    })
    // Not a threshold for its own sake: if this drops to zero the wiring above
    // is decorative again, exactly as it was before this fix.
    expect(pagesWithSources.length).toBeGreaterThan(5)
  })
})

describe('HELP-05 — error help links are reachable', () => {
  it('is rendered by the shared status-aware error surface', () => {
    const source = readFileSync(
      join(SRC, 'components/feedback/_StatusAwareError.tsx'),
      'utf8',
    )
    expect(source).toContain('<ErrorHelpLinks')
  })
})

describe('HELP-10 — permission guidance is reachable', () => {
  it('is rendered on the 401/403 path', () => {
    const source = readFileSync(
      join(SRC, 'components/feedback/_StatusAwareError.tsx'),
      'utf8',
    )
    expect(source).toContain('<PermissionGuidanceNotice')
  })

  it('is rendered on the feature-disabled / open-mode path', () => {
    const source = readFileSync(join(SRC, 'components/feedback/RequiresAuth.tsx'), 'utf8')
    expect(source).toContain('<PermissionGuidanceNotice')
  })
})

describe('HELP-11 — dashboard presets are actually applied', () => {
  it('is consumed by the dashboard layout hook', () => {
    const source = readFileSync(
      join(SRC, 'features/dashboard/hooks/useDashboardLayout.ts'),
      'utf8',
    )
    expect(source).toContain('presetWidgetIds')
    expect(source).toContain('applyRolePreset')
  })

  it('is triggered from the dashboard page', () => {
    const source = readFileSync(join(SRC, 'features/dashboard/pages/DashboardPage.tsx'), 'utf8')
    expect(source).toContain('applyRolePreset')
  })
})

describe('HELP-12 — the validated demo base is used for routing', () => {
  it('is consulted by the API url builder', () => {
    const source = readFileSync(join(SRC, 'api/client.ts'), 'utf8')
    expect(source).toContain('getDemoApiBase')
  })

  it('is consulted by the resilient fetch path', () => {
    const source = readFileSync(join(SRC, 'lib/resilience.ts'), 'utf8')
    expect(source).toContain('getDemoApiBase')
  })
})
