import Foundation
import XCTest
@testable import TeslaSync

/// The auth state machine: restore, sign-in, single-flight refresh, 401 retry,
/// biometric unlock, and sign-out.
@MainActor
final class AuthCoordinatorTests: XCTestCase {
    // MARK: Restore

    func testRestoreSignedOutWhenNoTokens() async {
        let coordinator = AuthCoordinatorFactory.make()
        await coordinator.start()
        XCTAssertEqual(coordinator.state, .signedOut)
    }

    func testRestoreAuthenticatedWhenValidToken() async {
        let coordinator = AuthCoordinatorFactory.make(tokens: .fixture())
        await coordinator.start()
        XCTAssertEqual(coordinator.state, .authenticated)
    }

    func testRestoreLockedWhenBiometricEnabled() async {
        let coordinator = AuthCoordinatorFactory.make(
            tokens: .fixture(),
            biometric: FixedBiometricGate(availability: BiometricAvailability(isAvailable: true, kind: .faceID)),
            biometricEnabled: true
        )
        await coordinator.start()
        XCTAssertEqual(coordinator.state, .locked)
    }

    func testStartRefreshesExpiringToken() async {
        let endpoint = RecordingTokenEndpoint()
        let now = Date()
        let coordinator = AuthCoordinatorFactory.make(
            tokens: .fixture(expiresIn: 30, now: now),
            endpoint: endpoint,
            clock: { now }
        )
        await coordinator.start()
        XCTAssertEqual(coordinator.state, .authenticated)
        XCTAssertEqual(endpoint.refreshCount, 1)
    }

    // MARK: Sign-in

    func testSignInSuccessStoresTokens() async {
        let endpoint = RecordingTokenEndpoint()
        let coordinator = AuthCoordinatorFactory.make(browser: EchoAuthBrowsing(), endpoint: endpoint)
        await coordinator.signIn()
        XCTAssertEqual(coordinator.state, .authenticated)
        XCTAssertEqual(endpoint.exchangeCount, 1)
        let token = await coordinator.currentAccessToken()
        XCTAssertNotNil(token)
    }

    func testSignInCancelledReturnsToSignedOut() async {
        let coordinator = AuthCoordinatorFactory.make(browser: FakeAuthBrowsing(.failure(.cancelled)))
        await coordinator.signIn()
        XCTAssertEqual(coordinator.state, .signedOut)
    }

    func testSignInNotConfiguredFails() async {
        let coordinator = AuthCoordinatorFactory.make(configuration: nil)
        await coordinator.signIn()
        XCTAssertEqual(coordinator.state, .failed(.notConfigured))
    }

    // MARK: Refresh / 401

    func testValidAccessTokenDoesNotRefreshFreshToken() async throws {
        let endpoint = RecordingTokenEndpoint()
        let coordinator = AuthCoordinatorFactory.make(tokens: .fixture(expiresIn: 3600), endpoint: endpoint)
        await coordinator.start()
        let token = try await coordinator.validAccessToken()
        XCTAssertEqual(token, "access-token")
        XCTAssertEqual(endpoint.refreshCount, 0)
    }

    func testConcurrentUnauthorizedSharesSingleRefresh() async {
        let endpoint = RecordingTokenEndpoint(refreshDelayNanos: 50_000_000)
        let coordinator = AuthCoordinatorFactory.make(tokens: .fixture(), endpoint: endpoint)
        await coordinator.start()

        let results = await withTaskGroup(of: Bool.self) { group -> [Bool] in
            for _ in 0 ..< 5 {
                group.addTask { await coordinator.handleUnauthorized() }
            }
            var collected: [Bool] = []
            for await value in group {
                collected.append(value)
            }
            return collected
        }

        XCTAssertTrue(results.allSatisfy(\.self))
        XCTAssertEqual(endpoint.refreshCount, 1)
        XCTAssertEqual(coordinator.state, .authenticated)
    }

    func testUnauthorizedRefreshFailureRequiresReauthAndClearsSecrets() async {
        let endpoint = RecordingTokenEndpoint(refreshError: .refreshUnavailable)
        let coordinator = AuthCoordinatorFactory.make(tokens: .fixture(), endpoint: endpoint)
        await coordinator.start()
        let retried = await coordinator.handleUnauthorized()
        XCTAssertFalse(retried)
        XCTAssertEqual(coordinator.state, .reauthRequired)
        let token = await coordinator.currentAccessToken()
        XCTAssertNil(token)
    }

    // MARK: Sign-out

    func testSignOutClearsSecretsAndRevokes() async {
        let endpoint = RecordingTokenEndpoint()
        let coordinator = AuthCoordinatorFactory.make(tokens: .fixture(), endpoint: endpoint)
        await coordinator.start()
        await coordinator.signOut()
        XCTAssertEqual(coordinator.state, .signedOut)
        let token = await coordinator.currentAccessToken()
        XCTAssertNil(token)
        XCTAssertGreaterThanOrEqual(endpoint.revokeCount, 1)
    }

    // MARK: Biometrics

    func testUnlockSuccessAuthenticates() async {
        let coordinator = AuthCoordinatorFactory.make(
            tokens: .fixture(),
            biometric: FixedBiometricGate(
                availability: BiometricAvailability(isAvailable: true, kind: .faceID),
                succeeds: true
            ),
            biometricEnabled: true
        )
        await coordinator.start()
        XCTAssertEqual(coordinator.state, .locked)
        await coordinator.unlock()
        XCTAssertEqual(coordinator.state, .authenticated)
    }

    func testUnlockFailureStaysLocked() async {
        let coordinator = AuthCoordinatorFactory.make(
            tokens: .fixture(),
            biometric: FixedBiometricGate(
                availability: BiometricAvailability(isAvailable: true, kind: .faceID),
                succeeds: false
            ),
            biometricEnabled: true
        )
        await coordinator.start()
        await coordinator.unlock()
        XCTAssertEqual(coordinator.state, .locked)
        XCTAssertNotNil(coordinator.lastError)
    }

    func testSetBiometricUnlockRespectsAvailability() async {
        let coordinator = AuthCoordinatorFactory.make(biometric: FixedBiometricGate(availability: .unavailable))
        await coordinator.start()
        coordinator.setBiometricUnlock(true)
        XCTAssertFalse(coordinator.biometricUnlockEnabled)
    }

    func testSetBiometricUnlockEnabledWhenAvailable() async {
        let coordinator = AuthCoordinatorFactory.make(
            biometric: FixedBiometricGate(availability: BiometricAvailability(isAvailable: true, kind: .touchID))
        )
        await coordinator.start()
        coordinator.setBiometricUnlock(true)
        XCTAssertTrue(coordinator.biometricUnlockEnabled)
    }
}
