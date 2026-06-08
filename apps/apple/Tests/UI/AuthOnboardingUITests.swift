import XCTest

/// XCUITest coverage for the P4/P5 onboarding gate. Deterministic auth states are
/// injected with the `-uiTestAuthState` launch argument (see
/// `AuthCoordinator.bootstrap`), so no real `ASWebAuthenticationSession` or
/// Keychain is involved.
@MainActor
final class AuthOnboardingUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func launch(authState: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-uiTestAuthState", authState]
        app.launch()
        return app
    }

    func testFirstRunShowsSignInShell() {
        let app = launch(authState: "signedOut")
        XCTAssertTrue(
            app.buttons["auth.signIn.button"].waitForExistence(timeout: 5),
            "The onboarding sign-in shell should appear on first run"
        )
    }

    func testCancelledSignInReturnsToSignedOutShell() {
        let app = launch(authState: "signedOut")
        let signIn = app.buttons["auth.signIn.button"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 5))
        signIn.tap()
        // The system sheet is cancelled immediately by the injected browser; the
        // app must return to the signed-out shell, not crash or hang.
        XCTAssertTrue(signIn.waitForExistence(timeout: 5))
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testLockedStateShowsBiometricUnlockSeam() {
        let app = launch(authState: "locked")
        XCTAssertTrue(
            app.buttons["auth.unlock.button"].waitForExistence(timeout: 5),
            "The locked state should present the biometric unlock affordance"
        )
    }
}
