// Helix watch face natural-language response AI-off contract tests.
//
// `TestWatchFaceNLAIOffUsesFixedCardsOnly` is the React-side
// AI-off contract proof. It mounts
// the AIWatchFaceNLResponse panel with `ai_mode='off'` (plus the
// per-feature toggle on, to defeat the trivial path) and asserts:
//
//   1. The opt-in AI section's rooted test ID
//      `ai-feature-watch-face-nl-response-root` is ABSENT from
//      the DOM (ADR-015 §I5 hidden UI).
//   2. The button rendered by AIFeatureCard is also absent —
//      the per-feature verb "Ask about my car" must not surface
//      in any role-button accessible name in off mode.
//   3. The textarea / input slot is absent — defence-in-depth
//      (the whole subtree is unmounted, not just the panel
//      header).
//   4. NO localStorage write (ADR-015 §I12 — the
//      registry entry intentionally has no ClientStorageKey, and
//      no write site should exist in the absent subtree).
//   5. Positive control: with `ai_mode='cloud'` AND the
//      `watch-face-nl-response` toggle on, the section IS
//      present and carries the registered test ID. Without
//      this, the off-mode assertions are trivially true (they
//      would pass even if the section were permanently hidden
//      by a typo in the registry/HOC).
//
// The HTTP POST /api/v1/ai/watch/respond 404-in-off-mode
// invariant is proven by the Go-side
// TestWatchFaceNLAIOffUsesFixedCardsOnly in
// internal/api/ai_watch_face_nl_response_handler_test.go — the
// network layer does not exist in the React unit-test scope.
//
// The "baseline behaviour still works" half of the contract is
// covered by the long-standing WatchFacePage <WatchShell> usage;
// this slice does not alter the chrome-less wearable layout or
// the fixed cards / tap commands. AIWatchFaceNLResponse is
// mounted as a SIBLING of <WatchShell> in WatchFacePage, never
// inside it. We deliberately mount AIWatchFaceNLResponse in
// isolation here rather than the whole WatchFacePage so this
// test does not have to provide a TanStack Query provider, a
// router, and the watch-summary mocks; that surface is already
// proven by the page's own integration suite.
//
// File name MUST stay
// `TestWatchFaceNLAIOffUsesFixedCardsOnly.test.tsx` —
// the verification command runs
// `vitest --run TestWatchFaceNLAIOffUsesFixedCardsOnly`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIWatchFaceNLResponse } from '@/components/ai/AIWatchFaceNLResponse'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// baseSettings is a complete-enough AppSettings for
// AIWatchFaceNLResponse's gate. Only ai_mode + ai_features
// actually matter for this test.
const baseSettings: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'hourly',
  critical_flash_enabled: true,
  tab_badge_enabled: true,
}

function settingsPayload(overrides: Partial<AppSettings>) {
  return { settings: { ...baseSettings, ...overrides } }
}

beforeEach(() => {
  mockUseSettings.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('TestWatchFaceNLAIOffUsesFixedCardsOnly (watch-face-nl-response AI-off contract)', () => {
  it('TestWatchFaceNLAIOffUsesFixedCardsOnly: renders nothing when ai_mode=off (toggle on to defeat the trivial path)', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'watch-face-nl-response': true },
      }),
    )

    // Spy on localStorage.setItem so we can prove the panel
    // never writes any client storage key in off mode. The
    // registry entry intentionally has no
    // ClientStorageKey, so any write that happens to land in the
    // ai.watch.* namespace from inside the wrapped subtree would
    // violate ADR-015 §I12.
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')

    render(<AIWatchFaceNLResponse />)

    // 1) The opt-in AI section is ABSENT — the wrapping
    // withAiFeature HOC returns null in off mode (ADR-015 §I5).
    expect(
      screen.queryByTestId('ai-feature-watch-face-nl-response-root'),
    ).not.toBeInTheDocument()

    // 2) The per-feature CTA does not surface either. The
    // accessible name composed by AIFeatureCard would be
    // "Ask Helix · Ask about my car" if the section were
    // mounted; we use an unanchored regex per the HX addendum.
    expect(
      screen.queryByRole('button', { name: /Ask about my car/i }),
    ).not.toBeInTheDocument()

    // 3) The textarea / input slot is absent too — the whole
    // subtree is gone, not just the panel header.
    expect(
      screen.queryByLabelText(/Your question for Helix/i),
    ).not.toBeInTheDocument()

    // 4) The registry entry has no ClientStorageKey, so
    // no `ai.watch.*` write should ever happen — and in off mode
    // no write of any kind from the AI subtree should happen.
    const aiWatchWrites = setItemSpy.mock.calls.filter(([key]) =>
      String(key).startsWith('ai.watch'),
    )
    expect(aiWatchWrites).toHaveLength(0)
  })

  it('TestWatchFaceNLAIOffUsesFixedCardsOnly: renders nothing when ai_mode is non-off but the watch-face-nl-response toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'watch-face-nl-response': false },
      }),
    )

    render(<AIWatchFaceNLResponse />)

    expect(
      screen.queryByTestId('ai-feature-watch-face-nl-response-root'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Ask about my car/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText(/Your question for Helix/i),
    ).not.toBeInTheDocument()
  })

  it('TestWatchFaceNLAIOffUsesFixedCardsOnly: renders the AI section when ai_mode=cloud AND watch-face-nl-response toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'watch-face-nl-response': true },
      }),
    )

    render(<AIWatchFaceNLResponse />)

    // The AI section is mounted with the registered root testID.
    const root = screen.getByTestId('ai-feature-watch-face-nl-response-root')
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'watch-face-nl-response')

    // The per-feature CTA is present, locatable via UNANCHORED
    // role-name regex per the HX addendum (the accessible name
    // is "Ask Helix · Ask about my car").
    expect(
      screen.getByRole('button', { name: /Ask about my car/i }),
    ).toBeInTheDocument()

    // The textarea is mounted with its aria-label — the panel
    // is fully composed in on-mode, not just a header skeleton.
    expect(
      screen.getByLabelText(/Your question for Helix/i),
    ).toBeInTheDocument()
  })
})
