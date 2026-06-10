//
//  AITripPostcardShareCardImageGeneration.Seams.swift
//  TeslaSync — P4 shared surface · 0056 · AITripPostcardShareCardImageGeneration (Apple)
//
//  The dependency seams the model binds through, kept apart from the model for the lint length
//  budget: the context source (the gate + selected-trip + style-hint + connectivity snapshot — the
//  native shape of the web `useAiEnabled` + the `tripId` / `styleHint` props the surface reads), and
//  the AI stream driver (the native port of `useAiStream`). Each seam has a production implementation
//  and an in-memory double for previews/tests.
//
//  Parity note: the web `useAiStream` opens a POST + ReadableStream SSE against
//  `${apiBase}/api/v1{url}` with a JSON body, parses blank-line-delimited frames, accumulates
//  `delta.text`, and terminates on `done`/`error`. `LiveAIPostcardStreamDriver` reproduces that exact
//  transport on `URLSession.bytes`, POSTing the `{ trip_id, style_hint? }` body and routing every
//  frame through the shared `AIPostcardSseFrameParser` + `AIPostcardStreamReducer` so the on-wire
//  contract is identical to the web hook.
//

import Foundation

// MARK: - Context source protocol (P1/S8 seam)

/// The seam the model binds through for the non-stream inputs — the AI feature gate, the selected
/// trip id, the optional style hint, and the connectivity axis. The production app implements this
/// over the AI-enabled flag + the current trip selection (`LiveAIPostcardSource`); previews and tests
/// use `InMemoryAIPostcardSource`.
@MainActor
public protocol AIPostcardSource: AnyObject {
    var onUpdate: (@MainActor (AIPostcardInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production context source. Holds the host-provided gate + trip + style hint and re-emits them
/// as a live snapshot on `start`/`refresh` — the native binding point for the web `useAiEnabled` flag
/// and the `tripId` / `styleHint` props. The feed is local + synchronous (no HTTP).
@MainActor
public final class LiveAIPostcardSource: AIPostcardSource {
    public var onUpdate: (@MainActor (AIPostcardInput) -> Void)?

    private let featureEnabled: Bool
    private let tripID: Int?
    private let styleHint: String?

    public init(featureEnabled: Bool, tripID: Int?, styleHint: String?) {
        self.featureEnabled = featureEnabled
        self.tripID = tripID
        self.styleHint = styleHint
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    private func emit() {
        onUpdate?(AIPostcardInput(
            featureEnabled: featureEnabled,
            tripID: tripID,
            styleHint: styleHint,
            connection: .live
        ))
    }
}

/// In-memory context source for previews + unit/UI tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAIPostcardSource: AIPostcardSource {
    public var onUpdate: (@MainActor (AIPostcardInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AIPostcardInput?

    public init(initial: AIPostcardInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a context snapshot to the bound model (test/preview affordance).
    public func push(_ input: AIPostcardInput) {
        onUpdate?(input)
    }
}

// MARK: - Stream driver protocol (the `useAiStream` seam)

/// The AI stream seam — the native port of `useAiStream`. The model calls `start(path:body:)` behind
/// the Ask Helix button and `cancel()` on teardown; the driver emits the accumulated
/// `AIPostcardStreamSnapshot` as the stream progresses. The view never opens a connection directly.
@MainActor
public protocol AIPostcardStreamDriver: AnyObject {
    var onUpdate: (@MainActor (AIPostcardStreamSnapshot) -> Void)? { get set }
    func start(path: String, body: Data)
    func cancel()
}

/// The production stream driver — a real `URLSession.bytes` SSE consumer that POSTs the
/// `{ trip_id, style_hint? }` body to `${baseURL}/api/v1{path}` (web `useAiStream` transport),
/// accumulates blank-line-delimited frames, routes each through the shared `AIPostcardSseFrameParser`
/// + `AIPostcardStreamReducer`, and emits the accumulated snapshot. Codec/transport failures finalize
/// as `error` (web `finalizeError`); cancellation returns the stream to `idle` (web AbortError path).
@MainActor
public final class LiveAIPostcardStreamDriver: AIPostcardStreamDriver {
    /// The default API base — the host injects the configured base in production (web `getApiBase()`).
    public static let defaultBaseURL = URL(string: "http://localhost:8080")!

    public var onUpdate: (@MainActor (AIPostcardStreamSnapshot) -> Void)?

    private let baseURL: URL
    private let session: URLSession
    private var task: Task<Void, Never>?
    private var snapshot = AIPostcardStreamSnapshot.idle

    public init(
        baseURL: URL = LiveAIPostcardStreamDriver.defaultBaseURL,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.session = session
    }

    public func start(path: String, body: Data) {
        cancel()
        snapshot = AIPostcardStreamReducer.started()
        emit()
        guard let request = Self.makeRequest(baseURL: baseURL, path: path, body: body) else {
            finalize(message: "stream_bad_url")
            return
        }
        task = Task { [weak self] in await self?.run(request) }
    }

    public func cancel() {
        task?.cancel()
        task = nil
    }

    private func run(_ request: URLRequest) async {
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else {
                finalize(message: "stream_no_response")
                return
            }
            guard (200 ..< 300).contains(http.statusCode) else {
                // Off-mode (404), feature toggle off (404), 5xx — web R8 baseline fallback.
                finalize(message: "stream_http_\(http.statusCode)")
                return
            }
            var frame = ""
            for try await line in bytes.lines {
                if Task.isCancelled {
                    snapshot = AIPostcardStreamReducer.cancelled(snapshot)
                    emit()
                    return
                }
                if line.isEmpty {
                    drain(&frame)
                } else {
                    frame += frame.isEmpty ? line : "\n" + line
                }
            }
            drain(&frame)
            snapshot = AIPostcardStreamReducer.closed(snapshot)
            emit()
        } catch {
            if Task.isCancelled || (error as? URLError)?.code == .cancelled {
                snapshot = AIPostcardStreamReducer.cancelled(snapshot)
                emit()
                return
            }
            finalize(message: error.localizedDescription)
        }
    }

    private func drain(_ frame: inout String) {
        defer { frame = "" }
        guard !frame.isEmpty, let event = AIPostcardSseFrameParser.parse(frame) else { return }
        snapshot = AIPostcardStreamReducer.reduce(snapshot, event)
        emit()
    }

    private func finalize(message: String) {
        snapshot = AIPostcardStreamReducer.failed(snapshot, message: message)
        emit()
    }

    private func emit() {
        onUpdate?(snapshot)
    }

    /// Builds the POST request against `${baseURL}/api/v1{path}` with the SSE accept header and the
    /// JSON draft body (web `body = { trip_id, style_hint? }`). `URL(string:)` preserves the path
    /// without double-encoding.
    static func makeRequest(baseURL: URL, path: String, body: Data) -> URLRequest? {
        let normalized = path.hasPrefix("/") ? path : "/" + path
        var base = baseURL.absoluteString
        if base.hasSuffix("/") { base.removeLast() }
        guard let url = URL(string: base + "/api/v1" + normalized) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.httpBody = body
        return request
    }
}

/// In-memory stream driver for previews + unit/UI tests. Emits the `started()` snapshot then plays an
/// optional scripted sequence on `start(path:body:)`, records the path + body + call counts, and lets
/// a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAIPostcardStreamDriver: AIPostcardStreamDriver {
    public var onUpdate: (@MainActor (AIPostcardStreamSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var cancelCount = 0
    public private(set) var lastPath: String?
    public private(set) var lastBody: Data?

    private let script: [AIPostcardStreamSnapshot]
    private let emitStarted: Bool

    public init(script: [AIPostcardStreamSnapshot] = [], emitStarted: Bool = true) {
        self.script = script
        self.emitStarted = emitStarted
    }

    public func start(path: String, body: Data) {
        startCount += 1
        lastPath = path
        lastBody = body
        if emitStarted { onUpdate?(AIPostcardStreamReducer.started()) }
        for snapshot in script {
            onUpdate?(snapshot)
        }
    }

    public func cancel() {
        cancelCount += 1
    }

    /// Pushes a stream snapshot to the bound model (test/preview affordance).
    public func push(_ snapshot: AIPostcardStreamSnapshot) {
        onUpdate?(snapshot)
    }
}
