import Foundation
import Observation

// MARK: - Page model

/// The `@Observable` state holder the Command Center binds to (ADR-004 — no networking in the
/// view). Owns the Tesla connection status (web `useAuthStatus`), the synced garage
/// (`useVehicles`) and the in-flight sync (`useSyncVehicles`), plus the customizable widget
/// layout with its edit mode + undo/redo history, the kiosk presentation flag, and the soft
/// banner dismissal state. The view reads everything from here and always renders a populated
/// surface — the onboarding empty when the garage is empty, otherwise the widget dashboard —
/// never a blank region.
@MainActor
@Observable
public final class DashboardPageModel {
    public private(set) var phase: DashboardPhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var auth: DashboardAuthStatus?
    public private(set) var vehicles: [DashboardVehicle] = []

    /// Web `syncVehicles.isPending` — the sync button shows a spinner while true.
    public private(set) var isSyncing = false

    /// When the displayed data was last refreshed — drives the freshness chip (web query
    /// `dataUpdatedAt`).
    public private(set) var updatedAt: Date?

    // MARK: Customization (web `useDashboardLayout`)

    /// The current widget order (web `activeDashboard.widgets`). Seeded with the default
    /// layout; edits push undo history.
    public private(set) var layout: [DashboardWidget] = DashboardWidget.seeded

    /// Web `editMode` — toggles the customize chrome (undo/redo, add, auto-arrange, reset).
    public private(set) var editMode = false

    /// Web `isKiosk` — full-screen presentation of the dashboard.
    public private(set) var isKiosk = false

    private var undoStack: [[DashboardWidget]] = []
    private var redoStack: [[DashboardWidget]] = []

    // MARK: Soft banners

    /// Web `ThemeFirstRunBanner` dismissal (localStorage `themeFirstRunDismissed`).
    public private(set) var themeBannerDismissed = false

    /// Web first-run gate: only nag users still on the default theme (`themeId === 'neon-cyan'`).
    @ObservationIgnored private let themeIsDefault: Bool

    /// Web customize-hint dismissal (localStorage `customizeHintDismissed`).
    public private(set) var customizeHintDismissed = false

    /// Web `hintReady` — flipped by the 5s discovery timer the view owns.
    public private(set) var customizeHintReady = false

    @ObservationIgnored private let dataSource: any DashboardDataSource

    public init(
        dataSource: any DashboardDataSource = SampleDashboardDataSource(),
        themeIsDefault: Bool = true
    ) {
        self.dataSource = dataSource
        self.themeIsDefault = themeIsDefault
    }

    // MARK: Derivations (web inline)

    /// Web `auth && !auth.authenticated` — the "Tesla account not connected" warning.
    public var showsAuthWarning: Bool {
        guard let auth else { return false }
        return !auth.authenticated
    }

    /// Web `authenticated` flag passed to `EmptyOnboarding`.
    public var isAuthenticated: Bool {
        auth?.authenticated ?? false
    }

    /// Web `vehicles && vehicles.length > 0 ? grid : EmptyOnboarding`.
    public var showsOnboarding: Bool {
        vehicles.isEmpty
    }

    /// Web `isOnlyDefault` — the user is still on the seeded default layout (gates the hint).
    public var isOnlyDefaultLayout: Bool {
        layout == DashboardWidget.seeded
    }

    /// Web `hintReady && !editMode` plus the "still default + not dismissed" gate.
    public var showsCustomizeHint: Bool {
        customizeHintReady
            && !customizeHintDismissed
            && !editMode
            && !showsOnboarding
            && isOnlyDefaultLayout
    }

    /// Web `ThemeFirstRunBanner` visibility (default theme + not dismissed).
    public var showsThemeBanner: Bool {
        themeIsDefault && !themeBannerDismissed
    }

    public var canUndo: Bool { !undoStack.isEmpty }
    public var canRedo: Bool { !redoStack.isEmpty }
    public var undoCount: Int { undoStack.count }

