import SwiftUI
import XCTest
@testable import TeslaSync

/// Route + registry tests for the Efficiency surface: the web `/efficiency` path resolves to the
/// `.efficiency` route, the route is grouped + iconned, and the registration hosts the page so the
/// shell can render it.
@MainActor
final class EfficiencyRouteRegistrationTests: XCTestCase {
    func testEfficiencyPathResolvesToRoute() {
        XCTAssertEqual(AppRouteParser.parse(path: "/efficiency"), .efficiency)
        XCTAssertEqual(AppRoute.efficiency.pathSegment, "efficiency")
        XCTAssertEqual(AppRoute.efficiency.path, "/efficiency")
    }

    func testEfficiencyRouteIsGroupedAndIconned() {
        XCTAssertEqual(AppRoute.efficiency.group, .vehicle)
        XCTAssertTrue(AppRoute.routes(in: .vehicle).contains(.efficiency))
        XCTAssertFalse(AppRoute.efficiency.systemImage.isEmpty)
    }

    func testRegistrationHostsThePage() {
        let registry = EfficiencyRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.efficiency))
        XCTAssertNotNil(registry.view(for: .efficiency))
    }

    func testRegistrationPreservesBaseRoutes() {
        var base = AppRouteHostRegistry()
        base.register(.dashboard) { EmptyView() }
        let registry = EfficiencyRouteRegistration.registry(base: base)
        XCTAssertNotNil(registry.view(for: .dashboard)) // base registration is preserved
        XCTAssertNotNil(registry.view(for: .efficiency))
    }
}
