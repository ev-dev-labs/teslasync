import Foundation

/// Builds the front-channel OIDC Authorization Code + PKCE request and validates
/// the redirect that `ASWebAuthenticationSession` returns. Pure and deterministic
/// (given fixed PKCE/state/nonce) so it is fully unit-testable.
public struct OIDCAuthorizationRequest: Equatable, Sendable {
    public let configuration: OIDCConfiguration
    public let pkce: PKCE
    public let state: String
    public let nonce: String

    /// Creates a request with a fresh PKCE pair and random `state`/`nonce`.
    public init(configuration: OIDCConfiguration) {
        self.init(
            configuration: configuration,
            pkce: PKCE(),
            state: Entropy.secureToken(),
            nonce: Entropy.secureToken()
        )
    }

    /// Designated initializer with explicit values — used by unit tests to make
    /// the authorize-URL and redirect-parsing assertions deterministic.
    init(configuration: OIDCConfiguration, pkce: PKCE, state: String, nonce: String) {
        self.configuration = configuration
        self.pkce = pkce
        self.state = state
        self.nonce = nonce
    }

    /// The authorize URL to open in the system browser.
    public func authorizationURL() throws -> URL {
        guard var components = URLComponents(
            url: configuration.authorizationEndpoint,
            resolvingAgainstBaseURL: false
        ) else {
            throw AuthError.invalidAuthorizationURL
        }
        var items = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: configuration.clientID),
            URLQueryItem(name: "redirect_uri", value: configuration.redirectURI.absoluteString),
            URLQueryItem(name: "scope", value: configuration.scopeString),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: PKCE.method)
        ]
        if let audience = configuration.audience {
            items.append(URLQueryItem(name: "audience", value: audience))
        }
        components.queryItems = (components.queryItems ?? []) + items
        guard let url = components.url else {
            throw AuthError.invalidAuthorizationURL
        }
        return url
    }

    /// Extracts the authorization `code` from the redirect, rejecting an OAuth
    /// `error` response and any `state` that does not match the request (CSRF).
    public func authorizationCode(from redirect: URL) throws -> String {
        guard let components = URLComponents(url: redirect, resolvingAgainstBaseURL: false) else {
            throw AuthError.invalidRedirect("unparseable redirect URL")
        }
        let items = components.queryItems ?? []
        let value: (String) -> String? = { name in
            items.first(where: { $0.name == name })?.value
        }
        if let error = value("error") {
            throw AuthError.authorizationServer(error: error, description: value("error_description"))
        }
        guard let returnedState = value("state") else {
            throw AuthError.invalidRedirect("missing state")
        }
        guard returnedState == state else {
            throw AuthError.stateMismatch
        }
        guard let code = value("code"), !code.isEmpty else {
            throw AuthError.invalidRedirect("missing authorization code")
        }
        return code
    }
}
