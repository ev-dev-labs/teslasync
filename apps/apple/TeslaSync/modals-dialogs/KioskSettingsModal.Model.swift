//
//  KioskSettingsModal.Model.swift
//  TeslaSync — P4 modal / dialog · 0025 · KioskSettingsModal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `KioskSettingsModal` is a controlled
//  form: it receives the persisted `config` + the saved-dashboard list, keeps the rotation selection
//  in local state, mutates the config through `onUpdateConfig` (which persists to localStorage on
//  every change), and on enter commits the selection then fires `onEnterKiosk`. The native surface
//  reproduces that whole lifecycle here: a `KioskSettingsSource` pushes the dashboards + persisted
//  config + freshness, and the model owns the editable config draft (seeded once, so a freshness flip
//  preserves edits), the rotation selection (re-sanitized when the dashboard set changes), the
//  resolved phase, every mutator (each persisting through the action seam), the enter / cancel seams,
//  the stale auto-refresh, and the conditional-reveal + preview + slider projections — emitting the
//  P1/S11 `view.opened` event once on first appearance. No persistence or networking in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `KioskSettingsSource`, holds the editable
/// config draft + the rotation selection, exposes the resolved phase, the four conditional reveals,
/// the live-preview values, the slider percents, and drives the per-field mutators plus the enter /
/// cancel seams.
@MainActor
@Observable
public final class KioskSettingsModel {
    // Load + freshness (from the source)
    public private(set) var loadStatus: KioskLoadStatus = .loading
    public private(set) var connection: KioskConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Resolved render state
    public private(set) var phase: KioskPhase = .loading
    public private(set) var inlineErrorMessage: String?

    // Editable draft + the saved-dashboard list
    public private(set) var config = KioskConfig.default
    public private(set) var dashboards: [KioskDashboard] = []
    public private(set) var selectedDashboardIds: Set<String> = []

    @ObservationIgnored private let source: any KioskSettingsSource
    @ObservationIgnored private let telemetry: any KioskSettingsTelemetry
    @ObservationIgnored private let actions: any KioskSettingsActions
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var configSeeded = false
    @ObservationIgnored private var dashboardSignature: [String] = []
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any KioskSettingsSource,
        telemetry: any KioskSettingsTelemetry = OSLogKioskSettingsTelemetry(),
        actions: any KioskSettingsActions = OSLogKioskSettingsActions(),
        localize: @escaping (String, String) -> String = KioskSettingsStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.actions = actions
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived — conditional reveals (web `&&` branches)

    /// Whether the "Dashboards to Rotate" checklist shows.
    public var showsRotationList: Bool {
        KioskSettingsProjection.showsRotationList(
            rotateInterval: config.rotateInterval, dashboardCount: dashboards.count
        )
    }

    /// Whether the cursor "Hide After" picker shows.
    public var showsCursorTimeout: Bool {
        KioskSettingsProjection.showsCursorTimeout(hideCursor: config.hideCursor)
    }

    /// Whether the "Dimmed Brightness" slider shows.
    public var showsDimBrightness: Bool {
        KioskSettingsProjection.showsDimBrightness(dimAfter: config.dimAfter)
    }

    /// Whether the "Clock Position" picker shows.
    public var showsClockPosition: Bool {
        KioskSettingsProjection.showsClockPosition(showClock: config.showClock)
    }

    // MARK: Derived — live preview swatch

    /// The preview background opacity (web swatch `backgroundColor` alpha).
    public var previewBackgroundOpacity: Double {
        KioskSettingsProjection.backgroundSwatchOpacity(config.backgroundOpacity)
    }

    /// The preview widget-panel opacity (web inner-swatch `backgroundColor` alpha).
    public var previewWidgetOpacity: Double {
        KioskSettingsProjection.widgetSwatchOpacity(config.widgetOpacity)
    }

    /// The preview widget-panel blur radius in points (web inner-swatch `backdropFilter`).
    public var previewWidgetBlur: Double {
        KioskSettingsProjection.widgetSwatchBlur(config.widgetOpacity)
    }

    // MARK: Derived — slider percents (web `Math.round(x * 100)`)

    /// The dimmed-brightness slider value as an integer percent.
    public var brightnessPercent: Int {
        KioskSettingsProjection.percent(fromFraction: config.dimLevel)
    }

    /// The widget-opacity slider value as an integer percent.
    public var widgetOpacityPercent: Int {
        KioskSettingsProjection.percent(fromFraction: config.widgetOpacity)
    }

    /// The background-opacity slider value as an integer percent.
    public var backgroundOpacityPercent: Int {
        KioskSettingsProjection.percent(fromFraction: config.backgroundOpacity)
    }

    /// Whether a dashboard is in the rotation selection (web `selectedIds.has(id)`).
    public func isDashboardSelected(_ id: String) -> Bool {
        selectedDashboardIds.contains(id)
    }

    /// The dialog container's VoiceOver label.
    public var accessibilityLabel: String {
        KioskSettingsAccessibility.dialogLabel(localize: localize)
    }

