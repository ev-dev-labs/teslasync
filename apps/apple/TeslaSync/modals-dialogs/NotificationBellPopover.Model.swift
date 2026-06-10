//
//  NotificationBellPopover.Model.swift
//  TeslaSync — P4 modal / dialog · 0010 · NotificationBellPopover (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `NotificationBellPopover` owns the
//  always-live unread count (`useUnreadCount`, 30s poll → the badge), the on-open preview list
//  (`useUnreadNotifications({ limit: 10 })`, mounted only while open), the rule/vehicle join
//  (`useAlertRules` + `useVehicles`), the "Mark all read" mutation (`useBulkMarkRead({ all: true })`)
//  and the inbox navigation. The native surface reproduces that whole lifecycle here: a
//  `NotificationBellSource` pushes the coalesced count + joined rows + load / freshness status, and
//  the model owns the resolved badge, the body phase, the per-row display projection, the bulk
//  read-all predicate + its pending state, the stale auto-refresh, and the action seams, emitting
//  the P1/S11 `view.opened` event once on first appearance. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `NotificationBellSource`, holds the unread
/// count + the joined preview rows, the load + freshness state, the resolved body phase, the
/// mark-all-read pending flag, and the open state; exposes the per-row display copy; and drives the
/// mark-all-read / open-inbox seams.
@MainActor
@Observable
public final class NotificationBellModel {
    // Count + rows (web `count` / `logs`)
    public private(set) var unreadCount = 0
    public private(set) var entries: [NotificationBellEntry] = []

    // Load + freshness (from the source)
    public private(set) var loadStatus: NotificationBellLoadStatus = .loading
    public private(set) var connection: NotificationBellConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Resolved render state
    public private(set) var phase: NotificationBellPhase = .loading
    public private(set) var inlineErrorMessage: String?

    /// Whether a "Mark all read" mutation is in flight (web `bulkMarkRead.isPending`).
    public private(set) var markPending = false

    /// Whether the popover is currently open (drives the on-open list mount via the source).
    public private(set) var isOpen = false

    @ObservationIgnored private let source: any NotificationBellSource
    @ObservationIgnored private let telemetry: any NotificationBellTelemetry
    @ObservationIgnored private let actions: any NotificationBellActions
    @ObservationIgnored let dates: any NotificationBellDateFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any NotificationBellSource,
        telemetry: any NotificationBellTelemetry = OSLogNotificationBellTelemetry(),
        actions: any NotificationBellActions = OSLogNotificationBellActions(),
        dates: any NotificationBellDateFormatting = DefaultNotificationBellDateFormatting(),
        localize: @escaping (String, String) -> String = NotificationBellStrings.string,
        now: @escaping () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.actions = actions
        self.dates = dates
        self.localize = localize
        self.now = now
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived

    /// Whether any preview row is present.
    public var hasEntries: Bool {
        !entries.isEmpty
    }

    /// The unread badge text, or `nil` when the badge is hidden (web `99+` clamp + `count > 0`).
    public var badgeText: String? {
        NotificationBellProjection.badgeText(count: unreadCount)
    }

    /// Whether the badge dot is shown (web `count > 0 &&`).
    public var showBadge: Bool {
        badgeText != nil
    }

    /// The bell trigger's VoiceOver label (web `aria-label`).
    public var triggerAccessibilityLabel: String {
        NotificationBellAccessibility.triggerLabel(count: unreadCount, localize: localize)
    }

    /// The panel header subtitle (web `count > 0 ? '{{count}} unread' : 'All caught up'`).
    public var subtitle: String {
        if unreadCount > 0 {
            return NotificationBellStrings.string(
                "notifications.bellPopover.unreadCount", "{{count}} unread", "{{count}}", String(unreadCount)
            )
        }
        return NotificationBellStrings.string("notifications.bellPopover.allRead", "All caught up")
    }

    /// Whether "Mark all read" is enabled (web `disabled={!hasLogs || bulkMarkRead.isPending}`).
    public var markAllEnabled: Bool {
        NotificationBellProjection.markAllEnabled(hasEntries: hasEntries, pending: markPending)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: NotificationBellSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Opens the popover — mounts the on-open unread-list query (web hook mounted while open).
    public func open() {
        guard !isOpen else { return }
        isOpen = true
        source.setOpen(true)
    }

    /// Closes the popover — unmounts the unread-list query (web hook unmounted on close).
    public func close() {
        guard isOpen else { return }
        isOpen = false
        source.setOpen(false)
    }

    /// Re-runs the unread-list query (the error-state retry / stale refresh / re-open refetch).
    public func refresh() {
        source.refresh()
    }

    // MARK: Actions (web `handleMarkAllRead` / row + "View all" navigation)

    /// Marks every unread notification read (web `bulkMarkRead.mutate({ all: true })`), guarded so
    /// an empty preview is a no-op (web early-return). Sets the pending flag until the next snapshot.
    public func markAllRead() {
        guard markAllEnabled else { return }
        markPending = true
        actions.markAllRead()
    }

    /// Navigates to the full inbox (web `navigate('/notifications/inbox')`). The view closes the
    /// popover around this call.
    public func openInbox() {
        actions.openInbox()
    }

    // MARK: Per-row display projection

    /// The row title (web `log.title || rule?.name || t('untitled')`).
    public func entryTitle(_ entry: NotificationBellEntry) -> String {
        entry.displayTitle(localize: localize)
    }

    /// The localized severity word used by the dot's VoiceOver label (web `SEVERITY_TONE.label`).
    public func severityLabel(_ entry: NotificationBellEntry) -> String {
        localize(entry.severity.labelKey, entry.severity.labelFallback)
    }

    /// The relative-time fragment resolved against the injected clock + date facade.
    public func relativeLabel(_ date: Date) -> String {
        dates.relative(NotificationBellRelative.from(date, now: now()))
    }

    /// One row's VoiceOver label: severity, title, relative time, and any vehicle.
    public func rowAccessibilityLabel(_ entry: NotificationBellEntry) -> String {
        NotificationBellAccessibility.rowLabel(
            severity: severityLabel(entry),
            title: entryTitle(entry),
            relative: relativeLabel(entry.createdAt),
            vehicle: entry.vehicleName
        )
    }

    // MARK: Snapshot application

    private func apply(_ update: NotificationBellUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        unreadCount = update.count
        entries = update.entries
        // A resolved snapshot clears the mark-all-read pending flag (web mutation settle).
        if update.status != .loading {
            markPending = false
        }
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Recomputes the resolved body phase + inline-error envelope from the current rows + status.
    private func recompute() {
        phase = NotificationBellProjection.phase(status: loadStatus, hasEntries: hasEntries)
        inlineErrorMessage = NotificationBellProjection.inlineFailure(
            status: loadStatus,
            hasEntries: hasEntries
        )
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached rows on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: NotificationBellConnection) {
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
