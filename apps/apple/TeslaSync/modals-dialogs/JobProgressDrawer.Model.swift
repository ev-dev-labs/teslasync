//
//  JobProgressDrawer.Model.swift
//  TeslaSync — P4 modal / dialog · 0005 · JobProgressDrawer (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `JobProgressDrawer` owns the
//  jobs query (`useExportJobs`, 5s poll while active) plus the persisted drawer-state machine
//  (open / minimized / dismissed), the auto-promote-on-new-active effect, and the ambient
//  auto-hide. The native surface reproduces that whole lifecycle here: an
//  `ExportDrawerJobsSource` pushes the resolved jobs + load / freshness status, and the model
//  owns the persisted presentation, the resolved visibility + body phase, the per-row display
//  projection, the stale auto-refresh, and the download action seam, emitting the P1/S11
//  `view.opened` event once on first appearance. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to an `ExportDrawerJobsSource`, holds the
/// latest jobs split into active / recent buckets, the persisted drawer presentation, the
/// resolved visibility + body phase, and the freshness; exposes the per-row display copy; and
/// drives the download seam.
@MainActor
@Observable
public final class JobProgressDrawerModel {
    // Jobs + buckets (web `allJobs` / `activeJobs` / `recentJobs`)
    public private(set) var jobs: [ExportDrawerJob] = []
    public private(set) var activeJobs: [ExportDrawerJob] = []
    public private(set) var recentJobs: [ExportDrawerJob] = []

    // Load + freshness (from the source)
    public private(set) var loadStatus: ExportDrawerLoadStatus = .loading
    public private(set) var connection: ExportDrawerConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Resolved render state
    public private(set) var visibility: JobDrawerVisibility = .minimized
    public private(set) var bodyPhase: JobDrawerBodyPhase = .loading
    public private(set) var inlineErrorMessage: String?

    /// The persisted drawer state (web `DrawerState`).
    public private(set) var presentation: JobDrawerPresentation

    /// Whether this is an intentionally-presented modal (suppresses the ambient auto-hide so
    /// loading / empty / error chrome still renders — engineering guideline #6).
    public let pinned: Bool

    /// The cap on recently-finished rows (web `maxRecent`, default 5).
    public let maxRecent: Int

