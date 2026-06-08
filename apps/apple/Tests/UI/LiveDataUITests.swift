import XCTest

/// XCUITest coverage for the live-data lifecycle demo (`-uiTestLiveDemo`). The
/// same file runs in the iOS and macOS UI-test targets, so it proves the live
/// indicator + stale-banner behavior on both idioms. The demo drives a
/// `DemoLiveSource` turn by turn, so no real SSE backend is involved.
@MainActor final class LiveDataUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func launchDemo() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-uiTestLiveDemo"]
        app.launch()
        return app
    }

    func testLiveIndicatorAndContentAppear() {
        let app = launchDemo()
        XCTAssertTrue(
            app.descendants(matching: .any)["live.indicator"].waitForExistence(timeout: 5),
            "The live indicator should be visible on the demo surface"
        )
        XCTAssertTrue(
            app.staticTexts["live.demo.updates"].waitForExistence(timeout: 5),
            "Live content should render once the first event arrives"
        )
    }

    func testGoStaleShowsStaleBannerThenReconnectClearsIt() {
        let app = launchDemo()
        let goStale = app.buttons["live.demo.goStale"]
        XCTAssertTrue(goStale.waitForExistence(timeout: 5))
        goStale.tap()

        let reconnect = app.buttons["live.reconnect.button"]
        XCTAssertTrue(
            reconnect.waitForExistence(timeout: 5),
            "Going stale must surface the stale banner with a reconnect affordance"
        )

        app.buttons["live.demo.reconnect"].tap()
        XCTAssertTrue(
            waitForDisappearance(of: reconnect, timeout: 5),
            "Reconnecting must clear the stale banner"
        )
    }

    func testPushUpdateKeepsSurfaceLive() {
        let app = launchDemo()
        let push = app.buttons["live.demo.pushUpdate"]
        XCTAssertTrue(push.waitForExistence(timeout: 5))
        push.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["live.indicator"].waitForExistence(timeout: 5),
            "Pushing a fresh update keeps the surface live"
        )
    }

    private func waitForDisappearance(of element: XCUIElement, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "exists == false")
        let expectation = expectation(for: predicate, evaluatedWith: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }
}
