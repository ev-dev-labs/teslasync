import XCTest

/// XCUITest coverage for the push subsystem demo (`-uiTestPushDemo`). The same file
/// runs in the iOS and macOS UI-test targets, proving the permission flow, the
/// foreground banner + deep-link routing, device registration, Live Activity
/// control, and the settings screen — all against in-memory fakes (no APNs).
@MainActor final class PushNotificationsUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func launchDemo() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-uiTestPushDemo"]
        app.launch()
        return app
    }

    func testRequestAuthorizationUpdatesStatus() {
        let app = launchDemo()
        let status = app.staticTexts["push.demo.status"]
        XCTAssertTrue(status.waitForExistence(timeout: 5))

        app.buttons["push.demo.requestAuth"].tap()
        let authorized = NSPredicate(format: "label == %@", "authorized")
        let expectation = expectation(for: authorized, evaluatedWith: status)
        XCTAssertEqual(
            XCTWaiter().wait(for: [expectation], timeout: 5),
            .completed,
            "requesting authorization flips the demo status to authorized"
        )
    }

    func testForegroundChargingPushShowsBannerThenDeepLinks() {
        let app = launchDemo()
        let simulate = app.buttons["push.demo.simulateCharging"]
        XCTAssertTrue(simulate.waitForExistence(timeout: 5))
        simulate.tap()

        let banner = app.descendants(matching: .any)["push.banner"]
        XCTAssertTrue(banner.waitForExistence(timeout: 5), "a foreground charging push raises the in-app banner")

        app.buttons["push.banner.open"].tap()
        let route = app.staticTexts["push.demo.route"]
        XCTAssertTrue(route.waitForExistence(timeout: 5))
        XCTAssertEqual(route.label, "charging", "opening the banner deep-links to the charging route")
    }

    func testCommandTapDeepLinksToVehicles() {
        let app = launchDemo()
        let tap = app.buttons["push.demo.simulateCommandTap"]
        XCTAssertTrue(tap.waitForExistence(timeout: 5))
        tap.tap()

        let route = app.staticTexts["push.demo.route"]
        XCTAssertTrue(route.waitForExistence(timeout: 5))
        XCTAssertEqual(route.label, "vehicles")
    }

    func testRegisterTokenMarksDeviceRegistered() {
        let app = launchDemo()
        let register = app.buttons["push.demo.registerToken"]
        XCTAssertTrue(register.waitForExistence(timeout: 5))
        register.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["push.demo.registered"].waitForExistence(timeout: 5),
            "registering the APNs token marks the device registered"
        )
    }

    func testStartLiveActivityMarksActive() {
        let app = launchDemo()
        let start = app.buttons["push.demo.startActivity"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["push.demo.activityActive"].waitForExistence(timeout: 5),
            "starting a charging Live Activity marks it active"
        )
    }

    func testOpenSettingsShowsAuthorizationStatus() {
        let app = launchDemo()
        let openSettings = app.buttons["push.demo.openSettings"]
        XCTAssertTrue(openSettings.waitForExistence(timeout: 5))
        openSettings.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["push.settings.status"].waitForExistence(timeout: 5),
            "the settings screen surfaces the authorization status"
        )
    }
}
