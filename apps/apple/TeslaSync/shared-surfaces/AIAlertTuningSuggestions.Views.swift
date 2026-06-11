//
//  AIAlertTuningSuggestions.Views.swift
//  TeslaSync — P4 shared surface · 0004 · AIAlertTuningSuggestions (Apple)
//
//  The presentational subviews composed by `AIAlertTuningSuggestions`, reproducing the shared web
//  `AIFeatureCard` + `AiOutputPanel` + `AIThinkingIndicator` regions plus the alert-tuning card's
//  captured-proposal block (the "Apply to form" button + the "Proposed patch" preview list). All
//  consume the P1/S10 facade values via the resolved model + the shared P1/S9 tokens — no networking,
//  no Tailwind ports, no raw hex.
//
//  Scope note: the web `AIFeatureCard` / `AiOutputPanel` atoms are owned by the P4 component-library
//  bundle (out of scope here, and not yet present), so these regions are reproduced as private
//  subviews scoped to this surface — the only files this prompt is allowed to touch.
//

import SwiftUI

// MARK: - Helix badge (web `AIBadge` — HelixMark + label pill)

/// The small cyan "Helix" pill rendered next to the card title — the native peer of the web `AIBadge`
/// (an SF Symbol mark + the label inside a tinted, bordered chip).
struct AlertTuningHelixBadge: View {
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "sparkles")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(Color.TS.accent)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.accent.opacity(0.10), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.accent.opacity(0.30), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Suggest button (web `AIFeatureCard` action)

/// The universal Suggest action — the native port of the `AIFeatureCard` button: the visible label
/// flips to "Helix is thinking…" while streaming, the control is disabled when `!canStart` or
/// streaming, and the spoken name carries the per-feature verb ("Ask Helix · Suggest tuning").
struct AlertTuningActionButton: View {
    let ready: AlertTuningReady
    let onTap: () -> Void

    var body: some View {
        TSButton(variant: .secondary, size: .small, action: onTap) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.system(size: 11, weight: .semibold))
                    .symbolEffectIfAvailable(active: ready.action.isStreaming)
                    .accessibilityHidden(true)
                if ready.action.isStreaming {
                    AlertTuningThinkingDots(label: ready.actionTitle)
                } else {
                    Text(verbatim: ready.actionTitle)
                }
            }
        }
        .disabled(ready.action.isDisabled)
        .opacity(ready.action.isDisabled ? 0.55 : 1)
        .accessibilityLabel(Text(verbatim: ready.actionAccessibilityLabel))
        .accessibilityHint(Text(verbatim: ready.description))
        .accessibilityAddTraits(ready.action.isDisabled ? [] : .isButton)
    }
}

// MARK: - Thinking dots (web `AIThinkingDots`)

/// The streaming-state label with three cycling dots — the native peer of `AIThinkingDots`. The dots
/// animate only when Reduce Motion is off; the label itself is always shown.
struct AlertTuningThinkingDots: View {
    let label: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = 0

    private let timer = Timer.publish(every: 0.4, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 4) {
            Text(verbatim: label)
            Text(verbatim: dots)
                .monospacedDigit()
                .accessibilityHidden(true)
        }
        .onReceive(timer) { _ in
            guard !reduceMotion else { return }
            phase = (phase + 1) % 4
        }
    }

    private var dots: String {
        reduceMotion ? "…" : String(repeating: ".", count: phase)
    }
}

// MARK: - Thinking indicator (web `AIThinkingIndicator`)

/// The streaming-but-empty state — the native port of `AIThinkingIndicator`: a "Helix is thinking…"
/// status line over three shimmering skeleton lines of decreasing width. Reduce Motion drops the
/// shimmer (the static skeleton remains) and the dots stop cycling.
struct AlertTuningThinkingView: View {
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "sparkles")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                AlertTuningThinkingDots(label: label)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.accent)
            }
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(height: 12)
                TSSkeleton(height: 12).frame(maxWidth: .infinity).padding(.trailing, TSSpacing.x2xl)
                TSSkeleton(width: 180, height: 12)
            }
            .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Output panel (web `AiOutputPanel`)

/// The streamed-output panel — the native port of `AiOutputPanel`: a friendly hint while idle, the
/// thinking indicator while streaming before the first delta, the accumulated prose once text
/// arrives, and an inline "Helix error: …" when the stream ends in error. Never a blank box (P4).
struct AlertTuningOutputPanel: View {
    let output: AlertTuningResolvedOutput

    var body: some View {
        content
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
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: output.accessibilityLabel))
    }

    @ViewBuilder
    private var content: some View {
        switch output.kind {
        case .empty:
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "sparkles")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: output.body)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
        case .thinking:
            AlertTuningThinkingView(label: output.body)
        case .prose:
            Text(verbatim: output.body)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .failed:
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: output.body)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.statusDanger)
            }
        }
    }
}

// MARK: - Captured-proposal region (web `proposal && (...)`)

/// The captured-patch block — the native port of the web `proposal && (...)` region: a right-aligned
/// "Apply to form" button over a success-toned preview panel listing the proposed AlertRule scalars.
/// Withdrawn entirely when no patch has been captured. The field identifiers (value_num, …) are the
/// literal schema names, rendered code-style exactly like the web `value_num: {n}`.
struct AlertTuningProposalView: View {
    let proposal: AlertTuningResolvedProposal
    let onApply: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                Spacer(minLength: 0)
                TSButton(variant: .primary, size: .small, action: onApply) {
                    Text(verbatim: proposal.applyTitle)
                }
                .disabled(proposal.applyDisabled)
                .opacity(proposal.applyDisabled ? 0.55 : 1)
                .accessibilityLabel(Text(verbatim: proposal.applyAccessibilityLabel))
                .accessibilityAddTraits(proposal.applyDisabled ? [] : .isButton)
            }
            preview
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: proposal.previewLabel)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.statusSuccess)
            VStack(alignment: .leading, spacing: 2) {
                ForEach(proposal.rows) { row in
                    HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                        Text(verbatim: "•")
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                            .accessibilityHidden(true)
                        Text(verbatim: "\(row.field): \(row.value)")
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Color.TS.textSecondary)
                            .accessibilityLabel(Text(verbatim: row.accessibilityLabel))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusSuccess.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.statusSuccess.opacity(0.30), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Ready card body (web `AIFeatureCard` description + button + output + proposal)

/// The open-gate card body — the description, the right-aligned Suggest action (the web
/// `buttonPlacement='below'` layout so the P4 freshness chip + refresh own the header row), the
/// captured-proposal block (when present), and the output panel.
struct AlertTuningReadyView: View {
    let ready: AlertTuningReady
    let onSuggest: () -> Void
    let onApply: () -> Void

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Text(verbatim: ready.description)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack {
                    Spacer(minLength: 0)
                    AlertTuningActionButton(ready: ready, onTap: onSuggest)
                }
                if ready.proposal.isPresent {
                    AlertTuningProposalView(proposal: ready.proposal, onApply: onApply)
                }
                AlertTuningOutputPanel(output: ready.output)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Symbol-effect shim

private extension View {
    /// Applies the iOS 18 / macOS 15 `.pulse` symbol effect when streaming, with a graceful fallback
    /// on platforms / builds where the modifier is unavailable.
    @ViewBuilder
    func symbolEffectIfAvailable(active: Bool) -> some View {
        if #available(iOS 18.0, macOS 15.0, *) {
            symbolEffect(.pulse, isActive: active)
        } else {
            self
        }
    }
}
