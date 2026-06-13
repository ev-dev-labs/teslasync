//
//  AINLDashboardComposer.Chrome.swift
//  TeslaSync — P4 shared surface · 0031 · AINLDashboardComposer (Apple)
//
//  The streamed-output, captured-draft, and gate-chrome subviews split out of `…Views.swift`
//  (one file ≤ 400 lines per the SwiftLint contract): the web `AiOutputPanel`, the captured
//  `DashboardLayoutDraft` card + propose-only "Apply to editor", and the P4 leaf gate chrome.
//  All consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no raw hex.
//

import SwiftUI

// MARK: - Output panel (web `AiOutputPanel`)

/// The streamed-output panel — the native port of the web `AiOutputPanel`: the Helix error
/// message for an `error` stream, the animated thinking indicator while the SSE is open with no
/// text yet, and the accumulated rationale otherwise. Collapses when there is nothing to show.
struct NLDashboardComposerOutputPanel: View {
    let phase: NLDashboardComposerStreamPhase
    let text: String

    var body: some View {
        if case let .error(message) = phase {
            panel { NLDashboardComposerErrorRow(message: message) }
        } else if NLDashboardComposerLogic.thinkingVisible(phase: phase, hasText: !text.isEmpty) {
            panel { NLDashboardComposerThinkingIndicator() }
        } else if !text.isEmpty {
            panel {
                Text(verbatim: text)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
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
struct NLDashboardComposerErrorRow: View {
    let message: String

    private var errorLabel: String {
        NLDashboardComposerStrings.string("helix.errorLabel", "Helix error:")
    }

    private var resolvedMessage: String {
        message.isEmpty
            ? NLDashboardComposerStrings.string("ai.common.errorUnknown", "unknown")
            : message
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

/// The web `AIThinkingIndicator`: shimmering skeleton lines + a sparkles label, shown while the
/// stream is open with no text yet. Honours reduce-motion (the shimmer + symbol pulse decorate).
struct NLDashboardComposerThinkingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var thinkingLabel: String {
        NLDashboardComposerStrings.string("helix.thinking", "Helix is thinking…")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .nlDashboardComposerSymbolPulse(active: !reduceMotion)
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

// MARK: - Captured draft card (web `{draft && …}` children slot + "Apply to editor")

/// The captured-draft surface — the native port of the web `{draft && (…)}` children block.
/// The web renders only the "Apply to editor" button; this card additionally previews the
/// proposed dashboard (title + panel slots + grid placement + referenced panels) the button
/// copies into the composer. The action is computed-disabled (web `canApply`), never literal.
struct NLDashboardComposerDraftCard: View {
    let draft: DashboardLayoutDraft
    let canApply: Bool
    let onApply: () -> Void

    private var heading: String {
        NLDashboardComposerStrings.string("powerDashboards.aiDrafter.draftHeading", "Proposed dashboard")
    }

    private var applyLabel: String {
        NLDashboardComposerStrings.string("powerDashboards.aiDrafter.applyButton", "Apply to editor")
    }

    private var applyTooltip: String {
        NLDashboardComposerStrings.string(
            "powerDashboards.aiDrafter.applyTooltip",
            """
            Copy the proposed dashboard JSON into the editor above. You can still edit it before \
            clicking Copy to clipboard.
            """
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: heading)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: draft.dashboard.title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            NLDashboardComposerSlotList(slots: draft.dashboard.slots)
            if !draft.referencedPanels.isEmpty {
                NLDashboardComposerPanelChips(panels: draft.referencedPanels)
            }
            HStack {
                Spacer(minLength: 0)
                TSButton(variant: .primary, size: .small, action: onApply) {
                    Text(verbatim: applyLabel)
                        .font(Font.TS.label)
                }
                .disabled(!canApply)
                .help(applyTooltip)
                .accessibilityLabel(Text(verbatim: applyLabel))
                .accessibilityHint(Text(verbatim: applyTooltip))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(
            Color.TS.accent.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(0.25), lineWidth: 1)
        )
    }
}

/// The proposed dashboard's panel slots — a labelled list of each slot's curated panel name and
/// its grid placement (web `dashboard.slots`). An empty list shows the friendly "no panels"
/// line so the card is never a confusing blank (P4 empty contract).
struct NLDashboardComposerSlotList: View {
    let slots: [DashboardSlot]

    private var slotsLabel: String {
        let format = NLDashboardComposerStrings.string(
            "powerDashboards.aiDrafter.slotsLabel", "Panels (%d)"
        )
        return String(format: format, slots.count)
    }

    private var emptyLabel: String {
        NLDashboardComposerStrings.string(
            "powerDashboards.aiDrafter.slotsEmpty", "No panels proposed."
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: slotsLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if slots.isEmpty {
                Text(verbatim: emptyLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            } else {
                ForEach(Array(slots.enumerated()), id: \.offset) { _, slot in
                    NLDashboardComposerSlotRow(slot: slot)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One panel slot row: the curated panel name (leading) + a compact monospaced grid badge
/// "W×H" (trailing). The full placement (size + column/row) is voiced through the row's
/// accessibility label.
struct NLDashboardComposerSlotRow: View {
    let slot: DashboardSlot

    private var sizeBadge: String {
        "\(slot.gridPos.width)×\(slot.gridPos.height)"
    }

    private var gridA11y: String {
        let format = NLDashboardComposerStrings.string(
            "powerDashboards.aiDrafter.slotGridA11y",
            "%1$d wide, %2$d tall, at column %3$d, row %4$d"
        )
        return String(format: format, slot.gridPos.width, slot.gridPos.height, slot.gridPos.x, slot.gridPos.y)
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "rectangle.split.2x2")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: slot.panelName)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: sizeBadge)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, 2)
                .background(Color.TS.surfaceGlass, in: Capsule(style: .continuous))
                .overlay(Capsule(style: .continuous).strokeBorder(Color.TS.border, lineWidth: 1))
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(slot.panelName). \(gridA11y)"))
    }
}

/// The referenced-panel chips under the slot list — a labelled, wrapping row of the curated
/// panels the captured draft references (web `referenced_panels`).
struct NLDashboardComposerPanelChips: View {
    let panels: [String]

    private var label: String {
        NLDashboardComposerStrings.string("powerDashboards.aiDrafter.panelsLabel", "Referenced panels")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            NLDashboardComposerPanelChipFlow(panels: panels)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(panels.joined(separator: ", "))"))
    }
}

/// A simple wrapping chip row (no third-party layout). Each chip is a tokenised pill carrying a
/// referenced curated-panel name.
struct NLDashboardComposerPanelChipFlow: View {
    let panels: [String]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            chipRow
            ScrollView(.horizontal, showsIndicators: false) { chipRow }
        }
    }

    private var chipRow: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(panels, id: \.self) { panel in
                Text(verbatim: panel)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color.TS.textSecondary)
                    .padding(.horizontal, TSSpacing.sm)
                    .padding(.vertical, 2)
                    .background(
                        Color.TS.surfaceGlass,
                        in: Capsule(style: .continuous)
                    )
                    .overlay(Capsule(style: .continuous).strokeBorder(Color.TS.border, lineWidth: 1))
            }
        }
    }
}

// MARK: - Gate chrome (P4 leaf loading / error)

/// The gate-resolving chrome (web `useAiEnabled` loading): skeleton header + skeleton input +
/// a skeleton action row, so the card keeps its shape while the AI-Off gate resolves.
struct NLDashboardComposerGateLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 280, height: 14)
            TSSkeleton(height: 10)
            TSSkeleton(width: 260, height: 10)
            TSSkeleton(height: 60, cornerRadius: TSRadius.md)
            HStack {
                Spacer(minLength: 0)
                TSSkeleton(width: 150, height: 28, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: NLDashboardComposerStrings.string(
            "powerDashboards.aiDrafter.loadingA11y", "Loading Helix dashboard composer"
        )))
    }
}

/// The gate / context fetch-failure state (web `QueryError` peer) with a retry affordance —
/// distinct from a stream `error`, which surfaces inside the output panel.
struct NLDashboardComposerGateErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: NLDashboardComposerStrings.string(
                "powerDashboards.aiDrafter.errorTitle", "Couldn't load Helix dashboard composer"
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
                Text(verbatim: NLDashboardComposerStrings.string("powerDashboards.aiDrafter.retry", "Retry"))
                    .font(Font.TS.label)
            }
            .accessibilityLabel(Text(verbatim: NLDashboardComposerStrings.string(
                "powerDashboards.aiDrafter.retry", "Retry"
            )))
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
    func nlDashboardComposerSymbolPulse(active: Bool) -> some View {
        if active {
            symbolEffect(.pulse, options: .repeating)
        } else {
            self
        }
    }
}