    /// Whether the displayed values are older than the freshness window (ADR-013).
    public var isStale: Bool {
        guard let updatedAt else { return false }
        return Date().timeIntervalSince(updatedAt) > 120
    }

    // MARK: Loading

    /// Loads the connection status + garage. A vehicle-list failure is the only one that
    /// surfaces the retryable error region (web `error.loadFailed`); the auth query degrades to
    /// `nil` so the page still renders.
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetchAll()
        isRefreshing = false
    }

    private func fetchAll() async {
        // The web `useAuthStatus` query fails soft (the page renders without the banner), so a
        // throw here degrades to `nil`, never the error region.
        auth = try? await dataSource.loadAuthStatus()
        do {
            vehicles = try await dataSource.loadVehicles()
        } catch {
            phase = .error
            return
        }
        updatedAt = Date()
        phase = .ready
    }

    // MARK: Sync (web `syncVehicles.mutate`)

    /// Syncs the garage from Tesla (web `useSyncVehicles`), then shows the refreshed list. No-ops
    /// while a sync is already in flight (web `disabled={syncVehicles.isPending}`).
    public func sync() async {
        guard !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            vehicles = try await dataSource.syncVehicles()
            updatedAt = Date()
        } catch {
            // Web surfaces a toast and leaves the page intact; the action simply ends.
        }
    }

    // MARK: Edit mode + customization (web `useDashboardLayout`)

    public func setEditMode(_ value: Bool) {
        editMode = value
    }

    public func toggleEditMode() {
        editMode.toggle()
    }

    /// Web `addWidgets([id])` — appends a widget not already present and records history.
    public func addWidget(_ widget: DashboardWidget) {
        guard !layout.contains(widget) else { return }
        pushHistory()
        layout.append(widget)
        dismissCustomizeHint()
    }

    /// Web `removeWidget(id)`.
    public func removeWidget(_ widget: DashboardWidget) {
        guard layout.contains(widget) else { return }
        pushHistory()
        layout.removeAll { $0 == widget }
    }

    /// Web `autoArrange()` — restores the seeded order for the currently-present widgets.
    public func autoArrange() {
        let arranged = DashboardWidget.seeded.filter { layout.contains($0) }
        guard arranged != layout else { return }
        pushHistory()
        layout = arranged
    }

    /// Web `resetToDefault()` — restores the shipped default dashboard.
    public func resetToDefault() {
        guard layout != DashboardWidget.seeded else { return }
        pushHistory()
        layout = DashboardWidget.seeded
    }

    /// Web blank template (`createDashboard` for the `__blank__` preset) — starts a fresh,
    /// empty dashboard the user builds up with `addWidget`. Distinct from `resetToDefault`,
    /// which restores the seeded widgets. Undoable.
    public func newBlankDashboard() {
        guard !layout.isEmpty else { return }
        pushHistory()
        layout = []
    }

    /// Web `WidgetPicker` source — the seeded widgets not already on the dashboard.
    public var addableWidgets: [DashboardWidget] {
        DashboardWidget.allCases.filter { !layout.contains($0) }
    }

    /// Web `undo()`.
    public func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(layout)
        layout = previous
    }

    /// Web `redo()`.
    public func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(layout)
        layout = next
    }

    private func pushHistory() {
        undoStack.append(layout)
        redoStack.removeAll()
    }

    // MARK: Kiosk (web `useKioskMode`)

    public func enterKiosk() {
        isKiosk = true
    }

    public func exitKiosk() {
        isKiosk = false
    }

    // MARK: Banners

    public func dismissThemeBanner() {
        themeBannerDismissed = true
    }

    public func markCustomizeHintReady() {
        customizeHintReady = true
    }

    public func dismissCustomizeHint() {
        customizeHintDismissed = true
        customizeHintReady = false
    }
}
