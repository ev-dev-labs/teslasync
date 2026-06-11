//
//  AIVoiceMode.Controls.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  The voice input slot reproduced natively from the web `AIVoiceMode` `inputSlot`: the live
//  transcript region (web `aria-live="polite"` box), the mic toggle (Speak ⇆ Stop mic), the spoken-
//  reply toggle (Mute ⇆ Unmute Helix), the in-flight Stop control, the dictation-error line, and the
//  unsupported hint. Every control carries its VoiceOver label from the resolved model; all styling
//  comes from the shared P1/S9 tokens — no raw HTML buttons, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Transcript box (web aria-live transcript region)

/// The live transcript region — the native peer of the web `aria-live="polite"` box: it shows the
/// dictated text, or a muted hint ("Listening — speak now…" / the idle invite) when empty. Marked
/// `updatesFrequently` so VoiceOver re-reads it as dictation streams in.
struct VoiceModeTranscriptBox: View {
    let transcript: VoiceModeTranscriptView

    var body: some View {
        Text(verbatim: transcript.display)
            .font(Font.TS.bodySm)
            .foregroundStyle(transcript.isHint ? Color.TS.textMuted : Color.TS.textSecondary)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .topLeading)
            .padding(TSSpacing.md)
            .background(
                Color.TS.accent.opacity(0.05),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: transcript.accessibilityLabel))
            .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Mic toggle (web Mic / MicOff)

/// The dictation toggle — web flips between "Speak" (mic) and "Stop mic" (mic-off). The start form
/// is disabled when dictation is unsupported or Helix is busy.
struct VoiceModeMicButton: View {
    let mic: VoiceModeMicControl
    let onTap: () -> Void

    var body: some View {
        TSButton(variant: .secondary, size: .small, action: onTap) {
            HStack(spacing: 6) {
                Image(systemName: mic.isListening ? "mic.slash.fill" : "mic.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: mic.title)
            }
        }
        .disabled(mic.isDisabled)
        .opacity(mic.isDisabled ? 0.55 : 1)
        .accessibilityLabel(Text(verbatim: mic.accessibilityLabel))
        .accessibilityAddTraits(mic.isDisabled ? [] : .isButton)
    }
}

// MARK: - Spoken-reply toggle (web Volume2 / VolumeX)

/// The spoken-reply toggle — web "Mute Helix" / "Unmute Helix" with `aria-pressed`. The selected
/// trait mirrors `aria-pressed` so VoiceOver announces the muted / unmuted state.
struct VoiceModeTtsButton: View {
    let tts: VoiceModeTtsControl
    let onTap: () -> Void

    var body: some View {
        TSButton(variant: .ghost, size: .small, action: onTap) {
            HStack(spacing: 6) {
                Image(systemName: tts.isEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: tts.title)
            }
        }
        .accessibilityLabel(Text(verbatim: tts.accessibilityLabel))
        .accessibilityAddTraits(tts.isEnabled ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Stop control (web Square)

/// The in-flight Stop control — shown only while Helix is busy (web `isBusy && <Stop>`); stops
/// dictation, the stream, and playback at once.
struct VoiceModeStopButton: View {
    let stop: VoiceModeStopControl
    let onTap: () -> Void

    var body: some View {
        TSButton(variant: .ghost, size: .small, action: onTap) {
            HStack(spacing: 6) {
                Image(systemName: "stop.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: stop.title)
            }
        }
        .accessibilityLabel(Text(verbatim: stop.accessibilityLabel))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Controls row

/// The mic / spoken-reply / stop control row (web `flex flex-wrap items-center gap-2`).
struct VoiceModeControlsRow: View {
    let ready: VoiceModeReady
    let onToggleMic: () -> Void
    let onToggleTts: () -> Void
    let onStopAll: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            VoiceModeMicButton(mic: ready.mic, onTap: onToggleMic)
            VoiceModeTtsButton(tts: ready.tts, onTap: onToggleTts)
            if let stop = ready.stop {
                VoiceModeStopButton(stop: stop, onTap: onStopAll)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Input slot (web `inputSlot`)

/// The full voice input slot — the transcript box, the control row, the dictation-error line (web
/// `sttError`), and the unsupported hint (web `!sttSupported && !sttError`).
struct VoiceModeInputSlot: View {
    let ready: VoiceModeReady
    let onToggleMic: () -> Void
    let onToggleTts: () -> Void
    let onStopAll: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            VoiceModeTranscriptBox(transcript: ready.transcript)
            VoiceModeControlsRow(
                ready: ready,
                onToggleMic: onToggleMic,
                onToggleTts: onToggleTts,
                onStopAll: onStopAll
            )
            if let sttError = ready.sttError {
                Text(verbatim: sttError)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityLabel(Text(verbatim: sttError))
                    .accessibilityAddTraits(.updatesFrequently)
            }
            if let unsupportedHint = ready.unsupportedHint {
                Text(verbatim: unsupportedHint)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
