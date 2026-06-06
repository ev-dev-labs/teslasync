import Foundation
import XCTest
@testable import TeslaSync

/// PKCE (RFC 7636) correctness, including the spec's S256 known-answer vector.
final class PKCETests: XCTestCase {
    func testKnownAnswerVectorRFC7636() {
        // RFC 7636 Appendix B.
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        XCTAssertEqual(pkce.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        XCTAssertEqual(PKCE.method, "S256")
    }

    func testGeneratedVerifierIsUnreservedAndWithinLength() {
        let pkce = PKCE()
        XCTAssertGreaterThanOrEqual(pkce.verifier.count, 43)
        XCTAssertLessThanOrEqual(pkce.verifier.count, 128)
        let unreserved = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        )
        XCTAssertTrue(pkce.verifier.unicodeScalars.allSatisfy { unreserved.contains($0) })
    }

    func testChallengeHasNoBase64Padding() {
        let pkce = PKCE()
        XCTAssertFalse(pkce.challenge.contains("="))
        XCTAssertFalse(pkce.challenge.contains("+"))
        XCTAssertFalse(pkce.challenge.contains("/"))
    }

    func testEachGenerationIsUnique() {
        XCTAssertNotEqual(PKCE().verifier, PKCE().verifier)
    }
}