    @ObservationIgnored private let source: any ExportDrawerJobsSource
    @ObservationIgnored private let telemetry: any JobProgressDrawerTelemetry
    @ObservationIgnored private let store: any JobDrawerPresentationStore
    @ObservationIgnored private let actions: any ExportDrawerActions
    @ObservationIgnored let dates: any ExportDrawerDateFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ExportDrawerJobsSource,
        pinned: Bool = false,
        maxRecent: Int = 5,
        telemetry: any JobProgressDrawerTelemetry = OSLogJobProgressDrawerTelemetry(),
        store: any JobDrawerPresentationStore = UserDefaultsJobDrawerPresentationStore(),
        actions: any ExportDrawerActions = OSLogExportDrawerActions(),
        dates: any ExportDrawerDateFormatting = DefaultExportDrawerDateFormatting(),
        localize: @escaping (String, String) -> String = JobProgressDrawerStrings.string,
        now: @escaping () -> Date = { Date() }
    ) {
        self.source = source
        self.pinned = pinned
        self.maxRecent = maxRecent
        self.telemetry = telemetry
        self.store = store
        self.actions = actions
        self.dates = dates
        self.localize = localize
        self.now = now
        presentation = store.load()
        recompute()
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived

    /// The active-job count shown in the minimized chip + the header pill (web
    /// `activeJobs.length`).
    public var activeCount: Int {
        activeJobs.count
    }

    /// Whether any job (active or recent) is present.
    public var hasAnyJobs: Bool {
        !jobs.isEmpty
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: JobProgressDrawerSurface.slug)
        source.start()
    }

    /// Stops observing the upstream jobs feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web poll / the error-state retry / stale refresh).
    public func refresh() {
        source.refresh()
    }

    // MARK: Presentation (web `persist`)

    /// Expands the minimized chip into the open panel (web `persist('open')`).
    public func expand() {
        setPresentation(.open)
    }

    /// Collapses the open panel to the minimized chip (web `persist('minimized')`).
    public func minimize() {
        setPresentation(.minimized)
    }

    /// Dismisses the drawer (web `persist('dismissed')`).
    public func dismiss() {
        setPresentation(.dismissed)
    }

    private func setPresentation(_ next: JobDrawerPresentation) {
        presentation = next
        store.save(next)
        recompute()
    }

    // MARK: Download (web `ready` row anchor)

    /// Opens a finished job's artifact through the action seam (web `exportDownloadUrl`).
    public func download(_ job: ExportDrawerJob) {
        actions.download(job)
    }

    // MARK: Per-row display projection

    /// The web "Type" label for a row.
    public func typeLabel(_ job: ExportDrawerJob) -> String {
        job.typeLabel(localize: localize)
    }

    /// The web uppercase format chip for a row.
    public func formatLabel(_ job: ExportDrawerJob) -> String {
        job.formatLabel
    }

    /// The localized status word (web `prettyStatus`).
    public func statusLabel(_ job: ExportDrawerJob) -> String {
        localize(job.status.labelKey, job.status.labelFallback)
    }

    /// The row's second line: active → "{{status}} · started {{relative}}"; recent →
    /// "{{size}} · {{relative}}" (web `statusLine` / `completedLine`).
    public func detailLine(_ job: ExportDrawerJob) -> String {
        switch job.bucket {
        case .active:
            localize("export.jobDrawer.statusLine", "{{status}} · started {{relative}}")
                .replacingOccurrences(of: "{{status}}", with: statusLabel(job))
                .replacingOccurrences(of: "{{relative}}", with: relativeLabel(job.createdAt))
        case .recent:
            localize("export.jobDrawer.completedLine", "{{size}} · {{relative}}")
                .replacingOccurrences(of: "{{size}}", with: sizeLabel(job))
                .replacingOccurrences(of: "{{relative}}", with: relativeLabel(job.settledAt))
        }
    }

    /// The recent-row size fragment (web `formatBytes(file_size, { zeroAsEmpty, gbDecimals: 2 })
    /// || '—'`).
    public func sizeLabel(_ job: ExportDrawerJob) -> String {
        ExportDrawerBytesFormatter.string(job.fileSize, zeroAsEmpty: true, gbDecimals: 2)
    }

    /// The relative-time fragment resolved against the injected clock + date facade.
    public func relativeLabel(_ date: Date) -> String {
        dates.relative(ExportDrawerRelative.from(date, now: now()))
    }

    /// One row's VoiceOver label.
    public func rowAccessibilityLabel(_ job: ExportDrawerJob) -> String {
        JobProgressDrawerAccessibility.rowLabel(
            type: typeLabel(job),
            format: formatLabel(job),
            status: statusLabel(job),
            detail: detailLine(job),
            errorMessage: job.errorMessage
        )
    }

    /// The minimized chip's VoiceOver label.
    public var minimizedAccessibilityLabel: String {
        JobProgressDrawerAccessibility.minimizedLabel(activeCount: activeCount, localize: localize)
    }

    /// The open panel's region label.
    public var panelAccessibilityLabel: String {
        JobProgressDrawerAccessibility.panelLabel(localize: localize)
    }

    // MARK: Snapshot application

    private func apply(_ update: ExportDrawerJobsUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        jobs = update.jobs
        // Web auto-promote: dismissed → minimized when an active job appears.
        if JobProgressDrawerProjection.shouldPromoteFromDismissed(
            stored: presentation,
            hasActive: !JobProgressDrawerProjection.activeJobs(jobs).isEmpty
        ) {
            presentation = .minimized
            store.save(.minimized)
        }
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Recomputes the buckets + resolved render state from the current jobs, load status, and
    /// persisted presentation.
    private func recompute() {
        activeJobs = JobProgressDrawerProjection.activeJobs(jobs)
        recentJobs = JobProgressDrawerProjection.recentJobs(jobs, maxRecent: maxRecent)
        let isLoading = loadStatus == .loading
        visibility = JobProgressDrawerProjection.resolveVisibility(
            stored: presentation,
            hasActive: !activeJobs.isEmpty,
            hasAny: hasAnyJobs,
            isLoading: isLoading,
            pinned: pinned
        )
        bodyPhase = JobProgressDrawerProjection.bodyPhase(status: loadStatus, hasAny: hasAnyJobs)
        inlineErrorMessage = JobProgressDrawerProjection.inlineFailure(
            status: loadStatus,
            hasAny: hasAnyJobs
        )
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live
    /// so a later stale episode re-triggers exactly once. Offline keeps the cached jobs on
    /// screen and does not refetch.
    private func handleAutoRefresh(for connection: ExportDrawerConnection) {
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
