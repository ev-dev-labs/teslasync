import Foundation

/// The OIDC token set held for an authenticated session. Persisted (as JSON) only
/// in the Keychain via `TokenStoring` — never in `UserDefaults`, files, or logs.
public struct AuthTokens: Codable, Equatable, Sendable {
    public let accessToken: String
    public let refreshToken: String?
    public let idToken: String?
    public let tokenType: String
    public let scope: String?
    public let issuedAt: Date
    public let expiresAt: Date?

    public init(
        accessToken: String,
        refreshToken: String?,
        idToken: String?,
        tokenType: String = "Bearer",
        scope: String?,
        issuedAt: Date,
        expiresAt: Date?
    ) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.idToken = idToken
        self.tokenType = tokenType
        self.scope = scope
        self.issuedAt = issuedAt
        self.expiresAt = expiresAt
    }

    /// True once `expiresAt` has passed (a small clock-skew margin is applied so a
    /// token is treated as dead slightly early rather than used past expiry).
    public func isExpired(now: Date = Date(), clockSkew: TimeInterval = 30) -> Bool {
        guard let expiresAt else { return false }
        return now.addingTimeInterval(clockSkew) >= expiresAt
    }

    /// True when the token is still valid but within `window` of expiring — drives
    /// proactive refresh and the "session expiring" UI affordance.
    public func isExpiringSoon(within window: TimeInterval = 300, now: Date = Date()) -> Bool {
        guard let expiresAt else { return false }
        return expiresAt.timeIntervalSince(now) <= window
    }

    /// A log-safe summary that never exposes token material (ADR-016).
    public var redactedDescription: String {
        let expiry = expiresAt.map { ISO8601DateFormatter().string(from: $0) } ?? "none"
        return "AuthTokens(type: \(tokenType), hasRefresh: \(refreshToken != nil), expiresAt: \(expiry))"
    }
}

/// Raw OIDC/OAuth token endpoint response (`application/json`, snake_case). Mapped
/// into `AuthTokens` with an absolute `expiresAt` computed from `expires_in`.
struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    let idToken: String?
    let tokenType: String?
    let scope: String?
    let expiresIn: Double?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case idToken = "id_token"
        case tokenType = "token_type"
        case scope
        case expiresIn = "expires_in"
    }

    /// Folds the response into `AuthTokens`, preserving the previous refresh token
    /// when the server omits one on refresh (Authentik may not rotate it).
    func tokens(issuedAt: Date = Date(), previousRefreshToken: String? = nil) -> AuthTokens {
        AuthTokens(
            accessToken: accessToken,
            refreshToken: refreshToken ?? previousRefreshToken,
            idToken: idToken,
            tokenType: tokenType ?? "Bearer",
            scope: scope,
            issuedAt: issuedAt,
            expiresAt: expiresIn.map { issuedAt.addingTimeInterval($0) }
        )
    }
}
