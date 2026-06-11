//
//  BatteryDelta.Tests.swift
//  TeslaSync — P4 shared surface · 0077 · BatteryDelta (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value
//  types live in BatteryDelta.AdapterTests.swift; split to keep each file within the SwiftLint
//  file-length budget):
//    • BatteryDeltaModel — the once-only `view.opened`, the props update + identical-update guard,
//      the derived projection, and the populated / no-data VoiceOver label.
//    • Views — the content row + the public surface compose in every state; the tone → token color
//      projection is distinct + resolvable.
//    • Strings — the two web i18n keys resolve through the P1/S10 facade with the expected fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - BatteryDeltaModel (surface lifecycle + derivation)

@MainActor
final class BatteryDeltaModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyBatteryDeltaTelemetry()
        let model = BatteryDeltaModel(startPct: 20, endPct: 80, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BatteryDeltaSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyBatteryDeltaTelemetry()
        let model = BatteryDeltaModel(startPct: 20, endPct: 80, telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [BatteryDeltaSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInputs() {
        let model = BatteryDeltaModel(startPct: 18, endPct: 72)
        XCTAssertEqual(model.projection.displayText, "+54%")
        XCTAssertEqual(model.projection.tone, .positive)
        XCTAssertTrue(model.showIcon)
    }

    func testUpdateChangesProjection() {
        let model = BatteryDeltaModel(startPct: 80, endPct: 80)
        XCTAssertEqual(model.projection.tone, .neutral)
        model.update(BatteryDeltaInputs(startPct: 20, endPct: 80))
        XCTAssertEqual(model.projection.displayText, "+60%")
        XCTAssertEqual(model.projection.tone, .positive)
    }

    func testUpdateWithIdenticalInputsKeepsProjection() {
        let inputs = BatteryDeltaInputs(startPct: 20, endPct: 80)
        let model = BatteryDeltaModel(inputs: inputs)
        model.update(inputs)
        XCTAssertEqual(model.projection.displayText, "+60%")
    }

    func testPopulatedAccessibilityLabel() {
        let model = BatteryDeltaModel(startPct: 79, endPct: 78)
        XCTAssertEqual(model.accessibilityLabel, "Battery 79% to 78%")
    }

    func testNoDataAccessibilityLabel() {
        let model = BatteryDeltaModel(startPct: nil, endPct: 80)
        XCTAssertEqual(model.accessibilityLabel, "Battery delta unknown")
    }
}

// MARK: - Views (every branch composes + tone color)

@MainActor
final class BatteryDeltaViewCompositionTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = BatteryDelta(startPct: 20, endPct: 80)
        _ = BatteryDelta(startPct: 79, endPct: 78)
        _ = BatteryDelta(startPct: 80, endPct: 80)
        _ = BatteryDelta(startPct: nil, endPct: 80)
        _ = BatteryDelta(startPct: 20, endPct: 80, showIcon: false, variant: .pair)
    }

    func testSurfaceComposesFromInjectedModel() {
        let model = BatteryDeltaModel(startPct: 20, endPct: 80, telemetry: SpyBatteryDeltaTelemetry())
        _ = BatteryDelta(model: model)
        XCTAssertEqual(BatteryDelta.surfaceSlug, "BatteryDelta")
    }

    func testContentViewComposesForEveryTone() {
        for variant in BatteryDeltaVariant.allCases {
            for (start, end) in [(20.0, 80.0), (90.0, 89.0), (80.0, 80.0)] {
                let projection = BatteryDeltaProjector.resolve(startPct: start, endPct: end, variant: variant)
                _ = BatteryDeltaContentView(
                    projection: projection,
                    showIcon: true,
                    accessibilityLabel: "Battery \(Int(start))% to \(Int(end))%"
                )
            }
        }
        let noData = BatteryDeltaProjector.resolve(startPct: nil, endPct: nil)
        _ = BatteryDeltaContentView(projection: noData, showIcon: false, accessibilityLabel: "unknown")
    }
}

// MARK: - Tone → design tokens

@MainActor
final class BatteryDeltaToneColorTests: XCTestCase {
    func testTonesMapToStatusTokens() {
        XCTAssertEqual(BatteryDeltaTone.positive.color, Color.TS.statusSuccess)
        XCTAssertEqual(BatteryDeltaTone.negative.color, Color.TS.statusWarning)
        XCTAssertEqual(BatteryDeltaTone.neutral.color, Color.TS.textMuted)
    }

    func testToneColorsAreDistinct() {
        let colors = BatteryDeltaTone.allCases.map(\.color)
        XCTAssertEqual(Set(colors.map { "\($0)" }).count, BatteryDeltaTone.allCases.count)
    }
}

// MARK: - Strings facade (P1/S10)

final class BatteryDeltaStringsTests: XCTestCase {
    func testUnknownLabelResolvesToFallback() {
        XCTAssertEqual(BatteryDeltaStrings.unknownAccessibilityLabel, "Battery delta unknown")
    }

    func testAccessibilityLabelInterpolatesEndpoints() {
        XCTAssertEqual(
            BatteryDeltaStrings.accessibilityLabel(from: "79", to: "78"),
            "Battery 79% to 78%"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyBatteryDeltaTelemetry: BatteryDeltaTelemetry, @unchecked Sendable {
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
