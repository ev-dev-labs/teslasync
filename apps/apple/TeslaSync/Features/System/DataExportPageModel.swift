//
//  DataExportPageModel.swift
//  TeslaSync — P4 feature view · P7 · DataExportPage (Apple) — View model
//
//  The `@Observable` state holder the page binds to (ADR-004 — no networking in
//  the view). Owns the export-jobs feed state (web `useQuery(['export-jobs'])`),
//  the vehicle list, the wizard column catalog (web `useExportColumns`), and the
//  submit / account-export mutations, reading them through the injected
//  `DataExportDataSource` seam. Every display derivation (stats, overview, download
//  href) is pure so it unit-tests without a view.
//

import Foundation
import Observation

// MARK: - Feed state (web PageContainer query phases)

/// The export-jobs feed state. `.empty` is a successful load with zero rows (web
/// `ExportHistoryTable` `EmptyState`); `.error` is a retryable failure (web
/// `PageContainer error`); `.success` carries one or more rows; `.loading` shows
/// the skeletons.
enum DataExportState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case success([DataExportJobSummary])
}

// MARK: - Column-catalog state (web `useExportColumns` phases)

/// The wizard column-picker state. `.hidden` covers "type publishes no catalog",
/// "load errored", and "selection unsupported / empty" — all of which the web hides
/// the picker for. `.loading` shows a skeleton; `.loaded` renders the checkboxes.
enum DataExportColumnsState: Equatable, Sendable {
    case hidden
    case loading
    case loaded([DataExportColumnInfo])
}

// MARK: - Mutation feedback (web `useToast` success / error)

/// A transient toast surfaced after a mutation (web `toast.success` / `toast.error`).
enum DataExportFeedback: Identifiable, Sendable {
    case exportStarted
    case exportFailed
    case accountQueued
    case accountFailed

    var id: String {
        switch self {
        case .exportStarted: "exportStarted"
        case .exportFailed: "exportFailed"
        case .accountQueued: "accountQueued"
        case .accountFailed: "accountFailed"
        }
    }

    var isError: Bool { self == .exportFailed || self == .accountFailed }

    var title: String {
        switch self {
        case .exportStarted: String(localized: "Export Started", defaultValue: "Export Started")
        case .exportFailed: String(localized: "Export Failed", defaultValue: "Export Failed")
        case .accountQueued:
            String(localized: "dataExport.account.queued", defaultValue: "Account export queued")
        case .accountFailed:
            String(localized: "dataExport.account.failed", defaultValue: "Failed to queue account export")
        }
    }

    var message: String {
        switch self {
        case .exportStarted:
            String(localized: "Export Started Msg",
                   defaultValue: "Your export has been queued and will be ready shortly.")
        case .exportFailed:
            String(localized: "Export Failed Msg",
                   defaultValue: "We couldn't start your export. Please try again.")
        case .accountQueued:
            String(localized: "dataExport.account.queuedMsg",
                   defaultValue: "Track progress in the export history below.")
        case .accountFailed:
            String(localized: "dataExport.account.failedMsg",
                   defaultValue: "We couldn't queue your account export. Please try again.")
        }
    }
}

// MARK: - Page model

@MainActor
@Observable
final class DataExportPageModel {
    private(set) var state: DataExportState = .loading
    private(set) var vehicles: [DataExportVehicle] = []
    private(set) var columnsState: DataExportColumnsState = .hidden
    private(set) var isSubmitting = false
    private(set) var isCreatingAccount = false
    var feedback: DataExportFeedback?

    /// Backend origin used to build the binary download URL at the display boundary
    /// (web resolves the relative `/api/v1/...` href against the page origin). Defaults
    /// to the documented local dev origin; production injects the bootstrapped base.
    @ObservationIgnored let apiBaseURL: URL
    @ObservationIgnored private let dataSource: any DataExportDataSource

    init(
        dataSource: any DataExportDataSource = SampleDataExportDataSource(),
        apiBaseURL: URL = URL(string: "http://localhost:8080")!
    ) {
        self.dataSource = dataSource
        self.apiBaseURL = apiBaseURL
    }

    // MARK: Derived feed accessors

    /// The loaded jobs (empty unless `.success`).
    var jobs: [DataExportJobSummary] {
        if case let .success(jobs) = state { return jobs }
        return []
    }

    /// Whether the feed reached a terminal non-loading state.
    var isLoaded: Bool {
        switch state {
        case .loading: false
        case .empty, .error, .success: true
        }
    }

    // MARK: Stats row (web `StatsRow`)

    var totalExports: Int { jobs.count }

