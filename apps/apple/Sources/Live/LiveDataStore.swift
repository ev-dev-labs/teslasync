import Foundation
import Observation

/// The `@Observable` live-data store: one per live surface. It binds a
/// `LiveStreamProvider` to SwiftUI scene/view lifecycle, merges cached REST data
/// with live events, tracks connection + freshness honestly, and runs the
/// auth-refresh/retry policy — so a view just reads `value` / `presentation`
/// and a modifier drives `activate`/`deactivate` (see `.liveData`).
///
/// Foreground-only by contract (ADR-009/013): it connects only while the scene
/// is active *and* a subscribing view is visible, and tears the stream down on
/// background/disappearance. SSE is never a background channel here (that is
/// APNs, P6-0002).
///
/// Generic over `Value` (the merged snapshot a page renders) and `Event` (the
/// typed live payload — `LiveFleetEvent` in production, any `Sendable` value in
/// tests). All mutation is on the main actor; cancelling closes the upstream.
@MainActor
@Observable
public final class LiveDataStore<Value, Event: Sendable> {
    // MARK: Observable snapshot

    /// The merged value to render (cached REST seed + applied live events).
    public private(set) var value: Value?
    /// The live connection phase (drives the live/stale/reconnecting badge).
    public private(set) var phase: LiveConnectionState = .closed
    /// When the cached REST value was last fetched (cache handoff).
    public private(set) var fetchedAt: Date?
    /// When the last live event (of any kind) arrived.
    public private(set) var lastEventAt: Date?
    /// The last terminal error, if the stream failed with nothing usable behind it.
    public private(set) var error: FacadeError?
    /// Whether the store is currently connected/streaming (scene-active + visible).
    public private(set) var isActive = false
    /// The last SSE `id` seen — forwarded as `Last-Event-ID` on re-subscribe.
    public private(set) var lastEventID: String?

    // MARK: Configuration (not observed)

    @ObservationIgnored private let target: LiveStreamTarget
    @ObservationIgnored private let provider: LiveStreamProvider<Event>
    @ObservationIgnored private let reduce: @MainActor (Value?, LiveEnvelope<Event>) -> Value?
    @ObservationIgnored private let isEmpty: @Sendable (Value) -> Bool
    @ObservationIgnored private let auth: (any AuthChallengeHandling)?
    @ObservationIgnored private let policy: LiveStalenessPolicy
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private let sleep: @Sendable (TimeInterval) async -> Void
    @ObservationIgnored private let restRefresh: (@Sendable () async -> Void)?
    @ObservationIgnored private let log: LiveLog

    // MARK: Lifecycle inputs

    @ObservationIgnored private var sceneActive = false
    @ObservationIgnored private var viewVisible = false
    @ObservationIgnored private var hasConnectedOnce = false
    @ObservationIgnored private var runTask: Task<Void, Never>?

    public init(
        target: LiveStreamTarget,
        provider: LiveStreamProvider<Event>,
        seed: Value? = nil,
        fetchedAt: Date? = nil,
        auth: (any AuthChallengeHandling)? = nil,
        policy: LiveStalenessPolicy = .standard,
        isEmpty: @escaping @Sendable (Value) -> Bool = { _ in false },
        clock: @escaping @Sendable () -> Date = { Date() },
        sleep: @escaping @Sendable (TimeInterval) async -> Void = { seconds in
            try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
        },
        restRefresh: (@Sendable () async -> Void)? = nil,
        log: LiveLog = LiveLog(),
        reduce: @escaping @MainActor (Value?, LiveEnvelope<Event>) -> Value?
    ) {
        self.target = target
        self.provider = provider
        value = seed
        self.fetchedAt = fetchedAt
        self.auth = auth
        self.policy = policy
        self.isEmpty = isEmpty
        self.clock = clock
        self.sleep = sleep
        self.restRefresh = restRefresh
        self.log = log
        self.reduce = reduce
    }

    // MARK: Derived state

    /// Whether the merged value currently has something to render.
    public var hasContent: Bool {
        guard let value else { return false }
        return !isEmpty(value)
    }

    /// Whether visible data is older than the freshness window (or the stream is
    /// flagged stale by the shared client).
    public var isStale: Bool {
        policy.isStale(now: clock(), lastActivityAt: lastActivityAt, phase: phase)
    }

    /// Seconds since the last live event / fetch, or `nil` if nothing yet.
    public var age: TimeInterval? {
        policy.age(now: clock(), lastActivityAt: lastActivityAt)
    }

    /// The five-state presentation a view should render.
    public var presentation: LivePresentation {
        LivePresentation.derive(
            hasContent: hasContent,
            hasError: error != nil,
            isStale: isStale,
            hasConnectedOnce: hasConnectedOnce
        )
    }

    private var lastActivityAt: Date? {
        [lastEventAt, fetchedAt].compactMap(\.self).max()
    }

    /// A non-generic snapshot of connection + freshness for status/stale UI.
    public var status: LiveStatus {
        LiveStatus(
            phase: phase,
            presentation: presentation,
            isActive: isActive,
            isStale: isStale,
            hasError: error != nil
        )
    }

