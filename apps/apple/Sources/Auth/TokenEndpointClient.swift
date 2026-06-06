import Foundation

/// Token type hint for RFC 7009 revocation.
public enum TokenKind: String, Sendable {
    case accessToken = "access_token"
    case refreshToken = "refresh_token"
}

/// Back-channel OAuth token operations against the OIDC provider.
public protocol TokenEndpointing: Sendable {
    func exchange(code: String, verifier: String, redirectURI: URL) async throws -> AuthTokens
    func refresh(refreshToken: String) async throws -> AuthTokens
    func revoke(token: String, kind: TokenKind) async throws
}

/// `TokenEndpointing` over `URLSession`. A test session (custom `URLProtocol`)
/// can be injected so the exchange/refresh/revoke paths are covered without a
/// real network or browser.
public final class TokenEndpointClient: TokenEndpointing {
    private let configuration: OIDCConfiguration
    private let session: URLSession

    public init(configuration: OIDCConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    public func exchange(code: String, verifier: String, redirectURI: URL) async throws -> AuthTokens {
        let form = [
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirectURI.absoluteString,
            "client_id": configuration.clientID,
            "code_verifier": verifier
        ]
        return try await postForTokens(form, previousRefreshToken: nil)
    }

    public func refresh(refreshToken: String) async throws -> AuthTokens {
        let form = [
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
            "client_id": configuration.clientID,
            "scope": configuration.scopeString
        ]
        return try await postForTokens(form, previousRefreshToken: refreshToken)
    }

    public func revoke(token: String, kind: TokenKind) async throws {
        guard let endpoint = configuration.revocationEndpoint else { return }
        let form = [
            "token": token,
            "token_type_hint": kind.rawValue,
            "client_id": configuration.clientID
        ]
        _ = try await send(to: endpoint, form: form)
    }

    private func postForTokens(_ form: [String: String], previousRefreshToken: String?) async throws -> AuthTokens {
        let data = try await send(to: configuration.tokenEndpoint, form: form)
        do {
            let response = try JSONDecoder().decode(TokenResponse.self, from: data)
            return response.tokens(previousRefreshToken: previousRefreshToken)
        } catch {
            throw AuthError.decoding(String(describing: error))
        }
    }

    @discardableResult
    private func send(to endpoint: URL, form: [String: String]) async throws -> Data {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = Self.encodeForm(form)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AuthError.network(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw AuthError.network("non-HTTP response")
        }
        guard (200 ..< 300).contains(http.statusCode) else {
            let parsed = Self.parseError(data)
            throw AuthError.tokenEndpoint(status: http.statusCode, error: parsed.error, description: parsed.description)
        }
        return data
    }

    /// Deterministically (sorted-by-key) percent-encodes a form body, encoding
    /// everything outside `[A-Za-z0-9]` so `+`, `/`, `=`, and spaces are safe.
    static func encodeForm(_ form: [String: String]) -> Data {
        let allowed = CharacterSet.alphanumerics
        let pairs = form.sorted { $0.key < $1.key }.map { key, value -> String in
            let encodedKey = key.addingPercentEncoding(withAllowedCharacters: allowed) ?? key
            let encodedValue = value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
            return "\(encodedKey)=\(encodedValue)"
        }
        return Data(pairs.joined(separator: "&").utf8)
    }

    static func parseError(_ data: Data) -> (error: String?, description: String?) {
        guard let body = try? JSONDecoder().decode(OAuthErrorBody.self, from: data) else {
            return (nil, nil)
        }
        return (body.error, body.errorDescription)
    }
}

/// OAuth/OIDC error response body (`{"error", "error_description"}`). File-scoped
/// so its `CodingKeys` stays within the linter's type-nesting depth.
private struct OAuthErrorBody: Decodable {
    let error: String?
    let errorDescription: String?

    enum CodingKeys: String, CodingKey {
        case error
        case errorDescription = "error_description"
    }
}
