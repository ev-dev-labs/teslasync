//
//  AIAutoTripNameSuggestion.Seams.swift
//  TeslaSync — P4 shared surface · 0007 · AIAutoTripNameSuggestion (Apple)
//
//  The dependency seams the AITripNameModel binds through, kept apart from the model for the lint
//  length budget: the context source (the gate + trip + connectivity snapshot — the native shape
//  of the web `useAiEnabled` + `tripId` prop the surface reads), and the AI stream driver (the
//  native port of `useAiStream`). Each seam has a production implementation and an in-memory
//  double for previews/tests.
//
//  Parity note: the web `useAiStream` opens a POST + ReadableStream SSE against
//  `${apiBase}/api/v1{url}`, parses blank-line-delimited frames, accumulates `delta.text`, and
//  terminates on `done`/`error`. `LiveAITripNameStreamDriver` reproduces that exact transport on
//  `URLSession.bytes`, routing every frame through the shared `AiSseFrameParser` + `AiStreamReducer`
//  so the on-wire contract is identical to the web hook.
//

import Foundation

// MARK: - Context source protocol (P1/S8 seam)

/// The seam the model binds through for the non-stream inputs — the AI feature gate, the bound
/// trip id, and the connectivity axis. The production app implements this over the AI-enabled flag
/// + the current trip (`LiveAITripNameSource`); previews and tests use `InMemoryAITripNameSource`.
@MainActor
public protocol AITripNameSource: AnyObject {
    var onUpdate: (@MainActor (AITripNameInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production context source. Holds the host-provided gate + trip and re-emits them as a live
/// snapshot on `start`/`refresh` — the native binding point for the web `useAiEnabled` flag and the
/// `tripId` prop. The feed is local + synchronous (no HTTP).
@MainActor
public final class LiveAITripNameSource: AITripNameSource {
    public var onUpdate: (@MainActor (AITripNameInput) -> Void)?

    private let featureEnabled: Bool
    private let tripID: String?

    public init(featureEnabled: Bool, tripID: String?) {
        self.featureEnabled = featureEnabled
        self.tripID = tripID
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    private func emit() {
        onUpdate?(AITripNameInput(featureEnabled: featureEnabled, tripID: tripID, connection: .live))
    }
}

/// In-memory context source for previews + unit/UI tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAITripNameSource: AITripNameSource {
    public var onUpdate: (@MainActor (AITripNameInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AITripNameInput?

    public init(initial: AITripNameInput? = nil) {
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
    public func push(_ input: AITripNameInput) {
        onUpdate?(input)
    }
}

// MARK: - Stream driver protocol (the `useAiStream` seam)

/// The AI stream seam — the native port of `useAiStream`. The model calls `start(path:)` behind the
/// Ask Helix button and `cancel()` on teardown; the driver emits the accumulated `AiStreamSnapshot`
/// as the stream progresses. The view never opens a connection directly.
@MainActor
public protocol AITripNameStreamDriver: AnyObject {
    var onUpdate: (@MainActor (AiStreamSnapshot) -> Void)? { get set }
    func start(path: String)
    func cancel()
}

/// The production stream driver — a real `URLSession.bytes` SSE consumer that POSTs an empty body
/// to `${baseURL}/api/v1{path}` (web `useAiStream` transport), accumulates blank-line-delimited
/// frames, routes each through the shared `AiSseFrameParser` + `AiStreamReducer`, and emits the
/// accumulated snapshot. Codec/transport failures finalize as `error` (web `finalizeError`);
/// cancellation returns the stream to `idle` (web AbortError path).
@MainActor
public final class LiveAITripNameStreamDriver: AITripNameStreamDriver {
    /// The default API base — the host injects the configured base in production (web `getApiBase()`).
    public static let defaultBaseURL = URL(string: "http://localhost:8080")!

    public var onUpdate: (@MainActor (AiStreamSnapshot) -> Void)?

    private let baseURL: URL
    private let session: URLSession
    private var task: Task<Void, Never>?
    private var snapshot = AiStreamSnapshot.idle

    public init(baseURL: URL = LiveAITripNameStreamDriver.defaultBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func start(path: String) {
        cancel()
        snapshot = AiStreamReducer.started()
        emit()
        guard let request = Self.makeRequest(baseURL: baseURL, path: path) else {
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
                    snapshot = AiStreamReducer.cancelled(snapshot)
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
            snapshot = AiStreamReducer.closed(snapshot)
            emit()
        } catch {
            if Task.isCancelled || (error as? URLError)?.code == .cancelled {
                snapshot = AiStreamReducer.cancelled(snapshot)
                emit()
                return
            }
            finalize(message: error.localizedDescription)
        }
    }

    private func drain(_ frame: inout String) {
        defer { frame = "" }
        guard !frame.isEmpty, let event = AiSseFrameParser.parse(frame) else { return }
        snapshot = AiStreamReducer.reduce(snapshot, event)
        emit()
    }

    private func finalize(message: String) {
        snapshot = AiStreamReducer.failed(snapshot, message: message)
        emit()
    }

    private func emit() {
        onUpdate?(snapshot)
    }

    /// Builds the POST request against `${baseURL}/api/v1{path}` with the SSE accept header and an
    /// empty JSON body (web `body = {}`). `URL(string:)` preserves the already-encoded path without
    /// double-encoding the `encodeURIComponent` output from `draftPath`.
    static func makeRequest(baseURL: URL, path: String) -> URLRequest? {
        let normalized = path.hasPrefix("/") ? path : "/" + path
        var base = baseURL.absoluteString
        if base.hasSuffix("/") { base.removeLast() }
        guard let url = URL(string: base + "/api/v1" + normalized) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.httpBody = Data("{}".utf8)
        return request
    }
}

/// In-memory stream driver for previews + unit/UI tests. Emits the `started()` snapshot then plays
/// an optional scripted sequence on `start(path:)`, records the path + call counts, and lets a test
/// push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAITripNameStreamDriver: AITripNameStreamDriver {
    public var onUpdate: (@MainActor (AiStreamSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var cancelCount = 0
    public private(set) var lastPath: String?

    private let script: [AiStreamSnapshot]
    private let emitStarted: Bool

    public init(script: [AiStreamSnapshot] = [], emitStarted: Bool = true) {
        self.script = script
        self.emitStarted = emitStarted
    }

    public func start(path: String) {
        startCount += 1
        lastPath = path
        if emitStarted { onUpdate?(AiStreamReducer.started()) }
        for snapshot in script {
            onUpdate?(snapshot)
        }
    }

    public func cancel() {
        cancelCount += 1
    }

    /// Pushes a stream snapshot to the bound model (test/preview affordance).
    public func push(_ snapshot: AiStreamSnapshot) {
        onUpdate?(snapshot)
    }
}
