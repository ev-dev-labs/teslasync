//
//  QueueJobDrawer.Model.swift
//  TeslaSync — P4 modal / dialog · 0020 · QueueJobDrawer (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `QueueJobDrawer` is a controlled
//  `<Drawer>`: the host owns `open` / `onClose` / `worker` / `displayName`, and the `useQueueJobs`
//  fetch is gated on `enabled: open && worker`. The native surface reproduces that lifecycle here:
//  a `QueueJobsSource` pushes the resolved jobs + load / freshness status, and the model owns the
//  resolved body phase, the inline reload-failure banner, the stale auto-refresh, the dismissal
//  command (web `onClose`), the drawer title, and the per-row display projection, emitting the
//  P1/S11 `view.opened` event once per presentation. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `QueueJobsSource`, holds the latest jobs
/// + freshness, exposes the resolved body phase + the inline reload-failure banner + the drawer
/// title + the per-row display copy, and drives the dismissal command seam (web `onClose`).
@MainActor
@Observable
public final class QueueJobDrawerModel {
    // Jobs + load / freshness (from the source)
    public private(set) var jobs: [QueueJobRowData] = []
    public private(set) var phase: QueueJobDrawerPhase = .loading
    public private(set) var connection: QueueJobDrawerConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var inlineErrorMessage: String?

    // MARK: Static presentation (web props)

    /// The worker whose recent jobs are shown (web `worker`). Held for completeness; the rendered
    /// title keys off `displayName`, matching the web.
    public let worker: String?
    /// The human-readable worker name interpolated into the title (web `displayName`).
    public let displayName: String?

    @ObservationIgnored private let source: any QueueJobsSource
    @ObservationIgnored private let telemetry: any QueueJobDrawerTelemetry
    @ObservationIgnored private let dates: any QueueJobDateFormatting
    @ObservationIgnored private let onClose: @MainActor () -> Void
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var latestStatus: QueueJobLoadStatus = .loading
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any QueueJobsSource,
        worker: String?,
        displayName: String? = nil,
        telemetry: any QueueJobDrawerTelemetry = OSLogQueueJobDrawerTelemetry(),
        dates: any QueueJobDateFormatting = DefaultQueueJobDateFormatting(),
        onClose: @escaping @MainActor () -> Void = {},
        localize: @escaping (String, String) -> String = QueueJobDrawerStrings.string
    ) {
        self.source = source
        self.worker = worker
        self.displayName = displayName
        self.telemetry = telemetry
        self.dates = dates
        self.onClose = onClose
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived

    /// Whether any job row is present.
    public var hasJobs: Bool {
        !jobs.isEmpty
    }

    /// The drawer title — web `displayName ? 'Recent {{worker}} jobs' : 'Recent jobs'`.
    public var title: String {
        QueueJobDrawerProjection.title(displayName: displayName, localize: localize)
    }

    /// The dialog's accessible label — web `<Drawer aria-label={title}>`.
    public var panelAccessibilityLabel: String {
        title
    }

    /// The close affordance's VoiceOver label (web close `aria-label="Close"`).
    public var closeAccessibilityLabel: String {
        QueueJobDrawerAccessibility.closeLabel(localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event once per presentation.
    /// Idempotent within a presentation; re-armed by `stop()` so a later re-present re-emits.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: QueueJobDrawerSurface.slug)
        source.start()
    }

    /// Stops observing the upstream jobs feed and re-arms the `view.opened` emission for the next
    /// presentation (web unmount on `open=false`).
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (the error-state retry / the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    // MARK: Command (web `onClose`)

    /// Dismisses the drawer — the single path shared by the scrim tap, the close "×", and the
    /// Escape / VoiceOver-escape gesture (web `onClose`). The presenting host reacts by unmounting
    /// this surface, which drives `stop()` through `onDisappear`.
    public func dismiss() {
        onClose()
    }

    // MARK: Per-row display projection

    /// The row's primary label (web `job.title || job.id`).
    public func displayTitle(_ job: QueueJobRowData) -> String {
        job.displayTitle
    }

    /// The localized status word (web `t(\`queueStatus.jobStatus.${status}\`, status)`).
    public func statusLabel(_ job: QueueJobRowData) -> String {
        localize("queueStatus.jobStatus.\(job.status)", job.status)
    }

    /// The semantic colour bucket for the row's status (web `statusToneClass`).
    public func statusTone(_ job: QueueJobRowData) -> QueueJobStatusTone {
        job.statusTone
    }

    /// The optional "Took {{duration}}" fragment, or `nil` when the row shows no duration (web
    /// `durationLabel`: `duration_ms` else `finished_at − started_at` else none).
    public func durationLabel(_ job: QueueJobRowData) -> String? {
        guard let ms = QueueJobDrawerProjection.resolvedDurationMs(
            durationMs: job.durationMs,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt
        ) else {
            return nil
        }
        return localize("queueStatus.jobDuration", "Took {{duration}}")
            .replacingOccurrences(of: "{{duration}}", with: QueueJobDurationFormatter.string(ms))
    }

    /// The row's caption line: "Started {{at}}" plus the optional " · Took {{duration}}" tail
    /// (web `Started … {durationLabel ? \` · …\` : ''}`).
    public func detailLine(_ job: QueueJobRowData) -> String {
        let started = localize("queueStatus.jobStarted", "Started {{at}}")
            .replacingOccurrences(of: "{{at}}", with: dates.dateTime(job.startedAt))
        guard let duration = durationLabel(job) else { return started }
        return "\(started) · \(duration)"
    }

    /// One row's VoiceOver label: the title, the status word, the caption line, and any error.
    public func rowAccessibilityLabel(_ job: QueueJobRowData) -> String {
        QueueJobDrawerAccessibility.rowLabel(
            title: displayTitle(job),
            status: statusLabel(job),
            detail: detailLine(job),
            errorMessage: job.error
        )
    }

    // MARK: Snapshot application

    private func apply(_ update: QueueJobsUpdate) {
        latestStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        jobs = update.jobs
        phase = QueueJobDrawerProjection.bodyPhase(status: update.status, hasJobs: !update.jobs.isEmpty)
        inlineErrorMessage = QueueJobDrawerProjection.inlineFailure(
            status: update.status,
            hasJobs: !update.jobs.isEmpty
        )
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached jobs on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: QueueJobDrawerConnection) {
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
