import XCTest

/// Smoke test: the app launches to its navigation shell on both idioms.
@MainActor
final class AppLaunchUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testAppLaunchesToForeground() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertEqual(app.state, .runningForeground, "App should reach the foreground after launch")
    }
}
