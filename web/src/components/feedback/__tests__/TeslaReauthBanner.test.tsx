import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import '@/i18n'

/**
 * Phase-45 / Prompt 30 — TeslaReauthBanner contract.
 *
 * The banner reacts to two document-level CustomEvents:
 *   • teslasync:tesla-auth-expired   — surfaced by resilientFetch when
 *     a Tesla-backed call returns 401 with code TESLA_TOKEN_EXPIRED.
 *   • teslasync:tesla-auth-recovered — emitted by TeslaAccountSection
 *     after the user reconnects.
 *
 * The recovery event also drains the queued mutation replay closures
 * (queueTeslaMutation → drainQueuedTeslaMutations).
 */

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

import { TeslaReauthBanner } from '../TeslaReauthBanner'
import {
  queueTeslaMutation,
  _resetTeslaAuthRecoveryQueue,
  _peekTeslaAuthRecoveryQueueSize,
} from '@/lib/teslaAuthRecovery'

function renderBanner() {
  return render(
    <MemoryRouter>
      <TeslaReauthBanner />
    </MemoryRouter>,
  )
}

function fireExpired() {
  act(() => {
    document.dispatchEvent(new CustomEvent('teslasync:tesla-auth-expired'))
  })
}

function fireRecovered() {
  act(() => {
    document.dispatchEvent(new CustomEvent('teslasync:tesla-auth-recovered'))
  })
}

describe('TeslaReauthBanner', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    _resetTeslaAuthRecoveryQueue()
  })

  afterEach(() => {
    _resetTeslaAuthRecoveryQueue()
  })

  it('renders nothing by default', () => {
    const { container } = renderBanner()
    expect(container.firstChild).toBeNull()
  })

  it('appears when teslasync:tesla-auth-expired is dispatched', () => {
    renderBanner()
    expect(screen.queryByTestId('tesla-reauth-banner')).not.toBeInTheDocument()

    fireExpired()

    const banner = screen.getByTestId('tesla-reauth-banner')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveAttribute('aria-live', 'assertive')
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument()
  })

  it('navigates to /tesla-account when the Reconnect button is clicked', () => {
    renderBanner()
    fireExpired()

    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }))

    expect(navigateMock).toHaveBeenCalledWith('/tesla-account')
  })

  it('hides on dismiss without dispatching the recovered event', () => {
    const recoveredSpy = vi.fn()
    document.addEventListener('teslasync:tesla-auth-recovered', recoveredSpy)
    renderBanner()
    fireExpired()
    expect(screen.getByTestId('tesla-reauth-banner')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(screen.queryByTestId('tesla-reauth-banner')).not.toBeInTheDocument()
    expect(recoveredSpy).not.toHaveBeenCalled()
    document.removeEventListener('teslasync:tesla-auth-recovered', recoveredSpy)
  })

  it('hides on teslasync:tesla-auth-recovered AND drains queued mutations', async () => {
    const replay = vi.fn(async () => {})
    queueTeslaMutation(replay)
    expect(_peekTeslaAuthRecoveryQueueSize()).toBe(1)

    renderBanner()
    fireExpired()
    expect(screen.getByTestId('tesla-reauth-banner')).toBeInTheDocument()

    fireRecovered()
    expect(screen.queryByTestId('tesla-reauth-banner')).not.toBeInTheDocument()

    // drainQueuedTeslaMutations is awaited inside an effect — flush microtasks.
    await Promise.resolve()
    await Promise.resolve()

    expect(replay).toHaveBeenCalledTimes(1)
    expect(_peekTeslaAuthRecoveryQueueSize()).toBe(0)
  })

  it('reappears if a new expiry event fires after dismissal', () => {
    renderBanner()
    fireExpired()
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByTestId('tesla-reauth-banner')).not.toBeInTheDocument()

    fireExpired()
    expect(screen.getByTestId('tesla-reauth-banner')).toBeInTheDocument()
  })

  it('cleans up event listeners on unmount', () => {
    const { unmount } = renderBanner()
    unmount()

    fireExpired()
    expect(screen.queryByTestId('tesla-reauth-banner')).not.toBeInTheDocument()
  })
})
