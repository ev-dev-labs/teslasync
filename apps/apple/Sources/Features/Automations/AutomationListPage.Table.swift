import SwiftUI

/// The adaptive automations table for `AutomationListPage` (web `<table>` inside the `GlassPanel`):
/// a columnar grid on macOS / iPad regular width and per-row cards on compact iPhone. Reproduces
/// the web header (a select-all checkbox + Name / Description / Runs / Status columns) and
/// each row (a per-row checkbox, the name as a navigable link, the description, the run count, and
/// the enabled / disabled status badge). Kept as a dedicated surface (mirroring the sibling table
/// pages) so the page file stays focused on chrome + states. All copy resolves from
/// `Localizable.xcstrings`.
struct AutomationListTable: View {
    let model: AutomationListPageModel
    let onOpenAutomation: (Int64) -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        if isCompact {
            VStack(spacing: TSSpacing.sm) {
                compactSelectAllRow
                ForEach(model.items) { rowCard($0) }
            }
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.sm) {
            GridRow {
                selectAllCheckbox
                header("automationList.col.name")
                header("automationList.col.desc")
                header("automationList.col.runs")
                header("automationList.col.status")
            }
            Divider().overlay(Color.TS.border).gridCellColumns(5)
            ForEach(model.items) { item in
                GridRow {
                    rowCheckbox(item)
                    nameLink(item)
                    Text(verbatim: item.descriptionText)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                    Text(verbatim: item.runsText)
                        .font(Font.TS.bodySm)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textSecondary)
                    statusBadge(item)
                }
                .accessibilityElement(children: .contain)
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(5)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: - Compact (iPhone) cards

    private var compactSelectAllRow: some View {
        HStack(spacing: TSSpacing.sm) {
            selectAllCheckbox
            Text("bulk.selectAll")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
    }

    private func rowCard(_ item: AutomationListItem) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    rowCheckbox(item)
                    nameLink(item)
                    Spacer(minLength: TSSpacing.sm)
                    statusBadge(item)
                }
                Text(verbatim: item.descriptionText)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: TSSpacing.xs) {
                    Text("automationList.col.runs")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    Text(verbatim: item.runsText)
                        .font(Font.TS.bodySm)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: - Shared cells

    private var selectAllCheckbox: some View {
        Button {
            model.toggleAll()
        } label: {
            Image(systemName: Self.selectAllGlyph(model.selectAllState))
                .foregroundStyle(model.selectAllState == .none ? Color.TS.textMuted : Color.TS.accent)
                .imageScale(.large)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("bulk.selectAll"))
        .accessibilityAddTraits(model.selectAllState == .all ? [.isButton, .isSelected] : .isButton)
    }

    private func rowCheckbox(_ item: AutomationListItem) -> some View {
        let isSelected = model.isSelected(item.id)
        return Button {
            model.toggle(item.id)
        } label: {
            Image(systemName: isSelected ? "checkmark.square.fill" : "square")
                .foregroundStyle(isSelected ? Color.TS.accent : Color.TS.textMuted)
                .imageScale(.large)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: selectLabel(for: item)))
        .accessibilityHint(Text("bulk.selectRow"))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private func nameLink(_ item: AutomationListItem) -> some View {
        Button {
            onOpenAutomation(item.id)
        } label: {
            Text(verbatim: item.name)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.accent)
                .underline()
                .multilineTextAlignment(.leading)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
    }

    private func statusBadge(_ item: AutomationListItem) -> some View {
        TSBadge(item.rowStatus.labelKey, tone: item.enabled ? .success : .neutral)
    }

    /// Web `aria-label={t('automationList.selectAutomation', '…{{name}}', { name })}`.
    private func selectLabel(for item: AutomationListItem) -> String {
        String(format: String(localized: "automationList.selectAutomation"), item.name)
    }

    /// Select-all checkbox glyph for the tri-state (web indeterminate / checked / empty).
    static func selectAllGlyph(_ state: AutomationSelectAllState) -> String {
        switch state {
        case .all: "checkmark.square.fill"
        case .some: "minus.square.fill"
        case .none: "square"
        }
    }
}
