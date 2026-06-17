import SwiftUI
import XCTest
@testable import TeslaSync

/// Route + registry tests for the Drivetrain Health surface: the web `/drivetrain-health` path resolves
/// to the `.drivetrainHealth` route, the route is grouped + iconned with a unique path segment, and the
/// registration hosts the page so the shell can render it.
@MainActor
final class DrivetrainHealthRouteRegistrationTests: XCTestCase {
    func testPathResolvesToRoute() {
        XCTAssertEqual(AppRouteParser.parse(path: "/drivetrain-health"), .drivetrainHealth)
        XCTAssertEqual(AppRoute.drivetrainHealth.pathSegment, "drivetrain-health")
        XCTAssertEqual(AppRoute.drivetrainHealth.path, "/drivetrain-health")
    }

    func testRouteIsGroupedAndIconned() {
        XCTAssertEqual(AppRoute.drivetrainHealth.group, .vehicle)
        XCTAssertTrue(AppRoute.routes(in: .vehicle).contains(.drivetrainHealth))
        XCTAssertFalse(AppRoute.drivetrainHealth.systemImage.isEmpty)
    }

    func testPathSegmentIsUnique() {
        let segments = AppRoute.allCases.map(\.pathSegment)
        XCTAssertEqual(Set(segments).count, AppRoute.allCases.count)
    }

    func testRegistrationHostsThePage() {
        let registry = DrivetrainHealthRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.drivetrainHealth))
        XCTAssertNotNil(registry.view(for: .drivetrainHealth))
    }

    func testRegistrationPreservesBaseRoutes() {
        var base = AppRouteHostRegistry()
        base.register(.dashboard) { EmptyView() }
        let registry = DrivetrainHealthRouteRegistration.registry(base: base)
        XCTAssertNotNil(registry.view(for: .dashboard)) // base registration is preserved
        XCTAssertNotNil(registry.view(for: .drivetrainHealth))
    }
}
