import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import {
  ONBOARDING_COMPLETION_KEY,
  ONBOARDING_COMPLETION_VERSION,
  __resetOnboardingCompletionForTests,
  getOnboardingCompletion,
  isOnboardingCompleted,
  markOnboardingCompleted,
} from '../completion'

/**
 * HELP: onboarding completion (correction round).
 *
 * The live bug: `teslasync-onboarded` had exactly one writer,
 * `<OnboardingWizard>`, and that component was never mounted. So the key was
 * never set on any install, and `useChangelog().hasCompletedOnboarding` — which
 * reads it — was permanently false. A dead component silently disabled the
 * changelog auto-show two modules away.
 */

const mockStatus = vi.hoisted(() => ({
  current: { data: undefined as unknown, isLoading: true, isError: false },
}))
const broadcastSpy = vi.hoisted(() => vi.fn())

vi.mock('@/api/hooks/useOnboarding', () => ({
  useOnboardingStatus: () => mockStatus.current,
}))

vi.mock('@/lib/broadcast', () => ({
  broadcast: (m: unknown) => broadcastSpy(m),
  subscribe: () => () => undefined,
}))

vi.mock('../hooks/useOnboardingSkip', () => ({
  useOnboardingSkip: () => ({ isSkipped: false, skip: vi.fn(), reset: vi.fn() }),
}))

beforeEach(() => {
  window.localStorage.clear()
  __resetOnboardingCompletionForTests()
  broadcastSpy.mockClear()
  mockStatus.current = { data: undefined, isLoading: true, isError: false }
})

describe('completion storage — versioned and idempotent', () => {
  it('starts unset', () => {
    expect(isOnboardingCompleted()).toBe(false)
    expect(getOnboardingCompletion()).toBeNull()
  })

  it('records a versioned payload with a source and timestamp', () => {
    expect(markOnboardingCompleted('setup-complete', () => '2026-01-02T03:04:05.000Z')).toBe(
      true,
    )

    const completion = getOnboardingCompletion()
    expect(completion).toEqual({
      version: ONBOARDING_COMPLETION_VERSION,
      at: '2026-01-02T03:04:05.000Z',
      source: 'setup-complete',
    })
    expect(isOnboardingCompleted()).toBe(true)
  })

  it('is idempotent — a second write is a no-op and reports false', () => {
    expect(markOnboardingCompleted('setup-complete', () => 'first')).toBe(true)
    expect(markOnboardingCompleted('wizard', () => 'second')).toBe(false)
    // The original record is not overwritten.
    expect(getOnboardingCompletion()?.at).toBe('first')
    expect(getOnboardingCompletion()?.source).toBe('setup-complete')
  })

  it('keeps the legacy key name so existing readers keep working', () => {
    markOnboardingCompleted('setup-complete')
    // `useChangelog` tests `getItem(key) != null`.
    expect(window.localStorage.getItem(ONBOARDING_COMPLETION_KEY)).not.toBeNull()
    expect(window.localStorage.getItem('teslasync-onboarded')).not.toBeNull()
  })

  it('honours the legacy literal "true" written by the old wizard', () => {
    window.localStorage.setItem(ONBOARDING_COMPLETION_KEY, 'true')
    expect(isOnboardingCompleted()).toBe(true)
    expect(getOnboardingCompletion()?.source).toBe('wizard')
    // A user who already completed onboarding must not be re-prompted just
    // because the storage format changed.
    expect(markOnboardingCompleted('setup-complete')).toBe(false)
  })

  it('treats an unparseable value as legacy completion rather than discarding it', () => {
    window.localStorage.setItem(ONBOARDING_COMPLETION_KEY, '{not json')
    expect(isOnboardingCompleted()).toBe(true)
  })

  it('treats an empty string as not completed', () => {
    window.localStorage.setItem(ONBOARDING_COMPLETION_KEY, '')
    expect(isOnboardingCompleted()).toBe(false)
  })

  it('re-prompts when the stored version is older than the current one', () => {
    window.localStorage.setItem(
      ONBOARDING_COMPLETION_KEY,
      JSON.stringify({ version: ONBOARDING_COMPLETION_VERSION - 1, at: '', source: 'wizard' }),
    )
    expect(isOnboardingCompleted()).toBe(false)
  })
})

describe('OnboardingGate — writes completion from the real status contract', () => {
  async function renderGate() {
    const { OnboardingGate } = await import('../components/OnboardingGate')
    return render(
      <MemoryRouter initialEntries={['/']}>
        <OnboardingGate />
      </MemoryRouter>,
    )
  }

  it('does not record completion while the status query is loading', async () => {
    mockStatus.current = { data: undefined, isLoading: true, isError: false }
    await renderGate()
    expect(isOnboardingCompleted()).toBe(false)
  })

  it('does not record completion when the status query errored', async () => {
    mockStatus.current = { data: undefined, isLoading: false, isError: true }
    await renderGate()
    expect(isOnboardingCompleted()).toBe(false)
  })

  it('does not record completion while setup is still required', async () => {
    mockStatus.current = { data: { setup_required: true }, isLoading: false, isError: false }
    await renderGate()
    expect(isOnboardingCompleted()).toBe(false)
  })

  it('records completion once setup is no longer required', async () => {
    mockStatus.current = { data: { setup_required: false }, isLoading: false, isError: false }
    await renderGate()

    await waitFor(() => expect(isOnboardingCompleted()).toBe(true))
    expect(getOnboardingCompletion()?.source).toBe('setup-complete')
  })

  it('tells peer tabs exactly once', async () => {
    mockStatus.current = { data: { setup_required: false }, isLoading: false, isError: false }
    const { rerender } = await renderGate()
    await waitFor(() => expect(broadcastSpy).toHaveBeenCalledWith({ type: 'onboarded' }))

    const { OnboardingGate } = await import('../components/OnboardingGate')
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <OnboardingGate />
      </MemoryRouter>,
    )

    expect(broadcastSpy).toHaveBeenCalledTimes(1)
  })

  it('unblocks the changelog gate that reads the same key', async () => {
    mockStatus.current = { data: { setup_required: false }, isLoading: false, isError: false }
    await renderGate()
    await waitFor(() =>
      expect(window.localStorage.getItem('teslasync-onboarded')).not.toBeNull(),
    )

    // This is the exact expression `useChangelog` evaluates.
    expect(localStorage.getItem('teslasync-onboarded') != null).toBe(true)
  })
})
