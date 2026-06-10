//
//  DashboardSettingsModal.Model.swift
//  TeslaSync — P4 modal / dialog · 0022 · DashboardSettingsModal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `DashboardSettingsModal` owns the
//  editable name / icon / settings in local state, resets them when the modal opens or the target
//  dashboard changes (`useEffect`), derives the vehicle-scope option list via `vehicleOptions`, and on
//  Save projects the draft into the rename / icon / update deltas (`handleSave`). The native surface
//  reproduces that whole lifecycle here: a `DashboardSettingsSource` pushes the edited dashboard + the
//  fleet vehicle list + freshness, and the model owns the draft (rebuilt only when the edited
//  dashboard's identity changes, so a freshness flip preserves edits), the resolved phase, every
//  field mutator, the save / cancel seams, and the stale auto-refresh — emitting the P1/S11
//  `view.opened` event once on first appearance. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `DashboardSettingsSource`, holds the editable
/// draft (name / icon / scope / cadence / display switches), exposes the resolved phase + the vehicle
/// list, and drives the per-field mutators plus the save / cancel seams.
@MainActor
@Observable
public final class DashboardSettingsModel {
    // Load + freshness (from the source)
    public private(set) var loadStatus: DashboardSettingsLoadStatus = .loading
    public private(set) var connection: DashboardSettingsConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Resolved render state
    public private(set) var phase: DashboardSettingsPhase = .loading
    public private(set) var inlineErrorMessage: String?

    // Edited dashboard + fleet vehicle list (from the source)
    public private(set) var dashboard: DashboardDescriptor?
    public private(set) var vehicles: [DashboardVehicleOption] = []

    /// The editable draft (web local name / icon / settings state); rebuilt only when the edited
    /// dashboard's identity changes so a freshness flip preserves edits.
    public private(set) var draft = DashboardSettingsDraft.blank

    @ObservationIgnored private let source: any DashboardSettingsSource
    @ObservationIgnored private let telemetry: any DashboardSettingsTelemetry
    @ObservationIgnored private let actions: any DashboardSettingsActions
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var builtIdentity: String?
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any DashboardSettingsSource,
        telemetry: any DashboardSettingsTelemetry = OSLogDashboardSettingsTelemetry(),
        actions: any DashboardSettingsActions = OSLogDashboardSettingsActions(),
        localize: @escaping (String, String) -> String = DashboardSettingsStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.actions = actions
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived

    /// The icon-picker glyphs (web `DASHBOARD_EMOJIS`).
    public var icons: [String] {
        DashboardIconCatalog.icons
    }

    /// The auto-refresh cadence options (web `REFRESH_OPTIONS`).
    public var refreshOptions: [DashboardRefreshOption] {
        DashboardRefreshCatalog.options
    }

    /// Whether the draft differs from the loaded dashboard (exposed for the a11y hint + tests; the
    /// Save button stays enabled to mirror the web).
    public var isDirty: Bool {
        guard let dashboard else { return false }
        return DashboardSettingsProjection.isDirty(draft: draft, original: dashboard)
    }

    /// The dialog container's VoiceOver label.
    public var accessibilityLabel: String {
        DashboardSettingsAccessibility.dialogLabel(localize: localize)
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
        telemetry.viewOpened(surface: DashboardSettingsSurface.slug)
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

    // MARK: Field mutators (web local `setState`)

    /// Updates the dashboard name (web `setName`).
    public func setName(_ name: String) {
        draft.name = name
    }

    /// Updates the dashboard icon (web `setIcon`).
    public func setIcon(_ icon: String) {
        draft.icon = icon
    }

    /// Whether an icon swatch is the chosen one (web `selected === emoji`).
    public func isIconSelected(_ icon: String) -> Bool {
        draft.icon == icon
    }

    /// Updates the vehicle scope (web `setSettings(s => ({ ...s, vehicleId }))`); `nil` = all vehicles.
    public func setVehicleID(_ vehicleID: Int?) {
        draft.vehicleID = vehicleID
    }

    /// Updates the auto-refresh cadence (web `setSettings(s => ({ ...s, refreshInterval }))`).
    public func setRefreshInterval(_ interval: Int) {
        draft.refreshInterval = interval
    }

    /// Toggles the widget-borders switch (web `setSettings(s => ({ ...s, showWidgetBorders }))`).
    public func setShowWidgetBorders(_ value: Bool) {
        draft.showWidgetBorders = value
    }

    /// Toggles the compact-mode switch (web `setSettings(s => ({ ...s, compactMode }))`).
    public func setCompactMode(_ value: Bool) {
        draft.compactMode = value
    }

    // MARK: Commands (web `handleSave` / `onClose`)

    /// Commits the draft (web `handleSave`: the rename / icon / update deltas), then leaves dismissal
    /// to the view. A no-op when no dashboard is resolved.
    public func save() {
        guard let dashboard else { return }
        let change = DashboardSettingsProjection.commit(draft: draft, original: dashboard)
        actions.commit(change)
    }

    /// Cancels without committing (web `onClose()`).
    public func cancel() {
        actions.cancel()
    }

    // MARK: Display projection

    /// The localized label for an auto-refresh option (web `t('dashSettings.refresh' + value, label)`).
    public func refreshLabel(_ option: DashboardRefreshOption) -> String {
        localize(option.labelKey, option.labelFallback)
    }

    /// One icon swatch's VoiceOver label.
    public func iconAccessibilityLabel(_ icon: String) -> String {
        DashboardSettingsAccessibility.iconLabel(icon: icon, selected: isIconSelected(icon), localize: localize)
    }

    // MARK: Snapshot application

    private func apply(_ update: DashboardSettingsUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        dashboard = update.dashboard
        vehicles = update.vehicles
        rebuildDraftIfNeeded(for: update)
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Rebuilds the editable draft only when the edited dashboard's identity changes (web `useEffect`
    /// reset keyed on `dashboard.id`), so a pure freshness flip preserves the operator's edits.
    private func rebuildDraftIfNeeded(for update: DashboardSettingsUpdate) {
        guard let dashboard = update.dashboard else { return }
        guard dashboard.id != builtIdentity else { return }
        builtIdentity = dashboard.id
        draft = DashboardSettingsProjection.buildDraft(from: dashboard)
    }

    /// Recomputes the resolved body phase + inline-error envelope from the current dashboard + status.
    private func recompute() {
        let hasDashboard = dashboard != nil
        phase = DashboardSettingsProjection.phase(status: loadStatus, hasDashboard: hasDashboard)
        inlineErrorMessage = DashboardSettingsProjection.inlineFailure(status: loadStatus, hasDashboard: hasDashboard)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached vehicle list on screen
    /// and does not refetch.
    private func handleAutoRefresh(for connection: DashboardSettingsConnection) {
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
