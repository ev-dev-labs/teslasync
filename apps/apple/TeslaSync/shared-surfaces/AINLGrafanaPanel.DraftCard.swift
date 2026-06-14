//
//  AINLGrafanaPanel.DraftCard.swift
//  TeslaSync — P4 shared surface · 0033 · AINLGrafanaPanel (Apple)
//
//  The captured-draft surface — the native port of the web `{draft && (…)}` children block plus
//  the propose-only "Apply to editor" action. Split out of `…Chrome.swift` (one file ≤ 400 lines
//  per the SwiftLint contract) because the Grafana panel envelope is richer than the dashboard's
//  (panel type + datasource + query targets with SQL/expr + grid placement + referenced tables).
//  The web renders only the "Apply to editor" button; this card additionally previews the whole
//  proposed panel the button copies into the editor. The action is computed-disabled (web
//  `canApply`), never literal. All copy flows through the P1/S10 facade; chrome is tokenised
//  (P1/S9) — no raw hex.
//

import SwiftUI

// MARK: - Captured draft card (web `{draft && …}` children slot + "Apply to editor")

/// The proposed-panel card: the heading, the panel title, the meta row (type + datasource +
/// grid), the query targets, the referenced-table chips, and the propose-only "Apply to editor"
/// button (computed-disabled while streaming, web `canApply`).
struct NLGrafanaPanelDraftCard: View {
    let draft: GrafanaPanelDraft
    let canApply: Bool
    let onApply: () -> Void

    private var heading: String {
        NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.draftHeading", "Proposed panel")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: heading)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: draft.panel.title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            NLGrafanaPanelMetaRow(panel: draft.panel)
            NLGrafanaPanelTargetList(targets: draft.panel.targets)
            if !draft.referencedTables.isEmpty {
                NLGrafanaPanelTableChips(tables: draft.referencedTables)
            }
            applyRow
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

    private var applyLabel: String {
        NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.applyButton", "Apply to editor")
    }

    private var applyTooltip: String {
        NLGrafanaPanelStrings.string(
            "powerGrafana.aiDrafter.applyTooltip",
            """
            Copy the proposed panel JSON into the editor above. You can still edit it before \
            clicking Copy to clipboard.
            """
        )
    }

    private var applyRow: some View {
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
}

// MARK: - Meta row (panel type + datasource + grid placement)

/// The panel's at-a-glance metadata — the panel type, the datasource, and the grid placement —
/// rendered as a wrapping row of tokenised chips. Each chip voices its full meaning for
/// VoiceOver (the visible text is compact).
struct NLGrafanaPanelMetaRow: View {
    let panel: GrafanaPanelEnvelope

    private var typeA11y: String {
        let format = NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.typeA11y", "Panel type %@")
        return String(format: format, panel.type)
    }

    private var datasourceA11y: String {
        let format = NLGrafanaPanelStrings.string(
            "powerGrafana.aiDrafter.datasourceA11y", "Datasource %1$@, uid %2$@"
        )
        return String(format: format, panel.datasource.type, panel.datasource.uid)
    }

    private var gridText: String {
        "\(panel.gridPos.width)×\(panel.gridPos.height)"
    }

    private var gridA11y: String {
        let format = NLGrafanaPanelStrings.string(
            "powerGrafana.aiDrafter.gridA11y", "%1$d wide, %2$d tall, at column %3$d, row %4$d"
        )
        return String(
            format: format,
            panel.gridPos.width, panel.gridPos.height, panel.gridPos.x, panel.gridPos.y
        )
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            chips
            ScrollView(.horizontal, showsIndicators: false) { chips }
        }
    }

    private var chips: some View {
        HStack(spacing: TSSpacing.xs) {
            NLGrafanaPanelChip(icon: "chart.xyaxis.line", text: panel.type, a11y: typeA11y)
            NLGrafanaPanelChip(
                icon: "cylinder.split.1x2", text: panel.datasource.type, a11y: datasourceA11y
            )
            NLGrafanaPanelChip(icon: "squareshape.split.2x2", text: gridText, a11y: gridA11y)
        }
    }
}

/// One tokenised meta chip: an SF Symbol + a compact mono label, with a spoken label carrying
/// the full meaning. Shared by the meta row so every chip is consistent.
struct NLGrafanaPanelChip: View {
    let icon: String
    let text: String
    let a11y: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(.system(size: 11, design: .monospaced))
        }
        .foregroundStyle(Color.TS.textSecondary)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.surfaceGlass, in: Capsule(style: .continuous))
        .overlay(Capsule(style: .continuous).strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: a11y))
    }
}

// MARK: - Query targets (web `panel.targets`)

/// The proposed panel's query targets — a labelled list of each target's ref id and its query
/// (raw SQL or expr). An empty list shows the friendly "no targets" line so the card is never a
/// confusing blank (P4 empty contract).
struct NLGrafanaPanelTargetList: View {
    let targets: [GrafanaPanelTarget]

    private var label: String {
        let format = NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.targetsLabel", "Queries (%d)")
        return String(format: format, targets.count)
    }

    private var emptyLabel: String {
        NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.targetsEmpty", "No queries proposed.")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if targets.isEmpty {
                Text(verbatim: emptyLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            } else {
                ForEach(Array(targets.enumerated()), id: \.offset) { _, target in
                    NLGrafanaPanelTargetRow(target: target)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One query-target row: the ref-id badge (leading) + the query body (raw SQL or expr, mono +
/// selectable) + an optional format caption. The whole row voices a single combined label.
struct NLGrafanaPanelTargetRow: View {
    let target: GrafanaPanelTarget

    private var queryText: String {
        target.rawSQL
            ?? target.expr
            ?? NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.targetNoQuery", "(no query)")
    }

    private var formatText: String? {
        guard let format = target.format, !format.isEmpty else { return nil }
        let template = NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.targetFormat", "format: %@")
        return String(format: template, format)
    }

    private var rowA11y: String {
        let template = NLGrafanaPanelStrings.string(
            "powerGrafana.aiDrafter.targetA11y", "Query %1$@: %2$@"
        )
        let base = String(format: template, target.refID, queryText)
        return formatText.map { "\(base). \($0)" } ?? base
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Text(verbatim: target.refID)
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(Color.TS.accent)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, 2)
                .background(Color.TS.accent.opacity(0.10), in: Capsule(style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: queryText)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                if let formatText {
                    Text(verbatim: formatText)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: rowA11y))
    }
}

// MARK: - Referenced tables (web `panel.referenced_tables` → here `draft.referenced_tables`)

/// The referenced-table chips under the targets — a labelled, wrapping row of the DB tables the
/// captured draft references (web `referenced_tables`).
struct NLGrafanaPanelTableChips: View {
    let tables: [String]

    private var label: String {
        NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.tablesLabel", "Referenced tables")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            NLGrafanaPanelTableChipFlow(tables: tables)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(tables.joined(separator: ", "))"))
    }
}

/// A simple wrapping chip row (no third-party layout). Each chip is a tokenised pill carrying a
/// referenced DB-table name.
struct NLGrafanaPanelTableChipFlow: View {
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
                    .background(Color.TS.surfaceGlass, in: Capsule(style: .continuous))
                    .overlay(Capsule(style: .continuous).strokeBorder(Color.TS.border, lineWidth: 1))
            }
        }
    }
}
