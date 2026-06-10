//
//  WidgetSettingsModal.Model.swift
//  TeslaSync — P4 modal / dialog · 0027 · WidgetSettingsModal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `WidgetSettingsModal` owns the editable
//  config in local state (`useState(widget.config ?? {})`), derives the vehicle-scope list from
//  `useVehicles`, reads `def.category` to decide which optional sections show, and on Save projects the
//  draft into `onSave(config)`. The native surface reproduces that whole lifecycle here: a
//  `WidgetSettingsSource` pushes the edited widget + the fleet vehicle list + freshness, and the model
//  owns the draft (rebuilt only when the edited widget's identity changes, so a freshness flip
//  preserves edits), the resolved phase, every field mutator, the save / cancel seams, and the stale
//  auto-refresh — emitting the P1/S11 `view.opened` event once on first appearance. No networking
//  lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `WidgetSettingsSource`, holds the editable
/// draft (vehicle scope / refresh cadence / time range / show-title), exposes the resolved phase + the
/// vehicle list + the category-driven section visibility, and drives the per-field mutators plus the
/// save / cancel seams.
@MainActor
@Observable
public final class WidgetSettingsModel {
    // Load + freshness (from the source)
    public private(set) var loadStatus: WidgetSettingsLoadStatus = .loading
    public private(set) var connection: WidgetSettingsConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Resolved render state
    public private(set) var phase: WidgetSettingsPhase = .loading
    public private(set) var inlineErrorMessage: String?

    // Edited widget + fleet vehicle list (from the source)
    public private(set) var widget: WidgetDescriptor?
    public private(set) var vehicles: [WidgetVehicleOption] = []

    /// The editable draft (web local `config` state); rebuilt only when the edited widget's identity
    /// changes so a freshness flip preserves edits.
    public private(set) var draft = WidgetSettingsDraft.blank

    @ObservationIgnored private let source: any WidgetSettingsSource
    @ObservationIgnored private let telemetry: any WidgetSettingsTelemetry
    @ObservationIgnored private let actions: any WidgetSettingsActions
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var builtIdentity: String?
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any WidgetSettingsSource,
        telemetry: any WidgetSettingsTelemetry = OSLogWidgetSettingsTelemetry(),
        actions: any WidgetSettingsActions = OSLogWidgetSettingsActions(),
        localize: @escaping (String, String) -> String = WidgetSettingsStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.actions = actions
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived

    /// The refresh-cadence options (web refresh `<Select>`).
    public var refreshOptions: [WidgetRefreshOption] {
        WidgetRefreshCatalog.options
    }

    /// The chart time-range options (web time-range `<Select>`).
    public var timeRangeOptions: [WidgetTimeRangeOption] {
        WidgetTimeRangeCatalog.options
    }

    /// Whether the vehicle-scope section is shown for the edited widget (web `isVehicleWidget`).
    public var showsVehicleSection: Bool {
        widget?.showsVehicleSection ?? false
    }

    /// Whether the chart time-range section is shown for the edited widget (web `isChartWidget`).
    public var showsTimeRangeSection: Bool {
        widget?.showsTimeRangeSection ?? false
    }

    /// The web checked state for the show-title switch (`config.showTitle !== false`).
    public var showTitleChecked: Bool {
        draft.showTitleChecked
    }

    /// The chart time-range token currently shown (web `config.timeRange ?? '7d'`).
    public var timeRangeValue: String {
        WidgetSettingsProjection.timeRangeValue(for: draft.timeRange)
    }

    /// Whether the draft differs from the widget's saved config (exposed for the a11y hint + tests;
    /// the Save button stays enabled to mirror the web).
    public var isDirty: Bool {
        guard let widget else { return false }
        return WidgetSettingsProjection.isDirty(draft: draft, original: widget.config)
    }

