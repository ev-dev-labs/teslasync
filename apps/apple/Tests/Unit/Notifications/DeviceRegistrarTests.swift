import XCTest
@testable import TeslaSync

/// The HTTP device registrar: request shape (path/method/headers/body) and the
/// single 401-refresh + retry-once policy.
@MainActor final class DeviceRegistrarTests: XCTestCase {
    private let baseURL = URL(string: "https://api.example.com")!

    private func registration() -> DeviceRegistration {
        DeviceRegistration(token: "deadbeef", platform: .iOS, environment: .sandbox, bundleID: "io.teslasync.app")
    }

    func testRegisterPostsSnakeCaseBodyWithBearer() async throws {
        let body = Data(#"{"id":7,"device_token":"deadbeef","platform":"ios"}"#.utf8)
        let transport = FakeHTTPTransport([(201, body)])
        let auth = RecordingAuthProvider()
        let registrar = HTTPDeviceRegistrar(
            baseURL: baseURL,
            transport: transport,
            tokenProvider: auth,
            challenge: auth
        )

        let device = try await registrar.register(registration())
        XCTAssertEqual(device.id, 7)

        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/devices")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")

        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(json["device_token"] as? String, "deadbeef")
        XCTAssertEqual(json["bundle_id"] as? String, "io.teslasync.app")
        XCTAssertEqual(json["environment"] as? String, "sandbox")
    }

    func testRegisterSynthesizesRowWhenBodyEmpty() async throws {
        let transport = FakeHTTPTransport([(204, Data())])
        let registrar = HTTPDeviceRegistrar(baseURL: baseURL, transport: transport)
        let device = try await registrar.register(registration())
        XCTAssertEqual(device.token, "deadbeef")
        XCTAssertEqual(device.platform, .iOS)
    }

    func testUnauthorizedRefreshesOnceThenRetries() async throws {
        let transport = FakeHTTPTransport([(401, Data()), (201, Data())])
        let auth = RecordingAuthProvider(recovers: true)
        let registrar = HTTPDeviceRegistrar(
            baseURL: baseURL,
            transport: transport,
            tokenProvider: auth,
            challenge: auth
        )

        _ = try await registrar.register(registration())
        XCTAssertEqual(auth.challengeCount, 1, "exactly one refresh")
        XCTAssertEqual(transport.requests.count, 2, "the original request is retried once")
    }

    func testUnrecoveredUnauthorizedThrowsAuthWithoutSecondRefresh() async {
        let transport = FakeHTTPTransport([(401, Data()), (401, Data())])
        let auth = RecordingAuthProvider(recovers: false)
        let registrar = HTTPDeviceRegistrar(
            baseURL: baseURL,
            transport: transport,
            tokenProvider: auth,
            challenge: auth
        )

        do {
            _ = try await registrar.register(registration())
            XCTFail("expected an auth error")
        } catch let error as FacadeError {
            guard case .auth = error else { return XCTFail("expected .auth, got \(error)") }
        } catch {
            XCTFail("expected FacadeError.auth, got \(error)")
        }
        XCTAssertEqual(auth.challengeCount, 1, "no second refresh after a failed recovery")
    }

    func testUnregisterDeletesByToken() async throws {
        let transport = FakeHTTPTransport([(204, Data())])
        let registrar = HTTPDeviceRegistrar(baseURL: baseURL, transport: transport)
        try await registrar.unregister(token: "deadbeef")
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "DELETE")
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(json["device_token"] as? String, "deadbeef")
    }
}
