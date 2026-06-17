//
//  SafetySettingsHistoryTable.swift
//  TeslaSync — P4 feature view · P7 · vehicle-systems/SafetySettings (Apple) — History table
//
//  The history table panel (web GlassPanel 14 / `DataTable`): a header row (Time,
//  AEB, BSC, BSCW, FCW, LDA, ELDA, CFD, SLW, PIN) over the newest-first snapshot
//  rows. The five boolean columns (AEB / BSC / BSCW / ELDA / PIN) render an On/Off
//  badge; the four enum columns (FCW / LDA / CFD / SLW) render the prefix-stripped
//  level text. An empty window shows a `ContentUnavailableView` — never a blank
//  region.
//

import SwiftUI

// MARK: - GlassPanel 14 — Safety Settings history table

struct SafetySettingsHistoryTable: View {
    let rows: [SafetySnapshot]

    var body: some View {
        SafetyPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                SafetySectionTitle(text: safetyText("Safety Settings History"))

                if rows.isEmpty {
                    emptyState
                } else {
                    ScrollView(.horizontal, showsIndicators: true) {
                        table
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Table grid

    private var table: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
            GridRow {
                headerCell(safetyText("Time"))
                headerCell(safetyText("AEB"))
                headerCell(safetyText("BSC"))
                headerCell(safetyText("BSCW"))
                headerCell(safetyText("FCW"))
                headerCell(safetyText("LDA"))
                headerCell(safetyText("ELDA"))
                headerCell(safetyText("CFD"))
                headerCell(safetyText("SLW"))
                headerCell(safetyText("PIN"))
            }
            Divider().gridCellColumns(10)
            ForEach(rows) { row in
                GridRow {
                    Text(SafetyFormat.dateTime(row.createdAt))
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                    boolCell(AdasEnum.isAebEnabled(row.automaticEmergencyBrakingOff ?? false))
                    boolCell(row.automaticBlindSpotCamera ?? false)
                    boolCell(row.blindSpotCollisionWarning ?? false)
                    enumCell(row.forwardCollisionWarning, field: .forwardCollisionWarning)
                    enumCell(row.laneDepartureAvoidance, field: .laneDepartureAvoidance)
                    boolCell(row.emergencyLaneDepartureAvoidance ?? false)
                    enumCell(row.cruiseFollowDistance, field: .cruiseFollowDistance)
                    enumCell(row.speedLimitWarning, field: .speedLimitWarning)
                    boolCell(row.pinToDriveEnabled ?? false)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.vertical, TSSpacing.xs)
    }

    private func headerCell(_ text: String) -> some View {
        Text(text)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Color.TS.textMuted)
    }

    /// Web `boolCell` — an On/Off success/danger badge.
    private func boolCell(_ value: Bool) -> some View {
        SafetyBadge(
            text: value
                ? safetyText("On")
                : safetyText("Off"),
            tone: value ? .success : .danger
        )
    }

    /// Web enum column — the prefix-stripped level text.
    private func enumCell(_ value: AdasEnumValue, field: AdasEnumField) -> some View {
        Text(AdasEnum.clean(value, field: field))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
    }

    // MARK: Empty

    private var emptyState: some View {
        ContentUnavailableView(
            safetyText("No history records found."),
            systemImage: "clock.badge.questionmark"
        )
        .frame(maxWidth: .infinity)
    }
}
