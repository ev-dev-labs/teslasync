//
//  DrivingDynamicsPage.Coach.Detail.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple) — Driving coach (2/2)
//
//  The remaining driving-coach panels (web `DrivingCoachSection`): the behavior
//  pattern bars with their threshold-colored readouts, the impact-tagged
//  recommendation list, and the sortable per-drive score table. Each renders its
//  own empty state. Coach efficiency (Wh/km) + distance (km) are already
//  display-shaped by the `/analytics/driving-coach` endpoint, so they render
//  verbatim (no SI conversion), exactly like the web section.
//

import SwiftUI

// MARK: - Pattern indicators (web pattern panel)

struct DDynCoachPatternsCard: View {
    let coach: DDynCoachData?

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingPanelHeading(text: DDynStrings.text("dynamics.coach.patterns", "Driving Patterns"))
                ForEach(rows) { row in
                    patternRow(row)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func patternRow(_ row: DDynPatternRow) -> some View {
        VStack(spacing: TSSpacing.xs) {
            HStack {
                Text(verbatim: row.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer()
                Text(verbatim: DDynFormat.percent(row.value, fractionDigits: 1))
                    .font(Font.TS.caption)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(row.tone.color)
            }
            TSMetricBar(fraction: min(row.value / 100, 1), tone: row.tone)
        }
        .accessibilityElement(children: .combine)
    }

    private var rows: [DDynPatternRow] {
        let patterns = coach?.patterns
        return [
            DDynPatternRow(
                id: "hardAccel",
                label: DDynStrings.text("dynamics.coach.hardAccel", "Hard Acceleration"),
                value: patterns?.hardAccelPct ?? 0, low: 20, high: 40
            ),
            DDynPatternRow(
                id: "hardBrake",
                label: DDynStrings.text("dynamics.coach.hardBrake", "Hard Braking"),
                value: patterns?.hardBrakePct ?? 0, low: 15, high: 30
            ),
            DDynPatternRow(
                id: "highway",
                label: DDynStrings.text("dynamics.coach.highway", "Highway Driving"),
                value: patterns?.highwayPct ?? 0, low: 50, high: 70
            ),
            DDynPatternRow(
                id: "shortTrips",
                label: DDynStrings.text("dynamics.coach.shortTrips", "Short Trips (<5 km)"),
                value: patterns?.shortTripPct ?? 0, low: 30, high: 50
            ),
            DDynPatternRow(
                id: "coldStarts",
                label: DDynStrings.text("dynamics.coach.coldStarts", "Cold Starts"),
                value: patterns?.coldStartPct ?? 0, low: 15, high: 30
            )
        ]
    }
}

/// One driving-pattern readout with its threshold-derived tone.
struct DDynPatternRow: Identifiable {
    let id: String
    let label: String
    let value: Double
    let low: Double
    let high: Double

    var tone: TSTone {
        if value <= low { return .success }
        if value <= high { return .warning }
        return .danger
    }
}

// MARK: - Recommendations (web recommendations panel)

struct DDynCoachRecommendationsCard: View {
    let coach: DDynCoachData?

    private var recommendations: [CoachRecommendation] { coach?.recommendations ?? [] }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingPanelHeading(
                    text: DDynStrings.text("dynamics.coach.recommendations", "Recommendations"),
                    systemImage: "lightbulb.fill",
                    tone: .warning
                )
                if recommendations.isEmpty {
                    TSEmptyState(
                        title: "common.noData",
                        message: DDynStrings.key("dynamics.coach.noRecs"),
                        systemImage: "lightbulb"
                    )
                    .frame(maxWidth: .infinity)
                } else {
                    ForEach(recommendations) { recommendation in
                        recommendationRow(recommendation)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func recommendationRow(_ recommendation: CoachRecommendation) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            DDynValueBadge(text: impactLabel(recommendation.impact), tone: impactTone(recommendation.impact))
            Text(verbatim: recommendation.tip)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func impactLabel(_ impact: DDynCoachImpact) -> String {
        switch impact {
        case .high: DDynStrings.text("dynamics.coach.impactHigh", "high")
        case .medium: DDynStrings.text("dynamics.coach.impactMedium", "medium")
        case .low: DDynStrings.text("dynamics.coach.impactLow", "low")
        }
    }

    private func impactTone(_ impact: DDynCoachImpact) -> TSTone {
        switch impact {
        case .high: .danger
        case .medium: .warning
        case .low: .success
        }
    }
}

// MARK: - Per-drive scores table (web DataTable)

struct DDynCoachTableCard: View {
    let coach: DDynCoachData?

    private var scores: [CoachDriveScore] { coach?.perDriveScores ?? [] }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingPanelHeading(text: DDynStrings.text("dynamics.coach.perDriveScores", "Per-Drive Scores"))
                if scores.isEmpty {
                    TSEmptyState(
                        title: "common.noData",
                        message: DDynStrings.key("dynamics.coach.noDrives"),
                        systemImage: "list.bullet.rectangle"
                    )
                    .frame(maxWidth: .infinity)
                } else {
                    TSDataTable(rows: scores, columns: columns, density: .compact)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var columns: [TSColumn<CoachDriveScore>] {
        [
            TSColumn(id: "date", title: DDynStrings.key("dynamics.coach.colDate"), comparator: { lhs, rhs in compare(lhs.date, rhs.date) }) { row in
                Text(verbatim: row.date.formatted(date: .abbreviated, time: .omitted))
            },
            TSColumn(id: "score", title: DDynStrings.key("dynamics.coach.colScore"), comparator: { lhs, rhs in compare(lhs.score, rhs.score) }) { row in
                DDynValueBadge(text: DDynFormat.number(row.score, fractionDigits: 0),
                               tone: DDynCoachStyle.scoreTone(row.score))
            },
            TSColumn(id: "style", title: DDynStrings.key("dynamics.coach.colStyle")) { row in
                DDynValueBadge(text: DDynStrings.styleLabel(row.style),
                               tone: DDynCoachStyle.tone(for: row.style))
            },
            TSColumn(id: "efficiency", title: DDynStrings.key("dynamics.coach.colEfficiency"), comparator: { lhs, rhs in compare(lhs.efficiency, rhs.efficiency) }) { row in
                Text(verbatim: DDynFormat.number(row.efficiency, fractionDigits: 1))
            },
            TSColumn(id: "distance", title: DDynStrings.key("dynamics.coach.colDistance"), comparator: { lhs, rhs in compare(lhs.distance, rhs.distance) }) { row in
                Text(verbatim: "\(DDynFormat.number(row.distance, fractionDigits: 1)) km")
            }
        ]
    }

    private func compare(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        if lhs == rhs { return .orderedSame }
        return lhs < rhs ? .orderedAscending : .orderedDescending
    }

    private func compare(_ lhs: Date, _ rhs: Date) -> ComparisonResult {
        compare(lhs.timeIntervalSince1970, rhs.timeIntervalSince1970)
    }
}
