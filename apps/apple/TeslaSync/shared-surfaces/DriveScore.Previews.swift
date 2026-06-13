//
//  DriveScore.Previews.swift
//  TeslaSync — P4 shared surface · 0082 · DriveScore (Apple)
//
//  Xcode previews for the drive score across the three quality bands (good / fair / poor) and the
//  edge inputs the projector handles (an empty drive, a zero-duration drive, a drive with no max
//  speed). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Good · long smooth trip (94)") {
        staged("good band · green gauge") {
            DriveScore(
                distanceM: 120_000,
                durationS: 5400,
                maxSpeedMps: 24,
                startBatteryPct: 95,
                endBatteryPct: 70
            )
        }
    }

    #Preview("Fair · short hop") {
        staged("fair band · amber gauge") {
            DriveScore(
                distanceM: 9000,
                durationS: 900,
                maxSpeedMps: 22,
                startBatteryPct: 64,
                endBatteryPct: 60
            )
        }
    }

    #Preview("Poor · wasteful drive (3)") {
        staged("poor band · red gauge") {
            DriveScore(
                distanceM: 5000,
                durationS: 1800,
                maxSpeedMps: 40,
                startBatteryPct: 100,
                endBatteryPct: 80
            )
        }
    }

    #Preview("Edge · empty / zero-duration / no max speed") {
        staged("absent-field fallbacks") {
            VStack(spacing: TSSpacing.lg) {
                DriveScore()
                DriveScore(distanceM: 10000, durationS: 0, startBatteryPct: 80, endBatteryPct: 75)
                DriveScore(distanceM: 30000, durationS: 1800, startBatteryPct: 70, endBatteryPct: 62)
            }
        }
    }
#endif
