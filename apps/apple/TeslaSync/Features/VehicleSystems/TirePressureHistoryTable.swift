//
//  TirePressureHistoryTable.swift
//  TeslaSync — P4 feature view · P7 · TirePressure (Apple) — History table
//
//  The history table panel (web GlassPanel 9 / `DataTable`): a header row (Time,
//  the four corner columns suffixed with the display unit, Warnings) over the
//  newest-first reading rows. Each corner cell is a status-tinted badge whose
//  magnitude sorts by Pa (web Badge-wrapped numeric); the Warnings cell shows the
//  Hard / Soft / Ok badge. Loading shows a redacted skeleton; an empty window
//  shows a `ContentUnavailableView` — never a blank region.
//

import SwiftUI

// MARK: - GlassPanel 9 — history table

struct TirePressureHistoryTable: View {
    let rows: [TirePressureReading]
    let unit: TirePressureUnit
    let isLoading: Bool

    var body: some View {
        TirePressureCard {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TirePressureSectionHeader(
                    systemImage: "clock.arrow.circlepath",
                    title: String(localized: "translation.History Table", defaultValue: "History Table")
                )

                if isLoading {
                    tableSkeleton
                } else if rows.isEmpty {
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
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.xl, verticalSpacing: TSSpacing.sm) {
            GridRow {
                headerCell(String(localized: "translation.Time", defaultValue: "Time"))
                ForEach(TirePosition.allCases) { position in
                    headerCell("\(position.label) (\(unit.label))")
                }
                headerCell(String(localized: "translation.Warnings", defaultValue: "Warnings"))
            }
            Divider().gridCellColumns(TirePosition.allCases.count + 2)
            ForEach(rows) { row in
                GridRow {
                    Text(TirePressureFormat.dateTime(row.createdAt))
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                    ForEach(TirePosition.allCases) { position in
                        pressureCell(row, position: position)
                    }
                    warningsCell(row)
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

    private func pressureCell(_ row: TirePressureReading, position: TirePosition) -> some View {
        let pascals = row.pascals(for: position)
        let status = TirePressureMath.status(forPascals: pascals)
        let display = TirePressureConvert.fromPascals(pascals, to: unit)
        return TirePressureStatusBadge(text: TirePressureFormat.number(display), tone: status.tone)
    }

    @ViewBuilder
    private func warningsCell(_ row: TirePressureReading) -> some View {
        if TirePressureMath.hasWarning(row.tpmsHardWarnings) {
            TirePressureStatusBadge(
                text: String(localized: "translation.Hard Warning", defaultValue: "Hard Warning"),
                tone: .danger,
                showsDot: true
            )
        } else if TirePressureMath.hasWarning(row.tpmsSoftWarnings) {
            TirePressureStatusBadge(
                text: String(localized: "translation.Soft Warning", defaultValue: "Soft Warning"),
                tone: .warning,
                showsDot: true
            )
        } else {
            TirePressureStatusBadge(
                text: String(localized: "translation.Ok", defaultValue: "Ok"),
                tone: .success
            )
        }
    }

    // MARK: Empty + loading

    private var emptyState: some View {
        ContentUnavailableView(
            String(localized: "translation.No History Data", defaultValue: "No History Data"),
            systemImage: "clock.badge.questionmark"
        )
        .frame(maxWidth: .infinity)
    }

    private var tableSkeleton: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 5, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.sm)
                    .fill(Color.TS.surface)
                    .frame(height: 28)
            }
        }
        .redacted(reason: .placeholder) // parity:allow native shimmer for the table loading state
    }
}
