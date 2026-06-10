//
//  SignalCompareControls.Model.swift
//  TeslaSync — P4 feature view · 0267 · SignalCompareControls (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `SignalCompareControls` is
//  a controlled component — its parent page owns `atA` / `atB` / `search` / `category`
//  and merges the `onChange*` patches the bar emits. The native surface reproduces that
//  contract: a `SignalCompareSource` pushes the host's current selection + the catalog
//  of comparable signals + the load / freshness status, and the model holds the
//  controlled selection, computes each patch through the pure projection, echoes it
//  locally (optimistic), and forwards it to the host via the change sink. No networking
//  lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `SignalCompareSource`, holds the
/// latest comparable signals + freshness + the controlled selection, exposes the
/// resolved `SignalComparePhase` for SwiftUI to switch over, and emits the P1/S11
/// `view.opened` event once on first appearance.
@MainActor
@Observable
public final class SignalCompareControlsModel {
    // Load + freshness (from the source)
    public private(set) var phase: SignalComparePhase = .loading
    public private(set) var connection: SignalCompareConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var availableSignals: [String] = []

    /// Controlled selection (web parent props + the `onChange*` echo).
    public private(set) var selection: SignalCompareSelection

    @ObservationIgnored private let source: any SignalCompareSource
    @ObservationIgnored private let telemetry: any SignalCompareTelemetry
    @ObservationIgnored private let changeSink: any SignalCompareChangeSink
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SignalCompareSource,
        selection: SignalCompareSelection = SignalCompareSelection(),
        telemetry: any SignalCompareTelemetry = OSLogSignalCompareTelemetry(),
        changeSink: any SignalCompareChangeSink = OSLogSignalCompareChangeSink(),
        timeZone: TimeZone = .current,
        clock: @escaping @Sendable () -> Date = { Date() },
        localize: @escaping (String, String) -> String = SignalCompareStrings.string
    ) {
        self.source = source
        self.selection = selection
        self.telemetry = telemetry
        self.changeSink = changeSink
        self.timeZone = timeZone
        self.clock = clock
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived state

    /// The selected category model (web `category` id → `CATEGORY_PREFIXES.find`).
    public var selectedCategory: SignalDiffCategory? {
        SignalDiffCategory.category(id: selection.category)
    }

    /// The comparable signals matching the active search + category (web filter predicate).
    public var matchingSignals: [String] {
        SignalCompareProjection.matchingSignals(availableSignals, selection: selection)
    }

    /// The ISO server-query a page issues from the selection (web `isoOrEmpty`).
    public var serverQuery: SignalCompareServerQuery {
        SignalCompareProjection.serverQuery(for: selection, timeZone: timeZone)
    }

    /// The VoiceOver summary for the bar.
    public var accessibilitySummary: String {
        SignalCompareAccessibility.summary(
            availableCount: availableSignals.count,
            category: selectedCategory,
            localize: localize
        )
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SignalCompareSurface.slug)
        source.start()
    }

    /// Stops observing the upstream available-signals feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying available-signals query (web refetch) — the error-state retry.
    public func refresh() {
        source.refresh()
    }

    // MARK: Control intents (web setters → `onChange*`)

    /// Web `onChangeA(value)`: sets window A's `datetime-local` field.
    public func setWindowA(_ value: String) {
        var next = selection
        next.atA = value
        emit(next)
    }

    /// Web `onChangeB(value)`: sets window B's `datetime-local` field.
    public func setWindowB(_ value: String) {
        var next = selection
        next.atB = value
        emit(next)
    }

    /// Web `applyPreset(id)`: writes both windows from the preset, keeping search + category.
    public func applyPreset(_ id: SignalDiffPresetID) {
        emit(
            SignalCompareProjection.selection(
                applyingPreset: id,
                to: selection,
                now: clock(),
                timeZone: timeZone
            )
        )
    }

    /// Web `onSearchChange(value)`: sets the signal filter text.
    public func setSearch(_ value: String) {
        var next = selection
        next.search = value
        emit(next)
    }

    /// Web `onCategoryChange(category === id ? null : id)`: toggles the tapped category.
    public func toggleCategory(_ id: String) {
        var next = selection
        next.category = SignalCompareProjection.toggledCategory(current: selection.category, tapped: id)
        emit(next)
    }

    /// Web "Clear" affordance: drops the active category filter.
    public func clearCategory() {
        guard selection.category != nil else { return }
        var next = selection
        next.category = nil
        emit(next)
    }

    // MARK: Snapshot application

    private func apply(_ update: SignalCompareUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        availableSignals = update.availableSignals
        selection = update.selection
        phase = SignalCompareProjection.resolvePhase(update.status, comparableCount: availableSignals.count)
        handleAutoRefresh(for: update.connection)
    }

    /// Echoes the patch locally (optimistic controlled update) and forwards it to the
    /// host through the change sink (web `onChange*`).
    private func emit(_ next: SignalCompareSelection) {
        selection = next
        changeSink.selectionChanged(next)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// snapshots on screen and does not refetch.
    private func handleAutoRefresh(for connection: SignalCompareConnection) {
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
