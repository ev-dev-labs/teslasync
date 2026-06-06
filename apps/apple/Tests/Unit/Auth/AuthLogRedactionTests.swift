import Foundation
import XCTest
@testable import TeslaSync

/// Verifies the redacting logger never lets tokens, VINs, or precise coordinates
/// escape (ADR-016).
final class AuthLogRedactionTests: XCTestCase {
    func testRedactsAccessTokenLikeStrings() {
        let secret = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9aaaaaaaaaaaaaaaa"
        XCTAssertFalse(AuthLog.redact("token=\(secret)").contains(secret))
    }

    func testRedactsVIN() {
        let vin = "5YJ3E1EA7KF000316"
        XCTAssertFalse(AuthLog.redact("vehicle \(vin) online").contains(vin))
    }

    func testRedactsCoordinates() {
        let redacted = AuthLog.redact("at 37.422100,-122.084000")
        XCTAssertFalse(redacted.contains("37.4221"))
        XCTAssertFalse(redacted.contains("-122.084"))
    }

    func testRedactURLStripsCodeAndState() {
        let url = OIDCConfiguration.url("https://app.example.com/cb?code=secretcode&state=secretstate&ok=1")
        let redacted = AuthLog.redactURL(url)
        XCTAssertFalse(redacted.contains("secretcode"))
        XCTAssertFalse(redacted.contains("secretstate"))
        XCTAssertTrue(redacted.contains("ok=1"))
    }

    func testRedactTokenMarker() {
        XCTAssertEqual(AuthLog.redactToken(nil), "‹none›")
        XCTAssertEqual(AuthLog.redactToken("abc"), "‹redacted›")
    }
}
