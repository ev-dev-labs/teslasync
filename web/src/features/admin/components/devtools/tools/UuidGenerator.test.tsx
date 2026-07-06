/**
 * UuidGeneratorTool contract + regression tests.
 *
 * UuidGeneratorTool is the interactive UUID dev-tool card. Its single export
 * owns a "Generate" action and a capped, newest-first history of generated ids,
 * each with a copy control. These tests exercise every branch of that state
 * machine plus the hardening added during elevation:
 *
 *   1. Chrome + a11y — title / description, a reachable "Generate" button, and
 *                      an explicit idle empty-state instead of a bare panel; the
 *                      generator is not called before the first click.
 *   2. Real v4       — one click yields exactly one RFC-4122 v4 id inside a
 *                      labelled role="list", the idle copy disappears, and a copy
 *                      control appears (honest integration with real safeRandomUUID).
 *   3. Newest-first  — three deterministic ids stack most-recent-first and every
 *                      id is listed once.
 *   4. History cap   — generating more than the cap keeps only the newest 10 ids
 *                      and drops the oldest (the `.slice(0, MAX_HISTORY)` guard).
 *   5. Copy          — clicking a row's copy control writes that id to the
 *                      clipboard and flips the button to "Copied".
 *   6. Stable keys   — copying one row then prepending a new id preserves the
 *                      first row's "Copied" affordance. The pre-hardening
 *                      `key={`${u}-${i}`}` re-keyed every existing row on prepend,
 *                      remounting it and silently resetting "Copied" back to "Copy".
 *                      Keying by the id itself keeps each row's identity.
 *
 * react-i18next is stubbed so t('English') returns its key verbatim, keeping the
 * assertions locale-file independent (repo convention — see RegexTester.test.tsx
 * / CronParser.test.tsx). safeRandomUUID is mocked but calls through to its real
 * implementation by default, so the happy path stays an honest integration test;
 * individual tests pin deterministic ids via mockReturnValueOnce / a counter.
 * navigator.clipboard is stubbed exactly as CopyButton.test.tsx does — no real
 * network or platform clipboard is touched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

vi.mock('@/lib/safeUUID', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/safeUUID')>()
  return { ...actual, safeRandomUUID: vi.fn(actual.safeRandomUUID) }
})

import { safeRandomUUID } from '@/lib/safeUUID'
import { UuidGeneratorTool } from './UuidGenerator'

const mockedUuid = vi.mocked(safeRandomUUID)

/** Canonical RFC-4122 v4 shape: version nibble `4`, variant nibble `8|9|a|b`. */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Deterministic, valid-shaped v4 ids for order/identity assertions.
const A = '0a1b2c3d-0001-4001-8001-0000000000a1'
const B = '0a1b2c3d-0002-4002-8002-0000000000b2'
const C = '0a1b2c3d-0003-4003-8003-0000000000c3'

const IDLE_HINT = 'Click Generate to create a UUID'

const writeText = vi.fn(() => Promise.resolve())

function clickGenerate() {
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
}

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('@/lib/safeUUID')>('@/lib/safeUUID')
  mockedUuid.mockReset()
  mockedUuid.mockImplementation(actual.safeRandomUUID)
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

afterEach(() => {
  cleanup()
})

describe('UuidGeneratorTool', () => {
  it('renders the tool chrome and an idle empty-state before anything is generated', () => {
    render(<UuidGeneratorTool />)

    expect(screen.getByText('Uuid Generator')).toBeInTheDocument()
    expect(screen.getByText('Uuid Generator Desc')).toBeInTheDocument()
    // The action is reachable by accessible name.
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument()

    // Idle: an explicit hint, never a blank panel, and no result list.
    expect(screen.getByText(IDLE_HINT)).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByText(UUID_V4_RE)).toBeNull()
    // The generator is untouched until the user asks for an id.
    expect(mockedUuid).not.toHaveBeenCalled()
  })

  it('generates a single RFC-4122 v4 id inside a labelled list with a copy control', () => {
    render(<UuidGeneratorTool />)

    clickGenerate()

    expect(mockedUuid).toHaveBeenCalledTimes(1)
    // The idle hint gives way to a real, accessible result region.
    expect(screen.queryByText(IDLE_HINT)).toBeNull()
    const list = screen.getByRole('list', { name: 'Generated UUIDs' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    // The one row shows a well-formed v4 id and a copy affordance.
    expect(within(items[0]).getByText(UUID_V4_RE)).toBeInTheDocument()
    expect(within(items[0]).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('stacks generated ids most-recent-first and lists each one exactly once', () => {
    mockedUuid.mockReturnValueOnce(A).mockReturnValueOnce(B).mockReturnValueOnce(C)
    render(<UuidGeneratorTool />)

    clickGenerate()
    clickGenerate()
    clickGenerate()

    expect(mockedUuid).toHaveBeenCalledTimes(3)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    // Newest (C) is on top; A — generated first — sinks to the bottom.
    const codes = screen.getAllByText(UUID_V4_RE)
    expect(codes.map((c) => c.textContent)).toEqual([C, B, A])
  })

  it('caps the history at the newest 10 ids and drops the oldest', () => {
    let n = 0
    mockedUuid.mockImplementation(
      () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`,
    )
    render(<UuidGeneratorTool />)

    for (let i = 0; i < 12; i++) clickGenerate()

    const texts = screen.getAllByText(UUID_V4_RE).map((c) => c.textContent)
    expect(texts).toHaveLength(10)
    // The newest (12th, index 11) is first; the two oldest are evicted.
    expect(texts[0]).toBe('00000000-0000-4000-8000-000000000011')
    expect(texts).not.toContain('00000000-0000-4000-8000-000000000000')
    expect(texts).not.toContain('00000000-0000-4000-8000-000000000001')
    // …while the oldest survivor (index 2) is still present.
    expect(texts).toContain('00000000-0000-4000-8000-000000000002')
  })

  it('copies a row to the clipboard and reflects the copied state', async () => {
    mockedUuid.mockReturnValueOnce(A)
    render(<UuidGeneratorTool />)

    clickGenerate()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(A))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('preserves each row copied state when a newer id is prepended (stable keys)', async () => {
    mockedUuid.mockReturnValueOnce(A)
    render(<UuidGeneratorTool />)

    // Generate A, then copy it — its row now reads "Copied".
    clickGenerate()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(A))
    await screen.findByRole('button', { name: 'Copied' })

    // Prepend a brand-new id B. With stable keys A keeps its identity…
    mockedUuid.mockReturnValueOnce(B)
    clickGenerate()

    // …so exactly one "Copied" (A) and one "Copy" (the fresh B) remain.
    expect(screen.getByRole('button', { name: /^Copied$/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Copy$/ })).toHaveLength(1)

    // And the surviving "Copied" belongs to A, now the second row, not B.
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent(B)
    expect(within(items[1]).getByText(A)).toBeInTheDocument()
    expect(within(items[1]).getByRole('button', { name: /^Copied$/ })).toBeInTheDocument()
  })
})
