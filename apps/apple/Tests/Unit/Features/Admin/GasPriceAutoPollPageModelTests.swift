//
//  GasPriceAutoPollPageModelTests.swift
//  TeslaSync — P4 page · P7 · page:admin/GasPriceAutoPoll (Apple)
//
//  Unit coverage for the Gas Price Auto-Poll page: the `@Observable`
//  `GasPriceAutoPollPageModel` (the two parity strings resolved from the catalog, the
//  hosted-surface ownership, the `view.opened` telemetry contract + idempotence), the
//  `.gasPrice` route wiring (canonical segment + deep-link parse + sidebar group), and the
//  route registration (the shell host resolves the page). No network, no real store — the
//  hosted surface is driven by `InMemoryGasPriceSettingsSource`.
//
//  These run in the TeslaSync(/-macOS) XCTest targets.
//

import SwiftUI
import XCTest
@testable import TeslaSync

@MainActor
final class GasPriceAutoPollPageModelTests: XCTestCase {
    private func makeSettings() -> GasPriceSettingsModel {
        let source = InMemoryGasPriceSettingsSource(initial: GasPriceSettingsInput(status: GasPriceRecord(
            enabled: true,
            pollInterval: .weekly,
            currentPrice: 3.45,
            lastPollTime: Date(timeIntervalSince1970: 1_775_000_000)
        )))
        return GasPriceSettingsModel(source: source)
    }

    // MARK: Parity strings (manifest required items)

    func testTitleResolvesParityString() {
        let model = GasPriceAutoPollPageModel(settings: makeSettings())
        XCTAssertEqual(model.title, "Gas Price Auto-Poll")
    }

    func testSubtitleResolvesParityString() {
        let model = GasPriceAutoPollPageModel(settings: makeSettings())
        XCTAssertEqual(model.subtitle, "Automatically fetch US average gas prices from EIA")
    }

    // MARK: Hosted surface + diagnostics

    func testHostsTheProvidedSettingsModel() {
        let settings = makeSettings()
        let model = GasPriceAutoPollPageModel(settings: settings)
        XCTAssertTrue(model.settings === settings)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = GasPriceAutoPollSpyTelemetry()
        let model = GasPriceAutoPollPageModel(settings: makeSettings(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["GasPriceAutoPollPage"])
    }

    func testStopReArmsViewOpened() {
        let spy = GasPriceAutoPollSpyTelemetry()
        let model = GasPriceAutoPollPageModel(settings: makeSettings(), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, ["GasPriceAutoPollPage", "GasPriceAutoPollPage"])
    }

    func testSurfaceSlug() {
        XCTAssertEqual(GasPriceAutoPollPageModel.surfaceSlug, "GasPriceAutoPollPage")
        XCTAssertEqual(GasPriceAutoPollPage.surfaceSlug, "GasPriceAutoPollPage")
    }

    // MARK: Route wiring (web `/gas-price`)

    func testRouteHasCanonicalSegmentAndGroup() {
        XCTAssertEqual(AppRoute.gasPrice.pathSegment, "gas-price")
        XCTAssertEqual(AppRoute.gasPrice.path, "/gas-price")
        XCTAssertEqual(AppRoute.gasPrice.group, .account)
        XCTAssertTrue(AppRoute.routes(in: .account).contains(.gasPrice))
    }

    func testDeepLinkParsesToRoute() {
        XCTAssertEqual(AppRouteParser.parse(path: "/gas-price"), .gasPrice)
        XCTAssertEqual(AppRouteParser.parse(path: "/Gas-Price/"), .gasPrice)
    }

    func testRegistrationHostsThePage() {
        let registry = GasPriceAutoPollRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.gasPrice))
        XCTAssertNotNil(registry.view(for: .gasPrice))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class GasPriceAutoPollSpyTelemetry: GasPriceAutoPollTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
