//
//  ImportPreviewModal.PreviewScreen.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  The preview screen for `ImportPreviewModal` — the SwiftUI parity of the web `ImportPreview`
//  sub-component. It renders, in order: the validation errors banner (web danger `AlertBanner`), the
//  warnings banner (web warning `AlertBanner`), then either the dashboard summary (the embedded
//  mini-grid thumbnail + the dashboard name + the count chips) plus the widget-availability list, or
//  the "Cannot preview this layout" empty state, and finally the actions row (Back, and Import when
//  the import is valid). All copy resolves through the P1/S10 facade; all chrome is token-driven.
//

import SwiftUI

// MARK: - Preview screen (web `<ImportPreview>`)

/// The populated preview screen, bound through `ImportPreviewModalModel`.
struct ImportPreviewPreviewScreen: View {
    let model: ImportPreviewModalModel
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if !model.errors.isEmpty {
                ImportPreviewBanner(tone: .danger, systemImage: "xmark.circle.fill", messages: model.errors)
            }
            if !model.warnings.isEmpty {
                ImportPreviewBanner(
                    tone: .warning,
                    systemImage: "exclamationmark.triangle.fill",
                    messages: model.warnings
                )
            }
            if let dashboard = model.dashboard, let grid = model.grid {
                TSFadeIn {
                    VStack(alignment: .leading, spacing: TSSpacing.lg) {
                        ImportPreviewSummary(
                            dashboard: dashboard,
                            grid: grid,
                            badges: model.badges,
                            localize: model.localize
                        )
                        ImportPreviewWidgetList(rows: model.widgetRows, localize: model.localize)
                    }
                }
            } else {
                ImportPreviewEmptyState(
                    message: model.localize("import.cannotPreview", "Cannot preview this layout")
                )
            }
            ImportPreviewActions(model: model, onClose: onClose)
        }
    }
}

// MARK: - Summary (web mini-grid + name + badges)

/// The dashboard summary row: the mini-grid thumbnail (web `<MiniGridPreview>`), the dashboard name,
/// and the count chips.
struct ImportPreviewSummary: View {
    let dashboard: ImportPreviewDashboard
    let grid: ImportPreviewGrid
    let badges: [ImportPreviewBadge]
    let localize: (String, String) -> String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            ImportPreviewMiniGrid(grid: grid, localize: localize)
                .frame(width: 140)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: dashboard.name)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                ImportPreviewBadgeRow(badges: badges)
            }
            Spacer(minLength: 0)
        }
    }
}

/// The count chips above the widget list (web neutral `<Badge>`s).
struct ImportPreviewBadgeRow: View {
    let badges: [ImportPreviewBadge]

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ForEach(badges) { badge in
                Text(verbatim: badge.text)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .padding(.horizontal, TSSpacing.sm)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.textMuted.opacity(0.12), in: Capsule())
                    .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            }
        }
    }
}

// MARK: - Widget list (web "Widgets" header + availability rows)

/// The widget-availability list (web `Widgets` label + available/missing rows).
struct ImportPreviewWidgetList: View {
    let rows: [ImportPreviewWidgetRow]
    let localize: (String, String) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: localize("import.widgets", "Widgets"))
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textSecondary)
            ForEach(rows) { row in
                ImportPreviewWidgetRowView(row: row, localize: localize)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Actions (web Back + Import)

/// The footer actions: a Back button (web ghost) and the Import button (web primary, shown only when
/// the import is valid).
struct ImportPreviewActions: View {
    let model: ImportPreviewModalModel
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .ghost, size: .small, action: model.back) {
                Text(verbatim: model.localize("import.back", "Back"))
            }
            if model.canConfirm {
                TSButton(variant: .primary, size: .small, action: confirm) {
                    HStack(spacing: TSSpacing.xs) {
                        Image(systemName: "checkmark.circle.fill").font(.system(size: 12, weight: .semibold))
                        Text(verbatim: model.localize("import.confirm", "Import Dashboard"))
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.top, TSSpacing.xs)
    }

    private func confirm() {
        if model.confirm() { onClose() }
    }
}
