//
//  LiveStaleDataBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0126 · LiveStaleDataBanner (Apple)
//
//  The dependency seams the LiveStaleDataBanner view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S8 source protocol (the native shape of the web `useLiveConnection`
//  subscription), the production controlled source (the native bridge between the SSE transport — the
//  peer of the web `sseManager` that backs `useLiveConnection` — and the surface's reading contract),
//  and the in-memory source for previews / tests.
//
//  Parity note: the web banner owns no data — it calls `useLiveConnection()`, a singleton subscriber to
//  `sseManager` that re-renders the banner on every wire-state change. The native source reproduces that
//  contract without leaking the transport into the view: the app shell observes the transport and pushes
//  a `LiveStaleDataBannerInput` (the current status, when it was entered, and the reading's freshness),
//  and the source forwards it to the bound model. The feed is push-based and synchronous (no HTTP in the
//  view), so `start` / `refresh` simply re-emit the current reading.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements it over the host's observation of the
/// live transport (`LiveConnectionStaleDataSource`); previews and tests use
/// `InMemoryLiveStaleDataBannerSource`. The view never reads the transport directly.
@MainActor
public protocol LiveStaleDataBannerSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced reading.
    var onUpdate: (@MainActor (LiveStaleDataBannerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Live source (production — holds the host-pushed status reading)

/// The production source. Holds the host's current live-status reading and re-emits it whenever the host
/// updates it — the native bridge between the SSE transport (the peer of the web `sseManager`) and the
/// surface's reading contract. Defaults to the `unknown` status so a freshly-mounted banner shows the
/// loading leaf until the first reading arrives, exactly as the web hook seeds `unknown` before it has
/// ever connected.
@MainActor
public final class LiveConnectionStaleDataSource: LiveStaleDataBannerSource {
    public var onUpdate: (@MainActor (LiveStaleDataBannerInput) -> Void)?

    private var reading: LiveStaleDataBannerInput

    public init(_ reading: LiveStaleDataBannerInput = LiveStaleDataBannerInput()) {
        self.reading = reading
    }

    /// Convenience for the controlled usage — the native parity of the app shell observing
    /// `useLiveConnection` and handing the banner a known status reading.
    public convenience init(
        status: LiveStaleStatus,
        statusSince: Date = Date(),
        errorMessage: String? = nil,
        freshness: LiveStaleFreshness = .live
    ) {
        self.init(LiveStaleDataBannerInput(
            status: status,
            statusSince: statusSince,
            errorMessage: errorMessage,
            freshness: freshness
        ))
    }

    public func start() {
        onUpdate?(reading)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(reading)
    }

    /// Replaces the controlled reading and re-emits it — the native parity of the web hook re-rendering
    /// the banner on a wire-state change.
    public func update(_ reading: LiveStaleDataBannerInput) {
        self.reading = reading
        onUpdate?(reading)
    }

    /// Replaces the reading from the live-status fields and re-emits it (the app shell's update hook).
    public func update(
        status: LiveStaleStatus,
        statusSince: Date = Date(),
        freshness: LiveStaleFreshness = .live
    ) {
        update(LiveStaleDataBannerInput(status: status, statusSince: statusSince, freshness: freshness))
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial reading on `start()` and
/// lets a test push further readings via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryLiveStaleDataBannerSource: LiveStaleDataBannerSource {
    public var onUpdate: (@MainActor (LiveStaleDataBannerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LiveStaleDataBannerInput?

    public init(initial: LiveStaleDataBannerInput? = nil) {
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

    /// Pushes a reading to the bound model (test/preview affordance).
    public func push(_ input: LiveStaleDataBannerInput) {
        onUpdate?(input)
    }
}
