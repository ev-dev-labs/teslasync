//
//  BackgroundWorkSegment.Polling.swift
//  TeslaSync — P4 shared surface · 0177 · BackgroundWorkSegment (Apple)
//
//  The production source — the native peer of the web `useBackgroundJobs` aggregation, coalesced into one
//  snapshot stream. It probes `/export/jobs` on the poll cadence (through the injected probe — no
//  networking lives here), observes the in-flight mutation count (web `useIsMutating`) and the custom-job
//  registry (web `registerJob` store), maps the three signals into one `BackgroundJob` list exactly as the
//  web hook does, and emits a ``BackgroundWorkSnapshot`` after each change so the bound model derives the
//  segment + popover. Failure semantics follow the web "swallow + retry" behaviour, refined for the P4
//  leaf freshness axis: a first export probe with no baseline surfaces as the loading/error leaf; a later
//  poll failure keeps the cached list and moves the freshness to stale (or offline).
//

import Foundation

// MARK: - Export job (web `ExportJobSummary` from `/export/jobs`)

/// The lifecycle status of an export job — the native peer of the web `ExportJobSummary.status`. Only
/// `queued` + `processing` are "active" (web `j.status === 'queued' || j.status === 'processing'`); the
/// terminal states are ignored by the segment.
public enum BackgroundExportStatus: String, Sendable, Equatable {
    case queued
    case processing
    case completed
    case failed
    case cancelled

    /// Whether the job is in flight — the web active filter (`queued` / `processing`).
    public var isActive: Bool {
        self == .queued || self == .processing
    }
}

/// The value-typed native peer of the web `ExportJobSummary` (`/export/jobs`) — only the fields the
/// segment renders (web `id`, `file_name`, `type`, `status`, `created_at`).
public struct BackgroundExportJob: Sendable, Equatable {
    public let id: String
    public let fileName: String?
    public let type: String
    public let status: BackgroundExportStatus
    public let createdAt: String

    public init(id: String, fileName: String?, type: String, status: BackgroundExportStatus, createdAt: String) {
        self.id = id
        self.fileName = fileName
        self.type = type
        self.status = status
        self.createdAt = createdAt
    }
}

/// The outcome of one `/export/jobs` probe — the native peer of the web `useExportJobs` query result.
/// `jobs` carries the parsed list (web success); `failed` carries a reason plus whether the cause was a
/// lost connection (so the source can move the freshness axis to `offline` vs `stale`).
public enum ExportJobsProbeOutcome: Sendable, Equatable {
    case jobs([BackgroundExportJob])
    case failed(message: String, offline: Bool)
}

/// The seam the polling source probes export jobs through — the native peer of the web
/// `useExportJobs({ pollWhileActive: true })` query. Production injects a ``ClosureExportJobsProbe``
/// wrapping its `/export/jobs` client; tests inject a ``ScriptedExportJobsProbe``.
public protocol ExportJobsProbe: Sendable {
    func probe() async -> ExportJobsProbeOutcome
}

/// Adapts a `@Sendable` async closure into an ``ExportJobsProbe`` — the production seam. The host passes a
/// closure that calls its `/export/jobs` client and maps the response (or failure) into an
/// ``ExportJobsProbeOutcome``, so this surface ships without depending on the app's networking layer.
public struct ClosureExportJobsProbe: ExportJobsProbe {
    private let body: @Sendable () async -> ExportJobsProbeOutcome

    public init(_ body: @escaping @Sendable () async -> ExportJobsProbeOutcome) {
        self.body = body
    }

    public func probe() async -> ExportJobsProbeOutcome {
        await body()
    }
}

/// A deterministic export probe for tests/previews — returns the queued outcomes in order, then repeats
/// the last. An actor so the index advances safely across concurrent probe calls, with no real network.
public actor ScriptedExportJobsProbe: ExportJobsProbe {
    private let outcomes: [ExportJobsProbeOutcome]
    private var index = 0
    public private(set) var probeCount = 0

    public init(_ outcomes: [ExportJobsProbeOutcome]) {
        self.outcomes = outcomes
    }

    public func probe() async -> ExportJobsProbeOutcome {
        probeCount += 1
        guard !outcomes.isEmpty else {
            return .failed(message: "no scripted outcome", offline: false)
        }
        let outcome = index < outcomes.count ? outcomes[index] : outcomes[outcomes.count - 1]
        index += 1
        return outcome
    }
}

// MARK: - Production timer poller (web `useExportJobs` pollWhileActive)

/// Production poller backed by a repeating `Timer` on the main run loop — fires the source's re-probe once
/// per `interval` (web `useExportJobs` "poll while active" refetch).
@MainActor
public final class TimerBackgroundWorkPoller: BackgroundWorkPoller {
    private nonisolated(unsafe) var timer: Timer?

    public init() {}

    public func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void) {
        stop()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
            MainActor.assumeIsolated {
                onTick()
            }
        }
    }

    public func stop() {
        timer?.invalidate()
        timer = nil
    }

    deinit {
        timer?.invalidate()
    }
}

// MARK: - Polling source (web `useBackgroundJobs` aggregation)

