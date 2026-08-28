import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MAX_ERROR_HELP_LINKS,
  helpLinksForError,
  listErrorHelpRoutes,
  listRunbookPaths,
  resolveDocsBaseUrl,
} from '../errorHelpLinks'
import { ROUTE_REGISTRY } from '../routeRegistry'
import type { ErrorKind } from '../errorClassification'

/**
 * HELP-05. The value of an error-to-destination map is entirely in whether the
 * destinations exist. A link farm of 404s is worse than no links, so the
 * governance tests here check reachability, not copy.
 */

const ALL_KINDS: ErrorKind[] = [
  'waiting',
  'not_found',
  'unauthorized',
  'forbidden',
  'timed_out',
  'unsupported',
  'unavailable',
  'server',
  'request',
  'offline',
  'network',
]

describe('helpLinksForError — coverage', () => {
  it('returns at least one destination for every error kind', () => {
    for (const kind of ALL_KINDS) {
      expect(helpLinksForError(kind, { docsBaseUrl: null }).length).toBeGreaterThan(0)
    }
  })

  it('never exceeds the link cap', () => {
    for (const kind of ALL_KINDS) {
      expect(
        helpLinksForError(kind, { docsBaseUrl: 'https://docs.example.com' }).length,
      ).toBeLessThanOrEqual(MAX_ERROR_HELP_LINKS)
    }
  })

  it('is deterministic and ordered — repeated calls are identical', () => {
    const a = helpLinksForError('unavailable', { docsBaseUrl: null })
    const b = helpLinksForError('unavailable', { docsBaseUrl: null })
    expect(a.map((link) => link.id)).toEqual(b.map((link) => link.id))
  })

  it('leads with system status for infrastructure failures', () => {
    expect(helpLinksForError('unavailable', { docsBaseUrl: null })[0].id).toBe('system-status')
    expect(helpLinksForError('server', { docsBaseUrl: null })[0].id).toBe('system-status')
  })

  it('leads with access guidance for a permission failure', () => {
    expect(helpLinksForError('forbidden', { docsBaseUrl: null })[0].id).toBe('help')
  })

  it('returns an empty list for an unknown kind rather than throwing', () => {
    expect(helpLinksForError('nonsense' as ErrorKind, { docsBaseUrl: null })).toEqual([])
  })
})

describe('helpLinksForError — in-app routes are real', () => {
  it('only points at routes declared in the route registry', () => {
    const known = new Set(ROUTE_REGISTRY.map((route) => route.path))
    for (const route of listErrorHelpRoutes()) {
      expect(known.has(route)).toBe(true)
    }
  })

  it('gives every link a reason the user can act on', () => {
    for (const kind of ALL_KINDS) {
      for (const link of helpLinksForError(kind, { docsBaseUrl: null })) {
        expect(link.reasonFallback.length).toBeGreaterThan(10)
        expect(link.labelFallback.length).toBeGreaterThan(0)
        // A link is either in-app or external — never both, never neither.
        expect(Boolean(link.to) !== Boolean(link.href)).toBe(true)
      }
    }
  })
})

describe('runbook links', () => {
  it('emits no runbook links when no docs base URL is configured', () => {
    for (const kind of ALL_KINDS) {
      const runbooks = helpLinksForError(kind, { docsBaseUrl: null }).filter(
        (link) => link.kind === 'runbook',
      )
      expect(runbooks).toEqual([])
    }
  })

  it('emits absolute runbook URLs when a docs base URL is configured', () => {
    const links = helpLinksForError('unavailable', {
      docsBaseUrl: 'https://docs.example.com',
    })
    const runbook = links.find((link) => link.kind === 'runbook')
    expect(runbook?.href).toMatch(/^https:\/\/docs\.example\.com\/docs\/runbooks\/.+\.md$/)
  })

  it('references runbooks that actually exist in the repository', () => {
    // process.cwd() is web/ under vitest; runbooks live at the repo root.
    const repoRoot = resolve(process.cwd(), '..')
    for (const path of listRunbookPaths()) {
      expect(existsSync(resolve(repoRoot, path)), `missing runbook: ${path}`).toBe(true)
    }
  })
})

describe('resolveDocsBaseUrl', () => {
  it('returns null when unset or blank', () => {
    expect(resolveDocsBaseUrl({})).toBeNull()
    expect(resolveDocsBaseUrl({ VITE_DOCS_BASE_URL: '   ' })).toBeNull()
  })

  it('rejects a relative base that would 404 inside the SPA shell', () => {
    expect(resolveDocsBaseUrl({ VITE_DOCS_BASE_URL: '/docs' })).toBeNull()
    expect(resolveDocsBaseUrl({ VITE_DOCS_BASE_URL: 'docs.example.com' })).toBeNull()
  })

  it('accepts an absolute http(s) base and trims trailing slashes', () => {
    expect(resolveDocsBaseUrl({ VITE_DOCS_BASE_URL: 'https://docs.example.com//' })).toBe(
      'https://docs.example.com',
    )
  })
})
