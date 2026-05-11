import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import {
  DraftRestorePrompt,
  __resetDraftRestorePromptForTests,
} from './DraftRestorePrompt'
import {
  __resetDraftIndexForTests,
  registerDraft,
  DRAFT_INDEX_KEY,
} from '@/lib/draftIndex'
import {
  broadcast,
  TAB_ID,
  __resetBroadcastForTests,
  type BroadcastMessage,
} from '@/lib/broadcast'

// ── i18n: passthrough that honours `defaultValue` so the strings render
// without loading the full i18n init.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValueOrOpts?: unknown, maybeOpts?: unknown) => {
      let opts: Record<string, unknown> | undefined
      let fallback: string | undefined
      if (typeof defaultValueOrOpts === 'string') {
        fallback = defaultValueOrOpts
        opts = (maybeOpts as Record<string, unknown> | undefined) ?? undefined
      } else {
        opts = (defaultValueOrOpts as Record<string, unknown> | undefined) ?? undefined
        fallback =
          (opts?.defaultValue as string | undefined) ??
          (opts?.defaultValue_other as string | undefined)
      }
      let result = fallback ?? key
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          if (k.startsWith('default')) continue
          result = result.replace(
            new RegExp(`{{\\s*${k}\\s*}}`, 'g'),
            String(v),
          )
        }
      }
      return result
    },
  }),
}))

const ENV_KEY_RULE_42 = 'teslasync:draft:v1:alertstudio:rule:42'
const ENV_KEY_AUTO_NEW = 'teslasync:draft:v1:automation:builder:new'
const FALLBACK_KEY_PREFIX = '__teslasync_bus_'

function writeEnvelope(key: string, savedAt: number, value: unknown = { dirty: true }) {
  localStorage.setItem(
    key,
    JSON.stringify({ version: 1, savedAt, value }),
  )
}

/**
 * Dispatch a broadcast message AS IF it came from a sibling tab. The
 * production `broadcast()` helper stamps every envelope with the local
 * `TAB_ID`, and `subscribe()` filters those self-messages out. Tests
 * that need to simulate a peer must construct the envelope with a
 * different `_from` and inject it via a synthetic `storage` event,
 * mirroring the localStorage-fallback transport supported by `subscribe()`.
 */
