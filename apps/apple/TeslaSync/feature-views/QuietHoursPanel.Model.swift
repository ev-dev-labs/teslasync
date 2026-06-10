//
//  QuietHoursPanel.Model.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `QuietHoursPanel` owns the
//  list query (`useQuietHours`), the save + delete mutations (`useSaveQuietHours` /
//  `useDeleteQuietHours`), the `useToast` calls, and the local form/edit/validation
//  state. The native surface reproduces that whole lifecycle here: a `QuietHoursSource`
//  pushes the resolved rows + load / freshness status, a `QuietHoursWriter` performs the
//  mutations, and the model owns the draft form, the validation error, the per-row in-
//  flight flags, and the transient toast — exposing the resolved `QuietHoursPhase` for
//  SwiftUI to switch over. The draft CRUD lives in QuietHoursPanel.Editing.swift for the
//  lint length budget. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `QuietHoursSource`, holds the
/// latest rows + freshness, the open draft + validation error + per-action in-flight
/// flags, and the transient toast; exposes the resolved render phase; drives the write
/// seam; and emits the P1/S11 `view.opened` event once on first appearance.
@MainActor
@Observable
public final class QuietHoursModel {
    // Load + freshness (from the source)
    public private(set) var phase: QuietHoursPhase = .loading
    public private(set) var items: [QuietHoursWindowItem] = []
    public private(set) var connection: QuietHoursConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The list-query failure message kept while cached rows remain on screen, so the
    /// content branch can surface an inline error above the list.
    public private(set) var loadFailure: String?

    // Draft form + validation + in-flight (web local UI state + mutation `isPending`)
    public internal(set) var draft: QuietHoursDraft?
    public internal(set) var validationError: String?
    public internal(set) var isSaving = false
    public internal(set) var deletingID: Int?

    /// The transient toast raised after a save/delete (web `useToast`).
    public private(set) var toast: QuietHoursToast?

    @ObservationIgnored let source: any QuietHoursSource
    @ObservationIgnored let writer: any QuietHoursWriter
    @ObservationIgnored let telemetry: any QuietHoursTelemetry
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored let defaultTimezone: () -> String
    @ObservationIgnored let nowProvider: () -> Date
    @ObservationIgnored let calendar: Calendar
    @ObservationIgnored private(set) var lastStatus: QuietHoursLoadStatus = .loading
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored var toastDismissTask: Task<Void, Never>?

    public init(
        source: any QuietHoursSource,
        writer: any QuietHoursWriter = OSLogQuietHoursWriter(),
        telemetry: any QuietHoursTelemetry = OSLogQuietHoursTelemetry(),
        localize: @escaping (String, String) -> String = QuietHoursStrings.string,
        defaultTimezone: @escaping () -> String = { TimeZone.current.identifier },
        nowProvider: @escaping () -> Date = { Date() },
        calendar: Calendar = .current
    ) {
        self.source = source
        self.writer = writer
        self.telemetry = telemetry
        self.localize = localize
        self.defaultTimezone = defaultTimezone
        self.nowProvider = nowProvider
        self.calendar = calendar
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (inline error, editing, a11y)

    /// Whether the add/edit form is open (web `draft !== null`).
    public var hasDraft: Bool {
        draft != nil
    }

    /// The id of the row being edited, or nil when creating / closed (web `editingId`).
    public var editingID: Int? {
        draft?.id
    }

    /// Whether the open draft is an edit (web `editingId !== null`).
    public var isEditing: Bool {
        (draft?.id ?? 0) > 0
    }

    /// The inline list-error shown above the populated list (a native envelope), present
    /// only when rows are on screen despite a failed reload.
    public var inlineErrorMessage: String? {
        guard case .content = phase else { return nil }
        return loadFailure
    }

    /// Whether a specific row's delete is in flight (web `remove.isPending`).
    public func isDeleting(_ id: Int) -> Bool {
        deletingID == id
    }

    /// The VoiceOver summary for the panel header.
    public var accessibilitySummary: String {
        QuietHoursAccessibility.panelSummary(count: items.count, localize: localize)
    }

    /// One row's "next state change" label (web `nextWindowChangeLabel(w, now)`).
    public func nextChangeLabel(for item: QuietHoursWindowItem) -> String? {
        QuietHoursSchedule.nextChangeLabel(
            for: item,
            now: nowProvider(),
            calendar: calendar,
            localize: localize
        )
    }

    /// One bypass token's display label (web row renders the raw `s`, mapped here).
    public func severityLabel(forToken token: String) -> String {
        QuietHoursSeverity.label(forToken: token, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: QuietHoursSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed and tears down the toast timer.
    public func stop() {
        started = false
        toastDismissTask?.cancel()
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry + post-write
    /// invalidation + stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Toast (web `useToast`)

    /// Raises a toast and schedules its auto-dismiss (web toast lifetime).
    func raiseToast(_ toast: QuietHoursToast) {
        self.toast = toast
        toastDismissTask?.cancel()
        toastDismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    /// Clears the active toast (auto-dismiss + manual close).
    public func dismissToast() {
        toastDismissTask?.cancel()
        toast = nil
    }

    // MARK: Phase recomputation (shared by snapshot + draft open/close)

    /// Recomputes the render phase from the last status, the row count, and whether a
    /// draft form is open (web renders the list + form together).
    func recomputePhase() {
        phase = QuietHoursProjection.resolvePhase(
            status: lastStatus,
            windowCount: items.count,
            hasDraft: draft != nil
        )
    }

    // MARK: Snapshot application

    private func apply(_ update: QuietHoursUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        items = update.items
        lastStatus = update.status
        loadFailure = Self.failureMessage(update.status)
        recomputePhase()
        pruneDeletingTarget()
        handleAutoRefresh(for: update.connection)
    }

    /// The failure message carried by a failed status, else nil.
    private static func failureMessage(_ status: QuietHoursLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Drops a pending delete spinner if its row vanished after a refresh.
    private func pruneDeletingTarget() {
        guard let deletingID, !items.contains(where: { $0.id == deletingID }) else { return }
        self.deletingID = nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// rows on screen and does not refetch.
    private func handleAutoRefresh(for connection: QuietHoursConnection) {
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
