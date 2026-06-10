//
//  AlertStudioPage.Rules.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The AlertStudioPage rules-list column (web left column): the rules panel (title + count
//  + freshness, the rule search, the bulk-actions toolbar, the empty / no-matches states)
//  and the rule row (severity icon, once/snooze badges, signal/op + timestamp, and the
//  snooze / toggle / delete actions).
//

import SwiftUI

// MARK: - Rules list (web left column)

struct ASRulesPanel: View {
    let viewModel: AlertStudioViewModel
    let connection: ASConnection

    private var localize: ASLocalizer {
        viewModel.localize
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                titleRow
                if viewModel.rules.count > 3 {
                    TSSearchInput(
                        text: Binding(
                            get: { viewModel.ruleSearch },
                            set: { viewModel.setRuleSearch($0) }
                        ),
                        prompt: localize.key(ASCopy.rulesSearchPrompt)
                    )
                }
                bulkToolbar
                list
            }
        }
    }

    private var titleRow: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(localize.key(ASCopy.rulesTitle))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            ASFreshnessChip(connection: connection, localize: localize)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: rulesCountLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var rulesCountLabel: String {
        let count = viewModel.rules.count
        if count == 1 { return localize.string(ASCopy.rulesCountOne) }
        return localize.format(ASCopy.rulesCountMany, "count", String(count))
    }

    @ViewBuilder
    private var bulkToolbar: some View {
        if !viewModel.bulkSelected.isEmpty {
            TSBulkActionsToolbar(
                selectedCount: viewModel.bulkSelected.count,
                onClear: { viewModel.clearBulk() },
                actions: {
                    TSButton(localize.key(ASCopy.bulkEnable), variant: .ghost, size: .small) {
                        viewModel.bulkEnable()
                    }
                    TSButton(localize.key(ASCopy.bulkDisable), variant: .ghost, size: .small) {
                        viewModel.bulkDisable()
                    }
                }
            )
        }
    }

    @ViewBuilder
    private var list: some View {
        let rules = viewModel.filteredRules
        if rules.isEmpty {
            if viewModel.rules.isEmpty {
                TSEmptyState(
                    title: localize.key(ASCopy.rulesEmptyTitle),
                    message: localize.key(ASCopy.rulesEmptyDescription),
                    systemImage: "bell.badge"
                )
                .frame(maxWidth: .infinity)
            } else {
                TSEmptyState(
                    title: localize.key(ASCopy.rulesNoMatchesTitle),
                    message: localize.key(ASCopy.rulesNoMatches, "search", viewModel.ruleSearch),
                    systemImage: "magnifyingglass"
                )
                .frame(maxWidth: .infinity)
            }
        } else {
            VStack(spacing: TSSpacing.sm) {
                ForEach(rules) { rule in
                    ASRuleRow(viewModel: viewModel, rule: rule)
                }
            }
        }
    }
}

/// One rule row (web rule `GlassPanel`).
struct ASRuleRow: View {
    let viewModel: AlertStudioViewModel
    let rule: ASAlertRule

    private var localize: ASLocalizer {
        viewModel.localize
    }

    private var isActive: Bool {
        viewModel.selectedID == rule.id
    }

    private var isSnoozed: Bool {
        AlertStudioAdapter.isSnoozeActive(rule.snoozedUntil)
    }

    private var displayName: String {
        rule.name.isEmpty ? localize.string(ASCopy.untitled) : rule.name
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            selectionCheckbox
            ruleButton
            snoozeButton
            toggleButton
            deleteButton
        }
        .padding(TSSpacing.md)
        .background(
            isActive ? Color.TS.accent.opacity(0.06) : Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(isActive ? Color.TS.accent.opacity(0.3) : Color.TS.border, lineWidth: 1)
        )
    }

    private var selectionCheckbox: some View {
        Button {
            viewModel.toggleBulkSelected(rule.id, !viewModel.isBulkSelected(rule.id))
        } label: {
            Image(systemName: viewModel.isBulkSelected(rule.id) ? "checkmark.square.fill" : "square")
                .foregroundStyle(viewModel.isBulkSelected(rule.id) ? Color.TS.accent : Color.TS.textMuted)
                .imageScale(.large)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(localize.key(ASCopy.rulesSelectRow, "name", displayName)))
        .accessibilityAddTraits(viewModel.isBulkSelected(rule.id) ? [.isButton, .isSelected] : .isButton)
    }

    private var ruleButton: some View {
        Button {
            viewModel.requestSelectRule(rule)
        } label: {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: ASSeverityVisual.systemImage(rule.severity))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(ASSeverityVisual.tone(rule.severity).color)
                    Text(verbatim: displayName)
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                badgeRow
                metaRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text(localize.key(ASCopy.editorEditTitle)))
    }

    private var badgeRow: some View {
        HStack(spacing: TSSpacing.xs) {
            if rule.triggerMode == .once {
                TSBadge(localize.key(ASCopy.rulesOnceMode), tone: .info)
                    .accessibilityLabel(Text(localize.key(ASCopy.rulesOnceModeHint)))
            }
            if isSnoozed, let snoozedUntil = rule.snoozedUntil {
                let time = viewModel.dates.dateTime(snoozedUntil)
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "moon.stars.fill")
                    Text(localize.key(ASCopy.snoozeBadge, "time", time))
                }
                .font(Font.TS.caption)
                .foregroundStyle(TSTone.warning.color)
            }
        }
    }

    private var metaRow: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: "\(rule.signalName) \(rule.op.rawValue)")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.TS.textMuted)
            if let updatedAt = rule.updatedAt {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "clock")
                    Text(verbatim: viewModel.dates.dateTime(updatedAt))
                }
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private var snoozeButton: some View {
        let label = isSnoozed ? ASCopy.snoozeManage : ASCopy.snoozeButton
        return Button {
            viewModel.snoozeTargetID = rule.id
        } label: {
            Image(systemName: "moon.stars")
                .foregroundStyle(isSnoozed ? TSTone.warning.color : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(localize.key(label)))
    }

    private var toggleButton: some View {
        let label = rule.enabled ? ASCopy.rulesDisableRule : ASCopy.rulesEnableRule
        return Button {
            viewModel.toggleEnabled(rule)
        } label: {
            Image(systemName: rule.enabled ? "bell.fill" : "bell.slash.fill")
                .foregroundStyle(rule.enabled ? TSTone.success.color : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(localize.key(label)))
    }

    private var deleteButton: some View {
        Button {
            viewModel.requestDelete(rule)
        } label: {
            Image(systemName: "trash")
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(localize.key(ASCopy.rulesDeleteRule)))
    }
}
