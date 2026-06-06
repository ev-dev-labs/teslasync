import Foundation
import Security

/// Cryptographically secure random material for OAuth/OIDC values (PKCE verifier,
/// `state`, `nonce`). Backed by the system CSPRNG via `SecRandomCopyBytes`, with a
/// `SystemRandomNumberGenerator` fallback (also CSPRNG-backed on Apple platforms)
/// so a verifier is never silently weakened to a predictable value.
enum Entropy {
    static func secureRandomData(byteCount: Int) -> Data {
        precondition(byteCount > 0, "byteCount must be positive")
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        if status == errSecSuccess {
            return Data(bytes)
        }
        var generator = SystemRandomNumberGenerator()
        return Data((0 ..< byteCount).map { _ in UInt8.random(in: .min ... .max, using: &generator) })
    }

    /// A URL-safe, unpadded high-entropy token (default 256 bits) suitable for
    /// `state` / `nonce`. 32 bytes → 43 Base64URL chars.
    static func secureToken(byteCount: Int = 32) -> String {
        secureRandomData(byteCount: byteCount).base64URLEncodedString()
    }
}
