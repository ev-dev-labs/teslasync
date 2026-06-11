//
//  AlertBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0113 · AlertBanner (Apple)
//
//  The dependency seams the AlertBanner view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 source protocol, the production controlled source (the native
//  parity of the host wiring `useMutationToast` + the live-connection holder into the banner), and
//  the in-memory source for previews / tests.
//
//  Parity note: the web `AlertBanner` is fully controlled — the host (e.g. `OfflineBanner`,
//  `LiveStaleDataBanner`, or a mutation `onError` callback) decides when it renders and supplies the
//  copy + `onClose`. There is no fetch inside the banner. `StaticAlertBannerSource` reproduces that:
//  it re-emits the host-provided snapshot on `start` / `refresh`, and `update(_:)` pushes a new one
//  exactly as the web host re-renders the banner with new props.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host-controlled
/// inputs (`StaticAlertBannerSource`); previews and tests use `InMemoryAlertBannerSource`. The view
/// never reads the mutation bus or the connection directly.
@MainActor
public protocol AlertBannerSource: AnyObject {
    var onUpdate: (@MainActor (AlertBannerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled host inputs)

/// The production source. Holds the host-controlled snapshot (the latest `useMutationToast` event +
/// the live-connection freshness + the parent lifecycle) and re-emits it on `start` / `refresh`.
/// The host updates the banner by pushing a fresh snapshot via `update`, exactly as the web host
/// re-renders the banner with new props. No networking — the data is owned upstream.
@MainActor
public final class StaticAlertBannerSource: AlertBannerSource {
    public var onUpdate: (@MainActor (AlertBannerInput) -> Void)?

    private var snapshot: AlertBannerInput

    public init(
        notice: AlertBannerNotice? = nil,
        connection: AlertBannerConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        snapshot = AlertBannerInput(
            notice: notice,
            connection: connection,
            isLoading: isLoading,
            errorMessage: errorMessage
        )
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web host
    /// re-rendering the banner with a new mutation / connectivity / lifecycle.
    public func update(_ input: AlertBannerInput) {
        snapshot = input
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAlertBannerSource: AlertBannerSource {
    public var onUpdate: (@MainActor (AlertBannerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AlertBannerInput?

    public init(initial: AlertBannerInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: AlertBannerInput) {
        onUpdate?(input)
    }
}
