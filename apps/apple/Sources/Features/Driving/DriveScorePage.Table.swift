import SwiftUI

// The drive-history table for the Drive Score surface (web Section 7 — GlassPanel15 + the sortable,
// paginated 8-column grid). Split from `DriveScorePage.Sections.swift` to keep each file focused.
// Distances / speeds / consumption format through the shared `Units` facade at this render boundary
// (ADR-005); the panel renders its own empty state (never a blank region).

// MARK: - Drive history (web Section 7 — GlassPanel15)

/// The drive-history panel (web GlassPanel15): a header plus a horizontally-scrollable, sortable,
/// paginated grid (Date / Route / Distance / Duration / Consumption / Score / Grade / breakdown), or
/// the no-drives empty when the current page is empty.
struct DriveScoreHistorySection: View {
    let model: DriveScorePageModel
    let units: UnitPreferences

    private let minTableWidth: CGFloat = 760

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSCardHeader("driveScore.driveHistory")
                ScrollView(.horizontal, showsIndicators: true) {
                    Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.sm) {
                        headerRow
                        Divider().overlay(Color.TS.border).gridCellColumns(8)
                        ForEach(model.paginatedDrives) { scored in
                            row(scored)
                            Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(8)
                        }
                    }
                    .frame(minWidth: minTableWidth, alignment: .leading)
                    .padding(.vertical, TSSpacing.xs)
                }
                if model.paginatedDrives.isEmpty {
                    Text("driveScore.noDrives")
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, TSSpacing.lg)
                }
                if model.totalPages > 1 {
                    TSPagination(currentPage: pageBinding, pageCount: model.totalPages)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var pageBinding: Binding<Int> {
        Binding(
            get: { model.currentPage },
            set: { model.goToPage($0) }
        )
    }

    // MARK: Header (web sortable + static column headers)

    private var headerRow: some View {
        GridRow {
            DriveScoreSortHeader(title: "driveScore.colDate", field: .date, model: model)
            headerLabel("driveScore.colRoute")
            DriveScoreSortHeader(title: "driveScore.colDistance", field: .distance, model: model)
            headerLabel("driveScore.colDuration")
            headerLabel("driveScore.colConsumption")
            DriveScoreSortHeader(title: "driveScore.colScore", field: .score, model: model)
            headerLabel("driveScore.colGrade")
            DriveScoreSortHeader(title: "driveScore.colEfficiency", field: .efficiency, model: model)
        }
    }

    private func headerLabel(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textMuted)
    }

    // MARK: Row (web table body cells)

    private func row(_ scored: ScoredDrive) -> some View {
        GridRow {
            Text(verbatim: DriveScoreFormat.dateShort(scored.drive.startTs))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Text(verbatim: scored.drive.routeLabel ?? String(localized: "driveScore.unknownRoute"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Text(verbatim: DriveScoreFormat.distance(scored.drive.distanceM, units))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: DriveScoreFormat.durationSeconds(scored.drive.durationS))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: DriveScoreFormat.efficiency(scored.score.whPerKm, units))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: "\(scored.score.total)/100")
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(scored.score.grade.tone.color)
            TSBadge(LocalizedStringKey(scored.score.grade.label), tone: scored.score.grade.tone)
            Text(verbatim: "\(scored.score.efficiency)/\(scored.score.smoothness)/\(scored.score.speed)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Sortable header (web `SortHeader`)

/// A sortable column header (web `SortHeader`): a ghost button that toggles the sort field/direction
/// and shows the active direction chevron.
struct DriveScoreSortHeader: View {
    let title: LocalizedStringKey
    let field: DriveSortField
    let model: DriveScorePageModel

    private var isActive: Bool {
        model.sortField == field
    }

    var body: some View {
        TSButton(variant: .ghost, size: .small) {
            model.sort(by: field)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Text(title)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                if isActive {
                    Image(systemName: model.sortDirection == .ascending ? "chevron.up" : "chevron.down")
                        .font(.system(size: 9))
                }
            }
        }
        .accessibilityLabel(Text(title))
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }
}
