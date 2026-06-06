import Foundation

/// Error taxonomy for the Apple-native auth stack. `errorDescription` is concise,
/// log-safe English (never contains tokens); the UI renders `localizationKey`
/// through the String Catalog so user-facing copy stays localized (ADR-014).
public enum AuthError: Error, Equatable, Sendable {
    /// No OIDC client configuration was found (missing Info.plist keys).
    case notConfigured
    /// The user dismissed the system sign-in sheet.
    case cancelled
    /// The authorization request URL could not be constructed.
    case invalidAuthorizationURL
    /// The redirect callback was missing the `code`/`state` or was malformed.
    case invalidRedirect(String)
    /// The returned `state` did not match the request (possible CSRF) — rejected.
    case stateMismatch
    /// The authorization endpoint returned an OAuth `error` on the redirect.
    case authorizationServer(error: String, description: String?)
    /// The token endpoint returned a non-2xx response.
    case tokenEndpoint(status: Int, error: String?, description: String?)
    /// Transport failure talking to the token endpoint.
    case network(String)
    /// A 2xx token response could not be decoded.
    case decoding(String)
    /// A Keychain operation failed with the given `OSStatus`.
    case keychain(OSStatus)
    /// Biometric/passcode authentication is not available on this device.
    case biometricUnavailable
    /// Biometric/passcode evaluation failed or was cancelled by the user.
    case biometricFailed(String)
    /// A refresh was requested but no refresh token is available.
    case refreshUnavailable
    /// An access token was expected but none is present.
    case missingAccessToken

    /// The String Catalog key the UI uses to present this error.
    public var localizationKey: String {
        switch self {
        case .notConfigured: "auth.error.notConfigured"
        case .cancelled: "auth.error.cancelled"
        case .invalidAuthorizationURL, .invalidRedirect, .stateMismatch: "auth.error.protocol"
        case .authorizationServer, .tokenEndpoint: "auth.error.server"
        case .network: "auth.error.network"
        case .decoding: "auth.error.decoding"
        case .keychain: "auth.error.keychain"
        case .biometricUnavailable: "auth.error.biometricUnavailable"
        case .biometricFailed: "auth.error.biometric"
        case .refreshUnavailable, .missingAccessToken: "auth.error.session"
        }
    }
}

extension AuthError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .notConfigured:
            "OIDC client configuration is missing."
        case .cancelled:
            "Sign-in was cancelled."
        case .invalidAuthorizationURL:
            "Could not build the authorization request."
        case let .invalidRedirect(detail):
            "Invalid authorization redirect: \(detail)."
        case .stateMismatch:
            "Authorization state mismatch — request rejected."
        case let .authorizationServer(error, description):
            "Authorization error \(error): \(description ?? "no description")."
        case let .tokenEndpoint(status, error, description):
            "Token endpoint failed (\(status)) \(error ?? ""): \(description ?? "")."
        case let .network(detail):
            "Network error: \(detail)."
        case let .decoding(detail):
            "Could not decode the token response: \(detail)."
        case let .keychain(status):
            "Keychain error (OSStatus \(status))."
        case .biometricUnavailable:
            "Biometric authentication is unavailable."
        case let .biometricFailed(detail):
            "Biometric authentication failed: \(detail)."
        case .refreshUnavailable:
            "No refresh token is available."
        case .missingAccessToken:
            "No access token is available."
        }
    }
}
