import XCTest
@testable import TeslaSync

/// Cross-checks every widget deep link against the app's real `AppRouteParser`, so a
/// renamed route can never silently break a widget tap. Guards the privacy contract
/// that links carry only a route, no identifiers.
final class WidgetDeepLinkTests: XCTestCase {
    func testSchemeIsTeslaSync() {
        for link in WidgetDeepLink.allCases {
            XCTAssertEqual(link.url.scheme, WidgetURLScheme.scheme)
        }
    }

    func testEachLinkResolvesToExpectedRoute() {
        let expected: [WidgetDeepLink: AppRoute] = [
            .vehicleStatus: .vehicles,
            .charging: .charging,
            .recentDrive: .trips,
            .alerts: .notifications,
            .energy: .energy,
            .systemHealth: .system
        ]
        for link in WidgetDeepLink.allCases {
            XCTAssertEqual(AppRouteParser.parse(url: link.url), expected[link], "\(link.rawValue)")
        }
    }

    func testAllCasesAreMapped() {
        XCTAssertEqual(WidgetDeepLink.allCases.count, 6)
    }

    func testLinksCarryNoQueryOrIdentifiers() {
        for link in WidgetDeepLink.allCases {
            XCTAssertNil(link.url.query)
            XCTAssertEqual(link.url.host, link.routeSegment)
        }
    }
}
