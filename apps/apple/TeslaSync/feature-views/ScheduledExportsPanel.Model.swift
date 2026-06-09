//
//  ScheduledExportsPanel.Model.swift
//  TeslaSync — P4 feature view · 0262 · ScheduledExportsPanel (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `ScheduledExportsPanel` owns
//  the list query (`useScheduledExports`) plus four mutations (create / update / delete /
//  run-now) and the inline-form + delete-dialog local UI state. The native surface
//  reproduces that whole lifecycle here: a `ScheduledExportsSource` pushes the resolved
//  rows + load / freshness status, and the model owns the form (new vs edit), the delete
//  confirm, and the per-row in-flight flags, exposing the resolved `ScheduledExportsPhase`
//  for SwiftUI to switch over. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `ScheduledExportsSource`, holds
/// the latest rows + freshness, exposes the resolved render phase, owns the inline-form +
/// delete-confirm + per-row in-flight state, drives the CRUD mutator seam, and emits the
/// P1/S11 `view.opened` event once on first appearance.
@MainActor
@Observable
public final class ScheduledExportsModel {
    // Load + freshness (from the source)
    public private(set) var phase: ScheduledExportsPhase = .loading
    public private(set) var connection: ScheduledExportsConnection = .live
    public private(set) var items: [ScheduledExportItem] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The list-query failure message kept while cached rows remain on screen, so the
    /// content branch can surface the inline error above the table.
    public private(set) var loadFailure: String?

    // Inline-form state (web `showForm` / `editingId` / `form`)
    public private(set) var showForm = false
    public private(set) var editingID: Int?
    /// The editable form-state. Settable so the SwiftUI form binds field-by-field through
    /// `@Bindable` (`$model.form.name` …); seeded via `startCreate` / `startEdit`.
    public var form: ScheduledExportFormState = .empty()
    public private(set) var isSaving = false

    // Per-row in-flight + delete-confirm (web mutation `isPending` + `pendingDelete`)
    public private(set) var pendingDelete: ScheduledExportItem?
    public private(set) var runningID: Int?
    public private(set) var togglingID: Int?

    @ObservationIgnored private let source: any ScheduledExportsSource
    @ObservationIgnored private let telemetry: any ScheduledExportsTelemetry
    @ObservationIgnored private let mutator: any ScheduledExportsMutator
    @ObservationIgnored let dates: any ScheduledExportsDateFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ScheduledExportsSource,
        telemetry: any ScheduledExportsTelemetry = OSLogScheduledExportsTelemetry(),
        mutator: any ScheduledExportsMutator = OSLogScheduledExportsMutator(),
        dates: any ScheduledExportsDateFormatting = DefaultScheduledExportsDateFormatting(),
        localize: @escaping (String, String) -> String = ScheduledExportsStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.mutator = mutator
        self.dates = dates
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (inline error, in-flight predicates, a11y)

    /// The inline list-error message shown above the populated table, present only when
    /// rows are on screen despite a failed reload (web keeps the cached table visible).
    public var inlineErrorMessage: String? {
        guard case .content = phase else { return nil }
        return loadFailure
    }

    /// Whether a specific row's run-now is in flight (web `runNow.isPending &&
    /// runNow.variables === row.id`).
    public func isRunning(_ id: Int) -> Bool {
        runningID == id
    }

    /// Whether a specific row's enable/disable toggle is in flight.
    public func isToggling(_ id: Int) -> Bool {
        togglingID == id
    }

    /// The "Save schedule" button's busy state (web `create.isPending || update.isPending`).
    public var isFormBusy: Bool {
        isSaving
    }

    /// The VoiceOver summary for the section.
    public var accessibilitySummary: String {
        ScheduledExportsAccessibility.sectionSummary(count: items.count, localize: localize)
    }

    /// One row's VoiceOver label.
    public func rowAccessibilityLabel(_ item: ScheduledExportItem) -> String {
        ScheduledExportsAccessibility.rowLabel(item, dates: dates, localize: localize)
    }

