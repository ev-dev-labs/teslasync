import Foundation
@testable import TeslaSync

// MARK: - Fakes

/// An `AuthBrowsing` returning a fixed outcome (a redirect URL or an error).
final class FakeAuthBrowsing: AuthBrowsing, @unchecked Sendable {
    enum Outcome {
        case redirect(URL)
        case failure(AuthError)
    }

    private let outcome: Outcome
    private let lock = NSLock()
    private var calls = 0

    init(_ outcome: Outcome) {
        self.outcome = outcome
    }

    var callCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return calls
    }

    func authenticate(url _: URL, callback _: RedirectCallback, prefersEphemeral _: Bool) async throws -> URL {
        recordCall()
        switch outcome {
        case let .redirect(url): return url
        case let .failure(error): throw error
        }
    }

    private func recordCall() {
        lock.lock()
        defer { lock.unlock() }
        calls += 1
    }
}

/// A `TokenEndpointing` that records call counts and returns configurable tokens,
/// with an optional delay so concurrency (single-flight) can be exercised.
final class RecordingTokenEndpoint: TokenEndpointing, @unchecked Sendable {
    private let lock = NSLock()
    private var exchange = 0
    private var refreshes = 0
    private var revokes = 0
    private let refreshDelayNanos: UInt64
    private let refreshError: AuthError?
    private let tokenFactory: @Sendable () -> AuthTokens

    init(
        refreshDelayNanos: UInt64 = 0,
        refreshError: AuthError? = nil,
        tokenFactory: @escaping @Sendable () -> AuthTokens = { AuthTokens.fixture() }
    ) {
        self.refreshDelayNanos = refreshDelayNanos
        self.refreshError = refreshError
        self.tokenFactory = tokenFactory
    }

    var exchangeCount: Int {
        read { exchange }
    }

    var refreshCount: Int {
        read { refreshes }
    }

    var revokeCount: Int {
        read { revokes }
    }

    func exchange(code _: String, verifier _: String, redirectURI _: URL) async throws -> AuthTokens {
        mutate { exchange += 1 }
        return tokenFactory()
    }

    func refresh(refreshToken _: String) async throws -> AuthTokens {
        if refreshDelayNanos > 0 {
            try? await Task.sleep(nanoseconds: refreshDelayNanos)
        }
        mutate { refreshes += 1 }
        if let refreshError {
            throw refreshError
        }
        return tokenFactory()
    }

    func revoke(token _: String, kind _: TokenKind) async throws {
        mutate { revokes += 1 }
    }

    private func read<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    private func mutate(_ body: () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        body()
    }
}

/// An `AuthBrowsing` that echoes the request `state` back on the redirect (as a
/// real IdP does), so the happy-path sign-in flow passes state validation.
final class EchoAuthBrowsing: AuthBrowsing, @unchecked Sendable {
    private let code: String
    private let redirectURI: URL

    init(
        code: String = "auth-code",
        redirectURI: URL = OIDCConfiguration.url("https://app.example.com/auth/callback")
    ) {
        self.code = code
        self.redirectURI = redirectURI
    }

    func authenticate(url: URL, callback _: RedirectCallback, prefersEphemeral _: Bool) async throws -> URL {
        let requestComponents = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let state = requestComponents?.queryItems?.first { $0.name == "state" }?.value ?? ""
        var redirect = URLComponents(url: redirectURI, resolvingAgainstBaseURL: false)
        redirect?.queryItems = [
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "state", value: state)
        ]
        guard let result = redirect?.url else {
            throw AuthError.invalidRedirect("could not build echo redirect")
        }
        return result
    }
}

// MARK: - Fixtures

extension AuthTokens {
    static func fixture(
        accessToken: String = "access-token",
        refreshToken: String? = "refresh-token",
        expiresIn: TimeInterval = 3600,
        now: Date = Date()
    ) -> AuthTokens {
        AuthTokens(
            accessToken: accessToken,
            refreshToken: refreshToken,
            idToken: nil,
            scope: "openid",
            issuedAt: now,
            expiresAt: now.addingTimeInterval(expiresIn)
        )
    }
}

extension OIDCConfiguration {
    static func fixture() -> OIDCConfiguration {
        OIDCConfiguration(
            issuer: url("https://auth.example.com"),
            authorizationEndpoint: url("https://auth.example.com/application/o/authorize/"),
            tokenEndpoint: url("https://auth.example.com/application/o/token/"),
            revocationEndpoint: url("https://auth.example.com/application/o/revoke/"),
            endSessionEndpoint: nil,
            clientID: "teslasync-apple",
            redirectURI: url("https://app.example.com/auth/callback"),
            callback: .universalLink(host: "app.example.com", path: "/auth/callback"),
            scopes: ["openid", "profile", "offline_access"]
        )
    }

    static func url(_ string: String) -> URL {
        guard let value = URL(string: string) else {
            preconditionFailure("invalid fixture URL: \(string)")
        }
        return value
    }
}

@MainActor
enum AuthCoordinatorFactory {
    static func make(
        tokens: AuthTokens? = nil,
        browser: AuthBrowsing = FakeAuthBrowsing(.failure(.cancelled)),
        endpoint: RecordingTokenEndpoint = RecordingTokenEndpoint(),
        biometric: BiometricAuthenticating = FixedBiometricGate(availability: .unavailable),
        biometricEnabled: Bool = false,
        configuration: OIDCConfiguration? = .fixture(),
        clock: @escaping () -> Date = { Date() }
    ) -> AuthCoordinator {
        AuthCoordinator(
            configuration: configuration,
            browser: browser,
            tokenEndpoint: endpoint,
            store: InMemoryTokenStore(tokens),
            biometrics: biometric,
            biometricPreferences: InMemoryBiometricPreferenceStore(enabled: biometricEnabled),
            log: AuthLog(),
            clock: clock
        )
    }
}
