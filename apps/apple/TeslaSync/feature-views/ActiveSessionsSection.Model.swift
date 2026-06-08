//
//  ActiveSessionsSection.Model.swift
//  TeslaSync — P4 feature view · 0197 · ActiveSessionsSection (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `ActiveSessionsSection`
//  owns the list query (`useSessions`) plus two destructive mutations
//  (`useRevokeSession`, `useRevokeAllOtherSessions`) and the two confirm-dialog bits.
//  The native surface reproduces that whole lifecycle here: an `ActiveSessionsSource`
//  pushes the resolved rows + auth mode + load / freshness status, and the model owns
//  the confirm-dialog + in-flight state, exposing the resolved `ActiveSessionsPhase`
//  for SwiftUI to switch over. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to an `ActiveSessionsSource`, holds
/// the latest rows + auth mode + freshness, exposes the resolved render phase + the
/// two confirm-dialog states + the per-action in-flight flags, drives the revoke seam,
/// and emits the P1/S11 `view.opened` event once on first appearance.
@MainActor
@Observable
public final class ActiveSessionsModel {
    // Load + freshness (from the source)
    public private(set) var phase: ActiveSessionsPhase = .loading
    public private(set) var mode: ActiveSessionsMode = .session
    public private(set) var connection: ActiveSessionsConnection = .live
    public private(set) var items: [ActiveSessionItem] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The list-query failure message kept while cached rows remain on screen, so the
    /// content branch can surface the web inline `ErrorText` above the table.
    public private(set) var loadFailure: String?

    // Confirm-dialog + in-flight state (web local UI state + mutation `isPending`)
    public private(set) var revokeTarget: ActiveSessionItem?
    public private(set) var showAllOthersConfirm = false
    public private(set) var revokingID: String?
    public private(set) var isRevokingAllOthers = false

    @ObservationIgnored private let source: any ActiveSessionsSource
    @ObservationIgnored private let telemetry: any ActiveSessionsTelemetry
    @ObservationIgnored private let revoker: any ActiveSessionsRevoker
    @ObservationIgnored let dates: any ActiveSessionsDateFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ActiveSessionsSource,
        telemetry: any ActiveSessionsTelemetry = OSLogActiveSessionsTelemetry(),
        revoker: any ActiveSessionsRevoker = OSLogActiveSessionsRevoker(),
        dates: any ActiveSessionsDateFormatting = DefaultActiveSessionsDateFormatting(),
        localize: @escaping (String, String) -> String = ActiveSessionsStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.revoker = revoker
        self.dates = dates
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (web `hasOthers`, inline error, a11y)

    /// Whether any session other than this device exists (web `hasOthers`).
    public var hasOtherDevices: Bool {
        ActiveSessionsProjection.hasOtherDevices(items)
    }

    /// The inline list-error message shown above the populated table (web inline
    /// `ErrorText`), present only when rows are on screen despite a failed reload.
    public var inlineErrorMessage: String? {
        guard case .content = phase else { return nil }
        return loadFailure
    }

    /// Whether a specific row's revoke is in flight (web `revokeMut.isPending &&
    /// revokeMut.variables === row.id`).
    public func isRevoking(_ id: String) -> Bool {
        revokingID == id
    }

    /// The VoiceOver summary for the section.
    public var accessibilitySummary: String {
        ActiveSessionsAccessibility.sectionSummary(count: items.count, localize: localize)
    }

    /// The "Signed in" / "Last seen" timestamp formatter the rows render with.
    public func formatTimestamp(_ date: Date) -> String {
        dates.dateTime(date)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ActiveSessionsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream sessions feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Per-row revoke (web `useRevokeSession` + per-row `ConfirmDialog`)

    /// Opens the per-row confirm (web `setRevokeTarget(row)`).
    public func requestRevoke(_ item: ActiveSessionItem) {
        revokeTarget = item
    }

    /// Dismisses the per-row confirm without acting (web "Keep signed in").
    public func cancelRevoke() {
        revokeTarget = nil
    }

    /// Confirms the per-row revoke: awaits the seam, clears the dialog + in-flight id
    /// on settle, and refreshes the list on success (web `onSettled` + invalidation).
    public func confirmRevoke() async {
        guard let target = revokeTarget else { return }
        revokingID = target.id
        let succeeded = await revoker.revoke(id: target.id)
        revokeTarget = nil
        revokingID = nil
        if succeeded { source.refresh() }
    }

    // MARK: Bulk revoke (web `useRevokeAllOtherSessions` + all-others `ConfirmDialog`)

    /// Opens the "Sign out all other devices" confirm (web `setShowAllOthersConfirm`).
    public func requestRevokeAllOthers() {
        showAllOthersConfirm = true
    }

    /// Dismisses the all-others confirm without acting (web "Cancel").
    public func cancelRevokeAllOthers() {
        showAllOthersConfirm = false
    }

    /// Confirms the all-others revoke: awaits the seam, clears the dialog + busy flag
    /// on settle, and refreshes the list when the seam reports success (count ≥ 0).
    public func confirmRevokeAllOthers() async {
        isRevokingAllOthers = true
        let revoked = await revoker.revokeAllOthers()
        showAllOthersConfirm = false
        isRevokingAllOthers = false
        if revoked >= 0 { source.refresh() }
    }

    // MARK: Snapshot application

    private func apply(_ update: ActiveSessionsUpdate) {
        mode = update.mode
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        items = update.items
        loadFailure = Self.failureMessage(update.status)
        phase = ActiveSessionsProjection.resolvePhase(
            status: update.status,
            mode: update.mode,
            sessionCount: items.count
        )
        pruneRevokeTarget()
        handleAutoRefresh(for: update.connection)
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: ActiveSessionsLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Drops a pending confirm / in-flight id if its row vanished after a refresh.
    private func pruneRevokeTarget() {
        let present = Set(items.map(\.id))
        if let target = revokeTarget, !present.contains(target.id) {
            revokeTarget = nil
        }
        if let revokingID, !present.contains(revokingID) {
            self.revokingID = nil
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached rows on screen and does not refetch.
    private func handleAutoRefresh(for connection: ActiveSessionsConnection) {
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
