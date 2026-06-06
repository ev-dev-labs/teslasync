import Foundation
import Observation

/// The auth state machine and the app's single source of session truth.
///
/// Owns token lifecycle (restore → sign-in → refresh → sign-out), drives the
/// onboarding gate via `state`, and implements the networking/SSE seams
/// (`AuthTokenProviding`, `AuthChallengeHandling`). All UI-affecting mutation
/// happens on the main actor; the refresh path is single-flight so concurrent
/// 401s share exactly one network refresh (ADR-008/ADR-009).
@MainActor
@Observable
public final class AuthCoordinator: AuthTokenProviding, AuthChallengeHandling {
    public private(set) var state: AuthState = .initializing
    public private(set) var biometricAvailability: BiometricAvailability = .unavailable
    public private(set) var biometricUnlockEnabled = false
    public private(set) var isSessionExpiringSoon = false
    public private(set) var lastError: AuthError?

    @ObservationIgnored private let configuration: OIDCConfiguration?
    @ObservationIgnored private let browser: AuthBrowsing
    @ObservationIgnored private let tokenEndpoint: TokenEndpointing?
    @ObservationIgnored private let store: TokenStoring
    @ObservationIgnored private let biometrics: BiometricAuthenticating
    @ObservationIgnored private let biometricPreferences: BiometricPreferenceStoring
    @ObservationIgnored private let log: AuthLog
    @ObservationIgnored private let clock: () -> Date

    @ObservationIgnored private var tokens: AuthTokens?
    @ObservationIgnored private var refreshTask: Task<String, Error>?
    @ObservationIgnored private var stateObservers: [UUID: AsyncStream<AuthState>.Continuation] = [:]

    public init(
        configuration: OIDCConfiguration?,
        browser: AuthBrowsing,
        tokenEndpoint: TokenEndpointing?,
        store: TokenStoring,
        biometrics: BiometricAuthenticating,
        biometricPreferences: BiometricPreferenceStoring,
        log: AuthLog = AuthLog(),
        clock: @escaping () -> Date = { Date() }
    ) {
        self.configuration = configuration
        self.browser = browser
        self.tokenEndpoint = tokenEndpoint
        self.store = store
        self.biometrics = biometrics
        self.biometricPreferences = biometricPreferences
        self.log = log
        self.clock = clock
        biometricUnlockEnabled = biometricPreferences.isEnabled
    }

    /// Builds a coordinator wired to the real OS services (Keychain, system
    /// browser, token endpoint, biometrics). Configuration is read from the
    /// bundle's Info.plist; absence surfaces as a clear "not configured" state.
    public static func live(bundle: Bundle = .main) -> AuthCoordinator {
        let configuration = OIDCConfiguration.load(from: bundle)
        return AuthCoordinator(
            configuration: configuration,
            browser: AppleAuthSession(),
            tokenEndpoint: configuration.map { TokenEndpointClient(configuration: $0) },
            store: KeychainTokenStore(),
            biometrics: BiometricGate(),
            biometricPreferences: BiometricPreferenceStore()
        )
    }

    // MARK: - Lifecycle

    /// Restores any stored session on launch. Idempotent for the initial tick.
    public func start() async {
        biometricAvailability = biometrics.availability()
        if !biometricAvailability.isAvailable, biometricUnlockEnabled {
            // Biometrics were enabled but are no longer available (e.g. removed);
            // fall back to an ungated session rather than locking the user out.
            setBiometricUnlock(false)
        }
        await restore()
    }

    private func restore() async {
        do {
            guard let stored = try store.load() else {
                transition(to: .signedOut)
                return
            }
            tokens = stored
            if biometricUnlockEnabled, biometricAvailability.isAvailable {
                transition(to: .locked)
            } else {
                await resumeAuthenticatedSession()
            }
        } catch {
            log.error("session restore failed: \(String(describing: error))")
            clearInvalidSecrets()
            transition(to: .signedOut)
        }
    }

    // MARK: - Sign-in

    /// Runs the OIDC Authorization Code + PKCE flow via the system browser.
    public func signIn() async {
        guard let configuration, let tokenEndpoint else {
            lastError = .notConfigured
            transition(to: .failed(.notConfigured))
            return
        }
        lastError = nil
        transition(to: .authenticating)
        do {
            let request = OIDCAuthorizationRequest(configuration: configuration)
            let authorizationURL = try request.authorizationURL()
            let redirect = try await browser.authenticate(
                url: authorizationURL,
                callback: configuration.callback,
                prefersEphemeral: false
            )
            log.info("authorization redirect received: \(AuthLog.redactURL(redirect))")
            let code = try request.authorizationCode(from: redirect)
            let newTokens = try await tokenEndpoint.exchange(
                code: code,
                verifier: request.pkce.verifier,
                redirectURI: configuration.redirectURI
            )
            try persist(newTokens)
            refreshExpiryFlag()
            log.info("sign-in complete: \(newTokens.redactedDescription)")
            transition(to: .authenticated)
        } catch let error as AuthError {
            handleSignInFailure(error)
        } catch {
            handleSignInFailure(.network(error.localizedDescription))
        }
    }

