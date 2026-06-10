//
//  SnapshotInspector.Model.swift
//  TeslaSync — P4 feature view · 0234 · SnapshotInspector (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `SnapshotInspector` receives
//  the selected transition + signal snapshot from the FSM-debugger page and derives its
//  rows / copy payload / empty branches. The native surface reproduces that whole
//  lifecycle here: a `SnapshotInspectorSource` pushes the resolved input + load / freshness
//  status, and the model exposes the resolved `SnapshotInspectorPhase` for SwiftUI to
//  switch over, owns the diff-mode toggle (web `useState`), drives the jump-to-last seam
//  (web `onJumpToLast`), and emits the P1/S11 `view.opened` event once. No networking here.
//

import Foundation
import Observation
import OSLog

/// The surface's observable view-model. Subscribes to a `SnapshotInspectorSource`, holds
/// the latest freshness + resolved render phase, owns the diff-mode toggle, runs the
/// jump-to-last seam, auto-refreshes once on a stale read, and keeps cached detail on
/// screen while offline.
@MainActor
@Observable
public final class SnapshotInspectorModel {
    /// The resolved top-level render phase (web loading / outside-window / no-selection /
    /// snapshot, widened with the error envelope).
    public private(set) var phase: SnapshotInspectorPhase = .loading
    /// Live-stream freshness for the trailing chip (ADR-013).
    public private(set) var connection: SnapshotInspectorConnection = .live
    /// The last time the bound source produced a snapshot.
    public private(set) var updatedAt: Date?
    /// Whether the diff-vs-previous toggle is on (web `diffMode` `useState`). Pure render
    /// state; the rows always carry their `changed` flag + prior value.
    public var diffMode = false

    @ObservationIgnored private let source: any SnapshotInspectorSource
    @ObservationIgnored private let telemetry: any SnapshotInspectorTelemetry
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SnapshotInspectorSource,
        telemetry: any SnapshotInspectorTelemetry = OSLogSnapshotInspectorTelemetry(),
        localize: @escaping (String, String) -> String = SnapshotInspectorStrings.string,
        locale: Locale = .current,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.source = source
        self.telemetry = telemetry
        self.localize = localize
        self.locale = locale
        self.now = now
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived

    /// The resolved snapshot detail, when the surface is in its `.snapshot` phase.
    public var content: SnapshotInspectorContent? {
        if case let .snapshot(content) = phase { return content }
        return nil
    }

    /// The VoiceOver summary for the surface's current phase.
    public var accessibilitySummary: String {
        switch phase {
        case .loading:
            return localize("debugger.inspector.loading", "Loading…")
        case let .snapshot(content):
            return SnapshotInspectorAccessibility.detailLabel(
                from: content.fromState, to: content.toState, localize: localize
            )
        case let .outsideWindow(relative):
            return localize(
                "debugger.inspector.emptyOutsideWindow",
                "Nothing in the current window. Last transition {{rel}}."
            )
            .replacingOccurrences(of: "{{rel}}", with: relative)
        case .noSelection:
            return localize("debugger.inspector.empty", "Select a transition to inspect its snapshot")
        case let .error(message):
            let title = localize("debugger.inspector.error", "Couldn't load the snapshot")
            return message.isEmpty ? title : "\(title): \(message)"
        }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        SnapshotInspectorSurface.reportOpen(to: telemetry)
        source.start()
    }

    /// Stops observing the upstream snapshot feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (the error-state retry / stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    /// Switches the debugger to Freeze mode and selects the last transition (web
    /// `onJumpToLast`), through the host-supplied source seam.
    public func jumpToLastTransition() {
        source.jumpToLastTransition()
    }

    // MARK: Snapshot application

    private func apply(_ update: SnapshotInspectorUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        phase = SnapshotInspectorProjection.resolvePhase(
            status: update.status,
            input: update.input,
            now: now(),
            localize: localize,
            locale: locale
        )
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// detail on screen and does not refetch.
    private func handleAutoRefresh(for connection: SnapshotInspectorConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
