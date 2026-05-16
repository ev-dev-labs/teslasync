// Phase-50 / 0055 — V1 Helix voice mode.
//
// `TestVoiceModeAIOffNoVoiceControlsOrStorage` is the slice's
// load-bearing AI-OFF contract proof on the React side. It mounts
// the AIVoiceMode panel with `ai_mode='off'` (plus the per-feature
// toggle on, to defeat the trivial path) and asserts:
//
//   1. The opt-in AI section's rooted test ID
//      `ai-feature-voice-mode-root` is ABSENT from the DOM
//      (ADR-015 §I5 hidden UI).
//   2. The button rendered by AIFeatureCard is also absent —
//      the per-feature verb "Speak to Helix" must not surface
//      in any role-button accessible name in off mode.
//   3. NO microphone control is mounted (defence in depth — the
//      whole subtree is unmounted, not just the panel header).
//   4. The localStorage key `ai.voiceMode.transcriptDraft` is
//      NEVER written when the section is absent (ADR-015 §I12
//      — no client storage artifacts in off mode).
//   5. Positive control: with `ai_mode='cloud'` AND the
//      `voice-mode` toggle on, the section IS present and
//      carries the registered test ID. Without this, the
//      off-mode assertions are trivially true (they would pass
//      even if the section were permanently hidden by a typo
//      in the registry/HOC).
//
// The HTTP POST /api/v1/ai/voice/chat 404-in-off-mode invariant
// is proven by the Go-side TestVoiceModeAIOffNoVoiceControlsOrStorage
// in internal/api/ai_voice_mode_handler_test.go — the network
// layer does not exist in the React unit-test scope.
//
// The "baseline behaviour still works" half of the contract is
// covered by the long-standing chatbot page tests; this slice
// does not alter the typed chatbot's input/send/transcript paths
// (AIVoiceMode is mounted ABOVE the conversation grid, never
// inside it). We deliberately mount AIVoiceMode in isolation
// here rather than the whole ChatbotPage so this test does not
// have to provide a TanStack Query provider, a router, and the
// chat-history mocks; that surface is already proven by other
// suites.
//
// File name MUST stay
// `TestVoiceModeAIOffNoVoiceControlsOrStorage.test.tsx` —
// the slice prompt's verification command runs
// `vitest --run TestVoiceModeAIOffNoVoiceControlsOrStorage`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIVoiceMode } from '@/components/ai/AIVoiceMode'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// baseSettings is a complete-enough AppSettings for AIVoiceMode's
// gate. Only ai_mode + ai_features actually matter for this test.
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

const TRANSCRIPT_DRAFT_KEY = 'ai.voiceMode.transcriptDraft'

beforeEach(() => {
  mockUseSettings.mockReset()
  window.localStorage.removeItem(TRANSCRIPT_DRAFT_KEY)
})

afterEach(() => {
  cleanup()
  window.localStorage.removeItem(TRANSCRIPT_DRAFT_KEY)
})

describe('TestVoiceModeAIOffNoVoiceControlsOrStorage (voice-mode AI-off contract)', () => {
  it('TestVoiceModeAIOffNoVoiceControlsOrStorage: renders nothing and writes no transcript draft when ai_mode=off (toggle on to defeat the trivial path)', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'voice-mode': true },
      }),
    )

    // Spy on localStorage.setItem so we can prove the panel
    // never writes the transcript-draft key in off mode. The
    // production code only writes from within the wrapped
    // subtree, so a "never called with our key" assertion is
    // a direct proof of ADR-015 §I12 (no client storage
    // artifacts in off mode).
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')

    render(<AIVoiceMode />)

    // 1) The opt-in AI section is ABSENT — the wrapping
    // withAiFeature HOC returns null in off mode (ADR-015 §I5).
    expect(
      screen.queryByTestId('ai-feature-voice-mode-root'),
    ).not.toBeInTheDocument()

    // 2) The per-feature CTA does not surface either. The
    // accessible name composed by AIFeatureCard would be
    // "Ask Helix · Speak to Helix" if the section were mounted;
    // we use an unanchored regex per the HX addendum.
    expect(
      screen.queryByRole('button', { name: /Speak to Helix/i }),
    ).not.toBeInTheDocument()

    // 3) No mic / TTS / stop buttons are mounted either — the
    // whole subtree is gone, not just the panel header.
    expect(
      screen.queryByTestId('ai-feature-voice-mode-mic-start'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('ai-feature-voice-mode-mic-stop'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('ai-feature-voice-mode-tts-toggle'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('ai-feature-voice-mode-transcript'),
    ).not.toBeInTheDocument()

    // 4) The transcript-draft localStorage key is NEVER written
    // in off mode. Production code only writes from within the
    // wrapped (hidden in off mode) subtree, so this is a direct
    // proof of ADR-015 §I12.
    const draftWrites = setItemSpy.mock.calls.filter(
      ([key]) => key === TRANSCRIPT_DRAFT_KEY,
    )
    expect(draftWrites).toHaveLength(0)
    expect(window.localStorage.getItem(TRANSCRIPT_DRAFT_KEY)).toBeNull()
  })

  it('TestVoiceModeAIOffNoVoiceControlsOrStorage: renders nothing and writes no transcript draft when ai_mode is non-off but the voice-mode toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'voice-mode': false },
      }),
    )

    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')

    render(<AIVoiceMode />)

    expect(
      screen.queryByTestId('ai-feature-voice-mode-root'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Speak to Helix/i }),
    ).not.toBeInTheDocument()

    const draftWrites = setItemSpy.mock.calls.filter(
      ([key]) => key === TRANSCRIPT_DRAFT_KEY,
    )
    expect(draftWrites).toHaveLength(0)
    expect(window.localStorage.getItem(TRANSCRIPT_DRAFT_KEY)).toBeNull()
  })

  it('TestVoiceModeAIOffNoVoiceControlsOrStorage: renders the AI section when ai_mode=cloud AND voice-mode toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'voice-mode': true },
      }),
    )

    render(<AIVoiceMode />)

    // The AI section is mounted with the registered root testID.
    const root = screen.getByTestId('ai-feature-voice-mode-root')
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'voice-mode')

    // The per-feature CTA is present, locatable via UNANCHORED
    // role-name regex per the HX addendum (the accessible name
    // is "Ask Helix · Speak to Helix").
    expect(
      screen.getByRole('button', { name: /Speak to Helix/i }),
    ).toBeInTheDocument()

    // The mic and TTS controls render too — the panel is fully
    // composed in on-mode, not just a header skeleton.
    expect(
      screen.getByTestId('ai-feature-voice-mode-tts-toggle'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('ai-feature-voice-mode-transcript'),
    ).toBeInTheDocument()
  })
})
