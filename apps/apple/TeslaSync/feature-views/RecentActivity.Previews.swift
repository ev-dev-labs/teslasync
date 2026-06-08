//
//  RecentActivity.Previews.swift
//  TeslaSync — P4 feature view · 0130 · RecentActivity (Apple)
//
//  Xcode previews — one per state the surface produces: content (the three populated panels),
//  empty (resolved, no data → friendly empty), loading (initial skeleton chrome), error (fetch
//  failed → retry), and the stale / offline freshness variants, across USD + EUR currency /
//  locale preferences. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentRecentActivityTelemetry: RecentActivityTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Representative dashboard data: four recent drives, three charges, and a fleet-analytics
    /// snapshot with a most-efficient highlight.
    private enum RecentActivityPreviewData {
        static let referenceDate = Date(timeIntervalSince1970: 1_733_580_000)

        static func drives() -> [RecentActivityDrive] {
            [
                drive("d1", distanceM: 18300, durationS: 1500, soc: (88, 74), minutesAgo: 12),
                drive("d2", distanceM: 42100, durationS: 3120, soc: (74, 49), minutesAgo: 95),
                drive("d3", distanceM: 6400, durationS: 720, soc: (49, 44), minutesAgo: 320),
                drive("d4", distanceM: 31900, durationS: 2460, soc: (96, 71), minutesAgo: 1500)
            ]
        }

        static func charges() -> [RecentActivityCharge] {
            [
                charge("c1", energyWh: 31400, soc: (44, 80), cost: 9.40, minutesAgo: 60),
                charge("c2", energyWh: 52900, soc: (18, 90), cost: 21.16, minutesAgo: 2880),
                charge("c3", energyWh: 7800, soc: (71, 84), cost: nil, minutesAgo: 9000)
            ]
        }

        static func analytics() -> RecentActivityAnalytics {
            RecentActivityAnalytics(
                totalDrives: 142,
                totalChargingSessions: 47,
                totalCost: 612.0,
                totalEnergyKwh: 1180.4,
                mostEfficientVehicle: RecentActivityEfficientVehicle(name: "Model 3 LR", efficiencyWhKm: 148)
            )
        }

        private static func drive(
            _ id: String,
            distanceM: Double,
            durationS: Double,
            soc: (Int, Int),
            minutesAgo: Double
        ) -> RecentActivityDrive {
            RecentActivityDrive(
                id: id,
                distanceM: distanceM,
                durationS: durationS,
                startSocPct: soc.0,
                endSocPct: soc.1,
                startedAt: referenceDate.addingTimeInterval(-minutesAgo * 60)
            )
        }

        private static func charge(
            _ id: String,
            energyWh: Double,
            soc: (Int, Int),
            cost: Double?,
            minutesAgo: Double
        ) -> RecentActivityCharge {
            RecentActivityCharge(
                id: id,
                energyAddedWh: energyWh,
                startSocPct: soc.0,
                endSocPct: soc.1,
                cost: cost,
                startedAt: referenceDate.addingTimeInterval(-minutesAgo * 60)
            )
        }
    }

    @MainActor
    private func recentActivityModel(_ update: RecentActivityUpdate) -> RecentActivityModel {
        let model = RecentActivityModel(
            source: InMemoryRecentActivitySource(initial: update),
            telemetry: SilentRecentActivityTelemetry(),
            now: { RecentActivityPreviewData.referenceDate }
        )
        model.start()
        return model
    }

    @MainActor
    private func recentActivitySurface(_ update: RecentActivityUpdate) -> some View {
        ScrollView {
            RecentActivity(model: recentActivityModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    private func imperialUnits() -> RecentActivityUnits {
        RecentActivityUnits(
            distanceUnit: "mi",
            efficiencyUnit: "Wh/mi",
            efficiencyFactor: 1.609344,
            currencySymbol: "$",
            localeIdentifier: "en-US"
        )
    }

    private func euroUnits() -> RecentActivityUnits {
        RecentActivityUnits(
            distanceUnit: "km",
            efficiencyUnit: "Wh/km",
            efficiencyFactor: 1,
            currencySymbol: "€",
            localeIdentifier: "de-DE"
        )
    }

    private func loaded(
        units: RecentActivityUnits,
        connection: RecentActivityConnection = .live
    ) -> RecentActivityUpdate {
        RecentActivityUpdate(
            status: .loaded,
            drives: RecentActivityPreviewData.drives(),
            charges: RecentActivityPreviewData.charges(),
            analytics: RecentActivityPreviewData.analytics(),
            units: units,
            connection: connection,
            updatedAt: RecentActivityPreviewData.referenceDate
        )
    }

    #Preview("Content · USD") {
        recentActivitySurface(loaded(units: imperialUnits()))
    }

    #Preview("Content · EUR") {
        recentActivitySurface(loaded(units: euroUnits()))
    }

    #Preview("Empty") {
        recentActivitySurface(RecentActivityUpdate(status: .empty, units: imperialUnits()))
    }

    #Preview("Loading") {
        recentActivitySurface(RecentActivityUpdate(status: .loading, units: imperialUnits()))
    }

    #Preview("Error") {
        recentActivitySurface(RecentActivityUpdate(status: .failed("Request timed out"), units: imperialUnits()))
    }

    #Preview("Stale (cached)") {
        recentActivitySurface(loaded(units: imperialUnits(), connection: .stale))
    }

    #Preview("Offline (cached)") {
        recentActivitySurface(loaded(units: imperialUnits(), connection: .offline))
    }
#endif