    private func handleSignInFailure(_ error: AuthError) {
        if error == .cancelled {
            log.info("sign-in cancelled by user")
            transition(to: tokens == nil ? .signedOut : .reauthRequired)
            return
        }
        lastError = error
        log.error("sign-in failed: \(error.errorDescription ?? "unknown")")
        transition(to: .failed(error))
    }

    // MARK: - Biometric unlock

    /// Evaluates the biometric/passcode gate and resumes the stored session.
    public func unlock() async {
        do {
            try await biometrics.evaluate(reason: String(localized: "auth.biometric.reason"))
            lastError = nil
            await resumeAuthenticatedSession()
        } catch let error as AuthError {
            lastError = error
            log.error("biometric unlock failed: \(error.errorDescription ?? "unknown")")
            transition(to: .locked)
        } catch {
            transition(to: .locked)
        }
    }

    /// Enables/disables the optional biometric unlock preference. Only the flag is
    /// stored (never tokens), and it cannot be enabled when unavailable.
    public func setBiometricUnlock(_ enabled: Bool) {
        let resolved = enabled && biometricAvailability.isAvailable
        biometricPreferences.setEnabled(resolved)
        biometricUnlockEnabled = resolved
    }

    // MARK: - Sign-out

    /// Revokes (best-effort) and clears all secrets, returning to signed-out.
    public func signOut() async {
        if let tokenEndpoint, let current = tokens {
            if let refreshToken = current.refreshToken {
                try? await tokenEndpoint.revoke(token: refreshToken, kind: .refreshToken)
            }
            try? await tokenEndpoint.revoke(token: current.accessToken, kind: .accessToken)
        }
        clearInvalidSecrets()
        lastError = nil
        transition(to: .signedOut)
    }

    // MARK: - AuthTokenProviding

    public func currentAccessToken() async -> String? {
        guard let current = tokens, !current.isExpired(now: clock()) else { return nil }
        return current.accessToken
    }

    public func validAccessToken() async throws -> String {
        if let current = tokens, !current.isExpired(now: clock()), !current.isExpiringSoon(now: clock()) {
            return current.accessToken
        }
        return try await refresh()
    }

    // MARK: - AuthChallengeHandling

    @discardableResult
    public func handleUnauthorized() async -> Bool {
        guard tokens?.refreshToken != nil else {
            await failRefresh()
            return false
        }
        if state == .authenticated {
            transition(to: .reauthenticating)
        }
        do {
            _ = try await refresh()
            transition(to: .authenticated)
            return true
        } catch {
            await failRefresh()
            return false
        }
    }

    // MARK: - Auth-state stream (SSE re-auth seam)

    /// An async stream of state changes the live/SSE layer observes so it can tear
    /// down and re-subscribe its stream when the session re-authenticates.
    public func authStateStream() -> AsyncStream<AuthState> {
        AsyncStream { continuation in
            let id = UUID()
            continuation.yield(state)
            stateObservers[id] = continuation
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.stateObservers[id] = nil }
            }
        }
    }

    // MARK: - Internals

    /// Single-flight refresh: concurrent callers await the same in-flight task, so
    /// a burst of 401s triggers exactly one network refresh.
    private func refresh() async throws -> String {
        if let existing = refreshTask {
            return try await existing.value
        }
        guard let tokenEndpoint, let refreshToken = tokens?.refreshToken else {
            throw AuthError.refreshUnavailable
        }
        let task = Task { () throws -> String in
            let refreshed = try await tokenEndpoint.refresh(refreshToken: refreshToken)
            try persist(refreshed)
            refreshExpiryFlag()
            log.info("token refreshed: \(refreshed.redactedDescription)")
            return refreshed.accessToken
        }
        refreshTask = task
        defer { refreshTask = nil }
        return try await task.value
    }

    private func resumeAuthenticatedSession() async {
        guard let current = tokens else {
            transition(to: .signedOut)
            return
        }
        if current.isExpired(now: clock()) || current.isExpiringSoon(now: clock()) {
            do {
                _ = try await refresh()
                transition(to: .authenticated)
            } catch {
                await failRefresh()
            }
        } else {
            refreshExpiryFlag()
            transition(to: .authenticated)
        }
    }

    private func persist(_ newTokens: AuthTokens) throws {
        tokens = newTokens
        try store.save(newTokens)
    }

    private func failRefresh() async {
        log.error("token refresh failed — clearing session and requiring re-auth")
        clearInvalidSecrets()
        transition(to: .reauthRequired)
    }

    private func clearInvalidSecrets() {
        tokens = nil
        isSessionExpiringSoon = false
        try? store.clear()
    }

    private func refreshExpiryFlag() {
        isSessionExpiringSoon = tokens?.isExpiringSoon(now: clock()) ?? false
    }

    private func transition(to newState: AuthState) {
        guard newState != state else { return }
        state = newState
        for continuation in stateObservers.values {
            continuation.yield(newState)
        }
    }
}
