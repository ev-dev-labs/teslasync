import Foundation

/// A minimal HTTP transport seam so `HTTPDeviceRegistrar` is testable without a
/// live network: production uses `URLSessionTransport`; tests inject a fake that
/// records the request and returns a scripted `(Data, HTTPURLResponse)`.
public protocol HTTPTransporting: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// The production transport — a thin `URLSession` wrapper that surfaces a
/// `FacadeError` when the response is not HTTP.
public struct URLSessionTransport: HTTPTransporting {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw FacadeError.network(message: "device registration received a non-HTTP response")
        }
        return (data, http)
    }
}

/// `DeviceRegistering` over plain HTTP to the ADR-009 `/api/v1/devices` endpoint,
/// authenticated through the P5 auth seams (the facade's auth). It attaches the
/// bearer access token, posts the snake_case registration body, and runs the same
/// single 401-refresh + retry-once policy the SSE/live layer uses: on a 401 it
/// asks `AuthChallengeHandling` to refresh once and retries with a fresh token.
///
/// > The base URL is injected by the facade's bootstrap (the single place that
/// > names the shared-core configuration, finalised on the macOS Xcode build), so
/// > this type never imports `Shared` and host-typechecks/compiles standalone.
public final class HTTPDeviceRegistrar: DeviceRegistering {
    private let baseURL: URL
    private let transport: any HTTPTransporting
    private let tokenProvider: (any AuthTokenProviding)?
    private let challenge: (any AuthChallengeHandling)?
    private let log: PushLog

    /// The endpoint path. The web `request()` client auto-prefixes `/api/v1`; this
    /// standalone client posts to the absolute path, so the prefix is explicit here.
    private static let path = "api/v1/devices"

    public init(
        baseURL: URL,
        transport: any HTTPTransporting = URLSessionTransport(),
        tokenProvider: (any AuthTokenProviding)? = nil,
        challenge: (any AuthChallengeHandling)? = nil,
        log: PushLog = PushLog()
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.tokenProvider = tokenProvider
        self.challenge = challenge
        self.log = log
    }

    @discardableResult
    public func register(_ registration: DeviceRegistration) async throws -> RegisteredDevice {
        let body = try Self.encoder().encode(registration)
        let (data, http) = try await send(method: "POST", body: body)
        log.info("device registered: http \(http.statusCode) \(PushLog.maskToken(registration.token))")
        let fallback = RegisteredDevice(token: registration.token, platform: registration.platform)
        guard !data.isEmpty else { return fallback }
        return (try? Self.decoder().decode(RegisteredDevice.self, from: data)) ?? fallback
    }

    public func unregister(token: String) async throws {
        let body = try Self.encoder().encode(DeviceUnregistration(token: token))
        let (_, http) = try await send(method: "DELETE", body: body)
        log.info("device unregistered: http \(http.statusCode) \(PushLog.maskToken(token))")
    }

    // MARK: - Request plumbing

    private func send(method: String, body: Data) async throws -> (Data, HTTPURLResponse) {
        var didRetryAfterRefresh = false
        while true {
            let request = try await makeRequest(method: method, body: body)
            let (data, http) = try await transport.send(request)
            switch http.statusCode {
            case 200 ... 299:
                return (data, http)
            case 401:
                guard let challenge, !didRetryAfterRefresh else {
                    throw FacadeError.auth(message: "device registration unauthorized")
                }
                didRetryAfterRefresh = true
                log.notice("device \(method) 401 — refreshing session and retrying once")
                if await challenge.handleUnauthorized() { continue }
                throw FacadeError.auth(message: "device registration unauthorized")
            default:
                throw FacadeError.api(status: http.statusCode, code: nil, body: String(data: data, encoding: .utf8))
            }
        }
    }

    private func makeRequest(method: String, body: Data) async throws -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(Self.path))
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let tokenProvider {
            do {
                let token = try await tokenProvider.validAccessToken()
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            } catch {
                throw FacadeError.auth(message: "no valid session for device registration")
            }
        }
        return request
    }

    private static func encoder() -> JSONEncoder {
        JSONEncoder()
    }

    private static func decoder() -> JSONDecoder {
        JSONDecoder()
    }
}
