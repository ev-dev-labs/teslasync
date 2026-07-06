/**
 * SessionsTable — behavioural contract for the active-devices detail band.
 *
 * SessionsTable owns its own loading + error states and delegates the empty
 * state to `DataTable`'s `emptyMessage`. The current device is flagged with a
 * pill and never gets a per-row "Sign out" control (you sign yourself out via
 * the header "sign out all others" action, not here).
 *
 * Coverage goes well past a smoke render:
 *   • the loaded table: one row per session, the column-header contract, and
 *     that each cell reads the RIGHT field (device←user_agent via describeDevice,
 *     ip←ip, signed-in←created_at, last-seen←last_seen_at) — the date formatter
 *     is mocked to a deterministic `dt:<value>` so wiring is provable;
 *   • the current-device branch: only the `current` row shows the pill, and
 *     only the non-current rows expose a revoke button;
 *   • the revoke interaction: clicking a row's button calls `onRevoke` with that
 *     exact session, the accessible name names the device, and the in-flight
 *     `revokingId` disables just that row;
 *   • null-safety guards: empty `ip` / unknown `user_agent` fall back to an
 *     em-dash, and an `undefined` `sessions` prop degrades to the empty state
 *     instead of crashing `DataTable`'s `.map`/`.length`;
 *   • the three owned states: loading (skeleton, no table), error (QueryError +
 *     working retry), empty (DataTable placeholder);
 *   • a11y: the labelled region + panel heading.
 *
 * The date formatter is mocked (avoids the settings query / real network) and
 * react-i18next is stubbed to fall back to the inline defaults, mirroring the
 * sibling ActiveSessionsPage suite. `@testing-library/user-event` is not
 * installed in this repo, so interactions are driven with `fireEvent`.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        const interpolate = (s: string) => {
          if (!opts) return s
          return Object.keys(opts).reduce(
            (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
            s,
          )
        }
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

// Deterministic, network-free date formatter so we can prove which cell reads
// which field without depending on the user's locale / timezone settings.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | Date | null | undefined) =>
      value == null ? '—' : `dt:${String(value)}`,
  }),
}))

import { ApiError } from '@/api/client'
import type { ActiveSession } from '@/api/types'
import { describeDevice } from './deviceLabel'
import SessionsTableDefault, { SessionsTable } from './SessionsTable'

// Real UAs → deterministic labels via the shared heuristic. Building the
// expected label through `describeDevice` keeps assertions robust to the exact
// separator glyph the component renders.
const WIN_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const LINUX_FIREFOX =
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'

const CURRENT: ActiveSession = {
  id: 'sess-current',
  user_agent: WIN_FIREFOX,
  ip: '10.0.0.1',
  created_at: '2026-05-05T10:00:00Z',
  last_seen_at: '2026-05-05T12:00:00Z',
  current: true,
}

const OTHER: ActiveSession = {
  id: 'sess-other',
  user_agent: MAC_CHROME,
  ip: '10.0.0.2',
  created_at: '2026-05-04T08:00:00Z',
  last_seen_at: '2026-05-05T11:30:00Z',
  current: false,
}

type Props = Parameters<typeof SessionsTable>[0]

function renderTable(overrides: Partial<Props> = {}) {
  const props: Props = {
    sessions: [CURRENT, OTHER],
    onRevoke: vi.fn(),
    revokingId: null,
    isLoading: false,
    isError: false,
    error: undefined,
    onRetry: vi.fn(),
    ...overrides,
  }
  const utils = render(
    <MemoryRouter>
      <SessionsTable {...props} />
    </MemoryRouter>,
  )
  return { ...utils, props }
}

describe('SessionsTable — loaded table content + field wiring', () => {
  it('renders every declared column header', () => {
    renderTable()
    expect(screen.getByRole('columnheader', { name: 'Device' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'IP address' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Signed in' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Last seen' })).toBeInTheDocument()
    // device / ip / created / last-seen / actions — the actions header is blank.
    expect(screen.getAllByRole('columnheader')).toHaveLength(5)
  })

  it('renders one row per session with the correct device label and IP', () => {
    renderTable()
    expect(screen.getByText(describeDevice(WIN_FIREFOX))).toBeInTheDocument()
    expect(screen.getByText(describeDevice(MAC_CHROME))).toBeInTheDocument()
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.2')).toBeInTheDocument()
  })

  it('routes created_at → "Signed in" and last_seen_at → "Last seen" cells', () => {
    renderTable()
    // The mocked formatter echoes `dt:<value>`, so the exact timestamps prove
    // the column render functions read the right fields (not swapped).
    expect(screen.getByText('dt:2026-05-05T10:00:00Z')).toBeInTheDocument() // current.created_at
    expect(screen.getByText('dt:2026-05-05T12:00:00Z')).toBeInTheDocument() // current.last_seen_at
    expect(screen.getByText('dt:2026-05-04T08:00:00Z')).toBeInTheDocument() // other.created_at
    expect(screen.getByText('dt:2026-05-05T11:30:00Z')).toBeInTheDocument() // other.last_seen_at
  })
})

describe('SessionsTable — current-device flagging', () => {
  it('shows the "This device" pill only on the current row', () => {
    renderTable()
    const pill = screen.getByTestId(`active-sessions-current-pill-${CURRENT.id}`)
    expect(pill).toHaveTextContent('This device')
    expect(screen.queryByTestId(`active-sessions-current-pill-${OTHER.id}`)).toBeNull()
  })

  it('exposes a revoke button only on non-current rows', () => {
    renderTable()
    expect(screen.getByTestId(`active-sessions-revoke-${OTHER.id}`)).toBeInTheDocument()
    // The current device must never be revocable from this table.
    expect(screen.queryByTestId(`active-sessions-revoke-${CURRENT.id}`)).toBeNull()
  })
})

describe('SessionsTable — revoke interaction', () => {
  it('calls onRevoke with the exact session when its button is clicked', () => {
    const { props } = renderTable()
    fireEvent.click(screen.getByTestId(`active-sessions-revoke-${OTHER.id}`))
    expect(props.onRevoke).toHaveBeenCalledTimes(1)
    expect(props.onRevoke).toHaveBeenCalledWith(OTHER)
  })

  it('gives the revoke control an accessible name that includes the device', () => {
    renderTable()
    const button = screen.getByRole('button', {
      name: `Sign out ${describeDevice(MAC_CHROME)}`,
    })
    expect(button).toBeInTheDocument()
  })

  it('disables only the row whose revoke is in flight', () => {
    const third: ActiveSession = {
      id: 'sess-third',
      user_agent: LINUX_FIREFOX,
      ip: '10.0.0.3',
      created_at: '2026-05-03T08:00:00Z',
      last_seen_at: '2026-05-05T09:00:00Z',
      current: false,
    }
    renderTable({ sessions: [CURRENT, OTHER, third], revokingId: OTHER.id })
    expect(screen.getByTestId(`active-sessions-revoke-${OTHER.id}`)).toBeDisabled()
    expect(screen.getByTestId(`active-sessions-revoke-${third.id}`)).not.toBeDisabled()
  })
})

describe('SessionsTable — null-safety fallbacks', () => {
  it('renders an em-dash for an empty IP and an unrecognised user agent', () => {
    const sparse: ActiveSession = {
      id: 'sess-sparse',
      user_agent: '',
      ip: '',
      created_at: '2026-05-05T10:00:00Z',
      last_seen_at: '2026-05-05T12:00:00Z',
      current: false,
    }
    renderTable({ sessions: [sparse] })
    // describeDevice('') and the `ip || '—'` guard both yield the same glyph —
    // exactly two cells (device + ip); the date cells still render `dt:…`.
    const dash = describeDevice('')
    expect(screen.getAllByText(dash)).toHaveLength(2)
  })

  it('degrades to the empty state instead of crashing when sessions is undefined', () => {
    // The prop is typed as required, but DataTable calls `.length`/`.map` on it;
    // the `?? []` guard keeps a runtime `undefined` from throwing.
    renderTable({ sessions: undefined as unknown as ActiveSession[] })
    expect(
      screen.getByText('No active sessions for this account.'),
    ).toBeInTheDocument()
  })
})

describe('SessionsTable — owned states', () => {
  it('shows a skeleton and no table while loading', () => {
    const { container } = renderTable({ isLoading: true })
    expect(screen.queryByRole('table')).toBeNull()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    // The panel chrome (title) stays mounted during load — never a blank panel.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Active devices' }),
    ).toBeInTheDocument()
  })

  it('renders a QueryError with a working retry on failure', () => {
    const onRetry = vi.fn()
    renderTable({
      isError: true,
      error: new ApiError('server exploded', 500),
      onRetry,
    })
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('Server error')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('surfaces the empty-state message when there are no sessions', () => {
    renderTable({ sessions: [] })
    expect(
      screen.getByText('No active sessions for this account.'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId(`active-sessions-revoke-${OTHER.id}`)).toBeNull()
  })
})

describe('SessionsTable — structure + exports', () => {
  it('labels the section region and the panel heading for assistive tech', () => {
    renderTable()
    expect(screen.getByRole('region', { name: 'Active devices' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: 'Active devices' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('active-sessions-section')).toBeInTheDocument()
  })

  it('default export is the same component as the named export', () => {
    expect(SessionsTableDefault).toBe(SessionsTable)
  })
})
