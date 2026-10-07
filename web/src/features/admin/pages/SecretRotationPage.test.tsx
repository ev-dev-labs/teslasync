/**
 * SecretRotationPage contract tests.
 *
 * The page is a read-only security-observability surface backed by
 * GET /admin/observability/secret-rotation (via useSecretRotation). These
 * tests pin the behaviour an operator actually depends on:
 *
 *  1. Loading skeletons render before data lands.
 *  2. The KPI band derives totals, distinct-kind count, healthy %, oldest
 *     secret, and soonest expiry from the raw rows.
 *  3. The "Overdue rotations" banner appears only when a secret is critical
 *     (and interpolates the count).
 *  4. The per-secret detail table renders each row (kind + target + expiry).
 *  5. Accessible landmarks, chart img labels, and the refresh control exist.
 *  6. The urgency + severity-mix sections surface their derived readouts.
 *  7. A 503 renders the unsupported-deployment explainer (not an error).
 *  8. A genuine (non-503) failure renders <QueryError> everywhere — and the
 *     KPI band must NOT surface fabricated "0.00 tracked / 0.00 overdue"
 *     totals that would falsely reassure an operator no secret is overdue.
 *  9. Zero tracked secrets renders empty states for every section.
 * 10. Over-long kind labels are truncated in the summary cards but preserved
 *     in the detail table.
 * 11. A zero-age / zero-threshold secret still renders its urgency bar
 *     (no divide-by-zero).
 * 12. The header freshness control refetches on click.
 *
 * Network is mocked at the `@/api/client` boundary (the repo convention —
 * see DiskForecastPage.test.tsx). `@/lib/resilience` is left real so the
 * page's own `isApiError`/`ApiError` 503 branch is exercised honestly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
  // <QueryError> imports isApiError from @/api/client; stub it to false so a
  // plain Error falls to the generic "Can't reach server" branch. The PAGE
  // imports isApiError from @/lib/resilience (left real), so the 503
  // subsystem branch is still driven by a genuine ApiError instance.
  isApiError: () => false,
}))

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

import { request } from '@/api/client'
import { ApiError } from '@/lib/resilience'
import SecretRotationPage from './SecretRotationPage'
import type {
  SecretRotationResponse,
  SecretRotationStatus,
} from '@/types/admin-operator-confidence'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function makeStatus(
  overrides: Partial<SecretRotationStatus> = {},
): SecretRotationStatus {
  return {
    kind: 'tesla_refresh_token',
    last_rotated: '2026-01-01T00:00:00Z',
    age_days: 10,
    expires_at: null,
    days_to_expiry: null,
    warn_days: 90,
    critical_days: 180,
    severity: 'ok',
    ...overrides,
  }
}

// Three rows chosen so every derived metric has a clean, predictable string:
//   total        = 3        (→ "3.00")
//   distinctKinds = 3       (→ "3 kinds tracked")
//   counts        = ok 1 / warn 1 / critical 1
//   okPct         = round(1/3 * 100) = 33  (→ "33% of tracked")
//   oldest        = A (age 200)  (→ "200.00 d")
//   soonestExpiry = A (3 days)   (→ "3.00 d", red because critical)
function defaultItems(): SecretRotationStatus[] {
  return [
    makeStatus({
      kind: 'tesla_refresh_token',
      age_days: 200,
      warn_days: 90,
      critical_days: 180,
      expires_at: '2026-07-06T00:00:00Z',
      days_to_expiry: 3,
      severity: 'critical',
    }),
    makeStatus({
      kind: 'mqtt_mtls_cert',
      target_id: 'broker-1',
      age_days: 80,
      warn_days: 60,
      critical_days: 120,
      expires_at: '2026-08-17T00:00:00Z',
      days_to_expiry: 45,
      severity: 'warn',
    }),
    makeStatus({
      kind: 'database_password',
      age_days: 10,
      warn_days: 180,
      critical_days: 365,
      expires_at: null,
      days_to_expiry: null,
      severity: 'ok',
    }),
  ]
}

function makeResponse(
  items: SecretRotationStatus[] = defaultItems(),
): SecretRotationResponse {
  return { items }
}

function renderPage() {
  // retryDelay:0 keeps the hook's `retry: 1` (which overrides the client
  // default) from adding a real backoff to the rejection-path tests.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SecretRotationPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('SecretRotationPage', () => {
  it('renders skeleton placeholders while the query is loading', () => {
    let resolve: (v: SecretRotationResponse) => void = () => {}
    mockedRequest.mockReturnValueOnce(
      new Promise<SecretRotationResponse>((r) => {
        resolve = r
      }),
    )

    const { container } = renderPage()

    // Title chrome is always present; the KPI cards are not — the band is
    // still showing its six pulse skeletons.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Secret Rotation' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Tracked secrets')).toBeNull()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)

    // Settle the promise so React-Query teardown is clean.
    resolve(makeResponse([]))
  })

  it('derives totals, distinct-kind count, healthy %, oldest, and soonest expiry', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Tracked secrets')).toBeInTheDocument(),
    )

    // total (3) + distinctKinds (3) drive the "Tracked secrets" subtitle.
    expect(screen.getByText('3 kinds tracked')).toBeInTheDocument()
    // okPct = round(1/3 * 100) = 33.
    expect(screen.getByText('33% of tracked')).toBeInTheDocument()
    // oldest picks the LARGEST age (200), not the smallest.
    expect(screen.getByText('200.00 d')).toBeInTheDocument()
    // soonest expiry picks the SMALLEST days-to-expiry (3), not the largest (45).
    expect(screen.getByText('Soonest expiry')).toBeInTheDocument()
    expect(screen.getAllByText('3.00 d').length).toBeGreaterThan(0)
    // The oldest/soonest subtitle resolves the friendly kind label.
    expect(screen.getAllByText('Tesla refresh token').length).toBeGreaterThan(0)
  })

  it('surfaces the overdue banner (with count) when a secret is critical', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Overdue rotations')).toBeInTheDocument(),
    )

    // Count is interpolated (exactly one critical row in the fixture).
    expect(
      screen.getByText(
        /1 secrets are past their critical rotation threshold/i,
      ),
    ).toBeInTheDocument()
  })

  it('hides the overdue banner when nothing is critical', async () => {
    mockedRequest.mockResolvedValueOnce(
      makeResponse([
        makeStatus({ kind: 'database_password', severity: 'ok' }),
        makeStatus({ kind: 'session_jwk', severity: 'warn', age_days: 70 }),
      ]),
    )

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Tracked secrets')).toBeInTheDocument(),
    )
    expect(screen.queryByText('Overdue rotations')).toBeNull()
  })

  it('renders one detail-table row per secret with target + days-to-expiry', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    const table = await waitFor(() =>
      within(screen.getByRole('region', { name: 'Rotation status' })).getByRole('table'),
    )

    expect(within(table).getAllByText('Tesla refresh token').length).toBeGreaterThan(0)
    expect(within(table).getByText('MQTT mTLS certificate')).toBeInTheDocument()
    expect(within(table).getByText('Database password')).toBeInTheDocument()
    // target_id renders as the secondary caption under the kind.
    expect(within(table).getByText('broker-1')).toBeInTheDocument()
    // The expiry column interpolates the raw days_to_expiry.
    expect(within(table).getByText('3d remaining')).toBeInTheDocument()
    expect(within(table).getByText('45d remaining')).toBeInTheDocument()
  })

  it('exposes accessible landmarks, chart labels, and a refresh control', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Tracked secrets')).toBeInTheDocument(),
    )

    expect(
      screen.getByRole('region', { name: 'Rotation summary' }),
    ).toBeInTheDocument()

    // Charts are announced to assistive tech via role=img + descriptive labels.
    expect(
      screen.getByRole('img', {
        name: /horizontal bar chart of the oldest tracked secrets/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: /donut chart of tracked secrets grouped by rotation severity/i,
      }),
    ).toBeInTheDocument()

    // The freshness chip is an operable refresh button.
    expect(
      screen.getByRole('button', { name: /refresh/i }),
    ).toBeInTheDocument()
  })

  it('renders the urgency bars and severity-mix legend from the rows', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    // Gate on a post-load KPI card — the panel titles below render even while
    // the section bodies are still skeletons, so waiting on them would race.
    await waitFor(() =>
      expect(screen.getByText('Tracked secrets')).toBeInTheDocument(),
    )

    // Urgency bar sublabels read "age / critical" per secret.
    expect(screen.getByText('Rotation urgency')).toBeInTheDocument()
    expect(screen.getByText('200.00d / 180.00d')).toBeInTheDocument()
    expect(screen.getByText('80.00d / 120.00d')).toBeInTheDocument()

    // Severity mix panel + its legend list every tier label.
    expect(
      screen.getAllByRole('heading', { name: 'Severity mix' }).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('Expiry watch')).toBeInTheDocument()
    expect(screen.getAllByText('OK').length).toBeGreaterThan(0)
    // "Overdue" is the critical severity label (legend + badges).
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0)
  })

  it('renders the subsystem-unavailable explainer on a 503 (not an error)', async () => {
    mockedRequest.mockRejectedValue(
      new ApiError('not configured', 503, 'SUBSYSTEM_NOT_CONFIGURED'),
    )

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Feature not supported')).toBeInTheDocument(),
    )
    expect(
      screen.getByText(/rotation tracker is not configured on this deployment/i),
    ).toBeInTheDocument()
    // 503 is a graceful "not wired" state — never a red error panel.
    expect(screen.queryByText("Can't reach server")).toBeNull()
  })

  it('renders an error state (and no fabricated totals) on a non-503 failure', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'))

    renderPage()

    await waitFor(() =>
      expect(screen.getAllByText("Can't reach server").length).toBeGreaterThan(0),
    )
    // The KPI band must not lie with "0.00 tracked / 0.00 overdue" cards when
    // the fetch failed — that would tell a security operator nothing is
    // overdue while the data never loaded. Every KPI label lives only in the
    // summary band, so their absence proves the band collapsed to an error.
    expect(screen.queryByText('Tracked secrets')).toBeNull()
    expect(screen.queryByText('Healthy')).toBeNull()
    expect(screen.queryByText('Oldest secret')).toBeNull()
    // A hard failure is distinct from the 503 not-configured state.
    expect(screen.queryByText('Feature not supported')).toBeNull()
  })

  it('renders empty states for every section when there are zero secrets', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse([]))

    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText('No rotation ages to chart yet.'),
      ).toBeInTheDocument(),
    )

    expect(
      screen.getByText('No severity data available yet.'),
    ).toBeInTheDocument()
    expect(screen.getByText('No rotation ages to rank yet.')).toBeInTheDocument()
    expect(screen.getByText('No expiring credentials')).toBeInTheDocument()
    expect(screen.getByText('No tracked secrets')).toBeInTheDocument()
    // KPI placeholders degrade gracefully rather than vanishing.
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.getByText('No expiry tracked')).toBeInTheDocument()
    // Counts collapse to "0.00" rather than disappearing.
    expect(screen.getAllByText('0.00').length).toBeGreaterThan(0)
  })

  it('truncates over-long kind labels in the summary cards but not the table', async () => {
    const LONG = 'x'.repeat(30)
    const TRUNCATED = `${LONG.slice(0, 21)}\u2026`

    mockedRequest.mockResolvedValueOnce(
      makeResponse([
        makeStatus({
          kind: LONG,
          age_days: 100,
          critical_days: 200,
          severity: 'ok',
        }),
      ]),
    )

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Oldest secret')).toBeInTheDocument(),
    )

    // Summary cards clip the 30-char label to 21 chars + ellipsis…
    expect(screen.getAllByText(TRUNCATED).length).toBeGreaterThan(0)
    // …while the full label is preserved in the detail table.
    const table = within(
      screen.getByRole('region', { name: 'Rotation status' }),
    ).getByRole('table')
    expect(within(table).getByText(LONG)).toBeInTheDocument()
  })

  it('renders a zero-age / zero-threshold secret without a divide-by-zero', async () => {
    mockedRequest.mockResolvedValueOnce(
      makeResponse([
        makeStatus({
          kind: 'session_jwk',
          age_days: 0,
          warn_days: 0,
          critical_days: 0,
          severity: 'unknown',
        }),
      ]),
    )

    renderPage()

    // Gate on the post-load KPI card so the urgency bar has replaced its
    // loading skeleton before we assert its readout.
    await waitFor(() =>
      expect(screen.getByText('Tracked secrets')).toBeInTheDocument(),
    )
    expect(screen.getByText('Rotation urgency')).toBeInTheDocument()

    // The urgency bar still renders its readout for an all-zero secret
    // (the max falls back to a safe non-zero denominator instead of NaN%).
    // Scope to the urgency/expiry region — the same "0.00d / 0.00d" string
    // also legitimately appears in the table's warn/critical column.
    const outlook = screen.getByRole('region', {
      name: 'Rotation urgency and expiry outlook',
    })
    expect(within(outlook).getByText('0.00d / 0.00d')).toBeInTheDocument()
  })

  it('refetches when the header freshness control is activated', async () => {
    mockedRequest.mockResolvedValue(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Tracked secrets')).toBeInTheDocument(),
    )

    const refresh = screen.getByRole('button', { name: /refresh/i })
    const before = mockedRequest.mock.calls.length
    fireEvent.click(refresh)

    await waitFor(() =>
      expect(mockedRequest.mock.calls.length).toBeGreaterThan(before),
    )
  })
})
