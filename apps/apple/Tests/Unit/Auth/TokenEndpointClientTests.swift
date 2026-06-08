import Foundation
import XCTest
@testable import TeslaSync

/// A `URLProtocol` that serves canned responses so the token endpoint paths are
/// covered without a real network. (Not `final`: `URLProtocol` requires the
/// class-method overrides below, which cannot be `static`.)
class MockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with _: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = MockURLProtocol.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

@MainActor
final class TokenEndpointClientTests: XCTestCase {
    private let tokenURL = OIDCConfiguration.url("https://auth.example.com/application/o/token/")

    private func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    override func tearDown() {
        MockURLProtocol.handler = nil
        super.tearDown()
    }

    private func respond(status: Int, json: String) {
        let url = tokenURL
        MockURLProtocol.handler = { _ in
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (response, Data(json.utf8))
        }
    }

    func testExchangeParsesTokens() async throws {
        respond(
            status: 200,
            json: #"{"access_token":"AT","refresh_token":"RT","token_type":"Bearer","expires_in":3600}"#
        )
        let client = TokenEndpointClient(configuration: .fixture(), session: makeSession())
        let tokens = try await client.exchange(
            code: "c",
            verifier: "v",
            redirectURI: OIDCConfiguration.url("https://app.example.com/auth/callback")
        )
        XCTAssertEqual(tokens.accessToken, "AT")
        XCTAssertEqual(tokens.refreshToken, "RT")
    }

    func testErrorResponseMapsToTokenEndpointError() async {
        respond(status: 400, json: #"{"error":"invalid_grant","error_description":"bad"}"#)
        let client = TokenEndpointClient(configuration: .fixture(), session: makeSession())
        do {
            _ = try await client.refresh(refreshToken: "rt")
            XCTFail("expected token endpoint error")
        } catch let error as AuthError {
            XCTAssertEqual(error, .tokenEndpoint(status: 400, error: "invalid_grant", description: "bad"))
        } catch {
            XCTFail("unexpected error type: \(error)")
        }
    }

    func testEncodeFormIsSortedAndPercentEncoded() {
        let body = String(bytes: TokenEndpointClient.encodeForm(["b": "x y", "a": "1+2"]), encoding: .utf8)
        XCTAssertEqual(body, "a=1%2B2&b=x%20y")
    }
}
