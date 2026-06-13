//
//  AICrossRuleConflictDetection.Chrome.swift
//  TeslaSync — P4 shared surface · 0014 · AICrossRuleConflictDetection (Apple)
//
//  The streamed-output + gate-chrome + atom subviews split out of `…Views.swift` (one file ≤
//  400 lines per the SwiftLint contract): the web `AiOutputPanel` (thinking indicator / Helix
//  error / accumulated text), the resolved-empty "no conflicts found" box (web `emptyMessage`),
//  the P4 leaf gate loading / error chrome, the per-conflict mismatch chip, and the wrapping
//  flow layout the chips sit in. All consume the P1/S10 facade and the shared P1/S9 tokens —
//  no networking, no raw hex.
//

import SwiftUI

// MARK: - Empty message (web `conflicts.length === 0` box)

/// The resolved-but-empty box (web `conflicts != null && conflicts.length === 0`): a friendly
/// "no structural conflicts" message in the muted surface, never a blank panel.
struct RuleConflictEmptyMessage: View {
    private var message: String {
        RuleConflictStrings.string(
            "notifications.alertStudio.aiConflicts.emptyMessage",
            "No structural conflicts found in the current rule set."
        )
    }

    var body: some View {
        Text(verbatim: message)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
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
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: message))
    }
}

// MARK: - Mismatch chip (web per-conflict severity/cooldown/subsumes pill)

/// One structural-mismatch chip — `subsumes` in the amber/"warning" tone, the three `*Mismatch`
/// flags in the rose/"danger" tone (web colour split). Tiny uppercase tinted pill, label routed
/// through the P1/S10 facade.
struct RuleConflictFlagChip: View {
    let flag: RuleConflictFlag

    private var tone: Color {
        flag.isWarningTone ? Color.TS.statusWarning : Color.TS.statusDanger
    }

    private var label: String {
        RuleConflictStrings.string(flag.localization.key, flag.localization.fallback)
    }

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.10), in: Capsule(style: .continuous))
            .overlay(Capsule(style: .continuous).strokeBorder(tone.opacity(0.30), lineWidth: 1))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Output panel (web `AiOutputPanel`)

/// The streamed-output panel — the native port of the web `AiOutputPanel`: the Helix error
/// message for an `error` stream, the animated thinking indicator while the SSE is open and no
/// text has arrived, and the accumulated narrative otherwise. Collapses to nothing when there
/// is nothing to show (web `hasAnything` false, plus the done-with-no-text case where the
/// conflict list / empty box above is the real output — avoids a blank panel).
struct RuleConflictOutputPanel: View {
    let phase: RuleConflictStreamPhase
    let text: String

    var body: some View {
        if case let .error(message) = phase {
            panel { RuleConflictErrorRow(message: message) }
        } else if RuleConflictLogic.thinkingVisible(phase: phase, hasText: !text.isEmpty) {
            panel { RuleConflictThinkingIndicator() }
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
struct RuleConflictErrorRow: View {
    let message: String

    private var errorLabel: String {
        RuleConflictStrings.string("helix.errorLabel", "Helix error:")
    }

    private var resolvedMessage: String {
        message.isEmpty ? RuleConflictStrings.string("ai.common.errorUnknown", "unknown") : message
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

/// The web `AIThinkingIndicator`: a Helix mark + label and shimmering skeleton lines, shown
/// while the stream is open and no text has arrived. Honours reduce-motion (the pulse + skeleton
/// shimmer are decorative).
struct RuleConflictThinkingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var thinkingLabel: String {
        RuleConflictStrings.string("helix.thinking", "Helix is thinking…")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .ruleConflictSymbolPulse(active: !reduceMotion)
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

/// The gate-resolving chrome (web `useAiEnabled` loading): skeleton header + a skeleton action
/// row, so the card keeps its shape while the AI-Off gate resolves.
struct RuleConflictGateLoadingView: View {
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
        .accessibilityLabel(Text(verbatim: RuleConflictStrings.string(
            "notifications.alertStudio.aiConflicts.loadingA11y", "Loading Helix conflict detection"
        )))
    }
}

/// The gate / context fetch-failure state (web `QueryError` peer) with a retry affordance —
/// distinct from a stream `error`, which surfaces inside the output panel.
struct RuleConflictGateErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: RuleConflictStrings.string(
                "notifications.alertStudio.aiConflicts.errorTitle", "Couldn't load Helix conflict detection"
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
                Text(verbatim: RuleConflictStrings.string(
                    "notifications.alertStudio.aiConflicts.retry", "Retry"
                ))
                .font(Font.TS.label)
            }
            .accessibilityLabel(Text(verbatim: RuleConflictStrings.string(
                "notifications.alertStudio.aiConflicts.retry", "Retry"
            )))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Wrapping flow layout (the mismatch-chip row)

/// A minimal HIG-native wrapping flow layout for the mismatch chips — they wrap to the next line
/// when they exceed the available width instead of truncating or overflowing. Scoped to this
/// surface (Layout protocol, iOS 16+/macOS 13+; the app targets iOS 18 / macOS 15).
struct RuleConflictFlowLayout: Layout {
    var spacing: CGFloat = TSSpacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                totalWidth = max(totalWidth, rowWidth)
                totalHeight += rowHeight + spacing
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += (rowWidth > 0 ? spacing : 0) + size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        totalWidth = max(totalWidth, rowWidth)
        totalHeight += rowHeight
        return CGSize(width: totalWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        var pointX = bounds.minX
        var pointY = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if pointX > bounds.minX, pointX + size.width > bounds.maxX {
                pointX = bounds.minX
                pointY += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: pointX, y: pointY), proposal: ProposedViewSize(size))
            pointX += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - Symbol pulse helper (reduce-motion safe)

extension View {
    /// Applies a repeating symbol pulse when `active`, and is otherwise inert — a single
    /// reduce-motion gate shared by the action button and the thinking indicator.
    @ViewBuilder
    func ruleConflictSymbolPulse(active: Bool) -> some View {
        if active {
            symbolEffect(.pulse, options: .repeating)
        } else {
            self
        }
    }
}
