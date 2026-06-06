import Foundation
import XCTest
@testable import TeslaSync

/// Authorization-URL construction and redirect validation (PKCE, state, errors).
final class OIDCAuthorizationTests: XCTestCase {
    private func makeRequest() -> OIDCAuthorizationRequest {
        OIDCAuthorizationRequest(
            configuration: .fixture(),
            pkce: PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            state: "test-state",
            nonce: "test-nonce"
        )
    }

    private func queryItems(_ url: URL) throws -> [String: String] {
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        return Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
    }

    func testAuthorizationURLContainsPKCEAndState() throws {
        let items = try queryItems(makeRequest().authorizationURL())
        XCTAssertEqual(items["response_type"], "code")
        XCTAssertEqual(items["code_challenge_method"], "S256")
        XCTAssertEqual(items["code_challenge"], "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        XCTAssertEqual(items["state"], "test-state")
        XCTAssertEqual(items["nonce"], "test-nonce")
        XCTAssertEqual(items["client_id"], "teslasync-apple")
        XCTAssertEqual(items["redirect_uri"], "https://app.example.com/auth/callback")
    }

    func testAuthorizationCodeParsed() throws {
        let redirect = OIDCConfiguration.url("https://app.example.com/auth/callback?code=abc123&state=test-state")
        XCTAssertEqual(try makeRequest().authorizationCode(from: redirect), "abc123")
    }

    func testStateMismatchRejected() {
        let redirect = OIDCConfiguration.url("https://app.example.com/auth/callback?code=abc&state=wrong")
        XCTAssertThrowsError(try makeRequest().authorizationCode(from: redirect)) { error in
            XCTAssertEqual(error as? AuthError, .stateMismatch)
        }
    }

    func testServerErrorSurfaced() {
        let redirect = OIDCConfiguration
            .url("https://app.example.com/auth/callback?error=access_denied&state=test-state")
        XCTAssertThrowsError(try makeRequest().authorizationCode(from: redirect)) { error in
            XCTAssertEqual(error as? AuthError, .authorizationServer(error: "access_denied", description: nil))
        }
    }

    func testMissingCodeRejected() {
        let redirect = OIDCConfiguration.url("https://app.example.com/auth/callback?state=test-state")
        XCTAssertThrowsError(try makeRequest().authorizationCode(from: redirect))
    }

    func testConfigurationCallbackDerivation() {
        guard case let .universalLink(host, path) = OIDCConfiguration.fixture().callback else {
            return XCTFail("expected universal link callback")
        }
        XCTAssertEqual(host, "app.example.com")
        XCTAssertEqual(path, "/auth/callback")
    }
}