/// The production source. Probes `/export/jobs` through the injected probe, observes the mutation count +
/// the custom-job registry, maps the three signals into one `BackgroundJob` list (web `activeExportJobs`
/// + the composite `mutationJob` + `custom`), and emits a coalesced ``BackgroundWorkSnapshot`` after each
/// change. The export probe drives the freshness axis; the mutation + custom signals are non-fatal.
@MainActor
public final class PollingBackgroundWorkSource: BackgroundWorkSource {
    public var onUpdate: (@MainActor (BackgroundWorkSnapshot) -> Void)?

    private let exportProbe: any ExportJobsProbe
    private let mutationObserver: any MutationActivityObserver
    private let customObserver: any BackgroundCustomJobObserver
    private let poller: any BackgroundWorkPoller
    private let interval: TimeInterval
    private let resolve: BackgroundWorkResolve
    private let clock: @Sendable () -> Date

    private var exportJobs: [BackgroundJob] = []
    private var mutationCount = 0
    private var mutationStartedAt: String?
    private var customJobs: [BackgroundJob] = []
    private var connection: BackgroundWorkConnection = .live
    private var resolvedOnce = false
    private var hasBaseline = false
    private var lastErrorMessage: String?
    private var exportTask: Task<Void, Never>?

    public init(
        exportProbe: any ExportJobsProbe,
        mutationObserver: any MutationActivityObserver,
        customObserver: any BackgroundCustomJobObserver = BackgroundCustomJobRegistry.shared,
        poller: any BackgroundWorkPoller = TimerBackgroundWorkPoller(),
        interval: TimeInterval = BackgroundWorkSurface.pollInterval,
        resolve: @escaping BackgroundWorkResolve = BackgroundWorkStrings.string,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.exportProbe = exportProbe
        self.mutationObserver = mutationObserver
        self.customObserver = customObserver
        self.poller = poller
        self.interval = interval
        self.resolve = resolve
        self.clock = clock
    }

    public func start() {
        if !resolvedOnce {
            onUpdate?(BackgroundWorkSnapshot(isLoading: true))
        }
        mutationObserver.onCountChange = { [weak self] count in self?.applyMutation(count) }
        customObserver.onJobsChange = { [weak self] jobs in self?.applyCustom(jobs) }
        mutationObserver.start()
        customObserver.start()
        scheduleExportProbe()
        poller.start(interval: interval) { [weak self] in self?.scheduleExportProbe() }
    }

    public func stop() {
        exportTask?.cancel()
        exportTask = nil
        poller.stop()
        mutationObserver.stop()
        customObserver.stop()
    }

    public func refresh() {
        scheduleExportProbe()
    }

    /// Runs one export probe cycle and emits. Exposed so tests drive the orchestration deterministically.
    public func probeExportOnce() async {
        await applyExport(exportProbe.probe())
    }

    private func scheduleExportProbe() {
        exportTask?.cancel()
        exportTask = Task { [weak self] in await self?.probeExportOnce() }
    }

    private func applyExport(_ outcome: ExportJobsProbeOutcome) {
        resolvedOnce = true
        switch outcome {
        case let .jobs(jobs):
            connection = .live
            hasBaseline = true
            lastErrorMessage = nil
            exportJobs = jobs.filter(\.status.isActive).map(mapExport)
        case let .failed(message, offline):
            if hasBaseline {
                connection = offline ? .offline : .stale
            } else {
                connection = offline ? .offline : .live
                lastErrorMessage = message
            }
        }
        emit()
    }

    private func applyMutation(_ count: Int) {
        let clamped = max(0, count)
        if clamped > 0, mutationCount == 0 {
            mutationStartedAt = BackgroundWorkTimestamp.iso(clock())
        } else if clamped == 0 {
            mutationStartedAt = nil
        }
        mutationCount = clamped
        emit()
    }

    private func applyCustom(_ jobs: [BackgroundJob]) {
        customJobs = jobs
        emit()
    }

    private func mapExport(_ job: BackgroundExportJob) -> BackgroundJob {
        let fallback = resolve("statusBar.background.exportFallback", "{{type}} export")
            .replacingOccurrences(of: "{{type}}", with: job.type)
        let label = BackgroundWorkProjection.nonEmpty(job.fileName) ?? fallback
        let description = job.status == .queued
            ? resolve("statusBar.background.exportQueued", "Queued")
            : resolve("statusBar.background.exportProcessing", "Processing")
        return BackgroundJob(
            id: "export:\(job.id)",
            kind: .export,
            label: label,
            description: description,
            startedAt: job.createdAt
        )
    }

    private func mutationJob() -> BackgroundJob? {
        guard mutationCount > 0 else { return nil }
        let label: String = if mutationCount == 1 {
            resolve("statusBar.background.saving", "Saving…")
        } else {
            resolve("statusBar.background.savingMany", "Saving {{count}} changes…")
                .replacingOccurrences(of: "{{count}}", with: String(mutationCount))
        }
        return BackgroundJob(
            id: "tanstack-mutations",
            kind: .mutation,
            label: label,
            description: nil,
            startedAt: mutationStartedAt ?? BackgroundWorkTimestamp.iso(clock())
        )
    }

    private func emit() {
        var jobs = exportJobs
        if let mutation = mutationJob() {
            jobs.append(mutation)
        }
        jobs.append(contentsOf: customJobs)
        onUpdate?(BackgroundWorkSnapshot(
            jobs: jobs,
            isLoading: !resolvedOnce,
            errorMessage: hasBaseline ? nil : lastErrorMessage,
            connection: connection
        ))
    }
}
