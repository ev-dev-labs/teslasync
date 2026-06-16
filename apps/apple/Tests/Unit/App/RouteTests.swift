import SwiftUI
import XCTest
@testable import TeslaSync

/// Pure-logic tests for the route registry + deep-link parser.
@MainActor final class RouteTests: XCTestCase {
    func testEveryRouteHasUniquePathSegment() {
        let segments = AppRoute.allCases.map(\.pathSegment)
        XCTAssertEqual(Set(segments).count, AppRoute.allCases.count)
    }

    func testParseCanonicalPaths() {
        XCTAssertEqual(AppRouteParser.parse(path: "/charging"), .charging)
        XCTAssertEqual(AppRouteParser.parse(path: "/vehicle-systems"), .vehicleSystems)
        XCTAssertEqual(AppRouteParser.parse(path: "/power-user"), .powerUser)
    }

    func testParseToleratesIdsCasingAndTrailingSlash() {
        XCTAssertEqual(AppRouteParser.parse(path: "/charging/123"), .charging)
        XCTAssertEqual(AppRouteParser.parse(path: "/Vehicles/"), .vehicles)
        XCTAssertEqual(AppRouteParser.parse(path: "vehicles"), .vehicles)
    }

    func testAliasesRedirect() {
        XCTAssertEqual(AppRouteParser.parse(path: "/battery/health"), .batteryHealth)
        XCTAssertEqual(AppRouteParser.parse(path: "/statistics"), .analytics)
        XCTAssertEqual(AppRouteParser.parse(path: "/"), .dashboard)
    }

    func testParseURLCustomSchemeAndUniversalLink() throws {
        XCTAssertEqual(try AppRouteParser.parse(url: XCTUnwrap(URL(string: "teslasync://charging"))), .charging)
        XCTAssertEqual(
            try AppRouteParser.parse(url: XCTUnwrap(URL(string: "https://app.example.com/analytics"))),
            .analytics
        )
    }

    func testUnknownPathReturnsNil() {
        XCTAssertNil(AppRouteParser.parse(path: "/nonexistent"))
    }

    func testEveryRouteResolvesToItsGroup() {
        for route in AppRoute.allCases {
            XCTAssertTrue(AppRoute.routes(in: route.group).contains(route))
        }
    }

    func testRegistryRoundTrips() {
        var registry = AppRouteHostRegistry()
        XCTAssertNil(registry.view(for: .dashboard))
        registry.register(.dashboard) { EmptyView() }
        XCTAssertNotNil(registry.view(for: .dashboard))
        XCTAssertTrue(registry.registeredRoutes.contains(.dashboard))
    }
}
