//
//  TeslaFeatureFlagsPageModelTests.swift
//  TeslaSync — P4 page · P7 · page:admin/TeslaFeatureFlags (Apple)
//
//  Unit coverage for the Tesla Feature Flags page: the `@Observable`
//  `TeslaFeatureFlagsPageModel` (the two parity strings resolved from the catalog, the
//  hosted-surface ownership, the `view.opened` telemetry contract + idempotence), the
//  `.teslaFeatures` route wiring (canonical segment + deep-link parse + sidebar group), and
//  the route registration (the shell host resolves the page). No network, no real store —
//  the hosted surface is driven by `InMemoryFeatureTogglesSource`.
//
//  These run in the TeslaSync(/-macOS) XCTest targets.
//

import SwiftUI
import XCTest
@testable import TeslaSync

@MainActor
final class TeslaFeatureFlagsPageModelTests: XCTestCase {
    private func makeToggles() -> FeatureTogglesModel {
        FeatureTogglesModel(source: InMemoryFeatureTogglesSource(initial: FeatureTogglesUpdate(
            status: .loaded,
            config: [
                "MOBILE_ACCESS": .bool(true),
                "ENDPOINTS": .object(["enabled": .bool(true), "max_calls": .number(200)])
            ],
            fetchedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )))
    }

    // MARK: Parity strings (manifest required items)

    func testTitleResolvesParityString() {
        let model = TeslaFeatureFlagsPageModel(toggles: makeToggles())
        XCTAssertEqual(model.title, "Feature Flags")
    }

    func testSubtitleResolvesParityString() {
        let model = TeslaFeatureFlagsPageModel(toggles: makeToggles())
        XCTAssertEqual(model.subtitle, "Tesla account feature configuration")
    }

    // MARK: Hosted surface + diagnostics

    func testHostsTheProvidedTogglesModel() {
        let toggles = makeToggles()
        let model = TeslaFeatureFlagsPageModel(toggles: toggles)
        XCTAssertTrue(model.toggles === toggles)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = TeslaFeatureFlagsSpyTelemetry()
        let model = TeslaFeatureFlagsPageModel(toggles: makeToggles(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["TeslaFeatureFlagsPage"])
    }

    func testStopReArmsViewOpened() {
        let spy = TeslaFeatureFlagsSpyTelemetry()
        let model = TeslaFeatureFlagsPageModel(toggles: makeToggles(), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, ["TeslaFeatureFlagsPage", "TeslaFeatureFlagsPage"])
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TeslaFeatureFlagsPageModel.surfaceSlug, "TeslaFeatureFlagsPage")
        XCTAssertEqual(TeslaFeatureFlagsPage.surfaceSlug, "TeslaFeatureFlagsPage")
    }

    // MARK: Route wiring (web `/tesla-features`)

    func testRouteHasCanonicalSegmentAndGroup() {
        XCTAssertEqual(AppRoute.teslaFeatures.pathSegment, "tesla-features")
        XCTAssertEqual(AppRoute.teslaFeatures.path, "/tesla-features")
        XCTAssertEqual(AppRoute.teslaFeatures.group, .account)
        XCTAssertTrue(AppRoute.routes(in: .account).contains(.teslaFeatures))
    }

    func testDeepLinkParsesToRoute() {
        XCTAssertEqual(AppRouteParser.parse(path: "/tesla-features"), .teslaFeatures)
        XCTAssertEqual(AppRouteParser.parse(path: "/Tesla-Features/"), .teslaFeatures)
    }

    func testRegistrationHostsThePage() {
        let registry = TeslaFeatureFlagsRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.teslaFeatures))
        XCTAssertNotNil(registry.view(for: .teslaFeatures))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class TeslaFeatureFlagsSpyTelemetry: TeslaFeatureFlagsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
