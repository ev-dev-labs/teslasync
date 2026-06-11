//
//  AINLSqlPlayground.Chrome.swift
//  TeslaSync — P4 shared surface · 0035 · AINLSqlPlayground (Apple)
//
//  The streamed-output, captured-draft, and gate-chrome subviews split out of `…Views.swift`
//  (one file ≤ 400 lines per the SwiftLint contract): the web `AiOutputPanel` (thinking
//  indicator / Helix error / accumulated rationale text), the captured `ReadonlySQLDraft`
//  card with the propose-only "Apply to editor" action (web `{draft && …}` children slot), and
//  the P4 leaf gate loading / error chrome. All consume the P1/S10 facade and the shared
//  P1/S9 tokens — no networking, no raw hex.
//

import SwiftUI

// MARK: - Output panel (web `AiOutputPanel`)

/// The streamed-output panel — the native port of the web `AiOutputPanel`: the Helix error
/// message for an `error` stream, the animated thinking indicator while the SSE is open and no
/// text has arrived, and the accumulated rationale narrative otherwise. Collapses to nothing
/// when there is nothing to show (web `hasAnything` false).
struct NLSqlPlaygroundOutputPanel: View {
    let phase: NLSqlPlaygroundStreamPhase
    let text: String

    var body: some View {
        if case let .error(message) = phase {
            panel { NLSqlPlaygroundErrorRow(message: message) }
        } else if NLSqlPlaygroundLogic.thinkingVisible(phase: phase, hasText: !text.isEmpty) {
            panel { NLSqlPlaygroundThinkingIndicator() }
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

    private func panel(@ViewBuilder _ content: () -> some View) -> some View {
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
struct NLSqlPlaygroundErrorRow: View {
    let message: String

    private var errorLabel: String {
        NLSqlPlaygroundStrings.string("helix.errorLabel", "Helix error:")
    }

    private var resolvedMessage: String {
        message.isEmpty
            ? NLSqlPlaygroundStrings.string("ai.common.errorUnknown", "unknown")
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
/// stream is open and no text has arrived. Honours reduce-motion (the skeleton shimmer + symbol
/// pulse are decorative).
struct NLSqlPlaygroundThinkingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var thinkingLabel: String {
        NLSqlPlaygroundStrings.string("helix.thinking", "Helix is thinking…")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .nlSqlPlaygroundSymbolPulse(active: !reduceMotion)
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
/// The web renders only the "Apply to editor" button there; this card additionally previews the
/// proposed read-only SQL the button will copy into the editor (transparent, propose-only — the
/// user sees exactly what will be applied and can still edit + Run it themselves) plus the
/// referenced-table chips. The action is computed-disabled (web `canApply = !!draft &&
/// !isStreaming`), never a literal `disabled`.
struct NLSqlPlaygroundDraftCard: View {
    let draft: ReadonlySQLDraft
    let canApply: Bool
    let onApply: () -> Void

    private var heading: String {
        NLSqlPlaygroundStrings.string("powerSql.aiDrafter.draftHeading", "Proposed read-only SQL")
    }

    private var tablesLabel: String {
        NLSqlPlaygroundStrings.string("powerSql.aiDrafter.tablesLabel", "Referenced tables")
    }

    private var applyLabel: String {
        NLSqlPlaygroundStrings.string("powerSql.aiDrafter.applyButton", "Apply to editor")
    }

    private var applyTooltip: String {
        NLSqlPlaygroundStrings.string(
            "powerSql.aiDrafter.applyTooltip",
            "Copy the proposed SQL into the editor above. You can still edit it before clicking Run."
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: heading)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: draft.sql)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .padding(TSSpacing.sm)
                .background(
                    Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
                .accessibilityLabel(Text(verbatim: "\(heading). \(draft.sql)"))
            if !draft.referencedTables.isEmpty {
                NLSqlPlaygroundTableChips(label: tablesLabel, tables: draft.referencedTables)
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

/// The referenced-table chips under the SQL preview — a labelled, wrapping row of the tables
/// the captured draft reads from (web `referenced_tables`).
struct NLSqlPlaygroundTableChips: View {
    let label: String
    let tables: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            NLSqlPlaygroundTableChipFlow(tables: tables)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(tables.joined(separator: ", "))"))
    }
}

/// A simple wrapping chip row (no third-party layout). Each chip is a tokenised pill carrying a
/// referenced table name.
struct NLSqlPlaygroundTableChipFlow: View {
    let tables: [String]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            chipRow
            ScrollView(.horizontal, showsIndicators: false) { chipRow }
        }
    }

    private var chipRow: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(tables, id: \.self) { table in
                Text(verbatim: table)
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
struct NLSqlPlaygroundGateLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 260, height: 14)
            TSSkeleton(height: 10)
            TSSkeleton(width: 260, height: 10)
            TSSkeleton(height: 60, cornerRadius: TSRadius.md)
            HStack {
                Spacer(minLength: 0)
                TSSkeleton(width: 120, height: 28, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: NLSqlPlaygroundStrings.string(
            "powerSql.aiDrafter.loadingA11y", "Loading Helix SQL drafter"
        )))
    }
}

/// The gate / context fetch-failure state (web `QueryError` peer) with a retry affordance —
/// distinct from a stream `error`, which surfaces inside the output panel.
struct NLSqlPlaygroundGateErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: NLSqlPlaygroundStrings.string(
                "powerSql.aiDrafter.errorTitle", "Couldn't load Helix SQL drafter"
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
                Text(verbatim: NLSqlPlaygroundStrings.string("powerSql.aiDrafter.retry", "Retry"))
                    .font(Font.TS.label)
            }
            .accessibilityLabel(Text(verbatim: NLSqlPlaygroundStrings.string(
                "powerSql.aiDrafter.retry", "Retry"
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
    func nlSqlPlaygroundSymbolPulse(active: Bool) -> some View {
        if active {
            symbolEffect(.pulse, options: .repeating)
        } else {
            self
        }
    }
}
