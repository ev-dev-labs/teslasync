import Foundation

/// Where the OS browser hands the OIDC authorization response back to the app.
///
/// `ASWebAuthenticationSession` supports an HTTPS (associated-domain Universal
/// Link) callback as well as a custom URL scheme. ADR-008 prefers the Universal
/// Link; the custom scheme is the documented fallback when the locked Authentik
/// client config requires it.
public enum RedirectCallback: Equatable, Sendable {
    case universalLink(host: String, path: String)
    case customScheme(String)
}

/// Static OIDC client configuration for the native app (ADR-008). Holds no
/// secrets beyond the public `clientID` (native apps are public OAuth clients —
/// security comes from PKCE, not a client secret).
public struct OIDCConfiguration: Equatable, Sendable {
    public let issuer: URL
    public let authorizationEndpoint: URL
    public let tokenEndpoint: URL
    public let revocationEndpoint: URL?
    public let endSessionEndpoint: URL?
    public let clientID: String
    public let redirectURI: URL
    public let callback: RedirectCallback
    public let scopes: [String]
    public let audience: String?

    public init(
        issuer: URL,
        authorizationEndpoint: URL,
        tokenEndpoint: URL,
        revocationEndpoint: URL? = nil,
        endSessionEndpoint: URL? = nil,
        clientID: String,
        redirectURI: URL,
        callback: RedirectCallback,
        scopes: [String] = ["openid", "profile", "email", "offline_access"],
        audience: String? = nil
    ) {
        self.issuer = issuer
        self.authorizationEndpoint = authorizationEndpoint
        self.tokenEndpoint = tokenEndpoint
        self.revocationEndpoint = revocationEndpoint
        self.endSessionEndpoint = endSessionEndpoint
        self.clientID = clientID
        self.redirectURI = redirectURI
        self.callback = callback
        self.scopes = scopes
        self.audience = audience
    }

    /// Space-delimited scope string for the authorize/token requests.
    public var scopeString: String {
        scopes.joined(separator: " ")
    }

    /// The custom URL scheme, when the callback uses one (nil for Universal Links).
    public var callbackScheme: String? {
        switch callback {
        case let .customScheme(scheme): scheme
        case .universalLink: nil
        }
    }
}

public extension OIDCConfiguration {
    /// Info.plist keys the app bundle may define to configure auth without code.
    enum InfoKey {
        public static let issuer = "TSAuthIssuer"
        public static let clientID = "TSAuthClientID"
        public static let redirectURI = "TSAuthRedirectURI"
        public static let scopes = "TSAuthScopes"
        public static let customScheme = "TSAuthCustomScheme"
    }

    /// Loads configuration from the bundle's Info.plist, deriving the standard
    /// Authentik endpoint paths from the issuer. Returns `nil` when the required
    /// keys are absent so the coordinator can surface a clear "not configured"
    /// state instead of attempting a malformed sign-in.
    static func load(from bundle: Bundle = .main) -> OIDCConfiguration? {
        guard
            let issuerString = bundle.object(forInfoDictionaryKey: InfoKey.issuer) as? String,
            let issuer = URL(string: issuerString),
            let clientID = bundle.object(forInfoDictionaryKey: InfoKey.clientID) as? String,
            let redirectString = bundle.object(forInfoDictionaryKey: InfoKey.redirectURI) as? String,
            let redirectURI = URL(string: redirectString)
        else {
            return nil
        }

        let scopes = (bundle.object(forInfoDictionaryKey: InfoKey.scopes) as? String)
            .map { $0.split(whereSeparator: { $0 == " " || $0 == "," }).map(String.init) }
            ?? ["openid", "profile", "email", "offline_access"]

        let callback = Self.callback(
            for: redirectURI,
            customScheme: bundle.object(forInfoDictionaryKey: InfoKey.customScheme) as? String
        )

        return OIDCConfiguration(
            issuer: issuer,
            authorizationEndpoint: Self.authentikEndpoint(issuer, "authorize"),
            tokenEndpoint: Self.authentikEndpoint(issuer, "token"),
            revocationEndpoint: Self.authentikEndpoint(issuer, "revoke"),
            endSessionEndpoint: Self.authentikEndpoint(issuer, "end-session"),
            clientID: clientID,
            redirectURI: redirectURI,
            callback: callback,
            scopes: scopes
        )
    }

    /// Authentik OIDC provider endpoints live under `/application/o/<name>/`.
    private static func authentikEndpoint(_ issuer: URL, _ name: String) -> URL {
        issuer.appendingPathComponent("application/o/\(name)/")
    }

    private static func callback(for redirectURI: URL, customScheme: String?) -> RedirectCallback {
        if let customScheme, !customScheme.isEmpty {
            return .customScheme(customScheme)
        }
        if redirectURI.scheme?.lowercased() == "https", let host = redirectURI.host {
            return .universalLink(host: host, path: redirectURI.path)
        }
        return .customScheme(redirectURI.scheme ?? "teslasync")
    }
}
