//
//  DriveScore.Tests.swift
//  TeslaSync — P4 shared surface · 0082 · DriveScore (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projector + value
//  types live in DriveScore.AdapterTests.swift; split to keep each file within the SwiftLint
//  file-length budget):
//    • DriveScoreSurfaceModel — the once-only `view.opened`, the props update + identical-update
//      guard, the derived projection, the resolved rows, and the gauge / row VoiceOver labels.
//    • Views — the gauge, the bar, the row, the content view, and the public surface compose in every
//      band; the category / band → token color projections are distinct + resolvable.
//    • Strings — the web i18n keys + the two a11y formats resolve through the P1/S10 facade with the
//      expected fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - DriveScoreSurfaceModel (surface lifecycle + derivation)

@MainActor
final class DriveScoreSurfaceModelTests: XCTestCase {
    private func goodModel(telemetry: any DriveScoreSurfaceTelemetry) -> DriveScoreSurfaceModel {
        DriveScoreSurfaceModel(
            distanceM: 50000, durationS: 3000, maxSpeedMps: 30,
            startBatteryPct: 80, endBatteryPct: 70, telemetry: telemetry
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyDriveScoreSurfaceTelemetry()
        let model = goodModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DriveScoreSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyDriveScoreSurfaceTelemetry()
        let model = goodModel(telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [DriveScoreSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInputs() {
        let model = goodModel(telemetry: SpyDriveScoreSurfaceTelemetry())
        XCTAssertEqual(model.projection.total, 89)
        XCTAssertEqual(model.projection.band, .good)
    }

    func testUpdateChangesProjection() {
        let model = DriveScoreSurfaceModel(
            distanceM: 5000,
            durationS: 1800,
            maxSpeedMps: 40,
            startBatteryPct: 100,
            endBatteryPct: 80
        )
        XCTAssertEqual(model.projection.total, 3)
        model.update(DriveScoreSurfaceInputs(
            distanceM: 50000, durationS: 3000, maxSpeedMps: 30, startBatteryPct: 80, endBatteryPct: 70
        ))
        XCTAssertEqual(model.projection.total, 89)
    }

    func testUpdateWithIdenticalInputsKeepsProjection() {
        let inputs = DriveScoreSurfaceInputs(
            distanceM: 50000,
            durationS: 3000,
            maxSpeedMps: 30,
            startBatteryPct: 80,
            endBatteryPct: 70
        )
        let model = DriveScoreSurfaceModel(inputs: inputs)
        model.update(inputs)
        XCTAssertEqual(model.projection.total, 89)
    }

    func testResolvedCopy() {
        let model = goodModel(telemetry: SpyDriveScoreSurfaceTelemetry())
        XCTAssertEqual(model.title, "Drive Score")
        XCTAssertEqual(model.scoreCaption, "Score")
        XCTAssertEqual(model.label(for: .rangePreservation), "Range Preservation")
    }

    func testScoreAccessibilityLabel() {
        let model = goodModel(telemetry: SpyDriveScoreSurfaceTelemetry())
        XCTAssertEqual(model.scoreAccessibilityLabel, "Drive Score: 89 out of 100")
    }

    func testRowsResolveLabelsAndAccessibility() {
        let model = goodModel(telemetry: SpyDriveScoreSurfaceTelemetry())
        let rows = model.rows
        XCTAssertEqual(rows.count, 4)
        XCTAssertEqual(rows.map(\.item.category), DriveScoreSurfaceCategory.allCases)
        XCTAssertEqual(rows[0].label, "Efficiency")
        XCTAssertEqual(rows[0].accessibilityLabel, "Efficiency: 40 of 40 points")
        XCTAssertEqual(rows[3].label, "Trip Length")
        XCTAssertEqual(rows[3].accessibilityLabel, "Trip Length: 20 of 20 points")
    }
}

// MARK: - Views (every band composes + color projections)

@MainActor
final class DriveScoreSurfaceViewCompositionTests: XCTestCase {
    func testPublicSurfaceComposesForEveryBand() {
        _ = DriveScore(distanceM: 120_000, durationS: 5400, maxSpeedMps: 24, startBatteryPct: 95, endBatteryPct: 70)
        _ = DriveScore(distanceM: 9000, durationS: 900, maxSpeedMps: 22, startBatteryPct: 64, endBatteryPct: 60)
        _ = DriveScore(distanceM: 5000, durationS: 1800, maxSpeedMps: 40, startBatteryPct: 100, endBatteryPct: 80)
        _ = DriveScore()
    }

    func testSurfaceComposesFromInjectedModel() {
        let model = DriveScoreSurfaceModel(
            distanceM: 50000,
            durationS: 3000,
            telemetry: SpyDriveScoreSurfaceTelemetry()
        )
        _ = DriveScore(model: model)
        _ = DriveScore(inputs: model.inputs)
        XCTAssertEqual(DriveScore.surfaceSlug, "DriveScore")
    }

    func testContentAndGaugeComposeForEveryBand() {
        for total in [10, 55, 95] {
            let inputs = inputsScoring(total)
            let model = DriveScoreSurfaceModel(inputs: inputs, telemetry: SpyDriveScoreSurfaceTelemetry())
            _ = DriveScoreSurfaceContentView(
                projection: model.projection,
                title: model.title,
                scoreCaption: model.scoreCaption,
                scoreAccessibilityLabel: model.scoreAccessibilityLabel,
                rows: model.rows
            )
            _ = DriveScoreSurfaceGaugeView(
                projection: model.projection,
                scoreCaption: model.scoreCaption,
                accessibilityLabel: model.scoreAccessibilityLabel
            )
        }
    }

    func testRowAndBarCompose() {
        let item = DriveScoreSurfaceBreakdownItem(category: .efficiency, value: 30, maxPoints: 40)
        let row = DriveScoreSurfaceRowViewData(
            item: item,
            label: "Efficiency",
            accessibilityLabel: "Efficiency: 30 of 40 points"
        )
        _ = DriveScoreSurfaceBreakdownRow(row: row)
        _ = DriveScoreSurfaceProgressBar(fraction: item.fraction, color: item.category.accentColor)
    }

    /// A drive whose computed total lands in the requested band (poor / fair / good) for composition.
    private func inputsScoring(_ approxTotal: Int) -> DriveScoreSurfaceInputs {
        switch approxTotal {
        case ..<40: DriveScoreSurfaceInputs(
                distanceM: 5000,
                durationS: 1800,
                maxSpeedMps: 40,
                startBatteryPct: 100,
                endBatteryPct: 80
            )
        case ..<70: DriveScoreSurfaceInputs(
                distanceM: 9000,
                durationS: 900,
                maxSpeedMps: 22,
                startBatteryPct: 64,
                endBatteryPct: 60
            )
        default: DriveScoreSurfaceInputs(
                distanceM: 120_000,
                durationS: 5400,
                maxSpeedMps: 24,
                startBatteryPct: 95,
                endBatteryPct: 70
            )
        }
    }
}

// MARK: - Category / band → design tokens

@MainActor
final class DriveScoreSurfaceColorTests: XCTestCase {
    func testCategoryAccentsAreDistinct() {
        let colors = DriveScoreSurfaceCategory.allCases.map(\.accentColor)
        XCTAssertEqual(Set(colors.map { "\($0)" }).count, DriveScoreSurfaceCategory.allCases.count)
    }

    func testBandColorsMapToStatusTokens() {
        XCTAssertEqual(DriveScoreSurfaceBand.poor.color, Color.TS.statusDanger)
        XCTAssertEqual(DriveScoreSurfaceBand.fair.color, Color.TS.statusWarning)
        XCTAssertEqual(DriveScoreSurfaceBand.good.color, Color.TS.statusSuccess)
    }

    func testBandColorsAreDistinct() {
        let colors = DriveScoreSurfaceBand.allCases.map(\.color)
        XCTAssertEqual(Set(colors.map { "\($0)" }).count, DriveScoreSurfaceBand.allCases.count)
    }
}

// MARK: - Strings facade (P1/S10)

final class DriveScoreSurfaceStringsTests: XCTestCase {
    func testVisibleCopyResolvesToFallback() {
        XCTAssertEqual(DriveScoreSurfaceStrings.title, "Drive Score")
        XCTAssertEqual(DriveScoreSurfaceStrings.scoreCaption, "Score")
        XCTAssertEqual(DriveScoreSurfaceStrings.categoryLabel(.efficiency), "Efficiency")
        XCTAssertEqual(DriveScoreSurfaceStrings.categoryLabel(.speedDiscipline), "Speed Discipline")
    }

    func testScoreAccessibilityLabelInterpolates() {
        XCTAssertEqual(
            DriveScoreSurfaceStrings.scoreAccessibilityLabel(total: 89, maxScore: 100),
            "Drive Score: 89 out of 100"
        )
    }

    func testBreakdownAccessibilityLabelInterpolates() {
        XCTAssertEqual(
            DriveScoreSurfaceStrings.breakdownAccessibilityLabel(label: "Efficiency", value: 40, maxPoints: 40),
            "Efficiency: 40 of 40 points"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyDriveScoreSurfaceTelemetry: DriveScoreSurfaceTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