    /// Web `jobs.reduce((s, j) => s + (j.file_size ?? 0), 0)` → `formatBytes(..., gbDecimals: 2)`.
    var totalSizeLabel: String {
        let total = jobs.reduce(into: Int64(0)) { sum, job in sum += job.fileSize ?? 0 }
        return DataExportDisplay.bytes(total, zeroAsEmpty: true, gbDecimals: 2)
    }

    /// Web `mostExportedType`: the most frequent job type with `_`→` `, else `—`.
    var mostExportedLabel: String {
        guard !jobs.isEmpty else { return DataExportDisplay.emptyValue }
        var counts: [String: Int] = [:]
        for job in jobs { counts[job.type, default: 0] += 1 }
        guard let top = counts.max(by: { lhs, rhs in lhs.value < rhs.value }) else {
            return DataExportDisplay.emptyValue
        }
        return top.key.replacingOccurrences(of: "_", with: " ")
    }

    /// Web `lastExport`: relative time of the most recent job, else `—`.
    var lastExportLabel: String {
        guard let latest = jobs.max(by: { lhs, rhs in lhs.createdAt < rhs.createdAt }) else {
            return DataExportDisplay.emptyValue
        }
        return DataExportDisplay.relative(latest.createdAt)
    }

    /// Web `dataOverview`: per-type summed record counts; `nil` until the feed loads.
    var dataOverview: DataOverview? {
        guard isLoaded else { return nil }
        let drives = jobs.filter { $0.type == "drives" }.reduce(into: 0) { $0 += $1.recordCount ?? 0 }
        let charging = jobs.filter { $0.type == "charging" }.reduce(into: 0) { $0 += $1.recordCount ?? 0 }
        return DataOverview(drives: drives, chargingSessions: charging)
    }

    /// The count of queued / processing jobs (web `activeJobs`).
    var activeJobCount: Int { jobs.filter(\.isActive).count }

    /// Resolves a vehicle's display label by id (web `vehicleMap.get(id)`).
    func vehicleLabel(for id: Int64?) -> String {
        guard let id else { return DataExportDisplay.emptyValue }
        if let match = vehicles.first(where: { $0.id == id }) { return match.label }
        return "#\(id)"
    }

    /// Web `exportDownloadUrl` — only ready jobs expose a download href.
    func downloadHref(for job: DataExportJobSummary) -> String? {
        job.isDownloadable ? DataExportDisplay.downloadHref(job.id) : nil
    }

    /// The absolute download URL the native link opens (web `<a href>` resolved against
    /// the origin) — nil unless the job is ready.
    func downloadURL(for job: DataExportJobSummary) -> URL? {
        guard let href = downloadHref(for: job) else { return nil }
        return URL(string: href, relativeTo: apiBaseURL)?.absoluteURL
    }

    // MARK: Intents

    /// Loads the jobs + vehicles, resolving the terminal feed state (web both queries).
    func load() async {
        state = .loading
        do {
            async let jobsTask = dataSource.loadJobs()
            async let vehiclesTask = dataSource.loadVehicles()
            let (jobs, vehicles) = try await (jobsTask, vehiclesTask)
            self.vehicles = vehicles
            state = jobs.isEmpty ? .empty : .success(jobs)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Loads on first appearance; idempotent once a terminal state is reached.
    func loadIfNeeded() async {
        if isLoaded { return }
        await load()
    }

    /// Re-runs the queries (web error-retry / 10s poll refetch / manual Refresh).
    func refresh() async {
        await load()
    }

    /// Web `useExportColumns(catalogType)` — loads the catalog for the wizard type.
    func loadColumns(for type: DataExportType) async {
        guard type.supportsColumnSelection else {
            columnsState = .hidden
            return
        }
        columnsState = .loading
        do {
            let response = try await dataSource.useExportColumns(type)
            if let response, response.supportsSelection, !response.columns.isEmpty {
                columnsState = .loaded(response.columns)
            } else {
                columnsState = .hidden
            }
        } catch {
            columnsState = .hidden
        }
    }

    /// Web submit mutation → `POST /export/jobs`, then invalidate the feed + toast.
    func submitExport(_ payload: DataExportSubmitPayload) async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            _ = try await dataSource.submitExport(payload)
            feedback = .exportStarted
            await load()
        } catch {
            feedback = .exportFailed
        }
    }

    /// Web `useCreateAccountExport` → `POST /export/jobs/account`, then refresh + toast.
    func createAccountExport(_ payload: DataExportAccountPayload) async {
        isCreatingAccount = true
        defer { isCreatingAccount = false }
        do {
            _ = try await dataSource.useCreateAccountExport(payload)
            feedback = .accountQueued
            await load()
        } catch {
            feedback = .accountFailed
        }
    }
}