    /// Whether the store should currently hold a connection.
    private var shouldBeLive: Bool {
        sceneActive && viewVisible
    }

    // MARK: Lifecycle inputs (driven by `.liveData` modifier)

    /// Reports the owning scene's active/inactive state.
    public func setScenePhaseActive(_ active: Bool) {
        guard sceneActive != active else { return }
        sceneActive = active
        reconcile()
    }

    /// Reports whether a subscribing view is on screen.
    public func setViewVisible(_ visible: Bool) {
        guard viewVisible != visible else { return }
        viewVisible = visible
        reconcile()
    }

    /// Forces both lifecycle inputs live (non-SwiftUI callers, previews, tests).
    public func activate() {
        sceneActive = true
        viewVisible = true
        reconcile()
    }

    /// Tears the connection down and stops streaming (background/disappear).
    public func deactivate() {
        sceneActive = false
        viewVisible = false
        reconcile()
    }

    /// Cache handoff: seed/replace the value from a REST load without dropping the
    /// live connection. Resets the freshness clock to `at`.
    public func reseed(value newValue: Value?, at instant: Date? = nil) {
        value = newValue
        fetchedAt = instant ?? clock()
        if newValue != nil { hasConnectedOnce = true }
        error = nil
    }

    /// Manual refresh: re-run any REST refresh hook and restart the live stream
    /// (resuming from the last event id). Keeps the current value visible.
    public func refresh() {
        error = nil
        Task { [restRefresh] in
            await restRefresh?()
        }
        guard shouldBeLive else { return }
        restartStream()
    }

    // MARK: Run loop

    private func reconcile() {
        if shouldBeLive {
            startStreamIfNeeded()
        } else {
            stopStream(finalPhase: .closed)
        }
    }

    private func startStreamIfNeeded() {
        guard runTask == nil else { return }
        isActive = true
        error = nil
        runTask = Task { [weak self] in
            await self?.runConnectionLoop()
        }
    }

    private func restartStream() {
        runTask?.cancel()
        runTask = nil
        startStreamIfNeeded()
    }

    private func stopStream(finalPhase: LiveConnectionState) {
        runTask?.cancel()
        runTask = nil
        isActive = false
        phase = finalPhase
    }

    /// Connect → consume → (auth-refresh / backoff) → reconnect, until the surface
    /// is no longer live or the task is cancelled. Each (re)subscription resumes
    /// with the remembered `Last-Event-ID`.
    private func runConnectionLoop() async {
        var authRetried = false
        var backoffStep = 0

        while shouldBeLive, !Task.isCancelled {
            phase = backoffStep == 0 ? .connecting : .reconnecting
            log.connection(target, phase: phase, attempt: backoffStep)

            let terminal = await consume(provider.open(target, resumingFrom: lastEventID)) { reset in
                if reset {
                    authRetried = false
                    backoffStep = 0
                }
            }

            if Task.isCancelled || !shouldBeLive { break }

            switch terminal {
            case .none:
                // Stream ended without a terminal failure (provider completed).
                phase = .closed
                return
            case let .some(failure):
                if case .auth = failure, let auth, !authRetried {
                    authRetried = true
                    phase = .reconnecting
                    log.notice("sse \(target.diagnosticLabel) 401 — refreshing session")
                    let recovered = await auth.handleUnauthorized()
                    if recovered { continue }
                    error = failure
                    phase = .closed
                    return
                }
                if failure.isRetryable {
                    backoffStep += 1
                    phase = .reconnecting
                    await sleep(backoffDelay(step: backoffStep))
                    continue
                }
                error = failure
                phase = .closed
                return
            }
        }
    }

    /// Drains one subscription. Returns the terminal failure that ended it, or
    /// `nil` if it finished cleanly. `onOpen(reset:)` fires when the stream first
    /// reaches `.open` so the caller can reset its auth/backoff budget.
    private func consume(
        _ stream: AsyncStream<LiveStreamElement<Event>>,
        onOpen: (_ reset: Bool) -> Void
    ) async -> FacadeError? {
        for await element in stream {
            if Task.isCancelled { break }
            switch element {
            case let .connection(state):
                phase = state
                if state == .open {
                    hasConnectedOnce = true
                    error = nil
                    onOpen(true)
                }
            case let .event(envelope):
                apply(envelope)
                onOpen(false)
            case let .failed(failure):
                return failure
            }
        }
        return nil
    }

    private func apply(_ envelope: LiveEnvelope<Event>) {
        lastEventAt = envelope.receivedAt
        if let id = envelope.id { lastEventID = id }
        hasConnectedOnce = true
        error = nil
        if phase == .stale { phase = .open }
        value = reduce(value, envelope)
    }

    private func backoffDelay(step: Int) -> TimeInterval {
        let base = 1.0
        let maximum = 30.0
        let exponential = base * pow(2.0, Double(max(0, step - 1)))
        return min(exponential, maximum)
    }
}
