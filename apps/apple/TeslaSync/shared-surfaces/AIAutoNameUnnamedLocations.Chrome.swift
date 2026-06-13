//
//  AIAutoNameUnnamedLocations.Chrome.swift
//  TeslaSync — P4 shared surface · 0006 · AIAutoNameUnnamedLocations (Apple)
//
//  The streamed-output + gate-chrome subviews split out of `…Views.swift` (one file ≤
//  400 lines per the SwiftLint contract): the web `AiOutputPanel` (thinking indicator /
//  Helix error / accumulated text) and the P4 leaf gate loading / error chrome. All
//  consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no raw hex.
//

import SwiftUI

// MARK: - Output panel (web `AiOutputPanel`)

/// The streamed-output panel — the native port of the web `AiOutputPanel`: the Helix
/// error message for an `error` stream, the animated thinking indicator while the SSE is
/// open and no text has arrived, and the accumulated narrative otherwise. Collapses to
/// nothing when there is nothing to show (web `hasAnything` false, plus the done-with-no-
/// text case where the proposal box above is the real output — avoids a blank panel).
struct AINameDraftOutputPanel: View {
    let phase: AIStreamPhase
    let text: String

    var body: some View {
        if case let .error(message) = phase {
            panel { AINameDraftErrorRow(message: message) }
        } else if AINameDraftLogic.thinkingVisible(phase: phase, hasText: !text.isEmpty) {
            panel { AINameDraftThinkingIndicator() }
        } else if !text.isEmpty {
            panel {
                Text(verbatim: text)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func panel(@ViewBuilder _ content: @escaping () -> some View) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

/// The web `AiOutputPanel` error branch: the Helix mark + "Helix error:" + the message.
struct AINameDraftErrorRow: View {
    let message: String

    private var errorLabel: String {
        AIAutoNameStrings.string("helix.errorLabel", "Helix error:")
    }

    private var resolvedMessage: String {
        message.isEmpty ? AIAutoNameStrings.string("ai.common.errorUnknown", "unknown") : message
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            (
                Text(verbatim: "\(errorLabel) ").fontWeight(.medium)
                    + Text(verbatim: resolvedMessage)
            )
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.statusDanger)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(errorLabel) \(resolvedMessage)"))
    }
}

/// The web `AIThinkingIndicator`: shimmering skeleton lines + a bouncing-dot label,
/// shown while the stream is open and no text has arrived. Honours reduce-motion (the
/// skeleton shimmer + dot animation are decorative).
struct AINameDraftThinkingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var thinkingLabel: String {
        AIAutoNameStrings.string("helix.thinking", "Helix is thinking…")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .aiAutoNameSymbolPulse(active: !reduceMotion)
                    .accessibilityHidden(true)
                Text(verbatim: thinkingLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            TSSkeleton(height: 10)
            TSSkeleton(width: 220, height: 10)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: thinkingLabel))
    }
}

// MARK: - Gate chrome (P4 leaf loading / error)

/// The gate-resolving chrome (web `useAiEnabled` loading): skeleton header + a skeleton
/// action row, so the card keeps its shape while the AI-Off gate resolves.
struct AINameDraftGateLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 220, height: 14)
            TSSkeleton(height: 10)
            TSSkeleton(width: 240, height: 10)
            HStack {
                Spacer(minLength: 0)
                TSSkeleton(width: 132, height: 28, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AIAutoNameStrings.string(
            "locations.aiAutoName.loadingA11y", "Loading Helix naming"
        )))
    }
}

/// The gate / context fetch-failure state (web `QueryError` peer) with a retry
/// affordance — distinct from a stream `error`, which surfaces inside the output panel.
struct AINameDraftGateErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: AIAutoNameStrings.string(
                "locations.aiAutoName.errorTitle", "Couldn't load Helix naming"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: AIAutoNameStrings.string("locations.aiAutoName.retry", "Retry"))
                    .font(Font.TS.label)
            }
            .accessibilityLabel(Text(verbatim: AIAutoNameStrings.string("locations.aiAutoName.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Symbol pulse helper (reduce-motion safe)

extension View {
    /// Applies a repeating symbol pulse when `active`, and is otherwise inert — a single
    /// reduce-motion gate shared by the action button (Views) and the thinking indicator.
    @ViewBuilder
    func aiAutoNameSymbolPulse(active: Bool) -> some View {
        if active {
            symbolEffect(.pulse, options: .repeating)
        } else {
            self
        }
    }
}
