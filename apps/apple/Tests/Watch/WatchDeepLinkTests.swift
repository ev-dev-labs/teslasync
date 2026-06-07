import Foundation
import XCTest
@testable import TeslaSyncWatch

/// Cross-checks every watch "open on iPhone" deep link against the app's real
/// `AppRouteParser`, so a renamed route can never silently break a relay, and the
/// links stay identifier-free.
final class WatchDeepLinkTests: XCTestCase {
    func testSchemeIsTeslaSync() {
        for link in WatchDeepLink.allCases {
            XCTAssertEqual(link.url.scheme, WidgetURLScheme.scheme)
        }
    }

    func testEachLinkResolvesToExpectedRoute() {
        let expected: [WatchDeepLink: AppRoute] = [
            .dashboard: .dashboard,
            .vehicles: .vehicles,
            .charging: .charging,
            .energy: .energy,
            .notifications: .notifications
        ]
        for link in WatchDeepLink.allCases {
            XCTAssertEqual(AppRouteParser.parse(url: link.url), expected[link], link.rawValue)
        }
    }

    func testLinksCarryNoQueryOrIdentifiers() {
        for link in WatchDeepLink.allCases {
            XCTAssertNil(link.url.query)
            XCTAssertEqual(link.url.host, link.routeSegment)
        }
    }
}
