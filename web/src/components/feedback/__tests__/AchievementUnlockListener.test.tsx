import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AchievementUnlockedEvent } from '@/api/hooks/useAchievementUnlocks'

/**
 * AchievementUnlockListener contract.
 *
 * The listener is a headless glue component: it drains the realtime
 * `achievement_unlocked` queue via {@link useAchievementUnlocks}, reads the
 * localStorage-backed celebration prefs via
 * {@link useAchievementCelebrationPrefs}, optionally fires a procedural WebAudio
 * chime, and — unless the user opted out — renders the celebration stack.
 *
 * All three collaborators plus the WebAudio API are mocked so the test focuses
 * on the listener's branching: visibility gating, dismiss wiring, and the
 * "chime only on a genuinely NEW unlock" logic (the sound must NOT replay when
 * the queue shrinks on dismiss).
 */

let mockRecent: AchievementUnlockedEvent[] = []
let mockPrefs = {
  showToasts: true,
  playSound: false,
  showOnDashboard: true,
  pushOnUnlock: true,
}
const mockDismiss = vi.fn()
const mockUseUnlocks = vi.fn(() => ({ recent: mockRecent, dismiss: mockDismiss }))

vi.mock('@/api/hooks/useAchievementUnlocks', () => ({
  useAchievementUnlocks: () => mockUseUnlocks(),
}))

vi.mock('@/hooks/useAchievementCelebrationPrefs', () => ({
  useAchievementCelebrationPrefs: () => mockPrefs,
}))

// Lightweight stand-in for the celebration stack: renders one dismiss button
// per event so we can assert both that the events reach the stack and that
// dismissal is wired straight through to the hook's dismiss(id).
vi.mock('../AchievementUnlockedToast', () => ({
  AchievementUnlockedToastStack: (props: {
    events: Array<{ achievement: { id: string; name: string } }>
    onDismiss: (id: string) => void
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'toast-stack' },
      props.events.map((e) =>
        React.createElement(
          'button',
          {
            key: e.achievement.id,
            'data-testid': `dismiss-${e.achievement.id}`,
            onClick: () => props.onDismiss(e.achievement.id),
          },
          e.achievement.name,
        ),
      ),
    ),
}))

import { AchievementUnlockListener } from '../AchievementUnlockListener'

function makeEvent(id: string, name = `Achievement ${id}`): AchievementUnlockedEvent {
  return {
    vehicle_id: 1,
    unlocked_at: '2025-01-01T00:00:00Z',
    achievement: {
      id,
      name,
      description: `${name} description`,
      icon: '🏆',
      unlocked: true,
      unlocked_at: '2025-01-01T00:00:00Z',
      progress: 100,
      target: 1,
      current: 1,
    },
  }
}

/**
 * Install a fully-spied fake WebAudio `AudioContext` on the global scope.
 * `start`/`stop` are shared across every oscillator so a call count reflects
 * the total number of scheduled notes.
 */
function installAudioContext(state: AudioContextState = 'running') {
  const oscStart = vi.fn()
  const oscStop = vi.fn()
  const createOscillator = vi.fn(() => ({
    type: '',
    frequency: { value: 0 },
    connect: vi.fn(),
    start: oscStart,
    stop: oscStop,
  }))
  const createGain = vi.fn(() => ({
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  }))
  const resume = vi.fn(() => Promise.resolve())
  const close = vi.fn(() => Promise.resolve())
  // A real `function` (not an arrow) so the source's `new Ctor()` produces an
  // instance carrying these methods — vitest cannot construct an arrow mock.
  const ctor = vi.fn(function (this: Record<string, unknown>) {
    this.currentTime = 0
    this.state = state
    this.destination = {}
    this.createOscillator = createOscillator
    this.createGain = createGain
    this.resume = resume
    this.close = close
  })
  vi.stubGlobal('AudioContext', ctor)
  return { ctor, createOscillator, createGain, oscStart, oscStop, resume, close }
}

