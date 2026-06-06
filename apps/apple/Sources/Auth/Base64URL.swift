import Foundation

extension Data {
    /// Base64URL encoding (RFC 4648 §5) with padding stripped — the encoding
    /// OAuth/OIDC PKCE (RFC 7636) and JWT use for `code_challenge`, `state`, etc.
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