    /// The "Next run" / "Last run" timestamp formatter the rows render with.
    public func formatTimestamp(_ date: Date) -> String {
        dates.dateTime(date)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ScheduledExportsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream schedules feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry + header refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Inline form (web `startCreate` / `startEdit` / `closeForm`)

    /// Opens the form seeded with the empty input for a new schedule (web `startCreate`).
    public func startCreate() {
        form = .empty()
        editingID = nil
        showForm = true
    }

    /// Opens the form seeded from an existing row for editing (web `startEdit`).
    public func startEdit(_ item: ScheduledExportItem) {
        form = .from(item)
        editingID = item.id
        showForm = true
    }

    /// Dismisses the form and resets it (web `closeForm`).
    public func closeForm() {
        showForm = false
        editingID = nil
        form = .empty()
    }

    /// Submits the form: awaits the create/update seam and, on success, closes the form +
    /// refreshes the list (web `submit` → `mutateAsync` → `closeForm`). A failure keeps the
    /// form open (the mutation hook surfaces the toast upstream).
    public func submit() async {
        guard form.isSubmittable, !isSaving else { return }
        isSaving = true
        let succeeded = await mutator.save(form: form, editingID: editingID)
        isSaving = false
        if succeeded {
            closeForm()
            source.refresh()
        }
    }

    // MARK: Per-row actions (web run-now / toggle / delete)

    /// Toggles a schedule's enabled flag (web `toggleEnabled`). Refreshes on success.
    public func toggleEnabled(_ item: ScheduledExportItem) async {
        guard togglingID == nil else { return }
        togglingID = item.id
        let succeeded = await mutator.setEnabled(item: item, enabled: !item.enabled)
        togglingID = nil
        if succeeded { source.refresh() }
    }

    /// Manually triggers a schedule's next run (web `runNow.mutate(row.id)`). Refreshes on
    /// success.
    public func runNow(_ item: ScheduledExportItem) async {
        guard runningID == nil else { return }
        runningID = item.id
        let succeeded = await mutator.runNow(id: item.id)
        runningID = nil
        if succeeded { source.refresh() }
    }

    // MARK: Delete (web `pendingDelete` + `ConfirmDialog`)

    /// Opens the delete confirm for a row (web `setPendingDelete(row)`).
    public func requestDelete(_ item: ScheduledExportItem) {
        pendingDelete = item
    }

    /// Dismisses the delete confirm without acting (web `onCancel`).
    public func cancelDelete() {
        pendingDelete = nil
    }

    /// Confirms the delete: clears the dialog, awaits the seam, and refreshes the list on
    /// success (web `onConfirm` → `remove.mutate(id)` then `setPendingDelete(null)`).
    public func confirmDelete() async {
        guard let target = pendingDelete else { return }
        pendingDelete = nil
        let succeeded = await mutator.delete(id: target.id)
        if succeeded { source.refresh() }
    }

    // MARK: Snapshot application

    private func apply(_ update: ScheduledExportsUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        items = update.items
        loadFailure = Self.failureMessage(update.status)
        phase = ScheduledExportsProjection.resolvePhase(status: update.status, rowCount: items.count)
        pruneInFlight()
        handleAutoRefresh(for: update.connection)
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: ScheduledExportsLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Drops a pending delete / in-flight id whose row vanished after a refresh.
    private func pruneInFlight() {
        let present = Set(items.map(\.id))
        if let pendingDelete, !present.contains(pendingDelete.id) {
            self.pendingDelete = nil
        }
        if let runningID, !present.contains(runningID) {
            self.runningID = nil
        }
        if let togglingID, !present.contains(togglingID) {
            self.togglingID = nil
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// rows on screen and does not refetch.
    private func handleAutoRefresh(for connection: ScheduledExportsConnection) {
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
