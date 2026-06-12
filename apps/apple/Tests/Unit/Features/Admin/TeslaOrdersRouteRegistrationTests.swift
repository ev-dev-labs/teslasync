import SwiftUI
import XCTest
@testable import TeslaSync

/// Tests for `TeslaOrdersRouteRegistration` + the `.teslaOrders` route metadata — the
/// thin chrome page that hosts the shared `ActiveOrdersSection` at web `/tesla-orders`.
/// Verifies the page is registered + renders, the base registrations are preserved,
/// and the route metadata + deep-link parsing match the web route (Account side-nav).
@MainActor final class TeslaOrdersRouteRegistrationTests: XCTestCase {
    func testRegistersTeslaOrdersRoute() {
        let registry = TeslaOrdersRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.teslaOrders))
        XCTAssertNotNil(registry.view(for: .teslaOrders))
    }

    func testPreservesBaseRegistrations() {
        var base = AppRouteHostRegistry()
        base.register(.dashboard) { EmptyView() }
        let registry = TeslaOrdersRouteRegistration.registry(base: base)
        XCTAssertTrue(registry.registeredRoutes.contains(.dashboard))
        XCTAssertTrue(registry.registeredRoutes.contains(.teslaOrders))
    }

    func testInjectedSourceIsUsed() {
        let source = InMemoryActiveOrdersSource(initial: OrdersUpdate(status: .loaded, orders: [], fetchedAt: nil))
        let registry = TeslaOrdersRouteRegistration.registry(source: source)
        XCTAssertNotNil(registry.view(for: .teslaOrders))
    }

    func testRouteMetadataMatchesWeb() {
        XCTAssertEqual(AppRoute.teslaOrders.pathSegment, "tesla-orders")
        XCTAssertEqual(AppRoute.teslaOrders.path, "/tesla-orders")
        XCTAssertEqual(AppRoute.teslaOrders.group, .account)
    }

    func testCanonicalPathParsesToRoute() {
        XCTAssertEqual(AppRouteParser.parse(path: "/tesla-orders"), .teslaOrders)
        XCTAssertEqual(AppRouteParser.parse(path: "/tesla-orders/"), .teslaOrders)
    }
}