    /// The dialog title (web `\`${def.name} Settings\``); falls back to a generic title before a
    /// widget resolves so the loading / empty / error chrome still has a heading.
    public var headerTitle: String {
        guard let name = widget?.name,
              !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return localize("widgetSettings.fallbackTitle", "Widget Settings")
        }
        return WidgetSettingsAccessibility.dialogLabel(widgetName: name, localize: interpolating)
    }

    /// The dialog container's VoiceOver label (the dialog title).
    public var accessibilityLabel: String {
        headerTitle
    }

    /// The display name of the currently-scoped vehicle, or `nil` when scoped to all vehicles.
    public var selectedVehicleName: String? {
        guard let id = draft.vehicleID else { return nil }
        return vehicles.first { $0.id == id }?.displayName
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WidgetSettingsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the vehicle-list query (the error-state retry / the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    // MARK: Field mutators (web local `setConfig`)

    /// Updates the vehicle scope (web `setConfig(prev => ({ ...prev, vehicleId }))`); `nil` = all
    /// vehicles (web `val === 'all' ? undefined : Number(val)`).
    public func setVehicleID(_ vehicleID: Int?) {
        draft.vehicleID = vehicleID
    }

    /// Updates the refresh cadence (web `setConfig(prev => ({ ...prev, refreshRate }))`); `nil` = the
    /// per-widget default (web `val === 'default' ? undefined : Number(val)`).
    public func setRefreshRate(_ rate: Int?) {
        draft.refreshRate = rate
    }

    /// Updates the chart time range (web `setConfig(prev => ({ ...prev, timeRange: value }))`).
    public func setTimeRange(_ range: String) {
        draft.timeRange = range
    }

    /// Toggles the show-title switch (web `setConfig(prev => ({ ...prev, showTitle: checked }))`).
    public func setShowTitle(_ value: Bool) {
        draft.showTitle = value
    }

    // MARK: Commands (web `handleSave` / `onClose`)

    /// Commits the draft (web `handleSave`: `onSave(config)`), then leaves dismissal to the view. A
    /// no-op when no widget is resolved.
    public func save() {
        guard widget != nil else { return }
        let change = WidgetSettingsProjection.commit(draft: draft)
        actions.commit(change)
    }

    /// Cancels without committing (web `onClose()`).
    public func cancel() {
        actions.cancel()
    }

    // MARK: Display projection

    /// The localized label for a refresh option (web `t('dashboard.settings.…', label)`).
    public func refreshLabel(_ option: WidgetRefreshOption) -> String {
        localize(option.labelKey, option.labelFallback)
    }

    /// The localized label for a time-range option (web `t('dashboard.settings.…', label)`).
    public func timeRangeLabel(_ option: WidgetTimeRangeOption) -> String {
        localize(option.labelKey, option.labelFallback)
    }

    /// The display label for a vehicle option (web `v.display_name || \`Vehicle ${id}\``).
    public func vehicleLabel(_ vehicle: WidgetVehicleOption) -> String {
        WidgetSettingsProjection.vehicleLabel(for: vehicle, localize: interpolating)
    }

    // MARK: Snapshot application

    private func apply(_ update: WidgetSettingsUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        widget = update.widget
        vehicles = update.vehicles
        rebuildDraftIfNeeded(for: update)
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Rebuilds the editable draft only when the edited widget's identity changes (web remounts per
    /// widget), so a pure freshness flip preserves the operator's edits.
    private func rebuildDraftIfNeeded(for update: WidgetSettingsUpdate) {
        guard let widget = update.widget else { return }
        guard widget.id != builtIdentity else { return }
        builtIdentity = widget.id
        draft = WidgetSettingsProjection.buildDraft(from: widget)
    }

    /// Recomputes the resolved body phase + inline-error envelope from the current widget + status.
    private func recompute() {
        let hasWidget = widget != nil
        phase = WidgetSettingsProjection.phase(status: loadStatus, hasWidget: hasWidget)
        inlineErrorMessage = WidgetSettingsProjection.inlineFailure(status: loadStatus, hasWidget: hasWidget)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached vehicle list on screen
    /// and does not refetch.
    private func handleAutoRefresh(for connection: WidgetSettingsConnection) {
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

    /// Bridges the two-argument `localize` closure to the four-argument token-substituting form the
    /// accessibility + vehicle-label builders expect.
    private func interpolating(_ key: String, _ fallback: String, _ token: String, _ value: String) -> String {
        localize(key, fallback).replacingOccurrences(of: token, with: value)
    }
}
