//
//  GotoIndicator.Seams.swift
//  TeslaSync — P4 shared surface · 0121 · GotoIndicator (Apple)
//
//  The dependency seams the GotoIndicator view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 source protocol (the native shape of the web keyboard-navigation
//  controller that owns the `visible` flag), the production controlled source (re-emits the
//  parent-owned snapshot), and the in-memory source for previews / tests.
//
//  Parity note: the web data owner is the app's keyboard-shortcut controller — it toggles `visible`
//  while the "press g, then …" chord is pending and clears it once a key is chosen or the chord times
//  out. The production app implements `GotoIndicatorSource` over that controller; the source emits a
//  coalesced `GotoIndicatorInput` (the controlled visibility + the controller's load / connectivity
//  state) on each change. The view never reads the controller directly.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the keyboard-navigation
/// controller; previews and tests use `InMemoryGotoIndicatorSource`. The view never reads the
/// controller directly.
@MainActor
public protocol GotoIndicatorSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (GotoIndicatorInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled snapshot)

/// The production source. Holds the parent-owned snapshot (the web `visible` flag + the controller's
/// connectivity) and re-emits it on `start` / `refresh`. The composition root updates the surface by
/// pushing a fresh snapshot via `update`, exactly as the web parent re-renders the indicator with a new
/// `visible` value.
@MainActor
public final class StaticGotoIndicatorSource: GotoIndicatorSource {
    public var onUpdate: (@MainActor (GotoIndicatorInput) -> Void)?

    private var snapshot: GotoIndicatorInput

    public init(_ snapshot: GotoIndicatorInput = GotoIndicatorInput()) {
        self.snapshot = snapshot
    }

    /// Convenience for the controlled-prop usage — the parity of the web parent supplying `visible`.
    public convenience init(visible: Bool, connection: GotoConnection = .live) {
        self.init(GotoIndicatorInput(visibility: visible, connection: connection))
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web parent handing
    /// the indicator a new `visible` / connectivity.
    public func update(_ snapshot: GotoIndicatorInput) {
        self.snapshot = snapshot
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryGotoIndicatorSource: GotoIndicatorSource {
    public var onUpdate: (@MainActor (GotoIndicatorInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: GotoIndicatorInput?

    public init(initial: GotoIndicatorInput? = nil) {
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
    public func push(_ input: GotoIndicatorInput) {
        onUpdate?(input)
    }
}
