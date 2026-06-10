//
//  TourLauncher.Model.swift
//  TeslaSync — P4 misc surface · 0001 · TourLauncher (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `TourLauncher` owns its own modal
//  open state, reads `listTours()` + per-tour completion off `localStorage`, highlights the tour
//  matching `useLocation().pathname`, and dispatches `dispatchTourStart` / `resetAllTours`. The
//  native surface reproduces that whole lifecycle here: a `TourLauncherSource` pushes the
//  resolved registry + completed ids + current route + freshness, and the model owns the resolved
//  `TourLauncherPhase` + the projected rows for SwiftUI to switch over. No persistence access and
//  no tour-engine wiring live in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `TourLauncherSource`, holds the latest
/// registry + completion + route + freshness, exposes the resolved render phase + the projected
/// launcher rows, drives the start / reset / list-seen command seams, and emits the P1/S11
/// `view.opened` event once on first appearance.
@MainActor
@Observable
public final class TourLauncherModel {
    // Load + freshness (from the source)
    public private(set) var phase: TourLauncherPhase = .loading
    public private(set) var connection: TourLauncherConnection = .live
    public private(set) var entries: [TourCatalogEntry] = []
    public private(set) var completedIDs: Set<String> = []
    public private(set) var pathname = "/"
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The query failure message kept while cached rows remain on screen, so the content branch
    /// can surface the inline error above the list (web reload-failure-with-cached-data).
    public private(set) var loadFailure: String?

    @ObservationIgnored private let source: any TourLauncherSource
    @ObservationIgnored private let telemetry: any TourLauncherTelemetry
    @ObservationIgnored private let controller: any TourLauncherController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TourLauncherSource,
        telemetry: any TourLauncherTelemetry = OSLogTourLauncherTelemetry(),
        controller: any TourLauncherController = OSLogTourLauncherController(),
        localize: @escaping (String, String) -> String = TourLauncherStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.controller = controller
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (rows + inline error + a11y)

    /// The projected launcher rows for the current registry + completion + route (web
    /// `tours.map(...)`), resolved through the bound localizer.
    public var rows: [TourRow] {
        TourLauncherProjection.rows(
            entries: entries,
            completedIDs: completedIDs,
            pathname: pathname,
            localize: localize
        )
    }

    /// The inline reload error shown above the populated list (web cached-rows-with-failure),
    /// present only while rows are on screen despite a failed reload.
    public var inlineErrorMessage: String? {
        guard case .content = phase else { return nil }
        return loadFailure
    }

    /// The VoiceOver summary for the launcher.
    public var accessibilitySummary: String {
        TourLauncherAccessibility.summary(count: entries.count, localize: localize)
    }

    /// One row's VoiceOver label, resolved through the bound localizer.
    public func accessibilityRowLabel(for row: TourRow) -> String {
        TourLauncherAccessibility.rowLabel(row, localize: localize)
    }

    /// One row's Start / Replay button accessibility label (web `aria-label`).
    public func accessibilityActionLabel(for row: TourRow) -> String {
        TourLauncherAccessibility.actionLabel(row, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing, records the launcher as seen (web `markTourListSeen`), and emits the
    /// `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TourLauncherSurface.slug)
        controller.markListSeen()
        source.start()
    }

    /// Stops observing the upstream registry feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-reads the registry + completion store (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Commands (web `handleStart` / `handleResetAll`)

    /// Starts (or replays) a tour by id — the web `dispatchTourStart(def.id)`. The presenting
    /// host closes the launcher around this call (web `setOpen(false)` then dispatch).
    public func startTour(_ id: String) {
        controller.startTour(id: id)
    }

    /// Clears every tour's completion flag (web `resetAllTours()`); the source re-pushes a fresh
    /// snapshot so the "Completed" badges drop on the next render.
    public func resetAllTours() {
        source.resetAllTours()
    }

    // MARK: Snapshot application

    private func apply(_ update: TourLauncherUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        entries = update.entries
        completedIDs = update.completedIDs
        pathname = update.pathname
        loadFailure = Self.failureMessage(update.status)
        phase = TourLauncherProjection.resolvePhase(status: update.status, tourCount: entries.count)
        handleAutoRefresh(for: update.connection)
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: TourLauncherLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached rows on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: TourLauncherConnection) {
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
