//
//  AnomalyInlineRow.Model.swift
//  TeslaSync — P4 feature view · 0238 · AnomalyInlineRow (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `AnomalyInlineRow` owns the
//  `useVehicles` read + the `useQuery` against `/analytics/anomalies?…&days=1` and
//  decides between a `HealthRow` and `null`. The native surface reproduces that whole
//  lifecycle here: an `AnomalyInlineRowSource` pushes the resolved payload + load /
//  freshness status, and the model exposes the resolved `AnomalyInlineRowPhase` for
//  SwiftUI to switch over, drives the click-through activation seam (web `to`), and
//  emits the P1/S11 `view.opened` event once on first appearance. No networking here.
//

import Foundation
import Observation
import OSLog

/// The surface's observable view-model. Subscribes to an `AnomalyInlineRowSource`, holds
/// the latest freshness + resolved render phase, runs the click-through activation seam,
/// auto-refreshes once on a stale read, and keeps a cached row on screen while offline.
@MainActor
@Observable
public final class AnomalyInlineRowModel {
    /// The resolved top-level render phase (web `HealthRow` vs `null`, widened with the
    /// loading / error / friendly-empty envelopes).
    public private(set) var phase: AnomalyInlineRowPhase = .loading
    /// Live-stream freshness for the trailing chip (ADR-013).
    public private(set) var connection: AnomalyInlineRowConnection = .live
    /// The last time the bound source produced a snapshot.
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any AnomalyInlineRowSource
    @ObservationIgnored private let telemetry: any AnomalyInlineRowTelemetry
    @ObservationIgnored private let onActivate: @MainActor (AnomalyInlineRowDestination) -> Void
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any AnomalyInlineRowSource,
        telemetry: any AnomalyInlineRowTelemetry = OSLogAnomalyInlineRowTelemetry(),
        localize: @escaping (String, String) -> String = AnomalyInlineRowStrings.string,
        now: @escaping @Sendable () -> Date = Date.init,
        onActivate: @escaping @MainActor (AnomalyInlineRowDestination) -> Void = AnomalyInlineRowModel.logActivation
    ) {
        self.source = source
        self.telemetry = telemetry
        self.localize = localize
        self.now = now
        self.onActivate = onActivate
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (a11y)

    /// The VoiceOver summary for the surface's current phase.
    public var accessibilitySummary: String {
        switch phase {
        case .loading:
            return localize("anomaly.loading", "Checking for anomalies…")
        case let .content(content):
            return AnomalyInlineRowAccessibility.rowLabel(summary: content.summary, localize: localize)
        case .empty:
            return AnomalyInlineRowAccessibility.emptyLabel(localize: localize)
        case let .error(message):
            let title = localize("anomaly.error", "Couldn't load anomalies")
            return message.isEmpty ? title : "\(title): \(message)"
        }
    }

    /// The resolved content row, when the surface is in its `.content` phase.
    public var content: AnomalyInlineRowContent? {
        if case let .content(content) = phase { return content }
        return nil
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        AnomalyInlineRowSurface.reportOpen(to: telemetry)
        source.start()
    }

    /// Stops observing the upstream anomalies feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (the error-state retry / stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    /// Routes the click-through to the dedicated anomaly-detection page (web `to`),
    /// through the host-supplied activation seam.
    public func activate(_ destination: AnomalyInlineRowDestination) {
        onActivate(destination)
    }

    // MARK: Snapshot application

    private func apply(_ update: AnomalyInlineRowUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        phase = AnomalyInlineRowProjection.resolvePhase(
            status: update.status,
            data: update.data,
            now: now(),
            localize: localize
        )
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// row on screen and does not refetch.
    private func handleAutoRefresh(for connection: AnomalyInlineRowConnection) {
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

    /// The default activation sink: records the intent without navigating (so previews
    /// are inert). The production app injects a seam that pushes the route. Public so it
    /// can back the `public init`'s default argument.
    @MainActor
    public static func logActivation(_ destination: AnomalyInlineRowDestination) {
        Logger(subsystem: "io.teslasync.app", category: "navigation")
            .info("anomaly.inline-row.activate path=\(destination.path, privacy: .public)")
    }
}
