import Shared
import XCTest
@testable import TeslaSync

/// Verifies the `ApiError` → `FacadeError` taxonomy mapping, including the
/// `NSError.userInfo["KotlinException"]` unwrapping Kotlin/Native uses for
/// `@Throws` suspend functions.
final class FacadeErrorMappingTests: XCTestCase {
    private func wrap(_ apiError: Shared.ApiError) -> NSError {
        NSError(domain: "KotlinException", code: 0, userInfo: ["KotlinException": apiError])
    }

    func testHttp401MapsToAuth() {
        let http = Shared.ApiError.Http(status: 401, body: nil, code: "SUDO_REQUIRED", message: "HTTP 401")
        guard case .auth = FacadeError.from(wrap(http)) else {
            return XCTFail("401 should map to .auth")
        }
    }

    func testHttp503MapsToRetryableApi() {
        let http = Shared.ApiError.Http(status: 503, body: "busy", code: nil, message: "HTTP 503")
        let mapped = FacadeError.from(wrap(http))
        guard case let .api(status, _, _) = mapped else {
            return XCTFail("503 should map to .api")
        }
        XCTAssertEqual(status, 503)
        XCTAssertTrue(mapped.isRetryable)
    }

    func testTransportErrorsMap() {
        guard case .timeout = FacadeError.from(wrap(Shared.ApiError.Timeout(message: "t", cause: nil))) else {
            return XCTFail("expected .timeout")
        }
        guard case .circuitOpen = FacadeError.from(wrap(Shared.ApiError.CircuitOpen(message: "open"))) else {
            return XCTFail("expected .circuitOpen")
        }
        guard case .network = FacadeError.from(wrap(Shared.ApiError.Network(message: "n", cause: nil))) else {
            return XCTFail("expected .network")
        }
    }

    func testCancellationMaps() {
        XCTAssertEqual(FacadeError.from(CancellationError()), .cancelled)
    }
}
