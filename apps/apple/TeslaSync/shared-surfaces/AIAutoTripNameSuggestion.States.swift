//
//  AIAutoTripNameSuggestion.States.swift
//  TeslaSync — P4 shared surface · 0007 · AIAutoTripNameSuggestion (Apple)
//
//  The streaming output panel (web `AiOutputPanel`) and the per-phase bodies composed inside the
//  feature card: the loading skeleton, the friendly idle output, the Helix thinking indicator (web
//  `AIThinkingIndicator`), the streamed propose-only suggestion, and the error tile (web
//  `QueryError` peer). Each keeps the card's shape so the surface never collapses to a blank box.
//  All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Output router (web `AiOutputPanel` body branches)

/// Routes the resolved phase to its body — the native parity of the web `AiOutputPanel`'s
/// error / thinking / text branches, plus the P4 loading + friendly idle states.
struct AITripNameOutputView: View {
    let phase: AITripNameResolved.Phase
    let onRetry: () -> Void

    var body: some View {
        switch phase {
        case .gatedOff:
            // Defensive: the gate is handled by the surface; the card is not built when off.
            EmptyView()
        case .loading:
            AITripNameLoadingView()
        case .idle:
            AITripNameIdleView()
        case .thinking:
            AITripNameOutputPanel { AITripNameThinkingView() }
        case let .suggestion(text):
            AITripNameOutputPanel { AITripNameSuggestionView(text: text) }
        case let .error(message):
            AITripNameOutputPanel { AITripNameErrorView(message: message, onRetry: onRetry) }
        }
    }
}

// MARK: - Output panel container (web `AiOutputPanel` shell)

/// The bordered, subtly-tinted output panel that wraps the streamed content — the native parity of
/// the web `AiOutputPanel` shell (`rounded-lg border bg-white/[0.02] p-4`).
struct AITripNameOutputPanel<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.lg)
            .background(
                Color.TS.surfaceGlass.opacity(0.4),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Loading (parent context resolving)

/// The initial-context chrome — skeleton lines standing in for the streamed suggestion, so the
/// card keeps its shape while the trip context resolves.
struct AITripNameLoadingView: View {
    var body: some View {
        AITripNameOutputPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(height: 12)
                TSSkeleton(width: 220, height: 12)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AITripNameStrings.string(
            "aiSuggestName.loadingA11y", "Loading"
        )))
    }
}

// MARK: - Idle (resolved, nothing requested yet)

/// The friendly idle output (nothing requested yet) — a muted, Helix-marked prompt, never a blank
/// box. The native peer of the web `AiOutputPanel` rendering nothing before the first stream, made
/// visible to satisfy the P4 leaf contract.
struct AITripNameIdleView: View {
    var body: some View {
        AITripNameOutputPanel {
            HStack(spacing: TSSpacing.sm) {
                HelixMark(size: 16)
                Text(verbatim: AITripNameStrings.string(
                    "aiSuggestName.idle",
                    "Tap Ask Helix to propose a name for this trip."
                ))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Thinking (stream open, first delta pending — web `AIThinkingIndicator`)

/// The streaming-but-empty body shown while the SSE is open and the first delta has not arrived —
/// the native parity of the web `AIThinkingIndicator`: a Helix "thinking" label with pulsing dots
/// over shimmering skeleton lines. Motion respects Reduce Motion (via `TSSkeleton`).
struct AITripNameThinkingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                HelixMark(size: 16)
                HelixThinkingDots(label: AITripNameStrings.string(
                    "ai.common.thinking", "Helix is thinking"
                ))
            }
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(height: 12)
                TSSkeleton(width: 240, height: 12)
                TSSkeleton(width: 180, height: 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AITripNameStrings.string(
            "ai.common.thinking", "Helix is thinking"
        )))
    }
}

// MARK: - Suggestion (streamed / final propose-only name)

/// The streamed propose-only name suggestion (web `AiOutputPanel` text branch) — the proposal text
/// rendered with preserved whitespace, with a propose-only reminder beneath. Read as one VoiceOver
/// element naming its role then its content.
struct AITripNameSuggestionView: View {
    let text: String

    private var role: String {
        AITripNameStrings.string("aiSuggestName.suggestionRole", "Suggested name")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: text)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: AITripNameStrings.string(
                "aiSuggestName.proposeOnly", "Propose-only — review and Save to apply."
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AITripNameAccessibility.suggestionLabel(
            role: role, text: text
        )))
    }
}

// MARK: - Error (web `AiOutputPanel` error branch / `QueryError` peer)

/// The stream-failure body (web `AiOutputPanel` error branch) — a Helix-marked error line with the
/// runtime message and a retry affordance that re-runs the suggestion stream.
struct AITripNameErrorView: View {
    let message: String
    let onRetry: () -> Void

    private var prefix: String {
        AITripNameStrings.string("helix.errorLabel", "Helix error:")
    }

    private var resolvedMessage: String {
        message.isEmpty
            ? AITripNameStrings.string("ai.common.errorUnknown", "unknown")
            : message
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                HelixMark(size: 16, tint: Color.TS.statusDanger)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: prefix)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.statusDanger)
                    Text(verbatim: resolvedMessage)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: AITripNameStrings.string("aiSuggestName.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: AITripNameStrings.string(
                "aiSuggestName.retry", "Retry"
            )))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: AITripNameAccessibility.errorLabel(
            prefix: prefix, message: resolvedMessage
        )))
    }
}
