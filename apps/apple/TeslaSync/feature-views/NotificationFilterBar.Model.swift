//
//  NotificationFilterBar.Model.swift
//  TeslaSync — P4 feature view · 0189 · NotificationFilterBar (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `NotificationFilterBar` is
//  a controlled component — its parent inbox owns `NotificationFilters` and merges the
//  `onChange` patches the bar emits. The native surface reproduces that contract: a
//  `NotificationFilterSource` pushes the parent's current filters + the selectable
//  vehicle / rule options + the load / freshness status, and the model holds the
//  controlled filter state, computes each patch through the pure adapter, echoes it
//  locally (optimistic), and forwards it to the host via the change sink. No networking
//  lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `NotificationFilterSource`,
/// holds the latest options + freshness + the controlled filter state, exposes the
/// resolved `NotificationFilterPhase` plus the derived active-filter chips for SwiftUI
/// to switch over, and emits the P1/S11 `view.opened` event once on first appearance.
@MainActor
@Observable
public final class NotificationFilterModel {
    // Load + freshness (from the source)
    public private(set) var phase: NotificationFilterPhase = .loading
    public private(set) var connection: NotificationFilterConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var vehicles: [NotificationVehicleOption] = []
    public private(set) var rules: [NotificationRuleOption] = []

    /// Controlled filter state (web parent prop + the `onChange` echo)
    public private(set) var filters: NotificationFilters

    @ObservationIgnored private let source: any NotificationFilterSource
    @ObservationIgnored private let telemetry: any NotificationFilterTelemetry
    @ObservationIgnored private let changeSink: any NotificationFilterChangeSink
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any NotificationFilterSource,
        filters: NotificationFilters = NotificationFilters(),
        telemetry: any NotificationFilterTelemetry = OSLogNotificationFilterTelemetry(),
        changeSink: any NotificationFilterChangeSink = OSLogNotificationFilterChangeSink(),
        localize: @escaping (String, String) -> String = NotificationFilterStrings.string
    ) {
        self.source = source
        self.filters = filters
        self.telemetry = telemetry
        self.changeSink = changeSink
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived state

    /// The count of selectable options (web `vehicles.length + rules.length`) — drives
    /// the empty vs. content phase.
    public var optionCount: Int {
        vehicles.count + rules.count
    }

    /// Whether any bar-owned filter is active (drives the clear-all affordance).
    public var hasActiveFilters: Bool {
        filters.hasActiveBarFilters
    }

    /// The active-filter chips (web `activeFilterChips`), in the web order.
    public var activeChips: [NotificationActiveChip] {
        NotificationFilterProjection.activeChips(
            for: filters,
            vehicles: vehicles,
            rules: rules,
            localize: localize
        )
    }

    /// The VoiceOver summary for the bar.
    public var accessibilitySummary: String {
        NotificationFilterAccessibility.summary(activeCount: activeChips.count, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: NotificationFilterSurface.slug)
        source.start()
    }

    /// Stops observing the upstream options feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying option queries (web refetch) — the error-state retry.
    public func refresh() {
        source.refresh()
    }

    // MARK: Control intents (web setters → `onChange`)

    public func toggleSeverity(_ severity: NotificationSeverity) {
        emit(filters.togglingSeverity(severity))
    }

    public func setVehicle(_ id: Int?) {
        emit(filters.settingVehicle(id))
    }

    public func setRule(_ id: Int?) {
        emit(filters.settingRule(id))
    }

    public func setQuery(_ query: String) {
        emit(filters.settingQuery(query))
    }

    public func setFrom(_ date: String) {
        emit(filters.settingFrom(date))
    }

    public func setTo(_ date: String) {
        emit(filters.settingTo(date))
    }

    /// Sets the from/to pair in one patch (web `RangePicker.onChange`).
    public func setDateRange(from: String, to: String) {
        emit(filters.settingFrom(from).settingTo(to))
    }

    /// Clears the whole severity set (web removing the severity chip).
    public func clearSeverity() {
        var next = filters
        next.severity = []
        emit(next)
    }

    /// Web `ActiveFilterChips.onRemove`: clears the field backing the tapped chip.
    public func removeChip(_ chip: NotificationActiveChip) {
        switch chip.kind {
        case .severity: clearSeverity()
        case .vehicle: setVehicle(nil)
        case .rule: setRule(nil)
        case .query: setQuery("")
        case .from: setFrom("")
        case .to: setTo("")
        }
    }

    /// Web `handleClearAll`: clears every bar-owned field, keeping pass-throughs.
    public func clearAll() {
        emit(filters.clearingBarFilters())
    }

    // MARK: Snapshot application

    private func apply(_ update: NotificationFilterUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        vehicles = update.vehicles
        rules = update.rules
        filters = update.filters
        phase = NotificationFilterProjection.resolvePhase(update.status, optionCount: optionCount)
        handleAutoRefresh(for: update.connection)
    }

    /// Echoes the patch locally (optimistic controlled update) and forwards it to the
    /// host through the change sink (web `onChange`).
    private func emit(_ next: NotificationFilters) {
        filters = next
        changeSink.filtersChanged(next)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// options on screen and does not refetch.
    private func handleAutoRefresh(for connection: NotificationFilterConnection) {
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
