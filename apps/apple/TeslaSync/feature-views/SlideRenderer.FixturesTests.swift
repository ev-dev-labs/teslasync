//
//  SlideRenderer.FixturesTests.swift
//  TeslaSync — P4 feature view · 0066 · SlideRenderer (Apple)
//
//  Shared XCTest fixtures (deck + recap + projector helper) for the SlideRenderer test bundles.
//  Named `*Tests.swift` so the XcodeGen target globs route it into the TeslaSync(/-macOS) XCTest
//  bundles (alongside SlideRenderer.Tests.swift / SlideRenderer.ModelTests.swift), not the app target.
//

import XCTest
@testable import TeslaSync

enum SlideRendererFixture {
    static let echo: @Sendable (String, String) -> String = { _, fallback in fallback }

    static func deck() -> [SlideDefinitionInput] {
        [
            SlideDefinitionInput(type: "title", background: "from-blue-900 via-indigo-900 to-slate-900"),
            SlideDefinitionInput(type: "stat-hero", field: "distance", background: "from-emerald-900 to-teal-900"),
            SlideDefinitionInput(type: "stat-chart", field: "drives", background: "from-purple-900 to-indigo-900"),
            SlideDefinitionInput(type: "drive-highlight", field: "longest", background: "from-amber-900 to-yellow-900"),
            SlideDefinitionInput(type: "stat-hero", field: "energy", background: "from-cyan-900 to-blue-900"),
            SlideDefinitionInput(type: "charging-breakdown", background: "from-orange-900 to-pink-900"),
            SlideDefinitionInput(type: "savings", background: "from-emerald-900 to-cyan-900"),
            SlideDefinitionInput(type: "environment", background: "from-green-900 to-lime-900"),
            SlideDefinitionInput(type: "patterns", background: "from-indigo-900 to-violet-900"),
            SlideDefinitionInput(type: "drive-highlight", field: "efficient", background: "from-teal-900 to-sky-900"),
            SlideDefinitionInput(type: "comparisons", background: "from-pink-900 to-fuchsia-900"),
            SlideDefinitionInput(type: "summary", background: "from-blue-900 to-purple-900")
        ]
    }

    static func recap(acOtherPct: Double = 20) -> YearReviewRecap {
        YearReviewRecap(
            year: 2026,
            vehicleName: "Model 3 Performance",
            totalDrives: 342,
            totalDistanceKm: 18450,
            totalEnergyKwh: 3120,
            totalChargeSessions: 96,
            gasSavings: 2480,
            co2OffsetKg: 1450,
            superchargerPct: 62,
            dcFastPct: 18,
            acOtherPct: acOtherPct,
            avgChargeStartSoc: 34,
            mostActiveDayOfWeek: "Saturday",
            mostActiveHour: 17,
            avgDrivesPerWeek: 6.6,
            longestDrive: YearReviewRecapDrive(
                driveID: 1,
                date: "2026-08-14",
                distanceKm: 612,
                durationMin: 374,
                startAddress: "San Francisco, CA",
                endAddress: "Los Angeles, CA",
                efficiencyWhKm: 168
            ),
            mostEfficientDrive: YearReviewRecapDrive(
                driveID: 2,
                date: "2026-04-02",
                distanceKm: 84,
                durationMin: 96,
                startAddress: "Palo Alto, CA",
                endAddress: "San Jose, CA",
                efficiencyWhKm: 121
            ),
            comparisons: [
                YearReviewRecapComparison(label: "Around the Earth", value: "0.46×", emoji: "🌍"),
                YearReviewRecapComparison(label: "Trees planted", value: "66", emoji: "🌳")
            ]
        )
    }

    static func project(
        _ slide: SlideDefinitionInput,
        recap: YearReviewRecap? = nil,
        index: Int = 0
    ) -> SlideProjection {
        SlideRendererProjector.project(
            slide: slide,
            recap: recap ?? Self.recap(),
            index: index,
            localeIdentifier: "en_US",
            localize: echo
        )
    }
}
