import Foundation

/// The finite states the auth coordinator drives the app's root through. The
/// onboarding gate (`RootView`) renders exactly one surface per state, so there is
/// never a blank/indeterminate screen (ADR-011).
public enum AuthState: Equatable, Sendable {
    /// First launch tick while stored tokens are being restored.
    case initializing
    /// No valid session — the onboarding/sign-in surface is shown.
    case signedOut
    /// A system sign-in sheet (`ASWebAuthenticationSession`) is in flight.
    case authenticating
    /// A valid session exists and the app content is available.
    case authenticated
    /// A valid session exists but is gated behind a biometric/passcode unlock.
    case locked
    /// A silent token refresh is in flight after a 401.
    case reauthenticating
    /// Refresh failed; the user must sign in again. Secrets have been cleared.
    case reauthRequired
    /// A sign-in attempt failed; the error is shown with a retry affordance.
    case failed(AuthError)

    /// Whether the authenticated app shell should be mounted underneath.
    public var showsAppContent: Bool {
        switch self {
        case .authenticated, .locked, .reauthenticating, .reauthRequired: true
        case .initializing, .signedOut, .authenticating, .failed: false
        }
    }

    /// Whether a sign-in action can currently be started.
    public var canStartSignIn: Bool {
        switch self {
        case .signedOut, .reauthRequired, .failed: true
        case .initializing, .authenticating, .authenticated, .locked, .reauthenticating: false
        }
    }
}
