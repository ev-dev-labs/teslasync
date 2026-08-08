/**
 * ChangesPanel — Feature Flags change-audit panel.
 *
 * The component is presentational: it takes `rows`, `loading` and an optional
 * `scopedKey`, then renders the change log through the shared `DataTable` (or
 * an `EmptyState` when there is nothing to show). These tests cover its sole
 * export (`ChangesPanel`) plus the internal `compact` value formatter and the
 * `OP_VARIANT` badge mapping via rendered output.
 *
 * Coverage:
 *   1. Row rendering — every column (changed_at, actor, key, operation badge,
 *      old/new compacted values, reason) across multiple rows.
 *   2. Operation → badge-variant mapping (set → success, delete → danger,
 *      unknown → neutral fallback).
 *   3. Empty state (not loading) — global vs scoped message + interpolation.
 *   4. Loading state — DataTable loading placeholder, NOT the empty panel.
 *   5. Null-safety — an undefined `rows` prop must never crash (the core bug
 *      this hardening fixes), in both the loading and not-loading branches.
 *   6. `compact` — null/em-dash, falsy-but-valid values (false / 0), short
 *      JSON, >60-char truncation with an ellipsis, and the circular-reference
 *      catch path.
 *   7. Falsy actor / reason render the em-dash placeholder, not empty cells.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Deterministic i18n: `t(key, default, opts)` returns the default string with
// `{{token}}` interpolated. Keeps assertions independent of the shipped
// translation catalogue.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// TimeStamp transitively pulls the settings query (useTimeFormatPreference →
// @/api/hooks/useSettings → useQuery). Stub the transport so nothing hits the
// network; the absolute format we request never reads the preference anyway.
vi.mock('@/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn().mockResolvedValue({}) }
})

import { ChangesPanel } from './ChangesPanel'
import type {
  FeatureFlagChange,
  FeatureFlagOperation,
} from '@/types/admin-diagnostics'
import { BADGE_VARIANTS } from '@/components/ui'

// U+2014 EM DASH — the universal "missing value" placeholder. Referenced by
// codepoint so the test source stays ASCII-clean and unambiguous.
const EM_DASH = '\u2014'
const ELLIPSIS_CODE = 0x2026 // '…' appended by compact() on truncation.
const isEmDash = (content: string) => content === EM_DASH

function makeChange(
  over: Partial<FeatureFlagChange> & { id: number },
): FeatureFlagChange {
  return {
    id: over.id,
    changed_at: over.changed_at ?? '2026-01-01T00:00:00Z',
    actor: over.actor ?? 'system',
    actor_ip: over.actor_ip ?? '127.0.0.1',
    flag_key: over.flag_key ?? 'flag.key',
    operation: over.operation ?? 'set',
    old_value: over.old_value ?? null,
    new_value: over.new_value ?? null,
    reason: over.reason ?? 'reason',
    trace_id: over.trace_id ?? 'trace',
  }
}

function renderPanel(props: {
  rows?: FeatureFlagChange[]
  loading?: boolean
  scopedKey?: string | null
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ChangesPanel
        // Cast lets the null-safety cases feed an undefined `rows` through the
        // typed prop boundary on purpose.
        rows={props.rows as FeatureFlagChange[]}
        loading={props.loading ?? false}
        scopedKey={props.scopedKey ?? undefined}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('ChangesPanel', () => {
  it('renders every column across multiple rows', () => {
    const rows = [
      makeChange({
        id: 1,
        actor: 'alice',
        flag_key: 'flag.alpha',
        operation: 'set',
        reason: 'enable alpha',
      }),
      makeChange({
        id: 2,
        actor: 'bob',
        flag_key: 'flag.beta',
        operation: 'delete',
        reason: 'retire beta',
      }),
      makeChange({
        id: 3,
        actor: 'carol',
        flag_key: 'flag.gamma',
        operation: 'set',
        reason: 'enable gamma',
      }),
    ]
    renderPanel({ rows })

    // Actor + key + reason columns for each row.
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('flag.alpha')).toBeInTheDocument()
    expect(screen.getByText('flag.gamma')).toBeInTheDocument()
    expect(screen.getByText('enable alpha')).toBeInTheDocument()
    expect(screen.getByText('retire beta')).toBeInTheDocument()

    // Operation badges: two "set", one "delete".
    expect(screen.getAllByText('set')).toHaveLength(2)
    expect(screen.getByText('delete')).toBeInTheDocument()

    // One <tr> per row (no virtualisation at this size).
    expect(document.querySelectorAll('tbody tr')).toHaveLength(3)
  })

  it('maps the operation to the correct badge variant, falling back to neutral', () => {
    renderPanel({
      rows: [
        makeChange({ id: 1, operation: 'set', flag_key: 'k.set' }),
        makeChange({ id: 2, operation: 'delete', flag_key: 'k.del' }),
        // Bad/unknown operation from the backend must degrade to neutral,
        // never crash the badge lookup.
        makeChange({
          id: 3,
          operation: 'archive' as FeatureFlagOperation,
          flag_key: 'k.arch',
        }),
      ],
    })

    expect(screen.getByText('set').className).toContain('bg-green-100')
    expect(screen.getByText('delete').className).toContain('bg-red-100')
    expect(screen.getByText('archive').className).toContain(BADGE_VARIANTS.neutral)
  })

  it('shows the global empty state when there are no rows and not loading', () => {
    renderPanel({ rows: [], loading: false })

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No flag changes yet')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Flag changes will appear here once an operator edits a value/,
      ),
    ).toBeInTheDocument()
  })

  it('shows a scoped empty message with the flag key interpolated', () => {
    renderPanel({ rows: [], loading: false, scopedKey: 'my.flag' })

    expect(
      screen.getByText(/No audit rows for "my\.flag"/),
    ).toBeInTheDocument()
    // The global variant must not appear when scoped.
    expect(
      screen.queryByText(/Flag changes will appear here/),
    ).toBeNull()
  })

  it('shows the DataTable loading placeholder (not the empty panel) while loading', () => {
    renderPanel({ rows: [], loading: true })

    expect(screen.getByText(/Loading audit log/)).toBeInTheDocument()
    // EmptyState (role=status) is only rendered on the not-loading branch.
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('No flag changes yet')).toBeNull()
  })

  it('does not crash on an undefined rows prop while not loading (null-safety)', () => {
    renderPanel({ rows: undefined, loading: false })

    // The null-guard collapses undefined → [] → the empty panel.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No flag changes yet')).toBeInTheDocument()
  })

  it('does not crash on an undefined rows prop while loading (null-safety)', () => {
    renderPanel({ rows: undefined, loading: true })

    expect(screen.getByText(/Loading audit log/)).toBeInTheDocument()
  })

  it('compacts falsy-but-valid values and short JSON without collapsing them to a dash', () => {
    renderPanel({
      rows: [
        makeChange({
          id: 1,
          actor: 'a',
          reason: 'r',
          flag_key: 'k.bool',
          old_value: false,
          new_value: 0,
        }),
        makeChange({
          id: 2,
          actor: 'b',
          reason: 's',
          flag_key: 'k.obj',
          old_value: { a: 1 },
          new_value: [1, 2],
        }),
      ],
    })

    // `false` and `0` are valid JSON — they must render, not become "—".
    expect(screen.getByText('false')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('{"a":1}')).toBeInTheDocument()
    expect(screen.getByText('[1,2]')).toBeInTheDocument()
  })

  it('truncates values whose JSON exceeds 60 chars and appends an ellipsis', () => {
    renderPanel({
      rows: [
        makeChange({
          id: 1,
          actor: 'a',
          reason: 'r',
          flag_key: 'k.long',
          old_value: 'x',
          new_value: 'z'.repeat(100),
        }),
      ],
    })

    // '"' + 56 'z' + '…' === 58 chars; the 58th char (index 57) is the ellipsis.
    const truncated = screen.getByText(
      (content) => content.length === 58 && content.startsWith('"z'),
    )
    expect(truncated.textContent).toHaveLength(58)
    expect(truncated.textContent?.charCodeAt(57)).toBe(ELLIPSIS_CODE)
  })

  it('renders an em-dash for null values and for un-stringifiable (circular) values', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular // JSON.stringify throws → compact() catch → "—".

    renderPanel({
      rows: [
        makeChange({
          id: 1,
          actor: 'sys',
          reason: 'audited',
          flag_key: 'k.circular',
          old_value: null,
          new_value: circular,
        }),
      ],
    })

    // Exactly two placeholders: old_value (null) and new_value (circular).
    expect(screen.getAllByText(isEmDash)).toHaveLength(2)
    // A circular object must never leak its raw string form.
    expect(screen.queryByText('[object Object]')).toBeNull()
  })

  it('renders an em-dash for empty actor and empty reason but keeps real values', () => {
    renderPanel({
      rows: [
        makeChange({
          id: 1,
          actor: '',
          reason: '',
          flag_key: 'k.blank',
          old_value: 'x',
          new_value: 'y',
        }),
      ],
    })

    // actor '' → "—" and reason '' → "—": exactly two placeholders.
    expect(screen.getAllByText(isEmDash)).toHaveLength(2)
    // The real string values still render (quoted JSON), not placeholders.
    expect(screen.getByText('"x"')).toBeInTheDocument()
    expect(screen.getByText('"y"')).toBeInTheDocument()
  })
})
