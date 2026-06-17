//
//  AlertRulesPage.Table.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/AlertRules (Apple) — Rules table
//
//  The rules table (web `<table>` inside the `GlassPanel`): a master-select header
//  plus the Name / Signal / Severity / Status columns, and one row per rule with a
//  selection checkbox, the editable name cell, the signal, and the severity + status
//  badges. Adaptive (ADR-002/006): a column grid at regular width (macOS / iPad) and
//  stacked rule cards at compact width (iPhone). No business logic — selection,
//  rename validation, and saves all route to `AlertRulesPageModel`.
//

import SwiftUI

struct AlertRulesTable: View {
    let model: AlertRulesPageModel
    let onOpenStudio: (Int64) -> Void

    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        if sizeClass == .compact {
            compactList
        } else {
            regularGrid
        }
    }

    // MARK: - Regular width (web columnar table)

    private var regularGrid: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: 0) {
            GridRow {
                selectAllCheckbox
                columnHeader("alertRules.col.name", "Name")
                columnHeader("alertRules.col.signal", "Signal")
                columnHeader("alertRules.col.severity", "Severity")
                columnHeader("alertRules.col.status", "Status")
            }
            .padding(.vertical, TSSpacing.sm)
            Divider().overlay(Color.TS.border)

            ForEach(model.rules) { rule in
                GridRow {
                    rowCheckbox(rule)
                    AlertRuleNameCell(
                        rule: rule,
                        onOpenStudio: { onOpenStudio(rule.id) },
                        validate: model.validateName,
                        onRename: { await model.rename(id: rule.id, to: $0) }
                    )
                    signalText(rule)
                    AlertRuleSeverityBadge(severity: rule.severity)
                    AlertRuleStatusBadge(enabled: rule.enabled)
                }
                .padding(.vertical, TSSpacing.sm)
                Divider().overlay(Color.TS.border)
            }
        }
    }

    // MARK: - Compact width (stacked rule cards)

    private var compactList: some View {
        VStack(spacing: TSSpacing.sm) {
            HStack {
                selectAllCheckbox
                Text(ARStrings.key("bulk.selectAll"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer()
            }
            ForEach(model.rules) { rule in
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    HStack(alignment: .top, spacing: TSSpacing.sm) {
                        rowCheckbox(rule)
                        AlertRuleNameCell(
                            rule: rule,
                            onOpenStudio: { onOpenStudio(rule.id) },
                            validate: model.validateName,
                            onRename: { await model.rename(id: rule.id, to: $0) }
                        )
                    }
                    signalText(rule)
                    HStack(spacing: TSSpacing.sm) {
                        AlertRuleSeverityBadge(severity: rule.severity)
                        AlertRuleStatusBadge(enabled: rule.enabled)
                    }
                }
                .padding(TSSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
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
    }

    // MARK: - Cells

    private var selectAllCheckbox: some View {
        Button(action: model.toggleAll) {
            Image(systemName: selectAllSymbol)
                .font(.system(size: 16))
                .foregroundStyle(model.selectAllState == .none ? Color.TS.textMuted : Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(ARStrings.key("bulk.selectAll"))
        .accessibilityAddTraits(model.selectAllState == .all ? [.isButton, .isSelected] : .isButton)
    }

    private var selectAllSymbol: String {
        switch model.selectAllState {
        case .all: "checkmark.square.fill"
        case .some: "minus.square.fill"
        case .none: "square"
        }
    }

    private func rowCheckbox(_ rule: AlertRule) -> some View {
        Button { model.toggle(rule.id) } label: {
            Image(systemName: model.isSelected(rule.id) ? "checkmark.square.fill" : "square")
                .font(.system(size: 16))
                .foregroundStyle(model.isSelected(rule.id) ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: ARStrings.selectRule(name: rule.name)))
        .accessibilityHint(ARStrings.key("bulk.selectRow"))
        .accessibilityAddTraits(model.isSelected(rule.id) ? [.isButton, .isSelected] : .isButton)
    }

    private func columnHeader(_ key: String, _ fallback: String) -> some View {
        Text(verbatim: ARStrings.text(key, fallback))
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textSecondary)
    }

    private func signalText(_ rule: AlertRule) -> some View {
        Text(verbatim: rule.signalName)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
    }
}
