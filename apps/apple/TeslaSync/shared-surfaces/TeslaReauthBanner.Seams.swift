//
//  TeslaReauthBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0142 · TeslaReauthBanner (Apple)
//
//  The dependency seams the TeslaReauthBanner view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S8 source protocol (the native shape of the web document-event
//  listener), the production controlled source (re-emits the app-owned grant snapshot), and the
//  in-memory source for previews / tests.
//
//  Parity note: the web banner subscribes to two document-level events —
//  `teslasync:tesla-auth-expired` (dispatched by `resilientFetch` on a 401 `TESLA_TOKEN_EXPIRED`) and
//  `teslasync:tesla-auth-recovered` (emitted by `<TeslaAccountSection>` once the OAuth flow completes).
//  On Apple the composition root owns that bridge: it observes the equivalent app signal and pushes a
//  coalesced `TeslaReauthInput` (the grant status + the signal's load / connectivity state) into a
//  `StaticTeslaReauthSource` via `update(_:)`, exactly as the web parent re-renders the banner. The
//  view never reads the signal directly.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the app's Tesla-auth
/// signal (the native bridge for the web `tesla-auth-expired` / `tesla-auth-recovered` document
/// events); previews and tests use `InMemoryTeslaReauthSource`. The view never reads the signal
/// directly.
@MainActor
public protocol TeslaReauthSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (TeslaReauthInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled snapshot)

/// The production source. Holds the app-owned grant snapshot (the Tesla OAuth status + the signal's
/// connectivity) and re-emits it on `start` / `refresh`. The composition root updates the surface by
/// pushing a fresh snapshot via `update`, exactly as the web banner flips `visible` off the document
/// events. Seeding `.connected` keeps the banner hidden until an expiry snapshot arrives.
@MainActor
public final class StaticTeslaReauthSource: TeslaReauthSource {
    public var onUpdate: (@MainActor (TeslaReauthInput) -> Void)?

    private var snapshot: TeslaReauthInput

    public init(_ snapshot: TeslaReauthInput = TeslaReauthInput(status: .connected)) {
        self.snapshot = snapshot
    }

    /// Convenience for the controlled usage — the parity of the web parent mounting the banner with a
    /// known grant status and connectivity.
    public convenience init(status: TeslaReauthStatus, connection: TeslaReauthConnection = .live) {
        self.init(TeslaReauthInput(status: status, connection: connection))
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web banner observing
    /// a `tesla-auth-expired` / `tesla-auth-recovered` event and re-rendering.
    public func update(_ snapshot: TeslaReauthInput) {
        self.snapshot = snapshot
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryTeslaReauthSource: TeslaReauthSource {
    public var onUpdate: (@MainActor (TeslaReauthInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TeslaReauthInput?

    public init(initial: TeslaReauthInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: TeslaReauthInput) {
        onUpdate?(input)
    }
}
