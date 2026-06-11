//
//  SectionErrorBoundary.Seams.swift
//  TeslaSync — P4 shared surface · 0138 · SectionErrorBoundary (Apple)
//
//  The dependency seams the SectionErrorBoundary view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S8 source protocol, the production controlled source (the
//  native parity of the host wiring a guarded section's caught-error + content + live-connection
//  into the boundary), and the in-memory source for previews / tests.
//
//  Parity note: the web `SectionErrorBoundary` is fully controlled by React's render machinery — the
//  boundary re-renders its `fallback` when a child throws, and clears it on Retry. SwiftUI has no
//  render-time catch, so `StaticSectionErrorBoundarySource` reproduces that contract: the host pushes
//  a snapshot (healthy, or carrying a caught `error`), the source re-emits it on `start` / `refresh`,
//  and `update(_:)` pushes a new one exactly as the web boundary re-renders with new state.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host-controlled
/// inputs (`StaticSectionErrorBoundarySource`); previews and tests use
/// `InMemorySectionErrorBoundarySource`. The view never reads the caught error or the connection
/// directly.
@MainActor
public protocol SectionErrorBoundarySource: AnyObject {
    var onUpdate: (@MainActor (SectionErrorBoundaryInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled host inputs)

/// The production source. Holds the host-controlled snapshot (the latest caught-error + content +
/// live-connection freshness + the parent lifecycle) and re-emits it on `start` / `refresh`. The
/// host updates the boundary by pushing a fresh snapshot via `update`, exactly as the web boundary
/// re-renders with new state. No networking — the data is owned upstream.
@MainActor
public final class StaticSectionErrorBoundarySource: SectionErrorBoundarySource {
    public var onUpdate: (@MainActor (SectionErrorBoundaryInput) -> Void)?

    private var snapshot: SectionErrorBoundaryInput

    public init(
        error: SectionBoundaryError? = nil,
        hasContent: Bool = true,
        connection: SectionBoundaryConnection = .live,
        isLoading: Bool = false
    ) {
        snapshot = SectionErrorBoundaryInput(
            error: error,
            hasContent: hasContent,
            connection: connection,
            isLoading: isLoading
        )
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web boundary
    /// re-rendering with a new caught-error / content / connectivity.
    public func update(_ input: SectionErrorBoundaryInput) {
        snapshot = input
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySectionErrorBoundarySource: SectionErrorBoundarySource {
    public var onUpdate: (@MainActor (SectionErrorBoundaryInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SectionErrorBoundaryInput?

    public init(initial: SectionErrorBoundaryInput? = nil) {
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
    public func push(_ input: SectionErrorBoundaryInput) {
        onUpdate?(input)
    }
}
