//
//  Speed.Tests.swift
//  TeslaSync — P4 shared surface · 0088 · Speed (Apple)
//
//  Model / view / telemetry coverage for the Speed surface:
//    • Model — the projection, the accessibility label, `sync` adoption + idempotence, the lazy once-only
//      `view.opened` telemetry, and the no-op stop.
//    • Views — the public surface (both initializers) and the text run compose (signature contract).
//
//  The pure adapter / projection / formatting / accessibility coverage lives in Speed.AdapterTests.swift.
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real store; a fixed locale
//  keeps the formatting assertions deterministic regardless of the runner's region.
//

import SwiftUI
import XCTest

private let usLocale = Locale(identifier: "en_US")

// MARK: - Model (state-holder)

@MainActor
final class SpeedModelTests: XCTestCase {
    private func makeModel(_ input: SpeedInput, telemetry: SpeedTelemetry) -> SpeedModel {
        SpeedModel(input: input, telemetry: telemetry)
    }

    func testResolvedProjectsInput() {
        let input = SpeedInput(kmh: 100, settings: SpeedDisplaySettings(rawUnitOfLength: "km"), locale: usLocale)
        let model = makeModel(input, telemetry: SpySpeedTelemetry())
        XCTAssertEqual(model.resolved.text, "100.00 km/h")
        XCTAssertEqual(model.resolved.canonical, "100.0 km/h")
    }

    func testAccessibilityLabelProjectsInput() {
        let model = makeModel(SpeedInput(mph: nil, fallback: "n/a"), telemetry: SpySpeedTelemetry())
        XCTAssertEqual(model.accessibilityLabel, "n/a")
    }

    func testSyncAdoptsNewInput() {
        let imperial = SpeedDisplaySettings(rawUnitOfLength: "mi")
        let model = makeModel(SpeedInput(mph: 65, settings: imperial, locale: usLocale), telemetry: SpySpeedTelemetry())
        model.sync(SpeedInput(mph: 30, settings: imperial, locale: usLocale))
        XCTAssertEqual(model.input.mph, 30)
        XCTAssertEqual(model.resolved.text, "30.00 mph")
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpySpeedTelemetry()
        let model = makeModel(SpeedInput(mph: 1, locale: usLocale), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SpeedMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpySpeedTelemetry()
        let model = makeModel(SpeedInput(mph: 1, locale: usLocale), telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [SpeedMeta.surfaceSlug])
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class SpeedViewTests: XCTestCase {
    func testTextRunComposesBothBranches() {
        _ = SpeedText(resolved: SpeedResolved(text: "65.00 mph", canonical: "65.0 mph", isFallback: false))
        _ = SpeedText(resolved: SpeedResolved(text: "—", canonical: nil, isFallback: true))
    }

    func testPublicSurfacesCompose() {
        _ = Speed(mph: 65, unitOfLength: "mi")
        _ = Speed(kmh: 100, unitOfLength: "km")
        _ = Speed(mph: nil, kmh: nil)
        _ = Speed(mph: 65, precision: 0, unitOfLength: "km", locale: usLocale)
        _ = Speed(input: SpeedInput(mph: 65, locale: usLocale), telemetry: SpySpeedTelemetry())
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpySpeedTelemetry: SpeedTelemetry, @unchecked Sendable {
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

@testable import TeslaSync
