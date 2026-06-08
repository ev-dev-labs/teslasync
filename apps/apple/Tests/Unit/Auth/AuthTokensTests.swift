import Foundation
import XCTest
@testable import TeslaSync

/// Token expiry math and OIDC token-response decoding/mapping.
@MainActor
final class AuthTokensTests: XCTestCase {
    func testIsExpired() {
        let now = Date()
        XCTAssertTrue(AuthTokens.fixture(expiresIn: -10, now: now).isExpired(now: now))
        XCTAssertFalse(AuthTokens.fixture(expiresIn: 3600, now: now).isExpired(now: now))
    }

    func testClockSkewTreatsNearExpiryAsExpired() {
        let now = Date()
        let token = AuthTokens.fixture(expiresIn: 10, now: now)
        XCTAssertTrue(token.isExpired(now: now, clockSkew: 30))
    }

    func testIsExpiringSoon() {
        let now = Date()
        XCTAssertTrue(AuthTokens.fixture(expiresIn: 60, now: now).isExpiringSoon(within: 300, now: now))
        XCTAssertFalse(AuthTokens.fixture(expiresIn: 3600, now: now).isExpiringSoon(within: 300, now: now))
    }

    func testTokenResponseMapping() throws {
        let json = Data(#"{"access_token":"at","refresh_token":"rt","token_type":"Bearer","expires_in":3600}"#.utf8)
        let response = try JSONDecoder().decode(TokenResponse.self, from: json)
        let now = Date()
        let tokens = response.tokens(issuedAt: now)
        XCTAssertEqual(tokens.accessToken, "at")
        XCTAssertEqual(tokens.refreshToken, "rt")
        XCTAssertEqual(tokens.expiresAt, now.addingTimeInterval(3600))
    }

    func testRefreshPreservesPreviousRefreshTokenWhenOmitted() throws {
        let json = Data(#"{"access_token":"at2","token_type":"Bearer","expires_in":100}"#.utf8)
        let response = try JSONDecoder().decode(TokenResponse.self, from: json)
        XCTAssertEqual(response.tokens(previousRefreshToken: "old-refresh").refreshToken, "old-refresh")
    }

    func testRedactedDescriptionHidesTokens() {
        let tokens = AuthTokens.fixture(accessToken: "super-secret-access", refreshToken: "super-secret-refresh")
        let description = tokens.redactedDescription
        XCTAssertFalse(description.contains("super-secret-access"))
        XCTAssertFalse(description.contains("super-secret-refresh"))
    }
}
