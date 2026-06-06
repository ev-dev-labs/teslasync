import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Scripted live stream provider

/// A deterministic `LiveStreamProvider` for store tests. Each `open` dequeues the
/// next scripted episode and yields its elements into a fresh `AsyncStream`; an
/// episode either finishes (clean/terminal end) or stays parked (an open, live
/// stream) so background/foreground and reconnect transitions are exact. Every
/// `open` records its target + `Last-Event-ID` resume token for assertions.
final class ScriptedLiveStreamProvider<Event: Sendable>: @unchecked Sendable {
    struct Episode {
        var elements: [LiveStreamElement<Event>]
        var finishes: Bool

        init(_ elements: [LiveStreamElement<Event>], finishes: Bool) {
            self.elements = elements
            self.finishes = finishes
        }
    }

    struct OpenCall: Equatable {
        let target: LiveStreamTarget
        let resumeToken: String?
    }

    private let lock = NSLock()
    private var episodes: [Episode]
    private var recordedOpens: [OpenCall] = []
    private var parkedContinuation: AsyncStream<LiveStreamElement<Event>>.Continuation?

    init(episodes: [Episode]) {
        self.episodes = episodes
    }

    var opens: [OpenCall] {
        lock.lock()
        defer { lock.unlock() }
        return recordedOpens
    }

    var openCount: Int {
        opens.count
    }

    func makeProvider() -> LiveStreamProvider<Event> {
        LiveStreamProvider { [weak self] target, resume in
            self?.open(target, resume) ?? AsyncStream { $0.finish() }
        }
    }

    /// Pushes an element into the most recently opened, still-parked stream.
    func push(_ element: LiveStreamElement<Event>) {
        lock.lock()
        let continuation = parkedContinuation
        lock.unlock()
        continuation?.yield(element)
    }

    private func open(
        _ target: LiveStreamTarget,
        _ resume: String?
    ) -> AsyncStream<LiveStreamElement<Event>> {
        lock.lock()
        recordedOpens.append(OpenCall(target: target, resumeToken: resume))
        let episode = episodes.isEmpty ? Episode([], finishes: true) : episodes.removeFirst()
        lock.unlock()

        return AsyncStream { continuation in
            for element in episode.elements {
                continuation.yield(element)
            }
            if episode.finishes {
                continuation.finish()
            } else {
                lock.lock()
                parkedContinuation = continuation
                lock.unlock()
            }
        }
    }
}

// MARK: - Recording auth challenge

/// An `AuthChallengeHandling` double recording how many times the 401 path fired
/// and reporting a configurable recovery outcome.
final class RecordingAuthChallenge: AuthChallengeHandling, @unchecked Sendable {
    private let lock = NSLock()
    private let recovers: Bool
    private var calls = 0

    init(recovers: Bool) {
        self.recovers = recovers
    }

    var callCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return calls
    }

    @discardableResult
    func handleUnauthorized() async -> Bool {
        recordCall()
        return recovers
    }

    private func recordCall() {
        lock.lock()
        calls += 1
        lock.unlock()
    }
}

// MARK: - Helpers

enum LiveTestEvents {
    /// A vehicle-update envelope carrying one numeric signal.
    static func vehicleUpdate(
        id: String?,
        field: String = "battery_level",
        value: Double
    ) -> LiveStreamElement<LiveFleetEvent> {
        .event(LiveEnvelope(
            id: id,
            kind: .vehicleUpdate,
            receivedAt: Date(),
            payload: .vehicleUpdate(vehicleID: 1, signals: [field: .number(value)])
        ))
    }
}

/// Polls `predicate` until true or the deadline. Everything in these tests runs
/// on the main actor; the store's run-loop `Task` interleaves on the real
/// `Task.sleep` ticks below, so a short poll lets it make progress.
@MainActor
func liveWaitUntil(timeout: TimeInterval = 2, _ predicate: () -> Bool) async {
    let deadline = Date().addingTimeInterval(timeout)
    while !predicate(), Date() < deadline {
        try? await Task.sleep(nanoseconds: 2_000_000)
    }
}