function broadcastFromSiblingTab(siblingTabId: string, msg: BroadcastMessage) {
  const envelope = { _from: siblingTabId, _ts: Date.now(), msg }
  const key = `${FALLBACK_KEY_PREFIX}${envelope._ts}_${Math.random().toString(36).slice(2)}`
  const newValue = JSON.stringify(envelope)
  // We don't actually need to write to localStorage — `subscribe()` only
  // reads `e.key` + `e.newValue` off the StorageEvent itself.
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

function renderPrompt(props: { gracePeriodMs?: number; skipSessionGuard?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={<DraftRestorePrompt skipSessionGuard {...props} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

function renderPromptWithLocationProbe(props: { gracePeriodMs?: number } = {}) {
  let lastLocation: ReturnType<typeof useLocation> | null = null
  function Probe() {
    lastLocation = useLocation()
    return null
  }
  const utils = render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <DraftRestorePrompt skipSessionGuard {...props} />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  return { ...utils, getLocation: () => lastLocation }
}

describe('DraftRestorePrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    sessionStorage.clear()
    __resetDraftIndexForTests()
    __resetBroadcastForTests()
    __resetDraftRestorePromptForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('renders nothing when there are no drafts', () => {
    const { container } = renderPrompt({ gracePeriodMs: 50 })
    act(() => { vi.advanceTimersByTime(60) })
    expect(container.querySelector('[data-testid="draft-restore-prompt"]')).toBeNull()
  })

  it('surfaces the prompt after the grace period when an envelope exists', () => {
    writeEnvelope(ENV_KEY_RULE_42, Date.now() - 30_000)
    renderPrompt({ gracePeriodMs: 50 })

    expect(screen.queryByTestId('draft-restore-prompt')).toBeNull()

    act(() => { vi.advanceTimersByTime(60) })

    expect(screen.getByTestId('draft-restore-prompt')).toBeInTheDocument()
    // Default fallback label resolves via the rule prefix.
    expect(screen.getByText(/1 unsaved draft/)).toBeInTheDocument()
  })

  it('surfaces multiple drafts (registered + scanned-fallback) and shows the count', () => {
    writeEnvelope(ENV_KEY_RULE_42, Date.now() - 60_000)
    writeEnvelope(ENV_KEY_AUTO_NEW, Date.now() - 30_000)
    registerDraft({
      storageKey: ENV_KEY_RULE_42,
      key: 'alertstudio:rule:42',
      version: 1,
      label: 'Brake-temp alert',
      route: '/alert-studio?id=42',
      savedAt: Date.now() - 60_000,
    })

    renderPrompt({ gracePeriodMs: 50 })
    act(() => { vi.advanceTimersByTime(60) })

    expect(screen.getByTestId('draft-restore-prompt')).toBeInTheDocument()
    // Plural body confirms count substitution.
    expect(screen.getByText(/2 unsaved drafts/)).toBeInTheDocument()
  })

  it('opens the modal listing all drafts when Review is clicked', () => {
    writeEnvelope(ENV_KEY_RULE_42, Date.now() - 30_000)
    registerDraft({
      storageKey: ENV_KEY_RULE_42,
      key: 'alertstudio:rule:42',
      version: 1,
      label: 'Brake-temp alert',
      route: '/alert-studio?id=42',
      savedAt: Date.now() - 30_000,
    })

    renderPrompt({ gracePeriodMs: 50 })
    act(() => { vi.advanceTimersByTime(60) })

    fireEvent.click(screen.getByTestId('draft-restore-prompt-review'))
    const modalList = screen.getByTestId('draft-restore-modal-list')
    expect(within(modalList).getByText('Brake-temp alert')).toBeInTheDocument()
    expect(
      screen.getByTestId(`draft-restore-resume-${ENV_KEY_RULE_42}`),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId(`draft-restore-discard-${ENV_KEY_RULE_42}`),
    ).toBeInTheDocument()
  })

  it('Discard removes the envelope and the index entry, then closes the prompt', () => {
    writeEnvelope(ENV_KEY_RULE_42, Date.now() - 30_000)
    registerDraft({
      storageKey: ENV_KEY_RULE_42,
      key: 'alertstudio:rule:42',
      version: 1,
      label: 'Brake-temp alert',
      route: '/alert-studio?id=42',
      savedAt: Date.now() - 30_000,
    })

    renderPrompt({ gracePeriodMs: 50 })
    act(() => { vi.advanceTimersByTime(60) })
    fireEvent.click(screen.getByTestId('draft-restore-prompt-review'))
    fireEvent.click(screen.getByTestId(`draft-restore-discard-${ENV_KEY_RULE_42}`))

    // Envelope is gone from storage.
    expect(localStorage.getItem(ENV_KEY_RULE_42)).toBeNull()
    // Index entry is gone too.
    const indexRaw = localStorage.getItem(DRAFT_INDEX_KEY)
    if (indexRaw) {
      const parsed = JSON.parse(indexRaw)
      expect(parsed.drafts[ENV_KEY_RULE_42]).toBeUndefined()
    }
    // With the only draft gone, the prompt and modal both close.
    expect(screen.queryByTestId('draft-restore-prompt')).toBeNull()
    expect(screen.queryByTestId('draft-restore-modal-list')).toBeNull()
  })

  it('Resume navigates to the draft route', () => {
    writeEnvelope(ENV_KEY_RULE_42, Date.now() - 30_000)
    registerDraft({
      storageKey: ENV_KEY_RULE_42,
      key: 'alertstudio:rule:42',
      version: 1,
      label: 'Brake-temp alert',
      route: '/alert-studio?id=42',
      savedAt: Date.now() - 30_000,
    })

    const { getLocation } = renderPromptWithLocationProbe({ gracePeriodMs: 50 })
    act(() => { vi.advanceTimersByTime(60) })
    fireEvent.click(screen.getByTestId('draft-restore-prompt-review'))
    fireEvent.click(screen.getByTestId(`draft-restore-resume-${ENV_KEY_RULE_42}`))

    const loc = getLocation()
    expect(loc?.pathname).toBe('/notifications/studio')
    expect(loc?.search).toBe('?id=42')
  })

  it('Dismiss sets the session-guard so the prompt does not re-show', () => {
    writeEnvelope(ENV_KEY_RULE_42, Date.now() - 30_000)

    renderPrompt({ gracePeriodMs: 50 })
    act(() => { vi.advanceTimersByTime(60) })
    fireEvent.click(screen.getByTestId('draft-restore-prompt-dismiss'))

    expect(screen.queryByTestId('draft-restore-prompt')).toBeNull()
    expect(sessionStorage.getItem('teslasync:draft-prompt-shown:v1')).toBe('1')
  })

  it('respects the session-guard on subsequent mounts (production behaviour)', () => {
    writeEnvelope(ENV_KEY_RULE_42, Date.now() - 30_000)
    sessionStorage.setItem('teslasync:draft-prompt-shown:v1', '1')

    // Production-style render: skipSessionGuard defaults to false.
    render(
      <MemoryRouter>
        <DraftRestorePrompt gracePeriodMs={50} />
      </MemoryRouter>,
    )
    act(() => { vi.advanceTimersByTime(60) })
    expect(screen.queryByTestId('draft-restore-prompt')).toBeNull()
  })

  it('cross-tab acquired broadcast suppresses the prompt for that key', () => {
    writeEnvelope(ENV_KEY_RULE_42, Date.now() - 30_000)
    writeEnvelope(ENV_KEY_AUTO_NEW, Date.now() - 30_000)

    renderPrompt({ gracePeriodMs: 100 })

    // Sibling tab announces it owns the rule draft right now.
    act(() => {
      broadcastFromSiblingTab('sibling-tab', {
        type: 'formDraft.acquired',
        draftKey: ENV_KEY_RULE_42,
        tabId: 'sibling-tab',
        ts: Date.now(),
      })
    })

    act(() => { vi.advanceTimersByTime(120) })

    expect(screen.getByTestId('draft-restore-prompt')).toBeInTheDocument()
    // Only the automation draft is surfaced.
    expect(screen.getByText(/1 unsaved draft/)).toBeInTheDocument()
  })

  it('ignores acquired broadcasts from itself (TAB_ID match filtered upstream)', () => {
    writeEnvelope(ENV_KEY_RULE_42, Date.now() - 30_000)

    renderPrompt({ gracePeriodMs: 100 })

    // Self-broadcast (e.g. via useFormDraft mounted in this tab) must NOT
    // suppress — `subscribe()` filters self-messages out via TAB_ID
    // before they reach the prompt.
    act(() => {
      broadcast({
        type: 'formDraft.acquired',
        draftKey: ENV_KEY_RULE_42,
        tabId: TAB_ID,
        ts: Date.now(),
      })
    })

    act(() => { vi.advanceTimersByTime(120) })
    expect(screen.getByTestId('draft-restore-prompt')).toBeInTheDocument()
  })

  it('hides the prompt when ALL drafts are claimed by siblings', () => {
    writeEnvelope(ENV_KEY_RULE_42, Date.now() - 30_000)

    renderPrompt({ gracePeriodMs: 100 })

    act(() => {
      broadcastFromSiblingTab('sibling-tab', {
        type: 'formDraft.acquired',
        draftKey: ENV_KEY_RULE_42,
        tabId: 'sibling-tab',
        ts: Date.now(),
      })
    })
    act(() => { vi.advanceTimersByTime(120) })

    // No drafts left after filtering → prompt stays hidden.
    expect(screen.queryByTestId('draft-restore-prompt')).toBeNull()
  })

  it('released broadcast cancels suppression for that key', () => {
    writeEnvelope(ENV_KEY_RULE_42, Date.now() - 30_000)

    renderPrompt({ gracePeriodMs: 100 })

    act(() => {
      broadcastFromSiblingTab('sibling-tab', {
        type: 'formDraft.acquired',
        draftKey: ENV_KEY_RULE_42,
        tabId: 'sibling-tab',
        ts: Date.now(),
      })
      broadcastFromSiblingTab('sibling-tab', {
        type: 'formDraft.released',
        draftKey: ENV_KEY_RULE_42,
        tabId: 'sibling-tab',
      })
    })
    act(() => { vi.advanceTimersByTime(120) })

    // Released cancels the suppression → prompt shows.
    expect(screen.getByTestId('draft-restore-prompt')).toBeInTheDocument()
  })
})
