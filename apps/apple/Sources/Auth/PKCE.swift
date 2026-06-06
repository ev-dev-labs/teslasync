import CryptoKit
import Foundation

/// OAuth 2.0 PKCE parameters (RFC 7636) for the Authorization Code flow.
///
/// The `verifier` is a high-entropy URL-safe secret kept in memory only for the
/// duration of one sign-in; the `challenge` is `BASE64URL(SHA256(verifier))` and
/// is the only PKCE value that travels on the front channel. Always `S256` — the
/// `plain` method is intentionally unsupported.
public struct PKCE: Equatable, Sendable {
    /// PKCE challenge method. Only `S256` is produced.
    public static let method = "S256"

    public let verifier: String
    public let challenge: String

    /// Generates a fresh verifier (256 bits → 43 chars, within the RFC 7636
    /// 43–128 range and entirely within the unreserved character set).
    public init() {
        self.init(verifier: Entropy.secureToken(byteCount: 32))
    }

    /// Derives the challenge from a supplied verifier (used by known-answer tests).
    public init(verifier: String) {
        self.verifier = verifier
        let digest = SHA256.hash(data: Data(verifier.utf8))
        challenge = Data(digest).base64URLEncodedString()
    }
}
