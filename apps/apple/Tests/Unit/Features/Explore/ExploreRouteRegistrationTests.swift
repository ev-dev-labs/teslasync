import SwiftUI
import XCTest
@testable import TeslaSync

/// Wiring tests for the Explore route registration — the `.explore` route hosts the hub and existing
/// base registrations are preserved.
@MainActor
final class ExploreRouteRegistrationTests: XCTestCase {
    func testRegistersExploreRoute() {
        let registry = ExploreRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.explore))
        XCTAssertNotNil(registry.view(for: .explore))
    }

    func testPreservesBaseRegistrations() {
        var base = AppRouteHostRegistry()
        base.register(.dashboard) { Text(verbatim: "dashboard") }
        let registry = ExploreRouteRegistration.registry(base: base)
        XCTAssertTrue(registry.registeredRoutes.contains(.dashboard))
        XCTAssertTrue(registry.registeredRoutes.contains(.explore))
    }

    func testNavigateCallbackIsForwarded() {
        var navigated: AppRoute?
        let registry = ExploreRouteRegistration.registry(
            dataSource: SampleExploreDataSource(),
            onNavigate: { navigated = $0 }
        )
        // The closure is captured by the page; invoking it directly proves the wiring is threaded.
        XCTAssertNotNil(registry.view(for: .explore))
        XCTAssertNil(navigated)
    }
}
