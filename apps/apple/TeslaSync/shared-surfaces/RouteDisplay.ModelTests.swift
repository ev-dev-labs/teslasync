//
//  RouteDisplay.ModelTests.swift
//  TeslaSync — P4 shared surface · 0101 · RouteDisplay (Apple)
//
//  Unit coverage for the RouteDisplay diagnostics contract (P1/S11): the surface emits a single
//  `view.opened` event with the stable, non-identifying slug "RouteDisplay" the first time it
//  appears, and never again across repeated appearances. The logic / i18n / accessibility seams are
//  asserted in `…Tests.swift`.
//

import XCTest
@testable import TeslaSync

// MARK: - Telemetry spy (records the surfaces a view.opened was emitted for)

private final class RouteDisplayTelemetrySpy: RouteDisplayTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []

    var surfaces: [String] {
        lock.withLock { recorded }
    }

    func viewOpened(surface: String) {
        lock.withLock { recorded.append(surface) }
    }
}

// MARK: - Surface identity

final class RouteDisplayMetaTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(RouteDisplayMeta.surfaceSlug, "RouteDisplay")
    }

    @MainActor func testViewExposesSurfaceSlug() {
        XCTAssertEqual(RouteDisplay.surfaceSlug, "RouteDisplay")
    }
}

// MARK: - view.opened emission (once-only)

final class RouteDisplayDiagnosticsTests: XCTestCase {
    func testOpenIfNeededEmitsWhenNotAlreadyEmitted() {
        let spy = RouteDisplayTelemetrySpy()
        let emitted = RouteDisplayDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, ["RouteDisplay"])
    }

    func testOpenIfNeededIsIdempotentWhenAlreadyEmitted() {
        let spy = RouteDisplayTelemetrySpy()
        let emitted = RouteDisplayDiagnostics.openIfNeeded(alreadyEmitted: true, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertTrue(spy.surfaces.isEmpty)
    }
}

// MARK: - Model lifecycle

@MainActor
final class RouteDisplayModelTests: XCTestCase {
    func testMarkAppearedEmitsViewOpenedExactlyOnce() {
        let spy = RouteDisplayTelemetrySpy()
        let model = RouteDisplayModel(telemetry: spy)

        model.markAppeared()
        model.markAppeared()
        model.markAppeared()

        XCTAssertEqual(spy.surfaces, ["RouteDisplay"])
    }
}
