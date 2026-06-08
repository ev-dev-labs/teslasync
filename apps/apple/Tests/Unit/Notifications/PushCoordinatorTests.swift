import XCTest
@testable import TeslaSync

/// The push coordinator: authorization + token lifecycle, device registration,
/// deep-link routing, foreground presentation, and unregister. Driven by in-memory
/// fakes so no APNs runtime is required.
@MainActor final class PushCoordinatorTests: XCTestCase {
    func testRequestAuthorizationGrantsAndRegistersForRemote() async {
        let authorizer = PreviewPushAuthorizer(initial: .notDetermined, grants: .authorized)
        let coordinator = PushCoordinator.demo(authorizer: authorizer)

        await coordinator.requestAuthorization()
        XCTAssertEqual(coordinator.authorizationStatus, .authorized)
        XCTAssertEqual(coordinator.settingsModel.authorizationStatus, .authorized)
        XCTAssertEqual(authorizer.registerCount, 1, "granting authorization registers for remote notifications")
    }

    func testDidRegisterHexEncodesAndRegistersDevice() async {
        let registrar = InMemoryDeviceRegistrar()
        let coordinator = PushCoordinator.demo(registrar: registrar)

        await coordinator.didRegister(tokenData: Data([0xDE, 0xAD, 0xBE, 0xEF]))
        XCTAssertTrue(coordinator.isRegistered)
        XCTAssertEqual(registrar.registeredTokens, ["deadbeef"])
        XCTAssertNil(coordinator.lastError)
    }

    func testRegistrationFailureSurfacesErrorWithoutRegistering() async {
        let registrar = InMemoryDeviceRegistrar(failure: .network(message: "offline"))
        let coordinator = PushCoordinator.demo(registrar: registrar)

        await coordinator.didRegister(tokenData: Data([0x01]))
        XCTAssertFalse(coordinator.isRegistered)
        XCTAssertEqual(coordinator.lastError, .network(message: "offline"))
    }

    func testTapSetsAndConsumesPendingRoute() {
        let coordinator = PushCoordinator.demo()
        coordinator.handleTap(userInfo: DemoPushSamples.command())
        XCTAssertEqual(coordinator.pendingRoute, .vehicles)
        XCTAssertEqual(coordinator.consumePendingRoute(), .vehicles)
        XCTAssertNil(coordinator.pendingRoute, "consuming clears the pending route")
    }

    func testForegroundPresentationRaisesBannerForAlertContent() {
        let coordinator = PushCoordinator.demo()
        let presentation = coordinator.foregroundPresentation(for: DemoPushSamples.charging())
        XCTAssertFalse(presentation.isSuppressed)
        XCTAssertEqual(coordinator.foregroundBanner?.category, .charging)
        coordinator.dismissBanner()
        XCTAssertNil(coordinator.foregroundBanner)
    }

    func testOpenBannerRoutesAndDismisses() {
        let coordinator = PushCoordinator.demo()
        _ = coordinator.foregroundPresentation(for: DemoPushSamples.charging())
        coordinator.openBanner()
        XCTAssertEqual(coordinator.pendingRoute, .charging)
        XCTAssertNil(coordinator.foregroundBanner)
    }

    func testDisabledCategoryIsNotPresentedInForeground() {
        let coordinator = PushCoordinator.demo()
        coordinator.settingsModel.setCategory(.charging, enabled: false)
        let presentation = coordinator.foregroundPresentation(for: DemoPushSamples.charging())
        XCTAssertTrue(presentation.isSuppressed)
        XCTAssertNil(coordinator.foregroundBanner, "a disabled category shows no banner")
    }

    func testUnregisterRemovesDeviceAndStopsRemote() async {
        let authorizer = PreviewPushAuthorizer(initial: .authorized)
        let registrar = InMemoryDeviceRegistrar()
        let coordinator = PushCoordinator.demo(authorizer: authorizer, registrar: registrar)
        await coordinator.didRegister(tokenData: Data([0xAB]))

        await coordinator.unregister()
        XCTAssertFalse(coordinator.isRegistered)
        XCTAssertEqual(registrar.unregisteredTokens, ["ab"])
        XCTAssertEqual(authorizer.unregisterCount, 1)
    }
}