describe('AchievementUnlockListener', () => {
  beforeEach(() => {
    mockRecent = []
    mockPrefs = { showToasts: true, playSound: false, showOnDashboard: true, pushOnUnlock: true }
    mockDismiss.mockClear()
    mockUseUnlocks.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the celebration stack with every queued unlock when showToasts is on', () => {
    mockPrefs.showToasts = true
    mockRecent = [makeEvent('a1', 'First Drive'), makeEvent('a2', 'Night Owl')]

    render(<AchievementUnlockListener />)

    expect(screen.getByTestId('toast-stack')).toBeInTheDocument()
    expect(screen.getByText('First Drive')).toBeInTheDocument()
    expect(screen.getByText('Night Owl')).toBeInTheDocument()
  })

  it('renders nothing visible when showToasts is off but keeps draining the queue', () => {
    mockPrefs.showToasts = false
    mockRecent = [makeEvent('a1')]

    const { container } = render(<AchievementUnlockListener />)

    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('toast-stack')).not.toBeInTheDocument()
    // The subscription hook is still invoked so the SSE queue keeps draining.
    expect(mockUseUnlocks).toHaveBeenCalled()
  })

  it('wires the stack dismiss straight through to the hook dismiss', () => {
    mockPrefs.showToasts = true
    mockRecent = [makeEvent('a1', 'First Drive')]

    render(<AchievementUnlockListener />)
    fireEvent.click(screen.getByTestId('dismiss-a1'))

    expect(mockDismiss).toHaveBeenCalledTimes(1)
    expect(mockDismiss).toHaveBeenCalledWith('a1')
  })

  it('does not construct an AudioContext when playSound is disabled', () => {
    mockPrefs.playSound = false
    mockRecent = [makeEvent('a1')]
    const audio = installAudioContext()

    render(<AchievementUnlockListener />)

    expect(audio.ctor).not.toHaveBeenCalled()
    expect(audio.createOscillator).not.toHaveBeenCalled()
  })

  it('plays a two-note chime when playSound is on and a new unlock arrives', () => {
    mockPrefs.playSound = true
    mockRecent = [makeEvent('a1')]
    const audio = installAudioContext('running')

    render(<AchievementUnlockListener />)

    expect(audio.ctor).toHaveBeenCalledTimes(1)
    expect(audio.createOscillator).toHaveBeenCalledTimes(2)
    expect(audio.createGain).toHaveBeenCalledTimes(2)
    expect(audio.oscStart).toHaveBeenCalledTimes(2)
    expect(audio.oscStop).toHaveBeenCalledTimes(2)
    // A running context is not needlessly resumed.
    expect(audio.resume).not.toHaveBeenCalled()
  })

  it('does not replay the chime when the queue shrinks, only when it grows', () => {
    mockPrefs.playSound = true
    mockRecent = [makeEvent('a1'), makeEvent('a2')]
    const audio = installAudioContext()

    const { rerender } = render(<AchievementUnlockListener />)
    // One chime (two notes) for the initial batch of new unlocks.
    expect(audio.createOscillator).toHaveBeenCalledTimes(2)

    // Dismissing a1 shrinks the queue — this must NOT re-trigger the chime.
    audio.createOscillator.mockClear()
    mockRecent = [makeEvent('a2')]
    rerender(<AchievementUnlockListener />)
    expect(audio.createOscillator).not.toHaveBeenCalled()

    // A genuinely new unlock (a3) arrives — the chime fires again.
    mockRecent = [makeEvent('a3'), makeEvent('a2')]
    rerender(<AchievementUnlockListener />)
    expect(audio.createOscillator).toHaveBeenCalledTimes(2)
    // The context is created once and reused, never re-allocated.
    expect(audio.ctor).toHaveBeenCalledTimes(1)
  })

  it('resumes a suspended AudioContext before scheduling the chime', () => {
    mockPrefs.playSound = true
    mockRecent = [makeEvent('a1')]
    const audio = installAudioContext('suspended')

    render(<AchievementUnlockListener />)

    expect(audio.resume).toHaveBeenCalledTimes(1)
    expect(audio.createOscillator).toHaveBeenCalledTimes(2)
  })

  it('renders the stack without throwing when WebAudio is unavailable', () => {
    mockPrefs.playSound = true
    mockPrefs.showToasts = true
    mockRecent = [makeEvent('a1', 'First Drive')]
    // No AudioContext stubbed — jsdom has no WebAudio by default.

    expect(() => render(<AchievementUnlockListener />)).not.toThrow()
    expect(screen.getByText('First Drive')).toBeInTheDocument()
  })

  it('closes the AudioContext on unmount to release the audio device', () => {
    mockPrefs.playSound = true
    mockRecent = [makeEvent('a1')]
    const audio = installAudioContext()

    const { unmount } = render(<AchievementUnlockListener />)
    expect(audio.ctor).toHaveBeenCalledTimes(1)

    unmount()
    expect(audio.close).toHaveBeenCalledTimes(1)
  })
})
