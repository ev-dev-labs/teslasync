import Foundation

/// An `AuthBrowsing` that never opens a browser — it immediately reports
/// cancellation. Used by SwiftUI previews and UI tests that exercise the
/// signed-out / cancelled paths without a real `ASWebAuthenticationSession`.
public struct NoOpAuthBrowsing: AuthBrowsing {
    public init() {}

    public func authenticate(url _: URL, callback _: RedirectCallback, prefersEphemeral _: Bool) async throws -> URL {
        throw AuthError.cancelled
    }
}

/// A `BiometricAuthenticating` with a fixed availability and outcome, for
/// previews and deterministic UI-test states (no real Face ID / Touch ID).
public struct FixedBiometricGate: BiometricAuthenticating {
    private let fixed: BiometricAvailability
    private let succeeds: Bool

    public init(availability: BiometricAvailability, succeeds: Bool = true) {
        fixed = availability
        self.succeeds = succeeds
    }

    public func availability() -> BiometricAvailability {
        fixed
    }

    public func evaluate(reason _: String) async throws {
        if !succeeds { throw AuthError.biometricFailed("preview") }
    }
}

/// In-memory `BiometricPreferenceStoring` so previews/UI tests don't touch
/// `UserDefaults`.
public final class InMemoryBiometricPreferenceStore: BiometricPreferenceStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var enabled: Bool

    public init(enabled: Bool = false) {
        self.enabled = enabled
    }

    public var isEnabled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return enabled
    }

    public func setEnabled(_ value: Bool) {
        lock.lock()
        defer { lock.unlock() }
        enabled = value
    }
}

public extension AuthCoordinator {
    /// A coordinator wired entirely to in-memory doubles for SwiftUI previews —
    /// Face ID shows as available so the unlock surface renders realistically.
    static func preview(
        biometric: BiometricAvailability = BiometricAvailability(isAvailable: true, kind: .faceID),
        tokens: AuthTokens? = nil,
        biometricEnabled: Bool = false,
        configuration: OIDCConfiguration? = nil
    ) -> AuthCoordinator {
        AuthCoordinator(
            configuration: configuration,
            browser: NoOpAuthBrowsing(),
            tokenEndpoint: nil,
            store: InMemoryTokenStore(tokens),
            biometrics: FixedBiometricGate(availability: biometric),
            biometricPreferences: InMemoryBiometricPreferenceStore(enabled: biometricEnabled)
        )
    }

    /// Selects the real coordinator, or a deterministic in-memory one when the
    /// process is launched by an XCUITest (`-uiTestAuthState <state>`).
    static func bootstrap(processInfo: ProcessInfo = .processInfo, bundle: Bundle = .main) -> AuthCoordinator {
        let arguments = processInfo.arguments
        guard let index = arguments.firstIndex(of: "-uiTestAuthState"), index + 1 < arguments.count else {
            return .live(bundle: bundle)
        }
        return uiTesting(state: arguments[index + 1])
    }

    private static func uiTesting(state: String) -> AuthCoordinator {
        let validToken = AuthTokens(
            accessToken: "ui-test-access",
            refreshToken: "ui-test-refresh",
            idToken: nil,
            scope: "openid",
            issuedAt: Date(),
            expiresAt: Date().addingTimeInterval(3600)
        )
        switch state {
        case "locked":
            return preview(tokens: validToken, biometricEnabled: true)
        case "authenticated":
            return preview(biometric: .unavailable, tokens: validToken)
        default:
            // Signed-out with a config so tapping "Sign in" exercises the
            // (immediately cancelled) browser path and returns to signed-out.
            return preview(biometric: .unavailable, configuration: uiTestConfiguration)
        }
    }

    private static let uiTestConfiguration = OIDCConfiguration(
        issuer: URL(string: "https://auth.example.com")!,
        authorizationEndpoint: URL(string: "https://auth.example.com/application/o/authorize/")!,
        tokenEndpoint: URL(string: "https://auth.example.com/application/o/token/")!,
        clientID: "teslasync-apple",
        redirectURI: URL(string: "https://app.example.com/auth/callback")!,
        callback: .universalLink(host: "app.example.com", path: "/auth/callback")
    )
}
