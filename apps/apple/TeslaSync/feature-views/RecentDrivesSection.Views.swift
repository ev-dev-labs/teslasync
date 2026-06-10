//
//  RecentDrivesSection.Views.swift
//  TeslaSync — P4 feature view · 0297 · RecentDrivesSection (Apple)
//
//  The populated content for `RecentDrivesSection`: the always-on header (route glyph, title,
//  freshness chip, and the "View all" link), and the table body — the inline reload error, the
//  four-column grid (Date / Distance / Duration / Battery) with the sortable Distance header,
//  and the pagination bar. All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). No networking and no web Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (web Route icon + "Recent Drives" + "View all" link)

/// The section header: the route glyph chip, the title + freshness chip, and the trailing
/// "View all" link (web header row).
struct RecentDrivesHeader: View {
    @Bindable var model: RecentDrivesModel

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                RecentDrivesStrings.text("common.recentDrives", "Recent Drives")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                RecentDrivesFreshnessChip(connection: model.connection)
            }
            Spacer(minLength: TSSpacing.sm)
            RecentDrivesViewAllButton(model: model)
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - View all link (web `<Link to="/drives">`)

/// The trailing "View all" link that routes to the full drives list (web `<Link to="/drives">`
/// with a chevron), driving the model's navigation seam.
struct RecentDrivesViewAllButton: View {
    @Bindable var model: RecentDrivesModel

    var body: some View {
        Button { model.viewAll() } label: {
            HStack(spacing: TSSpacing.xs) {
                RecentDrivesStrings.text("common.viewAll", "View all")
                    .font(Font.TS.caption)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(RecentDrivesStrings.text("recentDrives.viewAllAria", "View all drives"))
    }
}

// MARK: - Content (web populated `DataTable` body)

/// The populated body shown for `.content`: the inline reload error (when a refresh failed
/// while rows remain), the four-column table, and the pagination bar.
struct RecentDrivesContent: View {
    @Bindable var model: RecentDrivesModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if let message = model.inlineErrorMessage {
                RecentDrivesInlineError(message: message)
            }
            RecentDrivesTable(model: model)
            if model.hasPagination {
                RecentDrivesPaginationBar(model: model)
            }
        }
    }
}

// MARK: - Table (web `DataTable`)

/// The four-column grid (web `DataTable`): a header row with the sortable Distance column, then
/// the current page's drive rows, column-aligned via `Grid`.
struct RecentDrivesTable: View {
    @Bindable var model: RecentDrivesModel

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.sm) {
            GridRow {
                RecentDrivesHeaderCell(titleKey: "common.date", fallback: "Date")
                RecentDrivesSortableDistanceHeader(model: model)
                RecentDrivesHeaderCell(titleKey: "common.duration", fallback: "Duration")
                RecentDrivesHeaderCell(titleKey: "common.battery", fallback: "Battery")
            }
            Divider().overlay(Color.TS.border).gridCellColumns(4)
            ForEach(model.displayRows) { row in
                GridRow {
                    RecentDrivesValueCell(text: row.date, isPrimary: true)
                    RecentDrivesValueCell(text: row.distance)
                    RecentDrivesValueCell(text: row.duration)
                    RecentDrivesValueCell(text: row.battery)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: rowLabel(row)))
            }
        }
    }

    private func rowLabel(_ row: RecentDriveDisplay) -> String {
        RecentDrivesAccessibility.rowLabel(row, localize: model.localize)
    }
}

// MARK: - Header cells

/// A plain (non-sortable) column header label (web `DataTable` header cell).
struct RecentDrivesHeaderCell: View {
    let titleKey: String
    let fallback: String

    var body: some View {
        RecentDrivesStrings.text(titleKey, fallback)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The sortable Distance header (web `DataTable` `sortable` column): tapping toggles the sort
/// and shows the active direction with a chevron, mirroring the web `aria-sort` affordance.
struct RecentDrivesSortableDistanceHeader: View {
    @Bindable var model: RecentDrivesModel

    var body: some View {
        Button { model.toggleDistanceSort() } label: {
            HStack(spacing: TSSpacing.xs) {
                RecentDrivesStrings.text("common.distance", "Distance")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                Image(systemName: sortGlyph)
                    .font(.system(size: 9, weight: .bold))
                    .opacity(model.sort.isActive ? 1 : 0.35)
            }
            .foregroundStyle(model.sort.isActive ? Color.TS.accent : Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(RecentDrivesStrings.text("recentDrives.sortAria", "Sort by distance"))
        .accessibilityValue(Text(verbatim: sortStateDescription))
    }

    private var sortGlyph: String {
        switch model.sort {
        case .unsorted, .distanceAscending: "chevron.up"
        case .distanceDescending: "chevron.down"
        }
    }

    private var sortStateDescription: String {
        switch model.sort {
        case .unsorted: RecentDrivesStrings.string("recentDrives.sortNone", "Not sorted")
        case .distanceAscending: RecentDrivesStrings.string("recentDrives.sortAsc", "Ascending")
        case .distanceDescending: RecentDrivesStrings.string("recentDrives.sortDesc", "Descending")
        }
    }
}

// MARK: - Value cell

/// One table cell value (web `DataTable` cell). The primary (Date) cell reads as body text; the
/// numeric cells use monospaced digits so the columns stay vertically aligned.
struct RecentDrivesValueCell: View {
    let text: String
    var isPrimary = false

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.bodySm)
            .foregroundStyle(isPrimary ? Color.TS.textPrimary : Color.TS.textSecondary)
            .monospacedDigit()
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityHidden(true)
    }
}

// MARK: - Pagination (web `DataTable` pagination)

/// The pagination bar shown when the list spans more than one page (web `DataTable` pagination):
/// previous / next steppers around the "Page X of Y" status.
struct RecentDrivesPaginationBar: View {
    @Bindable var model: RecentDrivesModel

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            pageButton(
                glyph: "chevron.left",
                ariaKey: "recentDrives.pagination.prev",
                ariaFallback: "Previous page",
                enabled: model.canGoToPreviousPage
            ) { model.previousPage() }

            Text(verbatim: statusText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
                .frame(maxWidth: .infinity)

            pageButton(
                glyph: "chevron.right",
                ariaKey: "recentDrives.pagination.next",
                ariaFallback: "Next page",
                enabled: model.canGoToNextPage
            ) { model.nextPage() }
        }
        .accessibilityElement(children: .contain)
    }

    private var statusText: String {
        RecentDrivesStrings.format(
            "recentDrives.pagination.status",
            "Page {{0}} of {{1}}",
            ["\(model.page)", "\(model.pageCount)"]
        )
    }

    private func pageButton(
        glyph: String,
        ariaKey: String,
        ariaFallback: String,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: glyph)
                .font(.system(size: 12, weight: .semibold))
                .frame(width: 32, height: 28)
                .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
                .foregroundStyle(enabled ? Color.TS.textSecondary : Color.TS.textMuted.opacity(0.5))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(RecentDrivesStrings.text(ariaKey, ariaFallback))
    }
}

// MARK: - Localization Text helper

extension RecentDrivesStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are
    /// never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
