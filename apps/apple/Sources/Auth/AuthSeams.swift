import Foundation

/// Supplies the bearer access token to the networking layer. The facade's
/// `ApiHttpClient` reads this for the `Authorization` header (ADR-008/ADR-009).
public protocol AuthTokenProviding: AnyObject, Sendable {
    /// The current access token if one is present and unexpired, else `nil`.
    func currentAccessToken() async -> String?
    /// A valid access token, refreshing first if the current one is missing or
    /// (about to be) expired. Throws when no usable session can be produced.
    func validAccessToken() async throws -> String
}

/// Centralized 401 handling. The networking layer calls this once it sees an
/// unauthorized response; the coordinator performs a single in-flight refresh and
/// reports whether the original request can be retried (ADR-009).
public protocol AuthChallengeHandling: AnyObject, Sendable {
    @discardableResult
    func handleUnauthorized() async -> Bool
}
