import XCTest
@testable import TeslaSync

/// Tests route Handoff: building, parsing, eligibility, and the Universal Link.
@MainActor final class HandoffActivityTests: XCTestCase {
    func testActivityCarriesRouteAndEligibility() {
        let activity = HandoffActivity.activity(for: .charging)
        XCTAssertEqual(activity.activityType, HandoffActivity.routeActivityType)
        XCTAssertEqual(activity.userInfo?[HandoffActivity.routeKey] as? String, "charging")
        XCTAssertTrue(activity.isEligibleForHandoff)
        XCTAssertTrue(activity.isEligibleForSearch)
        XCTAssertEqual(activity.requiredUserInfoKeys, [HandoffActivity.routeKey])
    }

    func testActivityCarriesUniversalLink() {
        let activity = HandoffActivity.activity(for: .analytics)
        let url = try? XCTUnwrap(activity.webpageURL)
        XCTAssertEqual(url?.scheme, "https")
        XCTAssertEqual(url?.path, "/analytics")
    }

    func testRouteRoundTripViaUserInfo() {
        let activity = HandoffActivity.activity(for: .vehicleSystems)
        XCTAssertEqual(HandoffActivity.route(from: activity), .vehicleSystems)
    }

    func testRouteFallsBackToWebpageURL() {
        let activity = NSUserActivity(activityType: HandoffActivity.routeActivityType)
        activity.webpageURL = URL(string: "https://app.teslasync.io/energy")
        XCTAssertEqual(HandoffActivity.route(from: activity), .energy)
    }

    func testRouteNilForUnknownActivity() {
        let activity = NSUserActivity(activityType: HandoffActivity.routeActivityType)
        XCTAssertNil(HandoffActivity.route(from: activity))
    }

    func testConfigureMutatesExistingActivity() {
        let activity = NSUserActivity(activityType: HandoffActivity.routeActivityType)
        HandoffActivity.configure(activity, for: .maps)
        XCTAssertEqual(activity.userInfo?[HandoffActivity.routeKey] as? String, "maps")
        XCTAssertEqual(activity.webpageURL?.path, "/maps")
    }
}