    /// One rotation-dashboard row's VoiceOver label.
    public func dashboardAccessibilityLabel(_ dashboard: KioskDashboard) -> String {
        KioskSettingsAccessibility.dashboardRowLabel(
            name: dashboard.name,
            selected: isDashboardSelected(dashboard.id),
            isDefault: dashboard.isDefault,
            localize: localize
        )
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: KioskSettingsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the dashboards / config query (the error-state retry / the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    // MARK: Mutators (web `onUpdateConfig` updaters — each persists)

    /// Sets the dashboard-rotation cadence (web rotation-interval `<Select>`).
    public func setRotateInterval(_ seconds: Int) {
        update { $0.rotateInterval = seconds }
    }

    /// Toggles a dashboard in the rotation, keeping at least one selected (web `toggleDashboard`),
    /// then syncs `dashboardIds` and persists.
    public func toggleDashboard(_ id: String) {
        selectedDashboardIds = KioskSettingsProjection.toggling(selectedDashboardIds, id: id)
        update { $0.dashboardIds = KioskSettingsProjection.orderedIds(selectedDashboardIds, dashboards: dashboards) }
    }

    /// Enables / disables cursor auto-hide (web `hideCursor` toggle).
    public func setHideCursor(_ enabled: Bool) {
        update { $0.hideCursor = enabled }
    }

    /// Sets the cursor idle-hide timeout (web cursor-timeout `<Select>`).
    public func setCursorTimeout(_ seconds: Int) {
        update { $0.cursorTimeout = seconds }
    }

    /// Sets the screen-dim delay (web dim-after `<Select>`).
    public func setDimAfter(_ minutes: Int) {
        update { $0.dimAfter = minutes }
    }

    /// Sets the dimmed-screen brightness from a slider percent (web `dimLevel = n / 100`).
    public func setDimBrightnessPercent(_ percent: Int) {
        let clamped = KioskSettingsProjection.clampedPercent(percent, in: KioskCatalog.brightnessBounds)
        update { $0.dimLevel = KioskSettingsProjection.fraction(fromPercent: clamped) }
    }

    /// Shows / hides the clock overlay (web `showClock` toggle).
    public func setShowClock(_ enabled: Bool) {
        update { $0.showClock = enabled }
    }

    /// Sets the clock-overlay corner (web clock-position `<Select>`).
    public func setClockPosition(_ position: KioskClockPosition) {
        update { $0.clockPosition = position }
    }

    /// Sets the widget-panel opacity from a slider percent (web `widgetOpacity = n / 100`).
    public func setWidgetOpacityPercent(_ percent: Int) {
        let clamped = KioskSettingsProjection.clampedPercent(percent, in: KioskCatalog.widgetOpacityBounds)
        update { $0.widgetOpacity = KioskSettingsProjection.fraction(fromPercent: clamped) }
    }

    /// Sets the page-background opacity from a slider percent (web `backgroundOpacity = n / 100`).
    public func setBackgroundOpacityPercent(_ percent: Int) {
        let clamped = KioskSettingsProjection.clampedPercent(percent, in: KioskCatalog.backgroundOpacityBounds)
        update { $0.backgroundOpacity = KioskSettingsProjection.fraction(fromPercent: clamped) }
    }

    // MARK: Commands (web `handleEnter` / `onClose`)

    /// Commits the rotation selection and enters kiosk mode (web `handleEnter`:
    /// `onUpdateConfig({ dashboardIds }) → onClose() → onEnterKiosk()`). The view owns the dismissal.
    public func enter() {
        let payload = KioskSettingsProjection.enterPayload(
            config: config, selection: selectedDashboardIds, dashboards: dashboards
        )
        config = payload
        actions.persist(payload)
        actions.enterKiosk(payload)
    }

    /// Cancels without entering (web `onClose`).
    public func cancel() {
        actions.cancel()
    }

    // MARK: Snapshot application

    private func apply(_ update: KioskSettingsUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        dashboards = update.dashboards
        seedDraftIfNeeded(for: update)
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Seeds the config + selection once from the first resolved (non-loading) snapshot — the web
    /// `useState` initializers run once per mount — so later freshness flips preserve the operator's
    /// edits. After seeding, a change to the dashboard set re-sanitizes the selection (dropping ids
    /// that vanished) and re-syncs `dashboardIds`, without clobbering the rest of the config draft.
    private func seedDraftIfNeeded(for update: KioskSettingsUpdate) {
        if !configSeeded, update.status != .loading {
            config = update.config
            selectedDashboardIds = KioskSettingsProjection.initialSelection(
                config: update.config, dashboards: update.dashboards
            )
            dashboardSignature = update.dashboardSignature
            configSeeded = true
            return
        }
        guard configSeeded else { return }
        let signature = update.dashboardSignature
        guard signature != dashboardSignature else { return }
        dashboardSignature = signature
        selectedDashboardIds = KioskSettingsProjection.sanitizedSelection(
            selectedDashboardIds, dashboards: update.dashboards
        )
        config.dashboardIds = KioskSettingsProjection.orderedIds(selectedDashboardIds, dashboards: update.dashboards)
    }

    /// Recomputes the resolved body phase + inline-error envelope from the dashboards + status.
    private func recompute() {
        let hasDashboards = !dashboards.isEmpty
        phase = KioskSettingsProjection.phase(status: loadStatus, hasDashboards: hasDashboards)
        inlineErrorMessage = KioskSettingsProjection.inlineFailure(status: loadStatus, hasDashboards: hasDashboards)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached snapshot on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: KioskConnection) {
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

    /// Applies a config edit then persists the whole draft (web `onUpdateConfig`, saved on change).
    private func update(_ mutate: (inout KioskConfig) -> Void) {
        mutate(&config)
        actions.persist(config)
    }
}
