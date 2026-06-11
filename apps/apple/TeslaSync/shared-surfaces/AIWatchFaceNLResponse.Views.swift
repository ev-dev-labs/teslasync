//
//  AIWatchFaceNLResponse.Views.swift
//  TeslaSync — P4 shared surface · 0060 · AIWatchFaceNLResponse (Apple)
//
//  The presentational subviews composed by `AIWatchFaceNLResponse`: the `AIFeatureCard`
//  scaffold parts (header + Helix badge + description + the universal "Ask Helix" action) and
//  the prompt input (web `inputSlot` `Textarea` with the 1000-char cap + the "Your question
//  for Helix" label). All consume the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web Helix accent on this card is
//  cyan-300 (badge pill, "Ask Helix" affordance) → the brand cyan `Color.TS.accent`.
//

import SwiftUI

// MARK: - Header (web `AIFeatureCard` title + badge + description + hint)

/// The card header: the title, the cyan Helix badge, the one-paragraph description, and the
/// optional contextual hint shown when the action cannot start (web `!canStart`) — telling the
/// user their prompt is over the length cap.
struct WatchFaceNLHeader: View {
    let hint: WatchFaceNLHint?

    private var title: String {
        WatchFaceNLStrings.string("watchFaceNL.title", "Ask Helix about your watch face")
    }

    private var description: String {
        WatchFaceNLStrings.string(
            "watchFaceNL.description",
            """
            Ask Helix a glance-style natural-language question about your vehicle right now — \
            battery, range, charging, locks, climate, recent alerts. Helix only reads a typed \
            snapshot of canonical state values; it never claims to have changed a setting or \
            sent a vehicle command. To lock, unlock, start climate, or send another command \
            use the watch-face tap icons or the phone app.
            """
        )
    }

    private var hintText: String? {
        switch hint {
        case .overCap:
            WatchFaceNLStrings.string(
                "watchFaceNL.hintOverCap",
                "Your question is too long — shorten it to ask Helix."
            )
        case .none:
            nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                WatchFaceNLHelixBadge()
            }
            Text(verbatim: description)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let hintText {
                Text(verbatim: hintText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Helix badge (web `AIBadge` cyan pill)

/// The small cyan "Helix" pill rendered beside the title — the native parity of the web
/// `AIBadge`. The brand mark is the `sparkles` SF Symbol tinted with the cyan accent.
struct WatchFaceNLHelixBadge: View {
    private var label: String {
        WatchFaceNLStrings.string("watchFaceNL.badge", "Helix")
    }

    private var tooltip: String {
        WatchFaceNLStrings.string(
            "helix.tooltip",
            "Helix is your AI assistant. It generates responses using your redacted fleet context."
        )
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "sparkles")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.label)
        }
        .foregroundStyle(Color.TS.accent)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.accent.opacity(0.10), in: Capsule(style: .continuous))
        .overlay(Capsule(style: .continuous).strokeBorder(Color.TS.accent.opacity(0.30), lineWidth: 1))
        .help(tooltip)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: WatchFaceNLStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Prompt field (web `inputSlot` Textarea)

/// The free-form prompt input — the native parity of the web `Textarea`, with the same resting
/// ghost text shown until the user types, the 1000-char cap enforced (web
/// `maxLength={MaxMessageChars}`), and the "Your question for Helix" accessibility label (web
/// `aria-label`). Tokenised chrome (no raw hex); the ghost text is decorative (a11y-hidden)
/// and the field exposes its own VoiceOver label + value so the editor reads correctly. An
/// empty field is valid — leaving it blank asks Helix for a default glance summary.
struct WatchFaceNLMessageField: View {
    @Binding var text: String

    private var promptHint: String {
        WatchFaceNLStrings.string(
            "watchFaceNL.placeholder", // parity:allow verbatim web Textarea field-hint key (UI copy)
            "e.g. how is my battery? Is the car locked? Leave empty for a summary."
        )
    }

    private var fieldLabel: String {
        WatchFaceNLStrings.string("watchFaceNL.inputLabel", "Your question for Helix")
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(verbatim: promptHint)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.sm + 2)
                    .fixedSize(horizontal: false, vertical: true)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            TextEditor(text: $text)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 76)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .onChange(of: text) { _, newValue in
                    // Web `maxLength={MaxMessageChars}` — cap typed input so a 400 can never be
                    // provoked. Truncate by characters (matches the within-cap gate's count).
                    let cap = WatchFaceNLConstants.maxMessageChars
                    if newValue.count > cap {
                        text = String(newValue.prefix(cap))
                    }
                }
        }
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: fieldLabel))
        .accessibilityValue(Text(verbatim: text.isEmpty ? promptHint : text))
    }
}

// MARK: - Action button (web universal "Ask Helix" CTA)

/// The universal Helix action — visible "Ask Helix" when idle and "Helix is thinking…" while
/// streaming (web `AIThinkingDots`), with the per-feature verb ("Ask about my car") folded
/// into the accessibility label ("Ask Helix · Ask about my car"). Disabled (computed, never
/// literal) from the prompt / stream lifecycle / connectivity. Placed on its own trailing row
/// (web `inputSlot` implies `buttonPlacement="below"`).
struct WatchFaceNLActionButton: View {
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        WatchFaceNLStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        WatchFaceNLStrings.string("helix.thinking", "Helix is thinking…")
    }

    private var verb: String {
        WatchFaceNLStrings.string("watchFaceNL.button", "Ask about my car")
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(variant: .secondary, size: .small, action: onTap) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .watchFaceNLSymbolPulse(active: isStreaming && !reduceMotion)
                        .accessibilityHidden(true)
                    Text(verbatim: isStreaming ? thinkingLabel : askLabel)
                        .font(Font.TS.label)
                }
            }
            .disabled(disabled)
            .help(verb)
            .accessibilityLabel(Text(verbatim: "\(askLabel) · \(verb)"))
            .accessibilityHint(Text(verbatim: verb))
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}
