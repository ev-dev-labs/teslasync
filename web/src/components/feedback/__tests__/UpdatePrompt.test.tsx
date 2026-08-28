import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { UpdatePrompt } from '../UpdatePrompt'
import type { PwaUpdateState } from '@/hooks/usePwaUpdate'

/**
 * Update banner (PWA-03).
 *
 * The component is intentionally presentational — the host owns
 * `usePwaUpdate()` — so these tests drive it purely through props and assert
 * the two user-visible policies: release context is always shown, and a
 * REQUIRED update offers no way to dismiss it.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}))

function makeState(patch: Partial<PwaUpdateState> = {}): PwaUpdateState {
  return {
    updateReady: true,
    showPrompt: true,
    updateRequired: false,
    handshake: {
      verdict: 'compatible',
      updateRequired: false,
      clientVersion: '2.0.0',
      serverVersion: '2.0.0',
      buildId: '2.0.0+abc1234',
      apiContractVersion: 1,
    },
    release: {
      runningBuildId: '2.0.0+abc1234',
      runningAppVersion: '2.0.0',
      runningGitSha: 'abc1234',
      bootServerVersion: '2.0.0',
      latestServerVersion: '2.1.0',
      serverRedeployed: true,
    },
    applying: false,
    blockedByUnsavedWork: false,
    snoozedUntil: null,
    applyUpdate: vi.fn(async () => {}),
    deferUpdate: vi.fn(),
    checkForUpdate: vi.fn(async () => {}),
    ...patch,
  }
}

describe('UpdatePrompt', () => {
  it('renders nothing when there is no update to show', () => {
    const { container } = render(
      <UpdatePrompt state={makeState({ showPrompt: false })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('announces an available update to assistive technology', () => {
    render(<UpdatePrompt state={makeState()} />)
    const banner = screen.getByTestId('update-prompt')
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('New version available')).toBeInTheDocument()
  })

  describe('live-region urgency (a11y)', () => {
    // `role="alert"` carries an implicit `aria-live="assertive"`. Pairing it
    // with `aria-live="polite"` — as this banner originally did — is
    // self-contradictory: browsers resolve the conflict inconsistently and
    // screen readers may drop the announcement entirely.
    it('uses a polite STATUS region for an optional update', () => {
      render(<UpdatePrompt state={makeState({ updateRequired: false })} />)
      const banner = screen.getByTestId('update-prompt')

      expect(banner).toHaveAttribute('role', 'status')
      expect(banner).toHaveAttribute('aria-live', 'polite')
      expect(banner).not.toHaveAttribute('role', 'alert')
      // An optional update must never cut across what the user is reading.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toBe(banner)
    })

    it('uses an assertive ALERT region for a required update', () => {
      render(<UpdatePrompt state={makeState({ updateRequired: true })} />)
      const banner = screen.getByTestId('update-prompt')

      expect(banner).toHaveAttribute('role', 'alert')
      expect(banner).toHaveAttribute('aria-live', 'assertive')
      expect(screen.getByRole('alert')).toBe(banner)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('never emits a role/politeness pair that contradicts itself', () => {
      for (const required of [false, true]) {
        const view = render(<UpdatePrompt state={makeState({ updateRequired: required })} />)
        const banner = view.getByTestId('update-prompt')
        const role = banner.getAttribute('role')
        const live = banner.getAttribute('aria-live')

        expect(role === 'alert' ? live === 'assertive' : live === 'polite').toBe(true)
        view.unmount()
      }
    })

    it('exposes exactly one live region, so the update is announced once', () => {
      render(<UpdatePrompt state={makeState()} />)
      expect(screen.queryAllByRole('status')).toHaveLength(1)
      expect(screen.queryAllByRole('alert')).toHaveLength(0)
    })
  })

  it('shows the release context so the user knows what is changing', () => {
    render(<UpdatePrompt state={makeState()} />)
    expect(screen.getByTestId('update-prompt-running-build')).toHaveTextContent(
      '2.0.0+abc1234',
    )
    expect(screen.getByTestId('update-prompt-server-version')).toHaveTextContent('2.1.0')
  })

  it('omits the server row when the backend version is unknown', () => {
    const state = makeState()
    state.release.latestServerVersion = null
    render(<UpdatePrompt state={state} />)
    expect(screen.queryByTestId('update-prompt-server-version')).not.toBeInTheDocument()
  })

  it('applies the update on demand — never automatically', () => {
    const state = makeState()
    render(<UpdatePrompt state={state} />)
    expect(state.applyUpdate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('update-prompt-reload'))
    expect(state.applyUpdate).toHaveBeenCalledTimes(1)
  })

  it('offers a Later control for an optional update', () => {
    const state = makeState()
    render(<UpdatePrompt state={state} />)

    fireEvent.click(screen.getByTestId('update-prompt-later'))
    expect(state.deferUpdate).toHaveBeenCalledTimes(1)
  })

  it('removes the Later control for a REQUIRED update', () => {
    render(<UpdatePrompt state={makeState({ updateRequired: true })} />)

    expect(screen.getByTestId('update-prompt')).toHaveAttribute(
      'data-update-required',
      'true',
    )
    expect(screen.queryByTestId('update-prompt-later')).not.toBeInTheDocument()
    expect(screen.getByText('Update required')).toBeInTheDocument()
    expect(screen.getByTestId('update-prompt-reload')).toBeInTheDocument()
  })

  it('explains a reload that was cancelled by unsaved work', () => {
    render(<UpdatePrompt state={makeState({ blockedByUnsavedWork: true })} />)
    expect(screen.getByTestId('update-prompt-unsaved')).toHaveTextContent(
      /unsaved changes/i,
    )
  })

  it('disables the reload button while the reload is in flight', () => {
    render(<UpdatePrompt state={makeState({ applying: true })} />)
    expect(screen.getByTestId('update-prompt-reload')).toBeDisabled()
    expect(screen.getByText('Reloading…')).toBeInTheDocument()
  })
})
