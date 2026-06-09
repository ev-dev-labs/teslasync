//
//  DrivingCoachSection.Tables.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  The list + table panels composed by `DrivingCoachSection`: the recommendations list (web impact-badge
//  rows) and the per-drive score table (web `DataTable` → shared `TSDataTable`). Split out of
//  DrivingCoachSection.Views.swift to keep each file within the 400-line budget. The shared chrome (panel
//  heading, inner empty, band → token mapping, dynamic enum labels) lives in DrivingCoachSection.Views.swift.
//

import SwiftUI

// MARK: - Recommendations (web impact-badge list)

/// The "Recommendations" panel: the impact-badge + tip rows (web `recommendations.map`), or the friendly
/// inner empty state when there are none.
struct DrivingCoachRecommendationsPanel: View {
    let rows: [DrivingCoachRecommendationRow]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingCoachPanelHeading(
                    key: "dynamics.coach.recommendations",
                    fallback: "Recommendations",
                    systemImage: "lightbulb.fill",
                    tint: .TS.statusWarning
                )
                if rows.isEmpty {
                    DrivingCoachInnerEmpty(
                        key: "dynamics.coach.noRecs",
                        fallback: "Recommendations will appear after more drives."
                    )
                } else {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        ForEach(rows) { row in
                            DrivingCoachRecommendationRowView(row: row)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// One recommendation row: the impact badge over a tinted card with the tip copy.
struct DrivingCoachRecommendationRowView: View {
    let row: DrivingCoachRecommendationRow

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSBadge(LocalizedStringKey(DrivingCoachLabels.impact(row.impact)), tone: row.band.tone)
            Text(verbatim: row.tip)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(DrivingCoachLabels.impact(row.impact)). \(row.tip)"))
    }
}

// MARK: - Per-drive scores (web `DataTable`)

/// The "Per-Drive Scores" panel: the shared `TSDataTable` carrying the five web columns (date · score badge
/// · style badge · Wh/km · distance), or the friendly inner empty state when no drives are scored yet.
struct DrivingCoachPerDrivePanel: View {
    let rows: [DrivingCoachDriveRow]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingCoachPanelHeading(key: "dynamics.coach.perDriveScores", fallback: "Per-Drive Scores")
                if rows.isEmpty {
                    DrivingCoachInnerEmpty(
                        key: "dynamics.coach.emptyHint",
                        fallback: "Drive data will appear after your first trip."
                    )
                } else {
                    TSDataTable(rows: rows, columns: columns, density: .compact)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var columns: [TSColumn<DrivingCoachDriveRow>] {
        [dateColumn, scoreColumn, styleColumn, efficiencyColumn, distanceColumn]
    }

    private func title(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(DrivingCoachSectionStrings.string(key, fallback))
    }

    private var dateColumn: TSColumn<DrivingCoachDriveRow> {
        TSColumn(
            id: "date",
            title: title("dynamics.coach.col.date", "Date"),
            comparator: { compare($0.dateSortValue, $1.dateSortValue) },
            cell: { row in
                Text(verbatim: row.dateText)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textSecondary)
            }
        )
    }

    private var scoreColumn: TSColumn<DrivingCoachDriveRow> {
        TSColumn(
            id: "score",
            title: title("dynamics.coach.col.score", "Score"),
            comparator: { compare($0.score, $1.score) },
            cell: { row in
                TSBadge(LocalizedStringKey(row.scoreText), tone: row.scoreBand.tone)
            }
        )
    }

    private var styleColumn: TSColumn<DrivingCoachDriveRow> {
        TSColumn(
            id: "style",
            title: title("dynamics.coach.col.style", "Style"),
            comparator: { $0.style.rawValue.localizedCompare($1.style.rawValue) },
            cell: { row in
                TSBadge(LocalizedStringKey(DrivingCoachLabels.style(row.style)), tone: row.styleBand.tone)
            }
        )
    }

    private var efficiencyColumn: TSColumn<DrivingCoachDriveRow> {
        TSColumn(
            id: "efficiency",
            title: title("dynamics.coach.col.efficiency", "Wh/km"),
            comparator: { compare($0.efficiency, $1.efficiency) },
            cell: { row in
                Text(verbatim: row.efficiencyText)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        )
    }

    private var distanceColumn: TSColumn<DrivingCoachDriveRow> {
        TSColumn(
            id: "distance",
            title: title("dynamics.coach.col.distance", "Distance"),
            comparator: { compare($0.distance, $1.distance) },
            cell: { row in
                Text(verbatim: row.distanceText)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        )
    }

    private func compare(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        if lhs < rhs { return .orderedAscending }
        if lhs > rhs { return .orderedDescending }
        return .orderedSame
    }
}
