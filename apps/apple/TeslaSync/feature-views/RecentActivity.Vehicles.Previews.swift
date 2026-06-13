//
//  RecentActivity.Vehicles.Previews.swift
//  TeslaSync — P4 feature view · 0277 · RecentActivity (Apple)
//
//  Xcode previews — one per state the surface produces: content (the two populated panels), empty
//  (resolved, no data → friendly empty), loading (initial skeleton chrome), error (fetch failed →
//  retry), and the stale / offline freshness variants, across imperial (mi) + metric (km) unit /
//  locale preferences. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentVehicleRecentActivityTelemetry: VehicleRecentActivityTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Representative vehicle data: four recent drives and three recent charges.
    private enum VehicleRecentActivityPreviewData {
        static let referenceDate = Date(timeIntervalSince1970: 1_733_580_000)

        static func drives() -> [VehicleRecentActivityDrive] {
            [
                drive("d1", distanceM: 18300, durationS: 1500, soc: (88, 74), minutesAgo: 12),
                drive("d2", distanceM: 42100, durationS: 3120, soc: (74, 49), minutesAgo: 95),
                drive("d3", distanceM: 6400, durationS: 720, soc: (49, 44), minutesAgo: 320),
                drive("d4", distanceM: 31900, durationS: 2460, soc: (96, 71), minutesAgo: 1500)
            ]
        }

        static func charges() -> [VehicleRecentActivityCharge] {
            [
                charge("c1", energyWh: 31400, durationS: 2640, soc: (44, 80), minutesAgo: 60),
                charge("c2", energyWh: 52900, durationS: 5280, soc: (18, 90), minutesAgo: 2880),
                charge("c3", energyWh: 7800, durationS: 1080, soc: (71, 84), minutesAgo: 9000)
            ]
        }

        private static func drive(
            _ id: String,
            distanceM: Double,
            durationS: Double,
            soc: (Int, Int),
            minutesAgo: Double
        ) -> VehicleRecentActivityDrive {
            VehicleRecentActivityDrive(
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
            durationS: Double,
            soc: (Int, Int),
            minutesAgo: Double
        ) -> VehicleRecentActivityCharge {
            VehicleRecentActivityCharge(
                id: id,
                energyAddedWh: energyWh,
                durationS: durationS,
                startSocPct: soc.0,
                endSocPct: soc.1,
                startedAt: referenceDate.addingTimeInterval(-minutesAgo * 60)
            )
        }
    }

    @MainActor
    private func vehicleRecentActivityModel(_ update: VehicleRecentActivityUpdate) -> VehicleRecentActivityModel {
        let model = VehicleRecentActivityModel(
            source: InMemoryVehicleRecentActivitySource(initial: update),
            telemetry: SilentVehicleRecentActivityTelemetry(),
            now: { VehicleRecentActivityPreviewData.referenceDate }
        )
        model.start()
        return model
    }

    @MainActor
    private func vehicleRecentActivitySurface(_ update: VehicleRecentActivityUpdate) -> some View {
        ScrollView {
            VehicleRecentActivity(model: vehicleRecentActivityModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    private func imperialUnits() -> VehicleRecentActivityUnits {
        VehicleRecentActivityUnits(
            distanceUnit: "mi",
            distanceDivisor: 1609.344,
            timeStyle: .relative,
            localeIdentifier: "en-US"
        )
    }

    private func metricUnits() -> VehicleRecentActivityUnits {
        VehicleRecentActivityUnits(
            distanceUnit: "km",
            distanceDivisor: 1000,
            timeStyle: .relative,
            localeIdentifier: "de-DE"
        )
    }

    private func loaded(
        units: VehicleRecentActivityUnits,
        connection: VehicleRecentActivityConnection = .live
    ) -> VehicleRecentActivityUpdate {
        VehicleRecentActivityUpdate(
            status: .loaded,
            drives: VehicleRecentActivityPreviewData.drives(),
            charges: VehicleRecentActivityPreviewData.charges(),
            units: units,
            connection: connection,
            updatedAt: VehicleRecentActivityPreviewData.referenceDate
        )
    }

    #Preview("Content · mi") {
        vehicleRecentActivitySurface(loaded(units: imperialUnits()))
    }

    #Preview("Content · km") {
        vehicleRecentActivitySurface(loaded(units: metricUnits()))
    }

    #Preview("Empty") {
        vehicleRecentActivitySurface(VehicleRecentActivityUpdate(status: .empty, units: imperialUnits()))
    }

    #Preview("Loading") {
        vehicleRecentActivitySurface(VehicleRecentActivityUpdate(status: .loading, units: imperialUnits()))
    }

    #Preview("Error") {
        vehicleRecentActivitySurface(
            VehicleRecentActivityUpdate(status: .failed("Request timed out"), units: imperialUnits())
        )
    }

    #Preview("Stale (cached)") {
        vehicleRecentActivitySurface(loaded(units: imperialUnits(), connection: .stale))
    }

    #Preview("Offline (cached)") {
        vehicleRecentActivitySurface(loaded(units: imperialUnits(), connection: .offline))
    }
#endif
