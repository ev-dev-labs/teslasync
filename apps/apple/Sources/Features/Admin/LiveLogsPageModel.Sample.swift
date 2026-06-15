import Foundation

// MARK: - Default sample source (page/preview seed)

/// A representative local live source used as the page/preview default until the KMP-backed
/// SSE tail is injected at composition time. It is NOT production telemetry — it streams a
/// handful of realistic zerolog lines (honoring the level threshold + grep, like the server)
/// so the surface renders its populated state out of the box, then holds the connection open
/// (web: the server keeps fanning out) until the subscriber cancels. Production replaces it
/// with the shared SSE-client adapter for `GET /admin/logs/stream`.
public struct SampleLiveLogsSource: LiveLogsStreaming {
    private let interval: Duration

    public init(interval: Duration = .milliseconds(650)) {
        self.interval = interval
    }

    public func open(level: LiveLogLevel, grep: String) -> AsyncStream<LiveLogStreamElement> {
        let interval = interval
        return AsyncStream { continuation in
            let task = Task {
                continuation.yield(.connected)
                let regex = LiveLogsFormat.grepRegex(grep)
                for line in Self.seed {
                    if Task.isCancelled { break }
                    guard Self.passes(line: line, level: level, regex: regex) else { continue }
                    continuation.yield(.log(payload: line))
                    try? await Task.sleep(for: interval)
                }
                if !Task.isCancelled {
                    continuation.yield(.drop(count: 2))
                }
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(30))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Server-side filter simulation: the line passes when its level meets the threshold and
    /// (when set) the grep matches the raw payload (web server-side `level` + `grep` params).
    static func passes(line: String, level: LiveLogLevel, regex: NSRegularExpression?) -> Bool {
        guard rank(LiveLogsFormat.detectLevel(LiveLogsFormat.parseObject(line))) >= rank(level.rawValue) else {
            return false
        }
        guard let regex else { return true }
        let range = NSRange(line.startIndex..., in: line)
        return regex.firstMatch(in: line, range: range) != nil
    }

    private static func rank(_ level: String) -> Int {
        switch level.lowercased() {
        case "debug", "trace": 0
        case "warn", "warning": 2
        case "error", "err", "fatal", "panic": 3
        default: 1
        }
    }

    static let seed: [String] = [
        #"{"level":"info","message":"vehicle state fetched","component":"fleet","vehicle_id":"3","dur":"184ms"}"#,
        #"{"level":"debug","message":"signal store hydrated from signal_log","component":"signal","count":4821}"#,
        #"{"level":"info","message":"drive started","component":"fsm","vehicle_id":"3","state":"driving"}"#,
        #"{"level":"warn","message":"redis cache miss — in-memory fallback","component":"cache","vehicle_id":"7"}"#,
        #"{"level":"info","message":"charge session opened","component":"charging","vehicle_id":"7","kw":11}"#,
        #"{"level":"error","message":"tesla command timed out after 30s","component":"command","vehicle_id":"3"}"#,
        #"{"level":"debug","message":"mqtt frame routed","component":"mqtt","field":"VehicleSpeed","atomics":1}"#,
        #"{"level":"warn","message":"signal older than 2m — marked stale","component":"live","vehicle_id":"3"}"#,
        #"{"level":"info","message":"SSE subscriber attached","component":"sse","subscribers":4}"#
    ]
}

// MARK: - Scripted source (tests / harness)

/// A deterministic source that yields a fixed script of frames and (optionally) finishes, so
/// `await model.run()` returns after draining them. Drives the model's connect / log / drop /
/// failed paths in unit tests without timing.
public struct ScriptedLiveLogsSource: LiveLogsStreaming {
    private let elements: [LiveLogStreamElement]
    private let finishes: Bool

    public init(_ elements: [LiveLogStreamElement], finishes: Bool = true) {
        self.elements = elements
        self.finishes = finishes
    }

    public func open(level _: LiveLogLevel, grep _: String) -> AsyncStream<LiveLogStreamElement> {
        let elements = elements
        let finishes = finishes
        return AsyncStream { continuation in
            for element in elements {
                continuation.yield(element)
            }
            if finishes {
                continuation.finish()
            }
        }
    }
}
