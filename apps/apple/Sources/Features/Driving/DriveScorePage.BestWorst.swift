import SwiftUI

// The best/worst drive cards for the Drive Score surface (web Section 6b — GlassPanel13/14). Split
// from `DriveScorePage.Sections.swift` to keep each file within the length budget. Values format
// from raw SI via `DriveScoreFormat` at this display boundary; each card renders its own
// no-drives empty (never a blank region).

/// The best/worst drive row (web GlassPanel13 + GlassPanel14): two cards, each a small `RadialGauge`,
/// the drive's date + grade, distance / duration / consumption, and an insight note.
struct DriveScoreBestWorstSection: View {
    let model: DriveScorePageModel
    let units: UnitPreferences
    let isCompact: Bool

    private var columns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: 2)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            DriveScoreBestDriveCard(drive: model.bestDrive, units: units)
            DriveScoreWorstDriveCard(drive: model.worstDrive, units: units)
        }
    }
}

/// The best-drive card (web GlassPanel13): a green gauge + the winning drive's stats + insight, or
/// the no-drives empty.
struct DriveScoreBestDriveCard: View {
    let drive: ScoredDrive?
    let units: UnitPreferences

    var body: some View {
        DriveScoreHighlightCard(
            titleKey: "driveScore.bestDrive",
            headerIcon: "star.fill",
            headerTone: .success,
            gaugeColorIndex: 2,
            drive: drive,
            units: units,
            insightKey: drive.map { DriveScoreEngine.bestDriveTipKey($0.score) },
            insightTone: .success
        )
    }
}

/// The worst-drive card (web GlassPanel14): a red gauge + the worst drive's stats + insight, or the
/// no-drives empty.
struct DriveScoreWorstDriveCard: View {
    let drive: ScoredDrive?
    let units: UnitPreferences

    var body: some View {
        DriveScoreHighlightCard(
            titleKey: "driveScore.worstDrive",
            headerIcon: "exclamationmark.triangle.fill",
            headerTone: .danger,
            gaugeColorIndex: 5,
            drive: drive,
            units: units,
            insightKey: drive.map { DriveScoreEngine.worstDriveTipKey($0.score) },
            insightTone: .danger
        )
    }
}

/// Shared best/worst card body (web GlassPanel13/14 markup): header, gauge + stats, insight note, or
/// the `driveScore.noDrives` empty when there is no drive.
struct DriveScoreHighlightCard: View {
    let titleKey: LocalizedStringKey
    let headerIcon: String
    let headerTone: TSTone
    let gaugeColorIndex: Int
    let drive: ScoredDrive?
    let units: UnitPreferences
    let insightKey: LocalizedStringKey?
    let insightTone: TSTone

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: headerIcon)
                        .foregroundStyle(headerTone.color)
                        .accessibilityHidden(true)
                    TSSubhead(titleKey)
                }
                if let drive {
                    content(drive)
                } else {
                    Text("driveScore.noDrives")
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private func content(_ scored: ScoredDrive) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                Text(verbatim: DriveScoreFormat.dateShort(scored.drive.startTs))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer()
                TSBadge(LocalizedStringKey(scored.score.grade.label), tone: scored.score.grade.tone)
            }
            HStack(alignment: .center, spacing: TSSpacing.md) {
                DriveScoreGauge(
                    value: scored.score.total,
                    maxValue: 100,
                    label: "driveScore.score",
                    colorIndex: gaugeColorIndex
                )
                .frame(width: 72, height: 72)
                VStack(spacing: TSSpacing.xs) {
                    statRow("driveScore.distance", DriveScoreFormat.distance(scored.drive.distanceM, units))
                    statRow("driveScore.durationLabel", DriveScoreFormat.durationSeconds(scored.drive.durationS))
                    statRow("driveScore.consumption", DriveScoreFormat.efficiencyInt(scored.score.whPerKm, units))
                }
            }
            if let insightKey {
                HStack(alignment: .top, spacing: TSSpacing.xs) {
                    Image(systemName: headerIcon)
                        .font(.caption2)
                        .accessibilityHidden(true)
                    Text(insightKey)
                        .font(Font.TS.caption)
                }
                .foregroundStyle(insightTone.color)
                .padding(TSSpacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(insightTone.color.opacity(0.08), in: RoundedRectangle(cornerRadius: TSRadius.md))
            }
        }
    }

    private func statRow(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textPrimary)
        }
    }
}
