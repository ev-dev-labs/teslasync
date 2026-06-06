import Foundation

/// A live snapshot for previews and the demo/UI-test surface: a running count of
/// applied updates plus the most recent signal field/value.
public struct LiveDemoSnapshot: Equatable, Sendable {
    public var updateCount: Int
    public var lastField: String
    public var lastValue: String

    public init(updateCount: Int = 0, lastField: String = "", lastValue: String = "") {
        self.updateCount = updateCount
        self.lastField = lastField
        self.lastValue = lastValue
    }

    /// The reducer the demo store uses to fold live events into the snapshot.
    public static func reduce(
        _ current: LiveDemoSnapshot?,
        _ envelope: LiveEnvelope<LiveFleetEvent>
    ) -> LiveDemoSnapshot? {
        var next = current ?? LiveDemoSnapshot()
        switch envelope.payload {
        case let .vehicleUpdate(_, signals):
            if let first = signals.min(by: { $0.key < $1.key }) {
                next.updateCount += 1
                next.lastField = first.key
                next.lastValue = first.value.displayValue
            }
        case let .signal(sample):
            next.updateCount += 1
            next.lastField = sample.field
            next.lastValue = sample.value.displayValue
        default:
            break
        }
        return next
    }
}

/// A deterministically controllable live source for SwiftUI previews and the
/// demo/UI-test surface. It vends a `LiveStreamProvider` whose stream the demo
/// controls turn by turn — open, push an update, go stale, reconnect, or simulate
/// a 401 — so the live indicator and stale banner can be exercised without a real
/// SSE backend.
public final class DemoLiveSource: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: AsyncStream<LiveStreamElement<LiveFleetEvent>>.Continuation?
    private var sequence = 0

    public init() {}

    /// The provider to hand to a `LiveDataStore`. Each `open` attaches a fresh
    /// stream and immediately reports an open, fresh connection.
    public func provider() -> LiveStreamProvider<LiveFleetEvent> {
        LiveStreamProvider { [weak self] _, _ in
            AsyncStream { continuation in
                self?.attach(continuation)
            }
        }
    }

    private func attach(_ continuation: AsyncStream<LiveStreamElement<LiveFleetEvent>>.Continuation) {
        lock.lock()
        self.continuation = continuation
        lock.unlock()
        continuation.yield(.connection(.open))
        emitUpdate()
    }

    /// Pushes a fresh vehicle update (advances freshness, keeps the badge live).
    public func emitUpdate() {
        let value = nextValue()
        yield(.event(LiveEnvelope(
            id: "demo-\(value)",
            kind: .vehicleUpdate,
            receivedAt: Date(),
            payload: .vehicleUpdate(vehicleID: 1, signals: ["battery_level": .number(Double(value))])
        )))
    }

    /// Flags the stream stale without dropping it (shows the stale banner).
    public func goStale() {
        yield(.connection(.stale))
    }

    /// Returns to a fresh, open connection with a new value.
    public func reconnect() {
        yield(.connection(.open))
        emitUpdate()
    }

    /// Simulates a 401 — the store delegates to auth refresh and retries once.
    public func fail401() {
        yield(.failed(.auth(message: "demo session expired")))
    }

    private func nextValue() -> Int {
        lock.lock()
        defer { lock.unlock() }
        sequence += 1
        return 50 + sequence
    }

    private func yield(_ element: LiveStreamElement<LiveFleetEvent>) {
        lock.lock()
        let continuation = continuation
        lock.unlock()
        continuation?.yield(element)
    }
}

public extension LiveDataStore where Value == LiveDemoSnapshot, Event == LiveFleetEvent {
    /// Builds a demo store wired to a `DemoLiveSource` (previews + UI tests).
    static func demo(source: DemoLiveSource, auth: (any AuthChallengeHandling)? = nil) -> LiveDataStore {
        LiveDataStore(
            target: .vehicle(id: 1),
            provider: source.provider(),
            auth: auth,
            reduce: LiveDemoSnapshot.reduce
        )
    }
}

/// An `AuthChallengeHandling` that reports a configurable recovery outcome, for
/// the demo screen's "simulate 401" control and previews.
public final class DemoAuthChallenge: AuthChallengeHandling, @unchecked Sendable {
    private let recovers: Bool

    public init(recovers: Bool = true) {
        self.recovers = recovers
    }

    @discardableResult
    public func handleUnauthorized() async -> Bool {
        recovers
    }
}
