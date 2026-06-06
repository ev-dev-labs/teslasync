import Foundation
import XCTest
@testable import TeslaSync

// MARK: - HTTP transport double

/// A scripted `HTTPTransporting` that records each request and returns the next
/// queued `(status, body)`. Locking is via sync helpers so no `NSLock` call runs
/// inside an `async` context (Swift 6).
final class FakeHTTPTransport: HTTPTransporting, @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [(status: Int, body: Data)]
    private var captured: [URLRequest] = []

    init(_ responses: [(status: Int, body: Data)]) {
        self.responses = responses
    }

    var requests: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return captured
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        let next = dequeue()
        let response = HTTPURLResponse(url: request.url!, statusCode: next.status, httpVersion: nil, headerFields: nil)!
        return (next.body, response)
    }

    private func record(_ request: URLRequest) {
        lock.lock(); captured.append(request); lock.unlock()
    }

    private func dequeue() -> (status: Int, body: Data) {
        lock.lock(); defer { lock.unlock() }
        return responses.isEmpty ? (200, Data()) : responses.removeFirst()
    }
}

// MARK: - Auth seam double

/// An `AuthTokenProviding & AuthChallengeHandling` double that vends a fixed token
/// and reports a configurable 401-recovery outcome, recording how often the
/// challenge fired.
final class RecordingAuthProvider: AuthTokenProviding, AuthChallengeHandling, @unchecked Sendable {
    private let lock = NSLock()
    private let token: String?
    private let recovers: Bool
    private var challengeCalls = 0

    init(token: String? = "tok", recovers: Bool = true) {
        self.token = token
        self.recovers = recovers
    }

    var challengeCount: Int {
        lock.lock(); defer { lock.unlock() }
        return challengeCalls
    }

    func currentAccessToken() async -> String? {
        token
    }

    func validAccessToken() async throws -> String {
        guard let token else { throw FacadeError.auth(message: "no token") }
        return token
    }

    @discardableResult
    func handleUnauthorized() async -> Bool {
        bump()
        return recovers
    }

    private func bump() {
        lock.lock(); challengeCalls += 1; lock.unlock()
    }
}

extension Calendar {
    /// A fixed gregorian calendar for deterministic quiet-hours tests.
    static let fixedGregorian = Calendar(identifier: .gregorian)
}

func dateAt(hour: Int, calendar: Calendar = .fixedGregorian) -> Date {
    calendar.date(from: DateComponents(year: 2026, month: 1, day: 1, hour: hour, minute: 0))!
}
